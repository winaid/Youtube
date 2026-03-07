"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Cut,
  VideoClip,
  VideoGenStatus,
  VideoGenerationState,
  VeoGenerationConfig,
  VideoVariant,
  DEFAULT_VEO_CONFIG,
} from "@/types";

const POLL_INTERVAL = 5000;

interface UseVideoGenerationOptions {
  cuts: Cut[];
  onSeedDetected?: (cutNumber: number, seed: string) => void;
}

export function useVideoGeneration({ cuts, onSeedDetected }: UseVideoGenerationOptions) {
  const [state, setState] = useState<VideoGenerationState>({
    clips: [],
    isAutoMode: false,
    currentAutoIndex: -1,
    config: { ...DEFAULT_VEO_CONFIG },
  });

  const pollTimers = useRef<Map<number, NodeJS.Timeout>>(new Map());
  const autoModeRef = useRef(false);

  // cuts 변경 시 clips 초기화
  useEffect(() => {
    setState((prev) => ({
      ...prev,
      clips: cuts.map((cut) => {
        const existing = prev.clips.find((c) => c.cutNumber === cut.cutNumber);
        if (existing) return existing;
        return {
          cutNumber: cut.cutNumber,
          status: "idle" as VideoGenStatus,
          durationSec: cut.durationSec,
        };
      }),
    }));
  }, [cuts]);

  // cleanup on unmount
  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const updateClip = useCallback((cutNumber: number, update: Partial<VideoClip>) => {
    setState((prev) => ({
      ...prev,
      clips: prev.clips.map((c) =>
        c.cutNumber === cutNumber ? { ...c, ...update } : c
      ),
    }));
  }, []);

  // config 업데이트
  const updateConfig = useCallback((config: VeoGenerationConfig) => {
    setState((prev) => ({ ...prev, config }));
  }, []);

  // 폴링 시작
  const startPolling = useCallback((cutNumber: number, operationName: string) => {
    const poll = async () => {
      try {
        const res = await fetch("/api/check-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operationName }),
        });
        const data = await res.json();

        if (data.status === "COMPLETED") {
          const clipUpdate: Partial<VideoClip> = {
            status: "completed",
            videoUri: data.videoUri,
            seed: data.seed || undefined,
            completedAt: Date.now(),
          };

          // 다중 변형 처리
          if (data.variants && data.variants.length > 0) {
            clipUpdate.variants = data.variants as VideoVariant[];
            clipUpdate.selectedVariant = 0;
            clipUpdate.videoUri = data.variants[0].videoUri;
            clipUpdate.seed = data.variants[0].seed;
          }

          updateClip(cutNumber, clipUpdate);

          if (data.seed && onSeedDetected) {
            onSeedDetected(cutNumber, data.seed);
          }

          pollTimers.current.delete(cutNumber);

          // 자동 모드면 다음 장면 시작
          if (autoModeRef.current) {
            setState((prev) => {
              const nextIdx = prev.currentAutoIndex + 1;
              if (nextIdx < prev.clips.length) {
                return { ...prev, currentAutoIndex: nextIdx };
              }
              return { ...prev, isAutoMode: false, currentAutoIndex: -1 };
            });
          }
          return;
        }

        if (data.status === "FAILED") {
          updateClip(cutNumber, {
            status: "failed",
            error: data.error || "생성 실패",
          });
          pollTimers.current.delete(cutNumber);

          if (autoModeRef.current) {
            autoModeRef.current = false;
            setState((prev) => ({ ...prev, isAutoMode: false }));
          }
          return;
        }

        // 아직 진행 중 → 다시 폴링
        const timer = setTimeout(poll, POLL_INTERVAL);
        pollTimers.current.set(cutNumber, timer);
      } catch (err) {
        updateClip(cutNumber, {
          status: "failed",
          error: err instanceof Error ? err.message : "폴링 실패",
        });
        pollTimers.current.delete(cutNumber);
      }
    };

    updateClip(cutNumber, { status: "polling" });
    poll();
  }, [updateClip, onSeedDetected]);

  // 단일 장면 생성
  const generateCut = useCallback(async (cutNumber: number) => {
    const cut = cuts.find((c) => c.cutNumber === cutNumber);
    if (!cut) return;

    const cfg = state.config;
    const prompt = cutNumber === 1 ? cut.videoPrompt : cut.extendPrompt;

    // 이전 장면의 videoUri (Scene Extension)
    const prevClip = state.clips.find(
      (c) => c.cutNumber === cutNumber - 1 && c.status === "completed"
    );

    updateClip(cutNumber, {
      status: "generating",
      startedAt: Date.now(),
      error: undefined,
      variants: undefined,
      selectedVariant: undefined,
    });

    try {
      const hasText = /text|title|caption|subtitle|letter|sign|hangeul/i.test(
        cut.videoPrompt + " " + cut.imagePrompt + " " + cut.sceneDescription
      );

      const body: Record<string, unknown> = {
        prompt,
        mode: hasText ? "quality" : cfg.mode,
        durationSeconds: cfg.durationSeconds,
        resolution: cfg.resolution,
        aspectRatio: cfg.aspectRatio,
        generateAudio: cfg.generateAudio,
        negativePrompt: cfg.negativePrompt || undefined,
        personGeneration: cfg.personGeneration,
        sampleCount: cfg.sampleCount,
        seed: cfg.seed,
        // Scene Extension
        previousVideoUri: cutNumber > 1 ? prevClip?.videoUri : undefined,
        // First/Last Frame (CUT 1에만 적용)
        firstFrameBase64: cutNumber === 1 ? cfg.firstFrameBase64 : undefined,
        lastFrameBase64: cutNumber === 1 ? cfg.lastFrameBase64 : undefined,
        // Reference Images
        referenceImages: cfg.referenceImages.length > 0 ? cfg.referenceImages : undefined,
      };

      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "API 오류" }));
        updateClip(cutNumber, {
          status: "failed",
          error: errData.error || `HTTP ${res.status}`,
        });
        return;
      }

      const data = await res.json();
      updateClip(cutNumber, { operationName: data.operationName });

      if (data.warning) {
        console.warn(`CUT ${cutNumber} warning:`, data.warning);
      }

      startPolling(cutNumber, data.operationName);
    } catch (err) {
      updateClip(cutNumber, {
        status: "failed",
        error: err instanceof Error ? err.message : "요청 실패",
      });
    }
  }, [cuts, state.clips, state.config, updateClip, startPolling]);

  // 자동 모드
  useEffect(() => {
    if (!state.isAutoMode || state.currentAutoIndex < 0) return;
    const clip = state.clips[state.currentAutoIndex];
    if (!clip || clip.status !== "idle") return;

    generateCut(clip.cutNumber);
  }, [state.isAutoMode, state.currentAutoIndex, state.clips, generateCut]);

  const startAutoGeneration = useCallback(() => {
    autoModeRef.current = true;
    setState((prev) => ({
      ...prev,
      isAutoMode: true,
      currentAutoIndex: 0,
    }));
  }, []);

  const stopAutoGeneration = useCallback(() => {
    autoModeRef.current = false;
    setState((prev) => ({ ...prev, isAutoMode: false }));
  }, []);

  // 변형 선택
  const selectVariant = useCallback((cutNumber: number, variantIndex: number) => {
    setState((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => {
        if (c.cutNumber !== cutNumber || !c.variants) return c;
        const variant = c.variants[variantIndex];
        if (!variant) return c;
        return {
          ...c,
          selectedVariant: variantIndex,
          videoUri: variant.videoUri,
          seed: variant.seed,
        };
      }),
    }));
  }, []);

  const reorderClips = useCallback((fromIndex: number, toIndex: number) => {
    setState((prev) => {
      const newClips = [...prev.clips];
      const [moved] = newClips.splice(fromIndex, 1);
      newClips.splice(toIndex, 0, moved);
      return { ...prev, clips: newClips };
    });
  }, []);

  const setTrim = useCallback((cutNumber: number, trimStart: number, trimEnd: number) => {
    updateClip(cutNumber, { trimStart, trimEnd });
  }, [updateClip]);

  const resetClip = useCallback((cutNumber: number) => {
    const timer = pollTimers.current.get(cutNumber);
    if (timer) {
      clearTimeout(timer);
      pollTimers.current.delete(cutNumber);
    }
    updateClip(cutNumber, {
      status: "idle",
      operationName: undefined,
      videoUri: undefined,
      seed: undefined,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
      variants: undefined,
      selectedVariant: undefined,
    });
  }, [updateClip]);

  const completedCount = state.clips.filter((c) => c.status === "completed").length;
  const totalCount = state.clips.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return {
    ...state,
    updateConfig,
    generateCut,
    startAutoGeneration,
    stopAutoGeneration,
    selectVariant,
    reorderClips,
    setTrim,
    resetClip,
    completedCount,
    totalCount,
    progress,
  };
}
