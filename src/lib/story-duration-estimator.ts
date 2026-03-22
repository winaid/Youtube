/**
 * story-duration-estimator.ts — 스토리 텍스트 기반 project total duration 추정
 *
 * 목적:
 *   duration="auto" 일 때 storyText의 길이·문장 수·예상 나레이션 시간을 기반으로
 *   전체 프로젝트의 적정 총 길이(초)를 추정한다.
 *
 * 주의:
 *   - 이 값은 project total duration (영상 전체 길이)이다.
 *   - current segment duration (VEO 1회 요청 단위, 3~15초)과 혼동하지 말 것.
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

/**
 * 한국어 기준 1초당 글자 수 (공백 제외 순수 글자).
 *
 * 변경 이력:
 *   v1: 3.2 chars/sec (다큐멘터리/해설 기준 — 느린 편)
 *   v2: 4.5 chars/sec (유튜브 쇼츠/해설 기준)
 *   v3: 5.8 chars/sec (쇼츠 내레이션 실측 기준)
 *
 * 근거: 유튜브 쇼츠 나레이션 실측 분당 330~360자(공백 제외).
 *   5.8 chars/sec = 348 chars/min → 쇼츠 평균 속도.
 *   v2의 4.5는 캐주얼/해설 기준으로 쇼츠 대비 과대 추정.
 */
const CHARS_PER_SECOND_KO = 5.8;

/** 영어 기준 1초당 약 2.5단어 나레이션 속도 */
const WORDS_PER_SECOND_EN = 2.5;

/**
 * 나레이션 시간 → 영상 시간 변환 배율.
 *
 * 변경 이력:
 *   v1: 1.35 (비주얼 여유 + 포즈)
 *   v2: 1.15 (유튜브 쇼츠에선 여백이 적음)
 *   v3: 1.05 (쇼츠는 빈 화면이 거의 없음 — 나레이션 ≈ 영상 길이)
 *
 * 근거: 쇼츠/숏폼에서는 나레이션과 비주얼이 동시 진행.
 *   1.05 = 인트로/아웃트로 최소 여유만 포함.
 */
const VISUAL_MULTIPLIER = 1.05;

/** 최소 project total (쇼츠 최소 길이 16초 — VEO 2회 생성 기준) */
const MIN_PROJECT_TOTAL_SEC = 16;

/** 최대 project total (현실적 상한) */
const MAX_PROJECT_TOTAL_SEC = 300;

/**
 * 문장 기반 추정 — 문장당 평균 영상 시간 (초).
 *
 * 변경 이력:
 *   v1: 8초/문장 (장문 중심 가정)
 *   v2: 5초/문장 (한국어 구어체/쇼츠 기준)
 *   v3: 3.5초/문장 (쇼츠 대본 실측 — 문장이 매우 짧음)
 *
 * 근거: 쇼츠 대본은 한 줄에 10~25자 문장이 대부분.
 *   실측 결과 문장당 나레이션 2.5~4초, 비주얼 포함 3~4초.
 *   v2의 5초는 과대 추정 → 113초 계산되어야 할 것이 70초로 수정.
 */
const SEC_PER_SENTENCE = 3.5;

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

  // 가중 평균 (글자 기반 70% + 문장 기반 30%) — 한쪽 과대 추정 완화
  // 글자 기반이 더 정확 (실제 나레이션 시간 반영), 문장 기반은 보조.
  let estimatedTotalSec: number;
  let basis: StoryDurationEstimate["basis"];

  if (charCount < 20) {
    // 너무 짧은 텍스트 — 최소값 사용
    estimatedTotalSec = MIN_PROJECT_TOTAL_SEC;
    basis = "minimum";
  } else {
    estimatedTotalSec = Math.round(charBased * 0.7 + sentenceBased * 0.3);
    basis = charBased >= sentenceBased ? "char_length" : "sentence_count";
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
 *   - cutDuration: 3~15초 범위 (VEO 최대 15초 지원)
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

  // cutCount = totalSec / cutDuration, 4~8 범위
  // 데모 안정화: 상한 8컷. generate-cuts 토큰 안정 + 시연 품질 집중.
  // 8컷 = 유튜브 쇼츠~2분 분량에 최적. 각 컷이 충분한 연출 여유를 가짐.
  const DEMO_CUT_CAP = 8;
  const rawCutCount = Math.round(totalSec / cutDuration);
  const cutCount = Math.min(DEMO_CUT_CAP, Math.max(4, rawCutCount));

  // cutDuration 재조정: cutCount × cutDuration ≈ totalSec
  // 내부 플래닝 휴리스틱: 3~15초 범위로 추정. 실제 생성은 8초 고정.
  // 여기서의 cutDuration은 스토리 구조 분석용이며 VEO 요청에 직접 사용되지 않음.
  const adjustedDuration = Math.round(totalSec / cutCount);
  cutDuration = Math.min(15, Math.max(3, adjustedDuration));

  return {
    totalSec,
    cutDuration,
    cutCount,
    planBasis: `story_auto (${est.basis}, ${sentenceCount}문장, ${totalSec}초 → ${cutCount}컷×${cutDuration}초)`,
  };
}
