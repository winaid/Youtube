/**
 * _sequence-density.ts — 컷 밀도 보정 (서버 함수용)
 *
 * 클라이언트는 @/lib/sequence-density.ts 사용.
 * 서버 함수(Cloudflare Pages Functions)는 이 파일에서 import.
 *
 * 로직은 src/lib/sequence-density.ts와 동일.
 */

/**
 * Kling segment 상한. 한 번에 최대 15초만 생성 가능.
 */
export const KLING_SEGMENT_CAP = 15;

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
];

function singleSegmentRange(segDur: number): { min: number; max: number } {
  if (segDur <= 0) return { min: 1, max: 2 };
  for (const preset of RANGE_PRESETS) {
    if (segDur <= preset.maxSec) return { min: preset.min, max: preset.max };
  }
  return { min: 3, max: 5 };
}

export function recommendCutCountRange(totalDurationSec: number): { min: number; max: number } {
  if (!totalDurationSec || totalDurationSec <= 0) return { min: 1, max: 2 };
  if (totalDurationSec <= KLING_SEGMENT_CAP) {
    return singleSegmentRange(totalDurationSec);
  }
  const fullSegments = Math.floor(totalDurationSec / KLING_SEGMENT_CAP);
  const remainder = totalDurationSec - fullSegments * KLING_SEGMENT_CAP;
  const fullRange = singleSegmentRange(KLING_SEGMENT_CAP);
  let totalMin = fullRange.min * fullSegments;
  let totalMax = fullRange.max * fullSegments;
  if (remainder > 0) {
    const remRange = singleSegmentRange(remainder);
    totalMin += remRange.min;
    totalMax += remRange.max;
  }
  return { min: totalMin, max: totalMax };
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

// ═══════════════════════════════════════════════════════════════════
// Segment Orchestration Plan
// ═══════════════════════════════════════════════════════════════════

/** 단일 segment의 planning 결과 */
export interface SegmentCutBudget {
  segmentIndex: number;
  segmentDurationSec: number;
  cutRange: { min: number; max: number };
  preferredCutTarget: number;
  densityMinimum: number;
}

/** 전체 시퀀스 orchestration plan */
export interface SequenceOrchestrationPlan {
  totalDurationSec: number;
  segmentDurationCap: number;
  segmentCount: number;
  currentPlanningScope: "segment" | "full_sequence";
  totalTargetCuts: number;
  currentSegmentTargetCuts: number;
  totalCutRange: { min: number; max: number };
  perSegmentCutRange: { min: number; max: number };
  segments: SegmentCutBudget[];
  planningBasis: string;
  personaBias: "lower" | "upper" | "neutral";
  notes: string[];
}

export function resolveSegmentPlan(opts: {
  totalDurationSec: number;
  exactCutCount?: number;
  preferredRange?: { min: number; max: number };
  personaBias?: "lower" | "upper" | "neutral";
  currentSegmentIndex?: number;
}): SequenceOrchestrationPlan {
  const {
    totalDurationSec,
    exactCutCount,
    preferredRange,
    personaBias = "neutral",
    currentSegmentIndex = 0,
  } = opts;

  const cap = KLING_SEGMENT_CAP;
  const notes: string[] = [];

  const effectiveTotal = totalDurationSec > 0 ? totalDurationSec : cap;
  const segmentCount = Math.max(1, Math.ceil(effectiveTotal / cap));
  const isMultiSegment = segmentCount > 1;

  const segmentDurations: number[] = [];
  for (let i = 0; i < segmentCount; i++) {
    if (i < segmentCount - 1) {
      segmentDurations.push(cap);
    } else {
      const remainder = effectiveTotal - (segmentCount - 1) * cap;
      segmentDurations.push(remainder > 0 ? remainder : cap);
    }
  }

  const totalCutRange = recommendCutCountRange(effectiveTotal);
  const perSegRange = singleSegmentRange(cap);

  if (exactCutCount && exactCutCount > 0) {
    const cutsPerSeg = Math.max(1, Math.round(exactCutCount / segmentCount));
    const segments: SegmentCutBudget[] = segmentDurations.map((dur, i) => {
      const isLast = i === segmentCount - 1;
      const segCuts = isLast
        ? exactCutCount - cutsPerSeg * (segmentCount - 1)
        : cutsPerSeg;
      return {
        segmentIndex: i,
        segmentDurationSec: dur,
        cutRange: { min: segCuts, max: segCuts },
        preferredCutTarget: Math.max(1, segCuts),
        densityMinimum: recommendMinimumCutCount(dur),
      };
    });

    const currentSeg = segments[Math.min(currentSegmentIndex, segments.length - 1)];
    notes.push(`exact cutCount=${exactCutCount}, distributed ~${cutsPerSeg}/segment`);

    return {
      totalDurationSec: effectiveTotal,
      segmentDurationCap: cap,
      segmentCount,
      currentPlanningScope: isMultiSegment ? "segment" : "full_sequence",
      totalTargetCuts: exactCutCount,
      currentSegmentTargetCuts: Math.min(currentSeg.preferredCutTarget, cap),
      totalCutRange: { min: exactCutCount, max: exactCutCount },
      perSegmentCutRange: { min: cutsPerSeg, max: cutsPerSeg },
      segments,
      planningBasis: "exact_cutCount",
      personaBias,
      notes,
    };
  }

  const segments: SegmentCutBudget[] = segmentDurations.map((dur, i) => {
    const segRange = preferredRange
      ? preferredRange
      : singleSegmentRange(dur);
    const densMin = recommendMinimumCutCount(dur);
    const effectiveMin = Math.max(segRange.min, densMin);
    const effectiveMax = Math.max(segRange.max, effectiveMin);

    let target: number;
    if (personaBias === "upper") {
      target = effectiveMax;
    } else if (personaBias === "lower") {
      target = effectiveMin;
    } else {
      target = Math.round((effectiveMin + effectiveMax) / 2);
    }

    return {
      segmentIndex: i,
      segmentDurationSec: dur,
      cutRange: { min: effectiveMin, max: effectiveMax },
      preferredCutTarget: target,
      densityMinimum: densMin,
    };
  });

  const totalTargetCuts = segments.reduce((s, seg) => s + seg.preferredCutTarget, 0);
  const currentSeg = segments[Math.min(currentSegmentIndex, segments.length - 1)];

  if (isMultiSegment) {
    notes.push(`${segmentCount} segments, ~${currentSeg.preferredCutTarget} cuts for segment ${currentSegmentIndex}`);
  }
  if (preferredRange) {
    notes.push(`preferredRange per segment: ${preferredRange.min}~${preferredRange.max}`);
  }
  notes.push(`persona bias: ${personaBias}`);

  return {
    totalDurationSec: effectiveTotal,
    segmentDurationCap: cap,
    segmentCount,
    currentPlanningScope: isMultiSegment ? "segment" : "full_sequence",
    totalTargetCuts,
    currentSegmentTargetCuts: currentSeg.preferredCutTarget,
    totalCutRange,
    perSegmentCutRange: preferredRange ?? perSegRange,
    segments,
    planningBasis: preferredRange ? "preferred_range" : "density_policy",
    personaBias,
    notes,
  };
}

export function recommendMinimumCutCount(totalDurationSec: number): number {
  if (!totalDurationSec || totalDurationSec <= 0) return 1;
  if (totalDurationSec <= KLING_SEGMENT_CAP) {
    for (const rule of DENSITY_POLICY) {
      if (totalDurationSec <= rule.maxSec) return rule.minCuts;
    }
    return 5;
  }
  // segment-aware
  const fullSegments = Math.floor(totalDurationSec / KLING_SEGMENT_CAP);
  const remainder = totalDurationSec - fullSegments * KLING_SEGMENT_CAP;
  const fullSegMin = recommendMinimumCutCount(KLING_SEGMENT_CAP);
  let total = fullSegMin * fullSegments;
  if (remainder > 0) {
    total += recommendMinimumCutCount(remainder);
  }
  return total;
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
