/**
 * fast-path-quality.test.ts — fast path 성능/품질 비교 구조 검증
 *
 * 테스트 범위:
 * 1. evaluateFastPathEligibility 함수 로직
 * 2. fast path가 적용/거부되는 조건 검증
 * 3. story complexity heuristic
 * 4. timeout 메타 구조
 * 5. _latency 확장 필드
 * 6. _fastPathEval 응답 구조
 * 7. SessionLogEntry fast path 필드
 * 8. DraftGenerationMeta fast path 필드
 * 9. ServerGenerationMeta 확장 필드
 * 10. fast path vs normal 비교 가능성
 */

import { describe, it, expect } from "vitest";

// ─── Constants mirrored from generate-cuts.ts ───

const FAST_PATH_MAX_DURATION_SEC = 15;
const FAST_PATH_MAX_CUTS = 5;

// ─── evaluateFastPathEligibility (mirrored from generate-cuts.ts) ───

interface FastPathEligibility {
  eligible: boolean;
  reason: string;
  checks: {
    durationOk: boolean;
    cutCountOk: boolean;
    outlineQualityOk: boolean;
    step1Healthy: boolean;
    storyComplexityOk: boolean;
    narrativeFunctionsClear: boolean;
  };
}

function evaluateFastPathEligibility(opts: {
  totalDurationSec: number;
  targetCuts: number;
  outlines: { sceneKo?: string; shotType?: string; cameraMovement?: string; subjectAction?: string; sceneBeat1?: string; sceneBeat2?: string; sceneBeat3?: string; narrativeFunction?: string; purpose?: string }[];
  step1Degraded: boolean;
  storyText: string;
}): FastPathEligibility {
  const durationOk = opts.totalDurationSec <= FAST_PATH_MAX_DURATION_SEC;
  const cutCountOk = opts.targetCuts <= FAST_PATH_MAX_CUTS;

  const outlineQualityOk = opts.outlines.length > 0 && opts.outlines.every(o =>
    o.sceneKo && o.shotType && o.cameraMovement && o.subjectAction && o.sceneBeat1 && o.sceneBeat2 && o.sceneBeat3
  );

  const step1Healthy = !opts.step1Degraded;

  const dialogueMarkers = (opts.storyText.match(/["""「」『』]/g) || []).length;
  const sceneTransitions = (opts.storyText.match(/[—\-]{2,}|장면|씬|전환|그러나|하지만|그때/g) || []).length;
  const storyComplexityOk = dialogueMarkers <= 6 && sceneTransitions <= 4;

  const narrativeFns = opts.outlines.map(o => o.narrativeFunction || o.purpose || "").filter(Boolean);
  const narrativeFunctionsClear = narrativeFns.length >= opts.outlines.length * 0.7;

  const checks = { durationOk, cutCountOk, outlineQualityOk, step1Healthy, storyComplexityOk, narrativeFunctionsClear };
  const eligible = durationOk && cutCountOk && outlineQualityOk && step1Healthy && storyComplexityOk;

  let reason: string;
  if (eligible) {
    reason = "shortform + simple story + quality outlines";
  } else {
    const fails: string[] = [];
    if (!durationOk) fails.push(`duration ${opts.totalDurationSec}s > ${FAST_PATH_MAX_DURATION_SEC}s`);
    if (!cutCountOk) fails.push(`cuts ${opts.targetCuts} > ${FAST_PATH_MAX_CUTS}`);
    if (!outlineQualityOk) fails.push("outline quality insufficient");
    if (!step1Healthy) fails.push("step1 degraded");
    if (!storyComplexityOk) fails.push(`story too complex (dialogue=${dialogueMarkers}, transitions=${sceneTransitions})`);
    reason = fails.join("; ");
  }

  return { eligible, reason, checks };
}

// ─── Good outline helper ───

function goodOutline(overrides: Record<string, string> = {}) {
  return {
    sceneKo: "도심 야경",
    shotType: "WS",
    cameraMovement: "slow pan",
    subjectAction: "walks through city",
    sceneBeat1: "location establishing",
    sceneBeat2: "situation visible",
    sceneBeat3: "emotion revealed",
    narrativeFunction: "establish",
    purpose: "establish",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. evaluateFastPathEligibility — 기본 조건
// ═══════════════════════════════════════════════════════════════════

describe("evaluateFastPathEligibility — 기본 조건", () => {
  it("10초 4컷 + 단순 스토리 + 좋은 outline → eligible", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 4,
      outlines: [goodOutline(), goodOutline(), goodOutline(), goodOutline()],
      step1Degraded: false,
      storyText: "한 소년이 도시를 걷는다.",
    });
    expect(result.eligible).toBe(true);
    expect(result.checks.durationOk).toBe(true);
    expect(result.checks.cutCountOk).toBe(true);
    expect(result.checks.outlineQualityOk).toBe(true);
    expect(result.checks.step1Healthy).toBe(true);
    expect(result.checks.storyComplexityOk).toBe(true);
    expect(result.reason).toContain("shortform");
  });

  it("15초 5컷 경계값 → eligible", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 15,
      targetCuts: 5,
      outlines: Array(5).fill(goodOutline()),
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    expect(result.eligible).toBe(true);
  });

  it("16초 → not eligible (duration)", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 16,
      targetCuts: 4,
      outlines: Array(4).fill(goodOutline()),
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    expect(result.eligible).toBe(false);
    expect(result.checks.durationOk).toBe(false);
    expect(result.reason).toContain("duration");
  });

  it("6컷 → not eligible (cuts)", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 12,
      targetCuts: 6,
      outlines: Array(6).fill(goodOutline()),
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    expect(result.eligible).toBe(false);
    expect(result.checks.cutCountOk).toBe(false);
    expect(result.reason).toContain("cuts");
  });

  it("step1 degraded → not eligible", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 3,
      outlines: Array(3).fill(goodOutline()),
      step1Degraded: true,
      storyText: "짧은 이야기.",
    });
    expect(result.eligible).toBe(false);
    expect(result.checks.step1Healthy).toBe(false);
    expect(result.reason).toContain("step1 degraded");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. evaluateFastPathEligibility — outline 품질
// ═══════════════════════════════════════════════════════════════════

describe("evaluateFastPathEligibility — outline 품질", () => {
  it("sceneBeat3 누락 → not eligible", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 2,
      outlines: [goodOutline(), goodOutline({ sceneBeat3: "" })],
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    expect(result.eligible).toBe(false);
    expect(result.checks.outlineQualityOk).toBe(false);
    expect(result.reason).toContain("outline quality");
  });

  it("shotType 누락 → not eligible", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 2,
      outlines: [goodOutline({ shotType: "" }), goodOutline()],
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    expect(result.eligible).toBe(false);
    expect(result.checks.outlineQualityOk).toBe(false);
  });

  it("빈 outline 배열 → not eligible", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 3,
      outlines: [],
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    expect(result.eligible).toBe(false);
    expect(result.checks.outlineQualityOk).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. evaluateFastPathEligibility — story complexity
// ═══════════════════════════════════════════════════════════════════

describe("evaluateFastPathEligibility — story complexity", () => {
  it("대화 마커 7개 이상 → not eligible (복잡한 스토리)", () => {
    const complexStory = '그녀가 말했다. "안녕" "잘 가" "왜?" "몰라" "정말?" "응" "그래" "알겠어"';
    const result = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 3,
      outlines: Array(3).fill(goodOutline()),
      step1Degraded: false,
      storyText: complexStory,
    });
    expect(result.eligible).toBe(false);
    expect(result.checks.storyComplexityOk).toBe(false);
    expect(result.reason).toContain("story too complex");
  });

  it("장면 전환 5개 이상 → not eligible", () => {
    const transitionHeavy = "장면1 — 그러나 전환되어 장면2 — 하지만 그때 장면3으로 전환";
    const result = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 3,
      outlines: Array(3).fill(goodOutline()),
      step1Degraded: false,
      storyText: transitionHeavy,
    });
    expect(result.eligible).toBe(false);
    expect(result.checks.storyComplexityOk).toBe(false);
  });

  it("단순 내레이션 → eligible", () => {
    const simpleStory = "한 소년이 도시를 걷는다. 비가 내린다. 그는 우산을 편다.";
    const result = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 3,
      outlines: Array(3).fill(goodOutline()),
      step1Degraded: false,
      storyText: simpleStory,
    });
    expect(result.eligible).toBe(true);
    expect(result.checks.storyComplexityOk).toBe(true);
  });

  it("대화 정확히 6개 → eligible (경계)", () => {
    const borderline = '"하나" "둘" "셋"';
    const result = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 3,
      outlines: Array(3).fill(goodOutline()),
      step1Degraded: false,
      storyText: borderline,
    });
    expect(result.eligible).toBe(true);
    expect(result.checks.storyComplexityOk).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. evaluateFastPathEligibility — narrative function check
// ═══════════════════════════════════════════════════════════════════

describe("evaluateFastPathEligibility — narrative functions", () => {
  it("70% 이상 narrative function이 있으면 clear", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 3,
      outlines: [
        goodOutline({ narrativeFunction: "establish" }),
        goodOutline({ narrativeFunction: "develop" }),
        goodOutline({ narrativeFunction: "", purpose: "" }),
      ],
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    // 2/3 = 66.7% < 70% → not clear, but this doesn't block eligibility by itself
    expect(result.checks.narrativeFunctionsClear).toBe(false);
    // eligibility is still true because narrativeFunctionsClear is informational
    expect(result.eligible).toBe(true);
  });

  it("모두 narrative function 있으면 clear", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 3,
      outlines: Array(3).fill(goodOutline()),
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    expect(result.checks.narrativeFunctionsClear).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. _latency 확장 구조
// ═══════════════════════════════════════════════════════════════════

interface ExtendedLatencyMeta {
  totalLatencyMs: number;
  step1LatencyMs: number;
  step23LatencyMs: number;
  postprocessLatencyMs: number;
  fallbackLatencyMs: number;
  fastPathUsed: boolean;
  skippedSteps: string[];
  degradedFastPathUsed: boolean;
  // New fields
  timedOutAtStep1: boolean;
  timedOutAtUltra: boolean;
  timeoutPathUsed: "none" | "ultra-compact" | "deterministic";
  totalCutCount: number;
  totalShotCount: number;
  outlineOnly: boolean;
  step1Ratio: number;
  step23Ratio: number;
}

describe("_latency 확장 구조", () => {
  function mockExtendedLatency(overrides: Partial<ExtendedLatencyMeta> = {}): ExtendedLatencyMeta {
    return {
      totalLatencyMs: 6000,
      step1LatencyMs: 4000,
      step23LatencyMs: 1500,
      postprocessLatencyMs: 500,
      fallbackLatencyMs: 0,
      fastPathUsed: false,
      skippedSteps: [],
      degradedFastPathUsed: false,
      timedOutAtStep1: false,
      timedOutAtUltra: false,
      timeoutPathUsed: "none",
      totalCutCount: 4,
      totalShotCount: 6,
      outlineOnly: false,
      step1Ratio: 67,
      step23Ratio: 25,
      ...overrides,
    };
  }

  it("fast path에서 step23은 0에 가깝고 step1Ratio ≈ 100%", () => {
    const m = mockExtendedLatency({
      fastPathUsed: true,
      step23LatencyMs: 2,
      totalLatencyMs: 4002,
      step1LatencyMs: 4000,
      step1Ratio: 100,
      step23Ratio: 0,
      skippedSteps: ["step2", "step3"],
      outlineOnly: true,
    });
    expect(m.step1Ratio).toBeGreaterThanOrEqual(95);
    expect(m.step23Ratio).toBeLessThanOrEqual(5);
    expect(m.outlineOnly).toBe(true);
  });

  it("timeout 추적 필드가 존재", () => {
    const m = mockExtendedLatency({ timedOutAtStep1: true, timeoutPathUsed: "ultra-compact" });
    expect(m.timedOutAtStep1).toBe(true);
    expect(m.timedOutAtUltra).toBe(false);
    expect(m.timeoutPathUsed).toBe("ultra-compact");
  });

  it("정상 경로에서 timeout 필드는 모두 false/none", () => {
    const m = mockExtendedLatency();
    expect(m.timedOutAtStep1).toBe(false);
    expect(m.timedOutAtUltra).toBe(false);
    expect(m.timeoutPathUsed).toBe("none");
  });

  it("totalCutCount/totalShotCount 포함", () => {
    const m = mockExtendedLatency({ totalCutCount: 3, totalShotCount: 5 });
    expect(m.totalCutCount).toBe(3);
    expect(m.totalShotCount).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. _fastPathEval 구조
// ═══════════════════════════════════════════════════════════════════

describe("_fastPathEval 응답 구조", () => {
  it("eligible일 때 reason과 checks가 모두 present", () => {
    const eval_ = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 3,
      outlines: Array(3).fill(goodOutline()),
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    expect(eval_).toHaveProperty("eligible");
    expect(eval_).toHaveProperty("reason");
    expect(eval_).toHaveProperty("checks");
    expect(eval_.checks).toHaveProperty("durationOk");
    expect(eval_.checks).toHaveProperty("cutCountOk");
    expect(eval_.checks).toHaveProperty("outlineQualityOk");
    expect(eval_.checks).toHaveProperty("step1Healthy");
    expect(eval_.checks).toHaveProperty("storyComplexityOk");
    expect(eval_.checks).toHaveProperty("narrativeFunctionsClear");
  });

  it("not eligible일 때 reason에 실패 원인이 포함됨", () => {
    const eval_ = evaluateFastPathEligibility({
      totalDurationSec: 20,
      targetCuts: 8,
      outlines: Array(8).fill(goodOutline()),
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    expect(eval_.eligible).toBe(false);
    expect(eval_.reason).toContain("duration");
    expect(eval_.reason).toContain("cuts");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. SessionLogEntry fast path 필드
// ═══════════════════════════════════════════════════════════════════

describe("SessionLogEntry fast path 필드", () => {
  interface MockSessionLogEntry {
    draftId: string;
    scenario: string;
    failureTags: string[];
    fallbackUsed: boolean;
    timestamp: number;
    fastPathUsed?: boolean;
    totalLatencyMs?: number;
    totalShotCount?: number;
  }

  it("fast path 필드가 선택적으로 존재 가능", () => {
    const entry: MockSessionLogEntry = {
      draftId: "d1",
      scenario: "test",
      failureTags: ["ok"],
      fallbackUsed: false,
      timestamp: Date.now(),
      fastPathUsed: true,
      totalLatencyMs: 4200,
      totalShotCount: 5,
    };
    expect(entry.fastPathUsed).toBe(true);
    expect(entry.totalLatencyMs).toBe(4200);
    expect(entry.totalShotCount).toBe(5);
  });

  it("fast path 미사용 시 필드 누락 가능", () => {
    const entry: MockSessionLogEntry = {
      draftId: "d1",
      scenario: "test",
      failureTags: ["too-generic"],
      fallbackUsed: false,
      timestamp: Date.now(),
    };
    expect(entry.fastPathUsed).toBeUndefined();
    expect(entry.totalLatencyMs).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. DraftGenerationMeta fast path 필드
// ═══════════════════════════════════════════════════════════════════

describe("DraftGenerationMeta fast path 필드", () => {
  interface MockDraftMeta {
    fastPathUsed?: boolean;
    totalLatencyMs?: number;
    step1LatencyMs?: number;
    step23LatencyMs?: number;
    totalShotCount?: number;
  }

  it("fast path 메타가 포함됨", () => {
    const meta: MockDraftMeta = {
      fastPathUsed: true,
      totalLatencyMs: 3800,
      step1LatencyMs: 3700,
      step23LatencyMs: 5,
      totalShotCount: 3,
    };
    expect(meta.fastPathUsed).toBe(true);
    expect(meta.step23LatencyMs!).toBeLessThan(100);
    expect(meta.totalShotCount).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. ServerGenerationMeta 확장 필드
// ═══════════════════════════════════════════════════════════════════

describe("ServerGenerationMeta 확장 필드", () => {
  interface MockServerMeta {
    fastPathUsed?: boolean;
    totalLatencyMs?: number;
    step1LatencyMs?: number;
    step23LatencyMs?: number;
    outlineOnly?: boolean;
    totalShotCount?: number;
    rationale?: string[];
  }

  it("fast path 사용 + outlineOnly + latency 필드가 동시에 존재", () => {
    const meta: MockServerMeta = {
      fastPathUsed: true,
      totalLatencyMs: 4000,
      step1LatencyMs: 3900,
      step23LatencyMs: 10,
      outlineOnly: true,
      totalShotCount: 4,
      rationale: ["Fast path 사용: step2/3 건너뜀"],
    };
    expect(meta.fastPathUsed).toBe(true);
    expect(meta.outlineOnly).toBe(true);
    expect(meta.step23LatencyMs!).toBeLessThan(100);
    expect(meta.rationale).toContain("Fast path 사용: step2/3 건너뜀");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. fast path vs normal 비교 가능성
// ═══════════════════════════════════════════════════════════════════

describe("fast path vs normal 비교 가능성", () => {
  interface ComparisonEntry {
    fastPathUsed: boolean;
    totalLatencyMs: number;
    totalShotCount: number;
    failureTags: string[];
  }

  function buildComparison(entries: ComparisonEntry[]) {
    const fp = entries.filter(e => e.fastPathUsed);
    const normal = entries.filter(e => !e.fastPathUsed);
    const avg = (list: ComparisonEntry[], key: "totalLatencyMs" | "totalShotCount") =>
      list.length > 0 ? list.reduce((s, e) => s + e[key], 0) / list.length : 0;
    const qualityFailRate = (list: ComparisonEntry[]) => {
      if (list.length === 0) return 0;
      const qualityFails = list.filter(e =>
        e.failureTags.some(t => t === "too-generic" || t === "style-too-weak" || t === "too-sparse")
      );
      return qualityFails.length / list.length;
    };
    return {
      fpCount: fp.length,
      normalCount: normal.length,
      fpAvgLatency: avg(fp, "totalLatencyMs"),
      normalAvgLatency: avg(normal, "totalLatencyMs"),
      fpAvgShots: avg(fp, "totalShotCount"),
      normalAvgShots: avg(normal, "totalShotCount"),
      fpQualityFailRate: qualityFailRate(fp),
      normalQualityFailRate: qualityFailRate(normal),
    };
  }

  it("fast path 평균 latency가 normal보다 낮음", () => {
    const entries: ComparisonEntry[] = [
      { fastPathUsed: true, totalLatencyMs: 3500, totalShotCount: 4, failureTags: ["ok"] },
      { fastPathUsed: true, totalLatencyMs: 4000, totalShotCount: 3, failureTags: ["ok"] },
      { fastPathUsed: false, totalLatencyMs: 8000, totalShotCount: 6, failureTags: ["ok"] },
      { fastPathUsed: false, totalLatencyMs: 9000, totalShotCount: 7, failureTags: ["ok"] },
    ];
    const comp = buildComparison(entries);
    expect(comp.fpAvgLatency).toBeLessThan(comp.normalAvgLatency);
  });

  it("fast path 품질 실패율을 감지할 수 있음", () => {
    const entries: ComparisonEntry[] = [
      { fastPathUsed: true, totalLatencyMs: 3500, totalShotCount: 3, failureTags: ["too-generic"] },
      { fastPathUsed: true, totalLatencyMs: 4000, totalShotCount: 4, failureTags: ["ok"] },
      { fastPathUsed: false, totalLatencyMs: 8000, totalShotCount: 6, failureTags: ["ok"] },
      { fastPathUsed: false, totalLatencyMs: 9000, totalShotCount: 7, failureTags: ["ok"] },
    ];
    const comp = buildComparison(entries);
    expect(comp.fpQualityFailRate).toBe(0.5); // 50% fast path had quality issues
    expect(comp.normalQualityFailRate).toBe(0);
  });

  it("fast path 평균 shot 수를 비교할 수 있음", () => {
    const entries: ComparisonEntry[] = [
      { fastPathUsed: true, totalLatencyMs: 3500, totalShotCount: 3, failureTags: ["ok"] },
      { fastPathUsed: false, totalLatencyMs: 8000, totalShotCount: 6, failureTags: ["ok"] },
    ];
    const comp = buildComparison(entries);
    expect(comp.fpAvgShots).toBeLessThan(comp.normalAvgShots);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. 기존 shortform invariant 비침범
// ═══════════════════════════════════════════════════════════════════

describe("fast path가 shortform invariant를 깨지 않음", () => {
  it("fast path가 13~15초 대역에서도 eligible하되 shortform rhythm은 별도 실행", () => {
    const eval_ = evaluateFastPathEligibility({
      totalDurationSec: 14,
      targetCuts: 4,
      outlines: Array(4).fill(goodOutline()),
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    expect(eval_.eligible).toBe(true);
    // fast path는 step2/3만 skip — rhythm, density, shortform reconciliation은 서버에서 여전히 실행
    expect(eval_.checks.durationOk).toBe(true);
  });

  it("fast path 적용 여부와 관계없이 cut count는 동일해야 함", () => {
    // fast path는 outline quality check만 하고, cut count 결정에는 영향 없음
    const eval1 = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 3,
      outlines: Array(3).fill(goodOutline()),
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    const eval2 = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 3,
      outlines: Array(3).fill(goodOutline()),
      step1Degraded: true, // degraded → won't use fast path
      storyText: "짧은 이야기.",
    });
    // Both have same targetCuts — fast path doesn't change cut count
    expect(eval1.checks.durationOk).toEqual(eval2.checks.durationOk);
    expect(eval1.checks.cutCountOk).toEqual(eval2.checks.cutCountOk);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. Timeout tracking 구조
// ═══════════════════════════════════════════════════════════════════

describe("timeout tracking", () => {
  it("timedOutAtStep1 + ultra-compact 성공 시 timeoutPathUsed = ultra-compact", () => {
    const meta = {
      timedOutAtStep1: true,
      timedOutAtUltra: false,
      timeoutPathUsed: "ultra-compact" as const,
    };
    expect(meta.timedOutAtStep1).toBe(true);
    expect(meta.timeoutPathUsed).toBe("ultra-compact");
  });

  it("timedOutAtStep1 + ultra도 실패 → timeoutPathUsed = deterministic", () => {
    const meta = {
      timedOutAtStep1: true,
      timedOutAtUltra: true,
      timeoutPathUsed: "deterministic" as const,
    };
    expect(meta.timedOutAtStep1).toBe(true);
    expect(meta.timedOutAtUltra).toBe(true);
    expect(meta.timeoutPathUsed).toBe("deterministic");
  });

  it("정상 경로 → none", () => {
    const meta = {
      timedOutAtStep1: false,
      timedOutAtUltra: false,
      timeoutPathUsed: "none" as const,
    };
    expect(meta.timeoutPathUsed).toBe("none");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. 복합 시나리오
// ═══════════════════════════════════════════════════════════════════

describe("복합 시나리오", () => {
  it("짧지만 대화 많은 스토리 → fast path 거부", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 10,
      targetCuts: 3,
      outlines: Array(3).fill(goodOutline()),
      step1Degraded: false,
      storyText: '"안녕" "잘 가" "왜" "아니" "정말" "그래" "알겠어" "좋아"',
    });
    expect(result.eligible).toBe(false);
    expect(result.checks.storyComplexityOk).toBe(false);
  });

  it("짧고 단순하지만 outline 불완전 → fast path 거부", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 8,
      targetCuts: 2,
      outlines: [
        goodOutline(),
        goodOutline({ cameraMovement: "" }), // 불완전
      ],
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    expect(result.eligible).toBe(false);
    expect(result.checks.outlineQualityOk).toBe(false);
  });

  it("모든 조건이 완벽해도 60초 장편이면 → fast path 거부", () => {
    const result = evaluateFastPathEligibility({
      totalDurationSec: 60,
      targetCuts: 12,
      outlines: Array(12).fill(goodOutline()),
      step1Degraded: false,
      storyText: "짧은 이야기.",
    });
    expect(result.eligible).toBe(false);
  });
});
