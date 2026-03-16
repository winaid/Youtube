/**
 * story-duration-estimator.ts — 스토리 텍스트 기반 project total duration 추정
 *
 * 목적:
 *   duration="auto" 일 때 storyText의 길이·문장 수·예상 나레이션 시간을 기반으로
 *   전체 프로젝트의 적정 총 길이(초)를 추정한다.
 *
 * 주의:
 *   - 이 값은 project total duration (영상 전체 길이)이다.
 *   - current segment duration (Kling 1회 요청 단위, 3~15초)과 혼동하지 말 것.
 *   - generate-cuts는 이 값을 projectTotalDurationSeconds로 받아
 *     segment planning의 기준으로 사용한다.
 */

/** 추정 결과 */
export interface StoryDurationEstimate {
  /** 추정 총 길이 (초) */
  estimatedTotalSec: number;
  /** 추정 근거 */
  basis: "sentence_count" | "char_length" | "minimum";
  /** 추정에 사용된 입력 지표 */
  metrics: {
    charCount: number;
    sentenceCount: number;
    estimatedNarrationSec: number;
  };
}

// ── 상수 ────────────────────────────────────────────────────────────────────────

/** 한국어 기준 1초당 약 3.2글자 자연 나레이션 속도 (다큐/해설 기준) */
const CHARS_PER_SECOND_KO = 3.2;

/** 영어 기준 1초당 약 2.5단어 나레이션 속도 */
const WORDS_PER_SECOND_EN = 2.5;

/** 나레이션 대비 영상은 약 1.35배 (비주얼 여유 + 구두점/수사적 포즈) */
const VISUAL_MULTIPLIER = 1.35;

/** 최소 project total (너무 짧은 글이라도 최소 30초) */
const MIN_PROJECT_TOTAL_SEC = 30;

/** 최대 project total (현실적 상한) */
const MAX_PROJECT_TOTAL_SEC = 300;

/** 문장 기반 추정 — 문장당 평균 영상 시간 (초) */
const SEC_PER_SENTENCE = 8;

// ── 유틸 ────────────────────────────────────────────────────────────────────────

/** 문장 분리 (한국어·영어 혼합 대응) */
function countSentences(text: string): number {
  // 마침표, 물음표, 느낌표, 줄바꿈 기준 분리
  const sentences = text
    .split(/[.!?。！？\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
  return Math.max(1, sentences.length);
}

/** 한국어 비율 추정 (한글 문자 비율) */
function koreanRatio(text: string): number {
  const koChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
  const total = text.replace(/\s/g, "").length;
  return total > 0 ? koChars / total : 0;
}

// ── 메인 ────────────────────────────────────────────────────────────────────────

/**
 * storyText로부터 project total duration을 추정한다.
 *
 * 추정 로직:
 *   1. 문장 수 × SEC_PER_SENTENCE
 *   2. 글자 수 기반 나레이션 시간 × VISUAL_MULTIPLIER
 *   3. 둘 중 큰 값을 채택 (under-estimation 방지)
 *   4. MIN_PROJECT_TOTAL_SEC ~ MAX_PROJECT_TOTAL_SEC 범위 클램프
 */
export function estimateProjectDuration(storyText: string): StoryDurationEstimate {
  const trimmed = storyText.trim();
  const charCount = trimmed.length;
  const sentenceCount = countSentences(trimmed);

  // 문장 기반 추정
  const sentenceBased = sentenceCount * SEC_PER_SENTENCE;

  // 글자 기반 나레이션 시간 추정
  const koRatio = koreanRatio(trimmed);
  let narrationSec: number;
  if (koRatio > 0.3) {
    // 한국어 위주
    const pureText = trimmed.replace(/\s/g, "");
    narrationSec = pureText.length / CHARS_PER_SECOND_KO;
  } else {
    // 영어 위주
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    narrationSec = wordCount / WORDS_PER_SECOND_EN;
  }
  const charBased = narrationSec * VISUAL_MULTIPLIER;

  // 더 큰 값 채택 (under-estimation 방지)
  let estimatedTotalSec: number;
  let basis: StoryDurationEstimate["basis"];

  if (charCount < 20) {
    // 너무 짧은 텍스트 — 최소값 사용
    estimatedTotalSec = MIN_PROJECT_TOTAL_SEC;
    basis = "minimum";
  } else if (sentenceBased >= charBased) {
    estimatedTotalSec = sentenceBased;
    basis = "sentence_count";
  } else {
    estimatedTotalSec = charBased;
    basis = "char_length";
  }

  // 클램프
  estimatedTotalSec = Math.min(
    MAX_PROJECT_TOTAL_SEC,
    Math.max(MIN_PROJECT_TOTAL_SEC, Math.round(estimatedTotalSec)),
  );

  return {
    estimatedTotalSec,
    basis,
    metrics: {
      charCount,
      sentenceCount,
      estimatedNarrationSec: Math.round(narrationSec),
    },
  };
}

// ── 최적 편집 파라미터 자동 추정 ────────────────────────────────────────────

export interface AutoEditPlan {
  /** 추정 프로젝트 총 길이 (초) */
  totalSec: number;
  /** 추정 최적 장면당 초 */
  cutDuration: number;
  /** 추정 최적 장면 수 */
  cutCount: number;
  /** 추정 근거 */
  planBasis: string;
}

/**
 * 스토리 텍스트로부터 최적의 편집 파라미터를 자동 추정한다.
 *
 * 규칙:
 *   - 문장 수 ≤ 5  → 짧은 콘텐츠: 4~5초/컷, 4~6컷
 *   - 문장 수 ≤ 15 → 중간 콘텐츠: 5~6초/컷, 8~12컷
 *   - 문장 수 > 15  → 긴 콘텐츠: 4~5초/컷, 12~15컷 (segment 분할 대상)
 *   - 컷 수 × 장면당 초 ≈ totalSec 유지
 *   - cutDuration: 3~15초 범위 (Kling VIDEO 3.0 최대 15초 지원)
 */
export function estimateAutoEditPlan(storyText: string): AutoEditPlan {
  const est = estimateProjectDuration(storyText);
  const totalSec = est.estimatedTotalSec;
  const sentenceCount = est.metrics.sentenceCount;

  let cutDuration: number;

  if (totalSec <= 40) {
    // 짧은 콘텐츠: 4초 기본
    cutDuration = 4;
  } else if (totalSec <= 90) {
    // 중간: 5초 기본
    cutDuration = 5;
  } else if (totalSec <= 180) {
    // 중장편: 문장 밀도에 따라 4~6초
    cutDuration = sentenceCount > 20 ? 4 : 5;
  } else {
    // 장편: 5초 (장면 수가 자연히 늘어남)
    cutDuration = 5;
  }

  // cutCount = totalSec / cutDuration, 4~30 범위
  const rawCutCount = Math.round(totalSec / cutDuration);
  const cutCount = Math.min(30, Math.max(4, rawCutCount));

  // cutDuration 재조정: cutCount × cutDuration ≈ totalSec
  // Kling VIDEO 3.0은 최대 15초를 지원하므로 상한을 15초로 설정.
  // 기존 Math.min(8, ...)은 auto 모드에서 8초 이상 추천을 차단했음.
  const adjustedDuration = Math.round(totalSec / cutCount);
  cutDuration = Math.min(15, Math.max(3, adjustedDuration));

  return {
    totalSec,
    cutDuration,
    cutCount,
    planBasis: `story_auto (${est.basis}, ${sentenceCount}문장, ${totalSec}초 → ${cutCount}컷×${cutDuration}초)`,
  };
}
