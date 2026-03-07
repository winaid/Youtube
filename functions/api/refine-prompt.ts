interface Env {
  GEMINI_API_KEY: string;
}

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { videoPrompt, extendPrompt, feedback, cutNumber, mode } =
      await context.request.json() as Record<string, string | number>;

    if (!videoPrompt) {
      return Response.json({ error: "videoPrompt is required" }, { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    let systemPrompt: string;

    if (mode === "english-native") {
      // Enhancement 3: Veo prompt English native correction + Prompt Length Optimizer
      systemPrompt = `You are an expert at writing prompts for Google Veo video generation AI.
Your task is to refine the following video generation prompt to use more natural, precise English that Veo understands best.

## CRITICAL: Prompt Length Rules
- Veo works BEST with prompts between 150-300 words (the sweet spot)
- Under 100 words: TOO SHORT — add specific camera, lighting, atmosphere, texture details
- Over 350 words: TOO LONG — condense redundant descriptions, merge similar concepts
- Current prompt word count: approximately ${String(videoPrompt).split(/\s+/).length} words

## Korean → English Term Optimization
Replace any Korean film terms with Veo-optimized English:
- 클로즈업 → "extreme close-up shot"
- 달리 인 → "slow dolly in toward the subject"
- 트래킹 샷 → "lateral tracking shot following the subject"
- 핸드헬드 → "handheld camera, slight organic shake"
- 크레인 샷 → "crane shot sweeping upward"
- 랙 포커스 → "rack focus shifting from foreground to background"
- 롱테이크 → "long continuous take without cuts"
- 역광 → "strong backlight, lens flare"
- 골든아워 → "golden hour warm sunlight, long shadows"
- 키아로스쿠로 → "chiaroscuro lighting, dramatic contrast"
- 볼류메트릭 라이트 → "volumetric light rays, god rays through dust"

## Rules:
1. Use cinematic terminology that Veo responds well to: "tracking shot", "dolly in", "rack focus", "whip pan", "crane shot", "steadicam", "handheld"
2. Replace vague descriptions with specific, visual language
3. Use active voice and present tense
4. Structure: [Camera] → [Subject/Action] → [Lighting/Mood] → [Style]
5. Avoid redundancy and filler words
6. Keep character descriptions intact and complete
7. Ensure smooth temporal flow for 8-second clips
8. Add cinematic keywords Veo responds to: "cinematic", "film grain", "depth of field", "bokeh", "anamorphic"
9. TARGET 200-250 words for optimal Veo performance
10. If Korean terms exist, replace with the English equivalents above

## Original Video Prompt (CUT ${cutNumber || 1}):
${String(videoPrompt)}

${extendPrompt ? `## Original Extend Prompt:\n${String(extendPrompt)}` : ""}

## Output JSON only (no markdown):
{
  "refinedVideoPrompt": "the native-corrected video prompt (TARGET: 200-250 words)",
  "refinedExtendPrompt": "the native-corrected extend prompt (if applicable)",
  "wordCount": number,
  "changes": ["list of what was changed and why"]
}`;
    } else {
      // Enhancement 2: Scene feedback regeneration
      systemPrompt = `You are an AI video prompt improvement specialist.
The user has provided feedback about a storyboard scene. Improve the prompts based on this feedback.

## Current Prompts (CUT ${cutNumber || 1}):
- Video Prompt: ${String(videoPrompt)}
${extendPrompt ? `- Extend Prompt: ${String(extendPrompt)}` : ""}

## User Feedback:
${String(feedback || "Make it better")}

## Rules:
1. Address the user's specific feedback
2. Keep character descriptions 100% consistent — do NOT change character appearance
3. Maintain the same camera movement structure but adjust as needed
4. Keep the same overall scene intent
5. Output must be in English for Veo

## Output JSON only (no markdown):
{
  "refinedVideoPrompt": "improved video prompt addressing feedback",
  "refinedExtendPrompt": "improved extend prompt if applicable",
  "changes": ["what was changed based on feedback"]
}`;
    }

    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Refine prompt error:", res.status, errText);
      return Response.json({ error: `Gemini API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: "Failed to parse" };
    }

    return Response.json(parsed);
  } catch (error) {
    console.error("Refine prompt error:", error);
    return Response.json({ error: "Failed to refine prompt" }, { status: 500 });
  }
};
