import { GeminiEnv, fetchWithAuth, buildVeoUrl } from "./_gemini-keys";

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

// ── base64 data URI 접두사 제거 ────────────────────────────────────────────
// captureVideoLastFrame 은 prefix를 제거해 보내지만,
// storyboardImages 등은 data:image/png;base64,... 형태로 올 수 있어
// generate-video.ts 에서 한 번 더 방어적으로 처리.
function stripDataPrefix(b64: string): string {
  return b64.replace(/^data:[^;]+;base64,/, "");
}

// Veo image input 포맷
// Veo는 bytesBase64Encoded + mimeType 형식 사용 (Gemini inlineData와 다름)
// mimeType: Veo는 image/jpeg, image/png 모두 지원.
//   - captureVideoLastFrame: canvas.toDataURL("image/png") → "image/png"
//   - storyboardImages: 보통 data:image/png;base64,... prefix 포함
function inlineImage(rawB64: string, mimeType = "image/png") {
  return { bytesBase64Encoded: stripDataPrefix(rawB64), mimeType };
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const req = await context.request.json() as GenerateVideoRequest;

    if (!req.prompt) {
      return Response.json({ error: "prompt is required" }, { status: 400 });
    }

    // ── 모델 선택 ────────────────────────────────────────────────────────────
    // veo-3.0-generate-001:
    //   - text-to-video, image-to-video, Scene Extension 지원
    //   - us-central1 리전 엔드포인트 → GCS URI 반환 → 다음 컷 Scene Extension 가능
    // veo-3.1-fast-generate-001 / veo-3.0-fast-generate-001:
    //   - image/video input 미지원 → Scene Extension 불가 → 사용 안 함
    const model = "veo-3.0-generate-001";

    // GCS/HTTPS URI 유효성 검사 (base64 data URI 는 Veo 영상 입력 불가)
    const isValidVideoUri = (uri: string) =>
      uri.startsWith("gs://") || uri.startsWith("https://");

    const hasValidPrevUri = !!(req.previousVideoUri && isValidVideoUri(req.previousVideoUri));
    const hasFirstFrame = !!(req.firstFrameBase64 && req.firstFrameBase64.length > 100);
    const hasLastFrame = !!(req.lastFrameBase64 && req.lastFrameBase64.length > 100);
    const hasFirstOrLastFrame = hasFirstFrame || hasLastFrame;

    const VALID_RATIOS = ["16:9", "9:16"];
    const aspectRatio = VALID_RATIOS.includes(req.aspectRatio || "") ? req.aspectRatio! : "9:16";
    const warnings: string[] = [];

    // ── instance 구성 ────────────────────────────────────────────────────────
    // 우선순위: gs://|https:// video → firstFrameBase64 → lastFrameBase64 → text-only
    const instance: Record<string, unknown> = { prompt: req.prompt };

    if (hasValidPrevUri) {
      // Scene Extension: 이전 영상 GCS/HTTPS URI → 연속 장면 생성
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
      if (hasFirstFrame) {
        instance.image = inlineImage(req.firstFrameBase64!);
        if (hasLastFrame) {
          warnings.push("firstFrame과 lastFrame 동시 전송 불가 — firstFrame만 사용");
        }
      } else if (hasLastFrame) {
        instance.image = inlineImage(req.lastFrameBase64!);
        warnings.push("lastFrame만 전송됨 — image 필드로 변환");
      }
    }

    // Reference Images — 9:16 미지원, first/last frame과 동시 사용 불가
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

    // ── parameters 구성 ──────────────────────────────────────────────────────
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

    // ── API 호출 헬퍼 ─────────────────────────────────────────────────────────
    // buildVeoUrl → us-central1 리전 엔드포인트:
    //   GCS URI 반환 보장 + fetchPredictOperation 리전 일치
    const callVeo = async (inst: Record<string, unknown>, params: Record<string, unknown>) => {
      return fetchWithAuth(
        context.env,
        buildVeoUrl(context.env, model, "predictLongRunning"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instances: [inst], parameters: params }),
        },
      );
    };

    console.log("[generate-video] Veo request:", JSON.stringify({
      model,
      endpoint: "us-central1",
      hasVideo: !!instance.video,
      hasImage: !!instance.image,
      hasRefImages: !!instance.referenceImages,
      warnings,
      parameters,
    }));

    // ── 1차 시도 ─────────────────────────────────────────────────────────────
    let res = await callVeo(instance, parameters);

    // ── Fallback 1: Scene Extension(video) 400 → image-to-video 시도 ─────────
    // video URI가 있는데 400으로 거절됐다면 firstFrame image-to-video로 전환.
    if (!res.ok && res.status === 400 && instance.video) {
      const errText = await res.text();
      warnings.push(`Scene Extension 400 — image-to-video 전환. 에러: ${errText.slice(0, 120)}`);
      console.warn("[generate-video] Scene Extension 400:", errText.slice(0, 500));

      delete instance.video;

      // firstFrameBase64 이 있으면 image-to-video 재시도
      if (hasFirstFrame) {
        instance.image = inlineImage(req.firstFrameBase64!);
        res = await callVeo(instance, parameters);
      } else {
        // firstFrame 없으면 바로 text-to-video
        res = await callVeo(instance, parameters);
      }
    }

    // ── Fallback 2: image-to-video 400 → prompt-only text-to-video ───────────
    // image(firstFrame/lastFrame) 또는 referenceImages가 400 유발 시 제거 후 재시도.
    if (!res.ok && res.status === 400 && (instance.image || instance.referenceImages)) {
      const errText = await res.text();
      warnings.push(`이미지 입력 400 — 프롬프트만으로 재시도. 에러: ${errText.slice(0, 120)}`);
      console.warn("[generate-video] image input 400:", errText.slice(0, 500));

      delete instance.image;
      delete instance.referenceImages;

      res = await callVeo(instance, parameters);
    }

    // ── 최종 에러 처리 ────────────────────────────────────────────────────────
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
