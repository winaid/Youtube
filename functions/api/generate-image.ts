interface Env {
  GEMINI_API_KEY: string;
}

const IMAGEN_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict";

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

    if (!res.ok) {
      const errText = await res.text();
      console.error("Imagen API error:", res.status, errText);
      return Response.json({ error: `Imagen API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as {
      predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
    };

    const images = (data.predictions || [])
      .filter((p) => p.bytesBase64Encoded)
      .map((p) => ({
        base64: p.bytesBase64Encoded,
        mimeType: p.mimeType || "image/png",
      }));

    return Response.json({ images });
  } catch (error) {
    console.error("Image generation error:", error);
    return Response.json({ error: "Failed to generate image" }, { status: 500 });
  }
};
