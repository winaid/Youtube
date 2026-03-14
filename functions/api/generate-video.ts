/**
 * generate-video.ts — 2-API 아키텍처: Kling 전용 영상 생성
 *
 * 아키텍처:
 *   Kling = 실제 영상 생성 (text-to-video / image-to-video / extend)
 *   Gemini = QA / validation / auto-fix (별도 route, 여기서 호출하지 않음)
 *
 * source of truth: structuredSequence (JSON-first)
 * Kling(EvoLink) 생성 전용
 */
import {
  klingGenerate,
  klingExtend,
  toKlingDuration,
  toKlingAspectRatio,
  KlingModelAccessDeniedError,
  KLING_MODELS,
  type KlingEnv,
  type KlingMultiShot,
} from "./_kling-api";
import {
  type VideoPromptJson,
  type ExtendPromptJson,
  renderKlingPromptFromJson,
  renderKlingExtendPromptFromJson,
} from "./_video-prompt-json";
import { serverSanitizeAndValidate } from "./_prompt-sanitizer";

type Env = KlingEnv;

/** StructuredSequenceDocument의 서버 측 미러 (클라이언트에서 전달) — v2 dense fields 포함 */
interface StructuredSequencePayload {
  // ── Dense Sequence Fields (v2) ──
  sequenceId?: string;
  sceneType?: string;
  durationSec?: number;
  styleProfile?: { mode: string; mediumLock?: string; colorAnchor?: string };
  continuity?: { lighting: string; sky?: string; surface?: string; scale?: string; characterRef?: string; mustPersist: string[] };
  physicsRules?: { hasWind: boolean; hasAtmosphere: boolean; gravity: string; flagMotionSource?: string; skyConstraint?: string; lightConstraint?: string; bannedExpressions: string[]; environmentType: string };
  placeIdentityAnchors?: string[];
  situationEvidence?: string[];
  naturalMotion?: string[];
  cameraPlan?: { baseFraming: string; angle: string; motion: string; motionMotivation?: string };
  temporalBeats?: Array<{ startSec: number; endSec: number; focus: string }>;
  densityScore?: { total: number; breakdown: Record<string, boolean>; missing: string[] };
  shots?: Array<{ shotId: string; startSec: number; endSec: number; camera: { framing: string; angle: string; motion: string }; subject: string; action: string; environment: string; moodLighting: string; focus: string }>;

  // ── Legacy / Existing ──
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
  validation?: { valid: boolean; errors: number; warnings: number; issues?: Array<{ rule: string; severity: string; message: string }> };
}

/**
 * 서버 사이드 last-mile 직렬화 + final validation.
 * StructuredSequencePayload → Kling 전송용 문자열.
 *
 * 이 함수가 서버에서 provider payload를 만드는 유일한 경로다.
 * 반환값의 prompt/negativePrompt만 provider에 전송해야 한다.
 */
function serializeSequenceToPrompt(
  seq: StructuredSequencePayload,
): { prompt: string; negativePrompt: string; valid: boolean; blocked: boolean; blockReason?: string; payloadSnapshot: string } {
  const provider = "kling" as const;

  // videoPromptJson이 있으면 Kling 렌더러 사용
  if (seq.videoPromptJson) {
    return {
      prompt: renderKlingPromptFromJson(seq.videoPromptJson),
      negativePrompt: "",
      valid: true,
      blocked: false,
      payloadSnapshot: JSON.stringify({ prompt: renderKlingPromptFromJson(seq.videoPromptJson), negativePrompt: "", provider }),
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

  // Camera — cameraPlan이 있으면 우선 사용, 없으면 shotPlan.camera fallback
  const cam = seq.cameraPlan || shot.camera;
  const camFraming = "baseFraming" in cam ? (cam as typeof seq.cameraPlan).baseFraming : shot.camera.framing;
  const framing = framingMap[camFraming] || camFraming;
  const camAngle = "angle" in cam ? cam.angle : shot.camera.angle;
  const angle = angleMap[camAngle] || camAngle;
  const camMotion = "motion" in cam ? cam.motion : shot.camera.motion;
  const motion = camMotion && camMotion !== "static"
    ? `, ${camMotion}` : "";
  parts.push(`${framing}, ${angle}${motion}`);

  // cameraPlan에 motionMotivation이 있으면 연속 카메라 의미 보존
  const camMotivation = seq.cameraPlan?.motionMotivation || shot.camera.motionMotivation;
  if (camMotivation) {
    parts.push(`continuous camera move — ${camMotivation}`);
  }

  // Subject
  if (shot.subject.primary) {
    const line = shot.subject.blocking
      ? `${shot.subject.primary}, ${shot.subject.blocking}`
      : shot.subject.primary;
    parts.push(line);
  }

  // placeIdentityAnchors — 장소 정체성 (shotPlan.locationCue보다 우선)
  if (seq.placeIdentityAnchors && seq.placeIdentityAnchors.length > 0) {
    parts.push(seq.placeIdentityAnchors.join(", "));
  } else if (shot.locationCue) {
    parts.push(shot.locationCue);
  }

  // situationEvidence — 상황 증거 (shotPlan.situationCue보다 우선)
  if (seq.situationEvidence && seq.situationEvidence.length > 0) {
    parts.push(seq.situationEvidence.join(", "));
  } else if (shot.situationCue) {
    parts.push(shot.situationCue);
  }

  if (shot.subject.characterRef) parts.push(shot.subject.characterRef);
  if (shot.emotionalAnchor) parts.push(shot.emotionalAnchor);
  if (shot.action) parts.push(shot.action);

  // naturalMotion — 환경 자연 모션 (바람, 물, 빛 변화 등)
  if (seq.naturalMotion && seq.naturalMotion.length > 0) {
    parts.push(seq.naturalMotion.join(", "));
  }

  if (shot.moodLighting) parts.push(shot.moodLighting);

  // temporalBeats — 시간 진행 구조 (shotPlan.timingBeat보다 우선)
  if (seq.temporalBeats && seq.temporalBeats.length > 0) {
    const beatStr = seq.temporalBeats
      .map(b => `${b.startSec}s-${b.endSec}s: ${b.focus}`)
      .join(". ");
    parts.push(beatStr);
  } else if (shot.timingBeat) {
    parts.push(shot.timingBeat);
  }

  if (shot.transitionFromPrev) parts.push(`Previous shot ends with ${shot.transitionFromPrev}`);
  if (shot.visualMedium) parts.push(shot.visualMedium);

  // physicsRules — 환경 물리 제약 반영
  if (seq.physicsRules) {
    const pr = seq.physicsRules;
    const physParts: string[] = [];

    // 대기 없는 환경 (진공)
    if (!pr.hasAtmosphere) {
      physParts.push("vacuum environment — no atmospheric effects");
    }

    // 바람 없는 환경
    if (!pr.hasWind) {
      physParts.push("no wind");
    }

    // 중력
    if (pr.gravity === "low") {
      physParts.push("low gravity — slow arcing trajectories, objects settle gradually");
    } else if (pr.gravity === "zero") {
      physParts.push("zero gravity — objects float freely");
    }

    // 깃발 등 특수 물체 모션 소스
    if (pr.flagMotionSource) {
      physParts.push(pr.flagMotionSource);
    }

    // 하늘/광원 제약
    if (pr.skyConstraint) physParts.push(pr.skyConstraint);
    if (pr.lightConstraint) physParts.push(pr.lightConstraint);

    // 금지 표현
    if (pr.bannedExpressions && pr.bannedExpressions.length > 0) {
      physParts.push(`avoid: ${pr.bannedExpressions.join(", ")}`);
    }

    if (physParts.length > 0) {
      parts.push(physParts.join(". "));
    }
  }

  // Audio hint
  const isNoAtmosphere = seq.physicsRules && !seq.physicsRules.hasAtmosphere;
  if (isNoAtmosphere) {
    parts.push("Vacuum silence — no audible environment");
  }

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
    physicsRules: seq.physicsRules ? {
      hasWind: seq.physicsRules.hasWind,
      hasAtmosphere: seq.physicsRules.hasAtmosphere,
      gravity: seq.physicsRules.gravity,
      environmentType: seq.physicsRules.environmentType,
      bannedExpressions: seq.physicsRules.bannedExpressions,
    } : undefined,
    sceneType: seq.sceneType,
    durationSec: seq.durationSec,
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

  // ═══════════════════════════════════════════════════════════════
  // Final Validation — pos/neg 충돌 재검증
  // ═══════════════════════════════════════════════════════════════
  const criticalPosNegWords = ["watermark", "caption", "subtitle", "logo", "photorealistic", "cinematic", "text overlay"];
  const promptLower = prompt.toLowerCase();
  const finalFixLog: string[] = [];
  uniqueNeg = uniqueNeg.filter(neg => {
    const negLower = neg.toLowerCase().trim();
    if (criticalPosNegWords.some(w => negLower.includes(w)) && promptLower.includes(negLower)) {
      finalFixLog.push(`[server-final-validation] Removed conflicting negative "${neg}" (found in prompt)`);
      return false;
    }
    return true;
  });
  if (finalFixLog.length > 0) {
    console.log("[serializeSequenceToPrompt] final validation fixes:", {
      cutNumber: seq.cutNumber,
      fixes: finalFixLog,
    });
  }

  const negStr = uniqueNeg.join(", ");

  // Kling: separate negative prompt (no embedding in main prompt)
  // Word cap: 300 for Kling
  const maxWords = 300;
  const words = prompt.split(/\s+/);
  if (words.length > maxWords) {
    prompt = words.slice(0, maxWords - 5).join(" ");
  }

  prompt = prompt
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  // ═══════════════════════════════════════════════════════════════
  // Hard-fix: 본문에서 pos/neg 충돌 최종 제거
  // ═══════════════════════════════════════════════════════════════
  const ZERO_TOLERANCE = ["watermark", "caption", "subtitle", "logo", "photorealistic", "cinematic"];
  let body = prompt;
  const effectiveNeg = negStr.split(", ");

  for (const word of ZERO_TOLERANCE) {
    const wl = word.toLowerCase();
    if (!effectiveNeg.some(n => n.toLowerCase().includes(wl))) continue;
    if (!body.toLowerCase().includes(wl)) continue;
    const guardRe = new RegExp(`\\b(?:no|avoid|without)\\s+(?:[\\w\\s,]+\\s+)?${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (guardRe.test(body)) continue;
    body = body.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "")
      .replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
    finalFixLog.push(`[hard-fix] Removed "${word}" from prompt body (zero-tolerance conflict)`);
  }
  prompt = body.replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();

  // ═══════════════════════════════════════════════════════════════
  // Hard-block check
  // ═══════════════════════════════════════════════════════════════
  let blocked = false;
  let blockReason: string | undefined;
  const bodyAfterFix = prompt.toLowerCase();
  const remainingConflicts = ZERO_TOLERANCE.filter(w => {
    const wl = w.toLowerCase();
    if (!effectiveNeg.some(n => n.toLowerCase().includes(wl))) return false;
    if (!bodyAfterFix.includes(wl)) return false;
    const guardRe = new RegExp(`\\b(?:no|avoid|without)\\s+(?:[\\w\\s,]+\\s+)?${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return !guardRe.test(bodyAfterFix);
  });
  if (remainingConflicts.length > 0) {
    blocked = true;
    blockReason = `pos_neg_conflict: ${remainingConflicts.join(", ")} still in prompt after hard-fix`;
  }

  // ═══════════════════════════════════════════════════════════════
  // Server hard gate: scene-type / shot-count / framing validation
  // ═══════════════════════════════════════════════════════════════
  const MULTI_SHOT_SCENE_TYPES = new Set([
    "environment", "character-driven", "character", "crowd",
    "battle", "map-graphic", "map_visualization", "cinematic_sequence",
  ]);
  const shotCount = seq.shots?.length ?? 1;
  const sceneType = seq.sceneType || "unknown";
  const durationSec = seq.durationSec && seq.durationSec > 0 ? seq.durationSec : 8;

  // Hard gate 1: environment/character/battle scenes with 1 shot AND duration > 3s → warn (not block)
  if (MULTI_SHOT_SCENE_TYPES.has(sceneType) && shotCount < 2 && durationSec > 3) {
    console.warn("[serializeSequenceToPrompt] ⚠️ HARD-GATE: single-shot multi-shot-required scene", {
      sceneType,
      shotCount,
      durationSec,
      cutNumber: seq.cutNumber,
    });
    finalFixLog.push(`[hard-gate] ${sceneType} scene has only ${shotCount} shot(s) for ${durationSec}s — should be 2+`);
  }

  // Hard gate 2: environment scene with close framing → force warn
  if (sceneType === "environment" || sceneType === "map-graphic" || sceneType === "map_visualization") {
    const framing = shot.camera?.framing?.toUpperCase();
    if (framing && ["CU", "ECU", "MCU"].includes(framing)) {
      console.warn("[serializeSequenceToPrompt] ⚠️ HARD-GATE: environment/map scene with close framing", {
        sceneType,
        framing,
        cutNumber: seq.cutNumber,
      });
      finalFixLog.push(`[hard-gate] ${sceneType} scene has close framing "${framing}" — should be WS/LS`);
    }
  }

  // Hard gate 3: empty prompt → block
  if (prompt.trim().length < 20) {
    blocked = true;
    blockReason = blockReason
      ? `${blockReason}; prompt_too_short (${prompt.trim().length} chars)`
      : `prompt_too_short: only ${prompt.trim().length} chars after processing`;
  }

  const payloadSnapshot = JSON.stringify({ prompt, negativePrompt: negStr, provider });

  if (finalFixLog.length > 0) {
    console.log("[serializeSequenceToPrompt] final validation fixes:", {
      cutNumber: seq.cutNumber,
      fixes: finalFixLog,
      blocked,
      blockReason,
    });
  }

  return {
    prompt,
    negativePrompt: negStr,
    valid: !blocked,
    blocked,
    blockReason,
    payloadSnapshot,
  };
}

interface GenerateVideoRequest {
  // ── 공통 ──────────────────────────────────────────────────────────────────
  /** @deprecated legacy fallback. source of truth는 structuredSequence. */
  prompt?: string;
  engine?: "veo" | "kling" | "auto";   // veo = legacy disabled, auto = kling
  videoMode?: "generate" | "extend";
  sourceVideo?: string;
  cutNumber?: number;
  // ── JSON-first source of truth (최우선) ───────────────────────────────────
  structuredSequence?: StructuredSequencePayload;
  // ── JSON 프롬프트 (structuredSequence 없으면 fallback) ─────────────────────
  videoPromptJson?: VideoPromptJson;
  extendPromptJson?: ExtendPromptJson;
  // ── Kling 전용 ──────────────────────────────────────────────────────────────
  durationSeconds?: number;
  aspectRatio?: string;
  negativePrompt?: string;
  firstFrameBase64?: string;
  lastFrameBase64?: string;
  multiShot?: KlingMultiShot[];
  generateAudio?: boolean; // true = sound "on", false = sound "off"
  // ── Legacy Veo fields (무시됨) ──────────────────────────────────────────
  mode?: string;
  resolution?: string;
  personGeneration?: string;
  seed?: number;
  sampleCount?: number;
  previousVideoUri?: string;
  referenceImages?: string[];
}

// ── base64 data URI 접두사 제거 ────────────────────────────────────────────
function stripDataPrefix(b64: string): string {
  return b64.replace(/^data:[^;]+;base64,/, "");
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const tServerStart = Date.now();
  try {
    const req = await context.request.json() as GenerateVideoRequest;

    // ── JSON-first 프롬프트 해석 ─────────────────────────────────────────────
    // source of truth: structuredSequence (1급) > videoPromptJson (legacy) > prompt (legacy fallback)
    let finalPromptForProvider: string | undefined;
    let usedPath: "structuredSequence" | "videoPromptJson" | "prompt_legacy" = "prompt_legacy";
    let fallbackReason: string | undefined;
    const hasStructuredSequence = !!req.structuredSequence?.shotPlan;

    let payloadSnapshot: string | undefined;
    let klingNegativePrompt = req.negativePrompt || "";

    if (hasStructuredSequence) {
      const serialized = serializeSequenceToPrompt(req.structuredSequence!);
      if (serialized.blocked) {
        console.error("[generate-video] BLOCKED by final validation:", serialized.blockReason);
        return Response.json(
          { error: `Generation blocked: ${serialized.blockReason}`, blocked: true },
          { status: 422 },
        );
      }
      finalPromptForProvider = serialized.prompt;
      payloadSnapshot = serialized.payloadSnapshot;
      klingNegativePrompt = serialized.negativePrompt || klingNegativePrompt;
      usedPath = "structuredSequence";
      console.log("[generate-video] structuredSequence → 서버 직렬화 (last-mile)", {
        cutNumber: req.cutNumber,
        shotId: req.structuredSequence!.shotId,
        serializedLen: finalPromptForProvider.length,
        serializedPreview: finalPromptForProvider.slice(0, 120),
        valid: serialized.valid,
        blocked: serialized.blocked,
      });
    } else if (req.videoPromptJson && !req.prompt) {
      finalPromptForProvider = renderKlingPromptFromJson(req.videoPromptJson);
      usedPath = "videoPromptJson";
      fallbackReason = "no structuredSequence";

      const legacySanitize = serverSanitizeAndValidate({
        prompt: finalPromptForProvider,
        negatives: req.negativePrompt ? req.negativePrompt.split(",").map(s => s.trim()) : [],
        framing: req.videoPromptJson.shotSize || "MS",
        shotCategory: undefined,
        styleSuffix: req.videoPromptJson.styleSuffix,
        provider: "kling",
      });
      finalPromptForProvider = legacySanitize.prompt;
      if (legacySanitize.log.length > 0) {
        console.log("[generate-video] videoPromptJson legacy sanitize:", legacySanitize.log);
      }
    } else if (req.prompt) {
      finalPromptForProvider = req.prompt;
      usedPath = "prompt_legacy";
      fallbackReason = "no structuredSequence, no videoPromptJson";

      const legacySanitize = serverSanitizeAndValidate({
        prompt: finalPromptForProvider,
        negatives: req.negativePrompt ? req.negativePrompt.split(",").map(s => s.trim()) : [],
        framing: "MS",
        shotCategory: undefined,
        provider: "kling",
      });
      finalPromptForProvider = legacySanitize.prompt;
    }

    if (!finalPromptForProvider) {
      return Response.json({ error: "structuredSequence, videoPromptJson, or prompt must be provided" }, { status: 400 });
    }

    console.log("[generate-video] source-of-truth resolution:", {
      usedPath,
      hasStructuredSequence,
      fallbackReason: fallbackReason || "none (structured path)",
      finalPromptLen: finalPromptForProvider.length,
      finalPromptPreview: finalPromptForProvider.slice(0, 120),
    });

    // durationSeconds 타입 검증
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

    // ── 엔진 선택: Kling 전용 ──────────────────────────────────────────────
    // Veo 경로 제거 — engine="veo" 요청이 와도 Kling으로 처리
    const hasKling = !!context.env.KLING_API_KEY;
    if (!hasKling) {
      return Response.json(
        { error: "KLING_API_KEY not configured. Veo engine has been removed — only Kling is supported." },
        { status: 400 },
      );
    }

    const engineUsed = "kling" as const;

    if (req.engine === "veo") {
      console.warn("[generate-video] ⚠️ engine=veo 요청 → Kling으로 강제 전환 (Veo 경로 제거됨)");
    }

    // CUT 1 서버 방어
    const cutNumberRaw = req.cutNumber != null ? Number(req.cutNumber) : null;
    const videoMode = (req.videoMode === "extend" && cutNumberRaw === 1)
      ? "generate"
      : (req.videoMode ?? "extend");

    if (req.videoMode === "extend" && cutNumberRaw === 1) {
      console.warn("[generate-video] CUT 1에 videoMode=extend 요청 → generate로 강제 전환");
    }

    const sourceVideo = req.sourceVideo || req.previousVideoUri || "";

    // ── Kling 생성 ────────────────────────────────────────────────────────────
    const requestedDuration = req.durationSeconds;
    const normalizedDuration = req.durationSeconds && req.durationSeconds > 0 ? req.durationSeconds : 8;
    const duration = toKlingDuration(normalizedDuration);
    const durationWarnings: string[] = [];
    if (requestedDuration !== undefined && requestedDuration !== duration) {
      durationWarnings.push(`요청 ${requestedDuration}초 → Kling 전송 ${duration}초 (클램핑 적용)`);
    }
    const aspectRatio = toKlingAspectRatio(req.aspectRatio ?? "16:9");

    // Audio: generateAudio 설정 + physics override (무대기 환경은 강제 off)
    const physicsNoAtmo = req.structuredSequence?.physicsRules && !req.structuredSequence.physicsRules.hasAtmosphere;
    const soundParam: "on" | "off" = physicsNoAtmo ? "off" : (req.generateAudio !== false ? "on" : "off");

    // base64 검증
    const strippedFirst = req.firstFrameBase64 ? stripDataPrefix(req.firstFrameBase64) : "";
    const strippedLast  = req.lastFrameBase64  ? stripDataPrefix(req.lastFrameBase64)  : "";
    const validFirst    = strippedFirst.length > 100 ? strippedFirst : "";
    const validLast     = strippedLast.length  > 100 ? strippedLast  : "";

    console.log("[Kling] 요청 진단", {
      cutNumber: cutNumberRaw,
      provider: "kling",
      selectedMode: videoMode,
      originalReqMode: req.videoMode ?? null,
      hasFirstFrame: !!req.firstFrameBase64,
      validFirstLen: validFirst.length,
      hasLastFrame: !!req.lastFrameBase64,
      validLastLen: validLast.length,
    });

    let taskId: string;
    let modeUsed: "generate" | "extend";
    let sentDuration: number = duration;

    try {
      if (videoMode === "extend" && validLast) {
        console.log("[Kling] EXTEND mode (last-frame → image-to-video)", { frameLen: validLast.length });
        const result = await klingExtend(context.env, {
          lastFrameBase64: validLast,
          prompt:          finalPromptForProvider,
          negative_prompt: klingNegativePrompt,
          duration,
          aspect_ratio:    aspectRatio,
          sound:           soundParam,
        });
        taskId = result.taskId;
        sentDuration = result.sentDuration;
        modeUsed = "extend";
      } else {
        if (!validFirst && videoMode === "extend" && !sourceVideo) {
          console.error("[Kling] extend 요청이지만 유효한 image/sourceVideo 없음");
          return Response.json(
            {
              error: "Kling EXTEND mode requires valid lastFrameBase64, firstFrameBase64, or sourceVideo",
              details: { videoMode, hasLastFrame: !!req.lastFrameBase64, hasFirstFrame: !!req.firstFrameBase64 },
            },
            { status: 400 },
          );
        }

        console.log("[Kling] GENERATE mode", {
          hasImage: !!validFirst,
          hasImageTail: !!validLast,
        });
        const result = await klingGenerate(context.env, {
          prompt:          finalPromptForProvider,
          negative_prompt: klingNegativePrompt,
          aspect_ratio:    aspectRatio,
          duration,
          sound:           soundParam,
          ...(validFirst ? { image:      validFirst } : {}),
          ...(validLast  ? { image_tail: validLast  } : {}),
          ...(req.multiShot && req.multiShot.length > 0 ? { multiShot: req.multiShot } : {}),
        });
        taskId = result.taskId;
        sentDuration = result.sentDuration;
        modeUsed = "generate";
      }
    } catch (klingErr) {
      // 403 model_access_denied — 재시도 불가, 명확한 에러 분류
      if (klingErr instanceof KlingModelAccessDeniedError) {
        console.error("[Kling] MODEL_ACCESS_DENIED (not retryable)", {
          modelRequested: klingErr.modelRequested,
          cutNumber: req.cutNumber,
        });
        return Response.json(
          {
            error: klingErr.message,
            code: "model_access_denied",
            retryable: false,
            modelRequested: klingErr.modelRequested,
            modelFallback: KLING_MODELS.TEXT_TO_VIDEO,
          },
          { status: 403 },
        );
      }

      const msg = klingErr instanceof Error ? klingErr.message : String(klingErr);
      const httpStatus = (klingErr as Error & { httpStatus?: number }).httpStatus;
      const status = httpStatus === 400 ? 400 : httpStatus === 401 ? 401 : 502;
      console.error("[Kling] API 에러", { msg, httpStatus, cutNumber: req.cutNumber });
      return Response.json({ error: msg }, { status });
    }

    const serverTotalMs = Date.now() - tServerStart;
    console.log("[generate-video] ⏱ timing", {
      serverTotalMs,
      promptChars: finalPromptForProvider.length,
      mode: videoMode,
      cutNumber: cutNumberRaw,
      engine: "kling",
      durationRequested: requestedDuration,
      durationNormalized: normalizedDuration,
      durationSent: sentDuration,
    });

    return Response.json({
      operationName: taskId,
      taskId,
      engine: "kling",
      modeUsed,
      modelUsed: KLING_MODELS.TEXT_TO_VIDEO,
      sourceVideo: sourceVideo || undefined,
      status: "RUNNING",
      durationMeta: {
        requestedSecondsPerScene: requestedDuration,
        normalizedSecondsPerScene: normalizedDuration,
        sentSecondsPerScene: sentDuration,
        warnings: durationWarnings,
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
