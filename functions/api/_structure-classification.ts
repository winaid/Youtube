/**
 * _structure-classification.ts — 구조 메타 분류 (서버 함수용)
 *
 * 클라이언트는 @/lib/structure-classification.ts 사용.
 * 서버 함수(Cloudflare Pages Functions)는 이 파일에서 import.
 *
 * 로직은 src/lib/structure-classification.ts의 classifyCuts + classifyDurationClass와 동일.
 */

type DurationClass = "cut-like" | "scene-like" | "sequence-like";
type StructureType = "cut" | "scene" | "sequence";

const DURATION_THRESHOLD_SEQUENCE_LIKE = 8;
const DURATION_THRESHOLD_SCENE_LIKE = 4;

function classifyDurationClass(durationSec: number | undefined | null): DurationClass {
  const d = Number(durationSec);
  if (!d || d <= 0 || !Number.isFinite(d)) return "cut-like";
  if (d >= DURATION_THRESHOLD_SEQUENCE_LIKE) return "sequence-like";
  if (d >= DURATION_THRESHOLD_SCENE_LIKE) return "scene-like";
  return "cut-like";
}

/**
 * Cut 배열에 structureType/durationClass를 부여한다.
 * 기존 값이 있으면 유지 (idempotent).
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
