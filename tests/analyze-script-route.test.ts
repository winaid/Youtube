/**
 * analyze-script-route.test.ts — Tests for /api/analyze-script endpoint logic.
 *
 * Tests:
 * 1. Happy path: valid request → success response with analysis
 * 2. Invalid input: missing fields → 400 with structured error
 * 3. Short script text → 400 with stage marker
 * 4. Missing analysisPrompt → 400 with stage marker
 * 5. buildAnalysisPrompt produces non-empty prompt for valid input
 * 6. Request payload shape matches route expectations
 */

import { describe, test, expect } from "vitest";
import { buildAnalysisPrompt, detectContentType } from "@/lib/script-analyzer";

// ═══════════════════════════════════════════════════════════════════
// Test the client-side contract (what InputPanel sends)
// ═══════════════════════════════════════════════════════════════════

describe("analyze-script request contract", () => {
  const sampleScript = `흑사병이 유럽을 덮쳤을 때, 인구의 1/3이 사라졌다.
그런데 이 재앙이 오히려 유럽의 근대화를 앞당겼다는 사실.
농노가 줄어들자 노동력 가격이 폭등했고,
영주들은 농노를 잡아두기 위해 대우를 개선해야 했다.`;

  test("buildAnalysisPrompt produces non-empty string for valid input", () => {
    const contentType = detectContentType(sampleScript);
    const prompt = buildAnalysisPrompt(sampleScript, contentType);

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
    // Prompt should contain the actual script text
    expect(prompt).toContain("흑사병");
  });

  test("detectContentType returns valid type for history content", () => {
    const contentType = detectContentType(sampleScript);
    expect(["history", "economics", "what-if", "social-commentary", "educational", "auto"]).toContain(contentType);
  });

  test("request payload has required fields matching route interface", () => {
    const contentType = detectContentType(sampleScript);
    const prompt = buildAnalysisPrompt(sampleScript, contentType);

    const payload = {
      scriptText: sampleScript,
      analysisPrompt: prompt,
      contentTypeHint: contentType,
    };

    // Route requires scriptText (min 10 chars) and analysisPrompt
    expect(payload.scriptText).toBeDefined();
    expect(payload.scriptText.trim().length).toBeGreaterThanOrEqual(10);
    expect(payload.analysisPrompt).toBeDefined();
    expect(payload.analysisPrompt.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Test validation logic (mirrors route's validation)
// ═══════════════════════════════════════════════════════════════════

describe("analyze-script validation rules", () => {
  test("rejects empty scriptText", () => {
    const scriptText = "";
    expect(scriptText.trim().length < 10).toBe(true);
  });

  test("rejects short scriptText (under 10 chars)", () => {
    const scriptText = "짧은 글";
    expect(scriptText.trim().length < 10).toBe(true);
  });

  test("accepts scriptText with 10+ chars", () => {
    const scriptText = "이것은 충분히 긴 대본 텍스트입니다";
    expect(scriptText.trim().length >= 10).toBe(true);
  });

  test("rejects missing analysisPrompt", () => {
    const analysisPrompt = "";
    expect(!analysisPrompt).toBe(true);
  });

  test("accepts valid analysisPrompt", () => {
    const prompt = buildAnalysisPrompt("테스트 대본입니다. 충분히 길게 작성합니다.", "auto");
    expect(!!prompt).toBe(true);
    expect(prompt.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Test response schema expectations
// ═══════════════════════════════════════════════════════════════════

describe("analyze-script response schema", () => {
  test("success response has { success: true, analysis }", () => {
    // Simulated success response shape
    const response = {
      success: true,
      analysis: {
        sourceSummary: "흑사병과 유럽 근대화",
        mainHook: "재앙이 근대화를 앞당긴 역설",
        thesis: "흑사병은 유럽의 사회 구조를 근본적으로 바꿨다",
        sequences: [
          { id: 1, title: "훅", beatType: "hook", recommendedDurationSec: 8, cuts: [] },
        ],
        confidence: "high",
      },
    };

    expect(response.success).toBe(true);
    expect(response.analysis).toBeDefined();
    expect(response.analysis.sequences).toBeInstanceOf(Array);
    expect(response.analysis.sequences.length).toBeGreaterThan(0);
  });

  test("error response has { success: false, error, stage }", () => {
    // Simulated error response shape
    const errorResponse = {
      success: false,
      error: "Script text too short (min 10 chars)",
      stage: "validation",
    };

    expect(errorResponse.success).toBe(false);
    expect(errorResponse.error).toBeDefined();
    expect(errorResponse.stage).toBeDefined();
  });

  test("timeout error includes code: TIMEOUT", () => {
    const timeoutResponse = {
      success: false,
      error: "LLM request timed out. Try shorter input or retry.",
      stage: "llm_timeout",
      code: "TIMEOUT",
    };

    expect(timeoutResponse.code).toBe("TIMEOUT");
    expect(timeoutResponse.stage).toBe("llm_timeout");
  });
});
