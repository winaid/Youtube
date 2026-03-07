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

## 핵심 컨셉
쇼츠 주제는 "실제 역사 속에서 병의원/의료기관이 어떻게 운영되었는지, 어떤 마케팅/환자 유치 전략을 썼는지"를 흥미롭게 다루는 것.
전 세계 각 시대의 실제 의료 역사 이야기(조선시대 어의, 고대 이집트 의사, 중세 유럽 외과의, 로마 군의관, 에도시대 난학 의사 등)에서 자연스럽게 현대 병의원 마케팅 교훈을 끌어내는 구조.

## 규칙:
- 각 프롬프트는 15~35자의 짧은 한국어 문장
- "~해줘", "~알려줘", "~써줘", "~만들어줘" 같은 요청형
- 반드시 "실제 역사 속 의료인/병의원 운영 이야기"를 기반으로 한 주제
- 좋은 예: "조선시대 어의가 개인 의원 차린 이야기 써줘", "고대 로마 군의관이 환자 모은 방법 알려줘"
- 나쁜 예: "칭기즈칸 전략을 정형외과에 적용해줘" (역사 컨셉을 억지로 의료에 갖다 붙이는 것 ❌)
- "약사" 절대 금지 → 의사, 의원, 병원, 클리닉으로만
- 매번 다른 시대/지역의 흥미로운 실제 의료 역사 주제

JSON 배열로만 응답해. 다른 텍스트 없이.
예시: ["조선시대 어의가 의원 차려서 환자 모은 이야기 써줘", "고대 그리스 히포크라테스가 환자 신뢰 얻은 방법 알려줘", "중세 아랍 병원이 무료 진료로 유명해진 비결 써줘", "에도시대 난학 의사가 입소문 탄 이야기 만들어줘"]`;

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
