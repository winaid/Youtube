/**
 * _sequence-density.ts — 컷 밀도 보정 (서버 함수용)
 *
 * 클라이언트는 @/lib/sequence-density.ts 사용.
 * 서버 함수(Cloudflare Pages Functions)는 이 파일에서 import.
 *
 * 로직은 src/lib/sequence-density.ts와 동일.
 */

const DENSITY_POLICY: { maxSec: number; minCuts: number }[] = [
  { maxSec: 5, minCuts: 1 },
  { maxSec: 9, minCuts: 2 },
  { maxSec: 12, minCuts: 3 },
  { maxSec: 15, minCuts: 3 },
  { maxSec: Infinity, minCuts: 4 },
];

export function recommendMinimumCutCount(totalDurationSec: number): number {
  if (!totalDurationSec || totalDurationSec <= 0) return 1;
  for (const rule of DENSITY_POLICY) {
    if (totalDurationSec <= rule.maxSec) return rule.minCuts;
  }
  return 4;
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
