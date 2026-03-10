import { GeminiEnv, fetchWithAuth, buildVeoUrl } from "./_gemini-keys";
import {
  klingGenerate,
  klingExtend,
  toKlingDuration,
  toKlingAspectRatio,
  type KlingEnv,
} from "./_kling-api";

type Env = GeminiEnv & KlingEnv;

interface GenerateVideoRequest {
  // ── 공통 ──────────────────────────────────────────────────────────────────
  prompt: string;
  engine?: "veo" | "kling" | "auto";   // 사용할 엔진 (default: veo)
  videoMode?: "generate" | "extend";   // generate: 독립 생성, extend: 이전 영상 이어서
  sourceVideo?: string;                // extend 모드의 소스 (Veo: gs:// URI, Kling: task_id/video_id)
  // ── Veo 전용 ──────────────────────────────────────────────────────────────
  mode?: "fast" | "quality";
  durationSeconds?: number;
  resolution?: string;
  aspectRatio?: string;
  generateAudio?: boolean;
  negativePrompt?: string;
  personGeneration?: string;
  seed?: number;
  sampleCount?: number;
  previousVideoUri?: string;           // 레거시 Scene Extension (sourceVideo 미설정 시 fallback)
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

    // ── 엔진 선택 ────────────────────────────────────────────────────────────
    // auto: KLING 자격증명이 있고 Google 자격증명이 없으면 Kling 사용
    const hasGoogle = !!(context.env.GOOGLE_SERVICE_ACCOUNT_JSON || context.env.GOOGLE_CLOUD_API_KEY);
    const hasKling  = !!(context.env.KLING_API_KEY && context.env.KLING_API_SECRET);

    let engineUsed: "veo" | "kling";
    if (req.engine === "kling") {
      engineUsed = "kling";
    } else if (req.engine === "auto" && !hasGoogle && hasKling) {
      engineUsed = "kling";
    } else {
      engineUsed = "veo";
    }

    const videoMode = req.videoMode ?? "extend";
    const sourceVideo = req.sourceVideo || req.previousVideoUri || "";

    // ── Kling 분기 ────────────────────────────────────────────────────────────
    if (engineUsed === "kling") {
      if (!hasKling) {
        return Response.json(
          { error: "KLING_API_KEY / KLING_API_SECRET not configured" },
          { status: 400 },
        );
      }

      const duration = toKlingDuration(req.durationSeconds ?? 8);
      const aspectRatio = toKlingAspectRatio(req.aspectRatio ?? "16:9");

      let taskId: string;
      let modeUsed: "generate" | "extend";

      if (videoMode === "extend" && sourceVideo) {
        // Kling extend: 이전 영상 video_id 필요
        console.log("[generate-video] Kling EXTEND", { sourceVideo: sourceVideo.slice(0, 60) });
        const result = await klingExtend(context.env, {
          video_id: sourceVideo,
          prompt: req.prompt,
          negative_prompt: req.negativePrompt,
          cfg_scale: 0.5,
        });
        taskId = result.taskId;
        modeUsed = "extend";
      } else {
        // Kling generate (text-to-video or image-to-video)
        console.log("[generate-video] Kling GENERATE", {
          hasFirstFrame: !!req.firstFrameBase64,
          duration,
          aspectRatio,
        });
        const result = await klingGenerate(context.env, {
          prompt: req.prompt,
          negative_prompt: req.negativePrompt,
          model_name: "kling-v1-5",
          mode: "std",
          aspect_ratio: aspectRatio,
          duration,
          cfg_scale: 0.5,
          ...(req.firstFrameBase64 ? { image: req.firstFrameBase64 } : {}),
          ...(req.lastFrameBase64  ? { image_tail: req.lastFrameBase64 } : {}),
        });
        taskId = result.taskId;
        modeUsed = "generate";
      }

      return Response.json({
        operationName: taskId, // 통합 job ID 필드
        taskId,
        engine: "kling",
        modeUsed,
        sourceVideo: sourceVideo || undefined,
        status: "RUNNING",
      });
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
    // 우선순위: gs://|https:// video(Scene Extension) → firstFrameBase64 → lastFrameBase64 → text-only
    //
    // Scene Extension이 최우선: 사용자가 "이전 영상을 입력으로 넣어 이어서 생성"을 원하므로
    // previousVideoUri(gs://) 가 있으면 반드시 video input으로 넣음.
    // firstFrameBase64(프레임 기반 image-to-video)는 이전 영상이 없을 때 continuity 보조 수단.
    const instance: Record<string, unknown> = { prompt: req.prompt };

    if (hasValidPrevUri) {
      // Scene Extension: 이전 컷 비디오를 직접 입력 (true extend)
      instance.video = { uri: req.previousVideoUri, mimeType: "video/mp4" };
      if (hasFirstFrame) {
        warnings.push("previousVideoUri 있음 — Scene Extension 우선. firstFrameBase64는 무시됨");
      }
    } else if (hasFirstFrame) {
      // Image-to-video: 이전 비디오 없을 때 프레임 기반 continuity
      instance.image = inlineImage(req.firstFrameBase64!);
      if (hasLastFrame) {
        warnings.push("firstFrame과 lastFrame 동시 전송 불가 — firstFrame만 사용");
      }
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

    // Veo 3.1 지원 해상도: 720p, 1080p (4k 미지원 — 400 에러 유발)
    const VALID_RESOLUTIONS = ["720p", "1080p"];
    if (req.resolution) {
      if (VALID_RESOLUTIONS.includes(req.resolution)) {
        parameters.resolution = req.resolution;
      } else {
        warnings.push(`해상도 "${req.resolution}"은 Veo 3.1 미지원 → 제외됨 (지원: ${VALID_RESOLUTIONS.join(", ")})`);
      }
    }

    const VALID_DURATIONS = [4, 6, 8];
    const dur = req.durationSeconds || 8;
    parameters.durationSeconds = VALID_DURATIONS.reduce((prev, cur) =>
      Math.abs(cur - dur) < Math.abs(prev - dur) ? cur : prev
    );

    const sampleCount = req.sampleCount && req.sampleCount >= 1 ? Math.min(req.sampleCount, 4) : 1;
    parameters.sampleCount = sampleCount;
    parameters.generateAudio = req.generateAudio !== false;

    // seed: 재현 가능한 생성 (동일 seed → 동일 영상)
    if (req.seed !== undefined) {
      parameters.seed = req.seed;
    }

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

    // 실제 어떤 모드로 Veo를 호출하는지 명시 (Scene Extension / image-to-video / text-to-video)
    const veoMode = instance.video
      ? "SCENE_EXTENSION"
      : instance.image
        ? "IMAGE_TO_VIDEO"
        : "TEXT_TO_VIDEO";

    console.log("[generate-video] Veo request:", JSON.stringify({
      model,
      mode: veoMode,
      endpoint: "us-central1",
      previousVideoUri: req.previousVideoUri ? `${String(req.previousVideoUri).slice(0, 80)}…` : null,
      hasValidPrevUri,
      hasFirstFrame,
      hasLastFrame,
      hasVideo: !!instance.video,
      hasImage: !!instance.image,
      hasRefImages: !!instance.referenceImages,
      warnings,
      parameters,
    }));

    // ── 1차 시도 ─────────────────────────────────────────────────────────────
    let res = await callVeo(instance, parameters);

    // ── Fallback 1: Scene Extension(video) 400 → image-to-video → text-to-video ──
    if (!res.ok && res.status === 400 && instance.video) {
      const errText = await res.text();
      console.warn("[generate-video] Scene Extension 400:", errText.slice(0, 500));
      delete instance.video;

      if (hasFirstFrame) {
        // firstFrameBase64 있으면 image-to-video로 fallback
        warnings.push(`Scene Extension 400 → image-to-video fallback. 에러: ${errText.slice(0, 120)}`);
        instance.image = inlineImage(req.firstFrameBase64!);
      } else {
        // 없으면 text-to-video
        warnings.push(`Scene Extension 400 → text-to-video 전환. 에러: ${errText.slice(0, 120)}`);
      }
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

    const veoModeUsed: "generate" | "extend" = instance.video
      ? "extend"   // Scene Extension = extend
      : videoMode === "generate" ? "generate" : "extend";

    return Response.json({
      operationName: data.name,
      model,
      engine: "veo",
      modeUsed: veoModeUsed,
      ...(sourceVideo && { sourceVideo }),
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
