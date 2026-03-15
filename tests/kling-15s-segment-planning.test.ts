/**
 * kling-15s-segment-planning.test.ts
 *
 * Kling 15초 제한이 segment planning에 올바르게 반영되는지 검증.
 * - KLING_SEGMENT_CAP = 15 이 source of truth
 * - 15초 이하: 단일 segment 계산
 * - 15초 초과: segment 분할 후 합산
 * - segment-aware density/range 계산
 */

import { describe, it, expect } from "vitest";
import {
  recommendCutCountRange,
  recommendMinimumCutCount,
  densityPresetToRange,
  resolveCutCount,
  personaCutCountBias,
  KLING_SEGMENT_CAP,
} from "@/lib/sequence-density";

import { EDITORIAL_PERSONA_PRESETS } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// A. KLING_SEGMENT_CAP 기본값
// ═══════════════════════════════════════════════════════════════════

describe("A. KLING_SEGMENT_CAP", () => {
  it("1) KLING_SEGMENT_CAP = 15", () => {
    expect(KLING_SEGMENT_CAP).toBe(15);
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. segment-aware recommendMinimumCutCount
// ═══════════════════════════════════════════════════════════════════

describe("B. segment-aware recommendMinimumCutCount", () => {
  it("2) 15초 = 4 (단일 segment, density policy)", () => {
    expect(recommendMinimumCutCount(15)).toBe(4);
  });

  it("3) 30초 = 8 (2 segments × 4)", () => {
    expect(recommendMinimumCutCount(30)).toBe(8);
  });

  it("4) 120초 = 32 (8 segments × 4)", () => {
    expect(recommendMinimumCutCount(120)).toBe(32);
  });

  it("5) 20초 = 5 (15초 segment(4) + 5초 remainder(1))", () => {
    expect(recommendMinimumCutCount(20)).toBe(5);
  });

  it("6) 25초 = 7 (15초(4) + 10초(3))", () => {
    expect(recommendMinimumCutCount(25)).toBe(7);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. segment-aware recommendCutCountRange
// ═══════════════════════════════════════════════════════════════════

describe("C. segment-aware recommendCutCountRange", () => {
  it("7) 15초 → {4, 6} (단일 segment)", () => {
    expect(recommendCutCountRange(15)).toEqual({ min: 4, max: 6 });
  });

  it("8) 30초 → {8, 12} (2 × {4,6})", () => {
    expect(recommendCutCountRange(30)).toEqual({ min: 8, max: 12 });
  });

  it("9) 120초 → {32, 48} (8 × {4,6})", () => {
    expect(recommendCutCountRange(120)).toEqual({ min: 32, max: 48 });
  });

  it("10) 20초 → {5, 8} (15초{4,6} + 5초{1,2})", () => {
    expect(recommendCutCountRange(20)).toEqual({ min: 5, max: 8 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. density preset with segments
// ═══════════════════════════════════════════════════════════════════

describe("D. density preset segment interaction", () => {
  it("11) dense(120초) → 상단 확장", () => {
    const base = recommendCutCountRange(120); // {32, 48}
    const dense = densityPresetToRange("dense", 120);
    expect(dense.min).toBe(base.max); // 48
    expect(dense.max).toBe(base.max + 2); // 50
  });

  it("12) sparse(120초) → 하단 축소", () => {
    const base = recommendCutCountRange(120); // {32, 48}
    const sparse = densityPresetToRange("sparse", 120);
    expect(sparse.min).toBe(Math.max(1, base.min - 1)); // 31
    expect(sparse.max).toBe(base.min); // 32
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. segment metadata 시뮬레이션
// ═══════════════════════════════════════════════════════════════════

describe("E. segment planning metadata", () => {
  it("13) 120초 → estimatedSegmentCount = 8", () => {
    const total = 120;
    const segCount = Math.ceil(total / KLING_SEGMENT_CAP);
    expect(segCount).toBe(8);
  });

  it("14) 90초 → estimatedSegmentCount = 6", () => {
    expect(Math.ceil(90 / KLING_SEGMENT_CAP)).toBe(6);
  });

  it("15) 15초 → estimatedSegmentCount = 1", () => {
    expect(Math.ceil(15 / KLING_SEGMENT_CAP)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. persona + segment-aware interaction
// ═══════════════════════════════════════════════════════════════════

describe("F. persona + segment-aware", () => {
  it("16) propulsive-action + 15초 range → upper bias = 6컷", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["propulsive-action"];
    const bias = personaCutCountBias(ep);
    expect(bias).toBe("upper");
    const range = recommendCutCountRange(15);
    const result = resolveCutCount({
      preferredRange: range,
      totalDurationSec: 15,
      personaBias: bias,
    });
    expect(result.cutCount).toBe(6);
  });

  it("17) symmetrical-formalist + 15초 range → lower bias = density min", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["symmetrical-formalist"];
    const bias = personaCutCountBias(ep);
    expect(bias).toBe("lower");
    const range = recommendCutCountRange(15);
    const result = resolveCutCount({
      preferredRange: range,
      totalDurationSec: 15,
      personaBias: bias,
    });
    // lower = effectiveMin = max(4, densityMin=4) = 4
    expect(result.cutCount).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// G. regression checks
// ═══════════════════════════════════════════════════════════════════

describe("G. regression checks", () => {
  it("18) ≤15초 범위 기본값 유지 (new policy)", () => {
    expect(recommendCutCountRange(5)).toEqual({ min: 1, max: 2 });
    expect(recommendCutCountRange(8)).toEqual({ min: 2, max: 3 });
    expect(recommendCutCountRange(12)).toEqual({ min: 3, max: 4 });
    expect(recommendCutCountRange(15)).toEqual({ min: 4, max: 6 });
  });

  it("19) ≤15초 density minimum matches new policy", () => {
    expect(recommendMinimumCutCount(4)).toBe(1);
    expect(recommendMinimumCutCount(7)).toBe(2);
    expect(recommendMinimumCutCount(9)).toBe(3);
    expect(recommendMinimumCutCount(12)).toBe(3);
    expect(recommendMinimumCutCount(15)).toBe(4);
  });

  it("20) exact cutCount가 여전히 최우선", () => {
    const result = resolveCutCount({
      exactCutCount: 7,
      preferredRange: { min: 1, max: 2 },
      totalDurationSec: 15,
    });
    expect(result.cutCount).toBe(7);
    expect(result.source).toBe("exact_cutCount");
  });
});
