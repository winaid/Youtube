/**
 * session-analysis.test.ts — 세션 로그 분석 함수 검증
 *
 * - buildOwnerSummary 정확성
 * - deriveActionItems 우선순위 로직
 * - tagsByDurationBand / tagsByDirector 교차 분석
 * - FAILURE_INTERPRETATIONS 완전성
 */

import { describe, it, expect } from "vitest";
import {
  type FailureTag,
  type SessionLogEntry,
  FAILURE_TAG_LABELS,
  FAILURE_INTERPRETATIONS,
  sessionLogStats,
  buildOwnerSummary,
  deriveActionItems,
  tagsByDurationBand,
  tagsByDirector,
} from "@/lib/draft-store";

// ─── Test data factory ───

function entry(overrides: Partial<SessionLogEntry> = {}): SessionLogEntry {
  return {
    draftId: "d-test",
    scenario: "test scenario",
    failureTags: ["ok"],
    fallbackUsed: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// FAILURE_INTERPRETATIONS 완전성
// ═══════════════════════════════════════════════════════════════════

describe("FAILURE_INTERPRETATIONS completeness", () => {
  it("모든 FailureTag에 대해 interpretation이 있어야 함", () => {
    const allTags = Object.keys(FAILURE_TAG_LABELS) as FailureTag[];
    for (const tag of allTags) {
      expect(FAILURE_INTERPRETATIONS[tag]).toBeDefined();
      expect(FAILURE_INTERPRETATIONS[tag].suspect.length).toBeGreaterThan(0);
      expect(FAILURE_INTERPRETATIONS[tag].action.length).toBeGreaterThan(0);
    }
  });

  it("interpretation의 suspect/action 둘 다 비어있지 않아야 함", () => {
    for (const [tag, interp] of Object.entries(FAILURE_INTERPRETATIONS)) {
      expect(interp.suspect, `${tag} suspect`).toBeTruthy();
      expect(interp.action, `${tag} action`).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildOwnerSummary
// ═══════════════════════════════════════════════════════════════════

describe("buildOwnerSummary", () => {
  it("빈 로그 → 기본 summary", () => {
    const s = buildOwnerSummary([]);
    expect(s.totalSessions).toBe(0);
    expect(s.topFailure).toBeNull();
    expect(s.worstBand).toBeNull();
  });

  it("전부 ok → failCount=0, topFailure=null", () => {
    const log = [entry(), entry(), entry()];
    const s = buildOwnerSummary(log);
    expect(s.totalSessions).toBe(3);
    expect(s.okCount).toBe(3);
    expect(s.failCount).toBe(0);
    expect(s.topFailure).toBeNull();
  });

  it("too-slow 3회 + too-sparse 1회 → topFailure=too-slow", () => {
    const log = [
      entry({ failureTags: ["too-slow"] }),
      entry({ failureTags: ["too-slow"] }),
      entry({ failureTags: ["too-slow", "too-sparse"] }),
      entry({ failureTags: ["ok"] }),
    ];
    const s = buildOwnerSummary(log);
    expect(s.topFailure?.tag).toBe("too-slow");
    expect(s.topFailure?.count).toBe(3);
    expect(s.secondFailure?.tag).toBe("too-sparse");
    expect(s.secondFailure?.count).toBe(1);
  });

  it("fallback rate 계산", () => {
    const log = [
      entry({ fallbackUsed: true }),
      entry({ fallbackUsed: true }),
      entry({ fallbackUsed: false }),
      entry({ fallbackUsed: false }),
    ];
    const s = buildOwnerSummary(log);
    expect(s.fallbackRate).toBe(0.5);
  });

  it("directorPaceDownWeighted rate 계산", () => {
    const log = [
      entry({ directorPaceDownWeighted: true }),
      entry({ directorPaceDownWeighted: true }),
      entry({ directorPaceDownWeighted: false }),
    ];
    const s = buildOwnerSummary(log);
    expect(s.downWeightRate).toBeCloseTo(2 / 3);
  });

  it("critical band (shortform-critical) 실패 집계", () => {
    const log = [
      entry({ durationBand: "shortform-critical", failureTags: ["too-slow"] }),
      entry({ durationBand: "shortform-critical", failureTags: ["ok"] }),
      entry({ durationBand: "shortform-base", failureTags: ["too-slow"] }),
    ];
    const s = buildOwnerSummary(log);
    expect(s.criticalBandFailCount).toBe(1);
  });

  it("worstBand 식별", () => {
    const log = [
      entry({ durationBand: "shortform-critical", failureTags: ["too-slow"] }),
      entry({ durationBand: "shortform-critical", failureTags: ["too-sparse"] }),
      entry({ durationBand: "standard", failureTags: ["too-generic"] }),
    ];
    const s = buildOwnerSummary(log);
    expect(s.worstBand?.band).toBe("shortform-critical");
    expect(s.worstBand?.failCount).toBe(2);
  });

  it("worstDirectorStyle 식별", () => {
    const log = [
      entry({ directorRequested: "wong-kar-wai", failureTags: ["style-too-weak"] }),
      entry({ directorRequested: "wong-kar-wai", failureTags: ["style-overrides-rhythm"] }),
      entry({ directorRequested: "nolan", failureTags: ["too-slow"] }),
    ];
    const s = buildOwnerSummary(log);
    expect(s.worstDirectorStyle?.director).toBe("wong-kar-wai");
    expect(s.worstDirectorStyle?.count).toBe(2);
  });

  it("recentFixGuesses 추출 (최대 5개)", () => {
    const log = Array.from({ length: 8 }, (_, i) =>
      entry({ nextFixGuess: `fix-${i}`, timestamp: Date.now() - i * 1000 })
    );
    const s = buildOwnerSummary(log);
    expect(s.recentFixGuesses.length).toBeLessThanOrEqual(5);
    expect(s.recentFixGuesses[0]).toBe("fix-0");
  });

  it("save-reopen-confusion count", () => {
    const log = [
      entry({ failureTags: ["save-reopen-confusion"] }),
      entry({ failureTags: ["save-reopen-confusion", "too-generic"] }),
      entry({ failureTags: ["ok"] }),
    ];
    const s = buildOwnerSummary(log);
    expect(s.saveConfusionCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// deriveActionItems
// ═══════════════════════════════════════════════════════════════════

describe("deriveActionItems", () => {
  it("빈 summary → 안내 메시지", () => {
    const items = deriveActionItems(buildOwnerSummary([]));
    expect(items.length).toBe(1);
    expect(items[0]).toContain("세션 데이터가 없습니다");
  });

  it("topFailure → [P0] 액션 아이템", () => {
    const log = [
      entry({ failureTags: ["too-slow"] }),
      entry({ failureTags: ["too-slow"] }),
      entry({ failureTags: ["too-slow"] }),
    ];
    const items = deriveActionItems(buildOwnerSummary(log));
    expect(items.some(i => i.startsWith("[P0]") && i.includes("느림"))).toBe(true);
  });

  it("critical band 실패 → [P0] shortform 점검", () => {
    const log = [
      entry({ durationBand: "shortform-critical", failureTags: ["too-slow"] }),
    ];
    const items = deriveActionItems(buildOwnerSummary(log));
    expect(items.some(i => i.includes("13-15초 critical band"))).toBe(true);
  });

  it("높은 fallback rate → [P0] API 점검", () => {
    const log = Array.from({ length: 5 }, () => entry({ fallbackUsed: true, failureTags: ["fallback-degraded"] }));
    const items = deriveActionItems(buildOwnerSummary(log));
    expect(items.some(i => i.includes("Fallback 비율") && i.includes("[P0]"))).toBe(true);
  });

  it("전부 ok → 다음 단계 이동 메시지", () => {
    const log = [entry(), entry(), entry()];
    const items = deriveActionItems(buildOwnerSummary(log));
    expect(items.some(i => i.includes("다음 단계로 이동"))).toBe(true);
  });

  it("director style 문제 → [P1] persona 보강", () => {
    const log = [
      entry({ directorRequested: "wong-kar-wai", failureTags: ["style-too-weak"] }),
      entry({ directorRequested: "wong-kar-wai", failureTags: ["style-too-weak"] }),
    ];
    const items = deriveActionItems(buildOwnerSummary(log));
    expect(items.some(i => i.includes("wong-kar-wai") && i.includes("[P1]"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// tagsByDurationBand
// ═══════════════════════════════════════════════════════════════════

describe("tagsByDurationBand", () => {
  it("빈 로그 → 빈 결과", () => {
    expect(Object.keys(tagsByDurationBand([])).length).toBe(0);
  });

  it("밴드별 정확한 카운트", () => {
    const log = [
      entry({ durationBand: "shortform-critical", failureTags: ["too-slow"] }),
      entry({ durationBand: "shortform-critical", failureTags: ["too-slow", "too-sparse"] }),
      entry({ durationBand: "standard", failureTags: ["ok"] }),
    ];
    const result = tagsByDurationBand(log);
    expect(result["shortform-critical"]["too-slow"]).toBe(2);
    expect(result["shortform-critical"]["too-sparse"]).toBe(1);
    expect(result["standard"]["ok"]).toBe(1);
  });

  it("durationBand 없는 항목 → unknown 그룹", () => {
    const log = [entry({ failureTags: ["too-generic"] })];
    const result = tagsByDurationBand(log);
    expect(result["unknown"]["too-generic"]).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// tagsByDirector
// ═══════════════════════════════════════════════════════════════════

describe("tagsByDirector", () => {
  it("감독별 스타일 문제 분류", () => {
    const log = [
      entry({ directorRequested: "wong-kar-wai", failureTags: ["style-too-weak"] }),
      entry({ directorRequested: "nolan", failureTags: ["style-overrides-rhythm"] }),
      entry({ directorRequested: "wong-kar-wai", failureTags: ["ok"] }),
    ];
    const result = tagsByDirector(log);
    expect(result["wong-kar-wai"]["style-too-weak"]).toBe(1);
    expect(result["wong-kar-wai"]["ok"]).toBe(1);
    expect(result["nolan"]["style-overrides-rhythm"]).toBe(1);
  });
});
