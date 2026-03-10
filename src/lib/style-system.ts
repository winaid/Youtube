/**
 * 전역 스타일 시스템 — 프로젝트 단위 비주얼 정체성 관리
 *
 * 설계 원칙:
 * 1. 스타일은 "단어"가 아니라 "시스템"으로 다룬다
 * 2. 프로젝트 전체에 하나의 스타일 정체성이 일관되게 적용된다
 * 3. 최종 프롬프트는 [STYLE] > [CONSISTENCY] > [SCENE] > [NEGATIVE] 우선순위로 조립된다
 * 4. 내부 메타 필드는 내부에만 유지하고, Veo에 보내는 프롬프트는 자연어 중심으로 변환한다
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
// 3. 프리셋 정의
// ──────────────────────────────────────────────────────────────────────────

export const STYLE_PRESETS: Record<string, StylePreset> = {
  // ─── 실사 ──────────────────────────────────────────────────
  "실사": {
    id: "realistic-cinematic",
    nameKo: "실사 시네마틱",
    dimensions: {
      realismLevel: "photorealistic",
      texture: "natural film grain, organic surfaces",
      characterRendering: "realistic human proportions, natural skin, real clothing folds",
      backgroundRendering: "photorealistic environments, real-world locations",
      motionFeel: "fluid cinematic motion, natural physics",
      colorPalette: "natural tones with cinematic color grading",
      lighting: "dramatic cinematic lighting, volumetric light, natural shadows",
      cameraFeel: "cinematic lens, shallow depth of field, anamorphic",
      edgeTreatment: "sharp photographic detail, natural focus falloff",
    },
    globalStyleBlock: "Photorealistic cinematic live-action. Natural lighting with dramatic shadows. Filmic depth of field. Real-world textures and materials.",
    characterStyleRule: "Realistic human proportions, natural skin tones and pores, authentic clothing with real fabric physics.",
    environmentStyleRule: "Photorealistic environments with natural weathering, authentic materials, volumetric atmospheric effects.",
    reinforcement: "Cinematic film quality throughout, professional color grading, anamorphic lens characteristics.",
    negativeBlock: "cartoon, anime, illustration, painting, flat colors, cel-shading, stylized, text overlay, watermark",
    isNonRealistic: false,
  },

  // ─── 2D 애니 ───────────────────────────────────────────────
  "2D 애니": {
    id: "2d-anime",
    nameKo: "2D 애니메이션",
    dimensions: {
      realismLevel: "fully-illustrated",
      texture: "clean digital, cel-shaded flat surfaces",
      characterRendering: "anime proportions, large eyes, simplified facial features, clean outlined forms",
      backgroundRendering: "illustrated anime backgrounds, detailed painted scenery with flat color areas",
      motionFeel: "anime keyframe animation, expressive limited-frame motion",
      colorPalette: "vibrant saturated anime palette, clear color separations",
      lighting: "anime-style dramatic lighting with sharp light/shadow edges",
      cameraFeel: "dynamic anime camera angles, dramatic zooms, speed lines",
      edgeTreatment: "clean sharp outlines, consistent line weight, cel-shaded edges",
    },
    globalStyleBlock: "2D anime animation style. Cel-shaded illustration with clean outlines and vibrant flat colors. Anime character proportions with expressive features. Illustrated backgrounds with painterly detail.",
    characterStyleRule: "Anime character design with stylized proportions, clean outlines, cel-shaded coloring, expressive large eyes.",
    environmentStyleRule: "Anime background art style, illustrated scenery with clear color areas and detailed painterly elements.",
    reinforcement: "Consistent anime art style throughout every frame. Clean cel-shading maintained. Sharp illustrated edges on all forms.",
    negativeBlock: "3D rendering, realistic skin, real photography, cinematic realism, natural film grain, text overlay, watermark",
    isNonRealistic: true,
  },

  // ─── 수채화 애니 ────────────────────────────────────────────
  "수채화 애니": {
    id: "watercolor-illustrated",
    nameKo: "수채화 일러스트",
    dimensions: {
      realismLevel: "fully-illustrated",
      texture: "watercolor paper grain, visible brush strokes, pigment bleeding edges",
      characterRendering: "hand-painted stylized characters, soft watercolor edges, non-photorealistic faces",
      backgroundRendering: "watercolor wash backgrounds, loose painterly scenery, textured paper visible",
      motionFeel: "gentle hand-drawn animation, soft flowing movement",
      colorPalette: "soft muted watercolor tones, warm pigment washes, translucent color layering",
      lighting: "soft diffused illustration lighting, no harsh photorealistic shadows",
      cameraFeel: "gentle panning, storybook page compositions, static illustrated frames",
      edgeTreatment: "soft painted edges, visible brush strokes, pigment bleeding at contours",
    },
    globalStyleBlock: "2D hand-painted watercolor animation on textured paper. Storybook illustration style throughout. Soft pigment bleeding with visible brush strokes. All forms are stylized, non-photorealistic, painterly. Warm watercolor wash with paper grain visible in every frame.",
    characterStyleRule: "Characters rendered as watercolor illustrations — soft painted edges, stylized non-realistic faces, hand-drawn feel, watercolor pigment texture on skin and clothing.",
    environmentStyleRule: "Backgrounds painted in loose watercolor wash technique. Visible paper texture. Soft wet-on-wet pigment blending. Illustrated scenery, never photorealistic.",
    reinforcement: "Watercolor paper grain visible throughout. Illustrated storybook aesthetic in every frame. Hand-painted feel maintained — no photorealistic elements anywhere.",
    negativeBlock: "sharp digital rendering, clean vector outlines, 3D CGI, smooth plastic surfaces, realistic skin pores, photographic detail, text overlay, watermark",
    isNonRealistic: true,
  },

  // ─── 하이브리드 ─────────────────────────────────────────────
  "하이브리드": {
    id: "semi-realistic",
    nameKo: "세미 리얼리스틱",
    dimensions: {
      realismLevel: "semi-realistic",
      texture: "digital art finish, subtle stylization",
      characterRendering: "anime-influenced proportions with realistic detail, stylized but believable",
      backgroundRendering: "detailed digital matte painting, semi-realistic environments",
      motionFeel: "smooth digital animation, slightly stylized physics",
      colorPalette: "rich digital art palette, slightly enhanced from reality",
      lighting: "cinematic with artistic enhancement, stylized light rays",
      cameraFeel: "cinematic framing with artistic composition",
      edgeTreatment: "clean digital with subtle softness",
    },
    globalStyleBlock: "Semi-realistic digital art animation. Anime-influenced character proportions within detailed realistic environments. Stylized rendering with cinematic quality.",
    characterStyleRule: "Semi-realistic character design — anime-influenced proportions but with detailed rendering and believable materials.",
    environmentStyleRule: "Detailed digital matte painting environments with semi-realistic lighting and subtle artistic enhancement.",
    reinforcement: "Consistent semi-realistic digital art quality. Stylized but grounded aesthetic throughout.",
    negativeBlock: "pure photorealism, pure flat anime, uncanny valley, text overlay, watermark",
    isNonRealistic: false,
  },

  // ─── 로토스코핑 ─────────────────────────────────────────────
  "로토스코핑": {
    id: "rotoscope",
    nameKo: "로토스코핑",
    dimensions: {
      realismLevel: "stylized",
      texture: "painterly overlay on motion, hand-traced texture",
      characterRendering: "performance-derived human movement with painterly stylized overlay",
      backgroundRendering: "painted backgrounds with rotoscoped motion elements",
      motionFeel: "fluid performance-based movement with artistic overlay",
      colorPalette: "rich painterly palette, artistic color choices",
      lighting: "performance-captured lighting with artistic enhancement",
      cameraFeel: "documentary framing with artistic post-processing",
      edgeTreatment: "hand-traced outlines, painterly edges, visible artistic processing",
    },
    globalStyleBlock: "Rotoscoped 2D animation. Performance-derived fluid movement with painterly stylized overlay. Hand-traced outlines over realistic motion. Artistic painted processing over every frame.",
    characterStyleRule: "Rotoscoped character motion — fluid human movement with hand-traced painterly overlay, not clean realistic rendering.",
    environmentStyleRule: "Painted backgrounds that blend with rotoscoped foreground elements. Artistic atmospheric processing.",
    reinforcement: "Painterly rotoscope effect consistent in every frame. Hand-traced artistic quality throughout.",
    negativeBlock: "flat cartoon, generic anime, vibrant cel-shading, clean digital outlines, mechanical stiff movement, text overlay, watermark",
    isNonRealistic: true,
  },

  // ─── 스톱모션 ───────────────────────────────────────────────
  "스톱모션": {
    id: "stop-motion",
    nameKo: "스톱모션",
    dimensions: {
      realismLevel: "stylized",
      texture: "handcrafted miniature textures, fabric, clay, wood, felt",
      characterRendering: "handmade puppet/figure appearance, tactile material surfaces",
      backgroundRendering: "miniature set design, handcrafted diorama environments",
      motionFeel: "frame-by-frame stop-motion jitter, tactile movement",
      colorPalette: "warm handmade palette, material-driven colors",
      lighting: "warm studio lighting with visible light sources",
      cameraFeel: "miniature-scale camera, slight imprecision in movement",
      edgeTreatment: "material edges — fabric, clay, paper, visible craft imperfections",
    },
    globalStyleBlock: "Stop-motion animation with handcrafted miniature textures. Frame-by-frame movement with stop-motion jitter. Tactile material surfaces — clay, fabric, felt, wood. Warm studio lighting on miniature sets.",
    characterStyleRule: "Stop-motion puppet characters with handcrafted material surfaces. Visible tactile textures — clay, fabric, felt. Material imperfections present.",
    environmentStyleRule: "Miniature handcrafted diorama sets. Visible material construction — paper, wood, fabric backdrops. Warm studio lighting.",
    reinforcement: "Handmade material feel in every frame. Stop-motion frame jitter throughout. Craft imperfections visible.",
    negativeBlock: "smooth CGI, digital clean rendering, plastic toy look, photorealistic, flat 2D animation, text overlay, watermark",
    isNonRealistic: true,
  },

  // ─── 픽셀아트 ───────────────────────────────────────────────
  "픽셀아트": {
    id: "pixel-art",
    nameKo: "픽셀아트",
    dimensions: {
      realismLevel: "fully-illustrated",
      texture: "crisp pixel grid, blocky resolution",
      characterRendering: "pixel sprite characters, limited color per sprite",
      backgroundRendering: "pixel art backgrounds, tile-based environments",
      motionFeel: "retro game animation, limited keyframes",
      colorPalette: "limited 16-bit retro palette",
      lighting: "flat pixel lighting, dithered gradients",
      cameraFeel: "side-scroll or isometric camera, clean pixel-aligned movement",
      edgeTreatment: "crisp hard pixel edges, no anti-aliasing",
    },
    globalStyleBlock: "Pixel art 16-bit retro animation. Crisp hard pixel edges with no anti-aliasing. Limited color palette. Blocky character sprites on pixel art backgrounds.",
    characterStyleRule: "Pixel sprite characters with limited colors, blocky proportions, retro game aesthetic.",
    environmentStyleRule: "Pixel art tile-based backgrounds. Retro game environment design with limited palette.",
    reinforcement: "Consistent pixel grid in every frame. Retro 16-bit game aesthetic throughout. No smooth anti-aliased edges.",
    negativeBlock: "smooth rendering, anti-aliased edges, 3D, photorealistic, high-resolution detail, text overlay, watermark",
    isNonRealistic: true,
  },

  // ─── 잉크워시 ───────────────────────────────────────────────
  "잉크워시": {
    id: "ink-wash",
    nameKo: "잉크워시 (수묵화)",
    dimensions: {
      realismLevel: "fully-illustrated",
      texture: "rice paper texture, ink brush on paper",
      characterRendering: "ink brush stroke characters, calligraphic line weight variation",
      backgroundRendering: "sumi-e ink wash landscapes, atmospheric ink gradients",
      motionFeel: "flowing ink brush movement, contemplative pacing",
      colorPalette: "monochrome ink gradients with occasional subtle accent",
      lighting: "atmospheric ink density, white space as light",
      cameraFeel: "scroll-like panning, contemplative compositions with negative space",
      edgeTreatment: "brush stroke edges, calligraphic line weight, ink bleeding",
    },
    globalStyleBlock: "East Asian ink wash animation in sumi-e brush style. Monochrome ink gradients on rice paper texture. Calligraphic brush stroke rendering. Atmospheric ink wash with deliberate white space.",
    characterStyleRule: "Characters rendered in ink brush strokes with calligraphic line weight variation. Sumi-e figure style, not realistic.",
    environmentStyleRule: "Sumi-e ink wash landscapes. Atmospheric ink gradients on rice paper. Deliberate white space as compositional element.",
    reinforcement: "Ink wash aesthetic in every frame. Brush stroke texture visible throughout. Rice paper grain present.",
    negativeBlock: "vibrant colorful palette, digital clean rendering, photorealistic, 3D CGI, flat anime colors, text overlay, watermark",
    isNonRealistic: true,
  },

  // ─── 클레이 ─────────────────────────────────────────────────
  "클레이": {
    id: "claymation",
    nameKo: "클레이메이션",
    dimensions: {
      realismLevel: "stylized",
      texture: "smooth clay surfaces, fingerprint marks, sculptural imperfections",
      characterRendering: "clay figure proportions, sculptural faces, visible material joins",
      backgroundRendering: "clay/plasticine environments, sculptural set pieces",
      motionFeel: "claymation frame-by-frame, slight material deformation between frames",
      colorPalette: "warm clay/plasticine colors, material-driven palette",
      lighting: "warm studio lighting, soft shadows on clay surfaces",
      cameraFeel: "miniature-scale shots, studio table-top camera",
      edgeTreatment: "sculptural clay edges, fingerprint textures, material imperfections",
    },
    globalStyleBlock: "Claymation animation with smooth clay figures. Fingerprint texture on surfaces. Warm studio lighting on sculptural forms. Material imperfections visible — clay joins, subtle fingermarks.",
    characterStyleRule: "Clay figure characters with sculptural proportions. Visible clay material — fingerprint marks, material joins, smooth rounded forms.",
    environmentStyleRule: "Plasticine/clay environment elements. Sculptural set pieces under warm studio lighting.",
    reinforcement: "Clay material feel in every frame. Handmade sculptural quality throughout. Warm studio lighting consistent.",
    negativeBlock: "digital rendering, smooth CGI, photorealistic, shiny plastic, flat 2D, text overlay, watermark",
    isNonRealistic: true,
  },

  // ─── 빈티지 필름 ────────────────────────────────────────────
  "빈티지 필름": {
    id: "vintage-film",
    nameKo: "빈티지 필름",
    dimensions: {
      realismLevel: "photorealistic",
      texture: "35mm film grain, chemical processing artifacts",
      characterRendering: "realistic figures through vintage film processing",
      backgroundRendering: "real-world environments with faded analog color",
      motionFeel: "slightly degraded film motion, vintage camera stability",
      colorPalette: "faded analog palette, warm desaturated tones",
      lighting: "natural lighting with vintage film response, light leaks",
      cameraFeel: "vintage film camera, natural lens imperfections, soft vignette",
      edgeTreatment: "soft focus edges, chromatic aberration, film halation",
    },
    globalStyleBlock: "Vintage 35mm film look. Warm film grain throughout. Faded analog color palette with light leaks. Soft focus edges and chromatic aberration. Chemical processing artifacts visible.",
    characterStyleRule: "Realistic figures captured through vintage film aesthetic — warm skin tones, film grain over faces, slightly soft focus.",
    environmentStyleRule: "Real environments with vintage film color response. Warm desaturated tones, natural light leaks, analog vignetting.",
    reinforcement: "35mm film grain consistent in every frame. Analog color degradation throughout. Vintage camera characteristics maintained.",
    negativeBlock: "digital clean modern look, oversaturated colors, perfect sharpness, HDR, text overlay, watermark",
    isNonRealistic: false,
  },

  // ─── 네온 사이버펑크 ────────────────────────────────────────
  "네온 사이버펑크": {
    id: "neon-cyberpunk",
    nameKo: "네온 사이버펑크",
    dimensions: {
      realismLevel: "semi-realistic",
      texture: "wet reflective surfaces, neon light on chrome and glass",
      characterRendering: "semi-realistic figures in cyberpunk fashion, neon-lit faces",
      backgroundRendering: "neon-lit cityscapes, dark atmosphere with vivid light sources",
      motionFeel: "cinematic with neon light trails, dynamic urban motion",
      colorPalette: "dark base with vivid neon pink, blue, purple, cyan accents",
      lighting: "neon light sources, wet surface reflections, dark shadows with vivid rim light",
      cameraFeel: "cinematic urban angles, rain-slicked lens, neon reflections on camera",
      edgeTreatment: "neon glow edges, light bloom, rim lighting on forms",
    },
    globalStyleBlock: "Neon cyberpunk aesthetic. Dark atmosphere with vivid neon lights — pink, blue, purple, cyan. Wet reflective surfaces catching neon glow. Rain-slicked urban environments.",
    characterStyleRule: "Semi-realistic figures with neon-lit rim lighting, cyberpunk fashion, vivid colored reflections on skin and clothing.",
    environmentStyleRule: "Dark cyberpunk cityscapes with neon signage, wet reflective streets, atmospheric fog catching colored light.",
    reinforcement: "Neon glow consistent in every frame. Dark atmosphere with vivid neon accents maintained throughout. Wet reflective surfaces.",
    negativeBlock: "natural daylight, muted colors, pastoral setting, bright clean look, text overlay, watermark",
    isNonRealistic: false,
  },

  // ─── 미니어처 ───────────────────────────────────────────────
  "미니어처": {
    id: "tilt-shift-miniature",
    nameKo: "미니어처",
    dimensions: {
      realismLevel: "photorealistic",
      texture: "real-world miniature textures, diorama materials",
      characterRendering: "tiny figures with toy-like proportions",
      backgroundRendering: "diorama-scale environments, tilt-shift blur",
      motionFeel: "slightly sped-up time-lapse feel, miniature scale physics",
      colorPalette: "slightly saturated toy-like colors",
      lighting: "bright overhead lighting, miniature-scale shadows",
      cameraFeel: "extreme tilt-shift lens, very shallow depth of field, top-down angle",
      edgeTreatment: "tilt-shift selective focus, extreme blur in non-focal areas",
    },
    globalStyleBlock: "Tilt-shift miniature effect. Extreme shallow depth of field making everything appear diorama-scale. Toy-like proportions. Bright overhead lighting on miniature sets.",
    characterStyleRule: "Tiny toy-like figures at miniature scale, slightly saturated coloring.",
    environmentStyleRule: "Diorama-scale environments with tilt-shift blur. Everything appears like a detailed miniature model.",
    reinforcement: "Tilt-shift miniature effect consistent in every frame. Diorama scale maintained throughout. Extreme shallow depth of field.",
    negativeBlock: "normal human scale, deep focus, realistic proportions, text overlay, watermark",
    isNonRealistic: false,
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 4. 프롬프트 조립 엔진 (Prompt Assembly Engine)
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

  /** 사용자 지정 negativePrompt */
  userNegativePrompt?: string;

  /** 영상 길이 (초) — temporal beats용 */
  durationSec: number;
}

export interface AssembledPrompt {
  /** Veo에 전송할 최종 프롬프트 */
  finalPrompt: string;

  /** 디버그용 블록별 분해 */
  debug: {
    styleBlock: string;
    consistencyBlock: string;
    sceneBlock: string;
    reinforcementBlock: string;
    negativeBlock: string;
    audioBlock: string;
    wordCount: number;
    realismLevel: RealismLevel | "unknown";
    isNonRealistic: boolean;
  };
}

/**
 * 씬 프롬프트에서 내부 메타 필드 태그를 자연어로 변환.
 * SHOT_SIZE:CU → Close-up shot. 같은 식으로 모델 친화적 자연어로 풀어쓴다.
 */
function naturalizeMetaFields(prompt: string): string {
  return prompt
    // SHOT_SIZE:XXX → "XXX shot."
    .replace(/SHOT_SIZE:\s*(\w+)/gi, (_m, v) => {
      const map: Record<string, string> = {
        ECU: "Extreme close-up", CU: "Close-up", MCU: "Medium close-up",
        MS: "Medium shot", MLS: "Medium long shot", LS: "Long shot",
        WS: "Wide shot", OTS: "Over-the-shoulder", POV: "Point-of-view",
      };
      return `${map[v.toUpperCase()] || v} shot.`;
    })
    // CAMERA_ANGLE:XXX → just the value
    .replace(/CAMERA_ANGLE:\s*/gi, "Camera angle: ")
    // CAMERA_MOVEMENT:XXX → just the value
    .replace(/CAMERA_MOVEMENT:\s*/gi, "Camera ")
    // SUBJECT_BLOCKING:XXX → just the value
    .replace(/SUBJECT_BLOCKING:\s*/gi, "Subject positioned ")
    // SUBJECT:XXX → just the value
    .replace(/SUBJECT:\s*/gi, "")
    // ACTION_BEAT:XXX → just the value
    .replace(/ACTION_BEAT:\s*/gi, "Action: ")
    // BODY_SIGNAL:XXX → just the value
    .replace(/BODY_SIGNAL:\s*/gi, "Body language: ")
    // REVEALED:XXX → just the value
    .replace(/REVEALED:\s*/gi, "Newly visible: ")
    // WITHHELD:XXX → remove entirely (off-frame info, Veo can't use it)
    .replace(/WITHHELD:\s*[^.]*\.?\s*/gi, "")
    // TRANSITION_FROM_PREV:XXX → just the value
    .replace(/TRANSITION_FROM_PREV:\s*/gi, "Transition: ")
    // PREV SCENE ENDS: → just the value
    .replace(/PREV SCENE ENDS:\s*/gi, "Previous shot ends with ")
    // NEW SHOT: → just the value
    .replace(/NEW SHOT:\s*/gi, "New shot: ")
    // NEW ACTION: → just the value
    .replace(/NEW ACTION:\s*/gi, "New action: ")
    // BEHAVIORAL SHIFT: → just the value
    .replace(/BEHAVIORAL SHIFT:\s*/gi, "Behavior changes: ")
    // NEWLY REVEALED: → just the value
    .replace(/NEWLY REVEALED:\s*/gi, "Newly visible: ")
    // STILL WITHHELD: → remove entirely
    .replace(/STILL WITHHELD:\s*[^.]*\.?\s*/gi, "")
    // 정리
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
  return s;
}

/**
 * 메인 프롬프트 조립 함수.
 *
 * 프롬프트 우선순위 (위→아래):
 * 1. 전체 스타일 정체성 (globalStyleBlock)
 * 2. 캐릭터/배경 일관성 (characterStyleRule + characterConsistency)
 * 3. 장면 액션 (scenePrompt — 메타 필드 자연어 변환)
 * 4. 스타일 강화 리마인더 (reinforcement)
 * 5. 네거티브 (negativeBlock + anti-photorealism)
 * 6. 오디오 힌트
 */
export function assemblePrompt(input: PromptAssemblyInput): AssembledPrompt {
  const preset = input.animationMode ? STYLE_PRESETS[input.animationMode] : undefined;

  // ── BLOCK 1: STYLE IDENTITY ───────────────────────────────
  let styleBlock = "";
  if (preset) {
    styleBlock = preset.globalStyleBlock;
  }

  // ── BLOCK 2: CONSISTENCY (character + environment + camera) ──
  const consistencyParts: string[] = [];
  if (preset) {
    consistencyParts.push(preset.characterStyleRule);
    consistencyParts.push(preset.environmentStyleRule);
  }
  if (input.characterConsistency) {
    consistencyParts.push(input.characterConsistency);
  }
  if (input.moodLighting) {
    consistencyParts.push(input.moodLighting);
  }
  if (input.cameraDirection) {
    consistencyParts.push(input.cameraDirection);
  }
  const consistencyBlock = consistencyParts.join(" ");

  // ── BLOCK 3: SCENE CONTENT ─────────────────────────────────
  // 메타 필드를 자연어로 변환
  let sceneBlock = naturalizeMetaFields(input.scenePrompt);

  // Temporal beats 삽입
  sceneBlock = ensureTemporalBeats(sceneBlock, input.durationSec);

  // 텍스트 콘텐츠 sanitize
  sceneBlock = sanitizeTextContent(sceneBlock);

  // ── BLOCK 4: STYLE REINFORCEMENT ───────────────────────────
  let reinforcementBlock = "";
  if (preset && input.styleIntensity > 20) {
    if (input.styleIntensity <= 50) {
      // 낮은 강도: reinforcement 앞 절반만
      const parts = preset.reinforcement.split(".").map(s => s.trim()).filter(Boolean);
      reinforcementBlock = parts.slice(0, 1).join(". ") + ".";
    } else {
      // 높은 강도: 전체 reinforcement
      reinforcementBlock = preset.reinforcement;
    }
  }

  // ── BLOCK 5: NEGATIVE ──────────────────────────────────────
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

  // 중복 제거
  const seen = new Set<string>();
  const uniqueNeg = negParts.join(", ").split(",")
    .map(s => s.trim().toLowerCase()).filter(Boolean)
    .filter(s => { if (seen.has(s)) return false; seen.add(s); return true; });
  // 핵심 8개로 제한 (Veo가 너무 긴 negative는 무시)
  const negativeBlock = uniqueNeg.slice(0, 8).join(", ");

  // ── BLOCK 6: AUDIO ──────────────────────────────────────────
  const hasAudioRef = /\b(sound|audio|diegetic|ambient|noise|music|voice|speech)\b/i.test(sceneBlock);
  const audioBlock = hasAudioRef ? "" : "Diegetic sound, ambient audio.";

  // ── 조립 ───────────────────────────────────────────────────
  const blocks: string[] = [];

  // 1. 스타일 정체성 (최상단)
  if (styleBlock) blocks.push(styleBlock);

  // 2. 일관성 규칙
  if (consistencyBlock) blocks.push(consistencyBlock);

  // 3. 씬 내용
  blocks.push(sceneBlock);

  // 4. 스타일 강화
  if (reinforcementBlock) blocks.push(reinforcementBlock);

  let prompt = blocks.join(" ");

  // ── 워드 캡 (negative/audio 전에) ──────────────────────────
  const words = prompt.split(/\s+/);
  if (words.length > 150) {
    prompt = words.slice(0, 140).join(" ");
    if (!/no text overlay/i.test(prompt)) {
      prompt += ". No text overlay, no watermark";
    }
  }

  // 5. 네거티브
  if (negativeBlock && !prompt.includes("Avoid:")) {
    prompt = `${prompt}. Avoid: ${negativeBlock}`;
  }

  // 6. 오디오
  if (audioBlock) {
    prompt = `${prompt}. ${audioBlock}`;
  }

  const finalWordCount = prompt.split(/\s+/).length;

  return {
    finalPrompt: prompt,
    debug: {
      styleBlock,
      consistencyBlock,
      sceneBlock: sceneBlock.slice(0, 200) + (sceneBlock.length > 200 ? "…" : ""),
      reinforcementBlock,
      negativeBlock,
      audioBlock,
      wordCount: finalWordCount,
      realismLevel: preset?.dimensions.realismLevel ?? "unknown",
      isNonRealistic: preset?.isNonRealistic ?? false,
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
