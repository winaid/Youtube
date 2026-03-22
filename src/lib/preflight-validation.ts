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
 *   - model limits: veo-capability
 *   - budget: batch-runtime-budget
 *   - sequence structure: shortform band policy
 *
 * 사용처:
 *   - VideoGenerationPanel: "전체 자동 생성" 버튼 근처
 */

import type { Cut, MultiShotPrompt } from "@/types";
import { getCapability } from "@/lib/veo-capability";
// VEO 정책: 8초 4샷 고정
const getMaxShots = (_modelId: string, _durationSec: number) => 4;
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

/** 구조화된 에러 코드 — 프로그래밍적 판별용 */
export type PreflightErrorCode =
  | "no_cuts"
  | "style_blocked"
  | "cut_duration_too_short"
  | "cut_duration_too_long"
  | "cut_no_prompt"
  | "cut_too_many_shots"
  | "cut_empty_shot_prompt"
  | "cut_shot_duration_mismatch"
  | "total_duration_exceeded"
  | "cut_count_too_low"
  | "cut_count_too_high"
  | "invalid_duration_structure"
  | "duration_band_not_supported"
  | "budget_exceeded"
  | "style_warning"
  | "style_info";

export interface PreflightIssue {
  severity: PreflightSeverity;
  messageKo: string;
  /** 문제가 있는 컷 번호 (없으면 전체 문제) */
  cutNumber?: number;
  /** 에러 코드 */
  code?: PreflightErrorCode;
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
// Shortform 시퀀스 구조 규칙
// 프론트/서버 동일 정책 — source of truth: functions/api/_shortform-rhythm.ts
//
// 확정 규칙 (2026-03):
//   ≤5초: micro (1컷)
//   6~9초: short (최소 3컷)
//   10~15초: shortform-critical (4~6컷 필수)
//   16~60초: mid-form (extend 체인, 컷당 8초)
//   61~120초: long-form-shorts (extend 체인, 최대 ~15 세그먼트)
//   121초+: 생성 불가
// ═══════════════════════════════════════════════════════════════════

/** 총 길이 상한 — 멀티 체인으로 10분까지 지원. 단일 체인 최대 ~141초. */
export const SEQUENCE_MAX_TOTAL_DURATION = 600;

export interface SequenceBandRule {
  band: "micro" | "short" | "shortform-critical" | "mid-form" | "long-form-shorts" | "over-limit";
  minCuts: number;
  maxCuts: number;
  maxSecPerCut: number;
  /** 이 밴드에서 생성이 가능한지 */
  supported: boolean;
}

/**
 * 총 길이 기반 시퀀스 구조 규칙 반환.
 */
export function getSequenceBandRule(totalDurationSec: number): SequenceBandRule {
  if (totalDurationSec <= 5)
    return { band: "micro", minCuts: 1, maxCuts: 2, maxSecPerCut: 5, supported: true };
  if (totalDurationSec <= 9)
    return { band: "short", minCuts: 3, maxCuts: 6, maxSecPerCut: totalDurationSec, supported: true };
  if (totalDurationSec <= 15)
    return { band: "shortform-critical", minCuts: 4, maxCuts: 6, maxSecPerCut: 4, supported: true };
  if (totalDurationSec <= 60)
    return { band: "mid-form", minCuts: Math.ceil(totalDurationSec / 8), maxCuts: Math.ceil(totalDurationSec / 6), maxSecPerCut: 8, supported: true };
  if (totalDurationSec <= 600)
    return { band: "long-form-shorts", minCuts: Math.ceil(totalDurationSec / 8), maxCuts: Math.ceil(totalDurationSec / 6), maxSecPerCut: 8, supported: true };
  // 601초+: 10분 초과
  return { band: "over-limit", minCuts: 0, maxCuts: 0, maxSecPerCut: 0, supported: false };
}

// ═══════════════════════════════════════════════════════════════════
// Display title helper — 생성 카드용 내용 기반 제목
// ═══════════════════════════════════════════════════════════════════

/**
 * 컷의 내용 기반 표시 제목을 생성.
 * 번호가 아닌 장면 내용을 우선 표시.
 *
 * 우선순위:
 * 1. sceneDescription (장면 설명) — 첫 문장 또는 앞부분
 * 2. videoPrompt 앞부분 (영문일 수 있음)
 * 3. multiShot 첫 샷의 prompt 앞부분
 * 4. fallback: "장면 N"
 */
export function getCutDisplayTitle(
  cut: Cut,
  canonicalMultiShots?: Map<number, MultiShotPrompt[]>,
  maxLength: number = 30,
): string {
  // 1순위: sceneDescription
  if (cut.sceneDescription && cut.sceneDescription.trim().length > 0) {
    return truncateTitle(cut.sceneDescription.trim(), maxLength);
  }

  // 2순위: videoPrompt
  if (cut.videoPrompt && cut.videoPrompt.trim().length > 0) {
    return truncateTitle(cut.videoPrompt.trim(), maxLength);
  }

  // 3순위: multiShot 첫 샷 prompt
  const shots = canonicalMultiShots?.get(cut.cutNumber) ?? cut.multiShot ?? [];
  if (shots.length > 0 && shots[0].prompt && shots[0].prompt.trim().length > 0) {
    return truncateTitle(shots[0].prompt.trim(), maxLength);
  }

  // 4순위 (최종 fallback): 장면 번호
  return `장면 ${cut.cutNumber}`;
}

/**
 * 보조 정보 라인 생성.
 * 예: "시퀀스 1 · 2샷 · 8초"
 */
export function getCutSubInfo(
  cut: Cut,
  canonicalMultiShots?: Map<number, MultiShotPrompt[]>,
  canonicalDurations?: Map<number, number>,
): string {
  const duration = canonicalDurations?.get(cut.cutNumber) ?? cut.durationSec;
  const shots = canonicalMultiShots?.get(cut.cutNumber) ?? cut.multiShot ?? [];
  const shotInfo = shots.length > 1 ? `${shots.length}샷` : cut.intentionalOneTake ? "원테이크" : "1샷";
  return `시퀀스 ${cut.cutNumber} · ${shotInfo} · ${duration}초`;
}

function truncateTitle(text: string, maxLength: number): string {
  // 첫 문장만 추출 (마침표, 느낌표, 물음표, 줄바꿈)
  const firstSentence = text.split(/[.!?\n]/)[0].trim();
  const source = firstSentence.length > 0 ? firstSentence : text;
  if (source.length <= maxLength) return source;
  return source.slice(0, maxLength - 1) + "…";
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

export function runPreflightValidation(input: PreflightInput): PreflightResult {
  const issues: PreflightIssue[] = [];

  // ── 1. 컷 존재 검사 ──
  if (input.cuts.length === 0) {
    issues.push({ severity: "blocking", messageKo: "생성할 시퀀스가 없습니다.", code: "no_cuts" });
  }

  // ── 2. 스타일 검사 ──
  checkStyle(input, issues);

  // ── 3. 시퀀스 구조 검사 (15초 규칙 등) ──
  checkSequenceStructure(input, issues);

  // ── 4. 컷별 검사 ──
  for (const cut of input.cuts) {
    checkCut(cut, input, issues);
  }

  // ── 5. 배치 예산 검사 ──
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

// ═══════════════════════════════════════════════════════════════════
// Sequence structure validation — 총 길이 + 컷 수 규칙
// ═══════════════════════════════════════════════════════════════════

function checkSequenceStructure(input: PreflightInput, issues: PreflightIssue[]) {
  if (input.cuts.length === 0) return;

  const cutCount = input.cuts.length;

  // 총 길이 계산
  const totalDuration = input.cuts.reduce((sum, cut) => {
    return sum + (input.canonicalDurations.get(cut.cutNumber) ?? cut.durationSec);
  }, 0);

  // ── multi-segment 콘텐츠 (총 런타임 > 15초) ──
  // band 규칙은 개별 컷 단위. 총 런타임이 15초를 넘으면
  // 여러 개의 VEO 세그먼트로 구성된 콘텐츠이므로 band 규칙 적용 안 함.
  // 개별 컷의 duration 상한(15초)은 checkCut의 cut_duration_too_long이 처리.
  if (totalDuration > SEQUENCE_MAX_TOTAL_DURATION) {
    return;
  }

  const bandRule = getSequenceBandRule(totalDuration);

  // 밴드별 라벨
  const bandLabel = bandRule.band === "short"
    ? `6~9초 영상`
    : bandRule.band === "shortform-critical"
      ? `10~15초 영상`
      : `${totalDuration}초 영상`;

  // ── 컷 수 하한 ──
  if (cutCount < bandRule.minCuts) {
    issues.push({
      severity: "blocking",
      code: "cut_count_too_low",
      messageKo: bandRule.band === "shortform-critical"
        ? `${bandLabel}은 ${bandRule.minCuts}~${bandRule.maxCuts}개 시퀀스로 구성해야 합니다. 현재 ${cutCount}개라 생성할 수 없습니다. 시퀀스를 추가해 주세요.`
        : bandRule.band === "short"
          ? `${bandLabel}은 최소 ${bandRule.minCuts}개 시퀀스 이상이어야 합니다. 현재 ${cutCount}개라 생성할 수 없습니다. 시퀀스를 추가해 주세요.`
          : `${bandLabel}은 최소 ${bandRule.minCuts}개 시퀀스가 필요합니다. 현재 ${cutCount}개입니다.`,
    });
  }

  // ── 컷 수 상한 ──
  if (cutCount > bandRule.maxCuts) {
    const isHardLimit = bandRule.band === "shortform-critical";
    issues.push({
      severity: isHardLimit ? "blocking" : "warning",
      code: "cut_count_too_high",
      messageKo: isHardLimit
        ? `${bandLabel}은 ${bandRule.minCuts}~${bandRule.maxCuts}개 시퀀스로 구성해야 합니다. 현재 ${cutCount}개라 너무 많습니다. ${bandRule.maxCuts}개 이하로 줄여 주세요.`
        : `${bandLabel}에 ${cutCount}개 시퀀스는 권장 상한(${bandRule.maxCuts}개)을 초과합니다. 시퀀스를 줄이는 것을 권장합니다.`,
    });
  }

  // ── 개별 컷이 밴드 maxSecPerCut 초과 (shortform-critical에서만 강제) ──
  if (bandRule.band === "shortform-critical") {
    for (const cut of input.cuts) {
      const duration = input.canonicalDurations.get(cut.cutNumber) ?? cut.durationSec;
      if (duration > bandRule.maxSecPerCut) {
        issues.push({
          severity: "blocking",
          code: "invalid_duration_structure",
          messageKo: `시퀀스 ${cut.cutNumber}: ${duration}초 — ${bandLabel}에서는 시퀀스당 최대 ${bandRule.maxSecPerCut}초입니다. 길이를 줄여 주세요.`,
          cutNumber: cut.cutNumber,
        });
      }
    }
  }
}

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

  // ── duration 범위 (VEO: supportedDurations 기반) ──
  const supported = modelCap.supportedDurations;
  const minDuration = Math.min(...supported);
  const maxDuration = Math.max(...supported);
  if (duration < minDuration) {
    issues.push({
      severity: "blocking",
      code: "cut_duration_too_short",
      messageKo: `시퀀스 ${cutNum}: ${duration}초 — 최소 ${minDuration}초 이상 필요합니다.`,
      cutNumber: cutNum,
    });
  }
  if (duration > maxDuration) {
    issues.push({
      severity: "blocking",
      code: "cut_duration_too_long",
      messageKo: `시퀀스 ${cutNum}: ${duration}초 — 최대 ${maxDuration}초를 초과합니다.`,
      cutNumber: cutNum,
    });
  }

  // ── 프롬프트 존재 ──
  const hasPrompt = (cut.videoPrompt && cut.videoPrompt.trim().length > 0) ||
    (cut.sceneDescription && cut.sceneDescription.trim().length > 0);
  if (!hasPrompt) {
    issues.push({
      severity: "blocking",
      code: "cut_no_prompt",
      messageKo: `시퀀스 ${cutNum}: 프롬프트 또는 장면 설명이 비어 있습니다.`,
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
        code: "cut_too_many_shots",
        messageKo: `시퀀스 ${cutNum}: 샷 ${multiShot.length}개 — 최대 ${maxShots}개 (${duration}초 기준)`,
        cutNumber: cutNum,
      });
    }

    // 빈 프롬프트 샷
    const emptyShots = multiShot.filter(s => !s.prompt || s.prompt.trim().length === 0);
    if (emptyShots.length > 0) {
      issues.push({
        severity: "warning",
        code: "cut_empty_shot_prompt",
        messageKo: `시퀀스 ${cutNum}: 샷 ${emptyShots.map(s => s.index).join(",")}의 프롬프트가 비어 있습니다.`,
        cutNumber: cutNum,
      });
    }

    // duration 합계 불일치
    const durationSum = multiShot.reduce((sum, s) => sum + (parseFloat(s.duration) || 0), 0);
    if (Math.abs(durationSum - duration) > 1) {
      issues.push({
        severity: "warning",
        code: "cut_shot_duration_mismatch",
        messageKo: `시퀀스 ${cutNum}: 샷 시간 합계 ${durationSum}초 ≠ 전체 ${duration}초`,
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
