/**
 * style-capability-matrix.ts — 스타일별 구현 가능성·지원 수준 중앙 정책
 *
 * 핵심 철학:
 *   "unsupported"는 영구 상태가 아니다.
 *   모든 스타일은 반드시 제품 안에 흡수된다.
 *   즉시 고품질이 아니더라도, 경로가 반드시 존재해야 한다.
 *
 * 8단계 지원 체계:
 *   1. full-supported          → 프롬프트만으로 안정적 고품질
 *   2. supported-with-warning  → 지원되지만 품질 불안정 구간 있음
 *   3. beta-supported          → 실험적 지원, 품질 보장 안 함
 *   4. reference-required      → reference image 제공 시 지원 가능
 *   5. postprocess-required    → 후처리 파이프라인 추가 시 지원 가능
 *   6. pipeline-upgrade-required → 새 생성 파이프라인 도입 시 지원 가능
 *   7. gated                   → 특정 조건 충족 시에만 활성화
 *   8. temporarily-hidden      → 현재 숨겨져 있지만 개발 로드맵에 포함
 *
 * 사용처:
 *   - InputPanel: 스타일 선택 UI에서 뱃지·경고·gated 처리
 *   - prompt-architecture: buildNegativePrompt()에서 자동 negative 주입
 *   - style-system: assemblePrompt()에서 prompt override 적용
 *   - generate-video: generation-time validation + fallback resolution
 *   - montage-export: 후처리 필요 스타일 표시
 *
 * grep: StyleCapability, StyleSupportTier, getStyleCapability,
 *       STYLE_CAPABILITY_MAP, getStyleUiState, getStylePromptOverride,
 *       resolveGenerationStyle, getStyleFallbackChain
 */

import { getAllStyles } from "@/data/style-catalog";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/**
 * 8단계 지원 등급.
 * "unsupported"는 존재하지 않는다 — 모든 스타일은 경로를 가진다.
 */
export type StyleSupportTier =
  | "full-supported"             // 프롬프트만으로 안정적 고품질
  | "supported-with-warning"     // 지원되지만 품질 불안정 구간 있음
  | "beta-supported"             // 실험적 지원, 품질 보장 안 함
  | "reference-required"         // reference image 제공 시 지원 가능
  | "postprocess-required"       // 후처리 파이프라인 추가 시 지원 가능
  | "pipeline-upgrade-required"  // 새 생성 파이프라인(compositing 등) 도입 시 지원
  | "gated"                      // 특정 조건(element 등록 등) 충족 시에만 활성화
  | "temporarily-hidden";        // 개발 로드맵에 포함, 현재 숨김

/**
 * 이 스타일을 "완전 지원"으로 끌어올리기 위해 필요한 것들.
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
  /** 모션 제한이 필요한가 (정적/미니멀 모션 스타일) */
  needsMotionConstraint: boolean;
  /** compositing/multi-layer 파이프라인이 필요한가 */
  needsCompositingPipeline: boolean;
  /** 해상도 후처리가 필요한가 (pixel-art downscale 등) */
  needsResolutionPostProcess: boolean;
}

/**
 * 스타일을 목표 상태로 끌어올리기 위한 업그레이드 경로.
 */
export interface UpgradePath {
  /** 현재 상태에서 다음 단계로 가기 위해 필요한 것 (한국어) */
  nextStepKo: string;
  /** 최종 목표 tier */
  targetTier: StyleSupportTier;
  /** 필요한 기술 조건 목록 */
  technicalRequirements: string[];
  /** 예상 난이도: low / medium / high / very-high */
  difficulty: "low" | "medium" | "high" | "very-high";
}

/**
 * 스타일별 구현 가능성 매트릭스 엔트리.
 */
export interface StyleCapability {
  /** 스타일 ID (style-catalog.ts의 StyleEntry.id) */
  styleId: string;
  /** 기술적 지원 등급 */
  tier: StyleSupportTier;
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
  /** 품질 미달 시 사용할 대체 스타일 ID */
  fallbackStyleId: string | null;
  /** 기술적 제약 사유 (내부 참고용) */
  technicalNote: string;
  /** 업그레이드 경로 — 현재 tier에서 full-supported로 가는 방법 */
  upgradePath: UpgradePath | null;
  /** 현재 적용 중인 보정 전략 목록 */
  activeStrategies: ActiveStrategy[];
}

/**
 * 현재 적용 중인 보정 전략.
 * 코드에서 실제로 분기하는 데 사용됨.
 */
export type ActiveStrategy =
  | "prompt-only"                // 프롬프트만으로 처리
  | "negative-reinforcement"     // 추가 negative 주입
  | "monochrome-lock"            // 흑백 강제
  | "anti-static-injection"      // 정적 렌더링 방지
  | "anti-detail-injection"      // 디테일 추가 방지 (로우폴리 등)
  | "anti-text-injection"        // 문자 삽입 방지
  | "motion-constraint"          // 모션 제한
  | "custom-element-gate"        // Custom Element 필수
  | "reference-image-gate"       // reference image 필수
  | "fallback-to-similar"        // 유사 스타일로 fallback
  | "texture-approximation"      // 소재 텍스처만 근사
  | "style-approximation"        // 스타일 근사 (정확 재현 아님)
  | "resolution-downscale"       // 해상도 후처리 대기
  | "compositing-pending";       // compositing 파이프라인 대기

// ═══════════════════════════════════════════════════════════════════
// Default Requirements
// ═══════════════════════════════════════════════════════════════════

const BASE_REQ: StyleRequirements = {
  needsCustomElement: false,
  needsReferenceImage: false,
  needsPostProcessing: false,
  requiresImageToVideo: false,
  requiresMultiShot: false,
  needsNegativeReinforcement: false,
  needsMotionConstraint: false,
  needsCompositingPipeline: false,
  needsResolutionPostProcess: false,
};

const req = (overrides: Partial<StyleRequirements>): StyleRequirements => ({
  ...BASE_REQ,
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════════
// Style Capability Map — 모든 스타일을 흡수
// ═══════════════════════════════════════════════════════════════════

export const STYLE_CAPABILITY_MAP: Record<string, StyleCapability> = {

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 실사 (Live Action)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  "cinematic-realism": {
    styleId: "cinematic-realism",
    tier: "full-supported",
    stabilityScore: 5,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "VEO 주력 도메인. photorealistic은 가장 안정적.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "docu-handheld": {
    styleId: "docu-handheld",
    tier: "supported-with-warning",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: req({}),
    promptOnly: true,
    warningKo: "카메라 흔들림이 불안정할 수 있습니다. 다큐멘터리 '톤' 중심으로 적용됩니다.",
    fallbackStyleId: "cinematic-realism",
    technicalNote: "handheld shake 시뮬레이션 품질 불안정. 조명·색감 위주로 차별화.",
    upgradePath: {
      nextStepKo: "카메라 흔들림 후처리 오버레이 추가",
      targetTier: "full-supported",
      technicalRequirements: ["FFmpeg shake overlay", "client-side post-process pipeline"],
      difficulty: "medium",
    },
    activeStrategies: ["prompt-only"],
  },
  "commercial-ad": {
    styleId: "commercial-ad",
    tier: "full-supported",
    stabilityScore: 4,
    expectationGap: 2,
    requirements: req({}),
    promptOnly: true,
    warningKo: "특정 제품 형태는 reference image 업로드를 권장합니다.",
    fallbackStyleId: "cinematic-realism",
    technicalNote: "studio lighting, clean composition은 잘 됨. 제품 형태는 reference image 필요.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "vintage-film": {
    styleId: "vintage-film",
    tier: "full-supported",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "film grain, faded colors, light leaks — 모델이 잘 반영하는 영역.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "neon-noir": {
    styleId: "neon-noir",
    tier: "full-supported",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "네온 컬러 + 어두운 분위기는 모델이 좋아하는 영역.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "vhs-retro": {
    styleId: "vhs-retro",
    tier: "supported-with-warning",
    stabilityScore: 3,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "VHS 아티팩트가 불완전할 수 있습니다. 레트로 감성 수준으로 적용됩니다.",
    fallbackStyleId: "vintage-film",
    technicalNote: "스캔라인·트래킹 노이즈 재현 불완전. 후처리 추가 시 개선 가능.",
    upgradePath: {
      nextStepKo: "FFmpeg VHS 오버레이 후처리 추가 (scanline + noise)",
      targetTier: "full-supported",
      technicalRequirements: ["FFmpeg scanline overlay filter", "VHS noise texture generator"],
      difficulty: "medium",
    },
    activeStrategies: ["prompt-only", "negative-reinforcement"],
  },
  "sf-futuristic": {
    styleId: "sf-futuristic",
    tier: "full-supported",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "SF 도시 구조가 반복되는 경향. scene prompt에서 location cue 강화 필요.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "gothic-horror": {
    styleId: "gothic-horror",
    tier: "full-supported",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: "과도한 공포 표현은 안전 필터에 의해 제한될 수 있습니다.",
    fallbackStyleId: "cinematic-realism",
    technicalNote: "dark atmosphere는 잘 만들지만 safety filter 주의.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2D 애니메이션
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  "tv-anime": {
    styleId: "tv-anime",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 4,
    requirements: req({ needsCustomElement: true, needsNegativeReinforcement: true }),
    promptOnly: false,
    warningKo: "셀 애니메이션 품질에 차이가 있을 수 있습니다. 캐릭터 등록 시 품질이 향상됩니다.",
    fallbackStyleId: "theatrical-anime",
    technicalNote: "cel-shading 일관성 유지 불가. Custom Element로 캐릭터 고정 시 개선.",
    upgradePath: {
      nextStepKo: "Custom Element 자동 등록 + cel-shading reinforcement 강화",
      targetTier: "supported-with-warning",
      technicalRequirements: ["auto-element creation workflow", "cel-shade anti-drift negatives"],
      difficulty: "medium",
    },
    activeStrategies: ["negative-reinforcement", "custom-element-gate"],
  },
  "theatrical-anime": {
    styleId: "theatrical-anime",
    tier: "supported-with-warning",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: req({ needsCustomElement: true }),
    promptOnly: false,
    warningKo: "캐릭터 일관성을 위해 캐릭터 등록을 권장합니다.",
    fallbackStyleId: "storybook-anime",
    technicalNote: "painted backgrounds + atmospheric depth가 diffusion에 친화적.",
    upgradePath: {
      nextStepKo: "Custom Element 자동 등록 워크플로우",
      targetTier: "full-supported",
      technicalRequirements: ["auto-element creation"],
      difficulty: "low",
    },
    activeStrategies: ["prompt-only", "custom-element-gate"],
  },
  "storybook-anime": {
    styleId: "storybook-anime",
    tier: "full-supported",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "soft pastel + round designs — diffusion 모델이 가장 잘하는 비실사 2D.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "painted-2d": {
    styleId: "painted-2d",
    tier: "full-supported",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "hand-painted look은 diffusion 모델 기본 성향과 잘 맞음.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "watercolor-animation": {
    styleId: "watercolor-animation",
    tier: "supported-with-warning",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "유화풍과 유사하게 나올 수 있습니다.",
    fallbackStyleId: "painted-2d",
    technicalNote: "painted-2d와 결과물 모호. 수채 특유의 투명 레이어 재현 불안정.",
    upgradePath: {
      nextStepKo: "수채화 전용 negative 세트 강화 (유화 억제)",
      targetTier: "full-supported",
      technicalRequirements: ["watercolor-specific negative tuning"],
      difficulty: "low",
    },
    activeStrategies: ["prompt-only", "negative-reinforcement"],
  },
  "ink-drawing-anime": {
    styleId: "ink-drawing-anime",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "모노크롬 유지가 불안정합니다. 부분적으로 컬러가 나타날 수 있습니다.",
    fallbackStyleId: "painted-2d",
    technicalNote: "흑백/모노크롬 강제가 모델 수준에서 어려움. 컬러 누출 빈번.",
    upgradePath: {
      nextStepKo: "후처리 desaturation 파이프라인 추가",
      targetTier: "supported-with-warning",
      technicalRequirements: ["FFmpeg desaturation filter", "client-side grayscale post-process"],
      difficulty: "low",
    },
    activeStrategies: ["monochrome-lock", "negative-reinforcement"],
  },
  "webtoon-motion": {
    styleId: "webtoon-motion",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsCustomElement: true, needsNegativeReinforcement: true }),
    promptOnly: false,
    warningKo: "일본 애니 스타일과 구분이 모호할 수 있습니다.",
    fallbackStyleId: "tv-anime",
    technicalNote: "웹툰 vs 일본애니 구분이 모델에서 매우 모호.",
    upgradePath: {
      nextStepKo: "manhwa 전용 프롬프트 + reference image 세트 구축",
      targetTier: "supported-with-warning",
      technicalRequirements: ["manhwa style reference library", "style-specific prompt tuning"],
      difficulty: "medium",
    },
    activeStrategies: ["negative-reinforcement", "custom-element-gate", "style-approximation"],
  },
  "cutout-anime": {
    styleId: "cutout-anime",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 4,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "종이 텍스처는 표현되지만, 관절 움직임은 일반 애니메이션으로 렌더링됩니다.",
    fallbackStyleId: "storybook-anime",
    technicalNote: "소재 텍스처만 유사, 움직임 특성(hinged joint)은 재현 불가.",
    upgradePath: {
      nextStepKo: "reference image로 종이 텍스처 고정 + 모션 제한",
      targetTier: "supported-with-warning",
      technicalRequirements: ["reference image pipeline", "motion constraint params"],
      difficulty: "medium",
    },
    activeStrategies: ["texture-approximation", "negative-reinforcement"],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3D 애니메이션
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  "pixar-style": {
    styleId: "pixar-style",
    tier: "full-supported",
    stabilityScore: 5,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "VEO가 가장 잘하는 비실사 스타일. 학습 데이터 풍부.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "dreamworks-style": {
    styleId: "dreamworks-style",
    tier: "supported-with-warning",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: req({}),
    promptOnly: true,
    warningKo: "픽사풍과 결과물이 유사할 수 있습니다.",
    fallbackStyleId: "pixar-style",
    technicalNote: "Pixar vs DreamWorks 구분이 모델에서 미묘.",
    upgradePath: {
      nextStepKo: "DreamWorks 전용 캐릭터 비율/포즈 reinforcement",
      targetTier: "full-supported",
      technicalRequirements: ["exaggerated proportions prompt tuning"],
      difficulty: "low",
    },
    activeStrategies: ["prompt-only", "style-approximation"],
  },
  "stylized-3d": {
    styleId: "stylized-3d",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "셀셰이딩 3D 효과가 불안정합니다. 픽사풍으로 수렴할 수 있습니다.",
    fallbackStyleId: "pixar-style",
    technicalNote: "toon shading over 3D geometry는 특수 렌더러 영역.",
    upgradePath: {
      nextStepKo: "reference image로 cel-shaded 3D 스타일 고정",
      targetTier: "supported-with-warning",
      technicalRequirements: ["reference image pipeline", "toon-shade reference library"],
      difficulty: "medium",
    },
    activeStrategies: ["negative-reinforcement", "style-approximation"],
  },
  "semi-real-3d": {
    styleId: "semi-real-3d",
    tier: "full-supported",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "스타일 간 보간은 diffusion 모델의 강점.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "low-poly-3d": {
    styleId: "low-poly-3d",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "저폴리곤 느낌이 유지되지 않을 수 있습니다. 모델이 디테일을 추가하는 경향이 있습니다.",
    fallbackStyleId: "pixar-style",
    technicalNote: "모델이 디테일 추가 경향 강함. 의도적 단순함 유지 어려움.",
    upgradePath: {
      nextStepKo: "reference image + negative 강화로 디테일 억제",
      targetTier: "supported-with-warning",
      technicalRequirements: ["low-poly reference library", "detail-suppression negatives"],
      difficulty: "medium",
    },
    activeStrategies: ["anti-detail-injection", "negative-reinforcement"],
  },
  "miniature-3d": {
    styleId: "miniature-3d",
    tier: "full-supported",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "tilt-shift + shallow DoF — 학습 데이터에 풍부.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "game-cinematic-3d": {
    styleId: "game-cinematic-3d",
    tier: "supported-with-warning",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: req({}),
    promptOnly: true,
    warningKo: "시네마틱 리얼리즘과 결과물이 유사할 수 있습니다.",
    fallbackStyleId: "cinematic-realism",
    technicalNote: "cinematic-realism + heroic lighting 변형.",
    upgradePath: {
      nextStepKo: "게임 시네마틱 전용 카메라 프리셋 + 라이팅 강화",
      targetTier: "full-supported",
      technicalRequirements: ["epic camera preset", "heroic lighting prompt tuning"],
      difficulty: "low",
    },
    activeStrategies: ["prompt-only", "style-approximation"],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 회화/일러스트
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  "watercolor": {
    styleId: "watercolor",
    tier: "full-supported",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "수채화 텍스처 자체는 안정.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "oil-painting": {
    styleId: "oil-painting",
    tier: "full-supported",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "impasto 질감은 diffusion 모델이 잘 만듦.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "gouache": {
    styleId: "gouache",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "수채화와 구분이 모호할 수 있습니다. 구아슈 특유의 불투명한 질감 중심으로 적용됩니다.",
    fallbackStyleId: "watercolor",
    technicalNote: "수채화와 모델 출력 구분 어려움. 불투명 매체 키워드 강화로 차별화 시도.",
    upgradePath: {
      nextStepKo: "구아슈 전용 reference image + 불투명 매체 negative 강화",
      targetTier: "supported-with-warning",
      technicalRequirements: ["gouache reference images", "opacity-specific prompt tuning"],
      difficulty: "low",
    },
    activeStrategies: ["negative-reinforcement", "style-approximation"],
  },
  "pastel": {
    styleId: "pastel",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "수채화와 유사하게 나올 수 있습니다. 파스텔 특유의 부드러운 입자감 중심으로 적용됩니다.",
    fallbackStyleId: "watercolor",
    technicalNote: "수채화와 모델 출력 구분 어려움. 파스텔 매체 키워드 강화.",
    upgradePath: {
      nextStepKo: "파스텔 전용 reference image + chalky texture 강화",
      targetTier: "supported-with-warning",
      technicalRequirements: ["pastel texture reference images", "chalky-texture prompt tuning"],
      difficulty: "low",
    },
    activeStrategies: ["negative-reinforcement", "style-approximation"],
  },
  "east-asian-painting": {
    styleId: "east-asian-painting",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 4,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "정적 그림으로 수렴하거나 문자가 삽입될 수 있습니다. 동양화풍 모션으로 적용됩니다.",
    fallbackStyleId: "painted-2d",
    technicalNote: "정적 렌더링 수렴 + 서예/글자 자동 삽입 위험.",
    upgradePath: {
      nextStepKo: "reference image로 화풍 고정 + 강력한 anti-static/anti-text injection",
      targetTier: "supported-with-warning",
      technicalRequirements: ["East Asian art reference library", "anti-calligraphy negatives", "motion-enforcement prompt"],
      difficulty: "high",
    },
    activeStrategies: ["anti-static-injection", "anti-text-injection", "negative-reinforcement"],
  },
  "ink-wash": {
    styleId: "ink-wash",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 4,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "모노크롬 유지와 동적 모션이 불안정합니다.",
    fallbackStyleId: "east-asian-painting",
    technicalNote: "east-asian-painting 리스크 + 모노크롬 유지 실패.",
    upgradePath: {
      nextStepKo: "desaturation 후처리 + anti-static injection 강화",
      targetTier: "supported-with-warning",
      technicalRequirements: ["FFmpeg desaturation", "motion-enforcement prompt"],
      difficulty: "medium",
    },
    activeStrategies: ["monochrome-lock", "anti-static-injection", "anti-text-injection", "negative-reinforcement"],
  },
  "inkwash-painting": {
    styleId: "inkwash-painting",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "수묵풍 스타일과 유사합니다. 모노크롬 유지가 불안정할 수 있습니다.",
    fallbackStyleId: "ink-wash",
    technicalNote: "ink-wash와 거의 동일한 처리.",
    upgradePath: {
      nextStepKo: "ink-wash 개선과 동일 경로",
      targetTier: "supported-with-warning",
      technicalRequirements: ["ink-wash upgrade path 공유"],
      difficulty: "medium",
    },
    activeStrategies: ["monochrome-lock", "negative-reinforcement", "style-approximation"],
  },
  "van-gogh-painted": {
    styleId: "van-gogh-painted",
    tier: "full-supported",
    stabilityScore: 5,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "모델이 가장 잘 아는 화풍. Starry Night 스타일은 최고 안정성.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
  "editorial-illustration": {
    styleId: "editorial-illustration",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "제한된 색상 팔레트 제어가 불안정합니다.",
    fallbackStyleId: "storybook-illustration",
    technicalNote: "limited palette 제어 어려움. 모델이 색을 추가하려 함.",
    upgradePath: {
      nextStepKo: "reference image로 팔레트 고정 + color-limiting negative",
      targetTier: "supported-with-warning",
      technicalRequirements: ["editorial style reference library", "palette-lock negatives"],
      difficulty: "medium",
    },
    activeStrategies: ["negative-reinforcement", "style-approximation"],
  },
  "storybook-illustration": {
    styleId: "storybook-illustration",
    tier: "full-supported",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "warm gentle palette은 안정적.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 스톱모션/공예
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  "claymation": {
    styleId: "claymation",
    tier: "supported-with-warning",
    stabilityScore: 3,
    expectationGap: 3,
    requirements: req({}),
    promptOnly: true,
    warningKo: "점토 질감은 잘 표현됩니다. 스톱모션 떨림 효과는 제한적입니다.",
    fallbackStyleId: "pixar-style",
    technicalNote: "clay texture OK, stop-motion jitter는 후처리로만 가능.",
    upgradePath: {
      nextStepKo: "FFmpeg frame-drop jitter 후처리로 스톱모션 느낌 추가",
      targetTier: "full-supported",
      technicalRequirements: ["FFmpeg frame-drop filter", "jitter post-process"],
      difficulty: "medium",
    },
    activeStrategies: ["prompt-only", "texture-approximation"],
  },
  "paper-collage": {
    styleId: "paper-collage",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "종이 텍스처 느낌은 표현됩니다. 수공예 특유의 관절 움직임은 일반 애니메이션으로 렌더링됩니다.",
    fallbackStyleId: "cutout-anime",
    technicalNote: "소재 텍스처만 유사, 움직임 특성 재현 불가.",
    upgradePath: {
      nextStepKo: "reference image + 모션 제한으로 종이 공예감 강화",
      targetTier: "supported-with-warning",
      technicalRequirements: ["paper texture reference images", "motion constraint"],
      difficulty: "medium",
    },
    activeStrategies: ["texture-approximation", "negative-reinforcement"],
  },
  "felt-craft": {
    styleId: "felt-craft",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "펠트 텍스처 느낌은 표현됩니다. 수공예 움직임은 제한적입니다.",
    fallbackStyleId: "claymation",
    technicalNote: "소재 텍스처만 유사, 움직임 특성 재현 불가.",
    upgradePath: {
      nextStepKo: "felt texture reference image + 부드러운 모션 제한",
      targetTier: "supported-with-warning",
      technicalRequirements: ["felt texture references", "soft-motion constraint"],
      difficulty: "medium",
    },
    activeStrategies: ["texture-approximation", "negative-reinforcement"],
  },
  "wooden-puppet": {
    styleId: "wooden-puppet",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "나무 질감은 표현됩니다. 마리오네트 관절 움직임은 제한적입니다.",
    fallbackStyleId: "claymation",
    technicalNote: "소재 텍스처만 유사, 관절 움직임 재현 불가.",
    upgradePath: {
      nextStepKo: "wooden puppet reference image + 관절 제한 모션",
      targetTier: "supported-with-warning",
      technicalRequirements: ["puppet texture references", "joint-motion constraint"],
      difficulty: "medium",
    },
    activeStrategies: ["texture-approximation", "negative-reinforcement"],
  },
  "paper-puppet": {
    styleId: "paper-puppet",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "그림자극 분위기는 표현됩니다. 종이 인형 관절 움직임은 제한적입니다.",
    fallbackStyleId: "cutout-anime",
    technicalNote: "silhouette/backlit은 가능하지만 articulated paper joint 불가.",
    upgradePath: {
      nextStepKo: "backlit silhouette reference + motion constraint",
      targetTier: "supported-with-warning",
      technicalRequirements: ["shadow puppet reference images", "backlit-only lighting lock"],
      difficulty: "medium",
    },
    activeStrategies: ["texture-approximation", "negative-reinforcement"],
  },
  "miniature-diorama": {
    styleId: "miniature-diorama",
    tier: "supported-with-warning",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: req({}),
    promptOnly: true,
    warningKo: "미니어처 3D 스타일과 유사한 결과물이 나올 수 있습니다.",
    fallbackStyleId: "miniature-3d",
    technicalNote: "miniature-3d와 실질적으로 동일.",
    upgradePath: {
      nextStepKo: "miniature-3d와 차별화 (실물 소재 질감 강조)",
      targetTier: "full-supported",
      technicalRequirements: ["real-material texture prompt tuning"],
      difficulty: "low",
    },
    activeStrategies: ["prompt-only"],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 레트로/게임풍 — 기존 "unsupported" → 경로 부여
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  "pixel-art": {
    styleId: "pixel-art",
    tier: "postprocess-required",
    stabilityScore: 2,
    expectationGap: 4,
    requirements: req({ needsPostProcessing: true, needsResolutionPostProcess: true, needsNegativeReinforcement: true }),
    promptOnly: false,
    warningKo: "픽셀아트 감성으로 생성 후, 향후 후처리로 픽셀 정밀도가 개선됩니다. 현재는 '픽셀풍' 수준입니다.",
    fallbackStyleId: "storybook-anime",
    technicalNote: "pixel-perfect는 diffusion 구조적 한계. 현재: 프롬프트로 근사 생성 → 추후 downscale+nearest-neighbor upscale 후처리 추가.",
    upgradePath: {
      nextStepKo: "client-side FFmpeg downscale → nearest-neighbor upscale 파이프라인",
      targetTier: "supported-with-warning",
      technicalRequirements: ["FFmpeg resolution downscale filter", "nearest-neighbor upscale", "pixel-grid overlay"],
      difficulty: "medium",
    },
    activeStrategies: ["style-approximation", "negative-reinforcement", "resolution-downscale"],
  },
  "16bit-jrpg": {
    styleId: "16bit-jrpg",
    tier: "postprocess-required",
    stabilityScore: 2,
    expectationGap: 4,
    requirements: req({ needsPostProcessing: true, needsResolutionPostProcess: true, needsNegativeReinforcement: true }),
    promptOnly: false,
    warningKo: "16비트 RPG 감성으로 생성됩니다. 후처리 파이프라인 추가 시 픽셀 정밀도가 개선됩니다.",
    fallbackStyleId: "pixel-art",
    technicalNote: "pixel-art와 동일 경로. JRPG 특유의 캐릭터 비율+배경 스타일은 프롬프트로 유도.",
    upgradePath: {
      nextStepKo: "pixel-art 후처리 경로 공유 + JRPG 캐릭터 비율 프롬프트 튜닝",
      targetTier: "supported-with-warning",
      technicalRequirements: ["pixel-art post-process pipeline (공유)", "JRPG character proportion prompt"],
      difficulty: "medium",
    },
    activeStrategies: ["style-approximation", "negative-reinforcement", "resolution-downscale"],
  },
  "8bit-arcade": {
    styleId: "8bit-arcade",
    tier: "postprocess-required",
    stabilityScore: 2,
    expectationGap: 4,
    requirements: req({ needsPostProcessing: true, needsResolutionPostProcess: true, needsNegativeReinforcement: true }),
    promptOnly: false,
    warningKo: "8비트 아케이드 감성으로 생성됩니다. 후처리 추가 시 레트로 정밀도가 개선됩니다.",
    fallbackStyleId: "pixel-art",
    technicalNote: "pixel-art와 동일 경로. 더 제한된 색상 팔레트 + 단순한 형태.",
    upgradePath: {
      nextStepKo: "pixel-art 후처리 + 4색/8색 팔레트 제한 후처리",
      targetTier: "supported-with-warning",
      technicalRequirements: ["pixel-art post-process (공유)", "color palette reduction filter"],
      difficulty: "medium",
    },
    activeStrategies: ["style-approximation", "negative-reinforcement", "resolution-downscale"],
  },
  "ps1-lowpoly": {
    styleId: "ps1-lowpoly",
    tier: "postprocess-required",
    stabilityScore: 2,
    expectationGap: 4,
    requirements: req({ needsPostProcessing: true, needsNegativeReinforcement: true }),
    promptOnly: false,
    warningKo: "PS1 로우폴리 감성으로 생성됩니다. affine distortion 등은 후처리로 추가 예정입니다.",
    fallbackStyleId: "low-poly-3d",
    technicalNote: "low-poly-3d로 근사 생성 → 추후 vertex-jitter + affine distortion 후처리.",
    upgradePath: {
      nextStepKo: "low-poly 근사 + vertex jitter + resolution reduction 후처리",
      targetTier: "supported-with-warning",
      technicalRequirements: ["FFmpeg resolution reduction", "vertex-jitter shader/filter", "affine distortion emulation"],
      difficulty: "high",
    },
    activeStrategies: ["fallback-to-similar", "anti-detail-injection", "negative-reinforcement"],
  },
  "90s-game-cutscene": {
    styleId: "90s-game-cutscene",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "90년대 CG 느낌이 불안정하게 표현됩니다. early CG 특유의 질감 중심으로 적용됩니다.",
    fallbackStyleId: "game-cinematic-3d",
    technicalNote: "early CG look은 프롬프트로 부분 유도 가능.",
    upgradePath: {
      nextStepKo: "90s CG reference image + 해상도 제한 후처리",
      targetTier: "supported-with-warning",
      technicalRequirements: ["90s CG reference library", "resolution reduction post-process"],
      difficulty: "medium",
    },
    activeStrategies: ["negative-reinforcement", "style-approximation"],
  },
  "visual-novel": {
    styleId: "visual-novel",
    tier: "gated",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsMotionConstraint: true, needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "거의 정적인 캐릭터 제어가 어렵습니다. '최소 모션 모드'로 적용됩니다.",
    fallbackStyleId: "tv-anime",
    technicalNote: "subtle motion 제어 불가. 모델은 항상 움직임을 추가하려 함. duration 3초 고정 + static camera로 제한 시 개선.",
    upgradePath: {
      nextStepKo: "duration 3초 고정 + static camera 강제 + image-to-video로 첫프레임 고정",
      targetTier: "supported-with-warning",
      technicalRequirements: ["duration constraint (3s)", "static camera lock", "first-frame image-to-video"],
      difficulty: "medium",
    },
    activeStrategies: ["motion-constraint", "negative-reinforcement"],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 실험/하이브리드 — 기존 "unsupported" → 경로 부여
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  "rotoscoping": {
    styleId: "rotoscoping",
    tier: "beta-supported",
    stabilityScore: 2,
    expectationGap: 3,
    requirements: req({ needsNegativeReinforcement: true }),
    promptOnly: true,
    warningKo: "실사와 회화가 혼합된 분위기로 적용됩니다. 정확한 로토스코핑이 아닌 '로토스코핑풍'입니다.",
    fallbackStyleId: "painted-2d",
    technicalNote: "dual-layer 공존 어려움. semi-realistic painted로 근사.",
    upgradePath: {
      nextStepKo: "video-edit 모델로 실사 → 회화 변환 파이프라인",
      targetTier: "supported-with-warning",
      technicalRequirements: ["veo-video-edit style transfer", "two-pass generation (realistic → painted overlay)"],
      difficulty: "high",
    },
    activeStrategies: ["style-approximation", "negative-reinforcement"],
  },
  "mixed-media-collage": {
    styleId: "mixed-media-collage",
    tier: "pipeline-upgrade-required",
    stabilityScore: 1,
    expectationGap: 4,
    requirements: req({ needsCompositingPipeline: true, needsPostProcessing: true }),
    promptOnly: false,
    warningKo: "콜라주 감성으로 생성됩니다. 정확한 매체 혼합은 합성 파이프라인 도입 후 개선됩니다.",
    fallbackStyleId: "painted-2d",
    technicalNote: "현재: painted-2d로 근사 (다양한 텍스처 키워드 혼합). 목표: multi-pass compositing.",
    upgradePath: {
      nextStepKo: "multi-pass compositing: base layer(실사) → overlay layer(일러스트) → merge",
      targetTier: "supported-with-warning",
      technicalRequirements: ["multi-pass generation pipeline", "FFmpeg alpha compositing", "layer-aware prompt splitting"],
      difficulty: "very-high",
    },
    activeStrategies: ["fallback-to-similar", "style-approximation", "compositing-pending"],
  },
  "live-paint-overlay": {
    styleId: "live-paint-overlay",
    tier: "pipeline-upgrade-required",
    stabilityScore: 1,
    expectationGap: 4,
    requirements: req({ needsCompositingPipeline: true, needsPostProcessing: true }),
    promptOnly: false,
    warningKo: "실사 + 페인트 감성으로 생성됩니다. 정확한 오버레이는 합성 파이프라인 도입 후 개선됩니다.",
    fallbackStyleId: "rotoscoping",
    technicalNote: "현재: rotoscoping 근사. 목표: video-edit로 실사 → paint overlay.",
    upgradePath: {
      nextStepKo: "text-to-video(실사) → video-edit(paint overlay) 2-pass 파이프라인",
      targetTier: "supported-with-warning",
      technicalRequirements: ["veo-video-edit pipeline", "paint-overlay prompt", "two-pass orchestration"],
      difficulty: "very-high",
    },
    activeStrategies: ["fallback-to-similar", "style-approximation", "compositing-pending"],
  },
  "docu-illustrated": {
    styleId: "docu-illustrated",
    tier: "pipeline-upgrade-required",
    stabilityScore: 1,
    expectationGap: 4,
    requirements: req({ needsCompositingPipeline: true, needsPostProcessing: true }),
    promptOnly: false,
    warningKo: "다큐멘터리 + 일러스트 감성으로 생성됩니다. 정확한 오버레이는 합성 파이프라인 도입 후 개선됩니다.",
    fallbackStyleId: "docu-handheld",
    technicalNote: "현재: docu-handheld로 근사. 목표: base(docu) → overlay(illustration) compositing.",
    upgradePath: {
      nextStepKo: "text-to-video(다큐) + text-to-video(인포그래픽) → FFmpeg alpha compositing",
      targetTier: "supported-with-warning",
      technicalRequirements: ["dual generation pipeline", "FFmpeg alpha compositing", "infographic overlay generation"],
      difficulty: "very-high",
    },
    activeStrategies: ["fallback-to-similar", "compositing-pending"],
  },
  "2d-3d-hybrid": {
    styleId: "2d-3d-hybrid",
    tier: "pipeline-upgrade-required",
    stabilityScore: 1,
    expectationGap: 4,
    requirements: req({ needsCompositingPipeline: true, needsPostProcessing: true }),
    promptOnly: false,
    warningKo: "2D+3D 혼합 감성으로 생성됩니다. 정확한 렌더 분리는 합성 파이프라인 도입 후 개선됩니다.",
    fallbackStyleId: "semi-real-3d",
    technicalNote: "현재: semi-real-3d로 근사 (자연스러운 2D/3D 중간지대). 목표: layer-separated rendering.",
    upgradePath: {
      nextStepKo: "2D 캐릭터 생성 + 3D 배경 생성 → compositing merge",
      targetTier: "supported-with-warning",
      technicalRequirements: ["dual-pass generation", "character extraction", "background-character compositing"],
      difficulty: "very-high",
    },
    activeStrategies: ["fallback-to-similar", "style-approximation", "compositing-pending"],
  },
  "surreal-composite": {
    styleId: "surreal-composite",
    tier: "full-supported",
    stabilityScore: 4,
    expectationGap: 1,
    requirements: req({}),
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: null,
    technicalNote: "diffusion 모델의 hallucination이 오히려 장점. 초현실 표현에 최적.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  },
};

// ═══════════════════════════════════════════════════════════════════
// Core Utility Functions
// ═══════════════════════════════════════════════════════════════════

/** 스타일 ID로 capability 조회. 미등록 스타일은 beta-supported로 처리 */
export function getStyleCapability(styleId: string): StyleCapability {
  return STYLE_CAPABILITY_MAP[styleId] ?? {
    styleId,
    tier: "beta-supported",
    stabilityScore: 3,
    expectationGap: 2,
    requirements: BASE_REQ,
    promptOnly: true,
    warningKo: null,
    fallbackStyleId: "cinematic-realism",
    technicalNote: "capability matrix 미등록 — beta로 처리.",
    upgradePath: null,
    activeStrategies: ["prompt-only"],
  };
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

// ═══════════════════════════════════════════════════════════════════
// UI State — InputPanel에서 사용
// ═══════════════════════════════════════════════════════════════════

/**
 * UI용 스타일 상태 분류.
 * - "enabled"     → 정상 선택 가능
 * - "warning"     → 선택 가능하되 경고 툴팁
 * - "beta"        → 베타 뱃지 + 경고
 * - "gated"       → 잠금 아이콘 + 조건 안내
 * - "coming-soon" → 비활성 + "출시 예정" 뱃지
 * - "labs"        → 실험실 뱃지 + 근사 생성 안내
 */
export type StyleUiState = "enabled" | "warning" | "beta" | "gated" | "coming-soon" | "labs";

export function getStyleUiState(styleId: string): StyleUiState {
  const cap = getStyleCapability(styleId);

  switch (cap.tier) {
    case "full-supported":
      return cap.warningKo ? "warning" : "enabled";
    case "supported-with-warning":
      return "warning";
    case "beta-supported":
      return "beta";
    case "reference-required":
    case "gated":
      return "gated";
    case "postprocess-required":
      return "labs";
    case "pipeline-upgrade-required":
      return "labs";
    case "temporarily-hidden":
      return "coming-soon";
  }
}

/** UI 뱃지 텍스트 */
export function getStyleBadgeText(styleId: string): string | null {
  const state = getStyleUiState(styleId);
  switch (state) {
    case "enabled": return null;
    case "warning": return null;
    case "beta": return "BETA";
    case "gated": return "조건부";
    case "coming-soon": return "출시 예정";
    case "labs": return "LABS";
  }
}

/** UI 뱃지 색상 */
export function getStyleBadgeColor(styleId: string): { bg: string; text: string } | null {
  const state = getStyleUiState(styleId);
  switch (state) {
    case "enabled": return null;
    case "warning": return null;
    case "beta": return { bg: "#FEF3C7", text: "#92400E" };
    case "gated": return { bg: "#DBEAFE", text: "#1E40AF" };
    case "coming-soon": return { bg: "#F3F4F6", text: "#6B7280" };
    case "labs": return { bg: "#EDE9FE", text: "#5B21B6" };
  }
}

/** 스타일이 선택 가능한지 (gated/labs/coming-soon도 선택 가능 — 경고와 함께) */
export function isStyleSelectable(styleId: string): boolean {
  const state = getStyleUiState(styleId);
  // 모든 스타일은 선택 가능. coming-soon만 비활성.
  return state !== "coming-soon";
}

// ═══════════════════════════════════════════════════════════════════
// Prompt Override — prompt-architecture / style-system에서 사용
// ═══════════════════════════════════════════════════════════════════

export interface StylePromptOverride {
  /** 추가 negative prompt 목록 */
  additionalNegatives: string[];
  /** 스타일 드리프트 방지 강화 텍스트 (프롬프트 끝에 삽입) */
  promptReinforcement: string | null;
  /** 흑백 강제 여부 */
  forceMonochrome: boolean;
  /** 모션 제한 키워드 (static camera, minimal motion 등) */
  motionConstraint: string | null;
  /** fallback 적용 시 사용할 대체 스타일 ID (원본과 다르면 fallback 발동) */
  resolvedStyleId: string;
}

export function getStylePromptOverride(styleId: string): StylePromptOverride {
  const cap = getStyleCapability(styleId);
  const overrides: StylePromptOverride = {
    additionalNegatives: [],
    promptReinforcement: null,
    forceMonochrome: false,
    motionConstraint: null,
    resolvedStyleId: styleId,
  };

  // ── 전략별 자동 적용 ──────────────────────────────────

  for (const strategy of cap.activeStrategies) {
    switch (strategy) {
      case "monochrome-lock":
        overrides.forceMonochrome = true;
        overrides.additionalNegatives.push(
          "full color", "vibrant colors", "colorful", "saturated palette",
          "rainbow", "multi-colored"
        );
        overrides.promptReinforcement = _append(overrides.promptReinforcement,
          "CRITICAL: Maintain monochrome/ink-only palette throughout entire sequence. No color allowed.");
        break;

      case "anti-static-injection":
        overrides.additionalNegatives.push(
          "static painting", "scroll painting", "art plate display",
          "storybook page", "motion poster", "barely moving still image"
        );
        overrides.promptReinforcement = _append(overrides.promptReinforcement,
          "This MUST be an animated sequence with clear motion and progression, NOT a static artwork.");
        break;

      case "anti-text-injection":
        overrides.additionalNegatives.push(
          "calligraphy", "Chinese characters", "Korean characters",
          "Japanese characters", "typographic marks", "readable symbols",
          "handwritten text", "seal stamp"
        );
        break;

      case "anti-detail-injection":
        overrides.additionalNegatives.push(
          "high-poly detail", "detailed texture", "organic smooth shapes",
          "realistic rendering", "subsurface scattering"
        );
        overrides.promptReinforcement = _append(overrides.promptReinforcement,
          "Maintain low-detail, simplified geometry throughout. No smooth or organic surfaces.");
        break;

      case "motion-constraint":
        overrides.motionConstraint = "minimal motion, near-static, only subtle eye blinks and hair sway";
        overrides.additionalNegatives.push(
          "fast motion", "dynamic action", "walking", "running",
          "dramatic camera movement"
        );
        break;

      case "fallback-to-similar":
        // pipeline-upgrade-required 등에서 fallback 스타일로 전환
        if (cap.fallbackStyleId) {
          overrides.resolvedStyleId = cap.fallbackStyleId;
          overrides.promptReinforcement = _append(overrides.promptReinforcement,
            `Style approximation: generating with ${cap.fallbackStyleId} aesthetic as base.`);
        }
        break;

      case "texture-approximation":
        overrides.promptReinforcement = _append(overrides.promptReinforcement,
          `Emphasize ${styleId.replace(/-/g, " ")} material texture and surface quality.`);
        break;

      case "style-approximation":
        // 근사 스타일임을 프롬프트에 명시하지 않음 (사용자 경험 저해)
        break;

      case "resolution-downscale":
        // 후처리 파이프라인 준비 — 프롬프트 레벨에서는 pixel/retro 키워드 강화
        overrides.promptReinforcement = _append(overrides.promptReinforcement,
          "Crisp pixel-like rendering with limited color palette and blocky shapes.");
        overrides.additionalNegatives.push(
          "smooth gradients", "anti-aliasing", "realistic rendering",
          "detailed texture", "photorealistic"
        );
        break;

      case "compositing-pending":
        // 합성 파이프라인 대기 — fallback 스타일의 프롬프트로 생성
        if (cap.fallbackStyleId) {
          overrides.resolvedStyleId = cap.fallbackStyleId;
        }
        break;

      // prompt-only, negative-reinforcement, custom-element-gate,
      // reference-image-gate — 특별한 프롬프트 변형 없음
    }
  }

  // ── negative reinforcement 일반 적용 ──
  if (cap.requirements.needsNegativeReinforcement && overrides.additionalNegatives.length === 0) {
    overrides.promptReinforcement = _append(overrides.promptReinforcement,
      `Maintain ${styleId.replace(/-/g, " ")} style consistently throughout every frame.`);
  }

  return overrides;
}

function _append(existing: string | null, addition: string): string {
  return existing ? `${existing} ${addition}` : addition;
}

// ═══════════════════════════════════════════════════════════════════
// Generation-Time Resolution — generate-video에서 사용
// ═══════════════════════════════════════════════════════════════════

export interface GenerationStyleResolution {
  /** 최종 사용할 스타일 ID (fallback 적용 후) */
  resolvedStyleId: string;
  /** 원본 스타일과 달라졌는가 */
  wasFalledBack: boolean;
  /** 생성 가능한가 (true = 진행, false = 차단) */
  canGenerate: boolean;
  /** 생성 전 사용자에게 보여줄 안내 (null이면 없음) */
  preGenerationNoticeKo: string | null;
  /** 프롬프트에 적용할 override */
  promptOverride: StylePromptOverride;
  /** generation 파라미터 제약 */
  generationConstraints: {
    maxDuration: number | null;       // 최대 duration 제한 (초)
    forcedCameraPreset: string | null; // 카메라 프리셋 강제
    forceSound: boolean | null;        // 사운드 강제 on/off
  };
}

/**
 * 생성 시점에서 스타일을 최종 해석.
 * fallback 적용, 프롬프트 override 계산, 생성 제약 부과.
 */
export function resolveGenerationStyle(styleId: string): GenerationStyleResolution {
  const cap = getStyleCapability(styleId);
  const override = getStylePromptOverride(styleId);

  const resolved: GenerationStyleResolution = {
    resolvedStyleId: override.resolvedStyleId,
    wasFalledBack: override.resolvedStyleId !== styleId,
    canGenerate: true,
    preGenerationNoticeKo: null,
    promptOverride: override,
    generationConstraints: {
      maxDuration: null,
      forcedCameraPreset: null,
      forceSound: null,
    },
  };

  // temporarily-hidden은 생성 차단
  if (cap.tier === "temporarily-hidden") {
    resolved.canGenerate = false;
    resolved.preGenerationNoticeKo = "이 스타일은 현재 준비 중입니다. 다른 스타일을 선택해주세요.";
    return resolved;
  }

  // pipeline-upgrade-required → 근사 생성 + 안내
  if (cap.tier === "pipeline-upgrade-required") {
    resolved.preGenerationNoticeKo =
      `'${styleId.replace(/-/g, " ")}' 스타일은 현재 근사 모드로 생성됩니다. ` +
      `합성 파이프라인 도입 후 정확도가 개선됩니다.`;
  }

  // postprocess-required → 근사 생성 + 안내
  if (cap.tier === "postprocess-required") {
    resolved.preGenerationNoticeKo =
      `'${styleId.replace(/-/g, " ")}' 스타일은 현재 근사 모드로 생성됩니다. ` +
      `후처리 파이프라인 추가 시 정밀도가 개선됩니다.`;
  }

  // gated (visual-novel 등) → 모션 제한 + duration 제한
  if (cap.tier === "gated") {
    if (cap.requirements.needsMotionConstraint) {
      resolved.generationConstraints.maxDuration = 5;
      resolved.generationConstraints.forcedCameraPreset = "static-wide";
    }
  }

  return resolved;
}

// ═══════════════════════════════════════════════════════════════════
// Validation — catalog 동기화 체크
// ═══════════════════════════════════════════════════════════════════

/** 카탈로그에 있지만 capability matrix에 미등록된 스타일 감지 */
export function getUnmappedStyles(): string[] {
  const catalogIds = new Set(getAllStyles().map(s => s.id));
  const matrixIds = new Set(Object.keys(STYLE_CAPABILITY_MAP));
  return [...catalogIds].filter(id => !matrixIds.has(id));
}

/** 전체 스타일 tier 분포 통계 */
export function getTierDistribution(): Record<StyleSupportTier, number> {
  const dist: Record<string, number> = {};
  for (const cap of Object.values(STYLE_CAPABILITY_MAP)) {
    dist[cap.tier] = (dist[cap.tier] ?? 0) + 1;
  }
  return dist as Record<StyleSupportTier, number>;
}

/** 업그레이드 경로가 있는 스타일 목록 (로드맵용) */
export function getStylesWithUpgradePath(): Array<{ styleId: string; tier: StyleSupportTier; nextStepKo: string; difficulty: string }> {
  return Object.values(STYLE_CAPABILITY_MAP)
    .filter(c => c.upgradePath !== null)
    .map(c => ({
      styleId: c.styleId,
      tier: c.tier,
      nextStepKo: c.upgradePath!.nextStepKo,
      difficulty: c.upgradePath!.difficulty,
    }));
}

// ═══════════════════════════════════════════════════════════════════
// Recommended Styles & Tier Sort — UI 정렬/추천에 사용
// ═══════════════════════════════════════════════════════════════════

/**
 * 추천 스타일 목록.
 * 기준: full-supported + stabilityScore ≥ 4 + 카테고리 분산.
 * source of truth(STYLE_CAPABILITY_MAP)에서 계산.
 */
export function getRecommendedStyleIds(): string[] {
  const candidates = Object.values(STYLE_CAPABILITY_MAP)
    .filter(c => c.tier === "full-supported" && c.stabilityScore >= 4)
    .sort((a, b) => {
      // 안정성 높은 순 → 기대치 괴리 작은 순
      if (b.stabilityScore !== a.stabilityScore) return b.stabilityScore - a.stabilityScore;
      return a.expectationGap - b.expectationGap;
    })
    .map(c => c.styleId);

  // 카테고리 분산: 같은 카테고리에서 최대 2개
  const allStyles = getAllStyles();
  const catCount: Record<string, number> = {};
  const result: string[] = [];
  for (const id of candidates) {
    const entry = allStyles.find(s => s.id === id);
    const cat = entry?.categoryId ?? "unknown";
    if ((catCount[cat] ?? 0) < 2) {
      result.push(id);
      catCount[cat] = (catCount[cat] ?? 0) + 1;
    }
  }
  return result;
}

/** tier 정렬 우선순위 (낮을수록 먼저 표시) */
const TIER_SORT_ORDER: Record<StyleSupportTier, number> = {
  "full-supported": 0,
  "supported-with-warning": 1,
  "beta-supported": 2,
  "gated": 3,
  "reference-required": 4,
  "postprocess-required": 5,
  "pipeline-upgrade-required": 6,
  "temporarily-hidden": 7,
};

export function getTierSortOrder(tier: StyleSupportTier): number {
  return TIER_SORT_ORDER[tier] ?? 99;
}

/**
 * 카테고리 내 스타일을 tier + stabilityScore 기준으로 정렬.
 * full-supported가 앞, 실험적 스타일이 뒤.
 */
export function sortStylesByTier(styleIds: string[]): string[] {
  return [...styleIds].sort((a, b) => {
    const capA = getStyleCapability(a);
    const capB = getStyleCapability(b);
    const orderDiff = getTierSortOrder(capA.tier) - getTierSortOrder(capB.tier);
    if (orderDiff !== 0) return orderDiff;
    return capB.stabilityScore - capA.stabilityScore;
  });
}

/** tier별 사용자 안내 문구 (한국어, 짧고 정직) */
export function getTierDescriptionKo(styleId: string): string | null {
  const cap = getStyleCapability(styleId);
  switch (cap.tier) {
    case "full-supported":
      return null; // 기본 상태 — 별도 문구 불필요
    case "supported-with-warning":
      return "대체로 가능하지만 장면에 따라 품질 편차가 있을 수 있습니다.";
    case "beta-supported":
      return "실험적 지원입니다. 결과가 스타일에 따라 흔들릴 수 있습니다.";
    case "reference-required":
      return "레퍼런스 이미지가 필요합니다.";
    case "gated":
      return "특정 조건 충족 시 사용 가능합니다.";
    case "postprocess-required":
      return "현재는 근사 생성 방식입니다. 후처리 추가 시 개선됩니다.";
    case "pipeline-upgrade-required":
      return "현재는 유사 스타일로 대체 생성됩니다.";
    case "temporarily-hidden":
      return "준비 중인 스타일입니다.";
  }
}
