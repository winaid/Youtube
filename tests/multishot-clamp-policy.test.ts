/**
 * multishot-clamp-policy.test.ts — multiShot secPerCut 기반 clamp 정책 테스트
 *
 * 핵심 규칙:
 * - secPerCut <= 3: multiShot 금지 (길이 0)
 * - secPerCut <= 5: multiShot 최대 2개
 * - secPerCut > 5: multiShot 최대 3개
 * - fast density / targetCuts >= 4: multiShot 기본 비활성화 또는 clamp
 */

import { describe, it, expect } from "vitest";
import { recommendMinimumCutCount, recommendCutCountRange } from "@/lib/sequence-density";

// ═══════════════════════════════════════════════════════════════════
// multiShot clamp 로직 (useVideoGeneration + _kling-api 공통 로직 재현)
// ═══════════════════════════════════════════════════════════════════

function clampMultiShot(
  multiShot: Array<{ index: number; prompt: string; duration: string }>,
  durationSec: number,
): Array<{ index: number; prompt: string; duration: string }> {
  if (durationSec <= 3) return []; // 금지
  const maxShots = durationSec <= 5 ? 2 : 3;
  return multiShot.slice(0, maxShots);
}

describe("multiShot clamp policy", () => {
  const threeShots = [
    { index: 1, prompt: "Location establishing shot", duration: "3" },
    { index: 2, prompt: "Situation evidence shot", duration: "3" },
    { index: 3, prompt: "Emotional anchor shot", duration: "2" },
  ];

  // A. secPerCut <= 3: multiShot 금지
  it("3초 이하에서 multiShot 완전 제거", () => {
    expect(clampMultiShot(threeShots, 3)).toHaveLength(0);
    expect(clampMultiShot(threeShots, 2)).toHaveLength(0);
    expect(clampMultiShot(threeShots, 1)).toHaveLength(0);
  });

  // B. secPerCut <= 5: multiShot 최대 2개
  it("4~5초에서 multiShot 최대 2개로 clamp", () => {
    expect(clampMultiShot(threeShots, 4)).toHaveLength(2);
    expect(clampMultiShot(threeShots, 5)).toHaveLength(2);
  });

  it("5초에서 2개 이하 multiShot은 그대로 통과", () => {
    const twoShots = threeShots.slice(0, 2);
    expect(clampMultiShot(twoShots, 5)).toHaveLength(2);
    const oneShot = threeShots.slice(0, 1);
    expect(clampMultiShot(oneShot, 5)).toHaveLength(1);
  });

  // C. secPerCut > 5: multiShot 최대 3개
  it("6초 이상에서 multiShot 최대 3개 허용", () => {
    expect(clampMultiShot(threeShots, 6)).toHaveLength(3);
    expect(clampMultiShot(threeShots, 8)).toHaveLength(3);
    expect(clampMultiShot(threeShots, 10)).toHaveLength(3);
    expect(clampMultiShot(threeShots, 15)).toHaveLength(3);
  });

  it("6초에서 4개 multiShot은 3개로 clamp", () => {
    const fourShots = [...threeShots, { index: 4, prompt: "Extra", duration: "2" }];
    expect(clampMultiShot(fourShots, 6)).toHaveLength(3);
    expect(clampMultiShot(fourShots, 10)).toHaveLength(3);
  });

  // D. 빈 multiShot은 항상 빈 배열
  it("빈 multiShot 입력 시 빈 배열 반환", () => {
    expect(clampMultiShot([], 3)).toHaveLength(0);
    expect(clampMultiShot([], 8)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// fast density에서 독립 컷 수 증가 확인
// ═══════════════════════════════════════════════════════════════════

describe("fast density — 독립 컷 수 우선", () => {
  it("6초 segment에서 최소 2컷 (독립 클립 2개)", () => {
    expect(recommendMinimumCutCount(6)).toBeGreaterThanOrEqual(2);
  });

  it("8초 segment에서 최소 3컷 (독립 클립 3개)", () => {
    expect(recommendMinimumCutCount(8)).toBeGreaterThanOrEqual(3);
  });

  it("12초 segment에서 최소 4컷", () => {
    expect(recommendMinimumCutCount(12)).toBeGreaterThanOrEqual(4);
  });

  it("15초 segment에서 최소 5컷", () => {
    expect(recommendMinimumCutCount(15)).toBeGreaterThanOrEqual(5);
  });

  it("15초에서 cut range max >= 5", () => {
    const range = recommendCutCountRange(15);
    expect(range.max).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// fast density + multiShot clamp 조합 테스트
// ═══════════════════════════════════════════════════════════════════

describe("fast density + multiShot clamp 조합", () => {
  it("15초 segment, 5컷 = 각 3초 → multiShot 전부 금지", () => {
    const cutCount = 5;
    const secPerCut = Math.floor(15 / cutCount); // 3초
    expect(secPerCut).toBe(3);
    const clamped = clampMultiShot(
      [{ index: 1, prompt: "A", duration: "1" }, { index: 2, prompt: "B", duration: "2" }],
      secPerCut,
    );
    expect(clamped).toHaveLength(0);
  });

  it("12초 segment, 4컷 = 각 3초 → multiShot 금지", () => {
    const secPerCut = 3;
    const clamped = clampMultiShot(
      [{ index: 1, prompt: "A", duration: "1" }, { index: 2, prompt: "B", duration: "2" }],
      secPerCut,
    );
    expect(clamped).toHaveLength(0);
  });

  it("10초 segment, 2컷 = 각 5초 → multiShot 최대 2개", () => {
    const secPerCut = 5;
    const shots = [
      { index: 1, prompt: "A", duration: "2" },
      { index: 2, prompt: "B", duration: "2" },
      { index: 3, prompt: "C", duration: "1" },
    ];
    const clamped = clampMultiShot(shots, secPerCut);
    expect(clamped).toHaveLength(2);
  });

  it("15초 segment, 2컷 = 각 7.5초 → multiShot 최대 3개", () => {
    const secPerCut = 8; // rounded
    const shots = [
      { index: 1, prompt: "A", duration: "3" },
      { index: 2, prompt: "B", duration: "3" },
      { index: 3, prompt: "C", duration: "2" },
    ];
    const clamped = clampMultiShot(shots, secPerCut);
    expect(clamped).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Kling 1회 요청 = 독립 컷 확인
// ═══════════════════════════════════════════════════════════════════

describe("Kling 1회 요청 = 하나의 독립 컷", () => {
  it("secPerCut 3초에서 Kling 요청에 multiShot 미포함 시뮬레이션", () => {
    // useVideoGeneration submit body 시뮬레이션
    const cut = { durationSec: 3, multiShot: [{ index: 1, prompt: "A", duration: "1" }, { index: 2, prompt: "B", duration: "2" }] };
    const dur = cut.durationSec;
    const shouldIncludeMultiShot = dur > 3 && cut.multiShot.length > 0;
    expect(shouldIncludeMultiShot).toBe(false);
  });

  it("secPerCut 8초에서 Kling 요청에 multiShot 포함 (clamped)", () => {
    const cut = { durationSec: 8, multiShot: [{ index: 1, prompt: "A", duration: "3" }, { index: 2, prompt: "B", duration: "3" }, { index: 3, prompt: "C", duration: "2" }] };
    const dur = cut.durationSec;
    const shouldIncludeMultiShot = dur > 3 && cut.multiShot.length > 0;
    expect(shouldIncludeMultiShot).toBe(true);
    const maxShots = dur <= 5 ? 2 : 3;
    expect(cut.multiShot.slice(0, maxShots)).toHaveLength(3);
  });
});
