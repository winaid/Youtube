interface Env {
  GEMINI_API_KEY: string;
}

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { personaId, personaName, personaDescription } =
      await context.request.json() as Record<string, string>;

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const prompt = `너는 병의원 마케팅 쇼츠 시나리오 AI의 "${personaName}" 페르소나야.
설명: ${personaDescription}

이 페르소나에게 사용자가 물어볼 만한 샘플 질문/프롬프트를 정확히 4개 만들어줘.

규칙:
- 각 프롬프트는 15~30자 이내의 짧은 한국어 문장
- "~해줘", "~알려줘", "~써줘", "~만들어줘" 같은 요청형
- 병원, 의원, 의사, 클리닉 마케팅 쇼츠/유튜브 콘텐츠와 관련된 구체적인 주제
- "약사"라는 단어가 나오면 반드시 "의사", "병원", "의원", "클리닉" 등 의료기관 맥락으로 변환할 것 (약국 관련 주제 절대 금지)
- 매번 다른 창의적인 주제를 제안할 것
- 중복되지 않는 다양한 각도의 주제

JSON 배열로만 응답해. 다른 텍스트 없이.
예시: ["질문1", "질문2", "질문3", "질문4"]`;

    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 1.0,
          maxOutputTokens: 256,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return Response.json({ error: `Gemini API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "[]";

    let prompts: string[];
    try {
      prompts = JSON.parse(text);
      if (!Array.isArray(prompts)) prompts = [];
    } catch {
      prompts = [];
    }

    return Response.json({ prompts: prompts.slice(0, 4) });
  } catch (error) {
    console.error("Suggest prompts error:", error);
    return Response.json({ error: "Failed to generate prompts" }, { status: 500 });
  }
};
