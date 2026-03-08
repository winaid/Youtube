import { GeminiEnv, fetchWithAuth } from "./_gemini-keys";

type Env = GeminiEnv;

interface ColorPaletteResult {
  primary: string;
  secondary: string;
  accent: string;
  shadow: string;
  highlight: string;
  mood: string;
  promptSuffix: string;
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
    const { frameBase64, cutNumber } = (await context.request.json()) as {
      frameBase64: string;
      cutNumber: number;
    };

    if (!frameBase64) {
      return new Response(
        JSON.stringify({ error: "Missing required field: frameBase64" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const MODEL = "gemini-3-pro-preview";
    const urlTemplate = `https://aiplatform.googleapis.com/v1beta/publishers/google/models/${MODEL}:generateContent`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `You are a color palette analyzer for animation production.

Analyze the dominant colors in this frame (cut #${cutNumber ?? 1}) and extract a cohesive color palette.

Return a JSON object with this exact structure:
{
  "primary": "<hex color> - description",
  "secondary": "<hex color> - description",
  "accent": "<hex color> - description",
  "shadow": "<hex color> - description",
  "highlight": "<hex color> - description",
  "mood": "description of the overall mood/atmosphere",
  "promptSuffix": "a concise style suffix to append to image generation prompts for color consistency, e.g. 'warm golden lighting, deep blue shadows, muted earth tones, soft amber highlights'"
}

The promptSuffix should be a natural language description that captures the color palette, lighting style, and atmosphere so that other scenes maintain visual consistency. Keep it under 50 words.`,
            },
            {
              inlineData: {
                mimeType: "image/png",
                data: frameBase64.replace(/^data:image\/\w+;base64,/, ""),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
      },
    };

    const response = await fetchWithAuth(context.env, urlTemplate, {
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

    const result = extractJson(rawText) as ColorPaletteResult;

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("analyze-color-palette error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
