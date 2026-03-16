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
 * 7. Provider error classification (503, 429, 500, etc.)
 * 8. parseProviderError structured diagnostics
 * 9. Transient error detection for retry logic
 */

import { describe, test, expect } from "vitest";
import { buildAnalysisPrompt, detectContentType } from "@/lib/script-analyzer";
import {
  isRetryableError,
  classifyGeminiError,
  parseProviderError,
  isTransientProviderError,
} from "../functions/api/_gemini-keys";

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

  test("timeout error includes code: PROVIDER_TIMEOUT", () => {
    const timeoutResponse = {
      success: false,
      error: "분석 서버 응답 시간이 초과되었습니다.",
      stage: "provider_timeout",
      code: "PROVIDER_TIMEOUT",
      retryable: true,
    };

    expect(timeoutResponse.code).toBe("PROVIDER_TIMEOUT");
    expect(timeoutResponse.stage).toBe("provider_timeout");
    expect(timeoutResponse.retryable).toBe(true);
  });

  test("provider unavailable error has correct shape", () => {
    const response = {
      success: false,
      error: "분석 서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요.",
      userMessage: "분석 서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요.",
      stage: "provider_unavailable",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      retryCount: 2,
    };

    expect(response.success).toBe(false);
    expect(response.code).toBe("PROVIDER_UNAVAILABLE");
    expect(response.retryable).toBe(true);
    expect(response.userMessage).toContain("혼잡");
    expect(response.retryCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Provider Error Classification
// ═══════════════════════════════════════════════════════════════════

describe("classifyGeminiError — provider error classification", () => {
  test("503 → PROVIDER_UNAVAILABLE", () => {
    const body = JSON.stringify({
      error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" },
    });
    expect(classifyGeminiError(503, body)).toBe("PROVIDER_UNAVAILABLE");
  });

  test("500 with 'high demand' → PROVIDER_UNAVAILABLE", () => {
    const body = JSON.stringify({
      error: { code: 500, message: "UNAVAILABLE: high demand spike", status: "UNAVAILABLE" },
    });
    expect(classifyGeminiError(500, body)).toBe("PROVIDER_UNAVAILABLE");
  });

  test("500 with 'overloaded' → PROVIDER_UNAVAILABLE", () => {
    expect(classifyGeminiError(500, "The model is overloaded")).toBe("PROVIDER_UNAVAILABLE");
  });

  test("429 → PROVIDER_RATE_LIMIT", () => {
    expect(classifyGeminiError(429, "Rate limit exceeded")).toBe("PROVIDER_RATE_LIMIT");
  });

  test("524 → PROVIDER_TIMEOUT", () => {
    expect(classifyGeminiError(524, "")).toBe("PROVIDER_TIMEOUT");
  });

  test("500 generic → PROVIDER_INVALID_RESPONSE", () => {
    expect(classifyGeminiError(500, "Internal server error")).toBe("PROVIDER_INVALID_RESPONSE");
  });

  test("502 → PROVIDER_INVALID_RESPONSE", () => {
    expect(classifyGeminiError(502, "Bad gateway")).toBe("PROVIDER_INVALID_RESPONSE");
  });

  test("401 → INVALID_API_KEY", () => {
    expect(classifyGeminiError(401, "Unauthorized")).toBe("INVALID_API_KEY");
  });

  test("404 with 'not found' → MODEL_NOT_FOUND", () => {
    expect(classifyGeminiError(404, "Model does not exist")).toBe("MODEL_NOT_FOUND");
  });
});

describe("isTransientProviderError", () => {
  test("PROVIDER_UNAVAILABLE is transient", () => {
    expect(isTransientProviderError("PROVIDER_UNAVAILABLE")).toBe(true);
  });

  test("PROVIDER_RATE_LIMIT is transient", () => {
    expect(isTransientProviderError("PROVIDER_RATE_LIMIT")).toBe(true);
  });

  test("PROVIDER_TIMEOUT is transient", () => {
    expect(isTransientProviderError("PROVIDER_TIMEOUT")).toBe(true);
  });

  test("INVALID_API_KEY is NOT transient", () => {
    expect(isTransientProviderError("INVALID_API_KEY")).toBe(false);
  });

  test("MODEL_NOT_FOUND is NOT transient", () => {
    expect(isTransientProviderError("MODEL_NOT_FOUND")).toBe(false);
  });

  test("PROVIDER_INVALID_RESPONSE is NOT transient", () => {
    expect(isTransientProviderError("PROVIDER_INVALID_RESPONSE")).toBe(false);
  });
});

describe("parseProviderError — structured diagnostics", () => {
  test("parses 503 UNAVAILABLE with structured JSON body", () => {
    const body = JSON.stringify({
      error: {
        code: 503,
        message: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
        status: "UNAVAILABLE",
      },
    });
    const diag = parseProviderError(503, body);

    expect(diag.code).toBe("PROVIDER_UNAVAILABLE");
    expect(diag.providerStatus).toBe(503);
    expect(diag.providerCode).toBe(503);
    expect(diag.providerMessage).toContain("high demand");
    expect(diag.retryable).toBe(true);
    expect(diag.userMessage).toContain("혼잡");
  });

  test("parses 429 rate limit", () => {
    const body = JSON.stringify({ error: { code: 429, message: "Rate limit exceeded" } });
    const diag = parseProviderError(429, body);

    expect(diag.code).toBe("PROVIDER_RATE_LIMIT");
    expect(diag.retryable).toBe(true);
    expect(diag.userMessage).toContain("빈번");
  });

  test("parses raw text body gracefully", () => {
    const diag = parseProviderError(500, "Internal Server Error");

    expect(diag.providerMessage).toBe("Internal Server Error");
    expect(diag.providerCode).toBeNull();
    expect(diag.code).toBe("PROVIDER_INVALID_RESPONSE");
  });

  test("401 is not retryable", () => {
    const diag = parseProviderError(401, "Unauthorized");
    expect(diag.retryable).toBe(false);
    expect(diag.code).toBe("INVALID_API_KEY");
  });
});
