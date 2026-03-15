/**
 * cut-range-persona-interaction.test.ts
 *
 * 편집 persona와 cut count range의 상호작용 검증:
 * - 각 persona preset이 올바른 bias 방향 생성
 * - persona bias가 범위를 초과하지 않음
 * - 기존 editorial persona 기능 regression 없음
 */

import { describe, it, expect } from "vitest";
import {
  resolveCutCount,
  personaCutCountBias,
  recommendCutCountRange,
  recommendMinimumCutCount,
} from "@/lib/sequence-density";
import {
  EDITORIAL_PERSONA_PRESETS,
  DEFAULT_EDITORIAL_PERSONA,
} from "@/types";
import {
  buildCompactEditorialSummary,
  buildEditorialPlanningRules,
  extractEditorialPersona,
} from "@/lib/editorial-persona";

// ═══════════════════════════════════════════════════════════════════
// A. persona preset → bias 방향 매핑
// ═══════════════════════════════════════════════════════════════════

describe("A. persona preset → bias direction", () => {
  it("1) propulsive-action → upper bias (더 많은 컷)", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["propulsive-action"];
    const bias = personaCutCountBias(ep);
    expect(bias).toBe("upper");
  });

  it("2) symmetrical-formalist → lower bias (더 적은 컷)", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["symmetrical-formalist"];
    const bias = personaCutCountBias(ep);
    expect(bias).toBe("lower");
  });

  it("3) lyrical-atmospheric → neutral (minimal motion but pace starts at 4, not ≥ 5)", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["lyrical-atmospheric"];
    const bias = personaCutCountBias(ep);
    expect(bias).toBe("neutral");
  });

  it("4) gothic-macabre (minimal motion, pace [3,5]) → neutral 또는 lower", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["gothic-macabre"];
    const bias = personaCutCountBias(ep);
    expect(["neutral", "lower"]).toContain(bias);
  });

  it("5) default persona (moderate) → neutral", () => {
    const bias = personaCutCountBias(DEFAULT_EDITORIAL_PERSONA);
    expect(bias).toBe("neutral");
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. persona bias가 범위를 초과하지 않음
// ═══════════════════════════════════════════════════════════════════

describe("B. persona bias stays within range", () => {
  const range = { min: 3, max: 5 };

  for (const [name, ep] of Object.entries(EDITORIAL_PERSONA_PRESETS)) {
    it(`6-${name}) ${name} bias로 resolve → 범위 [${range.min}, ${range.max}] 내`, () => {
      const bias = personaCutCountBias(ep);
      const result = resolveCutCount({
        preferredRange: range,
        totalDurationSec: 15,
        personaBias: bias,
      });
      expect(result.cutCount).toBeGreaterThanOrEqual(range.min);
      expect(result.cutCount).toBeLessThanOrEqual(range.max);
      expect(result.source).toBe("preferred_range");
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// C. 같은 범위 + 다른 persona → 다른 컷 수
// ═══════════════════════════════════════════════════════════════════

describe("C. same range + different persona → different cut counts", () => {
  it("7) propulsive-action vs symmetrical-formalist → 다른 컷 수", () => {
    const range = { min: 3, max: 7 };
    const actionBias = personaCutCountBias(EDITORIAL_PERSONA_PRESETS["propulsive-action"]);
    const formalistBias = personaCutCountBias(EDITORIAL_PERSONA_PRESETS["symmetrical-formalist"]);

    const actionResult = resolveCutCount({
      preferredRange: range,
      totalDurationSec: 15,
      personaBias: actionBias,
    });
    const formalistResult = resolveCutCount({
      preferredRange: range,
      totalDurationSec: 15,
      personaBias: formalistBias,
    });

    // action은 upper(7), formalist는 lower(3)
    expect(actionResult.cutCount).toBeGreaterThan(formalistResult.cutCount);
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. 15s → 1~2 기본 추천값
// ═══════════════════════════════════════════════════════════════════

describe("D. 15s → 4~6 default recommendation", () => {
  it("8) 15s 기본 추천이 { min: 4, max: 6 }", () => {
    expect(recommendCutCountRange(15)).toEqual({ min: 4, max: 6 });
  });

  it("9) 15s + 기본 persona → 4~6 범위 내 컷 수", () => {
    const range = recommendCutCountRange(15);
    const bias = personaCutCountBias(DEFAULT_EDITORIAL_PERSONA);
    const result = resolveCutCount({
      preferredRange: range,
      totalDurationSec: 15,
      personaBias: bias,
    });
    expect(result.cutCount).toBeGreaterThanOrEqual(4);
    expect(result.cutCount).toBeLessThanOrEqual(6);
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. regression — 기존 editorial persona 기능 유지
// ═══════════════════════════════════════════════════════════════════

describe("E. editorial persona regression check", () => {
  it("10) 4개 프리셋의 editorial summary가 여전히 서로 다름", () => {
    const summaries = Object.values(EDITORIAL_PERSONA_PRESETS).map(
      ep => buildCompactEditorialSummary(ep),
    );
    const unique = new Set(summaries);
    expect(unique.size).toBe(4);
  });

  it("11) 4개 프리셋의 verbose rules가 여전히 서로 다름", () => {
    const rules = Object.values(EDITORIAL_PERSONA_PRESETS).map(
      ep => buildEditorialPlanningRules(ep),
    );
    const unique = new Set(rules);
    expect(unique.size).toBe(4);
  });

  it("12) extractEditorialPersona가 여전히 정상 작동", () => {
    const ep = extractEditorialPersona("gothic macabre dark whimsy");
    expect(ep.preferredCoverage).toBe("extreme-contrast");
    expect(ep.motionBias).toBe("minimal");
  });

  it("13) density policy = 3-layer sequence model (≤15s: 1 sequence, >15s: ceil(total/15))", () => {
    expect(recommendMinimumCutCount(15)).toBe(1);
    expect(recommendMinimumCutCount(12)).toBe(1);
    expect(recommendMinimumCutCount(9)).toBe(1);
    expect(recommendMinimumCutCount(7)).toBe(1);
    expect(recommendMinimumCutCount(4)).toBe(1);
  });
});
