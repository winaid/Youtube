/**
 * _kling-api.ts — Kling AI Video API helper
 *
 * Auth: JWT HS256 signed with KLING_API_KEY + KLING_API_SECRET
 * Base: https://api.klingai.com
 *
 * Endpoints:
 *   POST /v1/videos/text2video          — text-to-video generate
 *   POST /v1/videos/image2video         — image-to-video generate
 *   POST /v1/videos/video-extend        — extend an existing video
 *   GET  /v1/videos/text2video/:task_id — check generate status
 *   GET  /v1/videos/video-extend/:task_id — check extend status
 */

export interface KlingEnv {
  KLING_API_KEY?: string;
  KLING_API_SECRET?: string;
}

const KLING_BASE = "https://api.klingai.com";

// ── JWT HS256 builder ────────────────────────────────────────────────────────

function b64url(data: ArrayBuffer | string): string {
  let str: string;
  if (typeof data === "string") {
    str = data;
  } else {
    const bytes = new Uint8Array(data);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    str = s;
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function buildKlingJWT(apiKey: string, apiSecret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: "HS256", typ: "JWT" };
  const payload = { iss: apiKey, exp: now + 1800, nbf: now - 5 };

  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sigInput = `${h}.${p}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sigInput));
  return `${sigInput}.${b64url(sig)}`;
}

async function klingHeaders(env: KlingEnv): Promise<Record<string, string>> {
  const key    = env.KLING_API_KEY    ?? "";
  const secret = env.KLING_API_SECRET ?? "";
  if (!key || !secret) throw new Error("KLING_API_KEY / KLING_API_SECRET not configured");
  const token = await buildKlingJWT(key, secret);
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

// ── Request / Response types ─────────────────────────────────────────────────

export interface KlingGenerateRequest {
  prompt: string;
  negative_prompt?: string;
  model_name?: "kling-v1" | "kling-v1-5" | "kling-v2";
  mode?: "std" | "pro";
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  duration?: "5" | "10";
  cfg_scale?: number;
  // image-to-video fields (optional)
  image?: string;       // base64 or public URL for start frame
  image_tail?: string;  // base64 or public URL for end frame
}

export interface KlingExtendRequest {
  video_id: string;     // task_id of the source video
  prompt?: string;
  negative_prompt?: string;
  cfg_scale?: number;
}

export interface KlingTaskStatus {
  taskId: string;
  status: "submitted" | "processing" | "succeed" | "failed";
  videoUrl?: string;    // final video URL (when succeed)
  videoId?: string;     // Kling video id (use as next extend source)
  duration?: string;
  error?: string;
}

// ── Generate ─────────────────────────────────────────────────────────────────

export async function klingGenerate(
  env: KlingEnv,
  req: KlingGenerateRequest,
): Promise<{ taskId: string }> {
  const headers = await klingHeaders(env);
  const endpoint = req.image ? "/v1/videos/image2video" : "/v1/videos/text2video";

  const res = await fetch(`${KLING_BASE}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(req),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kling generate error (${res.status}): ${text.slice(0, 400)}`);
  }

  let data: { code?: number; message?: string; data?: { task_id?: string } };
  try { data = JSON.parse(text); } catch { throw new Error(`Kling generate non-JSON: ${text.slice(0, 200)}`); }

  if (data.code !== 0) throw new Error(`Kling generate failed: ${data.message ?? "unknown"}`);
  const taskId = data.data?.task_id;
  if (!taskId) throw new Error("Kling generate: no task_id in response");
  return { taskId };
}

// ── Extend ───────────────────────────────────────────────────────────────────

export async function klingExtend(
  env: KlingEnv,
  req: KlingExtendRequest,
): Promise<{ taskId: string }> {
  const headers = await klingHeaders(env);

  const res = await fetch(`${KLING_BASE}/v1/videos/video-extend`, {
    method: "POST",
    headers,
    body: JSON.stringify(req),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kling extend error (${res.status}): ${text.slice(0, 400)}`);
  }

  let data: { code?: number; message?: string; data?: { task_id?: string } };
  try { data = JSON.parse(text); } catch { throw new Error(`Kling extend non-JSON: ${text.slice(0, 200)}`); }

  if (data.code !== 0) throw new Error(`Kling extend failed: ${data.message ?? "unknown"}`);
  const taskId = data.data?.task_id;
  if (!taskId) throw new Error("Kling extend: no task_id in response");
  return { taskId };
}

// ── Check Status ─────────────────────────────────────────────────────────────

export async function klingCheckStatus(
  env: KlingEnv,
  taskId: string,
  isExtend: boolean,
): Promise<KlingTaskStatus> {
  const headers = await klingHeaders(env);
  const path = isExtend
    ? `/v1/videos/video-extend/${taskId}`
    : `/v1/videos/text2video/${taskId}`;

  const res = await fetch(`${KLING_BASE}${path}`, { method: "GET", headers });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kling check error (${res.status}): ${text.slice(0, 400)}`);
  }

  let data: {
    code?: number;
    message?: string;
    data?: {
      task_id?: string;
      task_status?: string;
      task_status_msg?: string;
      task_result?: { videos?: Array<{ id?: string; url?: string; duration?: string }> };
    };
  };
  try { data = JSON.parse(text); } catch { throw new Error(`Kling check non-JSON: ${text.slice(0, 200)}`); }

  if (data.code !== 0) {
    return { taskId, status: "failed", error: data.message ?? "unknown" };
  }

  const d = data.data;
  if (!d) return { taskId, status: "failed", error: "no data in response" };

  const rawStatus = d.task_status ?? "processing";
  const status: KlingTaskStatus["status"] =
    rawStatus === "succeed"    ? "succeed"
    : rawStatus === "failed"   ? "failed"
    : rawStatus === "submitted" ? "submitted"
    : "processing";

  const videos = d.task_result?.videos;
  const firstVideo = videos?.[0];

  return {
    taskId,
    status,
    videoUrl: firstVideo?.url,
    videoId:  firstVideo?.id ?? taskId,
    duration: firstVideo?.duration,
    error:    status === "failed" ? (d.task_status_msg ?? "generation failed") : undefined,
  };
}

// ── Duration map ─────────────────────────────────────────────────────────────
// Veo supports 4/6/8s; Kling supports "5"/"10" — nearest mapping:
export function toKlingDuration(veoSec: number): "5" | "10" {
  return veoSec <= 6 ? "5" : "10";
}

// Aspect ratio passthrough (both use "16:9" / "9:16")
export function toKlingAspectRatio(ratio: string): "16:9" | "9:16" | "1:1" {
  return ratio === "9:16" ? "9:16" : ratio === "1:1" ? "1:1" : "16:9";
}
