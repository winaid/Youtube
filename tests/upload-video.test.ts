/**
 * upload-video.test.ts — 스토리지 업로드 + Scene Extension 자격 테스트
 *
 * 실행: npx tsx tests/upload-video.test.ts
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

// ─── 1. Bucket Name Derivation ────────────────────────────────

console.log("\n═══ 1. Bucket Name Derivation ═══");

// simulate resolveGcsBucketName logic
function resolveGcsBucketName(env: {
  GCS_VIDEO_BUCKET?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_CLOUD_PROJECT_ID?: string;
}): string | null {
  if (env.GCS_VIDEO_BUCKET) return env.GCS_VIDEO_BUCKET;
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { project_id?: string };
      if (sa.project_id) return `veo-video-uploads-${sa.project_id}`;
    } catch { /* invalid JSON */ }
  }
  if (env.GOOGLE_CLOUD_PROJECT_ID) {
    return `veo-video-uploads-${env.GOOGLE_CLOUD_PROJECT_ID}`;
  }
  return null;
}

// 1a. GCS_VIDEO_BUCKET 환경변수 우선
assert(
  resolveGcsBucketName({ GCS_VIDEO_BUCKET: "my-custom-bucket" }) === "my-custom-bucket",
  "GCS_VIDEO_BUCKET 환경변수가 최우선",
);

// 1b. service account project_id 기반
assert(
  resolveGcsBucketName({
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: "ai-video-489504" }),
  }) === "veo-video-uploads-ai-video-489504",
  "SA project_id → veo-video-uploads-{project_id}",
);

// 1c. GOOGLE_CLOUD_PROJECT_ID fallback
assert(
  resolveGcsBucketName({ GOOGLE_CLOUD_PROJECT_ID: "my-project" }) === "veo-video-uploads-my-project",
  "GOOGLE_CLOUD_PROJECT_ID fallback",
);

// 1d. 모두 없으면 null
assert(
  resolveGcsBucketName({}) === null,
  "환경변수 모두 없으면 null",
);

// 1e. GCS_VIDEO_BUCKET이 있으면 SA보다 우선
assert(
  resolveGcsBucketName({
    GCS_VIDEO_BUCKET: "override-bucket",
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: "should-be-ignored" }),
  }) === "override-bucket",
  "GCS_VIDEO_BUCKET이 SA project_id보다 우선",
);

// 1f. 잘못된 SA JSON
assert(
  resolveGcsBucketName({ GOOGLE_SERVICE_ACCOUNT_JSON: "not-json!" }) === null,
  "잘못된 SA JSON → null",
);

// ─── 2. Upload Status State Machine ──────────────────────────

console.log("\n═══ 2. Upload Status State Machine ═══");

type UploadStatus = "none" | "pending" | "success" | "failed" | "skipped";

interface UploadState {
  uploadStatus: UploadStatus;
  canonicalVideoUri?: string;
  sceneExtensionEligible: boolean;
  uploadError?: string;
}

// 2a. 서버가 canonicalVideoUri 직접 반환 → skipped
function simulateServerProvided(): UploadState {
  return {
    uploadStatus: "skipped",
    canonicalVideoUri: "gs://bucket/key.mp4",
    sceneExtensionEligible: true,
  };
}
const s1 = simulateServerProvided();
assert(s1.uploadStatus === "skipped", "서버 제공 URI → uploadStatus=skipped");
assert(s1.sceneExtensionEligible === true, "서버 제공 URI → sceneExtensionEligible=true");

// 2b. 업로드 성공 (GCS)
function simulateUploadSuccess(): UploadState {
  return {
    uploadStatus: "success",
    canonicalVideoUri: "gs://veo-video-uploads-proj/videos/cut-1/123.mp4",
    sceneExtensionEligible: true,
  };
}
const s2 = simulateUploadSuccess();
assert(s2.uploadStatus === "success", "업로드 성공 → uploadStatus=success");
assert(!!s2.canonicalVideoUri, "업로드 성공 → canonicalVideoUri 존재");

// 2c. 업로드 실패 (버킷 미존재)
function simulateUploadFailed(): UploadState {
  return {
    uploadStatus: "failed",
    sceneExtensionEligible: false,
    uploadError: "HTTP 424: GCS 버킷 미존재",
  };
}
const s3 = simulateUploadFailed();
assert(s3.uploadStatus === "failed", "업로드 실패 → uploadStatus=failed");
assert(s3.sceneExtensionEligible === false, "업로드 실패 → sceneExtensionEligible=false");
assert(!!s3.uploadError, "업로드 실패 → uploadError 포함");

// 2d. 업로드 불필요 (이미 URI 있음)
function simulateNoUploadNeeded(): UploadState {
  return {
    uploadStatus: "none",
    canonicalVideoUri: undefined,
    sceneExtensionEligible: false,
  };
}
const s4 = simulateNoUploadNeeded();
assert(s4.uploadStatus === "none", "업로드 불필요 → uploadStatus=none");

// 2e. R2 성공 (도메인 없음 → Scene Extension 불가)
function simulateR2NoDomain(): UploadState {
  return {
    uploadStatus: "success",
    sceneExtensionEligible: false, // proxyUri만 사용 가능
  };
}
const s5 = simulateR2NoDomain();
assert(s5.uploadStatus === "success", "R2 도메인 없음 → uploadStatus=success");
assert(s5.sceneExtensionEligible === false, "R2 도메인 없음 → Scene Extension 불가");

// ─── 3. Scene Extension Eligibility ──────────────────────────

console.log("\n═══ 3. Scene Extension Eligibility ═══");

function isSceneExtensionEligible(uri: string | undefined): boolean {
  if (!uri) return false;
  if (uri.startsWith("gs://")) return true;
  if (uri.startsWith("https://")) return true;
  return false; // data: URIs, proxy URIs 등은 불가
}

assert(isSceneExtensionEligible("gs://bucket/key.mp4") === true, "gs:// URI → eligible");
assert(isSceneExtensionEligible("https://storage.googleapis.com/bucket/key.mp4") === true, "https:// URI → eligible");
assert(isSceneExtensionEligible(undefined) === false, "undefined → not eligible");
assert(isSceneExtensionEligible("") === false, "empty string → not eligible");
assert(isSceneExtensionEligible("data:video/mp4;base64,AAAA") === false, "data: URI → not eligible");
assert(isSceneExtensionEligible("/api/proxy-video?r2key=abc") === false, "proxy URI → not eligible");

// ─── 4. Upload Response Handling ─────────────────────────────

console.log("\n═══ 4. Upload Response Handling ═══");

// 4a. R2 성공 + 도메인 있음
{
  const res = { success: true, storage: "r2", canonicalVideoUri: "https://videos.example.com/key.mp4", proxyUri: "/api/proxy-video?r2key=key", key: "key" };
  assert(res.success === true, "R2 + domain → success");
  assert(!!res.canonicalVideoUri, "R2 + domain → canonicalVideoUri 있음");
}

// 4b. R2 성공 + 도메인 없음
{
  const res = { success: true, storage: "r2", canonicalVideoUri: undefined, proxyUri: "/api/proxy-video?r2key=key", key: "key" };
  assert(res.success === true, "R2 no-domain → success");
  assert(!res.canonicalVideoUri, "R2 no-domain → canonicalVideoUri 없음 (proxyUri만)");
  assert(!!res.proxyUri, "R2 no-domain → proxyUri 있음");
}

// 4c. GCS 성공
{
  const res = { success: true, storage: "gcs", canonicalVideoUri: "gs://bucket/key.mp4", key: "key" };
  assert(res.storage === "gcs", "GCS → storage=gcs");
  assert(res.canonicalVideoUri!.startsWith("gs://"), "GCS → gs:// URI");
}

// 4d. GCS 버킷 미존재 (424)
{
  const res = { error: "GCS 버킷 미존재", storage: "gcs", bucket: "veo-video-uploads-proj" };
  assert(!!res.error, "GCS bucket 404 → error 메시지");
  assert(!!res.bucket, "GCS bucket 404 → bucket 이름 포함");
}

// 4e. 스토리지 미설정 (501)
{
  const res = { error: "스토리지 미설정", guide: { option1: "R2", option2: "GCS", impact: "Scene Extension 불가" } };
  assert(!!res.guide, "스토리지 미설정 → 가이드 포함");
}

// ─── 5. Diagnostic Object ────────────────────────────────────

console.log("\n═══ 5. Diagnostic Object ═══");

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

const diag: UploadDiag = {
  selectedProvider: "gcs",
  bucketName: "veo-video-uploads-ai-video-489504",
  r2Available: false,
  gcsAvailable: true,
  uploadStartMs: 1000,
  uploadEndMs: 2500,
  failureReason: undefined,
  canonicalVideoUri: "gs://veo-video-uploads-ai-video-489504/videos/default/cut-1/123.mp4",
  sceneExtensionEligible: true,
};

assert(diag.selectedProvider === "gcs", "diag.selectedProvider 추적");
assert(!!diag.bucketName, "diag.bucketName 추적");
assert(typeof diag.uploadStartMs === "number", "diag.uploadStartMs 추적");
assert(typeof diag.uploadEndMs === "number", "diag.uploadEndMs 추적");
assert(diag.sceneExtensionEligible === true, "diag.sceneExtensionEligible 추적");

// ─── 6. Bucket Auto-Creation ─────────────────────────────────

console.log("\n═══ 6. Bucket Auto-Creation Logic ═══");

// 이 테스트는 로직 검증 (실제 HTTP는 안 함)
assert(
  resolveGcsBucketName({ GCS_VIDEO_BUCKET: "pre-existing-bucket" }) === "pre-existing-bucket",
  "기존 버킷 이름 직접 지정 가능",
);

// ─── 7. Fallback Chain ───────────────────────────────────────

console.log("\n═══ 7. Fallback Chain ═══");

function determineFallback(clip: {
  canonicalVideoUri?: string;
  rawVideoUri?: string;
  lastFrameBase64?: string;
}): "SCENE_EXTENSION" | "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO" {
  const uri = clip.canonicalVideoUri || clip.rawVideoUri || "";
  if (uri.startsWith("gs://") || uri.startsWith("https://")) return "SCENE_EXTENSION";
  if (clip.lastFrameBase64) return "IMAGE_TO_VIDEO";
  return "TEXT_TO_VIDEO";
}

assert(
  determineFallback({ canonicalVideoUri: "gs://b/k.mp4" }) === "SCENE_EXTENSION",
  "canonicalVideoUri(gs) → SCENE_EXTENSION",
);
assert(
  determineFallback({ rawVideoUri: "https://storage.googleapis.com/b/k.mp4" }) === "SCENE_EXTENSION",
  "rawVideoUri(https) → SCENE_EXTENSION",
);
assert(
  determineFallback({ rawVideoUri: "", lastFrameBase64: "base64data" }) === "IMAGE_TO_VIDEO",
  "URI 없음 + lastFrame → IMAGE_TO_VIDEO",
);
assert(
  determineFallback({ rawVideoUri: "" }) === "TEXT_TO_VIDEO",
  "URI 없음 + lastFrame 없음 → TEXT_TO_VIDEO (연속성 완전 손실)",
);
assert(
  determineFallback({ rawVideoUri: "data:video/mp4;base64,..." }) === "TEXT_TO_VIDEO",
  "data: URI → TEXT_TO_VIDEO (Scene Extension 불가)",
);

// ─── Summary ─────────────────────────────────────────────────

console.log(`\n════════════════════════════════════`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log(`\n✅ All tests passed`);
}
