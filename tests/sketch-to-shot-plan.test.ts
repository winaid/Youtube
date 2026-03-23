/**
 * sketch-to-shot-plan.test.ts — 스케치 구도 분석 → shotPlan 매핑 테스트
 */

import { describe, it, expect } from "vitest";
import {
  sketchToShotPlan,
  formatShotPlanSummary,
  type SketchAnalysisResult,
} from "@/lib/sketch-to-shot-plan";

// ═══════════════════════════════════════════════════════════════════
// Test Data
// ═══════════════════════════════════════════════════════════════════

const WIDE_SHOT_ANALYSIS: SketchAnalysisResult = {
  framing: "WS",
  angle: "eye-level",
  motionHint: "pan-right",
  subjectPosition: { horizontal: "left-third", vertical: "center" },
  subjectPose: "standing",
  subjectCount: 1,
  backgroundElements: ["building", "tree", "street lamp"],
  depthLayers: {
    foreground: "railing",
    midground: "person standing",
    background: "city skyline",
  },
  compositionSummary: "Wide establishing shot with subject positioned at left third, city backdrop",
  confidence: 0.85,
};

const CLOSEUP_ANALYSIS: SketchAnalysisResult = {
  framing: "CU",
  angle: "low-angle",
  motionHint: "push-in",
  subjectPosition: { horizontal: "center", vertical: "center" },
  subjectPose: "action",
  subjectCount: 1,
  backgroundElements: [],
  depthLayers: {
    foreground: "hands holding object",
    background: "blurred interior",
  },
  compositionSummary: "Close-up from low angle pushing into subject's hands",
  confidence: 0.9,
};

const MULTI_SUBJECT_ANALYSIS: SketchAnalysisResult = {
  framing: "MS",
  angle: "eye-level",
  motionHint: "tracking",
  subjectPosition: { horizontal: "center", vertical: "center" },
  subjectPose: "walking",
  subjectCount: 3,
  backgroundElements: ["corridor", "windows"],
  depthLayers: {
    midground: "three people walking",
    background: "long corridor with windows",
  },
  compositionSummary: "Medium tracking shot following three subjects through corridor",
  confidence: 0.75,
};

const NO_FIGURE_ANALYSIS: SketchAnalysisResult = {
  framing: "WS",
  angle: "high-angle",
  motionHint: "tilt-down",
  subjectPosition: { horizontal: "center", vertical: "top-third" },
  subjectPose: "no-figure",
  subjectCount: 0,
  backgroundElements: ["ocean", "sunset", "waves"],
  depthLayers: {
    foreground: "cliff edge",
    background: "ocean horizon with sunset",
  },
  compositionSummary: "High-angle environment shot looking down at ocean from cliff",
  confidence: 0.8,
};

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("sketchToShotPlan", () => {
  it("maps wide shot analysis to correct camera direction", () => {
    const plan = sketchToShotPlan(WIDE_SHOT_ANALYSIS);
    expect(plan.camera.framing).toBe("WS");
    expect(plan.camera.angle).toBe("eye-level");
    expect(plan.camera.motion).toBe("pan-right");
    expect(plan.cameraDirection).toContain("Wide shot");
    expect(plan.cameraDirection).toContain("eye-level");
    expect(plan.cameraDirection).toContain("pan-right");
  });

  it("maps close-up analysis correctly", () => {
    const plan = sketchToShotPlan(CLOSEUP_ANALYSIS);
    expect(plan.camera.framing).toBe("CU");
    expect(plan.camera.angle).toBe("low-angle");
    expect(plan.camera.motion).toBe("push-in");
    expect(plan.cameraDirection).toContain("Close-up");
  });

  it("includes subject blocking info", () => {
    const plan = sketchToShotPlan(WIDE_SHOT_ANALYSIS);
    expect(plan.subjectBlocking).toContain("left third");
  });

  it("handles multiple subjects", () => {
    const plan = sketchToShotPlan(MULTI_SUBJECT_ANALYSIS);
    expect(plan.subjectBlocking).toContain("3 subjects");
  });

  it("extracts environment hints from background elements", () => {
    const plan = sketchToShotPlan(WIDE_SHOT_ANALYSIS);
    expect(plan.environmentHint).toContain("building");
    expect(plan.environmentHint).toContain("tree");
    expect(plan.environmentHint).toContain("city skyline");
  });

  it("maps pose to action hint", () => {
    const standing = sketchToShotPlan(WIDE_SHOT_ANALYSIS);
    expect(standing.actionHint).toContain("standing");

    const action = sketchToShotPlan(CLOSEUP_ANALYSIS);
    expect(action.actionHint).toContain("action");

    const noFigure = sketchToShotPlan(NO_FIGURE_ANALYSIS);
    expect(noFigure.actionHint).toContain("environment");
  });

  it("preserves confidence score", () => {
    const plan = sketchToShotPlan(WIDE_SHOT_ANALYSIS);
    expect(plan.confidence).toBe(0.85);
  });

  it("omits motion from camera direction when static", () => {
    const staticAnalysis: SketchAnalysisResult = {
      ...WIDE_SHOT_ANALYSIS,
      motionHint: "static",
    };
    const plan = sketchToShotPlan(staticAnalysis);
    expect(plan.cameraDirection).not.toContain("static");
    expect(plan.cameraDirection).toBe("Wide shot, eye-level");
  });
});

describe("formatShotPlanSummary", () => {
  it("produces readable multi-line summary", () => {
    const plan = sketchToShotPlan(WIDE_SHOT_ANALYSIS);
    const summary = formatShotPlanSummary(plan);
    expect(summary).toContain("Wide shot");
    expect(summary).toContain("left third");
    expect(summary).toContain("신뢰도: 85%");
  });

  it("includes all relevant information", () => {
    const plan = sketchToShotPlan(CLOSEUP_ANALYSIS);
    const summary = formatShotPlanSummary(plan);
    expect(summary).toContain("Close-up");
    expect(summary).toContain("action");
    expect(summary).toContain("90%");
  });
});

describe("edge cases", () => {
  it("handles empty background elements", () => {
    const plan = sketchToShotPlan(CLOSEUP_ANALYSIS);
    // Should not crash, environmentHint can be empty-ish
    expect(plan.environmentHint).toBeDefined();
  });

  it("handles missing depth layers", () => {
    const minimal: SketchAnalysisResult = {
      framing: "MS",
      angle: "eye-level",
      motionHint: "static",
      subjectPosition: { horizontal: "center", vertical: "center" },
      subjectPose: "standing",
      subjectCount: 1,
      backgroundElements: [],
      depthLayers: {},
      compositionSummary: "Simple medium shot",
      confidence: 0.5,
    };
    const plan = sketchToShotPlan(minimal);
    expect(plan.camera.framing).toBe("MS");
    expect(plan.environmentHint).toBe("");
  });
});
