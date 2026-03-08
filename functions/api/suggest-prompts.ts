import { GeminiEnv, fetchWithAuth } from "./_gemini-keys";

type Env = GeminiEnv;

const GEMINI_API_URL =
  "https://aiplatform.googleapis.com/v1beta/publishers/google/models/gemini-3.1-pro:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { personaId, personaName, personaDescription } =
      await context.request.json() as Record<string, string>;

    const prompt = `너는 병의원 마케팅 쇼츠 시나리오 AI의 "${personaName}" 페르소나야.
설명: ${personaDescription}

## 임무
이 페르소나에 맞는 쇼츠 주제 카드를 정확히 4개 만들어줘.
각 카드는 "제목(title)"과 "일상 공감 훅(hook)" 2줄 구성이야.

## 핵심 컨셉
- 실제 역사 속에서 병의원/의사들이 어떻게 환자를 모으고, 마케팅하고, 신뢰를 쌓았는지를 다루는 것
- 전 세계 각 시대의 실제 의료 역사 이야기에서 현대 병의원 마케팅 교훈을 끌어내는 구조

## 제목(title) 규칙:
- 15~30자 한국어 주제형 제목 (요청형 "~해줘" 절대 금지!)
- "~비결", "~전략", "~마케팅", "~방법", "~이야기" 등 주제형 명사로 끝냄
- 좋은 예: "중국 화타가 전설적 의사가 된 브랜딩 비결"
- 나쁜 예: "조선시대 의원이 쓴 마케팅 전략 알려줘" (요청형 금지)

## 일상 공감 훅(hook) 규칙:
- 20~40자, 현대인이 공감하는 일상 상황으로 시작
- MZ세대 말투 ("~잖아", "~있음", "~인데", "~봤지?")
- 예: "병원 가면 1분 첫 진료에 약만 덜렁 받고 나올 때 많음"
- 예: "성형외과나 피부과 갈 때 다들 후기부터 찾아봄"

## 금지사항:
- "약사" 절대 금지 → 의사, 의원, 병원만
- 매번 다른 시대/지역의 흥미로운 실제 의료 역사 주제

JSON 배열로만 응답해. 다른 텍스트 없이.
예시: [{"title": "중국 화타가 전설적 의사가 된 브랜딩 비결", "hook": "병원 가면 1분 첫 진료에 약만 덜렁 받고 나올 때 많음"}, {"title": "일본 에도시대 의원의 입소문 마케팅", "hook": "성형외과나 피부과 갈 때 다들 후기부터 찾아봄 비포 애프터"}]`;

    const res = await fetchWithAuth(context.env, GEMINI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 1.0,
          maxOutputTokens: 512,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return Response.json({
        error: `Gemini API error: ${res.status}`,
        detail: errText.slice(0, 500),
        authMode: context.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "service-account" : context.env.GOOGLE_CLOUD_API_KEY ? "cloud-api-key" : context.env.GEMINI_API_KEY ? "gemini-api-key" : "none",
      }, { status: 500 });
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "[]";

    let cards: { title: string; hook: string }[];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        cards = parsed.filter((c: unknown) =>
          typeof c === "object" && c !== null && "title" in c && "hook" in c
        );
      } else {
        cards = [];
      }
    } catch {
      cards = [];
    }

    // backwards compat: also return string prompts
    const prompts = cards.map((c) => c.title);

    return Response.json({ cards: cards.slice(0, 4), prompts: prompts.slice(0, 4) });
  } catch (error) {
    console.error("Suggest prompts error:", error);
    return Response.json({
      error: "Failed to generate prompts",
      detail: error instanceof Error ? error.message : String(error),
      authMode: context.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "service-account" : context.env.GOOGLE_CLOUD_API_KEY ? "cloud-api-key" : context.env.GEMINI_API_KEY ? "gemini-api-key" : "none",
    }, { status: 500 });
  }
};
