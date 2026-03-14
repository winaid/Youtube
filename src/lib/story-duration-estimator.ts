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

/** 한국어 기준 1초당 약 4~5글자 나레이션 속도 (보수적: 4자/초) */
const CHARS_PER_SECOND_KO = 4;

/** 영어 기준 1초당 약 2.5단어 나레이션 속도 */
const WORDS_PER_SECOND_EN = 2.5;

/** 나레이션 대비 영상은 약 1.5배 (비주얼 여유) */
const VISUAL_MULTIPLIER = 1.5;

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
