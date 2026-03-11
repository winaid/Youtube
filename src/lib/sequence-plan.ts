/**
 * sequence-plan.ts — 시퀀스 기반 영상 생성 아키텍처
 *
 * 하나의 영상 = 여러 shot/beat/camera transition으로 이루어진 "sequence"
 * 이 모듈은 시퀀스를 JSON으로 명확히 표현하고,
 * 각 shot의 camera/subject/action/timing/continuity를 분리 전달한다.
 *
 * 핵심 원칙:
 * - 카메라 변화 자체는 문제 아님 → shot plan으로 명시되는 것이 중요
 * - prompt 문자열 하나에 모든 걸 몰아넣지 않기
 * - 생성 전 validation으로 모순 검출
 * - 생성 후 fidelity 평가 가능
 */

import type { VideoPromptJson, ExtendPromptJson, Cut } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// 1. SequencePlan JSON Schema
// ═══════════════════════════════════════════════════════════════════

/** 시퀀스 전역 의도 */
export interface SequenceGlobalIntent {
  /** 씬 유형 */
  sceneType: "cinematic_sequence" | "montage" | "single_take" | "dialogue" | "action" | "transition";
  /** 스타일 ID (style-catalog 참조) */
  styleId: string;
  /** 전체 영상 길이 (초) */
  durationSec: number;
  /** 화면비 */
  aspectRatio: "16:9" | "9:16";
  /** 감독 페르소나 ID */
  directorId?: string;
}

/** 시퀀스 레벨 연속성 제약 */
export interface SequenceContinuity {
  /** 주요 피사체 (모든 shot에 걸쳐 일관) */
  primarySubject: string;
  /** 피사체 외형 속성 */
  subjectAttributes?: string;
  /** 환경/배경 */
  environment: string;
  /** 시대/배경 */
  era?: string;
  /** 광원 방향 */
  lightingDirection: string;
  /** 색감 앵커 */
  colorAnchors: string[];
  /** 반드시 유지해야 할 요소 */
  mustPersist: string[];
  /** 반드시 피해야 할 요소 */
  mustAvoid: string[];
}

/** 개별 shot의 카메라 정의 */
export interface ShotCamera {
  /** 프레이밍 */
  framing: "ECU" | "CU" | "MCU" | "MS" | "MLS" | "LS" | "WS" | "OTS" | "POV";
  /** 카메라 앵글 */
  angle: "eye_level" | "low_angle" | "high_angle" | "dutch" | "overhead" | "POV";
  /** 카메라 움직임 */
  motion: string;
  /** 움직임 동기 (왜 이렇게 움직이는가) */
  motionMotivation?: string;
}

/** 개별 shot의 피사체 정의 */
export interface ShotSubject {
  /** 주요 피사체 */
  primary: string;
  /** 보조 피사체 */
  secondary?: string[];
  /** 캐릭터 레퍼런스 (verbatim) */
  characterRef?: string;
  /** 피사체 프레임 내 위치 */
  blocking?: string;
}

/** 개별 shot 정의 */
export interface ShotPlan {
  /** shot 고유 ID */
  shotId: string;
  /** 시작 시간 (초) */
  startSec: number;
  /** 종료 시간 (초) */
  endSec: number;
  /** shot 유형 분류 */
  shotType: "wide_establishing" | "medium_action" | "close_detail" | "over_shoulder" | "pov_subjective" | "reaction" | "insert_cutaway" | "transition";
  /** 카메라 정의 */
  camera: ShotCamera;
  /** 피사체 정의 */
  subject: ShotSubject;
  /** 환경/배경 */
  environment: string;
  /** 행동 (구체적 신체 동작) */
  action: string;
  /** 시간 비트 */
  timingBeat?: string;
  /** 시각 지시어 (해야 할 것) */
  visualDirectives: string[];
  /** 부정 지시어 (하지 말 것) */
  negativeDirectives: string[];
  /** 조명/무드 */
  moodLighting: string;
  /** 이전 shot과의 전환 */
  transitionFromPrev?: string;
  /** 씬 카테고리 */
  shotCategory?: string;
  /** 캐릭터 역할 */
  characterRole?: string;
  /** 즉시 인식 3-pillar */
  locationCue?: string;
  situationCue?: string;
  emotionalAnchor?: string;
}

/** 전체 시퀀스 플랜 */
export interface SequencePlan {
  /** 시퀀스 고유 ID */
  sequenceId: string;
  /** 전역 의도 */
  globalIntent: SequenceGlobalIntent;
  /** 연속성 제약 */
  continuity: SequenceContinuity;
  /** shot 리스트 (시간순) */
  shots: ShotPlan[];
  /** 생성 시각 */
  createdAt: number;
  /** 원본 Cut 인덱스 매핑 (cutNumber → shotId[]) */
  cutToShotMap?: Record<number, string[]>;
}

// ═══════════════════════════════════════════════════════════════════
// 2. SequencePlan 빌더 — Cut[] → SequencePlan
// ═══════════════════════════════════════════════════════════════════

/** Cut → ShotPlan 변환 */
function cutToShotPlan(cut: Cut, index: number): ShotPlan {
  const json = cut.videoPromptJson;
  const dur = cut.durationSec || 8;

  // VideoPromptJson이 있으면 구조화된 데이터 사용, 없으면 string fallback
  if (json) {
    return {
      shotId: `shot_${index + 1}`,
      startSec: 0, // 나중에 누적 계산
      endSec: dur,
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
      visualDirectives: buildVisualDirectives(json),
      negativeDirectives: buildNegativeDirectives(cut),
      moodLighting: json.moodLighting || cut.moodLighting || "",
      transitionFromPrev: json.transitionFromPrev || cut.transitionHint || undefined,
      shotCategory: cut.shotCategory,
      characterRole: cut.characterRole,
      locationCue: json.locationCue,
      situationCue: json.situationCue,
      emotionalAnchor: json.emotionalAnchor,
    };
  }

  // String fallback — 레거시 Cut에서 최선의 추출
  return {
    shotId: `shot_${index + 1}`,
    startSec: 0,
    endSec: dur,
    shotType: mapShotType("MS", cut.shotCategory),
    camera: {
      framing: "MS",
      angle: "eye_level",
      motion: cut.cameraDirection || "static",
    },
    subject: {
      primary: cut.sceneDescription,
      secondary: cut.charactersInScene?.filter(Boolean),
      characterRef: cut.characterConsistency || undefined,
    },
    environment: cut.sceneDescription.slice(0, 80),
    action: cut.videoPrompt?.slice(0, 60) || "",
    visualDirectives: [],
    negativeDirectives: [],
    moodLighting: cut.moodLighting || "",
    transitionFromPrev: cut.transitionHint || undefined,
    shotCategory: cut.shotCategory,
    characterRole: cut.characterRole,
  };
}

/** Cut[] → SequencePlan 생성 */
export function buildSequencePlan(
  cuts: Cut[],
  opts: {
    styleId?: string;
    aspectRatio?: "16:9" | "9:16";
    directorId?: string;
  } = {},
): SequencePlan {
  const shots: ShotPlan[] = [];
  const cutToShotMap: Record<number, string[]> = {};
  let currentTime = 0;

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const shot = cutToShotPlan(cut, i);

    // 시간 누적 배치
    shot.startSec = currentTime;
    shot.endSec = currentTime + (cut.durationSec || 8);
    currentTime = shot.endSec;

    shots.push(shot);
    cutToShotMap[cut.cutNumber] = [shot.shotId];
  }

  const totalDuration = currentTime;

  // 연속성 추출 — 첫 번째 shot 기반 + 공통 요소
  const continuity = extractSequenceContinuity(cuts, shots);

  return {
    sequenceId: `seq_${Date.now().toString(36)}`,
    globalIntent: {
      sceneType: inferSceneType(cuts),
      styleId: opts.styleId || "live-action",
      durationSec: totalDuration,
      aspectRatio: opts.aspectRatio || "16:9",
      directorId: opts.directorId,
    },
    continuity,
    shots,
    createdAt: Date.now(),
    cutToShotMap,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. 헬퍼 함수들
// ═══════════════════════════════════════════════════════════════════

function normalizeFraming(raw: string): ShotCamera["framing"] {
  const map: Record<string, ShotCamera["framing"]> = {
    ECU: "ECU", CU: "CU", MCU: "MCU", MS: "MS", MLS: "MLS",
    LS: "LS", WS: "WS", OTS: "OTS", POV: "POV",
  };
  return map[raw?.toUpperCase()] || "MS";
}

function normalizeAngle(raw: string): ShotCamera["angle"] {
  const normalized = raw?.toLowerCase().replace(/[-\s]+/g, "_") || "eye_level";
  const map: Record<string, ShotCamera["angle"]> = {
    eye_level: "eye_level", low_angle: "low_angle", high_angle: "high_angle",
    dutch: "dutch", overhead: "overhead", pov: "POV",
    "slightly_low": "low_angle", "slightly_high": "high_angle",
  };
  return map[normalized] || "eye_level";
}

function mapShotType(framing: string, category?: string): ShotPlan["shotType"] {
  if (category === "transition-atmosphere") return "transition";
  const map: Record<string, ShotPlan["shotType"]> = {
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

function buildVisualDirectives(json: VideoPromptJson): string[] {
  const directives: string[] = [];
  if (json.bodySignal) directives.push(`body: ${json.bodySignal}`);
  if (json.revealed) directives.push(`reveal: ${json.revealed}`);
  if (json.locationCue) directives.push(`location: ${json.locationCue}`);
  if (json.situationCue) directives.push(`situation: ${json.situationCue}`);
  if (json.emotionalAnchor) directives.push(`emotion: ${json.emotionalAnchor}`);
  return directives;
}

function buildNegativeDirectives(cut: Cut): string[] {
  const neg: string[] = [];
  // shotCategory별 기본 negative
  if (cut.shotCategory === "map-graphic") {
    neg.push("no 3D globe", "no landscape painting", "no readable text");
  }
  if (cut.shotCategory === "environment") {
    neg.push("no text overlay", "no UI element");
  }
  if (cut.shotCategory === "character-driven") {
    neg.push("no deformed face", "no extra limbs");
  }
  return neg;
}

function extractSequenceContinuity(cuts: Cut[], shots: ShotPlan[]): SequenceContinuity {
  // 첫 shot의 subject를 primary로
  const firstShot = shots[0];
  const primarySubject = firstShot?.subject.primary || "";

  // 공통 캐릭터 추출
  const allChars = cuts.flatMap(c => c.charactersInScene || []).filter(Boolean);
  const charCounts = new Map<string, number>();
  for (const ch of allChars) charCounts.set(ch, (charCounts.get(ch) || 0) + 1);

  // 가장 빈번한 캐릭터의 외형 정보
  const subjectAttrs = cuts[0]?.videoPromptJson?.characterRef || cuts[0]?.characterConsistency || "";

  // 환경 — 첫 shot 기준
  const environment = firstShot?.environment || "";

  // 조명 — 첫 shot 기준
  const lighting = firstShot?.moodLighting || "";

  // mustPersist — 캐릭터 외형, 환경 특징
  const mustPersist: string[] = [];
  if (subjectAttrs) mustPersist.push(subjectAttrs);
  if (environment) mustPersist.push(environment);

  // mustAvoid — 모든 shot의 negative 합집합
  const mustAvoid = [...new Set(shots.flatMap(s => s.negativeDirectives))];

  return {
    primarySubject,
    subjectAttributes: subjectAttrs || undefined,
    environment,
    lightingDirection: lighting,
    colorAnchors: [],
    mustPersist,
    mustAvoid,
  };
}

function inferSceneType(cuts: Cut[]): SequenceGlobalIntent["sceneType"] {
  if (cuts.length === 1) return "single_take";
  const categories = cuts.map(c => c.shotCategory).filter(Boolean);
  const charDriven = categories.filter(c => c === "character-driven").length;
  if (charDriven >= cuts.length * 0.6) return "dialogue";
  const transition = categories.filter(c => c === "transition-atmosphere").length;
  if (transition >= cuts.length * 0.5) return "montage";
  return "cinematic_sequence";
}

// ═══════════════════════════════════════════════════════════════════
// 4. JSON Validation — 10개 규칙
// ═══════════════════════════════════════════════════════════════════

export type ValidationSeverity = "error" | "warning" | "info";

export interface SequenceValidationIssue {
  rule: string;
  severity: ValidationSeverity;
  message: string;
  shotId?: string;
  field?: string;
}

export interface SequenceValidationResult {
  valid: boolean;
  issues: SequenceValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
}

/** 지원되는 camera motion (Veo + Kling 공통) */
const SUPPORTED_CAMERA_MOTIONS = [
  "static", "locked", "push-in", "pull-back", "dolly", "truck",
  "pan", "tilt", "crane", "boom", "orbit", "arc", "zoom",
  "handheld", "steadicam", "follow", "tracking", "whip",
  "slow push-in", "slow pull-back", "gentle pan", "subtle dolly",
  "slow zoom", "drift", "floating", "sweep", "reframing",
];

/** Shot framing 호환성 매트릭스: crowd 씬에서 ECU는 위험 */
const RISKY_COMBINATIONS: Array<{ condition: RegExp; framing: string[]; reason: string }> = [
  {
    condition: /\b(crowd|audience|group|masses|rally|protest|army|legion|horde|parade)\b/i,
    framing: ["ECU", "CU"],
    reason: "군중 장면에서 ECU/CU는 개별 인물 디테일을 요구하여 생성 실패 위험",
  },
  {
    condition: /\b(map|terrain|geography|atlas|topograph|satellite)\b/i,
    framing: ["ECU", "CU", "MCU"],
    reason: "지도/지형 씬에서 클로즈업은 맥락 손실 위험",
  },
];

export function validateSequencePlan(plan: SequencePlan): SequenceValidationResult {
  const issues: SequenceValidationIssue[] = [];

  // Rule 1: shot timing total == total duration
  const shotsTotal = plan.shots.reduce((sum, s) => sum + (s.endSec - s.startSec), 0);
  if (Math.abs(shotsTotal - plan.globalIntent.durationSec) > 0.1) {
    issues.push({
      rule: "timing_total",
      severity: "error",
      message: `Shot 합계(${shotsTotal}s) ≠ 전체 길이(${plan.globalIntent.durationSec}s)`,
    });
  }

  // Rule 2: shot overlap / gap 검사
  for (let i = 1; i < plan.shots.length; i++) {
    const prev = plan.shots[i - 1];
    const curr = plan.shots[i];
    if (curr.startSec < prev.endSec - 0.01) {
      issues.push({
        rule: "timing_overlap",
        severity: "error",
        message: `${prev.shotId}(~${prev.endSec}s)과 ${curr.shotId}(${curr.startSec}s~) 겹침`,
        shotId: curr.shotId,
      });
    }
    if (curr.startSec > prev.endSec + 0.01) {
      issues.push({
        rule: "timing_gap",
        severity: "warning",
        message: `${prev.shotId}(~${prev.endSec}s)과 ${curr.shotId}(${curr.startSec}s~) 사이 ${(curr.startSec - prev.endSec).toFixed(1)}s 공백`,
        shotId: curr.shotId,
      });
    }
  }

  // Rule 3: 각 shot에 primary subject 존재
  for (const shot of plan.shots) {
    if (!shot.subject.primary || shot.subject.primary.trim().length < 3) {
      issues.push({
        rule: "subject_missing",
        severity: "error",
        message: `${shot.shotId}: primary subject 없음 또는 너무 짧음`,
        shotId: shot.shotId,
        field: "subject.primary",
      });
    }
  }

  // Rule 4: 각 shot에 camera 정의 존재
  for (const shot of plan.shots) {
    if (!shot.camera.framing) {
      issues.push({
        rule: "camera_missing",
        severity: "error",
        message: `${shot.shotId}: camera framing 미정의`,
        shotId: shot.shotId,
        field: "camera.framing",
      });
    }
    // camera motion이 텍스트로만 묻혀있고 명시 필드가 없는 경우 = 구조 실패
    if (!shot.camera.motion && shot.action && /\b(camera|zoom|pan|tilt|dolly|track)\b/i.test(shot.action)) {
      issues.push({
        rule: "camera_in_action_text",
        severity: "warning",
        message: `${shot.shotId}: 카메라 정보가 action 텍스트에 묻혀있음 — camera.motion 필드로 분리 필요`,
        shotId: shot.shotId,
        field: "camera.motion",
      });
    }
  }

  // Rule 5: continuity.mustPersist와 각 shot 간 충돌
  for (const persist of plan.continuity.mustPersist) {
    if (!persist) continue;
    const persistLower = persist.toLowerCase();
    for (const shot of plan.shots) {
      for (const neg of shot.negativeDirectives) {
        if (neg.toLowerCase().includes(persistLower.slice(0, 10))) {
          issues.push({
            rule: "continuity_conflict",
            severity: "error",
            message: `${shot.shotId}: mustPersist "${persist}" 와 negative "${neg}" 충돌`,
            shotId: shot.shotId,
          });
        }
      }
    }
  }

  // Rule 6: negativeDirectives 누락
  for (const shot of plan.shots) {
    if (shot.negativeDirectives.length === 0) {
      issues.push({
        rule: "negative_missing",
        severity: "warning",
        message: `${shot.shotId}: negativeDirectives 없음 — 실패 패턴 차단 누락 가능성`,
        shotId: shot.shotId,
      });
    }
  }

  // Rule 7: shot transition이 너무 급격한 경우 (WS → ECU 직접 점프 등)
  const FRAMING_ORDER = ["WS", "LS", "MLS", "MS", "MCU", "CU", "ECU"];
  for (let i = 1; i < plan.shots.length; i++) {
    const prevIdx = FRAMING_ORDER.indexOf(plan.shots[i - 1].camera.framing);
    const currIdx = FRAMING_ORDER.indexOf(plan.shots[i].camera.framing);
    if (prevIdx >= 0 && currIdx >= 0 && Math.abs(currIdx - prevIdx) >= 4) {
      issues.push({
        rule: "abrupt_transition",
        severity: "warning",
        message: `${plan.shots[i - 1].shotId}(${plan.shots[i - 1].camera.framing}) → ${plan.shots[i].shotId}(${plan.shots[i].camera.framing}) 급격한 프레이밍 변화`,
        shotId: plan.shots[i].shotId,
      });
    }
  }

  // Rule 8: 군중 장면에서 close-up 디테일 요구 위험
  for (const shot of plan.shots) {
    const fullText = `${shot.subject.primary} ${shot.environment} ${shot.action}`;
    for (const risky of RISKY_COMBINATIONS) {
      if (risky.condition.test(fullText) && risky.framing.includes(shot.camera.framing)) {
        issues.push({
          rule: "risky_combination",
          severity: "warning",
          message: `${shot.shotId}: ${risky.reason}`,
          shotId: shot.shotId,
        });
      }
    }
  }

  // Rule 9: provider 미지원 camera motion 조합
  for (const shot of plan.shots) {
    if (shot.camera.motion && shot.camera.motion !== "static") {
      const motionLower = shot.camera.motion.toLowerCase();
      const isSupported = SUPPORTED_CAMERA_MOTIONS.some(m => motionLower.includes(m));
      if (!isSupported) {
        issues.push({
          rule: "unsupported_motion",
          severity: "info",
          message: `${shot.shotId}: camera motion "${shot.camera.motion}" — provider 미지원 가능성. 지원 목록: static, push-in, pull-back, pan, tilt, dolly, orbit, zoom, tracking 등`,
          shotId: shot.shotId,
          field: "camera.motion",
        });
      }
    }
  }

  // Rule 10: JSON → provider payload 변환 시 누락 필드
  for (const shot of plan.shots) {
    const missing: string[] = [];
    if (!shot.moodLighting) missing.push("moodLighting");
    if (!shot.action) missing.push("action");
    if (!shot.environment) missing.push("environment");
    if (missing.length > 0) {
      issues.push({
        rule: "payload_field_missing",
        severity: "warning",
        message: `${shot.shotId}: provider payload 변환 시 누락될 필드: ${missing.join(", ")}`,
        shotId: shot.shotId,
      });
    }
  }

  const errors = issues.filter(i => i.severity === "error").length;
  const warnings = issues.filter(i => i.severity === "warning").length;
  const infos = issues.filter(i => i.severity === "info").length;

  return {
    valid: errors === 0,
    issues,
    summary: { errors, warnings, infos },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 5. Structured Serializer — ShotPlan → Provider Prompt
// ═══════════════════════════════════════════════════════════════════

/** 직렬화 로그 — 어떤 필드가 포함/제외되었는지 추적 */
export interface SerializationLog {
  shotId: string;
  includedFields: string[];
  droppedFields: string[];
  warnings: string[];
}

export interface SerializedSequence {
  /** 전역 스타일/연속성 프롬프트 */
  globalPrompt: string;
  /** shot별 프롬프트 */
  shotPrompts: Array<{ shotId: string; prompt: string; negative: string }>;
  /** 연속성 제약 프롬프트 */
  continuityPrompt: string;
  /** 전체 negative (합집합) */
  globalNegative: string;
  /** 단일 문자열 직렬화 (provider가 JSON 지원 안 할 때) */
  flattenedPrompt: string;
  /** 직렬화 로그 */
  logs: SerializationLog[];
}

/** SequencePlan → Provider Payload 직렬화 */
export function serializeSequencePlan(
  plan: SequencePlan,
  provider: "veo" | "kling" = "veo",
): SerializedSequence {
  const logs: SerializationLog[] = [];

  // Global prompt
  const globalParts: string[] = [];
  globalParts.push(`[GLOBAL STYLE] ${plan.globalIntent.styleId}`);
  globalParts.push(`[DURATION] ${plan.globalIntent.durationSec}s total, ${plan.shots.length} shots`);
  globalParts.push(`[ASPECT] ${plan.globalIntent.aspectRatio}`);
  const globalPrompt = globalParts.join(" | ");

  // Continuity prompt
  const contParts: string[] = [];
  contParts.push(`[CONTINUITY]`);
  contParts.push(`Primary subject: ${plan.continuity.primarySubject}`);
  if (plan.continuity.subjectAttributes) contParts.push(`Appearance: ${plan.continuity.subjectAttributes}`);
  contParts.push(`Environment: ${plan.continuity.environment}`);
  contParts.push(`Lighting: ${plan.continuity.lightingDirection}`);
  if (plan.continuity.colorAnchors.length > 0) contParts.push(`Colors: ${plan.continuity.colorAnchors.join(", ")}`);
  if (plan.continuity.mustPersist.length > 0) contParts.push(`Must persist: ${plan.continuity.mustPersist.join("; ")}`);
  const continuityPrompt = contParts.join("\n");

  // Shot prompts
  const shotPrompts: SerializedSequence["shotPrompts"] = [];
  for (const shot of plan.shots) {
    const log: SerializationLog = { shotId: shot.shotId, includedFields: [], droppedFields: [], warnings: [] };

    const parts: string[] = [];

    // Camera (always included)
    parts.push(`${shot.camera.framing} shot, ${normalizeAngleForPrompt(shot.camera.angle)}`);
    log.includedFields.push("camera.framing", "camera.angle");

    if (shot.camera.motion && shot.camera.motion !== "static") {
      const motion = provider === "kling"
        ? shot.camera.motion.replace(/\s*\([^)]*\)\s*/g, "").trim()
        : shot.camera.motion;
      parts.push(motion);
      log.includedFields.push("camera.motion");
    } else {
      log.droppedFields.push("camera.motion (static)");
    }

    // Location/Situation/Emotion (Instant Readability)
    if (shot.locationCue) {
      parts.push(shot.locationCue);
      log.includedFields.push("locationCue");
    }
    if (shot.situationCue) {
      parts.push(shot.situationCue);
      log.includedFields.push("situationCue");
    }

    // Character
    if (shot.subject.characterRef) {
      parts.push(shot.subject.characterRef);
      log.includedFields.push("characterRef");
    }

    // Emotional anchor + action
    if (shot.emotionalAnchor) {
      parts.push(shot.emotionalAnchor);
      log.includedFields.push("emotionalAnchor");
    }
    if (shot.action) {
      parts.push(shot.action);
      log.includedFields.push("action");
    } else {
      log.droppedFields.push("action (empty)");
      log.warnings.push("action이 비어있음 — 정적 영상 생성 위험");
    }

    // Mood/Lighting
    if (shot.moodLighting) {
      parts.push(shot.moodLighting);
      log.includedFields.push("moodLighting");
    } else {
      log.droppedFields.push("moodLighting (empty)");
    }

    // Timing beat
    if (shot.timingBeat) {
      parts.push(shot.timingBeat);
      log.includedFields.push("timingBeat");
    } else {
      log.droppedFields.push("timingBeat (empty)");
    }

    const prompt = parts.filter(Boolean).join(". ");
    const negative = shot.negativeDirectives.join(", ");

    shotPrompts.push({ shotId: shot.shotId, prompt, negative });
    logs.push(log);
  }

  // Global negative
  const allNeg = [...new Set([
    ...plan.continuity.mustAvoid,
    ...plan.shots.flatMap(s => s.negativeDirectives),
  ])];
  const globalNegative = allNeg.join(", ");

  // Flattened prompt — shot 경계가 명확한 직렬화
  const flatLines: string[] = [];
  flatLines.push(globalPrompt);
  flatLines.push("");
  flatLines.push(continuityPrompt);
  flatLines.push("");
  for (const shot of plan.shots) {
    const sp = shotPrompts.find(s => s.shotId === shot.shotId)!;
    flatLines.push(`[SHOT ${shot.shotId.replace("shot_", "")} | ${shot.startSec.toFixed(1)}-${shot.endSec.toFixed(1)}s]`);
    flatLines.push(`camera: ${shot.camera.framing}, ${normalizeAngleForPrompt(shot.camera.angle)}, ${shot.camera.motion}`);
    flatLines.push(`subject: ${shot.subject.primary}`);
    if (shot.action) flatLines.push(`action: ${shot.action}`);
    if (shot.environment) flatLines.push(`environment: ${shot.environment}`);
    if (shot.moodLighting) flatLines.push(`lighting: ${shot.moodLighting}`);
    if (sp.negative) flatLines.push(`avoid: ${sp.negative}`);
    flatLines.push("");
  }
  if (globalNegative) flatLines.push(`[GLOBAL AVOID] ${globalNegative}`);

  return {
    globalPrompt,
    shotPrompts,
    continuityPrompt,
    globalNegative,
    flattenedPrompt: flatLines.join("\n"),
    logs,
  };
}

function normalizeAngleForPrompt(angle: ShotCamera["angle"]): string {
  const map: Record<string, string> = {
    eye_level: "eye-level",
    low_angle: "low-angle",
    high_angle: "high-angle",
    dutch: "dutch angle",
    overhead: "overhead",
    POV: "POV",
  };
  return map[angle] || angle;
}

// ═══════════════════════════════════════════════════════════════════
// 6. Fidelity Evaluation — 생성 결과 vs 시퀀스 플랜
// ═══════════════════════════════════════════════════════════════════

export interface ShotFidelityScore {
  shotId: string;
  /** 카메라 변화가 plan대로인지 (0-100) */
  cameraFidelity: number;
  /** 피사체가 유지되는지 (0-100) */
  subjectPersistence: number;
  /** 환경이 일관한지 (0-100) */
  environmentPersistence: number;
  /** 행동이 실행되었는지 (0-100) */
  actionFidelity: number;
  /** 프롬프트 준수도 (0-100) */
  promptAdherence: number;
}

export interface SequenceFidelityResult {
  /** 전체 점수 (0-100) */
  overallScore: number;
  /** shot별 점수 */
  shotScores: ShotFidelityScore[];
  /** shot 수 일치 여부 */
  shotCountMatch: boolean;
  /** 연속성 보존 점수 (0-100) */
  continuityPreservation: number;
  /** 실패 원인 분류 */
  failureDiagnosis: FailureDiagnosis;
}

/** 실패 원인 3-way 분류 */
export interface FailureDiagnosis {
  /** A. Authoring failure — JSON 자체가 부실 */
  authoringIssues: string[];
  /** B. Serialization failure — JSON → payload 과정에서 정보 손실 */
  serializationIssues: string[];
  /** C. Generation failure — payload는 괜찮았는데 모델이 못 만듦 */
  generationIssues: string[];
  /** 가장 큰 원인 */
  primaryCause: "authoring" | "serialization" | "generation" | "unknown";
}

/**
 * 시퀀스 plan과 실제 생성 결과를 비교하여 fidelity 평가.
 * 이 함수는 생성 후 결과 메타데이터를 기반으로 평가.
 * (실제 영상 분석은 Gemini를 호출해야 하므로 여기서는 메타 기반 평가)
 */
export function evaluateSequenceFidelity(
  plan: SequencePlan,
  serialization: SerializedSequence,
  generationResults: Array<{
    shotId: string;
    generated: boolean;
    engineUsed?: string;
    finalPrompt?: string;
    verification?: { overallScore: number; issues: string[] };
  }>,
): SequenceFidelityResult {
  const shotScores: ShotFidelityScore[] = [];
  const authoringIssues: string[] = [];
  const serializationIssues: string[] = [];
  const generationIssues: string[] = [];

  // Validation 기반 authoring 평가
  const validation = validateSequencePlan(plan);
  if (!validation.valid) {
    for (const issue of validation.issues.filter(i => i.severity === "error")) {
      authoringIssues.push(`[${issue.rule}] ${issue.message}`);
    }
  }

  // Serialization 로그 기반 평가
  for (const log of serialization.logs) {
    if (log.droppedFields.length > 0) {
      for (const field of log.droppedFields) {
        if (!field.includes("static") && !field.includes("empty")) {
          serializationIssues.push(`${log.shotId}: 필드 "${field}" 직렬화에서 누락`);
        }
      }
    }
    if (log.warnings.length > 0) {
      for (const w of log.warnings) {
        serializationIssues.push(`${log.shotId}: ${w}`);
      }
    }
  }

  // Shot별 fidelity 평가
  const shotCountMatch = generationResults.length === plan.shots.length;
  if (!shotCountMatch) {
    generationIssues.push(`생성된 shot 수(${generationResults.length}) ≠ plan shot 수(${plan.shots.length})`);
  }

  for (const shot of plan.shots) {
    const result = generationResults.find(r => r.shotId === shot.shotId);

    if (!result || !result.generated) {
      shotScores.push({
        shotId: shot.shotId,
        cameraFidelity: 0,
        subjectPersistence: 0,
        environmentPersistence: 0,
        actionFidelity: 0,
        promptAdherence: 0,
      });
      generationIssues.push(`${shot.shotId}: 생성 실패`);
      continue;
    }

    // 카메라 fidelity — final prompt에 camera 정보가 포함되었는지
    const fp = result.finalPrompt || "";
    const cameraInPrompt = fp.toLowerCase().includes(shot.camera.framing.toLowerCase());
    const motionInPrompt = shot.camera.motion === "static" || fp.toLowerCase().includes(shot.camera.motion.toLowerCase().slice(0, 8));

    // Subject persistence
    const subjectWords = shot.subject.primary.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const subjectHits = subjectWords.filter(w => fp.toLowerCase().includes(w)).length;
    const subjectRatio = subjectWords.length > 0 ? subjectHits / subjectWords.length : 0;

    // Action fidelity
    const actionWords = shot.action.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const actionHits = actionWords.filter(w => fp.toLowerCase().includes(w)).length;
    const actionRatio = actionWords.length > 0 ? actionHits / actionWords.length : 0;

    // Verification score (from Gemini evaluation)
    const vScore = result.verification?.overallScore ?? 50;

    shotScores.push({
      shotId: shot.shotId,
      cameraFidelity: (cameraInPrompt ? 50 : 0) + (motionInPrompt ? 50 : 0),
      subjectPersistence: Math.round(subjectRatio * 100),
      environmentPersistence: fp.toLowerCase().includes(shot.environment.toLowerCase().slice(0, 10)) ? 80 : 30,
      actionFidelity: Math.round(actionRatio * 100),
      promptAdherence: vScore,
    });

    // 검증 이슈
    if (result.verification?.issues) {
      for (const issue of result.verification.issues) {
        generationIssues.push(`${shot.shotId}: ${issue}`);
      }
    }
  }

  // 전체 점수
  const avgScores = shotScores.map(s =>
    (s.cameraFidelity + s.subjectPersistence + s.environmentPersistence + s.actionFidelity + s.promptAdherence) / 5
  );
  const overallScore = avgScores.length > 0
    ? Math.round(avgScores.reduce((a, b) => a + b, 0) / avgScores.length)
    : 0;

  // 연속성 보존 — 인접 shot 간 subject 일치도
  let contScore = 100;
  for (let i = 1; i < shotScores.length; i++) {
    if (shotScores[i].subjectPersistence < 50) contScore -= 15;
    if (shotScores[i].environmentPersistence < 50) contScore -= 10;
  }
  const continuityPreservation = Math.max(0, contScore);

  // Primary cause 결정
  let primaryCause: FailureDiagnosis["primaryCause"] = "unknown";
  if (authoringIssues.length > serializationIssues.length && authoringIssues.length > generationIssues.length) {
    primaryCause = "authoring";
  } else if (serializationIssues.length > generationIssues.length) {
    primaryCause = "serialization";
  } else if (generationIssues.length > 0) {
    primaryCause = "generation";
  }

  return {
    overallScore,
    shotScores,
    shotCountMatch,
    continuityPreservation,
    failureDiagnosis: {
      authoringIssues,
      serializationIssues,
      generationIssues,
      primaryCause,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 7. ShotPlan ↔ VideoPromptJson 변환
// ═══════════════════════════════════════════════════════════════════

/** ShotPlan → VideoPromptJson (provider 렌더러와 호환) */
export function shotPlanToVideoPromptJson(
  shot: ShotPlan,
  styleSuffix: string,
): VideoPromptJson {
  return {
    shotSize: shot.camera.framing,
    cameraAngle: normalizeAngleForPrompt(shot.camera.angle),
    cameraMovement: shot.camera.motionMotivation
      ? `${shot.camera.motion} (${shot.camera.motionMotivation})`
      : shot.camera.motion,
    subjectBlocking: shot.subject.blocking || "subject center-frame",
    subjectAction: shot.action,
    actionBeat: shot.action,
    bodySignal: shot.visualDirectives.find(d => d.startsWith("body:"))?.replace("body: ", "") || "",
    revealed: shot.visualDirectives.find(d => d.startsWith("reveal:"))?.replace("reveal: ", "") || "",
    withheld: "",
    timingBeat: shot.timingBeat || "",
    transitionFromPrev: shot.transitionFromPrev || "",
    characterRef: shot.subject.characterRef || "",
    moodLighting: shot.moodLighting,
    styleSuffix,
    locationCue: shot.locationCue || "",
    situationCue: shot.situationCue || "",
    emotionalAnchor: shot.emotionalAnchor || "",
  };
}

/** VideoPromptJson → ShotPlan (역변환, import 용) */
export function videoPromptJsonToShotPlan(
  json: VideoPromptJson,
  shotIndex: number,
  durationSec: number,
  startSec: number = 0,
): ShotPlan {
  return {
    shotId: `shot_${shotIndex + 1}`,
    startSec,
    endSec: startSec + durationSec,
    shotType: mapShotType(json.shotSize),
    camera: {
      framing: normalizeFraming(json.shotSize),
      angle: normalizeAngle(json.cameraAngle),
      motion: json.cameraMovement || "static",
      motionMotivation: extractMotivation(json.cameraMovement),
    },
    subject: {
      primary: json.subjectAction || "",
      characterRef: json.characterRef || undefined,
      blocking: json.subjectBlocking || undefined,
    },
    environment: json.locationCue || "",
    action: json.subjectAction || "",
    timingBeat: json.timingBeat || undefined,
    visualDirectives: buildVisualDirectives(json),
    negativeDirectives: [],
    moodLighting: json.moodLighting || "",
    transitionFromPrev: json.transitionFromPrev || undefined,
    locationCue: json.locationCue,
    situationCue: json.situationCue,
    emotionalAnchor: json.emotionalAnchor,
  };
}
