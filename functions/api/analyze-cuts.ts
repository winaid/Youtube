interface Env {
  GEMINI_API_KEY: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { storyText } = await context.request.json() as { storyText: string };

    if (!storyText?.trim()) {
      return Response.json({ error: "storyText is required" }, { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const prompt = `다음 시나리오를 분석하여 YouTube 쇼츠 영상으로 만들 때 적절한 컷 수를 추천해주세요.

시나리오:
"""
${storyText.slice(0, 2000)}
"""

규칙:
- 각 컷은 4~8초
- 최소 4컷, 최대 25컷
- 장면 전환이 많으면 컷 수 증가
- 감정 변화가 크면 컷 수 증가
- 단순 나레이션은 적은 컷

JSON으로만 응답:
{
  "recommendedCuts": 숫자,
  "reason": "추천 이유 (한국어, 1줄)",
  "scenes": ["장면1 요약", "장면2 요약", ...]
}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
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
      { recommendedCuts: 8, reason: "분석 실패 - 기본값 8컷", scenes: [] },
      { status: 200 }
    );
  }
};
