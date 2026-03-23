/**
 * sequence-assembler.ts — JSON-first 프롬프트 조립 엔진
 *
 * 핵심 원칙:
 * 1. 모든 프롬프트 데이터를 JSON(SingleShotDocument)으로 관리
 * 2. String 조합은 최종 provider 전송 직전에만 수행 (serializeForProvider)
 * 3. 검증 → 정제 → 충돌 해결 → 직렬화 순서 엄격 준수
 * 4. Provider별 capability에 따라 직렬화 전략 분기
 */

import type { Cut, VideoGenerationConfig, StructuredSequenceDocument, PhysicsRules, SequenceDensityScore, TemporalBeat } from "@/types";
import { collectFailureModeNegatives, getGenreTemplate } from "@/lib/prompt-architecture";
import { getStyleById, getStyleByLegacyMode, getStylePersona, getStyleRenderingRules } from "@/data/style-catalog";
import { videoPromptJsonToShotPlan } from "@/lib/sequence-plan";
import { runSanitizePipeline, stripMetaLabels } from "@/lib/prompt-sanitizer";
import { validateFinalProviderPayload, autoFixPayload } from "@/lib/final-payload-validator";
import { normalizeSequence } from "@/lib/sequence-normalizer";
import { buildFinalProviderPayload } from "@/lib/final-payload-builder";
import { detectPhysicsRules, enforcePhysicsNegatives, checkPhysicsConsistency, rewriteForPhysics, sanitizeAllFieldsForPhysics, sanitizeLunarLighting, sanitizeLunarCamera } from "@/lib/physics-rules";
import { detectSceneContext, getPlaceIdentityCandidates, getSituationEvidenceCandidates, getNaturalMotionCandidates } from "@/lib/place-situation-anchors";
import { enforceMinimumShotCount, validateSequenceDensity, type ShotDescriptor, type ShotBeatHint } from "@/lib/shot-splitting";
import { planShotRoles } from "@/lib/multi-shot-planner";
import type { MultiShotPrompt, ShotRole } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// 1. Provider Capability Abstraction
// ═══════════════════════════════════════════════════════════════════

export interface ProviderCapability {
  id: "veo";
  acceptsStructuredPayload: boolean;
  supportsStructuredSequence: boolean;
  supportsNegativePrompt: boolean;
  supportsShotMetadata: boolean;
  maxPromptWords: number;
  maxPromptChars: number;
  defaultAudio: boolean;
}

/**
 * 2-API 아키텍처: VEO = 유일한 생성 provider.
 * VEO만 지원. Gemini는 QA provider (여기서 관리하지 않음).
 */
export const PROVIDER_CAPABILITIES: Record<string, ProviderCapability> = {
  veo: {
    id: "veo",
    acceptsStructuredPayload: false, // string-only → 전송 직전 serialize
    supportsStructuredSequence: false, // string-only → serializeSequenceForProvider() 호출
    supportsNegativePrompt: true,
    supportsShotMetadata: false,
    maxPromptWords: 300,
    maxPromptChars: 2500,
    defaultAudio: false,
  },
};

// ═══════════════════════════════════════════════════════════════════
// 2. SingleShotDocument — 개별 cut의 JSON source of truth
// ═══════════════════════════════════════════════════════════════════

export interface TimingBeat {
  startSec: number;
  endSec: number;
  description: string;
}

export interface SingleShotDocument {
  shotId: string;
  cutNumber: number;

  global: {
    style: string;
    styleId: string;
    medium?: string;
    aspectRatio: string;
    totalDurationSec: number;
  };

  continuity: {
    primarySubject: string;
    characterRef?: string;
    environment: string;
    lightingDirection: string;
    /** ambient sound/atmosphere description */
    ambient: string;
    /** dominant color / mood anchor */
    colorAnchor: string;
    mustPersist: string[];
  };

  camera: {
    framing: string;
    angle: string;
    motion: string;
    motionMotivation?: string;
  };

  scene: {
    shotCategory?: string;
    locationCue?: string;
    situationCue?: string;
    emotionalAnchor?: string;
    environment: string;
    moodLighting: string;
  };

  subject: {
    primary: string;
    action: string;
    bodySignal?: string;
    blocking?: string;
  };

  timing: {
    durationSec: number;
    beats: TimingBeat[];
  };

  transition?: {
    fromPrevious: string;
  };

  reinforcement: {
    styleSuffix: string;
    mediumLock?: string;
  };

  negatives: {
    universal: string[];
    style: string[];
    sceneSpecific: string[];
    failureMode: string[];
    user: string[];
  };

  audio: {
    hint: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. buildShotDocument — Cut + Config → SingleShotDocument
// ═══════════════════════════════════════════════════════════════════

export interface BuildShotDocumentInput {
  cut: Cut;
  config: VideoGenerationConfig;
  prevCut?: Cut;
}

function parseTimingBeats(timingBeat?: string, durationSec?: number): TimingBeat[] {
  durationSec = durationSec && durationSec > 0 ? durationSec : 8;
  if (!timingBeat) {
    const mid1 = Math.floor(durationSec * 0.25);
    const mid2 = Math.floor(durationSec * 0.625);
    return [
      { startSec: 0, endSec: mid1, description: "establishing" },
      { startSec: mid1, endSec: mid2, description: "development" },
      { startSec: mid2, endSec: durationSec, description: "climax" },
    ];
  }

  const beats: TimingBeat[] = [];
  const regex = /(\d+)s?\s*[-–]\s*(\d+)s?\s*:\s*([^.]+)/g;
  let match;
  while ((match = regex.exec(timingBeat)) !== null) {
    beats.push({
      startSec: parseInt(match[1]),
      endSec: parseInt(match[2]),
      description: match[3].trim(),
    });
  }

  beats.sort((a, b) => a.startSec - b.startSec);

  // Clamp beats to shot duration — Gemini이 durationSec보다 큰 beat을 생성할 수 있음
  for (const b of beats) {
    if (b.endSec > durationSec) b.endSec = durationSec;
    if (b.startSec >= durationSec) b.startSec = Math.max(0, durationSec - 1);
  }

  // startSec >= endSec인 역전된 비트 제거
  const validBeats = beats.filter(b => b.startSec < b.endSec);
  if (validBeats.length > 0 && validBeats.length < beats.length) {
    beats.length = 0;
    beats.push(...validBeats);
  }

  if (beats.length === 0) {
    const mid1 = Math.floor(durationSec * 0.25);
    const mid2 = Math.floor(durationSec * 0.625);
    return [
      { startSec: 0, endSec: mid1, description: "establishing" },
      { startSec: mid1, endSec: mid2, description: "development" },
      { startSec: mid2, endSec: durationSec, description: "climax" },
    ];
  }

  return beats;
}

// ── Environment/Landscape 상수 ──

/** Environment 씬에서 허용되는 연속 카메라 모션 (cut 기반 모션 불가) */
const ENVIRONMENT_CONTINUOUS_MOTIONS = [
  "slow push-in", "smooth pan", "gentle drift", "slow pull-back",
  "slow crane up", "slow crane down", "slow orbit", "floating drift",
  "subtle dolly", "slow sweep", "gradual tilt up", "gradual tilt down",
  "slow drone", "drone pull-back", "drone push-in",
];

/** Environment 씬에서 금지되는 cut 기반 카메라 지시 */
const ENVIRONMENT_BANNED_MOTIONS = /\b(whip\s*pan|quick\s*cut|jump\s*cut|snap\s*zoom|rack\s*focus|crash\s*zoom|smash\s*cut|match\s*cut)\b/i;

/** Environment positive 키워드 (반드시 포함) */
const ENVIRONMENT_POSITIVE_KEYWORDS = [
  "photorealistic", "cinematic", "live-action",
  "subject-focused composition",
];

/** Environment negative 키워드 (반드시 배제) */
const ENVIRONMENT_NEGATIVE_KEYWORDS = [
  "text overlay", "watermark", "logo", "subtitle", "blurry", "low quality",
  "UI element", "text label", "caption", "HUD",
];

// ═══════════════════════════════════════════════════════════════════
// 2-A. 공통 Scene-Type 규칙 (Shared Helpers)
//
// 충돌 검사 / negative sanitization / scene-type rules는
// 시스템 전반 공통이어야 한다. 장면별로 바뀌는 것은 shot content 뿐.
// ═══════════════════════════════════════════════════════════════════

/** Environment 씬인지 판별 */
export function isEnvironmentScene(shotCategory?: string): boolean {
  return shotCategory === "environment";
}

/** Environment 연속 모션 유효성 검사 */
export function isEnvironmentContinuousMotion(motion: string): boolean {
  return ENVIRONMENT_CONTINUOUS_MOTIONS.some(m => motion.toLowerCase().includes(m));
}

/** Environment banned motion regex (exported for sequence-plan.ts) */
export const ENVIRONMENT_BANNED_MOTIONS_RE = ENVIRONMENT_BANNED_MOTIONS;

/**
 * Environment 카메라 규칙 강제 적용.
 * - WS framing 강제 (close framing 거부)
 * - cut 기반 모션 제거, 연속 모션만 허용
 * - "/" compound motion 정규화
 * - angle은 명시적 값 존중, 없으면 overhead 기본
 */
export function enforceEnvironmentCamera(input: {
  framing: string;
  angle: string;
  motion: string;
  explicitAngle?: string;
}): { framing: string; angle: string; motion: string; fixes: string[] } {
  const fixes: string[] = [];
  let { framing, angle, motion } = input;

  // Compound motion "/" → ", "
  if (motion.includes("/")) {
    motion = motion.split("/").map(s => s.trim()).filter(Boolean).join(", ");
    fixes.push(`Normalized compound motion "/" → ", "`);
  }

  // Remove cut-based motions
  const shotBoundaryTerms = /\b(cut\s+to|dissolve\s+to|fade\s+to|wipe\s+to|jump\s+cut)\b/gi;
  const beforeBoundary = motion;
  motion = motion.replace(ENVIRONMENT_BANNED_MOTIONS, "").replace(shotBoundaryTerms, "").replace(/\s{2,}/g, " ").trim();
  if (motion !== beforeBoundary) {
    fixes.push(`Removed cut-based motion terms`);
  }

  // Validate continuous motion
  if (motion && motion !== "static" && !isEnvironmentContinuousMotion(motion)) {
    fixes.push(`Replaced non-continuous motion "${motion}" → "slow push-in"`);
    motion = "slow push-in";
  }
  if (!motion) {
    motion = "slow push-in";
    fixes.push(`Empty motion after cleanup → default slow push-in`);
  }

  // Force wide framing
  const closeFramings = ["ECU", "CU", "MCU"];
  if (closeFramings.includes(framing.toUpperCase())) {
    fixes.push(`Replaced close framing "${framing}" → "WS"`);
    framing = "WS";
  }

  // Angle: respect explicit, default to overhead
  if (input.explicitAngle) {
    angle = input.explicitAngle;
  }

  return { framing, angle, motion, fixes };
}

/**
 * Environment atmosphere 보강.
 * moodLighting에 shadow/haze가 없으면 추가.
 */
export function enrichAtmosphereForScene(
  shotCategory: string | undefined,
  moodLighting: string | undefined,
): string[] {
  if (shotCategory !== "environment") return [];
  const parts: string[] = [];
  if (!moodLighting?.toLowerCase().includes("shadow")) {
    parts.push("gentle shadows over terrain");
  }
  if (!moodLighting?.toLowerCase().includes("haze")) {
    parts.push("subtle ambient haze emphasizing depth and elevation");
  }
  return parts;
}

/**
 * Positive/Negative 충돌 제거.
 * positive style 텍스트에 포함된 negative 키워드를 negative 목록에서 제거.
 */
export function sanitizeNegativesAgainstPositive(
  negatives: string[],
  positiveText: string,
): { cleaned: string[]; removed: string[] } {
  const posLower = positiveText.toLowerCase();
  const removed: string[] = [];
  const cleaned = negatives.filter(neg => {
    if (neg.length > 4 && posLower.includes(neg.toLowerCase())) {
      removed.push(neg);
      return false;
    }
    return true;
  });
  return { cleaned, removed };
}

/**
 * Environment positive/negative 충돌 제거.
 * ENVIRONMENT_POSITIVE_KEYWORDS가 positive style과 negative 양쪽에 있으면 negative에서 제거.
 */
export function sanitizeEnvironmentNegatives(
  negatives: string[],
  positiveText: string,
): { cleaned: string[]; removed: string[] } {
  const posLower = positiveText.toLowerCase();
  const removed: string[] = [];
  const cleaned = negatives.filter(neg => {
    const lc = neg.toLowerCase();
    if (ENVIRONMENT_POSITIVE_KEYWORDS.some(kw => kw.toLowerCase() === lc) && posLower.includes(lc)) {
      removed.push(neg);
      return false;
    }
    return true;
  });
  return { cleaned, removed };
}

/**
 * Environment negative 키워드 강화.
 * 기존 목록에 environment 전용 negative가 없으면 추가.
 */
export function enrichEnvironmentNegatives(negatives: string[]): string[] {
  const result = [...negatives];
  for (const neg of ENVIRONMENT_NEGATIVE_KEYWORDS) {
    if (!result.includes(neg)) result.push(neg);
  }
  return result;
}

/**
 * Environment positive 키워드 강화.
 * globalStyle에 environment positive 키워드가 없으면 추가.
 */
export function enrichEnvironmentPositives(globalStyle: string): string {
  let result = globalStyle;
  for (const kw of ENVIRONMENT_POSITIVE_KEYWORDS) {
    if (!result.toLowerCase().includes(kw)) {
      result = `${result} ${kw}`.trim();
    }
  }
  return result;
}

export function buildShotDocument(input: BuildShotDocumentInput): SingleShotDocument {
  const { cut, config, prevCut } = input;
  const json = cut.videoPromptJson;
  // Duration source of truth: cut.durationSec (per-cut, from API) > config.durationSeconds (global)
  // rhythm distribution 등으로 컷마다 다른 duration이 설정될 수 있으므로 cut 단위 값을 우선
  const dur = (cut.durationSec && cut.durationSec > 0)
    ? cut.durationSec
    : (config.durationSeconds && config.durationSeconds > 0 ? config.durationSeconds : 8);

  const styleEntry = getStyleById(config.animationMode || "") ?? getStyleByLegacyMode(config.animationMode || "");
  const styleId = styleEntry?.id || config.animationMode || "live-action";
  const styleLabel = styleEntry?.positivePrompt || config.animationMode || "";

  const isEnv = isEnvironmentScene(cut.shotCategory);

  // Style rendering rules — camera/motion defaults for shots without explicit direction
  const styleRenderRules = styleEntry ? getStyleRenderingRules(styleEntry.id) : undefined;

  // Camera: environment 씬이면 공통 규칙 적용
  // non-env 씬에서 명시적 카메라 없으면 스타일 렌더링 규칙의 기본값 적용
  const defaultMotion = styleRenderRules?.cameraDefaults
    ? styleRenderRules.cameraDefaults.split(".")[0].trim().slice(0, 60)
    : "slow push-in";
  let framing = isEnv ? "WS" : (json?.shotSize || "MS");
  let angle = isEnv ? (json?.cameraAngle || "overhead") : (json?.cameraAngle || "eye-level");
  let motion = json?.cameraMovement || cut.cameraDirection || defaultMotion;

  if (isEnv) {
    const cam = enforceEnvironmentCamera({
      framing, angle, motion, explicitAngle: json?.cameraAngle || undefined,
    });
    framing = cam.framing;
    angle = cam.angle;
    motion = cam.motion;
  }

  // subject.primary는 가시적 주체 묘사 (→ 체인의 첫 번째 비트만 사용).
  // action은 별도 actionBeat 필드에서 추출하여 중복 방지.
  const rawSubjectAction = json?.subjectAction || "";
  const primarySubject = (() => {
    // → 체인이면 첫 번째 비트만 추출 (나머지는 timing beats에서 처리)
    if (rawSubjectAction.includes("→")) {
      return rawSubjectAction.split("→")[0].trim();
    }
    return rawSubjectAction;
  })()
    || (cut.characterConsistency ? cut.characterConsistency.replace(/^캐릭터 고정:\s*/, "").replace(/\.\s*모든 장면.*$/, "").trim() : "")
    || "";
  // actionBeat = 실제 행동 묘사 (subjectAction과 별개)
  const actionBeat = json?.actionBeat || "";
  const characterRef = json?.characterRef || cut.characterConsistency || undefined;

  const beats = parseTimingBeats(json?.timingBeat, dur);

  const universalNeg = ["text overlay", "watermark", "subtitle", "logo", "blurry", "low quality", "distorted"];

  // Style catalog negatives — core anti-collapse constraints
  const styleNeg: string[] = [];
  if (styleEntry?.negativePrompt) {
    const raw = styleEntry.negativePrompt
      .replace(/^Avoid:\s*/i, "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    styleNeg.push(...raw);
  }

  // Style persona anti-drift: failureCriteria → failureMode negatives
  // "만화적 외곽선, 평면적 색감" 같은 실패 기준을 네거티브로 주입
  const persona = styleEntry ? getStylePersona(styleEntry.id) : undefined;
  const personaFailNeg: string[] = [];
  if (persona?.failureCriteria) {
    const failTokens = persona.failureCriteria
      .replace(/[이가]?\s*보이면\s*실패\.?/g, "")
      .split(",")
      .map(s => s.trim())
      .filter(s => s.length > 2 && s.length < 60);
    personaFailNeg.push(...failTokens);
  }

  const sceneNeg = getGenreTemplate(cut.shotCategory)?.commonNegatives || [];
  const failureNeg = [
    ...collectFailureModeNegatives(cut.videoPrompt || cut.sceneDescription),
    ...personaFailNeg,
  ];
  const userNeg = config.negativePrompt
    ? config.negativePrompt.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  // Environment: 추가 negative 강화 (공통 헬퍼)
  const finalUniversalNeg = isEnv ? enrichEnvironmentNegatives(universalNeg) : universalNeg;

  // continuity 추적: sceneDescription은 기획 라벨일 수 있으므로 사용하지 않음
  const continuitySubject = prevCut?.videoPromptJson?.subjectAction || primarySubject;
  const continuityCharRef = prevCut?.characterConsistency || characterRef;
  const continuityEnv = prevCut?.videoPromptJson?.locationCue || json?.locationCue || "";
  const continuityLight = prevCut?.moodLighting || json?.moodLighting || cut.moodLighting || "";

  const styleSuffix = json?.styleSuffix || styleLabel.split(". ").slice(0, 1).join(". ");

  let mediumLock: string | undefined;
  if (cut.shotCategory === "map-graphic") {
    mediumLock = "physical map surface — not a landscape, not a 3D render, not a CGI scene";
  }

  // globalStyle = positivePrompt + persona aesthetic + rendering character rules
  // 스타일 정체성을 프롬프트에 강하게 주입
  const styleBlockParts = [styleLabel];
  if (persona?.aesthetic) {
    // 한국어 문자가 포함된 경우 제거 — VEO 프롬프트는 영어 전용이어야 함
    const aestheticEnOnly = persona.aesthetic
      .replace(/[\uAC00-\uD7A3\u3131-\u318E\u3200-\u321E\u3260-\u327E]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 120);
    if (aestheticEnOnly.length > 5) {
      styleBlockParts.push(aestheticEnOnly);
    }
  }
  if (styleRenderRules?.characterRules) {
    styleBlockParts.push(styleRenderRules.characterRules.split(".").slice(0, 2).join("."));
  }
  const rawGlobalStyle = styleBlockParts.filter(Boolean).join(". ");
  // Environment: globalStyle에 positive 키워드 보장 (공통 헬퍼)
  const globalStyle = isEnv ? enrichEnvironmentPositives(rawGlobalStyle) : rawGlobalStyle;

  const result: SingleShotDocument = {
    shotId: `shot_${cut.cutNumber}`,
    cutNumber: cut.cutNumber,

    global: {
      style: globalStyle,
      styleId,
      medium: mediumLock ? "physical map surface" : undefined,
      aspectRatio: config.aspectRatio,
      totalDurationSec: dur,
    },

    continuity: {
      primarySubject: continuitySubject,
      characterRef: continuityCharRef,
      environment: continuityEnv,
      lightingDirection: continuityLight,
      ambient: "",
      colorAnchor: json?.moodLighting?.match(/\b(golden|warm|cold|blue|amber|neutral|desaturated|saturated|muted|vivid|sepia)\b/i)?.[0] || "neutral",
      mustPersist: [continuityCharRef, continuityEnv].filter(Boolean) as string[],
    },

    camera: {
      framing,
      angle,
      motion,
      motionMotivation: json?.cameraMovement?.match(/\(([^)]+)\)/)?.[1],
    },

    scene: {
      shotCategory: cut.shotCategory,
      locationCue: json?.locationCue,
      situationCue: json?.situationCue,
      emotionalAnchor: json?.emotionalAnchor,
      // environment는 장소/공간 묘사. moodLighting과 혼동하지 않는다.
      // 우선: locationCue → sceneDescription(첫 80자) → 빈 문자열
      environment: json?.locationCue || (cut.sceneDescription || "").slice(0, 80) || "",
      moodLighting: json?.moodLighting || cut.moodLighting || "",
    },

    subject: {
      primary: primarySubject,
      action: actionBeat || "",  // actionBeat 사용 (subjectAction과 중복 방지)
      bodySignal: json?.bodySignal,
      blocking: json?.subjectBlocking,
    },

    timing: {
      durationSec: dur,
      beats,
    },

    transition: cut.transitionHint
      ? { fromPrevious: json?.transitionFromPrev || cut.transitionHint }
      : json?.transitionFromPrev
        ? { fromPrevious: json.transitionFromPrev }
        : undefined,

    reinforcement: {
      styleSuffix,
      mediumLock,
    },

    negatives: {
      universal: finalUniversalNeg,
      style: [...new Set(styleNeg)],
      sceneSpecific: [...new Set(sceneNeg)],
      failureMode: [...new Set(failureNeg)],
      user: userNeg,
    },

    audio: {
      hint: "Diegetic ambient sound",
    },
  };

  // ── Meta-label guard: 기획 라벨이 시각 필드에 남아 있으면 제거 ──
  const fieldsToSanitize = [
    { key: "subject.primary", get: () => result.subject.primary, set: (v: string) => { result.subject.primary = v; } },
    { key: "subject.action", get: () => result.subject.action, set: (v: string) => { result.subject.action = v; } },
    { key: "scene.environment", get: () => result.scene.environment, set: (v: string) => { result.scene.environment = v; } },
    { key: "scene.moodLighting", get: () => result.scene.moodLighting, set: (v: string) => { result.scene.moodLighting = v; } },
  ] as const;
  for (const f of fieldsToSanitize) {
    const val = f.get();
    if (val) {
      const sanitized = stripMetaLabels(val);
      if (sanitized.removed.length > 0) {
        f.set(sanitized.text);
      }
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// 4. validateShotDocument — 10개 검증 규칙
// ═══════════════════════════════════════════════════════════════════

export interface ValidationIssue {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  field?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

// ═══════════════════════════════════════════════════════════════════
// 3b. Density Score Computation
// ═══════════════════════════════════════════════════════════════════

/**
 * Sequence 밀도 점수 계산.
 * valid=true 조건: total >= 60
 *
 * grep: computeDensityScore
 */
export function computeDensityScore(input: {
  placeAnchors: string[];
  evidence: string[];
  temporalBeats: TemporalBeat[];
  cameraPlan: { baseFraming: string; angle: string; motion: string };
  physicsRules: PhysicsRules;
  motionItems: string[];
  lightLog: string[];
  continuity: { lighting: string; mustPersist: string[] };
}): SequenceDensityScore {
  const breakdown = {
    hasPlaceAnchors: input.placeAnchors.length >= 1,
    hasEvidence: input.evidence.length >= 1,
    hasTemporalBeats: input.temporalBeats.length >= 2,
    hasCameraPlan: !!(input.cameraPlan.baseFraming && input.cameraPlan.motion),
    hasPhysicsRules: input.physicsRules.environmentType !== "unknown",
    hasNaturalMotion: input.motionItems.length >= 1,
    hasExplicitLight: input.lightLog.length >= 1,
    hasContinuity: !!(input.continuity.lighting && input.continuity.lighting.length > 3),
  };

  const weights: Record<keyof typeof breakdown, number> = {
    hasPlaceAnchors: 15,
    hasEvidence: 15,
    hasTemporalBeats: 15,
    hasCameraPlan: 10,
    hasPhysicsRules: 10,
    hasNaturalMotion: 10,
    hasExplicitLight: 10,
    hasContinuity: 15,
  };

  let total = 0;
  const missing: string[] = [];
  for (const [key, present] of Object.entries(breakdown) as [keyof typeof breakdown, boolean][]) {
    if (present) {
      total += weights[key];
    } else {
      missing.push(key);
    }
  }

  return { total, breakdown, missing };
}

export function validateShotDocument(doc: SingleShotDocument): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Rule 1: Beat ordering
  for (let i = 1; i < doc.timing.beats.length; i++) {
    if (doc.timing.beats[i].startSec < doc.timing.beats[i - 1].endSec) {
      issues.push({
        rule: "beat_order",
        severity: "error",
        message: `Beat ${i} (${doc.timing.beats[i].startSec}s) starts before beat ${i - 1} ends (${doc.timing.beats[i - 1].endSec}s)`,
        field: "timing.beats",
      });
    }
  }

  // Rule 2: Beat overlap
  for (let i = 1; i < doc.timing.beats.length; i++) {
    if (doc.timing.beats[i].startSec < doc.timing.beats[i - 1].endSec - 0.01) {
      issues.push({
        rule: "beat_overlap",
        severity: "error",
        message: `Beats ${i - 1} and ${i} overlap`,
        field: "timing.beats",
      });
    }
  }

  // Rule 3: Duplicate beats
  const beatDescs = doc.timing.beats.map(b => b.description.toLowerCase().trim());
  if (new Set(beatDescs).size < beatDescs.length) {
    issues.push({
      rule: "beat_duplicate",
      severity: "warning",
      message: "Duplicate beat descriptions detected",
      field: "timing.beats",
    });
  }

  // Rule 3b: Beat exceeds shot duration
  for (let i = 0; i < doc.timing.beats.length; i++) {
    const b = doc.timing.beats[i];
    if (b.endSec > doc.global.totalDurationSec + 0.5) {
      issues.push({
        rule: "beat_exceeds_duration",
        severity: "error",
        message: `Beat ${i} ends at ${b.endSec}s but shot duration is ${doc.global.totalDurationSec}s`,
        field: "timing.beats",
      });
    }
  }

  // Rule 4: Missing subject
  if (!doc.subject.primary || doc.subject.primary.trim().length < 3) {
    issues.push({
      rule: "subject_missing",
      severity: "error",
      message: "Primary subject missing or too short",
      field: "subject.primary",
    });
  }

  // Rule 5: Missing shotCategory
  if (!doc.scene.shotCategory) {
    issues.push({
      rule: "shot_category_missing",
      severity: "warning",
      message: "shotCategory not specified — genre protection unavailable",
      field: "scene.shotCategory",
    });
  }

  // Rule 6: Camera conflicts — framing vs motion text
  const motionLower = doc.camera.motion.toLowerCase();
  const framingConflicts: Record<string, RegExp> = {
    ws: /\bclose[\s-]?up\b/i,
    ls: /\bclose[\s-]?up\b/i,
    cu: /\bwide\s+(shot|establishing)\b/i,
    ecu: /\bwide\s+(shot|establishing)\b/i,
  };
  const fKey = doc.camera.framing.toLowerCase();
  if (framingConflicts[fKey]?.test(motionLower)) {
    issues.push({
      rule: "camera_conflict",
      severity: "error",
      message: `Camera framing "${doc.camera.framing}" conflicts with motion "${doc.camera.motion}"`,
      field: "camera",
    });
  }

  // Rule 7: Positive/negative conflict
  const allNeg = [
    ...doc.negatives.universal,
    ...(doc.negatives.style || []),
    ...doc.negatives.sceneSpecific,
    ...doc.negatives.failureMode,
    ...doc.negatives.user,
  ].map(n => n.toLowerCase());

  const positiveText = `${doc.global.style} ${doc.reinforcement.styleSuffix}`.toLowerCase();
  for (const neg of allNeg) {
    if (neg.length > 4 && positiveText.includes(neg)) {
      issues.push({
        rule: "pos_neg_conflict",
        severity: "error",
        message: `Positive style contains "${neg}" which is also in negatives`,
        field: "negatives",
      });
    }
  }

  // Rule 8: Cinematic realism + 3D/CGI
  const fullText = `${doc.subject.primary} ${doc.scene.environment} ${doc.camera.motion}`;
  const isCinematicRealism = /cinematic\s*realism/i.test(doc.global.style + " " + doc.global.styleId);
  if (isCinematicRealism) {
    const cgiTerms = fullText.match(/\b(3D\s+render|CGI|glossy\s+render|game[\s-]?map|miniature\s+diorama|plastic\s+terrain)\b/gi);
    if (cgiTerms) {
      issues.push({
        rule: "cinematic_realism_3d",
        severity: "error",
        message: `Cinematic realism but found 3D/CGI terms: ${cgiTerms.join(", ")}`,
        field: "subject",
      });
    }
  }

  // Rule 9: Broken fragments
  const allText = `${doc.subject.primary} ${doc.subject.action} ${doc.scene.moodLighting}`;
  if (/\bNo\s*\.\s/i.test(allText) || /\.\s*\.\s*\./.test(allText)) {
    issues.push({
      rule: "broken_fragment",
      severity: "warning",
      message: 'Broken text fragments detected ("No ." or "...")',
    });
  }

  // Rule 10: Medium lock for map scenes
  if (doc.scene.shotCategory === "map-graphic" && !doc.reinforcement.mediumLock) {
    issues.push({
      rule: "medium_lock_missing",
      severity: "warning",
      message: "Map scene without medium lock — risk of drift",
      field: "reinforcement.mediumLock",
    });
  }

  // Rule 11: Environment scene — cut-based camera banned
  if (doc.scene.shotCategory === "environment") {
    if (ENVIRONMENT_BANNED_MOTIONS.test(doc.camera.motion)) {
      issues.push({
        rule: "environment_cut_motion",
        severity: "error",
        message: `Environment scene uses cut-based motion "${doc.camera.motion}" — must use continuous motion`,
        field: "camera.motion",
      });
    }
  }

  // Rule 12: Positive/negative conflict check (모든 씬 타입에 적용)
  {
    const posText = doc.global.style.toLowerCase();
    const allNegLower = [
      ...doc.negatives.universal,
      ...(doc.negatives.style || []),
      ...doc.negatives.sceneSpecific,
    ].map(n => n.toLowerCase());
    for (const posKw of ENVIRONMENT_POSITIVE_KEYWORDS) {
      if (allNegLower.includes(posKw) && posText.includes(posKw)) {
        issues.push({
          rule: "environment_pos_neg_overlap",
          severity: "error",
          message: `"${posKw}" in both positive style and negatives`,
          field: "negatives",
        });
      }
    }
  }

  return {
    valid: issues.filter(i => i.severity === "error").length === 0,
    issues,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 5. sanitizeShotDocument — 자동 수정
// ═══════════════════════════════════════════════════════════════════

export function sanitizeShotDocument(doc: SingleShotDocument): {
  doc: SingleShotDocument;
  fixes: string[];
} {
  const fixes: string[] = [];
  const result = structuredClone(doc);

  // Fix 1: Sort beats by startSec
  const sorted = [...result.timing.beats].sort((a, b) => a.startSec - b.startSec);
  const wasUnsorted = result.timing.beats.some((b, i) => b.startSec !== sorted[i].startSec);
  if (wasUnsorted) {
    result.timing.beats = sorted;
    fixes.push("Sorted timing beats by startSec");
  }

  // Fix 2: Deduplicate beats
  const seenDescs = new Set<string>();
  const dedupedBeats: TimingBeat[] = [];
  for (const beat of result.timing.beats) {
    const key = beat.description.toLowerCase().trim();
    if (!seenDescs.has(key)) {
      seenDescs.add(key);
      dedupedBeats.push(beat);
    } else {
      fixes.push(`Removed duplicate beat: "${beat.description}"`);
    }
  }
  result.timing.beats = dedupedBeats;

  // Fix 3: Remove positive/negative conflicts — 모든 4개 negative layer 전체 적용
  const positiveText = `${result.global.style} ${result.reinforcement.styleSuffix}`;
  for (const layer of ["universal", "style", "sceneSpecific", "failureMode", "user"] as const) {
    const layerResult = sanitizeNegativesAgainstPositive(result.negatives[layer], positiveText);
    result.negatives[layer] = layerResult.cleaned;
    for (const r of layerResult.removed) fixes.push(`Removed conflicting negative "${r}" from ${layer} (present in positive style)`);
  }

  // Fix 4: Clean 3D/CGI in cinematic realism
  const isCR = /cinematic\s*realism/i.test(result.global.style + " " + result.global.styleId);
  if (isCR) {
    const replacements: Array<{ pattern: RegExp; replacement: string }> = [
      { pattern: /\b3D\s+topograph(?:ic)?\s+map\b/gi, replacement: "physical relief map surface" },
      { pattern: /\b3D\s+terrain\b/gi, replacement: "physical terrain surface" },
      { pattern: /\b3D\s+map\b/gi, replacement: "physical map surface" },
      { pattern: /\b3D\s+rendered?\b/gi, replacement: "cinematic" },
      { pattern: /\bCGI\s+(?:render|terrain|landscape)\b/gi, replacement: "cinematic physical surface" },
      { pattern: /\bgame[\s-]?map\b/gi, replacement: "physical map" },
      { pattern: /\bminiature\s+diorama\b/gi, replacement: "physical map surface" },
      { pattern: /\bglossy\s+(?:3D|render)\b/gi, replacement: "diffused natural surface" },
      { pattern: /\bplastic\s+(?:terrain|model|surface)\b/gi, replacement: "physical map surface" },
    ];
    for (const { pattern, replacement } of replacements) {
      for (const field of ["primary", "action"] as const) {
        const old = result.subject[field];
        const replaced = old.replace(pattern, replacement);
        if (old !== replaced) {
          result.subject[field] = replaced;
          fixes.push(`CGI cleaned in subject.${field}: "${old.match(pattern)?.[0]}" -> "${replacement}"`);
        }
      }
      const envOld = result.scene.environment;
      const envNew = envOld.replace(pattern, replacement);
      if (envOld !== envNew) {
        result.scene.environment = envNew;
        fixes.push("CGI cleaned in scene.environment");
      }
    }
  }

  // Fix 5: Fix broken fragments
  for (const field of ["primary", "action"] as const) {
    let text = result.subject[field];
    text = text.replace(/\bNo\s*\./gi, "").replace(/\.\s*\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();
    if (text !== result.subject[field]) {
      fixes.push(`Fixed broken fragment in subject.${field}`);
      result.subject[field] = text;
    }
  }

  // Fix 6: Normalize framing
  const VALID = ["ECU", "CU", "MCU", "MS", "MLS", "LS", "WS", "OTS", "POV"];
  const norm = result.camera.framing.toUpperCase();
  if (VALID.includes(norm) && result.camera.framing !== norm) {
    result.camera.framing = norm;
    fixes.push(`Normalized framing to "${norm}"`);
  }

  // Fix 7: Add medium lock for map scenes
  if (result.scene.shotCategory === "map-graphic" && !result.reinforcement.mediumLock) {
    result.reinforcement.mediumLock = "physical map surface — not a landscape, not a 3D render, not a CGI scene";
    fixes.push("Added medium lock for map scene");
  }

  // Fix 8: Environment scene — 공통 헬퍼로 카메라 + negative 규칙 적용
  if (isEnvironmentScene(result.scene.shotCategory)) {
    const cam = enforceEnvironmentCamera({
      framing: result.camera.framing, angle: result.camera.angle, motion: result.camera.motion,
    });
    if (cam.framing !== result.camera.framing || cam.motion !== result.camera.motion) {
      result.camera.framing = cam.framing;
      result.camera.motion = cam.motion;
      for (const f of cam.fixes) fixes.push(`Environment: ${f}`);
    }

    // Remove positive/negative overlaps (공통 헬퍼)
    const posText = result.global.style;
    for (const layer of ["universal", "sceneSpecific", "user"] as const) {
      const envResult = sanitizeEnvironmentNegatives(result.negatives[layer], posText);
      result.negatives[layer] = envResult.cleaned;
      for (const r of envResult.removed) fixes.push(`Environment: removed conflicting negative "${r}" (also in positive)`);
    }
  }

  return { doc: result, fixes };
}

// ═══════════════════════════════════════════════════════════════════
// 6. resolveConflicts — 충돌 해결
// ═══════════════════════════════════════════════════════════════════

export function resolveConflicts(doc: SingleShotDocument): {
  doc: SingleShotDocument;
  resolutions: string[];
} {
  const resolutions: string[] = [];
  const result = structuredClone(doc);

  // Resolution 1: Remove conflicting framing from camera motion
  const framingTerms: Record<string, RegExp> = {
    WS: /\b(close[\s-]?up|medium\s+close[\s-]?up|extreme\s+close[\s-]?up)\b/gi,
    LS: /\b(close[\s-]?up|medium\s+close[\s-]?up)\b/gi,
    CU: /\b(wide\s+shot|wide\s+establishing|long\s+shot)\b/gi,
    ECU: /\b(wide\s+shot|wide\s+establishing|long\s+shot|medium\s+shot)\b/gi,
    MCU: /\b(wide\s+shot|wide\s+establishing)\b/gi,
  };
  const fk = result.camera.framing.toUpperCase();
  const cp = framingTerms[fk];
  if (cp) {
    const oldMotion = result.camera.motion;
    result.camera.motion = oldMotion.replace(cp, "").replace(/\s{2,}/g, " ").trim();
    if (result.camera.motion !== oldMotion) {
      resolutions.push(`Removed conflicting framing from motion: "${oldMotion}" -> "${result.camera.motion}"`);
    }
  }

  // Resolution 2a: Environment scene — 공통 헬퍼로 연속 카메라 강제
  if (isEnvironmentScene(result.scene.shotCategory)) {
    const cam = enforceEnvironmentCamera({
      framing: result.camera.framing, angle: result.camera.angle, motion: result.camera.motion,
    });
    if (cam.motion !== result.camera.motion || cam.framing !== result.camera.framing) {
      result.camera.framing = cam.framing;
      result.camera.motion = cam.motion;
      for (const f of cam.fixes) resolutions.push(`Environment: ${f}`);
    }
  }

  // Resolution 2: Map scene framing protection
  if (result.scene.shotCategory === "map-graphic") {
    const close = ["ECU", "CU", "MCU"];
    if (close.includes(result.camera.framing.toUpperCase())) {
      const old = result.camera.framing;
      result.camera.framing = "WS";
      result.camera.angle = "overhead";
      resolutions.push(`Map scene: "${old}" -> "WS" + overhead`);
    }
  }

  // Resolution 3: Deduplicate negatives across layers (style 포함)
  const allNeg = [
    ...result.negatives.universal,
    ...(result.negatives.style || []),
    ...result.negatives.sceneSpecific,
    ...result.negatives.failureMode,
    ...result.negatives.user,
  ];
  const seen = new Set<string>();
  const dedup = (arr: string[]) => arr.filter(n => {
    const key = n.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  result.negatives.universal = dedup(result.negatives.universal);
  if (result.negatives.style) result.negatives.style = dedup(result.negatives.style);
  result.negatives.sceneSpecific = dedup(result.negatives.sceneSpecific);
  result.negatives.failureMode = dedup(result.negatives.failureMode);
  result.negatives.user = dedup(result.negatives.user);

  const uniqueCount = seen.size;
  if (uniqueCount < allNeg.length) {
    resolutions.push(`Deduplicated ${allNeg.length - uniqueCount} negative entries`);
  }

  return { doc: result, resolutions };
}

// ═══════════════════════════════════════════════════════════════════
// 7. serializeForProvider — 결정론적 JSON → 문자열 직렬화
// ═══════════════════════════════════════════════════════════════════

export interface SerializedShot {
  prompt: string;
  negativePrompt: string;
  wordCount: number;
  debug: {
    sections: Record<string, string>;
    truncated: boolean;
  };
}

function buildCameraLine(doc: SingleShotDocument): string {
  const framingMap: Record<string, string> = {
    ECU: "Extreme close-up", CU: "Close-up", MCU: "Medium close-up",
    MS: "Medium shot", MLS: "Medium long shot", LS: "Long shot",
    WS: "Wide shot", OTS: "Over-the-shoulder", POV: "Point-of-view",
  };
  const angleMap: Record<string, string> = {
    "eye-level": "eye-level", eye_level: "eye-level",
    "low-angle": "low-angle", low_angle: "low-angle",
    "high-angle": "high-angle", high_angle: "high-angle",
    dutch: "dutch angle", overhead: "overhead", POV: "POV",
  };

  const framing = framingMap[doc.camera.framing.toUpperCase()] || doc.camera.framing;
  const angle = angleMap[doc.camera.angle] || doc.camera.angle;
  const motion = doc.camera.motion && doc.camera.motion !== "static"
    ? `, ${doc.camera.motion}`
    : "";

  return `${framing}, ${angle}${motion}`;
}

/**
 * SingleShotDocument -> Provider 전송용 문자열
 *
 * 직렬화 순서 (결정론적):
 * 1. Subject  2. Camera  3. Location/situation cues
 * 4. Character ref  5. Action  6. Mood/Lighting
 * 7. Timing beats  8. Continuity  9. Style suffix
 * 10. Medium lock  11. Audio  12. No text guard
 * 13. Negatives (VEO = separate negative_prompt)
 */
export function serializeForProvider(
  doc: SingleShotDocument,
  provider: "veo" = "veo",
): SerializedShot {
  const cap = PROVIDER_CAPABILITIES[provider];
  const sections: Record<string, string> = {};
  const parts: string[] = [];

  // 1. Subject anchor
  if (doc.subject.primary) {
    const subjectLine = doc.subject.blocking
      ? `${doc.subject.primary}, ${doc.subject.blocking}`
      : doc.subject.primary;
    parts.push(subjectLine);
    sections.subject = subjectLine;
  }

  // 2. Camera
  const cameraLine = buildCameraLine(doc);
  if (cameraLine) {
    parts.push(cameraLine);
    sections.camera = cameraLine;
  }

  // 3. Location/situation cues (subject에 이미 포함되어 있으면 중복 방지)
  if (doc.scene.locationCue) {
    const subjectLower = (sections.subject || "").toLowerCase();
    const locLower = doc.scene.locationCue.toLowerCase();
    // locationCue가 subject에 이미 포함되어 있으면 스킵
    if (!subjectLower.includes(locLower) && !locLower.includes(subjectLower.slice(0, 20))) {
      parts.push(doc.scene.locationCue);
      sections.locationCue = doc.scene.locationCue;
    }
  }
  if (doc.scene.situationCue) {
    parts.push(doc.scene.situationCue);
    sections.situationCue = doc.scene.situationCue;
  }

  // 4. Character reference (verbatim)
  if (doc.continuity.characterRef) {
    parts.push(doc.continuity.characterRef);
    sections.characterRef = doc.continuity.characterRef;
  }

  // 5. Emotional anchor + Action + Body signal
  if (doc.scene.emotionalAnchor) {
    parts.push(doc.scene.emotionalAnchor);
    sections.emotionalAnchor = doc.scene.emotionalAnchor;
  }
  if (doc.subject.action) {
    parts.push(doc.subject.action);
    sections.action = doc.subject.action;
  }
  if (doc.subject.bodySignal) {
    parts.push(doc.subject.bodySignal);
    sections.bodySignal = doc.subject.bodySignal;
  }

  // 6. Mood/Lighting
  if (doc.scene.moodLighting) {
    parts.push(doc.scene.moodLighting);
    sections.moodLighting = doc.scene.moodLighting;
  }

  // 6b. Environment atmosphere enrichment (공통 헬퍼)
  const atmosphereParts = enrichAtmosphereForScene(doc.scene.shotCategory, doc.scene.moodLighting);
  if (atmosphereParts.length > 0) {
    const atmo = atmosphereParts.join(", ");
    parts.push(atmo);
    sections.atmosphere = atmo;
  }

  // 7. Timing beats
  const beatsLine = doc.timing.beats
    .map(b => `${b.startSec}s-${b.endSec}s: ${b.description}`)
    .join(". ");
  if (beatsLine) {
    parts.push(beatsLine);
    sections.timing = beatsLine;
  }

  // 8. Continuity transition
  if (doc.transition?.fromPrevious) {
    parts.push(`Previous shot ends with ${doc.transition.fromPrevious}`);
    sections.transition = doc.transition.fromPrevious;
  }

  // 9. Style — inject global style block (core visual identity)
  // Use the full global style, not just first sentence, so style actually shapes output
  if (doc.global.style && doc.global.style.length > 10) {
    // Take first 3 sentences of the global style for strong influence
    // without exceeding provider word limit
    const styleSentences = doc.global.style.split(". ").filter(Boolean);
    const styleBlock = styleSentences.slice(0, 3).join(". ");
    if (styleBlock.length > 10) {
      parts.push(styleBlock);
      sections.style = styleBlock;
    }
  } else if (doc.reinforcement.styleSuffix) {
    const first = doc.reinforcement.styleSuffix.split(". ")[0];
    if (first && first.length > 5) {
      parts.push(first);
      sections.style = first;
    }
  }

  // 10. Medium lock
  if (doc.reinforcement.mediumLock) {
    parts.push(doc.reinforcement.mediumLock);
    sections.mediumLock = doc.reinforcement.mediumLock;
  }

  // 11. Audio hint
  parts.push(doc.audio.hint);
  sections.audio = doc.audio.hint;

  // 12. No text guard → moved to negatives (positive prompt에 "No ..." 넣으면 오히려 생성 유도)
  // "text overlay", "watermark"는 universal negatives에서 처리

  // Build prompt
  let prompt = parts.filter(Boolean).join(". ");

  // 13. Negatives (5 layers: universal → style → sceneSpecific → failureMode → user)
  const allNeg = [
    ...doc.negatives.universal,
    ...(doc.negatives.style || []),
    ...doc.negatives.sceneSpecific,
    ...doc.negatives.failureMode,
    ...doc.negatives.user,
  ];
  let uniqueNeg = [...new Set(allNeg)].slice(0, 30);

  // ═══════════════════════════════════════════════════════════════
  // 14. 전역 Sanitize Pipeline (provider 전송 직전)
  // ═══════════════════════════════════════════════════════════════
  const sanitized = runSanitizePipeline({
    prompt,
    negatives: uniqueNeg,
    framing: doc.camera.framing,
    shotCategory: doc.scene.shotCategory,
    styleSuffix: doc.reinforcement.styleSuffix,
  });
  prompt = sanitized.prompt;
  uniqueNeg = sanitized.negatives;
  if (sanitized.log.length > 0) {
    sections._sanitizeLog = sanitized.log.join(" | ");
  }
  // Framing이 변경되었으면 camera line 재생성
  if (sanitized.framing !== doc.camera.framing) {
    const updatedDoc = { ...doc, camera: { ...doc.camera, framing: sanitized.framing } };
    const newCameraLine = buildCameraLine(updatedDoc);
    // 기존 camera line을 교체
    const oldCameraLine = sections.camera;
    if (oldCameraLine) {
      prompt = prompt.replace(oldCameraLine, newCameraLine);
      sections.camera = newCameraLine;
    }
  }

  const negStr = uniqueNeg.join(", ");

  if (!cap.supportsNegativePrompt && uniqueNeg.length > 0) {
    prompt += `. Avoid: ${negStr}`;
    sections.negatives_embedded = negStr;
  }

  // ═══════════════════════════════════════════════════════════════
  // 15. Final Payload Validation — auto-fix loop (최대 3회)
  // pos_neg_conflict 등 auto-fixable 에러가 남으면 반복 수정
  // ═══════════════════════════════════════════════════════════════
  const allAutoFixes: string[] = [];
  let lastValidation = validateFinalProviderPayload({
    prompt,
    negatives: uniqueNeg,
    framing: sanitized.framing,
    shotCategory: doc.scene.shotCategory,
    provider,
  });

  for (let fixRound = 0; fixRound < 3 && !lastValidation.valid && lastValidation.autoFixable; fixRound++) {
    const fixed = autoFixPayload({
      prompt,
      negatives: uniqueNeg,
      framing: sanitized.framing,
      shotCategory: doc.scene.shotCategory,
      provider,
    });
    prompt = fixed.prompt;
    uniqueNeg = fixed.negatives;
    sanitized.framing = fixed.framing;
    allAutoFixes.push(...fixed.fixes);

    lastValidation = validateFinalProviderPayload({
      prompt,
      negatives: uniqueNeg,
      framing: sanitized.framing,
      shotCategory: doc.scene.shotCategory,
      provider,
    });
  }

  if (allAutoFixes.length > 0) {
    sections._autoFixes = allAutoFixes.join(" | ");
  }
  if (lastValidation.issues.length > 0) {
    sections._validationIssues = lastValidation.issues.map(i => `[${i.severity}] ${i.message}`).join(" | ");
  }

  // Word cap
  let truncated = false;
  const words = prompt.split(/\s+/);
  if (words.length > cap.maxPromptWords) {
    prompt = words.slice(0, cap.maxPromptWords - 5).join(" ");
    truncated = true;
  }

  // Char cap — VEO 프롬프트가 너무 길면 품질 저하
  if (prompt.length > cap.maxPromptChars) {
    // 문장 단위로 자르기 (마지막 완전한 문장까지)
    const cutoff = prompt.lastIndexOf(". ", cap.maxPromptChars - 10);
    prompt = cutoff > cap.maxPromptChars * 0.5
      ? prompt.slice(0, cutoff + 1)
      : prompt.slice(0, cap.maxPromptChars);
    truncated = true;
  }

  // Cleanup
  prompt = prompt
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    prompt,
    negativePrompt: cap.supportsNegativePrompt ? negStr : "",
    wordCount: prompt.split(/\s+/).length,
    debug: { sections, truncated },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 8. assembleFromJSON — 메인 파이프라인
// ═══════════════════════════════════════════════════════════════════

/** Pipeline logging trace — raw → normalized → final */
export interface PipelineTrace {
  /** Step 1: Raw document from buildShotDocument */
  rawSnapshot: { framing: string; motion: string; shotCategory?: string; negativeCount: number };
  /** Step 2-4: After validate → sanitize → resolveConflicts */
  sanitizedSnapshot: { fixes: string[]; resolutions: string[] };
  /** Step 5: After normalizeSequence */
  normalizedSnapshot: { sceneType: string | null; log: string[]; warnings: string[]; blocked: boolean };
  /** Step 6: Final serialized preview (debug only) */
  finalSnapshot: { wordCount: number; truncated: boolean; validationIssues: number };
}

export interface AssembleFromJSONResult {
  /** JSON-first source of truth — 이것이 유일한 1급 산출물 */
  structuredSequence: StructuredSequenceDocument;
  /** 내부 SingleShotDocument (디버그/검증용) */
  document: SingleShotDocument;
  /** diagnostics */
  diagnostics: {
    validation: ValidationResult;
    sanitizeFixes: string[];
    conflictResolutions: string[];
    driftWarning?: string;
  };
  /** 파이프라인 단계별 trace (raw → normalized → final) */
  pipelineTrace: PipelineTrace;
  /**
   * Content-aware multi-shot array derived from shot-splitting progression detection.
   *
   * When arrow progressions (A → B → C) or other progressions are detected,
   * this contains the properly split shots in MultiShotPrompt[] format.
   * The caller MUST use this to update Cut.multiShot so that editor/preview/submit
   * all reflect the real multi-shot structure.
   *
   * undefined = no progression-based split was performed (use existing multiShot).
   */
  suggestedMultiShot?: import("@/types").MultiShotPrompt[];
  /** 디버그 전용 프리뷰 — source of truth 아님, 저장/전송 금지 */
  preview?: {
    renderedPrompt: string;
    renderedNegative: string;
    wordCount: number;
    sections: Record<string, string>;
    truncated: boolean;
    isMapScene: boolean;
    isEnvironmentScene: boolean;
    /** 멀티샷 구조 요약 (Cut에 multiShot이 있으면 반영) */
    multiShotSummary?: {
      shotCount: number;
      roles: (string | undefined)[];
      durations: string[];
      isForced: boolean;
    };
  };
}

/**
 * JSON-first 조립 메인 파이프라인.
 *
 * Build JSON → Validate → Sanitize → Resolve Conflicts.
 * 직렬화(Serialize)는 여기서 하지 않는다.
 * 직렬화가 필요한 시점은 provider에 전송하는 마지막 순간뿐이며,
 * 그 책임은 serializeForProvider() 또는 서버 generate-video.ts에 있다.
 *
 * 반환값에 prompt 문자열은 없다. preview.renderedPrompt는 디버그 전용이다.
 */
export function assembleFromJSON(input: {
  cut: Cut;
  config: VideoGenerationConfig;
  prevCut?: Cut;
}): AssembleFromJSONResult {
  const provider = "veo" as const;

  // Step 1: Build JSON document
  const rawDoc = buildShotDocument(input);

  // Pipeline trace — raw snapshot
  const rawSnapshot = {
    framing: rawDoc.camera.framing,
    motion: rawDoc.camera.motion,
    shotCategory: rawDoc.scene.shotCategory,
    negativeCount: rawDoc.negatives.universal.length + rawDoc.negatives.sceneSpecific.length + rawDoc.negatives.failureMode.length + rawDoc.negatives.user.length,
  };

  // Step 2: Sanitize (BEFORE validation — so validation reflects cleaned state)
  const { doc: sanitizedDoc, fixes: sanitizeFixes } = sanitizeShotDocument(rawDoc);

  // Step 3: Resolve conflicts
  const { doc: resolvedDoc, resolutions: conflictResolutions } = resolveConflicts(sanitizedDoc);

  // Step 4: Normalize (전역 정규화 — sceneType 추론, characterRef 정리, 과부하 감지, coverage 보강)
  const normalized = normalizeSequence(resolvedDoc);
  const normalizedDoc = normalized.doc;
  const normalizeLog = normalized.log;
  const normalizeWarnings = normalized.warnings;

  // Step 5: Validate AFTER normalization — so structuredSequence.validation reflects the cleaned state
  const validation = validateShotDocument(normalizedDoc);

  // Drift warning (validation + normalize 결과 통합)
  let driftWarning: string | undefined;
  const errors = validation.issues.filter(i => i.severity === "error");
  if (errors.length >= 3) {
    driftWarning = `HIGH RISK (${errors.length} errors): ${errors.map(e => e.message).join("; ")}`;
  }
  if (normalized.blocked) {
    driftWarning = normalized.blockReason || driftWarning;
  }
  if (normalizeWarnings.length > 0 && !driftWarning) {
    const overloadWarnings = normalizeWarnings.filter(w => w.includes("[overload]"));
    if (overloadWarnings.length > 0) {
      driftWarning = `OVERLOADED SHOT: ${overloadWarnings.join("; ")}`;
    }
  }

  const allNeg = [
    ...normalizedDoc.negatives.universal,
    ...(normalizedDoc.negatives.style || []),
    ...normalizedDoc.negatives.sceneSpecific,
    ...normalizedDoc.negatives.failureMode,
    ...normalizedDoc.negatives.user,
  ];

  // ── Dense Sequence Fields (v2) ─────────────────────────────────────────
  // Duration source of truth: cut.durationSec (per-cut) > config.durationSeconds (global)
  const dur = (input.cut.durationSec && input.cut.durationSec > 0)
    ? input.cut.durationSec
    : (input.config.durationSeconds && input.config.durationSeconds > 0 ? input.config.durationSeconds : 8);
  const effectiveSceneType = normalizedDoc.scene.shotCategory || input.cut.shotCategory || "unknown";
  const isEnvScene = effectiveSceneType === "environment";

  // Physics rules detection + enforcement
  const physicsRules = detectPhysicsRules(
    normalizedDoc.scene.environment,
    normalizedDoc.subject.primary,
    normalizedDoc.scene.moodLighting,
  );

  // Physics-based negatives
  const physicsNeg = enforcePhysicsNegatives(physicsRules);
  if (physicsNeg.length > 0) {
    for (const neg of physicsNeg) {
      if (!normalizedDoc.negatives.sceneSpecific.includes(neg)) {
        normalizedDoc.negatives.sceneSpecific.push(neg);
      }
    }
  }

  // Physics-based text rewrite — ALL layers (subject, scene, reinforcement, audio, continuity, global)
  const allLayerRewrites = sanitizeAllFieldsForPhysics(normalizedDoc, physicsRules);
  normalizeLog.push(...allLayerRewrites.rewrites);

  // Lunar-specific lighting sanitizer
  if (physicsRules.environmentType === "lunar") {
    const lunarLight = sanitizeLunarLighting(normalizedDoc.scene.moodLighting);
    if (lunarLight.rewrites.length > 0) {
      normalizedDoc.scene.moodLighting = lunarLight.text;
      normalizeLog.push(...lunarLight.rewrites);
    }

    // Lunar camera rewrite
    const lunarCam = sanitizeLunarCamera(normalizedDoc.camera.motion, normalizedDoc.subject.action);
    if (lunarCam.rewrites.length > 0) {
      normalizedDoc.camera.motion = lunarCam.motion;
      normalizeLog.push(...lunarCam.rewrites);
    }
  }

  // Physics consistency violations → validation issues (ALL fields including audio/reinforcement)
  const physicsViolations = checkPhysicsConsistency(physicsRules, {
    "subject.primary": normalizedDoc.subject.primary,
    "subject.action": normalizedDoc.subject.action,
    "scene.environment": normalizedDoc.scene.environment,
    "scene.moodLighting": normalizedDoc.scene.moodLighting,
    "reinforcement.styleSuffix": normalizedDoc.reinforcement.styleSuffix,
    "audio.hint": normalizedDoc.audio.hint,
    "global.style": normalizedDoc.global.style,
    "continuity.ambient": normalizedDoc.continuity.ambient || "",
  });

  // Extract anchors from normalized doc text
  const sceneContext = detectSceneContext(normalizedDoc.scene.environment, normalizedDoc.subject.primary, normalizedDoc.scene.moodLighting);
  const fullTextForAnchors = `${normalizedDoc.subject.primary} ${normalizedDoc.subject.action} ${normalizedDoc.scene.environment} ${normalizedDoc.scene.moodLighting}`;

  // Place identity anchors — scan text for concrete objects
  const placeAnchors: string[] = [];
  const placeCandidates = getPlaceIdentityCandidates(sceneContext);
  for (const candidate of placeCandidates) {
    if (fullTextForAnchors.toLowerCase().includes(candidate.toLowerCase().split(" ")[0])) {
      placeAnchors.push(candidate);
    }
  }
  // Also check for any anchors injected by normalizer
  const whereLog = normalizeLog.filter(l => l.includes("[WHERE]") && l.includes("Injected"));
  for (const log of whereLog) {
    const m = log.match(/Injected place identity anchor: "([^"]+)"/);
    if (m) placeAnchors.push(m[1]);
  }
  if (placeAnchors.length === 0 && isEnvScene) {
    // Fallback: use first candidate
    placeAnchors.push(placeCandidates[0] || "unidentified location element");
  }

  // Situation evidence — scan for evidence
  const evidence: string[] = [];
  const evidenceCandidates = getSituationEvidenceCandidates(sceneContext);
  for (const candidate of evidenceCandidates) {
    if (fullTextForAnchors.toLowerCase().includes(candidate.toLowerCase().split(" ")[0])) {
      evidence.push(candidate);
    }
  }
  const whatLog = normalizeLog.filter(l => l.includes("[WHAT]") && l.includes("Injected"));
  for (const log of whatLog) {
    const m = log.match(/Injected situation evidence: "([^"]+)"/);
    if (m) evidence.push(m[1]);
  }
  if (evidence.length === 0 && isEnvScene) {
    evidence.push(evidenceCandidates[0] || "ambient environmental activity");
  }

  // Natural motion
  const motionItems: string[] = [];
  const motionCandidates = getNaturalMotionCandidates(sceneContext);
  const motionLog = normalizeLog.filter(l => l.includes("[MOTION]") && l.includes("Injected"));
  for (const log of motionLog) {
    const m = log.match(/Injected natural motion: "([^"]+)"/);
    if (m) motionItems.push(m[1]);
  }
  const motionPresentLog = normalizeLog.filter(l => l.includes("[MOTION]") && l.includes("present"));
  for (const log of motionPresentLog) {
    const m = log.match(/Natural motion present: (.+)$/);
    if (m) motionItems.push(...m[1].split(", "));
  }
  if (motionItems.length === 0 && isEnvScene) {
    motionItems.push(motionCandidates[0] || "subtle ambient motion");
  }

  // Temporal beats from SingleShotDocument
  const temporalBeats: TemporalBeat[] = normalizedDoc.timing.beats.map(b => ({
    startSec: b.startSec,
    endSec: b.endSec,
    focus: b.description,
  }));

  // Camera plan
  const cameraPlan = {
    baseFraming: normalizedDoc.camera.framing,
    angle: normalizedDoc.camera.angle,
    motion: normalizedDoc.camera.motion,
    motionMotivation: normalizedDoc.camera.motionMotivation,
  };

  // Style profile
  const styleProfile = {
    mode: normalizedDoc.global.styleId || normalizedDoc.global.style,
    mediumLock: normalizedDoc.reinforcement.mediumLock,
    colorAnchor: normalizedDoc.continuity.colorAnchor,
  };

  // Continuity
  const sequenceContinuity = {
    lighting: normalizedDoc.continuity.lightingDirection || normalizedDoc.scene.moodLighting,
    sky: physicsRules.skyConstraint,
    surface: undefined as string | undefined,
    scale: normalizedDoc.camera.framing,
    characterRef: normalizedDoc.continuity.characterRef,
    mustPersist: normalizedDoc.continuity.mustPersist || [],
  };
  // Surface extraction for special environments
  if (physicsRules.environmentType === "lunar") {
    sequenceContinuity.surface = "fine grey regolith";
  }

  // Density score calculation
  const densityScore = computeDensityScore({
    placeAnchors,
    evidence,
    temporalBeats,
    cameraPlan,
    physicsRules,
    motionItems,
    lightLog: normalizeLog.filter(l => l.includes("[LIGHT]")),
    continuity: sequenceContinuity,
  });

  // ── Shot splitting — single shot → multi-shot sequence ──
  // Derive beat hint for shot priority ordering:
  // - Cut 1 is typically the hook → macro-first framing
  // - Scene description with [훅] or hook markers → hook beat
  // - Consequence/mechanism/payoff keywords → corresponding beat types
  const beatHint: ShotBeatHint = (() => {
    const desc = (input.cut.sceneDescription || "").toLowerCase();
    if (input.cut.cutNumber === 1) return "hook";
    if (/\[.*훅.*\]|hook|도입/.test(desc)) return "hook";
    if (/mechanism|원리|메커니즘/.test(desc)) return "mechanism";
    if (/consequence|결과|영향/.test(desc)) return "consequence";
    if (/payoff|보상|착지/.test(desc)) return "payoff";
    if (/paradox|역설/.test(desc)) return "paradox";
    return "default";
  })();

  const splitResult = enforceMinimumShotCount({
    sceneType: effectiveSceneType,
    subjectPrimary: normalizedDoc.subject.primary,
    action: normalizedDoc.subject.action,
    environment: normalizedDoc.scene.environment,
    moodLighting: normalizedDoc.scene.moodLighting,
    durationSec: dur,
    camera: {
      framing: normalizedDoc.camera.framing,
      angle: normalizedDoc.camera.angle,
      motion: normalizedDoc.camera.motion,
    },
    currentShotCount: 1,
    beatHint,
    styleSuffix: normalizedDoc.reinforcement.styleSuffix,
  });
  const sequenceShots: ShotDescriptor[] = splitResult
    ? splitResult.shots
    : [{
        shotId: "shot_1",
        startSec: 0,
        endSec: dur,
        camera: {
          framing: normalizedDoc.camera.framing,
          angle: normalizedDoc.camera.angle,
          motion: normalizedDoc.camera.motion,
        },
        subject: normalizedDoc.subject.primary,
        action: normalizedDoc.subject.action,
        environment: normalizedDoc.scene.environment,
        moodLighting: normalizedDoc.scene.moodLighting,
        focus: `${normalizedDoc.subject.primary} — ${normalizedDoc.subject.action}`.slice(0, 120),
      }];
  // ── Convert split shots → MultiShotPrompt[] for Cut.multiShot bridge ──
  // This is the critical bridge between System A (structuredSequence.shots)
  // and System B (Cut.multiShot). Without this, shot-splitting results
  // never reach the actual video generation submission.
  let suggestedMultiShot: MultiShotPrompt[] | undefined;

  if (splitResult?.wasSplit) {
    normalizeLog.push(...splitResult.splitLog);
    // Update temporal beats from split shots
    temporalBeats.length = 0;
    for (const shot of sequenceShots) {
      temporalBeats.push({
        startSec: shot.startSec,
        endSec: shot.endSec,
        focus: shot.focus,
      });
    }

    // Bridge: convert ShotDescriptor[] → MultiShotPrompt[]
    // This ensures progression-aware splits become the actual multiShot
    // used by editor, preview, and submission.
    const sceneType = (effectiveSceneType || "default") as import("@/lib/multi-shot-planner").PlannerSceneType;
    const roles = planShotRoles(sequenceShots.length, sceneType);
    // Math.round 반올림 합계가 durationSec과 달라지는 문제 방지:
    // 마지막 shot에서 잔여 시간을 보정하여 합계 = dur 보장.
    const shotRawDurations = sequenceShots.map(shot => Math.round(shot.endSec - shot.startSec));
    const shotRawSum = shotRawDurations.reduce((s, d) => s + d, 0);
    if (shotRawSum !== dur && shotRawDurations.length > 0) {
      shotRawDurations[shotRawDurations.length - 1] += dur - shotRawSum;
    }

    suggestedMultiShot = sequenceShots.map((shot, i) => {
      const role: ShotRole = roles[i] || "develop";
      const _framingMap: Record<string, string> = {
        ECU: "Extreme close-up", CU: "Close-up", MCU: "Medium close-up",
        MS: "Medium shot", MLS: "Medium long shot", LS: "Long shot",
        WS: "Wide shot", OTS: "Over-the-shoulder", POV: "Point-of-view",
      };
      const fUpper = shot.camera.framing.toUpperCase();
      // 이미 "shot" 포함된 값이면 그대로, 약어면 매핑, 그 외만 " shot" 접미
      const framingLabel = _framingMap[fUpper]
        || (/shot/i.test(shot.camera.framing) ? shot.camera.framing : `${shot.camera.framing} shot`);
      const camAngle = shot.camera.angle?.replace(/_/g, "-") || "";
      const camMotion = shot.camera.motion && shot.camera.motion !== "static"
        ? shot.camera.motion : "";
      const camLine = [framingLabel, camAngle, camMotion].filter(Boolean).join(", ");
      const styleTag = normalizedDoc.reinforcement.styleSuffix
        ? `. ${normalizedDoc.reinforcement.styleSuffix}`
        : "";
      // 완전한 시각 묘사: camera + subject + action + environment + mood + focus
      const prompt = [
        camLine,
        shot.subject,
        shot.action !== shot.subject ? shot.action : "",
        shot.environment,
        shot.moodLighting,
        shot.focus,
      ].filter(Boolean).join(". ").trim() + styleTag;
      const duration = String(Math.max(1, shotRawDurations[i]));
      return { index: i + 1, prompt: prompt.slice(0, 500), duration, role };
    });
  }

  // ── Sequence density validation ──
  const seqDensityIssues = validateSequenceDensity({
    sceneType: effectiveSceneType,
    shotCount: sequenceShots.length,
    action: normalizedDoc.subject.action,
    durationSec: dur,
    hasPlaceAnchors: placeAnchors.length > 0,
    hasEvidence: evidence.length > 0,
    hasTemporalBeats: temporalBeats.length >= 2,
  });

  // Build StructuredSequenceDocument — 유일한 1급 산출물
  const shotPlan = input.cut.videoPromptJson
    ? videoPromptJsonToShotPlan(
        input.cut.videoPromptJson,
        input.cut.cutNumber - 1,
        dur,
        0,
        { shotCategory: input.cut.shotCategory, characterRole: input.cut.characterRole },
      )
    : {
        shotId: `shot_${input.cut.cutNumber}`,
        startSec: 0,
        endSec: dur,
        shotType: "medium_action" as const,
        camera: { framing: normalizedDoc.camera.framing as "MS", angle: "eye_level" as const, motion: normalizedDoc.camera.motion },
        subject: { primary: normalizedDoc.subject.primary },
        environment: normalizedDoc.scene.environment,
        action: normalizedDoc.subject.action,
        visualDirectives: [],
        negativeDirectives: [...new Set(allNeg)].slice(0, 30),
        moodLighting: normalizedDoc.scene.moodLighting,
        shotCategory: normalizedDoc.scene.shotCategory || input.cut.shotCategory,
        characterRole: input.cut.characterRole,
      };

  const structuredSequence: StructuredSequenceDocument = {
    // ── Dense Sequence Fields (v2) ──
    sequenceId: `seq_${input.cut.cutNumber}_${Date.now().toString(36)}`,
    shotId: `shot_${input.cut.cutNumber}`,
    cutNumber: input.cut.cutNumber,
    sceneType: effectiveSceneType,
    durationSec: dur,
    styleProfile,
    continuity: sequenceContinuity,
    physicsRules,
    placeIdentityAnchors: [...new Set(placeAnchors)],
    situationEvidence: [...new Set(evidence)],
    naturalMotion: [...new Set(motionItems)],
    cameraPlan,
    temporalBeats,
    densityScore,
    shots: sequenceShots,

    // ── Legacy / Existing ──
    shotPlan,
    videoPromptJson: input.cut.videoPromptJson,
    negatives: {
      universal: normalizedDoc.negatives.universal,
      sceneSpecific: [...new Set(normalizedDoc.negatives.sceneSpecific)],
      failureMode: [...new Set(normalizedDoc.negatives.failureMode)],
      user: normalizedDoc.negatives.user,
    },
    validation: {
      valid: validation.valid,
      errors: validation.issues.filter(i => i.severity === "error").length,
      warnings: validation.issues.filter(i => i.severity === "warning").length,
      issues: validation.issues.map(i => ({ rule: i.rule, severity: i.severity, message: i.message })),
    },
    sanitizeFixes: [...sanitizeFixes, ...normalizeLog],
    conflictResolutions: [...conflictResolutions, ...normalizeWarnings],
  };

  // Preview — buildFinalProviderPayload()로 조립. 디버그 전용.
  // 이 값은 저장하거나 body에 넣으면 안 된다. source of truth는 structuredSequence.
  const finalPayload = buildFinalProviderPayload({ document: normalizedDoc, provider });

  // ── Post-serialization validation — 최종 결과에 pos/neg 충돌이 남아있으면 driftWarning 강화
  if (finalPayload.blocked && !driftWarning) {
    driftWarning = `BLOCKED: ${finalPayload.blockReason}`;
  }
  if (finalPayload.debug.validationIssues.some(v => v.includes("pos_neg_conflict")) && !driftWarning) {
    driftWarning = `FINAL PAYLOAD pos/neg conflict: ${finalPayload.debug.validationIssues.join("; ")}`;
  }

  // ── Strengthened validation: density + physics + final builder ──────────
  // Collect all issues from all sources into a unified list
  const allValidationIssues: Array<{ rule: string; severity: "error" | "warning"; message: string }> = [
    ...validation.issues.map(i => ({ rule: i.rule, severity: i.severity as "error" | "warning", message: i.message })),
    ...seqDensityIssues,
  ];

  // Density check — environment scenes need minimum density 60
  if (isEnvScene && densityScore.total < 60) {
    allValidationIssues.push({
      rule: "density_insufficient",
      severity: "warning",
      message: `Sequence density ${densityScore.total}/100 < 60 minimum (missing: ${densityScore.missing.join(", ")})`,
    });
  }

  // Required anchors check
  if (isEnvScene && structuredSequence.placeIdentityAnchors.length < 1) {
    allValidationIssues.push({
      rule: "place_anchor_missing",
      severity: "error",
      message: "Environment scene requires at least 1 placeIdentityAnchor",
    });
  }
  if (isEnvScene && structuredSequence.situationEvidence.length < 1) {
    allValidationIssues.push({
      rule: "situation_evidence_missing",
      severity: "error",
      message: "Environment scene requires at least 1 situationEvidence",
    });
  }

  // Temporal beats check (all scenes)
  if (temporalBeats.length < 2) {
    allValidationIssues.push({
      rule: "temporal_beats_insufficient",
      severity: "warning",
      message: `Need at least 2 temporal beats, got ${temporalBeats.length}`,
    });
  }

  // Physics consistency check
  for (const violation of physicsViolations) {
    allValidationIssues.push({
      rule: violation.rule,
      severity: "error",
      message: violation.message,
    });
  }

  // Final builder issues
  if (!finalPayload.valid) {
    const builderIssues = finalPayload.debug.validationIssues.map(v => {
      const m = v.match(/^\[(error|warning)\]\s*(\S+):\s*(.+)$/);
      return m ? { rule: m[2], severity: m[1] as "error" | "warning", message: m[3] } : { rule: "final_builder", severity: "error" as const, message: v };
    });
    allValidationIssues.push(...builderIssues);
  }

  // Compute final valid status — strict conditions
  const finalErrors = allValidationIssues.filter(i => i.severity === "error");
  const finalWarnings = allValidationIssues.filter(i => i.severity === "warning");
  const isValid = finalErrors.length === 0 && finalPayload.valid;

  structuredSequence.validation = {
    valid: isValid,
    errors: finalErrors.length,
    warnings: finalWarnings.length,
    issues: allValidationIssues,
  };

  // Update driftWarning with physics/density issues
  if (physicsViolations.length > 0 && !driftWarning) {
    driftWarning = `PHYSICS VIOLATION: ${physicsViolations.map(v => v.message).join("; ")}`;
  }
  if (finalPayload.blocked && !driftWarning) {
    driftWarning = `BLOCKED: ${finalPayload.blockReason}`;
  }

  // Pipeline trace — step-by-step snapshot for debugging
  const pipelineTrace: PipelineTrace = {
    rawSnapshot,
    sanitizedSnapshot: { fixes: sanitizeFixes, resolutions: conflictResolutions },
    normalizedSnapshot: {
      sceneType: normalizedDoc.scene.shotCategory || null,
      log: normalizeLog,
      warnings: normalizeWarnings,
      blocked: normalized.blocked,
    },
    finalSnapshot: {
      wordCount: finalPayload.wordCount,
      truncated: finalPayload.debug.truncated,
      validationIssues: finalPayload.debug.validationIssues.length,
    },
  };

  return {
    structuredSequence,
    document: normalizedDoc,
    suggestedMultiShot,
    diagnostics: {
      validation,
      sanitizeFixes: [...sanitizeFixes, ...normalizeLog],
      conflictResolutions: [...conflictResolutions, ...normalizeWarnings],
      driftWarning,
    },
    pipelineTrace,
    preview: {
      renderedPrompt: finalPayload.prompt,
      renderedNegative: finalPayload.negativePrompt,
      wordCount: finalPayload.wordCount,
      sections: finalPayload.debug.sections,
      truncated: finalPayload.debug.truncated,
      isMapScene: normalizedDoc.scene.shotCategory === "map-graphic",
      isEnvironmentScene: normalizedDoc.scene.shotCategory === "environment",
      // 멀티샷 구조 요약 — Cut에 multiShot이 있으면 반영
      ...(input.cut.multiShot && input.cut.multiShot.length >= 2 ? {
        multiShotSummary: {
          shotCount: input.cut.multiShot.length,
          roles: input.cut.multiShot.map(s => s.role),
          durations: input.cut.multiShot.map(s => s.duration),
          isForced: (normalizedDoc.scene.shotCategory === "environment" ||
            normalizedDoc.scene.shotCategory === "cinematic_sequence" ||
            normalizedDoc.scene.shotCategory === "character-driven" ||
            normalizedDoc.scene.shotCategory === "battle") &&
            structuredSequence.durationSec >= 6,
        },
      } : {}),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 9. renderSequenceForProvider — 마지막 직렬화 지점
// ═══════════════════════════════════════════════════════════════════

/**
 * StructuredSequenceDocument → provider 전송용 문자열.
 *
 * 이 함수는 오직 string-only provider에 전송하기 직전에만 호출한다.
 * source of truth는 여전히 structuredSequence이며,
 * 이 함수의 반환값은 일시적 transport payload일 뿐 저장하면 안 된다.
 */
export function renderSequenceForProvider(
  sequence: StructuredSequenceDocument,
  provider: "veo" = "veo",
): { prompt: string; negativePrompt: string } {
  // shotPlan → SingleShotDocument를 재구성하지 않고
  // ShotPlan의 필드를 직접 사용하여 deterministic 직렬화
  const shot = sequence.shotPlan;
  const json = sequence.videoPromptJson;
  const cap = PROVIDER_CAPABILITIES[provider];

  const parts: string[] = [];

  // Camera
  const framingMap: Record<string, string> = {
    ECU: "Extreme close-up", CU: "Close-up", MCU: "Medium close-up",
    MS: "Medium shot", MLS: "Medium long shot", LS: "Long shot",
    WS: "Wide shot", OTS: "Over-the-shoulder", POV: "Point-of-view",
  };
  const angleMap: Record<string, string> = {
    eye_level: "eye-level", low_angle: "low-angle", high_angle: "high-angle",
    dutch: "dutch angle", overhead: "overhead", POV: "POV",
  };

  const framing = framingMap[shot.camera.framing] || shot.camera.framing;
  const angle = angleMap[shot.camera.angle] || shot.camera.angle;
  const motion = shot.camera.motion && shot.camera.motion !== "static"
    ? `, ${shot.camera.motion}`
    : "";

  // Subject
  if (shot.subject.primary) {
    const subjectLine = shot.subject.blocking
      ? `${shot.subject.primary}, ${shot.subject.blocking}`
      : shot.subject.primary;
    parts.push(subjectLine);
  }

  // Camera line
  parts.push(`${framing}, ${angle}${motion}`);

  // Location / Situation cues
  if (shot.locationCue) parts.push(shot.locationCue);
  if (shot.situationCue) parts.push(shot.situationCue);

  // Character ref
  if (shot.subject.characterRef) parts.push(shot.subject.characterRef);

  // Emotional anchor + Action
  if (shot.emotionalAnchor) parts.push(shot.emotionalAnchor);
  if (shot.action) parts.push(shot.action);

  // Body signal (from videoPromptJson)
  if (json?.bodySignal) parts.push(json.bodySignal);

  // Mood/Lighting
  if (shot.moodLighting) parts.push(shot.moodLighting);

  // Environment atmosphere enrichment (공통 헬퍼)
  const atmos = enrichAtmosphereForScene(shot.shotCategory, shot.moodLighting);
  if (atmos.length > 0) parts.push(atmos.join(", "));

  // Timing beat
  if (shot.timingBeat) parts.push(shot.timingBeat);

  // Transition
  if (shot.transitionFromPrev) parts.push(`Previous shot ends with ${shot.transitionFromPrev}`);

  // Style suffix (from videoPromptJson)
  if (json?.styleSuffix) {
    const first = json.styleSuffix.split(". ")[0];
    if (first && first.length > 5) parts.push(first);
  }

  // Visual medium lock
  if (shot.visualMedium) parts.push(shot.visualMedium);

  // Audio
  parts.push("Diegetic ambient sound");
  // "No text overlay, no watermark" → negatives에서 처리 (positive에 "No ..."는 역효과)

  let prompt = parts.filter(Boolean).join(". ");

  // Negatives
  const allNeg = sequence.negatives
    ? [...sequence.negatives.universal, ...sequence.negatives.sceneSpecific, ...sequence.negatives.failureMode, ...sequence.negatives.user]
    : shot.negativeDirectives || [];
  let uniqueNeg = [...new Set(allNeg)].slice(0, 30);

  // ═══════════════════════════════════════════════════════════════
  // 전역 Sanitize Pipeline (provider 전송 직전)
  // ═══════════════════════════════════════════════════════════════
  const sanitized = runSanitizePipeline({
    prompt,
    negatives: uniqueNeg,
    framing: shot.camera.framing,
    shotCategory: shot.shotCategory,
    styleSuffix: json?.styleSuffix,
  });
  prompt = sanitized.prompt;
  uniqueNeg = sanitized.negatives;
  if (sanitized.log.length > 0) {
    console.log("[renderSequenceForProvider] sanitize:", sanitized.log.join(" | "));
  }

  // Final Payload Validation (마지막 게이트)
  const validation = validateFinalProviderPayload({
    prompt,
    negatives: uniqueNeg,
    framing: sanitized.framing,
    shotCategory: shot.shotCategory,
    provider,
  });
  if (!validation.valid && validation.autoFixable) {
    const fixed = autoFixPayload({
      prompt,
      negatives: uniqueNeg,
      framing: sanitized.framing,
      shotCategory: shot.shotCategory,
      provider,
    });
    prompt = fixed.prompt;
    uniqueNeg = fixed.negatives;
    if (fixed.fixes.length > 0) {
      console.log("[renderSequenceForProvider] auto-fixes:", fixed.fixes.join(" | "));
    }
  }
  if (validation.issues.length > 0) {
    console.log("[renderSequenceForProvider] validation:", validation.issues.map(i => `[${i.severity}] ${i.message}`).join(" | "));
  }

  const negStr = uniqueNeg.join(", ");

  if (!cap.supportsNegativePrompt && uniqueNeg.length > 0) {
    prompt += `. Avoid: ${negStr}`;
  }

  // Word cap
  const words = prompt.split(/\s+/);
  if (words.length > cap.maxPromptWords) {
    prompt = words.slice(0, cap.maxPromptWords - 5).join(" ");
  }

  // Cleanup
  prompt = prompt
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    prompt,
    negativePrompt: cap.supportsNegativePrompt ? negStr : "",
  };
}
