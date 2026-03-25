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
  resolveModelForWorkflow,
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

/** 한글 텍스트, 인용문, 대사 패턴, 메타 텍스트를 VEO 전달 직전에 최종 제거 */
function stripTextForVeo(text: string): string {
  let cleaned = text;
  // 따옴표 인용문 제거
  cleaned = cleaned.replace(/[""\u201C\u201D][^""\u201C\u201D]*[""\u201C\u201D]/g, "");
  cleaned = cleaned.replace(/['''][^''']*[''']/g, "");
  cleaned = cleaned.replace(/「[^」]*」/g, "");
  cleaned = cleaned.replace(/『[^』]*』/g, "");
  // "says/whispers + 인용" → speaks
  cleaned = cleaned.replace(/\b(says?|whispers?|shouts?|yells?|murmurs?|mutters?|exclaims?)\s*["'""'「『][^"'""'」』]*["'""'」』]/gi, "speaks");
  // 메타 텍스트 제거 (VEO가 해석 못하는 내부 태그)
  cleaned = cleaned.replace(/\b(establishing view|character introduction|narrative function|scene transition|emotional anchor)[^.]*\./gi, "");
  cleaned = cleaned.replace(/\b(establishing view|character introduction|narrative function|scene transition|emotional anchor)\s*[:—]\s*/gi, "");
  // 한글 + 주변 콤마/공백 정리 (한글 단어와 이어지는 구두점까지 제거)
  cleaned = cleaned.replace(/,?\s*[\uAC00-\uD7A3\u3131-\u3163\u1100-\u11FF]+(?:\s*,?\s*[\uAC00-\uD7A3\u3131-\u3163\u1100-\u11FF]+)*/g, "");
  return cleaned.replace(/\s{2,}/g, " ").replace(/[,.]\s*[,.]/g, ",").replace(/\.\s*\./g, ".").replace(/^[,.\s]+/, "").trim();
}

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
  const seen: string[] = [];
  const unique: string[] = [];
  for (const s of sentences) {
    const norm = s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
    if (norm.length < 10) { unique.push(s.trim()); continue; }
    let isDupe = false;
    for (let i = 0; i < seen.length; i++) {
      const prev = seen[i];
      // 완전 동일만 중복 처리 (substring 포함 관계는 무시 — 디테일 손실 방지)
      if (prev === norm) { isDupe = true; break; }
      // 80% 이상 겹치는 경우에만 중복 (짧은 쪽이 긴 쪽의 80% 이상 포함)
      if (prev.length > 20 && norm.length > 20) {
        const shorter = prev.length < norm.length ? prev : norm;
        const longer = prev.length < norm.length ? norm : prev;
        if (longer.includes(shorter) && shorter.length > longer.length * 0.8) {
          // 거의 동일한 문장 — 더 긴 버전 보존
          if (norm.length >= prev.length) {
            seen[i] = norm;
            for (let j = 0; j < unique.length; j++) {
              const uNorm = unique[j].trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
              if (uNorm === prev) { unique[j] = s.trim(); break; }
            }
          }
          isDupe = true;
          break;
        }
      }
    }
    if (!isDupe) {
      seen.push(norm);
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
    // videoPromptJson 경로도 sanitization 적용 (물리 위반, scene-type 부적합 어휘 수정)
    const vpjPrompt = renderPromptFromJson(seq.videoPromptJson);
    const vpjSanitized = serverSanitizeAndValidate({
      prompt: vpjPrompt,
      negatives: ["text overlay", "watermark"],
      framing: seq.videoPromptJson.shotSize || "MS",
      shotCategory: seq.shotPlan?.shotCategory,
      physicsRules: seq.physicsRules,
      sceneType: seq.sceneType,
      durationSec: 8,
    });
    return {
      prompt: vpjSanitized.blocked ? vpjPrompt : vpjSanitized.prompt,  // blocked이면 원본 유지 (sanitizer 오류 방지)
      negativePrompt: vpjSanitized.negativePrompt || "",
      valid: !vpjSanitized.blocked,
      blocked: vpjSanitized.blocked,
      blockReason: vpjSanitized.blockReason,
      payloadSnapshot: JSON.stringify({ prompt: vpjSanitized.prompt || vpjPrompt, negativePrompt: vpjSanitized.negativePrompt || "", provider }),
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
  // actionBeat/bodySignal: Gemini Step2/3가 생성한 상세 물리 동작 (videoPromptJson에서 가져옴)
  const vpj = seq.videoPromptJson;
  if (vpj?.actionBeat && vpj.actionBeat !== shot.action) parts.push(vpj.actionBeat);
  if (vpj?.bodySignal) parts.push(vpj.bodySignal);
  if (seq.naturalMotion && seq.naturalMotion.length > 0) parts.push(seq.naturalMotion.join(", "));
  if (shot.moodLighting) parts.push(shot.moodLighting);
  // Director visual DNA (videoPromptJson에서 가져옴 — shotPlan에는 없는 필드)
  if (vpj?.directorColorHint) parts.push(vpj.directorColorHint);
  if (vpj?.directorCameraHint) parts.push(vpj.directorCameraHint);

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
    // VEO 물리 규칙 — 부정어("no X") 대신 긍정 표현으로 변환
    // VEO는 "no wind"보다 "perfectly still air, motionless surfaces"를 더 잘 이해함
    if (!pr.hasAtmosphere) physParts.push("vacuum environment, silent void, no particles");
    if (!pr.hasWind) physParts.push("perfectly still air, motionless fabrics and surfaces");
    if (pr.gravity === "low") physParts.push("low gravity, slow floating arcing trajectories");
    else if (pr.gravity === "zero") physParts.push("zero gravity, objects float freely, weightless motion");
    if (pr.flagMotionSource) physParts.push(pr.flagMotionSource);
    if (pr.skyConstraint) physParts.push(pr.skyConstraint);
    if (pr.lightConstraint) physParts.push(pr.lightConstraint);
    // bannedExpressions: "avoid: X" 형태는 VEO에서 역효과 → 제거
    // (sanitizer가 이미 해당 단어를 프롬프트에서 삭제함)
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
  /** 분절 편집 컨텍스트 — UI에서 전달, 500자 hard limit 강제 */
  fragmentedEditContext?: {
    isFragmented: boolean;
    triggerTerms: string[];
    minShotCount: number;
    editStyle: string;
  };
  /**
   * separate_clips 모드 — 서브샷마다 독립 VEO 요청 발송.
   * true이면:
   *   - multiShot의 각 shot을 개별 VEO generate 요청으로 보냄
   *   - 타임스탬프 기반 단일 프롬프트 사용 안 함
   *   - 응답에 clipOperations[] 배열로 shot별 operationName 반환
   *   - 최종 조립은 클라이언트 post step에서 hard cut으로 수행
   */
  separateClips?: boolean;
}

function stripDataPrefix(b64: string): string {
  return b64.replace(/^data:[^;]+;base64,/, "");
}

// ═══════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const tServerStart = Date.now();
  console.info("[generate-video] Request received", { timestamp: new Date().toISOString(), method: context.request.method, url: context.request.url });
  try {
    const req = await context.request.json() as GenerateVideoRequest;
    console.info("[generate-video] Request parsed", {
      elapsedMs: Date.now() - tServerStart,
      hasPrompt: !!req.prompt,
      promptLength: req.prompt?.length ?? 0,
      engine: req.engine ?? "auto",
      videoMode: req.videoMode ?? "generate",
      workflowType: req.workflowType,
      aspectRatio: req.aspectRatio ?? "16:9",
      durationSeconds: req.durationSeconds,
      cutNumber: req.cutNumber,
      hasStructuredSequence: !!req.structuredSequence?.shotPlan,
      hasVideoPromptJson: !!req.videoPromptJson,
      hasExtendPromptJson: !!req.extendPromptJson,
      hasFirstFrame: !!req.firstFrameBase64,
      hasLastFrame: !!req.lastFrameBase64,
      hasSourceVideo: !!req.sourceVideo,
      hasPreviousVideoUri: !!req.previousVideoUri,
      hasMultiShot: !!req.multiShot,
      multiShotCount: req.multiShot?.length ?? 0,
      generateAudio: req.generateAudio,
      generationMode: req.generationMode,
      personGeneration: req.personGeneration,
      hasContinuityMeta: !!req.continuityMeta,
      isFragmentedEdit: !!req.fragmentedEditContext?.isFragmented,
      hasReferenceImages: !!req.referenceImages?.length,
      seed: req.seed,
      sampleCount: req.sampleCount,
    });

    // ── JSON-first 프롬프트 해석 ─────────────────────────────────────────────
    let finalPromptForProvider: string | undefined;
    let usedPath: "structuredSequence" | "videoPromptJson" | "prompt_legacy" = "prompt_legacy";
    let fallbackReason: string | undefined;
    const hasStructuredSequence = !!req.structuredSequence?.shotPlan;
    let negativePrompt = req.negativePrompt || "";

    if (hasStructuredSequence) {
      console.info("[generate-video] Using structuredSequence path", { elapsedMs: Date.now() - tServerStart, shotId: req.structuredSequence!.shotId, cutNumber: req.structuredSequence!.cutNumber });
      const serialized = serializeSequenceToPrompt(req.structuredSequence!);
      if (serialized.blocked) {
        console.error("[generate-video] BLOCKED by final validation:", serialized.blockReason);
        console.info("[generate-video] Returning 422 blocked response", { elapsedMs: Date.now() - tServerStart, blockReason: serialized.blockReason });
        return Response.json({ error: `Generation blocked: ${serialized.blockReason}`, blocked: true }, { status: 422 });
      }
      finalPromptForProvider = serialized.prompt;
      negativePrompt = serialized.negativePrompt || negativePrompt;
      usedPath = "structuredSequence";
      console.info("[generate-video] structuredSequence serialized", { elapsedMs: Date.now() - tServerStart, promptLen: finalPromptForProvider.length, negativeLen: negativePrompt.length });
    } else if (req.videoPromptJson && !req.prompt) {
      console.info("[generate-video] Using videoPromptJson path (fallback)", { elapsedMs: Date.now() - tServerStart });
      finalPromptForProvider = renderPromptFromJson(req.videoPromptJson);
      usedPath = "videoPromptJson";
      fallbackReason = "no structuredSequence";
    } else if (req.prompt) {
      console.info("[generate-video] Using prompt_legacy path (fallback)", { elapsedMs: Date.now() - tServerStart, promptLen: req.prompt.length });
      finalPromptForProvider = req.prompt;
      usedPath = "prompt_legacy";
      fallbackReason = "no structuredSequence, no videoPromptJson";
    }

    if (!finalPromptForProvider) {
      console.info("[generate-video] No prompt provided, returning 400", { elapsedMs: Date.now() - tServerStart });
      return Response.json({ error: "structuredSequence, videoPromptJson, or prompt must be provided" }, { status: 400 });
    }

    // ── Tag cleanup & deduplication ──────────────────────────────────────────
    const preCleanupLen = finalPromptForProvider.length;
    finalPromptForProvider = stripInternalTags(finalPromptForProvider);
    finalPromptForProvider = deduplicatePromptClauses(finalPromptForProvider);
    // ── 한글/인용문 최종 제거 (VEO가 자막으로 렌더링하는 것 방지) ──────────
    finalPromptForProvider = stripTextForVeo(finalPromptForProvider);
    console.info("[generate-video] Prompt cleanup complete", { elapsedMs: Date.now() - tServerStart, preCleanupLen, postCleanupLen: finalPromptForProvider.length, charsRemoved: preCleanupLen - finalPromptForProvider.length });

    // ── strip 후 프롬프트 길이 검증 (빈 프롬프트로 VEO API 낭비 방지) ───────
    if (!finalPromptForProvider || finalPromptForProvider.trim().length < 20) {
      console.error("[generate-video] Prompt too short after sanitization:", finalPromptForProvider?.length, "chars");
      console.info("[generate-video] Returning 422 prompt_too_short", { elapsedMs: Date.now() - tServerStart, promptLength: finalPromptForProvider?.trim().length ?? 0, usedPath });
      return Response.json({
        error: "Prompt too short after sanitization — cannot generate video",
        promptLength: finalPromptForProvider?.trim().length ?? 0,
        usedPath,
      }, { status: 422 });
    }

    // ── Continuity Mode 주입 ─────────────────────────────────────────────────
    if (req.continuityMeta) {
      console.info("[generate-video] Injecting continuity meta", { elapsedMs: Date.now() - tServerStart, segmentIndex: req.continuityMeta.segmentIndex, totalSegments: req.continuityMeta.totalSegments, isLastSegment: req.continuityMeta.isLastSegment, hasCharacterLock: !!req.continuityMeta.characterLock, hasVisualLock: !!req.continuityMeta.visualLock, hasPrevEndState: !!req.continuityMeta.prevEndState });
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

    console.info("[generate-video] Source-of-truth resolution", {
      usedPath,
      hasStructuredSequence,
      fallbackReason: fallbackReason || "none",
      finalPromptLen: finalPromptForProvider.length,
      finalPromptPreview: finalPromptForProvider.slice(0, 120),
    });

    // ── API 키 검증 ──────────────────────────────────────────────────────────
    const hasKey = !!context.env.GEMINI_API_KEY || !!context.env.GEMINI_API_KEY_2;
    console.info("[generate-video] API key check", { elapsedMs: Date.now() - tServerStart, hasKey, hasKey1: !!context.env.GEMINI_API_KEY, hasKey2: !!context.env.GEMINI_API_KEY_2 });
    if (!hasKey) {
      console.info("[generate-video] Returning 400 no API key", { elapsedMs: Date.now() - tServerStart });
      return Response.json({ error: "GEMINI_API_KEY not configured. VEO requires a Gemini API key." }, { status: 400 });
    }

    // ── Cut & Mode 결정 ──────────────────────────────────────────────────────
    const cutNumberRaw = req.cutNumber != null ? Number(req.cutNumber) : null;
    const videoMode = (req.videoMode === "extend" && cutNumberRaw === 1)
      ? "generate"
      : (req.videoMode ?? "generate");

    if (req.videoMode === "extend" && cutNumberRaw === 1) {
      console.warn("[generate-video] CUT 1에 videoMode=extend 요청 → generate로 강제 전환");
      console.info("[generate-video] Forced videoMode override: extend -> generate for cut 1", { elapsedMs: Date.now() - tServerStart });
    }
    const sourceVideo = req.sourceVideo || req.previousVideoUri || "";

    console.info("[generate-video] Cut and mode resolved", { elapsedMs: Date.now() - tServerStart, cutNumberRaw, videoMode, sourceVideoPresent: !!sourceVideo });

    // ── 모델 선택 ────────────────────────────────────────────────────────────
    const modelUsed = resolveModelForWorkflow({
      workflow: req.workflowType,
      hasImage: !!req.firstFrameBase64,
      hasSourceVideo: !!sourceVideo,
    });
    console.info("[generate-video] Model resolved", { elapsedMs: Date.now() - tServerStart, modelUsed, videoMode, cutNumber: cutNumberRaw, sourceVideoPresent: !!sourceVideo, extendDowngraded: (req.videoMode === "extend" && !sourceVideo) });

    // ── VEO 멀티샷 타임스탬프 프롬프트 생성 (8초 강제) ───────────────────────
    const isFragmentedEdit = !!req.fragmentedEditContext?.isFragmented;
    const veoRendererInput: VeoPromptRendererInput = {
      prompt: finalPromptForProvider,
      negativePrompt: negativePrompt,
      multiShot: req.multiShot,
      styleAnchor: undefined,
      structureType: "FOUR",
      fragmentedEditMode: isFragmentedEdit,
    };
    const rendered = renderVeoPrompt(veoRendererInput);

    console.info("[generate-video] VEO multishot timestamp rendering complete", {
      elapsedMs: Date.now() - tServerStart,
      shotCount: rendered.shotCount,
      totalDuration: rendered.totalDurationSec,
      promptLen: rendered.timestampPrompt.length,
      promptPreview: rendered.timestampPrompt.slice(0, 200),
      cleanupLog: rendered.cleanupLog,
    });

    // ═══════════════════════════════════════════════════════════════════
    // separate_clips 모드: 서브샷마다 독립 VEO 요청
    // ═══════════════════════════════════════════════════════════════════
    if (req.separateClips && req.multiShot && req.multiShot.length >= 2) {
      console.info("[generate-video] SEPARATE_CLIPS mode activated", {
        elapsedMs: Date.now() - tServerStart,
        shotCount: req.multiShot.length,
      });

      const physicsNoAtmoSC = req.structuredSequence?.physicsRules && !req.structuredSequence.physicsRules.hasAtmosphere;
      const generateAudioSC = physicsNoAtmoSC ? false : (req.generateAudio !== false);
      const modelUsedSC = resolveModelForWorkflow({
        workflow: req.workflowType,
        hasImage: !!req.firstFrameBase64,
        hasSourceVideo: false,
      });

      // ── continuity prefix 빌드 (separate_clips에서도 적용) ──
      let continuityPrefix = "";
      if (req.continuityMeta) {
        const cm = req.continuityMeta;
        const cParts: string[] = [];
        if (cm.characterLock) cParts.push(`Maintain character: ${cm.characterLock}`);
        if (cm.visualLock) {
          const compactLock = extractCompactVisualLock(cm.visualLock);
          if (compactLock) cParts.push(`Consistent look: ${compactLock}`);
        }
        if (cParts.length > 0) continuityPrefix = cParts.join(". ") + ". ";
      }

      // 각 subshot을 병렬 VEO 요청으로 전송 (타임스탬프 프롬프트 미사용)
      // firstFrameBase64는 첫 번째 샷에만 전달 (image-to-video)
      const strippedFirst = req.firstFrameBase64 ? stripDataPrefix(req.firstFrameBase64) : "";
      const validFirstSC = strippedFirst.length > 100 ? strippedFirst : "";

      // 병렬 요청을 위한 task 배열 구성
      const shotTasks = req.multiShot.map((shot) => {
        const shotDuration = Math.max(2, Math.min(8, Math.round(parseFloat(shot.duration) || 2)));
        let shotPrompt = stripInternalTags(shot.prompt);
        shotPrompt = deduplicatePromptClauses(shotPrompt);
        shotPrompt = stripTextForVeo(shotPrompt);

        if (!shotPrompt || shotPrompt.trim().length < 10) {
          return { shot, shotDuration, shotPrompt: null, skip: `Shot ${shot.index} prompt too short after cleanup` };
        }

        if (continuityPrefix && shot.index === 1) {
          shotPrompt = continuityPrefix + shotPrompt;
        }
        if (!shotPrompt.includes("no text")) {
          shotPrompt = "no text, no watermark. " + shotPrompt;
        }

        return { shot, shotDuration, shotPrompt, skip: null };
      });

      // 병렬 VEO 요청 실행
      const results = await Promise.allSettled(
        shotTasks.map(async (task) => {
          if (task.skip) throw new Error(task.skip);

          console.info(`[generate-video] SEPARATE_CLIPS shot ${task.shot.index}/${req.multiShot!.length}`, {
            elapsedMs: Date.now() - tServerStart,
            role: task.shot.role || "develop",
            duration: task.shotDuration,
            promptLen: task.shotPrompt!.length,
          });

          const result = await veoGenerate(context.env, {
            prompt: task.shotPrompt!,
            model: modelUsedSC,
            durationSeconds: task.shotDuration,
            aspectRatio: toVeoAspectRatio(req.aspectRatio ?? "16:9"),
            resolution: "720p",
            personGeneration: (req.personGeneration as "allow_all" | "allow_adult" | "dont_allow") || "allow_all",
            generateAudio: generateAudioSC,
            // 첫 번째 샷에만 firstFrame 전달 (image-to-video)
            ...(task.shot.index === 1 && validFirstSC ? { imageBase64: validFirstSC, imageMimeType: "image/png" } : {}),
          });

          return {
            shotIndex: task.shot.index,
            role: task.shot.role || "develop",
            durationSec: task.shotDuration,
            operationName: result.operationName,
            prompt: task.shotPrompt!,
          };
        }),
      );

      // 결과 취합
      const clipOperations: Array<{
        shotIndex: number; role: string; durationSec: number; operationName: string; prompt: string;
      }> = [];
      const errors: Array<{ shotIndex: number; error: string }> = [];

      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          clipOperations.push(r.value);
        } else {
          errors.push({ shotIndex: shotTasks[i].shot.index, error: r.reason?.message || String(r.reason) });
        }
      });

      const serverTotalMs = Date.now() - tServerStart;
      console.info("[generate-video] SEPARATE_CLIPS complete", {
        serverTotalMs,
        successCount: clipOperations.length,
        errorCount: errors.length,
        totalShots: req.multiShot.length,
      });

      const primaryOpName = clipOperations[0]?.operationName || `separate_clips_${Date.now()}`;
      return Response.json({
        separateClips: true,
        taskId: primaryOpName,
        operationName: primaryOpName,
        engine: "veo",
        modelUsed: modelUsedSC,
        modeUsed: "generate",
        status: clipOperations.length > 0 ? "RUNNING" : "FAILED",
        clipOperations,
        errors: errors.length > 0 ? errors : undefined,
        assembly: {
          method: "hard_cut",
          totalShots: req.multiShot.length,
          successfulShots: clipOperations.length,
        },
        durationMeta: {
          requestedSecondsPerScene: 8,
          perShotDurations: clipOperations.map(c => ({ shotIndex: c.shotIndex, durationSec: c.durationSec })),
          warnings: errors.length > 0 ? [`${errors.length} shot(s) failed`] : [],
        },
      });
    }

    // ── Audio: physics override (무대기 환경은 강제 off) ─────────────────────
    const physicsNoAtmo = req.structuredSequence?.physicsRules && !req.structuredSequence.physicsRules.hasAtmosphere;
    const generateAudio = physicsNoAtmo ? false : (req.generateAudio !== false);
    console.info("[generate-video] Audio decision", { elapsedMs: Date.now() - tServerStart, generateAudio, physicsNoAtmo: !!physicsNoAtmo, requestedAudio: req.generateAudio });

    // ── base64 검증 ──────────────────────────────────────────────────────────
    const strippedFirst = req.firstFrameBase64 ? stripDataPrefix(req.firstFrameBase64) : "";
    const validFirst = strippedFirst.length > 100 ? strippedFirst : "";
    console.info("[generate-video] Image validation", { elapsedMs: Date.now() - tServerStart, hasFirstFrameInput: !!req.firstFrameBase64, strippedLength: strippedFirst.length, validFirstFrame: !!validFirst });

    // ═══════════════════════════════════════════════════════════════════
    // VEO API 호출
    // ═══════════════════════════════════════════════════════════════════

    let operationName: string;
    let modeUsed: "generate" | "extend";
    let sentDuration: number = 8;
    let extendDowngradedToGenerate = false;

    try {
      if (videoMode === "extend" && sourceVideo) {
        // ── VEO Extension (Cut 2+) ────────────────────────────────────
        // extendPromptJson이 있으면 구조화된 렌더링 사용 (directorStyleHint, behavioralShift 등 보존)
        let extendPromptText = req.extendPromptJson
          ? renderExtendPromptFromJson(req.extendPromptJson)
          : rendered.timestampPrompt;
        // extend 프롬프트에도 동일한 정화 파이프라인 적용 (내부 태그 제거, 중복 제거, VEO 텍스트 정리)
        extendPromptText = stripTextForVeo(stripInternalTags(deduplicatePromptClauses(extendPromptText)));
        // TEXT_FREE_DIRECTIVE — extend에서도 텍스트/자막 방지 강제 (JSON/timestamp 모두)
        if (!extendPromptText.includes("no text")) {
          extendPromptText = "no text, no watermark. " + extendPromptText;
        }
        console.info("[generate-video] VEO EXTEND mode selected", {
          elapsedMs: Date.now() - tServerStart,
          sourceVideoUri: sourceVideo.slice(0, 80),
          model: modelUsed,
          usedStructuredExtend: !!req.extendPromptJson,
        });
        console.info("[generate-video] Before VEO EXTEND API call", {
          elapsedMs: Date.now() - tServerStart,
          model: modelUsed,
          aspectRatio: toVeoAspectRatio(req.aspectRatio ?? "16:9"),
          generateAudio,
          extendPromptLen: (req.extendPromptJson ? renderExtendPromptFromJson(req.extendPromptJson) : rendered.timestampPrompt).length,
          sourceVideoUriPrefix: sourceVideo.slice(0, 80),
          personGeneration: req.personGeneration || "allow_all",
        });
        const tVeoStart = Date.now();
        const result = await veoExtend(context.env, {
          prompt: extendPromptText,
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
        console.info("[generate-video] VEO EXTEND API response received", { elapsedMs: Date.now() - tServerStart, veoCallMs: Date.now() - tVeoStart, operationName, durationSent: sentDuration, modeUsed });
      } else {
        // ── VEO Generate (Cut 1 또는 extend 불가 시) ─────────────────
        if (videoMode === "extend" && !sourceVideo) {
          console.warn("[VEO] extend 요청이지만 sourceVideo 없음 → generate로 fallback");
          console.info("[generate-video] Extend downgraded to generate (no sourceVideo)", { elapsedMs: Date.now() - tServerStart });
          extendDowngradedToGenerate = true;
        }

        // ── image-to-video 모드: 멀티샷 타임스탬프 제거 ──────────────
        // VEO image-to-video는 시작 이미지 기준 연속 영상 생성 → 타임스탬프 무시됨
        // 타임스탬프 brackets를 제거하고 첫 번째 샷 프롬프트만 사용
        let generatePrompt = rendered.timestampPrompt;
        if (validFirst) {
          // 타임스탬프 제거: "[00:00-00:02] ..." → 첫 번째 샷 내용만
          const firstShotMatch = generatePrompt.match(/\[00:00[^\]]*\]\s*(.+?)(?:\n\[|$)/s);
          if (firstShotMatch) {
            // 글로벌 앵커(첫 줄, 타임스탬프 아닌 줄) + 첫 번째 샷 프롬프트
            const nonTimestampLines = generatePrompt.split("\n").filter(l => !l.startsWith("["));
            const anchor = nonTimestampLines.filter(l => l.trim()).join(" ").trim();
            generatePrompt = anchor ? `${anchor} ${firstShotMatch[1].trim()}` : firstShotMatch[1].trim();
            console.info("[generate-video] image-to-video: stripped multishot timestamps, using first shot only", {
              originalLen: rendered.timestampPrompt.length,
              strippedLen: generatePrompt.length,
            });
          } else {
            console.warn("[generate-video] image-to-video: timestamp regex match failed, proceeding with full multishot timestamps");
          }
        }

        // TEXT_FREE_DIRECTIVE — generate 경로에서도 텍스트/워터마크 방지
        if (!generatePrompt.includes("no text")) {
          generatePrompt = "no text, no watermark. " + generatePrompt;
        }

        console.info("[generate-video] VEO GENERATE mode selected", {
          elapsedMs: Date.now() - tServerStart,
          hasImage: !!validFirst,
          model: modelUsed,
          duration: 8,
          imageToVideoSimplified: !!validFirst,
        });
        console.info("[generate-video] Before VEO GENERATE API call", {
          elapsedMs: Date.now() - tServerStart,
          model: modelUsed,
          durationSeconds: 8,
          aspectRatio: toVeoAspectRatio(req.aspectRatio ?? "16:9"),
          generateAudio,
          hasImage: !!validFirst,
          promptLen: generatePrompt.length,
          personGeneration: req.personGeneration || "allow_all",
        });
        const tVeoStart = Date.now();
        const result = await veoGenerate(context.env, {
          prompt: generatePrompt,
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
        console.info("[generate-video] VEO GENERATE API response received", { elapsedMs: Date.now() - tServerStart, veoCallMs: Date.now() - tVeoStart, operationName, durationSent: sentDuration, modeUsed });
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
        console.info("[generate-video] Returning VeoApiError response", { elapsedMs: Date.now() - tServerStart, status, code: veoErr.code, retryable: veoErr.retryable, httpStatus: veoErr.httpStatus, cutNumber: req.cutNumber });
        return Response.json({
          error: veoErr.message,
          code: veoErr.code,
          retryable: veoErr.retryable,
        }, { status });
      }

      const msg = veoErr instanceof Error ? veoErr.message : String(veoErr);
      console.error("[VEO] Unexpected error", { msg, cutNumber: req.cutNumber });
      console.info("[generate-video] Returning unexpected VEO error response", { elapsedMs: Date.now() - tServerStart, status: 502, errorMessage: msg, cutNumber: req.cutNumber });
      return Response.json({ error: msg }, { status: 502 });
    }

    const serverTotalMs = Date.now() - tServerStart;
    console.info("[generate-video] Final response ready", {
      serverTotalMs,
      promptChars: rendered.timestampPrompt.length,
      mode: modeUsed,
      cutNumber: cutNumberRaw,
      engine: "veo",
      modelUsed,
      durationSent: sentDuration,
      operationName,
      extendDowngradedToGenerate,
      usedPath,
      status: "RUNNING",
    });

    return Response.json({
      operationName,
      taskId: operationName,
      engine: "veo",
      modeUsed,
      modelUsed,
      sourceVideo: sourceVideo || undefined,
      status: "RUNNING",
      // extend→generate downgrade를 클라이언트에 명시 (API 낭비 방지 — 클라이언트가 sourceVideo 수정 가능)
      ...(extendDowngradedToGenerate ? { warning: "extend requested but sourceVideo missing — fell back to generate" } : {}),
      durationMeta: {
        requestedSecondsPerScene: 8,
        normalizedSecondsPerScene: 8,
        sentSecondsPerScene: sentDuration,
        warnings: extendDowngradedToGenerate ? ["extend_downgraded_to_generate"] : [],
      },
    });
  } catch (error) {
    const outerElapsed = Date.now() - tServerStart;
    console.error("[generate-video] 처리 오류:", error);
    console.info("[generate-video] Returning outer catch error response", { elapsedMs: outerElapsed, status: 500, errorMessage: error instanceof Error ? error.message : String(error), errorName: error instanceof Error ? error.name : "unknown" });
    return Response.json(
      { error: `Failed to start video generation: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
};
