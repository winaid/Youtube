/**
 * mode-recommendation.ts — Studio vs Batch 자동 추천 엔진
 *
 * 사용자가 직접 모드를 추측할 필요 없이,
 * 입력 특성에 따라 적합한 모드를 추천하고 이유를 설명한다.
 */

export type RecommendedMode = "studio" | "batch";

export interface ModeRecommendation {
  mode: RecommendedMode;
  reason: string;
  confidence: "high" | "medium";
}

export interface ModeRecommendationInput {
  scriptLength: number;
  targetRuntimeSec: number;
  estimatedSegmentCount: number;
  hasContinuationChaining: boolean;
}

export function recommendMode(input: ModeRecommendationInput): ModeRecommendation {
  const { scriptLength, targetRuntimeSec, estimatedSegmentCount, hasContinuationChaining } = input;

  const batchSignals: string[] = [];
  const studioSignals: string[] = [];

  if (targetRuntimeSec >= 90) {
    batchSignals.push("타겟 런타임 90초 이상");
  } else {
    studioSignals.push("타겟 런타임 90초 미만");
  }

  if (estimatedSegmentCount >= 8) {
    batchSignals.push(`세그먼트 ${estimatedSegmentCount}개 — 대량 생성 적합`);
  } else if (estimatedSegmentCount <= 4) {
    studioSignals.push(`세그먼트 ${estimatedSegmentCount}개 — 정밀 편집 적합`);
  }

  if (scriptLength > 300) {
    batchSignals.push("장문 스크립트");
  } else if (scriptLength < 80) {
    studioSignals.push("짧은 컨셉");
  }

  if (hasContinuationChaining) {
    batchSignals.push("세그먼트 간 extend 체이닝 필요");
  }

  const batchScore = batchSignals.length;
  const studioScore = studioSignals.length;

  if (batchScore > studioScore) {
    return {
      mode: "batch",
      reason: batchSignals[0],
      confidence: batchScore >= 3 ? "high" : "medium",
    };
  }

  return {
    mode: "studio",
    reason: studioSignals.length > 0 ? studioSignals[0] : "기본 추천",
    confidence: studioScore >= 2 ? "high" : "medium",
  };
}
