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
  it("1) 15초 = 2 segments (8 + 7), segment scope", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 15 });
    expect(plan.segmentCount).toBe(2);
    expect(plan.currentPlanningScope).toBe("segment");
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0].segmentDurationSec).toBe(8);
    expect(plan.segments[1].segmentDurationSec).toBe(7);
  });

  it("2) 120초 = 15 segments, segment scope", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    expect(plan.segmentCount).toBe(15);
    expect(plan.currentPlanningScope).toBe("segment");
    expect(plan.segments).toHaveLength(15);
    plan.segments.forEach(s => expect(s.segmentDurationSec).toBe(8));
  });

  it("3) 20초 = 3 segments (8 + 8 + 4)", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 20 });
    expect(plan.segmentCount).toBe(3);
    expect(plan.segments[0].segmentDurationSec).toBe(8);
    expect(plan.segments[1].segmentDurationSec).toBe(8);
    expect(plan.segments[2].segmentDurationSec).toBe(4);
  });

  it("4) 0초 → fallback to VEO_SEGMENT_CAP(8)", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 0 });
    expect(plan.totalDurationSec).toBe(VEO_SEGMENT_CAP);
    expect(plan.segmentCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. per-segment cut budget (density fallback)
// ═══════════════════════════════════════════════════════════════════

describe("B. per-segment cut budget", () => {
  it("5) 8초 segment → cutRange {3, 6}", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 15 });
    const seg = plan.segments[0]; // first segment is 8s
    expect(seg.cutRange.min).toBeGreaterThanOrEqual(3);
    expect(seg.cutRange.max).toBeLessThanOrEqual(6);
  });

  it("6) 120초 → totalTargetCuts = sum of all segment targets", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    const sum = plan.segments.reduce((s, seg) => s + seg.preferredCutTarget, 0);
    expect(plan.totalTargetCuts).toBe(sum);
  });

  it("7) currentSegmentTargetCuts는 ≤8 (segment cap 이내)", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    expect(plan.currentSegmentTargetCuts).toBeLessThanOrEqual(8);
    expect(plan.currentSegmentTargetCuts).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. exact cutCount 분배
// ═══════════════════════════════════════════════════════════════════

describe("C. exact cutCount 분배", () => {
  it("8) exactCutCount=40, 120초 → 15 segments × ~3 cuts", () => {
    const plan = resolveSegmentPlan({
      totalDurationSec: 120,
      exactCutCount: 40,
    });
    expect(plan.planningBasis).toBe("exact_cutCount");
    expect(plan.totalTargetCuts).toBe(40);
    // 40 / 15 = 2.67, round=3 per segment
    expect(plan.currentSegmentTargetCuts).toBe(3);
  });

  it("9) exactCutCount=10, 15초 → 2 segments (8+7), 5 cuts per segment", () => {
    const plan = resolveSegmentPlan({
      totalDurationSec: 15,
      exactCutCount: 10,
    });
    expect(plan.totalTargetCuts).toBe(10);
    expect(plan.segmentCount).toBe(2);
    // 10 / 2 = 5 per segment
    expect(plan.currentSegmentTargetCuts).toBe(5);
  });

  it("10) exactCutCount=3, 30초 → 4 segments (8+8+8+6), densityMinimum이 올림 (min 3/segment)", () => {
    const plan = resolveSegmentPlan({
      totalDurationSec: 30,
      exactCutCount: 3,
    });
    // exactCutCount=3이지만 총 densityMinimum=4 (30초 → max(4, ceil(30/8))=4)
    // enforcedCutCount=4, cutsPerSeg=round(4/4)=1, 각 segment densityMinimum=3 (8s/6s)
    expect(plan.totalTargetCuts).toBeGreaterThanOrEqual(4);
    expect(plan.segments[0].preferredCutTarget).toBeGreaterThanOrEqual(3);
    expect(plan.segments[1].preferredCutTarget).toBeGreaterThanOrEqual(3);
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
    // 15s → 2 segments (8+7). density min for 8s=3, for 7s=3
    // preferredRange {1,2} < densMin=3, so raised to 3
    expect(plan.segments[0].cutRange.min).toBeGreaterThanOrEqual(3);
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

  it("16) index=14 → 마지막 segment target 사용", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120, currentSegmentIndex: 14 });
    expect(plan.currentSegmentTargetCuts).toBe(plan.segments[14].preferredCutTarget);
  });

  it("17) index 초과 → 마지막 segment 사용 (방어)", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120, currentSegmentIndex: 99 });
    expect(plan.currentSegmentTargetCuts).toBe(
      plan.segments[plan.segments.length - 1].preferredCutTarget,
    );
  });
});
