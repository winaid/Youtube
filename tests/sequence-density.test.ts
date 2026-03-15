/**
 * sequence-density.test.ts — 숏폼 리텐션 친화적 컷 밀도 보정 테스트
 *
 * 정책 (DENSITY_POLICY):
 *   3–5s:  min 1 cut
 *   6–8s:  min 2 cuts
 *   9–12s: min 3 cuts
 *   13–15s: min 4 cuts
 *
 * 테스트 범주:
 * 1. recommendMinimumCutCount 정책 숫자
 * 2. needsDensityBoost 판정
 * 3-7. densifyCuts — duration별 분할 동작
 * 8. scene-like/sequence-like 우선 분할
 * 9. 원본 필드 보존
 * 10. groupId 자동 생성 안 됨
 * 11. densify 후 classify 결합
 * 12. Edge cases
 * 13. Client ↔ Server parity
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
  it("should return 1 for 0-5 seconds", () => {
    expect(recommendMinimumCutCount(3)).toBe(1);
    expect(recommendMinimumCutCount(4)).toBe(1);
    expect(recommendMinimumCutCount(5)).toBe(1);
  });

  it("should return 2 for 6-8 seconds (숏폼 리텐션)", () => {
    expect(recommendMinimumCutCount(6)).toBe(2);
    expect(recommendMinimumCutCount(7)).toBe(2);
    expect(recommendMinimumCutCount(8)).toBe(2);
  });

  it("should return 3 for 9-12 seconds (숏폼 리텐션)", () => {
    expect(recommendMinimumCutCount(9)).toBe(3);
    expect(recommendMinimumCutCount(10)).toBe(3);
    expect(recommendMinimumCutCount(12)).toBe(3);
  });

  it("should return 4 for 13-15 seconds (숏폼 리텐션)", () => {
    expect(recommendMinimumCutCount(13)).toBe(4);
    expect(recommendMinimumCutCount(15)).toBe(4);
  });

  it("should return segment-aware minimum for > 15 seconds", () => {
    // 20s = 1 full segment of 15s (min 4) + 5s remainder (min 1) = 5
    expect(recommendMinimumCutCount(20)).toBe(5);
    // 30s = floor(30/15)=2, remainder=0 → 4*2 = 8
    expect(recommendMinimumCutCount(30)).toBe(8);
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
  it("should return true for 15s single cut (1 cut < minimum 4)", () => {
    expect(needsDensityBoost([{ durationSec: 15 }])).toBe(true);
  });

  it("should return true for 12s single cut (1 cut < minimum 3)", () => {
    expect(needsDensityBoost([{ durationSec: 12 }])).toBe(true);
  });

  it("should return true for 8s single cut (1 cut < minimum 2)", () => {
    expect(needsDensityBoost([{ durationSec: 8 }])).toBe(true);
  });

  it("should return false for 4s single cut (1 cut ≥ minimum 1)", () => {
    expect(needsDensityBoost([{ durationSec: 4 }])).toBe(false);
  });

  it("should return true for 15s with 3 cuts (3 < minimum 4)", () => {
    expect(needsDensityBoost([
      { durationSec: 5 },
      { durationSec: 5 },
      { durationSec: 5 },
    ])).toBe(true);
  });

  it("should return false for 15s with 5 cuts (5 ≥ minimum 4)", () => {
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
// 3. densifyCuts — 15초/1컷 → 분할 (min=4)
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — 15s single cut", () => {
  it("should split 15s single cut into 4 cuts (min=4)", () => {
    const cuts = [{ cutNumber: 1, durationSec: 15, sceneDescription: "테스트 장면" }];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(4);
    const total = result.reduce((s, c) => s + c.durationSec, 0);
    expect(total).toBe(15);
  });

  it("should preserve original text fields in first split cut", () => {
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
    // 분할 후 첫 컷에는 원본 필드 보존
    expect(result[0].sceneDescription).toBe("원본 장면 설명");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. densifyCuts — 12초/1컷 → 분할 (min=3)
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — 12s single cut", () => {
  it("should split 12s single cut into 3 cuts (min=3)", () => {
    const cuts = [{ cutNumber: 1, durationSec: 12 }];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(3);
    const total = result.reduce((s, c) => s + c.durationSec, 0);
    expect(total).toBe(12);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. densifyCuts — 8초/1컷 → 분할 (min=2)
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — 8s single cut", () => {
  it("should split 8s single cut into 2 cuts (min=2)", () => {
    const cuts = [{ cutNumber: 1, durationSec: 8 }];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(2);
    const total = result.reduce((s, c) => s + c.durationSec, 0);
    expect(total).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. densifyCuts — 4초/1컷 → 그대로 유지 (min=1)
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — 4s single cut", () => {
  it("should NOT split 4s single cut (min=1)", () => {
    const cuts = [{ cutNumber: 1, durationSec: 4 }];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(1);
    expect(result[0].durationSec).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. densifyCuts — 이미 충분한 컷 수
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — already sufficient cuts", () => {
  it("should NOT split 15s with 5 cuts (5 ≥ min=4)", () => {
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

  it("should NOT split 15s with 4 cuts (4 ≥ min=4)", () => {
    const cuts = [
      { cutNumber: 1, durationSec: 4 },
      { cutNumber: 2, durationSec: 4 },
      { cutNumber: 3, durationSec: 4 },
      { cutNumber: 4, durationSec: 3 },
    ];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. 분할 시 긴 컷 우선 분할
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — splitting prefers longest cuts", () => {
  it("should split 10s total with 2 cuts into 3 (min=3) — splits longer cut", () => {
    const cuts = [
      { cutNumber: 1, durationSec: 3 },
      { cutNumber: 2, durationSec: 7, durationClass: "sequence-like" as const },
    ];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(3);
    const total = result.reduce((s, c) => s + c.durationSec, 0);
    expect(total).toBe(10);
  });

  it("should split 11s total with 2 cuts into 3 (min=3) — splits scene-like first", () => {
    const cuts = [
      { cutNumber: 1, durationSec: 3, durationClass: "cut-like" as const },
      { cutNumber: 2, durationSec: 8, durationClass: "scene-like" as const },
    ];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(3);
    const total = result.reduce((s, c) => s + c.durationSec, 0);
    expect(total).toBe(11);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. 원본 필드 보존 (분할 시)
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — field preservation", () => {
  it("should preserve subjectAction, shotCategory, characterRole in split", () => {
    const cuts = [{
      cutNumber: 1,
      durationSec: 10,
      subjectAction: "walks forward",
      shotCategory: "character-driven",
      characterRole: "protagonist",
      videoPromptJson: { shotSize: "MS" },
    }];
    const result = densifyCuts(cuts);
    // 10초 → min=3, 분할 발생
    expect(result.length).toBe(3);
    // 첫 컷에 원본 필드 보존
    expect(result[0].subjectAction).toBe("walks forward");
    expect(result[0].shotCategory).toBe("character-driven");
  });

  it("should preserve cutNumber sequence after split", () => {
    const cuts = [{ cutNumber: 1, durationSec: 15 }];
    const result = densifyCuts(cuts);
    result.forEach((c, i) => {
      expect(c.cutNumber).toBe(i + 1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. groupId 자동 생성 안 됨
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts — no groupId generation", () => {
  it("should NOT add groupId in split cuts", () => {
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
  it("should produce classified cuts with structureType and durationClass after pipeline", () => {
    const cuts = [{ cutNumber: 1, durationSec: 15 }];
    const densified = densifyCuts(cuts);
    const classified = classifyCuts(densified);

    expect(classified.length).toBeGreaterThanOrEqual(4);
    for (const cut of classified) {
      expect(cut.structureType).toBeDefined();
      expect(cut.durationClass).toBeDefined();
    }
  });

  it("should classify split 12s cuts correctly", () => {
    const cuts = [{ cutNumber: 1, durationSec: 12 }];
    const densified = densifyCuts(cuts);
    const classified = classifyCuts(densified);

    expect(classified.length).toBe(3);
    const total = classified.reduce((s, c) => s + c.durationSec, 0);
    expect(total).toBe(12);
    for (const cut of classified) {
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

  it("should handle very short cut (2s) with 6s total (min=2, already 2 cuts)", () => {
    const cuts = [{ cutNumber: 1, durationSec: 2 }, { cutNumber: 2, durationSec: 4 }];
    const result = densifyCuts(cuts);
    // 총 6초, min=2, 이미 2컷이므로 분할 불필요
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
  const durations = [3, 5, 7, 8, 10, 12, 15, 20, 30];
  for (const d of durations) {
    it(`should match for ${d}s`, () => {
      expect(recommendMinimumCutCount(d)).toBe(serverRecommend(d));
    });
  }
});

describe("client ↔ server parity — needsDensityBoost", () => {
  const cases = [
    [{ durationSec: 15 }],
    [{ durationSec: 12 }],
    [{ durationSec: 4 }],
    [{ durationSec: 3 }, { durationSec: 3 }, { durationSec: 3 }, { durationSec: 3 }, { durationSec: 3 }],
  ];
  for (const c of cases) {
    const totalDur = c.reduce((s, x) => s + x.durationSec, 0);
    it(`should match for ${totalDur}s / ${c.length} cuts`, () => {
      expect(needsDensityBoost(c)).toBe(serverNeedsBoost(c));
    });
  }
});

describe("client ↔ server parity — densifyCuts", () => {
  const cases = [
    [{ cutNumber: 1, durationSec: 15 }],
    [{ cutNumber: 1, durationSec: 12 }],
    [{ cutNumber: 1, durationSec: 4 }],
  ];
  for (const c of cases) {
    it(`should produce same count for ${c[0].durationSec}s`, () => {
      const clientResult = densifyCuts(c);
      const serverResult = serverDensify(c);
      expect(clientResult.length).toBe(serverResult.length);
    });
  }
});
