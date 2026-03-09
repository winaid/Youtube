import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { projectTitle, conceptSummary, cuts, region } = await req.json();

    const prompt = `당신은 유튜브 콘텐츠 분석가입니다.

영상 정보:
- 제목: ${projectTitle}
- 개요: ${conceptSummary}
- 장면 수: ${cuts?.length ?? 0}
- 타겟 지역: ${region}

이 영상의 유튜브 성과를 예측하세요.

JSON 형식만 출력:
{
  "estimatedViews": "1만~5만",
  "engagementRate": 4.5,
  "retentionCurve": [100, 95, 88, 80, 72, 65, 60, 58, 55, 50],
  "strengths": ["강점1", "강점2"],
  "weaknesses": ["약점1"],
  "improvements": ["개선점1", "개선점2"]
}`;

    const raw = await callGemini(prompt, { temperature: 0.5, json: true });
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[predict-engagement]", err);
    return NextResponse.json({ estimatedViews: "-", engagementRate: 0, retentionCurve: [], strengths: [], weaknesses: [], improvements: [] });
  }
}
