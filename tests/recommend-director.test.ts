/**
 * recommend-director.test.ts — 감독 추천 API + 프론트 상태 흐름 검증
 *
 * 테스트 범위:
 * - API 엔드포인트 응답 구조
 * - 프론트 상태 머신 (loading → success | error | empty)
 * - 에러 시 사용자 피드백
 * - 빈 결과 처리
 * - 결과 건수 표시
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── API response shapes ───

interface RecommendResponse {
  analysis: string;
  localMatches: { id: string; fitScore: number; reason: string }[];
  webSuggestions: {
    id: string; name: string; nameKo: string; region: string; style: string;
    description: string; reason: string; fitScore: number;
  }[];
}

interface RecommendErrorResponse {
  error: string;
  code: string;
  help: string;
  detail: string;
}

// ─── Mock API handler (mirrors functions/api/recommend-director.ts output) ───

function mockSuccessResponse(): RecommendResponse {
  return {
    analysis: "서정적인 감성의 로맨스 시나리오로 섬세한 카메라워크가 필요합니다.",
    localMatches: [
      { id: "kr-park", fitScore: 92, reason: "섬세한 감정선과 시각적 상징 활용에 강점" },
      { id: "kr-bong", fitScore: 78, reason: "사회적 맥락과 캐릭터 대비 연출에 적합" },
    ],
    webSuggestions: [
      {
        id: "eu-tarr", name: "Bela Tarr", nameKo: "벨러 타르",
        region: "유럽", style: "장회 숏, 흑백, 명상적",
        description: "극도로 긴 테이크와 흑백 영상미", reason: "몽환적 분위기에 적합",
        fitScore: 85,
      },
    ],
  };
}

function mockEmptyResponse(): RecommendResponse {
  return {
    analysis: "시나리오가 너무 짧아 구체적 매칭이 어렵습니다.",
    localMatches: [],
    webSuggestions: [],
  };
}

function mockErrorResponse(): RecommendErrorResponse {
  return {
    error: "Gemini API rate limit exceeded",
    code: "RATE_LIMIT",
    help: "서버 로그와 브라우저 콘솔을 확인하세요.",
    detail: "429 Too Many Requests",
  };
}

// ─── State machine simulation (mirrors InputPanel.tsx logic) ───

interface RecommendState {
  isRecommending: boolean;
  showRecommendation: boolean;
  directorRecommendation: RecommendResponse | null;
  recommendError: string | null;
}

function initialState(): RecommendState {
  return {
    isRecommending: false,
    showRecommendation: false,
    directorRecommendation: null,
    recommendError: null,
  };
}

async function simulateRecommend(
  fetchResult: { ok: boolean; data: unknown },
  storyText: string = "아주 긴 시나리오 텍스트입니다. 최소 30자 이상이어야 합니다."
): Promise<RecommendState> {
  const state = initialState();

  // Guard: same as InputPanel
  if (!storyText.trim() || storyText.length < 30) return state;

  // Start
  state.isRecommending = true;
  state.showRecommendation = true;
  state.recommendError = null;

  try {
    if (!fetchResult.ok) {
      const errBody = fetchResult.data as Record<string, unknown>;
      const msg = errBody && "error" in errBody
        ? `${errBody.code ?? "ERROR"}: ${errBody.error}`
        : `API error: 500`;
      throw new Error(msg);
    }
    state.directorRecommendation = fetchResult.data as RecommendResponse;
    state.recommendError = null;
  } catch (err) {
    state.directorRecommendation = null;
    state.recommendError = err instanceof Error ? err.message : "추천 중 오류가 발생했습니다";
  } finally {
    state.isRecommending = false;
  }

  return state;
}

// ─── UI render condition helpers (mirrors JSX conditions) ───

function shouldShowError(s: RecommendState): boolean {
  return s.showRecommendation && !s.isRecommending && !!s.recommendError;
}

function shouldShowResults(s: RecommendState): boolean {
  return s.showRecommendation && !s.isRecommending && !!s.directorRecommendation && !s.recommendError;
}

function shouldShowEmpty(s: RecommendState): boolean {
  if (!shouldShowResults(s) || !s.directorRecommendation) return false;
  return s.directorRecommendation.localMatches.length === 0
    && s.directorRecommendation.webSuggestions.length === 0;
}

function totalRecommended(s: RecommendState): number {
  if (!s.directorRecommendation) return 0;
  return s.directorRecommendation.localMatches.length + s.directorRecommendation.webSuggestions.length;
}

function buttonLabel(s: RecommendState): string {
  if (s.isRecommending) return "시나리오에 맞는 감독을 찾고 있습니다...";
  if (s.showRecommendation && (s.directorRecommendation || s.recommendError)) {
    return "✨ 감독 다시 추천받기";
  }
  return "✨ 이 시나리오에 어울리는 감독 AI 추천";
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("감독 추천: 성공 흐름", () => {
  it("성공 시 결과 UI가 표시됨", async () => {
    const state = await simulateRecommend({ ok: true, data: mockSuccessResponse() });
    expect(shouldShowResults(state)).toBe(true);
    expect(shouldShowError(state)).toBe(false);
    expect(shouldShowEmpty(state)).toBe(false);
  });

  it("추천 결과 건수가 정확함", async () => {
    const state = await simulateRecommend({ ok: true, data: mockSuccessResponse() });
    expect(totalRecommended(state)).toBe(3); // 2 local + 1 web
  });

  it("성공 후 버튼 텍스트가 '다시 추천받기'로 변경됨", async () => {
    const state = await simulateRecommend({ ok: true, data: mockSuccessResponse() });
    expect(buttonLabel(state)).toContain("다시 추천받기");
  });

  it("analysis가 존재함", async () => {
    const state = await simulateRecommend({ ok: true, data: mockSuccessResponse() });
    expect(state.directorRecommendation?.analysis).toBeTruthy();
  });

  it("localMatches의 fitScore가 0-100 범위", async () => {
    const state = await simulateRecommend({ ok: true, data: mockSuccessResponse() });
    for (const m of state.directorRecommendation!.localMatches) {
      expect(m.fitScore).toBeGreaterThanOrEqual(0);
      expect(m.fitScore).toBeLessThanOrEqual(100);
    }
  });
});

describe("감독 추천: 빈 결과 흐름", () => {
  it("빈 결과 시 '추천 결과 없음' 표시 조건 충족", async () => {
    const state = await simulateRecommend({ ok: true, data: mockEmptyResponse() });
    expect(shouldShowResults(state)).toBe(true);
    expect(shouldShowEmpty(state)).toBe(true);
    expect(totalRecommended(state)).toBe(0);
  });

  it("빈 결과에도 analysis는 표시 가능", async () => {
    const state = await simulateRecommend({ ok: true, data: mockEmptyResponse() });
    expect(state.directorRecommendation?.analysis).toBeTruthy();
  });
});

describe("감독 추천: 에러 흐름", () => {
  it("API 에러 시 에러 상태가 표시됨", async () => {
    const state = await simulateRecommend({ ok: false, data: mockErrorResponse() });
    expect(shouldShowError(state)).toBe(true);
    expect(shouldShowResults(state)).toBe(false);
  });

  it("에러 시 directorRecommendation은 null", async () => {
    const state = await simulateRecommend({ ok: false, data: mockErrorResponse() });
    expect(state.directorRecommendation).toBeNull();
  });

  it("에러 메시지에 API 에러 내용 포함", async () => {
    const state = await simulateRecommend({ ok: false, data: mockErrorResponse() });
    expect(state.recommendError).toContain("Gemini API rate limit");
  });

  it("에러 후 버튼 텍스트가 '다시 추천받기'로 변경됨", async () => {
    const state = await simulateRecommend({ ok: false, data: mockErrorResponse() });
    expect(buttonLabel(state)).toContain("다시 추천받기");
  });

  it("네트워크 에러 시 기본 에러 메시지", async () => {
    const state = await simulateRecommend({ ok: false, data: null });
    expect(state.recommendError).toBeTruthy();
  });
});

describe("감독 추천: guard 조건", () => {
  it("storyText가 30자 미만이면 추천 안 함", async () => {
    const state = await simulateRecommend({ ok: true, data: mockSuccessResponse() }, "짧은 텍스트");
    expect(state.showRecommendation).toBe(false);
    expect(state.directorRecommendation).toBeNull();
  });

  it("빈 storyText면 추천 안 함", async () => {
    const state = await simulateRecommend({ ok: true, data: mockSuccessResponse() }, "");
    expect(state.showRecommendation).toBe(false);
  });

  it("공백만 있는 storyText면 추천 안 함", async () => {
    const state = await simulateRecommend({ ok: true, data: mockSuccessResponse() }, "   ");
    expect(state.showRecommendation).toBe(false);
  });
});

describe("감독 추천: 로딩 상태", () => {
  it("로딩 중에는 결과/에러 모두 표시 안 함", () => {
    const state: RecommendState = {
      isRecommending: true,
      showRecommendation: true,
      directorRecommendation: null,
      recommendError: null,
    };
    expect(shouldShowResults(state)).toBe(false);
    expect(shouldShowError(state)).toBe(false);
  });

  it("로딩 중 버튼 텍스트", () => {
    const state: RecommendState = {
      isRecommending: true,
      showRecommendation: true,
      directorRecommendation: null,
      recommendError: null,
    };
    expect(buttonLabel(state)).toContain("찾고 있습니다");
  });
});

describe("감독 추천: API 응답 구조 검증", () => {
  it("성공 응답에 필수 필드가 존재", () => {
    const resp = mockSuccessResponse();
    expect(resp).toHaveProperty("analysis");
    expect(resp).toHaveProperty("localMatches");
    expect(resp).toHaveProperty("webSuggestions");
    expect(Array.isArray(resp.localMatches)).toBe(true);
    expect(Array.isArray(resp.webSuggestions)).toBe(true);
  });

  it("localMatch에 id, fitScore, reason 필수", () => {
    const resp = mockSuccessResponse();
    for (const m of resp.localMatches) {
      expect(m).toHaveProperty("id");
      expect(m).toHaveProperty("fitScore");
      expect(m).toHaveProperty("reason");
    }
  });

  it("webSuggestion에 name, nameKo, region 필수", () => {
    const resp = mockSuccessResponse();
    for (const s of resp.webSuggestions) {
      expect(s).toHaveProperty("name");
      expect(s).toHaveProperty("nameKo");
      expect(s).toHaveProperty("region");
    }
  });

  it("에러 응답에 error, code 필수", () => {
    const resp = mockErrorResponse();
    expect(resp).toHaveProperty("error");
    expect(resp).toHaveProperty("code");
  });
});

describe("감독 추천: region/style filter 과도 필터링 방지", () => {
  it("localMatches에서 dir를 못 찾아도 크래시 안 함 (null return)", () => {
    // Simulates the UI case where allDirectors.find() returns undefined
    const resp = mockSuccessResponse();
    const allDirectors = [{ id: "kr-bong", nameKo: "봉준호" }]; // kr-park missing
    const rendered = resp.localMatches.map(match => {
      const dir = allDirectors.find(d => d.id === match.id);
      if (!dir) return null; // This is the existing guard in InputPanel
      return dir.nameKo;
    }).filter(Boolean);
    // Should not crash, just filter out unknown
    expect(rendered.length).toBe(1); // only kr-bong found
    expect(rendered[0]).toBe("봉준호");
  });

  it("webSuggestions가 5개 이상이어도 전부 렌더링 가능", () => {
    const resp = mockSuccessResponse();
    resp.webSuggestions = Array.from({ length: 5 }, (_, i) => ({
      id: `test-${i}`, name: `Dir ${i}`, nameKo: `감독${i}`,
      region: "유럽", style: "test", description: "test",
      reason: "test reason", fitScore: 80 + i,
    }));
    expect(resp.webSuggestions.length).toBe(5);
    // All should be renderable (no filter removes them)
    expect(resp.webSuggestions.every(s => s.id && s.nameKo)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// No-cache 정책 (owner-only V0.9)
// ═══════════════════════════════════════════════════════════════════

describe("감독 추천: no-cache 정책 (owner-only V0.9)", () => {
  // Simulates the no-cache recommendation flow
  // Each call creates a fresh state and always invokes the "API"

  let apiCallCount: number;

  function simulateNoCacheRecommend(
    fetchFn: () => { ok: boolean; data: unknown },
    storyText: string = "아주 긴 시나리오 텍스트입니다. 최소 30자 이상이어야 합니다."
  ): RecommendState {
    const state = initialState();
    if (!storyText.trim() || storyText.length < 30) return state;

    state.isRecommending = true;
    state.showRecommendation = true;
    state.recommendError = null;

    // No cache check — always call API
    apiCallCount++;
    const fetchResult = fetchFn();

    try {
      if (!fetchResult.ok) {
        throw new Error("API error");
      }
      state.directorRecommendation = fetchResult.data as RecommendResponse;
      // No cache save — results are not stored
    } catch (err) {
      state.directorRecommendation = null;
      state.recommendError = err instanceof Error ? err.message : "추천 중 오류가 발생했습니다";
    } finally {
      state.isRecommending = false;
    }

    return state;
  }

  it("같은 입력으로 연속 클릭해도 매번 API 호출 발생", () => {
    apiCallCount = 0;
    const storyText = "서울 한복판에서 벌어지는 스릴러. 비 오는 밤, 택시 안에서 시작되는 이야기.";

    // Click 1
    simulateNoCacheRecommend(() => ({ ok: true, data: mockSuccessResponse() }), storyText);
    expect(apiCallCount).toBe(1);

    // Click 2 — same input, should NOT use cache
    simulateNoCacheRecommend(() => ({ ok: true, data: mockSuccessResponse() }), storyText);
    expect(apiCallCount).toBe(2);

    // Click 3 — same input again
    simulateNoCacheRecommend(() => ({ ok: true, data: mockSuccessResponse() }), storyText);
    expect(apiCallCount).toBe(3);
  });

  it("0건 결과는 캐시에 저장되지 않음 (no-cache이므로 항상 새 호출)", () => {
    apiCallCount = 0;

    // First call returns empty
    const state1 = simulateNoCacheRecommend(() => ({ ok: true, data: mockEmptyResponse() }));
    expect(state1.directorRecommendation?.localMatches.length).toBe(0);

    // Second call — should still call API (not reuse empty result)
    const state2 = simulateNoCacheRecommend(() => ({ ok: true, data: mockSuccessResponse() }));
    expect(apiCallCount).toBe(2);
    expect(state2.directorRecommendation?.localMatches.length).toBe(2);
  });

  it("에러 응답은 캐시에 저장되지 않음", () => {
    apiCallCount = 0;

    // First call errors
    const state1 = simulateNoCacheRecommend(() => ({ ok: false, data: mockErrorResponse() }));
    expect(state1.recommendError).toBeTruthy();

    // Second call — should still call API
    const state2 = simulateNoCacheRecommend(() => ({ ok: true, data: mockSuccessResponse() }));
    expect(apiCallCount).toBe(2);
    expect(state2.directorRecommendation).not.toBeNull();
  });

  it("매 호출마다 최신 결과로 UI 갱신", () => {
    const response1 = mockSuccessResponse();
    response1.analysis = "첫 번째 분석 결과";

    const response2 = mockSuccessResponse();
    response2.analysis = "두 번째 분석 결과 — 업데이트됨";

    const state1 = simulateNoCacheRecommend(() => ({ ok: true, data: response1 }));
    expect(state1.directorRecommendation?.analysis).toBe("첫 번째 분석 결과");

    const state2 = simulateNoCacheRecommend(() => ({ ok: true, data: response2 }));
    expect(state2.directorRecommendation?.analysis).toBe("두 번째 분석 결과 — 업데이트됨");
  });

  it("기존 success / empty / error UI 조건은 유지됨", () => {
    // Success
    const s1 = simulateNoCacheRecommend(() => ({ ok: true, data: mockSuccessResponse() }));
    expect(shouldShowResults(s1)).toBe(true);
    expect(shouldShowError(s1)).toBe(false);

    // Empty
    const s2 = simulateNoCacheRecommend(() => ({ ok: true, data: mockEmptyResponse() }));
    expect(shouldShowResults(s2)).toBe(true);
    expect(shouldShowEmpty(s2)).toBe(true);

    // Error
    const s3 = simulateNoCacheRecommend(() => ({ ok: false, data: mockErrorResponse() }));
    expect(shouldShowError(s3)).toBe(true);
    expect(shouldShowResults(s3)).toBe(false);
  });
});
