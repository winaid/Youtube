/**
 * Global Rules Pipeline 테스트
 *
 * 전 장면 공통 규칙이 올바르게 적용되는지 검증:
 * 1. Historical figure scene — generic modern characterRef 자동 제거
 * 2. Overloaded shot — 과부하 감지
 * 3. Environment scene — soldiers/close-up/portrait drift 차단
 * 4. Character scene — descriptive coverage 검사
 * 5. Crowd scene — individual portrait drift 차단, mass motion 유지
 * 6. Positive-negative conflict — watermark/caption/photorealistic 충돌 제거
 * 7. Camera conflict — wide/medium/close-up 충돌 정리
 * 8. Scene type inference — shotCategory 없을 때 추론
 * 9. Camera-action consistency — static + complex action 충돌
 * 10. normalizeSequence 통합 파이프라인
 *
 * 실행: npx tsx tests/global-rules-pipeline.test.ts
 */

import {
  inferSceneType,
  sanitizeCharacterRef,
  detectOverloadedShot,
  checkCameraActionConsistency,
  checkDescriptiveCoverage,
  normalizeSequence,
} from "../src/lib/sequence-normalizer";

import {
  sanitizePositiveNegativeConflicts,
  resolveCameraConflicts,
  rewriteTemporalFlowForSceneType,
  ensureEnvironmentDetailCoverage,
  runSanitizePipeline,
} from "../src/lib/prompt-sanitizer";

import {
  resolveSceneType,
  applySceneTypeVocabularyRules,
  ensureDescriptiveCoverage,
  enforcePositiveKeywords,
} from "../src/lib/scene-type-rules";

import {
  validateFinalProviderPayload,
  autoFixPayload,
} from "../src/lib/final-payload-validator";

import type { SingleShotDocument } from "../src/lib/sequence-assembler";

// ═══════════════════════════════════════════════════════════════════
// Helper: minimal SingleShotDocument builder
// ═══════════════════════════════════════════════════════════════════

function makeShotDoc(overrides: Partial<SingleShotDocument> & { scene?: Partial<SingleShotDocument["scene"]>; subject?: Partial<SingleShotDocument["subject"]>; camera?: Partial<SingleShotDocument["camera"]>; global?: Partial<SingleShotDocument["global"]>; continuity?: Partial<SingleShotDocument["continuity"]>; reinforcement?: Partial<SingleShotDocument["reinforcement"]> }): SingleShotDocument {
  return {
    shotId: "shot_1",
    cutNumber: 1,
    global: { style: "cinematic realism", styleId: "live-action", aspectRatio: "16:9", totalDurationSec: 8, ...overrides.global },
    continuity: { primarySubject: "test", environment: "test env", lightingDirection: "natural", mustPersist: [], ...overrides.continuity },
    camera: { framing: "MS", angle: "eye_level", motion: "slow push-in", ...overrides.camera },
    scene: { shotCategory: "character-driven", environment: "test env", moodLighting: "golden hour light", ...overrides.scene },
    subject: { primary: "a man walks through a field", action: "walking forward slowly", ...overrides.subject },
    timing: { durationSec: 8, beats: [{ startSec: 0, endSec: 4, description: "establishing" }, { startSec: 4, endSec: 8, description: "development" }] },
    transition: undefined,
    reinforcement: { styleSuffix: "cinematic realism, live-action footage", ...overrides.reinforcement },
    negatives: { universal: ["text overlay", "watermark", "subtitle", "logo", "blurry", "low quality"], sceneSpecific: [], failureMode: [], user: [] },
    audio: { hint: "Diegetic ambient sound" },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Test runner
// ═══════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. Historical figure scene — characterRef sanitization
// ═══════════════════════════════════════════════════════════════════
console.log("\n[1] Historical figure scene — characterRef sanitization");
{
  // Modern generic ref in historical context → removed
  const result = sanitizeCharacterRef(
    "young person, casual modern clothing",
    "1940s wartime departure scene",
    "a soldier departing from family at train station",
    "character-driven",
  );
  assert(result.action === "removed", "Modern generic characterRef removed in historical scene");
  assert(result.characterRef === undefined, "characterRef is undefined after removal");

  // Proper historical ref → kept
  const result2 = sanitizeCharacterRef(
    "middle-aged military officer in World War II uniform, stern expression",
    "1940s wartime departure scene",
    "an officer departing from family",
    "character-driven",
  );
  assert(result2.action === "kept", "Period-appropriate characterRef kept");

  // Placeholder ref → removed
  const result3 = sanitizeCharacterRef("none", "any scene", "any subject");
  assert(result3.action === "removed", "Placeholder 'none' characterRef removed");

  // Empty ref → kept (no-op)
  const result4 = sanitizeCharacterRef("", "any scene", "any subject");
  assert(result4.characterRef === undefined, "Empty characterRef returns undefined");

  // Environment scene + portrait ref → downgraded
  const result5 = sanitizeCharacterRef(
    "detailed face close-up of young man with blue eyes",
    "vast landscape scene",
    "mountain range at dawn",
    "environment",
  );
  assert(result5.action === "replaced", "Portrait characterRef downgraded in environment scene");
  assert(!result5.characterRef?.includes("close-up"), "Close-up removed from environment characterRef");
}

// ═══════════════════════════════════════════════════════════════════
// 2. Overloaded shot detection
// ═══════════════════════════════════════════════════════════════════
console.log("\n[2] Overloaded shot detection");
{
  // Normal shot — not overloaded
  const normal = detectOverloadedShot(
    "A man walks through a field",
    "walking forward slowly",
    [{ description: "establishing" }, { description: "development" }],
    8,
  );
  assert(!normal.overloaded, "Normal shot not detected as overloaded");

  // Overloaded shot — establishing + character action + emotional reaction + departure
  const overloaded = detectOverloadedShot(
    "Wide establishing view of the train station reveals the crowd",
    "the soldier walks forward, turns to embrace his family, tears flow as the train departs, then he grabs his bag and runs",
    [{ description: "wide establishing opens" }, { description: "soldier walks to platform" }, { description: "tearful embrace" }, { description: "train pulls away" }],
    8,
  );
  assert(overloaded.overloaded, "Overloaded shot detected with 4+ event types");
  assert(overloaded.eventCount >= 3, `Event count ${overloaded.eventCount} >= 3`);
  assert(!!overloaded.suggestion, "Suggestion provided for overloaded shot");
}

// ═══════════════════════════════════════════════════════════════════
// 3. Environment scene — soldiers/close-up drift blocked
// ═══════════════════════════════════════════════════════════════════
console.log("\n[3] Environment scene — vocabulary filtering");
{
  const result = applySceneTypeVocabularyRules(
    "Soldiers marching through the vast mountain landscape, close-up face of the commander",
    "environment",
    "MS",
  );
  assert(!result.text.includes("Soldiers"), "Soldiers removed from environment scene");
  assert(!result.text.includes("close-up face"), "Close-up face removed from environment scene");
  assert(result.text.includes("distant"), "Soldiers replaced with distant figures");
  assert(result.framingChange !== undefined, "Framing changed from MS to WS for environment");
  assert(result.framingChange?.to === "WS", "Framing downgraded to WS");
}

// ═══════════════════════════════════════════════════════════════════
// 4. Character scene — descriptive coverage
// ═══════════════════════════════════════════════════════════════════
console.log("\n[4] Character scene — descriptive coverage");
{
  // Good coverage
  const good = checkDescriptiveCoverage(
    "An elderly man wearing a dark wool coat stands at the window, his weary expression lit by golden hour sidelight",
    "character-driven",
  );
  assert(good.sufficient, `Character coverage sufficient: ${good.covered}/${good.total}`);

  // Poor coverage — missing most elements
  const poor = checkDescriptiveCoverage(
    "A person in a room",
    "character-driven",
  );
  assert(!poor.sufficient, `Character coverage insufficient: ${poor.covered}/${poor.total}`);
  assert(poor.missing.length >= 3, `Missing ${poor.missing.length} elements: ${poor.missing.join(", ")}`);
}

// ═══════════════════════════════════════════════════════════════════
// 5. Crowd scene — individual portrait drift blocked
// ═══════════════════════════════════════════════════════════════════
console.log("\n[5] Crowd scene — vocabulary filtering");
{
  const result = applySceneTypeVocabularyRules(
    "Individual face detail of a single person portrait standing in front of the mass rally",
    "crowd",
    "ECU",
  );
  assert(!result.text.toLowerCase().includes("individual face detail"), "Individual face detail removed from crowd scene");
  assert(!result.text.toLowerCase().includes("single person portrait"), "Single person portrait removed from crowd scene");
  assert(result.framingChange?.to === "WS", "ECU downgraded to WS for crowd scene");

  // Crowd coverage check
  const coverage = checkDescriptiveCoverage(
    "A vast crowd of thousands surges forward, waving flags as dust fills the air, camera positioned above the gathering",
    "crowd",
  );
  assert(coverage.sufficient, `Crowd coverage sufficient: ${coverage.covered}/${coverage.total}`);
}

// ═══════════════════════════════════════════════════════════════════
// 6. Positive-negative conflict resolution
// ═══════════════════════════════════════════════════════════════════
console.log("\n[6] Positive-negative conflict resolution");
{
  const result = sanitizePositiveNegativeConflicts(
    "cinematic photorealistic footage with watermark branding and caption overlay",
    ["watermark", "caption", "photorealistic", "blurry", "low quality"],
  );
  assert(!result.positive.includes("watermark"), "watermark removed from positive");
  assert(!result.positive.includes("caption"), "caption removed from positive");
  assert(!result.positive.includes("photorealistic"), "photorealistic removed from positive");
  assert(result.conflicts.length >= 3, `${result.conflicts.length} conflicts detected`);
  assert(result.positive.includes("cinematic"), "Non-conflicting terms preserved");

  // "no watermark" should NOT be removed
  const result2 = sanitizePositiveNegativeConflicts(
    "cinematic footage, no watermark, no caption",
    ["watermark", "caption"],
  );
  assert(result2.positive.includes("no watermark"), "'no watermark' preserved in positive");
  assert(result2.positive.includes("no caption"), "'no caption' preserved in positive");

  // Duplicate negatives removed
  assert(new Set(result.negatives).size === result.negatives.length, "Duplicate negatives removed");
}

// ═══════════════════════════════════════════════════════════════════
// 7. Camera conflict resolution
// ═══════════════════════════════════════════════════════════════════
console.log("\n[7] Camera conflict resolution");
{
  // Wide declared + close-up in text = conflict
  const result = resolveCameraConflicts(
    "Wide shot establishing the scene, then close-up of the soldier's face, medium shot of the crowd",
    "WS",
    "environment",
  );
  assert(!(/\bclose[\s-]?up\b/i.test(result.text)), "Close-up removed from wide shot prompt");
  assert(!(/\bmedium\s+shot\b/i.test(result.text)), "Medium shot removed from wide shot prompt");
  assert(result.conflicts.length >= 1, `${result.conflicts.length} camera conflicts resolved`);

  // Temporal rewrite for environment
  const temporal = rewriteTemporalFlowForSceneType(
    "0-2s wide shot of the valley. 2-5s medium shot of the road. 5-8s close-up of the flowers.",
    "environment",
  );
  assert(temporal.rewrites.length > 0, "Temporal rewrite applied for environment scene");
  assert(!temporal.text.includes("cut to"), "'cut to' removed from temporal flow");
}

// ═══════════════════════════════════════════════════════════════════
// 8. Scene type inference
// ═══════════════════════════════════════════════════════════════════
console.log("\n[8] Scene type inference");
{
  const env = inferSceneType(undefined, "vast mountain landscape", "", "valley stretching to the horizon");
  assert(env.sceneType === "environment", "Environment scene inferred from landscape text");
  assert(env.inferred === true, "Scene type was inferred (not explicit)");

  const crowd = inferSceneType(undefined, "massive crowd fills the square", "protest rally", "");
  assert(crowd.sceneType === "crowd", "Crowd scene inferred from rally text");

  const battle = inferSceneType(undefined, "soldiers clash in combat", "battlefield explosion", "");
  assert(battle.sceneType === "battle", "Battle scene inferred from combat text");

  // Explicit shotCategory → not inferred
  const explicit = inferSceneType("environment", "a person walks", "", "");
  assert(explicit.sceneType === "environment", "Explicit environment preserved");
  assert(explicit.inferred === false, "Not inferred when explicit");
}

// ═══════════════════════════════════════════════════════════════════
// 9. Camera-action consistency
// ═══════════════════════════════════════════════════════════════════
console.log("\n[9] Camera-action consistency");
{
  // Static wide + complex multi-stage action = inconsistent
  const result = checkCameraActionConsistency(
    "WS",
    "static",
    "the soldier walks forward, then turns to embrace his wife, then picks up his bag, followed by running to the train, and finally waves goodbye while the crowd whispers",
    "character-driven",
  );
  assert(!result.consistent, "Static camera with complex action flagged as inconsistent");

  // Wide shot + micro expressions
  const result2 = checkCameraActionConsistency(
    "WS",
    "slow pan",
    "a subtle smile crosses her face as a tear rolls down her cheek, she whispers goodbye",
    "character-driven",
  );
  assert(!result2.consistent, "Wide shot with micro-expressions flagged");

  // Normal case — consistent
  const result3 = checkCameraActionConsistency(
    "MS",
    "slow push-in",
    "the man walks forward slowly",
    "character-driven",
  );
  assert(result3.consistent, "Medium shot with simple action is consistent");
}

// ═══════════════════════════════════════════════════════════════════
// 10. normalizeSequence integration
// ═══════════════════════════════════════════════════════════════════
console.log("\n[10] normalizeSequence integration");
{
  // Historical scene with modern characterRef
  const doc1 = makeShotDoc({
    scene: { shotCategory: "character-driven", environment: "1940s wartime train station", moodLighting: "dim overcast light" },
    subject: { primary: "a soldier departing from family during World War II", action: "walking toward the train" },
    continuity: { primarySubject: "soldier", environment: "wartime station", lightingDirection: "overcast", mustPersist: [], characterRef: "young person, casual modern clothing, sneakers" },
  });
  const norm1 = normalizeSequence(doc1);
  assert(norm1.doc.continuity.characterRef === undefined, "Modern characterRef removed in WWII scene");
  assert(norm1.log.some(l => l.includes("[charRef]")), "charRef removal logged");

  // Environment scene with overloaded action
  const doc2 = makeShotDoc({
    scene: { shotCategory: "environment", environment: "mountain landscape", moodLighting: "golden hour" },
    subject: { primary: "vast mountain landscape", action: "the soldiers march forward, then the commander turns and shouts orders, followed by an explosion, before they run to cover" },
    camera: { framing: "WS", angle: "overhead", motion: "slow push-in" },
  });
  const norm2 = normalizeSequence(doc2);
  assert(norm2.warnings.some(w => w.includes("[overload]") || w.includes("[camera-action]")), "Environment overload/action warning generated");

  // Scene type inference for unknown shotCategory
  const doc3 = makeShotDoc({
    scene: { shotCategory: undefined, environment: "vast ocean stretching to the horizon", moodLighting: "sunset glow" },
    subject: { primary: "vast ocean landscape panoramic view", action: "waves rolling gently" },
  });
  const norm3 = normalizeSequence(doc3);
  assert(norm3.doc.scene.shotCategory === "environment", `Scene type inferred: ${norm3.doc.scene.shotCategory}`);
  assert(norm3.log.some(l => l.includes("[infer]")), "Scene type inference logged");
}

// ═══════════════════════════════════════════════════════════════════
// 11. Final payload validation — new rules
// ═══════════════════════════════════════════════════════════════════
console.log("\n[11] Final payload validation — expanded rules");
{
  // characterRef era mismatch
  const v1 = validateFinalProviderPayload({
    prompt: "In the ancient Roman empire, a historical battle scene unfolds at dawn",
    negatives: [],
    framing: "WS",
    shotCategory: "battle",
    provider: "veo",
    characterRef: "young person, casual modern clothing, t-shirt and jeans",
  });
  assert(v1.issues.some(i => i.rule === "character_ref_era_mismatch"), "Character ref era mismatch detected");

  // Overloaded action density
  const v2 = validateFinalProviderPayload({
    prompt: "vast mountain landscape",
    negatives: [],
    framing: "WS",
    shotCategory: "environment",
    provider: "veo",
    actionText: "then the wind blows, and then the fog rolls in, followed by rain, subsequently the sun breaks through, and finally a rainbow appears",
  });
  assert(v2.issues.some(i => i.rule === "overloaded_shot"), "Overloaded shot detected in validation");

  // Camera-action inconsistency
  const v3 = validateFinalProviderPayload({
    prompt: "wide landscape",
    negatives: [],
    framing: "WS",
    shotCategory: "character-driven",
    provider: "veo",
    motion: "static",
    actionText: "then he walks, and then runs, followed by jumping, subsequently climbing, next swimming, finally resting",
  });
  assert(v3.issues.some(i => i.rule === "camera_action_inconsistent"), "Camera-action inconsistency detected");
}

// ═══════════════════════════════════════════════════════════════════
// 12. Full sanitize pipeline end-to-end
// ═══════════════════════════════════════════════════════════════════
console.log("\n[12] Full sanitize pipeline end-to-end");
{
  const result = runSanitizePipeline({
    prompt: "Soldiers marching through a photorealistic cinematic landscape, close-up face of commander, medium shot of troops, 0-2s wide establishing, 2-5s medium shot, 5-8s close-up",
    negatives: ["watermark", "caption", "photorealistic", "blurry"],
    framing: "WS",
    shotCategory: "environment",
    styleSuffix: "cinematic realism",
  });
  assert(!result.prompt.includes("Soldiers"), "Soldiers removed by pipeline");
  assert(!result.prompt.includes("close-up face"), "Close-up face removed by pipeline");
  assert(result.log.length > 0, `Pipeline generated ${result.log.length} log entries`);

  // Verify no pos/neg conflicts remain
  const hasWatermarkConflict = result.prompt.toLowerCase().includes("watermark") && result.negatives.includes("watermark");
  assert(!hasWatermarkConflict, "No watermark pos/neg conflict after pipeline");
}

// ═══════════════════════════════════════════════════════════════════
// 13. Map visualization — medium lock and drift prevention
// ═══════════════════════════════════════════════════════════════════
console.log("\n[13] Map visualization — medium lock");
{
  const result = applySceneTypeVocabularyRules(
    "A drone footage real terrain landscape photograph of the region with character details",
    "map_visualization",
    "MS",
  );
  assert(!result.text.includes("drone footage"), "Drone footage removed for map visualization");
  assert(!result.text.includes("real terrain"), "Real terrain removed for map visualization");
  assert(!result.text.includes("character"), "Character removed for map visualization");
  assert(result.framingChange?.to === "WS", "Framing forced to WS for map visualization");
}

// ═══════════════════════════════════════════════════════════════════
// 14. Positive keyword enforcement
// ═══════════════════════════════════════════════════════════════════
console.log("\n[14] Positive keyword enforcement");
{
  // Environment scene should require photorealistic, cinematic, etc.
  const envResult = enforcePositiveKeywords(
    "A vast mountain landscape with overcast sky",
    "environment",
  );
  assert(envResult.additions.length > 0, `Environment missing ${envResult.additions.length} positive keywords`);
  assert(envResult.additions.includes("photorealistic"), "photorealistic missing for environment");
  assert(envResult.additions.includes("cinematic"), "cinematic missing for environment");
  assert(envResult.additions.includes("subject-focused composition"), "subject-focused composition missing");
  assert(envResult.additions.includes("natural diegetic sound"), "natural diegetic sound missing");

  // Text already containing positives should not re-add
  const alreadyHas = enforcePositiveKeywords(
    "photorealistic cinematic vast mountain with ambient audio and subject-focused composition, natural diegetic sound",
    "environment",
  );
  assert(alreadyHas.additions.length === 0, `All positives already present, additions=${alreadyHas.additions.length}`);
  assert(alreadyHas.alreadyPresent.length >= 4, `${alreadyHas.alreadyPresent.length} positives detected`);

  // Character scene positives
  const charResult = enforcePositiveKeywords("An elderly man sitting alone", "person");
  assert(charResult.additions.includes("photorealistic"), "photorealistic missing for person scene");
  assert(charResult.additions.includes("cinematic"), "cinematic missing for person scene");

  // Map scene should NOT require photorealistic (different positive set)
  const mapResult = enforcePositiveKeywords("A terrain relief map", "map_visualization");
  assert(!mapResult.additions.includes("photorealistic"), "Map should NOT require photorealistic");
  assert(mapResult.additions.includes("cinematic"), "Map should require cinematic");

  // Pipeline integration — runSanitizePipeline adds positives
  const pipeResult = runSanitizePipeline({
    prompt: "vast mountain landscape with overcast sky and soft light over rocky terrain",
    negatives: ["text overlay", "watermark", "logo", "blurry", "low quality"],
    framing: "WS",
    shotCategory: "environment",
  });
  assert(pipeResult.prompt.includes("cinematic"), "Pipeline added cinematic to environment");
  assert(pipeResult.prompt.includes("subject-focused composition"), "Pipeline added subject-focused composition");
  // Check that positives that conflict with negatives are NOT added
  assert(pipeResult.log.some(l => l.includes("[positive]")), "Pipeline logged positive additions");
}

// ═══════════════════════════════════════════════════════════════════
// 15. Map visualization — concrete cues & enhanced rules
// ═══════════════════════════════════════════════════════════════════
console.log("\n[15] Map visualization — concrete cues");
{
  // Banned abstract terms
  const absResult = applySceneTypeVocabularyRules(
    "An abstract pattern with generic noise on the map",
    "map_visualization",
    "WS",
  );
  assert(!absResult.text.includes("generic noise"), "Generic noise removed from map");
  assert(!absResult.text.includes("abstract pattern"), "Abstract pattern removed from map");

  // Required elements (terrain, lighting, atmosphere)
  const coverage = ensureDescriptiveCoverage("A flat map view", "map_visualization");
  assert(coverage.additions.length > 0, `Map missing ${coverage.additions.length} concrete cues`);
  assert(coverage.additions.some(a => a.includes("topographic")), "Topographic relief suggested for map");

  // Validator detects missing concrete cues
  const valResult = validateFinalProviderPayload({
    prompt: "A simple map view with some colors",
    negatives: ["watermark"],
    framing: "WS",
    shotCategory: "map-graphic",
    provider: "veo",
  });
  const mapCueIssue = valResult.issues.find(i => i.rule === "map_concrete_cues_missing");
  assert(!!mapCueIssue, "Validator detects missing map concrete cues");

  // Validator detects abstract terms
  const absValResult = validateFinalProviderPayload({
    prompt: "An abstract pattern showing terrain with light and atmosphere",
    negatives: ["watermark"],
    framing: "WS",
    shotCategory: "map-graphic",
    provider: "veo",
  });
  const absIssue = absValResult.issues.find(i => i.rule === "map_abstract_terms");
  assert(!!absIssue, "Validator detects abstract terms in map");
}

// ═══════════════════════════════════════════════════════════════════
// 16. Positive keyword validation in final validator
// ═══════════════════════════════════════════════════════════════════
console.log("\n[16] Positive keyword validation");
{
  // Environment scene missing most positives
  const valResult = validateFinalProviderPayload({
    prompt: "A vast mountain with overcast sky and soft light",
    negatives: ["watermark"],
    framing: "WS",
    shotCategory: "environment",
    provider: "veo",
  });
  const posIssue = valResult.issues.find(i => i.rule === "positive_keywords_missing");
  assert(!!posIssue, "Validator detects missing positive keywords for environment");

  // Environment scene with all positives should pass
  const fullResult = validateFinalProviderPayload({
    prompt: "photorealistic cinematic vast mountain with subject-focused composition, natural diegetic sound, ambient audio, overcast sky, soft light, atmospheric haze, rocky terrain, sense of vast scale",
    negatives: ["watermark"],
    framing: "WS",
    shotCategory: "environment",
    provider: "veo",
  });
  const noPosIssue = fullResult.issues.find(i => i.rule === "positive_keywords_missing");
  assert(!noPosIssue, "No positive keyword issue when all are present");
}

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(60)}`);
console.log(`Result: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed > 0) {
  console.error("❌ Some tests failed!");
  process.exit(1);
} else {
  console.log("✅ All tests passed!");
}
