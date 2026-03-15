/**
 * multishot-default-submission.test.ts — 멀티샷 기본 submission 경로 테스트
 *
 * 핵심 검증: submission 직전에 멀티샷이 자동 생성/복구되는지 확인
 */

import { describe, it, expect } from "vitest";
import { prepareMultiShotPayload } from "@/lib/video-generation-core";

const MODEL = "kling-o3-text-to-video";

describe("prepareMultiShotPayload", () => {
  it("12s cinematic — 멀티샷 없으면 자동 생성 (batch)", () => {
    const result = prepareMultiShotPayload({
      durationSec: 12,
      sceneType: "cinematic_sequence",
      basePrompt: "A warrior enters the battlefield",
      modelId: MODEL,
      mode: "batch",
    });

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].role).toBe("establish");
    expect(result[result.length - 1].role).toBe("resolve");
  });

  it("이미 멀티샷 있으면 그대로 반환", () => {
    const existing = [
      { index: 1, prompt: "Shot 1", duration: "6", role: "establish" as const },
      { index: 2, prompt: "Shot 2", duration: "6", role: "resolve" as const },
    ];

    const result = prepareMultiShotPayload({
      existingMultiShot: existing,
      durationSec: 12,
      modelId: MODEL,
    });

    expect(result).toEqual(existing);
  });

  it("의도적 원테이크 → 자동 생성 안함", () => {
    const result = prepareMultiShotPayload({
      durationSec: 12,
      modelId: MODEL,
      intentionalOneTake: true,
    });

    expect(result).toEqual([]);
  });

  it("모델 없으면 repair 안함", () => {
    const result = prepareMultiShotPayload({
      durationSec: 12,
    });
    expect(result).toEqual([]);
  });

  it("3초 → 빈 배열", () => {
    const result = prepareMultiShotPayload({
      durationSec: 3,
      modelId: MODEL,
    });
    expect(result).toEqual([]);
  });

  it("9초 default → 강제 멀티샷 (어떤 씬이든)", () => {
    const result = prepareMultiShotPayload({
      durationSec: 9,
      sceneType: "default",
      modelId: MODEL,
    });

    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("15초 environment → 4+ 샷", () => {
    const result = prepareMultiShotPayload({
      durationSec: 15,
      sceneType: "environment",
      basePrompt: "Vast mountain landscape under golden light",
      modelId: MODEL,
      mode: "batch",
    });

    expect(result.length).toBeGreaterThanOrEqual(4);

    // duration 합 = 15
    const totalDur = result.reduce((sum, s) => sum + parseInt(s.duration, 10), 0);
    expect(totalDur).toBe(15);
  });
});
