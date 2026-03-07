import { PromptInput, PromptOutput, Cut, DirectorPersona } from "@/types";
import { directors } from "@/data/directors";

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
  cutCount: number
): Promise<Cut[]> {
  try {
    const res = await fetch("/api/generate-cuts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyText: input.storyText,
        directorName: director.name,
        directorNameKo: director.nameKo,
        directorStyle: director.style,
        animationMode: input.animationMode,
        aspectRatio: input.aspectRatio,
        region: input.region,
        cutCount,
      }),
    });

    if (!res.ok) throw new Error(`API error: ${res.status}`);

    const data = await res.json();
    if (Array.isArray(data.cuts) && data.cuts.length > 0) {
      return data.cuts.map((cut: Partial<Cut>, i: number) => ({
        cutNumber: cut.cutNumber ?? i + 1,
        durationSec: cut.durationSec ?? 8,
        sceneDescription: cut.sceneDescription ?? "",
        cameraDirection: cut.cameraDirection ?? "",
        moodLighting: cut.moodLighting ?? "",
        imagePrompt: cut.imagePrompt ?? "",
        videoPrompt: cut.videoPrompt ?? "",
        extendPrompt: cut.extendPrompt ?? "",
        transitionHint: cut.transitionHint ?? "",
        characterConsistency: cut.characterConsistency ?? "",
      }));
    }
    throw new Error("Empty cuts");
  } catch (error) {
    console.error("Cuts API error, using fallback:", error);
    return generateFallbackCuts(input, director, cutCount);
  }
}

function generateFallbackCuts(
  input: PromptInput,
  director: DirectorPersona,
  cutCount: number
): Cut[] {
  const storyWords = input.storyText.slice(0, 30);
  const directorStyle = director.style;

  const veoStyle =
    input.animationMode === "2D 애니"
      ? "2D anime style, cel-shaded animation, vibrant colors"
      : input.animationMode === "하이브리드"
        ? "hybrid 2D-3D rendering, stylized semi-realistic"
        : "photorealistic, cinematic film grain, 4K quality";

  const regionFlavor: Record<string, string> = {
    한국: "Korean aesthetic, hangeul signage, Korean urban-rural atmosphere",
    일본: "Japanese aesthetic, cherry blossoms, traditional-modern contrast",
    중국: "Chinese cinematic grandeur, silk textures, classical architecture",
    유럽: "European architecture, classical oil-painting atmosphere",
    미국: "American cinematic, diverse urban landscape, wide open spaces",
  };
  const region = regionFlavor[input.region] ?? "";

  return Array.from({ length: cutCount }, (_, i) => ({
    cutNumber: i + 1,
    durationSec: 8,
    sceneDescription: `[컷 ${i + 1}] ${storyWords} 기반 장면 (API 연결 후 AI가 생성합니다)`,
    cameraDirection: "slow push-in toward subject",
    moodLighting: "golden hour warm lighting, soft shadows",
    imagePrompt: `${veoStyle}, ${region}, ${directorStyle}, scene ${i + 1}, highly detailed`,
    videoPrompt: `Cinematic 8-second clip. ${veoStyle}, ${region}. Style: ${director.name}. Smooth motion.`,
    extendPrompt: i > 0
      ? `Continue from cut ${i}. Maintain consistency. ${directorStyle} tone.`
      : `Opening shot. ${veoStyle}, ${region}. Establishing scene.`,
    transitionHint: "디졸브 – 장면 전환",
    characterConsistency: `캐릭터 시드 고정: 동일 인물 외형 유지. ${directorStyle} 톤 일관성 유지.`,
  }));
}

/**
 * Veo 최적화 프롬프트 생성기
 * Gemini API를 통해 시나리오 기반 컷을 AI가 생성합니다.
 */
export async function generatePrompt(
  input: PromptInput
): Promise<PromptOutput> {
  const director = input.customDirector ?? directors.find((d) => d.id === input.directorPersona);
  const directorName = director?.nameKo ?? "알 수 없는 감독";
  const directorStyle = director?.style ?? "";

  const effectiveDuration =
    input.duration === "auto"
      ? Math.min(180, Math.max(60, Math.round(input.storyText.length / 2)))
      : input.duration;

  const cutCount = Math.max(4, Math.round(effectiveDuration / 8));
  const storyWords = input.storyText.slice(0, 30);

  // Gemini API 호출을 병렬로 실행
  const [directorPersonaText, cuts] = await Promise.all([
    director && (!director.persona || input.customDirector)
      ? fetchGeminiPersona(director, input.storyText, input.animationMode)
      : Promise.resolve(director?.persona ?? ""),
    director
      ? fetchGeminiCuts(input, director, cutCount)
      : Promise.resolve(generateFallbackCuts(input, director ?? { id: "", name: "Unknown", nameKo: "알 수 없음", region: "한국", style: "", description: "", persona: "" }, cutCount)),
  ]);

  const veoStyle =
    input.animationMode === "2D 애니"
      ? "2D anime style, cel-shaded animation, vibrant colors"
      : input.animationMode === "하이브리드"
        ? "hybrid 2D-3D rendering, stylized semi-realistic"
        : "photorealistic, cinematic film grain, 4K quality";

  const regionFlavor: Record<string, string> = {
    한국: "Korean aesthetic, hangeul signage, Korean urban-rural atmosphere",
    일본: "Japanese aesthetic, cherry blossoms, traditional-modern contrast",
    중국: "Chinese cinematic grandeur, silk textures, classical architecture",
    유럽: "European architecture, classical oil-painting atmosphere",
    미국: "American cinematic, diverse urban landscape, wide open spaces",
  };
  const region = regionFlavor[input.region] ?? "";

  return {
    projectTitle: `${directorName}의 시선으로: ${storyWords}...`,
    conceptSummary: `${directorName} 감독의 연출 스타일(${directorStyle})을 적용하여, "${storyWords}..." 시나리오를 Google Veo 8초 × ${cuts.length}컷 = ${cuts.length * 8}초 분량의 ${input.animationMode} 영상으로 구성했습니다. Gemini AI가 시나리오를 분석하여 각 컷을 생성했습니다.`,
    totalCuts: cuts.length,
    globalStylePrompt: `[Veo Global Style] ${veoStyle}, ${region}, inspired by ${director?.name ?? "auteur"} filmmaking, ${directorStyle}, consistent character design across all cuts, unified color palette, ${input.aspectRatio} aspect ratio, cinematic quality, no text overlay, no watermark`,
    directorPersonaPrompt: directorPersonaText,
    continuityRules: [
      "Veo 생성 시 이전 컷의 마지막 프레임을 참조 이미지로 활용",
      "캐릭터 외형(의상, 헤어스타일, 체형)을 모든 컷에서 일관되게 유지",
      "조명 방향과 시간대를 연속된 컷 간에 일치시킬 것",
      `색감 팔레트는 ${directorName} 스타일의 시그니처 톤을 유지`,
      "각 8초 클립의 시작/끝 프레임이 자연스럽게 이어지도록 구성",
      "Extend 프롬프트 사용 시 캐릭터/배경 묘사를 동일하게 유지",
    ],
    cuts,
  };
}
