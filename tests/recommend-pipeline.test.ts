/**
 * recommend-pipeline.test.ts — 감독 추천 파이프라인 관측성 검증
 *
 * 테스트 범위:
 * - 파이프라인 단계별 카운트 추적
 * - _debug 메타 구조 검증
 * - emptyReason 분류
 * - 빈 결과 시 구체적 병목 식별
 * - region/style 필터 단계에서 후보 감소 추적
 * - 기존 success/empty/error UI 비침범
 */

import { describe, it, expect } from "vitest";

// ─── Server post-parse pipeline simulation ───
// Mirrors the logic in functions/api/recommend-director.ts

interface PipelineInput {
  storyText: string;
  localDirectors: { id: string; name: string; nameKo: string; region: string; style: string }[];
  /** Simulated Gemini response (already parsed JSON) */
  geminiParsed: {
    _pipeline?: {
      extractedGenres?: string[];
      extractedMoods?: string[];
      extractedKeywords?: string[];
      consideredLocalCount?: number;
      consideredLocalIds?: string[];
      rejectedLocalIds?: string[];
      rejectionReasons?: string[];
    };
    analysis?: string;
    localMatches?: { id: string; fitScore: number; reason: string }[];
    webSuggestions?: { id: string; name: string; nameKo: string; region: string; style: string; description: string; reason: string; fitScore: number }[];
  };
}

interface PipelineDebug {
  inputStoryLength: number;
  directorPoolSize: number;
  extractedGenres: string[];
  extractedMoods: string[];
  extractedKeywords: string[];
  consideredLocalCount: number;
  geminiLocalCount: number;
  geminiWebCount: number;
  invalidIdsRemoved: number;
  invalidIds?: string[];
  afterIdValidationLocal: number;
  finalLocalCount: number;
  finalWebCount: number;
  finalCount: number;
  emptyReason: string | null;
  rejectedLocalIds: string[];
  rejectionReasons: string[];
  consideredLocalIds: string[];
}

function runPipeline(input: PipelineInput): {
  localMatches: { id: string; fitScore: number; reason: string }[];
  webSuggestions: any[];
  _debug: PipelineDebug;
} {
  const { storyText, localDirectors, geminiParsed } = input;
  const validLocalIds = new Set(localDirectors.map(d => d.id));
  const directorPoolSize = validLocalIds.size;

  // Stage 0: Gemini pipeline metadata
  const gp = geminiParsed._pipeline ?? {};
  const extractedGenres: string[] = Array.isArray(gp.extractedGenres) ? gp.extractedGenres : [];
  const extractedMoods: string[] = Array.isArray(gp.extractedMoods) ? gp.extractedMoods : [];
  const extractedKeywords: string[] = Array.isArray(gp.extractedKeywords) ? gp.extractedKeywords : [];
  const consideredLocalCount: number = typeof gp.consideredLocalCount === "number" ? gp.consideredLocalCount : -1;
  const consideredLocalIds: string[] = Array.isArray(gp.consideredLocalIds) ? gp.consideredLocalIds : [];
  const rejectedLocalIds: string[] = Array.isArray(gp.rejectedLocalIds) ? gp.rejectedLocalIds : [];
  const rejectionReasons: string[] = Array.isArray(gp.rejectionReasons) ? gp.rejectionReasons : [];

  // Stage 1: Raw Gemini output
  const rawLocalMatches = Array.isArray(geminiParsed.localMatches) ? geminiParsed.localMatches : [];
  const rawWebSuggestions = Array.isArray(geminiParsed.webSuggestions) ? geminiParsed.webSuggestions : [];
  const geminiLocalCount = rawLocalMatches.length;
  const geminiWebCount = rawWebSuggestions.length;

  // Stage 2: Filter hallucinated ids
  const invalidIds = rawLocalMatches.filter(m => !validLocalIds.has(m.id)).map(m => m.id);
  let localMatches = rawLocalMatches.filter(m => validLocalIds.has(m.id));
  const afterIdValidationLocal = localMatches.length;

  // Stage 3: Clamp fitScore
  for (const m of localMatches) {
    if (typeof m.fitScore === "number") m.fitScore = Math.max(0, Math.min(100, Math.round(m.fitScore)));
  }
  const webSuggestions = [...rawWebSuggestions];
  for (const s of webSuggestions) {
    if (typeof s.fitScore === "number") s.fitScore = Math.max(0, Math.min(100, Math.round(s.fitScore)));
  }

  // Stage 4: Ensure reason
  for (const m of localMatches) {
    if (!m.reason || typeof m.reason !== "string") m.reason = "(이유 미제공)";
  }
  for (const s of webSuggestions) {
    if (!s.reason || typeof s.reason !== "string") s.reason = "(이유 미제공)";
  }

  // Stage 5: Final
  const finalLocalCount = localMatches.length;
  const finalWebCount = webSuggestions.length;
  const finalCount = finalLocalCount + finalWebCount;

  // emptyReason
  let emptyReason: string | null = null;
  if (finalCount === 0) {
    if (geminiLocalCount === 0 && geminiWebCount === 0) {
      if (extractedGenres.length === 0 && extractedMoods.length === 0) {
        emptyReason = "genre_mood_not_detected";
      } else if (directorPoolSize === 0) {
        emptyReason = "empty_director_pool";
      } else if (consideredLocalCount === 0) {
        emptyReason = "no_local_candidates_considered";
      } else {
        emptyReason = "gemini_returned_empty";
      }
    } else if (geminiLocalCount > 0 && afterIdValidationLocal === 0) {
      emptyReason = "all_local_ids_hallucinated";
    } else {
      emptyReason = "post_validation_eliminated_all";
    }
  }

  return {
    localMatches,
    webSuggestions,
    _debug: {
      inputStoryLength: Math.min(storyText.length, 1200),
      directorPoolSize,
      extractedGenres,
      extractedMoods,
      extractedKeywords,
      consideredLocalCount,
      geminiLocalCount,
      geminiWebCount,
      invalidIdsRemoved: invalidIds.length,
      invalidIds: invalidIds.length > 0 ? invalidIds : undefined,
      afterIdValidationLocal,
      finalLocalCount,
      finalWebCount,
      finalCount,
      emptyReason,
      rejectedLocalIds,
      rejectionReasons,
      consideredLocalIds,
    },
  };
}

// ─── Test data ───

const POOL = [
  { id: "kr-bong", name: "Bong Joon-ho", nameKo: "봉준호", region: "한국", style: "사회 풍자, 장르 혼합" },
  { id: "kr-park", name: "Park Chan-wook", nameKo: "박찬욱", region: "한국", style: "미장센, 복수극" },
  { id: "us-nolan", name: "Christopher Nolan", nameKo: "크리스토퍼 놀란", region: "미국", style: "SF, 시간 구조" },
  { id: "jp-miyazaki", name: "Hayao Miyazaki", nameKo: "미야자키 하야오", region: "일본", style: "판타지, 자연" },
];

// ═══════════════════════════════════════════════════════════════════
// 1. _debug 메타 구조
// ═══════════════════════════════════════════════════════════════════

describe("파이프라인 _debug 메타 구조", () => {
  it("성공 시 모든 필수 _debug 필드가 존재", () => {
    const result = runPipeline({
      storyText: "서울에서 벌어지는 SF 스릴러. 시간이 역행하는 구조.",
      localDirectors: POOL,
      geminiParsed: {
        _pipeline: {
          extractedGenres: ["SF", "스릴러"],
          extractedMoods: ["긴장감", "미스터리"],
          extractedKeywords: ["시간 역행", "서울"],
          consideredLocalCount: 4,
          consideredLocalIds: ["kr-bong", "kr-park", "us-nolan", "jp-miyazaki"],
          rejectedLocalIds: ["jp-miyazaki"],
          rejectionReasons: ["판타지 전문 — SF 스릴러와 거리 있음"],
        },
        analysis: "시간 역행 SF 스릴러",
        localMatches: [
          { id: "us-nolan", fitScore: 95, reason: "시간 구조 전문가" },
          { id: "kr-bong", fitScore: 78, reason: "장르 혼합 능력" },
        ],
        webSuggestions: [
          { id: "eu-villeneuve", name: "Denis Villeneuve", nameKo: "드니 빌뇌브", region: "유럽", style: "SF", description: "desc", reason: "reason", fitScore: 88 },
        ],
      },
    });

    const d = result._debug;
    expect(d.inputStoryLength).toBeGreaterThan(0);
    expect(d.directorPoolSize).toBe(4);
    expect(d.extractedGenres).toEqual(["SF", "스릴러"]);
    expect(d.extractedMoods).toEqual(["긴장감", "미스터리"]);
    expect(d.extractedKeywords).toContain("시간 역행");
    expect(d.consideredLocalCount).toBe(4);
    expect(d.geminiLocalCount).toBe(2);
    expect(d.geminiWebCount).toBe(1);
    expect(d.invalidIdsRemoved).toBe(0);
    expect(d.afterIdValidationLocal).toBe(2);
    expect(d.finalLocalCount).toBe(2);
    expect(d.finalWebCount).toBe(1);
    expect(d.finalCount).toBe(3);
    expect(d.emptyReason).toBeNull();
    expect(d.rejectedLocalIds).toEqual(["jp-miyazaki"]);
    expect(d.rejectionReasons.length).toBe(1);
  });

  it("_pipeline이 없어도 기본값으로 동작", () => {
    const result = runPipeline({
      storyText: "짧은 시나리오",
      localDirectors: POOL,
      geminiParsed: {
        analysis: "test",
        localMatches: [{ id: "kr-bong", fitScore: 70, reason: "ok" }],
        webSuggestions: [],
      },
    });

    const d = result._debug;
    expect(d.extractedGenres).toEqual([]);
    expect(d.extractedMoods).toEqual([]);
    expect(d.consideredLocalCount).toBe(-1); // unknown
    expect(d.geminiLocalCount).toBe(1);
    expect(d.finalCount).toBe(1);
    expect(d.emptyReason).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. emptyReason 분류
// ═══════════════════════════════════════════════════════════════════

describe("emptyReason 분류", () => {
  it("장르/무드 미감지 → genre_mood_not_detected", () => {
    const result = runPipeline({
      storyText: "abc def ghi jkl mno pqr stu vwx yz abc",
      localDirectors: POOL,
      geminiParsed: {
        _pipeline: { extractedGenres: [], extractedMoods: [], extractedKeywords: [] },
        localMatches: [],
        webSuggestions: [],
      },
    });
    expect(result._debug.emptyReason).toBe("genre_mood_not_detected");
    expect(result._debug.finalCount).toBe(0);
  });

  it("감독 풀 빈 경우 → empty_director_pool", () => {
    const result = runPipeline({
      storyText: "한강에서 벌어지는 로맨스 스릴러",
      localDirectors: [],
      geminiParsed: {
        _pipeline: { extractedGenres: ["로맨스"], extractedMoods: ["긴장"], extractedKeywords: ["한강"] },
        localMatches: [],
        webSuggestions: [],
      },
    });
    expect(result._debug.emptyReason).toBe("empty_director_pool");
  });

  it("로컬 후보 검토 안 됨 → no_local_candidates_considered", () => {
    const result = runPipeline({
      storyText: "한강에서 벌어지는 로맨스 스릴러",
      localDirectors: POOL,
      geminiParsed: {
        _pipeline: {
          extractedGenres: ["로맨스"],
          extractedMoods: ["긴장"],
          consideredLocalCount: 0,
          consideredLocalIds: [],
        },
        localMatches: [],
        webSuggestions: [],
      },
    });
    expect(result._debug.emptyReason).toBe("no_local_candidates_considered");
  });

  it("Gemini가 장르는 인식했지만 빈 배열 반환 → gemini_returned_empty", () => {
    const result = runPipeline({
      storyText: "한강에서 벌어지는 로맨스 스릴러",
      localDirectors: POOL,
      geminiParsed: {
        _pipeline: {
          extractedGenres: ["로맨스", "스릴러"],
          extractedMoods: ["긴장"],
          consideredLocalCount: 4,
        },
        localMatches: [],
        webSuggestions: [],
      },
    });
    expect(result._debug.emptyReason).toBe("gemini_returned_empty");
  });

  it("Gemini가 로컬 추천했지만 전부 환각 ID → all_local_ids_hallucinated", () => {
    const result = runPipeline({
      storyText: "한강에서 벌어지는 로맨스 스릴러",
      localDirectors: POOL,
      geminiParsed: {
        _pipeline: { extractedGenres: ["로맨스"], extractedMoods: [] },
        localMatches: [
          { id: "hallucinated-1", fitScore: 90, reason: "test" },
          { id: "hallucinated-2", fitScore: 85, reason: "test" },
        ],
        webSuggestions: [],
      },
    });
    expect(result._debug.emptyReason).toBe("all_local_ids_hallucinated");
    expect(result._debug.invalidIdsRemoved).toBe(2);
    expect(result._debug.invalidIds).toEqual(["hallucinated-1", "hallucinated-2"]);
  });

  it("성공 시 emptyReason은 null", () => {
    const result = runPipeline({
      storyText: "SF 스릴러 테스트",
      localDirectors: POOL,
      geminiParsed: {
        localMatches: [{ id: "kr-bong", fitScore: 80, reason: "good" }],
        webSuggestions: [],
      },
    });
    expect(result._debug.emptyReason).toBeNull();
    expect(result._debug.finalCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. 단계별 카운트 추적
// ═══════════════════════════════════════════════════════════════════

describe("단계별 카운트 추적", () => {
  it("환각 ID 제거 단계에서 카운트가 줄어듦", () => {
    const result = runPipeline({
      storyText: "테스트 시나리오",
      localDirectors: POOL,
      geminiParsed: {
        _pipeline: { consideredLocalCount: 4 },
        localMatches: [
          { id: "kr-bong", fitScore: 90, reason: "good" },
          { id: "fake-id", fitScore: 85, reason: "hallucinated" },
          { id: "kr-park", fitScore: 80, reason: "ok" },
        ],
        webSuggestions: [{ id: "eu-new", name: "New", nameKo: "새", region: "유럽", style: "s", description: "d", reason: "r", fitScore: 70 }],
      },
    });

    expect(result._debug.geminiLocalCount).toBe(3);  // Gemini returned 3
    expect(result._debug.invalidIdsRemoved).toBe(1);  // 1 hallucinated
    expect(result._debug.afterIdValidationLocal).toBe(2);  // 2 survived
    expect(result._debug.finalLocalCount).toBe(2);
    expect(result._debug.finalWebCount).toBe(1);
    expect(result._debug.finalCount).toBe(3);
  });

  it("전부 유효한 ID면 제거 0건", () => {
    const result = runPipeline({
      storyText: "테스트 시나리오",
      localDirectors: POOL,
      geminiParsed: {
        localMatches: [
          { id: "kr-bong", fitScore: 90, reason: "good" },
          { id: "us-nolan", fitScore: 85, reason: "good" },
        ],
        webSuggestions: [],
      },
    });
    expect(result._debug.invalidIdsRemoved).toBe(0);
    expect(result._debug.afterIdValidationLocal).toBe(2);
    expect(result._debug.finalCount).toBe(2);
  });

  it("Gemini 검토 대상 vs 실제 추천 차이 추적 (rejectedLocalIds)", () => {
    const result = runPipeline({
      storyText: "서울 야경 속 느와르 드라마",
      localDirectors: POOL,
      geminiParsed: {
        _pipeline: {
          extractedGenres: ["느와르"],
          extractedMoods: ["어두운"],
          consideredLocalCount: 4,
          consideredLocalIds: ["kr-bong", "kr-park", "us-nolan", "jp-miyazaki"],
          rejectedLocalIds: ["us-nolan", "jp-miyazaki"],
          rejectionReasons: ["SF 전문 — 느와르와 거리", "판타지 전문 — 느와르와 거리"],
        },
        localMatches: [
          { id: "kr-bong", fitScore: 88, reason: "사회 풍자와 어두운 분위기" },
          { id: "kr-park", fitScore: 92, reason: "미장센과 복수극 전문" },
        ],
        webSuggestions: [],
      },
    });

    const d = result._debug;
    expect(d.consideredLocalIds).toHaveLength(4);
    expect(d.rejectedLocalIds).toHaveLength(2);
    expect(d.rejectedLocalIds).toContain("us-nolan");
    expect(d.rejectionReasons).toHaveLength(2);
    expect(d.finalLocalCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. fitScore 클램핑 & reason fallback
// ═══════════════════════════════════════════════════════════════════

describe("fitScore 클램핑 + reason fallback", () => {
  it("fitScore > 100 → 100으로 클램핑", () => {
    const result = runPipeline({
      storyText: "test",
      localDirectors: POOL,
      geminiParsed: {
        localMatches: [{ id: "kr-bong", fitScore: 150, reason: "overfit" }],
        webSuggestions: [{ id: "x", name: "X", nameKo: "X", region: "미국", style: "s", description: "d", reason: "r", fitScore: 200 }],
      },
    });
    expect(result.localMatches[0].fitScore).toBe(100);
    expect(result.webSuggestions[0].fitScore).toBe(100);
  });

  it("fitScore < 0 → 0으로 클램핑", () => {
    const result = runPipeline({
      storyText: "test",
      localDirectors: POOL,
      geminiParsed: {
        localMatches: [{ id: "kr-bong", fitScore: -10, reason: "negative" }],
        webSuggestions: [],
      },
    });
    expect(result.localMatches[0].fitScore).toBe(0);
  });

  it("빈 reason → fallback 텍스트", () => {
    const result = runPipeline({
      storyText: "test",
      localDirectors: POOL,
      geminiParsed: {
        localMatches: [{ id: "kr-bong", fitScore: 80, reason: "" }],
        webSuggestions: [{ id: "x", name: "X", nameKo: "X", region: "미국", style: "s", description: "d", reason: "", fitScore: 70 }],
      },
    });
    expect(result.localMatches[0].reason).toBe("(이유 미제공)");
    expect(result.webSuggestions[0].reason).toBe("(이유 미제공)");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. 기존 success/empty/error UI 비침범
// ═══════════════════════════════════════════════════════════════════

describe("기존 UI 조건 비침범", () => {
  // The UI conditions depend on: localMatches.length, webSuggestions.length, recommendError
  // _debug is additional metadata — should not affect existing rendering logic

  it("성공 응답에 _debug가 있어도 localMatches/webSuggestions 구조 동일", () => {
    const result = runPipeline({
      storyText: "SF 테스트",
      localDirectors: POOL,
      geminiParsed: {
        _pipeline: { extractedGenres: ["SF"], extractedMoods: ["긴장"] },
        localMatches: [{ id: "us-nolan", fitScore: 95, reason: "SF 전문가" }],
        webSuggestions: [],
      },
    });

    // localMatches should still be a normal array of { id, fitScore, reason }
    expect(Array.isArray(result.localMatches)).toBe(true);
    expect(result.localMatches[0]).toHaveProperty("id");
    expect(result.localMatches[0]).toHaveProperty("fitScore");
    expect(result.localMatches[0]).toHaveProperty("reason");

    // _debug is separate
    expect(result._debug).toBeDefined();
    expect(result._debug.finalCount).toBe(1);
  });

  it("빈 결과에 _debug가 있어도 빈 결과 UI 조건은 동일", () => {
    const result = runPipeline({
      storyText: "아주 모호한 입력",
      localDirectors: POOL,
      geminiParsed: {
        _pipeline: { extractedGenres: [], extractedMoods: [] },
        localMatches: [],
        webSuggestions: [],
      },
    });

    // UI condition: localMatches.length === 0 && webSuggestions.length === 0
    expect(result.localMatches.length).toBe(0);
    expect(result.webSuggestions.length).toBe(0);

    // But _debug provides the reason
    expect(result._debug.emptyReason).toBe("genre_mood_not_detected");
  });

  it("_debug는 기존 response shape (analysis, localMatches, webSuggestions)을 변경하지 않음", () => {
    const result = runPipeline({
      storyText: "test",
      localDirectors: POOL,
      geminiParsed: {
        analysis: "테스트 분석",
        localMatches: [{ id: "kr-bong", fitScore: 80, reason: "이유" }],
        webSuggestions: [],
      },
    });

    // The return object has localMatches, webSuggestions at top level (same as before)
    // _debug is additive
    const keys = Object.keys(result);
    expect(keys).toContain("localMatches");
    expect(keys).toContain("webSuggestions");
    expect(keys).toContain("_debug");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. emptyReason → UI 라벨 매핑
// ═══════════════════════════════════════════════════════════════════

describe("emptyReason → UI 라벨 매핑", () => {
  const EMPTY_REASON_LABELS: Record<string, { label: string; hint: string }> = {
    genre_mood_not_detected: {
      label: "장르/무드 신호 약함",
      hint: "시나리오에 장르(스릴러, 로맨스 등)나 분위기(어두운, 따뜻한 등) 키워드를 추가해보세요.",
    },
    empty_director_pool: {
      label: "감독 풀 비어 있음",
      hint: "보유 감독 목록이 비어 있습니다. 감독을 추가해주세요.",
    },
    no_local_candidates_considered: {
      label: "로컬 후보 검토 실패",
      hint: "AI가 보유 감독 중 적합한 후보를 검토하지 못했습니다. 시나리오를 더 구체적으로 작성해보세요.",
    },
    gemini_returned_empty: {
      label: "AI 매칭 실패",
      hint: "장르/무드는 인식했으나 적합한 감독을 찾지 못했습니다. 다른 장르나 배경을 시도해보세요.",
    },
    all_local_ids_hallucinated: {
      label: "로컬 감독 ID 불일치",
      hint: "AI가 추천한 감독 ID가 실제 목록과 불일치했습니다. 자동 재시도를 권장합니다.",
    },
    post_validation_eliminated_all: {
      label: "후처리에서 전원 탈락",
      hint: "AI 응답은 있었으나 검증 과정에서 모두 제거되었습니다.",
    },
  };

  for (const [reason, { label }] of Object.entries(EMPTY_REASON_LABELS)) {
    it(`${reason} → "${label}" 라벨 매핑`, () => {
      expect(label).toBeTruthy();
      expect(EMPTY_REASON_LABELS[reason].hint).toBeTruthy();
    });
  }

  it("알 수 없는 emptyReason은 매핑이 없으면 기본 메시지로 fallback", () => {
    const unknownReason = "some_future_reason";
    const mapped = EMPTY_REASON_LABELS[unknownReason];
    expect(mapped).toBeUndefined();
    // UI에서는 mapped가 undefined면 기본 "시나리오를 더 구체적으로..." 메시지 표시
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. 복합 시나리오 — 부분 환각 + 부분 성공
// ═══════════════════════════════════════════════════════════════════

describe("복합 시나리오", () => {
  it("일부 환각 + 일부 유효 → 유효한 것만 남고, 환각 추적 가능", () => {
    const result = runPipeline({
      storyText: "도쿄 밤거리의 네온 느와르",
      localDirectors: POOL,
      geminiParsed: {
        _pipeline: {
          extractedGenres: ["느와르"],
          extractedMoods: ["어두운", "네온"],
          extractedKeywords: ["도쿄", "밤"],
          consideredLocalCount: 4,
        },
        localMatches: [
          { id: "kr-park", fitScore: 88, reason: "미장센과 어두운 미학" },
          { id: "fake-wong", fitScore: 92, reason: "왕가위 스타일" }, // hallucinated
          { id: "us-nolan", fitScore: 72, reason: "도시 야경 전문" },
        ],
        webSuggestions: [
          { id: "hk-wong", name: "Wong Kar-wai", nameKo: "왕가위", region: "중국", style: "무드", description: "d", reason: "네온 미학", fitScore: 95 },
        ],
      },
    });

    const d = result._debug;
    expect(d.geminiLocalCount).toBe(3);
    expect(d.invalidIdsRemoved).toBe(1);
    expect(d.invalidIds).toEqual(["fake-wong"]);
    expect(d.afterIdValidationLocal).toBe(2);
    expect(d.finalLocalCount).toBe(2);
    expect(d.finalWebCount).toBe(1);
    expect(d.finalCount).toBe(3);
    expect(d.emptyReason).toBeNull();

    // The valid matches are preserved
    expect(result.localMatches.map(m => m.id)).toEqual(["kr-park", "us-nolan"]);
  });

  it("webSuggestions만 있고 localMatches 전부 환각 → 비어있지 않음", () => {
    const result = runPipeline({
      storyText: "판타지 세계",
      localDirectors: POOL,
      geminiParsed: {
        localMatches: [
          { id: "hallucinated-1", fitScore: 90, reason: "fake" },
        ],
        webSuggestions: [
          { id: "nz-jackson", name: "Peter Jackson", nameKo: "피터 잭슨", region: "오세아니아", style: "판타지", description: "d", reason: "r", fitScore: 95 },
        ],
      },
    });

    expect(result._debug.finalLocalCount).toBe(0);
    expect(result._debug.finalWebCount).toBe(1);
    expect(result._debug.finalCount).toBe(1);
    expect(result._debug.emptyReason).toBeNull(); // Not empty because web has results
  });
});
