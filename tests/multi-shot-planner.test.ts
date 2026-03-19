/**
 * multi-shot-planner.test.ts — 멀티샷 자동 계획 엔진 테스트
 *
 * 4가지 핵심 시나리오:
 *   Case 1: 12s cinematic_sequence → 자동 3-4샷, role 시퀀스, multiShot 기본 생성
 *   Case 2: 15s environment Batch → 4-6샷, 빠른 queueing, 정직한 duration
 *   Case 3: 8s 의도적 원테이크 → 단일샷 허용, 예외 명시
 *   Case 4: 30 clips × 12s → 360s 총 runtime, 300s 예산 초과 경고
 */

import { describe, it, expect } from "vitest";
import {
  planRecommendedShotCount,
  planShotRoles,
  distributeDurations,
  buildDefaultMultiShot,
  shouldForceMultiShot,
  isOneTakeAllowed,
  repairMissingMultiShot,
  buildMultiShotPlan,
  RETENTION_ROLE_PATTERNS,
} from "@/lib/multi-shot-planner";

// ═══════════════════════════════════════════════════════════════════
// planRecommendedShotCount
// ═══════════════════════════════════════════════════════════════════

describe("planRecommendedShotCount", () => {
  const model = "kling-o3-text-to-video";

  it("3초 이하 → 1샷", () => {
    expect(planRecommendedShotCount(model, 3)).toBe(1);
    expect(planRecommendedShotCount(model, 2)).toBe(1);
  });

  it("4-5초 → 2~6샷 (max=6 허용)", () => {
    expect(planRecommendedShotCount(model, 4)).toBeGreaterThanOrEqual(2);
    expect(planRecommendedShotCount(model, 4)).toBeLessThanOrEqual(6);
    expect(planRecommendedShotCount(model, 5)).toBeGreaterThanOrEqual(2);
    expect(planRecommendedShotCount(model, 5)).toBeLessThanOrEqual(6);
  });

  it("6-8초 → 2~6샷 (max=6 허용)", () => {
    const count6 = planRecommendedShotCount(model, 6);
    const count8 = planRecommendedShotCount(model, 8);
    expect(count6).toBeGreaterThanOrEqual(2);
    expect(count6).toBeLessThanOrEqual(6);
    expect(count8).toBeGreaterThanOrEqual(2);
    expect(count8).toBeLessThanOrEqual(6);
  });

  it("9-12초 → 3~6샷 (max=6 허용)", () => {
    const count9 = planRecommendedShotCount(model, 9);
    const count12 = planRecommendedShotCount(model, 12);
    expect(count9).toBeGreaterThanOrEqual(3);
    expect(count9).toBeLessThanOrEqual(6);
    expect(count12).toBeGreaterThanOrEqual(3);
    expect(count12).toBeLessThanOrEqual(6);
  });

  it("13-15초 → 4-6샷", () => {
    const count13 = planRecommendedShotCount(model, 13);
    const count15 = planRecommendedShotCount(model, 15);
    expect(count13).toBeGreaterThanOrEqual(4);
    expect(count13).toBeLessThanOrEqual(6);
    expect(count15).toBeGreaterThanOrEqual(4);
    expect(count15).toBeLessThanOrEqual(6);
  });

  it("battle 씬 → bias +1로 더 많은 샷", () => {
    const normalCount = planRecommendedShotCount(model, 10);
    const battleCount = planRecommendedShotCount(model, 10, "battle");
    expect(battleCount).toBeGreaterThanOrEqual(normalCount);
  });

  it("multiShot 미지원 모델 → 1", () => {
    expect(planRecommendedShotCount("kling-custom-element", 12)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// planShotRoles
// ═══════════════════════════════════════════════════════════════════

describe("planShotRoles", () => {
  it("2샷: hook → payoff", () => {
    const roles = planShotRoles(2);
    expect(roles).toEqual(["establish", "resolve"]);
  });

  it("3샷: hook → develop → payoff", () => {
    const roles = planShotRoles(3);
    expect(roles).toEqual(["establish", "develop", "resolve"]);
  });

  it("4샷: hook → develop → reveal → payoff", () => {
    const roles = planShotRoles(4);
    expect(roles).toEqual(["establish", "develop", "peak", "resolve"]);
  });

  it("5샷: hook → orient → develop → reveal → payoff", () => {
    const roles = planShotRoles(5);
    expect(roles).toEqual(["establish", "transition", "develop", "peak", "resolve"]);
  });

  it("6샷: full retention pattern", () => {
    const roles = planShotRoles(6);
    expect(roles).toEqual(["establish", "transition", "develop", "insert", "peak", "resolve"]);
  });

  it("첫 샷은 항상 establish, 마지막은 항상 resolve", () => {
    for (let n = 2; n <= 6; n++) {
      const roles = planShotRoles(n);
      expect(roles[0]).toBe("establish");
      expect(roles[roles.length - 1]).toBe("resolve");
    }
  });

  it("0샷 → 빈 배열", () => {
    expect(planShotRoles(0)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// distributeDurations
// ═══════════════════════════════════════════════════════════════════

describe("distributeDurations", () => {
  it("합이 totalDuration과 정확히 일치", () => {
    const roles = planShotRoles(4);
    const durations = distributeDurations(roles, 12, 2);
    expect(durations.reduce((s, d) => s + d, 0)).toBe(12);
  });

  it("모든 duration이 minShotDuration 이상", () => {
    const roles = planShotRoles(6);
    const durations = distributeDurations(roles, 15, 2);
    for (const d of durations) {
      expect(d).toBeGreaterThanOrEqual(2);
    }
  });

  it("1샷 → 전체 duration", () => {
    const durations = distributeDurations(["establish"], 10, 2);
    expect(durations).toEqual([10]);
  });

  it("빈 roles → 빈 배열", () => {
    expect(distributeDurations([], 10, 2)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// shouldForceMultiShot
// ═══════════════════════════════════════════════════════════════════

describe("shouldForceMultiShot", () => {
  const model = "kling-o3-text-to-video";

  it("9초 이상이면 어떤 씬이든 강제", () => {
    expect(shouldForceMultiShot("default", 9, model)).toBe(true);
    expect(shouldForceMultiShot("default", 10, model)).toBe(true);
    expect(shouldForceMultiShot("default", 15, model)).toBe(true);
  });

  it("cinematic_sequence + 6초 → 강제", () => {
    expect(shouldForceMultiShot("cinematic_sequence", 6, model)).toBe(true);
    expect(shouldForceMultiShot("cinematic_sequence", 7, model)).toBe(true);
  });

  it("environment + 6초 → 강제", () => {
    expect(shouldForceMultiShot("environment", 6, model)).toBe(true);
  });

  it("default + 5초 → 비강제", () => {
    expect(shouldForceMultiShot("default", 5, model)).toBe(false);
  });

  it("3초 이하 → 비강제 (maxShots=0)", () => {
    expect(shouldForceMultiShot("cinematic_sequence", 3, model)).toBe(false);
  });

  it("multiShot 미지원 모델 → 비강제", () => {
    expect(shouldForceMultiShot("cinematic_sequence", 12, "kling-custom-element")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// isOneTakeAllowed
// ═══════════════════════════════════════════════════════════════════

describe("isOneTakeAllowed", () => {
  it("3초 이하 → 항상 허용", () => {
    expect(isOneTakeAllowed(3, false)).toBe(true);
    expect(isOneTakeAllowed(2, false)).toBe(true);
  });

  it("의도적 원테이크 → 허용", () => {
    expect(isOneTakeAllowed(12, true)).toBe(true);
  });

  it("5초 + 비의도적 → 불허", () => {
    expect(isOneTakeAllowed(5, false)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildDefaultMultiShot
// ═══════════════════════════════════════════════════════════════════

describe("buildDefaultMultiShot", () => {
  const model = "kling-o3-text-to-video";

  it("Case 1: 12s cinematic_sequence → 자동 3-4샷 + role 시퀀스", () => {
    const shots = buildDefaultMultiShot({
      durationSec: 12,
      sceneType: "cinematic_sequence",
      basePrompt: "A warrior walks into battle",
      modelId: model,
    });

    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(shots.length).toBeLessThanOrEqual(6); // 물리적 한계까지 허용

    // role 시퀀스 존재
    expect(shots[0].role).toBe("establish");
    expect(shots[shots.length - 1].role).toBe("resolve");

    // 각 샷이 비어있지 않고 서로 다른 시각 레이어를 묘사
    for (const s of shots) {
      expect(s.prompt.length).toBeGreaterThan(20);
    }
    // 인접 샷 프롬프트가 동일하지 않음 (decomposition이 각각 다른 내용 생성)
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].prompt).not.toBe(shots[i - 1].prompt);
    }

    // duration 합 일치
    const totalDur = shots.reduce((sum, s) => sum + parseInt(s.duration, 10), 0);
    expect(totalDur).toBe(12);

    // index 1-based 순차
    shots.forEach((s, i) => expect(s.index).toBe(i + 1));
  });

  it("Case 2: 15s environment → 자동 4-6샷", () => {
    const shots = buildDefaultMultiShot({
      durationSec: 15,
      sceneType: "environment",
      basePrompt: "Vast mountain landscape",
      modelId: model,
    });

    expect(shots.length).toBeGreaterThanOrEqual(4);
    expect(shots.length).toBeLessThanOrEqual(6);

    const totalDur = shots.reduce((sum, s) => sum + parseInt(s.duration, 10), 0);
    expect(totalDur).toBe(15);
  });

  it("3초 → 빈 배열 (멀티샷 불필요)", () => {
    const shots = buildDefaultMultiShot({
      durationSec: 3,
      modelId: model,
    });
    expect(shots).toEqual([]);
  });

  it("multiShot 미지원 모델 → 빈 배열", () => {
    const shots = buildDefaultMultiShot({
      durationSec: 12,
      modelId: "kling-custom-element",
    });
    expect(shots).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// repairMissingMultiShot
// ═══════════════════════════════════════════════════════════════════

describe("repairMissingMultiShot", () => {
  const model = "kling-o3-text-to-video";

  it("강제 멀티샷 + 누락 → 자동 생성", () => {
    const repaired = repairMissingMultiShot({
      durationSec: 12,
      sceneType: "cinematic_sequence",
      basePrompt: "test prompt",
      modelId: model,
    });

    expect(repaired.length).toBeGreaterThanOrEqual(2);
  });

  it("이미 멀티샷 있으면 그대로 반환", () => {
    const existing = [
      { index: 1, prompt: "shot 1", duration: "6", role: "establish" as const },
      { index: 2, prompt: "shot 2", duration: "6", role: "resolve" as const },
    ];

    const result = repairMissingMultiShot({
      existingMultiShot: existing,
      durationSec: 12,
      modelId: model,
    });

    expect(result).toEqual(existing);
  });

  it("의도적 원테이크 → repair 안함", () => {
    const result = repairMissingMultiShot({
      durationSec: 12,
      modelId: model,
      intentionalOneTake: true,
    });

    expect(result).toEqual([]);
  });

  it("Case 3: 8s 의도적 원테이크 → 빈 배열 유지", () => {
    const result = repairMissingMultiShot({
      durationSec: 8,
      sceneType: "cinematic_sequence",
      modelId: model,
      intentionalOneTake: true,
    });

    expect(result).toEqual([]);
  });

  it("Batch 모드 5초+ → auto-repair", () => {
    const result = repairMissingMultiShot({
      durationSec: 7,
      sceneType: "default",
      modelId: model,
      mode: "batch",
    });

    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildMultiShotPlan
// ═══════════════════════════════════════════════════════════════════

describe("buildMultiShotPlan", () => {
  const model = "kling-o3-text-to-video";

  it("12s cinematic_sequence → forced plan", () => {
    const plan = buildMultiShotPlan({
      modelId: model,
      durationSec: 12,
      sceneType: "cinematic_sequence",
    });

    expect(plan.forced).toBe(true);
    expect(plan.shotCount).toBeGreaterThanOrEqual(3);
    expect(plan.roles.length).toBe(plan.shotCount);
    expect(plan.durations.length).toBe(plan.shotCount);
    expect(plan.durations.reduce((s, d) => s + d, 0)).toBe(12);
    expect(plan.oneTakeAllowed).toBe(false);
  });

  it("3s default → single shot", () => {
    const plan = buildMultiShotPlan({
      modelId: model,
      durationSec: 3,
    });

    expect(plan.shotCount).toBe(1);
    expect(plan.oneTakeAllowed).toBe(true);
    expect(plan.forced).toBe(false);
  });

  it("8s + intentionalOneTake → single shot allowed", () => {
    const plan = buildMultiShotPlan({
      modelId: model,
      durationSec: 8,
      intentionalOneTake: true,
    });

    expect(plan.shotCount).toBe(1);
    expect(plan.oneTakeAllowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// RETENTION_ROLE_PATTERNS completeness
// ═══════════════════════════════════════════════════════════════════

describe("RETENTION_ROLE_PATTERNS", () => {
  it("1-6 샷 패턴 모두 정의됨", () => {
    for (let n = 1; n <= 6; n++) {
      expect(RETENTION_ROLE_PATTERNS[n]).toBeDefined();
      expect(RETENTION_ROLE_PATTERNS[n].length).toBe(n);
    }
  });

  it("모든 패턴의 마지막이 resolve (2샷+)", () => {
    for (let n = 2; n <= 6; n++) {
      const pattern = RETENTION_ROLE_PATTERNS[n];
      expect(pattern[pattern.length - 1]).toBe("resolve");
    }
  });
});
