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
  CutFeedback,
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

// Capture a middle frame for AI review
function captureVideoMiddleFrame(videoUri: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";

    const timeout = setTimeout(() => { video.remove(); resolve(null); }, 10000);

    video.onloadedmetadata = () => {
      video.currentTime = video.duration / 2;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(video, 0, 0);
        const base64 = canvas.toDataURL("image/jpeg", 0.8).replace(/^data:image\/\w+;base64,/, "");
        clearTimeout(timeout);
        video.remove();
        resolve(base64.length > 100 ? base64 : null);
      } catch { clearTimeout(timeout); video.remove(); resolve(null); }
    };

    video.onerror = () => { clearTimeout(timeout); video.remove(); resolve(null); };
    video.src = videoUri;
  });
}

// animationMode → Veo 프롬프트 스타일 프리픽스
const VEO_STYLE_PREFIX: Record<string, string> = {
  "실사": "Photorealistic live-action footage.",
  "2D 애니": "2D anime animation style, clean cel-shaded lines, vibrant flat colors.",
  "수채화 애니": "Watercolor anime painting style, soft translucent washes, hand-painted textures.",
  "하이브리드": "Semi-realistic digital art blending anime and photorealism.",
  "로토스코핑": "Rotoscoped animation style, hand-traced over live action, visible brush strokes.",
  "스톱모션": "Stop-motion claymation style, tactile clay textures, miniature set.",
  "픽셀아트": "Pixel art retro 16-bit game aesthetic, clean pixel edges.",
  "잉크워시": "East Asian ink wash painting style (수묵화/水墨画), black ink on rice paper, minimalist brush strokes, flowing ink gradients, traditional sumi-e aesthetic.",
  "클레이": "Claymation animation, smooth clay figures, soft studio lighting.",
  "빈티지 필름": "Vintage 35mm film look, warm grain, faded colors, 1970s cinema.",
  "네온 사이버펑크": "Neon cyberpunk aesthetic, glowing neon lights, vivid pink/blue/purple palette.",
  "미니어처": "Tilt-shift miniature photography, tiny diorama look, shallow depth of field.",
};

// Style intensity keywords at different levels (animationMode별 분기)
function getStyleSuffix(intensity: number, animationMode?: string): string {
  if (intensity <= 20) return "";

  // animationMode가 실사/cinematic이 아닌 경우 → cinematic 키워드 대신 스타일 강화
  const isNonRealistic = animationMode && !["실사", "cinematic"].includes(animationMode);

  if (isNonRealistic) {
    // 비실사 스타일은 cinematic 키워드가 스타일을 오염시킴 → 스타일 일관성 키워드로 대체
    if (intensity <= 50) return "consistent art style, high detail";
    return "consistent art style throughout, high detail, masterful composition, rich color palette";
  }

  // 실사/cinematic
  if (intensity <= 50) return "cinematic, film grain";
  return "cinematic masterpiece, film grain, depth of field, anamorphic lens, professional color grading, dramatic composition";
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

/**
 * 프롬프트에서 "문서/두루마리/편지/책의 내용을 보여주려는" 텍스트 표현을 제거.
 * 주인공이 뭔가를 읽거나 들고 있는 것은 OK지만, 그 내용물이 화면에 보이지 않도록 함.
 * "scroll reads: ..." / "letter that says ..." / "text on paper showing ..." 등을 치환.
 */
/**
 * 프롬프트에 temporal beats (시간 구조)가 없으면 자동 추가.
 * Veo는 시간 구조가 있을 때 프롬프트를 훨씬 잘 따름.
 */
function ensureTemporalBeats(prompt: string, durationSec: number): string {
  // 이미 temporal beats가 있으면 skip
  if (/\d+s[-–]\d+s/.test(prompt) || /first\s+\d+\s*seconds?/i.test(prompt)) {
    return prompt;
  }

  // "first... then... finally..." 패턴도 OK
  if (/\bfirst\b[\s\S]*\bthen\b[\s\S]*\bfinally\b/i.test(prompt)) {
    return prompt;
  }

  // Temporal beats 추가: 프롬프트의 핵심 내용을 시간대로 분배
  const dur = durationSec || 8;
  const mid = Math.floor(dur * 0.3);   // ~2s
  const mid2 = Math.floor(dur * 0.65); // ~5s

  // 프롬프트를 문장 단위로 분리
  const sentences = prompt.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return prompt;

  // 첫 문장(보통 카메라/캐릭터 설정)은 그대로 두고, 나머지를 시간대에 배치
  const header = sentences[0];
  const rest = sentences.slice(1);

  if (rest.length >= 3) {
    const third = Math.ceil(rest.length / 3);
    const part1 = rest.slice(0, third).join(" ");
    const part2 = rest.slice(third, third * 2).join(" ");
    const part3 = rest.slice(third * 2).join(" ");
    return `${header} 0s-${mid}s: ${part1} ${mid}s-${mid2}s: ${part2} ${mid2}s-${dur}s: ${part3}`;
  }

  // 2문장이면 2-beat 구조
  return `${header} 0s-${mid2}s: ${rest[0]} ${mid2}s-${dur}s: ${rest.slice(1).join(" ") || rest[0]}`;
}

function sanitizeTextContent(prompt: string): string {
  // 문서 내용을 직접 보여주려는 패턴 제거
  let sanitized = prompt
    // "scroll/letter/paper/book reads: ..." or "that reads ..."
    .replace(/\b(that\s+)?(reads?|saying|says|written|writes?|displaying|shows?)\s*[:"]?\s*["']?[^.,"']{3,}["']?/gi, "")
    // "with text: ..." / "with the words ..." / "with inscription ..."
    .replace(/\bwith\s+(the\s+)?(text|words?|inscription|message|content|writing|characters?|letters?|script)\s*[:"]?\s*["']?[^.,"']{3,}["']?/gi, "")
    // "containing text ..." / "bearing text ..."
    .replace(/\b(containing|bearing|carrying|featuring|displaying)\s+(text|words?|inscription|writing|characters?|script)\s*[:"]?\s*["']?[^.,"']{3,}["']?/gi, "")
    // "text visible: ..." / "readable text ..."
    .replace(/\b(visible|readable|legible|clear)\s+(text|writing|characters?|script|inscription)\s*[:"]?\s*["']?[^.,"']{3,}["']?/gi, "")
    // "calligraphy/kanji/hangul/Chinese characters reading ..."
    .replace(/\b(calligraphy|kanji|hangul|chinese characters?|japanese characters?|korean text|hanzi)\s*(reading|saying|that|of|:)\s*["']?[^.,"']{3,}["']?/gi, (match) => {
      // 서예/한자 자체는 유지하되 내용만 제거
      return match.split(/reading|saying|that|of|:/i)[0].trim();
    });

  // 연속 공백/쉼표 정리
  sanitized = sanitized
    .replace(/,\s*,/g, ",")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();

  // 프롬프트 끝에 텍스트 금지 보강 (이미 있으면 skip, 최소한으로)
  if (!/no text overlay/i.test(sanitized) && !/no text[,.]?\s*no watermark/i.test(sanitized)) {
    sanitized += ". No text overlay, no watermark";
  }

  return sanitized;
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
  const updateConfig = useCallback((config: Partial<VeoGenerationConfig>) => {
    setState((prev) => ({ ...prev, config: { ...prev.config, ...config } }));
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
      const cfg = state.config;
      const prevCut = cuts.find((c) => c.cutNumber === cut.cutNumber - 1);
      const res = await fetch("/api/refine-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoPrompt: cut.videoPrompt,
          extendPrompt: cut.extendPrompt,
          cutNumber: cut.cutNumber,
          mode: "english-native",
          sceneDescription: cut.sceneDescription,
          negativePrompt: cfg.negativePrompt,
          durationSeconds: cfg.durationSeconds,
          previousCutPrompt: prevCut?.videoPrompt || "",
        }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn("English refinement failed:", err);
    }
    return null;
  }, [state.config, cuts]);

  // 폴링 시작
  const startPolling = useCallback((cutNumber: number, operationName: string) => {
    const poll = async () => {
      try {
        const res = await fetch("/api/check-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operationName }),
        });

        if (!res.ok) {
          // 403 등 HTTP 에러 → 폴링 중단
          updateClip(cutNumber, {
            status: "failed",
            error: `API 오류 (${res.status})`,
          });
          pollTimers.current.delete(cutNumber);
          if (autoModeRef.current) {
            autoModeRef.current = false;
            setState((prev) => ({ ...prev, isAutoMode: false }));
          }
          return;
        }

        const data = await res.json();

        if (data.status === "COMPLETED") {
          // videoUri가 없으면 실패 처리
          const finalUri = data.variants?.[0]?.videoUri || data.videoUri;
          if (!finalUri) {
            updateClip(cutNumber, {
              status: "failed",
              error: "영상 생성 완료되었으나 비디오 URL이 없습니다",
            });
            pollTimers.current.delete(cutNumber);
            return;
          }

          const clipUpdate: Partial<VideoClip> = {
            status: "completed",
            videoUri: data.videoUri,
            rawVideoUri: data.rawVideoUri,
            seed: data.seed || undefined,
            completedAt: Date.now(),
          };

          // 다중 변형 처리
          if (data.variants && data.variants.length > 0) {
            clipUpdate.variants = data.variants as VideoVariant[];
            clipUpdate.selectedVariant = 0;
            clipUpdate.videoUri = data.variants[0].videoUri;
            clipUpdate.rawVideoUri = data.variants[0].rawVideoUri;
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

          // 자동 모드: 모든 클립이 완료/실패이면 자동 모드 종료
          if (autoModeRef.current) {
            setState((prev) => {
              const allDone = prev.clips.every(
                (c) => c.status === "completed" || c.status === "failed"
              );
              if (allDone) {
                autoModeRef.current = false;
                return { ...prev, isAutoMode: false, currentAutoIndex: -1 };
              }
              return prev;
            });
          }
          return;
        }

        if (data.status === "FAILED") {
          console.error(`[CUT ${cutNumber}] Veo 생성 실패:`, data.error || "unknown error", data);
          // Enhancement 6: Auto-retry on failure
          setState((prev) => {
            const clip = prev.clips.find((c) => c.cutNumber === cutNumber);
            const retryCount = clip?.retryCount || 0;
            const cfg = prev.config;

            if (cfg.autoRetryOnFailure && retryCount < cfg.maxRetryCount) {
              console.warn(`[CUT ${cutNumber}] 자동 재시도 ${retryCount + 1}/${cfg.maxRetryCount}`);
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

            // 모든 클립이 완료/실패이면 자동 모드 종료
            const allDone = newClips.every(
              (c) => c.status === "completed" || c.status === "failed"
            );
            if (allDone && autoModeRef.current) {
              autoModeRef.current = false;
              return { ...prev, clips: newClips, isAutoMode: false, currentAutoIndex: -1 };
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
      // Enhancement 8: Smart negative prompt auto-generation (do BEFORE refinement so it can be embedded)
      let negativePrompt = cfg.negativePrompt;
      if (retryCount === 0) {
        try {
          const negRes = await fetch("/api/auto-negative", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              videoPrompt: prompt,
              sceneDescription: cut.sceneDescription,
              animationMode: cfg.animationMode || "cinematic",
              useAI: false,
            }),
          });
          if (negRes.ok) {
            const negData = await negRes.json();
            if (negData.negativePrompt) {
              negativePrompt = negData.negativePrompt;
            }
          }
        } catch { /* Fallback to default */ }
      }

      // Enhancement 6: Strengthen negative prompt on retry
      if (retryCount > 0) {
        negativePrompt = strengthenNegativePrompt(negativePrompt || "", retryCount);
      }

      // Enhancement 1 & 3: Auto verify and refine prompts (only on first attempt)
      if (retryCount === 0) {
        // 이전 컷 프롬프트 (연속성)
        const prevCut = cuts.find((c) => c.cutNumber === cutNumber - 1);

        // Enhancement 3: English native correction + temporal structure + negative embedding
        if (cfg.autoEnglishRefine) {
          try {
            const refRes = await fetch("/api/refine-prompt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                videoPrompt: prompt,
                extendPrompt: cutNumber > 1 ? cut.extendPrompt : undefined,
                cutNumber,
                mode: "english-native",
                sceneDescription: cut.sceneDescription,
                negativePrompt,
                durationSeconds: cfg.durationSeconds,
                previousCutPrompt: prevCut?.videoPrompt || "",
              }),
            });
            if (refRes.ok) {
              const refined = await refRes.json();
              if (refined?.refinedVideoPrompt) {
                prompt = cutNumber === 1
                  ? refined.refinedVideoPrompt
                  : (refined.refinedExtendPrompt || prompt);
              }
            }
          } catch (err) {
            console.warn("English refinement failed:", err);
          }
        }

        // Enhancement 1: Verify prompt quality
        if (cfg.autoVerifyPrompts) {
          const verification = await verifyPrompt(cut);
          if (verification) {
            updateClip(cutNumber, { verification });

            if (verification.overallScore < 80 && verification.improvedVideoPrompt) {
              // 개선된 프롬프트로 교체
              prompt = cutNumber === 1
                ? verification.improvedVideoPrompt
                : (verification.improvedExtendPrompt || prompt);
            }

            // 점수 30 미만 + 개선 프롬프트도 없으면 → Veo 호출 차단 (quota 낭비 방지)
            if (verification.overallScore < 30 && !verification.improvedVideoPrompt) {
              const issues = verification.issues?.join(", ") || "프롬프트 품질 부족";
              updateClip(cutNumber, {
                status: "failed",
                error: `프롬프트 품질 점수 ${verification.overallScore}/100 — 생성 차단. 문제: ${issues}. 프롬프트를 수정 후 다시 시도하세요.`,
              });
              return;
            }
          }
        }
      }

      // animationMode 스타일 프리픽스 삽입 (프롬프트 맨 앞에 배치 → Veo가 스타일을 가장 먼저 인식)
      const stylePrefix = cfg.animationMode ? VEO_STYLE_PREFIX[cfg.animationMode] : undefined;
      if (stylePrefix && !prompt.includes(stylePrefix.split(",")[0].trim())) {
        prompt = `${stylePrefix} ${prompt}`;
      }

      // Enhancement 5: Apply style intensity (animationMode에 따라 적절한 키워드 사용)
      const styleSuffix = getStyleSuffix(cfg.styleIntensity, cfg.animationMode);
      if (styleSuffix && !prompt.includes(styleSuffix.split(",")[0])) {
        prompt = `${prompt}. ${styleSuffix}`;
      }

      // Temporal beats: refine-prompt가 이미 삽입했으면 skip
      prompt = ensureTemporalBeats(prompt, cfg.durationSeconds);

      // 프롬프트에서 문서/편지/두루마리 내용 텍스트 제거 (금지 문구는 중복 방지)
      prompt = sanitizeTextContent(prompt);

      // Veo는 negativePrompt 파라미터를 지원하지 않으므로 프롬프트에 직접 삽입
      // refine-prompt가 이미 "no X, no Y"를 포함했으면 Avoid: 블록 생략
      if (negativePrompt && !prompt.includes("Avoid:") && !/\bno text[,.]?\s*no watermark\b/i.test(prompt)) {
        const negItems = negativePrompt.split(",").map(s => s.trim()).filter(Boolean).slice(0, 3);
        prompt = `${prompt}. Avoid: ${negItems.join(", ")}`;
      }

      // 최종 프롬프트 길이 제한: Veo 최적 280단어, 초과 시 끝부분 잘라냄
      const words = prompt.split(/\s+/);
      if (words.length > 300) {
        // 핵심 내용(앞부분)을 보존하고, 부가 지시(뒷부분)를 축소
        prompt = words.slice(0, 280).join(" ") + ". No text overlay, no watermark.";
      }

      // 사용자가 선택한 모드 그대로 사용 (fast 선택 시 무조건 fast)

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
        mode: cfg.mode,
        durationSeconds: cfg.durationSeconds,
        resolution: cfg.resolution,
        aspectRatio: cfg.aspectRatio,
        generateAudio: cfg.generateAudio,
        negativePrompt: negativePrompt || undefined,
        personGeneration: cfg.personGeneration,
        sampleCount: cfg.sampleCount,
        seed: cfg.seed,
        // Scene Extension — Veo 원본 URI 사용 (프록시 URL은 Veo가 인식 못함)
        previousVideoUri: cutNumber > 1 ? prevClip?.rawVideoUri : undefined,
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
        const errMsg = errData.error || `HTTP ${res.status}`;
        console.error(`CUT ${cutNumber} 영상 생성 실패:`, errMsg, errData.details || "", errData.warning || "");
        updateClip(cutNumber, {
          status: "failed",
          error: errMsg,
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
  }, [cuts, state.clips, state.config, storyboardImages, storyboardEndImages, faceRefs, updateClip, startPolling, verifyPrompt]);

  // 자동 모드 (병렬 생성) — idle인 모든 클립을 동시에 시작
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (!state.isAutoMode) {
      autoTriggeredRef.current = false;
      return;
    }
    if (autoTriggeredRef.current) return; // 이미 트리거됨
    const idleClips = state.clips.filter((c) => c.status === "idle");
    if (idleClips.length === 0) return;
    autoTriggeredRef.current = true;
    idleClips.forEach((clip) => generateCut(clip.cutNumber));
  }, [state.isAutoMode, state.clips, generateCut]);

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

  // ===== 브라우저 알림 =====
  const sendNotification = useCallback((title: string, body: string) => {
    // 브라우저 Notification API
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(title, { body, icon: "/favicon.ico" });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((perm) => {
          if (perm === "granted") new Notification(title, { body, icon: "/favicon.ico" });
        });
      }
    }
    // 오디오 알림 (짧은 비프)
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 1320;
        gain2.gain.value = 0.3;
        osc2.start();
        osc2.stop(ctx.currentTime + 0.2);
      }, 200);
    } catch { /* audio not available */ }
  }, []);

  // ===== AI 전체 리뷰 =====
  const reviewAllClips = useCallback(async () => {
    const completed = state.clips.filter((c) => c.status === "completed" && c.videoUri);
    if (completed.length === 0) return;

    setState((prev) => ({
      ...prev,
      review: {
        overallScore: 0,
        overallComment: "",
        cutFeedbacks: [],
        status: "reviewing",
        regeneratedCuts: [],
      },
    }));

    try {
      // 각 클립에서 중간 프레임 캡처
      const cutInputs: { cutNumber: number; frameBase64: string; videoPrompt: string; sceneDescription: string }[] = [];
      for (const clip of completed) {
        const cut = cuts.find((c) => c.cutNumber === clip.cutNumber);
        let frame: string | null = null;
        try {
          frame = await captureVideoMiddleFrame(clip.videoUri!);
        } catch { /* skip */ }
        cutInputs.push({
          cutNumber: clip.cutNumber,
          frameBase64: frame || "",
          videoPrompt: cut?.videoPrompt || "",
          sceneDescription: cut?.sceneDescription || "",
        });
      }

      const res = await fetch("/api/review-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuts: cutInputs, totalCuts: totalCount }),
      });

      if (!res.ok) throw new Error(`Review API ${res.status}`);
      const data = await res.json() as {
        overallScore: number;
        overallComment: string;
        cutFeedbacks: CutFeedback[];
      };

      setState((prev) => ({
        ...prev,
        review: {
          overallScore: data.overallScore || 50,
          overallComment: data.overallComment || "리뷰 완료",
          cutFeedbacks: data.cutFeedbacks || [],
          status: "done",
          regeneratedCuts: [],
        },
      }));
    } catch (err) {
      console.error("Review failed:", err);
      setState((prev) => ({
        ...prev,
        review: {
          overallScore: 0,
          overallComment: "리뷰 실패 — 수동으로 확인해주세요",
          cutFeedbacks: [],
          status: "done",
          regeneratedCuts: [],
        },
      }));
    }
  }, [state.clips, cuts, totalCount]);

  // ===== 피드백 기반 재생성 =====
  const regenerateFromFeedback = useCallback(async (cutNumber: number, improvedPrompt?: string) => {
    // 피드백의 개선된 프롬프트로 업데이트 후 재생성
    if (improvedPrompt) {
      const cut = cuts.find((c) => c.cutNumber === cutNumber);
      if (cut) {
        // 프롬프트를 직접 업데이트 (부모 컴포넌트에서 관리하므로 videoPrompt만 활용)
        cut.videoPrompt = improvedPrompt;
      }
    }

    setState((prev) => ({
      ...prev,
      review: prev.review ? { ...prev.review, status: "regenerating" } : undefined,
    }));

    // 클립 리셋 후 재생성
    resetClip(cutNumber);
    // 짧은 딜레이 후 생성 시작 (상태 업데이트 반영 대기)
    setTimeout(() => generateCut(cutNumber), 300);
  }, [cuts, resetClip, generateCut]);

  // ===== 피드백 기반 전체 재생성 (needsRegeneration인 컷만) =====
  const regenerateAllFromFeedback = useCallback(async () => {
    if (!state.review?.cutFeedbacks) return;

    const toRegenerate = state.review.cutFeedbacks
      .filter((f) => f.needsRegeneration)
      .map((f) => f.cutNumber);

    if (toRegenerate.length === 0) return;

    setState((prev) => ({
      ...prev,
      review: prev.review ? { ...prev.review, status: "regenerating", regeneratedCuts: [] } : undefined,
    }));

    // 순차적으로 재생성 (Scene Extension 의존 때문)
    for (const cutNum of toRegenerate) {
      const feedback = state.review.cutFeedbacks.find((f) => f.cutNumber === cutNum);
      if (feedback?.improvedPrompt) {
        const cut = cuts.find((c) => c.cutNumber === cutNum);
        if (cut) cut.videoPrompt = feedback.improvedPrompt;
      }
      resetClip(cutNum);
    }

    // 첫 번째 컷 생성 시작 (나머지는 autoMode로)
    autoModeRef.current = true;
    const firstIdx = state.clips.findIndex((c) => toRegenerate.includes(c.cutNumber));
    setState((prev) => ({
      ...prev,
      isAutoMode: true,
      currentAutoIndex: firstIdx >= 0 ? firstIdx : 0,
    }));
  }, [state.review, state.clips, cuts, resetClip]);

  // ===== 전체 완료 감지 → 자동 리뷰 + 알림 =====
  const prevCompletedRef = useRef(0);
  useEffect(() => {
    if (totalCount > 0 && completedCount === totalCount && prevCompletedRef.current < totalCount) {
      prevCompletedRef.current = completedCount;

      // 리뷰가 재생성 중이면 → 재생성 완료 알림
      if (state.review?.status === "regenerating") {
        setState((prev) => ({
          ...prev,
          review: prev.review ? { ...prev.review, status: "complete" } : undefined,
        }));
        sendNotification(
          "재생성 완료!",
          "AI 피드백 기반 재생성이 완료되었습니다. 결과를 확인하세요."
        );
        return;
      }

      // 첫 완료 → 자동 리뷰 시작
      if (!state.review || state.review.status === "idle") {
        sendNotification(
          "전체 영상 생성 완료!",
          `${totalCount}개 컷 생성 완료. AI 리뷰를 시작합니다...`
        );
        reviewAllClips();
      }
    }
    // completedCount가 줄었으면 (재생성 중) ref 업데이트
    if (completedCount < prevCompletedRef.current) {
      prevCompletedRef.current = completedCount;
    }
  }, [completedCount, totalCount, state.review, reviewAllClips, sendNotification]);

  // 알림 권한 미리 요청
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const dismissReview = useCallback(() => {
    setState((prev) => ({ ...prev, review: undefined }));
  }, []);

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
    reviewAllClips,
    regenerateFromFeedback,
    regenerateAllFromFeedback,
    dismissReview,
    completedCount,
    totalCount,
    progress,
  };
}
