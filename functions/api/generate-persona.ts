interface Env {
  GEMINI_API_KEY: string;
}

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-preview:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { directorName, directorNameKo, style, description, storyText, animationMode, signatureTechniques, notableWorks } =
      await context.request.json() as Record<string, string | object | string[]>;

    if (!directorName) {
      return Response.json({ error: "directorName is required" }, { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const techniques = signatureTechniques && typeof signatureTechniques === "object"
      ? signatureTechniques as Record<string, string>
      : null;
    const works = Array.isArray(notableWorks) ? notableWorks : [];

    const techniquesBlock = techniques
      ? `\n시그니처 기법 (검색 분석 결과):
- 카메라: ${techniques.cameraWork || "N/A"}
- 색감: ${techniques.colorPalette || "N/A"}
- 조명: ${techniques.lighting || "N/A"}
- 편집: ${techniques.editingStyle || "N/A"}
- 무드: ${techniques.moodKeywords || "N/A"}`
      : "";

    const worksBlock = works.length > 0 ? `\n대표작: ${works.join(", ")}` : "";

    const prompt = `당신은 영화/애니메이션 감독의 페르소나를 작성하는 전문가입니다.

감독 정보:
- 이름: ${directorName} (${directorNameKo || directorName})
- 스타일: ${style || "정보 없음"}
- 설명: ${description || "정보 없음"}
- 애니메이션 모드: ${animationMode || "2D 애니"}
${storyText ? `- 시나리오 맥락: ${String(storyText).slice(0, 200)}` : ""}${techniquesBlock}${worksBlock}

이 감독의 1인칭 페르소나 프롬프트를 작성해주세요.

요구사항:
1. "나는 [감독명]이다/다." 로 시작
2. 이 감독의 시그니처 연출 스타일, 촬영 기법, 미학을 **구체적이고 기술적으로** 묘사
3. 감독 특유의 철학과 영화/애니에 대한 태도를 강하게 담아낼 것
4. 실제 작품에서 볼 수 있는 구체적 기법을 반드시 언급 (카메라 워크, 편집 리듬, 색보정, 조명, 사운드)
${techniques ? "5. 위 '시그니처 기법' 분석 결과를 반드시 반영하여 더 정확한 페르소나를 작성" : "5. 이 감독의 대표작에서 관찰되는 시각적 특징을 구체적으로 언급"}
6. 한국어로, 자연스럽고 개성 있는 말투로 작성 (4-6문장)
7. AI 영상 프롬프트 생성에 바로 활용할 수 있도록 **시각적/기술적 디테일 극대화**
8. 이 감독이라면 카메라를 어떻게 움직일지, 한 장면을 어떻게 구성할지 느껴지게

페르소나 프롬프트만 출력하세요. 설명이나 제목 없이 순수 텍스트만.`;

    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return Response.json({ error: `Gemini API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const persona = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    return Response.json({ persona });
  } catch (error) {
    console.error("Persona generation error:", error);
    return Response.json({ error: "Failed to generate persona" }, { status: 500 });
  }
};
