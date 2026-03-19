/**
 * quality-checker.ts — Golden evaluation 품질 검증 엔진
 *
 * 목적: Deep Analysis / Continuity ON/OFF 조합에서
 *       생성 결과의 품질을 기계적으로 비교 가능하게 만든다.
 *
 * 원칙:
 * - 과도한 scoring engine 금지
 * - 기계적 확인 + 사람이 최종 확인할 항목 분리
 * - 정량(자동) + 정성(수동) 체크 모두 포함
 */

import type {
  StoryIntentAnalysis,
  GenerationRiskAnalysis,
  VisualStrategyLite,
  PromptBrief,
  DeepAnalysisResult,
} from "@/lib/deep-analysis/types";
import type { QualityCheckItem, QualityCheckResult, GoldenEvaluationResult, GoldenExpectedProfile } from "./golden-evaluation-set";

// ═══════════════════════════════════════════════════════════════════
// 1. Intent Accuracy Checks — 분석이 기대와 맞는지
// ═══════════════════════════════════════════════════════════════════

function checkToneAccuracy(intent: StoryIntentAnalysis, expected: GoldenExpectedProfile): QualityCheckItem {
  const match = intent.tone === expected.expectedTone;
  return {
    id: "tone-accuracy",
    category: "brief_quality",
    label: `톤 일치: expected=${expected.expectedTone}, got=${intent.tone}`,
    result: match ? "pass" : "warn",
    detail: match ? undefined : `톤 불일치 — 프롬프트 방향이 달라질 수 있음`,
  };
}

function checkGenreAccuracy(intent: StoryIntentAnalysis, expected: GoldenExpectedProfile): QualityCheckItem {
  const match = intent.genre === expected.expectedGenre;
  return {
    id: "genre-accuracy",
    category: "brief_quality",
    label: `장르 일치: expected=${expected.expectedGenre}, got=${intent.genre}`,
    result: match ? "pass" : "warn",
    detail: match ? undefined : `장르 불일치 — 시각 전략이 달라질 수 있음`,
  };
}

function checkPacingAccuracy(intent: StoryIntentAnalysis, expected: GoldenExpectedProfile): QualityCheckItem {
  const match = intent.pacing === expected.expectedPacing;
  // pacing은 soft match — accelerating ≈ fast, decelerating ≈ slow
  const softMatch = (intent.pacing === "accelerating" && expected.expectedPacing === "fast")
    || (intent.pacing === "decelerating" && expected.expectedPacing === "slow")
    || (intent.pacing === "fast" && expected.expectedPacing === "accelerating")
    || (intent.pacing === "slow" && expected.expectedPacing === "decelerating");

  return {
    id: "pacing-accuracy",
    category: "brief_quality",
    label: `페이싱 일치: expected=${expected.expectedPacing}, got=${intent.pacing}`,
    result: match ? "pass" : softMatch ? "pass" : "warn",
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. Risk Detection Checks — 기대 리스크를 감지했는지
// ═══════════════════════════════════════════════════════════════════

function checkRiskDetection(risk: GenerationRiskAnalysis, expected: GoldenExpectedProfile): QualityCheckItem[] {
  const items: QualityCheckItem[] = [];
  const riskMap: Record<string, string> = {
    continuityRisk: risk.continuityRisk,
    subjectCountRisk: risk.subjectCountRisk,
    sceneSwitchRisk: risk.sceneSwitchRisk,
    motionComplexityRisk: risk.motionComplexityRisk,
    promptOverloadRisk: risk.promptOverloadRisk,
    visualAmbiguityRisk: risk.visualAmbiguityRisk,
  };

  for (const hotspot of expected.riskHotspots) {
    const level = riskMap[hotspot];
    if (!level) {
      items.push({
        id: `risk-${hotspot}`,
        category: "risk_mitigation",
        label: `리스크 감지: ${hotspot} — 알 수 없는 리스크 키`,
        result: "warn",
      });
      continue;
    }

    // 기대 hotspot이면 medium 이상이어야 감지 성공
    const detected = level === "medium" || level === "high";
    items.push({
      id: `risk-${hotspot}`,
      category: "risk_mitigation",
      label: `리스크 감지: ${hotspot}=${level}`,
      result: detected ? "pass" : "fail",
      detail: detected ? undefined : `${hotspot}이 기대 hotspot이지만 low로 평가됨 — 위험 미감지`,
    });
  }

  return items;
}

// ═══════════════════════════════════════════════════════════════════
// 3. Brief Quality Checks — brief가 유효한지
// ═══════════════════════════════════════════════════════════════════

function checkBriefNotEmpty(brief: PromptBrief): QualityCheckItem {
  const hasContent = brief.creativeBrief.length > 0 || brief.avoidList.length > 0 || brief.shotDiscipline.length > 0;
  return {
    id: "brief-non-empty",
    category: "brief_quality",
    label: "Brief 비어있지 않음",
    result: hasContent ? "pass" : "fail",
    detail: hasContent ? undefined : "Deep Analysis가 빈 brief를 생성 — 프롬프트에 제어 신호 없음",
  };
}

function checkAvoidListSize(brief: PromptBrief): QualityCheckItem {
  return {
    id: "avoid-list-size",
    category: "prompt_control",
    label: `Avoid list 크기: ${brief.avoidList.length}`,
    result: brief.avoidList.length <= 5 ? "pass" : "warn",
    detail: brief.avoidList.length > 5 ? "avoid list가 5개 초과 — 프롬프트 과부하 위험" : undefined,
  };
}

function checkBriefCompactness(brief: PromptBrief): QualityCheckItem {
  const totalLen = brief.creativeBrief.length + brief.continuityHint.length
    + brief.shotDiscipline.length + brief.subjectLockHint.length
    + brief.environmentLockHint.length + brief.avoidList.join("; ").length;

  return {
    id: "brief-compactness",
    category: "prompt_control",
    label: `Brief 총 길이: ${totalLen}자`,
    result: totalLen < 500 ? "pass" : totalLen < 800 ? "warn" : "fail",
    detail: totalLen >= 800 ? "brief가 800자 초과 — 프롬프트 토큰 낭비" : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 4. Continuity Checks — continuity 모드 관련
// ═══════════════════════════════════════════════════════════════════

function checkContinuityHintPresence(brief: PromptBrief, shouldBenefit: boolean, continuityMode: boolean): QualityCheckItem {
  if (!shouldBenefit && !continuityMode) {
    return {
      id: "continuity-hint-absent",
      category: "continuity",
      label: "Continuity 불필요 케이스 — hint 확인",
      result: "pass",
    };
  }

  const hasHint = brief.continuityHint.length > 0;
  return {
    id: "continuity-hint-presence",
    category: "continuity",
    label: `Continuity hint ${hasHint ? "존재" : "부재"}`,
    result: hasHint ? "pass" : shouldBenefit ? "fail" : "warn",
    detail: !hasHint && shouldBenefit ? "continuity가 필요한 케이스지만 hint가 없음" : undefined,
  };
}

function checkSubjectLockForContinuity(brief: PromptBrief, shouldBenefit: boolean): QualityCheckItem {
  if (!shouldBenefit) {
    return {
      id: "subject-lock-not-needed",
      category: "continuity",
      label: "Subject lock 불필요 케이스",
      result: "pass",
    };
  }

  const hasLock = brief.subjectLockHint.length > 0;
  return {
    id: "subject-lock-presence",
    category: "continuity",
    label: `Subject lock hint ${hasLock ? "존재" : "부재"}`,
    result: hasLock ? "pass" : "warn",
    detail: !hasLock ? "continuity 케이스인데 subject lock hint가 없음" : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 5. Consistency Checks — 내부 일관성
// ═══════════════════════════════════════════════════════════════════

function checkRealismStyleConsistency(visual: VisualStrategyLite): QualityCheckItem {
  const sum = visual.realismLevel + visual.stylizationLevel;
  return {
    id: "realism-style-sum",
    category: "consistency",
    label: `realism(${visual.realismLevel}) + stylization(${visual.stylizationLevel}) = ${sum}`,
    result: sum === 100 ? "pass" : "fail",
    detail: sum !== 100 ? `합이 100이어야 함` : undefined,
  };
}

function checkNoConflictingSignals(brief: PromptBrief): QualityCheckItem {
  // creativeBrief에서 모순 감지
  const hasRealistic = /realistic/i.test(brief.creativeBrief);
  const hasStylized = /highly stylized/i.test(brief.creativeBrief);
  const conflict = hasRealistic && hasStylized;

  return {
    id: "no-conflicting-signals",
    category: "consistency",
    label: "Brief 내 모순 없음",
    result: conflict ? "fail" : "pass",
    detail: conflict ? "realistic과 highly stylized가 동시에 포함됨" : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 6. Main Evaluator
// ═══════════════════════════════════════════════════════════════════

/**
 * 단일 golden case에 대해 Deep Analysis 결과를 평가한다.
 */
export function evaluateGoldenCase(
  caseId: string,
  analysisResult: DeepAnalysisResult,
  expectedProfile: GoldenExpectedProfile,
  continuityMode: boolean,
  mode: GoldenEvaluationResult["mode"],
): GoldenEvaluationResult {
  const checks: QualityCheckItem[] = [];

  // Intent accuracy
  checks.push(checkToneAccuracy(analysisResult.storyIntent, expectedProfile));
  checks.push(checkGenreAccuracy(analysisResult.storyIntent, expectedProfile));
  checks.push(checkPacingAccuracy(analysisResult.storyIntent, expectedProfile));

  // Risk detection
  checks.push(...checkRiskDetection(analysisResult.generationRisk, expectedProfile));

  // Brief quality
  checks.push(checkBriefNotEmpty(analysisResult.promptBrief));
  checks.push(checkAvoidListSize(analysisResult.promptBrief));
  checks.push(checkBriefCompactness(analysisResult.promptBrief));

  // Continuity
  checks.push(checkContinuityHintPresence(analysisResult.promptBrief, expectedProfile.shouldBenefitFromContinuity, continuityMode));
  checks.push(checkSubjectLockForContinuity(analysisResult.promptBrief, expectedProfile.shouldBenefitFromContinuity));

  // Consistency
  checks.push(checkRealismStyleConsistency(analysisResult.visualStrategy));
  checks.push(checkNoConflictingSignals(analysisResult.promptBrief));

  const passCount = checks.filter(c => c.result === "pass").length;
  const warnCount = checks.filter(c => c.result === "warn").length;
  const failCount = checks.filter(c => c.result === "fail").length;
  const score = Math.round((passCount / checks.length) * 100);

  return { caseId, mode, checks, passCount, warnCount, failCount, score };
}
