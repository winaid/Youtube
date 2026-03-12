/**
 * sequence-assembler.ts — JSON-first 프롬프트 조립 엔진
 *
 * 핵심 원칙:
 * 1. 모든 프롬프트 데이터를 JSON(SingleShotDocument)으로 관리
 * 2. String 조합은 최종 provider 전송 직전에만 수행 (serializeForProvider)
 * 3. 검증 → 정제 → 충돌 해결 → 직렬화 순서 엄격 준수
 * 4. Provider별 capability에 따라 직렬화 전략 분기
 */

import type { Cut, VeoGenerationConfig, StructuredSequenceDocument } from "@/types";
import { collectFailureModeNegatives, getGenreTemplate } from "@/lib/prompt-architecture";
import { getStyleById, getStyleByLegacyMode } from "@/data/style-catalog";
import { videoPromptJsonToShotPlan } from "@/lib/sequence-plan";
import { runSanitizePipeline } from "@/lib/prompt-sanitizer";
import { validateFinalProviderPayload, autoFixPayload } from "@/lib/final-payload-validator";
import { normalizeSequence } from "@/lib/sequence-normalizer";

// ═══════════════════════════════════════════════════════════════════
// 1. Provider Capability Abstraction
// ═══════════════════════════════════════════════════════════════════

export interface ProviderCapability {
  id: "veo" | "kling";
  /**
   * Provider가 structured JSON payload를 직접 이해하는지 여부.
   *
   * false = provider가 string prompt만 받을 수 있음.
   *         그러나 이것은 데이터 모델의 문제가 아니라 serialize 타이밍의 문제.
   *         source of truth는 언제나 StructuredSequenceDocument이며,
   *         false일 때는 마지막 전송 직전에 renderSequenceForProvider()로 직렬화할 뿐.
   */
  acceptsStructuredPayload: boolean;
  /**
   * supportsStructuredSequence = true → structuredSequence를 JSON 그대로 전달
   * false → 마지막 단계에서만 serializeSequenceForProvider(sequence) 호출
   * serialize 결과는 source of truth가 아니며, debug preview 용으로만 사용
   */
  supportsStructuredSequence: boolean;
  supportsNegativePrompt: boolean;
  supportsShotMetadata: boolean;
  maxPromptWords: number;
  defaultAudio: boolean;
}

export const PROVIDER_CAPABILITIES: Record<string, ProviderCapability> = {
  veo: {
    id: "veo",
    acceptsStructuredPayload: false, // string-only → 전송 직전 serialize
    supportsStructuredSequence: false, // string-only → serializeSequenceForProvider() 호출
    supportsNegativePrompt: false,
    supportsShotMetadata: false,
    maxPromptWords: 250,
    defaultAudio: true,
  },
  kling: {
    id: "kling",
    acceptsStructuredPayload: false, // string-only → 전송 직전 serialize
    supportsStructuredSequence: false, // string-only → serializeSequenceForProvider() 호출
    supportsNegativePrompt: true,
    supportsShotMetadata: false,
    maxPromptWords: 300,
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
  config: VeoGenerationConfig;
  prevCut?: Cut;
}

function parseTimingBeats(timingBeat?: string, durationSec: number = 8): TimingBeat[] {
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
  "subject-focused composition", "natural diegetic sound", "ambient audio",
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
  const dur = config.durationSeconds || 8;

  const styleEntry = getStyleById(config.animationMode || "") ?? getStyleByLegacyMode(config.animationMode || "");
  const styleId = styleEntry?.id || config.animationMode || "live-action";
  const styleLabel = styleEntry?.positivePrompt || config.animationMode || "";

  const isEnv = isEnvironmentScene(cut.shotCategory);

  // Camera: environment 씬이면 공통 규칙 적용
  let framing = isEnv ? "WS" : (json?.shotSize || "MS");
  let angle = isEnv ? (json?.cameraAngle || "overhead") : (json?.cameraAngle || "eye-level");
  let motion = json?.cameraMovement || cut.cameraDirection || "slow push-in";

  if (isEnv) {
    const cam = enforceEnvironmentCamera({
      framing, angle, motion, explicitAngle: json?.cameraAngle || undefined,
    });
    framing = cam.framing;
    angle = cam.angle;
    motion = cam.motion;
  }

  const primarySubject = json?.subjectAction || cut.sceneDescription;
  const characterRef = json?.characterRef || cut.characterConsistency || undefined;

  const beats = parseTimingBeats(json?.timingBeat, dur);

  const universalNeg = ["text overlay", "watermark", "subtitle", "logo", "blurry", "low quality", "distorted"];
  const sceneNeg = getGenreTemplate(cut.shotCategory)?.commonNegatives || [];
  const failureNeg = collectFailureModeNegatives(cut.videoPrompt || cut.sceneDescription);
  const userNeg = config.negativePrompt
    ? config.negativePrompt.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  // Environment: 추가 negative 강화 (공통 헬퍼)
  const finalUniversalNeg = isEnv ? enrichEnvironmentNegatives(universalNeg) : universalNeg;

  const continuitySubject = prevCut?.videoPromptJson?.subjectAction || prevCut?.sceneDescription || primarySubject;
  const continuityCharRef = prevCut?.characterConsistency || characterRef;
  const continuityEnv = prevCut?.videoPromptJson?.locationCue || cut.sceneDescription.slice(0, 80);
  const continuityLight = prevCut?.moodLighting || json?.moodLighting || cut.moodLighting || "";

  const styleSuffix = json?.styleSuffix || styleLabel.split(". ").slice(0, 1).join(". ");

  let mediumLock: string | undefined;
  if (cut.shotCategory === "map-graphic") {
    mediumLock = "physical map surface — not a landscape, not a 3D render, not a CGI scene";
  }

  // Environment: globalStyle에 positive 키워드 보장 (공통 헬퍼)
  const globalStyle = isEnv ? enrichEnvironmentPositives(styleLabel) : styleLabel;

  return {
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
      ambient: "natural diegetic sound, ambient audio",
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
      environment: json?.locationCue || cut.sceneDescription.slice(0, 80),
      moodLighting: json?.moodLighting || cut.moodLighting || "",
    },

    subject: {
      primary: primarySubject,
      action: json?.subjectAction || "",
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
      sceneSpecific: [...new Set(sceneNeg)],
      failureMode: [...new Set(failureNeg)],
      user: userNeg,
    },

    audio: {
      hint: "Diegetic ambient sound",
    },
  };
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

    // Rule 12: Environment — positive/negative conflict check
    const posText = doc.global.style.toLowerCase();
    const allNegLower = [...doc.negatives.universal, ...doc.negatives.sceneSpecific].map(n => n.toLowerCase());
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
  for (const layer of ["universal", "sceneSpecific", "failureMode", "user"] as const) {
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

  // Resolution 3: Deduplicate negatives across layers
  const allNeg = [
    ...result.negatives.universal,
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
 * 13. Negatives (Veo=embed, Kling=separate)
 */
export function serializeForProvider(
  doc: SingleShotDocument,
  provider: "veo" | "kling" = "veo",
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

  // 3. Location/situation cues
  if (doc.scene.locationCue) {
    parts.push(doc.scene.locationCue);
    sections.locationCue = doc.scene.locationCue;
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

  // 9. Style suffix (light — first sentence only)
  if (doc.reinforcement.styleSuffix) {
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

  // 12. No text guard
  parts.push("No text overlay, no watermark");
  sections.noText = "No text overlay, no watermark";

  // Build prompt
  let prompt = parts.filter(Boolean).join(". ");

  // 13. Negatives
  const allNeg = [
    ...doc.negatives.universal,
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
  // 15. Final Payload Validation (마지막 게이트)
  // ═══════════════════════════════════════════════════════════════
  const validation = validateFinalProviderPayload({
    prompt,
    negatives: uniqueNeg,
    framing: sanitized.framing,
    shotCategory: doc.scene.shotCategory,
    provider,
  });
  if (!validation.valid && validation.autoFixable) {
    const fixed = autoFixPayload({
      prompt,
      negatives: uniqueNeg,
      framing: sanitized.framing,
      shotCategory: doc.scene.shotCategory,
      provider,
    });
    prompt = fixed.prompt;
    uniqueNeg = fixed.negatives;
    if (fixed.fixes.length > 0) {
      sections._autoFixes = fixed.fixes.join(" | ");
    }
  }
  if (validation.issues.length > 0) {
    sections._validationIssues = validation.issues.map(i => `[${i.severity}] ${i.message}`).join(" | ");
  }

  // Word cap
  let truncated = false;
  const words = prompt.split(/\s+/);
  if (words.length > cap.maxPromptWords) {
    prompt = words.slice(0, cap.maxPromptWords - 5).join(" ");
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
  /** 디버그 전용 프리뷰 — source of truth 아님, 저장/전송 금지 */
  preview?: {
    renderedPrompt: string;
    renderedNegative: string;
    wordCount: number;
    sections: Record<string, string>;
    truncated: boolean;
    isMapScene: boolean;
    isEnvironmentScene: boolean;
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
  config: VeoGenerationConfig;
  prevCut?: Cut;
}): AssembleFromJSONResult {
  const provider = (input.config.engine === "kling" ? "kling" : "veo") as "veo" | "kling";

  // Step 1: Build JSON document
  const rawDoc = buildShotDocument(input);

  // Pipeline trace — raw snapshot
  const rawSnapshot = {
    framing: rawDoc.camera.framing,
    motion: rawDoc.camera.motion,
    shotCategory: rawDoc.scene.shotCategory,
    negativeCount: rawDoc.negatives.universal.length + rawDoc.negatives.sceneSpecific.length + rawDoc.negatives.failureMode.length + rawDoc.negatives.user.length,
  };

  // Step 2: Validate
  const validation = validateShotDocument(rawDoc);

  // Step 3: Sanitize
  const { doc: sanitizedDoc, fixes: sanitizeFixes } = sanitizeShotDocument(rawDoc);

  // Step 4: Resolve conflicts
  const { doc: resolvedDoc, resolutions: conflictResolutions } = resolveConflicts(sanitizedDoc);

  // Step 5: Normalize (전역 정규화 — sceneType 추론, characterRef 정리, 과부하 감지, coverage 보강)
  const normalized = normalizeSequence(resolvedDoc);
  const normalizedDoc = normalized.doc;
  const normalizeLog = normalized.log;
  const normalizeWarnings = normalized.warnings;

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
    ...normalizedDoc.negatives.sceneSpecific,
    ...normalizedDoc.negatives.failureMode,
    ...normalizedDoc.negatives.user,
  ];

  // Build StructuredSequenceDocument — 유일한 1급 산출물
  const shotPlan = input.cut.videoPromptJson
    ? videoPromptJsonToShotPlan(
        input.cut.videoPromptJson,
        input.cut.cutNumber - 1,
        input.config.durationSeconds || 8,
        0,
        { shotCategory: input.cut.shotCategory, characterRole: input.cut.characterRole },
      )
    : {
        shotId: `shot_${input.cut.cutNumber}`,
        startSec: 0,
        endSec: input.config.durationSeconds || 8,
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
    shotId: `shot_${input.cut.cutNumber}`,
    cutNumber: input.cut.cutNumber,
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

  // Preview — 디버그 전용. source of truth 아님.
  // 이 값은 저장하거나 body에 넣으면 안 된다.
  const serializedPreview = serializeForProvider(normalizedDoc, provider);

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
      wordCount: serializedPreview.wordCount,
      truncated: serializedPreview.debug.truncated,
      validationIssues: serializedPreview.debug.sections._validationIssues
        ? serializedPreview.debug.sections._validationIssues.split(" | ").length
        : 0,
    },
  };

  return {
    structuredSequence,
    document: normalizedDoc,
    diagnostics: {
      validation,
      sanitizeFixes: [...sanitizeFixes, ...normalizeLog],
      conflictResolutions: [...conflictResolutions, ...normalizeWarnings],
      driftWarning,
    },
    pipelineTrace,
    preview: {
      renderedPrompt: serializedPreview.prompt,
      renderedNegative: serializedPreview.negativePrompt,
      wordCount: serializedPreview.wordCount,
      sections: serializedPreview.debug.sections,
      truncated: serializedPreview.debug.truncated,
      isMapScene: normalizedDoc.scene.shotCategory === "map-graphic",
      isEnvironmentScene: normalizedDoc.scene.shotCategory === "environment",
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
  provider: "veo" | "kling",
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

  // Audio + no text
  parts.push("Diegetic ambient sound");
  parts.push("No text overlay, no watermark");

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
