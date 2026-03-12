import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_PRO } from "./_gemini-keys";

type Env = GeminiEnv;

interface LocalDirectorInfo {
  id: string;
  name: string;
  nameKo: string;
  region: string;
  style: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { storyText, localDirectors } = await context.request.json() as {
      storyText: string;
      localDirectors: LocalDirectorInfo[];
    };

    if (!storyText || typeof storyText !== "string") {
      return Response.json({ error: "storyText is required" }, { status: 400 });
    }

    const localList = (localDirectors || [])
      .map((d) => `- id:"${d.id}" | ${d.nameKo} (${d.name}) | ${d.region} | ${d.style}`)
      .join("\n");

    const prompt = `당신은 세계 최고의 영화 연출 전문가이자 AI 영상 감독 매칭 시스템입니다.

## 분석할 시나리오
${storyText.slice(0, 2000)}

## 현재 보유 감독 목록 (로컬)
${localList}

---

## 임무
위 시나리오를 분석하여 가장 잘 어울리는 감독을 추천하세요.

### STEP 1: 시나리오 분석
- 장르, 무드, 시각적 특성 파악
- 핵심 시각 요소 (역사적 배경, 색감, 규모, 분위기 등)

### STEP 2: 로컬 감독 매칭
- 위 보유 감독 목록에서 최대 3명을 fitScore(0-100) 순으로 선별
- 각 감독이 이 시나리오와 어울리는 구체적 이유 (시각적 기법 위주로)

### STEP 3: 웹 추천 감독 (로컬에 없는 감독)
- 보유 목록에 없지만 이 시나리오에 더 완벽히 어울리는 실제 감독 1~2명 추천
- Google Search 지식 기반으로 실존하는 감독만 추천
- 로컬 목록에 있는 감독과 중복 금지
- 각각 signatureTechniques 포함

## 출력 형식 (순수 JSON만, 마크다운 펜스 없이)

{
  "analysis": "시나리오 특성 요약 2~3줄 (한국어)",
  "localMatches": [
    {
      "id": "기존 감독 id (위 목록의 id 그대로)",
      "fitScore": 0-100,
      "reason": "이 시나리오와 잘 맞는 구체적 이유 1~2문장 (한국어)"
    }
  ],
  "webSuggestions": [
    {
      "id": "region-lastname 슬러그 (예: eu-tarr, jp-miike)",
      "name": "영어 이름",
      "nameKo": "한국어 이름",
      "region": "한국|일본|중국|유럽|미국|인도|중동|동남아|중남미|아프리카|오세아니아 중 하나",
      "style": "쉼표 구분 스타일 키워드 (한국어, 최대 5개)",
      "description": "연출 스타일 설명 2~3문장 (한국어)",
      "reason": "이 시나리오와 잘 맞는 구체적 이유 1~2문장 (한국어)",
      "fitScore": 0-100,
      "signatureTechniques": {
        "cameraWork": "영어",
        "colorPalette": "영어",
        "lighting": "영어",
        "editingStyle": "영어",
        "moodKeywords": "영어"
      },
      "notableWorks": ["대표작1", "대표작2", "대표작3"]
    }
  ]
}`;

    const res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, GEMINI_MODEL_PRO), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return Response.json({ error: `Gemini API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { localMatches: [], webSuggestions: [] };
    }

    return Response.json({
      analysis: parsed.analysis ?? "",
      localMatches: Array.isArray(parsed.localMatches) ? parsed.localMatches : [],
      webSuggestions: Array.isArray(parsed.webSuggestions) ? parsed.webSuggestions : [],
    });
  } catch (error) {
    console.error("Director recommendation error:", error);
    return Response.json({ error: "Failed to recommend directors" }, { status: 500 });
  }
};
