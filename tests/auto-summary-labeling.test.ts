/**
 * auto-summary-labeling.test.ts — 자동/명시 모드 summary 표기 규칙 테스트
 *
 * 핵심 규칙:
 * - auto 모드: "N초 x M장면 = T초" 곱셈 수식 금지
 * - 명시 모드: requested=actual이면 곱셈 수식 허용
 * - requested≠actual이면 분리 표기
 */

import { describe, it, expect } from "vitest";
import { buildDurationSummary } from "@/lib/duration-reconciliation";

// ═══════════════════════════════════════════════════════════════════
// A. auto summary labeling
// ═══════════════════════════════════════════════════════════════════

describe("auto summary labeling", () => {
  const autoCuts = [
    { durationSec: 3 },
    { durationSec: 4 },
    { durationSec: 3 },
    { durationSec: 5 },
    { durationSec: 3 },
    { durationSec: 3 },
    { durationSec: 4 },
    { durationSec: 3 },
  ];

  it("auto 모드에서 N초 x M장면 = T초 형식이 표시되지 않음", () => {
    const summary = buildDurationSummary({ cuts: autoCuts, requestedSecondsPerScene: 0 });
    expect(summary.headline).not.toMatch(/\d+초\s*x\s*\d+장면\s*=\s*\d+초/);
  });

  it("auto 모드에서 requestedSecondsPerScene undefined도 자동 처리", () => {
    const summary = buildDurationSummary({ cuts: autoCuts });
    expect(summary.headline).not.toMatch(/\d+초\s*x\s*\d+장면\s*=\s*\d+초/);
    expect(summary.isAutoMode).toBe(true);
  });

  it("auto 모드에서 컷 수·평균·총 길이 중심 문구가 나옴", () => {
    const summary = buildDurationSummary({ cuts: autoCuts, requestedSecondsPerScene: 0 });
    expect(summary.headline).toContain(`${autoCuts.length}컷`);
    const actualTotal = autoCuts.reduce((s, c) => s + c.durationSec, 0);
    expect(summary.headline).toContain(`총 ${actualTotal}초`);
    // 평균 duration이 표시됨
    expect(summary.headline).toMatch(/평균\s+[\d.]+초/);
  });

  it("auto 모드에서 durationBasis가 보조 정보에 포함됨", () => {
    const summary = buildDurationSummary({
      cuts: autoCuts,
      requestedSecondsPerScene: 0,
      durationBasis: "emergency_fallback",
    });
    expect(summary.detail).toContain("emergency_fallback");
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. explicit summary labeling
// ═══════════════════════════════════════════════════════════════════

describe("explicit summary labeling", () => {
  it("명시 duration + actual 일치 시 곱셈 수식 허용", () => {
    const cuts = Array.from({ length: 8 }, () => ({ durationSec: 6 }));
    const summary = buildDurationSummary({ cuts, requestedSecondsPerScene: 6 });
    expect(summary.headline).toMatch(/6초\s*x\s*8장면\s*=\s*48초/);
    expect(summary.isAutoMode).toBe(false);
  });

  it("명시값과 actual이 다르면 requested와 actual이 분리 표기됨", () => {
    // requested=8초이지만 actual cuts는 3~5초
    const cuts = [
      { durationSec: 3 },
      { durationSec: 4 },
      { durationSec: 3 },
      { durationSec: 5 },
      { durationSec: 3 },
      { durationSec: 3 },
      { durationSec: 4 },
      { durationSec: 3 },
    ];
    const summary = buildDurationSummary({ cuts, requestedSecondsPerScene: 8 });
    const actualTotal = cuts.reduce((s, c) => s + c.durationSec, 0); // 28
    const requestedTotal = 8 * cuts.length; // 64
    // headline은 actual 기준
    expect(summary.headline).toContain(`${actualTotal}초`);
    expect(summary.headline).not.toContain(`${requestedTotal}초`);
    // detail에 requested 정보 포함
    expect(summary.detail).toContain("요청");
    expect(summary.detail).toContain(`${requestedTotal}초`);
    expect(summary.detail).toContain("자동 보정");
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. actual source of truth
// ═══════════════════════════════════════════════════════════════════

describe("actual source of truth", () => {
  it("cuts.length와 sum(durationSec)가 summary source of truth", () => {
    const cuts = [
      { durationSec: 3 },
      { durationSec: 5 },
      { durationSec: 4 },
    ];
    const summary = buildDurationSummary({ cuts });
    expect(summary.actualSceneCount).toBe(3);
    expect(summary.actualTotalDurationSeconds).toBe(12);
  });

  it("ResultPanel total badge와 상단 summary가 같은 actual total을 가리킴", () => {
    const cuts = Array.from({ length: 5 }, () => ({ durationSec: 4 }));
    const summary = buildDurationSummary({ cuts, requestedSecondsPerScene: 0 });
    expect(summary.actualTotalDurationSeconds).toBe(20);
    expect(summary.headline).toContain("20초");
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. requested vs actual — 핵심 시나리오
// ═══════════════════════════════════════════════════════════════════

describe("requested vs actual", () => {
  it("requested=8, sceneCount=8, actualTotal=24일 때 UI가 64초를 확정값처럼 보여주지 않음", () => {
    const cuts = Array.from({ length: 8 }, () => ({ durationSec: 3 }));
    const summary = buildDurationSummary({ cuts, requestedSecondsPerScene: 8 });
    // 64초가 headline에 확정값처럼 나타나면 안 됨
    expect(summary.headline).not.toContain("64초");
    // 24초가 actual total로 나타나야 함
    expect(summary.actualTotalDurationSeconds).toBe(24);
    expect(summary.headline).toContain("24초");
  });

  it("auto 모드에서는 곱셈 자체가 없으므로 requested total 계산 불필요", () => {
    const cuts = Array.from({ length: 8 }, () => ({ durationSec: 3 }));
    const summary = buildDurationSummary({ cuts, requestedSecondsPerScene: 0 });
    expect(summary.headline).not.toMatch(/=\s*\d+초/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. regressions
// ═══════════════════════════════════════════════════════════════════

describe("regressions", () => {
  it("빈 cuts 배열 처리", () => {
    const summary = buildDurationSummary({ cuts: [] });
    expect(summary.actualSceneCount).toBe(0);
    expect(summary.actualTotalDurationSeconds).toBe(0);
  });

  it("durationSec가 0인 cut은 ?? 연산자에 의해 0 그대로 전달됨 (nullish)", () => {
    const cuts = [{ durationSec: 0 }, { durationSec: 5 }] as Array<{ durationSec: number }>;
    const summary = buildDurationSummary({ cuts });
    // ?? 연산자는 null/undefined만 fallback, 0은 그대로 통과
    expect(summary.actualTotalDurationSeconds).toBe(0 + 5);
  });

  it("명시 모드에서 일치하면 detail이 빈 문자열", () => {
    const cuts = Array.from({ length: 4 }, () => ({ durationSec: 6 }));
    const summary = buildDurationSummary({ cuts, requestedSecondsPerScene: 6 });
    expect(summary.detail).toBe("");
  });
});
