import { GeminiEnv, fetchWithAuth, buildGeminiUrl } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { scenes, mood, genre } = await context.request.json() as {
      scenes: { sceneDescription: string; moodLighting: string }[];
      mood?: string;
      genre?: string;
    };

    const sceneSummary = scenes
      .slice(0, 10)
      .map((s, i) => `장면${i + 1}: ${s.sceneDescription} (${s.moodLighting})`)
      .join("\n");

    const prompt = `당신은 영상 BGM 큐레이터입니다. 아래 장면들의 분위기를 분석하여 무료(로열티 프리) BGM을 추천해주세요.

장면 목록:
${sceneSummary}
${mood ? `전체 분위기: ${mood}` : ""}
${genre ? `장르: ${genre}` : ""}

요구사항:
1. 전체 영상에 맞는 메인 BGM 1곡 추천
2. 장면별로 분위기가 크게 바뀌는 구간이 있다면 추가 BGM 추천 (최대 3곡)
3. 모든 추천은 로열티 프리/크리에이티브 커먼즈 음악
4. 검색 가능한 구체적인 키워드 제공

JSON으로만 응답:
{
  "mainBgm": {
    "mood": "전체 분위기 요약",
    "genre": "음악 장르",
    "tempo": "BPM 범위",
    "searchKeywords": ["유튜브 오디오 라이브러리 검색 키워드1", "키워드2"],
    "suggestions": ["구체적 곡/아티스트 추천1", "추천2"],
    "source": "추천 소스 (YouTube Audio Library, Pixabay Music, etc.)"
  },
  "sceneBgm": [
    {
      "forScenes": "장면 1-3",
      "mood": "분위기",
      "searchKeywords": ["키워드"],
      "suggestion": "추천 곡"
    }
  ]
}`;

    const res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, "gemini-3.1-pro-preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini BGM API error:", res.status, errText);
      return Response.json({ error: `API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";
    const bgmData = JSON.parse(text);

    return Response.json(bgmData);
  } catch (error) {
    console.error("BGM recommendation error:", error);
    return Response.json({ error: "Failed to recommend BGM" }, { status: 500 });
  }
};
