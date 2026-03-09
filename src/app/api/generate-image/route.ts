import { NextRequest, NextResponse } from "next/server";
import { getAccessToken, PROJECT_ID, LOCATION } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { prompt, aspectRatio = "9:16", sampleCount = 1 } = await req.json();
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

    const token = await getAccessToken();
    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-generate-001:predict`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount,
          aspectRatio,
          safetySetting: "block_only_high",
          personGeneration: "allow_all",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[generate-image] Imagen error:", errText);
      return NextResponse.json({ error: "이미지 생성 실패", detail: errText }, { status: 502 });
    }

    const data = await res.json();
    const images = (data.predictions ?? []).map((p: { bytesBase64Encoded?: string }) => ({
      base64: p.bytesBase64Encoded ?? null,
    }));

    return NextResponse.json({ images });
  } catch (err) {
    console.error("[generate-image]", err);
    return NextResponse.json({ error: "이미지 생성 실패", detail: String(err) }, { status: 500 });
  }
}
