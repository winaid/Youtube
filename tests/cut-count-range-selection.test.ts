/**
 * cut-count-range-selection.test.ts
 *
 * preferredCutCountRange 기능 핵심 테스트:
 * - recommendCutCountRange 기본 프리셋 동작
 * - densityPresetToRange 프리셋→범위 변환
 * - resolveCutCount 우선순위 (exact > range > density > fallback)
 * - density minimum이 hard floor로 작동
 * - 15s → 1~2 cuts 기본값 (Kling VIDEO 3.0 native 15s)
 */

import { describe, it, expect } from "vitest";
import {
  recommendCutCountRange,
  densityPresetToRange,
  resolveCutCount,
  personaCutCountBias,
  recommendMinimumCutCount,
  CUT_COUNT_MAX,
} from "@/lib/sequence-density";

// server parity
import {
  recommendCutCountRange as serverRecommendRange,
  densityPresetToRange as serverDensityPreset,
  resolveCutCount as serverResolveCutCount,
  personaCutCountBias as serverPersonaBias,
} from "../functions/api/_sequence-density";

// ═══════════════════════════════════════════════════════════════════
// A. recommendCutCountRange — duration → 권장 범위
// ═══════════════════════════════════════════════════════════════════

describe("A. recommendCutCountRange", () => {
  it("1) 15s → { min: 4, max: 6 }", () => {
    const r = recommendCutCountRange(15);
    expect(r).toEqual({ min: 4, max: 6 });
  });

  it("2) 5s → { min: 1, max: 2 }", () => {
    expect(recommendCutCountRange(5)).toEqual({ min: 1, max: 2 });
  });

  it("3) 8s → { min: 2, max: 3 }", () => {
    expect(recommendCutCountRange(8)).toEqual({ min: 2, max: 3 });
  });

  it("4) 12s → { min: 3, max: 4 }", () => {
    expect(recommendCutCountRange(12)).toEqual({ min: 3, max: 4 });
  });

  it("5) 20s → segment-aware (15s segment + 5s remainder)", () => {
    // 15s → {4,6}, 5s → {1,2} → total = {5,8}
    expect(recommendCutCountRange(20)).toEqual({ min: 5, max: 8 });
  });

  it("6) 0 or negative → { min: 1, max: 2 }", () => {
    expect(recommendCutCountRange(0)).toEqual({ min: 1, max: 2 });
    expect(recommendCutCountRange(-5)).toEqual({ min: 1, max: 2 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. densityPresetToRange
// ═══════════════════════════════════════════════════════════════════

describe("B. densityPresetToRange", () => {
  it("7) normal 15s → same as recommendCutCountRange(15)", () => {
    expect(densityPresetToRange("normal", 15)).toEqual(recommendCutCountRange(15));
  });

  it("8) sparse 15s → fewer cuts than normal", () => {
    const sparse = densityPresetToRange("sparse", 15);
    const normal = densityPresetToRange("normal", 15);
    expect(sparse.max).toBeLessThanOrEqual(normal.min);
  });

  it("9) dense 15s → more cuts than normal", () => {
    const dense = densityPresetToRange("dense", 15);
    const normal = densityPresetToRange("normal", 15);
    expect(dense.min).toBeGreaterThanOrEqual(normal.max);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. resolveCutCount — 우선순위 체인
// ═══════════════════════════════════════════════════════════════════

describe("C. resolveCutCount priority chain", () => {
  it("10) exact cutCount가 최우선", () => {
    const result = resolveCutCount({
      exactCutCount: 7,
      preferredRange: { min: 1, max: 2 },
      totalDurationSec: 15,
    });
    expect(result.cutCount).toBe(7);
    expect(result.source).toBe("exact_cutCount");
  });

  it("11) exact cutCount가 없으면 preferredRange 사용", () => {
    const result = resolveCutCount({
      preferredRange: { min: 3, max: 5 },
      totalDurationSec: 15,
      personaBias: "neutral",
    });
    expect(result.cutCount).toBeGreaterThanOrEqual(3);
    expect(result.cutCount).toBeLessThanOrEqual(5);
    expect(result.source).toBe("preferred_range");
  });

  it("12) exact도 range도 없으면 fallback", () => {
    const result = resolveCutCount({
      totalDurationSec: 15,
    });
    expect(result.source).toBe("fallback");
    expect(result.cutCount).toBeGreaterThan(0);
  });

  it("13) exact cutCount ≥ density minimum → exact wins (density min=4 for 15s)", () => {
    const densityMin = recommendMinimumCutCount(15); // = 4
    expect(densityMin).toBe(4);
    const result = resolveCutCount({
      exactCutCount: 5,
      totalDurationSec: 15,
    });
    // With new policy, densityMin=4 for 15s. exactCutCount=5 >= 4, so exact wins.
    expect(result.cutCount).toBe(5);
    expect(result.source).toBe("exact_cutCount");
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. range + density minimum 충돌 해결
// ═══════════════════════════════════════════════════════════════════

describe("D. range vs density minimum conflict", () => {
  it("14) range.min ≥ density minimum (both 4 for 15s) → range used as-is", () => {
    const densityMin = recommendMinimumCutCount(15); // = 4
    expect(densityMin).toBe(4);
    const result = resolveCutCount({
      preferredRange: { min: 4, max: 6 },
      totalDurationSec: 15,
      personaBias: "neutral",
    });
    expect(result.cutCount).toBeGreaterThanOrEqual(densityMin);
  });

  it("15) range.min >= density minimum → range 그대로 사용", () => {
    const result = resolveCutCount({
      preferredRange: { min: 6, max: 8 },
      totalDurationSec: 15,
      personaBias: "neutral",
    });
    expect(result.cutCount).toBeGreaterThanOrEqual(6);
    expect(result.cutCount).toBeLessThanOrEqual(8);
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. persona bias within range
// ═══════════════════════════════════════════════════════════════════

describe("E. persona bias within range", () => {
  it("16) upper bias → max of range", () => {
    const result = resolveCutCount({
      preferredRange: { min: 3, max: 7 },
      totalDurationSec: 8,
      personaBias: "upper",
    });
    expect(result.cutCount).toBe(7);
  });

  it("17) lower bias → min of range", () => {
    const result = resolveCutCount({
      preferredRange: { min: 3, max: 7 },
      totalDurationSec: 8,
      personaBias: "lower",
    });
    expect(result.cutCount).toBe(3);
  });

  it("18) neutral bias → midpoint of range", () => {
    const result = resolveCutCount({
      preferredRange: { min: 3, max: 7 },
      totalDurationSec: 8,
      personaBias: "neutral",
    });
    expect(result.cutCount).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. personaCutCountBias
// ═══════════════════════════════════════════════════════════════════

describe("F. personaCutCountBias", () => {
  it("19) frenetic motion → upper", () => {
    expect(personaCutCountBias({
      motionBias: "frenetic",
      preferredCutPace: [2, 4] as [number, number],
      insertBias: "high",
    })).toBe("upper");
  });

  it("20) static motion → lower", () => {
    expect(personaCutCountBias({
      motionBias: "static",
      preferredCutPace: [4, 6] as [number, number],
      insertBias: "low",
    })).toBe("lower");
  });

  it("21) moderate motion → neutral", () => {
    expect(personaCutCountBias({
      motionBias: "moderate",
      preferredCutPace: [3, 5] as [number, number],
      insertBias: "moderate",
    })).toBe("neutral");
  });
});

// ═══════════════════════════════════════════════════════════════════
// G. server/client parity
// ═══════════════════════════════════════════════════════════════════

describe("G. server/client parity", () => {
  it("22) recommendCutCountRange parity", () => {
    for (const sec of [0, 3, 5, 8, 12, 15, 20]) {
      expect(serverRecommendRange(sec)).toEqual(recommendCutCountRange(sec));
    }
  });

  it("23) densityPresetToRange parity", () => {
    for (const preset of ["sparse", "normal", "dense"] as const) {
      for (const sec of [5, 10, 15]) {
        expect(serverDensityPreset(preset, sec)).toEqual(densityPresetToRange(preset, sec));
      }
    }
  });

  it("24) personaCutCountBias parity", () => {
    const cases = [
      { motionBias: "frenetic", preferredCutPace: [2, 4] as [number, number], insertBias: "high" },
      { motionBias: "static", preferredCutPace: [4, 6] as [number, number], insertBias: "low" },
      { motionBias: "moderate", preferredCutPace: [3, 5] as [number, number], insertBias: "moderate" },
    ];
    for (const c of cases) {
      expect(serverPersonaBias(c)).toBe(personaCutCountBias(c));
    }
  });

  it("25) resolveCutCount parity", () => {
    const opts = {
      exactCutCount: undefined,
      preferredRange: { min: 1, max: 2 },
      totalDurationSec: 15,
      personaBias: "upper" as const,
    };
    expect(serverResolveCutCount(opts)).toEqual(resolveCutCount(opts));
  });
});

// ═══════════════════════════════════════════════════════════════════
// H. clamp to CUT_COUNT_MAX
// ═══════════════════════════════════════════════════════════════════

describe("H. clamp to CUT_COUNT_MAX", () => {
  it("26) exact cutCount > CUT_COUNT_MAX → clamped to CUT_COUNT_MAX", () => {
    const result = resolveCutCount({
      exactCutCount: CUT_COUNT_MAX + 10,
      totalDurationSec: 60,
    });
    expect(result.cutCount).toBeLessThanOrEqual(CUT_COUNT_MAX);
  });

  it("27) range max > CUT_COUNT_MAX → result clamped to CUT_COUNT_MAX", () => {
    const result = resolveCutCount({
      preferredRange: { min: 10, max: CUT_COUNT_MAX + 10 },
      totalDurationSec: 60,
      personaBias: "upper",
    });
    expect(result.cutCount).toBeLessThanOrEqual(CUT_COUNT_MAX);
  });
});
