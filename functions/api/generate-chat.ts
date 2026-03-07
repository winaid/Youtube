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

위 페르소나에 맞춰서 유튜브 쇼츠 나레이션 대본을 작성하세요.

## 필수 스타일 규칙 (절대 지켜야 함):

1. 한 줄에 1~2구절만 쓴다. 짧게 끊어 쓴다. 절대 한 줄에 긴 문장을 쓰지 않는다.
2. 말투는 '~임', '~음', '~함' 체를 사용한다. 존댓말 금지.
3. ㅋㅋ는 자연스러운 곳에만 1~2번 사용.
4. 이모지 사용 금지. 순수 텍스트만.
5. [화면], [자막], [BGM], [효과음] 같은 연출 지시어 금지. 순수 나레이션 대본만 작성.
6. 번호 매기기, 불릿 포인트 금지. 그냥 줄글로 쓴다.
7. 시작은 일상적인 공감 경험으로 훅을 건다.
8. 중간에 역사/전문 지식으로 반전을 준다.
9. 끝은 현대에 적용할 수 있는 교훈으로 마무리한다.
10. 빈 줄로 문단을 자연스럽게 구분한다.

## 좋은 예시 (이 스타일을 따라해):

지하철에서 델리만쥬 냄새 맡고
정신차려보니 이미
줄서있는 나를 발견함

근데 이런 일이
500년 전
조선시대에도 있었음

한양의 어느 의원이
약탕기 위치를
아주 특별하게 잡았음

보통 의원들은
마당 구석에서
조용히 약을 달임

그런데 이 의원은
사람 많이 다니는
담벼락 옆에 약탕기를 둠

## 나쁜 예시 (이렇게 쓰지 마):
- **(0-3초) 후킹: 텅 빈 진료실** ← 이런 형식 금지
- "예약 펑크 실화냐..." 같은 자막 지시 금지
- BGM: 신나는 국악풍 ← 이런 연출 지시 금지
- 이모지 금지

나레이션 대본만 출력하세요. 다른 설명 없이.`;

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
