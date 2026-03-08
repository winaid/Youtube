import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

// 간단한 인메모리 캐시 (동일 요청 중복 방지)
const responseCache = new Map<string, { reply: string; sources: { title: string; url: string }[]; searchQueries: string[]; ts: number }>();
const CACHE_TTL = 1000 * 60 * 30; // 30분

const SYSTEM_INSTRUCTION = `당신은 병의원 마케팅 쇼츠 나레이션 대본 전문 작가입니다.

## 핵심 임무
Google Search로 사용자 요청과 관련된 실제 역사적 사실, 의학 역사, 병의원 마케팅 사례를 검색하세요.
반드시 검색해서 찾은 실제 사실을 시나리오에 녹여야 합니다. 절대 지어내지 마세요.

## 대본 스타일 규칙 (절대 준수)
- 한 줄에 1~2구절만. 짧게 끊어 쓴다
- 말투: '~임', '~음', '~함' 체. 존댓말 금지
- ㅋㅋ는 자연스러운 곳에 1~2번만
- 이모지 금지. 순수 텍스트만
- [화면], [자막], [BGM] 등 연출 지시어 금지. 순수 나레이션만
- 번호, 불릿 포인트 금지. 줄글로 작성
- 빈 줄로 문단 구분

## 대본 구조
훅(일상 공감) → 역사적 사실(검색 결과 기반) → 현대 교훈(병의원 마케팅)

## 좋은 예시:

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

## 하면 안 되는 것:
- "(0-3초) 후킹:" 같은 타임코드/형식 금지
- 자막 지시, BGM 지시, 효과음 지시 금지
- 이모지 금지
- "약사" 주제는 반드시 의사/병원/의원/클리닉 맥락으로만 작성. 약국 관련 내용 절대 금지

## 출처 표기
대본 아래 빈 줄 2개 후 "---" 구분선,
검색 출처를 1~3줄로 간단히 적기.
예: "출처: 동의보감 서문 (1613), 조선왕조실록 선조 37년 기록"

나레이션 대본 + 출처만 출력. 다른 설명 없이.`;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { message, personaId, personaName, personaDescription, personaPrompt } =
      await context.request.json() as Record<string, string>;

    if (!message) {
      return Response.json({ error: "message is required" }, { status: 400 });
    }

    // 캐시 확인
    const cacheKey = `${personaId}:${message}`;
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return Response.json({
        reply: cached.reply,
        sources: cached.sources,
        searchQueries: cached.searchQueries,
      });
    }

    const userPrompt = `[페르소나: ${personaName || "AI 시나리오 작가"}]
${personaPrompt || ""}

사용자 요청: "${message}"`;

    const res = await fetchWithAuth(context.env, buildVertexUrl(context.env, "gemini-3-flash-preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return Response.json({ error: `Gemini API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        groundingMetadata?: {
          searchEntryPoint?: { renderedContent?: string };
          groundingChunks?: { web?: { uri?: string; title?: string } }[];
          webSearchQueries?: string[];
        };
      }[];
    };

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    // 그라운딩 메타데이터에서 검색 소스 추출
    const grounding = data?.candidates?.[0]?.groundingMetadata;
    const sources = grounding?.groundingChunks
      ?.filter((c) => c.web?.uri)
      .map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" }))
      ?? [];
    const searchQueries = grounding?.webSearchQueries ?? [];

    // 캐시 저장
    responseCache.set(cacheKey, { reply, sources, searchQueries, ts: Date.now() });

    // 오래된 캐시 정리
    if (responseCache.size > 100) {
      const now = Date.now();
      for (const [key, val] of responseCache) {
        if (now - val.ts > CACHE_TTL) responseCache.delete(key);
      }
    }

    return Response.json({
      reply,
      sources,
      searchQueries,
    });
  } catch (error) {
    console.error("Chat error:", error);
    return Response.json({ error: "Failed to generate response" }, { status: 500 });
  }
};
