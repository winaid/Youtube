/**
 * recommend-diagnostics.test.ts — 감독 추천 로깅/품질/진단 시스템 검증
 *
 * 테스트 범위:
 * - RecommendLogEntry 저장/로드
 * - classifyRecommendError 에러 분류
 * - buildRecommendSummary 통계
 * - deriveRecommendActions 진단 액션
 * - 서버 응답 후처리 (id validation, fitScore clamping, reason fallback)
 * - 빈결과 과도 발생 방지
 * - 추천 편향 감지
 */

import { describe, it, expect } from "vitest";
import {
  classifyRecommendError,
  buildRecommendSummary,
  deriveRecommendActions,
  type RecommendLogEntry,
  type RecommendLogSummary,
} from "@/lib/draft-store";

// ─── Test data factory ───

function logEntry(overrides: Partial<RecommendLogEntry> = {}): RecommendLogEntry {
  return {
    timestamp: Date.now(),
    storySnippet: "테스트 시나리오 텍스트입니다. 한강에서 벌어지는 이야기...",
    storyLength: 120,
    outcome: "success",
    localMatchCount: 2,
    webSuggestionCount: 1,
    localMatchIds: ["kr-bong", "kr-park"],
    webSuggestionIds: ["eu-tarr"],
    latencyMs: 2500,
    activeRegion: "한국",
    directorPoolSize: 30,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// classifyRecommendError
// ═══════════════════════════════════════════════════════════════════

describe("classifyRecommendError", () => {
  it("네트워크 에러 분류", () => {
    expect(classifyRecommendError("Failed to fetch")).toBe("network");
    expect(classifyRecommendError("NetworkError when attempting")).toBe("network");
  });

  it("API 키 에러 분류", () => {
    expect(classifyRecommendError("API_KEY invalid")).toBe("api-key");
    expect(classifyRecommendError("401: Unauthorized")).toBe("api-key");
    expect(classifyRecommendError("403: Forbidden")).toBe("api-key");
  });

  it("Rate limit 분류", () => {
    expect(classifyRecommendError("429: Rate limit exceeded")).toBe("rate-limit");
    expect(classifyRecommendError("RATE_LIMIT: quota exceeded")).toBe("rate-limit");
  });

  it("Parse 에러 분류", () => {
    expect(classifyRecommendError("JSON parse error")).toBe("parse-error");
  });

  it("Timeout 분류", () => {
    expect(classifyRecommendError("request timed out")).toBe("timeout");
    expect(classifyRecommendError("504: Gateway Timeout")).toBe("timeout");
  });

  it("미분류 에러 → unknown", () => {
    expect(classifyRecommendError("Something weird happened")).toBe("unknown");
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildRecommendSummary
// ═══════════════════════════════════════════════════════════════════

describe("buildRecommendSummary", () => {
  it("빈 로그 → 기본 summary", () => {
    const s = buildRecommendSummary([]);
    expect(s.total).toBe(0);
    expect(s.successCount).toBe(0);
    expect(s.topDirectorIds).toEqual([]);
  });

  it("성공/에러/빈결과/캐시 카운트 정확", () => {
    const log = [
      logEntry({ outcome: "success" }),
      logEntry({ outcome: "success" }),
      logEntry({ outcome: "error", errorCategory: "network" }),
      logEntry({ outcome: "empty", localMatchCount: 0, webSuggestionCount: 0 }),
      logEntry({ outcome: "cache-hit" }),
    ];
    const s = buildRecommendSummary(log);
    expect(s.total).toBe(5);
    expect(s.successCount).toBe(2);
    expect(s.errorCount).toBe(1);
    expect(s.emptyCount).toBe(1);
    expect(s.cacheHitCount).toBe(1);
  });

  it("평균 레이턴시 계산 (캐시 제외)", () => {
    const log = [
      logEntry({ outcome: "success", latencyMs: 2000 }),
      logEntry({ outcome: "success", latencyMs: 4000 }),
      logEntry({ outcome: "cache-hit", latencyMs: 5 }),
    ];
    const s = buildRecommendSummary(log);
    expect(s.avgLatencyMs).toBe(3000);
  });

  it("에러 카테고리 집계", () => {
    const log = [
      logEntry({ outcome: "error", errorCategory: "network" }),
      logEntry({ outcome: "error", errorCategory: "network" }),
      logEntry({ outcome: "error", errorCategory: "api-key" }),
    ];
    const s = buildRecommendSummary(log);
    expect(s.errorCategories["network"]).toBe(2);
    expect(s.errorCategories["api-key"]).toBe(1);
  });

  it("topDirectorIds 상위 5개", () => {
    const log = [
      logEntry({ localMatchIds: ["kr-bong", "kr-park"], webSuggestionIds: ["eu-tarr"] }),
      logEntry({ localMatchIds: ["kr-bong", "kr-park"], webSuggestionIds: ["eu-tarr"] }),
      logEntry({ localMatchIds: ["kr-bong"], webSuggestionIds: ["jp-kurosawa"] }),
    ];
    const s = buildRecommendSummary(log);
    expect(s.topDirectorIds[0].id).toBe("kr-bong");
    expect(s.topDirectorIds[0].count).toBe(3);
    expect(s.topDirectorIds[1].id).toBe("kr-park");
    expect(s.topDirectorIds[1].count).toBe(2);
  });

  it("빈결과 비율 계산", () => {
    const log = [
      logEntry({ outcome: "success" }),
      logEntry({ outcome: "empty" }),
      logEntry({ outcome: "empty" }),
      logEntry({ outcome: "error" }), // 에러는 제외
    ];
    const s = buildRecommendSummary(log);
    // apiCalls = success(1) + empty(2) = 3, emptyRate = 2/3
    expect(s.emptyRate).toBeCloseTo(2 / 3);
  });

  it("평균 매치 카운트", () => {
    const log = [
      logEntry({ outcome: "success", localMatchCount: 3, webSuggestionCount: 1 }),
      logEntry({ outcome: "success", localMatchCount: 2, webSuggestionCount: 2 }),
      logEntry({ outcome: "empty", localMatchCount: 0, webSuggestionCount: 0 }),
    ];
    const s = buildRecommendSummary(log);
    // success only: (3+1 + 2+2) / 2 = 4
    expect(s.avgMatchCount).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// deriveRecommendActions
// ═══════════════════════════════════════════════════════════════════

describe("deriveRecommendActions", () => {
  it("빈 로그 → 안내 메시지", () => {
    const items = deriveRecommendActions(buildRecommendSummary([]));
    expect(items.length).toBe(1);
    expect(items[0]).toContain("추천 로그 없음");
  });

  it("에러 많으면 에러 카테고리 표시", () => {
    const log = [
      logEntry({ outcome: "error", errorCategory: "network" }),
      logEntry({ outcome: "error", errorCategory: "network" }),
      logEntry({ outcome: "error", errorCategory: "api-key" }),
    ];
    const items = deriveRecommendActions(buildRecommendSummary(log));
    expect(items.some(i => i.includes("[에러]") && i.includes("network"))).toBe(true);
  });

  it("빈결과 비율 30% 초과 시 경고", () => {
    const log = [
      logEntry({ outcome: "success" }),
      logEntry({ outcome: "empty" }),
      logEntry({ outcome: "empty" }),
    ];
    const items = deriveRecommendActions(buildRecommendSummary(log));
    expect(items.some(i => i.includes("[빈결과]"))).toBe(true);
  });

  it("편향 감지: 같은 감독 60% 이상", () => {
    const log = Array.from({ length: 5 }, () =>
      logEntry({ outcome: "success", localMatchIds: ["kr-bong"], webSuggestionIds: [] })
    );
    const items = deriveRecommendActions(buildRecommendSummary(log));
    expect(items.some(i => i.includes("[편향]") && i.includes("kr-bong"))).toBe(true);
  });

  it("높은 레이턴시 경고", () => {
    const log = [
      logEntry({ outcome: "success", latencyMs: 10000 }),
      logEntry({ outcome: "success", latencyMs: 12000 }),
    ];
    const items = deriveRecommendActions(buildRecommendSummary(log));
    expect(items.some(i => i.includes("[지연]"))).toBe(true);
  });

  it("정상 시 성공 메시지", () => {
    const log = [
      logEntry({ outcome: "success", latencyMs: 2000 }),
      logEntry({ outcome: "success", latencyMs: 3000 }),
    ];
    const items = deriveRecommendActions(buildRecommendSummary(log));
    expect(items.some(i => i.includes("정상"))).toBe(true);
  });

  it("캐시 과다 시 경고", () => {
    const log = [
      ...Array.from({ length: 4 }, () => logEntry({ outcome: "cache-hit", latencyMs: 5 })),
      logEntry({ outcome: "success", latencyMs: 2000 }),
    ];
    const items = deriveRecommendActions(buildRecommendSummary(log));
    expect(items.some(i => i.includes("[캐시]"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Server-side quality enforcement (logic validation)
// ═══════════════════════════════════════════════════════════════════

describe("서버 후처리 검증 로직", () => {
  // These test the logic that the server applies (simulated here)

  function serverPostProcess(
    parsed: { localMatches: any[]; webSuggestions: any[] },
    validIds: Set<string>
  ) {
    // Filter hallucinated ids
    const localMatches = parsed.localMatches.filter((m: any) => validIds.has(m.id));
    const invalidCount = parsed.localMatches.length - localMatches.length;

    // Clamp fitScore
    for (const m of localMatches) {
      if (typeof m.fitScore === "number") m.fitScore = Math.max(0, Math.min(100, Math.round(m.fitScore)));
    }
    for (const s of parsed.webSuggestions) {
      if (typeof s.fitScore === "number") s.fitScore = Math.max(0, Math.min(100, Math.round(s.fitScore)));
    }

    // Ensure reason
    for (const m of localMatches) {
      if (!m.reason || typeof m.reason !== "string") m.reason = "(이유 미제공)";
    }

    return { localMatches, webSuggestions: parsed.webSuggestions, invalidCount };
  }

  it("환각 id 필터링", () => {
    const validIds = new Set(["kr-bong", "kr-park", "us-nolan"]);
    const parsed = {
      localMatches: [
        { id: "kr-bong", fitScore: 90, reason: "좋아요" },
        { id: "hallucinated-id", fitScore: 85, reason: "이상해요" },
      ],
      webSuggestions: [],
    };
    const result = serverPostProcess(parsed, validIds);
    expect(result.localMatches.length).toBe(1);
    expect(result.localMatches[0].id).toBe("kr-bong");
    expect(result.invalidCount).toBe(1);
  });

  it("fitScore 클램핑 (0-100)", () => {
    const validIds = new Set(["kr-bong"]);
    const parsed = {
      localMatches: [{ id: "kr-bong", fitScore: 150, reason: "test" }],
      webSuggestions: [{ id: "new", fitScore: -10, reason: "test" }],
    };
    const result = serverPostProcess(parsed, validIds);
    expect(result.localMatches[0].fitScore).toBe(100);
    expect(result.webSuggestions[0].fitScore).toBe(0);
  });

  it("빈 reason → fallback 텍스트", () => {
    const validIds = new Set(["kr-bong"]);
    const parsed = {
      localMatches: [{ id: "kr-bong", fitScore: 80, reason: "" }],
      webSuggestions: [],
    };
    const result = serverPostProcess(parsed, validIds);
    expect(result.localMatches[0].reason).toBe("(이유 미제공)");
  });

  it("모든 id가 유효하면 필터 없음", () => {
    const validIds = new Set(["kr-bong", "kr-park"]);
    const parsed = {
      localMatches: [
        { id: "kr-bong", fitScore: 90, reason: "good" },
        { id: "kr-park", fitScore: 85, reason: "great" },
      ],
      webSuggestions: [],
    };
    const result = serverPostProcess(parsed, validIds);
    expect(result.localMatches.length).toBe(2);
    expect(result.invalidCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 품질 경고 조건 (클라이언트 UI 로직)
// ═══════════════════════════════════════════════════════════════════

describe("품질 경고 조건", () => {
  function checkQualityWarning(
    matches: { fitScore: number; reason: string }[]
  ): { lowScore: boolean; genericReason: boolean } {
    const maxScore = matches.length > 0 ? Math.max(...matches.map(m => m.fitScore)) : 0;
    const hasGenericReason = matches.some(m => !m.reason || m.reason === "(이유 미제공)" || m.reason.length < 10);
    return {
      lowScore: maxScore > 0 && maxScore < 60,
      genericReason: hasGenericReason,
    };
  }

  it("높은 fitScore → 경고 없음", () => {
    const w = checkQualityWarning([
      { fitScore: 92, reason: "이 시나리오의 사회 풍자 요소가 봉준호의 계층 대비 연출과 잘 맞습니다." },
    ]);
    expect(w.lowScore).toBe(false);
    expect(w.genericReason).toBe(false);
  });

  it("낮은 fitScore → 경고", () => {
    const w = checkQualityWarning([
      { fitScore: 45, reason: "어울리는 이유가 있습니다." },
    ]);
    expect(w.lowScore).toBe(true);
  });

  it("짧은 reason → 경고", () => {
    const w = checkQualityWarning([
      { fitScore: 80, reason: "좋음" }, // 3자 < 10
    ]);
    expect(w.genericReason).toBe(true);
  });

  it("빈 reason → 경고", () => {
    const w = checkQualityWarning([
      { fitScore: 80, reason: "(이유 미제공)" },
    ]);
    expect(w.genericReason).toBe(true);
  });

  it("다수 매치 중 하나만 낮아도 전체 경고 안 남 (max 기준)", () => {
    const w = checkQualityWarning([
      { fitScore: 90, reason: "이 시나리오의 감성적 분위기가 잘 어울립니다." },
      { fitScore: 40, reason: "이 감독도 가능하지만 적합도가 낮습니다." },
    ]);
    expect(w.lowScore).toBe(false); // max=90 → no warning
  });
});

// ═══════════════════════════════════════════════════════════════════
// 빈결과 과도 발생 방지
// ═══════════════════════════════════════════════════════════════════

describe("빈결과 과도 발생 방지", () => {
  it("빈결과 비율 30% 이하면 경고 없음", () => {
    const log = [
      logEntry({ outcome: "success" }),
      logEntry({ outcome: "success" }),
      logEntry({ outcome: "success" }),
      logEntry({ outcome: "empty" }),
    ];
    const items = deriveRecommendActions(buildRecommendSummary(log));
    expect(items.every(i => !i.includes("[빈결과]"))).toBe(true);
  });

  it("연속 빈결과 3회 이상이면 반드시 경고", () => {
    const log = [
      logEntry({ outcome: "empty" }),
      logEntry({ outcome: "empty" }),
      logEntry({ outcome: "empty" }),
    ];
    const summary = buildRecommendSummary(log);
    expect(summary.emptyRate).toBe(1.0);
    const items = deriveRecommendActions(summary);
    expect(items.some(i => i.includes("[빈결과]"))).toBe(true);
  });

  it("에러만 있으면 빈결과 경고가 아닌 에러 경고", () => {
    const log = [
      logEntry({ outcome: "error", errorCategory: "network" }),
      logEntry({ outcome: "error", errorCategory: "network" }),
    ];
    const items = deriveRecommendActions(buildRecommendSummary(log));
    expect(items.some(i => i.includes("[에러]"))).toBe(true);
    expect(items.every(i => !i.includes("[빈결과]"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 애매한 입력에서도 최소 상태 유지
// ═══════════════════════════════════════════════════════════════════

describe("애매한 입력 처리", () => {
  it("30자 짧은 시나리오 → empty 로그엔트리 생성 가능", () => {
    // 30자 이상은 통과, 결과 empty여도 로그 남음
    const entry = logEntry({
      storySnippet: "짧은 이야기입니다 감독 추천 받고 싶어요",
      storyLength: 35,
      outcome: "empty",
      localMatchCount: 0,
      webSuggestionCount: 0,
    });
    expect(entry.outcome).toBe("empty");
    expect(entry.storyLength).toBeGreaterThanOrEqual(30);
  });

  it("summary에 빈결과 포함 시 storyLength 확인 가능", () => {
    const log = [
      logEntry({ outcome: "empty", storyLength: 35, localMatchCount: 0, webSuggestionCount: 0 }),
      logEntry({ outcome: "success", storyLength: 200 }),
    ];
    const s = buildRecommendSummary(log);
    expect(s.emptyCount).toBe(1);
    expect(s.successCount).toBe(1);
    // 오너는 로그에서 짧은 시나리오 → 빈결과 패턴을 확인할 수 있음
  });
});
