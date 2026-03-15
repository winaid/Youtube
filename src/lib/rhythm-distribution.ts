/**
 * rhythm-distribution.ts — 리듬 기반 컷 duration 분배 엔진
 *
 * 핵심 원리:
 *   모든 컷에 동일한 초를 할당하는 "평준화"를 대체한다.
 *   컷의 역할(purpose), 촬영 규모(shotType), 피사체 유형(shotCategory)에 따라
 *   duration을 가변 배분하여 "영화적 리듬감"을 만든다.
 *
 * 설계 원칙:
 *   - "Cinematic"은 "느린 것"이 아니다. 리듬 대비(rhythm contrast)다.
 *   - "Fast"는 "모든 컷 3초"가 아니다. 압축된 에너지 안에서의 강약이다.
 *   - 총 duration은 보존된다. 리듬 분배는 재분배(redistribution)이지 확장이 아니다.
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/** 편집 리듬 모드 */
export type PacingMode = "fast" | "balanced" | "cinematic";

/** 컷 역할 (Gemini Step1 outline의 purpose 필드에서 유래) */
export type CutPurpose = "establish" | "develop" | "climax" | "resolve";

/** 촬영 규모 */
export type ShotScale = "ECU" | "CU" | "MCU" | "MS" | "MLS" | "LS" | "WS" | "OTS" | "POV";

/** 피사체 유형 */
export type ShotCategory =
  | "character-driven"
  | "environment"
  | "object-detail"
  | "map-graphic"
  | "transition-atmosphere";

/** 분배 입력: 각 컷의 메타데이터 */
export interface CutRhythmInput {
  cutNumber: number;
  purpose?: string;        // establish | develop | climax | resolve
  shotType?: string;       // ECU, CU, MCU, MS, LS, WS, etc.
  shotCategory?: string;   // character-driven, environment, object-detail, etc.
  durationSec: number;     // 기존 uniform duration (기준값)
}

/** 분배 결과 */
export interface RhythmDistributionResult {
  cuts: Array<CutRhythmInput & { durationSec: number; rhythmWeight: number }>;
  /** 리듬 프로파일 요약 */
  profile: RhythmProfile;
}

/** 리듬 프로파일 — UI 표시용 */
export interface RhythmProfile {
  mode: PacingMode;
  minDuration: number;
  maxDuration: number;
  avgDuration: number;
  /** duration 표준편차 — 리듬 대비 강도 지표 */
  stdDev: number;
  /** 컷 역할 분포 */
  purposeDistribution: Record<string, number>;
  /** 리듬 설명 */
  description: string;
}

// ═══════════════════════════════════════════════════════════════════
// Rhythm Weight Tables — 역할별 상대적 duration 가중치
// ═══════════════════════════════════════════════════════════════════

/**
 * purpose별 base weight.
 * 1.0 = 기준 duration. > 1.0 = 더 길게. < 1.0 = 더 짧게.
 */
const PURPOSE_WEIGHTS: Record<PacingMode, Record<string, number>> = {
  fast: {
    establish: 0.85,   // 빠르게 세팅
    develop:   0.95,   // 약간 압축
    climax:    1.25,   // 클라이맥스만 약간 확장
    resolve:   0.95,   // 빠른 마무리
  },
  balanced: {
    establish: 1.15,   // 공간 설정에 여유
    develop:   0.90,   // 전개는 타이트하게
    climax:    1.30,   // 클라이맥스에 호흡
    resolve:   1.05,   // 자연스러운 마무리
  },
  cinematic: {
    establish: 1.30,   // 환경 설정에 숨결
    develop:   0.85,   // 전개는 오히려 긴장감 있게 짧게
    climax:    1.45,   // 핵심 장면 강조
    resolve:   1.10,   // 여운
  },
};

/**
 * shotType별 보정 multiplier.
 * WS/LS는 공간 인식에 시간이 필요. ECU/CU는 임팩트가 빠르다.
 */
const SHOT_SCALE_MODIFIER: Record<string, number> = {
  WS:  1.10,   // 넓은 화면 → 약간 더 길게
  LS:  1.08,
  MLS: 1.00,
  MS:  1.00,
  MCU: 0.95,
  CU:  0.90,   // 클로즈업 → 즉각적 임팩트
  ECU: 0.85,   // 극단 클로즈업 → 짧고 강렬
  OTS: 0.95,
  POV: 0.90,
};

/**
 * shotCategory별 보정.
 * object-detail과 transition은 짧은 게 자연스럽다.
 * environment는 공간 인식을 위해 약간 길어야 한다.
 */
const CATEGORY_MODIFIER: Record<string, number> = {
  "character-driven":        1.00,
  "environment":             1.10,
  "object-detail":           0.80,
  "map-graphic":             0.90,
  "transition-atmosphere":   0.75,
};

// ═══════════════════════════════════════════════════════════════════
// Duration Clamps per Pacing Mode
// ═══════════════════════════════════════════════════════════════════

const MODE_CLAMPS: Record<PacingMode, { min: number; max: number }> = {
  fast:      { min: 2, max: 5 },
  balanced:  { min: 3, max: 8 },
  cinematic: { min: 3, max: 12 },
};

// ═══════════════════════════════════════════════════════════════════
// Core Engine
// ═══════════════════════════════════════════════════════════════════

/**
 * 각 컷의 리듬 가중치를 계산한다.
 */
function computeRhythmWeight(
  cut: CutRhythmInput,
  mode: PacingMode,
  cutIndex: number,
  totalCuts: number,
): number {
  // 1. purpose weight
  const purpose = (cut.purpose || "develop").toLowerCase();
  const purposeWeights = PURPOSE_WEIGHTS[mode];
  const pw = purposeWeights[purpose] ?? 1.0;

  // 2. shot scale modifier
  const shotType = (cut.shotType || "MS").toUpperCase();
  const sm = SHOT_SCALE_MODIFIER[shotType] ?? 1.0;

  // 3. category modifier
  const category = cut.shotCategory || "character-driven";
  const cm = CATEGORY_MODIFIER[category] ?? 1.0;

  // 4. position modifier — 첫 컷과 마지막 컷은 약간 더 길게 (hook/closer)
  let pm = 1.0;
  if (cutIndex === 0) {
    pm = mode === "cinematic" ? 1.10 : 1.05; // opening hook
  } else if (cutIndex === totalCuts - 1) {
    pm = 1.05; // closing beat
  }

  return pw * sm * cm * pm;
}

/**
 * 리듬 가중치를 기반으로 duration을 재분배한다.
 * 총 duration은 보존된다 (budget-preserving redistribution).
 */
export function distributeRhythm(
  cuts: CutRhythmInput[],
  mode: PacingMode = "balanced",
): RhythmDistributionResult {
  if (cuts.length === 0) {
    return {
      cuts: [],
      profile: {
        mode,
        minDuration: 0,
        maxDuration: 0,
        avgDuration: 0,
        stdDev: 0,
        purposeDistribution: {},
        description: "컷 없음",
      },
    };
  }

  // 총 duration budget
  const totalBudget = cuts.reduce((s, c) => s + c.durationSec, 0);
  const clamps = MODE_CLAMPS[mode];

  // 1. 각 컷의 raw weight 계산
  const weights = cuts.map((cut, i) =>
    computeRhythmWeight(cut, mode, i, cuts.length),
  );

  // 2. weight 합산 → 비례 배분
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const rawDurations = weights.map(w => (w / weightSum) * totalBudget);

  // 3. clamp 적용 + 반올림
  // budget과 clamp가 호환되는지 확인
  const minPossible = cuts.length * clamps.min;
  const maxPossible = cuts.length * clamps.max;
  const effectiveClamps = { ...clamps };
  if (totalBudget > maxPossible) {
    // budget이 max clamp보다 크면, max를 확장
    effectiveClamps.max = Math.ceil(totalBudget / cuts.length) + 1;
  } else if (totalBudget < minPossible) {
    // budget이 min clamp보다 작으면, min을 축소
    effectiveClamps.min = Math.max(1, Math.floor(totalBudget / cuts.length));
  }
  let clampedDurations = rawDurations.map(d =>
    Math.round(Math.max(effectiveClamps.min, Math.min(effectiveClamps.max, d))),
  );

  // 4. 총합 보정 — clamp로 인한 budget 차이를 조정
  let currentTotal = clampedDurations.reduce((s, d) => s + d, 0);
  let diff = totalBudget - currentTotal;

  // 차이를 가중치가 높은(낮은) 컷부터 1초씩 분배/차감
  if (diff !== 0) {
    const sortedIndices = weights
      .map((w, i) => ({ i, w }))
      .sort((a, b) => diff > 0 ? b.w - a.w : a.w - b.w)
      .map(x => x.i);

    for (const idx of sortedIndices) {
      if (diff === 0) break;
      const step = diff > 0 ? 1 : -1;
      const newVal = clampedDurations[idx] + step;
      if (newVal >= effectiveClamps.min && newVal <= effectiveClamps.max) {
        clampedDurations[idx] = newVal;
        diff -= step;
      }
    }
  }

  // 5. 여전히 차이가 있으면 마지막 수단: clamp 범위 내에서 1초씩 분산
  currentTotal = clampedDurations.reduce((s, d) => s + d, 0);
  diff = totalBudget - currentTotal;
  while (diff !== 0) {
    let adjusted = false;
    for (let i = 0; i < clampedDurations.length && diff !== 0; i++) {
      const step = diff > 0 ? 1 : -1;
      const newVal = clampedDurations[i] + step;
      if (newVal >= effectiveClamps.min && newVal <= effectiveClamps.max) {
        clampedDurations[i] = newVal;
        diff -= step;
        adjusted = true;
      }
    }
    if (!adjusted) break; // clamp 범위 내 조정 불가 → 중단
  }

  // 6. 결과 조합
  const resultCuts = cuts.map((cut, i) => ({
    ...cut,
    durationSec: clampedDurations[i],
    rhythmWeight: Math.round(weights[i] * 100) / 100,
  }));

  // 7. 프로파일 계산
  const avg = totalBudget / cuts.length;
  const variance = clampedDurations.reduce((s, d) => s + (d - avg) ** 2, 0) / cuts.length;
  const stdDev = Math.round(Math.sqrt(variance) * 100) / 100;

  const purposeDistribution: Record<string, number> = {};
  for (const cut of cuts) {
    const p = cut.purpose || "develop";
    purposeDistribution[p] = (purposeDistribution[p] || 0) + 1;
  }

  const descriptions: Record<PacingMode, string> = {
    fast: "빠른 편집 — 짧은 컷 중심, 클라이맥스만 확장",
    balanced: "균형 편집 — 역할별 강약 조절, 유튜브 최적",
    cinematic: "시네마틱 — 공간/감정 호흡 있는 리듬 대비",
  };

  return {
    cuts: resultCuts,
    profile: {
      mode,
      minDuration: Math.min(...clampedDurations),
      maxDuration: Math.max(...clampedDurations),
      avgDuration: Math.round(avg * 10) / 10,
      stdDev,
      purposeDistribution,
      description: descriptions[mode],
    },
  };
}

/**
 * pacing mode를 editingDensity 프리셋에서 결정한다.
 * dense → fast, normal/auto → balanced, sparse → cinematic
 */
export function densityToPacingMode(
  editingDensity: string,
): PacingMode {
  switch (editingDensity) {
    case "dense": return "fast";
    case "sparse": return "cinematic";
    case "normal":
    case "auto":
    default: return "balanced";
  }
}

/**
 * 콘텐츠 유형에 따라 기본 pacing mode를 보정한다.
 * 서사/설명형 → balanced 방향으로, 몽타주 → fast 방향으로 이동.
 */
export function adjustPacingForContent(
  basePacing: PacingMode,
  contentSignals: {
    sentenceCount?: number;
    totalDurationSec?: number;
    contentMode?: string;
    /** purpose 분포에서 establish/resolve 비율이 높으면 서사형 */
    narrativeRatio?: number;
  },
): PacingMode {
  const { sentenceCount, totalDurationSec, contentMode, narrativeRatio } = contentSignals;

  // 역사 재연 콘텐츠 → cinematic 방향으로 한 단계 올림
  if (contentMode === "dramatized_reenactment") {
    if (basePacing === "fast") return "balanced";
    return "cinematic";
  }

  // 긴 서사형 (15문장 이상, 120초 이상) → balanced 이상 보장
  if (sentenceCount && sentenceCount >= 15 && totalDurationSec && totalDurationSec >= 120) {
    if (basePacing === "fast") return "balanced";
  }

  // narrative ratio가 0.4 이상이면 서사형 → cinematic 방향
  if (narrativeRatio && narrativeRatio >= 0.4) {
    if (basePacing === "fast") return "balanced";
  }

  return basePacing;
}
