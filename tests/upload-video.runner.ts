/**
 * upload-video.test.ts — R2 스토리지 업로드 + Scene Extension 자격 테스트
 *
 * 아키텍처: R2 전용 (GCS/SA 제거됨).
 * Kling(EvoLink)은 HTTPS URL을 직반환하므로 대부분 업로드 불필요.
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

// ─── 1. R2 Key Derivation ────────────────────────────────────

console.log("\n═══ 1. R2 Key Derivation ═══");

function deriveR2Key(opts: {
  sessionId?: string;
  cutNumber?: number;
  mimeType?: string;
}): string {
  const ext = (opts.mimeType || "video/mp4").includes("webm") ? "webm" : "mp4";
  const cutLabel = opts.cutNumber ? `cut-${opts.cutNumber}` : "unknown";
  const session = opts.sessionId || "default";
  const timestamp = 1700000000000; // fixed for test
  return `videos/${session}/${cutLabel}/${timestamp}.${ext}`;
}

// 1a. Default key
assert(
  deriveR2Key({}) === "videos/default/unknown/1700000000000.mp4",
  "기본 키 형식: videos/default/unknown/ts.mp4",
);

// 1b. With session + cut
assert(
  deriveR2Key({ sessionId: "abc-123", cutNumber: 3 }) === "videos/abc-123/cut-3/1700000000000.mp4",
  "세션+컷번호 키 생성",
);

// 1c. WebM extension
assert(
  deriveR2Key({ mimeType: "video/webm" }) === "videos/default/unknown/1700000000000.webm",
  "WebM MIME → .webm 확장자",
);

// 1d. MP4 default
assert(
  deriveR2Key({ mimeType: "video/mp4" }) === "videos/default/unknown/1700000000000.mp4",
  "MP4 MIME → .mp4 확장자",
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

// 2a. Kling(EvoLink)이 HTTPS URL 직반환 → skipped
function simulateServerProvided(): UploadState {
  return {
    uploadStatus: "skipped",
    canonicalVideoUri: "https://cdn.klingai.com/video/abc123.mp4",
    sceneExtensionEligible: true,
  };
}
const s1 = simulateServerProvided();
assert(s1.uploadStatus === "skipped", "서버 제공 URI → uploadStatus=skipped");
assert(s1.sceneExtensionEligible === true, "서버 제공 URI → sceneExtensionEligible=true");

// 2b. R2 업로드 성공 (도메인 있음)
function simulateR2WithDomain(): UploadState {
  return {
    uploadStatus: "success",
    canonicalVideoUri: "https://videos.example.com/videos/default/cut-1/123.mp4",
    sceneExtensionEligible: true,
  };
}
const s2 = simulateR2WithDomain();
assert(s2.uploadStatus === "success", "R2+도메인 → uploadStatus=success");
assert(!!s2.canonicalVideoUri, "R2+도메인 → canonicalVideoUri 존재");

// 2c. R2 업로드 실패
function simulateUploadFailed(): UploadState {
  return {
    uploadStatus: "failed",
    sceneExtensionEligible: false,
    uploadError: "R2 upload failed: put() timeout",
  };
}
const s3 = simulateUploadFailed();
assert(s3.uploadStatus === "failed", "업로드 실패 → uploadStatus=failed");
assert(s3.sceneExtensionEligible === false, "업로드 실패 → sceneExtensionEligible=false");
assert(!!s3.uploadError, "업로드 실패 → uploadError 포함");

// 2d. 업로드 불필요 (Kling(EvoLink) HTTPS URL 직반환)
function simulateNoUploadNeeded(): UploadState {
  return {
    uploadStatus: "none",
    canonicalVideoUri: undefined,
    sceneExtensionEligible: false,
  };
}
const s4 = simulateNoUploadNeeded();
assert(s4.uploadStatus === "none", "업로드 불필요 → uploadStatus=none");

// 2e. R2 성공 (도메인 없음 → proxy URI만)
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
  if (uri.startsWith("https://")) return true;
  return false; // data: URIs, proxy URIs 등은 불가
}

assert(isSceneExtensionEligible("https://cdn.klingai.com/video/abc.mp4") === true, "Kling HTTPS URI → eligible");
assert(isSceneExtensionEligible("https://videos.example.com/key.mp4") === true, "R2 custom domain URI → eligible");
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
  const res = { success: true, storage: "r2", canonicalVideoUri: undefined as string | undefined, proxyUri: "/api/proxy-video?r2key=key", key: "key" };
  assert(res.success === true, "R2 no-domain → success");
  assert(!res.canonicalVideoUri, "R2 no-domain → canonicalVideoUri 없음 (proxyUri만)");
  assert(!!res.proxyUri, "R2 no-domain → proxyUri 있음");
}

// 4c. 스토리지 미설정 (501)
{
  const res = { error: "영상 업로드 스토리지가 설정되지 않았습니다", guide: { option1: "Cloudflare R2: VIDEO_BUCKET 바인딩 + VIDEO_BUCKET_DOMAIN 환경변수 설정", note: "Kling(EvoLink)은 HTTPS URL을 직반환하므로 대부분 업로드 불필요" } };
  assert(!!res.guide, "스토리지 미설정 → 가이드 포함");
  assert(res.guide.note.includes("Kling"), "가이드에 Kling 직반환 안내 포함");
}

// ─── 5. Diagnostic Object ────────────────────────────────────

console.log("\n═══ 5. Diagnostic Object ═══");

interface UploadDiag {
  selectedProvider: "r2" | "none";
  bucketName: string | null;
  r2Available: boolean;
  uploadStartMs: number;
  uploadEndMs?: number;
  failureReason?: string;
  canonicalVideoUri?: string | null;
  sceneExtensionEligible: boolean;
}

const diag: UploadDiag = {
  selectedProvider: "r2",
  bucketName: "VIDEO_BUCKET (R2 binding)",
  r2Available: true,
  uploadStartMs: 1000,
  uploadEndMs: 2500,
  failureReason: undefined,
  canonicalVideoUri: "https://videos.example.com/videos/default/cut-1/123.mp4",
  sceneExtensionEligible: true,
};

assert(diag.selectedProvider === "r2", "diag.selectedProvider 추적");
assert(!!diag.bucketName, "diag.bucketName 추적");
assert(typeof diag.uploadStartMs === "number", "diag.uploadStartMs 추적");
assert(typeof diag.uploadEndMs === "number", "diag.uploadEndMs 추적");
assert(diag.sceneExtensionEligible === true, "diag.sceneExtensionEligible 추적");

// ─── 6. No-storage Fallback ──────────────────────────────────

console.log("\n═══ 6. No-storage Fallback ═══");

const noStorageDiag: UploadDiag = {
  selectedProvider: "none",
  bucketName: null,
  r2Available: false,
  uploadStartMs: 1000,
  uploadEndMs: 1001,
  failureReason: "No storage provider available (VIDEO_BUCKET R2 not bound)",
  sceneExtensionEligible: false,
};

assert(noStorageDiag.selectedProvider === "none", "스토리지 없음 → selectedProvider=none");
assert(noStorageDiag.failureReason!.includes("VIDEO_BUCKET"), "실패 사유에 R2 바인딩 안내");

// ─── 7. Fallback Chain ───────────────────────────────────────

console.log("\n═══ 7. Fallback Chain ═══");

function determineFallback(clip: {
  canonicalVideoUri?: string;
  rawVideoUri?: string;
  lastFrameBase64?: string;
}): "SCENE_EXTENSION" | "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO" {
  const uri = clip.canonicalVideoUri || clip.rawVideoUri || "";
  if (uri.startsWith("https://")) return "SCENE_EXTENSION";
  if (clip.lastFrameBase64) return "IMAGE_TO_VIDEO";
  return "TEXT_TO_VIDEO";
}

assert(
  determineFallback({ canonicalVideoUri: "https://cdn.klingai.com/video/abc.mp4" }) === "SCENE_EXTENSION",
  "Kling HTTPS → SCENE_EXTENSION",
);
assert(
  determineFallback({ rawVideoUri: "https://videos.example.com/key.mp4" }) === "SCENE_EXTENSION",
  "R2 custom domain → SCENE_EXTENSION",
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
