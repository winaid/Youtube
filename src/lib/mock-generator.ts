import { PromptInput, PromptOutput, Cut, DirectorPersona, CharacterSeed } from "@/types";
import { directors } from "@/data/directors";
import { getStyleById } from "@/data/style-catalog";

async function fetchGeminiPersona(
  director: DirectorPersona,
  storyText: string,
  animationMode: string
): Promise<string> {
  try {
    const res = await fetch("/api/generate-persona", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directorName: director.name,
        directorNameKo: director.nameKo,
        style: director.style,
        description: director.description,
        storyText,
        animationMode,
        signatureTechniques: director.signatureTechniques || null,
        notableWorks: director.notableWorks || [],
      }),
    });
    const data = await res.json();
    return data.persona || director.persona || "";
  } catch {
    return director.persona || "";
  }
}

async function fetchGeminiCuts(
  input: PromptInput,
  director: DirectorPersona,
  directorPersonaText: string,
  cutCount: number,
  cutDuration: number
): Promise<{ characterSeeds: CharacterSeed[]; cuts: Cut[]; usedFallback?: boolean; fallbackReason?: string; fallbackCause?: string; sequencePlan?: unknown; sequenceValidation?: unknown }> {
  try {
    const res = await fetch("/api/generate-cuts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyText: input.storyText,
        directorName: director.name,
        directorNameKo: director.nameKo,
        directorStyle: director.style,
        directorPersona: directorPersonaText,
        directorTechniques: director.signatureTechniques || null,
        animationMode: input.animationMode,
        aspectRatio: input.aspectRatio,
        region: input.region,
        cutCount,
        cutDuration,
        // 페르소나 시스템
        generationPersona: input.generationPersona ?? null,
        characterPersonas: input.characterPersonas ?? [],
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({} as Record<string, string>));
      const eb = errBody as Record<string, string>;
      const cause = eb.cause || "";
      const code = eb.code || "";
      const detail = eb.detail || eb.error || "unknown";
      const help = eb.help || "";
      if (code === "MISSING_API_KEY") {
        throw new Error(`MISSING_API_KEY: ${help || "GEMINI_API_KEY 환경변수를 설정하세요."}`);
      }
      if (code === "MODEL_NOT_FOUND") {
        throw new Error(`MODEL_NOT_FOUND: ${help || "모델이 deprecated됨. _gemini-keys.ts 확인."}`);
      }
      if (code === "INVALID_API_KEY") {
        throw new Error(`INVALID_API_KEY: ${help || "API 키가 유효하지 않습니다."}`);
      }
      throw new Error(
        cause === "MAX_TOKENS"
          ? `토큰 한도 초과 (step ${eb.step || "?"}): ${detail}`
          : `API error: ${res.status} [${code || "UNKNOWN"}] — ${detail}`,
      );
    }

    const data = await res.json();
    const characterSeeds: CharacterSeed[] = Array.isArray(data.characterSeeds)
      ? data.characterSeeds.map((s: Partial<CharacterSeed>) => ({
          id: s.id ?? "char-unknown",
          label: s.label ?? "",
          appearance: s.appearance ?? "",
          appearanceKo: s.appearanceKo ?? "",
        }))
      : [];

    const cuts: Cut[] = Array.isArray(data.cuts) && data.cuts.length > 0
      ? data.cuts.map((cut: Partial<Cut>, i: number) => ({
          cutNumber: cut.cutNumber ?? i + 1,
          durationSec: cut.durationSec ?? cutDuration,
          sceneDescription: cut.sceneDescription ?? "",
          cameraDirection: cut.cameraDirection ?? "",
          moodLighting: cut.moodLighting ?? "",
          imagePrompt: cut.imagePrompt ?? "",
          endImagePrompt: cut.endImagePrompt ?? "",
          videoPrompt: cut.videoPrompt ?? "",
          extendPrompt: cut.extendPrompt ?? "",
          transitionHint: cut.transitionHint ?? "",
          characterConsistency: cut.characterConsistency ?? "",
          charactersInScene: Array.isArray(cut.charactersInScene) ? cut.charactersInScene : [],
          // JSON 기반 프롬프트 — API에서 온 구조화 데이터 보존
          shotCategory: cut.shotCategory,
          characterRole: cut.characterRole,
          videoPromptJson: cut.videoPromptJson,
          extendPromptJson: cut.extendPromptJson,
        }))
      : [];

    if (cuts.length === 0) throw new Error("Empty cuts from API");

    return {
      characterSeeds,
      cuts,
      sequencePlan: data.sequencePlan ?? undefined,
      sequenceValidation: data.sequenceValidation ?? undefined,
    };
  } catch (error) {
    const errStr = String(error);
    console.error("Cuts API error, using fallback:", errStr);

    // 에러 원인 분류 — 정확한 사용자 안내를 위해
    let fallbackCause: string;
    if (errStr.includes("토큰 한도") || errStr.includes("MAX_TOKENS") || errStr.includes("truncat")) {
      fallbackCause = "MAX_TOKENS";
    } else if (errStr.includes("MISSING_API_KEY")) {
      fallbackCause = "MISSING_API_KEY";
    } else if (errStr.includes("INVALID_API_KEY")) {
      fallbackCause = "INVALID_API_KEY";
    } else if (errStr.includes("MODEL_NOT_FOUND") || errStr.includes("deprecated")) {
      fallbackCause = "MODEL_NOT_FOUND";
    } else if (errStr.includes("429") || errStr.includes("quota") || errStr.includes("QUOTA")) {
      fallbackCause = "QUOTA_EXCEEDED";
    } else if (errStr.includes("fetch") || errStr.includes("network") || errStr.includes("ECONNREFUSED")) {
      fallbackCause = "NETWORK_ERROR";
    } else {
      fallbackCause = "UNKNOWN";
    }

    const fallback = generateFallbackCuts(input, director, cutCount, cutDuration);
    return { ...fallback, usedFallback: true, fallbackReason: errStr, fallbackCause };
  }
}

function generateFallbackCuts(
  input: PromptInput,
  director: DirectorPersona,
  cutCount: number,
  cutDuration = 8
): { characterSeeds: CharacterSeed[]; cuts: Cut[] } {
  const storyWords = input.storyText.slice(0, 30);
  const directorStyle = director.style;

  const catalogStyle = getStyleById(input.animationMode);
  const veoStyle = catalogStyle
    ? catalogStyle.positivePrompt.split(". ").slice(0, 2).join(". ")
    : "photorealistic, cinematic film grain, 4K quality";

  const characterSeeds: CharacterSeed[] = [{
    id: "char-1",
    label: "주인공",
    appearance: "A young person, black hair, average build, wearing casual modern clothing",
    appearanceKo: "검은 머리, 보통 체형, 캐주얼 현대 의상 (API 연결 후 AI가 구체적으로 생성합니다)",
  }];

  const charDesc = characterSeeds[0].appearance;

  const cuts = Array.from({ length: cutCount }, (_, i) => ({
    cutNumber: i + 1,
    durationSec: cutDuration,
    sceneDescription: `[장면 ${i + 1}] ${storyWords} 기반 장면 (API 연결 후 AI가 생성합니다)`,
    cameraDirection: "slow push-in toward subject",
    moodLighting: "golden hour warm lighting, soft shadows",
    imagePrompt: `${veoStyle}, ${directorStyle}, ${charDesc}, scene ${i + 1} start frame, highly detailed, cinematic quality`,
    endImagePrompt: `${veoStyle}, ${directorStyle}, ${charDesc}, scene ${i + 1} end frame, camera moved to final position, highly detailed, cinematic quality`,
    videoPrompt: (() => {
      // establishing→evidence→anchor 구조 (즉시 인식 가능성)
      const beat = cutDuration === 4
        ? { b1: "0s-1s", b2: "1s-3s", b3: "3s-4s" }
        : cutDuration === 6
          ? { b1: "0s-2s", b2: "2s-4s", b3: "4s-6s" }
          : cutDuration === 10
            ? { b1: "0s-3s", b2: "3s-7s", b3: "7s-10s" }
            : cutDuration === 15
              ? { b1: "0s-4s", b2: "4s-10s", b3: "10s-15s" }
              : { b1: "0s-2s", b2: "2s-5s", b3: "5s-8s" };
      return `Wide shot, eye-level, slow dolly in. ${beat.b1}: LOCATION — establishing space, identifiable location objects, ${veoStyle}. ${beat.b2}: SITUATION — visual evidence of current state, ${directorStyle} tone. ${beat.b3}: EMOTION — ${charDesc}, concrete physical action revealing feeling. Warm key light from upper left, soft diffused. ${director.name} style, cinematic. No text, no watermark`;
    })(),
    extendPrompt: i > 0
      ? (() => {
        const beat = cutDuration === 4
          ? { b1: "0s-1s", b2: "1s-3s", b3: "3s-4s" }
          : cutDuration === 6
            ? { b1: "0s-2s", b2: "2s-4s", b3: "4s-6s" }
            : cutDuration === 10
              ? { b1: "0s-3s", b2: "3s-7s", b3: "7s-10s" }
              : cutDuration === 15
                ? { b1: "0s-4s", b2: "4s-10s", b3: "10s-15s" }
                : { b1: "0s-2s", b2: "2s-5s", b3: "5s-8s" };
        return `Continue from previous scene. ${beat.b1}: LOCATION — new angle on location-defining objects, ${veoStyle}. ${beat.b2}: SITUATION — situation evidence with ${directorStyle} tone. ${beat.b3}: EMOTION — ${charDesc}, emotional anchor through physical action. Same character maintained. No text, no watermark`;
      })()
      : "",
    transitionHint: i < cutCount - 1 ? "디졸브 - 다음 장면으로 자연스럽게 전환" : "페이드 아웃 - 마무리",
    characterConsistency: `캐릭터 시드 char-1 고정: ${characterSeeds[0].appearanceKo}. 모든 장면에서 동일한 외형 유지. ${directorStyle} 톤 일관성 유지.`,
    charactersInScene: ["char-1"],
  }));

  return { characterSeeds, cuts };
}

export async function generatePrompt(
  input: PromptInput
): Promise<PromptOutput> {
  const director = input.customDirector ?? directors.find((d) => d.id === input.directorPersona);
  const directorName = director?.nameKo ?? "알 수 없는 감독";
  const directorStyle = director?.style ?? "";

  const effectiveDuration =
    input.duration === "auto"
      ? Math.min(120, Math.max(60, Math.round(input.storyText.length / 2)))
      : input.duration;

  const cutDuration = input.cutDuration && input.cutDuration > 0 ? input.cutDuration : 8;
  const cutCount = input.cutCount ?? Math.max(4, Math.round(effectiveDuration / cutDuration));
  const storyWords = input.storyText.slice(0, 30);

  // 1. 감독 페르소나 먼저 생성 (장면 생성에 필요)
  const directorPersonaText = director && (!director.persona || input.customDirector)
    ? await fetchGeminiPersona(director, input.storyText, input.animationMode)
    : director?.persona ?? "";

  // 2. 페르소나를 포함하여 장면 생성 (캐릭터 시드 + 감독 스타일 주입)
  const cutsResult = director
    ? await fetchGeminiCuts(input, director, directorPersonaText, cutCount, cutDuration)
    : { ...generateFallbackCuts(input, director ?? { id: "", name: "Unknown", nameKo: "알 수 없음", region: "한국", style: "", description: "", persona: "" }, cutCount, cutDuration), usedFallback: true, fallbackReason: "감독 정보 없음" };
  const { characterSeeds, cuts, usedFallback, fallbackReason, fallbackCause, sequencePlan, sequenceValidation } = cutsResult;

  const catalogStyle = getStyleById(input.animationMode);
  const veoStyle = catalogStyle
    ? catalogStyle.positivePrompt.split(". ").slice(0, 2).join(". ")
    : "photorealistic, cinematic film grain, 4K quality";

  const regionFlavor: Record<string, string> = {
    한국: "Korean aesthetic, Korean urban-rural atmosphere",
    일본: "Japanese aesthetic, traditional-modern contrast",
    중국: "Chinese cinematic grandeur, classical architecture",
    유럽: "European architecture, classical atmosphere",
    미국: "American cinematic, diverse urban landscape",
  };
  const region = regionFlavor[input.region] ?? "";

  // 캐릭터 시드 요약을 글로벌 스타일에 포함
  const charSeedSummary = characterSeeds.length > 0
    ? characterSeeds.map(s => `[${s.id}: ${s.appearance}]`).join(" ")
    : "";

  return {
    projectTitle: `${directorName}의 시선으로: ${storyWords}...`,
    conceptSummary: `${directorName} 감독의 연출 스타일(${directorStyle})을 적용하여, "${storyWords}..." 시나리오를 ${cutDuration}초 x ${cuts.length}장면 = ${cuts.length * cutDuration}초 분량의 ${input.animationMode} 영상으로 구성했습니다. ${characterSeeds.length}명의 캐릭터가 시드 고정되어 전체 장면에서 동일한 외형을 유지합니다.`,
    totalCuts: cuts.length,
    globalStylePrompt: `[Veo Global Style] ${veoStyle}, ${region}, directed by ${director?.name ?? "auteur"}, ${charSeedSummary}, consistent character design across all cuts, unified color palette, ${input.aspectRatio} aspect ratio, cinematic quality, no text overlay, no watermark`,
    directorPersonaPrompt: directorPersonaText,
    characterSeeds,
    continuityRules: [
      `캐릭터 시드 ${characterSeeds.length}명 고정: 모든 장면의 프롬프트에 캐릭터 전체 외형 묘사가 반복 삽입됨`,
      "Extend 프롬프트 사용 시 이전 장면 마지막 순간을 구체적으로 묘사하여 자연스러운 연결",
      "캐릭터 외형(의상, 헤어스타일, 체형, 피부톤)을 모든 장면에서 절대 변경 금지",
      `색감/조명은 ${directorName} 스타일의 시그니처 톤으로 통일`,
      `각 ${cutDuration}초 클립의 시작 프레임이 이전 클립의 끝 프레임과 매칭되도록 구성`,
      "CUT 1은 Video Prompt로 생성, CUT 2부터는 이전 클립 + Extend Prompt로 연장",
    ],
    cuts,
    usedFallback,
    fallbackReason,
    fallbackCause: fallbackCause as PromptOutput["fallbackCause"],
    sequencePlan: sequencePlan as PromptOutput["sequencePlan"],
    sequenceValidation: sequenceValidation as PromptOutput["sequenceValidation"],
  };
}
