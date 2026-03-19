/**
 * continuity-policy.test.ts — continuity policy 규칙 단위 테스트
 */
import { describe, it, expect } from "vitest";
import {
  SEGMENT_DURATION_POLICY,
  DEFAULT_ANCHOR_LOCK_POLICY,
  DEFAULT_SEGMENT_ENDING_POLICY,
  DEFAULT_CONTINUITY_POLICY,
  isContinuityModeEligible,
  computeSegmentCount,
  assignSegmentRoles,
  selectTransitionStrategy,
  TENSION_BY_ROLE,
  CARRY_FORWARD_LOCK_FIELDS,
} from "@/lib/continuity-policy";

describe("isContinuityModeEligible", () => {
  it("20초 이상이면 continuity mode 적합", () => {
    expect(isContinuityModeEligible(20)).toBe(true);
    expect(isContinuityModeEligible(60)).toBe(true);
    expect(isContinuityModeEligible(120)).toBe(true);
  });

  it("20초 미만이면 continuity mode 불필요", () => {
    expect(isContinuityModeEligible(15)).toBe(false);
    expect(isContinuityModeEligible(10)).toBe(false);
    expect(isContinuityModeEligible(5)).toBe(false);
  });

  it("경계값 — 정확히 minTotal이면 적합", () => {
    expect(isContinuityModeEligible(SEGMENT_DURATION_POLICY.minTotalForContinuity)).toBe(true);
  });
});

describe("computeSegmentCount", () => {
  it("15초 이하 → 1개 세그먼트 (분할 불필요)", () => {
    expect(computeSegmentCount(15)).toBe(1);
    expect(computeSegmentCount(10)).toBe(1);
  });

  it("30초 → 3개 세그먼트 (10초씩)", () => {
    expect(computeSegmentCount(30)).toBe(3);
  });

  it("60초 → 6개 세그먼트 (10초씩)", () => {
    expect(computeSegmentCount(60)).toBe(6);
  });

  it("120초 → 12개 세그먼트", () => {
    expect(computeSegmentCount(120)).toBe(12);
  });

  it("최소 세그먼트 길이 미만이 되지 않아야 함", () => {
    // 7초 → minSegmentSec=5 제약으로 1개
    const count = computeSegmentCount(7);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(7 / count).toBeGreaterThanOrEqual(SEGMENT_DURATION_POLICY.minSegmentSec);
  });
});

describe("assignSegmentRoles", () => {
  it("1개 → opening만", () => {
    expect(assignSegmentRoles(1)).toEqual(["opening"]);
  });

  it("2개 → opening + closing", () => {
    expect(assignSegmentRoles(2)).toEqual(["opening", "closing"]);
  });

  it("3개 → opening + climax + closing", () => {
    expect(assignSegmentRoles(3)).toEqual(["opening", "climax", "closing"]);
  });

  it("4개 → opening + building + climax + closing", () => {
    expect(assignSegmentRoles(4)).toEqual(["opening", "building", "climax", "closing"]);
  });

  it("5개 이상 — 반드시 opening으로 시작, closing으로 끝남", () => {
    for (const count of [5, 6, 7, 8, 10]) {
      const roles = assignSegmentRoles(count);
      expect(roles).toHaveLength(count);
      expect(roles[0]).toBe("opening");
      expect(roles[roles.length - 1]).toBe("closing");
      expect(roles).toContain("climax");
    }
  });

  it("길이가 항상 segmentCount와 일치", () => {
    for (let n = 1; n <= 12; n++) {
      expect(assignSegmentRoles(n)).toHaveLength(n);
    }
  });
});

describe("selectTransitionStrategy", () => {
  it("climax 진입 → motion_carry", () => {
    expect(selectTransitionStrategy("building", "climax")).toBe("motion_carry");
  });

  it("climax 탈출 → camera_continuation", () => {
    expect(selectTransitionStrategy("climax", "falling")).toBe("camera_continuation");
  });

  it("opening → building → gaze_bridge", () => {
    expect(selectTransitionStrategy("opening", "building")).toBe("gaze_bridge");
  });
});

describe("TENSION_BY_ROLE", () => {
  it("climax의 tension이 가장 높아야 함", () => {
    const maxOther = Math.max(
      TENSION_BY_ROLE.opening.max,
      TENSION_BY_ROLE.building.max,
      TENSION_BY_ROLE.falling.max,
      TENSION_BY_ROLE.closing.max,
    );
    expect(TENSION_BY_ROLE.climax.min).toBeGreaterThan(maxOther - 20);
  });
});

describe("policy constants", () => {
  it("anchor lock defaults 존재", () => {
    expect(DEFAULT_ANCHOR_LOCK_POLICY.characterAppearance).toBe("hard");
    expect(DEFAULT_ANCHOR_LOCK_POLICY.colorPalette).toBe("hard");
    expect(DEFAULT_ANCHOR_LOCK_POLICY.lightingSetup).toBe("soft");
  });

  it("segment ending defaults 존재", () => {
    expect(DEFAULT_SEGMENT_ENDING_POLICY.openEndSeconds).toBe(2);
    expect(DEFAULT_SEGMENT_ENDING_POLICY.bannedLastShotRoles).toContain("resolve");
  });

  it("carry-forward lock fields 정의됨", () => {
    expect(CARRY_FORWARD_LOCK_FIELDS).toContain("subjectPosition");
    expect(CARRY_FORWARD_LOCK_FIELDS).toContain("cameraState");
  });

  it("aggregate policy가 모든 하위 정책을 포함", () => {
    expect(DEFAULT_CONTINUITY_POLICY.segmentDuration).toBeDefined();
    expect(DEFAULT_CONTINUITY_POLICY.anchorLock).toBeDefined();
    expect(DEFAULT_CONTINUITY_POLICY.segmentEnding).toBeDefined();
    expect(DEFAULT_CONTINUITY_POLICY.promptInjection).toBeDefined();
    expect(DEFAULT_CONTINUITY_POLICY.validationThresholds.length).toBeGreaterThan(0);
  });
});
