/**
 * _duration-constants.ts — 장면당 초 중앙 상수 (서버 함수용)
 *
 * 클라이언트는 @/lib/duration-reconciliation.ts 사용.
 * 서버 함수(Cloudflare Pages Functions)는 이 파일에서 import.
 */

/** 기본 fallback 값. 개별 파일에서 리터럴 8을 쓰지 말 것. */
export const DURATION_FALLBACK = 8;

/** 최소 허용 장면당 초 */
export const DURATION_MIN = 3;

/** 최대 허용 장면당 초 */
export const DURATION_MAX = 15;

/**
 * duration 값을 안전하게 해석.
 * 0/undefined/null/NaN → DURATION_FALLBACK.
 * 양수면 DURATION_MIN~DURATION_MAX 클램핑.
 */
export function safeDuration(v: number | undefined | null): number {
  const n = Number(v);
  if (!n || n <= 0 || !Number.isFinite(n)) return DURATION_FALLBACK;
  return Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(n)));
}

/**
 * auto duration 계산 — 서버 사이드.
 * cutDuration이 0/undefined면 totalDuration/cutCount 기반 계산.
 * 둘 다 없으면 sceneType 기반 기본값, 최후에 DURATION_FALLBACK.
 */
export function computeServerAutoDuration(
  cutDuration: number | undefined,
  totalDurationSeconds?: number,
  cutCount?: number,
  sceneType?: string,
): { duration: number; basis: string } {
  if (cutDuration && cutDuration > 0) {
    return { duration: Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(cutDuration))), basis: "explicit" };
  }

  if (totalDurationSeconds && totalDurationSeconds > 0 && cutCount && cutCount > 0) {
    const computed = Math.round(totalDurationSeconds / cutCount);
    return { duration: Math.min(DURATION_MAX, Math.max(DURATION_MIN, computed)), basis: "computed" };
  }

  if (sceneType) {
    const defaults: Record<string, number> = {
      "environment": 5, "transition-atmosphere": 4, "object-detail": 4,
      "portrait": 5, "map_visualization": 5, "map-graphic": 5, "product": 5,
      "person": 6, "character-driven": 6, "crowd": 6, "battle": 6,
      "cinematic_sequence": 6, "cinematic-sequence": 6,
    };
    if (defaults[sceneType]) {
      return { duration: defaults[sceneType], basis: "scene_default" };
    }
  }

  return { duration: DURATION_FALLBACK, basis: "emergency_fallback" };
}
