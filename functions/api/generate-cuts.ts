interface Env {
  GEMINI_API_KEY: string;
}

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const {
      storyText,
      directorName,
      directorNameKo,
      directorStyle,
      animationMode,
      aspectRatio,
      region,
      cutCount,
    } = await context.request.json() as Record<string, string | number>;

    if (!storyText || !directorName) {
      return Response.json({ error: "storyText and directorName required" }, { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const prompt = `당신은 영상 프로듀서이자 Veo 프롬프트 전문가입니다.

감독: ${directorNameKo || directorName} (${directorName})
스타일: ${directorStyle || "시네마틱"}
애니메이션 모드: ${animationMode || "2D 애니"}
화면비: ${aspectRatio || "16:9"}
지역: ${region || "한국"}
컷 수: ${cutCount || 8}

시나리오:
${String(storyText).slice(0, 2000)}

위 시나리오를 ${cutCount || 8}개의 Veo 8초 클립 컷으로 나눠주세요.

각 컷은 다음 JSON 형식으로 작성:
{
  "cutNumber": 1,
  "durationSec": 8,
  "sceneDescription": "[한국어] 이 컷에서 어떤 장면이 펼쳐지는지 설명",
  "cameraDirection": "[영어] 카메라 무빙 (예: slow push-in, tracking shot 등)",
  "moodLighting": "[영어] 조명/분위기 (예: golden hour warm lighting, soft shadows)",
  "imagePrompt": "[영어] Veo 이미지 참조용 프롬프트. 스타일+지역+감독스타일+장면묘사+조명+화질",
  "videoPrompt": "[영어] Veo 8초 비디오 생성 프롬프트. 카메라동작+스타일+장면+분위기+감독레퍼런스",
  "extendPrompt": "[영어] 이전 클립에서 이어지는 Extend 프롬프트",
  "transitionHint": "[한국어] 다음 컷으로의 전환 방식 (예: 디졸브, 하드컷, 매치컷 등)",
  "characterConsistency": "[한국어] 캐릭터 일관성 유지 지침"
}

규칙:
1. 시나리오 내용을 실제로 반영해서 각 컷의 장면을 구체적으로 작성
2. 감독의 시그니처 스타일(${directorStyle})을 영상 프롬프트에 녹여낼 것
3. imagePrompt와 videoPrompt는 영어로 작성 (Veo 최적화)
4. sceneDescription, transitionHint, characterConsistency는 한국어
5. 컷 간 자연스러운 흐름과 연결성 유지
6. 첫 컷은 도입, 마지막 컷은 마무리/여운

JSON 배열만 출력하세요. 설명이나 마크다운 펜스 없이.`;

    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return Response.json({ error: `Gemini API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "[]";

    let cuts;
    try {
      cuts = JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      cuts = match ? JSON.parse(match[0]) : [];
    }

    return Response.json({ cuts });
  } catch (error) {
    console.error("Cuts generation error:", error);
    return Response.json({ error: "Failed to generate cuts" }, { status: 500 });
  }
};
