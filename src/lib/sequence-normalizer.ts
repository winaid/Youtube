/**
 * sequence-normalizer.ts — 전역 시퀀스 정규화 엔진
 *
 * source of truth(StructuredSequenceDocument)가 "생성 직후 그대로"가 아니라
 * "정규화된 structured sequence"가 되도록 보장.
 *
 * 파이프라인:
 * 1. inferSceneType — 씬 타입 추론/검증
 * 2. sanitizeCharacterRef — characterRef 의도 정합성 검사
 * 3. detectOverloadedShot — 과부하 shot 감지
 * 4. resolveCameraActionConsistency — camera-action 정합성
 * 5. enforceDescriptiveCoverage — sceneType별 coverage 보장
 * 6. sanitizePositiveNegativeConflicts — pos/neg 충돌 제거
 * 7. enforceMediumLock — medium lock 규칙
 * 8. output normalized sequence
 */

import type { SingleShotDocument } from "@/lib/sequence-assembler";
import { resolveSceneType, applySceneTypeVocabularyRules, type SceneType } from "@/lib/scene-type-rules";

// ═══════════════════════════════════════════════════════════════════
// 1. Scene Type Inference
// ═══════════════════════════════════════════════════════════════════

/** scene intent 키워드 → sceneType 매핑 (shotCategory 없을 때 추론용) */
const SCENE_INTENT_PATTERNS: Array<{ pattern: RegExp; sceneType: SceneType }> = [
  { pattern: /\b(landscape|skyline|mountain|valley|river|ocean|forest|desert|plain|field|terrain|horizon|cityscape|aerial\s+view)\b/i, sceneType: "environment" },
  { pattern: /\b(crowd|protest|parade|gathering|assembly|mass|rally|march(?:ing)?|throng|mob|multitude)\b/i, sceneType: "crowd" },
  { pattern: /\b(battle|war|fight|combat|clash|siege|assault|bombard|attack|explosion|warfare)\b/i, sceneType: "battle" },
  { pattern: /\b(map|terrain\s+surface|relief\s+map|topograph|globe|continent|territorial|border\s+line|cartograph)\b/i, sceneType: "map_visualization" },
  { pattern: /\b(product|packaging|bottle|device|gadget|item\s+on\s+display|merchandise)\b/i, sceneType: "product" },
  { pattern: /\b(portrait|headshot|face\s+close|facial\s+study|bust\s+shot)\b/i, sceneType: "portrait" },
];

/**
 * 씬 타입을 추론 또는 검증.
 * shotCategory가 이미 있으면 검증만, 없으면 텍스트에서 추론.
 */
export function inferSceneType(
  shotCategory: string | undefined,
  subjectText: string,
  actionText: string,
  environmentText: string,
): { sceneType: SceneType | null; inferred: boolean; confidence: "high" | "medium" | "low" } {
  // shotCategory가 명시적이면 그대로 사용
  const existing = resolveSceneType(shotCategory);
  if (existing) {
    return { sceneType: existing, inferred: false, confidence: "high" };
  }

  // 텍스트에서 추론
  const fullText = `${subjectText} ${actionText} ${environmentText}`.toLowerCase();
  for (const { pattern, sceneType } of SCENE_INTENT_PATTERNS) {
    if (pattern.test(fullText)) {
      return { sceneType, inferred: true, confidence: "medium" };
    }
  }

  // character-driven 기본 추론: 인물 키워드
  if (/\b(person|man|woman|child|figure|character|soldier|officer|leader|king|queen|general|warrior|monk|priest|elder)\b/i.test(fullText)) {
    return { sceneType: "character-driven", inferred: true, confidence: "low" };
  }

  return { sceneType: null, inferred: false, confidence: "low" };
}

// ═══════════════════════════════════════════════════════════════════
// 2. Character Reference Sanitizer
// ═══════════════════════════════════════════════════════════════════

/** 현대적/generic characterRef 패턴 — historical scene에서 금지 */
const MODERN_GENERIC_CHAR_PATTERNS = [
  /\byoung\s+(?:person|adult|man|woman),?\s*(?:casual|modern|contemporary)\s+(?:clothing|outfit|wear|attire)\b/i,
  /\bcasual\s+modern\s+(?:clothing|outfit|wear|attire)\b/i,
  /\bgeneric\s+(?:person|figure|character)\b/i,
  /\bplaceholder\s+(?:character|person|figure)\b/i,
  /\bdefault\s+(?:character|person|appearance)\b/i,
  /\bt[\s-]?shirt\s+and\s+jeans\b/i,
  /\bsneakers?\b/i,
  /\bbaseball\s+cap\b/i,
  /\bhoodie\b/i,
];

/** historical intent 감지 */
const HISTORICAL_INTENT_PATTERNS = [
  /\b(ancient|medieval|dynasty|empire|kingdom|century|era|period|historical|colonial|wartime|pre[\s-]?war|post[\s-]?war)\b/i,
  /\b(1[0-9]{3}|20[0-3][0-9])s?\b/, // 연도 패턴
  /\b(roman|greek|egyptian|ottoman|ming|qing|joseon|edo|viking|samurai|crusade|renaissance)\b/i,
  /\b(revolution|independence|civil\s+war|world\s+war|liberation|uprising)\b/i,
];

export interface CharacterRefSanitizeResult {
  characterRef: string | undefined;
  action: "kept" | "removed" | "replaced";
  reason?: string;
}

/**
 * characterRef가 장면 의도와 일치하는지 검사.
 * - historical scene + modern generic ref → 제거 또는 대체
 * - placeholder ref → 제거
 * - 빈 ref → undefined
 */
export function sanitizeCharacterRef(
  characterRef: string | undefined,
  sceneDescription: string,
  subjectText: string,
  shotCategory?: string,
): CharacterRefSanitizeResult {
  if (!characterRef || characterRef.trim().length === 0) {
    return { characterRef: undefined, action: "kept" };
  }

  const trimmed = characterRef.trim();

  // 1. placeholder/empty ref 제거
  if (trimmed.length < 5 || /^(none|n\/a|unknown|placeholder|default|tbd)$/i.test(trimmed)) {
    return { characterRef: undefined, action: "removed", reason: "placeholder or empty characterRef" };
  }

  // 2. historical scene intent 확인
  const fullContext = `${sceneDescription} ${subjectText} ${shotCategory || ""}`;
  const isHistorical = HISTORICAL_INTENT_PATTERNS.some(p => p.test(fullContext));

  if (isHistorical) {
    // modern/generic ref 감지
    for (const pattern of MODERN_GENERIC_CHAR_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          characterRef: undefined,
          action: "removed",
          reason: `Modern/generic characterRef "${trimmed.slice(0, 60)}" conflicts with historical scene intent`,
        };
      }
    }
  }

  // 3. environment scene에서는 characterRef 제한
  const sceneType = resolveSceneType(shotCategory);
  if (sceneType === "environment" || sceneType === "map_visualization") {
    // environment/map에 character가 있으면 downgrade (완전 제거는 아님)
    if (/\b(close[\s-]?up|detailed\s+face|facial|portrait|head[\s-]?shot)\b/i.test(trimmed)) {
      return {
        characterRef: trimmed.replace(/\b(close[\s-]?up|detailed\s+face|facial|portrait|head[\s-]?shot)\b/gi, "").replace(/\s{2,}/g, " ").trim() || undefined,
        action: "replaced",
        reason: `Removed close-up/portrait terms from characterRef for ${sceneType} scene`,
      };
    }
  }

  return { characterRef: trimmed, action: "kept" };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Overloaded Shot Detector
// ═══════════════════════════════════════════════════════════════════

/** 사건 유형별 감지 패턴 */
const EVENT_CATEGORIES = {
  establishing: /\b(establishing|sets\s+the\s+scene|opens\s+with|wide\s+view\s+of|panoramic\s+opening|reveal(?:s|ing)?\s+the\s+(?:city|landscape|scene))\b/i,
  character_action: /\b(walks|runs|turns|reaches|grabs|pulls|pushes|draws\s+(?:sword|weapon)|raises|kneels|stands\s+up|approaches|confronts)\b/i,
  emotional_reaction: /\b(tears|weeps|smiles|gasps|trembles|freezes|shocked|devastated|overjoyed|despair|grief|joy|anguish|fury)\b/i,
  vehicle_departure: /\b(drives?\s+away|departs|leaves|sets?\s+sail|takes?\s+off|lifts?\s+off|train\s+pulls|car\s+speeds|ship\s+departs)\b/i,
  explosion_impact: /\b(explod|explosion|impact|crash|collis|destruct|demolish|shatter|detona|blast)\b/i,
  revelation: /\b(reveal(?:s|ed|ing)?|discover(?:s|ed|ing)?|uncover(?:s|ed|ing)?|realize(?:s|d)?|plot\s+twist|truth\s+(?:is|comes))\b/i,
  outcome: /\b(falls?\s+(?:dead|down|to\s+the\s+ground)|surrender|victory|defeat|collapse|death|die[sd]?|kills?|wins?|loses?)\b/i,
};

export interface OverloadedShotResult {
  overloaded: boolean;
  eventCount: number;
  events: string[];
  suggestion?: string;
}

/**
 * 하나의 shot에 과도한 사건이 압축되어 있는지 감지.
 * 3개 이상의 서로 다른 사건 유형이 하나의 shot에 존재하면 overloaded.
 */
export function detectOverloadedShot(
  subjectText: string,
  actionText: string,
  timingBeats: Array<{ description: string }>,
  durationSec: number,
): OverloadedShotResult {
  const fullText = `${subjectText} ${actionText} ${timingBeats.map(b => b.description).join(" ")}`;
  const detectedEvents: string[] = [];

  for (const [category, pattern] of Object.entries(EVENT_CATEGORIES)) {
    if (pattern.test(fullText)) {
      detectedEvents.push(category);
    }
  }

  // 4-6초 shot에 3+개 사건 = overloaded
  // 8초 shot에 4+개 사건 = overloaded
  const maxEvents = durationSec <= 6 ? 2 : 3;
  const overloaded = detectedEvents.length > maxEvents;

  let suggestion: string | undefined;
  if (overloaded) {
    if (detectedEvents.length >= 4) {
      suggestion = `Split into ${Math.ceil(detectedEvents.length / 2)} shots: ${detectedEvents.slice(0, 2).join(" + ")} → shot A, ${detectedEvents.slice(2).join(" + ")} → shot B`;
    } else {
      suggestion = `Reduce to ${maxEvents} events maximum. Current: ${detectedEvents.join(", ")}. Consider removing the least visually important event.`;
    }
  }

  return { overloaded, eventCount: detectedEvents.length, events: detectedEvents, suggestion };
}

// ═══════════════════════════════════════════════════════════════════
// 4. Camera-Action Consistency
// ═══════════════════════════════════════════════════════════════════

/** action density 분류 */
const ACTION_DENSITY_PATTERNS = {
  multi_stage: /\b(then|and\s+then|followed\s+by|before|after\s+which|subsequently|next|finally|meanwhile|simultaneously)\b/gi,
  complex_action: /\b(while|as\s+(?:he|she|they|the)|at\s+the\s+same\s+time|simultaneously|intercut)\b/gi,
};

export interface CameraActionResult {
  consistent: boolean;
  issues: string[];
  suggestion?: string;
}

/**
 * camera plan과 action density가 맞는지 검사.
 * - static wide shot + complex multi-stage action = 충돌
 * - close-up + many characters moving = 충돌
 */
export function checkCameraActionConsistency(
  framing: string,
  motion: string,
  actionText: string,
  sceneType: SceneType | null,
): CameraActionResult {
  const issues: string[] = [];
  const framingUpper = framing.toUpperCase();

  // multi-stage action 감지
  const stageMatches = actionText.match(ACTION_DENSITY_PATTERNS.multi_stage);
  const stageCount = stageMatches ? stageMatches.length : 0;

  const complexMatches = actionText.match(ACTION_DENSITY_PATTERNS.complex_action);
  const complexCount = complexMatches ? complexMatches.length : 0;

  const actionDensity = stageCount + complexCount;

  // static/slow + high-density action = 충돌
  const isStatic = !motion || motion === "static" || /\bstatic\b/i.test(motion);
  const isSlow = /\b(slow|gentle|subtle|gradual)\b/i.test(motion) && !motion.includes("push") && !motion.includes("dolly");

  if ((isStatic || isSlow) && actionDensity >= 3) {
    issues.push(`Static/slow camera with high-density action (${actionDensity} stages) — camera should track action or reduce action complexity`);
  }

  // wide shot + multi-character close interaction
  if (["WS", "LS"].includes(framingUpper)) {
    if (/\b(whisper|murmur|tear\s+(?:rolls?|falls?)|subtle\s+(?:smile|frown|grimace)|micro[\s-]?expression)\b/i.test(actionText)) {
      issues.push("Wide framing cannot capture subtle micro-expressions or whispers — tighten framing or simplify action");
    }
  }

  // close-up + wide-scale action
  if (["CU", "ECU"].includes(framingUpper)) {
    if (/\b(army|legion|battalion|fleet|squadron|crowd\s+(?:moves?|surges?|rushes?))\b/i.test(actionText)) {
      issues.push("Close-up framing with mass-scale action — widen framing or focus on individual reaction");
    }
  }

  // environment scene + complex character action
  if (sceneType === "environment" && actionDensity >= 2) {
    issues.push(`Environment scene with ${actionDensity} action stages — simplify to ambient environmental motion`);
  }

  let suggestion: string | undefined;
  if (issues.length > 0) {
    if (sceneType === "environment") {
      suggestion = "Replace multi-stage character action with single continuous environmental motion (e.g., wind, clouds, water flow)";
    } else if (actionDensity >= 3) {
      suggestion = "Split into multiple shots or reduce to 1-2 key actions per shot";
    }
  }

  return { consistent: issues.length === 0, issues, suggestion };
}

// ═══════════════════════════════════════════════════════════════════
// 5. Descriptive Coverage by Scene Type
// ═══════════════════════════════════════════════════════════════════

/** character scene 필수 요소 */
const CHARACTER_COVERAGE = [
  { name: "age_impression", check: /\b(young|old|elderly|middle[\s-]?aged|teen|child|infant|adult|aged|youthful|mature)\b/i, fallback: "adult figure" },
  { name: "hair_or_head", check: /\b(hair|bald|shaved|turban|hood|hat|crown|helmet|head[\s-]?cover|braids?|ponytail|short[\s-]?hair|long[\s-]?hair)\b/i, fallback: "" },
  { name: "clothing", check: /\b(wearing|dressed|cloth|garment|robe|suit|armor|uniform|tunic|cloak|gown|outfit|coat|jacket|shirt|dress)\b/i, fallback: "" },
  { name: "posture_or_expression", check: /\b(standing|sitting|kneeling|crouching|leaning|hunched|upright|slumped|expression|gaze|stare|frown|smile|stern|weary|determined)\b/i, fallback: "" },
  { name: "light_direction", check: /\b(light|backlit|sidelit|rim[\s-]?light|key[\s-]?light|shadow|silhouett|illuminat|golden\s+hour|blue\s+hour|overhead\s+light)\b/i, fallback: "" },
];

/** crowd scene 필수 요소 */
const CROWD_COVERAGE = [
  { name: "spatial_scale", check: /\b(vast|hundreds|thousands|massive|enormous|stretching|filling|packed|dense|sparse|scattered)\b/i, fallback: "dense crowd filling the frame" },
  { name: "movement_pattern", check: /\b(march|flow|surge|wave|drift|push|stream|pour|mill|sway|chant|rally)\b/i, fallback: "crowd in collective rhythmic motion" },
  { name: "environmental_motion", check: /\b(flag|banner|smoke|dust|confetti|torch|lantern|sign|placard)\b/i, fallback: "flags and dust in the air" },
  { name: "camera_relation", check: /\b(above|below|within|amid|through|over|across|surrounding|encircl)\b/i, fallback: "camera positioned above the crowd" },
];

export interface CoverageCheckResult {
  sceneType: SceneType;
  covered: number;
  total: number;
  missing: string[];
  additions: string[];
  sufficient: boolean;
}

/**
 * sceneType별 descriptive coverage 검사.
 * word count가 아닌 semantic coverage로 판단.
 */
export function checkDescriptiveCoverage(
  fullText: string,
  sceneType: SceneType,
): CoverageCheckResult {
  let checks: Array<{ name: string; check: RegExp; fallback: string }>;
  let minCoverage: number;

  switch (sceneType) {
    case "character-driven":
    case "person":
    case "portrait":
      checks = CHARACTER_COVERAGE;
      minCoverage = 3; // 5개 중 3개
      break;
    case "crowd":
      checks = CROWD_COVERAGE;
      minCoverage = 3; // 4개 중 3개
      break;
    case "environment":
      // environment는 scene-type-rules.ts의 requiredElements 사용
      checks = [
        { name: "sky", check: /\b(sky|cloud|sun|moon|star|dawn|dusk|twilight|overcast)\b/i, fallback: "overcast sky with diffused light" },
        { name: "light", check: /\b(light|sunlight|moonlight|golden|shadow|illuminat|backlit|sidelit)\b/i, fallback: "soft natural light" },
        { name: "atmosphere", check: /\b(haze|fog|mist|dust|smoke|particle|vapor|atmosphere)\b/i, fallback: "subtle atmospheric haze" },
        { name: "ground", check: /\b(ground|terrain|soil|rock|grass|sand|stone|surface|gravel|road|path)\b/i, fallback: "textured ground surface" },
        { name: "scale", check: /\b(scale|vast|expansive|stretching|towering|immense|panoramic|sprawling|depth)\b/i, fallback: "sense of vast scale" },
      ];
      minCoverage = 3;
      break;
    default:
      return { sceneType, covered: 0, total: 0, missing: [], additions: [], sufficient: true };
  }

  const missing: string[] = [];
  const additions: string[] = [];
  let covered = 0;

  for (const { name, check, fallback } of checks) {
    if (check.test(fullText)) {
      covered++;
    } else {
      missing.push(name);
      if (fallback) additions.push(fallback);
    }
  }

  return {
    sceneType,
    covered,
    total: checks.length,
    missing,
    additions,
    sufficient: covered >= minCoverage,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 6. Lighting Normalization
// ═══════════════════════════════════════════════════════════════════

/**
 * 서로 충돌하는 lighting 속성을 하나의 coherent profile로 정규화.
 *
 * 규칙:
 * - warm + cool/blue 충돌 → warm 우선 (golden hour), cool 제거
 * - bright/harsh + soft/diffused 충돌 → 하나로 통합
 * - 3개 이상 lighting 형용사 → 최대 2개로 축약
 */
export interface LightingNormalizeResult {
  text: string;
  normalized: boolean;
  profile: string;
}

const WARM_PATTERNS = /\b(warm|golden|amber|sunset|sunrise|late\s+afternoon|golden\s+hour|warm\s+sunny\s+glow)\b/gi;
const COOL_PATTERNS = /\b(cool|blue[-\s]?grey|blue[-\s]?cast|cold|icy|steel[-\s]?blue|blue[-\s]?tint|blue[-\s]?gray)\b/gi;
const HARSH_PATTERNS = /\b(harsh|bright\s+daylight|strong\s+intense|direct\s+sunlight|midday\s+sun|overhead\s+sun|blazing)\b/gi;
const SOFT_PATTERNS = /\b(soft|diffused|gentle|muted|subdued|overcast|cloudy)\b/gi;

export function normalizeLightingDescription(moodLighting: string): LightingNormalizeResult {
  const hasWarm = WARM_PATTERNS.test(moodLighting);
  WARM_PATTERNS.lastIndex = 0;
  const hasCool = COOL_PATTERNS.test(moodLighting);
  COOL_PATTERNS.lastIndex = 0;
  const hasHarsh = HARSH_PATTERNS.test(moodLighting);
  HARSH_PATTERNS.lastIndex = 0;
  const hasSoft = SOFT_PATTERNS.test(moodLighting);
  SOFT_PATTERNS.lastIndex = 0;

  // No conflict → return as is
  if (!(hasWarm && hasCool) && !(hasHarsh && hasSoft)) {
    return { text: moodLighting, normalized: false, profile: "consistent" };
  }

  let result = moodLighting;
  let profile = "";

  if (hasWarm && hasCool) {
    // Warm/cool conflict: pick warm, remove cool descriptors
    result = result.replace(COOL_PATTERNS, "").replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
    COOL_PATTERNS.lastIndex = 0;
    profile = "warm-dominant";
  }

  if (hasHarsh && hasSoft) {
    // Harsh/soft conflict: merge to directional natural light
    result = result
      .replace(HARSH_PATTERNS, "")
      .replace(SOFT_PATTERNS, "")
      .replace(/\s{2,}/g, " ")
      .replace(/,\s*,/g, ",")
      .trim();
    HARSH_PATTERNS.lastIndex = 0;
    SOFT_PATTERNS.lastIndex = 0;
    result = result ? `${result}, natural directional light with defined shadows` : "natural directional light with defined shadows";
    profile = profile ? `${profile}, balanced-intensity` : "balanced-intensity";
  }

  // Cleanup trailing/leading commas and dots
  result = result.replace(/^[,.\s]+/, "").replace(/[,.\s]+$/, "").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();

  return { text: result, normalized: true, profile: profile || "normalized" };
}

// ═══════════════════════════════════════════════════════════════════
// 7. Environment Action Density Rewriter
// ═══════════════════════════════════════════════════════════════════

/**
 * Environment scene에서 arrow(→)/progression 패턴을 continuous spatial exploration으로 rewrite.
 * "X → Y → Z" 같은 progressive emphasis를 단일 연속 movement로 변환.
 */
export interface ActionDensityRewriteResult {
  text: string;
  rewritten: boolean;
  motionSuggestion?: string;
}

const ARROW_PATTERN = /(.+?)\s*[→➜➡>]\s*(.+?)\s*[→➜➡>]\s*(.+)/;
const PROGRESSION_PATTERN = /\b(fills?\s+the\s+frame|dominates?|takes?\s+over|draws?\s+attention|comes?\s+into\s+focus|emerges?|reveals?)\b/gi;

/** Battle/character-centric vocabulary that must be rewritten for environment scenes */
const ENV_BATTLE_VOCAB: Array<{ pattern: RegExp; replacement: string }> = [
  // Character-centric actions
  { pattern: /\bsoldiers?\s+(?:march|advance|retreat|charge|fight|attack|fire|shoot|engage)\w*\b/gi, replacement: "distant figures moving across the terrain" },
  { pattern: /\bsoldiers?\s+and\s+\w+/gi, replacement: "scattered debris and rubble" },
  { pattern: /\btanks?\s+(?:and\s+)?soldiers?\b/gi, replacement: "rusted metal wreckage and scattered rubble" },
  { pattern: /\bsoldiers?\b/gi, replacement: "distant figures" },
  { pattern: /\btanks?\s+(?:roll|advance|move|push|drive)\w*\b/gi, replacement: "charred metal wreckage scattered across the ground" },
  { pattern: /\btanks?\b/gi, replacement: "charred metal debris" },
  // Explosion/battle actions
  { pattern: /\bexplosions?\s+erupt\w*\s*(?:across|over|through|in)?\s*(?:the\s+)?(?:battlefield|city|landscape|terrain|ground|area|zone)?\b/gi, replacement: "smoke rises from impact craters across the terrain" },
  { pattern: /\bexplosions?\s+(?:rock|shake|tear|rip|destroy)\w*\b/gi, replacement: "smoke columns rising from scorched ground" },
  { pattern: /\bexplosions?\b/gi, replacement: "smoke plumes" },
  { pattern: /\bbombs?\s+(?:fall|drop|explode|detonate|hit|strike|rain)\w*\b/gi, replacement: "impact craters visible in the terrain" },
  { pattern: /\bbombing\s+(?:raid|run|campaign)\w*\b/gi, replacement: "crater-scarred landscape" },
  { pattern: /\bbombard(?:ment|ing|ed)?\b/gi, replacement: "scorched terrain" },
  { pattern: /\bartillery\s+(?:fire|shell|barrage|strike)\w*\b/gi, replacement: "cratered landscape with scattered debris" },
  { pattern: /\bartillery\b/gi, replacement: "debris field" },
  { pattern: /\bgunfire\b/gi, replacement: "distant echoes" },
  // Battle-specific nouns
  { pattern: /\bbattlefield\b/gi, replacement: "war-scarred terrain" },
  { pattern: /\bcombat\s+zone\b/gi, replacement: "devastated landscape" },
  { pattern: /\bwar\s+zone\b/gi, replacement: "devastated landscape" },
  { pattern: /\bfight(?:ing|s)?\s+(?:break|erupt|rage|intensif)\w*\b/gi, replacement: "dust and haze drift across the terrain" },
  { pattern: /\bclash(?:es|ing)?\s+(?:between|of)\b/gi, replacement: "marks of destruction across" },
  // Character-centric verbs in environment
  { pattern: /\b(?:troops?|forces?|army|armies|battalion|regiment|squad)\s+(?:advance|retreat|attack|defend|deploy|march|charge|engage|fight|assault)\w*\b/gi, replacement: "landscape scarred by conflict" },
  { pattern: /\b(?:troops?|forces?|army|armies|battalion|regiment|squad)\b/gi, replacement: "distant silhouettes" },
];

export function rewriteEnvironmentAction(
  actionText: string,
  subjectPrimary: string,
  camera: { framing: string; motion: string },
): ActionDensityRewriteResult {
  let text = actionText;
  let rewritten = false;

  // Phase 1: Battle/character vocabulary rewrite (runs BEFORE arrow check)
  for (const { pattern, replacement } of ENV_BATTLE_VOCAB) {
    if (pattern.test(text)) {
      text = text.replace(pattern, replacement);
      pattern.lastIndex = 0;
      rewritten = true;
    }
    pattern.lastIndex = 0;
  }

  // Cleanup after battle vocab rewrite
  if (rewritten) {
    text = text.replace(/\.\s*\./g, ".").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();
  }

  // Phase 2: Arrow-based progression rewrite
  const arrowMatch = text.match(ARROW_PATTERN);
  if (arrowMatch) {
    // Has arrow pattern — rewrite to continuous exploration
    const parts = text.split(/\s*[→➜➡>]\s*/);
    const keySubjects: string[] = [];
    for (const part of parts) {
      const cleaned = part
        .replace(PROGRESSION_PATTERN, "")
        .replace(/\b(the|a|an|in|of|with|from|to|and|or)\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      PROGRESSION_PATTERN.lastIndex = 0;
      if (cleaned.length > 3) keySubjects.push(cleaned);
    }

    const primarySubject = keySubjects.length > 0 ? keySubjects[keySubjects.length - 1] : subjectPrimary;
    const contextElements = keySubjects.slice(0, -1).join(", ");

    if (contextElements) {
      text = `a wide establishing view reveals ${contextElements}, with continuous focus settling on ${primarySubject}`;
    } else {
      text = `a wide establishing view with continuous spatial exploration of ${primarySubject}`;
    }
    rewritten = true;
  } else if (!rewritten) {
    // No arrows, no battle vocab — check for dense progression language
    const progMatches = text.match(PROGRESSION_PATTERN);
    PROGRESSION_PATTERN.lastIndex = 0;
    if (!progMatches || progMatches.length < 2) {
      return { text: actionText, rewritten: false };
    }
    // Has progression language — rewrite
    text = `a wide establishing view with continuous spatial exploration of ${subjectPrimary}`;
    rewritten = true;
  }

  // Suggest camera motion fix if static
  let motionSuggestion: string | undefined;
  const isStatic = /^static/i.test(camera.motion) || camera.motion.toLowerCase() === "static";
  if (isStatic) {
    motionSuggestion = "slow push-in";
  }

  return { text, rewritten, motionSuggestion };
}

// ═══════════════════════════════════════════════════════════════════
// 7b. Scene Type Vocabulary Rewrite on Structured Doc Fields
// ═══════════════════════════════════════════════════════════════════

export interface SceneTypeRewriteResult {
  rewrites: string[];
  framingChange?: { from: string; to: string };
}

/**
 * applySceneTypeVocabularyRules를 구조화된 문서 필드에 직접 적용.
 * normalizeSequence 내부에서 호출 — 직렬화 전 source of truth를 수정.
 *
 * grep: applySceneTypeRewrite
 */
export function applySceneTypeRewrite(
  doc: SingleShotDocument,
  sceneType: SceneType,
): SceneTypeRewriteResult {
  const rewrites: string[] = [];
  let framingChange: { from: string; to: string } | undefined;

  // Apply vocabulary rules to each text field
  const fields: Array<{ key: string; get: () => string; set: (v: string) => void }> = [
    { key: "subject.primary", get: () => doc.subject.primary, set: (v) => { doc.subject.primary = v; } },
    { key: "subject.action", get: () => doc.subject.action, set: (v) => { doc.subject.action = v; } },
    { key: "scene.environment", get: () => doc.scene.environment, set: (v) => { doc.scene.environment = v; } },
    { key: "scene.moodLighting", get: () => doc.scene.moodLighting, set: (v) => { doc.scene.moodLighting = v; } },
    { key: "global.style", get: () => doc.global.style, set: (v) => { doc.global.style = v; } },
    { key: "reinforcement.styleSuffix", get: () => doc.reinforcement.styleSuffix, set: (v) => { doc.reinforcement.styleSuffix = v; } },
  ];

  for (const field of fields) {
    const original = field.get();
    if (!original) continue;

    // First: apply scene-type-rules.ts vocabulary rules (banned/replacements)
    const result = applySceneTypeVocabularyRules(original, sceneType, field.key === "subject.primary" ? doc.camera.framing : undefined);
    let text = result.text;
    let changed = result.removals.length > 0 || result.replacements.length > 0;

    // Second: for environment scenes, apply battle vocabulary rewrite on all fields
    if (sceneType === "environment") {
      for (const { pattern, replacement } of ENV_BATTLE_VOCAB) {
        if (pattern.test(text)) {
          text = text.replace(pattern, replacement);
          pattern.lastIndex = 0;
          changed = true;
        }
        pattern.lastIndex = 0;
      }
      text = text.replace(/\.\s*\./g, ".").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();
    }

    if (changed) {
      field.set(text);
      for (const r of result.removals) rewrites.push(`[vocab] Removed "${r}" from ${field.key}`);
      for (const r of result.replacements) rewrites.push(`[vocab] ${field.key}: ${r}`);
      if (text !== result.text) rewrites.push(`[vocab] Rewrote battle vocabulary in ${field.key}`);
    }
    if (result.framingChange && !framingChange) {
      framingChange = result.framingChange;
    }
  }

  // Apply framing restriction
  if (framingChange) {
    doc.camera.framing = framingChange.to;
    rewrites.push(`[framing] ${framingChange.from} → ${framingChange.to} (restricted by ${sceneType} rules)`);
  }

  // For environment scenes, also apply battle vocab rewrite to timing beats
  if (sceneType === "environment") {
    for (const beat of doc.timing.beats) {
      let beatChanged = false;
      let beatText = beat.description;
      for (const { pattern, replacement } of ENV_BATTLE_VOCAB) {
        if (pattern.test(beatText)) {
          beatText = beatText.replace(pattern, replacement);
          pattern.lastIndex = 0;
          beatChanged = true;
        }
        pattern.lastIndex = 0;
      }
      if (beatChanged) {
        beat.description = beatText.replace(/\s{2,}/g, " ").trim();
        rewrites.push(`[vocab] Rewrote battle vocabulary in timing beat`);
      }
    }
  }

  return { rewrites, framingChange };
}

// ═══════════════════════════════════════════════════════════════════
// 7c. WHERE/WHAT Anchor Enrichment for Environment Scenes
// ═══════════════════════════════════════════════════════════════════

/**
 * WHERE (장소 정체성 오브젝트) — 시각적으로 확인 가능한 구조물/지형.
 * 분위기만으로는 불충분. 구체적 물리 오브젝트가 1개 이상 필요.
 *
 * grep: PLACE_IDENTITY_ANCHORS
 */
const PLACE_IDENTITY_ANCHORS: Array<{ check: RegExp; examples: string[] }> = [
  { check: /\b(gate|arch|archway|entrance|portal|doorway|gateway)\b/i, examples: ["weathered stone gate", "reinforced iron gate"] },
  { check: /\b(square|plaza|courtyard|piazza|forum|agora)\b/i, examples: ["open stone plaza", "wide empty square"] },
  { check: /\b(runway|tarmac|airfield|airstrip|landing\s+strip)\b/i, examples: ["cracked concrete runway", "abandoned airstrip"] },
  { check: /\b(tank\s+wreck|burnt\s+vehicle|destroyed\s+(?:tank|truck|car|jeep)|wreckage|hulk)\b/i, examples: ["charred tank wreck", "overturned vehicle hull"] },
  { check: /\b(palace|castle|fortress|citadel|stronghold|fort)\b/i, examples: ["palace wall", "fortress rampart"] },
  { check: /\b(wall|rampart|barricade|barrier|fence|perimeter)\b/i, examples: ["crumbling concrete wall", "bullet-scarred barrier"] },
  { check: /\b(compass\s+rose|map\s+border|legend|cartouche|scale\s+bar)\b/i, examples: ["brass compass rose", "engraved map border"] },
  { check: /\b(monument|statue|memorial|obelisk|pillar|column|cenotaph|stele)\b/i, examples: ["stone monument", "toppled statue base"] },
  { check: /\b(bridge|overpass|viaduct|crossing)\b/i, examples: ["collapsed bridge span", "damaged stone bridge"] },
  { check: /\b(tower|minaret|bell\s+tower|watchtower|spire|turret)\b/i, examples: ["scorched watchtower", "damaged tower silhouette"] },
  { check: /\b(building|structure|edifice|ruin|rubble\s+pile)\b/i, examples: ["bombed-out building facade", "structural ruin"] },
  { check: /\b(road|highway|path|trail|track|route)\b/i, examples: ["cratered road surface", "broken asphalt path"] },
  { check: /\b(crater|impact\s+(?:site|zone|crater)|bomb\s+crater)\b/i, examples: ["deep impact crater", "artillery crater"] },
  { check: /\b(trench|dugout|foxhole|bunker|pillbox)\b/i, examples: ["abandoned trench line", "concrete bunker"] },
  { check: /\b(river|canal|stream|waterway|bank|shore|coastline)\b/i, examples: ["muddy riverbank", "dried-out canal"] },
];

export interface PlaceIdentityResult {
  hasAnchor: boolean;
  matchedAnchors: string[];
  injectedAnchor?: string;
}

/**
 * Environment scene에 장소 정체성 오브젝트가 1개 이상 있는지 검사.
 * 없으면 environment/subject 텍스트에서 맥락을 추론해 적절한 앵커를 반환.
 *
 * grep: ensurePlaceIdentityAnchor
 */
export function ensurePlaceIdentityAnchor(
  subjectPrimary: string,
  environment: string,
  moodLighting: string,
): PlaceIdentityResult {
  const fullText = `${subjectPrimary} ${environment} ${moodLighting}`;
  const matchedAnchors: string[] = [];

  for (const { check, examples } of PLACE_IDENTITY_ANCHORS) {
    if (check.test(fullText)) {
      const match = fullText.match(check);
      if (match) matchedAnchors.push(match[0]);
    }
  }

  if (matchedAnchors.length > 0) {
    return { hasAnchor: true, matchedAnchors };
  }

  // No anchor found — pick contextually appropriate one
  const fullLc = fullText.toLowerCase();
  let injected: string;

  if (/\b(war|battle|combat|destroy|devastat|ruin|bombed|shell|attack|conflict|scarred)\b/i.test(fullLc)) {
    injected = "crumbling concrete wall with bullet marks";
  } else if (/\b(city|urban|town|street|block|district|downtown)\b/i.test(fullLc)) {
    injected = "weathered stone building facade";
  } else if (/\b(desert|arid|sand|dune|barren)\b/i.test(fullLc)) {
    injected = "lone rock formation on the horizon";
  } else if (/\b(forest|wood|jungle|canopy|tree)\b/i.test(fullLc)) {
    injected = "massive fallen tree trunk across the path";
  } else if (/\b(mountain|alpine|peak|ridge|cliff)\b/i.test(fullLc)) {
    injected = "jagged rock outcrop at the ridge line";
  } else if (/\b(ocean|sea|coast|beach|shore|harbor|port|dock)\b/i.test(fullLc)) {
    injected = "weathered wooden dock jutting into water";
  } else if (/\b(field|plain|meadow|grassland|steppe|savanna)\b/i.test(fullLc)) {
    injected = "lone fence post leaning at an angle";
  } else if (/\b(snow|ice|frozen|arctic|tundra|glacier)\b/i.test(fullLc)) {
    injected = "frozen signpost half-buried in snow";
  } else {
    injected = "weathered stone structure in the mid-ground";
  }

  return { hasAnchor: false, matchedAnchors: [], injectedAnchor: injected };
}

/**
 * WHAT (상황 증거) — 현재 상황을 시각적으로 증명하는 동적/정적 요소.
 * 단순 분위기가 아닌 구체적 시각 증거가 1개 이상 필요.
 *
 * grep: SITUATION_EVIDENCE_PATTERNS
 */
const SITUATION_EVIDENCE_PATTERNS: Array<{ check: RegExp; examples: string[] }> = [
  { check: /\b(smoke\s+plume|smoke\s+column|rising\s+smoke|billowing\s+smoke)\b/i, examples: ["thick smoke plumes rising from rubble"] },
  { check: /\b(damaged\s+ground|cratered|pockmark|scarred\s+earth|scorched\s+ground|charred\s+ground)\b/i, examples: ["blast-cratered ground"] },
  { check: /\b(waving\s+flag|flag\s+flutter|banner\s+(?:wave|flutter|snap|hang))\b/i, examples: ["torn flag waving in the wind"] },
  { check: /\b(empty\s+(?:plaza|square|street|road|field)|abandoned|deserted|desolate)\b/i, examples: ["eerily empty plaza"] },
  { check: /\b(crowd|formation|column\s+of|marching|procession|convoy)\b/i, examples: ["distant column of figures moving"] },
  { check: /\b(barricade|roadblock|checkpoint|sandbag|wire)\b/i, examples: ["makeshift barricade of debris"] },
  { check: /\b(broken\s+vehicle|burnt\s+(?:car|truck|bus)|overturned|wrecked\s+(?:car|truck|vehicle))\b/i, examples: ["burnt vehicle shell on the roadside"] },
  { check: /\b(debris|rubble|wreckage|shattered\s+glass|scattered\s+(?:brick|concrete|metal))\b/i, examples: ["scattered concrete debris"] },
  { check: /\b(fire|flame|blaze|burning|ember|smolder)\b/i, examples: ["small fires smoldering in wreckage"] },
  { check: /\b(dust\s+cloud|haze\s+of\s+dust|dust\s+hangs?|airborne\s+dust|particulate)\b/i, examples: ["dust haze hanging in the air"] },
  { check: /\b(puddle|flood|water\s+pool|standing\s+water|mud)\b/i, examples: ["muddy puddles reflecting grey sky"] },
  { check: /\b(shadow|long\s+shadow|silhouette|cast\s+shadow)\b/i, examples: ["long shadows stretching across ground"] },
  { check: /\b(wind|gust|breeze|flutter|ripple)\b/i, examples: ["wind rippling through loose debris"] },
  { check: /\b(rain|drizzle|downpour|wet\s+surface|puddle)\b/i, examples: ["rain streaking across surfaces"] },
  { check: /\b(fog|mist|vapor|steam)\b/i, examples: ["low fog clinging to the ground"] },
];

export interface SituationEvidenceResult {
  hasEvidence: boolean;
  matchedEvidence: string[];
  injectedEvidence?: string;
}

/**
 * Environment scene에 상황 증거가 1개 이상 있는지 검사.
 * 없으면 맥락에서 적절한 증거를 생성.
 *
 * grep: ensureSituationEvidence
 */
export function ensureSituationEvidence(
  subjectPrimary: string,
  action: string,
  environment: string,
  moodLighting: string,
): SituationEvidenceResult {
  const fullText = `${subjectPrimary} ${action} ${environment} ${moodLighting}`;
  const matchedEvidence: string[] = [];

  for (const { check } of SITUATION_EVIDENCE_PATTERNS) {
    if (check.test(fullText)) {
      const match = fullText.match(check);
      if (match) matchedEvidence.push(match[0]);
    }
  }

  if (matchedEvidence.length > 0) {
    return { hasEvidence: true, matchedEvidence };
  }

  // No evidence found — pick contextually appropriate one
  const fullLc = fullText.toLowerCase();
  let injected: string;

  if (/\b(war|battle|combat|destroy|devastat|ruin|bombed|shell|conflict|scarred)\b/i.test(fullLc)) {
    injected = "scattered debris and thin smoke drifting across the ground";
  } else if (/\b(city|urban|town|street)\b/i.test(fullLc)) {
    injected = "loose paper and dust drifting across empty pavement";
  } else if (/\b(desert|arid|sand|dune)\b/i.test(fullLc)) {
    injected = "fine sand particles carried by the wind across the ground";
  } else if (/\b(forest|wood|jungle)\b/i.test(fullLc)) {
    injected = "shafts of light filtering through branches, leaves drifting down";
  } else if (/\b(mountain|alpine|peak|ridge)\b/i.test(fullLc)) {
    injected = "loose gravel shifting on the slope, wind-carried dust";
  } else if (/\b(ocean|sea|coast|shore)\b/i.test(fullLc)) {
    injected = "foam-streaked waves washing across the shore";
  } else if (/\b(snow|ice|frozen|arctic)\b/i.test(fullLc)) {
    injected = "wind-driven snow particles sweeping across the surface";
  } else if (/\b(rain|storm|thunder)\b/i.test(fullLc)) {
    injected = "rain streaking across surfaces, puddles forming on the ground";
  } else {
    injected = "subtle dust particles drifting through the ambient light";
  }

  return { hasEvidence: false, matchedEvidence: [], injectedEvidence: injected };
}

// ═══════════════════════════════════════════════════════════════════
// 8. Normalize Pipeline (전체 정규화)
// ═══════════════════════════════════════════════════════════════════

export interface NormalizeResult {
  doc: SingleShotDocument;
  log: string[];
  warnings: string[];
  /** 치명적 문제로 generation을 차단해야 하면 true */
  blocked: boolean;
  blockReason?: string;
}

/**
 * SingleShotDocument를 정규화.
 * assembleFromJSON() 내부에서 sanitize/resolveConflicts 이후에 호출.
 *
 * 순서:
 * 1. inferSceneType
 * 2. sanitizeCharacterRef
 * 3. detectOverloadedShot
 * 4. checkCameraActionConsistency
 * 4b. environment action density rewrite (→ progression 패턴)
 * 5. normalizeLightingDescription (충돌 lighting 정규화)
 * 6. checkDescriptiveCoverage + enrichment
 * 7. positive/negative 최종 검사 (누적 충돌 제거)
 * 8. enforceMediumLock
 */
export function normalizeSequence(doc: SingleShotDocument): NormalizeResult {
  const log: string[] = [];
  const warnings: string[] = [];
  const result = structuredClone(doc);

  // ── 1. Scene type inference ────────────────────────────────────
  const { sceneType, inferred, confidence } = inferSceneType(
    result.scene.shotCategory,
    result.subject.primary,
    result.subject.action,
    result.scene.environment,
  );

  if (inferred && sceneType) {
    // shotCategory가 없었으면 추론된 값 할당
    result.scene.shotCategory = sceneType === "map_visualization" ? "map-graphic" : sceneType;
    log.push(`[infer] sceneType inferred as "${sceneType}" (confidence: ${confidence})`);
  }

  const effectiveSceneType = sceneType;

  // ── 2. Character reference sanitization ────────────────────────
  const charRefResult = sanitizeCharacterRef(
    result.continuity.characterRef,
    result.scene.environment,
    result.subject.primary,
    result.scene.shotCategory,
  );
  if (charRefResult.action !== "kept") {
    result.continuity.characterRef = charRefResult.characterRef;
    log.push(`[charRef] ${charRefResult.action}: ${charRefResult.reason}`);
  }

  // ── 3. Overloaded shot detection ───────────────────────────────
  const overloadResult = detectOverloadedShot(
    result.subject.primary,
    result.subject.action,
    result.timing.beats,
    result.timing.durationSec,
  );
  if (overloadResult.overloaded) {
    warnings.push(`[overload] Shot has ${overloadResult.eventCount} event types (${overloadResult.events.join(", ")}). ${overloadResult.suggestion || ""}`);
  }

  // ── 4. Camera-action consistency ───────────────────────────────
  const cameraActionResult = checkCameraActionConsistency(
    result.camera.framing,
    result.camera.motion,
    result.subject.action,
    effectiveSceneType,
  );
  if (!cameraActionResult.consistent) {
    for (const issue of cameraActionResult.issues) {
      warnings.push(`[camera-action] ${issue}`);
    }
    // environment scene이면 action 단순화 시도
    if (effectiveSceneType === "environment") {
      const simplified = result.subject.action
        .replace(/\b(then|and\s+then|followed\s+by|before|after\s+which|subsequently|next|finally)\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (simplified !== result.subject.action) {
        result.subject.action = simplified;
        log.push("[camera-action] Simplified multi-stage action for environment scene");
      }
    }
  }

  // ── 4b. Environment action density rewrite ───────────────────────
  if (effectiveSceneType === "environment") {
    const actionRewrite = rewriteEnvironmentAction(
      result.subject.action,
      result.subject.primary,
      result.camera,
    );
    if (actionRewrite.rewritten) {
      result.subject.action = actionRewrite.text;
      log.push(`[env-action] Rewrote arrow/progression action to continuous exploration`);
      if (actionRewrite.motionSuggestion && /^static/i.test(result.camera.motion)) {
        result.camera.motion = actionRewrite.motionSuggestion;
        log.push(`[env-action] Camera motion normalized: static → ${actionRewrite.motionSuggestion}`);
      }
    }
    // Also rewrite subject.primary if it has arrow patterns
    if (/[→➜➡>]/.test(result.subject.primary)) {
      const primaryRewrite = rewriteEnvironmentAction(
        result.subject.primary,
        result.scene.environment,
        result.camera,
      );
      if (primaryRewrite.rewritten) {
        result.subject.primary = primaryRewrite.text;
        log.push(`[env-action] Rewrote subject.primary arrow pattern to continuous exploration`);
      }
    }
  }

  // ── 4c. Scene type vocabulary rewrite on structured doc fields ──
  // applySceneTypeVocabularyRules를 직렬화 전 structured fields에 직접 적용.
  // 이전에는 serialized string에만 적용되어 environment battle vocab이 통과됨.
  if (effectiveSceneType) {
    const rewriteResult = applySceneTypeRewrite(result, effectiveSceneType);
    for (const r of rewriteResult.rewrites) {
      log.push(r);
    }
  }

  // ── 5. Lighting normalization ──────────────────────────────────
  const lightingResult = normalizeLightingDescription(result.scene.moodLighting);
  if (lightingResult.normalized) {
    result.scene.moodLighting = lightingResult.text;
    log.push(`[lighting] Normalized conflicting lighting to ${lightingResult.profile}: "${lightingResult.text.slice(0, 80)}"`);
  }

  // ── 6. Descriptive coverage enrichment ─────────────────────────
  if (effectiveSceneType) {
    const fullText = `${result.subject.primary} ${result.subject.action} ${result.scene.moodLighting} ${result.scene.environment} ${result.continuity.characterRef || ""}`;
    const coverage = checkDescriptiveCoverage(fullText, effectiveSceneType);

    if (!coverage.sufficient) {
      warnings.push(`[coverage] ${effectiveSceneType} scene missing: ${coverage.missing.join(", ")} (${coverage.covered}/${coverage.total})`);

      // 부족한 요소를 moodLighting 또는 subject.action에 보충
      if (coverage.additions.length > 0) {
        const enrichment = coverage.additions.filter(a => a.length > 0).join(", ");
        if (enrichment) {
          // environment → moodLighting에 추가
          // character → subject.primary에 추가
          if (effectiveSceneType === "environment") {
            result.scene.moodLighting = result.scene.moodLighting
              ? `${result.scene.moodLighting}, ${enrichment}`
              : enrichment;
          } else {
            result.subject.primary = result.subject.primary
              ? `${result.subject.primary}, ${enrichment}`
              : enrichment;
          }
          log.push(`[coverage] Added missing ${effectiveSceneType} elements: ${enrichment}`);
        }
      }
    }
  }

  // ── 6b. WHERE/WHAT anchor enrichment (environment only) ─────────
  // Gemini 품질 검사에서 장소 정체성(WHERE)과 상황 증거(WHAT) 부족 방지.
  // source-of-truth에 직접 주입.
  if (effectiveSceneType === "environment") {
    // WHERE — 장소 정체성 오브젝트
    const placeResult = ensurePlaceIdentityAnchor(
      result.subject.primary,
      result.scene.environment,
      result.scene.moodLighting,
    );
    if (!placeResult.hasAnchor && placeResult.injectedAnchor) {
      result.scene.environment = result.scene.environment
        ? `${result.scene.environment}, ${placeResult.injectedAnchor}`
        : placeResult.injectedAnchor;
      log.push(`[WHERE] Injected place identity anchor: "${placeResult.injectedAnchor}"`);
    } else if (placeResult.hasAnchor) {
      log.push(`[WHERE] Place identity present: ${placeResult.matchedAnchors.join(", ")}`);
    }

    // WHAT — 상황 증거
    const evidenceResult = ensureSituationEvidence(
      result.subject.primary,
      result.subject.action,
      result.scene.environment,
      result.scene.moodLighting,
    );
    if (!evidenceResult.hasEvidence && evidenceResult.injectedEvidence) {
      result.subject.action = result.subject.action
        ? `${result.subject.action}, ${evidenceResult.injectedEvidence}`
        : evidenceResult.injectedEvidence;
      log.push(`[WHAT] Injected situation evidence: "${evidenceResult.injectedEvidence}"`);
    } else if (evidenceResult.hasEvidence) {
      log.push(`[WHAT] Situation evidence present: ${evidenceResult.matchedEvidence.join(", ")}`);
    }
  }

  // ── 7. Final positive/negative cleanup ─────────────────────────
  // 이전 단계에서 텍스트가 변경되었을 수 있으므로 ALL text fields 재검사
  const criticalWords = ["watermark", "caption", "subtitle", "logo", "photorealistic", "cinematic", "text overlay"];

  const allNeg = [
    ...result.negatives.universal,
    ...result.negatives.sceneSpecific,
    ...result.negatives.failureMode,
    ...result.negatives.user,
  ];

  // Check ALL positive text fields — not just style
  const positiveFields: Array<{ key: string; get: () => string; set: (v: string) => void }> = [
    { key: "global.style", get: () => result.global.style, set: (v) => { result.global.style = v; } },
    { key: "reinforcement.styleSuffix", get: () => result.reinforcement.styleSuffix, set: (v) => { result.reinforcement.styleSuffix = v; } },
    { key: "subject.primary", get: () => result.subject.primary, set: (v) => { result.subject.primary = v; } },
    { key: "subject.action", get: () => result.subject.action, set: (v) => { result.subject.action = v; } },
    { key: "scene.environment", get: () => result.scene.environment, set: (v) => { result.scene.environment = v; } },
    { key: "scene.moodLighting", get: () => result.scene.moodLighting, set: (v) => { result.scene.moodLighting = v; } },
  ];

  for (const word of criticalWords) {
    const wordLc = word.toLowerCase();
    const isInNeg = allNeg.some(n => n.toLowerCase().includes(wordLc));
    if (!isInNeg) continue;

    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const noPattern = new RegExp(`\\b(?:no|avoid|without)\\s+(?:[\\w\\s,]+\\s+)?${escapedWord}`, "i");
    const removeRe = new RegExp(`\\b${escapedWord}\\b`, "gi");

    for (const field of positiveFields) {
      const text = field.get();
      if (!text) continue;
      const textLc = text.toLowerCase();
      if (!textLc.includes(wordLc)) continue;
      if (noPattern.test(text)) continue; // guard: "no watermark" etc.

      field.set(text.replace(removeRe, "").replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim());
      log.push(`[pos-neg] Removed "${word}" from ${field.key} (conflict with negatives)`);
    }
  }

  // ── 8. Medium lock enforcement ─────────────────────────────────
  if (effectiveSceneType === "map_visualization" && !result.reinforcement.mediumLock) {
    result.reinforcement.mediumLock = "physical map surface — not a landscape, not a 3D render, not a CGI scene";
    log.push("[medium-lock] Added medium lock for map visualization scene");
  }

  // ── Blocking check ─────────────────────────────────────────────
  // 치명적 문제가 있으면 generation 차단
  let blocked = false;
  let blockReason: string | undefined;

  // 5개 이상 사건 + environment scene = 거의 확실히 실패
  if (overloadResult.overloaded && overloadResult.eventCount >= 5 && effectiveSceneType === "environment") {
    blocked = true;
    blockReason = `Environment scene with ${overloadResult.eventCount} event types is extremely likely to fail. Split into multiple shots.`;
  }

  return { doc: result, log, warnings, blocked, blockReason };
}
