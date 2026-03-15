/**
 * _rhythm-distribution.ts — 서버 함수용 리듬 분배 엔진
 *
 * 클라이언트는 @/lib/rhythm-distribution.ts 사용.
 * 서버 함수(Cloudflare Pages Functions)는 이 파일에서 import.
 *
 * 로직은 src/lib/rhythm-distribution.ts와 동일.
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type PacingMode = "fast" | "balanced" | "cinematic";

export interface CutRhythmInput {
  cutNumber: number;
  purpose?: string;
  shotType?: string;
  shotCategory?: string;
  durationSec: number;
}

export interface RhythmProfile {
  mode: PacingMode;
  minDuration: number;
  maxDuration: number;
  avgDuration: number;
  stdDev: number;
  purposeDistribution: Record<string, number>;
  description: string;
}

export interface RhythmDistributionResult {
  cuts: Array<CutRhythmInput & { durationSec: number; rhythmWeight: number }>;
  profile: RhythmProfile;
}

// ═══════════════════════════════════════════════════════════════════
// Weight Tables
// ═══════════════════════════════════════════════════════════════════

const PURPOSE_WEIGHTS: Record<PacingMode, Record<string, number>> = {
  fast: {
    establish: 0.85,
    develop:   0.95,
    climax:    1.25,
    resolve:   0.95,
  },
  balanced: {
    establish: 1.15,
    develop:   0.90,
    climax:    1.30,
    resolve:   1.05,
  },
  cinematic: {
    establish: 1.30,
    develop:   0.85,
    climax:    1.45,
    resolve:   1.10,
  },
};

const SHOT_SCALE_MODIFIER: Record<string, number> = {
  WS: 1.10, LS: 1.08, MLS: 1.00, MS: 1.00,
  MCU: 0.95, CU: 0.90, ECU: 0.85, OTS: 0.95, POV: 0.90,
};

const CATEGORY_MODIFIER: Record<string, number> = {
  "character-driven": 1.00,
  "environment": 1.10,
  "object-detail": 0.80,
  "map-graphic": 0.90,
  "transition-atmosphere": 0.75,
};

const MODE_CLAMPS: Record<PacingMode, { min: number; max: number }> = {
  fast:      { min: 2, max: 5 },
  balanced:  { min: 3, max: 8 },
  cinematic: { min: 3, max: 12 },
};

// ═══════════════════════════════════════════════════════════════════
// Core
// ═══════════════════════════════════════════════════════════════════

function computeRhythmWeight(
  cut: CutRhythmInput,
  mode: PacingMode,
  cutIndex: number,
  totalCuts: number,
): number {
  const purpose = (cut.purpose || "develop").toLowerCase();
  const pw = (PURPOSE_WEIGHTS[mode][purpose]) ?? 1.0;
  const shotType = (cut.shotType || "MS").toUpperCase();
  const sm = SHOT_SCALE_MODIFIER[shotType] ?? 1.0;
  const category = cut.shotCategory || "character-driven";
  const cm = CATEGORY_MODIFIER[category] ?? 1.0;
  let pm = 1.0;
  if (cutIndex === 0) pm = mode === "cinematic" ? 1.10 : 1.05;
  else if (cutIndex === totalCuts - 1) pm = 1.05;
  return pw * sm * cm * pm;
}

export function distributeRhythm(
  cuts: CutRhythmInput[],
  mode: PacingMode = "balanced",
): RhythmDistributionResult {
  if (cuts.length === 0) {
    return {
      cuts: [],
      profile: {
        mode, minDuration: 0, maxDuration: 0, avgDuration: 0,
        stdDev: 0, purposeDistribution: {}, description: "컷 없음",
      },
    };
  }

  const totalBudget = cuts.reduce((s, c) => s + c.durationSec, 0);
  const clamps = MODE_CLAMPS[mode];

  const weights = cuts.map((cut, i) =>
    computeRhythmWeight(cut, mode, i, cuts.length),
  );

  const weightSum = weights.reduce((s, w) => s + w, 0);
  const rawDurations = weights.map(w => (w / weightSum) * totalBudget);

  const minPossible = cuts.length * clamps.min;
  const maxPossible = cuts.length * clamps.max;
  const effectiveClamps = { ...clamps };
  if (totalBudget > maxPossible) {
    effectiveClamps.max = Math.ceil(totalBudget / cuts.length) + 1;
  } else if (totalBudget < minPossible) {
    effectiveClamps.min = Math.max(1, Math.floor(totalBudget / cuts.length));
  }
  let clampedDurations = rawDurations.map(d =>
    Math.round(Math.max(effectiveClamps.min, Math.min(effectiveClamps.max, d))),
  );

  let currentTotal = clampedDurations.reduce((s, d) => s + d, 0);
  let diff = totalBudget - currentTotal;

  if (diff !== 0) {
    const sortedIndices = weights
      .map((w, i) => ({ i, w }))
      .sort((a, b) => diff > 0 ? b.w - a.w : a.w - b.w)
      .map(x => x.i);

    for (const idx of sortedIndices) {
      if (diff === 0) break;
      const step = diff > 0 ? 1 : -1;
      const newVal = clampedDurations[idx] + step;
      if (newVal >= clamps.min && newVal <= clamps.max) {
        clampedDurations[idx] = newVal;
        diff -= step;
      }
    }
  }

  currentTotal = clampedDurations.reduce((s, d) => s + d, 0);
  diff = totalBudget - currentTotal;
  while (diff !== 0) {
    let adjusted = false;
    for (let i = 0; i < clampedDurations.length && diff !== 0; i++) {
      const step = diff > 0 ? 1 : -1;
      const newVal = clampedDurations[i] + step;
      if (newVal >= clamps.min && newVal <= clamps.max) {
        clampedDurations[i] = newVal;
        diff -= step;
        adjusted = true;
      }
    }
    if (!adjusted) break;
  }

  const resultCuts = cuts.map((cut, i) => ({
    ...cut,
    durationSec: clampedDurations[i],
    rhythmWeight: Math.round(weights[i] * 100) / 100,
  }));

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

export function densityToPacingMode(editingDensity: string): PacingMode {
  switch (editingDensity) {
    case "dense": return "fast";
    case "sparse": return "cinematic";
    default: return "balanced";
  }
}
