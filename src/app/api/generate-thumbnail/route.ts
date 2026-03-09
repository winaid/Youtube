import { NextRequest, NextResponse } from "next/server";
import { getAccessToken, PROJECT_ID, LOCATION } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

    const token = await getAccessToken();
    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-generate-001:predict`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: "16:9",
          safetySetting: "block_only_high",
          personGeneration: "allow_all",
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: "썸네일 생성 실패", detail: err }, { status: 502 });
    }

    const data = await res.json();
    const base64 = data.predictions?.[0]?.bytesBase64Encoded ?? null;
    return NextResponse.json({ base64 });
  } catch (err) {
    console.error("[generate-thumbnail]", err);
    return NextResponse.json({ error: "썸네일 생성 실패" }, { status: 500 });
  }
}
