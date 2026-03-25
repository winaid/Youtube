/**
 * shot-splitting.ts — Multi-shot sequence enforcement
 *
 * 단일 shot summary를 진짜 sequence(2~6 shots)로 분리.
 * "A → B → C → D → E → F" progression을 감지하고 자동으로 shot 분할.
 * VEO 모델 기준 최대 6샷.
 *
 * grep: detectShotProgression, splitSingleShotSequence,
 *       enforceMinimumShotCount, isSingleShotException,
 *       rebalanceShotTimings, validateSequenceDensity,
 *       MAX_SPLIT_SHOTS
 */


import { VEO_DEFAULT_MODEL } from "@/lib/veo-capability";
import { MULTI_SHOT_SCENE_TYPES } from "@/lib/multi-shot-scene-types";

/** VEO 정책: 7초≤=3샷, 8초+=4샷 */
const getMinShots = (_modelId: string, durationSec: number) => durationSec <= 3 ? 1 : durationSec <= 7 ? 3 : 4;

/** 기본 모델 ID — shot-splitting 정책에서 최소 샷 수 조회용 */
const DEFAULT_MODEL_ID = VEO_DEFAULT_MODEL;

/** shot splitting이 생성할 수 있는 최대 샷 수 (VEO capability 기준) */
export const MAX_SPLIT_SHOTS = 6;

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ShotDescriptor {
  shotId: string;
  startSec: number;
  endSec: number;
  camera: {
    framing: string;
    angle: string;
    motion: string;
  };
  subject: string;
  action: string;
  environment: string;
  moodLighting: string;
  focus: string;        // temporal beat focus
  /** Style directive propagated from style preset selection */
  styleSuffix?: string;
}

export interface ShotProgressionResult {
  hasProgression: boolean;
  segments: string[];           // split segments from action/subject
  progressionType: "arrow" | "temporal" | "narrative" | "camera_implicit" | "none";
  suggestedShotCount: number;
}

export interface SplitResult {
  shots: ShotDescriptor[];
  splitLog: string[];
  wasSplit: boolean;
}

/** Beat type hint for shot priority ordering */
export type ShotBeatHint = "hook" | "mechanism" | "consequence" | "payoff" | "paradox" | "default";

// ═══════════════════════════════════════════════════════════════════
// 1. Progression Detection
// ═══════════════════════════════════════════════════════════════════

/** Arrow/sequence markers that indicate multi-event progression */
const ARROW_PATTERN = /\s*(?:→|➡|->)+\s*/;
const TEMPORAL_PATTERN = /\b(?:then|followed\s+by|finally|next|after\s+that|before|subsequently|eventually|leads\s+to|transitioning?\s+to|culminat)\b/i;
const NARRATIVE_PATTERN = /\b(?:establishing|establish|fills?\s+the\s+frame|becomes?\s+dominant|dominat|reveal|revealing|emerges?|appears?|disappears?|transforms?|shifts?\s+to|moves?\s+to|pan\s+to|cut\s+to)\b/i;

/**
 * action/subject 텍스트에서 multi-event progression을 감지.
 *
 * grep: detectShotProgression
 */
export function detectShotProgression(
  action: string,
  subjectPrimary: string,
): ShotProgressionResult {
  const fullText = `${subjectPrimary} ${action}`;

  // Check arrow progression: "A → B → C"
  if (ARROW_PATTERN.test(fullText)) {
    const segments = fullText.split(ARROW_PATTERN).map(s => s.trim()).filter(Boolean);
    if (segments.length >= 2) {
      return {
        hasProgression: true,
        segments,
        progressionType: "arrow",
        suggestedShotCount: Math.min(segments.length, MAX_SPLIT_SHOTS),
      };
    }
  }

  // Check temporal markers: "then / followed by / finally"
  if (TEMPORAL_PATTERN.test(fullText)) {
    const segments = fullText.split(TEMPORAL_PATTERN).map(s => s.trim()).filter(s => s.length > 5);
    if (segments.length >= 2) {
      return {
        hasProgression: true,
        segments,
        progressionType: "temporal",
        suggestedShotCount: Math.min(segments.length, MAX_SPLIT_SHOTS),
      };
    }
  }

  // Check narrative progression: "fills the frame → becomes dominant"
  if (NARRATIVE_PATTERN.test(fullText)) {
    const narrativeMatches = fullText.match(new RegExp(NARRATIVE_PATTERN, "gi"));
    if (narrativeMatches && narrativeMatches.length >= 2) {
      return {
        hasProgression: true,
        segments: [fullText],  // can't cleanly split, but progression exists
        progressionType: "narrative",
        suggestedShotCount: 2,
      };
    }
  }

  return {
    hasProgression: false,
    segments: [fullText],
    progressionType: "none",
    suggestedShotCount: 1,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. Single-Shot Exception Detection
// ═══════════════════════════════════════════════════════════════════

/**
 * 1-shot이 허용되는 특수 예외 판정.
 *
 * grep: isSingleShotException
 */
export function isSingleShotException(
  sceneType: string,
  action: string,
  durationSec: number,
): boolean {
  // Very short insert (≤ 3 seconds)
  if (durationSec <= 3) return true;

  // Truly static tableau — no action, no progression
  const hasAction = action.trim().length > 10;
  const hasProgression = ARROW_PATTERN.test(action) || TEMPORAL_PATTERN.test(action);
  if (!hasAction && !hasProgression) return true;

  // Logo / product spin
  if (/\b(logo|product\s+spin|title\s+card|brand|ident|bumper)\b/i.test(action)) return true;

  // Transition atmosphere (very short bridge)
  if (sceneType === "transition-atmosphere" || sceneType === "transition") return true;

  return false;
}

// ═══════════════════════════════════════════════════════════════════
// 3. Scene-Type Split Templates
// ═══════════════════════════════════════════════════════════════════

interface SplitTemplate {
  shots: Array<{
    role: string;         // "establishing" | "emphasis" | "reveal"
    framingHint: string;  // preferred framing
    motionHint: string;   // preferred camera motion
    focusTemplate: string; // template for focus description
  }>;
}

const SCENE_SPLIT_TEMPLATES: Record<string, SplitTemplate> = {
  environment: {
    shots: [
      { role: "establishing", framingHint: "WS", motionHint: "slow pan", focusTemplate: "wide establishing view of {env} with scale and atmosphere" },
      { role: "emphasis", framingHint: "MS", motionHint: "slow push-in", focusTemplate: "closer emphasis on key environmental detail and situation evidence" },
      { role: "reveal", framingHint: "WS", motionHint: "slow pull-back", focusTemplate: "final vista revealing strongest visual anchor" },
      { role: "detail", framingHint: "CU", motionHint: "static", focusTemplate: "tight detail on environmental texture or element" },
      { role: "transition", framingHint: "MS", motionHint: "slow tilt", focusTemplate: "transitional perspective shift within environment" },
      { role: "payoff", framingHint: "WS", motionHint: "slow crane up", focusTemplate: "grand payoff vista with full environmental scale" },
    ],
  },
  "character-driven": {
    shots: [
      { role: "establishing", framingHint: "WS", motionHint: "slow pan", focusTemplate: "wide establishing view — character in full environment" },
      { role: "emphasis", framingHint: "CU", motionHint: "slow push-in", focusTemplate: "close-up emotional beat — face, hands, or key gesture" },
      { role: "reveal", framingHint: "MS", motionHint: "tracking", focusTemplate: "medium shot — character action in spatial context" },
      { role: "detail", framingHint: "ECU", motionHint: "static", focusTemplate: "extreme close-up on eyes, texture, or critical detail" },
      { role: "context", framingHint: "WS", motionHint: "slow crane up", focusTemplate: "wide pullback — character in broader environment" },
      { role: "payoff", framingHint: "MCU", motionHint: "subtle push-in", focusTemplate: "medium close-up — final emotional resolution" },
    ],
  },
  crowd: {
    shots: [
      { role: "establishing", framingHint: "WS", motionHint: "slow crane", focusTemplate: "wide crowd establish with scale" },
      { role: "emphasis", framingHint: "MS", motionHint: "tracking", focusTemplate: "crowd movement pattern and energy" },
      { role: "reveal", framingHint: "MCU", motionHint: "handheld", focusTemplate: "individual faces and reactions within crowd" },
      { role: "detail", framingHint: "CU", motionHint: "static", focusTemplate: "close-up detail on crowd element or artifact" },
      { role: "context", framingHint: "MS", motionHint: "pan", focusTemplate: "lateral sweep across crowd diversity" },
      { role: "payoff", framingHint: "WS", motionHint: "crane up", focusTemplate: "aerial payoff revealing full crowd scale" },
    ],
  },
  "map-graphic": {
    shots: [
      { role: "establishing", framingHint: "WS", motionHint: "static", focusTemplate: "full map surface establish" },
      { role: "emphasis", framingHint: "MS", motionHint: "slow push-in", focusTemplate: "regional emphasis and color spread" },
      { role: "reveal", framingHint: "CU", motionHint: "slow push-in", focusTemplate: "detailed region focus with data overlay" },
      { role: "detail", framingHint: "ECU", motionHint: "static", focusTemplate: "extreme close-up on critical data point" },
      { role: "transition", framingHint: "MS", motionHint: "slow pan", focusTemplate: "pan across regions showing comparison" },
      { role: "payoff", framingHint: "WS", motionHint: "slow pull-back", focusTemplate: "final pull-back revealing complete picture" },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════
// 4. Shot Splitting
// ═══════════════════════════════════════════════════════════════════

/**
 * Segment scope classification for beat-type-aware shot ordering.
 *
 * Hook sequences need macro-first ordering (wide premise clarity).
 * Mechanism/consequence sequences can lead with detail/inserts.
 */
type SegmentScope = "macro" | "detail" | "symbolic";

const MACRO_INDICATORS = /\b(wide|aerial|landscape|city|era|century|plague|collapse|war|revolution|society|world|civilization|panoram|overhead|skyline|horizon|establish|medieval|ancient|modern|empire|mass|crowd|army|population|death\s*toll|street|village|town|market|square|stage|garage|workshop|factory|office|room|building|hall|field|valley|mountain|ocean|harbor|bridge|gate|arena|young\s+man|young\s+woman|man\s+in|woman\s+in|figure\s+in|person\s+in|people\s+in|standing\s+in|walking\s+through)\b/i;
const DETAIL_INDICATORS = /\b(close-?up|close\s+shot|close\s+view|finger|hand|palm|coin|drop|eye|tear|detail|object|texture|grain|ripple|single\s+|tiny|small|tip\b|needle|thread|button|surface|circuit\s*board|component|wire|solder)\b/i;

function classifySegmentScope(segment: string): SegmentScope {
  const hasMacro = MACRO_INDICATORS.test(segment);
  const hasDetail = DETAIL_INDICATORS.test(segment);
  if (hasMacro && !hasDetail) return "macro";
  if (hasDetail && !hasMacro) return "detail";
  if (hasMacro && hasDetail) {
    // Both present → count matches to determine dominance
    const macroCount = (segment.match(new RegExp(MACRO_INDICATORS.source, "gi")) || []).length;
    const detailCount = (segment.match(new RegExp(DETAIL_INDICATORS.source, "gi")) || []).length;
    return macroCount > detailCount ? "macro" : "detail";
  }
  return segment.length > 40 ? "macro" : "symbolic";
}

/**
 * Reorder progression segments based on beat type priority.
 *
 * Hook: macro segments first, detail/symbolic demoted to later positions.
 * Mechanism/consequence: detail segments can lead.
 * Default: preserve original order.
 */
function reorderSegmentsForBeatType(
  segments: string[],
  beatHint: ShotBeatHint,
): { segments: string[]; reordered: boolean } {
  if (beatHint !== "hook" || segments.length < 2) {
    return { segments, reordered: false };
  }

  // Classify each segment
  const classified = segments.map((s, i) => ({ text: s, scope: classifySegmentScope(s), originalIndex: i }));

  // If first segment is already macro, keep original order
  if (classified[0].scope === "macro") return { segments, reordered: false };

  // Find best macro segment to move to front
  const macroIdx = classified.findIndex(c => c.scope === "macro");
  if (macroIdx > 0) {
    // Move macro segment to first position, keep rest in order
    const reordered = [
      classified[macroIdx].text,
      ...classified.filter((_, i) => i !== macroIdx).map(c => c.text),
    ];
    return { segments: reordered, reordered: true };
  }

  // No macro segment found. For hooks, still avoid detail-first:
  // If first segment is detail and there's a symbolic segment, swap them.
  // A symbolic segment (person in context, general scene) is better for
  // hook opening than a close-up detail insert.
  if (classified[0].scope === "detail") {
    const symbolicIdx = classified.findIndex((c, i) => i > 0 && c.scope === "symbolic");
    if (symbolicIdx > 0) {
      const reordered = [
        classified[symbolicIdx].text,
        ...classified.filter((_, i) => i !== symbolicIdx).map(c => c.text),
      ];
      return { segments: reordered, reordered: true };
    }
  }

  return { segments, reordered: false };
}

/**
 * 단일 shot을 2~6 shots로 분리.
 * progression segments + scene template 기반.
 * VEO 모델 기준 최대 6샷, 실제 분할 수는 progression과 template에 따라 결정.
 *
 * beatHint가 "hook"이면 macro 프레임이 첫 shot에 우선 배치.
 * 이는 hook sequence의 첫 shot이 core premise를 즉시 전달하도록 보장.
 *
 * grep: splitSingleShotSequence
 */
export function splitSingleShotSequence(input: {
  sceneType: string;
  subjectPrimary: string;
  action: string;
  environment: string;
  moodLighting: string;
  durationSec: number;
  camera: { framing: string; angle: string; motion: string };
  beatHint?: ShotBeatHint;
  styleSuffix?: string;
}): SplitResult {
  const progression = detectShotProgression(input.action, input.subjectPrimary);

  // No progression and not a scene type that requires splitting
  // 단, duration 기반 최소 샷 수(9초+: 4샷)가 요구되면 exception 무시
  const durationMinForException = getMinShots(DEFAULT_MODEL_ID, input.durationSec);
  if (!progression.hasProgression && durationMinForException < 2 && isSingleShotException(input.sceneType, input.action, input.durationSec)) {
    return {
      shots: [{
        shotId: "shot_1",
        startSec: 0,
        endSec: input.durationSec,
        camera: input.camera,
        subject: input.subjectPrimary,
        action: input.action,
        environment: input.environment,
        moodLighting: input.moodLighting,
        focus: `${input.subjectPrimary} — ${input.action}`.slice(0, 120),
        ...(input.styleSuffix ? { styleSuffix: input.styleSuffix } : {}),
      }],
      splitLog: [],
      wasSplit: false,
    };
  }

  const template = SCENE_SPLIT_TEMPLATES[input.sceneType] || SCENE_SPLIT_TEMPLATES.environment!;
  // duration 기반 최소 샷 수 정책 적용 (8초: 최소 4, 4~7초: 최소 3)
  const durationMinShots = getMinShots(DEFAULT_MODEL_ID, input.durationSec);
  const shotCount = progression.hasProgression
    ? Math.max(Math.min(progression.suggestedShotCount, template.shots.length), durationMinShots)
    : Math.max(durationMinShots, Math.min(durationMinShots || 1, template.shots.length));

  // Reorder segments based on beat type priority
  const beatHint = input.beatHint || "default";
  const { segments: orderedSegments, reordered } = progression.hasProgression
    ? reorderSegmentsForBeatType(progression.segments, beatHint)
    : { segments: progression.segments, reordered: false };

  const timings = rebalanceShotTimings(input.durationSec, shotCount);
  const shots: ShotDescriptor[] = [];
  const splitLog: string[] = [];

  for (let i = 0; i < shotCount; i++) {
    const tmpl = template.shots[i] || template.shots[template.shots.length - 1];
    const timing = timings[i];

    // Assign content from progression segments if available
    let shotAction: string;
    let shotFocus: string;
    if (progression.hasProgression && orderedSegments[i]) {
      shotAction = orderedSegments[i];
      shotFocus = orderedSegments[i];
    } else if (i === 0) {
      shotAction = `establishing view: ${input.subjectPrimary}`;
      shotFocus = tmpl.focusTemplate.replace("{env}", input.environment.slice(0, 60));
    } else if (i === shotCount - 1) {
      shotAction = `concluding emphasis: ${input.action.split(/[→\->]+/).pop()?.trim() || input.action}`;
      shotFocus = tmpl.focusTemplate.replace("{env}", input.environment.slice(0, 60));
    } else {
      shotAction = `development: ${input.action}`;
      shotFocus = tmpl.focusTemplate.replace("{env}", input.environment.slice(0, 60));
    }

    // For hook sequences, ensure first shot framing is wide/establishing
    const isHookFirstShot = i === 0 && beatHint === "hook";
    const framing = isHookFirstShot ? "WS"
      : i === 0 ? input.camera.framing
      : tmpl.framingHint;

    // 프레이밍별 시각 레이어 차별화 — WS는 환경, CU/ECU는 피사체만
    const isWide = /^(WS|LS|EWS)$/i.test(framing);
    const isTight = /^(CU|ECU|MCU)$/i.test(framing);
    // wide shot: 환경+공간 강조, subject는 간략
    // tight shot: subject+감정 강조, environment 생략
    const shotSubject = isWide
      ? `${input.subjectPrimary} in ${input.environment}`.slice(0, 120)
      : input.subjectPrimary;
    const shotEnvironment = isTight ? "" : input.environment;
    const shotMood = (i === 0 || isWide) ? input.moodLighting : "";

    shots.push({
      shotId: `shot_${i + 1}`,
      startSec: timing.startSec,
      endSec: timing.endSec,
      camera: {
        framing,
        angle: input.camera.angle,
        motion: isHookFirstShot ? "slow pan" : tmpl.motionHint,
      },
      subject: shotSubject,
      action: shotAction,
      environment: shotEnvironment,
      moodLighting: shotMood,
      focus: shotFocus.slice(0, 150),
      ...(input.styleSuffix ? { styleSuffix: input.styleSuffix } : {}),
    });
  }

  splitLog.push(`[shot-split] Split 1 shot → ${shotCount} shots (${progression.progressionType} progression, ${input.sceneType} template)`);
  if (progression.hasProgression) {
    splitLog.push(`[shot-split] Segments: ${orderedSegments.map((s, i) => `shot_${i + 1}: "${s.slice(0, 50)}"`).join(", ")}`);
  }
  if (reordered) {
    splitLog.push(`[shot-split] Reordered segments for ${beatHint} beat — macro-first priority`);
  }

  // ── Anti-fake-split: merge back adjacent shots with identical visual objectives ──
  // 단, duration 기반 최소 샷 수 아래로는 머지하지 않음
  const mergeMinFloor = getMinShots(DEFAULT_MODEL_ID, input.durationSec);
  const mergeResult = mergeAdjacentFakeSplits(shots);
  let mergedShots = mergeResult.shots;
  const mergeLog = mergeResult.mergeLog;
  splitLog.push(...mergeLog);

  // 머지 결과가 최소 샷 수 미만이면 머지 전 상태로 복원
  if (mergedShots.length < mergeMinFloor && shots.length >= mergeMinFloor) {
    splitLog.push(`[anti-fake-split] Merge would reduce below min ${mergeMinFloor} shots — keeping ${shots.length} shots`);
    mergedShots = shots;
  }

  // If merge collapsed everything back to 1 shot, it wasn't a genuine split
  if (mergedShots.length <= 1 && shots.length > 1) {
    splitLog.push(`[anti-fake-split] All shots merged back — split was not genuine`);
    return { shots: mergedShots, splitLog, wasSplit: false };
  }

  return { shots: mergedShots, splitLog, wasSplit: mergedShots.length >= 2 };
}

// ═══════════════════════════════════════════════════════════════════
// 5. Timing Rebalance
// ═══════════════════════════════════════════════════════════════════

/**
 * shot 수에 따라 시간을 분배.
 *
 * grep: rebalanceShotTimings
 */
export function rebalanceShotTimings(
  totalDurationSec: number,
  shotCount: number,
): Array<{ startSec: number; endSec: number }> {
  if (shotCount <= 1) {
    return [{ startSec: 0, endSec: totalDurationSec }];
  }

  // First shot gets a larger share (establishing), rest equal.
  // 2-3 shots: 40% first, rest equal
  // 4+ shots: 30% first, rest equal (더 많은 샷에서는 첫 샷 비중 감소)
  const result: Array<{ startSec: number; endSec: number }> = [];
  const firstShotRatio = shotCount <= 3 ? 0.4 : 0.3;
  const remainingRatio = (1 - firstShotRatio) / (shotCount - 1);

  let currentSec = 0;
  for (let i = 0; i < shotCount; i++) {
    const ratio = i === 0 ? firstShotRatio : remainingRatio;
    const duration = Math.round(totalDurationSec * ratio * 10) / 10;
    result.push({
      startSec: Math.round(currentSec * 10) / 10,
      endSec: Math.round((currentSec + duration) * 10) / 10,
    });
    currentSec += duration;
  }

  // Fix last shot to match total duration exactly
  if (result.length > 0) {
    result[result.length - 1].endSec = totalDurationSec;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// 6. Minimum Shot Count Enforcement
// ═══════════════════════════════════════════════════════════════════


/**
 * 최소 shot 수를 강제.
 *
 * Arrow/temporal/narrative progression이 감지되면 scene type에 관계없이
 * 무조건 multiShot으로 분할. 이것이 최우선 규칙.
 *
 * Progression이 없는 경우에만 scene type 기반 multi-shot 판단.
 *
 * grep: enforceMinimumShotCount
 */
export function enforceMinimumShotCount(input: {
  sceneType: string;
  subjectPrimary: string;
  action: string;
  environment: string;
  moodLighting: string;
  durationSec: number;
  camera: { framing: string; angle: string; motion: string };
  currentShotCount: number;
  beatHint?: ShotBeatHint;
  styleSuffix?: string;
}): SplitResult | null {
  // Duration 기반 최소 샷 수 — 이미 충족하면 분할 불필요
  const minRequired = getMinShots(DEFAULT_MODEL_ID, input.durationSec);
  if (input.currentShotCount >= Math.max(2, minRequired)) return null;

  // ── TOP PRIORITY: Arrow/progression detection always splits ──
  // If action or subject contains progression markers (→, then, etc.),
  // split regardless of scene type. The source of truth must be multiShot[],
  // not a single shot with internal arrows.
  const progression = detectShotProgression(input.action, input.subjectPrimary);
  if (progression.hasProgression && input.durationSec > 3) {
    return splitSingleShotSequence(input);
  }

  // ── Duration 기반 강제 분할 — scene type 무관 ──
  // 9초 이상은 어떤 scene type이든 최소 4샷 필수
  if (minRequired >= 4 && input.currentShotCount < minRequired) {
    return splitSingleShotSequence(input);
  }

  // ── Scene-type-based multi-shot requirement ──
  if (!MULTI_SHOT_SCENE_TYPES.has(input.sceneType)) return null;

  // Check for valid single-shot exceptions (no progression, very short, etc.)
  if (isSingleShotException(input.sceneType, input.action, input.durationSec)) return null;

  // Force split for multi-shot scene types
  return splitSingleShotSequence(input);
}

// ═══════════════════════════════════════════════════════════════════
// 7. Anti-Fake-Split — merge adjacent shots with identical objectives
// ═══════════════════════════════════════════════════════════════════

/**
 * Detect whether two adjacent shots have substantially identical visual objectives.
 *
 * A "fake split" occurs when:
 * - Two shots share the same subject AND the same visual action/framing
 * - No meaningful visual change between them (same framing, same action core)
 * - Split was triggered by noun count rather than genuine visual progression
 *
 * Returns similarity score 0-1. Score > 0.7 means shots should be merged.
 *
 * grep: computeShotSimilarity, mergeAdjacentFakeSplits
 */
export function computeShotSimilarity(a: ShotDescriptor, b: ShotDescriptor): number {
  let score = 0;
  let factors = 0;

  // Same framing → strong similarity signal
  if (a.camera.framing === b.camera.framing) { score += 0.3; }
  factors += 0.3;

  // Same angle
  if (a.camera.angle === b.camera.angle) { score += 0.1; }
  factors += 0.1;

  // Same motion
  if (a.camera.motion === b.camera.motion) { score += 0.1; }
  factors += 0.1;

  // Subject overlap — core subject words (subject can be string or { primary })
  const aSubj = typeof a.subject === "string" ? a.subject : (a.subject as { primary: string }).primary ?? "";
  const bSubj = typeof b.subject === "string" ? b.subject : (b.subject as { primary: string }).primary ?? "";
  const aSubjectWords = new Set(aSubj.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const bSubjectWords = new Set(bSubj.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const subjectOverlap = [...aSubjectWords].filter(w => bSubjectWords.has(w)).length;
  const subjectUnion = new Set([...aSubjectWords, ...bSubjectWords]).size;
  if (subjectUnion > 0) {
    score += 0.25 * (subjectOverlap / subjectUnion);
  }
  factors += 0.25;

  // Action overlap — core action verbs/nouns
  const aActionWords = new Set(a.action.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const bActionWords = new Set(b.action.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const actionOverlap = [...aActionWords].filter(w => bActionWords.has(w)).length;
  const actionUnion = new Set([...aActionWords, ...bActionWords]).size;
  if (actionUnion > 0) {
    score += 0.25 * (actionOverlap / actionUnion);
  }
  factors += 0.25;

  return factors > 0 ? score / factors : 0;
}

/**
 * Merge adjacent shots when visual objective is substantially identical.
 *
 * This prevents fake splits caused by:
 * - Noun count triggering a split (e.g., "man walks through crowd" → 2 shots with same wide framing)
 * - Template-based splits that produce visually identical shots
 *
 * Returns merged shots + merge log.
 */
export function mergeAdjacentFakeSplits(
  shots: ShotDescriptor[],
  similarityThreshold = 0.7,
): { shots: ShotDescriptor[]; mergeLog: string[] } {
  if (shots.length <= 1) return { shots, mergeLog: [] };

  const result: ShotDescriptor[] = [];
  const mergeLog: string[] = [];
  let current = shots[0];

  for (let i = 1; i < shots.length; i++) {
    const next = shots[i];
    const similarity = computeShotSimilarity(current, next);

    if (similarity >= similarityThreshold) {
      // Merge: extend current shot to cover both time ranges
      mergeLog.push(
        `[anti-fake-split] Merged ${current.shotId}+${next.shotId} (similarity ${(similarity * 100).toFixed(0)}% ≥ ${(similarityThreshold * 100).toFixed(0)}% threshold). ` +
        `Same framing="${current.camera.framing}", subject overlap detected.`,
      );
      current = {
        ...current,
        endSec: next.endSec,
        // Combine actions if they differ
        action: current.action === next.action
          ? current.action
          : `${current.action}; ${next.action}`,
        focus: current.focus,
      };
      // Re-number remaining shots
    } else {
      result.push(current);
      current = next;
    }
  }
  result.push(current);

  // Re-number shot IDs
  result.forEach((s, i) => { s.shotId = `shot_${i + 1}`; });

  return { shots: result, mergeLog };
}

/**
 * Validate that a split produces genuinely different shots.
 * Returns true if the split is valid (shots are distinct).
 */
export function isGenuineSplit(shots: ShotDescriptor[]): boolean {
  if (shots.length <= 1) return true;

  for (let i = 0; i < shots.length - 1; i++) {
    if (computeShotSimilarity(shots[i], shots[i + 1]) >= 0.7) {
      return false; // At least one pair is too similar
    }
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// 8. Sequence Density Validation
// ═══════════════════════════════════════════════════════════════════

export interface SequenceDensityIssue {
  rule: string;
  severity: "error" | "warning";
  message: string;
}

/**
 * Sequence 밀도 검증 — shot count, progression density 등.
 *
 * grep: validateSequenceDensity
 */
export function validateSequenceDensity(input: {
  sceneType: string;
  shotCount: number;
  action: string;
  durationSec: number;
  hasPlaceAnchors: boolean;
  hasEvidence: boolean;
  hasTemporalBeats: boolean;
}): SequenceDensityIssue[] {
  const issues: SequenceDensityIssue[] = [];

  // Minimum shot count
  if (MULTI_SHOT_SCENE_TYPES.has(input.sceneType) && input.shotCount < 2) {
    if (!isSingleShotException(input.sceneType, input.action, input.durationSec)) {
      issues.push({
        rule: "min_shot_count",
        severity: "error",
        message: `${input.sceneType} scene requires minimum 2 shots, got ${input.shotCount}`,
      });
    }
  }

  // Progression in single shot
  if (input.shotCount === 1) {
    const progression = detectShotProgression(input.action, "");
    if (progression.hasProgression) {
      issues.push({
        rule: "single_shot_progression",
        severity: "error",
        message: `Single shot contains ${progression.progressionType} progression (${progression.segments.length} segments) — should be split`,
      });
    }
  }

  // Missing anchors/evidence
  if (!input.hasPlaceAnchors && MULTI_SHOT_SCENE_TYPES.has(input.sceneType)) {
    issues.push({
      rule: "missing_place_anchors",
      severity: "warning",
      message: "No place identity anchors in sequence",
    });
  }
  if (!input.hasEvidence && MULTI_SHOT_SCENE_TYPES.has(input.sceneType)) {
    issues.push({
      rule: "missing_evidence",
      severity: "warning",
      message: "No situation evidence in sequence",
    });
  }

  return issues;
}
