import { describe, it, expect } from "vitest";
import {
  toApiSecondsPerScene,
  durationLabel,
  durationDescription,
  reconcileDuration,
  safeDuration,
  DURATION_MIN,
  DURATION_MAX,
  DURATION_FALLBACK,
} from "@/lib/duration-reconciliation";
import { buildShotDocument } from "@/lib/sequence-assembler";
import { buildSequencePlan } from "@/lib/sequence-plan";
import type { Cut, VeoGenerationConfig } from "@/types";

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

// ── safeDuration ─────────────────────────────────────────────────────────────

describe("safeDuration", () => {
  it("undefined → DURATION_FALLBACK", () => {
    expect(safeDuration(undefined)).toBe(DURATION_FALLBACK);
  });

  it("null → DURATION_FALLBACK", () => {
    expect(safeDuration(null)).toBe(DURATION_FALLBACK);
  });

  it("0 → DURATION_FALLBACK (0은 auto, downstream에서는 fallback)", () => {
    expect(safeDuration(0)).toBe(DURATION_FALLBACK);
  });

  it("NaN → DURATION_FALLBACK", () => {
    expect(safeDuration(NaN)).toBe(DURATION_FALLBACK);
  });

  it("4 → 4 (유효값 그대로)", () => {
    expect(safeDuration(4)).toBe(4);
  });

  it("1 → 3 (DURATION_MIN 클램핑)", () => {
    expect(safeDuration(1)).toBe(DURATION_MIN);
  });

  it("20 → 15 (DURATION_MAX 클램핑)", () => {
    expect(safeDuration(20)).toBe(DURATION_MAX);
  });

  it("기존 8초 fallback이 slider 4를 덮어쓰지 않음", () => {
    // 핵심 테스트: 사용자가 4초를 선택했을 때 safeDuration이 8로 회귀하지 않는지
    const sliderValue = 4;
    const apiValue = toApiSecondsPerScene(sliderValue);
    expect(apiValue).toBe(4);
    expect(safeDuration(apiValue)).toBe(4);
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

  it("[요구#4] totalDuration=60 + secondsPerScene=4 → sceneCount=15", () => {
    const r = reconcileDuration({ totalDurationSeconds: 60, sceneCount: 0, secondsPerScene: 4 });
    expect(r.reconciledSceneCount).toBe(15);
    expect(r.reconciledSecondsPerScene).toBe(4);
    expect(r.reconciledTotalDurationSeconds).toBe(60);
  });

  it("[요구#5] totalDuration=60 + sceneCount=7 + secondsPerScene=4 → warning", () => {
    const r = reconcileDuration({ totalDurationSeconds: 60, sceneCount: 7, secondsPerScene: 4 });
    // 4×7=28 ≠ 60 → 충돌 경고
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.reconciledTotalDurationSeconds).toBe(28);
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

// ── API payload 변환 (slider → API) ─────────────────────────────────────────

describe("slider → API payload 변환", () => {
  it("[요구#1] slider=0 → API payload에 cutDuration 미전달 (undefined)", () => {
    const apiValue = toApiSecondsPerScene(0);
    expect(apiValue).toBeUndefined();
    // API body에서 cutDuration: undefined → JSON.stringify 시 누락
    const body = JSON.parse(JSON.stringify({ cutDuration: apiValue }));
    expect(body.cutDuration).toBeUndefined();
  });

  it("[요구#1] slider=0 → safeDuration은 FALLBACK 반환 (서버 측 기본값)", () => {
    const apiValue = toApiSecondsPerScene(0);
    expect(safeDuration(apiValue)).toBe(DURATION_FALLBACK);
  });
});

// ── structuredSequence shot duration 동기화 ──────────────────────────────────

describe("structuredSequence shot duration 동기화", () => {
  const makeCut = (duration: number): Cut => ({
    cutNumber: 1,
    scenePrompt: "테스트 장면",
    sceneDescription: "A character walking through a park",
    videoPrompt: "A test scene in a park",
    extendPrompt: "",
    negativePrompt: "",
    durationSec: duration,
    cameraDirection: "slow pan right",
    shotCategory: "character-driven",
    characterRole: "protagonist",
    styleIntensity: 50,
  } as Cut);

  const makeConfig = (dur: number): VeoGenerationConfig => ({
    engine: "kling" as const,
    durationSeconds: dur,
    aspectRatio: "16:9",
    animationMode: "live-action",
    negativePrompt: "",
    mode: "professional" as const,
    resolution: "1080p",
    generateAudio: true,
    personGeneration: "allow_adult",
  });

  it("[요구#2] slider=4 → buildShotDocument duration = 4", () => {
    const doc = buildShotDocument({ cut: makeCut(4), config: makeConfig(4) });
    expect(doc.timing.durationSec).toBe(4);
    // timing beats는 4초 범위를 넘지 않아야 함
    for (const beat of doc.timing.beats) {
      expect(beat.endSec).toBeLessThanOrEqual(4);
    }
  });

  it("[요구#3] slider=15 → buildShotDocument duration = 15", () => {
    const doc = buildShotDocument({ cut: makeCut(15), config: makeConfig(15) });
    expect(doc.timing.durationSec).toBe(15);
    for (const beat of doc.timing.beats) {
      expect(beat.endSec).toBeLessThanOrEqual(15);
    }
  });

  it("[요구#9] 기존 8초 fallback이 slider 값 4를 덮어쓰지 않음", () => {
    const doc = buildShotDocument({ cut: makeCut(4), config: makeConfig(4) });
    // duration이 8이 아닌 4여야 함
    expect(doc.timing.durationSec).not.toBe(8);
    expect(doc.timing.durationSec).toBe(4);
  });
});

// ── buildSequencePlan duration 동기화 ────────────────────────────────────────

describe("buildSequencePlan duration 동기화", () => {
  const baseCut = (n: number, dur: number, cat = "character-driven"): Cut => ({
    cutNumber: n,
    scenePrompt: "테스트 장면",
    sceneDescription: "A test scene description",
    videoPrompt: "A test scene in a park with characters",
    extendPrompt: "",
    negativePrompt: "",
    durationSec: dur,
    cameraDirection: "slow pan right",
    shotCategory: cat,
    styleIntensity: 50,
  } as Cut);

  it("4초 cut → shot endSec=4, startSec=0", () => {
    const plan = buildSequencePlan([baseCut(1, 4)], "테스트");
    expect(plan.shots[0].startSec).toBe(0);
    expect(plan.shots[0].endSec).toBe(4);
  });

  it("mixed durations: 4초 + 10초 → totalDuration=14", () => {
    const cuts = [baseCut(1, 4), baseCut(2, 10, "environment")];
    const plan = buildSequencePlan(cuts, "테스트");
    expect(plan.globalIntent.durationSec).toBe(14);
    expect(plan.shots[0].endSec).toBe(4);
    expect(plan.shots[1].startSec).toBe(4);
    expect(plan.shots[1].endSec).toBe(14);
  });
});

// ── regenerateShot duration 보존 ─────────────────────────────────────────────

describe("regenerateShot duration 보존", () => {
  it("[요구#8] safeDuration(cfg.durationSeconds)가 부모 shot duration을 유지", () => {
    // 시나리오: 부모 shot이 6초, config도 6초
    const parentShotDuration = 6;
    const cfg = { durationSeconds: parentShotDuration };
    // regenerateShot 코드에서는 safeDuration(cfg.durationSeconds)를 사용
    const result = safeDuration(cfg.durationSeconds);
    expect(result).toBe(6);
    // 8로 회귀하지 않아야 함
    expect(result).not.toBe(DURATION_FALLBACK);
  });

  it("[요구#8] safeDuration은 undefined config에서만 fallback", () => {
    const result = safeDuration(undefined);
    expect(result).toBe(DURATION_FALLBACK);
  });
});
