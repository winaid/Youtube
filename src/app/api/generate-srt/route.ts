import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { scenes } = await req.json();
    if (!scenes?.length) return NextResponse.json({ srt: "" });

    const prompt = `아래 장면 정보를 바탕으로 SRT 자막 파일을 생성하세요.
각 장면의 sceneDescription을 자연스러운 나레이션/자막으로 변환하세요.

장면 정보:
${scenes.map((s: { cutNumber: number; sceneDescription: string; durationSec: number }, i: number) => {
  const startSec = scenes.slice(0, i).reduce((acc: number, prev: { durationSec: number }) => acc + prev.durationSec, 0);
  return `CUT ${s.cutNumber} (${startSec}s~${startSec + s.durationSec}s): ${s.sceneDescription}`;
}).join("\n")}

SRT 형식으로만 출력하세요 (다른 텍스트 없이):
예시:
1
00:00:00,000 --> 00:00:03,000
자막 텍스트

2
00:00:03,000 --> 00:00:06,000
자막 텍스트`;

    const srt = await callGemini(prompt, { temperature: 0.4, maxTokens: 4096 });
    return NextResponse.json({ srt: srt.trim() });
  } catch (err) {
    console.error("[generate-srt]", err);
    return NextResponse.json({ error: "자막 생성 실패" }, { status: 500 });
  }
}
