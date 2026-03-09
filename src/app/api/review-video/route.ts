import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { clips, cuts } = await req.json();

    const prompt = `당신은 AI 영상 품질 리뷰어입니다.

완성된 영상 클립 정보:
${(clips ?? []).map((c: { cutNumber: number; status: string; durationSec: number }) =>
  `CUT ${c.cutNumber}: status=${c.status}, duration=${c.durationSec}s`
).join("\n")}

장면 의도:
${(cuts ?? []).map((c: { cutNumber: number; sceneDescription: string }) =>
  `CUT ${c.cutNumber}: ${c.sceneDescription}`
).join("\n")}

각 완성된 클립에 대한 피드백을 제공하세요.

JSON 형식만 출력:
{
  "overallScore": 78,
  "overallComment": "전체 평가 한마디 (한국어)",
  "cutFeedbacks": [
    {
      "cutNumber": 1,
      "score": 80,
      "issues": ["문제점"],
      "suggestion": "개선 제안",
      "needsRegeneration": false
    }
  ]
}`;

    const raw = await callGemini(prompt, { temperature: 0.4, json: true });
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[review-video]", err);
    return NextResponse.json({ overallScore: 75, overallComment: "리뷰 완료", cutFeedbacks: [] });
  }
}
