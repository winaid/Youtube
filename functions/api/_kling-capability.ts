/**
 * _kling-capability.ts — 서버 사이드 Kling capability (functions/api용)
 *
 * src/lib/kling-capability.ts와 동일한 정책을 서버 사이드에서 제공.
 * Cloudflare Functions는 @/lib/ import 불가 → 별도 파일로 유지.
 *
 * ⚠️ 정책 변경 시 src/lib/kling-capability.ts와 반드시 동기화할 것.
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface KlingModelCapability {
  modelId: string;
  displayName: string;
  maxShots: number;
  minShotDuration: number;
  maxDuration: number;
  minDuration: number;
  supportsMultiShot: boolean;
  supportsImageToVideo: boolean;
  supportsElements: boolean;
  supportsSound: boolean;
  fallbackModelId: string | null;
}

// ═══════════════════════════════════════════════════════════════════
// Model Registry — O3 기본, v3 fallback
// ═══════════════════════════════════════════════════════════════════

export const KLING_MODEL_REGISTRY: Record<string, KlingModelCapability> = {
  "kling-o3-text-to-video": {
    modelId: "kling-o3-text-to-video",
    displayName: "Kling O3 (Text)",
    maxShots: 6, minShotDuration: 2, maxDuration: 15, minDuration: 3,
    supportsMultiShot: true, supportsImageToVideo: false,
    supportsElements: true, supportsSound: true,
    fallbackModelId: "kling-v3-text-to-video",
  },
  "kling-o3-image-to-video": {
    modelId: "kling-o3-image-to-video",
    displayName: "Kling O3 (Image)",
    maxShots: 6, minShotDuration: 2, maxDuration: 15, minDuration: 3,
    supportsMultiShot: true, supportsImageToVideo: true,
    supportsElements: true, supportsSound: true,
    fallbackModelId: "kling-v3-image-to-video",
  },
  "kling-v3-text-to-video": {
    modelId: "kling-v3-text-to-video",
    displayName: "Kling v3 (Text)",
    maxShots: 3, minShotDuration: 3, maxDuration: 15, minDuration: 3,
    supportsMultiShot: true, supportsImageToVideo: false,
    supportsElements: true, supportsSound: true,
    fallbackModelId: null,
  },
  "kling-v3-image-to-video": {
    modelId: "kling-v3-image-to-video",
    displayName: "Kling v3 (Image)",
    maxShots: 3, minShotDuration: 3, maxDuration: 15, minDuration: 3,
    supportsMultiShot: true, supportsImageToVideo: true,
    supportsElements: true, supportsSound: true,
    fallbackModelId: null,
  },
};

// ═══════════════════════════════════════════════════════════════════
// Default Model Constants
// ═══════════════════════════════════════════════════════════════════

export const KLING_DEFAULT_TEXT_MODEL = "kling-o3-text-to-video";
export const KLING_DEFAULT_IMAGE_MODEL = "kling-o3-image-to-video";
export const KLING_DEFAULT_MODEL = KLING_DEFAULT_TEXT_MODEL;

export const KLING_MODELS = {
  TEXT_TO_VIDEO: KLING_DEFAULT_TEXT_MODEL,
  IMAGE_TO_VIDEO: KLING_DEFAULT_IMAGE_MODEL,
} as const;

export type KlingModelId = (typeof KLING_MODELS)[keyof typeof KLING_MODELS];

// ═══════════════════════════════════════════════════════════════════
// Capability Lookup
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_CAPABILITY = KLING_MODEL_REGISTRY[KLING_DEFAULT_TEXT_MODEL]!;

export function getCapability(modelId: string): KlingModelCapability {
  return KLING_MODEL_REGISTRY[modelId] ?? DEFAULT_CAPABILITY;
}

/**
 * 모델 capability + duration에 따른 "실질적 최대 샷 수".
 *
 * 정책:
 *   - duration ≤ 3초: 0
 *   - duration ≤ 5초: min(2, maxShots)
 *   - duration ≤ 7초: min(3, maxShots)
 *   - duration ≤ 10초: min(4, maxShots)
 *   - duration > 10초: maxShots
 *   - 추가: floor(duration / minShotDuration) 초과 불가
 */
export function getMaxShots(modelId: string, durationSec: number): number {
  const cap = getCapability(modelId);
  if (!cap.supportsMultiShot) return 0;
  if (durationSec <= 3) return 0;

  const modelLimit = cap.maxShots;
  let durationLimit: number;
  if (durationSec <= 5) durationLimit = 2;
  else if (durationSec <= 7) durationLimit = 3;
  else if (durationSec <= 10) durationLimit = 4;
  else durationLimit = modelLimit;

  const physicalLimit = Math.floor(durationSec / cap.minShotDuration);
  return Math.min(modelLimit, durationLimit, physicalLimit);
}

/**
 * multi-shot 배열 정규화 (slice + duration 보정 + index 재정렬).
 */
export function normalizeMultiShots(
  modelId: string,
  shots: Array<{ index: number; prompt: string; duration: string }>,
  totalDurationSec: number,
): Array<{ index: number; prompt: string; duration: string }> {
  const maxShots = getMaxShots(modelId, totalDurationSec);
  if (maxShots <= 0 || shots.length === 0) return [];

  const cap = getCapability(modelId);
  const clamped = shots.slice(0, maxShots);

  const normalized = clamped.map((s, i) => ({
    index: i + 1,
    prompt: s.prompt,
    duration: String(Math.max(cap.minShotDuration, parseInt(s.duration, 10) || cap.minShotDuration)),
  }));

  const currentTotal = normalized.reduce((sum, s) => sum + parseInt(s.duration, 10), 0);
  if (currentTotal !== totalDurationSec && normalized.length > 0) {
    const diff = totalDurationSec - currentTotal;
    const lastDur = parseInt(normalized[normalized.length - 1].duration, 10) + diff;
    if (lastDur >= cap.minShotDuration) {
      normalized[normalized.length - 1].duration = String(lastDur);
    }
  }

  return normalized;
}

export function resolveModel(requestedModel: string | undefined, hasImage: boolean): string {
  if (requestedModel) return requestedModel;
  return hasImage ? KLING_DEFAULT_IMAGE_MODEL : KLING_DEFAULT_TEXT_MODEL;
}

export function resolveModelWithFallback(modelId: string): [string, boolean] {
  const cap = KLING_MODEL_REGISTRY[modelId];
  if (!cap) return [KLING_DEFAULT_TEXT_MODEL, true];
  if (cap.fallbackModelId && KLING_MODEL_REGISTRY[cap.fallbackModelId]) {
    return [cap.fallbackModelId, true];
  }
  return [modelId, false];
}

export function isO3Model(modelId: string): boolean {
  return modelId.includes("-o3-");
}
