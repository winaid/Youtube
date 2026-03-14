/**
 * sequence-density.ts — 15초 상한 제품용 컷 밀도 보정 유틸
 *
 * 역할:
 *   - 총 길이 대비 컷 수가 너무 적은 경우 가장 긴 컷부터 분할
 *   - scene-like / sequence-like 컷을 우선 분할
 *   - groupId 자동 생성 금지
 *   - 원본 텍스트 필드 최대 보존
 */

// ═══════════════════════════════════════════════════════════════════
// Policy Constants
// ═══════════════════════════════════════════════════════════════════

/** 총 길이(초) 기준 최소 컷 수 정책 */
const DENSITY_POLICY: { maxSec: number; minCuts: number }[] = [
  { maxSec: 5, minCuts: 1 },
  { maxSec: 9, minCuts: 2 },
  { maxSec: 12, minCuts: 3 },
  { maxSec: 15, minCuts: 3 },
  { maxSec: Infinity, minCuts: 4 },
];

// ═══════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════

/**
 * 총 길이(초) 기준으로 권장 최소 컷 수를 반환한다.
 */
export function recommendMinimumCutCount(totalDurationSec: number): number {
  if (!totalDurationSec || totalDurationSec <= 0) return 1;
  for (const rule of DENSITY_POLICY) {
    if (totalDurationSec <= rule.maxSec) return rule.minCuts;
  }
  return 4;
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
 * 컷 밀도가 부족하면 가장 긴 컷부터 분할하여 최소 컷 수를 맞춘다.
 *
 * 분할 규칙:
 * - scene-like / sequence-like인 컷을 우선 분할 대상으로 선택
 * - 이미 cut-like(< 4초)인 컷은 가급적 유지
 * - 원본 텍스트 필드 보존 (sceneDescription 등)
 * - groupId 자동 생성 안 함
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
      // 점수: durationClass가 긴 카테고리이면 우선순위 높음, duration이 길수록 높음
      const priority = (isLongClass ? 10000 : 0) + (c.durationSec || 0);
      return { index: i, priority, duration: c.durationSec || 0 };
    });

    // 가장 높은 우선순위(= 가장 분할 적합한) 컷 선택
    scoredIndices.sort((a, b) => b.priority - a.priority);
    const target = scoredIndices[0];

    // 분할 불가: 2초 이하면 더 쪼갤 수 없음
    if (target.duration <= 2) break;

    // 컷을 2등분
    const original = working[target.index];
    const halfDuration = Math.round(target.duration / 2);
    const remainDuration = target.duration - halfDuration;

    const firstHalf = { ...original, durationSec: halfDuration } as T;
    const secondHalf = { ...original, durationSec: remainDuration } as T;

    // durationClass/structureType은 제거 — 나중에 classifyCuts에서 다시 부여
    delete (firstHalf as Record<string, unknown>).durationClass;
    delete (firstHalf as Record<string, unknown>).structureType;
    delete (secondHalf as Record<string, unknown>).durationClass;
    delete (secondHalf as Record<string, unknown>).structureType;

    // 원본 위치에 2개로 교체
    working = [
      ...working.slice(0, target.index),
      firstHalf,
      secondHalf,
      ...working.slice(target.index + 1),
    ];

    needed--;
  }

  // cutNumber 재정렬 (cutNumber 필드가 있는 경우에만)
  return working.map((c, i) => {
    if ("cutNumber" in c) {
      return { ...c, cutNumber: i + 1 };
    }
    return c;
  }) as T[];
}
