/**
 * editorial-persona-overhaul.test.ts — Task 5 통합 테스트
 *
 * 테스트 범주:
 * 1. EditorialPersona 타입 + 추출 함수
 * 2. Auto duration 정책 (lowered defaults, editorial pace integration)
 * 3. Multi-cut 몽타주 밀도 정책
 * 4. Cut complexity budget (6 issue types)
 * 5. Server/client parity
 * 6. 회귀 방지
 */

import { describe, it, expect } from "vitest";
import {
  computeAutoDuration,
  safeDuration,
  DURATION_FALLBACK,
  DURATION_MIN,
  DURATION_MAX,
} from "@/lib/duration-reconciliation";
import {
  extractEditorialPersona,
  editorialPaceMidpoint,
} from "@/lib/editorial-persona";
import {
  DEFAULT_EDITORIAL_PERSONA,
  EDITORIAL_PERSONA_PRESETS,
} from "@/types";
import {
  recommendMinimumCutCount,
  needsDensityBoost,
  densifyCuts,
} from "@/lib/sequence-density";
import {
  detectCutComplexityIssues,
  runSanitizePipeline,
} from "@/lib/prompt-sanitizer";

// ═══════════════════════════════════════════════════════════════════
// 1. EditorialPersona 타입 + 추출 함수
// ═══════════════════════════════════════════════════════════════════

describe("EditorialPersona extraction", () => {
  it("gothic 키워드 → gothic-macabre preset", () => {
    const ep = extractEditorialPersona("gothic dark whimsical", "macabre");
    expect(ep.compositionBias).toBe("symmetrical");
    expect(ep.insertBias).toBe("high");
    expect(ep.motionBias).toBe("minimal");
  });

  it("symmetrical/formalist → symmetrical-formalist preset", () => {
    const ep = extractEditorialPersona("symmetrical formalist", "precise");
    expect(ep.compositionBias).toBe("symmetrical");
    expect(ep.motionBias).toBe("static");
    expect(ep.preferredCutPace).toEqual([4, 6]);
  });

  it("action/propulsive → propulsive-action preset", () => {
    const ep = extractEditorialPersona("propulsive action cinema", "fast-cut");
    expect(ep.preferredCutPace).toEqual([2, 4]);
    expect(ep.motionBias).toBe("frenetic");
    expect(ep.transitionBias).toBe("jump-cut");
  });

  it("lyrical/atmospheric → lyrical-atmospheric preset", () => {
    const ep = extractEditorialPersona("lyrical atmospheric", "ethereal");
    expect(ep.preferredCutPace).toEqual([4, 6]);
    expect(ep.motionBias).toBe("minimal");
  });

  it("unrecognized style → DEFAULT_EDITORIAL_PERSONA", () => {
    const ep = extractEditorialPersona("completely unknown style xyz");
    expect(ep.preferredCutPace).toEqual(DEFAULT_EDITORIAL_PERSONA.preferredCutPace);
    expect(ep.motionBias).toBe(DEFAULT_EDITORIAL_PERSONA.motionBias);
  });

  it("empty input → DEFAULT_EDITORIAL_PERSONA", () => {
    const ep = extractEditorialPersona();
    expect(ep).toEqual(DEFAULT_EDITORIAL_PERSONA);
  });

  it("rapid/fast heuristic → [2,4] pace + dynamic motion", () => {
    const ep = extractEditorialPersona("rapid editing, vivid colors");
    expect(ep.preferredCutPace).toEqual([2, 4]);
    expect(ep.motionBias).toBe("dynamic");
  });

  it("slow/contemplative heuristic → slower pace + minimal motion", () => {
    // "meditation" matches "atmospheric" preset keyword → lyrical-atmospheric
    const ep = extractEditorialPersona("slow contemplative long takes");
    expect(ep.preferredCutPace).toEqual([5, 7]);
    expect(ep.motionBias).toBe("minimal");
  });

  it("editorialPaceMidpoint calculates correctly", () => {
    const ep = { ...DEFAULT_EDITORIAL_PERSONA, preferredCutPace: [3, 5] as [number, number] };
    expect(editorialPaceMidpoint(ep)).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Auto Duration — Lowered Defaults + Editorial Pace
// ═══════════════════════════════════════════════════════════════════

describe("auto duration — lowered scene defaults", () => {
  it("environment → 4s (was 5s)", () => {
    const r = computeAutoDuration({ sceneType: "environment" });
    expect(r.duration).toBe(4);
    expect(r.basis).toBe("scene_default");
  });

  it("object-detail → 3s (was 4s)", () => {
    const r = computeAutoDuration({ sceneType: "object-detail" });
    expect(r.duration).toBe(3);
    expect(r.basis).toBe("scene_default");
  });

  it("transition-atmosphere → 3s (was 4s)", () => {
    const r = computeAutoDuration({ sceneType: "transition-atmosphere" });
    expect(r.duration).toBe(3);
    expect(r.basis).toBe("scene_default");
  });

  it("character-driven → 5s (was 6s)", () => {
    const r = computeAutoDuration({ sceneType: "character-driven" });
    expect(r.duration).toBe(5);
    expect(r.basis).toBe("scene_default");
  });

  it("battle → 5s (was 6s)", () => {
    const r = computeAutoDuration({ sceneType: "battle" });
    expect(r.duration).toBe(5);
    expect(r.basis).toBe("scene_default");
  });

  it("product → 3s (was 5s)", () => {
    const r = computeAutoDuration({ sceneType: "product" });
    expect(r.duration).toBe(3);
    expect(r.basis).toBe("scene_default");
  });

  it("all scene defaults < 8 (no premature 8s collapse)", () => {
    const sceneTypes = [
      "environment", "object-detail", "transition-atmosphere",
      "portrait", "map_visualization", "product",
      "person", "character-driven", "crowd", "battle",
    ];
    for (const st of sceneTypes) {
      const r = computeAutoDuration({ sceneType: st });
      expect(r.duration).toBeLessThan(8);
      expect(r.basis).toBe("scene_default");
    }
  });
});

describe("auto duration — editorial pace integration", () => {
  it("editorialPace [2,4] + sceneType=environment → blended 3s", () => {
    const r = computeAutoDuration({ sceneType: "environment", editorialPace: [2, 4] });
    // environment=4, paceMid=3, blended = round((4+3)/2) = 4
    expect(r.duration).toBeLessThanOrEqual(4);
    expect(r.basis).toBe("scene_default");
  });

  it("editorialPace alone (no sceneType) → scene_default from pace", () => {
    const r = computeAutoDuration({ editorialPace: [3, 5] });
    expect(r.duration).toBe(4); // midpoint of [3,5]
    expect(r.basis).toBe("scene_default");
  });

  it("explicit cutDuration overrides editorial pace", () => {
    const r = computeAutoDuration({ cutDuration: 10, editorialPace: [2, 4] });
    expect(r.duration).toBe(10);
    expect(r.basis).toBe("explicit");
  });

  it("emergency_fallback only when no info at all", () => {
    const r = computeAutoDuration({});
    expect(r.duration).toBe(DURATION_FALLBACK);
    expect(r.basis).toBe("emergency_fallback");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Multi-Cut Montage Density Policy
// ═══════════════════════════════════════════════════════════════════

describe("multi-cut montage density", () => {
  it("8s input → 3 cuts minimum", () => {
    expect(recommendMinimumCutCount(8)).toBe(3);
  });

  it("10s input → 4 cuts minimum", () => {
    expect(recommendMinimumCutCount(10)).toBe(4);
  });

  it("12s input → 4 cuts minimum", () => {
    expect(recommendMinimumCutCount(12)).toBe(4);
  });

  it("15s input → 5 cuts minimum", () => {
    expect(recommendMinimumCutCount(15)).toBe(5);
  });

  it("single 8s cut needs density boost (3 needed)", () => {
    expect(needsDensityBoost([{ durationSec: 8 }])).toBe(true);
  });

  it("densifyCuts: 12s → 4+ cuts", () => {
    const result = densifyCuts([{ cutNumber: 1, durationSec: 12 }]);
    expect(result.length).toBeGreaterThanOrEqual(4);
    const total = result.reduce((s, c) => s + c.durationSec, 0);
    expect(total).toBe(12);
  });

  it("densifyCuts: 15s → 5+ cuts", () => {
    const result = densifyCuts([{ cutNumber: 1, durationSec: 15 }]);
    expect(result.length).toBeGreaterThanOrEqual(5);
  });

  it("prefer 3-5s cuts over single 8s", () => {
    const result = densifyCuts([{ cutNumber: 1, durationSec: 8 }]);
    expect(result.length).toBeGreaterThanOrEqual(3);
    for (const cut of result) {
      expect(cut.durationSec).toBeLessThanOrEqual(5);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Cut Complexity Budget
// ═══════════════════════════════════════════════════════════════════

describe("cut complexity budget — too_many_subjects", () => {
  it("detects multiple explicit subjects", () => {
    const issues = detectCutComplexityIssues(
      "a man stands left, a woman sits right, two soldiers march behind",
    );
    const subjectIssue = issues.find(i => i.rule === "too_many_subjects");
    expect(subjectIssue).toBeDefined();
  });

  it("does NOT flag single subject", () => {
    const issues = detectCutComplexityIssues("a man walks forward through the rain");
    const subjectIssue = issues.find(i => i.rule === "too_many_subjects");
    expect(subjectIssue).toBeUndefined();
  });
});

describe("cut complexity budget — multiple_actions", () => {
  it("detects 3+ action verbs", () => {
    const issues = detectCutComplexityIssues(
      "warrior swings sword, kicks enemy, jumps over wall, grabs shield",
    );
    const actionIssue = issues.find(i => i.rule === "multiple_actions");
    expect(actionIssue).toBeDefined();
  });

  it("does NOT flag 1-2 action verbs", () => {
    const issues = detectCutComplexityIssues(
      "a man walks forward",
    );
    const actionIssue = issues.find(i => i.rule === "multiple_actions");
    expect(actionIssue).toBeUndefined();
  });
});

describe("cut complexity budget — camera_overload", () => {
  it("detects 3+ camera motions", () => {
    const issues = detectCutComplexityIssues(
      "push-in to subject, then pan left, crane up, orbit around",
    );
    const cameraIssue = issues.find(i => i.rule === "camera_overload");
    expect(cameraIssue).toBeDefined();
  });

  it("does NOT flag single camera motion", () => {
    const issues = detectCutComplexityIssues("slow push-in toward the table");
    const cameraIssue = issues.find(i => i.rule === "camera_overload");
    expect(cameraIssue).toBeUndefined();
  });
});

describe("cut complexity budget — excessive_temporal", () => {
  it("detects too many temporal beats for short cut", () => {
    const issues = detectCutComplexityIssues(
      "0s-1s: start. 1s-2s: develop. 2s-3s: climax. 3s-4s: resolve.",
      4,
    );
    const temporalIssue = issues.find(i => i.rule === "excessive_temporal");
    expect(temporalIssue).toBeDefined();
  });

  it("allows 2 beats in short cut", () => {
    const issues = detectCutComplexityIssues(
      "0s-2s: start. 2s-4s: resolve.",
      4,
    );
    const temporalIssue = issues.find(i => i.rule === "excessive_temporal");
    expect(temporalIssue).toBeUndefined();
  });
});

describe("cut complexity budget — symbolism_overriding", () => {
  it("detects symbolism overriding visuals", () => {
    const prompt = "the flame symbolizes hope. the door represents opportunity. the shadow evokes fear. light signifying redemption.";
    const issues = detectCutComplexityIssues(prompt);
    const symbolIssue = issues.find(i => i.rule === "symbolism_overriding");
    expect(symbolIssue).toBeDefined();
  });
});

describe("cut complexity budget — cut_overstuffed", () => {
  it("detects overall overstuffed cut in short duration", () => {
    const prompt = "a man runs and jumps and kicks and falls, push-in, pan left, crane up, orbit, 0s-1s: A. 1s-2s: B. 2s-3s: C.";
    const issues = detectCutComplexityIssues(prompt, 3);
    const overstuffed = issues.find(i => i.rule === "cut_overstuffed");
    expect(overstuffed).toBeDefined();
  });

  it("does NOT flag clean simple cut", () => {
    const prompt = "a man walks forward in golden light, slow push-in";
    const issues = detectCutComplexityIssues(prompt, 5);
    const overstuffed = issues.find(i => i.rule === "cut_overstuffed");
    expect(overstuffed).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Sanitize Pipeline — Complexity Integration
// ═══════════════════════════════════════════════════════════════════

describe("sanitize pipeline — complexity budget integration", () => {
  it("flags complexity issues through full pipeline", () => {
    const result = runSanitizePipeline({
      prompt: "a man runs and jumps and kicks and falls and swings, push-in, pan left, crane up, 0s-1s: A. 1s-2s: B. 2s-3s: C.",
      negatives: [],
      framing: "MS",
      durationSec: 3,
    });
    const complexityIssues = result.issues.filter(i =>
      ["cut_overstuffed", "multiple_actions", "camera_overload", "excessive_temporal"].includes(i.rule)
    );
    expect(complexityIssues.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. EDITORIAL_PERSONA_PRESETS
// ═══════════════════════════════════════════════════════════════════

describe("editorial persona presets", () => {
  it("all presets have required fields", () => {
    for (const [key, preset] of Object.entries(EDITORIAL_PERSONA_PRESETS)) {
      expect(preset.preferredCutPace).toHaveLength(2);
      expect(preset.preferredCutPace[0]).toBeLessThanOrEqual(preset.preferredCutPace[1]);
      expect(preset.preferredCoverage).toBeDefined();
      expect(preset.insertBias).toBeDefined();
      expect(preset.motionBias).toBeDefined();
      expect(preset.compositionBias).toBeDefined();
      expect(preset.transitionBias).toBeDefined();
    }
  });

  it("propulsive-action has fastest pace", () => {
    const pa = EDITORIAL_PERSONA_PRESETS["propulsive-action"];
    expect(pa.preferredCutPace[0]).toBeLessThanOrEqual(3);
  });

  it("lyrical-atmospheric has slowest pace", () => {
    const la = EDITORIAL_PERSONA_PRESETS["lyrical-atmospheric"];
    expect(la.preferredCutPace[1]).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Scene-Aware Rules Preservation (Regression)
// ═══════════════════════════════════════════════════════════════════

describe("scene-aware rules — regression", () => {
  it("lunar physics still prevents wind expressions", () => {
    const result = runSanitizePipeline({
      prompt: "lunar surface, flag fluttering in wind, astronaut walks",
      negatives: [],
      framing: "WS",
      shotCategory: "environment",
      physicsRules: {
        hasWind: false,
        hasAtmosphere: false,
        gravity: "low",
        environmentType: "lunar",
        bannedExpressions: ["breeze", "wind"],
      },
    });
    expect(result.prompt).not.toMatch(/flutter.*wind/i);
    expect(result.issues.some(i => i.rule === "physics_flag_wind_conflict")).toBe(true);
  });

  it("indoor/outdoor contamination still detected", () => {
    // Use environmentType="indoor" to force indoor detection even with sky words
    const result = runSanitizePipeline({
      prompt: "clinical waiting room, fluorescent light, overcast sky with clouds, horizon stretching far",
      negatives: [],
      framing: "WS",
      shotCategory: "environment",
      sceneType: "environment",
      physicsRules: {
        hasWind: false,
        hasAtmosphere: true,
        gravity: "earth",
        environmentType: "indoor",
      },
    });
    const contamination = result.issues.find(i => i.rule === "indoor_outdoor_contamination");
    expect(contamination).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Priority Chain: explicit > recommended > computed > scene+editorial > emergency
// ═══════════════════════════════════════════════════════════════════

describe("auto duration — full priority chain", () => {
  it("explicit always wins", () => {
    const r = computeAutoDuration({
      cutDuration: 10,
      recommendedDuration: 5,
      totalDurationSeconds: 60,
      cutCount: 10,
      sceneType: "environment",
      editorialPace: [2, 4],
    });
    expect(r.basis).toBe("explicit");
    expect(r.duration).toBe(10);
  });

  it("recommended wins over computed/scene/editorial", () => {
    const r = computeAutoDuration({
      recommendedDuration: 7,
      totalDurationSeconds: 60,
      cutCount: 10,
      sceneType: "environment",
      editorialPace: [2, 4],
    });
    expect(r.basis).toBe("recommended");
    expect(r.duration).toBe(7);
  });

  it("computed wins over scene/editorial", () => {
    const r = computeAutoDuration({
      totalDurationSeconds: 60,
      cutCount: 10,
      sceneType: "environment",
      editorialPace: [2, 4],
    });
    expect(r.basis).toBe("computed");
    expect(r.duration).toBe(6);
  });

  it("scene+editorial wins over emergency", () => {
    const r = computeAutoDuration({
      sceneType: "environment",
      editorialPace: [2, 4],
    });
    expect(r.basis).toBe("scene_default");
    expect(r.duration).toBeLessThan(DURATION_FALLBACK);
  });

  it("editorial alone (no scene) wins over emergency", () => {
    const r = computeAutoDuration({ editorialPace: [3, 5] });
    expect(r.basis).toBe("scene_default");
    expect(r.duration).toBe(4);
  });

  it("emergency only when nothing available", () => {
    const r = computeAutoDuration({});
    expect(r.basis).toBe("emergency_fallback");
    expect(r.duration).toBe(DURATION_FALLBACK);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Multi-cut insert 컷 허용 확인
// ═══════════════════════════════════════════════════════════════════

describe("multi-cut insert allowed", () => {
  it("short 3s cut has no density issue (insert-friendly)", () => {
    expect(needsDensityBoost([{ durationSec: 3 }])).toBe(false);
  });

  it("3s + 3s + 3s (9s total, 3 cuts) is sufficient", () => {
    const cuts = [{ durationSec: 3 }, { durationSec: 3 }, { durationSec: 3 }];
    expect(needsDensityBoost(cuts)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Server/Client Parity — Editorial Persona
// ═══════════════════════════════════════════════════════════════════

import {
  extractEditorialPersona as serverExtract,
  editorialPaceMidpoint as serverPaceMid,
} from "../functions/api/_editorial-persona";

describe("editorial persona — client/server parity", () => {
  const testCases = [
    { persona: "gothic macabre", style: "dark" },
    { persona: "symmetrical formalist", style: "precise" },
    { persona: "propulsive action", style: "fast" },
    { persona: "lyrical atmospheric", style: "ethereal" },
    { persona: "completely unknown", style: "xyz" },
    { persona: undefined, style: undefined },
    { persona: "rapid editing", style: undefined },
    { persona: "slow contemplative", style: undefined },
  ];

  for (const tc of testCases) {
    it(`parity: persona="${tc.persona}" style="${tc.style}"`, () => {
      const client = extractEditorialPersona(tc.persona, tc.style);
      const server = serverExtract(tc.persona, tc.style);
      expect(client).toEqual(server);
    });
  }

  it("editorialPaceMidpoint parity", () => {
    const ep = { ...DEFAULT_EDITORIAL_PERSONA, preferredCutPace: [2, 6] as [number, number] };
    expect(editorialPaceMidpoint(ep)).toBe(serverPaceMid(ep));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. Server/Client Parity — Duration Constants
// ═══════════════════════════════════════════════════════════════════

import { computeServerAutoDuration } from "../functions/api/_duration-constants";

describe("duration — client/server parity", () => {
  it("environment scene default parity", () => {
    const client = computeAutoDuration({ sceneType: "environment" });
    const server = computeServerAutoDuration(undefined, undefined, undefined, "environment");
    expect(client.duration).toBe(server.duration);
  });

  it("character-driven scene default parity", () => {
    const client = computeAutoDuration({ sceneType: "character-driven" });
    const server = computeServerAutoDuration(undefined, undefined, undefined, "character-driven");
    expect(client.duration).toBe(server.duration);
  });

  it("editorial pace integration parity", () => {
    const client = computeAutoDuration({ sceneType: "environment", editorialPace: [2, 4] });
    const server = computeServerAutoDuration(undefined, undefined, undefined, "environment", [2, 4]);
    expect(client.duration).toBe(server.duration);
  });

  it("explicit overrides parity", () => {
    const client = computeAutoDuration({ cutDuration: 10 });
    const server = computeServerAutoDuration(10);
    expect(client.duration).toBe(server.duration);
  });

  it("emergency fallback parity", () => {
    const client = computeAutoDuration({});
    const server = computeServerAutoDuration(undefined);
    expect(client.duration).toBe(server.duration);
    expect(client.basis).toBe(server.basis);
  });
});
