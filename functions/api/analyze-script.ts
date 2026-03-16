/**
 * analyze-script.ts — 대본 분석 API 엔드포인트
 *
 * Client에서 대본 텍스트를 받아 Gemini LLM으로 깊은 구조 분석 후
 * 릴 시퀀스 프로덕션 구조를 반환.
 *
 * Fallback: LLM 실패 시 client-side heuristic 결과를 그대로 사용하도록
 * 400/500 에러를 반환. 클라이언트가 heuristic fallback 처리.
 */

import { GeminiEnv, buildGeminiUrl, getApiKeys, GEMINI_MODEL_PRO, parseFirstJsonObject } from "./_gemini-keys";

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

  let body: AnalyzeRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { scriptText, analysisPrompt } = body;

  if (!scriptText || scriptText.trim().length < 10) {
    return Response.json({ success: false, error: "Script text too short" }, { status: 400 });
  }

  if (!analysisPrompt) {
    return Response.json({ success: false, error: "Analysis prompt required" }, { status: 400 });
  }

  const apiKeys = getApiKeys(env);
  if (apiKeys.length === 0) {
    return Response.json({ success: false, error: "No API keys configured" }, { status: 500 });
  }

  // Try each API key
  for (const apiKey of apiKeys) {
    try {
      const url = buildGeminiUrl(env, GEMINI_MODEL_PRO);
      const geminiRes = await fetch(`${url}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: analysisPrompt }] }],
          generationConfig: {
            maxOutputTokens: 16384,
            temperature: 0.4,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!geminiRes.ok) {
        const errBody = await geminiRes.text();
        console.error(`[analyze-script] Gemini ${geminiRes.status}:`, errBody.slice(0, 300));
        // 429/quota → try next key
        if (geminiRes.status === 429 || geminiRes.status === 401) continue;
        // Other errors → fail
        return Response.json({ success: false, error: `Gemini error: ${geminiRes.status}` }, { status: 502 });
      }

      const geminiData = await geminiRes.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        console.error("[analyze-script] Empty Gemini response");
        return Response.json({ success: false, error: "Empty LLM response" }, { status: 502 });
      }

      // Parse JSON from response (strip markdown fences if present)
      let jsonText = rawText.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
      }

      try {
        const analysis = JSON.parse(jsonText);
        return Response.json({ success: true, analysis });
      } catch {
        const recovered = parseFirstJsonObject(jsonText);
        if (recovered) {
          return Response.json({ success: true, analysis: recovered });
        }
        console.error("[analyze-script] JSON parse error, recovery failed");
        return Response.json({ success: false, error: "Failed to parse LLM output as JSON" }, { status: 502 });
      }
    } catch (fetchErr) {
      console.error("[analyze-script] Fetch error:", (fetchErr as Error).message);
      continue; // try next key
    }
  }

  // All keys exhausted
  return Response.json({ success: false, error: "All API keys exhausted" }, { status: 502 });
};
