import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { videoPrompt, extendPrompt, feedback, cutNumber, mode, sceneDescription, negativePrompt, durationSeconds, previousCutPrompt } =
      await context.request.json() as Record<string, string | number>;

    if (!videoPrompt) {
      return Response.json({ error: "videoPrompt is required" }, { status: 400 });
    }

    const duration = Number(durationSeconds) || 8;
    const wordCount = String(videoPrompt).split(/\s+/).length;

    let systemPrompt: string;

    if (mode === "english-native") {
      systemPrompt = `You are a world-class prompt engineer specializing in Google Veo 3.1 video generation.
Your job: transform the input into a perfectly structured Veo prompt that the model will follow precisely.

## CRITICAL VEO 3.1 KNOWLEDGE (MUST FOLLOW)

### Temporal Structure — THE MOST IMPORTANT RULE
Veo generates ${duration}-second clips. You MUST structure the prompt as a clear TIMELINE:
- "0s-2s: [opening action]"
- "2s-5s: [middle development]"
- "5s-${duration}s: [climax/resolution]"
This makes Veo follow the exact sequence instead of picking random moments.

### Veo Prompt Architecture (PROVEN TO WORK)
Structure EXACTLY in this order:
1. **SHOT TYPE + CAMERA** (first sentence): "Medium close-up, slow dolly in..."
2. **SUBJECT ANCHOR** (who/what is the focus): Full character description
3. **TEMPORAL BEATS** (what happens over time): The 0s-2s, 2s-5s, 5s-8s timeline
4. **ENVIRONMENT** (where): Setting, background details
5. **LIGHTING + ATMOSPHERE** (mood): Specific light sources, color temperature
6. **STYLE TAGS** (last): "cinematic, 35mm film, shallow depth of field"

### What Veo FOLLOWS Well
- Specific camera movements: "slow dolly in", "tracking left to right", "crane rising"
- Concrete physical actions: "raises hand to face", "turns head 45 degrees left"
- Lighting descriptions: "warm key light from upper left, cool fill from right"
- Material/texture keywords: "weathered leather", "silk fabric catching light"
- Emotional micro-expressions: "eyes narrowing slightly", "corners of mouth trembling"

### What Veo IGNORES or BOTCHES
- Abstract emotions without physical manifestation ("feeling sad" → use "shoulders slumped, gaze downward")
- Multiple simultaneous actions (max 2 concurrent actions per time segment)
- Precise text rendering (NEVER ask for readable text/writing/characters on screen)
- Exact numbers of objects ("three birds" → "a small flock of birds")
- Complex multi-person choreography (simplify to 1-2 key figures)

### Negative Prompt Embedding (Veo has NO negative prompt parameter!)
Since Veo API doesn't accept negativePrompt, EMBED avoidance directly:
${negativePrompt ? `AVOID: ${String(negativePrompt)}. Weave "no X, no Y" naturally into the prompt.` : 'Add "no text overlay, no watermark" at the end.'}

## Prompt Length Rules
- Sweet spot: 180-280 words
- Current: ~${wordCount} words ${wordCount < 100 ? "(TOO SHORT — expand significantly)" : wordCount > 350 ? "(TOO LONG — condense)" : "(good range)"}

## Korean → English Term Mapping
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

## Context
${sceneDescription ? `Scene intent: ${String(sceneDescription).slice(0, 300)}` : ""}
${previousCutPrompt ? `Previous cut ended with: ${String(previousCutPrompt).slice(0, 200)}` : ""}

## Original Video Prompt (CUT ${cutNumber || 1}):
${String(videoPrompt)}

${extendPrompt ? `## Original Extend Prompt:\n${String(extendPrompt)}` : ""}

## Rules:
1. MUST include temporal beats (0s-2s, 2s-5s, 5s-${duration}s)
2. MUST start with shot type + camera movement
3. Keep character appearance descriptions EXACTLY as provided (do not add/remove features)
4. Convert all abstract emotions to visible physical actions
5. Limit to 2 concurrent actions per time segment
6. NEVER include readable text, writing, calligraphy on screen
7. Use active voice, present tense throughout
8. End with style tags and "no text, no watermark"

## Output JSON only (no markdown):
{
  "refinedVideoPrompt": "the restructured prompt with temporal beats (TARGET: 200-250 words)",
  "refinedExtendPrompt": "restructured extend prompt if applicable",
  "wordCount": number,
  "changes": ["list of structural improvements made"]
}`;
    } else {
      // Enhancement 2: Scene feedback regeneration
      systemPrompt = `You are an AI video prompt improvement specialist for Google Veo 3.1.
The user has provided feedback about a generated video. Improve the prompts based on this feedback.

## Veo 3.1 Prompt Best Practices
- Structure as temporal timeline: 0s-2s, 2s-5s, 5s-${duration}s
- Start with camera/shot type
- Convert abstract descriptions to concrete visual actions
- NEVER include readable text/writing on screen
- Embed negative guidance directly ("no X") since Veo has no negativePrompt parameter

## Current Prompts (CUT ${cutNumber || 1}):
- Video Prompt: ${String(videoPrompt)}
${extendPrompt ? `- Extend Prompt: ${String(extendPrompt)}` : ""}
${sceneDescription ? `- Scene Description: ${String(sceneDescription).slice(0, 300)}` : ""}

## User Feedback:
${String(feedback || "Make it better")}

## Rules:
1. Address the user's specific feedback as the TOP priority
2. Keep character descriptions 100% consistent — do NOT change character appearance
3. Restructure with temporal beats if not already present
4. Convert any vague feedback into concrete visual directions
5. Output must be in English for Veo

## Output JSON only (no markdown):
{
  "refinedVideoPrompt": "improved video prompt addressing feedback",
  "refinedExtendPrompt": "improved extend prompt if applicable",
  "changes": ["what was changed based on feedback"]
}`;
    }

    const res = await fetchWithAuth(context.env, buildVertexUrl(context.env, "gemini-3-flash-preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
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
