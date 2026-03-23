import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH, GEMINI_MODEL_SEARCH, fetchWithModelFallback, geminiErrorResponse, parseFirstJsonArray } from "./_gemini-keys";

type Env = GeminiEnv;

// ── 페르소나별 프롬프트 생성 ──

function buildHistoryMarketingPrompt(): string {
  return `너는 전 세계 역사 속 병원·의사·의료인들이 **의도적으로** 환자를 모으기 위해 사용한 **실제 마케팅·홍보·브랜딩 전략**만 연구하는 "병원 마케팅 사례 리서처"야.
웹 검색으로 실존하는 역사적 사례를 찾아라. 매번 새로운 사례를 발굴해야 한다.

## 핵심 구분: "의도적 마케팅" vs "사후 재해석"
- ✅ 의도적 마케팅: "환자를 끌어오겠다"는 의도로 실행한 전략 (광고, 공개 시연, 무료 진료, 타겟팅 등)
- ❌ 사후 재해석: 업적을 현대 관점에서 "마케팅이었다"고 갖다 붙인 것
  예: "허준이 동의보감으로 브랜딩" → 학문적 업적이지 마케팅 의도 없음
자문 테스트: "환자를 모으려는 의도가 있었다는 역사적 증거가 있는가?" → "아니오"면 제외.

## 임무
주제 카드 정확히 4개. 카드마다 title·hook·marketingTactic·region 필드.

## 지역·시대 제한
- 4개 중 최소 3개는 서로 다른 대륙/문화권. 서구권 최대 1개.
- 2000년 이전 사례만. 디지털 마케팅(앱/SNS/웹사이트) 절대 금지.

## 필수 포함 조건 — 아래 중 1개 이상의 구체적 홍보 행동 필요
- 신문/잡지 광고, 전단지/포스터/간판 제작
- 무료 진료/강연/시연을 환자 유치 목적으로 기획
- 병원 이름/슬로건/브랜드를 의도적으로 설계 (개명, 포지셔닝)
- 특정 환자층 타겟팅 메시지, 언론 의도적 노출, 환자 경험 설계

## 제외 (위반 시 카드 무효)
- ❌ 약국/약사/약방 (병원/의사만)
- ❌ 의학 업적·수술 성공·기술 혁신 (마케팅 아님)
- ❌ 학술 저술·의학서 집필 (환자 유치 의도 명확한 대중 건강서만 예외)
- ❌ 면허 투쟁/정치 활동/개인 성공 서사
- ❌ "결과적으로 유명해졌다" = 마케팅 아님

## 절대 원칙
1. 실존 인물/기관만. 2. 의사·병원만. 3. 마케팅 전략이 카드 핵심. 4. 사실 검증 가능.

## 출력 필드 규칙
title (15~30자): "[실존 인물/기관] + [구체 마케팅 수단] + [결과]"
hook (20~40자): MZ세대 말투 ("~임", "~임ㅋㅋ")
marketingTactic (10~20자): 핵심 환자 유치 수단
intentionalProof (15~40자): 마케팅 의도의 역사적 증거 1문장 (비거나 약하면 카드 무효)
region (5~15자): 지역/문화권

JSON 배열만:
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

function buildShortFilmPrompt(): string {
  return `너는 "단편영화 시나리오 아이디어 생성기"야.

웹 검색을 활용하여 흥미로운 단편영화 소재를 찾아서 1~2분 분량의 시나리오 아이디어를 설계해.
매번 이전과 다른 새로운 아이디어를 발굴해야 한다.

## 임무
주제 카드를 정확히 4개 생성해. 카드마다 title·hook·marketingTactic·region 4개 필드.
(marketingTactic 필드에는 "핵심 비주얼 컨셉"을 짧게 적어)

## ★★★ 다양한 장르/감성 ★★★
- 4개 카드는 서로 다른 분위기여야 한다: 감동, 반전, 공포, 일상, 판타지, 코미디, 미스터리, SF 등
- 한국 배경 2개 + 해외 배경 2개 혼합 권장.
- AI 영상 생성(VEO)으로 제작 가능한 시각적 이야기만.

## 핵심 규칙
1. 대사 최소화. 비주얼로 이야기를 전달하는 구조.
2. 1분 20초~2분 분량. 짧지만 기승전결이 있어야 함.
3. 인물은 최대 2명. 복잡한 관계보다 상황 중심.
4. 시각적 반전 또는 감정 변화가 있어야 함.
5. 혐오·폭력·정치 선동 금지.
6. 마케팅/광고가 아닌 순수 이야기여야 함.

## 출력 필드 규칙
title (15~30자): 시나리오 핵심을 한 줄로
hook (20~40자): "이런 장면 상상해봐" 반응 유발. 자연스러운 말투.
marketingTactic (10~20자): 핵심 비주얼 컨셉
region (5~15자): 배경 장소

JSON 배열로만 응답 (마크다운 없이):
[{"title":"...","hook":"...","marketingTactic":"...","region":"..."}]`;
}

function buildGenericPrompt(personaName: string, personaDescription: string): string {
  return `너는 "${personaName}" 전문 콘텐츠 아이디어 생성기야.
설명: ${personaDescription}

웹 검색을 활용하여 이 분야에서 흥미로운 영상 주제를 찾아서 시나리오 아이디어를 설계해.
매번 이전과 다른 새로운 아이디어를 발굴해야 한다.

## 임무
주제 카드를 정확히 4개 생성해. 카드마다 title·hook·marketingTactic·region 4개 필드.
(marketingTactic 필드에는 "핵심 포인트"를 짧게 적어)

## 핵심 규칙
1. 다양한 소재와 관점.
2. AI 영상 생성(VEO)으로 제작 가능한 시각적 이야기.
3. 혐오·폭력·정치 선동 금지.
4. 4개 카드가 모두 비슷한 주제이면 안 됨.

## 출력 필드 규칙
title (15~30자): 주제를 한 줄로
hook (20~40자): 관심 유발. 자연스러운 말투.
marketingTactic (10~20자): 핵심 포인트
region (5~15자): 배경/분야

JSON 배열로만 응답 (마크다운 없이):
[{"title":"...","hook":"...","marketingTactic":"...","region":"..."}]`;
}

function getPromptForPersona(personaId: string, personaName?: string, personaDescription?: string): string {
  switch (personaId) {
    case "history-marketing": return buildHistoryMarketingPrompt();
    case "shorts-scenario":   return buildWhatIfHistoryPrompt();
    case "vs-shorts":         return buildVsShortsPrompt();
    case "short-film":        return buildShortFilmPrompt();
    default:                  return buildGenericPrompt(personaName || "콘텐츠", personaDescription || "다양한 주제의 영상 시나리오");
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { personaId, personaName, personaDescription } =
      await context.request.json() as Record<string, string>;

    const basePrompt = getPromptForPersona(personaId || "history-marketing", personaName, personaDescription);

    // ── 다양성 시드: 매 요청마다 랜덤 제약조건을 주입하여 반복 방지 ──
    const diversitySeeds = {
      eras: ["고대(BC~5세기)", "중세(5~15세기)", "근세(15~18세기)", "근대(18~19세기)", "현대(20세기)", "냉전기(1945~1991)", "21세기"],
      regions: ["동남아시아", "중앙아시아", "북아프리카", "서아프리카", "동아프리카", "남미", "카리브해", "중동", "코카서스", "동유럽", "북유럽", "오세아니아", "인도 아대륙", "중국 변방", "일본", "한반도", "페르시아", "오스만 제국권"],
      angles: ["전쟁/군사 분기점", "과학/기술 분기점", "외교/조약 분기점", "경제/무역 분기점", "문화/종교 분기점", "자연재해/전염병 분기점", "암살/쿠데타 분기점", "탐험/발견 분기점", "혁명/민중봉기 분기점", "왕조 계승 분기점"],
    };
    const pickRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    const era = pickRandom(diversitySeeds.eras);
    const region = pickRandom(diversitySeeds.regions);
    const angle = pickRandom(diversitySeeds.angles);
    const diversitySuffix = `\n\n## 이번 요청의 다양성 시드 (반드시 반영)\n- 4개 카드 중 최소 1개는 "${era}" 시대를 다룰 것\n- 4개 카드 중 최소 1개는 "${region}" 지역을 다룰 것\n- 4개 카드 중 최소 1개는 "${angle}" 관점을 다룰 것\n- 이전에 자주 등장하는 뻔한 주제(로마 멸망, 히틀러 암살, 콜럼버스 항해 등)는 피하고 잘 알려지지 않은 역사적 갈림길을 우선 탐색할 것`;

    const prompt = basePrompt + diversitySuffix;

    console.info(`[suggest-prompts] persona=${personaId} promptLen=${prompt.length}`);

    // grounded 웹 검색: GEMINI_MODEL_SEARCH 사용
    // 실패 시 모델 지식 폴백
    let res = await fetchWithAuth(
      context.env,
      buildGeminiUrl(context.env, GEMINI_MODEL_SEARCH),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 1.0,
            topP: 0.95,
            maxOutputTokens: 1024,
            responseMimeType: "text/plain",
          },
        }),
      },
      { timeoutMs: 25_000 }, // Cloudflare edge 30s 제한 감안
    );

    // 실패 → 폴백 (grounding 없이)
    if (!res.ok) {
      const proStatus = res.status;
      console.warn(`[suggest-prompts] primary 실패 (${proStatus}) → 폴백`);
      const { response: fallbackRes } = await fetchWithModelFallback(context.env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 1.0,
            topP: 0.95,
            maxOutputTokens: 1024,
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
    }, { status: 500 });
  }
};
