import { NextRequest, NextResponse } from "next/server";
import { callGemini, safeParseJSON } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { scenes } = await req.json();

    const prompt = `당신은 영상 음향 감독입니다. 각 장면에 어울리는 효과음을 추천하세요.

장면 목록:
${(scenes ?? []).map((s: { cutNumber: number; sceneDescription: string; moodLighting: string }) =>
  `CUT ${s.cutNumber}: ${s.sceneDescription} | 분위기: ${s.moodLighting}`
).join("\n")}

JSON 형식만 출력:
{
  "sceneSfx": [
    {
      "cutNumber": 1,
      "sfxMatches": [
        {
          "id": "sfx-1",
          "category": "ambient",
          "label": "효과음 이름 (한국어)",
          "labelEn": "SFX name in English",
          "audioUrl": "",
          "duration": 3,
          "trending": false
        }
      ],
      "timing": "장면 시작 시",
      "reason": "이 효과음을 추천한 이유"
    }
  ]
}`;

    const raw = await callGemini(prompt, { temperature: 0.6, json: true });
    const data = safeParseJSON(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[match-sfx]", err);
    return NextResponse.json({ sceneSfx: [] });
  }
}
