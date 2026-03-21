/**
 * generate-cuts.ts — 3단계 파이프라인 (감독 연출 의도 기반)
 *
 * Step1: 캐릭터 시드 + 컷 아웃라인 (shotType 다양화, emotionalDelta, subjectAction 포함)
 * Step2+3: 배치별 시각 프롬프트 (전체 시퀀스 컨텍스트 + anti-repetition 강제)
 *
 * 토큰 예산:
 *   Step1: maxTokens=4096~16384  (아웃라인 전체 — 컷 수 비례, 상한 16384)
 *   Step2: maxTokens=8192~16384  (컷 1~N/2 상세)
 *   Step3: maxTokens=8192~16384  (컷 N/2+1~N 상세) — Step2와 병렬
 */
import { GeminiEnv, streamingGenerate, GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH, parseFirstJsonObject, parseFirstJsonArray } from "./_gemini-keys";
import type { VideoPromptJson, ExtendPromptJson } from "./_video-prompt-json";
import { buildSequencePlanFromCuts, validateSequencePlan } from "./_sequence-plan";
import { classifyCuts } from "./_structure-classification";
import { densifyCuts } from "./_sequence-density";
import { computeServerAutoDuration, DURATION_MIN } from "./_duration-constants";
import { extractEditorialPersona, buildEditorialPlanningRules, buildDurationAwareBeatTemplate, buildCompactEditorialSummary } from "./_editorial-persona";
import type { EditorialPersona } from "./_editorial-persona";
import { recommendMinimumCutCount, resolveCutCount, personaCutCountBias, recommendCutCountRange, resolveSegmentPlan, CUT_COUNT_MAX } from "./_sequence-density";
import { distributeRhythm, densityToPacingMode } from "./_rhythm-distribution";
import type { PacingMode } from "./_rhythm-distribution";
import { VEO_DEFAULT_MODEL, getCapability } from "./_veo-capability";
// VEO 정책: 8초, 반드시 4샷 고정
const getMaxShots = (_modelId: string, _durationSec: number) => 4;
const getMinShots = (_modelId: string, _durationSec: number) => 4;
import { reconcileShortformPlan, resolveShortformBandPolicy } from "./_shortform-rhythm";
import { runDeepAnalysis, serializePromptBrief } from "./_deep-analysis";

// ─── 스타일별 카메라/모션 렌더링 힌트 ──────────────────────────────────────────
// style-catalog.ts의 STYLE_RENDERING_OVERRIDES + CATEGORY_RENDERING_DEFAULTS를 Gemini용으로 압축
const STYLE_RENDERING_HINTS: Record<string, string> = {
  // live_action — 기본은 시네마틱 돌리/크레인이므로 별도 힌트 불필요
  "docu-handheld": "Camera: handheld with natural shake, observational distance, whip pans. Motion: reactive following, not choreographed. No stabilized gimbal.",
  "vintage-film": "Motion: slight film judder, vintage camera instability. Consistent grain level and color fade across all cuts. No mixing film stocks.",
  "neon-noir": "Environment: 70%+ dark frame, wet reflective streets. Camera: neon-reflected tracking shots, low angles, Dutch tilts. Rain-slicked gliding movement.",
  // 2d anime
  "theatrical-anime": "Camera: sweeping cinematic anime pans, fluid parallax on deep backgrounds, dramatic push-ins. Motion: high frame-count, detailed secondary motion on hair/cloth, impact frames with screen shake.",
  "watercolor-animation": "Characters: transparent watercolor washes, no opaque surfaces. Motion: wet-on-wet bleeding at motion edges, colors mix as elements overlap.",
  "pixel-art": "Camera: pixel-aligned scroll, no sub-pixel motion. Motion: retro sprite animation, limited keyframes, no motion blur, no smooth interpolation.",
  // 3d animation — 기본은 smooth 3D orbit/dolly이므로 별도 힌트 불필요
  // painting
  "east-asian-painting": "This is animated 2D sequence, NOT static artwork. Camera: smooth pans with parallax on painted layers. Motion: fluid animated movement, NOT motion poster. NO text/calligraphy/characters at any point.",
  "ink-wash": "Animated 2D ink wash sequence, NOT static scroll painting. Camera: gentle reveals through ink wash world. Motion: ink density and white space shift dynamically. NO text/calligraphy.",
  // stop_motion
  "claymation": "Motion: frame-by-frame with visible material deformation, slight jitter from manual positioning. Clay surfaces subtly reshape between frames.",
  // experimental
  "rotoscoping": "Characters: performance-derived authentic human movement with painterly overlay. Camera: organic handheld documentary feel, not perfectly stabilized.",
};

// ─── Degraded response 타입 ─────────────────────────────────────────────────
interface GenerateCutsResponse {
  ok: boolean;
  degraded: boolean;
  reason?: string;
  source: "gemini" | "deterministic-fallback";
  warnings: string[];
  characterSeeds: CharacterSeed[];
  cuts: ReturnType<typeof buildDeterministicCuts> extends (infer R)[] ? R[] : unknown[];
  sequencePlan?: unknown;
  sequenceValidation?: unknown;
  /** 실제 사용된 장면당 초 (클라이언트 동기화용) */
  secPerCut?: number;
  /** 컷 수 결정 근거 메타데이터 */
  cutCountDecisionBasis?: {
    finalCutCount: number;
    source: string;
    requestedExact?: number;
    requestedRange?: { min: number; max: number };
    densityMinimum: number;
    personaBias?: string;
    notes: string[];
  };
}

type Env = GeminiEnv;

const MODEL_OUTLINE = GEMINI_MODEL_PRO;
const MODEL_DETAIL  = GEMINI_MODEL_PRO;

// ─── Fast path 상수 ──────────────────────────────────────────────────────────
// 짧고 단순한 shortform 요청에서 step2/3를 건너뛰는 조건.
// 충분 조건: 총 시간 ≤ FAST_PATH_MAX_DURATION_SEC AND 컷 수 ≤ FAST_PATH_MAX_CUTS
const FAST_PATH_MAX_DURATION_SEC = 15;
const FAST_PATH_MAX_CUTS = 5;

// ─── Step1 토큰/타임아웃 상수 ────────────────────────────────────────────────
// 각 retry 경로에서 리터럴 값 대신 이 상수를 사용.
// 변경 시 여기만 수정하면 전 경로에 반영됨.

/** Step1 초기 요청 maxOutputTokens 상한 (Gemini 3.1 Pro max: 65536) */
const STEP1_MAX_TOKENS = 65536;
/** Higher-token retry / compact retry maxOutputTokens */
const STEP1_RETRY_MAX_TOKENS = 65536;
/** Ultra-compact retry maxOutputTokens */
const STEP1_ULTRA_MAX_TOKENS = 32768;
/** Step1 per-outline 토큰 추정 (14개 필드 경량 스키마) */
const STEP1_TOKENS_PER_OUTLINE = 400;
/** Step1 초기 요청 타임아웃 (ms) — 55초로 단축하여 빠른 fallback 전환 */
const STEP1_TIMEOUT_MS = 55_000;
/** Ultra-compact retry 타임아웃 (ms) — 25초로 단축하여 빠른 응답 */
const STEP1_ULTRA_TIMEOUT_MS = 25_000;

// ─── 감독 연출 엔진 빌더 ─────────────────────────────────────────────────────
/**
 * directorPersona + directorStyle + directorTechniques를 조합해
 * 각 컷 프롬프트에 직접 주입 가능한 "연출 엔진" 텍스트를 생성한다.
 *
 * 목적: 감독 이름을 태그로 붙이는 대신, 그 감독이 "장면을 설계하는 방식"이
 * 프롬프트 구조 자체를 지배하도록 한다.
 *
 * 규칙:
 * - 이름(감독 이름) 직접 언급 금지 → 스타일 규칙으로만 표현
 * - 각 항목은 프롬프트 생성 모델이 실제로 따를 수 있는 구체적 지시문
 */
function buildDirectorEngine(
  directorPersona: string,
  directorStyle: string,
  directorTechniques: Record<string, string> | null,
  animationMode: string,
  editorialPersona?: EditorialPersona,
): string {
  const persona = directorPersona.slice(0, 800);
  const style   = directorStyle.slice(0, 200);
  const tech    = directorTechniques ?? {};

  // 스톱모션 전용 확장: 스타일이 "스톱모션" 계열이면 추가 제약
  const isStopMotion = animationMode === "스톱모션" || animationMode === "클레이";
  const stopMotionRules = isStopMotion ? `
### Stop-Motion Aesthetic Rules (MANDATORY — prevents generic puppet look)
- Characters MUST have elongated, fragile, or theatrically exaggerated proportions — NOT cute/toy-like
- Movement MUST show intentional stop-motion stiffness: jerky hesitations, micro-tremors, deliberate weight shifts
- NO smooth plastic/CGI movement — handcrafted imperfections are REQUIRED (clay thumb prints, wire joints, slight warping)
- Set design MUST reflect character psychology — backgrounds are NOT neutral scenery but emotional projections
- Lighting: high-contrast, theatrical — NOT flat or evenly lit
- Texture: tactile, real-world materials — fabric, clay, painted wood — NOT digital clean
- Humor and darkness MUST coexist: gothic whimsy, not pure darkness, not pure cuteness
- BANNED: generic puppet animation, plastic toy look, flat cute style, meaningless gothic aesthetic without emotional core` : "";

  // 하이브리드 전용 규칙: 배경/캐릭터 레이어 분리 강제 + anti-collapse
  const isHybrid = animationMode === "하이브리드";
  const hybridRules = isHybrid ? `
### Hybrid Composite Aesthetic Rules (MANDATORY — prevents full-frame animation collapse)
- BACKGROUND LAYER: photorealistic live-action cinematic environment — real physical textures, volumetric depth, physical set lighting. Background MUST NOT become cel-shaded, animated, or illustrated.
- CHARACTER LAYER: stylized / illustrated / semi-graphic render — designed outlines, artistic character stylization visually placed INTO the real environment
- CONTRAST IS REQUIRED: background realism vs character stylization must be visibly distinct — the gap is the aesthetic, not a bug
- CINEMATIC LIGHTING: falls physically on both layers — no flat even lighting that collapses depth
- BANNED (failure states — any of these = wrong output):
  ✗ Full-frame anime look (background also animated/stylized)
  ✗ Flat cel-shaded entire scene
  ✗ Generic 2D illustration for whole frame including background
  ✗ "semi-realistic" as the only descriptor — must specify WHICH layer is real, WHICH is stylized
  ✗ Evenly stylized frame with no visible background/character contrast` : "";

  // 스타일별 카메라/모션 기본값 — 스타일 렌더링 규칙을 컷 생성에 반영
  const styleRenderingHint = STYLE_RENDERING_HINTS[animationMode] || "";

  const lines: string[] = [
    "### Director Aesthetic Engine (operational rules — NOT style tags)",
    `Persona core: ${persona}`,
    style ? `Style principle: ${style}` : "",
    tech.cameraStyle   ? `Camera philosophy: ${tech.cameraStyle}` : "",
    tech.editingStyle  ? `Editing rhythm: ${tech.editingStyle}` : "",
    tech.colorPalette  ? `Color/lighting: ${tech.colorPalette}` : "",
    tech.characterDesign ? `Character design: ${tech.characterDesign}` : "",
    tech.emotionalCore ? `Emotional core: ${tech.emotionalCore}` : "",
    styleRenderingHint ? `### Style Rendering Rules (medium-specific constraints)\n${styleRenderingHint}` : "",
    stopMotionRules,
    hybridRules,
    editorialPersona ? buildEditorialPlanningRules(editorialPersona) : "",
    "### Per-cut application (apply ALL of the above to EVERY cut):",
    "- How are characters physically exaggerated or stylized by this director's eye?",
    "- Is movement fluid, jerky, stiff, or rhythmically authored — and WHY for this scene?",
    "- Does the camera sympathize with, observe, or mock the character?",
    "- Does the set/environment mirror the character's psychological state?",
    "- How do lighting and color PUSH the emotion — not just describe it?",
    "- What makes THIS cut feel authored rather than generated?",
    "BANNED in all cuts: generic visuals, anonymous style, unnamed darkness, meaningless symmetry",
  ].filter(Boolean);

  return lines.join("\n");
}

// ─── 페르소나 빌더 ───────────────────────────────────────────────────────────

/**
 * GenerationPersona → 프롬프트 블록 변환
 * 단순 스타일 태그가 아니라 "모든 컷에 적용되는 운영 규칙"으로 주입
 */
function buildGenerationPersonaBlock(gp: {
  noSubtitles?: boolean;
  noNarration?: boolean;
  noLecturerChar?: boolean;
  subjectFirst?: boolean;
  noBackgroundClutter?: boolean;
  emotionAsAction?: boolean;
  noRepeatComposition?: boolean;
} | null | undefined): string {
  if (!gp) return "";

  const forbidden: string[] = [];
  const required: string[] = [];

  if (gp.noSubtitles)          forbidden.push("subtitle overlay, caption, on-screen lesson text, any readable text burned into frame");
  if (gp.noNarration)          forbidden.push("narration audio, voiceover, off-screen explanatory voice");
  if (gp.noLecturerChar)       forbidden.push("lecturer / presenter / host / narrator character — no one explains to camera");
  if (gp.subjectFirst)         required.push("subject-first composition: character occupies primary frame zone, background is support — NOT decoration that competes");
  if (gp.noBackgroundClutter)  required.push("minimal background: NO excessive banners, ornate patterns, wall clutter, or decorative elements that override subject");
  if (gp.emotionAsAction)      required.push("emotion ONLY through specific physical action — never abstract emotion labels, never adjectives like 'nervously' or 'sadly'");
  if (gp.noRepeatComposition)  required.push("each cut: different shot type + different body position + different emotional beat than previous cut");

  if (forbidden.length === 0 && required.length === 0) return "";

  const lines = ["## GENERATION PERSONA (전체 시퀀스 생성 규칙 — 모든 컷에 절대 적용)"];
  if (forbidden.length > 0) {
    lines.push("FORBIDDEN in every single cut:");
    forbidden.forEach(f => lines.push(`  ✗ ${f}`));
  }
  if (required.length > 0) {
    lines.push("REQUIRED in every single cut:");
    required.forEach(r => lines.push(`  ✓ ${r}`));
  }
  return lines.join("\n");
}

/**
 * CharacterPersonaInput[] → 프롬프트 블록 변환
 * subjectAction 설계 기준으로 캐릭터별 행동 규칙을 주입
 */
function buildCharacterPersonaBlock(cps: Array<{
  characterId: string;
  personality: string;
  behaviorHabits: string;
  emotionStyle: string;
  speechStyle: string;
  gestureTraits: string;
}> | null | undefined): string {
  if (!cps || cps.length === 0) return "";

  const lines = ["## CHARACTER PERSONAS (캐릭터별 행동 규칙 — subjectAction 설계 기준)"];
  for (const cp of cps) {
    lines.push(`### ${cp.characterId}`);
    if (cp.personality)    lines.push(`  PERSONALITY:  ${cp.personality}`);
    if (cp.behaviorHabits) lines.push(`  BEHAVIOR:     ${cp.behaviorHabits}`);
    if (cp.emotionStyle)   lines.push(`  EMOTION:      ${cp.emotionStyle}`);
    if (cp.speechStyle)    lines.push(`  SPEECH:       ${cp.speechStyle}`);
    if (cp.gestureTraits)  lines.push(`  GESTURE:      ${cp.gestureTraits}`);
  }
  lines.push("→ subjectAction MUST express the above traits. Actions reveal who the character IS.");
  return lines.join("\n");
}

// ─── 장면 용어 정밀화 규칙 ───────────────────────────────────────────────────
/**
 * imagePrompt / videoPrompt 생성 시 모호한 일상어를 시각 정밀 용어로 치환하도록 강제.
 * 목적: 영상 모델(VEO)이 "치과 의자" → 일반 의자, "기계" → 추상 오브젝트로 잘못 해석하는 것을 방지.
 * 원칙: form(형태) + function(기능) + material(재질) + era(시대)가 드러나는 용어 사용.
 */
const SCENE_TERM_PRECISION_BLOCK = `
## SCENE TERM PRECISION — MANDATORY (generic nouns produce wrong visuals)
RULE: Bare generic nouns are BANNED in imagePrompt / videoPrompt.
Every prop / space / equipment / object MUST reveal FORM + FUNCTION + MATERIAL (+ ERA if historical).

### Medical / Dental
BANNED → REQUIRED replacement:
- "dental chair" / 치과 의자 → "reclining dental unit chair: padded vinyl headrest, chrome articulated armrests, attached rubber suction hose at side"
- "dental machine" / 치과 기계 → specify ONE: "overhead tungsten exam lamp on swivel arm" | "foot-pedal belt-driven drill unit with flexible handpiece" | "floor-mounted suction canister with rubber hose" | "hinged instrument tray holding mirror, cotton rolls, extraction forceps"
- "hospital bed" / 병원 침대 → "padded leather examination table" | "iron-frame recovery cot with canvas mattress" | "tilt-adjustable surgical table"
- "clinic" / 진료실 → "dental operatory room" | "late 19th-century dental surgery: bare-plank floor, glass-front cabinet of instruments" | "tiled examination room with ceiling-mounted lamp"
- "tools / equipment" / 도구·장비 → name each item: "steel dental mirror, cotton pellets, ivory-handled extraction forceps on metal tray"
- "old hospital" / 옛날 병원 → "1890s clinic interior: whitewashed plaster walls, gas-bracket wall lamp, wooden instrument cabinet with beveled glass doors"

### Advertising / Historical Props
BANNED → REQUIRED replacement:
- "advertisement" / 광고 → "hand-painted wooden panel on brick wall" | "lithographic street illustration tacked to post" | "carved wooden bracket hung above doorway"
- "sign / 간판" → "gilded hanging wooden panel on wrought-iron bracket" | "weathered wooden plaque over entrance" | "mounted facade panel with iron frame"
- "promotional / 홍보" → "street barker standing on wooden crate, gesturing to crowd" | "market-square public demonstration with illustrated board"
- "flyer / pamphlet" / 전단 → "single-leaf letterpress broadside, bold woodcut typeface" | "folded paper handbill with hand-drawn illustration"
- "poster" / 포스터 → "hand-printed broadside pinned to wooden post" | "lithographed circus-style advertisement with colored inks"

### Space & Set
BANNED → REQUIRED replacement:
- "room" / 방 → specify: "narrow dental operatory, single sash window, instrument cabinet along one wall" | "cramped waiting area with long wooden bench against plaster wall" | "back-office consultation room with rolltop desk"
- "wall" / 벽 → "whitewashed lime-plaster wall, hairline cracks visible" | "dark tongue-and-groove wood paneling with framed diplomas" | "exposed red brick wall"
- "floor" / 바닥 → "worn wide-plank hardwood floor, gap-jointed" | "black-and-white octagonal tile floor, grout lines visible" | "bare concrete floor"
- "desk" / 책상 → "oak consultation desk with green baize writing surface and brass inkwell" | "metal instrument table on locking rubber casters"
- "window" / 창문 → "tall double-hung sash window, lower pane frosted glass" | "street-facing display window with gold-leaf lettering on glass"
- "light / lamp" / 조명·램프 → "gas mantle wall sconce, warm amber flicker" | "bare carbon-filament Edison bulb on pendant cord" | "oil lamp with glass chimney on desk surface"

### Props & Objects
BANNED → REQUIRED replacement:
- "bottle" / 병 → "amber glass medicine bottle, cork stopper, paper label with printed text" | "tall cylindrical apothecary jar, glass stopper, colored liquid inside"
- "paper / document" / 종이·서류 → "yellowed broadside newsprint" | "letterpress-printed receipt on carbon paper" | "handwritten ledger page, iron-gall ink entries"
- "money" / 돈·돈봉투 → "silver dollar coin placed face-up on oak desktop" | "folded paper banknote slid across wooden counter surface"
- "bag" / 가방 → "black leather physician's satchel with brass clasp and carry handle" | "wicker basket with hinged lid" | "canvas drawstring pouch"
- "chair" / 의자 → always specify type: "wooden spindle-back chair" | "upholstered armchair with turned legs" | "metal folding chair" — NEVER just "chair"

### Character Behavior (translate emotion → physical action ONLY)
BANNED → REQUIRED replacement:
- "scared / 겁먹음" → "jaw locked shut, shoulders pulling back from armrests, knuckles whitening on grip"
- "nervous / 불안" → "eyes darting toward exit, foot pressing rhythmically on footrest, throat swallowing visibly"
- "in pain / 아프다" → "neck tendons visibly tensing, sharp breath pulling shoulders upward, fingers pressing hard into padded surface"
- "reluctant / 주저함" → "body weight shifted backward in seat, hands drawing inward toward lap, chin lowering"
- "suspicious / 의심" → "chin dropping, eyes sliding laterally without head movement, hands going still mid-gesture"
- "relieved / 안도" → "jaw releasing, shoulders dropping on slow controlled exhale, grip on surface loosening"

FINAL RULE: If a prop/space/equipment cannot be described without a generic noun (chair, machine, room), ADD at minimum: material + one distinguishing physical feature.`;

// ─── 스타일/지역 맵 (모듈 레벨: 요청마다 재생성 방지) ───────────────────────
const VIDEO_STYLE_MAP: Record<string, string> = {
  // ═══ live_action ═══
  "cinematic-realism": "Photorealistic cinematic live-action. Natural lighting with dramatic shadows. Filmic depth of field with anamorphic lens characteristics. Subject-focused composition.",
  "docu-handheld":     "Documentary-style handheld footage. Natural available lighting. Candid framing with observational distance. Subtle camera shake adding authenticity.",
  "commercial-ad":     "High-end commercial cinematography. Perfect studio lighting with soft diffusion. Ultra-clean composition with product-hero framing. Smooth dolly and crane movements.",
  "vintage-film":      "Vintage 35mm film look. Warm film grain throughout. Faded analog color palette with light leaks. Soft focus edges and chromatic aberration.",
  "neon-noir":         "Neon noir aesthetic. Dark atmosphere with vivid neon lights — pink, blue, purple, cyan. Wet reflective surfaces catching neon glow. Rain-slicked urban environments.",
  "vhs-retro":         "VHS analog video aesthetic. Visible scan lines and tracking artifacts. Color bleeding and chromatic distortion. Warm oversaturated colors with CRT screen glow.",
  "sf-futuristic":     "Sci-fi futuristic city. Towering megastructures with holographic displays. Clean metallic and glass surfaces. Volumetric fog with neon accents. Cinematic widescreen.",
  "gothic-horror":     "Gothic horror atmosphere. Deep shadows with minimal light — candles, moonlight, lightning. Desaturated cold blue-grey palette. Fog through decayed architecture.",
  "실사":              "photorealistic cinematic 4K, subject-focused composition, natural light and shadow",
  "빈티지 필름":       "vintage 35mm film, warm grain, faded colors, 1970s cinema, subject-centered frame",
  "네온 사이버펑크":   "neon noir, glowing neon accent lights on subject, rain-wet street, holographic haze",
  // ═══ animation_2d ═══
  "tv-anime":          "2D anime animation style. Cel-shaded illustration with clean outlines and vibrant flat colors. Anime character proportions with expressive features. Dynamic camera angles with speed lines.",
  "theatrical-anime":  "Theatrical-quality anime. Extremely detailed hand-drawn animation with rich color depth. Lush painted backgrounds with cinematic lighting. Fluid character animation.",
  "storybook-anime":   "Storybook animation style. Soft pastel palette with gentle gradients. Picture-book illustration quality with round friendly character designs. Fairy-tale atmosphere.",
  "painted-2d":        "Fully painted animation — every frame is a hand-painted oil/watercolor painting in motion. Expressive visible brushwork on all surfaces. Thick impasto highlights, soft wet-on-wet blending.",
  "watercolor-animation": "Watercolor animation. Transparent color washes flowing and bleeding into each other. White paper showing through translucent layers. Soft undefined edges.",
  "ink-drawing-anime": "Ink line drawing animation. Bold expressive pen strokes with varying line weight. Cross-hatching for shadows. Black ink on white paper. Architectural precision in environments.",
  "webtoon-motion":    "Korean webtoon motion comic style. Clean digital line art with solid flat coloring. Dramatic panel-to-panel transitions. Manhwa proportions. Speed lines and impact frames.",
  "cutout-anime":      "Paper cutout animation. Flat paper shapes with visible cut edges and layered depth. Hinged joint movement. Textured paper surfaces — kraft, cardstock. Craft aesthetic.",
  "2D 애니":           "2D cel-shaded animation, hand-drawn character with expressive linework, stylized but not rigidly flat, subject-focused frame",
  "수채화 애니":       "watercolor animation, soft translucent washes, pastel tones, gentle bleeding edges, subject as focal point",
  // ═══ animation_3d ═══
  "pixar-style":       "Pixar-style 3D animation. Smooth warm skin tones. Expressive stylized character designs. Rich soft lighting. Cinematic depth of field.",
  "dreamworks-style":  "DreamWorks-style 3D animation. Bold exaggerated character proportions. Dynamic action-oriented poses. Saturated vivid color palette with dramatic lighting. Energetic camera.",
  "stylized-3d":       "Stylized 3D animation with toon shading. Bold outlines over 3D geometry. Flat color zones with sharp shadow edges — cel-shaded look in 3D. Vibrant cartoon palette.",
  "semi-real-3d":      "Semi-realistic 3D animation. Anime-influenced character proportions within detailed realistic environments. Cinematic lighting with ray-traced reflections.",
  "low-poly-3d":       "Low-poly 3D art style. Visible geometric facets on all surfaces. Flat shading with minimal texture. Clean geometric design. Peaceful minimalist aesthetic.",
  "miniature-3d":      "Tilt-shift miniature effect. Extreme shallow depth of field making everything appear diorama-scale. Toy-like proportions. Bright overhead lighting on miniature sets.",
  "game-cinematic-3d": "AAA game cinematic quality 3D rendering. Unreal Engine 5 level detail. Ray-traced global illumination. High-fidelity character models. Epic dramatic camera choreography.",
  "하이브리드":        "Semi-realistic 3D animation. Anime-influenced characters in photorealistic environments. Cinematic lighting with ray-traced reflections.",
  "미니어처":          "tilt-shift miniature photography, tiny diorama, shallow depth of field, handcrafted miniature set",
  // ═══ painting ═══
  "watercolor":        "Watercolor painting style. Transparent paint washes with visible water bleeding. White paper texture through translucent layers. Soft edges. Delicate light through paint transparency.",
  "oil-painting":      "Oil painting style with thick impasto brushwork. Visible palette knife and brush texture. Rich opaque color mixing on canvas. Dramatic chiaroscuro lighting.",
  "gouache":           "Gouache painting style. Opaque matte color layers with subtle brush texture. Flat color areas with soft blending. Rich saturated matte palette. Illustrative composition.",
  "pastel":            "Pastel crayon art style. Soft chalky texture on textured paper. Gentle blending with visible grain. Warm diffused color. Dreamy atmospheric quality.",
  "east-asian-painting": "2D animated sequence in East Asian painting-inspired art style. Brush-and-ink influenced rendering. Muted mineral pigment palette with ink wash gradients. Rice paper surface hint.",
  "ink-wash":          "2D animated sequence in sumi-e ink wash art style. Monochrome ink gradients. Varying ink density with deliberate white space. Rice paper texture. Dynamic 2D scene.",
  "inkwash-painting":  "Western ink wash painting style. Fluid black ink diluted to grey tones. Expressive wet brush strokes. Dramatic contrast between dense black and diluted washes.",
  "van-gogh-painted":  "Van Gogh post-impressionist style. Swirling energetic brushstrokes with thick impasto. Vivid complementary colors — deep blues against bright yellows. Starry night dynamic.",
  "editorial-illustration": "Editorial illustration style. Bold graphic compositions with strong silhouettes. Limited impactful color palette — 3-4 key colors. Conceptual visual metaphors.",
  "storybook-illustration": "Children's storybook illustration. Warm gentle color palette with watercolor or gouache textures. Whimsical character designs. Magical atmosphere. Hand-crafted quality.",
  "잉크워시":          "East Asian ink wash painting, sumi-e brush strokes, black ink on rice paper, negative space around subject",
  // ═══ stop_motion ═══
  "claymation":        "Claymation animation with smooth clay figures. Fingerprint texture on surfaces. Warm studio lighting. Material imperfections — clay joins, fingermarks. Stop-motion jitter.",
  "paper-collage":     "Paper collage stop-motion. Cut paper layers with visible scissors-cut edges. Textured paper — newspaper, kraft, magazine clippings. Shadow between layers creating depth.",
  "felt-craft":        "Felt craft stop-motion. Soft felt fabric texture on all characters. Visible stitching and fabric seams. Button eyes and embroidered details. Cozy handmade aesthetic.",
  "wooden-puppet":     "Wooden puppet stop-motion. Carved wooden characters with visible wood grain. Marionette-like jointed movement. Warm wood tones. Miniature wooden stage sets.",
  "paper-puppet":      "Paper puppet shadow theater animation. Silhouette characters against backlit translucent screen. Intricate paper-cut details in shadow. Traditional shadow puppet articulation.",
  "miniature-diorama": "Stop-motion with handcrafted miniature textures. Frame-by-frame movement with stop-motion jitter. Tactile material surfaces — clay, fabric, felt, wood. Miniature diorama environments.",
  "스톱모션":          "stop-motion animation, handcrafted tactile textures, frame-by-frame stiffness, real-world material imperfections, subject-first",
  "클레이":            "claymation, smooth clay figures, visible fingerprint texture, studio lighting, clay-built environment",
  // ═══ retro_game ═══
  "pixel-art":         "Pixel art 16-bit retro animation. Crisp hard pixel edges with no anti-aliasing. Limited color palette. Blocky character sprites on pixel art backgrounds. Dithered gradients.",
  "16bit-jrpg":        "16-bit JRPG pixel art style. Super Nintendo era composition. Rich detailed pixel backgrounds with parallax scrolling. Chibi character sprites. 256-color palette with dithering.",
  "8bit-arcade":       "8-bit NES/Famicom era pixel graphics. Extremely limited color palette — max 4 colors per sprite. Chunky large pixels. Simple geometric shapes. Arcade game aesthetic.",
  "ps1-lowpoly":       "PlayStation 1 era low-poly 3D graphics. Visible polygon edges with warped texture mapping. Affine texture distortion. Limited texture resolution. Early 3D game aesthetic.",
  "90s-game-cutscene": "90s pre-rendered CG cutscene style. Early computer graphics with Gouraud shading. Dramatic camera rotations. Metallic chrome reflective surfaces. Lens flare effects.",
  "visual-novel":      "Visual novel game style. Static or subtly animated character portraits on illustrated backgrounds. Clean anime-style character art. Ambient mood-dependent lighting.",
  "픽셀아트":          "pixel art 16-bit retro game aesthetic, clean pixel edges, limited color palette, character-centered composition",
  // ═══ experimental ═══
  "rotoscoping":       "Rotoscoped 2D animation. Performance-derived fluid movement with painterly overlay. Hand-traced outlines over realistic motion. Organic handheld feel with artistic enhancement.",
  "mixed-media-collage": "Mixed media collage animation. Layered photography, illustration, fabric texture, printed material. Cut-and-paste aesthetic with visible edge seams between media.",
  "live-paint-overlay": "Live-action footage with hand-painted overlay. Real photographic base beneath artistic paint strokes. Animated brush marks moving over filmed scenes. Dual reality — photography and painting.",
  "docu-illustrated":  "Documentary footage with animated illustrated overlay. Real-world documentary base with animated line drawings, diagrams, infographic elements floating over live footage.",
  "2d-3d-hybrid":      "2D-3D hybrid animation. Hand-drawn 2D animated characters within photorealistic 3D environments. Clear visual distinction between character and environment rendering.",
  "surreal-composite": "Surreal composite visual. Dream-logic spatial composition — impossible architecture, gravity-defying objects. Scale distortion. Melting, morphing, transforming elements.",
  "로토스코핑":        "rotoscoped 2D animation over live-action performance, movement from real human motion, traced-from-live-motion rhythm",
};

const REGION_FLAVOR_MAP: Record<string, string> = {
  "한국":   "Korean urban-rural aesthetic",
  "일본":   "Japanese traditional-modern",
  "중국":   "Chinese cinematic grandeur",
  "유럽":   "European classical architecture",
  "미국":   "American cinematic diverse",
  "인도":   "Indian vibrant colors",
  "중동":   "Middle Eastern desert ancient",
  "동남아": "Southeast Asian tropical",
  "중남미": "Latin American magical realism",
  "아프리카":"African warm earth tones",
  "오세아니아":"Oceanian vast wilderness",
};

// ─── 콘텐츠 모드 감지 ────────────────────────────────────────────────────────
/**
 * 역사적 인물/사건 중심 콘텐츠 → "dramatized_reenactment" 강제
 * "교훈", "마케팅 인사이트" 같은 교육적 메시지가 있어도 explainer로 분류하지 않음.
 * 기준: 역사 신호가 하나라도 있으면 극영화 재연 모드.
 */
function detectContentMode(storyText: string): "dramatized_reenactment" | "general" {
  const historicalSignals = [
    /역사[적]?|역사[적]?\s*인물|역사[적]?\s*사건/,
    /\d{3,4}년[대]?|세기|왕조|시대/,
    /실제\s*(사례|인물|사건)|실화|재연/,
    /마케팅\s*(사례|역사|전략)|광고\s*역사/,
    /의사|치과|병원|의원|클리닉|surgeon|dentist/i,
    /Painless|Parker|Blackwell|Joshi|Kellogg|patent medicine/i,
    // 대체역사 / 만약에 역사 감지
    /만약[에]?\s|대체\s*역사|가정[형]?\s*역사|if\s.*had\s/i,
    /제국|왕조|멸망|전쟁|혁명|독립|통일|분단|식민/,
    /로마|몽골|나폴레옹|오스만|조선|고구려|메이지|냉전/,
  ];
  return historicalSignals.some(r => r.test(storyText))
    ? "dramatized_reenactment"
    : "general";
}

// ─── 내부 타입 ────────────────────────────────────────────────────────────────

interface CharacterSeed {
  id: string;
  label: string;
  appearance: string;
  appearanceKo: string;
}

/** 컷 카테고리: 피사체 중심 분류 */
type ShotCategory = "character-driven" | "environment" | "object-detail" | "map-graphic" | "transition-atmosphere";
/** 캐릭터 역할: 컷 내 인물의 비중 */
type CharacterRole = "protagonist" | "background" | "silhouette" | "partial" | "absent";

interface CutOutline {
  cutNumber: number;
  sceneKo: string;         // 한국어 장면 요약 ≤35자
  narrativeFunction?: string;  // English ≤8 words — 이 시퀀스의 서사 역할 (e.g. "reveal cause of failure")
  emotion: string;         // English emotion keyword
  emotionalDelta: string;  // "prev→this" e.g. "calm→tense" (CUT1: "opening→[emotion]")
  purpose: string;         // establish | develop | climax | resolve
  shotType: string;        // ECU | CU | MCU | MS | MLS | LS | WS | OTS | POV (opening shot of scene)
  cameraMovement: string;  // motivated camera movement (WHY it moves)
  subjectAction: string;   // English ≤15w — concrete physical action (no "stands"/"watches")
  transitionHint: string;  // 한국어 ≤15자
  shotCategory: ShotCategory;   // 이 씬의 피사체 중심 유형
  characterRole: CharacterRole;  // 이 씬에서 캐릭터의 역할
  // ── 즉시 인식 가능성 (Instant Readability) ──────────────
  locationCue: string;     // English ≤8w — 보자마자 "어디인지" 알 수 있는 핵심 시각 단서 (예: "dental chair and overhead lamp", "empty restaurant dining hall")
  situationCue: string;    // English ≤8w — 보자마자 "무슨 상황인지" 알 수 있는 단서 (예: "no patients, lights on but empty", "long line outside door")
  emotionalAnchor: string; // English ≤8w — 감정/갈등이 집약되는 시각 요소 (예: "doctor slumps alone at desk", "crumpled rejection letter on floor")
  // ── Scene progression — Step1에서는 optional, Step2/3에서 locationCue/situationCue/emotionalAnchor 기반으로 자동 생성 ──
  sceneBeat1?: string;     // English ≤12w — LOCATION beat (Step1에서 생략 가능)
  sceneBeat2?: string;     // English ≤12w — SITUATION beat (Step1에서 생략 가능)
  sceneBeat3?: string;     // English ≤12w — EMOTION beat (Step1에서 생략 가능)
  endHook?: string;        // English ≤10w — 다음 씬으로 이어지는 시각적 고리 (Step1에서 생략 가능)
}

interface MultiShotItem {
  index: number;
  prompt: string;
  duration: string;
  role?: string;
}

interface CutDetail {
  cutNumber: number;
  imagePrompt: string;
  endImagePrompt: string;
  videoPrompt: string;
  extendPrompt: string;
  cameraDirection: string;
  moodLighting: string;
  multiShot?: MultiShotItem[];
}

// ─── ShotRole 자동 추론 (서버사이드 — src/lib/multishot-validation.ts 동기화) ──

type ShotRoleServer = "establish" | "develop" | "peak" | "resolve" | "insert" | "transition";

// ─── 멀티샷 최소 수 강제 보충 (공통 함수) ────────────────────────────────
// Gemini/deterministic fallback이 최소 샷 수를 미달하면 강제 보충.
// 모든 finalizedCuts 경로 (정상, deterministic fallback)에서 호출.
const ROLE_PATTERNS_REPAIR: Record<number, ShotRoleServer[]> = {
  2: ["establish", "resolve"],
  3: ["establish", "develop", "resolve"],
  4: ["establish", "develop", "peak", "resolve"],
  5: ["establish", "transition", "develop", "peak", "resolve"],
  6: ["establish", "transition", "develop", "insert", "peak", "resolve"],
};

function repairMultiShotMinimums(cuts: Array<{ cutNumber: number; durationSec: number; videoPrompt?: string; sceneDescription?: string; multiShot?: MultiShotItem[] }>): void {
  for (const fc of cuts) {
    const dur = fc.durationSec;
    const minRequired = getMinShots(VEO_DEFAULT_MODEL, dur);
    const existingShots: MultiShotItem[] = Array.isArray(fc.multiShot) ? fc.multiShot : [];

    if (minRequired >= 2 && existingShots.length < minRequired) {
      console.warn(`[generate-cuts] ⚠️ cut ${fc.cutNumber} (${dur}s): multiShot ${existingShots.length}개 < 최소 ${minRequired}개 → auto-repair`);

      const targetCount = Math.min(minRequired, getMaxShots(VEO_DEFAULT_MODEL, dur));
      const roles = ROLE_PATTERNS_REPAIR[targetCount] ?? ROLE_PATTERNS_REPAIR[4]!;

      const baseDur = Math.floor(dur / targetCount);
      const remainder = dur - baseDur * targetCount;
      const durations = roles.map((_, i) => i < remainder ? baseDur + 1 : baseDur);

      const basePrompt = fc.videoPrompt || fc.sceneDescription || "";
      const roleDirective: Record<ShotRoleServer, string> = {
        establish: "WS establishing shot. Full environment visible — show the specific location and key objects that identify WHERE this is",
        transition: "MS, camera shifts angle. New perspective revealing depth — different framing from previous shot",
        develop: "MS/MCU, subject in action. Show specific movement or behavior — what the character DOES (verb required)",
        insert: "ECU, extreme close-up on critical detail. Dramatic scale jump — texture, hands, object surface",
        peak: "CU, most intense moment. Character's physical reaction at emotional peak — body language, not emotion labels",
        resolve: "WS/CU, visual closure. Tension releases — the aftermath, result, or changed state of the scene",
      };

      const repairedShots: MultiShotItem[] = roles.map((role, i) => {
        if (i < existingShots.length) {
          return { index: i + 1, prompt: existingShots[i].prompt, duration: String(durations[i]), role };
        }
        return {
          index: i + 1,
          prompt: `[Shot ${i + 1}/${targetCount} — ${role}] ${roleDirective[role]}. ${basePrompt.slice(0, 120)}`,
          duration: String(durations[i]),
          role,
        };
      });

      (fc as Record<string, unknown>).multiShot = repairedShots;
    }
  }
}

function inferMultiShotRole(index: number, total: number): ShotRoleServer {
  if (total <= 1) return "establish";
  if (index === 0) return "establish";
  if (index === total - 1) return "resolve";
  const midPoint = Math.floor(total / 2);
  if (index === midPoint) return "peak";
  return "develop";
}

// ─── JSON 파싱 유틸 ───────────────────────────────────────────────────────────

function safeParseObj(text: string): Record<string, unknown> | null {
  const t = text.trim();
  try { return JSON.parse(t) as Record<string, unknown>; } catch { /* */ }
  return parseFirstJsonObject(t);
}

function safeParseArr(text: string): unknown[] | null {
  const t = text.trim();
  try {
    const v = JSON.parse(t);
    if (Array.isArray(v)) return v;
    const r = v as Record<string, unknown>;
    if (Array.isArray(r.cuts)) return r.cuts as unknown[];
    if (Array.isArray(r.details)) return r.details as unknown[];
  } catch { /* */ }
  return parseFirstJsonArray(t) ?? ((() => {
    // If array extraction fails, try object and extract array fields
    const obj = parseFirstJsonObject(t);
    if (obj) {
      if (Array.isArray(obj.cuts)) return obj.cuts as unknown[];
      if (Array.isArray(obj.details)) return obj.details as unknown[];
    }
    return null;
  })());
  return null;
}

// ─── Beat 타이밍 헬퍼 (duration-aware) ─────────────────────────────────────
// 기존: secPerCut >= 8 이분법 → 10~15초 구간에서 Beat3가 "5s~8s"로 고정되던 문제 수정.
// 수정: 4단계 구간별 비트 분배로 전체 duration을 커버.
function beatTimings(sec: number): { b1: string; b2: string; b3: string } {
  if (sec <= 5)  return { b1: "0s~1s",  b2: "1s~3s",  b3: `3s~${sec}s` };
  if (sec <= 8)  return { b1: "0s~2s",  b2: "2s~5s",  b3: `5s~${sec}s` };
  if (sec <= 12) return { b1: "0s~3s",  b2: "3s~7s",  b3: `7s~${sec}s` };
  return               { b1: "0s~4s",  b2: "4s~9s",  b3: `9s~${sec}s` };
}

// ─── STEP 1: 캐릭터 시드 + 컷 아웃라인 ──────────────────────────────────────

async function step1Outlines(
  env: GeminiEnv,
  storyText: string,
  directorNameKo: string,
  directorPersona: string,
  cutCount: number,
  secPerCut: number,
  contentMode: "dramatized_reenactment" | "general",
  generationPersonaBlock: string,
  characterPersonaBlock: string,
  editorialPlanningBlock: string,
  scriptAnalysisHint?: string,
  continuityBlock?: string,
  deepAnalysisBriefBlock?: string,
  modelOverride?: string,
): Promise<{ characterSeeds: CharacterSeed[]; outlines: CutOutline[] }> {

  // 영화적 샷 진행 — 첫 장면은 반드시 공간/분위기 설정 (WS 또는 LS), 이후 점진적 클로즈업
  const shotGuide = cutCount <= 5
    ? "SCENE1=WS(establishing:open-space+atmosphere) → SCENE2=MS(approach:who-is-here) → SCENE3=CU(focus:emotional-peak) → SCENE4=OTS(reaction:other-pov) → SCENE5=MCU(intimate-close)"
    : cutCount <= 8
      ? "SCENE1=WS(establishing) → SCENE2=MS(approach) → SCENE3=CU(focus) → SCENE4=OTS(reaction) → SCENE5=MCU(close) → SCENE6=ECU(extreme-detail) → SCENE7=LS(breathing-room:contrast) → SCENE8=CU(final-focus)"
      : "SCENE1=WS(establishing) → SCENE2=MS(approach) → SCENE3=CU(focus) → SCENE4=OTS(reaction) → SCENE5=MCU(close) → SCENE6=ECU(extreme-detail) → SCENE7=LS(contrast:breathe) → SCENE8=POV(subjective) → SCENE9=CU(reveal) → SCENE10=MS(resolution)";

  // 콘텐츠 모드별 형식 규칙 블록
  const formatRules = contentMode === "dramatized_reenactment" ? `
## 콘텐츠 형식: 쇼츠용 내레이션 스크립트의 시각화 (이 규칙이 모든 설계를 지배한다)

### 핵심 원칙
- 입력 스크립트는 "쇼츠용 내레이션 대본"이다 — 희곡/극본이 아니다
- 각 줄이 하나의 영상 컷/내레이션 비트에 대응한다
- 장면 설계는 내레이션의 리듬과 정보 전달을 시각적으로 보조하는 것이 목적

### 절대 금지
- 강사(lecturer), 발표자(presenter), 해설자(host/narrator) 캐릭터 생성 금지
- 카메라를 향해 설명하는 인물 금지
- "교훈:", "마케팅 포인트:" 같은 설명 단락으로 끝나는 장면 금지

### characterSeeds 규칙
✅ 역사적 실존 인물 또는 역할 기반 캐릭터 (왕, 장군, 의사, 학자, 상인, 군중, 병사 등)
✅ 내레이션이 언급하는 인물의 행동/상황을 시각화하는 캐릭터
✅ 대체역사 가정의 경우: 실제 역사적 맥락의 인물을 시각화
❌ 강사, 발표자, 해설자, 내레이터, 진행자

### 장면 설계 방향
- 내레이션 텍스트의 팩트를 시각적 행동으로 변환
- 대화극이 아닌, 행동과 상황으로 정보를 보여주기
- 교훈적 메시지 또는 대체역사 가정은 상황 아이러니로 드러내기
` : `
## 콘텐츠 형식: 일반 영상 장면

### 금지
- 강사/발표자/해설자 캐릭터 자동 생성 금지
- 모든 대사는 한국어로 작성
`;

  // ── Step1 프롬프트: 경량 아웃라인 전용 ────────────────────────────────────
  // 목적: characterSeeds + outlines JSON만 빠르게 생성
  // 무거운 규칙(SCENE_TERM_PRECISION, 감정→행동 상세 예시)은 step2/3에서 적용
  // storyText는 800자로 제한 (토큰 예산 절약)
  const storyExcerpt = storyText.slice(0, 800);

  const prompt = `당신은 ${directorNameKo} 감독 스타일로 장면을 구조화하는 시나리오 분석가입니다.
${contentMode === "dramatized_reenactment" ? "콘텐츠: 역사/대체역사 쇼츠 내레이션 시각화. 강사/해설자 캐릭터 생성 금지. 역사적 인물/역할 기반 캐릭터만." : "콘텐츠: 일반 영상. 강사/해설자 금지."}
${generationPersonaBlock ? generationPersonaBlock.slice(0, 300) + "\n" : ""}${editorialPlanningBlock ? editorialPlanningBlock.slice(0, 500) + "\n" : ""}감독 핵심: ${directorPersona ? directorPersona.slice(0, 300) : "강한 시각 개성"}
조건: ${secPerCut}초/시퀀스, 총 ${cutCount}시퀀스. 각 시퀀스는 VEO 1회 생성 단위(8초). 시퀀스 내부 멀티샷은 별도 처리.

## ⚠️ 최우선 원칙: 서사 기능 우선 (Narrative Function First)
장면 설계 순서: 의미 분석 → 장면 기능 결정 → 시각화
절대로 "명사/배경/소품 키워드"에서 시작하지 마라. "이 텍스트가 무슨 이야기를 하는가"에서 시작하라.

### 1단계: 입력 텍스트의 서사 구조 파악
먼저 이야기를 읽고 아래를 판별하라:
- 이 텍스트의 유형: 사건 서사 / 설명·논지 / 역사·인과 / 감정·회상 / 정보 전달 / 추상 에세이
- 핵심 주장 또는 핵심 변화가 무엇인가
- 인과 관계: 무엇 때문에 무엇이 일어나는가
- 전환점: 어디서 상황/관점/감정이 바뀌는가

### 2단계: 각 시퀀스의 서사 기능 결정
각 시퀀스가 전체 이야기에서 맡는 기능을 먼저 결정하라:
- 배경 설정 (어떤 세계/상황인가)
- 문제 제기 (무엇이 잘못되었거나 부족한가)
- 원인 제시 (왜 이런 일이 일어나는가)
- 변화 발생 (무엇이 달라지는가)
- 갈등/긴장 (무엇이 충돌하는가)
- 결과/귀결 (어떤 결과가 나타나는가)
- 반전 (기대와 다른 결과)
- 결론/의미 (이 이야기가 남기는 것)
시퀀스는 이 서사 기능 단위로 분할하라. 사물/장소 단위로 분할하지 마라.

### 3단계: 서사 기능을 시각적으로 표현
서사 기능이 결정된 후에 시각화하라:
- "문제 제기" → 문제의 결과가 보이는 구체적 장면 (빈 가게, 쌓인 서류, 닫힌 문)
- "원인 제시" → 원인이 작동하는 장면 (경쟁자의 행동, 정책 변화, 자연재해)
- "변화 발생" → 이전과 이후의 대비가 보이는 장면
- "결과/귀결" → 결과의 증거가 보이는 장면
상징/분위기 샷은 서사 기능을 보조할 때만 사용. 서사를 대체하지 마라.

## 시나리오
${storyExcerpt}
${scriptAnalysisHint ? `\n## 대본 사전 분석 (참고용 — 이 구조를 기반으로 시퀀스를 설계하되, 감독 스타일을 적용)\n${scriptAnalysisHint.slice(0, 600)}\n` : ""}${continuityBlock ? `\n${continuityBlock}\n` : ""}${deepAnalysisBriefBlock ? `\n${deepAnalysisBriefBlock}\n` : ""}
## 출력 JSON 스키마

characterSeeds (최대 3명):
- id: "char-1" 등
- label: 한국어 역할명
- appearance: 영어 ≤40 words (성별/나이/헤어/의상/피부톤만)
- appearanceKo: ≤25자

outlines (정확히 ${cutCount}개 — 각 항목은 ${secPerCut}초짜리 시퀀스):

## 시각화 기준: "즉시 인식 가능성" (Instant Readability)
시청자가 장면을 보고 바로 이해해야 합니다:
- "아, 여기가 어디구나" (장소)
- "아, 이런 상황이구나" (상황)
- "아, 이 사람이 이런 상태구나" (감정)
단, 이 세 가지는 서사 기능을 시각으로 번역한 결과여야 한다.
"서사와 무관한 멋있는 비주얼"은 금지.

각 씬 설계 시 반드시 아래를 먼저 정의하세요:
1. narrativeFunction: 이 시퀀스가 전체 이야기에서 맡는 역할 (영어 ≤8 words — 예: "reveal cause of failure", "show consequence of decision", "establish world before change")
2. locationCue: 서사 기능을 뒷받침하는 장소 단서 (영어 ≤8 words)
3. situationCue: 서사 기능을 뒷받침하는 상황 증거 (영어 ≤8 words)
4. emotionalAnchor: 감정이 집약되는 시각 포인트 (영어 ≤8 words)

- cutNumber: 순번
- sceneKo: ≤30자
- narrativeFunction: 영어 ≤8 words — 이 시퀀스가 전체 이야기에서 맡는 서사 역할 (예: "reveal cause of decline", "show turning point decision", "contrast before and after")
- emotion: 영어 키워드
- emotionalDelta: "이전→현재" (CUT1: "opening→[emotion]")
- purpose: establish | develop | climax | resolve (편집상 위치)
- shotType: ${shotGuide} (연속 동일 금지 — 씬 시작 시점의 오프닝 샷)
- cameraMovement: ≤10 words 영어
- subjectAction: 영어 ≤15 words — 이 씬의 서사 기능이 시각적으로 드러나는 핵심 행동/변화 (금지: stands, watches, feels. 필수: 누가 무엇을 해서 무엇이 바뀌는가)
- transitionHint: ≤10자
- shotCategory: "character-driven" | "environment" | "object-detail" | "map-graphic" | "transition-atmosphere"
  (먼저 결정: 이 씬에 캐릭터가 꼭 필요한가? 정보/분위기/공간/지도 씬은 인물 없이 설계. 지도/항공/인포그래픽 씬은 "map-graphic" 사용)
- characterRole: "protagonist" | "background" | "silhouette" | "partial" | "absent"
  ⚠️ shotCategory가 environment/object-detail/map-graphic/transition-atmosphere이면 characterRole="absent" 권장
  ⚠️ characterRole이 "absent"가 아닌 경우 subjectAction은 반드시 구체적 행동 포함 (standing/motionless 금지)
- locationCue: 영어 ≤8 words — 서사 기능을 뒷받침하는 장소 시각 단서
- situationCue: 영어 ≤8 words — 서사 기능이 드러나는 상황 증거 (원인/변화/결과가 보이는 시각적 사실)
- emotionalAnchor: 영어 ≤8 words — 이 서사 기능의 감정적 무게가 집약되는 시각 포인트

## ⚠️ 시퀀스 밀도 규칙
- 총 ${secPerCut * cutCount}초 기준: 반드시 ${cutCount}개의 개별 시퀀스(outlines)를 작성하라
- 각 시퀀스는 ${secPerCut}초짜리 VEO 1회 생성 단위
- 시퀀스 내부의 멀티샷(2~6개)은 별도 처리 — 여기서는 시퀀스 단위 아웃라인만 작성
- 같은 장면을 길게 이어쓰지 말고, 시퀀스마다 다른 location/situation/emotion 조합을 구성
- ❌ 나쁜 예: 48초를 3~4개로 뭉개서 12초+ 시퀀스 생성
- ✅ 좋은 예: 48초를 ${cutCount}개 × ${secPerCut}초 시퀀스로 분할

## ⚠️ 숏폼 리듬 > 감독 스타일 (최우선 규칙)
- 이 영상은 유튜브/인스타 숏폼용이다. 빠른 컷 전환이 필수.
- 감독 스타일은 카메라/조명/구도/질감/분위기에만 반영하라.
- 감독이 롱테이크 성향이라도, 컷 수(${cutCount})를 절대 줄이지 마라.
- "롱테이크 감독 = 컷 전환 없음"으로 해석 금지. "압축된 리듬의 롱테이크 해석"으로 제한.
- ${cutCount}개 미만의 outlines를 생성하면 실패로 간주한다.

JSON만 출력:
{"characterSeeds":[...],"outlines":[...]}`;

  // ── Token budget: 컷 수에 비례하여 maxOutputTokens 산정 ──
  // 경량화된 outline ≈ 350-400 tokens (14개 필드, sceneBeat1/2/3+endHook 제거)
  // characterSeeds ≈ 200, JSON overhead ≈ 200
  // 안전 마진 1.5배 → 최소 4096, 최대 STEP1_MAX_TOKENS
  const estimatedTokens = 200 + cutCount * STEP1_TOKENS_PER_OUTLINE + 200;
  const step1MaxTokens = Math.min(STEP1_MAX_TOKENS, Math.max(4096, Math.ceil(estimatedTokens * 1.5)));
  const effectiveModel = modelOverride || MODEL_OUTLINE;
  console.info(`[cuts:step1] model=${effectiveModel} promptLen=${prompt.length} cutCount=${cutCount} maxTokens=${step1MaxTokens} estimatedTokens=${estimatedTokens} cap=${STEP1_MAX_TOKENS} timeoutMs=${STEP1_TIMEOUT_MS}`);

  let result = await streamingGenerate(env, effectiveModel, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: step1MaxTokens, responseMimeType: "application/json" },
  }, { timeoutMs: STEP1_TIMEOUT_MS });

  console.info(`[cuts:step1] responseLen=${result.text.length} truncated=${result.truncated ?? false} timedOut=${result.timedOut ?? false} parseMode=normal`);

  // ── Truncation 감지 + compact retry 전략 ──
  // retry 순서: (1) higher maxTokens retry → (2) compact prompt retry → (3) throw
  let parseMode: "normal" | "higher_tokens_retry" | "compact_retry" | "partial_recovery" = "normal";

  if (result.truncated && result.text) {
    console.warn(`[cuts:step1] TRUNCATED — attempting partial recovery. partialLen=${result.text.length}`);
    const partial = safeParseObj(result.text);
    if (partial && Array.isArray(partial.outlines) && (partial.outlines as unknown[]).length >= Math.floor(cutCount * 0.7)) {
      // 부분 복구 성공 — outlines가 70% 이상 있으면 downstream에서 채움
      parseMode = "partial_recovery";
      console.info(`[cuts:step1] partial recovery OK. characterSeeds=${Array.isArray(partial.characterSeeds) ? (partial.characterSeeds as unknown[]).length : 0} outlines=${(partial.outlines as unknown[]).length}/${cutCount} parseMode=${parseMode}`);
    } else {
      // (1) maxOutputTokens를 STEP1_RETRY_MAX_TOKENS로 올려서 재시도
      if (step1MaxTokens < STEP1_RETRY_MAX_TOKENS) {
        console.warn(`[cuts:step1] RETRY with higher maxTokens=${STEP1_RETRY_MAX_TOKENS} (was ${step1MaxTokens}) timeoutMs=${STEP1_TIMEOUT_MS}`);
        parseMode = "higher_tokens_retry";
        result = await streamingGenerate(env, effectiveModel, {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: STEP1_RETRY_MAX_TOKENS, responseMimeType: "application/json" },
        }, { timeoutMs: STEP1_TIMEOUT_MS });
        console.info(`[cuts:step1] higher_tokens_retry responseLen=${result.text.length} truncated=${result.truncated ?? false} timedOut=${result.timedOut ?? false}`);
      }

      // (2) 여전히 truncated이면 compact prompt로 재시도
      if (result.truncated || !safeParseObj(result.text)) {
        console.warn(`[cuts:step1] COMPACT RETRY — stripping verbose instructions from prompt`);
        parseMode = "compact_retry";
        // compact editorial: editorialPlanningBlock의 축약 버전 (있으면 50자 내로)
        const compactEditorial = editorialPlanningBlock
          ? editorialPlanningBlock.split("\n").filter(l => l.startsWith("- ")).map(l => l.replace(/^-\s*/, "").split(":")[0]).slice(0, 3).join(", ")
          : "";
        const compactPrompt = `당신은 시나리오 분석가입니다. JSON만 출력하세요.
${contentMode === "dramatized_reenactment" ? "역사 재연 콘텐츠. 강사/해설자 금지." : "일반 영상."}
감독: ${directorNameKo}. 조건: ${secPerCut}초/시퀀스, 총 ${cutCount}시퀀스.${compactEditorial ? `\n편집 기조: ${compactEditorial}` : ""}

시나리오: ${storyExcerpt}

characterSeeds (최대 3명): [{id,label,appearance(영어≤30w),appearanceKo(≤20자)}]
outlines (정확히 ${cutCount}개): [{cutNumber,sceneKo(≤25자),emotion,emotionalDelta,purpose,shotType,cameraMovement(≤8w),subjectAction(≤10w),transitionHint(≤8자),shotCategory,characterRole,locationCue(≤6w),situationCue(≤6w),emotionalAnchor(≤6w)}]
⚠️ 총 런타임 12초 초과면 1시퀀스 금지, 최소 2시퀀스로 분할. 각 시퀀스 ${secPerCut}초.
⚠️ 숏폼 리듬 > 감독 스타일: 감독이 롱테이크 성향이어도 반드시 ${cutCount}개 시퀀스를 생성하라. 컷 수를 줄이지 마라.

JSON만: {"characterSeeds":[...],"outlines":[...]}`;

        result = await streamingGenerate(env, effectiveModel, {
          contents: [{ role: "user", parts: [{ text: compactPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: STEP1_RETRY_MAX_TOKENS, responseMimeType: "application/json" },
        }, { timeoutMs: STEP1_TIMEOUT_MS });
        console.info(`[cuts:step1] compact_retry responseLen=${result.text.length} truncated=${result.truncated ?? false} timedOut=${result.timedOut ?? false} maxTokens=${STEP1_RETRY_MAX_TOKENS}`);

        if (result.truncated) {
          // compact retry도 truncated → partial 파싱 시도 후 실패하면 throw
          const lastPartial = safeParseObj(result.text);
          if (lastPartial && Array.isArray(lastPartial.outlines) && (lastPartial.outlines as unknown[]).length > 0) {
            parseMode = "partial_recovery";
            console.info(`[cuts:step1] compact partial recovery: ${(lastPartial.outlines as unknown[]).length} outlines`);
          } else {
            throw new Error(`step1 truncated after compact retry: output ${result.text.length}chars, maxTokens=${STEP1_RETRY_MAX_TOKENS}. cutCount=${cutCount}개가 너무 많거나 스토리가 너무 깁니다.`);
          }
        }
      }
    }
  } else if (result.error) {
    // Check if it's a timeout — try ultra-compact before throwing
    if (result.timedOut || (result.status === 524)) {
      console.warn(`[cuts:step1] TIMEOUT detected — attempting ultra-compact retry`);
      // editorialPlanningBlock → 짧은 축약 (ultra-compact용)
      const ultraEditorial = editorialPlanningBlock
        ? editorialPlanningBlock.split("\n").filter(l => l.startsWith("- ")).map(l => l.replace(/^-\s*/, "").split(":")[0]).slice(0, 3).join(", ")
        : undefined;
      const ultraPrompt = buildUltraCompactStep1Prompt(storyText, directorNameKo, cutCount, secPerCut, ultraEditorial ? `[편집: ${ultraEditorial}]` : undefined);
      const ultraResult = await streamingGenerate(env, effectiveModel, {
        contents: [{ role: "user", parts: [{ text: ultraPrompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: STEP1_ULTRA_MAX_TOKENS, responseMimeType: "application/json" },
      }, { timeoutMs: STEP1_ULTRA_TIMEOUT_MS });
      console.info(`[cuts:step1] ultra-compact attempt: maxTokens=${STEP1_ULTRA_MAX_TOKENS} timeoutMs=${STEP1_ULTRA_TIMEOUT_MS}`);

      if (!ultraResult.error && !ultraResult.timedOut && ultraResult.text) {
        result = ultraResult;
        parseMode = "compact_retry";
        console.info(`[cuts:step1] ultra-compact recovery succeeded. responseLen=${result.text.length}`);
      } else {
        throw new Error(`step1 TIMEOUT + ultra-compact retry failed: ${result.error.slice(0, 300)}`);
      }
    } else if (result.status && (result.status >= 500 || result.status === 429)) {
      // Provider-side error (503 UNAVAILABLE, 429 rate limit, 500 etc.)
      // Mark clearly so outer handler doesn't misclassify as MAX_TOKENS
      throw new Error(`PROVIDER_ERROR:${result.status}: ${result.error.slice(0, 400)}`);
    } else {
      throw new Error(`step1 API error: ${result.error.slice(0, 500)}`);
    }
  }

  const parsed = safeParseObj(result.text);
  if (!parsed) throw new Error(`step1 parse failed. responseLen=${result.text.length} truncated=${result.truncated ?? false} parseMode=${parseMode} tail=${result.text.slice(-200)}`);
  console.info(`[cuts:step1] FINAL parseMode=${parseMode} characterSeeds=${Array.isArray(parsed.characterSeeds) ? (parsed.characterSeeds as unknown[]).length : 0} outlines=${Array.isArray(parsed.outlines) ? (parsed.outlines as unknown[]).length : 0}`);

  const characterSeeds: CharacterSeed[] = Array.isArray(parsed.characterSeeds)
    ? (parsed.characterSeeds as Array<Partial<CharacterSeed>>).map((s) => ({
        id: String(s.id ?? "char-1"),
        label: String(s.label ?? "주인공"),
        appearance: String(s.appearance ?? "A young person, casual modern clothing, natural look").slice(0, 400),
        appearanceKo: String(s.appearanceKo ?? "캐주얼 의상의 젊은 인물").slice(0, 50),
      }))
    : [{ id: "char-1", label: "주인공", appearance: "A young person, casual modern clothing, natural look", appearanceKo: "캐주얼 의상의 젊은 인물" }];

  // 샷 타입 기본 순환 (step1이 다양화에 실패했을 때 fallback)
  const shotCycle = ["MS", "CU", "WS", "OTS", "MCU", "LS", "ECU", "POV", "MLS"];

  // 영화적 기본 카메라 움직임 (fallback용)
  const defaultMovements = [
    "slow pan revealing space and atmosphere",
    "subtle dolly forward as subject is introduced",
    "slow push-in as tension builds",
    "locked-off static — contained reaction",
    "restrained reframing as focus narrows",
    "slow pull-back revealing new context",
    "gentle pan following subject movement",
    "locked-off static — suppressed emotion",
    "slow push-in on detail",
  ];

  const validCategories: ShotCategory[] = ["character-driven", "environment", "object-detail", "map-graphic", "transition-atmosphere"];
  const validRoles: CharacterRole[] = ["protagonist", "background", "silhouette", "partial", "absent"];

  const outlines: CutOutline[] = Array.isArray(parsed.outlines)
    ? (parsed.outlines as Array<Partial<CutOutline>>).map((o, i) => {
        const rawCategory = String(o.shotCategory ?? "character-driven");
        const rawRole = String(o.characterRole ?? "protagonist");
        const shotCategory = validCategories.includes(rawCategory as ShotCategory) ? rawCategory as ShotCategory : "character-driven";
        const characterRole = validRoles.includes(rawRole as CharacterRole) ? rawRole as CharacterRole : "protagonist";
        return {
          cutNumber: Number(o.cutNumber ?? i + 1),
          sceneKo: String(o.sceneKo ?? `장면 ${i + 1}`).slice(0, 40),
          emotion: String(o.emotion ?? "neutral"),
          emotionalDelta: String(o.emotionalDelta ?? (i === 0 ? `opening→${o.emotion ?? "neutral"}` : "neutral→neutral")),
          purpose: String(o.purpose ?? "develop"),
          shotType: String(o.shotType ?? shotCycle[i % shotCycle.length]),
          cameraMovement: String(o.cameraMovement ?? defaultMovements[i % defaultMovements.length]),
          subjectAction: String(o.subjectAction ?? `moves through scene ${i + 1}`),
          transitionHint: String(o.transitionHint ?? "디졸브").slice(0, 20),
          shotCategory,
          characterRole,
          locationCue: String(o.locationCue ?? "identifiable location elements"),
          situationCue: String(o.situationCue ?? "visible situation evidence"),
          emotionalAnchor: String(o.emotionalAnchor ?? "emotional focal point"),
          // sceneBeat/endHook: Step1에서 생략 가능 — cue 기반 자동 합성
          sceneBeat1: String(o.sceneBeat1 ?? o.locationCue ?? "location-identifying objects and space"),
          sceneBeat2: String(o.sceneBeat2 ?? o.situationCue ?? "situation evidence becomes visible"),
          sceneBeat3: String(o.sceneBeat3 ?? o.emotionalAnchor ?? "emotional anchor enters or is revealed"),
          endHook: String(o.endHook ?? "visual tension toward next scene"),
        };
      })
    : [];

  // 연속 동일 shotType 감지 및 fallback 수정
  for (let i = 1; i < outlines.length; i++) {
    if (outlines[i].shotType === outlines[i - 1].shotType) {
      // 같은 샷 타입이면 다음 사이클로 강제 교체
      outlines[i].shotType = shotCycle[(shotCycle.indexOf(outlines[i].shotType) + 1) % shotCycle.length];
      console.warn(`[cuts:step1] shotType 중복 감지 → CUT${outlines[i].cutNumber} 강제 변경: ${outlines[i].shotType}`);
    }
  }

  // ── Missing-cut 복구: partial recovery로 일부만 받은 경우 ──
  if (outlines.length > 0 && outlines.length < cutCount) {
    console.info(`[cuts:step1] outlines ${outlines.length}/${cutCount} — attempting missing-cut repair`);
    const repairedOutlines = await repairMissingOutlines(
      env, outlines, cutCount, directorNameKo, secPerCut, storyExcerpt,
    );
    return { characterSeeds, outlines: repairedOutlines };
  }

  return { characterSeeds, outlines };
}

// ─── STEP 2/3: 배치 단위 시각 프롬프트 생성 (감독 연출 지시 방식) ────────────

async function step23DetailBatch(
  env: GeminiEnv,
  allOutlines: CutOutline[],    // 전체 시퀀스 컨텍스트 (anti-repetition용)
  charAppearance: string,
  videoStyle: string,
  regionFlavor: string,
  directorName: string,
  directorStyle: string,
  directorEngine: string,       // buildDirectorEngine() 결과 — 연출 철학 전체
  secPerCut: number,
  beatTemplate: string,
  extendBeatTemplate: string,
  aspectRatio: string,
  editingNote: string,
  batchOutlines: CutOutline[],  // 이번 배치에서 생성할 컷 (호출부에서 뒤에 추가)
  stepLabel: string,
  generationPersonaBlock: string,  // buildGenerationPersonaBlock() 결과
  characterPersonaBlock: string,   // buildCharacterPersonaBlock() 결과
  editorialSummary: string,        // buildCompactEditorialSummary() 결과 — step2/3 재강조용
  modelOverride?: string,
): Promise<CutDetail[]> {
  if (batchOutlines.length === 0) return [];

  const charRef = charAppearance.slice(0, 200);
  const firstCutNum = batchOutlines[0].cutNumber;
  const lastCutNum  = batchOutlines[batchOutlines.length - 1].cutNumber;

  // noTextSuffix: 감독 이름 태그 대신 스타일 특성어로 대체
  // (이름 태그 = 표면 스타일, 특성어 = 실제 미학 주입)
  const styleFingerprint = directorStyle
    ? directorStyle.split(/[,;|]/).slice(0, 3).map(s => s.trim()).filter(Boolean).join(", ")
    : directorName;
  const noTextSuffix = `${videoStyle}, ${styleFingerprint}, ${aspectRatio} aspect ratio, no text, no watermark, no captions`;

  // 전체 시퀀스 컨텍스트 (이전 씬 상태 파악용)
  const sequenceContext = allOutlines
    .map(o => `SCENE${o.cutNumber}[${o.shotType}|${o.purpose}|${o.shotCategory}]: "${o.sceneKo}" | beats: ${o.sceneBeat1} → ${o.sceneBeat2} → ${o.sceneBeat3} | endHook: ${o.endHook}`)
    .join("\n");

  // 이번 배치 컷 연출 지시
  const batchDirectives = batchOutlines.map((o, i) => {
    const prevOutline = allOutlines.find(a => a.cutNumber === o.cutNumber - 1);
    const nextOutline = allOutlines.find(a => a.cutNumber === o.cutNumber + 1);
    const prevDesc = prevOutline
      ? `[PREV SCENE${prevOutline.cutNumber}: ${prevOutline.shotType}, movement="${prevOutline.cameraMovement}", action="${prevOutline.subjectAction}", emotion="${prevOutline.emotion}"]`
      : "[PREV: none — this is establishing shot]";
    const nextHint = nextOutline
      ? `[NEXT SCENE${nextOutline.cutNumber}: ${nextOutline.shotType} — audience will see ${nextOutline.shotType} next, so THIS scene must withhold something]`
      : "[NEXT: final scene — resolve all withheld information]";
    const isFirst = o.cutNumber === 1;
    const revealHint = isFirst
      ? "REVEAL: space layout, atmosphere, physical environment only. WITHHOLD: character face, central conflict object, dramatic information."
      : `REVEAL: one new layer beyond prev scene (${prevOutline?.shotType ?? "unknown"} → ${o.shotType}). WITHHOLD: at least one element that sustains curiosity.`;
    return `SCENE${o.cutNumber} (${i + 1}/${batchOutlines.length}) — ${secPerCut}초 MICRO-SCENE:
  Purpose: ${o.purpose} | Opening shot: ${o.shotType} | Emotion shift: ${o.emotionalDelta}
  Shot category: ${o.shotCategory} | Character role: ${o.characterRole}
  Camera progression: ${o.cameraMovement}
  Core action across scene: ${o.subjectAction}
  Scene summary: ${o.sceneKo}
  ── NARRATIVE FUNCTION (이 시퀀스가 전체 이야기에서 맡는 역할) ──
  STORY ROLE: ${(o as CutOutline & { narrativeFunction?: string }).narrativeFunction || o.purpose}
  ── INSTANT READABILITY (서사 기능의 시각적 번역) ──
  WHERE (장소 단서): ${o.locationCue}
  WHAT (상황 단서): ${o.situationCue}
  WHO/EMOTION (감정 앵커): ${o.emotionalAnchor}
  ── SCENE BEATS: location → situation → emotion ──
  BEAT1 LOCATION (${beatTimings(secPerCut).b1}): ${o.sceneBeat1}  — 장소가 즉시 인식되어야 함
  BEAT2 SITUATION (${beatTimings(secPerCut).b2}): ${o.sceneBeat2}  — 상황/문제의 시각적 증거
  BEAT3 EMOTION (${beatTimings(secPerCut).b3}): ${o.sceneBeat3}  — 감정/갈등 집약
  END HOOK: ${o.endHook}
  ── CONTEXT ──
  Previous: ${prevDesc}
  ${nextHint}
  ${revealHint}
  Transition out: ${o.transitionHint}`;
  }).join("\n\n");

  const prompt = `당신은 아래 연출 철학을 완전히 내면화한 촬영 감독입니다.
스타일: ${videoStyle} | 지역: ${regionFlavor}${editingNote ? ` | ${editingNote}` : ""}
${secPerCut}초/시퀀스 | 화면비: ${aspectRatio}

## ⚠️ 핵심 원칙: ${secPerCut}초 = "짧은 시퀀스(sequence)"이다 (단일 샷이 아님!)
- 각 ${secPerCut}초 단위는 여러 시각 비트가 모여 하나의 의미를 전달하는 시퀀스이다.
- 예: "치과 간판 → 텅 빈 대기실 → 한숨 쉬는 원장" = 3개의 시각 비트 = 1개의 시퀀스 = "한산한 치과" 즉시 이해
- 시퀀스의 각 비트(sceneBeat)는 서로 다른 구도/앵글/피사체를 가진다.
- ${secPerCut}초가 끝났을 때 시청자는 "어디서, 무슨 상황이고, 누가 어떤 감정인지"를 바로 알아야 한다.

## ⚠️ 최우선 기준: 서사 기능의 시각적 번역
- 각 컷의 STORY ROLE을 먼저 확인하고, 그 서사 기능이 시각적으로 즉시 전달되도록 설계한다.
- 모든 장면은 보자마자 아래가 이해되어야 한다:
  1. 이 장면이 이야기에서 무슨 역할인가? (원인 제시, 변화 발생, 결과 증거 등)
  2. 어디인가? (서사 기능을 뒷받침하는 장소)
  3. 무슨 상황인가? (서사 기능이 드러나는 시각적 증거)
- "서사와 무관한 멋있는 비주얼"보다 "이야기의 의미가 보이는 장면"을 우선한다.
- 상징/분위기 샷은 서사 기능을 보조할 때만 허용. 이야기 본체를 대체하면 안 된다.
- 상황은 증거로: 추상적 설명 대신 시각적 증거(빈 의자, 줄 선 사람, 꺼진 조명)로 보여준다.
캐릭터 외형(verbatim — 절대 수정/확장 금지): "${charRef}"
⚠️ 단, shotCategory에 따라 캐릭터 사용 여부가 달라짐 — 아래 SHOT CATEGORY RULES 참조

## 연출 엔진 (서사 기능이 결정된 후, 이 철학으로 시각 표현 방식을 결정한다)
⚠️ 연출 엔진은 서사 기능에 종속된다. 감독 스타일이 서사 기능과 충돌하면 서사 기능이 우선한다.
예: 감독이 "느린 정적 화면"을 선호해도, 서사 기능이 "급격한 변화 시각화"이면 변화가 보여야 한다.
${directorEngine}
${editorialSummary ? `\n## ⚠️ EDITORIAL PERSONA REMINDER (step1에서 결정된 편집 기조 — 모든 컷에 적용)\n${editorialSummary}\n- complexity budget 유지: max 1 subject, 1 action, 1 camera motion per cut.` : ""}

## 전체 시퀀스 컨텍스트 (반복 방지용 — 이 컷들의 흐름 파악에만 사용)
${sequenceContext}

## 이번 배치: CUT${firstCutNum}~CUT${lastCutNum} 상세 연출 지시 생성

${batchDirectives}

${generationPersonaBlock ? generationPersonaBlock + "\n\n" : ""}${characterPersonaBlock ? characterPersonaBlock + "\n\n" : ""}## 드라마타이즈 규칙 (절대 금지 / 필수)
절대 금지:
- 자막(subtitle overlay, caption, on-screen lesson text) 생성 금지
- 나레이션/보이스오버(narration audio, voiceover) 생성 금지
- 카메라를 향해 설명하는 진행자/강사/해설자 인물 생성 금지
- "여러분, 오늘은 ...", "이 장면에서 배울 점은 ..." 식의 강의형 대사 금지
필수:
- 모든 대사(dialogue)는 반드시 한국어로 작성
- 정보 전달은 갈등·협상·유머·공포·아이러니를 통해 자연스럽게 드러남
- 인물은 극 중 목적을 가지고 행동하는 배우여야 함 (해설자 절대 금지)
- 교훈적 내용은 인물의 결정이나 상황 결과로 드러남 (해설자 대사 금지)

## SHOT CATEGORY RULES (컷 유형별 피사체 설계 — 모든 컷에 캐릭터를 강제하지 않는다)

### Shot category별 프롬프트 설계
- **character-driven** (characterRole=protagonist/partial): 캐릭터가 주 피사체. charRef 포함. subjectAction은 반드시 구체적 행동 (standing/motionless 절대 금지). 캐릭터가 나올 이유가 있어야 함.
- **environment** (characterRole=absent/background/silhouette): 공간/환경이 주 피사체. charRef 생략 또는 "distant silhouette"/"passing figure" 정도만. subjectAction은 환경 움직임 묘사 (풍경, 조명, 기상 변화 등).
- **object-detail** (characterRole=absent/partial): 사물/디테일이 주 피사체. charRef 생략. subjectAction은 오브젝트의 움직임/변화 묘사 (간판 깜빡임, 손의 움직임, 차트 변화 등).
- **transition-atmosphere** (characterRole=absent): 전환/분위기 샷. charRef 생략. subjectAction은 분위기 전환 묘사 (빛 변화, 공간 이동, 시간 흐름 등).

### characterRole별 charRef 사용
- protagonist: charRef 전체 사용 (얼굴/외형 완전 표현)
- partial: charRef의 관련 부분만 사용 (예: 손, 뒷모습, 어깨 등)
- silhouette: "dark silhouette of [gender] figure" 정도만 — 외형 디테일 생략
- background: "distant figure in [clothing hint]" — 최소한의 힌트만
- absent: charRef 완전 생략 — 인물 묘사 넣지 않음

### 행동 없는 캐릭터 금지
캐릭터가 등장하면 반드시 서사적/시각적 이유가 있어야 함:
✅ 걷는다, 돌아본다, 멈칫한다, 간판을 올려다본다, 문을 밀기 전 숨을 고른다, 손을 만지작거린다
❌ stands, remains motionless, faces camera, watches quietly

## CINEMATIC SHOT PROGRESSION ENGINE (영화적 시선 설계 — 단순 다양화가 아닌 의도된 정보 공개 순서)

### Shot Sequence Law
- 첫 장면(SCENE1)은 WS 또는 LS — 공간과 분위기만 열 것. 인물 얼굴 클로즈업 금지.
- 이후 장면에서 MS→CU→ECU 방향으로 점진적으로 좁혀들 것.
- 중반부 이후 LS/WS 한 번 삽입 — 대비와 호흡을 만들 것.
- 같은 shot size의 장면 2회 연속 금지. 반드시 closer 또는 further.

### Camera Movement Motivation Law (카메라는 이유 없이 움직이지 않는다)
- Allowed with mandatory reason:
  • slow push-in: 긴장 고조, 인물 내면으로 진입, 정보 공개 임박
  • subtle dolly forward/back: 친밀감 변화, 심리적 접근/후퇴
  • gentle pan: 새 인물/요소 발견, 공간 관계 탐색
  • restrained reframing: 심리적 불안, 무언가를 놓친 인식
  • locked-off static: 억압된 감정, 격식, 통제된 긴장
- BANNED: 이유 없는 핸드헬드 흔들림, 장식용 crane/jib/dutch, 목적 없는 zoom
- Camera movement = CAMERA_MOVEMENT + "(reason: [why it moves])" 형식으로 작성

### Visual Reveal / Withhold Law (관객 궁금증 유지 구조)
- 각 장면은 반드시 "이전 장면에 없던 새 시각 정보 하나"를 공개한다.
- 동시에 "아직 보여주지 않는 정보 하나"를 프레임 밖에 보류한다.
- WITHHELD 전략: 인물 얼굴을 등/측면으로 숨기기, 핵심 소품을 프레임 경계에 걸치기, 갈등 원인을 암시만
- REVEALED 순서: 공간 → 인물 위치 → 인물 표정 → 핵심 소품 → 감정 정점 → 결과

## 감독 연출 원칙 (반드시 준수)
1. videoPrompt는 "스토리 설명"이 아니라 "카메라 지시"다
2. 이전 장면과 shotType이 이미 다르게 설정되어 있음 — 이것을 반드시 반영
3. subjectAction을 그대로 영상화하되, 구체적 신체 동작으로 묘사
4. 감정을 형용사/추상어로 절대 이름 붙이지 말 것. 그 감정이 유발하는 "신체 행동 + 망설임/중단/충동"으로만 표현.
   감정→행동 번역 원칙:
   - anxiety/fear   → fingers stop mid-motion, gaze darts between two points, body fails to settle
   - hesitation     → hand extends toward target then recoils, weight shifts forward then back
   - resolve        → after pause, gaze locks and action completes without stopping
   - guilt          → eye contact broken, speech impulse swallowed, hand hidden or covered
   - suppressed anger→ jaw sets, fist closes slowly, movement becomes short and cut-off
   - relief         → shoulders lose tension on exhale, grip releases, breath elongates
   - anticipation   → torso tilts forward, eyes arrive before the body moves
   - resignation    → action begun then abandoned, hand lowered slowly, gaze drops
   - jealousy       → quick side-glance immediately retracted, neutral mask reassembled
   - embarrassment  → gaze redirected, micro-smile suppressed, body self-adjusted
5. 각 장면에서 "이전 장면에 없던 시각 정보" 최소 1개 포함
6. 동일 감정이 연속되면 다른 행동 양상으로 드러낼 것. 같은 행동 반복 금지.
7. 감정 상태를 정지된 포즈가 아니라 "진행 중인 행동 비트"로 설계할 것
${SCENE_TERM_PRECISION_BLOCK}

## STRICT 글자 제한

imagePrompt (≤80 words English — 씬의 오프닝 순간, 자연어만):
  If characterRole=protagonist/partial: "[shot type] shot, [angle]. [charRef or partial]. [sceneBeat1 시각 묘사]. [환경 디테일 2개 이상]. [moodLighting]. [noTextSuffix]"
  If characterRole=absent: "[shot type] shot, [angle]. [environment/object 구체적]. [sceneBeat1]. [환경 디테일]. [moodLighting]. [noTextSuffix]"
  If characterRole=silhouette/background: "[shot type] shot, [angle]. [environment]. [distant figure hint]. [sceneBeat1]. [moodLighting]. [noTextSuffix]"

endImagePrompt (≤65 words English — 씬의 마지막 순간, 자연어만):
  If characterRole=protagonist/partial: "[charRef or partial]. [sceneBeat3 결과 상태]. [무엇이 변했는지]. [noTextSuffix]"
  If characterRole=absent: "[sceneBeat3 결과 상태]. [무엇이 변했는지]. [noTextSuffix]"

videoPrompt (≤180 words English — ⚠️ ${secPerCut}초 = 짧은 시퀀스. 단일 샷 설명이 아니라 3개 비트의 시퀀스 블록이다):
  ⚠️ 자연어로만 작성 — SHOT_SIZE: / CAMERA_ANGLE: / REVEALED: 같은 메타태그 절대 사용 금지!
  ⚠️ 핵심: 각 비트(beat)는 서로 다른 구도/앵글/피사체를 가져야 한다. 같은 카메라 위치에서 같은 구도로 ${secPerCut}초를 채우지 마라!
  Format: "[Beat1 shot type], [angle]. [locationCue 시각화 — 장소 정체성이 즉시 인식되는 오브젝트]. ${beatTemplate.replace("[start]", "[BEAT1 LOCATION: 장소 인식 — WHERE가 즉시 읽히는 환경 디테일]").replace("[develop]", "[BEAT2 SITUATION: 상황 증거 — WHAT이 보이는 시각적 증거(빈 의자, 꺼진 조명, 줄 선 사람 등)]").replace("[climax]", "[BEAT3 EMOTION: 감정/갈등 — WHO/EMOTION 앵커(인물 행동, 반응, 갈등 집약)]")}. [charRef if characterRole is NOT absent — omit entirely if absent]. [noTextSuffix]"
  예시: "Wide shot, eye-level. Dental clinic waiting room — empty reception desk, overhead fluorescent buzzing. 0s-2s: wide establishing — three vacant blue plastic chairs, water dispenser with still surface, appointment board on wall. 2s-5s: medium shot — camera pushes in to reception counter, dust particles float in pale window light, phone sits untouched, withered plant on corner. 5s-8s: close-up — doctor slumps at desk behind frosted partition, fingers tap idle pen, stethoscope coiled unused beside cold coffee cup. [charRef]. [noTextSuffix]"
  ⚠️ videoPrompt 시퀀스 설계 원칙:
  - 3개 비트 각각 다른 shot size 사용 (예: WS→MS→CU 또는 LS→MS→ECU) — 같은 구도 반복 금지
  - BEAT1: 장소 정체성 오브젝트 2개 이상 (치과=치과의자+소독등, 식당=테이블+메뉴판 등)
  - BEAT2: 상황을 시각적 증거로 (빈=빈 의자, 성공=줄 선 사람, 위기=꺼진 조명) — 추상 설명 금지
  - BEAT3: 인물 감정을 구체적 신체 행동으로 (한숨, 고개 숙임, 손 떨림 등)
  - ${secPerCut}초 끝나면 시청자가 "어디서, 무슨 상황, 누가 어떤 감정"을 즉시 알아야 한다
  - 환경 디테일을 구체적으로 (예: "dusty floor reflection, peeling wallpaper, rusted pipe")
  BANNED: "continues", "still", "same as before", "watches quietly", "stands facing", "remains motionless", "standing"
  BANNED: SHOT_SIZE: / CAMERA_ANGLE: / REVEALED: / WITHHELD: / END_HOOK: / SUBJECT_ACROSS_SCENE: 같은 메타태그
  BANNED: "sign", "faded sign", "signboard" — 텍스트 유도 오브젝트 금지
  BANNED emotion labels: "anxious", "nervous", "sad", "angry", "happy", "scared", "guilty", "relieved" — body behavior only

extendPrompt (SCENE${firstCutNum}=="" if SCENE1 | others ≤120 words English):
  ⚠️ 자연어로만 작성 — 메타태그 절대 사용 금지!
  ⚠️ extendPrompt도 시퀀스 블록이다 — 이전 장면 연결 후 location→situation→emotion 순서로 전개
  Format: "Continuing from previous shot — [prevScene endHook]. [Beat1: location establishing with different angle]. [Beat2: situation evidence]. [Beat3: emotional anchor]. [charRef if characterRole is NOT absent — omit if absent]. [noTextSuffix]"
  BANNED: "continuing", "similar to previous", "same pose", emotion adjectives, 모든 메타태그(SHOT_SIZE:/CAMERA_ANGLE: 등)

cameraDirection (≤55 chars English):
  Format: "Lens Xmm. [movement1]→[movement2]. ${directorName} style."

moodLighting (≤55 chars English — 반드시 4요소: source + direction + intensity + quality):
  Format: "[light source] from [direction], [intensity] [quality]. [color grade]."
  예: "cold daylight entering from the upper right, weak diffused glow, blue-grey cast"
  예: "weak overhead fluorescent light, flickering green-white, casting hard downward shadows"
  예: "soft diffused window light from the left, pale warm wash, gentle falloff on floor"
  예: "pale neon spill from corridor tubes behind, dim blue-pink rim on edges"
  예: "single desk lamp from below-left, warm amber spot, deep shadows on ceiling"
  BANNED: "dramatic lighting" / "moody atmosphere" / "cinematic light" — 추상어만 사용 절대 금지
  BANNED: "storefront signs" / "neon signs" — sign 오브젝트는 텍스트를 유도하므로 사용 금지
  필수: source(광원 종류) + direction(방향/위치) + intensity(강도) + quality(질감)

## ⚠️ TEXT-FREE 규칙 (간판/텍스트 유도 오브젝트 금지)
프롬프트에 "no text" / "no readable text"를 포함하는 동시에 텍스트를 연상시키는 오브젝트를 사용하면 영상 모델에게 상충 신호가 됩니다.
BANNED objects: sign, faded sign, dusty sign, signboard, placard, billboard, marquee, banner text, lettered, nameplate
ALLOWED replacements: weathered wooden panel, blank metal plate, textless facade panel, empty storefront overhang, mounted panel, wall bracket, awning

## ⚠️ 시각 디테일 밀도 (Visual Detail Density)
각 씬 프롬프트에 화면에 실제로 보이는 구체적 환경 오브젝트를 2개 이상 포함하라:
예: empty reception desk, dusty floor reflection, worn dental chair silhouette, flickering fluorescent tube, half-open blinds, faded wall paint, cracked tile floor, condensation on window, peeling wallpaper strip, rusted pipe along wall
메타 정보(REVEALED/WITHHELD)를 늘리지 말고 실제 화면 디테일을 늘려라.

## MULTI-SHOT 릴 프로그레션 규칙 (secPerCut 기반 — 인스타그램 릴처럼 빠른 시각 진행)
${(() => {
    const maxShots = getMaxShots(VEO_DEFAULT_MODEL, secPerCut);
    if (maxShots <= 0) {
      return `### multiShot 비활성 (secPerCut=${secPerCut}초 ≤ 3초)
- ${secPerCut}초는 하나의 독립 컷이다. multiShot 배열을 생성하지 마라.
- 하나의 연속된 카메라 무빙과 하나의 핵심 비트로 구성.
- "multiShot" 필드는 출력하지 말 것.`;
    }
    if (maxShots <= 2) {
      return `### multiShot 릴 프로그레션 (secPerCut=${secPerCut}초, 반드시 ${maxShots}개)
핵심 원칙: 모든 서브샷은 이전 샷과 반드시 다른 것을 보여줘야 한다.
- ${secPerCut}초에서는 반드시 ${maxShots}개 서브샷을 생성하라. 1개만 생성하면 실패.
- 숏폼 리듬 규칙: 감독 스타일이 정적이어도 내부 서브샷 수를 줄이지 마라.
- 각 서브샷은 반드시: (1) 다른 shot size, (2) 다른 카메라 앵글, (3) 다른 시각적 정보를 사용
- 같은 프레이밍에서 같은 액션을 반복하면 안 됨 = 가짜 분할
- 각 서브샷에 "role" 필드 포함: "establish"|"resolve"
- duration 합산 = ${secPerCut} (정수만). 각 서브샷 최소 2초.
- 서브샷 1(establish): 공간/대상 확인 (WS/LS). 서브샷 2(resolve): 감정적 payoff (CU/ECU).`;
    }
    const progressionRoles = [
      { role: "establish", desc: "HOOK — WS/LS. 공간 정체성 즉시 전달. 위치/상황/분위기를 구체적으로 보여줌." },
      { role: "develop",   desc: "EVIDENCE — MS/MCU. 새로운 시각 정보 도입. 이전 샷에 없던 행동/디테일/인물 표정." },
      { role: "peak",      desc: "CLIMAX — CU/ECU. 가장 극적인 순간. 감정/갈등 최고점. 시청자가 기억할 핵심 디테일." },
      { role: "resolve",   desc: "PAYOFF — WS/CU. 시각적 해소. 에너지 릴리즈. 결과/변화/여운을 보여줌." },
    ];
    const roles = progressionRoles.map((r, i) => `- 서브샷 ${i + 1} role="${r.role}": ${r.desc}`).join("\n");
    return `### multiShot 릴 프로그레션 (secPerCut=${secPerCut}초, 반드시 4개)

🚨 MANDATORY: 각 컷의 multiShot 배열은 반드시 정확히 4개 서브샷을 포함해야 한다. 3개 이하는 규칙 위반이며 절대 허용하지 않는다.
⚠️ 숏폼 필수: 감독이 롱테이크/정적 스타일이어도 서브샷 수를 4개 미만으로 줄이지 마라.

핵심 원칙 — 이것은 숫자 규칙이 아니라 프로그레션 규칙이다:
1. 모든 서브샷은 존재 이유가 있어야 한다 — 같은 화면을 나누는 것은 금지
2. 인접 서브샷은 반드시 shot size + 앵글이 달라야 한다 (WS→MCU→ECU→WS 식 진행)
3. 에스컬레이션: establish → develop → peak → resolve 순으로 감정/액션 강도가 올라감
4. 마지막 서브샷(resolve)은 반드시 시각적 payoff를 제공 — 시청자가 "봤다" 느끼는 보상
5. 프롬프트가 구체적으로 다른 화면을 묘사해야 함 (같은 텍스트 복사 금지)

⚠️ ANTI-REPETITION (가장 중요한 규칙):
- 인접 서브샷은 반드시 다른 피사체(SUBJECT)를 묘사해야 함
- 카메라 앵글만 바꾸고 같은 피사체+행동을 반복하는 것은 가짜 분할 → 금지
- 정보 증가(information gain): 각 서브샷은 이전 샷에서 볼 수 없었던 것을 보여줘야 함
- 예: establish=환경 공간 → develop=인물의 구체적 행동 → peak=감정이 집약되는 한 디테일 → resolve=상황이 변한 결과
- ❌ 나쁜 예: "warrior in hall" → "closer shot of warrior in hall" → "close-up of warrior in hall" (같은 피사체 반복)
- ✅ 좋은 예: "empty throne hall at dawn" → "warrior kneeling before altar, hands pressed" → "ECU warrior's eyes opening with resolve" → "wide pull-back, morning light flooding through door"

릴 프로그레션 role별 지침:
${roles}

- duration 합산 = ${secPerCut} (정수만). 각 서브샷 최소 2초.
- 서브샷마다 구체적으로 다른 화면을 묘사 (≤80 words each)
- 프롬프트에 shot size 명시 필수 (예: "ECU on trembling hands", "WS of empty hallway")
- 각 서브샷의 주 피사체(subject)를 이전 샷과 다르게 설정 (예: 공간→인물→소품→표정)

🚨 서브샷 프롬프트 필수 3요소 — 하나라도 빠지면 규칙 위반:
- 등장인물이 있는 장면: [1. 샷 사이즈 (WS/MS/CU/ECU)] + [2. 인물의 구체적 행동 (동사 필수)] + [3. 장소/공간 (어디인지)]
- 등장인물이 없는 장면: [1. 샷 사이즈 (WS/MS/CU/ECU)] + [2. 카메라가 비추는 구체적 대상] + [3. 장소/공간 (어디인지)]
❌ 나쁜 예: "따뜻한 사무실 전경이 보임" (샷 사이즈 없음, 구체적 행동 없음, 추상적)
✅ 좋은 예: "WS, dental clinic waiting room. Three empty chairs under buzzing fluorescent light."
✅ 좋은 예: "MS, office kitchen. Chef reaches for the knife rack, wiping flour from apron."`;
  })()}

JSON 배열로만 출력 (마크다운 없이):
${(() => {
    const maxShots = getMaxShots(VEO_DEFAULT_MODEL, secPerCut);
    const base = `{"cutNumber":${firstCutNum},"imagePrompt":"...","endImagePrompt":"...","videoPrompt":"...","extendPrompt":"${firstCutNum === 1 ? "" : "..."}","cameraDirection":"...","moodLighting":"..."`;
    if (maxShots <= 0) return `[${base}}]`;
    // 예시 multiShot: 반드시 4샷 균등 분배
    const shotDur = Math.max(2, Math.floor(secPerCut / 4));
    const exampleShots = [];
    const exampleRoles = ["establish", "develop", "peak", "resolve"];
    let remaining = secPerCut;
    const exampleCount = 4; // 반드시 4샷 예시
    for (let i = 1; i <= exampleCount; i++) {
      const d = i === exampleCount ? remaining : shotDur;
      exampleShots.push(`{"index":${i},"prompt":"...","duration":"${d}","role":"${exampleRoles[i - 1] ?? "develop"}"}`);
      remaining -= shotDur;
    }
    return `[${base},"multiShot":[${exampleShots.join(",")}]}]`;
  })()}`;

  // 배치 크기에 비례한 토큰 예산: 컷당 ≈1200 tokens, 최소 8192, 최대 32768
  const estimatedDetailTokens = batchOutlines.length * 1200 + 500;
  const maxTokens = Math.min(32768, Math.max(8192, Math.ceil(estimatedDetailTokens * 1.3)));
  const effectiveDetailModel = modelOverride || MODEL_DETAIL;
  console.info(`[cuts:${stepLabel}] model=${effectiveDetailModel} promptLen=${prompt.length} cuts=[${batchOutlines.map(o => o.cutNumber).join(",")}] maxTokens=${maxTokens} batchSize=${batchOutlines.length}`);

  let result = await streamingGenerate(env, effectiveDetailModel, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.75, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
  });

  console.info(`[cuts:${stepLabel}] responseLen=${result.text.length} truncated=${result.truncated ?? false}`);

  // Truncation retry: maxTokens 상향 후 재시도
  if (result.truncated && result.text && maxTokens < 32768) {
    console.warn(`[cuts:${stepLabel}] TRUNCATED — retrying with maxTokens=32768 (was ${maxTokens})`);
    result = await streamingGenerate(env, effectiveDetailModel, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 32768, responseMimeType: "application/json" },
    });
    console.info(`[cuts:${stepLabel}] retry responseLen=${result.text.length} truncated=${result.truncated ?? false}`);
  }

  if (result.error) {
    console.error(`[cuts:${stepLabel}] error: ${result.error.slice(0, 500)}`);
    // Provider 5xx/429 에러는 silent fallback 대신 throw → 상위에서 올바른 HTTP 상태 반환
    if (result.status && (result.status >= 500 || result.status === 429)) {
      throw new Error(`PROVIDER_ERROR:${result.status}: ${result.error.slice(0, 400)}`);
    }
    if (result.truncated && result.text) {
      console.warn(`[cuts:${stepLabel}] TRUNCATED after retry! partialLen=${result.text.length} rawTail500: ${result.text.slice(-500)}`);
      const partialArr = safeParseArr(result.text);
      if (partialArr && partialArr.length > 0) {
        console.info(`[cuts:${stepLabel}] partial recover: ${partialArr.length}/${batchOutlines.length} cuts`);
        return partialArr as CutDetail[];
      }
    }
    return [];
  }

  const arr = safeParseArr(result.text);
  if (!arr || arr.length === 0) {
    console.warn(`[cuts:${stepLabel}] parse failed. responseLen=${result.text.length} tail=${result.text.slice(-300)}`);
    return [];
  }

  return arr as CutDetail[];
}

// ─── 결정론적 fallback (structuredSequence 기반) ─────────────────────────────

/** 씬 타입별 물리 규칙 (lunar, underwater 등) */
function getPhysicsForScene(storyText: string): { environmentType: string; bannedWords: string[] } {
  const lower = storyText.toLowerCase();
  if (/(lunar|moon|달 표면|달 기지|월면)/i.test(lower)) {
    return { environmentType: "lunar", bannedWords: ["wind", "breeze", "overcast", "cloud", "haze", "fog", "rain", "wave", "sound of", "rustling"] };
  }
  if (/(underwater|해저|잠수|심해|ocean floor)/i.test(lower)) {
    return { environmentType: "underwater", bannedWords: ["wind", "breeze", "sun", "overcast", "dry"] };
  }
  if (/(space|우주|무중력|zero.?g)/i.test(lower)) {
    return { environmentType: "space", bannedWords: ["wind", "breeze", "overcast", "rain", "sound", "rustling"] };
  }
  return { environmentType: "earth_outdoor", bannedWords: [] };
}

/**
 * 결정론적 컷 생성 — Gemini 응답 없이 입력 데이터만으로 컷 생성.
 * sceneType 글로벌 규칙 유지 (lunar 등).
 */
function buildDeterministicCuts(
  storyText: string,
  directorName: string,
  cutCount: number,
  secPerCut: number,
  videoStyle: string,
  regionFlavor: string,
  animationMode: string,
  editorialPersona?: EditorialPersona,
  directorStyle?: string,
  aspectRatio?: string,
) {
  const physics = getPhysicsForScene(storyText);
  const storyExcerpt = storyText.slice(0, 200);
  const shotCycle = ["WS", "MS", "CU", "OTS", "MCU", "LS", "ECU", "POV", "MLS"];
  const purposeCycle = ["establish", "develop", "climax", "resolve"];
  // editorial persona에 따른 카메라 움직임 기본값
  const epMotion = editorialPersona?.motionBias;
  const movementCycle = epMotion === "static" || epMotion === "minimal"
    ? [
        "locked-off static camera — stillness emphasizes composition",
        "near-static camera with subtle creeping movement",
        "locked-off static — contained observation",
        "minimal dolly — restrained lateral drift",
        "static frame — subject moves within fixed composition",
      ]
    : epMotion === "frenetic" || epMotion === "dynamic"
      ? [
          "handheld tracking following subject",
          "quick dolly forward with energy",
          "whip pan to new element",
          "active tracking — subject-led camera",
          "push-in with urgency",
        ]
      : [
          "slow pan revealing space and atmosphere",
          "subtle dolly forward as subject is introduced",
          "slow push-in as tension builds",
          "locked-off static — contained reaction",
          "restrained reframing as focus narrows",
        ];

  const editorialTag = editorialPersona ? `. ${buildCompactEditorialSummary(editorialPersona)}` : "";
  // 감독 스타일 핑거프린트: 이름 태그 대신 실제 스타일 키워드 사용
  const fallbackStyleFP = directorStyle
    ? directorStyle.split(/[,;|]/).slice(0, 3).map(s => s.trim()).filter(Boolean).join(", ")
    : directorName;
  const noTextSuffix = `${videoStyle}, ${fallbackStyleFP}, ${aspectRatio} aspect ratio, no text, no watermark, no captions${editorialTag}`;

  // 물리 규칙에 따른 lighting
  const defaultLighting = physics.environmentType === "lunar"
    ? "Unfiltered direct sunlight from upper right, harsh white, pitch-black shadow."
    : physics.environmentType === "underwater"
      ? "Scattered daylight filtering through water, blue-green glow, soft caustics."
      : "Golden hour warm light from left. Teal and orange grade.";

  // 물리 규칙에 따른 banned word 필터
  const cleanText = (text: string) => {
    let cleaned = text;
    for (const banned of physics.bannedWords) {
      cleaned = cleaned.replace(new RegExp(`\\b${banned}\\b`, "gi"), "");
    }
    return cleaned.replace(/\s{2,}/g, " ").trim();
  };

  const cuts = Array.from({ length: cutCount }, (_, i) => {
    const cutNumber = i + 1;
    const shotType = shotCycle[i % shotCycle.length];
    const purpose = i === 0 ? "establish" : i === cutCount - 1 ? "resolve" : purposeCycle[Math.min(i, purposeCycle.length - 1)];
    const cameraMovement = movementCycle[i % movementCycle.length];
    const subjectAction = i === 0 ? "camera reveals the space and atmosphere" : `subject moves through scene ${cutNumber}`;

    const shotLabel: Record<string, string> = { ECU: "Extreme close-up", CU: "Close-up", MCU: "Medium close-up", MS: "Medium shot", MLS: "Medium long shot", LS: "Long shot", WS: "Wide shot", OTS: "Over-the-shoulder", POV: "Point-of-view" };
    const shotDesc = shotLabel[shotType] || shotType;

    const imagePrompt = cleanText(`${shotDesc} shot, eye-level. Scene from: ${storyExcerpt.slice(0, 60)}. ${defaultLighting} ${noTextSuffix}`);
    const videoPrompt = cleanText(`${shotDesc} shot, eye-level. ${cameraMovement}. Scene ${cutNumber}: ${storyExcerpt.slice(0, 80)}. ${defaultLighting} ${noTextSuffix}`);
    const endImagePrompt = cleanText(`Scene ${cutNumber} concludes. ${noTextSuffix}`);

    const videoPromptJson: VideoPromptJson = {
      shotSize: shotType,
      cameraAngle: "eye-level",
      cameraMovement,
      subjectBlocking: "subject center-frame mid-ground",
      subjectAction,
      actionBeat: subjectAction,
      bodySignal: "",
      revealed: "new visual layer",
      withheld: "",
      timingBeat: `0s-${Math.ceil(secPerCut / 3)}s: establishing. ${Math.ceil(secPerCut / 3)}s-${Math.ceil(secPerCut * 2 / 3)}s: develop. ${Math.ceil(secPerCut * 2 / 3)}s-${secPerCut}s: resolve.`,
      transitionFromPrev: i > 0 ? "cut" : "",
      characterRef: "",
      moodLighting: defaultLighting,
      styleSuffix: noTextSuffix,
      locationCue: "",
      situationCue: "",
      emotionalAnchor: "",
    };

    return {
      cutNumber,
      durationSec: secPerCut,
      purpose,
      sceneDescription: `장면 ${cutNumber}`,
      shotType,
      subjectAction,
      emotionalDelta: i === 0 ? "opening→neutral" : "neutral→neutral",
      shotCategory: i === 0 ? "environment" as const : "character-driven" as const,
      characterRole: i === 0 ? "absent" as const : "protagonist" as const,
      cameraDirection: `Lens 35mm. ${cameraMovement.slice(0, 30)}. ${directorName} style.`,
      moodLighting: defaultLighting,
      imagePrompt,
      endImagePrompt,
      videoPrompt,
      extendPrompt: i === 0 ? "" : `Continuing from previous scene. ${cameraMovement}. ${noTextSuffix}`,
      transitionHint: i < cutCount - 1 ? "디졸브" : "페이드 아웃",
      characterConsistency: "",
      charactersInScene: [] as string[],
      videoPromptJson,
    };
  });

  return cuts;
}

// ─── Missing-cut 복구 ────────────────────────────────────────────────────────
/**
 * partial recovery로 일부 outline만 받은 경우, 누락된 컷만 재요청.
 * 전체 재생성보다 훨씬 적은 토큰으로 복구 가능.
 */
async function repairMissingOutlines(
  env: GeminiEnv,
  existingOutlines: CutOutline[],
  totalCutCount: number,
  directorNameKo: string,
  secPerCut: number,
  storyExcerpt: string,
): Promise<CutOutline[]> {
  const existingNums = new Set(existingOutlines.map(o => o.cutNumber));
  const missingNums: number[] = [];
  for (let i = 1; i <= totalCutCount; i++) {
    if (!existingNums.has(i)) missingNums.push(i);
  }
  if (missingNums.length === 0) return existingOutlines;

  console.info(`[cuts:step1:repair] missing cuts: [${missingNums.join(",")}] (${missingNums.length}/${totalCutCount})`);

  // 기존 컷 컨텍스트 축약
  const contextSummary = existingOutlines
    .map(o => `CUT${o.cutNumber}:${o.shotType}/${o.purpose}/"${o.sceneKo}"`)
    .join("; ");

  const prompt = `JSON만 출력. 감독:${directorNameKo}. ${secPerCut}초/시퀀스.
기존 컷: ${contextSummary}
시나리오: ${storyExcerpt.slice(0, 300)}

누락된 컷 번호 [${missingNums.join(",")}]의 outlines만 생성:
[{"cutNumber":${missingNums[0]},"sceneKo":"≤25자","emotion":"영어","emotionalDelta":"prev→cur","purpose":"establish|develop|climax|resolve","shotType":"WS|MS|CU|OTS|MCU|LS|ECU|POV","cameraMovement":"≤8w","subjectAction":"≤10w","transitionHint":"≤8자","shotCategory":"character-driven|environment|object-detail|map-graphic|transition-atmosphere","characterRole":"protagonist|background|silhouette|partial|absent","locationCue":"≤6w","situationCue":"≤6w","emotionalAnchor":"≤6w"}]`;

  const maxTokens = Math.min(8192, Math.max(2048, missingNums.length * 400));
  const result = await streamingGenerate(env, MODEL_OUTLINE, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
  }, { timeoutMs: 20_000 });

  if (result.error || result.timedOut || !result.text) {
    console.warn(`[cuts:step1:repair] repair failed: ${result.error?.slice(0, 200) ?? "timeout"}`);
    return existingOutlines;
  }

  const repaired = safeParseArr(result.text);
  if (!repaired || repaired.length === 0) {
    console.warn(`[cuts:step1:repair] repair parse failed. responseLen=${result.text.length}`);
    return existingOutlines;
  }

  console.info(`[cuts:step1:repair] repaired ${repaired.length} cuts`);

  // 기존 + 보충 합산 후 cutNumber 기준 정렬
  const shotCycle = ["WS", "MS", "CU", "OTS", "MCU", "LS", "ECU", "POV", "MLS"];
  const validCategories: ShotCategory[] = ["character-driven", "environment", "object-detail", "map-graphic", "transition-atmosphere"];
  const validRoles: CharacterRole[] = ["protagonist", "background", "silhouette", "partial", "absent"];

  const repairedOutlines: CutOutline[] = (repaired as Array<Partial<CutOutline>>).map((o, i) => {
    const rawCategory = String(o.shotCategory ?? "character-driven");
    const rawRole = String(o.characterRole ?? "protagonist");
    return {
      cutNumber: Number(o.cutNumber ?? missingNums[i] ?? existingOutlines.length + i + 1),
      sceneKo: String(o.sceneKo ?? `장면 ${o.cutNumber ?? i + 1}`).slice(0, 40),
      emotion: String(o.emotion ?? "neutral"),
      emotionalDelta: String(o.emotionalDelta ?? "neutral→neutral"),
      purpose: String(o.purpose ?? "develop"),
      shotType: String(o.shotType ?? shotCycle[i % shotCycle.length]),
      cameraMovement: String(o.cameraMovement ?? "slow push-in"),
      subjectAction: String(o.subjectAction ?? `action in scene ${o.cutNumber ?? i + 1}`),
      transitionHint: String(o.transitionHint ?? "디졸브").slice(0, 20),
      shotCategory: (validCategories.includes(rawCategory as ShotCategory) ? rawCategory : "character-driven") as ShotCategory,
      characterRole: (validRoles.includes(rawRole as CharacterRole) ? rawRole : "protagonist") as CharacterRole,
      locationCue: String(o.locationCue ?? "identifiable location elements"),
      situationCue: String(o.situationCue ?? "visible situation evidence"),
      emotionalAnchor: String(o.emotionalAnchor ?? "emotional focal point"),
      sceneBeat1: String(o.sceneBeat1 ?? o.locationCue ?? "location-identifying objects"),
      sceneBeat2: String(o.sceneBeat2 ?? o.situationCue ?? "situation evidence visible"),
      sceneBeat3: String(o.sceneBeat3 ?? o.emotionalAnchor ?? "emotional anchor revealed"),
      endHook: String(o.endHook ?? "visual tension toward next scene"),
    };
  });

  const merged = [...existingOutlines, ...repairedOutlines];
  merged.sort((a, b) => a.cutNumber - b.cutNumber);

  // 중복 cutNumber 제거 (기존 우선)
  const seen = new Set<number>();
  const deduped = merged.filter(o => {
    if (seen.has(o.cutNumber)) return false;
    seen.add(o.cutNumber);
    return true;
  });

  console.info(`[cuts:step1:repair] merged result: ${deduped.length}/${totalCutCount} cuts`);
  return deduped;
}

/**
 * Ultra-compact step1 프롬프트 — 토큰 최소화.
 * compact retry 실패 시 마지막 시도.
 */
function buildUltraCompactStep1Prompt(
  storyText: string,
  directorNameKo: string,
  cutCount: number,
  secPerCut: number,
  editorialSummary?: string,
): string {
  const storySnippet = storyText.slice(0, 400);
  return `JSON만 출력. 감독: ${directorNameKo}. ${secPerCut}초/시퀀스 × ${cutCount}컷. 6~9초→최소3컷,10~15초→4~6컷,16초이상→생성불가,반드시${cutCount}개outlines작성.${editorialSummary ? `\n${editorialSummary}` : ""}
시나리오: ${storySnippet}

{"characterSeeds":[{"id":"char-1","label":"주인공","appearance":"...≤20w","appearanceKo":"...≤15자"}],
"outlines":[{"cutNumber":1,"sceneKo":"≤20자","emotion":"영어","emotionalDelta":"prev→cur","purpose":"establish|develop|climax|resolve","shotType":"WS|MS|CU|OTS|MCU|LS|ECU|POV","cameraMovement":"≤6w","subjectAction":"≤8w","transitionHint":"≤6자","shotCategory":"character-driven|environment|object-detail|map-graphic|transition-atmosphere","characterRole":"protagonist|background|silhouette|partial|absent","locationCue":"≤5w","situationCue":"≤5w","emotionalAnchor":"≤5w"}]}`;
}

// ─── Fast path eligibility evaluator ──────────────────────────────────────────

interface FastPathEligibility {
  eligible: boolean;
  reason: string;
  checks: {
    durationOk: boolean;
    cutCountOk: boolean;
    outlineQualityOk: boolean;
    step1Healthy: boolean;
    storyComplexityOk: boolean;
    narrativeFunctionsClear: boolean;
  };
}

function evaluateFastPathEligibility(opts: {
  totalDurationSec: number;
  targetCuts: number;
  outlines: { sceneKo?: string; shotType?: string; cameraMovement?: string; subjectAction?: string; sceneBeat1?: string; sceneBeat2?: string; sceneBeat3?: string; narrativeFunction?: string; purpose?: string }[];
  step1Degraded: boolean;
  storyText: string;
}): FastPathEligibility {
  const durationOk = opts.totalDurationSec <= FAST_PATH_MAX_DURATION_SEC;
  const cutCountOk = opts.targetCuts <= FAST_PATH_MAX_CUTS;

  const outlineQualityOk = opts.outlines.length > 0 && opts.outlines.every(o =>
    o.sceneKo && o.shotType && o.cameraMovement && o.subjectAction && o.sceneBeat1 && o.sceneBeat2 && o.sceneBeat3
  );

  const step1Healthy = !opts.step1Degraded;

  // Story complexity heuristic: multiple dialogue markers, scene transitions, or character names
  // suggest higher complexity that benefits from step2/3 detail enrichment
  const dialogueMarkers = (opts.storyText.match(/["""「」『』]/g) || []).length;
  const sceneTransitions = (opts.storyText.match(/[—\-]{2,}|장면|씬|전환|그러나|하지만|그때/g) || []).length;
  const storyComplexityOk = dialogueMarkers <= 6 && sceneTransitions <= 4;

  // Check if narrative functions are clearly identified (non-empty and distinct)
  const narrativeFns = opts.outlines.map(o => o.narrativeFunction || o.purpose || "").filter(Boolean);
  const narrativeFunctionsClear = narrativeFns.length >= opts.outlines.length * 0.7;

  const checks = { durationOk, cutCountOk, outlineQualityOk, step1Healthy, storyComplexityOk, narrativeFunctionsClear };
  const eligible = durationOk && cutCountOk && outlineQualityOk && step1Healthy && storyComplexityOk;

  let reason: string;
  if (eligible) {
    reason = "shortform + simple story + quality outlines";
  } else {
    const fails: string[] = [];
    if (!durationOk) fails.push(`duration ${opts.totalDurationSec}s > ${FAST_PATH_MAX_DURATION_SEC}s`);
    if (!cutCountOk) fails.push(`cuts ${opts.targetCuts} > ${FAST_PATH_MAX_CUTS}`);
    if (!outlineQualityOk) fails.push("outline quality insufficient");
    if (!step1Healthy) fails.push("step1 degraded");
    if (!storyComplexityOk) fails.push(`story too complex (dialogue=${dialogueMarkers}, transitions=${sceneTransitions})`);
    reason = fails.join("; ");
  }

  return { eligible, reason, checks };
}

// ─── generationMeta rationale builder ─────────────────────────────────────────

function buildRationale(opts: {
  bandPolicy: { band: string; isShortformBand: boolean; is13to15Special: boolean; minCuts: number };
  shortformPlan: { directorPaceDownweighted: boolean; reconciliationNotes: string[] };
  directorPaceWasDownweighted: boolean;
  step1Degraded: boolean;
  step1DegradedReason: string;
  outlineOnly: boolean;
  targetCuts: number;
  secPerCut: number;
}): string[] {
  const r: string[] = [];
  if (opts.bandPolicy.is13to15Special) {
    r.push(`13-15초 숏폼 리듬을 위해 최소 ${opts.bandPolicy.minCuts}컷을 유지했습니다.`);
  } else if (opts.bandPolicy.isShortformBand) {
    r.push(`${opts.bandPolicy.band} 밴드 정책: 최소 ${opts.bandPolicy.minCuts}컷.`);
  }
  if (opts.directorPaceWasDownweighted || opts.shortformPlan.directorPaceDownweighted) {
    r.push("감독 페이스보다 장면 전개 리듬을 우선해 컷 길이를 압축했습니다.");
  }
  if (opts.step1Degraded) {
    r.push(`자동 조정됨: ${opts.step1DegradedReason.slice(0, 100)}`);
  }
  if (opts.outlineOnly) {
    r.push("Outline-only path로 생성됨 — 디테일이 제한적일 수 있습니다.");
  }
  for (const note of opts.shortformPlan.reconciliationNotes) {
    if (!r.some(existing => existing.includes(note.slice(0, 30)))) {
      r.push(note);
    }
  }
  return r;
}

// ─── 메인 핸들러 ──────────────────────────────────────────────────────────────

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const {
      storyText,
      directorName,
      directorNameKo,
      directorStyle,
      directorPersona,
      directorTechniques,
      animationMode,
      aspectRatio,
      region,
      cutCount,
      cutDuration,
      preferredCutCountRange,
      totalDurationSeconds: rawTotalDuration,
      generationPersona,
      characterPersonas,
      scriptAnalysisHint,
      continuityMode,
      continuitySegmentIndex,
      continuityPrevEndState,
      continuityGlobalAnchors,
      continuitySegmentRole,
      continuityIsLastSegment,
    } = await context.request.json() as Record<string, string | number | object>;

    // cutDuration=0/undefined/null → auto. 1~15 → 명시값. VEO: 8초 고정.
    const rawSecPerCut = Number(cutDuration) || 0;
    const rawCutCount = Number(cutCount) || 0;
    const totalDurationSec = Number(rawTotalDuration) || 0;

    // ── VEO 8초 segment planning ──
    const VEO_SEGMENT_CAP = 8;
    const estimatedSegmentCount = totalDurationSec > 0
      ? Math.ceil(totalDurationSec / VEO_SEGMENT_CAP)
      : 0;

    // ── preferredCutCountRange 파싱 ──
    const parsedRange = preferredCutCountRange && typeof preferredCutCountRange === "object"
      && "min" in (preferredCutCountRange as Record<string, unknown>)
      && "max" in (preferredCutCountRange as Record<string, unknown>)
      ? { min: Number((preferredCutCountRange as Record<string, number>).min), max: Number((preferredCutCountRange as Record<string, number>).max) }
      : undefined;

    // ── editorial persona 추출 ──
    const editorial = extractEditorialPersona(
      String(directorPersona || ""),
      String(directorStyle || ""),
      directorTechniques && typeof directorTechniques === "object"
        ? (directorTechniques as Record<string, string>).editingStyle
        : undefined,
    );

    // ── auto duration: totalDurationSeconds를 실제로 전달 ──
    const autoResult = computeServerAutoDuration(
      rawSecPerCut > 0 ? rawSecPerCut : undefined,
      totalDurationSec > 0 ? totalDurationSec : undefined,
      rawCutCount > 0 ? rawCutCount : undefined,
      undefined, // sceneType — 컷 생성 시점에서는 미정
      editorial.preferredCutPace,
    );
    let secPerCut = autoResult.duration;

    // ── targetCuts: resolveCutCount로 통합 결정 ──
    // 실제 totalDurationSec 사용. 없으면 segment cap × 추정 컷 수 기반.
    // 120초 입력이면 120초 전체를 기준으로 density 계산.
    const effectiveTotalForDensity = totalDurationSec > 0
      ? totalDurationSec
      : (rawCutCount > 0
        ? rawCutCount * secPerCut
        : VEO_SEGMENT_CAP); // 최소 단일 segment 기준
    const pBias = personaCutCountBias(editorial);

    // ── resolveSegmentPlan: 전체 시퀀스 → segment 단위 orchestration ──
    const segmentPlan = resolveSegmentPlan({
      totalDurationSec: effectiveTotalForDensity,
      exactCutCount: rawCutCount > 0 ? rawCutCount : undefined,
      preferredRange: parsedRange,
      personaBias: pBias,
      currentSegmentIndex: 0, // generate-cuts는 항상 첫 segment planning
    });

    // generate-cuts 1회 호출 = 전체 프로젝트의 모든 시퀀스를 한 번에 생성.
    // 각 시퀀스(cut)는 8초 VEO 1회 생성 단위. 내부 멀티샷은 multi-shot-planner가 관리.
    // 3-Layer: 총 런타임 → 시퀀스(여기서 cutCount) → 시퀀스 내 멀티샷(CutCard 레벨)
    const cutDecision = resolveCutCount({
      exactCutCount: rawCutCount > 0 ? rawCutCount : undefined,
      preferredRange: parsedRange,
      totalDurationSec: effectiveTotalForDensity,
      personaBias: pBias,
    });
    const targetCuts = Math.min(Math.max(cutDecision.cutCount, 3), CUT_COUNT_MAX);

    // ── secPerCut ↔ targetCuts 정합성 보정 ──
    // 핵심 문제: secPerCut은 감독 persona에서, targetCuts는 density에서 독립 계산.
    // 곱(secPerCut × targetCuts)이 totalDuration과 불일치하면
    // LLM이 "24초 기준 3컷" 프롬프트를 받고 15초 스토리에 2컷만 생성하는 원인이 됨.
    // 숏폼 리듬 > 감독 스타일: secPerCut을 totalDuration/targetCuts 이하로 제한.
    if (effectiveTotalForDensity > 0 && targetCuts > 1) {
      const naturalPerCut = Math.max(DURATION_MIN, Math.min(VEO_SEGMENT_CAP, Math.round(effectiveTotalForDensity / targetCuts)));
      if (secPerCut > naturalPerCut) {
        console.log(`[generate-cuts] secPerCut reconciliation: ${secPerCut}→${naturalPerCut} (${effectiveTotalForDensity}s / ${targetCuts}cuts, cap=${VEO_SEGMENT_CAP}s, persona wanted ${secPerCut}s)`);
        secPerCut = naturalPerCut;
      }
    }
    // ── 절대 상한: VEO 최대 8초 강제 ──
    if (secPerCut > VEO_SEGMENT_CAP) {
      console.warn(`[generate-cuts] secPerCut ${secPerCut}s exceeds VEO cap → clamping to ${VEO_SEGMENT_CAP}s`);
      secPerCut = VEO_SEGMENT_CAP;
    }

    // ── shortform reconciliation (full structured plan) ──
    const shortformPlan = reconcileShortformPlan({
      totalDurationSec: effectiveTotalForDensity,
      densityTargetCuts: cutDecision.cutCount,
      personaSecPerCut: autoResult.duration,
      personaBias: pBias,
      exactCutCount: rawCutCount > 0 ? rawCutCount : undefined,
    });
    const bandPolicy = resolveShortformBandPolicy(effectiveTotalForDensity);

    // Track whether director pace was downweighted in the inline reconciliation above
    const directorPaceWasDownweighted = secPerCut < autoResult.duration;
    const directorWeakenReason = directorPaceWasDownweighted
      ? `secPerCut ${autoResult.duration}→${secPerCut} (shortform rhythm > director pace)`
      : undefined;

    console.log("[generate-cuts] duration params", {
      rawCutDuration: cutDuration, secPerCut, targetCuts,
      totalDurationSec, estimatedSegmentCount,
      basis: autoResult.basis, editorial: editorial.preferredCutPace,
      cutDecision, parsedRange,
      shortformPlan: { band: bandPolicy.band, reconciled: shortformPlan.reconciled, downweighted: shortformPlan.directorPaceDownweighted },
    });

    if (!storyText || !directorName) {
      return Response.json({ error: "storyText and directorName required" }, { status: 400 });
    }

    const videoStyle = VIDEO_STYLE_MAP[String(animationMode)] ?? "photorealistic cinematic, subject-focused composition";
    const regionFlavor = REGION_FLAVOR_MAP[String(region)] ?? "cinematic atmosphere";

    // ── Temporal beat 템플릿 (duration-aware + persona-aware) ──────────────────
    // 짧은 컷일수록 beat 수가 적어야 한다. 한 cut = 1 visual goal 원칙 유지.
    const { beatTemplate, extendBeatTemplate } = buildDurationAwareBeatTemplate(secPerCut, editorial);

    const techniques = directorTechniques && typeof directorTechniques === "object"
      ? directorTechniques as Record<string, string>
      : null;
    const editingNote = techniques?.editingStyle
      ? `editing: ${String(techniques.editingStyle).slice(0, 60)}`
      : "";

    // ── 감독 연출 엔진 빌드 ───────────────────────────────────────────────────
    // 이름 태그가 아닌 실제 연출 방식 규칙으로 변환 → step2/3 프롬프트 전체를 지배
    const directorEngine = buildDirectorEngine(
      String(directorPersona ?? ""),
      String(directorStyle ?? ""),
      techniques,
      String(animationMode),
      editorial,
    );

    // ── 콘텐츠 모드 감지 (역사 재연 vs 일반) ─────────────────────────────────
    const contentMode = detectContentMode(String(storyText));
    console.info(`[generate-cuts] contentMode=${contentMode}`);

    // ── 페르소나 블록 빌드 ─────────────────────────────────────────────────
    const gpRaw = generationPersona && typeof generationPersona === "object"
      ? generationPersona as Record<string, boolean>
      : null;
    const cpRaw = Array.isArray(characterPersonas)
      ? characterPersonas as Array<Record<string, string>>
      : [];

    const generationPersonaBlock = buildGenerationPersonaBlock(gpRaw);
    const characterPersonaBlock  = buildCharacterPersonaBlock(cpRaw);

    if (generationPersonaBlock) {
      console.info(`[generate-cuts] generationPersona 주입: ${generationPersonaBlock.slice(0, 120)}…`);
    }
    if (characterPersonaBlock) {
      console.info(`[generate-cuts] characterPersonas 주입: ${cpRaw.length}명`);
    }

    // ── Continuity Mode 프롬프트 블록 빌드 ─────────────────────────────
    const isContinuityMode = continuityMode === true || continuityMode === "true";
    let continuityPromptBlock = "";
    if (isContinuityMode) {
      const segIdx = Number(continuitySegmentIndex) || 0;
      const segRole = String(continuitySegmentRole || "building");
      const isLast = continuityIsLastSegment === true || continuityIsLastSegment === "true";
      const anchors = continuityGlobalAnchors && typeof continuityGlobalAnchors === "object"
        ? continuityGlobalAnchors as Record<string, unknown>
        : null;
      const prevEnd = continuityPrevEndState && typeof continuityPrevEndState === "object"
        ? continuityPrevEndState as Record<string, unknown>
        : null;

      const cBlocks: string[] = [];

      // Character lock
      if (anchors?.character && typeof anchors.character === "object") {
        const ch = anchors.character as Record<string, unknown>;
        if (ch.primarySubjectDescription) {
          const lines = [
            "## CHARACTER LOCK (동일 인물 — 모든 세그먼트에서 절대 변경 금지)",
            `Subject: ${String(ch.primarySubjectDescription)}`,
          ];
          if (ch.clothingLock) lines.push(`Clothing: ${String(ch.clothingLock)}`);
          if (ch.bodyType) lines.push(`Body type: ${String(ch.bodyType)}`);
          const features = Array.isArray(ch.distinctiveFeatures) ? ch.distinctiveFeatures : [];
          if (features.length > 0) lines.push(`Distinctive features: ${features.join(", ")}`);
          lines.push("RULE: This character's appearance MUST NOT change across segments.");
          cBlocks.push(lines.join("\n"));
        }
      }

      // Visual lock
      if (anchors?.visual && typeof anchors.visual === "object") {
        const v = anchors.visual as Record<string, unknown>;
        const vLines = ["## VISUAL CONTINUITY LOCK (모든 세그먼트에서 동일 시각 스타일 유지)"];
        if (v.colorPalette) vLines.push(`Color palette: ${String(v.colorPalette)}`);
        if (v.lightingSetup) vLines.push(`Lighting: ${String(v.lightingSetup)}`);
        if (v.filmGrain) vLines.push(`Film texture: ${String(v.filmGrain)}`);
        if (v.contrastProfile) vLines.push(`Contrast: ${String(v.contrastProfile)}`);
        vLines.push("RULE: Visual style MUST NOT shift between segments.");
        if (vLines.length > 2) cBlocks.push(vLines.join("\n"));
      }

      // Continuation from previous segment
      if (prevEnd && segIdx > 0) {
        const pLines = [
          "## CONTINUATION FROM PREVIOUS SEGMENT (이전 구간의 마지막 상태에서 이어받아 시작)",
          "Previous segment ended with:",
        ];
        if (prevEnd.subjectPosition) pLines.push(`- Subject: ${String(prevEnd.subjectPosition)}`);
        if (prevEnd.cameraState) pLines.push(`- Camera: ${String(prevEnd.cameraState)}`);
        if (prevEnd.emotionKeyword) pLines.push(`- Emotion: ${String(prevEnd.emotionKeyword)} (intensity: ${Number(prevEnd.emotionIntensity) || 0}/100)`);
        if (prevEnd.motionVector) pLines.push(`- Motion: ${String(prevEnd.motionVector)}`);
        if (prevEnd.lightingState) pLines.push(`- Lighting: ${String(prevEnd.lightingState)}`);
        pLines.push("");
        pLines.push("THIS segment MUST START from exactly this state.");
        pLines.push("First 2 seconds: seamless continuation — DO NOT re-establish, DO NOT reset camera, DO NOT change lighting.");
        cBlocks.push(pLines.join("\n"));
      }

      // Segment ending rule (not last segment)
      if (!isLast) {
        cBlocks.push([
          "## SEGMENT ENDING RULE (이 세그먼트는 영상의 중간 구간이다)",
          "LAST 2 SECONDS: character mid-action, camera still moving, emotion unresolved — DO NOT close the scene, DO NOT resolve the action, maintain forward momentum",
          "BANNED: emotional resolution, narrative closure, character turning away, fade-to-black feeling",
          "REQUIRED: forward momentum — viewer must feel the story continues immediately after this clip ends",
        ].join("\n"));
      }

      // Narrative position
      cBlocks.push(`## NARRATIVE POSITION: Segment ${segIdx + 1} — Role: ${segRole.toUpperCase()}`);

      continuityPromptBlock = cBlocks.join("\n\n");
      console.info(`[generate-cuts] continuity mode: segment=${segIdx}, role=${segRole}, isLast=${isLast}, blockLen=${continuityPromptBlock.length}`);
    }

    // ── Deep Analysis standard-lite ────────────────────────────────────────
    let deepAnalysisBriefBlock = "";
    let deepAnalysisMeta: Record<string, unknown> | undefined;
    try {
      const daResult = runDeepAnalysis({
        storyText: String(storyText),
        totalDurationSec: totalDurationSec > 0 ? totalDurationSec : 30,
        cutCount: targetCuts,
        animationMode: String(animationMode || ""),
        directorStyle: String(directorStyle || ""),
        continuityMode: isContinuityMode,
        characterCount: 1, // step1 전이라 정확한 수를 모름, 보수적 기본값
      });
      deepAnalysisBriefBlock = serializePromptBrief(daResult.promptBrief);
      deepAnalysisMeta = {
        tone: daResult.storyIntent.tone,
        genre: daResult.storyIntent.genre,
        pacing: daResult.storyIntent.pacing,
        emotionalArc: daResult.storyIntent.emotionalArc,
        protagonistFocus: daResult.storyIntent.protagonistFocus,
        continuityRisk: daResult.generationRisk.continuityRisk,
        subjectCountRisk: daResult.generationRisk.subjectCountRisk,
        sceneSwitchRisk: daResult.generationRisk.sceneSwitchRisk,
        visualDensity: daResult.visualStrategy.visualDensity,
        cameraEnergy: daResult.visualStrategy.cameraEnergy,
        realismLevel: daResult.visualStrategy.realismLevel,
        analysisMs: daResult.analysisMs,
        warnings: daResult.warnings.length > 0 ? daResult.warnings : undefined,
      };
      if (deepAnalysisBriefBlock) {
        console.info(`[generate-cuts] deep analysis brief injected (${daResult.analysisMs}ms): ${deepAnalysisBriefBlock.slice(0, 150)}…`);
      }
    } catch (e) {
      console.warn("[generate-cuts] deep analysis failed, continuing without:", e instanceof Error ? e.message : String(e));
    }

    // ── Latency tracking ──────────────────────────────────────────────────────
    const t0_total = Date.now();
    let t0_step1 = 0, t1_step1 = 0;
    let t0_step23 = 0, t1_step23 = 0;
    let t0_postprocess = 0, t1_postprocess = 0;
    let fallbackLatencyMs = 0;
    const skippedSteps: string[] = [];
    let fastPathUsed = false;

    // ── Timeout tracking ──────────────────────────────────────────────────────
    let timedOutAtStep1 = false;
    let timedOutAtUltra = false;
    let timeoutPathUsed: "none" | "ultra-compact" | "deterministic" = "none";

    // ── Pre-step1 fast path candidate check (duration/cuts only) ─────────
    const isFastPathCandidate =
      effectiveTotalForDensity <= FAST_PATH_MAX_DURATION_SEC
      && targetCuts <= FAST_PATH_MAX_CUTS;

    if (isFastPathCandidate) {
      console.log("[generate-cuts] fast path candidate: short/simple request", {
        totalDuration: effectiveTotalForDensity,
        targetCuts,
        threshold: `≤${FAST_PATH_MAX_DURATION_SEC}s, ≤${FAST_PATH_MAX_CUTS}cuts`,
      });
    }

    // ── STEP 1: 아웃라인 생성 ─────────────────────────────────────────────────
    let characterSeeds: CharacterSeed[];
    let outlines: CutOutline[];

    let step1Degraded = false;
    let step1DegradedReason = "";
    const step1Warnings: string[] = [];

    t0_step1 = Date.now();
    try {
      // ── editorial planning block 빌드 ──
      const editorialPlanningBlock = buildEditorialPlanningRules(editorial);

      ({ characterSeeds, outlines } = await step1Outlines(
        context.env,
        String(storyText),
        String(directorNameKo || directorName),
        String(directorPersona ?? ""),
        targetCuts,
        secPerCut,
        contentMode,
        generationPersonaBlock,
        characterPersonaBlock,
        editorialPlanningBlock,
        scriptAnalysisHint ? String(scriptAnalysisHint) : undefined,
        continuityPromptBlock || undefined,
        deepAnalysisBriefBlock || undefined,
      ));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isProviderError = msg.startsWith("PROVIDER_ERROR:");
      const isTruncation = !isProviderError && (msg.includes("MAX_TOKENS") || msg.includes("truncat"));
      const isTimeout = msg.includes("TIMEOUT") || msg.includes("524") || msg.includes("timed out");
      console.error("[generate-cuts] step1 failed:", msg, "isProviderError:", isProviderError, "isTruncation:", isTruncation, "isTimeout:", isTimeout);

      // ── Provider error (503/429/5xx) — retry with backoff, then fallback ──
      if (isProviderError && !isTimeout) {
        const providerStatus = parseInt(msg.split(":")[1], 10) || 503;
        console.warn(`[generate-cuts] step1 provider error (${providerStatus}) — retrying with backoff`);
        step1Warnings.push(`step1 provider error: ${providerStatus}`);

        let retrySuccess = false;
        for (let attempt = 1; attempt <= 2; attempt++) {
          const backoffMs = attempt * 2000; // 2s, 4s
          console.info(`[generate-cuts] provider retry ${attempt}/2 — waiting ${backoffMs}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));

          try {
            const editorialPlanningBlock = buildEditorialPlanningRules(editorial);
            ({ characterSeeds, outlines } = await step1Outlines(
              context.env,
              String(storyText),
              String(directorNameKo || directorName),
              String(directorPersona ?? ""),
              targetCuts,
              secPerCut,
              contentMode,
              generationPersonaBlock,
              characterPersonaBlock,
              editorialPlanningBlock,
              scriptAnalysisHint ? String(scriptAnalysisHint) : undefined,
              continuityPromptBlock || undefined,
              deepAnalysisBriefBlock || undefined,
            ));
            retrySuccess = true;
            step1Degraded = true;
            step1DegradedReason = `provider ${providerStatus} → retry ${attempt} succeeded`;
            step1Warnings.push(step1DegradedReason);
            break;
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            console.warn(`[generate-cuts] provider retry ${attempt}/2 failed:`, retryMsg.slice(0, 200));
          }
        }

        // Pro 재시도 실패 → Flash 모델로 폴백 시도 (품질 저하 감수)
        if (!retrySuccess && providerStatus === 429) {
          console.warn("[generate-cuts] step1 Pro 429 exhausted — trying Flash model fallback");
          try {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const editorialPlanningBlock = buildEditorialPlanningRules(editorial);
            ({ characterSeeds, outlines } = await step1Outlines(
              context.env,
              String(storyText),
              String(directorNameKo || directorName),
              String(directorPersona ?? ""),
              targetCuts,
              secPerCut,
              contentMode,
              generationPersonaBlock,
              characterPersonaBlock,
              editorialPlanningBlock,
              scriptAnalysisHint ? String(scriptAnalysisHint) : undefined,
              continuityPromptBlock || undefined,
              deepAnalysisBriefBlock || undefined,
              GEMINI_MODEL_FLASH,
            ));
            retrySuccess = true;
            step1Degraded = true;
            step1DegradedReason = `Pro 429 → Flash model fallback 성공 (품질 저하 가능)`;
            step1Warnings.push(step1DegradedReason);
          } catch (flashErr) {
            const flashMsg = flashErr instanceof Error ? flashErr.message : String(flashErr);
            console.warn("[generate-cuts] Flash fallback also failed:", flashMsg.slice(0, 200));
          }
        }

        if (!retrySuccess) {
          // All retries + Flash fallback failed — return error
          const is429 = providerStatus === 429;
          return Response.json({
            ok: false,
            degraded: false,
            error: is429
              ? "AI 모델 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요."
              : "현재 AI 모델 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.",
            detail: msg.slice(0, 300),
            step: 1,
            cause: is429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_UNAVAILABLE",
            source: "gemini",
            retryable: true,
            warnings: step1Warnings,
          }, { status: providerStatus });
        }
      }

      if (isTruncation && !isTimeout) {
        // ── 자동 감축 재시도: cutCount 절반으로 줄여서 1회 재시도 ──
        const reducedCuts = Math.max(4, Math.floor(targetCuts / 2));
        console.warn(`[generate-cuts] step1 MAX_TOKENS — auto-retry with reduced cutCount: ${targetCuts} → ${reducedCuts}`);

        try {
          const editorialPlanningBlock = buildEditorialPlanningRules(editorial);
          const retryResult = await step1Outlines(
            context.env,
            String(storyText).slice(0, 600), // 스토리도 축약
            String(directorNameKo || directorName),
            String(directorPersona ?? ""),
            reducedCuts,
            secPerCut,
            contentMode,
            generationPersonaBlock,
            characterPersonaBlock,
            editorialPlanningBlock,
            undefined, // scriptAnalysisHint
            continuityPromptBlock || undefined,
            deepAnalysisBriefBlock || undefined,
          );
          characterSeeds = retryResult.characterSeeds;
          outlines = retryResult.outlines;
          step1Degraded = true;
          step1DegradedReason = `토큰 초과 → 자동 감축 (${targetCuts}→${reducedCuts}컷)`;
          step1Warnings.push(step1DegradedReason);
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          console.error("[generate-cuts] auto-retry also failed:", retryMsg);
          return Response.json({
            ok: false,
            degraded: false,
            error: `장면 설계 토큰 초과 — 자동 감축(${reducedCuts}컷)도 실패. 스토리를 축소해주세요.`,
            detail: retryMsg,
            step: 1,
            cause: "MAX_TOKENS",
            source: "gemini",
            warnings: [`원본 ${targetCuts}컷 실패`, `감축 ${reducedCuts}컷도 실패`],
          }, { status: 422 });
        }
      }

      // ── Timeout/API error → ultra-compact retry → deterministic fallback ──
      if (isTimeout) {
        timedOutAtStep1 = true;
        console.warn("[generate-cuts] step1 timeout — attempting ultra-compact retry");
        step1Warnings.push(`step1 timed out: ${msg.slice(0, 200)}`);

        try {
          const ultraPrompt = buildUltraCompactStep1Prompt(
            String(storyText),
            String(directorNameKo || directorName),
            targetCuts,
            secPerCut,
            buildCompactEditorialSummary(editorial),
          );
          console.info(`[generate-cuts] ultra-compact retry: maxTokens=${STEP1_ULTRA_MAX_TOKENS} timeoutMs=${STEP1_ULTRA_TIMEOUT_MS}`);
          const retryResult = await streamingGenerate(context.env, MODEL_OUTLINE, {
            contents: [{ role: "user", parts: [{ text: ultraPrompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: STEP1_ULTRA_MAX_TOKENS, responseMimeType: "application/json" },
          }, { timeoutMs: STEP1_ULTRA_TIMEOUT_MS });

          if (!retryResult.error && !retryResult.timedOut) {
            const parsed = safeParseObj(retryResult.text);
            if (parsed && Array.isArray(parsed.outlines) && (parsed.outlines as unknown[]).length > 0) {
              console.info("[generate-cuts] ultra-compact retry succeeded");
              step1Warnings.push("step1 recovered via ultra-compact retry");
              step1Degraded = true;
              step1DegradedReason = "step1 timeout → ultra-compact retry succeeded";
              timeoutPathUsed = "ultra-compact";
              // Parse outlines/seeds from ultra-compact (reuse existing parsing logic inline)
              characterSeeds = Array.isArray(parsed.characterSeeds)
                ? (parsed.characterSeeds as Array<Partial<CharacterSeed>>).map(s => ({
                    id: String(s.id ?? "char-1"),
                    label: String(s.label ?? "주인공"),
                    appearance: String(s.appearance ?? "A young person, casual modern clothing").slice(0, 400),
                    appearanceKo: String(s.appearanceKo ?? "캐주얼 의상의 젊은 인물").slice(0, 50),
                  }))
                : [{ id: "char-1", label: "주인공", appearance: "A young person, casual modern clothing", appearanceKo: "캐주얼 의상의 젊은 인물" }];
              const shotCycleF = ["WS", "MS", "CU", "OTS", "MCU", "LS", "ECU", "POV", "MLS"];
              outlines = (parsed.outlines as Array<Partial<CutOutline>>).map((o, i) => ({
                cutNumber: Number(o.cutNumber ?? i + 1),
                sceneKo: String(o.sceneKo ?? `장면 ${i + 1}`).slice(0, 40),
                emotion: String(o.emotion ?? "neutral"),
                emotionalDelta: String(o.emotionalDelta ?? "neutral→neutral"),
                purpose: String(o.purpose ?? "develop"),
                shotType: String(o.shotType ?? shotCycleF[i % shotCycleF.length]),
                cameraMovement: String(o.cameraMovement ?? "slow push-in"),
                subjectAction: String(o.subjectAction ?? `action in scene ${i + 1}`),
                transitionHint: String(o.transitionHint ?? "디졸브").slice(0, 20),
                shotCategory: (o.shotCategory ?? "character-driven") as ShotCategory,
                characterRole: (o.characterRole ?? "protagonist") as CharacterRole,
                locationCue: String(o.locationCue ?? "location elements"),
                situationCue: String(o.situationCue ?? "situation evidence"),
                emotionalAnchor: String(o.emotionalAnchor ?? "emotional point"),
                // sceneBeat/endHook: cue 기반 자동 합성 (ultra-compact에서는 대부분 생략됨)
                sceneBeat1: String(o.sceneBeat1 ?? o.locationCue ?? "location establishing"),
                sceneBeat2: String(o.sceneBeat2 ?? o.situationCue ?? "situation visible"),
                sceneBeat3: String(o.sceneBeat3 ?? o.emotionalAnchor ?? "emotion revealed"),
                endHook: String(o.endHook ?? "visual tension"),
              }));
              // Jump to post-step1 processing (outlines already set)
            } else {
              throw new Error("ultra-compact parse failed");
            }
          } else {
            timedOutAtUltra = !!retryResult.timedOut;
            throw new Error(`ultra-compact also failed: ${retryResult.error?.slice(0, 200) ?? "timeout"}`);
          }
        } catch (retryErr) {
          // ── Both Gemini attempts failed → deterministic fallback ──
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          console.warn("[generate-cuts] ultra-compact retry also failed:", retryMsg, "→ deterministic fallback");
          step1Warnings.push(`ultra-compact retry failed: ${retryMsg.slice(0, 200)}`);
          step1Warnings.push("falling back to deterministic cut generation (no Gemini)");
          timeoutPathUsed = "deterministic";

          const deterministicCuts = buildDeterministicCuts(
            String(storyText),
            String(directorName),
            targetCuts,
            secPerCut,
            videoStyle,
            regionFlavor,
            String(animationMode),
            editorial,
            String(directorStyle ?? ""),
            String(aspectRatio ?? "16:9"),
          );

          const defaultSeeds: CharacterSeed[] = [{
            id: "char-1",
            label: "주인공",
            appearance: "A young person, casual modern clothing, natural look",
            appearanceKo: "캐주얼 의상의 젊은 인물",
          }];

          const finalizedCuts = classifyCuts(densifyCuts(deterministicCuts));
          for (const fc of finalizedCuts) { if (fc.durationSec > VEO_SEGMENT_CAP) fc.durationSec = VEO_SEGMENT_CAP; }
          repairMultiShotMinimums(finalizedCuts);
          const sequencePlan = buildSequencePlanFromCuts(finalizedCuts, {
            styleId: String(animationMode || "live-action"),
            aspectRatio: (aspectRatio === "9:16" ? "9:16" : "16:9"),
            directorId: String(directorName || ""),
          });
          const sequenceValidation = validateSequencePlan(sequencePlan);

          return Response.json({
            ok: true,
            degraded: true,
            reason: `step1 timeout (${msg.slice(0, 100)}) → ultra-compact retry failed → deterministic fallback`,
            source: "deterministic-fallback",
            warnings: step1Warnings,
            characterSeeds: defaultSeeds,
            cuts: finalizedCuts,
            sequencePlan,
            sequenceValidation,
            secPerCut,
          } satisfies GenerateCutsResponse);
        }
      } else {
        // Non-timeout, non-truncation error → still try deterministic fallback instead of 502
        console.warn("[generate-cuts] step1 API error (non-timeout) — deterministic fallback");
        step1Warnings.push(`step1 API error: ${msg.slice(0, 200)}`);
        step1Warnings.push("falling back to deterministic cut generation");

        const deterministicCuts = buildDeterministicCuts(
          String(storyText),
          String(directorName),
          targetCuts,
          secPerCut,
          videoStyle,
          regionFlavor,
          String(animationMode),
          editorial,
        );

        const defaultSeeds: CharacterSeed[] = [{
          id: "char-1",
          label: "주인공",
          appearance: "A young person, casual modern clothing, natural look",
          appearanceKo: "캐주얼 의상의 젊은 인물",
        }];

        const finalizedCuts = classifyCuts(densifyCuts(deterministicCuts));
        for (const fc of finalizedCuts) { if (fc.durationSec > VEO_SEGMENT_CAP) fc.durationSec = VEO_SEGMENT_CAP; }
        repairMultiShotMinimums(finalizedCuts);
        const sequencePlan = buildSequencePlanFromCuts(finalizedCuts, {
          styleId: String(animationMode || "live-action"),
          aspectRatio: (aspectRatio === "9:16" ? "9:16" : "16:9"),
          directorId: String(directorName || ""),
        });
        const sequenceValidation = validateSequencePlan(sequencePlan);

        return Response.json({
          ok: true,
          degraded: true,
          reason: `step1 failed: ${msg.slice(0, 150)}`,
          source: "deterministic-fallback",
          warnings: step1Warnings,
          characterSeeds: defaultSeeds,
          cuts: finalizedCuts,
          sequencePlan,
          sequenceValidation,
          secPerCut,
        } satisfies GenerateCutsResponse);
      }
    }

    // 아웃라인 정규화 — LLM이 targetCuts보다 적게 생성한 경우 패딩
    const shotCycle = ["MS", "CU", "WS", "OTS", "MCU", "LS", "ECU", "POV", "MLS"];
    if (outlines.length < targetCuts) {
      console.warn(`[generate-cuts] outline padding: LLM produced ${outlines.length}/${targetCuts} outlines — padding ${targetCuts - outlines.length} more`);
      step1Warnings.push(`LLM이 ${outlines.length}/${targetCuts}컷만 생성하여 나머지를 자동 보충했습니다`);
    }
    while (outlines.length < targetCuts) {
      const n = outlines.length + 1;
      const prevShot = outlines[n - 2]?.shotType ?? "MS";
      const nextShot = shotCycle[(shotCycle.indexOf(prevShot) + 1) % shotCycle.length];
      outlines.push({
        cutNumber: n,
        sceneKo: `장면 ${n}`,
        emotion: "neutral",
        emotionalDelta: "neutral→neutral",
        purpose: n === targetCuts ? "resolve" : "develop",
        shotType: nextShot,
        cameraMovement: n === 1 ? "slow pan revealing space and atmosphere" : "slow push-in as scene develops",
        subjectAction: `moves through environment in scene ${n}`,
        transitionHint: n < targetCuts ? "디졸브" : "페이드 아웃",
        shotCategory: "character-driven",
        characterRole: "protagonist",
        locationCue: "identifiable location objects",
        situationCue: "visible situation evidence",
        emotionalAnchor: "emotional focal point through action",
        sceneBeat1: "location-identifying objects and space",
        sceneBeat2: "situation evidence becomes visible",
        sceneBeat3: "emotional anchor enters or is revealed",
        endHook: "visual tension toward next scene",
      });
    }
    outlines = outlines.slice(0, targetCuts).map((o, i) => ({ ...o, cutNumber: i + 1 }));

    const mainChar = characterSeeds[0] ?? {
      id: "char-1",
      label: "주인공",
      appearance: "A young person, casual modern clothing, natural look",
      appearanceKo: "캐주얼 의상의 젊은 인물",
    };

    t1_step1 = Date.now();
    console.log(`[generate-cuts] step1 완료: ${t1_step1 - t0_step1}ms, outlines=${outlines.length}`);

    // ── Fast path 판정: evaluateFastPathEligibility로 구조적 판단 ──
    const fastPathEval = evaluateFastPathEligibility({
      totalDurationSec: effectiveTotalForDensity,
      targetCuts,
      outlines,
      step1Degraded,
      storyText: String(storyText),
    });
    const shouldUseFastPath = isFastPathCandidate && fastPathEval.eligible;

    if (shouldUseFastPath) {
      fastPathUsed = true;
      skippedSteps.push("step2", "step3");
      console.log("[generate-cuts] FAST PATH: step2/3 건너뛰기", {
        totalDuration: effectiveTotalForDensity,
        targetCuts,
        step1LatencyMs: t1_step1 - t0_step1,
        eligibilityReason: fastPathEval.reason,
        checks: fastPathEval.checks,
      });
    } else if (isFastPathCandidate) {
      console.log("[generate-cuts] fast path candidate rejected:", fastPathEval.reason, fastPathEval.checks);
    }

    // ── STEP 2 & 3: 상세 프롬프트 생성 (병렬) ────────────────────────────────
    const mid    = Math.ceil(targetCuts / 2);
    const batch1 = outlines.slice(0, mid);
    const batch2 = outlines.slice(mid);

    let details1: CutDetail[] = [];
    let details2: CutDetail[] = [];

    const detailArgs = [
      outlines,              // allOutlines — 전체 시퀀스 컨텍스트
      mainChar.appearance,
      videoStyle,
      regionFlavor,
      String(directorName),
      String(directorStyle ?? ""),
      directorEngine,        // 연출 철학 엔진 (이름 태그 대체)
      secPerCut,
      beatTemplate,
      extendBeatTemplate,
      String(aspectRatio ?? "16:9"),
      editingNote,
    ] as const;

    // editorial summary for step2/3 reinforcement
    const editorialSummary = buildCompactEditorialSummary(editorial);

    t0_step23 = Date.now();

    if (shouldUseFastPath) {
      // Fast path: skip step2/3 entirely — use outline-based fallback prompts
      console.log("[generate-cuts] fast path: step2/3 skipped");
      t1_step23 = Date.now();
    } else {
    try {
      [details1, details2] = await Promise.all([
        step23DetailBatch(context.env, ...detailArgs, batch1, "step2", generationPersonaBlock, characterPersonaBlock, editorialSummary),
        batch2.length > 0
          ? step23DetailBatch(context.env, ...detailArgs, batch2, "step3", generationPersonaBlock, characterPersonaBlock, editorialSummary)
          : Promise.resolve([]),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isProviderError = msg.startsWith("PROVIDER_ERROR:");
      const isTruncation = !isProviderError && (msg.includes("MAX_TOKENS") || msg.includes("truncat"));
      const isTimeout = msg.includes("TIMEOUT") || msg.includes("524") || msg.includes("timed out");
      console.error("[generate-cuts] step2/3 failed:", msg, "isProviderError:", isProviderError, "isTruncation:", isTruncation, "isTimeout:", isTimeout);

      // ── Step 2/3 429 재시도 (최대 2회, exponential backoff) ──
      const providerStatus = isProviderError ? (parseInt(msg.split(":")[1], 10) || 503) : 0;
      const is429 = providerStatus === 429;
      if (is429) {
        let retrySuccess = false;
        for (let attempt = 1; attempt <= 2; attempt++) {
          const backoffMs = attempt * 3000; // 3s, 6s
          console.log(`[generate-cuts] step2/3 429 retry ${attempt}/2 — waiting ${backoffMs}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          try {
            [details1, details2] = await Promise.all([
              step23DetailBatch(context.env, ...detailArgs, batch1, "step2", generationPersonaBlock, characterPersonaBlock, editorialSummary),
              batch2.length > 0
                ? step23DetailBatch(context.env, ...detailArgs, batch2, "step3", generationPersonaBlock, characterPersonaBlock, editorialSummary)
                : Promise.resolve([]),
            ]);
            retrySuccess = true;
            console.log(`[generate-cuts] step2/3 429 retry ${attempt} succeeded`);
            break;
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            console.warn(`[generate-cuts] step2/3 429 retry ${attempt} failed:`, retryMsg);
          }
        }
        // Pro 재시도 실패 → Flash 모델로 한 번 더 시도
        if (!retrySuccess) {
          console.warn("[generate-cuts] step2/3 Pro 429 exhausted — trying Flash model");
          try {
            await new Promise(resolve => setTimeout(resolve, 2000));
            [details1, details2] = await Promise.all([
              step23DetailBatch(context.env, ...detailArgs, batch1, "step2", generationPersonaBlock, characterPersonaBlock, editorialSummary, GEMINI_MODEL_FLASH),
              batch2.length > 0
                ? step23DetailBatch(context.env, ...detailArgs, batch2, "step3", generationPersonaBlock, characterPersonaBlock, editorialSummary, GEMINI_MODEL_FLASH)
                : Promise.resolve([]),
            ]);
            retrySuccess = true;
            step1Degraded = true;
            step1DegradedReason = (step1DegradedReason ? step1DegradedReason + " + " : "") + "step2/3 Pro 429 → Flash fallback 성공";
            step1Warnings.push("step2/3: Flash model fallback (품질 저하 가능)");
            console.log("[generate-cuts] step2/3 Flash fallback succeeded");
          } catch (flashErr) {
            const flashMsg = flashErr instanceof Error ? flashErr.message : String(flashErr);
            console.warn("[generate-cuts] step2/3 Flash fallback failed:", flashMsg.slice(0, 200));
          }
        }
        if (!retrySuccess) {
          const providerReason = "AI 서버 요청 한도 초과로 세부 장면 보강을 건너뛰었습니다";
          console.warn(`[generate-cuts] step2/3 429 retries + Flash exhausted — falling back to outline-only`);
          step1Warnings.push(`step2/3 provider 429: ${providerReason}`);
          step1Degraded = true;
          step1DegradedReason = (step1DegradedReason ? step1DegradedReason + " + " : "") + providerReason;
        }
      } else if (isProviderError && !isTimeout) {
        // Provider 503 등 — outline-only fallback
        const nonRetryReason = "AI 서버 일시 혼잡으로 세부 장면 보강을 건너뛰었습니다";
        console.warn(`[generate-cuts] step2/3 provider error (${providerStatus}) — falling back to outline-only`);
        step1Warnings.push(`step2/3 provider ${providerStatus}: ${nonRetryReason}`);
        step1Degraded = true;
        step1DegradedReason = (step1DegradedReason ? step1DegradedReason + " + " : "") + nonRetryReason;
        // details1, details2 remain empty → cuts will use outline-based fallback prompts
      } else if (isTruncation && !isTimeout) {
        return Response.json({
          ok: false,
          degraded: false,
          error: "Step 2/3 출력이 토큰 한도를 초과했습니다. 컷 수를 줄이거나 스토리를 축소해주세요.",
          detail: msg,
          step: 2,
          cause: "MAX_TOKENS",
          source: "gemini",
          warnings: step1Warnings,
        }, { status: 422 });
      } else {
        // step2/3 실패 (timeout/기타) → details는 비워서 outline 기반 fallback만 사용
        console.warn("[generate-cuts] step2/3 failed — proceeding with outline-only fallback");
        step1Warnings.push(`step2/3 failed: ${msg.slice(0, 200)}`);
        step1Warnings.push("proceeding with outline-only cuts (no detailed prompts)");
        step1Degraded = true;
        step1DegradedReason = (step1DegradedReason ? step1DegradedReason + " + " : "") + `step2/3 failed: ${msg.slice(0, 100)}`;
        // details1, details2 remain empty → cuts will use fallback prompts
      }
    }
    t1_step23 = Date.now();
    console.log(`[generate-cuts] step2/3 완료: ${t1_step23 - t0_step23}ms, details=${details1.length + details2.length}`);
    } // end of else (non-fast-path)

    t0_postprocess = Date.now();

    // ── 병합 ──────────────────────────────────────────────────────────────────
    const detailMap = new Map<number, CutDetail>();
    for (const d of [...details1, ...details2]) {
      const det = d as CutDetail;
      if (det && typeof det.cutNumber === "number") detailMap.set(det.cutNumber, det);
    }

    // 감독 스타일 핑거프린트: 이름 태그 대신 실제 스타일 키워드 사용
    const finalStyleFingerprint = String(directorStyle ?? "")
      ? String(directorStyle).split(/[,;|]/).slice(0, 3).map(s => s.trim()).filter(Boolean).join(", ")
      : String(directorName);
    const noTextSuffix = `${videoStyle}, ${finalStyleFingerprint}, ${String(aspectRatio ?? "16:9")} aspect ratio, no text, no watermark, no captions`;

    const cuts = outlines.map((outline, i) => {
      const d = detailMap.get(outline.cutNumber);
      const prevOutline = i > 0 ? outlines[i - 1] : null;

      const moodLighting = d?.moodLighting ?? "Golden hour warm light. Teal and orange grade.";

      // ── 캐릭터 역할에 따른 characterRef 결정 ────────────────────────────
      const needsCharacter = outline.characterRole !== "absent";
      const charRefForCut = (() => {
        switch (outline.characterRole) {
          case "protagonist": return mainChar.appearance;
          case "partial":     return `partial view — ${mainChar.appearance.split(",").slice(0, 2).join(",")}`;
          case "silhouette":  return `dark silhouette of figure`;
          case "background":  return `distant figure in background`;
          case "absent":      return "";
        }
      })();

      // extendPrompt: 빈 문자열이거나 너무 짧으면 outline 기반 fallback 생성
      // extendFallback: 자연어 중심 (메타태그 제거)
      const extendFallback = prevOutline
        ? `Continuing from previous shot — ${prevOutline.endHook}. Transition to ${outline.shotType} shot. ${outline.cameraMovement}. ${outline.sceneBeat1} → ${outline.sceneBeat2} → ${outline.sceneBeat3}.${charRefForCut ? ` ${charRefForCut}.` : ""} ${extendBeatTemplate}. ${noTextSuffix}`
        : "";

      // ── JSON 기반 프롬프트 구조 생성 ──────────────────────────────────────
      const extractField = (text: string | undefined, key: string): string => {
        if (!text) return "";
        const re = new RegExp(`${key}:([^.|]+)`, "i");
        const m = text.match(re);
        return m ? m[1].trim() : "";
      };

      const vp = d?.videoPrompt ?? "";

      // sceneBeat 기반 timing beat 생성
      const sceneTimingBeat = beatTemplate
        .replace("[start]", outline.sceneBeat1)
        .replace("[develop]", outline.sceneBeat2)
        .replace("[climax]", outline.sceneBeat3);

      const videoPromptJson: VideoPromptJson = {
        shotSize:        extractField(vp, "SHOT_SIZE") || outline.shotType,
        cameraAngle:     extractField(vp, "CAMERA_ANGLE") || "eye-level",
        cameraMovement:  extractField(vp, "CAMERA_PROGRESSION") || extractField(vp, "CAMERA_MOVEMENT") || outline.cameraMovement,
        subjectBlocking: extractField(vp, "SUBJECT_BLOCKING") || (needsCharacter ? "subject center-frame mid-ground" : "environment fills frame"),
        subjectAction:   extractField(vp, "SUBJECT_ACROSS_SCENE") || extractField(vp, "SUBJECT") || `${outline.sceneBeat1} → ${outline.sceneBeat2} → ${outline.sceneBeat3}`,
        actionBeat:      extractField(vp, "ACTION_BEAT") || outline.subjectAction,
        bodySignal:      needsCharacter ? (extractField(vp, "BODY_SIGNAL") || "") : "",
        revealed:        extractField(vp, "REVEALED") || "new visual layer",
        withheld:        extractField(vp, "WITHHELD") || "",
        timingBeat:      sceneTimingBeat,
        transitionFromPrev: extractField(vp, "TRANSITION_FROM_PREV") || "",
        characterRef:    charRefForCut,
        moodLighting:    moodLighting,
        styleSuffix:     noTextSuffix,
        // ── 즉시 인식 가능성 3-pillar (outline에서 전달) ──
        locationCue:     outline.locationCue || "",
        situationCue:    outline.situationCue || "",
        emotionalAnchor: outline.emotionalAnchor || "",
      };

      let extendPromptJson: ExtendPromptJson | undefined;
      if (i > 0 && prevOutline) {
        const ep = d?.extendPrompt ?? "";
        extendPromptJson = {
          prevSceneEnd: {
            shotType:      prevOutline.shotType,
            subjectAction: prevOutline.subjectAction,
            bodySignal:    extractField(ep, "body showed") || "",
          },
          transition:      outline.transitionHint || "cut",
          newShot: {
            shotSize:      outline.shotType,
            cameraAngle:   extractField(ep, "CAMERA_ANGLE") || "eye-level",
            cameraMovement: extractField(ep, "CAMERA_MOVEMENT") || outline.cameraMovement,
          },
          characterRef:    charRefForCut,
          newAction:       extractField(ep, "NEW ACTION") || outline.subjectAction,
          behavioralShift: needsCharacter ? (extractField(ep, "BEHAVIORAL SHIFT") || "") : "",
          newlyRevealed:   extractField(ep, "NEWLY REVEALED") || "",
          stillWithheld:   extractField(ep, "STILL WITHHELD") || "",
          timingBeat:      extendBeatTemplate,
          styleSuffix:     noTextSuffix,
        };
      }

      // ── 캐릭터 일관성: 캐릭터 중심 컷만 적용 ──────────────────────────
      const characterConsistency = (outline.characterRole === "protagonist" || outline.characterRole === "partial")
        ? `캐릭터 고정: ${mainChar.appearanceKo}. 모든 장면 동일 유지.`
        : "";
      const charactersInScene = needsCharacter ? [mainChar.id] : [];

      // ── 이미지 프롬프트 fallback (씬 오프닝/엔딩 기반) ──────────────
      const shotLabel: Record<string, string> = { ECU: "Extreme close-up", CU: "Close-up", MCU: "Medium close-up", MS: "Medium shot", MLS: "Medium long shot", LS: "Long shot", WS: "Wide shot", OTS: "Over-the-shoulder", POV: "Point-of-view" };
      const defaultImagePrompt = needsCharacter
        ? `${shotLabel[outline.shotType] || outline.shotType} shot, eye-level. ${charRefForCut}. ${outline.sceneBeat1}. ${noTextSuffix}`
        : `${shotLabel[outline.shotType] || outline.shotType} shot, eye-level. ${outline.sceneBeat1}. ${outline.sceneKo}. ${noTextSuffix}`;
      const defaultEndImagePrompt = needsCharacter
        ? `${charRefForCut}. ${outline.sceneBeat3}. ${noTextSuffix}`
        : `${outline.sceneBeat3}. ${noTextSuffix}`;
      // defaultVideoPrompt: 자연어 중심 (메타태그 제거)
      const defaultVideoPrompt = `${shotLabel[outline.shotType] || outline.shotType} shot, eye-level. ${outline.cameraMovement}. ${sceneTimingBeat}.${charRefForCut ? ` ${charRefForCut}.` : ""} ${noTextSuffix}`;

      return {
        cutNumber:     outline.cutNumber,
        durationSec:   secPerCut,
        purpose:       outline.purpose,
        narrativeFunction: outline.narrativeFunction || outline.purpose,
        sceneDescription: outline.sceneKo,
        shotType:      outline.shotType,
        subjectAction: outline.subjectAction,
        emotionalDelta: outline.emotionalDelta,
        shotCategory:  outline.shotCategory,
        characterRole: outline.characterRole,
        cameraDirection:  d?.cameraDirection  ?? `Lens 35mm. Slow dolly in. ${String(directorName)} style.`,
        moodLighting,
        imagePrompt:      d?.imagePrompt      ?? defaultImagePrompt,
        endImagePrompt:   d?.endImagePrompt   ?? defaultEndImagePrompt,
        videoPrompt:      d?.videoPrompt      ?? defaultVideoPrompt,
        extendPrompt:     i === 0 ? "" : (d?.extendPrompt && d.extendPrompt.trim().length > 20
          ? d.extendPrompt
          : extendFallback),
        transitionHint:   outline.transitionHint,
        characterConsistency,
        charactersInScene,
        // JSON 기반 프롬프트 (provider별 렌더링용)
        videoPromptJson,
        ...(extendPromptJson ? { extendPromptJson } : {}),
        // 멀티샷: VEO는 타임스탬프 프롬프트로 전달 + role 자동 추론
        ...(d?.multiShot && Array.isArray(d.multiShot) && d.multiShot.length > 0
          ? { multiShot: d.multiShot.map((sh: MultiShotItem, si: number) => ({
              ...sh,
              role: sh.role ?? inferMultiShotRole(si, d.multiShot!.length),
            })) }
          : {}),
      };
    });

    // ═══ rhythm distribution — 역할 기반 duration 재분배 ═══════════
    // uniform secPerCut → purpose/shotType/shotCategory 기반 가변 분배
    const pacingMode: PacingMode = (() => {
      // parsedRange의 크기로 사용자 의도를 유추
      if (parsedRange) {
        const rangeSize = parsedRange.max - parsedRange.min;
        if (rangeSize <= 1 && parsedRange.max >= 20) return "fast";
        if (rangeSize <= 1 && parsedRange.min <= 5) return "cinematic";
      }
      // contentMode 기반 보정 (1833행에서 이미 산출됨 — 재호출 방지)
      if (contentMode === "dramatized_reenactment") return "cinematic";
      // editorial persona의 motionBias 활용
      if (pBias === "upper") return "fast";
      if (pBias === "lower") return "cinematic";
      return "balanced";
    })();

    const rhythmInputCuts = cuts.map(c => ({
      cutNumber: c.cutNumber,
      purpose: (c as Record<string, unknown>).purpose as string | undefined
        ?? outlines.find(o => o.cutNumber === c.cutNumber)?.purpose,
      shotType: c.shotType,
      shotCategory: c.shotCategory,
      durationSec: c.durationSec,
    }));

    const rhythmResult = distributeRhythm(rhythmInputCuts, pacingMode);

    // 리듬 분배된 duration을 원래 cuts에 적용 + multiShot sub-duration 비례 재조정
    const rhythmCuts = cuts.map((c, i) => {
      const newDur = rhythmResult.cuts[i]?.durationSec ?? c.durationSec;
      const updated = { ...c, durationSec: newDur };

      // multiShot sub-duration 비례 재조정: 총 duration이 바뀌면 서브샷도 비례 스케일링
      if (updated.multiShot && Array.isArray(updated.multiShot) && updated.multiShot.length > 0 && newDur !== c.durationSec) {
        const oldSubTotal = updated.multiShot.reduce((s: number, sh: { duration: string }) => s + (parseFloat(sh.duration) || 0), 0);
        if (oldSubTotal > 0) {
          const ratio = newDur / oldSubTotal;
          const rescaled = updated.multiShot.map((sh: { index: number; prompt: string; duration: string }, si: number, arr: Array<{ index: number; prompt: string; duration: string }>) => {
            if (si === arr.length - 1) {
              // 마지막 서브샷: 나머지 할당 (반올림 오차 보정)
              const prevSum = arr.slice(0, si).reduce((s2: number, _: unknown, j: number) =>
                s2 + Math.max(1, Math.round((parseFloat(arr[j].duration) || 0) * ratio)), 0);
              return { ...sh, duration: String(Math.max(1, newDur - prevSum)) };
            }
            return { ...sh, duration: String(Math.max(1, Math.round((parseFloat(sh.duration) || 0) * ratio))) };
          });
          updated.multiShot = rescaled;
        }
      }

      return updated;
    });

    console.log("[generate-cuts] rhythm distribution applied", {
      pacingMode,
      profile: rhythmResult.profile,
    });

    // ═══ density 보정 + classify → finalizedCuts ═══════════════════
    const finalizedCuts = classifyCuts(densifyCuts(rhythmCuts));

    // ═══ VEO 8초 상한 강제 클램핑 ═══════════════════════════════
    // 리듬 분배/density 보정 후에도 durationSec이 8초를 초과할 수 있음.
    // VEO API 최대값은 8초이므로 여기서 강제 클램핑.
    for (const fc of finalizedCuts) {
      if (fc.durationSec > VEO_SEGMENT_CAP) {
        console.warn(`[generate-cuts] ⚠️ cut ${fc.cutNumber} duration ${fc.durationSec}s exceeds ${VEO_SEGMENT_CAP}s cap → clamping`);
        fc.durationSec = VEO_SEGMENT_CAP;
      }
    }

    // ═══ 멀티샷 사후 검증 — Gemini가 최소 샷 수 미달 시 자동 복구 ═══
    repairMultiShotMinimums(finalizedCuts);

    // ═══ Continuity Segment 생성 (continuityMode ON일 때만) ═══════
    // 각 컷에 continuitySegment를 붙여서 클라이언트 → useVideoGeneration → generate-video까지 전달.
    // 이 데이터는 시퀀스 경계에서 이전 컷의 끝 상태를 다음 컷 시작으로 전파하는 핵심 메타.
    if (isContinuityMode) {
      const totalCuts = finalizedCuts.length;
      const prevEnd = continuityPrevEndState && typeof continuityPrevEndState === "object"
        ? continuityPrevEndState as Record<string, unknown>
        : null;
      const anchors = continuityGlobalAnchors && typeof continuityGlobalAnchors === "object"
        ? continuityGlobalAnchors as Record<string, unknown>
        : null;

      for (let i = 0; i < totalCuts; i++) {
        const fc = finalizedCuts[i] as Record<string, unknown>;

        // prevEndState: 첫 컷은 상위에서 전달된 값 사용, 이후 컷은 이전 컷의 장면 설명 기반
        let segStartState: Record<string, unknown>;
        if (i === 0 && prevEnd) {
          // 시퀀스 경계: 이전 시퀀스의 마지막 상태가 전달됨
          segStartState = {
            subjectPosition: prevEnd.subjectPosition || "",
            cameraState: prevEnd.cameraState || "",
            emotionKeyword: prevEnd.emotionKeyword || "",
            emotionIntensity: Number(prevEnd.emotionIntensity) || 0,
            motionVector: prevEnd.motionVector || "",
            lightingState: prevEnd.lightingState || "",
            environmentSnapshot: prevEnd.environmentSnapshot || "",
          };
        } else if (i > 0) {
          // 같은 시퀀스 내: 이전 컷의 장면 설명에서 파생
          const prevCut = finalizedCuts[i - 1] as Record<string, unknown>;
          segStartState = {
            subjectPosition: String(prevCut.sceneDescription || "").slice(0, 100),
            cameraState: String(prevCut.cameraDirection || ""),
            emotionKeyword: "",
            emotionIntensity: 0,
            motionVector: "",
            lightingState: String(prevCut.moodLighting || ""),
            environmentSnapshot: String(prevCut.sceneDescription || "").slice(0, 80),
          };
        } else {
          segStartState = {
            subjectPosition: "", cameraState: "", emotionKeyword: "",
            emotionIntensity: 0, motionVector: "", lightingState: "", environmentSnapshot: "",
          };
        }

        // endState: 현재 컷의 장면 설명에서 파생 (다음 컷의 startState가 됨)
        const segEndState: Record<string, unknown> = {
          subjectPosition: String(fc.sceneDescription || "").slice(0, 100),
          cameraState: String(fc.cameraDirection || ""),
          emotionKeyword: "",
          emotionIntensity: 0,
          motionVector: "",
          lightingState: String(fc.moodLighting || ""),
          environmentSnapshot: String(fc.sceneDescription || "").slice(0, 80),
        };

        fc.continuitySegment = {
          segmentIndex: i,
          startState: segStartState,
          endState: segEndState,
          isLastSegment: i === totalCuts - 1,
        };
      }

      console.info(`[generate-cuts] continuitySegment 생성 완료: ${totalCuts}컷, prevEndState=${!!prevEnd}, anchors=${!!anchors}`);
    }

    // ═══ 시퀀스 플랜 구축 + 검증 ═══════════════════════════════════
    // finalizedCuts 기준으로 SequencePlan 생성 (cuts와 sequencePlan 정합성 보장)
    const sequencePlan = buildSequencePlanFromCuts(finalizedCuts, {
      styleId: String(animationMode || "live-action"),
      aspectRatio: (aspectRatio === "9:16" ? "9:16" : "16:9"),
      directorId: String(directorName || ""),
    });
    const sequenceValidation = validateSequencePlan(sequencePlan);

    if (!sequenceValidation.valid) {
      console.warn("[generate-cuts] ⚠️ sequence validation issues:", sequenceValidation.issues);
    }

    t1_postprocess = Date.now();
    const totalLatencyMs = Date.now() - t0_total;
    const step1LatencyMs = t1_step1 - t0_step1;
    const step23LatencyMs = t1_step23 - t0_step23;
    const postprocessLatencyMs = t1_postprocess - t0_postprocess;

    console.log("[generate-cuts] LATENCY BREAKDOWN", {
      totalLatencyMs,
      step1LatencyMs,
      step23LatencyMs,
      postprocessLatencyMs,
      fastPathUsed,
      skippedSteps,
    });

    return Response.json({
      ok: true,
      degraded: step1Degraded,
      degradedByFastPath: fastPathUsed && !step1Degraded,
      reason: fastPathUsed
        ? `fast path: ${fastPathEval.reason}`
        : (step1DegradedReason || undefined),
      source: "gemini" as const,
      warnings: step1Warnings,
      characterSeeds,
      cuts: finalizedCuts,
      sequencePlan,
      sequenceValidation,
      secPerCut,
      rhythmProfile: rhythmResult.profile,
      cutCountDecisionBasis: {
        finalCutCount: targetCuts,
        source: cutDecision.source,
        requestedExact: rawCutCount > 0 ? rawCutCount : undefined,
        requestedRange: parsedRange,
        densityMinimum: cutDecision.densityMinimum,
        personaBias: pBias,
        notes: cutDecision.notes,
      },
      // ── segment orchestration plan 메타 ──
      segmentPlanning: {
        totalDurationSeconds: totalDurationSec || undefined,
        segmentDurationCap: VEO_SEGMENT_CAP,
        estimatedSegmentCount: estimatedSegmentCount || undefined,
        currentPlanningScope: segmentPlan.currentPlanningScope,
        totalTargetCutsAcrossSequence: segmentPlan.totalTargetCuts,
        currentSegmentTargetCuts: segmentPlan.currentSegmentTargetCuts,
        suggestedCutsForCurrentSegment: segmentPlan.currentSegmentTargetCuts,
        perSegmentCutRange: segmentPlan.perSegmentCutRange,
        segmentCount: segmentPlan.segmentCount,
        segments: segmentPlan.segments,
        planningBasis: segmentPlan.planningBasis,
        personaBias: segmentPlan.personaBias,
        notes: segmentPlan.notes,
      },
      autoDurationDecisionBasis: {
        result: secPerCut,
        basis: autoResult.basis,
        inputTotalDuration: totalDurationSec || undefined,
        inputCutDuration: rawSecPerCut || undefined,
        inputCutCount: rawCutCount || undefined,
      },
      // ── generationMeta: engine truth for QualityDebugPanel ──
      generationMeta: {
        totalDurationSec: effectiveTotalForDensity,
        durationBand: bandPolicy.band,
        targetCuts,
        minimumCuts: bandPolicy.minCuts,
        reconciledSecPerCut: secPerCut,
        shortformPolicyApplied: bandPolicy.isShortformBand,
        specialHandling13to15: bandPolicy.is13to15Special,
        directorRequested: String(directorNameKo || directorName || ""),
        directorRequestedPace: autoResult.duration,
        directorAppliedPace: secPerCut,
        directorPaceDownWeighted: directorPaceWasDownweighted || shortformPlan.directorPaceDownweighted,
        directorWeakenReason: directorWeakenReason || (shortformPlan.directorPaceDownweighted ? shortformPlan.reconciliationNotes.find(n => n.includes("director")) : undefined),
        narrativeFunctions: outlines.map(o => o.narrativeFunction || o.purpose).filter(Boolean),
        cutDurations: finalizedCuts.map(c => c.durationSec),
        cutShotCounts: finalizedCuts.map(c => Array.isArray(c.multiShot) ? c.multiShot.length : 1),
        totalShotCount: finalizedCuts.reduce((s, c) => s + (Array.isArray(c.multiShot) ? c.multiShot.length : 1), 0),
        fallbackUsed: step1Degraded && step1DegradedReason.includes("fallback"),
        fastPathUsed,
        totalLatencyMs: totalLatencyMs,
        step1LatencyMs: step1LatencyMs,
        step23LatencyMs: step23LatencyMs,
        outlineOnly: details1.length === 0 && details2.length === 0 && outlines.length > 0,
        genericSplitFallback: false,
        providerError: step1Warnings.find(w => w.includes("provider")) || undefined,
        densityPolicy: cutDecision.source,
        continuityMode: isContinuityMode || undefined,
        continuitySegmentIndex: isContinuityMode ? Number(continuitySegmentIndex) || 0 : undefined,
        continuitySegmentRole: isContinuityMode ? String(continuitySegmentRole || "building") : undefined,
        deepAnalysis: deepAnalysisMeta || undefined,
        reconciliationNotes: shortformPlan.reconciliationNotes,
        rationale: buildRationale({
          bandPolicy,
          shortformPlan,
          directorPaceWasDownweighted,
          step1Degraded,
          step1DegradedReason,
          outlineOnly: details1.length === 0 && details2.length === 0 && outlines.length > 0,
          targetCuts,
          secPerCut,
        }),
      },
      // ── Latency breakdown for client-side observability ──
      _latency: {
        totalLatencyMs,
        step1LatencyMs,
        step23LatencyMs,
        postprocessLatencyMs,
        fallbackLatencyMs,
        fastPathUsed,
        skippedSteps,
        degradedFastPathUsed: fastPathUsed,
        // timeout tracking
        timedOutAtStep1,
        timedOutAtUltra,
        timeoutPathUsed,
        // quality context for fast path comparison
        totalCutCount: finalizedCuts.length,
        totalShotCount: finalizedCuts.reduce((s, c) => s + (Array.isArray(c.multiShot) ? c.multiShot.length : 1), 0),
        outlineOnly: details1.length === 0 && details2.length === 0 && outlines.length > 0,
        step1Ratio: totalLatencyMs > 0 ? Math.round((step1LatencyMs / totalLatencyMs) * 100) : 0,
        step23Ratio: totalLatencyMs > 0 ? Math.round((step23LatencyMs / totalLatencyMs) * 100) : 0,
      },
      // ── Fast path eligibility reasoning ──
      _fastPathEval: {
        eligible: fastPathEval.eligible,
        reason: fastPathEval.reason,
        checks: fastPathEval.checks,
      },
    });

  } catch (error) {
    const errMsg   = error instanceof Error ? error.message  : String(error);
    const errStack = error instanceof Error ? (error.stack ?? "").slice(0, 800) : "";
    console.error("[generate-cuts] 예외:", errMsg, "\n", errStack);
    return Response.json({
      ok: false,
      degraded: false,
      error: "Failed to generate cuts",
      detail: errMsg,
      stack: errStack,
      source: "gemini",
      warnings: [],
    }, { status: 500 });
  }
};
