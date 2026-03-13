/**
 * structure-classification.ts — cut/scene/sequence 구조 보조 메타 분류 유틸
 *
 * 두 축을 분리한다:
 *   1. StructureType ("cut" | "scene" | "sequence") — cutCount 기반 구조 힌트
 *   2. DurationClass ("cut-like" | "scene-like" | "sequence-like") — durationSec 기반 길이 해석
 *
 * 이 분류는 soft rule이다. 강제 규칙이 아니라 해석/표시 보조용.
 * duration-reconciliation.ts의 safeDuration/DURATION_MIN/MAX 체계와 독립적으로 동작한다.
 */

import type { StructureType, DurationClass } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Thresholds (soft rule — 해석용, 강제 규칙 아님)
// ═══════════════════════════════════════════════════════════════════

/** duration 기반 분류 임계값 */
export const DURATION_THRESHOLD = {
  /** 이 이상이면 sequence-like */
  sequenceLike: 8,
  /** 이 이상이면 scene-like (sequenceLike 미만일 때) */
  sceneLike: 4,
  // 그 미만은 cut-like
} as const;

/** cutCount 기반 분류 임계값 */
export const CUT_COUNT_THRESHOLD = {
  /** 이 이상이면 sequence 후보 */
  sequence: 3,
  /** 이 이상이면 scene 후보 */
  scene: 2,
  // 1은 cut
} as const;

// ═══════════════════════════════════════════════════════════════════
// Classification helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * duration(초)으로 길이 성격을 분류한다.
 *
 * - >= 8초 → "sequence-like"
 * - >= 4초 → "scene-like"
 * - 그 외 → "cut-like"
 *
 * duration이 0/NaN/undefined면 "cut-like" (안전 fallback).
 */
export function classifyDurationClass(durationSec: number | undefined | null): DurationClass {
  const d = Number(durationSec);
  if (!d || d <= 0 || !Number.isFinite(d)) return "cut-like";
  if (d >= DURATION_THRESHOLD.sequenceLike) return "sequence-like";
  if (d >= DURATION_THRESHOLD.sceneLike) return "scene-like";
  return "cut-like";
}

/**
 * cutCount(해당 단위에 포함된 컷 수)로 구조 타입을 추론한다.
 *
 * - >= 3 → "sequence"
 * - >= 2 → "scene"
 * - 1 또는 그 이하 → "cut"
 *
 * cutCount가 0/undefined면 "cut" (안전 fallback).
 */
export function classifyStructureType(cutCount: number | undefined | null): StructureType {
  const n = Number(cutCount);
  if (!n || n <= 0 || !Number.isFinite(n)) return "cut";
  if (n >= CUT_COUNT_THRESHOLD.sequence) return "sequence";
  if (n >= CUT_COUNT_THRESHOLD.scene) return "scene";
  return "cut";
}

/**
 * 구조 타입과 길이 분류를 동시에 수행한다.
 *
 * cutCount가 주어지지 않으면 structureType은 "cut"으로 fallback.
 * durationSec가 주어지지 않으면 durationClass는 "cut-like"로 fallback.
 */
export function classifyUnit(input: {
  durationSec?: number | null;
  cutCount?: number | null;
}): { structureType: StructureType; durationClass: DurationClass } {
  return {
    structureType: classifyStructureType(input.cutCount),
    durationClass: classifyDurationClass(input.durationSec),
  };
}

/**
 * Cut 배열에 structureType/durationClass 메타를 부여한다.
 *
 * 개별 cut에는:
 * - structureType: "cut" (단일 cut이므로)
 * - durationClass: duration 기반 분류
 *
 * 기존에 값이 명시적으로 있으면 유지, 없을 때만 자동 부여.
 * groupId는 부여하지 않는다 (그룹 정보가 필요하면 별도 호출).
 */
export function classifyCuts<T extends { durationSec: number; structureType?: StructureType; durationClass?: DurationClass }>(
  cuts: T[],
): (T & { structureType: StructureType; durationClass: DurationClass })[] {
  return cuts.map(cut => ({
    ...cut,
    structureType: cut.structureType ?? ("cut" as const),
    durationClass: cut.durationClass ?? classifyDurationClass(cut.durationSec),
  }));
}

/**
 * Cut 배열 전체를 하나의 단위로 볼 때의 구조 분류를 반환한다.
 *
 * 예: 5개 cut, 총 30초 → structureType: "sequence", durationClass: "sequence-like"
 */
export function classifyGroup(cuts: { durationSec: number }[]): {
  structureType: StructureType;
  durationClass: DurationClass;
  totalDurationSec: number;
  cutCount: number;
} {
  const cutCount = cuts.length;
  const totalDurationSec = cuts.reduce((sum, c) => sum + (c.durationSec || 0), 0);
  return {
    structureType: classifyStructureType(cutCount),
    durationClass: classifyDurationClass(totalDurationSec),
    totalDurationSec,
    cutCount,
  };
}
