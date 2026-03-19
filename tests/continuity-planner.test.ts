/**
 * continuity-planner.test.ts — continuity planner 계획 수립 테스트
 */
import { describe, it, expect } from "vitest";
import {
  buildContinuityPlan,
  propagateEndState,
  buildCharacterLockBlock,
  buildContinuationFromBlock,
  buildEndingRuleBlock,
  buildNarrativePositionBlock,
} from "@/lib/continuity-planner";
import type { ContinuityPlannerInput } from "@/lib/continuity-planner";
import type { SegmentState } from "@/types/continuity";
import { EMPTY_SEGMENT_STATE } from "@/types/continuity";

const BASE_INPUT: ContinuityPlannerInput = {
  totalDurationSec: 60,
  storyText: "한 남자가 도시를 걸으며 과거를 회상한다",
  primaryCharacterDescription: "30대 한국 남성, 검은 단발, 회색 코트",
  primaryCharacterClothing: "grey overcoat, black turtleneck, dark slacks",
  primaryCharacterBodyType: "average build, 178cm",
  primaryCharacterFeatures: ["slight stubble", "silver watch on left wrist"],
  styleId: "live-action",
};

describe("buildContinuityPlan", () => {
  it("60초 입력 → 6개 세그먼트 생성", () => {
    const plan = buildContinuityPlan(BASE_INPUT);
    expect(plan.segmentCount).toBe(6);
    expect(plan.segments).toHaveLength(6);
    expect(plan.totalDurationSec).toBe(60);
  });

  it("planId가 고유하게 생성됨", () => {
    const plan1 = buildContinuityPlan(BASE_INPUT);
    const plan2 = buildContinuityPlan(BASE_INPUT);
    expect(plan1.planId).not.toBe(plan2.planId);
  });

  it("첫 세그먼트 role = opening, 마지막 = closing", () => {
    const plan = buildContinuityPlan(BASE_INPUT);
    expect(plan.segments[0].role).toBe("opening");
    expect(plan.segments[plan.segmentCount - 1].role).toBe("closing");
  });

  it("climax 세그먼트가 반드시 존재", () => {
    const plan = buildContinuityPlan(BASE_INPUT);
    expect(plan.segments.some(s => s.role === "climax")).toBe(true);
  });

  it("마지막 세그먼트만 isLastSegment=true", () => {
    const plan = buildContinuityPlan(BASE_INPUT);
    plan.segments.forEach((seg, i) => {
      expect(seg.isLastSegment).toBe(i === plan.segmentCount - 1);
    });
  });

  it("duration 합이 totalDurationSec와 일치 (±2초 허용)", () => {
    const plan = buildContinuityPlan(BASE_INPUT);
    const totalDur = plan.segments.reduce((sum, s) => sum + s.durationSec, 0);
    expect(Math.abs(totalDur - 60)).toBeLessThanOrEqual(2);
  });

  it("globalAnchors에 character 정보가 반영됨", () => {
    const plan = buildContinuityPlan(BASE_INPUT);
    expect(plan.globalAnchors.character.primarySubjectDescription).toContain("30대 한국 남성");
    expect(plan.globalAnchors.character.clothingLock).toContain("grey overcoat");
    expect(plan.globalAnchors.character.distinctiveFeatures).toContain("slight stubble");
  });

  it("감정 궤적이 세그먼트 수와 일치", () => {
    const plan = buildContinuityPlan(BASE_INPUT);
    expect(plan.globalAnchors.narrative.emotionalTrajectory).toHaveLength(plan.segmentCount);
  });

  it("첫 세그먼트의 carryForward.fromPrevEndState = false", () => {
    const plan = buildContinuityPlan(BASE_INPUT);
    expect(plan.segments[0].carryForward.fromPrevEndState).toBe(false);
  });

  it("2번째 이후 세그먼트의 carryForward.fromPrevEndState = true", () => {
    const plan = buildContinuityPlan(BASE_INPUT);
    for (let i = 1; i < plan.segmentCount; i++) {
      expect(plan.segments[i].carryForward.fromPrevEndState).toBe(true);
    }
  });

  it("30초 입력 → 3개 세그먼트", () => {
    const plan = buildContinuityPlan({ ...BASE_INPUT, totalDurationSec: 30 });
    expect(plan.segmentCount).toBe(3);
  });

  it("120초 입력 → 12개 세그먼트", () => {
    const plan = buildContinuityPlan({ ...BASE_INPUT, totalDurationSec: 120 });
    expect(plan.segmentCount).toBe(12);
  });

  it("마지막 세그먼트 외에는 resolve role이 endingRule에서 허용되지 않아야 함 (bannedLastShotRoles)", () => {
    const plan = buildContinuityPlan(BASE_INPUT);
    for (let i = 0; i < plan.segmentCount - 1; i++) {
      const allowed = plan.segments[i].endingRule.lastShotAllowedRoles;
      // resolve가 allowed에 없어야 함 (policy에서 banned)
      expect(allowed).not.toContain("resolve");
    }
  });
});

describe("propagateEndState", () => {
  it("완료된 세그먼트의 endState가 다음 세그먼트의 startState로 전파됨", () => {
    const plan = buildContinuityPlan(BASE_INPUT);
    const confirmedEnd: SegmentState = {
      subjectPosition: "center-frame, facing left",
      cameraState: "CU, low-angle, static",
      emotionIntensity: 65,
      emotionKeyword: "determined",
      lightingState: "warm amber from right",
      motionVector: "turning left slowly",
      environmentState: "dimly lit alley",
    };

    const updated = propagateEndState(plan, 0, confirmedEnd);

    expect(updated.segments[0].endState).toEqual(confirmedEnd);
    expect(updated.segments[1].startState.subjectPosition).toBe("center-frame, facing left");
    expect(updated.segments[1].startState.cameraState).toBe("CU, low-angle, static");
  });
});

describe("prompt block builders", () => {
  const plan = buildContinuityPlan(BASE_INPUT);

  it("buildCharacterLockBlock — character 정보가 포함됨", () => {
    const block = buildCharacterLockBlock(plan.globalAnchors);
    expect(block).toContain("CHARACTER LOCK");
    expect(block).toContain("30대 한국 남성");
    expect(block).toContain("grey overcoat");
    expect(block).toContain("slight stubble");
  });

  it("buildCharacterLockBlock — 빈 character면 빈 문자열", () => {
    const emptyPlan = buildContinuityPlan({
      totalDurationSec: 30,
      storyText: "test",
    });
    const block = buildCharacterLockBlock(emptyPlan.globalAnchors);
    expect(block).toBe("");
  });

  it("buildContinuationFromBlock — prevEndState 포함", () => {
    const prevEnd: SegmentState = {
      subjectPosition: "right-frame, walking",
      cameraState: "MS, eye-level, dolly right",
      emotionIntensity: 45,
      emotionKeyword: "anxious",
      lightingState: "cool blue overhead",
      motionVector: "walking right steadily",
      environmentState: "subway station platform",
    };
    const block = buildContinuationFromBlock(prevEnd);
    expect(block).toContain("CONTINUATION FROM");
    expect(block).toContain("right-frame, walking");
    expect(block).toContain("anxious");
    expect(block).toContain("seamless continuation");
  });

  it("buildContinuationFromBlock — 빈 prevEnd면 빈 문자열", () => {
    expect(buildContinuationFromBlock(EMPTY_SEGMENT_STATE)).toBe("");
  });

  it("buildEndingRuleBlock — 마지막 세그먼트면 빈 문자열", () => {
    const lastSeg = plan.segments[plan.segmentCount - 1];
    expect(buildEndingRuleBlock(lastSeg.endingRule, true)).toBe("");
  });

  it("buildEndingRuleBlock — 중간 세그먼트면 규칙 포함", () => {
    const midSeg = plan.segments[1];
    const block = buildEndingRuleBlock(midSeg.endingRule, false);
    expect(block).toContain("SEGMENT ENDING RULE");
    expect(block).toContain("DO NOT close the scene");
  });

  it("buildNarrativePositionBlock — 위치 정보 포함", () => {
    const block = buildNarrativePositionBlock(2, 6, "building", 45);
    expect(block).toContain("Segment 3/6");
    expect(block).toContain("BUILDING");
    expect(block).toContain("45/100");
  });
});
