/**
 * generate-cuts.ts — 3단계 파이프라인 (감독 연출 의도 기반)
 *
 * Step1: 캐릭터 시드 + 컷 아웃라인 (shotType 다양화, emotionalDelta, subjectAction 포함)
 * Step2+3: 배치별 시각 프롬프트 (전체 시퀀스 컨텍스트 + anti-repetition 강제)
 *
 * 토큰 예산:
 *   Step1: maxTokens=2048  (아웃라인 전체)
 *   Step2: maxTokens=8192  (컷 1~N/2 상세)
 *   Step3: maxTokens=8192  (컷 N/2+1~N 상세) — Step2와 병렬
 */
import { GeminiEnv, streamingGenerate } from "./_gemini-keys";

type Env = GeminiEnv;

const MODEL_OUTLINE = "gemini-2.0-flash-001";
const MODEL_DETAIL  = "gemini-2.0-flash-001";

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
  if (gp.noBackgroundClutter)  required.push("minimal background: NO excessive banners, ornate patterns, signage, or decorative elements that override subject");
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
- "advertisement" / 광고 → "hand-lettered newspaper broadside column" | "lithographic street poster tacked to brick wall" | "painted wooden signboard hung above doorway on iron bracket"
- "sign / 간판" → "gilded hanging shop sign on wrought-iron bracket" | "chalk-lettered sidewalk sandwich board" | "carved wooden shingle over entrance"
- "promotional / 홍보" → "street barker standing on wooden crate, holding printed handbill above crowd" | "market-square public demonstration with illustrated poster board"
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

interface CutOutline {
  cutNumber: number;
  sceneKo: string;         // 한국어 장면 요약 ≤35자
  emotion: string;         // English emotion keyword
  emotionalDelta: string;  // "prev→this" e.g. "calm→tense" (CUT1: "opening→[emotion]")
  purpose: string;         // establish | develop | climax | resolve
  shotType: string;        // ECU | CU | MCU | MS | MLS | LS | WS | OTS | POV
  cameraMovement: string;  // motivated camera movement (WHY it moves)
  subjectAction: string;   // English ≤15w — concrete physical action (no "stands"/"watches")
  transitionHint: string;  // 한국어 ≤15자
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
## 콘텐츠 형식: 짧은 극영화 / 역사 재연 / 시대극 (이 규칙이 모든 설계를 지배한다)

### 절대 금지 — 강의형/설명형 요소
- 강사(lecturer), 발표자(presenter), 해설자(host/narrator), 전문가 해설 캐릭터 생성 금지
- 카메라를 향해 "여러분, 오늘은 ..." 식으로 설명하는 인물 금지
- 자막(subtitle), 화면 텍스트(on-screen text lesson), 나레이션(voiceover) 금지
- "교훈:", "마케팅 포인트:", "우리가 배울 것은" 같은 설명 단락으로 끝나는 장면 금지
- 시나리오에 "교훈", "마케팅", "배울 점" 같은 단어가 있어도 → 강의형 콘텐츠로 분류 금지

### 필수 — 장면으로 보여주기
- 모든 정보 전달은 등장인물의 행동, 표정, 상황, 한국어 대사로만 이루어진다
- 인물은 극 중 구체적 목적(공포 자극, 설득, 저항, 갈등)을 가진 배우여야 한다
- 교육적 메시지는 인물의 결정·실패·아이러니 상황으로 드러낸다
- 마지막 장면의 "교훈"도 해설자가 말하는 것이 아니라 인물 대사나 상황 아이러니로 느껴지게

### characterSeeds에서 허용/금지 캐릭터 유형
✅ 역사적 실존 인물 또는 역할 기반 캐릭터 (의사, 환자, 상인, 군중, 적대자, 경쟁자)
✅ 극 안에서 목적을 가지고 충돌하는 모든 인물
❌ 강사, 발표자, 해설자, 전문가 패널, 내레이터, 진행자

### 대사 규칙
- 모든 대사(dialogue)는 반드시 한국어로 작성
- 말투는 시대극/블랙코미디/풍자극에 맞게 자연스럽게
- 인물은 정보를 갈등·협상·유머·공포·아이러니를 통해 간접적으로 전달
- 긴 설명형 독백 금지 — 짧고 목적 있는 대사만
` : `
## 콘텐츠 형식: 일반 드라마 장면

### 금지
- 강사/발표자/해설자 캐릭터 자동 생성 금지
- 자막, 나레이션, 보이스오버 금지
- 모든 대사는 한국어로 작성
`;

  const prompt = `당신은 ${directorNameKo} 감독의 연출 방식으로 장면을 구조화하는 시나리오 분석가입니다.
이 감독의 연출 철학 전체가 각 컷의 구조를 결정해야 합니다.
${formatRules}
${generationPersonaBlock ? generationPersonaBlock + "\n" : ""}${characterPersonaBlock ? characterPersonaBlock + "\n" : ""}## 감독 연출 철학 (이것이 모든 컷 설계의 기준)
${directorPersona ? directorPersona.slice(0, 600) : "강한 시각 개성, 인물의 심리가 화면 구성을 지배하는 스타일"}

조건: ${secPerCut}초/컷, 총 ${cutCount}컷.

## 시나리오
${storyText.slice(0, 1500)}

## 출력 규칙

### SCENE TERM PRECISION (appearance / subjectAction 작성 기준)
- 일반 명사 단독 금지: "chair", "machine", "equipment", "room", "tools" — 반드시 재질+형태+기능 수식어 추가
- 치과: "dental unit chair with padded headrest and suction hose" | "overhead exam lamp" | "extraction forceps on steel tray"
- 역사적 소품: "amber glass apothecary bottle" | "wooden sandwich board sign" | "lithographic street poster"
- 행동: 감정 형용사 금지, 신체 동작으로만 — "jaw locked, knuckles whitening on armrest" NOT "scared"

### characterSeeds (최대 3명 — 위 캐릭터 유형 규칙 준수)
- appearance: 영어, 최대 65 words (성별/나이/헤어/의상/피부톤만 — 심리/감정 금지)
- appearanceKo: 최대 25자

### outlines (정확히 ${cutCount}개) — 감독의 연출 의도 중심
- sceneKo: 최대 35자 (무슨 일이 일어나는가, 줄거리 요약 금지, 연출 관점으로)
- emotion: 영어 감정 키워드
- emotionalDelta: 이전 컷 대비 감정 변화 (형식: "이전감정→이감정", CUT1은 "opening→[emotion]")
- purpose: "establish" | "develop" | "climax" | "resolve" 중 하나
- shotType: 아래 목록에서 선택. 연속 컷은 반드시 다른 값 사용
  가능 값: ECU | CU | MCU | MS | MLS | LS | WS | OTS | POV
  권장 순서 (${cutCount}컷): ${shotGuide}
- subjectAction: 피사체의 구체적 신체 동작 (영어 ≤15 words)
  금지: "stands", "watches", "looks at camera", "faces forward", "feels anxious", "seems nervous", "appears sad"
  금지: 감정 형용사를 동작처럼 쓰는 것 (예: "nervously stands" — "nervously"는 형용사, 금지)
  필수: 행동 비트 — 시작·망설임·중단·충동·완수 중 하나를 포함한 구체적 동작
  감정→행동 번역 예시 (subjectAction 작성 기준):
    anxiety    → "types search term then deletes it before submitting"
    hesitation → "extends hand toward button then pulls back"
    resolve    → "pauses then grips handle and pushes door open fully"
    guilt      → "opens mouth to speak then closes it, turns gaze away"
    anger      → "clenches jaw, tightens fist, jerks head sharply to side"
    relief     → "exhales slowly, shoulders drop, hands release grip"
    anticipation→ "leans torso forward, eyes fix before body follows"
    resignation → "reaches halfway then lowers hand and steps back"
  예시: "reaches for door handle then stops, fingers hovering"
  예시: "spins abruptly toward sound, freezes mid-step"
- transitionHint: 최대 15자

## 영화적 샷 진행 강제 규칙 (MANDATORY — 단순 다양화가 아닌 "시선 설계")

### Shot Progression Law
- SCENE1: 반드시 WS 또는 LS → 공간과 분위기를 먼저 열 것. 인물 얼굴 클로즈업 금지.
- SCENE2: MS 또는 MLS → 인물에게 접근. 배경과 인물의 관계를 드러낼 것.
- SCENE3+: CU / OTS / MCU / ECU로 점진적 좁힘 → 감정 정점에서 ECU.
- 중반 이후 LS 또는 WS 1회 삽입 → 호흡을 열고 대비를 만들 것.
- 같은 거리(shot size)의 장면 2회 연속 금지.

### cameraMovement 설계 원칙
- 카메라는 감정 변화 또는 정보 공개 이유가 있을 때만 움직인다.
- 허용 움직임 (이유와 함께 작성):
  • "slow push-in as tension builds" — 긴장 고조, 인물 내면 진입
  • "subtle dolly forward as resolve grows" — 결심, 집중 강화
  • "gentle pan revealing new figure" — 새 요소/인물 발견
  • "restrained reframing as unease shifts" — 심리적 불안 표현
  • "locked-off static — suppressed tension" — 억압, 통제된 긴장
- 금지: 이유 없는 핸드헬드 흔들림, 목적 없는 zoom, 장식용 crane

### Visual Reveal / Withhold Strategy
- SCENE1에서 모든 정보 공개 금지 — 공간 분위기와 배치만.
- 인물 얼굴·핵심 소품·갈등 원인은 SCENE3 이후 점진적으로 드러낼 것.
- 각 장면은 "이전 장면에 없던 새 시각 정보 하나"를 공개해야 함.
- 동시에 "아직 보여주지 않는 것 하나"를 프레임 밖에 보류해야 함.

### 샷 다양화 강제 규칙
- 연속된 2개 장면이 동일한 shotType을 가지면 오류로 간주
- 각 장면의 subjectAction은 이전 장면과 반드시 다른 동작이어야 함
- 같은 장소, 같은 포즈, 같은 정보량이 3장면 이상 연속되면 안 됨

JSON만 출력 (마크다운 없이):
{"characterSeeds":[{"id":"char-1","label":"주인공","appearance":"[English ≤65w]","appearanceKo":"[≤25자]"}],"outlines":[{"cutNumber":1,"sceneKo":"[≤35자]","emotion":"[English]","emotionalDelta":"opening→[emotion]","purpose":"establish","shotType":"WS","cameraMovement":"slow pan revealing space and atmosphere","subjectAction":"[concrete action ≤15w]","transitionHint":"[≤15자]"}]}`;

  console.info(`[cuts:step1] model=${MODEL_OUTLINE} promptLen=${prompt.length} cutCount=${cutCount} maxTokens=2048`);

  const result = await streamingGenerate(env, MODEL_OUTLINE, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 2048, responseMimeType: "application/json" },
  });

  console.info(`[cuts:step1] responseLen=${result.text.length} truncated=${result.truncated ?? false}`);

  if (result.error) throw new Error(`step1 API error: ${result.error.slice(0, 500)}`);

  const parsed = safeParseObj(result.text);
  if (!parsed) throw new Error(`step1 parse failed. responseLen=${result.text.length} tail=${result.text.slice(-300)}`);

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

  const outlines: CutOutline[] = Array.isArray(parsed.outlines)
    ? (parsed.outlines as Array<Partial<CutOutline>>).map((o, i) => ({
        cutNumber: Number(o.cutNumber ?? i + 1),
        sceneKo: String(o.sceneKo ?? `장면 ${i + 1}`).slice(0, 40),
        emotion: String(o.emotion ?? "neutral"),
        emotionalDelta: String(o.emotionalDelta ?? (i === 0 ? `opening→${o.emotion ?? "neutral"}` : "neutral→neutral")),
        purpose: String(o.purpose ?? "develop"),
        shotType: String(o.shotType ?? shotCycle[i % shotCycle.length]),
        cameraMovement: String(o.cameraMovement ?? defaultMovements[i % defaultMovements.length]),
        subjectAction: String(o.subjectAction ?? `moves through scene ${i + 1}`),
        transitionHint: String(o.transitionHint ?? "디졸브").slice(0, 20),
      }))
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

  // 전체 시퀀스 컨텍스트 (이전 컷 상태 파악용)
  const sequenceContext = allOutlines
    .map(o => `CUT${o.cutNumber}[${o.shotType}|${o.purpose}]: action="${o.subjectAction}" | emotion="${o.emotionalDelta}" | scene="${o.sceneKo}"`)
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
    return `SCENE${o.cutNumber} (${i + 1}/${batchOutlines.length}):
  Purpose: ${o.purpose} | Shot: ${o.shotType} | Emotion shift: ${o.emotionalDelta}
  Planned camera movement: ${o.cameraMovement}
  Subject action: ${o.subjectAction}
  Scene: ${o.sceneKo}
  Previous: ${prevDesc}
  ${nextHint}
  ${revealHint}
  Transition out: ${o.transitionHint}`;
  }).join("\n\n");

  const prompt = `당신은 아래 연출 철학을 완전히 내면화한 촬영 감독입니다.
스타일: ${veoStyle} | 지역: ${regionFlavor}${editingNote ? ` | ${editingNote}` : ""}
${secPerCut}초/컷 | 화면비: ${aspectRatio}
캐릭터 외형(verbatim — 절대 수정/확장 금지): "${charRef}"

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

imagePrompt (≤80 words English):
  Format: "[SHOT_TYPE], [angle]. [charRef]. Subject AT FRAME START: [beginning of subjectAction]. [setting/environment]. [moodLighting]. [noTextSuffix]"

endImagePrompt (≤65 words English):
  Format: "[charRef]. Subject AT FRAME END: [end state of subjectAction]. [what changed visually from start]. [noTextSuffix]"

videoPrompt (≤150 words English):
  Format: "SHOT_SIZE:[shotType] | CAMERA_ANGLE:[eye-level/low-angle/high-angle/dutch/overhead/POV] | CAMERA_MOVEMENT:[movement + reason in parens e.g. slow push-in (tension builds toward reveal)]. [charRef]. SUBJECT_BLOCKING:[where subject is in frame — foreground/mid/back, frame-left/center/right, depth layer]. SUBJECT:[subjectAction exact motion]. ACTION_BEAT:[core physical action with hesitation/interruption/follow-through]. BODY_SIGNAL:[specific hand/gaze/posture/breath — no emotion labels]. REVEALED:[new visual info this frame shows not in prev]. WITHHELD:[what's kept off-frame to sustain curiosity — be specific]. ${beatTemplate.replace("[start]", "[begin subjectAction]").replace("[develop]", "[midpoint of action]").replace("[climax]", "[peak moment or interruption]")}. TRANSITION_FROM_PREV:[specific contrast — shot distance/angle change/new element entering frame]. [noTextSuffix]"
  BANNED: "continues", "still", "same as before", "watches quietly", "stands facing"
  BANNED emotion labels in BODY_SIGNAL: "anxious", "nervous", "sad", "angry", "happy", "scared", "guilty", "relieved" — body behavior only
  CAMERA_MOVEMENT must include motivation in parentheses — NEVER write just "slow push-in" alone

extendPrompt (SCENE${firstCutNum}=="" if SCENE1 | others ≤120 words English):
  Format: "PREV SCENE ENDS: [shotType of prev] — subject was [prev subjectAction], body showed [prev body signal]. → TRANSITION. NEW SHOT: SHOT_SIZE:[this shotType] | CAMERA_ANGLE:[angle] | CAMERA_MOVEMENT:[movement + reason in parens]. [charRef]. NEW ACTION: [this subjectAction — must be different motion from prev]. BEHAVIORAL SHIFT: [how body behavior changes — hands/gaze/posture/breath, no emotion labels]. NEWLY REVEALED: [what this scene shows that wasn't visible before]. STILL WITHHELD: [what remains off-frame to sustain curiosity]. ${extendBeatTemplate}. [noTextSuffix]"
  BANNED: "continuing", "similar to previous", "same pose", emotion adjectives in BEHAVIORAL SHIFT

cameraDirection (≤55 chars English):
  Format: "Lens Xmm. [movement1]→[movement2]. ${directorName} style."

moodLighting (≤55 chars English):
  Format: "[lighting type]. [color grade reflecting emotionalDelta]."

## MULTI-SHOT 규칙 (모든 장면 필수 — Kling과 Veo 공통 적용)
각 장면마다 "multiShot" 배열을 생성하라. 배열은 2~3개의 서브샷으로 구성된다.
- 모든 duration(초 단위 정수) 합산 = ${secPerCut} (반드시 정확히 일치)
- 각 서브샷 prompt: ≤80 words English, 해당 서브샷의 카메라 지시만
- 서브샷마다 다른 카메라 앵글/구도 사용 (예: close-up → wide shot → medium shot)
- 같은 캐릭터를 여러 각도에서 연속 촬영하거나 다른 등장인물/공간으로 컷 전환 가능
- 서브샷 1: 주요 행동 시작 장면 (핵심 인물/공간 설정)
- 서브샷 2: 반응 또는 클로즈업 (감정 디테일)
- 서브샷 3 (${secPerCut} >= 9일 때 권장): 풀아웃 또는 연결 앵글
- duration 분배: 균등 또는 핵심 샷에 가중치 (정수만, 합산 ${secPerCut})
- BANNED: 서브샷 전체에 동일 prompt 반복, 감정 형용사 사용

JSON 배열로만 출력 (마크다운 없이):
[{"cutNumber":${firstCutNum},"imagePrompt":"...","endImagePrompt":"...","videoPrompt":"...","extendPrompt":"${firstCutNum === 1 ? "" : "..."}","cameraDirection":"...","moodLighting":"...","multiShot":[{"index":1,"prompt":"...","duration":"${Math.ceil(secPerCut / 2)}"},{"index":2,"prompt":"...","duration":"${Math.floor(secPerCut / 2)}"}]}]`;

  const maxTokens = 8192;
  console.info(`[cuts:${stepLabel}] model=${MODEL_DETAIL} promptLen=${prompt.length} cuts=[${batchOutlines.map(o => o.cutNumber).join(",")}] maxTokens=${maxTokens}`);

  const result = await streamingGenerate(env, MODEL_DETAIL, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.75, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
  });

  console.info(`[cuts:${stepLabel}] responseLen=${result.text.length} truncated=${result.truncated ?? false}`);

  if (result.error) {
    console.error(`[cuts:${stepLabel}] error: ${result.error.slice(0, 500)}`);
    if (result.truncated && result.text) {
      console.warn(`[cuts:${stepLabel}] TRUNCATED! partialLen=${result.text.length} rawTail1000: ${result.text.slice(-1000)}`);
      const partialArr = safeParseArr(result.text);
      if (partialArr && partialArr.length > 0) {
        console.info(`[cuts:${stepLabel}] partial recover: ${partialArr.length} cuts`);
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

    const secPerCut  = Number(cutDuration) || 8;
    const targetCuts = Math.min(Number(cutCount) || 8, 15);

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
      console.error("[generate-cuts] step1 failed:", msg);
      return Response.json({ error: "Step 1 (outlines) failed", detail: msg, step: 1 }, { status: 502 });
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
      console.error("[generate-cuts] step2/3 failed:", msg);
      return Response.json({ error: "Step 2/3 (details) failed", detail: msg, step: 2 }, { status: 502 });
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

      // extendPrompt: 빈 문자열이거나 너무 짧으면 outline 기반 fallback 생성
      const extendFallback = prevOutline
        ? `PREV SCENE ENDS: ${prevOutline.shotType} — subject was ${prevOutline.subjectAction}. → TRANSITION. NEW SHOT: SHOT_SIZE:${outline.shotType} | CAMERA_MOVEMENT:${outline.cameraMovement}. ${mainChar.appearance}. NEW ACTION: ${outline.subjectAction}. NEWLY REVEALED: new visual layer beyond ${prevOutline.shotType}. ${extendBeatTemplate}. ${noTextSuffix}`
        : "";

      return {
        cutNumber:     outline.cutNumber,
        durationSec:   secPerCut,
        sceneDescription: outline.sceneKo,
        shotType:      outline.shotType,
        subjectAction: outline.subjectAction,
        emotionalDelta: outline.emotionalDelta,
        cameraDirection:  d?.cameraDirection  ?? `Lens 35mm. Slow dolly in. ${String(directorName)} style.`,
        moodLighting:     d?.moodLighting     ?? "Golden hour warm light. Teal and orange grade.",
        imagePrompt:      d?.imagePrompt      ?? `${outline.shotType}, eye-level. ${mainChar.appearance}. Subject AT START: ${outline.subjectAction.split(" ").slice(0, 6).join(" ")}. ${noTextSuffix}`,
        endImagePrompt:   d?.endImagePrompt   ?? `${mainChar.appearance}. Subject AT END: ${outline.subjectAction}. ${noTextSuffix}`,
        videoPrompt:      d?.videoPrompt      ?? `SHOT_SIZE:${outline.shotType} | CAMERA_ANGLE:eye-level | CAMERA_MOVEMENT:${outline.cameraMovement}. ${mainChar.appearance}. SUBJECT_BLOCKING:subject center-frame mid-ground. SUBJECT:${outline.subjectAction}. REVEALED:new visual layer. WITHHELD:character emotional state not yet shown. ${beatTemplate}. TRANSITION_FROM_PREV:shot size change from previous. ${noTextSuffix}`,
        extendPrompt:     i === 0 ? "" : (d?.extendPrompt && d.extendPrompt.trim().length > 20
          ? d.extendPrompt
          : extendFallback),
        transitionHint:   outline.transitionHint,
        characterConsistency: `캐릭터 고정: ${mainChar.appearanceKo}. 모든 장면 동일 유지.`,
        charactersInScene: [mainChar.id],
        // 멀티샷: Kling(10s+)은 model_params로 전달, Veo는 구조화 프롬프트로 적용
        ...(d?.multiShot && Array.isArray(d.multiShot) && d.multiShot.length > 0
          ? { multiShot: d.multiShot }
          : {}),
      };
    });

    return Response.json({ characterSeeds, cuts });

  } catch (error) {
    const errMsg   = error instanceof Error ? error.message  : String(error);
    const errStack = error instanceof Error ? (error.stack ?? "").slice(0, 800) : "";
    console.error("[generate-cuts] 예외:", errMsg, "\n", errStack);
    return Response.json({ error: "Failed to generate cuts", detail: errMsg, stack: errStack }, { status: 500 });
  }
};
