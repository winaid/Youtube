import { NextRequest, NextResponse } from "next/server";
import { callGemini, safeParseJSON } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { videoPrompt, extendPrompt, cutNumber } = await req.json();

    const prompt = `당신은 Google Veo 영상 생성 프롬프트 품질 평가 전문가입니다.

CUT ${cutNumber} Video Prompt:
${videoPrompt}

${extendPrompt ? `Extend Prompt:\n${extendPrompt}` : ""}

아래 기준으로 품질을 평가하세요:
- characterDescription: 캐릭터 외형 묘사 명확성 (0-100)
- cameraMovement: 카메라 움직임 구체성 (0-100)
- actionSequence: 행동/동작 시퀀스 명확성 (0-100)
- lightingMood: 조명/분위기 묘사 (0-100)
- veoCompatibility: Veo 호환성 (텍스트/워터마크 없음 등) (0-100)

JSON 형식만 출력:
{
  "overallScore": 75,
  "scores": {
    "characterDescription": 80,
    "cameraMovement": 70,
    "actionSequence": 75,
    "lightingMood": 85,
    "veoCompatibility": 90
  },
  "issues": ["문제점1", "문제점2"],
  "suggestions": ["개선 제안1", "개선 제안2"],
  "improvedVideoPrompt": "개선된 video prompt (영어)",
  "improvedExtendPrompt": "개선된 extend prompt (영어, 해당시)"
}`;

    const raw = await callGemini(prompt, { temperature: 0.3, json: true });
    const data = safeParseJSON(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[verify-prompt]", err);
    return NextResponse.json({ overallScore: 70, scores: {}, issues: [], suggestions: [], scoringFailure: true });
  }
}
