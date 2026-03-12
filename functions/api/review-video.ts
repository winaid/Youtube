import { GeminiEnv, fetchWithAuth, buildGeminiUrl } from "./_gemini-keys";

type Env = GeminiEnv;

interface CutReviewInput {
  cutNumber: number;
  frameBase64: string;
  videoPrompt: string;
  sceneDescription: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { cuts, totalCuts } = await context.request.json() as {
      cuts: CutReviewInput[];
      totalCuts: number;
    };

    if (!cuts?.length) {
      return Response.json({ error: "cuts array is required" }, { status: 400 });
    }

    // 각 컷의 프레임을 모아서 한 번에 리뷰
    const cutDescriptions = cuts.map((c) =>
      `CUT ${c.cutNumber}: prompt="${c.videoPrompt?.slice(0, 300)}", scene="${c.sceneDescription?.slice(0, 200)}"`
    ).join("\n");

    const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [
      {
        text: `You are a professional video director reviewing AI-generated video clips.
Review each cut frame and provide honest, specific feedback in Korean.

## Cuts to review:
${cutDescriptions}

## The following frames are from CUT ${cuts.map(c => c.cutNumber).join(", ")} respectively:`,
      },
    ];

    // 각 프레임 이미지 추가
    for (const cut of cuts) {
      if (cut.frameBase64) {
        parts.push({
          text: `\n--- CUT ${cut.cutNumber} frame ---`,
        });
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: cut.frameBase64.replace(/^data:image\/\w+;base64,/, ""),
          },
        });
      }
    }

    parts.push({
      text: `

## Instructions:
1. Score each cut 0-100 based on: visual quality, prompt adherence, face quality, composition
2. For cuts scoring below 70, mark needsRegeneration: true and provide an improved prompt
3. Be specific about issues (e.g. "얼굴이 뭉개짐", "프롬프트와 다른 구도", "조명이 부자연스러움")
4. Give an overall score and one-line comment for the whole video
5. If a cut has visible text/writing that shouldn't be there, flag it as an issue

## Output JSON only (Korean feedback, no markdown):
{
  "overallScore": 0-100,
  "overallComment": "전체 영상에 대한 한줄 평가 (Korean)",
  "cutFeedbacks": [
    {
      "cutNumber": 1,
      "score": 0-100,
      "issues": ["구체적 문제점 (Korean)"],
      "suggestion": "개선 제안 한줄 (Korean)",
      "needsRegeneration": false,
      "improvedPrompt": "only if needsRegeneration=true, improved English prompt"
    }
  ]
}`,
    });

    const res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, "gemini-3.1-pro-preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Review API error:", res.status, errText.slice(0, 300));
      return Response.json({ error: `Gemini API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {
        overallScore: 50,
        overallComment: "리뷰 파싱 실패",
        cutFeedbacks: [],
      };
    }

    return Response.json(parsed);
  } catch (error) {
    console.error("Video review error:", error);
    return Response.json(
      { error: `리뷰 실패: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
};
