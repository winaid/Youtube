interface Env {
  GOOGLE_CLOUD_API_KEY: string;
}

const TTS_API_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const startMs = Date.now();
  console.info("[tts] Request received");
  try {
    const { text, voiceName, speakingRate } = await context.request.json() as {
      text: string;
      voiceName?: string;
      speakingRate?: number;
    };
    console.info(`[tts] Parsed request: textLen=${text?.length ?? 0}, voiceName=${voiceName ?? "(default)"}, speakingRate=${speakingRate ?? "(default)"}`);

    if (!text?.trim()) {
      console.info("[tts] Validation failed: text is empty");
      return Response.json({ error: "text is required" }, { status: 400 });
    }

    const apiKey = context.env.GOOGLE_CLOUD_API_KEY;
    if (!apiKey) {
      console.info("[tts] GOOGLE_CLOUD_API_KEY not configured");
      return Response.json({ error: "GOOGLE_CLOUD_API_KEY not configured" }, { status: 500 });
    }

    console.info(`[tts] Calling Google TTS API, textLen=${text.slice(0, 5000).length}, voice=${voiceName || "ko-KR-Wavenet-A"}`);
    const apiCallStart = Date.now();
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

    console.info(`[tts] Google TTS API responded: status=${res.status}, elapsed=${Date.now() - apiCallStart}ms`);

    if (!res.ok) {
      const errText = await res.text();
      console.info(`[tts] TTS API error: status=${res.status}, body=${errText.slice(0, 200)}, elapsed=${Date.now() - startMs}ms`);
      console.error("TTS API error:", res.status, errText);
      return Response.json({ error: `TTS API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as { audioContent?: string };
    console.info(`[tts] Parsing response: audioContent present=${!!data.audioContent}, audioLen=${data.audioContent?.length ?? 0}`);

    if (!data.audioContent) {
      console.info(`[tts] No audio content in response, elapsed=${Date.now() - startMs}ms`);
      return Response.json({ error: "No audio generated" }, { status: 500 });
    }

    console.info(`[tts] Final response: audioBase64 length=${data.audioContent.length}, elapsed=${Date.now() - startMs}ms`);
    return Response.json({ audioBase64: data.audioContent });
  } catch (error) {
    console.info(`[tts] Unhandled error caught: ${error instanceof Error ? error.message : String(error)}, elapsed=${Date.now() - startMs}ms`);
    console.error("TTS error:", error);
    return Response.json({ error: "Failed to generate speech" }, { status: 500 });
  }
};
