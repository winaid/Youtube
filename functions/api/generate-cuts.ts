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
  subjectAction: string;   // English ≤15w — concrete physical action (no "stands"/"watches")
  transitionHint: string;  // 한국어 ≤15자
}

interface CutDetail {
  cutNumber: number;
  imagePrompt: string;
  endImagePrompt: string;
  videoPrompt: string;
  extendPrompt: string;
  cameraDirection: string;
  moodLighting: string;
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
): Promise<{ characterSeeds: CharacterSeed[]; outlines: CutOutline[] }> {

  // 컷 수에 따른 샷 타입 다양화 가이드
  const shotGuide = cutCount <= 5
    ? "MS → CU → WS → MCU → OTS"
    : cutCount <= 8
      ? "MS → CU → WS → OTS → MCU → LS → CU → MS"
      : "MS → CU → WS → OTS → MCU → ECU → LS → POV → CU → MS → WS → MCU → OTS → CU → MS";

  const prompt = `당신은 ${directorNameKo} 감독의 연출 방식으로 장면을 구조화하는 시나리오 분석가입니다.
이 감독의 연출 철학 전체가 각 컷의 구조를 결정해야 합니다.

## 감독 연출 철학 (이것이 모든 컷 설계의 기준)
${directorPersona ? directorPersona.slice(0, 600) : "강한 시각 개성, 인물의 심리가 화면 구성을 지배하는 스타일"}

조건: ${secPerCut}초/컷, 총 ${cutCount}컷.

## 시나리오
${storyText.slice(0, 1500)}

## 출력 규칙

### characterSeeds (최대 3명)
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

## 샷 다양화 강제 규칙
- 연속된 2개 컷이 동일한 shotType을 가지면 오류로 간주
- 각 컷의 subjectAction은 이전 컷과 반드시 다른 동작이어야 함
- 같은 장소, 같은 포즈, 같은 표정이 3컷 이상 연속되면 안 됨

JSON만 출력 (마크다운 없이):
{"characterSeeds":[{"id":"char-1","label":"주인공","appearance":"[English ≤65w]","appearanceKo":"[≤25자]"}],"outlines":[{"cutNumber":1,"sceneKo":"[≤35자]","emotion":"[English]","emotionalDelta":"opening→[emotion]","purpose":"establish","shotType":"MS","subjectAction":"[concrete action ≤15w]","transitionHint":"[≤15자]"}]}`;

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

  const outlines: CutOutline[] = Array.isArray(parsed.outlines)
    ? (parsed.outlines as Array<Partial<CutOutline>>).map((o, i) => ({
        cutNumber: Number(o.cutNumber ?? i + 1),
        sceneKo: String(o.sceneKo ?? `장면 ${i + 1}`).slice(0, 40),
        emotion: String(o.emotion ?? "neutral"),
        emotionalDelta: String(o.emotionalDelta ?? (i === 0 ? `opening→${o.emotion ?? "neutral"}` : "neutral→neutral")),
        purpose: String(o.purpose ?? "develop"),
        shotType: String(o.shotType ?? shotCycle[i % shotCycle.length]),
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
  const noTextSuffix = `${veoStyle}, ${styleFingerprint}, ${aspectRatio} aspect ratio, no text, no watermark, no captions`;

  // 전체 시퀀스 컨텍스트 (이전 컷 상태 파악용)
  const sequenceContext = allOutlines
    .map(o => `CUT${o.cutNumber}[${o.shotType}|${o.purpose}]: action="${o.subjectAction}" | emotion="${o.emotionalDelta}" | scene="${o.sceneKo}"`)
    .join("\n");

  // 이번 배치 컷 연출 지시
  const batchDirectives = batchOutlines.map((o, i) => {
    const prevOutline = allOutlines.find(a => a.cutNumber === o.cutNumber - 1);
    const prevDesc = prevOutline
      ? `[PREV CUT${prevOutline.cutNumber}: ${prevOutline.shotType}, action="${prevOutline.subjectAction}", emotion="${prevOutline.emotion}"]`
      : "[PREV: none — this is opening cut]";
    return `CUT${o.cutNumber} (${i + 1}/${batchOutlines.length}):
  Purpose: ${o.purpose} | Shot: ${o.shotType} | Emotion shift: ${o.emotionalDelta}
  Subject action: ${o.subjectAction}
  Scene: ${o.sceneKo}
  Previous: ${prevDesc}
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

## 감독 연출 원칙 (반드시 준수)
1. videoPrompt는 "스토리 설명"이 아니라 "카메라 지시"다
2. 이전 컷과 shotType이 이미 다르게 설정되어 있음 — 이것을 반드시 반영
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
5. 각 컷에서 "이전 컷에 없던 시각 정보" 최소 1개 포함
6. 동일 감정이 연속되면 다른 행동 양상으로 드러낼 것. 같은 행동 반복 금지.
7. 감정 상태를 정지된 포즈가 아니라 "진행 중인 행동 비트"로 설계할 것

## STRICT 글자 제한

imagePrompt (≤80 words English):
  Format: "[SHOT_TYPE], [angle]. [charRef]. Subject AT FRAME START: [beginning of subjectAction]. [setting/environment]. [moodLighting]. [noTextSuffix]"

endImagePrompt (≤65 words English):
  Format: "[charRef]. Subject AT FRAME END: [end state of subjectAction]. [what changed visually from start]. [noTextSuffix]"

videoPrompt (≤130 words English):
  Format: "[SHOT_TYPE from directive], [camera move]. [charRef]. SUBJECT: [subjectAction — exact motion, not vague]. ACTION BEAT: [core physical action with hesitation, interruption, or follow-through]. BODY SIGNAL: [specific hand/gaze/posture/breath change — no abstract emotion labels]. NEWLY IN FRAME: [what wasn't visible in prev cut]. ${beatTemplate.replace("[start]", "[begin subjectAction]").replace("[develop]", "[midpoint of action]").replace("[climax]", "[peak moment or interruption]")}. VISUAL CONTRAST FROM PREV: [specific difference in framing/distance/angle]. [noTextSuffix]"
  BANNED: "continues", "still", "same as before", "watches quietly", "stands facing"
  BANNED emotion labels in BODY SIGNAL: "anxious", "nervous", "sad", "angry", "happy", "scared", "guilty", "relieved" — describe the body behavior, not the feeling

extendPrompt (CUT${firstCutNum}=="" if CUT1 | others ≤110 words English):
  Format: "PREV CUT ENDS: [shotType of prev] — subject was [prev subjectAction], body showed [prev body signal]. → TRANSITION. NEW SHOT: [this shotType], [camera repositioning]. [charRef]. NEW ACTION: [this subjectAction — must be different motion from prev]. BEHAVIORAL SHIFT: [how body behavior changes — hands/gaze/posture/breath, no emotion labels]. NEWLY REVEALED: [information/element not seen before]. ${extendBeatTemplate}. [noTextSuffix]"
  BANNED: "continuing", "similar to previous", "same pose", emotion adjectives in BEHAVIORAL SHIFT

cameraDirection (≤55 chars English):
  Format: "Lens Xmm. [movement1]→[movement2]. ${directorName} style."

moodLighting (≤55 chars English):
  Format: "[lighting type]. [color grade reflecting emotionalDelta]."

JSON 배열로만 출력 (마크다운 없이):
[{"cutNumber":${firstCutNum},"imagePrompt":"...","endImagePrompt":"...","videoPrompt":"...","extendPrompt":"${firstCutNum === 1 ? "" : "..."}","cameraDirection":"...","moodLighting":"..."}]`;

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
    } = await context.request.json() as Record<string, string | number | object>;

    const secPerCut  = Number(cutDuration) || 8;
    const targetCuts = Math.min(Number(cutCount) || 8, 15);

    if (!storyText || !directorName) {
      return Response.json({ error: "storyText and directorName required" }, { status: 400 });
    }

    // ── 스타일 맵 ─────────────────────────────────────────────────────────────
    const veoStyleMap: Record<string, string> = {
      "2D 애니":       "2D anime cel-shaded, vibrant flat colors, clean outlines",
      "실사":          "photorealistic cinematic 4K",
      "하이브리드":    "hybrid 2D-3D semi-realistic blending",
      "수채화 애니":   "watercolor animation, soft translucent washes, pastel tones",
      // 로토스코핑: "painted outlines" 금지 — 실사 퍼포먼스 기반 움직임 질감이 핵심
      "로토스코핑":    "rotoscoped 2D animation, performance-derived movement timing, natural body mechanics under stylized painterly surface, traced-from-live-motion rhythm, NOT flat cartoon NOT generic anime",
      // 스톱모션: 단순 "claymation" 금지 — 질감·움직임·조명의 구체적 미학 주입
      "스톱모션":      "stop-motion animation, handcrafted tactile textures, deliberate frame-by-frame stiffness, real-world material imperfections (clay, fabric, wire), theatrical high-contrast lighting, psychological set design",
      "픽셀아트":      "pixel art 16-bit retro game aesthetic, clean pixel edges",
      "잉크워시":      "East Asian ink wash painting, sumi-e brush strokes, black ink on rice paper",
      "클레이":        "claymation, smooth clay figures, visible fingerprint texture, studio lighting",
      "빈티지 필름":   "vintage 35mm film, warm grain, faded colors, 1970s cinema",
      "네온 사이버펑크":"neon cyberpunk, glowing neon lights, vivid pink/blue/purple palette",
      "미니어처":      "tilt-shift miniature photography, tiny diorama, shallow depth of field",
    };
    const veoStyle = veoStyleMap[String(animationMode)] ?? "photorealistic cinematic";

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
        : "0s-2s:[start]. 2s-5s:[develop]. 5s-8s:[climax]";

    const extendBeatTemplate = secPerCut === 4
      ? "0s-1s:[prev→trans]. 1s-3s:[new scene]. 3s-4s:[settle]"
      : secPerCut === 6
        ? "0s-2s:[prev→trans]. 2s-4s:[new scene]. 4s-6s:[settle]"
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
        step23DetailBatch(context.env, ...detailArgs, batch1, "step2"),
        batch2.length > 0
          ? step23DetailBatch(context.env, ...detailArgs, batch2, "step3")
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

    const noTextSuffix = `${veoStyle}, directed by ${String(directorName)}, no text, no watermark, no captions`;

    const cuts = outlines.map((outline, i) => {
      const d = detailMap.get(outline.cutNumber);
      const prevOutline = i > 0 ? outlines[i - 1] : null;

      // extendPrompt: 빈 문자열이거나 너무 짧으면 outline 기반 fallback 생성
      const extendFallback = prevOutline
        ? `PREV CUT ENDS: ${prevOutline.shotType} — subject was ${prevOutline.subjectAction}, emotion ${prevOutline.emotion}. → TRANSITION to ${outline.shotType}. ${mainChar.appearance}. NEW ACTION: ${outline.subjectAction}. EMOTIONAL SHIFT: ${outline.emotionalDelta}. ${extendBeatTemplate}. ${noTextSuffix}`
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
        videoPrompt:      d?.videoPrompt      ?? `${outline.shotType}, slow push-in. ${mainChar.appearance}. SUBJECT: ${outline.subjectAction}. EMOTIONAL TONE: ${outline.emotionalDelta}. ${beatTemplate}. ${noTextSuffix}`,
        extendPrompt:     i === 0 ? "" : (d?.extendPrompt && d.extendPrompt.trim().length > 20
          ? d.extendPrompt
          : extendFallback),
        transitionHint:   outline.transitionHint,
        characterConsistency: `캐릭터 고정: ${mainChar.appearanceKo}. 모든 장면 동일 유지.`,
        charactersInScene: [mainChar.id],
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
