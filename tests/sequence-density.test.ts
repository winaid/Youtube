/**
 * sequence-density.test.ts — 15초 상한 컷 밀도 보정 테스트
 *
 * 테스트 범주:
 * 1. recommendMinimumCutCount 정책 숫자
 * 2. needsDensityBoost 판정
 * 3. densifyCuts — 15초/1컷 → 3컷 이상
 * 4. densifyCuts — 12초/1컷 → 3컷 이상
 * 5. densifyCuts — 8초/1컷 → 2컷 이상
 * 6. densifyCuts — 4초/1컷 → 그대로 유지
 * 7. densifyCuts — 15초/이미 3컷 → 과도한 분할 없음
 * 8. scene-like/sequence-like 우선 분할
 * 9. 원본 필드 보존
 * 10. groupId 자동 생성 안 됨
 * 11. densify 후 classify 결합
 */

import { describe, it, expect } from "vitest";
import {
  recommendMinimumCutCount,
  needsDensityBoost,
  densifyCuts,
} from "@/lib/sequence-density";
import { classifyCuts } from "@/lib/structure-classification";

// ═══════════════════════════════════════════════════════════════════
// 1. recommendMinimumCutCount
// ═══════════════════════════════════════════════════════════════════

describe("recommendMinimumCutCount", () => {
  it("should return 1 for 0-4 seconds", () => {
    expect(recommendMinimumCutCount(3)).toBe(1);
    expect(recommendMinimumCutCount(4)).toBe(1);
  });

  it("should return 2 for 5-7 seconds", () => {
    expect(recommendMinimumCutCount(5)).toBe(2);
    expect(recommendMinimumCutCount(7)).toBe(2);
  });

  it("should return 3 for 8-9 seconds", () => {
    expect(recommendMinimumCutCount(8)).toBe(3);
    expect(recommendMinimumCutCount(9)).toBe(3);
  });

  it("should return 4 for 10-12 seconds", () => {
    expect(recommendMinimumCutCount(10)).toBe(4);
    expect(recommendMinimumCutCount(12)).toBe(4);
  });

  it("should return 5 for 13-15 seconds", () => {
    expect(recommendMinimumCutCount(13)).toBe(5);
    expect(recommendMinimumCutCount(15)).toBe(5);
  });

  it("should return 5 for > 15 seconds", () => {
    expect(recommendMinimumCutCount(20)).toBe(5);
    expect(recommendMinimumCutCount(30)).toBe(5);
  });

  it("should return 1 for invalid input", () => {
    expect(recommendMinimumCutCount(0)).toBe(1);
    expect(recommendMinimumCutCount(-5)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. needsDensityBoost
// ═══════════════════════════════════════════════════════════════════

describe("needsDensityBoost", () => {
  it("should return true for 15s single cut", () => {
    expect(needsDensityBoost([{ durationSec: 15 }])).toBe(true);
  });

  it("should return true for 12s single cut", () => {
    expect(needsDensityBoost([{ durationSec: 12 }])).toBe(true);
  });

  it("should return true for 8s single cut", () => {
    expect(needsDensityBoost([{ durationSec: 8 }])).toBe(true);
  });

  it("should return false for 4s single cut", () => {
    expect(needsDensityBoost([{ durationSec: 4 }])).toBe(false);
  });

  it("should return true for 15s with 3 cuts (new policy: 5 needed)", () => {
    expect(needsDensityBoost([
      { durationSec: 5 },
      { durationSec: 5 },
      { durationSec: 5 },
    ])).toBe(true);
  });

  it("should return false for 15s with 5 cuts", () => {
    expect(needsDensityBoost([
      { durationSec: 3 },
      { durationSec: 3 },
      { durationSec: 3 },
      { durationSec: 3 },
      { durationSec: 3 },
    ])).toBe(false);
  });

  it("should return false for empty cuts", () => {
    expect(needsDensityBoost([])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. densifyCuts — 15초/1컷 → 3컷 이상
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — 15s single cut", () => {
  it("should split 15s single cut into 5+ cuts (new policy)", () => {
    const cuts = [{ cutNumber: 1, durationSec: 15, sceneDescription: "테스트 장면" }];
    const result = densifyCuts(cuts);
    expect(result.length).toBeGreaterThanOrEqual(5);
    // 총 duration 보존
    const totalDuration = result.reduce((s, c) => s + c.durationSec, 0);
    expect(totalDuration).toBe(15);
  });

  it("should preserve original text fields after split", () => {
    const cuts = [{
      cutNumber: 1,
      durationSec: 15,
      sceneDescription: "원본 장면 설명",
      cameraDirection: "slow push-in",
      moodLighting: "golden hour",
      videoPrompt: "original prompt",
      imagePrompt: "original image",
    }];
    const result = densifyCuts(cuts);
    expect(result.length).toBeGreaterThanOrEqual(5);
    for (const cut of result) {
      expect(cut.sceneDescription).toBe("원본 장면 설명");
      expect(cut.cameraDirection).toBe("slow push-in");
      expect(cut.moodLighting).toBe("golden hour");
      expect(cut.videoPrompt).toBe("original prompt");
      expect(cut.imagePrompt).toBe("original image");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. densifyCuts — 12초/1컷 → 3컷 이상
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — 12s single cut", () => {
  it("should split 12s single cut into 4+ cuts (new policy)", () => {
    const cuts = [{ cutNumber: 1, durationSec: 12 }];
    const result = densifyCuts(cuts);
    expect(result.length).toBeGreaterThanOrEqual(4);
    const totalDuration = result.reduce((s, c) => s + c.durationSec, 0);
    expect(totalDuration).toBe(12);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. densifyCuts — 8초/1컷 → 2컷 이상
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — 8s single cut", () => {
  it("should split 8s single cut into 3+ cuts (new policy)", () => {
    const cuts = [{ cutNumber: 1, durationSec: 8 }];
    const result = densifyCuts(cuts);
    expect(result.length).toBeGreaterThanOrEqual(3);
    const totalDuration = result.reduce((s, c) => s + c.durationSec, 0);
    expect(totalDuration).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. densifyCuts — 4초/1컷 → 그대로 유지
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — 4s single cut", () => {
  it("should NOT split 4s single cut", () => {
    const cuts = [{ cutNumber: 1, durationSec: 4 }];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(1);
    expect(result[0].durationSec).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. densifyCuts — 15초/이미 3컷 → 과도한 분할 없음
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — already sufficient cuts", () => {
  it("should NOT split 15s with 5 cuts", () => {
    const cuts = [
      { cutNumber: 1, durationSec: 3 },
      { cutNumber: 2, durationSec: 3 },
      { cutNumber: 3, durationSec: 3 },
      { cutNumber: 4, durationSec: 3 },
      { cutNumber: 5, durationSec: 3 },
    ];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(5);
  });

  it("should split 15s with 4 cuts (need 5)", () => {
    const cuts = [
      { cutNumber: 1, durationSec: 4 },
      { cutNumber: 2, durationSec: 4 },
      { cutNumber: 3, durationSec: 4 },
      { cutNumber: 4, durationSec: 3 },
    ];
    const result = densifyCuts(cuts);
    expect(result.length).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. scene-like / sequence-like 우선 분할
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — prioritize long-class cuts", () => {
  it("should split sequence-like cut before cut-like", () => {
    // 총 10초, 2컷: 3초(cut-like) + 7초. 최소 3컷 필요.
    // 7초 컷이 분할되어야 함 (durationClass 없지만 더 길므로)
    const cuts = [
      { cutNumber: 1, durationSec: 3 },
      { cutNumber: 2, durationSec: 7, durationClass: "sequence-like" as const },
    ];
    const result = densifyCuts(cuts);
    expect(result.length).toBeGreaterThanOrEqual(3);
    // 첫 번째 컷(3초)은 그대로 유지
    expect(result[0].durationSec).toBe(3);
  });

  it("should prefer scene-like over cut-like for splitting", () => {
    // 총 11초, 2컷 → 최소 3컷 필요
    const cuts = [
      { cutNumber: 1, durationSec: 3, durationClass: "cut-like" as const },
      { cutNumber: 2, durationSec: 8, durationClass: "scene-like" as const },
    ];
    const result = densifyCuts(cuts);
    expect(result.length).toBeGreaterThanOrEqual(3);
    // 3초 컷은 유지, 8초 컷이 분할됨
    expect(result[0].durationSec).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. 원본 필드 보존
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — field preservation", () => {
  it("should preserve subjectAction, shotCategory, characterRole", () => {
    const cuts = [{
      cutNumber: 1,
      durationSec: 10,
      subjectAction: "walks forward",
      shotCategory: "character-driven",
      characterRole: "protagonist",
      videoPromptJson: { shotSize: "MS" },
    }];
    const result = densifyCuts(cuts);
    expect(result.length).toBeGreaterThanOrEqual(4);
    for (const cut of result) {
      expect(cut.subjectAction).toBe("walks forward");
      expect(cut.shotCategory).toBe("character-driven");
      expect(cut.characterRole).toBe("protagonist");
      expect(cut.videoPromptJson).toEqual({ shotSize: "MS" });
    }
  });

  it("should renumber cutNumber sequentially", () => {
    const cuts = [{ cutNumber: 1, durationSec: 15 }];
    const result = densifyCuts(cuts);
    result.forEach((c, i) => expect(c.cutNumber).toBe(i + 1));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. groupId 자동 생성 안 됨
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — no groupId generation", () => {
  it("should NOT add groupId to split cuts", () => {
    const cuts = [{ cutNumber: 1, durationSec: 15 }];
    const result = densifyCuts(cuts);
    for (const cut of result) {
      expect((cut as Record<string, unknown>).groupId).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. densify → classify 결합
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts + classifyCuts pipeline", () => {
  it("should produce cuts with structureType and durationClass after pipeline", () => {
    const cuts = [{ cutNumber: 1, durationSec: 15 }];
    const densified = densifyCuts(cuts);
    const classified = classifyCuts(densified);

    expect(classified.length).toBeGreaterThanOrEqual(5);
    for (const cut of classified) {
      expect(cut.structureType).toBeDefined();
      expect(cut.durationClass).toBeDefined();
    }
  });

  it("should classify split cuts correctly by their new duration", () => {
    const cuts = [{ cutNumber: 1, durationSec: 12 }];
    const densified = densifyCuts(cuts);
    const classified = classifyCuts(densified);

    // 12초를 4등분하면 각 3초 → cut-like
    for (const cut of classified) {
      expect(cut.durationSec).toBeLessThan(12);
      expect(["cut-like", "scene-like", "sequence-like"]).toContain(cut.durationClass);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. Edge cases
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — edge cases", () => {
  it("should handle empty array", () => {
    expect(densifyCuts([])).toEqual([]);
  });

  it("should handle very short cut (2s) without splitting", () => {
    // 6초 총 → 최소 2컷 필요, 하지만 2초짜리는 쪼갤 수 없음
    const cuts = [{ cutNumber: 1, durationSec: 2 }, { cutNumber: 2, durationSec: 4 }];
    const result = densifyCuts(cuts);
    // 총 6초, 이미 2컷이므로 분할 불필요
    expect(result.length).toBe(2);
  });

  it("should stop splitting when cuts become too short (≤2s)", () => {
    // 3초 단일 컷, 총 3초 → 최소 1컷이므로 분할 불필요
    const cuts = [{ cutNumber: 1, durationSec: 3 }];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. Client ↔ Server PARITY — drift 방지
// ═══════════════════════════════════════════════════════════════════

import {
  recommendMinimumCutCount as serverRecommend,
  needsDensityBoost as serverNeedsBoost,
  densifyCuts as serverDensify,
} from "../functions/api/_sequence-density";

describe("client ↔ server parity — recommendMinimumCutCount", () => {
  const durations = [0, -5, 1, 3, 5, 6, 8, 9, 10, 12, 15, 16, 20, 30, NaN];

  for (const d of durations) {
    it(`recommendMinimumCutCount(${d}) parity`, () => {
      expect(recommendMinimumCutCount(d)).toBe(serverRecommend(d));
    });
  }
});

describe("client ↔ server parity — needsDensityBoost", () => {
  it("15s single cut", () => {
    const cuts = [{ durationSec: 15 }];
    expect(needsDensityBoost(cuts)).toBe(serverNeedsBoost(cuts));
  });

  it("12s single cut", () => {
    const cuts = [{ durationSec: 12 }];
    expect(needsDensityBoost(cuts)).toBe(serverNeedsBoost(cuts));
  });

  it("8s single cut", () => {
    const cuts = [{ durationSec: 8 }];
    expect(needsDensityBoost(cuts)).toBe(serverNeedsBoost(cuts));
  });

  it("4s single cut", () => {
    const cuts = [{ durationSec: 4 }];
    expect(needsDensityBoost(cuts)).toBe(serverNeedsBoost(cuts));
  });

  it("15s 3 cuts (sufficient)", () => {
    const cuts = [{ durationSec: 5 }, { durationSec: 5 }, { durationSec: 5 }];
    expect(needsDensityBoost(cuts)).toBe(serverNeedsBoost(cuts));
  });

  it("empty array", () => {
    expect(needsDensityBoost([])).toBe(serverNeedsBoost([]));
  });

  it("with explicit totalDurationSec", () => {
    const cuts = [{ durationSec: 3 }];
    expect(needsDensityBoost(cuts, 15)).toBe(serverNeedsBoost(cuts, 15));
  });
});

describe("client ↔ server parity — densifyCuts", () => {
  it("15s 1컷 parity", () => {
    const cuts = [{ cutNumber: 1, durationSec: 15 }];
    expect(densifyCuts(cuts)).toEqual(serverDensify(cuts));
  });

  it("12s 1컷 parity", () => {
    const cuts = [{ cutNumber: 1, durationSec: 12 }];
    expect(densifyCuts(cuts)).toEqual(serverDensify(cuts));
  });

  it("8s 1컷 parity", () => {
    const cuts = [{ cutNumber: 1, durationSec: 8 }];
    expect(densifyCuts(cuts)).toEqual(serverDensify(cuts));
  });

  it("4s 1컷 parity (no split)", () => {
    const cuts = [{ cutNumber: 1, durationSec: 4 }];
    expect(densifyCuts(cuts)).toEqual(serverDensify(cuts));
  });

  it("15s 이미 3컷 parity (no split)", () => {
    const cuts = [
      { cutNumber: 1, durationSec: 5 },
      { cutNumber: 2, durationSec: 5 },
      { cutNumber: 3, durationSec: 5 },
    ];
    expect(densifyCuts(cuts)).toEqual(serverDensify(cuts));
  });

  it("scene-like 긴 컷 + cut-like 짧은 컷 혼합 parity", () => {
    const cuts = [
      { cutNumber: 1, durationSec: 3, durationClass: "cut-like" as const },
      { cutNumber: 2, durationSec: 8, durationClass: "scene-like" as const },
    ];
    expect(densifyCuts(cuts)).toEqual(serverDensify(cuts));
  });

  it("sequence-like 긴 컷 parity", () => {
    const cuts = [
      { cutNumber: 1, durationSec: 12, durationClass: "sequence-like" as const },
    ];
    expect(densifyCuts(cuts)).toEqual(serverDensify(cuts));
  });

  it("duration=0 parity", () => {
    const cuts = [{ cutNumber: 1, durationSec: 0 }];
    expect(densifyCuts(cuts)).toEqual(serverDensify(cuts));
  });

  it("duration=NaN parity", () => {
    const cuts = [{ cutNumber: 1, durationSec: NaN }];
    expect(densifyCuts(cuts)).toEqual(serverDensify(cuts));
  });

  it("duration 음수 parity", () => {
    const cuts = [{ cutNumber: 1, durationSec: -5 }];
    expect(densifyCuts(cuts)).toEqual(serverDensify(cuts));
  });

  it("2초 이하 컷 분할 중단 parity", () => {
    // 총 7초, 2컷 필요. 1초+6초 → 6초만 분할 대상
    const cuts = [
      { cutNumber: 1, durationSec: 1 },
      { cutNumber: 2, durationSec: 6 },
    ];
    expect(densifyCuts(cuts)).toEqual(serverDensify(cuts));
  });

  it("원본 필드 보존 parity", () => {
    const cuts = [{
      cutNumber: 1,
      durationSec: 15,
      sceneDescription: "테스트",
      subjectAction: "walks",
      videoPrompt: "prompt text",
      shotCategory: "character-driven",
    }];
    expect(densifyCuts(cuts)).toEqual(serverDensify(cuts));
  });

  it("groupId passthrough (있으면 유지, 없으면 미생성) parity", () => {
    const cutsWithGroupId = [{
      cutNumber: 1,
      durationSec: 15,
      groupId: "existing-group",
    }];
    const clientResult = densifyCuts(cutsWithGroupId);
    const serverResult = serverDensify(cutsWithGroupId);
    expect(clientResult).toEqual(serverResult);
    // groupId가 passthrough 되었는지 확인
    for (const c of clientResult) {
      expect((c as Record<string, unknown>).groupId).toBe("existing-group");
    }

    const cutsWithout = [{ cutNumber: 1, durationSec: 15 }];
    const clientResult2 = densifyCuts(cutsWithout);
    const serverResult2 = serverDensify(cutsWithout);
    expect(clientResult2).toEqual(serverResult2);
    for (const c of clientResult2) {
      expect((c as Record<string, unknown>).groupId).toBeUndefined();
    }
  });

  it("멱등성 — densify 재적용 시 결과 동일 parity", () => {
    const cuts = [{ cutNumber: 1, durationSec: 15 }];
    const first = densifyCuts(cuts);
    const second = densifyCuts(first);
    const serverFirst = serverDensify(cuts);
    const serverSecond = serverDensify(serverFirst);
    expect(first).toEqual(serverFirst);
    expect(second).toEqual(serverSecond);
    expect(second).toEqual(first); // 멱등성
  });

  it("empty array parity", () => {
    expect(densifyCuts([])).toEqual(serverDensify([]));
  });
});
