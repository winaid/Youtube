/**
 * Tests for content mode detection and YouTube-mode planning.
 *
 * Validates that:
 *   - detectContentMode correctly classifies short-form vs youtube
 *   - getContentModeConfig returns correct config per mode
 *   - planSequenceBoundaries produces longer sections in YouTube mode
 *   - buildAnalysisPrompt generates mode-appropriate prompts
 */
import { describe, it, expect } from "vitest";
import {
  detectContentMode,
  getContentModeConfig,
  planSequenceBoundaries,
  buildAnalysisPrompt,
  analyzeScript,
  convertToCuts,
  generateCutProgression,
  type ScriptBeat,
} from "../src/lib/script-analyzer";

// ── Helpers ──

/** Create a ScriptBeat for testing */
function makeBeat(overrides: Partial<ScriptBeat> & { index: number }): ScriptBeat {
  return {
    text: `비트 ${overrides.index}`,
    estimatedSec: 5,
    typeHint: "development",
    intensity: 0.5,
    transitionStrength: 0.3,
    ...overrides,
  };
}

/** Long Korean text that simulates a historical/explanatory script (~80s narration) */
const LONG_EXPLANATORY_SCRIPT = `1347년, 흑사병이 유럽을 강타했다. 이 전염병은 인류 역사상 가장 치명적인 팬데믹이었다.
그 결과 유럽 인구의 3분의 1이 사망했다. 하지만 이것은 단순한 재앙이 아니었다.
흑사병 때문에 봉건제도가 무너지기 시작했다. 노동력 부족으로 농노들의 임금이 올랐다.
그래서 영주들은 더 이상 농노를 착취할 수 없었다. 이로 인해 자유로운 노동 시장이 형성되었다.
결국 흑사병은 근대 자본주의의 씨앗을 뿌린 셈이다. 오히려 파괴가 진보를 가져온 역설이다.
반면 동양에서는 전혀 다른 양상이 펼쳐졌다. 중국은 이미 명나라 교체기를 겪고 있었다.
이 때문에 흑사병의 영향은 유럽과 크게 달랐다. 따라서 같은 전염병이 문명권마다 전혀 다른 결과를 낳았다.`;

/** Short Korean text for short-form detection */
const SHORT_SCRIPT = "이 제품은 놀라운 효과가 있습니다. 사실 과학적으로 증명되었죠.";

// ═══════════════════════════════════════════════════════════════════
// detectContentMode
// ═══════════════════════════════════════════════════════════════════

describe("detectContentMode", () => {
  it("returns 'youtube' when estimated runtime >= 40s", () => {
    expect(detectContentMode("짧은 텍스트", 45, "auto")).toBe("youtube");
    expect(detectContentMode("짧은 텍스트", 40, "auto")).toBe("youtube");
  });

  it("returns 'short-form' when estimated runtime < 40s and no other triggers", () => {
    expect(detectContentMode("짧은 텍스트입니다.", 10, "auto")).toBe("short-form");
    expect(detectContentMode("짧은 텍스트", 39, "auto")).toBe("short-form");
  });

  it("returns 'youtube' for explanatory content types with substantial text", () => {
    const text = "A".repeat(201); // > 200 chars
    expect(detectContentMode(text, 20, "history")).toBe("youtube");
    expect(detectContentMode(text, 20, "economics")).toBe("youtube");
    expect(detectContentMode(text, 20, "what-if")).toBe("youtube");
    expect(detectContentMode(text, 20, "social-commentary")).toBe("youtube");
  });

  it("returns 'short-form' for explanatory types with short text", () => {
    const text = "짧은 역사 텍스트"; // < 200 chars
    expect(detectContentMode(text, 10, "history")).toBe("short-form");
  });

  it("returns 'youtube' when causal markers >= 3 and text > 150 chars", () => {
    // 3 causal markers: 때문, 결과, 그래서
    const text = "A".repeat(100) + " 때문에 이런 결과가 나왔다. 그래서 변화가 시작되었다. " + "B".repeat(50);
    expect(detectContentMode(text, 20, "auto")).toBe("youtube");
  });

  it("returns 'short-form' when causal markers < 3", () => {
    const text = "A".repeat(200) + " 때문에 이런 일이 있었다.";
    expect(detectContentMode(text, 20, "auto")).toBe("short-form");
  });

  it("correctly classifies the Black Death script as 'youtube'", () => {
    // This script has runtime > 40s AND multiple causal markers AND historical content
    expect(detectContentMode(LONG_EXPLANATORY_SCRIPT, 80, "history")).toBe("youtube");
    // Even with "auto" content type, the runtime alone triggers YouTube mode
    expect(detectContentMode(LONG_EXPLANATORY_SCRIPT, 80, "auto")).toBe("youtube");
  });

  it("returns 'short-form' for short marketing copy", () => {
    expect(detectContentMode(SHORT_SCRIPT, 8, "auto")).toBe("short-form");
  });
});

// ═══════════════════════════════════════════════════════════════════
// getContentModeConfig
// ═══════════════════════════════════════════════════════════════════

describe("getContentModeConfig", () => {
  it("returns short-form config with 8-15s sections", () => {
    const cfg = getContentModeConfig("short-form");
    expect(cfg.mode).toBe("short-form");
    expect(cfg.sectionMinSec).toBe(8);
    expect(cfg.sectionMaxSec).toBe(15);
    expect(cfg.totalMinSec).toBe(8);
    expect(cfg.totalMaxSec).toBe(30);
    expect(cfg.minBeatsPerSection).toBe(1);
  });

  it("returns youtube config with 15-60s sections", () => {
    const cfg = getContentModeConfig("youtube");
    expect(cfg.mode).toBe("youtube");
    expect(cfg.sectionMinSec).toBe(15);
    expect(cfg.sectionMaxSec).toBe(60);
    expect(cfg.totalMinSec).toBe(60);
    expect(cfg.totalMaxSec).toBe(180);
    expect(cfg.minBeatsPerSection).toBe(3);
  });

  it("youtube config has higher boundary transition threshold", () => {
    const short = getContentModeConfig("short-form");
    const yt = getContentModeConfig("youtube");
    expect(yt.boundaryTransitionThreshold).toBeGreaterThan(short.boundaryTransitionThreshold);
  });
});

// ═══════════════════════════════════════════════════════════════════
// planSequenceBoundaries — mode-aware behavior
// ═══════════════════════════════════════════════════════════════════

describe("planSequenceBoundaries", () => {
  /** Create a series of beats with given durations and transition strengths */
  function makeBeats(specs: Array<{ sec: number; transition?: number; type?: string }>): ScriptBeat[] {
    return specs.map((s, i) => makeBeat({
      index: i,
      estimatedSec: s.sec,
      transitionStrength: s.transition ?? 0.3,
      typeHint: (s.type ?? "development") as ScriptBeat["typeHint"],
    }));
  }

  it("short-form: splits into 8-15s sequences", () => {
    // 6 beats × 5s = 30s total → should split into ~3 sequences of ~10s
    const beats = makeBeats([
      { sec: 5 }, { sec: 5 }, { sec: 5 },
      { sec: 5 }, { sec: 5 }, { sec: 5 },
    ]);
    const cfg = getContentModeConfig("short-form");
    const groups = planSequenceBoundaries(beats, cfg);
    // Should be multiple sequences, each <= 15s
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const group of groups) {
      const dur = group.reduce((s, b) => s + b.estimatedSec, 0);
      expect(dur).toBeLessThanOrEqual(15);
    }
  });

  it("youtube: keeps beats together into 15-60s sections", () => {
    // 10 beats × 5s = 50s total → YouTube mode should keep as fewer, larger sections
    const beats = makeBeats([
      { sec: 5 }, { sec: 5 }, { sec: 5 }, { sec: 5 }, { sec: 5 },
      { sec: 5 }, { sec: 5 }, { sec: 5 }, { sec: 5 }, { sec: 5 },
    ]);
    const cfg = getContentModeConfig("youtube");
    const groups = planSequenceBoundaries(beats, cfg);
    // With YouTube mode, 50s should fit in 1-2 sections (max 60s per section)
    expect(groups.length).toBeLessThanOrEqual(2);
  });

  it("youtube: respects minBeatsPerSection (no splitting before 3 beats)", () => {
    // 4 beats: first 2 have high transition but YouTube requires min 3 beats per section
    const beats = makeBeats([
      { sec: 10, transition: 0.2 },
      { sec: 10, transition: 0.8 },  // high transition after, but only 2 beats
      { sec: 10, transition: 0.2 },
      { sec: 10, transition: 0.2 },
    ]);
    const cfg = getContentModeConfig("youtube");
    const groups = planSequenceBoundaries(beats, cfg);
    // Should NOT split after beat 1 (only 2 beats in first group)
    // All beats should be in one group (40s < 60s max)
    expect(groups.length).toBe(1);
  });

  it("youtube: splits at max section duration even without strong transition", () => {
    // 8 beats × 10s = 80s → exceeds 60s max, must split
    const beats = makeBeats([
      { sec: 10 }, { sec: 10 }, { sec: 10 }, { sec: 10 },
      { sec: 10 }, { sec: 10 }, { sec: 10 }, { sec: 10 },
    ]);
    const cfg = getContentModeConfig("youtube");
    const groups = planSequenceBoundaries(beats, cfg);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const group of groups) {
      const dur = group.reduce((s, b) => s + b.estimatedSec, 0);
      // Each section should be approximately within max (may slightly exceed due to beat granularity)
      expect(dur).toBeLessThanOrEqual(cfg.sectionMaxSec + 10); // 10s tolerance for last beat
    }
  });

  it("short-form: splits early at 3 beats when minimum duration is met", () => {
    // 6 beats × 4s = 24s → short-form should split after 3 beats (12s >= 8s min)
    const beats = makeBeats([
      { sec: 4 }, { sec: 4 }, { sec: 4 },
      { sec: 4 }, { sec: 4 }, { sec: 4 },
    ]);
    const cfg = getContentModeConfig("short-form");
    const groups = planSequenceBoundaries(beats, cfg);
    // short-form with 3-beat rule should produce 2 groups
    expect(groups.length).toBe(2);
  });

  it("handles empty beats array", () => {
    expect(planSequenceBoundaries([], getContentModeConfig("youtube"))).toEqual([]);
  });

  it("handles single beat", () => {
    const beats = [makeBeat({ index: 0, estimatedSec: 5 })];
    const groups = planSequenceBoundaries(beats, getContentModeConfig("youtube"));
    expect(groups.length).toBe(1);
    expect(groups[0].length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildAnalysisPrompt — mode-aware prompt generation
// ═══════════════════════════════════════════════════════════════════

describe("buildAnalysisPrompt", () => {
  it("generates youtube-mode prompt for long explanatory scripts", () => {
    const prompt = buildAnalysisPrompt(LONG_EXPLANATORY_SCRIPT, "history");
    expect(prompt).toContain("유튜브 해설 영상 프로덕션 전문가");
    expect(prompt).toContain("유튜브 해설 (60-180초)");
    expect(prompt).toContain("15-60");
    expect(prompt).toContain("2-12");
    expect(prompt).toContain("\"youtube\"");
  });

  it("generates short-form prompt for short scripts", () => {
    const prompt = buildAnalysisPrompt(SHORT_SCRIPT, "auto");
    expect(prompt).toContain("숏폼 릴 시퀀스 프로덕션 전문가");
    expect(prompt).toContain("숏폼 릴 (8-30초)");
    expect(prompt).toContain("8-15");
    expect(prompt).toContain("2-6");
    expect(prompt).toContain("\"short-form\"");
  });

  it("includes narration-based runtime estimate for youtube mode", () => {
    const prompt = buildAnalysisPrompt(LONG_EXPLANATORY_SCRIPT, "history");
    expect(prompt).toMatch(/추정 나레이션 런타임: \d+초/);
    expect(prompt).toMatch(/목표 총 런타임: 60-180초/);
  });

  it("includes section boundary guide for youtube mode", () => {
    const prompt = buildAnalysisPrompt(LONG_EXPLANATORY_SCRIPT, "history");
    expect(prompt).toContain("섹션 경계 결정 기준 (유튜브 해설)");
    expect(prompt).toContain("논리적 단위");
    expect(prompt).toContain("최소 3개 비트");
  });

  it("uses target runtime when provided", () => {
    const prompt = buildAnalysisPrompt(SHORT_SCRIPT, "auto", 120);
    expect(prompt).toContain("목표 총 런타임: 120초");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Anti-single-cut enforcement
// ═══════════════════════════════════════════════════════════════════

/** Black Death script from the test suite */
const BLACK_DEATH_SCRIPT = `만약 흑사병이 없었다면, 오늘날 우리가 아는 자유와 임금 노동은 존재하지 않았을 수도 있다.
14세기 유럽 인구의 3분의 1이 사라졌을 때, 남은 노동자들의 가치는 폭등했다. 영주들은 농노를 붙잡아둘 수 없었다.
하지만 노동력 부족은 단순한 경제 현상이 아니었다. 교회의 권위도 함께 무너졌다. 신이 왜 이 재앙을 막지 않았는가?
결과적으로 봉건제가 약화되면서, 노동자들은 처음으로 자신의 노동에 대한 대가를 요구할 수 있게 되었다.
그래서 임금 노동이라는 개념이 탄생했고, 이것이 자본주의의 씨앗이 되었다.
아이러니하게도, 인류 역사상 최악의 재앙이 자유와 근대성의 토대를 만든 셈이다.`;

describe("anti-single-cut enforcement", () => {
  it("multi-beat explanatory script must NOT produce 1 cut", () => {
    const analysis = analyzeScript(BLACK_DEATH_SCRIPT);
    const cuts = convertToCuts(analysis);
    expect(cuts.length).toBeGreaterThanOrEqual(3);
  });

  it("Black Death script produces correct multi-cut structure", () => {
    const analysis = analyzeScript(BLACK_DEATH_SCRIPT);
    const cuts = convertToCuts(analysis);

    // Must have multiple cuts representing distinct narrative beats
    expect(cuts.length).toBeGreaterThanOrEqual(3);

    // Each cut should have a meaningful description
    for (const cut of cuts) {
      expect(cut.sceneDescription.length).toBeGreaterThan(5);
      expect(cut.videoPrompt.length).toBeGreaterThan(0);
    }

    // Per-cut duration should be reasonable (not the entire sequence duration)
    for (const cut of cuts) {
      expect(cut.durationSec).toBeGreaterThanOrEqual(5);
      expect(cut.durationSec).toBeLessThanOrEqual(20);
    }

    // Total duration should cover the full script
    const totalDur = cuts.reduce((sum, c) => sum + c.durationSec, 0);
    expect(totalDur).toBeGreaterThanOrEqual(20);
  });

  it("generateCutProgression enforces min 3 cuts for 3+ beats", () => {
    const beats: ScriptBeat[] = [
      makeBeat({ index: 0, estimatedSec: 8, typeHint: "hook" }),
      makeBeat({ index: 1, estimatedSec: 8, typeHint: "mechanism" }),
      makeBeat({ index: 2, estimatedSec: 8, typeHint: "consequence" }),
    ];
    const cuts = generateCutProgression(beats, 24, "development");
    expect(cuts.length).toBeGreaterThanOrEqual(3);
  });

  it("generateCutProgression enforces min 4 cuts for 5+ beats", () => {
    const beats: ScriptBeat[] = [
      makeBeat({ index: 0, estimatedSec: 6, typeHint: "hook" }),
      makeBeat({ index: 1, estimatedSec: 6, typeHint: "setup" }),
      makeBeat({ index: 2, estimatedSec: 6, typeHint: "mechanism" }),
      makeBeat({ index: 3, estimatedSec: 6, typeHint: "consequence" }),
      makeBeat({ index: 4, estimatedSec: 6, typeHint: "payoff" }),
    ];
    const cuts = generateCutProgression(beats, 30, "development");
    expect(cuts.length).toBeGreaterThanOrEqual(4);
  });

  it("convertToCuts expands each sequence's AnalyzedCuts into separate Cuts", () => {
    const analysis = analyzeScript(LONG_EXPLANATORY_SCRIPT);
    const cuts = convertToCuts(analysis);

    // Each AnalyzedCut in each sequence should produce its own Cut
    const totalInternalCuts = analysis.sequences.reduce(
      (sum, seq) => sum + Math.max(1, seq.cuts.length), 0,
    );
    expect(cuts.length).toBe(totalInternalCuts);

    // Sequential cutNumber
    cuts.forEach((cut, i) => {
      expect(cut.cutNumber).toBe(i + 1);
    });
  });

  it("short simple scripts are not over-split", () => {
    const analysis = analyzeScript(SHORT_SCRIPT);
    const cuts = convertToCuts(analysis);
    // Short scripts should still work — just not artificially inflated
    expect(cuts.length).toBeGreaterThanOrEqual(1);
    expect(cuts.length).toBeLessThanOrEqual(6);
  });
});
