/**
 * shot-editing.ts — 시퀀스 타임라인 편집 유틸리티 (순수 함수)
 *
 * 역할:
 *  - shot split / merge / reorder / duration rebalance
 *  - sequence density validation
 *  - source of truth = StructuredSequenceDocument.shots[]
 *
 * 2차 확장 포인트:
 *  - selectedShotId 기준 regenerate
 *  - shot variant 목록 관리
 *  - node graph 연결 (shotId 중심)
 */

import type { StructuredSequenceDocument, TemporalBeat, NarrationMode, StructureType, DurationClass } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/** StructuredSequenceDocument.shots[i] 와 동일한 구조 */
export interface EditableShot {
  shotId: string;
  startSec: number;
  endSec: number;
  camera: { framing: string; angle: string; motion: string };
  subject: string;
  action: string;
  environment: string;
  moodLighting: string;
  focus: string;
  // ── Audio / Narration ──
  narrationText?: string;
  narrationMode?: NarrationMode;
  // ── 구조 보조 메타 ──
  structureType?: StructureType;
  durationClass?: DurationClass;
  groupId?: string;
}

export interface EditableSequence {
  sequenceId: string;
  cutNumber: number;
  sceneType: string;
  durationSec: number;
  shots: EditableShot[];
  placeIdentityAnchors: string[];
  situationEvidence: string[];
  naturalMotion: string[];
  temporalBeats: TemporalBeat[];
}

export interface SequenceDensityWarning {
  hasWarning: boolean;
  message: string;
  shotCount: number;
  recommendedMin: number;
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const MIN_SHOT_DURATION_SEC = 1;

/** sceneType → minimum shot count */
const MULTI_SHOT_SCENE_TYPES: Record<string, number> = {
  environment: 2,
  "character-driven": 2,
  character: 2,
  crowd: 2,
  battle: 3,
  map_visualization: 2,
  "map-graphic": 2,
  cinematic_sequence: 2,
};

// ═══════════════════════════════════════════════════════════════════
// Extraction — StructuredSequenceDocument → EditableSequence
// ═══════════════════════════════════════════════════════════════════

/**
 * StructuredSequenceDocument에서 편집 가능한 경량 구조로 변환.
 * shots[]가 비어 있으면 shotPlan에서 단일 shot을 생성.
 */
export function extractEditable(doc: StructuredSequenceDocument): EditableSequence {
  let shots: EditableShot[] = [];

  if (doc.shots && doc.shots.length > 0) {
    shots = doc.shots.map(s => ({
      ...s,
      // narration 필드 전파: sequence-level → shot-level (shots에는 없으므로 sequence에서 복사)
      narrationText: s.narrationText ?? doc.narrationText,
      narrationMode: s.narrationMode ?? doc.narrationMode ?? "auto",
    }));
  } else if (doc.shotPlan) {
    // shotPlan만 있고 shots[]가 없는 경우 — 단일 shot으로 변환
    const sp = doc.shotPlan;
    shots = [{
      shotId: sp.shotId || `shot_1`,
      startSec: 0,
      endSec: doc.durationSec,
      camera: {
        framing: sp.camera?.framing || "MS",
        angle: sp.camera?.angle || "eye-level",
        motion: sp.camera?.motion || "static",
      },
      subject: sp.subject?.primary || "",
      action: sp.action || "",
      environment: sp.environment || "",
      moodLighting: sp.moodLighting || "",
      focus: "main action",
      narrationText: doc.narrationText,
      narrationMode: doc.narrationMode ?? "auto",
    }];
  }

  return {
    sequenceId: doc.sequenceId,
    cutNumber: doc.cutNumber,
    sceneType: doc.sceneType,
    durationSec: doc.durationSec,
    shots,
    placeIdentityAnchors: [...(doc.placeIdentityAnchors || [])],
    situationEvidence: [...(doc.situationEvidence || [])],
    naturalMotion: [...(doc.naturalMotion || [])],
    temporalBeats: [...(doc.temporalBeats || [])],
  };
}

/**
 * EditableSequence의 shots[]를 원본 StructuredSequenceDocument에 병합.
 * shots[], temporalBeats 갱신. 나머지 필드는 원본 유지.
 */
export function applyEditsToDocument(
  original: StructuredSequenceDocument,
  editable: EditableSequence,
): StructuredSequenceDocument {
  const updated = JSON.parse(JSON.stringify(original)) as StructuredSequenceDocument;

  updated.shots = editable.shots.map(s => ({ ...s }));
  updated.durationSec = editable.durationSec;

  // narration: 단일 shot인 경우 sequence-level 필드에도 반영
  if (editable.shots.length === 1) {
    updated.narrationText = editable.shots[0].narrationText;
    updated.narrationMode = editable.shots[0].narrationMode;
  } else if (editable.shots.length > 0) {
    // 다중 shot: 첫 shot의 narration을 sequence-level에 반영 (대표값)
    updated.narrationText = editable.shots[0].narrationText;
    updated.narrationMode = editable.shots[0].narrationMode;
  }
  updated.placeIdentityAnchors = [...editable.placeIdentityAnchors];
  updated.situationEvidence = [...editable.situationEvidence];
  updated.naturalMotion = [...editable.naturalMotion];

  // temporalBeats를 shots에서 재생성
  updated.temporalBeats = editable.shots.map(s => ({
    startSec: s.startSec,
    endSec: s.endSec,
    focus: s.focus,
  }));

  return updated;
}

// ═══════════════════════════════════════════════════════════════════
// Split Shot
// ═══════════════════════════════════════════════════════════════════

let splitCounter = 0;

function generateShotId(): string {
  splitCounter++;
  return `shot_${Date.now().toString(36)}_${splitCounter}`;
}

/**
 * 선택한 shot을 midpoint 기준으로 2분할.
 * 새 shot은 기존 데이터를 복제하며 사용자가 inspector에서 수정 가능.
 */
export function splitShot(seq: EditableSequence, shotId: string): EditableSequence {
  const idx = seq.shots.findIndex(s => s.shotId === shotId);
  if (idx === -1) return seq;

  const shot = seq.shots[idx];
  const duration = shot.endSec - shot.startSec;
  if (duration < MIN_SHOT_DURATION_SEC * 2) return seq; // 분할 불가 (너무 짧음)

  const mid = shot.startSec + duration / 2;

  const shotA: EditableShot = {
    ...shot,
    shotId: shot.shotId, // 원본 ID 유지
    endSec: mid,
  };

  const shotB: EditableShot = {
    ...shot,
    shotId: generateShotId(),
    startSec: mid,
    endSec: shot.endSec,
    camera: { ...shot.camera },
    focus: `continuation of ${shot.focus}`,
  };

  const newShots = [...seq.shots];
  newShots.splice(idx, 1, shotA, shotB);

  return {
    ...seq,
    shots: newShots,
    temporalBeats: newShots.map(s => ({ startSec: s.startSec, endSec: s.endSec, focus: s.focus })),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Merge Shots
// ═══════════════════════════════════════════════════════════════════

/**
 * 선택한 shot을 이전 shot과 병합.
 * subject/action/environment는 " → " 구분자로 합침.
 */
export function mergeShotWithPrevious(seq: EditableSequence, shotId: string): EditableSequence {
  const idx = seq.shots.findIndex(s => s.shotId === shotId);
  if (idx <= 0) return seq; // 첫 shot이면 병합 불가

  const prev = seq.shots[idx - 1];
  const curr = seq.shots[idx];

  const merged: EditableShot = {
    shotId: prev.shotId,
    startSec: prev.startSec,
    endSec: curr.endSec,
    camera: { ...prev.camera }, // 이전 shot의 카메라 유지
    subject: prev.subject === curr.subject ? prev.subject : `${prev.subject} → ${curr.subject}`,
    action: `${prev.action} → ${curr.action}`,
    environment: prev.environment === curr.environment ? prev.environment : `${prev.environment} → ${curr.environment}`,
    moodLighting: prev.moodLighting,
    focus: `${prev.focus} → ${curr.focus}`,
    // 구조 보조 메타 — 앞 shot 값 유지
    ...(prev.structureType ? { structureType: prev.structureType } : {}),
    ...(prev.durationClass ? { durationClass: prev.durationClass } : {}),
    ...(prev.groupId ? { groupId: prev.groupId } : {}),
  };

  const newShots = [...seq.shots];
  newShots.splice(idx - 1, 2, merged);

  return {
    ...seq,
    shots: newShots,
    temporalBeats: newShots.map(s => ({ startSec: s.startSec, endSec: s.endSec, focus: s.focus })),
  };
}

/**
 * 선택한 shot을 다음 shot과 병합.
 */
export function mergeShotWithNext(seq: EditableSequence, shotId: string): EditableSequence {
  const idx = seq.shots.findIndex(s => s.shotId === shotId);
  if (idx === -1 || idx >= seq.shots.length - 1) return seq;

  const nextShotId = seq.shots[idx + 1].shotId;
  return mergeShotWithPrevious(seq, nextShotId);
}

// ═══════════════════════════════════════════════════════════════════
// Reorder Shots
// ═══════════════════════════════════════════════════════════════════

/**
 * shot을 위로 이동 (이전 shot과 위치 교환).
 * timing은 자동 재계산.
 */
export function moveShotUp(seq: EditableSequence, shotId: string): EditableSequence {
  const idx = seq.shots.findIndex(s => s.shotId === shotId);
  if (idx <= 0) return seq;

  const newShots = [...seq.shots];
  [newShots[idx - 1], newShots[idx]] = [newShots[idx], newShots[idx - 1]];

  return rebalanceShotTimings({ ...seq, shots: newShots });
}

/**
 * shot을 아래로 이동 (다음 shot과 위치 교환).
 */
export function moveShotDown(seq: EditableSequence, shotId: string): EditableSequence {
  const idx = seq.shots.findIndex(s => s.shotId === shotId);
  if (idx === -1 || idx >= seq.shots.length - 1) return seq;

  const newShots = [...seq.shots];
  [newShots[idx], newShots[idx + 1]] = [newShots[idx + 1], newShots[idx]];

  return rebalanceShotTimings({ ...seq, shots: newShots });
}

// ═══════════════════════════════════════════════════════════════════
// Duration Rebalance
// ═══════════════════════════════════════════════════════════════════

/**
 * 모든 shot의 timing을 순서 기반으로 재계산.
 * 각 shot의 duration 비율을 유지하면서 전체 durationSec 안에 맞춤.
 * overlap / negative duration 방지.
 */
export function rebalanceShotTimings(seq: EditableSequence): EditableSequence {
  if (seq.shots.length === 0) return seq;

  const totalDuration = seq.durationSec;
  const shots = [...seq.shots];

  // 각 shot의 원래 duration 비율 계산
  const durations = shots.map(s => Math.max(MIN_SHOT_DURATION_SEC, s.endSec - s.startSec));
  const totalOriginal = durations.reduce((a, b) => a + b, 0);

  // 비율 기반 재분배
  let cursor = 0;
  const rebalanced = shots.map((s, i) => {
    const ratio = durations[i] / totalOriginal;
    const newDuration = Math.max(MIN_SHOT_DURATION_SEC, Math.round(ratio * totalDuration * 10) / 10);
    const startSec = Math.round(cursor * 10) / 10;
    cursor += newDuration;
    return {
      ...s,
      startSec,
      endSec: Math.round(cursor * 10) / 10,
    };
  });

  // 마지막 shot은 정확히 totalDuration에 맞춤
  if (rebalanced.length > 0) {
    rebalanced[rebalanced.length - 1].endSec = totalDuration;
  }

  return {
    ...seq,
    shots: rebalanced,
    temporalBeats: rebalanced.map(s => ({ startSec: s.startSec, endSec: s.endSec, focus: s.focus })),
  };
}

/**
 * 특정 shot의 duration을 변경하고 나머지를 재배치.
 * 전체 durationSec는 유지.
 */
export function setShotDuration(
  seq: EditableSequence,
  shotId: string,
  newDuration: number,
): EditableSequence {
  const idx = seq.shots.findIndex(s => s.shotId === shotId);
  if (idx === -1) return seq;

  const clampedDuration = Math.max(MIN_SHOT_DURATION_SEC, newDuration);
  const shots = seq.shots.map((s, i) => {
    if (i === idx) {
      return { ...s, endSec: s.startSec + clampedDuration };
    }
    return { ...s };
  });

  return rebalanceShotTimings({ ...seq, shots });
}

// ═══════════════════════════════════════════════════════════════════
// Update Shot Field
// ═══════════════════════════════════════════════════════════════════

/**
 * 특정 shot의 필드를 갱신.
 * camera 하위 필드는 path로 지정 (예: "camera.framing").
 */
export function updateShotField(
  seq: EditableSequence,
  shotId: string,
  path: string,
  value: string,
): EditableSequence {
  const idx = seq.shots.findIndex(s => s.shotId === shotId);
  if (idx === -1) return seq;

  const newShots = [...seq.shots];
  const shot = { ...newShots[idx], camera: { ...newShots[idx].camera } };

  if (path === "camera.framing") shot.camera.framing = value;
  else if (path === "camera.angle") shot.camera.angle = value;
  else if (path === "camera.motion") shot.camera.motion = value;
  else if (path === "subject") shot.subject = value;
  else if (path === "action") shot.action = value;
  else if (path === "environment") shot.environment = value;
  else if (path === "moodLighting") shot.moodLighting = value;
  else if (path === "focus") shot.focus = value;
  else if (path === "narrationText") shot.narrationText = value;
  else if (path === "narrationMode") shot.narrationMode = value as NarrationMode;

  newShots[idx] = shot;
  return { ...seq, shots: newShots };
}

// ═══════════════════════════════════════════════════════════════════
// Sequence-level Field Update
// ═══════════════════════════════════════════════════════════════════

export function updateSequenceAnchors(
  seq: EditableSequence,
  field: "placeIdentityAnchors" | "situationEvidence",
  values: string[],
): EditableSequence {
  return { ...seq, [field]: values };
}

// ═══════════════════════════════════════════════════════════════════
// Sequence Density Validation
// ═══════════════════════════════════════════════════════════════════

/**
 * sceneType 기반 shot density 경고.
 * environment/character/crowd 등은 최소 2~3 shot 필요.
 */
export function validateSequenceDensity(seq: EditableSequence): SequenceDensityWarning {
  const minShots = MULTI_SHOT_SCENE_TYPES[seq.sceneType];
  if (!minShots) {
    return { hasWarning: false, message: "", shotCount: seq.shots.length, recommendedMin: 1 };
  }

  if (seq.shots.length < minShots) {
    return {
      hasWarning: true,
      message: `이 시퀀스(${seq.sceneType})는 샷 수가 부족합니다. 최소 ${minShots}샷 권장 (현재 ${seq.shots.length}샷)`,
      shotCount: seq.shots.length,
      recommendedMin: minShots,
    };
  }

  return { hasWarning: false, message: "", shotCount: seq.shots.length, recommendedMin: minShots };
}

// ═══════════════════════════════════════════════════════════════════
// Framing / Angle Option Lists (for inspector dropdowns)
// ═══════════════════════════════════════════════════════════════════

export const FRAMING_OPTIONS = ["ECU", "CU", "MCU", "MS", "MLS", "LS", "WS", "OTS", "POV"] as const;
export const ANGLE_OPTIONS = ["eye-level", "low-angle", "high-angle", "dutch", "overhead", "POV"] as const;
