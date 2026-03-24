/**
 * Cinematic Realism 3D/CGI drift 방지 테스트
 *
 * 테스트 시나리오:
 * 1. prompt rewrite — camera conflict 감지 및 교정
 * 2. prompt rewrite — 3D/CGI 표현 자동 치환
 * 3. video-prompt-json renderer — medium enforcement
 * 4. prompt-architecture — map-graphic 장르 negative 강화
 * 5. 6계층 assembler — cinematic realism + map scene
 *
 * 실행: npx tsx tests/cinematic-realism-drift.test.ts
 */

import { rewritePromptConflicts, assemblePromptV2, collectFailureModeNegatives, buildSceneLock, buildNegativePrompt } from "../src/lib/prompt-architecture";
import { renderPromptFromJson, type VideoPromptJson } from "../src/lib/video-prompt-json";

// ─── 테스트 유틸 ─────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(`  ✗ FAIL: ${label}`);
  }
}

function section(name: string) {
  console.log(`\n━━ ${name} ━━`);
}

// ═══════════════════════════════════════════════════════════════════
console.log("🎬 Cinematic Realism 3D/CGI Drift 방지 테스트\n");

// ─── 1. Camera Conflict 감지 ────────────────────────────────────

section("1. Camera Conflict 감지 및 교정");

// wide + close-up 충돌
const conflictPrompt1 = "A high-angle, wide aerial view of a relief map. Medium shot framing of the terrain details.";
const r1 = rewritePromptConflicts(conflictPrompt1);
assert(r1.corrections.length > 0, "wide + medium shot conflict 감지됨");
assert(!r1.rewritten.includes("Medium shot") || !r1.rewritten.includes("wide aerial"), "충돌하는 framing 중 하나 제거됨");

// high-angle + low-angle 충돌
const conflictPrompt2 = "Overhead view from above. Worm's eye view looking upward.";
const r2 = rewritePromptConflicts(conflictPrompt2);
assert(r2.corrections.length > 0, "overhead + worm's eye conflict 감지됨");

// 충돌 없는 프롬프트 → corrections 비어야 함
const noConflict = "Wide shot, overhead angle, slow push-in toward the map surface.";
const r3 = rewritePromptConflicts(noConflict);
assert(r3.corrections.length === 0, "충돌 없는 프롬프트 → 교정 없음");

console.log(`  ✓ ${passed} camera conflict assertions passed`);

// ─── 2. 3D/CGI 표현 자동 치환 ──────────────────────────────────

section("2. 3D/CGI 표현 자동 치환");

const prevPassed2 = passed;

// cinematic realism 모드에서 3D topographic map → physical relief map surface
const cgiPrompt1 = "A 3D topographic map of Eurasia with crimson glow spreading. Cinematic realism style.";
const cr1 = rewritePromptConflicts(cgiPrompt1, { isCinematicRealism: true });
assert(cr1.corrections.length > 0, "3D topographic map → 치환 발생");
assert(!cr1.rewritten.includes("3D topographic map"), "3D topographic map 표현 제거됨");
assert(cr1.rewritten.includes("physical relief map surface"), "physical relief map surface로 치환됨");

// 3D terrain → physical terrain surface
const cgiPrompt2 = "Camera drifts over 3D terrain showing mountain ranges. Cinematic realism.";
const cr2 = rewritePromptConflicts(cgiPrompt2, { isCinematicRealism: true });
assert(!cr2.rewritten.includes("3D terrain"), "3D terrain 제거됨");
assert(cr2.rewritten.includes("physical terrain surface"), "physical terrain surface로 치환됨");

// game-map → physical map
const cgiPrompt3 = "The game-map surface shows borders. Cinematic realism.";
const cr3 = rewritePromptConflicts(cgiPrompt3, { isCinematicRealism: true });
assert(!cr3.rewritten.includes("game-map"), "game-map 제거됨");
assert(cr3.rewritten.includes("physical map"), "physical map으로 치환됨");

// miniature diorama → physical map surface
const cgiPrompt4 = "A miniature diorama of the European continent. Cinematic realism.";
const cr4 = rewritePromptConflicts(cgiPrompt4, { isCinematicRealism: true });
assert(!cr4.rewritten.includes("miniature diorama"), "miniature diorama 제거됨");

// cinematic realism이 아닌 모드에서는 치환하지 않음
const nonCRPrompt = "A 3D topographic map of Eurasia. Fantasy style.";
const ncr = rewritePromptConflicts(nonCRPrompt, { isCinematicRealism: false });
assert(ncr.corrections.length === 0, "non-cinematic-realism: 치환 없음");
assert(ncr.rewritten.includes("3D topographic map"), "non-cinematic-realism: 3D 표현 유지");

console.log(`  ✓ ${passed - prevPassed2} 3D/CGI substitution assertions passed`);

// ─── 3. VEO Renderer — medium enforcement ─────────────────────

section("3. VEO Renderer medium enforcement");

const prevPassed3 = passed;

const mapJson: VideoPromptJson = {
  shotSize: "WS",
  cameraAngle: "overhead",
  cameraMovement: "slow push-in",
  subjectBlocking: "map fills frame",
  subjectAction: "crimson glow expands from Mongolian steppe region across the 3D topographic map",
  actionBeat: "red area spreads",
  bodySignal: "",
  revealed: "",
  withheld: "",
  timingBeat: "0s-4s: glow begins. 4s-8s: spreads across steppe",
  transitionFromPrev: "",
  characterRef: "",
  moodLighting: "cool diffused daylight from above",
  styleSuffix: "cinematic realism, no readable text, no watermark",
  locationCue: "physical relief map of Eurasia",
  situationCue: "crimson territory expansion",
  emotionalAnchor: "",
};

// VEO renderer: 3D topographic map → physical relief map surface
const veoPrompt = renderPromptFromJson(mapJson);
assert(!veoPrompt.includes("3D topographic map"), "VEO: 3D topographic map 제거됨");
assert(veoPrompt.includes("physical"), "VEO: physical 표현 포함");
assert(veoPrompt.includes("not a real landscape and not a CGI render"), "VEO: medium lock 문장 삽입됨");

// 캐릭터 씬 — medium enforcement 미적용
const charJson: VideoPromptJson = {
  shotSize: "MS",
  cameraAngle: "eye-level",
  cameraMovement: "slow push-in",
  subjectBlocking: "subject center-frame",
  subjectAction: "doctor slumps at desk",
  actionBeat: "pen slips",
  bodySignal: "shoulders rounded",
  revealed: "",
  withheld: "",
  timingBeat: "",
  transitionFromPrev: "",
  characterRef: "Dr. Kim, mid-40s, white coat",
  moodLighting: "warm desk lamp",
  styleSuffix: "cinematic realism",
  locationCue: "office desk",
  situationCue: "late night",
  emotionalAnchor: "slumps alone",
};
const charVeo = renderPromptFromJson(charJson);
assert(!charVeo.includes("not a real landscape and not a CGI render"), "캐릭터 씬: medium lock 미적용");

console.log(`  ✓ ${passed - prevPassed3} renderer enforcement assertions passed`);

// ─── 4. Failure Mode Library — 3D/CGI drift 트리거 ──────────────

section("4. Failure Mode Library 확장");

const prevPassed4 = passed;

// "3D topographic map" → 3D/CGI negative 수집
const negs1 = collectFailureModeNegatives("A 3D topographic map of the continent");
assert(negs1.some(n => n.includes("3D render")), "3D topographic → 3D render negative");
assert(negs1.some(n => n.includes("CGI")), "3D topographic → CGI negative");

// "relief map" → landscape/CGI drift negative
const negs2 = collectFailureModeNegatives("A relief map showing terrain contours");
assert(negs2.some(n => n.includes("real landscape")), "relief map → real landscape negative");
assert(negs2.some(n => n.includes("CGI render")), "relief map → CGI render negative");

// 일반 "map" → landscape drift negative (기존 동작 보존)
const negs3 = collectFailureModeNegatives("An antique map of Asia");
assert(negs3.some(n => n.includes("landscape")), "map → landscape negative (기존 동작 유지)");

console.log(`  ✓ ${passed - prevPassed4} failure mode assertions passed`);

// ─── 5. buildSceneLock — cinematic realism + map medium lock ────

section("5. Scene Lock + map medium 고정");

const prevPassed5 = passed;

const sceneLock = buildSceneLock({
  scenePrompt: "A physical relief map of Eurasia, cinematic realism style",
  shotCategory: "map-graphic",
  shotType: "WS",
  durationSec: 8,
  styleIntensity: 80,
  animationMode: "cinematic-realism",
});

// map-graphic genre → 3D render, CGI, game map in "not X" constraints
assert(sceneLock.includes("not a 3D render"), "sceneLock: not a 3D render 포함");
assert(sceneLock.includes("not a CGI"), "sceneLock: not a CGI 포함");
assert(sceneLock.includes("physical map surface"), "sceneLock: medium lock 문장 포함");

console.log(`  ✓ ${passed - prevPassed5} scene lock assertions passed`);

// ─── 6. buildNegativePrompt — map-graphic enhanced ──────────────

section("6. Negative Prompt 강화 (map-graphic)");

const prevPassed6 = passed;

const negPrompt = buildNegativePrompt({
  scenePrompt: "A physical relief map of Eurasia showing territorial expansion",
  shotCategory: "map-graphic",
  durationSec: 8,
  styleIntensity: 80,
});

assert(negPrompt.includes("3D render"), "negative: 3D render");
assert(negPrompt.includes("CGI"), "negative: CGI");
assert(negPrompt.includes("game-map look"), "negative: game-map look");
assert(negPrompt.includes("miniature diorama"), "negative: miniature diorama");

console.log(`  ✓ ${passed - prevPassed6} negative prompt assertions passed`);

// ─── 7. 6계층 Assembler — cinematic realism + map scene ─────────

section("7. 6계층 Assembler integration");

const prevPassed7 = passed;

const assembled = assemblePromptV2({
  scenePrompt: "A 3D topographic map of Eurasia. Cinematic realism. Crimson glow spreads from Mongolia.",
  shotCategory: "map-graphic",
  shotType: "WS",
  durationSec: 8,
  styleIntensity: 80,
  animationMode: "cinematic-realism",
});

// 3D topographic map이 rewrite에 의해 교정되어야 함
assert(!assembled.finalPrompt.includes("3D topographic map"), "assembler: 3D topographic map 교정됨");
assert(assembled.finalPrompt.includes("physical"), "assembler: physical 표현으로 치환됨");

// drift assessment에 rewrite correction이 기록됨
assert(assembled.driftAssessment.issues.some(i => i.includes("CGI drift")), "assembler: CGI drift correction 기록됨");

console.log(`  ✓ ${passed - prevPassed7} assembler integration assertions passed`);

// ═══════════════════════════════════════════════════════════════════
// 결과 요약
// ═══════════════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(50));
console.log(`✅ 통과: ${passed}`);
console.log(`❌ 실패: ${failed}`);

if (failures.length > 0) {
  console.log("\n실패 목록:");
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
  process.exit(1);
}

console.log("\n🎬 Cinematic Realism drift 방지 테스트 완료!");
