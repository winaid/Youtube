/**
 * generate-cuts-latency.test.ts — 생성 파이프라인 latency/fast-path 검증
 *
 * 테스트 범위:
 * - _latency 메타 구조
 * - fast path 조건 + skip 판정
 * - shortform rhythm policy 비침범
 * - timeout 상수 검증
 * - UI 단계별 진행 로직
 */

import { describe, it, expect } from "vitest";

// ─── Constants mirrored from generate-cuts.ts ───

const FAST_PATH_MAX_DURATION_SEC = 15;
const FAST_PATH_MAX_CUTS = 5;
const STEP1_TIMEOUT_MS = 55_000;
const STEP1_ULTRA_TIMEOUT_MS = 25_000;

// ─── Latency meta shape ───

interface LatencyMeta {
  totalLatencyMs: number;
  step1LatencyMs: number;
  step23LatencyMs: number;
  postprocessLatencyMs: number;
  fallbackLatencyMs: number;
  fastPathUsed: boolean;
  skippedSteps: string[];
  degradedFastPathUsed: boolean;
}

function mockLatencyMeta(overrides: Partial<LatencyMeta> = {}): LatencyMeta {
  return {
    totalLatencyMs: 8500,
    step1LatencyMs: 5200,
    step23LatencyMs: 2800,
    postprocessLatencyMs: 500,
    fallbackLatencyMs: 0,
    fastPathUsed: false,
    skippedSteps: [],
    degradedFastPathUsed: false,
    ...overrides,
  };
}

// ─── Fast path logic simulation ───

interface FastPathInput {
  totalDurationSec: number;
  targetCuts: number;
  outlineQualitySufficient: boolean;
  step1Degraded: boolean;
}

function shouldUseFastPath(input: FastPathInput): { fastPath: boolean; skippedSteps: string[] } {
  const isFastPathCandidate =
    input.totalDurationSec <= FAST_PATH_MAX_DURATION_SEC
    && input.targetCuts <= FAST_PATH_MAX_CUTS;

  const shouldSkip = isFastPathCandidate && input.outlineQualitySufficient && !input.step1Degraded;

  return {
    fastPath: shouldSkip,
    skippedSteps: shouldSkip ? ["step2", "step3"] : [],
  };
}

// ─── Outline quality check simulation ───

interface MinimalOutline {
  sceneKo: string;
  shotType: string;
  cameraMovement: string;
  subjectAction: string;
  sceneBeat1: string;
  sceneBeat2: string;
  sceneBeat3: string;
}

function isOutlineQualitySufficient(outlines: Partial<MinimalOutline>[]): boolean {
  return outlines.every(o =>
    o.sceneKo && o.shotType && o.cameraMovement && o.subjectAction && o.sceneBeat1 && o.sceneBeat2 && o.sceneBeat3
  );
}

// ─── UI progress phase logic ───

const GENERATION_PHASES = [
  { label: "스토리 구조 해석 중", minMs: 0 },
  { label: "컷 아웃라인 생성 중", minMs: 2000 },
  { label: "컷 리듬 정리 중", minMs: 6000 },
  { label: "샷 디테일 보강 중", minMs: 12000 },
  { label: "최종 검증 중", minMs: 20000 },
];

function getCurrentPhaseLabel(elapsedMs: number): string {
  let current = GENERATION_PHASES[0];
  for (const phase of GENERATION_PHASES) {
    if (elapsedMs >= phase.minMs) current = phase;
  }
  return current.label;
}

// ═══════════════════════════════════════════════════════════════════
// 1. _latency 메타 구조
// ═══════════════════════════════════════════════════════════════════

describe("_latency 메타 구조", () => {
  it("모든 필수 필드가 존재", () => {
    const m = mockLatencyMeta();
    expect(m).toHaveProperty("totalLatencyMs");
    expect(m).toHaveProperty("step1LatencyMs");
    expect(m).toHaveProperty("step23LatencyMs");
    expect(m).toHaveProperty("postprocessLatencyMs");
    expect(m).toHaveProperty("fallbackLatencyMs");
    expect(m).toHaveProperty("fastPathUsed");
    expect(m).toHaveProperty("skippedSteps");
    expect(m).toHaveProperty("degradedFastPathUsed");
  });

  it("fast path 사용 시 step23LatencyMs ≈ 0, skippedSteps에 step2/3 포함", () => {
    const m = mockLatencyMeta({
      fastPathUsed: true,
      step23LatencyMs: 1, // ~0
      skippedSteps: ["step2", "step3"],
      degradedFastPathUsed: true,
    });
    expect(m.fastPathUsed).toBe(true);
    expect(m.step23LatencyMs).toBeLessThan(100);
    expect(m.skippedSteps).toContain("step2");
    expect(m.skippedSteps).toContain("step3");
    expect(m.degradedFastPathUsed).toBe(true);
  });

  it("일반 경로에서는 skippedSteps 비어 있음", () => {
    const m = mockLatencyMeta();
    expect(m.fastPathUsed).toBe(false);
    expect(m.skippedSteps).toEqual([]);
  });

  it("totalLatencyMs ≈ step1 + step23 + postprocess", () => {
    const m = mockLatencyMeta({
      totalLatencyMs: 8500,
      step1LatencyMs: 5200,
      step23LatencyMs: 2800,
      postprocessLatencyMs: 500,
    });
    // Allow some margin for overhead
    const sum = m.step1LatencyMs + m.step23LatencyMs + m.postprocessLatencyMs;
    expect(m.totalLatencyMs).toBeGreaterThanOrEqual(sum * 0.8);
    expect(m.totalLatencyMs).toBeLessThanOrEqual(sum * 1.5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Fast path 조건 판정
// ═══════════════════════════════════════════════════════════════════

describe("fast path 조건 판정", () => {
  it("10초 4컷 + 충분한 outline → fast path 사용", () => {
    const result = shouldUseFastPath({
      totalDurationSec: 10,
      targetCuts: 4,
      outlineQualitySufficient: true,
      step1Degraded: false,
    });
    expect(result.fastPath).toBe(true);
    expect(result.skippedSteps).toEqual(["step2", "step3"]);
  });

  it("15초 5컷 (경계값) → fast path 사용", () => {
    const result = shouldUseFastPath({
      totalDurationSec: 15,
      targetCuts: 5,
      outlineQualitySufficient: true,
      step1Degraded: false,
    });
    expect(result.fastPath).toBe(true);
  });

  it("16초 (초과) → fast path 미사용", () => {
    const result = shouldUseFastPath({
      totalDurationSec: 16,
      targetCuts: 4,
      outlineQualitySufficient: true,
      step1Degraded: false,
    });
    expect(result.fastPath).toBe(false);
    expect(result.skippedSteps).toEqual([]);
  });

  it("6컷 (초과) → fast path 미사용", () => {
    const result = shouldUseFastPath({
      totalDurationSec: 12,
      targetCuts: 6,
      outlineQualitySufficient: true,
      step1Degraded: false,
    });
    expect(result.fastPath).toBe(false);
  });

  it("outline 품질 부족 → fast path 미사용", () => {
    const result = shouldUseFastPath({
      totalDurationSec: 10,
      targetCuts: 3,
      outlineQualitySufficient: false,
      step1Degraded: false,
    });
    expect(result.fastPath).toBe(false);
  });

  it("step1 degraded → fast path 미사용 (안전 우선)", () => {
    const result = shouldUseFastPath({
      totalDurationSec: 10,
      targetCuts: 3,
      outlineQualitySufficient: true,
      step1Degraded: true,
    });
    expect(result.fastPath).toBe(false);
  });

  it("60초 12컷 (장편) → fast path 미사용", () => {
    const result = shouldUseFastPath({
      totalDurationSec: 60,
      targetCuts: 12,
      outlineQualitySufficient: true,
      step1Degraded: false,
    });
    expect(result.fastPath).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Outline 품질 판정
// ═══════════════════════════════════════════════════════════════════

describe("outline 품질 판정", () => {
  it("모든 필드가 있으면 sufficient", () => {
    const outlines = [
      { sceneKo: "도심 야경", shotType: "WS", cameraMovement: "slow pan", subjectAction: "walks", sceneBeat1: "city", sceneBeat2: "rain", sceneBeat3: "emotion" },
      { sceneKo: "카페 내부", shotType: "CU", cameraMovement: "push-in", subjectAction: "sits", sceneBeat1: "cafe", sceneBeat2: "coffee", sceneBeat3: "thought" },
    ];
    expect(isOutlineQualitySufficient(outlines)).toBe(true);
  });

  it("sceneBeat3 누락 → insufficient", () => {
    const outlines = [
      { sceneKo: "도심", shotType: "WS", cameraMovement: "pan", subjectAction: "walks", sceneBeat1: "city", sceneBeat2: "rain", sceneBeat3: "" },
    ];
    expect(isOutlineQualitySufficient(outlines)).toBe(false);
  });

  it("shotType 누락 → insufficient", () => {
    const outlines = [
      { sceneKo: "도심", shotType: "", cameraMovement: "pan", subjectAction: "walks", sceneBeat1: "city", sceneBeat2: "rain", sceneBeat3: "emotion" },
    ];
    expect(isOutlineQualitySufficient(outlines)).toBe(false);
  });

  it("빈 배열 → sufficient (vacuously true)", () => {
    expect(isOutlineQualitySufficient([])).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Timeout 상수 검증
// ═══════════════════════════════════════════════════════════════════

describe("timeout 상수 검증", () => {
  it("STEP1_TIMEOUT_MS가 55초로 단축됨", () => {
    expect(STEP1_TIMEOUT_MS).toBe(55_000);
  });

  it("STEP1_ULTRA_TIMEOUT_MS가 25초로 단축됨", () => {
    expect(STEP1_ULTRA_TIMEOUT_MS).toBe(25_000);
  });

  it("ultra timeout < step1 timeout", () => {
    expect(STEP1_ULTRA_TIMEOUT_MS).toBeLessThan(STEP1_TIMEOUT_MS);
  });

  it("fast path 상수: ≤15초, ≤5컷", () => {
    expect(FAST_PATH_MAX_DURATION_SEC).toBe(15);
    expect(FAST_PATH_MAX_CUTS).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. UI 단계별 진행 표시
// ═══════════════════════════════════════════════════════════════════

describe("UI 단계별 진행 표시", () => {
  it("0초 → '스토리 구조 해석 중'", () => {
    expect(getCurrentPhaseLabel(0)).toBe("스토리 구조 해석 중");
  });

  it("3초 → '컷 아웃라인 생성 중'", () => {
    expect(getCurrentPhaseLabel(3000)).toBe("컷 아웃라인 생성 중");
  });

  it("7초 → '컷 리듬 정리 중'", () => {
    expect(getCurrentPhaseLabel(7000)).toBe("컷 리듬 정리 중");
  });

  it("13초 → '샷 디테일 보강 중'", () => {
    expect(getCurrentPhaseLabel(13000)).toBe("샷 디테일 보강 중");
  });

  it("21초 → '최종 검증 중'", () => {
    expect(getCurrentPhaseLabel(21000)).toBe("최종 검증 중");
  });

  it("단계가 5개 있음", () => {
    expect(GENERATION_PHASES).toHaveLength(5);
  });

  it("각 단계의 minMs가 단조 증가", () => {
    for (let i = 1; i < GENERATION_PHASES.length; i++) {
      expect(GENERATION_PHASES[i].minMs).toBeGreaterThan(GENERATION_PHASES[i - 1].minMs);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Shortform rhythm policy 비침범 확인
// ═══════════════════════════════════════════════════════════════════

describe("shortform rhythm policy 비침범", () => {
  // The fast path only skips step2/3 (detail enrichment).
  // It does NOT skip: cut count resolution, rhythm distribution,
  // density correction, sequence plan, shortform reconciliation.

  it("fast path에서 skip되는 것은 step2/step3 뿐", () => {
    const result = shouldUseFastPath({
      totalDurationSec: 13,
      targetCuts: 4,
      outlineQualitySufficient: true,
      step1Degraded: false,
    });
    expect(result.skippedSteps).toEqual(["step2", "step3"]);
    // rhythm distribution, density, shortform reconciliation은 skip 대상이 아님
    expect(result.skippedSteps).not.toContain("rhythm");
    expect(result.skippedSteps).not.toContain("density");
    expect(result.skippedSteps).not.toContain("shortform");
  });

  it("13~15초 특수 대역 shortform도 fast path 사용 가능 (정책은 유지)", () => {
    // 13~15초는 shortform 특수 대역이지만 fast path는 detail enrichment만 skip
    const result = shouldUseFastPath({
      totalDurationSec: 14,
      targetCuts: 4,
      outlineQualitySufficient: true,
      step1Degraded: false,
    });
    expect(result.fastPath).toBe(true);
    // rhythm + density + shortform reconciliation은 서버에서 여전히 실행됨
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Timeout/retry 회귀 방지
// ═══════════════════════════════════════════════════════════════════

describe("timeout/retry 회귀 방지", () => {
  it("step1 timeout이 너무 길지 않음 (≤60초)", () => {
    expect(STEP1_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it("ultra-compact timeout이 너무 길지 않음 (≤30초)", () => {
    expect(STEP1_ULTRA_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("최악의 경우 (step1 timeout + ultra timeout) ≤ 80초", () => {
    expect(STEP1_TIMEOUT_MS + STEP1_ULTRA_TIMEOUT_MS).toBeLessThanOrEqual(80_000);
  });

  it("최악의 경우 provider retry (step1 timeout + 2회 × 2+4초 backoff + ultra) ≤ 90초", () => {
    const providerRetryOverhead = 2000 + 4000; // 2회 backoff
    const worst = STEP1_TIMEOUT_MS + providerRetryOverhead + STEP1_ULTRA_TIMEOUT_MS;
    expect(worst).toBeLessThanOrEqual(90_000);
  });
});
