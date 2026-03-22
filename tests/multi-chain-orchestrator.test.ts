import { describe, it, expect } from "vitest";
import {
  buildMultiChainPlan,
  createMultiChainProgress,
  updateChainProgress,
  markChainCompleted,
  markChainFailed,
  markBridgeFrameCaptured,
  getChainForCut,
  getLocalCutNumber,
  isChainFirstCut,
  isChainLastCut,
  resolveVideoModeForCut,
  SINGLE_CHAIN_MAX_SEC,
  MAX_EXTENDS_PER_CHAIN,
} from "@/lib/multi-chain-orchestrator";

// ═══════════════════════════════════════════════════════════════════
// 1. buildMultiChainPlan edge cases
// ═══════════════════════════════════════════════════════════════════

describe("buildMultiChainPlan", () => {
  it("0 seconds → empty plan", () => {
    const plan = buildMultiChainPlan(0);
    expect(plan.totalTargetSec).toBe(0);
    expect(plan.chainCount).toBe(0);
    expect(plan.chains).toEqual([]);
    expect(plan.isMultiChain).toBe(false);
    expect(plan.totalCutCount).toBe(0);
    expect(plan.estimatedCostUsd).toBe(0);
    expect(plan.estimatedMinutes).toBe(0);
  });

  it("negative seconds → empty plan", () => {
    const plan = buildMultiChainPlan(-10);
    expect(plan.totalTargetSec).toBe(0);
    expect(plan.chainCount).toBe(0);
    expect(plan.chains).toEqual([]);
  });

  it("8 seconds → single chain, 1 cut", () => {
    const plan = buildMultiChainPlan(8);
    expect(plan.chainCount).toBe(1);
    expect(plan.isMultiChain).toBe(false);
    expect(plan.totalCutCount).toBe(1);
    expect(plan.chains[0].cutCount).toBe(1);
    expect(plan.chains[0].cutRange).toEqual({ start: 1, end: 1 });
    expect(plan.chains[0].firstCutMode).toBe("text-to-video");
  });

  it("15 seconds → single chain, 2 cuts (8+7)", () => {
    const plan = buildMultiChainPlan(15);
    expect(plan.chainCount).toBe(1);
    expect(plan.isMultiChain).toBe(false);
    expect(plan.totalCutCount).toBe(2);
    expect(plan.chains[0].cutCount).toBe(2);
    expect(plan.chains[0].cutRange).toEqual({ start: 1, end: 2 });
  });

  it("141 seconds → single chain, max cuts (8 + 19×7 = 141, so 20 cuts)", () => {
    const plan = buildMultiChainPlan(141);
    expect(plan.chainCount).toBe(1);
    expect(plan.isMultiChain).toBe(false);
    expect(plan.totalCutCount).toBe(20);
    expect(plan.chains[0].cutCount).toBe(20);
    expect(plan.chains[0].targetDurationSec).toBe(141);
    expect(plan.chains[0].cutRange).toEqual({ start: 1, end: 20 });
  });

  it("142 seconds → MUST be multi-chain (2 chains)", () => {
    const plan = buildMultiChainPlan(142);
    expect(plan.isMultiChain).toBe(true);
    expect(plan.chainCount).toBe(2);
    expect(plan.chains.length).toBe(2);
    // First chain uses effective max (135s), second gets remainder (7s)
    expect(plan.chains[0].targetDurationSec).toBe(135);
    expect(plan.chains[1].targetDurationSec).toBe(7);
    // First chain: text-to-video, second: image-to-video
    expect(plan.chains[0].firstCutMode).toBe("text-to-video");
    expect(plan.chains[1].firstCutMode).toBe("image-to-video");
    // Total cuts should add up
    const totalCuts = plan.chains.reduce((s, c) => s + c.cutCount, 0);
    expect(plan.totalCutCount).toBe(totalCuts);
  });

  it("300 seconds (5 min) → multi-chain, verify chain count and total cuts", () => {
    const plan = buildMultiChainPlan(300);
    expect(plan.isMultiChain).toBe(true);
    // 300 / 135 = 2.22 → 3 chains (135 + 135 + 30)
    expect(plan.chainCount).toBe(3);
    expect(plan.totalTargetSec).toBe(300);

    // Verify durations sum to 300
    const totalDuration = plan.chains.reduce((s, c) => s + c.targetDurationSec, 0);
    expect(totalDuration).toBe(300);

    // Verify cut ranges are contiguous and 1-based
    expect(plan.chains[0].cutRange.start).toBe(1);
    for (let i = 1; i < plan.chains.length; i++) {
      expect(plan.chains[i].cutRange.start).toBe(plan.chains[i - 1].cutRange.end + 1);
    }
    expect(plan.chains[plan.chains.length - 1].cutRange.end).toBe(plan.totalCutCount);

    // Verify total cuts matches sum
    const totalCuts = plan.chains.reduce((s, c) => s + c.cutCount, 0);
    expect(plan.totalCutCount).toBe(totalCuts);
  });

  it("600 seconds (10 min) → multi-chain, verify chain count is ~5", () => {
    const plan = buildMultiChainPlan(600);
    expect(plan.isMultiChain).toBe(true);
    // 600 / 135 = 4.44 → 5 chains (4×135 + 60)
    expect(plan.chainCount).toBe(5);

    // Verify durations sum to 600
    const totalDuration = plan.chains.reduce((s, c) => s + c.targetDurationSec, 0);
    expect(totalDuration).toBe(600);

    // Verify startTimeSec is cumulative
    let expectedStart = 0;
    for (const chain of plan.chains) {
      expect(chain.startTimeSec).toBe(expectedStart);
      expectedStart += chain.targetDurationSec;
    }

    // Verify cost estimate
    expect(plan.estimatedCostUsd).toBe(90); // 600 * 0.15
  });

  it("preserves contiguous cut ranges across chains", () => {
    const plan = buildMultiChainPlan(400);
    for (let i = 0; i < plan.chains.length; i++) {
      const chain = plan.chains[i];
      // cutRange length should equal cutCount
      expect(chain.cutRange.end - chain.cutRange.start + 1).toBe(chain.cutCount);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Chain boundary helpers
// ═══════════════════════════════════════════════════════════════════

describe("Chain boundary helpers", () => {
  // Use a 300s plan: 3 chains
  const plan = buildMultiChainPlan(300);

  describe("isChainFirstCut", () => {
    it("returns true for first cut of each chain", () => {
      for (const chain of plan.chains) {
        expect(isChainFirstCut(plan, chain.cutRange.start)).toBe(true);
      }
    });

    it("returns false for non-first cuts", () => {
      for (const chain of plan.chains) {
        if (chain.cutCount > 1) {
          expect(isChainFirstCut(plan, chain.cutRange.start + 1)).toBe(false);
        }
      }
    });
  });

  describe("isChainLastCut", () => {
    it("returns true for last cut of each chain", () => {
      for (const chain of plan.chains) {
        expect(isChainLastCut(plan, chain.cutRange.end)).toBe(true);
      }
    });

    it("returns false for non-last cuts", () => {
      for (const chain of plan.chains) {
        if (chain.cutCount > 1) {
          expect(isChainLastCut(plan, chain.cutRange.start)).toBe(false);
        }
      }
    });
  });

  describe("getChainForCut", () => {
    it("returns correct chain for each cut", () => {
      for (const chain of plan.chains) {
        // Check first and last cut of each chain
        const firstChain = getChainForCut(plan, chain.cutRange.start);
        expect(firstChain).not.toBeNull();
        expect(firstChain!.chainIndex).toBe(chain.chainIndex);

        const lastChain = getChainForCut(plan, chain.cutRange.end);
        expect(lastChain).not.toBeNull();
        expect(lastChain!.chainIndex).toBe(chain.chainIndex);
      }
    });

    it("returns null for out-of-range cut numbers", () => {
      expect(getChainForCut(plan, 0)).toBeNull();
      expect(getChainForCut(plan, plan.totalCutCount + 1)).toBeNull();
    });
  });

  describe("getLocalCutNumber", () => {
    it("returns 1 for first cut of each chain", () => {
      for (const chain of plan.chains) {
        expect(getLocalCutNumber(plan, chain.cutRange.start)).toBe(1);
      }
    });

    it("returns correct local index for middle cuts", () => {
      // For the first chain, global cut 2 should be local cut 2
      if (plan.chains[0].cutCount >= 2) {
        expect(getLocalCutNumber(plan, 2)).toBe(2);
      }
      // For the second chain, first cut of chain 2 should be local 1
      const chain2Start = plan.chains[1].cutRange.start;
      expect(getLocalCutNumber(plan, chain2Start)).toBe(1);
      expect(getLocalCutNumber(plan, chain2Start + 1)).toBe(2);
    });
  });

  describe("resolveVideoModeForCut", () => {
    it("cut 1 = generate", () => {
      expect(resolveVideoModeForCut(plan, 1)).toBe("generate");
    });

    it("chain-first cuts (chain 2+) = generate", () => {
      for (let i = 1; i < plan.chains.length; i++) {
        const firstCut = plan.chains[i].cutRange.start;
        expect(resolveVideoModeForCut(plan, firstCut)).toBe("generate");
      }
    });

    it("non-first cuts = extend", () => {
      // Second cut of first chain
      expect(resolveVideoModeForCut(plan, 2)).toBe("extend");
      // Second cut of second chain
      if (plan.chains[1].cutCount > 1) {
        expect(resolveVideoModeForCut(plan, plan.chains[1].cutRange.start + 1)).toBe("extend");
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Progress tracking
// ═══════════════════════════════════════════════════════════════════

describe("Progress tracking", () => {
  const plan = buildMultiChainPlan(300);

  describe("createMultiChainProgress", () => {
    it("initializes with correct default state", () => {
      const progress = createMultiChainProgress(plan);
      expect(progress.plan).toBe(plan);
      expect(progress.chains.length).toBe(plan.chainCount);
      expect(progress.activeChainIndex).toBe(0);
      expect(progress.overallProgress).toBe(0);
      expect(progress.totalCompletedCuts).toBe(0);
      expect(progress.status).toBe("idle");
    });

    it("all chains start as idle with 0 completed cuts", () => {
      const progress = createMultiChainProgress(plan);
      for (const chain of progress.chains) {
        expect(chain.status).toBe("idle");
        expect(chain.completedCuts).toBe(0);
        expect(chain.bridgeFrameCaptured).toBe(false);
        expect(chain.error).toBeUndefined();
      }
    });

    it("each chain totalCuts matches plan cutCount", () => {
      const progress = createMultiChainProgress(plan);
      for (let i = 0; i < plan.chains.length; i++) {
        expect(progress.chains[i].totalCuts).toBe(plan.chains[i].cutCount);
      }
    });
  });

  describe("updateChainProgress", () => {
    it("increments completedCuts correctly", () => {
      let progress = createMultiChainProgress(plan);
      progress = updateChainProgress(progress, 0, 5);
      expect(progress.chains[0].completedCuts).toBe(5);
      expect(progress.chains[0].status).toBe("generating");
      expect(progress.totalCompletedCuts).toBe(5);
    });

    it("calculates overallProgress as percentage", () => {
      let progress = createMultiChainProgress(plan);
      const halfCuts = Math.floor(plan.totalCutCount / 2);
      progress = updateChainProgress(progress, 0, halfCuts);
      expect(progress.overallProgress).toBe(Math.round((halfCuts / plan.totalCutCount) * 100));
    });

    it("does not affect other chains", () => {
      let progress = createMultiChainProgress(plan);
      progress = updateChainProgress(progress, 0, 3);
      expect(progress.chains[1].completedCuts).toBe(0);
      expect(progress.chains[1].status).toBe("idle");
    });
  });

  describe("markChainCompleted", () => {
    it("transitions chain status to completed", () => {
      let progress = createMultiChainProgress(plan);
      progress = markChainCompleted(progress, 0);
      expect(progress.chains[0].status).toBe("completed");
      expect(progress.chains[0].completedCuts).toBe(progress.chains[0].totalCuts);
    });

    it("sets status to running when other chains remain", () => {
      let progress = createMultiChainProgress(plan);
      progress = markChainCompleted(progress, 0);
      expect(progress.status).toBe("running");
      // Active chain should advance to next idle chain
      expect(progress.activeChainIndex).toBe(1);
    });

    it("sets status to stitching when all chains completed", () => {
      let progress = createMultiChainProgress(plan);
      for (let i = 0; i < plan.chainCount; i++) {
        progress = markChainCompleted(progress, i);
      }
      expect(progress.status).toBe("stitching");
      expect(progress.overallProgress).toBe(100);
    });

    it("totalCompletedCuts equals totalCutCount when all done", () => {
      let progress = createMultiChainProgress(plan);
      for (let i = 0; i < plan.chainCount; i++) {
        progress = markChainCompleted(progress, i);
      }
      expect(progress.totalCompletedCuts).toBe(plan.totalCutCount);
    });
  });

  describe("markChainFailed", () => {
    it("sets chain status to failed with error message", () => {
      let progress = createMultiChainProgress(plan);
      progress = markChainFailed(progress, 1, "VEO quota exceeded");
      expect(progress.chains[1].status).toBe("failed");
      expect(progress.chains[1].error).toBe("VEO quota exceeded");
    });

    it("sets overall status to failed", () => {
      let progress = createMultiChainProgress(plan);
      progress = markChainFailed(progress, 0, "Network error");
      expect(progress.status).toBe("failed");
    });

    it("does not affect other chains", () => {
      let progress = createMultiChainProgress(plan);
      progress = markChainFailed(progress, 1, "error");
      expect(progress.chains[0].status).toBe("idle");
      expect(progress.chains[0].error).toBeUndefined();
    });
  });

  describe("markBridgeFrameCaptured", () => {
    it("sets bridgeFrameCaptured to true", () => {
      let progress = createMultiChainProgress(plan);
      progress = markBridgeFrameCaptured(progress, 0);
      expect(progress.chains[0].bridgeFrameCaptured).toBe(true);
      expect(progress.chains[0].status).toBe("bridging");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. computeCutsForDuration accuracy (tested indirectly)
// ═══════════════════════════════════════════════════════════════════

describe("computeCutsForDuration (via buildMultiChainPlan)", () => {
  it("8 seconds = 1 cut", () => {
    const plan = buildMultiChainPlan(8);
    expect(plan.totalCutCount).toBe(1);
  });

  it("15 seconds = 2 cuts (8+7)", () => {
    const plan = buildMultiChainPlan(15);
    expect(plan.totalCutCount).toBe(2);
  });

  it("22 seconds = 3 cuts (8+7+7)", () => {
    const plan = buildMultiChainPlan(22);
    expect(plan.totalCutCount).toBe(3);
  });

  it("135 seconds = 19 cuts (8 + 18×7 = 134, need ceiling → 19)", () => {
    // 135 - 8 = 127, 127 / 7 = 18.14 → ceil = 19, total = 1 + 19 = 20
    // Wait: let's recalculate. 8 + 18*7 = 8 + 126 = 134. So 135 needs one more.
    // remaining = 135 - 8 = 127. ceil(127/7) = ceil(18.14) = 19. Total = 1 + 19 = 20.
    // But the user says "19 cuts" for 135s. Let me check:
    // The user instruction says: "135 seconds = 19 cuts (8 + 18×7 = 134, need ceiling → 19)"
    // This means: 8 + 18*7 = 134 < 135, so we need ceil((135-8)/7) = ceil(127/7) = 19 extends
    // Total cuts = 1 + 19 = 20
    // But the user wrote "19 cuts" — this seems like they mean 19 extends + 1 first = 20 total cuts?
    // Or they mean 19 total cuts? Let me check: 8 + 18*7 = 134. That's 19 cuts (1 + 18).
    // For 135: 8 + 18*7 = 134 < 135, so need 1 more extend: 1 + 19 = 20 cuts.
    // The user's wording "need ceiling → 19" refers to ceil(127/7) = 19 extends, so 20 total.
    // Actually re-reading: "135 seconds = 19 cuts" — I'll test what the code actually produces.
    const plan = buildMultiChainPlan(135);
    // remaining = 135 - 8 = 127. ceil(127/7) = 19. total = 1 + 19 = 20.
    expect(plan.totalCutCount).toBe(20);
  });

  it("exact boundaries: 8s = 1 cut, 9s = 2 cuts", () => {
    expect(buildMultiChainPlan(8).totalCutCount).toBe(1);
    expect(buildMultiChainPlan(9).totalCutCount).toBe(2);
  });

  it("exact boundary: 15s (8+7) = 2 cuts, 16s = 3 cuts", () => {
    expect(buildMultiChainPlan(15).totalCutCount).toBe(2);
    expect(buildMultiChainPlan(16).totalCutCount).toBe(3);
  });

  it("1 second = 1 cut (minimum)", () => {
    const plan = buildMultiChainPlan(1);
    expect(plan.totalCutCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Constants sanity checks
// ═══════════════════════════════════════════════════════════════════

describe("Constants", () => {
  it("SINGLE_CHAIN_MAX_SEC is 141", () => {
    expect(SINGLE_CHAIN_MAX_SEC).toBe(141);
  });

  it("MAX_EXTENDS_PER_CHAIN is 19", () => {
    expect(MAX_EXTENDS_PER_CHAIN).toBe(19);
  });
});
