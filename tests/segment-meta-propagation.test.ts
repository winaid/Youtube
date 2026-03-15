/**
 * segment-meta-propagation.test.ts
 *
 * resolveSegmentPlan() 메타데이터가 올바르게 전파되는지 검증.
 * - currentPlanningScope 분리
 * - totalTargetCutsAcrossSequence vs currentSegmentTargetCuts
 * - perSegmentCutRange 메타
 * - server/client parity
 */

import { describe, it, expect } from "vitest";
import {
  resolveSegmentPlan,
  KLING_SEGMENT_CAP,
} from "@/lib/sequence-density";

import {
  resolveSegmentPlan as serverResolveSegmentPlan,
} from "../functions/api/_sequence-density";

// ═══════════════════════════════════════════════════════════════════
// A. currentPlanningScope
// ═══════════════════════════════════════════════════════════════════

describe("A. currentPlanningScope", () => {
  it("1) ≤15초 → full_sequence", () => {
    expect(resolveSegmentPlan({ totalDurationSec: 10 }).currentPlanningScope).toBe("full_sequence");
    expect(resolveSegmentPlan({ totalDurationSec: 15 }).currentPlanningScope).toBe("full_sequence");
  });

  it("2) >15초 → segment", () => {
    expect(resolveSegmentPlan({ totalDurationSec: 16 }).currentPlanningScope).toBe("segment");
    expect(resolveSegmentPlan({ totalDurationSec: 120 }).currentPlanningScope).toBe("segment");
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. totalTargetCuts vs currentSegmentTargetCuts 분리
// ═══════════════════════════════════════════════════════════════════

describe("B. total vs current segment target 분리", () => {
  it("3) 120초 → totalTargetCuts > currentSegmentTargetCuts", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    expect(plan.totalTargetCuts).toBeGreaterThan(plan.currentSegmentTargetCuts);
  });

  it("4) 15초 → totalTargetCuts = currentSegmentTargetCuts", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 15 });
    expect(plan.totalTargetCuts).toBe(plan.currentSegmentTargetCuts);
  });

  it("5) 120초 totalTargetCuts = 8 × per-segment target (동일 duration segments)", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    // 모든 segment가 15초이므로 동일 target
    const perSeg = plan.segments[0].preferredCutTarget;
    expect(plan.totalTargetCuts).toBe(perSeg * 8);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. perSegmentCutRange 메타
// ═══════════════════════════════════════════════════════════════════

describe("C. perSegmentCutRange", () => {
  it("6) density fallback → perSegmentCutRange = singleSegmentRange(15) = {1, 2}", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    expect(plan.perSegmentCutRange).toEqual({ min: 1, max: 2 });
  });

  it("7) preferredRange 지정 → perSegmentCutRange = preferredRange", () => {
    const plan = resolveSegmentPlan({
      totalDurationSec: 120,
      preferredRange: { min: 4, max: 6 },
    });
    expect(plan.perSegmentCutRange).toEqual({ min: 4, max: 6 });
  });

  it("8) totalCutRange는 전체 시퀀스 기준", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    // 120초 = 8 segments × {1,2} = {8, 16}
    expect(plan.totalCutRange).toEqual({ min: 8, max: 16 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. planningBasis
// ═══════════════════════════════════════════════════════════════════

describe("D. planningBasis 메타", () => {
  it("9) exact cutCount → basis = exact_cutCount", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120, exactCutCount: 40 });
    expect(plan.planningBasis).toBe("exact_cutCount");
  });

  it("10) preferredRange → basis = preferred_range", () => {
    const plan = resolveSegmentPlan({
      totalDurationSec: 120,
      preferredRange: { min: 3, max: 5 },
    });
    expect(plan.planningBasis).toBe("preferred_range");
  });

  it("11) fallback → basis = density_policy", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 120 });
    expect(plan.planningBasis).toBe("density_policy");
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. server/client parity
// ═══════════════════════════════════════════════════════════════════

describe("E. server/client parity", () => {
  it("12) 120초 density fallback parity", () => {
    const client = resolveSegmentPlan({ totalDurationSec: 120 });
    const server = serverResolveSegmentPlan({ totalDurationSec: 120 });
    expect(server).toEqual(client);
  });

  it("13) 120초 + exactCutCount parity", () => {
    const opts = { totalDurationSec: 120, exactCutCount: 40 };
    expect(serverResolveSegmentPlan(opts)).toEqual(resolveSegmentPlan(opts));
  });

  it("14) 120초 + preferredRange + upper bias parity", () => {
    const opts = {
      totalDurationSec: 120,
      preferredRange: { min: 4, max: 6 },
      personaBias: "upper" as const,
    };
    expect(serverResolveSegmentPlan(opts)).toEqual(resolveSegmentPlan(opts));
  });

  it("15) 20초 remainder segment parity", () => {
    const opts = { totalDurationSec: 20, personaBias: "neutral" as const };
    expect(serverResolveSegmentPlan(opts)).toEqual(resolveSegmentPlan(opts));
  });
});
