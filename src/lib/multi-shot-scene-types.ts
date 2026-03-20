/** 멀티 샷이 필요한 장면 유형 → 최소 샷 수 */
export const MULTI_SHOT_SCENE_TYPES_MAP: Record<string, number> = {
  environment: 2,
  "character-driven": 2,
  character: 2,
  crowd: 2,
  battle: 3,
  "map-graphic": 2,
  map_visualization: 2,
  cinematic_sequence: 2,
};

/** Set 형태 (membership check 용) */
export const MULTI_SHOT_SCENE_TYPES = new Set(Object.keys(MULTI_SHOT_SCENE_TYPES_MAP));
