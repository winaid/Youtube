import { GeminiEnv, fetchWithAuth } from "./_gemini-keys";

type Env = GeminiEnv;

const BASE_URL = "https://aiplatform.googleapis.com/v1beta";

interface GeneratedSample {
  video?: { uri?: string };
  seed?: number;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { operationName } = await context.request.json() as { operationName: string };

    if (!operationName) {
      return Response.json({ error: "operationName is required" }, { status: 400 });
    }

    const res = await fetchWithAuth(context.env, `${BASE_URL}/${operationName}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Check video error:", res.status, errText);
      return Response.json(
        { error: `API error: ${res.status}`, details: errText },
        { status: res.status }
      );
    }

    const data = await res.json() as {
      done?: boolean;
      response?: {
        generateVideoResponse?: {
          generatedSamples?: GeneratedSample[];
        };
      };
      error?: { message?: string; code?: number };
      metadata?: Record<string, unknown>;
    };

    if (data.error) {
      return Response.json({
        status: "FAILED",
        error: data.error.message || "Unknown error",
      });
    }

    if (!data.done) {
      return Response.json({ status: "RUNNING" });
    }

    // Extract all samples (sampleCount > 1 일 때 여러 개)
    const samples = data.response?.generateVideoResponse?.generatedSamples;
    if (samples && samples.length > 0) {
      // Veo videoUri는 API 키가 필요 → 프록시 URL로 변환
      const toProxyUrl = (uri: string) =>
        `/api/proxy-video?uri=${encodeURIComponent(uri)}`;

      const variants = samples
        .filter((s) => s.video?.uri)
        .map((s) => ({
          videoUri: toProxyUrl(s.video!.uri!),
          rawVideoUri: s.video!.uri!,
          seed: s.seed !== undefined ? String(s.seed) : undefined,
        }));

      if (variants.length > 0) {
        return Response.json({
          status: "COMPLETED",
          videoUri: variants[0].videoUri,
          rawVideoUri: variants[0].rawVideoUri,
          seed: variants[0].seed,
          variants,
          sampleCount: variants.length,
        });
      }
    }

    return Response.json({
      status: "COMPLETED",
      videoUri: null,
      raw: data,
    });
  } catch (error) {
    console.error("Check video error:", error);
    return Response.json(
      { error: `Failed to check video: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
};
