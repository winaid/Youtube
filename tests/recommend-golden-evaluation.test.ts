/**
 * recommend-golden-evaluation.test.ts — 감독 추천 golden case + evaluation harness 검증
 *
 * 테스트 범위:
 * 1. Golden case fixture shape validation
 * 2. 각 케이스 expectedProfile 필수 필드 검증
 * 3. EvaluationSummary shape 검증
 * 4. 웹 검색 fallback 경로 구조 테스트
 * 5. Ambiguous 입력에서 emptyReason/weak stage 검증
 * 6. Niche 입력 케이스 — 로컬-only 가정 탈피 검증
 * 7. 기계적 체크리스트 동작 검증
 * 8. Report 집계 검증
 */

import { describe, it, expect } from "vitest";
import {
  RECOMMEND_GOLDEN_CASES,
  type RecommendGoldenCase,
  type RecommendExpectedProfile,
} from "./fixtures/recommend-director-golden";
import {
  extractEvaluationSummary,
  runMechanicalChecks,
  generateReport,
  aggregateReports,
  HUMAN_REVIEW_CHECKLIST,
  type EvaluationSummary,
  type StageStatusSummary,
} from "./helpers/recommend-evaluation";

// ═══════════════════════════════════════════════════════════════════
// 1. Golden case fixture shape validation
// ═══════════════════════════════════════════════════════════════════

describe("golden case fixture shape", () => {
  it("최소 12개 케이스가 존재", () => {
    expect(RECOMMEND_GOLDEN_CASES.length).toBeGreaterThanOrEqual(12);
  });

  it("모든 id가 고유", () => {
    const ids = RECOMMEND_GOLDEN_CASES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const c of RECOMMEND_GOLDEN_CASES) {
    it(`[${c.id}] 필수 필드 존재`, () => {
      expect(c.id).toBeTruthy();
      expect(c.title).toBeTruthy();
      expect(c.story.length).toBeGreaterThan(30);
      expect(c.contentMode).toBeTruthy();
      expect(c.contentType).toBeTruthy();
      expect(c.expectedProfile).toBeDefined();
    });
  }

  it("story가 너무 짧은 케이스가 없음 (ambiguous 제외)", () => {
    for (const c of RECOMMEND_GOLDEN_CASES) {
      if (c.id === "rec-ambiguous") continue;
      expect(c.story.length).toBeGreaterThan(50);
    }
  });

  it("다양한 contentMode 포함", () => {
    const modes = new Set(RECOMMEND_GOLDEN_CASES.map(c => c.contentMode));
    expect(modes.size).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. expectedProfile 필수 필드 검증
// ═══════════════════════════════════════════════════════════════════

describe("expectedProfile 필수 필드", () => {
  const booleanFields: (keyof RecommendExpectedProfile)[] = [
    "shouldFindLocalCandidates",
    "shouldTriggerWebSearch",
    "shouldLikelyReturnResults",
  ];
  const arrayFields: (keyof RecommendExpectedProfile)[] = [
    "expectedGenres",
    "expectedMoods",
    "expectedFailureRisks",
  ];

  for (const c of RECOMMEND_GOLDEN_CASES) {
    it(`[${c.id}] boolean 필드 타입 정확`, () => {
      for (const field of booleanFields) {
        expect(typeof c.expectedProfile[field]).toBe("boolean");
      }
    });

    it(`[${c.id}] array 필드 타입 정확`, () => {
      for (const field of arrayFields) {
        expect(Array.isArray(c.expectedProfile[field])).toBe(true);
      }
    });

    it(`[${c.id}] notes 존재`, () => {
      expect(typeof c.expectedProfile.notes).toBe("string");
      expect(c.expectedProfile.notes.length).toBeGreaterThan(0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 3. EvaluationSummary shape 검증
// ═══════════════════════════════════════════════════════════════════

describe("EvaluationSummary 추출", () => {
  const mockSuccessResponse = {
    analysis: "SF 스릴러 분석",
    localMatches: [
      { id: "kr-bong", name: "Bong Joon-ho", nameKo: "봉준호", fitScore: 85, reason: "장르 혼합 능력" },
    ],
    webSuggestions: [
      { id: "web-us-nolan", name: "Christopher Nolan", nameKo: "크리스토퍼 놀란", fitScore: 92, reason: "시간 구조 전문" },
    ],
    _debug: {
      stageStatus: { extractSignals: "ok", localMatch: "ok", webSearch: "attempted_success", finalAssembly: "ok" },
      stageReasons: { extractSignals: "genres=2", localMatch: "1명 매칭" },
      extractedGenres: ["SF", "스릴러"],
      extractedMoods: ["긴장감"],
      attemptedWebSearch: true,
      webSearchQuery: "SF thriller cinematography style",
      webSearchResultCount: 3,
      localResultCount: 1,
      externalResultCount: 1,
      finalResultCount: 2,
      emptyReason: undefined,
    },
  };

  it("성공 응답에서 모든 필드 추출", () => {
    const summary = extractEvaluationSummary("test-case", "시간이 역행하는 SF 스릴러", mockSuccessResponse);

    expect(summary.caseId).toBe("test-case");
    expect(summary.inputStoryLength).toBeGreaterThan(0);
    expect(summary.stageStatus.extractSignals).toBe("ok");
    expect(summary.stageStatus.localMatch).toBe("ok");
    expect(summary.stageStatus.webSearch).toBe("attempted_success");
    expect(summary.stageStatus.finalAssembly).toBe("ok");
    expect(summary.attemptedWebSearch).toBe(true);
    expect(summary.webSearchQuery).toBe("SF thriller cinematography style");
    expect(summary.localResultCount).toBe(1);
    expect(summary.externalResultCount).toBe(1);
    expect(summary.finalResultCount).toBe(2);
    expect(summary.emptyReason).toBeNull();
    expect(summary.groundingSourceCount).toBe(3);
    expect(summary.returnedDirectorNames).toContain("봉준호");
    expect(summary.returnedDirectorNames).toContain("크리스토퍼 놀란");
    expect(summary.extractedGenres).toEqual(["SF", "스릴러"]);
    expect(summary.extractedMoods).toEqual(["긴장감"]);
  });

  it("빈 응답에서도 crash 없이 기본값 추출", () => {
    const summary = extractEvaluationSummary("empty-case", "test", {});
    expect(summary.caseId).toBe("empty-case");
    expect(summary.finalResultCount).toBe(0);
    expect(summary.emptyReason).toBeNull();
    expect(summary.returnedDirectorNames).toEqual([]);
    expect(summary.extractedGenres).toEqual([]);
  });

  it("_debug 없는 응답에서 stageStatus 기본값", () => {
    const summary = extractEvaluationSummary("no-debug", "test", {
      localMatches: [{ id: "kr-bong", nameKo: "봉준호" }],
      webSuggestions: [],
    });
    expect(summary.stageStatus.extractSignals).toBe("failed");
    expect(summary.localResultCount).toBe(1);
    expect(summary.returnedDirectorNames).toEqual(["봉준호"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. 웹 검색 fallback 경로 구조 테스트
// ═══════════════════════════════════════════════════════════════════

describe("웹 검색 fallback 경로", () => {
  const webSearchCases = RECOMMEND_GOLDEN_CASES.filter(c => c.expectedProfile.shouldTriggerWebSearch);

  it("웹 검색 기대 케이스가 2개 이상 존재", () => {
    expect(webSearchCases.length).toBeGreaterThanOrEqual(2);
  });

  it("웹 검색 기대 케이스에서 shouldFindLocalCandidates=false인 경우가 존재", () => {
    const noLocal = webSearchCases.filter(c => !c.expectedProfile.shouldFindLocalCandidates);
    expect(noLocal.length).toBeGreaterThan(0);
  });

  it("웹 검색 성공 시 attempted_success stageStatus가 발생", () => {
    const mockWebSuccessResponse = {
      localMatches: [],
      webSuggestions: [
        { id: "web-cn-zhang", name: "Zhang Yimou", nameKo: "장예모", fitScore: 88, reason: "무협 전문" },
      ],
      _debug: {
        stageStatus: { extractSignals: "ok", localMatch: "empty", webSearch: "attempted_success", finalAssembly: "ok" },
        attemptedWebSearch: true,
        webSearchQuery: "wuxia cinematography directors",
        webSearchResultCount: 5,
        localResultCount: 0,
        externalResultCount: 1,
        finalResultCount: 1,
        extractedGenres: ["무협"],
        extractedMoods: ["비장한"],
      },
    };

    const summary = extractEvaluationSummary("rec-niche-wuxia", "무협 시나리오", mockWebSuccessResponse);
    const nicheCase = RECOMMEND_GOLDEN_CASES.find(c => c.id === "rec-niche-wuxia")!;
    const checks = runMechanicalChecks(summary, nicheCase.expectedProfile);

    // 웹 검색 트리거 체크가 pass여야 함
    const webCheck = checks.find(c => c.id === "web_search_trigger");
    expect(webCheck?.result).toBe("pass");

    // 결과 존재 체크가 pass여야 함
    const resultCheck = checks.find(c => c.id === "has_results");
    expect(resultCheck?.result).toBe("pass");
  });

  it("웹 검색 시도했지만 빈 결과 시 attempted_empty + emptyReason", () => {
    const mockWebEmptyResponse = {
      localMatches: [],
      webSuggestions: [],
      _debug: {
        stageStatus: { extractSignals: "ok", localMatch: "empty", webSearch: "attempted_empty", finalAssembly: "empty" },
        attemptedWebSearch: true,
        webSearchQuery: "surreal art film directors",
        webSearchResultCount: 0,
        localResultCount: 0,
        externalResultCount: 0,
        finalResultCount: 0,
        emptyReason: "web_search_returned_empty",
        extractedGenres: ["초현실"],
        extractedMoods: ["몽환적"],
      },
    };

    const summary = extractEvaluationSummary("rec-surreal-dream", "초현실 시나리오", mockWebEmptyResponse);
    expect(summary.emptyReason).toBe("web_search_returned_empty");
    expect(summary.attemptedWebSearch).toBe(true);

    const surrealCase = RECOMMEND_GOLDEN_CASES.find(c => c.id === "rec-surreal-dream")!;
    const checks = runMechanicalChecks(summary, surrealCase.expectedProfile);

    // emptyReason 제공 체크
    const emptyCheck = checks.find(c => c.id === "empty_reason_provided");
    expect(emptyCheck?.result).toBe("pass");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Ambiguous 입력 — emptyReason/weak stage 검증
// ═══════════════════════════════════════════════════════════════════

describe("ambiguous 입력 처리", () => {
  const ambiguousCase = RECOMMEND_GOLDEN_CASES.find(c => c.id === "rec-ambiguous")!;

  it("ambiguous 케이스가 존재하고 올바른 기대 프로필을 가짐", () => {
    expect(ambiguousCase).toBeDefined();
    expect(ambiguousCase.expectedProfile.shouldLikelyReturnResults).toBe(false);
    expect(ambiguousCase.expectedProfile.expectedGenres).toEqual([]);
    expect(ambiguousCase.expectedProfile.expectedMoods).toEqual([]);
    expect(ambiguousCase.expectedProfile.expectedFailureRisks.length).toBeGreaterThan(0);
  });

  it("장르/무드 미감지 시 weak extractSignals + 설명 가능한 emptyReason", () => {
    const mockAmbiguousResponse = {
      localMatches: [],
      webSuggestions: [],
      _debug: {
        stageStatus: { extractSignals: "weak", localMatch: "empty", webSearch: "attempted_empty", finalAssembly: "empty" },
        attemptedWebSearch: true,
        webSearchQuery: "cinematography style",
        webSearchResultCount: 0,
        localResultCount: 0,
        externalResultCount: 0,
        finalResultCount: 0,
        emptyReason: "genre_mood_not_detected",
        extractedGenres: [],
        extractedMoods: [],
      },
    };

    const summary = extractEvaluationSummary("rec-ambiguous", ambiguousCase.story, mockAmbiguousResponse);
    const checks = runMechanicalChecks(summary, ambiguousCase.expectedProfile);

    // 빈 결과가 기대대로 → pass
    const resultCheck = checks.find(c => c.id === "has_results");
    expect(resultCheck?.result).toBe("pass");

    // emptyReason 제공됨
    const emptyCheck = checks.find(c => c.id === "empty_reason_provided");
    expect(emptyCheck?.result).toBe("pass");

    // emptyReason이 예상 실패 이유와 일치
    const expectedCheck = checks.find(c => c.id === "empty_reason_expected");
    expect(expectedCheck?.result).toBe("pass");

    // extractSignals가 weak
    expect(summary.stageStatus.extractSignals).toBe("weak");
  });

  it("ambiguous 입력에서도 stageStatus 일관성 유지", () => {
    const summary: EvaluationSummary = {
      caseId: "rec-ambiguous",
      inputStoryLength: 50,
      stageStatus: { extractSignals: "weak", localMatch: "empty", webSearch: "attempted_empty", finalAssembly: "empty" },
      attemptedWebSearch: true,
      webSearchQuery: "cinematography",
      localResultCount: 0,
      externalResultCount: 0,
      finalResultCount: 0,
      emptyReason: "genre_mood_not_detected",
      groundingSourceCount: 0,
      returnedDirectorNames: [],
      extractedGenres: [],
      extractedMoods: [],
      notes: "",
    };

    const checks = runMechanicalChecks(summary, ambiguousCase.expectedProfile);
    const consistencyCheck = checks.find(c => c.id === "stage_status_consistency");
    expect(consistencyCheck?.result).toBe("pass");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Niche 입력 — 로컬-only 가정 탈피 검증
// ═══════════════════════════════════════════════════════════════════

describe("niche 입력 평가 가능성", () => {
  const nicheCases = RECOMMEND_GOLDEN_CASES.filter(c =>
    c.expectedProfile.shouldTriggerWebSearch && c.expectedProfile.shouldLikelyReturnResults
  );

  it("웹 검색이 필요하면서 결과가 기대되는 케이스가 존재", () => {
    expect(nicheCases.length).toBeGreaterThanOrEqual(2);
  });

  for (const c of nicheCases) {
    it(`[${c.id}] shouldFindLocalCandidates=false 설정 (로컬-only 가정 탈피)`, () => {
      expect(c.expectedProfile.shouldFindLocalCandidates).toBe(false);
    });

    it(`[${c.id}] 기대 장르가 있어 웹 검색 쿼리 구성 가능`, () => {
      expect(c.expectedProfile.expectedGenres.length).toBeGreaterThan(0);
    });
  }

  it("niche 무협 케이스의 로컬 매칭 실패 시 웹 fallback 체크 통과", () => {
    const wuxiaCase = RECOMMEND_GOLDEN_CASES.find(c => c.id === "rec-niche-wuxia")!;
    const mockResponse = {
      localMatches: [],
      webSuggestions: [
        { id: "web-cn-zhang", nameKo: "장예모", fitScore: 90, reason: "무협 영화 거장" },
      ],
      _debug: {
        stageStatus: { extractSignals: "ok", localMatch: "empty", webSearch: "attempted_success", finalAssembly: "ok" },
        attemptedWebSearch: true,
        webSearchQuery: "wuxia martial arts directors",
        webSearchResultCount: 4,
        localResultCount: 0,
        externalResultCount: 1,
        finalResultCount: 1,
        extractedGenres: ["무협", "액션"],
        extractedMoods: ["비장한"],
      },
    };

    const summary = extractEvaluationSummary("rec-niche-wuxia", wuxiaCase.story, mockResponse);
    const checks = runMechanicalChecks(summary, wuxiaCase.expectedProfile);

    // 로컬 매칭은 skip (shouldFindLocalCandidates=false)
    const localCheck = checks.find(c => c.id === "local_match");
    expect(localCheck?.result).toBe("skip");

    // 웹 검색 트리거 pass
    const webCheck = checks.find(c => c.id === "web_search_trigger");
    expect(webCheck?.result).toBe("pass");

    // 최종 결과 존재
    const resultCheck = checks.find(c => c.id === "has_results");
    expect(resultCheck?.result).toBe("pass");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. 기계적 체크리스트 동작 검증
// ═══════════════════════════════════════════════════════════════════

describe("기계적 체크리스트", () => {
  it("성공 케이스에서 모든 필수 체크 pass", () => {
    const romanceCase = RECOMMEND_GOLDEN_CASES.find(c => c.id === "rec-romance")!;
    const mockResponse = {
      localMatches: [
        { id: "kr-park", nameKo: "박찬욱", fitScore: 75, reason: "감성 연출" },
      ],
      webSuggestions: [],
      _debug: {
        stageStatus: { extractSignals: "ok", localMatch: "ok", webSearch: "not_attempted", finalAssembly: "ok" },
        attemptedWebSearch: false,
        localResultCount: 1,
        externalResultCount: 0,
        finalResultCount: 1,
        extractedGenres: ["로맨스"],
        extractedMoods: ["따뜻한"],
      },
    };

    const summary = extractEvaluationSummary("rec-romance", romanceCase.story, mockResponse);
    const checks = runMechanicalChecks(summary, romanceCase.expectedProfile);

    const failChecks = checks.filter(c => c.result === "fail");
    expect(failChecks).toEqual([]);

    // has_results pass
    expect(checks.find(c => c.id === "has_results")?.result).toBe("pass");
    // local_match pass
    expect(checks.find(c => c.id === "local_match")?.result).toBe("pass");
    // web_search_trigger pass (not triggered, not expected)
    expect(checks.find(c => c.id === "web_search_trigger")?.result).toBe("pass");
    // stage_status_consistency pass
    expect(checks.find(c => c.id === "stage_status_consistency")?.result).toBe("pass");
  });

  it("stageStatus 비일관 시 fail 발생", () => {
    // finalAssembly=ok인데 결과 0개 → 비일관
    const summary: EvaluationSummary = {
      caseId: "test",
      inputStoryLength: 100,
      stageStatus: { extractSignals: "ok", localMatch: "ok", webSearch: "not_attempted", finalAssembly: "ok" },
      attemptedWebSearch: false,
      webSearchQuery: null,
      localResultCount: 0,
      externalResultCount: 0,
      finalResultCount: 0,
      emptyReason: null,
      groundingSourceCount: 0,
      returnedDirectorNames: [],
      extractedGenres: ["로맨스"],
      extractedMoods: ["따뜻한"],
      notes: "",
    };

    const romanceProfile: RecommendExpectedProfile = {
      shouldFindLocalCandidates: true,
      shouldTriggerWebSearch: false,
      shouldLikelyReturnResults: true,
      expectedGenres: ["로맨스"],
      expectedMoods: ["따뜻한"],
      expectedFailureRisks: [],
      notes: "test",
    };

    const checks = runMechanicalChecks(summary, romanceProfile);
    const consistencyCheck = checks.find(c => c.id === "stage_status_consistency");
    expect(consistencyCheck?.result).toBe("fail");
  });

  it("웹 검색 시 쿼리 체크가 추가됨", () => {
    const summary: EvaluationSummary = {
      caseId: "test",
      inputStoryLength: 100,
      stageStatus: { extractSignals: "ok", localMatch: "empty", webSearch: "attempted_success", finalAssembly: "ok" },
      attemptedWebSearch: true,
      webSearchQuery: "horror dark style directors",
      localResultCount: 0,
      externalResultCount: 2,
      finalResultCount: 2,
      emptyReason: null,
      groundingSourceCount: 5,
      returnedDirectorNames: ["제임스 완", "아리 아스터"],
      extractedGenres: ["호러"],
      extractedMoods: ["공포"],
      notes: "",
    };

    const profile: RecommendExpectedProfile = {
      shouldFindLocalCandidates: false,
      shouldTriggerWebSearch: true,
      shouldLikelyReturnResults: true,
      expectedGenres: ["호러"],
      expectedMoods: ["공포"],
      expectedFailureRisks: [],
      notes: "test",
    };

    const checks = runMechanicalChecks(summary, profile);
    const queryCheck = checks.find(c => c.id === "web_search_query");
    expect(queryCheck).toBeDefined();
    expect(queryCheck?.result).toBe("pass");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Report 생성 + 집계 검증
// ═══════════════════════════════════════════════════════════════════

describe("report 생성 + 집계", () => {
  it("generateReport이 올바른 구조 반환", () => {
    const romanceCase = RECOMMEND_GOLDEN_CASES.find(c => c.id === "rec-romance")!;
    const mockResponse = {
      localMatches: [{ id: "kr-bong", nameKo: "봉준호", fitScore: 80, reason: "감성" }],
      webSuggestions: [],
      _debug: {
        stageStatus: { extractSignals: "ok", localMatch: "ok", webSearch: "not_attempted", finalAssembly: "ok" },
        attemptedWebSearch: false,
        localResultCount: 1, externalResultCount: 0, finalResultCount: 1,
        extractedGenres: ["로맨스"], extractedMoods: ["따뜻한"],
      },
    };

    const report = generateReport(romanceCase, mockResponse);
    expect(report.caseId).toBe("rec-romance");
    expect(report.caseTitle).toBe("빗속에서 다시 만난 두 사람");
    expect(report.summary).toBeDefined();
    expect(report.mechanicalChecks.length).toBeGreaterThan(0);
    expect(report.passCount + report.warnCount + report.failCount + report.skipCount).toBe(report.mechanicalChecks.length);
  });

  it("aggregateReports 집계 정확", () => {
    const reports = [
      { caseId: "a", caseTitle: "A", summary: {} as EvaluationSummary, mechanicalChecks: [], passCount: 5, warnCount: 1, failCount: 0, skipCount: 0 },
      { caseId: "b", caseTitle: "B", summary: {} as EvaluationSummary, mechanicalChecks: [], passCount: 3, warnCount: 0, failCount: 2, skipCount: 1 },
      { caseId: "c", caseTitle: "C", summary: {} as EvaluationSummary, mechanicalChecks: [], passCount: 6, warnCount: 0, failCount: 0, skipCount: 0 },
    ];

    const agg = aggregateReports(reports);
    expect(agg.totalCases).toBe(3);
    expect(agg.totalPass).toBe(14);
    expect(agg.totalWarn).toBe(1);
    expect(agg.totalFail).toBe(2);
    expect(agg.totalSkip).toBe(1);
    expect(agg.failedCaseIds).toEqual(["b"]);
    expect(agg.warnedCaseIds).toEqual(["a"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Human review checklist 구조 검증
// ═══════════════════════════════════════════════════════════════════

describe("human review checklist", () => {
  it("최소 5개 리뷰 항목 존재", () => {
    expect(HUMAN_REVIEW_CHECKLIST.length).toBeGreaterThanOrEqual(5);
  });

  for (const item of HUMAN_REVIEW_CHECKLIST) {
    it(`[${item.id}] 구조 완전`, () => {
      expect(item.id).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.question.length).toBeGreaterThan(10);
    });
  }

  it("니치 fallback 리뷰 항목 존재", () => {
    const hasFallback = HUMAN_REVIEW_CHECKLIST.some(i => i.id.includes("niche") || i.id.includes("fallback"));
    expect(hasFallback).toBe(true);
  });

  it("웹 검색 쿼리 관련성 리뷰 항목 존재", () => {
    const hasQuery = HUMAN_REVIEW_CHECKLIST.some(i => i.id.includes("web_query"));
    expect(hasQuery).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Golden case 범주 커버리지 검증
// ═══════════════════════════════════════════════════════════════════

describe("golden case 범주 커버리지", () => {
  const requiredCategories = [
    { label: "감성 로맨스", check: (c: RecommendGoldenCase) => c.expectedProfile.expectedGenres.some(g => /로맨스/.test(g)) },
    { label: "호러", check: (c: RecommendGoldenCase) => c.expectedProfile.expectedGenres.some(g => /호러/.test(g)) },
    { label: "코미디", check: (c: RecommendGoldenCase) => c.expectedProfile.expectedGenres.some(g => /코미디/.test(g)) },
    { label: "SF", check: (c: RecommendGoldenCase) => c.expectedProfile.expectedGenres.some(g => /SF/.test(g)) },
    { label: "액션", check: (c: RecommendGoldenCase) => c.expectedProfile.expectedGenres.some(g => /액션/.test(g)) },
    { label: "초현실/판타지", check: (c: RecommendGoldenCase) => c.expectedProfile.expectedGenres.some(g => /초현실|판타지/.test(g)) },
    { label: "다큐멘터리", check: (c: RecommendGoldenCase) => c.expectedProfile.expectedGenres.some(g => /다큐/.test(g)) },
    { label: "비주얼 스타일", check: (c: RecommendGoldenCase) => c.expectedProfile.expectedGenres.some(g => /느와르|네오/.test(g)) },
    { label: "단일 주인공", check: (c: RecommendGoldenCase) => c.id.includes("solo") },
    { label: "다인물/군상", check: (c: RecommendGoldenCase) => c.id.includes("ensemble") },
    { label: "애매한 입력", check: (c: RecommendGoldenCase) => c.id.includes("ambiguous") },
    { label: "니치/웹 검색", check: (c: RecommendGoldenCase) => c.id.includes("niche") },
  ];

  for (const cat of requiredCategories) {
    it(`[${cat.label}] 범주 커버됨`, () => {
      const found = RECOMMEND_GOLDEN_CASES.some(cat.check);
      expect(found).toBe(true);
    });
  }
});
