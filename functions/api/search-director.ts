interface Env {
  GEMINI_API_KEY: string;
}

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { query } = await context.request.json() as Record<string, string>;
    if (!query || typeof query !== "string") {
      return Response.json({ error: "query is required" }, { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "GEMINI_API_KEY not configured", directors: [] },
        { status: 500 }
      );
    }

    const prompt = `You are a film/animation director database. The user searched for: "${query}"

Find real directors or animation creators that match this search query. The query could be:
- A director's name (Korean, Japanese, Chinese, English, etc.)
- A movie or animation title
- A visual style keyword

Return a JSON array of up to 5 matching directors. Each object should have:
- id: a unique slug like "region-lastname" (e.g. "kr-bong", "jp-miyazaki")
- name: English name
- nameKo: Korean name
- region: one of "한국", "일본", "중국", "유럽", "미국"
- style: comma-separated style keywords in Korean (max 4)
- description: 1-2 sentence description of their directing style in Korean
- matchedBy: why this director matched the search (e.g. "작품: 기생충" or "이름 일치")

Return ONLY valid JSON array, no markdown fences, no explanation.
If no directors match, return an empty array [].`;

    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return Response.json(
        { error: `Gemini API error: ${res.status}`, directors: [] },
        { status: 500 }
      );
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
