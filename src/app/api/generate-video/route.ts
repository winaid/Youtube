import { NextRequest, NextResponse } from "next/server";
import { getAccessToken, PROJECT_ID, LOCATION } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const {
      prompt, aspectRatio = "16:9", durationSeconds = 6,
      firstFrameBase64, lastFrameBase64, referenceImages = [],
      negativePrompt, personGeneration = "allow_all", seed, sampleCount = 1,
    } = await req.json();

    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

    const token = await getAccessToken();
    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/veo-3.1-generate-001:predictLongRunning`;

    const instance: Record<string, unknown> = {
      prompt,
      aspectRatio,
      durationSeconds,
      personGeneration,
      sampleCount,
    };

    if (negativePrompt) instance.negativePrompt = negativePrompt;
    if (seed != null) instance.seed = seed;

    // First frame (image-to-video)
    if (firstFrameBase64) {
      instance.image = { bytesBase64Encoded: firstFrameBase64 };
    }
    // Last frame
    if (lastFrameBase64) {
      instance.lastFrame = { bytesBase64Encoded: lastFrameBase64 };
    }
    // Reference images
    if (referenceImages.length > 0) {
      instance.referenceImages = referenceImages.slice(0, 3).map((b64: string) => ({
        bytesBase64Encoded: b64,
      }));
    }

    const body = { instances: [instance], parameters: {} };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[generate-video] Veo error:", errText);
      return NextResponse.json({ error: "Veo API 호출 실패", detail: errText }, { status: 502 });
    }

    const data = await res.json();
    // Returns { name: "projects/.../operations/..." }
    return NextResponse.json({ operationName: data.name });
  } catch (err) {
    console.error("[generate-video]", err);
    return NextResponse.json({ error: "영상 생성 실패", detail: String(err) }, { status: 500 });
  }
}
