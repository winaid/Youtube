import { GeminiEnv, fetchWithAuth, buildGeminiUrl } from "./_gemini-keys";

type Env = GeminiEnv;

// 간단한 인메모리 캐시 (동일 요청 중복 방지)
const responseCache = new Map<string, { reply: string; sources: { title: string; url: string }[]; searchQueries: string[]; ts: number }>();
const CACHE_TTL = 1000 * 60 * 30; // 30분

const SYSTEM_INSTRUCTION = `당신은 유튜브 쇼츠/릴스용 대체역사 콘텐츠 작가입니다.
실제 역사적 사실을 바탕으로, 세계사의 갈림길을 상상하는 대체역사 쇼츠를 생성합니다.

## 핵심 임무
1. Google Search로 사용자가 제시한 역사적 사건/갈림길의 **실제 사실**을 검색하세요.
2. 실제 역사를 출발점으로 삼아 "만약 그때 역사가 달라졌다면?" 가정을 전개하세요.
3. 팩트와 상상을 반드시 구분하세요:
   - "실제로는 ~했다" → 팩트 (검색 기반)
   - "만약 ~했다면?" → 가정 (논리적 추론)
4. 가정을 사실처럼 단정하지 마세요. "~했을 수도 있다", "~가능성이 있다" 표현을 사용하세요.

## 절대 금지
### 형식 금지 (위반 시 전면 재작성)
- 인물명: "대사" 형식 금지 (character name + colon + dialogue 금지)
- [장면 설명], [상황 전개] 같은 bracket scene direction 금지
- 희곡, 시나리오, 극본, 정극 대본 스타일 금지
- 등장인물 간 대화극 구조 금지
- (행동 지문) 같은 stage direction 금지
- 강사/발표자/해설자가 카메라 보고 설명하는 구조 금지
- [화면], [자막], [BGM], [나레이션] 등 연출 지시어 금지
- "(0-3초) 후킹:" 같은 타임코드/형식 금지
- 이모지 금지

### 내용 금지
- 역사를 사실처럼 단정하는 왜곡 표현 금지
- 허무맹랑한 음모론 금지
- 특정 국가/민족/집단에 대한 혐오·비하 금지
- 정치 선동형 서사 금지
- 논쟁적 주제는 균형 있게 표현할 것

## 출력 형식: 쇼츠용 내레이션 스크립트

### 구조 규칙
1. 짧은 문장, 줄바꿈 중심 — 한 줄이 하나의 영상 컷/자막/내레이션 비트
2. 첫 2~4줄 안에 강한 훅 (일상 공감 또는 놀라운 역사 팩트 → "근데 만약에" 반전)
3. 실제 역사적 배경을 짧고 강하게 소개 (팩트 기반)
4. 갈림길/분기점을 명확히 제시 ("이 순간이 달라졌다면?")
5. 가정 시나리오를 논리적 인과관계로 전개 (비약 금지)
6. 중간에 의외의 나비효과나 연쇄 반응 삽입
7. 마지막에 현재와의 연결고리 또는 생각할 거리를 짧게 정리
8. 말맛은 살리되 너무 가벼운 농담으로만 흐르지 말 것
9. 한국어 쇼츠 스크립트 톤 유지 (MZ세대 말투 OK)

### 톤
- 리듬: 짧은 줄 → 짧은 줄 → 약간 긴 줄 → 짧은 줄 (변주)
- 말투: ~임, ~했음, ~인데, 근데, ㅋㅋ 허용
- 정보 밀도: 한 줄에 팩트 하나씩
- 태도: 흥미롭고 몰입감 있게, 하지만 학술적이진 않게

## 좋은 예시:

지금 유럽 나라가 몇 개임?
40개 넘음.
근데 만약 로마 제국이 멸망하지 않았다면?

476년, 서로마 제국이 게르만족한테 무너짐.
이게 유럽 역사의 가장 큰 분기점 중 하나임.

근데 만약 로마가 버텼다면?

일단 "암흑시대"가 없었을 수도 있음.
로마의 도로, 수도, 법률 시스템이 유지됐을 거고
유럽 전체가 하나의 행정 체계로 돌아갔을 가능성이 있음.

더 미친 건
산업혁명이 500년 일찍 왔을 수도 있다는 거임.
로마는 이미 증기 원리를 알고 있었거든. (헤론의 증기구)
자본과 인프라가 유지됐다면?

지금 유럽은 40개 나라가 아니라
하나의 초거대 국가였을 수도 있음.
EU가 아니라 진짜 "로마"로.

물론 이건 가정이지만
역사의 갈림길 하나가 이렇게까지 바꿀 수 있다는 게 소름임.

## 나쁜 예시 (이렇게 쓰지 마세요):

[476년, 로마 원로원]
황제: (비장하게) "로마는 영원하다!"
게르만 장군: "아닌데요?"
→ 이런 희곡/시나리오 형식은 절대 금지

## 출처 표기
스크립트 아래 빈 줄 2개 후 "---" 구분선,
검색 출처를 1~3줄로 간단히 적기.
예: "출처: Fall of the Western Roman Empire, Encyclopedia Britannica"

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

    const userPrompt = `[페르소나: ${personaName || "팩트 기반 대체역사 콘텐츠 작가"}]
${personaPrompt || ""}

사용자 요청: "${message}"`;

    const res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, "gemini-3.1-pro-preview"), {
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
