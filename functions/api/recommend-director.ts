import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH, geminiErrorResponse, parseFirstJsonObject } from "./_gemini-keys";

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
${storyText.slice(0, 1200)}

## 현재 보유 감독 목록 (로컬)
${localList}

---

## 임무
위 시나리오를 분석하여 가장 잘 어울리는 감독을 추천하세요.

### STEP 1: 시나리오 분석
- 장르, 무드, 시각적 특성 파악
- 핵심 시각 요소 (역사적 배경, 색감, 규모, 분위기 등)

### STEP 2: 로컬 감독 매칭
- 위 보유 감독 목록에서 최소 1명, 최대 3명을 fitScore(0-100) 순으로 선별
- 반드시 1명 이상은 추천해야 함 (가장 가까운 감독이라도 선택)
- 각 감독이 이 시나리오와 어울리는 구체적 이유 (시각적 기법 위주로)
- reason은 반드시 시나리오의 구체적 요소(장르, 배경, 감정)와 감독의 기법을 연결하는 2문장
- id는 반드시 위 보유 감독 목록에 있는 id만 사용 (새로 만들지 말 것)

### STEP 3: 웹 추천 감독 (로컬에 없는 감독)
- 보유 목록에 없지만 이 시나리오에 더 완벽히 어울리는 실제 감독 1~2명 추천
- 반드시 1명 이상 추천해야 함
- 실존하는 감독만 추천 (허구 감독 절대 금지)
- 로컬 목록에 있는 감독과 중복 금지
- 각각 signatureTechniques 포함
- reason은 반드시 시나리오의 구체적 요소와 감독의 대표 기법을 연결하는 2문장

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

    // ── 감독 추천은 경량 태스크 → Flash 우선, 실패 시 PRO fallback ──
    // 시나리오 분석 + 매칭은 간단한 추론이므로 Flash로 충분하고 3-5배 빠름.

    const requestBody = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
        responseMimeType: "application/json" as const,
      },
    };

    // 1차 시도: FLASH (빠른 응답 우선)
    console.log(`[recommend-director] 1차 시도: model=${GEMINI_MODEL_FLASH}, tools=none`);
    let res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, GEMINI_MODEL_FLASH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    // 1차 실패 시 PRO fallback (품질은 높지만 느림)
    if (!res.ok) {
      const errText1 = await res.text();
      console.warn(`[recommend-director] FLASH 실패(${res.status}), PRO fallback. detail: ${errText1.slice(0, 300)}`);
      res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, GEMINI_MODEL_PRO), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[recommend-director] 최종 실패: status=${res.status}, detail=${errText.slice(0, 500)}`);
      return geminiErrorResponse(res, errText, "recommend-director");
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Gemini sometimes appends trailing text after the JSON object.
      // Extract the first balanced top-level {} to avoid parse errors.
      parsed = parseFirstJsonObject(text) ?? { localMatches: [], webSuggestions: [] };
    }

    // ── Post-parse validation & quality enforcement ──
    const validLocalIds = new Set((localDirectors || []).map(d => d.id));
    let localMatches = Array.isArray(parsed.localMatches) ? parsed.localMatches : [];
    const webSuggestions = Array.isArray(parsed.webSuggestions) ? parsed.webSuggestions : [];

    // Filter out hallucinated localMatch ids (id must exist in provided list)
    const invalidIds = localMatches.filter((m: { id: string }) => !validLocalIds.has(m.id)).map((m: { id: string }) => m.id);
    localMatches = localMatches.filter((m: { id: string }) => validLocalIds.has(m.id));

    // Clamp fitScore to 0-100
    for (const m of localMatches) {
      if (typeof m.fitScore === "number") m.fitScore = Math.max(0, Math.min(100, Math.round(m.fitScore)));
    }
    for (const s of webSuggestions) {
      if (typeof s.fitScore === "number") s.fitScore = Math.max(0, Math.min(100, Math.round(s.fitScore)));
    }

    // Ensure reason is non-empty
    for (const m of localMatches) {
      if (!m.reason || typeof m.reason !== "string") m.reason = "(이유 미제공)";
    }
    for (const s of webSuggestions) {
      if (!s.reason || typeof s.reason !== "string") s.reason = "(이유 미제공)";
    }

    // Log quality diagnostics
    if (invalidIds.length > 0) {
      console.warn(`[recommend-director] 환각 id ${invalidIds.length}개 제거: ${invalidIds.join(", ")}`);
    }
    if (localMatches.length === 0 && webSuggestions.length === 0) {
      console.warn("[recommend-director] 빈 결과 반환됨 — prompt 강화 또는 시나리오 길이 확인 필요");
    }

    // Determine which model ultimately succeeded
    const modelUsed = res.url?.includes("flash") ? "flash"
      : res.url?.includes("pro") ? "pro"
      : "unknown";

    return Response.json({
      analysis: parsed.analysis ?? "",
      localMatches,
      webSuggestions,
      _meta: {
        modelUsed,
        invalidIdsRemoved: invalidIds.length,
        directorPoolSize: validLocalIds.size,
        storyLengthUsed: Math.min(storyText.length, 1200),
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[recommend-director] 예외:", errMsg);
    return Response.json({
      error: `[recommend-director] ${errMsg}`,
      code: "INTERNAL_ERROR",
      help: "서버 로그와 브라우저 콘솔을 확인하세요.",
      detail: errMsg.slice(0, 500),
    }, { status: 500 });
  }
};
