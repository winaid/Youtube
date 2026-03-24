/**
 * _sequence-density.ts — 시퀀스 밀도 보정 (서버 함수용)
 *
 * 3-Layer 모델:
 *   Layer 1: 총 요청 런타임 (e.g. 48s) — 배치/컨테이너 예산
 *   Layer 2: 시퀀스 (8s) — VEO 1회 생성 단위
 *   Layer 3: 시퀀스 내 멀티샷 (최대 6) — multi-shot-planner가 관리
 *
 * 클라이언트는 @/lib/sequence-density.ts 사용.
 * 서버 함수(Cloudflare Pages Functions)는 이 파일에서 import.
 * 로직은 src/lib/sequence-density.ts와 동일 유지 필수.
 */

/**
 * VEO segment 상한. 한 번에 최대 8초만 생성 가능.
 */
export const VEO_SEGMENT_CAP = 8;

/**
 * 시퀀스 밀도 정책 — 총 런타임 대비 최소 시퀀스 수.
 * 각 시퀀스는 VEO 1회 생성 단위(8s).
 * 시퀀스 내부 샷 수는 multi-shot-planner가 관리.
 * 로직은 src/lib/sequence-density.ts와 동일 유지 필수.
 */
/**
 * 확정 규칙 (2026-03):
 *   ≤5초: 1컷, 6~9초: 3컷, 10~15초: 4컷
 *   recommendMinimumCutCount()가 source of truth.
 */

/**
 * Maximum allowed cut count.
 * 멀티 체인 지원: 10분(600초) = ~85컷. generate-cuts는 체인별 배치 호출.
 */
export const CUT_COUNT_MAX = 90;

// ═══════════════════════════════════════════════════════════════════
// Duration → Recommended Cut Count Range Presets
// ═══════════════════════════════════════════════════════════════════

/**
 * 시퀀스당 런타임 → 내부 밀도 권장 범위.
 * multi-shot-planner와 연동되어 Layer 3 샷 수 결정에 사용.
 *
 * 확정 규칙 (2026-03):
 *   ≤5초: 1~2컷 (micro)
 *   6~9초: 3~6컷 (short — 최소 3컷, physicalMax로 실제 상한 제한: 6초=3, 8초=4)
 *   10~15초: 4~6컷 (shortform-critical, physicalMax 적용)
 *   ※ physicalMax = floor(totalDuration/2) — 각 컷 최소 2초 보장
 */
const RANGE_PRESETS: { maxSec: number; min: number; max: number }[] = [
  { maxSec: 5,  min: 1, max: 2 },
  { maxSec: 9,  min: 3, max: 6 },  // 6~9초: 최소 3컷 (physicalMax로 실제 상한 제한)
  { maxSec: 15, min: 4, max: 6 },  // 10~15초: 4~6컷 (physicalMax로 실제 상한 제한)
];

function singleSegmentRange(segDur: number): { min: number; max: number } {
  if (segDur <= 0) return { min: 1, max: 2 };
  for (const preset of RANGE_PRESETS) {
    if (segDur <= preset.maxSec) return { min: preset.min, max: preset.max };
  }
  // 15초+ segment: 마지막 preset 기준으로 비례 확장 (1-2 fallback은 과소 추정)
  const lastPreset = RANGE_PRESETS[RANGE_PRESETS.length - 1];
  const scale = Math.ceil(segDur / lastPreset.maxSec);
  return { min: lastPreset.min * scale, max: lastPreset.max * scale };
}

export function recommendCutCountRange(totalDurationSec: number): { min: number; max: number } {
  if (!totalDurationSec || totalDurationSec <= 0) return { min: 1, max: 2 };
  if (totalDurationSec <= VEO_SEGMENT_CAP) {
    return singleSegmentRange(totalDurationSec);
  }
  const fullSegments = Math.floor(totalDurationSec / VEO_SEGMENT_CAP);
  const remainder = totalDurationSec - fullSegments * VEO_SEGMENT_CAP;
  const fullRange = singleSegmentRange(VEO_SEGMENT_CAP);
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
  const floor = recommendMinimumCutCount(totalDurationSec);
  switch (preset) {
    case "sparse":
      return { min: Math.max(floor, base.min - 1), max: Math.max(floor, base.min) };
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
  const pace = Array.isArray(ep.preferredCutPace) && ep.preferredCutPace.length >= 2
    ? ep.preferredCutPace
    : [4, 6]; // safe default
  if (ep.motionBias === "frenetic" || (ep.motionBias === "dynamic" && pace[1] <= 4)) {
    return "upper";
  }
  if (ep.motionBias === "static" || (ep.motionBias === "minimal" && pace[0] >= 5)) {
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
  // 물리적 상한: 각 컷 최소 2초 보장 → totalDuration / 2 이상의 컷 수 불가
  const physicalMax = totalDurationSec > 0 ? Math.max(1, Math.floor(totalDurationSec / 2)) : CUT_COUNT_MAX;

  if (exactCutCount && exactCutCount > 0) {
    if (exactCutCount < densityMin) {
      notes.push(`exact cutCount(${exactCutCount}) < density minimum(${densityMin}), using density minimum`);
      return { cutCount: Math.min(densityMin, physicalMax), source: "exact_cutCount", densityMinimum: densityMin, notes };
    }
    return { cutCount: Math.min(exactCutCount, CUT_COUNT_MAX, physicalMax), source: "exact_cutCount", densityMinimum: densityMin, notes };
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
      cutCount: Math.min(selected, CUT_COUNT_MAX, physicalMax),
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
    cutCount: Math.min(fallbackCount, CUT_COUNT_MAX, physicalMax),
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

  const cap = VEO_SEGMENT_CAP;
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
    // 10s+ 규칙 강제: exactCutCount도 density minimum 이하로 내려갈 수 없음
    const totalDensityMin = recommendMinimumCutCount(effectiveTotal);
    const enforcedCutCount = Math.max(exactCutCount, totalDensityMin);
    const cutsPerSeg = Math.max(1, Math.round(enforcedCutCount / segmentCount));
    const segments: SegmentCutBudget[] = segmentDurations.map((dur, i) => {
      const isLast = i === segmentCount - 1;
      const segCuts = isLast
        ? enforcedCutCount - cutsPerSeg * (segmentCount - 1)
        : cutsPerSeg;
      const densMin = recommendMinimumCutCount(dur);
      return {
        segmentIndex: i,
        segmentDurationSec: dur,
        cutRange: { min: Math.max(segCuts, densMin), max: Math.max(segCuts, densMin) },
        preferredCutTarget: Math.max(densMin, segCuts),
        densityMinimum: densMin,
      };
    });

    const currentSeg = segments[Math.min(currentSegmentIndex, segments.length - 1)];
    if (enforcedCutCount > exactCutCount) {
      notes.push(`exact cutCount(${exactCutCount}) < density minimum(${totalDensityMin}), enforced to ${enforcedCutCount}`);
    }
    notes.push(`exact cutCount=${enforcedCutCount}, distributed ~${cutsPerSeg}/segment`);

    return {
      totalDurationSec: effectiveTotal,
      segmentDurationCap: cap,
      segmentCount,
      currentPlanningScope: isMultiSegment ? "segment" : "full_sequence",
      totalTargetCuts: enforcedCutCount,
      currentSegmentTargetCuts: Math.min(currentSeg.preferredCutTarget, cap),
      totalCutRange: { min: exactCutCount, max: exactCutCount },
      perSegmentCutRange: { min: cutsPerSeg, max: cutsPerSeg },
      segments,
      planningBasis: "exact_cutCount",
      personaBias,
      notes,
    };
  }

  // preferredRange가 전체 시퀀스 범위이면 세그먼트 수로 나눈다
  const scaledPreferredRange = preferredRange && segmentCount > 1
    ? { min: Math.max(1, Math.round(preferredRange.min / segmentCount)), max: Math.max(1, Math.round(preferredRange.max / segmentCount)) }
    : preferredRange;

  const segments: SegmentCutBudget[] = segmentDurations.map((dur, i) => {
    const segRange = scaledPreferredRange
      ? scaledPreferredRange
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

  const rawTotalTargetCuts = segments.reduce((s, seg) => s + seg.preferredCutTarget, 0);
  const totalTargetCuts = Math.min(rawTotalTargetCuts, CUT_COUNT_MAX);
  const currentSeg = segments[Math.min(currentSegmentIndex, segments.length - 1)];

  if (isMultiSegment) {
    notes.push(`${segmentCount} segments, ~${currentSeg.preferredCutTarget} cuts for segment ${currentSegmentIndex}`);
  }
  if (scaledPreferredRange) {
    notes.push(`preferredRange per segment: ${scaledPreferredRange.min}~${scaledPreferredRange.max}${preferredRange && segmentCount > 1 ? ` (scaled from total ${preferredRange.min}~${preferredRange.max})` : ""}`);
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
    perSegmentCutRange: scaledPreferredRange ?? perSegRange,
    segments,
    planningBasis: preferredRange ? "preferred_range" : "density_policy",
    personaBias,
    notes,
  };
}

/**
 * 총 런타임(초) → 최소 시퀀스 수 반환.
 * 3-Layer 모델: Layer 2 시퀀스 수를 결정.
 *
 * 확정 규칙 (2026-03):
 *   ≤5초: 1컷 (micro)
 *   6~9초: 3컷 (short)
 *   10~15초: 4컷 (shortform-critical)
 *   16초+: over-limit (segment 분할)
 */
export function recommendMinimumCutCount(totalDurationSec: number): number {
  if (!totalDurationSec || totalDurationSec <= 0) return 1;
  if (totalDurationSec <= 5) return 1;
  if (totalDurationSec <= 9) return 3;
  if (totalDurationSec <= 15) return 4;  // 10~15초: shortform-critical
  // segment-aware: 총 런타임을 8초 segment로 분할, 최소 4
  return Math.max(4, Math.ceil(totalDurationSec / VEO_SEGMENT_CAP));
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

  // 0-duration 컷 필터: split 불가능하므로 densify 대상에서 제외 방지 (남겨두되 split 우선순위에서 0점)
  let working = cuts.map(c => ({ ...c }));
  // duration 0 컷이 있으면 경고 (빈 컷은 비디오 생성 실패의 원인)
  const zeroDurCount = working.filter(c => !c.durationSec || c.durationSec <= 0).length;
  if (zeroDurCount > 0) {
    console.warn(`[densifyCuts] ${zeroDurCount} cut(s) with zero/negative duration — cannot split`);
  }
  let needed = minCuts - working.length;

  while (needed > 0) {
    const scoredIndices = working.map((c, i) => {
      const isLongClass = c.durationClass === "scene-like" || c.durationClass === "sequence-like";
      const priority = (isLongClass ? 10000 : 0) + (c.durationSec || 0);
      return { index: i, priority, duration: c.durationSec || 0 };
    });

    scoredIndices.sort((a, b) => b.priority - a.priority);
    const target = scoredIndices[0];

    // 최소 2초: split 후 1초 미만 컷이 나오면 VEO 생성 실패 가능
    if (target.duration <= 3) break;

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
