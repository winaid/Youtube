/**
 * _sequence-density.ts — 컷 밀도 보정 (서버 함수용)
 *
 * 클라이언트는 @/lib/sequence-density.ts 사용.
 * 서버 함수(Cloudflare Pages Functions)는 이 파일에서 import.
 *
 * 로직은 src/lib/sequence-density.ts와 동일.
 */

/**
 * 멀티컷 몽타주 우선 밀도 정책.
 * 8-12s → 3-4 cuts, 12-15s → 4-5 cuts.
 * 단일 긴 숏보다 짧은 컷 × 여러 개를 기본값으로 설정.
 */
const DENSITY_POLICY: { maxSec: number; minCuts: number }[] = [
  { maxSec: 4, minCuts: 1 },
  { maxSec: 7, minCuts: 2 },
  { maxSec: 9, minCuts: 3 },
  { maxSec: 12, minCuts: 4 },
  { maxSec: 15, minCuts: 5 },
  { maxSec: Infinity, minCuts: 5 },
];

// ═══════════════════════════════════════════════════════════════════
// Duration → Recommended Cut Count Range Presets
// ═══════════════════════════════════════════════════════════════════

const RANGE_PRESETS: { maxSec: number; min: number; max: number }[] = [
  { maxSec: 5,  min: 1, max: 2 },
  { maxSec: 8,  min: 2, max: 3 },
  { maxSec: 12, min: 3, max: 4 },
  { maxSec: 15, min: 3, max: 5 },
  { maxSec: Infinity, min: 4, max: 6 },
];

export function recommendCutCountRange(totalDurationSec: number): { min: number; max: number } {
  if (!totalDurationSec || totalDurationSec <= 0) return { min: 1, max: 2 };
  for (const preset of RANGE_PRESETS) {
    if (totalDurationSec <= preset.maxSec) return { min: preset.min, max: preset.max };
  }
  return { min: 4, max: 6 };
}

export function densityPresetToRange(
  preset: "sparse" | "normal" | "dense",
  totalDurationSec: number,
): { min: number; max: number } {
  const base = recommendCutCountRange(totalDurationSec);
  switch (preset) {
    case "sparse":
      return { min: Math.max(1, base.min - 1), max: base.min };
    case "dense":
      return { min: base.max, max: base.max + 2 };
    case "normal":
    default:
      return base;
  }
}

export function personaCutCountBias(
  ep: { motionBias: string; preferredCutPace: [number, number]; insertBias: string },
): "lower" | "upper" | "neutral" {
  if (ep.motionBias === "frenetic" || (ep.motionBias === "dynamic" && ep.preferredCutPace[1] <= 4)) {
    return "upper";
  }
  if (ep.motionBias === "static" || (ep.motionBias === "minimal" && ep.preferredCutPace[0] >= 5)) {
    return "lower";
  }
  return "neutral";
}

export function resolveCutCount(opts: {
  exactCutCount?: number;
  preferredRange?: { min: number; max: number };
  totalDurationSec: number;
  personaBias?: "lower" | "upper" | "neutral";
}): {
  cutCount: number;
  source: "exact_cutCount" | "preferred_range" | "density_policy" | "fallback";
  densityMinimum: number;
  notes: string[];
} {
  const { exactCutCount, preferredRange, totalDurationSec, personaBias } = opts;
  const densityMin = recommendMinimumCutCount(totalDurationSec);
  const notes: string[] = [];

  if (exactCutCount && exactCutCount > 0) {
    if (exactCutCount < densityMin) {
      notes.push(`exact cutCount(${exactCutCount}) < density minimum(${densityMin}), using density minimum`);
      return { cutCount: densityMin, source: "exact_cutCount", densityMinimum: densityMin, notes };
    }
    return { cutCount: Math.min(exactCutCount, 15), source: "exact_cutCount", densityMinimum: densityMin, notes };
  }

  if (preferredRange) {
    const effectiveMin = Math.max(preferredRange.min, densityMin);
    const effectiveMax = Math.max(preferredRange.max, effectiveMin);

    if (effectiveMin > preferredRange.min) {
      notes.push(`range min(${preferredRange.min}) < density minimum(${densityMin}), raised to ${effectiveMin}`);
    }

    let selected: number;
    if (personaBias === "upper") {
      selected = effectiveMax;
      notes.push("persona bias: upper → max of range");
    } else if (personaBias === "lower") {
      selected = effectiveMin;
      notes.push("persona bias: lower → min of range");
    } else {
      selected = Math.round((effectiveMin + effectiveMax) / 2);
      notes.push("persona bias: neutral → midpoint of range");
    }

    return {
      cutCount: Math.min(selected, 15),
      source: "preferred_range",
      densityMinimum: densityMin,
      notes,
    };
  }

  const fallbackRange = recommendCutCountRange(totalDurationSec);
  let fallbackCount: number;
  if (personaBias === "upper") {
    fallbackCount = fallbackRange.max;
  } else if (personaBias === "lower") {
    fallbackCount = fallbackRange.min;
  } else {
    fallbackCount = Math.round((fallbackRange.min + fallbackRange.max) / 2);
  }
  fallbackCount = Math.max(fallbackCount, densityMin);

  return {
    cutCount: Math.min(fallbackCount, 15),
    source: "fallback",
    densityMinimum: densityMin,
    notes: ["no exact cutCount or preferred range provided, using density policy"],
  };
}

export function recommendMinimumCutCount(totalDurationSec: number): number {
  if (!totalDurationSec || totalDurationSec <= 0) return 1;
  for (const rule of DENSITY_POLICY) {
    if (totalDurationSec <= rule.maxSec) return rule.minCuts;
  }
  return 4;
}

export function needsDensityBoost(
  cuts: Array<{ durationSec: number; durationClass?: string }>,
  totalDurationSec?: number,
): boolean {
  if (cuts.length === 0) return false;
  const total = totalDurationSec ?? cuts.reduce((s, c) => s + (c.durationSec || 0), 0);
  const minCuts = recommendMinimumCutCount(total);
  return cuts.length < minCuts;
}

export function densifyCuts<T extends { durationSec: number; structureType?: string; durationClass?: string }>(
  cuts: T[],
  totalDurationSec?: number,
): T[] {
  if (cuts.length === 0) return cuts;

  const total = totalDurationSec ?? cuts.reduce((s, c) => s + (c.durationSec || 0), 0);
  const minCuts = recommendMinimumCutCount(total);

  if (cuts.length >= minCuts) return cuts;

  let working = cuts.map(c => ({ ...c }));
  let needed = minCuts - working.length;

  while (needed > 0) {
    const scoredIndices = working.map((c, i) => {
      const isLongClass = c.durationClass === "scene-like" || c.durationClass === "sequence-like";
      const priority = (isLongClass ? 10000 : 0) + (c.durationSec || 0);
      return { index: i, priority, duration: c.durationSec || 0 };
    });

    scoredIndices.sort((a, b) => b.priority - a.priority);
    const target = scoredIndices[0];

    if (target.duration <= 2) break;

    const original = working[target.index];
    const halfDuration = Math.round(target.duration / 2);
    const remainDuration = target.duration - halfDuration;

    const firstHalf = { ...original, durationSec: halfDuration } as T;
    const secondHalf = { ...original, durationSec: remainDuration } as T;

    delete (firstHalf as Record<string, unknown>).durationClass;
    delete (firstHalf as Record<string, unknown>).structureType;
    delete (secondHalf as Record<string, unknown>).durationClass;
    delete (secondHalf as Record<string, unknown>).structureType;

    working = [
      ...working.slice(0, target.index),
      firstHalf,
      secondHalf,
      ...working.slice(target.index + 1),
    ];

    needed--;
  }

  return working.map((c, i) => {
    if ("cutNumber" in c) {
      return { ...c, cutNumber: i + 1 };
    }
    return c;
  }) as T[];
}
