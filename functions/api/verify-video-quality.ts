import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { frameBase64, videoPrompt, sceneDescription, cutNumber } =
      await context.request.json() as Record<string, string | number>;

    if (!frameBase64) {
      return Response.json({ error: "frameBase64 is required" }, { status: 400 });
    }

    const prompt = `You are a video quality assessment AI. Analyze this frame captured from a generated video and score it.

## Original Intent:
- Video Prompt: ${String(videoPrompt || "").slice(0, 800)}
- Scene Description: ${String(sceneDescription || "").slice(0, 400)}
- Cut Number: ${cutNumber || 1}

## Score these aspects (0-10 each):
1. **promptMatch**: Does the frame match the prompt description? (characters, setting, action)
2. **visualQuality**: Image sharpness, clarity, no artifacts
3. **faceQuality**: If faces are present - are they natural and consistent? (10 if no faces)
4. **motionCoherence**: Does the frame suggest smooth, natural motion? (based on motion blur, pose naturalness)
5. **styleConsistency**: Does the visual style match the requested animation/film style?
6. **composition**: Is the framing and composition good? (rule of thirds, leading lines, depth)

## Output JSON only (no markdown):
{
  "overallScore": 0-100,
  "scores": {
    "promptMatch": 0-10,
    "visualQuality": 0-10,
    "faceQuality": 0-10,
    "motionCoherence": 0-10,
    "styleConsistency": 0-10,
    "composition": 0-10
  },
  "issues": ["list of specific problems found"],
  "suggestion": "one-sentence suggestion for improvement if score < 70"
}`;

    const res = await fetchWithAuth(context.env, buildVertexUrl(context.env, "gemini-3-flash-preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: String(frameBase64).replace(/^data:image\/\w+;base64,/, ""),
              },
            },
          ],
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Vision verify error:", res.status, errText);
      return Response.json({ error: `Gemini API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { overallScore: 0, issues: ["Failed to parse"] };
    }

    return Response.json(parsed);
  } catch (error) {
    console.error("Video quality verify error:", error);
    return Response.json({ error: "Failed to verify video quality" }, { status: 500 });
  }
};
