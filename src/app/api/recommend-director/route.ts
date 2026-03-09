import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { storyText, localDirectors } = await req.json();

    const directorList = (localDirectors ?? [])
      .map((d: { id: string; nameKo: string; style: string }) => `- ${d.id}: ${d.nameKo} (${d.style})`)
      .join("\n");

    const prompt = `당신은 영화 감독 매칭 전문가입니다.

시나리오:
"${storyText.slice(0, 400)}"

보유 감독 목록:
${directorList}

위 시나리오에 가장 어울리는 감독을 추천하세요.

반드시 아래 JSON 형식만 출력:
{
  "analysis": "시나리오 분석 요약 (한국어, 2문장)",
  "localMatches": [
    { "id": "감독id", "fitScore": 85, "reason": "어울리는 이유 (한국어, 30자 이내)" }
  ],
  "webSuggestions": [
    {
      "id": "web-감독영문-소문자",
      "name": "English Name",
      "nameKo": "한국어 이름",
      "region": "국가",
      "style": "스타일 키워드",
      "description": "특징 설명",
      "reason": "추천 이유",
      "fitScore": 90,
      "signatureTechniques": { "cameraWork": "", "colorPalette": "", "lighting": "" },
      "notableWorks": ["대표작"]
    }
  ]
}

localMatches는 보유 감독 중 상위 3명, webSuggestions는 보유 목록에 없는 추가 추천 1-2명.`;

    const raw = await callGemini(prompt, { temperature: 0.5, json: true });
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[recommend-director]", err);
    return NextResponse.json({ analysis: "", localMatches: [], webSuggestions: [] });
  }
}
