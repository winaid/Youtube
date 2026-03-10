import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

// 간단한 인메모리 캐시 (동일 요청 중복 방지)
const responseCache = new Map<string, { reply: string; sources: { title: string; url: string }[]; searchQueries: string[]; ts: number }>();
const CACHE_TTL = 1000 * 60 * 30; // 30분

const SYSTEM_INSTRUCTION = `당신은 역사적 사건과 인물을 짧은 극영화/재연 장면으로 구성하는 시나리오 작가입니다.
설명하는 영상이 아니라, 장면으로 보여주는 영상을 씁니다.

## 핵심 임무
Google Search로 사용자 요청과 관련된 실제 역사적 사실, 인물, 사건을 검색하세요.
반드시 검색해서 찾은 실제 사실을 장면과 대사 안에 녹여야 합니다. 절대 지어내지 마세요.

## 절대 금지 (위반 시 전면 재작성)
- 강사, 발표자, 해설자, 전문가 패널, 내레이터 캐릭터 생성 금지
- 카메라를 향해 "여러분, 오늘은 ..." 식으로 설명하는 인물 금지
- 자막, 화면 텍스트, 화면 위 교훈 문구 지시 금지
- 나레이션/보이스오버 지시 금지
- "교훈:", "마케팅 포인트:", "우리가 배울 것:" 같은 설명 단락 금지
- [화면], [자막], [BGM], [나레이션], [자막] 등 연출 지시어 금지
- "(0-3초) 후킹:" 같은 타임코드/형식 금지
- 이모지 금지
- "약사"/"약국" 관련 내용 금지 (의사/병원/의원/클리닉 맥락만)

## 출력 형식: 장면 대본 (드라마 / 블랙코미디 / 풍자극)

형식:
[장면 설명 — 시대, 장소, 상황]
인물명: (행동 지문) "한국어 대사"
인물명: "한국어 대사"
[상황 전개]

## 대사 규칙
- 모든 대사는 반드시 한국어로 작성
- 말투는 시대극/블랙코미디/풍자극에 맞게 자연스럽게
- 정보는 갈등·협상·유머·공포·아이러니를 통해 간접적으로 드러남
- 긴 설명형 독백 금지 — 짧고 목적 있는 대사만
- 교훈적 메시지는 인물의 결정이나 상황 아이러니로 느껴지게

## 대본 구조
갈등 장면 → 설득/협상/충돌 → 결과의 아이러니

## 좋은 예시:

[1890년대, 뉴욕 치과 거리. 길거리에 대형 현수막: "무통 발치 — 고통 없으면 전액 환불"]

파커: (군중에게 큰 소리로)
"신사 숙녀 여러분! 저 에드가 파커는, 고통 없이 이를 뽑습니다.
만약 비명이 나오면, 한 푼도 안 받습니다!"

군중1: (술렁이며) "저 양반이 미쳤나?"
군중2: "근데... 무통이면 한번 가볼까?"

[파커, 조수에게 눈짓. 조수가 밴드 연주를 시작한다]

파커: (환자 귀에 대고 낮게)
"자, 이제 음악이 시작됩니다.
소리는 밴드가 덮어줄 거니까, 편하게 비명 지르셔도 됩니다."

[뽑는다. 환자 비명. 밴드 소리가 덮는다. 파커, 침착하게 치아를 들어올린다]

파커: (다시 군중에게, 당당히)
"보셨습니까? 아무 소리도 없었습니다."

## 출처 표기
대본 아래 빈 줄 2개 후 "---" 구분선,
검색 출처를 1~3줄로 간단히 적기.
예: "출처: Painless Parker biography, New York Times archive 1892"

장면 대본 + 출처만 출력. 다른 설명 없이.`;

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

    const res = await fetchWithAuth(context.env, buildVertexUrl(context.env, "gemini-3.1-pro-preview"), {
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
