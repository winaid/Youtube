/**
 * batch-runtime-budget.test.ts — 배치 런타임 예산 관리 테스트
 *
 * Case 4: 30 clips × 12s = 360s → 300s 예산 초과 경고
 */

import { describe, it, expect } from "vitest";
import {
  checkBatchBudget,
  suggestBatchSplit,
  BATCH_BUDGET_SECONDS,
  BUDGET_WARNING_RATIO,
  MAX_CLIPS_PER_BATCH,
} from "@/lib/batch-runtime-budget";
import type { BatchClipInfo } from "@/lib/batch-runtime-budget";

// ═══════════════════════════════════════════════════════════════════
// checkBatchBudget
// ═══════════════════════════════════════════════════════════════════

describe("checkBatchBudget", () => {
  it("Case 4: 30 clips × 12s = 360s → over_budget", () => {
    const clips: BatchClipInfo[] = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      durationSec: 12,
    }));

    const result = checkBatchBudget(clips);

    expect(result.totalRuntimeSec).toBe(360);
    expect(result.clipCount).toBe(30);
    expect(result.withinBudget).toBe(false);
    expect(result.overBudgetSec).toBe(60);
    expect(result.severity).toBe("over_budget");
    expect(result.suggestions.length).toBeGreaterThan(0);

    // 배치 분할 제안 포함
    const splitSuggestion = result.suggestions.find(s => s.includes("배치로 분할"));
    expect(splitSuggestion).toBeDefined();
  });

  it("예산 내 (200s) → ok", () => {
    const clips: BatchClipInfo[] = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      durationSec: 10,
    }));

    const result = checkBatchBudget(clips);

    expect(result.totalRuntimeSec).toBe(200);
    expect(result.withinBudget).toBe(true);
    expect(result.severity).toBe("ok");
  });

  it("예산 근접 (250s) → warning", () => {
    const clips: BatchClipInfo[] = Array.from({ length: 25 }, (_, i) => ({
      id: i,
      durationSec: 10,
    }));

    const result = checkBatchBudget(clips);

    expect(result.totalRuntimeSec).toBe(250);
    expect(result.severity).toBe("warning");
  });

  it("빈 배치 → ok", () => {
    const result = checkBatchBudget([]);
    expect(result.totalRuntimeSec).toBe(0);
    expect(result.withinBudget).toBe(true);
    expect(result.severity).toBe("ok");
  });

  it("50+ 클립 → MAX_CLIPS 경고", () => {
    const clips: BatchClipInfo[] = Array.from({ length: 55 }, (_, i) => ({
      id: i,
      durationSec: 3,
    }));

    const result = checkBatchBudget(clips);

    // 55 × 3s = 165s < 300s → withinBudget
    expect(result.withinBudget).toBe(true);
    // 하지만 클립 수 경고
    const clipWarning = result.suggestions.find(s => s.includes("이하 권장"));
    expect(clipWarning).toBeDefined();
  });

  it("정확히 300s → withinBudget", () => {
    const clips: BatchClipInfo[] = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      durationSec: 10,
    }));

    const result = checkBatchBudget(clips);
    expect(result.totalRuntimeSec).toBe(300);
    expect(result.withinBudget).toBe(true);
  });

  it("usageRatio 정확성", () => {
    const clips: BatchClipInfo[] = [{ id: 0, durationSec: 150 }];
    const result = checkBatchBudget(clips);
    expect(result.usageRatio).toBeCloseTo(0.5, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// suggestBatchSplit
// ═══════════════════════════════════════════════════════════════════

describe("suggestBatchSplit", () => {
  it("360s → 2개 배치로 분할", () => {
    const clips: BatchClipInfo[] = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      durationSec: 12,
    }));

    const split = suggestBatchSplit(clips);

    expect(split.batchCount).toBe(2);
    expect(split.batches.length).toBe(2);

    // 각 배치가 300s 이하
    for (const batch of split.batches) {
      expect(batch.totalSec).toBeLessThanOrEqual(BATCH_BUDGET_SECONDS);
    }

    // 총 클립 수 보존
    const totalClips = split.batches.reduce((s, b) => s + b.clips.length, 0);
    expect(totalClips).toBe(30);
  });

  it("예산 내 → 1개 배치", () => {
    const clips: BatchClipInfo[] = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      durationSec: 10,
    }));

    const split = suggestBatchSplit(clips);
    expect(split.batchCount).toBe(1);
  });

  it("빈 입력 → 0개 배치", () => {
    const split = suggestBatchSplit([]);
    expect(split.batchCount).toBe(0);
  });

  it("대형 배치 600s → 2+ 배치", () => {
    const clips: BatchClipInfo[] = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      durationSec: 12,
    }));

    const split = suggestBatchSplit(clips);
    expect(split.batchCount).toBeGreaterThanOrEqual(2);

    // 모든 배치가 예산 이하
    for (const batch of split.batches) {
      expect(batch.totalSec).toBeLessThanOrEqual(BATCH_BUDGET_SECONDS);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

describe("constants", () => {
  it("BATCH_BUDGET_SECONDS = 300", () => {
    expect(BATCH_BUDGET_SECONDS).toBe(300);
  });

  it("BUDGET_WARNING_RATIO = 0.8", () => {
    expect(BUDGET_WARNING_RATIO).toBe(0.8);
  });

  it("MAX_CLIPS_PER_BATCH = 50", () => {
    expect(MAX_CLIPS_PER_BATCH).toBe(50);
  });
});
