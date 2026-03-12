/**
 * shot-splitting.ts — Multi-shot sequence enforcement
 *
 * 단일 shot summary를 진짜 sequence(2~3 shots)로 분리.
 * "A → B → C" progression을 감지하고 자동으로 shot 분할.
 *
 * grep: detectShotProgression, splitSingleShotSequence,
 *       enforceMinimumShotCount, isSingleShotException,
 *       rebalanceShotTimings, validateSequenceDensity
 */

import type { TemporalBeat } from "@/types";

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
        suggestedShotCount: Math.min(segments.length, 3),
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
        suggestedShotCount: Math.min(segments.length, 3),
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
    ],
  },
  "character-driven": {
    shots: [
      { role: "establishing", framingHint: "MS", motionHint: "steady", focusTemplate: "character introduction in context" },
      { role: "emphasis", framingHint: "MCU", motionHint: "subtle push-in", focusTemplate: "character action and emotional beat" },
    ],
  },
  crowd: {
    shots: [
      { role: "establishing", framingHint: "WS", motionHint: "slow crane", focusTemplate: "wide crowd establish with scale" },
      { role: "emphasis", framingHint: "MS", motionHint: "tracking", focusTemplate: "crowd movement pattern and energy" },
    ],
  },
  "map-graphic": {
    shots: [
      { role: "establishing", framingHint: "WS", motionHint: "static", focusTemplate: "full map surface establish" },
      { role: "emphasis", framingHint: "MS", motionHint: "slow push-in", focusTemplate: "regional emphasis and color spread" },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════
// 4. Shot Splitting
// ═══════════════════════════════════════════════════════════════════

/**
 * 단일 shot을 2~3 shots로 분리.
 * progression segments + scene template 기반.
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

  const timings = rebalanceShotTimings(input.durationSec, shotCount);
  const shots: ShotDescriptor[] = [];
  const splitLog: string[] = [];

  for (let i = 0; i < shotCount; i++) {
    const tmpl = template.shots[i] || template.shots[template.shots.length - 1];
    const timing = timings[i];

    // Assign content from progression segments if available
    let shotAction: string;
    let shotFocus: string;
    if (progression.hasProgression && progression.segments[i]) {
      shotAction = progression.segments[i];
      shotFocus = progression.segments[i];
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

    shots.push({
      shotId: `shot_${i + 1}`,
      startSec: timing.startSec,
      endSec: timing.endSec,
      camera: {
        framing: i === 0 ? input.camera.framing : tmpl.framingHint,
        angle: input.camera.angle,
        motion: tmpl.motionHint,
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
    splitLog.push(`[shot-split] Segments: ${progression.segments.map((s, i) => `shot_${i + 1}: "${s.slice(0, 50)}"`).join(", ")}`);
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

  // Slightly longer first shot (establishing), equal rest
  const result: Array<{ startSec: number; endSec: number }> = [];
  const firstShotRatio = 0.4;
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
 * multi-shot 필요 scene type이면서 exception이 아닌 경우,
 * 1-shot이면 자동 split.
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
}): SplitResult | null {
  // Already has multiple shots
  if (input.currentShotCount >= 2) return null;

  // Check if this scene type needs multiple shots
  if (!MULTI_SHOT_SCENE_TYPES.has(input.sceneType)) return null;

  // Check for valid single-shot exceptions
  if (isSingleShotException(input.sceneType, input.action, input.durationSec)) return null;

  // Force split
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
