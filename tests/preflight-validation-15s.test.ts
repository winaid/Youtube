/**
 * preflight-validation-15s.test.ts — shortform band 규칙 검증
 *
 * 확정 규칙 (2026-03):
 *   ≤5초: micro (1컷)
 *   6~9초: short (최소 3컷)
 *   10~15초: shortform-critical (4~6컷 필수)
 *   16초+: 생성 불가
 *
 * 테스트 범위:
 * - band rule (밴드별 규칙 매핑)
 * - 6~9초 band: 컷 수 검증
 * - 10~15초 band: 컷 수 + 총 길이 검증
 * - 16초+: 생성 불가
 * - 복합 에러 동시 표시
 * - display title / subInfo
 * - 에러 메시지 품질
 * - 프론트/서버 정책 일치 검증
 */

import { describe, it, expect } from "vitest";
import {
  runPreflightValidation,
  getSequenceBandRule,
  getCutDisplayTitle,
  getCutSubInfo,
  type PreflightInput,
  type PreflightIssue,
  type SequenceBandRule,
} from "../src/lib/preflight-validation";
import type { Cut, MultiShotPrompt } from "../src/types";
import { VEO_DEFAULT_MODEL } from "../src/lib/veo-capability";

// ═══════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════

function makeCut(overrides: Partial<Cut> & { cutNumber: number; durationSec: number }): Cut {
  return {
    sceneDescription: "",
    cameraDirection: "",
    moodLighting: "",
    imagePrompt: "",
    endImagePrompt: "",
    videoPrompt: "test video prompt for this scene",
    extendPrompt: "",
    transitionHint: "",
    characterConsistency: "",
    charactersInScene: [],
    ...overrides,
  };
}

function makeInput(cuts: Cut[], durations?: Map<number, number>): PreflightInput {
  return {
    cuts,
    canonicalMultiShots: new Map(),
    canonicalDurations: durations ?? new Map(cuts.map(c => [c.cutNumber, c.durationSec])),
    styleId: "cinematic-realism",
    modelId: VEO_DEFAULT_MODEL,
  };
}

function getIssuesByCode(issues: PreflightIssue[], code: string): PreflightIssue[] {
  return issues.filter(i => i.code === code);
}

/** N개 컷, 총 totalDur초가 되도록 생성 */
function makeCutsWithTotal(cutCount: number, totalDur: number): { cuts: Cut[]; durations: Map<number, number> } {
  const perCut = Math.floor(totalDur / cutCount);
  const remainder = totalDur - perCut * cutCount;
  const cuts: Cut[] = [];
  const durations = new Map<number, number>();
  for (let i = 0; i < cutCount; i++) {
    const dur = perCut + (i < remainder ? 1 : 0);
    cuts.push(makeCut({ cutNumber: i + 1, durationSec: dur }));
    durations.set(i + 1, dur);
  }
  return { cuts, durations };
}

// ═══════════════════════════════════════════════════════════════════
// 1. getSequenceBandRule — 밴드 규칙 매핑
// ═══════════════════════════════════════════════════════════════════

describe("getSequenceBandRule", () => {
  it("5초 이하 → micro (1~2컷)", () => {
    const rule = getSequenceBandRule(5);
    expect(rule.band).toBe("micro");
    expect(rule.minCuts).toBe(1);
    expect(rule.maxCuts).toBe(2);
    expect(rule.supported).toBe(true);
  });

  it("6초 → short (최소 3컷)", () => {
    const rule = getSequenceBandRule(6);
    expect(rule.band).toBe("short");
    expect(rule.minCuts).toBe(3);
    expect(rule.supported).toBe(true);
  });

  it("9초 → short (최소 3컷)", () => {
    const rule = getSequenceBandRule(9);
    expect(rule.band).toBe("short");
    expect(rule.minCuts).toBe(3);
  });

  it("10초 → shortform-critical (4~6컷)", () => {
    const rule = getSequenceBandRule(10);
    expect(rule.band).toBe("shortform-critical");
    expect(rule.minCuts).toBe(4);
    expect(rule.maxCuts).toBe(6);
    expect(rule.supported).toBe(true);
  });

  it("12초 → shortform-critical (4~6컷)", () => {
    const rule = getSequenceBandRule(12);
    expect(rule.band).toBe("shortform-critical");
    expect(rule.minCuts).toBe(4);
  });

  it("15초 → shortform-critical (4~6컷)", () => {
    const rule = getSequenceBandRule(15);
    expect(rule.band).toBe("shortform-critical");
    expect(rule.minCuts).toBe(4);
    expect(rule.maxCuts).toBe(6);
  });

  it("16초 → over-limit (생성 불가)", () => {
    const rule = getSequenceBandRule(16);
    expect(rule.band).toBe("over-limit");
    expect(rule.supported).toBe(false);
  });

  it("30초 → over-limit (생성 불가)", () => {
    const rule = getSequenceBandRule(30);
    expect(rule.band).toBe("over-limit");
    expect(rule.supported).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. 6~9초 band: 최소 3컷 규칙
// ═══════════════════════════════════════════════════════════════════

describe("6~9초 band: 최소 3컷", () => {
  it("6초 + 2컷 → 실패 (cut_count_too_low)", () => {
    const { cuts, durations } = makeCutsWithTotal(2, 6);
    const result = runPreflightValidation(makeInput(cuts, durations));
    expect(result.canGenerate).toBe(false);
    const lowCut = getIssuesByCode(result.issues, "cut_count_too_low");
    expect(lowCut.length).toBe(1);
    expect(lowCut[0].messageKo).toContain("최소 3개 시퀀스");
    expect(lowCut[0].messageKo).toContain("2개");
  });

  it("6초 + 3컷 → 통과", () => {
    const { cuts, durations } = makeCutsWithTotal(3, 6);
    const result = runPreflightValidation(makeInput(cuts, durations));
    const lowCut = getIssuesByCode(result.issues, "cut_count_too_low");
    expect(lowCut.length).toBe(0);
  });

  it("9초 + 3컷 → 통과", () => {
    const { cuts, durations } = makeCutsWithTotal(3, 9);
    const result = runPreflightValidation(makeInput(cuts, durations));
    const lowCut = getIssuesByCode(result.issues, "cut_count_too_low");
    expect(lowCut.length).toBe(0);
  });

  it("9초 + 2컷 → 실패 (cut_count_too_low)", () => {
    const { cuts, durations } = makeCutsWithTotal(2, 9);
    const result = runPreflightValidation(makeInput(cuts, durations));
    const lowCut = getIssuesByCode(result.issues, "cut_count_too_low");
    expect(lowCut.length).toBe(1);
  });

  it("8초 + 단일 컷 → 실패 (cut_count_too_low)", () => {
    const cuts = [makeCut({ cutNumber: 1, durationSec: 8 })];
    const result = runPreflightValidation(makeInput(cuts));
    const lowCut = getIssuesByCode(result.issues, "cut_count_too_low");
    expect(lowCut.length).toBe(1);
    expect(lowCut[0].messageKo).toContain("6~9초");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. 10~15초 band: 4~6컷 필수
// ═══════════════════════════════════════════════════════════════════

describe("10~15초 band: 4~6컷 필수", () => {
  it("10초 + 3컷 → 실패 (cut_count_too_low)", () => {
    const { cuts, durations } = makeCutsWithTotal(3, 10);
    const result = runPreflightValidation(makeInput(cuts, durations));
    expect(result.canGenerate).toBe(false);
    const lowCut = getIssuesByCode(result.issues, "cut_count_too_low");
    expect(lowCut.length).toBe(1);
    expect(lowCut[0].messageKo).toContain("4~6개 시퀀스");
    expect(lowCut[0].messageKo).toContain("3개");
  });

  it("10초 + 4컷 → 통과", () => {
    const { cuts, durations } = makeCutsWithTotal(4, 10);
    const result = runPreflightValidation(makeInput(cuts, durations));
    const cutIssues = result.issues.filter(i => i.code === "cut_count_too_low" || i.code === "cut_count_too_high");
    expect(cutIssues.length).toBe(0);
  });

  it("12초 + 4컷 → 통과", () => {
    const { cuts, durations } = makeCutsWithTotal(4, 12);
    const result = runPreflightValidation(makeInput(cuts, durations));
    const cutIssues = result.issues.filter(i => i.code === "cut_count_too_low" || i.code === "cut_count_too_high");
    expect(cutIssues.length).toBe(0);
  });

  it("15초 + 6컷 → 통과", () => {
    const { cuts, durations } = makeCutsWithTotal(6, 15);
    const result = runPreflightValidation(makeInput(cuts, durations));
    const cutIssues = result.issues.filter(i => i.code === "cut_count_too_low" || i.code === "cut_count_too_high");
    expect(cutIssues.length).toBe(0);
  });

  it("15초 + 7컷 → 실패 (cut_count_too_high)", () => {
    const { cuts, durations } = makeCutsWithTotal(7, 14); // 14초 → shortform-critical
    const result = runPreflightValidation(makeInput(cuts, durations));
    const highCut = getIssuesByCode(result.issues, "cut_count_too_high");
    expect(highCut.length).toBe(1);
    expect(highCut[0].severity).toBe("blocking");
    expect(highCut[0].messageKo).toContain("7개");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. 16초+ → 생성 불가
// ═══════════════════════════════════════════════════════════════════

describe("16초+: 개별 컷 duration 초과", () => {
  it("개별 컷 16초 → cut_duration_too_long (VEO 8초 상한)", () => {
    const cuts = [makeCut({ cutNumber: 1, durationSec: 16 })];
    const durations = new Map([[1, 16]]);
    const result = runPreflightValidation(makeInput(cuts, durations));
    expect(result.canGenerate).toBe(false);
    const tooLong = getIssuesByCode(result.issues, "cut_duration_too_long");
    expect(tooLong.length).toBe(1);
    expect(tooLong[0].messageKo).toContain("15초");
  });

  it("총 런타임 > 15초라도 개별 컷이 15초 이내면 band 에러 없음 (multi-segment)", () => {
    // 10컷 × 13초 = 130초 — multi-segment 콘텐츠, 각 컷은 15초 이내
    const { cuts, durations } = makeCutsWithTotal(10, 130);
    const result = runPreflightValidation(makeInput(cuts, durations));
    const bandIssues = getIssuesByCode(result.issues, "duration_band_not_supported");
    expect(bandIssues.length).toBe(0);
  });

  it("multi-segment에서 일부 컷만 16초 → 해당 컷만 cut_duration_too_long", () => {
    const cuts = [
      makeCut({ cutNumber: 1, durationSec: 16 }),
      makeCut({ cutNumber: 2, durationSec: 15 }),
      makeCut({ cutNumber: 3, durationSec: 14 }),
    ];
    const durations = new Map([[1, 16], [2, 15], [3, 14]]);
    const result = runPreflightValidation(makeInput(cuts, durations));
    const tooLong = getIssuesByCode(result.issues, "cut_duration_too_long");
    expect(tooLong.length).toBe(1);
    expect(tooLong[0].cutNumber).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. 복합 에러 동시 표시
// ═══════════════════════════════════════════════════════════════════

describe("복합 에러", () => {
  it("12초 + 2컷(6초씩) → cut_count_too_low + invalid_duration_structure", () => {
    const cuts = [
      makeCut({ cutNumber: 1, durationSec: 6 }),
      makeCut({ cutNumber: 2, durationSec: 6 }),
    ];
    const result = runPreflightValidation(makeInput(cuts));
    expect(result.canGenerate).toBe(false);
    expect(getIssuesByCode(result.issues, "cut_count_too_low").length).toBe(1);
    expect(getIssuesByCode(result.issues, "invalid_duration_structure").length).toBe(2);
    expect(result.blockingCount).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. 프론트/서버 정책 일치 검증
// ═══════════════════════════════════════════════════════════════════

describe("프론트/서버 정책 일치", () => {
  // 서버 _shortform-rhythm.ts의 resolveShortformBandPolicy와
  // 프론트 getSequenceBandRule이 동일한 결과를 내는지 검증
  // (서버 함수를 직접 import할 수 없으므로 규칙 값을 하드코딩 비교)

  const expectedRules: { dur: number; band: string; minCuts: number; supported: boolean }[] = [
    { dur: 3, band: "micro", minCuts: 1, supported: true },
    { dur: 5, band: "micro", minCuts: 1, supported: true },
    { dur: 6, band: "short", minCuts: 3, supported: true },
    { dur: 9, band: "short", minCuts: 3, supported: true },
    { dur: 10, band: "shortform-critical", minCuts: 4, supported: true },
    { dur: 12, band: "shortform-critical", minCuts: 4, supported: true },
    { dur: 15, band: "shortform-critical", minCuts: 4, supported: true },
    { dur: 16, band: "over-limit", minCuts: 0, supported: false },
    { dur: 30, band: "over-limit", minCuts: 0, supported: false },
  ];

  for (const { dur, band, minCuts, supported } of expectedRules) {
    it(`${dur}초 → band=${band}, minCuts=${minCuts}, supported=${supported}`, () => {
      const rule = getSequenceBandRule(dur);
      expect(rule.band).toBe(band);
      expect(rule.minCuts).toBe(minCuts);
      expect(rule.supported).toBe(supported);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 7. 기존 회귀 없음
// ═══════════════════════════════════════════════════════════════════

describe("기존 검증 회귀", () => {
  it("빈 컷 → 실패 (no_cuts)", () => {
    const result = runPreflightValidation(makeInput([]));
    expect(result.canGenerate).toBe(false);
    expect(getIssuesByCode(result.issues, "no_cuts").length).toBe(1);
  });

  it("프롬프트 없는 컷 → 실패 (cut_no_prompt)", () => {
    const cuts = [makeCut({ cutNumber: 1, durationSec: 5, videoPrompt: "", sceneDescription: "" })];
    const result = runPreflightValidation(makeInput(cuts));
    expect(getIssuesByCode(result.issues, "cut_no_prompt").length).toBe(1);
  });

  it("5초 이하 단일 컷 → 컷 수 에러 없음 (micro band)", () => {
    const cuts = [makeCut({ cutNumber: 1, durationSec: 5 })];
    const result = runPreflightValidation(makeInput(cuts));
    const cutCountIssues = result.issues.filter(i =>
      i.code === "cut_count_too_low" || i.code === "cut_count_too_high"
    );
    expect(cutCountIssues.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Display title 테스트
// ═══════════════════════════════════════════════════════════════════

describe("getCutDisplayTitle", () => {
  it("sceneDescription 있으면 그것을 사용", () => {
    const cut = makeCut({ cutNumber: 1, durationSec: 5, sceneDescription: "붉은 광장에서 거대한 행진이 시작된다" });
    expect(getCutDisplayTitle(cut)).toContain("붉은 광장");
    expect(getCutDisplayTitle(cut)).not.toContain("장면 1");
  });

  it("sceneDescription 없고 videoPrompt 있으면 그것을 사용", () => {
    const cut = makeCut({ cutNumber: 1, durationSec: 5, sceneDescription: "", videoPrompt: "A lone figure walks through neon-lit rain" });
    expect(getCutDisplayTitle(cut)).toContain("A lone figure");
  });

  it("둘 다 없고 multiShot 있으면 첫 샷 사용", () => {
    const multiShot: MultiShotPrompt[] = [{ index: 1, prompt: "Wide shot of the ancient castle", duration: "5" }];
    const cut = makeCut({ cutNumber: 1, durationSec: 5, sceneDescription: "", videoPrompt: "" });
    expect(getCutDisplayTitle(cut, new Map([[1, multiShot]]))).toContain("Wide shot");
  });

  it("모든 소스 없으면 fallback '장면 N'", () => {
    const cut = makeCut({ cutNumber: 3, durationSec: 5, sceneDescription: "", videoPrompt: "" });
    expect(getCutDisplayTitle(cut)).toBe("장면 3");
  });

  it("긴 제목은 truncate", () => {
    const cut = makeCut({ cutNumber: 1, durationSec: 5, sceneDescription: "아주 긴 장면 설명입니다 이것은 매우 길게 작성된 설명으로 한 줄에 다 들어가지 않습니다" });
    expect(getCutDisplayTitle(cut).length).toBeLessThanOrEqual(30);
  });

  it("첫 문장만 추출", () => {
    const cut = makeCut({ cutNumber: 1, durationSec: 5, sceneDescription: "비 오는 골목. 남자가 우산을 편다." });
    expect(getCutDisplayTitle(cut)).toBe("비 오는 골목");
  });
});

describe("getCutSubInfo", () => {
  it("기본: 시퀀스 N · 1샷 · N초", () => {
    expect(getCutSubInfo(makeCut({ cutNumber: 2, durationSec: 5 }))).toBe("시퀀스 2 · 1샷 · 5초");
  });

  it("멀티샷이면 샷 수 표시", () => {
    const ms: MultiShotPrompt[] = [{ index: 1, prompt: "a", duration: "3" }, { index: 2, prompt: "b", duration: "2" }];
    expect(getCutSubInfo(makeCut({ cutNumber: 1, durationSec: 5 }), new Map([[1, ms]]))).toBe("시퀀스 1 · 2샷 · 5초");
  });

  it("원테이크면 원테이크 표시", () => {
    expect(getCutSubInfo(makeCut({ cutNumber: 1, durationSec: 8, intentionalOneTake: true }))).toBe("시퀀스 1 · 원테이크 · 8초");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. 에러 메시지 품질
// ═══════════════════════════════════════════════════════════════════

describe("에러 메시지 품질", () => {
  it("6~9초 최소 3컷 메시지", () => {
    const { cuts, durations } = makeCutsWithTotal(2, 7);
    const result = runPreflightValidation(makeInput(cuts, durations));
    const issue = getIssuesByCode(result.issues, "cut_count_too_low")[0];
    expect(issue.messageKo).toContain("6~9초");
    expect(issue.messageKo).toContain("최소 3개 시퀀스");
  });

  it("10~15초 4~6개 시퀀스 메시지", () => {
    const { cuts, durations } = makeCutsWithTotal(3, 12);
    const result = runPreflightValidation(makeInput(cuts, durations));
    const issue = getIssuesByCode(result.issues, "cut_count_too_low")[0];
    expect(issue.messageKo).toContain("10~15초");
    expect(issue.messageKo).toContain("4~6개 시퀀스");
  });

  it("개별 컷 16초 → cut_duration_too_long 메시지", () => {
    const cuts = [makeCut({ cutNumber: 1, durationSec: 16 })];
    const durations = new Map([[1, 16]]);
    const result = runPreflightValidation(makeInput(cuts, durations));
    const issue = getIssuesByCode(result.issues, "cut_duration_too_long")[0];
    expect(issue.messageKo).toContain("15초");
    expect(issue.messageKo).toContain("초과");
  });

  it("cut_count_too_high 메시지에 '줄여' 포함", () => {
    const { cuts, durations } = makeCutsWithTotal(7, 14);
    const result = runPreflightValidation(makeInput(cuts, durations));
    const issue = getIssuesByCode(result.issues, "cut_count_too_high")[0];
    expect(issue.messageKo).toContain("줄여");
  });

  it("invalid_duration_structure 메시지에 컷당 최대 초", () => {
    const cuts = [
      makeCut({ cutNumber: 1, durationSec: 5 }),
      makeCut({ cutNumber: 2, durationSec: 3 }),
      makeCut({ cutNumber: 3, durationSec: 3 }),
      makeCut({ cutNumber: 4, durationSec: 3 }),
    ];
    const durations = new Map([[1, 5], [2, 3], [3, 3], [4, 3]]); // 총 14초
    const result = runPreflightValidation(makeInput(cuts, durations));
    const structIssues = getIssuesByCode(result.issues, "invalid_duration_structure");
    expect(structIssues.length).toBe(1);
    expect(structIssues[0].messageKo).toContain("시퀀스당 최대 4초");
  });
});
