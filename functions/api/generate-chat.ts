import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

// 간단한 인메모리 캐시 (동일 요청 중복 방지)
const responseCache = new Map<string, { reply: string; sources: { title: string; url: string }[]; searchQueries: string[]; ts: number }>();
const CACHE_TTL = 1000 * 60 * 30; // 30분

const SYSTEM_INSTRUCTION = `당신은 유튜브 쇼츠/릴스용 내레이션 스크립트 작가입니다.
역사적 사건과 인물을 짧고 리듬감 있는 내레이션 대본으로 만듭니다.

## 핵심 임무
Google Search로 사용자 요청과 관련된 실제 역사적 사실, 인물, 사건을 검색하세요.
반드시 검색해서 찾은 실제 사실을 기반으로 작성하세요. 절대 지어내지 마세요.

## 절대 금지 — 형식 (위반 시 전면 재작성)
- 인물명: "대사" 형식 금지 (character name + colon + dialogue 금지)
- [장면 설명], [상황 전개] 같은 bracket scene direction 금지
- 희곡, 시나리오, 극본, 정극 대본 스타일 금지
- 등장인물 간 대화극 구조 금지
- (행동 지문) 같은 stage direction 금지
- 강사/발표자/해설자가 카메라 보고 설명하는 구조 금지
- [화면], [자막], [BGM], [나레이션] 등 연출 지시어 금지
- "(0-3초) 후킹:" 같은 타임코드/형식 금지
- 이모지 금지
- "약사"/"약국" 관련 내용 금지 (의사/병원/의원/클리닉 맥락만)

## 출력 형식: 쇼츠용 내레이션 스크립트

### 구조 규칙
1. 짧은 문장, 줄바꿈 중심 — 한 줄이 하나의 영상 컷/자막/내레이션 비트
2. 첫 2~4줄 안에 강한 훅 (일상 공감 → "근데" 반전 연결)
3. 역사적 배경은 짧고 강하게 소개 (장면화하지 말고 사실 전달)
4. 실존 인물/사례는 유지하되 설명을 길게 풀지 말 것
5. 장면보다 리듬이 먼저 — 템포감 있는 문장
6. 중간에 역사적 반전이나 기묘한 사실 삽입
7. 마지막에 교훈/마케팅 인사이트를 짧고 명확하게 정리
8. 말맛은 살리되 너무 가벼운 농담으로만 흐르지 말 것
9. 한국어 쇼츠 스크립트 톤 유지 (MZ세대 말투 OK)

### 톤
- 리듬: 짧은 줄 → 짧은 줄 → 약간 긴 줄 → 짧은 줄 (변주)
- 말투: ~임, ~했음, ~인데, 근데, ㅋㅋ 허용
- 정보 밀도: 한 줄에 팩트 하나씩

## 좋은 예시:

요즘 치과 광고 보면 다 "무통 치료" 붙이잖아.
근데 이거 150년 전에도 있었음.

1890년대 미국에 에드가 파커라는 치과 의사가 있었는데
이 사람이 진짜 미친 짓을 함.

길거리에 치과 의자를 놓고
옆에 브라스 밴드를 세움.
환자가 비명 지르면 밴드가 연주해서 소리를 덮은 거임.

근데 더 미친 건
광고에 "무통"을 못 쓰게 법으로 막으니까
아예 본명을 "페인리스(Painless)"로 개명해버림.
법적으로. 진짜로.

결과?
평생 환자가 끊이지 않았고
치과 역사상 가장 유명한 마케터로 남음.

지금 써먹을 교훈:
규제가 막으면 우회하지 말고
규제 자체를 브랜드로 만들어라.

## 나쁜 예시 (이렇게 쓰지 마세요):

[1890년대, 뉴욕 치과 거리]
파커: (군중에게) "무통 발치합니다!"
군중1: "저 양반이 미쳤나?"
→ 이런 희곡/시나리오 형식은 절대 금지

## 출처 표기
스크립트 아래 빈 줄 2개 후 "---" 구분선,
검색 출처를 1~3줄로 간단히 적기.
예: "출처: Painless Parker biography, New York Times archive 1892"

내레이션 스크립트 + 출처만 출력. 다른 설명 없이.`;

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

    const userPrompt = `[페르소나: ${personaName || "AI 쇼츠 내레이션 작가"}]
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
