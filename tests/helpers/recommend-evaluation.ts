/**
 * recommend-evaluation.ts — 감독 추천 품질 평가 harness
 *
 * 목적:
 * - golden case 입력 → 추천 결과 핵심 신호를 구조적으로 추출
 * - 기계적 체크 항목 + 사람 리뷰 항목을 분리
 * - 무거운 e2e 없이 파이프라인 품질을 반복 평가
 */

import type { RecommendGoldenCase, RecommendExpectedProfile } from "../fixtures/recommend-director-golden";

// ═══════════════════════════════════════════════════════════════════
// 1. Stage Status Types (서버 DirectorRecommendationDebug 미러)
// ═══════════════════════════════════════════════════════════════════

export type ExtractSignalsStatus = "ok" | "weak" | "failed";
export type LocalMatchStatus = "ok" | "empty" | "invalid_ids" | "filtered_out" | "failed";
export type WebSearchStatus = "not_attempted" | "attempted_success" | "attempted_empty" | "failed";
export type FinalAssemblyStatus = "ok" | "empty" | "failed";

export interface StageStatusSummary {
  extractSignals: ExtractSignalsStatus;
  localMatch: LocalMatchStatus;
  webSearch: WebSearchStatus;
  finalAssembly: FinalAssemblyStatus;
}

// ═══════════════════════════════════════════════════════════════════
// 2. Evaluation Summary — 하나의 golden case 실행 결과 요약
// ═══════════════════════════════════════════════════════════════════

export interface EvaluationSummary {
  caseId: string;
  inputStoryLength: number;
  stageStatus: StageStatusSummary;
  attemptedWebSearch: boolean;
  webSearchQuery: string | null;
  localResultCount: number;
  externalResultCount: number;
  finalResultCount: number;
  emptyReason: string | null;
  groundingSourceCount: number;
  returnedDirectorNames: string[];
  extractedGenres: string[];
  extractedMoods: string[];
  notes: string;
}

/**
 * API 응답 _debug에서 EvaluationSummary를 추출
 */
export function extractEvaluationSummary(
  caseId: string,
  storyText: string,
  apiResponse: Record<string, unknown>,
): EvaluationSummary {
  const debug = (apiResponse._debug ?? {}) as Record<string, unknown>;
  const stageStatus = (debug.stageStatus ?? {
    extractSignals: "failed",
    localMatch: "failed",
    webSearch: "not_attempted",
    finalAssembly: "failed",
  }) as StageStatusSummary;

  const localMatches = Array.isArray(apiResponse.localMatches) ? apiResponse.localMatches as Record<string, unknown>[] : [];
  const webSuggestions = Array.isArray(apiResponse.webSuggestions) ? apiResponse.webSuggestions as Record<string, unknown>[] : [];

  const directorNames = [
    ...localMatches.map(m => String(m.nameKo || m.name || m.id)),
    ...webSuggestions.map(s => String(s.nameKo || s.name || s.id)),
  ];

  return {
    caseId,
    inputStoryLength: storyText.length,
    stageStatus,
    attemptedWebSearch: !!debug.attemptedWebSearch,
    webSearchQuery: (debug.webSearchQuery as string) ?? null,
    localResultCount: typeof debug.localResultCount === "number" ? debug.localResultCount : localMatches.length,
    externalResultCount: typeof debug.externalResultCount === "number" ? debug.externalResultCount : webSuggestions.length,
    finalResultCount: typeof debug.finalResultCount === "number" ? debug.finalResultCount : localMatches.length + webSuggestions.length,
    emptyReason: (debug.emptyReason as string) ?? null,
    groundingSourceCount: typeof debug.webSearchResultCount === "number" ? debug.webSearchResultCount : 0,
    returnedDirectorNames: directorNames,
    extractedGenres: Array.isArray(debug.extractedGenres) ? debug.extractedGenres as string[] : [],
    extractedMoods: Array.isArray(debug.extractedMoods) ? debug.extractedMoods as string[] : [],
    notes: "",
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Evaluation Checklist — 기계적 체크 항목
// ═══════════════════════════════════════════════════════════════════

export type CheckResult = "pass" | "warn" | "fail" | "skip";

export interface CheckItem {
  id: string;
  category: "mechanical" | "human_review";
  label: string;
  result: CheckResult;
  detail?: string;
}

/**
 * 기계적으로 검증 가능한 항목을 체크
 */
export function runMechanicalChecks(
  summary: EvaluationSummary,
  expected: RecommendExpectedProfile,
): CheckItem[] {
  const checks: CheckItem[] = [];

  // ── 1. 결과 존재 여부 ──
  checks.push({
    id: "has_results",
    category: "mechanical",
    label: "최종 결과 존재 여부",
    result: expected.shouldLikelyReturnResults
      ? (summary.finalResultCount > 0 ? "pass" : "fail")
      : (summary.finalResultCount === 0 ? "pass" : "warn"),
    detail: `expected=${expected.shouldLikelyReturnResults ? "results" : "empty"}, actual=${summary.finalResultCount}`,
  });

  // ── 2. 로컬 매칭 ──
  checks.push({
    id: "local_match",
    category: "mechanical",
    label: "로컬 감독 매칭 여부",
    result: expected.shouldFindLocalCandidates
      ? (summary.localResultCount > 0 ? "pass" : "warn")
      : "skip",
    detail: `expected_local=${expected.shouldFindLocalCandidates}, actual=${summary.localResultCount}`,
  });

  // ── 3. 웹 검색 트리거 ──
  checks.push({
    id: "web_search_trigger",
    category: "mechanical",
    label: "웹 검색 트리거 여부",
    result: expected.shouldTriggerWebSearch
      ? (summary.attemptedWebSearch ? "pass" : "warn")
      : (summary.attemptedWebSearch ? "warn" : "pass"),
    detail: `expected_web=${expected.shouldTriggerWebSearch}, actual=${summary.attemptedWebSearch}`,
  });

  // ── 4. 웹 검색 시 쿼리 존재 ──
  if (summary.attemptedWebSearch) {
    checks.push({
      id: "web_search_query",
      category: "mechanical",
      label: "웹 검색 쿼리 존재 여부",
      result: summary.webSearchQuery ? "pass" : "fail",
      detail: `query=${summary.webSearchQuery}`,
    });
  }

  // ── 5. 장르 추출 ──
  if (expected.expectedGenres.length > 0) {
    const genreDetected = summary.extractedGenres.length > 0;
    checks.push({
      id: "genre_extraction",
      category: "mechanical",
      label: "장르 키워드 추출 여부",
      result: genreDetected ? "pass" : "warn",
      detail: `expected=${expected.expectedGenres.join(",")}, actual=${summary.extractedGenres.join(",") || "(없음)"}`,
    });
  }

  // ── 6. 무드 추출 ──
  if (expected.expectedMoods.length > 0) {
    const moodDetected = summary.extractedMoods.length > 0;
    checks.push({
      id: "mood_extraction",
      category: "mechanical",
      label: "무드 키워드 추출 여부",
      result: moodDetected ? "pass" : "warn",
      detail: `expected=${expected.expectedMoods.join(",")}, actual=${summary.extractedMoods.join(",") || "(없음)"}`,
    });
  }

  // ── 7. emptyReason 설명 가능성 ──
  if (summary.finalResultCount === 0) {
    checks.push({
      id: "empty_reason_provided",
      category: "mechanical",
      label: "빈 결과 시 이유 제공 여부",
      result: summary.emptyReason ? "pass" : "fail",
      detail: `emptyReason=${summary.emptyReason}`,
    });

    // 예상 실패 이유와 일치하는지
    if (expected.expectedFailureRisks.length > 0 && summary.emptyReason) {
      const matchesExpected = expected.expectedFailureRisks.includes(summary.emptyReason);
      checks.push({
        id: "empty_reason_expected",
        category: "mechanical",
        label: "emptyReason이 예상 실패 이유와 일치",
        result: matchesExpected ? "pass" : "warn",
        detail: `expected_risks=${expected.expectedFailureRisks.join(",")}, actual=${summary.emptyReason}`,
      });
    }
  }

  // ── 8. stageStatus 일관성 ──
  checks.push({
    id: "stage_status_consistency",
    category: "mechanical",
    label: "stageStatus 일관성",
    result: isStageStatusConsistent(summary) ? "pass" : "fail",
    detail: `stages=${JSON.stringify(summary.stageStatus)}`,
  });

  return checks;
}

/**
 * stageStatus 내부 일관성 검증
 */
function isStageStatusConsistent(summary: EvaluationSummary): boolean {
  const ss = summary.stageStatus;

  // finalAssembly가 ok인데 결과가 0이면 비일관
  if (ss.finalAssembly === "ok" && summary.finalResultCount === 0) return false;
  // finalAssembly가 empty인데 결과가 있으면 비일관
  if (ss.finalAssembly === "empty" && summary.finalResultCount > 0) return false;
  // 웹 검색 not_attempted인데 attemptedWebSearch=true면 비일관
  if (ss.webSearch === "not_attempted" && summary.attemptedWebSearch) return false;
  // 웹 검색 attempted_*인데 attemptedWebSearch=false면 비일관
  if ((ss.webSearch === "attempted_success" || ss.webSearch === "attempted_empty") && !summary.attemptedWebSearch) return false;

  return true;
}

// ═══════════════════════════════════════════════════════════════════
// 4. Human Review Checklist — 사람이 봐야 하는 항목 정의
// ═══════════════════════════════════════════════════════════════════

export interface HumanReviewItem {
  id: string;
  label: string;
  question: string;
}

/**
 * 사람이 리뷰해야 할 체크리스트
 * 결과를 보고 사람이 yes/no 판단
 */
export const HUMAN_REVIEW_CHECKLIST: HumanReviewItem[] = [
  {
    id: "hr_genre_fit",
    label: "장르 적합성",
    question: "추천된 감독의 대표작 장르가 입력 시나리오의 장르와 어울리는가?",
  },
  {
    id: "hr_reason_quality",
    label: "추천 사유 품질",
    question: "각 감독의 추천 reason이 시나리오 특성을 구체적으로 언급하는가? (단순 '잘 맞습니다' 아닌지)",
  },
  {
    id: "hr_diversity",
    label: "추천 다양성",
    question: "동일한 감독이 반복 추천되지 않고, 입력에 따라 다른 감독이 나오는가?",
  },
  {
    id: "hr_niche_fallback",
    label: "니치 입력 fallback 품질",
    question: "로컬에 없는 장르에서 웹 검색 결과가 실제로 해당 장르 전문 감독인가?",
  },
  {
    id: "hr_not_generic",
    label: "비 generic 여부",
    question: "추천 결과가 지나치게 범용적이지 않은가? (예: 모든 입력에 스필버그만 나오진 않는가)",
  },
  {
    id: "hr_web_query_relevance",
    label: "웹 검색 쿼리 관련성",
    question: "웹 검색 쿼리가 입력 시나리오의 핵심 요소를 반영하는가?",
  },
];

// ═══════════════════════════════════════════════════════════════════
// 5. Report Generation
// ═══════════════════════════════════════════════════════════════════

export interface EvaluationReport {
  caseId: string;
  caseTitle: string;
  summary: EvaluationSummary;
  mechanicalChecks: CheckItem[];
  passCount: number;
  warnCount: number;
  failCount: number;
  skipCount: number;
}

/**
 * golden case 하나에 대한 evaluation report 생성
 */
export function generateReport(
  goldenCase: RecommendGoldenCase,
  apiResponse: Record<string, unknown>,
): EvaluationReport {
  const summary = extractEvaluationSummary(goldenCase.id, goldenCase.story, apiResponse);
  const checks = runMechanicalChecks(summary, goldenCase.expectedProfile);

  return {
    caseId: goldenCase.id,
    caseTitle: goldenCase.title,
    summary,
    mechanicalChecks: checks,
    passCount: checks.filter(c => c.result === "pass").length,
    warnCount: checks.filter(c => c.result === "warn").length,
    failCount: checks.filter(c => c.result === "fail").length,
    skipCount: checks.filter(c => c.result === "skip").length,
  };
}

/**
 * 여러 golden case의 report를 집계
 */
export function aggregateReports(reports: EvaluationReport[]): {
  totalCases: number;
  totalPass: number;
  totalWarn: number;
  totalFail: number;
  totalSkip: number;
  failedCaseIds: string[];
  warnedCaseIds: string[];
} {
  return {
    totalCases: reports.length,
    totalPass: reports.reduce((s, r) => s + r.passCount, 0),
    totalWarn: reports.reduce((s, r) => s + r.warnCount, 0),
    totalFail: reports.reduce((s, r) => s + r.failCount, 0),
    totalSkip: reports.reduce((s, r) => s + r.skipCount, 0),
    failedCaseIds: reports.filter(r => r.failCount > 0).map(r => r.caseId),
    warnedCaseIds: reports.filter(r => r.warnCount > 0 && r.failCount === 0).map(r => r.caseId),
  };
}
