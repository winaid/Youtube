import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_IMAGE, GEMINI_MODEL_IMAGE_FB, geminiErrorResponse } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const requestStart = Date.now();
  console.info("[generate-image] Request received", { method: context.request.method, url: context.request.url });
  try {
    const { prompt, aspectRatio, numberOfImages, sceneDescription, animationMode, stylePrompt, directorTechniques, preferModel } = await context.request.json() as {
      prompt: string;
      aspectRatio?: string;
      numberOfImages?: number;
      /** "pro" = 나노바나나 프로 우선 (복잡한 프롬프트), "fast" = 나노바나나2 우선 (기본값) */
      preferModel?: "pro" | "fast";
      sceneDescription?: string;
      /** 레거시 한국어 키 또는 스타일 카탈로그 ID */
      animationMode?: string;
      /** 스타일 카탈로그의 positivePrompt 직접 전달 (animationMode보다 우선) */
      stylePrompt?: string;
      directorTechniques?: {
        cameraWork?: string;
        colorPalette?: string;
        lighting?: string;
        editingStyle?: string;
        moodKeywords?: string;
      };
    };

    console.info("[generate-image] Parsed params", {
      promptLength: prompt?.length ?? 0,
      aspectRatio,
      numberOfImages,
      animationMode,
      hasStylePrompt: !!stylePrompt,
      hasSceneDescription: !!sceneDescription,
      hasDirectorTechniques: !!directorTechniques,
      preferModel,
    });

    if (!prompt?.trim()) {
      console.info("[generate-image] Rejected: empty prompt");
      return Response.json({ error: "prompt is required" }, { status: 400 });
    }

    const aspectLabel = aspectRatio === "16:9" ? "Landscape 16:9 format."
      : "Portrait 9:16 format.";

    // 장면 설명이 있으면 이미지 프롬프트에 포함하여 내용 일치도 향상
    const sceneContext = sceneDescription
      ? `\nScene context: ${sceneDescription}`
      : "";

    // animationMode → 이미지 스타일 매핑
    const styleMap: Record<string, string> = {
      "실사": "Photorealistic photography. Natural lighting, real-world textures.",
      "2D 애니": "Japanese anime style illustration. Clean lines, vibrant colors, cel-shaded.",
      "수채화 애니": "Watercolor anime painting. Soft edges, translucent color washes, hand-painted feel.",
      "하이브리드": "Semi-realistic digital art. Blend of anime and photorealism.",
      "로토스코핑": "Rotoscoped animation frame. Hand-traced over live action, visible brush strokes.",
      "스톱모션": "Stop-motion puppet style. Clay/felt textures, miniature set, visible handcraft.",
      "픽셀아트": "Pixel art style. Retro 16-bit game aesthetic, clean pixel edges.",
      "잉크워시": "East Asian ink wash painting. Black ink on rice paper, minimalist brush strokes.",
      "클레이": "Claymation style. Smooth clay figures, soft studio lighting, miniature world.",
      "빈티지 필름": "Vintage 35mm film look. Warm grain, faded colors, 1970s cinema aesthetic.",
      "네온 사이버펑크": "Neon cyberpunk style. Glowing neon lights, dark city, vivid pink/blue/purple palette.",
      "미니어처": "Tilt-shift miniature photography. Tiny diorama look, shallow depth of field.",
    };
    // 우선순위: stylePrompt(직접 전달) > styleMap(레거시 키) > 기본값
    const styleDirective = stylePrompt
      || styleMap[animationMode || ""]
      || "Cinematic photography. Professional lighting.";

    // 감독 signatureTechniques → 이미지 스타일 지시
    const directorLines: string[] = [];
    if (directorTechniques) {
      if (directorTechniques.cameraWork) directorLines.push(`Camera: ${directorTechniques.cameraWork}`);
      if (directorTechniques.colorPalette) directorLines.push(`Color palette: ${directorTechniques.colorPalette}`);
      if (directorTechniques.lighting) directorLines.push(`Lighting: ${directorTechniques.lighting}`);
      if (directorTechniques.moodKeywords) directorLines.push(`Mood: ${directorTechniques.moodKeywords}`);
    }
    const directorBlock = directorLines.length > 0
      ? `\nDirector visual style:\n${directorLines.join("\n")}`
      : "";

    const imagePrompt = `Create a single storyboard frame. ${aspectLabel}
Style: ${styleDirective} One clear composition per image.${directorBlock}${sceneContext}
IMPORTANT: Do NOT render any readable text, letters, writing, characters, calligraphy, stamps, or inscriptions on the image. If the scene involves a document, scroll, letter, or book, show it as a prop but keep its surface blank or illegibly blurred — never show actual readable content.

${prompt}`;

    const requestBody = {
      contents: [{
        parts: [{ text: imagePrompt }],
      }],
      generationConfig: {
        responseModalities: ["IMAGE"],
      },
    };

    // 모델 순서 결정: preferModel="pro"이면 프로 먼저, 아니면 나노바나나2 먼저
    const primaryModel = preferModel === "pro" ? GEMINI_MODEL_IMAGE_FB : GEMINI_MODEL_IMAGE;
    const fallbackModel = preferModel === "pro" ? GEMINI_MODEL_IMAGE : GEMINI_MODEL_IMAGE_FB;
    const primaryName = preferModel === "pro" ? "nano-banana-pro" : "nano-banana-2";
    const fallbackName = preferModel === "pro" ? "nano-banana-2" : "nano-banana-pro";

    console.info("[generate-image] Model selection", { primaryName, fallbackName, preferModel, imagePromptLength: imagePrompt.length });

    // 1차 시도
    try {
      const primaryStart = Date.now();
      console.info(`[generate-image] Primary API call starting`, { model: primaryName });
      const res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, primaryModel), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const primaryElapsed = Date.now() - primaryStart;

      if (res.ok) {
        console.info(`[generate-image] Primary API response OK`, { model: primaryName, status: res.status, elapsedMs: primaryElapsed });
        const images = extractImages(await res.json());
        if (images.length > 0) {
          const totalElapsed = Date.now() - requestStart;
          console.info(`[generate-image] Success via primary model`, { model: primaryName, imageCount: images.length, totalElapsedMs: totalElapsed });
          return Response.json({ images, source: primaryName });
        }
        console.warn(`${primaryName} returned OK but no images, trying fallback`);
      } else {
        const errText = await res.text();
        console.info(`[generate-image] Primary API error response`, { model: primaryName, status: res.status, elapsedMs: primaryElapsed, error: errText.slice(0, 300) });
        console.warn(`${primaryName} error:`, res.status, errText.slice(0, 300), "— trying fallback");
      }
    } catch (err) {
      console.info(`[generate-image] Primary API call exception`, { model: primaryName, error: err instanceof Error ? err.message : String(err) });
      console.warn(`${primaryName} call failed:`, err, "— trying fallback");
    }

    // 2차 폴백
    const fallbackStart = Date.now();
    console.info(`[generate-image] Fallback API call starting`, { model: fallbackName });
    const fallbackRes = await fetchWithAuth(context.env, buildGeminiUrl(context.env, fallbackModel), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const fallbackElapsed = Date.now() - fallbackStart;

    if (!fallbackRes.ok) {
      const errText = await fallbackRes.text();
      console.info(`[generate-image] Fallback API error response`, { model: fallbackName, status: fallbackRes.status, elapsedMs: fallbackElapsed, error: errText.slice(0, 500) });
      console.error(`${fallbackName} fallback error:`, fallbackRes.status, errText.slice(0, 500));
      return geminiErrorResponse(fallbackRes, errText, "generate-image");
    }

    console.info(`[generate-image] Fallback API response OK`, { model: fallbackName, status: fallbackRes.status, elapsedMs: fallbackElapsed });
    const images = extractImages(await fallbackRes.json());
    if (images.length === 0) {
      const totalElapsed = Date.now() - requestStart;
      console.info(`[generate-image] No images extracted from fallback (safety filter?)`, { model: fallbackName, totalElapsedMs: totalElapsed });
      return Response.json(
        { error: "이미지가 생성되지 않았습니다. 안전 필터에 의해 차단되었을 수 있습니다. 프롬프트를 수정해보세요." },
        { status: 422 }
      );
    }

    const totalElapsed = Date.now() - requestStart;
    console.info(`[generate-image] Success via fallback model`, { model: fallbackName, imageCount: images.length, totalElapsedMs: totalElapsed });
    return Response.json({ images, source: fallbackName });
  } catch (error) {
    const totalElapsed = Date.now() - requestStart;
    console.info("[generate-image] Unhandled exception", { error: error instanceof Error ? error.message : String(error), totalElapsedMs: totalElapsed });
    console.error("Image generation error:", error);
    return Response.json(
      { error: `이미지 생성 실패: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
};

// Gemini generateContent 응답에서 이미지 추출
function extractImages(data: {
  candidates?: {
    content?: {
      parts?: { text?: string; inlineData?: { mimeType: string; data: string } }[];
    };
  }[];
}): { base64: string; mimeType: string }[] {
  const images: { base64: string; mimeType: string }[] = [];
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      images.push({
        base64: part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/png",
      });
    }
  }
  return images;
}
