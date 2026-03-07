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

    // Scene Extension (이전 영상 이어 생성)
    if (req.previousVideoUri) {
      instance.video = { uri: req.previousVideoUri };
    }

    // First Frame (Image-to-Video)
    if (req.firstFrameBase64) {
      instance.image = {
        inlineData: {
          mimeType: "image/png",
          data: req.firstFrameBase64,
        },
      };
    }

    // Last Frame
    if (req.lastFrameBase64) {
      instance.lastFrame = {
        inlineData: {
          mimeType: "image/png",
          data: req.lastFrameBase64,
        },
      };
    }

    // Reference Images (최대 3장) — Gemini API 형식
    if (req.referenceImages && req.referenceImages.length > 0) {
      instance.referenceImages = req.referenceImages.slice(0, 3).map((base64) => ({
        image: {
          inlineData: {
            mimeType: "image/png",
            data: base64,
          },
        },
        referenceType: "asset",
      }));
    }

    // === Build parameters (Gemini API 형식) ===
    const parameters: Record<string, unknown> = {
      aspectRatio: req.aspectRatio || "9:16",
      durationSeconds: req.durationSeconds || 8,
      personGeneration: req.personGeneration || "allow_all",
      resolution: req.resolution || "720p",
      numberOfVideos: Math.min(4, Math.max(1, req.sampleCount || 1)),
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

      // 400 에러 시 inlineData 관련 필드를 모두 제거하고 재시도
      // (Veo predictLongRunning은 inlineData를 지원하지 않음)
      if (res.status === 400 && (req.firstFrameBase64 || req.lastFrameBase64 || req.referenceImages?.length)) {
        console.log("Retrying without all inlineData fields (image/lastFrame/referenceImages)...");
        delete instance.image;
        delete instance.lastFrame;
        delete instance.referenceImages;

        const retryRes = await fetch(`${BASE_URL}/models/${model}:predictLongRunning?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instances: [instance], parameters }),
        });

        if (retryRes.ok) {
          const retryData = await retryRes.json() as { name: string };
          const removedFeatures = [
            req.firstFrameBase64 && "first frame",
            req.lastFrameBase64 && "last frame",
            req.referenceImages?.length && "reference images",
          ].filter(Boolean).join(", ");
          return Response.json({
            operationName: retryData.name,
            model,
            status: "RUNNING",
            warning: `inlineData not supported by this model — generated without ${removedFeatures}`,
          });
        }

        const retryErr = await retryRes.text();
        return Response.json(
          { error: `Veo API error (retry): ${retryRes.status}`, details: retryErr.slice(0, 300) },
          { status: retryRes.status }
        );
      }

      // Parse error details for user-friendly message
      let errorDetail = errText.slice(0, 300);
      try {
        const parsed = JSON.parse(errText);
        errorDetail = parsed?.error?.message || parsed?.error?.status || errorDetail;
      } catch { /* use raw text */ }

      return Response.json(
        { error: `Veo API error (${res.status}): ${errorDetail}`, details: errText.slice(0, 500) },
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
