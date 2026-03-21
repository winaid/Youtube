/**
 * generate-video.ts — VEO 전용 영상 생성 (8초 멀티샷 강제)
 *
 * 아키텍처:
 *   VEO = 유일한 영상 생성 엔진 (text-to-video / image-to-video / extend)
 *   Gemini = QA / validation / auto-fix (별도 route)
 *
 * 정책:
 *   - 모든 생성은 반드시 8초 멀티샷 타임스탬프 형식
 *   - 기본 4샷 구조: [00:00-00:02], [00:02-00:04], [00:04-00:06], [00:06-00:08]
 *   - 단일샷 금지 — 항상 최소 2샷 이상
 *   - Cut 1 = veoGenerate(), Cut 2+ = veoExtend() (연장 체인)
 *
 * source of truth: structuredSequence (JSON-first)
 */
import {
  veoGenerate,
  veoExtend,
  VeoApiError,
  VEO_DEFAULT_MODEL,
  getCapability,
  resolveModelForWorkflow,
  toVeoDuration,
  toVeoAspectRatio,
  type VeoEnv,
} from "./_veo-api";
import {
  renderVeoPrompt,
  type VeoPromptRendererInput,
} from "./_veo-prompt-renderer";
import {
  type VideoPromptJson,
  type ExtendPromptJson,
  renderPromptFromJson,
  renderExtendPromptFromJson,
} from "./_video-prompt-json";
import { serverSanitizeAndValidate } from "./_prompt-sanitizer";

type Env = VeoEnv;

// ═══════════════════════════════════════════════════════════════════
// Provider-Facing Prompt Cleanup Utilities
// ═══════════════════════════════════════════════════════════════════

const INTERNAL_TAG_PATTERNS = [
  /\[VISUAL LOCK\]\s*/gi,
  /\[CHARACTER LOCK\]\s*/gi,
  /\[CONTINUATION\][^.]*\./gi,
  /\[ENDING\][^.]*\./gi,
  /\[Establishing wide shot\]\s*/gi,
  /\[Developing mid shot\]\s*/gi,
  /\[Peak dramatic moment\]\s*/gi,
  /\[Resolving close-up\]\s*/gi,
  /\[Transition\]\s*/gi,
  /\[Insert detail\]\s*/gi,
  /\[Shot \d+\/\d+[^\]]*\]\s*/gi,
];

function stripInternalTags(text: string): string {
  let cleaned = text;
  for (const pattern of INTERNAL_TAG_PATTERNS) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, "");
  }
  cleaned = cleaned.replace(/\[(?:VISUAL|CHARACTER|CONTINUATION|ENDING|NARRATIVE|LOCK)[^\]]*\]\s*/gi, "");
  return cleaned.replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();
}

function deduplicatePromptClauses(text: string): string {
  const sentences = text.split(/\.\s+/).filter(s => s.trim().length > 3);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const s of sentences) {
    const norm = s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
    if (norm.length < 10) { unique.push(s.trim()); continue; }
    let isDupe = false;
    for (const prev of seen) {
      if (prev === norm || prev.includes(norm) || norm.includes(prev)) { isDupe = true; break; }
    }
    if (!isDupe) {
      seen.add(norm);
      unique.push(s.trim());
    }
  }
  return unique.join(". ").replace(/\.\s*\./g, ".").trim();
}

function extractCompactVisualLock(rawLock: string): string {
  if (!rawLock || rawLock.length < 5) return "";
  const stripped = rawLock
    .replace(/\b(no\s+text\s+overlay|no\s+watermark|no\s+caption)\b/gi, "")
    .replace(/\b\d+:\d+\b/g, "")
    .replace(/\b(cinematic\s+framing|widescreen|letterbox)\b/gi, "")
    .trim();
  const anchors: string[] = [];
  const mediumMatch = stripped.match(/\b(claymation|stop[\s-]?motion|watercolor|oil[\s-]?paint|pencil[\s-]?sketch|anime|cel[\s-]?shad|charcoal|photorealistic|cinematic[\s-]?realism|documentary|live[\s-]?action)\b/i);
  if (mediumMatch) anchors.push(mediumMatch[0].toLowerCase());
  const materialMatch = stripped.match(/\b(fingerprint\s+texture|handcrafted|clay\s+surface|impasto|visible\s+brush|grainy\s+film|film\s+grain|halation)\b/i);
  if (materialMatch) anchors.push(materialMatch[0].toLowerCase());
  const paletteMatch = stripped.match(/\b(desaturated|warm\s+palette|cool\s+palette|monochrome|sepia|muted|pastel|high[\s-]?contrast|low[\s-]?key|high[\s-]?key)\b/i);
  if (paletteMatch) anchors.push(paletteMatch[0].toLowerCase());
  const lightMatch = stripped.match(/\b(practical\s+light|tungsten|candlelit|gaslight|neon|studio\s+light|backlit|rim[\s-]?light|warm\s+lamp\s+light)\b/i);
  if (lightMatch) anchors.push(lightMatch[0].toLowerCase());
  if (anchors.length === 0) return "";
  return anchors.join(", ");
}

// ═══════════════════════════════════════════════════════════════════
// StructuredSequence Types (서버 측 미러)
// ═══════════════════════════════════════════════════════════════════

interface StructuredSequencePayload {
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
    shotCategory?: string;
    [key: string]: unknown;
  };
  videoPromptJson?: VideoPromptJson;
  negatives?: {
    universal: string[];
    style?: string[];
    sceneSpecific: string[];
    failureMode: string[];
    user: string[];
  };
  validation?: { valid: boolean; errors: number; warnings: number; issues?: Array<{ rule: string; severity: string; message: string }> };
}

// ═══════════════════════════════════════════════════════════════════
// Sequence → Prompt Serialization
// ═══════════════════════════════════════════════════════════════════

function serializeSequenceToPrompt(
  seq: StructuredSequencePayload,
): { prompt: string; negativePrompt: string; valid: boolean; blocked: boolean; blockReason?: string; payloadSnapshot: string } {
  const provider = "veo" as const;

  if (seq.videoPromptJson) {
    return {
      prompt: renderPromptFromJson(seq.videoPromptJson),
      negativePrompt: "",
      valid: true,
      blocked: false,
      payloadSnapshot: JSON.stringify({ prompt: renderPromptFromJson(seq.videoPromptJson), negativePrompt: "", provider }),
    };
  }

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

  const cam = seq.cameraPlan || shot.camera;
  const camFraming = "baseFraming" in cam ? (cam as typeof seq.cameraPlan).baseFraming : shot.camera.framing;
  const framing = framingMap[camFraming] || camFraming;
  const camAngle = "angle" in cam ? cam.angle : shot.camera.angle;
  const angle = angleMap[camAngle] || camAngle;
  const camMotion = "motion" in cam ? cam.motion : shot.camera.motion;
  const motion = camMotion && camMotion !== "static" ? `, ${camMotion}` : "";
  parts.push(`${framing}, ${angle}${motion}`);

  const camMotivation = seq.cameraPlan?.motionMotivation || shot.camera.motionMotivation;
  if (camMotivation) parts.push(`continuous camera move — ${camMotivation}`);

  if (shot.subject.primary) {
    const line = shot.subject.blocking ? `${shot.subject.primary}, ${shot.subject.blocking}` : shot.subject.primary;
    parts.push(line);
  }
  if (seq.placeIdentityAnchors && seq.placeIdentityAnchors.length > 0) parts.push(seq.placeIdentityAnchors.join(", "));
  else if (shot.locationCue) parts.push(shot.locationCue);
  if (seq.situationEvidence && seq.situationEvidence.length > 0) parts.push(seq.situationEvidence.join(", "));
  else if (shot.situationCue) parts.push(shot.situationCue);
  if (shot.subject.characterRef) parts.push(shot.subject.characterRef);
  if (shot.emotionalAnchor) parts.push(shot.emotionalAnchor);
  if (shot.action) parts.push(shot.action);
  if (seq.naturalMotion && seq.naturalMotion.length > 0) parts.push(seq.naturalMotion.join(", "));
  if (shot.moodLighting) parts.push(shot.moodLighting);

  if (seq.temporalBeats && seq.temporalBeats.length > 0) {
    const beatStr = seq.temporalBeats.map(b => `${b.startSec}s-${b.endSec}s: ${b.focus}`).join(". ");
    parts.push(beatStr);
  } else if (shot.timingBeat) {
    parts.push(shot.timingBeat);
  }

  if (shot.transitionFromPrev) parts.push(`Previous shot ends with ${shot.transitionFromPrev}`);
  if (shot.visualMedium) parts.push(shot.visualMedium);

  if (seq.physicsRules) {
    const pr = seq.physicsRules;
    const physParts: string[] = [];
    if (!pr.hasAtmosphere) physParts.push("vacuum environment — no atmospheric effects");
    if (!pr.hasWind) physParts.push("no wind");
    if (pr.gravity === "low") physParts.push("low gravity — slow arcing trajectories");
    else if (pr.gravity === "zero") physParts.push("zero gravity — objects float freely");
    if (pr.flagMotionSource) physParts.push(pr.flagMotionSource);
    if (pr.skyConstraint) physParts.push(pr.skyConstraint);
    if (pr.lightConstraint) physParts.push(pr.lightConstraint);
    if (pr.bannedExpressions && pr.bannedExpressions.length > 0) physParts.push(`avoid: ${pr.bannedExpressions.join(", ")}`);
    if (physParts.length > 0) parts.push(physParts.join(". "));
  }

  let prompt = parts.filter(Boolean).join(". ");

  const baseNeg = seq.negatives
    ? [...seq.negatives.universal, ...(seq.negatives.style || []), ...seq.negatives.sceneSpecific, ...seq.negatives.failureMode, ...seq.negatives.user]
    : (shot.negativeDirectives || []);
  const allNeg = [...baseNeg, "text overlay", "watermark"];
  let uniqueNeg = [...new Set(allNeg)].slice(0, 30);

  const sanitizeResult = serverSanitizeAndValidate({
    prompt,
    negatives: uniqueNeg,
    framing: shot.camera.framing,
    shotCategory: shot.shotCategory,
    styleSuffix: seq.videoPromptJson?.styleSuffix,
    provider: "veo",
    physicsRules: seq.physicsRules ? {
      hasWind: seq.physicsRules.hasWind,
      hasAtmosphere: seq.physicsRules.hasAtmosphere,
      gravity: seq.physicsRules.gravity,
      environmentType: seq.physicsRules.environmentType,
      bannedExpressions: seq.physicsRules.bannedExpressions,
    } : undefined,
    sceneType: seq.sceneType,
    durationSec: 8,
  });
  prompt = sanitizeResult.prompt;
  uniqueNeg = sanitizeResult.negatives;

  // Prompt too short → block
  let blocked = false;
  let blockReason: string | undefined;
  if (prompt.trim().length < 20) {
    blocked = true;
    blockReason = `prompt_too_short: only ${prompt.trim().length} chars after processing`;
  }

  const negStr = uniqueNeg.join(", ");
  const payloadSnapshot = JSON.stringify({ prompt, negativePrompt: negStr, provider });

  return { prompt, negativePrompt: negStr, valid: !blocked, blocked, blockReason, payloadSnapshot };
}

// ═══════════════════════════════════════════════════════════════════
// Request Types
// ═══════════════════════════════════════════════════════════════════

interface GenerateVideoRequest {
  prompt?: string;
  engine?: "veo" | "auto";
  videoMode?: "generate" | "extend";
  sourceVideo?: string;
  cutNumber?: number;
  workflowType?: "text-to-video" | "image-to-video" | "extend";
  structuredSequence?: StructuredSequencePayload;
  videoPromptJson?: VideoPromptJson;
  extendPromptJson?: ExtendPromptJson;
  durationSeconds?: number;
  aspectRatio?: string;
  negativePrompt?: string;
  firstFrameBase64?: string;
  lastFrameBase64?: string;
  multiShot?: Array<{ index: number; prompt: string; duration: string; role?: string }>;
  generateAudio?: boolean;
  generationMode?: "studio" | "batch";
  intentionalOneTake?: boolean;
  referenceImages?: string[]; // 현재 VEO API 미지원 — 클라이언트 호환용으로 수신만 함
  continuityMeta?: {
    segmentIndex: number;
    totalSegments: number;
    isLastSegment: boolean;
    prevEndState?: Record<string, unknown>;
    characterLock?: string;
    visualLock?: string;
  };
  mode?: string;
  resolution?: string;
  personGeneration?: string;
  seed?: number;
  sampleCount?: number;
  previousVideoUri?: string;
}

function stripDataPrefix(b64: string): string {
  return b64.replace(/^data:[^;]+;base64,/, "");
}

// ═══════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const tServerStart = Date.now();
  try {
    const req = await context.request.json() as GenerateVideoRequest;

    // ── JSON-first 프롬프트 해석 ─────────────────────────────────────────────
    let finalPromptForProvider: string | undefined;
    let usedPath: "structuredSequence" | "videoPromptJson" | "prompt_legacy" = "prompt_legacy";
    let fallbackReason: string | undefined;
    const hasStructuredSequence = !!req.structuredSequence?.shotPlan;
    let negativePrompt = req.negativePrompt || "";

    if (hasStructuredSequence) {
      const serialized = serializeSequenceToPrompt(req.structuredSequence!);
      if (serialized.blocked) {
        console.error("[generate-video] BLOCKED by final validation:", serialized.blockReason);
        return Response.json({ error: `Generation blocked: ${serialized.blockReason}`, blocked: true }, { status: 422 });
      }
      finalPromptForProvider = serialized.prompt;
      negativePrompt = serialized.negativePrompt || negativePrompt;
      usedPath = "structuredSequence";
    } else if (req.videoPromptJson && !req.prompt) {
      finalPromptForProvider = renderPromptFromJson(req.videoPromptJson);
      usedPath = "videoPromptJson";
      fallbackReason = "no structuredSequence";
    } else if (req.prompt) {
      finalPromptForProvider = req.prompt;
      usedPath = "prompt_legacy";
      fallbackReason = "no structuredSequence, no videoPromptJson";
    }

    if (!finalPromptForProvider) {
      return Response.json({ error: "structuredSequence, videoPromptJson, or prompt must be provided" }, { status: 400 });
    }

    // ── Tag cleanup & deduplication ──────────────────────────────────────────
    finalPromptForProvider = stripInternalTags(finalPromptForProvider);
    finalPromptForProvider = deduplicatePromptClauses(finalPromptForProvider);

    // ── Continuity Mode 주입 ─────────────────────────────────────────────────
    if (req.continuityMeta) {
      const cm = req.continuityMeta;
      const continuityParts: string[] = [];
      if (cm.characterLock) continuityParts.push(`Maintain character: ${cm.characterLock}`);
      if (cm.visualLock) {
        const compactLock = extractCompactVisualLock(cm.visualLock);
        if (compactLock) continuityParts.push(`Consistent look: ${compactLock}`);
      }
      if (cm.prevEndState && cm.segmentIndex > 0) {
        const pe = cm.prevEndState;
        const contLines = ["Continue seamlessly from previous segment:"];
        if (pe.subjectPosition) contLines.push(`Subject: ${pe.subjectPosition}`);
        if (pe.cameraState) contLines.push(`Camera: ${pe.cameraState}`);
        if (pe.motionVector) contLines.push(`Motion: ${pe.motionVector}`);
        if (pe.lightingState) contLines.push(`Lighting: ${pe.lightingState}`);
        continuityParts.push(contLines.join(" "));
      }
      if (!cm.isLastSegment) {
        continuityParts.push("Last 2 seconds: mid-action, camera moving, emotion unresolved. Do not close the scene.");
      }
      if (continuityParts.length > 0) {
        finalPromptForProvider = continuityParts.join(". ") + ". " + finalPromptForProvider;
      }
    }

    console.log("[generate-video] source-of-truth resolution:", {
      usedPath,
      hasStructuredSequence,
      fallbackReason: fallbackReason || "none",
      finalPromptLen: finalPromptForProvider.length,
      finalPromptPreview: finalPromptForProvider.slice(0, 120),
    });

    // ── API 키 검증 ──────────────────────────────────────────────────────────
    const hasKey = !!context.env.GEMINI_API_KEY || !!context.env.GEMINI_API_KEY_2;
    if (!hasKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured. VEO requires a Gemini API key." }, { status: 400 });
    }

    // ── Cut & Mode 결정 ──────────────────────────────────────────────────────
    const cutNumberRaw = req.cutNumber != null ? Number(req.cutNumber) : null;
    const videoMode = (req.videoMode === "extend" && cutNumberRaw === 1)
      ? "generate"
      : (req.videoMode ?? "generate");

    if (req.videoMode === "extend" && cutNumberRaw === 1) {
      console.warn("[generate-video] CUT 1에 videoMode=extend 요청 → generate로 강제 전환");
    }

    const sourceVideo = req.sourceVideo || req.previousVideoUri || "";

    // ── 모델 선택 ────────────────────────────────────────────────────────────
    const modelUsed = resolveModelForWorkflow({
      workflow: req.workflowType,
      hasImage: !!req.firstFrameBase64,
      hasSourceVideo: !!sourceVideo,
    });

    // ── VEO 멀티샷 타임스탬프 프롬프트 생성 (8초 강제) ───────────────────────
    const veoRendererInput: VeoPromptRendererInput = {
      prompt: finalPromptForProvider,
      negativePrompt: negativePrompt,
      multiShot: req.multiShot,
      styleAnchor: undefined,
      structureType: "FOUR",
    };
    const rendered = renderVeoPrompt(veoRendererInput);

    console.log("[generate-video] VEO 멀티샷 타임스탬프 렌더링 완료:", {
      shotCount: rendered.shotCount,
      totalDuration: rendered.totalDurationSec,
      promptLen: rendered.timestampPrompt.length,
      promptPreview: rendered.timestampPrompt.slice(0, 200),
      cleanupLog: rendered.cleanupLog,
    });

    // ── Audio: physics override (무대기 환경은 강제 off) ─────────────────────
    const physicsNoAtmo = req.structuredSequence?.physicsRules && !req.structuredSequence.physicsRules.hasAtmosphere;
    const generateAudio = physicsNoAtmo ? false : (req.generateAudio !== false);

    // ── base64 검증 ──────────────────────────────────────────────────────────
    const strippedFirst = req.firstFrameBase64 ? stripDataPrefix(req.firstFrameBase64) : "";
    const validFirst = strippedFirst.length > 100 ? strippedFirst : "";

    // ═══════════════════════════════════════════════════════════════════
    // VEO API 호출
    // ═══════════════════════════════════════════════════════════════════

    let operationName: string;
    let modeUsed: "generate" | "extend";
    let sentDuration: number = 8;

    try {
      if (videoMode === "extend" && sourceVideo) {
        // ── VEO Extension (Cut 2+) ────────────────────────────────────
        console.log("[VEO] EXTEND mode", {
          sourceVideoUri: sourceVideo.slice(0, 80),
          model: modelUsed,
        });
        const result = await veoExtend(context.env, {
          prompt: rendered.timestampPrompt,
          sourceVideoUri: sourceVideo,
          model: modelUsed,
          aspectRatio: toVeoAspectRatio(req.aspectRatio ?? "16:9"),
          resolution: "720p",
          personGeneration: (req.personGeneration as "allow_all" | "allow_adult" | "dont_allow") || "allow_all",
          generateAudio,
        });
        operationName = result.operationName;
        sentDuration = result.durationSent;
        modeUsed = "extend";
      } else {
        // ── VEO Generate (Cut 1 또는 extend 불가 시) ─────────────────
        if (videoMode === "extend" && !sourceVideo) {
          console.warn("[VEO] extend 요청이지만 sourceVideo 없음 → generate로 fallback");
        }

        console.log("[VEO] GENERATE mode", {
          hasImage: !!validFirst,
          model: modelUsed,
          duration: 8,
        });
        const result = await veoGenerate(context.env, {
          prompt: rendered.timestampPrompt,
          model: modelUsed,
          durationSeconds: 8,
          aspectRatio: toVeoAspectRatio(req.aspectRatio ?? "16:9"),
          resolution: "720p",
          personGeneration: (req.personGeneration as "allow_all" | "allow_adult" | "dont_allow") || "allow_all",
          generateAudio,
          ...(validFirst ? { imageBase64: validFirst, imageMimeType: "image/png" } : {}),
        });
        operationName = result.operationName;
        sentDuration = result.durationSent;
        modeUsed = "generate";
      }
    } catch (veoErr) {
      if (veoErr instanceof VeoApiError) {
        console.error("[VEO] API error", {
          code: veoErr.code,
          retryable: veoErr.retryable,
          httpStatus: veoErr.httpStatus,
          cutNumber: req.cutNumber,
        });
        const status = veoErr.httpStatus === 401 || veoErr.httpStatus === 403
          ? veoErr.httpStatus
          : veoErr.httpStatus === 429 ? 429
          : veoErr.httpStatus && veoErr.httpStatus >= 400 && veoErr.httpStatus < 500 ? 400
          : 502;
        return Response.json({
          error: veoErr.message,
          code: veoErr.code,
          retryable: veoErr.retryable,
        }, { status });
      }

      const msg = veoErr instanceof Error ? veoErr.message : String(veoErr);
      console.error("[VEO] Unexpected error", { msg, cutNumber: req.cutNumber });
      return Response.json({ error: msg }, { status: 502 });
    }

    const serverTotalMs = Date.now() - tServerStart;
    console.log("[generate-video] ⏱ timing", {
      serverTotalMs,
      promptChars: rendered.timestampPrompt.length,
      mode: modeUsed,
      cutNumber: cutNumberRaw,
      engine: "veo",
      durationSent: sentDuration,
    });

    return Response.json({
      operationName,
      taskId: operationName,
      engine: "veo",
      modeUsed,
      modelUsed,
      sourceVideo: sourceVideo || undefined,
      status: "RUNNING",
      durationMeta: {
        requestedSecondsPerScene: 8,
        normalizedSecondsPerScene: 8,
        sentSecondsPerScene: sentDuration,
        warnings: [],
      },
    });
  } catch (error) {
    console.error("[generate-video] 처리 오류:", error);
    return Response.json(
      { error: `Failed to start video generation: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
};
