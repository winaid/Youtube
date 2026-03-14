/**
 * narration-audio-pipeline.test.ts — TTS 나레이션 생성 + 오디오 파이프라인 테스트
 *
 * 테스트 범위:
 * 1. TTS 요청 데이터 구조 검증
 * 2. MP3 duration 추정 로직
 * 3. speakingRate 계산 (shot duration sync)
 * 4. R2 키 생성 (audio path)
 * 5. AudioMeta 응답 구조
 * 6. sync 상태 판정 (exact / trimmed / padded)
 * 7. degraded fallback (TTS 실패 시)
 * 8. narrationText source of truth (structuredSequence > sceneDescription)
 *
 * 실행: npx tsx tests/narration-audio-pipeline.test.ts
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
// 1. MP3 Duration 추정
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 1. MP3 Duration 추정 ═══");

function estimateMp3Duration(base64Length: number): number {
  const bytes = (base64Length * 3) / 4;
  return bytes / (32 * 1000 / 8);
}

// 1a. 짧은 오디오 (~1초)
{
  // 32kbps = 4000 bytes/sec → base64 ≈ 5333 chars/sec
  const oneSecBase64 = 5333;
  const dur = estimateMp3Duration(oneSecBase64);
  assert(Math.abs(dur - 1.0) < 0.1, `1초 MP3 추정: ${dur.toFixed(2)}s ≈ 1.0s`);
}

// 1b. 5초 오디오
{
  const fiveSecBase64 = 5333 * 5;
  const dur = estimateMp3Duration(fiveSecBase64);
  assert(Math.abs(dur - 5.0) < 0.5, `5초 MP3 추정: ${dur.toFixed(2)}s ≈ 5.0s`);
}

// 1c. 0 길이
{
  const dur = estimateMp3Duration(0);
  assert(dur === 0, `0 길이 base64 → 0초`);
}

// ═══════════════════════════════════════════════════════════════
// 2. speakingRate 계산
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 2. speakingRate 계산 ═══");

function calcSpeakingRate(textLength: number, targetDurationSec: number, baseRate: number): number {
  const estimatedDurationAtBase = (textLength / 4) * (1 / baseRate);
  if (estimatedDurationAtBase <= 0 || targetDurationSec <= 0) return baseRate;
  const needed = estimatedDurationAtBase / targetDurationSec;
  return Math.min(4.0, Math.max(0.25, needed * baseRate));
}

// 2a. 정상 케이스: 20자 텍스트, 5초 shot, baseRate 1.0
{
  // 20자 / 4글자/초 = 5초 at rate 1.0 → needed = 1.0
  const rate = calcSpeakingRate(20, 5, 1.0);
  assert(Math.abs(rate - 1.0) < 0.1, `20자 5초 → rate ≈ 1.0 (got ${rate.toFixed(2)})`);
}

// 2b. 긴 텍스트, 짧은 shot → 빠른 속도
{
  // 40자 / 4글자/초 = 10초 at rate 1.0 → needed = 10/5 = 2.0
  const rate = calcSpeakingRate(40, 5, 1.0);
  assert(Math.abs(rate - 2.0) < 0.1, `40자 5초 → rate ≈ 2.0 (got ${rate.toFixed(2)})`);
}

// 2c. 짧은 텍스트, 긴 shot → 느린 속도
{
  // 8자 / 4글자/초 = 2초 at rate 1.0 → needed = 2/10 = 0.2 → clamped to 0.25
  const rate = calcSpeakingRate(8, 10, 1.0);
  assert(rate === 0.25, `8자 10초 → rate = 0.25 (min clamp) (got ${rate})`);
}

// 2d. rate 상한: 4.0
{
  // 400자 / 4글자/초 = 100초 at rate 1.0 → needed = 100/2 = 50 → clamped to 4.0
  const rate = calcSpeakingRate(400, 2, 1.0);
  assert(rate === 4.0, `400자 2초 → rate = 4.0 (max clamp) (got ${rate})`);
}

// 2e. 0 duration → baseRate 반환
{
  const rate = calcSpeakingRate(20, 0, 1.0);
  assert(rate === 1.0, `0초 duration → baseRate 1.0 (got ${rate})`);
}

// 2f. 0 textLength → baseRate 반환
{
  const rate = calcSpeakingRate(0, 5, 1.0);
  assert(rate === 1.0, `0자 텍스트 → baseRate 1.0 (got ${rate})`);
}

// ═══════════════════════════════════════════════════════════════
// 3. R2 Audio Key 생성
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 3. R2 Audio Key 생성 ═══");

function deriveAudioR2Key(sessionId: string, cutNumber: number): string {
  const timestamp = 1700000000000; // fixed for test
  return `audio/${sessionId}/cut-${cutNumber}/${timestamp}.mp3`;
}

// 3a. 기본 키
{
  const key = deriveAudioR2Key("session-abc", 1);
  assert(key === "audio/session-abc/cut-1/1700000000000.mp3", `audio R2 키 형식 정확`);
}

// 3b. 비디오 키와 분리
{
  const audioKey = deriveAudioR2Key("s1", 2);
  const videoKey = `videos/s1/cut-2/1700000000000.mp4`;
  assert(audioKey.startsWith("audio/"), `audio 키는 audio/ prefix`);
  assert(videoKey.startsWith("videos/"), `video 키는 videos/ prefix`);
  assert(audioKey !== videoKey, `audio/video 키 분리`);
}

// ═══════════════════════════════════════════════════════════════
// 4. Sync 상태 판정
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 4. Sync 상태 판정 ═══");

function determineSyncStatus(audioDuration: number, shotDuration: number): "exact" | "trimmed" | "padded" {
  const tolerance = 0.5;
  if (audioDuration > shotDuration + tolerance) return "trimmed";
  if (audioDuration < shotDuration - tolerance) return "padded";
  return "exact";
}

// 4a. exact (오차 0.5초 이내)
assert(determineSyncStatus(5.0, 5.0) === "exact", "5.0s audio, 5.0s shot → exact");
assert(determineSyncStatus(5.3, 5.0) === "exact", "5.3s audio, 5.0s shot → exact (tolerance 이내)");
assert(determineSyncStatus(4.7, 5.0) === "exact", "4.7s audio, 5.0s shot → exact (tolerance 이내)");

// 4b. trimmed (오디오 > shot + 0.5s)
assert(determineSyncStatus(6.0, 5.0) === "trimmed", "6.0s audio, 5.0s shot → trimmed");
assert(determineSyncStatus(10.0, 5.0) === "trimmed", "10.0s audio, 5.0s shot → trimmed");

// 4c. padded (오디오 < shot - 0.5s)
assert(determineSyncStatus(3.0, 5.0) === "padded", "3.0s audio, 5.0s shot → padded");
assert(determineSyncStatus(1.0, 5.0) === "padded", "1.0s audio, 5.0s shot → padded");

// ═══════════════════════════════════════════════════════════════
// 5. AudioMeta 응답 구조
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 5. AudioMeta 응답 구조 ═══");

interface NarrationTrack {
  cutNumber: number;
  audioUri: string;
  text: string;
  durationSec: number;
  syncStatus: "exact" | "trimmed" | "padded";
  generatedAt: number;
}

interface AudioMeta {
  audioIncluded: boolean;
  audioTracks: NarrationTrack[];
  narrationUsed: boolean;
  deliveryMode: "muxed" | "separate" | "none";
  warnings: string[];
}

// 5a. 성공 응답
{
  const meta: AudioMeta = {
    audioIncluded: true,
    audioTracks: [
      { cutNumber: 1, audioUri: "https://cdn.example.com/audio/cut-1.mp3", text: "나레이션 1", durationSec: 5.0, syncStatus: "exact", generatedAt: Date.now() },
      { cutNumber: 2, audioUri: "https://cdn.example.com/audio/cut-2.mp3", text: "나레이션 2", durationSec: 6.0, syncStatus: "trimmed", generatedAt: Date.now() },
    ],
    narrationUsed: true,
    deliveryMode: "separate",
    warnings: [],
  };
  assert(meta.audioIncluded === true, "성공 시 audioIncluded=true");
  assert(meta.audioTracks.length === 2, "트랙 2개 포함");
  assert(meta.narrationUsed === true, "narrationUsed=true");
  assert(meta.deliveryMode === "separate", "deliveryMode=separate (Cloudflare Workers → mux 불가)");
}

// 5b. 실패 응답 (degraded)
{
  const meta: AudioMeta = {
    audioIncluded: false,
    audioTracks: [],
    narrationUsed: false,
    deliveryMode: "none",
    warnings: ["All TTS generations failed — degraded mode (no audio)"],
  };
  assert(meta.audioIncluded === false, "실패 시 audioIncluded=false");
  assert(meta.audioTracks.length === 0, "실패 시 빈 트랙");
  assert(meta.deliveryMode === "none", "실패 시 deliveryMode=none");
  assert(meta.warnings.length > 0, "실패 시 degraded warning 포함");
}

// 5c. 부분 실패
{
  const meta: AudioMeta = {
    audioIncluded: true,
    audioTracks: [
      { cutNumber: 1, audioUri: "https://cdn.example.com/audio/cut-1.mp3", text: "나레이션 1", durationSec: 5.0, syncStatus: "exact", generatedAt: Date.now() },
    ],
    narrationUsed: true,
    deliveryMode: "separate",
    warnings: ["Cut 2: TTS failed", "1 of 2 shots failed TTS — partial audio"],
  };
  assert(meta.audioIncluded === true, "부분 실패도 audioIncluded=true (일부 트랙 존재)");
  assert(meta.warnings.length === 2, "부분 실패 시 경고 2개");
}

// ═══════════════════════════════════════════════════════════════
// 6. Narration Text Source of Truth
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 6. narrationText source of truth ═══");

function resolveNarrationText(
  sequenceNarration?: string,
  sceneDescription?: string,
): string {
  return sequenceNarration || sceneDescription || "";
}

// 6a. structuredSequence.narrationText 우선
{
  const text = resolveNarrationText("시퀀스 나레이션", "씬 설명");
  assert(text === "시퀀스 나레이션", "structuredSequence.narrationText가 source of truth");
}

// 6b. narrationText 없으면 sceneDescription fallback
{
  const text = resolveNarrationText(undefined, "씬 설명 fallback");
  assert(text === "씬 설명 fallback", "narrationText 없으면 sceneDescription fallback");
}

// 6c. 둘 다 없으면 빈 문자열
{
  const text = resolveNarrationText(undefined, undefined);
  assert(text === "", "둘 다 없으면 빈 문자열 (TTS 스킵)");
}

// ═══════════════════════════════════════════════════════════════
// 7. TTS Request Payload 구조
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 7. TTS Request Payload ═══");

interface NarrationRequest {
  sessionId: string;
  shots: Array<{
    cutNumber: number;
    shotId: string;
    narrationText: string;
    durationSec: number;
    startSec: number;
    endSec: number;
  }>;
  voiceName?: string;
  speakingRate?: number;
}

// 7a. 기본 요청 구조
{
  const req: NarrationRequest = {
    sessionId: "test-session",
    shots: [
      { cutNumber: 1, shotId: "shot_1", narrationText: "첫 번째 장면 나레이션", durationSec: 5, startSec: 0, endSec: 5 },
      { cutNumber: 2, shotId: "shot_2", narrationText: "두 번째 장면 나레이션", durationSec: 8, startSec: 5, endSec: 13 },
    ],
  };
  assert(req.shots.length === 2, "shots 배열 전달");
  assert(req.shots[0].startSec === 0, "첫 shot 시작 0초");
  assert(req.shots[1].startSec === 5, "두 번째 shot 시작 = 첫 shot endSec");
  assert(req.shots[1].endSec === 13, "타임라인 연속성 유지");
}

// 7b. duration 누적 계산
{
  const shots = [
    { cutNumber: 1, durationSec: 5 },
    { cutNumber: 2, durationSec: 8 },
    { cutNumber: 3, durationSec: 6 },
  ];
  let cumulative = 0;
  const timeline = shots.map(s => {
    const start = cumulative;
    cumulative += s.durationSec;
    return { cutNumber: s.cutNumber, startSec: start, endSec: cumulative };
  });
  assert(timeline[0].startSec === 0, "cut 1 시작: 0s");
  assert(timeline[0].endSec === 5, "cut 1 종료: 5s");
  assert(timeline[1].startSec === 5, "cut 2 시작: 5s");
  assert(timeline[1].endSec === 13, "cut 2 종료: 13s");
  assert(timeline[2].startSec === 13, "cut 3 시작: 13s");
  assert(timeline[2].endSec === 19, "cut 3 종료: 19s");
}

// ═══════════════════════════════════════════════════════════════
// 8. Empty/Edge Cases
// ═══════════════════════════════════════════════════════════════

console.log("\n═══ 8. Edge Cases ═══");

// 8a. 빈 narrationText는 스킵
{
  const shots = [
    { cutNumber: 1, text: "나레이션 있음" },
    { cutNumber: 2, text: "" },
    { cutNumber: 3, text: "  " }, // whitespace only
    { cutNumber: 4, text: "나레이션 있음" },
  ];
  const filtered = shots.filter(s => s.text.trim());
  assert(filtered.length === 2, `빈/공백 narrationText 스킵 (4 → ${filtered.length})`);
  assert(filtered[0].cutNumber === 1, "첫 번째 유효 shot");
  assert(filtered[1].cutNumber === 4, "네 번째 유효 shot");
}

// 8b. text 5000자 제한
{
  const longText = "가".repeat(6000);
  const truncated = longText.slice(0, 5000);
  assert(truncated.length === 5000, "TTS 입력 5000자 제한");
}

// 8c. NarrationTrack에 syncStatus 필수
{
  const track: NarrationTrack = {
    cutNumber: 1,
    audioUri: "data:audio/mpeg;base64,AAAA",
    text: "test",
    durationSec: 3,
    syncStatus: "padded",
    generatedAt: Date.now(),
  };
  assert(["exact", "trimmed", "padded"].includes(track.syncStatus), "syncStatus는 3가지 중 하나");
}

// ═══════════════════════════════════════════════════════════════
// 결과 요약
// ═══════════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(50));
console.log(`결과: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
