import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_PRO, geminiErrorResponse, parseFirstJsonObject } from "./_gemini-keys";

type Env = GeminiEnv;

// ── 다단계 JSON 파싱 ────────────────────────────────────────────────────────
// Gemini가 코드블록, 앞뒤 설명, 필드명 변형 등 다양한 형태로 응답할 수 있으므로
// verify-prompt.ts 와 동일한 패턴으로 관대하게 처리.

function tryParseJson(raw: string): Record<string, unknown> | null {
  const attempts = [
    raw.trim(),
    raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim(),
  ];

  for (const s of attempts) {
    try {
      const p = JSON.parse(s);
      if (p && typeof p === "object" && !Array.isArray(p)) {
        return p as Record<string, unknown>;
      }
    } catch { /* next */ }
  }

  // { ... } 블록 추출 (balanced brace extraction)
  const balanced = parseFirstJsonObject(raw);
  if (balanced) return balanced;

  // 개별 필드 regex 추출 (부분 파싱)
  const scoreMatch = raw.match(/"?overallScore"?\s*:\s*(\d+)/i);
  if (scoreMatch) {
    const partial: Record<string, unknown> = { overallScore: parseInt(scoreMatch[1], 10) };
    const issuesMatch = raw.match(/"?issues"?\s*:\s*\[([\s\S]*?)\]/i);
    if (issuesMatch) {
      try { partial.issues = JSON.parse(`[${issuesMatch[1]}]`); } catch { partial.issues = []; }
    }
    return partial;
  }

  return null;
}

// 검증 실패 시 soft-fail 응답 (HTTP 200, 생성 차단 없음)
const softFail = (reason: string) => ({
  qualityCheckFailed: true,
  overallScore: 50,
  scores: {
    promptMatch: 5,
    visualQuality: 5,
    faceQuality: 10,
    motionCoherence: 5,
    styleConsistency: 5,
    composition: 5,
  },
  issues: [reason],
  suggestion: null,
});

// ── 메인 핸들러 ───────────────────────────────────────────────────────────────

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    // ── 요청 파싱
    let body: Record<string, unknown>;
    try {
      body = await context.request.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { frameBase64, videoPrompt, sceneDescription, cutNumber } =
      body as Record<string, string | number>;

    if (!frameBase64 || String(frameBase64).length < 100) {
      // frameBase64 없음 — 호출 자체가 잘못된 것 → 400
      return Response.json({ error: "frameBase64 is required" }, { status: 400 });
    }

    // data: prefix 제거 + 크기 제한
    // captureVideoLastFrame은 image/png 으로 캡처 후 prefix 제거해서 전송하지만
    // 혹시 prefix가 붙어있을 경우에도 안전하게 처리.
    const rawB64 = String(frameBase64).replace(/^data:image\/[^;]+;base64,/, "");

    // Gemini inline image 권장 상한 ~4MB base64 ≈ 3MB 이미지.
    // 720p PNG 한 프레임은 통상 300KB~2MB. 안전하게 2MB base64 = ~1.5MB 이미지로 제한.
    const b64Data = rawB64.length > 2_000_000 ? rawB64.slice(0, 2_000_000) : rawB64;

    const promptText = `You are a video quality assessment AI. Analyze this frame captured from a generated video and score it.

## Original Intent:
- Video Prompt: ${String(videoPrompt || "").slice(0, 800)}
- Scene Description: ${String(sceneDescription || "").slice(0, 400)}
- Cut Number: ${cutNumber || 1}

## Score these aspects (0-10 each):
1. **promptMatch**: Does the frame match the prompt description? (characters, setting, action)
2. **visualQuality**: Image sharpness, clarity, no artifacts
3. **faceQuality**: If faces are present - are they natural and consistent? (10 if no faces)
4. **motionCoherence**: Does the frame suggest smooth, natural motion? (based on motion blur, pose naturalness)
5. **styleConsistency**: Does the visual style match the requested animation/film style?
6. **composition**: Is the framing and composition good? (rule of thirds, leading lines, depth)

## Output JSON only (no markdown fences):
{
  "overallScore": 0-100,
  "scores": {
    "promptMatch": 0-10,
    "visualQuality": 0-10,
    "faceQuality": 0-10,
    "motionCoherence": 0-10,
    "styleConsistency": 0-10,
    "composition": 0-10
  },
  "issues": ["list of specific problems found"],
  "suggestion": "one-sentence suggestion for improvement if score < 70"
}`;

    const res = await fetchWithAuth(
      context.env,
      buildGeminiUrl(context.env, GEMINI_MODEL_PRO),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: promptText },
              {
                inlineData: {
                  // ⚠️ 이전 버그: "image/jpeg" 하드코딩 → Gemini 400 원인
                  // captureVideoLastFrame은 canvas.toDataURL("image/png") 사용 → PNG
                  mimeType: "image/png",
                  data: b64Data,
                },
              },
            ],
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            // ⚠️ 이전 버그: responseMimeType 없음 → Gemini가 마크다운 코드블록 감싸서 반환 가능
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error(
        `[verify-video-quality] Gemini API 오류 (CUT ${cutNumber}):`,
        res.status,
        errText.slice(0, 300)
      );
      return geminiErrorResponse(res, errText, "verify-video-quality");
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };

    const blockReason = data?.promptFeedback?.blockReason;
    const finishReason = data?.candidates?.[0]?.finishReason;
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    if (blockReason) {
      console.warn(`[verify-video-quality] 응답 차단 (CUT ${cutNumber}):`, blockReason);
      return Response.json(softFail(`채점 응답 차단 (${blockReason})`));
    }

    if (!rawText) {
      console.warn(`[verify-video-quality] 빈 응답 (CUT ${cutNumber}). finishReason:`, finishReason);
      return Response.json(softFail(`빈 응답 (finishReason: ${finishReason ?? "unknown"})`));
    }

    // ── 디버깅: 실제 응답 원문 로깅
    console.log(`[verify-video-quality] CUT ${cutNumber} 응답 원문 (첫 300자):`, rawText.slice(0, 300));

    // ── 다단계 파싱
    // ⚠️ 이전 버그: JSON.parse(jsonMatch[0]) 가 try-catch 없이 직접 호출 → 파싱 실패 시 500
    const parsed = tryParseJson(rawText);

    if (!parsed) {
      console.warn(
        `[verify-video-quality] 파싱 완전 실패 (CUT ${cutNumber}). rawText:`,
        rawText.slice(0, 200)
      );
      return Response.json(softFail("응답 파싱 실패"));
    }

    // overallScore 유효성 체크
    const score = Number(parsed.overallScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      console.warn(
        `[verify-video-quality] overallScore 이상 (CUT ${cutNumber}):`,
        parsed.overallScore
      );
      // 점수만 보정 후 나머지 필드는 그대로 반환
      parsed.overallScore = 50;
    }

    return Response.json(parsed);

  } catch (error) {
    // 예외 발생 시에도 HTTP 500 대신 soft-fail 반환
    // — verify-video-quality 오류가 콘솔 에러 스팸이 되지 않도록
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[verify-video-quality] 처리 오류:`, msg);
    return Response.json(softFail("처리 중 예외 발생"));
  }
};
