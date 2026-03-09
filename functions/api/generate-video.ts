import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

interface GenerateVideoRequest {
  prompt: string;
  mode?: "fast" | "quality";
  durationSeconds?: number;
  resolution?: string;
  aspectRatio?: string;
  generateAudio?: boolean;
  negativePrompt?: string;
  personGeneration?: string;
  seed?: number;
  sampleCount?: number;
  previousVideoUri?: string;
  firstFrameBase64?: string;
  lastFrameBase64?: string;
  referenceImages?: string[];
}

function inlineImage(base64: string) {
  return { inlineData: { mimeType: "image/png", data: base64 } };
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const req = await context.request.json() as GenerateVideoRequest;

    if (!req.prompt) {
      return Response.json({ error: "prompt is required" }, { status: 400 });
    }

    // GCS/HTTPS URI 유효성 검사 — Scene Extension에만 사용 가능
    const isValidVideoUri = (uri: string) =>
      uri.startsWith("gs://") || uri.startsWith("https://");

    // === 모델 자동 선택 ===
    // veo-3.1-fast-generate-001: text-to-video ONLY (image input / video extension 미지원)
    // veo-3.0-generate-001: text-to-video + image-to-video + Scene Extension 지원
    //
    // 연장 모드 감지:
    //   - firstFrameBase64/lastFrameBase64 있으면 → image-to-video 필요 → standard
    //   - previousVideoUri가 gs:// / https:// 이면 → Scene Extension 필요 → standard
    const hasValidPrevUri = !!(req.previousVideoUri && isValidVideoUri(req.previousVideoUri));
    const hasFirstOrLastFrame = !!(req.firstFrameBase64 || req.lastFrameBase64);
    const needsExtensionModel = hasFirstOrLastFrame || hasValidPrevUri;

    // 사용자가 "fast" 모드를 선택했어도 연장이 필요하면 standard 모델로 자동 전환
    const model = needsExtensionModel
      ? "veo-3.0-generate-001"
      : "veo-3.1-fast-generate-001";

    const VALID_RATIOS = ["16:9", "9:16"];
    const aspectRatio = VALID_RATIOS.includes(req.aspectRatio || "") ? req.aspectRatio! : "9:16";
    const warnings: string[] = [];

    if (needsExtensionModel && req.mode === "fast") {
      warnings.push(
        `연장 모드 감지 — Fast 모델 미지원으로 ${model} 자동 전환`
      );
    }

    // === Build instance ===
    const instance: Record<string, unknown> = { prompt: req.prompt };

    // Scene Extension / Image-to-Video 연결 로직
    // 우선순위: gs://|https:// previousVideoUri → firstFrameBase64 → lastFrameBase64 → text-to-video
    if (hasValidPrevUri) {
      // ── Scene Extension: 이전 영상 URI로 직접 이어 생성
      instance.video = { uri: req.previousVideoUri };
      if (hasFirstOrLastFrame) {
        warnings.push("Scene Extension 모드 — firstFrame/lastFrame 무시 (video 우선)");
      }
    } else {
      // ── Scene Extension 불가 → image-to-video fallback
      if (req.previousVideoUri && !isValidVideoUri(req.previousVideoUri)) {
        // data URI 등 → 무시하고 firstFrame으로 이어받기
        warnings.push(
          `previousVideoUri가 GCS/HTTPS URI가 아님 (${req.previousVideoUri.slice(0, 30)}…) — firstFrame image-to-video로 전환`
        );
      }
      // 모델이 이미 veo-3.0으로 선택됐으므로 image input 가능
      if (req.firstFrameBase64) {
        instance.image = inlineImage(req.firstFrameBase64);
        if (req.lastFrameBase64) {
          warnings.push("firstFrame과 lastFrame 동시 전송 불가 — firstFrame만 사용");
        }
      } else if (req.lastFrameBase64) {
        instance.image = inlineImage(req.lastFrameBase64);
        warnings.push("lastFrame만 전송됨 — image 필드로 변환");
      }
      // 이미지도 없으면 text-to-video (프롬프트에서 연속성 표현)
    }

    // Reference Images — 제약 조건 체크
    // 1) 9:16에서는 referenceImages 미지원 (16:9만 지원)
    // 2) first/last frame과 동시 사용 불가
    if (req.referenceImages && req.referenceImages.length > 0) {
      if (aspectRatio !== "16:9") {
        warnings.push("referenceImages는 16:9에서만 지원 — 제외됨");
      } else if (hasFirstOrLastFrame) {
        warnings.push("referenceImages는 first/last frame과 동시 사용 불가 — 제외됨");
      } else {
        instance.referenceImages = req.referenceImages.slice(0, 3).map((b64) => ({
          image: inlineImage(b64),
          referenceType: "asset",
        }));
      }
    }

    // === Build parameters ===
    // Veo API 공식 지원 파라미터만 전송 (미지원 파라미터 → 400 에러)
    const parameters: Record<string, unknown> = {
      aspectRatio,
      personGeneration: req.personGeneration || "allow_all",
    };

    // resolution: 720p (기본) / 1080p / 4k
    if (req.resolution) {
      parameters.resolution = req.resolution;
    }

    // durationSeconds: text_to_video 지원값은 [4, 6, 8]초뿐
    // 입력값을 가장 가까운 유효값으로 스냅
    const VALID_DURATIONS = [4, 6, 8];
    const dur = req.durationSeconds || 8;
    parameters.durationSeconds = VALID_DURATIONS.reduce((prev, cur) =>
      Math.abs(cur - dur) < Math.abs(prev - dur) ? cur : prev
    );

    // sampleCount: 1~4개 변형 생성 (기본 1)
    const sampleCount = req.sampleCount && req.sampleCount >= 1 ? Math.min(req.sampleCount, 4) : 1;
    parameters.sampleCount = sampleCount;

    // generateAudio: 네이티브 오디오 생성 (기본 true)
    parameters.generateAudio = req.generateAudio !== false;

    // negativePrompt, seed: Veo API 미지원 → 전송하면 400

    const hasImageFields = !!(instance.image || instance.referenceImages);

    console.log("Veo request:", JSON.stringify({
      model,
      hasVideo: !!req.previousVideoUri,
      hasImage: !!instance.image,
      hasRefImages: !!instance.referenceImages,
      warnings,
      parameters,
    }));

    // === API 호출 (OAuth2 인증) ===
    const callVeo = async (inst: Record<string, unknown>, params: Record<string, unknown>) => {
      return fetchWithAuth(
        context.env,
        buildVertexUrl(context.env, model, "predictLongRunning"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instances: [inst], parameters: params }),
        },
      );
    };

    let res = await callVeo(instance, parameters);

    // 400 + 이미지 있으면 → 이미지 제거 후 재시도
    if (!res.ok && res.status === 400 && hasImageFields) {
      const errText = await res.text();
      console.warn("Veo 400 with images:", errText.slice(0, 300));
      warnings.push("이미지 입력으로 400 에러 — 프롬프트만으로 재시도");

      delete instance.image;
      delete instance.referenceImages;

      res = await callVeo(instance, parameters);
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error("Veo API error:", res.status, errText);

      let errorDetail = errText.slice(0, 300);
      try {
        const parsed = JSON.parse(errText);
        errorDetail = parsed?.error?.message || parsed?.error?.status || errorDetail;
      } catch { /* use raw text */ }

      return Response.json(
        { error: `Veo API error (${res.status}): ${errorDetail}`, details: errText.slice(0, 500) },
        { status: res.status }
      );
    }

    const data = await res.json() as { name: string };

    return Response.json({
      operationName: data.name,
      model,
      status: "RUNNING",
      ...(warnings.length > 0 && { warning: warnings.join("; ") }),
    });
  } catch (error) {
    console.error("Video generation error:", error);
    return Response.json(
      { error: `Failed to start video generation: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
};
