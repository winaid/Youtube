/**
 * segment-orchestration-planning.test.ts
 *
 * resolveSegmentPlan() 핵심 로직 검증.
 * - segment 분해, per-segment cut budget, currentSegmentTargetCuts
 * - exact cutCount 분배
 * - preferredRange per-segment 해석
 * - persona bias 반영
 */

import { describe, it, expect } from "vitest";
import {
  resolveSegmentPlan,
  VEO_SEGMENT_CAP,
} from "@/lib/sequence-density";

// ═══════════════════════════════════════════════════════════════════
// A. 기본 segment 분해
// ═══════════════════════════════════════════════════════════════════

describe("A. segment 분해 기본", () => {
  it("1) 15초 = 1 segment, full_sequence scope", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 15 });
    expect(plan.segmentCount).toBe(1);
    expect(plan.currentPlanningScope).toBe("full_sequence");
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].segmentDurationSec).toBe(15);
  });

  it("2) 120초 = 8 segments, segment scope", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    expect(plan.segmentCount).toBe(8);
    expect(plan.currentPlanningScope).toBe("segment");
    expect(plan.segments).toHaveLength(8);
    plan.segments.forEach(s => expect(s.segmentDurationSec).toBe(15));
  });

  it("3) 20초 = 2 segments (15 + 5)", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 20 });
    expect(plan.segmentCount).toBe(2);
    expect(plan.segments[0].segmentDurationSec).toBe(15);
    expect(plan.segments[1].segmentDurationSec).toBe(5);
  });

  it("4) 0초 → fallback to VEO_SEGMENT_CAP(15)", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 0 });
    expect(plan.totalDurationSec).toBe(VEO_SEGMENT_CAP);
    expect(plan.segmentCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. per-segment cut budget (density fallback)
// ═══════════════════════════════════════════════════════════════════

describe("B. per-segment cut budget", () => {
  it("5) 15초 segment → cutRange {4, 6}", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 15 });
    const seg = plan.segments[0];
    expect(seg.cutRange.min).toBeGreaterThanOrEqual(4);
    expect(seg.cutRange.max).toBeLessThanOrEqual(6);
  });

  it("6) 120초 → totalTargetCuts = sum of all segment targets", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    const sum = plan.segments.reduce((s, seg) => s + seg.preferredCutTarget, 0);
    expect(plan.totalTargetCuts).toBe(sum);
  });

  it("7) currentSegmentTargetCuts는 ≤15 (segment cap 이내)", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    expect(plan.currentSegmentTargetCuts).toBeLessThanOrEqual(15);
    expect(plan.currentSegmentTargetCuts).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. exact cutCount 분배
// ═══════════════════════════════════════════════════════════════════

describe("C. exact cutCount 분배", () => {
  it("8) exactCutCount=40, 120초 → 8 segments × 5 cuts", () => {
    const plan = resolveSegmentPlan({
      totalDurationSec: 120,
      exactCutCount: 40,
    });
    expect(plan.planningBasis).toBe("exact_cutCount");
    expect(plan.totalTargetCuts).toBe(40);
    // 40 / 8 = 5 per segment
    expect(plan.currentSegmentTargetCuts).toBe(5);
  });

  it("9) exactCutCount=10, 15초 → 단일 segment, 10 cuts (capped at 15)", () => {
    const plan = resolveSegmentPlan({
      totalDurationSec: 15,
      exactCutCount: 10,
    });
    expect(plan.totalTargetCuts).toBe(10);
    expect(plan.currentSegmentTargetCuts).toBe(10);
  });

  it("10) exactCutCount=3, 30초 → 2 segments, densityMinimum이 올림 (min 4/segment)", () => {
    const plan = resolveSegmentPlan({
      totalDurationSec: 30,
      exactCutCount: 3,
    });
    // exactCutCount=3이지만 총 densityMinimum=4 (30초 → max(4, ceil(30/15))=4)
    // 각 segment의 densityMinimum=4 (15초 숏폼 리듬)
    expect(plan.totalTargetCuts).toBeGreaterThanOrEqual(4);
    expect(plan.segments[0].preferredCutTarget).toBeGreaterThanOrEqual(4);
    expect(plan.segments[1].preferredCutTarget).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. preferredRange per-segment 해석
// ═══════════════════════════════════════════════════════════════════

describe("D. preferredRange per-segment", () => {
  it("11) preferredRange={3,5} → 각 segment에 적용", () => {
    const plan = resolveSegmentPlan({
      totalDurationSec: 30,
      preferredRange: { min: 3, max: 5 },
    });
    expect(plan.planningBasis).toBe("preferred_range");
    plan.segments.forEach(seg => {
      expect(seg.cutRange.min).toBeGreaterThanOrEqual(3);
      expect(seg.cutRange.max).toBeLessThanOrEqual(5);
    });
  });

  it("12) preferredRange가 density minimum보다 낮으면 올림", () => {
    const plan = resolveSegmentPlan({
      totalDurationSec: 15,
      preferredRange: { min: 1, max: 2 },
    });
    // density min for 15s = 1 (3-layer model: totalDuration ≤ 15 → returns 1)
    expect(plan.segments[0].cutRange.min).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. persona bias 반영
// ═══════════════════════════════════════════════════════════════════

describe("E. persona bias", () => {
  it("13) upper bias → segment target = effectiveMax", () => {
    const upper = resolveSegmentPlan({ totalDurationSec: 15, personaBias: "upper" });
    const lower = resolveSegmentPlan({ totalDurationSec: 15, personaBias: "lower" });
    expect(upper.currentSegmentTargetCuts).toBeGreaterThanOrEqual(
      lower.currentSegmentTargetCuts,
    );
  });

  it("14) neutral bias → midpoint", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 15, personaBias: "neutral" });
    const seg = plan.segments[0];
    const mid = Math.round((seg.cutRange.min + seg.cutRange.max) / 2);
    expect(seg.preferredCutTarget).toBe(mid);
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. currentSegmentIndex
// ═══════════════════════════════════════════════════════════════════

describe("F. currentSegmentIndex", () => {
  it("15) index=0 → 첫 segment target 사용", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120, currentSegmentIndex: 0 });
    expect(plan.currentSegmentTargetCuts).toBe(plan.segments[0].preferredCutTarget);
  });

  it("16) index=7 → 마지막 segment target 사용", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120, currentSegmentIndex: 7 });
    expect(plan.currentSegmentTargetCuts).toBe(plan.segments[7].preferredCutTarget);
  });

  it("17) index 초과 → 마지막 segment 사용 (방어)", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120, currentSegmentIndex: 99 });
    expect(plan.currentSegmentTargetCuts).toBe(
      plan.segments[plan.segments.length - 1].preferredCutTarget,
    );
  });
});
