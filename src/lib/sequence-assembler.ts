/**
 * sequence-assembler.ts — JSON-first 프롬프트 조립 엔진
 *
 * 핵심 원칙:
 * 1. 모든 프롬프트 데이터를 JSON(SingleShotDocument)으로 관리
 * 2. String 조합은 최종 provider 전송 직전에만 수행 (serializeForProvider)
 * 3. 검증 → 정제 → 충돌 해결 → 직렬화 순서 엄격 준수
 * 4. Provider별 capability에 따라 직렬화 전략 분기
 */

import type { Cut, VeoGenerationConfig } from "@/types";
import { collectFailureModeNegatives, getGenreTemplate } from "@/lib/prompt-architecture";
import { getStyleById, getStyleByLegacyMode } from "@/data/style-catalog";

// ═══════════════════════════════════════════════════════════════════
// 1. Provider Capability Abstraction
// ═══════════════════════════════════════════════════════════════════

export interface ProviderCapability {
  id: "veo" | "kling";
  supportsStructuredSequence: boolean;
  supportsNegativePrompt: boolean;
  supportsShotMetadata: boolean;
  maxPromptWords: number;
  defaultAudio: boolean;
}

export const PROVIDER_CAPABILITIES: Record<string, ProviderCapability> = {
  veo: {
    id: "veo",
    supportsStructuredSequence: false,
    supportsNegativePrompt: false,
    supportsShotMetadata: false,
    maxPromptWords: 250,
    defaultAudio: true,
  },
  kling: {
    id: "kling",
    supportsStructuredSequence: false,
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

export function buildShotDocument(input: BuildShotDocumentInput): SingleShotDocument {
  const { cut, config, prevCut } = input;
  const json = cut.videoPromptJson;
  const dur = config.durationSeconds || 8;

  const styleEntry = getStyleById(config.animationMode || "") ?? getStyleByLegacyMode(config.animationMode || "");
  const styleId = styleEntry?.id || config.animationMode || "live-action";
  const styleLabel = styleEntry?.positivePrompt || config.animationMode || "";

  const framing = json?.shotSize || "MS";
  const angle = json?.cameraAngle || "eye-level";
  const motion = json?.cameraMovement || cut.cameraDirection || "slow push-in";

  const primarySubject = json?.subjectAction || cut.sceneDescription;
  const characterRef = json?.characterRef || cut.characterConsistency || undefined;

  const beats = parseTimingBeats(json?.timingBeat, dur);

  const universalNeg = ["text overlay", "watermark", "subtitle", "logo", "blurry", "low quality", "distorted"];
  const sceneNeg = getGenreTemplate(cut.shotCategory)?.commonNegatives || [];
  const failureNeg = collectFailureModeNegatives(cut.videoPrompt || cut.sceneDescription);
  const userNeg = config.negativePrompt
    ? config.negativePrompt.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  const continuitySubject = prevCut?.videoPromptJson?.subjectAction || prevCut?.sceneDescription || primarySubject;
  const continuityCharRef = prevCut?.characterConsistency || characterRef;
  const continuityEnv = prevCut?.videoPromptJson?.locationCue || cut.sceneDescription.slice(0, 80);
  const continuityLight = prevCut?.moodLighting || json?.moodLighting || cut.moodLighting || "";

  const styleSuffix = json?.styleSuffix || styleLabel.split(". ").slice(0, 1).join(". ");

  let mediumLock: string | undefined;
  if (cut.shotCategory === "map-graphic") {
    mediumLock = "physical map surface — not a landscape, not a 3D render, not a CGI scene";
  }

  return {
    shotId: `shot_${cut.cutNumber}`,
    cutNumber: cut.cutNumber,

    global: {
      style: styleLabel,
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
      universal: universalNeg,
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

  // Fix 3: Remove positive/negative conflicts
  const positiveText = `${result.global.style} ${result.reinforcement.styleSuffix}`.toLowerCase();
  const filterConflicts = (negArr: string[]) => {
    return negArr.filter(neg => {
      if (neg.length > 4 && positiveText.includes(neg.toLowerCase())) {
        fixes.push(`Removed conflicting negative "${neg}" (present in positive style)`);
        return false;
      }
      return true;
    });
  };
  result.negatives.failureMode = filterConflicts(result.negatives.failureMode);
  result.negatives.sceneSpecific = filterConflicts(result.negatives.sceneSpecific);

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
  const uniqueNeg = [...new Set(allNeg)].slice(0, 30);
  const negStr = uniqueNeg.join(", ");

  if (!cap.supportsNegativePrompt && uniqueNeg.length > 0) {
    prompt += `. Avoid: ${negStr}`;
    sections.negatives_embedded = negStr;
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

export interface AssembleFromJSONResult {
  prompt: string;
  negativePrompt: string;
  document: SingleShotDocument;
  validation: ValidationResult;
  sanitizeFixes: string[];
  conflictResolutions: string[];
  serializationDebug: SerializedShot["debug"];
  wordCount: number;
  driftWarning?: string;
  assembledDebug: {
    styleBlock: string;
    consistencyBlock: string;
    cameraBlock: string;
    sceneBlock: string;
    reinforcementBlock: string;
    negativeBlock: string;
    isMapScene: boolean;
  };
}

/**
 * JSON-first 프롬프트 조립 메인 파이프라인.
 * Build JSON -> Validate -> Sanitize -> Resolve Conflicts -> Serialize
 */
export function assembleFromJSON(input: {
  cut: Cut;
  config: VeoGenerationConfig;
  prevCut?: Cut;
}): AssembleFromJSONResult {
  const provider = (input.config.engine === "kling" ? "kling" : "veo") as "veo" | "kling";

  // Step 1: Build JSON document
  const rawDoc = buildShotDocument(input);

  // Step 2: Validate
  const validation = validateShotDocument(rawDoc);

  // Step 3: Sanitize
  const { doc: sanitizedDoc, fixes: sanitizeFixes } = sanitizeShotDocument(rawDoc);

  // Step 4: Resolve conflicts
  const { doc: resolvedDoc, resolutions: conflictResolutions } = resolveConflicts(sanitizedDoc);

  // Step 5: Serialize
  const serialized = serializeForProvider(resolvedDoc, provider);

  // Drift warning
  let driftWarning: string | undefined;
  const errors = validation.issues.filter(i => i.severity === "error");
  if (errors.length >= 3) {
    driftWarning = `HIGH RISK (${errors.length} errors): ${errors.map(e => e.message).join("; ")}`;
  }

  const allNeg = [
    ...resolvedDoc.negatives.universal,
    ...resolvedDoc.negatives.sceneSpecific,
    ...resolvedDoc.negatives.failureMode,
    ...resolvedDoc.negatives.user,
  ];

  return {
    prompt: serialized.prompt,
    negativePrompt: serialized.negativePrompt,
    document: resolvedDoc,
    validation,
    sanitizeFixes,
    conflictResolutions,
    serializationDebug: serialized.debug,
    wordCount: serialized.wordCount,
    driftWarning,
    assembledDebug: {
      styleBlock: resolvedDoc.reinforcement.styleSuffix,
      consistencyBlock: resolvedDoc.continuity.characterRef || "",
      cameraBlock: buildCameraLine(resolvedDoc),
      sceneBlock: resolvedDoc.subject.primary.slice(0, 200),
      reinforcementBlock: resolvedDoc.reinforcement.mediumLock || "",
      negativeBlock: [...new Set(allNeg)].slice(0, 30).join(", "),
      isMapScene: resolvedDoc.scene.shotCategory === "map-graphic",
    },
  };
}
