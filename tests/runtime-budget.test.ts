import { describe, it, expect } from "vitest";
import {
  calculateBudgetSummary,
  suggestBudgetActions,
  getBudgetStatus,
  getBudgetStatusColor,
  DEFAULT_BUDGET_LIMIT_SEC,
  type ClipBudgetEntry,
} from "@/lib/runtime-budget";

describe("runtime-budget", () => {
  const makeEntry = (overrides: Partial<ClipBudgetEntry> = {}): ClipBudgetEntry => ({
    clipId: `clip-${Math.random()}`,
    label: "test",
    shotCount: 3,
    totalDurationSec: 10,
    priority: "normal",
    ...overrides,
  });

  describe("calculateBudgetSummary", () => {
    it("returns correct summary for empty entries", () => {
      const summary = calculateBudgetSummary([]);
      expect(summary.totalClips).toBe(0);
      expect(summary.totalPlannedSec).toBe(0);
      expect(summary.overBudget).toBe(false);
      expect(summary.utilizationPercent).toBe(0);
    });

    it("calculates under-budget correctly", () => {
      const entries = [makeEntry({ totalDurationSec: 10 }), makeEntry({ totalDurationSec: 10 })];
      const summary = calculateBudgetSummary(entries);
      expect(summary.totalClips).toBe(2);
      expect(summary.totalPlannedSec).toBe(20);
      expect(summary.averageSecPerClip).toBe(10);
      expect(summary.overBudget).toBe(false);
      expect(summary.remainingSec).toBe(280);
    });

    it("detects over-budget", () => {
      const entries = Array.from({ length: 31 }, () => makeEntry({ totalDurationSec: 10 }));
      const summary = calculateBudgetSummary(entries);
      expect(summary.totalPlannedSec).toBe(310);
      expect(summary.overBudget).toBe(true);
      expect(summary.overBudgetSec).toBe(10);
    });

    it("respects custom budget limit", () => {
      const entries = [makeEntry({ totalDurationSec: 50 })];
      const summary = calculateBudgetSummary(entries, 40);
      expect(summary.overBudget).toBe(true);
      expect(summary.overBudgetSec).toBe(10);
    });
  });

  describe("getBudgetStatus", () => {
    it("returns 'under' for low utilization", () => {
      const summary = calculateBudgetSummary([makeEntry({ totalDurationSec: 10 })]);
      expect(getBudgetStatus(summary)).toBe("under");
    });

    it("returns 'warning' for high utilization", () => {
      const entries = Array.from({ length: 26 }, () => makeEntry({ totalDurationSec: 10 }));
      const summary = calculateBudgetSummary(entries);
      expect(summary.utilizationPercent).toBeGreaterThanOrEqual(85);
      expect(getBudgetStatus(summary)).toBe("warning");
    });

    it("returns 'over' when over budget", () => {
      const entries = Array.from({ length: 31 }, () => makeEntry({ totalDurationSec: 10 }));
      const summary = calculateBudgetSummary(entries);
      expect(getBudgetStatus(summary)).toBe("over");
    });
  });

  describe("getBudgetStatusColor", () => {
    it("returns green for under", () => {
      const c = getBudgetStatusColor("under");
      expect(c.text).toBe("#16a34a");
    });

    it("returns yellow for warning", () => {
      const c = getBudgetStatusColor("warning");
      expect(c.text).toBe("#ca8a04");
    });

    it("returns red for over", () => {
      const c = getBudgetStatusColor("over");
      expect(c.text).toBe("#dc2626");
    });
  });

  describe("suggestBudgetActions", () => {
    it("returns empty for under-budget", () => {
      const entries = [makeEntry({ totalDurationSec: 10 })];
      const summary = calculateBudgetSummary(entries);
      const actions = suggestBudgetActions(entries, summary);
      expect(actions).toHaveLength(0);
    });

    it("suggests reduce_duration for long clips", () => {
      const entries = Array.from({ length: 30 }, () =>
        makeEntry({ totalDurationSec: 12, shotCount: 2 })
      );
      const summary = calculateBudgetSummary(entries);
      const actions = suggestBudgetActions(entries, summary);
      const reduceDuration = actions.find(a => a.type === "reduce_duration");
      expect(reduceDuration).toBeDefined();
      expect(reduceDuration!.savingsSec).toBeGreaterThan(0);
    });

    it("suggests split_batch for many clips", () => {
      const entries = Array.from({ length: 40 }, () =>
        makeEntry({ totalDurationSec: 10, shotCount: 2 })
      );
      const summary = calculateBudgetSummary(entries);
      const actions = suggestBudgetActions(entries, summary);
      const split = actions.find(a => a.type === "split_batch");
      expect(split).toBeDefined();
    });

    it("suggests defer_low_priority", () => {
      const entries = [
        ...Array.from({ length: 25 }, () => makeEntry({ totalDurationSec: 10 })),
        ...Array.from({ length: 10 }, () => makeEntry({ totalDurationSec: 10, priority: "low" })),
      ];
      const summary = calculateBudgetSummary(entries);
      const actions = suggestBudgetActions(entries, summary);
      const defer = actions.find(a => a.type === "defer_low_priority");
      expect(defer).toBeDefined();
      expect(defer!.savingsSec).toBe(100);
    });
  });

  describe("DEFAULT_BUDGET_LIMIT_SEC", () => {
    it("is 300", () => {
      expect(DEFAULT_BUDGET_LIMIT_SEC).toBe(300);
    });
  });
});
