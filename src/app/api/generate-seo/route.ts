import { NextRequest, NextResponse } from "next/server";
import { callGemini, safeParseJSON } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { projectTitle, conceptSummary, region, animationMode } = await req.json();

    const prompt = `당신은 유튜브 SEO 전문가입니다.

영상 정보:
- 제목: ${projectTitle}
- 개요: ${conceptSummary}
- 지역/타겟: ${region}
- 스타일: ${animationMode}

아래 JSON 형식으로 유튜브 SEO 최적화 데이터를 생성하세요:
{
  "titles": ["제목 후보1", "제목 후보2", "제목 후보3"],
  "description": "유튜브 영상 설명 (한국어, 200자)",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "hashtags": ["#해시태그1", "#해시태그2", "#해시태그3"],
  "thumbnailPrompt": "썸네일 이미지 생성 프롬프트 (영어, AI 이미지 생성용)",
  "predictedCTR": 7.5
}`;

    const raw = await callGemini(prompt, { temperature: 0.7, json: true });
    const data = safeParseJSON(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[generate-seo]", err);
    return NextResponse.json({ error: "SEO 생성 실패" }, { status: 500 });
  }
}
