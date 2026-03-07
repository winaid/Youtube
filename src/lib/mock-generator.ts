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

/**
 * Veo 최적화 프롬프트 생성기
 * Google Veo 8초 클립 기반으로 프롬프트를 생성합니다.
 * 커스텀 감독(웹 검색)의 경우 Gemini 3.1 Pro Preview가 페르소나를 생성합니다.
 */
export async function generatePrompt(
  input: PromptInput
): Promise<PromptOutput> {
  const director = input.customDirector ?? directors.find((d) => d.id === input.directorPersona);
  const directorName = director?.nameKo ?? "알 수 없는 감독";
  const directorStyle = director?.style ?? "";

  // Gemini로 페르소나 프롬프트 생성 (커스텀 감독이거나 페르소나가 비어있을 때)
  let directorPersonaText: string;
  if (director && (!director.persona || input.customDirector)) {
    directorPersonaText = await fetchGeminiPersona(director, input.storyText, input.animationMode);
  } else {
    directorPersonaText = director?.persona ?? "";
  }

  // "auto" 모드: 시나리오 길이에 따라 자동 결정
  const effectiveDuration =
    input.duration === "auto"
      ? Math.min(180, Math.max(60, Math.round(input.storyText.length / 2)))
      : input.duration;

  // Veo는 8초 클립 → 컷 수 = 총 시간 / 8
  const cutCount = Math.max(4, Math.round(effectiveDuration / 8));
  const storyWords = input.storyText.slice(0, 30);

  const moodOptions = [
    "golden hour warm lighting, soft shadows",
    "cool blue night lighting, moonlit",
    "neon-lit urban atmosphere, reflective wet streets",
    "soft natural daylight, diffused",
    "dramatic high-contrast chiaroscuro lighting",
    "dreamy fog with volumetric light rays",
    "silhouette backlit, rim lighting",
    "overcast ambient lighting, muted tones",
  ];

  const cameraOptions = [
    "slow push-in toward subject",
    "wide establishing shot, static",
    "extreme close-up, shallow depth of field",
    "smooth tracking shot following subject",
    "aerial top-down view, slowly rotating",
    "low-angle shot looking up",
    "handheld shaky cam, documentary style",
    "slow tilt up revealing scene",
    "dolly zoom creating vertigo effect",
    "locked-off static frame, tableau composition",
  ];

  const transitionOptions = [
    "디졸브 – 시간 경과 암시",
    "하드컷 – 빠른 장면 전환",
    "페이드 투 블랙 – 챕터 전환",
    "매치컷 – 시각적 연결",
    "와이프 – 공간 이동",
    "줌 트랜지션 – 에너지 전환",
    "모핑 – 형태 변화",
    "글리치 – 시간/현실 왜곡",
  ];

  // Veo 스타일 프리픽스
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

  const sceneTemplates = [
    `[도입] ${storyWords}의 세계가 펼쳐진다. 공간과 분위기를 확립하는 장면.`,
    `[전개] 주인공이 등장하며 상황이 시작된다. 캐릭터의 첫인상을 확립.`,
    `[발전] 서사의 핵심 갈등이 드러나기 시작한다. 긴장감 상승.`,
    `[전환] 예상치 못한 전개. 이야기의 방향이 바뀌는 결정적 순간.`,
    `[심화] 감정적 깊이가 더해진다. 인물의 내면이 드러나는 장면.`,
    `[절정] 서사의 클라이맥스. 모든 요소가 충돌하는 최고조의 순간.`,
    `[여운] 절정 이후의 정적. 감정의 잔향이 남는 장면.`,
    `[전환2] 새로운 시각에서 상황을 재해석. 의미의 전환.`,
    `[해소] 갈등이 해소되며 새로운 균형이 찾아온다.`,
    `[마무리] 여운을 남기며 마무리. 관객에게 생각할 거리를 던진다.`,
    `[에필로그] 이야기 이후의 세계. 새로운 시작을 암시.`,
    `[클로징] 상징적 이미지로 마무리. 첫 장면과 대비/호응.`,
    `[아웃트로] 감정의 여운이 서서히 사라지는 마지막 장면.`,
    `[엔딩] 관객에게 메시지를 남기는 최종 장면.`,
  ];

  const region = regionFlavor[input.region] ?? "";

  const cuts: Cut[] = Array.from({ length: cutCount }, (_, i) => {
    const mood = moodOptions[i % moodOptions.length];
    const camera = cameraOptions[i % cameraOptions.length];
    const transition = transitionOptions[i % transitionOptions.length];
    const sceneDesc = sceneTemplates[i % sceneTemplates.length];

    // Veo Image Prompt: 참조 이미지 생성용 (Imagen 등으로 먼저 생성)
    const imagePrompt = [
      veoStyle,
      region,
      directorStyle,
      `scene ${i + 1}: ${sceneDesc.replace(/\[.*?\]\s*/, "").slice(0, 80)}`,
      mood,
      "highly detailed, masterpiece quality",
      `${input.aspectRatio} aspect ratio`,
    ].join(", ");

    // Veo Video Prompt: 8초 클립 생성용 (카메라 동작 + 분위기 묘사 중심)
    const videoPrompt = [
      `Cinematic 8-second clip.`,
      `${camera}.`,
      `${veoStyle}, ${region}.`,
      `${sceneDesc.replace(/\[.*?\]\s*/, "").slice(0, 100)}.`,
      `Mood: ${mood}.`,
      `Style reference: ${director?.name ?? "auteur"} filmmaking — ${directorStyle}.`,
      `Smooth natural motion, no text overlay, no watermark.`,
    ].join(" ");

    // Veo Extend Prompt: 이전 클립에서 이어서 생성
    const extendPrompt = i > 0
      ? [
          `Continue seamlessly from previous clip (cut ${i}).`,
          `Maintain identical character appearance, wardrobe, and setting.`,
          `${camera}. ${mood}.`,
          `${sceneDesc.replace(/\[.*?\]\s*/, "").slice(0, 80)}.`,
          `Consistent ${directorStyle} visual tone. Smooth 8-second continuation.`,
        ].join(" ")
      : [
          `Opening shot. ${camera}.`,
          `${veoStyle}, ${region}.`,
          `${sceneDesc.replace(/\[.*?\]\s*/, "").slice(0, 80)}.`,
          `${mood}. Establishing scene for 8-second clip.`,
        ].join(" ");

    return {
      cutNumber: i + 1,
      durationSec: 8,
      sceneDescription: sceneDesc,
      cameraDirection: camera,
      moodLighting: mood,
      imagePrompt,
      videoPrompt,
      extendPrompt,
      transitionHint: transition,
      characterConsistency: `캐릭터 시드 고정: 동일 인물 외형(얼굴, 체형, 의상) 유지. 이전 컷의 마지막 프레임을 Veo 참조 이미지로 사용. ${directorStyle} 톤 일관성 유지.`,
    };
  });

  return {
    projectTitle: `${directorName}의 시선으로: ${storyWords}...`,
    conceptSummary: `${directorName} 감독의 연출 스타일(${directorStyle})을 적용하여, "${storyWords}..." 시나리오를 Google Veo 8초 × ${cutCount}컷 = ${cutCount * 8}초 분량의 ${input.animationMode} 영상으로 구성했습니다. 각 컷은 Veo에서 생성 후 이어붙여 완성합니다.`,
    totalCuts: cutCount,
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
