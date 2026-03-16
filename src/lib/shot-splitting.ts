/**
 * shot-splitting.ts — Multi-shot sequence enforcement
 *
 * 단일 shot summary를 진짜 sequence(2~6 shots)로 분리.
 * "A → B → C → D → E → F" progression을 감지하고 자동으로 shot 분할.
 * O3 모델 기준 최대 6샷, v3 fallback 시 3샷.
 *
 * grep: detectShotProgression, splitSingleShotSequence,
 *       enforceMinimumShotCount, isSingleShotException,
 *       rebalanceShotTimings, validateSequenceDensity,
 *       MAX_SPLIT_SHOTS
 */

import type { TemporalBeat } from "@/types";

/** shot splitting이 생성할 수 있는 최대 샷 수 (O3 capability 기준) */
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
const TEMPORAL_PATTERN = /\b(then|followed\s+by|finally|next|after\s+that|before|subsequently|eventually|leads\s+to|transitioning?\s+to|culminat)\b/i;
const NARRATIVE_PATTERN = /\b(establishing|establish|fills?\s+the\s+frame|becomes?\s+dominant|dominat|reveal|revealing|emerges?|appears?|disappears?|transforms?|shifts?\s+to|moves?\s+to|pan\s+to|cut\s+to)\b/i;

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
      { role: "establishing", framingHint: "MS", motionHint: "steady", focusTemplate: "character introduction in context" },
      { role: "emphasis", framingHint: "MCU", motionHint: "subtle push-in", focusTemplate: "character action and emotional beat" },
      { role: "reveal", framingHint: "CU", motionHint: "slow push-in", focusTemplate: "close-up emotional reveal and reaction" },
      { role: "detail", framingHint: "ECU", motionHint: "static", focusTemplate: "extreme close-up on expression or gesture detail" },
      { role: "context", framingHint: "MS", motionHint: "tracking", focusTemplate: "character in motion within environment" },
      { role: "payoff", framingHint: "WS", motionHint: "slow pull-back", focusTemplate: "character payoff in wider context" },
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

const MACRO_INDICATORS = /\b(wide|aerial|landscape|city|era|century|plague|collapse|war|revolution|society|world|civilization|panoram|overhead|skyline|horizon|establish|medieval|ancient|modern|empire|mass|crowd|army|population|death\s*toll)\b/i;
const DETAIL_INDICATORS = /\b(close|finger|hand|palm|coin|drop|eye|tear|face|detail|object|texture|grain|ripple|single\s+|tiny|small)\b/i;

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
  if (macroIdx <= 0) {
    // No macro segment found — prefix with establishing context from subject/environment
    return { segments, reordered: false };
  }

  // Move macro segment to first position, keep rest in order
  const reordered = [
    classified[macroIdx].text,
    ...classified.filter((_, i) => i !== macroIdx).map(c => c.text),
  ];

  return { segments: reordered, reordered: true };
}

/**
 * 단일 shot을 2~6 shots로 분리.
 * progression segments + scene template 기반.
 * O3 모델 기준 최대 6샷, 실제 분할 수는 progression과 template에 따라 결정.
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
}): SplitResult {
  const progression = detectShotProgression(input.action, input.subjectPrimary);

  // No progression and not a scene type that requires splitting
  if (!progression.hasProgression && isSingleShotException(input.sceneType, input.action, input.durationSec)) {
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
      }],
      splitLog: [],
      wasSplit: false,
    };
  }

  const template = SCENE_SPLIT_TEMPLATES[input.sceneType] || SCENE_SPLIT_TEMPLATES.environment!;
  const shotCount = progression.hasProgression
    ? Math.min(progression.suggestedShotCount, template.shots.length)
    : Math.min(2, template.shots.length);  // default 2-shot minimum

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

    shots.push({
      shotId: `shot_${i + 1}`,
      startSec: timing.startSec,
      endSec: timing.endSec,
      camera: {
        framing,
        angle: input.camera.angle,
        motion: isHookFirstShot ? "slow pan" : tmpl.motionHint,
      },
      subject: input.subjectPrimary,
      action: shotAction,
      environment: input.environment,
      moodLighting: input.moodLighting,
      focus: shotFocus.slice(0, 150),
    });
  }

  splitLog.push(`[shot-split] Split 1 shot → ${shotCount} shots (${progression.progressionType} progression, ${input.sceneType} template)`);
  if (progression.hasProgression) {
    splitLog.push(`[shot-split] Segments: ${orderedSegments.map((s, i) => `shot_${i + 1}: "${s.slice(0, 50)}"`).join(", ")}`);
  }
  if (reordered) {
    splitLog.push(`[shot-split] Reordered segments for ${beatHint} beat — macro-first priority`);
  }

  return { shots, splitLog, wasSplit: true };
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

const MULTI_SHOT_SCENE_TYPES = new Set([
  "environment", "character-driven", "character", "crowd", "battle",
  "map-graphic", "map_visualization", "cinematic_sequence",
]);

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
}): SplitResult | null {
  // Already has multiple shots
  if (input.currentShotCount >= 2) return null;

  // ── TOP PRIORITY: Arrow/progression detection always splits ──
  // If action or subject contains progression markers (→, then, etc.),
  // split regardless of scene type. The source of truth must be multiShot[],
  // not a single shot with internal arrows.
  const progression = detectShotProgression(input.action, input.subjectPrimary);
  if (progression.hasProgression && input.durationSec > 3) {
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
// 7. Sequence Density Validation
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
