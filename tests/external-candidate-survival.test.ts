/**
 * external-candidate-survival.test.ts — 외부 감독 후보 잔존 보장 테스트
 *
 * 테스트 범위:
 * - 중복 제거가 한글/영문/별칭/공백 차이를 정확히 처리하는지
 * - 다른 감독이 잘못 제거되지 않는지
 * - buildEnhancedWebSearchQuery가 영문만 생성하는지
 * - emptyReason이 장르 존재 시 올바르게 분류되는지
 */

import { describe, it, expect } from "vitest";
import {
  isSameDirector,
  buildLocalNameSet,
  isLocalDuplicate,
} from "../functions/api/_director-shared";
import {
  buildEnhancedWebSearchQuery,
  preExtractSignals,
} from "../functions/api/recommend-director";

// ═══════════════════════════════════════════════════════════════════
// 중복 제거 정밀 테스트
// ═══════════════════════════════════════════════════════════════════

describe("isSameDirector — 개선된 중복 판정", () => {
  // 동일 감독: 정규화 후 같으면 true
  it("정규화 후 같은 이름 → true", () => {
    expect(isSameDirector("Bong Joon-ho", "bong joonho")).toBe(true);
  });

  it("하이픈/공백 차이 → true", () => {
    expect(isSameDirector("Bong Joon-ho", "Bong Joonho")).toBe(true);
  });

  // 다른 감독: 성만 겹치는 경우 false
  it("성만 겹치는 감독 — Park Chan-wook vs Park Hoon-jung → false", () => {
    // "parkchannwook" vs "parkhoonjung" — 두 이름 모두 완전히 다름
    expect(isSameDirector("Park Chan-wook", "Park Hoon-jung")).toBe(false);
  });

  it("성만 겹치는 짧은 이름 — Lee vs Lee Chang-dong → false", () => {
    // "lee" (3자) vs "leechangdong" — 짧은 쪽이 60% 미달
    expect(isSameDirector("Lee", "Lee Chang-dong")).toBe(false);
  });

  it("4글자 성 — Wong Kar-wai vs Wong → false (5자 미만)", () => {
    expect(isSameDirector("Wong", "Wong Kar-wai")).toBe(false);
  });

  // 한글 이름: 완전 일치만 허용
  it("같은 한글 이름 → true", () => {
    expect(isSameDirector("봉준호", "봉준호")).toBe(true);
  });

  it("다른 한글 이름 → false", () => {
    expect(isSameDirector("봉준호", "박찬욱")).toBe(false);
  });

  it("한글 부분 일치도 false — 박 vs 박찬욱", () => {
    expect(isSameDirector("박", "박찬욱")).toBe(false);
  });

  // 영문 부분 일치: 충분히 긴 경우만 허용
  it("영문 긴 부분 일치 → true (60% 이상)", () => {
    // "miyazaki" (8자) vs "miyazakihayao" (13자) — 8/13 = 61%
    expect(isSameDirector("Miyazaki", "Miyazaki Hayao")).toBe(true);
  });

  it("영문 짧은 부분 일치 → false (60% 미만)", () => {
    // "park" (4자) — 5자 미만이므로 무조건 false
    expect(isSameDirector("Park", "Park Chan-wook")).toBe(false);
  });

  it("완전히 다른 감독 → false", () => {
    expect(isSameDirector("Denis Villeneuve", "Wes Anderson")).toBe(false);
  });

  it("같은 성이지만 충분히 다른 전체 이름 → false", () => {
    expect(isSameDirector("Christopher Nolan", "Jonathan Nolan")).toBe(false);
  });
});

describe("isLocalDuplicate — 로컬 풀 중복 검사", () => {
  const localDirs = [
    { name: "Bong Joon-ho", nameKo: "봉준호" },
    { name: "Park Chan-wook", nameKo: "박찬욱" },
    { name: "Miyazaki Hayao", nameKo: "미야자키 하야오" },
    { name: "Denis Villeneuve", nameKo: "드니 빌뇌브" },
  ];
  const nameSet = buildLocalNameSet(localDirs);

  it("정확한 영문 이름 → 중복", () => {
    expect(isLocalDuplicate("Bong Joon-ho", "봉준호", nameSet)).toBe(true);
  });

  it("정확한 한글 이름 → 중복", () => {
    expect(isLocalDuplicate("Unknown Name", "박찬욱", nameSet)).toBe(true);
  });

  it("대소문자 차이 → 중복", () => {
    expect(isLocalDuplicate("bong joon-ho", undefined, nameSet)).toBe(true);
  });

  it("새로운 감독 → 중복 아님", () => {
    expect(isLocalDuplicate("Quentin Tarantino", "쿼틴 타란티노", nameSet)).toBe(false);
  });

  it("성만 같은 감독 → 중복 아님 (Park Hoon-jung vs Park Chan-wook)", () => {
    expect(isLocalDuplicate("Park Hoon-jung", "박훈정", nameSet)).toBe(false);
  });

  it("이름 일부만 같은 감독 → 중복 아님 (Christopher Nolan)", () => {
    expect(isLocalDuplicate("Christopher Nolan", "크리스토퍼 놀란", nameSet)).toBe(false);
  });

  it("Miyazaki 유사 → 중복 (영문 부분 일치)", () => {
    // "miyazaki" (8자) vs "miyazakihayao" (13자) — 61% → true
    expect(isLocalDuplicate("Miyazaki", "미야자키", nameSet)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 웹 검색 쿼리 영문 보장 테스트
// ═══════════════════════════════════════════════════════════════════

describe("buildEnhancedWebSearchQuery — 영문 전용 쿼리 생성", () => {
  it("한글 장르를 영문으로 변환", () => {
    const pre = preExtractSignals("전쟁 로맨스 스릴러");
    const result = buildEnhancedWebSearchQuery(
      ["로맨스", "액션", "전쟁"],
      ["차가운", "비장한"],
      [],
      pre,
    );
    // 쿼리에 한글이 없어야 함
    expect(result.query).not.toMatch(/[가-힣]/);
    expect(result.query).toContain("romance");
    expect(result.query).toContain("action");
    expect(result.query).toContain("war");
  });

  it("한글 무드를 영문으로 변환", () => {
    const pre = preExtractSignals("몽환적인 분위기의 판타지");
    const result = buildEnhancedWebSearchQuery(
      ["판타지"],
      ["몽환적", "신비로운"],
      [],
      pre,
    );
    expect(result.query).not.toMatch(/[가-힣]/);
    expect(result.query).toContain("fantasy");
    expect(result.query).toContain("dreamlike");
  });

  it("SF 장르 변환", () => {
    const pre = preExtractSignals("미래 도시의 AI 로봇");
    const result = buildEnhancedWebSearchQuery(
      ["SF"],
      [],
      [],
      pre,
    );
    expect(result.query).toContain("sci-fi");
  });

  it("빈 신호 → generic 영문 쿼리", () => {
    const pre = preExtractSignals("짧은 텍스트");
    const result = buildEnhancedWebSearchQuery([], [], [], pre);
    expect(result.query).not.toMatch(/[가-힣]/);
    expect(result.query).toContain("best film directors");
  });

  it("queryReasons에 English 관련 정보 포함", () => {
    const pre = preExtractSignals("전쟁 영화");
    const result = buildEnhancedWebSearchQuery(["전쟁"], [], [], pre);
    expect(result.queryReasons.some(r => r.includes("English"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// preExtractSignals 테스트
// ═══════════════════════════════════════════════════════════════════

describe("preExtractSignals — 규칙 기반 신호 추출", () => {
  it("전쟁 + 로맨스 장르 감지", () => {
    const signals = preExtractSignals("한국전쟁 시기의 비극적인 로맨스 이야기");
    expect(signals.genres).toContain("전쟁");
    expect(signals.genres).toContain("로맨스");
  });

  it("what-if 형식 감지", () => {
    const signals = preExtractSignals("만약 인류가 화성에 도착하지 않았다면 어떤 일이 벌어졌을까");
    expect(signals.contentType).toBe("what-if");
    expect(signals.formatHints).toContain("speculative");
  });

  it("비주얼 힌트 감지", () => {
    const signals = preExtractSignals("안개 낀 폐허에서 석양이 비치는 장면");
    expect(signals.visualHints).toContain("fog");
    expect(signals.visualHints).toContain("ruins");
    expect(signals.visualHints).toContain("sunset");
  });

  it("무드 감지 — 차가운, 비장한", () => {
    const signals = preExtractSignals("차가운 바람 속에서 웅장한 전쟁의 비장한 결말");
    expect(signals.moods).toContain("차가운");
    expect(signals.moods).toContain("비장한");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 외부 후보 잔존 시나리오 테스트
// ═══════════════════════════════════════════════════════════════════

describe("외부 후보 잔존 시나리오", () => {
  const localDirs = [
    { name: "Bong Joon-ho", nameKo: "봉준호" },
    { name: "Park Chan-wook", nameKo: "박찬욱" },
    { name: "Miyazaki Hayao", nameKo: "미야자키 하야오" },
    { name: "Denis Villeneuve", nameKo: "드니 빌뇌브" },
    { name: "Christopher Nolan", nameKo: "크리스토퍼 놀란" },
  ];
  const nameSet = buildLocalNameSet(localDirs);

  it("모델이 로컬 감독을 다시 추천해도 새 감독이 남으면 외부 후보 존재", () => {
    // 시뮬레이션: 모델이 3명 추천 중 2명이 로컬 중복
    const webResults = [
      { name: "Bong Joon-ho", nameKo: "봉준호" }, // 중복
      { name: "Denis Villeneuve", nameKo: "드니 빌뇌브" }, // 중복
      { name: "Ridley Scott", nameKo: "리들리 스콧" }, // 새로운 감독
    ];

    const accepted = webResults.filter(
      d => !isLocalDuplicate(d.name, d.nameKo, nameSet)
    );
    expect(accepted.length).toBe(1);
    expect(accepted[0].name).toBe("Ridley Scott");
  });

  it("모든 웹 결과가 로컬 중복이면 0명", () => {
    const webResults = [
      { name: "bong joon-ho", nameKo: "봉준호" },
      { name: "Park Chan-wook", nameKo: "박찬욱" },
    ];
    const accepted = webResults.filter(
      d => !isLocalDuplicate(d.name, d.nameKo, nameSet)
    );
    expect(accepted.length).toBe(0);
  });

  it("성만 같은 감독은 중복이 아님 — 외부 후보로 남아야 함", () => {
    const webResults = [
      { name: "Park Hoon-jung", nameKo: "박훈정" }, // 성만 같은 다른 감독
      { name: "Lee Chang-dong", nameKo: "이창동" }, // 완전 다른 감독
    ];
    const accepted = webResults.filter(
      d => !isLocalDuplicate(d.name, d.nameKo, nameSet)
    );
    expect(accepted.length).toBe(2);
  });
});
