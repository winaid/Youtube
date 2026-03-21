/**
 * video-generation-core.ts — 공통 비디오 생성 헬퍼
 *
 * 캔버스 노드 실행과 기존 useVideoGeneration이 동일한
 * submit / polling / response normalization / error classification / meta 로직을 공유한다.
 *
 * 이 모듈은 순수 함수와 async 함수만 포함하며, React 의존성이 없다.
 */

import type { DurationMeta, MultiShotPrompt } from "@/types";
import { DURATION_FALLBACK } from "@/lib/duration-reconciliation";
import { repairMissingMultiShot } from "@/lib/multi-shot-planner";
import type { GenerationMode, PlannerSceneType } from "@/lib/multi-shot-planner";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/** video generation API submit 파라미터 */
export interface VideoSubmitParams {
  prompt?: string;
  firstFrameBase64?: string;
  lastFrameBase64?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  negativePrompt?: string;
  engine?: "veo" | "auto"; // 현재 "veo"만 사용. "auto"는 서버 예약값.
  videoMode?: "generate" | "extend";
  /** 워크플로우 타입 — 서버에서 모델 자동 선택에 사용 */
  workflowType?: import("@/types").VideoWorkflowType;
  cutNumber?: number;
  generateAudio?: boolean;
  /** JSON-first source of truth */
  structuredSequence?: unknown;
  /** legacy JSON prompt */
  videoPromptJson?: unknown;
  extendPromptJson?: unknown;
  /** multi-shot */
  multiShot?: unknown[];
  /** source video for extend */
  sourceVideo?: string;
  /** reference images for reference-to-video workflow */
  referenceImages?: string[];
  /** VEO reference images */
  referenceImageBase64s?: string[];
  /** hook-specific 추가 필드 (mode, resolution, seed 등) — body에 그대로 spread */
  extraFields?: Record<string, unknown>;
  /** 생성 모드 — 멀티샷 auto-repair 정책에 영향 */
  generationMode?: GenerationMode;
  /** 씬 타입 — 멀티샷 강제 정책 판정용 */
  sceneType?: string;
  /** 의도적 원테이크 */
  intentionalOneTake?: boolean;
  /** continuity mode 세그먼트 메타 — generate-video에 전달 */
  continuityMeta?: {
    segmentIndex: number;
    totalSegments: number;
    isLastSegment: boolean;
    prevEndState?: Record<string, unknown>;
    characterLock?: string;
    visualLock?: string;
  };
}

/** generate-video API 응답 */
export interface VideoSubmitResult {
  taskId: string;
  operationName: string;
  engine: "veo";
  modeUsed: "generate" | "extend";
  modelUsed: string;
  status: string;
  durationMeta?: RawDurationMeta;
  /** 즉시 완료 (캐시 히트 등) */
  videoUrl?: string;
  videoUri?: string;
  /** 서버 경고 메시지 */
  warning?: string;
  /** extend용 source video */
  sourceVideo?: string;
  /** 서버 진단 정보 */
  _diag?: Record<string, unknown>;
}

/** API에서 받는 raw durationMeta */
export interface RawDurationMeta {
  requestedSecondsPerScene?: number;
  normalizedSecondsPerScene?: number;
  sentSecondsPerScene?: number;
  warnings?: string[];
}

/** check-video API 응답 (정규화 전) */
export interface RawCheckVideoResponse {
  status?: string;
  error?: string;
  videoUri?: string;
  rawVideoUri?: string;
  canonicalVideoUri?: string | null;
  needsUpload?: boolean;
  seed?: string;
  variants?: Array<{ videoUri: string; rawVideoUri?: string }>;
  sampleCount?: number;
  engine?: string;
  progress?: number;
  /** 서버가 재시도 무의미 판정 시 true. 현재 서버 미반환 → undefined (= retry 허용). 미래 확장 슬롯. */
  noRetry?: boolean;
  _diag?: Record<string, unknown>;
}

/** 정규화된 비디오 생성 결과 (polling 완료 후) */
export interface NormalizedVideoResult {
  status: "completed" | "failed" | "timeout" | "timeout_recoverable";
  videoUri?: string;
  rawVideoUri?: string;
  canonicalVideoUri?: string | null;
  seed?: string;
  variants?: Array<{ videoUri: string; rawVideoUri?: string }>;
  engine: "veo";
  needsUpload: boolean;
  error?: string;
  /** 서버가 재시도 무의미 판정 시 true. 현재 서버 미반환 → undefined (= retry 허용). 미래 확장 슬롯. */
  noRetry?: boolean;
  /** 완료 시각 */
  completedAt: number;
  /** polling 메타 */
  pollMeta: {
    totalAttempts: number;
    totalDurationMs: number;
  };
  /** 서버 진단 */
  _diag?: Record<string, unknown>;
}

/** 에러 분류 결과 */
export interface VideoErrorClassification {
  type: "network" | "client" | "server" | "parse" | "timeout" | "api_error" | "unknown";
  message: string;
  statusCode?: number;
  retryable: boolean;
}

/** polling 옵션 */
export interface PollOptions {
  maxAttempts?: number;
  /** 고정 interval (ms). 미지정 시 adaptive polling */
  fixedIntervalMs?: number;
  /** polling 도중 콜백 (진행률 업데이트 등) */
  onProgress?: (attempt: number, maxAttempts: number, progress?: number) => void;
  /** abort 시그널 */
  signal?: AbortSignal;
  /** check-video 요청에 추가할 필드 (operationName, isExtend, cutNumber 등) */
  extraPollBody?: Record<string, unknown>;
  /** job store 연동 — jobId를 전달하면 polling 상태가 자동으로 영속 저장됨 */
  jobId?: string;
  /**
   * 장기 polling 모드 활성화.
   * true이면 maxAttempts 도달 시 "failed" 대신 "timeout_recoverable" 반환.
   * 사용자가 "다시 확인" 버튼으로 polling을 재개할 수 있다.
   */
  longRunning?: boolean;
}

/** provider/model 메타 */
export interface ProviderMeta {
  engine: "veo";
  modeUsed: "generate" | "extend";
  modelUsed: string;
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

/** 기본 polling 최대 시도 횟수 — 장기 polling 모드에서는 더 높은 값 사용 */
export const POLL_MAX_ATTEMPTS = 72;
/** 장기 polling 최대 시도 횟수 — ~15분 커버 */
export const POLL_LONG_MAX_ATTEMPTS = 180;
export const MAX_CONSECUTIVE_ERRORS = 3;
export const POLL_ERROR_BACKOFF = [5000, 7500, 10000, 15000, 20000];

// ═══════════════════════════════════════════════════════════════════
// Adaptive Polling Interval
// ═══════════════════════════════════════════════════════════════════

/**
 * 적응형 폴링 간격 — 점진적 확대.
 * 초반 빠르게 확인, 장시간 시 서버 부담 경감.
 *
 * 0~2분 (attempt 0-23):  5초 간격
 * 2~5분 (attempt 24-59): 10초 간격
 * 5~10분 (attempt 60-89): 20초 간격
 * 10분+ (attempt 90+):   30초 간격
 */
export function getAdaptivePollInterval(attempt: number): number {
  if (attempt < 24) return 5000;   // 0~2분: 5초
  if (attempt < 60) return 10000;  // 2~5분: 10초
  if (attempt < 90) return 20000;  // 5~10분: 20초
  return 30000;                     // 10분+: 30초
}

// ═══════════════════════════════════════════════════════════════════
// Submit
// ═══════════════════════════════════════════════════════════════════

/**
 * 멀티샷 payload를 준비한다.
 *
 * submission 직전 방어 — multiShot이 없거나 부족한 경우 자동 복구.
 * 이 함수를 거치면 강제 멀티샷 정책에 맞는 payload가 보장된다.
 *
 * @returns 복구된 multiShot 배열 (빈 배열이면 단일샷 OK)
 */
export function prepareMultiShotPayload(params: {
  existingMultiShot?: MultiShotPrompt[];
  durationSec?: number;
  sceneType?: string;
  basePrompt?: string;
  modelId?: string;
  intentionalOneTake?: boolean;
  mode?: GenerationMode;
}): MultiShotPrompt[] {
  const {
    existingMultiShot,
    durationSec,
    sceneType,
    basePrompt,
    modelId,
    intentionalOneTake,
    mode,
  } = params;

  // 모델/duration 없으면 repair 불가
  if (!modelId || !durationSec) return existingMultiShot ?? [];

  return repairMissingMultiShot({
    existingMultiShot,
    durationSec,
    sceneType: sceneType as PlannerSceneType,
    basePrompt: basePrompt ?? "",
    modelId,
    intentionalOneTake,
    mode,
  });
}

/**
 * /api/generate-video에 생성 요청을 제출한다.
 * 캔버스와 기존 useVideoGeneration 양쪽에서 사용.
 *
 * 멀티샷 auto-repair: 강제 멀티샷 정책에 해당하는데 multiShot이 없으면
 * prepareMultiShotPayload로 자동 생성 후 전송.
 */
export async function submitVideoGeneration(
  params: VideoSubmitParams,
): Promise<VideoSubmitResult> {
  const body: Record<string, unknown> = {
    engine: params.engine || "veo",
  };

  // prompt — structuredSequence 우선, prompt는 fallback
  if (params.prompt) body.prompt = params.prompt;

  // optional fields — 있을 때만 전송
  if (params.firstFrameBase64) body.firstFrameBase64 = params.firstFrameBase64;
  if (params.lastFrameBase64) body.lastFrameBase64 = params.lastFrameBase64;
  if (params.durationSeconds != null) body.durationSeconds = params.durationSeconds;
  if (params.aspectRatio) body.aspectRatio = params.aspectRatio;
  if (params.negativePrompt) body.negativePrompt = params.negativePrompt;
  if (params.videoMode) body.videoMode = params.videoMode;
  if (params.cutNumber != null) body.cutNumber = params.cutNumber;
  if (params.generateAudio != null) body.generateAudio = params.generateAudio;
  if (params.structuredSequence) body.structuredSequence = params.structuredSequence;
  if (params.videoPromptJson) body.videoPromptJson = params.videoPromptJson;
  if (params.extendPromptJson) body.extendPromptJson = params.extendPromptJson;
  // 멀티샷 auto-repair — 강제 정책 해당 시 자동 생성
  const repairedMultiShot = prepareMultiShotPayload({
    existingMultiShot: params.multiShot as MultiShotPrompt[] | undefined,
    durationSec: params.durationSeconds,
    sceneType: params.sceneType,
    basePrompt: params.prompt,
    // modelId 미전달: 최종 model은 서버에서 resolveModelForWorkflow()로 결정.
    // client repair는 existingMultiShot 보존만 수행하고, 강제 생성은 서버에 위임.
    modelId: undefined,
    intentionalOneTake: params.intentionalOneTake,
    mode: params.generationMode,
  });
  if (repairedMultiShot.length > 0) body.multiShot = repairedMultiShot;
  else if (params.multiShot && params.multiShot.length > 0) body.multiShot = params.multiShot;

  if (params.sourceVideo) body.sourceVideo = params.sourceVideo;
  if (params.continuityMeta) body.continuityMeta = params.continuityMeta;
  if (params.workflowType) body.workflowType = params.workflowType;
  if (params.referenceImages && params.referenceImages.length > 0) body.referenceImages = params.referenceImages;

  // hook-specific 추가 필드 passthrough
  if (params.extraFields) {
    for (const [k, v] of Object.entries(params.extraFields)) {
      if (v !== undefined) body[k] = v;
    }
  }

  const res = await fetch("/api/generate-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw Object.assign(
      new Error((errBody.error as string) || `HTTP ${res.status}`),
      {
        statusCode: res.status,
        details: errBody.details as string | undefined,
        warning: errBody.warning as string | undefined,
        raiFiltered: errBody.raiFiltered as boolean | undefined,
      },
    );
  }

  const data = await res.json() as Record<string, unknown>;

  return {
    taskId: (data.taskId as string) || (data.operationName as string) || "",
    operationName: (data.operationName as string) || (data.taskId as string) || "",
    engine: "veo",
    modeUsed: (data.modeUsed as "generate" | "extend") || "generate",
    modelUsed: (data.modelUsed as string) || "",
    status: (data.status as string) || "RUNNING",
    durationMeta: data.durationMeta as RawDurationMeta | undefined,
    videoUrl: data.videoUrl as string | undefined,
    videoUri: data.videoUri as string | undefined,
    warning: data.warning as string | undefined,
    sourceVideo: data.sourceVideo as string | undefined,
    _diag: data._diag as Record<string, unknown> | undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Polling
// ═══════════════════════════════════════════════════════════════════

/**
 * taskId로 비디오 생성 상태를 폴링한다.
 * 적응형 간격, 에러 분류, 재시도 백오프를 포함한 공통 로직.
 *
 * longRunning=true이면:
 *   - 최대 POLL_LONG_MAX_ATTEMPTS까지 polling
 *   - 타임아웃 시 "timeout" 대신 "timeout_recoverable" 반환
 *   - job store에 상태 자동 영속 저장 (페이지 새로고침 복구용)
 */
export async function pollVideoTask(
  taskId: string,
  options: PollOptions = {},
): Promise<NormalizedVideoResult> {
  const isLongRunning = options.longRunning ?? false;
  const maxAttempts = options.maxAttempts
    ?? (isLongRunning ? POLL_LONG_MAX_ATTEMPTS : POLL_MAX_ATTEMPTS);
  const useAdaptive = options.fixedIntervalMs == null;
  let consecutiveErrors = 0;
  const startTime = Date.now();

  // job store 연동 (lazy import — React 비의존 모듈이므로 dynamic import)
  let jobStore: typeof import("@/lib/video-job-store") | null = null;
  if (options.jobId) {
    try {
      jobStore = await import("@/lib/video-job-store");
    } catch { /* job store 없어도 polling은 동작 */ }
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // abort check
    if (options.signal?.aborted) {
      if (options.jobId && jobStore) {
        jobStore.markTimeoutRecoverable(options.jobId);
      }
      return makeTimeoutResult(attempt, startTime, "폴링이 취소되었습니다");
    }

    // wait before polling (skip first attempt)
    if (attempt > 0) {
      const waitMs = consecutiveErrors > 0
        ? POLL_ERROR_BACKOFF[Math.min(consecutiveErrors - 1, POLL_ERROR_BACKOFF.length - 1)]
        : useAdaptive
          ? getAdaptivePollInterval(attempt)
          : options.fixedIntervalMs ?? 5000;
      await sleep(waitMs);
    }

    // HTTP request
    let res: Response;
    try {
      res = await fetch("/api/check-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationName: taskId, engine: "veo", ...options.extraPollBody }),
      });
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        const result = makeFailedResult(attempt, startTime, "네트워크 연결 실패 — 인터넷 연결을 확인하세요");
        if (options.jobId && jobStore) {
          // 네트워크 실패지만 서버에서 계속 처리 가능 → recoverable
          jobStore.markTimeoutRecoverable(options.jobId);
          return { ...result, status: "timeout" };
        }
        return result;
      }
      continue;
    }

    // HTTP error
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        const errBody = await res.json().catch(() => ({})) as { error?: string };
        const result = makeFailedResult(attempt, startTime, errBody.error || `클라이언트 오류 (${res.status})`);
        if (options.jobId && jobStore) {
          jobStore.markFailed(options.jobId, result.error || "클라이언트 오류", "provider_rejected");
        }
        return result;
      }
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        const result = makeFailedResult(attempt, startTime, `서버 오류 (${res.status}) — 잠시 후 다시 시도하세요`);
        if (options.jobId && jobStore) {
          jobStore.markTimeoutRecoverable(options.jobId);
          return { ...result, status: "timeout" };
        }
        return result;
      }
      continue;
    }

    consecutiveErrors = 0;

    // JSON parse
    let data: RawCheckVideoResponse;
    try {
      data = await res.json() as RawCheckVideoResponse;
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return makeFailedResult(attempt, startTime, "서버 응답 파싱 실패");
      }
      continue;
    }
    consecutiveErrors = 0;

    // Status-based handling
    if (!data.status && data.error) {
      if (options.jobId && jobStore) {
        jobStore.markFailed(options.jobId, data.error, "unknown");
      }
      return makeFailedResult(attempt, startTime, data.error);
    }

    if (data.status === "COMPLETED" && data.videoUri) {
      if (options.jobId && jobStore) {
        jobStore.markCompleted(options.jobId, {
          resultUrl: data.videoUri,
          rawResultUrl: data.rawVideoUri,
          seed: data.seed,
        });
      }
      return {
        status: "completed",
        videoUri: data.videoUri,
        rawVideoUri: data.rawVideoUri,
        canonicalVideoUri: data.canonicalVideoUri,
        seed: data.seed,
        variants: data.variants,
        engine: "veo",
        needsUpload: data.needsUpload ?? false,
        completedAt: Date.now(),
        pollMeta: { totalAttempts: attempt + 1, totalDurationMs: Date.now() - startTime },
        _diag: data._diag,
      };
    }

    if (data.status === "FAILED") {
      const result = makeFailedResult(attempt, startTime, data.error || "비디오 생성 실패");
      result.noRetry = data.noRetry;
      if (options.jobId && jobStore) {
        jobStore.markFailed(options.jobId, result.error || "비디오 생성 실패", "provider_rejected");
      }
      return result;
    }

    // RUNNING — job store에 processing 마킹 + provider status 갱신
    if (options.jobId && jobStore) {
      const job = jobStore.getJob(options.jobId);
      if (job && job.status !== "processing") {
        // 첫 RUNNING 응답 → submitted에서 processing으로 전환
        jobStore.markProcessing(options.jobId, data.status || "processing");
      } else if (job && attempt % 10 === 0 && attempt > 0) {
        // 주기적 provider status 갱신
        jobStore.updatePollProgress(options.jobId, attempt, data.status || undefined);
      }
    }

    // RUNNING — notify progress and continue
    options.onProgress?.(attempt, maxAttempts, data.progress ?? undefined);
  }

  // Timeout — longRunning이면 recoverable, 아니면 hard timeout
  if (isLongRunning) {
    if (options.jobId && jobStore) {
      jobStore.markTimeoutRecoverable(options.jobId);
    }
    return makeTimeoutRecoverableResult(maxAttempts, startTime);
  }
  return makeTimeoutResult(maxAttempts, startTime);
}

// ═══════════════════════════════════════════════════════════════════
// Error Classification
// ═══════════════════════════════════════════════════════════════════

/**
 * 에러를 분류하여 type, message, retryable 여부를 반환한다.
 * 캔버스와 기존 경로 모두에서 동일한 분류 기준을 사용한다.
 */
export function classifyVideoError(
  error: unknown,
  statusCode?: number,
): VideoErrorClassification {
  const message = error instanceof Error ? error.message : String(error);

  // network errors
  if (message.includes("fetch") || message.includes("네트워크") || message.includes("NetworkError") || message.includes("Failed to fetch")) {
    return { type: "network", message: "네트워크 연결 실패", statusCode, retryable: true };
  }

  // status code based
  if (statusCode) {
    if (statusCode >= 400 && statusCode < 500) {
      return { type: "client", message: `클라이언트 오류 (${statusCode}): ${message}`, statusCode, retryable: false };
    }
    if (statusCode >= 500) {
      return { type: "server", message: `서버 오류 (${statusCode}): ${message}`, statusCode, retryable: true };
    }
  }

  // timeout
  if (message.includes("시간 초과") || message.includes("timeout") || message.includes("timed out")) {
    return { type: "timeout", message, retryable: true };
  }

  // parse errors
  if (message.includes("JSON") || message.includes("파싱") || message.includes("parse")) {
    return { type: "parse", message: "서버 응답 파싱 실패", retryable: true };
  }

  // API-level error (from server response)
  if (message.includes("API") || message.includes("VEO") || message.includes("Veo")) {
    return { type: "api_error", message, retryable: false };
  }

  return { type: "unknown", message, retryable: false };
}

// ═══════════════════════════════════════════════════════════════════
// Duration Meta
// ═══════════════════════════════════════════════════════════════════

/**
 * DurationMeta 빌더 — 요청된 값과 API 응답의 raw durationMeta를 병합하여
 * 기존 useVideoGeneration과 동일한 shape를 생성한다.
 */
export function buildDurationMeta(
  requestedSeconds: number | undefined,
  rawMeta?: RawDurationMeta,
): DurationMeta {
  const normalized = rawMeta?.normalizedSecondsPerScene ?? requestedSeconds ?? DURATION_FALLBACK;
  const sent = rawMeta?.sentSecondsPerScene;
  const warnings = rawMeta?.warnings ?? [];

  let source: DurationMeta["source"] = "fallback";
  if (rawMeta?.normalizedSecondsPerScene != null) {
    source = "api-response";
  } else if (requestedSeconds != null) {
    source = "slider";
  }

  return {
    requestedSecondsPerScene: requestedSeconds,
    normalizedSecondsPerScene: normalized,
    sentSecondsPerScene: sent,
    source,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Provider Meta
// ═══════════════════════════════════════════════════════════════════

/**
 * submit 응답에서 ProviderMeta를 추출한다.
 */
export function extractProviderMeta(submitResult: VideoSubmitResult): ProviderMeta {
  return {
    engine: submitResult.engine,
    modeUsed: submitResult.modeUsed,
    modelUsed: submitResult.modelUsed,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeFailedResult(attempt: number, startTime: number, error: string): NormalizedVideoResult {
  return {
    status: "failed",
    engine: "veo",
    needsUpload: false,
    error,
    completedAt: Date.now(),
    pollMeta: { totalAttempts: attempt + 1, totalDurationMs: Date.now() - startTime },
  };
}

function makeTimeoutResult(attempts: number, startTime: number, error?: string): NormalizedVideoResult {
  const elapsedMin = Math.round((Date.now() - startTime) / 60000);
  return {
    status: "timeout",
    engine: "veo",
    needsUpload: false,
    error: error || `영상 생성 타임아웃 (${elapsedMin}분 초과)`,
    completedAt: Date.now(),
    pollMeta: { totalAttempts: attempts, totalDurationMs: Date.now() - startTime },
  };
}

function makeTimeoutRecoverableResult(attempts: number, startTime: number): NormalizedVideoResult {
  const elapsedMin = Math.round((Date.now() - startTime) / 60000);
  return {
    status: "timeout_recoverable",
    engine: "veo",
    needsUpload: false,
    error: `${elapsedMin}분 동안 확인했지만 아직 완료되지 않았어요. 서버에서 계속 처리 중일 수 있어요.`,
    completedAt: Date.now(),
    pollMeta: { totalAttempts: attempts, totalDurationMs: Date.now() - startTime },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Continuity-Preserving Sequential Generation
// ═══════════════════════════════════════════════════════════════════

import type {
  SegmentState,
  ContinuitySequencePlan,
  ContinuitySegmentProgress,
  ContinuitySegmentStatus,
  ContinuityGenerationProgress,
  ContinuityValidationReport,
} from "@/types/continuity";
import { EMPTY_SEGMENT_STATE } from "@/types/continuity";
import { propagateEndState } from "@/lib/continuity-planner";
import { validateContinuity } from "@/lib/continuity-validator";

/** continuity 순차 생성의 세그먼트별 파라미터 빌더 */
export type ContinuitySegmentParamsBuilder = (
  segmentIndex: number,
  plan: ContinuitySequencePlan,
  prevEndState: SegmentState | undefined,
) => VideoSubmitParams;

/** continuity 순차 생성 옵션 */
export interface ContinuityGenerationOptions {
  /** 세그먼트별 submit params 빌더 — UI가 제공 */
  buildSegmentParams: ContinuitySegmentParamsBuilder;
  /** 진행 콜백 — UI가 React 상태에 반영 */
  onProgress: (progress: ContinuityGenerationProgress) => void;
  /** abort 시그널 */
  signal?: AbortSignal;
  /** polling 옵션 (세그먼트별 공통) */
  pollOptions?: Omit<PollOptions, "signal">;
  /** endState 추출기 — 생성 결과에서 endState를 추출 (기본: 빈 state) */
  extractEndState?: (result: NormalizedVideoResult, segmentIndex: number) => SegmentState;
}

/** continuity 순차 생성 결과 */
export interface ContinuityGenerationResult {
  /** 전체 성공 여부 */
  success: boolean;
  /** 세그먼트별 진행 상태 */
  segments: ContinuitySegmentProgress[];
  /** 검증 보고서 */
  validationReport: ContinuityValidationReport;
  /** 최종 계획 (endState가 채워진 상태) */
  finalPlan: ContinuitySequencePlan;
}

/**
 * continuity mode 순차 생성 orchestration.
 *
 * 핵심 흐름:
 * 1. 세그먼트 1 생성 → 완료 대기 → endState 확정
 * 2. endState를 다음 세그먼트 startState로 전파
 * 3. 세그먼트 2 생성 → 완료 대기 → endState 확정 → ...
 * 4. 전체 완료 → 연속성 검증
 *
 * 이 함수는 React 의존성이 없다. UI hook은 onProgress 콜백으로만 연결.
 */
export async function submitContinuitySequence(
  initialPlan: ContinuitySequencePlan,
  options: ContinuityGenerationOptions,
): Promise<ContinuityGenerationResult> {
  let plan = initialPlan;
  const segmentCount = plan.segmentCount;

  // 초기 진행 상태
  const segmentProgresses: ContinuitySegmentProgress[] = plan.segments.map((seg) => ({
    segmentIndex: seg.segmentIndex,
    status: "pending" as ContinuitySegmentStatus,
  }));

  const reportProgress = (currentIndex: number) => {
    const completedCount = segmentProgresses.filter(s => s.status === "completed").length;
    const overallPercent = Math.round((completedCount / segmentCount) * 100);
    options.onProgress({
      planId: plan.planId,
      totalSegments: segmentCount,
      currentSegmentIndex: currentIndex,
      segments: [...segmentProgresses],
      overallPercent,
      validated: false,
    });
  };

  // 순차 생성 루프
  for (let i = 0; i < segmentCount; i++) {
    // abort check
    if (options.signal?.aborted) {
      segmentProgresses[i].status = "failed";
      segmentProgresses[i].error = "사용자에 의해 취소됨";
      break;
    }

    // 이전 세그먼트의 endState
    const prevEndState = i > 0 ? segmentProgresses[i - 1].confirmedEndState : undefined;

    // endState 전파 (planner가 계획 갱신)
    if (i > 0 && prevEndState) {
      plan = propagateEndState(plan, i - 1, prevEndState);
    }

    // 1. submit
    segmentProgresses[i].status = "generating";
    reportProgress(i);

    let submitResult: VideoSubmitResult;
    try {
      const params = options.buildSegmentParams(i, plan, prevEndState);
      submitResult = await submitVideoGeneration(params);
    } catch (err) {
      segmentProgresses[i].status = "failed";
      segmentProgresses[i].error = err instanceof Error ? err.message : String(err);
      reportProgress(i);
      // 하나 실패해도 계속 진행하지 않음 (순차 의존)
      break;
    }

    segmentProgresses[i].taskId = submitResult.taskId;

    // 2. polling
    segmentProgresses[i].status = "polling";
    reportProgress(i);

    const pollResult = await pollVideoTask(submitResult.taskId, {
      ...options.pollOptions,
      signal: options.signal,
      longRunning: true,
    });

    if (pollResult.status === "completed") {
      segmentProgresses[i].status = "completed";
      segmentProgresses[i].videoUri = pollResult.videoUri;

      // endState 추출
      const extractFn = options.extractEndState ?? defaultExtractEndState;
      segmentProgresses[i].confirmedEndState = extractFn(pollResult, i);

      reportProgress(i);
    } else {
      segmentProgresses[i].status = "failed";
      segmentProgresses[i].error = pollResult.error || "생성 실패";
      reportProgress(i);
      break;
    }
  }

  // 검증
  const validationReport = validateContinuity(segmentProgresses);
  const allCompleted = segmentProgresses.every(s => s.status === "completed");

  // 최종 진행 상태 보고 (검증 포함)
  options.onProgress({
    planId: plan.planId,
    totalSegments: segmentCount,
    currentSegmentIndex: segmentCount - 1,
    segments: [...segmentProgresses],
    overallPercent: allCompleted ? 100 : Math.round(
      (segmentProgresses.filter(s => s.status === "completed").length / segmentCount) * 100,
    ),
    validated: true,
    validationReport,
  });

  return {
    success: allCompleted && validationReport.pass,
    segments: segmentProgresses,
    validationReport,
    finalPlan: plan,
  };
}

/**
 * 특정 세그먼트만 재생성한다.
 * 이전/다음 세그먼트의 endState는 유지하고, 해당 세그먼트만 다시 생성.
 */
export async function regenerateContinuitySegment(
  plan: ContinuitySequencePlan,
  segmentIndex: number,
  existingProgresses: ContinuitySegmentProgress[],
  options: ContinuityGenerationOptions,
): Promise<ContinuitySegmentProgress> {
  const prevEndState = segmentIndex > 0
    ? existingProgresses[segmentIndex - 1]?.confirmedEndState
    : undefined;

  // submit
  const params = options.buildSegmentParams(segmentIndex, plan, prevEndState);
  const submitResult = await submitVideoGeneration(params);

  // polling
  const pollResult = await pollVideoTask(submitResult.taskId, {
    ...options.pollOptions,
    signal: options.signal,
    longRunning: true,
  });

  const extractFn = options.extractEndState ?? defaultExtractEndState;

  if (pollResult.status === "completed") {
    return {
      segmentIndex,
      status: "completed",
      taskId: submitResult.taskId,
      videoUri: pollResult.videoUri,
      confirmedEndState: extractFn(pollResult, segmentIndex),
    };
  }

  return {
    segmentIndex,
    status: "failed",
    taskId: submitResult.taskId,
    error: pollResult.error || "재생성 실패",
  };
}

/** 기본 endState 추출기 — 영상 결과만으로는 상태 추출 불가하므로 빈 상태 반환 */
function defaultExtractEndState(_result: NormalizedVideoResult, _segmentIndex: number): SegmentState {
  // 실제로는 generate-cuts에서 계획한 endState를 사용.
  // 영상 자체에서 프레임 분석으로 추출하는 것은 향후 확장.
  return { ...EMPTY_SEGMENT_STATE };
}
