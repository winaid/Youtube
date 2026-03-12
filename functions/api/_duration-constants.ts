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
