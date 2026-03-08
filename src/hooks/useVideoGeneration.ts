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
  storyboardEndImages?: Record<number, string>;
  faceRefs?: CharacterFaceRef[];
  onSeedDetected?: (cutNumber: number, seed: string) => void;
}

// Capture the last frame of a video element as base64
function captureVideoLastFrame(videoUri: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";

    const timeout = setTimeout(() => {
      video.remove();
      resolve(null);
    }, 10000);

    video.onloadedmetadata = () => {
      // Seek to last frame (duration - small offset)
      video.currentTime = Math.max(0, video.duration - 0.05);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
        clearTimeout(timeout);
        video.remove();
        resolve(base64.length > 100 ? base64 : null);
      } catch {
        clearTimeout(timeout);
        video.remove();
        resolve(null);
      }
    };

    video.onerror = () => {
      clearTimeout(timeout);
      video.remove();
      resolve(null);
    };

    video.src = videoUri;
  });
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

export function useVideoGeneration({ cuts, storyboardImages, storyboardEndImages, faceRefs, onSeedDetected }: UseVideoGenerationOptions) {
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

          // Enhancement 9: Auto video quality verification via Gemini Vision
          if (clipUpdate.videoUri) {
            try {
              const lastFrame = await captureVideoLastFrame(clipUpdate.videoUri);
              if (lastFrame) {
                const cut = cuts.find((c) => c.cutNumber === cutNumber);
                fetch("/api/verify-video-quality", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    frameBase64: lastFrame,
                    videoPrompt: cut?.videoPrompt || "",
                    sceneDescription: cut?.sceneDescription || "",
                    cutNumber,
                  }),
                }).then(async (qRes) => {
                  if (qRes.ok) {
                    const quality = await qRes.json();
                    if (quality.overallScore !== undefined) {
                      updateClip(cutNumber, {
                        verification: {
                          overallScore: quality.overallScore,
                          scores: {
                            characterDescription: quality.scores?.promptMatch ?? 0,
                            cameraMovement: quality.scores?.composition ?? 0,
                            actionSequence: quality.scores?.motionCoherence ?? 0,
                            lightingMood: quality.scores?.styleConsistency ?? 0,
                            veoCompatibility: quality.scores?.visualQuality ?? 0,
                          },
                          issues: quality.issues || [],
                          suggestions: quality.suggestion ? [quality.suggestion] : [],
                        },
                      });
                    }
                  }
                }).catch(() => {});
              }
            } catch {
              // Quality verification is optional, don't block
            }
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
  }, [updateClip, onSeedDetected, cuts]);

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

      // Enhancement 8: Smart negative prompt auto-generation
      let negativePrompt = cfg.negativePrompt;
      if (retryCount === 0) {
        try {
          const negRes = await fetch("/api/auto-negative", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              videoPrompt: prompt,
              sceneDescription: cut.sceneDescription,
              animationMode: "cinematic",
              useAI: false, // local mode for speed, no API call
            }),
          });
          if (negRes.ok) {
            const negData = await negRes.json();
            if (negData.negativePrompt) {
              negativePrompt = negData.negativePrompt;
            }
          }
        } catch {
          // Fallback to default negative prompt
        }
      }

      // Enhancement 6: Strengthen negative prompt on retry
      if (retryCount > 0) {
        negativePrompt = strengthenNegativePrompt(negativePrompt || "", retryCount);
      }

      // Enhancement 4: Auto-link storyboard as firstFrame
      // Enhancement 7: Scene continuity auto-chain — use previous scene's last frame
      let firstFrameBase64 = cutNumber === 1 ? cfg.firstFrameBase64 : undefined;
      if (cutNumber > 1 && cfg.autoLinkFirstFrame && prevClip?.videoUri) {
        // Try to capture last frame from previous completed video
        try {
          const lastFrame = await captureVideoLastFrame(prevClip.videoUri);
          if (lastFrame) {
            firstFrameBase64 = lastFrame;
          }
        } catch {
          console.warn(`Failed to capture last frame from CUT ${cutNumber - 1}`);
        }
      }
      // Fallback chain for firstFrame:
      // 1. Previous video's last frame (captured above)
      // 2. Previous cut's END storyboard image (N-1's end = N's start)
      // 3. Current cut's START storyboard image
      if (!firstFrameBase64 && cfg.autoLinkFirstFrame) {
        if (cutNumber > 1 && storyboardEndImages?.[cutNumber - 1]) {
          // Use previous cut's end frame as this cut's start frame
          firstFrameBase64 = storyboardEndImages[cutNumber - 1];
        } else if (storyboardImages?.[cutNumber]) {
          firstFrameBase64 = storyboardImages[cutNumber];
        }
      }

      // Auto-link lastFrame from end storyboard image
      let lastFrameBase64 = cutNumber === 1 ? cfg.lastFrameBase64 : undefined;
      if (!lastFrameBase64 && cfg.autoLinkFirstFrame && storyboardEndImages?.[cutNumber]) {
        lastFrameBase64 = storyboardEndImages[cutNumber];
      }

      // 캐릭터 얼굴 레퍼런스 자동 주입 (Set으로 O(1) 중복 검사)
      const refImageSet = new Set<string>(cfg.referenceImages || []);
      if (faceRefs && faceRefs.length > 0) {
        const charsInScene = cut.charactersInScene || [];
        const relevantFaces = charsInScene.length > 0
          ? faceRefs.filter((ref) => charsInScene.includes(ref.characterId))
          : faceRefs;
        for (const ref of relevantFaces) {
          // base64 유효성 검증 (최소 100자 이상)
          if (ref.faceBase64 && ref.faceBase64.length > 100) {
            refImageSet.add(ref.faceBase64);
          }
        }
      }
      // Veo는 최대 3장 reference image 지원
      const finalRefImages = Array.from(refImageSet).slice(0, 3);

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
        // First Frame (auto-linked from prev cut's end or storyboard)
        firstFrameBase64: firstFrameBase64,
        // Last Frame (auto-linked from end storyboard or manual)
        lastFrameBase64: lastFrameBase64,
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
  }, [cuts, state.clips, state.config, storyboardImages, storyboardEndImages, faceRefs, updateClip, startPolling, verifyPrompt, refinePromptEnglish]);

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
