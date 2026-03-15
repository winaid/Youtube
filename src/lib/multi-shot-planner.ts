/**
 * multi-shot-planner.ts — Kling 멀티샷 자동 계획 엔진
 *
 * 핵심 역할:
 *   1. duration + sceneType + modelId 기반 추천 샷 수 계산
 *   2. retention 기반 role 시퀀스 자동 배정 (hook → develop → reveal → payoff)
 *   3. duration 분배 (retention 가중치 기반)
 *   4. 강제 멀티샷 정책 (긴 시네마틱 클립 = 단일샷 불가)
 *   5. 누락 멀티샷 자동 복구 (submission 직전 방어)
 *   6. 의도적 원테이크 예외 처리
 *
 * 이 모듈이 default planning engine.
 * 단일샷은 짧은 클립이거나 명시적 one-take 예외일 때만 허용.
 *
 * grep: planRecommendedShotCount, planShotRoles, buildDefaultMultiShot,
 *       shouldForceMultiShot, repairMissingMultiShot, RETENTION_ROLE_PATTERNS
 */

import type { MultiShotPrompt, ShotRole } from "@/types";
import { getMaxShots, getCapability } from "@/lib/kling-capability";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/** 생성 모드 — Studio(신중한 검토) vs Batch(빠른 대량 생성) */
export type GenerationMode = "studio" | "batch";

/** 씬 타입 — 멀티샷 계획에 영향을 주는 분류 */
export type PlannerSceneType =
  | "cinematic_sequence"
  | "environment"
  | "character-driven"
  | "battle"
  | "montage"
  | "person"
  | "crowd"
  | "map_visualization"
  | "default";

/** 멀티샷 계획 결과 */
export interface MultiShotPlan {
  /** 추천 샷 수 */
  shotCount: number;
  /** role 시퀀스 */
  roles: ShotRole[];
  /** 샷별 duration 배분 (초) */
  durations: number[];
  /** 강제 멀티샷 여부 */
  forced: boolean;
  /** 의도적 원테이크 허용 여부 */
  oneTakeAllowed: boolean;
  /** 계획 근거 */
  reasoning: string;
}

// ═══════════════════════════════════════════════════════════════════
// Constants — Retention Role Patterns
// ═══════════════════════════════════════════════════════════════════

/**
 * 샷 수별 retention 기반 role 시퀀스.
 *
 * 기존 ShotRole 타입(establish/develop/peak/resolve/insert/transition) 사용하되
 * retention 의도에 맞게 매핑:
 *   hook    → establish (시선 포착)
 *   orient  → transition (상황 파악)
 *   develop → develop (정보 확장)
 *   intensify → insert (텐션 상승)
 *   reveal  → peak (클라이맥스)
 *   payoff  → resolve (마무리/보상)
 */
export const RETENTION_ROLE_PATTERNS: Record<number, ShotRole[]> = {
  1: ["establish"],
  2: ["establish", "resolve"],
  3: ["establish", "develop", "resolve"],
  4: ["establish", "develop", "peak", "resolve"],
  5: ["establish", "transition", "develop", "peak", "resolve"],
  6: ["establish", "transition", "develop", "insert", "peak", "resolve"],
};

// ═══════════════════════════════════════════════════════════════════
// Shot Count Heuristics
// ═══════════════════════════════════════════════════════════════════

/**
 * duration 기반 추천 샷 수 범위.
 *
 * 기존 RUNTIME_SHOT_HEURISTICS(multishot-validation.ts)보다 더 공격적.
 * 이 모듈이 default planning engine이므로 기존 heuristic은 validation용으로 유지.
 */
const SHOT_COUNT_RANGES: { maxSec: number; min: number; max: number }[] = [
  { maxSec: 3,  min: 1, max: 1 },
  { maxSec: 5,  min: 2, max: 2 },
  { maxSec: 8,  min: 2, max: 3 },
  { maxSec: 12, min: 3, max: 4 },
  { maxSec: 15, min: 4, max: 6 },
];

/** scene type별 shot count 보정 */
const SCENE_TYPE_BIAS: Partial<Record<PlannerSceneType, number>> = {
  battle: 1,           // 더 많은 샷
  montage: 1,          // 더 많은 샷
  cinematic_sequence: 0,
  environment: 0,
  "character-driven": 0,
  person: -1,          // 약간 적게 (인물 중심은 롱테이크 유효)
  default: 0,
};

/**
 * 강제 멀티샷 씬 타입 — 이 타입 + duration 6s+ 면 단일샷 불가.
 */
const FORCE_MULTI_SHOT_SCENE_TYPES: Set<PlannerSceneType> = new Set([
  "cinematic_sequence",
  "environment",
  "character-driven",
  "battle",
  "montage",
]);

/** 강제 멀티샷 duration 임계값 (초) */
const FORCE_MULTI_SHOT_DURATION_THRESHOLD = 6;

/** 어떤 씬이든 이 duration 이상이면 강제 멀티샷 */
const ABSOLUTE_FORCE_DURATION = 9;

// ═══════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * 추천 샷 수 계산.
 *
 * @param modelId - Kling 모델 ID
 * @param durationSec - 클립 전체 duration (초)
 * @param sceneType - 씬 분류
 * @returns 추천 샷 수 (모델 capability 범위 내)
 */
export function planRecommendedShotCount(
  modelId: string,
  durationSec: number,
  sceneType: PlannerSceneType = "default",
): number {
  const maxShots = getMaxShots(modelId, durationSec);
  if (maxShots <= 0) return 1; // multiShot 비활성 모델/duration

  // 기본 범위 결정
  let range = SHOT_COUNT_RANGES.find(r => durationSec <= r.maxSec);
  if (!range) range = SHOT_COUNT_RANGES[SHOT_COUNT_RANGES.length - 1];

  // scene type bias 적용
  const bias = SCENE_TYPE_BIAS[sceneType] ?? 0;
  const target = Math.round((range.min + range.max) / 2) + bias;

  // clamp to [1, maxShots]
  return Math.max(1, Math.min(maxShots, target));
}

/**
 * retention 기반 role 시퀀스 배정.
 *
 * @param shotCount - 샷 수
 * @returns ShotRole 배열
 */
export function planShotRoles(shotCount: number): ShotRole[] {
  if (shotCount <= 0) return [];
  if (shotCount <= 6) return [...(RETENTION_ROLE_PATTERNS[shotCount] ?? RETENTION_ROLE_PATTERNS[1])];

  // 6샷 초과: 기본 패턴 + 중간에 develop/insert 반복
  const base = [...RETENTION_ROLE_PATTERNS[6]];
  const extra = shotCount - 6;
  // 중간(develop~insert 사이)에 추가
  for (let i = 0; i < extra; i++) {
    base.splice(3, 0, i % 2 === 0 ? "develop" : "insert");
  }
  return base;
}

/**
 * retention 가중치 기반 duration 분배.
 *
 * hook(establish)과 payoff(resolve)에 약간 더 할당.
 * peak에도 약간 더 할당.
 */
const ROLE_DURATION_WEIGHT: Record<ShotRole, number> = {
  establish: 1.2,   // hook — 약간 길게
  develop: 1.0,
  peak: 1.1,        // reveal — 약간 길게
  resolve: 1.1,     // payoff — 약간 길게
  insert: 0.8,      // intensify — 짧게
  transition: 0.8,  // orient — 짧게
};

/**
 * role 기반 duration 분배.
 *
 * @param roles - ShotRole 배열
 * @param totalDurationSec - 전체 duration
 * @param minShotDuration - 최소 샷 duration (모델 기준)
 * @returns 샷별 duration 배열 (정수, 합 = totalDurationSec)
 */
export function distributeDurations(
  roles: ShotRole[],
  totalDurationSec: number,
  minShotDuration: number,
): number[] {
  if (roles.length === 0) return [];
  if (roles.length === 1) return [totalDurationSec];

  // 가중치 합 계산
  const weights = roles.map(r => ROLE_DURATION_WEIGHT[r] ?? 1.0);
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  // 가중치 비례 분배 (floor)
  const raw = weights.map(w => Math.max(minShotDuration, Math.floor((w / totalWeight) * totalDurationSec)));

  // 나머지 흡수
  const currentSum = raw.reduce((s, d) => s + d, 0);
  let remainder = totalDurationSec - currentSum;

  // 가장 큰 가중치 샷부터 나머지 분배
  const indices = weights.map((_, i) => i).sort((a, b) => weights[b] - weights[a]);
  for (const idx of indices) {
    if (remainder <= 0) break;
    raw[idx] += 1;
    remainder -= 1;
  }

  return raw;
}

/**
 * 기본 멀티샷 배열을 자동 생성.
 *
 * @returns 생성된 MultiShotPrompt[] (prompt는 basePrompt 기반 placeholder)
 */
export function buildDefaultMultiShot(opts: {
  durationSec: number;
  sceneType?: PlannerSceneType;
  basePrompt?: string;
  modelId: string;
}): MultiShotPrompt[] {
  const { durationSec, sceneType = "default", basePrompt = "", modelId } = opts;
  const cap = getCapability(modelId);

  const shotCount = planRecommendedShotCount(modelId, durationSec, sceneType);
  if (shotCount <= 1 && !shouldForceMultiShot(sceneType, durationSec, modelId)) {
    // 1샷 — 멀티샷 불필요
    return [];
  }

  const effectiveCount = Math.max(2, shotCount);
  const roles = planShotRoles(effectiveCount);
  const durations = distributeDurations(roles, durationSec, cap.minShotDuration);

  return roles.map((role, i) => ({
    index: i + 1,
    prompt: basePrompt,
    duration: String(durations[i]),
    role,
  }));
}

// ═══════════════════════════════════════════════════════════════════
// Force Multi-Shot Policy
// ═══════════════════════════════════════════════════════════════════

/**
 * 강제 멀티샷 여부 판정.
 *
 * true면 단일샷으로 submit하면 안 됨.
 * Studio Mode에서는 blocking error, Batch Mode에서는 auto-repair.
 */
export function shouldForceMultiShot(
  sceneType: PlannerSceneType | string,
  durationSec: number,
  modelId: string,
): boolean {
  const cap = getCapability(modelId);
  if (!cap.supportsMultiShot) return false;

  const maxShots = getMaxShots(modelId, durationSec);
  if (maxShots <= 1) return false;

  // 절대 기준: 9초 이상이면 어떤 씬이든 강제
  if (durationSec >= ABSOLUTE_FORCE_DURATION) return true;

  // 씬 타입 기반: 특정 씬 타입 + 6초 이상
  if (durationSec >= FORCE_MULTI_SHOT_DURATION_THRESHOLD &&
      FORCE_MULTI_SHOT_SCENE_TYPES.has(sceneType as PlannerSceneType)) {
    return true;
  }

  return false;
}

/**
 * 의도적 원테이크 허용 여부 판정.
 *
 * @returns true면 단일샷으로 submit 가능 (사용자 명시 의도)
 */
export function isOneTakeAllowed(
  durationSec: number,
  intentionalOneTake: boolean,
): boolean {
  // 3초 이하: 항상 원테이크 허용
  if (durationSec <= 3) return true;

  // 사용자가 명시적으로 원테이크 설정
  if (intentionalOneTake) return true;

  return false;
}

// ═══════════════════════════════════════════════════════════════════
// Submission Repair
// ═══════════════════════════════════════════════════════════════════

/**
 * submission 직전 멀티샷 누락 자동 복구.
 *
 * multiShot이 없거나 비어있는데, 강제 멀티샷 정책에 해당하면
 * 자동으로 기본 멀티샷 계획을 생성한다.
 *
 * @returns 복구된 MultiShotPrompt[] (빈 배열 = 복구 불필요)
 */
export function repairMissingMultiShot(opts: {
  existingMultiShot?: MultiShotPrompt[];
  durationSec: number;
  sceneType?: PlannerSceneType | string;
  basePrompt?: string;
  modelId: string;
  intentionalOneTake?: boolean;
  mode?: GenerationMode;
}): MultiShotPrompt[] {
  const {
    existingMultiShot,
    durationSec,
    sceneType = "default",
    basePrompt = "",
    modelId,
    intentionalOneTake = false,
    mode = "batch",
  } = opts;

  // 이미 멀티샷이 있으면 복구 불필요
  if (existingMultiShot && existingMultiShot.length >= 2) {
    return existingMultiShot;
  }

  // 의도적 원테이크면 복구 안함
  if (isOneTakeAllowed(durationSec, intentionalOneTake)) {
    return existingMultiShot ?? [];
  }

  // 강제 멀티샷 정책 해당하면 자동 생성
  if (shouldForceMultiShot(sceneType as PlannerSceneType, durationSec, modelId)) {
    return buildDefaultMultiShot({
      durationSec,
      sceneType: sceneType as PlannerSceneType,
      basePrompt,
      modelId,
    });
  }

  // Studio 모드에서는 강제하지 않아도 추천 (하지만 repair하지는 않음)
  // Batch 모드에서는 auto-repair 적극적
  if (mode === "batch" && durationSec >= 5) {
    const cap = getCapability(modelId);
    if (cap.supportsMultiShot && getMaxShots(modelId, durationSec) >= 2) {
      return buildDefaultMultiShot({
        durationSec,
        sceneType: sceneType as PlannerSceneType,
        basePrompt,
        modelId,
      });
    }
  }

  return existingMultiShot ?? [];
}

// ═══════════════════════════════════════════════════════════════════
// Full Plan Builder
// ═══════════════════════════════════════════════════════════════════

/**
 * 전체 멀티샷 계획 생성.
 *
 * UI에서 cut 생성 시 호출하여 기본 계획을 즉시 표시.
 */
export function buildMultiShotPlan(opts: {
  modelId: string;
  durationSec: number;
  sceneType?: PlannerSceneType;
  intentionalOneTake?: boolean;
}): MultiShotPlan {
  const {
    modelId,
    durationSec,
    sceneType = "default",
    intentionalOneTake = false,
  } = opts;

  const forced = shouldForceMultiShot(sceneType, durationSec, modelId);
  const oneTakeAllowed = isOneTakeAllowed(durationSec, intentionalOneTake);

  if (oneTakeAllowed && !forced) {
    return {
      shotCount: 1,
      roles: ["establish"],
      durations: [durationSec],
      forced: false,
      oneTakeAllowed: true,
      reasoning: durationSec <= 3
        ? `${durationSec}초 이하 — 단일 샷 기본`
        : "의도적 원테이크",
    };
  }

  const shotCount = planRecommendedShotCount(modelId, durationSec, sceneType);
  const effectiveCount = forced ? Math.max(2, shotCount) : shotCount;
  const roles = planShotRoles(effectiveCount);
  const cap = getCapability(modelId);
  const durations = distributeDurations(roles, durationSec, cap.minShotDuration);

  return {
    shotCount: effectiveCount,
    roles,
    durations,
    forced,
    oneTakeAllowed: !forced,
    reasoning: forced
      ? `${sceneType} + ${durationSec}초 — 멀티샷 강제 (리텐션 필수)`
      : `${sceneType} + ${durationSec}초 — ${effectiveCount}샷 추천`,
  };
}
