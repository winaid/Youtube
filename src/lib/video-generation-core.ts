/**
 * video-generation-core.ts — 공통 비디오 생성 헬퍼
 *
 * 캔버스 노드 실행과 기존 useVideoGeneration이 동일한
 * submit / polling / response normalization / error classification / meta 로직을 공유한다.
 *
 * 이 모듈은 순수 함수와 async 함수만 포함하며, React 의존성이 없다.
 */

import type { DurationMeta } from "@/types";
import { DURATION_FALLBACK } from "@/lib/duration-reconciliation";

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
  engine?: "kling" | "auto";
  videoMode?: "generate" | "extend";
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
  /** hook-specific 추가 필드 (mode, resolution, seed 등) — body에 그대로 spread */
  extraFields?: Record<string, unknown>;
}

/** generate-video API 응답 */
export interface VideoSubmitResult {
  taskId: string;
  operationName: string;
  engine: "kling";
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
  status: "completed" | "failed" | "timeout";
  videoUri?: string;
  rawVideoUri?: string;
  canonicalVideoUri?: string | null;
  seed?: string;
  variants?: Array<{ videoUri: string; rawVideoUri?: string }>;
  engine: "kling";
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
}

/** provider/model 메타 */
export interface ProviderMeta {
  engine: "kling";
  modeUsed: "generate" | "extend";
  modelUsed: string;
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

export const POLL_MAX_ATTEMPTS = 72;
export const MAX_CONSECUTIVE_ERRORS = 3;
export const POLL_ERROR_BACKOFF = [5000, 7500, 10000, 15000, 20000];

// ═══════════════════════════════════════════════════════════════════
// Adaptive Polling Interval
// ═══════════════════════════════════════════════════════════════════

/**
 * 적응형 폴링 간격 — Kling은 보통 30-90초 소요.
 * 초반 5초 → 90초 이후 7초로 서버 부담 경감.
 */
export function getAdaptivePollInterval(attempt: number): number {
  if (attempt < 18) return 5000;  // 0-90s: 5s 간격
  return 7000;                     // 90s+: 7s 간격
}

// ═══════════════════════════════════════════════════════════════════
// Submit
// ═══════════════════════════════════════════════════════════════════

/**
 * /api/generate-video에 생성 요청을 제출한다.
 * 캔버스와 기존 useVideoGeneration 양쪽에서 사용.
 */
export async function submitVideoGeneration(
  params: VideoSubmitParams,
): Promise<VideoSubmitResult> {
  const body: Record<string, unknown> = {
    engine: params.engine || "kling",
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
  if (params.multiShot) body.multiShot = params.multiShot;
  if (params.sourceVideo) body.sourceVideo = params.sourceVideo;

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
    engine: "kling",
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
 */
export async function pollVideoTask(
  taskId: string,
  options: PollOptions = {},
): Promise<NormalizedVideoResult> {
  const maxAttempts = options.maxAttempts ?? POLL_MAX_ATTEMPTS;
  const useAdaptive = options.fixedIntervalMs == null;
  let consecutiveErrors = 0;
  const startTime = Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // abort check
    if (options.signal?.aborted) {
      return makeTimeoutResult(attempt, startTime, "폴링이 취소되었습니다");
    }

    // wait before polling (skip first attempt)
    if (attempt > 0) {
      const waitMs = consecutiveErrors > 0
        ? POLL_ERROR_BACKOFF[Math.min(consecutiveErrors - 1, POLL_ERROR_BACKOFF.length - 1)]
        : useAdaptive
          ? getAdaptivePollInterval(attempt)
          : options.fixedIntervalMs!;
      await sleep(waitMs);
    }

    // HTTP request
    let res: Response;
    try {
      res = await fetch("/api/check-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, engine: "kling", ...options.extraPollBody }),
      });
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return makeFailedResult(attempt, startTime, "네트워크 연결 실패 — 인터넷 연결을 확인하세요");
      }
      continue;
    }

    // HTTP error
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        // 4xx: client error → no retry
        const errBody = await res.json().catch(() => ({})) as { error?: string };
        return makeFailedResult(attempt, startTime, errBody.error || `클라이언트 오류 (${res.status})`);
      }
      // 5xx: server error → retry with backoff
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return makeFailedResult(attempt, startTime, `서버 오류 (${res.status}) — 잠시 후 다시 시도하세요`);
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
      return makeFailedResult(attempt, startTime, data.error);
    }

    if (data.status === "COMPLETED" && data.videoUri) {
      return {
        status: "completed",
        videoUri: data.videoUri,
        rawVideoUri: data.rawVideoUri,
        canonicalVideoUri: data.canonicalVideoUri,
        seed: data.seed,
        variants: data.variants,
        engine: "kling",
        needsUpload: data.needsUpload ?? false,
        completedAt: Date.now(),
        pollMeta: { totalAttempts: attempt + 1, totalDurationMs: Date.now() - startTime },
        _diag: data._diag,
      };
    }

    if (data.status === "FAILED") {
      const result = makeFailedResult(attempt, startTime, data.error || "비디오 생성 실패");
      result.noRetry = data.noRetry;
      return result;
    }

    // RUNNING — notify progress and continue
    options.onProgress?.(attempt, maxAttempts, data.progress ?? undefined);
  }

  // Timeout
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
  if (message.includes("API") || message.includes("Kling")) {
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
    engine: "kling",
    needsUpload: false,
    error,
    completedAt: Date.now(),
    pollMeta: { totalAttempts: attempt + 1, totalDurationMs: Date.now() - startTime },
  };
}

function makeTimeoutResult(attempts: number, startTime: number, error?: string): NormalizedVideoResult {
  return {
    status: "timeout",
    engine: "kling",
    needsUpload: false,
    error: error || `영상 생성 타임아웃 (${Math.round(attempts * 5 / 60)}분 초과)`,
    completedAt: Date.now(),
    pollMeta: { totalAttempts: attempts, totalDurationMs: Date.now() - startTime },
  };
}
