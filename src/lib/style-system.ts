/**
 * 전역 스타일 시스템 — 프로젝트 단위 비주얼 정체성 관리
 *
 * 설계 원칙:
 * 1. 스타일은 "단어"가 아니라 "시스템"으로 다룬다
 * 2. 프로젝트 전체에 하나의 스타일 정체성이 일관되게 적용된다
 * 3. 최종 프롬프트는 [PERSONA] > [STYLE] > [CONSISTENCY] > [CAMERA] > [SCENE] > [REINFORCEMENT] > [NEGATIVE] 우선순위로 조립된다
 * 4. 내부 메타 필드는 내부에만 유지하고, Veo에 보내는 프롬프트는 자연어 중심으로 변환한다
 * 5. 각 스타일은 전용 페르소나 + 렌더링 규칙 + anti-drift 체크리스트를 가진다
 */

// ──────────────────────────────────────────────────────────────────────────
// 1. 스타일 차원 정의 (Style Dimensions)
// ──────────────────────────────────────────────────────────────────────────

export type RealismLevel = "photorealistic" | "semi-realistic" | "stylized" | "fully-illustrated";

export interface StyleDimensions {
  realismLevel: RealismLevel;
  texture: string;            // 표면 질감: "smooth digital" | "paper grain" | "film grain" ...
  characterRendering: string; // 인물 렌더링: "realistic proportions" | "anime proportions" ...
  backgroundRendering: string;// 배경 렌더링: "photorealistic" | "painted" | "illustrated" ...
  motionFeel: string;         // 움직임 느낌: "fluid cinematic" | "hand-drawn" | "stop-motion jitter" ...
  colorPalette: string;       // 색감: "natural" | "muted warm" | "vibrant saturated" ...
  lighting: string;           // 조명: "natural" | "dramatic cinematic" | "flat illustration" ...
  cameraFeel: string;         // 카메라: "cinematic lens" | "static frame" | "documentary" ...
  edgeTreatment: string;      // 외곽선: "sharp" | "soft painterly" | "visible brush strokes" ...
}

// ──────────────────────────────────────────────────────────────────────────
// 2. 스타일 프리셋 (Style Preset)
// ──────────────────────────────────────────────────────────────────────────

export interface StylePreset {
  id: string;
  nameKo: string;
  dimensions: StyleDimensions;

  /** 긍정 스타일 블록 — 프롬프트 최상단에 배치, 자연어 중심 */
  globalStyleBlock: string;

  /** 캐릭터 렌더링 규칙 — 캐릭터 묘사 직전에 삽입 */
  characterStyleRule: string;

  /** 환경/배경 렌더링 규칙 — 배경 묘사 직전에 삽입 */
  environmentStyleRule: string;

  /** 스타일 강화 리마인더 — 프롬프트 후반부에 삽입 (모델이 잊지 않도록) */
  reinforcement: string;

  /** 네거티브 스타일 블록 — Avoid: 뒤에 삽입 */
  negativeBlock: string;

  /** 비실사면 true → ANTI_PHOTOREALISM 자동 합산 */
  isNonRealistic: boolean;
}

// 비실사 공통 negative
const ANTI_PHOTO = [
  "photorealistic rendering",
  "live-action footage",
  "realistic human skin texture",
  "cinematic realism",
  "hyper-real detail",
  "real camera footage",
  "DSLR photo look",
  "realistic lens bokeh",
];

// ──────────────────────────────────────────────────────────────────────────
// 3. 프리셋 정의 — style-catalog.ts에서 자동 생성 + 레거시 호환
// ──────────────────────────────────────────────────────────────────────────

import { STYLE_CATALOG, getAllStyles, getStyleByLegacyMode, getStyleById, buildStyleEnforcementBlock, getStyleRenderingRules } from "@/data/style-catalog";

/**
 * 카탈로그의 positivePrompt에서 StylePreset의 각 블록을 파생.
 * positivePrompt → globalStyleBlock (전체)
 * negativePrompt → negativeBlock
 */
function derivePresetFromCatalog(entry: { id: string; nameKo: string; categoryId: string; positivePrompt: string; negativePrompt: string }): StylePreset {
  const cat = STYLE_CATALOG.find(c => c.id === entry.categoryId);

  // 실사 카테고리는 기본적으로 photorealistic
  const realismMap: Record<string, RealismLevel> = {
    live_action: "photorealistic",
    animation_2d: "fully-illustrated",
    animation_3d: "semi-realistic",
    painting: "fully-illustrated",
    stop_motion: "stylized",
    retro_game: "fully-illustrated",
    experimental: "stylized",
  };

  // 특수 오버라이드
  const realismOverrides: Record<string, RealismLevel> = {
    "neon-noir": "semi-realistic",
    "semi-real-3d": "semi-realistic",
    "pixar-style": "stylized",
    "dreamworks-style": "stylized",
    "game-cinematic-3d": "semi-realistic",
    "rotoscoping": "stylized",
    "2d-3d-hybrid": "semi-realistic",
  };

  const realismLevel = realismOverrides[entry.id] ?? realismMap[entry.categoryId] ?? "stylized";

  // positive prompt의 첫 두 문장을 globalStyleBlock으로
  const sentences = entry.positivePrompt.split(". ").filter(Boolean);
  const globalStyleBlock = sentences.slice(0, 3).join(". ") + ".";
  const characterStyleRule = sentences.length > 3 ? sentences.slice(3, 5).join(". ") + "." : globalStyleBlock;
  const environmentStyleRule = sentences.length > 5 ? sentences.slice(5).join(". ") + "." : characterStyleRule;
  const reinforcement = `${entry.nameKo} style consistent throughout every frame. ${sentences[0]}.`;

  return {
    id: entry.id,
    nameKo: entry.nameKo + (cat ? ` (${cat.nameKo})` : ""),
    dimensions: {
      realismLevel,
      texture: "derived from catalog",
      characterRendering: "derived from catalog",
      backgroundRendering: "derived from catalog",
      motionFeel: "derived from catalog",
      colorPalette: "derived from catalog",
      lighting: "derived from catalog",
      cameraFeel: "derived from catalog",
      edgeTreatment: "derived from catalog",
    },
    globalStyleBlock: entry.positivePrompt,
    characterStyleRule,
    environmentStyleRule,
    reinforcement,
    negativeBlock: entry.negativePrompt,
    isNonRealistic: !["live_action"].includes(entry.categoryId),
  };
}

// 새 카탈로그 기반 프리셋 (StyleEntry.id → StylePreset)
const CATALOG_PRESETS: Record<string, StylePreset> = {};
for (const style of getAllStyles()) {
  CATALOG_PRESETS[style.id] = derivePresetFromCatalog(style);
}

// 레거시 호환: 기존 한글 키("실사", "2D 애니" 등)로도 접근 가능
const LEGACY_ALIASES: Record<string, StylePreset> = {};
for (const style of getAllStyles()) {
  if (style.legacyMode) {
    LEGACY_ALIASES[style.legacyMode] = CATALOG_PRESETS[style.id];
  }
}

export const STYLE_PRESETS: Record<string, StylePreset> = {
  ...CATALOG_PRESETS,
  ...LEGACY_ALIASES,
};

// ──────────────────────────────────────────────────────────────────────────
// 4. 카메라 모션 시스템 (Camera Motion System)
// ──────────────────────────────────────────────────────────────────────────

/**
 * 샷 타입별 기본 카메라 모션 프리셋.
 * Static은 기본값이 아니다 — 모든 샷에 최소 서틀 모션이 기본 적용.
 */
const SHOT_CAMERA_DEFAULTS: Record<string, string> = {
  // Establishing / Wide
  WS:  "Slow push-in from wide establishing frame, gentle reframing to settle on subject",
  LS:  "Slow dolly forward through environment, subtle lateral drift",
  // Medium shots
  MLS: "Gentle dolly in with subtle lateral drift, slight reframing",
  MS:  "Slow push-in toward subject, subtle handheld drift",
  // Close-ups
  MCU: "Subtle push-in with slight handheld drift, intimate reframing",
  CU:  "Very slow push-in deepening intimacy, minimal handheld sway",
  ECU: "Almost imperceptible creep-in, slight tremor suggesting held breath",
  // Special
  OTS: "Gentle drift past shoulder toward subject face, subtle push-in",
  POV: "Slight handheld drift simulating eye movement, gentle head-turn pan",
};

/**
 * 씬 감정/액션별 카메라 모션 오버라이드.
 * scenePrompt 내용 기반 자동 감지.
 */
interface CameraMotionOverride {
  keywords: RegExp;
  motion: string;
  timeline: string;
}

const SCENE_CAMERA_OVERRIDES: CameraMotionOverride[] = [
  {
    keywords: /\b(tension|suspense|fear|dread|creep|stalk|horror|danger)\b/i,
    motion: "Slow creep-in building tension, almost imperceptible forward drift",
    timeline: "0s-3s: static establishing tension, 3s-6s: barely perceptible creep forward, 6s-8s: slight push-in for dread",
  },
  {
    keywords: /\b(reveal|discover|surprise|shock|twist|realize)\b/i,
    motion: "Slow pull-back revealing full scene, or push-in to reveal detail",
    timeline: "0s-3s: tight framing hiding context, 3s-6s: steady pull-back revealing, 6s-8s: full reveal settled",
  },
  {
    keywords: /\b(chase|run|rush|flee|escape|sprint|hurry)\b/i,
    motion: "Dynamic tracking alongside action, urgent handheld movement",
    timeline: "0s-2s: burst of motion matching action, 2s-5s: tracking alongside movement, 5s-8s: following through",
  },
  {
    keywords: /\b(calm|peace|serene|quiet|meditat|contempl|reflect)\b/i,
    motion: "Gentle floating drift, slow arc around subject",
    timeline: "0s-3s: gentle lateral drift establishing calm, 3s-6s: slow arc movement, 6s-8s: gentle drift continuing",
  },
  {
    keywords: /\b(emotion|cry|tear|weep|grief|sorrow|mourn|heartbreak)\b/i,
    motion: "Subtle push-in toward face deepening emotional connection",
    timeline: "0s-2s: medium distance observing, 2s-5s: slow push-in toward emotional center, 5s-8s: intimate proximity held",
  },
  {
    keywords: /\b(confront|argue|fight|conflict|clash|stand.?off)\b/i,
    motion: "Slow arc between opposing figures, building tension through movement",
    timeline: "0s-3s: establishing both subjects, 3s-6s: slow arc shifting perspective, 6s-8s: push-in to decisive moment",
  },
];

/**
 * 스타일별 카메라 모션 느낌.
 * 스타일 프리셋과 연동하여 카메라 움직임의 질감을 조정.
 */
/** 카테고리별 기본 카메라 느낌 */
const CATEGORY_CAMERA_FLAVOR: Record<string, string> = {
  live_action:   "cinematic dolly and crane-like movement, filmic steadicam feel",
  animation_2d:  "dynamic anime camera sweep, dramatic zoom emphasis",
  animation_3d:  "smooth 3D camera orbit and dolly, depth-of-field transitions",
  painting:      "cinematic painted camera — dolly and pan through living brushwork",
  stop_motion:   "subtle miniature-scale camera shift, stop-motion camera increment",
  retro_game:    "pixel-aligned scroll, retro game camera pan",
  experimental:  "organic handheld sway, documentary-feel camera presence",
};

/** 스타일별 카메라 느낌 오버라이드 (특수 스타일) */
const STYLE_CAMERA_OVERRIDES_MAP: Record<string, string> = {
  // 실사 계열
  "cinematic-realism": "cinematic dolly and crane-like movement, filmic steadicam feel",
  "docu-handheld": "authentic handheld sway with observational camera distance",
  "commercial-ad": "smooth polished dolly and crane, product-hero tracking",
  "vintage-film": "vintage camera drift with slight mechanical imprecision",
  "neon-noir": "neon-reflected tracking shot, rain-slicked gliding movement",
  "vhs-retro": "VHS camera shake, unstabilized consumer camcorder movement",
  "sf-futuristic": "sleek hovering camera glide, futuristic smooth tracking",
  "gothic-horror": "slow creeping dolly, unsettling dutch tilt drift",
  // 2D 계열
  "tv-anime": "dynamic anime camera sweep, dramatic zoom emphasis",
  "theatrical-anime": "sweeping cinematic anime camera with fluid parallax",
  "storybook-anime": "gentle floating drift, fairy-tale camera sway",
  "painted-2d": "cinematic painted camera — dolly through living brushwork",
  "watercolor-animation": "soft flowing drift through watercolor world",
  "ink-drawing-anime": "measured pen-stroke panning, graphic novel page-turn",
  "webtoon-motion": "vertical scroll motion, panel-transition parallax",
  "cutout-anime": "flat lateral slide between paper layers",
  // 3D 계열
  "pixar-style": "smooth Pixar-style camera orbit with rack focus",
  "dreamworks-style": "energetic dynamic 3D camera with dramatic swoops",
  "stylized-3d": "cartoon 3D camera orbit with snappy movements",
  "semi-real-3d": "smooth digital cinema motion, cinematic with slight stylization",
  "low-poly-3d": "gentle isometric camera drift, minimal movement",
  "miniature-3d": "tilt-shift camera slide, overhead slow drift",
  "game-cinematic-3d": "AAA game camera choreography, epic sweeping shots",
  // 회화 계열
  "ink-wash": "scroll-like horizontal drift, contemplative slow pan",
  "east-asian-painting": "traditional scroll unrolling, meditative lateral pan",
  "van-gogh-painted": "swirling dynamic camera following brushstroke energy",
  // 스톱모션 계열
  "claymation": "table-top miniature camera nudge, stop-motion camera step",
  "paper-collage": "flat paper-layer parallax slide",
  "miniature-diorama": "miniature-scale overhead dolly with stop-motion jitter",
  // 레트로 계열
  "pixel-art": "pixel-aligned scroll, retro game camera pan",
  "16bit-jrpg": "SNES-style parallax scroll, mode-7 camera",
  "8bit-arcade": "fixed screen scroll, NES-style snap movement",
  "ps1-lowpoly": "PS1 fixed camera angle with jittery vertex snapping",
  "90s-game-cutscene": "dramatic pre-rendered camera orbit, 90s CG swoops",
  "visual-novel": "subtle portrait zoom and background parallax drift",
  // 실험 계열
  "rotoscoping": "organic handheld sway, documentary-feel camera presence",
  "mixed-media-collage": "layered parallax with found-footage camera shake",
  "live-paint-overlay": "real camera movement with painted overlay following action",
  "surreal-composite": "dream-logic camera — gravity-defying dolly and impossible angles",
};

/** 스타일 ID 또는 레거시 모드명으로 카메라 플레이버 반환 */
function getStyleCameraFlavor(animationMode: string): string {
  // 1. 직접 오버라이드 확인
  if (STYLE_CAMERA_OVERRIDES_MAP[animationMode]) return STYLE_CAMERA_OVERRIDES_MAP[animationMode];
  // 2. 레거시 이름 → 새 id 변환 후 확인
  const style = getStyleByLegacyMode(animationMode) ?? getStyleById(animationMode);
  if (style) {
    if (STYLE_CAMERA_OVERRIDES_MAP[style.id]) return STYLE_CAMERA_OVERRIDES_MAP[style.id];
    if (CATEGORY_CAMERA_FLAVOR[style.categoryId]) return CATEGORY_CAMERA_FLAVOR[style.categoryId];
  }
  // 3. 레거시 하드코딩 (호환)
  const LEGACY_FLAVOR: Record<string, string> = {
    "실사": "cinematic dolly and crane-like movement, filmic steadicam feel",
    "2D 애니": "dynamic anime camera sweep, dramatic zoom emphasis",
    "수채화 애니": "cinematic painted camera — dolly and pan through living brushwork",
    "하이브리드": "smooth digital camera motion, cinematic with slight stylization",
    "로토스코핑": "organic handheld sway, documentary-feel camera presence",
    "스톱모션": "subtle miniature-scale camera shift, stop-motion camera increment",
    "픽셀아트": "pixel-aligned scroll, retro game camera pan",
    "잉크워시": "scroll-like horizontal drift, contemplative slow pan",
    "클레이": "table-top miniature camera nudge, stop-motion camera step",
    "빈티지 필름": "vintage camera drift with slight mechanical imprecision",
    "네온 사이버펑크": "neon-reflected tracking shot, rain-slicked gliding movement",
    "미니어처": "tilt-shift camera slide, overhead slow drift",
  };
  return LEGACY_FLAVOR[animationMode] ?? "cinematic camera movement";
}

// STYLE_CAMERA_FLAVOR — 호환용 (기존 참조 유지)
const STYLE_CAMERA_FLAVOR: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_target, prop: string) {
    return getStyleCameraFlavor(prop);
  },
  has() { return true; },
});

/**
 * 최소 모션 기본값 — 명시적 카메라 지시가 없을 때 삽입.
 */
const MINIMUM_MOTION_FALLBACKS = [
  "slow push-in",
  "gentle lateral drift",
  "subtle handheld sway",
  "slow arc",
  "slight dolly forward",
];

/**
 * 안티-보어덤: static/고정 카메라 감지 패턴.
 */
const STATIC_CAMERA_PATTERNS = /\b(static|locked.?off|fixed|stationary|tripod|no.?movement|still.?camera|motionless)\b/i;

/**
 * 카메라 모션을 결정하고 8초 타임라인과 결합.
 *
 * 우선순위:
 * 1. 사용자 cameraDirection (명시적 "static" 포함 시 존중)
 * 2. 씬 감정/액션 기반 자동 감지
 * 3. 샷 타입별 기본 프리셋
 * 4. 최소 모션 fallback
 */
function resolveCameraMotion(input: {
  cameraDirection?: string;
  shotType?: string;
  scenePrompt: string;
  animationMode?: string;
  durationSec: number;
}): { cameraBlock: string; debug: { source: string; motionType: string; hasTimeline: boolean } } {
  const dur = input.durationSec || 8;
  const mid1 = Math.floor(dur * 0.25);  // ~2s
  const mid2 = Math.floor(dur * 0.625); // ~5s

  // ── 1. 사용자 명시 cameraDirection이 있고 충분히 구체적이면 사용 ──
  if (input.cameraDirection && input.cameraDirection.trim().length > 10) {
    const cd = input.cameraDirection.trim();

    // "static"이 명시적으로 있으면 존중하되 경고 로그
    if (STATIC_CAMERA_PATTERNS.test(cd)) {
      // 의도적 static — 최소 모션만 추가
      const styleFlavor = input.animationMode ? STYLE_CAMERA_FLAVOR[input.animationMode] : "";
      const minMotion = styleFlavor
        ? `Almost imperceptible ${styleFlavor.split(",")[0].trim().toLowerCase()}`
        : "Almost imperceptible gentle drift";
      return {
        cameraBlock: `${cd}. ${minMotion}.`,
        debug: { source: "user-static-with-minimum", motionType: "near-static", hasTimeline: false },
      };
    }

    // 충분한 카메라 지시 — 타임라인 구조만 보강
    if (!/\d+s/.test(cd)) {
      // 타임라인 없으면 추가
      return {
        cameraBlock: `0s-${mid1}s: establish with ${cd.split(".")[0].trim().toLowerCase()}. ${mid1}s-${mid2}s: ${cd}. ${mid2}s-${dur}s: settle into final frame.`,
        debug: { source: "user-direction-with-timeline", motionType: "user-specified", hasTimeline: true },
      };
    }

    return {
      cameraBlock: cd,
      debug: { source: "user-direction", motionType: "user-specified", hasTimeline: true },
    };
  }

  // ── 2. 씬 감정/액션 기반 자동 감지 ──
  for (const override of SCENE_CAMERA_OVERRIDES) {
    if (override.keywords.test(input.scenePrompt)) {
      const styleFlavor = input.animationMode ? STYLE_CAMERA_FLAVOR[input.animationMode] : "";
      const motionDesc = styleFlavor
        ? `${override.motion}, ${styleFlavor.split(",")[0].trim().toLowerCase()}`
        : override.motion;
      return {
        cameraBlock: `${motionDesc}. ${override.timeline}`,
        debug: { source: "scene-emotion-auto", motionType: override.motion.split(",")[0], hasTimeline: true },
      };
    }
  }

  // ── 3. 샷 타입별 기본 프리셋 ──
  const shotKey = (input.shotType || "MS").toUpperCase();
  const shotDefault = SHOT_CAMERA_DEFAULTS[shotKey] || SHOT_CAMERA_DEFAULTS["MS"];
  const styleFlavor = input.animationMode ? STYLE_CAMERA_FLAVOR[input.animationMode] : "";

  const motionDesc = styleFlavor
    ? `${shotDefault}, ${styleFlavor.split(",")[0].trim().toLowerCase()}`
    : shotDefault;

  const timeline = `0s-${mid1}s: establish framing. ${mid1}s-${mid2}s: ${motionDesc.split(",")[0].trim().toLowerCase()}. ${mid2}s-${dur}s: subtle emphasis shift settling into final composition.`;

  return {
    cameraBlock: `${motionDesc}. ${timeline}`,
    debug: { source: "shot-type-preset", motionType: shotDefault.split(",")[0], hasTimeline: true },
  };
}

/**
 * 안티-보어덤 검사: 프롬프트에 카메라 모션 없이 static하면 경고 + 자동 주입.
 */
function antiBoredCheck(prompt: string, animationMode?: string): { corrected: string; wasStatic: boolean } {
  const hasMotionKeywords = /\b(push.?in|pull.?back|dolly|pan|track|arc|drift|crane|handheld|creep|float|glide|sweep|zoom|slide)\b/i.test(prompt);

  if (hasMotionKeywords) {
    return { corrected: prompt, wasStatic: false };
  }

  // static 감지 — 최소 모션 삽입
  const fallback = MINIMUM_MOTION_FALLBACKS[Math.floor(Math.random() * MINIMUM_MOTION_FALLBACKS.length)];
  const styleFlavor = animationMode ? STYLE_CAMERA_FLAVOR[animationMode] : "";
  const motionAdd = styleFlavor
    ? `Camera: ${fallback} with ${styleFlavor.split(",")[0].trim().toLowerCase()}.`
    : `Camera: ${fallback}.`;

  return {
    corrected: `${prompt} ${motionAdd}`,
    wasStatic: true,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 5. 프롬프트 조립 엔진 (Prompt Assembly Engine)
// ──────────────────────────────────────────────────────────────────────────

export interface PromptAssemblyInput {
  /** 선택된 스타일 프리셋 ID (animationMode 값) */
  animationMode?: string;

  /** 스타일 강도 (0-100) */
  styleIntensity: number;

  /** 씬 프롬프트 원문 (videoPrompt 또는 extendPrompt) */
  scenePrompt: string;

  /** 캐릭터 일관성 규칙 (이전 컷에서 전달) */
  characterConsistency?: string;

  /** 분위기/조명 (이전 컷에서 전달) */
  moodLighting?: string;

  /** 카메라 방향 (이전 컷에서 전달) */
  cameraDirection?: string;

  /** 샷 타입 (ECU/CU/MCU/MS/MLS/LS/WS/OTS/POV) — 카메라 모션 프리셋 선택용 */
  shotType?: string;

  /** 사용자 지정 negativePrompt */
  userNegativePrompt?: string;

  /** 영상 길이 (초) — temporal beats용 */
  durationSec: number;

  /** 장면 유형 — map-graphic 등 특수 보호 규칙 적용용 */
  shotCategory?: string;
}

export interface AssembledPrompt {
  /** Veo에 전송할 최종 프롬프트 */
  finalPrompt: string;

  /** map scene drift 감지 시 경고 (비용 보호) */
  driftWarning?: string;

  /** 디버그용 블록별 분해 */
  debug: {
    styleBlock: string;
    consistencyBlock: string;
    cameraBlock: string;
    sceneBlock: string;
    reinforcementBlock: string;
    negativeBlock: string;
    audioBlock: string;
    wordCount: number;
    realismLevel: RealismLevel | "unknown";
    isNonRealistic: boolean;
    isMapScene: boolean;
    camera: {
      source: string;
      motionType: string;
      hasTimeline: boolean;
      antiBoredomTriggered: boolean;
    };
  };
}

/**
 * 씬 프롬프트에서 내부 메타 필드 태그를 자연어로 변환.
 * SHOT_SIZE:CU → Close-up shot. 같은 식으로 모델 친화적 자연어로 풀어쓴다.
 */
function naturalizeMetaFields(prompt: string): string {
  return prompt
    // ── 메타태그 → 자연어 변환 (SHOT_SIZE만 자연어화, 나머지는 값만 추출 또는 제거) ──
    // SHOT_SIZE:XXX → "XXX shot."
    .replace(/SHOT_SIZE:\s*(\w+)/gi, (_m, v) => {
      const map: Record<string, string> = {
        ECU: "Extreme close-up", CU: "Close-up", MCU: "Medium close-up",
        MS: "Medium shot", MLS: "Medium long shot", LS: "Long shot",
        WS: "Wide shot", OTS: "Over-the-shoulder", POV: "Point-of-view",
      };
      return `${map[v.toUpperCase()] || v} shot.`;
    })
    // CAMERA_ANGLE:XXX → 값만 (태그 제거)
    .replace(/CAMERA_ANGLE:\s*/gi, "")
    // CAMERA_MOVEMENT/CAMERA_PROGRESSION:XXX → 값만
    .replace(/CAMERA_(MOVEMENT|PROGRESSION):\s*/gi, "")
    // SUBJECT_BLOCKING:XXX → 제거 (Veo가 사용하지 않는 내부 정보)
    .replace(/SUBJECT_BLOCKING:\s*[^.|]*[.|]?\s*/gi, "")
    // SUBJECT_ACROSS_SCENE:XXX → 값만
    .replace(/SUBJECT_ACROSS_SCENE:\s*/gi, "")
    // SUBJECT:XXX → 값만
    .replace(/SUBJECT:\s*/gi, "")
    // ACTION_BEAT:XXX → 값만
    .replace(/ACTION_BEAT:\s*/gi, "")
    // BODY_SIGNAL:XXX → 값만
    .replace(/BODY_SIGNAL:\s*/gi, "")
    // REVEALED:XXX → 제거 (내부 planning, Veo 불필요)
    .replace(/REVEALED:\s*[^.|]*[.|]?\s*/gi, "")
    // WITHHELD:XXX → 제거 (프레임 밖 정보)
    .replace(/WITHHELD:\s*[^.]*\.?\s*/gi, "")
    // END_HOOK:XXX → 제거 (다음 씬 연결용 내부 정보)
    .replace(/END_HOOK:\s*[^.|]*[.|]?\s*/gi, "")
    // TRANSITION_FROM_PREV:XXX → 값만
    .replace(/TRANSITION_FROM_PREV:\s*/gi, "")
    // PREV SCENE ENDS: → 자연어
    .replace(/PREV SCENE ENDS:\s*/gi, "Previous shot ends with ")
    // NEW SCENE OPENS: → 제거 (렌더러가 이미 처리)
    .replace(/NEW SCENE OPENS:\s*/gi, "")
    // NEW SHOT: → 제거
    .replace(/NEW SHOT:\s*/gi, "")
    // NEW ACTION: → 값만
    .replace(/NEW ACTION:\s*/gi, "")
    // BEHAVIORAL SHIFT: → 값만
    .replace(/BEHAVIORAL SHIFT:\s*/gi, "")
    // NEWLY REVEALED: → 제거 (내부 planning)
    .replace(/NEWLY REVEALED:\s*[^.|]*[.|]?\s*/gi, "")
    // STILL WITHHELD: → 제거
    .replace(/STILL WITHHELD:\s*[^.]*\.?\s*/gi, "")
    // SCENE BEATS: → 제거 (timingBeat로 이미 처리)
    .replace(/SCENE BEATS:\s*/gi, "")
    // 파이프 구분자 → 마침표
    .replace(/\s*\|\s*/g, ". ")
    // ── 텍스트 유도 오브젝트 교체 ──
    .replace(/\b(dusty|faded|old|worn|weathered)\s+signs?\b/gi, "weathered wooden panel")
    .replace(/\bsignboards?\b/gi, "facade panel")
    .replace(/\bsignage\b/gi, "wall-mounted panel")
    .replace(/\b(clinic|shop|store|office)\s+signs?\b/gi, "$1 facade")
    .replace(/\b(neon|lit|glowing)\s+signs?\b/gi, "$1 tubes")
    // ── 사각형 아티팩트 유발 표현 교체 (map scene 외 일반 씬에서도 적용) ──
    .replace(/\b(labeled|labelled)\s+(region|area|zone|territory|country|province|district)s?\b/gi, "color-coded $2")
    .replace(/\bcountry\s+names?\b/gi, "colored territorial regions")
    .replace(/\btitle\s+box\b/gi, "")
    .replace(/\bcaption\s+box\b/gi, "")
    .replace(/\btext\s+box\b/gi, "")
    // ── 정리 ──
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 프롬프트에 temporal beats가 없으면 자동 추가.
 */
function ensureTemporalBeats(prompt: string, durationSec: number): string {
  if (/\d+s[-–]\d+s/.test(prompt) || /first\s+\d+\s*seconds?/i.test(prompt)) return prompt;
  if (/\bfirst\b[\s\S]*\bthen\b[\s\S]*\bfinally\b/i.test(prompt)) return prompt;

  const dur = durationSec || 8;
  const mid = Math.floor(dur * 0.3);
  const mid2 = Math.floor(dur * 0.65);

  const sentences = prompt.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return prompt;

  const header = sentences[0];
  const rest = sentences.slice(1);

  if (rest.length >= 3) {
    const third = Math.ceil(rest.length / 3);
    const p1 = rest.slice(0, third).join(" ");
    const p2 = rest.slice(third, third * 2).join(" ");
    const p3 = rest.slice(third * 2).join(" ");
    return `${header} 0s-${mid}s: ${p1} ${mid}s-${mid2}s: ${p2} ${mid2}s-${dur}s: ${p3}`;
  }

  return `${header} 0s-${mid2}s: ${rest[0]} ${mid2}s-${dur}s: ${rest.slice(1).join(" ") || rest[0]}`;
}

/**
 * 프롬프트에서 문서/편지/두루마리 내용 텍스트를 제거.
 */
function sanitizeTextContent(prompt: string): string {
  let s = prompt
    .replace(/\b(that\s+)?(reads?|saying|says|written|writes?|displaying|shows?)\s*[:"]?\s*["']?[^.,"']{3,}["']?/gi, "")
    .replace(/\bwith\s+(the\s+)?(text|words?|inscription|message|content|writing|characters?|letters?|script)\s*[:"]?\s*["']?[^.,"']{3,}["']?/gi, "")
    .replace(/\b(containing|bearing|carrying|featuring|displaying)\s+(text|words?|inscription|writing|characters?|script)\s*[:"]?\s*["']?[^.,"']{3,}["']?/gi, "")
    .replace(/\b(visible|readable|legible|clear)\s+(text|writing|characters?|script|inscription)\s*[:"]?\s*["']?[^.,"']{3,}["']?/gi, "")
    .replace(/\b(calligraphy|kanji|hangul|chinese characters?|japanese characters?|korean text|hanzi)\s*(reading|saying|that|of|:)\s*["']?[^.,"']{3,}["']?/gi,
      (match) => match.split(/reading|saying|that|of|:/i)[0].trim())
    .replace(/,\s*,/g, ",")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!/no text overlay/i.test(s)) {
    s += ". No text overlay, no watermark";
  }
  // 동양화풍 등 문자 오해 방지: 강화된 텍스트 억제
  if (/east.?asian|ink.?wash|sumi|oriental|asian.?paint|수묵|동양/i.test(s)) {
    if (!/no calligraphy/i.test(s)) {
      s += ". No text, no letters, no labels, no calligraphy, no Chinese characters, no Korean characters, no Japanese characters, no typographic marks, no readable symbols";
    }
  }
  return s;
}

// ── 스타일 블록 캐시 ─────────────────────────────────────────────────────
// assemblePrompt()가 동일 animationMode에 대해 반복 호출될 때
// buildStyleEnforcementBlock / getStyleRenderingRules 결과를 캐시하여 재계산 방지
const _styleEnforcementCache = new Map<string, ReturnType<typeof buildStyleEnforcementBlock>>();
const _styleRenderingCache = new Map<string, ReturnType<typeof getStyleRenderingRules>>();

function getCachedEnforcement(styleId: string) {
  let cached = _styleEnforcementCache.get(styleId);
  if (!cached) {
    cached = buildStyleEnforcementBlock(styleId);
    _styleEnforcementCache.set(styleId, cached);
  }
  return cached;
}

function getCachedRenderingRules(styleId: string) {
  let cached = _styleRenderingCache.get(styleId);
  if (!cached) {
    cached = getStyleRenderingRules(styleId);
    _styleRenderingCache.set(styleId, cached);
  }
  return cached;
}

/**
 * 메인 프롬프트 조립 함수.
 *
 * 프롬프트 우선순위 (위→아래):
 * 1. 전체 스타일 정체성 (globalStyleBlock)
 * 2. 캐릭터/배경 일관성 (characterStyleRule + characterConsistency)
 * 3. 카메라 모션 (자동 프리셋 + 8초 타임라인)
 * 4. 장면 액션 (scenePrompt — 메타 필드 자연어 변환)
 * 5. 스타일 강화 리마인더 (reinforcement)
 * 6. 네거티브 (negativeBlock + anti-photorealism)
 * 7. 오디오 힌트
 */
export function assemblePrompt(input: PromptAssemblyInput): AssembledPrompt {
  const preset = input.animationMode ? STYLE_PRESETS[input.animationMode] : undefined;
  const isMapScene = input.shotCategory === "map-graphic";

  // ── MAP SCENE PROTECTION ──────────────────────────────────
  // map-graphic 장면에서는 스타일 페르소나/강화를 억제하고
  // cartographic 보호 규칙을 적용 (산수화/학/동양풍 drift 방지)
  const MAP_SCENE_POSITIVE = "Wide shot, eye-level view of a flat antique paper map filling the frame. The image is clearly a historical map, not a landscape. Aged parchment texture, ornate compass rose, faded black ink coastlines and borders, territorial overlays, trade routes, subtle paper wear and grain, ink diffusion on aged paper. Cold daylight from upper right, soft diffused glow. No inserted objects, no floating panels, no boxed annotations, no embedded signage, no readable text, no labels.";
  const MAP_SCENE_NEGATIVES = [
    // ── 풍경/자연 drift 차단 ──
    "landscape", "tree", "forest", "mountain", "river",
    "watercolor scenery", "ink painting", "sumi-e", "nature scene",
    "cranes", "birds", "heron", "animals", "flying creatures",
    "scenic painting", "nature tableau", "brush painting scenery",
    "traditional painting composition", "countryside illustration",
    "mountain landscape", "misty peaks", "decorative East Asian motifs",
    // ── 인물/전쟁 drift 차단 ──
    "human figure", "battlefield", "portrait",
    // ── 텍스트/UI 아티팩트 차단 ──
    "readable text", "subtitles", "calligraphy", "poster",
    "boxes", "rectangular overlay", "UI panels", "text boxes",
    "labels", "signboards", "framed inserts", "infographic elements",
    "cartouche", "decorative panels", "floating panels",
    "boxed annotations", "title boxes", "caption boxes", "modern UI",
  ];

  // ── BLOCK 0: STYLE PERSONA — 제거됨 ──────────────────────
  // 페르소나 블록은 Veo에게 불필요한 메타 지시문이며
  // 씬 프롬프트의 워드 예산을 낭비함. 제거하여 씬 내용 우선 배치.

  // ── BLOCK 1: STYLE IDENTITY ───────────────────────────────
  // ⚠️ map scene에서는 스타일 블록 대신 cartographic 보호 블록 삽입
  let styleBlock = "";
  if (isMapScene) {
    styleBlock = MAP_SCENE_POSITIVE;
  } else if (preset) {
    styleBlock = preset.globalStyleBlock;
  }

  // ── BLOCK 2: CONSISTENCY (character + environment + rendering rules) ─────────
  const consistencyParts: string[] = [];
  if (preset && !isMapScene) {
    consistencyParts.push(preset.characterStyleRule);
    consistencyParts.push(preset.environmentStyleRule);
  }
  // 스타일별 렌더링 규칙 추가 (map scene 제외)
  if (input.animationMode && !isMapScene) {
    const rules = getCachedRenderingRules(input.animationMode);
    if (rules.sequenceRules && input.styleIntensity > 30) {
      consistencyParts.push(rules.sequenceRules);
    }
  }
  if (input.characterConsistency) {
    consistencyParts.push(input.characterConsistency);
  }
  if (input.moodLighting) {
    consistencyParts.push(input.moodLighting);
  }
  const consistencyBlock = consistencyParts.join(" ");

  // ── BLOCK 3: CAMERA MOTION ──────────────────────────────────
  // 카메라 모션 시스템: shotType + 감정 감지 + 스타일 연동
  const cameraResult = resolveCameraMotion({
    cameraDirection: input.cameraDirection,
    shotType: input.shotType,
    scenePrompt: input.scenePrompt,
    animationMode: input.animationMode,
    durationSec: input.durationSec,
  });
  // ⚠️ MAP SCENE: 카메라를 항상 top-down으로 강제
  const cameraBlock = isMapScene
    ? "Eye-level view looking at flat antique paper map surface. 0-2s: close detailed view of the map, aged parchment texture, faded ink coastlines, ornate compass rose. 2-5s: territorial color emphasis gradually becomes visually dominant with gentle stain-like spread. 5-8s: camera slowly zooms out to reveal more of the full map while preserving the same antique map surface and composition."
    : cameraResult.cameraBlock;

  // ── BLOCK 4: SCENE CONTENT ─────────────────────────────────
  // 메타 필드를 자연어로 변환
  let sceneBlock = naturalizeMetaFields(input.scenePrompt);

  // ⚠️ MAP SCENE: scene content에서 drift 유발 표현 + 사각형 아티팩트 유발 표현 강제 제거
  if (isMapScene) {
    // 지도 장면에서 풍경/동물 표현이 scene prompt에 침투했을 경우 제거
    sceneBlock = sceneBlock
      .replace(/\b(crane|cranes|heron|herons)\b(?!\s*(shot|angle|camera|move))/gi, "")
      .replace(/\b(birds?\s+fly|flying\s+birds?|soaring\s+birds?)\b/gi, "")
      .replace(/\b(mountain\s+landscape|scenic\s+painting|nature\s+tableau)\b/gi, "")
      .replace(/\b(brush\s*stroke\s+mountains?|misty\s+peaks?|ink\s+wash\s+mountains?)\b/gi, "")
      // ── 사각형 아티팩트 유발 표현 제거 (label/sign/frame/panel 계열) ──
      .replace(/\b(labeled|labelled)\s+[\w\s]{1,30}/gi, "")
      .replace(/\bcountry\s+names?\b/gi, "colored territorial regions")
      .replace(/\b(title\s+box|text\s+box|info\s*box)\b/gi, "")
      .replace(/\b(infographic|info\s*graphic)\s*[\w\s]*/gi, "")
      .replace(/\b(overlay\s+(?:panel|box|frame|insert))\b/gi, "")
      .replace(/\bUI[\s-]?like\b/gi, "")
      .replace(/\b(framed?\s+inserts?|inset\s+panels?|inset\s+maps?)\b/gi, "")
      .replace(/\b(caption|captions|captioned)\b/gi, "")
      .replace(/\b(plaque|plaques|cartouche)\b/gi, "")
      .replace(/\b(marker|markers)\b(?!\s*(pen|line))/gi, "location indicator")
      .replace(/\b(signboard|sign\s*board|sign\s*post)\b/gi, "")
      .replace(/\blabels?\b/gi, "")
      .replace(/,\s*,/g, ",").replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();

    // 지도 장면 앵커 강화: scene block 맨 앞에 cartographic 프레이밍 삽입
    if (!/\b(map|cartograph|parchment|top.?down|overhead|territorial)\b/i.test(sceneBlock)) {
      sceneBlock = `Flat antique historical paper map filling the frame, clearly seen as a paper map and not a natural landscape. ${sceneBlock}`;
    }
    // scene block에 landscape/nature/watercolor 표현이 남아있으면 추가 제거
    sceneBlock = sceneBlock
      .replace(/\bwatercolor\s+(landscape|scenery|painting)\b/gi, "aged parchment texture")
      .replace(/\bink\s+(wash|painting)\s+(landscape|scenery|mountain)\b/gi, "ink diffusion on aged paper")
      .replace(/\bsumi-e\s+style\b/gi, "historical cartographic style");
  }

  // Temporal beats 삽입
  sceneBlock = ensureTemporalBeats(sceneBlock, input.durationSec);

  // 텍스트 콘텐츠 sanitize
  sceneBlock = sanitizeTextContent(sceneBlock);

  // ── BLOCK 5: STYLE REINFORCEMENT ───────────────────────────
  // ⚠️ map scene에서는 스타일 강화를 건너뜀 (지도→풍경 drift 방지)
  let reinforcementBlock = "";
  if (preset && input.styleIntensity > 20 && !isMapScene) {
    if (input.styleIntensity <= 50) {
      const parts = preset.reinforcement.split(".").map(s => s.trim()).filter(Boolean);
      reinforcementBlock = parts.slice(0, 1).join(". ") + ".";
    } else {
      reinforcementBlock = preset.reinforcement;
    }
  }
  if (isMapScene) {
    reinforcementBlock = "This is a historical paper map, NOT a landscape or nature scene. Maintain flat antique map surface throughout. The map must look like a document on a table, not a real landscape. No landscape reinterpretation, no watercolor painting, no ink wash scenery. No animals or decorative creatures. No rectangular overlays, no floating panels, no text boxes, no labels, no framed inserts, no infographic elements. No trees, no mountains, no forests, no rivers as real scenery.";
  }

  // ── BLOCK 6: NEGATIVE ──────────────────────────────────────
  const negParts: string[] = [];
  if (preset) {
    negParts.push(preset.negativeBlock);
    if (preset.isNonRealistic) {
      negParts.push(ANTI_PHOTO.join(", "));
    }
  }
  if (input.userNegativePrompt?.trim()) {
    negParts.push(input.userNegativePrompt);
  }
  // map scene 전용 negative 주입
  if (isMapScene) {
    negParts.push(MAP_SCENE_NEGATIVES.join(", "));
  }

  // 중복 제거
  const seen = new Set<string>();
  const uniqueNeg = negParts.join(", ").split(",")
    .map(s => s.trim().toLowerCase()).filter(Boolean)
    .filter(s => { if (seen.has(s)) return false; seen.add(s); return true; });
  // 핵심 제한 (Veo가 너무 긴 negative는 무시) — map scene은 사각형 아티팩트 + 풍경 drift 보호까지 포함하여 25개 허용
  const negativeBlock = uniqueNeg.slice(0, isMapScene ? 25 : 8).join(", ");

  // ── BLOCK 7: AUDIO ──────────────────────────────────────────
  const hasAudioRef = /\b(sound|audio|diegetic|ambient|noise|music|voice|speech)\b/i.test(sceneBlock);
  const audioBlock = hasAudioRef ? "" : "Diegetic sound, ambient audio.";

  // ── 조립 ───────────────────────────────────────────────────
  // 핵심 원칙: Veo는 프롬프트 앞부분에 더 높은 가중치를 줌.
  // 따라서 씬 내용(사용자 의도)을 최우선 배치하고,
  // 스타일/카메라는 간결한 supporting context로 뒤에 배치.
  const blocks: string[] = [];

  // 1. 씬 내용 (최우선 — 사용자가 원하는 장면의 핵심)
  blocks.push(sceneBlock);

  // 2. 카메라 모션 (시각적 연출)
  if (cameraBlock) blocks.push(`Camera: ${cameraBlock}`);

  // 3. 스타일 정체성 (간결하게 — 첫 문장만)
  if (styleBlock) {
    // 스타일 블록이 너무 길면 첫 2문장만 사용하여 씬 프롬프트 공간 확보
    const styleSentences = styleBlock.split(". ").filter(Boolean);
    const compactStyle = styleSentences.length > 2
      ? styleSentences.slice(0, 2).join(". ") + "."
      : styleBlock;
    blocks.push(compactStyle);
  }

  // 4. 일관성 규칙 (간결하게)
  if (consistencyBlock) {
    // 일관성 블록도 과도하면 압축
    const consistencyWords = consistencyBlock.split(/\s+/);
    if (consistencyWords.length > 40) {
      blocks.push(consistencyWords.slice(0, 40).join(" "));
    } else {
      blocks.push(consistencyBlock);
    }
  }

  // 5. 스타일 강화 (map scene이나 높은 styleIntensity에서만)
  if (reinforcementBlock) blocks.push(reinforcementBlock);

  let prompt = blocks.join(" ");

  // ── 안티-보어덤 최종 검사 ────────────────────────────────────
  const boredCheck = antiBoredCheck(prompt, input.animationMode);
  const antiBoredomTriggered = boredCheck.wasStatic;
  prompt = boredCheck.corrected;

  // ── 워드 캡 (negative/audio 전에) ──────────────────────────
  // Veo 3.1은 긴 프롬프트를 잘 처리함 → 200단어까지 허용
  const words = prompt.split(/\s+/);
  if (words.length > 210) {
    prompt = words.slice(0, 200).join(" ");
    if (!/no text overlay/i.test(prompt)) {
      prompt += ". No text overlay, no watermark";
    }
  }

  // 6. 네거티브
  if (negativeBlock && !prompt.includes("Avoid:")) {
    prompt = `${prompt}. Avoid: ${negativeBlock}`;
  }

  // 7. 오디오
  if (audioBlock) {
    prompt = `${prompt}. ${audioBlock}`;
  }

  const finalWordCount = prompt.split(/\s+/).length;

  // ── PREFLIGHT DRIFT DETECTION ──────────────────────────────
  // map scene인데 최종 prompt에 풍경/동물 표현이 남아있으면 drift 경고
  let driftWarning: string | undefined;
  if (isMapScene) {
    const driftTerms = [
      /\bcrane(?!s?\s*(shot|angle|camera|move))\b/i,
      /\bbird\b/i,
      /\bheron\b/i,
      /\bmountain\s+landscape\b/i,
      /\bscenic\s+painting\b/i,
      /\bnature\s+tableau\b/i,
      /\bbrush\s*stroke\s+mountain/i,
      /\bink\s+wash\s+mountain/i,
      /\bflying\s+(creature|animal|bird)/i,
      /\btraditional\s+painting\s+composition/i,
      /\bmisty\s+peak/i,
    ];
    // ── 사각형 아티팩트 유발 표현 감지 (preflight validation) ──
    const rectArtifactTerms = [
      /\blabels?\b/i,
      /\blabeled\b/i,
      /\bsign(?:board|post|age)?\b(?!\s*(language|al|ificant|ed\s+contract))/i,
      /\bframed?\s+(?:insert|object|panel|box)/i,
      /\bpanel[\s-]?like\s+insert/i,
      /\binfographic\s+overlay/i,
      /\bcountry\s+names?\s+(rendered|displayed|shown|written|visible)/i,
      /\btitle\s+box/i,
      /\bcaption\s+box/i,
      /\btext\s+box/i,
      /\bUI[\s-]?panel/i,
      /\bcartouche\b/i,
      /\bplaque\b/i,
    ];
    const found = driftTerms
      .filter(re => re.test(prompt))
      .map(re => { const m = prompt.match(re); return m?.[0] ?? ""; })
      .filter(Boolean);
    const rectFound = rectArtifactTerms
      .filter(re => re.test(prompt))
      .map(re => { const m = prompt.match(re); return m?.[0] ?? ""; })
      .filter(Boolean);
    if (found.length > 0) {
      driftWarning = `MAP SCENE DRIFT DETECTED: "${found.join('", "')}" — 지도 장면에 풍경/동물 표현이 포함됨. 생성 결과가 산수화/학으로 드리프트될 위험 높음.`;
    } else if (rectFound.length > 0) {
      driftWarning = `MAP SCENE RECT ARTIFACT RISK: "${rectFound.join('", "')}" — 지도 장면에 사각형 아티팩트를 유발하는 표현(label/sign/frame/panel)이 감지됨. 모델이 읽을 수 없는 텍스트 박스나 UI 패널을 생성할 위험 높음.`;
    }
  }

  return {
    finalPrompt: prompt,
    driftWarning,
    debug: {
      styleBlock,
      consistencyBlock,
      cameraBlock,
      sceneBlock: sceneBlock.slice(0, 200) + (sceneBlock.length > 200 ? "…" : ""),
      reinforcementBlock,
      negativeBlock,
      audioBlock,
      wordCount: finalWordCount,
      realismLevel: preset?.dimensions.realismLevel ?? "unknown",
      isNonRealistic: preset?.isNonRealistic ?? false,
      isMapScene,
      camera: {
        source: isMapScene ? "map-override" : cameraResult.debug.source,
        motionType: isMapScene ? "static-topdown" : cameraResult.debug.motionType,
        hasTimeline: cameraResult.debug.hasTimeline,
        antiBoredomTriggered,
      },
    },
  };
}

/**
 * 스타일 프리셋 목록을 UI에 표시할 수 있는 형태로 반환.
 */
export function getAvailablePresets(): Array<{ id: string; nameKo: string; realismLevel: RealismLevel }> {
  return Object.entries(STYLE_PRESETS).map(([key, p]) => ({
    id: key,
    nameKo: p.nameKo,
    realismLevel: p.dimensions.realismLevel,
  }));
}

/**
 * 프리셋의 상세 정보를 반환 (디버그/프리뷰용).
 */
export function getPresetDetails(animationMode: string): StylePreset | undefined {
  return STYLE_PRESETS[animationMode];
}
