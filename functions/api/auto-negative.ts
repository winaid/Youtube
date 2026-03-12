import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_PRO, geminiErrorResponse } from "./_gemini-keys";

type Env = GeminiEnv;

// Scene content → smart negative prompts to prevent common Veo artifacts
const SCENE_PATTERN_NEGATIVES: Record<string, string[]> = {
  // Face/person related
  face: ["distorted face", "asymmetric eyes", "extra fingers", "deformed hands", "uncanny valley", "blurry facial features"],
  person: ["distorted face", "deformed body proportions", "extra limbs", "floating limbs", "disconnected body parts"],
  crowd: ["cloned faces", "identical people", "merged bodies", "overlapping figures"],
  child: ["adult proportions on child", "uncanny face", "distorted child features"],

  // Text related
  text: ["garbled text", "broken letters", "unreadable text", "text corruption", "misspelled words", "random characters"],
  sign: ["illegible sign", "garbled text on sign", "distorted letters"],
  title: ["corrupted title text", "broken font rendering"],

  // Nature/environment
  water: ["unrealistic water physics", "frozen water motion", "water clipping through objects"],
  sky: ["banded sky gradient", "pixelated clouds", "flat sky"],
  fire: ["static fire", "unrealistic flame shape", "fire clipping"],
  rain: ["static rain drops", "rain going upward", "unrealistic rain"],

  // Motion related
  walk: ["sliding feet", "skating motion", "feet not touching ground", "unrealistic gait"],
  run: ["floating runner", "legs merging", "unnatural running motion"],
  drive: ["wheels not spinning", "car floating", "unrealistic vehicle motion"],
  fight: ["limbs passing through body", "unrealistic impact", "floating weapons"],

  // Style related
  anime: ["3D render artifacts in 2D scene", "inconsistent art style", "broken line art"],
  realistic: ["uncanny valley", "plastic skin texture", "dead eyes", "wax figure appearance"],
  vintage: ["digital artifacts in film stock", "inconsistent grain pattern"],
};

// Universal negatives that should always be included
const UNIVERSAL_NEGATIVES = [
  "watermark",
  "logo",
  "text overlay",
  "title card",
  "caption",
  "subtitle",
  "on-screen text",
  "written characters",
  "calligraphy overlay",
  "stamp",
  "typography",
  "floating text",
  "text on screen",
  "UI elements",
  "black bars",
  "split screen",
  "side by side comparison",
];

// Map scene negatives — prevent rectangular artifacts from label/sign/frame misinterpretation
const MAP_SCENE_NEGATIVES = [
  "boxes",
  "rectangular overlay",
  "UI panels",
  "text boxes",
  "labels",
  "signboards",
  "framed inserts",
  "infographic elements",
  "cartouche",
  "decorative panels",
  "floating panels",
  "boxed annotations",
  "title boxes",
  "caption boxes",
  "embedded signage",
];

// Cinematic realism + 3D/CGI drift prevention
// Injected when "cinematic realism" style is detected alongside terrain/map content
const CINEMATIC_REALISM_ANTI_3D_NEGATIVES = [
  "3D render",
  "CGI",
  "glossy render",
  "game map",
  "strategy game UI",
  "miniature diorama",
  "plastic terrain model",
  "fantasy map",
  "3D globe",
  "rendered terrain",
  "game-map look",
  "satellite imagery",
  "real landscape photo",
];

function generateLocalNegative(videoPrompt: string, sceneDescription: string, isMapScene?: boolean): string {
  const combined = (videoPrompt + " " + sceneDescription).toLowerCase();
  const negatives = new Set<string>(UNIVERSAL_NEGATIVES);

  for (const [pattern, negs] of Object.entries(SCENE_PATTERN_NEGATIVES)) {
    if (combined.includes(pattern)) {
      for (const neg of negs) {
        negatives.add(neg);
      }
    }
  }

  // Map scene: 사각형 아티팩트 방지 negative 자동 추가
  const detectedMapScene = isMapScene || /\b(map|terrain|topograph|cartograph|satellite|aerial\s+view|bird.?s?\s+eye|globe|continent|border|region|territory)\b/i.test(combined);
  if (detectedMapScene) {
    for (const neg of MAP_SCENE_NEGATIVES) {
      negatives.add(neg);
    }
  }

  // Cinematic realism + terrain/map: 3D/CGI drift 방지
  const isCinematicRealism = /cinematic\s*realism/i.test(combined);
  const has3DTrigger = /\b(3d|topograph|terrain|map|relief|globe|continent|render)/i.test(combined);
  if (isCinematicRealism && (detectedMapScene || has3DTrigger)) {
    for (const neg of CINEMATIC_REALISM_ANTI_3D_NEGATIVES) {
      negatives.add(neg);
    }
  }

  return Array.from(negatives).join(", ");
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { videoPrompt, sceneDescription, animationMode, useAI } =
      await context.request.json() as Record<string, string | boolean>;

    if (!videoPrompt) {
      return Response.json({ error: "videoPrompt is required" }, { status: 400 });
    }

    // Fast local-only mode (no API call)
    if (!useAI) {
      const negativePrompt = generateLocalNegative(
        String(videoPrompt),
        String(sceneDescription || "")
      );
      return Response.json({ negativePrompt, mode: "local" });
    }

    const prompt = `You are a Veo 3.1 video generation expert. Analyze this scene and generate a negative prompt to prevent common artifacts.

## Scene:
- Video Prompt: ${String(videoPrompt).slice(0, 1000)}
- Description: ${String(sceneDescription || "").slice(0, 500)}
- Animation Mode: ${String(animationMode || "cinematic")}

## Rules:
1. Identify potential visual artifacts based on scene content
2. Focus on Veo-specific issues: face distortion, text corruption, motion artifacts, style inconsistency
3. Include universal negatives: watermark, logo, text overlay
4. Be specific to the scene content (e.g., if there are people, add face/body negatives)
5. Keep under 100 words total
6. Return ONLY comma-separated negative terms, no explanation

## Output:
Return ONLY the negative prompt string, nothing else.`;

    const res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, GEMINI_MODEL_PRO), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Auto negative Gemini error:", res.status, errText);
      return geminiErrorResponse(res, errText, "auto-negative");
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    // Combine AI result with universal negatives
    const aiNegatives = text.replace(/^["']|["']$/g, "").trim();
    const localNegatives = generateLocalNegative(
      String(videoPrompt),
      String(sceneDescription || "")
    );

    // Merge and deduplicate
    const allTerms = new Set<string>();
    for (const term of localNegatives.split(",").map((t) => t.trim()).filter(Boolean)) {
      allTerms.add(term);
    }
    for (const term of aiNegatives.split(",").map((t) => t.trim()).filter(Boolean)) {
      allTerms.add(term);
    }

    return Response.json({
      negativePrompt: Array.from(allTerms).join(", "),
      mode: "ai-enhanced",
    });
  } catch (error) {
    console.error("Auto negative error:", error);
    return Response.json({ error: "Failed to generate negative prompt" }, { status: 500 });
  }
};
