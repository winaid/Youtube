import { NextRequest, NextResponse } from "next/server";
import { callGemini, safeParseJSON } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { storyText } = await req.json();
    if (!storyText?.trim()) return NextResponse.json({ recommendedCuts: 8, reason: "", scenes: [] });

    const prompt = `당신은 영상 편집 전문가입니다. 아래 시나리오를 분석하여 최적의 장면 수를 추천하세요.

시나리오:
"${storyText.slice(0, 600)}"

각 장면은 8초 클립입니다. 시나리오의 복잡도, 장면 전환 필요성, 감정 호흡을 고려하세요.

반드시 아래 JSON 형식만 출력:
{
  "recommendedCuts": 8,
  "reason": "추천 이유 (한국어, 2문장)",
  "scenes": ["핵심 장면1", "핵심 장면2", "핵심 장면3", "핵심 장면4"]
}

추천 범위: 4~20장면`;

    const raw = await callGemini(prompt, { temperature: 0.3, json: true });
    const data = safeParseJSON(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[analyze-cuts]", err);
    return NextResponse.json({ error: "분석 실패", detail: String(err) }, { status: 500 });
  }
}
