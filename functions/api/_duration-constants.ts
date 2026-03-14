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
 * 멀티컷 편집 우선 scene defaults.
 * insert/detail=3s, establish/environment=4s, human/action=4-5s.
 */
const SCENE_DEFAULTS: Record<string, number> = {
  "object-detail": 3, "transition-atmosphere": 3, "product": 3,
  "environment": 4, "portrait": 4, "map_visualization": 4, "map-graphic": 4,
  "person": 5, "character-driven": 5, "crowd": 5, "battle": 5,
  "cinematic_sequence": 5, "cinematic-sequence": 5,
};

/**
 * auto duration 계산 — 서버 사이드.
 * cutDuration이 0/undefined면 totalDuration/cutCount 기반 계산.
 * 둘 다 없으면 sceneType 기반 기본값, 최후에 DURATION_FALLBACK.
 *
 * @param editorialPace - editorial persona의 preferredCutPace [min, max]
 */
export function computeServerAutoDuration(
  cutDuration: number | undefined,
  totalDurationSeconds?: number,
  cutCount?: number,
  sceneType?: string,
  editorialPace?: [number, number],
): { duration: number; basis: string } {
  // 1. 명시 cutDuration
  if (cutDuration && cutDuration > 0) {
    return { duration: Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(cutDuration))), basis: "explicit" };
  }

  // 2. totalDuration / cutCount 기반
  if (totalDurationSeconds && totalDurationSeconds > 0 && cutCount && cutCount > 0) {
    const computed = Math.round(totalDurationSeconds / cutCount);
    return { duration: Math.min(DURATION_MAX, Math.max(DURATION_MIN, computed)), basis: "computed" };
  }

  // 2b. totalDuration만 있고 cutCount 없음 → totalDuration 기반 적정 cutDuration 추정
  // editorialPace에만 의존하면 3초 고정 등 비정상 결과 발생 가능
  if (totalDurationSeconds && totalDurationSeconds > 0) {
    let optimalDur: number;
    if (totalDurationSeconds <= 40) {
      optimalDur = 4;
    } else if (totalDurationSeconds <= 90) {
      optimalDur = 5;
    } else if (totalDurationSeconds <= 180) {
      optimalDur = 5;
    } else {
      optimalDur = 5;
    }
    // editorialPace가 있으면 blend (그러나 과도한 축소 방지: 최소 4초)
    if (editorialPace) {
      const paceMid = Math.round((editorialPace[0] + editorialPace[1]) / 2);
      const blended = Math.round((optimalDur + paceMid) / 2);
      return { duration: Math.min(DURATION_MAX, Math.max(4, blended)), basis: "totalDuration_pace_blend" };
    }
    return { duration: optimalDur, basis: "totalDuration_auto" };
  }

  // 3. sceneType 기반
  if (sceneType) {
    const sceneDur = SCENE_DEFAULTS[sceneType];
    if (sceneDur) {
      if (editorialPace) {
        const paceMid = Math.round((editorialPace[0] + editorialPace[1]) / 2);
        const blended = Math.round((sceneDur + paceMid) / 2);
        return { duration: Math.min(DURATION_MAX, Math.max(DURATION_MIN, blended)), basis: "scene_default" };
      }
      return { duration: sceneDur, basis: "scene_default" };
    }
  }

  // 4. editorialPace only (최소 4초 보장 — 3초 고정 방지)
  if (editorialPace) {
    const paceMid = Math.round((editorialPace[0] + editorialPace[1]) / 2);
    return { duration: Math.min(DURATION_MAX, Math.max(4, paceMid)), basis: "editorial_pace" };
  }

  // 5. emergency fallback
  return { duration: DURATION_FALLBACK, basis: "emergency_fallback" };
}
