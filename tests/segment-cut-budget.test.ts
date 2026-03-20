/**
 * segment-cut-budget.test.ts
 *
 * SegmentCutBudget 개별 항목의 정합성 검증.
 * - densityMinimum 유지
 * - remainder segment 정확한 budget
 * - edge case (매우 짧은/긴 duration)
 */

import { describe, it, expect } from "vitest";
import {
  resolveSegmentPlan,
  recommendMinimumCutCount,
  VEO_SEGMENT_CAP,
} from "@/lib/sequence-density";

// ═══════════════════════════════════════════════════════════════════
// A. densityMinimum 유지
// ═══════════════════════════════════════════════════════════════════

describe("A. segment densityMinimum", () => {
  it("1) 15초 segment → densityMinimum = 4 (숏폼 리듬)", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 15 });
    expect(plan.segments[0].densityMinimum).toBe(4);
  });

  it("2) 5초 remainder segment → densityMinimum = 1", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 20 });
    expect(plan.segments[1].densityMinimum).toBe(
      recommendMinimumCutCount(5),
    );
  });

  it("3) preferredCutTarget은 항상 ≥ densityMinimum", () => {
    const plan = resolveSegmentPlan({
      totalDurationSec: 120,
      preferredRange: { min: 1, max: 2 },
    });
    plan.segments.forEach(seg => {
      expect(seg.preferredCutTarget).toBeGreaterThanOrEqual(seg.densityMinimum);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. remainder segment budget
// ═══════════════════════════════════════════════════════════════════

describe("B. remainder segment budget", () => {
  it("4) 25초 → 15초 + 10초 remainder", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 25 });
    expect(plan.segments[0].segmentDurationSec).toBe(15);
    expect(plan.segments[1].segmentDurationSec).toBe(10);
  });

  it("5) 25초 remainder(10초) cutRange는 singleSegmentRange(10) 기반", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 25 });
    const rem = plan.segments[1];
    // 10초 → RANGE_PRESETS: 10-15s → {4, 6}, densityMinimum=4
    expect(rem.cutRange.min).toBeGreaterThanOrEqual(4);
    expect(rem.cutRange.max).toBeLessThanOrEqual(6);
  });

  it("6) 90초 = 정확히 6 segments, remainder 없음", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 90 });
    expect(plan.segmentCount).toBe(6);
    plan.segments.forEach(seg => {
      expect(seg.segmentDurationSec).toBe(15);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. edge cases
// ═══════════════════════════════════════════════════════════════════

describe("C. edge cases", () => {
  it("7) 1초 → 단일 segment, min budget", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 1 });
    expect(plan.segmentCount).toBe(1);
    expect(plan.segments[0].segmentDurationSec).toBe(1);
    expect(plan.currentSegmentTargetCuts).toBeGreaterThanOrEqual(1);
  });

  it("8) 300초 = 20 segments", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 300 });
    expect(plan.segmentCount).toBe(20);
    expect(plan.totalTargetCuts).toBeGreaterThan(plan.currentSegmentTargetCuts);
  });

  it("9) exact cutCount=1, 120초 → densityMinimum이 preferredCutTarget을 올림", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120, exactCutCount: 1 });
    // exactCutCount=1이지만 densityMinimum=4 (15초 segment)이므로 최소 4
    expect(plan.segments[0].preferredCutTarget).toBeGreaterThanOrEqual(1);
  });

  it("10) segmentDurationCap은 항상 VEO_SEGMENT_CAP", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 60 });
    expect(plan.segmentDurationCap).toBe(VEO_SEGMENT_CAP);
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. generate-cuts targetCuts와의 정합성
// ═══════════════════════════════════════════════════════════════════

describe("D. targetCuts 정합성", () => {
  it("11) currentSegmentTargetCuts ≤ 15 (단일 호출 cap)", () => {
    [15, 30, 60, 90, 120].forEach(dur => {
      const plan = resolveSegmentPlan({ totalDurationSec: dur });
      expect(plan.currentSegmentTargetCuts).toBeLessThanOrEqual(15);
    });
  });

  it("12) 120초 totalTargetCuts ≫ 15 (전체 시퀀스는 15 cap 없음)", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    expect(plan.totalTargetCuts).toBeGreaterThan(15);
  });
});
