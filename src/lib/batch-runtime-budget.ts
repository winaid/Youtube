/**
 * batch-runtime-budget.ts — 배치 런타임 예산 관리
 *
 * 핵심 역할:
 *   1. 배치 전체 runtime 합산
 *   2. 300초(5분) 예산 기준 초과 감지
 *   3. 예산 초과 시 경고 + 감축/분할 제안
 *   4. 배치 분할 추천
 *
 * 이 모듈은 production throughput의 핵심 제약.
 * 300초를 넘으면 반드시 사용자에게 알려야 함.
 *
 * grep: BATCH_BUDGET_SECONDS, calculateBatchRuntime, checkBatchBudget,
 *       suggestBatchSplit, BatchBudgetResult
 */

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

/** 배치 런타임 예산 (초) — 5분 */
export const BATCH_BUDGET_SECONDS = 300;

/** 경고 시작 비율 (예산의 80%) */
export const BUDGET_WARNING_RATIO = 0.8;

/** 단일 배치 최대 클립 수 (성능 가이드) */
export const MAX_CLIPS_PER_BATCH = 50;

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface BatchClipInfo {
  /** 클립 식별자 (cut index 등) */
  id: string | number;
  /** 클립 duration (초) */
  durationSec: number;
  /** 멀티샷 수 (있으면) */
  shotCount?: number;
}

export interface BatchBudgetResult {
  /** 총 runtime (초) */
  totalRuntimeSec: number;
  /** 클립 수 */
  clipCount: number;
  /** 예산 내 여부 */
  withinBudget: boolean;
  /** 예산 초과량 (초, 0 이상) */
  overBudgetSec: number;
  /** 예산 사용률 (0~1+) */
  usageRatio: number;
  /** 경고 수준 */
  severity: "ok" | "warning" | "over_budget";
  /** 사용자 메시지 */
  message: string;
  /** 제안 사항 */
  suggestions: string[];
}

export interface BatchSplitSuggestion {
  /** 분할된 배치 수 */
  batchCount: number;
  /** 각 배치의 클립 인덱스 그룹 */
  batches: Array<{
    clips: BatchClipInfo[];
    totalSec: number;
  }>;
  /** 설명 */
  description: string;
}

// ═══════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * 배치 전체 runtime 계산 및 예산 검사.
 */
export function checkBatchBudget(clips: BatchClipInfo[]): BatchBudgetResult {
  const totalRuntimeSec = clips.reduce((sum, c) => sum + c.durationSec, 0);
  const clipCount = clips.length;
  const overBudgetSec = Math.max(0, totalRuntimeSec - BATCH_BUDGET_SECONDS);
  const usageRatio = BATCH_BUDGET_SECONDS > 0 ? totalRuntimeSec / BATCH_BUDGET_SECONDS : 0;

  let severity: BatchBudgetResult["severity"];
  let message: string;
  const suggestions: string[] = [];

  if (totalRuntimeSec <= BATCH_BUDGET_SECONDS * BUDGET_WARNING_RATIO) {
    severity = "ok";
    message = `총 ${totalRuntimeSec}초 / ${BATCH_BUDGET_SECONDS}초 예산 (${Math.round(usageRatio * 100)}%)`;
  } else if (totalRuntimeSec <= BATCH_BUDGET_SECONDS) {
    severity = "warning";
    message = `총 ${totalRuntimeSec}초 — 예산 ${BATCH_BUDGET_SECONDS}초에 근접 (${Math.round(usageRatio * 100)}%)`;
    suggestions.push("클립 duration 줄이기 또는 클립 수 감소 고려");
  } else {
    severity = "over_budget";
    message = `총 ${totalRuntimeSec}초 — 예산 ${BATCH_BUDGET_SECONDS}초 초과 (+${overBudgetSec}초)`;

    // 구체적 감축 제안
    const avgDuration = clipCount > 0 ? totalRuntimeSec / clipCount : 0;
    const targetClips = avgDuration > 0 ? Math.floor(BATCH_BUDGET_SECONDS / avgDuration) : clipCount;

    if (clipCount > targetClips) {
      suggestions.push(
        `클립 수를 ${clipCount}개 → ${targetClips}개로 줄이면 예산 내 (평균 ${Math.round(avgDuration)}초/클립 기준)`,
      );
    }

    // 배치 분할 제안
    const splitCount = Math.ceil(totalRuntimeSec / BATCH_BUDGET_SECONDS);
    suggestions.push(
      `${splitCount}개 배치로 분할 추천 (배치당 ~${Math.ceil(clipCount / splitCount)}클립)`,
    );

    // duration 줄이기 제안
    if (clipCount > 0) {
      const targetDuration = Math.floor(BATCH_BUDGET_SECONDS / clipCount);
      if (targetDuration >= 3) {
        suggestions.push(
          `클립당 duration을 ${targetDuration}초로 줄이면 예산 내`,
        );
      }
    }
  }

  // 클립 수 경고
  if (clipCount > MAX_CLIPS_PER_BATCH) {
    suggestions.push(
      `클립 수 ${clipCount}개 — 배치당 ${MAX_CLIPS_PER_BATCH}개 이하 권장`,
    );
  }

  return {
    totalRuntimeSec,
    clipCount,
    withinBudget: totalRuntimeSec <= BATCH_BUDGET_SECONDS,
    overBudgetSec,
    usageRatio,
    severity,
    message,
    suggestions,
  };
}

/**
 * 예산 초과 시 배치 분할 제안.
 *
 * Greedy 방식: 각 배치를 예산까지 채우고 다음 배치로.
 */
export function suggestBatchSplit(clips: BatchClipInfo[]): BatchSplitSuggestion {
  if (clips.length === 0) {
    return { batchCount: 0, batches: [], description: "클립 없음" };
  }

  const batches: Array<{ clips: BatchClipInfo[]; totalSec: number }> = [];
  let currentBatch: BatchClipInfo[] = [];
  let currentTotal = 0;

  for (const clip of clips) {
    if (currentTotal + clip.durationSec > BATCH_BUDGET_SECONDS && currentBatch.length > 0) {
      batches.push({ clips: [...currentBatch], totalSec: currentTotal });
      currentBatch = [];
      currentTotal = 0;
    }
    currentBatch.push(clip);
    currentTotal += clip.durationSec;
  }

  if (currentBatch.length > 0) {
    batches.push({ clips: currentBatch, totalSec: currentTotal });
  }

  return {
    batchCount: batches.length,
    batches,
    description: batches.length <= 1
      ? "분할 불필요"
      : `${batches.length}개 배치로 분할 — ${batches.map((b, i) => `배치${i + 1}: ${b.clips.length}클립/${b.totalSec}초`).join(", ")}`,
  };
}
