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
async function uploadToGeminiFiles(base64: string, apiKey: string, displayName: string): Promise<string | null> {
  try {
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

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
      console.warn(`File upload failed (${uploadRes.status}):`, await uploadRes.text().catch(() => ""));
      return null;
    }

    const data = await uploadRes.json() as { file?: { uri?: string } };
    const uri = data.file?.uri;
    if (uri) console.log(`Uploaded ${displayName} → ${uri}`);
    return uri || null;
  } catch (err) {
    console.warn("File upload error:", err);
    return null;
  }
}

// 이미지 필드를 Veo predictLongRunning 포맷으로 생성
// Strategy 1: fileUri (Gemini Files API URI)
// Strategy 2: bytesBase64Encoded (inline base64)
function makeImageField(fileUri: string | null, base64: string | undefined): Record<string, unknown> | null {
  if (fileUri) {
    return { fileUri, mimeType: "image/png" };
  }
  if (base64) {
    return { bytesBase64Encoded: base64, mimeType: "image/png" };
  }
  return null;
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

    // === Upload images to Gemini Files API (병렬) ===
    let firstFrameUri: string | null = null;
    let lastFrameUri: string | null = null;
    const refImageUris: (string | null)[] = [];

    const uploadPromises: Promise<void>[] = [];

    if (req.firstFrameBase64) {
      uploadPromises.push(
        uploadToGeminiFiles(req.firstFrameBase64, apiKey, "first-frame.png")
          .then((uri) => { firstFrameUri = uri; })
      );
    }
    if (req.lastFrameBase64) {
      uploadPromises.push(
        uploadToGeminiFiles(req.lastFrameBase64, apiKey, "last-frame.png")
          .then((uri) => { lastFrameUri = uri; })
      );
    }
    if (req.referenceImages && req.referenceImages.length > 0) {
      for (let i = 0; i < Math.min(3, req.referenceImages.length); i++) {
        const idx = i;
        uploadPromises.push(
          uploadToGeminiFiles(req.referenceImages[idx], apiKey, `ref-${idx}.png`)
            .then((uri) => { refImageUris[idx] = uri; })
        );
      }
    }

    if (uploadPromises.length > 0) {
      await Promise.all(uploadPromises);
    }

    // === Build instance ===
    const instance: Record<string, unknown> = { prompt: req.prompt };

    // Scene Extension
    if (req.previousVideoUri) {
      instance.video = { uri: req.previousVideoUri };
    }

    // First Frame — fileUri 우선, 실패 시 bytesBase64Encoded 폴백
    const firstFrameField = makeImageField(firstFrameUri, req.firstFrameBase64);
    if (firstFrameField) {
      instance.image = firstFrameField;
    }

    // Last Frame
    const lastFrameField = makeImageField(lastFrameUri, req.lastFrameBase64);
    if (lastFrameField) {
      instance.lastFrame = lastFrameField;
    }

    // Reference Images
    const validRefFields: Record<string, unknown>[] = [];
    if (req.referenceImages) {
      for (let i = 0; i < Math.min(3, req.referenceImages.length); i++) {
        const field = makeImageField(refImageUris[i] || null, req.referenceImages[i]);
        if (field) {
          validRefFields.push({ image: field, referenceType: "asset" });
        }
      }
    }
    if (validRefFields.length > 0) {
      instance.referenceImages = validRefFields;
    }

    const hasImageFields = !!(instance.image || instance.lastFrame || instance.referenceImages);

    // === Build parameters ===
    const parameters: Record<string, unknown> = {
      aspectRatio: req.aspectRatio || "9:16",
      personGeneration: req.personGeneration || "allow_all",
      numberOfVideos: Math.min(4, Math.max(1, req.sampleCount || 1)),
    };

    // durationSeconds: 5 or 8 only
    const dur = req.durationSeconds || 8;
    parameters.durationSeconds = dur <= 5 ? 5 : 8;

    if (req.negativePrompt) {
      parameters.negativePrompt = req.negativePrompt;
    }
    if (req.seed !== undefined && req.seed !== null) {
      parameters.seed = req.seed;
    }

    console.log("Veo request:", JSON.stringify({
      model,
      hasVideo: !!req.previousVideoUri,
      hasFirstFrame: !!instance.image,
      hasLastFrame: !!instance.lastFrame,
      refImageCount: validRefFields.length,
      imageStrategy: firstFrameUri ? "fileUri" : (req.firstFrameBase64 ? "bytesBase64Encoded" : "none"),
      parameters,
    }));

    // === Attempt 1: 이미지 포함 요청 ===
    const attempt = async (inst: Record<string, unknown>, params: Record<string, unknown>) => {
      return fetch(`${BASE_URL}/models/${model}:predictLongRunning?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instances: [inst], parameters: params }),
      });
    };

    let res = await attempt(instance, parameters);

    // === Attempt 2: fileUri로 400이면 bytesBase64Encoded로 재시도 ===
    if (!res.ok && res.status === 400 && hasImageFields && firstFrameUri) {
      const errText = await res.text();
      console.warn("Attempt 1 failed (fileUri):", errText.slice(0, 200));

      // fileUri → bytesBase64Encoded 로 교체
      if (req.firstFrameBase64) {
        instance.image = { bytesBase64Encoded: req.firstFrameBase64, mimeType: "image/png" };
      }
      if (req.lastFrameBase64) {
        instance.lastFrame = { bytesBase64Encoded: req.lastFrameBase64, mimeType: "image/png" };
      }
      if (req.referenceImages && req.referenceImages.length > 0) {
        instance.referenceImages = req.referenceImages.slice(0, 3).map((b64) => ({
          image: { bytesBase64Encoded: b64, mimeType: "image/png" },
          referenceType: "asset",
        }));
      }

      console.log("Retrying with bytesBase64Encoded...");
      res = await attempt(instance, parameters);
    }

    // === Attempt 3: 이미지 전부 제거하고 프롬프트만으로 ===
    if (!res.ok && res.status === 400 && hasImageFields) {
      const errText = await res.text();
      console.warn("Attempt 2 failed (with images):", errText.slice(0, 200));

      delete instance.image;
      delete instance.lastFrame;
      delete instance.referenceImages;

      console.log("Retrying without any image fields (prompt only)...");
      res = await attempt(instance, parameters);

      if (res.ok) {
        const data = await res.json() as { name: string };
        return Response.json({
          operationName: data.name,
          model,
          status: "RUNNING",
          warning: "이미지 참조 없이 프롬프트만으로 생성 중 (모델이 이미지 입력을 지원하지 않음)",
        });
      }
    }

    // === Attempt 4: resolution 제거 후 재시도 (일부 모델에서 미지원) ===
    if (!res.ok && res.status === 400) {
      const errText = await res.text();
      console.warn("Attempt 3 failed:", errText.slice(0, 200));

      // resolution 파라미터가 문제일 수 있음
      delete parameters.resolution;
      // numberOfVideos → 1로 축소
      parameters.numberOfVideos = 1;

      console.log("Retrying with minimal parameters...");
      res = await attempt(instance, parameters);
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error("Veo API final error:", res.status, errText);

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
