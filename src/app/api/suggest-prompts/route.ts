import { NextRequest, NextResponse } from "next/server";
import { callGemini, safeParseJSON } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { topic, persona } = await req.json();

    const prompt = `당신은 창의적인 시나리오 작가입니다.
${persona ? `페르소나: ${persona.name} - ${persona.description}` : ""}

주제 "${topic}"으로 영상 시나리오 아이디어 3개를 제안하세요.

JSON 형식만 출력:
{
  "suggestions": [
    { "title": "제목", "hook": "첫 1-2문장 시작 (한국어)" },
    { "title": "제목2", "hook": "시작2" },
    { "title": "제목3", "hook": "시작3" }
  ]
}`;

    const raw = await callGemini(prompt, { temperature: 0.9, json: true });
    const data = safeParseJSON(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[suggest-prompts]", err);
    return NextResponse.json({ suggestions: [] });
  }
}
