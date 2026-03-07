interface Env {
  GEMINI_API_KEY: string;
}

const IMAGEN_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict";

const GEMINI_IMAGE_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent";

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

    // Try Imagen 3.0 first
    try {
      const res = await fetch(`${IMAGEN_API_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: Math.min(numberOfImages || 1, 4),
            aspectRatio: aspectRatio || "9:16",
            personGeneration: "allow_all",
          },
        }),
      });

      if (res.ok) {
        const data = await res.json() as {
          predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
        };

        const images = (data.predictions || [])
          .filter((p) => p.bytesBase64Encoded)
          .map((p) => ({
            base64: p.bytesBase64Encoded,
            mimeType: p.mimeType || "image/png",
          }));

        if (images.length > 0) {
          return Response.json({ images });
        }
        // If no images in response, fall through to Gemini fallback
        console.warn("Imagen returned OK but no images, trying Gemini fallback");
      } else {
        const errText = await res.text();
        console.warn("Imagen API error:", res.status, errText.slice(0, 500), "— trying Gemini fallback");
      }
    } catch (imagenErr) {
      console.warn("Imagen API call failed:", imagenErr, "— trying Gemini fallback");
    }

    // Fallback: Gemini 2.0 Flash native image generation
    const geminiRes = await fetch(`${GEMINI_IMAGE_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `Generate a storyboard image for this scene. ${aspectRatio === "16:9" ? "Landscape 16:9 format." : aspectRatio === "1:1" ? "Square 1:1 format." : "Portrait 9:16 format."}\n\n${prompt}` }],
        }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini image fallback error:", geminiRes.status, errText.slice(0, 500));
      return Response.json(
        { error: `Image generation failed: Imagen ${geminiRes.status}`, details: errText.slice(0, 200) },
        { status: 500 }
      );
    }

    const geminiData = await geminiRes.json() as {
      candidates?: {
        content?: {
          parts?: { text?: string; inlineData?: { mimeType: string; data: string } }[];
        };
      }[];
    };

    const images: { base64: string; mimeType: string }[] = [];
    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        images.push({
          base64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
        });
      }
    }

    if (images.length === 0) {
      return Response.json(
        { error: "No images generated — the prompt may have been blocked by safety filters. Try simplifying the prompt." },
        { status: 422 }
      );
    }

    return Response.json({ images, source: "gemini-fallback" });
  } catch (error) {
    console.error("Image generation error:", error);
    return Response.json(
      { error: `Failed to generate image: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
};
