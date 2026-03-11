import { GeminiEnv, fetchWithAuth, buildVeoUrl } from "./_gemini-keys";
import {
  klingGenerate,
  klingExtend,
  toKlingDuration,
  toKlingAspectRatio,
  type KlingEnv,
  type KlingMultiShot,
} from "./_kling-api";
import {
  type VideoPromptJson,
  type ExtendPromptJson,
  renderVeoPromptFromJson,
  renderVeoExtendPromptFromJson,
  renderKlingPromptFromJson,
  renderKlingExtendPromptFromJson,
} from "./_video-prompt-json";
import { serverSanitizeAndValidate } from "./_prompt-sanitizer";

type Env = GeminiEnv & KlingEnv;

/** StructuredSequenceDocument의 서버 측 미러 (클라이언트에서 전달) */
interface StructuredSequencePayload {
  shotId: string;
  cutNumber: number;
  shotPlan: {
    camera: { framing: string; angle: string; motion: string; motionMotivation?: string };
    subject: { primary: string; secondary?: string[]; characterRef?: string; blocking?: string };
    environment: string;
    action: string;
    moodLighting: string;
    timingBeat?: string;
    transitionFromPrev?: string;
    locationCue?: string;
    situationCue?: string;
    emotionalAnchor?: string;
    visualMedium?: string;
    negativeDirectives?: string[];
    [key: string]: unknown;
  };
  videoPromptJson?: VideoPromptJson;
  negatives?: {
    universal: string[];
    sceneSpecific: string[];
    failureMode: string[];
    user: string[];
  };
  validation?: { valid: boolean; errors: number; warnings: number };
}

/**
 * 서버 사이드 last-mile 직렬화.
 * StructuredSequencePayload → provider 전송용 문자열.
 * 이 함수는 provider가 structured input을 지원하지 않을 때만 호출한다.
 * source of truth는 structuredSequence이며, 이 반환값은 일시적 transport payload.
 */
function serializeSequenceToPrompt(
  seq: StructuredSequencePayload,
  provider: "veo" | "kling",
): { prompt: string; negativePrompt: string } {
  // videoPromptJson이 있으면 기존 provider 렌더러 사용 (최적화된 포맷)
  if (seq.videoPromptJson) {
    if (provider === "kling") {
      return {
        prompt: renderKlingPromptFromJson(seq.videoPromptJson),
        negativePrompt: "",
      };
    }
    return {
      prompt: renderVeoPromptFromJson(seq.videoPromptJson),
      negativePrompt: "",
    };
  }

  // videoPromptJson 없으면 shotPlan에서 직접 직렬화
  const shot = seq.shotPlan;
  const parts: string[] = [];

  const framingMap: Record<string, string> = {
    ECU: "Extreme close-up", CU: "Close-up", MCU: "Medium close-up",
    MS: "Medium shot", MLS: "Medium long shot", LS: "Long shot",
    WS: "Wide shot", OTS: "Over-the-shoulder", POV: "Point-of-view",
  };
  const angleMap: Record<string, string> = {
    eye_level: "eye-level", low_angle: "low-angle", high_angle: "high-angle",
    dutch: "dutch angle", overhead: "overhead", POV: "POV",
  };

  // Subject
  if (shot.subject.primary) {
    const line = shot.subject.blocking
      ? `${shot.subject.primary}, ${shot.subject.blocking}`
      : shot.subject.primary;
    parts.push(line);
  }

  // Camera
  const framing = framingMap[shot.camera.framing] || shot.camera.framing;
  const angle = angleMap[shot.camera.angle] || shot.camera.angle;
  const motion = shot.camera.motion && shot.camera.motion !== "static"
    ? `, ${shot.camera.motion}` : "";
  parts.push(`${framing}, ${angle}${motion}`);

  // Cues
  if (shot.locationCue) parts.push(shot.locationCue);
  if (shot.situationCue) parts.push(shot.situationCue);
  if (shot.subject.characterRef) parts.push(shot.subject.characterRef);
  if (shot.emotionalAnchor) parts.push(shot.emotionalAnchor);
  if (shot.action) parts.push(shot.action);
  if (shot.moodLighting) parts.push(shot.moodLighting);
  if (shot.timingBeat) parts.push(shot.timingBeat);
  if (shot.transitionFromPrev) parts.push(`Previous shot ends with ${shot.transitionFromPrev}`);
  if (shot.visualMedium) parts.push(shot.visualMedium);

  parts.push("Diegetic ambient sound");
  parts.push("No text overlay, no watermark");

  let prompt = parts.filter(Boolean).join(". ");

  // Negatives
  const allNeg = seq.negatives
    ? [...seq.negatives.universal, ...seq.negatives.sceneSpecific, ...seq.negatives.failureMode, ...seq.negatives.user]
    : (shot.negativeDirectives || []);
  let uniqueNeg = [...new Set(allNeg)].slice(0, 30);

  // ═══════════════════════════════════════════════════════════════
  // 전역 Sanitize Pipeline (서버 마지막 직렬화 지점)
  // ═══════════════════════════════════════════════════════════════
  const sanitizeResult = serverSanitizeAndValidate({
    prompt,
    negatives: uniqueNeg,
    framing: shot.camera.framing,
    shotCategory: shot.shotCategory,
    styleSuffix: seq.videoPromptJson?.styleSuffix,
    provider,
  });
  prompt = sanitizeResult.prompt;
  uniqueNeg = sanitizeResult.negatives;
  if (sanitizeResult.log.length > 0) {
    console.log("[serializeSequenceToPrompt] sanitize:", {
      cutNumber: seq.cutNumber,
      log: sanitizeResult.log,
      valid: sanitizeResult.valid,
    });
  }

  const negStr = uniqueNeg.join(", ");

  // Veo: embed negatives (no separate negative prompt field)
  // Kling: separate negative prompt
  if (provider !== "kling" && uniqueNeg.length > 0) {
    prompt += `. Avoid: ${negStr}`;
  }

  // Word cap (250 for Veo, 300 for Kling)
  const maxWords = provider === "kling" ? 300 : 250;
  const words = prompt.split(/\s+/);
  if (words.length > maxWords) {
    prompt = words.slice(0, maxWords - 5).join(" ");
  }

  prompt = prompt
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    prompt,
    negativePrompt: provider === "kling" ? negStr : "",
  };
}

interface GenerateVideoRequest {
  // ── 공통 ──────────────────────────────────────────────────────────────────
  /** @deprecated legacy fallback. source of truth는 structuredSequence. */
  prompt?: string;
  engine?: "veo" | "kling" | "auto";   // 사용할 엔진 (default: veo)
  videoMode?: "generate" | "extend";   // generate: 독립 생성, extend: 이전 영상 이어서
  sourceVideo?: string;                // extend 모드의 소스 (Veo: gs:// URI, Kling: task_id/video_id)
  cutNumber?: number;                  // 진단 로그용 컷 번호
  // ── JSON-first source of truth (최우선) ───────────────────────────────────
  structuredSequence?: StructuredSequencePayload;
  // ── JSON 프롬프트 (structuredSequence 없으면 fallback) ─────────────────────
  videoPromptJson?: VideoPromptJson;   // 구조화된 영상 프롬프트
  extendPromptJson?: ExtendPromptJson; // 구조화된 확장 프롬프트
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
  const tServerStart = Date.now();
  try {
    const req = await context.request.json() as GenerateVideoRequest;

    // ── JSON-first 프롬프트 해석 ─────────────────────────────────────────────
    // 서버가 "마지막 직렬화 지점"이다.
    // source of truth: structuredSequence (1급) > videoPromptJson (legacy) > prompt (legacy fallback)
    //
    // finalPromptForProvider는 일시적 transport payload일 뿐이며,
    // 저장하거나 source of truth로 취급하면 안 된다.
    // structuredSequence가 있으면 여기서 provider에 맞춰 직렬화한다.
    let finalPromptForProvider: string | undefined;
    let usedPath: "structuredSequence" | "videoPromptJson" | "prompt_legacy" = "prompt_legacy";
    let fallbackReason: string | undefined;
    const hasStructuredSequence = !!req.structuredSequence?.shotPlan;

    if (hasStructuredSequence) {
      // 1순위: structuredSequence — 서버에서 마지막 직렬화
      // 엔진 결정 전이므로 일단 Veo로 직렬화 (아래에서 Kling이면 재직렬화)
      const serialized = serializeSequenceToPrompt(req.structuredSequence!, "veo");
      finalPromptForProvider = serialized.prompt;
      usedPath = "structuredSequence";
      console.log("[generate-video] structuredSequence → 서버 직렬화 (last-mile)", {
        cutNumber: req.cutNumber,
        shotId: req.structuredSequence!.shotId,
        serializedLen: finalPromptForProvider.length,
        serializedPreview: finalPromptForProvider.slice(0, 120),
        validation: req.structuredSequence!.validation,
        hasVideoPromptJson: !!req.structuredSequence!.videoPromptJson,
        hasNegatives: !!req.structuredSequence!.negatives,
        structuredPath: true,
        stringFallback: false,
      });
    } else if (req.videoPromptJson && !req.prompt) {
      // 2순위: videoPromptJson (legacy — structuredSequence 없는 구 클라이언트)
      finalPromptForProvider = renderVeoPromptFromJson(req.videoPromptJson);
      usedPath = "videoPromptJson";
      fallbackReason = "no structuredSequence";

      // Legacy path도 전역 sanitize pipeline 적용
      const legacySanitize = serverSanitizeAndValidate({
        prompt: finalPromptForProvider,
        negatives: req.negativePrompt ? req.negativePrompt.split(",").map(s => s.trim()) : [],
        framing: req.videoPromptJson.shotSize || "MS",
        shotCategory: undefined, // legacy path에는 shotCategory 없음
        styleSuffix: req.videoPromptJson.styleSuffix,
        provider: "veo",
      });
      finalPromptForProvider = legacySanitize.prompt;
      if (legacySanitize.log.length > 0) {
        console.log("[generate-video] videoPromptJson legacy sanitize:", legacySanitize.log);
      }

      console.log("[generate-video] videoPromptJson fallback (legacy)", {
        cutNumber: req.cutNumber,
        serializedLen: finalPromptForProvider.length,
        fallbackReason,
        structuredPath: false,
        stringFallback: true,
      });
    } else if (req.prompt) {
      // 3순위: prompt string (legacy — 최후 fallback)
      finalPromptForProvider = req.prompt;
      usedPath = "prompt_legacy";
      fallbackReason = "no structuredSequence, no videoPromptJson";

      // Legacy prompt string도 기본 pos/neg sanitize 적용
      const legacySanitize = serverSanitizeAndValidate({
        prompt: finalPromptForProvider,
        negatives: req.negativePrompt ? req.negativePrompt.split(",").map(s => s.trim()) : [],
        framing: "MS",
        shotCategory: undefined,
        provider: "veo",
      });
      finalPromptForProvider = legacySanitize.prompt;
      if (legacySanitize.log.length > 0) {
        console.log("[generate-video] legacy prompt sanitize:", legacySanitize.log);
      }

      console.log("[generate-video] legacy prompt string fallback", {
        cutNumber: req.cutNumber,
        serializedLen: finalPromptForProvider.length,
        fallbackReason,
        structuredPath: false,
        stringFallback: true,
      });
    }

    if (!finalPromptForProvider) {
      return Response.json({ error: "structuredSequence, videoPromptJson, or prompt must be provided" }, { status: 400 });
    }

    // 서버 경로 진단 로그
    console.log("[generate-video] source-of-truth resolution:", {
      usedPath,
      hasStructuredSequence,
      fallbackReason: fallbackReason || "none (structured path)",
      finalPromptLen: finalPromptForProvider.length,
      finalPromptPreview: finalPromptForProvider.slice(0, 120),
    });

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

      // Kling: structuredSequence가 있으면 Kling 전용으로 재직렬화 (마지막 직렬화 지점)
      let klingNegativePrompt = req.negativePrompt || "";
      if (hasStructuredSequence) {
        const klingResult = serializeSequenceToPrompt(req.structuredSequence!, "kling");
        finalPromptForProvider = klingResult.prompt;
        if (klingResult.negativePrompt) {
          klingNegativePrompt = klingResult.negativePrompt;
        }
        console.log("[generate-video] Kling: structuredSequence → 서버 재직렬화 (last-mile)", {
          promptLen: finalPromptForProvider.length,
          negativeLen: klingResult.negativePrompt.length,
          structuredPath: true,
          stringFallback: false,
        });
      } else {
        // Legacy fallback: videoPromptJson
        const klingJson = req.videoPromptJson;
        if (klingJson) {
          finalPromptForProvider = renderKlingPromptFromJson(klingJson);
          console.log("[generate-video] Kling: videoPromptJson fallback 렌더링 (legacy)", {
            promptLen: finalPromptForProvider.length,
            structuredPath: false,
            stringFallback: true,
            fallbackReason: "no structuredSequence",
          });
        }
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
            prompt:          finalPromptForProvider,
            negative_prompt: klingNegativePrompt,
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
            prompt:          finalPromptForProvider,
            negative_prompt: klingNegativePrompt,
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
    const instance: Record<string, unknown> = { prompt: finalPromptForProvider };

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

    // 인증 방식에 따른 GCS URI 반환 가능성 진단
    const authMethod = context.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "SERVICE_ACCOUNT" : "API_KEY";
    const veoUrl = buildVeoUrl(context.env, model, "predictLongRunning");
    const urlHasProject = veoUrl.includes("/projects/");
    const urlVersion = veoUrl.includes("/v1beta/") ? "v1beta" : "v1";

    if (authMethod === "API_KEY") {
      console.warn("[generate-video] ⚠️ API Key 인증 사용 중 — GCS URI 미반환 가능성 높음", {
        authMethod,
        urlVersion,
        urlHasProject,
        hint: "GOOGLE_SERVICE_ACCOUNT_JSON 설정 시 us-central1 엔드포인트에서 GCS URI 반환 → Scene Extension 가능",
      });
    }

    console.log("[generate-video] Veo request:", JSON.stringify({
      model,
      mode: veoMode,
      endpoint: "us-central1",
      authMethod,
      urlVersion,
      urlHasProject,
      veoUrlPrefix: veoUrl.slice(0, 80),
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
    const tVeoStart = Date.now();
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

    const tVeoEnd = Date.now();
    const data = await res.json() as { name: string };

    const veoModeUsed: "generate" | "extend" = instance.video
      ? "extend"   // Scene Extension = extend
      : videoMode === "generate" ? "generate" : "extend";

    const serverTotalMs = Date.now() - tServerStart;
    const veoApiMs = tVeoEnd - tVeoStart;
    const promptLen = finalPromptForProvider.length;

    console.log("[generate-video] ⏱ timing", {
      serverTotalMs,
      veoApiMs,
      promptChars: promptLen,
      promptWords: promptLen > 0 ? finalPromptForProvider.split(/\s+/).length : 0,
      mode: veoMode,
      cutNumber: cutNumberRaw,
    });

    return Response.json({
      operationName: data.name,
      model,
      engine: "veo",
      modeUsed: veoModeUsed,
      ...(sourceVideo && { sourceVideo }),
      status: "RUNNING",
      ...(warnings.length > 0 && { warning: warnings.join("; ") }),
      // 진단용: 클라이언트가 GCS URI 반환 가능 여부를 미리 알 수 있도록
      _diag: {
        authMethod,
        urlVersion,
        urlHasProject,
        veoMode,
        sceneExtensionAttempted: veoMode === "SCENE_EXTENSION",
      },
    });
  } catch (error) {
    console.error("[generate-video] 처리 오류:", error);
    return Response.json(
      { error: `Failed to start video generation: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
};
