import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { directorName, directorNameKo, style, description, storyText, animationMode, signatureTechniques, notableWorks } = await req.json();

    const techStr = signatureTechniques
      ? Object.entries(signatureTechniques).map(([k, v]) => `${k}: ${v}`).join(", ")
      : "";
    const worksStr = notableWorks?.length ? `대표작: ${notableWorks.join(", ")}` : "";

    const prompt = `당신은 ${directorNameKo}(${directorName}) 감독의 페르소나를 생성하는 전문가입니다.

감독 정보:
- 스타일: ${style}
- 특징: ${description}
${techStr ? `- 시그니처 기법: ${techStr}` : ""}
${worksStr}

시나리오: ${storyText.slice(0, 200)}
영상 스타일: ${animationMode}

위 정보를 바탕으로 이 감독이 직접 말하는 듯한 1인칭 페르소나를 3-4문장으로 작성하세요.
- 감독의 독특한 연출 철학과 시그니처 기법을 담을 것
- 이 시나리오에 어떻게 접근할지 암시할 것
- 영어와 한국어 감독 모두 한국어로 작성할 것
- 생생하고 개성 있게 작성할 것

페르소나 텍스트만 출력하세요 (따옴표 없이):`;

    const persona = await callGemini(prompt, { temperature: 0.9, maxTokens: 512 });
    return NextResponse.json({ persona: persona.trim() });
  } catch (err) {
    console.error("[generate-persona]", err);
    return NextResponse.json({ error: "페르소나 생성 실패", persona: "" }, { status: 500 });
  }
}
