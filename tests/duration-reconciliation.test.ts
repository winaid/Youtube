import { describe, it, expect } from "vitest";
import {
  toApiSecondsPerScene,
  durationLabel,
  durationDescription,
  reconcileDuration,
  DURATION_MIN,
  DURATION_MAX,
} from "@/lib/duration-reconciliation";

// ── toApiSecondsPerScene ─────────────────────────────────────────────────────

describe("toApiSecondsPerScene", () => {
  it("슬라이더 0 → undefined (자동)", () => {
    expect(toApiSecondsPerScene(0)).toBeUndefined();
  });

  it("슬라이더 1~2 → 최소값 3으로 클램핑", () => {
    expect(toApiSecondsPerScene(1)).toBe(DURATION_MIN);
    expect(toApiSecondsPerScene(2)).toBe(DURATION_MIN);
  });

  it("슬라이더 3~15 → 그대로 반환", () => {
    expect(toApiSecondsPerScene(3)).toBe(3);
    expect(toApiSecondsPerScene(8)).toBe(8);
    expect(toApiSecondsPerScene(15)).toBe(15);
  });

  it("슬라이더 15 초과 → 15로 클램핑", () => {
    expect(toApiSecondsPerScene(20)).toBe(DURATION_MAX);
  });
});

// ── durationLabel / durationDescription ──────────────────────────────────────

describe("durationLabel", () => {
  it("0 → '자동'", () => {
    expect(durationLabel(0)).toBe("자동");
  });

  it("8 → '8초'", () => {
    expect(durationLabel(8)).toBe("8초");
  });
});

describe("durationDescription", () => {
  it("0 → 자동 설명", () => {
    expect(durationDescription(0)).toContain("자동");
  });

  it("10 → 명시값 설명", () => {
    expect(durationDescription(10)).toContain("10");
  });
});

// ── reconcileDuration ────────────────────────────────────────────────────────

describe("reconcileDuration", () => {
  it("모두 0 → auto basis, 경고 없음", () => {
    const r = reconcileDuration({ totalDurationSeconds: 0, sceneCount: 0, secondsPerScene: 0 });
    expect(r.basis).toBe("auto");
    expect(r.warnings).toHaveLength(0);
  });

  it("secondsPerScene=8, sceneCount=10 → total=80, basis=secondsPerScene", () => {
    const r = reconcileDuration({ totalDurationSeconds: 0, sceneCount: 10, secondsPerScene: 8 });
    expect(r.reconciledTotalDurationSeconds).toBe(80);
    expect(r.reconciledSceneCount).toBe(10);
    expect(r.reconciledSecondsPerScene).toBe(8);
    expect(r.basis).toBe("secondsPerScene");
  });

  it("secondsPerScene=8, sceneCount=10, total=60 → 충돌 경고 발생", () => {
    const r = reconcileDuration({ totalDurationSeconds: 60, sceneCount: 10, secondsPerScene: 8 });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toContain("불일치");
    // secondsPerScene 우선
    expect(r.reconciledTotalDurationSeconds).toBe(80);
    expect(r.basis).toBe("secondsPerScene");
  });

  it("secondsPerScene=6, sceneCount=0, total=60 → sceneCount 역산=10", () => {
    const r = reconcileDuration({ totalDurationSeconds: 60, sceneCount: 0, secondsPerScene: 6 });
    expect(r.reconciledSceneCount).toBe(10);
    expect(r.reconciledSecondsPerScene).toBe(6);
    expect(r.reconciledTotalDurationSeconds).toBe(60);
    expect(r.basis).toBe("secondsPerScene");
  });

  it("secondsPerScene=0, sceneCount=10, total=60 → secondsPerScene 역산=6", () => {
    const r = reconcileDuration({ totalDurationSeconds: 60, sceneCount: 10, secondsPerScene: 0 });
    expect(r.reconciledSecondsPerScene).toBe(6);
    expect(r.reconciledSceneCount).toBe(10);
    expect(r.basis).toBe("sceneCount");
  });

  it("secondsPerScene=0, sceneCount=2, total=60 → 역산 30초이지만 최대 15초로 클램핑 + 경고", () => {
    const r = reconcileDuration({ totalDurationSeconds: 60, sceneCount: 2, secondsPerScene: 0 });
    expect(r.reconciledSecondsPerScene).toBe(DURATION_MAX);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toContain("범위");
  });

  it("secondsPerScene=5, sceneCount=0, total=0 → secondsPerScene만 유지, 나머지 0", () => {
    const r = reconcileDuration({ totalDurationSeconds: 0, sceneCount: 0, secondsPerScene: 5 });
    expect(r.reconciledSecondsPerScene).toBe(5);
    expect(r.reconciledSceneCount).toBe(0);
    expect(r.reconciledTotalDurationSeconds).toBe(0);
    expect(r.basis).toBe("secondsPerScene");
  });

  it("secondsPerScene=0, sceneCount=5, total=0 → sceneCount만 유지", () => {
    const r = reconcileDuration({ totalDurationSeconds: 0, sceneCount: 5, secondsPerScene: 0 });
    expect(r.reconciledSceneCount).toBe(5);
    expect(r.reconciledSecondsPerScene).toBe(0);
    expect(r.basis).toBe("sceneCount");
  });
});
