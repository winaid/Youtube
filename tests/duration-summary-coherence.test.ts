/**
 * duration-summary-coherence.test.ts
 *
 * 핵심 검증: densifyCuts 후 결과 요약의 정합성.
 * 사전 계획(estimateAutoEditPlan)과 최종 실제값(densifyCuts 후)이
 * 동시에 모순적으로 표시되지 않도록 보장.
 */
import { describe, it, expect } from "vitest";
import { estimateAutoEditPlan } from "../src/lib/story-duration-estimator";
import { densifyCuts, recommendMinimumCutCount } from "../src/lib/sequence-density";
import { buildDurationSummary } from "../src/lib/duration-reconciliation";

// 210초 급 긴 스토리 (약 26문장)
const LONG_STORY = Array.from({ length: 26 }, (_, i) =>
  `장면 ${i + 1}: 주인공이 여정을 계속한다. 새로운 상황이 펼쳐진다.`
).join("\n");

describe("duration summary coherence after density expansion", () => {
  it("사전 계획 컷 수와 밀도 보정 후 컷 수가 다를 수 있음을 인지", () => {
    const plan = estimateAutoEditPlan(LONG_STORY);
    // 사전 계획: 30컷 × ~7초
    expect(plan.cutCount).toBeGreaterThan(0);
    expect(plan.cutDuration).toBeGreaterThan(0);

    // 사전 계획대로 rawCuts 생성 시뮬레이션
    const rawCuts = Array.from({ length: plan.cutCount }, (_, i) => ({
      cutNumber: i + 1,
      durationSec: plan.cutDuration,
    }));

    const totalSec = rawCuts.reduce((s, c) => s + c.durationSec, 0);
    const minRequired = recommendMinimumCutCount(totalSec);

    // 밀도 보정이 필요한 경우 컷 수가 증가함
    const densified = densifyCuts(rawCuts, totalSec);

    if (minRequired > plan.cutCount) {
      expect(densified.length).toBeGreaterThanOrEqual(minRequired);
      expect(densified.length).toBeGreaterThan(plan.cutCount);
    }

    // 총 duration은 보존됨
    const densifiedTotal = densified.reduce((s, c) => s + c.durationSec, 0);
    expect(densifiedTotal).toBe(totalSec);
  });

  it("buildDurationSummary가 밀도 보정 후 실제 컷 수와 평균을 올바르게 반영", () => {
    const plan = estimateAutoEditPlan(LONG_STORY);
    const rawCuts = Array.from({ length: plan.cutCount }, (_, i) => ({
      cutNumber: i + 1,
      durationSec: plan.cutDuration,
    }));

    const totalSec = rawCuts.reduce((s, c) => s + c.durationSec, 0);
    const densified = densifyCuts(rawCuts, totalSec);

    const summary = buildDurationSummary({
      cuts: densified,
      requestedSecondsPerScene: 0, // auto mode
    });

    // headline에 실제 컷 수가 반영됨 (사전 계획 컷 수가 아님)
    expect(summary.actualSceneCount).toBe(densified.length);
    expect(summary.headline).toContain(`${densified.length}컷`);
    expect(summary.headline).toContain(`총 ${totalSec}초`);

    // 평균 duration이 정합적
    const avgSec = Math.round(totalSec / densified.length * 10) / 10;
    expect(summary.headline).toContain(`평균 ${avgSec}초`);
  });

  it("사전 계획 요약과 최종 요약이 같은 곱셈 수식을 사용하지 않음", () => {
    const plan = estimateAutoEditPlan(LONG_STORY);
    const rawCuts = Array.from({ length: plan.cutCount }, (_, i) => ({
      cutNumber: i + 1,
      durationSec: plan.cutDuration,
    }));

    const totalSec = rawCuts.reduce((s, c) => s + c.durationSec, 0);
    const densified = densifyCuts(rawCuts, totalSec);

    const summary = buildDurationSummary({
      cuts: densified,
      requestedSecondsPerScene: 0,
    });

    // auto 모드에서 곱셈 수식(N초 x M장면 = T초)은 사용하지 않음
    expect(summary.headline).not.toMatch(/\d+초\s*x\s*\d+/);
  });
});
