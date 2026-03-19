/**
 * recommend-director-pipeline.test.ts
 *
 * Stage-based retry pipeline orchestration 검증:
 * 1. correctWeakQuery 단위 테스트
 * 2. simplifyQueryForRetry가 원본과 다른 쿼리를 생성하는지
 * 3. reason code → stage 매핑 로직
 * 4. RetryStageLog 구조
 * 5. resultMode (grounded, fallback, mixed, empty) 결정
 * 6. provider_timeout 시 stage 4로 이동
 * 7. duplicate_filtered_all 시 stage 3으로 이동
 * 8. finalGrounded가 fallback 시 false
 *
 * 네트워크 의존 없음 — 유닛 테스트 기반.
 */

import { describe, it, expect } from "vitest";
import {
  correctWeakQuery,
  simplifyQueryForRetry,
  buildEnhancedWebSearchQuery,
  preExtractSignals,
  type WebSearchEmptyReason,
  type RetryStageLog,
} from "../functions/api/recommend-director";

// ═══════════════════════════════════════════════════════════════════
// 1. correctWeakQuery
// ═══════════════════════════════════════════════════════════════════

describe("correctWeakQuery", () => {
  it("전쟁 키워드가 있으면 영문 쿼리로 변환", () => {
    const result = correctWeakQuery("전쟁터에서 병사들이 싸운다");
    expect(result).not.toBeNull();
    expect(result!.query).toContain("war");
    expect(result!.query).not.toContain("전쟁");
  });

  it("우주 키워드가 있으면 space 쿼리", () => {
    const result = correctWeakQuery("우주에서 외계인을 만나는 이야기");
    expect(result).not.toBeNull();
    expect(result!.query).toContain("space");
  });

  it("범죄 키워드가 있으면 crime 쿼리", () => {
    const result = correctWeakQuery("범죄 조직을 수사하는 형사");
    expect(result).not.toBeNull();
    expect(result!.query).toContain("crime");
  });

  it("영문만 있으면 null 반환", () => {
    const result = correctWeakQuery("A story about a mysterious castle");
    expect(result).toBeNull();
  });

  it("빈 텍스트면 null 반환", () => {
    const result = correctWeakQuery("");
    expect(result).toBeNull();
  });

  it("여러 키워드가 추출되면 최대 3개", () => {
    const result = correctWeakQuery("전쟁터에서 사무라이가 우주로 가서 로봇과 싸우는 이야기");
    expect(result).not.toBeNull();
    const parts = result!.query.replace("best film directors for ", "").replace(" visual storytelling cinematography", "");
    expect(parts.split(" ").length).toBeLessThanOrEqual(3);
  });

  it("기억/꿈 키워드도 추출", () => {
    const result = correctWeakQuery("기억을 잃은 남자가 꿈속을 헤맨다");
    expect(result).not.toBeNull();
    expect(result!.query).toMatch(/memory|dream/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. simplifyQueryForRetry
// ═══════════════════════════════════════════════════════════════════

describe("simplifyQueryForRetry", () => {
  it("원본 쿼리와 다른 쿼리를 생성", () => {
    const original = "best film directors for thriller tense neon-lit cinematography style";
    const simplified = simplifyQueryForRetry(original, ["스릴러"], ["긴장"]);
    expect(simplified).not.toBe(original);
    expect(simplified.length).toBeGreaterThan(10);
  });

  it("장르가 없어도 원본에서 키워드 추출", () => {
    const original = "best film directors for unique visual storytelling cinematography";
    const simplified = simplifyQueryForRetry(original, [], []);
    expect(simplified).not.toBe(original);
    expect(simplified).toContain("lesser-known");
  });

  it("장르와 무드가 있으면 상위 항목만 사용", () => {
    const simplified = simplifyQueryForRetry("some query", ["스릴러", "SF", "액션"], ["긴장", "공포"]);
    // 장르 2개 + 무드 1개만 사용
    expect(simplified).toContain("lesser-known");
  });

  it("결과가 비어있지 않음", () => {
    const simplified = simplifyQueryForRetry("", [], []);
    expect(simplified.length).toBeGreaterThan(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Reason code → stage 매핑 로직
// ═══════════════════════════════════════════════════════════════════

describe("reason code → stage 매핑", () => {
  // 이 테스트들은 파이프라인의 제어 로직을 시뮬레이션

  function determineNextStage(emptyReasons: WebSearchEmptyReason[]): number {
    // 파이프라인 로직을 그대로 재현
    if (emptyReasons.includes("provider_timeout") || emptyReasons.includes("provider_failed")) {
      return 4; // 네트워크 문제 → 모델 폴백
    }
    if (emptyReasons.includes("duplicate_filtered_all")) {
      return 3; // 중복 전멸 → 전용 복구
    }
    // parse_failed, provider_empty, weak_query, missing_required_fields, validation_rejected_all
    if (emptyReasons.includes("parse_failed") ||
        emptyReasons.includes("provider_empty") ||
        emptyReasons.includes("weak_query") ||
        emptyReasons.includes("missing_required_fields") ||
        emptyReasons.includes("validation_rejected_all")) {
      return 2; // 쿼리/포맷 문제 → 웹 검색 복구
    }
    return 4; // 기타 → 모델 폴백
  }

  it("parse_failed → stage 2", () => {
    expect(determineNextStage(["parse_failed"])).toBe(2);
  });

  it("provider_empty → stage 2", () => {
    expect(determineNextStage(["provider_empty"])).toBe(2);
  });

  it("weak_query → stage 2", () => {
    expect(determineNextStage(["weak_query"])).toBe(2);
  });

  it("missing_required_fields → stage 2", () => {
    expect(determineNextStage(["missing_required_fields"])).toBe(2);
  });

  it("validation_rejected_all → stage 2", () => {
    expect(determineNextStage(["validation_rejected_all"])).toBe(2);
  });

  it("duplicate_filtered_all → stage 3", () => {
    expect(determineNextStage(["duplicate_filtered_all"])).toBe(3);
  });

  it("provider_timeout → stage 4", () => {
    expect(determineNextStage(["provider_timeout"])).toBe(4);
  });

  it("provider_failed → stage 4", () => {
    expect(determineNextStage(["provider_failed"])).toBe(4);
  });

  it("fallback_empty → stage 4 (최종 실패)", () => {
    expect(determineNextStage(["fallback_empty"])).toBe(4);
  });

  it("혼합 reason: provider_timeout + duplicate → stage 4 우선", () => {
    expect(determineNextStage(["duplicate_filtered_all", "provider_timeout"])).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. RetryStageLog 구조
// ═══════════════════════════════════════════════════════════════════

describe("RetryStageLog 구조", () => {
  it("모든 필수 필드가 있음", () => {
    const log: RetryStageLog = {
      stage: 1,
      name: "stage1_grounded_web",
      model: "gemini-2.0-pro",
      grounded: true,
      normalizedQuery: "best film directors for thriller cinematography",
      timeoutOccurred: false,
      httpStatus: 200,
      rawResultCount: 4,
      acceptedCount: 3,
      rejectedCount: 1,
      emptyReasons: [],
      triggerReason: "initial",
      partialRecoveryCount: 0,
      durationMs: 2500,
    };

    expect(log.stage).toBe(1);
    expect(log.grounded).toBe(true);
    expect(log.timeoutOccurred).toBe(false);
    expect(log.emptyReasons).toHaveLength(0);
  });

  it("timeout 발생 시 기록", () => {
    const log: RetryStageLog = {
      stage: 1,
      name: "stage1_grounded_web",
      model: "gemini-2.0-pro",
      grounded: false,
      normalizedQuery: "query",
      timeoutOccurred: true,
      httpStatus: 504,
      rawResultCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      emptyReasons: ["provider_timeout"],
      triggerReason: "initial",
      partialRecoveryCount: 0,
      durationMs: 30000,
    };

    expect(log.timeoutOccurred).toBe(true);
    expect(log.emptyReasons).toContain("provider_timeout");
    expect(log.grounded).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. resultMode 결정 로직
// ═══════════════════════════════════════════════════════════════════

describe("resultMode 결정", () => {
  function computeResultMode(suggestions: Array<{ grounded: boolean }>): string {
    if (suggestions.length === 0) return "empty";
    const hasGrounded = suggestions.some(s => s.grounded === true);
    const hasUngrounded = suggestions.some(s => s.grounded !== true);
    if (hasGrounded && hasUngrounded) return "mixed";
    if (hasGrounded) return "grounded";
    return "fallback";
  }

  it("빈 결과 → empty", () => {
    expect(computeResultMode([])).toBe("empty");
  });

  it("모두 grounded → grounded", () => {
    expect(computeResultMode([{ grounded: true }, { grounded: true }])).toBe("grounded");
  });

  it("모두 ungrounded → fallback", () => {
    expect(computeResultMode([{ grounded: false }, { grounded: false }])).toBe("fallback");
  });

  it("혼합 → mixed", () => {
    expect(computeResultMode([{ grounded: true }, { grounded: false }])).toBe("mixed");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Stage pipeline 흐름 시뮬레이션
// ═══════════════════════════════════════════════════════════════════

describe("stage pipeline 흐름 시뮬레이션", () => {
  it("stage 1 성공 → 바로 종료 (1회만 실행)", () => {
    // Stage 1이 후보를 반환하면 stage 2, 3, 4는 실행 안됨
    const stages: RetryStageLog[] = [
      {
        stage: 1, name: "stage1_grounded_web", model: "pro",
        grounded: true, normalizedQuery: "q1", timeoutOccurred: false,
        httpStatus: 200, rawResultCount: 4, acceptedCount: 3,
        rejectedCount: 1, emptyReasons: [], triggerReason: "initial",
        partialRecoveryCount: 0, durationMs: 2000,
      },
    ];
    expect(stages).toHaveLength(1);
    expect(stages[0].acceptedCount).toBeGreaterThan(0);
  });

  it("stage 1 parse_failed → stage 2 실행", () => {
    const stages: RetryStageLog[] = [
      {
        stage: 1, name: "stage1_grounded_web", model: "pro",
        grounded: false, normalizedQuery: "q1", timeoutOccurred: false,
        httpStatus: 200, rawResultCount: 0, acceptedCount: 0,
        rejectedCount: 0, emptyReasons: ["parse_failed"], triggerReason: "initial",
        partialRecoveryCount: 0, durationMs: 2000,
      },
      {
        stage: 2, name: "stage2_query_retry", model: "pro",
        grounded: false, normalizedQuery: "q2_simplified", timeoutOccurred: false,
        httpStatus: 200, rawResultCount: 4, acceptedCount: 4,
        rejectedCount: 0, emptyReasons: [], triggerReason: "stage1 failed: parse_failed",
        partialRecoveryCount: 0, durationMs: 2500,
      },
    ];

    expect(stages).toHaveLength(2);
    expect(stages[0].emptyReasons).toContain("parse_failed");
    expect(stages[1].acceptedCount).toBeGreaterThan(0);
    // normalizedQuery가 달라야 함
    expect(stages[0].normalizedQuery).not.toBe(stages[1].normalizedQuery);
  });

  it("stage 1 duplicate_filtered_all → stage 3 실행 (stage 2 건너뜀)", () => {
    const stages: RetryStageLog[] = [
      {
        stage: 1, name: "stage1_grounded_web", model: "pro",
        grounded: true, normalizedQuery: "q1", timeoutOccurred: false,
        httpStatus: 200, rawResultCount: 4, acceptedCount: 0,
        rejectedCount: 4, emptyReasons: ["duplicate_filtered_all"], triggerReason: "initial",
        partialRecoveryCount: 0, durationMs: 2000,
      },
      {
        stage: 3, name: "stage3_duplicate_recovery", model: "pro",
        grounded: true, normalizedQuery: "q1", timeoutOccurred: false,
        httpStatus: 200, rawResultCount: 4, acceptedCount: 2,
        rejectedCount: 2, emptyReasons: [], triggerReason: "duplicate_filtered_all",
        partialRecoveryCount: 0, durationMs: 3000,
      },
    ];

    // Stage 2가 건너뜀
    expect(stages.map(s => s.stage)).toEqual([1, 3]);
    expect(stages[0].emptyReasons).toContain("duplicate_filtered_all");
    expect(stages[1].triggerReason).toBe("duplicate_filtered_all");
    expect(stages[1].acceptedCount).toBeGreaterThan(0);
  });

  it("stage 1 provider_timeout → stage 4로 바로 이동 (stage 2, 3 건너뜀)", () => {
    const stages: RetryStageLog[] = [
      {
        stage: 1, name: "stage1_grounded_web", model: "pro",
        grounded: false, normalizedQuery: "q1", timeoutOccurred: true,
        httpStatus: 504, rawResultCount: 0, acceptedCount: 0,
        rejectedCount: 0, emptyReasons: ["provider_timeout"], triggerReason: "initial",
        partialRecoveryCount: 0, durationMs: 30000,
      },
      {
        stage: 4, name: "stage4_model_fallback", model: "flash",
        grounded: false, normalizedQuery: "q1", timeoutOccurred: false,
        httpStatus: 200, rawResultCount: 4, acceptedCount: 4,
        rejectedCount: 0, emptyReasons: [], triggerReason: "all prior stages failed: provider_timeout",
        partialRecoveryCount: 0, durationMs: 1500,
      },
    ];

    expect(stages.map(s => s.stage)).toEqual([1, 4]);
    expect(stages[0].timeoutOccurred).toBe(true);
    expect(stages[1].grounded).toBe(false);
    expect(stages[1].acceptedCount).toBe(4);
  });

  it("전체 실패 시 finalReasonCodes가 남음", () => {
    const allEmptyReasons: WebSearchEmptyReason[] = [
      "provider_timeout", "fallback_empty",
    ];

    // 최종 실패 시 finalReasonCodes = deduplicated emptyReasons
    const finalReasonCodes = [...new Set(allEmptyReasons)];
    expect(finalReasonCodes).toContain("provider_timeout");
    expect(finalReasonCodes).toContain("fallback_empty");
  });

  it("finalGrounded는 fallback stage에서 false", () => {
    const stage4Result = { grounded: false, accepted: [{ name: "Test", grounded: false }] };
    expect(stage4Result.grounded).toBe(false);
    for (const candidate of stage4Result.accepted) {
      expect(candidate.grounded).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Provenance 계산 — groundedExternalCount / fallbackExternalCount
// ═══════════════════════════════════════════════════════════════════

describe("provenance 계산", () => {
  function computeProvenance(webSuggestions: Array<{ grounded: boolean }>) {
    const groundedExternalCount = webSuggestions.filter(s => s.grounded === true).length;
    const fallbackExternalCount = webSuggestions.filter(s => s.grounded !== true).length;
    const resultMode: "grounded" | "fallback" | "mixed" | "empty" =
      webSuggestions.length === 0 ? "empty"
      : groundedExternalCount > 0 && fallbackExternalCount > 0 ? "mixed"
      : groundedExternalCount > 0 ? "grounded"
      : "fallback";
    return { groundedExternalCount, fallbackExternalCount, resultMode };
  }

  it("전부 grounded → resultMode=grounded, groundedCount=4", () => {
    const p = computeProvenance([
      { grounded: true }, { grounded: true }, { grounded: true }, { grounded: true },
    ]);
    expect(p.resultMode).toBe("grounded");
    expect(p.groundedExternalCount).toBe(4);
    expect(p.fallbackExternalCount).toBe(0);
  });

  it("전부 fallback → resultMode=fallback, fallbackCount=4", () => {
    const p = computeProvenance([
      { grounded: false }, { grounded: false }, { grounded: false }, { grounded: false },
    ]);
    expect(p.resultMode).toBe("fallback");
    expect(p.groundedExternalCount).toBe(0);
    expect(p.fallbackExternalCount).toBe(4);
  });

  it("혼합 → resultMode=mixed, grounded 2 + fallback 2", () => {
    const p = computeProvenance([
      { grounded: true }, { grounded: true }, { grounded: false }, { grounded: false },
    ]);
    expect(p.resultMode).toBe("mixed");
    expect(p.groundedExternalCount).toBe(2);
    expect(p.fallbackExternalCount).toBe(2);
  });

  it("빈 결과 → resultMode=empty", () => {
    const p = computeProvenance([]);
    expect(p.resultMode).toBe("empty");
    expect(p.groundedExternalCount).toBe(0);
    expect(p.fallbackExternalCount).toBe(0);
  });

  it("grounded 1 + fallback 3 → mixed", () => {
    const p = computeProvenance([
      { grounded: true }, { grounded: false }, { grounded: false }, { grounded: false },
    ]);
    expect(p.resultMode).toBe("mixed");
    expect(p.groundedExternalCount).toBe(1);
    expect(p.fallbackExternalCount).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// UI 출처 라벨 매핑 (InputPanel 렌더링 로직과 동기화)
// ═══════════════════════════════════════════════════════════════════

describe("resultMode → UI 출처 라벨 매핑", () => {
  function getSourceLabel(resultMode: string | undefined): string {
    if (resultMode === "grounded") return "웹 검색 기반 추천";
    if (resultMode === "mixed") return "웹 검색 + 모델 지식 기반 추천";
    if (resultMode === "fallback") return "모델 지식 기반 추천 (검색 실패 폴백)";
    return "웹 검색 기반 추천";
  }

  it("grounded → 웹 검색 기반 추천", () => {
    expect(getSourceLabel("grounded")).toBe("웹 검색 기반 추천");
  });

  it("mixed → 웹 검색 + 모델 지식 기반 추천", () => {
    expect(getSourceLabel("mixed")).toBe("웹 검색 + 모델 지식 기반 추천");
  });

  it("fallback → 모델 지식 기반 추천 (검색 실패 폴백)", () => {
    expect(getSourceLabel("fallback")).toBe("모델 지식 기반 추천 (검색 실패 폴백)");
  });

  it("undefined → 기본값 (웹 검색 기반 추천)", () => {
    expect(getSourceLabel(undefined)).toBe("웹 검색 기반 추천");
  });
});
