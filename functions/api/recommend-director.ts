import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH, geminiErrorResponse, parseFirstJsonObject } from "./_gemini-keys";

type Env = GeminiEnv;

interface LocalDirectorInfo {
  id: string;
  name: string;
  nameKo: string;
  region: string;
  style: string;
}

// ═══════════════════════════════════════════════════════════════════
// Debug Types
// ═══════════════════════════════════════════════════════════════════

interface StageStatus {
  extractSignals: "ok" | "weak" | "failed";
  localMatch: "ok" | "empty" | "invalid_ids" | "filtered_out" | "failed";
  webSearch: "not_attempted" | "attempted_success" | "attempted_empty" | "failed";
  finalAssembly: "ok" | "empty" | "failed";
}

interface StageReasons {
  extractSignals?: string;
  localMatch?: string;
  webSearch?: string;
  finalAssembly?: string;
}

interface DirectorRecommendationDebug {
  stageStatus: StageStatus;
  stageReasons: StageReasons;
  extractedGenres: string[];
  extractedMoods: string[];
  extractedKeywords: string[];
  consideredLocalCount: number;
  consideredLocalIds: string[];
  validLocalCount: number;
  invalidIdsRemoved: string[];
  rejectedLocalIds: string[];
  localRejectionReasons: string[];
  attemptedWebSearch: boolean;
  webSearchProvider: string | null;
  webSearchQuery: string | null;
  webSearchResultCount: number;
  webSearchAcceptedCount: number;
  webSearchRejectedCount: number;
  webSearchRejectionReasons: string[];
  localResultCount: number;
  externalResultCount: number;
  finalResultCount: number;
  emptyReason?: string;
  modelUsed: string;
}

// ═══════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { storyText, localDirectors } = await context.request.json() as {
      storyText: string;
      localDirectors: LocalDirectorInfo[];
    };

    if (!storyText || typeof storyText !== "string") {
      return Response.json({ error: "storyText is required" }, { status: 400 });
    }

    const validLocalIds = new Set((localDirectors || []).map(d => d.id));
    const directorPoolSize = validLocalIds.size;

    // ── Debug state ──
    const stageStatus: StageStatus = {
      extractSignals: "failed",
      localMatch: "failed",
      webSearch: "not_attempted",
      finalAssembly: "failed",
    };
    const stageReasons: StageReasons = {};

    let extractedGenres: string[] = [];
    let extractedMoods: string[] = [];
    let extractedKeywords: string[] = [];
    let consideredLocalIds: string[] = [];
    let rejectedLocalIds: string[] = [];
    let localRejectionReasons: string[] = [];
    let invalidIdsRemoved: string[] = [];

    // Web search state
    let attemptedWebSearch = false;
    let webSearchProvider: string | null = null;
    let webSearchQuery: string | null = null;
    let webSearchResultCount = 0;
    let webSearchAcceptedCount = 0;
    let webSearchRejectedCount = 0;
    let webSearchRejectionReasons: string[] = [];

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Gemini 기반 로컬 매칭 (기존 로직)
    // ═══════════════════════════════════════════════════════════

    const localList = (localDirectors || [])
      .map((d) => `- id:"${d.id}" | ${d.nameKo} (${d.name}) | ${d.region} | ${d.style}`)
      .join("\n");

    const localPrompt = `당신은 영화 연출 전문가이자 AI 영상 감독 매칭 시스템입니다.

## 분석할 시나리오
${storyText.slice(0, 1200)}

## 보유 감독 목록 — 총 ${directorPoolSize}명
${localList}

## 임무
위 시나리오를 분석하고, 보유 감독 목록에서 가장 잘 어울리는 감독 1~3명을 추천하세요.

### 분석 결과 기록 (반드시 포함)
- extractedGenres: 장르 키워드 배열
- extractedMoods: 무드 키워드 배열
- extractedKeywords: 핵심 시각 키워드 배열

### 로컬 감독 매칭 규칙
- 반드시 목록에 있는 id만 사용 (새로 만들지 말 것)
- 각 감독에 fitScore(0-100)과 reason(한국어 2문장) 포함
- 목록에 어울리는 감독이 없어도 가장 가까운 1명을 fitScore 30 이상으로 포함
- 검토했지만 제외한 감독이 있으면 rejectedLocalIds와 rejectionReasons에 기록

## 출력 형식 (순수 JSON)
{
  "_pipeline": {
    "extractedGenres": [],
    "extractedMoods": [],
    "extractedKeywords": [],
    "consideredLocalCount": 0,
    "consideredLocalIds": [],
    "rejectedLocalIds": [],
    "rejectionReasons": []
  },
  "analysis": "시나리오 특성 요약 2~3줄 (한국어)",
  "localMatches": [
    { "id": "기존 감독 id", "fitScore": 0-100, "reason": "한국어 2문장" }
  ]
}`;

    const localRequestBody = {
      contents: [{ role: "user", parts: [{ text: localPrompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
        responseMimeType: "application/json" as const,
      },
    };

    console.log(`[recommend-director] STEP 1: 로컬 매칭 시작 (model=flash, pool=${directorPoolSize})`);

    let res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, GEMINI_MODEL_FLASH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(localRequestBody),
    });

    if (!res.ok) {
      const errText1 = await res.text();
      console.warn(`[recommend-director] FLASH 실패(${res.status}), PRO fallback. detail: ${errText1.slice(0, 300)}`);
      res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, GEMINI_MODEL_PRO), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localRequestBody),
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[recommend-director] 로컬 매칭 최종 실패: status=${res.status}`);
      stageStatus.localMatch = "failed";
      stageReasons.localMatch = `API 실패 (${res.status})`;
      return geminiErrorResponse(res, errText, "recommend-director");
    }

    const modelUsed = res.url?.includes("flash") ? "flash" : res.url?.includes("pro") ? "pro" : "unknown";

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = (parseFirstJsonObject(text) as Record<string, unknown>) ?? { localMatches: [] };
    }

    // ── Extract pipeline metadata ──
    const geminiPipeline = (parsed._pipeline ?? {}) as Record<string, unknown>;
    extractedGenres = Array.isArray(geminiPipeline.extractedGenres) ? geminiPipeline.extractedGenres as string[] : [];
    extractedMoods = Array.isArray(geminiPipeline.extractedMoods) ? geminiPipeline.extractedMoods as string[] : [];
    extractedKeywords = Array.isArray(geminiPipeline.extractedKeywords) ? geminiPipeline.extractedKeywords as string[] : [];
    consideredLocalIds = Array.isArray(geminiPipeline.consideredLocalIds) ? geminiPipeline.consideredLocalIds as string[] : [];
    rejectedLocalIds = Array.isArray(geminiPipeline.rejectedLocalIds) ? geminiPipeline.rejectedLocalIds as string[] : [];
    localRejectionReasons = Array.isArray(geminiPipeline.rejectionReasons) ? geminiPipeline.rejectionReasons as string[] : [];

    // Signal extraction status
    if (extractedGenres.length > 0 || extractedMoods.length > 0) {
      stageStatus.extractSignals = "ok";
      stageReasons.extractSignals = `genres=${extractedGenres.length}, moods=${extractedMoods.length}, keywords=${extractedKeywords.length}`;
    } else {
      stageStatus.extractSignals = "weak";
      stageReasons.extractSignals = "장르/무드 신호를 추출하지 못함";
    }

    // ── Validate local matches ──
    const rawLocalMatches = Array.isArray(parsed.localMatches) ? parsed.localMatches as Array<Record<string, unknown>> : [];
    invalidIdsRemoved = rawLocalMatches.filter(m => !validLocalIds.has(String(m.id))).map(m => String(m.id));
    let localMatches = rawLocalMatches.filter(m => validLocalIds.has(String(m.id)));

    // Clamp fitScore + ensure reason
    for (const m of localMatches) {
      if (typeof m.fitScore === "number") m.fitScore = Math.max(0, Math.min(100, Math.round(m.fitScore)));
      if (!m.reason || typeof m.reason !== "string") m.reason = "(이유 미제공)";
    }

    if (localMatches.length > 0) {
      stageStatus.localMatch = "ok";
      stageReasons.localMatch = `${localMatches.length}명 매칭 성공`;
    } else if (invalidIdsRemoved.length > 0) {
      stageStatus.localMatch = "invalid_ids";
      stageReasons.localMatch = `Gemini가 생성한 id ${invalidIdsRemoved.length}개가 목록에 없어 제거됨`;
    } else if (rawLocalMatches.length === 0) {
      stageStatus.localMatch = "empty";
      stageReasons.localMatch = "Gemini가 로컬 매치를 반환하지 않음";
    }

    if (invalidIdsRemoved.length > 0) {
      console.warn(`[recommend-director] 환각 id ${invalidIdsRemoved.length}개 제거: ${invalidIdsRemoved.join(", ")}`);
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: 웹 검색 기반 외부 감독 추천
    // ═══════════════════════════════════════════════════════════
    // 로컬 결과가 약하거나 (0~1명, fitScore < 60) 비었을 때 실행
    // Google AI의 googleSearchRetrieval tool을 사용해서 실제 검색

    let webSuggestions: Array<Record<string, unknown>> = [];
    const localWeak = localMatches.length === 0
      || (localMatches.length === 1 && (localMatches[0].fitScore as number) < 60);

    if (localWeak) {
      attemptedWebSearch = true;

      // 검색 쿼리 구성
      const genreStr = extractedGenres.slice(0, 3).join(" ");
      const moodStr = extractedMoods.slice(0, 2).join(" ");
      const keyStr = extractedKeywords.slice(0, 2).join(" ");
      webSearchQuery = `best film directors for ${genreStr} ${moodStr} ${keyStr} cinematography style`.trim();

      console.log(`[recommend-director] STEP 2: 웹 검색 시도 — query="${webSearchQuery}"`);

      try {
        // Gemini with googleSearchRetrieval tool — 실제 웹 검색
        const webSearchBody = {
          contents: [{ role: "user", parts: [{ text: `Based on web search results, recommend 2-3 real film/animation directors whose visual style best matches this scenario:

Scenario keywords: ${genreStr} ${moodStr} ${keyStr}
Scenario excerpt: ${storyText.slice(0, 400)}

For each director, provide:
- name (English)
- nameKo (Korean)
- region: one of 한국|일본|중국|유럽|미국|인도|중동|동남아|중남미|아프리카|오세아니아
- style: comma-separated Korean style keywords (max 5)
- description: 2-3 sentences in Korean about their visual directing style
- reason: 2 sentences in Korean why this director fits the scenario
- fitScore: 0-100
- signatureTechniques: { cameraWork, colorPalette, lighting, editingStyle, moodKeywords } all in English
- notableWorks: array of 3 representative works

Return as JSON: { "directors": [...] }
Only recommend real, existing directors. No fictional directors.` }] }],
          tools: [{ googleSearchRetrieval: {} }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 3072,
          },
        };

        webSearchProvider = "gemini-google-search-retrieval";

        const webRes = await fetchWithAuth(
          context.env,
          buildGeminiUrl(context.env, GEMINI_MODEL_PRO),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(webSearchBody),
          },
        );

        if (webRes.ok) {
          const webData = await webRes.json() as {
            candidates?: {
              content?: { parts?: { text?: string }[] };
              groundingMetadata?: {
                searchEntryPoint?: { renderedContent?: string };
                groundingChunks?: Array<{ web?: { uri: string; title: string } }>;
              };
            }[];
          };

          const webText = webData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

          // grounding metadata 확인 — 실제 검색이 이루어졌는지 증거
          const grounding = webData?.candidates?.[0]?.groundingMetadata;
          const groundingChunks = grounding?.groundingChunks ?? [];
          if (groundingChunks.length > 0) {
            console.log(`[recommend-director] 웹 검색 grounding 확인: ${groundingChunks.length}개 소스`);
            webSearchProvider = `gemini-google-search-retrieval (${groundingChunks.length} sources)`;
          }

          let webParsed: Record<string, unknown>;
          try {
            webParsed = JSON.parse(webText) as Record<string, unknown>;
          } catch {
            webParsed = (parseFirstJsonObject(webText) as Record<string, unknown>) ?? {};
          }

          const rawWebDirs = Array.isArray(webParsed.directors) ? webParsed.directors as Array<Record<string, unknown>> : [];
          webSearchResultCount = rawWebDirs.length;

          // 로컬 목록과 중복 제거 + slug id 생성
          const localNames = new Set((localDirectors || []).map(d => d.name.toLowerCase()));
          for (const d of rawWebDirs) {
            const name = String(d.name || "").toLowerCase();
            if (localNames.has(name)) {
              webSearchRejectedCount++;
              webSearchRejectionReasons.push(`"${d.name}" already in local pool`);
              continue;
            }
            if (!d.name || !d.nameKo) {
              webSearchRejectedCount++;
              webSearchRejectionReasons.push(`missing name/nameKo`);
              continue;
            }

            // Generate slug id
            const region = String(d.region || "미국");
            const regionSlug: Record<string, string> = {
              "한국": "kr", "일본": "jp", "중국": "cn", "유럽": "eu",
              "미국": "us", "인도": "in", "중동": "me", "동남아": "sea",
              "중남미": "la", "아프리카": "af", "오세아니아": "oc",
            };
            const rSlug = regionSlug[region] ?? "xx";
            const nameSlug = String(d.name).split(" ").pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "unknown";
            const webId = `web-${rSlug}-${nameSlug}`;

            // Clamp fitScore + ensure reason
            if (typeof d.fitScore === "number") d.fitScore = Math.max(0, Math.min(100, Math.round(d.fitScore)));
            if (!d.reason || typeof d.reason !== "string") d.reason = "(이유 미제공)";

            webSuggestions.push({ ...d, id: webId, _source: "web_search" });
            webSearchAcceptedCount++;
          }

          if (webSuggestions.length > 0) {
            stageStatus.webSearch = "attempted_success";
            stageReasons.webSearch = `검색 결과 ${webSearchResultCount}개 중 ${webSearchAcceptedCount}개 채택`;
          } else {
            stageStatus.webSearch = "attempted_empty";
            stageReasons.webSearch = webSearchResultCount > 0
              ? `검색 결과 ${webSearchResultCount}개 모두 로컬 중복 또는 불완전`
              : "검색 결과 없음";
          }
        } else {
          const webErr = await webRes.text();
          console.warn(`[recommend-director] 웹 검색 실패(${webRes.status}): ${webErr.slice(0, 300)}`);
          stageStatus.webSearch = "failed";
          stageReasons.webSearch = `API 실패 (${webRes.status})`;
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn(`[recommend-director] 웹 검색 예외: ${errMsg}`);
        stageStatus.webSearch = "failed";
        stageReasons.webSearch = `예외: ${errMsg.slice(0, 100)}`;
      }
    } else {
      stageStatus.webSearch = "not_attempted";
      stageReasons.webSearch = "로컬 결과 충분 — 웹 검색 불필요";
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Final Assembly
    // ═══════════════════════════════════════════════════════════

    const finalLocalCount = localMatches.length;
    const finalWebCount = webSuggestions.length;
    const finalCount = finalLocalCount + finalWebCount;

    let emptyReason: string | undefined;
    if (finalCount === 0) {
      if (stageStatus.extractSignals === "weak") {
        emptyReason = "genre_mood_not_detected";
      } else if (directorPoolSize === 0) {
        emptyReason = "empty_director_pool";
      } else if (stageStatus.localMatch === "invalid_ids") {
        emptyReason = "all_local_ids_hallucinated";
      } else if (stageStatus.webSearch === "attempted_empty") {
        emptyReason = "web_search_returned_empty";
      } else if (stageStatus.webSearch === "failed") {
        emptyReason = "web_search_failed_and_no_local";
      } else {
        emptyReason = "no_candidates_found";
      }
      stageStatus.finalAssembly = "empty";
      stageReasons.finalAssembly = emptyReason;
    } else {
      stageStatus.finalAssembly = "ok";
      stageReasons.finalAssembly = `local=${finalLocalCount}, web=${finalWebCount}`;
    }

    // ── Build debug payload ──
    const debug: DirectorRecommendationDebug = {
      stageStatus,
      stageReasons,
      extractedGenres,
      extractedMoods,
      extractedKeywords,
      consideredLocalCount: typeof geminiPipeline.consideredLocalCount === "number"
        ? geminiPipeline.consideredLocalCount as number : consideredLocalIds.length,
      consideredLocalIds,
      validLocalCount: finalLocalCount,
      invalidIdsRemoved,
      rejectedLocalIds,
      localRejectionReasons,
      attemptedWebSearch,
      webSearchProvider,
      webSearchQuery,
      webSearchResultCount,
      webSearchAcceptedCount,
      webSearchRejectedCount,
      webSearchRejectionReasons,
      localResultCount: finalLocalCount,
      externalResultCount: finalWebCount,
      finalResultCount: finalCount,
      emptyReason,
      modelUsed,
    };

    // ── Log pipeline ──
    console.log("[recommend-director] pipeline:", JSON.stringify({
      stages: stageStatus,
      local: finalLocalCount,
      web: finalWebCount,
      total: finalCount,
      emptyReason,
      webSearched: attemptedWebSearch,
    }));

    if (finalCount === 0) {
      console.warn(`[recommend-director] 빈 결과 — emptyReason=${emptyReason}, stages=${JSON.stringify(stageStatus)}`);
    }

    return Response.json({
      analysis: (parsed.analysis as string) ?? "",
      localMatches,
      webSuggestions,
      _meta: {
        modelUsed,
        invalidIdsRemoved: invalidIdsRemoved.length,
        directorPoolSize,
        storyLengthUsed: Math.min(storyText.length, 1200),
        attemptedWebSearch,
        webSearchProvider,
      },
      _debug: debug,
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
