import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { videoPrompt, extendPrompt, feedback, cutNumber, mode } = await req.json();

    let prompt = "";

    if (mode === "feedback") {
      prompt = `당신은 AI 영상 프롬프트 전문가입니다.

현재 Video Prompt (CUT ${cutNumber}):
${videoPrompt}

${extendPrompt ? `현재 Extend Prompt:\n${extendPrompt}\n` : ""}
사용자 피드백:
${feedback}

위 피드백을 반영하여 프롬프트를 개선하세요. 영어로 작성하고 8초 클립에 맞게 구체적으로 묘사하세요.

JSON 형식만 출력:
{
  "refinedVideoPrompt": "improved video prompt in English",
  "refinedExtendPrompt": "improved extend prompt in English (if applicable, else empty string)"
}`;
    } else if (mode === "english-native") {
      prompt = `당신은 영어 네이티브 영상 프롬프트 전문가입니다.

아래 프롬프트를 영어 원어민 수준으로 교정하세요. AI 영상 생성에 최적화된 자연스러운 영어로 개선하세요.

Video Prompt:
${videoPrompt}

${extendPrompt ? `Extend Prompt:\n${extendPrompt}` : ""}

JSON 형식만 출력:
{
  "refinedVideoPrompt": "native English corrected video prompt",
  "refinedExtendPrompt": "native English corrected extend prompt (if applicable)"
}`;
    } else {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }

    const raw = await callGemini(prompt, { temperature: 0.6, json: true });
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[refine-prompt]", err);
    return NextResponse.json({ error: "프롬프트 개선 실패" }, { status: 500 });
  }
}
