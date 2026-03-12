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
 *   kling-v3-text-to-video      — 텍스트→영상 (기본)
 *   kling-v3-image-to-video     — 이미지→영상 (first/last frame)
 *   kling-o3-text-to-video      — 최신 텍스트→영상 (사운드 지원)
 *   kling-o3-image-to-video     — 최신 이미지→영상
 */

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

export interface KlingGenerateRequest {
  prompt: string;
  negative_prompt?: string;
  /** default: "kling-o3-text-to-video" or "kling-o3-image-to-video" if image supplied */
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
): Promise<{ taskId: string }> {
  const headers = klingHeaders(env);
  // kling-o3-*: 사운드 지원 최신 모델 / kling-v3-*: 사운드 없음
  const model = req.model ?? (req.image ? "kling-o3-image-to-video" : "kling-o3-text-to-video");

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
  // Multi-shot: 1장면 안에 여러 카메라 구도/앵글 지정
  if (req.multiShot && req.multiShot.length > 0) {
    body.model_params = {
      multi_shot: true,
      shot_type: "customize",
      multi_prompt: req.multiShot.map((s) => ({
        index: s.index,
        prompt: s.prompt,
        duration: String(s.duration),
      })),
    };
  }

  const res = await fetch(`${klingBase(env)}/v1/videos/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const httpStatus = res.status;
    const err = new Error(`Kling generate (${httpStatus}): ${text.slice(0, 400)}`);
    (err as Error & { httpStatus: number }).httpStatus = httpStatus;
    throw err;
  }

  let data: { id?: string; task_id?: string; error?: { message?: string } };
  try { data = JSON.parse(text); } catch { throw new Error(`Kling generate non-JSON: ${text.slice(0, 200)}`); }

  if (data.error?.message) throw new Error(`Kling generate failed: ${data.error.message}`);

  const taskId = data.id ?? data.task_id;
  if (!taskId) throw new Error("Kling generate: no task id in response");
  return { taskId };
}

// ── Extend (last-frame image-to-video) ──────────────────────────────────────

export async function klingExtend(
  env: KlingEnv,
  req: KlingExtendRequest,
): Promise<{ taskId: string }> {
  // 빈 문자열·공백만 있는 경우도 차단 (data:image/png;base64, 만 있으면 strip 후 "" or " ")
  if (!req.lastFrameBase64 || req.lastFrameBase64.trim().length < 100) {
    throw new Error(
      `Kling extend: lastFrameBase64 is missing or too short after stripping (len=${req.lastFrameBase64?.length ?? 0}). ` +
      "Ensure the base64 data (not data-URI prefix) is at least 100 chars.",
    );
  }

  return klingGenerate(env, {
    model:           "kling-o3-image-to-video", // o3: 사운드 지원
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
 * 입력 초 → Kling o3 지원 초 매핑. EvoLink o3 API: 3~15초 정수 지원.
 * 실제 요청 초수를 최대한 유지하되 3~15 범위로 클램핑.
 */
export function toKlingDuration(sec: number): number {
  return Math.min(15, Math.max(3, Math.round(sec)));
}

export function toKlingAspectRatio(ratio: string): "16:9" | "9:16" | "1:1" {
  return ratio === "9:16" ? "9:16" : ratio === "1:1" ? "1:1" : "16:9";
}
