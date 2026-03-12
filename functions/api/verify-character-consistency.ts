import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_FLASH } from "./_gemini-keys";

type Env = GeminiEnv;

interface FrameInput {
  cutNumber: number;
  frameBase64: string;
  characterId: string;
}

interface CharacterSeed {
  id: string;
  appearance: string;
}

interface CutComparison {
  cutA: number;
  cutB: number;
  similarity: number;
  differences: string[];
}

interface ConsistencyResult {
  characterId: string;
  consistencyScore: number;
  issues: string[];
  cutComparisons: CutComparison[];
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
    const { frames, characterSeed } = (await context.request.json()) as {
      frames: FrameInput[];
      characterSeed: CharacterSeed;
    };

    if (!frames || !characterSeed) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: frames, characterSeed" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const urlTemplate = buildGeminiUrl(context.env, GEMINI_MODEL_FLASH);

    const imageParts = frames.map((frame) => ({
      inlineData: {
        mimeType: "image/png",
        data: frame.frameBase64.replace(/^data:image\/\w+;base64,/, ""),
      },
    }));

    const textPart = {
      text: `You are a character consistency analyzer for animation production.

Character ID: ${characterSeed.id}
Character Appearance Description: ${characterSeed.appearance}

I'm providing ${frames.length} frames from different cuts. Each frame should depict the same character.
The cuts are numbered: ${frames.map((f) => f.cutNumber).join(", ")}.

Analyze each frame against the character appearance description and compare frames pairwise for consistency.

Return a JSON object with this exact structure:
{
  "characterId": "${characterSeed.id}",
  "consistencyScore": <0-100 integer>,
  "issues": ["list of inconsistency issues found"],
  "cutComparisons": [
    {
      "cutA": <cut number>,
      "cutB": <cut number>,
      "similarity": <0-100 integer>,
      "differences": ["list of visual differences between these two cuts"]
    }
  ]
}

Compare every unique pair of cuts. Be specific about differences in facial features, clothing, colors, proportions, and style.`,
    };

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [textPart, ...imageParts],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
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

    const result = extractJson(rawText) as ConsistencyResult;

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("verify-character-consistency error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
