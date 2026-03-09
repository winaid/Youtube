/**
 * generate-cuts.ts — 3단계 파이프라인
 *
 * 이전 설계 문제: 8컷 전체를 한 번에 생성 → ~118k chars → MAX_TOKENS 절단
 * 해결: Step1(outline) + Step2(컷 1~N/2) + Step3(컷 N/2+1~N) 병렬 분리
 *
 * 예상 출력:
 *   Step1: ~400 tokens  (캐릭터 + 아웃라인)
 *   Step2: ~1,500 tokens (컷 4개 상세)
 *   Step3: ~1,500 tokens (컷 4개 상세) — Step2와 병렬
 *   총합: ~3,400 tokens  (이전 ~30,000 tokens 대비 88% 감소)
 */
import { GeminiEnv, streamingGenerate } from "./_gemini-keys";

type Env = GeminiEnv;

// 단계별 모델 — 변경이 필요하면 여기서만 수정
const MODEL_OUTLINE = "gemini-2.0-flash-001"; // Step1: 빠른 추출
const MODEL_DETAIL  = "gemini-2.0-flash-001"; // Step2/3: 시각 프롬프트

// ─── 내부 타입 ────────────────────────────────────────────────────────────────

interface CharacterSeed {
  id: string;
  label: string;
  appearance: string;
  appearanceKo: string;
}

interface CutOutline {
  cutNumber: number;
  sceneKo: string;      // 한국어 장면 요약 ≤35자
  emotion: string;      // English emotion keyword
  purpose: string;      // establish | develop | climax | resolve
  transitionHint: string; // 한국어 ≤15자
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

  const prompt = `당신은 영상 시나리오 분석가입니다.
감독: ${directorNameKo}${directorPersona ? `\n페르소나(발췌): ${directorPersona.slice(0, 250)}` : ""}
조건: ${secPerCut}초/컷, 총 ${cutCount}컷.

## 시나리오
${storyText.slice(0, 1500)}

## 출력 규칙 (반드시 준수)
- characterSeeds: 최대 3명
  - appearance: 영어, 최대 65 words (성별/나이/헤어/의상/피부톤만)
  - appearanceKo: 최대 25자
- outlines: 정확히 ${cutCount}개
  - sceneKo: 최대 35자
  - transitionHint: 최대 15자
  - purpose: "establish" | "develop" | "climax" | "resolve" 중 하나

JSON만 출력 (마크다운 없이):
{"characterSeeds":[{"id":"char-1","label":"주인공","appearance":"[English ≤65w]","appearanceKo":"[≤25자]"}],"outlines":[{"cutNumber":1,"sceneKo":"[≤35자]","emotion":"[English]","purpose":"establish","transitionHint":"[≤15자]"}]}`;

  console.info(`[cuts:step1] model=${MODEL_OUTLINE} promptLen=${prompt.length} cutCount=${cutCount} maxTokens=2048`);

  const result = await streamingGenerate(env, MODEL_OUTLINE, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048, responseMimeType: "application/json" },
  });

  console.info(`[cuts:step1] responseLen=${result.text.length} truncated=${result.truncated ?? false}`);

  if (result.error) throw new Error(`step1 API error: ${result.error.slice(0, 500)}`);

  const parsed = safeParseObj(result.text);
  if (!parsed) throw new Error(`step1 parse failed. responseLen=${result.text.length} tail=${result.text.slice(-300)}`);

  const characterSeeds: CharacterSeed[] = Array.isArray(parsed.characterSeeds)
    ? (parsed.characterSeeds as Array<Partial<CharacterSeed>>).map((s) => ({
        id: String(s.id ?? "char-1"),
        label: String(s.label ?? "주인공"),
        // Hard-cap appearance to prevent bloat in downstream prompts
        appearance: String(s.appearance ?? "A young person, casual modern clothing, natural look").slice(0, 400),
        appearanceKo: String(s.appearanceKo ?? "캐주얼 의상의 젊은 인물").slice(0, 50),
      }))
    : [{ id: "char-1", label: "주인공", appearance: "A young person, casual modern clothing, natural look", appearanceKo: "캐주얼 의상의 젊은 인물" }];

  const outlines: CutOutline[] = Array.isArray(parsed.outlines)
    ? (parsed.outlines as Array<Partial<CutOutline>>).map((o, i) => ({
        cutNumber: Number(o.cutNumber ?? i + 1),
        sceneKo: String(o.sceneKo ?? `장면 ${i + 1}`).slice(0, 40),
        emotion: String(o.emotion ?? "neutral"),
        purpose: String(o.purpose ?? "develop"),
        transitionHint: String(o.transitionHint ?? "디졸브").slice(0, 20),
      }))
    : [];

  return { characterSeeds, outlines };
}

// ─── STEP 2/3: 배치 단위 시각 프롬프트 생성 ─────────────────────────────────

async function step23DetailBatch(
  env: GeminiEnv,
  batchOutlines: CutOutline[],
  charAppearance: string,        // step1에서 확정된 외형 (재생성 금지)
  veoStyle: string,
  regionFlavor: string,
  directorName: string,
  directorStyle: string,
  secPerCut: number,
  beatTemplate: string,
  extendBeatTemplate: string,
  aspectRatio: string,
  editingNote: string,
  stepLabel: string,
): Promise<CutDetail[]> {
  if (batchOutlines.length === 0) return [];

  // 프롬프트 내 외형 참조를 200자로 하드캡
  const charRef = charAppearance.slice(0, 200);
  const firstCutNum = batchOutlines[0].cutNumber;
  const isFirstBatch = firstCutNum === 1;

  const sceneLines = batchOutlines
    .map(o => `CUT${o.cutNumber}[${o.purpose}]: ${o.sceneKo} | mood:${o.emotion} | next:${o.transitionHint}`)
    .join("\n");

  const noTextSuffix = `${veoStyle}, directed by ${directorName}, ${aspectRatio} aspect ratio, no text, no watermark, no captions`;

  const prompt = `영상 시각 프롬프트 생성기. JSON 배열로만 반환.

캐릭터(verbatim — 절대 수정/확장 금지): "${charRef}"
스타일: ${veoStyle} | 지역: ${regionFlavor} | 감독: ${directorName}${directorStyle ? ` (${directorStyle.slice(0, 80)})` : ""}${editingNote ? ` | ${editingNote}` : ""}
${secPerCut}초/컷 | 화면비: ${aspectRatio}

장면 목록:
${sceneLines}

## STRICT 글자 제한 (초과시 잘라냄)
- imagePrompt      ≤80 words English. [누가/어디서/무엇을 at START]. 캐릭터 외형. 조명. "${noTextSuffix}"
- endImagePrompt   ≤65 words English. [Scene END state]. 캐릭터 외형. "${noTextSuffix}"
- videoPrompt      ≤130 words English. [shot type], [camera]. 캐릭터 외형. ${beatTemplate}. 조명. "${noTextSuffix}"
- extendPrompt     ${isFirstBatch ? `CUT1="" (빈 문자열 필수)` : `≤110 words English. [이전장면 끝 묘사→전환→새장면]. 캐릭터 외형. ${extendBeatTemplate}. "${noTextSuffix}"`}
- cameraDirection  ≤55 chars English. "Lens Xmm. [move]→[move]. ${directorName} style."
- moodLighting     ≤55 chars English. "[lighting type]. [color grade]."

캐릭터 외형 규칙:
- charRef를 verbatim으로 복사. 절대 확장/요약 금지.
- "same character" 표현 금지. 매 필드에 외형 포함.

JSON 배열 출력:
[{"cutNumber":${firstCutNum},"imagePrompt":"...","endImagePrompt":"...","videoPrompt":"...","extendPrompt":"${isFirstBatch ? "" : "..."}","cameraDirection":"...","moodLighting":"..."}]`;

  const maxTokens = 8192;
  console.info(`[cuts:${stepLabel}] model=${MODEL_DETAIL} promptLen=${prompt.length} cuts=[${batchOutlines.map(o => o.cutNumber).join(",")}] maxTokens=${maxTokens}`);

  const result = await streamingGenerate(env, MODEL_DETAIL, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
  });

  console.info(`[cuts:${stepLabel}] responseLen=${result.text.length} truncated=${result.truncated ?? false}`);

  if (result.error) {
    console.error(`[cuts:${stepLabel}] error: ${result.error.slice(0, 500)}`);
    if (result.truncated && result.text) {
      // TRUNCATED이지만 partial 텍스트가 있으면 파싱 시도
      console.warn(`[cuts:${stepLabel}] TRUNCATED! maxTokens=${maxTokens} partialLen=${result.text.length} rawTail1000: ${result.text.slice(-1000)}`);
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

    const secPerCut    = Number(cutDuration) || 8;
    const targetCuts   = Math.min(Number(cutCount) || 8, 15); // 최대 15컷

    if (!storyText || !directorName) {
      return Response.json({ error: "storyText and directorName required" }, { status: 400 });
    }

    // ── 스타일 맵 (condensed) ─────────────────────────────────────────────────
    const veoStyleMap: Record<string, string> = {
      "2D 애니":       "2D anime cel-shaded, vibrant colors",
      "실사":          "photorealistic cinematic 4K",
      "하이브리드":    "hybrid 2D-3D semi-realistic",
      "수채화 애니":   "watercolor animation pastel tones",
      "로토스코핑":    "rotoscope painted outlines",
      "스톱모션":      "stop-motion claymation",
      "픽셀아트":      "pixel art 16-bit retro",
      "잉크워시":      "ink wash sumi-e",
      "클레이":        "clay animation plasticine",
      "빈티지 필름":   "vintage 1970s film grain",
      "네온 사이버펑크":"neon cyberpunk Blade Runner",
      "미니어처":      "tilt-shift miniature diorama",
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

    // ── 편집 스타일 노트 (compact) ────────────────────────────────────────────
    const techniques = directorTechniques && typeof directorTechniques === "object"
      ? directorTechniques as Record<string, string>
      : null;
    const editingNote = techniques?.editingStyle
      ? `editing: ${String(techniques.editingStyle).slice(0, 60)}`
      : "";

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

    // 아웃라인 정규화 — targetCuts 개수 보장
    while (outlines.length < targetCuts) {
      const n = outlines.length + 1;
      outlines.push({
        cutNumber: n,
        sceneKo: `장면 ${n}`,
        emotion: "neutral",
        purpose: n === targetCuts ? "resolve" : "develop",
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
    const mid     = Math.ceil(targetCuts / 2);
    const batch1  = outlines.slice(0, mid);
    const batch2  = outlines.slice(mid);

    let details1: CutDetail[] = [];
    let details2: CutDetail[] = [];

    const detailArgs = [
      mainChar.appearance,
      veoStyle,
      regionFlavor,
      String(directorName),
      String(directorStyle ?? ""),
      secPerCut,
      beatTemplate,
      extendBeatTemplate,
      String(aspectRatio ?? "16:9"),
      editingNote,
    ] as const;

    try {
      [details1, details2] = await Promise.all([
        step23DetailBatch(context.env, batch1, ...detailArgs, "step2"),
        batch2.length > 0
          ? step23DetailBatch(context.env, batch2, ...detailArgs, "step3")
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
      return {
        cutNumber:  outline.cutNumber,
        durationSec: secPerCut,
        sceneDescription: outline.sceneKo,
        cameraDirection:  d?.cameraDirection  ?? `Lens 35mm. Slow dolly in. ${String(directorName)} style.`,
        moodLighting:     d?.moodLighting     ?? "Golden hour warm light. Teal and orange grade.",
        imagePrompt:      d?.imagePrompt      ?? `${mainChar.appearance}. Scene ${outline.cutNumber} start. ${noTextSuffix}`,
        endImagePrompt:   d?.endImagePrompt   ?? `${mainChar.appearance}. Scene ${outline.cutNumber} end. ${noTextSuffix}`,
        videoPrompt:      d?.videoPrompt      ?? `Medium shot. ${mainChar.appearance}. ${beatTemplate}. ${noTextSuffix}`,
        extendPrompt:     i === 0 ? "" : (d?.extendPrompt ?? ""),
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
