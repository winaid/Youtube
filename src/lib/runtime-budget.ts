/**
 * runtime-budget.ts — 배치 런타임 예산 관리
 *
 * 핵심 목적:
 *   1. 배치 전체의 총 런타임 예산 계산
 *   2. 예산 초과 시 조치 방안 제안
 *   3. 클립별 런타임 배분 최적화
 *
 * 기본 예산: 300초
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ClipBudgetEntry {
  clipId: string;
  label: string;
  shotCount: number;
  totalDurationSec: number;
  priority: "high" | "normal" | "low";
}

export interface RuntimeBudgetSummary {
  totalClips: number;
  totalPlannedSec: number;
  averageSecPerClip: number;
  budgetLimitSec: number;
  remainingSec: number;
  overBudget: boolean;
  overBudgetSec: number;
  utilizationPercent: number;
}

export interface BudgetAction {
  type: "reduce_duration" | "reduce_shots" | "split_batch" | "defer_low_priority";
  label: string;
  description: string;
  savingsSec: number;
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

export const DEFAULT_BUDGET_LIMIT_SEC = 300;
export const MIN_CLIP_DURATION_SEC = 3;
export const MAX_CLIP_DURATION_SEC = 15;

// ═══════════════════════════════════════════════════════════════════
// Budget Calculation
// ═══════════════════════════════════════════════════════════════════

export function calculateBudgetSummary(
  entries: ClipBudgetEntry[],
  budgetLimitSec: number = DEFAULT_BUDGET_LIMIT_SEC,
): RuntimeBudgetSummary {
  const totalClips = entries.length;
  const totalPlannedSec = entries.reduce((sum, e) => sum + e.totalDurationSec, 0);
  const averageSecPerClip = totalClips > 0 ? totalPlannedSec / totalClips : 0;
  const remainingSec = budgetLimitSec - totalPlannedSec;
  const overBudget = totalPlannedSec > budgetLimitSec;
  const overBudgetSec = overBudget ? totalPlannedSec - budgetLimitSec : 0;
  const utilizationPercent = budgetLimitSec > 0 ? Math.round((totalPlannedSec / budgetLimitSec) * 100) : 0;

  return {
    totalClips,
    totalPlannedSec,
    averageSecPerClip: Math.round(averageSecPerClip * 10) / 10,
    budgetLimitSec,
    remainingSec,
    overBudget,
    overBudgetSec,
    utilizationPercent,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Budget Actions
// ═══════════════════════════════════════════════════════════════════

export function suggestBudgetActions(
  entries: ClipBudgetEntry[],
  summary: RuntimeBudgetSummary,
): BudgetAction[] {
  if (!summary.overBudget) return [];

  const actions: BudgetAction[] = [];
  const overSec = summary.overBudgetSec;

  const longClips = entries.filter(e => e.totalDurationSec > 10);
  if (longClips.length > 0) {
    const potentialSavings = longClips.reduce((sum, e) => sum + (e.totalDurationSec - 8), 0);
    actions.push({
      type: "reduce_duration",
      label: "클립 길이 단축",
      description: `${longClips.length}개 클립의 길이를 8초로 줄이면 ${Math.round(potentialSavings)}초 절약`,
      savingsSec: Math.round(potentialSavings),
    });
  }

  const multiShotClips = entries.filter(e => e.shotCount > 3);
  if (multiShotClips.length > 0) {
    const potentialSavings = multiShotClips.reduce((sum, e) => {
      const reducedDuration = Math.max(MIN_CLIP_DURATION_SEC, e.totalDurationSec * (3 / e.shotCount));
      return sum + (e.totalDurationSec - reducedDuration);
    }, 0);
    actions.push({
      type: "reduce_shots",
      label: "샷 수 줄이기",
      description: `${multiShotClips.length}개 클립의 샷 수를 3개로 줄이면 약 ${Math.round(potentialSavings)}초 절약`,
      savingsSec: Math.round(potentialSavings),
    });
  }

  if (summary.totalClips > 10) {
    const batchSize = Math.ceil(summary.totalClips / 2);
    const halfDuration = Math.round(summary.totalPlannedSec / 2);
    actions.push({
      type: "split_batch",
      label: "배치 분할",
      description: `${batchSize}개씩 2개 배치로 나누면 배치당 약 ${halfDuration}초`,
      savingsSec: Math.round(overSec),
    });
  }

  const lowPriorityClips = entries.filter(e => e.priority === "low");
  if (lowPriorityClips.length > 0) {
    const savings = lowPriorityClips.reduce((sum, e) => sum + e.totalDurationSec, 0);
    actions.push({
      type: "defer_low_priority",
      label: "낮은 우선순위 연기",
      description: `${lowPriorityClips.length}개 클립을 다음 배치로 연기하면 ${Math.round(savings)}초 절약`,
      savingsSec: Math.round(savings),
    });
  }

  return actions.sort((a, b) => b.savingsSec - a.savingsSec);
}

// ═══════════════════════════════════════════════════════════════════
// Budget Status
// ═══════════════════════════════════════════════════════════════════

export type BudgetStatus = "under" | "warning" | "over";

export function getBudgetStatus(summary: RuntimeBudgetSummary): BudgetStatus {
  if (summary.overBudget) return "over";
  if (summary.utilizationPercent >= 85) return "warning";
  return "under";
}

export function getBudgetStatusColor(status: BudgetStatus): { text: string; bg: string; border: string } {
  switch (status) {
    case "under":   return { text: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" };
    case "warning": return { text: "#ca8a04", bg: "#fefce8", border: "#fde68a" };
    case "over":    return { text: "#dc2626", bg: "#fef2f2", border: "#fecaca" };
  }
}
