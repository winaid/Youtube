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
        maxOutputTokens: 16384,
        temperature: 0.4,
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

    // ── Stage 5: JSON parsing ──
    stage.current = "json_parse";
    let jsonText = result.text.trim();

    // Strip markdown fences if present
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
    }

    // Direct parse
    try {
      const analysis = JSON.parse(jsonText);
      console.log(`[analyze-script][stage:json_parse] Direct parse OK. sequences=${analysis?.sequences?.length ?? "?"}`);
      return Response.json({ success: true, analysis });
    } catch {
      // Recovery parse — extract first JSON object
      const recovered = parseFirstJsonObject(jsonText);
      if (recovered) {
        console.log(`[analyze-script][stage:json_parse] Recovery parse OK. sequences=${(recovered as { sequences?: unknown[] })?.sequences?.length ?? "?"}`);
        return Response.json({ success: true, analysis: recovered });
      }

      console.error(`[analyze-script][stage:json_parse] JSON parse failed. First 200 chars: ${jsonText.slice(0, 200)}`);
      return Response.json(
        {
          success: false,
          error: "Failed to parse LLM output as JSON",
          stage: "json_parse",
          rawPreview: jsonText.slice(0, 300),
        },
        { status: 502 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[analyze-script][stage:${stage.current}] Unhandled error:`, message);
    return Response.json(
      { success: false, error: `Internal error at stage: ${stage.current}`, stage: stage.current, detail: message.slice(0, 500) },
      { status: 500 },
    );
  }
};
