/**
 * rhythm-distribution.test.ts
 *
 * 리듬 분배 엔진 검증:
 * - 총 duration budget 보존
 * - Fast / Balanced / Cinematic 모드별 리듬 차이
 * - purpose/shotType/shotCategory 기반 가변 분배
 * - 클라이맥스 컷이 establish 컷보다 항상 같거나 길어야 함
 * - 리듬 대비(stdDev > 0) 확인
 * - clamp 범위 준수
 */
import { describe, it, expect } from "vitest";
import { distributeRhythm } from "../src/lib/rhythm-distribution";
import type { CutRhythmInput, PacingMode } from "../src/lib/rhythm-distribution";

// ═══════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════

/** 역사 설명형 8컷 (총 40초, uniform 5초) */
const HISTORICAL_EXPLAINER: CutRhythmInput[] = [
  { cutNumber: 1, purpose: "establish", shotType: "WS", shotCategory: "environment", durationSec: 5 },
  { cutNumber: 2, purpose: "develop", shotType: "MS", shotCategory: "character-driven", durationSec: 5 },
  { cutNumber: 3, purpose: "develop", shotType: "CU", shotCategory: "object-detail", durationSec: 5 },
  { cutNumber: 4, purpose: "climax", shotType: "MCU", shotCategory: "character-driven", durationSec: 5 },
  { cutNumber: 5, purpose: "develop", shotType: "LS", shotCategory: "environment", durationSec: 5 },
  { cutNumber: 6, purpose: "develop", shotType: "MS", shotCategory: "character-driven", durationSec: 5 },
  { cutNumber: 7, purpose: "climax", shotType: "ECU", shotCategory: "character-driven", durationSec: 5 },
  { cutNumber: 8, purpose: "resolve", shotType: "WS", shotCategory: "environment", durationSec: 5 },
];

/** 빠른 몽타주 6컷 (총 18초, uniform 3초) */
const FAST_MONTAGE: CutRhythmInput[] = [
  { cutNumber: 1, purpose: "establish", shotType: "WS", shotCategory: "environment", durationSec: 3 },
  { cutNumber: 2, purpose: "develop", shotType: "CU", shotCategory: "object-detail", durationSec: 3 },
  { cutNumber: 3, purpose: "develop", shotType: "MCU", shotCategory: "character-driven", durationSec: 3 },
  { cutNumber: 4, purpose: "climax", shotType: "ECU", shotCategory: "character-driven", durationSec: 3 },
  { cutNumber: 5, purpose: "develop", shotType: "MS", shotCategory: "transition-atmosphere", durationSec: 3 },
  { cutNumber: 6, purpose: "resolve", shotType: "LS", shotCategory: "environment", durationSec: 3 },
];

/** 시네마틱 5컷 (총 40초, uniform 8초) */
const CINEMATIC_SCENE: CutRhythmInput[] = [
  { cutNumber: 1, purpose: "establish", shotType: "WS", shotCategory: "environment", durationSec: 8 },
  { cutNumber: 2, purpose: "develop", shotType: "MS", shotCategory: "character-driven", durationSec: 8 },
  { cutNumber: 3, purpose: "climax", shotType: "CU", shotCategory: "character-driven", durationSec: 8 },
  { cutNumber: 4, purpose: "develop", shotType: "LS", shotCategory: "environment", durationSec: 8 },
  { cutNumber: 5, purpose: "resolve", shotType: "WS", shotCategory: "environment", durationSec: 8 },
];

// ═══════════════════════════════════════════════════════════════════
// A. 총 duration budget 보존
// ═══════════════════════════════════════════════════════════════════

describe("A. 총 duration budget 보존", () => {
  const modes: PacingMode[] = ["fast", "balanced", "cinematic"];

  for (const mode of modes) {
    it(`${mode} 모드: 역사 설명형 총 duration 보존`, () => {
      const result = distributeRhythm(HISTORICAL_EXPLAINER, mode);
      const totalAfter = result.cuts.reduce((s, c) => s + c.durationSec, 0);
      expect(totalAfter).toBe(40);
    });

    it(`${mode} 모드: 빠른 몽타주 총 duration 보존`, () => {
      const result = distributeRhythm(FAST_MONTAGE, mode);
      const totalAfter = result.cuts.reduce((s, c) => s + c.durationSec, 0);
      expect(totalAfter).toBe(18);
    });

    it(`${mode} 모드: 시네마틱 씬 총 duration 보존`, () => {
      const result = distributeRhythm(CINEMATIC_SCENE, mode);
      const totalAfter = result.cuts.reduce((s, c) => s + c.durationSec, 0);
      expect(totalAfter).toBe(40);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// B. Fast / Balanced / Cinematic 리듬 차이
// ═══════════════════════════════════════════════════════════════════

describe("B. 모드별 리듬 프로파일 차이", () => {
  it("세 모드가 서로 다른 duration 분배를 생성", () => {
    const fast = distributeRhythm(HISTORICAL_EXPLAINER, "fast");
    const balanced = distributeRhythm(HISTORICAL_EXPLAINER, "balanced");
    const cinematic = distributeRhythm(HISTORICAL_EXPLAINER, "cinematic");

    // 각 모드의 duration 배열이 동일하지 않아야 함
    const fastDurations = fast.cuts.map(c => c.durationSec);
    const balancedDurations = balanced.cuts.map(c => c.durationSec);
    const cinematicDurations = cinematic.cuts.map(c => c.durationSec);

    expect(fastDurations).not.toEqual(balancedDurations);
    expect(balancedDurations).not.toEqual(cinematicDurations);
  });

  it("cinematic 모드가 더 넓은 duration range를 가짐", () => {
    const balanced = distributeRhythm(CINEMATIC_SCENE, "balanced");
    const cinematic = distributeRhythm(CINEMATIC_SCENE, "cinematic");

    const balancedRange = balanced.profile.maxDuration - balanced.profile.minDuration;
    const cinematicRange = cinematic.profile.maxDuration - cinematic.profile.minDuration;

    expect(cinematicRange).toBeGreaterThanOrEqual(balancedRange);
  });

  it("fast 모드의 max clamp가 5초", () => {
    const result = distributeRhythm(HISTORICAL_EXPLAINER, "fast");
    expect(result.profile.maxDuration).toBeLessThanOrEqual(5);
  });

  it("cinematic 모드의 max clamp가 12초", () => {
    const result = distributeRhythm(CINEMATIC_SCENE, "cinematic");
    expect(result.profile.maxDuration).toBeLessThanOrEqual(12);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. Purpose 기반 가변 분배
// ═══════════════════════════════════════════════════════════════════

describe("C. purpose 기반 가변 분배", () => {
  it("balanced: climax 컷이 develop 컷보다 같거나 길다", () => {
    const result = distributeRhythm(HISTORICAL_EXPLAINER, "balanced");
    const climaxCuts = result.cuts.filter(c => c.purpose === "climax");
    const developCuts = result.cuts.filter(c => c.purpose === "develop");

    const climaxAvg = climaxCuts.reduce((s, c) => s + c.durationSec, 0) / climaxCuts.length;
    const developAvg = developCuts.reduce((s, c) => s + c.durationSec, 0) / developCuts.length;

    expect(climaxAvg).toBeGreaterThanOrEqual(developAvg);
  });

  it("cinematic: establish 컷이 develop 컷보다 길다", () => {
    const result = distributeRhythm(CINEMATIC_SCENE, "cinematic");
    const establishCut = result.cuts.find(c => c.purpose === "establish");
    const developCuts = result.cuts.filter(c => c.purpose === "develop");
    const developAvg = developCuts.reduce((s, c) => s + c.durationSec, 0) / developCuts.length;

    expect(establishCut!.durationSec).toBeGreaterThanOrEqual(developAvg);
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. 리듬 대비 (모든 컷이 같지 않음)
// ═══════════════════════════════════════════════════════════════════

describe("D. 리듬 대비 존재", () => {
  it("balanced 모드에서 stdDev > 0 (모든 컷이 같은 길이가 아님)", () => {
    const result = distributeRhythm(HISTORICAL_EXPLAINER, "balanced");
    expect(result.profile.stdDev).toBeGreaterThan(0);
  });

  it("cinematic 모드에서 stdDev > 0", () => {
    const result = distributeRhythm(CINEMATIC_SCENE, "cinematic");
    expect(result.profile.stdDev).toBeGreaterThan(0);
  });

  it("fast 모드에서도 완전 평준화가 아님", () => {
    // FAST_MONTAGE 사용 (avg 3초, fast clamp 2~5초 → 변동 여지 있음)
    // HISTORICAL_EXPLAINER는 avg 5초 = fast max clamp라 변동 불가
    const result = distributeRhythm(FAST_MONTAGE, "fast");
    const durations = result.cuts.map(c => c.durationSec);
    const unique = new Set(durations);
    // fast에서도 최소 2종류 이상의 duration
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. ShotType/ShotCategory 기반 보정
// ═══════════════════════════════════════════════════════════════════

describe("E. shotType/shotCategory 보정", () => {
  it("WS/environment 컷이 ECU/object-detail 컷보다 길다 (balanced)", () => {
    const cuts: CutRhythmInput[] = [
      { cutNumber: 1, purpose: "develop", shotType: "WS", shotCategory: "environment", durationSec: 5 },
      { cutNumber: 2, purpose: "develop", shotType: "ECU", shotCategory: "object-detail", durationSec: 5 },
    ];
    const result = distributeRhythm(cuts, "balanced");
    expect(result.cuts[0].durationSec).toBeGreaterThan(result.cuts[1].durationSec);
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. Clamp 범위 준수
// ═══════════════════════════════════════════════════════════════════

describe("F. clamp 범위 준수", () => {
  it("fast 모드: 모든 컷 2~5초", () => {
    const result = distributeRhythm(HISTORICAL_EXPLAINER, "fast");
    for (const cut of result.cuts) {
      expect(cut.durationSec).toBeGreaterThanOrEqual(2);
      expect(cut.durationSec).toBeLessThanOrEqual(5);
    }
  });

  it("balanced 모드: 모든 컷 3~8초", () => {
    const result = distributeRhythm(HISTORICAL_EXPLAINER, "balanced");
    for (const cut of result.cuts) {
      expect(cut.durationSec).toBeGreaterThanOrEqual(3);
      expect(cut.durationSec).toBeLessThanOrEqual(8);
    }
  });

  it("cinematic 모드: 모든 컷 3~12초", () => {
    const result = distributeRhythm(CINEMATIC_SCENE, "cinematic");
    for (const cut of result.cuts) {
      expect(cut.durationSec).toBeGreaterThanOrEqual(3);
      expect(cut.durationSec).toBeLessThanOrEqual(12);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// G. 빈 입력 처리
// ═══════════════════════════════════════════════════════════════════

describe("G. edge cases", () => {
  it("빈 cuts 배열 → 빈 결과", () => {
    const result = distributeRhythm([], "balanced");
    expect(result.cuts).toHaveLength(0);
    expect(result.profile.avgDuration).toBe(0);
  });

  it("단일 컷 → duration 유지", () => {
    const cuts: CutRhythmInput[] = [
      { cutNumber: 1, purpose: "establish", shotType: "WS", shotCategory: "environment", durationSec: 10 },
    ];
    const result = distributeRhythm(cuts, "balanced");
    expect(result.cuts[0].durationSec).toBe(10);
  });

  it("purpose 없는 컷 → develop 기본값으로 처리", () => {
    const cuts: CutRhythmInput[] = [
      { cutNumber: 1, durationSec: 5 },
      { cutNumber: 2, purpose: "climax", shotType: "CU", durationSec: 5 },
    ];
    const result = distributeRhythm(cuts, "balanced");
    // climax 컷이 develop(기본값) 컷보다 길어야 함
    expect(result.cuts[1].durationSec).toBeGreaterThanOrEqual(result.cuts[0].durationSec);
  });
});

// ═══════════════════════════════════════════════════════════════════
// H. 콘텐츠 유형별 시나리오 검증
// ═══════════════════════════════════════════════════════════════════

describe("H. 콘텐츠 유형별 시나리오", () => {
  it("역사 설명형 + cinematic: 평균 컷 길이가 3초대로 붕괴하지 않음", () => {
    const result = distributeRhythm(HISTORICAL_EXPLAINER, "cinematic");
    expect(result.profile.avgDuration).toBeGreaterThan(4);
  });

  it("빠른 몽타주 + fast: 여전히 리듬 대비가 존재", () => {
    const result = distributeRhythm(FAST_MONTAGE, "fast");
    // 최소한 2가지 이상의 서로 다른 duration
    const unique = new Set(result.cuts.map(c => c.durationSec));
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });

  it("균형 교육 콘텐츠 + balanced: 유튜브 친화적 range", () => {
    const result = distributeRhythm(HISTORICAL_EXPLAINER, "balanced");
    expect(result.profile.minDuration).toBeGreaterThanOrEqual(3);
    expect(result.profile.maxDuration).toBeLessThanOrEqual(8);
  });
});

// ═══════════════════════════════════════════════════════════════════
// I. RhythmProfile 메타 검증
// ═══════════════════════════════════════════════════════════════════

describe("I. RhythmProfile 메타", () => {
  it("profile.mode가 입력 mode와 일치", () => {
    const result = distributeRhythm(HISTORICAL_EXPLAINER, "cinematic");
    expect(result.profile.mode).toBe("cinematic");
  });

  it("profile.purposeDistribution이 정확", () => {
    const result = distributeRhythm(HISTORICAL_EXPLAINER, "balanced");
    expect(result.profile.purposeDistribution["establish"]).toBe(1);
    expect(result.profile.purposeDistribution["climax"]).toBe(2);
    expect(result.profile.purposeDistribution["resolve"]).toBe(1);
    expect(result.profile.purposeDistribution["develop"]).toBe(4);
  });

  it("profile.description이 비어있지 않음", () => {
    const result = distributeRhythm(FAST_MONTAGE, "fast");
    expect(result.profile.description.length).toBeGreaterThan(0);
  });
});
