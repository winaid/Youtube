import { GeminiEnv, fetchWithAuth, buildVeoUrl } from "./_gemini-keys";
import {
  klingGenerate,
  klingExtend,
  toKlingDuration,
  toKlingAspectRatio,
  type KlingEnv,
  type KlingMultiShot,
} from "./_kling-api";

type Env = GeminiEnv & KlingEnv;

interface GenerateVideoRequest {
  // ── 공통 ──────────────────────────────────────────────────────────────────
  prompt: string;
  engine?: "veo" | "kling" | "auto";   // 사용할 엔진 (default: veo)
  videoMode?: "generate" | "extend";   // generate: 독립 생성, extend: 이전 영상 이어서
  sourceVideo?: string;                // extend 모드의 소스 (Veo: gs:// URI, Kling: task_id/video_id)
  cutNumber?: number;                  // 진단 로그용 컷 번호
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
  multiShot?: KlingMultiShot[]; // Kling o3 멀티샷 (10s+ 장면)
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

    // durationSeconds 타입 검증 및 정규화
    if (req.durationSeconds !== undefined) {
      const durNum = Number(req.durationSeconds);
      if (!Number.isFinite(durNum)) {
        return Response.json(
          { error: `durationSeconds must be a number, got: ${JSON.stringify(req.durationSeconds)}` },
          { status: 400 },
        );
      }
      req.durationSeconds = durNum;
    }

    // ── 엔진 선택 ────────────────────────────────────────────────────────────
    // auto: KLING 자격증명이 있고 Google 자격증명이 없으면 Kling 사용
    const hasGoogle = !!(context.env.GOOGLE_SERVICE_ACCOUNT_JSON || context.env.GOOGLE_CLOUD_API_KEY);
    const hasKling  = !!context.env.KLING_API_KEY;

    // DEBUG: 환경변수 키 목록 로깅 (값은 노출 안 함)
    console.log("[generate-video] env keys:", Object.keys(context.env || {}));
    console.log("[generate-video] hasGoogle:", hasGoogle, "hasKling:", hasKling, "engine req:", req.engine);

    let engineUsed: "veo" | "kling";
    if (req.engine === "kling") {
      engineUsed = "kling";
    } else if (req.engine === "auto" && !hasGoogle && hasKling) {
      engineUsed = "kling";
    } else {
      engineUsed = "veo";
    }

    // CUT 1 서버 방어: 프론트엔드가 잘못된 "extend"를 보내도 서버에서 강제 차단
    // cutNumber === 1이면 이전 영상/프레임이 있을 수 없으므로 generate로 오버라이드
    const cutNumberRaw = req.cutNumber != null ? Number(req.cutNumber) : null;
    const videoMode = (req.videoMode === "extend" && cutNumberRaw === 1)
      ? "generate"  // CUT 1 → extend 강제 차단
      : (req.videoMode ?? "extend");

    if (req.videoMode === "extend" && cutNumberRaw === 1) {
      console.warn("[generate-video] CUT 1에 videoMode=extend 요청 → generate로 강제 전환", {
        cutNumber: cutNumberRaw,
        originalMode: req.videoMode,
        forcedMode: "generate",
      });
    }

    const sourceVideo = req.sourceVideo || req.previousVideoUri || "";

    // ── Kling 분기 ────────────────────────────────────────────────────────────
    if (engineUsed === "kling") {
      if (!hasKling) {
        return Response.json(
          { error: "KLING_API_KEY not configured" },
          { status: 400 },
        );
      }

      const duration = toKlingDuration(req.durationSeconds ?? 8);
      const aspectRatio = toKlingAspectRatio(req.aspectRatio ?? "16:9");

      // ── base64 검증: strip 후 최소 100자 이상이어야 실제 이미지 데이터 ─────
      // truthy 체크만으로는 "data:image/png;base64, " 같은 빈 prefix를 잡지 못함
      // → stripDataPrefix 후 길이 검사 필수 (이게 없으면 model=image-to-video + image 없음 → EvoLink 1201)
      const strippedFirst = req.firstFrameBase64 ? stripDataPrefix(req.firstFrameBase64) : "";
      const strippedLast  = req.lastFrameBase64  ? stripDataPrefix(req.lastFrameBase64)  : "";
      const validFirst    = strippedFirst.length > 100 ? strippedFirst : "";
      const validLast     = strippedLast.length  > 100 ? strippedLast  : "";

      // ── 진단 로그 ──────────────────────────────────────────────────────────
      console.log("[Kling] 요청 진단", {
        cutNumber:        cutNumberRaw,
        sourceCutId:      cutNumberRaw,
        parentCutId:      (cutNumberRaw != null && cutNumberRaw > 1) ? cutNumberRaw - 1 : null,
        provider:         "kling",
        selectedMode:     videoMode,
        originalReqMode:  req.videoMode ?? null,
        previousVideoUri: req.previousVideoUri || null,
        sourceVideo:      sourceVideo || null,
        hasFirstFrame:    !!req.firstFrameBase64,
        validFirstLen:    validFirst.length,
        hasLastFrame:     !!req.lastFrameBase64,
        validLastLen:     validLast.length,
        rawFirstLen:      strippedFirst.length,
        rawLastLen:       strippedLast.length,
      });

      let taskId: string;
      let modeUsed: "generate" | "extend";

      try {
        if (videoMode === "extend" && validLast) {
          // EXTEND: 이전 컷 끝 프레임 → 이번 컷 시작 프레임으로 image-to-video
          // validLast: strip + 길이 검증 완료 → image 필드에 넣어도 안전
          console.log("[Kling] EXTEND mode (last-frame → image-to-video)", { frameLen: validLast.length });
          const result = await klingExtend(context.env, {
            lastFrameBase64: validLast,
            prompt:          req.prompt,
            negative_prompt: req.negativePrompt,
            duration,
            aspect_ratio:    aspectRatio,
          });
          taskId = result.taskId;
          modeUsed = "extend";
        } else {
          // GENERATE: text-to-video or image-to-video (firstFrame 기준)
          // 검증된 image만 전달 → model=image-to-video인데 image 없는 상황(EvoLink 1201) 원천 차단
          if (!validFirst && videoMode === "extend" && !sourceVideo) {
            // extend 모드인데 쓸 수 있는 image도 sourceVideo도 없음 → 400
            console.error("[Kling] extend 요청이지만 유효한 image/sourceVideo 없음", {
              cutNumber:      req.cutNumber,
              hasLastFrame:   !!req.lastFrameBase64,
              rawLastLen:     strippedLast.length,
              hasFirstFrame:  !!req.firstFrameBase64,
              rawFirstLen:    strippedFirst.length,
              hasSourceVideo: !!sourceVideo,
            });
            return Response.json(
              {
                error: "Kling EXTEND mode requires valid lastFrameBase64, firstFrameBase64, or sourceVideo",
                details: {
                  videoMode,
                  hasLastFrame:   !!req.lastFrameBase64,
                  validLastLen:   validLast.length,
                  hasFirstFrame:  !!req.firstFrameBase64,
                  validFirstLen:  validFirst.length,
                  hasSourceVideo: !!sourceVideo,
                },
              },
              { status: 400 },
            );
          }

          console.log("[Kling] GENERATE mode", {
            hasImage:        !!validFirst,
            imageLen:        validFirst.length,
            hasImageTail:    !!validLast,
            imageTailLen:    validLast.length,
          });
          const result = await klingGenerate(context.env, {
            prompt:          req.prompt,
            negative_prompt: req.negativePrompt,
            aspect_ratio:    aspectRatio,
            duration,
            ...(validFirst ? { image:      validFirst } : {}),
            ...(validLast  ? { image_tail: validLast  } : {}),
            // 멀티샷: 1장면 안 여러 카메라 구도
            ...(req.multiShot && req.multiShot.length > 0 ? { multiShot: req.multiShot } : {}),
          });
          taskId = result.taskId;
          modeUsed = "generate";
        }
      } catch (klingErr) {
        // 외부 API 에러: httpStatus가 있으면 그대로 전달 (400/401 뭉개지 않음), 없으면 502
        const msg = klingErr instanceof Error ? klingErr.message : String(klingErr);
        const httpStatus = (klingErr as Error & { httpStatus?: number }).httpStatus;
        const status = httpStatus === 400 ? 400 : httpStatus === 401 ? 401 : 502;
        console.error("[Kling] API 에러", { msg, httpStatus, cutNumber: req.cutNumber });
        return Response.json({ error: msg }, { status });
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
    // veo-3.1-generate-001: 고품질, Scene Extension + 오디오 생성 지원
    // veo-3.1-fast-generate-001: 저지연/저비용이지만 generateAudio 미지원 → 무음 영상
    // ⚠️ generateAudio는 반드시 non-fast 모델을 사용해야 동작함
    const model = "veo-3.1-generate-001";

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
