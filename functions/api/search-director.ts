import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_PRO, geminiErrorResponse, parseFirstJsonObject } from "./_gemini-keys";

type Env = GeminiEnv;

// ═══════════════════════════════════════════════════════════════════
// Response Types
// ═══════════════════════════════════════════════════════════════════

interface GroundingSource {
  title?: string;
  url?: string;
}

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

    const warnings: string[] = [];

    // ── Step 1: Gemini + googleSearchRetrieval (실제 웹 검색) ──
    const webSearchPrompt = `You are a world-class film/animation encyclopedia with access to web search.
The user searched for: "${query}"

The query could be a director's name, a movie/anime/animation title, or a visual style keyword.
Use web search results to find real, existing directors matching this query.
Provide accurate, up-to-date information grounded in real sources.

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

If the query is a movie/anime title, find the director of that work AND suggest similar-style directors.

Return ONLY valid JSON: { "directors": [...] }
If no match, return { "directors": [] }`;

    const webBody = {
      contents: [{ role: "user", parts: [{ text: webSearchPrompt }] }],
      tools: [{ googleSearchRetrieval: {} }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    };

    console.log(`[search-director] 웹 검색 시작: query="${query}"`);

    const webRes = await fetchWithAuth(context.env, buildGeminiUrl(context.env, GEMINI_MODEL_PRO), {
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

      // grounding metadata 추출
      const grounding = webData?.candidates?.[0]?.groundingMetadata;
      const groundingChunks = grounding?.groundingChunks ?? [];

      if (groundingChunks.length > 0) {
        mode = "web";
        groundingSources = groundingChunks
          .filter(c => c.web)
          .map(c => ({
            title: c.web!.title,
            url: c.web!.uri,
          }));
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

      for (const d of rawDirs) {
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
          sources: groundingSources.length > 0 ? groundingSources : undefined,
          grounded: groundingSources.length > 0,
        });
      }
    } else {
      const errText = await webRes.text();
      console.warn(`[search-director] 웹 검색 실패(${webRes.status}), 모델 fallback: ${errText.slice(0, 300)}`);
      warnings.push(`웹 검색 실패 (${webRes.status}). 모델 지식 기반으로 대체합니다.`);

      // ── Fallback: 웹 검색 없이 모델 지식만 사용 ──
      const fallbackRes = await fetchWithAuth(context.env, buildGeminiUrl(context.env, GEMINI_MODEL_PRO), {
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
        });
      }

      mode = "model";
    }

    // 중복 제거 (같은 name)
    const seen = new Set<string>();
    directors = directors.filter(d => {
      const key = d.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

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
      },
      { status: 500 }
    );
  }
};

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function generateSlugId(name: string, region: string): string {
  const regionSlug: Record<string, string> = {
    "한국": "kr", "일본": "jp", "중국": "cn", "유럽": "eu",
    "미국": "us", "인도": "in", "중동": "me", "동남아": "sea",
    "중남미": "la", "아프리카": "af", "오세아니아": "oc",
  };
  const rSlug = regionSlug[region] ?? "xx";
  const nameSlug = name.split(" ").pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "unknown";
  return `web-${rSlug}-${nameSlug}`;
}
