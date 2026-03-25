"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { saveVideoRecord } from "@/lib/video-history";
import { assembleFromJSON } from "@/lib/sequence-assembler";
import { preflightQualityCheck, applyQualityFixes } from "@/lib/gemini-quality-check";
import { generateQualityChecklist } from "@/lib/video-prompt-json";
import {
  buildSequencePlan,
  serializeSequencePlan,
  evaluateSequenceFidelity,
} from "@/lib/sequence-plan";
import type { SequencePlan } from "@/lib/sequence-plan";
import {
  reevaluateSceneExtensionEligibilityAfterUpload,
  selectVideoModeForNextCut,
} from "@/lib/scene-extension-readiness";
import { DURATION_FALLBACK, safeDuration } from "@/lib/duration-reconciliation";
import {
  buildMultiChainPlan,
  isChainFirstCut,
  getChainForCut,
} from "@/lib/multi-chain-orchestrator";
import {
  Cut,
  VideoClip,
  VideoGenStatus,
  VideoGenerationState,
  VideoGenerationConfig,
  VideoVariant,
  PromptVerification,
  CharacterFaceRef,
  CutFeedback,
  DEFAULT_VIDEO_CONFIG,
  type StructuredSequenceDocument,
  type ShotVariant,
  type ShotSnapshots,
  type DurationMeta,
  type NarrationTrack,
  type AudioMeta,
  type AudioCoverageMeta,
  type ShotNarrationState,
  type SequenceNarrationState,
  type BatchNarrationRegenerationState,
} from "@/types";
import {
  createInitialVariantState,
  setShotStatus,
  attachShotVariant,
  setActiveShotVariant as setActiveShotVariantState,
  updateShotVariant,
  generateVariantId,
  buildShotRegeneratePayload,
  payloadToStructuredSequence,
  type ShotVariantState,
} from "@/lib/shot-variants";
import { extractEditable } from "@/lib/shot-editing";
// Custom Element 제거됨 (v2 예정). element_list 관련 로직 비활성화.
import {
  submitVideoGeneration,
  pollVideoTask,
  buildDurationMeta,
  classifyVideoError,
  extractProviderMeta,
  type VideoSubmitResult,
  type NormalizedVideoResult,
} from "@/lib/video-generation-core";
import {
  createJob,
  markSubmitted,
  markFailed as markJobFailed,
  getRecoverableJobs,
  cleanupOldJobs,
  type VideoJobRecord,
} from "@/lib/video-job-store";
import {
  VEO_DEFAULT_MODEL,
  resolveModelForWorkflow,
} from "@/lib/veo-capability";

interface UseVideoGenerationOptions {
  cuts: Cut[];
  /** 서버에서 받은 시퀀스 플랜 (generate-cuts 응답) */
  sequencePlan?: SequencePlan;
  storyboardImages?: Record<number, string>;
  storyboardEndImages?: Record<number, string>;
  faceRefs?: CharacterFaceRef[];
  // Custom Element 제거됨 (v2 예정)
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
    config: { ...DEFAULT_VIDEO_CONFIG },
  });

  const mountedRef = useRef(true);
  const cutsRef = useRef(cuts);
  cutsRef.current = cuts; // 매 렌더마다 최신 cuts 동기화
  const pollTimers = useRef<Map<number, NodeJS.Timeout>>(new Map());
  // 동일 cutNumber에 대한 중복 폴링 방지
  const activePolls = useRef<Set<number>>(new Set());
  const autoModeRef = useRef(false);
  const retryingCuts = useRef<Set<number>>(new Set()); // auto-retry 중복 방지
  // 피드백 기반 재생성 시 cuts prop mutation 대신 사용하는 prompt override
  const promptOverridesRef = useRef<Map<number, string>>(new Map());

  // ── 3-way comparison 스냅샷 저장 (per cut) ──
  const shotSnapshotsRef = useRef<Map<number, ShotSnapshots>>(new Map());

  // ── Duration 추적 메타 (마지막 생성 기준) ──
  const [lastDurationMeta, setLastDurationMeta] = useState<DurationMeta | null>(null);

  // ── Narration Audio Pipeline 상태 ──
  const [audioMeta, setAudioMeta] = useState<AudioMeta | null>(null);
  const [narrationStatus, setNarrationStatus] = useState<"idle" | "generating" | "completed" | "failed">("idle");

  // ── Narration dirty-state 추적 ──
  const [shotNarrationStates, setShotNarrationStates] = useState<Map<number, ShotNarrationState>>(() => new Map<number, ShotNarrationState>());
  const [sequenceNarrationState, setSequenceNarrationState] = useState<SequenceNarrationState>({
    dirtyShotCount: 0,
    allShotsInSync: true,
    lastGeneratedSnapshotId: "",
  });
  const [batchNarrationState, setBatchNarrationState] = useState<BatchNarrationRegenerationState>({
    isRunning: false,
    total: 0,
    completed: 0,
    failed: 0,
    activeCutNumber: null,
    failedCutNumbers: [],
    warnings: [],
  });

  /** shot의 narration dirty-state를 재계산 */
  const recomputeSequenceNarrationState = useCallback((states: Map<number, ShotNarrationState>) => {
    let dirtyShotCount = 0;
    states.forEach((s) => { if (s.narrationDirty) dirtyShotCount++; });
    setSequenceNarrationState(prev => ({
      ...prev,
      dirtyShotCount,
      allShotsInSync: dirtyShotCount === 0 && states.size > 0,
    }));
  }, []);

  /** shot narration 편집 시 dirty 마킹 */
  const markNarrationDirty = useCallback((cutNumber: number, field: "text" | "mode", newValue: string) => {
    setShotNarrationStates(prev => {
      const next = new Map(prev);
      const defaultState: ShotNarrationState = {
        mode: "auto",
        currentText: "",
        lastGeneratedText: "",
        narrationDirty: false,
        lastGeneratedAudioUrl: "",
        lastGeneratedSyncStatus: "",
        lastGeneratedAt: 0,
        lastGeneratedMode: "auto",
      };
      const fromMap = next.get(cutNumber);
      const existing: ShotNarrationState = fromMap !== undefined ? fromMap : defaultState;
      const updated: ShotNarrationState = { ...existing };
      if (field === "text") {
        updated.currentText = newValue;
        updated.narrationDirty = newValue !== updated.lastGeneratedText || updated.mode !== updated.lastGeneratedMode;
      } else if (field === "mode") {
        updated.mode = newValue as "auto" | "manual" | "mute";
        updated.narrationDirty = updated.mode !== updated.lastGeneratedMode || updated.currentText !== updated.lastGeneratedText;
      }
      next.set(cutNumber, updated);
      recomputeSequenceNarrationState(next);
      return next;
    });
  }, [recomputeSequenceNarrationState]);

  /** shot narration 상태를 history/restore용으로 초기화 */
  const initShotNarrationState = useCallback((cutNumber: number, mode: "auto" | "manual" | "mute", text: string, audioUrl?: string, syncStatus?: string, generatedAt?: number) => {
    setShotNarrationStates(prev => {
      const next = new Map(prev);
      next.set(cutNumber, {
        mode,
        currentText: text,
        lastGeneratedText: audioUrl ? text : "",
        narrationDirty: false,
        lastGeneratedAudioUrl: audioUrl || "",
        lastGeneratedSyncStatus: (syncStatus || "") as "exact" | "trimmed" | "padded" | "",
        lastGeneratedAt: generatedAt || 0,
        lastGeneratedMode: mode,
      });
      recomputeSequenceNarrationState(next);
      return next;
    });
  }, [recomputeSequenceNarrationState]);

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
      mountedRef.current = false;
      timers.forEach((timer) => clearTimeout(timer));
      polls.clear();
    };
  }, []);

  // ── 페이지 로드 시 미완료 작업 복구 ──────────────────────────────────
  // localStorage에 저장된 submitted/processing/timeout_recoverable 작업을 감지하고
  // 사용자에게 알린다 (자동 polling 재개는 resumeJob에서 수동으로)
  const [recoverableJobs, setRecoverableJobs] = useState<VideoJobRecord[]>([]);
  useEffect(() => {
    const jobs = getRecoverableJobs();
    if (jobs.length > 0) {
      setRecoverableJobs(jobs);
      console.log(`[recovery] ${jobs.length}개 미완료 작업 발견`, jobs.map(j => ({
        jobId: j.jobId, taskId: j.taskId, cutNumber: j.cutNumber, status: j.status,
      })));
    }
    // 오래된 완료/실패 작업 정리
    cleanupOldJobs();
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
  const updateConfig = useCallback((config: Partial<VideoGenerationConfig>) => {
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

  // 폴링 시작 — core pollVideoTask() 위임, 중복 실행 방지
  const startPolling = useCallback(async (
    cutNumber: number,
    operationName: string,
    engine: "veo" = "veo",
    taskId?: string,
    isExtend?: boolean,
    variantsToPreserve?: VideoVariant[],
    jobId?: string,
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

    // ══════════════════════════════════════════════════════════════════
    // handlePollCompleted — COMPLETED 후처리 (upload/variant/frame/quality/record)
    // polling loop에서 분리하여 pollVideoTask() 결과와 동일한 shape로 호출 가능
    // ══════════════════════════════════════════════════════════════════
    const handlePollCompleted = async (
      pollData: {
        videoUri?: string;
        rawVideoUri?: string;
        canonicalVideoUri?: string | null;
        needsUpload?: boolean;
        seed?: string;
        variants?: VideoVariant[];
        _diag?: Record<string, unknown>;
      },
      pollMeta: { pollCount: number; tPollStart: number },
    ): Promise<void> => {
      if (!mountedRef.current) return; // unmount 후 state 업데이트 방지
      const finalUri = pollData.variants?.[0]?.videoUri || pollData.videoUri;
      if (!finalUri) {
        updateClip(cutNumber, { status: "failed", error: "영상 생성 완료되었으나 비디오 URL이 없습니다" });
        return;
      }

      // ── Scene Extension 진단 ──
      const diag = pollData._diag as {
        sceneExtensionReady?: boolean;
        primaryUriType?: string;
        extractedKinds?: string[];
      } | undefined;

      if (diag && !diag.sceneExtensionReady) {
        console.warn(`[CUT ${cutNumber}] ⚠️ Scene Extension 불가 (서버 진단)`, {
          primaryUriType: diag.primaryUriType,
          extractedKinds: diag.extractedKinds,
          rawVideoUri: pollData.rawVideoUri ? `${pollData.rawVideoUri.slice(0, 60)}…` : "(empty)",
          hint: "다음 컷은 IMAGE_TO_VIDEO 또는 TEXT_TO_VIDEO로 생성됩니다.",
        });
      }

      // ── Google API URL → 프록시 URL 변환 (브라우저 직접 접근 시 403 방지) ──
      const toProxyUri = (uri: string | undefined): string | undefined => {
        if (!uri) return uri;
        if (uri.includes("generativelanguage.googleapis.com")) {
          return `/api/proxy-video?uri=${encodeURIComponent(uri)}`;
        }
        return uri;
      };

      // ── clipUpdate 구성 ──
      const clipUpdate: Partial<VideoClip> = {
        status: "completed",
        videoUri: toProxyUri(pollData.videoUri) || pollData.videoUri,
        rawVideoUri: pollData.rawVideoUri,
        seed: pollData.seed || undefined,
        completedAt: Date.now(),
      };

      // ── Variant 병합 ──
      if (pollData.variants && pollData.variants.length > 0) {
        const newVariants = pollData.variants as VideoVariant[];
        const merged = variantsToPreserve ? [...variantsToPreserve, ...newVariants] : newVariants;
        const selectedIdx = variantsToPreserve ? merged.length - 1 : 0;
        clipUpdate.variants = merged;
        clipUpdate.selectedVariant = selectedIdx;

        const variantWithUri = newVariants.find(v =>
          v.rawVideoUri && (v.rawVideoUri.startsWith("gs://") || v.rawVideoUri.startsWith("https://"))
        );
        const bestVariant = variantWithUri || newVariants[0];
        clipUpdate.videoUri = toProxyUri(bestVariant.videoUri) || bestVariant.videoUri;
        clipUpdate.rawVideoUri = bestVariant.rawVideoUri;
        clipUpdate.seed = bestVariant.seed;

        if (variantWithUri && variantWithUri !== newVariants[0]) {
          console.log(`[CUT ${cutNumber}] URI가 있는 variant 선택 (Scene Extension 우선):`, {
            selectedUri: variantWithUri.rawVideoUri?.slice(0, 60),
          });
        }
      } else if (variantsToPreserve && clipUpdate.videoUri) {
        const newVariant: VideoVariant = { videoUri: toProxyUri(clipUpdate.videoUri) || clipUpdate.videoUri, rawVideoUri: clipUpdate.rawVideoUri, seed: clipUpdate.seed };
        clipUpdate.variants = [...variantsToPreserve, newVariant];
        clipUpdate.selectedVariant = clipUpdate.variants.length - 1;
      }

      // ── Upload workflow ──
      if (pollData.canonicalVideoUri) {
        clipUpdate.canonicalVideoUri = pollData.canonicalVideoUri;
        clipUpdate.uploadStatus = "skipped";
        clipUpdate.sceneExtensionEligible = true;
        console.log(`[CUT ${cutNumber}] 📦 ASSET_STORED (서버 제공):`, pollData.canonicalVideoUri.slice(0, 80));
      } else if (pollData.needsUpload && clipUpdate.videoUri) {
        clipUpdate.uploadStatus = "pending";
        console.log(`[CUT ${cutNumber}] 📤 UPLOAD_PENDING → /api/upload-video 호출`);
        try {
          const videoDataUri = clipUpdate.videoUri;
          let base64Data = "";
          if (videoDataUri.startsWith("data:")) {
            base64Data = videoDataUri.replace(/^data:[^;]+;base64,/, "");
          } else if (videoDataUri.startsWith("/api/proxy-video")) {
            clipUpdate.uploadStatus = "skipped";
            clipUpdate.sceneExtensionEligible = false;
            console.warn(`[CUT ${cutNumber}] videoUri가 프록시 URL — 업로드 스킵 (Scene Extension 불가)`);
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
                diag?: Record<string, unknown>;
              };
              if (uploadData.canonicalVideoUri) {
                clipUpdate.canonicalVideoUri = uploadData.canonicalVideoUri;
                clipUpdate.uploadStatus = "success";
                clipUpdate.uploadStorage = uploadData.storage as "r2" | "gcs" | undefined;
                clipUpdate.sceneExtensionEligible = true;
                console.log(`[CUT ${cutNumber}] 📦 ASSET_STORED (업로드):`, {
                  uri: uploadData.canonicalVideoUri.slice(0, 80),
                  storage: uploadData.storage,
                });
              } else if (uploadData.proxyUri) {
                const isAbsolute = uploadData.proxyUri.startsWith("https://");
                clipUpdate.uploadStatus = "success";
                clipUpdate.uploadStorage = "r2";
                if (isAbsolute) {
                  clipUpdate.canonicalVideoUri = uploadData.proxyUri;
                  clipUpdate.sceneExtensionEligible = true;
                  console.log(`[CUT ${cutNumber}] 📦 ASSET_STORED (R2 proxy → canonical):`, uploadData.proxyUri.slice(0, 80));
                } else {
                  clipUpdate.sceneExtensionEligible = false;
                  console.log(`[CUT ${cutNumber}] 📦 ASSET_STORED (R2, relative proxy) — Scene Extension 불가`);
                }
              }
            } else {
              const errText = await uploadRes.text().catch(() => "");
              clipUpdate.uploadStatus = "failed";
              clipUpdate.uploadError = `HTTP ${uploadRes.status}: ${errText.slice(0, 200)}`;
              clipUpdate.sceneExtensionEligible = false;
              console.warn(`[CUT ${cutNumber}] ❌ UPLOAD_FAILED (${uploadRes.status}):`, errText.slice(0, 200));
            }
          }
        } catch (uploadErr) {
          clipUpdate.uploadStatus = "failed";
          clipUpdate.uploadError = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          clipUpdate.sceneExtensionEligible = false;
          console.warn(`[CUT ${cutNumber}] ❌ UPLOAD_FAILED (exception):`, clipUpdate.uploadError);
        }
      } else {
        clipUpdate.uploadStatus = "none";
        clipUpdate.sceneExtensionEligible = !!clipUpdate.canonicalVideoUri;
      }

      if (!mountedRef.current) return; // unmount 후 state 업데이트 방지
      updateClip(cutNumber, clipUpdate);

      // ── 타이밍 ──
      const tPollEnd = performance.now();
      const pollTotalMs = Math.round(tPollEnd - pollMeta.tPollStart);
      console.log(`[CUT ${cutNumber}] ⏱ polling`, {
        pollCount: pollMeta.pollCount,
        pollTotalMs,
        avgPollMs: pollMeta.pollCount > 0 ? Math.round(pollTotalMs / pollMeta.pollCount) : 0,
      });

      // ── 완료 후 진단 로그 ──
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
          uploadStatus: clipUpdate.uploadStatus || "unknown",
          uploadStorage: clipUpdate.uploadStorage || "(N/A)",
          uploadError: clipUpdate.uploadError || "(없음)",
          sceneExtensionEligible: clipUpdate.sceneExtensionEligible ?? false,
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
              possibleFix: "R2 (VIDEO_BUCKET 바인딩) 또는 VIDEO_BUCKET(R2) 설정으로 업로드 가능",
            }
          );
        }
      }

      // ── 영상 기록 저장 (localStorage) ──
      try {
        const proxyUri = clipUpdate.videoUri || "";
        const gcsUri = clipUpdate.canonicalVideoUri || clipUpdate.rawVideoUri || "";
        if (!proxyUri) {
          console.warn(`[CUT ${cutNumber}] ⚠️ 영상 기록 저장 건너뜀: proxyUri 없음`);
        } else {
          const cut = cutsRef.current.find((c) => c.cutNumber === cutNumber);
          const clipForRecord = state.clips.find(c => c.cutNumber === cutNumber);
          const saved = saveVideoRecord({
            operationName,
            engine,
            gcsUri,
            proxyUri,
            prompt: cut?.videoPrompt?.slice(0, 500) || "",
            mode: isExtend ? "extend" : "generate",
            durationSec: cut?.durationSec && cut.durationSec > 0 ? cut.durationSec : DURATION_FALLBACK,
            cutNumber,
            sourceCutId: isExtend && cutNumber > 1 ? cutNumber - 1 : undefined,
            seed: clipUpdate.seed,
            status: "completed",
            structuredSequence: clipForRecord?.structuredSequence as unknown as Record<string, unknown> | undefined,
          });
          console.log(`[CUT ${cutNumber}] ✅ 영상 기록 저장됨 (id: ${saved.id})`);
        }
      } catch (err) {
        console.warn(`[CUT ${cutNumber}] ⚠️ 영상 기록 저장 실패:`, err);
      }

      if (pollData.seed && onSeedDetected) {
        onSeedDetected(cutNumber, pollData.seed);
      }

      // ── 마지막 프레임 캡처 + 품질 검증 ──
      if (clipUpdate.videoUri) {
        try {
          const lastFrame = await captureVideoLastFrame(clipUpdate.videoUri);
          if (lastFrame) {
            updateClip(cutNumber, { lastFrameBase64: lastFrame });
            console.log(`[CUT ${cutNumber}] lastFrame 저장 완료 — 다음 컷 continuity 준비됨`);

            // ── Actual endState 추출: Gemini 프레임 분석 (비동기, continuity 강화) ──
            // continuity mode에서 실제 생성 결과 기반 endState를 다음 컷에 전파.
            // 실패해도 기존 계획 기반 continuity는 유지됨 (보완 레이어).
            {
              const nextCutNumber = cutNumber + 1;
              const nextCut = cutsRef.current.find(c => c.cutNumber === nextCutNumber);
              const currentCut = cutsRef.current.find(c => c.cutNumber === cutNumber);
              if (nextCut && currentCut?.continuitySegment) {
                fetch("/api/analyze-frame", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    frameBase64: lastFrame,
                    sceneContext: currentCut.sceneDescription?.slice(0, 200) || "",
                  }),
                }).then(async (afRes) => {
                  if (afRes.ok) {
                    const afData = await afRes.json();
                    if (afData.success && afData.state) {
                      // actual endState를 다음 컷의 continuitySegment.startState로 업데이트
                      console.log(`[CUT ${cutNumber}] actual endState 추출 성공 → CUT ${nextCutNumber} startState 업데이트`, {
                        source: "gemini_frame_analysis",
                        subjectPosition: afData.state.subjectPosition?.slice(0, 50),
                        cameraState: afData.state.cameraState?.slice(0, 50),
                      });
                      // cutsRef를 통해 다음 컷의 continuitySegment 업데이트 (불변성 유지)
                      if (nextCut.continuitySegment) {
                        const updatedSegment = {
                          ...nextCut.continuitySegment,
                          startState: afData.state,
                          _endStateSource: "gemini_frame_analysis" as const,
                        };
                        const updatedNextCut = { ...nextCut, continuitySegment: updatedSegment };
                        cutsRef.current = cutsRef.current.map(c =>
                          c.cutNumber === nextCutNumber ? updatedNextCut : c
                        );
                      }
                    } else {
                      console.log(`[CUT ${cutNumber}] Gemini 프레임 분석 실패 → 계획 기반 continuity 유지`, {
                        error: afData.error,
                        fallback: "plan_based",
                      });
                    }
                  } else {
                    console.warn(`[CUT ${cutNumber}] analyze-frame API 실패(${afRes.status}) → 계획 기반 continuity 유지`);
                  }
                }).catch((err) => {
                  console.warn(`[CUT ${cutNumber}] analyze-frame 예외 → 계획 기반 continuity 유지:`, err);
                });
              }
            }

            const cut = cutsRef.current.find((c) => c.cutNumber === cutNumber);
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
                        videoCompatibility: rawScores.visualQuality,
                      },
                      rawScores,
                      issues: quality.issues || [],
                      suggestions: quality.suggestion ? [quality.suggestion] : [],
                    },
                  });
                }
              }
            }).catch((err) => {
              console.warn(`[CUT ${cutNumber}] quality verification failed:`, err);
            });
          }
        } catch {
          // Quality verification is optional, don't block
        }
      }

      // ── 타이밍: 후처리 완료 ──
      const tPostEnd = performance.now();
      const postProcessMs = Math.round(tPostEnd - tPollEnd);
      console.log(`[CUT ${cutNumber}] ⏱ postProcess`, { postProcessMs });
      console.log(`[CUT ${cutNumber}] ⏱ TOTAL (polling loop)`, {
        pollTotalMs,
        postProcessMs,
        totalMs: Math.round(tPostEnd - pollMeta.tPollStart),
        pollCount: pollMeta.pollCount,
      });

      // ── 자동 모드 완료 체크 ──
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
    };

    // ══════════════════════════════════════════════════════════════════
    // handlePollFailed — FAILED 후처리 (auto-retry 포함)
    // ══════════════════════════════════════════════════════════════════
    const handlePollFailed = (
      failData: { error?: string; noRetry?: boolean },
      attempt: number,
    ): void => {
      if (!mountedRef.current) return; // unmount 후 state 업데이트 방지
      console.error(`[CUT ${cutNumber}] 생성 실패:`, failData.error || "unknown error", { noRetry: failData.noRetry, attempt });
      setState((prev) => {
        const clip = prev.clips.find((c) => c.cutNumber === cutNumber);
        const retryCount = clip?.retryCount || 0;
        const cfg = prev.config;

        if (!failData.noRetry && cfg.autoRetryOnFailure && retryCount < cfg.maxRetryCount) {
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
            ? { ...c, status: "failed" as VideoGenStatus, error: failData.error || "생성 실패" }
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
    };

    // ══════════════════════════════════════════════════════════════════
    // Polling — core의 pollVideoTask()에 완전 위임
    // interval / backoff / max attempts / terminal status 해석 모두 core 담당
    // hook은 결과를 받아 handlePollCompleted / handlePollFailed만 호출
    // ══════════════════════════════════════════════════════════════════
    const tPollStart = performance.now();

    try {
      const result: NormalizedVideoResult = await pollVideoTask(
        taskId ?? operationName,
        {
          extraPollBody: {
            operationName,
            isExtend: isExtend ?? false,
            cutNumber,
          },
          onProgress: (attempt, maxAttempts) => {
            if (attempt % 12 === 11) {
              console.log(`[CUT ${cutNumber}] 폴링 진행 중 — poll #${attempt + 1}/${maxAttempts}, engine=${engine}`);
            }
          },
          jobId,
          longRunning: true,
        },
      );

      if (result.status === "completed") {
        await handlePollCompleted(
          {
            videoUri: result.videoUri,
            rawVideoUri: result.rawVideoUri,
            canonicalVideoUri: result.canonicalVideoUri,
            needsUpload: result.needsUpload,
            seed: result.seed,
            variants: result.variants,
            _diag: result._diag,
          },
          { pollCount: result.pollMeta.totalAttempts, tPollStart },
        );
      } else if (result.status === "failed") {
        handlePollFailed(
          { error: result.error, noRetry: result.noRetry },
          result.pollMeta.totalAttempts,
        );
      } else if (result.status === "timeout_recoverable") {
        // 장기 생성 — 서버에서 계속 처리 중일 수 있음
        updateClip(cutNumber, {
          status: "failed",
          error: result.error || "시간이 오래 걸리고 있어요. '다시 확인' 버튼을 눌러주세요.",
          // taskId를 보존하여 복구 가능
          operationName: operationName,
        });
        console.warn(`[CUT ${cutNumber}] timeout_recoverable — taskId=${taskId ?? operationName}, jobId=${jobId}`);
      } else {
        // timeout — hard timeout (longRunning=false 경로)
        const classified = classifyVideoError(new Error(result.error || "영상 생성 시간 초과"));
        updateClip(cutNumber, { status: "failed", error: classified.message });
      }
    } finally {
      activePolls.current.delete(cutNumber);
      pollTimers.current.delete(cutNumber);
    }
  }, [updateClip, onSeedDetected, state.clips]);

  // 미완료 작업 polling 재개
  const resumeJob = useCallback((job: VideoJobRecord) => {
    if (!job.taskId) return;
    // recoverableJobs 목록에서 제거
    setRecoverableJobs(prev => prev.filter(j => j.jobId !== job.jobId));
    // 해당 cutNumber의 clip을 polling 상태로 전환
    updateClip(job.cutNumber, {
      status: "polling",
      operationName: job.operationName || job.taskId,
    });
    try {
      startPolling(
        job.cutNumber,
        job.operationName || job.taskId,
        (job.engine as "veo") || "veo",
        job.taskId,
        false,
        undefined,
        job.jobId,
      );
    } catch (err) {
      // 폴링 시작 실패 → recoverableJobs에 복원 + clip 상태 롤백
      console.error(`[resumeJob] CUT ${job.cutNumber} 폴링 재개 실패:`, err);
      setRecoverableJobs(prev => [...prev, job]);
      updateClip(job.cutNumber, {
        status: "failed",
        error: `작업 복구 실패: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [updateClip, startPolling]);

  // Auto-retry effect: when a clip becomes "idle" with retryCount > 0, auto-generate
  useEffect(() => {
    if (!mountedRef.current) return;
    const clipToRetry = state.clips.find(
      (c) => c.status === "idle" && c.retryCount && c.retryCount > 0
        && !activePolls.current.has(c.cutNumber) // 이미 폴링 중인 컷 제외
        && !retryingCuts.current.has(c.cutNumber) // 이미 재시도 시작한 컷 제외
    );
    if (clipToRetry) {
      retryingCuts.current.add(clipToRetry.cutNumber);
      generateCut(clipToRetry.cutNumber).finally(() => {
        retryingCuts.current.delete(clipToRetry.cutNumber);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.clips]);

  // 단일 장면 생성
  const generateCut = useCallback(async (cutNumber: number, preserveVariants?: boolean) => {
    const t0 = performance.now(); // ── 전체 시작
    let cut = cuts.find((c) => c.cutNumber === cutNumber);
    if (!cut) return;

    // 피드백 기반 재생성 시 prompt override 적용 (prop mutation 대신)
    const promptOverride = promptOverridesRef.current.get(cutNumber);
    if (promptOverride) {
      cut = { ...cut, videoPrompt: promptOverride };
      promptOverridesRef.current.delete(cutNumber); // 1회성 사용 후 제거
    }

    const cfg = state.config;
    // legacyPrompt: safety retry 등 극한 fallback에서만 사용.
    // 주 경로에서는 structuredSequence가 source of truth이므로
    // 이 값을 body.prompt에 넣거나 source of truth로 취급하면 안 된다.
    let legacyPrompt: string;
    if (cutNumber === 1) {
      legacyPrompt = cut.videoPrompt;
    } else if (cut.extendPrompt && cut.extendPrompt.trim().length > 0) {
      legacyPrompt = cut.extendPrompt;
    } else {
      // Priority A: 이전 컷 데이터로 연속성 컨텍스트를 합성한 fallback prompt 생성
      const prevCut = cutsRef.current.find((c) => c.cutNumber === cutNumber - 1);
      if (prevCut) {
        const continuityParts: string[] = [];
        if (prevCut.sceneDescription) {
          continuityParts.push(`Continuing from: ${prevCut.sceneDescription.slice(0, 80)}`);
        }
        if (prevCut.cameraDirection) {
          continuityParts.push(`Previous camera: ${prevCut.cameraDirection}`);
        }
        if (prevCut.moodLighting) {
          continuityParts.push(`Mood: ${prevCut.moodLighting}`);
        }
        const currentScene = cut.videoPrompt || cut.sceneDescription || "";
        continuityParts.push(currentScene);
        legacyPrompt = continuityParts.filter(Boolean).join(". ");
        console.warn(`[CUT ${cutNumber}] extendPrompt 없음 — 이전 컷 컨텍스트로 합성 fallback 생성 (${continuityParts.length}개 요소)`);
      } else {
        console.warn(`[CUT ${cutNumber}] extendPrompt 없음 + 이전 컷 없음 — videoPrompt 사용. 연속성 완전 손실.`);
        legacyPrompt = cut.videoPrompt;
      }
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
                videoPrompt: legacyPrompt,
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
                  videoPrompt: legacyPrompt,
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

        // refine 결과 적용 (legacyPrompt는 safety fallback 전용)
        if (refinedPrompt) {
          legacyPrompt = refinedPrompt;
        }

        // ═══ verify-prompt: 생성 차단 판정만 동기, 나머지는 비동기 ═══════════
        // 핵심 변경: verify-prompt의 overallScore < 30 차단만 동기로 처리
        // 점수 80 이하 프롬프트 교체 + UI 업데이트는 비동기(생성과 병렬)
        if (cfg.autoVerifyPrompts) {
          const verification = await verifyPrompt(cut);
          if (verification) {
            updateClip(cutNumber, { verification });

            if (verification.overallScore < 80 && verification.improvedVideoPrompt) {
              legacyPrompt = cutNumber === 1
                ? verification.improvedVideoPrompt
                : (verification.improvedExtendPrompt || legacyPrompt);
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

      // ═══ JSON-first 조립 (sequence-assembler) ════════════════════════
      // assembleFromJSON()은 JSON document만 구축한다.
      // 문자열 prompt는 반환하지 않는다.
      // 직렬화는 body 생성 시 provider가 string-only이면 그때만 수행.
      const prevCutData = cutNumber > 1
        ? cuts.find((c) => c.cutNumber === cutNumber - 1)
        : undefined;

      const assembled = assembleFromJSON({
        cut,
        config: cfg,
        prevCut: prevCutData,
      });

      const sequence = assembled.structuredSequence;

      // ── Bridge: progression-aware multiShot override ──────────────────
      // When shot-splitting detects arrow progression (A → B → C) or other
      // content-aware progressions, it produces suggestedMultiShot.
      // This MUST override Cut.multiShot so editor/preview/submit all
      // reflect the real split structure instead of generic role-based shots.
      if (assembled.suggestedMultiShot && assembled.suggestedMultiShot.length >= 2) {
        // Only override if the cut doesn't already have user-edited multiShot
        // that differs in count (user may have manually adjusted)
        const existingCount = cut.multiShot?.length ?? 0;
        const suggestedCount = assembled.suggestedMultiShot.length;
        if (existingCount < 2 || existingCount === suggestedCount) {
          cut = { ...cut, multiShot: assembled.suggestedMultiShot };
          console.log(`[CUT ${cutNumber}] 🔗 Progression-aware multiShot bridge: ${suggestedCount} shots from shot-splitting`);
        }
      }

      // ── 3-way snapshot: original (assembleFromJSON 직후, QA 전) ──
      const snapshotOriginal = JSON.parse(JSON.stringify(sequence)) as StructuredSequenceDocument;
      shotSnapshotsRef.current.set(cutNumber, {
        cutNumber,
        original: snapshotOriginal,
      });

      // ── PREFLIGHT DRIFT DETECTION (비용 보호) ──────────────────────
      if (assembled.diagnostics.driftWarning) {
        console.error(`[CUT ${cutNumber}] ⛔ ${assembled.diagnostics.driftWarning}`);
        updateClip(cutNumber, {
          status: "failed",
          error: assembled.diagnostics.driftWarning,
          structuredSequence: sequence,
        });
        return;
      }

      // ── Gemini QA: preflight quality check + auto-fix ──────────────────
      if (sequence) {
        const qaResult = preflightQualityCheck(sequence);
        if (qaResult.autoFixCount > 0) {
          const { fixed, appliedFixes } = applyQualityFixes(sequence, qaResult);
          // 수정된 sequence로 교체
          Object.assign(sequence, fixed);
          console.log(`[CUT ${cutNumber}] 🔧 QA auto-fix: ${appliedFixes.length} fixes`, appliedFixes);

          // ── 3-way snapshot: autoFixed (QA 적용 후) ──
          const snap = shotSnapshotsRef.current.get(cutNumber);
          if (snap) {
            snap.autoFixed = JSON.parse(JSON.stringify(sequence)) as StructuredSequenceDocument;
            snap.provenance = {
              ...snap.provenance,
              cutNumber,
              qaScore: qaResult.score,
              autoFixCount: appliedFixes.length,
            };
          }
        }
        if (qaResult.issues.length > 0) {
          console.log(`[CUT ${cutNumber}] 📋 QA preflight: score=${qaResult.score}/100, errors=${qaResult.issues.filter(i => i.severity === "error").length}, warnings=${qaResult.issues.filter(i => i.severity === "warning").length}`);
        }
        // score < 30 = hard block (심각한 품질 문제)
        if (qaResult.score < 30) {
          const errorSummary = qaResult.issues
            .filter(i => i.severity === "error")
            .map(i => i.message)
            .join("; ");
          console.error(`[CUT ${cutNumber}] ⛔ QA BLOCK: score=${qaResult.score}, errors: ${errorSummary}`);
          updateClip(cutNumber, {
            status: "failed",
            error: `QA preflight blocked (score=${qaResult.score}): ${errorSummary}`,
            structuredSequence: sequence,
          });
          return;
        }
      }

      // ── 품질 체크리스트 (프롬프트 사전 검증) ─────────────────────────
      // Source: canonical shotPlan (preferred) → Cut.videoPromptJson (legacy fallback)
      // ShotPlan uses structured sub-objects; VideoPromptJson uses flat strings.
      const canonicalVideoPromptJson = sequence.shotPlan ? {
        shotSize: sequence.shotPlan.camera.framing,
        cameraAngle: sequence.shotPlan.camera.angle,
        cameraMovement: sequence.shotPlan.camera.motion,
        subjectBlocking: sequence.shotPlan.subject?.blocking || sequence.shotPlan.subject?.primary || "",
        subjectAction: sequence.shotPlan.action,
        actionBeat: cut.videoPromptJson?.actionBeat || "",
        bodySignal: cut.videoPromptJson?.bodySignal || "",
        revealed: cut.videoPromptJson?.revealed || "",
        withheld: cut.videoPromptJson?.withheld || "",
        timingBeat: sequence.shotPlan.timingBeat || "",
        transitionFromPrev: sequence.shotPlan.transitionFromPrev || "",
        characterRef: sequence.shotPlan.subject?.characterRef || "",
        moodLighting: sequence.shotPlan.moodLighting || "",
        styleSuffix: sequence.styleProfile?.mode || cut.videoPromptJson?.styleSuffix || "",
        locationCue: sequence.shotPlan.locationCue,
        situationCue: sequence.shotPlan.situationCue,
        emotionalAnchor: sequence.shotPlan.emotionalAnchor,
      } as import("@/types").VideoPromptJson : cut.videoPromptJson;
      if (canonicalVideoPromptJson && assembled.preview) {
        const checklist = generateQualityChecklist(assembled.preview.renderedPrompt, canonicalVideoPromptJson, {
          shotCategory: cut.shotCategory,
          characterRole: cut.characterRole,
        });
        updateClip(cutNumber, { qualityChecklist: checklist });
      }

      // ── UI에 structuredSequence 저장 (유일한 source of truth) ──
      // fallbackRenderedPrompt는 디버그 미리보기 전용 — source of truth 아님
      updateClip(cutNumber, {
        structuredSequence: sequence,
        fallbackRenderedPrompt: assembled.preview?.renderedPrompt,
        finalPrompt: assembled.preview?.renderedPrompt, // deprecated alias
        assembledDebug: assembled.preview ? {
          styleBlock: assembled.document.reinforcement.styleSuffix,
          consistencyBlock: assembled.document.continuity.characterRef || "",
          cameraBlock: Object.values(assembled.preview.sections).find(s => s.includes("shot,")) || "",
          sceneBlock: assembled.document.subject.primary.slice(0, 200),
          reinforcementBlock: assembled.document.reinforcement.mediumLock || "",
          negativeBlock: sequence.negatives ? [...new Set([...sequence.negatives.universal, ...sequence.negatives.sceneSpecific, ...sequence.negatives.failureMode, ...sequence.negatives.user])].slice(0, 30).join(", ") : "",
          isMapScene: assembled.preview.isMapScene,
        } : undefined,
      });

      // ── JSON-first 파이프라인 디버그 로그 ──────────────────────────────
      console.log(`[CUT ${cutNumber}] 📝 SEQUENCE ASSEMBLED (JSON-first)`, {
        animationMode: cfg.animationMode || "(없음)",
        shotCategory: cut.shotCategory || "(없음)",
        isMapScene: assembled.preview?.isMapScene ?? false,
        previewWordCount: assembled.preview?.wordCount ?? 0,
        sequenceValidation: sequence.validation,
        sanitizeFixes: assembled.diagnostics.sanitizeFixes.length,
        conflictResolutions: assembled.diagnostics.conflictResolutions.length,
        shotPlan: {
          framing: sequence.shotPlan.camera.framing,
          angle: sequence.shotPlan.camera.angle,
          motion: sequence.shotPlan.camera.motion,
          action: sequence.shotPlan.action?.slice(0, 80),
        },
      });

      if (assembled.diagnostics.validation.issues.length > 0) {
        console.log(`[CUT ${cutNumber}] 🔍 VALIDATION`, {
          valid: assembled.diagnostics.validation.valid,
          issues: assembled.diagnostics.validation.issues.map(i => `[${i.severity}] ${i.rule}: ${i.message}`),
        });
      }
      if (assembled.diagnostics.sanitizeFixes.length > 0) {
        console.log(`[CUT ${cutNumber}] 🔧 AUTO-FIXES`, assembled.diagnostics.sanitizeFixes);
      }
      if (assembled.diagnostics.conflictResolutions.length > 0) {
        console.log(`[CUT ${cutNumber}] ⚡ CONFLICT RESOLUTIONS`, assembled.diagnostics.conflictResolutions);
      }

      // ── Continuity firstFrame 취득 (우선순위 순) ──
      // autoLinkFirstFrame이 OFF면 CUT N>1에서도 frame chaining 비활성화.
      // CUT 1: 사용자 설정값 / CUT N>1: autoLinkFirstFrame ON일 때만 이전 컷과 연결.
      const shouldLinkFrames = cfg.autoLinkFirstFrame !== false; // 기본값 true
      let firstFrameBase64 = cutNumber === 1 ? cfg.firstFrameBase64 : undefined;
      let continuityFrameSource: string = "none"; // 디버그용 추적

      if (cutNumber > 1 && prevClip && shouldLinkFrames) {
        // 1순위: 완료 시 저장된 lastFrameBase64 (재캡처 없이 즉시 사용)
        if (prevClip.lastFrameBase64) {
          firstFrameBase64 = prevClip.lastFrameBase64;
          continuityFrameSource = "lastFrameBase64_cached";
          console.log(`[CUT ${cutNumber}] continuity: 저장된 lastFrame 사용 (CUT ${cutNumber - 1})`);
        } else if (prevClip.videoUri) {
          // 2순위: 이전 컷 비디오에서 직접 캡처
          try {
            const captured = await captureVideoLastFrame(prevClip.videoUri);
            if (captured) {
              firstFrameBase64 = captured;
              continuityFrameSource = "video_capture";
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
          continuityFrameSource = "storyboard_end";
          console.log(`[CUT ${cutNumber}] continuity: storyboard end image 사용 (CUT ${cutNumber - 1})`);
        }

        // 4순위: 현재 컷의 START 스토리보드
        if (!firstFrameBase64 && storyboardImages?.[cutNumber]) {
          firstFrameBase64 = storyboardImages[cutNumber];
          continuityFrameSource = "storyboard_start";
          console.log(`[CUT ${cutNumber}] continuity: storyboard start image 사용 (CUT ${cutNumber})`);
        }

        if (!firstFrameBase64) {
          continuityFrameSource = "text_to_video_fallback";
          console.warn(`[CUT ${cutNumber}] continuity: firstFrame 없음 — text-to-video로 생성 (프롬프트에 연속성 포함)`);
        }
      } else if (cutNumber > 1 && !shouldLinkFrames) {
        continuityFrameSource = "disabled_by_autoLinkFirstFrame";
        console.log(`[CUT ${cutNumber}] continuity: autoLinkFirstFrame=OFF — frame chaining 비활성화`);
      } else if (cutNumber === 1 && !firstFrameBase64 && storyboardImages?.[1]) {
        firstFrameBase64 = storyboardImages[1];
        continuityFrameSource = "storyboard_cut1";
      }

      // Auto-link lastFrame from end storyboard image
      let lastFrameBase64 = cutNumber === 1 ? cfg.lastFrameBase64 : undefined;
      if (!lastFrameBase64 && storyboardEndImages?.[cutNumber]) {
        lastFrameBase64 = storyboardEndImages[cutNumber];
      }

      // ── Continuity 디버그 로그 ──
      console.log(`[CUT ${cutNumber}] continuity debug`, {
        autoLinkFirstFrame: shouldLinkFrames,
        continuityFrameSource,
        hasFirstFrame: !!firstFrameBase64,
        hasLastFrame: !!lastFrameBase64,
        hasPrevClip: !!prevClip,
        prevClipHasLastFrame: !!prevClip?.lastFrameBase64,
        prevClipHasVideoUri: !!prevClip?.videoUri,
      });

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
      // 최대 3장 reference image 지원
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
        else if (!canonicalPrevUri && rawPrevUri === "") extensionSkipReason.push("canonicalVideoUri 없음 + rawVideoUri 빈 문자열 (업로드 실패 + base64 응답)");
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
            fix: "VIDEO_BUCKET(R2) 바인딩 또는 VIDEO_BUCKET(R2) 설정으로 업로드/GCS URI 가능",
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
        legacyPromptLen: legacyPrompt.length,
        legacyPromptPrefix: legacyPrompt.slice(0, 120),
        model: VEO_DEFAULT_MODEL,
      });

      // ── 엔진 & 모드 결정 ─────────────────────────────────────────────────
      // VEO = 유일한 생성 엔진
      const engine = "veo" as const;

      // ── 워크플로우 기반 effective model 결정 (clamp 정책에 사용) ──────────
      const _effectiveModel = resolveModelForWorkflow({
        workflow: cfg.workflowType,
        hasImage: !!firstFrameBase64 || !!(storyboardImages?.[cutNumber]),
      });

      // ── 멀티 체인 인식: 체인 첫 컷은 extend 대신 generate (image-to-video) ──
      // CUT 1 또는 체인 첫 컷 → generate, 그 외 → extend
      const multiChainPlan = cutsRef.current.length > 0
        ? buildMultiChainPlan(cutsRef.current.reduce((sum, c) => sum + (c.durationSec ?? 8), 0))
        : null;
      const isChainStart = multiChainPlan?.isMultiChain && isChainFirstCut(multiChainPlan, cutNumber);
      let videoMode: "generate" | "extend" = (cutNumber === 1 || isChainStart) ? "generate" : (cfg.videoMode ?? "extend") as "generate" | "extend";

      console.log(`[CUT ${cutNumber}] videoMode 결정`, {
        cutNumber,
        selectedMode: videoMode,
        reason: cutNumber === 1 ? "cut1_force_generate" : isChainStart ? "chain_first_cut_bridge" : "normal",
        isMultiChain: multiChainPlan?.isMultiChain ?? false,
        chainIndex: multiChainPlan ? getChainForCut(multiChainPlan, cutNumber)?.chainIndex : null,
        durationSec: safeDuration(cfg.durationSeconds),
        engine,
      });

      // VEO extend: sourceVideo = 이전 클립의 안정 URI (canonicalVideoUri 우선)
      // previousVideoUri가 이미 data: URI를 필터링한 우선순위 결과이므로 그대로 사용
      const sourceVideo = (videoMode === "extend" && cutNumber > 1)
        ? (previousVideoUri ?? "")
        : "";

      let continuityDegradation: string | undefined;
      if (videoMode === "extend" && cutNumber > 1 && !sourceVideo) {
        continuityDegradation = "sourceVideo_missing";
        // 클라이언트에서 바로 generate로 전환 (서버까지 extend 보내고 fallback 받는 왕복 낭비 방지)
        videoMode = "generate";
        console.warn(`[CUT ${cutNumber}] ⚠️ CONTINUITY DEGRADED: extend→generate 클라이언트 전환 (sourceVideo 없음)`, {
          prevClipStatus: prevClip?.status,
          prevClipRawVideoUri: prevClip?.rawVideoUri ? "있음" : "없음",
          prevClipCanonicalUri: prevClip?.canonicalVideoUri ? "있음" : "없음",
        });
      }

      // ── cut1 hard guard: extend 관련 필드 완전 차단 ──────────────────────────
      const isCut1 = cutNumber === 1;
      const safeSourceVideo = isCut1 ? undefined : (sourceVideo || undefined);
      const safePrevVideoUri = isCut1 ? undefined : previousVideoUri;
      const safeFirstFrame = isCut1 ? (cfg.firstFrameBase64 || (storyboardImages?.[1]) || undefined) : firstFrameBase64;

      // ── JSON-first body 구성 (core submitVideoGeneration 사용) ──────────
      // structuredSequence가 1급 source of truth.
      const submitParams = {
        structuredSequence: sequence,
        cutNumber,
        engine,
        videoMode,
        workflowType: cfg.workflowType,
        sourceVideo: safeSourceVideo,
        negativePrompt: negativePrompt || undefined,
        firstFrameBase64: safeFirstFrame,
        lastFrameBase64: lastFrameBase64,
        durationSeconds: cfg.durationSeconds,
        aspectRatio: cfg.aspectRatio,
        generateAudio: cfg.generateAudio,
        // VEO 멀티샷: 서버에서 8초 4샷 타임스탬프 자동 생성
        // 클라이언트 multiShot이 있으면 전달, 없으면 서버 auto-generate
        ...((() => {
          const canonicalMultiShot = assembled.suggestedMultiShot ?? cut.multiShot;
          if (canonicalMultiShot && canonicalMultiShot.length > 0) {
            const clamped = canonicalMultiShot.slice(0, 4).map((s, i) => ({
              ...s,
              index: i + 1,
            }));
            return { multiShot: clamped };
          }
          return {};
        })()),
        // 생성 모드 + 의도적 원테이크 전달 (서버 정책 시행용)
        generationMode: cfg.generationMode ?? "batch",
        sceneType: cut.shotCategory,
        intentionalOneTake: cut.intentionalOneTake,
        // separate_clips 모드 — 서브샷마다 독립 VEO 요청
        ...(cfg.separateClips ? { separateClips: true } : {}),
        // 분절 편집 컨텍스트 — UI에서 감지한 context를 server까지 전달
        ...(cut.fragmentedEditContext?.isFragmented ? { fragmentedEditContext: cut.fragmentedEditContext } : {}),
        // VideoPromptJson: canonical-derived preferred over legacy Cut field
        ...(canonicalVideoPromptJson ? { videoPromptJson: canonicalVideoPromptJson } : {}),
        ...(cut.extendPromptJson ? { extendPromptJson: cut.extendPromptJson } : {}),
        // Custom Element 제거됨 (v2에서 VEO Reference Images로 구현 예정)
        // ── Continuity metadata (continuitySegment가 있으면 전달) ──
        ...(cut.continuitySegment ? {
          continuityMeta: {
            segmentIndex: cut.continuitySegment.segmentIndex ?? 0,
            totalSegments: cutsRef.current.length,
            isLastSegment: cut.continuitySegment.isLastSegment ?? (cutNumber === cutsRef.current.length),
            prevEndState: cut.continuitySegment.startState as unknown as Record<string, unknown> | undefined,
            characterLock: cut.characterConsistency || "",
            // Client sends the raw styleSuffix — server's extractCompactVisualLock()
            // is authoritative about what to keep (medium, material, palette, light)
            // and what to discard (aspect ratio, "no text", emotional tone).
            // Empty string = omit visual lock entirely (style is already in the prompt).
            visualLock: cut.videoPromptJson?.styleSuffix || "",
          },
        } : {}),
        extraFields: {
          mode: cfg.mode,
          resolution: cfg.resolution,
          personGeneration: cfg.personGeneration,
          sampleCount: cfg.sampleCount,
          seed: cfg.seed,
          previousVideoUri: safePrevVideoUri,
          referenceImages: finalRefImages.length > 0 ? finalRefImages : undefined,
          // continuity 디버그 필드
          continuityFrameSource,
          autoLinkFirstFrame: shouldLinkFrames,
        },
      };

      // ── Priority C: continuityQuality 메타데이터 기록 ──────────────────────
      if (cutNumber > 1) {
        const hasSourceVideo = !!sourceVideo;
        const cqScore = hasSourceVideo ? 100
          : (continuityFrameSource !== "none" && continuityFrameSource !== "text_to_video_fallback" && continuityFrameSource !== "disabled_by_autoLinkFirstFrame") ? 60
          : 0;
        const effectiveDegradation = continuityDegradation
          || (continuityFrameSource === "disabled_by_autoLinkFirstFrame" ? "autoLink_off" : undefined)
          || (!hasSourceVideo ? "sourceVideo_missing" : undefined);
        updateClip(cutNumber, {
          continuityQuality: {
            score: cqScore,
            frameSource: continuityFrameSource,
            sourceVideoAvailable: hasSourceVideo,
            degradation: effectiveDegradation,
          },
        });
        console.log(`[CUT ${cutNumber}] continuityQuality`, {
          score: cqScore,
          frameSource: continuityFrameSource,
          sourceVideoAvailable: hasSourceVideo,
          degradation: continuityDegradation,
        });
      }

      // ── 3-way snapshot: finalSent (API 전송 직전) ──
      {
        const snap = shotSnapshotsRef.current.get(cutNumber);
        if (snap) {
          snap.finalSent = JSON.parse(JSON.stringify(sequence)) as StructuredSequenceDocument;
          snap.provenance = {
            ...snap.provenance,
            cutNumber,
            sanitizeFixes: sequence.sanitizeFixes,
            conflictResolutions: sequence.conflictResolutions,
          };
        }
      }

      // ── sentPromptEn / sentPromptKoSummary 저장 (refine/verify 후 최종본) ──
      // 실제 provider에 전송될 영어 프롬프트를 기록하고,
      // 대응하는 한국어 UI 필드도 전송 직전 기준으로 생성
      {
        const sentEn = (assembled.preview?.renderedPrompt || legacyPrompt || "").trim();
        // 한국어 번역: cut의 Ko 필드들을 조합 (영어 혼입 금지)
        const koFragments: string[] = [];
        if (cut.sceneDescription) koFragments.push(cut.sceneDescription);
        if (cut.videoPromptKo) koFragments.push(cut.videoPromptKo);
        if (cut.subjectActionKo) koFragments.push(cut.subjectActionKo);
        if (cut.moodLightingKo) koFragments.push(cut.moodLightingKo);
        if (cut.cameraDirectionKo) koFragments.push(cut.cameraDirectionKo);
        // 영어 비율 30% 초과하는 fragment 제외
        const pureKo = koFragments.filter(f => {
          const alphaCount = (f.match(/[a-zA-Z]/g) || []).length;
          return alphaCount <= f.length * 0.3;
        });
        const sentKo = pureKo.length > 0
          ? pureKo.join(". ").slice(0, 500)
          : (cut.sceneDescription || `컷 ${cutNumber} 영상 프롬프트`);
        updateClip(cutNumber, { sentPromptEn: sentEn, sentPromptKoSummary: sentKo });
      }

      // ── 타이밍: 시퀀스 조립 완료 ──────────────────────────────────────────
      const tBuildDone = performance.now();
      const buildMs = Math.round(tBuildDone - t0);
      const assemblyOnlyMs = Math.round(tBuildDone - tPreEnd);

      console.log(`[CUT ${cutNumber}] ⏱ PIPELINE TIMING`, {
        preProcessMs,
        assemblyMs: assemblyOnlyMs,
        buildTotalMs: buildMs,
        sourceOfTruth: "structuredSequence",
        previewWordCount: assembled.preview?.wordCount ?? 0,
      });

      // ── API 요청 요약 디버그 ──────────────────────────────────────────────
      console.log(`[CUT ${cutNumber}] 📦 API REQUEST`, {
        engine,
        videoMode,
        mode: requestMode,
        style: cfg.animationMode || "(없음)",
        sourceOfTruth: "structuredSequence",
        hasStructuredSequence: true,
        shotPlanFraming: sequence.shotPlan.camera.framing,
        hasFirstFrame: !!safeFirstFrame,
        hasPrevUri: !!safePrevVideoUri,
        refImages: finalRefImages.length,
        negative: negativePrompt?.slice(0, 80) || "(없음)",
      });

      // ── Job Store: 요청 전 job record 생성 (queued) ────────────────
      const job = createJob({
        engine,
        cutNumber,
        requestSummary: {
          durationSeconds: cfg.durationSeconds,
          aspectRatio: cfg.aspectRatio,
          videoMode,
          promptPreview: (legacyPrompt || "").slice(0, 80),
          multiShotCount: (assembled.suggestedMultiShot ?? cut.multiShot)?.length ?? 0,
          multiShotRoles: (assembled.suggestedMultiShot ?? cut.multiShot)?.map(s => s.role ?? "unknown") ?? [],
          generationMode: cfg.generationMode ?? "batch",
          intentionalOneTake: cut.intentionalOneTake ?? false,
        },
        projectTitle: undefined, // TODO: PromptGenerator에서 전달
      });

      // ── Submit via core helper ───────────────────────────────────────
      const tApiStart = performance.now();
      let data: VideoSubmitResult;
      try {
        data = await submitVideoGeneration(submitParams);
      } catch (submitErr) {
        const tApiEnd = performance.now();
        const apiRequestMs = Math.round(tApiEnd - tApiStart);
        const errMsg = submitErr instanceof Error ? submitErr.message : String(submitErr);
        const statusCode = (submitErr as { statusCode?: number })?.statusCode;
        const raiFiltered = (submitErr as { raiFiltered?: boolean })?.raiFiltered;
        console.error(`CUT ${cutNumber} 영상 생성 실패 (${apiRequestMs}ms):`, errMsg);

        // Safety filter 에러 → Gemini로 프롬프트 sanitize 후 1회 재시도
        const isSafetyError =
          errMsg.includes("could not generate videos") ||
          errMsg.includes("not be charged") ||
          errMsg.includes("Try rephrasing") ||
          errMsg.includes("usage guidelines") ||
          errMsg.includes("could not be submitted") ||
          errMsg.includes("safety") ||
          raiFiltered === true;

        if (isSafetyError && retryCount === 0) {
          const fallbackPrompt = assembled.preview?.renderedPrompt || legacyPrompt;
          console.warn(`[CUT ${cutNumber}] Safety 차단 감지`, {
            blockReason: errMsg.slice(0, 200),
            fallbackPromptLen: fallbackPrompt.length,
            fallbackPromptHead: fallbackPrompt.slice(0, 120),
          });
          try {
            const sanitizeRes = await fetch("/api/refine-prompt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ videoPrompt: fallbackPrompt, mode: "sanitize", cutNumber }),
            });
            if (sanitizeRes.ok) {
              const sanitized = await sanitizeRes.json();
              if (sanitized?.refinedVideoPrompt) {
                const sanitizedPrompt = sanitized.refinedVideoPrompt;
                console.log(`[CUT ${cutNumber}] Safety 재시도`, {
                  changes: sanitized.changes,
                  originalHead: fallbackPrompt.slice(0, 100),
                  sanitizedHead: sanitizedPrompt.slice(0, 100),
                });
                // Safety retry via core submitVideoGeneration
                const retryParams = { ...submitParams };
                if (retryParams.structuredSequence && typeof retryParams.structuredSequence === "object") {
                  const retrySeq = JSON.parse(JSON.stringify(retryParams.structuredSequence));
                  retrySeq.shotPlan.action = sanitizedPrompt.slice(0, 500);
                  retrySeq.shotPlan.negativeDirectives = [
                    ...(retrySeq.shotPlan.negativeDirectives || []),
                    "graphic violence", "gore", "blood", "injury detail", "medical procedure",
                  ];
                  retryParams.structuredSequence = retrySeq;
                  delete (retryParams as Record<string, unknown>).prompt;
                  console.log(`[CUT ${cutNumber}] Safety 재시도: structuredSequence 유지`, {
                    actionLen: retrySeq.shotPlan.action.length,
                    addedNegatives: 5,
                  });
                } else {
                  (retryParams as Record<string, unknown>).prompt = sanitizedPrompt;
                }
                try {
                  const retryResult = await submitVideoGeneration(retryParams);
                  updateClip(cutNumber, { operationName: retryResult.operationName });
                  startPolling(cutNumber, retryResult.operationName);
                  return;
                } catch (retryErr) {
                  console.error(`[CUT ${cutNumber}] Safety 재시도도 실패:`, retryErr instanceof Error ? retryErr.message : retryErr);
                }
              } else {
                console.warn(`[CUT ${cutNumber}] Sanitize 응답에 refinedVideoPrompt 없음:`, sanitized);
              }
            }
          } catch (sanitizeErr) {
            console.warn(`[CUT ${cutNumber}] Sanitize 호출 실패:`, sanitizeErr);
          }
        }

        const failMsg = isSafetyError
          ? `안전 필터 차단 — 민감한 표현(폭력·의료시술·신체손상·공포)을 완화해 다시 시도하세요.`
          : classifyVideoError(submitErr, statusCode).message;
        markJobFailed(job.jobId, failMsg, isSafetyError ? "provider_rejected" : "unknown");
        updateClip(cutNumber, { status: "failed", error: failMsg });
        return;
      }
      const tApiEnd = performance.now();
      const apiRequestMs = Math.round(tApiEnd - tApiStart);

      console.log(`[CUT ${cutNumber}] ⏱ apiRequest`, { apiRequestMs });

      // ── Job Store: submit 성공 → submitted (taskId 즉시 저장) ──
      markSubmitted(job.jobId, data.taskId || data.operationName, data.operationName);

      updateClip(cutNumber, {
        operationName: data.operationName,
        engineUsed: data.engine,
        modeUsed: data.modeUsed,
        sourceVideo: data.sourceVideo,
      });

      // ── 3-way snapshot: provenance에 서버 응답 메타 기록 (core helper) ──
      {
        const providerMeta = extractProviderMeta(data);
        const snap = shotSnapshotsRef.current.get(cutNumber);
        if (snap) {
          snap.provenance = {
            ...snap.provenance,
            cutNumber,
            modelUsed: providerMeta.modelUsed,
            modeUsed: providerMeta.modeUsed,
          };
        }
      }

      // ── Duration meta 추적 (core helper 사용) ──
      if (data.durationMeta) {
        const dm = buildDurationMeta(
          data.durationMeta.requestedSecondsPerScene,
          data.durationMeta,
        );
        setLastDurationMeta(dm);
        if (dm.warnings.length > 0) {
          console.warn(`[CUT ${cutNumber}] duration 보정:`, dm.warnings);
        }
      }

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
          videoMode: d.videoMode,
          sceneExtensionAttempted: d.sceneExtensionAttempted,
          videoUrlExpected: "✓ VEO returns Google URI (needs R2 upload)",
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

      // ── separate_clips 모드: 개별 샷 polling + hard cut assembly ──────
      if (data.separateClips && data.clipOperations && data.clipOperations.length > 0) {
        console.log(`[CUT ${cutNumber}] SEPARATE_CLIPS: ${data.clipOperations.length} shots polling 시작`);
        updateClip(cutNumber, { status: "polling", assemblyMethod: "hard_cut" });

        // 모든 shot을 병렬 polling
        const shotResults = await Promise.allSettled(
          data.clipOperations.map(async (clipOp) => {
            const result = await pollVideoTask(clipOp.operationName, {
              longRunning: true,
              jobId: undefined,
              onProgress: (attempt, maxAttempts) => {
                if (attempt % 12 === 11) {
                  console.log(`[CUT ${cutNumber}] shot ${clipOp.shotIndex} polling #${attempt + 1}/${maxAttempts}`);
                }
              },
            });
            return { ...clipOp, pollResult: result };
          }),
        );

        // 결과 취합
        const completedClips: Array<{ shotIndex: number; videoUri: string; durationSec: number }> = [];
        const failedShots: string[] = [];

        for (const result of shotResults) {
          if (result.status === "fulfilled") {
            const { shotIndex, durationSec, pollResult } = result.value;
            if (pollResult.status === "completed" && pollResult.videoUri) {
              completedClips.push({ shotIndex, videoUri: pollResult.videoUri, durationSec });
            } else {
              failedShots.push(`shot ${shotIndex}: ${pollResult.error || pollResult.status}`);
            }
          } else {
            failedShots.push(`shot: ${result.reason}`);
          }
        }

        // 정렬 (shotIndex 순서)
        completedClips.sort((a, b) => a.shotIndex - b.shotIndex);

        if (completedClips.length === 0) {
          updateClip(cutNumber, {
            status: "failed",
            error: `separate_clips 전체 실패: ${failedShots.join("; ")}`,
          });
        } else {
          // 개별 clip URI 저장
          updateClip(cutNumber, {
            separateClipUris: completedClips,
            assemblyMethod: "hard_cut",
          });

          console.log(`[CUT ${cutNumber}] SEPARATE_CLIPS polling 완료: ${completedClips.length}/${data.clipOperations.length} 성공`, {
            clipUris: completedClips.map(c => ({ shot: c.shotIndex, uri: c.videoUri.slice(0, 60) })),
            failed: failedShots,
          });

          // ── hard-cut stitch: FFmpeg.wasm concat ──
          if (completedClips.length >= 2) {
            try {
              updateClip(cutNumber, { status: "polling" }); // "encoding" 대신 기존 상태 재사용
              console.log(`[CUT ${cutNumber}] hard-cut stitch 시작: ${completedClips.length}개 clip`);

              const { fetchClipBlobs, concatClips } = await import("@/lib/client-stitch");
              const { loadFFmpeg } = await import("@/lib/ffmpeg-wasm-loader");

              // MontageClip shape으로 변환
              const montageClips = completedClips.map(c => ({
                cutNumber: c.shotIndex,
                videoUri: c.videoUri,
                durationSec: c.durationSec,
                status: "completed" as const,
              }));

              const clipBlobs = await fetchClipBlobs(montageClips);
              const ffmpeg = await loadFFmpeg();
              const stitchedData = await concatClips(ffmpeg, clipBlobs);

              // Blob URL 생성
              const stitchedBlob = new Blob([stitchedData.buffer as ArrayBuffer], { type: "video/mp4" });
              const stitchedUrl = URL.createObjectURL(stitchedBlob);

              updateClip(cutNumber, {
                status: "completed",
                videoUri: stitchedUrl,
                completedAt: Date.now(),
                ...(failedShots.length > 0 ? { error: `${failedShots.length}개 샷 실패 (부분 조립): ${failedShots.join("; ")}` } : {}),
              });
              console.log(`[CUT ${cutNumber}] hard-cut stitch 완료: ${stitchedData.length} bytes`);
            } catch (stitchErr) {
              // 조립 실패 시 개별 clip 유지, 첫 번째 clip을 대표 URI로
              const errMsg = stitchErr instanceof Error ? stitchErr.message : String(stitchErr);
              console.error(`[CUT ${cutNumber}] hard-cut stitch 실패:`, errMsg);
              updateClip(cutNumber, {
                status: "completed",
                videoUri: completedClips[0].videoUri,
                completedAt: Date.now(),
                error: `조립 실패 — 개별 클립만 생성됨: ${errMsg}`,
              });
            }
          } else {
            // 1개 clip만 성공 → 그대로 사용
            updateClip(cutNumber, {
              status: "completed",
              videoUri: completedClips[0].videoUri,
              completedAt: Date.now(),
              ...(failedShots.length > 0 ? { error: `${failedShots.length}개 샷 실패: ${failedShots.join("; ")}` } : {}),
            });
          }
        }
      } else {
        // 기존 단일 operationName polling
        startPolling(
          cutNumber,
          data.operationName,
          data.engine,
          data.taskId,
          data.modeUsed === "extend",
          variantsToPreserve,
          job.jobId,
        );
      }
    } catch (err) {
      const classified = classifyVideoError(
        err,
        (err as { statusCode?: number })?.statusCode,
      );
      updateClip(cutNumber, {
        status: "failed",
        error: classified.message,
      });
    }
  }, [cuts, state.clips, state.config, storyboardImages, storyboardEndImages, faceRefs, updateClip, startPolling, verifyPrompt]);

  // 자동 모드 (직렬 생성) — generating/pending 컷이 없을 때만 다음 idle 컷 시작
  // state.clips 변경 시마다 재실행 → generateCut이 항상 최신 클로저를 사용
  // ⚡ 타이밍 수정: 이전 컷의 업로드 완료를 기다린 후 다음 컷 시작
  //    (canonicalVideoUri가 없으면 Scene Extension 불가 → 업로드 완료 후 재평가)
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
      // ⚡ Scene Extension 타이밍 수정:
      // 이전 컷의 uploadStatus가 "pending"이면 업로드 완료를 기다림.
      // canonicalVideoUri가 설정된 후에야 다음 컷에서 Scene Extension 사용 가능.
      const prevCutNumber = nextIdle.cutNumber - 1;
      if (prevCutNumber >= 1) {
        const prevClip = state.clips.find((c) => c.cutNumber === prevCutNumber);
        if (prevClip?.uploadStatus === "pending") {
          console.log(`[AUTO-MODE] ⏳ CUT ${prevCutNumber} 업로드 대기 중 — CUT ${nextIdle.cutNumber} 시작 보류`);
          return; // uploadStatus가 변경되면 state.clips가 변경 → useEffect 재실행
        }
        // 업로드 완료 후 eligibility 재평가 로그
        if (prevClip && prevClip.status === "completed") {
          const eligibility = reevaluateSceneExtensionEligibilityAfterUpload(prevClip);
          const modeDecision = selectVideoModeForNextCut(nextIdle.cutNumber, prevClip, undefined);
          console.log(`[AUTO-MODE] CUT ${nextIdle.cutNumber} 모드 결정:`, {
            mode: modeDecision.mode,
            continuityScore: modeDecision.continuityScore,
            eligible: eligibility.eligible,
            reason: eligibility.reason,
            canonicalVideoUri: eligibility.canonicalVideoUri?.slice(0, 60) || "(없음)",
          });
        }
      }
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
    // 피드백의 개선된 프롬프트를 override ref에 저장 (prop 직접 mutation 대신)
    if (improvedPrompt) {
      promptOverridesRef.current.set(cutNumber, improvedPrompt);
    }

    setState((prev) => ({
      ...prev,
      review: prev.review ? { ...prev.review, status: "regenerating" } : undefined,
    }));

    // 클립 리셋 후 재생성
    resetClip(cutNumber);
    // 짧은 딜레이 후 생성 시작 (상태 업데이트 반영 대기)
    setTimeout(() => generateCut(cutNumber), 300);
  }, [resetClip, generateCut]);

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
        // prop 직접 mutation 대신 override ref 사용
        promptOverridesRef.current.set(cutNum, feedback.improvedPrompt);
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
  }, [state.review, state.clips, resetClip]);

  // ═══════════════════════════════════════════════════════════════
  // Narration Audio Pipeline
  // ═══════════════════════════════════════════════════════════════

  /**
   * 전체 나레이션 생성: 완료된 모든 클립의 structuredSequence + sceneDescription 기반
   * shot durationSec에 맞춰 TTS 생성 → R2 저장 → audioMeta 반환
   */
  const generateNarration = useCallback(async () => {
    const completedClips = state.clips.filter(c => c.status === "completed");
    if (completedClips.length === 0) return;

    setNarrationStatus("generating");

    // shot별 narration 데이터 수집 (structuredSequence source of truth)
    const shots: Array<{
      cutNumber: number;
      shotId: string;
      narrationText: string;
      durationSec: number;
      startSec: number;
      endSec: number;
    }> = [];

    let cumulativeSec = 0;
    for (const clip of completedClips) {
      const cut = cuts.find(c => c.cutNumber === clip.cutNumber);
      const seq = clip.structuredSequence;

      // narrationMode: mute → skip, manual → use narrationText, auto → fallback to sceneDescription
      const narrationMode = seq?.narrationMode || "auto";
      if (narrationMode === "mute") {
        cumulativeSec += (seq?.durationSec || clip.durationSec || safeDuration(state.config.durationSeconds));
        continue;
      }
      const narrationText = narrationMode === "manual"
        ? (seq?.narrationText || "")
        : (seq?.narrationText || cut?.sceneDescription || "");
      const duration = seq?.durationSec || clip.durationSec || safeDuration(state.config.durationSeconds);

      if (narrationText.trim()) {
        shots.push({
          cutNumber: clip.cutNumber,
          shotId: seq?.shotId || `shot_${clip.cutNumber}`,
          narrationText,
          durationSec: duration,
          startSec: cumulativeSec,
          endSec: cumulativeSec + duration,
        });
      }

      cumulativeSec += duration;
    }

    if (shots.length === 0) {
      setNarrationStatus("completed");
      setAudioMeta({
        audioIncluded: false,
        audioTracks: [],
        narrationUsed: false,
        deliveryMode: "none",
        durationSource: "estimated",
        warnings: ["No narration text available for any shot"],
      });
      return;
    }

    try {
      const sessionId = completedClips[0]?.operationName?.split("/").pop() || `session-${Date.now()}`;

      const res = await fetch("/api/generate-narration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          shots,
          voiceName: "ko-KR-Wavenet-A",
          speakingRate: 1.0,
        }),
      });

      const data = await res.json() as {
        audioIncluded: boolean;
        audioTracks?: Array<{
          cutNumber: number;
          audioUri: string;
          text: string;
          durationSec: number;
          syncStatus: "exact" | "trimmed" | "padded";
          generatedAt: number;
        }>;
        narrationUsed: boolean;
        deliveryMode: "muxed" | "separate" | "none";
        warnings?: string[];
        errors?: Array<{ cutNumber: number; error: string }>;
      };

      const tracks: NarrationTrack[] = (data.audioTracks || []).map(t => ({
        cutNumber: t.cutNumber,
        audioUri: t.audioUri,
        text: t.text,
        durationSec: t.durationSec,
        syncStatus: t.syncStatus,
        generatedAt: t.generatedAt,
      }));

      // 각 clip에 narration URI 연결
      for (const track of tracks) {
        updateClip(track.cutNumber, {
          narrationAudioUri: track.audioUri,
          narrationStatus: "completed",
        });
      }

      // 커버리지 계산
      const completedClipCount = completedClips.length;
      const mutedCount = completedClips.filter(c => {
        const seq = c.structuredSequence;
        return seq?.narrationMode === "mute";
      }).length;
      const audioCoverage: AudioCoverageMeta = {
        totalShots: completedClipCount,
        successfulShots: tracks.length,
        failedShots: (data.errors?.length ?? 0),
        mutedShots: mutedCount,
        coverage: completedClipCount > 0 ? tracks.length / (completedClipCount - mutedCount || 1) : 0,
      };

      const meta: AudioMeta = {
        audioIncluded: data.audioIncluded,
        audioTracks: tracks,
        narrationUsed: data.narrationUsed,
        deliveryMode: data.deliveryMode,
        audioCoverage,
        durationSource: "estimated",
        warnings: data.warnings || [],
      };

      setAudioMeta(meta);
      setNarrationStatus("completed");

      // ── 전체 생성 성공: 모든 shot의 dirty-state 해제 ──
      setShotNarrationStates(prev => {
        const next = new Map(prev);
        for (const track of tracks) {
          const existing = next.get(track.cutNumber);
          if (existing) {
            next.set(track.cutNumber, {
              ...existing,
              lastGeneratedText: existing.currentText,
              lastGeneratedMode: existing.mode,
              lastGeneratedAudioUrl: track.audioUri,
              lastGeneratedSyncStatus: track.syncStatus || "",
              lastGeneratedAt: track.generatedAt || Date.now(),
              narrationDirty: false,
            });
          }
        }
        recomputeSequenceNarrationState(next);
        return next;
      });
      setSequenceNarrationState(prev => ({
        ...prev,
        lastGeneratedSnapshotId: `snap-${Date.now()}`,
      }));

      console.log("[NARRATION] 생성 완료", {
        trackCount: tracks.length,
        totalShots: shots.length,
        deliveryMode: data.deliveryMode,
        warnings: data.warnings,
      });
    } catch (err) {
      console.error("[NARRATION] 생성 실패:", err);
      setNarrationStatus("failed");
      setAudioMeta({
        audioIncluded: false,
        audioTracks: [],
        narrationUsed: false,
        deliveryMode: "none",
        durationSource: "estimated",
        warnings: [`Narration generation failed: ${err instanceof Error ? err.message : String(err)}`],
      });

      // degraded warning — 각 clip에 실패 상태 기록
      for (const clip of completedClips) {
        updateClip(clip.cutNumber, { narrationStatus: "failed" });
      }
    }
  }, [state.clips, cuts, state.config.durationSeconds, updateClip, recomputeSequenceNarrationState]);

  /**
   * 단일 shot 나레이션 재생성
   */
  const regenerateShotNarration = useCallback(async (cutNumber: number) => {
    const clip = state.clips.find(c => c.cutNumber === cutNumber && c.status === "completed");
    if (!clip) return;

    const cut = cuts.find(c => c.cutNumber === cutNumber);
    const seq = clip.structuredSequence;
    const narrationMode = seq?.narrationMode || "auto";
    if (narrationMode === "mute") return;

    const narrationText = narrationMode === "manual"
      ? (seq?.narrationText || "")
      : (seq?.narrationText || cut?.sceneDescription || "");
    if (!narrationText.trim()) return;

    const duration = seq?.durationSec || clip.durationSec || safeDuration(state.config.durationSeconds);

    updateClip(cutNumber, { narrationStatus: "generating" });

    try {
      const sessionId = clip.operationName?.split("/").pop() || `session-${Date.now()}`;
      const res = await fetch("/api/generate-narration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          shots: [{
            cutNumber,
            shotId: seq?.shotId || `shot_${cutNumber}`,
            narrationText,
            durationSec: duration,
            startSec: 0,
            endSec: duration,
          }],
          voiceName: "ko-KR-Wavenet-A",
          speakingRate: 1.0,
        }),
      });

      const data = await res.json() as {
        audioIncluded: boolean;
        audioTracks?: Array<{ cutNumber: number; audioUri: string; syncStatus: string }>;
      };

      const track = data.audioTracks?.[0];
      if (track) {
        updateClip(cutNumber, {
          narrationAudioUri: track.audioUri,
          narrationStatus: "completed",
        });
        // ── dirty-state 해제: 생성 성공 ──
        setShotNarrationStates(prev => {
          const next = new Map(prev);
          const existing = next.get(cutNumber);
          if (existing) {
            next.set(cutNumber, {
              ...existing,
              lastGeneratedText: existing.currentText,
              lastGeneratedMode: existing.mode,
              lastGeneratedAudioUrl: track.audioUri,
              lastGeneratedSyncStatus: (track as { syncStatus?: string }).syncStatus as "exact" | "trimmed" | "padded" || "",
              lastGeneratedAt: Date.now(),
              narrationDirty: false,
            });
          }
          recomputeSequenceNarrationState(next);
          return next;
        });
      } else {
        updateClip(cutNumber, { narrationStatus: "failed" });
      }
    } catch {
      updateClip(cutNumber, { narrationStatus: "failed" });
    }
  }, [state.clips, cuts, state.config.durationSeconds, updateClip, recomputeSequenceNarrationState]);

  /**
   * 배치: dirty 상태인 모든 shot의 나레이션을 순차 재생성
   */
  const regenerateAllDirtyNarrations = useCallback(async () => {
    // dirty shot 목록 추출
    const dirtyCutNumbers: number[] = [];
    shotNarrationStates.forEach((s, cutNumber) => {
      if (s.narrationDirty && s.mode !== "mute") dirtyCutNumbers.push(cutNumber);
    });

    if (dirtyCutNumbers.length === 0) return;

    // 배치 시작 상태
    setBatchNarrationState({
      isRunning: true,
      total: dirtyCutNumbers.length,
      completed: 0,
      failed: 0,
      activeCutNumber: null,
      failedCutNumbers: [],
      warnings: [],
    });

    let completed = 0;
    let failed = 0;
    const failedCutNumbers: number[] = [];
    const warnings: string[] = [];

    // 순차 처리 (과도한 동시 요청 방지)
    for (const cutNumber of dirtyCutNumbers) {
      setBatchNarrationState(prev => ({ ...prev, activeCutNumber: cutNumber }));

      const clip = state.clips.find(c => c.cutNumber === cutNumber && c.status === "completed");
      if (!clip) {
        failed++;
        failedCutNumbers.push(cutNumber);
        warnings.push(`C${cutNumber}: 완료된 클립 없음`);
        setBatchNarrationState(prev => ({
          ...prev,
          failed,
          failedCutNumbers: [...failedCutNumbers],
          warnings: [...warnings],
        }));
        continue;
      }

      const cut = cuts.find(c => c.cutNumber === cutNumber);
      const seq = clip.structuredSequence;
      const narrationMode = seq?.narrationMode || "auto";

      const narrationText = narrationMode === "manual"
        ? (seq?.narrationText || "")
        : (seq?.narrationText || cut?.sceneDescription || "");

      if (!narrationText.trim()) {
        failed++;
        failedCutNumbers.push(cutNumber);
        warnings.push(`C${cutNumber}: 나레이션 텍스트 없음`);
        setBatchNarrationState(prev => ({
          ...prev,
          failed,
          failedCutNumbers: [...failedCutNumbers],
          warnings: [...warnings],
        }));
        continue;
      }

      const duration = seq?.durationSec || clip.durationSec || safeDuration(state.config.durationSeconds);

      updateClip(cutNumber, { narrationStatus: "generating" });

      try {
        const sessionId = clip.operationName?.split("/").pop() || `session-${Date.now()}`;
        const res = await fetch("/api/generate-narration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            shots: [{
              cutNumber,
              shotId: seq?.shotId || `shot_${cutNumber}`,
              narrationText,
              durationSec: duration,
              startSec: 0,
              endSec: duration,
            }],
            voiceName: "ko-KR-Wavenet-A",
            speakingRate: 1.0,
          }),
        });

        const data = await res.json() as {
          audioIncluded: boolean;
          audioTracks?: Array<{ cutNumber: number; audioUri: string; syncStatus: string }>;
        };

        const track = data.audioTracks?.[0];
        if (track) {
          updateClip(cutNumber, {
            narrationAudioUri: track.audioUri,
            narrationStatus: "completed",
          });
          // dirty-state 해제
          setShotNarrationStates(prev => {
            const next = new Map(prev);
            const existing = next.get(cutNumber);
            if (existing) {
              next.set(cutNumber, {
                ...existing,
                lastGeneratedText: existing.currentText,
                lastGeneratedMode: existing.mode,
                lastGeneratedAudioUrl: track.audioUri,
                lastGeneratedSyncStatus: (track as { syncStatus?: string }).syncStatus as "exact" | "trimmed" | "padded" || "",
                lastGeneratedAt: Date.now(),
                narrationDirty: false,
              });
            }
            recomputeSequenceNarrationState(next);
            return next;
          });
          completed++;
        } else {
          updateClip(cutNumber, { narrationStatus: "failed" });
          failed++;
          failedCutNumbers.push(cutNumber);
          warnings.push(`C${cutNumber}: 오디오 트랙 없음`);
        }
      } catch (err) {
        updateClip(cutNumber, { narrationStatus: "failed" });
        failed++;
        failedCutNumbers.push(cutNumber);
        warnings.push(`C${cutNumber}: ${err instanceof Error ? err.message : "생성 실패"}`);
      }

      setBatchNarrationState(prev => ({
        ...prev,
        completed: completed + failed,
        failed,
        failedCutNumbers: [...failedCutNumbers],
        warnings: [...warnings],
      }));
    }

    // 배치 완료
    setBatchNarrationState({
      isRunning: false,
      total: dirtyCutNumbers.length,
      completed,
      failed,
      activeCutNumber: null,
      failedCutNumbers,
      warnings,
    });
  }, [shotNarrationStates, state.clips, cuts, state.config.durationSeconds, updateClip, recomputeSequenceNarrationState]);

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
              // deprecated: fidelity eval에서 finalPrompt는 fallback preview일 뿐
              finalPrompt: clip?.fallbackRenderedPrompt || clip?.finalPrompt || "",
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

      // 전체 완료 시 나레이션 자동 생성 (generateAudio가 켜져 있으면)
      if (state.config.generateAudio && narrationStatus === "idle") {
        console.log("[NARRATION] 전체 영상 완료 → 나레이션 자동 생성 시작");
        generateNarration();
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
  }, [completedCount, totalCount, state.review, state.sequencePlan, state.clips, state.config.generateAudio, narrationStatus, reviewAllClips, sendNotification, generateNarration]);

  // 알림 권한 미리 요청
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const dismissReview = useCallback(() => {
    setState((prev) => ({ ...prev, review: undefined }));
  }, []);

  /** 특정 클립의 structuredSequence를 업데이트 (시퀀스 타임라인 편집기용) */
  const updateClipStructuredSequence = useCallback((cutNumber: number, updated: StructuredSequenceDocument) => {
    setState((prev) => ({
      ...prev,
      clips: prev.clips.map((c) =>
        c.cutNumber === cutNumber ? { ...c, structuredSequence: updated } : c,
      ),
    }));
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // Shot-level Variant State (2차: 샷별 부분 재생성)
  // ═══════════════════════════════════════════════════════════════

  const [shotVariantState, setShotVariantState] = useState<ShotVariantState>(createInitialVariantState);

  /**
   * 특정 shot만 재생성.
   * 전체 sequence regenerate가 아닌, selectedShotId 기준 shot-level payload로 생성.
   */
  const regenerateShot = useCallback(async (
    cutNumber: number,
    shotId: string,
    currentDoc: StructuredSequenceDocument,
  ) => {
    const clip = state.clips.find(c => c.cutNumber === cutNumber);
    if (!clip?.structuredSequence) return;

    const editable = extractEditable(currentDoc);
    const payload = buildShotRegeneratePayload(editable, currentDoc, shotId);
    if (!payload) return;

    // Create a minimal structuredSequence for this single shot
    const shotSequence = payloadToStructuredSequence(payload, currentDoc);

    // Generate variant ID
    const variantId = generateVariantId();
    const shotDuration = payload.shot.endSec - payload.shot.startSec;

    // Create initial variant
    const variant: ShotVariant = {
      variantId,
      shotId,
      status: "generating",
      createdAt: Date.now(),
      generationMeta: {
        engine: "veo",
        mode: "generate",
        durationSec: shotDuration,
        hasNeighborContext: !!(payload.previousShot || payload.nextShot),
      },
    };

    // Update variant state: set status + attach variant
    setShotVariantState(prev => {
      let next = setShotStatus(prev, shotId, "generating");
      next = attachShotVariant(next, shotId, variant);
      return next;
    });

    try {
      // Build API request body — same structure as generateCut but for single shot
      const cfg = state.config;
      const body: Record<string, unknown> = {
        structuredSequence: shotSequence,
        cutNumber,
        engine: "veo",
        videoMode: "generate", // shot-level always generates fresh
        mode: cfg.mode,
        durationSeconds: DURATION_FALLBACK, // VEO 정책: 8초 고정 (샷 재생성도 동일)
        resolution: cfg.resolution,
        aspectRatio: cfg.aspectRatio,
        generateAudio: cfg.generateAudio,
        negativePrompt: cfg.negativePrompt || undefined,
        personGeneration: cfg.personGeneration,
      };

      console.log(`[SHOT REGEN] ${shotId} in CUT ${cutNumber}`, {
        variantId,
        shotDuration,
        hasNeighborContext: variant.generationMeta?.hasNeighborContext,
        payload: {
          subject: payload.shot.subject,
          action: payload.shot.action,
          camera: payload.shot.camera,
        },
      });

      // ── Submit via core helper ──
      const shotSubmitResult = await submitVideoGeneration({
        structuredSequence: body.structuredSequence,
        cutNumber,
        engine: "veo",
        videoMode: "generate",
        durationSeconds: body.durationSeconds as number,
        aspectRatio: body.aspectRatio as string,
        generateAudio: body.generateAudio as boolean,
        negativePrompt: body.negativePrompt as string | undefined,
        extraFields: {
          mode: body.mode,
          resolution: body.resolution,
          personGeneration: body.personGeneration,
        },
      });

      // Update variant with operationName for polling
      setShotVariantState(prev =>
        updateShotVariant(prev, shotId, variantId, {
          operationName: shotSubmitResult.operationName,
        }),
      );

      // Start polling for this shot variant
      if (shotSubmitResult.operationName) {
        pollShotVariant(cutNumber, shotId, variantId, shotSubmitResult.operationName);
      }
    } catch (err) {
      const classified = classifyVideoError(
        err,
        (err as { statusCode?: number })?.statusCode,
      );
      setShotVariantState(prev => {
        let next = setShotStatus(prev, shotId, "failed");
        next = updateShotVariant(next, shotId, variantId, {
          status: "failed",
          error: classified.message,
        });
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.clips, state.config]);

  /**
   * shot variant 전용 폴링 — 공통 pollVideoTask 사용.
   * 상태 판정/timeout/에러 분류/backoff는 core에 위임하고,
   * variant 상태 업데이트만 후처리한다.
   */
  const pollShotVariant = useCallback(async (
    cutNumber: number,
    shotId: string,
    variantId: string,
    operationName: string,
  ) => {
    const result = await pollVideoTask(operationName, {
      extraPollBody: { operationName },
    });

    if (result.status === "completed") {
      setShotVariantState(prev => {
        let next = setShotStatus(prev, shotId, "success");
        next = updateShotVariant(next, shotId, variantId, {
          status: "success",
          videoUrl: result.videoUri,
        });
        // Auto-activate first successful variant if none active
        if (!prev.activeVariantIds[shotId]) {
          next = setActiveShotVariantState(next, shotId, variantId);
        }
        return next;
      });
      console.log(`[SHOT REGEN] ${shotId} variant ${variantId} completed`, { videoUri: result.videoUri });
    } else {
      // failed or timeout — core 에러 분류와 동일 경로
      const classified = classifyVideoError(
        new Error(result.error || "영상 생성 실패"),
      );
      setShotVariantState(prev => {
        let next = setShotStatus(prev, shotId, "failed");
        next = updateShotVariant(next, shotId, variantId, {
          status: "failed",
          error: classified.message,
        });
        return next;
      });
    }
  }, []);

  /**
   * shot variant 채택: activeVariantId 갱신.
   */
  const acceptShotVariant = useCallback((shotId: string, variantId: string) => {
    setShotVariantState(prev => setActiveShotVariantState(prev, shotId, variantId));
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
    updateClipStructuredSequence,
    // Shot-level regenerate (2차)
    shotVariantState,
    regenerateShot,
    acceptShotVariant,
    completedCount,
    totalCount,
    progress,
    // 3-way comparison snapshots
    shotSnapshots: shotSnapshotsRef.current,
    // Duration 추적 메타
    lastDurationMeta,
    // Narration audio pipeline
    generateNarration,
    regenerateShotNarration,
    narrationStatus,
    audioMeta,
    // Narration dirty-state tracking
    shotNarrationStates,
    sequenceNarrationState,
    markNarrationDirty,
    initShotNarrationState,
    // Batch narration regeneration
    batchNarrationState,
    regenerateAllDirtyNarrations,
    // Job recovery (S1 resilience)
    recoverableJobs,
    resumeJob,
  };
}
