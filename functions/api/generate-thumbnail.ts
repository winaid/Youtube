import { GeminiEnv, fetchWithAuth } from "./_gemini-keys";

type Env = GeminiEnv;

interface ThumbnailInput {
  projectTitle: string;
  conceptSummary: string;
  thumbnailPrompt: string;
  aspectRatio: string;
}

interface ThumbnailResult {
  images: { base64: string; mimeType: string }[];
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const input = (await context.request.json()) as ThumbnailInput;

    if (!input.thumbnailPrompt) {
      return new Response(
        JSON.stringify({ error: "Missing required field: thumbnailPrompt" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const prompt = `Create a YouTube thumbnail image.
Title: ${input.projectTitle || ""}
Concept: ${input.conceptSummary || ""}
Aspect Ratio: ${input.aspectRatio || "16:9"}

Thumbnail Description: ${input.thumbnailPrompt}

IMPORTANT composition & camera rules:
- Use a cinematic camera perspective. Think like a film director choosing the best angle.
- When a person is looking at an object (phone, book, screen, etc.), position the camera BEHIND or OVER THE SHOULDER of the person. The viewer should see the BACK of the object, NOT the screen/front. The subject (person) is the focus, not the object's content.
- Avoid flat front-facing compositions. Use depth, layering, and natural perspective.
- The main subject should dominate 60-70% of the frame.

Make it eye-catching, high contrast, and optimized for small display sizes. Use bold colors and clear focal points.`;

    const models = ["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"];

    let lastError: string | null = null;

    for (const model of models) {
      try {
        const url = `https://aiplatform.googleapis.com/v1beta/publishers/google/models/${model}:generateContent`;

        const requestBody = {
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["IMAGE"],
            temperature: 0.8,
          },
        };

        const response = await fetchWithAuth(context.env, url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Gemini API error with model ${model}:`, errorText);
          lastError = errorText;
          continue;
        }

        const data = (await response.json()) as {
          candidates?: {
            content?: {
              parts?: { inlineData?: { data: string; mimeType: string }; text?: string }[];
            };
          }[];
        };

        const parts = data.candidates?.[0]?.content?.parts;
        if (!parts || parts.length === 0) {
          console.error(`No parts in Gemini response for model ${model}:`, JSON.stringify(data));
          lastError = "No content parts in response";
          continue;
        }

        const images: { base64: string; mimeType: string }[] = [];

        for (const part of parts) {
          if (part.inlineData) {
            images.push({
              base64: part.inlineData.data,
              mimeType: part.inlineData.mimeType,
            });
          }
        }

        if (images.length === 0) {
          console.error(`No image data in response for model ${model}`);
          lastError = "No image data in response parts";
          continue;
        }

        const result: ThumbnailResult = { images };

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (modelError) {
        console.error(`Error with model ${model}:`, modelError);
        lastError =
          modelError instanceof Error ? modelError.message : String(modelError);
        continue;
      }
    }

    return new Response(
      JSON.stringify({
        error: "All image generation models failed",
        details: lastError,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("generate-thumbnail error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
