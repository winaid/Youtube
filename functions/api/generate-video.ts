/**
 * generate-video.ts — 2-API 아키텍처: Kling 전용 영상 생성
 *
 * 아키텍처:
 *   Kling = 실제 영상 생성 (text-to-video / image-to-video / extend)
 *   Gemini = QA / validation / auto-fix (별도 route, 여기서 호출하지 않음)
 *
 * source of truth: structuredSequence (JSON-first)
 * Kling(EvoLink) 생성 전용
 */
import {
  klingGenerate,
  klingExtend,
  toKlingDuration,
  toKlingAspectRatio,
  KlingModelAccessDeniedError,
  KLING_MODELS,
  resolveModelForWorkflow,
  getMaxShots,
  getCapability,
  normalizeMultiShots,
  type KlingEnv,
  type KlingMultiShot,
} from "./_kling-api";
import {
  type VideoPromptJson,
  type ExtendPromptJson,
  renderKlingPromptFromJson,
  renderKlingExtendPromptFromJson,
} from "./_video-prompt-json";
import { serverSanitizeAndValidate } from "./_prompt-sanitizer";

type Env = KlingEnv;

// ═══════════════════════════════════════════════════════════════════
// Provider-Facing Prompt Cleanup Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Internal bracket tags that must NEVER reach the video provider.
 * These are editorial/planning scaffolding — not visual descriptions.
 */
const INTERNAL_TAG_PATTERNS = [
  /\[VISUAL LOCK\]\s*/gi,
  /\[CHARACTER LOCK\]\s*/gi,
  /\[CONTINUATION\][^.]*\./gi,
  /\[ENDING\][^.]*\./gi,
  /\[Establishing wide shot\]\s*/gi,
  /\[Developing mid shot\]\s*/gi,
  /\[Peak dramatic moment\]\s*/gi,
  /\[Resolving close-up\]\s*/gi,
  /\[Transition\]\s*/gi,
  /\[Insert detail\]\s*/gi,
  /\[Shot \d+\/\d+[^\]]*\]\s*/gi,
];

/**
 * Extract a compact visual lock from a (potentially verbose) styleSuffix.
 * Returns only stable look anchors: medium, material, palette, light type.
 * Returns empty string if nothing useful can be extracted.
 *
 * Allowed: medium/rendering, material/texture, palette, stable lighting family
 * Disallowed: aspect ratio, "no text/watermark", emotional tone, duration/ending
 */
function extractCompactVisualLock(rawLock: string): string {
  if (!rawLock || rawLock.length < 5) return "";

  // Strip disallowed concepts before extraction
  const stripped = rawLock
    .replace(/\b(no\s+text\s+overlay|no\s+watermark|no\s+caption)\b/gi, "")
    .replace(/\b\d+:\d+\b/g, "")  // aspect ratios like 16:9
    .replace(/\b(cinematic\s+framing|widescreen|letterbox)\b/gi, "")
    .trim();

  const anchors: string[] = [];
  const mediumMatch = stripped.match(/\b(claymation|stop[\s-]?motion|watercolor|oil[\s-]?paint|pencil[\s-]?sketch|anime|cel[\s-]?shad|charcoal|photorealistic|cinematic[\s-]?realism|documentary|live[\s-]?action)\b/i);
  if (mediumMatch) anchors.push(mediumMatch[0].toLowerCase());
  const materialMatch = stripped.match(/\b(fingerprint\s+texture|handcrafted|clay\s+surface|impasto|visible\s+brush|grainy\s+film|film\s+grain|halation)\b/i);
  if (materialMatch) anchors.push(materialMatch[0].toLowerCase());
  const paletteMatch = stripped.match(/\b(desaturated|warm\s+palette|cool\s+palette|monochrome|sepia|muted|pastel|high[\s-]?contrast|low[\s-]?key|high[\s-]?key)\b/i);
  if (paletteMatch) anchors.push(paletteMatch[0].toLowerCase());
  // Only stable interior-safe light families — no golden hour / overcast / blue hour (outdoor)
  const lightMatch = stripped.match(/\b(practical\s+light|tungsten|candlelit|gaslight|neon|studio\s+light|backlit|rim[\s-]?light|warm\s+lamp\s+light)\b/i);
  if (lightMatch) anchors.push(lightMatch[0].toLowerCase());
  if (anchors.length === 0) return "";
  return anchors.join(", ");
}

/** Strip all internal bracket meta tags from a prompt string. */
function stripInternalTags(text: string): string {
  let cleaned = text;
  for (const pattern of INTERNAL_TAG_PATTERNS) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, "");
  }
  // Catch any remaining [ALLCAPS ...] editorial tags
  cleaned = cleaned.replace(/\[(?:VISUAL|CHARACTER|CONTINUATION|ENDING|NARRATIVE|LOCK)[^\]]*\]\s*/gi, "");
  return cleaned.replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();
}

/** Clean a single multiShot entry prompt. */
function cleanShotPrompt(prompt: string): string {
  return stripInternalTags(prompt);
}

/**
 * Deduplicate repeated clauses in a prompt.
 * Split by sentence boundaries, keep first occurrence of each normalized clause.
 */
function deduplicatePromptClauses(text: string): string {
  const sentences = text.split(/\.\s+/).filter(s => s.trim().length > 3);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const s of sentences) {
    const norm = s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
    // Allow short functional sentences through even if similar
    if (norm.length < 10) { unique.push(s.trim()); continue; }
    // Check for high overlap with already-seen sentences
    let isDupe = false;
    for (const prev of seen) {
      if (prev === norm) { isDupe = true; break; }
      // Substring containment: if one fully contains the other
      if (prev.includes(norm) || norm.includes(prev)) { isDupe = true; break; }
    }
    if (!isDupe) {
      seen.add(norm);
      unique.push(s.trim());
    }
  }
  return unique.join(". ").replace(/\.\s*\./g, ".").trim();
}

// ═══════════════════════════════════════════════════════════════════
// Scene-Type Contradiction Normalization
// ═══════════════════════════════════════════════════════════════════

/** Indoor location signals. */
const INDOOR_SIGNALS = /\b(room|office|clinic|hospital|kitchen|hall|basement|attic|corridor|workshop|studio|laboratory|church|palace|prison|tower|library|interior|indoor|inside|ceiling|wall|cabinet|shelf|tray)\b/i;

/** Outdoor location signals. */
const OUTDOOR_SIGNALS = /\b(hilltop|mountain|valley|canyon|cliff|desert|beach|ocean|forest|field|sky|horizon|landscape|rooftop|garden|plaza|street|highway|meadow|tundra|glacier|volcano|jungle|swamp)\b/i;

/** Outdoor lighting language that contradicts indoor scenes. */
const OUTDOOR_LIGHT_RE = /\b(golden\s+hour|late\s+afternoon\s+sun|blue\s+hour|overcast\s+sky|sunset|sunrise|moonlight|starlight|clear\s+sky\s+light|dappled\s+sunlight|morning\s+mist|fog[\s-]?bank|open[\s-]?air\s+light)\b/gi;

/** Battle/epic narrative language that contradicts object/room scenes. */
const EPIC_NARRATIVE_RE = /\b(warrior|giant|battle|hero|villain|army|sword\s+fight|David\s+and\s+Goliath|epic\s+clash|siege|conquest|rampage|titan|colossus|rampart|cavalry|infantry|crusade)\b/gi;

/**
 * Normalize contradictory lighting and narrative language based on scene type inference.
 *
 * If the prompt describes an indoor scene (room, clinic, workshop, etc.),
 * suppress outdoor lighting language and replace with interior equivalents.
 *
 * If the prompt describes a medical/tool/room scene,
 * suppress epic battle/narrative language.
 */
function normalizeSceneContradictions(text: string): { text: string; log: string[] } {
  const log: string[] = [];
  let result = text;

  const isIndoor = INDOOR_SIGNALS.test(text);
  const isOutdoor = OUTDOOR_SIGNALS.test(text);

  // Only normalize if scene is clearly indoor and NOT also outdoor
  if (isIndoor && !isOutdoor) {
    OUTDOOR_LIGHT_RE.lastIndex = 0;
    const outdoorLightMatches = text.match(OUTDOOR_LIGHT_RE);
    if (outdoorLightMatches) {
      for (const match of outdoorLightMatches) {
        result = result.replace(match, "warm interior light");
        log.push(`[scene-norm] Replaced outdoor light "${match}" → "warm interior light" (indoor scene)`);
      }
    }
  }

  // Suppress epic narrative language in medical/tool/room scenes
  const isMedicalOrTool = /\b(dental|medical|clinic|surgical|operating|tool|instrument|drill|scalpel)\b/i.test(text);
  if (isMedicalOrTool) {
    EPIC_NARRATIVE_RE.lastIndex = 0;
    const epicMatches = text.match(EPIC_NARRATIVE_RE);
    if (epicMatches) {
      for (const match of epicMatches) {
        result = result.replace(new RegExp(`\\b${match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "");
        log.push(`[scene-norm] Removed contradictory narrative term "${match}" (medical/tool scene)`);
      }
    }
  }

  result = result.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").replace(/\.\s*\./g, ".").trim();
  return { text: result, log };
}

/**
 * Extract global anchors from a prompt — elements that define the persistent
 * visual identity of the entire clip (medium, era, location, material, light family).
 * These belong in the top-level prompt when multiShot is present.
 */
function extractGlobalAnchors(prompt: string): string {
  const clauses = prompt.split(/\.\s+/).filter(s => s.trim().length > 3);
  const globalPatterns = [
    /\b(claymation|stop[\s-]?motion|fingerprint|handcrafted|clay\s+surface|visible\s+texture)/i,
    /\b(1[0-9]{3}s|19th\s+century|medieval|victorian|antique|archaic|ancient)/i,
    /\b(dental\s+room|dental\s+office|clinic|operating\s+room|laboratory|workshop)/i,
    /\b(dim(?:ly)?\s+lit|warm\s+(?:practical|tungsten|lamp)\s+light|low[\s-]?key\s+light|candlelit|gaslight|interior\s+light)/i,
    /\b(cinematic|photorealistic|live[\s-]?action|documentary|animation|watercolor|oil\s+paint)/i,
    /\b(desaturated|warm\s+palette|cool\s+palette|monochrome|sepia|muted\s+color)/i,
  ];
  const global: string[] = [];
  for (const clause of clauses) {
    if (globalPatterns.some(p => p.test(clause))) {
      global.push(clause.trim());
    }
  }
  return global.length > 0 ? global.join(". ") : "";
}

// ── Server-side shot decomposition (mirrors multi-shot-planner logic) ──

/** Simple keyword extraction for server-side prompt decomposition. */
function serverExtractTerms(text: string, re: RegExp): string[] {
  re.lastIndex = 0;
  const matches = text.match(re);
  return matches ? [...new Set(matches.map(m => m.toLowerCase()))] : [];
}

const SRV_SPACE_RE = /\b(room|street|office|hospital|clinic|kitchen|hall|temple|ruins|forest|city|castle|village|cave|beach|mountain|valley|garden|corridor|alley|workshop|studio|laboratory|church|palace|prison|tower|basement|attic|library|station|arena|plaza|courtyard|dock|warehouse|factory|bridge|tunnel|rooftop|balcony|tray|chair|table|shelf|cabinet|counter|desk|bed)\b/gi;
const SRV_ACTION_RE = /\b(rides?|walks?|runs?|spins?|turns?|opens?|pushes?|pulls?|enters?|climbs?|grabs?|reaches?|approaches|comes?\s+alive|moves?|emerges?|stretches?|shifts?|vibrates?|rotates?|oscillates?)\b/gi;
const SRV_DETAIL_RE = /\b(rust(?:y|ed)?|metal|steel|iron|glass|leather|fabric|wood|stone|ceramic|dust|smoke|steam|glow\w*|shadow\w*|texture|grain|surface|crack|patina|oxidized|worn|tarnished|polished|gleaming|drill|blade|needle|scalpel|forceps|clamp|pliers|saw|tool|instrument|device|mechanism|gauge|dial|handle|switch|lever|knob|tray|vial|bottle|jar|flask|lamp|bulb|filament|wire|cable|chain|strap|buckle|rivet|hinge|latch|gear|cog|spring|valve)\b/gi;
const SRV_SUBJECT_RE = /\b(dentist|patient|doctor|nurse|figure|person|man|woman|child|worker|craftsman|artisan|assistant|attendant|chair|drill|tool|instrument)\b/gi;

interface PromptLayers {
  space: string;
  action: string;
  detail: string;
  subject: string;
  fullPrompt: string;
}

/** Decompose a prompt into visual layers for server-side multi-shot building. */
function serverDecomposePrompt(prompt: string): PromptLayers {
  const spaceWords = serverExtractTerms(prompt, SRV_SPACE_RE);
  const actionWords = serverExtractTerms(prompt, SRV_ACTION_RE);
  const detailWords = serverExtractTerms(prompt, SRV_DETAIL_RE);
  const subjectWords = serverExtractTerms(prompt, SRV_SUBJECT_RE);

  const clauses = prompt.split(/\.\s+/).filter(c => c.trim().length > 5);

  // Classify clauses
  const spaceClauses: string[] = [];
  const actionClauses: string[] = [];
  const detailClauses: string[] = [];
  for (const clause of clauses) {
    SRV_ACTION_RE.lastIndex = 0;
    SRV_DETAIL_RE.lastIndex = 0;
    SRV_SPACE_RE.lastIndex = 0;
    if (SRV_ACTION_RE.test(clause)) actionClauses.push(clause.trim());
    else if (SRV_DETAIL_RE.test(clause)) detailClauses.push(clause.trim());
    else if (SRV_SPACE_RE.test(clause)) spaceClauses.push(clause.trim());
    else spaceClauses.push(clause.trim()); // default to space
  }

  return {
    space: spaceClauses.length > 0 ? spaceClauses.join(". ") : (spaceWords.length > 0 ? `A ${spaceWords.join(", ")} scene` : prompt.split(".")[0] || prompt),
    action: actionClauses.length > 0 ? actionClauses.join(". ") : (actionWords.length > 0 ? `Subject ${actionWords.slice(0, 2).join(" and ")}` : "subject becomes visible"),
    detail: detailClauses.length > 0 ? detailClauses.join(". ") : (detailWords.length > 0 ? `Close detail of ${detailWords.slice(0, 3).join(", ")}` : "textured surface detail"),
    subject: subjectWords.length > 0 ? subjectWords.slice(0, 2).join(", ") : "",
    fullPrompt: prompt,
  };
}

/**
 * Extract concrete noun anchors from a prompt for distribution across shots.
 * Returns unique noun phrases like "dental room", "rusty tray", "drill bit".
 */
const CONCRETE_NOUN_RE = /\b((?:dental|medical|rusty|antique|archaic|worn|old|ancient|spinning|sharp|metal|wooden|glass|iron|steel|ceramic)\s+(?:room|office|chair|table|tray|tool[s]?|drill|instrument[s]?|cabinet|lamp|device|mirror|cart|shelf|counter|jar|vial|flask|bottle|needle|scalpel|forceps|clamp|blade|handle|lever|gauge|dial|mechanism|equipment|rack|stand|stool|basin|sink|counter))|(?:drill\s+bit|enamel|gaslight|clinic\s+interior|tool\s+tray)\b/gi;

function extractConcreteAnchors(prompt: string): string[] {
  CONCRETE_NOUN_RE.lastIndex = 0;
  const matches = prompt.match(CONCRETE_NOUN_RE);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.toLowerCase().trim()))];
}

/**
 * Role-specific shot framing — CONCRETE, not abstract.
 *
 * Every shot embeds at least one concrete noun anchor from the source scene.
 * Shots must unmistakably belong to the same scene, not be generic cinematic filler.
 */
function buildConcreteRoleShotBuilders(layers: PromptLayers, concreteAnchors: string[]): Record<string, string> {
  // Distribute anchors across roles (round-robin with fallback)
  const a = concreteAnchors;
  const spaceFirst = layers.space.split(".")[0]?.trim() || layers.space;
  const detailFirst = layers.detail.split(".")[0]?.trim() || layers.detail;
  const actionFirst = layers.action.split(".")[0]?.trim() || layers.action;

  return {
    establish: `Wide establishing view of ${spaceFirst}${a[0] ? `, ${a[0]} visible` : ""}. Slow push-in revealing the full environment.`,
    transition: `New angle drifting past ${a[1] || a[0] || detailFirst}${a[2] ? ` and ${a[2]}` : ""}. A different vantage point within the same space.`,
    develop: `Medium shot revealing ${actionFirst}${a[Math.min(2, a.length - 1)] ? `, ${a[Math.min(2, a.length - 1)]} becoming clear` : ""}. First clear view of the subject in motion.`,
    insert: `Extreme close-up on ${a[3] || a[1] || detailFirst}. Texture and material emphasized at tight framing.`,
    peak: `Close tense shot, ${actionFirst}${a[0] ? `, ${a[0]} in frame` : ""}. Motion increasing, highest visual intensity.`,
    resolve: `Tight moving close-up on ${a[a.length - 1] || detailFirst}. Harsh detail, scene left open and unresolved.`,
  };
}

/** Predefined role sequences by shot count. */
const ROLE_SEQUENCES: Record<number, string[]> = {
  2: ["establish", "resolve"],
  3: ["establish", "develop", "resolve"],
  4: ["establish", "develop", "peak", "resolve"],
  5: ["establish", "transition", "develop", "peak", "resolve"],
  6: ["establish", "transition", "develop", "insert", "peak", "resolve"],
};

/**
 * Build semantically different multi-shot prompts from a base prompt.
 * Each shot describes a DIFFERENT visual job — no repeated base prompts.
 * Every shot retains at least one concrete noun anchor from the source scene.
 */
function buildServerMultiShot(
  basePrompt: string,
  shotCount: number,
  totalDurationSec: number,
): KlingMultiShot[] {
  const layers = serverDecomposePrompt(basePrompt);
  const concreteAnchors = extractConcreteAnchors(basePrompt);
  const roleBuilders = buildConcreteRoleShotBuilders(layers, concreteAnchors);
  const roles = ROLE_SEQUENCES[shotCount] ?? ROLE_SEQUENCES[4]!;
  const effectiveCount = Math.min(shotCount, roles.length);
  const perShotDur = Math.max(2, Math.floor(totalDurationSec / effectiveCount));
  const remainder = totalDurationSec - perShotDur * effectiveCount;

  return Array.from({ length: effectiveCount }, (_, i) => {
    const role = roles[i]!;
    const shotPrompt = roleBuilders[role] || layers.fullPrompt;
    return {
      index: i + 1,
      prompt: shotPrompt.slice(0, 2500),
      duration: String(i === effectiveCount - 1 ? perShotDur + remainder : perShotDur),
    };
  });
}

/**
 * When multiShot is present, split the base prompt into:
 * - global anchors (medium, material, era, location, stable lighting) → top-level prompt
 * - strip global anchors from per-shot prompts to avoid duplication
 *
 * The top-level prompt becomes a concise global identity string.
 */
function buildGlobalPromptForMultiShot(basePrompt: string): string {
  const global = extractGlobalAnchors(basePrompt);
  if (global.length > 20) return deduplicatePromptClauses(global);
  // Fallback: use first 2 sentences as global context
  const sentences = basePrompt.split(/\.\s+/).filter(s => s.trim().length > 5);
  return sentences.slice(0, 2).join(". ").trim();
}

/** StructuredSequenceDocument의 서버 측 미러 (클라이언트에서 전달) — v2 dense fields 포함 */
interface StructuredSequencePayload {
  // ── Dense Sequence Fields (v2) ──
  sequenceId?: string;
  sceneType?: string;
  durationSec?: number;
  styleProfile?: { mode: string; mediumLock?: string; colorAnchor?: string };
  continuity?: { lighting: string; sky?: string; surface?: string; scale?: string; characterRef?: string; mustPersist: string[] };
  physicsRules?: { hasWind: boolean; hasAtmosphere: boolean; gravity: string; flagMotionSource?: string; skyConstraint?: string; lightConstraint?: string; bannedExpressions: string[]; environmentType: string };
  placeIdentityAnchors?: string[];
  situationEvidence?: string[];
  naturalMotion?: string[];
  cameraPlan?: { baseFraming: string; angle: string; motion: string; motionMotivation?: string };
  temporalBeats?: Array<{ startSec: number; endSec: number; focus: string }>;
  densityScore?: { total: number; breakdown: Record<string, boolean>; missing: string[] };
  shots?: Array<{ shotId: string; startSec: number; endSec: number; camera: { framing: string; angle: string; motion: string }; subject: string; action: string; environment: string; moodLighting: string; focus: string }>;

  // ── Legacy / Existing ──
  shotId: string;
  cutNumber: number;
  shotPlan: {
    camera: { framing: string; angle: string; motion: string; motionMotivation?: string };
    subject: { primary: string; secondary?: string[]; characterRef?: string; blocking?: string };
    environment: string;
    action: string;
    moodLighting: string;
    timingBeat?: string;
    transitionFromPrev?: string;
    locationCue?: string;
    situationCue?: string;
    emotionalAnchor?: string;
    visualMedium?: string;
    negativeDirectives?: string[];
    [key: string]: unknown;
  };
  videoPromptJson?: VideoPromptJson;
  negatives?: {
    universal: string[];
    style?: string[];
    sceneSpecific: string[];
    failureMode: string[];
    user: string[];
  };
  validation?: { valid: boolean; errors: number; warnings: number; issues?: Array<{ rule: string; severity: string; message: string }> };
}

/**
 * 서버 사이드 last-mile 직렬화 + final validation.
 * StructuredSequencePayload → Kling 전송용 문자열.
 *
 * 이 함수가 서버에서 provider payload를 만드는 유일한 경로다.
 * 반환값의 prompt/negativePrompt만 provider에 전송해야 한다.
 */
function serializeSequenceToPrompt(
  seq: StructuredSequencePayload,
): { prompt: string; negativePrompt: string; valid: boolean; blocked: boolean; blockReason?: string; payloadSnapshot: string } {
  const provider = "kling" as const;

  // videoPromptJson이 있으면 Kling 렌더러 사용
  if (seq.videoPromptJson) {
    return {
      prompt: renderKlingPromptFromJson(seq.videoPromptJson),
      negativePrompt: "",
      valid: true,
      blocked: false,
      payloadSnapshot: JSON.stringify({ prompt: renderKlingPromptFromJson(seq.videoPromptJson), negativePrompt: "", provider }),
    };
  }

  // videoPromptJson 없으면 shotPlan에서 직접 직렬화
  const shot = seq.shotPlan;
  const parts: string[] = [];

  const framingMap: Record<string, string> = {
    ECU: "Extreme close-up", CU: "Close-up", MCU: "Medium close-up",
    MS: "Medium shot", MLS: "Medium long shot", LS: "Long shot",
    WS: "Wide shot", OTS: "Over-the-shoulder", POV: "Point-of-view",
  };
  const angleMap: Record<string, string> = {
    eye_level: "eye-level", low_angle: "low-angle", high_angle: "high-angle",
    dutch: "dutch angle", overhead: "overhead", POV: "POV",
  };

  // Camera — cameraPlan이 있으면 우선 사용, 없으면 shotPlan.camera fallback
  const cam = seq.cameraPlan || shot.camera;
  const camFraming = "baseFraming" in cam ? (cam as typeof seq.cameraPlan).baseFraming : shot.camera.framing;
  const framing = framingMap[camFraming] || camFraming;
  const camAngle = "angle" in cam ? cam.angle : shot.camera.angle;
  const angle = angleMap[camAngle] || camAngle;
  const camMotion = "motion" in cam ? cam.motion : shot.camera.motion;
  const motion = camMotion && camMotion !== "static"
    ? `, ${camMotion}` : "";
  parts.push(`${framing}, ${angle}${motion}`);

  // cameraPlan에 motionMotivation이 있으면 연속 카메라 의미 보존
  const camMotivation = seq.cameraPlan?.motionMotivation || shot.camera.motionMotivation;
  if (camMotivation) {
    parts.push(`continuous camera move — ${camMotivation}`);
  }

  // Subject
  if (shot.subject.primary) {
    const line = shot.subject.blocking
      ? `${shot.subject.primary}, ${shot.subject.blocking}`
      : shot.subject.primary;
    parts.push(line);
  }

  // placeIdentityAnchors — 장소 정체성 (shotPlan.locationCue보다 우선)
  if (seq.placeIdentityAnchors && seq.placeIdentityAnchors.length > 0) {
    parts.push(seq.placeIdentityAnchors.join(", "));
  } else if (shot.locationCue) {
    parts.push(shot.locationCue);
  }

  // situationEvidence — 상황 증거 (shotPlan.situationCue보다 우선)
  if (seq.situationEvidence && seq.situationEvidence.length > 0) {
    parts.push(seq.situationEvidence.join(", "));
  } else if (shot.situationCue) {
    parts.push(shot.situationCue);
  }

  if (shot.subject.characterRef) parts.push(shot.subject.characterRef);
  if (shot.emotionalAnchor) parts.push(shot.emotionalAnchor);
  if (shot.action) parts.push(shot.action);

  // naturalMotion — 환경 자연 모션 (바람, 물, 빛 변화 등)
  if (seq.naturalMotion && seq.naturalMotion.length > 0) {
    parts.push(seq.naturalMotion.join(", "));
  }

  if (shot.moodLighting) parts.push(shot.moodLighting);

  // temporalBeats — 시간 진행 구조 (shotPlan.timingBeat보다 우선)
  if (seq.temporalBeats && seq.temporalBeats.length > 0) {
    const beatStr = seq.temporalBeats
      .map(b => `${b.startSec}s-${b.endSec}s: ${b.focus}`)
      .join(". ");
    parts.push(beatStr);
  } else if (shot.timingBeat) {
    parts.push(shot.timingBeat);
  }

  if (shot.transitionFromPrev) parts.push(`Previous shot ends with ${shot.transitionFromPrev}`);
  if (shot.visualMedium) parts.push(shot.visualMedium);

  // physicsRules — 환경 물리 제약 반영
  if (seq.physicsRules) {
    const pr = seq.physicsRules;
    const physParts: string[] = [];

    // 대기 없는 환경 (진공)
    if (!pr.hasAtmosphere) {
      physParts.push("vacuum environment — no atmospheric effects");
    }

    // 바람 없는 환경
    if (!pr.hasWind) {
      physParts.push("no wind");
    }

    // 중력
    if (pr.gravity === "low") {
      physParts.push("low gravity — slow arcing trajectories, objects settle gradually");
    } else if (pr.gravity === "zero") {
      physParts.push("zero gravity — objects float freely");
    }

    // 깃발 등 특수 물체 모션 소스
    if (pr.flagMotionSource) {
      physParts.push(pr.flagMotionSource);
    }

    // 하늘/광원 제약
    if (pr.skyConstraint) physParts.push(pr.skyConstraint);
    if (pr.lightConstraint) physParts.push(pr.lightConstraint);

    // 금지 표현
    if (pr.bannedExpressions && pr.bannedExpressions.length > 0) {
      physParts.push(`avoid: ${pr.bannedExpressions.join(", ")}`);
    }

    if (physParts.length > 0) {
      parts.push(physParts.join(". "));
    }
  }

  // Audio hint
  const isNoAtmosphere = seq.physicsRules && !seq.physicsRules.hasAtmosphere;
  if (isNoAtmosphere) {
    parts.push("Vacuum silence — no audible environment");
  }

  // "No text overlay, no watermark" → negatives로 이동 (positive에 "No ..."는 역효과)

  let prompt = parts.filter(Boolean).join(". ");

  // Negatives — "text overlay", "watermark"는 반드시 negatives에 포함 (positive에서 제거됨)
  const baseNeg = seq.negatives
    ? [...seq.negatives.universal, ...(seq.negatives.style || []), ...seq.negatives.sceneSpecific, ...seq.negatives.failureMode, ...seq.negatives.user]
    : (shot.negativeDirectives || []);
  const allNeg = [...baseNeg, "text overlay", "watermark"];
  let uniqueNeg = [...new Set(allNeg)].slice(0, 30);

  // ═══════════════════════════════════════════════════════════════
  // 전역 Sanitize Pipeline (서버 마지막 직렬화 지점)
  // ═══════════════════════════════════════════════════════════════
  const sanitizeResult = serverSanitizeAndValidate({
    prompt,
    negatives: uniqueNeg,
    framing: shot.camera.framing,
    shotCategory: shot.shotCategory,
    styleSuffix: seq.videoPromptJson?.styleSuffix,
    provider,
    physicsRules: seq.physicsRules ? {
      hasWind: seq.physicsRules.hasWind,
      hasAtmosphere: seq.physicsRules.hasAtmosphere,
      gravity: seq.physicsRules.gravity,
      environmentType: seq.physicsRules.environmentType,
      bannedExpressions: seq.physicsRules.bannedExpressions,
    } : undefined,
    sceneType: seq.sceneType,
    durationSec: seq.durationSec,
  });
  prompt = sanitizeResult.prompt;
  uniqueNeg = sanitizeResult.negatives;
  if (sanitizeResult.log.length > 0) {
    console.log("[serializeSequenceToPrompt] sanitize:", {
      cutNumber: seq.cutNumber,
      log: sanitizeResult.log,
      valid: sanitizeResult.valid,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Final Validation — pos/neg 충돌 재검증
  // ═══════════════════════════════════════════════════════════════
  const criticalPosNegWords = ["watermark", "caption", "subtitle", "logo", "photorealistic", "cinematic", "text overlay"];
  const promptLower = prompt.toLowerCase();
  const finalFixLog: string[] = [];
  uniqueNeg = uniqueNeg.filter(neg => {
    const negLower = neg.toLowerCase().trim();
    if (criticalPosNegWords.some(w => negLower.includes(w)) && promptLower.includes(negLower)) {
      finalFixLog.push(`[server-final-validation] Removed conflicting negative "${neg}" (found in prompt)`);
      return false;
    }
    return true;
  });
  if (finalFixLog.length > 0) {
    console.log("[serializeSequenceToPrompt] final validation fixes:", {
      cutNumber: seq.cutNumber,
      fixes: finalFixLog,
    });
  }

  const negStr = uniqueNeg.join(", ");

  // Kling: separate negative prompt (no embedding in main prompt)
  // Word cap: 300, Char cap: 2500 for Kling
  const maxWords = 300;
  const maxChars = 2500;
  const words = prompt.split(/\s+/);
  if (words.length > maxWords) {
    prompt = words.slice(0, maxWords - 5).join(" ");
  }
  if (prompt.length > maxChars) {
    const cutoff = prompt.lastIndexOf(". ", maxChars - 10);
    prompt = cutoff > maxChars * 0.5
      ? prompt.slice(0, cutoff + 1)
      : prompt.slice(0, maxChars);
  }

  prompt = prompt
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  // ═══════════════════════════════════════════════════════════════
  // Hard-fix: 본문에서 pos/neg 충돌 최종 제거
  // ═══════════════════════════════════════════════════════════════
  const ZERO_TOLERANCE = ["watermark", "caption", "subtitle", "logo", "photorealistic", "cinematic"];
  let body = prompt;
  const effectiveNeg = negStr.split(", ");

  for (const word of ZERO_TOLERANCE) {
    const wl = word.toLowerCase();
    if (!effectiveNeg.some(n => n.toLowerCase().includes(wl))) continue;
    if (!body.toLowerCase().includes(wl)) continue;
    const guardRe = new RegExp(`\\b(?:no|avoid|without)\\s+(?:[\\w\\s,]+\\s+)?${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (guardRe.test(body)) continue;
    body = body.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "")
      .replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
    finalFixLog.push(`[hard-fix] Removed "${word}" from prompt body (zero-tolerance conflict)`);
  }
  prompt = body.replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();

  // ═══════════════════════════════════════════════════════════════
  // Hard-block check
  // ═══════════════════════════════════════════════════════════════
  let blocked = false;
  let blockReason: string | undefined;
  const bodyAfterFix = prompt.toLowerCase();
  const remainingConflicts = ZERO_TOLERANCE.filter(w => {
    const wl = w.toLowerCase();
    if (!effectiveNeg.some(n => n.toLowerCase().includes(wl))) return false;
    if (!bodyAfterFix.includes(wl)) return false;
    const guardRe = new RegExp(`\\b(?:no|avoid|without)\\s+(?:[\\w\\s,]+\\s+)?${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return !guardRe.test(bodyAfterFix);
  });
  if (remainingConflicts.length > 0) {
    blocked = true;
    blockReason = `pos_neg_conflict: ${remainingConflicts.join(", ")} still in prompt after hard-fix`;
  }

  // ═══════════════════════════════════════════════════════════════
  // Server hard gate: scene-type / shot-count / framing validation
  // ═══════════════════════════════════════════════════════════════
  const MULTI_SHOT_SCENE_TYPES = new Set([
    "environment", "character-driven", "character", "crowd",
    "battle", "map-graphic", "map_visualization", "cinematic_sequence",
  ]);
  const shotCount = seq.shots?.length ?? 1;
  const sceneType = seq.sceneType || "unknown";
  const durationSec = seq.durationSec && seq.durationSec > 0 ? seq.durationSec : 8;

  // Hard gate 1: environment/character/battle scenes with 1 shot AND duration > 3s → warn (not block)
  if (MULTI_SHOT_SCENE_TYPES.has(sceneType) && shotCount < 2 && durationSec > 3) {
    console.warn("[serializeSequenceToPrompt] ⚠️ HARD-GATE: single-shot multi-shot-required scene", {
      sceneType,
      shotCount,
      durationSec,
      cutNumber: seq.cutNumber,
    });
    finalFixLog.push(`[hard-gate] ${sceneType} scene has only ${shotCount} shot(s) for ${durationSec}s — should be 2+`);
  }

  // Hard gate 2: environment scene with close framing → force warn
  if (sceneType === "environment" || sceneType === "map-graphic" || sceneType === "map_visualization") {
    const framing = shot.camera?.framing?.toUpperCase();
    if (framing && ["CU", "ECU", "MCU"].includes(framing)) {
      console.warn("[serializeSequenceToPrompt] ⚠️ HARD-GATE: environment/map scene with close framing", {
        sceneType,
        framing,
        cutNumber: seq.cutNumber,
      });
      finalFixLog.push(`[hard-gate] ${sceneType} scene has close framing "${framing}" — should be WS/LS`);
    }
  }

  // Hard gate 3: empty prompt → block
  if (prompt.trim().length < 20) {
    blocked = true;
    blockReason = blockReason
      ? `${blockReason}; prompt_too_short (${prompt.trim().length} chars)`
      : `prompt_too_short: only ${prompt.trim().length} chars after processing`;
  }

  const payloadSnapshot = JSON.stringify({ prompt, negativePrompt: negStr, provider });

  if (finalFixLog.length > 0) {
    console.log("[serializeSequenceToPrompt] final validation fixes:", {
      cutNumber: seq.cutNumber,
      fixes: finalFixLog,
      blocked,
      blockReason,
    });
  }

  return {
    prompt,
    negativePrompt: negStr,
    valid: !blocked,
    blocked,
    blockReason,
    payloadSnapshot,
  };
}

interface GenerateVideoRequest {
  // ── 공통 ──────────────────────────────────────────────────────────────────
  /** @deprecated legacy fallback. source of truth는 structuredSequence. */
  prompt?: string;
  engine?: "kling" | "auto";   // auto = kling
  videoMode?: "generate" | "extend";
  sourceVideo?: string;
  cutNumber?: number;
  /** 워크플로우 타입 — 모델 자동 선택에 사용. 미지정 시 컨텍스트 기반 판단. */
  workflowType?: "text-to-video" | "image-to-video" | "reference-to-video" | "custom-element";
  // ── JSON-first source of truth (최우선) ───────────────────────────────────
  structuredSequence?: StructuredSequencePayload;
  // ── JSON 프롬프트 (structuredSequence 없으면 fallback) ─────────────────────
  videoPromptJson?: VideoPromptJson;
  extendPromptJson?: ExtendPromptJson;
  // ── Kling 전용 ──────────────────────────────────────────────────────────────
  durationSeconds?: number;
  aspectRatio?: string;
  negativePrompt?: string;
  firstFrameBase64?: string;
  lastFrameBase64?: string;
  multiShot?: KlingMultiShot[];
  generateAudio?: boolean; // true = sound "on", false = sound "off"
  /** 생성 모드 — Studio(엄격 검증) vs Batch(auto-repair) */
  generationMode?: "studio" | "batch";
  /** 의도적 원테이크 — 강제 멀티샷 정책 무시 */
  intentionalOneTake?: boolean;
  // ── Custom Element (캐릭터 일관성) ──────────────────────────────────────
  element_list?: Array<{ element_id: string }>;
  // ── Reference Images (reference-to-video 워크플로우용) ──────────────────
  referenceImages?: string[];
  // ── Continuity Mode ──────────────────────────────────────────
  /** continuity mode 세그먼트 메타 — 프롬프트에 연속성 정보 주입 */
  continuityMeta?: {
    segmentIndex: number;
    totalSegments: number;
    isLastSegment: boolean;
    prevEndState?: Record<string, unknown>;
    characterLock?: string;
    visualLock?: string;
  };
  // ── Legacy fields (무시됨) ──────────────────────────────────────────
  mode?: string;
  resolution?: string;
  personGeneration?: string;
  seed?: number;
  sampleCount?: number;
  previousVideoUri?: string;
}

// ── base64 data URI 접두사 제거 ────────────────────────────────────────────
function stripDataPrefix(b64: string): string {
  return b64.replace(/^data:[^;]+;base64,/, "");
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const tServerStart = Date.now();
  try {
    const req = await context.request.json() as GenerateVideoRequest;

    // ── JSON-first 프롬프트 해석 ─────────────────────────────────────────────
    // source of truth: structuredSequence (1급) > videoPromptJson (legacy) > prompt (legacy fallback)
    let finalPromptForProvider: string | undefined;
    let usedPath: "structuredSequence" | "videoPromptJson" | "prompt_legacy" = "prompt_legacy";
    let fallbackReason: string | undefined;
    const hasStructuredSequence = !!req.structuredSequence?.shotPlan;

    let payloadSnapshot: string | undefined;
    let klingNegativePrompt = req.negativePrompt || "";

    if (hasStructuredSequence) {
      const serialized = serializeSequenceToPrompt(req.structuredSequence!);
      if (serialized.blocked) {
        console.error("[generate-video] BLOCKED by final validation:", serialized.blockReason);
        return Response.json(
          { error: `Generation blocked: ${serialized.blockReason}`, blocked: true },
          { status: 422 },
        );
      }
      finalPromptForProvider = serialized.prompt;
      payloadSnapshot = serialized.payloadSnapshot;
      klingNegativePrompt = serialized.negativePrompt || klingNegativePrompt;
      usedPath = "structuredSequence";
      console.log("[generate-video] structuredSequence → 서버 직렬화 (last-mile)", {
        cutNumber: req.cutNumber,
        shotId: req.structuredSequence!.shotId,
        serializedLen: finalPromptForProvider.length,
        serializedPreview: finalPromptForProvider.slice(0, 120),
        valid: serialized.valid,
        blocked: serialized.blocked,
      });
    } else if (req.videoPromptJson && !req.prompt) {
      finalPromptForProvider = renderKlingPromptFromJson(req.videoPromptJson);
      usedPath = "videoPromptJson";
      fallbackReason = "no structuredSequence";

      const legacySanitize = serverSanitizeAndValidate({
        prompt: finalPromptForProvider,
        negatives: req.negativePrompt ? req.negativePrompt.split(",").map(s => s.trim()) : [],
        framing: req.videoPromptJson.shotSize || "MS",
        shotCategory: undefined,
        styleSuffix: req.videoPromptJson.styleSuffix,
        provider: "kling",
      });
      finalPromptForProvider = legacySanitize.prompt;
      if (legacySanitize.log.length > 0) {
        console.log("[generate-video] videoPromptJson legacy sanitize:", legacySanitize.log);
      }
    } else if (req.prompt) {
      finalPromptForProvider = req.prompt;
      usedPath = "prompt_legacy";
      fallbackReason = "no structuredSequence, no videoPromptJson";

      const legacySanitize = serverSanitizeAndValidate({
        prompt: finalPromptForProvider,
        negatives: req.negativePrompt ? req.negativePrompt.split(",").map(s => s.trim()) : [],
        framing: "MS",
        shotCategory: undefined,
        provider: "kling",
      });
      finalPromptForProvider = legacySanitize.prompt;
    }

    if (!finalPromptForProvider) {
      return Response.json({ error: "structuredSequence, videoPromptJson, or prompt must be provided" }, { status: 400 });
    }

    // ── Continuity Mode: 프롬프트 앞에 연속성 정보 주입 ──────────────────
    // No bracket tags — only plain visual descriptions for the provider.
    if (req.continuityMeta) {
      const cm = req.continuityMeta;
      const continuityParts: string[] = [];

      // Character lock — plain description, no [CHARACTER LOCK] tag
      if (cm.characterLock) {
        continuityParts.push(`Maintain character: ${cm.characterLock}`);
      }

      // Visual lock — extract compact medium/material/palette anchors only
      // Do NOT use the full styleSuffix (it duplicates style text already in the prompt)
      if (cm.visualLock) {
        const compactLock = extractCompactVisualLock(cm.visualLock);
        if (compactLock) {
          continuityParts.push(`Consistent look: ${compactLock}`);
        }
      }

      // Previous segment end state continuation — plain prose, no [CONTINUATION] tag
      if (cm.prevEndState && cm.segmentIndex > 0) {
        const pe = cm.prevEndState;
        const contLines = ["Continue seamlessly from previous segment:"];
        if (pe.subjectPosition) contLines.push(`Subject: ${pe.subjectPosition}`);
        if (pe.cameraState) contLines.push(`Camera: ${pe.cameraState}`);
        if (pe.motionVector) contLines.push(`Motion: ${pe.motionVector}`);
        if (pe.lightingState) contLines.push(`Lighting: ${pe.lightingState}`);
        continuityParts.push(contLines.join(" "));
      }

      // Ending rule — plain instruction, no [ENDING] tag
      if (!cm.isLastSegment) {
        continuityParts.push("Last 2 seconds: mid-action, camera moving, emotion unresolved. Do not close the scene.");
      }

      if (continuityParts.length > 0) {
        const continuityPrefix = continuityParts.join(". ") + ". ";
        finalPromptForProvider = continuityPrefix + finalPromptForProvider;
        console.log("[generate-video] continuity meta injected (clean, no bracket tags):", {
          segmentIndex: cm.segmentIndex,
          totalSegments: cm.totalSegments,
          isLastSegment: cm.isLastSegment,
          prefixLen: continuityPrefix.length,
        });
      }
    }

    console.log("[generate-video] source-of-truth resolution:", {
      usedPath,
      hasStructuredSequence,
      fallbackReason: fallbackReason || "none (structured path)",
      finalPromptLen: finalPromptForProvider.length,
      finalPromptPreview: finalPromptForProvider.slice(0, 120),
    });

    // durationSeconds 타입 검증
    if (req.durationSeconds !== undefined) {
      const durNum = Number(req.durationSeconds);
      if (!Number.isFinite(durNum) || durNum <= 0) {
        return Response.json(
          { error: `durationSeconds must be a positive number, got: ${JSON.stringify(req.durationSeconds)}` },
          { status: 400 },
        );
      }
      req.durationSeconds = durNum;
    }

    // ── 엔진 선택: Kling 전용 ──────────────────────────────────────────────
    const hasKling = !!context.env.KLING_API_KEY;
    if (!hasKling) {
      return Response.json(
        { error: "KLING_API_KEY not configured. Only Kling is supported." },
        { status: 400 },
      );
    }

    const engineUsed = "kling" as const;

    // CUT 1 서버 방어
    const cutNumberRaw = req.cutNumber != null ? Number(req.cutNumber) : null;
    const videoMode = (req.videoMode === "extend" && cutNumberRaw === 1)
      ? "generate"
      : (req.videoMode ?? "extend");

    if (req.videoMode === "extend" && cutNumberRaw === 1) {
      console.warn("[generate-video] CUT 1에 videoMode=extend 요청 → generate로 강제 전환");
    }

    const sourceVideo = req.sourceVideo || req.previousVideoUri || "";

    // ── Kling 생성 ────────────────────────────────────────────────────────────
    const requestedDuration = req.durationSeconds;
    const normalizedDuration = req.durationSeconds && req.durationSeconds > 0 ? req.durationSeconds : 8;
    const duration = toKlingDuration(normalizedDuration);
    const durationWarnings: string[] = [];
    if (requestedDuration !== undefined && requestedDuration !== duration) {
      durationWarnings.push(`요청 ${requestedDuration}초 → Kling 전송 ${duration}초 (클램핑 적용)`);
    }
    const aspectRatio = toKlingAspectRatio(req.aspectRatio ?? "16:9");

    // Audio: generateAudio 설정 + physics override (무대기 환경은 강제 off)
    const physicsNoAtmo = req.structuredSequence?.physicsRules && !req.structuredSequence.physicsRules.hasAtmosphere;
    const soundParam: "on" | "off" = physicsNoAtmo ? "off" : (req.generateAudio !== false ? "on" : "off");

    // base64 검증
    const strippedFirst = req.firstFrameBase64 ? stripDataPrefix(req.firstFrameBase64) : "";
    const strippedLast  = req.lastFrameBase64  ? stripDataPrefix(req.lastFrameBase64)  : "";
    const validFirst    = strippedFirst.length > 100 ? strippedFirst : "";
    const validLast     = strippedLast.length  > 100 ? strippedLast  : "";

    console.log("[Kling] 요청 진단", {
      cutNumber: cutNumberRaw,
      provider: "kling",
      selectedMode: videoMode,
      originalReqMode: req.videoMode ?? null,
      hasFirstFrame: !!req.firstFrameBase64,
      validFirstLen: validFirst.length,
      hasLastFrame: !!req.lastFrameBase64,
      validLastLen: validLast.length,
    });

    let taskId: string;
    let modeUsed: "generate" | "extend";
    let sentDuration: number = duration;

    // ── 워크플로우 기반 모델 선택 ──────────────────────────────────────────
    // workflowType이 명시적이면 그것을 존중, 아니면 컨텍스트에서 자동 판단
    const hasRefImages = req.referenceImages && req.referenceImages.length > 0 &&
      req.referenceImages.some(img => img.length > 100);
    const modelUsed = resolveModelForWorkflow({
      workflow: req.workflowType,
      hasImage: !!validFirst || !!validLast,
      hasReferenceImages: !!hasRefImages,
      // video-edit은 현재 사용하지 않음
    });

    console.log("[Kling] 모델 선택", {
      workflowType: req.workflowType ?? "(auto)",
      modelUsed,
      hasImage: !!validFirst,
      hasRefImages: !!hasRefImages,
    });

    // ── 서버 멀티샷 정책 시행 ──────────────────────────────────────────────
    const serverMaxShots = getMaxShots(modelUsed, normalizedDuration);
    const hasMultiShotPayload = req.multiShot && req.multiShot.length >= 2;
    const isStudioMode = req.generationMode === "studio";
    const isIntentionalOneTake = req.intentionalOneTake === true;

    // 강제 멀티샷 판정: 9초 이상이거나, 씬 타입 + 6초 이상
    const FORCE_SCENE_TYPES = new Set([
      "cinematic_sequence", "environment", "character-driven", "battle", "montage",
    ]);
    const sceneCategory = req.structuredSequence?.shotCategory ?? "";
    const shouldForce = serverMaxShots >= 2 && !isIntentionalOneTake && (
      normalizedDuration >= 9 ||
      (normalizedDuration >= 6 && FORCE_SCENE_TYPES.has(sceneCategory))
    );

    if (shouldForce && !hasMultiShotPayload) {
      if (isStudioMode) {
        // Studio Mode: 블로킹 — 멀티샷 없는 긴 시네마틱 클립 거부
        return Response.json(
          {
            error: `Studio Mode: ${normalizedDuration}초 ${sceneCategory || "clip"} — 멀티샷 필수. 의도적 원테이크라면 intentionalOneTake=true 설정 필요.`,
            code: "forced_multishot_missing",
            retryable: false,
          },
          { status: 400 },
        );
      } else {
        // Batch Mode: auto-repair — 역할 기반 멀티샷 자동 생성
        // Each shot gets a semantically different visual description (no bracket tags, no repeated base prompt)
        const autoShotCount = normalizedDuration <= 5 ? 2
          : normalizedDuration <= 9 ? 3
          : normalizedDuration <= 12 ? Math.min(4, serverMaxShots)
          : Math.min(5, serverMaxShots);
        const basePrompt = finalPromptForProvider || "";
        const repairedShots = buildServerMultiShot(basePrompt, autoShotCount, normalizedDuration);
        req.multiShot = repairedShots;
        console.log("[Kling] Batch auto-repair: 멀티샷 자동 생성 (decomposed)", {
          shotCount: autoShotCount,
          durations: repairedShots.map(s => s.duration),
          promptPreviews: repairedShots.map(s => s.prompt.slice(0, 60)),
        });
      }
    }

    // ── 멀티샷 최소 샷 수 강제 ──
    // 절대 규칙: 6~9초 = 최소 3샷, 10~15초 = 최소 4샷
    // LLM이 부족한 샷을 생성하면 자동 확장.
    if (req.multiShot && req.multiShot.length > 0 && normalizedDuration >= 6 && serverMaxShots >= 3) {
      const currentCount = req.multiShot.length;
      const minRequired = normalizedDuration >= 10 ? 4
        : normalizedDuration >= 6 ? 3
        : 2;
      const targetCount = Math.max(minRequired, Math.min(
        normalizedDuration <= 8 ? 3
          : normalizedDuration <= 12 ? 4
          : Math.min(5, serverMaxShots),
        serverMaxShots,
      ));

      if (currentCount < targetCount) {
        console.warn(`[Kling] 멀티샷 최소 강제: ${currentCount}샷 → ${targetCount}샷 (${normalizedDuration}s, min=${minRequired})`);
        const basePrompt = finalPromptForProvider || "";
        const totalDur = req.multiShot.reduce((s: number, sh: KlingMultiShot) => s + (parseFloat(sh.duration) || 0), 0) || normalizedDuration;
        // Build semantically different shots using role-based decomposition (no bracket tags)
        const repairedShots = buildServerMultiShot(basePrompt, targetCount, totalDur);
        req.multiShot = repairedShots;
      }
    }

    // 멀티샷 서버 클램프 (모델 capability 초과 방지)
    if (req.multiShot && req.multiShot.length > 0 && serverMaxShots > 0) {
      req.multiShot = normalizeMultiShots(modelUsed, req.multiShot, normalizedDuration);
    } else if (req.multiShot && serverMaxShots <= 0) {
      // 모델이 멀티샷 미지원 → 제거
      req.multiShot = undefined;
    }

    // ═══════════════════════════════════════════════════════════════════
    // FINAL PROVIDER-FACING CLEANUP
    // 1. Strip internal tags  2. Normalize contradictions
    // 3. Deduplicate  4. Separate global vs per-shot
    // ═══════════════════════════════════════════════════════════════════
    const cleanupLog: string[] = [];

    // Step 1: Strip internal editorial tags
    finalPromptForProvider = stripInternalTags(finalPromptForProvider);

    // Step 2: Normalize scene contradictions (indoor light vs outdoor, epic narrative vs medical)
    const normResult = normalizeSceneContradictions(finalPromptForProvider);
    finalPromptForProvider = normResult.text;
    cleanupLog.push(...normResult.log);

    // Step 3: Deduplicate
    finalPromptForProvider = deduplicatePromptClauses(finalPromptForProvider);

    if (req.multiShot && req.multiShot.length > 0) {
      // Clean each shot prompt: strip tags → normalize contradictions → deduplicate
      for (const shot of req.multiShot) {
        shot.prompt = cleanShotPrompt(shot.prompt);
        const shotNorm = normalizeSceneContradictions(shot.prompt);
        shot.prompt = shotNorm.text;
        cleanupLog.push(...shotNorm.log);
        shot.prompt = deduplicatePromptClauses(shot.prompt);
      }
      // When multiShot is present, top-level prompt should be global-only
      // (medium, material, era, location, stable light) — not the full scene description
      const globalOnly = buildGlobalPromptForMultiShot(finalPromptForProvider);
      if (globalOnly.length > 20) {
        finalPromptForProvider = globalOnly;
      }
    }

    if (cleanupLog.length > 0) {
      console.log("[generate-video] scene normalization applied:", cleanupLog);
    }

    console.log("[generate-video] provider-facing cleanup done:", {
      promptLen: finalPromptForProvider.length,
      promptPreview: finalPromptForProvider.slice(0, 150),
      multiShotCount: req.multiShot?.length ?? 0,
      multiShotPreviews: req.multiShot?.map(s => s.prompt.slice(0, 80)) ?? [],
    });

    // ═══════════════════════════════════════════════════════════════════
    // DEBUG: Final provider payload snapshot (opt-in via env var)
    // Set KLING_DEBUG_PAYLOAD=1 in .dev.vars or wrangler.toml to enable.
    // Logs only the cleaned prompt payload — no secrets, no base64 images.
    // ═══════════════════════════════════════════════════════════════════
    if ((context.env as Record<string, string>).KLING_DEBUG_PAYLOAD === "1") {
      console.log("[KLING_DEBUG_PAYLOAD] ═══════════════════════════════════════");
      console.log("[KLING_DEBUG_PAYLOAD] top-level prompt:", finalPromptForProvider);
      console.log("[KLING_DEBUG_PAYLOAD] negative_prompt:", klingNegativePrompt);
      if (req.multiShot && req.multiShot.length > 0) {
        for (const shot of req.multiShot) {
          console.log(`[KLING_DEBUG_PAYLOAD] shot[${shot.index}] (${shot.duration}s):`, shot.prompt);
        }
      }
      console.log("[KLING_DEBUG_PAYLOAD] ═══════════════════════════════════════");
    }

    try {
      if (videoMode === "extend" && validLast) {
        console.log("[Kling] EXTEND mode (last-frame → image-to-video)", { frameLen: validLast.length });
        const result = await klingExtend(context.env, {
          lastFrameBase64: validLast,
          prompt:          finalPromptForProvider,
          negative_prompt: klingNegativePrompt,
          duration,
          aspect_ratio:    aspectRatio,
          sound:           soundParam,
        });
        taskId = result.taskId;
        sentDuration = result.sentDuration;
        modeUsed = "extend";
      } else {
        if (!validFirst && videoMode === "extend" && !sourceVideo) {
          console.error("[Kling] extend 요청이지만 유효한 image/sourceVideo 없음");
          return Response.json(
            {
              error: "Kling EXTEND mode requires valid lastFrameBase64, firstFrameBase64, or sourceVideo",
              details: { videoMode, hasLastFrame: !!req.lastFrameBase64, hasFirstFrame: !!req.firstFrameBase64 },
            },
            { status: 400 },
          );
        }

        console.log("[Kling] GENERATE mode", {
          hasImage: !!validFirst,
          hasImageTail: !!validLast,
          model: modelUsed,
        });
        const result = await klingGenerate(context.env, {
          model:           modelUsed,
          prompt:          finalPromptForProvider,
          negative_prompt: klingNegativePrompt,
          aspect_ratio:    aspectRatio,
          duration,
          sound:           soundParam,
          ...(validFirst ? { image:      validFirst } : {}),
          ...(validLast  ? { image_tail: validLast  } : {}),
          ...(req.multiShot && req.multiShot.length > 0 ? { multiShot: req.multiShot } : {}),
          ...(req.element_list && req.element_list.length > 0 ? { element_list: req.element_list } : {}),
        });
        taskId = result.taskId;
        sentDuration = result.sentDuration;
        modeUsed = "generate";
      }
    } catch (klingErr) {
      // 403 model_access_denied — 재시도 불가, 명확한 에러 분류
      if (klingErr instanceof KlingModelAccessDeniedError) {
        console.error("[Kling] MODEL_ACCESS_DENIED (not retryable)", {
          modelRequested: klingErr.modelRequested,
          cutNumber: req.cutNumber,
        });
        return Response.json(
          {
            error: klingErr.message,
            code: "model_access_denied",
            retryable: false,
            modelRequested: klingErr.modelRequested,
            modelFallback: KLING_MODELS.TEXT_TO_VIDEO,
          },
          { status: 403 },
        );
      }

      const msg = klingErr instanceof Error ? klingErr.message : String(klingErr);
      const httpStatus = (klingErr as Error & { httpStatus?: number }).httpStatus;
      const status = httpStatus === 400 ? 400 : httpStatus === 401 ? 401 : 502;
      console.error("[Kling] API 에러", { msg, httpStatus, cutNumber: req.cutNumber });
      return Response.json({ error: msg }, { status });
    }

    const serverTotalMs = Date.now() - tServerStart;
    console.log("[generate-video] ⏱ timing", {
      serverTotalMs,
      promptChars: finalPromptForProvider.length,
      mode: videoMode,
      cutNumber: cutNumberRaw,
      engine: "kling",
      durationRequested: requestedDuration,
      durationNormalized: normalizedDuration,
      durationSent: sentDuration,
    });

    return Response.json({
      operationName: taskId,
      taskId,
      engine: "kling",
      modeUsed,
      modelUsed,
      sourceVideo: sourceVideo || undefined,
      status: "RUNNING",
      durationMeta: {
        requestedSecondsPerScene: requestedDuration,
        normalizedSecondsPerScene: normalizedDuration,
        sentSecondsPerScene: sentDuration,
        warnings: durationWarnings,
      },
    });
  } catch (error) {
    console.error("[generate-video] 처리 오류:", error);
    return Response.json(
      { error: `Failed to start video generation: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
};
