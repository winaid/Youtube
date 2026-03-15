/**
 * multishot-validation.ts — Editor Layer 실시간 검증 + duration 재분배
 *
 * 3-Layer Validation 중 Editor Layer 담당:
 *   - shot 개수 범위 검증
 *   - 개별 prompt 길이 검증 (경고 450자, 에러 512자)
 *   - 개별 duration 최소값 검증
 *   - duration 합 == totalDuration 검증
 *   - 빈 prompt 검증
 *   - role 분포 단조로움 경고
 *
 * Duration 재분배 규칙:
 *   - 샷 추가: 마지막 샷에서 시간 분할
 *   - 샷 삭제: 삭제된 시간을 마지막 샷에 흡수
 *   - 샷 리사이즈: 인접 샷(다음 → 이전 순)에서 보상
 *   - 총 duration은 항상 유지
 *
 * grep: validateMultiShots, redistributeDurations, addShot, removeShot, resizeShot
 */

import type { MultiShotPrompt, ShotRole } from "@/types";
import { getMaxShots, getCapability } from "@/lib/kling-capability";

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

export const PROMPT_WARN_LENGTH = 450;
/**
 * 최대 prompt 길이.
 *
 * 이중 방어 전략:
 *   1. UI 입력 차단 — MultiShotEditor의 <textarea maxLength={512}>로 초과 타이핑 방지
 *   2. Validation 검증 — 서버 생성/붙여넣기 등 외부 유입 데이터에 대한 후행 검증
 *
 * maxLength는 "입력 시 차단", validation은 "기존 데이터 검출" 역할.
 * export layer(final-payload-validator)에서도 동일 상수로 Rule 15 적용.
 */
export const PROMPT_MAX_LENGTH = 512;

// ═══════════════════════════════════════════════════════════════════
// Validation Types
// ═══════════════════════════════════════════════════════════════════

export type ValidationSeverity = "error" | "warning";

export interface ShotIssue {
  shotIndex: number; // 1-based
  field: "prompt" | "duration" | "role";
  severity: ValidationSeverity;
  message: string;
}

export interface AggregateIssue {
  severity: ValidationSeverity;
  message: string;
}

export interface MultiShotValidationResult {
  valid: boolean; // true if no errors (warnings are OK)
  shotIssues: ShotIssue[];
  aggregateIssues: AggregateIssue[];
}

// ═══════════════════════════════════════════════════════════════════
// Role Auto-Inference
// ═══════════════════════════════════════════════════════════════════

/**
 * position 기반 ShotRole 자동 추론.
 * index: 0-based position, total: 전체 shot 수
 */
export function inferShotRole(index: number, total: number): ShotRole {
  if (total <= 1) return "establish";
  if (index === 0) return "establish";
  if (index === total - 1) return "resolve";

  // 중간 샷: 절반 지점 근처를 peak로
  const midPoint = Math.floor(total / 2);
  if (index === midPoint) return "peak";

  return "develop";
}

// ═══════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════

/**
 * Editor Layer 실시간 검증.
 *
 * @param modelId - Kling 모델 ID
 * @param shots - 현재 멀티샷 배열
 * @param totalDurationSec - 컷 전체 duration (초)
 * @returns 검증 결과 (valid + 개별/집계 이슈)
 */
export function validateMultiShots(
  modelId: string,
  shots: MultiShotPrompt[],
  totalDurationSec: number,
): MultiShotValidationResult {
  const shotIssues: ShotIssue[] = [];
  const aggregateIssues: AggregateIssue[] = [];

  const cap = getCapability(modelId);
  const maxShots = getMaxShots(modelId, totalDurationSec);

  // ── 샷 개수 검증 ──
  if (shots.length === 0) {
    aggregateIssues.push({ severity: "error", message: "샷이 최소 1개 필요합니다." });
  }
  if (shots.length > maxShots && maxShots > 0) {
    aggregateIssues.push({
      severity: "error",
      message: `샷 수 초과: ${shots.length}/${maxShots} (${totalDurationSec}초 기준)`,
    });
  }

  // ── 개별 샷 검증 ──
  for (const shot of shots) {
    // 빈 prompt
    if (!shot.prompt || shot.prompt.trim().length === 0) {
      shotIssues.push({
        shotIndex: shot.index,
        field: "prompt",
        severity: "error",
        message: "프롬프트가 비어있습니다.",
      });
    } else {
      // prompt 길이
      const len = shot.prompt.length;
      if (len > PROMPT_MAX_LENGTH) {
        shotIssues.push({
          shotIndex: shot.index,
          field: "prompt",
          severity: "error",
          message: `프롬프트 ${len}자 — 최대 ${PROMPT_MAX_LENGTH}자 초과`,
        });
      } else if (len > PROMPT_WARN_LENGTH) {
        shotIssues.push({
          shotIndex: shot.index,
          field: "prompt",
          severity: "warning",
          message: `프롬프트 ${len}/${PROMPT_MAX_LENGTH}자 — 길이 주의`,
        });
      }
    }

    // duration 최소값
    const dur = parseInt(shot.duration, 10) || 0;
    if (dur < cap.minShotDuration) {
      shotIssues.push({
        shotIndex: shot.index,
        field: "duration",
        severity: "error",
        message: `시간 ${dur}초 — 최소 ${cap.minShotDuration}초 필요`,
      });
    }
  }

  // ── duration 합 검증 ──
  const durationSum = shots.reduce((sum, s) => sum + (parseInt(s.duration, 10) || 0), 0);
  const diff = Math.abs(durationSum - totalDurationSec);
  if (diff > 0.5 && shots.length > 0) {
    aggregateIssues.push({
      severity: diff > 1 ? "error" : "warning",
      message: `시간 합계 ${durationSum}초 ≠ 전체 ${totalDurationSec}초 (차이 ${diff}초)`,
    });
  }

  // ── role 단조로움 경고 ──
  if (shots.length >= 3) {
    const roles = shots.map((s) => s.role ?? inferShotRole(shots.indexOf(s), shots.length));
    const uniqueRoles = new Set(roles);
    if (uniqueRoles.size === 1) {
      aggregateIssues.push({
        severity: "warning",
        message: `모든 샷이 같은 역할 (${roles[0]}) — 다양화 권장`,
      });
    }
  }

  const hasError = shotIssues.some((i) => i.severity === "error") ||
    aggregateIssues.some((i) => i.severity === "error");

  return { valid: !hasError, shotIssues, aggregateIssues };
}

// ═══════════════════════════════════════════════════════════════════
// Role Re-assignment
// ═══════════════════════════════════════════════════════════════════

/**
 * position 기반 role 재할당.
 * 기존 role이 있더라도 position에 맞게 재추론.
 * 사용자가 명시 설정한 role은 건드리지 않되,
 * auto-inferred role만 갱신하려면 userSetRoles Set을 전달.
 *
 * @param shots - 현재 shots 배열
 * @param userSetRoles - 사용자가 명시 설정한 shotIndex Set (1-based). 이 샷의 role은 유지.
 * @returns 새 shots 배열 (불변)
 */
export function autoAssignRoles(
  shots: MultiShotPrompt[],
  userSetRoles?: Set<number>,
): MultiShotPrompt[] {
  return shots.map((s, i) => {
    if (userSetRoles && userSetRoles.has(s.index)) return { ...s };
    return { ...s, role: inferShotRole(i, shots.length) };
  });
}

// ═══════════════════════════════════════════════════════════════════
// Duration Redistribution
// ═══════════════════════════════════════════════════════════════════

/**
 * 새 샷 추가 — 마지막 샷에서 시간 분할.
 *
 * @returns 업데이트된 shots 배열 (불변)
 */
export function addShot(
  modelId: string,
  shots: MultiShotPrompt[],
  totalDurationSec: number,
): MultiShotPrompt[] | null {
  const maxShots = getMaxShots(modelId, totalDurationSec);
  if (shots.length >= maxShots) return null;

  const cap = getCapability(modelId);
  const minDur = cap.minShotDuration;

  // 마지막 샷에서 시간 분할
  const updated = shots.map((s) => ({ ...s }));
  const lastIdx = updated.length - 1;

  if (updated.length === 0) {
    // 첫 샷 추가
    const newShot: MultiShotPrompt = {
      index: 1,
      prompt: "",
      duration: String(totalDurationSec),
      role: inferShotRole(0, 1),
    };
    return [newShot];
  }

  const lastDur = parseInt(updated[lastIdx].duration, 10) || 0;
  const newShotDur = Math.max(minDur, Math.floor(lastDur / 2));
  const remainDur = lastDur - newShotDur;

  // 분할 후 마지막 샷이 minDur 미만이면 추가 불가
  if (remainDur < minDur) return null;

  updated[lastIdx] = { ...updated[lastIdx], duration: String(remainDur) };

  const newTotal = updated.length + 1;
  const newShot: MultiShotPrompt = {
    index: newTotal,
    prompt: "",
    duration: String(newShotDur),
    role: inferShotRole(newTotal - 1, newTotal),
  };

  const result = [...updated, newShot];
  // re-index
  return result.map((s, i) => ({ ...s, index: i + 1 }));
}

/**
 * 샷 삭제 — 삭제된 시간을 마지막 샷에 흡수.
 *
 * @param shotIndex - 1-based index of shot to remove
 * @returns 업데이트된 shots 배열 (불변), null if can't remove (only 1 shot)
 */
export function removeShot(
  shots: MultiShotPrompt[],
  shotIndex: number,
): MultiShotPrompt[] | null {
  if (shots.length <= 1) return null;

  const removeIdx = shotIndex - 1; // 0-based
  if (removeIdx < 0 || removeIdx >= shots.length) return null;

  const removedDur = parseInt(shots[removeIdx].duration, 10) || 0;
  const remaining = shots.filter((_, i) => i !== removeIdx);

  // 삭제된 시간을 마지막 샷에 흡수
  const lastIdx = remaining.length - 1;
  const lastDur = parseInt(remaining[lastIdx].duration, 10) || 0;
  remaining[lastIdx] = { ...remaining[lastIdx], duration: String(lastDur + removedDur) };

  // re-index + role 재추론 (기존 role 유지, 없으면 추론)
  return remaining.map((s, i) => ({
    ...s,
    index: i + 1,
    role: s.role ?? inferShotRole(i, remaining.length),
  }));
}

/**
 * 샷 리사이즈 — 인접 샷(다음 → 이전)에서 보상하여 총 duration 유지.
 *
 * @param shotIndex - 1-based index of shot to resize
 * @param newDuration - 새 duration (초)
 * @returns 업데이트된 shots 배열 (불변), null if impossible
 */
export function resizeShot(
  modelId: string,
  shots: MultiShotPrompt[],
  shotIndex: number,
  newDuration: number,
): MultiShotPrompt[] | null {
  const cap = getCapability(modelId);
  const minDur = cap.minShotDuration;

  const idx = shotIndex - 1; // 0-based
  if (idx < 0 || idx >= shots.length) return null;
  if (newDuration < minDur) return null;

  const oldDur = parseInt(shots[idx].duration, 10) || 0;
  const delta = newDuration - oldDur; // positive = grew, negative = shrunk
  if (delta === 0) return shots.map((s) => ({ ...s }));

  const updated = shots.map((s) => ({ ...s }));
  updated[idx] = { ...updated[idx], duration: String(newDuration) };

  // 보상 대상: 다음 샷 우선, 없으면 이전 샷
  let remaining = -delta;
  const compensateOrder: number[] = [];

  // 다음 샷들
  for (let i = idx + 1; i < updated.length; i++) compensateOrder.push(i);
  // 이전 샷들 (역순)
  for (let i = idx - 1; i >= 0; i--) compensateOrder.push(i);

  for (const ci of compensateOrder) {
    if (remaining === 0) break;

    const curDur = parseInt(updated[ci].duration, 10) || 0;
    const newCurDur = curDur + remaining;

    if (newCurDur >= minDur) {
      updated[ci] = { ...updated[ci], duration: String(newCurDur) };
      remaining = 0;
    } else {
      // 이 샷을 minDur로 줄이고 나머지를 다음 보상 대상에게
      const absorbed = curDur - minDur;
      updated[ci] = { ...updated[ci], duration: String(minDur) };
      remaining += absorbed;
    }
  }

  // 보상 불가능한 경우 (remaining !== 0)
  if (remaining !== 0) return null;

  return updated;
}

/**
 * duration 균등 분배 — totalDuration을 shots 수로 나누어 분배.
 * 나머지는 마지막 샷에 흡수.
 */
export function distributeEvenly(
  modelId: string,
  shotCount: number,
  totalDurationSec: number,
  existingShots?: MultiShotPrompt[],
): MultiShotPrompt[] {
  const cap = getCapability(modelId);
  const minDur = cap.minShotDuration;
  const baseDur = Math.max(minDur, Math.floor(totalDurationSec / shotCount));
  const remainder = totalDurationSec - baseDur * shotCount;

  return Array.from({ length: shotCount }, (_, i) => {
    const isLast = i === shotCount - 1;
    const dur = isLast ? baseDur + remainder : baseDur;
    const existing = existingShots?.[i];
    return {
      index: i + 1,
      prompt: existing?.prompt ?? "",
      duration: String(Math.max(minDur, dur)),
      role: existing?.role ?? inferShotRole(i, shotCount),
    };
  });
}
