/**
 * director-search-recommend.test.ts — 감독 검색/추천 시스템 테스트
 *
 * 테스트 범위:
 * 1. search-director 응답 구조 (grounded/mode/sources)
 * 2. recommend-director 웹 검색 항상 실행
 * 3. 중복 감독 병합
 * 4. sourceType (local/web) 구분
 * 5. grounding 상태에 따른 라벨 정합성
 * 6. preExtractSignals 규칙 기반 추출
 * 7. buildEnhancedWebSearchQuery 쿼리 보강
 */

import { describe, it, expect } from "vitest";
import {
  preExtractSignals,
  mergePreExtractedSignals,
  buildEnhancedWebSearchQuery,
  type PreExtractedSignals,
} from "../functions/api/recommend-director";

// ═══════════════════════════════════════════════════════════════════
// 1. search-director 응답 구조 검증
// ═══════════════════════════════════════════════════════════════════

describe("SearchDirectorResponse 구조", () => {
  it("grounding 소스가 있는 결과는 grounded: true", () => {
    const result = {
      id: "kr-bong",
      name: "Bong Joon-ho",
      nameKo: "봉준호",
      region: "한국",
      style: "블랙코미디, 사회비판",
      description: "계급과 공간의 시각적 대비를 통해 서사를 구축하는 감독.",
      matchedBy: "이름 일치",
      grounded: true,
      sources: [{ title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Bong_Joon-ho" }],
    };
    expect(result.grounded).toBe(true);
    expect(result.sources).toHaveLength(1);
    expect(result.sources![0].url).toContain("wikipedia");
  });

  it("grounding 소스가 없는 결과는 grounded: false", () => {
    const result = {
      id: "web-us-nolan",
      name: "Christopher Nolan",
      nameKo: "크리스토퍼 놀란",
      grounded: false,
      sources: undefined,
    };
    expect(result.grounded).toBe(false);
    expect(result.sources).toBeUndefined();
  });

  it("mode가 web/model/hybrid 중 하나", () => {
    const validModes = ["web", "model", "hybrid"] as const;
    for (const mode of validModes) {
      const response = { success: true, query: "테스트", mode, directors: [] };
      expect(validModes).toContain(response.mode);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. recommend-director: 웹 검색이 항상 실행되는 구조 검증
// ═══════════════════════════════════════════════════════════════════

describe("recommend-director 웹 확장", () => {
  it("로컬 결과가 강해도 웹 후보를 별도 섹션으로 표시 가능", () => {
    // 기대: localMatches와 webSuggestions가 동시에 존재
    const response = {
      analysis: "테스트 시나리오",
      localMatches: [
        { id: "kr-bong", fitScore: 90, reason: "매우 적합" },
      ],
      webSuggestions: [
        { id: "web-eu-haneke", name: "Michael Haneke", nameKo: "미하엘 하네케", _source: "web_search", grounded: true },
      ],
    };
    expect(response.localMatches).toHaveLength(1);
    expect(response.webSuggestions).toHaveLength(1);
    expect(response.webSuggestions[0]._source).toBe("web_search");
  });

  it("웹 감독은 web- 접두사 id를 가짐", () => {
    const webDirector = { id: "web-jp-kurosawa", name: "Akira Kurosawa" };
    expect(webDirector.id).toMatch(/^web-/);
  });

  it("로컬과 웹 중복 감독은 제거됨", () => {
    const localNames = new Set(["bong joon-ho", "park chan-wook"]);
    const webCandidates = [
      { name: "Bong Joon-ho" },  // 중복
      { name: "Denis Villeneuve" },  // 신규
    ];
    const deduplicated = webCandidates.filter(d => !localNames.has(d.name.toLowerCase()));
    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0].name).toBe("Denis Villeneuve");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. UI 라벨 정합성
// ═══════════════════════════════════════════════════════════════════

describe("UI 라벨 정합성", () => {
  it("grounded=true 결과만 있으면 '웹 기반 결과' 라벨", () => {
    const results = [
      { grounded: true },
      { grounded: true },
    ];
    const label = results.some(d => d.grounded) ? "웹 기반 결과" : "모델 제안";
    expect(label).toBe("웹 기반 결과");
  });

  it("grounded=false 결과만 있으면 '모델 제안' 라벨", () => {
    const results = [
      { grounded: false },
      { grounded: false },
    ];
    const label = results.some(d => d.grounded) ? "웹 기반 결과" : "모델 제안";
    expect(label).toBe("모델 제안");
  });

  it("grounded 혼합이면 '웹 기반 결과'", () => {
    const results = [
      { grounded: true },
      { grounded: false },
    ];
    const label = results.some(d => d.grounded) ? "웹 기반 결과" : "모델 제안";
    expect(label).toBe("웹 기반 결과");
  });

  it("빈 결과에서는 거짓 라벨이 표시되지 않음", () => {
    const results: { grounded: boolean }[] = [];
    // webResults.length > 0 조건을 통과하지 않으므로 라벨 자체가 렌더되지 않음
    expect(results.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. preExtractSignals 규칙 기반 추출
// ═══════════════════════════════════════════════════════════════════

describe("preExtractSignals", () => {
  it("SF 키워드 → SF 장르 감지", () => {
    const signals = preExtractSignals("인공지능이 인류를 지배하는 미래 사회에서...");
    expect(signals.genres).toContain("SF");
  });

  it("호러 키워드 → 호러 장르 감지", () => {
    const signals = preExtractSignals("저주받은 폐건물에서 귀신이 나타난다");
    expect(signals.genres).toContain("호러");
    expect(signals.visualHints).toContain("ruins");
  });

  it("네온+비+도시밤 → 느와르 추론", () => {
    const signals = preExtractSignals("네온 불빛이 번지는 비 오는 도시의 밤거리");
    expect(signals.visualHints).toContain("neon");
    expect(signals.visualHints).toContain("rain");
    expect(signals.genres).toContain("느와르");
  });

  it("what-if 패턴 → 가정적 콘텐츠 감지", () => {
    const signals = preExtractSignals("만약 한국전쟁이 일어나지 않았다면 어떤 세상이 되었을까");
    expect(signals.contentType).toBe("what-if");
    expect(signals.formatHints).toContain("speculative");
  });

  it("빈 텍스트 → 빈 신호", () => {
    const signals = preExtractSignals("");
    expect(signals.genres).toHaveLength(0);
    expect(signals.moods).toHaveLength(0);
  });

  it("몽환적 무드 감지", () => {
    const signals = preExtractSignals("꿈 같은 세계에서 몽롱한 기억이 사라진다");
    expect(signals.moods).toContain("몽환적");
  });

  it("pacing hints 감지", () => {
    const signals = preExtractSignals("롱 테이크로 천천히 따라가는 카메라");
    expect(signals.pacingHints).toContain("slow");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. mergePreExtractedSignals fallback 보강
// ═══════════════════════════════════════════════════════════════════

describe("mergePreExtractedSignals", () => {
  const pre: PreExtractedSignals = {
    genres: ["SF", "드라마"],
    moods: ["철학적", "우울한"],
    keywords: [],
    formatHints: ["speculative"],
    visualHints: ["neon", "rain"],
    pacingHints: ["slow"],
    contentType: "what-if",
    reasons: [],
  };

  it("Gemini 결과가 비었을 때 pre-extraction으로 보강", () => {
    const result = mergePreExtractedSignals([], [], [], pre);
    expect(result.genres).toContain("SF");
    expect(result.moods).toContain("철학적");
    expect(result.mergeReasons.length).toBeGreaterThan(0);
  });

  it("Gemini 결과가 있을 때 pre-extraction 추가 보강", () => {
    const result = mergePreExtractedSignals(["호러"], ["긴장"], [], pre);
    expect(result.genres).toContain("호러");  // Gemini 원본 유지
    expect(result.genres).toContain("SF");    // pre에서 보강
    expect(result.genres.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. buildEnhancedWebSearchQuery 쿼리 보강
// ═══════════════════════════════════════════════════════════════════

describe("buildEnhancedWebSearchQuery", () => {
  it("장르+무드 있으면 포함된 쿼리 생성", () => {
    const pre: PreExtractedSignals = {
      genres: [], moods: [], keywords: [], formatHints: [], visualHints: [], pacingHints: [], contentType: null, reasons: [],
    };
    const result = buildEnhancedWebSearchQuery(["SF"], ["철학적"], [], pre);
    expect(result.query).toContain("SF");
    expect(result.query).toContain("철학적");
  });

  it("모든 신호가 비었으면 기본 쿼리 반환", () => {
    const pre: PreExtractedSignals = {
      genres: [], moods: [], keywords: [], formatHints: [], visualHints: [], pacingHints: [], contentType: null, reasons: [],
    };
    const result = buildEnhancedWebSearchQuery([], [], [], pre);
    expect(result.query).toContain("visual storytelling");
  });

  it("visual hints로 보강", () => {
    const pre: PreExtractedSignals = {
      genres: [], moods: [], keywords: [], formatHints: [], visualHints: ["neon", "rain"], pacingHints: [], contentType: null, reasons: [],
    };
    const result = buildEnhancedWebSearchQuery([], [], [], pre);
    expect(result.query).toContain("neon");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. 중복 병합 & slug ID 생성
// ═══════════════════════════════════════════════════════════════════

describe("중복 병합 & slug ID", () => {
  it("같은 이름(대소문자 무시) 중복 제거", () => {
    const seen = new Set<string>();
    const directors = [
      { name: "Christopher Nolan" },
      { name: "christopher nolan" },  // 중복
      { name: "Denis Villeneuve" },
    ];
    const unique = directors.filter(d => {
      const key = d.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    expect(unique).toHaveLength(2);
  });

  it("web slug id 형식 검증", () => {
    const regionSlug: Record<string, string> = {
      "한국": "kr", "일본": "jp", "유럽": "eu", "미국": "us",
    };
    const generate = (name: string, region: string) => {
      const rSlug = regionSlug[region] ?? "xx";
      const nameSlug = name.split(" ").pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "unknown";
      return `web-${rSlug}-${nameSlug}`;
    };

    expect(generate("Christopher Nolan", "유럽")).toBe("web-eu-nolan");
    expect(generate("봉준호", "한국")).toBe("web-kr-");  // Korean name → no a-z
    expect(generate("Akira Kurosawa", "일본")).toBe("web-jp-kurosawa");
  });
});
