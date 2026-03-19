/**
 * narration-speed-option.test.ts — 나레이션 속도 3단계 end-to-end 검증
 *
 * 3단계: slow(3자/초) / natural(4자/초) / fast(5.5자/초)
 */

import { describe, it, expect } from "vitest";
import {
  estimateNarrationRuntime,
  estimateNarrationDuration,
  KO_SLOW_CHARS_PER_SEC,
  KO_NATURAL_CHARS_PER_SEC,
  KO_FAST_CHARS_PER_SEC,
} from "../src/lib/narration-timing";
import { estimateRuntime } from "../src/lib/script-analyzer";

const SAMPLE_SCRIPT = `스파르타 300 전사, 다들 영화 봐서 알 거임.
기원전 480년 테르모필레 협곡에서 페르시아 대군을 막아낸 전설의 인간 병기들임.
근데 만약 이 300명이 시공간을 넘어 일본 전국시대에 떨어졌다면?
사무라이 300명과 정면으로 맞붙는다면 누가 이길까?`;

const LONG_SCRIPT = `스파르타 300 전사, 다들 영화 봐서 알 거임.
기원전 480년 테르모필레 협곡에서 페르시아 대군을 막아낸 전설의 인간 병기들임.
근데 만약 이 300명이 시공간을 넘어 일본 전국시대에 떨어졌다면?
사무라이 300명과 정면으로 맞붙는다면 누가 이길까?
일단 장비부터 팩트 체크해보겠음.
스파르타는 청동 갑옷에 거대한 아스피스 방패, 그리고 긴 창을 썼음.
반면 16세기 사무라이는 강철 카타나와 철제 갑옷, 그리고 야리라는 긴 창을 썼음.
재질만 보면 청동보다 강철이 훨씬 강하니까 사무라이가 압승할 것 같음.
근데 실제 전투 양상은 완전히 다르게 흘러갈 가능성이 높음.`;

// ═══════════════════════════════════════════════════════════════════
// 1. 속도 상수 검증
// ═══════════════════════════════════════════════════════════════════

describe("나레이션 속도 상수 — 3단계", () => {
  it("slow = 3.0자/초", () => {
    expect(KO_SLOW_CHARS_PER_SEC).toBe(3.0);
  });

  it("natural = 4.0자/초", () => {
    expect(KO_NATURAL_CHARS_PER_SEC).toBe(4.0);
  });

  it("fast = 5.5자/초", () => {
    expect(KO_FAST_CHARS_PER_SEC).toBe(5.5);
  });

  it("slow < natural < fast 순서", () => {
    expect(KO_SLOW_CHARS_PER_SEC).toBeLessThan(KO_NATURAL_CHARS_PER_SEC);
    expect(KO_NATURAL_CHARS_PER_SEC).toBeLessThan(KO_FAST_CHARS_PER_SEC);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. estimateNarrationRuntime — 3단계 반영
// ═══════════════════════════════════════════════════════════════════

describe("estimateNarrationRuntime — 3단계 속도 반영", () => {
  it("런타임 순서: slow > natural > fast", () => {
    const slow = estimateNarrationRuntime(SAMPLE_SCRIPT, "slow");
    const natural = estimateNarrationRuntime(SAMPLE_SCRIPT, "natural");
    const fast = estimateNarrationRuntime(SAMPLE_SCRIPT, "fast");
    expect(slow).toBeGreaterThan(natural);
    expect(natural).toBeGreaterThan(fast);
  });

  it("기본값(undefined)은 natural과 동일", () => {
    const defaultVal = estimateNarrationRuntime(SAMPLE_SCRIPT);
    const natural = estimateNarrationRuntime(SAMPLE_SCRIPT, "natural");
    expect(defaultVal).toBe(natural);
  });

  it("slow는 natural보다 약 30% 이상 긴 런타임 (4.0/3.0 ≈ 1.33)", () => {
    const slow = estimateNarrationRuntime(SAMPLE_SCRIPT, "slow");
    const natural = estimateNarrationRuntime(SAMPLE_SCRIPT, "natural");
    const ratio = slow / natural;
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.5);
  });

  it("fast 런타임은 natural의 약 73% (4.0/5.5 ≈ 0.727)", () => {
    const natural = estimateNarrationRuntime(SAMPLE_SCRIPT, "natural");
    const fast = estimateNarrationRuntime(SAMPLE_SCRIPT, "fast");
    const ratio = fast / natural;
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(0.85);
  });

  it("빈 텍스트는 속도와 무관하게 0", () => {
    expect(estimateNarrationRuntime("", "slow")).toBe(0);
    expect(estimateNarrationRuntime("", "natural")).toBe(0);
    expect(estimateNarrationRuntime("", "fast")).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. estimateNarrationDuration 구조 검증
// ═══════════════════════════════════════════════════════════════════

describe("estimateNarrationDuration — pace별 내부 구조", () => {
  it("slow의 charsPerSec = 3.0", () => {
    const est = estimateNarrationDuration(SAMPLE_SCRIPT, "slow");
    expect(est.metrics.charsPerSec).toBe(3.0);
    expect(est.pace).toBe("slow");
  });

  it("natural의 charsPerSec = 4.0", () => {
    const est = estimateNarrationDuration(SAMPLE_SCRIPT, "natural");
    expect(est.metrics.charsPerSec).toBe(4.0);
    expect(est.pace).toBe("natural");
  });

  it("fast의 charsPerSec = 5.5", () => {
    const est = estimateNarrationDuration(SAMPLE_SCRIPT, "fast");
    expect(est.metrics.charsPerSec).toBe(5.5);
    expect(est.pace).toBe("fast");
  });

  it("slow의 breathing room이 가장 큼 (1.20x)", () => {
    const slow = estimateNarrationDuration(SAMPLE_SCRIPT, "slow");
    const natural = estimateNarrationDuration(SAMPLE_SCRIPT, "natural");
    const fast = estimateNarrationDuration(SAMPLE_SCRIPT, "fast");
    // breathing = narrationSec * (breathMultiplier - 1)
    const slowBreathRatio = slow.breakdown.breathingSec / slow.narrationSec;
    const naturalBreathRatio = natural.breakdown.breathingSec / natural.narrationSec;
    const fastBreathRatio = fast.breakdown.breathingSec / fast.narrationSec;
    expect(slowBreathRatio).toBeGreaterThan(naturalBreathRatio);
    expect(naturalBreathRatio).toBeGreaterThan(fastBreathRatio);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. estimateRuntime (script-analyzer) — 3단계 연동
// ═══════════════════════════════════════════════════════════════════

describe("estimateRuntime — narrationSpeed 3단계", () => {
  it("slow > natural > fast 순서", () => {
    const slow = estimateRuntime(SAMPLE_SCRIPT, "slow");
    const natural = estimateRuntime(SAMPLE_SCRIPT, "natural");
    const fast = estimateRuntime(SAMPLE_SCRIPT, "fast");
    expect(slow).toBeGreaterThan(natural);
    expect(natural).toBeGreaterThan(fast);
  });

  it("기본값은 natural", () => {
    const defaultVal = estimateRuntime(SAMPLE_SCRIPT);
    const natural = estimateRuntime(SAMPLE_SCRIPT, "natural");
    expect(defaultVal).toBe(natural);
  });

  it("slow가 실제 계산에 반영됨 (fast와 확실히 다름)", () => {
    const slow = estimateRuntime(SAMPLE_SCRIPT, "slow");
    const fast = estimateRuntime(SAMPLE_SCRIPT, "fast");
    // 3.0 vs 5.5 → slow는 fast의 약 1.8배
    const ratio = slow / fast;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. 실제 시나리오 런타임 비교
// ═══════════════════════════════════════════════════════════════════

describe("실제 시나리오 — 3단계 런타임 비교", () => {
  it("긴 시나리오에서 3단계 런타임 구간별 비교", () => {
    const slow = estimateNarrationRuntime(LONG_SCRIPT, "slow");
    const natural = estimateNarrationRuntime(LONG_SCRIPT, "natural");
    const fast = estimateNarrationRuntime(LONG_SCRIPT, "fast");

    // slow vs natural: 약 25-40% 증가
    const slowIncrease = (slow - natural) / natural;
    expect(slowIncrease).toBeGreaterThan(0.20);
    expect(slowIncrease).toBeLessThan(0.50);

    // fast vs natural: 약 20-35% 감소
    const fastDecrease = (natural - fast) / natural;
    expect(fastDecrease).toBeGreaterThan(0.20);
    expect(fastDecrease).toBeLessThan(0.40);

    console.log(`3-tier runtime: slow=${slow}s, natural=${natural}s, fast=${fast}s`);
    console.log(`  slow vs natural: +${Math.round(slowIncrease * 100)}%`);
    console.log(`  fast vs natural: -${Math.round(fastDecrease * 100)}%`);
  });

  it("극단적으로 짧은 텍스트에서도 순서 유지", () => {
    const short = "안녕하세요.";
    const slow = estimateNarrationRuntime(short, "slow");
    const natural = estimateNarrationRuntime(short, "natural");
    const fast = estimateNarrationRuntime(short, "fast");
    expect(slow).toBeGreaterThanOrEqual(natural);
    expect(natural).toBeGreaterThanOrEqual(fast);
  });
});
