import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { text, voiceName = "ko-KR-Wavenet-A", speakingRate = 1.0 } = await req.json();
    if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

    const token = await getAccessToken();
    const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "ko-KR", name: voiceName },
        audioConfig: { audioEncoding: "MP3", speakingRate },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: "TTS 실패", detail: err }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json({ audioBase64: data.audioContent });
  } catch (err) {
    console.error("[tts]", err);
    return NextResponse.json({ error: "TTS 실패" }, { status: 500 });
  }
}
