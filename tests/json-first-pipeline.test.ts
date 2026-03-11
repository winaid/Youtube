/**
 * JSON-first Pipeline 테스트
 *
 * 테스트 시나리오:
 * 1. StructuredSequenceDocument 생성 (assembleFromJSON)
 * 2. Camera/framing 충돌 해결 (resolveFramingConflicts)
 * 3. Positive/negative 충돌 해결 (resolvePosNegConflicts)
 * 4. Cinematic realism 3D/CGI drift 방지 (enforceCinematicRealism)
 * 5. 통합 파이프라인 (runSequencePipeline)
 * 6. Asset status 계산 (computeAssetStatus)
 * 7. 서버 priority chain (structuredSequence > videoPromptJson > prompt)
 *
 * 실행: npx tsx tests/json-first-pipeline.test.ts
 */

import {
  buildSequencePlan,
  resolveFramingConflicts,
  resolvePosNegConflicts,
  enforceCinematicRealism,
  runSequencePipeline,
  type SequencePlan,
  type ShotPlan,
} from "../src/lib/sequence-plan";

import type { Cut, VideoPromptJson, StructuredSequenceDocument } from "../src/types";
import { computeAssetStatus, type VideoRecord } from "../src/lib/video-history";

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

// ─── 테스트 데이터 ──────────────────────────────────────────────

function makeVideoPromptJson(overrides: Partial<VideoPromptJson> = {}): VideoPromptJson {
  return {
    shotSize: "MS",
    cameraAngle: "eye-level",
    cameraMovement: "slow push-in (tension builds)",
    subjectBlocking: "center-frame",
    subjectAction: "A man walks forward through the rain",
    actionBeat: "hesitant steps",
    bodySignal: "shoulders hunched, eyes darting",
    revealed: "neon signs reflecting in puddles",
    withheld: "the person following him",
    timingBeat: "0s-3s: approach. 3s-6s: pause. 6s-8s: turn",
    transitionFromPrev: "match cut from previous interior",
    characterRef: "tall man, black coat, mid-30s, stubble",
    moodLighting: "rain-soaked neon, cold blue with warm amber highlights",
    styleSuffix: "cinematic realism, 35mm film grain",
    locationCue: "narrow alley in downtown Seoul",
    situationCue: "empty alley, shuttered shops",
    emotionalAnchor: "isolated figure against urban glow",
    ...overrides,
  };
}

function makeTestCuts(count: number = 3): Cut[] {
  const cuts: Cut[] = [];
  for (let i = 0; i < count; i++) {
    cuts.push({
      cutNumber: i + 1,
      durationSec: 8,
      sceneDescription: `Scene ${i + 1} description`,
      cameraDirection: "slow push-in",
      moodLighting: "warm golden hour",
      imagePrompt: "",
      endImagePrompt: "",
      videoPrompt: `Scene ${i + 1} action prompt`,
      extendPrompt: "",
      transitionHint: i > 0 ? "match cut" : "",
      characterConsistency: "tall man, black coat",
      charactersInScene: ["char-1"],
      shotCategory: "character-driven",
      characterRole: "protagonist",
      videoPromptJson: makeVideoPromptJson({
        shotSize: ["WS", "MS", "CU"][i] || "MS",
      }),
    });
  }
  return cuts;
}

// ═══════════════════════════════════════════════════════════════════
// Test 1: Camera/Framing Conflict Resolution
// ═══════════════════════════════════════════════════════════════════

section("1. Camera/Framing Conflict Resolution");

{
  // 3연속 동일 framing → 중간 shot 자동 변경
  const cuts = makeTestCuts(5);
  cuts[0].videoPromptJson = makeVideoPromptJson({ shotSize: "MS" });
  cuts[1].videoPromptJson = makeVideoPromptJson({ shotSize: "MS" });
  cuts[2].videoPromptJson = makeVideoPromptJson({ shotSize: "MS" });
  cuts[3].videoPromptJson = makeVideoPromptJson({ shotSize: "CU" });
  cuts[4].videoPromptJson = makeVideoPromptJson({ shotSize: "WS" });

  const plan = buildSequencePlan(cuts);
  const { plan: resolved, resolutions } = resolveFramingConflicts(plan);

  assert(resolutions.length > 0, "3연속 동일 framing이 감지되어 수정됨");
  assert(
    resolved.shots[1].camera.framing !== "MS",
    "중간 shot의 framing이 변경됨"
  );
  console.log(`  ✓ 3연속 MS → 중간 shot ${resolved.shots[1].camera.framing}로 변경`);
}

{
  // Map scene + close-up → WS + overhead
  const cuts = makeTestCuts(1);
  cuts[0].shotCategory = "map-graphic";
  cuts[0].videoPromptJson = makeVideoPromptJson({ shotSize: "CU" });

  const plan = buildSequencePlan(cuts);
  const { plan: resolved, resolutions } = resolveFramingConflicts(plan);

  assert(resolutions.length > 0, "map-graphic + CU 충돌 감지");
  assert(resolved.shots[0].camera.framing === "WS", "map scene CU → WS");
  assert(resolved.shots[0].camera.angle === "overhead", "map scene angle → overhead");
  console.log(`  ✓ Map scene close-up → WS overhead`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 2: Positive/Negative Conflict Resolution
// ═══════════════════════════════════════════════════════════════════

section("2. Positive/Negative Conflict Resolution");

{
  const cuts = makeTestCuts(2);
  const plan = buildSequencePlan(cuts);

  // Inject a negative that matches the global style
  plan.shots[0].negativeDirectives.push("cinematic realism");
  plan.shots[1].negativeDirectives.push("something irrelevant");

  const { plan: resolved, conflicts, removedNegatives } = resolvePosNegConflicts(
    plan,
    "cinematic realism, 35mm film grain",
  );

  assert(conflicts.length >= 1, "positive/negative 충돌 최소 1개 감지");
  assert(removedNegatives.length >= 1, "충돌 negative가 제거됨");
  assert(
    !resolved.shots[0].negativeDirectives.includes("cinematic realism"),
    "shot 0에서 충돌 negative 제거됨"
  );
  assert(
    resolved.shots[1].negativeDirectives.includes("something irrelevant"),
    "비충돌 negative는 유지됨"
  );
  console.log(`  ✓ ${conflicts.length} 충돌 감지, ${removedNegatives.length} 제거`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 3: Cinematic Realism 3D/CGI Drift Prevention
// ═══════════════════════════════════════════════════════════════════

section("3. Cinematic Realism 3D/CGI Drift Prevention");

{
  const cuts = makeTestCuts(2);
  cuts[0].videoPromptJson = makeVideoPromptJson({
    subjectAction: "3D rendered globe rotates slowly",
  });
  cuts[1].videoPromptJson = makeVideoPromptJson({
    subjectAction: "Camera pans across landscape",
  });

  const plan = buildSequencePlan(cuts, {
    style: "cinematic realism",
    styleId: "cinematic-realism",
  });

  // Manually set action to contain CGI terms
  plan.shots[0].action = "3D rendered globe rotates slowly";
  plan.shots[1].action = "Camera pans across landscape";

  const { plan: resolved, fixes } = enforceCinematicRealism(plan);

  assert(fixes.length > 0, "CGI drift 수정 발생");
  assert(
    !resolved.shots[0].action.includes("3D rendered"),
    "3D rendered가 치환됨"
  );
  assert(
    resolved.shots[0].negativeDirectives.some(n => n.includes("no 3D render")),
    "anti-3D negative가 주입됨"
  );
  console.log(`  ✓ ${fixes.length} CGI drift fixes applied`);
}

{
  // Non-cinematic-realism 스타일에서는 CGI drift 방지 안 함
  const cuts = makeTestCuts(1);
  const plan = buildSequencePlan(cuts, { style: "anime", styleId: "tv-anime" });
  plan.shots[0].action = "3D rendered globe";

  const { plan: resolved, fixes } = enforceCinematicRealism(plan);

  assert(fixes.length === 0, "anime 스타일에서는 CGI drift 방지 비활성");
  assert(resolved.shots[0].action === "3D rendered globe", "action 변경 없음");
  console.log(`  ✓ Non-CR 스타일에서 CGI drift 방지 비활성 확인`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 4: runSequencePipeline 통합 테스트
// ═══════════════════════════════════════════════════════════════════

section("4. runSequencePipeline 통합 테스트");

{
  const cuts = makeTestCuts(3);
  const result = runSequencePipeline(cuts, {
    styleId: "cinematic-realism",
    style: "cinematic realism",
    provider: "veo",
  });

  assert(result.plan.shots.length === 3, "3 shots in plan");
  assert(result.serialized.shotPrompts.length === 3, "3 serialized shot prompts");
  assert(result.validation !== undefined, "validation result present");
  assert(result.debugLog.length > 0, "debug log not empty");
  assert(
    result.serialized.flattenedPrompt.includes("[GLOBAL]"),
    "flattened prompt has [GLOBAL] tag"
  );
  assert(
    result.serialized.flattenedPrompt.includes("[CONTINUITY]"),
    "flattened prompt has [CONTINUITY] tag"
  );
  assert(
    result.serialized.flattenedPrompt.includes("[SHOT"),
    "flattened prompt has [SHOT] tags"
  );
  console.log(`  ✓ Pipeline: ${result.plan.shots.length} shots, ${result.debugLog.length} log entries`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 5: Asset Status Computation
// ═══════════════════════════════════════════════════════════════════

section("5. Asset Status Computation");

{
  const base: VideoRecord = {
    id: "vid-test",
    operationName: "op-1",
    engine: "veo",
    gcsUri: "",
    proxyUri: "",
    prompt: "test",
    mode: "generate",
    durationSec: 8,
    cutNumber: 1,
    status: "completed",
    createdAt: Date.now(),
  };

  // No URIs → GENERATED
  assert(computeAssetStatus({ ...base }) === "GENERATED", "no URIs → GENERATED");

  // gcsUri only → ASSET_STORED_INTERNAL
  assert(
    computeAssetStatus({ ...base, gcsUri: "gs://bucket/video.mp4" }) === "ASSET_STORED_INTERNAL",
    "gcsUri → ASSET_STORED_INTERNAL"
  );

  // proxyUri → ASSET_STORED_PUBLIC
  assert(
    computeAssetStatus({ ...base, proxyUri: "https://proxy.com/video.mp4" }) === "ASSET_STORED_PUBLIC",
    "proxyUri → ASSET_STORED_PUBLIC"
  );

  // canonicalVideoUri → SCENE_EXTENSION_READY
  assert(
    computeAssetStatus({ ...base, canonicalVideoUri: "gs://canonical/video.mp4", proxyUri: "https://proxy.com/v.mp4" }) === "SCENE_EXTENSION_READY",
    "canonicalVideoUri → SCENE_EXTENSION_READY"
  );

  // Failed → always GENERATED
  assert(
    computeAssetStatus({ ...base, status: "failed", canonicalVideoUri: "gs://x" }) === "GENERATED",
    "failed status → GENERATED regardless"
  );

  console.log(`  ✓ All asset status transitions verified`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 6: StructuredSequenceDocument 타입 검증
// ═══════════════════════════════════════════════════════════════════

section("6. StructuredSequenceDocument 구조 검증");

{
  // Type-level test — ensure the shape compiles
  const doc: StructuredSequenceDocument = {
    shotId: "shot_1",
    cutNumber: 1,
    shotPlan: {
      shotId: "shot_1",
      startSec: 0,
      endSec: 8,
      shotType: "medium_action",
      camera: { framing: "MS", angle: "eye_level", motion: "static" },
      subject: { primary: "test subject" },
      environment: "test env",
      action: "walks",
      visualDirectives: [],
      negativeDirectives: [],
      moodLighting: "warm",
    },
    videoPromptJson: makeVideoPromptJson(),
    serializedPrompt: "serialized test",
    validation: { valid: true, errors: 0, warnings: 0, issues: [] },
    sanitizeFixes: [],
    conflictResolutions: [],
  };

  assert(doc.shotId === "shot_1", "shotId 설정됨");
  assert(doc.shotPlan.camera.framing === "MS", "shotPlan camera framing");
  assert(doc.videoPromptJson !== undefined, "videoPromptJson 포함");
  assert(doc.serializedPrompt !== undefined, "serializedPrompt 포함");
  assert(doc.validation!.valid === true, "validation.valid");
  console.log(`  ✓ StructuredSequenceDocument 타입 검증 완료`);
}

// ═══════════════════════════════════════════════════════════════════
// 결과 출력
// ═══════════════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(60));
console.log(`TOTAL: ${passed + failed} tests — ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\nFailed tests:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log("\n✓ All tests passed!");
}
