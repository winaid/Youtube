/**
 * JSON-first Pipeline 테스트
 *
 * 테스트 시나리오:
 * 1. Camera/framing 충돌 해결 (resolveFramingConflicts)
 * 2. Positive/negative 충돌 해결 (resolvePosNegConflicts)
 * 3. Cinematic realism 3D/CGI drift 방지 (enforceCinematicRealism)
 * 4. 통합 파이프라인 (runSequencePipeline)
 * 5. Asset status 계산 (computeAssetStatus)
 * 6. StructuredSequenceDocument에 serializedPrompt 없음
 * 7. assembleFromJSON()이 prompt를 1급 반환하지 않음
 * 8. renderSequenceForProvider가 마지막 직렬화 지점
 * 9. Legacy compatibility: structuredSequence 없으면 fallback
 * 10. preview.renderedPrompt는 source of truth 아님
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

import {
  assembleFromJSON,
  renderSequenceForProvider,
  PROVIDER_CAPABILITIES,
  type AssembleFromJSONResult,
} from "../src/lib/sequence-assembler";

import type { Cut, VideoPromptJson, StructuredSequenceDocument, VeoGenerationConfig } from "../src/types";
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

function makeTestConfig(): VeoGenerationConfig {
  return {
    engine: "veo",
    videoMode: "extend",
    mode: "fast",
    durationSeconds: 8,
    resolution: "720p",
    aspectRatio: "16:9",
    generateAudio: true,
    negativePrompt: "text overlay, watermark",
    personGeneration: "allow_all",
    sampleCount: 1,
    referenceImages: [],
    styleIntensity: 50,
    autoLinkFirstFrame: true,
    autoRetryOnFailure: true,
    maxRetryCount: 2,
    autoVerifyPrompts: false,
    autoEnglishRefine: false,
    animationMode: "cinematic-realism",
    cinematography: { lighting: [], composition: [], lens: [], cameraMove: [], countryStyle: [], colorGrade: [] },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Test 1: Camera/Framing Conflict Resolution
// ═══════════════════════════════════════════════════════════════════

section("1. Camera/Framing Conflict Resolution");

{
  const cuts = makeTestCuts(5);
  cuts[0].videoPromptJson = makeVideoPromptJson({ shotSize: "MS" });
  cuts[1].videoPromptJson = makeVideoPromptJson({ shotSize: "MS" });
  cuts[2].videoPromptJson = makeVideoPromptJson({ shotSize: "MS" });
  cuts[3].videoPromptJson = makeVideoPromptJson({ shotSize: "CU" });
  cuts[4].videoPromptJson = makeVideoPromptJson({ shotSize: "WS" });

  const plan = buildSequencePlan(cuts);
  const { plan: resolved, resolutions } = resolveFramingConflicts(plan);

  assert(resolutions.length > 0, "3연속 동일 framing 감지 수정");
  assert(resolved.shots[1].camera.framing !== "MS", "중간 shot framing 변경");
  console.log(`  ✓ 3연속 MS → 중간 shot ${resolved.shots[1].camera.framing}로 변경`);
}

{
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
  plan.shots[0].negativeDirectives.push("cinematic realism");
  plan.shots[1].negativeDirectives.push("something irrelevant");

  const { plan: resolved, conflicts, removedNegatives } = resolvePosNegConflicts(
    plan, "cinematic realism, 35mm film grain",
  );

  assert(conflicts.length >= 1, "positive/negative 충돌 감지");
  assert(removedNegatives.length >= 1, "충돌 negative 제거");
  assert(!resolved.shots[0].negativeDirectives.includes("cinematic realism"), "충돌 negative 제거됨");
  assert(resolved.shots[1].negativeDirectives.includes("something irrelevant"), "비충돌 negative 유지");
  console.log(`  ✓ ${conflicts.length} 충돌 감지, ${removedNegatives.length} 제거`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 3: Cinematic Realism 3D/CGI Drift Prevention
// ═══════════════════════════════════════════════════════════════════

section("3. Cinematic Realism 3D/CGI Drift Prevention");

{
  const cuts = makeTestCuts(2);
  const plan = buildSequencePlan(cuts, { style: "cinematic realism", styleId: "cinematic-realism" });
  plan.shots[0].action = "3D rendered globe rotates slowly";
  plan.shots[1].action = "Camera pans across landscape";

  const { plan: resolved, fixes } = enforceCinematicRealism(plan);

  assert(fixes.length > 0, "CGI drift 수정 발생");
  assert(!resolved.shots[0].action.includes("3D rendered"), "3D rendered 치환됨");
  assert(resolved.shots[0].negativeDirectives.some(n => n.includes("no 3D render")), "anti-3D negative 주입");
  console.log(`  ✓ ${fixes.length} CGI drift fixes`);
}

{
  const cuts = makeTestCuts(1);
  const plan = buildSequencePlan(cuts, { style: "anime", styleId: "tv-anime" });
  plan.shots[0].action = "3D rendered globe";

  const { fixes } = enforceCinematicRealism(plan);
  assert(fixes.length === 0, "anime에서 CGI drift 방지 비활성");
  console.log(`  ✓ Non-CR 스타일 비활성 확인`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 4: runSequencePipeline 통합 테스트
// ═══════════════════════════════════════════════════════════════════

section("4. runSequencePipeline 통합 테스트");

{
  const cuts = makeTestCuts(3);
  const result = runSequencePipeline(cuts, {
    styleId: "cinematic-realism", style: "cinematic realism", provider: "veo",
  });

  assert(result.plan.shots.length === 3, "3 shots in plan");
  assert(result.serialized.shotPrompts.length === 3, "3 serialized shot prompts");
  assert(result.serialized.flattenedPrompt.includes("[GLOBAL]"), "[GLOBAL] tag present");
  assert(result.serialized.flattenedPrompt.includes("[CONTINUITY]"), "[CONTINUITY] tag present");
  assert(result.serialized.flattenedPrompt.includes("[SHOT"), "[SHOT] tag present");
  console.log(`  ✓ Pipeline: ${result.plan.shots.length} shots, ${result.debugLog.length} log entries`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 5: Asset Status Computation
// ═══════════════════════════════════════════════════════════════════

section("5. Asset Status Computation");

{
  const base: VideoRecord = {
    id: "vid-test", operationName: "op-1", engine: "veo", gcsUri: "", proxyUri: "",
    prompt: "test", mode: "generate", durationSec: 8, cutNumber: 1,
    status: "completed", createdAt: Date.now(),
  };

  assert(computeAssetStatus({ ...base }) === "GENERATED", "no URIs → GENERATED");
  assert(computeAssetStatus({ ...base, gcsUri: "gs://b/v.mp4" }) === "ASSET_STORED_INTERNAL", "gcsUri → INTERNAL");
  assert(computeAssetStatus({ ...base, proxyUri: "https://p.com/v.mp4" }) === "ASSET_STORED_PUBLIC", "proxyUri → PUBLIC");
  assert(computeAssetStatus({ ...base, canonicalVideoUri: "gs://c/v.mp4", proxyUri: "h" }) === "SCENE_EXTENSION_READY", "canonical → READY");
  assert(computeAssetStatus({ ...base, status: "failed", canonicalVideoUri: "gs://x" }) === "GENERATED", "failed → GENERATED");
  console.log(`  ✓ All asset status transitions verified`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 6: NO serializedPrompt in StructuredSequenceDocument
// ═══════════════════════════════════════════════════════════════════

section("6. StructuredSequenceDocument에 serializedPrompt 없음");

{
  const cuts = makeTestCuts(1);
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut: cuts[0], config: cfg });
  const seq = result.structuredSequence;

  // serializedPrompt 필드가 존재하지 않아야 한다
  assert(!("serializedPrompt" in seq), "serializedPrompt 필드 없음");
  assert(seq.shotPlan !== undefined, "shotPlan 있음");
  assert(seq.videoPromptJson !== undefined, "videoPromptJson 있음");
  assert(seq.negatives !== undefined, "negatives 있음");
  assert(seq.validation !== undefined, "validation 있음");
  console.log(`  ✓ serializedPrompt 완전 제거 확인`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 7: assembleFromJSON()이 prompt를 1급 반환하지 않음
// ═══════════════════════════════════════════════════════════════════

section("7. assembleFromJSON()에 prompt 없음");

{
  const cuts = makeTestCuts(1);
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut: cuts[0], config: cfg });

  // result에 prompt, negativePrompt 필드가 없어야 한다
  assert(!("prompt" in result), "result.prompt 없음");
  assert(!("negativePrompt" in result), "result.negativePrompt 없음");

  // 대신 structuredSequence와 diagnostics가 있다
  assert(result.structuredSequence !== undefined, "structuredSequence 있음");
  assert(result.diagnostics !== undefined, "diagnostics 있음");
  assert(result.diagnostics.validation !== undefined, "diagnostics.validation 있음");

  // preview는 디버그용으로만 존재
  assert(result.preview !== undefined, "preview 있음 (디버그용)");
  assert(typeof result.preview!.renderedPrompt === "string", "preview.renderedPrompt은 문자열");
  assert(result.preview!.renderedPrompt.length > 0, "preview.renderedPrompt 비어있지 않음");

  console.log(`  ✓ assembleFromJSON은 prompt 없이 structuredSequence만 반환`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 8: renderSequenceForProvider가 마지막 직렬화 지점
// ═══════════════════════════════════════════════════════════════════

section("8. renderSequenceForProvider 마지막 직렬화");

{
  const cuts = makeTestCuts(1);
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut: cuts[0], config: cfg });
  const seq = result.structuredSequence;

  // Veo용 직렬화
  const veo = renderSequenceForProvider(seq, "veo");
  assert(typeof veo.prompt === "string", "Veo prompt은 문자열");
  assert(veo.prompt.length > 50, "Veo prompt 충분한 길이");
  assert(veo.negativePrompt === "", "Veo negative는 embed (별도 필드 없음)");
  assert(veo.prompt.includes("Avoid:"), "Veo prompt에 negative embed됨");

  // Kling용 직렬화
  const kling = renderSequenceForProvider(seq, "kling");
  assert(typeof kling.prompt === "string", "Kling prompt은 문자열");
  assert(kling.prompt.length > 50, "Kling prompt 충분한 길이");
  assert(kling.negativePrompt.length > 0, "Kling negative 별도 필드");

  // 직렬화 결과가 structuredSequence에 저장되지 않음
  assert(!("serializedPrompt" in seq), "직렬화 후에도 serializedPrompt 없음");

  console.log(`  ✓ Veo: ${veo.prompt.length}ch, Kling: ${kling.prompt.length}ch + neg ${kling.negativePrompt.length}ch`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 9: Legacy compatibility — structuredSequence 없으면 fallback
// ═══════════════════════════════════════════════════════════════════

section("9. Legacy compatibility");

{
  // videoPromptJson 없는 Cut으로 assembleFromJSON 호출
  const cut: Cut = {
    cutNumber: 1, durationSec: 8,
    sceneDescription: "A warrior stands on a cliff",
    cameraDirection: "slow dolly",
    moodLighting: "sunset golden",
    imagePrompt: "", endImagePrompt: "",
    videoPrompt: "A warrior stands on a cliff overlooking the valley",
    extendPrompt: "",
    transitionHint: "",
    characterConsistency: "muscular warrior, leather armor",
    charactersInScene: ["char-1"],
  };
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut, config: cfg });

  assert(result.structuredSequence !== undefined, "videoPromptJson 없어도 structuredSequence 생성");
  assert(result.structuredSequence.shotPlan !== undefined, "shotPlan은 fallback으로 생성");
  assert(result.structuredSequence.videoPromptJson === undefined, "videoPromptJson은 undefined");

  // renderSequenceForProvider도 정상 작동
  const rendered = renderSequenceForProvider(result.structuredSequence, "veo");
  assert(rendered.prompt.length > 30, "fallback shotPlan에서도 렌더링 가능");

  console.log(`  ✓ Legacy cut (no videoPromptJson) → structuredSequence + render OK`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 10: preview.renderedPrompt는 source of truth 아님
// ═══════════════════════════════════════════════════════════════════

section("10. preview isolation");

{
  const cuts = makeTestCuts(1);
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut: cuts[0], config: cfg });

  // preview가 있어도 structuredSequence가 유일한 source of truth
  const seq = result.structuredSequence;
  const preview = result.preview;

  assert(preview !== undefined, "preview 존재");
  assert(!("serializedPrompt" in seq), "structuredSequence에 serializedPrompt 없음 (preview와 무관)");

  // preview 수정해도 structuredSequence 불변
  if (preview) {
    const originalAction = seq.shotPlan.action;
    preview.renderedPrompt = "CORRUPTED";
    assert(seq.shotPlan.action === originalAction, "preview 수정이 sequence에 영향 없음");
  }

  console.log(`  ✓ preview는 sequence와 독립 — source of truth 영향 없음`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 11: Client source-of-truth — body에 prompt 없이 structuredSequence만으로 충분
// ═══════════════════════════════════════════════════════════════════

section("11. Client source-of-truth: structuredSequence만으로 body 생성");

{
  const cuts = makeTestCuts(1);
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut: cuts[0], config: cfg });

  // assembleFromJSON 반환값에 prompt가 없다
  assert(!("prompt" in result), "result에 prompt 필드 없음");

  // structuredSequence만으로 body를 구성할 수 있다
  const body: Record<string, unknown> = {
    structuredSequence: result.structuredSequence,
    cutNumber: 1,
    engine: "veo",
  };
  assert(body.structuredSequence !== undefined, "body.structuredSequence 존재");
  assert(!("prompt" in body), "body에 prompt 없음");

  // structuredSequence의 shotPlan에서 필수 필드가 있다
  const seq = result.structuredSequence;
  assert(!!seq.shotPlan, "shotPlan 있음");
  assert(!!seq.shotPlan.camera, "camera 있음");
  assert(!!seq.shotPlan.subject, "subject 있음");
  assert(typeof seq.shotPlan.action === "string", "action은 string");

  console.log(`  ✓ structuredSequence만으로 body 생성 가능 — prompt 없이도 OK`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 12: Server fallback serialization — string-only provider에서 서버가 직렬화
// ═══════════════════════════════════════════════════════════════════

section("12. Server fallback serialization");

{
  const cuts = makeTestCuts(1);
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut: cuts[0], config: cfg });
  const seq = result.structuredSequence;

  // string-only provider (Veo)에서 서버가 마지막 직렬화 지점
  const rendered = renderSequenceForProvider(seq, "veo");
  assert(typeof rendered.prompt === "string", "서버 직렬화 결과는 string");
  assert(rendered.prompt.length > 50, "직렬화 결과에 실질적 내용 있음");

  // 직렬화 후에도 structuredSequence는 불변
  assert(seq.shotPlan.camera.framing !== undefined, "직렬화 후 shotPlan 불변");
  assert(!("serializedPrompt" in seq), "직렬화 후에도 serializedPrompt 없음");
  assert(!("prompt" in seq), "직렬화 후에도 prompt 없음");

  // Kling에서도 동일하게 서버에서 직렬화
  const klingRendered = renderSequenceForProvider(seq, "kling");
  assert(typeof klingRendered.prompt === "string", "Kling 직렬화도 string");
  assert(klingRendered.negativePrompt.length > 0, "Kling은 separate negative");
  assert(!("serializedPrompt" in seq), "Kling 직렬화 후에도 serializedPrompt 없음");

  console.log(`  ✓ string-only provider에서 서버가 마지막 직렬화 지점 확인`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 13: No serializedPrompt persistence — structuredSequence 내부에 절대 없음
// ═══════════════════════════════════════════════════════════════════

section("13. serializedPrompt persistence 금지");

{
  const cuts = makeTestCuts(3);
  const cfg = makeTestConfig();

  // 여러 컷에서 모두 serializedPrompt가 없는지 확인
  for (let i = 0; i < cuts.length; i++) {
    const prevCut = i > 0 ? cuts[i - 1] : undefined;
    const result = assembleFromJSON({ cut: cuts[i], config: cfg, prevCut });
    const seq = result.structuredSequence;

    assert(!("serializedPrompt" in seq), `cut ${i + 1}: serializedPrompt 없음`);

    // shotPlan 내부에도 없다
    const shotPlanStr = JSON.stringify(seq.shotPlan);
    assert(!shotPlanStr.includes("serializedPrompt"), `cut ${i + 1}: shotPlan에 serializedPrompt 없음`);

    // 전체 sequence JSON에도 없다
    const seqStr = JSON.stringify(seq);
    assert(!seqStr.includes("serializedPrompt"), `cut ${i + 1}: 전체 sequence에 serializedPrompt 없음`);
  }

  console.log(`  ✓ 3개 컷 모두 serializedPrompt 완전 부재 확인`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 14: Legacy compatibility — structuredSequence 없을 때만 fallback
// ═══════════════════════════════════════════════════════════════════

section("14. Legacy compatibility: fallback only without structuredSequence");

{
  // structuredSequence가 있는 경우 → prompt 불필요
  const cuts = makeTestCuts(1);
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut: cuts[0], config: cfg });
  const seq = result.structuredSequence;

  // sequence가 있으면 renderSequenceForProvider로 직렬화 가능
  assert(seq !== undefined, "sequence 존재");
  const rendered = renderSequenceForProvider(seq, "veo");
  assert(rendered.prompt.length > 0, "sequence에서 직렬화 가능");

  // videoPromptJson 없는 레거시 cut에서도 structuredSequence 생성됨
  const legacyCut: Cut = {
    cutNumber: 1, durationSec: 8,
    sceneDescription: "A simple scene",
    cameraDirection: "static",
    moodLighting: "natural",
    imagePrompt: "", endImagePrompt: "",
    videoPrompt: "A simple scene with a person",
    extendPrompt: "",
    transitionHint: "",
    characterConsistency: "",
    charactersInScene: [],
  };
  const legacyResult = assembleFromJSON({ cut: legacyCut, config: cfg });
  assert(legacyResult.structuredSequence !== undefined, "레거시 cut에서도 structuredSequence 생성");
  assert(legacyResult.structuredSequence.videoPromptJson === undefined, "레거시 cut에는 videoPromptJson 없음");

  // 레거시 sequence에서도 렌더링 가능
  const legacyRendered = renderSequenceForProvider(legacyResult.structuredSequence, "veo");
  assert(legacyRendered.prompt.length > 0, "레거시 sequence에서도 렌더링 가능");

  console.log(`  ✓ structuredSequence 없을 때만 videoPromptJson/prompt fallback 사용`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 15: Debug preview isolation — renderedPromptPreview가 source of truth에 영향 없음
// ═══════════════════════════════════════════════════════════════════

section("15. Debug preview isolation");

{
  const cuts = makeTestCuts(1);
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut: cuts[0], config: cfg });

  // preview.renderedPrompt가 있어도 source of truth 결정에 사용되지 않는다
  const seq = result.structuredSequence;
  const preview = result.preview;

  assert(preview !== undefined, "preview 존재");
  assert(typeof preview!.renderedPrompt === "string", "renderedPrompt는 string");

  // preview를 완전히 변경해도 sequence는 불변
  const originalShotPlan = JSON.stringify(seq.shotPlan);
  const originalNegatives = JSON.stringify(seq.negatives);
  preview!.renderedPrompt = "COMPLETELY_CORRUPTED_PREVIEW";
  preview!.wordCount = -999;

  assert(JSON.stringify(seq.shotPlan) === originalShotPlan, "preview 변경 후 shotPlan 불변");
  assert(JSON.stringify(seq.negatives) === originalNegatives, "preview 변경 후 negatives 불변");

  // preview에서 만들어진 값이 sequence에 흘러가지 않는다
  assert(!JSON.stringify(seq).includes("COMPLETELY_CORRUPTED"), "corrupt된 preview가 sequence에 없음");

  // acceptsStructuredPayload = false일 때도 source of truth는 structuredSequence
  // (renderSequenceForProvider는 sequence를 읽어 새 string을 만듦, sequence를 수정하지 않음)
  const rendered = renderSequenceForProvider(seq, "veo");
  assert(!rendered.prompt.includes("COMPLETELY_CORRUPTED"), "직렬화에도 corrupt된 preview 미사용");
  assert(rendered.prompt.length > 50, "직렬화는 sequence에서 정상 작동");

  console.log(`  ✓ preview는 완전히 격리됨 — source of truth 판단에 미사용`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 16: Provider capability — acceptsStructuredPayload semantics
// ═══════════════════════════════════════════════════════════════════

section("16. Provider capability: acceptsStructuredPayload 의미");

{

  // acceptsStructuredPayload = false는 "source of truth가 string"을 의미하지 않음
  // "마지막 순간에 serialize 필요"를 의미함
  assert(PROVIDER_CAPABILITIES.veo.acceptsStructuredPayload === false, "Veo: string-only provider");
  assert(PROVIDER_CAPABILITIES.kling.acceptsStructuredPayload === false, "Kling: string-only provider");

  // 그래도 source of truth는 structuredSequence
  const cuts = makeTestCuts(1);
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut: cuts[0], config: cfg });

  // assembleFromJSON이 prompt를 반환하지 않음 (provider capability와 무관)
  assert(!("prompt" in result), "capability false여도 prompt 미반환");
  assert(result.structuredSequence !== undefined, "capability false여도 structuredSequence가 source of truth");

  // supportsStructuredSequence 필드가 더 이상 존재하지 않음
  assert(!("supportsStructuredSequence" in PROVIDER_CAPABILITIES.veo), "supportsStructuredSequence 필드 제거됨");

  console.log(`  ✓ acceptsStructuredPayload false = serialize 타이밍 문제, 데이터 모델 문제 아님`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 17: Environment/Landscape — continuous camera only
// ═══════════════════════════════════════════════════════════════════

section("17. Environment/Landscape: continuous camera enforcement");

{
  // Environment cut with cut-based motion should be sanitized
  const cut: Cut = {
    cutNumber: 1, durationSec: 8,
    sceneDescription: "Eurasian steppe map with red highlight spreading",
    cameraDirection: "whip pan across terrain",
    moodLighting: "soft diffused overcast daylight",
    imagePrompt: "", endImagePrompt: "",
    videoPrompt: "Red highlight gradually spreading across steppe",
    extendPrompt: "",
    transitionHint: "",
    characterConsistency: "",
    charactersInScene: [],
    shotCategory: "environment",
    videoPromptJson: makeVideoPromptJson({
      shotSize: "CU",  // Should be overridden to WS for environment
      cameraAngle: "eye-level",
      cameraMovement: "whip pan (dramatic reveal)",
      subjectAction: "red highlight emerges in central steppe",
      locationCue: "Eurasian steppe terrain",
      moodLighting: "soft diffused overcast daylight casting gentle shadows",
    }),
  };
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut, config: cfg });
  const doc = result.document;

  // Camera should be WS, not CU
  assert(doc.camera.framing === "WS", "environment: CU → WS");
  // Camera should use continuous motion
  assert(!doc.camera.motion.toLowerCase().includes("whip"), "environment: whip pan removed");
  assert(doc.camera.motion.includes("push-in") || doc.camera.motion.includes("pan") || doc.camera.motion.includes("drift"),
    "environment: continuous motion applied");

  // Verify in structuredSequence
  const seq = result.structuredSequence;
  assert(seq.shotPlan !== undefined, "environment: shotPlan exists");

  console.log(`  ✓ Environment scene: framing=${doc.camera.framing}, motion="${doc.camera.motion}"`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 18: Environment — positive/negative conflict dedup
// ═══════════════════════════════════════════════════════════════════

section("18. Environment: positive/negative conflict dedup");

{
  const cut: Cut = {
    cutNumber: 1, durationSec: 8,
    sceneDescription: "Wide steppe landscape with overcast sky",
    cameraDirection: "slow push-in",
    moodLighting: "overcast diffused light",
    imagePrompt: "", endImagePrompt: "",
    videoPrompt: "Terrain contours visible under soft light",
    extendPrompt: "",
    transitionHint: "",
    characterConsistency: "",
    charactersInScene: [],
    shotCategory: "environment",
    videoPromptJson: makeVideoPromptJson({
      shotSize: "WS",
      cameraAngle: "overhead",
      cameraMovement: "slow push-in (revealing terrain)",
      subjectAction: "terrain contours emerge under soft light",
      moodLighting: "soft diffused overcast daylight",
      styleSuffix: "photorealistic cinematic, live-action footage",
    }),
  };
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut, config: cfg });

  // Global style should include photorealistic, cinematic, live-action
  const style = result.document.global.style.toLowerCase();
  assert(style.includes("photorealistic") || style.includes("cinematic"),
    "environment: positive keywords in style");

  // Negatives should NOT include photorealistic/cinematic/live-action
  const allNeg = [
    ...result.document.negatives.universal,
    ...result.document.negatives.sceneSpecific,
    ...result.document.negatives.failureMode,
    ...result.document.negatives.user,
  ].map(n => n.toLowerCase());

  // Check that positive keywords are not in negatives
  for (const kw of ["photorealistic", "cinematic", "live-action"]) {
    if (style.includes(kw)) {
      assert(!allNeg.includes(kw), `environment: "${kw}" not in negatives when in positive`);
    }
  }

  // Standard negatives should remain
  assert(allNeg.includes("text overlay"), "environment: text overlay in negatives");
  assert(allNeg.includes("watermark"), "environment: watermark in negatives");
  assert(allNeg.includes("blurry"), "environment: blurry in negatives");

  console.log(`  ✓ Positive/negative conflict resolved — no overlap`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 19: Environment — atmosphere detail enrichment in serialization
// ═══════════════════════════════════════════════════════════════════

section("19. Environment: atmosphere enrichment in serialized output");

{
  const cut: Cut = {
    cutNumber: 1, durationSec: 8,
    sceneDescription: "Steppe terrain with red highlight",
    cameraDirection: "slow push-in",
    moodLighting: "soft diffused overcast daylight",
    imagePrompt: "", endImagePrompt: "",
    videoPrompt: "Red highlight on steppe",
    extendPrompt: "",
    transitionHint: "",
    characterConsistency: "",
    charactersInScene: [],
    shotCategory: "environment",
    videoPromptJson: makeVideoPromptJson({
      shotSize: "WS",
      cameraAngle: "overhead",
      cameraMovement: "slow push-in (terrain reveal)",
      subjectAction: "red highlight gradually spreading across steppe",
      locationCue: "physical relief map of Eurasian steppe",
      moodLighting: "soft diffused overcast daylight",
    }),
  };
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut, config: cfg });
  const seq = result.structuredSequence;

  // Serialize for Veo
  const rendered = renderSequenceForProvider(seq, "veo");
  const prompt = rendered.prompt.toLowerCase();

  // Should contain atmosphere details
  assert(prompt.includes("haze") || prompt.includes("shadow") || prompt.includes("depth"),
    "environment: atmosphere enrichment present");

  // Should NOT contain cut-based terms
  assert(!prompt.includes("whip pan"), "environment: no whip pan in output");
  assert(!prompt.includes("jump cut"), "environment: no jump cut in output");
  assert(!prompt.includes("snap zoom"), "environment: no snap zoom in output");

  // preview also shows it's environment
  assert(result.preview?.isEnvironmentScene === true, "environment: isEnvironmentScene flag set");

  console.log(`  ✓ Atmosphere enrichment in serialized prompt`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 20: Environment — JSON-first source of truth (sequence JSON structure)
// ═══════════════════════════════════════════════════════════════════

section("20. Environment: JSON-first sequence structure");

{
  const cut: Cut = {
    cutNumber: 1, durationSec: 8,
    sceneDescription: "Eurasian steppe map",
    cameraDirection: "slow push-in",
    moodLighting: "soft diffused overcast daylight",
    imagePrompt: "", endImagePrompt: "",
    videoPrompt: "Red highlight on steppe",
    extendPrompt: "",
    transitionHint: "",
    characterConsistency: "",
    charactersInScene: [],
    shotCategory: "environment",
    videoPromptJson: makeVideoPromptJson({
      shotSize: "WS",
      cameraAngle: "overhead",
      cameraMovement: "slow push-in (terrain reveal)",
      subjectAction: "red highlight emerges in central steppe and gradually spreads",
      locationCue: "physical relief map of Eurasian steppe",
      moodLighting: "soft diffused overcast daylight casting gentle shadows over terrain",
      styleSuffix: "photorealistic cinematic",
    }),
  };
  const cfg = makeTestConfig();
  const result = assembleFromJSON({ cut, config: cfg });
  const seq = result.structuredSequence;

  // Validate the JSON structure matches the expected env schema
  assert(seq.shotPlan.camera !== undefined, "env: camera in shotPlan");
  assert(seq.shotPlan.subject !== undefined, "env: subject in shotPlan");
  assert(seq.shotPlan.action !== undefined, "env: action in shotPlan");
  assert(seq.negatives !== undefined, "env: negatives present");

  // Negatives should include environment standard set
  const negFlat = [
    ...(seq.negatives?.universal || []),
    ...(seq.negatives?.sceneSpecific || []),
  ].map(n => n.toLowerCase());
  assert(negFlat.includes("text overlay"), "env: text overlay negative");
  assert(negFlat.includes("watermark"), "env: watermark negative");
  assert(negFlat.includes("blurry"), "env: blurry negative");
  assert(negFlat.includes("low quality"), "env: low quality negative");

  // No serializedPrompt anywhere
  assert(!("serializedPrompt" in seq), "env: no serializedPrompt in sequence");
  assert(!JSON.stringify(seq).includes("serializedPrompt"), "env: no serializedPrompt in full JSON");

  // Source of truth is structuredSequence, not a string
  assert(!("prompt" in result), "env: no prompt in result");
  assert(result.structuredSequence !== undefined, "env: structuredSequence is source of truth");

  console.log(`  ✓ Environment JSON-first structure validated`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 21: Environment — sequence-plan resolveFramingConflicts for env scenes
// ═══════════════════════════════════════════════════════════════════

section("21. Environment: resolveFramingConflicts for environment shots");

{
  const cuts: Cut[] = [];
  for (let i = 0; i < 3; i++) {
    cuts.push({
      cutNumber: i + 1, durationSec: 8,
      sceneDescription: `Landscape scene ${i + 1}`,
      cameraDirection: "slow push-in",
      moodLighting: "overcast light",
      imagePrompt: "", endImagePrompt: "",
      videoPrompt: `Landscape ${i + 1}`,
      extendPrompt: "",
      transitionHint: i > 0 ? "smooth continuation" : "",
      characterConsistency: "",
      charactersInScene: [],
      shotCategory: "environment",
      videoPromptJson: makeVideoPromptJson({
        shotSize: "CU",  // Should be forced to WS for environment
        cameraMovement: "crash zoom (drama)",  // Should be sanitized
        subjectAction: `terrain detail ${i + 1}`,
      }),
    });
  }

  const plan = buildSequencePlan(cuts);
  const { plan: resolved, resolutions } = resolveFramingConflicts(plan);

  // All environment shots should be WS
  for (const shot of resolved.shots) {
    assert(shot.camera.framing === "WS", `env shot ${shot.shotId}: framing is WS`);
  }

  // Cut-based motions should be removed
  for (const shot of resolved.shots) {
    assert(!shot.camera.motion.toLowerCase().includes("crash"), `env shot ${shot.shotId}: no crash zoom`);
  }

  assert(resolutions.length > 0, "env: framing resolutions occurred");
  console.log(`  ✓ Environment shots: ${resolutions.length} resolutions applied`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 22: Environment — inferSceneType detects environment_landscape
// ═══════════════════════════════════════════════════════════════════

section("22. Environment: inferSceneType → environment_landscape");

{
  const cuts: Cut[] = [];
  for (let i = 0; i < 3; i++) {
    cuts.push({
      cutNumber: i + 1, durationSec: 8,
      sceneDescription: `Landscape ${i + 1}`,
      cameraDirection: "slow pan",
      moodLighting: "natural",
      imagePrompt: "", endImagePrompt: "",
      videoPrompt: `Terrain ${i + 1}`,
      extendPrompt: "",
      transitionHint: "",
      characterConsistency: "",
      charactersInScene: [],
      shotCategory: "environment",
    });
  }

  const plan = buildSequencePlan(cuts);
  assert(plan.globalIntent.sceneType === "environment_landscape",
    "3 environment cuts → environment_landscape sceneType");
  console.log(`  ✓ inferSceneType: environment_landscape`);
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
