/**
 * _sequence-plan.ts — 서버사이드 시퀀스 플랜 빌더 (경량)
 *
 * generate-cuts.ts에서 사용.
 * src/lib/sequence-plan.ts의 핵심 타입 + 빌더 + 검증만 포함.
 * (서버 환경에서 @/lib import 불가하므로 별도 유지)
 */

import type { VideoPromptJson } from "./_video-prompt-json";

// ═══════════════════════════════════════════════════════════════════
// Types (클라이언트와 동일 구조)
// ═══════════════════════════════════════════════════════════════════

export interface SequenceGlobalIntent {
  sceneType: "cinematic_sequence" | "montage" | "single_take" | "dialogue" | "action" | "transition";
  styleId: string;
  style?: string;
  medium?: string;
  durationSec: number;
  aspectRatio: "16:9" | "9:16";
  directorId?: string;
}

export interface SequenceContinuity {
  primarySubject: string;
  subjectAttributes?: string;
  environment: string;
  era?: string;
  lightingDirection: string;
  colorAnchors: string[];
  mustPersist: string[];
  mustAvoid: string[];
}

export interface ShotCamera {
  framing: string;
  angle: string;
  motion: string;
  motionMotivation?: string;
}

export interface ShotSubject {
  primary: string;
  secondary?: string[];
  characterRef?: string;
  blocking?: string;
}

export interface ShotPlan {
  shotId: string;
  startSec: number;
  endSec: number;
  shotType: string;
  camera: ShotCamera;
  subject: ShotSubject;
  environment: string;
  action: string;
  timingBeat?: string;
  visualDirectives: string[];
  negativeDirectives: string[];
  visualMedium?: string;
  moodLighting: string;
  transitionFromPrev?: string;
  shotCategory?: string;
  characterRole?: string;
  locationCue?: string;
  situationCue?: string;
  emotionalAnchor?: string;
}

export interface SequencePlan {
  sequenceId: string;
  globalIntent: SequenceGlobalIntent;
  continuity: SequenceContinuity;
  shots: ShotPlan[];
  createdAt: number;
  cutToShotMap?: Record<number, string[]>;
}

export interface SequenceValidationIssue {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  shotId?: string;
}

export interface SequenceValidationResult {
  valid: boolean;
  issues: SequenceValidationIssue[];
  summary: { errors: number; warnings: number; infos: number };
}

// ═══════════════════════════════════════════════════════════════════
// 서버용 Cut 인터페이스 (generate-cuts.ts 출력과 매칭)
// ═══════════════════════════════════════════════════════════════════

interface ServerCut {
  cutNumber: number;
  durationSec: number;
  sceneDescription: string;
  cameraDirection?: string;
  moodLighting?: string;
  characterConsistency?: string;
  charactersInScene?: string[];
  shotCategory?: string;
  characterRole?: string;
  transitionHint?: string;
  videoPromptJson?: VideoPromptJson;
}

// ═══════════════════════════════════════════════════════════════════
// Builder
// ═══════════════════════════════════════════════════════════════════

function normalizeFraming(raw?: string): string {
  const valid = ["ECU", "CU", "MCU", "MS", "MLS", "LS", "WS", "OTS", "POV"];
  const up = raw?.toUpperCase().trim() || "MS";
  if (valid.includes(up)) return up;
  // descriptive name → abbreviation (Gemini가 "Wide shot" 등 반환할 때)
  const descMap: Record<string, string> = {
    "EXTREME CLOSE-UP": "ECU", "EXTREME CLOSEUP": "ECU", "EXTREME CU": "ECU",
    "CLOSE-UP": "CU", "CLOSEUP": "CU", "CLOSE UP": "CU",
    "MEDIUM CLOSE-UP": "MCU", "MEDIUM CLOSEUP": "MCU", "MEDIUM CU": "MCU",
    "MEDIUM SHOT": "MS", "MEDIUM": "MS", "MID SHOT": "MS",
    "MEDIUM LONG SHOT": "MLS", "MEDIUM LONG": "MLS",
    "LONG SHOT": "LS", "LONG": "LS",
    "WIDE SHOT": "WS", "WIDE": "WS", "ESTABLISHING": "WS", "ESTABLISHING SHOT": "WS",
    "OVER-THE-SHOULDER": "OTS", "OVER THE SHOULDER": "OTS",
    "POINT-OF-VIEW": "POV", "POINT OF VIEW": "POV",
  };
  return descMap[up] || "MS";
}

function normalizeAngle(raw?: string): string {
  const n = raw?.toLowerCase().replace(/[-\s]+/g, "_") || "eye_level";
  const map: Record<string, string> = {
    eye_level: "eye_level", low_angle: "low_angle", high_angle: "high_angle",
    dutch: "dutch", overhead: "overhead", pov: "POV",
    slightly_low: "low_angle", slightly_high: "high_angle",
    bird_s_eye: "overhead", birds_eye: "overhead", top_down: "overhead",
    worm_s_eye: "low_angle", worms_eye: "low_angle",
    canted: "dutch", tilted: "dutch", level: "eye_level",
  };
  return map[n] || "eye_level";
}

function mapShotType(framing: string, category?: string): string {
  if (category === "transition-atmosphere") return "transition";
  const map: Record<string, string> = {
    WS: "wide_establishing", LS: "wide_establishing",
    MS: "medium_action", MLS: "medium_action", MCU: "medium_action",
    CU: "close_detail", ECU: "close_detail",
    OTS: "over_shoulder", POV: "pov_subjective",
  };
  return map[framing?.toUpperCase()] || "medium_action";
}

function extractMotivation(movement?: string): string | undefined {
  if (!movement) return undefined;
  const match = movement.match(/\(([^)]+)\)/);
  return match ? match[1] : undefined;
}

/** 3D/CGI drift 방지 negatives */
const MAP_MEDIUM_LOCK_NEGATIVES = [
  "no real landscape", "no CGI terrain", "no 3D rendered globe",
  "no satellite photo", "no game-map look", "no miniature model",
  "no diorama", "no plastic surface", "no fantasy illustration",
  "no 3D render", "no CGI", "no glossy render",
];

export function buildSequencePlanFromCuts(
  cuts: ServerCut[],
  opts: { styleId?: string; style?: string; medium?: string; aspectRatio?: "16:9" | "9:16"; directorId?: string } = {},
): SequencePlan {
  const shots: ShotPlan[] = [];
  const cutToShotMap: Record<number, string[]> = {};
  let currentTime = 0;

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const json = cut.videoPromptJson;
    const dur = cut.durationSec && cut.durationSec > 0 ? cut.durationSec : 8;
    const shotId = `shot_${i + 1}`;

    const negatives: string[] = [];
    if (cut.shotCategory === "map-graphic") {
      negatives.push("no 3D globe", "no landscape painting", "no readable text");
      negatives.push(...MAP_MEDIUM_LOCK_NEGATIVES);
    }
    if (cut.shotCategory === "environment") negatives.push("no text overlay", "no UI element");
    if (cut.shotCategory === "character-driven") negatives.push("no deformed face", "no extra limbs");

    // cinematic realism + terrain/map → 3D/CGI drift 차단
    const promptText = (cut.sceneDescription || "") + " " + (cut.videoPromptJson?.styleSuffix || "");
    if (/cinematic\s*realism/i.test(promptText) && /\b(3D|topograph|terrain|map|relief|globe)\b/i.test(promptText)) {
      negatives.push(...MAP_MEDIUM_LOCK_NEGATIVES.filter(n => !negatives.includes(n)));
    }

    const shot: ShotPlan = json ? {
      shotId,
      startSec: currentTime,
      endSec: currentTime + dur,
      shotType: mapShotType(json.shotSize, cut.shotCategory),
      camera: {
        framing: normalizeFraming(json.shotSize),
        angle: normalizeAngle(json.cameraAngle),
        motion: json.cameraMovement || "static",
        motionMotivation: extractMotivation(json.cameraMovement),
      },
      subject: {
        primary: json.subjectAction || cut.sceneDescription,
        secondary: cut.charactersInScene?.filter(Boolean),
        characterRef: json.characterRef || undefined,
        blocking: json.subjectBlocking || undefined,
      },
      environment: json.locationCue || cut.sceneDescription.slice(0, 80),
      action: json.subjectAction || "",
      timingBeat: json.timingBeat || undefined,
      visualDirectives: [
        json.bodySignal ? `body: ${json.bodySignal}` : "",
        json.locationCue ? `location: ${json.locationCue}` : "",
        json.situationCue ? `situation: ${json.situationCue}` : "",
        json.emotionalAnchor ? `emotion: ${json.emotionalAnchor}` : "",
      ].filter(Boolean),
      negativeDirectives: negatives,
      moodLighting: json.moodLighting || cut.moodLighting || "",
      transitionFromPrev: json.transitionFromPrev || cut.transitionHint || undefined,
      shotCategory: cut.shotCategory,
      characterRole: cut.characterRole,
      locationCue: json.locationCue,
      situationCue: json.situationCue,
      emotionalAnchor: json.emotionalAnchor,
    } : {
      shotId,
      startSec: currentTime,
      endSec: currentTime + dur,
      shotType: mapShotType("MS", cut.shotCategory),
      camera: { framing: "MS", angle: "eye_level", motion: cut.cameraDirection || "static" },
      subject: {
        primary: cut.sceneDescription,
        secondary: cut.charactersInScene?.filter(Boolean),
        characterRef: cut.characterConsistency || undefined,
      },
      environment: cut.sceneDescription.slice(0, 80),
      action: "",
      visualDirectives: [],
      negativeDirectives: negatives,
      moodLighting: cut.moodLighting || "",
      transitionFromPrev: cut.transitionHint || undefined,
      shotCategory: cut.shotCategory,
      characterRole: cut.characterRole,
    };

    shots.push(shot);
    cutToShotMap[cut.cutNumber] = [shotId];
    currentTime += dur;
  }

  // Continuity
  const firstShot = shots[0];
  const subjectAttrs = cuts[0]?.videoPromptJson?.characterRef || cuts[0]?.characterConsistency || "";
  const mustAvoid = [...new Set(shots.flatMap(s => s.negativeDirectives))];

  // Scene type inference
  const categories = cuts.map(c => c.shotCategory).filter(Boolean);
  const charDriven = categories.filter(c => c === "character-driven").length;
  let sceneType: SequenceGlobalIntent["sceneType"] = "cinematic_sequence";
  if (cuts.length === 1) sceneType = "single_take";
  else if (charDriven >= cuts.length * 0.6) sceneType = "dialogue";
  else if (categories.filter(c => c === "transition-atmosphere").length >= cuts.length * 0.5) sceneType = "montage";

  return {
    sequenceId: `seq_${Date.now().toString(36)}`,
    globalIntent: {
      sceneType,
      styleId: opts.styleId || "live-action",
      style: opts.style,
      medium: opts.medium,
      durationSec: currentTime,
      aspectRatio: opts.aspectRatio || "16:9",
      directorId: opts.directorId,
    },
    continuity: {
      primarySubject: firstShot?.subject.primary || "",
      subjectAttributes: subjectAttrs || undefined,
      environment: firstShot?.environment || "",
      lightingDirection: firstShot?.moodLighting || "",
      colorAnchors: [],
      mustPersist: [subjectAttrs, firstShot?.environment || ""].filter(Boolean),
      mustAvoid,
    },
    shots,
    createdAt: Date.now(),
    cutToShotMap,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Validation (경량 — 핵심 5개 규칙)
// ═══════════════════════════════════════════════════════════════════

export function validateSequencePlan(plan: SequencePlan): SequenceValidationResult {
  const issues: SequenceValidationIssue[] = [];

  // R1: timing total
  const shotsTotal = plan.shots.reduce((sum, s) => sum + (s.endSec - s.startSec), 0);
  if (Math.abs(shotsTotal - plan.globalIntent.durationSec) > 0.1) {
    issues.push({ rule: "timing_total", severity: "error", message: `Shot 합계(${shotsTotal}s) ≠ 전체(${plan.globalIntent.durationSec}s)` });
  }

  // R2: overlap
  for (let i = 1; i < plan.shots.length; i++) {
    if (plan.shots[i].startSec < plan.shots[i - 1].endSec - 0.01) {
      issues.push({ rule: "timing_overlap", severity: "error", message: `${plan.shots[i - 1].shotId}~${plan.shots[i].shotId} 겹침`, shotId: plan.shots[i].shotId });
    }
  }

  // R3: subject
  for (const shot of plan.shots) {
    if (!shot.subject.primary || shot.subject.primary.trim().length < 3) {
      issues.push({ rule: "subject_missing", severity: "error", message: `${shot.shotId}: primary subject 없음`, shotId: shot.shotId });
    }
  }

  // R4: camera
  for (const shot of plan.shots) {
    if (!shot.camera.framing) {
      issues.push({ rule: "camera_missing", severity: "error", message: `${shot.shotId}: camera framing 없음`, shotId: shot.shotId });
    }
  }

  // R5: timing gap (shots 사이 빈 구간)
  for (let i = 1; i < plan.shots.length; i++) {
    const gap = plan.shots[i].startSec - plan.shots[i - 1].endSec;
    if (gap > 0.1) {
      issues.push({ rule: "timing_gap", severity: "warning", message: `${plan.shots[i - 1].shotId}~${plan.shots[i].shotId} 사이 ${gap.toFixed(1)}s 빈 구간`, shotId: plan.shots[i].shotId });
    }
  }

  // R6: negative directives missing (hallucination 위험)
  for (const shot of plan.shots) {
    if (!shot.negativeDirectives || shot.negativeDirectives.length === 0) {
      issues.push({ rule: "negative_missing", severity: "warning", message: `${shot.shotId}: negative directives 없음 (hallucination 위험)`, shotId: shot.shotId });
    }
  }

  // R7: abrupt transition (WS→ECU 등 4단계 이상 점프)
  const ORDER = ["WS", "LS", "MLS", "MS", "MCU", "CU", "ECU"];
  for (let i = 1; i < plan.shots.length; i++) {
    const pi = ORDER.indexOf(plan.shots[i - 1].camera.framing);
    const ci = ORDER.indexOf(plan.shots[i].camera.framing);
    if (pi >= 0 && ci >= 0 && Math.abs(ci - pi) >= 4) {
      issues.push({ rule: "abrupt_transition", severity: "warning", message: `${plan.shots[i - 1].camera.framing}→${plan.shots[i].camera.framing} 급격`, shotId: plan.shots[i].shotId });
    }
  }

  // R8: camera motion in action text (카메라 동작이 action 필드에 묻혀있으면 경고)
  for (const shot of plan.shots) {
    const actionText = (shot.subject.primary || "") + " " + (shot.action || "");
    if (/\b(pan|tilt|dolly|crane|zoom|push.?in|pull.?back|tracking)\b/i.test(actionText) && (!shot.camera.motion || shot.camera.motion === "static")) {
      issues.push({ rule: "camera_in_action_text", severity: "warning", message: `${shot.shotId}: 카메라 동작이 action 필드에 포함 — camera.motion으로 분리 필요`, shotId: shot.shotId });
    }
  }

  // R9a: zero-duration shot 검출
  for (const shot of plan.shots) {
    if (shot.endSec <= shot.startSec) {
      issues.push({ rule: "timing_zero_duration", severity: "error", message: `${shot.shotId}: duration ≤ 0 (${shot.startSec}s→${shot.endSec}s)`, shotId: shot.shotId });
    }
  }

  // R9: moodLighting / action 필드 누락
  for (const shot of plan.shots) {
    if (!shot.moodLighting || shot.moodLighting.trim().length < 5) {
      issues.push({ rule: "payload_field_missing", severity: "warning", message: `${shot.shotId}: moodLighting 누락/불충분`, shotId: shot.shotId });
    }
    if (!shot.environment || shot.environment.trim().length < 3) {
      issues.push({ rule: "payload_field_missing", severity: "info", message: `${shot.shotId}: environment 누락`, shotId: shot.shotId });
    }
  }

  const errors = issues.filter(i => i.severity === "error").length;
  const warnings = issues.filter(i => i.severity === "warning").length;
  const infos = issues.filter(i => i.severity === "info").length;

  return { valid: errors === 0, issues, summary: { errors, warnings, infos } };
}
