import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { videoPrompt, extendPrompt, imagePrompt, sceneDescription, cutNumber, durationSeconds } =
      await context.request.json() as Record<string, string | number>;

    if (!videoPrompt) {
      return Response.json({ error: "videoPrompt is required" }, { status: 400 });
    }

    const duration = Number(durationSeconds) || 8;
    const wordCount = String(videoPrompt).split(/\s+/).length;

    const prompt = `You are a Veo 3.1 video generation prompt QA expert. Review the following prompt for issues that cause Veo to deviate from user intent.

## Prompt to Review
- Scene: CUT ${cutNumber || 1}
- Duration: ${duration} seconds
- Word count: ~${wordCount} words
- Video Prompt: ${String(videoPrompt)}
${extendPrompt ? `- Extend Prompt: ${String(extendPrompt)}` : ""}
${imagePrompt ? `- Image Prompt: ${String(imagePrompt)}` : ""}
${sceneDescription ? `- Scene Description: ${String(sceneDescription)}` : ""}

## Review Criteria (STRICT — focus on what makes Veo follow or ignore prompts)

1. **Character Description Completeness** (0-10):
   - MUST have: hair style+color, outfit details, approximate age, skin tone
   - DEDUCTION: vague references like "the character", "same person", "he/she" without redescription

2. **Camera Movement Quality** (0-10):
   - MUST use Veo-recognized terms: "dolly", "tracking", "crane", "pan", "tilt", "steadicam", "handheld"
   - DEDUCTION: abstract camera ("cinematic angle") without specific movement type
   - BONUS: 2-3 camera transitions described in sequence

3. **Temporal Structure** (0-10): *** THE MOST CRITICAL FOR VEO ADHERENCE ***
   - MUST have clear time-based progression for ${duration} seconds
   - BEST: explicit "0s-2s: ..., 2s-5s: ..., 5s-${duration}s: ..." format
   - ACCEPTABLE: clear "first... then... finally..." progression
   - DEDUCTION: no temporal markers = Veo picks random moment (score ≤ 4)
   - DEDUCTION: too many actions for ${duration}s (max 2 concurrent per segment)

4. **Lighting/Mood Specificity** (0-10):
   - MUST name light sources and direction: "warm key light from upper left"
   - DEDUCTION: just "dramatic lighting" without specifics

5. **Veo Compatibility** (0-10):
   - DEDUCTION: requests for readable text/writing on screen (Veo cannot do this)
   - DEDUCTION: exact numbers of objects ("three birds" — use "a few birds")
   - DEDUCTION: complex multi-person choreography
   - DEDUCTION: abstract emotions without physical manifestation
   - DEDUCTION: prompt over 350 words (Veo starts ignoring)
   - DEDUCTION: prompt under 80 words (not enough detail for Veo)
   - BONUS: active voice, present tense, concrete actions

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
  "issues": ["list of specific problems that will cause Veo to deviate from intent"],
  "suggestions": ["concrete actionable improvements"],
  "improvedVideoPrompt": "ONLY if score < 80: fully rewritten prompt with temporal beats, proper structure, embedded negative guidance, no text/watermark clause. Must be 180-280 words.",
  "improvedExtendPrompt": "ONLY if score < 80 and extend prompt exists: rewritten extend prompt"
}`;

    const res = await fetchWithAuth(context.env, buildVertexUrl(context.env, "gemini-2.5-flash"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
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
