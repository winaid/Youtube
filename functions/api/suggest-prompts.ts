import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { personaId, personaName, personaDescription } =
      await context.request.json() as Record<string, string>;

    const prompt = `너는 전 세계 역사 속 의사·의원·의료인들의 "마케팅·홍보·환자 유치 전략"을 연구하는 글로벌 의료사 마케팅 리서처야.
페르소나: "${personaName}" — ${personaDescription}

## 임무
주제 카드를 정확히 4개 생성해. 카드마다 title·hook·marketingTactic·region 4개 필드.

## 절대 원칙 (위반 시 해당 카드 무효)
1. 실존 인물 또는 실존 의료기관만. 지어낸 사례·인물 금지.
2. 의사·의원·의료인만. 약사·간호사·일반 사업가 금지.
3. "마케팅·홍보·브랜딩·환자 유치 전략"이 반드시 포함될 것.
   — "유명한 의사였다" 수준으로만 끝나면 탈락.
   — 어떤 수단(출판·공개 시연·강연·무료 진료·편지 캠페인·네트워크·기술 독점 등)을 썼는지 분명해야 함.
4. 사실 검증 가능성이 낮은 주제는 제외할 것.

## 지리적 다양성 (MANDATORY — 위반 시 전체 재생성)
- 4개 카드 중 최소 3개는 서로 다른 지역/문화권에서 나올 것.
- 미국/영국/서구권 카드는 최대 1개까지만 허용.
- 반드시 아래 지역을 적극 탐색할 것:
  한국, 중국, 일본, 인도, 중동(이슬람 황금기 포함), 동남아, 아프리카, 라틴아메리카, 중앙아시아, 고대 문명(이집트/메소포타미아/잉카 등)
- "흥미로운 사례"를 찾을 때 미국/영국/서구권을 기본값으로 두지 말 것.
- 비서구권 사례도 동등하게 탐색할 것.
- 서구권 사례만 나오는 결과는 품질 저하로 간주.

## 출력 필드 규칙

title (15~30자):
— "[실존 인물/기관] + [구체 홍보 수단] + [결과]" 형식 권장
— 좋은 예: "허준이 동의보감 한 권으로 조선 최고 의관이 된 브랜딩"
— 좋은 예: "이븐 시나의 의학정전이 600년간 유럽 교과서가 된 방법"
— 나쁜 예: "여성 의사가 활약한 역사" (인물·수단 없음)

hook (20~40자):
— 현대 공감 상황 또는 "이게 실제 역사라고?"라는 반응 유발
— MZ세대 말투 ("~있음", "~임", "~임ㅋㅋ", "~봤지?")
— 좋은 예: "천민 출신이 왕의 주치의가 된 방법? 책 한 권 썼음. 근데 그게 유네스코 세계기록유산이 됨"

marketingTactic (10~20자):
— 이 사례의 핵심 홍보 수단 한 줄
— 예: "의학서 출판→국가 공인 권위", "공개 수술 시연→전국 명성"

region (5~15자):
— 이 사례의 지역/문화권
— 예: "한국 (조선)", "중동 (이슬람 황금기)", "인도 (고대)", "일본 (에도)", "아프리카 (우간다)"

## 절대 금지
- 지어낸 인물·사례
- 단순 업적 소개 (마케팅 요소 없는 카드)
- 의사 외 직업
- 모호하고 검증 어려운 주제
- 4개 중 2개 이상이 같은 지역/문화권 (지리적 다양성 위반)

JSON 배열로만 응답 (마크다운 없이):
[{"title":"...","hook":"...","marketingTactic":"...","region":"..."}]

좋은 카드 예시 (4개 = 4개 다른 지역):
{"title":"허준이 동의보감으로 조선 최고 의관이 된 전략","hook":"천민 출신이 왕의 주치의가 된 방법? 책 한 권 썼음ㅋㅋ","marketingTactic":"의학서 출판→국가 공인 권위","region":"한국 (조선)"}
{"title":"이븐 시나의 의학정전이 600년 유럽 교과서가 된 방법","hook":"중동 의사가 쓴 책이 유럽 의대 교과서로 600년 쓰인 이야기임","marketingTactic":"백과사전형 의학서→글로벌 권위","region":"중동 (페르시아)"}
{"title":"하나오카 세이슈가 유럽보다 40년 앞서 전신마취를 성공한 방법","hook":"세계 최초 전신마취가 유럽이 아니라 일본에서 나왔다고?","marketingTactic":"세계 최초 마취 수술→전국 제자 유입","region":"일본 (에도)"}
{"title":"크리스티안 바나드가 남아공에서 세계 최초 심장이식을 성공한 방법","hook":"세계 최초 심장이식이 미국도 유럽도 아닌 남아공에서 나옴","marketingTactic":"세계 최초 수술→글로벌 언론 노출","region":"남아공"}`;

    const res = await fetchWithAuth(context.env, buildVertexUrl(context.env, "gemini-3.1-pro-preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 800,
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
      cards = [];
    }

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
