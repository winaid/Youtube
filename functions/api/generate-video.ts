interface Env {
  GEMINI_API_KEY: string;
}

const VEO_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { prompt, imageBase64, mode } = await context.request.json() as {
      prompt: string;
      imageBase64?: string;
      mode?: "fast" | "quality";
    };

    if (!prompt) {
      return Response.json({ error: "prompt is required" }, { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    // Build request body for Veo
    const instances: Record<string, unknown>[] = [{ prompt }];

    // If reference image provided (for Extend), include it
    if (imageBase64) {
      instances[0].image = {
        bytesBase64Encoded: imageBase64,
      };
    }

    const requestBody = {
      instances,
      parameters: {
        aspectRatio: "1:1",
        durationSeconds: 8,
        personGeneration: "allow_all",
        ...(mode === "quality" ? { generateMode: "quality" } : {}),
      },
    };

    const res = await fetch(`${VEO_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Veo API error:", res.status, errText);
      return Response.json(
        { error: `Veo API error: ${res.status}`, details: errText },
        { status: res.status }
      );
    }

    const data = await res.json();

    // Veo returns a long-running operation
    // Response format: { name: "operations/xxx", metadata: {...} }
    return Response.json({
      operationName: data.name,
      status: "RUNNING",
    });
  } catch (error) {
    console.error("Video generation error:", error);
    return Response.json(
      { error: `Failed to start video generation: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
};
