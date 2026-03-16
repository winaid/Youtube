/**
 * shot-splitting-normalization.test.ts — Arrow progression auto-split & hook priority
 *
 * Tests:
 *   1. Arrow progressions must auto-split into multiShot[], not stay as single shot
 *   2. Hook sequences prioritize macro-first shot ordering
 *   3. enforceMinimumShotCount splits arrow progressions regardless of scene type
 *   4. Validation detects AND fixes single-shot progressions
 */

import { describe, it, expect } from "vitest";
import {
  detectShotProgression,
  splitSingleShotSequence,
  enforceMinimumShotCount,
  validateSequenceDensity,
} from "@/lib/shot-splitting";

// ═══════════════════════════════════════════════════════════════════
// Test Data
// ═══════════════════════════════════════════════════════════════════

const ARROW_ACTION_3_SEGMENTS = "dark muddy ground → single silver coin in palm → trembling dirty fingers gripping coin";
const ARROW_ACTION_2_SEGMENTS = "medieval village → plague-stricken streets";
const TEMPORAL_ACTION = "establishing wide cityscape then revealing the devastation below";

const BASE_INPUT = {
  subjectPrimary: "medieval scene",
  environment: "14th century European village",
  moodLighting: "high contrast, dramatic shadows",
  durationSec: 7,
  camera: { framing: "MS", angle: "eye-level", motion: "steady" },
};

// ═══════════════════════════════════════════════════════════════════
// 1. Arrow Progression Detection
// ═══════════════════════════════════════════════════════════════════

describe("detectShotProgression", () => {
  it("detects arrow progression with 3 segments", () => {
    const result = detectShotProgression(ARROW_ACTION_3_SEGMENTS, "");
    expect(result.hasProgression).toBe(true);
    expect(result.progressionType).toBe("arrow");
    expect(result.segments.length).toBe(3);
    expect(result.suggestedShotCount).toBe(3);
  });

  it("detects arrow progression with 2 segments", () => {
    const result = detectShotProgression(ARROW_ACTION_2_SEGMENTS, "");
    expect(result.hasProgression).toBe(true);
    expect(result.segments.length).toBe(2);
  });

  it("detects temporal progression", () => {
    const result = detectShotProgression(TEMPORAL_ACTION, "");
    expect(result.hasProgression).toBe(true);
    expect(result.progressionType).toBe("temporal");
  });

  it("no progression for simple action", () => {
    const result = detectShotProgression("medieval village at dusk", "");
    expect(result.hasProgression).toBe(false);
    expect(result.progressionType).toBe("none");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Arrow Auto-Split (MUST produce multiShot, not single shot)
// ═══════════════════════════════════════════════════════════════════

describe("arrow progression auto-split", () => {
  it("3-segment arrow produces 3 shots in final output", () => {
    const result = splitSingleShotSequence({
      ...BASE_INPUT,
      sceneType: "character-driven",
      action: ARROW_ACTION_3_SEGMENTS,
    });

    expect(result.wasSplit).toBe(true);
    expect(result.shots.length).toBe(3);
    // Each shot has distinct action (not the full arrow string)
    for (const shot of result.shots) {
      expect(shot.action).not.toContain("→");
    }
  });

  it("2-segment arrow produces 2 shots", () => {
    const result = splitSingleShotSequence({
      ...BASE_INPUT,
      sceneType: "environment",
      action: ARROW_ACTION_2_SEGMENTS,
    });

    expect(result.wasSplit).toBe(true);
    expect(result.shots.length).toBe(2);
  });

  it("each split shot has valid timing", () => {
    const result = splitSingleShotSequence({
      ...BASE_INPUT,
      sceneType: "environment",
      action: ARROW_ACTION_3_SEGMENTS,
    });

    for (const shot of result.shots) {
      expect(shot.startSec).toBeGreaterThanOrEqual(0);
      expect(shot.endSec).toBeGreaterThan(shot.startSec);
    }
    // Last shot ends at total duration
    expect(result.shots[result.shots.length - 1].endSec).toBe(BASE_INPUT.durationSec);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. enforceMinimumShotCount — Arrow Split Regardless of Scene Type
// ═══════════════════════════════════════════════════════════════════

describe("enforceMinimumShotCount with arrow progression", () => {
  it("splits arrow progression even for unknown scene type", () => {
    const result = enforceMinimumShotCount({
      ...BASE_INPUT,
      sceneType: "unknown",
      action: ARROW_ACTION_3_SEGMENTS,
      currentShotCount: 1,
    });

    expect(result).not.toBeNull();
    expect(result!.wasSplit).toBe(true);
    expect(result!.shots.length).toBe(3);
  });

  it("splits arrow progression for non-MULTI_SHOT_SCENE_TYPES", () => {
    const result = enforceMinimumShotCount({
      ...BASE_INPUT,
      sceneType: "transition-atmosphere",
      action: ARROW_ACTION_3_SEGMENTS,
      currentShotCount: 1,
    });

    // Arrow progressions bypass scene type filter
    expect(result).not.toBeNull();
    expect(result!.shots.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT split if already has 2+ shots", () => {
    const result = enforceMinimumShotCount({
      ...BASE_INPUT,
      sceneType: "environment",
      action: ARROW_ACTION_3_SEGMENTS,
      currentShotCount: 2,
    });

    expect(result).toBeNull();
  });

  it("does NOT split arrow progression if duration <= 3s", () => {
    const result = enforceMinimumShotCount({
      ...BASE_INPUT,
      durationSec: 3,
      sceneType: "unknown",
      action: ARROW_ACTION_2_SEGMENTS,
      currentShotCount: 1,
    });

    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Hook Sequence Shot Priority
// ═══════════════════════════════════════════════════════════════════

describe("hook sequence shot priority", () => {
  it("hook beat reorders macro segment to first position", () => {
    // "detail → detail → macro" should become "macro → detail → detail"
    const arrowWithMacroLast = "single silver coin in palm → trembling dirty fingers → wide medieval plague devastation landscape";
    const result = splitSingleShotSequence({
      ...BASE_INPUT,
      sceneType: "environment",
      action: arrowWithMacroLast,
      beatHint: "hook",
    });

    expect(result.wasSplit).toBe(true);
    expect(result.shots.length).toBe(3);
    // First shot should be the macro segment (landscape/wide/plague)
    expect(result.shots[0].action).toMatch(/landscape|plague|devastation|wide/i);
  });

  it("hook beat uses WS framing for first shot", () => {
    const result = splitSingleShotSequence({
      ...BASE_INPUT,
      sceneType: "character-driven",
      action: ARROW_ACTION_3_SEGMENTS,
      beatHint: "hook",
    });

    expect(result.shots[0].camera.framing).toBe("WS");
  });

  it("non-hook beat preserves original segment order", () => {
    const result = splitSingleShotSequence({
      ...BASE_INPUT,
      sceneType: "character-driven",
      action: ARROW_ACTION_3_SEGMENTS,
      beatHint: "mechanism",
    });

    // First shot should match first segment (dark muddy ground)
    expect(result.shots[0].action).toMatch(/dark muddy ground/i);
  });

  it("hook with macro-first segment keeps original order", () => {
    const macroFirst = "wide medieval plague devastation → coin detail → hand trembling";
    const result = splitSingleShotSequence({
      ...BASE_INPUT,
      sceneType: "environment",
      action: macroFirst,
      beatHint: "hook",
    });

    // Already macro-first, should keep order
    expect(result.shots[0].action).toMatch(/plague|devastation|wide/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Validation Consistency
// ═══════════════════════════════════════════════════════════════════

describe("validation with auto-split", () => {
  it("after enforceMinimumShotCount, validation sees multiple shots", () => {
    // Simulate: enforce split first
    const splitResult = enforceMinimumShotCount({
      ...BASE_INPUT,
      sceneType: "unknown",
      action: ARROW_ACTION_3_SEGMENTS,
      currentShotCount: 1,
    });

    expect(splitResult).not.toBeNull();

    // Now validate with the split shot count
    const issues = validateSequenceDensity({
      sceneType: "unknown",
      shotCount: splitResult!.shots.length,
      action: ARROW_ACTION_3_SEGMENTS,
      durationSec: BASE_INPUT.durationSec,
      hasPlaceAnchors: true,
      hasEvidence: true,
      hasTemporalBeats: true,
    });

    // No single_shot_progression error should exist (shots > 1 now)
    const progressionIssue = issues.find(i => i.rule === "single_shot_progression");
    expect(progressionIssue).toBeUndefined();
  });
});
