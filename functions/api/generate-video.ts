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
    // veo-3.1-generate-001: 고품질, Scene Extension 지원, 느림
    // veo-3.1-fast-generate-001: 저지연/저비용, Scene Extension 지원, 빠름 (3.1과 동일 기능)
    // veo-3.0-*: Scene Extension 미지원 → 사용 안 함
    const model = "veo-3.1-fast-generate-001";

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
    // 우선순위: firstFrameBase64 → gs://|https:// video → lastFrameBase64 → text-only
    //
    // ⚠️ Scene Extension(video)은 이전 영상의 시각적 내용에 강하게 앵커링되어
    //    프롬프트가 씬 전환/모핑을 지시해도 무시하는 문제가 있음.
    //    firstFrameBase64가 있으면 Image-to-video를 우선 사용해 프롬프트 반영도를 높임.
    const instance: Record<string, unknown> = { prompt: req.prompt };

    if (hasFirstFrame) {
      // Image-to-video: 마지막 프레임을 시작점으로, 프롬프트가 씬 진행을 주도
      instance.image = inlineImage(req.firstFrameBase64!);
      if (hasLastFrame) {
        warnings.push("firstFrame과 lastFrame 동시 전송 불가 — firstFrame만 사용");
      }
      if (hasValidPrevUri) {
        warnings.push("firstFrame 있음 — Scene Extension(video) 대신 image-to-video 사용 (프롬프트 반영도 우선)");
      }
    } else if (hasValidPrevUri) {
      // Scene Extension: firstFrame 없을 때만 사용 (시각적 continuity 목적)
      instance.video = { uri: req.previousVideoUri, mimeType: "video/mp4" };
    } else {
      if (req.previousVideoUri && !isValidVideoUri(req.previousVideoUri)) {
        warnings.push(
          `previousVideoUri가 GCS/HTTPS URI가 아님 (${req.previousVideoUri.slice(0, 30)}…) — text-to-video로 전환`
        );
      }
      if (hasLastFrame) {
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

    // ── Fallback 1: Scene Extension(video) 400 → text-to-video 시도 ──────────
    // video URI가 있는데 400으로 거절됐다면 (firstFrame은 이미 위에서 우선 처리됨)
    if (!res.ok && res.status === 400 && instance.video) {
      const errText = await res.text();
      warnings.push(`Scene Extension 400 — text-to-video 전환. 에러: ${errText.slice(0, 120)}`);
      console.warn("[generate-video] Scene Extension 400:", errText.slice(0, 500));

      delete instance.video;
      res = await callVeo(instance, parameters);
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
