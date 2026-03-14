/**
 * generate-cuts.ts — 3단계 파이프라인 (감독 연출 의도 기반)
 *
 * Step1: 캐릭터 시드 + 컷 아웃라인 (shotType 다양화, emotionalDelta, subjectAction 포함)
 * Step2+3: 배치별 시각 프롬프트 (전체 시퀀스 컨텍스트 + anti-repetition 강제)
 *
 * 토큰 예산:
 *   Step1: maxTokens=4096  (아웃라인 전체 — 경량 프롬프트)
 *   Step2: maxTokens=8192  (컷 1~N/2 상세)
 *   Step3: maxTokens=8192  (컷 N/2+1~N 상세) — Step2와 병렬
 */
import { GeminiEnv, streamingGenerate, GEMINI_MODEL_FLASH } from "./_gemini-keys";
import type { VideoPromptJson, ExtendPromptJson } from "./_video-prompt-json";
import { buildSequencePlanFromCuts, validateSequencePlan } from "./_sequence-plan";
import { classifyCuts } from "./_structure-classification";
import { densifyCuts } from "./_sequence-density";

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
}

type Env = GeminiEnv;

const MODEL_OUTLINE = GEMINI_MODEL_FLASH;
const MODEL_DETAIL  = GEMINI_MODEL_FLASH;

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

  const lines: string[] = [
    "### Director Aesthetic Engine (operational rules — NOT style tags)",
    `Persona core: ${persona}`,
    style ? `Style principle: ${style}` : "",
    tech.cameraStyle   ? `Camera philosophy: ${tech.cameraStyle}` : "",
    tech.editingStyle  ? `Editing rhythm: ${tech.editingStyle}` : "",
    tech.colorPalette  ? `Color/lighting: ${tech.colorPalette}` : "",
    tech.characterDesign ? `Character design: ${tech.characterDesign}` : "",
    tech.emotionalCore ? `Emotional core: ${tech.emotionalCore}` : "",
    stopMotionRules,
    hybridRules,
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
 * 목적: 영상 모델(Veo/Kling)이 "치과 의자" → 일반 의자, "기계" → 추상 오브젝트로 잘못 해석하는 것을 방지.
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
  // ── Scene progression (8초 안의 내부 비트) ──────────────
  sceneBeat1: string;      // English ≤12w — 0s~2s: LOCATION — 장소를 즉시 인식시키는 시각 요소
  sceneBeat2: string;      // English ≤12w — 2s~5s: SITUATION — 현재 상태/문제를 보여주는 증거
  sceneBeat3: string;      // English ≤12w — 5s~8s: EMOTION — 감정/갈등이 집약되는 순간
  endHook: string;         // English ≤10w — 다음 씬으로 이어지는 시각적 고리
}

interface MultiShotItem {
  index: number;
  prompt: string;
  duration: string;
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

// ─── JSON 파싱 유틸 ───────────────────────────────────────────────────────────

function safeParseObj(text: string): Record<string, unknown> | null {
  const t = text.trim();
  try { return JSON.parse(t) as Record<string, unknown>; } catch { /* */ }
  try {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as Record<string, unknown>;
  } catch { /* */ }
  return null;
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
  try {
    const m = t.match(/\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]) as unknown[];
  } catch { /* */ }
  return null;
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
${generationPersonaBlock ? generationPersonaBlock.slice(0, 300) + "\n" : ""}감독 핵심: ${directorPersona ? directorPersona.slice(0, 300) : "강한 시각 개성"}
조건: ${secPerCut}초/컷, 총 ${cutCount}컷.

## 시나리오
${storyExcerpt}

## 출력 JSON 스키마

characterSeeds (최대 3명):
- id: "char-1" 등
- label: 한국어 역할명
- appearance: 영어 ≤40 words (성별/나이/헤어/의상/피부톤만)
- appearanceKo: ≤25자

outlines (정확히 ${cutCount}개 — 각 항목은 ${secPerCut}초짜리 "마이크로 씬"):

## ⚠️ 핵심 원칙: "즉시 인식 가능성" (Instant Readability)
시청자가 장면을 보고 바로 이해해야 합니다:
- "아, 치과구나" (장소)
- "아, 손님이 없구나" (상황)
- "아, 원장이 힘들구나" (감정)
설명을 읽어야 이해되는 장면이 아니라, 시각적 단서만으로 즉시 의미가 전달되는 scene.
"멋있어 보이는 무드 샷"보다 "보자마자 의미가 읽히는 서사 샷"을 우선합니다.

각 씬 설계 시 반드시 아래 세 가지를 먼저 정의하세요:
1. locationCue: 보자마자 어디인지 아는 핵심 오브젝트 (치과 → dental chair, 식당 → dining tables, 사무실 → office desk)
2. situationCue: 보자마자 상황을 아는 증거 (한산함 → empty waiting chairs, 성공 → packed customers, 위기 → warning notice)
3. emotionalAnchor: 감정이 집약되는 시각 포인트 (원장 한숨 → doctor slumps at desk, 결심 → hand grips phone tightly)
이 세 가지가 없으면 씬을 다시 설계하세요.

- cutNumber: 순번
- sceneKo: ≤30자
- emotion: 영어 키워드
- emotionalDelta: "이전→현재" (CUT1: "opening→[emotion]")
- purpose: establish | develop | climax | resolve
- shotType: ${shotGuide} (연속 동일 금지 — 씬 시작 시점의 오프닝 샷)
- cameraMovement: ≤10 words 영어
- subjectAction: 영어 ≤12 words — 이 씬에서 일어나는 핵심 행동/변화 (금지: stands, watches, feels)
- transitionHint: ≤10자
- shotCategory: "character-driven" | "environment" | "object-detail" | "map-graphic" | "transition-atmosphere"
  (먼저 결정: 이 씬에 캐릭터가 꼭 필요한가? 정보/분위기/공간/지도 씬은 인물 없이 설계. 지도/항공/인포그래픽 씬은 "map-graphic" 사용)
- characterRole: "protagonist" | "background" | "silhouette" | "partial" | "absent"
  ⚠️ shotCategory가 environment/object-detail/map-graphic/transition-atmosphere이면 characterRole="absent" 권장
  ⚠️ characterRole이 "absent"가 아닌 경우 subjectAction은 반드시 구체적 행동 포함 (standing/motionless 금지)
- locationCue: 영어 ≤8 words — 장소를 즉시 인식시키는 핵심 시각 오브젝트 (예: "dental chair and overhead lamp", "restaurant kitchen with steel counters")
- situationCue: 영어 ≤8 words — 현재 상황을 즉시 보여주는 증거 (예: "empty waiting room, no patients", "long queue outside the door")
- emotionalAnchor: 영어 ≤8 words — 감정/갈등이 집약되는 시각 요소 (예: "doctor alone slumping at desk", "hand crumpling printed notice")
- sceneBeat1: 영어 ≤12 words — ${secPerCut >= 8 ? "0s~2s" : "0s~1s"}: LOCATION — 장소를 즉시 인식시키는 시각 요소 (locationCue가 화면에 보여야 함)
- sceneBeat2: 영어 ≤12 words — ${secPerCut >= 8 ? "2s~5s" : "1s~3s"}: SITUATION — 현재 상태/문제를 보여주는 증거 (situationCue가 드러나야 함)
- sceneBeat3: 영어 ≤12 words — ${secPerCut >= 8 ? "5s~8s" : "3s~" + secPerCut + "s"}: EMOTION — 감정/갈등이 집약되는 순간 (emotionalAnchor가 등장)
- endHook: 영어 ≤10 words — 관객이 다음 씬을 기대하게 만드는 시각적 고리

## ⚠️ 컷 밀도 규칙 (single-cut 방지)
- 총 길이 ${secPerCut * cutCount}초 기준: 반드시 ${cutCount}개의 개별 cuts를 작성하라
- 12초 초과인데 1컷으로 뭉개면 실패. 최소 3컷으로 분할하라
- 9~12초면 최소 3컷, 5~9초면 최소 2컷으로 나눌 것
- 같은 장면을 길게 이어쓰지 말고, shot/camera/beat가 다른 편집 단위로 나눌 것
- ❌ 나쁜 예: 15초를 1개 outline으로 작성
- ✅ 좋은 예: 15초를 4~5초짜리 3~4개 outline으로 분할

JSON만 출력:
{"characterSeeds":[...],"outlines":[...]}`;

  // ── Token budget: 컷 수에 비례하여 maxOutputTokens 산정 ──
  // 각 outline ≈ 300-400 tokens, characterSeeds ≈ 200 tokens, JSON overhead ≈ 200
  // 안전 마진 1.5배 → 최소 4096, 최대 8192
  const estimatedTokens = 200 + cutCount * 400 + 200;
  const step1MaxTokens = Math.min(8192, Math.max(4096, Math.ceil(estimatedTokens * 1.5)));
  console.info(`[cuts:step1] model=${MODEL_OUTLINE} promptLen=${prompt.length} cutCount=${cutCount} maxTokens=${step1MaxTokens} estimatedTokens=${estimatedTokens}`);

  let result = await streamingGenerate(env, MODEL_OUTLINE, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: step1MaxTokens, responseMimeType: "application/json" },
  });

  console.info(`[cuts:step1] responseLen=${result.text.length} truncated=${result.truncated ?? false} parseMode=normal`);

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
      // (1) maxOutputTokens를 8192로 올려서 재시도
      if (step1MaxTokens < 8192) {
        console.warn(`[cuts:step1] RETRY with higher maxTokens=8192 (was ${step1MaxTokens})`);
        parseMode = "higher_tokens_retry";
        result = await streamingGenerate(env, MODEL_OUTLINE, {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 8192, responseMimeType: "application/json" },
        });
        console.info(`[cuts:step1] higher_tokens_retry responseLen=${result.text.length} truncated=${result.truncated ?? false}`);
      }

      // (2) 여전히 truncated이면 compact prompt로 재시도
      if (result.truncated || !safeParseObj(result.text)) {
        console.warn(`[cuts:step1] COMPACT RETRY — stripping verbose instructions from prompt`);
        parseMode = "compact_retry";
        const compactPrompt = `당신은 시나리오 분석가입니다. JSON만 출력하세요.
${contentMode === "dramatized_reenactment" ? "역사 재연 콘텐츠. 강사/해설자 금지." : "일반 영상."}
감독: ${directorNameKo}. 조건: ${secPerCut}초/컷, 총 ${cutCount}컷.

시나리오: ${storyExcerpt}

characterSeeds (최대 3명): [{id,label,appearance(영어≤30w),appearanceKo(≤20자)}]
outlines (정확히 ${cutCount}개): [{cutNumber,sceneKo(≤25자),emotion,emotionalDelta,purpose,shotType,cameraMovement(≤8w),subjectAction(≤10w),transitionHint(≤8자),shotCategory,characterRole,locationCue(≤6w),situationCue(≤6w),emotionalAnchor(≤6w),sceneBeat1(≤10w),sceneBeat2(≤10w),sceneBeat3(≤10w),endHook(≤8w)}]
⚠️ 12초 초과면 1컷 금지, 최소 3컷 분할. 9~12초면 최소 3컷.

JSON만: {"characterSeeds":[...],"outlines":[...]}`;

        result = await streamingGenerate(env, MODEL_OUTLINE, {
          contents: [{ role: "user", parts: [{ text: compactPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: "application/json" },
        });
        console.info(`[cuts:step1] compact_retry responseLen=${result.text.length} truncated=${result.truncated ?? false}`);

        if (result.truncated) {
          // compact retry도 truncated → partial 파싱 시도 후 실패하면 throw
          const lastPartial = safeParseObj(result.text);
          if (lastPartial && Array.isArray(lastPartial.outlines) && (lastPartial.outlines as unknown[]).length > 0) {
            parseMode = "partial_recovery";
            console.info(`[cuts:step1] compact partial recovery: ${(lastPartial.outlines as unknown[]).length} outlines`);
          } else {
            throw new Error(`step1 truncated after compact retry: output ${result.text.length}chars, maxTokens=8192. cutCount=${cutCount}개가 너무 많거나 스토리가 너무 깁니다.`);
          }
        }
      }
    }
  } else if (result.error) {
    // Check if it's a timeout — try ultra-compact before throwing
    if (result.timedOut || (result.status === 524)) {
      console.warn(`[cuts:step1] TIMEOUT detected — attempting ultra-compact retry`);
      const ultraPrompt = buildUltraCompactStep1Prompt(storyText, directorNameKo, cutCount, secPerCut);
      const ultraResult = await streamingGenerate(env, MODEL_OUTLINE, {
        contents: [{ role: "user", parts: [{ text: ultraPrompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: "application/json" },
      }, { timeoutMs: 30_000 });

      if (!ultraResult.error && !ultraResult.timedOut && ultraResult.text) {
        result = ultraResult;
        parseMode = "compact_retry";
        console.info(`[cuts:step1] ultra-compact recovery succeeded. responseLen=${result.text.length}`);
      } else {
        throw new Error(`step1 TIMEOUT + ultra-compact retry failed: ${result.error.slice(0, 300)}`);
      }
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
          sceneBeat1: String(o.sceneBeat1 ?? "location-identifying objects and space"),
          sceneBeat2: String(o.sceneBeat2 ?? "situation evidence becomes visible"),
          sceneBeat3: String(o.sceneBeat3 ?? "emotional anchor enters or is revealed"),
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

  return { characterSeeds, outlines };
}

// ─── STEP 2/3: 배치 단위 시각 프롬프트 생성 (감독 연출 지시 방식) ────────────

async function step23DetailBatch(
  env: GeminiEnv,
  allOutlines: CutOutline[],    // 전체 시퀀스 컨텍스트 (anti-repetition용)
  charAppearance: string,
  veoStyle: string,
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
  const noTextSuffix = `${veoStyle}, ${styleFingerprint}, ${aspectRatio} aspect ratio, with natural diegetic sound and ambient audio, no text, no watermark, no captions`;

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
  ── INSTANT READABILITY (시청자가 바로 이해해야 하는 3가지) ──
  WHERE (장소 단서): ${o.locationCue}
  WHAT (상황 단서): ${o.situationCue}
  WHO/EMOTION (감정 앵커): ${o.emotionalAnchor}
  ── SCENE BEATS: location → situation → emotion ──
  BEAT1 LOCATION (${secPerCut >= 8 ? "0s-2s" : "0s-1s"}): ${o.sceneBeat1}  — 장소가 즉시 인식되어야 함
  BEAT2 SITUATION (${secPerCut >= 8 ? "2s-5s" : "1s-3s"}): ${o.sceneBeat2}  — 상황/문제의 시각적 증거
  BEAT3 EMOTION (${secPerCut >= 8 ? "5s-" + secPerCut + "s" : "3s-" + secPerCut + "s"}): ${o.sceneBeat3}  — 감정/갈등 집약
  END HOOK: ${o.endHook}
  ── CONTEXT ──
  Previous: ${prevDesc}
  ${nextHint}
  ${revealHint}
  Transition out: ${o.transitionHint}`;
  }).join("\n\n");

  const prompt = `당신은 아래 연출 철학을 완전히 내면화한 촬영 감독입니다.
스타일: ${veoStyle} | 지역: ${regionFlavor}${editingNote ? ` | ${editingNote}` : ""}
${secPerCut}초/씬 | 화면비: ${aspectRatio}

## ⚠️ 핵심 원칙: ${secPerCut}초 = "짧은 시퀀스(sequence)"이다 (단일 샷이 아님!)
- 각 ${secPerCut}초 단위는 여러 시각 비트가 모여 하나의 의미를 전달하는 시퀀스이다.
- 예: "치과 간판 → 텅 빈 대기실 → 한숨 쉬는 원장" = 3개의 시각 비트 = 1개의 시퀀스 = "한산한 치과" 즉시 이해
- 시퀀스의 각 비트(sceneBeat)는 서로 다른 구도/앵글/피사체를 가진다.
- ${secPerCut}초가 끝났을 때 시청자는 "어디서, 무슨 상황이고, 누가 어떤 감정인지"를 바로 알아야 한다.

## ⚠️ 최우선 기준: "즉시 인식 가능성" (Instant Readability)
- 모든 장면은 보자마자 아래가 이해되어야 한다:
  1. 어디인가? (장소 정체성 — 치과면 치과답게, 식당이면 식당답게)
  2. 무슨 상황인가? (비어있음, 북적임, 위기, 성공 등)
  3. 누가 핵심인가? (인물이 있다면 무슨 역할/감정인지)
- "멋있어 보이는 분위기 샷"보다 "보자마자 의미가 읽히는 서사 샷"을 우선한다.
- 장소는 장소답게: 추상적 무드보다 장소 정체성(location-defining objects)이 먼저다.
- 상황은 증거로: 추상적 설명 대신 시각적 증거(빈 의자, 줄 선 사람, 꺼진 조명)로 보여준다.
캐릭터 외형(verbatim — 절대 수정/확장 금지): "${charRef}"
⚠️ 단, shotCategory에 따라 캐릭터 사용 여부가 달라짐 — 아래 SHOT CATEGORY RULES 참조

## 연출 엔진 (이 철학이 모든 컷의 구조를 지배한다 — 단순 스타일 태그가 아닌 설계 원칙)
${directorEngine}

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
프롬프트에 "no text" / "no readable text"를 포함하는 동시에 텍스트를 연상시키는 오브젝트를 사용하면 Veo에게 상충 신호가 됩니다.
BANNED objects: sign, faded sign, dusty sign, signboard, placard, billboard, marquee, banner text, lettered, nameplate
ALLOWED replacements: weathered wooden panel, blank metal plate, textless facade panel, empty storefront overhang, mounted panel, wall bracket, awning

## ⚠️ 시각 디테일 밀도 (Visual Detail Density)
각 씬 프롬프트에 화면에 실제로 보이는 구체적 환경 오브젝트를 2개 이상 포함하라:
예: empty reception desk, dusty floor reflection, worn dental chair silhouette, flickering fluorescent tube, half-open blinds, faded wall paint, cracked tile floor, condensation on window, peeling wallpaper strip, rusted pipe along wall
메타 정보(REVEALED/WITHHELD)를 늘리지 말고 실제 화면 디테일을 늘려라.

## MULTI-SHOT 규칙 (시퀀스 블록의 각 비트를 서브샷으로 구현 — Kling과 Veo 공통)
각 씬 = 짧은 시퀀스(sequence block). "multiShot" 배열 = location→situation→emotion 순서의 서브샷이다.
- 모든 duration(초 단위 정수) 합산 = ${secPerCut} (반드시 정확히 일치)
- 서브샷 1 = BEAT1 LOCATION: 장소 정체성 즉시 인식 (장소 고유 오브젝트 2+) — shot size: WS/LS (≤80 words)
- 서브샷 2 = BEAT2 SITUATION: 상황의 시각적 증거 (빈/붐빔/위기 등을 오브젝트로) — shot size: MS/MCU (≤80 words)
- 서브샷 3 (${secPerCut} >= 9 시 권장) = BEAT3 EMOTION: 감정/갈등 앵커 (인물의 구체적 신체 행동) — shot size: CU/ECU (≤80 words)
- ⚠️ 핵심: 서브샷마다 반드시 다른 shot size + 앵글 사용 (WS→MS→CU 등 씬 내 progression)
- ⚠️ 시퀀스 끝(서브샷 3 이후) 시청자가 WHERE + WHAT + WHO/EMOTION 3가지를 즉시 이해해야 함
- duration 분배: 균등 또는 핵심 비트에 가중치 (정수만, 합산 ${secPerCut})
- BANNED: 서브샷 전체에 동일 구도/앵글 반복, 감정 형용사 사용, "standing motionless"

JSON 배열로만 출력 (마크다운 없이):
[{"cutNumber":${firstCutNum},"imagePrompt":"...","endImagePrompt":"...","videoPrompt":"...","extendPrompt":"${firstCutNum === 1 ? "" : "..."}","cameraDirection":"...","moodLighting":"...","multiShot":[{"index":1,"prompt":"...","duration":"${Math.ceil(secPerCut / 3)}"},{"index":2,"prompt":"...","duration":"${Math.ceil(secPerCut / 3)}"},{"index":3,"prompt":"...","duration":"${secPerCut - 2 * Math.ceil(secPerCut / 3)}"}]}]`;

  // 배치 크기에 비례한 토큰 예산: 컷당 ≈1200 tokens, 최소 8192, 최대 16384
  const estimatedDetailTokens = batchOutlines.length * 1200 + 500;
  const maxTokens = Math.min(16384, Math.max(8192, Math.ceil(estimatedDetailTokens * 1.3)));
  console.info(`[cuts:${stepLabel}] model=${MODEL_DETAIL} promptLen=${prompt.length} cuts=[${batchOutlines.map(o => o.cutNumber).join(",")}] maxTokens=${maxTokens} batchSize=${batchOutlines.length}`);

  let result = await streamingGenerate(env, MODEL_DETAIL, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.75, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
  });

  console.info(`[cuts:${stepLabel}] responseLen=${result.text.length} truncated=${result.truncated ?? false}`);

  // Truncation retry: maxTokens 상향 후 재시도
  if (result.truncated && result.text && maxTokens < 16384) {
    console.warn(`[cuts:${stepLabel}] TRUNCATED — retrying with maxTokens=16384 (was ${maxTokens})`);
    result = await streamingGenerate(env, MODEL_DETAIL, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 16384, responseMimeType: "application/json" },
    });
    console.info(`[cuts:${stepLabel}] retry responseLen=${result.text.length} truncated=${result.truncated ?? false}`);
  }

  if (result.error) {
    console.error(`[cuts:${stepLabel}] error: ${result.error.slice(0, 500)}`);
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

/** MULTI_SHOT_SCENE_TYPES: 2-3 shots required */
const MULTI_SHOT_SCENE_TYPES = ["cinematic_sequence", "character-driven", "crowd", "battle"];

/**
 * 결정론적 컷 생성 — Gemini 응답 없이 입력 데이터만으로 컷 생성.
 * sceneType 글로벌 규칙 유지 (lunar 등).
 */
function buildDeterministicCuts(
  storyText: string,
  directorName: string,
  cutCount: number,
  secPerCut: number,
  veoStyle: string,
  regionFlavor: string,
  animationMode: string,
) {
  const physics = getPhysicsForScene(storyText);
  const storyExcerpt = storyText.slice(0, 200);
  const shotCycle = ["WS", "MS", "CU", "OTS", "MCU", "LS", "ECU", "POV", "MLS"];
  const purposeCycle = ["establish", "develop", "climax", "resolve"];
  const movementCycle = [
    "slow pan revealing space and atmosphere",
    "subtle dolly forward as subject is introduced",
    "slow push-in as tension builds",
    "locked-off static — contained reaction",
    "restrained reframing as focus narrows",
  ];

  const noTextSuffix = `${veoStyle}, directed by ${directorName}, with natural diegetic sound and ambient audio, no text, no watermark, no captions`;

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

/**
 * Ultra-compact step1 프롬프트 — 토큰 최소화.
 * compact retry 실패 시 마지막 시도.
 */
function buildUltraCompactStep1Prompt(
  storyText: string,
  directorNameKo: string,
  cutCount: number,
  secPerCut: number,
): string {
  const storySnippet = storyText.slice(0, 400);
  return `JSON만 출력. 감독: ${directorNameKo}. ${secPerCut}초/컷 × ${cutCount}컷. 12초초과→최소3컷,9~12초→최소3컷,반드시${cutCount}개outlines작성.
시나리오: ${storySnippet}

{"characterSeeds":[{"id":"char-1","label":"주인공","appearance":"...≤20w","appearanceKo":"...≤15자"}],
"outlines":[{"cutNumber":1,"sceneKo":"≤20자","emotion":"영어","emotionalDelta":"prev→cur","purpose":"establish|develop|climax|resolve","shotType":"WS|MS|CU|OTS|MCU|LS|ECU|POV","cameraMovement":"≤6w","subjectAction":"≤8w","transitionHint":"≤6자","shotCategory":"character-driven|environment|object-detail|map-graphic|transition-atmosphere","characterRole":"protagonist|background|silhouette|partial|absent","locationCue":"≤5w","situationCue":"≤5w","emotionalAnchor":"≤5w","sceneBeat1":"≤8w","sceneBeat2":"≤8w","sceneBeat3":"≤8w","endHook":"≤6w"}]}`;
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
      generationPersona,
      characterPersonas,
    } = await context.request.json() as Record<string, string | number | object>;

    // cutDuration=0/undefined/null → 자동(8초 기본). 1~15 → 명시값. Kling: 3~15 클램핑.
    const rawSecPerCut = Number(cutDuration) || 0;
    const secPerCut = rawSecPerCut > 0 ? Math.min(15, Math.max(3, rawSecPerCut)) : 8;
    const targetCuts = Math.min(Number(cutCount) || secPerCut, 15);

    console.log("[generate-cuts] duration params", { rawCutDuration: cutDuration, secPerCut, targetCuts });

    if (!storyText || !directorName) {
      return Response.json({ error: "storyText and directorName required" }, { status: 400 });
    }

    // ── 스타일 맵 ─────────────────────────────────────────────────────────────
    // 설계 원칙:
    //   - subject-focused composition: 배경 장식/배너/문양이 주제를 덮지 않게 subject-first 명시
    //   - 각 계열(live_action / animation_2d / stop_motion / hybrid)별로 결과 성향 분리
    //   - "2D 애니": 이전에 vibrant flat colors / clean outlines 강제 → 평면 카툰 고착 문제
    //     → 스타일 자체는 cel-shaded 기반이지만 overriding color lock을 완화
    //   - "하이브리드": "2D-3D blending"은 해석이 모호 → 실사 배경 + 스타일 캐릭터 명시
    //   - "로토스코핑": 일반 2D 아님 — performance/live-motion 기반임을 유지
    const veoStyleMap: Record<string, string> = {
      // ── live_action 계열 ──────────────────────────────────────────────────
      // 배경은 환경 묘사에 집중, 인물이 화면 주체
      "실사":          "photorealistic cinematic 4K, subject-focused composition, natural light and shadow, minimal background decoration",
      "빈티지 필름":   "vintage 35mm film, warm grain, faded colors, 1970s cinema, subject-centered frame, aged analog texture",
      "네온 사이버펑크":"neon cyberpunk, glowing neon accent lights on subject, rain-wet street, holographic haze, subject-first NOT background-overloaded",

      // ── animation_2d 계열 ─────────────────────────────────────────────────
      // 이전: "vibrant flat colors, clean outlines" → 평면 카툰으로 과도하게 고착됨
      // 수정: 스타일 식별자는 유지하되 색·선 강제를 완화, director aesthetic에 여지 부여
      "2D 애니":       "2D cel-shaded animation, hand-drawn character with expressive linework, stylized but not rigidly flat, subject-focused frame, minimal decorative background elements",
      "수채화 애니":   "watercolor animation, soft translucent washes, pastel tones, gentle bleeding edges, subject as focal point NOT decorative background",
      "픽셀아트":      "pixel art 16-bit retro game aesthetic, clean pixel edges, limited color palette, character-centered composition",
      "잉크워시":      "East Asian ink wash painting, sumi-e brush strokes, black ink on rice paper, negative space around subject, NOT ornate patterned background",

      // ── stop_motion 계열 ─────────────────────────────────────────────────
      // 스톱모션: 단순 "claymation" 금지 — 질감·움직임·조명의 구체적 미학 주입
      "스톱모션":      "stop-motion animation, handcrafted tactile textures, deliberate frame-by-frame stiffness, real-world material imperfections (clay, fabric, wire), theatrical high-contrast lighting, psychological set design, subject-first NOT generic decorative set",
      "클레이":        "claymation, smooth clay figures, visible fingerprint texture, studio lighting, clay-built environment NOT painted backdrop",
      "미니어처":      "tilt-shift miniature photography, tiny diorama, shallow depth of field, handcrafted miniature set, subject as primary miniature figure",

      // ── hybrid 계열 ──────────────────────────────────────────────────────
      // 로토스코핑: "painted outlines" 금지 — 실사 퍼포먼스 기반 움직임 질감이 핵심
      "로토스코핑":    "rotoscoped 2D animation over live-action performance, movement derived from real human motion, natural body mechanics under stylized painterly surface, traced-from-live-motion rhythm, NOT flat cartoon NOT generic anime NOT painted background banner",
      // 하이브리드: 이전 "2D-3D blending"은 모호 → 실사 공간 + 스타일 캐릭터로 명확화
      "하이브리드":    "HYBRID COMPOSITE [BACKGROUND=photorealistic cinematic live-action: real physical textures, volumetric depth, naturalistic environment lighting, no animation on background | CHARACTER=stylized illustrated design: visible design lines, graphic artistic stylization, character-designed render]. ANTI-COLLAPSE: NEVER render entire frame as anime/cartoon/flat illustration — background MUST stay photorealistic and cinematic. Stylization applies ONLY to characters, NOT to environment. Mixed-media composite: realistic set + stylized figure against it.",
    };
    const veoStyle = veoStyleMap[String(animationMode)] ?? "photorealistic cinematic, subject-focused composition";

    const regionFlavorMap: Record<string, string> = {
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
    const regionFlavor = regionFlavorMap[String(region)] ?? "cinematic atmosphere";

    // ── Temporal beat 템플릿 ──────────────────────────────────────────────────
    const beatTemplate = secPerCut === 4
      ? "0s-1s:[start]. 1s-3s:[develop]. 3s-4s:[climax]"
      : secPerCut === 6
        ? "0s-2s:[start]. 2s-4s:[develop]. 4s-6s:[climax]"
        : secPerCut === 10
          ? "0s-3s:[start]. 3s-7s:[develop]. 7s-10s:[climax]"
          : secPerCut === 15
            ? "0s-4s:[start]. 4s-10s:[develop]. 10s-15s:[climax]"
            : "0s-2s:[start]. 2s-5s:[develop]. 5s-8s:[climax]";

    const extendBeatTemplate = secPerCut === 4
      ? "0s-1s:[prev→trans]. 1s-3s:[new scene]. 3s-4s:[settle]"
      : secPerCut === 6
        ? "0s-2s:[prev→trans]. 2s-4s:[new scene]. 4s-6s:[settle]"
        : secPerCut === 10
          ? "0s-3s:[prev→trans]. 3s-7s:[new scene]. 7s-10s:[settle]"
          : secPerCut === 15
            ? "0s-4s:[prev→trans]. 4s-10s:[new scene]. 10s-15s:[settle]"
            : "0s-2s:[prev→trans]. 2s-5s:[new scene]. 5s-8s:[settle]";

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

    // ── STEP 1: 아웃라인 생성 ─────────────────────────────────────────────────
    let characterSeeds: CharacterSeed[];
    let outlines: CutOutline[];

    let step1Degraded = false;
    let step1DegradedReason = "";
    const step1Warnings: string[] = [];

    try {
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
      ));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isTruncation = msg.includes("MAX_TOKENS") || msg.includes("truncat");
      const isTimeout = msg.includes("TIMEOUT") || msg.includes("524") || msg.includes("timed out");
      console.error("[generate-cuts] step1 failed:", msg, "isTruncation:", isTruncation, "isTimeout:", isTimeout);

      if (isTruncation && !isTimeout) {
        // MAX_TOKENS는 서버 에러(502)가 아니라 요청 크기 문제 → 422 + 명확한 원인
        return Response.json({
          ok: false,
          degraded: false,
          error: "Step 1 출력이 토큰 한도를 초과했습니다. 컷 수를 줄이거나 스토리를 축소해주세요.",
          detail: msg,
          step: 1,
          cause: "MAX_TOKENS",
          source: "gemini",
          warnings: [],
        }, { status: 422 });
      }

      // ── Timeout/API error → ultra-compact retry → deterministic fallback ──
      if (isTimeout) {
        console.warn("[generate-cuts] step1 timeout — attempting ultra-compact retry");
        step1Warnings.push(`step1 timed out: ${msg.slice(0, 200)}`);

        try {
          const ultraPrompt = buildUltraCompactStep1Prompt(
            String(storyText),
            String(directorNameKo || directorName),
            targetCuts,
            secPerCut,
          );
          const retryResult = await streamingGenerate(context.env, MODEL_OUTLINE, {
            contents: [{ role: "user", parts: [{ text: ultraPrompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: "application/json" },
          }, { timeoutMs: 30_000 });

          if (!retryResult.error && !retryResult.timedOut) {
            const parsed = safeParseObj(retryResult.text);
            if (parsed && Array.isArray(parsed.outlines) && (parsed.outlines as unknown[]).length > 0) {
              console.info("[generate-cuts] ultra-compact retry succeeded");
              step1Warnings.push("step1 recovered via ultra-compact retry");
              step1Degraded = true;
              step1DegradedReason = "step1 timeout → ultra-compact retry succeeded";
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
                sceneBeat1: String(o.sceneBeat1 ?? "location establishing"),
                sceneBeat2: String(o.sceneBeat2 ?? "situation visible"),
                sceneBeat3: String(o.sceneBeat3 ?? "emotion revealed"),
                endHook: String(o.endHook ?? "visual tension"),
              }));
              // Jump to post-step1 processing (outlines already set)
            } else {
              throw new Error("ultra-compact parse failed");
            }
          } else {
            throw new Error(`ultra-compact also failed: ${retryResult.error?.slice(0, 200) ?? "timeout"}`);
          }
        } catch (retryErr) {
          // ── Both Gemini attempts failed → deterministic fallback ──
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          console.warn("[generate-cuts] ultra-compact retry also failed:", retryMsg, "→ deterministic fallback");
          step1Warnings.push(`ultra-compact retry failed: ${retryMsg.slice(0, 200)}`);
          step1Warnings.push("falling back to deterministic cut generation (no Gemini)");

          const deterministicCuts = buildDeterministicCuts(
            String(storyText),
            String(directorName),
            targetCuts,
            secPerCut,
            veoStyle,
            regionFlavor,
            String(animationMode),
          );

          const defaultSeeds: CharacterSeed[] = [{
            id: "char-1",
            label: "주인공",
            appearance: "A young person, casual modern clothing, natural look",
            appearanceKo: "캐주얼 의상의 젊은 인물",
          }];

          const finalizedCuts = classifyCuts(densifyCuts(deterministicCuts));
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
          veoStyle,
          regionFlavor,
          String(animationMode),
        );

        const defaultSeeds: CharacterSeed[] = [{
          id: "char-1",
          label: "주인공",
          appearance: "A young person, casual modern clothing, natural look",
          appearanceKo: "캐주얼 의상의 젊은 인물",
        }];

        const finalizedCuts = classifyCuts(densifyCuts(deterministicCuts));
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

    // 아웃라인 정규화
    const shotCycle = ["MS", "CU", "WS", "OTS", "MCU", "LS", "ECU", "POV", "MLS"];
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

    // ── STEP 2 & 3: 상세 프롬프트 생성 (병렬) ────────────────────────────────
    const mid    = Math.ceil(targetCuts / 2);
    const batch1 = outlines.slice(0, mid);
    const batch2 = outlines.slice(mid);

    let details1: CutDetail[] = [];
    let details2: CutDetail[] = [];

    const detailArgs = [
      outlines,              // allOutlines — 전체 시퀀스 컨텍스트
      mainChar.appearance,
      veoStyle,
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

    try {
      [details1, details2] = await Promise.all([
        step23DetailBatch(context.env, ...detailArgs, batch1, "step2", generationPersonaBlock, characterPersonaBlock),
        batch2.length > 0
          ? step23DetailBatch(context.env, ...detailArgs, batch2, "step3", generationPersonaBlock, characterPersonaBlock)
          : Promise.resolve([]),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isTruncation = msg.includes("MAX_TOKENS") || msg.includes("truncat");
      const isTimeout = msg.includes("TIMEOUT") || msg.includes("524") || msg.includes("timed out");
      console.error("[generate-cuts] step2/3 failed:", msg, "isTruncation:", isTruncation, "isTimeout:", isTimeout);

      if (isTruncation && !isTimeout) {
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
      }

      // step2/3 실패 → details는 비워서 outline 기반 fallback만 사용
      console.warn("[generate-cuts] step2/3 failed — proceeding with outline-only fallback");
      step1Warnings.push(`step2/3 failed: ${msg.slice(0, 200)}`);
      step1Warnings.push("proceeding with outline-only cuts (no detailed prompts)");
      step1Degraded = true;
      step1DegradedReason = (step1DegradedReason ? step1DegradedReason + " + " : "") + `step2/3 failed: ${msg.slice(0, 100)}`;
      // details1, details2 remain empty → cuts will use fallback prompts
    }

    // ── 병합 ──────────────────────────────────────────────────────────────────
    const detailMap = new Map<number, CutDetail>();
    for (const d of [...details1, ...details2]) {
      const det = d as CutDetail;
      if (det && typeof det.cutNumber === "number") detailMap.set(det.cutNumber, det);
    }

    const noTextSuffix = `${veoStyle}, directed by ${String(directorName)}, with natural diegetic sound and ambient audio, no text, no watermark, no captions`;

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
        // 멀티샷: Kling(10s+)은 model_params로 전달, Veo는 구조화 프롬프트로 적용
        ...(d?.multiShot && Array.isArray(d.multiShot) && d.multiShot.length > 0
          ? { multiShot: d.multiShot }
          : {}),
      };
    });

    // ═══ density 보정 + classify → finalizedCuts ═══════════════════
    const finalizedCuts = classifyCuts(densifyCuts(cuts));

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

    return Response.json({
      ok: true,
      degraded: step1Degraded,
      reason: step1DegradedReason || undefined,
      source: "gemini" as const,
      warnings: step1Warnings,
      characterSeeds,
      cuts: finalizedCuts,
      sequencePlan,
      sequenceValidation,
      secPerCut,
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
