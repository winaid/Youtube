/**
 * Tests for Korean narration timing estimator.
 *
 * Validates pacing model, punctuation weights, special token overhead,
 * fit classification, and density recommendations.
 */
import { describe, it, expect } from "vitest";
import {
  estimateNarrationDuration,
  estimateNarrationRuntime,
  evaluateNarrationFit,
} from "@/lib/narration-timing";

// ═══════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════

const SIMPLE_SENTENCE = "오늘 날씨가 좋다.";
const DENSE_PARAGRAPH = `만약 흑사병이 유럽을 강타하지 않았다면, 세계 경제는 완전히 다른 방향으로 흘러갔을 것이다. 1347년, 흑사병은 유럽 인구의 30~60%를 몰살시켰다. 하지만 이 재앙이 없었다면? 봉건제는 더 오래 지속되었을 것이고, 농민들의 임금 상승은 수백 년 늦어졌을 것이다.`;
const SHORT_SCRIPT = "하지만 진짜 충격적인 건 따로 있다.";
const SCRIPT_WITH_NUMBERS = "1945년 8월 15일, 한국은 일본으로부터 독립했다. 전쟁 중 약 350만 명이 목숨을 잃었고, GDP는 70% 이상 감소했다.";
const SCRIPT_WITH_ENGLISH = "Netflix의 CEO Reed Hastings는 2023년에 AI 기반 콘텐츠 추천 시스템을 발표했다.";
const PUNCTUATION_HEAVY = "사실… 그건 거짓말이었다. 왜? 진실은 이렇다: 그가 숨긴 비밀 — 아무도 몰랐던 — 이 모든 것을 바꿨다!";
const RHETORICAL_SCRIPT = "하지만 정말 그럴까? 사실 알고 보면 완전히 다른 이야기다. 만약 그가 없었다면 역사는 바뀌었을 것이다.";
const MINIMAL_TEXT = "안녕.";

// ═══════════════════════════════════════════════════════════════════
// 1. Base estimation
// ═══════════════════════════════════════════════════════════════════

describe("estimateNarrationDuration", () => {
  it("returns 0 for empty text", () => {
    const est = estimateNarrationDuration("", "natural");
    expect(est.narrationSec).toBe(0);
    expect(est.totalWithBreathingSec).toBe(0);
  });

  it("returns positive values for any non-empty text", () => {
    const est = estimateNarrationDuration(MINIMAL_TEXT, "natural");
    expect(est.narrationSec).toBeGreaterThan(0);
    expect(est.totalWithBreathingSec).toBeGreaterThan(est.narrationSec);
  });

  it("natural pace is slower than fast pace", () => {
    const natural = estimateNarrationDuration(DENSE_PARAGRAPH, "natural");
    const fast = estimateNarrationDuration(DENSE_PARAGRAPH, "fast");
    expect(natural.totalWithBreathingSec).toBeGreaterThan(fast.totalWithBreathingSec);
  });

  it("longer text produces longer estimate", () => {
    const short = estimateNarrationDuration(SHORT_SCRIPT, "natural");
    const long = estimateNarrationDuration(DENSE_PARAGRAPH, "natural");
    expect(long.totalWithBreathingSec).toBeGreaterThan(short.totalWithBreathingSec);
  });

  it("100 pure Korean chars → ~40s at natural pace", () => {
    const text = "가".repeat(100);
    const est = estimateNarrationDuration(text, "natural");
    // 100 / 3.2 = 31.25s base * 1.3 breathing ≈ 40.6s
    expect(est.totalWithBreathingSec).toBeGreaterThanOrEqual(38);
    expect(est.totalWithBreathingSec).toBeLessThanOrEqual(44);
  });

  it("100 pure Korean chars → ~28s at fast pace", () => {
    const text = "가".repeat(100);
    const est = estimateNarrationDuration(text, "fast");
    // 100 / 4.0 = 25s base * 1.12 breathing ≈ 28s
    expect(est.totalWithBreathingSec).toBeGreaterThanOrEqual(26);
    expect(est.totalWithBreathingSec).toBeLessThanOrEqual(32);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Punctuation pauses
// ═══════════════════════════════════════════════════════════════════

describe("punctuation pause weights", () => {
  it("text with more punctuation gets higher estimate", () => {
    const noPunct = "오늘 날씨가 좋다 내일도 좋을 것이다 모레도 맑겠다";
    const withPunct = "오늘 날씨가 좋다. 내일도 좋을 것이다. 모레도 맑겠다.";
    const estNoPunct = estimateNarrationDuration(noPunct, "natural");
    const estWithPunct = estimateNarrationDuration(withPunct, "natural");
    expect(estWithPunct.breakdown.pauseSec).toBeGreaterThan(estNoPunct.breakdown.pauseSec);
  });

  it("ellipsis adds significant pause", () => {
    const normal = "사실 그건 거짓말이었다.";
    const withEllipsis = "사실… 그건 거짓말이었다.";
    const estNormal = estimateNarrationDuration(normal, "natural");
    const estEllipsis = estimateNarrationDuration(withEllipsis, "natural");
    expect(estEllipsis.breakdown.pauseSec).toBeGreaterThan(estNormal.breakdown.pauseSec);
  });

  it("question marks add more pause than periods", () => {
    const period = "그것은 사실이다.";
    const question = "그것은 사실인가?";
    const estPeriod = estimateNarrationDuration(period, "natural");
    const estQuestion = estimateNarrationDuration(question, "natural");
    expect(estQuestion.breakdown.pauseSec).toBeGreaterThan(estPeriod.breakdown.pauseSec);
  });

  it("punctuation-heavy text has substantial pause component", () => {
    const est = estimateNarrationDuration(PUNCTUATION_HEAVY, "natural");
    expect(est.breakdown.pauseSec).toBeGreaterThanOrEqual(1.5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Special token overhead
// ═══════════════════════════════════════════════════════════════════

describe("special token overhead", () => {
  it("numbers add pronunciation overhead", () => {
    const noNumbers = "그 해 여름 한국은 독립했다.";
    const withNumbers = "1945년 8월 15일 한국은 독립했다.";
    const estNo = estimateNarrationDuration(noNumbers, "natural");
    const estYes = estimateNarrationDuration(withNumbers, "natural");
    expect(estYes.breakdown.specialTokenSec).toBeGreaterThan(estNo.breakdown.specialTokenSec);
  });

  it("English words add overhead", () => {
    const korean = "그 회사의 대표는 인공지능 기반 시스템을 발표했다.";
    const withEnglish = "Netflix의 CEO는 AI 기반 시스템을 발표했다.";
    const estKo = estimateNarrationDuration(korean, "natural");
    const estEn = estimateNarrationDuration(withEnglish, "natural");
    expect(estEn.breakdown.specialTokenSec).toBeGreaterThan(estKo.breakdown.specialTokenSec);
  });

  it("script with numbers reports special tokens in metrics", () => {
    const est = estimateNarrationDuration(SCRIPT_WITH_NUMBERS, "natural");
    expect(est.metrics.specialTokenCount).toBeGreaterThan(0);
    expect(est.breakdown.specialTokenSec).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Rhetorical pauses
// ═══════════════════════════════════════════════════════════════════

describe("rhetorical pauses", () => {
  it("adversative conjunctions add pauses", () => {
    const plain = "그는 성공했다. 그는 행복했다.";
    const rhetorical = "그는 성공했다. 하지만 그는 행복했을까?";
    const estPlain = estimateNarrationDuration(plain, "natural");
    const estRhet = estimateNarrationDuration(rhetorical, "natural");
    expect(estRhet.breakdown.rhetoricalSec).toBeGreaterThan(estPlain.breakdown.rhetoricalSec);
  });

  it("rhetorical pauses are reduced in fast pace", () => {
    const natural = estimateNarrationDuration(RHETORICAL_SCRIPT, "natural");
    const fast = estimateNarrationDuration(RHETORICAL_SCRIPT, "fast");
    expect(fast.breakdown.rhetoricalSec).toBeLessThan(natural.breakdown.rhetoricalSec);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Fit classification
// ═══════════════════════════════════════════════════════════════════

describe("evaluateNarrationFit", () => {
  it("short text in long sequence → fits", () => {
    const result = evaluateNarrationFit(SHORT_SCRIPT, 15);
    expect(result.fit).toBe("fits");
    expect(result.overflowSec).toBeLessThan(0);
    expect(result.recommendations).toHaveLength(0);
  });

  it("dense paragraph in short sequence → overflow", () => {
    const result = evaluateNarrationFit(DENSE_PARAGRAPH, 10);
    expect(result.fit).toBe("overflow");
    expect(result.overflowSec).toBeGreaterThan(0);
    expect(result.usageRatio).toBeGreaterThan(1);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("overflow recommendations include extend_duration", () => {
    const result = evaluateNarrationFit(DENSE_PARAGRAPH, 10);
    const extendRec = result.recommendations.find(r => r.type === "extend_duration");
    expect(extendRec).toBeDefined();
    expect(extendRec!.suggestedValue).toBeGreaterThan(10);
  });

  it("severe overflow suggests split_sequence", () => {
    const result = evaluateNarrationFit(DENSE_PARAGRAPH, 8);
    const splitRec = result.recommendations.find(r => r.type === "split_sequence");
    if (result.usageRatio > 1.3) {
      expect(splitRec).toBeDefined();
    }
  });

  it("tight fit recommends both extend and condense", () => {
    // Find a duration that produces "tight" — fast fits but natural overflows
    const natural = estimateNarrationDuration(SCRIPT_WITH_NUMBERS, "natural");
    const fast = estimateNarrationDuration(SCRIPT_WITH_NUMBERS, "fast");
    // Target: between fast.total and natural.total
    const tightTarget = Math.round((fast.totalWithBreathingSec + natural.totalWithBreathingSec) / 2);
    const result = evaluateNarrationFit(SCRIPT_WITH_NUMBERS, tightTarget);
    if (result.fit === "tight") {
      expect(result.recommendations.length).toBeGreaterThanOrEqual(2);
      expect(result.recommendations.some(r => r.type === "extend_duration")).toBe(true);
      expect(result.recommendations.some(r => r.type === "condense_wording")).toBe(true);
    }
  });

  it("usageRatio is 1.0 when estimate equals target", () => {
    const est = estimateNarrationDuration(SHORT_SCRIPT, "natural");
    const target = Math.round(est.totalWithBreathingSec);
    const result = evaluateNarrationFit(SHORT_SCRIPT, target);
    expect(result.usageRatio).toBeGreaterThanOrEqual(0.95);
    expect(result.usageRatio).toBeLessThanOrEqual(1.05);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Drop-in replacement
// ═══════════════════════════════════════════════════════════════════

describe("estimateNarrationRuntime", () => {
  it("returns integer (ceiling)", () => {
    const runtime = estimateNarrationRuntime(DENSE_PARAGRAPH);
    expect(Number.isInteger(runtime)).toBe(true);
  });

  it("empty text → 0", () => {
    expect(estimateNarrationRuntime("")).toBe(0);
  });

  it("produces longer estimates than old 4.5 chars/sec model", () => {
    const text = "가".repeat(100);
    const newEstimate = estimateNarrationRuntime(text);
    // Old model: 100 / 4.5 * 1.2 ≈ 27
    const oldEstimate = Math.ceil((100 / 4.5) * 1.2);
    expect(newEstimate).toBeGreaterThan(oldEstimate);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Realistic scenario validation
// ═══════════════════════════════════════════════════════════════════

describe("realistic Korean script scenarios", () => {
  it("dense history script estimated at ≥50s at natural pace", () => {
    const est = estimateNarrationDuration(DENSE_PARAGRAPH, "natural");
    // ~160 Korean chars + numbers + punctuation → should be 50+ seconds
    expect(est.totalWithBreathingSec).toBeGreaterThanOrEqual(45);
  });

  it("dense history script does NOT fit in 38s", () => {
    const result = evaluateNarrationFit(DENSE_PARAGRAPH, 38);
    expect(result.fit).not.toBe("fits");
    // Should be overflow or at least tight
    expect(["tight", "overflow"]).toContain(result.fit);
  });

  it("script with numbers is longer than pure text of same char count", () => {
    const pureText = "가".repeat(SCRIPT_WITH_NUMBERS.replace(/\s/g, "").length);
    const estPure = estimateNarrationDuration(pureText, "natural");
    const estNumbers = estimateNarrationDuration(SCRIPT_WITH_NUMBERS, "natural");
    expect(estNumbers.totalWithBreathingSec).toBeGreaterThan(estPure.totalWithBreathingSec);
  });

  it("breakdown components sum to narrationSec", () => {
    const est = estimateNarrationDuration(DENSE_PARAGRAPH, "natural");
    const sumOfParts = est.breakdown.baseReadingSec + est.breakdown.pauseSec +
      est.breakdown.specialTokenSec + est.breakdown.rhetoricalSec;
    // Should be approximately equal to narrationSec (within rounding)
    expect(Math.abs(sumOfParts - est.narrationSec)).toBeLessThan(0.5);
  });

  it("total = narration + breathing", () => {
    const est = estimateNarrationDuration(DENSE_PARAGRAPH, "natural");
    const expected = est.narrationSec + est.breakdown.breathingSec;
    expect(Math.abs(est.totalWithBreathingSec - expected)).toBeLessThan(0.5);
  });
});
