import { PromptInput, PromptOutput, Cut } from "@/types";
import { directors } from "@/data/directors";

/**
 * Mock 프롬프트 생성기
 * TODO: 실제 AI API (OpenAI, Claude 등) 연결 시 이 함수를 교체하세요.
 * 연결 포인트: generatePrompt 함수의 내부 로직만 교체하면 됩니다.
 *
 * 예시:
 * ```
 * export async function generatePrompt(input: PromptInput): Promise<PromptOutput> {
 *   const response = await fetch("/api/generate", {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json" },
 *     body: JSON.stringify(input),
 *   });
 *   return response.json();
 * }
 * ```
 */
export async function generatePrompt(
  input: PromptInput
): Promise<PromptOutput> {
  // 로딩 시뮬레이션
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const director = directors.find((d) => d.id === input.directorPersona);
  const directorName = director?.nameKo ?? "알 수 없는 감독";
  const directorStyle = director?.style ?? "";

  const cutCount = input.duration === 60 ? 6 : input.duration === 90 ? 8 : 10;
  const cutDuration = Math.floor(input.duration / cutCount);

  const storyWords = input.storyText.slice(0, 30);

  const moodOptions = [
    "따뜻한 골든아워 조명",
    "차가운 블루톤 야간 조명",
    "네온 사인이 비추는 도시 조명",
    "부드러운 자연광",
    "드라마틱한 하이 콘트라스트",
    "몽환적인 안개 조명",
    "실루엣 역광",
    "형광등 아래 현실적 조명",
  ];

  const cameraOptions = [
    "슬로우 줌인 – 인물의 감정에 집중",
    "와이드 숏 – 공간의 스케일 강조",
    "클로즈업 – 디테일 포착",
    "트래킹 숏 – 인물을 따라가며 이동",
    "버드아이뷰 – 상황 전체를 조감",
    "로우앵글 – 위압감/경외감 연출",
    "핸드헬드 – 현장감과 긴장감",
    "틸트업 – 점진적 공개",
    "달리 줌 – 심리적 불안감",
    "고정 숏 – 정적인 관찰",
  ];

  const transitionOptions = [
    "디졸브 – 시간 경과 암시",
    "컷 – 빠른 장면 전환",
    "페이드 투 블랙 – 챕터 전환",
    "매치컷 – 시각적 연결",
    "와이프 – 공간 이동",
    "줌 트랜지션 – 에너지 전환",
    "모핑 – 형태 변화",
    "글리치 – 시간/현실 왜곡",
  ];

  const animationTag =
    input.animationMode === "2D 애니"
      ? "2D anime style, cel-shaded, "
      : input.animationMode === "하이브리드"
        ? "hybrid 2D-3D style, "
        : "photorealistic, ";

  const regionStyle: Record<string, string> = {
    한국: "Korean urban/rural aesthetic, hangeul signage, ",
    일본: "Japanese aesthetic, cherry blossoms, traditional-modern mix, ",
    중국: "Chinese cinematic grandeur, silk textures, ",
    유럽: "European architecture, classical atmosphere, ",
    미국: "American cinematic, diverse urban landscape, ",
  };

  const cuts: Cut[] = Array.from({ length: cutCount }, (_, i) => {
    const mood = moodOptions[i % moodOptions.length];
    const camera = cameraOptions[i % cameraOptions.length];
    const transition = transitionOptions[i % transitionOptions.length];

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
    ];

    const basePrompt = `${animationTag}${regionStyle[input.region] ?? ""}${directorStyle}, cinematic composition`;

    return {
      cutNumber: i + 1,
      durationSec: i === cutCount - 1 ? input.duration - cutDuration * (cutCount - 1) : cutDuration,
      sceneDescription: sceneTemplates[i % sceneTemplates.length],
      cameraDirection: camera,
      moodLighting: mood,
      imagePrompt: `${basePrompt}, ${mood.toLowerCase()}, scene ${i + 1}: ${sceneTemplates[i % sceneTemplates.length].slice(0, 60)}, highly detailed, masterpiece quality, ${input.aspectRatio} aspect ratio`,
      videoPrompt: `${basePrompt}, smooth motion, ${camera.toLowerCase()}, ${mood.toLowerCase()}, scene ${i + 1}, cinematic movement, ${input.duration}s total video, cut ${i + 1} of ${cutCount}`,
      transitionHint: transition,
    };
  });

  return {
    projectTitle: `${directorName}의 시선으로: ${storyWords}...`,
    conceptSummary: `${directorName} 감독의 연출 스타일(${directorStyle})을 적용하여, "${storyWords}..." 시나리오를 ${input.duration}초 분량의 ${input.animationMode} 영상으로 구성한 컷 리스트입니다. ${input.region} 지역의 미학적 요소를 반영하였습니다.`,
    totalCuts: cutCount,
    globalStylePrompt: `${animationTag}${regionStyle[input.region] ?? ""}inspired by ${director?.name ?? "auteur"} filmmaking, ${directorStyle}, consistent character design, unified color palette, ${input.aspectRatio} aspect ratio, cinematic quality`,
    continuityRules: [
      "캐릭터 외형(의상, 헤어스타일, 체형)을 모든 컷에서 일관되게 유지",
      "조명 방향과 시간대를 연속된 컷 간에 일치시킬 것",
      `색감 팔레트는 ${directorName} 스타일의 시그니처 톤을 유지`,
      "카메라 높이와 렌즈 화각을 장면 전환 시 자연스럽게 연결",
      "배경 요소(날씨, 소품, 간판 등)의 연속성 확보",
    ],
    cuts,
  };
}
