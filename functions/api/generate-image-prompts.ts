/**
 * generate-image-prompts.ts — 나레이션 텍스트로부터 이미지 프롬프트 자동 생성
 *
 * 오디오북 씬의 나레이션(한국어)을 받아서, 각 씬에 어울리는
 * 영어 이미지 생성 프롬프트를 Gemini가 작성.
 *
 * 감정, 분위기, 철학적 깊이를 반영한 예술적 프롬프트를 생성.
 */

import { GeminiEnv, fetchWithModelFallback, geminiErrorResponse } from "./_gemini-keys";

type Env = GeminiEnv;

interface GenerateImagePromptsRequest {
  /** 씬별 나레이션 텍스트 배열 */
  scenes: { index: number; narration: string }[];
  /** 이미지 스타일 힌트 (예: "ink wash painting", "pencil sketch") */
  styleHint?: string;
  /** 전체 프로젝트 주제/분위기 힌트 */
  themeHint?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { scenes, styleHint, themeHint } = await context.request.json() as GenerateImagePromptsRequest;

    if (!scenes?.length) {
      return Response.json({ error: "scenes array is required" }, { status: 400 });
    }

    if (scenes.length > 30) {
      return Response.json({ error: "Maximum 30 scenes per request" }, { status: 400 });
    }

    const scenesDescription = scenes
      .map((s) => `Scene ${s.index}: "${s.narration}"`)
      .join("\n");

    const styleContext = styleHint
      ? `\nTarget visual style: ${styleHint}`
      : "";

    const themeContext = themeHint
      ? `\nOverall theme/mood: ${themeHint}`
      : "";

    const prompt = `You are an expert art director creating image prompts for an audiobook video.
Each scene has a narration text (Korean). Create a vivid, artistic English image prompt for each scene.

RULES:
- Each prompt should be 1-3 sentences describing the visual scene
- Capture the EMOTION and ATMOSPHERE of the narration, not just literal meaning
- Use cinematic/artistic language: composition, lighting, mood, color palette
- NEVER include any text, letters, words, or writing in the image description
- NEVER describe people reading or writing
- Focus on symbolic/metaphorical imagery that represents the philosophical meaning
- Each prompt should work as a standalone image
- Maintain visual consistency across all scenes (same world, same palette)${styleContext}${themeContext}

SCENES:
${scenesDescription}

Respond in JSON array format:
[
  {"index": 1, "imagePrompt": "..."},
  {"index": 2, "imagePrompt": "..."}
]`;

    const { response: res } = await fetchWithModelFallback(context.env, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return geminiErrorResponse(res, errText, "generate-image-prompts");
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "[]";

    let prompts;
    try {
      prompts = JSON.parse(text);
    } catch {
      // JSON 파싱 실패 시 빈 배열
      prompts = [];
    }

    if (!Array.isArray(prompts) || prompts.length === 0) {
      return Response.json({ error: "Failed to generate prompts" }, { status: 422 });
    }

    return Response.json({ prompts });
  } catch (error) {
    console.error("[generate-image-prompts] Error:", error);
    return Response.json({
      error: `Image prompt generation failed: ${error instanceof Error ? error.message : String(error)}`,
    }, { status: 500 });
  }
};
