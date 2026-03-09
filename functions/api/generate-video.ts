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

// Veo image input 포맷 — Gemini 의 inlineData 와 완전히 다른 스키마
//
// ❌ 이전 코드 (Gemini LLM 포맷 — Veo에서 400):
//   { inlineData: { mimeType: "image/png", data: base64 } }
//
// ✅ 수정 후 (Veo 공식 포맷):
//   { bytesBase64Encoded: base64, mimeType: "image/png" }
//
// captureVideoLastFrame 은 canvas.toDataURL("image/png") 사용 → mimeType = "image/png"
function inlineImage(base64: string, mimeType = "image/png") {
  return { bytesBase64Encoded: base64, mimeType };
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const req = await context.request.json() as GenerateVideoRequest;

    if (!req.prompt) {
      return Response.json({ error: "prompt is required" }, { status: 400 });
    }

    // === 모델 선택 ===
    // veo-3.0-generate-001 만 사용:
    //   - text-to-video, image-to-video, Scene Extension 모두 지원
    //   - veo-3.1-fast-generate-001 은 image/video input 미지원 → 제거
    const model = "veo-3.0-generate-001";

    // GCS/HTTPS URI 유효성 검사
    const isValidVideoUri = (uri: string) =>
      uri.startsWith("gs://") || uri.startsWith("https://");

    const hasValidPrevUri = !!(req.previousVideoUri && isValidVideoUri(req.previousVideoUri));
    const hasFirstOrLastFrame = !!(req.firstFrameBase64 || req.lastFrameBase64);

    const VALID_RATIOS = ["16:9", "9:16"];
    const aspectRatio = VALID_RATIOS.includes(req.aspectRatio || "") ? req.aspectRatio! : "9:16";
    const warnings: string[] = [];

    // === Build instance ===
    const instance: Record<string, unknown> = { prompt: req.prompt };

    // Scene Extension / Image-to-Video 연결 로직
    // 우선순위: gs://|https:// previousVideoUri → firstFrameBase64 → lastFrameBase64 → text-to-video
    if (hasValidPrevUri) {
      // Scene Extension: 이전 영상 URI로 직접 이어 생성
      instance.video = { uri: req.previousVideoUri, mimeType: "video/mp4" };
      if (hasFirstOrLastFrame) {
        warnings.push("Scene Extension 모드 — firstFrame/lastFrame 무시 (video 우선)");
      }
    } else {
      if (req.previousVideoUri && !isValidVideoUri(req.previousVideoUri)) {
        warnings.push(
          `previousVideoUri가 GCS/HTTPS URI가 아님 (${req.previousVideoUri.slice(0, 30)}…) — firstFrame image-to-video로 전환`
        );
      }
      if (req.firstFrameBase64) {
        // Image-to-Video: 이전 컷 마지막 프레임을 시작 프레임으로
        instance.image = inlineImage(req.firstFrameBase64);
        if (req.lastFrameBase64) {
          warnings.push("firstFrame과 lastFrame 동시 전송 불가 — firstFrame만 사용");
        }
      } else if (req.lastFrameBase64) {
        instance.image = inlineImage(req.lastFrameBase64);
        warnings.push("lastFrame만 전송됨 — image 필드로 변환");
      }
      // 이미지도 없으면 text-to-video
    }

    // Reference Images — 제약 조건 체크
    // 9:16에서는 미지원, first/last frame과 동시 사용 불가
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
    const parameters: Record<string, unknown> = {
      aspectRatio,
      personGeneration: req.personGeneration || "allow_all",
    };

    if (req.resolution) {
      parameters.resolution = req.resolution;
    }

    const VALID_DURATIONS = [4, 6, 8];
    const dur = req.durationSeconds || 8;
    parameters.durationSeconds = VALID_DURATIONS.reduce((prev, cur) =>
      Math.abs(cur - dur) < Math.abs(prev - dur) ? cur : prev
    );

    const sampleCount = req.sampleCount && req.sampleCount >= 1 ? Math.min(req.sampleCount, 4) : 1;
    parameters.sampleCount = sampleCount;

    parameters.generateAudio = req.generateAudio !== false;

    const hasImageFields = !!(instance.image || instance.referenceImages);

    console.log("[generate-video] Veo request:", JSON.stringify({
      model,
      hasVideo: !!instance.video,
      hasImage: !!instance.image,
      imageFormat: instance.image ? Object.keys(instance.image as object) : null,
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

    // 400 + 이미지 있으면 → 에러 내용 로깅 후 이미지 제거 재시도
    if (!res.ok && res.status === 400 && hasImageFields) {
      const errText = await res.text();
      console.warn("[generate-video] Veo 400 (image input). body:", errText.slice(0, 500));
      warnings.push(`이미지 입력 400 에러 — 프롬프트만으로 재시도. 에러: ${errText.slice(0, 120)}`);

      delete instance.image;
      delete instance.referenceImages;

      res = await callVeo(instance, parameters);
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error("[generate-video] Veo API 에러:", res.status, errText);

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
    console.error("[generate-video] 처리 오류:", error);
    return Response.json(
      { error: `Failed to start video generation: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
};
