import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

interface GeneratedSample {
  video?: { uri?: string };
  seed?: number;
}

/**
 * operationName에서 모델명을 추출.
 * 예: "projects/.../models/veo-3.1-fast-generate-preview/operations/..." → "veo-3.1-fast-generate-preview"
 */
function extractModel(operationName: string): string | null {
  const m = operationName.match(/models\/([^/]+)\/operations\//);
  return m ? m[1] : null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { operationName } = await context.request.json() as { operationName: string };

    if (!operationName) {
      return Response.json({ error: "operationName is required" }, { status: 400 });
    }

    // Veo operations는 GET /{operationName}이 아닌
    // POST :fetchPredictOperation 으로 폴링해야 함
    const model = extractModel(operationName);
    if (!model) {
      return Response.json({ error: "Could not extract model from operationName" }, { status: 400 });
    }

    const url = buildVertexUrl(context.env, model, "fetchPredictOperation");

    // Cloudflare Pages 타임아웃(100s) 전에 자체 타임아웃 설정
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25초

    let res: Response;
    try {
      res = await fetchWithAuth(context.env, url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationName }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return Response.json({ status: "RUNNING" }); // 타임아웃 → 아직 처리중으로 반환
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

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

    console.log("Veo poll response:", JSON.stringify(data).slice(0, 2000));

    // Extract all samples (sampleCount > 1 일 때 여러 개)
    // Veo 모델 버전에 따라 응답 경로가 다를 수 있음
    const samples =
      data.response?.generateVideoResponse?.generatedSamples ??
      (data as Record<string, unknown>).generatedSamples as GeneratedSample[] | undefined ??
      ((data.response as Record<string, unknown>)?.generatedSamples as GeneratedSample[] | undefined);
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
      status: "FAILED",
      error: "영상 생성은 완료되었으나 비디오 URI가 없습니다",
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
