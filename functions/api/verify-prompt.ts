import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

// ── 다단계 JSON 파싱 ──────────────────────────────────────────────────────────
// Gemini가 ```json ... ``` 코드블록, 앞뒤 설명 텍스트, 필드명 대소문자 혼용 등
// 다양한 형태로 응답할 수 있으므로 최대한 관대하게 처리.

function tryParseJson(raw: string): Record<string, unknown> | null {
  const attempts: string[] = [];

  // 1) 있는 그대로
  attempts.push(raw.trim());

  // 2) 마크다운 코드블록 제거 (```json … ``` 또는 ``` … ```)
  attempts.push(
    raw
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim()
  );

  // 3) 첫 번째 { ... } 블록 추출
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) attempts.push(braceMatch[0]);

  for (const s of attempts) {
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 다음 시도
    }
  }

  // 4) 마지막: 개별 필드 regex 추출 (부분 파싱)
  const scoreMatch = raw.match(/"?overallScore"?\s*:\s*(\d+)/i);
  if (scoreMatch) {
    const partial: Record<string, unknown> = {
      overallScore: parseInt(scoreMatch[1], 10),
    };

    const issuesMatch = raw.match(/"?issues"?\s*:\s*\[([\s\S]*?)\]/i);
    if (issuesMatch) {
      try {
        partial.issues = JSON.parse(`[${issuesMatch[1]}]`);
      } catch {
        partial.issues = [];
      }
    }

    const suggestMatch = raw.match(/"?suggestions"?\s*:\s*\[([\s\S]*?)\]/i);
    if (suggestMatch) {
      try {
        partial.suggestions = JSON.parse(`[${suggestMatch[1]}]`);
      } catch {
        partial.suggestions = [];
      }
    }

    console.log("[verify-prompt] 부분 파싱 성공 (overallScore만 추출):", partial.overallScore);
    return partial;
  }

  return null;
}

// ── 필드명 정규화 ─────────────────────────────────────────────────────────────
// Gemini가 camelCase 대신 snake_case 혹은 다른 변형을 쓸 수 있음

function normalizeScore(obj: Record<string, unknown>): number {
  const v =
    obj.overallScore ??
    obj.overall_score ??
    obj.score ??
    obj.totalScore ??
    obj.total_score;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(100, n) : -1;
}

function normalizeSubScores(
  obj: Record<string, unknown>
): Record<string, number> {
  const raw =
    (obj.scores as Record<string, unknown>) ??
    (obj.subscores as Record<string, unknown>) ??
    (obj.sub_scores as Record<string, unknown>) ??
    {};
  const get = (keys: string[]) => {
    for (const k of keys) {
      const v = Number(raw[k]);
      if (Number.isFinite(v)) return Math.min(10, Math.max(0, v));
    }
    return 0;
  };
  return {
    characterDescription: get(["characterDescription", "character_description", "character"]),
    cameraMovement: get(["cameraMovement", "camera_movement", "camera"]),
    actionSequence: get(["actionSequence", "action_sequence", "temporal", "temporalStructure", "temporal_structure"]),
    lightingMood: get(["lightingMood", "lighting_mood", "lighting"]),
    veoCompatibility: get(["veoCompatibility", "veo_compatibility", "compatibility"]),
  };
}

function normalizeStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.length > 0) return [v];
  return [];
}

// ── 메인 핸들러 ───────────────────────────────────────────────────────────────

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { videoPrompt, extendPrompt, imagePrompt, sceneDescription, cutNumber, durationSeconds } =
      await context.request.json() as Record<string, string | number>;

    if (!videoPrompt) {
      return Response.json({ error: "videoPrompt is required" }, { status: 400 });
    }

    const duration = Number(durationSeconds) || 8;
    const wordCount = String(videoPrompt).split(/\s+/).length;

    const systemPrompt = `You are a Veo 3.1 video generation prompt QA expert. Review the following prompt for issues that cause Veo to deviate from user intent.

## Prompt to Review
- Scene: CUT ${cutNumber || 1}
- Duration: ${duration} seconds
- Word count: ~${wordCount} words
- Video Prompt: ${String(videoPrompt)}
${extendPrompt ? `- Extend Prompt: ${String(extendPrompt)}` : ""}
${imagePrompt ? `- Image Prompt: ${String(imagePrompt)}` : ""}
${sceneDescription ? `- Scene Description: ${String(sceneDescription)}` : ""}

## Review Criteria (STRICT — focus on what makes Veo follow or ignore prompts)

1. **Character Description Completeness** (0-10):
   - MUST have: hair style+color, outfit details, approximate age, skin tone
   - DEDUCTION: vague references like "the character", "same person", "he/she" without redescription

2. **Camera Movement Quality** (0-10):
   - MUST use Veo-recognized terms: "dolly", "tracking", "crane", "pan", "tilt", "steadicam", "handheld"
   - DEDUCTION: abstract camera ("cinematic angle") without specific movement type
   - BONUS: 2-3 camera transitions described in sequence

3. **Temporal Structure** (0-10): *** THE MOST CRITICAL FOR VEO ADHERENCE ***
   - MUST have clear time-based progression for ${duration} seconds
   - BEST: explicit "0s-2s: ..., 2s-5s: ..., 5s-${duration}s: ..." format
   - ACCEPTABLE: clear "first... then... finally..." progression
   - DEDUCTION: no temporal markers = Veo picks random moment (score ≤ 4)
   - DEDUCTION: too many actions for ${duration}s (max 2 concurrent per segment)

4. **Lighting/Mood Specificity** (0-10):
   - MUST name light sources and direction: "warm key light from upper left"
   - DEDUCTION: just "dramatic lighting" without specifics

5. **Veo Compatibility** (0-10):
   - DEDUCTION: requests for readable text/writing on screen (Veo cannot do this)
   - DEDUCTION: exact numbers of objects ("three birds" — use "a few birds")
   - DEDUCTION: complex multi-person choreography
   - DEDUCTION: abstract emotions without physical manifestation
   - DEDUCTION: prompt over 350 words (Veo starts ignoring)
   - DEDUCTION: prompt under 80 words (not enough detail for Veo)
   - BONUS: active voice, present tense, concrete actions

## Output JSON only (no markdown fences):
{
  "overallScore": 0-100,
  "scores": {
    "characterDescription": 0-10,
    "cameraMovement": 0-10,
    "actionSequence": 0-10,
    "lightingMood": 0-10,
    "veoCompatibility": 0-10
  },
  "issues": ["list of specific problems that will cause Veo to deviate from intent"],
  "suggestions": ["concrete actionable improvements"],
  "improvedVideoPrompt": "ONLY if score < 80: fully rewritten prompt with temporal beats, proper structure, embedded negative guidance, no text/watermark clause. Must be 180-280 words.",
  "improvedExtendPrompt": "ONLY if score < 80 and extend prompt exists: rewritten extend prompt"
}`;

    const res = await fetchWithAuth(context.env, buildVertexUrl(context.env, "gemini-3.1-flash-lite-preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: "application/json" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[verify-prompt] Gemini API 오류:", res.status, errText.slice(0, 300));
      // API 오류 → 채점 불가 처리 (생성 차단하지 않음)
      return Response.json({
        scoringFailure: true,
        overallScore: 50,
        issues: [`채점 API 오류 (HTTP ${res.status}) — 생성은 계속 진행 가능`],
        scores: { characterDescription: 5, cameraMovement: 5, actionSequence: 5, lightingMood: 5, veoCompatibility: 5 },
        suggestions: [],
      });
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };

    const blockReason = data?.promptFeedback?.blockReason;
    const finishReason = data?.candidates?.[0]?.finishReason;
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    // ── 응답 차단 / 비어있는 경우
    if (blockReason) {
      console.warn("[verify-prompt] 응답 차단됨:", blockReason);
      return Response.json({
        scoringFailure: true,
        overallScore: 50,
        issues: [`채점 응답 차단됨 (${blockReason}) — 생성은 계속 진행 가능`],
        scores: { characterDescription: 5, cameraMovement: 5, actionSequence: 5, lightingMood: 5, veoCompatibility: 5 },
        suggestions: [],
      });
    }

    if (!rawText) {
      console.warn("[verify-prompt] 빈 응답. finishReason:", finishReason);
      return Response.json({
        scoringFailure: true,
        overallScore: 50,
        issues: [`채점 응답 없음 (finishReason: ${finishReason ?? "unknown"}) — 생성은 계속 진행 가능`],
        scores: { characterDescription: 5, cameraMovement: 5, actionSequence: 5, lightingMood: 5, veoCompatibility: 5 },
        suggestions: [],
      });
    }

    // ── 파싱 시도 (다단계)
    // 디버깅: 실제 응답 원문을 로그에 남김
    console.log("[verify-prompt] Gemini 응답 원문 (첫 600자):", rawText.slice(0, 600));

    const parsed = tryParseJson(rawText);

    if (!parsed) {
      // ── 모든 파싱 실패 → scoringFailure: true, 생성 차단하지 않음
      console.error(
        "[verify-prompt] 파싱 완전 실패.",
        "\n  finishReason:", finishReason,
        "\n  rawText:", rawText.slice(0, 400)
      );
      return Response.json({
        scoringFailure: true,
        overallScore: 50,
        issues: ["채점 응답 파싱 실패 — 생성은 계속 진행 가능 (이 점수는 무시됩니다)"],
        scores: { characterDescription: 5, cameraMovement: 5, actionSequence: 5, lightingMood: 5, veoCompatibility: 5 },
        suggestions: [],
        _rawResponsePreview: rawText.slice(0, 200),
      });
    }

    // ── 파싱 성공 — 필드 정규화
    const overallScore = normalizeScore(parsed);
    const scores = normalizeSubScores(parsed);
    const issues = normalizeStringArray(parsed, "issues");
    const suggestions = normalizeStringArray(parsed, "suggestions");

    const improvedVideoPrompt =
      typeof parsed.improvedVideoPrompt === "string" && parsed.improvedVideoPrompt.trim().length > 20
        ? parsed.improvedVideoPrompt.trim()
        : typeof parsed.improved_video_prompt === "string" && (parsed.improved_video_prompt as string).trim().length > 20
          ? (parsed.improved_video_prompt as string).trim()
          : undefined;

    const improvedExtendPrompt =
      typeof parsed.improvedExtendPrompt === "string" && parsed.improvedExtendPrompt.trim().length > 20
        ? parsed.improvedExtendPrompt.trim()
        : typeof parsed.improved_extend_prompt === "string" && (parsed.improved_extend_prompt as string).trim().length > 20
          ? (parsed.improved_extend_prompt as string).trim()
          : undefined;

    // overallScore 정규화 실패 → 채점 불가 (차단하지 않음)
    if (overallScore < 0) {
      console.warn("[verify-prompt] overallScore 정규화 실패. parsed:", JSON.stringify(parsed).slice(0, 200));
      return Response.json({
        scoringFailure: true,
        overallScore: 50,
        scores,
        issues: issues.length > 0 ? issues : ["채점 점수 파싱 불가 — 생성은 계속 진행 가능"],
        suggestions,
        improvedVideoPrompt,
        improvedExtendPrompt,
      });
    }

    console.log(`[verify-prompt] CUT ${cutNumber} 점수: ${overallScore}/100`, issues.length > 0 ? `문제: ${issues.slice(0, 2).join(" | ")}` : "");

    return Response.json({
      overallScore,
      scores,
      issues,
      suggestions,
      ...(improvedVideoPrompt && { improvedVideoPrompt }),
      ...(improvedExtendPrompt && { improvedExtendPrompt }),
    });
  } catch (error) {
    console.error("[verify-prompt] 처리 중 오류:", error);
    // 예외 발생 시에도 채점 불가로 처리 — 500 반환 대신 생성 계속 진행 가능하게
    return Response.json({
      scoringFailure: true,
      overallScore: 50,
      issues: ["채점 처리 중 오류 발생 — 생성은 계속 진행 가능"],
      scores: { characterDescription: 5, cameraMovement: 5, actionSequence: 5, lightingMood: 5, veoCompatibility: 5 },
      suggestions: [],
    });
  }
};
