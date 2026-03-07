import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro-preview-06-05",
      generationConfig: { temperature: 0.3 },
    });

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

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Parse the JSON response
    let directors;
    try {
      directors = JSON.parse(text);
    } catch {
      // Try to extract JSON from potential markdown fences
      const match = text.match(/\[[\s\S]*\]/);
      directors = match ? JSON.parse(match[0]) : [];
    }

    return NextResponse.json({ directors });
  } catch (error) {
    console.error("Director search error:", error);
    return NextResponse.json(
      { error: "Failed to search directors", directors: [] },
      { status: 500 }
    );
  }
}
