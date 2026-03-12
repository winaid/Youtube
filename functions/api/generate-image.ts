import { GeminiEnv, fetchWithAuth, buildGeminiUrl } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { prompt, aspectRatio, numberOfImages, sceneDescription, animationMode } = await context.request.json() as {
      prompt: string;
      aspectRatio?: string;
      numberOfImages?: number;
      sceneDescription?: string;
      animationMode?: string;
    };

    if (!prompt?.trim()) {
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
    const styleDirective = styleMap[animationMode || ""] || "Cinematic photography. Professional lighting.";

    const imagePrompt = `Create a single storyboard frame. ${aspectLabel}
Style: ${styleDirective} One clear composition per image.${sceneContext}
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

    // 1차: 나노바나나 2 (Gemini 3.1 Flash Image) — 7.5배 빠르고 4K 지원, 가성비 최고
    try {
      const res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, "gemini-3.1-flash-image-preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (res.ok) {
        const images = extractImages(await res.json());
        if (images.length > 0) {
          return Response.json({ images, source: "nano-banana-2" });
        }
        console.warn("Nano Banana 2 returned OK but no images, trying fallback");
      } else {
        const errText = await res.text();
        console.warn("Nano Banana 2 error:", res.status, errText.slice(0, 300), "— trying fallback");
      }
    } catch (err) {
      console.warn("Nano Banana 2 call failed:", err, "— trying fallback");
    }

    // 2차: 나노바나나 프로 (Gemini 3 Pro Image) — 고품질 폴백
    const fallbackRes = await fetchWithAuth(context.env, buildGeminiUrl(context.env, "gemini-3-pro-image-preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!fallbackRes.ok) {
      const errText = await fallbackRes.text();
      console.error("Nano Banana Pro fallback error:", fallbackRes.status, errText.slice(0, 500));
      return Response.json(
        { error: `이미지 생성 실패 (${fallbackRes.status}). 프롬프트를 단순화해보세요.`, details: errText.slice(0, 200) },
        { status: 500 }
      );
    }

    const images = extractImages(await fallbackRes.json());
    if (images.length === 0) {
      return Response.json(
        { error: "이미지가 생성되지 않았습니다. 안전 필터에 의해 차단되었을 수 있습니다. 프롬프트를 수정해보세요." },
        { status: 422 }
      );
    }

    return Response.json({ images, source: "nano-banana-pro" });
  } catch (error) {
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
