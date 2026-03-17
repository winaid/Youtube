/**
 * preflight-validation.ts — 생성 직전 통합 프리플라이트 검사
 *
 * 모든 생성 조건을 한 곳에서 검사하고,
 * blocking / warning / info로 분류해서 UI에 요약 표시.
 *
 * source of truth:
 *   - multiShot: canonical-first (effectiveMultiShot)
 *   - duration: canonical-first (effectiveDurationSec)
 *   - style tier: style-capability-matrix
 *   - model limits: kling-capability
 *   - budget: batch-runtime-budget
 *
 * 사용처:
 *   - VideoGenerationPanel: "전체 자동 생성" 버튼 근처
 */

import type { Cut, MultiShotPrompt } from "@/types";
import { getMaxShots, getCapability } from "@/lib/kling-capability";
import {
  getStyleCapability, getStyleUiState, resolveGenerationStyle,
  getTierDescriptionKo,
  type StyleSupportTier,
} from "@/lib/style-capability-matrix";
import {
  BATCH_BUDGET_SECONDS,
  type BatchClipInfo,
  checkBatchBudget,
} from "@/lib/batch-runtime-budget";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type PreflightSeverity = "blocking" | "warning" | "info";

export interface PreflightIssue {
  severity: PreflightSeverity;
  messageKo: string;
  /** 문제가 있는 컷 번호 (없으면 전체 문제) */
  cutNumber?: number;
}

export interface PreflightResult {
  canGenerate: boolean;
  issues: PreflightIssue[];
  blockingCount: number;
  warningCount: number;
  infoCount: number;
}

// ═══════════════════════════════════════════════════════════════════
// Input
// ═══════════════════════════════════════════════════════════════════

export interface PreflightInput {
  cuts: Cut[];
  /** Canonical multiShot per cut — Map<cutNumber, MultiShotPrompt[]> */
  canonicalMultiShots: Map<number, MultiShotPrompt[]>;
  /** Canonical durationSec per cut — Map<cutNumber, number> */
  canonicalDurations: Map<number, number>;
  /** 선택된 스타일 ID */
  styleId: string;
  /** 사용 중인 모델 ID */
  modelId: string;
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

export function runPreflightValidation(input: PreflightInput): PreflightResult {
  const issues: PreflightIssue[] = [];

  // ── 1. 컷 존재 검사 ──
  if (input.cuts.length === 0) {
    issues.push({ severity: "blocking", messageKo: "생성할 컷이 없습니다." });
  }

  // ── 2. 스타일 검사 ──
  checkStyle(input, issues);

  // ── 3. 컷별 검사 ──
  for (const cut of input.cuts) {
    checkCut(cut, input, issues);
  }

  // ── 4. 배치 예산 검사 ──
  checkBudget(input, issues);

  const blockingCount = issues.filter(i => i.severity === "blocking").length;
  const warningCount = issues.filter(i => i.severity === "warning").length;
  const infoCount = issues.filter(i => i.severity === "info").length;

  return {
    canGenerate: blockingCount === 0,
    issues,
    blockingCount,
    warningCount,
    infoCount,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Internal checks
// ═══════════════════════════════════════════════════════════════════

function checkStyle(input: PreflightInput, issues: PreflightIssue[]) {
  const { styleId } = input;
  const cap = getStyleCapability(styleId);
  const uiState = getStyleUiState(styleId);
  const resolution = resolveGenerationStyle(styleId);

  // temporarily-hidden → 생성 불가
  if (!resolution.canGenerate) {
    issues.push({
      severity: "blocking",
      messageKo: resolution.preGenerationNoticeKo ?? "이 스타일은 현재 생성할 수 없습니다.",
    });
    return;
  }

  // tier별 안내
  const tierMap: Partial<Record<StyleSupportTier, { severity: PreflightSeverity; msg: string }>> = {
    "supported-with-warning": {
      severity: "warning",
      msg: "선택한 스타일은 장면에 따라 품질 편차가 있을 수 있습니다.",
    },
    "beta-supported": {
      severity: "warning",
      msg: "실험적 스타일입니다. 결과가 기대와 다를 수 있습니다.",
    },
    "postprocess-required": {
      severity: "warning",
      msg: "현재 근사 생성 방식입니다. 정확한 스타일 표현에는 후처리가 필요합니다.",
    },
    "pipeline-upgrade-required": {
      severity: "warning",
      msg: "유사 스타일로 대체 생성됩니다. 합성 파이프라인 도입 후 정확도가 개선됩니다.",
    },
    "gated": {
      severity: "info",
      msg: "조건부 스타일입니다. 특정 설정이 자동 적용됩니다.",
    },
  };

  const tierInfo = tierMap[cap.tier];
  if (tierInfo) {
    issues.push({ severity: tierInfo.severity, messageKo: tierInfo.msg });
  }

  // fallback 적용 시 안내
  if (resolution.wasFalledBack) {
    issues.push({
      severity: "info",
      messageKo: `실제 생성은 '${resolution.resolvedStyleId.replace(/-/g, " ")}' 스타일 기반으로 진행됩니다.`,
    });
  }
}

function checkCut(cut: Cut, input: PreflightInput, issues: PreflightIssue[]) {
  const cutNum = cut.cutNumber;
  const duration = input.canonicalDurations.get(cutNum) ?? cut.durationSec;
  const multiShot = input.canonicalMultiShots.get(cutNum) ?? cut.multiShot ?? [];
  const modelCap = getCapability(input.modelId);

  // ── duration 범위 ──
  if (duration < modelCap.minDuration) {
    issues.push({
      severity: "blocking",
      messageKo: `CUT ${cutNum}: ${duration}초 — 최소 ${modelCap.minDuration}초 이상 필요합니다.`,
      cutNumber: cutNum,
    });
  }
  if (duration > modelCap.maxDuration) {
    issues.push({
      severity: "blocking",
      messageKo: `CUT ${cutNum}: ${duration}초 — 최대 ${modelCap.maxDuration}초를 초과합니다.`,
      cutNumber: cutNum,
    });
  }

  // ── 프롬프트 존재 ──
  const hasPrompt = (cut.videoPrompt && cut.videoPrompt.trim().length > 0) ||
    (cut.sceneDescription && cut.sceneDescription.trim().length > 0);
  if (!hasPrompt) {
    issues.push({
      severity: "blocking",
      messageKo: `CUT ${cutNum}: 프롬프트 또는 장면 설명이 비어 있습니다.`,
      cutNumber: cutNum,
    });
  }

  // ── 멀티샷 검사 ──
  if (multiShot.length > 0) {
    const maxShots = getMaxShots(input.modelId, duration);

    // 샷 수 초과
    if (multiShot.length > maxShots && maxShots > 0) {
      issues.push({
        severity: "blocking",
        messageKo: `CUT ${cutNum}: 샷 ${multiShot.length}개 — 최대 ${maxShots}개 (${duration}초 기준)`,
        cutNumber: cutNum,
      });
    }

    // 빈 프롬프트 샷
    const emptyShots = multiShot.filter(s => !s.prompt || s.prompt.trim().length === 0);
    if (emptyShots.length > 0) {
      issues.push({
        severity: "warning",
        messageKo: `CUT ${cutNum}: 샷 ${emptyShots.map(s => s.index).join(",")}의 프롬프트가 비어 있습니다.`,
        cutNumber: cutNum,
      });
    }

    // duration 합계 불일치
    const durationSum = multiShot.reduce((sum, s) => sum + (parseFloat(s.duration) || 0), 0);
    if (Math.abs(durationSum - duration) > 1) {
      issues.push({
        severity: "warning",
        messageKo: `CUT ${cutNum}: 샷 시간 합계 ${durationSum}초 ≠ 전체 ${duration}초`,
        cutNumber: cutNum,
      });
    }
  }
}

function checkBudget(input: PreflightInput, issues: PreflightIssue[]) {
  const batchClips: BatchClipInfo[] = input.cuts.map(c => ({
    id: c.cutNumber,
    durationSec: input.canonicalDurations.get(c.cutNumber) ?? c.durationSec,
    shotCount: (input.canonicalMultiShots.get(c.cutNumber) ?? c.multiShot)?.length,
  }));

  const budget = checkBatchBudget(batchClips);

  if (!budget.withinBudget) {
    issues.push({
      severity: "warning",
      messageKo: `총 ${budget.totalRuntimeSec}초 — 배치 예산 ${BATCH_BUDGET_SECONDS}초 초과 (+${budget.overBudgetSec}초). 생성 시간이 길어질 수 있습니다.`,
    });
  }
}
