import { NextRequest, NextResponse } from "next/server";
import { callGemini, safeParseJSON } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { videoPrompt, animationMode } = await req.json();

    const prompt = `Veo 영상 생성을 위한 네거티브 프롬프트를 생성하세요.

Video Prompt: ${videoPrompt}
Style: ${animationMode}

이 영상에서 피해야 할 요소들을 영어로 나열하세요.
기본 제외: text overlay, watermark, logo, subtitle, blurry, distorted face, low quality

JSON 형식만 출력:
{ "negativePrompt": "text overlay, watermark, logo, blurry, distorted, low quality, ..." }`;

    const raw = await callGemini(prompt, { temperature: 0.3, json: true });
    const data = safeParseJSON(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[auto-negative]", err);
    return NextResponse.json({ negativePrompt: "text overlay, watermark, logo, blurry, distorted face, low quality" });
  }
}
