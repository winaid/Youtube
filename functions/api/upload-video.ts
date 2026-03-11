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
  GCS_VIDEO_BUCKET?: string;     // GCS 버킷 이름 오버라이드 (설정하면 자동 생성된 이름 대신 사용)
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

interface UploadDiag {
  selectedProvider: "r2" | "gcs" | "none";
  bucketName: string | null;
  r2Available: boolean;
  gcsAvailable: boolean;
  uploadStartMs: number;
  uploadEndMs?: number;
  failureReason?: string;
  canonicalVideoUri?: string | null;
  sceneExtensionEligible: boolean;
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

/** GCS 버킷 이름 결정 */
function resolveGcsBucketName(env: UploadEnv): string | null {
  // 1순위: 명시적 환경변수
  if (env.GCS_VIDEO_BUCKET) return env.GCS_VIDEO_BUCKET;

  // 2순위: service account의 project_id 기반 자동 생성
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { project_id?: string };
      if (sa.project_id) return `veo-video-uploads-${sa.project_id}`;
    } catch { /* invalid JSON */ }
  }

  // 3순위: GOOGLE_CLOUD_PROJECT_ID
  if (env.GOOGLE_CLOUD_PROJECT_ID) {
    return `veo-video-uploads-${env.GOOGLE_CLOUD_PROJECT_ID}`;
  }

  return null;
}

/** GCS 버킷 자동 생성 시도 (없으면 만듦) */
async function ensureGcsBucket(env: UploadEnv, bucket: string): Promise<{ ok: boolean; error?: string }> {
  // 버킷 존재 확인 (HEAD)
  const checkUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}`;
  const checkRes = await fetchWithAuth(env, checkUrl, { method: "GET" });
  if (checkRes.ok) return { ok: true };

  if (checkRes.status !== 404) {
    const errText = await checkRes.text().catch(() => "");
    return { ok: false, error: `GCS bucket check failed (${checkRes.status}): ${errText.slice(0, 200)}` };
  }

  // 404 → 자동 생성 시도
  console.log(`[upload-video] GCS 버킷 '${bucket}' 미존재 → 자동 생성 시도`);
  let projectId: string | undefined;
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      projectId = (JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { project_id?: string }).project_id;
    } catch { /* skip */ }
  }
  if (!projectId) projectId = env.GOOGLE_CLOUD_PROJECT_ID;

  if (!projectId) {
    return { ok: false, error: "project_id를 알 수 없어 버킷 자동 생성 불가" };
  }

  const createUrl = `https://storage.googleapis.com/storage/v1/b?project=${projectId}`;
  const createRes = await fetchWithAuth(env, createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: bucket,
      location: "US",
      storageClass: "STANDARD",
      iamConfiguration: {
        uniformBucketLevelAccess: { enabled: true },
      },
    }),
  });

  if (createRes.ok) {
    console.log(`[upload-video] GCS 버킷 '${bucket}' 자동 생성 성공`);
    return { ok: true };
  }

  const errText = await createRes.text().catch(() => "");
  console.error(`[upload-video] GCS 버킷 자동 생성 실패 (${createRes.status}):`, errText.slice(0, 300));

  return {
    ok: false,
    error: `GCS 버킷 '${bucket}' 미존재 + 자동 생성 실패 (${createRes.status}). 수동 생성: gsutil mb gs://${bucket}`,
  };
}

export const onRequestPost: PagesFunction<UploadEnv> = async (context) => {
  const diag: UploadDiag = {
    selectedProvider: "none",
    bucketName: null,
    r2Available: !!context.env.VIDEO_BUCKET,
    gcsAvailable: !!context.env.GOOGLE_SERVICE_ACCOUNT_JSON,
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
    const session = req.sessionId || "default";
    const key = `videos/${session}/${cutLabel}/${timestamp}.${ext}`;

    console.log("[upload-video] 시작", {
      cutNumber: req.cutNumber,
      dataSize: req.base64Data.length,
      r2Available: diag.r2Available,
      gcsAvailable: diag.gcsAvailable,
      gcsBucket: resolveGcsBucketName(context.env),
    });

    // ── 1. R2 업로드 시도 ──────────────────────────────────────
    if (context.env.VIDEO_BUCKET) {
      diag.selectedProvider = "r2";
      diag.bucketName = "VIDEO_BUCKET (R2 binding)";
      try {
        const buffer = base64ToArrayBuffer(req.base64Data);

        await context.env.VIDEO_BUCKET.put(key, buffer, {
          httpMetadata: { contentType: mimeType },
        });

        diag.uploadEndMs = Date.now();

        // canonical URI 생성
        const domain = context.env.VIDEO_BUCKET_DOMAIN;
        const canonicalVideoUri = domain
          ? `https://${domain}/${key}`
          : undefined;

        // R2 key 기반 내부 재생 URL (domain 없어도 proxy-video로 서빙 가능)
        const proxyUri = `/api/proxy-video?r2key=${encodeURIComponent(key)}`;

        diag.canonicalVideoUri = canonicalVideoUri || null;
        diag.sceneExtensionEligible = !!canonicalVideoUri;

        console.log("[upload-video] R2 업로드 성공", {
          key,
          size: buffer.byteLength,
          canonicalVideoUri: canonicalVideoUri || "(no domain — proxy only)",
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
        // R2 실패 → GCS fallback
      }
    }

    // ── 2. GCS 업로드 시도 ──────────────────────────────────────
    if (context.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      diag.selectedProvider = "gcs";
      const bucket = resolveGcsBucketName(context.env);

      if (!bucket) {
        diag.failureReason = "GCS bucket name could not be resolved";
        return Response.json({
          error: "GCS 버킷 이름을 결정할 수 없습니다",
          guide: "GCS_VIDEO_BUCKET 환경변수를 설정하거나 GOOGLE_SERVICE_ACCOUNT_JSON에 project_id가 포함되어야 합니다",
          diag,
        }, { status: 500 });
      }

      diag.bucketName = bucket;

      try {
        // 버킷 존재 확인 + 자동 생성 시도
        const bucketCheck = await ensureGcsBucket(context.env, bucket);
        if (!bucketCheck.ok) {
          diag.failureReason = bucketCheck.error || "bucket ensure failed";
          console.error("[upload-video] GCS 버킷 확보 실패:", bucketCheck.error);

          return Response.json({
            error: bucketCheck.error,
            storage: "gcs",
            bucket,
            hint: `gsutil mb gs://${bucket}`,
            guide: {
              option1: `GCS Console에서 '${bucket}' 버킷 수동 생성`,
              option2: `GCS_VIDEO_BUCKET 환경변수로 기존 버킷 이름 지정`,
              option3: `Cloudflare R2: VIDEO_BUCKET 바인딩으로 전환 (GCS 불필요)`,
              impact: "버킷 없이는 canonicalVideoUri 생성 불가 → Scene Extension 비활성화",
            },
            diag,
          }, { status: 424 }); // 424 Failed Dependency (외부 리소스 부재)
        }

        const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(key)}`;
        const buffer = base64ToArrayBuffer(req.base64Data);

        console.log("[upload-video] GCS 업로드 시작", { bucket, key, size: buffer.byteLength });

        const res = await fetchWithAuth(context.env, uploadUrl, {
          method: "POST",
          headers: { "Content-Type": mimeType },
          body: buffer,
        });

        diag.uploadEndMs = Date.now();

        if (res.ok) {
          const canonicalVideoUri = `gs://${bucket}/${key}`;
          diag.canonicalVideoUri = canonicalVideoUri;
          diag.sceneExtensionEligible = true;

          console.log("[upload-video] GCS 업로드 성공", {
            canonicalVideoUri,
            size: buffer.byteLength,
            cutNumber: req.cutNumber,
            durationMs: diag.uploadEndMs - diag.uploadStartMs,
          });

          return Response.json({
            success: true,
            storage: "gcs",
            key,
            canonicalVideoUri,
            size: buffer.byteLength,
            diag,
          });
        }

        const errText = await res.text();
        diag.failureReason = `GCS upload HTTP ${res.status}: ${errText.slice(0, 200)}`;
        console.error("[upload-video] GCS 업로드 실패:", res.status, errText.slice(0, 300));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        diag.failureReason = `GCS upload error: ${msg}`;
        console.error("[upload-video] GCS 업로드 오류:", msg);
      }
    }

    // ── 3. 업로드 불가 — 가이드 반환 ──────────────────────────
    diag.uploadEndMs = Date.now();
    if (!diag.failureReason) {
      diag.failureReason = "No storage provider available (R2 not bound, GCS not configured)";
    }

    console.warn("[upload-video] 업로드 불가", diag);

    return Response.json({
      error: "영상 업로드 스토리지가 설정되지 않았습니다",
      guide: {
        option1: "Cloudflare R2: VIDEO_BUCKET 바인딩 + VIDEO_BUCKET_DOMAIN 환경변수 설정",
        option2: "GCS: GOOGLE_SERVICE_ACCOUNT_JSON 환경변수 설정 (storage.objects.create 권한 필요)",
        option3: "GCS_VIDEO_BUCKET 환경변수로 기존 버킷 이름 직접 지정",
        impact: "스토리지 없이는 Scene Extension(영상 연결)이 불가하여 각 컷이 독립 생성됩니다",
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
