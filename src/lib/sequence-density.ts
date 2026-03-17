/**
 * sequence-density.ts — 15초 상한 제품용 시퀀스 밀도 보정 유틸
 *
 * 3-Layer 모델:
 *   Layer 1: 총 요청 런타임 (e.g. 48s) — 배치/컨테이너 예산
 *   Layer 2: 시퀀스 (8–15s) — Kling 1회 생성 단위
 *   Layer 3: 시퀀스 내 멀티샷 (최대 6) — multi-shot-planner가 관리
 *
 * 이 파일은 Layer 1 → Layer 2 분할만 담당한다.
 * Layer 3(내부 샷)은 multi-shot-planner.ts가 담당.
 *
 * 핵심 제약: 시퀀스는 SEQUENCE_MIN_DURATION(8s) 미만으로 분할 불가.
 * groupId 자동 생성 금지. 원본 텍스트 필드 최대 보존.
 */

// ═══════════════════════════════════════════════════════════════════
// Policy Constants
// ═══════════════════════════════════════════════════════════════════

/**
 * 시퀀스 최소 길이.
 * densifyCuts는 시퀀스를 이 길이 미만으로 분할하지 않는다.
 * 내부 샷 분할은 multi-shot-planner가 담당.
 */
export const SEQUENCE_MIN_DURATION = 8;

/**
 * 시퀀스 밀도 정책 — 총 런타임 대비 최소 시퀀스 수.
 *
 * 각 시퀀스는 Kling 1회 생성 단위(8–15s).
 * 시퀀스 내부의 샷 수는 multi-shot-planner가 관리.
 *
 * heuristic 기준 (시퀀스 수, 내부 샷이 아님):
 *   8–15s:  1 시퀀스
 *   16–30s: 2 시퀀스
 *   31–45s: 3 시퀀스
 *   46–60s: 4 시퀀스
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DENSITY_POLICY: { maxSec: number; minCuts: number }[] = [
  { maxSec: 5, minCuts: 1 },
  { maxSec: 8, minCuts: 1 },
  { maxSec: 15, minCuts: 1 },
  { maxSec: 30, minCuts: 2 },
  { maxSec: 60, minCuts: 4 },
  { maxSec: 120, minCuts: 8 },
  { maxSec: 300, minCuts: 20 },
  { maxSec: Infinity, minCuts: 20 },
];

// ═══════════════════════════════════════════════════════════════════
// Duration → Recommended Cut Count Range Presets
// ═══════════════════════════════════════════════════════════════════

/**
 * Kling segment 상한. 한 번에 최대 15초만 생성 가능.
 */
export const KLING_SEGMENT_CAP = 15;

/**
 * 최대 허용 컷 수.
 * 데모 안정화: 30 → 10. generate-cuts 토큰 초과 방지.
 */
export const CUT_COUNT_MAX = 10;

/**
 * 시퀀스당 런타임 → 시퀀스 내부 내러티브 밀도 권장 범위.
 *
 * 이 값은 총 런타임을 시퀀스로 분할할 때의 시퀀스 수가 아니라,
 * "이 길이의 시퀀스는 내부적으로 몇 개의 서사 비트/샷을 가져야 하는가"의 가이드.
 * multi-shot-planner와 연동되어 Layer 3 샷 수 결정에 사용.
 *
 *   10–12s: 3–4 internal shots (10s+ = 최소 3컷 규칙)
 *   13–15s: 3–6 internal shots
 *
 * 10s 미만 시퀀스는 특수 케이스 (의도적 원테이크 또는 짧은 컷):
 *   3–5s:  1–2 shots
 *   6–9s:  1–2 shots
 */
const RANGE_PRESETS: { maxSec: number; min: number; max: number }[] = [
  { maxSec: 5,  min: 1, max: 2 },
  { maxSec: 9,  min: 1, max: 2 },
  { maxSec: 12, min: 3, max: 4 },
  { maxSec: 15, min: 3, max: 6 },
];

/**
 * 단일 segment(≤15s) 기준 컷 수 범위 반환. 내부 전용.
 */
function singleSegmentRange(segDur: number): { min: number; max: number } {
  if (segDur <= 0) return { min: 1, max: 2 };
  for (const preset of RANGE_PRESETS) {
    if (segDur <= preset.maxSec) return { min: preset.min, max: preset.max };
  }
  return { min: 1, max: 2 }; // 15초 = 1~2 (Kling 3.0 native)
}

/**
 * 총 런타임(초) → 권장 시퀀스 수 범위 반환.
 * 15초 초과 시 segment 단위로 분할하여 합산.
 * 예: 48초 = 4 segments → 시퀀스 4개 (각 8–15초, 내부 3–6 멀티샷)
 * 예: 120초 = 8 segments → 시퀀스 8개
 */
export function recommendCutCountRange(totalDurationSec: number): { min: number; max: number } {
  if (!totalDurationSec || totalDurationSec <= 0) return { min: 1, max: 2 };
  if (totalDurationSec <= KLING_SEGMENT_CAP) {
    return singleSegmentRange(totalDurationSec);
  }
  // segment-aware: 15초 단위로 분할
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

/**
 * EditingDensityPreset → 컷 수 범위 변환.
 * sparse=느린편집, normal=기본, dense=빠른편집.
 * custom은 사용자가 직접 min/max를 지정하므로 여기서 처리하지 않음.
 */
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

/**
 * persona bias 방향 결정 — 범위 내에서 어디를 선호하는지.
 */
export function personaCutCountBias(
  ep: { motionBias: string; preferredCutPace: [number, number]; insertBias: string },
): "lower" | "upper" | "neutral" {
  // frenetic/dynamic + short pace → upper (더 많은 컷)
  if (ep.motionBias === "frenetic" || (ep.motionBias === "dynamic" && ep.preferredCutPace[1] <= 4)) {
    return "upper";
  }
  // static/minimal + long pace → lower (더 적은 컷)
  if (ep.motionBias === "static" || (ep.motionBias === "minimal" && ep.preferredCutPace[0] >= 5)) {
    return "lower";
  }
  return "neutral";
}

/**
 * 최종 컷 수 결정 — 모든 입력 소스를 종합하여 하나의 컷 수를 반환.
 *
 * 우선순위:
 *   1. exactCutCount (사용자 명시) → 그대로
 *   2. preferredRange + persona bias → 범위 내에서 persona가 bias 적용
 *   3. density minimum (hard floor) → range.min이 density보다 낮으면 density가 승리
 *   4. fallback → recommendCutCountRange 기반
 */
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

  // 1. exact cutCount — 최우선
  if (exactCutCount && exactCutCount > 0) {
    if (exactCutCount < densityMin) {
      notes.push(`exact cutCount(${exactCutCount}) < density minimum(${densityMin}), using density minimum`);
      return { cutCount: densityMin, source: "exact_cutCount", densityMinimum: densityMin, notes };
    }
    return { cutCount: Math.min(exactCutCount, CUT_COUNT_MAX), source: "exact_cutCount", densityMinimum: densityMin, notes };
  }

  // 2. preferred range
  if (preferredRange) {
    // density minimum이 range.min보다 크면 range 하한을 올림
    const effectiveMin = Math.max(preferredRange.min, densityMin);
    const effectiveMax = Math.max(preferredRange.max, effectiveMin);

    if (effectiveMin > preferredRange.min) {
      notes.push(`range min(${preferredRange.min}) < density minimum(${densityMin}), raised to ${effectiveMin}`);
    }

    // persona bias로 범위 내 선택
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
      cutCount: Math.min(selected, CUT_COUNT_MAX),
      source: "preferred_range",
      densityMinimum: densityMin,
      notes,
    };
  }

  // 3. density policy fallback
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
    cutCount: Math.min(fallbackCount, CUT_COUNT_MAX),
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
  /** 전체 시퀀스 기준 목표 컷 수 */
  totalTargetCuts: number;
  /** 현재 segment(generate-cuts 1회 호출) 기준 목표 컷 수 */
  currentSegmentTargetCuts: number;
  /** 전체 시퀀스 기준 권장 범위 */
  totalCutRange: { min: number; max: number };
  /** per-segment 기준 권장 범위 (15초 segment 기본) */
  perSegmentCutRange: { min: number; max: number };
  /** segment별 상세 예산 */
  segments: SegmentCutBudget[];
  /** 결정 근거 */
  planningBasis: string;
  personaBias: "lower" | "upper" | "neutral";
  notes: string[];
}

/**
 * resolveSegmentPlan — 전체 시퀀스를 Kling 15초 segment 단위로 분해한 orchestration plan.
 *
 * 이 함수가 반환하는 plan이 generate-cuts의 targetCuts와 응답 메타의 source of truth.
 * 단일 generate-cuts 호출은 plan.currentSegmentTargetCuts만 사용.
 * 전체 시퀀스 orchestrator는 plan.segments를 순회하며 generate-cuts를 반복 호출.
 */
export function resolveSegmentPlan(opts: {
  totalDurationSec: number;
  exactCutCount?: number;
  preferredRange?: { min: number; max: number };
  personaBias?: "lower" | "upper" | "neutral";
  currentSegmentIndex?: number; // 0-based, 기본 0 (첫 번째 segment)
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

  // ── segment 분해 ──
  const effectiveTotal = totalDurationSec > 0 ? totalDurationSec : cap;
  const segmentCount = Math.max(1, Math.ceil(effectiveTotal / cap));
  const isMultiSegment = segmentCount > 1;

  // ── segment별 duration 계산 ──
  const segmentDurations: number[] = [];
  for (let i = 0; i < segmentCount; i++) {
    if (i < segmentCount - 1) {
      segmentDurations.push(cap);
    } else {
      const remainder = effectiveTotal - (segmentCount - 1) * cap;
      segmentDurations.push(remainder > 0 ? remainder : cap);
    }
  }

  // ── 전체 시퀀스 기준 범위 ──
  const totalCutRange = recommendCutCountRange(effectiveTotal);
  const perSegRange = singleSegmentRange(cap); // 15초 기준 = {3, 5}

  // ── exact cutCount 처리 ──
  if (exactCutCount && exactCutCount > 0) {
    // 전체 컷 수 고정, segment 분배
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

  // ── preferred range 또는 density fallback ──
  const segments: SegmentCutBudget[] = segmentDurations.map((dur, i) => {
    const segRange = preferredRange
      ? preferredRange  // 사용자 지정 범위는 per-segment 기준으로 해석
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

// ═══════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════

/**
 * 총 런타임(초) → 최소 시퀀스 수 반환.
 *
 * 3-Layer 모델: 이 함수는 Layer 2 시퀀스 수를 결정.
 * 15초 초과 시 segment 단위로 분할: ceil(total / 15).
 * 각 시퀀스 내부의 샷 수(Layer 3)는 multi-shot-planner가 결정.
 *
 * 48초 → ceil(48/15) = 4 시퀀스 (각 12초)
 * 120초 → ceil(120/15) = 8 시퀀스 (각 15초)
 */
export function recommendMinimumCutCount(totalDurationSec: number): number {
  if (!totalDurationSec || totalDurationSec <= 0) return 1;
  // 10초 이상이면 최소 3컷 (제품 규칙: 10s+ = min 3, typical 3-6)
  if (totalDurationSec >= 10 && totalDurationSec <= KLING_SEGMENT_CAP) {
    return 3;
  }
  if (totalDurationSec < 10) {
    return 1;
  }
  // segment-aware: 총 런타임을 15초 segment로 분할, 최소 3
  return Math.max(3, Math.ceil(totalDurationSec / KLING_SEGMENT_CAP));
}

/**
 * 현재 cuts 배열이 density 보정이 필요한지 판단한다.
 */
export function needsDensityBoost(
  cuts: Array<{ durationSec: number; durationClass?: string }>,
  totalDurationSec?: number,
): boolean {
  if (cuts.length === 0) return false;
  const total = totalDurationSec ?? cuts.reduce((s, c) => s + (c.durationSec || 0), 0);
  const minCuts = recommendMinimumCutCount(total);
  return cuts.length < minCuts;
}

/**
 * 시퀀스 밀도 보정 — 가장 긴 시퀀스부터 분할하되, SEQUENCE_MIN_DURATION 미만으로는 분할 불가.
 *
 * 3-Layer 모델에서 Layer 1→2 분할만 담당:
 *   - 총 런타임 → 시퀀스(8–15s 생성 단위) 분할
 *   - 시퀀스 내부 샷(Layer 3)은 multi-shot-planner가 관리
 *
 * 분할 규칙:
 * - scene-like / sequence-like인 시퀀스를 우선 분할 대상으로 선택
 * - 분할 후 양쪽 모두 SEQUENCE_MIN_DURATION(8s) 이상이어야 분할 수행
 * - 8s 미만 시퀀스는 내부 멀티샷으로 리듬을 만들되, 시퀀스 자체를 쪼개지 않음
 * - 원본 텍스트 필드 보존
 * - cutNumber는 최종 배열 순서에 맞게 재정렬
 */
export function densifyCuts<T extends { durationSec: number; structureType?: string; durationClass?: string }>(
  cuts: T[],
  totalDurationSec?: number,
): T[] {
  if (cuts.length === 0) return cuts;

  const total = totalDurationSec ?? cuts.reduce((s, c) => s + (c.durationSec || 0), 0);
  const minCuts = recommendMinimumCutCount(total);

  if (cuts.length >= minCuts) return cuts;

  // 작업 배열 복사
  let working = cuts.map(c => ({ ...c }));
  let needed = minCuts - working.length;

  while (needed > 0) {
    // 분할 대상 선택: scene-like/sequence-like 우선, 그 안에서 가장 긴 것
    const scoredIndices = working.map((c, i) => {
      const isLongClass = c.durationClass === "scene-like" || c.durationClass === "sequence-like";
      const priority = (isLongClass ? 10000 : 0) + (c.durationSec || 0);
      return { index: i, priority, duration: c.durationSec || 0 };
    });

    scoredIndices.sort((a, b) => b.priority - a.priority);
    const target = scoredIndices[0];

    // 분할 후 양쪽 모두 SEQUENCE_MIN_DURATION 이상인지 확인.
    // 불가능하면 중단 — 시퀀스를 마이크로 컷으로 쪼개지 않음.
    // 내부 리듬은 multi-shot-planner가 담당.
    const halfDuration = Math.round(target.duration / 2);
    const remainDuration = target.duration - halfDuration;
    if (halfDuration < SEQUENCE_MIN_DURATION || remainDuration < SEQUENCE_MIN_DURATION) break;

    const original = working[target.index];
    const firstHalf = { ...original, durationSec: halfDuration } as T;
    const secondHalf = { ...original, durationSec: remainDuration } as T;

    // durationClass/structureType은 제거 — 나중에 classifyCuts에서 다시 부여
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

  // ── Kling 15초 상한 클램핑: 개별 컷이 KLING_SEGMENT_CAP 초과 시 분할 ──
  const clamped: typeof working = [];
  for (const c of working) {
    if (c.durationSec > KLING_SEGMENT_CAP) {
      const splitCount = Math.ceil(c.durationSec / KLING_SEGMENT_CAP);
      const baseDur = Math.floor(c.durationSec / splitCount);
      const remainder = c.durationSec - baseDur * splitCount;
      for (let s = 0; s < splitCount; s++) {
        const splitDur = s === splitCount - 1 ? baseDur + remainder : baseDur;
        const part = { ...c, durationSec: splitDur } as typeof c;
        delete (part as Record<string, unknown>).durationClass;
        delete (part as Record<string, unknown>).structureType;
        clamped.push(part);
      }
    } else {
      clamped.push(c);
    }
  }
  working = clamped;

  // cutNumber 재정렬 (cutNumber 필드가 있는 경우에만)
  return working.map((c, i) => {
    if ("cutNumber" in c) {
      return { ...c, cutNumber: i + 1 };
    }
    return c;
  }) as T[];
}
