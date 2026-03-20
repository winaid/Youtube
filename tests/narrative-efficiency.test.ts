/**
 * narrative-efficiency.test.ts
 *
 * 핵심 검증: 긴 서사/설명형 콘텐츠가 불필요하게 ~3초 평균 컷으로
 * 분쇄되지 않고, 효율적인 생성 구조를 유지하는지 검증.
 *
 * VEO은 최대 8초 네이티브 생성을 지원.
 * 서사형 콘텐츠는 7~10초 평균 컷 길이가 자연스럽다.
 */
import { describe, it, expect } from "vitest";
import { estimateAutoEditPlan } from "../src/lib/story-duration-estimator";
import { densifyCuts, recommendMinimumCutCount, recommendCutCountRange } from "../src/lib/sequence-density";

// ═══════════════════════════════════════════════════════════════════
// 테스트 스토리들
// ═══════════════════════════════════════════════════════════════════

// ~210초 역사 설명형 (26문장)
const HISTORICAL_EXPLAINER = Array.from({ length: 26 }, (_, i) =>
  `장면 ${i + 1}: 역사적 사건이 전개된다. 시대적 배경이 묘사된다.`
).join("\n");

// ~120초 서사 (15문장)
const NARRATIVE_STORY = Array.from({ length: 15 }, (_, i) =>
  `장면 ${i + 1}: 주인공이 새로운 도전에 직면한다. 감정이 고조된다.`
).join("\n");

// ~60초 짧은 설명 (8문장)
const SHORT_EXPLAINER = Array.from({ length: 8 }, (_, i) =>
  `포인트 ${i + 1}: 핵심 개념을 설명한다. 예시가 제시된다.`
).join("\n");

// ═══════════════════════════════════════════════════════════════════
// A. 긴 프로젝트(~210초)에서 3초 수렴이 발생하지 않음
// ═══════════════════════════════════════════════════════════════════

describe("A. 210초 역사 설명형 — 고밀도 정책 적용", () => {
  it("계획 단계에서 컷 수가 30 이하", () => {
    const plan = estimateAutoEditPlan(HISTORICAL_EXPLAINER);
    expect(plan.cutCount).toBeLessThanOrEqual(30);
    expect(plan.cutDuration).toBeGreaterThanOrEqual(5);
  });

  it("densifyCuts가 고밀도 정책에 맞게 컷 수를 늘림", () => {
    const plan = estimateAutoEditPlan(HISTORICAL_EXPLAINER);
    const rawCuts = Array.from({ length: plan.cutCount }, (_, i) => ({
      cutNumber: i + 1,
      durationSec: plan.cutDuration,
    }));
    const totalSec = rawCuts.reduce((s, c) => s + c.durationSec, 0);
    const densified = densifyCuts(rawCuts, totalSec);
    const minCuts = recommendMinimumCutCount(totalSec);

    // 새 정책: densifyCuts가 최소 컷 수까지 분할
    expect(densified.length).toBeGreaterThanOrEqual(minCuts);
  });

  it("최종 평균 컷 길이가 3초 이상 유지", () => {
    const plan = estimateAutoEditPlan(HISTORICAL_EXPLAINER);
    const rawCuts = Array.from({ length: plan.cutCount }, (_, i) => ({
      cutNumber: i + 1,
      durationSec: plan.cutDuration,
    }));
    const totalSec = rawCuts.reduce((s, c) => s + c.durationSec, 0);
    const densified = densifyCuts(rawCuts, totalSec);
    const avgSec = totalSec / densified.length;

    // 새 고밀도 정책: 210초 → ~56컷 → 평균 ~3.75초
    expect(avgSec).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. 120초 서사형
// ═══════════════════════════════════════════════════════════════════

describe("B. 120초 서사형 — 효율적 컷 구조", () => {
  it("계획 단계 컷 수가 합리적 범위", () => {
    const plan = estimateAutoEditPlan(NARRATIVE_STORY);
    expect(plan.cutCount).toBeGreaterThanOrEqual(8);
    expect(plan.cutCount).toBeLessThanOrEqual(30);
  });

  it("densifyCuts가 고밀도 정책에 맞게 컷 수를 조정", () => {
    const plan = estimateAutoEditPlan(NARRATIVE_STORY);
    const rawCuts = Array.from({ length: plan.cutCount }, (_, i) => ({
      cutNumber: i + 1,
      durationSec: plan.cutDuration,
    }));
    const totalSec = rawCuts.reduce((s, c) => s + c.durationSec, 0);
    const densified = densifyCuts(rawCuts, totalSec);
    const minCuts = recommendMinimumCutCount(totalSec);

    // 새 정책: densifyCuts가 최소 컷 수까지 분할
    expect(densified.length).toBeGreaterThanOrEqual(minCuts);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. recommendMinimumCutCount가 더 이상 과도하지 않음
// ═══════════════════════════════════════════════════════════════════

describe("C. recommendMinimumCutCount 새 정책", () => {
  it("15초 → minimum 4 (숏폼 리듬)", () => {
    expect(recommendMinimumCutCount(15)).toBe(4);
  });

  it("210초 → minimum 27 (ceil(210 / 8))", () => {
    expect(recommendMinimumCutCount(210)).toBe(27);
  });

  it("120초 → minimum 15 (ceil(120 / 8))", () => {
    expect(recommendMinimumCutCount(120)).toBe(15);
  });

  it("300초 → minimum 38 (ceil(300 / 8))", () => {
    expect(recommendMinimumCutCount(300)).toBe(38);
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. recommendCutCountRange가 서사 친화적
// ═══════════════════════════════════════════════════════════════════

describe("D. recommendCutCountRange 서사 친화적 범위", () => {
  it("15초 → {6, 12}", () => {
    // floor(15/8)=1 full (8s → {3,6}) + remainder 7s → {3,6} = {6, 12}
    expect(recommendCutCountRange(15)).toEqual({ min: 6, max: 12 });
  });

  it("120초 → {45, 90}", () => {
    // 15 full segments × {3, 6} = {45, 90}
    expect(recommendCutCountRange(120)).toEqual({ min: 45, max: 90 });
  });

  it("210초 → {79, 158}", () => {
    // floor(210/8)=26 full × {3,6} + remainder 2s → {1,2} = {79, 158}
    expect(recommendCutCountRange(210)).toEqual({ min: 79, max: 158 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. 생성 효율성 — 실제 VEO 생성 횟수
// ═══════════════════════════════════════════════════════════════════

describe("E. 생성 효율성", () => {
  it("210초 프로젝트: 고밀도 정책에 따라 최소 컷 수 충족", () => {
    const plan = estimateAutoEditPlan(HISTORICAL_EXPLAINER);
    const rawCuts = Array.from({ length: plan.cutCount }, (_, i) => ({
      cutNumber: i + 1,
      durationSec: plan.cutDuration,
    }));
    const totalSec = rawCuts.reduce((s, c) => s + c.durationSec, 0);
    const densified = densifyCuts(rawCuts, totalSec);
    const minCuts = recommendMinimumCutCount(totalSec);

    // 새 고밀도 정책: densifyCuts가 최소 컷 수까지 분할
    expect(densified.length).toBeGreaterThanOrEqual(minCuts);
  });

  it("개별 컷 duration이 VEO 최대(8초) 이내", () => {
    const plan = estimateAutoEditPlan(HISTORICAL_EXPLAINER);
    const rawCuts = Array.from({ length: plan.cutCount }, (_, i) => ({
      cutNumber: i + 1,
      durationSec: plan.cutDuration,
    }));
    const totalSec = rawCuts.reduce((s, c) => s + c.durationSec, 0);
    const densified = densifyCuts(rawCuts, totalSec);

    for (const cut of densified) {
      expect(cut.durationSec).toBeLessThanOrEqual(8);
      // 고밀도 정책: densifyCuts가 2초까지 분할 가능 (2초 이하는 분할 중단)
      expect(cut.durationSec).toBeGreaterThanOrEqual(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. dense 프리셋은 여전히 빠른 편집을 지원
// ═══════════════════════════════════════════════════════════════════

import { densityPresetToRange } from "../src/lib/sequence-density";

describe("F. dense 프리셋으로 빠른 편집 선택 가능", () => {
  it("dense(15초) → 더 많은 컷 추천", () => {
    const normal = recommendCutCountRange(15);
    const dense = densityPresetToRange("dense", 15);
    expect(dense.min).toBeGreaterThanOrEqual(normal.max);
  });

  it("dense(120초) → 90~92컷 추천", () => {
    const dense = densityPresetToRange("dense", 120);
    expect(dense.min).toBeGreaterThanOrEqual(90);
  });

  it("sparse(120초) → 44~45컷 추천", () => {
    const sparse = densityPresetToRange("sparse", 120);
    expect(sparse.min).toBeGreaterThanOrEqual(44);
    expect(sparse.max).toBeLessThanOrEqual(45);
  });
});
