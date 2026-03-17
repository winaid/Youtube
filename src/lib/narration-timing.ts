/**
 * narration-timing.ts — Korean narration timing estimator
 *
 * Pacing model based on Korean broadcast/YouTube narration analysis:
 *
 *   Natural narration:  ~4.0 chars/sec  (다큐, 해설, 교육 — YouTube 기준)
 *   Fast shorts:        ~5.0 chars/sec  (빠른 쇼츠, 밈 해설)
 *   News anchor:        ~5.5 chars/sec  (뉴스, 급한 톤)
 *
 * v2 변경 (데모 안정화):
 *   story-duration-estimator.ts와 일관성 유지.
 *   v1의 3.2 chars/sec은 과대 추정의 원인 — 4.0으로 상향.
 *
 * This module adds:
 *   1. Punctuation pause weights (마침표, 쉼표, 물음표, 줄임표)
 *   2. Proper noun / number / abbreviation pronunciation overhead
 *   3. Rhetorical pause detection (의문형, 역설적 전환)
 *   4. Fit classification: fits / tight / overflow
 *   5. Density recommendations when overflow detected
 */

// ═══════════════════════════════════════════════════════════════════
// Pacing Constants
// ═══════════════════════════════════════════════════════════════════

/** Natural Korean narration: documentary, educational shorts, story narration */
const KO_NATURAL_CHARS_PER_SEC = 4.0;

/** Fast shorts pacing: rapid-fire commentary, meme/pop-culture shorts */
const KO_FAST_CHARS_PER_SEC = 5.0;

/** Visual breathing room multiplier — time for the viewer to absorb imagery */
const VISUAL_BREATH_NATURAL = 1.15;
const VISUAL_BREATH_FAST = 1.08;

// ═══════════════════════════════════════════════════════════════════
// Punctuation Pause Model
// ═══════════════════════════════════════════════════════════════════

interface PauseWeights {
  /** Period (마침표) — sentence boundary, natural breath */
  period: number;
  /** Question mark — slightly longer, invites reflection */
  question: number;
  /** Exclamation — emphasis, shorter than question */
  exclamation: number;
  /** Comma — micro-pause, clause boundary */
  comma: number;
  /** Ellipsis (…) — dramatic/rhetorical pause */
  ellipsis: number;
  /** Dash (—, –) — parenthetical or topic shift */
  dash: number;
  /** Line break — structural pause between paragraphs */
  lineBreak: number;
  /** Colon (:) — introducing a list or explanation */
  colon: number;
}

const PAUSE_WEIGHTS: PauseWeights = {
  period: 0.35,
  question: 0.45,
  exclamation: 0.3,
  comma: 0.15,
  ellipsis: 0.6,
  dash: 0.25,
  lineBreak: 0.4,
  colon: 0.2,
};

function countPauseDuration(text: string): number {
  let total = 0;
  const counts = {
    period: (text.match(/(?<![.…])\.(?!\.)/g) || []).length,
    question: (text.match(/\?/g) || []).length,
    exclamation: (text.match(/!/g) || []).length,
    comma: (text.match(/,/g) || []).length,
    ellipsis: (text.match(/…|\.{3}/g) || []).length,
    dash: (text.match(/[—–]/g) || []).length,
    lineBreak: (text.match(/\n/g) || []).length,
    colon: (text.match(/:/g) || []).length,
  };

  for (const [key, count] of Object.entries(counts)) {
    total += count * PAUSE_WEIGHTS[key as keyof PauseWeights];
  }

  return total;
}

// ═══════════════════════════════════════════════════════════════════
// Special Token Overhead
// ═══════════════════════════════════════════════════════════════════

/**
 * Proper nouns, numbers, and abbreviations take longer to pronounce
 * than their character count suggests.
 */
function countSpecialTokenOverhead(text: string): number {
  let overhead = 0;

  // Numbers (years, statistics, quantities) — reading "1945년" takes longer than 4 chars
  const numbers = text.match(/\d[\d,.]+/g) || [];
  overhead += numbers.length * 0.3;

  // Percentage, currency, units
  const units = text.match(/\d+\s*(%|원|달러|명|개|배|만|억|조|km|kg|m|톤)/g) || [];
  overhead += units.length * 0.2;

  // English words embedded in Korean text
  const englishWords = text.match(/[A-Za-z]{2,}/g) || [];
  overhead += englishWords.length * 0.25;

  // Proper nouns: Korean names (2-4 char sequences followed by particles/spaces)
  // This is a heuristic — catches most Korean proper nouns
  const properNouns = text.match(/[가-힣]{2,4}(?=[은는이가의에서를])/g) || [];
  const uniqueProperNouns = new Set(properNouns);
  overhead += uniqueProperNouns.size * 0.1;

  // Quoted speech or emphasis markers
  const quotes = text.match(/["'「」『』""'']/g) || [];
  overhead += Math.floor(quotes.length / 2) * 0.15;

  return overhead;
}

// ═══════════════════════════════════════════════════════════════════
// Rhetorical Pause Detection
// ═══════════════════════════════════════════════════════════════════

const RHETORICAL_PATTERNS = [
  /\?[^?]*$/m,                                    // sentence-ending question
  /(?:하지만|그런데|그러나|반면에?)\s/g,           // adversative conjunction
  /(?:사실|실은|알고\s*보면|진짜\s*이유)/g,       // reveal markers
  /(?:만약|없었다면|않았다면)/g,                    // counterfactual
  /(?:결국|아이러니|역설)/g,                       // paradox/irony
];

function countRhetoricalPauses(text: string): number {
  let count = 0;
  for (const pattern of RHETORICAL_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  }
  return count * 0.3;
}

// ═══════════════════════════════════════════════════════════════════
// Main Estimation
// ═══════════════════════════════════════════════════════════════════

export type NarrationPace = "natural" | "fast";
export type NarrationFit = "fits" | "tight" | "overflow";

export interface NarrationEstimate {
  /** Estimated narration duration at this pace (seconds) */
  narrationSec: number;
  /** With visual breathing room added (seconds) */
  totalWithBreathingSec: number;
  /** Pace used */
  pace: NarrationPace;
  /** Breakdown */
  breakdown: {
    /** Pure character-based reading time */
    baseReadingSec: number;
    /** Punctuation pauses */
    pauseSec: number;
    /** Special token overhead (numbers, proper nouns, English) */
    specialTokenSec: number;
    /** Rhetorical pauses */
    rhetoricalSec: number;
    /** Visual breathing room */
    breathingSec: number;
  };
  /** Metrics about the input */
  metrics: {
    charCount: number;
    charsPerSec: number;
    punctuationCount: number;
    specialTokenCount: number;
  };
}

export interface NarrationFitResult {
  /** Fit classification for this sequence */
  fit: NarrationFit;
  /** Natural pace estimate */
  natural: NarrationEstimate;
  /** Fast pace estimate */
  fast: NarrationEstimate;
  /** The target duration this is being compared against */
  targetDurationSec: number;
  /** How much over/under the target (positive = overflow) */
  overflowSec: number;
  /** Usage ratio (1.0 = exactly fills, >1.0 = overflow) */
  usageRatio: number;
  /** Recommendations when tight or overflow */
  recommendations: NarrationRecommendation[];
}

export interface NarrationRecommendation {
  type: "extend_duration" | "condense_wording" | "split_sequence";
  message: string;
  suggestedValue?: number;
}

/**
 * Estimate narration duration for a Korean text at a given pace.
 */
export function estimateNarrationDuration(
  text: string,
  pace: NarrationPace = "natural",
): NarrationEstimate {
  const stripped = text.replace(/\s/g, "");
  const charCount = stripped.length;

  if (charCount === 0) {
    return {
      narrationSec: 0,
      totalWithBreathingSec: 0,
      pace,
      breakdown: { baseReadingSec: 0, pauseSec: 0, specialTokenSec: 0, rhetoricalSec: 0, breathingSec: 0 },
      metrics: { charCount: 0, charsPerSec: 0, punctuationCount: 0, specialTokenCount: 0 },
    };
  }

  const charsPerSec = pace === "natural" ? KO_NATURAL_CHARS_PER_SEC : KO_FAST_CHARS_PER_SEC;
  const breathMultiplier = pace === "natural" ? VISUAL_BREATH_NATURAL : VISUAL_BREATH_FAST;

  const baseReadingSec = charCount / charsPerSec;
  const pauseSec = countPauseDuration(text);
  const specialTokenSec = countSpecialTokenOverhead(text);
  const rhetoricalSec = pace === "natural" ? countRhetoricalPauses(text) : countRhetoricalPauses(text) * 0.5;

  const narrationSec = baseReadingSec + pauseSec + specialTokenSec + rhetoricalSec;
  const breathingSec = narrationSec * (breathMultiplier - 1);
  const totalWithBreathingSec = narrationSec + breathingSec;

  const punctuationCount = (text.match(/[.!?,;:…—–\n]/g) || []).length;
  const specialTokenCount = (text.match(/\d[\d,.]+|[A-Za-z]{2,}/g) || []).length;

  return {
    narrationSec: Math.round(narrationSec * 10) / 10,
    totalWithBreathingSec: Math.round(totalWithBreathingSec * 10) / 10,
    pace,
    breakdown: {
      baseReadingSec: Math.round(baseReadingSec * 10) / 10,
      pauseSec: Math.round(pauseSec * 10) / 10,
      specialTokenSec: Math.round(specialTokenSec * 10) / 10,
      rhetoricalSec: Math.round(rhetoricalSec * 10) / 10,
      breathingSec: Math.round(breathingSec * 10) / 10,
    },
    metrics: {
      charCount,
      charsPerSec,
      punctuationCount,
      specialTokenCount,
    },
  };
}

/**
 * Evaluate whether a script fits within a target duration.
 *
 * Fit classification:
 *   fits:     fast-pace estimate ≤ 85% of target — comfortable room
 *   tight:    fast-pace estimate ≤ target but natural-pace overflows
 *   overflow: even fast-pace exceeds target
 */
export function evaluateNarrationFit(
  text: string,
  targetDurationSec: number,
): NarrationFitResult {
  const natural = estimateNarrationDuration(text, "natural");
  const fast = estimateNarrationDuration(text, "fast");

  let fit: NarrationFit;
  if (fast.totalWithBreathingSec <= targetDurationSec * 0.85) {
    fit = "fits";
  } else if (fast.totalWithBreathingSec <= targetDurationSec) {
    fit = "tight";
  } else {
    fit = "overflow";
  }

  const overflowSec = Math.round((natural.totalWithBreathingSec - targetDurationSec) * 10) / 10;
  const usageRatio = Math.round((natural.totalWithBreathingSec / Math.max(1, targetDurationSec)) * 100) / 100;

  const recommendations: NarrationRecommendation[] = [];

  if (fit === "tight") {
    recommendations.push({
      type: "extend_duration",
      message: `총 ${Math.ceil(natural.totalWithBreathingSec)}초로 확장하면 자연스러운 나레이션이 가능합니다.`,
      suggestedValue: Math.ceil(natural.totalWithBreathingSec),
    });
    recommendations.push({
      type: "condense_wording",
      message: `나레이션 텍스트를 ${Math.round((1 - targetDurationSec / natural.totalWithBreathingSec) * 100)}% 축약하면 현재 길이에 맞출 수 있습니다.`,
    });
  }

  if (fit === "overflow") {
    const suggestedDuration = Math.ceil(natural.totalWithBreathingSec);
    recommendations.push({
      type: "extend_duration",
      message: `최소 ${suggestedDuration}초가 필요합니다 (현재 ${targetDurationSec}초 → ${suggestedDuration}초 권장).`,
      suggestedValue: suggestedDuration,
    });

    const overflowRatio = natural.totalWithBreathingSec / targetDurationSec;
    if (overflowRatio > 1.3) {
      const suggestedSeqCount = Math.ceil(natural.totalWithBreathingSec / 12);
      recommendations.push({
        type: "split_sequence",
        message: `${suggestedSeqCount}개 시퀀스로 분할하면 시퀀스당 ~12초로 여유있게 배분됩니다.`,
        suggestedValue: suggestedSeqCount,
      });
    }

    const condensePct = Math.round((1 - targetDurationSec / natural.totalWithBreathingSec) * 100);
    if (condensePct <= 40) {
      recommendations.push({
        type: "condense_wording",
        message: `나레이션을 ${condensePct}% 축약하면 현재 시퀀스 길이에 맞출 수 있습니다.`,
      });
    }
  }

  return {
    fit,
    natural,
    fast,
    targetDurationSec,
    overflowSec,
    usageRatio,
    recommendations,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Drop-in replacement for the old estimateRuntime
// ═══════════════════════════════════════════════════════════════════

/**
 * Estimate total runtime for a Korean script text.
 *
 * Drop-in replacement for the old simple estimator.
 * Uses natural pace with punctuation/special token weights.
 */
export function estimateNarrationRuntime(scriptText: string): number {
  const est = estimateNarrationDuration(scriptText, "natural");
  return Math.ceil(est.totalWithBreathingSec);
}
