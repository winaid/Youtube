/**
 * style-capability-matrix.ts — 스타일별 구현 가능성·지원 수준 중앙 정책
 *
 * 목적:
 *   1. 각 스타일의 기술적 지원 수준을 정량화 (UI 분기, 프롬프트 분기, 경고 표시에 사용)
 *   2. V1/V2/unsupported 배포 단계 구분
 *   3. 스타일별 추가 요구사항 (reference image, custom element, 후처리 등) 명시
 *   4. 프론트엔드 → 백엔드 전 구간에서 일관된 스타일 정책 참조점
 *
 * 사용처:
 *   - InputPanel: 스타일 선택 UI에서 뱃지·경고·비활성 처리
 *   - prompt-architecture: 스타일별 프롬프트 강화/보정 분기
 *   - generate-video: 스타일별 모델 선택·파라미터 조정
 *   - montage-export: 후처리 필요 스타일 표시
 *
 * grep: StyleCapability, StyleSupportTier, getStyleCapability, V1_STYLES,
 *       STYLE_CAPABILITY_MAP, needsCustomElement, needsPostProcessing
 */

import { getAllStyles } from "@/data/style-catalog";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/**
 * 스타일 지원 등급.
 *
 * - "full"       → 현재 시스템에서 바로 지원, 프롬프트만으로 안정적 결과
 * - "supported"  → 지원 가능하나 품질 불안정 구간 있음 (경고 표시 권장)
 * - "partial"    → 추가 개발/후처리 필요, 또는 기대치 괴리 있음
 * - "cosmetic"   → 마케팅적으로 노출 가능하나 실질 품질 보장 어려움
 * - "unsupported"→ 현재 구조에서 구현 불가, UI에서 비활성 또는 숨김
 */
export type StyleSupportTier = "full" | "supported" | "partial" | "cosmetic" | "unsupported";

/**
 * 배포 단계.
 * - "v1" → 첫 배포에 포함
 * - "v2" → 후속 릴리스 예정
 * - "excluded" → 당분간 제외
 */
export type ReleasePhase = "v1" | "v2" | "excluded";

/**
 * 스타일이 안정적으로 작동하기 위해 추가로 필요한 것들.
 */
export interface StyleRequirements {
  /** Custom Element (캐릭터 고정)가 필요한가 */
  needsCustomElement: boolean;
  /** reference image (첫 프레임 / 스타일 레퍼런스)가 필요한가 */
  needsReferenceImage: boolean;
  /** 후처리 파이프라인이 필요한가 (FFmpeg overlay, frame manipulation 등) */
  needsPostProcessing: boolean;
  /** image-to-video 워크플로우가 필수인가 (text-to-video만으로 부족) */
  requiresImageToVideo: boolean;
  /** 멀티샷 분해가 필수인가 (단일 프롬프트로 불충분) */
  requiresMultiShot: boolean;
  /** negative prompt 강화가 필수인가 */
  needsNegativeReinforcement: boolean;
}

/**
 * 스타일별 구현 가능성 매트릭스 엔트리.
 */
export interface StyleCapability {
  /** 스타일 ID (style-catalog.ts의 StyleEntry.id) */
  styleId: string;
  /** 기술적 지원 등급 */
  tier: StyleSupportTier;
  /** 배포 단계 */
  release: ReleasePhase;
  /** 품질 안정성 (1~5) — 5가 가장 안정 */
  stabilityScore: 1 | 2 | 3 | 4 | 5;
  /** 사용자 기대치 vs 결과물 괴리 (1~5) — 5가 가장 큰 괴리 */
  expectationGap: 1 | 2 | 3 | 4 | 5;
  /** 추가 요구사항 */
  requirements: StyleRequirements;
  /** 프롬프트만으로 스타일 제어 가능 여부 */
  promptOnly: boolean;
  /** UI에서 표시할 경고 문구 (없으면 null) */
  warningKo: string | null;
  /** unsupported 시 대체 스타일 ID (fallback) */
  fallbackStyleId: string | null;
  /** 기술적 제약 사유 (내부 참고용) */
  technicalNote: string;
}

// ═══════════════════════════════════════════════════════════════════
// Default Requirements (대부분 스타일은 프롬프트만으로 충분)
// ═══════════════════════════════════════════════════════════════════

const PROMPT_ONLY: StyleRequirements = {
  needsCustomElement: false,
  needsReferenceImage: false,
  needsPostProcessing: false,
  requiresImageToVideo: false,
  requiresMultiShot: false,
  needsNegativeReinforcement: false,
};

const WITH_NEGATIVE: StyleRequirements = {
  ...PROMPT_ONLY,
  needsNegativeReinforcement: true,
};

const WITH_ELEMENT: StyleRequirements = {
  ...PROMPT_ONLY,
  needsCustomElement: true,
};

const WITH_POST: StyleRequirements = {
  ...PROMPT_ONLY,
  needsPostProcessing: true,
};

// ═══════════════════════════════════════════════════════════════════
// Style Capability Map
// ═══════════════════════════════════════════════════════════════════

export const STYLE_CAPABILITY_MAP: Record<string, StyleCapability> = {
  // ─── 실사 (Live Action) ────────────────────────────────────
  "cinematic-realism": {
    styleId: "cinematic-realism",
    tier: "full",
    release: "v1",
    stabilityScore: 5,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "Kling O3 주력 도메인. photorealistic은 가장 안정적.",
  },
  "docu-handheld": {
    styleId: "docu-handheld",
    tier: "supported",
    release: "v1",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: "카메라 흔들림 효과가 불안정할 수 있습니다. 다큐멘터리 '톤' 중심으로 적용됩니다.",
    fallbackStyleId: "cinematic-realism",
    technicalNote: "handheld shake 시뮬레이션 품질 불안정. 조명·색감 위주로 차별화.",
  },
  "commercial-ad": {
    styleId: "commercial-ad",
    tier: "full",
    release: "v1",
    stabilityScore: 4,
    expectationGap: 2,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: "특정 제품 형태는 보장되지 않습니다. 제품 이미지 업로드를 권장합니다.",
    fallbackStyleId: "cinematic-realism",
    technicalNote: "studio lighting, clean composition은 잘 됨. 제품 형태 정확도는 reference image 필요.",
  },
  "vintage-film": {
    styleId: "vintage-film",
    tier: "full",
    release: "v1",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "film grain, faded colors, light leaks — 모델이 잘 반영하는 영역.",
  },
  "neon-noir": {
    styleId: "neon-noir",
    tier: "full",
    release: "v1",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "네온 컬러 + 어두운 분위기는 모델이 좋아하는 영역.",
  },
  "vhs-retro": {
    styleId: "vhs-retro",
    tier: "supported",
    release: "v1",
    stabilityScore: 3,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "VHS 아티팩트가 불완전할 수 있습니다. '레트로 감성' 수준으로 적용됩니다.",
    fallbackStyleId: "vintage-film",
    technicalNote: "스캔라인·트래킹 노이즈 재현 불완전. 후처리 파이프라인 추가 시 개선 가능.",
  },
  "sf-futuristic": {
    styleId: "sf-futuristic",
    tier: "full",
    release: "v1",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "SF 도시 구조가 반복되는 경향. scene prompt에서 location cue 강화 필요.",
  },
  "gothic-horror": {
    styleId: "gothic-horror",
    tier: "full",
    release: "v1",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: "과도한 공포 표현은 안전 필터에 의해 제한될 수 있습니다.",
    fallbackStyleId: "cinematic-realism",
    technicalNote: "dark atmosphere는 잘 만들지만 safety filter 주의.",
  },

  // ─── 2D 애니메이션 ────────────────────────────────────────
  "tv-anime": {
    styleId: "tv-anime",
    tier: "partial",
    release: "v1",
    stabilityScore: 2,
    expectationGap: 4,
    requirements: WITH_ELEMENT,
    promptOnly: false,
    warningKo: "TV 애니메이션 수준의 셀 애니를 기대하면 품질 차이가 있을 수 있습니다. 캐릭터 고정을 위해 Custom Element 등록을 권장합니다.",
    fallbackStyleId: "theatrical-anime",
    technicalNote: "cel-shading 일관성 유지 불가. 라인 두께 변동, 얼굴 변형 빈번. Custom Element 필수.",
  },
  "theatrical-anime": {
    styleId: "theatrical-anime",
    tier: "supported",
    release: "v1",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: WITH_ELEMENT,
    promptOnly: false,
    warningKo: "캐릭터 일관성을 위해 Custom Element 등록을 권장합니다.",
    fallbackStyleId: "storybook-anime",
    technicalNote: "painted backgrounds + atmospheric depth가 diffusion에 친화적. tv-anime보다 안정.",
  },
  "storybook-anime": {
    styleId: "storybook-anime",
    tier: "full",
    release: "v1",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "soft pastel + round designs — diffusion 모델이 가장 잘하는 비실사 2D.",
  },
  "painted-2d": {
    styleId: "painted-2d",
    tier: "full",
    release: "v1",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "hand-painted look은 diffusion 모델 기본 성향과 잘 맞음.",
  },
  "watercolor-animation": {
    styleId: "watercolor-animation",
    tier: "supported",
    release: "v1",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "유화풍 결과물과 유사하게 나올 수 있습니다.",
    fallbackStyleId: "painted-2d",
    technicalNote: "painted-2d와 결과물 모호. 수채 특유의 투명 레이어 재현 불안정.",
  },
  "ink-drawing-anime": {
    styleId: "ink-drawing-anime",
    tier: "partial",
    release: "v1",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "모노크롬 유지가 불안정합니다. 부분적으로 컬러가 나타날 수 있습니다.",
    fallbackStyleId: "painted-2d",
    technicalNote: "흑백/모노크롬 강제가 모델 수준에서 어려움. 컬러 누출 빈번.",
  },
  "webtoon-motion": {
    styleId: "webtoon-motion",
    tier: "partial",
    release: "v1",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_ELEMENT,
    promptOnly: false,
    warningKo: "일본 애니메이션 스타일과 구분이 모호할 수 있습니다.",
    fallbackStyleId: "tv-anime",
    technicalNote: "웹툰 vs 일본애니 구분이 모델에서 매우 모호.",
  },
  "cutout-anime": {
    styleId: "cutout-anime",
    tier: "cosmetic",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 4,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "종이 오려붙이기 텍스처는 표현되지만, 관절/힌지 움직임은 일반 애니메이션으로 렌더링됩니다.",
    fallbackStyleId: "storybook-anime",
    technicalNote: "소재 텍스처만 유사, 움직임 특성(hinged joint)은 재현 불가.",
  },

  // ─── 3D 애니메이션 ────────────────────────────────────────
  "pixar-style": {
    styleId: "pixar-style",
    tier: "full",
    release: "v1",
    stabilityScore: 5,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "Kling O3가 가장 잘하는 비실사 스타일. 학습 데이터 풍부.",
  },
  "dreamworks-style": {
    styleId: "dreamworks-style",
    tier: "supported",
    release: "v1",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: "픽사풍과 결과물이 유사할 수 있습니다.",
    fallbackStyleId: "pixar-style",
    technicalNote: "Pixar vs DreamWorks 구분이 모델에서 미묘.",
  },
  "stylized-3d": {
    styleId: "stylized-3d",
    tier: "partial",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "셀셰이딩 3D 효과가 불안정합니다. 픽사풍으로 수렴할 수 있습니다.",
    fallbackStyleId: "pixar-style",
    technicalNote: "toon shading over 3D geometry는 특수 렌더러 영역. 프롬프트 제어 한계.",
  },
  "semi-real-3d": {
    styleId: "semi-real-3d",
    tier: "full",
    release: "v1",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "스타일 간 보간은 diffusion 모델의 강점. 자연스러운 중간지대.",
  },
  "low-poly-3d": {
    styleId: "low-poly-3d",
    tier: "partial",
    release: "v1",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "의도적인 저폴리곤 느낌이 유지되지 않을 수 있습니다. 모델이 디테일을 추가하는 경향이 있습니다.",
    fallbackStyleId: "pixar-style",
    technicalNote: "모델이 디테일 추가 경향 강함. 의도적 단순함 유지 어려움.",
  },
  "miniature-3d": {
    styleId: "miniature-3d",
    tier: "full",
    release: "v1",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "tilt-shift + shallow DoF — 학습 데이터에 풍부.",
  },
  "game-cinematic-3d": {
    styleId: "game-cinematic-3d",
    tier: "supported",
    release: "v1",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: "시네마틱 리얼리즘과 결과물이 유사할 수 있습니다.",
    fallbackStyleId: "cinematic-realism",
    technicalNote: "cinematic-realism + heroic lighting 변형. 모델 수준에서 차이 미미.",
  },

  // ─── 회화/일러스트 ────────────────────────────────────────
  "watercolor": {
    styleId: "watercolor",
    tier: "full",
    release: "v1",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "수채화 텍스처 자체는 안정. 유화와 구분 모호해질 수 있음.",
  },
  "oil-painting": {
    styleId: "oil-painting",
    tier: "full",
    release: "v1",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "impasto 질감은 diffusion 모델이 잘 만듦.",
  },
  "gouache": {
    styleId: "gouache",
    tier: "cosmetic",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "수채화 스타일과 구분이 어려울 수 있습니다.",
    fallbackStyleId: "watercolor",
    technicalNote: "수채화와 모델 출력 구분 불가.",
  },
  "pastel": {
    styleId: "pastel",
    tier: "cosmetic",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "수채화 스타일과 유사하게 나올 수 있습니다.",
    fallbackStyleId: "watercolor",
    technicalNote: "수채화와 모델 출력 구분 불가.",
  },
  "east-asian-painting": {
    styleId: "east-asian-painting",
    tier: "partial",
    release: "v1",
    stabilityScore: 2,
    expectationGap: 4,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "정적 그림으로 렌더링되거나 문자가 삽입될 수 있습니다. '동양화풍 모션' 수준으로 적용됩니다.",
    fallbackStyleId: "painted-2d",
    technicalNote: "정적 렌더링 수렴 + 서예/글자 자동 삽입 위험. 매우 높은 리스크.",
  },
  "ink-wash": {
    styleId: "ink-wash",
    tier: "partial",
    release: "v1",
    stabilityScore: 2,
    expectationGap: 4,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "모노크롬 유지가 불안정하고 정적 그림으로 수렴할 수 있습니다.",
    fallbackStyleId: "east-asian-painting",
    technicalNote: "east-asian-painting과 동일 리스크 + 모노크롬 유지 실패.",
  },
  "inkwash-painting": {
    styleId: "inkwash-painting",
    tier: "cosmetic",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "수묵풍 스타일과 유사하게 나올 수 있습니다.",
    fallbackStyleId: "ink-wash",
    technicalNote: "ink-wash와 거의 동일.",
  },
  "van-gogh-painted": {
    styleId: "van-gogh-painted",
    tier: "full",
    release: "v1",
    stabilityScore: 5,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "모델이 가장 잘 아는 화풍. Starry Night 스타일은 최고 안정성.",
  },
  "editorial-illustration": {
    styleId: "editorial-illustration",
    tier: "cosmetic",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "제한된 색상 팔레트 제어가 불안정합니다.",
    fallbackStyleId: "storybook-illustration",
    technicalNote: "limited palette 제어 어려움. 모델이 색을 추가하려 함.",
  },
  "storybook-illustration": {
    styleId: "storybook-illustration",
    tier: "supported",
    release: "v1",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "storybook-anime와 유사. warm gentle palette은 안정적.",
  },

  // ─── 스톱모션/공예 ────────────────────────────────────────
  "claymation": {
    styleId: "claymation",
    tier: "supported",
    release: "v1",
    stabilityScore: 3,
    expectationGap: 3,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: "점토 질감은 표현되지만 스톱모션 특유의 프레임 단위 떨림 효과는 제한적입니다.",
    fallbackStyleId: "pixar-style",
    technicalNote: "clay texture OK, stop-motion jitter 불가 (diffusion은 smooth interpolation).",
  },
  "paper-collage": {
    styleId: "paper-collage",
    tier: "cosmetic",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "종이 텍스처는 표현되지만 실제 스톱모션 움직임은 일반 애니메이션으로 렌더링됩니다.",
    fallbackStyleId: "cutout-anime",
    technicalNote: "소재 텍스처만 유사, 움직임 특성 재현 불가.",
  },
  "felt-craft": {
    styleId: "felt-craft",
    tier: "cosmetic",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "펠트 텍스처는 표현되지만 수공예 특유의 움직임은 제한적입니다.",
    fallbackStyleId: "claymation",
    technicalNote: "소재 텍스처만 유사, 움직임 특성 재현 불가.",
  },
  "wooden-puppet": {
    styleId: "wooden-puppet",
    tier: "cosmetic",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "나무 질감은 표현되지만 마리오네트 움직임은 제한적입니다.",
    fallbackStyleId: "claymation",
    technicalNote: "소재 텍스처만 유사, 관절 움직임 재현 불가.",
  },
  "paper-puppet": {
    styleId: "paper-puppet",
    tier: "cosmetic",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "그림자극 분위기는 표현되지만 종이 인형 움직임은 제한적입니다.",
    fallbackStyleId: "cutout-anime",
    technicalNote: "silhouette/backlit은 가능하지만 articulated paper joint 불가.",
  },
  "miniature-diorama": {
    styleId: "miniature-diorama",
    tier: "supported",
    release: "v1",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: "미니어처 3D 스타일과 유사한 결과물이 나올 수 있습니다.",
    fallbackStyleId: "miniature-3d",
    technicalNote: "miniature-3d와 실질적으로 동일.",
  },

  // ─── 레트로/게임풍 ────────────────────────────────────────
  "pixel-art": {
    styleId: "pixel-art",
    tier: "unsupported",
    release: "excluded",
    stabilityScore: 1,
    expectationGap: 5,
    requirements: WITH_POST,
    promptOnly: false,
    warningKo: "현재 지원되지 않습니다. 픽셀 단위 정밀도는 AI 영상 생성 모델의 구조적 한계입니다.",
    fallbackStyleId: "storybook-anime",
    technicalNote: "pixel-perfect 렌더링 구조적 불가. diffusion은 anti-aliased 출력만 가능.",
  },
  "16bit-jrpg": {
    styleId: "16bit-jrpg",
    tier: "unsupported",
    release: "excluded",
    stabilityScore: 1,
    expectationGap: 5,
    requirements: WITH_POST,
    promptOnly: false,
    warningKo: "현재 지원되지 않습니다. 레트로 게임 스타일은 향후 전용 후처리 파이프라인과 함께 지원 예정입니다.",
    fallbackStyleId: "storybook-anime",
    technicalNote: "pixel-art와 동일한 구조적 한계.",
  },
  "8bit-arcade": {
    styleId: "8bit-arcade",
    tier: "unsupported",
    release: "excluded",
    stabilityScore: 1,
    expectationGap: 5,
    requirements: WITH_POST,
    promptOnly: false,
    warningKo: "현재 지원되지 않습니다.",
    fallbackStyleId: "storybook-anime",
    technicalNote: "pixel-art와 동일한 구조적 한계.",
  },
  "ps1-lowpoly": {
    styleId: "ps1-lowpoly",
    tier: "unsupported",
    release: "excluded",
    stabilityScore: 1,
    expectationGap: 5,
    requirements: WITH_POST,
    promptOnly: false,
    warningKo: "현재 지원되지 않습니다. 렌더링 엔진 수준의 기법은 프롬프트로 제어할 수 없습니다.",
    fallbackStyleId: "low-poly-3d",
    technicalNote: "affine texture distortion, vertex snapping — 렌더링 엔진 레벨 기법.",
  },
  "90s-game-cutscene": {
    styleId: "90s-game-cutscene",
    tier: "cosmetic",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "90년대 CG 느낌이 불안정하게 표현됩니다.",
    fallbackStyleId: "game-cinematic-3d",
    technicalNote: "early CG look 일관성 낮음.",
  },
  "visual-novel": {
    styleId: "visual-novel",
    tier: "cosmetic",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "'거의 정적'인 캐릭터 제어가 어렵습니다. 모델이 과도한 움직임을 추가할 수 있습니다.",
    fallbackStyleId: "tv-anime",
    technicalNote: "subtle motion 제어 불가. 모델은 항상 움직임을 추가하려 함.",
  },

  // ─── 실험/하이브리드 ──────────────────────────────────────
  "rotoscoping": {
    styleId: "rotoscoping",
    tier: "cosmetic",
    release: "v2",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: WITH_NEGATIVE,
    promptOnly: true,
    warningKo: "실사와 회화 두 레이어가 동시에 유지되지 않을 수 있습니다.",
    fallbackStyleId: "painted-2d",
    technicalNote: "dual-layer (photorealistic base + painted overlay) 공존 어려움.",
  },
  "mixed-media-collage": {
    styleId: "mixed-media-collage",
    tier: "unsupported",
    release: "excluded",
    stabilityScore: 1,
    expectationGap: 5,
    requirements: { ...WITH_POST, requiresImageToVideo: true },
    promptOnly: false,
    warningKo: "현재 지원되지 않습니다. 여러 매체를 혼합하는 콜라주는 영상 합성(compositing) 파이프라인이 필요합니다.",
    fallbackStyleId: "painted-2d",
    technicalNote: "multi-layer compositing 필요. 단일 생성 모델로는 불가능.",
  },
  "live-paint-overlay": {
    styleId: "live-paint-overlay",
    tier: "unsupported",
    release: "excluded",
    stabilityScore: 1,
    expectationGap: 5,
    requirements: { ...WITH_POST, requiresImageToVideo: true },
    promptOnly: false,
    warningKo: "현재 지원되지 않습니다. 실사 위 페인트 합성은 별도 합성 파이프라인이 필요합니다.",
    fallbackStyleId: "painted-2d",
    technicalNote: "dual-layer compositing 필요.",
  },
  "docu-illustrated": {
    styleId: "docu-illustrated",
    tier: "unsupported",
    release: "excluded",
    stabilityScore: 1,
    expectationGap: 5,
    requirements: { ...WITH_POST, requiresImageToVideo: true },
    promptOnly: false,
    warningKo: "현재 지원되지 않습니다. 실사 영상 위 인포그래픽 오버레이는 영상 합성 기능이 필요합니다.",
    fallbackStyleId: "docu-handheld",
    technicalNote: "video compositing이지 generation이 아님.",
  },
  "2d-3d-hybrid": {
    styleId: "2d-3d-hybrid",
    tier: "unsupported",
    release: "excluded",
    stabilityScore: 1,
    expectationGap: 5,
    requirements: { ...WITH_POST, requiresImageToVideo: true },
    promptOnly: false,
    warningKo: "현재 지원되지 않습니다. 프레임 내 렌더링 방식 분리는 단일 AI 모델로는 불가합니다.",
    fallbackStyleId: "semi-real-3d",
    technicalNote: "프레임 내 2D/3D 렌더링 분리는 구조적 불가.",
  },
  "surreal-composite": {
    styleId: "surreal-composite",
    tier: "full",
    release: "v1",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "diffusion 모델의 hallucination이 오히려 장점. 초현실 표현에 최적.",
  },
};

// ═══════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════

/** 스타일 ID로 capability 조회. 없으면 기본 "지원" 반환 */
export function getStyleCapability(styleId: string): StyleCapability {
  return STYLE_CAPABILITY_MAP[styleId] ?? {
    styleId,
    tier: "supported",
    release: "v1",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: PROMPT_ONLY,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: "cinematic-realism",
    technicalNote: "capability matrix에 미등록 스타일. 기본 지원으로 처리.",
  };
}

/** V1 배포 대상 스타일 ID 목록 */
export function getV1StyleIds(): string[] {
  return Object.values(STYLE_CAPABILITY_MAP)
    .filter(c => c.release === "v1")
    .map(c => c.styleId);
}

/** V2 예정 스타일 ID 목록 */
export function getV2StyleIds(): string[] {
  return Object.values(STYLE_CAPABILITY_MAP)
    .filter(c => c.release === "v2")
    .map(c => c.styleId);
}

/** 제외된 스타일 ID 목록 */
export function getExcludedStyleIds(): string[] {
  return Object.values(STYLE_CAPABILITY_MAP)
    .filter(c => c.release === "excluded")
    .map(c => c.styleId);
}

/** tier 기준 스타일 필터 */
export function getStylesByTier(tier: StyleSupportTier): StyleCapability[] {
  return Object.values(STYLE_CAPABILITY_MAP).filter(c => c.tier === tier);
}

/** Custom Element가 필요한 스타일인지 확인 */
export function needsCustomElement(styleId: string): boolean {
  return getStyleCapability(styleId).requirements.needsCustomElement;
}

/** 후처리가 필요한 스타일인지 확인 */
export function needsPostProcessing(styleId: string): boolean {
  return getStyleCapability(styleId).requirements.needsPostProcessing;
}

/** 스타일이 현재 지원 가능한지 (unsupported가 아닌지) */
export function isStyleAvailable(styleId: string): boolean {
  return getStyleCapability(styleId).tier !== "unsupported";
}

/** 스타일의 fallback 체인 반환 (최대 3단계) */
export function getStyleFallbackChain(styleId: string): string[] {
  const chain: string[] = [styleId];
  let current = styleId;
  for (let i = 0; i < 3; i++) {
    const cap = getStyleCapability(current);
    if (!cap.fallbackStyleId || chain.includes(cap.fallbackStyleId)) break;
    chain.push(cap.fallbackStyleId);
    current = cap.fallbackStyleId;
  }
  return chain;
}

/**
 * UI용 스타일 상태 분류.
 * - "enabled"  → 정상 선택 가능
 * - "warning"  → 선택 가능하되 경고 표시
 * - "beta"     → 베타 뱃지 + 경고
 * - "disabled" → 비활성 (선택 불가)
 * - "hidden"   → UI에서 숨김
 */
export type StyleUiState = "enabled" | "warning" | "beta" | "disabled" | "hidden";

export function getStyleUiState(styleId: string): StyleUiState {
  const cap = getStyleCapability(styleId);

  if (cap.tier === "unsupported") return "hidden";
  if (cap.release === "excluded") return "hidden";
  if (cap.release === "v2") return "disabled";
  if (cap.tier === "cosmetic") return "disabled";
  if (cap.tier === "partial") return "beta";
  if (cap.warningKo) return "warning";
  return "enabled";
}

/**
 * 프롬프트 생성 시 스타일별 분기 정보.
 * - additionalNegatives: 추가 부정 프롬프트
 * - promptReinforcement: 스타일 드리프트 방지 강화 텍스트
 * - forceMonochrome: 흑백 강제 여부
 */
export interface StylePromptOverride {
  additionalNegatives: string[];
  promptReinforcement: string | null;
  forceMonochrome: boolean;
}

export function getStylePromptOverride(styleId: string): StylePromptOverride {
  const cap = getStyleCapability(styleId);
  const overrides: StylePromptOverride = {
    additionalNegatives: [],
    promptReinforcement: null,
    forceMonochrome: false,
  };

  // 모노크롬 계열 강화
  if (["ink-drawing-anime", "ink-wash", "inkwash-painting"].includes(styleId)) {
    overrides.forceMonochrome = true;
    overrides.additionalNegatives.push(
      "full color", "vibrant colors", "colorful", "saturated palette",
      "rainbow", "multi-colored"
    );
    overrides.promptReinforcement = "CRITICAL: Maintain monochrome/ink-only palette throughout entire sequence. No color allowed.";
  }

  // 동양화 계열 — 정적 렌더링 방지
  if (["east-asian-painting", "ink-wash"].includes(styleId)) {
    overrides.additionalNegatives.push(
      "static painting", "scroll painting", "art plate display",
      "storybook page", "motion poster", "barely moving still image",
      "calligraphy", "Chinese characters", "Korean characters",
      "Japanese characters", "typographic marks", "readable symbols"
    );
    overrides.promptReinforcement = (overrides.promptReinforcement ?? "") +
      " This MUST be an animated sequence with clear motion and progression, NOT a static artwork.";
  }

  // 로우폴리 — 디테일 추가 방지
  if (styleId === "low-poly-3d") {
    overrides.additionalNegatives.push(
      "high-poly detail", "detailed texture", "organic smooth shapes",
      "realistic rendering", "subsurface scattering"
    );
    overrides.promptReinforcement = "Maintain low-polygon faceted geometry throughout. No smooth surfaces.";
  }

  // negative 강화 필요 스타일
  if (cap.requirements.needsNegativeReinforcement && overrides.additionalNegatives.length === 0) {
    overrides.promptReinforcement = `Maintain ${styleId} style consistently throughout every frame.`;
  }

  return overrides;
}

// ═══════════════════════════════════════════════════════════════════
// Validation — catalog에 있지만 matrix에 없는 스타일 감지
// ═══════════════════════════════════════════════════════════════════

/** 카탈로그에 있지만 capability matrix에 미등록된 스타일 감지 */
export function getUnmappedStyles(): string[] {
  const catalogIds = new Set(getAllStyles().map(s => s.id));
  const matrixIds = new Set(Object.keys(STYLE_CAPABILITY_MAP));
  return [...catalogIds].filter(id => !matrixIds.has(id));
}
