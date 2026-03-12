/**
 * generate-narration.ts — structuredSequence 기반 TTS 나레이션 생성 + R2 저장
 *
 * 각 shot의 narrationText (또는 sceneDescription fallback)를 TTS로 변환,
 * shot durationSec에 맞춰 sync 처리 후 R2에 저장.
 *
 * source of truth: structuredSequence
 * TTS engine: Google Cloud Text-to-Speech (ko-KR-Wavenet-A)
 */

interface Env {
  GOOGLE_CLOUD_API_KEY: string;
  VIDEO_BUCKET?: R2Bucket;
  VIDEO_BUCKET_DOMAIN?: string;
}

const TTS_API_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

interface NarrationShot {
  cutNumber: number;
  shotId: string;
  narrationText: string;
  durationSec: number;
  startSec: number;
  endSec: number;
}

interface NarrationRequest {
  sessionId: string;
  shots: NarrationShot[];
  voiceName?: string;
  speakingRate?: number;
}

interface NarrationTrackResult {
  cutNumber: number;
  audioUri: string;
  r2Key: string;
  text: string;
  durationSec: number;
  syncStatus: "exact" | "trimmed" | "padded";
  generatedAt: number;
}

/** MP3 duration 추정: base64 → byte → bitrate 기반 근사 (128kbps MP3) */
function estimateMp3Duration(base64Length: number): number {
  const bytes = (base64Length * 3) / 4;
  // Google TTS MP3: ~32kbps (Wavenet) 기본 설정
  return bytes / (32 * 1000 / 8);
}

/** 나레이션 텍스트의 적정 speakingRate 계산 (shot duration에 맞추기) */
function calcSpeakingRate(textLength: number, targetDurationSec: number, baseRate: number): number {
  // 한국어 평균: ~4글자/초 (speakingRate=1.0 기준)
  const estimatedDurationAtBase = (textLength / 4) * (1 / baseRate);
  if (estimatedDurationAtBase <= 0 || targetDurationSec <= 0) return baseRate;

  const needed = estimatedDurationAtBase / targetDurationSec;
  // speakingRate 범위: 0.25 ~ 4.0 (Google TTS 제한)
  return Math.min(4.0, Math.max(0.25, needed * baseRate));
}

async function generateTTS(
  apiKey: string,
  text: string,
  voiceName: string,
  speakingRate: number,
): Promise<{ audioBase64: string; estimatedDuration: number }> {
  const res = await fetch(`${TTS_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text: text.slice(0, 5000) },
      voice: {
        languageCode: "ko-KR",
        name: voiceName,
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate,
        pitch: 0,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TTS API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json() as { audioContent?: string };
  if (!data.audioContent) {
    throw new Error("TTS returned no audio content");
  }

  return {
    audioBase64: data.audioContent,
    estimatedDuration: estimateMp3Duration(data.audioContent.length),
  };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const stripped = base64.replace(/^data:[^;]+;base64,/, "");
  const binary = atob(stripped);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const startMs = Date.now();
  const warnings: string[] = [];

  try {
    const req = await context.request.json() as NarrationRequest;

    if (!req.shots?.length) {
      return Response.json({ error: "shots array is required" }, { status: 400 });
    }
    if (!req.sessionId) {
      return Response.json({ error: "sessionId is required" }, { status: 400 });
    }

    const apiKey = context.env.GOOGLE_CLOUD_API_KEY;
    if (!apiKey) {
      return Response.json({
        error: "GOOGLE_CLOUD_API_KEY not configured",
        audioIncluded: false,
        deliveryMode: "none",
        warnings: ["TTS API key missing — narration generation skipped"],
      }, { status: 500 });
    }

    const voiceName = req.voiceName || "ko-KR-Wavenet-A";
    const baseRate = req.speakingRate || 1.0;
    const hasR2 = !!context.env.VIDEO_BUCKET;

    const tracks: NarrationTrackResult[] = [];
    const errors: Array<{ cutNumber: number; error: string }> = [];

    // 각 shot별 TTS 생성 (순차 처리 — API rate limit 고려)
    for (const shot of req.shots) {
      const text = shot.narrationText?.trim();
      if (!text) {
        warnings.push(`Cut ${shot.cutNumber}: narration text empty, skipped`);
        continue;
      }

      try {
        // shot duration에 맞는 speakingRate 계산
        const adjustedRate = calcSpeakingRate(text.length, shot.durationSec, baseRate);
        const adjustedRateRounded = Math.round(adjustedRate * 100) / 100;

        const { audioBase64, estimatedDuration } = await generateTTS(
          apiKey, text, voiceName, adjustedRateRounded,
        );

        // Sync 상태 판정
        let syncStatus: "exact" | "trimmed" | "padded" = "exact";
        const tolerance = 0.5; // 0.5초 오차 허용
        if (estimatedDuration > shot.durationSec + tolerance) {
          syncStatus = "trimmed";
          warnings.push(`Cut ${shot.cutNumber}: audio ${estimatedDuration.toFixed(1)}s > shot ${shot.durationSec}s — will be trimmed`);
        } else if (estimatedDuration < shot.durationSec - tolerance) {
          syncStatus = "padded";
        }

        // R2 업로드
        let audioUri = "";
        let r2Key = "";

        if (hasR2) {
          r2Key = `audio/${req.sessionId}/cut-${shot.cutNumber}/${Date.now()}.mp3`;
          const buffer = base64ToArrayBuffer(audioBase64);

          await context.env.VIDEO_BUCKET!.put(r2Key, buffer, {
            httpMetadata: { contentType: "audio/mpeg" },
          });

          const domain = context.env.VIDEO_BUCKET_DOMAIN;
          const requestOrigin = new URL(context.request.url).origin;
          audioUri = domain
            ? `https://${domain}/${r2Key}`
            : `${requestOrigin}/api/proxy-video?r2key=${encodeURIComponent(r2Key)}`;
        } else {
          // R2 없으면 data URI 반환 (fallback)
          audioUri = `data:audio/mpeg;base64,${audioBase64}`;
          warnings.push(`Cut ${shot.cutNumber}: R2 not available, returning data URI`);
        }

        tracks.push({
          cutNumber: shot.cutNumber,
          audioUri,
          r2Key,
          text,
          durationSec: estimatedDuration,
          syncStatus,
          generatedAt: Date.now(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ cutNumber: shot.cutNumber, error: msg });
        warnings.push(`Cut ${shot.cutNumber}: TTS failed — ${msg}`);
      }
    }

    const allFailed = tracks.length === 0 && errors.length > 0;
    const partialFailed = errors.length > 0 && tracks.length > 0;

    if (allFailed) {
      return Response.json({
        audioIncluded: false,
        audioTracks: [],
        narrationUsed: false,
        deliveryMode: "none" as const,
        errors,
        warnings: [...warnings, "All TTS generations failed — degraded mode (no audio)"],
        durationMs: Date.now() - startMs,
      });
    }

    if (partialFailed) {
      warnings.push(`${errors.length} of ${req.shots.length} shots failed TTS — partial audio`);
    }

    return Response.json({
      audioIncluded: true,
      audioTracks: tracks,
      narrationUsed: true,
      deliveryMode: "separate" as const,
      trackCount: tracks.length,
      totalShots: req.shots.length,
      errors: errors.length > 0 ? errors : undefined,
      warnings,
      durationMs: Date.now() - startMs,
    });
  } catch (error) {
    console.error("[generate-narration] error:", error);
    return Response.json({
      error: `Narration generation failed: ${error instanceof Error ? error.message : String(error)}`,
      audioIncluded: false,
      deliveryMode: "none",
      warnings: ["Unhandled error in narration generation"],
    }, { status: 500 });
  }
};
