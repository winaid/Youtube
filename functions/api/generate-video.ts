interface Env {
  GEMINI_API_KEY: string;
}

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { prompt, mode, referenceImageBase64, previousVideoUri } =
      await context.request.json() as {
        prompt: string;
        mode?: "fast" | "quality";
        referenceImageBase64?: string;
        previousVideoUri?: string;
      };

    if (!prompt) {
      return Response.json({ error: "prompt is required" }, { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const model = mode === "quality"
      ? "veo-3.1-generate-preview"
      : "veo-3.1-fast-generate-preview";

    // Build instances
    const instance: Record<string, unknown> = { prompt };

    // Scene Extension: 이전 영상 URI로 연장
    if (previousVideoUri) {
      instance.video = { uri: previousVideoUri };
    }

    // Reference image for character consistency
    if (referenceImageBase64) {
      instance.referenceImages = [{
        referenceImage: {
          imageBytes: referenceImageBase64,
        },
        referenceType: "STYLE_IMAGE",
      }];
    }

    const requestBody = {
      instances: [instance],
      parameters: {
        aspectRatio: "1:1",
        durationSeconds: 8,
        personGeneration: "allow_all",
        generateAudio: true,
        resolution: "720p",
      },
    };

    const res = await fetch(`${BASE_URL}/models/${model}:predictLongRunning?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Veo API error:", res.status, errText);
      return Response.json(
        { error: `Veo API error: ${res.status}`, details: errText },
        { status: res.status }
      );
    }

    const data = await res.json() as { name: string };

    return Response.json({
      operationName: data.name,
      model,
      status: "RUNNING",
    });
  } catch (error) {
    console.error("Video generation error:", error);
    return Response.json(
      { error: `Failed to start video generation: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
};
