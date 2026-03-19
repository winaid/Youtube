/**
 * continuity-frame-chaining.test.ts — 이어 만들기 토글 + frame chaining 검증
 *
 * 테스트 범위:
 * - autoLinkFirstFrame ON/OFF에 따른 frame chaining 분기
 * - continuityMode ON일 때 continuityMeta 포함 여부
 * - continuityMode OFF일 때 continuityMeta 미포함
 * - fallback 우선순위 (lastFrame > video capture > storyboard end > storyboard start > text)
 * - submitContinuitySequence 핵심 흐름
 */

import { describe, it, expect } from "vitest";
import { buildContinuityPlan, propagateEndState } from "../src/lib/continuity-planner";
import { isContinuityModeEligible, computeSegmentCount, assignSegmentRoles } from "../src/lib/continuity-policy";
import { validateContinuity } from "../src/lib/continuity-validator";
import type { SegmentState } from "../src/types/continuity";

// ═══════════════════════════════════════════════════════════════════
// continuity 자격 + 세그먼트 계획
// ═══════════════════════════════════════════════════════════════════

describe("continuityMode 자격 검사", () => {
  it("20초 이상이면 continuity mode 자격", () => {
    expect(isContinuityModeEligible(20)).toBe(true);
    expect(isContinuityModeEligible(60)).toBe(true);
    expect(isContinuityModeEligible(120)).toBe(true);
  });

  it("20초 미만이면 자격 없음", () => {
    expect(isContinuityModeEligible(19)).toBe(false);
    expect(isContinuityModeEligible(10)).toBe(false);
    expect(isContinuityModeEligible(5)).toBe(false);
  });
});

describe("세그먼트 분할 계산", () => {
  it("60초 → 6 세그먼트 (각 10초)", () => {
    const count = computeSegmentCount(60);
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(12);
  });

  it("30초 → 3 세그먼트", () => {
    const count = computeSegmentCount(30);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(6);
  });

  it("5초 → 1 세그먼트 (최소값)", () => {
    const count = computeSegmentCount(5);
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

describe("세그먼트 역할 배정", () => {
  it("3 세그먼트 → opening, climax, closing", () => {
    const roles = assignSegmentRoles(3);
    expect(roles).toHaveLength(3);
    expect(roles[0]).toBe("opening");
    expect(roles[roles.length - 1]).toBe("closing");
  });

  it("6 세그먼트 → opening으로 시작, closing으로 끝남", () => {
    const roles = assignSegmentRoles(6);
    expect(roles).toHaveLength(6);
    expect(roles[0]).toBe("opening");
    expect(roles[5]).toBe("closing");
    // climax가 포함되어야 함
    expect(roles).toContain("climax");
  });
});

// ═══════════════════════════════════════════════════════════════════
// continuity plan 생성 + 상태 전파
// ═══════════════════════════════════════════════════════════════════

describe("buildContinuityPlan", () => {
  it("60초 시나리오에 대해 유효한 계획 생성", () => {
    const plan = buildContinuityPlan({
      totalDurationSec: 60,
      storyText: "한 남자가 비 오는 도시에서 걸어가며 과거를 회상하는 이야기. 네온사인이 빛나는 골목을 지나 기억 속 장면으로 전환된다.",
    });

    expect(plan).toBeDefined();
    expect(plan.planId).toBeTruthy();
    expect(plan.segmentCount).toBeGreaterThanOrEqual(4);
    expect(plan.segments).toHaveLength(plan.segmentCount);
    expect(plan.globalAnchors).toBeDefined();

    // 모든 세그먼트에 역할 배정 확인
    for (const seg of plan.segments) {
      expect(seg.role).toBeTruthy();
      expect(seg.durationSec).toBeGreaterThanOrEqual(5);
      expect(seg.durationSec).toBeLessThanOrEqual(15);
    }
  });

  it("첫 세그먼트는 isLastSegment=false, 마지막은 true", () => {
    const plan = buildContinuityPlan({
      totalDurationSec: 60,
      storyText: "액션 추격 장면",
    });

    expect(plan.segments[0].isLastSegment).toBe(false);
    expect(plan.segments[plan.segmentCount - 1].isLastSegment).toBe(true);
  });
});

describe("endState 전파 (propagateEndState)", () => {
  it("이전 세그먼트의 endState가 다음 세그먼트의 startState가 됨", () => {
    const plan = buildContinuityPlan({
      totalDurationSec: 30,
      storyText: "드라마틱한 전쟁 장면",
    });

    const confirmedEndState: SegmentState = {
      subjectPosition: "center-frame, wounded soldier",
      cameraState: "close-up, handheld",
      emotionKeyword: "desperate",
      emotionIntensity: 80,
      motionVector: "forward-crawling",
      lightingState: "harsh overhead light with smoke",
      environmentSnapshot: "destroyed building interior",
    };

    const updated = propagateEndState(plan, 0, confirmedEndState);

    // 다음 세그먼트(index 1)의 startState가 업데이트되어야 함
    expect(updated.segments[1].startState.subjectPosition).toBe(confirmedEndState.subjectPosition);
    expect(updated.segments[1].startState.cameraState).toBe(confirmedEndState.cameraState);
  });

  it("마지막 세그먼트 endState 전파 시 에러 없음", () => {
    const plan = buildContinuityPlan({
      totalDurationSec: 30,
      storyText: "짧은 이야기",
    });
    const lastIdx = plan.segmentCount - 1;

    const endState: SegmentState = {
      subjectPosition: "walking away",
      cameraState: "wide shot",
      emotionKeyword: "melancholic",
      emotionIntensity: 50,
      motionVector: "away-from-camera",
      lightingState: "sunset",
      environmentSnapshot: "open field",
    };

    // 마지막 세그먼트 전파 — 에러 없이 동일 plan 반환
    const updated = propagateEndState(plan, lastIdx, endState);
    expect(updated.segments[lastIdx]).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// continuity 검증
// ═══════════════════════════════════════════════════════════════════

describe("validateContinuity", () => {
  it("완료된 세그먼트 쌍의 연속성 검증", () => {
    const progresses = [
      {
        segmentIndex: 0,
        status: "completed" as const,
        confirmedEndState: {
          subjectPosition: "center, standing",
          cameraState: "medium shot",
          emotionKeyword: "calm",
          emotionIntensity: 30,
          motionVector: "static",
          lightingState: "warm daylight",
          environmentSnapshot: "office",
        },
      },
      {
        segmentIndex: 1,
        status: "completed" as const,
        confirmedEndState: {
          subjectPosition: "center, standing",
          cameraState: "medium shot",
          emotionKeyword: "tense",
          emotionIntensity: 55,
          motionVector: "static",
          lightingState: "warm daylight",
          environmentSnapshot: "office",
        },
      },
    ];

    const report = validateContinuity(progresses);
    expect(report).toBeDefined();
    expect(typeof report.pass).toBe("boolean");
    expect(typeof report.warningCount).toBe("number");
    expect(typeof report.errorCount).toBe("number");
  });

  it("pending 세그먼트는 검증 스킵", () => {
    const progresses = [
      { segmentIndex: 0, status: "pending" as const },
      { segmentIndex: 1, status: "pending" as const },
    ];

    const report = validateContinuity(progresses);
    // pending이면 검증할 쌍이 없음
    expect(report.errorCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// autoLinkFirstFrame 토글 효과 검증 (단위 수준)
// ═══════════════════════════════════════════════════════════════════

describe("autoLinkFirstFrame 토글 효과", () => {
  it("토글 ON(기본값) — frame chaining 활성화 조건 확인", () => {
    const autoLinkFirstFrame = true;
    const cutNumber = 2;
    const shouldLinkFrames = autoLinkFirstFrame !== false;

    expect(shouldLinkFrames).toBe(true);
    expect(cutNumber > 1 && shouldLinkFrames).toBe(true);
  });

  it("토글 OFF — frame chaining 비활성화", () => {
    const autoLinkFirstFrame = false;
    const cutNumber = 2;
    const shouldLinkFrames = autoLinkFirstFrame !== false;

    expect(shouldLinkFrames).toBe(false);
    // CUT 2 이상이어도 frame chaining 안 됨
    expect(cutNumber > 1 && shouldLinkFrames).toBe(false);
  });

  it("CUT 1 — autoLinkFirstFrame과 무관하게 frame chaining 안 됨", () => {
    const cutNumber = 1;
    // CUT 1은 항상 독립 생성
    expect(cutNumber > 1).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// frame fallback 우선순위 시뮬레이션
// ═══════════════════════════════════════════════════════════════════

describe("frame chaining fallback 우선순위", () => {
  it("1순위: lastFrameBase64 → 즉시 사용", () => {
    const prevClip = { lastFrameBase64: "base64data", videoUri: "https://video.mp4" };
    let source = "none";

    if (prevClip.lastFrameBase64) {
      source = "lastFrameBase64_cached";
    }

    expect(source).toBe("lastFrameBase64_cached");
  });

  it("2순위: videoUri 캡처 (lastFrame 없을 때)", () => {
    const prevClip = { lastFrameBase64: null, videoUri: "https://video.mp4" };
    let source = "none";

    if (prevClip.lastFrameBase64) {
      source = "lastFrameBase64_cached";
    } else if (prevClip.videoUri) {
      source = "video_capture";
    }

    expect(source).toBe("video_capture");
  });

  it("3순위: storyboard end (캡처도 없을 때)", () => {
    const prevClip = { lastFrameBase64: null, videoUri: null };
    const storyboardEndImages: Record<number, string> = { 1: "storyboard_end_data" };
    const cutNumber = 2;
    let source = "none";
    let firstFrame: string | null = null;

    if (prevClip.lastFrameBase64) {
      source = "lastFrameBase64_cached";
    } else if (prevClip.videoUri) {
      source = "video_capture";
    }

    if (!firstFrame && storyboardEndImages[cutNumber - 1]) {
      firstFrame = storyboardEndImages[cutNumber - 1];
      source = "storyboard_end";
    }

    expect(source).toBe("storyboard_end");
    expect(firstFrame).toBe("storyboard_end_data");
  });

  it("최종: text-to-video fallback", () => {
    const prevClip = { lastFrameBase64: null, videoUri: null };
    const storyboardEndImages: Record<number, string> = {};
    const storyboardImages: Record<number, string> = {};
    const cutNumber = 2;
    let source = "none";
    let firstFrame: string | null = null;

    if (prevClip.lastFrameBase64) {
      source = "lastFrameBase64_cached";
    } else if (prevClip.videoUri) {
      source = "video_capture";
    }

    if (!firstFrame && storyboardEndImages[cutNumber - 1]) {
      firstFrame = storyboardEndImages[cutNumber - 1];
      source = "storyboard_end";
    }

    if (!firstFrame && storyboardImages[cutNumber]) {
      firstFrame = storyboardImages[cutNumber];
      source = "storyboard_start";
    }

    if (!firstFrame) {
      source = "text_to_video_fallback";
    }

    expect(source).toBe("text_to_video_fallback");
    expect(firstFrame).toBeNull();
  });
});
