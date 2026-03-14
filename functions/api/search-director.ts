import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_PRO, geminiErrorResponse } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { query } = await context.request.json() as Record<string, string>;
    if (!query || typeof query !== "string") {
      return Response.json({ error: "query is required" }, { status: 400 });
    }

    const prompt = `You are a world-class film/animation encyclopedia. The user searched for: "${query}"

The query could be a director's name, a movie/anime/animation title, or a visual style keyword.
Search your knowledge deeply and return matching directors with **rich visual style analysis**.

Return a JSON array of up to 5 matching directors. Each object must have:
- id: unique slug like "region-lastname" (e.g. "kr-bong", "jp-miyazaki")
- name: English name
- nameKo: Korean name
- region: one of "한국", "일본", "중국", "유럽", "미국", "인도", "중동", "동남아", "중남미", "아프리카", "오세아니아"
- style: comma-separated style keywords in Korean (max 5)
- description: 2-3 sentence description of directing style in Korean — be SPECIFIC about visual techniques
- matchedBy: why matched (e.g. "작품: 기생충" or "이름 일치")
- signatureTechniques: JSON object with these keys:
  - cameraWork: string — signature camera techniques in English (e.g. "long tracking shots, symmetrical framing, whip pans")
  - colorPalette: string — typical color grading in English (e.g. "desaturated cool tones with warm highlights")
  - lighting: string — lighting style in English (e.g. "chiaroscuro, neon-lit night scenes")
  - editingStyle: string — editing approach in English (e.g. "slow dissolves, match cuts, long takes")
  - moodKeywords: string — 3-5 mood keywords in English (e.g. "melancholic, tense, dreamlike")
- notableWorks: array of 3-5 representative work titles in original language + Korean

If the query is a movie/anime title, find the director of that work AND suggest similar-style directors.

Return ONLY valid JSON array, no markdown fences, no explanation.
If no match, return empty array [].`;

    const res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, GEMINI_MODEL_PRO), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: "application/json" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("search-director Gemini error:", res.status, errText.slice(0, 500));
      return geminiErrorResponse(res, errText, "search-director");
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "[]";

    let directors;
    try {
      directors = JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      directors = match ? JSON.parse(match[0]) : [];
    }

    return Response.json({ directors });
  } catch (error) {
    console.error("Director search error:", error);
    return Response.json(
      { error: `Failed to search directors: ${error instanceof Error ? error.message : String(error)}`, directors: [] },
      { status: 500 }
    );
  }
};
