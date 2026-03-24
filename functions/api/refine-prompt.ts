import { GeminiEnv, fetchWithModelFallback, geminiErrorResponse, parseFirstJsonObject } from "./_gemini-keys";
import { safeDuration } from "./_duration-constants";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { videoPrompt, extendPrompt, feedback, cutNumber, mode, sceneDescription, negativePrompt, durationSeconds, previousCutPrompt, shotCategory } =
      await context.request.json() as Record<string, string | number>;

    if (!videoPrompt) {
      return Response.json({ error: "videoPrompt is required" }, { status: 400 });
    }

    const duration = safeDuration(Number(durationSeconds));
    const wordCount = String(videoPrompt).split(/\s+/).length;

    let systemPrompt: string;

    if (mode === "english-native") {
      systemPrompt = `You are a world-class prompt engineer specializing in AI video generation.
Your job: transform the input into a perfectly structured video prompt that the model will follow precisely.

## CRITICAL VIDEO GENERATION KNOWLEDGE (MUST FOLLOW)

### Temporal Structure — THE MOST IMPORTANT RULE
The model generates ${duration}-second clips. You MUST structure the prompt as a clear TIMELINE:
- "0s-2s: [opening action]"
- "2s-5s: [middle development]"
- "5s-${duration}s: [climax/resolution]"
This makes the model follow the exact sequence instead of picking random moments.

### Video Prompt Architecture (PROVEN TO WORK)
Structure EXACTLY in this order:
1. **SHOT TYPE + CAMERA** (first sentence): "Medium close-up, slow dolly in..."
2. **SUBJECT ANCHOR** (who/what is the focus): Full character description
3. **TEMPORAL BEATS** (what happens over time): The 0s-2s, 2s-5s, 5s-8s timeline
4. **ENVIRONMENT** (where): Setting, background details
5. **LIGHTING + ATMOSPHERE** (mood): Specific light sources, color temperature
6. **STYLE TAGS** (last): "cinematic, 35mm film, shallow depth of field"

### What the Model FOLLOWS Well
- Specific camera movements: "slow dolly in", "tracking left to right", "crane rising"
- Concrete physical actions: "raises hand to face", "turns head 45 degrees left"
- Lighting descriptions: "warm key light from upper left, cool fill from right"
- Material/texture keywords: "weathered leather", "silk fabric catching light"
- Emotional micro-expressions: "eyes narrowing slightly", "corners of mouth trembling"

### What the Model IGNORES or BOTCHES
- Abstract emotions without physical manifestation ("feeling sad" → use "shoulders slumped, gaze downward")
- Multiple simultaneous actions (max 2 concurrent actions per time segment)
- Precise text rendering (NEVER ask for readable text/writing/characters on screen)
- Exact numbers of objects ("three birds" → "a small flock of birds")
- Complex multi-person choreography (simplify to 1-2 key figures)

### Negative Prompt Embedding
EMBED avoidance directly into the prompt:
${negativePrompt ? `AVOID: ${String(negativePrompt)}. Weave "no X, no Y" naturally into the prompt.` : 'Add "no text, no watermark" at the end.'}

## Prompt Length Rules
- Sweet spot: 80-120 words, ≤400 characters
- Current: ~${wordCount} words ${wordCount < 40 ? "(TOO SHORT — expand)" : wordCount > 150 ? "(TOO LONG — condense to ≤120 words)" : "(good range)"}

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
${String(shotCategory) === "map-graphic" ? `
## ⚠️ MAP/GRAPHIC SCENE — CRITICAL PROTECTION RULES
This scene is a MAP or INFOGRAPHIC. You MUST:
1. Keep the cartographic/diagrammatic intent — this is a MAP viewed from above, NOT a landscape painting
2. NEVER add: cranes, birds, mountains, scenic painting elements, decorative animals, brush painting scenery
3. NEVER reinterpret the map as a landscape or East Asian painting scene
4. Camera must be: flat top-down or slight overhead angle looking DOWN at the map surface
5. Focus on: parchment texture, territorial overlays, coastlines, borders, trade routes, ink spreading on paper
6. If the style is "East Asian painting" — apply ONLY the color palette and paper texture, NOT the landscape composition
7. The scene must look like someone looking DOWN at a physical map, NOT looking OUT at a landscape` : ""}

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
  "refinedVideoPrompt": "the restructured prompt with temporal beats (TARGET: 80-120 words, ≤400 chars)",
  "refinedExtendPrompt": "restructured extend prompt if applicable",
  "wordCount": number,
  "changes": ["list of structural improvements made"]
}`;
    } else if (mode === "sanitize") {
      // Safety filter bypass: rewrite prompt removing policy-violating words
      systemPrompt = `You are a safety editor for AI video generation prompts.
The prompt below was REJECTED by safety filters.
Your job: rewrite it to pass safety filters while preserving the exact visual intent and cinematic structure.

## MANDATORY REPLACEMENT TABLE — apply ALL that match

### Medical / Procedure Imagery (VERY HIGH trigger risk)
| BANNED → | SAFE REPLACEMENT |
|---|---|
| surgery, operation, incision | clinical procedure, examination, treatment moment |
| needle, injection, syringe | medical instrument, clinical tool |
| drill, scalpel, blade (medical context) | precision instrument, clinical device |
| wound, injury, cut, laceration | treatment area, mark, affected area |
| blood, bleeding, hemorrhage | red fluid, vital signs, coloration |
| suture, stitches | closure, binding |
| anesthesia, sedation | preparation, calm state |

### Pain / Fear / Suffering (HIGH trigger risk)
| BANNED → | SAFE REPLACEMENT |
|---|---|
| pain, agony, suffering | tension, discomfort, strain |
| fear, terror, dread, horror | unease, nervousness, apprehension |
| screaming in pain, crying in agony | vocalizing, expressing strong emotion |
| trauma, traumatic | intense, overwhelming |
| torture, torment | extreme pressure, ordeal |
| panic, frantic | urgent, heightened alertness |
| helpless, trapped, desperate | constrained, seeking resolution |

### Violence / Harm (HIGHEST trigger risk)
| BANNED → | SAFE REPLACEMENT |
|---|---|
| kill, murder, death, dying | still, final moment, ceasing motion |
| dead body, corpse | figure at rest, motionless form |
| weapon (violent context) | object, tool, instrument |
| hit, punch, strike, blow (violent) | contact, impact, collision |
| stabbing, piercing | sharp contact |
| explosion (violent) | burst of energy, dramatic release |
| fight, battle, combat | struggle, contest, confrontation |
| threatening, menacing | imposing, looming, intense |
| strangle, choke | grip, grasp around |
| broken bones, fracture | physical strain, structural stress |

### Body Horror / Graphic Content
| BANNED → | SAFE REPLACEMENT |
|---|---|
| gore, visceral, gruesome | intense, raw, unflinching |
| body horror | distorted form, uncanny presence |
| graphic detail of wounds | visible treatment area |
| exposed organs, viscera | internal view → REMOVE entirely |

## Structural Rules
1. Apply ALL replacements from the table above
2. Keep all camera movements, shot types, temporal beats (0s-2s, 2s-5s, etc.) EXACTLY as-is
3. Keep character appearance descriptions EXACTLY as-is
4. Keep lighting, mood, and atmosphere intact — only replace harmful words
5. If a sentence cannot be saved without the harmful content, REFRAME it around what the character is doing physically (body language, posture, gaze) rather than what is happening TO them
6. Convert "experiencing X" → "showing body signs of X" using:
   - fear → "gaze darts, fingers tense, breath held"
   - pain → "jaw set tight, shoulders drawn up, movement suspended"
   - grief → "stillness with micro-tremor, gaze unfocused, slow exhale"
7. Output must remain in English

## Original prompt (REJECTED):
${String(videoPrompt)}

## Output JSON only (no markdown):
{
  "refinedVideoPrompt": "sanitized prompt that passes safety filters",
  "changes": ["exact word/phrase replaced → replacement, and why"]
}`;
    } else {
      // Enhancement 2: Scene feedback regeneration
      systemPrompt = `You are an AI video prompt improvement specialist for AI video generation.
The user has provided feedback about a generated video. Improve the prompts based on this feedback.

## Video Prompt Best Practices
- Structure as temporal timeline: 0s-2s, 2s-5s, 5s-${duration}s
- Start with camera/shot type
- Convert abstract descriptions to concrete visual actions
- NEVER include readable text/writing on screen
- Embed negative guidance directly ("no X") into the prompt

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
5. Output must be in English

## Output JSON only (no markdown):
{
  "refinedVideoPrompt": "improved video prompt addressing feedback",
  "refinedExtendPrompt": "improved extend prompt if applicable",
  "changes": ["what was changed based on feedback"]
}`;
    }

    const { response: res } = await fetchWithModelFallback(context.env, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("refine-prompt Gemini error:", res.status, errText.slice(0, 500));
      return geminiErrorResponse(res, errText, "refine-prompt");
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = parseFirstJsonObject(text) ?? { error: "Failed to parse" };
    }

    return Response.json(parsed);
  } catch (error) {
    console.error("Refine prompt error:", error);
    return Response.json({ error: "Failed to refine prompt" }, { status: 500 });
  }
};
