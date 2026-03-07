interface Env {
  GEMINI_API_KEY: string;
}

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { videoPrompt, extendPrompt, imagePrompt, sceneDescription, cutNumber } =
      await context.request.json() as Record<string, string | number>;

    if (!videoPrompt) {
      return Response.json({ error: "videoPrompt is required" }, { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const prompt = `You are a Veo video generation prompt QA expert. Review the following video generation prompt and provide structured feedback.

## Prompt to Review
- Scene: CUT ${cutNumber || 1}
- Video Prompt: ${String(videoPrompt)}
${extendPrompt ? `- Extend Prompt: ${String(extendPrompt)}` : ""}
${imagePrompt ? `- Image Prompt: ${String(imagePrompt)}` : ""}
${sceneDescription ? `- Scene Description: ${String(sceneDescription)}` : ""}

## Review Criteria
1. **Character Description Completeness** (0-10): Is the character's appearance fully described (hair, outfit, skin, body type)?
2. **Camera Movement Quality** (0-10): Are there at least 2-3 camera movements described in sequence?
3. **Action Sequence Clarity** (0-10): Is the 8-second action sequence clearly described with temporal flow?
4. **Lighting/Mood Specificity** (0-10): Are lighting and mood described concretely?
5. **Veo Compatibility** (0-10): Does the prompt use Veo-friendly language and structure?
6. **Negative Issues**: Any problematic patterns (e.g., "same character", vague references, non-English words)?

## Output JSON only (no markdown fences):
{
  "overallScore": 0-100,
  "scores": {
    "characterDescription": 0-10,
    "cameraMovement": 0-10,
    "actionSequence": 0-10,
    "lightingMood": 0-10,
    "veoCompatibility": 0-10
  },
  "issues": ["list of specific problems found"],
  "suggestions": ["list of concrete improvement suggestions"],
  "improvedVideoPrompt": "the improved version of the video prompt (only if score < 80)",
  "improvedExtendPrompt": "the improved version of the extend prompt if applicable (only if score < 80)"
}`;

    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Verify prompt error:", res.status, errText);
      return Response.json({ error: `Gemini API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { overallScore: 0, issues: ["Failed to parse response"] };
    }

    return Response.json(parsed);
  } catch (error) {
    console.error("Verify prompt error:", error);
    return Response.json({ error: "Failed to verify prompt" }, { status: 500 });
  }
};
