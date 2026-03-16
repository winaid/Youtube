/**
 * Tests proving the UI does NOT crash when analysis/cut data has missing fields.
 *
 * These cover the normalization boundary that prevents:
 *   "Cannot read properties of undefined (reading 'trim')"
 * inside useMemo paths like MultiShotEditor → validateMultiShots.
 */
import { describe, it, expect } from "vitest";
import {
  safeString,
  safeArray,
  safeNumber,
  normalizeMultiShotPrompt,
  normalizeMultiShotArray,
  normalizeCut,
  normalizeAnalysisResult,
  normalizeAnalyzedSequence,
} from "../src/lib/normalize";
import { convertToCuts } from "../src/lib/script-analyzer";
import { validateMultiShots, validateProgressionQuality } from "../src/lib/multishot-validation";
import type { ScriptAnalysisResult } from "../src/types/script-analysis";
import type { MultiShotPrompt } from "../src/types";

// ═══════════════════════════════════════════════════════════════════
// 1. Primitive helpers
// ═══════════════════════════════════════════════════════════════════

describe("safeString", () => {
  it("returns '' for undefined", () => expect(safeString(undefined)).toBe(""));
  it("returns '' for null", () => expect(safeString(null)).toBe(""));
  it("returns the string for a string", () => expect(safeString("hello")).toBe("hello"));
  it("coerces number to string", () => expect(safeString(42)).toBe("42"));
});

describe("safeArray", () => {
  it("returns [] for undefined", () => expect(safeArray(undefined)).toEqual([]));
  it("returns [] for null", () => expect(safeArray(null)).toEqual([]));
  it("returns [] for a string", () => expect(safeArray("not an array")).toEqual([]));
  it("returns the array for an array", () => expect(safeArray([1, 2])).toEqual([1, 2]));
});

describe("safeNumber", () => {
  it("returns fallback for undefined", () => expect(safeNumber(undefined, 8)).toBe(8));
  it("returns fallback for NaN", () => expect(safeNumber(NaN, 5)).toBe(5));
  it("returns the number for a number", () => expect(safeNumber(10, 5)).toBe(10));
  it("parses numeric strings", () => expect(safeNumber("12", 5)).toBe(12));
  it("returns fallback for non-numeric string", () => expect(safeNumber("abc", 5)).toBe(5));
});

// ═══════════════════════════════════════════════════════════════════
// 2. MultiShotPrompt normalization
// ═══════════════════════════════════════════════════════════════════

describe("normalizeMultiShotPrompt", () => {
  it("fills missing prompt with empty string", () => {
    const result = normalizeMultiShotPrompt({}, 1);
    expect(result.prompt).toBe("");
    expect(result.index).toBe(1);
    expect(result.duration).toBe("3");
    expect(result.role).toBe("develop");
  });

  it("preserves valid fields", () => {
    const result = normalizeMultiShotPrompt({
      index: 2, prompt: "Wide shot", duration: "5", role: "establish",
    }, 1);
    expect(result).toEqual({ index: 2, prompt: "Wide shot", duration: "5", role: "establish" });
  });

  it("handles undefined prompt specifically (the crash scenario)", () => {
    const result = normalizeMultiShotPrompt({ index: 1, prompt: undefined as unknown as string }, 1);
    expect(result.prompt).toBe("");
    expect(() => result.prompt.trim()).not.toThrow();
  });
});

describe("normalizeMultiShotArray", () => {
  it("returns [] for undefined", () => {
    expect(normalizeMultiShotArray(undefined)).toEqual([]);
  });

  it("returns [] for null", () => {
    expect(normalizeMultiShotArray(null)).toEqual([]);
  });

  it("normalizes array with missing prompts", () => {
    const shots = [
      { index: 1 },
      { index: 2, prompt: "Valid prompt" },
      { index: 3, prompt: undefined },
    ];
    const result = normalizeMultiShotArray(shots);
    expect(result).toHaveLength(3);
    expect(result[0].prompt).toBe("");
    expect(result[1].prompt).toBe("Valid prompt");
    expect(result[2].prompt).toBe("");
    result.forEach(s => expect(() => s.prompt.trim()).not.toThrow());
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Cut normalization
// ═══════════════════════════════════════════════════════════════════

describe("normalizeCut", () => {
  it("produces valid Cut from empty object", () => {
    const cut = normalizeCut({}, 1);
    expect(cut.cutNumber).toBe(1);
    expect(cut.sceneDescription).toBe("");
    expect(cut.videoPrompt).toBe("");
    expect(cut.cameraDirection).toBe("");
    expect(cut.moodLighting).toBe("");
    expect(cut.charactersInScene).toEqual([]);
    expect(cut.durationSec).toBe(8);
  });

  it("normalizes multiShot with undefined prompts", () => {
    const cut = normalizeCut({
      cutNumber: 1,
      multiShot: [
        { index: 1, prompt: undefined as unknown as string, duration: "3", role: "establish" },
        { index: 2, prompt: "Good prompt", duration: "5", role: "develop" },
      ],
    }, 1);
    expect(cut.multiShot).toHaveLength(2);
    expect(cut.multiShot![0].prompt).toBe("");
    expect(cut.multiShot![1].prompt).toBe("Good prompt");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. ScriptAnalysisResult normalization
// ═══════════════════════════════════════════════════════════════════

describe("normalizeAnalysisResult", () => {
  it("returns safe empty shape for undefined", () => {
    const result = normalizeAnalysisResult(undefined);
    expect(result.sourceSummary).toBe("");
    expect(result.sequences).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.confidence).toBe("low");
  });

  it("returns safe empty shape for null", () => {
    const result = normalizeAnalysisResult(null as unknown as undefined);
    expect(result.sequences).toEqual([]);
  });

  it("normalizes partial analysis with missing sequence fields", () => {
    const partial: Partial<ScriptAnalysisResult> = {
      sourceSummary: "Test",
      sequences: [
        {
          id: 1,
          title: "Hook",
          // purpose, rationale, sourceText are missing
          cuts: [
            { role: "establish" },
            // suggestedPromptIntent is missing
          ],
        } as any,
        {
          id: 2,
          // title missing
          cuts: undefined as any,
        } as any,
      ],
    };
    const result = normalizeAnalysisResult(partial);
    expect(result.sourceSummary).toBe("Test");
    expect(result.sequences).toHaveLength(2);

    const seq1 = result.sequences[0];
    expect(seq1.title).toBe("Hook");
    expect(seq1.purpose).toBe("");
    expect(seq1.cuts).toHaveLength(1);
    expect(seq1.cuts[0].suggestedPromptIntent).toBe("");
    expect(() => seq1.cuts[0].suggestedPromptIntent.trim()).not.toThrow();

    const seq2 = result.sequences[1];
    expect(seq2.title).toBe("시퀀스 2");
    expect(seq2.cuts).toEqual([]);
  });

  it("normalizes issues with missing fields", () => {
    const partial: Partial<ScriptAnalysisResult> = {
      issues: [
        { code: "weak_hook" } as any,
        {} as any,
      ],
    };
    const result = normalizeAnalysisResult(partial);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0].message).toBe("");
    expect(result.issues[1].severity).toBe("info");
  });

  it("normalizes structuralNotes and weaknesses from non-array", () => {
    const result = normalizeAnalysisResult({
      structuralNotes: "not an array" as any,
      weaknesses: undefined as any,
    });
    expect(result.structuralNotes).toEqual([]);
    expect(result.weaknesses).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4b. Incomplete analysis detection (summary exists, sequences missing)
// ═══════════════════════════════════════════════════════════════════

describe("normalizeAnalysisResult — incomplete analysis detection", () => {
  it("flags INCOMPLETE_ANALYSIS when summary exists but sequences are empty", () => {
    const result = normalizeAnalysisResult({
      sourceSummary: "흑사병이 유럽을 변화시킨 이유",
      thesis: "흑사병은 근대화를 앞당겼다",
      mainHook: "재앙이 오히려 발전을 촉진",
      sequences: [],
    } as Partial<ScriptAnalysisResult>);

    expect(result.sequences).toHaveLength(0);
    expect(result.thesis).toBe("흑사병은 근대화를 앞당겼다");
    const incompleteIssue = result.issues.find(i => i.code === "INCOMPLETE_ANALYSIS");
    expect(incompleteIssue).toBeDefined();
    expect(incompleteIssue!.severity).toBe("error");
  });

  it("flags INCOMPLETE_ANALYSIS when sequences field is missing entirely", () => {
    const result = normalizeAnalysisResult({
      sourceSummary: "경제 분석",
      thesis: "자본주의의 역설",
    } as Partial<ScriptAnalysisResult>);

    expect(result.sequences).toHaveLength(0);
    expect(result.issues.some(i => i.code === "INCOMPLETE_ANALYSIS")).toBe(true);
  });

  it("does NOT flag INCOMPLETE_ANALYSIS when sequences exist", () => {
    const result = normalizeAnalysisResult({
      sourceSummary: "테스트",
      thesis: "테스트 논제",
      sequences: [{
        id: 1,
        title: "훅",
        beatType: "hook",
        recommendedDurationSec: 10,
        cuts: [{ role: "establish", suggestedPromptIntent: "Wide shot" }],
      }],
    } as Partial<ScriptAnalysisResult>);

    expect(result.sequences).toHaveLength(1);
    expect(result.issues.some(i => i.code === "INCOMPLETE_ANALYSIS")).toBe(false);
  });

  it("does NOT flag when both summary and sequences are empty (no false positive)", () => {
    const result = normalizeAnalysisResult({});

    expect(result.sequences).toHaveLength(0);
    expect(result.issues.some(i => i.code === "INCOMPLETE_ANALYSIS")).toBe(false);
  });

  it("flags EMPTY_CUTS when sequences exist but all cuts are empty", () => {
    const result = normalizeAnalysisResult({
      sourceSummary: "테스트",
      sequences: [
        { id: 1, title: "훅", beatType: "hook", recommendedDurationSec: 8, cuts: [] },
        { id: 2, title: "전개", beatType: "development", recommendedDurationSec: 10, cuts: [] },
      ],
    } as Partial<ScriptAnalysisResult>);

    expect(result.sequences).toHaveLength(2);
    expect(result.issues.some(i => i.code === "EMPTY_CUTS")).toBe(true);
  });

  it("does NOT flag EMPTY_CUTS when at least one sequence has cuts", () => {
    const result = normalizeAnalysisResult({
      sourceSummary: "테스트",
      sequences: [
        { id: 1, title: "훅", beatType: "hook", recommendedDurationSec: 8, cuts: [{ role: "establish" }] },
        { id: 2, title: "전개", beatType: "development", recommendedDurationSec: 10, cuts: [] },
      ],
    } as Partial<ScriptAnalysisResult>);

    expect(result.issues.some(i => i.code === "EMPTY_CUTS")).toBe(false);
  });
});

describe("convertToCuts — empty sequence guard", () => {
  it("returns empty array for analysis with no sequences", () => {
    const analysis: ScriptAnalysisResult = normalizeAnalysisResult({
      sourceSummary: "흑사병 분석",
      thesis: "근대화 촉진",
      sequences: [],
    } as Partial<ScriptAnalysisResult>);

    const cuts = convertToCuts(analysis);
    expect(cuts).toHaveLength(0);
  });

  it("total duration is 0 for empty sequences", () => {
    const result = normalizeAnalysisResult({
      sourceSummary: "테스트",
      thesis: "테스트",
      sequences: [],
    } as Partial<ScriptAnalysisResult>);

    expect(result.totalSuggestedRuntime).toBe(0);
    expect(result.sequences).toHaveLength(0);
    // This is the exact broken state: summary exists + 0s duration + no sequences
    expect(result.issues.some(i => i.code === "INCOMPLETE_ANALYSIS")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. convertToCuts with incomplete analysis data (end-to-end)
// ═══════════════════════════════════════════════════════════════════

describe("convertToCuts with incomplete data", () => {
  it("does not crash when sequences have undefined cuts", () => {
    const analysis: ScriptAnalysisResult = {
      sourceSummary: "Test",
      mainHook: "",
      thesis: "",
      totalSuggestedRuntime: 30,
      suggestedSequenceCount: 2,
      structuralNotes: [],
      weaknesses: [],
      issues: [],
      confidence: "low",
      sequences: [
        {
          id: 1,
          title: "Seq 1",
          purpose: "Test purpose",
          beatType: "hook",
          sourceText: "",
          recommendedDurationSec: 10,
          recommendedCutCount: 3,
          rationale: "",
          endingMode: "close",
          retentionStrategy: { curiosityPoint: "", informationGain: "", escalation: "", payoff: "" },
          visualStrategy: { primaryDriver: "spectacle", finalFrameLanding: "payoff", toneHint: "" },
          cuts: undefined as any,
        },
      ],
    };
    expect(() => convertToCuts(analysis)).not.toThrow();
    const cuts = convertToCuts(analysis);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].videoPrompt).toBeTruthy();
  });

  it("does not crash when cut.suggestedPromptIntent is undefined", () => {
    const analysis: ScriptAnalysisResult = {
      sourceSummary: "Test",
      mainHook: "",
      thesis: "",
      totalSuggestedRuntime: 20,
      suggestedSequenceCount: 1,
      structuralNotes: [],
      weaknesses: [],
      issues: [],
      confidence: "medium",
      sequences: [
        {
          id: 1,
          title: "Test Seq",
          purpose: "Purpose",
          beatType: "development",
          sourceText: "",
          recommendedDurationSec: 10,
          recommendedCutCount: 2,
          rationale: "",
          endingMode: "close",
          retentionStrategy: { curiosityPoint: "", informationGain: "", escalation: "", payoff: "" },
          visualStrategy: { primaryDriver: "concept-reveal", finalFrameLanding: "unresolved-curiosity", toneHint: "" },
          cuts: [
            { role: "establish", visualFocus: "environment", changeFromPrevious: "", narrativeFunction: "", suggestedPromptIntent: undefined as unknown as string, retentionReason: "" },
            { role: "develop", visualFocus: "action", changeFromPrevious: "", narrativeFunction: "", suggestedPromptIntent: "Valid intent", retentionReason: "" },
          ],
        },
      ],
    };
    expect(() => convertToCuts(analysis)).not.toThrow();
    const cuts = convertToCuts(analysis);
    expect(cuts[0].multiShot).toBeDefined();
    cuts[0].multiShot!.forEach(s => {
      expect(typeof s.prompt).toBe("string");
      expect(() => s.prompt.trim()).not.toThrow();
    });
  });

  it("does not crash when entire analysis is from truncated JSON repair", () => {
    const truncatedAnalysis = {
      sourceSummary: "역사 다큐",
      mainHook: "충격적 사실",
      sequences: [
        {
          id: 1,
          title: "도입",
          beatType: "hook",
          recommendedDurationSec: 10,
          // purpose, rationale, sourceText, retentionStrategy, visualStrategy, cuts all missing
        },
      ],
    } as Partial<ScriptAnalysisResult>;

    const normalized = normalizeAnalysisResult(truncatedAnalysis);
    expect(() => convertToCuts(normalized)).not.toThrow();
    const cuts = convertToCuts(normalized);
    expect(cuts).toHaveLength(1);
    expect(typeof cuts[0].videoPrompt).toBe("string");
    expect(typeof cuts[0].sceneDescription).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. validateMultiShots does not crash on undefined prompts
// ═══════════════════════════════════════════════════════════════════

describe("validateMultiShots with undefined prompts", () => {
  it("does not crash when shot.prompt is undefined", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: undefined as unknown as string, duration: "3", role: "establish" },
      { index: 2, prompt: "Valid", duration: "5", role: "develop" },
    ];
    expect(() => validateMultiShots("kling-o3-text-to-video", shots, 8)).not.toThrow();
  });

  it("does not crash when all prompts are undefined", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: undefined as unknown as string, duration: "4", role: "establish" },
      { index: 2, prompt: undefined as unknown as string, duration: "4", role: "resolve" },
    ];
    expect(() => validateMultiShots("kling-o3-text-to-video", shots, 8)).not.toThrow();
  });
});

describe("validateProgressionQuality with undefined prompts", () => {
  it("does not crash when shot.prompt is undefined", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: undefined as unknown as string, duration: "3", role: "establish" },
      { index: 2, prompt: "Valid prompt", duration: "5", role: "resolve" },
    ];
    expect(() => validateProgressionQuality(shots)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. normalizeAnalyzedSequence edge cases
// ═══════════════════════════════════════════════════════════════════

describe("normalizeAnalyzedSequence", () => {
  it("handles completely empty object", () => {
    const seq = normalizeAnalyzedSequence({}, 1);
    expect(seq.title).toBe("시퀀스 1");
    expect(seq.purpose).toBe("");
    expect(seq.cuts).toEqual([]);
    expect(seq.retentionStrategy.curiosityPoint).toBe("");
    expect(seq.visualStrategy.primaryDriver).toBe("concept-reveal");
  });

  it("normalizes cuts with partial fields", () => {
    const seq = normalizeAnalyzedSequence({
      cuts: [
        { role: "peak" } as any,
        {} as any,
      ],
    }, 3);
    expect(seq.cuts).toHaveLength(2);
    expect(seq.cuts[0].role).toBe("peak");
    expect(seq.cuts[0].suggestedPromptIntent).toBe("");
    expect(seq.cuts[1].role).toBe("develop");
  });
});
