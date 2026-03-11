"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { saveVideoRecord } from "@/lib/video-history";
import { assemblePrompt } from "@/lib/style-system";
import { generateQualityChecklist, sanitizeRenderedPrompt } from "@/lib/video-prompt-json";
import {
  buildSequencePlan,
  serializeSequencePlan,
  evaluateSequenceFidelity,
} from "@/lib/sequence-plan";
import type { SequencePlan } from "@/lib/sequence-plan";
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

const POLL_MAX_ATTEMPTS = 72; // 최대 6분
const POLL_BACKOFF = [5000, 7500, 10000, 15000, 20000]; // 에러 시 백오프

// 적응형 폴링: Veo는 보통 30-90초 소요 → 초반은 길게, 중반부터 짧게
// [0-15s: skip] → [15-45s: 10s] → [45-90s: 5s] → [90s+: 7s]
function getAdaptivePollInterval(attempt: number): number {
  if (attempt < 3) return 5000;    // 0-15s: 첫 응답 도착 대기 (5s × 3)
  if (attempt < 9) return 5000;    // 15-45s: 5s 간격 (자주 완료되는 구간)
  if (attempt < 18) return 5000;   // 45-90s: 5s 간격
  return 7000;                     // 90s+: 긴 생성일 때 서버 부담 경감
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UseVideoGenerationOptions {
  cuts: Cut[];
  /** 서버에서 받은 시퀀스 플랜 (generate-cuts 응답) */
  sequencePlan?: SequencePlan;
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

function strengthenNegativePrompt(original: string, retryCount: number): string {
  const additionalNegatives = [
    "distorted face, deformed hands, extra fingers, mutated",
    "text corruption, garbled text, broken letters, unreadable text",
    "blurry face, asymmetric eyes, distorted body proportions",
  ];
  const extras = additionalNegatives.slice(0, retryCount).join(", ");
  return extras ? `${original}, ${extras}` : original;
}

// sanitizeTextContent, ensureTemporalBeats, naturalizeMetaFields는
// style-system.ts의 assemblePrompt() 내부에서 처리됨

export function useVideoGeneration({ cuts, sequencePlan: externalSequencePlan, storyboardImages, storyboardEndImages, faceRefs, onSeedDetected }: UseVideoGenerationOptions) {
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

  // cuts 변경 시 clips 초기화 + 시퀀스 플랜 동기화
  useEffect(() => {
    // 서버에서 받은 sequencePlan이 있으면 사용, 없으면 클라이언트에서 빌드
    const plan = externalSequencePlan || (cuts.length > 0 ? buildSequencePlan(cuts, {
      styleId: state.config.animationMode,
      aspectRatio: state.config.aspectRatio,
    }) : undefined);

    setState((prev) => ({
      ...prev,
      sequencePlan: plan,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuts, externalSequencePlan]);

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
          shotCategory: cut.shotCategory,
          characterRole: cut.characterRole,
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
    variantsToPreserve?: VideoVariant[],
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
    const tPollStart = performance.now();
    let pollCount = 0;

    try {
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        // 첫 시도는 즉시, 이후엔 적응형 대기
        if (attempt > 0) {
          const waitMs = consecutiveErrors > 0
            ? POLL_BACKOFF[Math.min(consecutiveErrors - 1, POLL_BACKOFF.length - 1)]
            : getAdaptivePollInterval(attempt);
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
              cutNumber, // 서버 로그용
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
          // 5xx: 서버 transient 에러 → response body에서 실제 원인 추출 후 최대 3회 재시도
          consecutiveErrors++;
          let serverErrDetail = "";
          try {
            const errBody = await res.json() as { error?: string; errorType?: string };
            serverErrDetail = errBody.error ? ` (${errBody.error.slice(0, 120)})` : "";
          } catch { /* body 읽기 실패는 무시 */ }
          console.warn(`[CUT ${cutNumber}] check-video 서버 에러 ${res.status}${serverErrDetail} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            updateClip(cutNumber, {
              status: "failed",
              error: `서버 오류 (${res.status})${serverErrDetail || " — 잠시 후 다시 시도하세요"}`,
            });
            return;
          }
          continue;
        }

        // 성공 응답 시 연속 에러 카운터 리셋
        consecutiveErrors = 0;

        // ── JSON 파싱 (실패해도 재시도)
        let data: { status?: string; error?: string; videoUri?: string; rawVideoUri?: string; canonicalVideoUri?: string | null; needsUpload?: boolean; seed?: string; variants?: VideoVariant[]; noRetry?: boolean };
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
        pollCount++;

        // ── 상태별 처리
        // data.status가 없는데 data.error가 있으면 → 즉시 실패 (대기 루프 방지)
        if (!data.status && data.error) {
          console.error(`[CUT ${cutNumber}] status 없이 error 수신 (poll #${attempt}):`, data.error);
          updateClip(cutNumber, { status: "failed", error: String(data.error) });
          return;
        }

        if (data.status === "PENDING" || data.status === "RUNNING" || !data.status) {
          // 아직 처리 중 → 다음 루프
          if (attempt % 12 === 11) { // 매 1분마다 로그
            console.log(`[CUT ${cutNumber}] 폴링 진행 중 — poll #${attempt + 1}/${POLL_MAX_ATTEMPTS}, engine=${engine}`);
          }
          continue;
        }

        if (data.status === "COMPLETED") {
          const finalUri = data.variants?.[0]?.videoUri || data.videoUri;
          if (!finalUri) {
            updateClip(cutNumber, { status: "failed", error: "영상 생성 완료되었으나 비디오 URL이 없습니다" });
            return;
          }

          // ── Scene Extension 진단: check-video 응답의 _diag 확인 ──────────
          const diag = (data as Record<string, unknown>)._diag as {
            sceneExtensionReady?: boolean;
            primaryUriType?: string;
            extractedKinds?: string[];
          } | undefined;

          if (diag && !diag.sceneExtensionReady) {
            console.warn(`[CUT ${cutNumber}] ⚠️ Scene Extension 불가 (서버 진단)`, {
              primaryUriType: diag.primaryUriType,
              extractedKinds: diag.extractedKinds,
              rawVideoUri: data.rawVideoUri ? `${data.rawVideoUri.slice(0, 60)}…` : "(empty)",
              hint: "다음 컷은 IMAGE_TO_VIDEO 또는 TEXT_TO_VIDEO로 생성됩니다.",
            });
          }

          const clipUpdate: Partial<VideoClip> = {
            status: "completed",
            videoUri: data.videoUri,
            rawVideoUri: data.rawVideoUri,
            seed: data.seed || undefined,
            completedAt: Date.now(),
          };

          if (data.variants && data.variants.length > 0) {
            // 컷 추가 생성 모드: 기존 variants에 새 컷 append
            const newVariants = data.variants as VideoVariant[];
            const merged = variantsToPreserve ? [...variantsToPreserve, ...newVariants] : newVariants;
            const selectedIdx = variantsToPreserve ? merged.length - 1 : 0; // 새 컷 선택
            clipUpdate.variants = merged;
            clipUpdate.selectedVariant = selectedIdx;

            // URI가 있는 variant를 우선 선택 (Scene Extension을 위해)
            const variantWithUri = newVariants.find(v =>
              v.rawVideoUri && (v.rawVideoUri.startsWith("gs://") || v.rawVideoUri.startsWith("https://"))
            );
            const bestVariant = variantWithUri || newVariants[0];
            clipUpdate.videoUri = bestVariant.videoUri;
            clipUpdate.rawVideoUri = bestVariant.rawVideoUri;
            clipUpdate.seed = bestVariant.seed;

            if (variantWithUri && variantWithUri !== newVariants[0]) {
              console.log(`[CUT ${cutNumber}] URI가 있는 variant 선택 (Scene Extension 우선):`, {
                selectedUri: variantWithUri.rawVideoUri?.slice(0, 60),
              });
            }
          } else if (variantsToPreserve && clipUpdate.videoUri) {
            // 단일 결과 + 컷 추가 모드: 기존 + 새 컷 합치기
            const newVariant: VideoVariant = { videoUri: clipUpdate.videoUri, rawVideoUri: clipUpdate.rawVideoUri, seed: clipUpdate.seed };
            clipUpdate.variants = [...variantsToPreserve, newVariant];
            clipUpdate.selectedVariant = clipUpdate.variants.length - 1;
          }

          // ── canonicalVideoUri: 서버 제공 또는 업로드 후 획득 ──────────────
          if (data.canonicalVideoUri) {
            // 서버(check-video)가 직접 GCS/HTTPS URI를 반환한 경우
            clipUpdate.canonicalVideoUri = data.canonicalVideoUri;
            console.log(`[CUT ${cutNumber}] canonicalVideoUri (서버 제공):`, data.canonicalVideoUri.slice(0, 80));
          } else if (data.needsUpload && clipUpdate.videoUri) {
            // base64만 있고 canonical URI 없음 → R2/GCS 업로드 시도
            console.log(`[CUT ${cutNumber}] needsUpload=true → /api/upload-video 호출`);
            try {
              // videoUri가 data: URI(base64 인라인)인 경우 base64 데이터 추출
              const videoDataUri = clipUpdate.videoUri;
              let base64Data = "";
              if (videoDataUri.startsWith("data:")) {
                base64Data = videoDataUri.replace(/^data:[^;]+;base64,/, "");
              } else if (videoDataUri.startsWith("/api/proxy-video")) {
                // 프록시 URL인 경우 base64 추출 불가 → 업로드 스킵
                console.warn(`[CUT ${cutNumber}] videoUri가 프록시 URL — 업로드 스킵`);
              }

              if (base64Data.length > 1000) {
                const uploadRes = await fetch("/api/upload-video", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    base64Data,
                    mimeType: "video/mp4",
                    cutNumber,
                    sessionId: operationName.split("/").slice(-1)[0] || "default",
                  }),
                });

                if (uploadRes.ok) {
                  const uploadData = await uploadRes.json() as {
                    canonicalVideoUri?: string;
                    proxyUri?: string;
                    storage?: string;
                    key?: string;
                  };
                  if (uploadData.canonicalVideoUri) {
                    clipUpdate.canonicalVideoUri = uploadData.canonicalVideoUri;
                    console.log(`[CUT ${cutNumber}] canonicalVideoUri (업로드):`, {
                      uri: uploadData.canonicalVideoUri.slice(0, 80),
                      storage: uploadData.storage,
                    });
                  } else if (uploadData.proxyUri) {
                    // R2에 업로드했지만 도메인 없음 → proxyUri로 대체
                    console.log(`[CUT ${cutNumber}] R2 업로드 성공 (도메인 없음) — proxyUri 사용:`, uploadData.proxyUri);
                  }
                } else {
                  const errText = await uploadRes.text().catch(() => "");
                  console.warn(`[CUT ${cutNumber}] upload-video 실패 (${uploadRes.status}):`, errText.slice(0, 200));
                }
              }
            } catch (uploadErr) {
              // 업로드 실패는 생성 성공에 영향 없음 — Scene Extension만 불가
              console.warn(`[CUT ${cutNumber}] upload-video 오류:`, uploadErr instanceof Error ? uploadErr.message : uploadErr);
            }
          }

          updateClip(cutNumber, clipUpdate);

          // ── 타이밍: 폴링 완료 ──────────────────────────────────────────────────
          const tPollEnd = performance.now();
          const pollTotalMs = Math.round(tPollEnd - tPollStart);
          console.log(`[CUT ${cutNumber}] ⏱ polling`, {
            pollCount,
            pollTotalMs,
            avgPollMs: pollCount > 0 ? Math.round(pollTotalMs / pollCount) : 0,
          });

          // ── 완료 후 진단 로그 ───────────────────────────────────────────────
          {
            const curi = clipUpdate.canonicalVideoUri ?? "";
            const ruri = clipUpdate.rawVideoUri ?? "";
            const effectiveUri = curi || ruri;
            const ruriType = curi.startsWith("gs://") ? "CANONICAL_GCS ✓"
              : curi.startsWith("https://") ? "CANONICAL_HTTPS ✓"
              : ruri.startsWith("gs://") ? "GCS ✓"
              : ruri.startsWith("https://") ? "HTTPS ✓"
              : ruri === "" ? "EMPTY(base64) ✗"
              : "DATA_URI ✗";
            const willExtend = effectiveUri.length > 0 && !effectiveUri.startsWith("data:");
            const hasLastFrame = !!clipUpdate.videoUri;
            const continuityScore = willExtend ? 100 : hasLastFrame ? 60 : 0;
            console.log(`[CUT ${cutNumber}] COMPLETED`, {
              sourceCutId: cutNumber,
              parentCutId: cutNumber - 1,
              canonicalVideoUri: curi ? `${curi.slice(0, 80)}…` : "(없음)",
              rawVideoUri: ruri ? `${ruri.slice(0, 80)}…` : "(empty)",
              effectiveUriType: ruriType,
              nextCutWillExtend: willExtend ? "✓ Scene Extension 가능" : "✗ Scene Extension 불가 → image/text fallback",
              nextCutContinuityScore: continuityScore,
              nextCutFallback: willExtend ? "SCENE_EXTENSION" : hasLastFrame ? "IMAGE_TO_VIDEO (lastFrame)" : "TEXT_TO_VIDEO (연속성 없음)",
              seed: clipUpdate.seed,
            });
            if (!willExtend) {
              console.warn(
                `[CUT ${cutNumber}] ⚠️ Scene Extension용 URI 없음 → CUT ${cutNumber + 1}은 SCENE_EXTENSION 없이 생성됨.`,
                {
                  canonicalVideoUri: curi || "(없음)",
                  rawVideoUri: `"${ruri.slice(0, 60)}"`,
                  fallback: hasLastFrame ? "IMAGE_TO_VIDEO (lastFrame 사용)" : "TEXT_TO_VIDEO (연속성 완전 손실)",
                  continuityScore,
                  possibleFix: "R2 (VIDEO_BUCKET 바인딩) 또는 GOOGLE_SERVICE_ACCOUNT_JSON 설정으로 업로드 가능",
                }
              );
            }
          }

          // ── 영상 기록 저장 (localStorage) ────────────────────────────────────
          try {
            const cut = cuts.find((c) => c.cutNumber === cutNumber);
            saveVideoRecord({
              operationName,
              engine,
              gcsUri: clipUpdate.canonicalVideoUri || clipUpdate.rawVideoUri || "",
              proxyUri: clipUpdate.videoUri || "",
              prompt: cut?.videoPrompt?.slice(0, 500) || "",
              mode: isExtend ? "extend" : "generate",
              durationSec: cut?.durationSec || 8,
              cutNumber,
              sourceCutId: isExtend && cutNumber > 1 ? cutNumber - 1 : undefined,
              seed: clipUpdate.seed,
              status: "completed",
            });
          } catch {
            // 히스토리 저장 실패는 무시 — 생성 플로우를 방해하지 않음
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
                      const rawScores = {
                        promptMatch: quality.scores?.promptMatch ?? 0,
                        visualQuality: quality.scores?.visualQuality ?? 0,
                        faceQuality: quality.scores?.faceQuality ?? 0,
                        motionCoherence: quality.scores?.motionCoherence ?? 0,
                        styleConsistency: quality.scores?.styleConsistency ?? 0,
                        composition: quality.scores?.composition ?? 0,
                      };

                      // 세부 점수 디버그 로그
                      console.log(`[CUT ${cutNumber}] 🎯 QUALITY BREAKDOWN`, {
                        overall: quality.overallScore,
                        promptMatch: `${rawScores.promptMatch}/10`,
                        visualQuality: `${rawScores.visualQuality}/10`,
                        faceQuality: `${rawScores.faceQuality}/10`,
                        motionCoherence: `${rawScores.motionCoherence}/10`,
                        styleConsistency: `${rawScores.styleConsistency}/10`,
                        composition: `${rawScores.composition}/10`,
                        issues: quality.issues || [],
                        suggestion: quality.suggestion || "(없음)",
                      });

                      updateClip(cutNumber, {
                        verification: {
                          overallScore: quality.overallScore,
                          scores: {
                            characterDescription: rawScores.promptMatch,
                            cameraMovement: rawScores.composition,
                            actionSequence: rawScores.motionCoherence,
                            lightingMood: rawScores.styleConsistency,
                            veoCompatibility: rawScores.visualQuality,
                          },
                          rawScores,
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

          // ── 타이밍: 후처리 완료 ────────────────────────────────────────────────
          const tPostEnd = performance.now();
          const postProcessMs = Math.round(tPostEnd - tPollEnd);
          console.log(`[CUT ${cutNumber}] ⏱ postProcess`, { postProcessMs });
          console.log(`[CUT ${cutNumber}] ⏱ TOTAL (polling loop)`, {
            pollTotalMs,
            postProcessMs,
            totalMs: Math.round(tPostEnd - tPollStart),
            pollCount,
          });

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
          console.error(`[CUT ${cutNumber}] Veo 생성 실패:`, data.error || "unknown error", { noRetry: data.noRetry, attempt });
          // Enhancement 6: Auto-retry on failure
          // noRetry=true: 서버가 재시도 무의미 판정 (스택 오버플로 등 내부 로직 오류)
          setState((prev) => {
            const clip = prev.clips.find((c) => c.cutNumber === cutNumber);
            const retryCount = clip?.retryCount || 0;
            const cfg = prev.config;

            if (!data.noRetry && cfg.autoRetryOnFailure && retryCount < cfg.maxRetryCount) {
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
      updateClip(cutNumber, { status: "failed", error: `영상 생성 타임아웃 (${Math.round(POLL_MAX_ATTEMPTS * 5 / 60)}분 초과)` });
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
  const generateCut = useCallback(async (cutNumber: number, preserveVariants?: boolean) => {
    const t0 = performance.now(); // ── 전체 시작
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

    // CUT N>1: 이전 컷 시각 상태는 assemblePrompt()의 CONSISTENCY 블록에서 처리됨.
    // 여기서 중복 주입하면 워드 예산을 낭비하고 씬 프롬프트가 밀려남.
    // (assemblePrompt에 characterConsistency/moodLighting을 직접 전달)

    // 이전 장면의 videoUri (Scene Extension)
    const prevClip = state.clips.find(
      (c) => c.cutNumber === cutNumber - 1 && c.status === "completed"
    );

    // preserveVariants=true 이면 기존 컷들을 보존하며 새 컷 추가 (컷 추가 생성 모드)
    const existingClip = state.clips.find((c) => c.cutNumber === cutNumber);
    const variantsToPreserve: VideoVariant[] | undefined = preserveVariants && existingClip?.status === "completed"
      ? (existingClip.variants && existingClip.variants.length > 0
          ? existingClip.variants
          : existingClip.videoUri ? [{ videoUri: existingClip.videoUri, rawVideoUri: existingClip.rawVideoUri, seed: existingClip.seed }] : undefined)
      : undefined;

    updateClip(cutNumber, {
      status: "generating",
      startedAt: Date.now(),
      error: undefined,
      variants: variantsToPreserve ?? undefined,
      selectedVariant: variantsToPreserve ? (existingClip?.selectedVariant ?? 0) : undefined,
    });

    try {
      // ── 타이밍: 전처리 시작 ──────────────────────────────────────────────
      const tPreStart = performance.now();

      // ═══ 병렬 전처리: auto-negative + refine-prompt 동시 실행 ═══════════
      // 기존: auto-negative → refine-prompt → verify-prompt (3개 순차, 각 500ms~2s)
      // 최적화: auto-negative + refine-prompt 병렬, verify-prompt는 생성 후 비동기
      let negativePrompt = cfg.negativePrompt;

      if (retryCount === 0) {
        const prevCut = cuts.find((c) => c.cutNumber === cutNumber - 1);

        // 병렬 작업 목록
        const parallelTasks: Promise<void>[] = [];

        // Task A: auto-negative (useAI: false → 빠른 로컬 규칙 기반)
        const negativeTask = (async () => {
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
        })();
        parallelTasks.push(negativeTask);

        // Task B: refine-prompt (Gemini 호출 — 가장 느린 전처리)
        let refinedPrompt: string | undefined;
        if (cfg.autoEnglishRefine) {
          const refineTask = (async () => {
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
                  negativePrompt: cfg.negativePrompt,
                  durationSeconds: cfg.durationSeconds,
                  previousCutPrompt: prevCut?.videoPrompt || "",
                  shotCategory: cut.shotCategory, // map-graphic 등 장면 유형 전달
                }),
              });
              if (refRes.ok) {
                const refined = await refRes.json();
                if (refined?.refinedVideoPrompt) {
                  refinedPrompt = cutNumber === 1
                    ? refined.refinedVideoPrompt
                    : (refined.refinedExtendPrompt || undefined);
                }
              }
            } catch (err) {
              console.warn("English refinement failed:", err);
            }
          })();
          parallelTasks.push(refineTask);
        }

        // 병렬 실행 완료 대기
        await Promise.all(parallelTasks);

        // refine 결과 적용
        if (refinedPrompt) {
          prompt = refinedPrompt;
        }

        // ═══ verify-prompt: 생성 차단 판정만 동기, 나머지는 비동기 ═══════════
        // 핵심 변경: verify-prompt의 overallScore < 30 차단만 동기로 처리
        // 점수 80 이하 프롬프트 교체 + UI 업데이트는 비동기(생성과 병렬)
        if (cfg.autoVerifyPrompts) {
          const verification = await verifyPrompt(cut);
          if (verification) {
            updateClip(cutNumber, { verification });

            if (verification.overallScore < 80 && verification.improvedVideoPrompt) {
              prompt = cutNumber === 1
                ? verification.improvedVideoPrompt
                : (verification.improvedExtendPrompt || prompt);
            }

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
      } else {
        // Enhancement 6: Strengthen negative prompt on retry
        negativePrompt = strengthenNegativePrompt(negativePrompt || "", retryCount);
      }

      const tPreEnd = performance.now();
      const preProcessMs = Math.round(tPreEnd - tPreStart);

      // ═══ 전역 스타일 시스템으로 프롬프트 조립 ═══════════════════════
      // assemblePrompt()가 7개 블록을 우선순위대로 조립:
      //   1. STYLE IDENTITY (전체 비주얼 정체성)
      //   2. CONSISTENCY (캐릭터 스타일 + 환경 스타일 + 일관성 규칙)
      //   3. CAMERA MOTION (자동 프리셋 + 8초 타임라인 + 안티보어덤)
      //   4. SCENE CONTENT (메타 필드 자연어 변환 + temporal beats + sanitize)
      //   5. STYLE REINFORCEMENT (스타일 강화 리마인더)
      //   6. NEGATIVE (스타일 충돌 차단 + 비실사 anti-photorealism)
      //   7. AUDIO (오디오 힌트)
      {
        const prevCutData = cutNumber > 1
          ? cuts.find((c) => c.cutNumber === cutNumber - 1)
          : undefined;

        const assembled = assemblePrompt({
          animationMode: cfg.animationMode,
          styleIntensity: cfg.styleIntensity,
          scenePrompt: prompt,
          characterConsistency: prevCutData?.characterConsistency || cut.characterConsistency,
          moodLighting: prevCutData?.moodLighting || cut.moodLighting,
          cameraDirection: cut.cameraDirection,
          shotType: cut.videoPromptJson?.shotSize,
          userNegativePrompt: negativePrompt,
          durationSec: cfg.durationSeconds,
          shotCategory: cut.shotCategory,
        });

        prompt = sanitizeRenderedPrompt(assembled.finalPrompt);

        // ── PREFLIGHT DRIFT DETECTION (비용 보호) ──────────────────────
        // map scene에서 풍경/동물 drift 감지 시 생성 차단
        if (assembled.driftWarning) {
          console.error(`[CUT ${cutNumber}] ⛔ ${assembled.driftWarning}`);
          updateClip(cutNumber, {
            status: "failed",
            error: assembled.driftWarning,
            finalPrompt: prompt,
          });
          return;
        }

        // ── 품질 체크리스트 (프롬프트 사전 검증) ─────────────────────────
        if (cut.videoPromptJson) {
          const checklist = generateQualityChecklist(prompt, cut.videoPromptJson, {
            shotCategory: cut.shotCategory,
            characterRole: cut.characterRole,
          });
          updateClip(cutNumber, { qualityChecklist: checklist });
        }

        // ── UI에 최종 프롬프트 저장 (실제 API에 전송되는 merged prompt) ──
        updateClip(cutNumber, {
          finalPrompt: prompt,
          assembledDebug: {
            styleBlock: assembled.debug.styleBlock,
            consistencyBlock: assembled.debug.consistencyBlock,
            cameraBlock: assembled.debug.cameraBlock,
            sceneBlock: assembled.debug.sceneBlock,
            reinforcementBlock: assembled.debug.reinforcementBlock,
            negativeBlock: assembled.debug.negativeBlock,
            isMapScene: assembled.debug.isMapScene,
          },
        });

        // ── 시퀀스 플랜 기반 shot 프롬프트 직렬화 로그 ──────────────────────
        if (state.sequencePlan) {
          const serialized = serializeSequencePlan(state.sequencePlan, cfg.engine === "kling" ? "kling" : "veo");
          const shotPrompt = serialized.shotPrompts.find(sp => sp.shotId === `shot_${cutNumber}`);
          const shotLog = serialized.logs.find(l => l.shotId === `shot_${cutNumber}`);
          if (shotPrompt) {
            console.log(`[CUT ${cutNumber}] 📋 SEQUENCE SHOT PROMPT`, {
              shotId: shotPrompt.shotId,
              promptLen: shotPrompt.prompt.length,
              negative: shotPrompt.negative || "(없음)",
              includedFields: shotLog?.includedFields || [],
              droppedFields: shotLog?.droppedFields || [],
              warnings: shotLog?.warnings || [],
            });
          }
        }

        // ── 블록별 디버그 로그 (통합) ──────────────────────────────────────
        console.log(`[CUT ${cutNumber}] 📝 ASSEMBLED PROMPT`, {
          animationMode: cfg.animationMode || "(없음)",
          shotCategory: cut.shotCategory || "(없음)",
          isMapScene: assembled.debug.isMapScene,
          wordCount: assembled.debug.wordCount,
          camera: assembled.debug.camera.source,
          negative: assembled.debug.negativeBlock || "(없음)",
          finalPrompt: prompt.length > 800 ? prompt.slice(0, 800) + "…" : prompt,
        });
      }

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
      // 우선순위: canonicalVideoUri (업로드된 안정 URI) > rawVideoUri (provider 직접 반환)
      // data: URI(base64 인라인)는 Scene Extension 불가 + 수 MB 요청 낭비 → 제거
      const canonicalPrevUri = cutNumber > 1 ? prevClip?.canonicalVideoUri : undefined;
      const rawPrevUri = cutNumber > 1 ? prevClip?.rawVideoUri : undefined;
      const previousVideoUri =
        canonicalPrevUri  // 1순위: 업로드 후 획득한 안정 URI (gs:// 또는 https://)
        || (rawPrevUri && !rawPrevUri.startsWith("data:") && rawPrevUri.length > 0
          ? rawPrevUri   // 2순위: provider가 직접 반환한 GCS/HTTPS URI
          : undefined);

      // ── Scene Extension 실패 시 lastFrame 기반 IMAGE_TO_VIDEO fallback 보장 ──
      // previousVideoUri가 없고 firstFrameBase64도 없으면 → 이전 컷의 lastFrame 재캡처 시도
      if (cutNumber > 1 && !previousVideoUri && !firstFrameBase64 && prevClip?.videoUri) {
        console.warn(`[CUT ${cutNumber}] Scene Extension 불가 + firstFrame 없음 → lastFrame 긴급 캡처`);
        try {
          const emergencyFrame = await captureVideoLastFrame(prevClip.videoUri);
          if (emergencyFrame) {
            firstFrameBase64 = emergencyFrame;
            updateClip(cutNumber - 1, { lastFrameBase64: emergencyFrame });
            console.log(`[CUT ${cutNumber}] lastFrame 긴급 캡처 성공 → IMAGE_TO_VIDEO fallback 확보`);
          } else {
            console.error(`[CUT ${cutNumber}] lastFrame 긴급 캡처 실패 — TEXT_TO_VIDEO로 생성 (연속성 없음)`);
          }
        } catch (captureErr) {
          console.error(`[CUT ${cutNumber}] lastFrame 긴급 캡처 예외:`, captureErr);
        }
      }

      // ── 요청 직전 진단 로그 ─────────────────────────────────────────────────
      // mode: 실제 어떤 방식으로 생성하는지 명시
      const requestMode = previousVideoUri
        ? "SCENE_EXTENSION"
        : firstFrameBase64
          ? "IMAGE_TO_VIDEO"
          : "TEXT_TO_VIDEO";

      if (cutNumber > 1 && requestMode !== "SCENE_EXTENSION") {
        // Scene Extension 실패 원인을 상세 진단
        const extensionSkipReason: string[] = [];
        if (!prevClip) extensionSkipReason.push("이전 컷 클립 없음");
        else if (prevClip.status !== "completed") extensionSkipReason.push(`이전 컷 상태: ${prevClip.status}`);
        if (!canonicalPrevUri && !rawPrevUri) extensionSkipReason.push("canonicalVideoUri + rawVideoUri 모두 없음 (업로드 실패 + GCS/HTTPS URI 미반환)");
        else if (!canonicalPrevUri && rawPrevUri === "") extensionSkipReason.push("canonicalVideoUri 없음 + rawVideoUri 빈 문자열 (업로드 실패 + Veo base64 응답)");
        else if (!canonicalPrevUri && rawPrevUri?.startsWith("data:")) extensionSkipReason.push("canonicalVideoUri 없음 + rawVideoUri가 data: URI (업로드 실패)");

        console.warn(
          `[CUT ${cutNumber}] ⚠️ ${requestMode} — Scene Extension 실패 (연속성 약화)`,
          {
            extensionSkipReason,
            fallbackMode: requestMode,
            prevClipExists: !!prevClip,
            prevClipStatus: prevClip?.status,
            canonicalVideoUri: canonicalPrevUri || "(없음)",
            rawVideoUri: rawPrevUri ? `${rawPrevUri.slice(0, 60)}…` : "(없음)",
            firstFrameBase64: firstFrameBase64 ? `(${firstFrameBase64.length}자) → IMAGE_TO_VIDEO fallback` : "(없음) → TEXT_TO_VIDEO fallback",
            fix: "VIDEO_BUCKET(R2) 바인딩 또는 GOOGLE_SERVICE_ACCOUNT_JSON 설정으로 업로드/GCS URI 가능",
          }
        );
      }

      console.log(`[CUT ${cutNumber}] API 요청`, {
        cutNumber,
        sourceCutId: cutNumber,
        parentCutId: cutNumber > 1 ? cutNumber - 1 : null,
        mode: requestMode,
        previousVideoUri: previousVideoUri ? `${previousVideoUri.slice(0, 60)}…` : null,
        previousVideoUriSource: canonicalPrevUri ? "canonicalVideoUri" : rawPrevUri ? "rawVideoUri" : "none",
        hasFirstFrame: !!firstFrameBase64,
        hasLastFrame: !!lastFrameBase64,
        promptMode: cutNumber === 1 ? "videoPrompt" : (cut.extendPrompt?.trim() ? "extendPrompt" : "videoPrompt(fallback)"),
        promptLen: prompt.length,
        promptPrefix: prompt.slice(0, 120),
        model: "veo-3.1-fast-generate-001",
      });

      // ── 엔진 & 모드 결정 ─────────────────────────────────────────────────
      // 10s / 15s는 Kling 전용 — Veo 미지원이므로 엔진을 강제 override
      const durSec = cfg.durationSeconds ?? 8;
      const isKlingOnlyDuration = durSec >= 10;
      const engine = isKlingOnlyDuration ? "kling" : (cfg.engine ?? "veo");

      // CUT 1은 이전 영상/프레임이 존재하지 않으므로 extend 절대 금지
      // CUT 2 이상: cfg.videoMode 또는 기본값 "extend" 사용
      const videoMode = cutNumber === 1 ? "generate" : (cfg.videoMode ?? "extend");

      console.log(`[CUT ${cutNumber}] videoMode 결정`, {
        cutNumber,
        selectedMode: videoMode,
        cfgMode: cfg.videoMode ?? null,
        reason: cutNumber === 1 ? "cut1_force_generate" : "normal",
        durationSec: durSec,
        engineOverride: isKlingOnlyDuration ? `Kling 강제 (${durSec}s >= 10s)` : null,
        engine,
      });

      // Kling extend: sourceVideo = 이전 클립의 rawVideoUri (Kling video_id)
      // Veo extend:   previousVideoUri = 이전 클립의 gs:// URI (기존 로직 유지)
      const sourceVideo = (videoMode === "extend" && cutNumber > 1)
        ? (prevClip?.rawVideoUri ?? "")
        : "";

      // Veo 멀티샷: engine이 결정된 후 multiShot을 프롬프트 앞에 삽입
      // (Kling은 body의 multiShot 필드로 별도 처리 → model_params.multi_shot)
      if (engine !== "kling" && cut.multiShot && cut.multiShot.length > 0) {
        const shotLines = cut.multiShot.map((s) =>
          `SHOT ${s.index} (${s.duration}s): ${s.prompt}`
        ).join(" → ");
        prompt = `${shotLines}. ${prompt}`;
      }

      // ── cut1 hard guard: extend 관련 필드 완전 차단 ──────────────────────────
      const isCut1 = cutNumber === 1;
      const safeSourceVideo = isCut1 ? undefined : (sourceVideo || undefined);
      const safePrevVideoUri = isCut1 ? undefined : previousVideoUri;
      const safeFirstFrame = isCut1 ? (cfg.firstFrameBase64 || (storyboardImages?.[1]) || undefined) : firstFrameBase64;

      const body: Record<string, unknown> = {
        prompt,
        cutNumber,
        engine,
        videoMode,
        sourceVideo: safeSourceVideo,
        mode: cfg.mode,
        durationSeconds: cfg.durationSeconds,
        resolution: cfg.resolution,
        aspectRatio: cfg.aspectRatio,
        generateAudio: true, // 항상 사운드 ON 강제
        negativePrompt: negativePrompt || undefined,
        personGeneration: cfg.personGeneration,
        sampleCount: cfg.sampleCount,
        seed: cfg.seed,
        // Scene Extension (Veo) — gs:// 또는 https:// URI만
        previousVideoUri: safePrevVideoUri,
        // First Frame (auto-linked from prev cut's end or storyboard)
        firstFrameBase64: safeFirstFrame,
        // Last Frame (auto-linked from end storyboard or manual)
        lastFrameBase64: lastFrameBase64,
        // Reference Images (캐릭터 얼굴 + 수동 레퍼런스)
        referenceImages: finalRefImages.length > 0 ? finalRefImages : undefined,
        // Kling 멀티샷: Kling 장면에서 multiShot이 있으면 model_params로 전달
        ...(engine === "kling" && cut.multiShot && cut.multiShot.length > 0
          ? { multiShot: cut.multiShot }
          : {}),
        // JSON 기반 프롬프트 (있으면 서버에서 provider별 렌더링)
        ...(cut.videoPromptJson ? { videoPromptJson: cut.videoPromptJson } : {}),
        ...(cut.extendPromptJson ? { extendPromptJson: cut.extendPromptJson } : {}),
      };

      // ── 타이밍: 프롬프트 조립 완료 ──────────────────────────────────────────
      const tBuildDone = performance.now();
      const buildPromptMs = Math.round(tBuildDone - t0);
      const assemblyOnlyMs = Math.round(tBuildDone - tPreEnd); // assemblePrompt 순수 시간
      const promptWordCount = prompt.split(/\s+/).length;
      const promptCharCount = prompt.length;

      console.log(`[CUT ${cutNumber}] ⏱ PIPELINE TIMING`, {
        preProcessMs,   // auto-negative + refine-prompt + verify-prompt (병렬화 후)
        assemblyMs: assemblyOnlyMs, // assemblePrompt + quality checklist
        buildTotalMs: buildPromptMs,
        promptChars: promptCharCount,
        promptWords: promptWordCount,
      });

      // ── API 요청 요약 디버그 ──────────────────────────────────────────────
      console.log(`[CUT ${cutNumber}] 📦 API REQUEST`, {
        engine,
        videoMode,
        mode: requestMode,
        style: cfg.animationMode || "(없음)",
        promptWords: prompt.split(/\s+/).length,
        hasFirstFrame: !!safeFirstFrame,
        hasPrevUri: !!safePrevVideoUri,
        refImages: finalRefImages.length,
        negative: negativePrompt?.slice(0, 80) || "(없음)",
      });

      const tApiStart = performance.now();
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const tApiEnd = performance.now();
      const apiRequestMs = Math.round(tApiEnd - tApiStart);

      console.log(`[CUT ${cutNumber}] ⏱ apiRequest`, {
        apiRequestMs,
        httpStatus: res.status,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "API 오류" }));
        const errMsg = errData.error || `HTTP ${res.status}`;
        console.error(`CUT ${cutNumber} 영상 생성 실패:`, errMsg, errData.details || "", errData.warning || "");

        // Safety filter 에러 → Gemini로 프롬프트 sanitize 후 1회 재시도
        // Veo 실제 에러 메시지 패턴 (Vertex AI / Google Video AI 공통):
        //   "could not generate videos based on the prompt"
        //   "You will not be charged for this request"
        //   "Try rephrasing the prompt"
        //   "usage guidelines"
        //   "could not be submitted"
        //   raiFiltered: true
        const isSafetyError =
          errMsg.includes("could not generate videos") ||
          errMsg.includes("not be charged") ||
          errMsg.includes("Try rephrasing") ||
          errMsg.includes("usage guidelines") ||
          errMsg.includes("could not be submitted") ||
          errMsg.includes("safety") ||
          errData.raiFiltered === true;

        if (isSafetyError && retryCount === 0) {
          const originalPrompt = prompt;
          console.warn(`[CUT ${cutNumber}] Safety 차단 감지`, {
            blockReason: errMsg.slice(0, 200),
            originalPromptLen: originalPrompt.length,
            originalPromptHead: originalPrompt.slice(0, 120),
          });
          try {
            const sanitizeRes = await fetch("/api/refine-prompt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ videoPrompt: prompt, mode: "sanitize", cutNumber }),
            });
            if (sanitizeRes.ok) {
              const sanitized = await sanitizeRes.json();
              if (sanitized?.refinedVideoPrompt) {
                prompt = sanitized.refinedVideoPrompt;
                console.log(`[CUT ${cutNumber}] Safety 재시도`, {
                  changes: sanitized.changes,
                  originalHead: originalPrompt.slice(0, 100),
                  sanitizedHead: prompt.slice(0, 100),
                });
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
                } else {
                  const retryErr = await retryRes.json().catch(() => ({ error: "재시도 실패" }));
                  console.error(`[CUT ${cutNumber}] Safety 재시도도 실패:`, retryErr.error);
                }
              } else {
                console.warn(`[CUT ${cutNumber}] Sanitize 응답에 refinedVideoPrompt 없음:`, sanitized);
              }
            }
          } catch (sanitizeErr) {
            console.warn(`[CUT ${cutNumber}] Sanitize 호출 실패:`, sanitizeErr);
          }
        }

        updateClip(cutNumber, {
          status: "failed",
          error: isSafetyError
            ? `Vertex AI 안전 필터 차단 — 민감한 표현(폭력·의료시술·신체손상·공포)을 완화해 다시 시도하세요.`
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
        _diag?: {
          authMethod?: string;
          urlVersion?: string;
          urlHasProject?: boolean;
          veoMode?: string;
          sceneExtensionAttempted?: boolean;
        };
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

      // 서버 진단 정보 로그 — GCS URI 반환 가능 여부 사전 파악
      if (data._diag) {
        const d = data._diag;
        console.log(`[CUT ${cutNumber}] 서버 진단`, {
          authMethod: d.authMethod,
          urlVersion: d.urlVersion,
          urlHasProject: d.urlHasProject,
          veoMode: d.veoMode,
          sceneExtensionAttempted: d.sceneExtensionAttempted,
          gcsUriExpected: d.authMethod === "SERVICE_ACCOUNT" || d.urlHasProject
            ? "✓ GCS URI 반환 예상" : "✗ base64 반환 가능성 높음 — GOOGLE_CLOUD_PROJECT_ID 환경변수 확인 필요",
        });
      }

      // ── 타이밍: generateCut 전체 (API 응답까지) ──────────────────────────
      const tGenDone = performance.now();
      console.log(`[CUT ${cutNumber}] ⏱ generateCut`, {
        preProcessMs,       // auto-negative + refine + verify (병렬화됨)
        assemblyMs: assemblyOnlyMs, // assemblePrompt 순수 시간
        apiRequestMs,       // generate-video HTTP 요청
        totalMs: Math.round(tGenDone - t0),
      });

      startPolling(
        cutNumber,
        data.operationName ?? "",
        data.engine ?? "veo",
        data.taskId,
        data.modeUsed === "extend",
        variantsToPreserve,
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

  // 컷 추가 생성 — 기존 완료 영상을 유지한 채 새 컷을 variants에 추가
  const addCutVariant = useCallback((cutNumber: number) => {
    const existingClip = state.clips.find((c) => c.cutNumber === cutNumber);
    if (!existingClip || existingClip.status !== "completed") return;
    generateCut(cutNumber, true /* preserveVariants */);
  }, [state.clips, generateCut]);

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
      qualityChecklist: undefined,
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

      // ── 시퀀스 fidelity 평가 (전체 완료 시) ──────────────────────────
      if (state.sequencePlan) {
        try {
          const serialized = serializeSequencePlan(state.sequencePlan);
          const genResults = state.sequencePlan.shots.map((shot) => {
            const clip = state.clips.find(c => `shot_${c.cutNumber}` === shot.shotId);
            return {
              shotId: shot.shotId,
              generated: clip?.status === "completed",
              engineUsed: clip?.engineUsed,
              finalPrompt: clip?.finalPrompt || "",
              verification: clip?.verification ? {
                overallScore: clip.verification.overallScore,
                issues: clip.verification.issues,
              } : undefined,
            };
          });
          const fidelity = evaluateSequenceFidelity(state.sequencePlan, serialized, genResults);
          setState((prev) => ({ ...prev, sequenceFidelity: fidelity }));
          console.log(`[SEQUENCE] 🎯 FIDELITY EVALUATION`, {
            overallScore: fidelity.overallScore,
            shotCountMatch: fidelity.shotCountMatch,
            continuityPreservation: fidelity.continuityPreservation,
            primaryCause: fidelity.failureDiagnosis.primaryCause,
            authoringIssues: fidelity.failureDiagnosis.authoringIssues.length,
            serializationIssues: fidelity.failureDiagnosis.serializationIssues.length,
            generationIssues: fidelity.failureDiagnosis.generationIssues.length,
          });
        } catch (e) {
          console.error("[SEQUENCE] fidelity evaluation failed:", e);
        }
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
  }, [completedCount, totalCount, state.review, state.sequencePlan, state.clips, reviewAllClips, sendNotification]);

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
    addCutVariant,
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
