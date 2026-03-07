interface Env {
  GEMINI_API_KEY: string;
}

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface GenerateVideoRequest {
  prompt: string;
  mode?: "fast" | "quality";
  durationSeconds?: number;
  resolution?: string;
  aspectRatio?: string;
  generateAudio?: boolean;
  negativePrompt?: string;
  personGeneration?: string;
  seed?: number;
  sampleCount?: number;
  previousVideoUri?: string;
  firstFrameBase64?: string;
  lastFrameBase64?: string;
  referenceImages?: string[];
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const req = await context.request.json() as GenerateVideoRequest;

    if (!req.prompt) {
      return Response.json({ error: "prompt is required" }, { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const model = req.mode === "quality"
      ? "veo-3.1-generate-preview"
      : "veo-3.1-fast-generate-preview";

    // === Build instance ===
    const instance: Record<string, unknown> = { prompt: req.prompt };

    // Scene Extension
    if (req.previousVideoUri) {
      instance.video = { uri: req.previousVideoUri };
    }

    // First Frame (Image-to-Video)
    if (req.firstFrameBase64) {
      instance.image = {
        bytesBase64Encoded: req.firstFrameBase64,
        mimeType: "image/png",
      };
    }

    // Last Frame
    if (req.lastFrameBase64) {
      instance.lastFrame = {
        bytesBase64Encoded: req.lastFrameBase64,
        mimeType: "image/png",
      };
    }

    // Reference Images (최대 3장)
    if (req.referenceImages && req.referenceImages.length > 0) {
      instance.referenceImages = req.referenceImages.slice(0, 3).map((base64) => ({
        referenceImage: {
          imageBytes: base64,
        },
        referenceType: "SUBJECT_IMAGE",
      }));
    }

    // === Build parameters ===
    const parameters: Record<string, unknown> = {
      aspectRatio: req.aspectRatio || "9:16",
      durationSeconds: req.durationSeconds || 8,
      personGeneration: req.personGeneration || "allow_all",
      generateAudio: req.generateAudio !== false,
      resolution: req.resolution || "720p",
      sampleCount: Math.min(4, Math.max(1, req.sampleCount || 1)),
    };

    if (req.negativePrompt) {
      parameters.negativePrompt = req.negativePrompt;
    }

    if (req.seed !== undefined && req.seed !== null) {
      parameters.seed = req.seed;
    }

    const requestBody = { instances: [instance], parameters };

    console.log("Veo request:", JSON.stringify({
      model,
      hasVideo: !!req.previousVideoUri,
      hasFirstFrame: !!req.firstFrameBase64,
      hasLastFrame: !!req.lastFrameBase64,
      refImageCount: req.referenceImages?.length || 0,
      parameters,
    }));

    const res = await fetch(`${BASE_URL}/models/${model}:predictLongRunning?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Veo API error:", res.status, errText);

      // Reference Images / Last Frame 미지원 시 fallback 재시도
      if (res.status === 400 && (req.referenceImages?.length || req.lastFrameBase64)) {
        console.log("Retrying without reference images / last frame...");
        delete instance.referenceImages;
        delete instance.lastFrame;

        const retryRes = await fetch(`${BASE_URL}/models/${model}:predictLongRunning?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instances: [instance], parameters }),
        });

        if (retryRes.ok) {
          const retryData = await retryRes.json() as { name: string };
          return Response.json({
            operationName: retryData.name,
            model,
            status: "RUNNING",
            warning: "Reference images / last frame not supported — generated without them",
          });
        }

        const retryErr = await retryRes.text();
        return Response.json(
          { error: `Veo API error (retry): ${retryRes.status}`, details: retryErr },
          { status: retryRes.status }
        );
      }

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
