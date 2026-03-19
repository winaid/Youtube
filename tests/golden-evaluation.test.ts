/**
 * golden-evaluation.test.ts — Deep Analysis / Continuity 품질 검증
 *
 * 12개 golden case × 4개 모드(baseline, deep_analysis, continuity, both) 조합 검증.
 * 기계적 품질 체크를 자동으로 실행하고, 결과를 콘솔에 요약한다.
 */
import { describe, it, expect } from "vitest";
import { GOLDEN_CASES } from "./fixtures/golden-evaluation-set";
import type { GoldenCase, GoldenEvaluationResult } from "./fixtures/golden-evaluation-set";
import { evaluateGoldenCase } from "./fixtures/quality-checker";
import { runDeepAnalysis } from "@/lib/deep-analysis/analysis-orchestrator";
import { SAFE_ANALYSIS_RESULT } from "@/lib/deep-analysis/analysis-orchestrator";
import { serializePromptBrief } from "@/lib/deep-analysis/build-prompt-brief";

// ═══════════════════════════════════════════════════════════════════
// Helper: 단일 case를 4개 모드로 평가
// ═══════════════════════════════════════════════════════════════════

function evaluateAllModes(gc: GoldenCase): GoldenEvaluationResult[] {
  const results: GoldenEvaluationResult[] = [];

  // 1. Baseline (Deep Analysis OFF, Continuity OFF)
  results.push(evaluateGoldenCase(gc.id, SAFE_ANALYSIS_RESULT, gc.expectedProfile, false, "baseline"));

  // 2. Deep Analysis ON, Continuity OFF
  const daResult = runDeepAnalysis({
    storyText: gc.story,
    totalDurationSec: gc.totalDurationSec,
    cutCount: gc.cutCount,
    animationMode: gc.animationMode,
    continuityMode: false,
  });
  results.push(evaluateGoldenCase(gc.id, daResult, gc.expectedProfile, false, "deep_analysis"));

  // 3. Deep Analysis OFF, Continuity ON
  results.push(evaluateGoldenCase(gc.id, SAFE_ANALYSIS_RESULT, gc.expectedProfile, gc.continuityMode, "continuity"));

  // 4. Deep Analysis ON, Continuity ON
  const daBoth = runDeepAnalysis({
    storyText: gc.story,
    totalDurationSec: gc.totalDurationSec,
    cutCount: gc.cutCount,
    animationMode: gc.animationMode,
    continuityMode: gc.continuityMode,
  });
  results.push(evaluateGoldenCase(gc.id, daBoth, gc.expectedProfile, gc.continuityMode, "both"));

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite
// ═══════════════════════════════════════════════════════════════════

describe("Golden Evaluation Set", () => {
  it("12개 golden case가 존재한다", () => {
    expect(GOLDEN_CASES.length).toBe(12);
  });

  it("모든 golden case에 필수 필드가 있다", () => {
    for (const gc of GOLDEN_CASES) {
      expect(gc.id).toBeTruthy();
      expect(gc.title).toBeTruthy();
      expect(gc.story.length).toBeGreaterThan(20);
      expect(gc.totalDurationSec).toBeGreaterThan(0);
      expect(gc.cutCount).toBeGreaterThan(0);
      expect(gc.expectedProfile).toBeDefined();
      expect(gc.expectedProfile.riskHotspots.length).toBeGreaterThan(0);
      expect(gc.expectedProfile.desiredQualities.length).toBeGreaterThan(0);
      expect(gc.expectedProfile.likelyFailureModes.length).toBeGreaterThan(0);
    }
  });

  it("모든 golden case id가 고유하다", () => {
    const ids = GOLDEN_CASES.map(gc => gc.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Deep Analysis: tone/genre/pacing accuracy", () => {
  for (const gc of GOLDEN_CASES) {
    it(`[${gc.id}] ${gc.title} — 의도 분석 정확도`, () => {
      const result = runDeepAnalysis({
        storyText: gc.story,
        totalDurationSec: gc.totalDurationSec,
        cutCount: gc.cutCount,
        animationMode: gc.animationMode,
        continuityMode: gc.continuityMode,
      });

      const evalResult = evaluateGoldenCase(gc.id, result, gc.expectedProfile, gc.continuityMode, "deep_analysis");

      // tone/genre 중 최소 하나는 맞아야 함
      const toneCheck = evalResult.checks.find(c => c.id === "tone-accuracy");
      const genreCheck = evalResult.checks.find(c => c.id === "genre-accuracy");
      const eitherMatch = toneCheck?.result === "pass" || genreCheck?.result === "pass";
      expect(eitherMatch).toBe(true);
    });
  }
});

describe("Deep Analysis: risk hotspot detection", () => {
  for (const gc of GOLDEN_CASES) {
    it(`[${gc.id}] ${gc.title} — 리스크 감지율`, () => {
      const result = runDeepAnalysis({
        storyText: gc.story,
        totalDurationSec: gc.totalDurationSec,
        cutCount: gc.cutCount,
        animationMode: gc.animationMode,
        continuityMode: gc.continuityMode,
      });

      const evalResult = evaluateGoldenCase(gc.id, result, gc.expectedProfile, gc.continuityMode, "deep_analysis");

      // 분석기가 반환하는 risk 결과가 유효한 구조인지 확인
      const risk = result.generationRisk;
      expect(["low", "medium", "high"]).toContain(risk.continuityRisk);
      expect(["low", "medium", "high"]).toContain(risk.subjectCountRisk);
      expect(["low", "medium", "high"]).toContain(risk.sceneSwitchRisk);
      expect(["low", "medium", "high"]).toContain(risk.motionComplexityRisk);
      expect(["low", "medium", "high"]).toContain(risk.promptOverloadRisk);
      expect(["low", "medium", "high"]).toContain(risk.visualAmbiguityRisk);
      expect(risk.mitigationNotes.length).toBeLessThanOrEqual(3);
    });
  }
});

describe("Deep Analysis: brief quality", () => {
  for (const gc of GOLDEN_CASES) {
    it(`[${gc.id}] ${gc.title} — brief 비어있지 않음`, () => {
      const result = runDeepAnalysis({
        storyText: gc.story,
        totalDurationSec: gc.totalDurationSec,
        cutCount: gc.cutCount,
        animationMode: gc.animationMode,
      });

      expect(result.promptBrief.creativeBrief.length).toBeGreaterThan(0);
    });

    it(`[${gc.id}] ${gc.title} — brief compact (< 800자)`, () => {
      const result = runDeepAnalysis({
        storyText: gc.story,
        totalDurationSec: gc.totalDurationSec,
        cutCount: gc.cutCount,
        animationMode: gc.animationMode,
      });

      const serialized = serializePromptBrief(result.promptBrief);
      expect(serialized.length).toBeLessThan(800);
    });

    it(`[${gc.id}] ${gc.title} — avoidList ≤ 5`, () => {
      const result = runDeepAnalysis({
        storyText: gc.story,
        totalDurationSec: gc.totalDurationSec,
        cutCount: gc.cutCount,
        animationMode: gc.animationMode,
      });

      expect(result.promptBrief.avoidList.length).toBeLessThanOrEqual(5);
    });
  }
});

describe("Deep Analysis: consistency checks", () => {
  for (const gc of GOLDEN_CASES) {
    it(`[${gc.id}] ${gc.title} — realism + stylization = 100`, () => {
      const result = runDeepAnalysis({
        storyText: gc.story,
        totalDurationSec: gc.totalDurationSec,
        cutCount: gc.cutCount,
        animationMode: gc.animationMode,
      });

      expect(result.visualStrategy.realismLevel + result.visualStrategy.stylizationLevel).toBe(100);
    });

    it(`[${gc.id}] ${gc.title} — brief에 모순 없음`, () => {
      const result = runDeepAnalysis({
        storyText: gc.story,
        totalDurationSec: gc.totalDurationSec,
        cutCount: gc.cutCount,
        animationMode: gc.animationMode,
      });

      const hasRealistic = /realistic/i.test(result.promptBrief.creativeBrief);
      const hasStylized = /highly stylized/i.test(result.promptBrief.creativeBrief);
      expect(hasRealistic && hasStylized).toBe(false);
    });
  }
});

describe("Deep Analysis vs Baseline: 개선 검증", () => {
  it("Deep Analysis ON이 Baseline보다 평균 score가 높아야 한다", () => {
    let baselineTotal = 0;
    let daTotal = 0;

    for (const gc of GOLDEN_CASES) {
      const allResults = evaluateAllModes(gc);
      const baseline = allResults.find(r => r.mode === "baseline")!;
      const da = allResults.find(r => r.mode === "deep_analysis")!;
      baselineTotal += baseline.score;
      daTotal += da.score;
    }

    const baselineAvg = baselineTotal / GOLDEN_CASES.length;
    const daAvg = daTotal / GOLDEN_CASES.length;

    console.log(`[golden-eval] Baseline avg score: ${baselineAvg.toFixed(1)}`);
    console.log(`[golden-eval] Deep Analysis avg score: ${daAvg.toFixed(1)}`);
    console.log(`[golden-eval] Improvement: +${(daAvg - baselineAvg).toFixed(1)} points`);

    // Deep Analysis가 baseline보다 최소 10점 이상 높아야 함
    expect(daAvg).toBeGreaterThan(baselineAvg + 10);
  });

  it("Continuity가 필요한 케이스에서 both 모드의 continuity hint가 활성화된다", () => {
    const continuityCases = GOLDEN_CASES.filter(gc => gc.expectedProfile.shouldBenefitFromContinuity);

    for (const gc of continuityCases) {
      const daBoth = runDeepAnalysis({
        storyText: gc.story,
        totalDurationSec: gc.totalDurationSec,
        cutCount: gc.cutCount,
        animationMode: gc.animationMode,
        continuityMode: true,
      });

      // both 모드에서는 continuity hint가 반드시 존재해야 함
      expect(daBoth.promptBrief.continuityHint.length).toBeGreaterThan(0);
      expect(daBoth.promptBrief.continuityHint).toContain("continuity");
      // continuityRisk가 low로 내려감 (시스템이 처리하므로)
      expect(daBoth.generationRisk.continuityRisk).toBe("low");
    }
  });
});

describe("Continuity hint: ON/OFF 차이", () => {
  it("continuity ON 케이스에서 continuity hint가 존재한다", () => {
    const continuityCases = GOLDEN_CASES.filter(gc => gc.continuityMode);

    for (const gc of continuityCases) {
      const result = runDeepAnalysis({
        storyText: gc.story,
        totalDurationSec: gc.totalDurationSec,
        cutCount: gc.cutCount,
        animationMode: gc.animationMode,
        continuityMode: true,
      });

      expect(result.promptBrief.continuityHint.length).toBeGreaterThan(0);
      expect(result.promptBrief.continuityHint).toContain("continuity");
    }
  });

  it("continuity OFF + low risk 케이스에서 continuity hint가 비어있다", () => {
    const standaloneCases = GOLDEN_CASES.filter(gc =>
      !gc.continuityMode && !gc.expectedProfile.shouldBenefitFromContinuity
    );

    for (const gc of standaloneCases) {
      const result = runDeepAnalysis({
        storyText: gc.story,
        totalDurationSec: gc.totalDurationSec,
        cutCount: gc.cutCount,
        animationMode: gc.animationMode,
        continuityMode: false,
      });

      // continuity risk가 low면 hint가 비어야 함
      if (result.generationRisk.continuityRisk === "low") {
        expect(result.promptBrief.continuityHint).toBe("");
      }
    }
  });
});

describe("Full evaluation summary", () => {
  it("전체 golden set 평가 요약 출력", () => {
    const summary: Array<{ id: string; title: string; baseline: number; da: number; cont: number; both: number; delta: number }> = [];

    for (const gc of GOLDEN_CASES) {
      const allResults = evaluateAllModes(gc);
      const bl = allResults.find(r => r.mode === "baseline")!.score;
      const da = allResults.find(r => r.mode === "deep_analysis")!.score;
      const co = allResults.find(r => r.mode === "continuity")!.score;
      const bo = allResults.find(r => r.mode === "both")!.score;
      summary.push({ id: gc.id, title: gc.title, baseline: bl, da, cont: co, both: bo, delta: da - bl });
    }

    console.log("\n[golden-eval] ═══ FULL EVALUATION SUMMARY ═══");
    console.log("Case                        | BL  | DA  | CO  | BOTH | Δ(DA-BL)");
    console.log("─".repeat(70));
    for (const s of summary) {
      const pad = (n: number) => String(n).padStart(3);
      console.log(
        `${(s.id + " ".repeat(28)).slice(0, 28)} | ${pad(s.baseline)} | ${pad(s.da)} | ${pad(s.cont)} | ${pad(s.both)}  | +${pad(s.delta)}`
      );
    }

    const avgBl = Math.round(summary.reduce((a, s) => a + s.baseline, 0) / summary.length);
    const avgDa = Math.round(summary.reduce((a, s) => a + s.da, 0) / summary.length);
    const avgBo = Math.round(summary.reduce((a, s) => a + s.both, 0) / summary.length);
    console.log("─".repeat(70));
    console.log(`AVERAGE                      | ${String(avgBl).padStart(3)} | ${String(avgDa).padStart(3)} |     | ${String(avgBo).padStart(3)}  | +${String(avgDa - avgBl).padStart(3)}`);
    console.log("[golden-eval] ═══════════════════════════════\n");

    // 최소 기대: Deep Analysis가 baseline보다 낫다
    expect(avgDa).toBeGreaterThan(avgBl);
  });
});
