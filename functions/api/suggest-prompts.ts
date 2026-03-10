import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { personaId, personaName, personaDescription } =
      await context.request.json() as Record<string, string>;

    const prompt = `너는 역사 속 의사·의원·의료인들의 "마케팅·홍보·환자 유치 전략"을 연구하는 의료사 마케팅 리서처야.
페르소나: "${personaName}" — ${personaDescription}

## 임무
주제 카드를 정확히 4개 생성해. 카드마다 title·hook·marketingTactic 3개 필드.

## 절대 원칙 (위반 시 해당 카드 무효)
1. 실존 인물 또는 실존 의료기관만. 지어낸 사례·인물 금지.
2. 의사·의원·의료인만. 약사·간호사·일반 사업가 금지.
3. "마케팅·홍보·브랜딩·환자 유치 전략"이 반드시 포함될 것.
   — "유명한 의사였다" 수준으로만 끝나면 탈락.
   — 어떤 수단(신문 광고·간판·강연·무료 진료·편지 캠페인·네트워크 등)을 썼는지 분명해야 함.
4. 아래 우선 대상에서 선택:
   a) 여성 의사가 성별 장벽을 뚫기 위해 쓴 홍보 전략
   b) 서구 사회에서 활동한 동양인·이민자 의사의 민족 커뮤니티 대상 홍보 방식
   c) 인종·젠더·계급 차별로 일반 방식을 쓸 수 없어서 독특한 전략을 쓴 의사
5. 사실 검증 가능성이 낮은 주제는 제외할 것.

## 출력 필드 규칙

title (15~30자):
— "[실존 인물/기관] + [구체 홍보 수단] + [결과]" 형식 권장
— 좋은 예: "엘리자베스 블랙웰이 '여성 전용 병원'으로 뉴욕 환자를 모은 전략"
— 나쁜 예: "여성 의사가 활약한 역사" (인물·수단 없음)
— 나쁜 예: "의원이 환자 모은 비결" (추상적, 인물 없음)

hook (20~40자):
— 현대 공감 상황 또는 "이게 실제 역사라고?"라는 반응 유발
— MZ세대 말투 ("~있음", "~임", "~임ㅋㅋ", "~봤지?")
— 좋은 예: "19세기에도 '남자 의사한테 몸 보이기 싫어'는 있었음. 그래서 이 의사는 그걸 사업 모델로 만들었음"
— 나쁜 예: "병원 가면 항상 사람 없는 곳 있잖아" (역사 접점 없음)

marketingTactic (10~20자):
— 이 사례의 핵심 홍보 수단 한 줄
— 예: "여성 전용 병원 포지셔닝", "법적 개명으로 광고 제한 우회", "편지→신문 게재→후원자 모집"

## 절대 금지
- 지어낸 인물·사례
- 단순 업적 소개 (마케팅 요소 없는 카드)
- 의사 외 직업
- 모호하고 검증 어려운 주제

JSON 배열로만 응답 (마크다운 없이):
[{"title":"...","hook":"...","marketingTactic":"..."}]

좋은 카드 예시:
{"title":"'페인리스 파커'가 법적으로 이름 바꿔 광고 규제를 뚫은 방법","hook":"광고에 '무통' 못 쓰게 법으로 막자 아예 본명을 '페인리스'로 바꾼 치과 의사 실화임ㅋㅋ","marketingTactic":"법적 개명으로 광고 제한 우회"}
{"title":"아난디바이 조시가 미국 오기 전 편지로 후원자를 모은 캠페인","hook":"인도에서 보낸 편지 한 통이 미국 신문에 실려서 도착 전에 팬레터가 쌓인 이야기","marketingTactic":"편지→미국 신문 게재→대중 후원 모집"}`;

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

    let cards: { title: string; hook: string; marketingTactic?: string }[];
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
