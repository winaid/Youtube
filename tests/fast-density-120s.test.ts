/**
 * fast-density-120s.test.ts
 *
 * "120초 자동 + 빠른 편집" 시나리오의 전체 흐름 검증.
 * - duration="auto"일 때 editingDensity가 payload에 실리는지
 * - 120초에서 segment-aware density 계산
 * - fast density가 상단 범위 선호하는지
 * - resolveCutCount에 실제 totalDurationSec=120이 사용되는지
 */

import { describe, it, expect } from "vitest";
import {
  recommendCutCountRange,
  densityPresetToRange,
  resolveCutCount,
  personaCutCountBias,
  recommendMinimumCutCount,
  VEO_SEGMENT_CAP,
} from "@/lib/sequence-density";

import {
  recommendCutCountRange as serverRecommendRange,
  resolveCutCount as serverResolveCutCount,
  recommendMinimumCutCount as serverRecommendMin,
} from "../functions/api/_sequence-density";

// ═══════════════════════════════════════════════════════════════════
// A. duration="auto" + editingDensity payload 전달
// ═══════════════════════════════════════════════════════════════════

describe("A. editingDensity payload with duration=auto", () => {
  it("1) duration=auto 시 effectiveTotalSec 계산으로 range가 만들어짐", () => {
    // InputPanel 로직 시뮬레이션:
    // duration="auto" → totalSec=0 → effectiveTotalSec=VEO_SEGMENT_CAP(15)
    const effectiveTotalSec = VEO_SEGMENT_CAP; // fallback to single segment
    const range = densityPresetToRange("dense", effectiveTotalSec);
    expect(range).toBeDefined();
    expect(range.min).toBeGreaterThan(0);
    expect(range.max).toBeGreaterThan(range.min);
  });

  it("2) dense preset + 15초 segment → 상단 범위", () => {
    const normal = recommendCutCountRange(15);
    const dense = densityPresetToRange("dense", 15);
    expect(dense.min).toBeGreaterThanOrEqual(normal.max);
  });

  it("3) sparse preset + 15초 segment → 하단 범위", () => {
    const normal = recommendCutCountRange(15);
    const sparse = densityPresetToRange("sparse", 15);
    expect(sparse.max).toBeLessThanOrEqual(normal.min);
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. 120초 segment-aware density
// ═══════════════════════════════════════════════════════════════════

describe("B. 120초 segment-aware density", () => {
  it("4) 120초 → 8 segments (120/15=8)", () => {
    expect(Math.ceil(120 / VEO_SEGMENT_CAP)).toBe(8);
  });

  it("5) recommendCutCountRange(120) = 8 × range(15) = {32, 48}", () => {
    const range = recommendCutCountRange(120);
    // 8 full segments of 15s → 8 × {4, 6} = {32, 48}
    expect(range).toEqual({ min: 32, max: 48 });
  });

  it("6) recommendMinimumCutCount(120) = ceil(120/15) = 8 sequences", () => {
    expect(recommendMinimumCutCount(120)).toBe(8);
  });

  it("7) 60초 → 4 segments → {16, 24}", () => {
    const range = recommendCutCountRange(60);
    expect(range).toEqual({ min: 16, max: 24 });
  });

  it("8) 90초 → 6 segments (15×6=90) → {24, 36}", () => {
    const range = recommendCutCountRange(90);
    expect(range).toEqual({ min: 24, max: 36 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. resolveCutCount with real totalDurationSec=120
// ═══════════════════════════════════════════════════════════════════

describe("C. resolveCutCount with totalDurationSec=120", () => {
  it("9) secPerCut*3 같은 가짜 totalDuration 대신 실제 120 사용 시 densityMinimum이 더 높음", () => {
    const fakeResult = resolveCutCount({
      totalDurationSec: 8 * 3, // 24 — 이전 버그 패턴
      personaBias: "neutral",
    });
    const realResult = resolveCutCount({
      totalDurationSec: 120, // 실제 값
      personaBias: "neutral",
    });
    // 120초면 더 높은 densityMinimum (ceil(120/15)=8 vs ceil(24/15)=4)
    expect(realResult.densityMinimum).toBeGreaterThan(fakeResult.densityMinimum);
    // cutCount는 CUT_COUNT_MAX=10으로 둘 다 capped될 수 있으므로 densityMinimum으로 비교
  });

  it("10) 120초 + dense range + upper bias → 많은 컷 수", () => {
    const denseRange = densityPresetToRange("dense", 120);
    const result = resolveCutCount({
      preferredRange: denseRange,
      totalDurationSec: 120,
      personaBias: "upper",
    });
    expect(result.cutCount).toBeGreaterThan(0);
  });

  it("11) 15초 기본 추천이 {4, 6}으로 변경 (숏폼 리텐션)", () => {
    expect(recommendCutCountRange(15)).toEqual({ min: 4, max: 6 });
  });

  it("12) fast density면 상단, sparse면 하단", () => {
    const fast = densityPresetToRange("dense", 15);
    const slow = densityPresetToRange("sparse", 15);
    expect(fast.min).toBeGreaterThan(slow.max);
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. server/client parity for segment-aware
// ═══════════════════════════════════════════════════════════════════

describe("D. server/client segment-aware parity", () => {
  it("13) recommendCutCountRange parity for 120s", () => {
    expect(serverRecommendRange(120)).toEqual(recommendCutCountRange(120));
  });

  it("14) recommendMinimumCutCount parity for 120s", () => {
    expect(serverRecommendMin(120)).toBe(recommendMinimumCutCount(120));
  });

  it("15) resolveCutCount parity for 120s + preferred range", () => {
    const opts = {
      preferredRange: { min: 32, max: 48 },
      totalDurationSec: 120,
      personaBias: "neutral" as const,
    };
    expect(serverResolveCutCount(opts)).toEqual(resolveCutCount(opts));
  });
});
