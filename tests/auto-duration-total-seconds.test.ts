/**
 * auto-duration-total-seconds.test.ts
 *
 * totalDurationSeconds가 computeServerAutoDuration에 실제 전달되어
 * 8초 fallback으로 붕괴하지 않는지 검증.
 */

import { describe, it, expect } from "vitest";
import { computeAutoDuration, DURATION_FALLBACK } from "@/lib/duration-reconciliation";
import { computeServerAutoDuration } from "../functions/api/_duration-constants";

describe("A. computeServerAutoDuration — totalDurationSeconds 전달", () => {
  it("1) explicit cutDuration이 있으면 그대로 사용", () => {
    const r = computeServerAutoDuration(6, 120, 10);
    expect(r.duration).toBe(6);
    expect(r.basis).toBe("explicit");
  });

  it("2) totalDurationSeconds=120, cutCount=10 → computed duration = 12", () => {
    const r = computeServerAutoDuration(undefined, 120, 10);
    expect(r.duration).toBe(12);
    expect(r.basis).toBe("computed");
  });

  it("3) totalDurationSeconds=120, cutCount=15 → computed duration = 8", () => {
    const r = computeServerAutoDuration(undefined, 120, 15);
    expect(r.duration).toBe(8);
    expect(r.basis).toBe("computed");
  });

  it("4) totalDurationSeconds=120 without cutCount → fallback이지만 emergency가 아닌 pace 기반", () => {
    const r = computeServerAutoDuration(undefined, 120, undefined, undefined, [3, 5]);
    // editorialPace=[3,5] → paceMid=4 → scene_default basis
    expect(r.duration).toBe(4);
    expect(r.basis).toBe("scene_default");
  });

  it("5) 아무것도 없으면 emergency_fallback(8)", () => {
    const r = computeServerAutoDuration(undefined, undefined, undefined);
    expect(r.duration).toBe(DURATION_FALLBACK);
    expect(r.basis).toBe("emergency_fallback");
  });

  it("6) totalDurationSeconds=60, cutCount=5 → 12초", () => {
    const r = computeServerAutoDuration(undefined, 60, 5);
    expect(r.duration).toBe(12);
    expect(r.basis).toBe("computed");
  });
});

describe("B. client computeAutoDuration (fixed 8s policy)", () => {
  it("7) totalDurationSeconds=120 + cutCount=10 → client clamped to 8", () => {
    const r = computeAutoDuration({
      totalDurationSeconds: 120,
      cutCount: 10,
    });
    // 120/10=12 → clamped to DURATION_MAX(8)
    expect(r.duration).toBe(8);
    expect(r.basis).toBe("computed");
  });

  it("8) totalDurationSeconds=120 + cutCount=30 → clamped to DURATION_MIN(8)", () => {
    const r = computeAutoDuration({
      totalDurationSeconds: 120,
      cutCount: 30,
    });
    // 120/30=4 → clamped to DURATION_MIN(8)
    expect(r.duration).toBe(8);
    expect(r.basis).toBe("computed");
  });
});
