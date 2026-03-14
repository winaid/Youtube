/**
 * prompt-sanitizer-physics.test.ts — Physics-aware / Scene-aware sanitizer 테스트
 *
 * 테스트 대상:
 * 1. Physics-aware: 환경-모션 충돌 감지 + auto-fix
 * 2. Structural issues: discrete shot sequence, missing camera bridge, etc.
 * 3. Lunar flag regression: vacuum + no-wind + low-gravity
 * 4. Non-lunar regression: 일반 장면 과적용 방지
 */

import { describe, it, expect } from "vitest";
import {
  runSanitizePipeline,
  detectPhysicsIssues,
  detectStructuralIssues,
  type PhysicsRulesContext,
  type SanitizePipelineInput,
} from "@/lib/prompt-sanitizer";

// ═══════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════

function makeLunarPhysics(): PhysicsRulesContext {
  return {
    hasWind: false,
    hasAtmosphere: false,
    gravity: "low",
    environmentType: "lunar_surface",
    bannedExpressions: ["fluttering in the wind", "breeze", "atmospheric haze"],
  };
}

function makeNormalPhysics(): PhysicsRulesContext {
  return {
    hasWind: true,
    hasAtmosphere: true,
    gravity: "normal",
    environmentType: "outdoor_urban",
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. detectPhysicsIssues — General physics-aware rules
// ═══════════════════════════════════════════════════════════════════

describe("detectPhysicsIssues", () => {
  it("should detect and fix wind-dependent motion in no-wind environment", () => {
    const result = detectPhysicsIssues(
      "A flag fluttering in the wind on the lunar surface",
      makeLunarPhysics(),
    );
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some(i => i.rule === "physics_flag_wind_conflict")).toBe(true);
    expect(result.fixedPrompt).not.toContain("fluttering in the wind");
    expect(result.fixedPrompt).toContain("hanging motionless");
  });

  it("should detect atmospheric effects in vacuum environment", () => {
    const result = detectPhysicsIssues(
      "Atmospheric haze drifts across the terrain. Fog settles in the crater",
      { ...makeLunarPhysics(), bannedExpressions: [] },
    );
    expect(result.issues.some(i => i.rule === "physics_motion_environment_conflict")).toBe(true);
    expect(result.fixedPrompt).not.toContain("haze drifts");
  });

  it("should detect rapid falling in low gravity", () => {
    const result = detectPhysicsIssues(
      "Debris falls quickly to the ground. Objects crash into the surface",
      makeLunarPhysics(),
    );
    const gravityIssues = result.issues.filter(i => i.message.includes("gravity"));
    expect(gravityIssues.length).toBeGreaterThan(0);
    expect(result.fixedPrompt).toContain("settles gradually");
  });

  it("should remove bannedExpressions from physicsRules", () => {
    const result = detectPhysicsIssues(
      "A flag fluttering in the wind, atmospheric haze over the surface",
      makeLunarPhysics(),
    );
    expect(result.fixedPrompt).not.toContain("atmospheric haze");
  });

  it("should not modify prompt when physics rules allow the expression", () => {
    const result = detectPhysicsIssues(
      "A flag fluttering in the wind on a sunny day",
      makeNormalPhysics(),
    );
    expect(result.issues).toHaveLength(0);
    expect(result.fixedPrompt).toContain("fluttering in the wind");
  });

  it("should handle zero gravity", () => {
    const result = detectPhysicsIssues(
      "Objects falls quickly away",
      { ...makeNormalPhysics(), gravity: "zero", hasWind: false, hasAtmosphere: false, environmentType: "space_station" },
    );
    const gravIssues = result.issues.filter(i => i.message.includes("gravity"));
    expect(gravIssues.length).toBeGreaterThan(0);
    expect(result.fixedPrompt).toContain("drifts slowly");
  });

  it("should return empty issues when no physicsRules provided", () => {
    const result = detectPhysicsIssues(
      "A flag fluttering in the wind",
      undefined,
    );
    expect(result.issues).toHaveLength(0);
    expect(result.fixedPrompt).toBe("A flag fluttering in the wind");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. detectStructuralIssues — Scene-aware structural rules
// ═══════════════════════════════════════════════════════════════════

describe("detectStructuralIssues", () => {
  it("should detect discrete shot sequence in single generation", () => {
    const issues = detectStructuralIssues(
      "Wide shot of the landscape, then medium shot of the figure, then close-up of the face. LS establishing, MS approach, CU reveal.",
    );
    expect(issues.some(i => i.rule === "discrete_shot_sequence_in_single_generation")).toBe(true);
  });

  it("should not flag single framing type", () => {
    const issues = detectStructuralIssues(
      "Wide shot of the vast desert landscape, WS showing dunes stretching to the horizon",
    );
    expect(issues.some(i => i.rule === "discrete_shot_sequence_in_single_generation")).toBe(false);
  });

  it("should detect missing continuous camera bridge", () => {
    const issues = detectStructuralIssues(
      "Wide landscape establishing. Cut to medium shot of the figure walking",
    );
    expect(issues.some(i => i.rule === "missing_continuous_camera_bridge")).toBe(true);
  });

  it("should not flag 'cut to' when 'continuous' is present", () => {
    const issues = detectStructuralIssues(
      "Cut to medium but continuous camera move without a cut reveals the subject",
    );
    expect(issues.some(i => i.rule === "missing_continuous_camera_bridge")).toBe(false);
  });

  it("should detect missing location identity in environment scene", () => {
    const issues = detectStructuralIssues(
      "A vast landscape with golden light and atmospheric depth",
      "environment",
    );
    expect(issues.some(i => i.rule === "missing_location_identity_anchor")).toBe(true);
  });

  it("should not flag location identity when anchor objects present", () => {
    const issues = detectStructuralIssues(
      "A vast crater landscape with a flag pole and landing site visible",
      "environment",
    );
    expect(issues.some(i => i.rule === "missing_location_identity_anchor")).toBe(false);
  });

  it("should detect missing natural motion in environment scene", () => {
    const issues = detectStructuralIssues(
      "A static wide shot of a building in the distance",
      "environment",
    );
    expect(issues.some(i => i.rule === "missing_natural_motion_for_environment")).toBe(true);
  });

  it("should not flag natural motion when present", () => {
    const issues = detectStructuralIssues(
      "Dust particles drift slowly across the crater floor",
      "environment",
    );
    expect(issues.some(i => i.rule === "missing_natural_motion_for_environment")).toBe(false);
  });

  it("should detect insufficient temporal beats in long prompts", () => {
    const longPrompt = Array(50).fill("word").join(" ");
    const issues = detectStructuralIssues(longPrompt);
    expect(issues.some(i => i.rule === "insufficient_temporal_beats")).toBe(true);
  });

  it("should not flag temporal beats when present", () => {
    const prompt = "0s-3s: establishing shot. 3s-6s: push in. " + Array(40).fill("word").join(" ");
    const issues = detectStructuralIssues(prompt);
    expect(issues.some(i => i.rule === "insufficient_temporal_beats")).toBe(false);
  });

  it("should detect abstract symbolism over specific visuals", () => {
    const issues = detectStructuralIssues(
      "The scene symbolizing hope and representing freedom, evoking a sense of liberation",
    );
    expect(issues.some(i => i.rule === "abstract_symbolism_over_specific_visuals")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Lunar flag regression — full pipeline
// ═══════════════════════════════════════════════════════════════════

describe("lunar flag regression — full pipeline", () => {
  it("should fix wind/atmosphere conflicts for lunar_surface + flag scene", () => {
    const input: SanitizePipelineInput = {
      prompt: "WS shot, eye-level. A flag fluttering in the wind on the lunar surface. Atmospheric haze fills the crater. Soft breeze ruffles the fabric. 0s-3s: flag unfurls. 3s-6s: settles.",
      negatives: ["blurry", "text overlay"],
      framing: "WS",
      shotCategory: "environment",
      physicsRules: makeLunarPhysics(),
      sceneType: "environment",
    };

    const result = runSanitizePipeline(input);

    // Wind conflict auto-fixed
    expect(result.prompt).not.toContain("fluttering in the wind");
    expect(result.prompt).not.toContain("breeze");

    // Physics issues detected
    expect(result.issues.some(i => i.rule === "physics_flag_wind_conflict")).toBe(true);

    // Temporal beats preserved
    expect(result.prompt).toMatch(/\d+s[-–]\d+s/);
  });

  it("should include no-wind and low-gravity context in serialized prompt", () => {
    // This tests the full pipeline — physics constraints should be visible
    const input: SanitizePipelineInput = {
      prompt: "WS shot of lunar surface. Flag on a support bar, held rigid. Dust settles slowly in low gravity. 0s-4s: camera drifts. 4s-8s: reveals footprints.",
      negatives: [],
      framing: "WS",
      shotCategory: "environment",
      physicsRules: makeLunarPhysics(),
      sceneType: "environment",
    };

    const result = runSanitizePipeline(input);

    // No wind-dependent motion should remain
    expect(result.prompt).not.toMatch(/flutter|blow|wave.*wind|breeze/i);

    // Prompt should still contain the scene content
    expect(result.prompt).toContain("lunar surface");
    expect(result.prompt).toContain("support bar");

    // No errors (prompt already physics-compliant)
    const physicsErrors = result.issues.filter(i => i.severity === "error" && i.rule.startsWith("physics"));
    expect(physicsErrors.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Non-lunar regression — normal scenes
// ═══════════════════════════════════════════════════════════════════

describe("non-lunar regression — normal scenes not over-sanitized", () => {
  it("should preserve wind-based motion in normal outdoor scene", () => {
    const input: SanitizePipelineInput = {
      prompt: "WS shot. A flag fluttering in the wind in front of a city building. Trees sway. Atmospheric haze in the distance.",
      negatives: [],
      framing: "WS",
      shotCategory: "environment",
      physicsRules: makeNormalPhysics(),
      sceneType: "environment",
    };

    const result = runSanitizePipeline(input);
    expect(result.prompt).toContain("fluttering in the wind");
    expect(result.prompt).toContain("sway");
    const physicsIssues = result.issues.filter(i => i.rule.startsWith("physics"));
    expect(physicsIssues).toHaveLength(0);
  });

  it("should not apply physics rules to indoor character scene", () => {
    const input: SanitizePipelineInput = {
      prompt: "MS shot. A woman sitting at a desk, papers falling quickly. Wind blown hair.",
      negatives: [],
      framing: "MS",
      shotCategory: "character-driven",
      // No physics rules
    };

    const result = runSanitizePipeline(input);
    expect(result.prompt).toContain("falling quickly");
    expect(result.prompt).toContain("Wind blown");
    expect(result.issues.filter(i => i.rule.startsWith("physics"))).toHaveLength(0);
  });

  it("should not break existing environment sanitization", () => {
    const input: SanitizePipelineInput = {
      prompt: "WS shot. A vast desert landscape stretching to the horizon. Dust drifts across the sand.",
      negatives: ["watermark", "text overlay"],
      framing: "WS",
      shotCategory: "environment",
    };

    const result = runSanitizePipeline(input);
    // Should still work without physicsRules
    expect(result.prompt).toContain("desert landscape");
    expect(result.prompt).toContain("Dust drifts");
  });
});
