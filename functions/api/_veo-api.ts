/**
 * _veo-api.ts — Google VEO Video Generation API client
 *
 * Auth: x-goog-api-key (GEMINI_API_KEY — Gemini 텍스트 생성과 동일한 키 재활용)
 * Base: https://generativelanguage.googleapis.com/v1beta
 *
 * Endpoints:
 *   POST /models/{model}:predictLongRunning   — 영상 생성 / 연장
 *   GET  /{operation_name}                    — 작업 상태 폴링
 *
 * Extension:
 *   VEO 3.1은 네이티브 비디오 연장 지원.
 *   이전 생성 결과 video를 instances[0].video로 전달 + 새 prompt.
 *   연장 시 ~7초 추가, 최대 20회, 입력 최대 141초.
 *
 * Models:
 *   기본 = veo-3.1-fast-generate-preview (가장 저렴, $0.15/초, 연장 가능)
 *   모델 상수와 capability는 _veo-capability.ts에서 중앙 관리
 */

import {
  VEO_DEFAULT_MODEL,
  VEO_MODELS,
  getCapability,
  clampToSupportedDuration,
  resolveModelForWorkflow,
  supportsExtension,
  isVideoGenerationModel,
  VEO_SEGMENT_CAP,
  VEO_EXTENSION_DURATION,
} from "./_veo-capability";
export type { VeoModelId, WorkflowType, VeoModelCapability } from "./_veo-capability";
export {
  VEO_DEFAULT_MODEL,
  VEO_MODELS,
  getCapability,
  clampToSupportedDuration,
  resolveModelForWorkflow,
  supportsExtension,
  isVideoGenerationModel,
  VEO_SEGMENT_CAP,
  VEO_EXTENSION_DURATION,
};

// ── 에러 분류 ────────────────────────────────────────────────────────────────
export class VeoApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  constructor(message: string, code: string, retryable: boolean, httpStatus?: number) {
    super(message);
    this.name = "VeoApiError";
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

export interface VeoEnv {
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY_2?: string;
}

const VEO_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** API 키 목록 반환 (fallback 순서) */
function getApiKeys(env: VeoEnv): string[] {
  const keys: string[] = [];
  if (env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY);
  if (env.GEMINI_API_KEY_2) keys.push(env.GEMINI_API_KEY_2);
  if (keys.length === 0) throw new VeoApiError("GEMINI_API_KEY not configured", "missing_api_key", false);
  return keys;
}

function veoHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };
}

/** VEO fetch with key fallback — 첫 번째 키 실패(429/401/403) 시 두 번째 키로 재시도 */
async function veoFetchWithKeyFallback(
  env: VeoEnv,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const keys = getApiKeys(env);
  let lastError: Error | null = null;

  for (const key of keys) {
    const headers = { ...veoHeaders(key), ...(init.headers as Record<string, string> || {}) };
    try {
      const res = await fetch(url, { ...init, headers });
      // 키 관련 에러만 fallback (429 rate limit, 401/403 auth)
      if ((res.status === 429 || res.status === 401 || res.status === 403) && keys.indexOf(key) < keys.length - 1) {
        console.warn(`[_veo-api] Key ${keys.indexOf(key) + 1} failed (${res.status}), trying next key`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (keys.indexOf(key) < keys.length - 1) {
        console.warn(`[_veo-api] Key ${keys.indexOf(key) + 1} fetch error, trying next key:`, lastError.message);
        continue;
      }
    }
  }
  throw lastError || new VeoApiError("All API keys failed", "api_error", true);
}

// ── Request / Response types ─────────────────────────────────────────────────

export interface VeoGenerateRequest {
  prompt: string;
  /** 모델 ID (미지정 시 기본값) */
  model?: string;
  /** 듀레이션 (초): 4, 6, 8 */
  durationSeconds?: number;
  /** 화면비 */
  aspectRatio?: "16:9" | "9:16";
  /** 해상도 */
  resolution?: "720p" | "1080p" | "4k";
  /** 인물 생성 허용 수준 */
  personGeneration?: "allow_all" | "allow_adult" | "dont_allow";
  /** 오디오 생성 */
  generateAudio?: boolean;
  /** Image-to-video: 시작 프레임 base64 */
  imageBase64?: string;
  imageMimeType?: string;
  /** 마지막 프레임 base64 (for last frame guidance) */
  lastFrameBase64?: string;
  lastFrameMimeType?: string;
}

export interface VeoExtendRequest {
  prompt: string;
  /** 이전 생성의 비디오 URI (VEO 서버에서 접근 가능한 URI) */
  sourceVideoUri: string;
  /** 모델 ID (미지정 시 연장 가능한 기본값) */
  model?: string;
  aspectRatio?: "16:9" | "9:16";
  resolution?: "720p" | "1080p" | "4k";
  personGeneration?: "allow_all" | "allow_adult" | "dont_allow";
  generateAudio?: boolean;
}

export interface VeoTaskStatus {
  operationName: string;
  done: boolean;
  status: "pending" | "processing" | "completed" | "failed";
  videoUri?: string;
  error?: string;
}

// ── Generate ─────────────────────────────────────────────────────────────────

export async function veoGenerate(
  env: VeoEnv,
  req: VeoGenerateRequest,
): Promise<{ operationName: string; model: string; durationSent: number }> {
  const headers = veoHeaders(getApiKeys(env)[0]);
  const model = req.model || VEO_DEFAULT_MODEL;
  const cap = getCapability(model);
  const duration = req.durationSeconds
    ? clampToSupportedDuration(model, req.durationSeconds)
    : cap.defaultDuration;

  console.log("[_veo-api] veoGenerate", {
    model,
    duration,
    hasImage: !!req.imageBase64,
    hasLastFrame: !!req.lastFrameBase64,
  });

  // Build instances
  const instance: Record<string, unknown> = {
    prompt: req.prompt,
  };
  if (req.imageBase64) {
    instance.image = {
      inlineData: {
        mimeType: req.imageMimeType || "image/png",
        data: req.imageBase64,
      },
    };
  }
  if (req.lastFrameBase64) {
    instance.lastFrame = {
      inlineData: {
        mimeType: req.lastFrameMimeType || "image/png",
        data: req.lastFrameBase64,
      },
    };
  }

  const parameters: Record<string, unknown> = {
    aspectRatio: req.aspectRatio || "16:9",
    durationSeconds: duration,
    resolution: req.resolution || cap.defaultResolution,
    personGeneration: req.personGeneration || "allow_all",
  };
  if (req.generateAudio !== false && cap.supportsAudio) {
    parameters.generateAudio = true;
  }

  const body = {
    instances: [instance],
    parameters,
  };

  const url = `${VEO_API_BASE}/models/${model}:predictLongRunning`;
  const res = await veoFetchWithKeyFallback(env, url, {
    method: "POST",
    body: JSON.stringify(body),
  });

  let text = await res.text();
  if (!res.ok) {
    const httpStatus = res.status;
    console.error("[_veo-api] veoGenerate failed", { httpStatus, body: text.slice(0, 500) });

    // ── inlineData 미지원 모델 → 이미지 제거 후 재시도 ──
    if (httpStatus === 400 && text.includes("inlineData") && (instance.image || instance.lastFrame)) {
      console.warn("[_veo-api] inlineData not supported by model — retrying without image/lastFrame");
      const cleanInstance = { prompt: instance.prompt };
      const retryBody = { instances: [cleanInstance], parameters };
      const retryRes = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(retryBody),
      });
      text = await retryRes.text();
      if (!retryRes.ok) {
        const retryStatus = retryRes.status;
        console.error("[_veo-api] veoGenerate retry (no image) failed", { retryStatus, body: text.slice(0, 500) });
        throw new VeoApiError(`VEO generate (${retryStatus}): ${text.slice(0, 400)}`, "api_error", retryStatus >= 500, retryStatus);
      }
      // fall through to parse the retry response
    }
    // ── generateAudio 미지원 모델 → 자동 재시도 (오디오 없이) ──
    else if (httpStatus === 400 && text.includes("generateAudio") && parameters.generateAudio) {
      console.warn("[_veo-api] generateAudio not supported by model — retrying without audio");
      delete parameters.generateAudio;
      const retryBody = { instances: body.instances, parameters };
      const retryRes = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(retryBody),
      });
      text = await retryRes.text();
      if (!retryRes.ok) {
        const retryStatus = retryRes.status;
        console.error("[_veo-api] veoGenerate retry (no audio) failed", { retryStatus, body: text.slice(0, 500) });
        throw new VeoApiError(`VEO generate (${retryStatus}): ${text.slice(0, 400)}`, "api_error", retryStatus >= 500, retryStatus);
      }
      // fall through to parse the retry response
    } else {
      if (httpStatus === 403 || httpStatus === 401) {
        throw new VeoApiError(`VEO API 인증 실패 (${httpStatus}): ${text.slice(0, 300)}`, "auth_error", false, httpStatus);
      }
      if (httpStatus === 429) {
        throw new VeoApiError(`VEO API 속도 제한: ${text.slice(0, 300)}`, "rate_limited", true, httpStatus);
      }
      throw new VeoApiError(`VEO generate (${httpStatus}): ${text.slice(0, 400)}`, "api_error", httpStatus >= 500, httpStatus);
    }
  }

  let data: { name?: string; error?: { message?: string } };
  try {
    data = JSON.parse(text);
  } catch {
    throw new VeoApiError(`VEO generate non-JSON: ${text.slice(0, 200)}`, "parse_error", false);
  }

  if (data.error?.message) {
    throw new VeoApiError(`VEO generate failed: ${data.error.message}`, "api_error", false);
  }

  const operationName = data.name;
  if (!operationName) {
    throw new VeoApiError("VEO generate: no operation name in response", "missing_operation", false);
  }

  return { operationName, model, durationSent: duration };
}

// ── Extend (VEO 네이티브 비디오 연장) ────────────────────────────────────────

export async function veoExtend(
  env: VeoEnv,
  req: VeoExtendRequest,
): Promise<{ operationName: string; model: string; durationSent: number }> {
  const headers = veoHeaders(getApiKeys(env)[0]);
  const model = req.model || VEO_DEFAULT_MODEL;
  const cap = getCapability(model);

  if (!cap.supportsExtension) {
    throw new VeoApiError(
      `모델 "${model}"은 비디오 연장을 지원하지 않습니다. veo-3.1-fast-generate-preview 또는 veo-3.1-generate-preview를 사용하세요.`,
      "extension_not_supported",
      false,
    );
  }

  if (!req.sourceVideoUri) {
    throw new VeoApiError(
      "VEO extend: sourceVideoUri is required",
      "missing_source_video",
      false,
    );
  }

  console.log("[_veo-api] veoExtend", {
    model,
    sourceVideoUri: req.sourceVideoUri.slice(0, 80),
  });

  // empty prompt 방지 — 빈 프롬프트로 API 호출하면 $0.15+ 낭비
  if (!req.prompt || req.prompt.trim().length < 10) {
    throw new VeoApiError(
      `VEO extend: prompt too short (${req.prompt?.length ?? 0} chars) — refusing to waste API call`,
      "invalid_prompt",
      false,
    );
  }

  const instance: Record<string, unknown> = {
    prompt: req.prompt,
    video: {
      uri: req.sourceVideoUri,
    },
  };

  const parameters: Record<string, unknown> = {
    aspectRatio: req.aspectRatio || "16:9",
    resolution: req.resolution || "720p",  // 연장은 720p만 지원
    personGeneration: req.personGeneration || "allow_all",
  };
  if (req.generateAudio !== false && cap.supportsAudio) {
    parameters.generateAudio = true;
  }

  const body = {
    instances: [instance],
    parameters,
  };

  const url = `${VEO_API_BASE}/models/${model}:predictLongRunning`;
  const res = await veoFetchWithKeyFallback(env, url, {
    method: "POST",
    body: JSON.stringify(body),
  });

  let text = await res.text();
  if (!res.ok) {
    const httpStatus = res.status;
    console.error("[_veo-api] veoExtend failed", { httpStatus, body: text.slice(0, 500) });

    // ── generateAudio 미지원 모델 → 자동 재시도 (오디오 없이) ──
    if (httpStatus === 400 && text.includes("generateAudio") && parameters.generateAudio) {
      console.warn("[_veo-api] veoExtend: generateAudio not supported — retrying without audio");
      delete parameters.generateAudio;
      const retryBody = { instances: body.instances, parameters };
      const retryRes = await veoFetchWithKeyFallback(env, url, {
        method: "POST",
        body: JSON.stringify(retryBody),
      });
      text = await retryRes.text();
      if (!retryRes.ok) {
        const retryStatus = retryRes.status;
        console.error("[_veo-api] veoExtend retry (no audio) failed", { retryStatus, body: text.slice(0, 500) });
        throw new VeoApiError(`VEO extend (${retryStatus}): ${text.slice(0, 400)}`, "api_error", retryStatus >= 500, retryStatus);
      }
    } else {
      if (httpStatus === 403 || httpStatus === 401) {
        throw new VeoApiError(`VEO extend 인증 실패 (${httpStatus}): ${text.slice(0, 300)}`, "auth_error", false, httpStatus);
      }
      if (httpStatus === 429) {
        throw new VeoApiError(`VEO extend 속도 제한: ${text.slice(0, 300)}`, "rate_limited", true, httpStatus);
      }
      throw new VeoApiError(`VEO extend (${httpStatus}): ${text.slice(0, 400)}`, "api_error", httpStatus >= 500, httpStatus);
    }
  }

  let data: { name?: string; error?: { message?: string } };
  try {
    data = JSON.parse(text);
  } catch {
    throw new VeoApiError(`VEO extend non-JSON: ${text.slice(0, 200)}`, "parse_error", false);
  }

  if (data.error?.message) {
    throw new VeoApiError(`VEO extend failed: ${data.error.message}`, "api_error", false);
  }

  const operationName = data.name;
  if (!operationName) {
    throw new VeoApiError("VEO extend: no operation name in response", "missing_operation", false);
  }

  return { operationName, model, durationSent: cap.extensionDurationSec };
}

// ── Check Status ─────────────────────────────────────────────────────────────

export async function veoCheckStatus(
  env: VeoEnv,
  operationName: string,
): Promise<VeoTaskStatus> {
  const headers = veoHeaders(getApiKeys(env)[0]);

  const url = `${VEO_API_BASE}/${operationName}`;
  const res = await fetch(url, {
    method: "GET",
    headers,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new VeoApiError(`VEO check (${res.status}): ${text.slice(0, 400)}`, "api_error", res.status >= 500, res.status);
  }

  let data: {
    name?: string;
    done?: boolean;
    response?: {
      generateVideoResponse?: {
        generatedSamples?: Array<{
          video?: { uri?: string; mimeType?: string };
        }>;
      };
    };
    error?: { message?: string; code?: number };
  };
  try {
    data = JSON.parse(text);
  } catch {
    throw new VeoApiError(`VEO check non-JSON: ${text.slice(0, 200)}`, "parse_error", false);
  }

  console.log("[_veo-api] veoCheckStatus", {
    operationName: operationName.slice(0, 60),
    done: data.done,
    hasResponse: !!data.response,
    hasError: !!data.error,
  });

  if (data.error) {
    return {
      operationName,
      done: true,
      status: "failed",
      error: data.error.message || `Error code: ${data.error.code}`,
    };
  }

  if (!data.done) {
    return {
      operationName,
      done: false,
      status: "processing",
    };
  }

  // 완료 — 비디오 URI 추출
  const samples = data.response?.generateVideoResponse?.generatedSamples;
  const videoUri = samples?.[0]?.video?.uri;

  if (!videoUri) {
    console.warn("[_veo-api] VEO completed but no video URI found", {
      operationName: operationName.slice(0, 60),
      responseKeys: data.response ? Object.keys(data.response) : [],
    });
    return {
      operationName,
      done: true,
      status: "failed",
      error: "VEO generation completed but no video URI in response",
    };
  }

  return {
    operationName,
    done: true,
    status: "completed",
    videoUri,
  };
}

// ── Duration / Aspect ratio helpers ──────────────────────────────────────────

/**
 * 입력 초 → VEO 지원 초 매핑.
 * VEO API: 4, 6, 8초 이산값 지원.
 */
export function toVeoDuration(sec: number): number {
  return clampToSupportedDuration(VEO_DEFAULT_MODEL, sec);
}

export function toVeoAspectRatio(ratio: string): "16:9" | "9:16" {
  return ratio === "9:16" ? "9:16" : "16:9";
}
