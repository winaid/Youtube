/**
 * shortform-rhythm-reconciliation.test.ts
 *
 * 숏폼 리듬 reconciliation 테스트 — 10개 시나리오
 *
 * 핵심 원칙: "숏폼 리듬 > 감독 스타일"
 * - totalDuration 기준으로 secPerCut/targetCuts가 모순 없이 reconcile
 * - 13~15초 구간 특별 취급
 * - 느린 감독이어도 density 보장
 */

import { describe, it, expect } from "vitest";
import {
  resolveShortformBandPolicy,
  reconcileShortformPlan,
  applyShortformVocabularyFilter,
  buildReconciliationExplanation,
} from "../functions/api/_shortform-rhythm";
import { recommendMinimumCutCount, recommendCutCountRange } from "../functions/api/_sequence-density";

// ═══════════════════════════════════════════════════════════════════
// 1. 10초 입력 → 최소 4컷 유지 (10~15초 = shortform-critical)
// ═══════════════════════════════════════════════════════════════════
describe("10초 입력", () => {
  it("최소 4컷을 유지한다 (10~15초 = shortform-critical)", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 10,
      densityTargetCuts: 3,
      personaSecPerCut: 5,
    });
    expect(plan.cutCount).toBeGreaterThanOrEqual(4);
  });

  it("density minimum이 4이다 (10~15초 = shortform-critical)", () => {
    expect(recommendMinimumCutCount(10)).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. 12초 입력 → 최소 4컷 유지 (10~15초 = shortform-critical)
// ═══════════════════════════════════════════════════════════════════
describe("12초 입력", () => {
  it("최소 4컷을 유지한다 (10~15초 = shortform-critical)", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 12,
      densityTargetCuts: 3,
      personaSecPerCut: 6,
    });
    expect(plan.cutCount).toBeGreaterThanOrEqual(4);
  });

  it("density minimum이 4이다", () => {
    expect(recommendMinimumCutCount(12)).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. 13초 입력 → 4컷 정책
// ═══════════════════════════════════════════════════════════════════
describe("13초 입력", () => {
  it("13~15초 특별 정책이 적용된다", () => {
    const band = resolveShortformBandPolicy(13);
    expect(band.is13to15Special).toBe(true);
    expect(band.minCuts).toBe(4);
    expect(band.preferredCuts).toBe(4);
  });

  it("reconciled plan이 최소 4컷이다", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 13,
      densityTargetCuts: 3, // density가 3이어도
      personaSecPerCut: 6,
    });
    expect(plan.cutCount).toBeGreaterThanOrEqual(4);
    expect(plan.reconciled).toBe(true);
  });

  it("density minimum이 4이다", () => {
    expect(recommendMinimumCutCount(13)).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. 15초 입력 → 2컷으로 내려가지 않음
// ═══════════════════════════════════════════════════════════════════
describe("15초 입력 — 2컷 방지", () => {
  it("어떤 경우에도 2컷으로 떨어지지 않는다", () => {
    // 매우 느린 감독 (8초/컷): 15/8 = ~2컷이 되려는 상황
    const plan = reconcileShortformPlan({
      totalDurationSec: 15,
      densityTargetCuts: 2, // 잘못된 density 계산이 들어와도
      personaSecPerCut: 8,
    });
    expect(plan.cutCount).toBeGreaterThanOrEqual(4);
    expect(plan.cutCount).not.toBe(2);
  });

  it("preferredCuts가 4 이상이다", () => {
    const band = resolveShortformBandPolicy(15);
    expect(band.preferredCuts).toBeGreaterThanOrEqual(4);
  });

  it("density minimum이 4이다", () => {
    expect(recommendMinimumCutCount(15)).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. 느린 감독이어도 15초 숏폼에서 density가 깨지지 않음
// ═══════════════════════════════════════════════════════════════════
describe("느린 감독 + 15초 숏폼", () => {
  it("감독이 매우 느린 페르소나(8초/컷)여도 4컷 이상 유지", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 15,
      densityTargetCuts: 4,
      personaSecPerCut: 8, // 느린 감독: 8초/컷 원함
      personaBias: "lower", // 느린 방향 bias
    });
    expect(plan.cutCount).toBeGreaterThanOrEqual(4);
    expect(plan.directorPaceDownweighted).toBe(true);
  });

  it("감독 pace가 다운웨이트되었음을 표시한다", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 15,
      densityTargetCuts: 4,
      personaSecPerCut: 7,
    });
    expect(plan.directorPaceDownweighted).toBe(true);
    expect(plan.reconciliationNotes.some(n => n.includes("director wanted"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. secPerCut × targetCuts가 totalDuration과 모순되지 않음
// ═══════════════════════════════════════════════════════════════════
describe("secPerCut × targetCuts 정합성", () => {
  it("지원 범위(≤15초) 내에서 총합이 totalDuration의 120% 이내여야 한다", () => {
    const testCases = [8, 10, 12, 13, 15];
    for (const total of testCases) {
      const plan = reconcileShortformPlan({
        totalDurationSec: total,
        densityTargetCuts: Math.max(3, Math.ceil(total / 5)),
        personaSecPerCut: 5,
      });
      const implied = plan.secPerCut * plan.cutCount;
      expect(implied).toBeLessThanOrEqual(total * 1.2 + 1); // +1 for rounding
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. 프롬프트에 totalDuration보다 긴 시간 감각 지시 방지
//    (vocabulary filter로 느린 표현 치환 검증)
// ═══════════════════════════════════════════════════════════════════
describe("숏폼 vocabulary filter", () => {
  it("숏폼 band에서 느린 표현을 compact하게 치환한다", () => {
    const input = "slow observational build with lingering atmosphere and patient camera drift";
    const filtered = applyShortformVocabularyFilter(input, true);
    expect(filtered).not.toContain("slow observational build");
    expect(filtered).not.toContain("lingering atmosphere");
    expect(filtered).not.toContain("patient camera drift");
    expect(filtered).toContain("quick observational beat");
  });

  it("숏폼이 아닌 경우 원문을 그대로 반환한다", () => {
    const input = "slow observational build with lingering atmosphere";
    const filtered = applyShortformVocabularyFilter(input, false);
    expect(filtered).toBe(input);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. multi-shot fallback에서도 빈약한 1-shot 연속 퇴화 방지
//    (band policy의 minShotsPerCut 검증)
// ═══════════════════════════════════════════════════════════════════
describe("multi-shot minimum density", () => {
  it("10~15초 숏폼 band에서 minShotsPerCut가 2 이상이다", () => {
    for (const dur of [10, 12, 13, 14, 15]) {
      const band = resolveShortformBandPolicy(dur);
      expect(band.minShotsPerCut).toBeGreaterThanOrEqual(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. provider degraded fallback에서도 shortform rhythm floor 유지
//    (reconciliation은 provider 상태와 무관하게 정책 적용)
// ═══════════════════════════════════════════════════════════════════
describe("degraded fallback에서도 rhythm floor 유지", () => {
  it("density가 1로 떨어져도 15초 plan은 4컷 이상", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 15,
      densityTargetCuts: 1, // degraded fallback이 1컷만 반환해도
      personaSecPerCut: 15,
    });
    expect(plan.cutCount).toBeGreaterThanOrEqual(4);
    expect(plan.reconciled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. reconciliation 설명 문구 생성
// ═══════════════════════════════════════════════════════════════════
describe("reconciliation UX 설명", () => {
  it("13~15초 special handling 시 설명 문구가 생성된다", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 15,
      densityTargetCuts: 3,
      personaSecPerCut: 7,
    });
    const explanation = buildReconciliationExplanation(plan);
    expect(explanation).not.toBeNull();
    expect(explanation).toContain("숏폼");
  });

  it("reconciliation이 없으면 설명이 null이다", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 5,
      densityTargetCuts: 1,
      personaSecPerCut: 5,
    });
    // 5초 + 1컷 + 5초/컷 → micro band, 정합성 OK → 설명 불필요
    if (!plan.reconciled) {
      const explanation = buildReconciliationExplanation(plan);
      expect(explanation).toBeNull();
    }
  });

  it("cutCount range range가 올바르다 (13~15초)", () => {
    const range = recommendCutCountRange(15);
    expect(range.min).toBeGreaterThanOrEqual(4);
    expect(range.max).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Band policy 종합 테스트
// ═══════════════════════════════════════════════════════════════════
describe("band policy 종합", () => {
  it("각 duration band가 올바른 정책을 반환한다 (2026-03 확정 규칙)", () => {
    // 확정 규칙: ≤5s micro, 6-9s short(min3), 10-15s critical(min4), 16+ over-limit
    const cases: [number, string, number][] = [
      [3, "micro", 1],
      [5, "micro", 1],
      [8, "short", 3],
      [10, "shortform-critical", 4],
      [12, "shortform-critical", 4],
      [13, "shortform-critical", 4],
      [15, "shortform-critical", 4],
      [16, "over-limit", 0],
      [30, "over-limit", 0],
    ];
    for (const [dur, expectedBand, expectedMinCuts] of cases) {
      const band = resolveShortformBandPolicy(dur);
      expect(band.band).toBe(expectedBand);
      expect(band.minCuts).toBeGreaterThanOrEqual(expectedMinCuts);
    }
  });
});
