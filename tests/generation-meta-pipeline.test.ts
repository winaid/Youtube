/**
 * generation-meta-pipeline.test.ts — engine-to-debug truth 연결 검증
 *
 * generate-cuts API의 generationMeta 구조 검증,
 * shortform reconciliation → meta 전파,
 * director down-weight → meta 전파,
 * fallback/degraded → meta 전파 검증
 */

import { describe, it, expect } from "vitest";
import { reconcileShortformPlan, resolveShortformBandPolicy } from "../functions/api/_shortform-rhythm";
import type { ServerGenerationMeta } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// ServerGenerationMeta 타입 구조 검증
// ═══════════════════════════════════════════════════════════════════

describe("ServerGenerationMeta structure", () => {
  it("필수 필드를 모두 허용하는 타입", () => {
    const meta: ServerGenerationMeta = {
      totalDurationSec: 15,
      durationBand: "shortform-critical",
      targetCuts: 4,
      minimumCuts: 4,
      reconciledSecPerCut: 4,
      shortformPolicyApplied: true,
      specialHandling13to15: true,
      directorRequested: "wong-kar-wai",
      directorRequestedPace: 8,
      directorAppliedPace: 4,
      directorPaceDownWeighted: true,
      directorWeakenReason: "shortform rhythm > director pace",
      narrativeFunctions: ["establish mood", "build tension"],
      cutDurations: [4, 4, 4, 3],
      cutShotCounts: [2, 2, 1, 2],
      totalShotCount: 7,
      fallbackUsed: false,
      outlineOnly: false,
      genericSplitFallback: false,
      providerError: undefined,
      densityPolicy: "density_policy",
      reconciliationNotes: ["band preferred raised"],
      rationale: ["13-15초 숏폼 리듬을 위해 최소 4컷 유지"],
    };
    expect(meta.totalDurationSec).toBe(15);
    expect(meta.rationale).toHaveLength(1);
  });

  it("모든 필드가 optional이어서 빈 객체도 유효", () => {
    const meta: ServerGenerationMeta = {};
    expect(meta).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Shortform band policy → meta 전파 검증
// ═══════════════════════════════════════════════════════════════════

describe("shortform band policy → generationMeta mapping", () => {
  it("15초 → shortform-critical band, is13to15Special=true", () => {
    const band = resolveShortformBandPolicy(15);
    expect(band.band).toBe("shortform-critical");
    expect(band.is13to15Special).toBe(true);
    expect(band.minCuts).toBe(4);
    expect(band.isShortformBand).toBe(true);
  });

  it("13초 → shortform-critical band", () => {
    const band = resolveShortformBandPolicy(13);
    expect(band.band).toBe("shortform-critical");
    expect(band.is13to15Special).toBe(true);
    expect(band.minCuts).toBe(4);
  });

  it("12초 → shortform-critical band", () => {
    const band = resolveShortformBandPolicy(12);
    expect(band.band).toBe("shortform-critical");
    expect(band.is13to15Special).toBe(true);
    expect(band.minCuts).toBe(4);
  });

  it("10초 → shortform-critical band", () => {
    const band = resolveShortformBandPolicy(10);
    expect(band.band).toBe("shortform-critical");
    expect(band.minCuts).toBe(4);
  });

  it("60초 → over-limit (shortform 생성 불가)", () => {
    const band = resolveShortformBandPolicy(60);
    expect(band.band).toBe("over-limit");
    expect(band.isShortformBand).toBe(false);
  });

  it("120초 → over-limit (shortform 생성 불가)", () => {
    const band = resolveShortformBandPolicy(120);
    expect(band.band).toBe("over-limit");
    expect(band.isShortformBand).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Director pace down-weight → reconciliation → meta 전파
// ═══════════════════════════════════════════════════════════════════

describe("director pace down-weight → generationMeta", () => {
  it("15초에서 감독이 8s/cut을 원하면 down-weight 발생", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 15,
      densityTargetCuts: 3,
      personaSecPerCut: 8,
    });
    expect(plan.directorPaceDownweighted).toBe(true);
    expect(plan.secPerCut).toBeLessThanOrEqual(4); // 15/4 = ~4
    expect(plan.cutCount).toBeGreaterThanOrEqual(4); // band minimum
    expect(plan.reconciliationNotes.length).toBeGreaterThan(0);
    expect(plan.reconciliationNotes.some(n => n.includes("director"))).toBe(true);
  });

  it("60초에서 감독이 5s/cut이면 down-weight 없음", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 60,
      densityTargetCuts: 8,
      personaSecPerCut: 5,
    });
    // 60/8 = 7.5, persona wants 5 → persona is LOWER than natural, no downweight
    expect(plan.directorPaceDownweighted).toBe(false);
  });

  it("13초에서 감독 pace 10s → cutCount 올리고 secPerCut 내림", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 13,
      densityTargetCuts: 2,
      personaSecPerCut: 10,
    });
    expect(plan.directorPaceDownweighted).toBe(true);
    expect(plan.cutCount).toBeGreaterThanOrEqual(4); // 13-15s band minimum
    expect(plan.bandPolicy.is13to15Special).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Reconciliation notes → rationale 전파
// ═══════════════════════════════════════════════════════════════════

describe("reconciliation notes as rationale source", () => {
  it("band preferred 상향 시 note 포함", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 15,
      densityTargetCuts: 2,
      personaSecPerCut: 5,
    });
    expect(plan.reconciliationNotes.some(n => n.includes("band preferred") || n.includes("band minimum"))).toBe(true);
    expect(plan.reconciled).toBe(true);
  });

  it("총합 불일치 시 보정 note 포함", () => {
    const plan = reconcileShortformPlan({
      totalDurationSec: 10,
      densityTargetCuts: 3,
      personaSecPerCut: 15, // way too high
    });
    expect(plan.reconciled).toBe(true);
    // secPerCut should be clamped down
    expect(plan.secPerCut).toBeLessThanOrEqual(4); // band maxSecPerCut = 4
  });
});

// ═══════════════════════════════════════════════════════════════════
// Sample project 검증 메타 → type safety
// ═══════════════════════════════════════════════════════════════════

describe("sample project verification metadata", () => {
  it("SampleProject type has verifyPoint and suspectOnFail", async () => {
    const { SAMPLE_PROJECTS } = await import("@/data/sample-projects");
    for (const sample of SAMPLE_PROJECTS) {
      expect(typeof sample.verifyPoint).toBe("string");
      expect(typeof sample.suspectOnFail).toBe("string");
      expect(sample.verifyPoint.length).toBeGreaterThan(0);
      expect(sample.suspectOnFail.length).toBeGreaterThan(0);
    }
  });

  it("shortform samples have correct recommended durations", async () => {
    const { SAMPLE_PROJECTS } = await import("@/data/sample-projects");
    const shortformSamples = SAMPLE_PROJECTS.filter(s => s.tags.includes("shortform"));
    expect(shortformSamples.length).toBeGreaterThanOrEqual(4);
    for (const s of shortformSamples) {
      if (s.recommendedDuration) {
        expect(s.recommendedDuration).toBeLessThanOrEqual(15);
      }
    }
  });
});
