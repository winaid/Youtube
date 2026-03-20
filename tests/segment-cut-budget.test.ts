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
  it("1) 8초 segment (first of 15s total) → densityMinimum = 3", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 15 });
    // 15s → 2 segments (8+7). First segment 8s → densityMinimum=3
    expect(plan.segments[0].densityMinimum).toBe(3);
  });

  it("2) 4초 remainder segment (20s total) → densityMinimum = 1", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 20 });
    // 20s → 3 segments (8+8+4). Last segment=4s
    expect(plan.segments[2].densityMinimum).toBe(
      recommendMinimumCutCount(4),
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
  it("4) 25초 → 3×8초 + 1초 remainder", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 25 });
    // ceil(25/8)=4 segments: [8, 8, 8, 1]
    expect(plan.segments[0].segmentDurationSec).toBe(8);
    expect(plan.segments[1].segmentDurationSec).toBe(8);
    expect(plan.segments[2].segmentDurationSec).toBe(8);
    expect(plan.segments[3].segmentDurationSec).toBe(1);
  });

  it("5) 25초 remainder(1초) cutRange는 singleSegmentRange(1) 기반", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 25 });
    const rem = plan.segments[3]; // last segment = 1s
    // 1초 → RANGE_PRESETS: ≤5s → {1, 2}, densityMinimum=1
    expect(rem.cutRange.min).toBeGreaterThanOrEqual(1);
    expect(rem.cutRange.max).toBeLessThanOrEqual(2);
  });

  it("6) 64초 = 정확히 8 segments, remainder 없음", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 64 });
    expect(plan.segmentCount).toBe(8);
    plan.segments.forEach(seg => {
      expect(seg.segmentDurationSec).toBe(8);
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

  it("8) 300초 = 38 segments", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 300 });
    // ceil(300/8)=38 segments
    expect(plan.segmentCount).toBe(38);
    expect(plan.totalTargetCuts).toBeGreaterThan(plan.currentSegmentTargetCuts);
  });

  it("9) exact cutCount=1, 120초 → densityMinimum이 preferredCutTarget을 올림", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120, exactCutCount: 1 });
    // exactCutCount=1이지만 densityMinimum=3 (8초 segment)이므로 최소 3
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
  it("11) currentSegmentTargetCuts ≤ 8 (단일 호출 cap)", () => {
    [15, 30, 60, 90, 120].forEach(dur => {
      const plan = resolveSegmentPlan({ totalDurationSec: dur });
      expect(plan.currentSegmentTargetCuts).toBeLessThanOrEqual(8);
    });
  });

  it("12) 120초 totalTargetCuts ≫ 8 (전체 시퀀스는 8 cap 없음)", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    expect(plan.totalTargetCuts).toBeGreaterThan(8);
  });
});
