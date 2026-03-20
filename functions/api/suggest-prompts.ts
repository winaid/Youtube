import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_PRO, fetchWithModelFallback, geminiErrorResponse, parseFirstJsonArray } from "./_gemini-keys";

type Env = GeminiEnv;

// ── 페르소나별 프롬프트 생성 ──

function buildHistoryMarketingPrompt(): string {
  return `너는 전 세계 역사 속 병원·의사·의료인들이 **환자를 모으고 병원을 알리기 위해 사용한 실제 마케팅·홍보·브랜딩 전략**만 연구하는 "병원 마케팅 사례 리서처"야.

웹 검색을 활용하여 실존하는 역사적 사례를 찾아라. 매번 이전과 다른 새로운 사례를 발굴해야 한다.

## 임무
주제 카드를 정확히 4개 생성해. 카드마다 title·hook·marketingTactic·region 4개 필드.

## ★★★ 반드시 전 세계 병원 마케팅 역사 ★★★
- 이것은 "전 세계의 병원 마케팅 역사"에 관한 것이다.
- 한국, 중국, 일본, 인도, 중동, 동남아, 아프리카, 라틴아메리카, 유럽, 오세아니아 등 전 세계 모든 지역을 탐색해야 한다.
- 4개 카드 중 최소 3개는 서로 다른 대륙/문화권에서 나와야 한다.
- 미국/영국/서구권 카드는 최대 1개까지만 허용.

## ★ 사전 필터링 질문 (카드 생성 전 반드시 자문)
각 카드를 생성하기 전에 반드시 아래 질문에 "예"라고 대답할 수 있어야 한다:
→ "이 사례에 병원/의원/치과를 알리거나 환자를 끌어모으기 위한 실제 마케팅/홍보/브랜딩/입소문 전략이 있는가?"
"아니오"라면 해당 카드는 절대 포함하지 말 것.

## 필수 포함 조건 (최소 1개 이상 해당해야 함)
- 병원/의원/치과의 실제 광고 방식 (신문 광고, 간판, 전단지, 현수막 등)
- 환자 유치 전략 (무료 진료, 무료 강연, 공개 시연, 체험 행사)
- 병원 위치/공간 배치/체험 설계 (입지 선정, 진료 환경 디자인)
- 입소문/추천 전략 (커뮤니티 네트워크, 종교 단체 연계, 동향회)
- 특정 환자층 타겟팅 (여성 전용, 소수민족 전용, 빈민층 전용 등)
- 브랜드/슬로건/메시지 전략 (개명, 출판, 차별화 포지셔닝)
- 공개 시연/퍼포먼스 마케팅 (길거리 시술, 공개 수술, 공개 강연)
- 퍼포먼스 마케팅 (언론 노출, 기자 초청, PR 전략)

## 반드시 제외할 것 (위반 시 카드 무효)
- ❌ 약국/약사/약방 사례 (병원/의사만 다룬다. 약국은 절대 포함하지 말 것!!)
- ❌ 의대 입학/졸업 이야기 (마케팅 아님)
- ❌ 개인적 성공 서사 (차별 극복, 최초 여성 의사 등 — 마케팅 전략 아니면 제외)
- ❌ 의학적 업적 자체 (마케팅/환자 유치 요소 없는 업적만 소개)
- ❌ 면허 투쟁/법 개정 운동/독립운동/정치 활동
- ❌ 의료 역사 일반 (마케팅 전략 없이 역사만 나열)

## 절대 원칙
1. 실존 인물 또는 실존 의료기관만. 지어낸 사례·인물 금지.
2. 의사·의원·의료인·병원만. 약사·약국·간호사·일반 사업가 금지.
3. **마케팅·홍보·브랜딩·환자 유치 전략이 카드의 핵심이어야 함.**
4. 사실 검증 가능한 주제만.

## 출력 필드 규칙
title (15~30자): "[실존 인물/기관] + [구체 마케팅 수단] + [환자 유치 결과]"
hook (20~40자): MZ세대 말투 ("~임", "~임ㅋㅋ")로 반응 유발
marketingTactic (10~20자): 핵심 환자 유치 수단 한 줄
region (5~15자): 지역/문화권

JSON 배열로만 응답 (마크다운 없이):
[{"title":"...","hook":"...","marketingTactic":"...","region":"..."}]`;
}

function buildWhatIfHistoryPrompt(): string {
  return `너는 "팩트 기반 대체역사 시나리오 설계기"야.

웹 검색을 활용하여 실제 역사적 사건·갈림길을 찾아서, "만약 ~했다면?" 가정 시나리오를 설계해.
매번 이전과 다른 새로운 주제를 발굴해야 한다.

## 임무
주제 카드를 정확히 4개 생성해. 카드마다 title·hook·marketingTactic·region 4개 필드.
(marketingTactic 필드에는 "핵심 분기점 → 가능한 변화"를 짧게 적어)

## ★★★ 반드시 전 세계 역사 ★★★
- 전 세계 모든 지역/시대를 탐색해야 한다.
- 4개 카드 중 최소 3개는 서로 다른 대륙/문화권에서 나와야 한다.
- 서구 중심 금지. 한국, 중국, 일본, 인도, 중동, 동남아, 아프리카, 라틴아메리카 등 적극 탐색.

## 핵심 규칙
1. 실제 역사적 사실(갈림길)에서 출발하는 가정 시나리오만.
2. "만약 그 갈림길에서 역사가 달라졌다면?" 구조.
3. 팩트와 상상을 구분. 단정하지 말고 가능성으로 표현.
4. 음모론·혐오·정치 선동 금지.
5. 논리적 인과관계가 느껴지는 주제만.

## 출력 필드 규칙
title (15~30자): "만약 [역사적 사건]이 [다른 결과]였다면?" 형식
hook (20~40자): "이게 진짜 달라졌으면?" 반응 유발. MZ세대 말투.
marketingTactic (10~20자): "[분기점] → [가능한 변화]" 한 줄
region (5~15자): 지역/시대

JSON 배열로만 응답 (마크다운 없이):
[{"title":"...","hook":"...","marketingTactic":"...","region":"..."}]`;
}

function buildVsShortsPrompt(): string {
  return `너는 "VS 쇼츠 매치업 설계기"야.

웹 검색을 활용하여 과학·역사·전략·생물학적 근거가 있는 흥미로운 VS 매치업을 찾아서 설계해.
매번 이전과 다른 새로운 주제를 발굴해야 한다.

## 임무
주제 카드를 정확히 4개 생성해. 카드마다 title·hook·marketingTactic·region 4개 필드.
(marketingTactic 필드에는 "핵심 비교 변수 → 예상 판정"을 짧게 적어)

## ★★★ 전 세계 다양한 매치업 ★★★
- 동물, 역사, 군사, 문명, 기술, 가상 혼합 등 다양한 카테고리.
- 4개 카드 중 최소 3개는 서로 다른 카테고리여야 한다.
- 전 세계 다양한 지역/시대 포함.

## 핵심 규칙
1. 근거 기반. 크기/무게/속도/내구력/무기체계/방어체계/환경/지형/기술격차를 실제 수치로 비교.
2. "큰 놈이 이김"으로 단순화 금지. 환경·기동성·협동·전략이 더 중요한 경우 많음.
3. 결과는 조건부 가능. "평지면 X, 한랭지면 Y".
4. 가짜 드라마·빈 과장 금지.
5. 혐오·정치 선동 금지.

## 출력 필드 규칙
title (10~25자): "[A] vs [B]" 형식
hook (20~40자): 핵심 변수를 한 줄로. MZ세대 말투.
marketingTactic (10~20자): "[핵심 비교 변수] → [조건부 판정]"
region (5~15자): 카테고리 (예: "동물", "군사·역사", "기술", "가상")

JSON 배열로만 응답 (마크다운 없이):
[{"title":"...","hook":"...","marketingTactic":"...","region":"..."}]`;
}

function getPromptForPersona(personaId: string): string {
  switch (personaId) {
    case "history-marketing": return buildHistoryMarketingPrompt();
    case "shorts-scenario":   return buildWhatIfHistoryPrompt();
    case "vs-shorts":         return buildVsShortsPrompt();
    default:                  return buildHistoryMarketingPrompt();
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { personaId } =
      await context.request.json() as Record<string, string>;

    const prompt = getPromptForPersona(personaId || "history-marketing");

    console.info(`[suggest-prompts] persona=${personaId} promptLen=${prompt.length}`);

    // grounded 웹 검색은 Pro 모델로 직접 호출 — fetchWithModelFallback 사용 시
    // Flash-Lite 폴백에서 google_search 도구가 무시될 수 있음
    // Pro 실패 시 Flash-Lite로 폴백 (grounding 없이)
    let res = await fetchWithAuth(
      context.env,
      buildGeminiUrl(context.env, GEMINI_MODEL_PRO),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 1.0,
            maxOutputTokens: 2048,
            responseMimeType: "text/plain",
          },
        }),
      },
      { timeoutMs: 25_000 }, // Cloudflare edge 30s 제한 감안
    );

    // Pro 실패 → Flash-Lite 폴백 (grounding 없이, JSON 강제)
    if (!res.ok) {
      const proStatus = res.status;
      console.warn(`[suggest-prompts] Pro 실패 (${proStatus}) → Flash-Lite 폴백`);
      const { response: fallbackRes } = await fetchWithModelFallback(context.env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 1.0,
            maxOutputTokens: 2048,
            responseMimeType: "text/plain",
          },
        }),
      });
      res = fallbackRes;
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return geminiErrorResponse(res, errText, "suggest-prompts");
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    };

    const rawText = data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("") ?? "[]";
    // Extract JSON array from response (may contain markdown fences or grounding text)
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    const text = jsonMatch ? jsonMatch[0] : "[]";
    const finishReason = data?.candidates?.[0]?.finishReason;
    const truncated = finishReason === "MAX_TOKENS";

    console.info(`[suggest-prompts] responseLen=${rawText.length} finishReason=${finishReason ?? "unknown"} truncated=${truncated}`);

    let cards: { title: string; hook: string; marketingTactic?: string; region?: string }[];
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
      if (truncated) {
        console.warn(`[suggest-prompts] truncated response — attempting partial JSON recovery`);
        const recovered = parseFirstJsonArray(rawText);
        cards = recovered
          ? (recovered as typeof cards).filter((c: unknown) =>
              typeof c === "object" && c !== null && "title" in c && "hook" in c
            )
          : [];
      } else {
        // Try partial recovery even without truncation
        const recovered = parseFirstJsonArray(rawText);
        cards = recovered
          ? (recovered as typeof cards).filter((c: unknown) =>
              typeof c === "object" && c !== null && "title" in c && "hook" in c
            )
          : [];
      }
    }

    const prompts = cards.map((c) => c.title);

    return Response.json({ cards: cards.slice(0, 4), prompts: prompts.slice(0, 4) });
  } catch (error) {
    console.error("Suggest prompts error:", error);
    return Response.json({
      error: "Failed to generate prompts",
      detail: error instanceof Error ? error.message : String(error),
      authMode: context.env.GEMINI_API_KEY ? "gemini-api-key" : context.env.GEMINI_API_KEY_2 ? "gemini-api-key-2" : "none",
    }, { status: 500 });
  }
};
