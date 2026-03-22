"use client";

/**
 * useAudiobookPipeline.ts — 오디오북 영상 생성 전체 파이프라인 훅
 *
 * 흐름:
 *   1. 씬 데이터 입력 (텍스트 + 이미지 프롬프트)
 *   2. 각 씬: 이미지 생성 (기존 /api/generate-image)
 *   3. 각 씬: TTS 나레이션 생성 (/api/tts-gemini)
 *   4. 자막 생성 (오디오 길이 기반 균등 분할)
 *   5. FFmpeg.wasm으로 최종 영상 합성
 *
 * 상태 모델: idle → generating → composing → done / error
 */

import { useState, useCallback, useRef } from "react";
import type { AudiobookScene, AudiobookComposeOptions, ComposeProgress } from "@/lib/audiobook-composer";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface AudiobookSceneInput {
  /** 나레이션 텍스트 (TTS로 읽힐 내용) */
  narration: string;
  /** 이미지 생성 프롬프트 (영어 권장) */
  imagePrompt: string;
}

export type AudiobookVoice =
  | "Enceladus" | "Charon" | "Kore" | "Fenrir" | "Aoede"
  | "Puck" | "Leda" | "Orus" | "Zephyr";

export interface AudiobookConfig {
  /** 프로젝트 제목 */
  title: string;
  /** 보이스 선택 */
  voice: AudiobookVoice;
  /** 나레이션 속도 */
  speed: "slow" | "natural" | "fast";
  /** 이미지 스타일 (기존 스타일 카탈로그 ID) */
  imageStyle: string;
  /** 해상도 */
  resolution: "landscape" | "portrait";
  /** 씬 간 페이드 (초) */
  fadeDuration: number;
  /** BGM 파일 (File 객체) */
  bgmFile?: File;
  /** BGM 볼륨 (0-1) */
  bgmVolume: number;
}

export type PipelinePhase =
  | "idle"
  | "generating_images"
  | "generating_tts"
  | "composing_video"
  | "done"
  | "error";

export interface PipelineState {
  phase: PipelinePhase;
  /** 전체 진행률 (0-100) */
  overallPercent: number;
  /** 현재 작업 설명 */
  message: string;
  /** 씬별 상태 */
  sceneStatuses: SceneStatus[];
  /** 완료 시 결과 */
  result?: {
    blobUrl: string;
    sizeBytes: number;
  };
  /** 에러 메시지 */
  error?: string;
}

export interface SceneStatus {
  index: number;
  imageReady: boolean;
  ttsReady: boolean;
  imageBase64?: string;
  imageMimeType?: string;
  audioBase64?: string;
  audioMimeType?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// API Calls
// ═══════════════════════════════════════════════════════════════════

async function generateImage(
  prompt: string,
  style: string,
): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      aspectRatio: "16:9",
      animationMode: style,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error || `Image generation failed: ${res.status}`);
  }

  const data = await res.json() as { images?: { base64: string; mimeType: string }[] };
  if (!data.images?.length) {
    throw new Error("이미지가 생성되지 않았습니다.");
  }

  return data.images[0];
}

async function generateTTS(
  text: string,
  voice: AudiobookVoice,
  speed: "slow" | "natural" | "fast",
): Promise<{ audioBase64: string; mimeType: string }> {
  const res = await fetch("/api/tts-gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, speed }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error || `TTS failed: ${res.status}`);
  }

  const data = await res.json() as { audioBase64: string; mimeType?: string };
  return {
    audioBase64: data.audioBase64,
    mimeType: data.mimeType || "audio/wav",
  };
}

// ═══════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════

export function useAudiobookPipeline() {
  const [state, setState] = useState<PipelineState>({
    phase: "idle",
    overallPercent: 0,
    message: "대기 중",
    sceneStatuses: [],
  });

  const abortRef = useRef(false);

  const reset = useCallback(() => {
    abortRef.current = false;
    setState({
      phase: "idle",
      overallPercent: 0,
      message: "대기 중",
      sceneStatuses: [],
    });
  }, []);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  const generate = useCallback(async (
    scenes: AudiobookSceneInput[],
    config: AudiobookConfig,
  ) => {
    abortRef.current = false;

    const sceneStatuses: SceneStatus[] = scenes.map((_, i) => ({
      index: i + 1,
      imageReady: false,
      ttsReady: false,
    }));

    setState({
      phase: "generating_images",
      overallPercent: 0,
      message: "이미지 생성 시작...",
      sceneStatuses: [...sceneStatuses],
    });

    // ── Phase 1: 이미지 생성 (순차 — API 부하 관리) ──
    for (let i = 0; i < scenes.length; i++) {
      if (abortRef.current) {
        setState(prev => ({ ...prev, phase: "error", error: "사용자가 중단했습니다." }));
        return;
      }

      setState(prev => ({
        ...prev,
        phase: "generating_images",
        overallPercent: Math.round((i / scenes.length) * 30),
        message: `이미지 생성 중... (${i + 1}/${scenes.length})`,
      }));

      try {
        const img = await generateImage(scenes[i].imagePrompt, config.imageStyle);
        sceneStatuses[i].imageReady = true;
        sceneStatuses[i].imageBase64 = img.base64;
        sceneStatuses[i].imageMimeType = img.mimeType;
        setState(prev => ({ ...prev, sceneStatuses: [...sceneStatuses] }));
      } catch (err) {
        sceneStatuses[i].error = err instanceof Error ? err.message : String(err);
        setState(prev => ({
          ...prev,
          phase: "error",
          error: `씬 ${i + 1} 이미지 생성 실패: ${sceneStatuses[i].error}`,
          sceneStatuses: [...sceneStatuses],
        }));
        return;
      }
    }

    // ── Phase 2: TTS 생성 (순차) ──
    setState(prev => ({
      ...prev,
      phase: "generating_tts",
      overallPercent: 30,
      message: "나레이션 생성 시작...",
    }));

    for (let i = 0; i < scenes.length; i++) {
      if (abortRef.current) {
        setState(prev => ({ ...prev, phase: "error", error: "사용자가 중단했습니다." }));
        return;
      }

      setState(prev => ({
        ...prev,
        overallPercent: 30 + Math.round((i / scenes.length) * 30),
        message: `나레이션 생성 중... (${i + 1}/${scenes.length})`,
      }));

      try {
        const tts = await generateTTS(scenes[i].narration, config.voice, config.speed);
        sceneStatuses[i].ttsReady = true;
        sceneStatuses[i].audioBase64 = tts.audioBase64;
        sceneStatuses[i].audioMimeType = tts.mimeType;
        setState(prev => ({ ...prev, sceneStatuses: [...sceneStatuses] }));
      } catch (err) {
        sceneStatuses[i].error = err instanceof Error ? err.message : String(err);
        setState(prev => ({
          ...prev,
          phase: "error",
          error: `씬 ${i + 1} TTS 생성 실패: ${sceneStatuses[i].error}`,
          sceneStatuses: [...sceneStatuses],
        }));
        return;
      }
    }

    // ── Phase 3: 영상 합성 ──
    setState(prev => ({
      ...prev,
      phase: "composing_video",
      overallPercent: 60,
      message: "영상 합성 시작...",
    }));

    try {
      // AudiobookScene 배열 구성
      const composerScenes: AudiobookScene[] = sceneStatuses.map((s, i) => ({
        index: s.index,
        narration: scenes[i].narration,
        imageBase64: s.imageBase64!,
        imageMimeType: s.imageMimeType!,
        audioBase64: s.audioBase64!,
        audioMimeType: s.audioMimeType!,
      }));

      // BGM 로드 (File → Uint8Array)
      let bgmData: { data: Uint8Array; volume: number } | undefined;
      if (config.bgmFile) {
        const buf = await config.bgmFile.arrayBuffer();
        bgmData = {
          data: new Uint8Array(buf),
          volume: config.bgmVolume,
        };
      }

      const composeOptions: AudiobookComposeOptions = {
        resolution: config.resolution,
        fadeDuration: config.fadeDuration,
        bgm: bgmData,
        projectTitle: config.title,
      };

      const { composeAudiobookVideo, downloadAudiobookVideo } = await import("@/lib/audiobook-composer");

      const result = await composeAudiobookVideo(
        composerScenes,
        composeOptions,
        (progress: ComposeProgress) => {
          setState(prev => ({
            ...prev,
            overallPercent: 60 + Math.round(progress.percent * 0.4),
            message: progress.message,
          }));
        },
      );

      // 자동 다운로드
      const { blobUrl, sizeBytes } = downloadAudiobookVideo(result.data, config.title);

      setState({
        phase: "done",
        overallPercent: 100,
        message: `완료! (${(sizeBytes / 1024 / 1024).toFixed(1)}MB)`,
        sceneStatuses: [...sceneStatuses],
        result: { blobUrl, sizeBytes },
      });
    } catch (err) {
      setState(prev => ({
        ...prev,
        phase: "error",
        error: `영상 합성 실패: ${err instanceof Error ? err.message : String(err)}`,
      }));
    }
  }, []);

  return { state, generate, reset, abort };
}
