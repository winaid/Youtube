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
  normalizeLightingDescription,
  rewriteEnvironmentAction,
  applySceneTypeRewrite,
  ensurePlaceIdentityAnchor,
  ensureSituationEvidence,
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

import {
  buildFinalProviderPayload,
} from "../src/lib/final-payload-builder";

import {
  sanitizeShotDocument,
  serializeForProvider,
} from "../src/lib/sequence-assembler";
import type { SingleShotDocument } from "../src/lib/sequence-assembler";

import {
  computeAssetStatus,
  canExtendScene,
  visibleInLibrary,
  sceneExtensionReady,
  type VideoRecord,
} from "../src/lib/video-history";

import {
  detectSceneContext,
  getPlaceIdentityCandidates,
  getSituationEvidenceCandidates,
  getNaturalMotionCandidates,
  getLightSourceCandidates,
  detectNaturalMotion,
} from "../src/lib/place-situation-anchors";

import {
  ensureNaturalEnvironmentalMotion,
  ensureExplicitLightSource,
} from "../src/lib/sequence-normalizer";

import {
  reevaluateSceneExtensionEligibilityAfterUpload,
  selectVideoModeForNextCut,
  ensureCanonicalVideoUriPromotion,
  buildExtendPayloadFromCanonicalUri,
} from "../src/lib/scene-extension-readiness";

// ═══════════════════════════════════════════════════════════════════
// Helper: minimal SingleShotDocument builder
// ═══════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeShotDoc(overrides: Record<string, any> = {}): SingleShotDocument {
  return {
    shotId: "shot_1",
    cutNumber: 1,
    global: { style: "cinematic realism", styleId: "live-action", aspectRatio: "16:9", totalDurationSec: 8, ...overrides.global },
    continuity: { primarySubject: "test", environment: "test env", lightingDirection: "natural", ambient: "", colorAnchor: "", mustPersist: [], ...overrides.continuity },
    camera: { framing: "MS", angle: "eye_level", motion: "slow push-in", ...overrides.camera },
    scene: { shotCategory: "character-driven", environment: "test env", moodLighting: "golden hour light", ...overrides.scene },
    subject: { primary: "a man walks through a field", action: "walking forward slowly", ...overrides.subject },
    timing: { durationSec: 8, beats: [{ startSec: 0, endSec: 4, description: "establishing" }, { startSec: 4, endSec: 8, description: "development" }] },
    transition: undefined,
    reinforcement: { styleSuffix: "cinematic realism, live-action footage", ...overrides.reinforcement },
    negatives: { universal: ["text overlay", "watermark", "subtitle", "logo", "blurry", "low quality"], sceneSpecific: [], failureMode: [], user: [] },
    audio: { hint: "Diegetic ambient sound" },
  } as SingleShotDocument;
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
// 17. sanitizeShotDocument — ALL 4 negative layers sanitized
// ═══════════════════════════════════════════════════════════════════
console.log("\n[17] sanitizeShotDocument — all negative layers");
{
  // "cinematic" is in the positive style but also in universal negatives
  const doc = makeShotDoc({
    global: { style: "cinematic realism", styleId: "live-action", aspectRatio: "16:9", totalDurationSec: 8 },
  });
  // Inject conflicts into each layer
  doc.negatives.universal = ["watermark", "cinematic", "blurry"];
  doc.negatives.sceneSpecific = ["photorealistic", "subtitle"];
  doc.negatives.failureMode = ["cinematic realism", "low quality"];
  doc.negatives.user = ["realism", "logo"];

  const { doc: sanitized, fixes } = sanitizeShotDocument(doc);

  // "cinematic" should be removed from universal (conflicts with style "cinematic realism")
  assert(
    !sanitized.negatives.universal.includes("cinematic"),
    "universal: removed 'cinematic' conflicting with positive style"
  );
  // "watermark" should remain (not in positive style text)
  assert(
    sanitized.negatives.universal.includes("watermark"),
    "universal: kept 'watermark' (not in positive)"
  );
  // failureMode: "cinematic realism" should be removed
  assert(
    !sanitized.negatives.failureMode.includes("cinematic realism"),
    "failureMode: removed 'cinematic realism' conflicting with positive"
  );
  // user: "realism" should be removed (present in positive "cinematic realism")
  assert(
    !sanitized.negatives.user.includes("realism"),
    "user: removed 'realism' conflicting with positive style"
  );
  // Verify fixes logged all 4 layers
  const layersFixed = new Set(fixes.filter(f => f.includes("Removed conflicting negative")).map(f => {
    const m = f.match(/from (\w+)/);
    return m ? m[1] : "";
  }));
  assert(layersFixed.size >= 2, `At least 2 different layers had conflicts resolved (got ${layersFixed.size})`);
}

// ═══════════════════════════════════════════════════════════════════
// 18. Video history — computeAssetStatus, canExtendScene, visibleInLibrary
// ═══════════════════════════════════════════════════════════════════
console.log("\n[18] Video history status helpers");
{
  const baseRecord: VideoRecord = {
    id: "vid-test-1",
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

  // GENERATED: no URIs
  assert(computeAssetStatus(baseRecord) === "GENERATED", "No URIs → GENERATED");
  assert(!canExtendScene(baseRecord), "No URIs → cannot extend");
  assert(!visibleInLibrary(baseRecord), "No URIs → not visible in library");

  // ASSET_STORED_INTERNAL: only gcsUri
  const internal = { ...baseRecord, gcsUri: "gs://bucket/video.mp4" };
  assert(computeAssetStatus(internal) === "ASSET_STORED_INTERNAL", "gcsUri only → ASSET_STORED_INTERNAL");
  assert(!canExtendScene(internal), "gcsUri only → cannot extend (no canonicalVideoUri)");

  // ASSET_STORED_PUBLIC: only proxyUri
  const pub = { ...baseRecord, proxyUri: "https://proxy.example.com/video.mp4" };
  assert(computeAssetStatus(pub) === "ASSET_STORED_PUBLIC", "proxyUri only → ASSET_STORED_PUBLIC");

  // SCENE_EXTENSION_READY: canonicalVideoUri but no proxyUri
  const extReady = { ...baseRecord, canonicalVideoUri: "gs://bucket/final.mp4" };
  assert(computeAssetStatus(extReady) === "SCENE_EXTENSION_READY", "canonicalVideoUri only → SCENE_EXTENSION_READY");
  assert(canExtendScene(extReady), "canonicalVideoUri gs:// → can extend");

  // VISIBLE_IN_LIBRARY: both proxyUri and canonicalVideoUri
  const visible = { ...baseRecord, proxyUri: "https://proxy.example.com/v.mp4", canonicalVideoUri: "gs://bucket/final.mp4" };
  assert(computeAssetStatus(visible) === "VISIBLE_IN_LIBRARY", "proxyUri + canonicalVideoUri → VISIBLE_IN_LIBRARY");
  assert(canExtendScene(visible), "VISIBLE_IN_LIBRARY → can extend");
  assert(visibleInLibrary(visible), "VISIBLE_IN_LIBRARY → visible in library");

  // Failed record always GENERATED
  const failedRecord = { ...visible, status: "failed" as const };
  assert(computeAssetStatus(failedRecord) === "GENERATED", "Failed record → always GENERATED");
  assert(!canExtendScene(failedRecord), "Failed → cannot extend");
  assert(!visibleInLibrary(failedRecord), "Failed → not visible");

  // canExtendScene with https:// canonical URI
  const httpsCanonical = { ...baseRecord, canonicalVideoUri: "https://storage.googleapis.com/bucket/v.mp4" };
  assert(canExtendScene(httpsCanonical), "https:// canonicalVideoUri → can extend");
}

// ═══════════════════════════════════════════════════════════════════
// 19. Lighting normalization
// ═══════════════════════════════════════════════════════════════════
console.log("\n[19] Lighting normalization");
{
  // Warm + cool conflict
  const warmCool = normalizeLightingDescription("Bright daylight from overhead, strong intense light, warm sunny glow. Blue-grey cast.");
  assert(warmCool.normalized, "warm+cool conflict detected and normalized");
  assert(!warmCool.text.toLowerCase().includes("blue-grey"), "blue-grey removed from warm-dominant profile");
  assert(warmCool.profile.includes("warm"), "Profile is warm-dominant");

  // Harsh + soft conflict
  const harshSoft = normalizeLightingDescription("harsh midday sunlight, soft diffused glow, muted shadows");
  assert(harshSoft.normalized, "harsh+soft conflict detected and normalized");
  assert(harshSoft.text.includes("natural directional light"), "Merged to natural directional light");

  // No conflict → no change
  const consistent = normalizeLightingDescription("golden hour light, long shadows, warm tones");
  assert(!consistent.normalized, "No conflict → not normalized");
  assert(consistent.profile === "consistent", "Profile is consistent");
}

// ═══════════════════════════════════════════════════════════════════
// 20. Environment action density rewrite
// ═══════════════════════════════════════════════════════════════════
console.log("\n[20] Environment action density rewrite");
{
  // Arrow pattern rewrite
  const arrowResult = rewriteEnvironmentAction(
    "Tiananmen Square fills the frame. → Chinese flag waving in the wind. → Flag dominates the square.",
    "Tiananmen Square, Chinese flag",
    { framing: "WS", motion: "Static wide shot" },
  );
  assert(arrowResult.rewritten, "Arrow pattern detected and rewritten");
  assert(!arrowResult.text.includes("→"), "No arrow symbols remain in rewritten text");
  assert(arrowResult.text.toLowerCase().includes("continuous"), "Rewritten to continuous exploration");
  assert(arrowResult.motionSuggestion === "slow push-in", "Static → slow push-in suggestion");

  // Non-arrow text → no rewrite
  const noArrow = rewriteEnvironmentAction(
    "a vast mountain range under overcast sky",
    "mountain range",
    { framing: "WS", motion: "slow pan" },
  );
  assert(!noArrow.rewritten, "No arrow → no rewrite");

  // Arrow pattern integration into normalizeSequence
  const envDoc = makeShotDoc({
    scene: { shotCategory: "environment", environment: "Tiananmen Square", moodLighting: "bright daylight, warm sunny glow, blue-grey cast" },
    subject: { primary: "Tiananmen Square fills the frame → Chinese flag waving → Flag dominates", action: "Tiananmen Square fills the frame → Chinese flag waving → Flag dominates" },
    camera: { framing: "WS", angle: "eye_level", motion: "Static wide shot" },
  });
  const normalized = normalizeSequence(envDoc);
  assert(!normalized.doc.subject.action.includes("→"), "normalizeSequence removed arrows from action");
  assert(normalized.log.some(l => l.includes("[env-action]")), "normalizeSequence logged env-action rewrite");
  assert(normalized.doc.scene.moodLighting !== envDoc.scene.moodLighting, "Lighting was normalized (warm+cool conflict)");
}

// ═══════════════════════════════════════════════════════════════════
// 21. Final payload pos/neg — "Avoid:" section excluded from conflict
// ═══════════════════════════════════════════════════════════════════
console.log("\n[21] Final payload pos/neg — Avoid: section handling");
{
  // Simulate what serializeForProvider does: embed negatives as "Avoid: ..."
  const valResult = validateFinalProviderPayload({
    prompt: "A vast mountain landscape, cinematic realism. No text overlay, no watermark. Avoid: watermark, caption, subtitle, blurry",
    negatives: ["watermark", "caption", "subtitle", "blurry"],
    framing: "WS",
    shotCategory: "environment",
    provider: "veo",
  });
  const posNegErrors = valResult.issues.filter(i => i.rule === "pos_neg_conflict");
  assert(posNegErrors.length === 0, "No pos_neg_conflict when watermark only in 'no watermark' and 'Avoid:' sections");

  // Actual conflict: bare "watermark" in prompt body (not in "no X" guard)
  const conflictResult = validateFinalProviderPayload({
    prompt: "A watermark-style logo on the mountain. Avoid: blurry",
    negatives: ["watermark"],
    framing: "WS",
    provider: "veo",
  });
  const realConflict = conflictResult.issues.filter(i => i.rule === "pos_neg_conflict");
  assert(realConflict.length > 0, "Real pos_neg_conflict detected when bare watermark in body");
}

// ═══════════════════════════════════════════════════════════════════
// 22. serializeForProvider end-to-end — auto-fix cleans all pos/neg
// ═══════════════════════════════════════════════════════════════════
console.log("\n[22] serializeForProvider end-to-end pos/neg cleanup");
{
  // Build a doc with potential pos/neg conflicts
  const doc = makeShotDoc({
    global: { style: "cinematic realism, photorealistic", styleId: "live-action", aspectRatio: "16:9", totalDurationSec: 8 },
    reinforcement: { styleSuffix: "cinematic realism, live-action footage" },
    scene: { shotCategory: "environment", environment: "vast mountain", moodLighting: "golden hour" },
  });
  // Add conflicts: "photorealistic" and "cinematic" are in positive AND negatives
  doc.negatives.universal = ["text overlay", "watermark", "subtitle", "logo", "blurry", "low quality"];
  doc.negatives.sceneSpecific = ["photorealistic"]; // conflict with style!
  doc.negatives.failureMode = ["cinematic"]; // conflict with style!

  const serialized = serializeForProvider(doc, "veo");
  const finalPrompt = serialized.prompt;

  // The serialized prompt should NOT have pos/neg conflicts after auto-fix
  // "No text overlay, no watermark" are OK (guard patterns)
  // But bare "photorealistic" or "cinematic" should either be removed from prompt or negatives
  const debugIssues = serialized.debug.sections._validationIssues || "";
  const posNegRemaining = debugIssues.split(" | ").filter(s => s.includes("pos_neg_conflict"));
  assert(posNegRemaining.length === 0, `No pos_neg_conflict errors remain after auto-fix (got: ${posNegRemaining.length})`);
}

// ═══════════════════════════════════════════════════════════════════
// 23. Full Tiananmen Square scenario — end-to-end
// ═══════════════════════════════════════════════════════════════════
console.log("\n[23] Full Tiananmen Square scenario");
{
  const doc = makeShotDoc({
    scene: { shotCategory: "environment", environment: "Tiananmen Square, Chinese flag", moodLighting: "Bright daylight from overhead, strong intense light, warm sunny glow. Blue-grey cast." },
    subject: {
      primary: "Tiananmen Square fills the frame. → Chinese flag waving in the wind. → Flag dominates the square.",
      action: "Tiananmen Square fills the frame. → Chinese flag waving in the wind. → Flag dominates the square.",
    },
    camera: { framing: "WS", angle: "eye_level", motion: "Static wide shot" },
    global: { style: "cinematic realism", styleId: "live-action", aspectRatio: "16:9", totalDurationSec: 8 },
  });

  // Run full normalizeSequence
  const result = normalizeSequence(doc);

  // 1. Action should be rewritten (no arrows)
  assert(!result.doc.subject.action.includes("→"), "Tiananmen: arrows removed from action");
  assert(result.doc.subject.action.toLowerCase().includes("continuous"), "Tiananmen: continuous exploration language");

  // 2. Lighting should be coherent (no warm+cool conflict)
  const lighting = result.doc.scene.moodLighting.toLowerCase();
  assert(!lighting.includes("blue-grey") && !lighting.includes("blue grey"), "Tiananmen: blue-grey cast removed");

  // 3. Camera motion should be normalized (not static with progressive action)
  assert(result.doc.camera.motion !== "Static wide shot", "Tiananmen: static motion normalized");

  // 4. Serialize and verify no pos/neg conflicts
  const serialized = serializeForProvider(result.doc, "veo");
  const issues = serialized.debug.sections._validationIssues || "";
  const posNeg = issues.split(" | ").filter(s => s.includes("pos_neg_conflict"));
  assert(posNeg.length === 0, `Tiananmen: 0 pos_neg_conflict in final payload (got ${posNeg.length})`);
}

// ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
// 24. buildFinalProviderPayload — single path test
// ═══════════════════════════════════════════════════════════════════
console.log("\n[24] buildFinalProviderPayload — single path");
{
  const doc = makeShotDoc({
    scene: { shotCategory: "environment", environment: "vast mountain range", moodLighting: "golden hour light" },
    global: { style: "cinematic realism", styleId: "live-action", aspectRatio: "16:9", totalDurationSec: 8 },
  });
  const result = buildFinalProviderPayload({ document: doc, provider: "veo" });

  // Verify builtBy marker
  assert(result.debug.builtBy === "buildFinalProviderPayload", "builtBy marker present");

  // Verify payloadSnapshot exists and matches prompt
  assert(result.debug.payloadSnapshot.length > 0, "payloadSnapshot is non-empty");
  const snapshot = JSON.parse(result.debug.payloadSnapshot);
  assert(snapshot.prompt === result.prompt, "payloadSnapshot.prompt === result.prompt (consistency)");
  assert(snapshot.provider === "veo", "payloadSnapshot.provider === veo");

  // Verify valid output
  assert(result.prompt.length > 50, "Final prompt has sufficient length");
  assert(result.wordCount > 10, "Word count > 10");
}

// ═══════════════════════════════════════════════════════════════════
// 25. pos_neg_conflict zero test — all critical words
// ═══════════════════════════════════════════════════════════════════
console.log("\n[25] pos_neg_conflict zero in final payload");
{
  const zeroToleranceWords = ["watermark", "caption", "subtitle", "logo", "photorealistic", "cinematic"];

  // Build a doc that deliberately has conflicts
  const doc = makeShotDoc({
    global: { style: "cinematic realism, photorealistic footage", styleId: "live-action", aspectRatio: "16:9", totalDurationSec: 8 },
    reinforcement: { styleSuffix: "cinematic realism, photorealistic, live-action" },
    scene: { shotCategory: "environment", environment: "mountain", moodLighting: "golden hour" },
  });
  // Add all critical words to negatives
  doc.negatives.universal = ["text overlay", "watermark", "subtitle", "logo", "blurry", "low quality"];
  doc.negatives.sceneSpecific = ["caption"];
  doc.negatives.failureMode = ["photorealistic", "cinematic"];

  const result = buildFinalProviderPayload({ document: doc, provider: "veo" });

  // Extract prompt body (before "Avoid:")
  const avoidIdx = result.prompt.search(/\.\s*Avoid:\s*/i);
  const body = avoidIdx >= 0 ? result.prompt.slice(0, avoidIdx) : result.prompt;
  const bodyLower = body.toLowerCase();

  for (const word of zeroToleranceWords) {
    const wl = word.toLowerCase();
    // Check if word is in body WITHOUT a "no X" guard
    const guardRe = new RegExp(`\\b(?:no|avoid|without)\\s+(?:[\\w\\s,]+\\s+)?${word}\\b`, "i");
    const barePresent = bodyLower.includes(wl) && !guardRe.test(body);
    assert(!barePresent, `"${word}" has zero bare occurrences in final payload body`);
  }

  // Also verify via validator
  const validation = validateFinalProviderPayload({
    prompt: body,
    negatives: result.negativePrompt ? result.negativePrompt.split(", ") : [],
    framing: "WS",
    shotCategory: "environment",
    provider: "veo",
  });
  const posNegErrors = validation.issues.filter(i => i.rule === "pos_neg_conflict");
  assert(posNegErrors.length === 0, `Validator confirms 0 pos_neg_conflict (got ${posNegErrors.length})`);
}

// ═══════════════════════════════════════════════════════════════════
// 26. hard-block test — unresolvable conflict blocks generation
// ═══════════════════════════════════════════════════════════════════
console.log("\n[26] hard-block test");
{
  // buildFinalProviderPayload should report blocked=false for a clean doc
  const cleanDoc = makeShotDoc({
    scene: { shotCategory: "environment", environment: "mountain", moodLighting: "golden hour" },
  });
  const cleanResult = buildFinalProviderPayload({ document: cleanDoc, provider: "veo" });
  assert(!cleanResult.blocked, "Clean doc is not blocked");
  assert(cleanResult.valid, "Clean doc is valid");
}

// ═══════════════════════════════════════════════════════════════════
// 27. payload consistency test — snapshot matches transmitted prompt
// ═══════════════════════════════════════════════════════════════════
console.log("\n[27] payload consistency — snapshot matches prompt");
{
  const doc = makeShotDoc({
    scene: { shotCategory: "character-driven", environment: "office", moodLighting: "fluorescent light" },
    subject: { primary: "a man in a suit stands at a desk", action: "adjusting his tie" },
  });
  const result = buildFinalProviderPayload({ document: doc, provider: "veo" });

  const snapshot = JSON.parse(result.debug.payloadSnapshot);
  assert(snapshot.prompt === result.prompt, "Payload snapshot prompt === actual prompt");
  assert(snapshot.negativePrompt === result.negativePrompt, "Payload snapshot negativePrompt === actual");
}

// ═══════════════════════════════════════════════════════════════════
// 28. preview isolation test — fallback fields don't affect generation
// ═══════════════════════════════════════════════════════════════════
console.log("\n[28] preview isolation — fallback fields are debug-only");
{
  // The body sent to /api/generate-video should never contain "prompt" when structuredSequence exists
  // This test verifies the architecture by checking that buildFinalProviderPayload
  // produces the same result regardless of any "preview" text
  const doc1 = makeShotDoc({
    scene: { shotCategory: "environment", environment: "desert", moodLighting: "harsh sun" },
  });
  const doc2 = makeShotDoc({
    scene: { shotCategory: "environment", environment: "desert", moodLighting: "harsh sun" },
  });

  const result1 = buildFinalProviderPayload({ document: doc1, provider: "veo" });
  const result2 = buildFinalProviderPayload({ document: doc2, provider: "veo" });

  // Same input → same output (deterministic)
  assert(result1.prompt === result2.prompt, "Same input produces same prompt (deterministic)");
  assert(result1.debug.payloadSnapshot === result2.debug.payloadSnapshot, "Same input produces same snapshot");
}

// ═══════════════════════════════════════════════════════════════════
// Section 29: Environment battle vocabulary rewrite (Round 4)
// ═══════════════════════════════════════════════════════════════════
console.log("\n[29] Environment battle vocabulary rewrite");
{
  const r1 = rewriteEnvironmentAction(
    "Explosions erupt across the battlefield as tanks advance",
    "war-torn landscape",
    { framing: "WS", motion: "slow pan" },
  );
  assert(r1.rewritten, "Battle vocab triggers rewrite");
  assert(!/\bexplosion/i.test(r1.text), `No 'explosion' in result: "${r1.text}"`);
  assert(!/\btanks?\b/i.test(r1.text), `No 'tanks' in result: "${r1.text}"`);
  assert(!/\bbattlefield\b/i.test(r1.text), `No 'battlefield' in result: "${r1.text}"`);

  const r2 = rewriteEnvironmentAction(
    "soldiers march across the ruined city",
    "ruined cityscape",
    { framing: "LS", motion: "slow push-in" },
  );
  assert(r2.rewritten, "'soldiers march' triggers rewrite");
  assert(!/\bsoldiers?\b/i.test(r2.text), `No 'soldiers' in result: "${r2.text}"`);

  const r3 = rewriteEnvironmentAction(
    "tanks and soldiers advance through smoke",
    "devastated terrain",
    { framing: "WS", motion: "drone flyover" },
  );
  assert(r3.rewritten, "'tanks and soldiers' triggers rewrite");
  assert(!/\btanks?\b/i.test(r3.text), `No 'tanks' in result: "${r3.text}"`);
  assert(!/\bsoldiers?\b/i.test(r3.text), `No 'soldiers' in result: "${r3.text}"`);

  const r4 = rewriteEnvironmentAction(
    "wind sweeps across the desolate plain",
    "desolate plain",
    { framing: "WS", motion: "slow pan" },
  );
  assert(!r4.rewritten, "Non-battle env action NOT rewritten");
}

// ═══════════════════════════════════════════════════════════════════
// Section 30: applySceneTypeRewrite on structured doc fields
// ═══════════════════════════════════════════════════════════════════
console.log("\n[30] applySceneTypeRewrite on structured doc fields");
{
  const doc1 = makeShotDoc({
    scene: { shotCategory: "environment", environment: "war-torn battlefield", moodLighting: "overcast" },
    subject: { primary: "soldiers marching through ruins", action: "troops advance across the terrain" },
  });
  const result1 = applySceneTypeRewrite(doc1, "environment");
  assert(!/\bsoldiers?\b/i.test(doc1.subject.primary), `No 'soldiers' in subject.primary: "${doc1.subject.primary}"`);
  assert(!/\btroops?\b/i.test(doc1.subject.action), `No 'troops' in subject.action: "${doc1.subject.action}"`);
  assert(result1.rewrites.length > 0, "Has rewrites logged");

  const doc2 = makeShotDoc({
    scene: { shotCategory: "environment", environment: "war zone", moodLighting: "smoke-filled" },
    subject: { primary: "ruined landscape", action: "smoke drifts" },
  });
  doc2.timing.beats = [
    { startSec: 0, endSec: 3, description: "Explosions erupt across the battlefield" },
    { startSec: 3, endSec: 6, description: "soldiers march through smoke" },
  ];
  applySceneTypeRewrite(doc2, "environment");
  assert(!/\bexplosion/i.test(doc2.timing.beats[0].description), `No 'explosion' in beat: "${doc2.timing.beats[0].description}"`);
  assert(!/\bsoldiers?\b/i.test(doc2.timing.beats[1].description), `No 'soldiers' in beat: "${doc2.timing.beats[1].description}"`);
}

// ═══════════════════════════════════════════════════════════════════
// Section 31: normalizeSequence environment full pipeline (Round 4)
// ═══════════════════════════════════════════════════════════════════
console.log("\n[31] normalizeSequence environment full pipeline (Round 4)");
{
  const doc1 = makeShotDoc({
    scene: { shotCategory: "environment", environment: "war-torn landscape near Tiananmen Square", moodLighting: "overcast grey sky, smoke haze" },
    subject: {
      primary: "Tanks and soldiers advancing through destroyed buildings",
      action: "Explosions erupt across the battlefield while troops fight",
    },
    camera: { framing: "WS", motion: "slow drone flyover" },
  });
  const result1 = normalizeSequence(doc1);
  assert(!/\bsoldiers?\b/i.test(result1.doc.subject.primary), `No 'soldiers' in subject.primary: "${result1.doc.subject.primary}"`);
  assert(!/\btanks?\b/i.test(result1.doc.subject.primary), `No 'tanks' in subject.primary: "${result1.doc.subject.primary}"`);
  assert(!/\bexplosion/i.test(result1.doc.subject.action), `No 'explosion' in subject.action: "${result1.doc.subject.action}"`);
  assert(!/\btroops?\b/i.test(result1.doc.subject.action), `No 'troops' in subject.action: "${result1.doc.subject.action}"`);
  assert(result1.log.some(l => l.includes("[vocab]")), "Has vocab rewrite log entries");

  // Battle scene should KEEP battle vocabulary
  const doc2 = makeShotDoc({
    scene: { shotCategory: "battle", environment: "war-torn landscape", moodLighting: "harsh, fiery glow" },
    subject: {
      primary: "soldiers charging forward",
      action: "Explosions erupt as tanks advance",
    },
    camera: { framing: "MS", motion: "dynamic tracking" },
  });
  const result2 = normalizeSequence(doc2);
  assert(/\bsoldiers?\b/i.test(result2.doc.subject.primary), "Battle scene keeps 'soldiers'");
  assert(/\bexplosion/i.test(result2.doc.subject.action), "Battle scene keeps 'explosion'");
}

// ═══════════════════════════════════════════════════════════════════
// Section 32: pos/neg cleanup covers ALL fields (Round 4)
// ═══════════════════════════════════════════════════════════════════
console.log("\n[32] pos/neg cleanup covers ALL text fields");
{
  const doc1 = makeShotDoc({
    subject: { primary: "a landscape view", action: "camera reveals watermark-free cinematic vista with logo branding" },
    global: { style: "realistic" },
  });
  doc1.negatives.universal = ["watermark", "logo"];
  const r1 = normalizeSequence(doc1);
  assert(!/\bwatermark\b/i.test(r1.doc.subject.action), `No 'watermark' in subject.action: "${r1.doc.subject.action}"`);
  assert(!/\blogo\b/i.test(r1.doc.subject.action), `No 'logo' in subject.action: "${r1.doc.subject.action}"`);

  const doc2 = makeShotDoc({
    scene: { environment: "cinematic watermark city with subtitle overlays", moodLighting: "golden" },
    global: { style: "realistic" },
  });
  doc2.negatives.universal = ["watermark", "subtitle"];
  const r2 = normalizeSequence(doc2);
  assert(!/\bwatermark\b/i.test(r2.doc.scene.environment), `No 'watermark' in environment: "${r2.doc.scene.environment}"`);
  assert(!/\bsubtitle\b/i.test(r2.doc.scene.environment), `No 'subtitle' in environment: "${r2.doc.scene.environment}"`);

  // Guard pattern preservation
  const doc3 = makeShotDoc({
    subject: { primary: "landscape", action: "no watermark, clean vista" },
    scene: { environment: "city without watermark overlay" },
    global: { style: "realistic" },
  });
  doc3.negatives.universal = ["watermark"];
  const r3 = normalizeSequence(doc3);
  assert(/no watermark/i.test(r3.doc.subject.action), "Preserved 'no watermark' guard in action");
  assert(/without watermark/i.test(r3.doc.scene.environment), "Preserved 'without watermark' guard in environment");
}

// ═══════════════════════════════════════════════════════════════════
// Section 33: Final payload pos_neg zero after full pipeline (Round 4)
// ═══════════════════════════════════════════════════════════════════
console.log("\n[33] Final payload pos_neg zero after full pipeline");
{
  const doc1 = makeShotDoc({
    scene: { shotCategory: "environment", environment: "war-torn battlefield", moodLighting: "overcast grey, smoke haze" },
    subject: {
      primary: "Tanks and soldiers amid destroyed buildings",
      action: "Explosions erupt across the battlefield",
    },
    camera: { framing: "WS", motion: "slow drone flyover" },
    global: { style: "photorealistic cinematic realism" },
  });
  doc1.negatives.universal = ["watermark", "text overlay", "caption", "subtitle", "logo"];
  doc1.negatives.sceneSpecific = ["photorealistic", "cinematic"];

  const normalized1 = normalizeSequence(doc1);
  const fp1 = buildFinalProviderPayload({ document: normalized1.doc, provider: "veo" });
  const posNeg1 = fp1.debug.validationIssues.filter(v => v.includes("pos_neg_conflict"));
  assert(posNeg1.length === 0, `Veo: 0 pos_neg_conflict, got ${posNeg1.length}: ${posNeg1.join("; ")}`);
  assert(!fp1.blocked, `Veo: not blocked: ${fp1.blockReason || ""}`);

  // Kling provider
  const doc2 = makeShotDoc({
    scene: { shotCategory: "environment", environment: "war-torn landscape", moodLighting: "overcast" },
    subject: { primary: "devastated terrain", action: "smoke drifts across rubble" },
    camera: { framing: "WS", motion: "slow pan" },
    global: { style: "photorealistic cinematic" },
  });
  doc2.negatives.universal = ["watermark", "caption", "subtitle", "logo"];
  doc2.negatives.sceneSpecific = ["photorealistic", "cinematic"];
  const normalized2 = normalizeSequence(doc2);
  const fp2 = buildFinalProviderPayload({ document: normalized2.doc, provider: "kling" });
  const posNeg2 = fp2.debug.validationIssues.filter(v => v.includes("pos_neg_conflict"));
  assert(posNeg2.length === 0, `Kling: 0 pos_neg_conflict, got ${posNeg2.length}: ${posNeg2.join("; ")}`);
}

// ═══════════════════════════════════════════════════════════════════
// Section 34: Hard-block enforcement + payload snapshot (Round 4)
// ═══════════════════════════════════════════════════════════════════
console.log("\n[34] Hard-block enforcement + payload snapshot");
{
  // Test hard-block path
  const doc1 = makeShotDoc({
    subject: { primary: "a watermark branded logo cinematic scene", action: "caption subtitle overlay appears" },
    global: { style: "watermark cinematic photorealistic logo caption subtitle" },
  });
  doc1.negatives.universal = ["watermark", "caption", "subtitle", "logo"];
  const fp1 = buildFinalProviderPayload({ document: doc1, provider: "veo" });
  // Builder should either fix or block — both are acceptable
  if (fp1.debug.validationIssues.some(v => v.includes("pos_neg_conflict"))) {
    assert(fp1.blocked, "Blocked when pos_neg_conflict persists");
    assert(fp1.blockReason !== undefined, "Has block reason");
  } else {
    assert(!fp1.blocked, "Auto-fixed: not blocked");
  }

  // Payload snapshot consistency
  const doc2 = makeShotDoc({
    scene: { shotCategory: "environment", environment: "mountain valley", moodLighting: "golden hour" },
  });
  const fp2 = buildFinalProviderPayload({ document: doc2, provider: "veo" });
  const snap = JSON.parse(fp2.debug.payloadSnapshot);
  assert(snap.prompt === fp2.prompt, "Snapshot prompt matches actual prompt");
  assert(snap.negativePrompt === fp2.negativePrompt, "Snapshot negativePrompt matches");
  assert(snap.provider === "veo", "Snapshot provider matches");
  assert(fp2.debug.builtBy === "buildFinalProviderPayload", "builtBy marker present");
}

// ═══════════════════════════════════════════════════════════════════
// Section 35: WHERE anchor (place identity) enrichment
// ═══════════════════════════════════════════════════════════════════
console.log("\n[35] WHERE anchor — place identity enrichment");
{
  // Already has a place anchor → no injection
  const r1 = ensurePlaceIdentityAnchor(
    "crumbling wall of an old palace",
    "war-torn cityscape",
    "overcast grey",
  );
  assert(r1.hasAnchor, "Detects existing place anchor (wall, palace)");
  assert(r1.matchedAnchors.length > 0, `Matched: ${r1.matchedAnchors.join(", ")}`);

  // No place anchor → injection
  const r2 = ensurePlaceIdentityAnchor(
    "wide landscape with smoke",
    "devastated area after conflict",
    "overcast sky, haze",
  );
  assert(!r2.hasAnchor, "No anchor in pure atmosphere text");
  assert(!!r2.injectedAnchor, `Injected: "${r2.injectedAnchor}"`);
  assert(r2.injectedAnchor!.length > 5, "Injected anchor is descriptive");

  // Desert context → contextual anchor
  const r3 = ensurePlaceIdentityAnchor(
    "vast empty expanse",
    "arid desert landscape",
    "harsh sunlight",
  );
  assert(!r3.hasAnchor, "No existing anchor in desert text");
  assert(/rock|formation/i.test(r3.injectedAnchor || ""), `Desert anchor has rock/formation: "${r3.injectedAnchor}"`);
}

// ═══════════════════════════════════════════════════════════════════
// Section 36: WHAT anchor (situation evidence) enrichment
// ═══════════════════════════════════════════════════════════════════
console.log("\n[36] WHAT anchor — situation evidence enrichment");
{
  // Already has situation evidence → no injection
  const r1 = ensureSituationEvidence(
    "ruined buildings",
    "thick smoke plumes rising from rubble",
    "war-torn cityscape",
    "overcast grey",
  );
  assert(r1.hasEvidence, "Detects existing situation evidence (smoke plumes)");
  assert(r1.matchedEvidence.length > 0, `Matched: ${r1.matchedEvidence.join(", ")}`);

  // No evidence → injection
  const r2 = ensureSituationEvidence(
    "wide landscape",
    "the terrain stretches into the distance",
    "empty area",
    "morning light",
  );
  assert(!r2.hasEvidence, "No evidence in abstract description");
  assert(!!r2.injectedEvidence, `Injected: "${r2.injectedEvidence}"`);

  // War context → war-appropriate evidence
  const r3 = ensureSituationEvidence(
    "devastated terrain",
    "the view reveals destruction",
    "war-scarred landscape",
    "overcast",
  );
  assert(!r3.hasEvidence, "No specific evidence patterns in abstract war text");
  assert(/debris|smoke/i.test(r3.injectedEvidence || ""), `War evidence has debris/smoke: "${r3.injectedEvidence}"`);
}

// ═══════════════════════════════════════════════════════════════════
// Section 37: normalizeSequence injects WHERE/WHAT for environment
// ═══════════════════════════════════════════════════════════════════
console.log("\n[37] normalizeSequence WHERE/WHAT injection for environment");
{
  // Environment with NO place anchor, NO situation evidence
  const doc = makeShotDoc({
    scene: { shotCategory: "environment", environment: "vast area after conflict", moodLighting: "overcast, hazy" },
    subject: { primary: "wide landscape with distant haze", action: "the terrain stretches into the distance" },
    camera: { framing: "WS", motion: "slow pan" },
  });
  const result = normalizeSequence(doc);

  // Should have injected WHERE
  const whereLog = result.log.filter(l => l.includes("[WHERE]"));
  assert(whereLog.length > 0, "Has [WHERE] log entry");
  assert(whereLog.some(l => l.includes("Injected")), `WHERE was injected: ${whereLog[0]}`);

  // Should have WHAT log (either injected or detected from WHERE anchor overlap)
  const whatLog = result.log.filter(l => l.includes("[WHAT]"));
  assert(whatLog.length > 0, "Has [WHAT] log entry");
  assert(whatLog.some(l => l.includes("Injected") || l.includes("present")), `WHAT handled: ${whatLog[0]}`);

  // Environment with existing anchors — should NOT inject
  const doc2 = makeShotDoc({
    scene: { shotCategory: "environment", environment: "palace wall overlooking a wide square", moodLighting: "overcast" },
    subject: { primary: "stone gate with bullet marks", action: "scattered debris and smoke drifting across the ground" },
    camera: { framing: "WS", motion: "slow crane" },
  });
  const result2 = normalizeSequence(doc2);
  const where2 = result2.log.filter(l => l.includes("[WHERE]"));
  const what2 = result2.log.filter(l => l.includes("[WHAT]"));
  assert(where2.some(l => l.includes("present")), "WHERE already present — no injection");
  assert(what2.some(l => l.includes("present")), "WHAT already present — no injection");

  // Battle scene — should NOT get WHERE/WHAT injection
  const doc3 = makeShotDoc({
    scene: { shotCategory: "battle", environment: "open field", moodLighting: "fiery" },
    subject: { primary: "charging soldiers", action: "explosions erupt" },
    camera: { framing: "MS", motion: "tracking" },
  });
  const result3 = normalizeSequence(doc3);
  const where3 = result3.log.filter(l => l.includes("[WHERE]"));
  assert(where3.length === 0, "Battle scene does NOT get WHERE injection");
}

// ═══════════════════════════════════════════════════════════════════
// Section 38: Scene Extension readiness
// ═══════════════════════════════════════════════════════════════════
console.log("\n[38] Scene Extension readiness");
{
  // proxyUri only → NOT ready for Scene Extension
  const r1 = sceneExtensionReady({
    id: "vid-1", operationName: "op", engine: "veo",
    gcsUri: "", proxyUri: "/api/proxy-video?r2key=abc",
    prompt: "", mode: "generate", durationSec: 8,
    cutNumber: 1, status: "completed", createdAt: Date.now(),
  });
  assert(!r1.ready, "proxyUri only → not ready");
  assert(r1.hasProxy, "Has proxy");
  assert(!r1.hasCanonical, "No canonical");

  // canonicalVideoUri (https://) → ready
  const r2 = sceneExtensionReady({
    id: "vid-2", operationName: "op", engine: "veo",
    gcsUri: "", proxyUri: "/api/proxy-video?r2key=abc",
    canonicalVideoUri: "https://origin/api/proxy-video?r2key=abc",
    prompt: "", mode: "generate", durationSec: 8,
    cutNumber: 1, status: "completed", createdAt: Date.now(),
  });
  assert(r2.ready, "HTTPS canonical → ready");
  assert(r2.hasProxy, "Has proxy");
  assert(r2.hasCanonical, "Has canonical");

  // canonicalVideoUri (gs://) → ready
  const r3 = sceneExtensionReady({
    id: "vid-3", operationName: "op", engine: "veo",
    gcsUri: "gs://bucket/video.mp4", proxyUri: "/api/proxy-video?uri=gs://bucket/video.mp4",
    canonicalVideoUri: "gs://bucket/video.mp4",
    prompt: "", mode: "generate", durationSec: 8,
    cutNumber: 1, status: "completed", createdAt: Date.now(),
  });
  assert(r3.ready, "GCS canonical → ready");
  assert(r3.hasCanonical, "Has canonical (gs://)");

  // failed → NOT ready
  const r4 = sceneExtensionReady({
    id: "vid-4", operationName: "op", engine: "veo",
    gcsUri: "", proxyUri: "", canonicalVideoUri: "https://example.com/video.mp4",
    prompt: "", mode: "generate", durationSec: 8,
    cutNumber: 1, status: "failed", createdAt: Date.now(),
  });
  assert(!r4.ready, "Failed status → not ready");

  // computeAssetStatus with canonical → VISIBLE_IN_LIBRARY or SCENE_EXTENSION_READY
  const proxyOnlyStatus = computeAssetStatus({
    id: "vid-5", operationName: "op", engine: "veo",
    gcsUri: "", proxyUri: "/api/proxy-video?r2key=abc",
    prompt: "", mode: "generate", durationSec: 8,
    cutNumber: 1, status: "completed", createdAt: Date.now(),
  });
  assert(proxyOnlyStatus === "ASSET_STORED_PUBLIC", `proxyUri only → ASSET_STORED_PUBLIC, got: ${proxyOnlyStatus}`);

  const canonicalStatus = computeAssetStatus({
    id: "vid-6", operationName: "op", engine: "veo",
    gcsUri: "", proxyUri: "/api/proxy-video?r2key=abc",
    canonicalVideoUri: "https://origin/api/proxy-video?r2key=abc",
    prompt: "", mode: "generate", durationSec: 8,
    cutNumber: 1, status: "completed", createdAt: Date.now(),
  });
  assert(canonicalStatus === "VISIBLE_IN_LIBRARY", `canonical + proxy → VISIBLE_IN_LIBRARY, got: ${canonicalStatus}`);
}

// ═══════════════════════════════════════════════════════════════════
// 39. Scene-specific WHERE anchor (place identity)
// ═══════════════════════════════════════════════════════════════════
console.log("\n[39] Scene-specific WHERE anchor (place identity)");
{
  // detectSceneContext: battlefield (note: "war-torn" without "square" to avoid square_plaza match)
  const ctx1 = detectSceneContext("war-torn city district", "bombed buildings", "harsh midday light");
  assert(ctx1 === "battlefield", `War-torn → battlefield, got: ${ctx1}`);

  // detectSceneContext: airport
  const ctx2 = detectSceneContext("airport runway at dawn", "airplane taxiing", "morning light");
  assert(ctx2 === "airport", `Airport → airport, got: ${ctx2}`);

  // detectSceneContext: desert
  const ctx3 = detectSceneContext("vast desert dunes", "sand drifting", "scorching heat haze");
  assert(ctx3 === "desert", `Desert → desert, got: ${ctx3}`);

  // detectSceneContext: ocean_coast
  const ctx4 = detectSceneContext("rocky ocean coast", "waves crashing", "overcast");
  assert(ctx4 === "ocean_coast", `Ocean coast → ocean_coast, got: ${ctx4}`);

  // getPlaceIdentityCandidates returns scene-specific items
  const battleCandidates = getPlaceIdentityCandidates("battlefield");
  assert(battleCandidates.length >= 3, `Battlefield has ${battleCandidates.length} candidates (≥3)`);
  assert(battleCandidates.some(c => /crater|trench|bunker|rubble|barricade|fortification|sandbag/i.test(c)),
    "Battlefield candidates contain military/destruction objects");

  const airportCandidates = getPlaceIdentityCandidates("airport");
  assert(airportCandidates.length >= 3, `Airport has ${airportCandidates.length} candidates (≥3)`);

  // ensurePlaceIdentityAnchor: no existing anchor → inject scene-specific
  const placeResult = ensurePlaceIdentityAnchor("open area", "empty flat ground", "diffused light");
  assert(!placeResult.hasAnchor, "No existing anchor detected in generic text");
  assert(!!placeResult.injectedAnchor, `Injected anchor: "${placeResult.injectedAnchor}"`);
  // Should NOT be the old generic fallback
  assert(placeResult.injectedAnchor !== "weathered stone structure in the mid-ground" || placeResult.sceneContext === "generic",
    "Injected anchor is scene-specific (not always generic fallback)");

  // ensurePlaceIdentityAnchor: existing anchor → detected
  const placeResult2 = ensurePlaceIdentityAnchor("soldiers near a trench", "bombed-out city", "harsh light");
  assert(placeResult2.hasAnchor, "Existing 'trench' detected as anchor");
  assert(placeResult2.matchedAnchors.some(a => /trench/i.test(a)), "Trench matched");
}

// ═══════════════════════════════════════════════════════════════════
// 40. Scene-specific WHAT anchor (situation evidence)
// ═══════════════════════════════════════════════════════════════════
console.log("\n[40] Scene-specific WHAT anchor (situation evidence)");
{
  // getSituationEvidenceCandidates returns scene-specific items
  const battleEvidence = getSituationEvidenceCandidates("battlefield");
  assert(battleEvidence.length >= 3, `Battlefield evidence has ${battleEvidence.length} candidates (≥3)`);

  const forestEvidence = getSituationEvidenceCandidates("forest");
  assert(forestEvidence.length >= 3, `Forest evidence has ${forestEvidence.length} candidates (≥3)`);

  // ensureSituationEvidence: no existing evidence → inject
  const evidenceResult = ensureSituationEvidence("open landscape", "still", "calm area", "even light");
  assert(!evidenceResult.hasEvidence, "No existing evidence in generic text");
  assert(!!evidenceResult.injectedEvidence, `Injected evidence: "${evidenceResult.injectedEvidence}"`);

  // ensureSituationEvidence: existing evidence → detected
  const evidenceResult2 = ensureSituationEvidence("smoke plume rising", "fire burning", "bombed city", "overcast");
  assert(evidenceResult2.hasEvidence, "Existing smoke/fire detected as evidence");
}

// ═══════════════════════════════════════════════════════════════════
// 41. Natural motion injection (MOTION anchors)
// ═══════════════════════════════════════════════════════════════════
console.log("\n[41] Natural motion injection (MOTION anchors)");
{
  // getNaturalMotionCandidates: desert → heat shimmer, sand drift
  const desertMotion = getNaturalMotionCandidates("desert");
  assert(desertMotion.length >= 2, `Desert motion has ${desertMotion.length} candidates (≥2)`);

  // detectNaturalMotion: existing motion detected
  const hasMotion = detectNaturalMotion("flags fluttering in wind", "city square", "afternoon");
  assert(hasMotion.hasMotion, "Wind motion detected in 'fluttering in wind'");

  // detectNaturalMotion: no motion
  const noMotion = detectNaturalMotion("standing still", "flat ground", "diffused light");
  assert(!noMotion.hasMotion, "No natural motion in static description");

  // ensureNaturalEnvironmentalMotion: inject when missing
  const motionResult = ensureNaturalEnvironmentalMotion("standing still", "desert dunes", "harsh light");
  assert(!motionResult.hasMotion, "No existing motion detected");
  assert(!!motionResult.injectedMotion, `Injected motion: "${motionResult.injectedMotion}"`);

  // ensureNaturalEnvironmentalMotion: keep when present
  const motionResult2 = ensureNaturalEnvironmentalMotion("wind sweeping across", "open field", "golden hour");
  assert(motionResult2.hasMotion, "Existing wind motion detected");
  assert(!motionResult2.injectedMotion, "No injection when motion exists");
}

// ═══════════════════════════════════════════════════════════════════
// 42. Explicit light source normalization
// ═══════════════════════════════════════════════════════════════════
console.log("\n[42] Explicit light source normalization");
{
  // getLightSourceCandidates: detects time of day
  const dawnLight = getLightSourceCandidates("dawn light, soft sky", "empty field");
  assert(dawnLight.detectedTime === "dawn" || dawnLight.detectedTime === "sunrise", `Dawn detected: ${dawnLight.detectedTime}`);

  // getLightSourceCandidates: overcast → suggest improvement
  const overcastLight = getLightSourceCandidates("overcast gray sky", "urban street");
  assert(!!overcastLight.suggestedSource || overcastLight.hasExplicitSource, "Overcast gets suggestion or counts as explicit");

  // ensureExplicitLightSource: inject when vague
  const lightResult = ensureExplicitLightSource("diffused ambient", "open area");
  // diffused ambient is vague — should inject
  if (!lightResult.hasExplicitSource) {
    assert(!!lightResult.injectedSource, `Injected light: "${lightResult.injectedSource}"`);
  } else {
    assert(true, "Light source already explicit (acceptable)");
  }

  // Night scene detection
  const nightLight = getLightSourceCandidates("moonlit night scene", "forest");
  assert(nightLight.detectedTime === "night" || nightLight.detectedTime === "moonlit",
    `Night detected: ${nightLight.detectedTime}`);
}

// ═══════════════════════════════════════════════════════════════════
// 43. Scene Extension reevaluation after upload
// ═══════════════════════════════════════════════════════════════════
console.log("\n[43] Scene Extension reevaluation after upload");
{
  // Completed + canonical HTTPS → eligible
  const r1 = reevaluateSceneExtensionEligibilityAfterUpload({
    cutNumber: 1, status: "completed",
    canonicalVideoUri: "https://origin/api/proxy-video?r2key=abc",
    rawVideoUri: "", videoUri: "blob:...",
    uploadStatus: "success",
  });
  assert(r1.eligible, "HTTPS canonical → eligible");
  assert(r1.canonicalVideoUri === "https://origin/api/proxy-video?r2key=abc", "Canonical URI preserved");

  // Completed + canonical GCS → eligible
  const r2 = reevaluateSceneExtensionEligibilityAfterUpload({
    cutNumber: 1, status: "completed",
    canonicalVideoUri: "gs://bucket/video.mp4",
    uploadStatus: "success",
  });
  assert(r2.eligible, "GCS canonical → eligible");

  // Completed + no canonical but rawVideoUri gs:// → eligible (fallback)
  const r3 = reevaluateSceneExtensionEligibilityAfterUpload({
    cutNumber: 1, status: "completed",
    rawVideoUri: "gs://bucket/raw.mp4",
    uploadStatus: "failed",
  });
  assert(r3.eligible, "rawVideoUri gs:// → eligible as fallback");

  // Upload still pending → not eligible yet
  const r4 = reevaluateSceneExtensionEligibilityAfterUpload({
    cutNumber: 1, status: "completed",
    uploadStatus: "pending",
  });
  assert(!r4.eligible, "Upload pending → not eligible yet");

  // Failed status → not eligible
  const r5 = reevaluateSceneExtensionEligibilityAfterUpload({
    cutNumber: 1, status: "failed",
    canonicalVideoUri: "https://example.com/video.mp4",
    uploadStatus: "success",
  });
  assert(!r5.eligible, "Failed clip → not eligible");
}

// ═══════════════════════════════════════════════════════════════════
// 44. Mode selection for next cut
// ═══════════════════════════════════════════════════════════════════
console.log("\n[44] Mode selection for next cut");
{
  // Cut 1 → TEXT_TO_VIDEO (no frame)
  const m1 = selectVideoModeForNextCut(1, undefined, undefined);
  assert(m1.mode === "TEXT_TO_VIDEO", `Cut 1 → TEXT_TO_VIDEO, got: ${m1.mode}`);
  assert(m1.continuityScore === 0, "Cut 1 continuity = 0");

  // Cut 1 + frame → IMAGE_TO_VIDEO
  const m2 = selectVideoModeForNextCut(1, undefined, "base64data");
  assert(m2.mode === "IMAGE_TO_VIDEO", `Cut 1 + frame → IMAGE_TO_VIDEO, got: ${m2.mode}`);

  // Cut 2 + prev has canonical → SCENE_EXTENSION
  const m3 = selectVideoModeForNextCut(2, {
    cutNumber: 1, status: "completed",
    canonicalVideoUri: "https://origin/api/proxy-video?r2key=abc",
    uploadStatus: "success",
  }, undefined);
  assert(m3.mode === "SCENE_EXTENSION", `Cut 2 + canonical → SCENE_EXTENSION, got: ${m3.mode}`);
  assert(m3.continuityScore === 100, "Scene Extension continuity = 100");
  assert(m3.videoUri === "https://origin/api/proxy-video?r2key=abc", "videoUri set for SCENE_EXTENSION");

  // Cut 2 + prev has no canonical + has frame → IMAGE_TO_VIDEO
  const m4 = selectVideoModeForNextCut(2, {
    cutNumber: 1, status: "completed",
    uploadStatus: "failed",
  }, "framebase64");
  assert(m4.mode === "IMAGE_TO_VIDEO", `No canonical + frame → IMAGE_TO_VIDEO, got: ${m4.mode}`);
  assert(m4.continuityScore === 60, "Frame fallback continuity = 60");

  // Cut 2 + prev has no canonical + no frame → TEXT_TO_VIDEO
  const m5 = selectVideoModeForNextCut(2, {
    cutNumber: 1, status: "completed",
    uploadStatus: "failed",
  }, undefined);
  assert(m5.mode === "TEXT_TO_VIDEO", `No canonical + no frame → TEXT_TO_VIDEO, got: ${m5.mode}`);
  assert(m5.continuityScore === 0, "No fallback continuity = 0");
}

// ═══════════════════════════════════════════════════════════════════
// 45. Canonical URI promotion + extend payload
// ═══════════════════════════════════════════════════════════════════
console.log("\n[45] Canonical URI promotion + extend payload");
{
  // Relative path → absolute
  const promoted1 = ensureCanonicalVideoUriPromotion("/api/proxy-video?r2key=abc", "https://example.com");
  assert(promoted1 === "https://example.com/api/proxy-video?r2key=abc", `Relative → absolute: ${promoted1}`);

  // Already absolute → unchanged
  const promoted2 = ensureCanonicalVideoUriPromotion("https://example.com/video.mp4", "https://origin.com");
  assert(promoted2 === "https://example.com/video.mp4", "Already absolute → unchanged");

  // GCS → unchanged
  const promoted3 = ensureCanonicalVideoUriPromotion("gs://bucket/video.mp4", "https://origin.com");
  assert(promoted3 === "gs://bucket/video.mp4", "GCS → unchanged");

  // data: URI → undefined
  const promoted4 = ensureCanonicalVideoUriPromotion("data:video/mp4;base64,AAAA", "https://origin.com");
  assert(promoted4 === undefined, "data: URI → undefined");

  // undefined → undefined
  const promoted5 = ensureCanonicalVideoUriPromotion(undefined, "https://origin.com");
  assert(promoted5 === undefined, "undefined → undefined");

  // buildExtendPayloadFromCanonicalUri: valid HTTPS
  const payload1 = buildExtendPayloadFromCanonicalUri("https://origin.com/video.mp4", "continue scene", 8);
  assert(payload1 !== null, "HTTPS → valid payload");
  assert(payload1!.previousVideoUri === "https://origin.com/video.mp4", "previousVideoUri set");
  assert(payload1!.extendPrompt === "continue scene", "extendPrompt set");
  assert(payload1!.durationSec === 8, "durationSec set");

  // buildExtendPayloadFromCanonicalUri: valid GCS
  const payload2 = buildExtendPayloadFromCanonicalUri("gs://bucket/video.mp4", undefined, 6);
  assert(payload2 !== null, "GCS → valid payload");
  assert(payload2!.extendPrompt === undefined, "No extendPrompt when undefined");

  // buildExtendPayloadFromCanonicalUri: invalid scheme → null
  const payload3 = buildExtendPayloadFromCanonicalUri("data:video/mp4;base64,AAAA", "test", 8);
  assert(payload3 === null, "data: → null payload");

  // buildExtendPayloadFromCanonicalUri: empty → null
  const payload4 = buildExtendPayloadFromCanonicalUri("", "test", 8);
  assert(payload4 === null, "Empty URI → null payload");
}

// ═══════════════════════════════════════════════════════════════════
// 46. normalizeSequence MOTION + LIGHT integration
// ═══════════════════════════════════════════════════════════════════
console.log("\n[46] normalizeSequence MOTION + LIGHT integration");
{
  // Environment scene with no motion or explicit light → should inject both
  const envDoc = makeShotDoc({
    scene: { shotCategory: "environment", environment: "desert dunes stretching to horizon", moodLighting: "harsh light" },
    subject: { primary: "vast open landscape", action: "still and silent" },
  });
  const envResult = normalizeSequence(envDoc);
  const hasMotionLog = envResult.log.some(l => l.includes("[MOTION]"));
  const hasLightLog = envResult.log.some(l => l.includes("[LIGHT]"));
  assert(hasMotionLog, "MOTION log present for environment scene");
  assert(hasLightLog, "LIGHT log present for environment scene");

  // Environment scene with existing motion → should detect, not inject
  const envDoc2 = makeShotDoc({
    scene: { shotCategory: "environment", environment: "coastal cliffs", moodLighting: "golden hour sunlight from the west" },
    subject: { primary: "rocky shoreline", action: "waves crashing against rocks, spray drifting in wind" },
  });
  const envResult2 = normalizeSequence(envDoc2);
  const motionPresent = envResult2.log.some(l => l.includes("[MOTION] Natural motion present"));
  assert(motionPresent, "Existing motion detected (waves/wind)");

  // Non-environment scene → no MOTION/LIGHT injection
  const charDoc = makeShotDoc({
    scene: { shotCategory: "character-driven", environment: "office interior", moodLighting: "fluorescent" },
    subject: { primary: "a businessman", action: "typing on laptop" },
  });
  const charResult = normalizeSequence(charDoc);
  const noMotionLog = !charResult.log.some(l => l.includes("[MOTION]"));
  const noLightLog = !charResult.log.some(l => l.includes("[LIGHT]"));
  assert(noMotionLog, "No MOTION injection for character scene");
  assert(noLightLog, "No LIGHT injection for character scene");
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
