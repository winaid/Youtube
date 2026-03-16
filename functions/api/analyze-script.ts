/**
 * analyze-script.ts — 대본 분석 API 엔드포인트
 *
 * Client에서 대본 텍스트를 받아 Gemini LLM으로 깊은 구조 분석 후
 * 릴 시퀀스 프로덕션 구조를 반환.
 *
 * v4: Adaptive timeout + Flash model fallback.
 *
 * Timeout budget (must fit within Cloudflare 60s edge limit):
 *   attempt 0: Pro   20s  →  fail  → 2s backoff
 *   attempt 1: Pro   20s  →  fail  → 2s backoff
 *   attempt 2: Flash 12s  →  fail  → return error
 *   worst-case total: 20+2+20+2+12 = 56s < 60s ✓
 *
 * For 503/UNAVAILABLE: same budget, same retry.
 * For non-transient errors (401, 404): fail immediately.
 *
 * Partial text recovery: if streaming collected chunks before timeout,
 * those are used for JSON parsing (tier-2/3 recovery).
 *
 * Fallback: LLM 실패 시 client-side heuristic 결과를 그대로 사용하도록
 * 에러를 반환. 클라이언트가 heuristic fallback 처리.
 */

import {
  GeminiEnv,
  GEMINI_MODEL_PRO,
  GEMINI_MODEL_FLASH,
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

/**
 * Retry strategy per attempt.
 * Budget: must total < 60s (Cloudflare edge limit).
 * attempt 0: Pro 20s, attempt 1: Pro 20s, attempt 2: Flash 12s
 * Backoff: 2s between each. Worst: 20+2+20+2+12 = 56s.
 */
const ATTEMPT_CONFIG = [
  { model: "pro"   as const, timeoutMs: 20_000, backoffMs: 2000 },
  { model: "pro"   as const, timeoutMs: 20_000, backoffMs: 2000 },
  { model: "flash" as const, timeoutMs: 12_000, backoffMs: 0    },
] as const;

const MAX_RETRIES = ATTEMPT_CONFIG.length - 1;

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

    // 최대 페이로드 제한 — 메모리 과다 사용 및 토큰 초과 방지
    const MAX_SCRIPT_LENGTH = 200_000; // ~200KB
    if (scriptText.length > MAX_SCRIPT_LENGTH) {
      console.warn("[analyze-script][stage:validation] Script text too long:", scriptText.length);
      return Response.json(
        { success: false, error: `Script too long (${scriptText.length} chars, max ${MAX_SCRIPT_LENGTH})`, stage: "validation" },
        { status: 413 },
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

    // ── Stage 3: LLM request via streaming (adaptive timeout + Flash fallback) ──
    stage.current = "llm_request";
    const makeRequestBody = (maxTokens: number) => ({
      contents: [{ parts: [{ text: analysisPrompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    });

    let result: Awaited<ReturnType<typeof streamingGenerate>> | null = null;
    let lastProviderDiag: ReturnType<typeof parseProviderError> | null = null;
    let retryCount = 0;
    let usedModel = GEMINI_MODEL_PRO;

    for (let attempt = 0; attempt < ATTEMPT_CONFIG.length; attempt++) {
      const config = ATTEMPT_CONFIG[attempt];
      const model = config.model === "flash" ? GEMINI_MODEL_FLASH : GEMINI_MODEL_PRO;
      usedModel = model;

      // Flash gets fewer tokens (faster response)
      const maxTokens = config.model === "flash" ? 32768 : 65536;

      result = await streamingGenerate(env, model, makeRequestBody(maxTokens), {
        timeoutMs: config.timeoutMs,
      });

      // Success or got usable partial text — break out and try to parse
      if (!result.error || result.text) break;

      // Classify the error
      const diagStatus = result.status ?? 500;
      const diagBody = result.error ?? "";
      lastProviderDiag = parseProviderError(diagStatus, diagBody);

      // Only retry transient provider errors (503, 429, timeout)
      if (!isTransientProviderError(lastProviderDiag.code) || attempt === ATTEMPT_CONFIG.length - 1) {
        break;
      }

      retryCount = attempt + 1;
      const nextConfig = ATTEMPT_CONFIG[attempt + 1];
      const nextModel = nextConfig.model === "flash" ? "Flash" : "Pro";
      console.warn(
        `[analyze-script][stage:llm_request] Transient error (${lastProviderDiag.code}), ` +
        `retry ${retryCount}/${MAX_RETRIES} → ${nextModel} (${nextConfig.timeoutMs}ms) after ${config.backoffMs}ms backoff. ` +
        `provider_status=${lastProviderDiag.providerStatus}, provider_message="${lastProviderDiag.providerMessage.slice(0, 200)}"`,
      );

      if (config.backoffMs > 0) {
        await new Promise(resolve => setTimeout(resolve, config.backoffMs));
      }
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

    console.log(`[analyze-script][stage:llm_response_check] Got ${result.text.length} chars. model=${usedModel}, truncated=${result.truncated ?? false}, retries=${retryCount}`);

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

    /** Wrap parsed JSON with sequence validation before returning. */
    function makeAnalysisResponse(analysis: Record<string, unknown>, partial: boolean, tier: string) {
      const seqs = Array.isArray(analysis?.sequences) ? analysis.sequences : [];
      const hasSequences = seqs.length > 0;
      const hasSummary = !!(analysis?.thesis || analysis?.sourceSummary || analysis?.mainHook);

      console.log(`[analyze-script][stage:json_parse] ${tier} OK. sequences=${seqs.length}, hasSummary=${hasSummary}`);

      if (!hasSequences && hasSummary) {
        // Summary exists but no sequence structure — incomplete analysis
        console.warn(`[analyze-script][stage:json_parse] Incomplete: summary present but sequences empty`);
        return Response.json({
          success: true,
          analysis,
          partial: true,
          incomplete: true,
          incompleteReason: "MISSING_SEQUENCES",
          userMessage: "분석 요약은 생성되었으나 시퀀스 구조가 누락되었습니다. 다시 시도해주세요.",
        });
      }

      return Response.json({ success: true, analysis, partial });
    }

    // Tier 1: Direct parse
    try {
      const analysis = JSON.parse(jsonText);
      return makeAnalysisResponse(analysis, wasTruncated, "Tier-1 direct parse");
    } catch {
      // continue to tier 2
    }

    // Tier 2: Balanced-brace extraction (handles trailing commentary after JSON)
    const recovered = parseFirstJsonObject(jsonText);
    if (recovered) {
      return makeAnalysisResponse(recovered, wasTruncated, "Tier-2 balanced-brace");
    }

    // Tier 3: Truncated JSON repair (handles MAX_TOKENS / timeout cutoffs)
    const repaired = repairTruncatedJson(jsonText);
    if (repaired) {
      return makeAnalysisResponse(repaired, true, "Tier-3 truncated repair");
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
