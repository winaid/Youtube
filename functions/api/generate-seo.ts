interface Env {
  GEMINI_API_KEY: string;
}

interface SeoInput {
  projectTitle: string;
  conceptSummary: string;
  scenes: { sceneDescription: string }[];
  region: string;
  animationMode: string;
}

interface YouTubeSEO {
  titles: string[];
  description: string;
  tags: string[];
  hashtags: string[];
  thumbnailPrompt: string;
  predictedCTR: number;
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
    const input = (await context.request.json()) as SeoInput;

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
              text: `You are a YouTube SEO expert specializing in animated content. Generate optimized SEO metadata for the following video project.

Project Title: ${input.projectTitle}
Concept Summary: ${input.conceptSummary}
Region/Target Audience: ${input.region || "Global"}
Animation Mode: ${input.animationMode || "Standard"}

Scenes:
${sceneList}

Return a JSON object with this exact structure:
{
  "titles": ["5 optimized title variations, each under 100 characters, clickbait-friendly but accurate"],
  "description": "A full YouTube description (500-1000 chars) with hooks, content summary, timestamps placeholder, and call-to-action",
  "tags": ["15-25 relevant tags for YouTube search optimization"],
  "hashtags": ["5-8 hashtags for YouTube shorts/social sharing"],
  "thumbnailPrompt": "A detailed image generation prompt for creating a compelling YouTube thumbnail",
  "predictedCTR": 0.0
}

For predictedCTR, estimate a click-through rate between 0.0 and 1.0 based on how compelling the titles and concept are. Average YouTube CTR is around 0.02-0.10.

Optimize for the ${input.region || "Global"} audience. Consider trending formats and styles for animated content.`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.7,
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

    const result = extractJson(rawText) as YouTubeSEO;

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-seo error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
