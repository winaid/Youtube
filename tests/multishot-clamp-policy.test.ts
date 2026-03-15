/**
 * multishot-clamp-policy.test.ts — capability 기반 multiShot clamp 정책 테스트
 *
 * O3 모델 (기본):
 * - secPerCut <= 3: multiShot 금지
 * - secPerCut <= 5: 최대 2개
 * - secPerCut <= 7: 최대 3개
 * - secPerCut <= 10: 최대 4개
 * - secPerCut > 10: 최대 6개 (O3 하드 리밋)
 *
 * v3 모델 (fallback):
 * - secPerCut <= 3: multiShot 금지
 * - secPerCut <= 5: 최대 2개
 * - secPerCut > 5: 최대 3개 (v3 하드 리밋)
 */

import { describe, it, expect } from "vitest";
import {
  getMaxShots,
  getCapability,
  normalizeMultiShots,
  KLING_DEFAULT_TEXT_MODEL,
  KLING_MODELS,
  resolveModel,
  resolveModelWithFallback,
  isO3Model,
  isV3Model,
} from "@/lib/kling-capability";
import { recommendMinimumCutCount, recommendCutCountRange } from "@/lib/sequence-density";

// ═══════════════════════════════════════════════════════════════════
// 1. O3 모델 capability 기본 테스트
// ═══════════════════════════════════════════════════════════════════

describe("O3 모델 capability", () => {
  const o3 = KLING_DEFAULT_TEXT_MODEL;

  it("O3 기본 capability 값", () => {
    const cap = getCapability(o3);
    expect(cap.maxShots).toBe(6);
    expect(cap.minShotDuration).toBe(2);
    expect(cap.maxDuration).toBe(15);
    expect(cap.minDuration).toBe(3);
    expect(cap.supportsMultiShot).toBe(true);
    expect(cap.supportsSound).toBe(true);
    expect(cap.supportsElements).toBe(true);
  });

  it("O3 기본 모델 ID가 o3 계열", () => {
    expect(isO3Model(o3)).toBe(true);
    expect(isV3Model(o3)).toBe(false);
  });

  it("KLING_MODELS.TEXT_TO_VIDEO = O3", () => {
    expect(KLING_MODELS.TEXT_TO_VIDEO).toContain("-o3-");
  });

  it("KLING_MODELS.IMAGE_TO_VIDEO = O3", () => {
    expect(KLING_MODELS.IMAGE_TO_VIDEO).toContain("-o3-");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. O3 getMaxShots — duration 기반 자연스러운 상한
// ═══════════════════════════════════════════════════════════════════

describe("O3 getMaxShots — duration 기반 policy", () => {
  const o3 = KLING_DEFAULT_TEXT_MODEL;

  it("3초 이하: multiShot 금지", () => {
    expect(getMaxShots(o3, 1)).toBe(0);
    expect(getMaxShots(o3, 2)).toBe(0);
    expect(getMaxShots(o3, 3)).toBe(0);
  });

  it("4~5초: 최대 2개", () => {
    expect(getMaxShots(o3, 4)).toBe(2);
    expect(getMaxShots(o3, 5)).toBe(2);
  });

  it("6~7초: 최대 3개", () => {
    expect(getMaxShots(o3, 6)).toBe(3);
    expect(getMaxShots(o3, 7)).toBe(3);
  });

  it("8~10초: 최대 4개", () => {
    expect(getMaxShots(o3, 8)).toBe(4);
    expect(getMaxShots(o3, 9)).toBe(4);
    expect(getMaxShots(o3, 10)).toBe(4);
  });

  it("11~15초: 최대 6개 (O3 하드 리밋, 물리적 상한 내)", () => {
    expect(getMaxShots(o3, 11)).toBe(5); // floor(11/2) = 5
    expect(getMaxShots(o3, 12)).toBe(6);
    expect(getMaxShots(o3, 15)).toBe(6);
  });

  it("물리적 상한: floor(duration / minShotDuration) 초과 불가", () => {
    // O3 minShotDuration=2, so 5초 → floor(5/2)=2
    expect(getMaxShots(o3, 5)).toBeLessThanOrEqual(Math.floor(5 / 2));
    // 4초 → floor(4/2)=2
    expect(getMaxShots(o3, 4)).toBeLessThanOrEqual(Math.floor(4 / 2));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. v3 모델 capability — 레거시 fallback
// ═══════════════════════════════════════════════════════════════════

describe("v3 모델 capability (레거시 fallback)", () => {
  const v3 = "kling-v3-text-to-video";

  it("v3 capability: maxShots=3, minShotDuration=3", () => {
    const cap = getCapability(v3);
    expect(cap.maxShots).toBe(3);
    expect(cap.minShotDuration).toBe(3);
  });

  it("v3 getMaxShots: 3초 이하 금지", () => {
    expect(getMaxShots(v3, 3)).toBe(0);
  });

  it("v3 getMaxShots: 4~5초 최대 1개 (물리적 상한: floor(5/3)=1)", () => {
    expect(getMaxShots(v3, 4)).toBe(1); // floor(4/3)=1
    expect(getMaxShots(v3, 5)).toBe(1); // floor(5/3)=1, min(2, 3, 1)=1
  });

  it("v3 getMaxShots: 6~9초 최대 3개 제한", () => {
    expect(getMaxShots(v3, 6)).toBe(2); // floor(6/3)=2
    expect(getMaxShots(v3, 9)).toBe(3); // floor(9/3)=3
    expect(getMaxShots(v3, 10)).toBe(3); // min(3, 4, floor(10/3)=3)=3
    expect(getMaxShots(v3, 15)).toBe(3); // min(3, 6, 5)=3
  });

  it("v3 fallbackModelId = null (최종 레거시)", () => {
    expect(getCapability(v3).fallbackModelId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. normalizeMultiShots — 정규화 + index 재정렬 + duration 보정
// ═══════════════════════════════════════════════════════════════════

describe("normalizeMultiShots", () => {
  const o3 = KLING_DEFAULT_TEXT_MODEL;

  it("빈 배열 입력 → 빈 배열", () => {
    expect(normalizeMultiShots(o3, [], 8)).toHaveLength(0);
  });

  it("3초 이하 → multiShot 비활성", () => {
    const shots = [{ index: 1, prompt: "A", duration: "3" }];
    expect(normalizeMultiShots(o3, shots, 3)).toHaveLength(0);
  });

  it("O3 8초에서 6개 → 4개로 clamp", () => {
    const sixShots = Array.from({ length: 6 }, (_, i) => ({
      index: i + 1, prompt: `Shot ${i + 1}`, duration: "2",
    }));
    const result = normalizeMultiShots(o3, sixShots, 8);
    expect(result).toHaveLength(4); // getMaxShots(o3, 8) = 4
  });

  it("index 재정렬: slice 후에도 1-based 순차", () => {
    const shots = [
      { index: 3, prompt: "A", duration: "3" },
      { index: 7, prompt: "B", duration: "3" },
      { index: 5, prompt: "C", duration: "2" },
    ];
    const result = normalizeMultiShots(o3, shots, 8);
    expect(result.map(s => s.index)).toEqual([1, 2, 3]);
  });

  it("duration 보정: minShotDuration 미만 → 보정", () => {
    const shots = [
      { index: 1, prompt: "A", duration: "1" }, // O3 min=2 → 보정
      { index: 2, prompt: "B", duration: "4" },
    ];
    const result = normalizeMultiShots(o3, shots, 6);
    expect(parseInt(result[0].duration, 10)).toBeGreaterThanOrEqual(2);
  });

  it("duration 합 조정: 마지막 샷으로 remainder 흡수", () => {
    const shots = [
      { index: 1, prompt: "A", duration: "3" },
      { index: 2, prompt: "B", duration: "3" },
    ];
    const result = normalizeMultiShots(o3, shots, 8);
    const total = result.reduce((sum, s) => sum + parseInt(s.duration, 10), 0);
    expect(total).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. 모델 선택 + fallback
// ═══════════════════════════════════════════════════════════════════

describe("모델 선택 + fallback", () => {
  it("기본 모델은 O3 text-to-video", () => {
    expect(resolveModel(undefined, false)).toContain("-o3-text-to-video");
  });

  it("이미지 포함 시 O3 image-to-video", () => {
    expect(resolveModel(undefined, true)).toContain("-o3-image-to-video");
  });

  it("명시적 모델 지정 시 그대로 사용", () => {
    expect(resolveModel("kling-v3-text-to-video", false)).toBe("kling-v3-text-to-video");
  });

  it("O3 fallback → v3", () => {
    const [fallback, wasFallback] = resolveModelWithFallback("kling-o3-text-to-video");
    expect(fallback).toBe("kling-v3-text-to-video");
    expect(wasFallback).toBe(true);
  });

  it("v3 fallback → null (최종 레거시, 자기 자신 반환)", () => {
    const [fallback, wasFallback] = resolveModelWithFallback("kling-v3-text-to-video");
    expect(fallback).toBe("kling-v3-text-to-video");
    expect(wasFallback).toBe(false);
  });

  it("알 수 없는 모델 → O3 기본값", () => {
    const [fallback, wasFallback] = resolveModelWithFallback("kling-v99-unknown");
    expect(fallback).toContain("-o3-");
    expect(wasFallback).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. fast density + multiShot clamp 조합 (기존 테스트 유지)
// ═══════════════════════════════════════════════════════════════════

describe("fast density — 독립 컷 수 우선", () => {
  it("6초 segment에서 최소 1컷", () => {
    expect(recommendMinimumCutCount(6)).toBeGreaterThanOrEqual(1);
  });

  it("15초 segment에서 최소 1컷", () => {
    expect(recommendMinimumCutCount(15)).toBeGreaterThanOrEqual(1);
  });

  it("15초에서 cut range max >= 2", () => {
    const range = recommendCutCountRange(15);
    expect(range.max).toBeGreaterThanOrEqual(2);
  });
});

describe("fast density + capability clamp 조합", () => {
  const o3 = KLING_DEFAULT_TEXT_MODEL;

  it("15초 segment, 5컷 = 각 3초 → multiShot 금지", () => {
    expect(getMaxShots(o3, 3)).toBe(0);
  });

  it("10초 segment, 2컷 = 각 5초 → O3 최대 2개", () => {
    expect(getMaxShots(o3, 5)).toBe(2);
  });

  it("15초 segment, 1컷 = 15초 → O3 최대 6개", () => {
    expect(getMaxShots(o3, 15)).toBe(6);
  });

  it("12초 segment, 1컷 = 12초 → O3 최대 6개", () => {
    expect(getMaxShots(o3, 12)).toBe(6);
  });
});
