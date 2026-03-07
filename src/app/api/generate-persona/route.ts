import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

export async function POST(req: NextRequest) {
  try {
    const { directorName, directorNameKo, style, description, storyText, animationMode } =
      await req.json();

    if (!directorName) {
      return NextResponse.json(
        { error: "directorName is required" },
        { status: 400 }
      );
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro-preview-06-05",
      generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
    });

    const prompt = `당신은 영화/애니메이션 감독의 페르소나를 작성하는 전문가입니다.

감독 정보:
- 이름: ${directorName} (${directorNameKo || directorName})
- 스타일: ${style || "정보 없음"}
- 설명: ${description || "정보 없음"}
- 애니메이션 모드: ${animationMode || "2D 애니"}
${storyText ? `- 시나리오 맥락: ${storyText.slice(0, 200)}` : ""}

이 감독의 1인칭 페르소나 프롬프트를 작성해주세요.

요구사항:
1. "나는 [감독명]이다/다." 로 시작
2. 이 감독의 시그니처 연출 스타일, 촬영 기법, 미학을 구체적으로 묘사
3. 감독 특유의 철학과 영화/애니에 대한 태도를 담아낼 것
4. 실제 작품에서 볼 수 있는 구체적 기법을 언급 (색감, 카메라워크, 편집, 사운드 등)
5. 한국어로, 자연스럽고 개성 있는 말투로 작성 (3-5문장)
6. 영상 프롬프트 생성에 활용할 수 있도록 시각적/기술적 디테일을 포함

페르소나 프롬프트만 출력하세요. 설명이나 제목 없이 순수 텍스트만.`;

    const result = await model.generateContent(prompt);
    const persona = result.response.text().trim();

    return NextResponse.json({ persona });
  } catch (error) {
    console.error("Persona generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate persona" },
      { status: 500 }
    );
  }
}
