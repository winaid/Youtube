/**
 * analyze-script.ts — 대본 분석 API 엔드포인트
 *
 * Client에서 대본 텍스트를 받아 Gemini LLM으로 깊은 구조 분석 후
 * 릴 시퀀스 프로덕션 구조를 반환.
 *
 * v3: Provider error classification + retry with backoff for transient errors.
 * - 503/UNAVAILABLE → retry up to 2 times with exponential backoff
 * - Structured provider error diagnostics
 * - User-safe Korean error messages
 * - Proper error serialization (no more [object Object])
 *
 * Fallback: LLM 실패 시 client-side heuristic 결과를 그대로 사용하도록
 * 에러를 반환. 클라이언트가 heuristic fallback 처리.
 */

import {
  GeminiEnv,
  GEMINI_MODEL_PRO,
  streamingGenerate,
  parseFirstJsonObject,
  repairTruncatedJson,
  sanitizeJsonText,
  parseProviderError,
  isTransientProviderError,
} from "./_gemini-keys";

type Env = GeminiEnv;

interface AnalyzeRequest {
  scriptText: string;
  targetRuntimeSec?: number;
  contentTypeHint?: string;
  /** Client-side heuristic 분석 프롬프트 (LLM에 전달) */
  analysisPrompt: string;
}

/** Max retry attempts for transient provider errors (503, rate limit) */
const MAX_RETRIES = 2;
/** Backoff delays in ms: 1st retry after 2s, 2nd after 4s */
const BACKOFF_MS = [2000, 4000];

/** Safe serialization — never returns [object Object] */
function safeErrorString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const stage = { current: "request_parse" };

  try {
    // ── Stage 1: Request parsing ──
    let body: AnalyzeRequest;
    try {
      body = await request.json();
    } catch {
      console.error("[analyze-script][stage:request_parse] Invalid JSON body");
      return Response.json(
        { success: false, error: "Invalid JSON body", stage: "request_parse" },
        { status: 400 },
      );
    }

    // ── Stage 2: Validation ──
    stage.current = "validation";
    const { scriptText, analysisPrompt } = body;

    if (!scriptText || scriptText.trim().length < 10) {
      console.warn("[analyze-script][stage:validation] Script text too short:", scriptText?.length ?? 0);
      return Response.json(
        { success: false, error: "Script text too short (min 10 chars)", stage: "validation" },
        { status: 400 },
      );
    }

    if (!analysisPrompt) {
      console.warn("[analyze-script][stage:validation] Missing analysisPrompt");
      return Response.json(
        { success: false, error: "analysisPrompt is required. Use buildAnalysisPrompt() on client.", stage: "validation" },
        { status: 400 },
      );
    }

    console.log(`[analyze-script][stage:validation] OK. scriptText=${scriptText.length}chars, prompt=${analysisPrompt.length}chars, contentTypeHint=${body.contentTypeHint ?? "none"}`);

    // ── Stage 3: LLM request via streaming (with retry for transient errors) ──
    stage.current = "llm_request";
    const requestBody = {
      contents: [{ parts: [{ text: analysisPrompt }] }],
      generationConfig: {
        maxOutputTokens: 65536,
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    };

    let result: Awaited<ReturnType<typeof streamingGenerate>> | null = null;
    let lastProviderDiag: ReturnType<typeof parseProviderError> | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      result = await streamingGenerate(env, GEMINI_MODEL_PRO, requestBody, {
        timeoutMs: 50_000, // 50s — under Cloudflare's 60s edge limit
      });

      // Success or got usable text — break out
      if (!result.error || result.text) break;

      // Classify the error
      const diagStatus = result.status ?? 500;
      const diagBody = result.error ?? "";
      lastProviderDiag = parseProviderError(diagStatus, diagBody);

      // Only retry transient provider errors
      if (!isTransientProviderError(lastProviderDiag.code) || attempt === MAX_RETRIES) {
        break;
      }

      retryCount = attempt + 1;
      const delay = BACKOFF_MS[attempt] ?? 4000;
      console.warn(
        `[analyze-script][stage:llm_request] Transient error (${lastProviderDiag.code}), ` +
        `retry ${retryCount}/${MAX_RETRIES} after ${delay}ms. ` +
        `provider_status=${lastProviderDiag.providerStatus}, provider_message="${lastProviderDiag.providerMessage.slice(0, 200)}"`,
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    if (!result) {
      return Response.json(
        { success: false, error: "LLM request failed to initialize", stage: "llm_request" },
        { status: 500 },
      );
    }

    // ── Stage 4: Handle LLM errors ──
    stage.current = "llm_response_check";

    if (result.error && !result.text) {
      const diagStatus = result.status ?? 500;
      const diagBody = result.error ?? "";
      const diag = lastProviderDiag ?? parseProviderError(diagStatus, diagBody);

      // Structured developer log
      console.error(JSON.stringify({
        tag: "analyze-script",
        stage: "llm_response_check",
        classification: diag.code,
        providerStatus: diag.providerStatus,
        providerCode: diag.providerCode,
        providerMessage: diag.providerMessage.slice(0, 500),
        retryCount,
        retryable: diag.retryable,
        timedOut: result.timedOut ?? false,
      }));

      // Timeout is a specific sub-case
      if (result.timedOut) {
        return Response.json(
          {
            success: false,
            error: "분석 서버 응답 시간이 초과되었습니다.",
            userMessage: "분석 서버 응답 시간이 초과되었습니다. 대본을 줄이거나 다시 시도해주세요.",
            stage: "provider_timeout",
            code: "PROVIDER_TIMEOUT",
            retryable: true,
            retryCount,
          },
          { status: 504 },
        );
      }

      // Structured error response for all provider errors
      return Response.json(
        {
          success: false,
          error: diag.userMessage,
          userMessage: diag.userMessage,
          stage: diag.code.startsWith("PROVIDER_") ? diag.code.toLowerCase() : "llm_response_check",
          code: diag.code,
          retryable: diag.retryable,
          retryCount,
          help: diag.help,
          detail: diag.providerMessage.slice(0, 500),
        },
        { status: diagStatus >= 400 && diagStatus < 600 ? diagStatus : 502 },
      );
    }

    if (!result.text || result.text.trim().length === 0) {
      console.error("[analyze-script][stage:llm_response_check] Empty LLM response text");
      return Response.json(
        {
          success: false,
          error: "분석 서버에서 빈 응답을 받았습니다.",
          userMessage: "분석 서버에서 빈 응답을 받았습니다. 다시 시도해주세요.",
          stage: "llm_response_check",
          code: "PROVIDER_INVALID_RESPONSE",
          retryable: true,
          retryCount,
        },
        { status: 502 },
      );
    }

    console.log(`[analyze-script][stage:llm_response_check] Got ${result.text.length} chars. truncated=${result.truncated ?? false}, retries=${retryCount}`);

    // ── Stage 5: JSON parsing (3-tier recovery) ──
    stage.current = "json_parse";
    let jsonText = result.text.trim();

    // Strip markdown fences if present
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
    }

    // Sanitize common LLM artifacts (trailing commas, control chars, unicode quotes)
    jsonText = sanitizeJsonText(jsonText);

    const wasTruncated = result.truncated ?? false;

    // Tier 1: Direct parse
    try {
      const analysis = JSON.parse(jsonText);
      console.log(`[analyze-script][stage:json_parse] Tier-1 direct parse OK. sequences=${analysis?.sequences?.length ?? "?"}`);
      return Response.json({ success: true, analysis, partial: wasTruncated });
    } catch {
      // continue to tier 2
    }

    // Tier 2: Balanced-brace extraction (handles trailing commentary after JSON)
    const recovered = parseFirstJsonObject(jsonText);
    if (recovered) {
      console.log(`[analyze-script][stage:json_parse] Tier-2 balanced-brace OK. sequences=${(recovered as { sequences?: unknown[] })?.sequences?.length ?? "?"}`);
      return Response.json({ success: true, analysis: recovered, partial: wasTruncated });
    }

    // Tier 3: Truncated JSON repair (handles MAX_TOKENS / timeout cutoffs)
    const repaired = repairTruncatedJson(jsonText);
    if (repaired) {
      const seqCount = (repaired as { sequences?: unknown[] })?.sequences;
      console.log(`[analyze-script][stage:json_parse] Tier-3 truncated repair OK. sequences=${Array.isArray(seqCount) ? seqCount.length : "?"}`);
      return Response.json({ success: true, analysis: repaired, partial: true });
    }

    console.error(`[analyze-script][stage:json_parse] All 3 tiers failed. truncated=${wasTruncated}, length=${jsonText.length}. First 300 chars: ${jsonText.slice(0, 300)}`);
    return Response.json(
      {
        success: false,
        error: "LLM 응답을 JSON으로 파싱할 수 없습니다. 대본이 너무 길거나 복잡할 수 있습니다.",
        userMessage: wasTruncated
          ? "응답이 토큰 한도로 잘렸습니다. 대본을 줄이거나 다시 시도하세요."
          : "분석 결과를 처리할 수 없습니다. 다시 시도해주세요.",
        stage: "internal_parse_error",
        code: "INTERNAL_PARSE_ERROR",
        retryable: true,
        retryCount,
        truncated: wasTruncated,
        rawPreview: jsonText.slice(0, 300),
      },
      { status: 502 },
    );
  } catch (err) {
    const message = safeErrorString(err);
    console.error(JSON.stringify({
      tag: "analyze-script",
      stage: stage.current,
      classification: "internal_error",
      error: message.slice(0, 500),
    }));
    return Response.json(
      {
        success: false,
        error: "분석 중 내부 오류가 발생했습니다.",
        userMessage: "분석 중 내부 오류가 발생했습니다. 다시 시도해주세요.",
        stage: stage.current,
        code: "INTERNAL_ERROR",
        retryable: false,
        detail: message.slice(0, 500),
      },
      { status: 500 },
    );
  }
};
