"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Cut, VideoClip, VideoGenStatus, VideoGenerationState } from "@/types";

const POLL_INTERVAL = 5000; // 5초마다 폴링

interface UseVideoGenerationOptions {
  cuts: Cut[];
  onSeedDetected?: (cutNumber: number, seed: string) => void;
}

export function useVideoGeneration({ cuts, onSeedDetected }: UseVideoGenerationOptions) {
  const [state, setState] = useState<VideoGenerationState>({
    clips: [],
    isAutoMode: false,
    currentAutoIndex: -1,
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
          updateClip(cutNumber, {
            status: "completed",
            videoUri: data.videoUri,
            seed: data.seed || undefined,
            completedAt: Date.now(),
          });

          if (data.seed && onSeedDetected) {
            onSeedDetected(cutNumber, data.seed);
          }

          pollTimers.current.delete(cutNumber);

          // 자동 모드면 다음 컷 시작
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

          // 자동 모드 중단
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

  // 단일 컷 생성
  const generateCut = useCallback(async (
    cutNumber: number,
    options?: { mode?: "fast" | "quality"; durationSec?: number }
  ) => {
    const cut = cuts.find((c) => c.cutNumber === cutNumber);
    if (!cut) return;

    const prompt = cutNumber === 1 ? cut.videoPrompt : cut.extendPrompt;

    // 이전 컷의 videoUri (Scene Extension)
    const prevClip = state.clips.find(
      (c) => c.cutNumber === cutNumber - 1 && c.status === "completed"
    );

    updateClip(cutNumber, {
      status: "generating",
      startedAt: Date.now(),
      error: undefined,
    });

    try {
      const hasText = /text|title|caption|subtitle|letter|sign|hangeul/i.test(
        cut.videoPrompt + " " + cut.imagePrompt + " " + cut.sceneDescription
      );

      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          mode: options?.mode || (hasText ? "quality" : "fast"),
          previousVideoUri: cutNumber > 1 ? prevClip?.videoUri : undefined,
        }),
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
      startPolling(cutNumber, data.operationName);
    } catch (err) {
      updateClip(cutNumber, {
        status: "failed",
        error: err instanceof Error ? err.message : "요청 실패",
      });
    }
  }, [cuts, state.clips, updateClip, startPolling]);

  // 자동 모드: currentAutoIndex 변경 시 다음 컷 생성
  useEffect(() => {
    if (!state.isAutoMode || state.currentAutoIndex < 0) return;
    const clip = state.clips[state.currentAutoIndex];
    if (!clip || clip.status !== "idle") return;

    generateCut(clip.cutNumber);
  }, [state.isAutoMode, state.currentAutoIndex, state.clips, generateCut]);

  // 전체 자동 생성 시작
  const startAutoGeneration = useCallback(() => {
    autoModeRef.current = true;
    setState((prev) => ({
      ...prev,
      isAutoMode: true,
      currentAutoIndex: 0,
    }));
  }, []);

  // 자동 생성 중단
  const stopAutoGeneration = useCallback(() => {
    autoModeRef.current = false;
    setState((prev) => ({
      ...prev,
      isAutoMode: false,
    }));
  }, []);

  // 클립 순서 변경 (타임라인 편집)
  const reorderClips = useCallback((fromIndex: number, toIndex: number) => {
    setState((prev) => {
      const newClips = [...prev.clips];
      const [moved] = newClips.splice(fromIndex, 1);
      newClips.splice(toIndex, 0, moved);
      return { ...prev, clips: newClips };
    });
  }, []);

  // 트림 설정
  const setTrim = useCallback((cutNumber: number, trimStart: number, trimEnd: number) => {
    updateClip(cutNumber, { trimStart, trimEnd });
  }, [updateClip]);

  // 리셋
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
    });
  }, [updateClip]);

  const completedCount = state.clips.filter((c) => c.status === "completed").length;
  const totalCount = state.clips.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return {
    ...state,
    generateCut,
    startAutoGeneration,
    stopAutoGeneration,
    reorderClips,
    setTrim,
    resetClip,
    completedCount,
    totalCount,
    progress,
  };
}
