/**
 * director-shared.test.ts — 공통 유틸리티 테스트
 *
 * 테스트 범위:
 * - generateSlugId
 * - extractGroundingSources (정규화, 중복 제거)
 * - computeGroundingQuality (점수 계산, 라벨)
 * - isLocalDuplicate / buildLocalNameSet
 * - isGenericReason
 * - clampFitScore / ensureReason
 */

import { describe, it, expect } from "vitest";
import {
  generateSlugId,
  extractGroundingSources,
  computeGroundingQuality,
  buildLocalNameSet,
  isLocalDuplicate,
  isGenericReason,
  clampFitScore,
  ensureReason,
  isSameDirector,
} from "../functions/api/_director-shared";

// ═══════════════════════════════════════════════════════════════════
// generateSlugId
// ═══════════════════════════════════════════════════════════════════

describe("generateSlugId", () => {
  it("한국 감독 slug 생성", () => {
    expect(generateSlugId("Bong Joon-ho", "한국")).toBe("web-kr-joonho");
  });

  it("미국 감독 slug 생성", () => {
    expect(generateSlugId("David Fincher", "미국")).toBe("web-us-fincher");
  });

  it("알 수 없는 지역은 xx", () => {
    expect(generateSlugId("Unknown Director", "남극")).toBe("web-xx-director");
  });

  it("이름에 특수문자가 있어도 처리", () => {
    const slug = generateSlugId("François Truffaut", "유럽");
    expect(slug).toBe("web-eu-truffaut");
  });
});

// ═══════════════════════════════════════════════════════════════════
// extractGroundingSources
// ═══════════════════════════════════════════════════════════════════

describe("extractGroundingSources", () => {
  it("빈 배열 → 빈 결과", () => {
    expect(extractGroundingSources([])).toEqual([]);
  });

  it("null → 빈 결과", () => {
    expect(extractGroundingSources(null)).toEqual([]);
  });

  it("유효한 소스 추출", () => {
    const chunks = [
      { web: { uri: "https://example.com/1", title: "Source 1" } },
      { web: { uri: "https://example.com/2", title: "Source 2" } },
    ];
    const sources = extractGroundingSources(chunks);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({ title: "Source 1", url: "https://example.com/1" });
  });

  it("중복 URL 제거", () => {
    const chunks = [
      { web: { uri: "https://example.com/1", title: "Source 1" } },
      { web: { uri: "https://example.com/1", title: "Source 1 copy" } },
      { web: { uri: "https://example.com/2", title: "Source 2" } },
    ];
    const sources = extractGroundingSources(chunks);
    expect(sources).toHaveLength(2);
  });

  it("web 필드 없는 chunk 건너뛰기", () => {
    const chunks = [
      {} as { web?: { uri: string; title: string } },
      { web: { uri: "https://example.com/1", title: "Source 1" } },
    ];
    const sources = extractGroundingSources(chunks);
    expect(sources).toHaveLength(1);
  });

  it("빈 URL 건너뛰기", () => {
    const chunks = [
      { web: { uri: "", title: "Empty URL" } },
      { web: { uri: "https://example.com/1", title: "Valid" } },
    ];
    const sources = extractGroundingSources(chunks);
    expect(sources).toHaveLength(1);
    expect(sources[0].title).toBe("Valid");
  });
});

// ═══════════════════════════════════════════════════════════════════
// computeGroundingQuality
// ═══════════════════════════════════════════════════════════════════

describe("computeGroundingQuality", () => {
  it("소스 없음 → score 0, label none", () => {
    const q = computeGroundingQuality([], []);
    expect(q.score).toBe(0);
    expect(q.label).toBe("none");
    expect(q.sourceCount).toBe(0);
  });

  it("소스 1개, 관련 키워드 없음 → weak/moderate", () => {
    const q = computeGroundingQuality(
      [{ title: "Some article", url: "https://example.com" }],
      [],
    );
    expect(q.score).toBeGreaterThan(0);
    expect(q.sourceCount).toBe(1);
    // 소스 1개 + 키워드 없음 → 낮은 점수
    expect(q.score).toBeLessThan(60);
  });

  it("소스 3개, 다양한 도메인, 관련 키워드 매칭 → strong", () => {
    const q = computeGroundingQuality(
      [
        { title: "Bong Joon-ho biography", url: "https://wikipedia.org/wiki/Bong" },
        { title: "Bong Joon-ho films", url: "https://imdb.com/name/bong" },
        { title: "Parasite review", url: "https://rottentomatoes.com/m/parasite" },
      ],
      ["bong", "joon-ho", "parasite"],
    );
    expect(q.score).toBeGreaterThanOrEqual(70);
    expect(q.label).toBe("strong");
    expect(q.uniqueDomains).toBe(3);
    expect(q.relevantSources).toBeGreaterThanOrEqual(2);
  });

  it("소스 많아도 같은 도메인이면 diversity 낮음", () => {
    const sources = Array.from({ length: 5 }, (_, i) => ({
      title: `Article ${i}`, url: `https://example.com/page${i}`,
    }));
    const q = computeGroundingQuality(sources, []);
    // 5개 소스지만 1개 도메인 → diversity 낮음
    expect(q.uniqueDomains).toBe(1);
    // diversity 점수가 낮아야 함
    expect(q.score).toBeLessThan(80);
  });

  it("소스 있지만 관련성 낮으면 점수 낮음", () => {
    const q = computeGroundingQuality(
      [
        { title: "Cooking recipes", url: "https://food.com/recipe" },
        { title: "Weather forecast", url: "https://weather.com/today" },
      ],
      ["miyazaki", "animation", "totoro"],
    );
    expect(q.relevantSources).toBe(0);
    expect(q.score).toBeLessThan(50);
  });

  it("localWebOverlap 보너스 적용", () => {
    const base = computeGroundingQuality(
      [{ title: "Test", url: "https://example.com" }],
      [],
      false,
    );
    const withOverlap = computeGroundingQuality(
      [{ title: "Test", url: "https://example.com" }],
      [],
      true,
    );
    expect(withOverlap.score).toBe(base.score + 10);
  });

  it("grounded=true지만 관련성 낮을 때 label이 strong이 아님", () => {
    const q = computeGroundingQuality(
      [{ title: "Unrelated page", url: "https://random.com" }],
      ["specific-director-name"],
    );
    expect(q.label).not.toBe("strong");
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildLocalNameSet / isLocalDuplicate
// ═══════════════════════════════════════════════════════════════════

describe("중복 판정", () => {
  const localDirs = [
    { name: "Bong Joon-ho", nameKo: "봉준호" },
    { name: "Park Chan-wook", nameKo: "박찬욱" },
    { name: "Miyazaki Hayao", nameKo: "미야자키 하야오" },
  ];
  const nameSet = buildLocalNameSet(localDirs);

  it("정확한 이름 매칭", () => {
    expect(isLocalDuplicate("Bong Joon-ho", "봉준호", nameSet)).toBe(true);
  });

  it("대소문자 무시", () => {
    expect(isLocalDuplicate("bong joon-ho", undefined, nameSet)).toBe(true);
  });

  it("한국어 이름 매칭", () => {
    expect(isLocalDuplicate("Different Name", "봉준호", nameSet)).toBe(true);
  });

  it("다른 감독은 중복 아님", () => {
    expect(isLocalDuplicate("Quentin Tarantino", "쿼틴 타란티노", nameSet)).toBe(false);
  });

  it("nameKo undefined도 안전 처리", () => {
    expect(isLocalDuplicate("New Director", undefined, nameSet)).toBe(false);
  });
});

describe("isSameDirector", () => {
  it("정규화 후 같으면 true", () => {
    expect(isSameDirector("Bong Joon-ho", "bong joonho")).toBe(true);
  });

  it("완전히 다르면 false", () => {
    expect(isSameDirector("Park Chan-wook", "Bong Joon-ho")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// isGenericReason
// ═══════════════════════════════════════════════════════════════════

describe("isGenericReason", () => {
  it("null/undefined → true", () => {
    expect(isGenericReason(null)).toBe(true);
    expect(isGenericReason(undefined)).toBe(true);
  });

  it("'(이유 미제공)' → true", () => {
    expect(isGenericReason("(이유 미제공)")).toBe(true);
  });

  it("너무 짧은 사유 → true", () => {
    expect(isGenericReason("좋다")).toBe(true);
  });

  it("구체적인 사유 → false", () => {
    expect(isGenericReason("네온 느와르 비주얼과 도시적 감성이 시나리오의 분위기와 잘 맞습니다.")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// clampFitScore / ensureReason
// ═══════════════════════════════════════════════════════════════════

describe("clampFitScore", () => {
  it("범위 내 값 유지", () => {
    expect(clampFitScore(75)).toBe(75);
  });

  it("100 초과 → 100", () => {
    expect(clampFitScore(150)).toBe(100);
  });

  it("음수 → 0", () => {
    expect(clampFitScore(-10)).toBe(0);
  });

  it("NaN → 50 (기본값)", () => {
    expect(clampFitScore(NaN)).toBe(50);
  });

  it("문자열 → 50 (기본값)", () => {
    expect(clampFitScore("abc")).toBe(50);
  });

  it("소수점 반올림", () => {
    expect(clampFitScore(72.7)).toBe(73);
  });
});

describe("ensureReason", () => {
  it("유효한 문자열 유지", () => {
    expect(ensureReason("좋은 이유")).toBe("좋은 이유");
  });

  it("빈 문자열 → 기본값", () => {
    expect(ensureReason("")).toBe("(이유 미제공)");
  });

  it("null → 기본값", () => {
    expect(ensureReason(null)).toBe("(이유 미제공)");
  });
});
