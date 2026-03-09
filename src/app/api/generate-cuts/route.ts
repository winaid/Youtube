import { NextRequest, NextResponse } from "next/server";
import { callGemini, safeParseJSON } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const {
      storyText, directorName, directorNameKo, directorStyle, directorPersona,
      directorTechniques, animationMode, aspectRatio, region, cutCount,
    } = await req.json();

    const techStr = directorTechniques
      ? Object.entries(directorTechniques).map(([k, v]) => `${k}: ${v}`).join(", ")
      : "";

    const veoStyle = animationMode === "2D 애니"
      ? "2D anime style, cel-shaded animation, vibrant colors"
      : animationMode === "하이브리드"
      ? "hybrid 2D-3D rendering, stylized semi-realistic"
      : animationMode === "수채화 애니"
      ? "watercolor animation style, soft pastel tones"
      : animationMode === "네온 사이버펑크"
      ? "neon cyberpunk style, rain-soaked streets, holographic elements"
      : animationMode === "빈티지 필름"
      ? "vintage film grain, faded 70s color palette, analog aesthetic"
      : "photorealistic, cinematic film grain, 4K quality";

    const prompt = `당신은 ${directorNameKo}(${directorName}) 감독의 연출 스타일로 영상 컷 리스트를 생성하는 전문가입니다.

[감독 페르소나]
${directorPersona || `${directorNameKo}: ${directorStyle}`}
${techStr ? `시그니처 기법: ${techStr}` : ""}

[시나리오]
${storyText}

[설정]
- 영상 스타일: ${animationMode} (${veoStyle})
- 화면 비율: ${aspectRatio}
- 배경 지역: ${region}
- 총 장면 수: ${cutCount}장면
- 각 클립 길이: 8초 (Google Veo Fast 모드)

[출력 규칙]
1. 반드시 아래 JSON 형식만 출력
2. imagePrompt, endImagePrompt, videoPrompt, extendPrompt은 영어로 작성 (AI 생성용)
3. 나머지 필드는 한국어로 작성
4. characterSeeds: 시나리오에 등장하는 캐릭터들의 외형을 영어로 상세 묘사 (id: char-1, char-2 등)
5. extendPrompt: CUT 1은 빈 문자열, CUT 2부터 이전 장면 연결 묘사
6. videoPrompt: 8초 분량, 카메라 움직임과 캐릭터 행동을 시간순으로 묘사 (0s-2s, 2s-5s, 5s-8s)

{
  "characterSeeds": [
    {
      "id": "char-1",
      "label": "캐릭터 이름 (한국어)",
      "appearance": "detailed English description: gender, age, hair color/style, face, clothing, body type",
      "appearanceKo": "외형 한국어 요약"
    }
  ],
  "cuts": [
    {
      "cutNumber": 1,
      "durationSec": 8,
      "sceneDescription": "장면 설명 (한국어)",
      "cameraDirection": "카메라 연출 (한국어)",
      "moodLighting": "분위기와 조명 (한국어)",
      "imagePrompt": "English: start frame image prompt with character seed, ${veoStyle}, cinematic",
      "endImagePrompt": "English: end frame image prompt showing where scene ends",
      "videoPrompt": "English: 8-second video prompt. [Character seed]. 0s-2s: [action]. 2s-5s: [action]. 5s-8s: [action]. Camera: [movement]. Style: ${directorName}, ${veoStyle}. No text, no watermark.",
      "extendPrompt": "",
      "transitionHint": "전환 방식 (한국어)",
      "characterConsistency": "이 장면의 캐릭터 일관성 지침 (한국어)",
      "charactersInScene": ["char-1"]
    }
  ]
}

총 ${cutCount}개의 컷을 생성하세요. CUT 2부터 extendPrompt에 이전 장면과의 자연스러운 연결을 묘사하세요.`;

    const raw = await callGemini(prompt, { temperature: 0.8, maxTokens: 16384, json: true });
    const data = safeParseJSON(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[generate-cuts]", err);
    return NextResponse.json(
      { error: "컷 생성 실패", detail: String(err) },
      { status: 500 }
    );
  }
}
