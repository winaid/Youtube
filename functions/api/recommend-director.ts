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

## 현재 보유 감독 목록 (로컬) — 총 ${(localDirectors || []).length}명
${localList}

---

## 임무
위 시나리오를 분석하여 가장 잘 어울리는 감독을 추천하세요.

### STEP 1: 시나리오 분석 (반드시 _pipeline에 기록)
- 장르, 무드, 시각적 특성 파악
- 핵심 시각 요소 (역사적 배경, 색감, 규모, 분위기 등)
- 추출한 장르, 무드, 키워드를 _pipeline 필드에 반드시 기록

### STEP 2: 로컬 감독 매칭
- 위 보유 감독 목록에서 최소 1명, 최대 3명을 fitScore(0-100) 순으로 선별
- 반드시 1명 이상은 추천해야 함 (가장 가까운 감독이라도 선택)
- 각 감독이 이 시나리오와 어울리는 구체적 이유 (시각적 기법 위주로)
- reason은 반드시 시나리오의 구체적 요소(장르, 배경, 감정)와 감독의 기법을 연결하는 2문장
- id는 반드시 위 보유 감독 목록에 있는 id만 사용 (새로 만들지 말 것)
- 만약 목록에서 어울리는 감독을 찾기 어렵더라도, 가장 가까운 1명을 fitScore 30 이상으로 반드시 포함

### STEP 3: 웹 추천 감독 (로컬에 없는 감독)
- 보유 목록에 없지만 이 시나리오에 더 완벽히 어울리는 실제 감독 1~2명 추천
- 반드시 1명 이상 추천해야 함
- 실존하는 감독만 추천 (허구 감독 절대 금지)
- 로컬 목록에 있는 감독과 중복 금지
- 각각 signatureTechniques 포함
- reason은 반드시 시나리오의 구체적 요소와 감독의 대표 기법을 연결하는 2문장

## 출력 형식 (순수 JSON만, 마크다운 펜스 없이)

{
  "_pipeline": {
    "extractedGenres": ["장르1", "장르2"],
    "extractedMoods": ["무드1", "무드2"],
    "extractedKeywords": ["키워드1", "키워드2", "키워드3"],
    "consideredLocalCount": 0,
    "consideredLocalIds": ["검토한 감독 id들"],
    "rejectedLocalIds": ["fitScore가 너무 낮아 제외한 감독 id들"],
    "rejectionReasons": ["제외 이유 간단 설명"]
  },
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
}

중요: _pipeline 필드를 반드시 포함해야 합니다. 이 필드가 없으면 응답이 무효 처리됩니다.
중요: localMatches는 반드시 1개 이상, webSuggestions도 반드시 1개 이상이어야 합니다. 빈 배열은 허용하지 않습니다.`;

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

    // ── Pipeline stage tracking ──
    const validLocalIds = new Set((localDirectors || []).map(d => d.id));
    const directorPoolSize = validLocalIds.size;

    // Stage 0: Extract Gemini's pipeline metadata
    const geminiPipeline = parsed._pipeline ?? {};
    const extractedGenres: string[] = Array.isArray(geminiPipeline.extractedGenres) ? geminiPipeline.extractedGenres : [];
    const extractedMoods: string[] = Array.isArray(geminiPipeline.extractedMoods) ? geminiPipeline.extractedMoods : [];
    const extractedKeywords: string[] = Array.isArray(geminiPipeline.extractedKeywords) ? geminiPipeline.extractedKeywords : [];
    const consideredLocalCount: number = typeof geminiPipeline.consideredLocalCount === "number" ? geminiPipeline.consideredLocalCount : -1;
    const consideredLocalIds: string[] = Array.isArray(geminiPipeline.consideredLocalIds) ? geminiPipeline.consideredLocalIds : [];
    const rejectedLocalIds: string[] = Array.isArray(geminiPipeline.rejectedLocalIds) ? geminiPipeline.rejectedLocalIds : [];
    const rejectionReasons: string[] = Array.isArray(geminiPipeline.rejectionReasons) ? geminiPipeline.rejectionReasons : [];

    // Stage 1: Raw Gemini output counts
    const rawLocalMatches = Array.isArray(parsed.localMatches) ? parsed.localMatches : [];
    const rawWebSuggestions = Array.isArray(parsed.webSuggestions) ? parsed.webSuggestions : [];
    const geminiLocalCount = rawLocalMatches.length;
    const geminiWebCount = rawWebSuggestions.length;

    // Stage 2: Filter hallucinated localMatch ids
    const invalidIds = rawLocalMatches.filter((m: { id: string }) => !validLocalIds.has(m.id)).map((m: { id: string }) => m.id);
    let localMatches = rawLocalMatches.filter((m: { id: string }) => validLocalIds.has(m.id));
    const afterIdValidationLocal = localMatches.length;

    // Stage 3: Clamp fitScore to 0-100
    for (const m of localMatches) {
      if (typeof m.fitScore === "number") m.fitScore = Math.max(0, Math.min(100, Math.round(m.fitScore)));
    }
    const webSuggestions = [...rawWebSuggestions];
    for (const s of webSuggestions) {
      if (typeof s.fitScore === "number") s.fitScore = Math.max(0, Math.min(100, Math.round(s.fitScore)));
    }

    // Stage 4: Ensure reason is non-empty
    for (const m of localMatches) {
      if (!m.reason || typeof m.reason !== "string") m.reason = "(이유 미제공)";
    }
    for (const s of webSuggestions) {
      if (!s.reason || typeof s.reason !== "string") s.reason = "(이유 미제공)";
    }

    // Stage 5: Final counts
    const finalLocalCount = localMatches.length;
    const finalWebCount = webSuggestions.length;
    const finalCount = finalLocalCount + finalWebCount;

    // ── Build emptyReason (when result is 0) ──
    let emptyReason: string | null = null;
    if (finalCount === 0) {
      if (geminiLocalCount === 0 && geminiWebCount === 0) {
        // Gemini itself returned nothing
        if (extractedGenres.length === 0 && extractedMoods.length === 0) {
          emptyReason = "genre_mood_not_detected";
        } else if (directorPoolSize === 0) {
          emptyReason = "empty_director_pool";
        } else if (consideredLocalCount === 0) {
          emptyReason = "no_local_candidates_considered";
        } else {
          emptyReason = "gemini_returned_empty";
        }
      } else if (geminiLocalCount > 0 && afterIdValidationLocal === 0) {
        emptyReason = "all_local_ids_hallucinated";
      } else {
        emptyReason = "post_validation_eliminated_all";
      }
    }

    // ── Log pipeline diagnostics ──
    const pipelineSummary = {
      inputStoryLength: Math.min(storyText.length, 1200),
      directorPoolSize,
      extractedGenres,
      extractedMoods,
      extractedKeywords,
      consideredLocalCount,
      geminiLocalCount,
      geminiWebCount,
      invalidIdsRemoved: invalidIds.length,
      invalidIds: invalidIds.length > 0 ? invalidIds : undefined,
      afterIdValidationLocal,
      finalLocalCount,
      finalWebCount,
      finalCount,
      emptyReason,
    };

    console.log("[recommend-director] pipeline:", JSON.stringify(pipelineSummary));
    if (invalidIds.length > 0) {
      console.warn(`[recommend-director] 환각 id ${invalidIds.length}개 제거: ${invalidIds.join(", ")}`);
    }
    if (finalCount === 0) {
      console.warn(`[recommend-director] 빈 결과 — emptyReason=${emptyReason}`);
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
        directorPoolSize,
        storyLengthUsed: Math.min(storyText.length, 1200),
      },
      _debug: {
        ...pipelineSummary,
        rejectedLocalIds,
        rejectionReasons,
        consideredLocalIds,
        modelUsed,
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
