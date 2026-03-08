import { GeminiEnv, getApiKeys, fetchWithKeyFallback } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { storyText } = await context.request.json() as { storyText: string };

    if (!storyText?.trim()) {
      return Response.json({ error: "storyText is required" }, { status: 400 });
    }

    const keys = getApiKeys(context.env);
    if (keys.length === 0) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const prompt = `다음 시나리오를 분석하여 YouTube 쇼츠 영상으로 만들 때 적절한 장면 수를 추천해주세요.
(장면 = 8초짜리 하나의 영상 클립. 장면 안에서 카메라 무빙/앵글 변화 가능)

시나리오:
"""
${storyText.slice(0, 2000)}
"""

규칙:
- 각 장면은 4~8초
- 최소 4장면, 최대 25장면
- 내용 전환이 많으면 장면 수 증가
- 감정 변화가 크면 장면 수 증가
- 단순 나레이션은 적은 장면

JSON으로만 응답:
{
  "recommendedCuts": 숫자,
  "reason": "추천 이유 (한국어, 1줄)",
  "scenes": ["장면1 요약", "장면2 요약", ...]
}`;

    const res = await fetchWithKeyFallback(
      keys,
      `https://aiplatform.googleapis.com/v1beta/publishers/google/models/gemini-3.1-flash-lite-preview:generateContent?key={KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini error:", errText);
      return Response.json({ error: "AI 분석 실패" }, { status: 500 });
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(text);

    return Response.json({
      recommendedCuts: parsed.recommendedCuts ?? 8,
      reason: parsed.reason ?? "",
      scenes: parsed.scenes ?? [],
    });
  } catch (error) {
    console.error("Analyze cuts error:", error);
    return Response.json(
      { recommendedCuts: 8, reason: "분석 실패 - 기본값 8장면", scenes: [] },
      { status: 200 }
    );
  }
};
