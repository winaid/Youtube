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
const POLL_MAX_ATTEMPTS = 72; // 최대 6분 (5s * 72)
const POLL_BACKOFF = [5000, 7500, 10000, 15000, 20000]; // 에러 시 백오프

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    // data: URI는 CORS origin이 null → crossOrigin="anonymous" 설정 시 canvas tainted → toDataURL 실패
    // 프록시 URL (동일 출처) 및 gs://, https:// 는 crossOrigin 설정 필요
    if (!videoUri.startsWith("data:")) {
      video.crossOrigin = "anonymous";
    }
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
    if (!videoUri.startsWith("data:")) {
      video.crossOrigin = "anonymous";
    }
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
  // 동일 cutNumber에 대한 중복 폴링 방지
  const activePolls = useRef<Set<number>>(new Set());
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
    const polls = activePolls.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      polls.clear();
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

  // 폴링 시작 — for-loop + sleep 방식, 중복 실행 방지
  const startPolling = useCallback(async (
    cutNumber: number,
    operationName: string,
    engine: "veo" | "kling" = "veo",
    taskId?: string,
    isExtend?: boolean,
  ) => {
    // ── 중복 폴링 방지: 이미 폴링 중이면 즉시 리턴
    if (activePolls.current.has(cutNumber)) {
      console.warn(`[CUT ${cutNumber}] 이미 폴링 중 — 중복 startPolling 무시`);
      return;
    }
    activePolls.current.add(cutNumber);

    // 기존 timer 정리
    const prevTimer = pollTimers.current.get(cutNumber);
    if (prevTimer) {
      clearTimeout(prevTimer);
      pollTimers.current.delete(cutNumber);
    }

    updateClip(cutNumber, { status: "polling" });

    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3;

    try {
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        // 첫 시도는 즉시, 이후엔 대기
        if (attempt > 0) {
          const waitMs = consecutiveErrors > 0
            ? POLL_BACKOFF[Math.min(consecutiveErrors - 1, POLL_BACKOFF.length - 1)]
            : POLL_INTERVAL;
          await sleep(waitMs);
        }

        // ── HTTP 요청
        let res: Response;
        try {
          res = await fetch("/api/check-video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              operationName,
              engine,
              taskId: taskId ?? operationName,
              isExtend: isExtend ?? false,
            }),
          });
        } catch (networkErr) {
          consecutiveErrors++;
          console.warn(`[CUT ${cutNumber}] 네트워크 에러 (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, networkErr);
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            updateClip(cutNumber, { status: "failed", error: "네트워크 연결 실패 — 인터넷 연결을 확인하세요" });
            return;
          }
          continue;
        }

        // ── HTTP 상태 처리
        if (!res.ok) {
          // 4xx: 클라이언트 문제 → 즉시 중단
          if (res.status >= 400 && res.status < 500) {
            const errText = await res.text().catch(() => "");
            console.error(`[CUT ${cutNumber}] check-video 클라이언트 에러 ${res.status}:`, errText.slice(0, 300));
            updateClip(cutNumber, { status: "failed", error: `폴링 오류 (${res.status}) — 요청이 잘못되었습니다` });
            return;
          }
          // 5xx: 서버 transient 에러 → 최대 3회 재시도
          consecutiveErrors++;
          console.warn(`[CUT ${cutNumber}] check-video 서버 에러 ${res.status} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            updateClip(cutNumber, { status: "failed", error: `서버 오류 (${res.status}) — 잠시 후 다시 시도하세요` });
            return;
          }
          continue;
        }

        // ── JSON 파싱 (실패해도 재시도)
        let data: { status?: string; error?: string; videoUri?: string; rawVideoUri?: string; seed?: string; variants?: VideoVariant[] };
        try {
          data = await res.json();
        } catch (parseErr) {
          consecutiveErrors++;
          console.warn(`[CUT ${cutNumber}] 응답 JSON 파싱 실패 (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, parseErr);
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            updateClip(cutNumber, { status: "failed", error: "서버 응답 파싱 실패" });
            return;
          }
          continue;
        }

        consecutiveErrors = 0; // 성공 시 리셋

        // ── 상태별 처리
        // data.status가 없는데 data.error가 있으면 → 즉시 실패 (대기 루프 방지)
        if (!data.status && data.error) {
          console.error(`[CUT ${cutNumber}] status 없이 error 수신:`, data.error);
          updateClip(cutNumber, { status: "failed", error: String(data.error) });
          return;
        }

        if (data.status === "PENDING" || data.status === "RUNNING" || !data.status) {
          // 아직 처리 중 → 다음 루프
          continue;
        }

        if (data.status === "COMPLETED") {
          const finalUri = data.variants?.[0]?.videoUri || data.videoUri;
          if (!finalUri) {
            updateClip(cutNumber, { status: "failed", error: "영상 생성 완료되었으나 비디오 URL이 없습니다" });
            return;
          }

          const clipUpdate: Partial<VideoClip> = {
            status: "completed",
            videoUri: data.videoUri,
            rawVideoUri: data.rawVideoUri,
            seed: data.seed || undefined,
            completedAt: Date.now(),
          };

          if (data.variants && data.variants.length > 0) {
            clipUpdate.variants = data.variants as VideoVariant[];
            clipUpdate.selectedVariant = 0;
            clipUpdate.videoUri = data.variants[0].videoUri;
            clipUpdate.rawVideoUri = data.variants[0].rawVideoUri;
            clipUpdate.seed = data.variants[0].seed;
          }

          updateClip(cutNumber, clipUpdate);

          // ── 완료 후 진단 로그 ───────────────────────────────────────────────
          {
            const ruri = clipUpdate.rawVideoUri ?? "";
            const ruriType = ruri.startsWith("gs://") ? "GCS ✓"
              : ruri.startsWith("https://") ? "HTTPS ✓"
              : ruri === "" ? "EMPTY(base64) ✗"
              : "DATA_URI ✗";
            const willExtend = ruri.length > 0 && !ruri.startsWith("data:");
            console.log(`[CUT ${cutNumber}] COMPLETED`, {
              sourceCutId: cutNumber,
              parentCutId: cutNumber - 1,
              rawVideoUri: ruri ? `${ruri.slice(0, 80)}…` : "(empty)",
              rawVideoUriType: ruriType,
              nextCutWillExtend: willExtend ? "✓ Scene Extension 가능" : "✗ Scene Extension 불가 → image/text fallback",
              seed: clipUpdate.seed,
            });
            if (!willExtend) {
              console.warn(
                `[CUT ${cutNumber}] rawVideoUri가 유효한 GCS/HTTPS URI가 아님 → CUT ${cutNumber + 1}은 SCENE_EXTENSION 없이 생성됨.`,
                `rawVideoUri="${ruri.slice(0, 60)}"`
              );
            }
          }

          if (data.seed && onSeedDetected) {
            onSeedDetected(cutNumber, data.seed);
          }

          // 마지막 프레임 캡처 — (a) 다음 컷 continuity 저장, (b) 품질 검증
          if (clipUpdate.videoUri) {
            try {
              const lastFrame = await captureVideoLastFrame(clipUpdate.videoUri);
              if (lastFrame) {
                // (a) 다음 컷 Scene Extension / image-to-video fallback용으로 저장
                updateClip(cutNumber, { lastFrameBase64: lastFrame });
                console.log(`[CUT ${cutNumber}] lastFrame 저장 완료 — 다음 컷 continuity 준비됨`);

                // (b) 품질 검증 (fire-and-forget, 선택적)
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

          // 자동 모드: 완료 여부만 체크, 다음 컷 트리거는 autoMode useEffect가 담당
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
          return; // 완료 → 루프 종료
        }

        if (data.status === "FAILED") {
          console.error(`[CUT ${cutNumber}] Veo 생성 실패:`, data.error || "unknown error");
          // Enhancement 6: Auto-retry on failure
          setState((prev) => {
            const clip = prev.clips.find((c) => c.cutNumber === cutNumber);
            const retryCount = clip?.retryCount || 0;
            const cfg = prev.config;

            if (cfg.autoRetryOnFailure && retryCount < cfg.maxRetryCount) {
              console.warn(`[CUT ${cutNumber}] 자동 재시도 ${retryCount + 1}/${cfg.maxRetryCount}`);
              return {
                ...prev,
                clips: prev.clips.map((c) =>
                  c.cutNumber === cutNumber
                    ? { ...c, status: "idle" as VideoGenStatus, retryCount: retryCount + 1, error: `재시도 ${retryCount + 1}/${cfg.maxRetryCount}...` }
                    : c
                ),
              };
            }

            const newClips = prev.clips.map((c) =>
              c.cutNumber === cutNumber
                ? { ...c, status: "failed" as VideoGenStatus, error: data.error || "생성 실패" }
                : c
            );

            const allDone = newClips.every(
              (c) => c.status === "completed" || c.status === "failed"
            );
            if (allDone && autoModeRef.current) {
              autoModeRef.current = false;
              return { ...prev, clips: newClips, isAutoMode: false, currentAutoIndex: -1 };
            }
            return { ...prev, clips: newClips };
          });
          return; // 실패 → 루프 종료
        }

        // 알 수 없는 상태 → 계속 폴링
        console.warn(`[CUT ${cutNumber}] 알 수 없는 status: ${data.status} — 계속 대기`);
      }

      // 최대 시도 횟수 초과
      console.error(`[CUT ${cutNumber}] 최대 폴링 횟수(${POLL_MAX_ATTEMPTS}) 초과`);
      updateClip(cutNumber, { status: "failed", error: `영상 생성 타임아웃 (${Math.round(POLL_MAX_ATTEMPTS * POLL_INTERVAL / 60000)}분 초과)` });
    } finally {
      // 폴링 완료 시 반드시 activePolls에서 제거
      activePolls.current.delete(cutNumber);
      pollTimers.current.delete(cutNumber);
    }
  }, [updateClip, onSeedDetected, cuts]);

  // Auto-retry effect: when a clip becomes "idle" with retryCount > 0, auto-generate
  useEffect(() => {
    const clipToRetry = state.clips.find(
      (c) => c.status === "idle" && c.retryCount && c.retryCount > 0
        && !activePolls.current.has(c.cutNumber) // 이미 폴링 중인 컷 제외
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
    // extendPrompt가 "" 이면 videoPrompt를 fallback으로 사용 (generate-cuts 파싱 실패 대비)
    // CUT 2+에서 extendPrompt=""이면 모든 컷이 동일한 generic 프롬프트로 생성되는 버그 방지
    let prompt: string;
    if (cutNumber === 1) {
      prompt = cut.videoPrompt;
    } else if (cut.extendPrompt && cut.extendPrompt.trim().length > 0) {
      prompt = cut.extendPrompt;
    } else {
      // extendPrompt 누락 → videoPrompt를 extend 맥락으로 재활용 + 경고
      console.warn(`[CUT ${cutNumber}] extendPrompt 없음(빈 문자열) — videoPrompt 사용. 장면 연속성이 약해질 수 있음.`);
      prompt = cut.videoPrompt;
    }
    const clip = state.clips.find((c) => c.cutNumber === cutNumber);
    const retryCount = clip?.retryCount || 0;

    // CUT N>1: 이전 컷 시각 상태를 프롬프트에 주입 (Scene Extension fallback 시 보조)
    // veo-3.1-fast-generate-001은 Scene Extension + image-to-video 모두 지원
    if (cutNumber > 1) {
      const prevCutData = cuts.find((c) => c.cutNumber === cutNumber - 1);
      if (prevCutData && !prompt.toLowerCase().startsWith("continuing")) {
        const ctx: string[] = [];
        if (prevCutData.characterConsistency) ctx.push(prevCutData.characterConsistency);
        if (prevCutData.moodLighting) ctx.push(prevCutData.moodLighting);
        if (prevCutData.cameraDirection) ctx.push(prevCutData.cameraDirection);
        if (ctx.length > 0) {
          // 앞에 붙여서 Veo가 가장 먼저 인식하도록
          prompt = `[Continuing from previous shot — ${ctx.slice(0, 2).join("; ")}] ${prompt}`;
        }
      }
    }

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
            // ⚠️ scoringFailure=true(채점 API 파싱 실패)는 절대 차단하지 않음
            //    "채점 실패"와 "프롬프트 품질 0점"은 완전히 다른 상태임
            if (
              !verification.scoringFailure &&
              verification.overallScore < 30 &&
              !verification.improvedVideoPrompt
            ) {
              const issues = verification.issues?.join(", ") || "프롬프트 품질 부족";
              updateClip(cutNumber, {
                status: "failed",
                error: `프롬프트 품질 점수 ${verification.overallScore}/100 — 생성 차단. 문제: ${issues}. 프롬프트를 수정 후 다시 시도하세요.`,
              });
              return;
            }
            if (verification.scoringFailure) {
              console.warn(`[CUT ${cutNumber}] 품질 채점 불가 (scoringFailure) — 생성 계속 진행`);
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

      // ── Continuity firstFrame 취득 (우선순위 순)
      // CUT 1: 사용자 설정값 / CUT N>1: 이전 컷과의 연결 필수
      let firstFrameBase64 = cutNumber === 1 ? cfg.firstFrameBase64 : undefined;

      if (cutNumber > 1 && prevClip) {
        // 1순위: 완료 시 저장된 lastFrameBase64 (재캡처 없이 즉시 사용)
        if (prevClip.lastFrameBase64) {
          firstFrameBase64 = prevClip.lastFrameBase64;
          console.log(`[CUT ${cutNumber}] continuity: 저장된 lastFrame 사용 (CUT ${cutNumber - 1})`);
        } else if (prevClip.videoUri) {
          // 2순위: 이전 컷 비디오에서 직접 캡처
          try {
            const captured = await captureVideoLastFrame(prevClip.videoUri);
            if (captured) {
              firstFrameBase64 = captured;
              // 이후 재사용을 위해 저장
              updateClip(cutNumber - 1, { lastFrameBase64: captured });
              console.log(`[CUT ${cutNumber}] continuity: lastFrame 캡처 성공 (CUT ${cutNumber - 1})`);
            } else {
              console.warn(`[CUT ${cutNumber}] continuity: captureVideoLastFrame null 반환 — storyboard fallback`);
            }
          } catch {
            console.warn(`[CUT ${cutNumber}] continuity: lastFrame 캡처 실패 — storyboard fallback`);
          }
        }

        // 3순위: 이전 컷의 END 스토리보드
        if (!firstFrameBase64 && storyboardEndImages?.[cutNumber - 1]) {
          firstFrameBase64 = storyboardEndImages[cutNumber - 1];
          console.log(`[CUT ${cutNumber}] continuity: storyboard end image 사용 (CUT ${cutNumber - 1})`);
        }

        // 4순위: 현재 컷의 START 스토리보드
        if (!firstFrameBase64 && storyboardImages?.[cutNumber]) {
          firstFrameBase64 = storyboardImages[cutNumber];
          console.log(`[CUT ${cutNumber}] continuity: storyboard start image 사용 (CUT ${cutNumber})`);
        }

        if (!firstFrameBase64) {
          console.warn(`[CUT ${cutNumber}] continuity: firstFrame 없음 — text-to-video로 생성 (프롬프트에 연속성 포함)`);
        }
      } else if (cutNumber === 1 && !firstFrameBase64 && storyboardImages?.[1]) {
        firstFrameBase64 = storyboardImages[1];
      }

      // Auto-link lastFrame from end storyboard image
      let lastFrameBase64 = cutNumber === 1 ? cfg.lastFrameBase64 : undefined;
      if (!lastFrameBase64 && storyboardEndImages?.[cutNumber]) {
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

      // Scene Extension URI 결정:
      // rawVideoUri가 data: URI(base64 인라인)이면 Scene Extension 불가 + 수 MB 요청 낭비 → 제거
      const rawPrevUri = cutNumber > 1 ? prevClip?.rawVideoUri : undefined;
      const previousVideoUri =
        rawPrevUri && !rawPrevUri.startsWith("data:") && rawPrevUri.length > 0
          ? rawPrevUri
          : undefined;

      // ── 요청 직전 진단 로그 ─────────────────────────────────────────────────
      // mode: 실제 어떤 방식으로 생성하는지 명시
      const requestMode = previousVideoUri
        ? "SCENE_EXTENSION"
        : firstFrameBase64
          ? "IMAGE_TO_VIDEO"
          : "TEXT_TO_VIDEO";

      if (cutNumber > 1 && requestMode === "TEXT_TO_VIDEO") {
        // Scene Extension도 image-to-video도 없으면 이전 컷과 무관한 독립 생성 → 연속성 없음
        console.warn(
          `[CUT ${cutNumber}] ⚠️ TEXT_TO_VIDEO — 이전 컷과 연결 없음.`,
          {
            prevClipExists: !!prevClip,
            prevClipStatus: prevClip?.status,
            rawVideoUri: rawPrevUri ? `${rawPrevUri.slice(0, 60)}…` : "(없음)",
            rawVideoUriType: rawPrevUri
              ? (rawPrevUri.startsWith("gs://") ? "GCS ✓" : rawPrevUri.startsWith("https://") ? "HTTPS ✓" : rawPrevUri === "" ? "EMPTY (base64 응답) ✗" : "DATA_URI ✗")
              : "(없음)",
            firstFrameBase64: firstFrameBase64 ? `(${firstFrameBase64.length}자)` : "(없음)",
          }
        );
      }

      console.log(`[CUT ${cutNumber}] API 요청`, {
        cutNumber,
        sourceCutId: cutNumber,
        parentCutId: cutNumber > 1 ? cutNumber - 1 : null,
        mode: requestMode,
        previousVideoUri: previousVideoUri ? `${previousVideoUri.slice(0, 60)}…` : null,
        hasFirstFrame: !!firstFrameBase64,
        hasLastFrame: !!lastFrameBase64,
        promptMode: cutNumber === 1 ? "videoPrompt" : (cut.extendPrompt?.trim() ? "extendPrompt" : "videoPrompt(fallback)"),
        promptLen: prompt.length,
        promptPrefix: prompt.slice(0, 120),
        model: "veo-3.1-fast-generate-001",
      });

      // ── 엔진 & 모드 결정 ─────────────────────────────────────────────────
      const engine    = cfg.engine    ?? "veo";
      const videoMode = cfg.videoMode ?? "extend";

      // Kling extend: sourceVideo = 이전 클립의 rawVideoUri (Kling video_id)
      // Veo extend:   previousVideoUri = 이전 클립의 gs:// URI (기존 로직 유지)
      const sourceVideo = (videoMode === "extend" && cutNumber > 1)
        ? (prevClip?.rawVideoUri ?? "")
        : "";

      const body: Record<string, unknown> = {
        prompt,
        cutNumber,
        engine,
        videoMode,
        sourceVideo: sourceVideo || undefined,
        mode: cfg.mode,
        durationSeconds: cfg.durationSeconds,
        resolution: cfg.resolution,
        aspectRatio: cfg.aspectRatio,
        generateAudio: cfg.generateAudio,
        negativePrompt: negativePrompt || undefined,
        personGeneration: cfg.personGeneration,
        sampleCount: cfg.sampleCount,
        seed: cfg.seed,
        // Scene Extension (Veo) — gs:// 또는 https:// URI만
        previousVideoUri,
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

        // Safety filter 에러 → Gemini로 프롬프트 sanitize 후 1회 재시도
        const isSafetyError =
          errMsg.includes("usage guidelines") ||
          errMsg.includes("could not be submitted") ||
          errData.raiFiltered === true;

        if (isSafetyError && retryCount === 0) {
          console.warn(`[CUT ${cutNumber}] Safety 에러 감지 → 프롬프트 sanitize 후 재시도`);
          try {
            const sanitizeRes = await fetch("/api/refine-prompt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ videoPrompt: prompt, mode: "sanitize", cutNumber }),
            });
            if (sanitizeRes.ok) {
              const sanitized = await sanitizeRes.json();
              if (sanitized?.refinedVideoPrompt) {
                console.log(`[CUT ${cutNumber}] Sanitized prompt 적용:`, sanitized.changes?.join(", "));
                prompt = sanitized.refinedVideoPrompt;
                // sanitized prompt로 즉시 재재생 (retryCount 1로 올려서 무한루프 방지)
                body.prompt = prompt;
                const retryRes = await fetch("/api/generate-video", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ...body, prompt }),
                });
                if (retryRes.ok) {
                  const retryData = await retryRes.json();
                  updateClip(cutNumber, { operationName: retryData.operationName });
                  startPolling(cutNumber, retryData.operationName);
                  return;
                }
              }
            }
          } catch (sanitizeErr) {
            console.warn(`[CUT ${cutNumber}] Sanitize 실패:`, sanitizeErr);
          }
        }

        updateClip(cutNumber, {
          status: "failed",
          error: isSafetyError
            ? `Vertex AI 안전 필터 차단 — 프롬프트에서 민감한 표현을 직접 수정하세요.`
            : errMsg,
        });
        return;
      }

      const data = await res.json() as {
        operationName?: string;
        taskId?: string;
        engine?: "veo" | "kling";
        modeUsed?: "generate" | "extend";
        sourceVideo?: string;
        warning?: string;
      };

      updateClip(cutNumber, {
        operationName: data.operationName,
        engineUsed: data.engine,
        modeUsed: data.modeUsed,
        sourceVideo: data.sourceVideo,
      });

      if (data.warning) {
        console.warn(`CUT ${cutNumber} warning:`, data.warning);
      }

      startPolling(
        cutNumber,
        data.operationName ?? "",
        data.engine ?? "veo",
        data.taskId,
        data.modeUsed === "extend",
      );
    } catch (err) {
      updateClip(cutNumber, {
        status: "failed",
        error: err instanceof Error ? err.message : "요청 실패",
      });
    }
  }, [cuts, state.clips, state.config, storyboardImages, storyboardEndImages, faceRefs, updateClip, startPolling, verifyPrompt]);

  // 자동 모드 (직렬 생성) — generating/pending 컷이 없을 때만 다음 idle 컷 시작
  // state.clips 변경 시마다 재실행 → generateCut이 항상 최신 클로저를 사용
  // (rawVideoUri 등 이전 컷의 완료 정보가 반드시 포함된 상태로 호출됨)
  useEffect(() => {
    if (!state.isAutoMode) return;

    // 현재 진행 중인 컷이 있으면 대기
    const hasActive = state.clips.some(
      (c) => c.status === "generating" || c.status === "polling"
    );
    if (hasActive) return;

    // 다음 idle 컷 시작
    const nextIdle = state.clips.find((c) => c.status === "idle");
    if (nextIdle) {
      generateCut(nextIdle.cutNumber);
      return;
    }

    // 모든 컷 완료/실패 → 자동 모드 종료
    if (state.clips.every((c) => c.status === "completed" || c.status === "failed")) {
      autoModeRef.current = false;
      setState((prev) => ({ ...prev, isAutoMode: false, currentAutoIndex: -1 }));
    }
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
          rawVideoUri: variant.rawVideoUri, // FIX: variant 선택 시 rawVideoUri도 업데이트해야 다음 컷 Scene Extension에 올바른 URI 전달
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
