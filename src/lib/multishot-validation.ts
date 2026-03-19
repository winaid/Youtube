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
import { shouldForceMultiShot } from "@/lib/multi-shot-planner";
import type { GenerationMode } from "@/lib/multi-shot-planner";

/** Safely get prompt text — guards against undefined in malformed multiShot data */
function safePrompt(shot: MultiShotPrompt): string {
  return typeof shot.prompt === "string" ? shot.prompt : "";
}

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
// Runtime Heuristic Defaults
// ═══════════════════════════════════════════════════════════════════

/**
 * Runtime → Recommended shot count range.
 * 숏폼 비디오 리텐션 기준.
 * recommendation이며 hard cap이 아님.
 */
export const RUNTIME_SHOT_HEURISTICS: { maxSec: number; min: number; max: number; label: string }[] = [
  { maxSec: 8,  min: 3, max: 6, label: "4–8s" },
  { maxSec: 15, min: 4, max: 6, label: "9–15s" },
];

/**
 * runtime 기준 권장 shot 수 범위를 반환.
 */
export function getRecommendedShotRange(durationSec: number): { min: number; max: number } {
  for (const h of RUNTIME_SHOT_HEURISTICS) {
    if (durationSec <= h.maxSec) return { min: h.min, max: h.max };
  }
  return { min: 4, max: 6 };
}

/**
 * "runtime에 비해 shot이 부족한가?" 체크.
 *
 * @returns null이면 문제없음, 아니면 경고/에러 메시지와 권장 범위
 */
export function checkShotDensity(
  totalDurationSec: number,
  shotCount: number,
): { severity: "warning" | "error"; message: string; recommended: { min: number; max: number } } | null {
  if (totalDurationSec < 8) return null; // 짧은 영상은 1샷 허용

  const rec = getRecommendedShotRange(totalDurationSec);

  if (shotCount < rec.min) {
    const isExtreme = shotCount <= 1 && totalDurationSec >= 8;
    return {
      severity: isExtreme ? "warning" : "warning",
      message: `이 장면 ${totalDurationSec}초에 내부 멀티샷 ${shotCount}개 — 리텐션을 위해 ${rec.min}–${rec.max}개 권장. 의도적 원테이크라면 무시 가능.`,
      recommended: rec,
    };
  }

  return null;
}

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
    if (!shot.prompt || safePrompt(shot).trim().length === 0) {
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
    const dur = parseFloat(shot.duration) || 0;
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
  const durationSum = shots.reduce((sum, s) => sum + (parseFloat(s.duration) || 0), 0);
  const diff = Math.abs(durationSum - totalDurationSec);
  if (diff > 0.5 && shots.length > 0) {
    aggregateIssues.push({
      severity: diff > 1 ? "error" : "warning",
      message: `시간 합계 ${durationSum}초 ≠ 전체 ${totalDurationSec}초 (차이 ${diff}초)`,
    });
  }

  // ── 프로그레션 품질 검증 ──
  if (shots.length >= 2) {
    const roles = shots.map((s) => s.role ?? inferShotRole(shots.indexOf(s), shots.length));
    const uniqueRoles = new Set(roles);

    // role 단조로움 경고
    if (shots.length >= 3 && uniqueRoles.size === 1) {
      aggregateIssues.push({
        severity: "warning",
        message: `모든 샷이 같은 역할 (${roles[0]}) — 프로그레션 없음. 역할 재정렬 필요.`,
      });
    }

    // 인접 role 반복 경고 (같은 role이 연속으로 오면 시각적 진행이 없을 가능성)
    for (let i = 1; i < roles.length; i++) {
      if (roles[i] === roles[i - 1] && roles[i] !== "develop") {
        shotIssues.push({
          shotIndex: shots[i].index,
          field: "role",
          severity: "warning",
          message: `샷 ${i}과 ${i + 1}이 같은 역할 (${roles[i]}) — 시각적 변화 없이 반복될 수 있음`,
        });
      }
    }

    // 동일 prompt 경고 (fake split 감지)
    const trimmedPrompts = shots.map(s => safePrompt(s).trim().toLowerCase()).filter(p => p.length > 0);
    if (trimmedPrompts.length >= 2) {
      for (let i = 1; i < trimmedPrompts.length; i++) {
        if (trimmedPrompts[i] === trimmedPrompts[i - 1]) {
          shotIssues.push({
            shotIndex: shots[i].index,
            field: "prompt",
            severity: "warning",
            message: `이전 샷과 프롬프트가 동일 — 각 샷은 다른 프레이밍/액션을 묘사해야 합니다`,
          });
        }
      }
    }

    // ── 프로그레션 품질 심층 검증 (semantic similarity, framing, escalation) ──
    const progressionIssues = validateProgressionQuality(shots);
    for (const pi of progressionIssues) {
      if (pi.shotIndex !== undefined) {
        shotIssues.push({
          shotIndex: pi.shotIndex,
          field: "prompt",
          severity: pi.severity,
          message: pi.message,
        });
      } else {
        aggregateIssues.push({
          severity: pi.severity,
          message: pi.message,
        });
      }
    }
  }

  // ── shot density (runtime 대비 shot 부족) 경고 ──
  const densityCheck = checkShotDensity(totalDurationSec, shots.length);
  if (densityCheck) {
    aggregateIssues.push({
      severity: densityCheck.severity,
      message: densityCheck.message,
    });
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
 * 새 샷 추가 — 분할 가능한 가장 긴 샷에서 시간 분할.
 *
 * 분할 대상 선택: duration이 가장 긴 샷 우선 (minDur × 2 이상이어야 분할 가능).
 * 새 샷은 분할 대상 바로 뒤에 삽입.
 *
 * @returns 업데이트된 shots 배열 (불변), null if can't add
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

  if (shots.length === 0) {
    // 첫 샷 추가
    const newShot: MultiShotPrompt = {
      index: 1,
      prompt: "",
      duration: String(totalDurationSec),
      role: inferShotRole(0, 1),
    };
    return [newShot];
  }

  // 분할 가능한 가장 긴 샷 찾기 (duration >= minDur * 2)
  const updated = shots.map((s) => ({ ...s }));
  let bestIdx = -1;
  let bestDur = 0;
  for (let i = 0; i < updated.length; i++) {
    const dur = parseFloat(updated[i].duration) || 0;
    if (dur >= minDur * 2 && dur > bestDur) {
      bestIdx = i;
      bestDur = dur;
    }
  }

  // 분할 가능한 샷이 없으면 추가 불가
  if (bestIdx < 0) return null;

  const splitDur = bestDur;
  const newShotDur = Math.max(minDur, Math.floor(splitDur / 2));
  const remainDur = splitDur - newShotDur;

  if (remainDur < minDur) return null;

  updated[bestIdx] = { ...updated[bestIdx], duration: String(remainDur) };

  const newTotal = updated.length + 1;
  const newShot: MultiShotPrompt = {
    index: 0, // will be re-indexed below
    prompt: "",
    duration: String(newShotDur),
    role: inferShotRole(newTotal - 1, newTotal),
  };

  // 분할 대상 바로 뒤에 삽입
  const result = [
    ...updated.slice(0, bestIdx + 1),
    newShot,
    ...updated.slice(bestIdx + 1),
  ];
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

  const removedDur = parseFloat(shots[removeIdx].duration) || 0;
  const remaining = shots.filter((_, i) => i !== removeIdx);

  // 삭제된 시간을 마지막 샷에 흡수
  const lastIdx = remaining.length - 1;
  const lastDur = parseFloat(remaining[lastIdx].duration) || 0;
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

  const oldDur = parseFloat(shots[idx].duration) || 0;
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

    const curDur = parseFloat(updated[ci].duration) || 0;
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

// ═══════════════════════════════════════════════════════════════════
// Mode-Aware Validation
// ═══════════════════════════════════════════════════════════════════

/**
 * Studio Mode용 엄격한 검증.
 * 멀티샷 누락 시 blocking error로 처리.
 *
 * @param modelId - Kling 모델 ID
 * @param shots - 현재 멀티샷 배열 (없을 수 있음)
 * @param totalDurationSec - 클립 전체 duration
 * @param sceneType - 씬 분류 (force-multishot 판정용)
 * @param intentionalOneTake - 의도적 원테이크 여부
 */
export function validateStudioMode(
  modelId: string,
  shots: MultiShotPrompt[] | undefined,
  totalDurationSec: number,
  sceneType?: string,
  intentionalOneTake?: boolean,
): MultiShotValidationResult {
  const shotIssues: ShotIssue[] = [];
  const aggregateIssues: AggregateIssue[] = [];

  // 멀티샷 누락 검사 (강제 멀티샷 정책 해당 시)
  if ((!shots || shots.length < 2) && !intentionalOneTake) {
    if (shouldForceMultiShot(sceneType ?? "default", totalDurationSec, modelId)) {
      aggregateIssues.push({
        severity: "error",
        message: `${totalDurationSec}초 ${sceneType ?? ""} — 멀티샷 필수. 단일 샷으로 제출 불가. 의도적 원테이크라면 명시 설정 필요.`,
      });
    }
  }

  // 기존 멀티샷이 있으면 standard validation도 수행
  if (shots && shots.length > 0) {
    const standard = validateMultiShots(modelId, shots, totalDurationSec);
    shotIssues.push(...standard.shotIssues);
    aggregateIssues.push(...standard.aggregateIssues);

    // Studio 추가: role 진행 검사 (3샷 이상에서 reveal/payoff 없으면 경고)
    if (shots.length >= 3) {
      const roles = shots.map(s => s.role).filter(Boolean);
      const hasPeak = roles.includes("peak");
      const hasResolve = roles.includes("resolve");
      if (!hasPeak && !hasResolve) {
        aggregateIssues.push({
          severity: "warning",
          message: `${shots.length}샷인데 peak/resolve 없음 — 리텐션을 위해 reveal/payoff role 추가 권장`,
        });
      }
    }

    // Studio 추가: 반복 프롬프트 검사
    if (shots.length >= 2) {
      const prompts = shots.map(s => safePrompt(s).trim().toLowerCase()).filter(p => p.length > 0);
      const uniquePrompts = new Set(prompts);
      if (prompts.length >= 2 && uniquePrompts.size === 1) {
        aggregateIssues.push({
          severity: "warning",
          message: "모든 샷의 프롬프트가 동일 — 샷별 차별화 필요 (정보 변화 없음)",
        });
      }
    }
  }

  const hasError = shotIssues.some(i => i.severity === "error") ||
    aggregateIssues.some(i => i.severity === "error");

  return { valid: !hasError, shotIssues, aggregateIssues };
}

/**
 * Batch Mode용 느슨한 검증.
 * 치명적 오류만 blocking, 나머지는 warning.
 * auto-repair 가능 항목은 warning으로 내려놓음.
 */
export function validateBatchMode(
  modelId: string,
  shots: MultiShotPrompt[] | undefined,
  totalDurationSec: number,
): MultiShotValidationResult {
  const shotIssues: ShotIssue[] = [];
  const aggregateIssues: AggregateIssue[] = [];

  // Batch에서는 멀티샷 누락을 blocking하지 않음 (auto-repair가 처리)
  if (!shots || shots.length === 0) {
    // auto-repair가 처리할 것이므로 warning만
    if (totalDurationSec >= 6) {
      aggregateIssues.push({
        severity: "warning",
        message: `${totalDurationSec}초 — 멀티샷 자동 생성 예정`,
      });
    }
    return { valid: true, shotIssues, aggregateIssues };
  }

  // 기존 멀티샷이 있으면 기본 검증 수행 (error는 error 유지)
  const standard = validateMultiShots(modelId, shots, totalDurationSec);

  // Batch에서는 빈 prompt를 warning으로 내림 (auto-repair 대상)
  for (const issue of standard.shotIssues) {
    if (issue.field === "prompt" && issue.severity === "error" && issue.message.includes("비어있습니다")) {
      shotIssues.push({ ...issue, severity: "warning" });
    } else {
      shotIssues.push(issue);
    }
  }

  aggregateIssues.push(...standard.aggregateIssues);

  const hasError = shotIssues.some(i => i.severity === "error") ||
    aggregateIssues.some(i => i.severity === "error");

  return { valid: !hasError, shotIssues, aggregateIssues };
}

/**
 * 모드별 검증 디스패치.
 */
export function validateByMode(
  mode: GenerationMode,
  modelId: string,
  shots: MultiShotPrompt[] | undefined,
  totalDurationSec: number,
  opts?: { sceneType?: string; intentionalOneTake?: boolean },
): MultiShotValidationResult {
  if (mode === "studio") {
    return validateStudioMode(modelId, shots, totalDurationSec, opts?.sceneType, opts?.intentionalOneTake);
  }
  return validateBatchMode(modelId, shots, totalDurationSec);
}

// ═══════════════════════════════════════════════════════════════════
// Progression Quality Validation
// ═══════════════════════════════════════════════════════════════════

/** Framing terms for detecting shot size in prompt text */
const FRAMING_WIDE = /\b(wide[\s-]?shot|WS|LS|establishing|aerial|panoram|full[\s-]?shot)\b/i;
const FRAMING_MEDIUM = /\b(medium[\s-]?shot|MS|MCU|MLS|mid[\s-]?shot|waist[\s-]?shot)\b/i;
const FRAMING_CLOSE = /\b(close[\s-]?up|CU|ECU|macro|detail[\s-]?shot|extreme[\s-]?close)\b/i;

/** Extract framing category from prompt text */
function extractFramingCategory(prompt: string): "wide" | "medium" | "close" | "unknown" {
  const hasWide = FRAMING_WIDE.test(prompt);
  const hasClose = FRAMING_CLOSE.test(prompt);
  const hasMedium = FRAMING_MEDIUM.test(prompt);
  if (hasClose) return "close";
  if (hasWide) return "wide";
  if (hasMedium) return "medium";
  return "unknown";
}

/** Simple word-set overlap ratio (Jaccard-like) for detecting near-duplicate prompts */
function wordOverlapRatio(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

/** Action verbs — detect whether prompts describe different actions */
const ACTION_VERBS = /\b(walks?|runs?|turns?|looks?|grabs?|pushes?|pulls?|opens?|sits?|stands?|lifts?|drops?|reaches?|leans?|steps?|moves?|falls?|rises?|enters?|exits?|slides?|grips?|gestures?|points?|nods?|shakes?|trembles?|reveals?|pans?|tracks?|dollys?|zooms?|tilts?|cranes?)\b/gi;
/** Words that look like action verbs but are framing/shot terms — exclude from action extraction */
const FRAMING_FALSE_POSITIVES = new Set(["close", "pan", "tilt", "zoom", "track", "dolly", "crane", "wide", "medium"]);

function extractActions(prompt: string): string[] {
  const matches = prompt.match(ACTION_VERBS);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.toLowerCase()).filter(m => !FRAMING_FALSE_POSITIVES.has(m)))];
}

/** Subject nouns — detect whether adjacent shots describe the same subject (camera-only change) */
const SUBJECT_NOUNS = /\b(man|woman|boy|girl|child|person|figure|knight|warrior|soldier|king|queen|chef|doctor|patient|priest|monk|merchant|guard|captain|elder|stranger|traveler|character|hero|villain|protagonist|dog|cat|horse|bird|creature|dragon|wolf|bear|lion|car|boat|ship|train|plane|building|tree|mountain|river|crowd|group|army|object|device|machine|weapon|sword|door|gate|chair|table|desk|bed|throne)\b/gi;

function extractSubjects(prompt: string): string[] {
  const matches = prompt.match(SUBJECT_NOUNS);
  return matches ? [...new Set(matches.map(m => m.toLowerCase()))] : [];
}

interface ProgressionIssue {
  shotIndex?: number; // undefined = aggregate
  severity: ValidationSeverity;
  message: string;
}

/**
 * Deep progression quality validation.
 *
 * Checks beyond exact-match:
 * 1. High word overlap between adjacent shots (near-duplicate detection)
 * 2. Framing diversity (adjacent shots should differ in framing)
 * 3. Action differentiation (adjacent shots should describe different actions)
 * 4. Escalation presence (sequence should not stay flat)
 * 5. Payoff presence (last shot should describe closure/reveal/impact)
 */
export function validateProgressionQuality(
  shots: MultiShotPrompt[],
): ProgressionIssue[] {
  const issues: ProgressionIssue[] = [];
  if (shots.length < 2) return issues;

  const prompts = shots.map(s => safePrompt(s).trim());
  const nonEmpty = prompts.filter(p => p.length > 0);
  if (nonEmpty.length < 2) return issues;

  // ── 1. Near-duplicate detection (high word overlap) ──
  for (let i = 1; i < prompts.length; i++) {
    if (prompts[i].length === 0 || prompts[i - 1].length === 0) continue;
    const overlap = wordOverlapRatio(prompts[i], prompts[i - 1]);
    if (overlap > 0.75) {
      issues.push({
        shotIndex: shots[i].index,
        severity: "warning",
        message: `이전 샷과 ${Math.round(overlap * 100)}% 유사 — 다른 프레이밍/액션/피사체를 묘사하세요`,
      });
    }
  }

  // ── 2. Framing diversity ──
  const framings = prompts.map(extractFramingCategory);
  const knownFramings = framings.filter(f => f !== "unknown");
  if (knownFramings.length >= 2) {
    // Adjacent identical framing
    for (let i = 1; i < framings.length; i++) {
      if (framings[i] !== "unknown" && framings[i] === framings[i - 1]) {
        issues.push({
          shotIndex: shots[i].index,
          severity: "warning",
          message: `인접 샷이 같은 프레이밍 (${framings[i]}) — shot size 변화로 시각적 리듬 필요`,
        });
      }
    }
    // All same framing (flat sequence)
    const uniqueFramings = new Set(knownFramings);
    if (uniqueFramings.size === 1 && shots.length >= 3) {
      issues.push({
        severity: "warning",
        message: `모든 샷이 같은 프레이밍 (${knownFramings[0]}) — wide→medium→close 같은 시각적 진행 필요`,
      });
    }
  }

  // ── 3. Action differentiation ──
  for (let i = 1; i < prompts.length; i++) {
    if (prompts[i].length === 0 || prompts[i - 1].length === 0) continue;
    const actionsA = extractActions(prompts[i - 1]);
    const actionsB = extractActions(prompts[i]);
    if (actionsA.length > 0 && actionsB.length > 0) {
      const shared = actionsA.filter(a => actionsB.includes(a));
      if (shared.length === actionsA.length && shared.length === actionsB.length && actionsA.length > 0) {
        issues.push({
          shotIndex: shots[i].index,
          severity: "warning",
          message: `인접 샷에서 같은 행동 반복 (${shared.join(", ")}) — 각 샷은 다른 행동/변화를 보여줘야 합니다`,
        });
      }
    }
  }

  // ── 3b. Camera-only change detection (same subject, different framing) ──
  for (let i = 1; i < prompts.length; i++) {
    if (prompts[i].length === 0 || prompts[i - 1].length === 0) continue;
    const subjectsA = extractSubjects(prompts[i - 1]);
    const subjectsB = extractSubjects(prompts[i]);
    if (subjectsA.length > 0 && subjectsB.length > 0) {
      const shared = subjectsA.filter(s => subjectsB.includes(s));
      // Same subjects + different framing = camera-only change (no information gain)
      if (shared.length > 0 && shared.length === subjectsA.length && shared.length === subjectsB.length) {
        const framA = extractFramingCategory(prompts[i - 1]);
        const framB = extractFramingCategory(prompts[i]);
        if (framA !== "unknown" && framB !== "unknown" && framA !== framB) {
          // Framing changed but subject didn't — only warn if actions also didn't change
          const actA = extractActions(prompts[i - 1]);
          const actB = extractActions(prompts[i]);
          const sameActions = actA.length > 0 && actB.length > 0 &&
            actA.every(a => actB.includes(a)) && actB.every(a => actA.includes(a));
          if (sameActions) {
            issues.push({
              shotIndex: shots[i].index,
              severity: "warning",
              message: `카메라만 변경 (${framA}→${framB}) — 같은 피사체(${shared.join(",")})의 같은 행동. 새 정보/행동/상태가 필요합니다`,
            });
          }
        }
      }
    }
  }

  // ── 4. Escalation check — sequence should not stay flat ──
  // Use role metadata: establish < develop < insert < peak is the expected escalation
  const INTENSITY_ORDER: Record<string, number> = {
    establish: 1, transition: 2, develop: 3, insert: 4, peak: 5, resolve: 3,
  };
  const roles = shots.map((s, i) => s.role ?? inferShotRole(i, shots.length));
  const intensities = roles.map(r => INTENSITY_ORDER[r] ?? 2);
  // Check if there's any escalation (at least one shot higher than first)
  if (shots.length >= 3) {
    const maxIntensity = Math.max(...intensities.slice(1, -1)); // exclude first and last
    if (maxIntensity <= intensities[0]) {
      issues.push({
        severity: "warning",
        message: "시퀀스에 에스컬레이션 없음 — 중간 샷의 강도가 도입보다 높아야 합니다",
      });
    }
  }

  // ── 5. Payoff check — last shot should describe closure/payoff ──
  if (shots.length >= 3) {
    const lastPrompt = prompts[prompts.length - 1].toLowerCase();
    const lastRole = roles[roles.length - 1];
    // If last role is "resolve" or similar, check that prompt has payoff indicators
    const PAYOFF_INDICATORS = /\b(reveal|payoff|closure|release|final|impact|reaction|resolve|result|outcome|pull[\s-]?back|exhale|drops?|release|settl|breath|relief)\b/i;
    if (lastRole === "resolve" && lastPrompt.length > 20 && !PAYOFF_INDICATORS.test(lastPrompt)) {
      // Soft check — only warn if last prompt looks like a generic description
      const lastFraming = extractFramingCategory(lastPrompt);
      const prevFraming = prompts.length >= 2 ? extractFramingCategory(prompts[prompts.length - 2]) : "unknown";
      if (lastFraming === prevFraming && lastFraming !== "unknown") {
        issues.push({
          shotIndex: shots[shots.length - 1].index,
          severity: "warning",
          message: "마지막 샷에 페이오프 부족 — 시각적 해소(pull-back, reaction, reveal)가 필요합니다",
        });
      }
    }
  }

  return issues;
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
