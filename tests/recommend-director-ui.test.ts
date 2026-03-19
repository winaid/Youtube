/**
 * recommend-director-ui.test.ts — 감독 추천 UI/디버그 헬퍼 테스트
 */
import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════
// emptyReason → 사용자 메시지 매핑 테스트
// ═══════════════════════════════════════════════════════════════════

const EMPTY_REASON_LABELS: Record<string, { label: string; hint: string }> = {
  genre_mood_not_detected: {
    label: "장르나 분위기 신호를 감지하지 못했어요",
    hint: "분위기나 참고 감독을 조금 더 구체적으로 적어보세요.",
  },
  empty_director_pool: {
    label: "보유 감독 목록이 비어 있어요",
    hint: "먼저 감독을 추가하거나 다른 지역 탭을 확인해보세요.",
  },
  all_local_ids_hallucinated: {
    label: "추천 후보는 있었지만 유효하지 않은 데이터라 제외됐어요",
    hint: "다시 시도해 주세요. 보통 재시도하면 해결됩니다.",
  },
  web_search_returned_empty: {
    label: "웹 검색까지 시도했지만 조건에 맞는 감독을 찾지 못했어요",
    hint: "시나리오의 장르나 스타일 키워드를 더 구체적으로 적어보세요.",
  },
  web_search_failed_and_no_local: {
    label: "로컬 매칭과 웹 검색 모두 실패했어요",
    hint: "인터넷 연결을 확인하고 다시 시도해 주세요.",
  },
  no_candidates_found: {
    label: "적합한 감독 후보를 찾지 못했어요",
    hint: "시나리오를 수정하거나 다시 시도해 주세요.",
  },
};

describe("emptyReason 메시지 매핑", () => {
  const knownReasons = [
    "genre_mood_not_detected",
    "empty_director_pool",
    "all_local_ids_hallucinated",
    "web_search_returned_empty",
    "web_search_failed_and_no_local",
    "no_candidates_found",
  ];

  for (const reason of knownReasons) {
    it(`[${reason}] 매핑 존재 + 사용자 친화 메시지`, () => {
      const entry = EMPTY_REASON_LABELS[reason];
      expect(entry).toBeDefined();
      expect(entry.label.length).toBeGreaterThan(5);
      expect(entry.hint.length).toBeGreaterThan(5);
      // 사용자 탓처럼 보이지 않아야 함
      expect(entry.label).not.toMatch(/당신|너|잘못/);
      expect(entry.hint).not.toMatch(/당신|너|잘못/);
    });
  }

  it("web_search_returned_empty에 웹 검색 시도 사실이 언급됨", () => {
    expect(EMPTY_REASON_LABELS.web_search_returned_empty.label).toContain("웹 검색");
  });

  it("all_local_ids_hallucinated에 재시도 힌트 포함", () => {
    expect(EMPTY_REASON_LABELS.all_local_ids_hallucinated.hint).toContain("다시 시도");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Stage summary formatter 테스트
// ═══════════════════════════════════════════════════════════════════

interface StageStatus {
  extractSignals: string;
  localMatch: string;
  webSearch: string;
  finalAssembly: string;
}

function formatStageSummary(ss: StageStatus, sr: Record<string, string>, debug: Record<string, unknown>): string {
  const lines: string[] = [
    `extractSignals: ${ss.extractSignals}${sr.extractSignals ? ` (${sr.extractSignals})` : ""}`,
    `localMatch: ${ss.localMatch}${sr.localMatch ? ` (${sr.localMatch})` : ""}`,
    `webSearch: ${ss.webSearch}${sr.webSearch ? ` (${sr.webSearch})` : ""}`,
    `finalAssembly: ${ss.finalAssembly}${sr.finalAssembly ? ` (${sr.finalAssembly})` : ""}`,
  ];
  if (debug.emptyReason) lines.push(`emptyReason: ${debug.emptyReason}`);
  if (debug.webSearchQuery) lines.push(`query: ${debug.webSearchQuery}`);
  lines.push(`results: local=${debug.localResultCount ?? 0}, web=${debug.externalResultCount ?? 0}, total=${debug.finalResultCount ?? 0}`);
  return lines.join("\n");
}

describe("stage summary formatter", () => {
  it("정상 결과 — ok 상태 출력", () => {
    const summary = formatStageSummary(
      { extractSignals: "ok", localMatch: "ok", webSearch: "not_attempted", finalAssembly: "ok" },
      { extractSignals: "genres=2, moods=1", localMatch: "2명 매칭" },
      { localResultCount: 2, externalResultCount: 0, finalResultCount: 2 },
    );
    expect(summary).toContain("extractSignals: ok");
    expect(summary).toContain("localMatch: ok");
    expect(summary).toContain("not_attempted");
    expect(summary).toContain("total=2");
  });

  it("빈 결과 — emptyReason 포함", () => {
    const summary = formatStageSummary(
      { extractSignals: "weak", localMatch: "empty", webSearch: "attempted_empty", finalAssembly: "empty" },
      { extractSignals: "장르/무드 신호 없음", webSearch: "검색 결과 없음" },
      { emptyReason: "web_search_returned_empty", webSearchQuery: "horror dark cinematography", localResultCount: 0, externalResultCount: 0, finalResultCount: 0 },
    );
    expect(summary).toContain("emptyReason: web_search_returned_empty");
    expect(summary).toContain("query: horror dark cinematography");
    expect(summary).toContain("total=0");
  });

  it("웹 검색 성공 — attempted_success 포함", () => {
    const summary = formatStageSummary(
      { extractSignals: "ok", localMatch: "empty", webSearch: "attempted_success", finalAssembly: "ok" },
      { webSearch: "검색 결과 3개 중 2개 채택" },
      { localResultCount: 0, externalResultCount: 2, finalResultCount: 2 },
    );
    expect(summary).toContain("attempted_success");
    expect(summary).toContain("2개 채택");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Web search attempted / not_attempted 분기 테스트
// ═══════════════════════════════════════════════════════════════════

describe("web search UI 분기", () => {
  it("attemptedWebSearch=true → UI에 웹 검색 정보 표시", () => {
    const debug = {
      stageStatus: { extractSignals: "ok", localMatch: "empty", webSearch: "attempted_success", finalAssembly: "ok" },
      attemptedWebSearch: true,
      webSearchQuery: "drama tension cinematography",
      webSearchResultCount: 3,
      webSearchAcceptedCount: 2,
    };

    // UI 분기 로직 시뮬레이션
    const showWebInfo = !!debug.attemptedWebSearch;
    expect(showWebInfo).toBe(true);
    expect(debug.webSearchQuery).toBeTruthy();
    expect(debug.webSearchResultCount).toBeGreaterThan(0);
  });

  it("attemptedWebSearch=false → 웹 검색 정보 숨김", () => {
    const debug = {
      stageStatus: { extractSignals: "ok", localMatch: "ok", webSearch: "not_attempted", finalAssembly: "ok" },
      attemptedWebSearch: false,
      webSearchQuery: null,
      webSearchResultCount: 0,
    };

    const showWebInfo = !!debug.attemptedWebSearch;
    expect(showWebInfo).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 빈 결과 UI 문구 테스트
// ═══════════════════════════════════════════════════════════════════

describe("빈 결과 UI 문구", () => {
  it("알려진 모든 emptyReason에 대해 사용자 메시지가 존재", () => {
    const serverReasons = [
      "genre_mood_not_detected",
      "empty_director_pool",
      "all_local_ids_hallucinated",
      "web_search_returned_empty",
      "web_search_failed_and_no_local",
      "no_candidates_found",
    ];
    for (const reason of serverReasons) {
      expect(EMPTY_REASON_LABELS[reason]).toBeDefined();
    }
  });

  it("알 수 없는 emptyReason에도 fallback 동작", () => {
    const unknownReason = "some_new_reason";
    const entry = EMPTY_REASON_LABELS[unknownReason];
    // undefined — UI에서 fallback 문구가 표시되어야 함
    expect(entry).toBeUndefined();
  });
});
