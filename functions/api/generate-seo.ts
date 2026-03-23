import { GeminiEnv, fetchWithModelFallback, geminiErrorResponse, parseFirstJsonObject } from "./_gemini-keys";

type Env = GeminiEnv;

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
    const recovered = parseFirstJsonObject(text);
    if (recovered) {
      return recovered;
    }
    throw new Error("Failed to extract JSON from response");
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const startMs = Date.now();
  console.info("[generate-seo] Request received");
  try {
    const input = (await context.request.json()) as SeoInput;
    console.info(`[generate-seo] Parsed request: projectTitle="${input.projectTitle?.slice(0, 50)}", scenesCount=${input.scenes?.length ?? 0}, region=${input.region ?? "(none)"}, animationMode=${input.animationMode ?? "(none)"}`);

    if (!input.projectTitle || !input.conceptSummary) {
      console.info("[generate-seo] Validation failed: missing projectTitle or conceptSummary");
      return new Response(
        JSON.stringify({ error: "Missing required fields: projectTitle, conceptSummary" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }


    const sceneList = (input.scenes || [])
      .map((s, i) => `Scene ${i + 1}: ${s.sceneDescription}`)
      .join("\n");

    const requestBody = {
      contents: [
        {
          role: "user",
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
  "thumbnailPrompt": "A detailed image generation prompt for a YouTube thumbnail. MUST specify camera angle/perspective (e.g. over-the-shoulder, behind the subject, low angle). When a person interacts with an object (phone, laptop, book), describe the camera as positioned BEHIND or BESIDE the person so the object's back is visible, NOT the screen. Focus on the person as the subject, not the object's content.",
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

    console.info(`[generate-seo] Calling Gemini API for SEO generation, elapsed=${Date.now() - startMs}ms`);
    const apiCallStart = Date.now();
    const { response } = await fetchWithModelFallback(context.env, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    console.info(`[generate-seo] Gemini API responded: status=${response.status}, elapsed=${Date.now() - apiCallStart}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      console.info(`[generate-seo] Gemini API error: status=${response.status}, body=${errorText.slice(0, 200)}, elapsed=${Date.now() - startMs}ms`);
      console.error("Gemini API error:", errorText);
      return geminiErrorResponse(response, errorText, "generate-seo");
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.info(`[generate-seo] Parsing response: rawTextLen=${rawText?.length ?? 0}`);
    if (!rawText) {
      console.info(`[generate-seo] No text in Gemini response, elapsed=${Date.now() - startMs}ms`);
      console.error("No text in Gemini response:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "No text content in Gemini response" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.info("[generate-seo] Extracting JSON from response");
    const result = extractJson(rawText) as YouTubeSEO;

    console.info(`[generate-seo] Final response: titles=${result.titles?.length ?? 0}, tags=${result.tags?.length ?? 0}, hashtags=${result.hashtags?.length ?? 0}, elapsed=${Date.now() - startMs}ms`);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.info(`[generate-seo] Unhandled error caught: ${error instanceof Error ? error.message : String(error)}, elapsed=${Date.now() - startMs}ms`);
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
