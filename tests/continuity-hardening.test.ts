/**
 * continuity-hardening.test.ts — 이어만들기 견고화 테스트
 *
 * Priority A: extendPrompt 누락 시 이전 컷 컨텍스트 합성 fallback
 * Priority B: sourceVideo 누락 시 명시적 degradation 기록
 * Priority C: continuityQuality 메타데이터 구조 검증
 * Priority D: autoLinkFirstFrame OFF 시 degradation 표시
 */

import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════
// Priority A: extendPrompt fallback 합성 로직 (순수 함수 추출 테스트)
// ═══════════════════════════════════════════════════════════════════

/**
 * 이전 컷 데이터로 연속성 컨텍스트를 합성하는 순수 함수 (useVideoGeneration.ts 로직 미러)
 */
function synthesizeFallbackExtendPrompt(
  prevCut: { sceneDescription?: string; cameraDirection?: string; moodLighting?: string } | undefined,
  currentVideoPrompt: string,
  currentSceneDescription?: string,
): { prompt: string; elementCount: number } {
  if (!prevCut) {
    return { prompt: currentVideoPrompt, elementCount: 0 };
  }
  const continuityParts: string[] = [];
  if (prevCut.sceneDescription) {
    continuityParts.push(`Continuing from: ${prevCut.sceneDescription.slice(0, 80)}`);
  }
  if (prevCut.cameraDirection) {
    continuityParts.push(`Previous camera: ${prevCut.cameraDirection}`);
  }
  if (prevCut.moodLighting) {
    continuityParts.push(`Mood: ${prevCut.moodLighting}`);
  }
  const currentScene = currentVideoPrompt || currentSceneDescription || "";
  continuityParts.push(currentScene);
  return {
    prompt: continuityParts.filter(Boolean).join(". "),
    elementCount: continuityParts.filter(Boolean).length,
  };
}

describe("Priority A: extendPrompt fallback 합성", () => {
  it("이전 컷 데이터가 있으면 연속성 컨텍스트 포함", () => {
    const result = synthesizeFallbackExtendPrompt(
      {
        sceneDescription: "A warrior stands on a cliff edge, wind blowing",
        cameraDirection: "wide angle tracking shot",
        moodLighting: "golden hour, dramatic shadows",
      },
      "The warrior leaps into battle",
    );

    expect(result.prompt).toContain("Continuing from:");
    expect(result.prompt).toContain("Previous camera:");
    expect(result.prompt).toContain("Mood:");
    expect(result.prompt).toContain("The warrior leaps into battle");
    expect(result.elementCount).toBe(4); // scene + camera + mood + current
  });

  it("이전 컷이 없으면 현재 videoPrompt만 사용", () => {
    const result = synthesizeFallbackExtendPrompt(
      undefined,
      "The warrior leaps into battle",
    );

    expect(result.prompt).toBe("The warrior leaps into battle");
    expect(result.elementCount).toBe(0);
  });

  it("이전 컷에 일부 필드만 있으면 있는 것만 합성", () => {
    const result = synthesizeFallbackExtendPrompt(
      { sceneDescription: "Mountain landscape" },
      "Valley view",
    );

    expect(result.prompt).toContain("Continuing from: Mountain landscape");
    expect(result.prompt).toContain("Valley view");
    expect(result.prompt).not.toContain("Previous camera:");
    expect(result.prompt).not.toContain("Mood:");
    expect(result.elementCount).toBe(2);
  });

  it("sceneDescription 80자 제한", () => {
    const longDesc = "A".repeat(120);
    const result = synthesizeFallbackExtendPrompt(
      { sceneDescription: longDesc },
      "Next scene",
    );

    const contPart = result.prompt.split(". ")[0];
    // "Continuing from: " (18자) + 80자 = 98자 이하
    expect(contPart.length).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Priority B: sourceVideo 누락 감지
// ═══════════════════════════════════════════════════════════════════

describe("Priority B: sourceVideo 누락 감지", () => {
  function detectSourceVideoDegradation(
    videoMode: string,
    cutNumber: number,
    sourceVideo: string,
    prevClipStatus?: string,
    prevClipRawVideoUri?: string,
  ): string | undefined {
    if (videoMode === "extend" && cutNumber > 1 && !sourceVideo) {
      return "sourceVideo_missing";
    }
    return undefined;
  }

  it("extend 모드 + sourceVideo 없음 → degradation 감지", () => {
    expect(detectSourceVideoDegradation("extend", 2, "")).toBe("sourceVideo_missing");
    expect(detectSourceVideoDegradation("extend", 3, "")).toBe("sourceVideo_missing");
  });

  it("extend 모드 + sourceVideo 있음 → 정상", () => {
    expect(detectSourceVideoDegradation("extend", 2, "veo-task-123")).toBeUndefined();
  });

  it("generate 모드 → degradation 없음", () => {
    expect(detectSourceVideoDegradation("generate", 2, "")).toBeUndefined();
  });

  it("CUT 1 → degradation 없음", () => {
    expect(detectSourceVideoDegradation("extend", 1, "")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Priority C: continuityQuality 메타데이터 구조
// ═══════════════════════════════════════════════════════════════════

describe("Priority C: continuityQuality 스코어 계산", () => {
  function computeContinuityScore(
    hasSourceVideo: boolean,
    continuityFrameSource: string,
  ): number {
    if (hasSourceVideo) return 100;
    if (
      continuityFrameSource !== "none" &&
      continuityFrameSource !== "text_to_video_fallback" &&
      continuityFrameSource !== "disabled_by_autoLinkFirstFrame"
    ) {
      return 60;
    }
    return 0;
  }

  it("sourceVideo 있음 → 100점", () => {
    expect(computeContinuityScore(true, "lastFrameBase64_cached")).toBe(100);
    expect(computeContinuityScore(true, "none")).toBe(100);
  });

  it("sourceVideo 없음 + 프레임 있음 → 60점", () => {
    expect(computeContinuityScore(false, "lastFrameBase64_cached")).toBe(60);
    expect(computeContinuityScore(false, "video_capture")).toBe(60);
    expect(computeContinuityScore(false, "storyboard_end")).toBe(60);
    expect(computeContinuityScore(false, "storyboard_start")).toBe(60);
  });

  it("sourceVideo 없음 + 프레임 없음 → 0점", () => {
    expect(computeContinuityScore(false, "none")).toBe(0);
    expect(computeContinuityScore(false, "text_to_video_fallback")).toBe(0);
  });

  it("autoLinkFirstFrame OFF → 0점", () => {
    expect(computeContinuityScore(false, "disabled_by_autoLinkFirstFrame")).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Priority D: autoLinkFirstFrame OFF degradation
// ═══════════════════════════════════════════════════════════════════

describe("Priority D: autoLinkFirstFrame OFF degradation", () => {
  function computeEffectiveDegradation(
    continuityDegradation: string | undefined,
    continuityFrameSource: string,
    hasSourceVideo: boolean,
  ): string | undefined {
    return (
      continuityDegradation ||
      (continuityFrameSource === "disabled_by_autoLinkFirstFrame" ? "autoLink_off" : undefined) ||
      (!hasSourceVideo ? "sourceVideo_missing" : undefined)
    );
  }

  it("autoLinkFirstFrame OFF → autoLink_off degradation", () => {
    expect(
      computeEffectiveDegradation(undefined, "disabled_by_autoLinkFirstFrame", false),
    ).toBe("autoLink_off");
  });

  it("sourceVideo 누락이 우선 degradation → sourceVideo_missing", () => {
    expect(
      computeEffectiveDegradation("sourceVideo_missing", "lastFrameBase64_cached", false),
    ).toBe("sourceVideo_missing");
  });

  it("모두 정상 → undefined", () => {
    expect(
      computeEffectiveDegradation(undefined, "lastFrameBase64_cached", true),
    ).toBeUndefined();
  });

  it("autoLink OFF + sourceVideo 있음 (드문 케이스) → autoLink_off", () => {
    expect(
      computeEffectiveDegradation(undefined, "disabled_by_autoLinkFirstFrame", true),
    ).toBe("autoLink_off");
  });
});
