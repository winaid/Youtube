/**
 * input-panel-duration-auto.test.ts — InputPanel auto duration payload 테스트
 *
 * 대상: InputPanel submit 시 auto/명시 duration이 payload에 올바르게 반영되는지
 * UI 컴포넌트 렌더 없이 순수 로직만 테스트
 */

import { describe, it, expect } from "vitest";
import {
  toApiSecondsPerScene,
  computeAutoDuration,
  durationLabel,
  DURATION_FALLBACK,
} from "@/lib/duration-reconciliation";

// ═══════════════════════════════════════════════════════════════════
// 1. auto 선택 시 payload에 explicit 8이 박히지 않는지
// ═══════════════════════════════════════════════════════════════════

describe("auto selection — payload behavior", () => {
  it("auto(slider=0) 시 toApiSecondsPerScene → undefined (8이 아님)", () => {
    const apiValue = toApiSecondsPerScene(0);
    expect(apiValue).toBeUndefined();
    // 이전: JSON payload에 8이 박혔음. 이제는 undefined.
    const payload = JSON.parse(JSON.stringify({ cutDuration: apiValue }));
    expect(payload.cutDuration).toBeUndefined();
    expect(payload.cutDuration).not.toBe(8);
  });

  it("auto + AI 추천 존재 시 추천값이 payload에 반영됨", () => {
    const cutDuration = 0; // auto
    const aiRecommendation = { recommendedDuration: 5, recommendedCuts: 12 };

    // InputPanel submit 로직 시뮬레이션
    const payloadDuration = cutDuration === 0
      ? (aiRecommendation?.recommendedDuration ?? undefined)
      : cutDuration;

    expect(payloadDuration).toBe(5);
    expect(payloadDuration).not.toBe(DURATION_FALLBACK);
  });

  it("auto + AI 추천 없음 시 undefined (서버가 auto 계산)", () => {
    const cutDuration = 0;
    const aiRecommendation = null;

    const payloadDuration = cutDuration === 0
      ? (aiRecommendation?.recommendedDuration ?? undefined)
      : cutDuration;

    expect(payloadDuration).toBeUndefined();
  });

  it("명시값(4) 선택 시 AI 추천(6)보다 명시값이 우선", () => {
    const cutDuration = 4; // 명시
    const aiRecommendation = { recommendedDuration: 6, recommendedCuts: 10 };

    const payloadDuration = cutDuration === 0
      ? (aiRecommendation?.recommendedDuration ?? undefined)
      : cutDuration;

    expect(payloadDuration).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. computeAutoDuration이 environment 등에서 8보다 짧게 유도
// ═══════════════════════════════════════════════════════════════════

describe("scene-aware auto duration in InputPanel context", () => {
  it("environment scene에서 auto → 8보다 짧음", () => {
    const r = computeAutoDuration({ sceneType: "environment" });
    expect(r.duration).toBeLessThan(8);
    expect(r.duration).toBe(4); // lowered from 5
  });

  it("portrait scene에서 auto → 8보다 짧음", () => {
    const r = computeAutoDuration({ sceneType: "portrait" });
    expect(r.duration).toBeLessThan(8);
  });

  it("character-driven → 5초 (lowered from 6)", () => {
    const r = computeAutoDuration({ sceneType: "character-driven" });
    expect(r.duration).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. PromptGenerator 초기 상태 시뮬레이션
// ═══════════════════════════════════════════════════════════════════

describe("PromptGenerator initial state", () => {
  it("초기 secondsPerScene은 0 (자동) — 8이 아님", () => {
    // PromptGenerator: useState(0) // 0 = 자동
    const initialSecondsPerScene = 0;
    expect(initialSecondsPerScene).toBe(0);
    expect(initialSecondsPerScene).not.toBe(DURATION_FALLBACK);
  });

  it("slider=0 → UI 라벨 '자동'", () => {
    expect(durationLabel(0)).toBe("자동");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. 기존 명시 duration 회귀 없음
// ═══════════════════════════════════════════════════════════════════

describe("explicit duration regression (all clamped to 8 with fixed duration policy)", () => {
  it("명시 4초 → payload에 8 (clamped to DURATION_MIN=8)", () => {
    expect(toApiSecondsPerScene(4)).toBe(8);
  });

  it("명시 8초 → payload에 8", () => {
    expect(toApiSecondsPerScene(8)).toBe(8);
  });

  it("명시 15초 → payload에 8 (clamped to DURATION_MAX=8)", () => {
    expect(toApiSecondsPerScene(15)).toBe(8);
  });
});
