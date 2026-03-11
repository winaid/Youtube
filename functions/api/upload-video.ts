/**
 * upload-video.ts — base64 영상을 R2/GCS에 업로드하여 canonical URI 발급.
 *
 * 목적: Veo가 base64로만 응답할 때, 영상을 클라우드 스토리지에 업로드하여
 * Scene Extension에 사용 가능한 stable URI(gs:// 또는 https://)를 생성.
 *
 * 우선순위:
 * 1. R2 (VIDEO_BUCKET 바인딩 있으면) → https:// public URL
 * 2. GCS (GOOGLE_SERVICE_ACCOUNT_JSON 있으면) → gs:// URI
 * 3. 불가 → 에러 반환 + 가이드 메시지
 */

import { GeminiEnv, fetchWithAuth } from "./_gemini-keys";

interface UploadEnv extends GeminiEnv {
  VIDEO_BUCKET?: R2Bucket;
  VIDEO_BUCKET_DOMAIN?: string;  // R2 커스텀 도메인 (예: videos.example.com)
}

interface UploadRequest {
  /** base64 인코딩된 영상 데이터 (data URI prefix 없이) */
  base64Data: string;
  /** MIME 타입 */
  mimeType?: string;
  /** 컷 번호 (파일 이름용) */
  cutNumber?: number;
  /** 고유 식별자 */
  sessionId?: string;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // data URI prefix 제거
  const raw = base64.replace(/^data:[^;]+;base64,/, "");
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export const onRequestPost: PagesFunction<UploadEnv> = async (context) => {
  try {
    const req = await context.request.json() as UploadRequest;

    if (!req.base64Data || req.base64Data.length < 1000) {
      return Response.json(
        { error: "base64Data is required and must be a valid video" },
        { status: 400 },
      );
    }

    const mimeType = req.mimeType || "video/mp4";
    const ext = mimeType.includes("webm") ? "webm" : "mp4";
    const timestamp = Date.now();
    const cutLabel = req.cutNumber ? `cut-${req.cutNumber}` : "unknown";
    const session = req.sessionId || "default";
    const key = `videos/${session}/${cutLabel}/${timestamp}.${ext}`;

    // ── 1. R2 업로드 시도 ──────────────────────────────────────
    if (context.env.VIDEO_BUCKET) {
      try {
        const buffer = base64ToArrayBuffer(req.base64Data);

        await context.env.VIDEO_BUCKET.put(key, buffer, {
          httpMetadata: { contentType: mimeType },
        });

        // canonical URI 생성
        const domain = context.env.VIDEO_BUCKET_DOMAIN;
        const canonicalVideoUri = domain
          ? `https://${domain}/${key}`
          : undefined;

        // R2 key 기반 내부 재생 URL (domain 없어도 proxy-video로 서빙 가능)
        const proxyUri = `/api/proxy-video?r2key=${encodeURIComponent(key)}`;

        console.log("[upload-video] R2 업로드 성공", {
          key,
          size: buffer.byteLength,
          canonicalVideoUri: canonicalVideoUri || "(no domain)",
          cutNumber: req.cutNumber,
        });

        return Response.json({
          success: true,
          storage: "r2",
          key,
          canonicalVideoUri,
          proxyUri,
          size: buffer.byteLength,
        });
      } catch (err) {
        console.error("[upload-video] R2 업로드 실패:", err instanceof Error ? err.message : err);
        // R2 실패 → GCS fallback
      }
    }

    // ── 2. GCS 업로드 시도 ──────────────────────────────────────
    if (context.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        let sa: { project_id: string };
        try {
          sa = JSON.parse(context.env.GOOGLE_SERVICE_ACCOUNT_JSON) as { project_id: string };
        } catch {
          return Response.json(
            { error: "GOOGLE_SERVICE_ACCOUNT_JSON이 유효한 JSON이 아닙니다" },
            { status: 500 },
          );
        }

        const bucket = `veo-video-uploads-${sa.project_id}`;
        const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(key)}`;

        const buffer = base64ToArrayBuffer(req.base64Data);

        const res = await fetchWithAuth(context.env, uploadUrl, {
          method: "POST",
          headers: { "Content-Type": mimeType },
          body: buffer,
        });

        if (res.ok) {
          const canonicalVideoUri = `gs://${bucket}/${key}`;

          console.log("[upload-video] GCS 업로드 성공", {
            canonicalVideoUri,
            size: buffer.byteLength,
            cutNumber: req.cutNumber,
          });

          return Response.json({
            success: true,
            storage: "gcs",
            key,
            canonicalVideoUri,
            size: buffer.byteLength,
          });
        }

        const errText = await res.text();
        console.error("[upload-video] GCS 업로드 실패:", res.status, errText.slice(0, 300));

        // GCS 버킷이 없을 수 있음 — 안내 메시지
        if (res.status === 404) {
          return Response.json({
            error: `GCS 버킷 '${bucket}'이 존재하지 않습니다. Google Cloud Console에서 버킷을 생성하세요.`,
            hint: `gsutil mb gs://${bucket}`,
            storage: "gcs",
          }, { status: 404 });
        }
      } catch (err) {
        console.error("[upload-video] GCS 업로드 오류:", err instanceof Error ? err.message : err);
      }
    }

    // ── 3. 업로드 불가 — 가이드 반환 ──────────────────────────
    return Response.json({
      error: "영상 업로드 스토리지가 설정되지 않았습니다",
      guide: {
        option1: "Cloudflare R2: VIDEO_BUCKET 바인딩 + VIDEO_BUCKET_DOMAIN 환경변수 설정",
        option2: "GCS: GOOGLE_SERVICE_ACCOUNT_JSON 환경변수 설정 (storage.objects.create 권한 필요)",
        impact: "스토리지 없이는 Scene Extension(영상 연결)이 불가하여 각 컷이 독립 생성됩니다",
      },
    }, { status: 501 });
  } catch (error) {
    console.error("[upload-video] 처리 오류:", error);
    return Response.json(
      { error: `Upload failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
};
