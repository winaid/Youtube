import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_PRO, geminiErrorResponse } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { personaId, personaName, personaDescription } =
      await context.request.json() as Record<string, string>;

    const prompt = `너는 전 세계 역사 속 병의원·의사·의료인들이 **환자를 모으고 병원을 알리기 위해 사용한 실제 마케팅·홍보·브랜딩 전략**만 연구하는 "병의원 마케팅 사례 리서처"야.
페르소나: "${personaName}" — ${personaDescription}

## 임무
주제 카드를 정확히 4개 생성해. 카드마다 title·hook·marketingTactic·region 4개 필드.

## ★ 사전 필터링 질문 (카드 생성 전 반드시 자문)
각 카드를 생성하기 전에 반드시 아래 질문에 "예"라고 대답할 수 있어야 한다:
→ "이 사례에 병원/의원/치과/약방을 알리거나 환자를 끌어모으기 위한 실제 마케팅/홍보/브랜딩/입소문 전략이 있는가?"
"아니오"라면 해당 카드는 절대 포함하지 말 것.

## 필수 포함 조건 (최소 1개 이상 해당해야 함)
추천 주제는 반드시 아래 중 하나 이상을 포함해야 한다:
- 병원/의원/치과/약방의 실제 광고 방식 (신문 광고, 간판, 전단지, 현수막 등)
- 환자 유치 전략 (무료 진료, 무료 강연, 공개 시연, 체험 행사)
- 병원 위치/공간 배치/체험 설계 (입지 선정, 진료 환경 디자인)
- 입소문/추천 전략 (커뮤니티 네트워크, 종교 단체 연계, 동향회)
- 특정 환자층 타겟팅 (여성 전용, 소수민족 전용, 빈민층 전용 등)
- 브랜드/슬로건/메시지 전략 (개명, 출판, 차별화 포지셔닝)
- 공개 시연/퍼포먼스 마케팅 (길거리 시술, 공개 수술, 공개 강연)
- 감각 마케팅 (음악, 밴드, 시각 퍼포먼스)
- 퍼포먼스 마케팅 (언론 노출, 기자 초청, PR 전략)

## 반드시 제외할 것 (위반 시 카드 무효)
아래는 병의원 마케팅과 직접 연결되지 않으면 제외:
- ❌ 의대 입학/졸업 이야기 (마케팅 아님)
- ❌ 개인적 성공 서사 (차별 극복, 최초 여성 의사 등 — 마케팅 전략 아니면 제외)
- ❌ 여성/소수자/이민자 의료인의 삶 일반 (직접적 환자 유치 전략이 아니면 제외)
- ❌ 의학적 업적 자체 (혈액 순환 발견, 천연두 구분, 마취 발명 등 — 그 업적을 환자 유치에 활용한 마케팅이 없으면 제외)
- ❌ 치료법/수술법 개발 자체 (환자 모집 전략 없이 업적만 소개)
- ❌ 단순 전기/선구자 서사 ("최초로 ~한 의사"만으로는 부족)
- ❌ 면허 투쟁/법 개정 운동 (의료 접근권 활동은 마케팅이 아님)
- ❌ 독립운동/정치 활동 (의사 신분이지만 마케팅과 무관)
- ❌ 의료 역사 일반 (마케팅 전략 없이 역사만 나열)

## 절대 원칙
1. 실존 인물 또는 실존 의료기관만. 지어낸 사례·인물 금지.
2. 의사·의원·의료인만. 약사·간호사·일반 사업가 금지.
3. **마케팅·홍보·브랜딩·환자 유치 전략이 카드의 핵심이어야 함.**
   — "유명한 의사였다", "최초로 ~했다" 수준이면 탈락.
   — 어떤 수단(광고·간판·공개 시연·무료 진료·출판·네트워크·공간 설계·타겟 포지셔닝 등)을 썼는지 구체적이어야 함.
4. 사실 검증 가능성이 낮은 주제는 제외할 것.

## 지리적 다양성 (MANDATORY — 위반 시 전체 재생성)
- 4개 카드 중 최소 3개는 서로 다른 지역/문화권에서 나올 것.
- 미국/영국/서구권 카드는 최대 1개까지만 허용.
- 반드시 아래 지역을 적극 탐색할 것:
  한국, 중국, 일본, 인도, 중동(이슬람 황금기 포함), 동남아, 아프리카, 라틴아메리카
- 비서구권 사례도 동등하게 탐색할 것.

## 출력 필드 규칙

title (15~30자):
— "[실존 인물/기관] + [구체 마케팅 수단] + [환자 유치 결과]" 형식 권장
— 좋은 예: "허준이 동의보감 출판으로 조선 최고 의관이 된 브랜딩 전략"
— 좋은 예: "페인리스 파커가 법적 개명으로 치과 광고 규제를 뚫은 방법"
— 나쁜 예: "이븐 시나의 의학정전이 600년간 유럽 교과서가 된 방법" (의학 업적이지 환자 유치 아님)
— 나쁜 예: "여성 의사가 활약한 역사" (인물·수단 없음)

hook (20~40자):
— 현대 공감 상황 또는 "이게 실제 역사라고?"라는 반응 유발
— MZ세대 말투 ("~있음", "~임", "~임ㅋㅋ", "~봤지?")
— 좋은 예: "광고에 '무통' 못 쓰게 막자 아예 본명을 '페인리스'로 바꾼 치과 의사ㅋㅋ"

marketingTactic (10~20자):
— 이 사례의 핵심 **환자 유치 수단** 한 줄
— 예: "법적 개명으로 광고 제한 우회", "여성 전용 병원 포지셔닝", "무료 진료→커뮤니티 신뢰"

region (5~15자):
— 이 사례의 지역/문화권
— 예: "한국 (조선)", "중동 (이슬람 황금기)", "일본 (에도)", "미국 (1890s)"

## 절대 금지 (재확인)
- 지어낸 인물·사례
- 단순 업적 소개 (마케팅/환자 유치 요소 없는 카드)
- 의사 외 직업
- 모호하고 검증 어려운 주제
- 4개 중 2개 이상이 같은 지역/문화권

JSON 배열로만 응답 (마크다운 없이):
[{"title":"...","hook":"...","marketingTactic":"...","region":"..."}]

좋은 카드 예시 (4개 = 4개 다른 지역, 전부 환자 유치 전략이 핵심):
{"title":"허준이 동의보감 출판으로 조선 최고 의관이 된 브랜딩","hook":"천민 출신이 왕의 주치의가 된 방법? 책 한 권 썼음ㅋㅋ 근데 그게 유네스코 세계기록유산이 됨","marketingTactic":"의학서 출판→국가 공인 권위","region":"한국 (조선)"}
{"title":"페인리스 파커가 개명+거리 쇼로 미국 최대 치과를 만든 방법","hook":"광고에 '무통' 못 쓰게 막자 아예 본명을 '페인리스'로 바꾼 치과 의사ㅋㅋ","marketingTactic":"법적 개명+거리 퍼포먼스→광고 규제 우회","region":"미국 (1890s)"}
{"title":"화타가 공개 수술 시연으로 후한 전역에서 환자를 끌어모은 방법","hook":"마취약 만들어서 배 가르는 수술을 공개로 한 의사. 1800년 전 이야기임","marketingTactic":"공개 수술 시연+마취 기술 독점→명의 브랜딩","region":"중국 (후한)"}
{"title":"손사막이 무료 진료로 '약왕' 칭호를 얻은 당나라 신뢰 마케팅","hook":"황제가 불러도 안 가고 산에서 무료 진료만 한 의사. 결과? 민간 최고 신뢰 브랜드","marketingTactic":"무료 진료+권력 거부→민간 신뢰 극대화","region":"중국 (당나라)"}

나쁜 카드 예시 (이런 건 절대 만들지 말 것):
❌ {"title":"이븐 시나의 의학정전이 600년 유럽 교과서가 된 방법"} → 의학 업적이지 환자 유치 전략 아님
❌ {"title":"카를로스 핀레이가 황열병 모기 매개 이론을 20년 주장한 이야기"} → 학술 업적, 마케팅 아님
❌ {"title":"호세 리잘이 안과 의사이자 독립운동가로 영웅이 된 방법"} → 독립운동, 환자 유치 아님
❌ {"title":"메리 퍼트넘 자코비가 논문으로 성차별을 뚫은 방법"} → 학술 커리어, 마케팅 아님`;

    console.info(`[suggest-prompts] model=${GEMINI_MODEL_PRO} promptLen=${prompt.length} maxOutputTokens=2048`);

    const res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, GEMINI_MODEL_PRO), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return geminiErrorResponse(res, errText, "suggest-prompts");
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    };

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "[]";
    const finishReason = data?.candidates?.[0]?.finishReason;
    const truncated = finishReason === "MAX_TOKENS";

    console.info(`[suggest-prompts] responseLen=${text.length} finishReason=${finishReason ?? "unknown"} truncated=${truncated}`);

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
        try {
          const bracketMatch = text.match(/\[[\s\S]*\]/);
          if (bracketMatch) {
            const partialParsed = JSON.parse(bracketMatch[0]);
            cards = Array.isArray(partialParsed) ? partialParsed.filter((c: unknown) =>
              typeof c === "object" && c !== null && "title" in c && "hook" in c
            ) : [];
          } else {
            cards = [];
          }
        } catch {
          cards = [];
        }
      } else {
        cards = [];
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
