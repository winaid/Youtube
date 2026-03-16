/**
 * analyze-script.ts — 대본 분석 API 엔드포인트
 *
 * Client에서 대본 텍스트를 받아 Gemini LLM으로 깊은 구조 분석 후
 * 릴 시퀀스 프로덕션 구조를 반환.
 *
 * v2: streamingGenerate로 전환하여 Cloudflare 524 타임아웃 방지.
 * 각 실패 단계를 stage marker로 로깅.
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
  geminiErrorResponse,
} from "./_gemini-keys";

type Env = GeminiEnv;

interface AnalyzeRequest {
  scriptText: string;
  targetRuntimeSec?: number;
  contentTypeHint?: string;
  /** Client-side heuristic 분석 프롬프트 (LLM에 전달) */
  analysisPrompt: string;
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

    // ── Stage 3: LLM request via streaming ──
    stage.current = "llm_request";
    const requestBody = {
      contents: [{ parts: [{ text: analysisPrompt }] }],
      generationConfig: {
        maxOutputTokens: 65536,
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    };

    const result = await streamingGenerate(env, GEMINI_MODEL_PRO, requestBody, {
      timeoutMs: 50_000, // 50s — under Cloudflare's 60s edge limit
    });

    // ── Stage 4: Handle LLM errors ──
    stage.current = "llm_response_check";

    if (result.error && !result.text) {
      console.error(`[analyze-script][stage:llm_response_check] LLM failed. status=${result.status}, error=${result.error.slice(0, 300)}`);

      if (result.timedOut) {
        return Response.json(
          { success: false, error: "LLM request timed out. Try shorter input or retry.", stage: "llm_timeout", code: "TIMEOUT" },
          { status: 504 },
        );
      }

      if (result.status) {
        return geminiErrorResponse({ status: result.status }, result.error, "analyze-script");
      }

      return Response.json(
        { success: false, error: "LLM request failed", stage: "llm_request", detail: result.error.slice(0, 500) },
        { status: 502 },
      );
    }

    if (!result.text || result.text.trim().length === 0) {
      console.error("[analyze-script][stage:llm_response_check] Empty LLM response text");
      return Response.json(
        { success: false, error: "Empty LLM response", stage: "llm_response_check" },
        { status: 502 },
      );
    }

    console.log(`[analyze-script][stage:llm_response_check] Got ${result.text.length} chars. truncated=${result.truncated ?? false}`);

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
        stage: "json_parse",
        truncated: wasTruncated,
        rawPreview: jsonText.slice(0, 300),
        help: wasTruncated
          ? "응답이 토큰 한도로 잘렸습니다. 대본을 줄이거나 다시 시도하세요."
          : "LLM이 비정상적인 출력을 반환했습니다. 다시 시도하세요.",
      },
      { status: 502 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[analyze-script][stage:${stage.current}] Unhandled error:`, message);
    return Response.json(
      { success: false, error: `Internal error at stage: ${stage.current}`, stage: stage.current, detail: message.slice(0, 500) },
      { status: 500 },
    );
  }
};
