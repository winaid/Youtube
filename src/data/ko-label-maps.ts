/**
 * ko-label-maps.ts — UI 한국어 표시용 라벨 매핑
 *
 * VEO에는 영어 원문이 전달되고, UI에서는 이 매핑으로 한국어를 보여줌.
 * 매핑에 없는 값은 영어 원문을 그대로 표시.
 */

// ── Shot Type (카메라 샷 사이즈) ─────────────────────────────────
export const SHOT_TYPE_KO: Record<string, string> = {
  ECU: "익스트림 클로즈업",
  CU: "클로즈업",
  MCU: "미디엄 클로즈업",
  MS: "미디엄 샷",
  MLS: "미디엄 롱",
  LS: "롱 샷",
  WS: "와이드 샷",
  OTS: "오버 더 숄더",
  POV: "1인칭 시점",
  // generate-cuts에서 나오는 확장 타입
  wide_establishing: "광각 도입",
  medium_action: "중경 액션",
  close_detail: "클로즈업 디테일",
  over_shoulder: "오버 더 숄더",
  pov_subjective: "1인칭 주관",
  reaction: "리액션",
  insert_cutaway: "인서트 컷",
  transition: "전환",
};

// ── Shot Category (씬 타입 분류) ─────────────────────────────────
export const SHOT_CATEGORY_KO: Record<string, string> = {
  "character-driven": "인물 중심",
  environment: "환경/배경",
  "object-detail": "오브젝트 디테일",
  "map-graphic": "지도/그래픽",
  "transition-atmosphere": "전환/분위기",
  crowd: "군중",
  portrait: "인물 초상",
  battle: "전투",
  product: "제품",
  "cinematic_sequence": "시네마틱 시퀀스",
  map_visualization: "지도 시각화",
};

// ── Narrative Function (서사 기능) ───────────────────────────────
export const NARRATIVE_FUNCTION_KO: Record<string, string> = {
  // generate-cuts Step1에서 사용하는 한국어 서사 기능
  "배경 설정": "배경 설정",
  "문제 제기": "문제 제기",
  "원인 제시": "원인 제시",
  "변화 발생": "변화 발생",
  "갈등/긴장": "갈등/긴장",
  "결과/귀결": "결과/귀결",
  "반전": "반전",
  "결론/의미": "결론/의미",
  // 영어로 올 경우 대응
  exposition: "배경 설정",
  "rising action": "전개",
  climax: "절정",
  resolution: "결말",
  hook: "훅/도입",
  setup: "설정",
  conflict: "갈등",
  twist: "반전",
  payoff: "결과",
  reveal: "공개",
  escalation: "고조",
  "falling action": "하강",
  denouement: "마무리",
  transition: "전환",
  establish: "도입",
  develop: "전개",
  peak: "절정",
  resolve: "해소",
};

// ── Character Role ──────────────────────────────────────────────
export const CHARACTER_ROLE_KO: Record<string, string> = {
  protagonist: "주인공",
  background: "배경 인물",
  silhouette: "실루엣",
  partial: "부분 등장",
  absent: "미등장",
};

// ── Purpose (컷 목적) ───────────────────────────────────────────
export const PURPOSE_KO: Record<string, string> = {
  establish: "도입",
  develop: "전개",
  peak: "절정",
  resolve: "해소",
  hook: "훅",
  transition: "전환",
  "emotional-payoff": "감정 해소",
  "information-reveal": "정보 공개",
  "tension-build": "긴장 고조",
  contrast: "대비",
};

/**
 * 범용 한국어 라벨 조회.
 * 매핑에 있으면 한국어, 없으면 원문 반환.
 */
export function koLabel(map: Record<string, string>, key: string | undefined | null): string {
  if (!key) return "";
  return map[key] ?? map[key.toLowerCase()] ?? key;
}
