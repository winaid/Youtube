/**
 * upload-video.ts — base64 영상을 R2에 업로드하여 canonical URI 발급.
 *
 * VEO는 Google Storage URI를 반환하므로 R2 업로드 필요.
 * R2에 업로드하여 공개 HTTPS URL 발급.
 *
 * R2 전용 업로드 (GCS 경로 없음).
 */

interface UploadEnv {
  VIDEO_BUCKET?: R2Bucket;
  VIDEO_BUCKET_DOMAIN?: string;  // R2 커스텀 도메인 (예: videos.example.com)
}

interface UploadRequest {
  /** base64 인코딩된 영상 데이터 (data URI prefix 없이) */
  base64Data: string;
  /** MIME 타입 */
  mimeType?: string;
  /** 컷 번호 */
  cutNumber?: number;
  /** 세션 ID (R2 키 prefix) */
  sessionId?: string;
}

interface UploadDiag {
  selectedProvider: string;
  bucketName: string | null;
  r2Available: boolean;
  uploadStartMs: number;
  uploadEndMs?: number;
  canonicalVideoUri?: string;
  sceneExtensionEligible: boolean;
  failureReason?: string;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const stripped = base64.replace(/^data:[^;]+;base64,/, "");
  const binary = atob(stripped);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export const onRequestPost: PagesFunction<UploadEnv> = async (context) => {
  const diag: UploadDiag = {
    selectedProvider: "none",
    bucketName: null,
    r2Available: !!context.env.VIDEO_BUCKET,
    uploadStartMs: Date.now(),
    sceneExtensionEligible: false,
  };

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
    const rawSession = req.sessionId || "default";
    const session = rawSession.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!session) {
      return Response.json(
        { error: "Invalid sessionId: must contain alphanumeric characters, hyphens, or underscores" },
        { status: 400 },
      );
    }
    const key = `videos/${session}/${cutLabel}/${timestamp}.${ext}`;

    console.log("[upload-video] 시작", {
      cutNumber: req.cutNumber,
      dataSize: req.base64Data.length,
      r2Available: diag.r2Available,
    });

    // ── R2 업로드 ──────────────────────────────────────
    if (context.env.VIDEO_BUCKET) {
      diag.selectedProvider = "r2";
      diag.bucketName = "VIDEO_BUCKET (R2 binding)";
      try {
        const buffer = base64ToArrayBuffer(req.base64Data);

        await context.env.VIDEO_BUCKET.put(key, buffer, {
          httpMetadata: { contentType: mimeType },
        });

        diag.uploadEndMs = Date.now();

        const domain = context.env.VIDEO_BUCKET_DOMAIN;
        const requestOrigin = new URL(context.request.url).origin;
        const proxyUri = `/api/proxy-video?r2key=${encodeURIComponent(key)}`;
        const absoluteProxyUri = `${requestOrigin}/api/proxy-video?r2key=${encodeURIComponent(key)}`;

        const canonicalVideoUri = domain
          ? `https://${domain}/${key}`
          : absoluteProxyUri;

        diag.canonicalVideoUri = canonicalVideoUri;
        diag.sceneExtensionEligible = true;

        console.log("[upload-video] R2 업로드 성공", {
          key,
          size: buffer.byteLength,
          canonicalVideoUri,
          cutNumber: req.cutNumber,
          durationMs: diag.uploadEndMs - diag.uploadStartMs,
        });

        return Response.json({
          success: true,
          storage: "r2",
          key,
          canonicalVideoUri,
          proxyUri,
          size: buffer.byteLength,
          diag,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        diag.failureReason = `R2 upload failed: ${msg}`;
        console.error("[upload-video] R2 업로드 실패:", msg);
      }
    }

    // ── 업로드 불가 ──────────────────────────────────────
    diag.uploadEndMs = Date.now();
    if (!diag.failureReason) {
      diag.failureReason = "No storage provider available (VIDEO_BUCKET R2 not bound)";
    }

    console.warn("[upload-video] 업로드 불가", diag);

    return Response.json({
      error: "영상 업로드 스토리지가 설정되지 않았습니다",
      guide: {
        option1: "Cloudflare R2: VIDEO_BUCKET 바인딩 + VIDEO_BUCKET_DOMAIN 환경변수 설정",
        note: "VEO는 Google Storage URI를 반환하므로 R2 업로드 필요",
      },
      diag,
    }, { status: 501 });
  } catch (error) {
    diag.uploadEndMs = Date.now();
    diag.failureReason = `Unhandled: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[upload-video] 처리 오류:", error);
    return Response.json(
      { error: `Upload failed: ${error instanceof Error ? error.message : String(error)}`, diag },
      { status: 500 },
    );
  }
};
