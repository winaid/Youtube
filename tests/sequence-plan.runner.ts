/**
 * 시퀀스 플랜 아키텍처 테스트
 *
 * 테스트 시나리오:
 * 1. Cut[] → SequencePlan 변환
 * 2. SequencePlan JSON validation (10 규칙)
 * 3. Provider prompt 직렬화 (shot 경계 보존)
 * 4. Fidelity evaluation (생성 결과 vs plan)
 * 5. 실패 원인 3-way 분류
 * 6. ShotPlan ↔ VideoPromptJson 양방향 변환
 *
 * 실행: npx tsx tests/sequence-plan.test.ts
 */

import {
  buildSequencePlan,
  validateSequencePlan,
  serializeSequencePlan,
  evaluateSequenceFidelity,
  shotPlanToVideoPromptJson,
  videoPromptJsonToShotPlan,
  SequencePlan,
  ShotPlan,
} from "../src/lib/sequence-plan";
import type { Cut, VideoPromptJson } from "../src/types";

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

// ─── 테스트 데이터: 3-shot 시퀀스 ──────────────────────────────────

function makeTestCuts(): Cut[] {
  return [
    {
      cutNumber: 1,
      durationSec: 8,
      sceneDescription: "치과 진료실 전경",
      cameraDirection: "wide establishing",
      moodLighting: "warm overhead fluorescent from above, soft diffused through frosted panel",
      imagePrompt: "",
      endImagePrompt: "",
      videoPrompt: "WS establishing shot...",
      extendPrompt: "",
      transitionHint: "컷",
      characterConsistency: "",
      charactersInScene: [],
      shotCategory: "environment",
      characterRole: "absent",
      videoPromptJson: {
        shotSize: "WS",
        cameraAngle: "eye-level",
        cameraMovement: "slow pan right (reveals empty chairs)",
        subjectBlocking: "environment fills frame",
        subjectAction: "camera drifts across empty dental treatment room",
        actionBeat: "slow pan revealing three empty dental chairs in a row",
        bodySignal: "",
        revealed: "empty waiting room during late hours",
        withheld: "doctor is elsewhere",
        timingBeat: "0s-3s: empty chairs. 3s-6s: overhead lamp flickers. 6s-8s: door ajar",
        transitionFromPrev: "",
        characterRef: "",
        moodLighting: "warm overhead fluorescent from above, soft diffused through frosted panel",
        styleSuffix: "cinematic realism, 16:9, no readable text, watermark, or onscreen UI",
        locationCue: "dental chair and overhead exam lamp",
        situationCue: "empty waiting room, lights still on",
        emotionalAnchor: "single coat on a hook by the door",
      },
    },
    {
      cutNumber: 2,
      durationSec: 8,
      sceneDescription: "의사 혼자 앉아있는 모습",
      cameraDirection: "medium shot",
      moodLighting: "warm desk lamp from left, cool fluorescent from above",
      imagePrompt: "",
      endImagePrompt: "",
      videoPrompt: "MS shot...",
      extendPrompt: "",
      transitionHint: "컷",
      characterConsistency: "Dr. Kim",
      charactersInScene: ["Dr. Kim"],
      shotCategory: "character-driven",
      characterRole: "protagonist",
      videoPromptJson: {
        shotSize: "MS",
        cameraAngle: "eye-level",
        cameraMovement: "slow push-in (tension builds as isolation revealed)",
        subjectBlocking: "subject center-frame mid-ground",
        subjectAction: "doctor slumps forward at desk, pen dangling from loose fingers",
        actionBeat: "pen slips — catches it — sets it down deliberately",
        bodySignal: "shoulders rounded, gaze drops to desktop surface",
        revealed: "stack of unfinished patient charts",
        withheld: "what made the day difficult",
        timingBeat: "0s-3s: doctor still at desk. 3s-6s: pen slips. 6s-8s: sets pen down",
        transitionFromPrev: "contrast: empty room → occupied desk",
        characterRef: "Dr. Kim, mid-40s Korean male, white lab coat, thin-framed glasses, short cropped hair, tired eyes",
        moodLighting: "warm desk lamp from left, cool fluorescent from above creating dual shadows",
        styleSuffix: "cinematic realism, 16:9, no readable text, watermark, or onscreen UI, with natural diegetic sound",
        locationCue: "clinical desk with scattered charts and a desk lamp",
        situationCue: "unfinished paperwork after hours",
        emotionalAnchor: "doctor slumps alone at desk",
      },
    },
    {
      cutNumber: 3,
      durationSec: 8,
      sceneDescription: "의사 손 클로즈업",
      cameraDirection: "close-up",
      moodLighting: "warm desk lamp light from upper-left casting long shadows",
      imagePrompt: "",
      endImagePrompt: "",
      videoPrompt: "CU shot...",
      extendPrompt: "",
      transitionHint: "디졸브",
      characterConsistency: "Dr. Kim",
      charactersInScene: ["Dr. Kim"],
      shotCategory: "character-driven",
      characterRole: "protagonist",
      videoPromptJson: {
        shotSize: "CU",
        cameraAngle: "high-angle",
        cameraMovement: "locked (stillness emphasizes trembling)",
        subjectBlocking: "hands center-frame, desk surface visible",
        subjectAction: "fingers slowly curl inward, gripping the edge of a patient chart",
        actionBeat: "grip tightens — releases — hand retreats to lap",
        bodySignal: "subtle tremor in fingertips, knuckles whitening momentarily",
        revealed: "wedding ring on left hand",
        withheld: "face expression",
        timingBeat: "0s-3s: hands rest on chart. 3s-6s: grip tightens. 6s-8s: hand retreats",
        transitionFromPrev: "from medium body to hand detail — emotional zoom",
        characterRef: "Dr. Kim's hands — same lab coat cuffs visible",
        moodLighting: "warm desk lamp light from upper-left casting long shadows across paper",
        styleSuffix: "cinematic realism, 16:9, no readable text, watermark, or onscreen UI",
        locationCue: "desk surface with scattered patient charts",
        situationCue: "late-night paperwork, half-finished notes",
        emotionalAnchor: "trembling hand grips chart edge",
      },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════
// 테스트 시작
// ═══════════════════════════════════════════════════════════════════

console.log("🎬 시퀀스 플랜 아키텍처 테스트\n");

// ─── 1. Cut[] → SequencePlan 변환 ────────────────────────────────

section("1. Cut[] → SequencePlan 변환");

const cuts = makeTestCuts();
const plan = buildSequencePlan(cuts, {
  styleId: "cinematic-realism",
  aspectRatio: "16:9",
  directorId: "test-director",
});

assert(plan.sequenceId.startsWith("seq_"), "sequenceId 형식");
assert(plan.shots.length === 3, "shot 수 = cut 수");
assert(plan.globalIntent.durationSec === 24, "전체 길이 = 8+8+8 = 24s");
assert(plan.globalIntent.styleId === "cinematic-realism", "스타일 ID 전달");
assert(plan.globalIntent.aspectRatio === "16:9", "화면비 전달");

// 시간 배치 확인
assert(plan.shots[0].startSec === 0, "shot_1 시작 = 0s");
assert(plan.shots[0].endSec === 8, "shot_1 종료 = 8s");
assert(plan.shots[1].startSec === 8, "shot_2 시작 = 8s");
assert(plan.shots[1].endSec === 16, "shot_2 종료 = 16s");
assert(plan.shots[2].startSec === 16, "shot_3 시작 = 16s");
assert(plan.shots[2].endSec === 24, "shot_3 종료 = 24s");

// 카메라 정보 구조화
assert(plan.shots[0].camera.framing === "WS", "shot_1 framing = WS");
assert(plan.shots[1].camera.framing === "MS", "shot_2 framing = MS");
assert(plan.shots[2].camera.framing === "CU", "shot_3 framing = CU");
assert(plan.shots[0].camera.angle === "eye_level", "shot_1 angle = eye_level");
assert(plan.shots[2].camera.angle === "high_angle", "shot_3 angle = high_angle");
assert(plan.shots[0].camera.motion.includes("slow pan"), "shot_1 motion = slow pan");
assert(plan.shots[1].camera.motionMotivation?.includes("tension"), "shot_2 motion motivation 포함");

// 피사체 분리
assert(plan.shots[1].subject.characterRef?.includes("Dr. Kim"), "shot_2 characterRef 보존");
assert(plan.shots[0].subject.characterRef === undefined || plan.shots[0].subject.characterRef === "", "shot_1 캐릭터 없음");

// 연속성 추출
assert(plan.continuity.primarySubject.length > 0, "primarySubject 추출됨");
assert(plan.continuity.environment.length > 0, "environment 추출됨");
assert(plan.continuity.lightingDirection.length > 0, "lighting 추출됨");

// cutToShotMap
assert(plan.cutToShotMap?.[1]?.includes("shot_1") === true, "cutToShotMap[1] = shot_1");
assert(plan.cutToShotMap?.[3]?.includes("shot_3") === true, "cutToShotMap[3] = shot_3");

console.log(`  ✓ ${passed} assertions passed`);

// ─── 2. SequencePlan JSON Validation ─────────────────────────────

section("2. JSON Validation (10 규칙)");

const prevPassed = passed;

// 정상 plan → 에러 없어야 함
const validResult = validateSequencePlan(plan);
assert(validResult.valid === true, "정상 plan은 valid");
assert(validResult.summary.errors === 0, "정상 plan에 error 없음");

// Rule 1: timing total mismatch
const badTimingPlan: SequencePlan = {
  ...plan,
  globalIntent: { ...plan.globalIntent, durationSec: 30 }, // 실제는 24s
};
const r1 = validateSequencePlan(badTimingPlan);
assert(r1.issues.some(i => i.rule === "timing_total"), "Rule 1: timing 불일치 감지");

// Rule 2: overlap
const overlapPlan: SequencePlan = {
  ...plan,
  shots: plan.shots.map((s, i) => i === 1 ? { ...s, startSec: 5 } : s), // shot_2가 shot_1과 겹침
};
const r2 = validateSequencePlan(overlapPlan);
assert(r2.issues.some(i => i.rule === "timing_overlap"), "Rule 2: shot 겹침 감지");

// Rule 3: subject 없음
const noSubjectPlan: SequencePlan = {
  ...plan,
  shots: plan.shots.map((s, i) => i === 0 ? { ...s, subject: { ...s.subject, primary: "" } } : s),
};
const r3 = validateSequencePlan(noSubjectPlan);
assert(r3.issues.some(i => i.rule === "subject_missing"), "Rule 3: subject 없음 감지");

// Rule 4: camera 없음
const noCameraPlan: SequencePlan = {
  ...plan,
  shots: plan.shots.map((s, i) => i === 0 ? { ...s, camera: { ...s.camera, framing: "" as never } } : s),
};
const r4 = validateSequencePlan(noCameraPlan);
assert(r4.issues.some(i => i.rule === "camera_missing"), "Rule 4: camera 없음 감지");

// Rule 6: negative 누락
const noNegPlan: SequencePlan = {
  ...plan,
  shots: plan.shots.map(s => ({ ...s, negativeDirectives: [] })),
};
const r6 = validateSequencePlan(noNegPlan);
assert(r6.issues.some(i => i.rule === "negative_missing"), "Rule 6: negative 누락 경고");

// Rule 7: 급격한 전환 (WS → ECU)
const abruptPlan: SequencePlan = {
  ...plan,
  shots: plan.shots.map((s, i) => i === 1 ? { ...s, camera: { ...s.camera, framing: "ECU" as const } } : s),
};
const r7 = validateSequencePlan(abruptPlan);
assert(r7.issues.some(i => i.rule === "abrupt_transition"), "Rule 7: 급격한 전환 경고");

// Rule 8: 군중 + CU 위험
const crowdCU: SequencePlan = {
  ...plan,
  shots: [{ ...plan.shots[0], subject: { ...plan.shots[0].subject, primary: "large crowd gathered" }, camera: { ...plan.shots[0].camera, framing: "CU" as const } }],
  globalIntent: { ...plan.globalIntent, durationSec: 8 },
};
const r8 = validateSequencePlan(crowdCU);
assert(r8.issues.some(i => i.rule === "risky_combination"), "Rule 8: 군중+CU 위험 감지");

// Rule 10: payload 필드 누락
const missingFieldsPlan: SequencePlan = {
  ...plan,
  shots: plan.shots.map((s, i) => i === 0 ? { ...s, moodLighting: "", action: "" } : s),
};
const r10 = validateSequencePlan(missingFieldsPlan);
assert(r10.issues.some(i => i.rule === "payload_field_missing"), "Rule 10: payload 필드 누락 감지");

console.log(`  ✓ ${passed - prevPassed} validation assertions passed`);

// ─── 3. Provider Prompt 직렬화 ────────────────────────────────────

section("3. Provider Prompt 직렬화");

const prevPassed3 = passed;

const serialized = serializeSequencePlan(plan, "veo");

// shot별 프롬프트 생성
assert(serialized.shotPrompts.length === 3, "3개 shot prompt 생성");
assert(serialized.shotPrompts[0].shotId === "shot_1", "첫 shot ID 정확");

// shot prompt에 카메라 정보 포함
assert(serialized.shotPrompts[0].prompt.includes("WS shot"), "shot_1 prompt에 WS 포함");
assert(serialized.shotPrompts[1].prompt.includes("MS shot"), "shot_2 prompt에 MS 포함");
assert(serialized.shotPrompts[2].prompt.includes("CU shot"), "shot_3 prompt에 CU 포함");

// shot prompt에 action 포함
assert(serialized.shotPrompts[1].prompt.includes("slumps"), "shot_2 prompt에 action 포함");

// continuity prompt
assert(serialized.continuityPrompt.includes("[CONTINUITY]"), "continuity 블록 포함");
assert(serialized.continuityPrompt.includes("Primary subject:"), "primary subject 포함");

// flattened prompt — shot 경계 유지
assert(serialized.flattenedPrompt.includes("[SHOT 1"), "flattened에 SHOT 1 경계");
assert(serialized.flattenedPrompt.includes("[SHOT 2"), "flattened에 SHOT 2 경계");
assert(serialized.flattenedPrompt.includes("[SHOT 3"), "flattened에 SHOT 3 경계");
assert(serialized.flattenedPrompt.includes("0.0-8.0s"), "shot_1 시간 범위");
assert(serialized.flattenedPrompt.includes("8.0-16.0s"), "shot_2 시간 범위");
assert(serialized.flattenedPrompt.includes("camera:"), "camera 필드 직렬화");
assert(serialized.flattenedPrompt.includes("subject:"), "subject 필드 직렬화");
assert(serialized.flattenedPrompt.includes("action:"), "action 필드 직렬화");

// serialization 로그
assert(serialized.logs.length === 3, "3개 shot의 로그");
assert(serialized.logs[0].includedFields.includes("camera.framing"), "framing 포함 로그");
assert(serialized.logs[0].includedFields.includes("camera.angle"), "angle 포함 로그");

// Kling 직렬화 — motivation 제거
const klingSerial = serializeSequencePlan(plan, "kling");
const shot2Prompt = klingSerial.shotPrompts[1].prompt;
assert(!shot2Prompt.includes("(tension"), "Kling: motivation 괄호 제거");

// global negative
assert(serialized.globalNegative.length > 0, "global negative 생성");

console.log(`  ✓ ${passed - prevPassed3} serialization assertions passed`);

// ─── 4. Fidelity Evaluation ──────────────────────────────────────

section("4. Fidelity Evaluation");

const prevPassed4 = passed;

// 성공 시나리오
const successResults = plan.shots.map(s => ({
  shotId: s.shotId,
  generated: true,
  engineUsed: "veo" as const,
  finalPrompt: serialized.shotPrompts.find(sp => sp.shotId === s.shotId)!.prompt,
  verification: { overallScore: 85, issues: [] as string[] },
}));

const fidelity = evaluateSequenceFidelity(plan, serialized, successResults);
assert(fidelity.shotCountMatch === true, "shot 수 일치");
assert(fidelity.overallScore > 50, "전체 점수 > 50");
assert(fidelity.continuityPreservation > 0, "연속성 보존 점수 > 0");
assert(fidelity.failureDiagnosis.primaryCause !== "authoring", "authoring failure 아님");

// 실패 시나리오 — generation failure
const failResults = plan.shots.map((s, i) => ({
  shotId: s.shotId,
  generated: i !== 2, // shot_3 실패
  engineUsed: "veo" as const,
  finalPrompt: i !== 2 ? serialized.shotPrompts.find(sp => sp.shotId === s.shotId)!.prompt : "",
  verification: i !== 2 ? { overallScore: 80, issues: [] as string[] } : { overallScore: 0, issues: ["generation failed"] },
}));

const failFidelity = evaluateSequenceFidelity(plan, serialized, failResults);
assert(failFidelity.shotScores[2].promptAdherence === 0, "실패 shot 점수 = 0");
assert(failFidelity.failureDiagnosis.generationIssues.length > 0, "generation failure 감지");
assert(failFidelity.failureDiagnosis.primaryCause === "generation", "primary cause = generation");

// authoring failure 시나리오
const badPlan: SequencePlan = {
  ...plan,
  globalIntent: { ...plan.globalIntent, durationSec: 50 }, // 잘못된 duration
  shots: plan.shots.map(s => ({ ...s, subject: { ...s.subject, primary: "" } })),
};
const badSerial = serializeSequencePlan(badPlan);
const authFidelity = evaluateSequenceFidelity(badPlan, badSerial, successResults);
assert(authFidelity.failureDiagnosis.authoringIssues.length > 0, "authoring issues 감지");
assert(authFidelity.failureDiagnosis.primaryCause === "authoring", "primary cause = authoring");

console.log(`  ✓ ${passed - prevPassed4} fidelity assertions passed`);

// ─── 5. ShotPlan ↔ VideoPromptJson 양방향 변환 ──────────────────

section("5. ShotPlan ↔ VideoPromptJson 변환");

const prevPassed5 = passed;

// ShotPlan → VideoPromptJson
const shot2 = plan.shots[1];
const vpJson = shotPlanToVideoPromptJson(shot2, "cinematic realism, 16:9");
assert(vpJson.shotSize === "MS", "ShotPlan→VPJ: shotSize");
assert(vpJson.cameraAngle === "eye-level", "ShotPlan→VPJ: cameraAngle");
assert(vpJson.cameraMovement.includes("push-in"), "ShotPlan→VPJ: cameraMovement");
assert(vpJson.characterRef?.includes("Dr. Kim"), "ShotPlan→VPJ: characterRef");
assert(vpJson.moodLighting.includes("desk lamp"), "ShotPlan→VPJ: moodLighting");

// VideoPromptJson → ShotPlan
const originalJson = cuts[1].videoPromptJson!;
const reconstructed = videoPromptJsonToShotPlan(originalJson, 1, 8, 8);
assert(reconstructed.shotId === "shot_2", "VPJ→ShotPlan: shotId");
assert(reconstructed.camera.framing === "MS", "VPJ→ShotPlan: framing");
assert(reconstructed.startSec === 8, "VPJ→ShotPlan: startSec");
assert(reconstructed.endSec === 16, "VPJ→ShotPlan: endSec");
assert(reconstructed.action.includes("slumps"), "VPJ→ShotPlan: action 보존");

// 라운드트립: ShotPlan → VPJ → ShotPlan
const roundTrip = videoPromptJsonToShotPlan(vpJson, 1, 8, 8);
assert(roundTrip.camera.framing === shot2.camera.framing, "라운드트립: framing 일치");
assert(roundTrip.camera.motion.includes("push-in"), "라운드트립: motion 보존");

console.log(`  ✓ ${passed - prevPassed5} conversion assertions passed`);

// ─── 6. Edge Cases ──────────────────────────────────────────────

section("6. Edge Cases");

const prevPassed6 = passed;

// 빈 Cut[] → 빈 SequencePlan
const emptyPlan = buildSequencePlan([]);
assert(emptyPlan.shots.length === 0, "빈 Cut[] → 빈 shots");
assert(emptyPlan.globalIntent.durationSec === 0, "빈 plan duration = 0");

// VideoPromptJson 없는 레거시 Cut
const legacyCut: Cut = {
  cutNumber: 1,
  durationSec: 6,
  sceneDescription: "A wide view of a marketplace",
  cameraDirection: "slow pan",
  moodLighting: "natural daylight",
  imagePrompt: "",
  endImagePrompt: "",
  videoPrompt: "Wide shot of a marketplace...",
  extendPrompt: "",
  transitionHint: "",
  characterConsistency: "",
  charactersInScene: [],
};
const legacyPlan = buildSequencePlan([legacyCut]);
assert(legacyPlan.shots.length === 1, "레거시 cut 변환됨");
assert(legacyPlan.shots[0].camera.framing === "MS", "레거시 cut default framing = MS");
assert(legacyPlan.shots[0].camera.motion.includes("pan"), "레거시 cut camera direction 보존");

// 단일 shot plan validation
const singleValidation = validateSequencePlan(legacyPlan);
assert(singleValidation.summary.errors === 0 || singleValidation.issues.every(i => i.severity !== "error" || i.rule === "subject_missing"), "단일 shot 기본 검증 통과 또는 예상 에러만");

console.log(`  ✓ ${passed - prevPassed6} edge case assertions passed`);

// ─── 7. Serialization 정보 손실 추적 ────────────────────────────

section("7. Serialization 정보 손실 추적");

const prevPassed7 = passed;

// 모든 필드가 채워진 shot → 드롭 없어야 함
const fullShot = plan.shots[1]; // Dr. Kim shot은 모든 필드 있음
const fullLog = serialized.logs.find(l => l.shotId === "shot_2")!;
assert(fullLog.droppedFields.length === 0 || fullLog.droppedFields.every(f => f.includes("static") || f.includes("empty")), "완전한 shot: 실질적 드롭 없음");
assert(fullLog.includedFields.includes("characterRef"), "characterRef 포함됨");
assert(fullLog.includedFields.includes("action"), "action 포함됨");
assert(fullLog.includedFields.includes("moodLighting"), "moodLighting 포함됨");

// moodLighting 없는 shot → 드롭 로그
const noLightPlan: SequencePlan = {
  ...plan,
  shots: [{ ...plan.shots[0], moodLighting: "" }],
  globalIntent: { ...plan.globalIntent, durationSec: 8 },
};
const noLightSerial = serializeSequencePlan(noLightPlan);
const noLightLog = noLightSerial.logs[0];
assert(noLightLog.droppedFields.some(f => f.includes("moodLighting")), "moodLighting 드롭 로그");

console.log(`  ✓ ${passed - prevPassed7} loss tracking assertions passed`);

// ─── 8. Global style/medium 필드 ────────────────────────────────

section("8. Global style/medium 필드");

const prevPassed8 = passed;

const planWithMedium = buildSequencePlan(cuts, {
  styleId: "cinematic-realism",
  style: "cinematic realism",
  medium: "physical relief map surface",
  aspectRatio: "16:9",
});
assert(planWithMedium.globalIntent.style === "cinematic realism", "globalIntent.style 전달됨");
assert(planWithMedium.globalIntent.medium === "physical relief map surface", "globalIntent.medium 전달됨");

// Serialized output에 medium 포함
const serializedMedium = serializeSequencePlan(planWithMedium);
assert(serializedMedium.globalPrompt.includes("physical relief map surface"), "globalPrompt에 medium 포함");
assert(serializedMedium.globalPrompt.includes("cinematic realism"), "globalPrompt에 style 포함");
assert(serializedMedium.globalPrompt.includes("[GLOBAL]"), "globalPrompt에 [GLOBAL] 섹션");

console.log(`  ✓ ${passed - prevPassed8} style/medium assertions passed`);

// ─── 9. 3D/CGI negative 자동 주입 ──────────────────────────────

section("9. 3D/CGI negative 자동 주입 (map-graphic)");

const prevPassed9 = passed;

// map-graphic shot → 3D/CGI negative 자동 포함
const mapCut: Cut = {
  cutNumber: 1,
  durationSec: 8,
  sceneDescription: "유라시아 지형도에서 빨간 영역이 확산",
  cameraDirection: "overhead slow push",
  moodLighting: "cool diffused daylight from above",
  imagePrompt: "",
  endImagePrompt: "",
  videoPrompt: "overhead view of a 3D topographic map of Eurasia",
  extendPrompt: "",
  transitionHint: "",
  characterConsistency: "",
  charactersInScene: [],
  shotCategory: "map-graphic",
  videoPromptJson: {
    shotSize: "WS",
    cameraAngle: "overhead",
    cameraMovement: "slow push-in",
    subjectBlocking: "map fills frame",
    subjectAction: "crimson glow expands from Mongolian steppe region",
    actionBeat: "red area spreads outward",
    bodySignal: "",
    revealed: "expanding territory",
    withheld: "",
    timingBeat: "0s-4s: glow begins. 4s-8s: spreads across steppe",
    transitionFromPrev: "",
    characterRef: "",
    moodLighting: "cool diffused daylight from above",
    styleSuffix: "cinematic realism, 16:9, no readable text, no watermark",
    locationCue: "physical relief map of Eurasia",
    situationCue: "crimson territory expansion",
    emotionalAnchor: "",
  },
};

const mapPlan = buildSequencePlan([mapCut], { styleId: "cinematic-realism" });
const mapShot = mapPlan.shots[0];

// map-graphic 카테고리 → 3D/CGI negative 자동 주입
assert(mapShot.negativeDirectives.some(n => n.includes("CGI")), "map-graphic shot: CGI negative 존재");
assert(mapShot.negativeDirectives.some(n => n.includes("3D")), "map-graphic shot: 3D negative 존재");
assert(mapShot.negativeDirectives.some(n => n.includes("diorama")), "map-graphic shot: diorama negative 존재");
assert(mapShot.negativeDirectives.some(n => n.includes("game-map")), "map-graphic shot: game-map negative 존재");

// serialized에도 반영
const mapSerial = serializeSequencePlan(mapPlan);
assert(mapSerial.globalNegative.includes("CGI"), "global negative에 CGI 포함");

console.log(`  ✓ ${passed - prevPassed9} 3D/CGI negative assertions passed`);

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

console.log("\n🎬 모든 테스트 통과!");
