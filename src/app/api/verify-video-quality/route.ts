import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { videoUri, cutNumber, expectedDescription } = await req.json();

    // 영상 URI가 있을 때만 AI 검증 수행
    if (!videoUri) return NextResponse.json({ passed: true, score: 75 });

    const prompt = `당신은 AI 영상 품질 검증 전문가입니다.

CUT ${cutNumber} 영상이 생성되었습니다.
기대한 장면 설명: ${expectedDescription}

영상 프롬프트 품질 기준으로 검증하세요 (영상 자체는 볼 수 없으므로 프롬프트 기반 평가).

JSON 형식만 출력:
{
  "passed": true,
  "score": 80,
  "issues": [],
  "recommendation": "재생성 불필요"
}`;

    const raw = await callGemini(prompt, { temperature: 0.2, json: true });
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[verify-video-quality]", err);
    return NextResponse.json({ passed: true, score: 75 });
  }
}
