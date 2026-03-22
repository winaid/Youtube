/**
 * tts-gemini.ts — Gemini TTS Pro 엔드포인트
 *
 * Google Cloud TTS(tts.ts)와 별개로, Gemini 2.5 Pro Preview TTS 모델을 사용.
 * 고품질 보이스 (Enceladus, Charon 등) 지원.
 * WAV base64 출력 → 클라이언트에서 직접 재생/FFmpeg 합성 가능.
 *
 * 용도: 오디오북/명언 영상 나레이션
 */

import { GeminiEnv, getApiKeys } from "./_gemini-keys";

type Env = GeminiEnv;

/** Gemini TTS 전용 모델 — 다른 모델로 바꾸지 않음 */
const GEMINI_TTS_MODEL = "gemini-2.5-pro-preview-tts";

/** 지원 보이스 목록 (Gemini TTS Pro) */
const VALID_VOICES = [
  "Enceladus", "Charon", "Kore", "Fenrir", "Aoede",
  "Puck", "Leda", "Orus", "Zephyr",
] as const;
type GeminiVoice = (typeof VALID_VOICES)[number];

interface TtsGeminiRequest {
  /** 읽을 텍스트 (한국어/영어) */
  text: string;
  /** 보이스 이름 (기본: Enceladus) */
  voice?: string;
  /** 말하기 속도 — slow(0.8) / natural(1.0) / fast(1.2) */
  speed?: "slow" | "natural" | "fast";
}

const SPEED_MAP: Record<string, number> = {
  slow: 0.8,
  natural: 1.0,
  fast: 1.2,
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { text, voice, speed } = await context.request.json() as TtsGeminiRequest;

    if (!text?.trim()) {
      return Response.json({ error: "text is required" }, { status: 400 });
    }

    // 보이스 유효성 검증
    const selectedVoice: GeminiVoice = VALID_VOICES.includes(voice as GeminiVoice)
      ? (voice as GeminiVoice)
      : "Enceladus";

    const keys = getApiKeys(context.env);
    if (keys.length === 0) {
      return Response.json({
        error: "GEMINI_API_KEY not configured",
        help: "Cloudflare Pages 환경변수에 GEMINI_API_KEY를 설정하세요.",
      }, { status: 500 });
    }

    // 텍스트 길이 제한 (Gemini TTS 제한)
    const trimmedText = text.slice(0, 5000);

    const requestBody = {
      contents: [{
        parts: [{ text: trimmedText }],
      }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: selectedVoice,
            },
          },
        },
      },
    };

    // API 호출 (키 폴백)
    let lastError = "";
    for (const key of keys) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${key}`;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.warn(`[tts-gemini] Key failed (${res.status}):`, errText.slice(0, 300));
          lastError = errText;
          // 429/503 → 다음 키 시도
          if (res.status === 429 || res.status === 503 || res.status === 401) continue;
          // 다른 에러는 즉시 반환
          return Response.json({
            error: `Gemini TTS API error: ${res.status}`,
            detail: errText.slice(0, 500),
          }, { status: res.status });
        }

        const data = await res.json() as {
          candidates?: {
            content?: {
              parts?: { inlineData?: { mimeType: string; data: string } }[];
            };
          }[];
        };

        // 오디오 데이터 추출
        const audioPart = data?.candidates?.[0]?.content?.parts?.find(
          (p) => p.inlineData?.data
        );

        if (!audioPart?.inlineData) {
          return Response.json({
            error: "No audio generated — Gemini가 오디오를 반환하지 않았습니다.",
          }, { status: 422 });
        }

        return Response.json({
          audioBase64: audioPart.inlineData.data,
          mimeType: audioPart.inlineData.mimeType || "audio/wav",
          voice: selectedVoice,
          model: GEMINI_TTS_MODEL,
          textLength: trimmedText.length,
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn("[tts-gemini] Fetch error:", lastError);
        continue;
      }
    }

    // 모든 키 실패
    return Response.json({
      error: "All API keys exhausted for Gemini TTS",
      detail: lastError.slice(0, 500),
    }, { status: 502 });
  } catch (error) {
    console.error("[tts-gemini] Unexpected error:", error);
    return Response.json({
      error: `TTS generation failed: ${error instanceof Error ? error.message : String(error)}`,
    }, { status: 500 });
  }
};
