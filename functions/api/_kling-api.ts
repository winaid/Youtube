/**
 * _kling-api.ts — EvoLink.AI Kling Video API helper
 *
 * Auth: Bearer token (KLING_API_KEY)
 * Base: https://api.evolink.ai  (KLING_API_BASE_URL으로 재정의 가능)
 *
 * Endpoints:
 *   POST /v1/videos/generations   — 영상 생성 (text-to-video / image-to-video)
 *   GET  /v1/tasks/{task_id}      — 작업 상태 폴링
 *
 * Extend 모드:
 *   EvoLink에 native video-extend 없음.
 *   이전 컷 lastFrameBase64 → image 파라미터로 전달해 image-to-video로 대체.
 *
 * Models:
 *   O3 = 기본 모델 (6샷, minShotDuration 2초)
 *   v3 = 레거시 fallback (3샷, minShotDuration 3초)
 *   모델 상수와 capability는 _kling-capability.ts에서 중앙 관리
 */

// ── 모델 상수 (capability 모듈에서 import) ─────────────────────────────────
export {
  KLING_MODELS,
  KLING_DEFAULT_MODEL,
  KLING_DEFAULT_TEXT_MODEL,
  KLING_DEFAULT_IMAGE_MODEL,
  type KlingModelId,
  getCapability,
  getMaxShots,
  normalizeMultiShots,
  resolveModel,
  resolveModelWithFallback,
} from "./_kling-capability";

// ── 에러 분류 ────────────────────────────────────────────────────────────────
export class KlingModelAccessDeniedError extends Error {
  readonly code = "model_access_denied" as const;
  readonly retryable = false;
  readonly modelRequested: string;
  constructor(modelRequested: string, raw: string) {
    super(`Kling 403 model_access_denied: token does not have access to model "${modelRequested}". ${raw}`);
    this.name = "KlingModelAccessDeniedError";
    this.modelRequested = modelRequested;
  }
}

export interface KlingEnv {
  KLING_API_KEY?:      string;
  KLING_API_BASE_URL?: string; // default: https://api.evolink.ai
}

function klingBase(env: KlingEnv): string {
  return (env.KLING_API_BASE_URL ?? "https://api.evolink.ai").replace(/\/$/, "");
}

function klingHeaders(env: KlingEnv): Record<string, string> {
  const key = env.KLING_API_KEY ?? "";
  if (!key) throw new Error("KLING_API_KEY not configured");
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
  };
}

// ── Request / Response types ─────────────────────────────────────────────────

export interface KlingMultiShot {
  index: number;
  prompt: string;
  duration: string; // 초 단위 문자열 (예: "5")
}

/** Kling Custom Element — video generation 시 element_list에 전달 */
export interface KlingElementRef {
  element_id: string;
}

export interface KlingGenerateRequest {
  prompt: string;
  negative_prompt?: string;
  /** default: KLING_MODELS.TEXT_TO_VIDEO or KLING_MODELS.IMAGE_TO_VIDEO if image supplied */
  model?: string;
  duration?: number;  // EvoLink o3: 3~15초 정수 지원
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  cfg_scale?: number;
  quality?: "720p" | "1080p";
  sound?: "on" | "off"; // o3 모델 사운드 파라미터: "on" = 사운드 ON, "off" = 무음 (default: "on")
  // Multi-shot: 1장면에 여러 카메라 앵글/구도 지정
  multiShot?: KlingMultiShot[];
  // Image-to-video
  image?: string;       // base64 or public URL for start frame
  image_tail?: string;  // base64 or public URL for end frame
  // Custom Element: reusable subject identity (캐릭터 일관성)
  element_list?: KlingElementRef[];
}

export interface KlingExtendRequest {
  /**
   * EvoLink에 native video-extend 없음.
   * lastFrameBase64: 이전 컷 끝 프레임 → image-to-video의 start frame으로 사용
   */
  lastFrameBase64: string;
  prompt?: string;
  negative_prompt?: string;
  duration?: number;  // EvoLink o3: 3~15초 정수 지원
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  sound?: "on" | "off"; // o3 사운드: "on"=사운드 생성, "off"=무음
}

export interface KlingTaskStatus {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress?: number;
  videoUrl?: string;   // first result URI (when completed)
  videoId?: string;    // task_id doubles as reference ID for next extend
  error?: string;
}

// ── Generate ─────────────────────────────────────────────────────────────────

export async function klingGenerate(
  env: KlingEnv,
  req: KlingGenerateRequest,
): Promise<{ taskId: string; sentDuration: number }> {
  const headers = klingHeaders(env);
  const model = resolveModel(req.model, !!req.image);

  // 요청 직전 실제 사용 모델 로깅
  console.log("[_kling-api] klingGenerate model selected", {
    modelRequested: req.model ?? "(default)",
    modelUsed: model,
    hasImage: !!req.image,
  });

  // image-to-video 모델인데 image가 없으면 EvoLink 1201 에러 발생 → 사전 차단
  const isImageModel = model.includes("image-to-video");
  if (isImageModel && !req.image) {
    throw new Error(
      `Kling: model="${model}" requires an image, but image is missing or empty after base64 stripping. ` +
      `Check that lastFrameBase64/firstFrameBase64 contains valid base64 data (not just a data-URI prefix).`,
    );
  }

  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    duration: req.duration ?? 5,
    aspect_ratio: req.aspect_ratio ?? "16:9",
    sound: req.sound ?? "on",  // EvoLink o3 사운드 파라미터: "on"/"off"
  };
  if (req.negative_prompt) body.negative_prompt = req.negative_prompt;
  if (req.cfg_scale !== undefined) body.cfg_scale = req.cfg_scale;
  if (req.quality) body.quality = req.quality;
  if (req.image)      body.image      = req.image;
  if (req.image_tail) body.image_tail = req.image_tail;
  // Multi-shot: capability 기반 clamp — 모델별 maxShots + duration 기반 자연스러운 상한
  const effectiveDuration = (body.duration as number) ?? 5;
  if (req.multiShot && req.multiShot.length > 0) {
    const normalized = normalizeMultiShots(model, req.multiShot, effectiveDuration);
    if (normalized.length > 0) {
      body.model_params = {
        multi_shot: true,
        shot_type: "customize",
        multi_prompt: normalized,
      };
      if (req.multiShot.length > normalized.length) {
        console.warn(`[_kling-api] multiShot clamped: ${req.multiShot.length} → ${normalized.length} (model=${model}, duration=${effectiveDuration}s)`);
      }
    }
  }

  // Custom Element: element_list → model_params.element_list
  if (req.element_list && req.element_list.length > 0) {
    if (!body.model_params) body.model_params = {};
    (body.model_params as Record<string, unknown>).element_list = req.element_list.map((el) => ({
      element_id: el.element_id,
    }));
    console.log("[_kling-api] element_list injected", {
      count: req.element_list.length,
      elementIds: req.element_list.map((el) => el.element_id),
    });
  }

  const res = await fetch(`${klingBase(env)}/v1/videos/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const httpStatus = res.status;

    // 403 model_access_denied — 재시도 불가, 명시적 에러 분류
    if (httpStatus === 403 && text.includes("model_access_denied")) {
      throw new KlingModelAccessDeniedError(model, text.slice(0, 400));
    }

    const err = new Error(`Kling generate (${httpStatus}): ${text.slice(0, 400)}`);
    (err as Error & { httpStatus: number }).httpStatus = httpStatus;
    throw err;
  }

  let data: { id?: string; task_id?: string; error?: { message?: string } };
  try { data = JSON.parse(text); } catch { throw new Error(`Kling generate non-JSON: ${text.slice(0, 200)}`); }

  if (data.error?.message) throw new Error(`Kling generate failed: ${data.error.message}`);

  const taskId = data.id ?? data.task_id;
  if (!taskId) throw new Error("Kling generate: no task id in response");
  return { taskId, sentDuration: (body.duration as number) ?? 5 };
}

// ── Extend (last-frame image-to-video) ──────────────────────────────────────

export async function klingExtend(
  env: KlingEnv,
  req: KlingExtendRequest,
): Promise<{ taskId: string; sentDuration: number }> {
  // 빈 문자열·공백만 있는 경우도 차단 (data:image/png;base64, 만 있으면 strip 후 "" or " ")
  if (!req.lastFrameBase64 || req.lastFrameBase64.trim().length < 100) {
    throw new Error(
      `Kling extend: lastFrameBase64 is missing or too short after stripping (len=${req.lastFrameBase64?.length ?? 0}). ` +
      "Ensure the base64 data (not data-URI prefix) is at least 100 chars.",
    );
  }

  return klingGenerate(env, {
    model:           KLING_MODELS.IMAGE_TO_VIDEO,
    prompt:          req.prompt ?? "continue the scene naturally",
    negative_prompt: req.negative_prompt,
    duration:        req.duration ?? 5,
    aspect_ratio:    req.aspect_ratio ?? "16:9",
    image:           req.lastFrameBase64,
    sound:           req.sound ?? "on",
  });
}

// ── Check Status ─────────────────────────────────────────────────────────────

export async function klingCheckStatus(
  env: KlingEnv,
  taskId: string,
  _isExtend: boolean,  // kept for interface compat — EvoLink uses unified tasks endpoint
): Promise<KlingTaskStatus> {
  const headers = klingHeaders(env);

  const res = await fetch(`${klingBase(env)}/v1/tasks/${taskId}`, {
    method: "GET",
    headers,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Kling check (${res.status}): ${text.slice(0, 400)}`);

  let data: {
    id?: string;
    task_id?: string;
    status?: string;
    progress?: number;
    results?: string[];
    // EvoLink API가 data 래퍼를 쓰는 경우
    data?: {
      id?: string;
      status?: string;
      progress?: number;
      works?: { resource?: { resource?: string } }[];
    };
    error?: { message?: string } | string;
  };
  try { data = JSON.parse(text); } catch { throw new Error(`Kling check non-JSON: ${text.slice(0, 200)}`); }

  // raw 응답 로그
  console.log("[_kling-api] klingCheckStatus raw response", {
    taskId,
    httpStatus: res.status,
    rawBody: text.slice(0, 400),
    topKeys: Object.keys(data),
    rawStatus: data.status ?? data.data?.status ?? "(none)",
    hasResults: Array.isArray(data.results),
    resultsLen: Array.isArray(data.results) ? data.results.length : 0,
    hasDataWorks: Array.isArray(data.data?.works),
  });

  // EvoLink: 최상위 status 또는 data.status 중 있는 것 사용
  const rawStatus = data.status ?? data.data?.status ?? "processing";

  // EvoLink statuses: pending / processing / completed / failed
  const status: KlingTaskStatus["status"] =
    rawStatus === "completed" ? "completed"
    : rawStatus === "failed"  ? "failed"
    : rawStatus === "pending" ? "pending"
    : "processing";

  // EvoLink 응답 포맷 다양성 대응:
  //   포맷1: { results: ["https://..."] }
  //   포맷2: { data: { works: [{ resource: { resource: "https://..." } }] } }
  const videoUrl =
    data.results?.[0] ??
    data.data?.works?.[0]?.resource?.resource ??
    undefined;

  console.log("[_kling-api] klingCheckStatus parsed", { rawStatus, videoUrl: videoUrl ? videoUrl.slice(0, 80) : null });

  const errMsg = typeof data.error === "string"
    ? data.error
    : data.error?.message;

  return {
    taskId,
    status,
    progress: data.progress,
    videoUrl,
    videoId: taskId,  // task_id를 다음 extend 참조로 사용
    error: status === "failed" ? (errMsg ?? "generation failed") : undefined,
  };
}

// ── Duration / Aspect ratio helpers ──────────────────────────────────────────

/**
 * 입력 초 → Kling 지원 초 매핑. EvoLink API: 3~15초 정수 지원.
 * 실제 요청 초수를 최대한 유지하되 3~15 범위로 클램핑.
 */
export function toKlingDuration(sec: number): number {
  return Math.min(15, Math.max(3, Math.round(sec)));
}

export function toKlingAspectRatio(ratio: string): "16:9" | "9:16" | "1:1" {
  return ratio === "9:16" ? "9:16" : ratio === "1:1" ? "1:1" : "16:9";
}

// ── Custom Element API ──────────────────────────────────────────────────────

export interface KlingCreateElementRequest {
  /** element 이름 (캐릭터 label) */
  element_name: string;
  /** element 설명 (캐릭터 외형 설명) */
  element_description?: string;
  /** reference_type: "image_refer" = 정지 이미지, "video_refer" = 영상 */
  reference_type: "image_refer" | "video_refer";
  /** 정면 얼굴 이미지 — image_refer 시 필수 (base64 또는 public URL) */
  frontal_image?: string;
  /** 영상 URL — video_refer 시 필수 (base64 또는 public URL) */
  video_url?: string;
}

export interface KlingElementStatus {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  elementId?: string;
  error?: string;
}

/**
 * 문서 스펙 기준 create element payload 조립.
 * 순수 함수 — HTTP 없이 테스트 가능.
 *
 * 문서 스펙 구조:
 *   model: "kling-custom-element"
 *   model_params:
 *     element_name
 *     element_description
 *     reference_type: "image_refer" | "video_refer"
 *     element_image_list: { frontal_image }   (image_refer 시)
 *     element_video_list: { video_url }       (video_refer 시)
 */
export function buildCreateElementPayload(
  req: KlingCreateElementRequest,
): Record<string, unknown> {
  // 사전 검증
  if (req.reference_type === "image_refer" && !req.frontal_image) {
    throw new Error("Kling createElement: image_refer requires frontal_image");
  }
  if (req.reference_type === "video_refer" && !req.video_url) {
    throw new Error("Kling createElement: video_refer requires video_url");
  }

  const modelParams: Record<string, unknown> = {
    element_name: req.element_name,
    reference_type: req.reference_type,
  };

  if (req.element_description) {
    modelParams.element_description = req.element_description;
  }

  if (req.reference_type === "image_refer") {
    modelParams.element_image_list = {
      frontal_image: req.frontal_image,
    };
  } else {
    modelParams.element_video_list = {
      video_url: req.video_url,
    };
  }

  return {
    model: KLING_ELEMENT_MODEL,
    model_params: modelParams,
  };
}

/** Kling Custom Element 모델명 (문서 스펙 기준) */
export const KLING_ELEMENT_MODEL = "kling-custom-element" as const;

/**
 * Kling Custom Element 생성 요청.
 * reusable subject asset를 생성 — 영상 생성과 별도의 비동기 task.
 *
 * payload는 문서 스펙 `model + model_params.*` 구조.
 */
export async function klingCreateElement(
  env: KlingEnv,
  req: KlingCreateElementRequest,
): Promise<{ taskId: string }> {
  const headers = klingHeaders(env);
  const body = buildCreateElementPayload(req);

  console.log("[_kling-api] klingCreateElement", {
    model: body.model,
    referenceType: req.reference_type,
    hasFrontalImage: !!req.frontal_image,
    hasVideoUrl: !!req.video_url,
  });

  const res = await fetch(`${klingBase(env)}/v1/elements`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kling createElement (${res.status}): ${text.slice(0, 400)}`);
  }

  let data: { id?: string; task_id?: string; error?: { message?: string } };
  try { data = JSON.parse(text); } catch { throw new Error(`Kling createElement non-JSON: ${text.slice(0, 200)}`); }

  if (data.error?.message) throw new Error(`Kling createElement failed: ${data.error.message}`);

  const taskId = data.id ?? data.task_id;
  if (!taskId) throw new Error("Kling createElement: no task id in response");

  return { taskId };
}

/**
 * Kling Custom Element task 상태 조회.
 * 완료 시 element_id 반환.
 *
 * 주의: 상태 조회 endpoint는 `GET /v1/elements/{taskId}`로 추정 구현.
 * 문서에서 완전 확정 근거가 부족하므로, 실환경에서 404 등 발생 시
 * endpoint 경로를 재검증해야 함.
 */
export async function klingCheckElement(
  env: KlingEnv,
  taskId: string,
): Promise<KlingElementStatus> {
  const headers = klingHeaders(env);

  const res = await fetch(`${klingBase(env)}/v1/elements/${taskId}`, {
    method: "GET",
    headers,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Kling checkElement (${res.status}): ${text.slice(0, 400)}`);

  let data: {
    id?: string;
    status?: string;
    element_id?: string;
    data?: { status?: string; element_id?: string };
    error?: { message?: string } | string;
  };
  try { data = JSON.parse(text); } catch { throw new Error(`Kling checkElement non-JSON: ${text.slice(0, 200)}`); }

  const rawStatus = data.status ?? data.data?.status ?? "processing";
  const status: KlingElementStatus["status"] =
    rawStatus === "completed" ? "completed"
    : rawStatus === "failed" ? "failed"
    : rawStatus === "pending" ? "pending"
    : "processing";

  const elementId = data.element_id ?? data.data?.element_id ?? undefined;
  const errMsg = typeof data.error === "string" ? data.error : data.error?.message;

  console.log("[_kling-api] klingCheckElement", { taskId, rawStatus, elementId: elementId ?? null });

  return {
    taskId,
    status,
    elementId,
    error: status === "failed" ? (errMsg ?? "element creation failed") : undefined,
  };
}
