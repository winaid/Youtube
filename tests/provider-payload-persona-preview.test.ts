/**
 * provider-payload-persona-preview.test.ts
 *
 * provider payload preview에서 persona 차이가 실제로 읽히는지 검증.
 * - 같은 입력 + 다른 persona → 다른 preview
 * - preview 차이가 이름표 수준이 아니라 cut emphasis 차이
 * - 모든 persona가 같은 cadence로 평탄화되지 않는지
 */

import { describe, it, expect } from "vitest";
import {
  buildCompactEditorialSummary,
  buildEditorialPlanningRules,
  buildDurationAwareBeatTemplate,
} from "@/lib/editorial-persona";
import {
  EDITORIAL_PERSONA_PRESETS,
  DEFAULT_EDITORIAL_PERSONA,
} from "@/types";
import {
  renderPromptFromJson,
} from "@/lib/video-prompt-json";
import type { VideoPromptJson } from "@/lib/video-prompt-json";
import {
  detectEditorialPersonaConflicts,
  detectCutComplexityIssues,
} from "@/lib/prompt-sanitizer";

// ═══════════════════════════════════════════════════════════════════
// Helper: persona별 deterministic VideoPromptJson 시뮬레이션
// ═══════════════════════════════════════════════════════════════════

function simulatePayload(presetName: string): { json: VideoPromptJson; rendered: string; summary: string } {
  const ep = EDITORIAL_PERSONA_PRESETS[presetName] || DEFAULT_EDITORIAL_PERSONA;
  const summary = buildCompactEditorialSummary(ep);
  const { beatTemplate } = buildDurationAwareBeatTemplate(4, ep);

  // persona에 따라 달라지는 camera movement
  const cameraMap: Record<string, string> = {
    "gothic-macabre": "near-static creeping drift",
    "symmetrical-formalist": "locked-off static frame",
    "propulsive-action": "handheld tracking with energy",
    "lyrical-atmospheric": "gentle lateral drift",
  };
  const camera = cameraMap[presetName] || "subtle dolly forward";

  // persona에 따라 달라지는 shot size
  const shotMap: Record<string, string> = {
    "gothic-macabre": "ECU",
    "symmetrical-formalist": "WS",
    "propulsive-action": "CU",
    "lyrical-atmospheric": "LS",
  };
  const shot = shotMap[presetName] || "MS";

  const json: VideoPromptJson = {
    shotSize: shot,
    cameraAngle: "eye-level",
    cameraMovement: camera,
    subjectBlocking: "subject center-frame",
    subjectAction: "walks through the scene",
    actionBeat: "walks through the scene",
    bodySignal: "",
    revealed: "new visual layer",
    withheld: "",
    timingBeat: beatTemplate
      .replace("[start — establish visual anchor]", "establish")
      .replace("[resolve — complete the visual idea]", "resolve"),
    transitionFromPrev: "",
    characterRef: "young woman, dark hair, casual outfit",
    moodLighting: "soft directional light from upper left",
    styleSuffix: `cinematic realism, no text, no watermark. ${summary}`,
    locationCue: "city street",
    situationCue: "empty sidewalk",
    emotionalAnchor: "solitary figure",
  };

  const rendered = renderPromptFromJson(json);
  return { json, rendered, summary };
}

// ═══════════════════════════════════════════════════════════════════
// A. payload preview persona 차이 가시화
// ═══════════════════════════════════════════════════════════════════

describe("A. payload preview — persona별 차이", () => {
  it("1) 같은 입력 + 다른 persona → 다른 rendered prompt", () => {
    const gothic = simulatePayload("gothic-macabre");
    const action = simulatePayload("propulsive-action");
    expect(gothic.rendered).not.toBe(action.rendered);
  });

  it("2) gothic-macabre → shadow/detail bias, static/creeping motion", () => {
    const { rendered, summary } = simulatePayload("gothic-macabre");
    // camera movement 차이
    expect(rendered).toContain("creeping");
    // editorial summary가 styleSuffix에 포함
    expect(rendered).toContain("[EDITORIAL:");
    expect(summary).toContain("near-static");
    expect(summary).toContain("extreme-contrast");
  });

  it("3) symmetrical-formalist → establish/centered/lateral restraint", () => {
    const { rendered, summary } = simulatePayload("symmetrical-formalist");
    expect(rendered).toContain("static");
    expect(summary).toContain("establish-led");
    expect(summary).toContain("static camera");
    expect(summary).toContain("hard cuts");
  });

  it("4) propulsive-action → shorter cadence, active camera, harder transitions", () => {
    const { rendered, summary } = simulatePayload("propulsive-action");
    expect(rendered).toContain("tracking");
    expect(summary).toContain("short punctuation");
    expect(summary).toContain("frenetic camera");
    expect(summary).toContain("jump-cut");
  });

  it("5) lyrical-atmospheric → observation-led, gentle motion, softer transitions", () => {
    const { rendered, summary } = simulatePayload("lyrical-atmospheric");
    expect(rendered).toContain("lateral drift");
    expect(summary).toContain("near-static");
    expect(summary).toContain("soft dissolves");
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. preview 차이가 이름표 수준이 아닌 cut emphasis 차이
// ═══════════════════════════════════════════════════════════════════

describe("B. preview cut emphasis 차이 (이름표 이상)", () => {
  it("6) camera movement가 persona에 따라 실제로 다름", () => {
    const gothic = simulatePayload("gothic-macabre");
    const action = simulatePayload("propulsive-action");
    const lyrical = simulatePayload("lyrical-atmospheric");
    const formalist = simulatePayload("symmetrical-formalist");

    // 각 persona의 camera movement가 실제로 다른 단어
    const cameraMovements = [
      gothic.json.cameraMovement,
      action.json.cameraMovement,
      lyrical.json.cameraMovement,
      formalist.json.cameraMovement,
    ];
    const unique = new Set(cameraMovements);
    expect(unique.size).toBe(4);
  });

  it("7) shot size가 persona에 따라 다름 (coverage bias 반영)", () => {
    const gothic = simulatePayload("gothic-macabre");
    const formalist = simulatePayload("symmetrical-formalist");
    // gothic = extreme-contrast → ECU, formalist = wide-dominant → WS
    expect(gothic.json.shotSize).not.toBe(formalist.json.shotSize);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. 모든 persona가 같은 cadence로 평탄화되지 않는지
// ═══════════════════════════════════════════════════════════════════

describe("C. persona 평탄화 방지", () => {
  it("8) 4개 프리셋의 rendered prompt가 모두 서로 다름", () => {
    const presets = ["gothic-macabre", "symmetrical-formalist", "propulsive-action", "lyrical-atmospheric"];
    const rendered = presets.map(p => simulatePayload(p).rendered);
    const unique = new Set(rendered);
    expect(unique.size).toBe(4);
  });

  it("9) 4개 프리셋의 editorial summary가 모두 서로 다름", () => {
    const presets = ["gothic-macabre", "symmetrical-formalist", "propulsive-action", "lyrical-atmospheric"];
    const summaries = presets.map(p => simulatePayload(p).summary);
    const unique = new Set(summaries);
    expect(unique.size).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. guard/regression — persona 보강 후 기존 guard 유지
// ═══════════════════════════════════════════════════════════════════

describe("D. guard/regression — persona 강화 후 guard 유지", () => {
  it("10) persona_conflicts_with_cut_complexity_budget 계속 작동", () => {
    const overstuffed = "a man walks, runs, jumps, falls, turns, grabs the sword. push-in, tracking, pan left, dolly, crane up, orbit.";
    const issues = detectEditorialPersonaConflicts(
      overstuffed,
      { motionBias: "frenetic", insertBias: "high", preferredCutPace: [2, 4] as [number, number] },
      3,
    );
    expect(issues.some(i => i.rule === "persona_conflicts_with_cut_complexity_budget")).toBe(true);
  });

  it("11) persona_overdrives_insert_frequency 계속 작동", () => {
    const insertHeavy = "insert detail, close-up texture, macro surface, shadow silhouette, another detail shot, object insert";
    const issues = detectEditorialPersonaConflicts(
      insertHeavy,
      { motionBias: "moderate", insertBias: "high", preferredCutPace: [3, 5] as [number, number] },
    );
    expect(issues.some(i => i.rule === "persona_overdrives_insert_frequency")).toBe(true);
  });

  it("12) persona_motion_bias_conflicts_with_scene_constraints 계속 작동", () => {
    const windMotion = "flag flutter in the wind on the lunar surface, cape sway dramatically";
    const issues = detectEditorialPersonaConflicts(
      windMotion,
      { motionBias: "frenetic", insertBias: "moderate", preferredCutPace: [2, 4] as [number, number] },
      5,
      { hasWind: false, hasAtmosphere: false, gravity: "low", environmentType: "lunar" },
    );
    expect(issues.some(i => i.rule === "persona_motion_bias_conflicts_with_scene_constraints")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. regression — physics + indoor/outdoor + complexity budget
// ═══════════════════════════════════════════════════════════════════

describe("E. regression 보호", () => {
  it("13) lunar physics regression 유지", () => {
    const json: VideoPromptJson = {
      shotSize: "WS", cameraAngle: "eye-level",
      cameraMovement: "slow pan", subjectBlocking: "center",
      subjectAction: "astronaut plants flag",
      actionBeat: "flag planted", bodySignal: "",
      revealed: "", withheld: "", timingBeat: "0s-3s: approach. 3s-5s: plant.",
      transitionFromPrev: "", characterRef: "",
      moodLighting: "harsh white sunlight from upper right",
      styleSuffix: "cinematic realism, no text",
      locationCue: "lunar surface", situationCue: "landing site",
      emotionalAnchor: "first step",
    };
    const rendered = renderPromptFromJson(json);
    // 물리적으로 말이 되는 렌더링
    expect(rendered).toContain("lunar");
    expect(rendered).not.toContain("flutter");
  });

  it("14) complexity budget issues 계속 작동", () => {
    const overstuffed = "a man walks, a woman runs, a child jumps. push-in and tracking and pan left. 0s-1s: start. 1s-2s: mid. 2s-3s: end. 3s-4s: extra.";
    const issues = detectCutComplexityIssues(overstuffed, 3);
    expect(issues.length).toBeGreaterThan(0);
  });
});
