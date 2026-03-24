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
import { GeminiEnv, streamingGenerate, GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH, parseFirstJsonObject, parseFirstJsonArray, repairTruncatedJson } from "./_gemini-keys";
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
import { VEO_DEFAULT_MODEL, VEO_SEGMENT_CAP, VEO_EXTENSION_DURATION, getCapability } from "./_veo-capability";
// VEO 정책: 8초=4샷, 7초(extend)=3샷
const getMaxShots = (_modelId: string, durationSec: number) => durationSec <= 7 ? 3 : 4;
const getMinShots = (_modelId: string, durationSec: number) => durationSec <= 7 ? 3 : 4;
import { reconcileShortformPlan, resolveShortformBandPolicy } from "./_shortform-rhythm";
import { runDeepAnalysis, serializePromptBrief } from "./_deep-analysis";

// ─── 샷 타입 기본 순환 (fallback 용) ─────────────────────────────────────────────
const SHOT_TYPE_CYCLE = ["WS", "MS", "CU", "OTS", "MCU", "LS", "ECU", "POV", "MLS"] as const;

// ─── 스타일별 카메라/모션 렌더링 힌트 ──────────────────────────────────────────
// style-catalog.ts의 STYLE_RENDERING_OVERRIDES + CATEGORY_RENDERING_DEFAULTS를 Gemini용으로 압축
const STYLE_RENDERING_HINTS: Record<string, string> = {
  // ═══ live_action ═══
  "cinematic-realism": "Camera: smooth dolly/crane, anamorphic lens with shallow DOF. Motivated camera movement only. Natural practical lighting with dramatic contrast.",
  "docu-handheld": "Camera: handheld with natural shake, observational distance, whip pans. Motion: reactive following, not choreographed. No stabilized gimbal.",
  "commercial-ad": "Camera: ultra-smooth dolly/slider, product hero angles. Studio-perfect lighting. Clean symmetrical compositions with golden ratio.",
  "vintage-film": "Motion: slight film judder, vintage camera instability. Consistent grain level and color fade across all cuts. No mixing film stocks.",
  "neon-noir": "Environment: 70%+ dark frame, wet reflective streets. Camera: neon-reflected tracking shots, low angles, Dutch tilts. Rain-slicked gliding movement.",
  "vhs-retro": "Camera: static or slow zoom, VHS-era framing. Visible scan lines and tracking glitches. Warm CRT glow on subjects. No modern stabilization.",
  "sf-futuristic": "Camera: sweeping sci-fi establishing shots, dramatic reveals of scale. Holographic UI overlays. Volumetric fog with neon rim lighting.",
  "gothic-horror": "Camera: slow deliberate tracking through shadow. Low angles, canted frames. Minimal lighting — candles, moonbeams through fog. Long shadows.",
  // ═══ animation_2d ═══
  "tv-anime": "Camera: anime-standard pans, zoom lines for speed, static hold on dialogue. Motion: limited animation with key poses. Speed lines and impact frames.",
  "theatrical-anime": "Camera: sweeping cinematic anime pans, fluid parallax on deep backgrounds, dramatic push-ins. Motion: high frame-count, detailed secondary motion on hair/cloth, impact frames with screen shake.",
  "storybook-anime": "Camera: gentle slow pans across illustrated scenes. Motion: soft gentle movement, no sudden cuts. Fairy-tale transition wipes.",
  "painted-2d": "Camera: slow painterly pans revealing brushwork. Motion: every frame shows visible brush texture. Oil paint consistency across all elements.",
  "watercolor-animation": "Characters: transparent watercolor washes, no opaque surfaces. Motion: wet-on-wet bleeding at motion edges, colors mix as elements overlap.",
  "ink-drawing-anime": "Camera: clean tracking with architectural precision. Motion: bold ink strokes with varying weight. Cross-hatching visible in shadow areas.",
  "webtoon-motion": "Camera: vertical-scroll-inspired reveals, dramatic zoom punches. Motion: manhwa impact frames, bold speed lines. Clean digital linework.",
  "cutout-anime": "Camera: flat lateral movement, layered depth parallax. Motion: hinged-joint paper puppet articulation. Visible paper-edge shadows between layers.",
  // ═══ animation_3d ═══
  "pixar-style": "Camera: smooth orbits with rack focus. Warm soft key lighting. Motion: squash-and-stretch principles, expressive secondary animation.",
  "dreamworks-style": "Camera: dynamic action tracking, dramatic angles. Motion: exaggerated physical comedy, energetic poses. Bold saturated lighting shifts.",
  "stylized-3d": "Camera: anime-influenced angles in 3D space. Motion: cel-shaded snappy poses with held keyframes. Bold outline visibility.",
  "semi-real-3d": "Camera: cinematic dolly/crane in photorealistic environments. Motion: anime-proportion characters with realistic physics. Ray-traced reflections.",
  "low-poly-3d": "Camera: clean geometric orbits. Motion: faceted surfaces catch light differently as camera moves. Minimal texture, flat shading.",
  "miniature-3d": "Camera: extreme tilt-shift shallow DOF, bird's-eye angle. Motion: miniature-scale movement — everything appears toy-sized.",
  "game-cinematic-3d": "Camera: epic cinematic choreography, dramatic slow-mo. Motion: UE5-level detail, ray-traced GI. Hero poses with volumetric effects.",
  // ═══ painting ═══
  "watercolor": "Camera: gentle pans across watercolor surfaces. Motion: transparent wash layers shifting, colors bleeding at movement edges. White paper visible.",
  "oil-painting": "Camera: slow dramatic reveals of impasto texture. Motion: thick paint strokes visible on all surfaces. Canvas texture throughout.",
  "gouache": "Camera: flat illustrative pans. Motion: opaque matte layers with subtle blending. Rich saturated flat color areas.",
  "pastel": "Camera: soft dreamy movement. Motion: chalky texture visible, gentle blending. Warm diffused lighting through soft grain.",
  "east-asian-painting": "This is animated 2D sequence, NOT static artwork. Camera: smooth pans with parallax on painted layers. Motion: fluid animated movement, NOT motion poster. NO text/calligraphy/characters at any point.",
  "ink-wash": "Animated 2D ink wash sequence, NOT static scroll painting. Camera: gentle reveals through ink wash world. Motion: ink density and white space shift dynamically. NO text/calligraphy.",
  "inkwash-painting": "Camera: horizontal scroll reveals. Motion: fluid ink dilution dynamics, wet brush energy. Western ink wash with broader contrast range.",
  "van-gogh-painted": "Camera: swirling movement echoing brushstroke direction. Motion: thick impasto texture catches light dynamically. Starry-night energy in all elements.",
  "editorial-illustration": "Camera: clean graphic compositions, strong silhouette framing. Motion: limited but impactful. Bold 3-4 color palette consistency.",
  "storybook-illustration": "Camera: gentle page-turn-like transitions. Motion: warm whimsical movement, fairy-tale pacing. Hand-crafted watercolor/gouache feel.",
  // ═══ stop_motion ═══
  "claymation": "Motion: frame-by-frame with visible material deformation, slight jitter from manual positioning. Clay surfaces subtly reshape between frames.",
  "paper-collage": "Camera: flat lateral pans with layered parallax. Motion: cut-paper layers sliding and overlapping. Visible scissors-cut edges and shadow between layers.",
  "felt-craft": "Camera: warm close-ups showing fabric texture. Motion: soft tactile movement, visible stitching. Cozy handmade aesthetic with button details.",
  "wooden-puppet": "Camera: miniature stage framing with warm wood tones. Motion: marionette-like jointed articulation. Visible wood grain on all surfaces.",
  "paper-puppet": "Camera: fixed frontal theater view with backlit screen. Motion: traditional shadow puppet articulation. Silhouette drama with intricate paper-cut detail.",
  "miniature-diorama": "Camera: macro lens on handcrafted sets. Motion: stop-motion jitter, material imperfections visible. Tactile surfaces — clay, fabric, felt.",
  // ═══ retro_game ═══
  "pixel-art": "Camera: pixel-aligned scroll, no sub-pixel motion. Motion: retro sprite animation, limited keyframes, no motion blur, no smooth interpolation.",
  "16bit-jrpg": "Camera: SNES-era parallax scrolling backgrounds. Motion: chibi sprite animation with limited frames. 256-color dithered palette.",
  "8bit-arcade": "Camera: fixed or single-axis scroll. Motion: 4-color-per-sprite chunky animation. Large visible pixels, no anti-aliasing.",
  "ps1-lowpoly": "Camera: early 3D camera with polygon warping. Motion: affine texture distortion, vertex snapping. Low-res textures with visible seams.",
  "90s-game-cutscene": "Camera: dramatic pre-rendered CG rotations. Motion: early CGI with Gouraud shading. Chrome reflections and lens flares.",
  "visual-novel": "Camera: static or subtle parallax on character layers. Motion: minimal — breathing, blink, hair sway. Clean anime art on illustrated backgrounds.",
  // ═══ experimental ═══
  "rotoscoping": "Characters: performance-derived authentic human movement with painterly overlay. Camera: organic handheld documentary feel, not perfectly stabilized.",
  "mixed-media-collage": "Camera: collage-layered depth with mixed textures. Motion: different media layers animate at different speeds. Cut-paste seam edges visible.",
  "live-paint-overlay": "Camera: live-action base with painted strokes tracking motion. Motion: dual reality — photography underneath, animated paint on top.",
  "docu-illustrated": "Camera: documentary footage base with floating illustrations. Motion: animated diagrams/infographics overlaying real-world footage.",
  "2d-3d-hybrid": "Camera: 3D environment camera with 2D character layers. Motion: clear visual distinction — hand-drawn characters in photorealistic 3D spaces.",
  "surreal-composite": "Camera: dream-logic spatial transitions, impossible perspectives. Motion: scale distortion, morphing elements, gravity-defying objects.",
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

// Step1은 빠른 응답이 중요 — Pro가 55초 내 응답 실패 빈번 → Flash 사용
const MODEL_OUTLINE = GEMINI_MODEL_FLASH;
// Step2/3 (디테일 보강)은 Flash 사용: Pro 대비 품질 차이 미미, 타임아웃 해소
const MODEL_DETAIL  = GEMINI_MODEL_FLASH;

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
/** step1 단일 호출 최대 컷 수 — 이 이상은 multi-chain으로 분할 필요 */
const STEP1_SINGLE_CALL_MAX_CUTS = 12;
/** Step1 초기 요청 타임아웃 (ms) — 55초로 단축하여 빠른 fallback 전환 */
const STEP1_TIMEOUT_MS = 55_000;
/** Ultra-compact retry 타임아웃 (ms) — 25초로 단축하여 빠른 응답 */
const STEP1_ULTRA_TIMEOUT_MS = 25_000;
/** Step2/3 타임아웃 (ms) — Pro 모델 응답 안정화를 위해 55초로 상향 */
const STEP23_TIMEOUT_MS = 55_000;

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
  const isStopMotion = animationMode === "스톱모션" || animationMode === "클레이"
    || animationMode === "claymation" || animationMode === "felt-craft"
    || animationMode === "wooden-puppet" || animationMode === "paper-puppet"
    || animationMode === "miniature-diorama" || animationMode === "paper-collage";
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
  const isHybrid = animationMode === "하이브리드"
    || animationMode === "2d-3d-hybrid" || animationMode === "mixed-media-collage"
    || animationMode === "surreal-composite";
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

  // ── Director Visual DNA: 감독 기법이 스타일 기본값보다 우선 ──
  const hasDirectorTech = tech.cameraWork || tech.colorPalette || tech.lighting || tech.moodKeywords;
  const styleRenderingHint = STYLE_RENDERING_HINTS[animationMode] || "";

  // ── 수묵화/동양화 계열: 감독 색감을 수묵화 언어로 자연스럽게 변환 ──
  const isInkWashFamily = ["ink-wash", "inkwash-painting", "east-asian-painting", "잉크워시", "ink-drawing-anime"].includes(animationMode);
  const inkWashHarmony = isInkWashFamily ? `
### Ink-Wash × Director Harmony (MANDATORY — director palette adapts to medium)
- Director's color intent must be expressed through INK DENSITY and WASH GRADATION, not literal hues
- Warm tones → darker ink concentration, amber-tinted wash. Cool tones → diluted pale washes, blue-gray undertones
- Director's "red/crimson" → deep black ink pooling. "Gold/amber" → warm sepia wash. "Green" → gray-green ink dilution
- Color accents allowed ONLY as faint mineral pigment hints (淡彩) — never saturated, never dominant
- Director's lighting philosophy translates to: white space = light, ink density = shadow
- The medium (ink wash) is sacred. The director's EMOTION and COMPOSITION transfer fully, but COLOR becomes monochrome with tonal variation
- BANNED: saturated colors destroying ink-wash aesthetic, photorealistic color grading, abandoning monochrome for director's palette` : "";

  const directorVisualDNA: string[] = [];
  if (hasDirectorTech) {
    if (isInkWashFamily) {
      directorVisualDNA.push("### Director Visual DNA (adapted for ink-wash medium — emotion/composition transfers, color becomes tonal)");
    } else {
      directorVisualDNA.push("### Director Visual DNA (HIGHEST PRIORITY — overrides style defaults when conflict)");
    }
    if (tech.cameraWork) directorVisualDNA.push(`🎬 CAMERA (mandatory): ${tech.cameraWork}`);
    if (tech.colorPalette) {
      if (isInkWashFamily) {
        directorVisualDNA.push(`🎨 COLOR INTENT (translate to ink density/wash tone): ${tech.colorPalette} → express as ink concentration, wash gradation, and white space balance`);
      } else {
        directorVisualDNA.push(`🎨 COLOR PALETTE (enforce in every cut): ${tech.colorPalette}`);
      }
    }
    if (tech.lighting) {
      if (isInkWashFamily) {
        directorVisualDNA.push(`💡 LIGHTING (as ink-wash contrast): ${tech.lighting} → translate to white space vs ink density, brush stroke weight variation`);
      } else {
        directorVisualDNA.push(`💡 LIGHTING (enforce in every cut): ${tech.lighting}`);
      }
    }
    if (tech.moodKeywords) directorVisualDNA.push(`🌊 MOOD ANCHORS (emotional texture for all cuts): ${tech.moodKeywords}`);
    if (tech.editingStyle) directorVisualDNA.push(`✂️ EDITING RHYTHM: ${tech.editingStyle}`);
    if (!isInkWashFamily) {
      directorVisualDNA.push("↑ These director-specific visual rules MUST be visible in every generated cut prompt.");
      directorVisualDNA.push("When style rendering rules below conflict with Director Visual DNA, the director's approach wins.");
    } else {
      directorVisualDNA.push("↑ Director's emotional intent and composition philosophy apply fully. Color/lighting translate to ink-wash tonal language.");
    }
  }

  const lines: string[] = [
    "### Director Aesthetic Engine (operational rules — NOT style tags)",
    `Persona core: ${persona}`,
    style ? `Style principle: ${style}` : "",
    // Director Visual DNA block — placed BEFORE style rendering for priority
    ...directorVisualDNA,
    // Style rendering as secondary layer (medium-specific constraints)
    styleRenderingHint ? `### Style Rendering Rules (medium-specific — defer to Director Visual DNA above when conflicting)\n${styleRenderingHint}` : "",
    inkWashHarmony,
    stopMotionRules,
    hybridRules,
    editorialPersona ? buildEditorialPlanningRules(editorialPersona) : "",
    "### Per-cut enforcement: director color palette visible, director camera philosophy applied, director lighting design present, character stylization, movement motivation, set=psychology. BANNED: generic/anonymous visuals, ignoring director's visual signature.",
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

  if (gp.noSubtitles)          forbidden.push("subtitle/caption/on-screen text");
  if (gp.noNarration)          forbidden.push("narration/voiceover");
  if (gp.noLecturerChar)       forbidden.push("lecturer/presenter/narrator character");
  if (gp.subjectFirst)         required.push("subject-first composition: character=primary, background=support");
  if (gp.noBackgroundClutter)  required.push("minimal background: no excessive banners/patterns/clutter");
  if (gp.emotionAsAction)      required.push("emotion=physical action only, no abstract labels");
  if (gp.noRepeatComposition)  required.push("each cut: different shot+position+emotion vs previous");

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
## SCENE TERM PRECISION
모든 소품/공간은 FORM+MATERIAL 명시 필수. bare nouns 금지.
예: "chair"→"wooden spindle-back chair" | "room"→"narrow operatory, sash window, instrument cabinet" | "light"→"bare Edison bulb on pendant cord"
sign/poster 금지 → "weathered wooden panel". 감정은 body only: "scared"→"jaw locked, knuckles whitening".`;

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
  // ═══ parent category fallbacks ═══
  "live_action":    "Photorealistic cinematic live-action. Natural lighting with dramatic shadows. Filmic depth of field. Subject-focused composition.",
  "animation_2d":   "2D anime animation style. Cel-shaded illustration with clean outlines and vibrant flat colors. Dynamic camera angles.",
  "animation_3d":   "High-quality 3D animation with stylized character designs. Smooth skin tones and cinematic lighting. Rich detailed environments.",
  "painting":       "Painterly animation style. Visible brushwork and artistic texture. Expressive color mixing with hand-crafted aesthetic.",
  "stop_motion":    "Stop-motion animation with handcrafted tactile textures. Frame-by-frame movement. Real-world material surfaces — clay, fabric, felt, wood.",
  "retro_game":     "Retro game pixel art style. Crisp pixel edges with limited color palette. Nostalgic 16-bit era aesthetic with dithered gradients.",
  "experimental":   "Experimental mixed-media animation. Creative layering of different art forms. Boundary-pushing visual techniques with artistic freedom.",
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
  // 강한 역사 재연 신호: 구체적인 역사적 인물/사건/시대가 명시되어야 활성화
  // "병원", "의사", "마케팅" 등 현대 콘텐츠에도 등장하는 단어는 강한 신호가 아님
  const strongHistoricalSignals = [
    /\d{3,4}년[대]?\s*[\uAC00-\uD7A3]/, // "1920년대 미국" 같은 구체적 연도+맥락
    /실제\s*(인물|사건)\s*재연|실화\s*재연|역사\s*재연/,
    /대체\s*역사|가정[형]?\s*역사/,
    /제국|왕조|멸망|전쟁\s*(?:중|당시)|혁명|독립\s*운동|식민\s*(?:지|시대)/,
    /로마\s*제국|몽골\s*제국|나폴레옹|오스만|메이지\s*유신|냉전\s*시대/,
    /조선\s*(?:시대|왕조)|고구려|백제|신라|고려\s*시대/,
  ];
  const strongCount = strongHistoricalSignals.filter(r => r.test(storyText)).length;
  // 강한 신호 2개 이상 또는 1개 + 특정 키워드(재연, 시대극)
  if (strongCount >= 2) return "dramatized_reenactment";
  if (strongCount >= 1 && /재연|시대극|역사\s*드라마/.test(storyText)) return "dramatized_reenactment";

  // 영문 역사 인물 (특정 인물명이 명시적으로 등장해야)
  if (/Painless\s+Parker|Elizabeth\s+Blackwell|Anandibai\s+Joshi|patent\s+medicine\s+era/i.test(storyText)) {
    return "dramatized_reenactment";
  }

  // "역사"라는 단어가 있더라도 "마케팅 역사", "광고의 역사" 같은 분석/설명 맥락은 general
  // "역사적 인물을 재연한다" 같은 명시적 재연 맥락만 dramatized_reenactment
  if (/역사[적]?\s*(인물|사건)\s*(재연|재현|묘사)/.test(storyText)) return "dramatized_reenactment";

  return "general";
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
  newInformation?: string;     // English ≤12 words — 이 컷이 새로 전달하는 정보 (이전 컷에 없던 것)
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
  dialogueText?: string;   // 한국어 — 극 중 인물이 말하는 대사 (TTS용, videoPrompt에 포함 금지)
}

interface MultiShotItem {
  index: number;
  prompt: string;
  promptKo?: string;
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
      const roleCamera: Record<ShotRoleServer, string> = {
        establish: "Wide shot, eye-level.",
        transition: "Medium shot, new angle.",
        develop: "Medium close-up, eye-level.",
        insert: "Extreme close-up.",
        peak: "Close-up, dramatic angle.",
        resolve: "Wide shot, pull-back.",
      };
      const roleKo: Record<ShotRoleServer, string> = {
        establish: "전경 — 공간과 위치 확인",
        transition: "전환 — 새로운 시점",
        develop: "전개 — 인물의 구체적 행동",
        insert: "인서트 — 핵심 디테일 클로즈업",
        peak: "절정 — 감정 최고조 순간",
        resolve: "마무리 — 시각적 해소",
      };

      // videoPrompt에서 timing beat 추출 (0s-2s:... 2s-5s:... 5s-8s:...)
      const timingBeats: string[] = [];
      const timingPattern = /\d+s-\d+s:\s*([^.]+)/g;
      let m: RegExpExecArray | null;
      while ((m = timingPattern.exec(basePrompt)) !== null) {
        timingBeats.push(m[1].trim());
      }

      // timing beat가 부족하면 videoPrompt의 문장들로 보충
      const fallbackBeats = basePrompt.split(/\.\s*/).filter(s => s.trim().length > 10 && !/^\d+s-/.test(s.trim()));
      while (timingBeats.length < targetCount && fallbackBeats.length > 0) {
        timingBeats.push(fallbackBeats.shift()!.trim());
      }

      const repairedShots: MultiShotItem[] = roles.map((role, i) => {
        if (i < existingShots.length) {
          return { index: i + 1, prompt: existingShots[i].prompt.slice(0, 400), promptKo: existingShots[i].promptKo, duration: String(durations[i]), role };
        }
        // timing beat에서 시나리오 맞춤 내용 추출
        const beatContent = timingBeats[Math.min(i, timingBeats.length - 1)]?.trim() || "";
        const camera = roleCamera[role];
        return {
          index: i + 1,
          prompt: beatContent
            ? `${camera} ${beatContent}`.slice(0, 400)
            : `${camera} ${basePrompt.slice(0, 200)}`.slice(0, 400),
          promptKo: roleKo[role],
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

// ─── deterministic fallback 기본 캐릭터 (Step1 실패 시) ──────────────────────
// 한국어 텍스트에서 regex로 인물 추출은 불가능 (동사/명사가 주어 패턴에 매칭됨)
// → 안전한 기본값 사용. 실제 캐릭터 추출은 Gemini Step1에서만 수행.

function extractDefaultSeeds(_storyText: string): CharacterSeed[] {
  return [{ id: "char-1", label: "주인공", appearance: "A young person, casual modern clothing, natural look", appearanceKo: "캐주얼 의상의 젊은 인물" }];
}

// ─── JSON 파싱 유틸 ───────────────────────────────────────────────────────────

function safeParseObj(text: string): Record<string, unknown> | null {
  const t = text.trim();
  try { return JSON.parse(t) as Record<string, unknown>; } catch { /* */ }
  // 완전한 JSON 객체 추출 시도
  const obj = parseFirstJsonObject(t);
  if (obj) return obj;
  // 잘린 JSON 복구 시도 (truncated output에서 outlines 배열 일부 살리기)
  return repairTruncatedJson(t);
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
  fragmentedEditBlock?: string,
  historicalGroundingBlock?: string,
  koreanSubjectBlock?: string,
): Promise<{ characterSeeds: CharacterSeed[]; outlines: CutOutline[]; _narrativeCore?: string; _targetEmotions?: string[] }> {

  // ── 단일 호출 cutCount 상한: STEP1_SINGLE_CALL_MAX_CUTS ──
  // Gemini 출력 토큰 한도 내에서 안정적으로 JSON 완성 가능한 범위.
  // 이 이상은 multi-chain에서 분할 호출해야 함.
  if (cutCount > STEP1_SINGLE_CALL_MAX_CUTS) {
    console.warn(`[cuts:step1] cutCount ${cutCount} exceeds single-call max ${STEP1_SINGLE_CALL_MAX_CUTS} — clamping`);
    cutCount = STEP1_SINGLE_CALL_MAX_CUTS;
  }

  // 영화적 샷 가이드 — 서사 기능에 따라 샷 타입을 선택하도록 유도 (고정 순서 아님)
  const shotGuide = `서사 기능에 맞는 샷 타입 선택 (아래는 참고용 매핑이지, 순서 강제가 아님):
  배경설정→WS/LS | 문제제기→MS/CU | 원인제시→MCU/OTS | 변화발생→MS↔CU대비 | 갈등→CU/ECU | 결과→WS/LS(변화된 공간) | 반전→POV/ECU | 결론→WS(정리)
  ⚠️ 인접 컷 동일 샷 타입 금지. SCENE1은 WS/LS(establishing) 권장하되 서사상 이유가 있으면 예외 허용`;

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
✅ 스크립트가 현대↔과거를 비교하는 경우: 현대 장면에 등장하는 역할 캐릭터도 허용 (예: 현대 의사, 인스타 유저, 블로거 등)
❌ 강사, 발표자, 해설자, 내레이터, 진행자

### 장면 설계 방향
- 내레이션 텍스트의 팩트를 시각적 행동으로 변환
- 대화극이 아닌, 행동과 상황으로 정보를 보여주기
- 교훈적 메시지 또는 대체역사 가정은 상황 아이러니로 드러내기
- ⚠️ 서사 순서 엄수: 스크립트가 "현대 → 과거" 또는 "과거 → 현대"로 시작하면, 첫 장면은 스크립트의 도입부 시대를 그대로 따라야 한다. 역사 콘텐츠라고 무조건 과거부터 시작하지 마라.
- 현대↔과거 비교 구조의 스크립트에서는 시대 전환 장면이 반드시 포함되어야 한다
` : `
## 콘텐츠 형식: 일반 영상 장면

### 금지
- 강사/발표자/해설자 캐릭터 자동 생성 금지
- 모든 대사는 한국어로 작성
`;

  // ── Step1 프롬프트: 경량 아웃라인 전용 ────────────────────────────────────
  // 목적: characterSeeds + outlines JSON만 빠르게 생성
  // 무거운 규칙(SCENE_TERM_PRECISION, 감정→행동 상세 예시)은 step2/3에서 적용
  // storyText: 서사 분석에 전체 맥락이 필요. 3000자까지 전체 사용.
  // 초과 시 앞 1500자 + 뒤 1200자 (중간 생략 최소화 — 서사 연결 손실 방지)
  const STORY_LIMIT = 3000;
  const storyExcerpt = storyText.length <= STORY_LIMIT
    ? storyText
    : storyText.slice(0, 1500) + "\n…[중략: 원문 " + (storyText.length - 2700) + "자 생략]…\n" + storyText.slice(-1200);

  const prompt = `당신은 ${directorNameKo} 감독 스타일로 장면을 구조화하는 시나리오 분석가입니다.
${formatRules}
${generationPersonaBlock ? generationPersonaBlock.slice(0, 300) + "\n" : ""}${characterPersonaBlock ? characterPersonaBlock.slice(0, 400) + "\n" : ""}${editorialPlanningBlock ? editorialPlanningBlock.slice(0, 500) + "\n" : ""}${fragmentedEditBlock ? fragmentedEditBlock + "\n" : ""}감독 핵심: ${directorPersona ? directorPersona.slice(0, 300) : "강한 시각 개성"}
조건: ${secPerCut}초/시퀀스, 총 ${cutCount}시퀀스. 각 시퀀스는 VEO 1회 생성 단위(8초). 시퀀스 내부 멀티샷은 별도 처리.

## ⚠️ 최우선 원칙: 원본 시나리오의 톤과 서사를 존중하라
- 시나리오가 일상적/담담한 톤이면 장면도 일상적/담담하게 표현하라. 과도한 드라마화 금지.
- 시나리오가 정보 전달 목적(역사, 설명, 마케팅 분석 등)이면 장면도 정보 전달 중심으로 구성하라.
- "극적 긴장감"이나 "감정 폭발"을 시나리오가 요구하지 않으면 인위적으로 추가하지 마라.
- 시나리오 원문에 없는 사건, 갈등, 위기를 만들어내지 마라.
- 시나리오의 핵심 주장과 정보 흐름을 빠짐없이 장면에 반영하라.

시나리오를 바로 이미지 프롬프트로 변환하지 마라. 반드시 아래 5단계를 먼저 수행하라.

### 1단계: 핵심 주장 1문장 요약
이 시나리오가 전달하려는 핵심 주장/변화/메시지를 1문장으로 요약하라.
→ _narrativeCore 필드에 기록 (한국어 ≤30자)

### 2단계: 핵심 감정 추출
시청자가 이 영상을 보고 받아야 할 핵심 감정 1~2개를 추출하라.
→ _targetEmotions 필드에 기록 (영어 키워드 1~2개)

### 3단계: 서사 비트 분해
장면을 ${cutCount}개의 서사 비트로 분해하라. 서사 기능 단위로 분할 — 사물/장소 단위 분할 금지.
각 비트에 아래 서사 기능 중 하나를 부여:
- 배경 설정 (어떤 세계/상황인가)
- 문제 제기 (무엇이 잘못되었거나 부족한가)
- 원인 제시 (왜 이런 일이 일어나는가)
- 변화 발생 (무엇이 달라지는가)
- 갈등/긴장 (무엇이 충돌하는가)
- 결과/귀결 (어떤 결과가 나타나는가)
- 반전 (기대와 다른 결과)
- 결론/의미 (이 이야기가 남기는 것)

### 4단계: 각 컷의 신규 정보 정의
각 비트마다 '이 컷이 새로 전달하는 정보'를 정의하라.
→ newInformation 필드에 기록 (영어 ≤12 words)
⚠️ 이전 컷과 겹치는 정보만으로 구성된 컷은 금지. 반드시 새로운 시각 정보가 있어야 한다.

### 5단계: 컷 프롬프트 작성 (4단계 완료 후에만)
서사 비트와 신규 정보가 확정된 후에야 시각화하라:
- "문제 제기" → 문제의 결과가 보이는 구체적 장면 (빈 가게, 쌓인 서류, 닫힌 문)
- "원인 제시" → 원인이 작동하는 장면 (경쟁자의 행동, 정책 변화, 자연재해)
- "변화 발생" → 이전과 이후의 대비가 보이는 장면
- "결과/귀결" → 결과의 증거가 보이는 장면
상징/분위기 샷은 서사 기능을 보조할 때만 사용. 서사를 대체하지 마라.

## ⚠️ 서사 완전 커버리지 규칙 (최우선)
- 시나리오의 모든 핵심 논점/사건/전환점이 최소 1개 컷에 반영되어야 한다.
- 시나리오 앞부분에만 집중하고 뒷부분을 생략하는 것은 금지. 마지막 문장까지 커버해야 한다.
- 컷이 부족하면 1개 컷에 2개 논점을 압축하되, 논점 자체를 누락하지 마라.
- 특히 시나리오의 결론/결과/의미 부분은 반드시 마지막 컷에 포함해야 한다.

## ⚠️ 컷 간 차별화 규칙 (필수)
- 인접 컷은 정보, 구도, 액션, 감정 중 최소 2개 이상 달라야 한다.
- 쇼트 사이즈만 wide→medium→close로 바꾸는 식의 기계적 변화 금지.
- 모든 컷은 '왜 이 컷이 필요한지' 설명 가능해야 한다 — narrativeFunction으로 증명.
- 예쁜 그림보다 서사 전달이 우선 — 서사 기능이 없는 장면은 생성 금지.
- 프롬프트에 장면의 기능(이 컷이 이야기에서 무슨 역할을 하는지)이 반드시 드러나야 한다.

## 시나리오
${storyExcerpt}
${scriptAnalysisHint ? `\n## 대본 사전 분석 (참고용 — 이 구조를 기반으로 시퀀스를 설계하되, 감독 스타일을 적용)\n${scriptAnalysisHint.slice(0, 600)}\n` : ""}${continuityBlock ? `\n${continuityBlock}\n` : ""}${deepAnalysisBriefBlock ? `\n${deepAnalysisBriefBlock}\n` : ""}${historicalGroundingBlock ? `\n${historicalGroundingBlock}\n` : ""}${koreanSubjectBlock ? `\n${koreanSubjectBlock}\n` : ""}
## 출력 JSON 스키마
⚠️ JSON 최상단에 아래 2개 필드를 먼저 출력 (5단계 분석의 1~2단계 결과):

_narrativeCore: 시나리오 핵심 주장 1문장 (한국어 ≤30자) — 5단계 중 1단계 결과
_targetEmotions: 시청자가 받아야 할 핵심 감정 (영어 키워드 1~2개, 예: ["awe","sorrow"]) — 5단계 중 2단계 결과

characterSeeds (최대 3명 — 스크립트에서 실제 등장/언급되는 인물 추출 필수):
⚠️ "주인공"이라고 뭉뚱그리지 마라. 스크립트에 이름/역할이 나오면 그대로 사용.
- 스크립트에 "홍길동"이 나오면 → label: "홍길동"
- 스크립트에 "의사"와 "환자"가 나오면 → char-1: "의사", char-2: "환자"
- 스크립트에 구체적 인물이 없으면(에세이/설명문) → 1명만 생성
- id: "char-1", "char-2", "char-3"
- label: 한국어 이름 또는 역할명 (스크립트에서 추출)
- appearance: 영어 ≤40 words (성별/나이대/헤어 color+style/의상/피부톤 필수 — 예: "mid-30s woman, black shoulder-length hair, warm beige skin, dark blue hanbok with white collar")
- appearanceKo: ≤25자
⚠️ appearance에 skin tone(예: warm beige, deep brown, pale ivory)과 hair color(예: black, dark brown, silver-grey) 반드시 포함. 누락 시 비디오 모델이 일관성 없는 외형 생성.
⚠️ 인물이 2명 이상이면 반드시 각각 별도 characterSeed로 생성. 1명으로 합치지 마라.

outlines (정확히 ${cutCount}개 — 각 항목은 ${secPerCut}초짜리 시퀀스):

## 시각화 기준: "즉시 인식 가능성" (Instant Readability)
시청자가 장면을 보고 바로 이해해야 합니다:
- "아, 여기가 어디구나" (장소)
- "아, 이런 상황이구나" (상황)
- "아, 이 사람이 이런 상태구나" (감정)
단, 이 세 가지는 서사 기능을 시각으로 번역한 결과여야 한다.
"서사와 무관한 멋있는 비주얼"은 금지.

각 outline은 아래 필드 순서대로 작성 (narrativeFunction → newInformation을 먼저 결정한 후 시각 필드 작성):

- cutNumber: 순번
- sceneKo: ≤80자 — 이 장면이 시나리오에서 어떤 맥락/사건/변화를 보여주는지 구체적으로 서술. 단순 라벨("공장 장면") 금지 → 맥락 포함("경쟁 심화로 공장이 문을 닫고 노동자들이 마지막 짐을 싸는 장면")
- narrativeFunction: 영어 ≤8 words — 이 시퀀스가 전체 이야기에서 맡는 서사 역할. ⚠️ 시나리오에 언급된 핵심 사건/개념은 영어 명칭을 반드시 포함 (예: "Black Death devastates Europe", "feudal system collapses", "Industrial Revolution begins")
- newInformation: 영어 ≤12 words — 이 컷이 이전 컷에 없던 새로 전달하는 정보 (예: "reveal the empty factory floor that caused the decline"). 이전 컷과 겹치면 안 됨.
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
- dialogueText: (선택) 한국어 — 이 장면에서 인물이 말하는 대사. TTS 음성으로 재생됨. ⚠️ 이 텍스트는 videoPrompt/imagePrompt에 절대 포함하지 마라. subjectAction에는 "말하는 행동"만 묘사 (예: "lips move urgently", "speaks with clenched jaw")

## ⚠️ 텍스트/자막 절대 금지 (Purely Visual)
- 모든 장면은 순수 시각 표현만 사용. 텍스트, 자막, 간판, 제목 카드, 로고 등 화면 위 글자를 포함하는 요소 금지.
- sign/signboard/billboard 금지 → wooden panel/metal plate/surface 등 텍스트 없는 대체물로.
- 대사가 필요하면 dialogueText 필드에 별도 기록 (TTS로 재생됨). videoPrompt/imagePrompt에 대사 포함 금지.
- subjectAction에서 말하는 행동은 시각적으로만 묘사: "lips move" ✅ / "says '...'" ❌

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
{"_narrativeCore":"핵심 주장 ≤30자","_targetEmotions":["emotion1","emotion2"],"characterSeeds":[...],"outlines":[...]}`;

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
    if (partial && Array.isArray(partial.outlines) && (partial.outlines as unknown[]).length >= Math.floor(cutCount * 0.5)) {
      // 부분 복구 성공 — outlines가 50% 이상 있으면 downstream에서 채움
      parseMode = "partial_recovery";
      console.info(`[cuts:step1] partial recovery OK. characterSeeds=${Array.isArray(partial.characterSeeds) ? (partial.characterSeeds as unknown[]).length : 0} outlines=${(partial.outlines as unknown[]).length}/${cutCount} parseMode=${parseMode}`);
    } else {
      // (1) higher_tokens_retry 제거: STEP1_MAX_TOKENS(65536) == Gemini max이므로 동일 토큰으로 재시도는 낭비
      // 바로 compact prompt로 전환하여 Gemini 호출 1회 절약

      // (2) compact prompt로 재시도 (토큰 절약 + 성공률 향상)
      if (result.truncated || !safeParseObj(result.text)) {
        console.warn(`[cuts:step1] COMPACT RETRY — stripping verbose instructions from prompt`);
        parseMode = "compact_retry";
        // compact editorial: editorialPlanningBlock의 축약 버전 (있으면 50자 내로)
        const compactEditorial = editorialPlanningBlock
          ? editorialPlanningBlock.split("\n").filter(l => l.startsWith("- ")).map(l => l.replace(/^-\s*/, "").split(":")[0]).slice(0, 3).join(", ")
          : "";
        // compact retry용 축소 발췌: 앞 400자 + 뒤 200자 (토큰 절약)
        const compactExcerpt = storyText.length <= 600
          ? storyText
          : storyText.slice(0, 400) + "\n…[중략]…\n" + storyText.slice(-200);
        const compactPrompt = `당신은 시나리오 분석가입니다. JSON만 출력하세요.
${contentMode === "dramatized_reenactment" ? "역사 재연 콘텐츠. 강사/해설자 금지. 스크립트가 현대→과거 비교 구조이면 첫 장면은 현대로 시작. 서사 순서 엄수." : "일반 영상."}
감독: ${directorNameKo}. 조건: ${secPerCut}초/시퀀스, 총 ${cutCount}시퀀스.${compactEditorial ? `\n편집 기조: ${compactEditorial}` : ""}

시나리오: ${compactExcerpt}

먼저: 핵심 주장 1문장 + 핵심 감정 1~2개 추출 → _narrativeCore, _targetEmotions에 기록.
그 후 각 컷마다 newInformation(이전 컷에 없던 새 정보)을 정의한 후에 시각화.
인접 컷은 정보/구도/액션/감정 중 최소 2개 이상 달라야 함.

characterSeeds (최대 3명): [{id,label,appearance(영어≤30w),appearanceKo(≤20자)}]
outlines (정확히 ${cutCount}개): [{cutNumber,sceneKo(≤25자),narrativeFunction(≤8w),newInformation(≤12w),emotion,emotionalDelta,purpose,shotType,cameraMovement(≤8w),subjectAction(≤10w),transitionHint(≤8자),shotCategory,characterRole,locationCue(≤6w),situationCue(≤6w),emotionalAnchor(≤6w)}]
⚠️ 총 런타임 12초 초과면 1시퀀스 금지, 최소 2시퀀스로 분할. 각 시퀀스 ${secPerCut}초.
⚠️ 숏폼 리듬 > 감독 스타일: 감독이 롱테이크 성향이어도 반드시 ${cutCount}개 시퀀스를 생성하라. 컷 수를 줄이지 마라.

JSON만: {"_narrativeCore":"≤30자","_targetEmotions":["emotion"],"characterSeeds":[...],"outlines":[...]}`;

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

  // ── _narrativeCore / _targetEmotions 추출 ──
  const _narrativeCore = typeof parsed._narrativeCore === "string" ? parsed._narrativeCore.slice(0, 60) : undefined;
  const _targetEmotions = Array.isArray(parsed._targetEmotions)
    ? (parsed._targetEmotions as unknown[]).map(e => String(e)).slice(0, 3)
    : undefined;
  if (_narrativeCore) console.info(`[cuts:step1] narrativeCore="${_narrativeCore}" targetEmotions=${JSON.stringify(_targetEmotions ?? [])}`);

  const DEFAULT_SEED: CharacterSeed = { id: "char-1", label: "주인공", appearance: "A young person, casual modern clothing, natural look", appearanceKo: "캐주얼 의상의 젊은 인물" };
  const rawSeeds = Array.isArray(parsed.characterSeeds) ? parsed.characterSeeds as Array<Partial<CharacterSeed>> : [];
  const characterSeeds: CharacterSeed[] = rawSeeds.length > 0
    ? rawSeeds.map((s, idx) => ({
        id: String(s.id ?? `char-${idx + 1}`),
        label: String(s.label ?? `인물${idx + 1}`),
        appearance: String(s.appearance ?? DEFAULT_SEED.appearance).slice(0, 400),
        appearanceKo: String(s.appearanceKo ?? DEFAULT_SEED.appearanceKo).slice(0, 50),
      }))
    : [DEFAULT_SEED];
  console.info(`[cuts:step1] characterSeeds: ${characterSeeds.map(s => `${s.id}=${s.label}`).join(", ")} (raw=${rawSeeds.length})`);
  if (rawSeeds.length === 0 && parseMode === "partial_recovery") {
    console.warn(`[cuts:step1] characterSeeds missing in partial recovery — using default character`);
  }

  // 샷 타입 기본 순환 (step1이 다양화에 실패했을 때 fallback)
  const shotCycle: string[] = [...SHOT_TYPE_CYCLE];

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
          sceneKo: String(o.sceneKo ?? `장면 ${i + 1}`).slice(0, 100),
          narrativeFunction: o.narrativeFunction ? String(o.narrativeFunction).slice(0, 80) : undefined,
          newInformation: o.newInformation ? String(o.newInformation).slice(0, 120) : undefined,
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
          dialogueText: o.dialogueText ? String(o.dialogueText).slice(0, 200) : undefined,
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
    return { characterSeeds, outlines: repairedOutlines, _narrativeCore, _targetEmotions };
  }

  return { characterSeeds, outlines, _narrativeCore, _targetEmotions };
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
  narrativeContext?: { core?: string; emotions?: string[] },  // step1에서 추출한 서사 핵심
  contentMode?: "dramatized_reenactment" | "general",         // 콘텐츠 모드별 규칙 적용
  historicalGroundingBlock?: string,                          // Historical Grounding 프롬프트 블록
  koreanSubjectBlock?: string,                                // Contemporary Korean Subject Defaults 블록
  storyTextExcerpt?: string,                                  // 원본 시나리오 (Step 2/3이 서사 맥락 참조용)
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
  const noTextSuffix = `${videoStyle}, ${styleFingerprint}, ${aspectRatio} aspect ratio, no text overlay, no watermark, purely visual`;

  // 전체 시퀀스 컨텍스트 (배치 외 컷은 간략화하여 토큰 절약)
  const batchCutNums = new Set(batchOutlines.map(o => o.cutNumber));
  const sequenceContext = allOutlines
    .map(o => batchCutNums.has(o.cutNumber)
      ? `SCENE${o.cutNumber}[${o.shotType}|${o.purpose}|${o.shotCategory}]: "${o.sceneKo}" | beats: ${o.sceneBeat1} → ${o.sceneBeat2} → ${o.sceneBeat3} | endHook: ${o.endHook}`
      : `SCENE${o.cutNumber}[${o.shotType}|${o.shotCategory}]: "${o.sceneKo}" | endHook: ${o.endHook}`)
    .join("\n");

  // 이번 배치 컷 연출 지시 (압축형)
  const batchDirectives = batchOutlines.map((o, i) => {
    const prevOutline = allOutlines.find(a => a.cutNumber === o.cutNumber - 1);
    const nextOutline = allOutlines.find(a => a.cutNumber === o.cutNumber + 1);
    const prevDesc = prevOutline
      ? `prev=${prevOutline.shotType},${prevOutline.cameraMovement},action="${prevOutline.subjectAction}"`
      : "prev=none(establishing)";
    const nextHint = nextOutline
      ? `next=${nextOutline.shotType}(withhold something)`
      : "next=final(resolve all)";
    const isFirst = o.cutNumber === 1;
    const revealHint = isFirst
      ? "reveal=space+atmosphere only, withhold=face+conflict"
      : `reveal=new layer(${prevOutline?.shotType ?? "?"}→${o.shotType}), withhold=1 element`;
    return `SCENE${o.cutNumber} (${i + 1}/${batchOutlines.length}):
  ${o.purpose}|${o.shotType}|${o.shotCategory}|charRole=${o.characterRole}|emotionDelta=${o.emotionalDelta}
  camera=${o.cameraMovement} | action=${o.subjectAction}
  summary=${o.sceneKo}
  STORY_ROLE=${o.narrativeFunction || o.purpose}
  NEW_INFO=${o.newInformation || "(define what new information this cut reveals)"}
  WHY_THIS_CUT=${o.narrativeFunction || o.purpose} — 이 컷 없이는 서사 전달 불가${o.dialogueText ? `\n  DIALOGUE="${o.dialogueText}" — ⚠️ 대사 텍스트는 videoPrompt에 포함 금지. 말하는 행동만 묘사 (lips move, speaks with...)` : ""}
  WHERE=${o.locationCue} | WHAT=${o.situationCue} | EMOTION=${o.emotionalAnchor}
  beats(${beatTimings(secPerCut).b1}/${beatTimings(secPerCut).b2}/${beatTimings(secPerCut).b3}): ${o.sceneBeat1} → ${o.sceneBeat2} → ${o.sceneBeat3}
  endHook=${o.endHook} | ${prevDesc} | ${nextHint} | ${revealHint} | transition=${o.transitionHint}`;
  }).join("\n\n");

  const prompt = `당신은 촬영 감독이다. 스타일: ${videoStyle} | 지역: ${regionFlavor}${editingNote ? ` | ${editingNote}` : ""} | ${secPerCut}초/시퀀스 | 화면비: ${aspectRatio}

## 핵심 원칙
- ${secPerCut}초 = 3개 비트(sceneBeat)로 구성된 시퀀스. 각 비트는 다른 구도/앵글/피사체.
- ${secPerCut}초 종료 시 "어디서, 무슨 상황, 누가 어떤 감정" 즉시 인식 필수.
- 최우선: STORY ROLE → 시각적 번역. 서사 기능이 보이는 장면 > 멋있는 비주얼.
- 상황은 시각적 증거로(빈 의자, 줄 선 사람, 꺼진 조명). 추상 설명 금지.
- ⚠️ 원본 시나리오의 톤을 존중하라. 담담한 설명문이면 과도한 극적 표현 금지. 시나리오에 없는 갈등/위기/감정 폭발을 만들지 마라.
- ⚠️ 시나리오에 등장하는 핵심 사건/개념(역사적 사건명, 핵심 키워드)을 영어 프롬프트에 반드시 포함하라. 예: 흑사병→"Black Death plague", 산업혁명→"Industrial Revolution", 봉건제→"feudal system collapse". 시각 묘사만으로 맥락을 암시하지 말고, 핵심 용어를 명시적으로 적어야 한다.

## ⚠️ 컷 간 차별화 (필수 — 위반 시 실패)
- 쇼트 사이즈만 바꾸는 기계적 변화 금지 (wide→medium→close 순서 단순 반복 ✗).
- 각 컷은 NEW_INFO에 명시된 신규 정보를 반드시 시각적으로 전달해야 한다.
- 모든 컷은 WHY_THIS_CUT 필드의 서사 역할이 프롬프트에 드러나야 한다.
- 예쁜 그림보다 서사 전달 우선 — 서사 기능 없는 장면 생성 금지.
캐릭터 외형(verbatim): "${charRef}" — shotCategory별 사용 규칙은 아래 참조
[noTextSuffix] = "${noTextSuffix}" — 모든 프롬프트 끝에 이 문자열을 그대로 붙여라

## 연출 엔진 (서사 기능 종속 — 감독 스타일과 충돌 시 서사 기능 우선)
${directorEngine}
${editorialSummary ? `\n## ⚠️ EDITORIAL PERSONA REMINDER (step1에서 결정된 편집 기조 — 모든 컷에 적용)\n${editorialSummary}\n- complexity budget 유지: max 1 subject, 1 action, 1 camera motion per cut.` : ""}

${narrativeContext?.core ? `## 서사 핵심 (Step1 분석 결과 — 모든 컷이 이 방향을 따라야 함)\n핵심 주장: ${narrativeContext.core}\n핵심 감정: ${narrativeContext.emotions?.join(", ") ?? "N/A"}\n` : ""}${storyTextExcerpt ? `## 원본 시나리오 (서사 맥락 참조 — 장면이 시나리오와 일치해야 함)\n${storyTextExcerpt.slice(0, 1500)}\n\n` : ""}## 전체 시퀀스 컨텍스트 (반복 방지용 — 이 컷들의 흐름 파악에만 사용)
${sequenceContext}

## 이번 배치: CUT${firstCutNum}~CUT${lastCutNum} 상세 연출 지시 생성

${batchDirectives}

${generationPersonaBlock ? generationPersonaBlock + "\n\n" : ""}${characterPersonaBlock ? characterPersonaBlock + "\n\n" : ""}${historicalGroundingBlock ? historicalGroundingBlock + "\n\n" : ""}${koreanSubjectBlock ? koreanSubjectBlock + "\n\n" : ""}${contentMode === "dramatized_reenactment" ? `## 콘텐츠 모드: 역사 재연 (dramatized_reenactment)
- 스크립트가 현대→과거 비교 구조이면 시대 전환 장면을 시각적으로 구분하라
- 서사 순서 엄수: Step1이 결정한 장면 순서를 변경하지 마라

` : ""}## 드라마타이즈 규칙
금지: 자막, 나레이션, 해설자/진행자, 강의형 대사. 필수: 대사는 한국어. 정보는 갈등·유머·공포·아이러니로 전달. 인물은 극 중 목적으로 행동. 교훈은 상황 결과로.

## SHOT CATEGORY × charRef 규칙
- character-driven (protagonist/partial): charRef 포함, 구체적 행동 필수
- environment (absent/background/silhouette): 공간이 주 피사체, charRef 생략/"distant silhouette" 정도
- object-detail (absent/partial): 사물이 주 피사체, charRef 생략
- transition-atmosphere (absent): 전환 샷, charRef 완전 생략
charRef 수위: protagonist=전체 | partial=부분(손,뒷모습) | silhouette=실루엣만 | background=최소힌트 | absent=생략

## 캐릭터 묘사 필수 요소 (character-driven 씬에서)
charRef 사용 시 반드시 포함: skin tone(예: warm beige, deep brown, pale ivory), hair color+style(예: black shoulder-length hair).
charRef에 이미 포함된 경우 그대로 사용. 누락 시 videoPrompt에서 보충 — "a figure" "the character" 등 모호한 표현 금지.

## CINEMATIC SHOT PROGRESSION
- 각 컷의 shotType은 Step1에서 서사 기능에 맞게 결정됨 — Step2/3는 이를 존중하고 시각적으로 구현하라
- SCENE1은 WS/LS(공간 확인) 권장하되, Step1이 다른 shotType을 지정했으면 그것을 따라라
- 인접 컷 같은 shot size 2연속 금지. 중반에 LS/WS 삽입하여 시각적 호흡 확보
- 카메라: 반드시 이유 명시. push-in(긴장), dolly(심리변화), pan(발견), slow push-in(관찰), crane-up(해방). 장식용 움직임 금지. Format: MOVEMENT + "(reason: [why])"
- "static" 단독 사용 금지 → 최소한 "locked-off static, subtle drift" 또는 "slow push-in"으로 대체. 순수 정지 카메라는 의도적 억압 연출일 때만 "locked-off static (reason: oppressive stillness)" 형태로 허용.
- Reveal/Withhold: 매 장면 새 정보 1개 공개 + 미공개 1개 보류. 순서: 공간→위치→표정→소품→정점→결과

## 감독 연출 원칙
1. videoPrompt = 카메라 지시 (스토리 설명 아님). shotType 변화 반영 필수.
2. subjectAction → 구체적 신체 동작. 감정은 형용사 금지 → 신체 행동으로만:
   anxiety→fingers stop, gaze darts | hesitation→hand extends then recoils | resolve→gaze locks, action completes
   guilt→eye contact broken, hand hidden | anger→jaw sets, fist closes | relief→shoulders drop on exhale
3. 매 장면 새 시각 정보 1개+. 동일 감정 연속 시 다른 행동. 정지 포즈 금지 → 진행 중 행동.
${SCENE_TERM_PRECISION_BLOCK}

## STRICT 글자 제한 (자연어만 — 메타태그 SHOT_SIZE:/CAMERA_ANGLE:/REVEALED: 등 절대 금지)

imagePrompt (≤80 words EN): "[shot type], [angle]. [charRef if protagonist/partial | environment if absent]. [sceneBeat1]. [환경 디테일 2+]. [moodLighting]. [noTextSuffix]"
endImagePrompt (≤65 words EN): "[charRef if applicable]. [sceneBeat3 결과]. [변화]. [noTextSuffix]"

videoPrompt (≤180 words EN — 3비트 시퀀스, 각 비트 다른 shot size/앵글/피사체):
  Format: "[Beat1 shot], [angle]. [locationCue]. ${beatTemplate.replace("[start]", "[BEAT1: WHERE 장소 디테일 2+ 구체적 오브젝트/질감(cracked tile, rusted pipe, wilted flower, stacked books)]").replace("[develop]", "[BEAT2: WHAT 상황 증거(empty chair, closed shutters, overflowing ashtray, half-eaten meal)]").replace("[climax]", "[BEAT3: WHO/EMOTION 구체적 신체 행동(fingers grip armrest, shoulders slump forward, gaze drops to floor)]")}. [charRef if not absent]. [noTextSuffix]"
  환경 디테일: 최소 2개 구체적 오브젝트/질감/현상 필수 (cracked, rusted, damp, torn 등 형용사+명사)
  상황 증거: 현재 상황을 보여주는 시각 단서 필수 (empty/crowded/broken/closed/overflowing 등)
  감정 앵커: 추상 감정어 금지 → 신체 행동으로만 (slump/grip/sigh/stare/clench/tremble)
  BANNED: continues/still/same as before/standing/motionless, sign/signboard, emotion labels(anxious/sad/angry 등)
  BANNED: 한국어 테마 문구(인본주의적 시선, 시대극의 현대적 해석, 인물 심리 묘사 등) — 비디오 모델이 렌더링 불가. 영문 시각 묘사로만 기술

extendPrompt (SCENE${firstCutNum}=="" if SCENE1 | ≤120 words EN):
  "Continuing from previous — [endHook]. [Beat1 다른 앵글]. [Beat2 상황 증거]. [Beat3 감정 행동]. [charRef if applicable]. [noTextSuffix]"

cameraDirection (≤55 chars): "Lens Xmm. [movement1]→[movement2]. ${directorName} style."
moodLighting (≤55 chars, source+direction+quality 3요소 필수 — 하나라도 누락 시 규칙 위반):
  source: 구체적 광원 (window, candle, sun, fluorescent tube, neon sign, fire)
  direction: 광원 방향 (from upper left, from behind, overhead, low angle)
  quality: 광질 (diffused, harsh, warm, cold, dappled, flickering)
  예: "cold fluorescent from overhead, harsh flat wash, green-white cast"
  예: "candlelight from low right, warm flickering glow, amber tone"
  BANNED: dramatic lighting/moody atmosphere/cinematic light/sun-drenched(방향없음), sign 오브젝트

## 대사/텍스트 규칙
- 대사 텍스트는 별도 처리됨. videoPrompt/imagePrompt에 대사 절대 포함 금지. 말하는 행동만 묘사("lips move urgently" ✅ / "says '...'" ❌)
- videoPrompt/imagePrompt/endImagePrompt/extendPrompt/cameraDirection/moodLighting 필드에 한국어 금지 (영어 전용, VEO 엔진 전달용).
- 반면 videoPromptKo/cameraDirectionKo/moodLightingKo/subjectActionKo/narrativeFunctionKo/newInformationKo/promptKo 필드는 반드시 한국어로 작성 (UI 표시용). 이 Ko 필드가 비어있으면 규칙 위반.
- 환경 오브젝트 2개+ 필수. 메타 정보 대신 화면 디테일(cracked tile, rusted pipe 등).

## MULTI-SHOT 릴 프로그레션
${(() => {
    const maxShots = getMaxShots(VEO_DEFAULT_MODEL, secPerCut);
    if (maxShots <= 0) {
      return `multiShot 비활성 (${secPerCut}초 ≤ 3초) — multiShot 필드 생성 금지.`;
    }
    if (maxShots <= 2) {
      return `${maxShots}개 서브샷 필수. 각각 다른 shot size+앵글+피사체. role: "establish"|"resolve". duration 합산=${secPerCut}(최소 2초/샷).
establish=WS/LS 공간확인. resolve=CU/ECU 감정payoff.`;
    }
    const roles3 = ["establish", "develop", "resolve"];
    const roles4 = ["establish", "develop", "peak", "resolve"];
    const roles = maxShots === 3 ? roles3 : roles4;
    const rolesStr = roles.join("→");
    const shotDesc = maxShots === 3
      ? `- 서브샷 1 establish: WS/LS 공간 정체성 | 2 develop: MS/MCU 새 행동/디테일 | 3 resolve: CU/ECU 감정 해소`
      : `- 서브샷 1 establish: WS/LS 공간 정체성 | 2 develop: MS/MCU 새 행동/디테일 | 3 peak: CU/ECU 감정 최고점 | 4 resolve: WS/CU 시각적 해소`;
    return `🚨 반드시 ${maxShots}개 서브샷. 감독 스타일 무관. ${maxShots - 1}개 이하 = 규칙 위반.
프로그레션: ${rolesStr} 순 강도 상승.
- 인접 서브샷: 다른 shot size + 앵글 + 피사체 필수. 같은 피사체 반복 = 가짜 분할 → 금지.
- 정보 증가: 각 서브샷은 이전에 볼 수 없던 것을 보여줘야 함.
${shotDesc}
- duration 합산=${secPerCut}(정수). 최소 2초/샷. ≤50 words/샷, ≤400 chars/샷.
- 필수 3요소: [shot size] + [구체적 행동/대상(동사필수)] + [장소]
- ⚠️ charRef (캐릭터 외형)를 character-driven 서브샷(develop/peak)에 반드시 포함. charRef="${charRef}" — establish 샷도 인물이 보이면 포함.
- ⚠️ 환경/조명 묘사를 모든 서브샷에 복붙 금지. 공유 환경은 establish 서브샷에만 1회 기술. 나머지 서브샷은 해당 서브샷 고유 피사체/행동에 집중.
- ⚠️ prompt 필드는 반드시 영어 (VEO 영상생성 엔진 전달용). prompt 안에 한국어 단어 삽입 절대 금지.
- ⚠️ promptKo 필드는 반드시 한국어 (UI 표시용). 각 서브샷의 한국어 요약 (≤40자). 예: "폐허 전경, 돌담과 잡초" / "주인공이 문을 열고 안을 들여다봄". promptKo가 비어있으면 규칙 위반.`;
  })()}

## 🚨 한국어 표시용 필드 (필수 — 하나라도 빠지면 규칙 위반)
- videoPromptKo (필수): videoPrompt를 한국어로 요약 (≤60자). 반드시 한국어로 작성.
  예: "어두운 방에서 여자가 폰을 떨어뜨리고, 화면 빛에 얼굴이 비침"
- cameraDirectionKo: cameraDirection을 한국어로 변환 (≤30자).
  예: "35mm 렌즈. 느린 접근 → 고정"
- moodLightingKo: moodLighting을 한국어로 변환 (≤30자).
  예: "왼쪽 촛불, 따뜻한 깜빡임, 호박색"
- subjectActionKo: subjectAction을 한국어로 변환 (≤30자).
  예: "주인공이 망설이며 문을 연다"
- narrativeFunctionKo: 이 컷의 서사 기능 한국어 (≤15자).
  예: "배경 설정", "반전", "결과/귀결"
- newInformationKo: 이 컷이 새로 전달하는 정보 한국어 (≤30자).
  예: "공개 발치 쇼의 실체가 드러남"

JSON 배열로만 출력 (마크다운 없이):
${(() => {
    const maxShots = getMaxShots(VEO_DEFAULT_MODEL, secPerCut);
    const base = `{"cutNumber":${firstCutNum},"imagePrompt":"...","endImagePrompt":"...","videoPrompt":"...","videoPromptKo":"...","extendPrompt":"${firstCutNum === 1 ? "" : "..."}","cameraDirection":"...","cameraDirectionKo":"...","moodLighting":"...","moodLightingKo":"...","subjectActionKo":"...","narrativeFunctionKo":"...","newInformationKo":"..."`;
    if (maxShots <= 0) return `[${base}}]`;
    // 예시 multiShot: maxShots에 맞춰 균등 분배
    const shotDur = Math.max(2, Math.floor(secPerCut / maxShots));
    const exampleShots = [];
    const exampleRoles = maxShots === 3 ? ["establish", "develop", "resolve"] : ["establish", "develop", "peak", "resolve"];
    let remaining = secPerCut;
    const exampleCount = maxShots;
    for (let i = 1; i <= exampleCount; i++) {
      const d = i === exampleCount ? remaining : shotDur;
      exampleShots.push(`{"index":${i},"prompt":"...","promptKo":"한국어 요약 ≤40자","duration":"${d}","role":"${exampleRoles[i - 1] ?? "develop"}"}`);
      remaining -= shotDur;
    }
    return `[${base},"multiShot":[${exampleShots.join(",")}]}]`;
  })()}`;

  // 배치 크기에 비례한 토큰 예산: 컷당 ≈1200 tokens, 최소 8192, 최대 32768
  const estimatedDetailTokens = batchOutlines.length * 1200 + 500;
  const maxTokens = Math.min(32768, Math.max(8192, Math.ceil(estimatedDetailTokens * 1.3)));
  const effectiveDetailModel = modelOverride || MODEL_DETAIL;
  console.info(`[cuts:${stepLabel}] model=${effectiveDetailModel} promptLen=${prompt.length} cuts=[${batchOutlines.map(o => o.cutNumber).join(",")}] maxTokens=${maxTokens} batchSize=${batchOutlines.length}`);

  const step23Timeout = STEP23_TIMEOUT_MS;
  let result = await streamingGenerate(env, effectiveDetailModel, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.75, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
  }, { timeoutMs: step23Timeout });

  console.info(`[cuts:${stepLabel}] responseLen=${result.text.length} truncated=${result.truncated ?? false} timeoutMs=${step23Timeout}`);

  // Truncation retry: maxTokens 상향 후 재시도
  if (result.truncated && result.text && maxTokens < 32768) {
    console.warn(`[cuts:${stepLabel}] TRUNCATED — retrying with maxTokens=32768 (was ${maxTokens})`);
    result = await streamingGenerate(env, effectiveDetailModel, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 32768, responseMimeType: "application/json" },
    }, { timeoutMs: step23Timeout });
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
    // 부분 복구 시도: JSON 배열이 아니더라도 개별 JSON 객체 추출
    const objMatches = result.text.match(/\{[^{}]*"videoPrompt"[^{}]*\}/g);
    if (objMatches && objMatches.length > 0) {
      const recovered: CutDetail[] = [];
      for (const m of objMatches) {
        try { recovered.push(JSON.parse(m) as CutDetail); } catch { /* skip */ }
      }
      if (recovered.length > 0) {
        console.info(`[cuts:${stepLabel}] partial object recovery: ${recovered.length} cuts from broken JSON`);
        return recovered;
      }
    }
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
  const shotCycle: string[] = [...SHOT_TYPE_CYCLE];
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
  const noTextSuffix = `${videoStyle}, ${fallbackStyleFP}, ${aspectRatio} aspect ratio, no text overlay, no watermark, purely visual${editorialTag}`;

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

  // 스토리 텍스트를 문장 단위로 분할 (한국어 UI 표시용)
  const sentences = storyText
    .split(/[.!?\n。]\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 3);
  const sentencesPerCut = Math.max(1, Math.floor(sentences.length / cutCount));

  // 컷별 시각 장면 영어 템플릿 (한국어 스토리를 영어 프롬프트에 넣지 않음)
  const sceneTemplates = [
    { env: "dimly lit room, old wooden desk, scattered papers", action: "hand trembles, fingers clench the armrest", mood: "tension builds in confined space" },
    { env: "crowded street, vintage storefronts, gaslight lamps", action: "figure pushes through the crowd, determined stride", mood: "chaos and energy of early commerce" },
    { env: "open plaza, wooden stage, curious onlookers gathered", action: "performer gestures dramatically to the audience", mood: "spectacle draws attention" },
    { env: "close on weathered hands holding metal instruments", action: "steady grip, deliberate precise movement", mood: "clinical focus meets showmanship" },
    { env: "newspaper headline fills frame, bold black text", action: "hand points to key words, camera follows", mood: "reputation spreads through media" },
    { env: "courthouse corridor, marble columns, formal atmosphere", action: "figure walks with confidence, chin raised", mood: "confrontation with authority" },
    { env: "wide city panorama, signs and advertisements visible", action: "camera drifts across urban landscape", mood: "legacy embedded in modern world" },
    { env: "intimate portrait, single subject against dark background", action: "subtle smile, knowing look directly at camera", mood: "quiet reflection on journey" },
    { env: "busy workshop interior, tools on shelves, worn floor", action: "hands at work, practiced routine motions", mood: "craft and dedication" },
  ];

  const cuts = Array.from({ length: cutCount }, (_, i) => {
    const cutNumber = i + 1;
    const shotType = shotCycle[i % shotCycle.length];
    const purpose = i === 0 ? "establish" : i === cutCount - 1 ? "resolve" : purposeCycle[Math.min(i, purposeCycle.length - 1)];
    const cameraMovement = movementCycle[i % movementCycle.length];

    // 한국어 장면 설명 (UI 표시용)
    const cutSentences = sentences.slice(i * sentencesPerCut, (i + 1) * sentencesPerCut);
    const sceneKo = cutSentences.join(". ").slice(0, 80) || `장면 ${cutNumber}`;

    // 영어 시각 장면 (VEO용 — 한국어 절대 포함 금지)
    const template = sceneTemplates[i % sceneTemplates.length];
    const subjectAction = template.action;

    const shotLabel: Record<string, string> = { ECU: "Extreme close-up", CU: "Close-up", MCU: "Medium close-up", MS: "Medium shot", MLS: "Medium long shot", LS: "Long shot", WS: "Wide shot", OTS: "Over-the-shoulder", POV: "Point-of-view" };
    const shotDesc = shotLabel[shotType] || shotType;

    const imagePrompt = cleanText(`${shotDesc}, eye-level. ${template.env}. ${defaultLighting} ${noTextSuffix}`).slice(0, 400);
    const videoPrompt = cleanText(`${shotDesc}, eye-level. ${cameraMovement}. ${template.env}. ${template.action}. ${defaultLighting} ${noTextSuffix}`).slice(0, 400);
    const endImagePrompt = cleanText(`${template.mood}. ${noTextSuffix}`).slice(0, 400);

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
      sceneDescription: sceneKo,
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
[{"cutNumber":${missingNums[0]},"sceneKo":"≤25자","narrativeFunction":"≤8w 서사 역할","newInformation":"≤12w 이전 컷에 없는 새 정보","emotion":"영어","emotionalDelta":"prev→cur","purpose":"establish|develop|climax|resolve","shotType":"WS|MS|CU|OTS|MCU|LS|ECU|POV","cameraMovement":"≤8w","subjectAction":"≤10w","transitionHint":"≤8자","shotCategory":"character-driven|environment|object-detail|map-graphic|transition-atmosphere","characterRole":"protagonist|background|silhouette|partial|absent","locationCue":"≤6w","situationCue":"≤6w","emotionalAnchor":"≤6w"}]`;

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
  const shotCycle: string[] = [...SHOT_TYPE_CYCLE];
  const validCategories: ShotCategory[] = ["character-driven", "environment", "object-detail", "map-graphic", "transition-atmosphere"];
  const validRoles: CharacterRole[] = ["protagonist", "background", "silhouette", "partial", "absent"];

  const repairedOutlines: CutOutline[] = (repaired as Array<Partial<CutOutline>>).map((o, i) => {
    const rawCategory = String(o.shotCategory ?? "character-driven");
    const rawRole = String(o.characterRole ?? "protagonist");
    return {
      cutNumber: Number(o.cutNumber ?? missingNums[i] ?? existingOutlines.length + i + 1),
      sceneKo: String(o.sceneKo ?? `장면 ${o.cutNumber ?? i + 1}`).slice(0, 100),
      narrativeFunction: o.narrativeFunction ? String(o.narrativeFunction).slice(0, 80) : undefined,
      newInformation: o.newInformation ? String(o.newInformation).slice(0, 120) : undefined,
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
      dialogueText: o.dialogueText ? String(o.dialogueText).slice(0, 200) : undefined,
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
  return `JSON만 출력. 감독: ${directorNameKo}. ${secPerCut}초/시퀀스 × ${cutCount}컷. 반드시${cutCount}개outlines작성.${editorialSummary ? `\n${editorialSummary}` : ""}
먼저: 핵심 주장 1문장(_narrativeCore) + 핵심 감정 1~2개(_targetEmotions) 추출.
각 컷마다 narrativeFunction(서사 역할) + newInformation(새 정보) 정의 후 시각화.
스크립트가 현대→과거 비교 구조이면 첫 장면은 현대로 시작.

시나리오: ${storySnippet}

{"_narrativeCore":"핵심주장≤25자","_targetEmotions":["emotion1"],
"characterSeeds":[{"id":"char-1","label":"주인공","appearance":"...≤20w","appearanceKo":"...≤15자"}],
"outlines":[{"cutNumber":1,"sceneKo":"≤20자","narrativeFunction":"≤8w","newInformation":"≤10w","emotion":"영어","emotionalDelta":"prev→cur","purpose":"establish|develop|climax|resolve","shotType":"WS|MS|CU|OTS|MCU|LS|ECU|POV","cameraMovement":"≤6w","subjectAction":"≤8w","transitionHint":"≤6자","shotCategory":"character-driven|environment|object-detail|map-graphic|transition-atmosphere","characterRole":"protagonist|background|silhouette|partial|absent","locationCue":"≤5w","situationCue":"≤5w","emotionalAnchor":"≤5w"}]}`;
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
      fragmentedEditContext,
    } = await context.request.json() as Record<string, string | number | object>;

    const t0_request = Date.now();
    console.info(`[generate-cuts] REQUEST RECEIVED`, {
      storyTextLength: String(storyText ?? "").length,
      cutCount,
      directorName,
      directorNameKo: directorNameKo || "(none)",
      animationMode,
      aspectRatio: aspectRatio || "16:9",
      region: region || "(none)",
      cutDuration: cutDuration || "auto",
      totalDurationSeconds: rawTotalDuration || "(none)",
      continuityMode: continuityMode || false,
      continuitySegmentIndex: continuitySegmentIndex ?? "(none)",
      hasGenerationPersona: !!generationPersona,
      hasCharacterPersonas: Array.isArray(characterPersonas) && characterPersonas.length > 0,
      hasScriptAnalysisHint: !!scriptAnalysisHint,
      hasFragmentedEditContext: !!fragmentedEditContext,
    });

    // ── 필수 입력 검증 (연산 전에 조기 반환) ──
    if (!storyText?.trim() || !directorName) {
      return Response.json({ error: "storyText and directorName required" }, { status: 400 });
    }
    if (Number(cutCount) < 0 || Number(cutCount) > 100) {
      return Response.json({ error: `cutCount must be 0-100, got ${cutCount}` }, { status: 400 });
    }
    if (Number(rawTotalDuration) < 0 || Number(rawTotalDuration) > 3600) {
      return Response.json({ error: `duration must be 0-3600, got ${rawTotalDuration}` }, { status: 400 });
    }

    // cutDuration=0/undefined/null → auto. 1~15 → 명시값. VEO: 8초 고정.
    const rawSecPerCut = Number(cutDuration) || 0;
    const rawCutCount = Number(cutCount) || 0;
    const totalDurationSec = Number(rawTotalDuration) || 0;

    // ── VEO segment planning (base=8초, extension=7초) ──
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
    // 단일 호출 상한: STEP1_SINGLE_CALL_MAX_CUTS. 이 이상은 multi-chain 필요.
    const targetCuts = Math.min(Math.max(cutDecision.cutCount, 3), STEP1_SINGLE_CALL_MAX_CUTS);

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

    // ── Historical Grounding — 아시아 역사/전통 시나리오의 지역·시대 구체화 ──
    let historicalGroundingBlock = "";
    let historicalGroundingData: {
      visualAnchors?: Array<{ category: string; description: string }>;
      avoid?: string[];
      region?: string | null;
      period?: string | null;
    } | undefined;
    try {
      const { resolveHistoricalGrounding, buildHistoricalPromptDirective } = await import("../../src/lib/historical-grounding-resolver");
      const grounding = resolveHistoricalGrounding(String(storyText));
      if (grounding.detected) {
        historicalGroundingBlock = buildHistoricalPromptDirective(grounding);
        historicalGroundingData = {
          visualAnchors: grounding.visualAnchors,
          avoid: grounding.avoid,
          region: grounding.region,
          period: grounding.period,
        };
        console.info(`[generate-cuts] Historical grounding: ${grounding.region} / ${grounding.period} (confidence: ${grounding.confidence})`);
        if (grounding.warnings.length > 0) {
          console.warn(`[generate-cuts] Historical warnings: ${grounding.warnings.map(w => w.code).join(", ")}`);
        }
      }
    } catch (e) {
      console.warn(`[generate-cuts] Historical grounding skipped:`, e);
    }

    // ── Contemporary Korean Subject Defaults ─────────────────────────────
    let koreanSubjectBlock = "";
    let koreanSubjectCtx: import("../../src/lib/korean-subject-defaults").SubjectContext | undefined;
    try {
      const { detectSubjectContext, buildKoreanSubjectBlock } = await import("../../src/lib/korean-subject-defaults");
      const subjectCtx = detectSubjectContext(String(storyText));
      koreanSubjectCtx = subjectCtx;
      if (subjectCtx.isModernSetting && !subjectCtx.hasExplicitNationality) {
        koreanSubjectBlock = buildKoreanSubjectBlock(subjectCtx);
        console.info(`[generate-cuts] Korean subject defaults: label="${subjectCtx.suggestedSubjectLabel}", gender=${subjectCtx.detectedGender}, anchors=${subjectCtx.koreanLocationAnchors.slice(0, 3).join(", ")}`);
      }
    } catch (e) {
      console.warn(`[generate-cuts] Korean subject defaults skipped:`, e);
    }

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

    // ── Fragmented Edit Block 빌드 ─────────────────────────────────────
    let fragmentedEditBlock = "";
    if (fragmentedEditContext && typeof fragmentedEditContext === "object") {
      const fec = fragmentedEditContext as Record<string, unknown>;
      if (fec.isFragmented === true) {
        const minShots = Number(fec.minShotCount) || 3;
        const editStyle = String(fec.editStyle || "fragmented");
        const triggers = Array.isArray(fec.triggerTerms) ? (fec.triggerTerms as string[]).join(", ") : "";
        fragmentedEditBlock = [
          `## 편집 스타일: 분절 컷 (Fragmented Editing) [감지: ${triggers}]`,
          `- 최소 ${minShots}개 이상의 독립 shot 생성 필수 (multiShot 배열)`,
          `- 편집 리듬: ${editStyle}`,
          "- 각 shot의 framing을 다양하게: WS, MS, CU, ECU, insert shot 혼합",
          "- 동일 framing 연속 2회 이상 금지",
          "- 각 shot의 카메라 앵글 변화: eye-level, low angle, high angle, overhead, dutch angle 혼합",
          "- 각 shot의 subject/피사체를 다양하게: 인물 전체 → 손 디테일 → 공간 전경 → 사물 인서트 → 인물 표정",
          "- shot_1 단독 + temporalBeats만으로 구성 금지 — 물리적으로 분리된 독립 shot 필수",
          "- shot 간 시각적 대비가 뚜렷해야 함 (크기, 각도, 피사체 모두 변화)",
        ].join("\n");
        console.info(`[generate-cuts] fragmented edit block injected: minShots=${minShots}, style=${editStyle}`);
      }
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
    let narrativeCore: string | undefined;
    let targetEmotions: string[] | undefined;

    let step1Degraded = false;
    let step1DegradedReason = "";
    const step1Warnings: string[] = [];

    t0_step1 = Date.now();
    console.info(`[generate-cuts] STEP1 STARTING — model=${MODEL_OUTLINE}, targetCuts=${targetCuts}, secPerCut=${secPerCut}, storyLen=${String(storyText).length}, elapsed=${Date.now() - t0_request}ms`);
    try {
      // ── editorial planning block 빌드 ──
      const editorialPlanningBlock = buildEditorialPlanningRules(editorial);

      ({ characterSeeds, outlines, _narrativeCore: narrativeCore, _targetEmotions: targetEmotions } = await step1Outlines(
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
        undefined, // modelOverride
        fragmentedEditBlock || undefined,
        historicalGroundingBlock || undefined,
        koreanSubjectBlock || undefined,
      ));
      console.info(`[generate-cuts] STEP1 API RETURNED — characterSeeds=${characterSeeds.length}, outlines=${outlines.length}, narrativeCore=${narrativeCore?.slice(0, 30) ?? "none"}, elapsed=${Date.now() - t0_step1}ms`);
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
            ({ characterSeeds, outlines, _narrativeCore: narrativeCore, _targetEmotions: targetEmotions } = await step1Outlines(
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
              undefined, // modelOverride
              fragmentedEditBlock || undefined,
              historicalGroundingBlock || undefined,
              koreanSubjectBlock || undefined,
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
            ({ characterSeeds, outlines, _narrativeCore: narrativeCore, _targetEmotions: targetEmotions } = await step1Outlines(
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
              fragmentedEditBlock || undefined,
              historicalGroundingBlock || undefined,
              koreanSubjectBlock || undefined,
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
            String(storyText).slice(0, 1500), // 스토리 축약 (서사 맥락 유지)
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
            undefined, // modelOverride
            fragmentedEditBlock || undefined,
            historicalGroundingBlock || undefined,
            koreanSubjectBlock || undefined,
          );
          characterSeeds = retryResult.characterSeeds;
          outlines = retryResult.outlines;
          narrativeCore = retryResult._narrativeCore;
          targetEmotions = retryResult._targetEmotions;
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
      // step1Outlines 내부에서 이미 ultra-compact retry를 시도했는지 확인
      const alreadyTriedUltraCompact = msg.includes("ultra-compact retry failed");
      if (isTimeout && alreadyTriedUltraCompact) {
        // step1Outlines 내부에서 이미 ultra-compact 시도 → 중복 Gemini 호출 방지, 바로 deterministic
        console.warn("[generate-cuts] step1 timeout + ultra-compact already tried → deterministic fallback (Gemini 호출 1회 절약)");
        console.info(`[generate-cuts] ⚠️ DETERMINISTIC FALLBACK ACTIVATED — reason=timeout+ultra-compact-failed, step1Elapsed=${Date.now() - t0_step1}ms, totalElapsed=${Date.now() - t0_request}ms`);
        step1Warnings.push("step1 timeout + ultra-compact already failed → deterministic fallback");
        const deterministicCuts = buildDeterministicCuts(String(storyText), String(directorName), targetCuts, secPerCut, videoStyle, regionFlavor, String(animationMode), editorial);
        const defaultSeeds: CharacterSeed[] = extractDefaultSeeds(String(storyText));
        const finalizedCuts = classifyCuts(densifyCuts(deterministicCuts));
        for (const fc of finalizedCuts) { fc.durationSec = fc.cutNumber === 1 ? VEO_SEGMENT_CAP : VEO_EXTENSION_DURATION; }
        repairMultiShotMinimums(finalizedCuts);
        console.info(`[generate-cuts] DETERMINISTIC FALLBACK RESPONSE — cuts=${finalizedCuts.length}, seeds=${defaultSeeds.length}, totalElapsed=${Date.now() - t0_request}ms`);
        return Response.json({ ok: true, degraded: true, reason: `step1 timeout + ultra-compact already failed`, source: "deterministic-fallback", warnings: step1Warnings, characterSeeds: defaultSeeds, cuts: finalizedCuts, secPerCut });
      } else if (isTimeout) {
        timedOutAtStep1 = true;
        console.warn("[generate-cuts] step1 timeout — attempting ultra-compact retry (outer)");
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
              // _narrativeCore / _targetEmotions 추출 (ultra-compact 경로)
              narrativeCore = typeof parsed._narrativeCore === "string" ? parsed._narrativeCore.slice(0, 60) : undefined;
              targetEmotions = Array.isArray(parsed._targetEmotions)
                ? (parsed._targetEmotions as unknown[]).map(e => String(e)).slice(0, 3)
                : undefined;
              const shotCycleF: string[] = [...SHOT_TYPE_CYCLE];
              outlines = (parsed.outlines as Array<Partial<CutOutline>>).map((o, i) => ({
                cutNumber: Number(o.cutNumber ?? i + 1),
                sceneKo: String(o.sceneKo ?? `장면 ${i + 1}`).slice(0, 100),
                narrativeFunction: o.narrativeFunction ? String(o.narrativeFunction).slice(0, 80) : undefined,
                newInformation: o.newInformation ? String(o.newInformation).slice(0, 120) : undefined,
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
                sceneBeat1: String(o.sceneBeat1 ?? o.locationCue ?? "location establishing"),
                sceneBeat2: String(o.sceneBeat2 ?? o.situationCue ?? "situation visible"),
                sceneBeat3: String(o.sceneBeat3 ?? o.emotionalAnchor ?? "emotion revealed"),
                endHook: String(o.endHook ?? "visual tension"),
                dialogueText: o.dialogueText ? String(o.dialogueText).slice(0, 200) : undefined,
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
          console.info(`[generate-cuts] ⚠️ DETERMINISTIC FALLBACK ACTIVATED — reason=ultra-compact-failed, retryMsg=${retryMsg.slice(0, 100)}, step1Elapsed=${Date.now() - t0_step1}ms, totalElapsed=${Date.now() - t0_request}ms`);
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

          const defaultSeeds: CharacterSeed[] = extractDefaultSeeds(String(storyText));

          const finalizedCuts = classifyCuts(densifyCuts(deterministicCuts));
          for (const fc of finalizedCuts) { fc.durationSec = fc.cutNumber === 1 ? VEO_SEGMENT_CAP : VEO_EXTENSION_DURATION; }
          repairMultiShotMinimums(finalizedCuts);
          const sequencePlan = buildSequencePlanFromCuts(finalizedCuts, {
            styleId: String(animationMode || "live-action"),
            aspectRatio: (aspectRatio === "9:16" ? "9:16" : "16:9"),
            directorId: String(directorName || ""),
          });
          const sequenceValidation = validateSequencePlan(sequencePlan);

          console.info(`[generate-cuts] DETERMINISTIC FALLBACK RESPONSE — cuts=${finalizedCuts.length}, seeds=${defaultSeeds.length}, totalElapsed=${Date.now() - t0_request}ms`);
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
        console.info(`[generate-cuts] ⚠️ DETERMINISTIC FALLBACK ACTIVATED — reason=api-error, msg=${msg.slice(0, 150)}, step1Elapsed=${Date.now() - t0_step1}ms, totalElapsed=${Date.now() - t0_request}ms`);
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

        const defaultSeeds: CharacterSeed[] = extractDefaultSeeds(String(storyText));

        const finalizedCuts = classifyCuts(densifyCuts(deterministicCuts));
        for (const fc of finalizedCuts) { fc.durationSec = fc.cutNumber === 1 ? VEO_SEGMENT_CAP : VEO_EXTENSION_DURATION; }
        repairMultiShotMinimums(finalizedCuts);
        const sequencePlan = buildSequencePlanFromCuts(finalizedCuts, {
          styleId: String(animationMode || "live-action"),
          aspectRatio: (aspectRatio === "9:16" ? "9:16" : "16:9"),
          directorId: String(directorName || ""),
        });
        const sequenceValidation = validateSequencePlan(sequencePlan);

        console.info(`[generate-cuts] DETERMINISTIC FALLBACK RESPONSE — cuts=${finalizedCuts.length}, seeds=${defaultSeeds.length}, totalElapsed=${Date.now() - t0_request}ms`);
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
    const shotCycle: string[] = [...SHOT_TYPE_CYCLE];
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
        narrativeFunction: n === targetCuts ? "resolve narrative" : "develop story",
        newInformation: `new visual element for scene ${n}`,
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
    console.info(`[generate-cuts] STEP1 COMPLETE — success=true, characterSeeds=${characterSeeds.length}, outlines=${outlines.length}/${targetCuts}, narrativeCore=${narrativeCore ?? "(none)"}, targetEmotions=${JSON.stringify(targetEmotions ?? [])}, elapsed=${t1_step1 - t0_request}ms`);

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

    // ── STEP 2 & 3: 상세 프롬프트 생성 (병렬, 소배치) ─────────────────────────
    // Pro timeout 방지: 배치당 최대 3컷으로 분할하여 병렬 실행
    const STEP23_MAX_BATCH_SIZE = 3;
    const step23Batches: CutOutline[][] = [];
    for (let i = 0; i < outlines.length; i += STEP23_MAX_BATCH_SIZE) {
      step23Batches.push(outlines.slice(i, i + STEP23_MAX_BATCH_SIZE));
    }
    console.log(`[generate-cuts] step2/3 batching: ${outlines.length} cuts → ${step23Batches.length} batches (max ${STEP23_MAX_BATCH_SIZE}/batch)`);

    let allDetails: CutDetail[] = [];

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

    const narrativeCtx = narrativeCore || targetEmotions
      ? { core: narrativeCore, emotions: targetEmotions }
      : undefined;

    // storyExcerpt for step2/3 context — storyText is from request body
    const storyExcerpt = String(storyText).slice(0, 800);

    /** 모든 배치를 병렬 실행하는 헬퍼 — allSettled로 성공 배치 보존 (실패 배치만 재시도 가능) */
    const runAllBatches = async (modelOverride?: string): Promise<unknown[][]> => {
      const results = await Promise.allSettled(step23Batches.map((batch, idx) =>
        step23DetailBatch(context.env, ...detailArgs, batch, `step${idx + 2}`, generationPersonaBlock, characterPersonaBlock, editorialSummary, modelOverride, narrativeCtx, contentMode, historicalGroundingBlock, koreanSubjectBlock, storyExcerpt)
      ));
      const fulfilled: unknown[][] = [];
      let firstError: unknown = null;
      let failedCount = 0;
      for (const r of results) {
        if (r.status === "fulfilled") {
          fulfilled.push(r.value);
        } else {
          failedCount++;
          if (!firstError) firstError = r.reason;
          fulfilled.push([]); // 실패 배치는 빈 배열 → outline fallback
        }
      }
      if (failedCount > 0 && failedCount === results.length) {
        // 전체 실패 시에만 에러 throw (부분 실패는 성공 배치 보존)
        throw firstError;
      }
      if (failedCount > 0) {
        console.warn(`[generate-cuts] step2/3: ${failedCount}/${results.length} batches failed — using outline fallback for failed batches`);
      }
      return fulfilled;
    };

    t0_step23 = Date.now();
    console.info(`[generate-cuts] STEP2/3 PHASE — shouldUseFastPath=${shouldUseFastPath}, outlines=${outlines.length}, elapsed=${Date.now() - t0_request}ms`);

    if (shouldUseFastPath) {
      // Fast path: skip step2/3 entirely — use outline-based fallback prompts
      console.info(`[generate-cuts] FAST PATH — step2/3 skipped, elapsed=${Date.now() - t0_request}ms`);
      console.log("[generate-cuts] fast path: step2/3 skipped");
      t1_step23 = Date.now();
    } else {
    console.info(`[generate-cuts] STEP2/3 STARTING — model=${MODEL_DETAIL}, batches=${step23Batches.length}, cutsPerBatch=${step23Batches.map(b => b.length).join(",")}, timeoutMs=${STEP23_TIMEOUT_MS}, elapsed=${Date.now() - t0_request}ms`);
    try {
      const batchResults = await runAllBatches();
      allDetails = batchResults.flat();
      console.info(`[generate-cuts] STEP2/3 COMPLETE — success=true, details=${allDetails.length}, batches=${batchResults.length}, elapsed=${Date.now() - t0_request}ms`);
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
            const retryResults = await runAllBatches();
            allDetails = retryResults.flat();
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
            const flashResults = await runAllBatches(GEMINI_MODEL_FLASH);
            allDetails = flashResults.flat();
            retrySuccess = true;
            // Flash fallback은 정상 동작 — degraded 표시 불필요
            console.log("[generate-cuts] step2/3 Pro 429 → Flash fallback succeeded");
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
      } else if (isTimeout) {
        // ── Step 2/3 타임아웃 → Flash 모델로 한 번 시도 ──
        console.warn("[generate-cuts] step2/3 timeout — trying Flash model (faster)");
        try {
          const flashResults = await runAllBatches(GEMINI_MODEL_FLASH);
          allDetails = flashResults.flat();
          // Flash fallback은 정상 동작 — degraded 표시 불필요 (품질 차이 미미)
          console.log("[generate-cuts] step2/3 timeout → Flash fallback succeeded");
        } catch (flashErr) {
          const flashMsg = flashErr instanceof Error ? flashErr.message : String(flashErr);
          console.warn("[generate-cuts] step2/3 timeout Flash fallback failed:", flashMsg.slice(0, 200));
          // Flash도 실패 → outline-only fallback
          step1Warnings.push(`step2/3 timeout + Flash failed: ${msg.slice(0, 200)}`);
          step1Warnings.push("proceeding with outline-only cuts (no detailed prompts)");
          step1Degraded = true;
          step1DegradedReason = (step1DegradedReason ? step1DegradedReason + " + " : "") + `step2/3 timeout: ${msg.slice(0, 100)}`;
        }
      } else if (isProviderError && !isTimeout) {
        // Provider 503 등 — outline-only fallback
        const nonRetryReason = "AI 서버 일시 혼잡으로 세부 장면 보강을 건너뛰었습니다";
        console.warn(`[generate-cuts] step2/3 provider error (${providerStatus}) — falling back to outline-only`);
        step1Warnings.push(`step2/3 provider ${providerStatus}: ${nonRetryReason}`);
        step1Degraded = true;
        step1DegradedReason = (step1DegradedReason ? step1DegradedReason + " + " : "") + nonRetryReason;
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
      }
    }
    t1_step23 = Date.now();
    console.log(`[generate-cuts] step2/3 완료: ${t1_step23 - t0_step23}ms, details=${allDetails.length}, batches=${step23Batches.length}`);
    } // end of else (non-fast-path)

    t0_postprocess = Date.now();

    // ── 병합 ──────────────────────────────────────────────────────────────────
    const detailMap = new Map<number, CutDetail>();
    for (const d of allDetails) {
      const det = d as CutDetail;
      if (det && typeof det.cutNumber === "number") detailMap.set(det.cutNumber, det);
    }

    // 감독 스타일 핑거프린트: 이름 태그 대신 실제 스타일 키워드 사용
    const finalStyleFingerprint = String(directorStyle ?? "")
      ? String(directorStyle).split(/[,;|]/).slice(0, 3).map(s => s.trim()).filter(Boolean).join(", ")
      : String(directorName);
    const noTextSuffix = `${videoStyle}, ${finalStyleFingerprint}, ${String(aspectRatio ?? "16:9")} aspect ratio, no text overlay, no watermark, purely visual`;

    const cuts = outlines.map((outline, i) => {
      const d = detailMap.get(outline.cutNumber);
      const prevOutline = i > 0 ? outlines[i - 1] : null;

      const moodLighting = d?.moodLighting ?? "warm sunlight from upper left window, soft diffused glow, golden-amber cast";

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
      // NOTE: extractField는 LLM이 메타태그(SHOT_SIZE:value.) 형식으로 출력한 경우에만 동작.
      // Step2/3 프롬프트에서 메타태그를 금지하므로 대부분 빈 문자열을 반환 → || 뒤의 fallback(outline 데이터)이 사용됨.
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
        // ── 감독 시각 DNA → VEO 직접 전달 ──
        directorColorHint: (() => {
          if (!techniques?.colorPalette) return undefined;
          const isInkWash = ["ink-wash", "inkwash-painting", "east-asian-painting", "잉크워시", "ink-drawing-anime"].includes(String(animationMode));
          return isInkWash
            ? `Ink density palette: ${techniques.colorPalette} — as monochrome wash tones`
            : `Color palette: ${techniques.colorPalette}`;
        })(),
        directorCameraHint: techniques?.cameraWork
          ? `Director camera: ${techniques.cameraWork}`
          : undefined,
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
          // ── 스토리보드 정합성: Cut 1과 동등한 시각 정보 보장 ──
          moodLighting:    moodLighting,
          locationCue:     outline.locationCue || "",
          situationCue:    outline.situationCue || "",
          emotionalAnchor: outline.emotionalAnchor || "",
          bodySignal:      needsCharacter ? (extractField(ep, "BODY_SIGNAL") || videoPromptJson.bodySignal || "") : "",
          directorColorHint: videoPromptJson.directorColorHint,
          // ── Director Visual DNA: extend 프롬프트에서도 감독 색감/조명/무드 유지 ──
          directorStyleHint: (() => {
            if (!techniques) return undefined;
            const isInkWash = ["ink-wash", "inkwash-painting", "east-asian-painting", "잉크워시", "ink-drawing-anime"].includes(String(animationMode));
            const parts = isInkWash
              ? [
                  techniques.colorPalette ? `Ink-wash tonal intent (from director): ${techniques.colorPalette} — express as ink density and wash gradation, not literal color` : "",
                  techniques.lighting ? `Light/shadow as ink contrast: ${techniques.lighting}` : "",
                  techniques.moodKeywords ? `Mood: ${techniques.moodKeywords}` : "",
                ]
              : [
                  techniques.colorPalette ? `Color: ${techniques.colorPalette}` : "",
                  techniques.lighting ? `Lighting: ${techniques.lighting}` : "",
                  techniques.moodKeywords ? `Mood: ${techniques.moodKeywords}` : "",
                ];
            return parts.filter(Boolean).join(". ") || undefined;
          })(),
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

      // ── 대사 텍스트: outline.dialogueText → narrationText로 매핑 (TTS용) ──
      const dialogueAsNarration = outline.dialogueText?.trim() || undefined;

      return {
        cutNumber:     outline.cutNumber,
        durationSec:   secPerCut,
        purpose:       outline.purpose,
        narrativeFunction: outline.narrativeFunction || outline.purpose,
        newInformation: outline.newInformation || undefined,
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
        // 한국어 표시용 필드 — UI에서 사용자에게 보여주는 한국어 설명
        ...(d?.videoPromptKo ? { videoPromptKo: d.videoPromptKo } : {}),
        ...(d?.cameraDirectionKo ? { cameraDirectionKo: d.cameraDirectionKo } : {}),
        ...(d?.moodLightingKo ? { moodLightingKo: d.moodLightingKo } : {}),
        ...(d?.subjectActionKo ? { subjectActionKo: d.subjectActionKo } : {}),
        ...(d?.narrativeFunctionKo ? { narrativeFunctionKo: d.narrativeFunctionKo } : {}),
        ...(d?.newInformationKo ? { newInformationKo: d.newInformationKo } : {}),
        // 극 중 대사 → TTS 나레이션으로 출력 (영상 프롬프트에는 포함 안 됨)
        ...(dialogueAsNarration ? { narrationText: dialogueAsNarration } : {}),
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
        // Flash fallback 시 빈 배열이라도 multiShot 필드를 유지해야 repairMultiShotMinimums가 복구 가능
        multiShot: (d?.multiShot && Array.isArray(d.multiShot) && d.multiShot.length > 0)
          ? d.multiShot.map((sh: MultiShotItem, si: number) => ({
              ...sh,
              role: sh.role ?? inferMultiShotRole(si, d.multiShot!.length),
            }))
          : [],
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

    // ═══ VEO 세그먼트 클램핑 (base=8초, extension=7초) ═══════════
    // VEO 정책: 첫 번째 생성(base)은 8초, 연장(extension)은 7초.
    // cutNumber === 1 → base (VEO_SEGMENT_CAP=8초)
    // cutNumber >= 2 → extension (VEO_EXTENSION_DURATION=7초)
    for (const fc of finalizedCuts) {
      const targetDur = fc.cutNumber === 1 ? VEO_SEGMENT_CAP : VEO_EXTENSION_DURATION;
      if (fc.durationSec !== targetDur) {
        const oldDur = fc.durationSec;
        fc.durationSec = targetDur;
        // 서브샷 합계도 targetDur에 맞게 재보정
        if (fc.multiShot && Array.isArray(fc.multiShot) && fc.multiShot.length > 0 && oldDur !== targetDur) {
          const subTotal = fc.multiShot.reduce((s: number, sh: { duration: string }) => s + (parseFloat(sh.duration) || 0), 0);
          if (subTotal > 0 && subTotal !== targetDur) {
            const ratio = targetDur / subTotal;
            let remaining = targetDur;
            fc.multiShot = fc.multiShot.map((sh: { index: number; prompt: string; duration: string }, si: number, arr: Array<{ index: number; prompt: string; duration: string }>) => {
              if (si === arr.length - 1) {
                return { ...sh, duration: String(Math.max(1, remaining)) };
              }
              const scaled = Math.max(1, Math.round((parseFloat(sh.duration) || 0) * ratio));
              remaining -= scaled;
              return { ...sh, duration: String(scaled) };
            });
          }
        }
      }
    }

    // ═══ durationClass 재분류 — VEO 클램핑으로 durationSec 변경 시 stale 방지 ═══
    for (const fc of finalizedCuts) {
      // durationClass 삭제 후 classifyCuts가 재계산하도록 강제
      delete (fc as Record<string, unknown>).durationClass;
    }
    const reclassifiedCuts = classifyCuts(finalizedCuts);
    // reclassifiedCuts를 finalizedCuts에 반영 (in-place mutation)
    for (let i = 0; i < finalizedCuts.length; i++) {
      (finalizedCuts[i] as Record<string, unknown>).durationClass = reclassifiedCuts[i].durationClass;
    }

    // ═══ 멀티샷 사후 검증 — Gemini가 최소 샷 수 미달 시 자동 복구 ═══
    const preShotCounts = finalizedCuts.map(c => Array.isArray(c.multiShot) ? c.multiShot.length : 0);
    console.info(`[generate-cuts] MULTISHOT REPAIR STARTING — preShotCounts=[${preShotCounts.join(",")}], elapsed=${Date.now() - t0_request}ms`);
    repairMultiShotMinimums(finalizedCuts);
    const postShotCounts = finalizedCuts.map(c => Array.isArray(c.multiShot) ? c.multiShot.length : 0);
    console.info(`[generate-cuts] MULTISHOT REPAIR COMPLETE — postShotCounts=[${postShotCounts.join(",")}], repaired=${preShotCounts.some((v, i) => v !== postShotCounts[i])}, elapsed=${Date.now() - t0_request}ms`);

    // ═══ promptKo 누락 보충 — Gemini가 promptKo를 생성하지 않은 경우 자동 생성 ═══
    const roleKoFallback: Record<string, string> = {
      establish: "전경 — 공간과 위치 확인",
      transition: "전환 — 새로운 시점",
      develop: "전개 — 인물의 구체적 행동",
      insert: "인서트 — 핵심 디테일 클로즈업",
      peak: "절정 — 감정 최고조 순간",
      resolve: "마무리 — 시각적 해소",
    };
    let promptKoRepairCount = 0;
    for (const fc of finalizedCuts) {
      if (!Array.isArray(fc.multiShot)) continue;
      for (const sh of fc.multiShot as Array<{ promptKo?: string; role?: string; prompt?: string }>) {
        if (!sh.promptKo || sh.promptKo.trim().length === 0) {
          // sceneDescription (한국어)이 있으면 활용, 없으면 역할 기반 fallback
          const sceneKo = (fc as Record<string, unknown>).sceneDescription as string | undefined;
          sh.promptKo = sceneKo && sceneKo.trim().length > 0
            ? `${roleKoFallback[sh.role ?? "develop"]?.split(" — ")[0] ?? "전개"}: ${sceneKo.slice(0, 35)}`
            : roleKoFallback[sh.role ?? "develop"] ?? "전개 — 인물의 구체적 행동";
          promptKoRepairCount++;
        }
      }
      // videoPromptKo도 없으면 sceneDescription에서 보충
      const fcAny = fc as Record<string, unknown>;
      if (!fcAny.videoPromptKo && fcAny.sceneDescription) {
        fcAny.videoPromptKo = String(fcAny.sceneDescription).slice(0, 60);
        promptKoRepairCount++;
      }
    }
    if (promptKoRepairCount > 0) {
      console.info(`[generate-cuts] promptKo auto-repair: ${promptKoRepairCount} fields filled from sceneDescription/role fallback`);
    }

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

    console.info(`[generate-cuts] FINAL RESPONSE — source=gemini, ok=true, degraded=${step1Degraded}, fastPath=${fastPathUsed}, cuts=${finalizedCuts.length}, totalShots=${finalizedCuts.reduce((s, c) => s + (Array.isArray(c.multiShot) ? c.multiShot.length : 1), 0)}, characterSeeds=${characterSeeds.length}, totalElapsed=${totalLatencyMs}ms, step1=${step1LatencyMs}ms, step23=${step23LatencyMs}ms, postprocess=${postprocessLatencyMs}ms`);

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
      // VEO 실제 duration: Cut 1=8s, Cut 2+=7s (클라이언트 타임라인 동기화용)
      veoActualDurations: { base: VEO_SEGMENT_CAP, extension: VEO_EXTENSION_DURATION },
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
        narrativeCore: narrativeCore || undefined,
        targetEmotions: targetEmotions || undefined,
        narrativeFunctions: outlines.map(o => o.narrativeFunction || o.purpose).filter(Boolean),
        cutDurations: finalizedCuts.map(c => c.durationSec),
        cutShotCounts: finalizedCuts.map(c => Array.isArray(c.multiShot) ? c.multiShot.length : 1),
        totalShotCount: finalizedCuts.reduce((s, c) => s + (Array.isArray(c.multiShot) ? c.multiShot.length : 1), 0),
        fallbackUsed: step1Degraded && step1DegradedReason.includes("fallback"),
        fastPathUsed,
        totalLatencyMs: totalLatencyMs,
        step1LatencyMs: step1LatencyMs,
        step23LatencyMs: step23LatencyMs,
        outlineOnly: allDetails.length === 0 && outlines.length > 0,
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
          outlineOnly: allDetails.length === 0 && outlines.length > 0,
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
        outlineOnly: allDetails.length === 0 && outlines.length > 0,
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
    console.info(`[generate-cuts] OUTER CATCH ERROR — msg=${errMsg.slice(0, 200)}`);
    return Response.json({
      ok: false,
      degraded: false,
      error: "Failed to generate cuts",
      detail: errMsg,
      // stack trace는 서버 로그에만 출력 (클라이언트 노출 금지 — 보안)
      source: "gemini",
      warnings: [],
    }, { status: 500 });
  }
};
