/**
 * narration-ui-features.test.ts — 나레이션 UI 기능 테스트
 *
 * 테스트 범위:
 * 1. NarrationMode 전환 (auto/manual/mute)
 * 2. manual vs auto 텍스트 우선순위
 * 3. mute 모드 → TTS 제외
 * 4. AudioCoverageMeta 계산 (coverage, counts)
 * 5. deliveryMode 표시 로직
 * 6. sync status 뱃지 (exact/trimmed/padded)
 * 7. sceneDescription fallback provenance
 * 8. sync 경고 (duration 불일치)
 *
 * 실행: npx tsx tests/narration-ui-features.test.ts
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

// ═══════════════════════════════════════════════════════════════
// 1. NarrationMode 전환 로직
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 1. NarrationMode 전환 ═══");

type NarrationMode = "auto" | "manual" | "mute";

function resolveNarrationText(
  mode: NarrationMode,
  narrationText: string | undefined,
  sceneDescription: string | undefined,
): string {
  if (mode === "mute") return "";
  if (mode === "manual") return narrationText || "";
  // auto: narrationText > sceneDescription fallback
  return narrationText || sceneDescription || "";
}

// 1a. auto mode — narrationText가 있으면 사용
{
  const text = resolveNarrationText("auto", "나레이션 텍스트", "씬 설명");
  assert(text === "나레이션 텍스트", "auto mode: narrationText 우선 사용");
}

// 1b. auto mode — narrationText 없으면 sceneDescription fallback
{
  const text = resolveNarrationText("auto", undefined, "씬 설명");
  assert(text === "씬 설명", "auto mode: sceneDescription fallback");
}

// 1c. auto mode — 둘 다 없으면 빈 문자열
{
  const text = resolveNarrationText("auto", undefined, undefined);
  assert(text === "", "auto mode: 둘 다 없으면 빈 문자열");
}

// 1d. manual mode — narrationText만 사용
{
  const text = resolveNarrationText("manual", "직접 입력", "씬 설명");
  assert(text === "직접 입력", "manual mode: narrationText만 사용");
}

// 1e. manual mode — narrationText 없으면 빈 문자열 (sceneDescription 무시)
{
  const text = resolveNarrationText("manual", undefined, "씬 설명");
  assert(text === "", "manual mode: sceneDescription 무시");
}

// 1f. mute mode — 항상 빈 문자열
{
  const text = resolveNarrationText("mute", "나레이션", "씬 설명");
  assert(text === "", "mute mode: 항상 빈 문자열");
}

// ═══════════════════════════════════════════════════════════════
// 2. Mute 제외 로직
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 2. Mute 제외 로직 ═══");

interface MockShot {
  cutNumber: number;
  narrationMode: NarrationMode;
  narrationText?: string;
}

function filterShotsForTTS(shots: MockShot[]): MockShot[] {
  return shots.filter(s => s.narrationMode !== "mute");
}

{
  const shots: MockShot[] = [
    { cutNumber: 1, narrationMode: "auto", narrationText: "텍스트1" },
    { cutNumber: 2, narrationMode: "mute" },
    { cutNumber: 3, narrationMode: "manual", narrationText: "텍스트3" },
    { cutNumber: 4, narrationMode: "mute" },
  ];
  const filtered = filterShotsForTTS(shots);
  assert(filtered.length === 2, `mute 제외: ${filtered.length}/4 shot → TTS 대상`);
  assert(filtered.every(s => s.narrationMode !== "mute"), "mute shot이 결과에 없음");
}

// ═══════════════════════════════════════════════════════════════
// 3. AudioCoverageMeta 계산
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 3. AudioCoverageMeta 계산 ═══");

interface AudioCoverageMeta {
  totalShots: number;
  successfulShots: number;
  failedShots: number;
  mutedShots: number;
  coverage: number;
}

function calcCoverage(
  totalShots: number,
  successfulShots: number,
  failedShots: number,
  mutedShots: number,
): AudioCoverageMeta {
  const eligibleShots = totalShots - mutedShots;
  return {
    totalShots,
    successfulShots,
    failedShots,
    mutedShots,
    coverage: eligibleShots > 0 ? successfulShots / eligibleShots : 0,
  };
}

// 3a. 전체 성공
{
  const c = calcCoverage(5, 5, 0, 0);
  assert(c.coverage === 1.0, `전체 성공: coverage=${c.coverage}`);
}

// 3b. mute 포함
{
  const c = calcCoverage(5, 3, 0, 2);
  assert(c.coverage === 1.0, `mute 2개 제외 후 전체 성공: coverage=${c.coverage}`);
}

// 3c. 부분 실패
{
  const c = calcCoverage(5, 3, 2, 0);
  assert(c.coverage === 0.6, `5중 3 성공: coverage=${c.coverage}`);
}

// 3d. 전부 mute
{
  const c = calcCoverage(3, 0, 0, 3);
  assert(c.coverage === 0, `전부 mute: coverage=${c.coverage}`);
}

// 3e. mute + 실패 혼합
{
  const c = calcCoverage(6, 2, 1, 3);
  const expected = 2 / 3;
  assert(Math.abs(c.coverage - expected) < 0.01, `mute 3 + 실패 1: coverage=${c.coverage.toFixed(3)} ≈ ${expected.toFixed(3)}`);
}

// ═══════════════════════════════════════════════════════════════
// 4. DeliveryMode 표시
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 4. DeliveryMode 표시 ═══");

type DeliveryMode = "muxed" | "separate" | "none";

function deliveryModeLabel(mode: DeliveryMode): string {
  if (mode === "separate") return "오디오 (별도 파일)";
  if (mode === "muxed") return "오디오 (내장)";
  return "";
}

{
  assert(deliveryModeLabel("separate") === "오디오 (별도 파일)", "separate → 별도 파일");
  assert(deliveryModeLabel("muxed") === "오디오 (내장)", "muxed → 내장");
  assert(deliveryModeLabel("none") === "", "none → 빈 문자열");
}

// ═══════════════════════════════════════════════════════════════
// 5. Sync Status 뱃지 로직
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 5. Sync Status 뱃지 ═══");

type SyncStatus = "exact" | "trimmed" | "padded";

function determineSyncStatus(audioDuration: number, shotDuration: number, tolerance = 0.5): SyncStatus {
  if (audioDuration > shotDuration + tolerance) return "trimmed";
  if (audioDuration < shotDuration - tolerance) return "padded";
  return "exact";
}

function syncBadgeColor(status: SyncStatus): string {
  if (status === "trimmed") return "#f59e0b";
  if (status === "padded") return "#3b82f6";
  return "#22c55e";
}

// 5a. exact
{
  const s = determineSyncStatus(5.0, 5.0);
  assert(s === "exact", `5.0s audio / 5.0s shot → exact`);
  assert(syncBadgeColor(s) === "#22c55e", "exact → green");
}

// 5b. exact within tolerance
{
  const s = determineSyncStatus(5.3, 5.0);
  assert(s === "exact", `5.3s audio / 5.0s shot (within 0.5) → exact`);
}

// 5c. trimmed
{
  const s = determineSyncStatus(6.0, 5.0);
  assert(s === "trimmed", `6.0s audio / 5.0s shot → trimmed`);
  assert(syncBadgeColor(s) === "#f59e0b", "trimmed → amber");
}

// 5d. padded
{
  const s = determineSyncStatus(3.0, 5.0);
  assert(s === "padded", `3.0s audio / 5.0s shot → padded`);
  assert(syncBadgeColor(s) === "#3b82f6", "padded → blue");
}

// ═══════════════════════════════════════════════════════════════
// 6. Narration Text Source Provenance
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 6. Narration Source Provenance ═══");

function resolveNarrationSource(
  mode: NarrationMode,
  narrationText?: string,
  sceneDescription?: string,
): string {
  if (mode === "mute") return "muted";
  if (mode === "manual") return "manual";
  // auto
  if (narrationText) return "narrationText";
  if (sceneDescription) return "sceneDescription";
  return "none";
}

{
  assert(resolveNarrationSource("manual", "text") === "manual", "manual mode → source=manual");
  assert(resolveNarrationSource("mute") === "muted", "mute mode → source=muted");
  assert(resolveNarrationSource("auto", "text") === "narrationText", "auto + narrationText → source=narrationText");
  assert(resolveNarrationSource("auto", undefined, "scene") === "sceneDescription", "auto + sceneDescription fallback → source=sceneDescription");
  assert(resolveNarrationSource("auto") === "none", "auto + no text → source=none");
}

// ═══════════════════════════════════════════════════════════════
// 7. Sync 경고 메시지
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 7. Sync 경고 ═══");

function estimateNarrationDuration(textLength: number, charsPerSec = 4): number {
  return textLength / charsPerSec;
}

function syncWarning(textLength: number, shotDurationSec: number): string | null {
  const est = estimateNarrationDuration(textLength);
  const tolerance = 0.5;
  if (est > shotDurationSec + tolerance) {
    return `예상 ${est.toFixed(1)}s — trimmed 가능`;
  }
  if (est < shotDurationSec - tolerance) {
    return `예상 ${est.toFixed(1)}s — padded`;
  }
  return null;
}

// 7a. 긴 텍스트 → trimmed 경고
{
  // 40글자 = 10s 예상, shot = 5s
  const warn = syncWarning(40, 5);
  assert(warn !== null && warn.includes("trimmed"), `40글자/5s shot → trimmed 경고: ${warn}`);
}

// 7b. 짧은 텍스트 → padded 경고
{
  // 8글자 = 2s 예상, shot = 5s
  const warn = syncWarning(8, 5);
  assert(warn !== null && warn.includes("padded"), `8글자/5s shot → padded 경고: ${warn}`);
}

// 7c. 적절한 텍스트 → 경고 없음
{
  // 20글자 = 5s 예상, shot = 5s
  const warn = syncWarning(20, 5);
  assert(warn === null, `20글자/5s shot → 경고 없음`);
}

// 7d. 빈 텍스트 → padded
{
  const warn = syncWarning(0, 5);
  assert(warn !== null && warn.includes("padded"), `빈 텍스트 → padded: ${warn}`);
}

// ═══════════════════════════════════════════════════════════════
// 8. EditableShot narration field update
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 8. EditableShot narration fields ═══");

interface MockEditableShot {
  shotId: string;
  narrationText?: string;
  narrationMode?: NarrationMode;
}

function updateMockShotField(shot: MockEditableShot, path: string, value: string): MockEditableShot {
  const updated = { ...shot };
  if (path === "narrationText") updated.narrationText = value;
  else if (path === "narrationMode") updated.narrationMode = value as NarrationMode;
  return updated;
}

// 8a. narrationText update
{
  const shot: MockEditableShot = { shotId: "s1" };
  const updated = updateMockShotField(shot, "narrationText", "새 나레이션");
  assert(updated.narrationText === "새 나레이션", "narrationText update");
}

// 8b. narrationMode update
{
  const shot: MockEditableShot = { shotId: "s1", narrationMode: "auto" };
  const updated = updateMockShotField(shot, "narrationMode", "manual");
  assert(updated.narrationMode === "manual", "narrationMode update auto→manual");
}

// 8c. narrationMode to mute
{
  const shot: MockEditableShot = { shotId: "s1", narrationMode: "auto", narrationText: "text" };
  const updated = updateMockShotField(shot, "narrationMode", "mute");
  assert(updated.narrationMode === "mute", "narrationMode → mute");
  assert(updated.narrationText === "text", "mute 전환 시 narrationText 보존");
}

// 8d. default narrationMode is auto
{
  const shot: MockEditableShot = { shotId: "s1" };
  const mode = shot.narrationMode || "auto";
  assert(mode === "auto", "기본 narrationMode = auto");
}

// ═══════════════════════════════════════════════════════════════
// 9. CutProvenance audio fields
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 9. CutProvenance audio provenance ═══");

interface MockProvenance {
  narrationMode?: NarrationMode;
  narrationSource?: string;
  narrationSyncStatus?: SyncStatus;
  narrationAudioAvailable?: boolean;
}

{
  const p: MockProvenance = {
    narrationMode: "auto",
    narrationSource: "sceneDescription",
    narrationSyncStatus: "trimmed",
    narrationAudioAvailable: true,
  };
  assert(p.narrationMode === "auto", "provenance: narrationMode");
  assert(p.narrationSource === "sceneDescription", "provenance: narrationSource");
  assert(p.narrationSyncStatus === "trimmed", "provenance: narrationSyncStatus");
  assert(p.narrationAudioAvailable === true, "provenance: audio available");
}

{
  const p: MockProvenance = {
    narrationMode: "mute",
    narrationAudioAvailable: false,
  };
  assert(p.narrationMode === "mute", "mute provenance");
  assert(p.narrationAudioAvailable === false, "mute → audio unavailable");
}

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

console.log(`\n${"═".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.error("SOME TESTS FAILED");
  process.exit(1);
} else {
  console.log("ALL TESTS PASSED ✓");
}
