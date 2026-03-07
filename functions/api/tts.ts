interface Env {
  GOOGLE_CLOUD_API_KEY: string;
}

const TTS_API_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { text, voiceName, speakingRate } = await context.request.json() as {
      text: string;
      voiceName?: string;
      speakingRate?: number;
    };

    if (!text?.trim()) {
      return Response.json({ error: "text is required" }, { status: 400 });
    }

    const apiKey = context.env.GOOGLE_CLOUD_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GOOGLE_CLOUD_API_KEY not configured" }, { status: 500 });
    }

    const res = await fetch(`${TTS_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: text.slice(0, 5000) },
        voice: {
          languageCode: "ko-KR",
          name: voiceName || "ko-KR-Wavenet-A",
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: speakingRate || 1.0,
          pitch: 0,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("TTS API error:", res.status, errText);
      return Response.json({ error: `TTS API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as { audioContent?: string };

    if (!data.audioContent) {
      return Response.json({ error: "No audio generated" }, { status: 500 });
    }

    return Response.json({ audioBase64: data.audioContent });
  } catch (error) {
    console.error("TTS error:", error);
    return Response.json({ error: "Failed to generate speech" }, { status: 500 });
  }
};
