/**
 * structured-shot-normalize.ts — StructuredShot subject 정규화 유틸
 *
 * subject: string (legacy) → subject: { primary: string } (canonical) 변환.
 * 모든 downstream consumer는 getSubjectPrimary()를 통해 접근해야 함.
 *
 * grep: normalizeStructuredShot, getSubjectPrimary, normalizeSubject
 */

import type {
  StructuredShot,
  StructuredShotSubject,
  StructuredShotSubjectInput,
} from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Subject normalization
// ═══════════════════════════════════════════════════════════════════

/**
 * subject input을 canonical { primary } 형태로 정규화.
 * string → { primary: string }
 * { primary } → as-is
 */
export function normalizeSubject(subject: StructuredShotSubjectInput): StructuredShotSubject {
  if (typeof subject === "string") {
    return { primary: subject };
  }
  return subject;
}

/**
 * subject에서 primary 문자열을 안전하게 추출.
 * string이면 그대로, { primary }이면 primary 반환.
 */
export function getSubjectPrimary(subject: StructuredShotSubjectInput): string {
  if (typeof subject === "string") return subject;
  return subject.primary;
}

// ═══════════════════════════════════════════════════════════════════
// Shot normalization
// ═══════════════════════════════════════════════════════════════════

/**
 * StructuredShot를 정규화: subject를 canonical 형태로 변환.
 * 나머지 필드는 그대로 유지.
 */
export function normalizeStructuredShot(shot: StructuredShot): StructuredShot {
  return {
    ...shot,
    subject: normalizeSubject(shot.subject),
  };
}

/**
 * StructuredShot 배열을 정규화.
 */
export function normalizeStructuredShots(shots: StructuredShot[]): StructuredShot[] {
  return shots.map(normalizeStructuredShot);
}

// ═══════════════════════════════════════════════════════════════════
// StructuredShot → SequenceDocument shot 변환
// ═══════════════════════════════════════════════════════════════════

/**
 * StructuredShot을 StructuredSequenceDocument.shots[] 항목으로 변환.
 * subject.primary → subject (string) 으로 flatten.
 * (StructuredSequenceDocument.shots[].subject는 string 타입이므로)
 */
export function structuredShotToSequenceShot(shot: StructuredShot): {
  shotId: string;
  startSec: number;
  endSec: number;
  camera: { framing: string; angle: string; motion: string };
  subject: string;
  action: string;
  environment: string;
  moodLighting: string;
  focus: string;
} {
  return {
    shotId: shot.shotId,
    startSec: shot.startSec,
    endSec: shot.endSec,
    camera: shot.camera,
    subject: getSubjectPrimary(shot.subject),
    action: shot.action,
    environment: shot.environment,
    moodLighting: shot.moodLighting,
    focus: shot.focus,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Validation helpers
// ═══════════════════════════════════════════════════════════════════

export interface ShotFieldMissing {
  shotId: string;
  field: string;
}

/**
 * StructuredShot의 필수 필드 누락 검사.
 * fragmented edit에서 각 shot이 완전한 구조를 갖추었는지 확인.
 */
export function validateStructuredShotFields(shot: StructuredShot): ShotFieldMissing[] {
  const missing: ShotFieldMissing[] = [];
  const id = shot.shotId || "unknown";

  if (!shot.shotId) missing.push({ shotId: id, field: "shotId" });
  if (shot.startSec == null) missing.push({ shotId: id, field: "startSec" });
  if (shot.endSec == null) missing.push({ shotId: id, field: "endSec" });
  if (!shot.camera?.framing) missing.push({ shotId: id, field: "camera.framing" });
  if (!shot.camera?.angle) missing.push({ shotId: id, field: "camera.angle" });
  if (!shot.camera?.motion) missing.push({ shotId: id, field: "camera.motion" });

  const subjectPrimary = getSubjectPrimary(shot.subject);
  if (!subjectPrimary || subjectPrimary.trim().length === 0) {
    missing.push({ shotId: id, field: "subject.primary" });
  }

  if (!shot.action || shot.action.trim().length === 0) {
    missing.push({ shotId: id, field: "action" });
  }
  if (!shot.environment || shot.environment.trim().length === 0) {
    missing.push({ shotId: id, field: "environment" });
  }
  if (!shot.moodLighting || shot.moodLighting.trim().length === 0) {
    missing.push({ shotId: id, field: "moodLighting" });
  }

  return missing;
}

/**
 * 여러 shot의 필수 필드 누락을 한 번에 검사.
 */
export function validateAllStructuredShotFields(shots: StructuredShot[]): ShotFieldMissing[] {
  return shots.flatMap(validateStructuredShotFields);
}
