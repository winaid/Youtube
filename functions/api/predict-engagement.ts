interface Env {
  GEMINI_API_KEY: string;
}

interface EngagementInput {
  projectTitle: string;
  conceptSummary: string;
  scenes: { sceneDescription: string }[];
  totalDuration: number;
  region: string;
  animationMode: string;
}

interface ViewerPrediction {
  estimatedViews: string;
  engagementRate: number;
  retentionCurve: number[];
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      return JSON.parse(match[1].trim());
    }
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      return JSON.parse(braceMatch[0]);
    }
    throw new Error("Failed to extract JSON from response");
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const input = (await context.request.json()) as EngagementInput;

    if (!input.projectTitle || !input.conceptSummary) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: projectTitle, conceptSummary" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const MODEL = "gemini-3.1-pro-preview";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${context.env.GEMINI_API_KEY}`;

    const sceneList = (input.scenes || [])
      .map((s, i) => `Scene ${i + 1}: ${s.sceneDescription}`)
      .join("\n");

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `You are a YouTube analytics expert specializing in animated content engagement prediction. Analyze the following video project and predict its performance.

Project Title: ${input.projectTitle}
Concept Summary: ${input.conceptSummary}
Total Duration: ${input.totalDuration || "Unknown"} seconds
Region/Target Audience: ${input.region || "Global"}
Animation Mode: ${input.animationMode || "Standard"}

Scenes:
${sceneList}

Return a JSON object with this exact structure:
{
  "estimatedViews": "a range string like '10K-50K' for first 30 days based on organic reach for this type of content",
  "engagementRate": 0.0,
  "retentionCurve": [100, 85, 70, ...],
  "strengths": ["list of content strengths that will drive engagement"],
  "weaknesses": ["list of potential issues that could hurt performance"],
  "improvements": ["actionable suggestions to improve engagement"]
}

For retentionCurve, provide an array of 10 percentage values (0-100) representing viewer retention at evenly spaced intervals through the video. Start at 100 and model realistic drop-off.

For engagementRate, estimate likes+comments relative to views (typical range 0.02-0.15).

Consider:
- Hook strength in the first scene
- Pacing and narrative arc
- Visual appeal for the animation mode
- Regional audience preferences
- Content trends and competition
- Video length optimization`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 4096,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      return new Response(
        JSON.stringify({ error: "Gemini API error", details: errorText }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      console.error("No text in Gemini response:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "No text content in Gemini response" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = extractJson(rawText) as ViewerPrediction;

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("predict-engagement error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
