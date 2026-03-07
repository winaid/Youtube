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

// Gemini Files API로 base64 이미지를 업로드하고 file URI를 반환
async function uploadImageToGemini(base64: string, apiKey: string, displayName: string): Promise<string | null> {
  try {
    // Step 1: base64 → binary
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Step 2: Upload via media.upload
    const uploadRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "X-Goog-Upload-Protocol": "raw",
          "X-Goog-Upload-Display-Name": displayName,
        },
        body: bytes,
      }
    );

    if (!uploadRes.ok) {
      console.warn("File upload failed:", uploadRes.status, await uploadRes.text().catch(() => ""));
      return null;
    }

    const uploadData = await uploadRes.json() as { file?: { uri?: string; name?: string } };
    const fileUri = uploadData.file?.uri;
    if (!fileUri) {
      console.warn("File upload returned no URI:", JSON.stringify(uploadData).slice(0, 200));
      return null;
    }

    console.log(`Uploaded ${displayName} → ${fileUri}`);
    return fileUri;
  } catch (err) {
    console.warn("File upload error:", err);
    return null;
  }
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

    // === Upload images to Gemini Files API (base64 → URI) ===
    let firstFrameUri: string | null = null;
    let lastFrameUri: string | null = null;
    const refImageUris: string[] = [];

    // 병렬 업로드
    const uploadPromises: Promise<void>[] = [];

    if (req.firstFrameBase64) {
      uploadPromises.push(
        uploadImageToGemini(req.firstFrameBase64, apiKey, "first-frame.png")
          .then((uri) => { firstFrameUri = uri; })
      );
    }
    if (req.lastFrameBase64) {
      uploadPromises.push(
        uploadImageToGemini(req.lastFrameBase64, apiKey, "last-frame.png")
          .then((uri) => { lastFrameUri = uri; })
      );
    }
    if (req.referenceImages && req.referenceImages.length > 0) {
      for (let i = 0; i < Math.min(3, req.referenceImages.length); i++) {
        uploadPromises.push(
          uploadImageToGemini(req.referenceImages[i], apiKey, `ref-image-${i}.png`)
            .then((uri) => { if (uri) refImageUris.push(uri); })
        );
      }
    }

    if (uploadPromises.length > 0) {
      await Promise.all(uploadPromises);
    }

    // === Build instance ===
    const instance: Record<string, unknown> = { prompt: req.prompt };

    // Scene Extension (이전 영상 이어 생성)
    if (req.previousVideoUri) {
      instance.video = { uri: req.previousVideoUri };
    }

    // First Frame (Image-to-Video) — URI 방식
    if (firstFrameUri) {
      instance.image = {
        fileUri: firstFrameUri,
        mimeType: "image/png",
      };
    }

    // Last Frame — URI 방식
    if (lastFrameUri) {
      instance.lastFrame = {
        fileUri: lastFrameUri,
        mimeType: "image/png",
      };
    }

    // Reference Images — URI 방식
    if (refImageUris.length > 0) {
      instance.referenceImages = refImageUris.map((uri) => ({
        image: {
          fileUri: uri,
          mimeType: "image/png",
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
      hasFirstFrame: !!firstFrameUri,
      hasLastFrame: !!lastFrameUri,
      refImageCount: refImageUris.length,
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

      // 400 에러 시 이미지 관련 필드를 모두 제거하고 재시도
      if (res.status === 400 && (firstFrameUri || lastFrameUri || refImageUris.length)) {
        console.log("Retrying without image fields (image/lastFrame/referenceImages)...");
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
            firstFrameUri && "first frame",
            lastFrameUri && "last frame",
            refImageUris.length && "reference images",
          ].filter(Boolean).join(", ");
          return Response.json({
            operationName: retryData.name,
            model,
            status: "RUNNING",
            warning: `Image features not supported by this model — generated without ${removedFeatures}`,
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
