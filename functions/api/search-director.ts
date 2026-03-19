import { GeminiEnv, fetchWithModelFallback, geminiErrorResponse, parseFirstJsonObject } from "./_gemini-keys";
import {
  generateSlugId,
  extractGroundingSources,
  computeGroundingQuality,
  isSameDirector,
  clampFitScore,
  ensureReason,
  type GroundingSource,
  type GroundingQuality,
} from "./_director-shared";

type Env = GeminiEnv;

// ═══════════════════════════════════════════════════════════════════
// Response Types
// ═══════════════════════════════════════════════════════════════════

interface DirectorSearchResult {
  id: string;
  name: string;
  nameKo: string;
  region: string;
  style: string;
  description: string;
  matchedBy: string;
  signatureTechniques?: {
    cameraWork?: string;
    colorPalette?: string;
    lighting?: string;
    editingStyle?: string;
    moodKeywords?: string;
  };
  notableWorks?: string[];
  sources?: GroundingSource[];
  grounded: boolean;
  groundingQuality?: GroundingQuality;
}

interface SearchDirectorResponse {
  success: boolean;
  query: string;
  mode: "web" | "model" | "hybrid";
  directors: DirectorSearchResult[];
  warnings?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Handler
// ═══════════════════════════════════════════════════════════════════

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { query } = await context.request.json() as Record<string, string>;
    if (!query || typeof query !== "string") {
      return Response.json({ error: "query is required", success: false, directors: [] }, { status: 400 });
    }

    // 너무 짧은 쿼리 경고
    const warnings: string[] = [];
    if (query.trim().length < 2) {
      warnings.push("검색어가 너무 짧습니다. 더 구체적인 검색어를 사용해보세요.");
    }

    // ── Step 1: Gemini + google_search (실제 웹 검색) ──
    const webSearchPrompt = `You are a world-class film/animation director discovery engine with web search access.
The user searched for: "${query}"

The query could be a director's name, a movie/anime/animation title, or a visual style keyword.
Use web search results to find real, existing directors matching this query.
Provide accurate, up-to-date information grounded in real sources.

## DIVERSITY RULES
1. Include directors from at least 2 different regions when possible.
2. Do NOT list only the most famous directors — include at least 1 lesser-known but relevant director.
3. Avoid repeating directors with very similar styles. Show variety in visual approaches.
4. If the query is a movie/anime title, find the actual director AND 3-4 stylistically similar directors.

## OUTPUT FORMAT
Return a JSON object with a "directors" array of up to 5 matching directors. Each object must have:
- id: unique slug like "region-lastname" (e.g. "kr-bong", "jp-miyazaki", "eu-nolan")
- name: English name (real, existing director only)
- nameKo: Korean name
- region: one of "한국", "일본", "중국", "유럽", "미국", "인도", "중동", "동남아", "중남미", "아프리카", "오세아니아"
- style: comma-separated style keywords in Korean (max 5)
- description: 2-3 sentence description of directing style in Korean — be SPECIFIC about visual techniques
- matchedBy: why matched (e.g. "작품: 기생충" or "이름 일치" or "스타일: 네오느와르")
- signatureTechniques: { cameraWork, colorPalette, lighting, editingStyle, moodKeywords } all in English
- notableWorks: array of 3-5 representative work titles

Return ONLY valid JSON: { "directors": [...] }
If no match, return { "directors": [] }`;

    const webBody = {
      contents: [{ role: "user", parts: [{ text: webSearchPrompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    };

    console.log(`[search-director] 웹 검색 시작: query="${query}"`);

    const { response: webRes } = await fetchWithModelFallback(context.env, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webBody),
    });

    let directors: DirectorSearchResult[] = [];
    let mode: "web" | "model" | "hybrid" = "model";
    let groundingSources: GroundingSource[] = [];

    if (webRes.ok) {
      const webData = await webRes.json() as {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          groundingMetadata?: {
            searchEntryPoint?: { renderedContent?: string };
            groundingChunks?: Array<{ web?: { uri: string; title: string } }>;
            groundingSupports?: Array<{
              segment?: { text?: string };
              groundingChunkIndices?: number[];
            }>;
          };
        }[];
      };

      const text = webData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

      // grounding source 추출 — 공통 유틸 사용
      const grounding = webData?.candidates?.[0]?.groundingMetadata;
      groundingSources = extractGroundingSources(grounding?.groundingChunks);

      if (groundingSources.length > 0) {
        mode = "web";
        console.log(`[search-director] 웹 grounding 확인: ${groundingSources.length}개 소스`);
      } else {
        mode = "model";
        warnings.push("웹 검색이 요청되었지만 grounding 소스가 반환되지 않았습니다. 모델 내부 지식 기반 결과입니다.");
        console.log("[search-director] grounding 소스 없음 — 모델 지식 기반 결과");
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        parsed = (parseFirstJsonObject(text) as Record<string, unknown>) ?? {};
      }

      const rawDirs = Array.isArray(parsed.directors) ? parsed.directors as Array<Record<string, unknown>> : [];
      console.log(`[search-director] 원시 결과: ${rawDirs.length}명, grounding sources: ${groundingSources.length}`);

      for (const d of rawDirs) {
        if (!d.name || !d.nameKo) {
          console.log(`[search-director] 결과 스킵: name/nameKo 누락`);
          continue;
        }

        // grounding 품질 점수 계산 — 공통 유틸 사용
        const relevanceKeywords = [
          String(d.name), String(d.nameKo), query,
          ...(Array.isArray(d.notableWorks) ? d.notableWorks.map(String) : []),
        ];
        const groundingQuality = computeGroundingQuality(
          groundingSources,
          relevanceKeywords,
          false,
        );

        directors.push({
          id: String(d.id ?? generateSlugId(String(d.name), String(d.region ?? "미국"))),
          name: String(d.name),
          nameKo: String(d.nameKo),
          region: String(d.region ?? "미국"),
          style: String(d.style ?? ""),
          description: String(d.description ?? ""),
          matchedBy: String(d.matchedBy ?? `검색: ${query}`),
          signatureTechniques: d.signatureTechniques as DirectorSearchResult["signatureTechniques"],
          notableWorks: Array.isArray(d.notableWorks) ? d.notableWorks as string[] : [],
          sources: groundingSources.length > 0 ? groundingSources : undefined,
          grounded: groundingSources.length > 0,
          groundingQuality,
        });
      }
    } else {
      const errText = await webRes.text();
      console.warn(`[search-director] 웹 검색 실패(${webRes.status}), 모델 fallback: ${errText.slice(0, 300)}`);
      warnings.push(`웹 검색 실패 (${webRes.status}). 모델 지식 기반으로 대체합니다.`);

      // ── Fallback: 웹 검색 없이 모델 지식만 사용 ──
      const { response: fallbackRes } = await fetchWithModelFallback(context.env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: webSearchPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: "application/json" },
        }),
      });

      if (!fallbackRes.ok) {
        const fallbackErr = await fallbackRes.text();
        return geminiErrorResponse(fallbackRes, fallbackErr, "search-director");
      }

      const fallbackData = await fallbackRes.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const fallbackText = fallbackData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

      let fallbackParsed: Record<string, unknown>;
      try {
        fallbackParsed = JSON.parse(fallbackText) as Record<string, unknown>;
      } catch {
        fallbackParsed = (parseFirstJsonObject(fallbackText) as Record<string, unknown>) ?? {};
      }

      const fallbackDirs = Array.isArray(fallbackParsed.directors)
        ? fallbackParsed.directors as Array<Record<string, unknown>>
        : [];

      console.log(`[search-director] fallback 결과: ${fallbackDirs.length}명 (grounded=false)`);

      for (const d of fallbackDirs) {
        if (!d.name || !d.nameKo) continue;
        directors.push({
          id: String(d.id ?? generateSlugId(String(d.name), String(d.region ?? "미국"))),
          name: String(d.name),
          nameKo: String(d.nameKo),
          region: String(d.region ?? "미국"),
          style: String(d.style ?? ""),
          description: String(d.description ?? ""),
          matchedBy: String(d.matchedBy ?? `검색: ${query}`),
          signatureTechniques: d.signatureTechniques as DirectorSearchResult["signatureTechniques"],
          notableWorks: Array.isArray(d.notableWorks) ? d.notableWorks as string[] : [],
          grounded: false,
          groundingQuality: { score: 0, sourceCount: 0, uniqueDomains: 0, relevantSources: 0, label: "none", details: "fallback — no web search" },
        });
      }

      mode = "model";
    }

    // 중복 제거 — isSameDirector 기반 (영문명 + 한글명 모두 검사)
    const uniqueDirectors: DirectorSearchResult[] = [];
    for (const d of directors) {
      const isDup = uniqueDirectors.some(
        existing => isSameDirector(existing.name, d.name) || isSameDirector(existing.nameKo, d.nameKo)
      );
      if (!isDup) uniqueDirectors.push(d);
    }
    directors = uniqueDirectors;

    console.log(`[search-director] 완료: mode=${mode}, directors=${directors.length}, sources=${groundingSources.length}`);

    const response: SearchDirectorResponse = {
      success: true,
      query,
      mode,
      directors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    return Response.json(response);
  } catch (error) {
    console.error("Director search error:", error);
    return Response.json(
      {
        success: false,
        error: `Failed to search directors: ${error instanceof Error ? error.message : String(error)}`,
        query: "",
        mode: "model" as const,
        directors: [],
        warnings: ["검색 중 예외가 발생했습니다."],
      },
      { status: 500 }
    );
  }
};
