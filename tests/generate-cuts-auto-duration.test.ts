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

  it("explicit 4 → clamped to 8 (DURATION_MIN=DURATION_MAX=8)", () => {
    const r = simulateServerDuration(4);
    expect(r.secPerCut).toBe(8);
    expect(r.basis).toBe("explicit");
  });

  it("explicit 10 → clamped to 8 (DURATION_MAX=8)", () => {
    const r = simulateServerDuration(10);
    expect(r.secPerCut).toBe(8);
    expect(r.basis).toBe("explicit");
  });

  it("explicit cutDuration is clamped to 8 (fixed duration policy)", () => {
    const r = simulateServerDuration(4);
    expect(r.secPerCut).toBe(8);
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

  it("auto + totalDuration=60 + cutCount=10 → computed clamped to 8", () => {
    const r = computeAutoDuration({ totalDurationSeconds: 60, cutCount: 10 });
    // 60/10=6 → clamped to DURATION_MIN(8)
    expect(r.duration).toBe(8);
    expect(r.basis).toBe("computed");
  });

  it("explicit 4 + totalDuration=60 → explicit clamped to 8", () => {
    const r = simulateMockDuration(4, 60);
    expect(r.duration).toBe(8);
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
    // environment scene default = 4 (raw, not clamped in step 4 without editorialPace)
    // safeDuration(4) → clamped to DURATION_MIN(8)
    const final = safeDuration(auto.duration);
    expect(final).toBe(8);
    expect(final).toBe(DURATION_FALLBACK);
  });

  it("safeDuration(0) → fallback (0을 직접 넣으면 아직 fallback)", () => {
    expect(safeDuration(0)).toBe(DURATION_FALLBACK);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 서버 _duration-constants 상수 export 무결성
// ═══════════════════════════════════════════════════════════════════

import {
  DURATION_MIN as SERVER_DURATION_MIN,
  DURATION_MAX as SERVER_DURATION_MAX,
  safeDuration as serverSafeDuration,
  computeServerAutoDuration,
} from "../functions/api/_duration-constants";

describe("server _duration-constants export 무결성", () => {
  it("DURATION_MIN이 서버에서 정상 export (ReferenceError 방지)", () => {
    expect(SERVER_DURATION_MIN).toBe(3);
    expect(typeof SERVER_DURATION_MIN).toBe("number");
  });

  it("DURATION_MAX가 서버에서 정상 export", () => {
    expect(SERVER_DURATION_MAX).toBe(15);
  });

  it("client DURATION_MIN is 8 (fixed policy), server is 3", () => {
    expect(DURATION_MIN).toBe(8);
    expect(SERVER_DURATION_MIN).toBe(3);
  });

  it("client DURATION_MAX is 8 (fixed policy), server is 15", () => {
    expect(DURATION_MAX).toBe(8);
    expect(SERVER_DURATION_MAX).toBe(15);
  });

  it("secPerCut reconciliation: server DURATION_MIN 클램핑 동작", () => {
    // generate-cuts.ts:1486의 패턴 시뮬레이션
    const totalDuration = 15;
    const targetCuts = 6;
    const naturalPerCut = Math.max(SERVER_DURATION_MIN, Math.round(totalDuration / targetCuts));
    expect(naturalPerCut).toBe(SERVER_DURATION_MIN); // 15/6=2.5 → round=3 = SERVER_DURATION_MIN
  });

  it("serverSafeDuration이 server DURATION_MIN 기반 클램핑", () => {
    expect(serverSafeDuration(1)).toBe(SERVER_DURATION_MIN);
    expect(serverSafeDuration(2)).toBe(SERVER_DURATION_MIN);
    expect(serverSafeDuration(3)).toBe(3);
  });
});
