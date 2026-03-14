/**
 * generate-cuts-auto-duration.test.ts — auto duration 정책 테스트
 *
 * 서버 _duration-constants.ts의 computeServerAutoDuration은
 * 클라이언트 computeAutoDuration과 동일 로직이므로
 * 클라이언트 버전으로 통합 테스트.
 *
 * 추가로 generate-cuts 서버 코드가 사용하는 패턴을 시뮬레이션.
 */

import { describe, it, expect } from "vitest";
import {
  computeAutoDuration,
  safeDuration,
  DURATION_FALLBACK,
  DURATION_MIN,
  DURATION_MAX,
} from "@/lib/duration-reconciliation";

// ═══════════════════════════════════════════════════════════════════
// generate-cuts 서버 시나리오 시뮬레이션
// ═══════════════════════════════════════════════════════════════════

describe("generate-cuts auto duration — server simulation", () => {
  // generate-cuts에서 cutDuration 처리 시뮬레이션
  function simulateServerDuration(rawCutDuration: number | undefined, rawCutCount?: number): { secPerCut: number; basis: string } {
    const cutDur = rawCutDuration && rawCutDuration > 0 ? rawCutDuration : undefined;
    const result = computeAutoDuration({
      cutDuration: cutDur,
      cutCount: rawCutCount,
    });
    return { secPerCut: result.duration, basis: result.basis };
  }

  it("auto(0) → emergency_fallback (8) — 아무 정보 없을 때만", () => {
    const r = simulateServerDuration(0);
    expect(r.secPerCut).toBe(DURATION_FALLBACK);
    expect(r.basis).toBe("emergency_fallback");
  });

  it("auto(undefined) → emergency_fallback", () => {
    const r = simulateServerDuration(undefined);
    expect(r.secPerCut).toBe(DURATION_FALLBACK);
    expect(r.basis).toBe("emergency_fallback");
  });

  it("explicit 4 → 4", () => {
    const r = simulateServerDuration(4);
    expect(r.secPerCut).toBe(4);
    expect(r.basis).toBe("explicit");
  });

  it("explicit 10 → 10", () => {
    const r = simulateServerDuration(10);
    expect(r.secPerCut).toBe(10);
    expect(r.basis).toBe("explicit");
  });

  it("explicit cutDuration이 8초 fallback을 덮어쓰지 않음", () => {
    const r = simulateServerDuration(4);
    expect(r.secPerCut).not.toBe(8);
    expect(r.secPerCut).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// mock-generator와 동일 정책 확인
// ═══════════════════════════════════════════════════════════════════

describe("mock-generator auto duration parity", () => {
  function simulateMockDuration(cutDuration: number | undefined, totalDuration: number): { duration: number; basis: string } {
    return computeAutoDuration({
      cutDuration: cutDuration && cutDuration > 0 ? cutDuration : undefined,
      totalDurationSeconds: totalDuration,
    });
  }

  it("auto + totalDuration=60 → emergency (cutCount 없음)", () => {
    const r = simulateMockDuration(undefined, 60);
    // cutCount가 없으므로 computed 불가 → emergency
    expect(r.basis).toBe("emergency_fallback");
  });

  it("auto + totalDuration=60 + cutCount=10 → computed 6초", () => {
    const r = computeAutoDuration({ totalDurationSeconds: 60, cutCount: 10 });
    expect(r.duration).toBe(6);
    expect(r.basis).toBe("computed");
  });

  it("explicit 4 + totalDuration=60 → explicit 우선", () => {
    const r = simulateMockDuration(4, 60);
    expect(r.duration).toBe(4);
    expect(r.basis).toBe("explicit");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 기존 safeDuration 회귀
// ═══════════════════════════════════════════════════════════════════

describe("safeDuration regression", () => {
  it("safeDuration은 computeAutoDuration 이후에 사용해야 함", () => {
    // auto 해석 → computeAutoDuration으로 basis 결정 → safeDuration으로 클램핑
    const auto = computeAutoDuration({ sceneType: "environment" });
    const final = safeDuration(auto.duration);
    expect(final).toBe(5);
    expect(final).not.toBe(DURATION_FALLBACK);
  });

  it("safeDuration(0) → fallback (0을 직접 넣으면 아직 fallback)", () => {
    expect(safeDuration(0)).toBe(DURATION_FALLBACK);
  });
});
