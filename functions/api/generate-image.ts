interface Env {
  GEMINI_API_KEY: string;
}

// 나노바나나 프로 (Nano Banana Pro) = Gemini 3 Pro Image
const NANO_BANANA_PRO_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent";

// 나노바나나 2 (Nano Banana 2) = Gemini 3.1 Flash Image (폴백)
const NANO_BANANA_2_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { prompt, aspectRatio, numberOfImages } = await context.request.json() as {
      prompt: string;
      aspectRatio?: string;
      numberOfImages?: number;
    };

    if (!prompt?.trim()) {
      return Response.json({ error: "prompt is required" }, { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const aspectLabel = aspectRatio === "16:9" ? "Landscape 16:9 format."
      : aspectRatio === "1:1" ? "Square 1:1 format."
      : "Portrait 9:16 format.";

    const imagePrompt = `Generate a high-quality cinematic storyboard image. ${aspectLabel}\n\n${prompt}`;

    const requestBody = {
      contents: [{
        parts: [{ text: imagePrompt }],
      }],
      generationConfig: {
        responseModalities: ["IMAGE"],
      },
    };

    // 1차: 나노바나나 프로 (Gemini 3 Pro Image) — 최고 품질
    try {
      const res = await fetch(`${NANO_BANANA_PRO_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (res.ok) {
        const images = extractImages(await res.json());
        if (images.length > 0) {
          return Response.json({ images, source: "nano-banana-pro" });
        }
        console.warn("Nano Banana Pro returned OK but no images, trying fallback");
      } else {
        const errText = await res.text();
        console.warn("Nano Banana Pro error:", res.status, errText.slice(0, 300), "— trying fallback");
      }
    } catch (err) {
      console.warn("Nano Banana Pro call failed:", err, "— trying fallback");
    }

    // 2차: 나노바나나 2 (Gemini 3.1 Flash Image) — 빠른 폴백
    const fallbackRes = await fetch(`${NANO_BANANA_2_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!fallbackRes.ok) {
      const errText = await fallbackRes.text();
      console.error("Nano Banana 2 fallback error:", fallbackRes.status, errText.slice(0, 500));
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

    return Response.json({ images, source: "nano-banana-2" });
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
