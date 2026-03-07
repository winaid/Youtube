"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Cut,
  VideoClip,
  VideoGenStatus,
  VideoGenerationState,
  VeoGenerationConfig,
  VideoVariant,
  PromptVerification,
  CharacterFaceRef,
  DEFAULT_VEO_CONFIG,
} from "@/types";

const POLL_INTERVAL = 5000;

interface UseVideoGenerationOptions {
  cuts: Cut[];
  storyboardImages?: Record<number, string>;
  faceRefs?: CharacterFaceRef[];
  onSeedDetected?: (cutNumber: number, seed: string) => void;
}

// Style intensity keywords at different levels
const STYLE_KEYWORDS_BY_INTENSITY: Record<string, string[]> = {
  low: [],
  medium: ["cinematic", "film grain"],
  high: ["cinematic masterpiece", "film grain", "depth of field", "anamorphic lens", "professional color grading", "dramatic composition"],
};

function getStyleSuffix(intensity: number): string {
  if (intensity <= 20) return "";
  if (intensity <= 50) return STYLE_KEYWORDS_BY_INTENSITY.medium.join(", ");
  return STYLE_KEYWORDS_BY_INTENSITY.high.join(", ");
}

function strengthenNegativePrompt(original: string, retryCount: number): string {
  const additionalNegatives = [
    "distorted face, deformed hands, extra fingers, mutated",
    "text corruption, garbled text, broken letters, unreadable text",
    "blurry face, asymmetric eyes, distorted body proportions",
  ];
  const extras = additionalNegatives.slice(0, retryCount).join(", ");
  return extras ? `${original}, ${extras}` : original;
}

export function useVideoGeneration({ cuts, storyboardImages, faceRefs, onSeedDetected }: UseVideoGenerationOptions) {
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

  // Enhancement 1: Prompt quality verification
  const verifyPrompt = useCallback(async (cut: Cut): Promise<PromptVerification | null> => {
    try {
      const res = await fetch("/api/verify-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoPrompt: cut.videoPrompt,
          extendPrompt: cut.extendPrompt,
          imagePrompt: cut.imagePrompt,
          sceneDescription: cut.sceneDescription,
          cutNumber: cut.cutNumber,
        }),
      });
      if (res.ok) {
        return await res.json() as PromptVerification;
      }
    } catch (err) {
      console.warn("Prompt verification failed:", err);
    }
    return null;
  }, []);

  // Enhancement 3: English native correction
  const refinePromptEnglish = useCallback(async (cut: Cut): Promise<{ refinedVideoPrompt?: string; refinedExtendPrompt?: string } | null> => {
    try {
      const res = await fetch("/api/refine-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoPrompt: cut.videoPrompt,
          extendPrompt: cut.extendPrompt,
          cutNumber: cut.cutNumber,
          mode: "english-native",
        }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn("English refinement failed:", err);
    }
    return null;
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
          // Enhancement 6: Auto-retry on failure
          setState((prev) => {
            const clip = prev.clips.find((c) => c.cutNumber === cutNumber);
            const retryCount = clip?.retryCount || 0;
            const cfg = prev.config;

            if (cfg.autoRetryOnFailure && retryCount < cfg.maxRetryCount) {
              // Will trigger retry via effect
              return {
                ...prev,
                clips: prev.clips.map((c) =>
                  c.cutNumber === cutNumber
                    ? { ...c, status: "idle" as VideoGenStatus, retryCount: retryCount + 1, error: `재시도 ${retryCount + 1}/${cfg.maxRetryCount}...` }
                    : c
                ),
              };
            }

            // Max retries exceeded
            const newClips = prev.clips.map((c) =>
              c.cutNumber === cutNumber
                ? { ...c, status: "failed" as VideoGenStatus, error: data.error || "생성 실패" }
                : c
            );

            if (autoModeRef.current) {
              autoModeRef.current = false;
              return { ...prev, clips: newClips, isAutoMode: false };
            }
            return { ...prev, clips: newClips };
          });

          pollTimers.current.delete(cutNumber);
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

  // Auto-retry effect: when a clip becomes "idle" with retryCount > 0, auto-generate
  useEffect(() => {
    const clipToRetry = state.clips.find(
      (c) => c.status === "idle" && c.retryCount && c.retryCount > 0
    );
    if (clipToRetry) {
      generateCut(clipToRetry.cutNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.clips]);

  // 단일 장면 생성
  const generateCut = useCallback(async (cutNumber: number) => {
    const cut = cuts.find((c) => c.cutNumber === cutNumber);
    if (!cut) return;

    const cfg = state.config;
    let prompt = cutNumber === 1 ? cut.videoPrompt : cut.extendPrompt;
    const clip = state.clips.find((c) => c.cutNumber === cutNumber);
    const retryCount = clip?.retryCount || 0;

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
      // Enhancement 1 & 3: Auto verify and refine prompts (only on first attempt)
      if (retryCount === 0) {
        // Enhancement 3: English native correction
        if (cfg.autoEnglishRefine) {
          const refined = await refinePromptEnglish(cut);
          if (refined?.refinedVideoPrompt) {
            prompt = cutNumber === 1
              ? refined.refinedVideoPrompt
              : (refined.refinedExtendPrompt || prompt);
          }
        }

        // Enhancement 1: Verify prompt quality
        if (cfg.autoVerifyPrompts) {
          const verification = await verifyPrompt(cut);
          if (verification) {
            updateClip(cutNumber, { verification });
            // If score is low and improved prompt is available, use it
            if (verification.overallScore < 80 && verification.improvedVideoPrompt) {
              prompt = cutNumber === 1
                ? verification.improvedVideoPrompt
                : (verification.improvedExtendPrompt || prompt);
            }
          }
        }
      }

      // Enhancement 5: Apply style intensity
      const styleSuffix = getStyleSuffix(cfg.styleIntensity);
      if (styleSuffix && !prompt.includes(styleSuffix.split(",")[0])) {
        prompt = `${prompt}. ${styleSuffix}`;
      }

      const hasText = /text|title|caption|subtitle|letter|sign|hangeul/i.test(
        cut.videoPrompt + " " + cut.imagePrompt + " " + cut.sceneDescription
      );

      // Enhancement 6: Strengthen negative prompt on retry
      const negativePrompt = retryCount > 0
        ? strengthenNegativePrompt(cfg.negativePrompt || "", retryCount)
        : cfg.negativePrompt;

      // Enhancement 4: Auto-link storyboard as firstFrame
      let firstFrameBase64 = cutNumber === 1 ? cfg.firstFrameBase64 : undefined;
      if (cfg.autoLinkFirstFrame && storyboardImages) {
        if (cutNumber === 1 && !firstFrameBase64 && storyboardImages[1]) {
          firstFrameBase64 = storyboardImages[1];
        } else if (cutNumber > 1 && storyboardImages[cutNumber]) {
          firstFrameBase64 = storyboardImages[cutNumber];
        }
      }

      // 캐릭터 얼굴 레퍼런스 자동 주입
      const allReferenceImages = [...(cfg.referenceImages || [])];
      if (faceRefs && faceRefs.length > 0) {
        // 이 장면에 등장하는 캐릭터의 얼굴 레퍼런스 추가
        const charsInScene = cut.charactersInScene || [];
        const relevantFaces = charsInScene.length > 0
          ? faceRefs.filter((ref) => charsInScene.includes(ref.characterId))
          : faceRefs; // 캐릭터 정보 없으면 모든 얼굴 주입
        for (const ref of relevantFaces) {
          if (!allReferenceImages.includes(ref.faceBase64)) {
            allReferenceImages.push(ref.faceBase64);
          }
        }
      }
      // Veo는 최대 3장 reference image 지원
      const finalRefImages = allReferenceImages.slice(0, 3);

      const body: Record<string, unknown> = {
        prompt,
        mode: hasText ? "quality" : cfg.mode,
        durationSeconds: cfg.durationSeconds,
        resolution: cfg.resolution,
        aspectRatio: cfg.aspectRatio,
        generateAudio: cfg.generateAudio,
        negativePrompt: negativePrompt || undefined,
        personGeneration: cfg.personGeneration,
        sampleCount: cfg.sampleCount,
        seed: cfg.seed,
        // Scene Extension
        previousVideoUri: cutNumber > 1 ? prevClip?.videoUri : undefined,
        // First Frame (Enhancement 4: auto-linked or manual)
        firstFrameBase64: firstFrameBase64,
        lastFrameBase64: cutNumber === 1 ? cfg.lastFrameBase64 : undefined,
        // Reference Images (캐릭터 얼굴 + 수동 레퍼런스)
        referenceImages: finalRefImages.length > 0 ? finalRefImages : undefined,
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
  }, [cuts, state.clips, state.config, storyboardImages, faceRefs, updateClip, startPolling, verifyPrompt, refinePromptEnglish]);

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
      retryCount: 0,
      verification: undefined,
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
    verifyPrompt,
    refinePromptEnglish,
    completedCount,
    totalCount,
    progress,
  };
}
