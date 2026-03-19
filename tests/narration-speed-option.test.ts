/**
 * narration-speed-option.test.ts — 나레이션 속도 옵션 end-to-end 검증
 */

import { describe, it, expect } from "vitest";
import { estimateNarrationRuntime, KO_NATURAL_CHARS_PER_SEC, KO_FAST_CHARS_PER_SEC } from "../src/lib/narration-timing";
import { estimateRuntime } from "../src/lib/script-analyzer";

const SAMPLE_SCRIPT = `스파르타 300 전사, 다들 영화 봐서 알 거임.
기원전 480년 테르모필레 협곡에서 페르시아 대군을 막아낸 전설의 인간 병기들임.
근데 만약 이 300명이 시공간을 넘어 일본 전국시대에 떨어졌다면?
사무라이 300명과 정면으로 맞붙는다면 누가 이길까?`;

describe("나레이션 속도 상수", () => {
  it("natural = 4.0자/초", () => {
    expect(KO_NATURAL_CHARS_PER_SEC).toBe(4.0);
  });

  it("fast = 5.5자/초", () => {
    expect(KO_FAST_CHARS_PER_SEC).toBe(5.5);
  });
});

describe("estimateNarrationRuntime — 속도 옵션 반영", () => {
  it("fast가 natural보다 짧은 런타임", () => {
    const natural = estimateNarrationRuntime(SAMPLE_SCRIPT, "natural");
    const fast = estimateNarrationRuntime(SAMPLE_SCRIPT, "fast");
    expect(fast).toBeLessThan(natural);
  });

  it("기본값(undefined)은 natural과 동일", () => {
    const defaultVal = estimateNarrationRuntime(SAMPLE_SCRIPT);
    const natural = estimateNarrationRuntime(SAMPLE_SCRIPT, "natural");
    expect(defaultVal).toBe(natural);
  });

  it("fast 런타임은 natural의 약 73% (4.0/5.5 ≈ 0.727)", () => {
    const natural = estimateNarrationRuntime(SAMPLE_SCRIPT, "natural");
    const fast = estimateNarrationRuntime(SAMPLE_SCRIPT, "fast");
    const ratio = fast / natural;
    // 5.5/4.0 = 1.375x 빠름 → 비율은 약 0.72-0.78 범위
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(0.85);
  });

  it("빈 텍스트는 속도와 무관하게 0", () => {
    expect(estimateNarrationRuntime("", "natural")).toBe(0);
    expect(estimateNarrationRuntime("", "fast")).toBe(0);
  });
});

describe("estimateRuntime — narrationSpeed 파라미터", () => {
  it("fast 속도가 실제 계산에 반영됨", () => {
    const natural = estimateRuntime(SAMPLE_SCRIPT, "natural");
    const fast = estimateRuntime(SAMPLE_SCRIPT, "fast");
    expect(fast).toBeLessThan(natural);
  });

  it("기본값은 natural", () => {
    const defaultVal = estimateRuntime(SAMPLE_SCRIPT);
    const natural = estimateRuntime(SAMPLE_SCRIPT, "natural");
    expect(defaultVal).toBe(natural);
  });
});

describe("실제 시나리오 런타임 비교", () => {
  const LONG_SCRIPT = `스파르타 300 전사, 다들 영화 봐서 알 거임.
기원전 480년 테르모필레 협곡에서 페르시아 대군을 막아낸 전설의 인간 병기들임.
근데 만약 이 300명이 시공간을 넘어 일본 전국시대에 떨어졌다면?
사무라이 300명과 정면으로 맞붙는다면 누가 이길까?
일단 장비부터 팩트 체크해보겠음.
스파르타는 청동 갑옷에 거대한 아스피스 방패, 그리고 긴 창을 썼음.
반면 16세기 사무라이는 강철 카타나와 철제 갑옷, 그리고 야리라는 긴 창을 썼음.
재질만 보면 청동보다 강철이 훨씬 강하니까 사무라이가 압승할 것 같음.
근데 실제 전투 양상은 완전히 다르게 흘러갈 가능성이 높음.`;

  it("긴 시나리오에서 fast=5.5자/초는 natural 대비 약 25-30% 단축", () => {
    const natural = estimateNarrationRuntime(LONG_SCRIPT, "natural");
    const fast = estimateNarrationRuntime(LONG_SCRIPT, "fast");
    const saved = natural - fast;
    const savedPct = saved / natural;
    expect(savedPct).toBeGreaterThan(0.20);
    expect(savedPct).toBeLessThan(0.40);
    console.log(`Runtime: natural=${natural}s, fast=${fast}s, saved=${saved}s (${Math.round(savedPct * 100)}%)`);
  });
});
