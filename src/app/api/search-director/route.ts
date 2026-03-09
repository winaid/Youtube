import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();
    if (!query?.trim()) return NextResponse.json({ directors: [] });

    const prompt = `당신은 세계 영화 감독 전문가입니다.

검색어: "${query}"

이 검색어와 관련된 영화 감독을 최대 3명 찾아서 JSON으로 반환하세요.
감독 이름, 영화 제목, 스타일 키워드로 검색합니다.

반드시 아래 JSON 형식만 출력:
{
  "directors": [
    {
      "id": "감독-영문이름-소문자-하이픈",
      "name": "English Name Style",
      "nameKo": "한국어 이름",
      "region": "한국|일본|중국|유럽|미국|인도|중동|동남아|중남미|아프리카|오세아니아 중 하나",
      "style": "핵심 연출 스타일 키워드 (한국어, 30자 이내)",
      "description": "감독 특징 설명 (한국어, 60자 이내)",
      "matchedBy": "어떻게 매칭됐는지 (예: 영화 '기생충' 감독, 스타일 키워드 일치 등)",
      "signatureTechniques": {
        "cameraWork": "카메라 기법",
        "colorPalette": "색감 특징",
        "lighting": "조명 스타일"
      },
      "notableWorks": ["대표작1", "대표작2"]
    }
  ]
}`;

    const raw = await callGemini(prompt, { temperature: 0.3, json: true });
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[search-director]", err);
    return NextResponse.json({ directors: [] });
  }
}
