/**
 * _shortform-rhythm.ts — 숏폼 리듬 정책 + secPerCut/targetCuts reconciliation
 *
 * 핵심 원칙: "숏폼 리듬 > 감독 스타일"
 * totalDuration을 최상위 기준으로, secPerCut/targetCuts/shotDensity가
 * 서로 모순되지 않는 reconciled plan을 생성한다.
 *
 * 감독 페르소나는 컷 수를 줄일 권한이 없다.
 * 감독 페르소나는 톤/조명/카메라/무드에만 영향을 준다.
 */

import { DURATION_MIN, DURATION_MAX } from "./_duration-constants";

// ═══════════════════════════════════════════════════════════════════
// Shortform Duration Band Policy
// ═══════════════════════════════════════════════════════════════════

export interface ShortformBandPolicy {
  /** Duration band label */
  band: string;
  /** Minimum cut count (hard floor) */
  minCuts: number;
  /** Preferred/recommended cut count */
  preferredCuts: number;
  /** Maximum allowed seconds per cut in this band */
  maxSecPerCut: number;
  /** Minimum meaningful multi-shot count per cut */
  minShotsPerCut: number;
  /** Whether this band has special shortform handling */
  isShortformBand: boolean;
  /** Reserved (legacy) */
  is13to15Special: false;
}

/**
 * totalDuration → shortform band 정책 반환.
 *
 * 확정 규칙 (2026-03):
 * - ≤5초: micro (1컷)
 * - 6~8초: short (최소 3컷, VEO 단일 클립 최대 8초)
 * - 9초+: over-limit (shortform 범위 초과, mid-form 이상은 세그먼트 분할)
 */
export function resolveShortformBandPolicy(totalDurationSec: number): ShortformBandPolicy {
  if (totalDurationSec <= 0) {
    return { band: "unknown", minCuts: 1, preferredCuts: 3, maxSecPerCut: DURATION_MAX, minShotsPerCut: 1, isShortformBand: false, is13to15Special: false };
  }

  // ≤5초: 마이크로 클립
  if (totalDurationSec <= 5) {
    return { band: "micro", minCuts: 1, preferredCuts: 1, maxSecPerCut: 5, minShotsPerCut: 1, isShortformBand: true, is13to15Special: false };
  }

  // 6~8초: 숏 클립 — 최소 3컷 (VEO 단일 클립 최대 8초)
  if (totalDurationSec <= 8) {
    return { band: "short", minCuts: 3, preferredCuts: 3, maxSecPerCut: 3, minShotsPerCut: 2, isShortformBand: true, is13to15Special: false };
  }

  // 9초+: shortform 범위 초과 — 세그먼트 분할 필요
  // reconciliation에서는 이 band가 오면 에러로 처리해야 함
  return { band: "over-limit", minCuts: 0, preferredCuts: 0, maxSecPerCut: 0, minShotsPerCut: 0, isShortformBand: false, is13to15Special: false };
}

// ═══════════════════════════════════════════════════════════════════
// Reconciled Cut Plan
// ═══════════════════════════════════════════════════════════════════

export interface ReconciledCutPlan {
  /** 최종 확정된 컷 수 */
  cutCount: number;
  /** 최종 확정된 컷당 초 (totalDuration / cutCount 기반) */
  secPerCut: number;
  /** 원본 totalDuration */
  totalDurationSec: number;
  /** 적용된 shortform band 정책 */
  bandPolicy: ShortformBandPolicy;

  /** 감독이 원한 secPerCut (reconciliation 전) */
  personaWantedSecPerCut: number;
  /** density 규칙이 산출한 targetCuts (reconciliation 전) */
  densityTargetCuts: number;

  /** reconciliation이 적용되었는지 */
  reconciled: boolean;
  /** reconciliation 적용 이유 */
  reconciliationNotes: string[];

  /** 감독 pace가 다운웨이트되었는지 */
  directorPaceDownweighted: boolean;
  /** shortform rhythm rule이 적용되었는지 */
  shortformRhythmApplied: boolean;
}

/**
 * totalDuration + densityTargetCuts + personaSecPerCut → 모순 없는 plan 생성.
 *
 * 우선순위:
 * 1. totalDuration (절대 기준)
 * 2. shortform band policy (시스템 규칙)
 * 3. density minimum (시스템 규칙)
 * 4. director pace (soft preference — 밀도/리듬과 충돌하면 희생)
 */
export function reconcileShortformPlan(opts: {
  totalDurationSec: number;
  densityTargetCuts: number;
  personaSecPerCut: number;
  personaBias?: "lower" | "upper" | "neutral";
  exactCutCount?: number;
}): ReconciledCutPlan {
  const { totalDurationSec, densityTargetCuts, personaSecPerCut, personaBias = "neutral", exactCutCount } = opts;
  const notes: string[] = [];
  let reconciled = false;
  let directorPaceDownweighted = false;

  const bandPolicy = resolveShortformBandPolicy(totalDurationSec);

  // multi-segment 콘텐츠 (> 15s) → shortform band 규칙 비적용.
  // 8초 초과는 여러 VEO 세그먼트로 구성된 장편 콘텐츠이므로
  // shortform rhythm을 적용하지 않고, density/persona 기반으로 진행.
  if (bandPolicy.band === "over-limit") {
    const effectiveCuts = exactCutCount && exactCutCount > 0
      ? exactCutCount
      : Math.max(densityTargetCuts, Math.ceil(totalDurationSec / DURATION_MAX));
    const effectiveSecPerCut = Math.floor(totalDurationSec / effectiveCuts);
    notes.push(`totalDuration(${totalDurationSec}s) > 15s — multi-segment mode, shortform rhythm 비적용`);
    return {
      cutCount: effectiveCuts,
      secPerCut: Math.min(effectiveSecPerCut, DURATION_MAX),
      totalDurationSec,
      bandPolicy,
      personaWantedSecPerCut: personaSecPerCut,
      densityTargetCuts,
      reconciled: effectiveCuts !== densityTargetCuts,
      reconciliationNotes: notes,
      directorPaceDownweighted: false,
      shortformRhythmApplied: false,
    };
  }

  // Step 1: cutCount 결정 — band minimum ≥ density target ≥ exactCutCount
  let cutCount = densityTargetCuts;

  // exactCutCount가 있으면 존중하되 band minimum 이하로는 못 내림
  if (exactCutCount && exactCutCount > 0) {
    cutCount = exactCutCount;
    if (cutCount < bandPolicy.minCuts) {
      notes.push(`exact cutCount(${cutCount}) < band minimum(${bandPolicy.minCuts}), raised to band minimum`);
      cutCount = bandPolicy.minCuts;
      reconciled = true;
    }
  } else {
    // band preferred와 density target 중 더 높은 값 사용
    if (bandPolicy.isShortformBand && cutCount < bandPolicy.preferredCuts) {
      notes.push(`density target(${cutCount}) < band preferred(${bandPolicy.preferredCuts}), using band preferred`);
      cutCount = bandPolicy.preferredCuts;
      reconciled = true;
    }

    // 최소한 band minimum 보장
    if (cutCount < bandPolicy.minCuts) {
      notes.push(`cutCount(${cutCount}) < band minimum(${bandPolicy.minCuts}), raised`);
      cutCount = bandPolicy.minCuts;
      reconciled = true;
    }

    // persona bias 적용 (band 범위 내에서만)
    if (personaBias === "upper" && cutCount < bandPolicy.preferredCuts + 1) {
      cutCount = Math.min(cutCount + 1, 10);
    }
    // lower bias는 minCuts 아래로 못 내림 — 감독이 컷 수를 줄일 권한 없음
  }

  // Step 2: secPerCut 결정 — totalDuration / cutCount 기반
  let secPerCut: number;
  if (totalDurationSec > 0 && cutCount > 0) {
    const naturalPerCut = Math.floor(totalDurationSec / cutCount);
    secPerCut = Math.max(DURATION_MIN, Math.min(DURATION_MAX, naturalPerCut));
  } else {
    secPerCut = personaSecPerCut;
  }

  // Step 3: secPerCut가 band maxSecPerCut 초과하면 clamp
  if (secPerCut > bandPolicy.maxSecPerCut) {
    notes.push(`secPerCut(${secPerCut}) > band max(${bandPolicy.maxSecPerCut}), clamped`);
    secPerCut = bandPolicy.maxSecPerCut;
    reconciled = true;
    // cutCount 재조정 (총합이 맞도록)
    if (totalDurationSec > 0) {
      const newCutCount = Math.ceil(totalDurationSec / secPerCut);
      if (newCutCount > cutCount) {
        notes.push(`cutCount raised ${cutCount}→${newCutCount} to fit totalDuration with clamped secPerCut`);
        cutCount = newCutCount;
      }
    }
  }

  // Step 3b: 밴드 minimum 재검증 (Step 3 clamp → cutCount 재조정 후에도 밴드 minimum 준수)
  if (cutCount < bandPolicy.minCuts) {
    notes.push(`cutCount(${cutCount}) < band minimum(${bandPolicy.minCuts}), raised`);
    cutCount = bandPolicy.minCuts;
    reconciled = true;
  }

  // Step 4: persona가 원한 secPerCut과 비교 — 차이가 크면 downweight 표시
  if (personaSecPerCut > secPerCut) {
    directorPaceDownweighted = true;
    notes.push(`director wanted ${personaSecPerCut}s/cut, reconciled to ${secPerCut}s/cut (shortform rhythm > director pace)`);
    reconciled = true;
  }

  // Step 5: 총합 정합성 최종 검증
  const totalImplied = secPerCut * cutCount;
  if (totalDurationSec > 0 && totalImplied > totalDurationSec * 1.05) {
    // 5% 이상 초과하면 secPerCut 재조정 (숏폼은 타이트한 타이밍 필수)
    const corrected = Math.max(DURATION_MIN, Math.floor(totalDurationSec / cutCount));
    notes.push(`total mismatch: ${totalImplied}s implied > ${totalDurationSec}s actual, secPerCut ${secPerCut}→${corrected}`);
    secPerCut = corrected;
    reconciled = true;
  }

  return {
    cutCount,
    secPerCut,
    totalDurationSec,
    bandPolicy,
    personaWantedSecPerCut: personaSecPerCut,
    densityTargetCuts,
    reconciled,
    reconciliationNotes: notes,
    directorPaceDownweighted,
    shortformRhythmApplied: bandPolicy.isShortformBand,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Shortform-safe vocabulary filter
// ═══════════════════════════════════════════════════════════════════

/** 숏폼 band에서 리듬을 늦추는 감독 스타일 표현을 완화 */
const SLOW_VOCAB_REPLACEMENTS: [RegExp, string][] = [
  [/\bslow\s+observational\s+build\b/gi, "quick observational beat"],
  [/\blingering\s+atmosphere\b/gi, "brief atmospheric beat"],
  [/\bpatient\s+camera\s+drift\b/gi, "motivated camera shift"],
  [/\bcontemplative\s+long\s+take\b/gi, "compressed contemplative beat"],
  [/\bmeditative\s+stillness\b/gi, "focused stillness moment"],
  [/\bslow\s+reveal\b/gi, "quick reveal"],
  [/\blinger\b/gi, "hold briefly"],
  [/\bpatient\s+observation\b/gi, "swift observation"],
  [/\bdeliberate\s+pacing\b/gi, "efficient pacing"],
  [/\bgentle\s+drift\b/gi, "purposeful shift"],
  [/\bgradual\s+unfold\b/gi, "swift unfold"],
  [/\bunhurried\b/gi, "focused"],
  [/\bleisurely\b/gi, "brisk"],
];

/**
 * 숏폼 band에서 감독 스타일 텍스트의 느린 표현을 compact하게 치환.
 * 숏폼이 아닌 경우 원문을 그대로 반환.
 */
export function applyShortformVocabularyFilter(text: string, isShortformBand: boolean): string {
  if (!isShortformBand || !text) return text;
  let result = text;
  for (const [pattern, replacement] of SLOW_VOCAB_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// UX-facing explanation strings
// ═══════════════════════════════════════════════════════════════════

/**
 * reconciled plan에 대한 사용자 설명 문구 생성.
 * 한국어. 짧고 명확하게.
 */
export function buildReconciliationExplanation(plan: ReconciledCutPlan): string | null {
  if (!plan.reconciled) return null;

  const parts: string[] = [];

  if (plan.bandPolicy.isShortformBand && plan.cutCount > plan.densityTargetCuts) {
    parts.push(`숏폼 전달력을 위해 컷 수를 ${plan.densityTargetCuts}→${plan.cutCount}개로 올렸습니다.`);
  }

  if (plan.directorPaceDownweighted) {
    parts.push(`감독 페이스(${plan.personaWantedSecPerCut}초)보다 숏폼 리듬(${plan.secPerCut}초)을 우선했습니다.`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}
