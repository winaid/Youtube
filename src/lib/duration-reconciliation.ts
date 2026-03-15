/**
 * duration-reconciliation.ts — 장면당 초 / 장면 수 / 총 길이 정합성 계산
 *
 * 입력: totalDurationSeconds, sceneCount, secondsPerScene, mode(auto/manual)
 * 출력: reconciled 값 + warnings
 *
 * 규칙:
 *   - secondsPerScene=0 → "자동" (서버에서 계산)
 *   - secondsPerScene 1~15 → 명시값
 *   - 충돌 시 secondsPerScene을 우선하고 sceneCount를 재계산
 *   - API payload에서 0은 null/undefined로 변환
 */

export interface DurationReconcileInput {
  /** 총 영상 길이 (초). 60/90/120 등. 0이면 auto. */
  totalDurationSeconds: number;
  /** 장면 수. 0이면 auto. */
  sceneCount: number;
  /** 장면당 초. 0이면 auto, 1~15이면 명시값. */
  secondsPerScene: number;
}

export interface DurationReconcileResult {
  /** 보정된 총 길이 (초) */
  reconciledTotalDurationSeconds: number;
  /** 보정된 장면 수 */
  reconciledSceneCount: number;
  /** 보정된 장면당 초 (0이면 auto) */
  reconciledSecondsPerScene: number;
  /** 경고 메시지 */
  warnings: string[];
  /** 어떤 기준으로 보정했는지 */
  basis: "secondsPerScene" | "sceneCount" | "auto";
}

/** Kling 지원 범위: 3~15초. UI 0~15, 실제 전송은 3~15 클램핑. */
export const DURATION_MIN = 3;
export const DURATION_MAX = 15;
export const DURATION_SLIDER_MIN = 0;
export const DURATION_SLIDER_MAX = 15;

/**
 * 중앙 fallback 기본값. 개별 파일에서 리터럴 8을 쓰지 말 것.
 * duration이 undefined/null/0/NaN일 때만 사용.
 */
export const DURATION_FALLBACK = 8;

/** 프리셋 빠른 버튼 */
export const DURATION_PRESETS = [4, 6, 8, 10, 15] as const;

/**
 * duration 값을 안전하게 해석. 0/undefined/null/NaN → DURATION_FALLBACK.
 * 양수면 DURATION_MIN~DURATION_MAX 클램핑.
 * 모든 downstream 함수에서 `|| 8` 대신 이 함수를 사용.
 *
 * 주의: 이 함수는 "auto 의미를 해석한 후" 호출해야 한다.
 * auto 상태에서 값을 결정하려면 먼저 computeAutoDuration()을 사용.
 */
export function safeDuration(v: number | undefined | null): number {
  const n = Number(v);
  if (!n || n <= 0 || !Number.isFinite(n)) return DURATION_FALLBACK;
  return Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(n)));
}

/**
 * auto duration 해석 — 명시값이 없을 때 사용할 duration 결정.
 *
 * 우선순위:
 *   1. explicit (cutDuration > 0) → 그대로
 *   2. recommendedDuration (AI 추천) → 그 값
 *   3. totalDuration / cutCount 기반 계산
 *   4. sceneType 기반 기본값
 *   5. DURATION_FALLBACK (emergency)
 *
 * @returns 결정된 duration + 어떤 basis로 결정했는지
 */
export interface AutoDurationInput {
  /** 사용자 명시 장면당 초. 0/undefined → auto */
  cutDuration?: number;
  /** AI 추천 장면당 초. analyze-cuts 결과 */
  recommendedDuration?: number;
  /** 전체 영상 목표 길이(초) */
  totalDurationSeconds?: number;
  /** 장면 수 */
  cutCount?: number;
  /** 장면 유형 (environment, character-driven 등) */
  sceneType?: string;
  /** editorial persona의 preferredCutPace [min, max] */
  editorialPace?: [number, number];
}

export interface AutoDurationResult {
  duration: number;
  basis: "explicit" | "recommended" | "computed" | "scene_default" | "emergency_fallback";
}

/**
 * 멀티컷 편집 우선 scene defaults.
 * insert/detail=3s, establish/environment=4s, human/action=4-5s.
 * 8s 단일 컷은 예외적인 경우에만 사용.
 */
const SCENE_DEFAULTS: Record<string, number> = {
  "object-detail": 3,
  "transition-atmosphere": 3,
  "product": 3,
  "environment": 4,
  "portrait": 4,
  "map_visualization": 4,
  "map-graphic": 4,
  "person": 5,
  "character-driven": 5,
  "crowd": 5,
  "battle": 5,
  "cinematic_sequence": 5,
  "cinematic-sequence": 5,
};

export function computeAutoDuration(input: AutoDurationInput): AutoDurationResult {
  const { cutDuration, recommendedDuration, totalDurationSeconds, cutCount, sceneType, editorialPace } = input;

  // 1. explicit
  if (cutDuration && cutDuration > 0) {
    return { duration: Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(cutDuration))), basis: "explicit" };
  }

  // 2. AI recommendation
  if (recommendedDuration && recommendedDuration > 0) {
    return { duration: Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(recommendedDuration))), basis: "recommended" };
  }

  // 3. totalDuration / cutCount 기반 계산
  if (totalDurationSeconds && totalDurationSeconds > 0 && cutCount && cutCount > 0) {
    const computed = Math.round(totalDurationSeconds / cutCount);
    const clamped = Math.min(DURATION_MAX, Math.max(DURATION_MIN, computed));
    return { duration: clamped, basis: "computed" };
  }

  // 4. sceneType + editorialPace 기반 기본값
  if (sceneType) {
    const sceneDur = SCENE_DEFAULTS[sceneType];
    if (sceneDur) {
      // editorial persona의 pace가 있으면 scene default와 blend
      if (editorialPace) {
        const paceMid = Math.round((editorialPace[0] + editorialPace[1]) / 2);
        const blended = Math.round((sceneDur + paceMid) / 2);
        return { duration: Math.min(DURATION_MAX, Math.max(DURATION_MIN, blended)), basis: "scene_default" };
      }
      return { duration: sceneDur, basis: "scene_default" };
    }
  }

  // 4b. editorialPace만 있고 sceneType 없을 때
  if (editorialPace) {
    const paceMid = Math.round((editorialPace[0] + editorialPace[1]) / 2);
    return { duration: Math.min(DURATION_MAX, Math.max(DURATION_MIN, paceMid)), basis: "scene_default" };
  }

  // 5. emergency fallback
  return { duration: DURATION_FALLBACK, basis: "emergency_fallback" };
}

/**
 * secondsPerScene을 API payload용 값으로 변환.
 * 0 → undefined (서버 자동), 1~2 → 3 (최소값), 3~15 → 그대로.
 */
export function toApiSecondsPerScene(sliderValue: number): number | undefined {
  if (sliderValue === 0) return undefined;
  return Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(sliderValue)));
}

/**
 * 슬라이더 값에 대한 UI 라벨 반환.
 */
export function durationLabel(sliderValue: number): string {
  if (sliderValue === 0) return "자동";
  return `${sliderValue}초`;
}

/**
 * 슬라이더 값에 대한 설명 텍스트 반환.
 */
export function durationDescription(sliderValue: number): string {
  if (sliderValue === 0) return "길이와 장면 수를 기준으로 자동 계산";
  return `각 장면을 ${sliderValue}초 기준으로 생성`;
}

/**
 * 총 길이, 장면 수, 장면당 초 사이의 정합성 검증 및 보정.
 */
export function reconcileDuration(input: DurationReconcileInput): DurationReconcileResult {
  const { totalDurationSeconds, sceneCount, secondsPerScene } = input;
  const warnings: string[] = [];

  // 모두 auto → 기본값 반환
  if (secondsPerScene === 0 && sceneCount === 0 && totalDurationSeconds === 0) {
    return {
      reconciledTotalDurationSeconds: 0,
      reconciledSceneCount: 0,
      reconciledSecondsPerScene: 0,
      warnings: [],
      basis: "auto",
    };
  }

  // secondsPerScene 명시 + sceneCount 명시 → 충돌 체크
  if (secondsPerScene > 0 && sceneCount > 0) {
    const expectedTotal = secondsPerScene * sceneCount;
    if (totalDurationSeconds > 0 && Math.abs(expectedTotal - totalDurationSeconds) > 1) {
      warnings.push(
        `장면당 ${secondsPerScene}초 × ${sceneCount}장면 = ${expectedTotal}초이지만, ` +
        `총 길이 ${totalDurationSeconds}초와 불일치합니다. 장면당 초(${secondsPerScene}초)를 기준으로 보정합니다.`,
      );
    }
    return {
      reconciledTotalDurationSeconds: expectedTotal,
      reconciledSceneCount: sceneCount,
      reconciledSecondsPerScene: secondsPerScene,
      warnings,
      basis: "secondsPerScene",
    };
  }

  // secondsPerScene 명시, sceneCount auto → sceneCount 역산
  if (secondsPerScene > 0 && sceneCount === 0) {
    if (totalDurationSeconds > 0) {
      const computed = Math.max(1, Math.round(totalDurationSeconds / secondsPerScene));
      return {
        reconciledTotalDurationSeconds: computed * secondsPerScene,
        reconciledSceneCount: computed,
        reconciledSecondsPerScene: secondsPerScene,
        warnings,
        basis: "secondsPerScene",
      };
    }
    // total도 auto → 장면 수만 미정
    return {
      reconciledTotalDurationSeconds: 0,
      reconciledSceneCount: 0,
      reconciledSecondsPerScene: secondsPerScene,
      warnings,
      basis: "secondsPerScene",
    };
  }

  // secondsPerScene auto, sceneCount 명시 → secondsPerScene 역산
  if (secondsPerScene === 0 && sceneCount > 0) {
    if (totalDurationSeconds > 0) {
      const computed = Math.max(DURATION_MIN, Math.round(totalDurationSeconds / sceneCount));
      const clamped = Math.min(DURATION_MAX, computed);
      if (computed !== clamped) {
        warnings.push(`계산된 장면당 초(${computed}초)가 범위를 벗어나 ${clamped}초로 조정됩니다.`);
      }
      return {
        reconciledTotalDurationSeconds: clamped * sceneCount,
        reconciledSceneCount: sceneCount,
        reconciledSecondsPerScene: clamped,
        warnings,
        basis: "sceneCount",
      };
    }
    return {
      reconciledTotalDurationSeconds: 0,
      reconciledSceneCount: sceneCount,
      reconciledSecondsPerScene: 0,
      warnings,
      basis: "sceneCount",
    };
  }

  // 나머지 → auto
  return {
    reconciledTotalDurationSeconds: totalDurationSeconds,
    reconciledSceneCount: sceneCount,
    reconciledSecondsPerScene: secondsPerScene,
    warnings,
    basis: "auto",
  };
}

// ═══════════════════════════════════════════════════════════════════
// Duration Summary Helpers — actual cuts 기반 source of truth
// ═══════════════════════════════════════════════════════════════════

export interface DurationSummaryInput {
  /** 실제 생성된 cuts의 durationSec 배열 */
  cuts: Array<{ durationSec: number }>;
  /** 사용자 요청 장면당 초 (0 = auto) */
  requestedSecondsPerScene?: number;
  /** auto duration 결정 basis */
  durationBasis?: string;
}

export interface DurationSummaryResult {
  /** 실제 장면 수 */
  actualSceneCount: number;
  /** 실제 총 길이 (초) */
  actualTotalDurationSeconds: number;
  /** 자동 모드 여부 */
  isAutoMode: boolean;
  /** 헤드라인 summary 텍스트 (actual 기준) */
  headline: string;
  /** 보조 정보 텍스트 (requested vs actual) */
  detail: string;
  /** duration 범위 (최소~최대) */
  durationRange?: { min: number; max: number };
  /** 리듬 대비 있는지 여부 */
  hasRhythmContrast?: boolean;
}

/**
 * actual cuts 기반으로 duration summary를 생성.
 * auto 모드에서는 곱셈 수식 금지.
 * 명시 모드에서는 requested vs actual 분리 표기.
 */
export function buildDurationSummary(input: DurationSummaryInput): DurationSummaryResult {
  const { cuts, requestedSecondsPerScene, durationBasis } = input;
  const actualSceneCount = cuts.length;
  const actualTotalDurationSeconds = cuts.reduce((s, c) => s + (c.durationSec ?? DURATION_FALLBACK), 0);
  const isAutoMode = !requestedSecondsPerScene || requestedSecondsPerScene <= 0;

  let headline: string;
  let detail: string;

  // duration 범위 계산
  const durations = cuts.map(c => c.durationSec ?? DURATION_FALLBACK);
  const minDur = durations.length > 0 ? Math.min(...durations) : 0;
  const maxDur = durations.length > 0 ? Math.max(...durations) : 0;
  const hasRhythmContrast = maxDur - minDur >= 2;

  if (isAutoMode) {
    // 자동 모드: 곱셈 수식 금지, actual 기준만 표시
    const avgSec = actualSceneCount > 0
      ? Math.round(actualTotalDurationSeconds / actualSceneCount * 10) / 10
      : 0;
    // 리듬 대비가 있으면 범위 표시, 없으면 평균만 표시
    if (hasRhythmContrast) {
      headline = `${actualSceneCount}컷 · ${minDur}~${maxDur}초 · 총 ${actualTotalDurationSeconds}초`;
    } else {
      headline = `${actualSceneCount}컷 · 평균 ${avgSec}초 · 총 ${actualTotalDurationSeconds}초`;
    }
    const basisLabel = durationBasis
      ? ` (${durationBasis})`
      : "";
    detail = hasRhythmContrast
      ? `리듬 분배 적용 · 평균 ${avgSec}초${basisLabel}`
      : `자동 편집 리듬 + 밀도 보정 적용${basisLabel}`;
  } else {
    // 명시 모드
    const requestedTotal = requestedSecondsPerScene * actualSceneCount;
    if (requestedTotal === actualTotalDurationSeconds) {
      // 일치: 곱셈 수식 허용
      headline = `${requestedSecondsPerScene}초 x ${actualSceneCount}장면 = ${actualTotalDurationSeconds}초`;
      detail = "";
    } else {
      // 불일치: requested vs actual 분리
      headline = `${actualSceneCount}장면, 실제 계획 총 ${actualTotalDurationSeconds}초`;
      detail = `요청: ${requestedSecondsPerScene}초/장면 (${requestedTotal}초) → 실제: ${actualTotalDurationSeconds}초 (자동 보정됨)`;
    }
  }

  return {
    actualSceneCount,
    actualTotalDurationSeconds,
    isAutoMode,
    headline,
    detail,
    durationRange: durations.length > 0 ? { min: minDur, max: maxDur } : undefined,
    hasRhythmContrast,
  };
}
