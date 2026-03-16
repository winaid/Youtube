/**
 * shot-splitting-normalization.test.ts — Arrow progression auto-split & hook priority
 *
 * Tests:
 *   1. Arrow progressions must auto-split into multiShot[], not stay as single shot
 *   2. Hook sequences prioritize macro-first shot ordering
 *   3. enforceMinimumShotCount splits arrow progressions regardless of scene type
 *   4. Validation detects AND fixes single-shot progressions
 *   5. Architecture validation cases A-D (end-to-end consistency)
 */

import { describe, it, expect } from "vitest";
import {
  detectShotProgression,
  splitSingleShotSequence,
  enforceMinimumShotCount,
  validateSequenceDensity,
} from "@/lib/shot-splitting";
import { planShotRoles } from "@/lib/multi-shot-planner";
import type { MultiShotPrompt, ShotRole } from "@/types";

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

// ═══════════════════════════════════════════════════════════════════
// ARCHITECTURE VALIDATION CASES A-D
// These verify the 3 critical architectural fixes end-to-end.
// ═══════════════════════════════════════════════════════════════════

describe("Case A — Arrow progression normalization (end-to-end)", () => {
  it("7-second sequence with 3 visual beats produces 3 actual shots (not single shot with arrows)", () => {
    const action = "dark muddy ground → single silver coin in palm → trembling dirty fingers gripping coin";
    const splitResult = enforceMinimumShotCount({
      sceneType: "character-driven",
      subjectPrimary: "medieval scene",
      action,
      environment: "14th century village",
      moodLighting: "dramatic shadows",
      durationSec: 7,
      camera: { framing: "MS", angle: "eye-level", motion: "steady" },
      currentShotCount: 1,
      beatHint: "hook",
    });

    // MUST produce real multi-shot, not null (single-shot)
    expect(splitResult).not.toBeNull();
    expect(splitResult!.wasSplit).toBe(true);
    expect(splitResult!.shots.length).toBe(3);

    // Each shot MUST NOT contain arrow-separated content
    for (const shot of splitResult!.shots) {
      expect(shot.action).not.toContain("→");
      expect(shot.action).not.toContain("->");
    }

    // Shots must have distinct content
    const actions = splitResult!.shots.map(s => s.action);
    const uniqueActions = new Set(actions);
    expect(uniqueActions.size).toBe(3);
  });

  it("split shots can be converted to MultiShotPrompt[] format", () => {
    const action = "dark muddy ground → single silver coin in palm → trembling dirty fingers gripping coin";
    const splitResult = enforceMinimumShotCount({
      sceneType: "character-driven",
      subjectPrimary: "medieval scene",
      action,
      environment: "14th century village",
      moodLighting: "dramatic shadows",
      durationSec: 7,
      camera: { framing: "MS", angle: "eye-level", motion: "steady" },
      currentShotCount: 1,
    });

    expect(splitResult).not.toBeNull();

    // Simulate the bridge: ShotDescriptor[] → MultiShotPrompt[]
    const roles = planShotRoles(splitResult!.shots.length, "character-driven");
    const multiShot: MultiShotPrompt[] = splitResult!.shots.map((shot, i) => {
      const role: ShotRole = roles[i] || "develop";
      const framingLabel = shot.camera.framing === "WS" ? "Wide shot" :
        shot.camera.framing === "CU" ? "Close-up" : `${shot.camera.framing} shot`;
      return {
        index: i + 1,
        prompt: `${framingLabel}. ${shot.action}. ${shot.environment}. ${shot.moodLighting}`.trim(),
        duration: String(Math.round(shot.endSec - shot.startSec)),
        role,
      };
    });

    // MultiShotPrompt[] must have same count as split shots
    expect(multiShot.length).toBe(splitResult!.shots.length);

    // Each prompt must contain the actual content, not arrows
    for (const ms of multiShot) {
      expect(ms.prompt).not.toContain("→");
      expect(ms.prompt.length).toBeGreaterThan(10);
      expect(Number(ms.duration)).toBeGreaterThan(0);
      expect(ms.role).toBeDefined();
    }
  });

  it("validation does NOT just say 'should be split' — normalization actually splits", () => {
    const action = "dark muddy ground → single silver coin in palm → trembling dirty fingers";

    // Step 1: Validation warns about single-shot progression
    const preValidation = validateSequenceDensity({
      sceneType: "character-driven",
      shotCount: 1,
      action,
      durationSec: 7,
      hasPlaceAnchors: true,
      hasEvidence: true,
      hasTemporalBeats: true,
    });
    const hasSingleShotWarning = preValidation.some(i => i.rule === "single_shot_progression");
    expect(hasSingleShotWarning).toBe(true);

    // Step 2: enforceMinimumShotCount ACTUALLY FIXES it (not just warns)
    const splitResult = enforceMinimumShotCount({
      sceneType: "character-driven",
      subjectPrimary: "medieval scene",
      action,
      environment: "14th century village",
      moodLighting: "dramatic shadows",
      durationSec: 7,
      camera: { framing: "MS", angle: "eye-level", motion: "steady" },
      currentShotCount: 1,
    });
    expect(splitResult).not.toBeNull();
    expect(splitResult!.shots.length).toBeGreaterThanOrEqual(2);

    // Step 3: Post-split validation shows NO progression issue
    const postValidation = validateSequenceDensity({
      sceneType: "character-driven",
      shotCount: splitResult!.shots.length,
      action,
      durationSec: 7,
      hasPlaceAnchors: true,
      hasEvidence: true,
      hasTemporalBeats: true,
    });
    const postProgressionIssue = postValidation.find(i => i.rule === "single_shot_progression");
    expect(postProgressionIssue).toBeUndefined();
  });
});

describe("Case B — Hook opening priority", () => {
  it("Black Death hook: first shot is macro/era/collapse, not symbolic coin detail", () => {
    // Simulate: progression with detail-first content (coin, fingers) and macro later (plague/medieval landscape)
    const action = "single silver coin in palm → trembling dirty fingers → wide medieval plague devastation landscape";
    const splitResult = splitSingleShotSequence({
      sceneType: "environment",
      subjectPrimary: "medieval scene",
      action,
      environment: "14th century European village, plague devastation",
      moodLighting: "high contrast, desaturated, dramatic shadows",
      durationSec: 7,
      camera: { framing: "MS", angle: "eye-level", motion: "steady" },
      beatHint: "hook",
    });

    expect(splitResult.wasSplit).toBe(true);
    expect(splitResult.shots.length).toBe(3);

    // First shot MUST be the macro segment (plague/landscape/wide/devastation)
    const firstAction = splitResult.shots[0].action.toLowerCase();
    expect(
      firstAction.includes("plague") ||
      firstAction.includes("landscape") ||
      firstAction.includes("devastation") ||
      firstAction.includes("wide") ||
      firstAction.includes("medieval")
    ).toBe(true);

    // First shot MUST NOT be the coin detail
    expect(firstAction).not.toMatch(/\bcoin\b/);
    expect(firstAction).not.toMatch(/\bfingers\b/);
    expect(firstAction).not.toMatch(/\bpalm\b/);

    // First shot framing MUST be WS (wide shot for macro hook)
    expect(splitResult.shots[0].camera.framing).toBe("WS");
  });

  it("hook metadata actually influences shot ordering, not just exists as metadata", () => {
    const action = "coin in palm → trembling fingers → medieval plague landscape";

    // With hook hint
    const hookResult = splitSingleShotSequence({
      ...BASE_INPUT,
      sceneType: "environment",
      action,
      beatHint: "hook",
    });

    // Without hook hint (default)
    const defaultResult = splitSingleShotSequence({
      ...BASE_INPUT,
      sceneType: "environment",
      action,
      beatHint: "default",
    });

    // Hook version should have different first shot than default
    expect(hookResult.shots[0].action).not.toBe(defaultResult.shots[0].action);

    // Hook version first shot should be macro
    expect(hookResult.shots[0].action.toLowerCase()).toMatch(/plague|landscape|medieval/);
  });

  it("non-hook sequences can lead with detail/symbolic shots", () => {
    const action = "single silver coin → hand trembling → medieval village overview";
    const result = splitSingleShotSequence({
      ...BASE_INPUT,
      sceneType: "character-driven",
      action,
      beatHint: "mechanism",
    });

    // Mechanism beat preserves original order — detail first is OK
    expect(result.shots[0].action.toLowerCase()).toMatch(/coin/);
  });
});

describe("Case C — Editor / preview / submit consistency", () => {
  it("split shots and MultiShotPrompt[] have same structure and count", () => {
    const action = "dark muddy ground → silver coin in palm → trembling dirty fingers gripping coin";
    const splitResult = enforceMinimumShotCount({
      sceneType: "environment",
      subjectPrimary: "medieval scene",
      action,
      environment: "14th century village",
      moodLighting: "dramatic shadows",
      durationSec: 7,
      camera: { framing: "MS", angle: "eye-level", motion: "steady" },
      currentShotCount: 1,
      beatHint: "hook",
    });

    expect(splitResult).not.toBeNull();
    const shotCount = splitResult!.shots.length;

    // Bridge to MultiShotPrompt[] (same logic as sequence-assembler bridge)
    const roles = planShotRoles(shotCount, "environment");
    const multiShot: MultiShotPrompt[] = splitResult!.shots.map((shot, i) => ({
      index: i + 1,
      prompt: `${shot.camera.framing} shot. ${shot.action}. ${shot.environment}. ${shot.moodLighting}`.trim(),
      duration: String(Math.round(shot.endSec - shot.startSec)),
      role: roles[i] || "develop" as ShotRole,
    }));

    // Same count
    expect(multiShot.length).toBe(shotCount);

    // Each MultiShotPrompt has content from the actual split (not generic)
    for (let i = 0; i < shotCount; i++) {
      // The multiShot prompt should contain the split shot's action content
      expect(multiShot[i].prompt).toContain(splitResult!.shots[i].action);
    }

    // Durations sum to total
    const totalDuration = multiShot.reduce((sum, s) => sum + Number(s.duration), 0);
    expect(totalDuration).toBeGreaterThanOrEqual(6); // ~7s with rounding
    expect(totalDuration).toBeLessThanOrEqual(8);
  });

  it("export JSON structure matches submission structure", () => {
    const action = "medieval village → plague-stricken streets → mass graves";
    const splitResult = enforceMinimumShotCount({
      sceneType: "environment",
      subjectPrimary: "medieval scene",
      action,
      environment: "14th century European village",
      moodLighting: "dramatic shadows",
      durationSec: 9,
      camera: { framing: "WS", angle: "eye-level", motion: "slow pan" },
      currentShotCount: 1,
    });

    expect(splitResult).not.toBeNull();

    // Build export format (matches ResultPanel export JSON shape)
    const roles = planShotRoles(splitResult!.shots.length, "environment");
    const exportShots = splitResult!.shots.map((shot, i) => ({
      index: i + 1,
      prompt: `${shot.action}. ${shot.environment}`.trim(),
      duration: String(Math.round(shot.endSec - shot.startSec)),
      role: roles[i] || null,
    }));

    // Build submission format (matches body.multiShot shape)
    const submissionShots = splitResult!.shots.map((shot, i) => ({
      index: i + 1,
      prompt: `${shot.camera.framing} shot. ${shot.action}. ${shot.environment}. ${shot.moodLighting}`.trim(),
      duration: String(Math.round(shot.endSec - shot.startSec)),
      role: roles[i] || "develop",
    }));

    // Both have same count
    expect(exportShots.length).toBe(submissionShots.length);

    // Both have same durations
    for (let i = 0; i < exportShots.length; i++) {
      expect(exportShots[i].duration).toBe(submissionShots[i].duration);
      expect(exportShots[i].index).toBe(submissionShots[i].index);
    }
  });
});

describe("Case D — No fake late conversion", () => {
  it("single-shot without progression stays single-shot (no silent split)", () => {
    const result = enforceMinimumShotCount({
      sceneType: "transition-atmosphere",
      subjectPrimary: "atmospheric mist",
      action: "gentle fog drifting across the valley",
      environment: "mountain valley at dawn",
      moodLighting: "soft, ethereal",
      durationSec: 4,
      camera: { framing: "WS", angle: "eye-level", motion: "static" },
      currentShotCount: 1,
    });

    // No progression detected → stays single shot
    expect(result).toBeNull();
  });

  it("progression detection is explicit and logged", () => {
    const action = "dark ground → coin → fingers";
    const splitResult = splitSingleShotSequence({
      ...BASE_INPUT,
      sceneType: "character-driven",
      action,
    });

    // Split must be logged
    expect(splitResult.splitLog.length).toBeGreaterThan(0);
    expect(splitResult.splitLog.some(log => log.includes("arrow"))).toBe(true);
  });

  it("short durations (<=3s) are never silently split even with progression", () => {
    const result = enforceMinimumShotCount({
      sceneType: "environment",
      subjectPrimary: "medieval scene",
      action: "coin → fingers → hand",
      environment: "village",
      moodLighting: "dark",
      durationSec: 3,
      camera: { framing: "CU", angle: "eye-level", motion: "static" },
      currentShotCount: 1,
    });

    // 3 seconds is too short for multi-shot — stays single
    expect(result).toBeNull();
  });
});
