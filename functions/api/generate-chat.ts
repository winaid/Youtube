interface Env {
  GEMINI_API_KEY: string;
}

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { message, personaId, personaName, personaDescription, personaPrompt } =
      await context.request.json() as Record<string, string>;

    if (!message) {
      return Response.json({ error: "message is required" }, { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const prompt = `당신은 "${personaName || "AI 시나리오 작가"}"입니다.

역할 설명: ${personaDescription || "병의원 마케팅 쇼츠 시나리오 전문가"}

페르소나: ${personaPrompt || "병의원 마케팅에 특화된 콘텐츠 전문가입니다."}

사용자 요청: "${message}"

위 페르소나에 맞춰서 사용자 요청에 응답하세요.

규칙:
1. 말투는 MZ세대가 좋아하는 캐주얼한 '~임' 체를 사용
2. ㅋㅋ, ㅎㅎ 같은 표현 자연스럽게 사용
3. 실제 역사적 사례나 전문 지식을 바탕으로 구체적으로 작성
4. 쇼츠 시나리오 요청이면: 후킹(첫 3초) → 본문 → 반전 → 교훈 구조로 작성
5. 자막, 효과음, BGM 포인트도 포함
6. 응답은 한국어로 작성`;

    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return Response.json({ error: `Gemini API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    return Response.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    return Response.json({ error: "Failed to generate response" }, { status: 500 });
  }
};
