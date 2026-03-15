/**
 * kling-capability.ts — Kling 모델별 capability 정의 (중앙 정책)
 *
 * 핵심 목적:
 *   1. 모델별 maxShots, minShotDuration, maxDuration 등을 한 곳에서 관리
 *   2. 서버(_kling-api.ts)와 클라이언트(useVideoGeneration.ts)가 동일 정책 공유
 *   3. duration 기반 "실질적 최대 샷 수" 계산 — 무조건 6샷이 아닌, 자연스러운 상한
 *   4. 모델 fallback 체인 지원
 *
 * 설계 원칙:
 *   - O3가 기본 모델 (main path)
 *   - v3는 하위 호환 fallback 경로
 *   - getMaxShots()는 capability + runtime 현실성을 함께 반영
 *
 * grep: KlingModelCapability, getCapability, getMaxShots,
 *       resolveModelWithFallback, KLING_DEFAULT_MODEL
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface KlingModelCapability {
  /** 모델 식별자 (API에 전달되는 값) */
  modelId: string;
  /** 사람이 읽을 수 있는 모델명 */
  displayName: string;
  /** multi-shot 최대 샷 수 (모델 하드 리밋) */
  maxShots: number;
  /** 개별 샷 최소 duration (초) */
  minShotDuration: number;
  /** 영상 최대 duration (초) */
  maxDuration: number;
  /** 영상 최소 duration (초) */
  minDuration: number;
  /** multi-shot 지원 여부 */
  supportsMultiShot: boolean;
  /** image-to-video 지원 여부 */
  supportsImageToVideo: boolean;
  /** custom element (element_list) 지원 여부 */
  supportsElements: boolean;
  /** sound 파라미터 지원 여부 */
  supportsSound: boolean;
  /** fallback 모델 ID (이 모델 접근 불가 시 대체) */
  fallbackModelId: string | null;
}

// ═══════════════════════════════════════════════════════════════════
// Model Registry
// ═══════════════════════════════════════════════════════════════════

/**
 * 모델 capability 레지스트리.
 *
 * O3 = 기본 모델 (6샷, minShotDuration 2초)
 * v3 = 레거시 fallback (3샷, minShotDuration 3초)
 */
export const KLING_MODEL_REGISTRY: Record<string, KlingModelCapability> = {
  // ── O3 계열 (기본) ──
  "kling-o3-text-to-video": {
    modelId: "kling-o3-text-to-video",
    displayName: "Kling O3 (Text)",
    maxShots: 6,
    minShotDuration: 2,
    maxDuration: 15,
    minDuration: 3,
    supportsMultiShot: true,
    supportsImageToVideo: false,
    supportsElements: true,
    supportsSound: true,
    fallbackModelId: "kling-v3-text-to-video",
  },
  "kling-o3-image-to-video": {
    modelId: "kling-o3-image-to-video",
    displayName: "Kling O3 (Image)",
    maxShots: 6,
    minShotDuration: 2,
    maxDuration: 15,
    minDuration: 3,
    supportsMultiShot: true,
    supportsImageToVideo: true,
    supportsElements: true,
    supportsSound: true,
    fallbackModelId: "kling-v3-image-to-video",
  },

  // ── v3 계열 (레거시 fallback) ──
  "kling-v3-text-to-video": {
    modelId: "kling-v3-text-to-video",
    displayName: "Kling v3 (Text)",
    maxShots: 3,
    minShotDuration: 3,
    maxDuration: 15,
    minDuration: 3,
    supportsMultiShot: true,
    supportsImageToVideo: false,
    supportsElements: true,
    supportsSound: true,
    fallbackModelId: null,
  },
  "kling-v3-image-to-video": {
    modelId: "kling-v3-image-to-video",
    displayName: "Kling v3 (Image)",
    maxShots: 3,
    minShotDuration: 3,
    maxDuration: 15,
    minDuration: 3,
    supportsMultiShot: true,
    supportsImageToVideo: true,
    supportsElements: true,
    supportsSound: true,
    fallbackModelId: null,
  },
};

// ═══════════════════════════════════════════════════════════════════
// Default Model Constants
// ═══════════════════════════════════════════════════════════════════

/** 기본 text-to-video 모델 (O3) */
export const KLING_DEFAULT_TEXT_MODEL = "kling-o3-text-to-video";

/** 기본 image-to-video 모델 (O3) */
export const KLING_DEFAULT_IMAGE_MODEL = "kling-o3-image-to-video";

/** 기본 모델 (O3 text-to-video) */
export const KLING_DEFAULT_MODEL = KLING_DEFAULT_TEXT_MODEL;

/**
 * KLING_MODELS 호환 상수 — 기존 import를 유지하면서 O3로 전환.
 * _kling-api.ts의 KLING_MODELS를 이 모듈로 대체.
 */
export const KLING_MODELS = {
  TEXT_TO_VIDEO: KLING_DEFAULT_TEXT_MODEL,
  IMAGE_TO_VIDEO: KLING_DEFAULT_IMAGE_MODEL,
} as const;

export type KlingModelId = (typeof KLING_MODELS)[keyof typeof KLING_MODELS];

// ═══════════════════════════════════════════════════════════════════
// Capability Lookup
// ═══════════════════════════════════════════════════════════════════

/** O3 text-to-video capability — 알 수 없는 모델의 기본값 */
const DEFAULT_CAPABILITY = KLING_MODEL_REGISTRY[KLING_DEFAULT_TEXT_MODEL]!;

/**
 * 모델 ID로 capability를 조회한다.
 * 등록되지 않은 모델이면 O3 text-to-video 기본값을 반환한다.
 */
export function getCapability(modelId: string): KlingModelCapability {
  return KLING_MODEL_REGISTRY[modelId] ?? DEFAULT_CAPABILITY;
}

/**
 * 모델 capability + duration에 따른 "실질적 최대 샷 수"를 계산한다.
 *
 * 단순히 모델의 maxShots를 반환하는 게 아니라,
 * duration이 짧으면 자연스럽게 덜 추천한다.
 *
 * 정책:
 *   - duration ≤ 3초: 0 (multiShot 비활성)
 *   - duration ≤ 5초: min(2, maxShots)
 *   - duration ≤ 7초: min(3, maxShots)
 *   - duration ≤ 10초: min(4, maxShots)
 *   - duration > 10초: maxShots (모델 하드 리밋)
 *
 * 추가 제약: floor(duration / minShotDuration)을 초과할 수 없음
 *
 * @param modelId — 모델 식별자
 * @param durationSec — 영상 총 duration (초)
 */
export function getMaxShots(modelId: string, durationSec: number): number {
  const cap = getCapability(modelId);

  if (!cap.supportsMultiShot) return 0;
  if (durationSec <= 3) return 0;

  // 모델 하드 리밋
  const modelLimit = cap.maxShots;

  // duration 기반 자연스러운 상한
  let durationLimit: number;
  if (durationSec <= 5) durationLimit = 2;
  else if (durationSec <= 7) durationLimit = 3;
  else if (durationSec <= 10) durationLimit = 4;
  else durationLimit = modelLimit;

  // 물리적 상한: 각 샷이 minShotDuration 이상이어야 함
  const physicalLimit = Math.floor(durationSec / cap.minShotDuration);

  return Math.min(modelLimit, durationLimit, physicalLimit);
}

/**
 * 개별 샷의 duration을 검증하고, 최소값 미만이면 보정한다.
 *
 * @returns 보정된 duration (초, 정수)
 */
export function clampShotDuration(modelId: string, shotDurationSec: number): number {
  const cap = getCapability(modelId);
  return Math.max(cap.minShotDuration, Math.round(shotDurationSec));
}

/**
 * multi-shot 배열을 검증하고 정규화한다.
 *
 * 1. maxShots 초과 시 slice
 * 2. 개별 duration 보정 (minShotDuration 이상)
 * 3. index 재정렬 (1-based 순차)
 * 4. duration 합이 totalDuration과 맞도록 마지막 샷 조정
 *
 * @returns 정규화된 MultiShot 배열 (빈 배열 = multiShot 비활성)
 */
export function normalizeMultiShots(
  modelId: string,
  shots: Array<{ index: number; prompt: string; duration: string }>,
  totalDurationSec: number,
): Array<{ index: number; prompt: string; duration: string }> {
  const maxShots = getMaxShots(modelId, totalDurationSec);
  if (maxShots <= 0 || shots.length === 0) return [];

  const cap = getCapability(modelId);

  // 1. maxShots 초과 slice
  const clamped = shots.slice(0, maxShots);

  // 2. 개별 duration 보정 + index 재정렬
  const normalized = clamped.map((s, i) => ({
    index: i + 1,
    prompt: s.prompt,
    duration: String(Math.max(cap.minShotDuration, parseInt(s.duration, 10) || cap.minShotDuration)),
  }));

  // 3. duration 합 조정 — 마지막 샷으로 remainder 흡수
  const currentTotal = normalized.reduce((sum, s) => sum + parseInt(s.duration, 10), 0);
  if (currentTotal !== totalDurationSec && normalized.length > 0) {
    const diff = totalDurationSec - currentTotal;
    const lastDur = parseInt(normalized[normalized.length - 1].duration, 10) + diff;
    if (lastDur >= cap.minShotDuration) {
      normalized[normalized.length - 1].duration = String(lastDur);
    }
    // lastDur < minShotDuration인 경우는 총 duration이 너무 짧은 것 — 그대로 둠
  }

  return normalized;
}

// ═══════════════════════════════════════════════════════════════════
// Model Resolution & Fallback
// ═══════════════════════════════════════════════════════════════════

/**
 * 요청된 모델이 없거나, 이미지 존재 여부에 따라 적절한 모델을 선택한다.
 *
 * @param requestedModel — 사용자/시스템이 요청한 모델 (undefined면 기본값)
 * @param hasImage — 이미지가 포함된 요청인지
 */
export function resolveModel(requestedModel: string | undefined, hasImage: boolean): string {
  if (requestedModel) return requestedModel;
  return hasImage ? KLING_DEFAULT_IMAGE_MODEL : KLING_DEFAULT_TEXT_MODEL;
}

/**
 * 모델 접근 불가 시 fallback 체인을 따라 대체 모델을 찾는다.
 *
 * @returns [resolvedModelId, wasFallback]
 */
export function resolveModelWithFallback(modelId: string): [string, boolean] {
  const cap = KLING_MODEL_REGISTRY[modelId];
  if (!cap) return [KLING_DEFAULT_TEXT_MODEL, true];
  if (cap.fallbackModelId && KLING_MODEL_REGISTRY[cap.fallbackModelId]) {
    return [cap.fallbackModelId, true];
  }
  return [modelId, false];
}

/**
 * 모델이 O3 계열인지 판정한다.
 */
export function isO3Model(modelId: string): boolean {
  return modelId.includes("-o3-");
}

/**
 * 모델이 v3 (레거시) 계열인지 판정한다.
 */
export function isV3Model(modelId: string): boolean {
  return modelId.includes("-v3-");
}
