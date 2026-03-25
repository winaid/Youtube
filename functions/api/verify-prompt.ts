import { GeminiEnv, fetchWithModelFallback, geminiErrorResponse, parseFirstJsonObject } from "./_gemini-keys";
import { safeDuration } from "./_duration-constants";

type Env = GeminiEnv;

// ── 씬 타입 정의 ─────────────────────────────────────────────────────────────
type SceneType = "character" | "environment" | "object-detail" | "map-graphic" | "transition-abstract";

// ── 다단계 JSON 파싱 ──────────────────────────────────────────────────────────
function tryParseJson(raw: string): Record<string, unknown> | null {
  const attempts: string[] = [];
  attempts.push(raw.trim());
  attempts.push(
    raw
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim()
  );
  const balanced = parseFirstJsonObject(raw);
  if (balanced) return balanced;

  for (const s of attempts) {
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 다음 시도
    }
  }

  const scoreMatch = raw.match(/"?overallScore"?\s*:\s*(\d+)/i);
  if (scoreMatch) {
    const partial: Record<string, unknown> = {
      overallScore: parseInt(scoreMatch[1], 10),
    };
    const issuesMatch = raw.match(/"?issues"?\s*:\s*\[([\s\S]*?)\]/i);
    if (issuesMatch) {
      try { partial.issues = JSON.parse(`[${issuesMatch[1]}]`); } catch { partial.issues = []; }
    }
    const suggestMatch = raw.match(/"?suggestions"?\s*:\s*\[([\s\S]*?)\]/i);
    if (suggestMatch) {
      try { partial.suggestions = JSON.parse(`[${suggestMatch[1]}]`); } catch { partial.suggestions = []; }
    }
    return partial;
  }
  return null;
}

// ── 씬 타입 감지 ─────────────────────────────────────────────────────────────
function detectSceneType(
  videoPrompt: string,
  shotCategory?: string,
  characterRole?: string,
): SceneType {
  // 1. 명시적 shotCategory가 있으면 매핑
  if (shotCategory) {
    const map: Record<string, SceneType> = {
      "character-driven": "character",
      "environment": "environment",
      "object-detail": "object-detail",
      "map-graphic": "map-graphic",
      "transition-atmosphere": "transition-abstract",
    };
    if (map[shotCategory]) return map[shotCategory];
  }

  // 2. characterRole이 absent이면 캐릭터 아님
  if (characterRole === "absent") {
    // 맵/그래픽 키워드
    if (/\b(map|terrain|topograph|cartograph|infograph|satellite|aerial\s+view|bird.?s?\s+eye|globe|continent|border|region|province|territory)\b/i.test(videoPrompt)) {
      return "map-graphic";
    }
    // 환경 키워드
    if (/\b(landscape|cityscape|skyline|mountain|forest|ocean|desert|field|valley|panoram)\b/i.test(videoPrompt)) {
      return "environment";
    }
    // 오브젝트 디테일
    if (/\b(close.?up|macro|detail|object|artifact|prop|item|document|letter|phone|screen)\b/i.test(videoPrompt)) {
      return "object-detail";
    }
    return "transition-abstract";
  }

  // 3. 프롬프트 내용 기반 추론
  const promptLower = videoPrompt.toLowerCase();
  if (/\b(map|terrain|topograph|satellite|aerial\s+view|bird.?s?\s+eye|globe|continent|border|region|province)\b/i.test(promptLower)) {
    return "map-graphic";
  }
  if (/\b(person|character|man|woman|boy|girl|child|figure|face|hair|outfit|wearing)\b/i.test(promptLower)) {
    return "character";
  }
  if (/\b(landscape|cityscape|panoram|skyline|mountain|ocean|field)\b/i.test(promptLower)) {
    return "environment";
  }
  if (/\b(close.?up|macro|detail shot|object|artifact)\b/i.test(promptLower)) {
    return "object-detail";
  }

  return "character"; // default
}

// ── 씬 타입별 평가 기준 생성 ─────────────────────────────────────────────────
function buildSceneTypePrompt(sceneType: SceneType, duration: number, wordCount: number): string {
  const wordRange: Record<SceneType, { min: number; max: number }> = {
    "character": { min: 80, max: 350 },
    "environment": { min: 60, max: 300 },
    "object-detail": { min: 50, max: 250 },
    "map-graphic": { min: 40, max: 250 },
    "transition-abstract": { min: 40, max: 200 },
  };
  const range = wordRange[sceneType];

  const sceneTypeLabel: Record<SceneType, string> = {
    "character": "Character-Driven Scene",
    "environment": "Environment/Landscape Scene",
    "object-detail": "Object/Detail Close-up Scene",
    "map-graphic": "Map/Infographic/Aerial Scene",
    "transition-abstract": "Transition/Abstract/Mood Scene",
  };

  // 공통 헤더
  let prompt = `## Scene Type: ${sceneTypeLabel[sceneType]}
- Duration: ${duration} seconds
- Word count: ~${wordCount} words (target: ${range.min}-${range.max} words)

`;

  if (sceneType === "character") {
    prompt += `## Review Criteria (Character Scene — 5 axes)

1. **Character Description Completeness** (0-10):
   - MUST have: hair style+color, outfit details, approximate age, skin tone
   - DEDUCTION: vague references like "the character", "same person" without redescription

2. **Camera Movement Quality** (0-10):
   - MUST use recognized terms: "dolly", "tracking", "crane", "pan", "tilt", "steadicam"
   - DEDUCTION: abstract camera without specific movement type

3. **Temporal Structure** (0-10): *** MOST CRITICAL ***
   - MUST have clear time-based progression for ${duration} seconds
   - BEST: explicit "0s-2s: ..., 2s-5s: ..." format
   - DEDUCTION: no temporal markers = score ≤ 4

4. **Lighting/Mood Specificity** (0-10):
   - MUST name light sources and direction: "warm key light from upper left"
   - DEDUCTION: just "dramatic lighting" without specifics

5. **Video Compatibility** (0-10):
   - DEDUCTION: requests for readable text, exact object counts, abstract emotions
   - DEDUCTION: prompt over ${range.max} words or under ${range.min} words

## Output JSON only:
{
  "detectedSceneType": "character",
  "overallScore": 0-100,
  "scores": {
    "characterDescription": 0-10,
    "cameraMovement": 0-10,
    "temporalStructure": 0-10,
    "lightingMood": 0-10,
    "videoCompatibility": 0-10
  },
  },
  "issues": ["specific problems"],
  "suggestions": ["concrete improvements"],
  "improvedVideoPrompt": "ONLY if score < 80: rewritten prompt",
  "improvedExtendPrompt": "ONLY if score < 80 and extend exists"
}`;
  } else if (sceneType === "environment") {
    prompt += `## Review Criteria (Environment Scene — 5 axes, NO character penalty)

1. **Spatial Composition** (0-10):
   - MUST have: clear foreground/midground/background layering
   - MUST have: identifiable location objects (buildings, trees, landmarks)
   - DEDUCTION: vague "beautiful landscape" without concrete visual anchors

2. **Camera Movement Quality** (0-10):
   - BEST: slow establishing shots — pan, crane, drone-style flyover
   - DEDUCTION: character-focused camera work (OTS, MCU) in environment scene

3. **Temporal Structure** (0-10): *** MOST CRITICAL ***
   - MUST have time-based progression showing spatial exploration
   - BEST: "0s-3s: wide establishing, 3s-6s: camera reveals detail, 6s-${duration}s: final vista"

4. **Atmospheric Detail** (0-10):
   - MUST have: specific lighting (golden hour, overcast, blue hour)
   - MUST have: weather/atmosphere cues (mist, rain, wind in trees)
   - DEDUCTION: generic mood words without visual specifics

5. **Video Compatibility** (0-10):
   - DEDUCTION: text/signage, exact object counts
   - DEDUCTION: prompt over ${range.max} words or under ${range.min} words
   - BONUS: natural environmental motion (wind, water, light shifts)

## Output JSON only:
{
  "detectedSceneType": "environment",
  "overallScore": 0-100,
  "scores": {
    "spatialComposition": 0-10,
    "cameraMovement": 0-10,
    "temporalStructure": 0-10,
    "atmosphericDetail": 0-10,
    "videoCompatibility": 0-10
  },
  "issues": ["specific problems"],
  "suggestions": ["concrete improvements"],
  "improvedVideoPrompt": "ONLY if score < 80",
  "improvedExtendPrompt": "ONLY if score < 80 and extend exists"
}`;
  } else if (sceneType === "object-detail") {
    prompt += `## Review Criteria (Object/Detail Scene — 5 axes, NO character penalty)

1. **Subject Clarity** (0-10):
   - MUST have: specific object identification with material/texture
   - MUST have: scale reference or context
   - DEDUCTION: vague object description

2. **Camera Technique** (0-10):
   - BEST: macro, rack focus, slow dolly around object, reveal shots
   - DEDUCTION: wide shots for detail scenes

3. **Temporal Structure** (0-10):
   - Object scenes need reveal-explore-context progression
   - BEST: "0s-2s: object revealed, 2s-5s: detail exploration, 5s-${duration}s: contextual pull-back"

4. **Lighting/Texture Detail** (0-10):
   - MUST have: lighting that reveals material qualities
   - BONUS: specular highlights, surface texture, depth of field

5. **Video Compatibility** (0-10):
   - DEDUCTION: readable text on objects, complex mechanical motion
   - DEDUCTION: prompt over ${range.max} words or under ${range.min} words

## Output JSON only:
{
  "detectedSceneType": "object-detail",
  "overallScore": 0-100,
  "scores": {
    "subjectClarity": 0-10,
    "cameraTechnique": 0-10,
    "temporalStructure": 0-10,
    "lightingTexture": 0-10,
    "videoCompatibility": 0-10
  },
  "issues": ["specific problems"],
  "suggestions": ["concrete improvements"],
  "improvedVideoPrompt": "ONLY if score < 80",
  "improvedExtendPrompt": "ONLY if score < 80 and extend exists"
}`;
  } else if (sceneType === "map-graphic") {
    prompt += `## Review Criteria (Map/Infographic/Aerial Scene — 5 axes)
⚠️ This is a MAP scene. Do NOT penalize for missing character descriptions.
⚠️ Maps communicate through terrain, color overlays, and spatial relationships — NOT through characters.

1. **Terrain/Geographic Detail** (0-10):
   - MUST have: specific terrain features (mountains, rivers, plains, coastline)
   - MUST have: regional/geographic distinctions (colors, textures per area)
   - BONUS: topographic relief, elevation hints
   - DEDUCTION: flat featureless surface

2. **Visual Clarity & Readability** (0-10):
   - MUST have: clear spatial relationships between regions
   - Instead of text labels, use: colored overlays, glowing boundaries, relief shading, icon markers, highlight zones
   - DEDUCTION: cluttered visuals, unclear boundaries
   - BONUS: smooth camera path that guides viewer through spatial information

3. **Camera & Motion Clarity** (0-10):
   - BEST: smooth aerial flyover, slow zoom revealing regions, pan across terrain
   - DEDUCTION: erratic camera, character-focused camera angles
   - BONUS: motivated camera path (following a route, river, coastline)

4. **Lighting & Atmosphere** (0-10):
   - MUST have: lighting that enhances terrain readability
   - BONUS: volumetric atmosphere, time-of-day cues, weather patterns
   - DEDUCTION: flat lighting that hides terrain features

5. **Video Compatibility** (0-10):
   - CRITICAL: NO readable text, labels, or captions (the model cannot render text)
   - Use visual alternatives: colored regions, glowing borders, pulsing highlights
   - DEDUCTION: any request for text/labels/numbers on the map
   - DEDUCTION: prompt over ${range.max} words or under ${range.min} words

## Output JSON only:
{
  "detectedSceneType": "map-graphic",
  "overallScore": 0-100,
  "scores": {
    "terrainDetail": 0-10,
    "visualClarity": 0-10,
    "cameraMotion": 0-10,
    "lightingAtmosphere": 0-10,
    "videoCompatibility": 0-10
  },
  "issues": ["specific problems"],
  "suggestions": ["concrete improvements — for text alternatives suggest: colored overlays, glowing boundary lines, relief regions, icon markers, pulsing highlight zones"],
  "improvedVideoPrompt": "ONLY if score < 80: rewrite replacing all text/label requests with visual alternatives",
  "improvedExtendPrompt": "ONLY if score < 80 and extend exists"
}`;
  } else {
    // transition-abstract
    prompt += `## Review Criteria (Transition/Abstract Scene — 5 axes, NO character penalty)

1. **Visual Concept Clarity** (0-10):
   - MUST have: clear visual metaphor or atmospheric goal
   - DEDUCTION: vague "abstract" without concrete visual elements

2. **Camera/Motion Design** (0-10):
   - BEST: motivated camera transitions, dolly/crane moves
   - BONUS: smooth in/out transitions connecting to adjacent scenes

3. **Temporal Progression** (0-10):
   - Even abstract scenes need visual evolution over ${duration}s
   - BEST: transformation, reveal, or shift in visual elements

4. **Mood/Atmosphere** (0-10):
   - MUST have: specific color palette, lighting quality
   - BONUS: particle effects, volumetric light, environmental motion

5. **Video Compatibility** (0-10):
   - DEDUCTION: text, complex physics simulations
   - DEDUCTION: prompt over ${range.max} words or under ${range.min} words

## Output JSON only:
{
  "detectedSceneType": "transition-abstract",
  "overallScore": 0-100,
  "scores": {
    "visualConcept": 0-10,
    "cameraMotion": 0-10,
    "temporalProgression": 0-10,
    "moodAtmosphere": 0-10,
    "videoCompatibility": 0-10
  },
  "issues": ["specific problems"],
  "suggestions": ["concrete improvements"],
  "improvedVideoPrompt": "ONLY if score < 80",
  "improvedExtendPrompt": "ONLY if score < 80 and extend exists"
}`;
  }

  return prompt;
}

// ── 필드명 정규화 ─────────────────────────────────────────────────────────────
function normalizeScore(obj: Record<string, unknown>): number {
  const v =
    obj.overallScore ??
    obj.overall_score ??
    obj.score ??
    obj.totalScore ??
    obj.total_score;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(100, n) : -1;
}

function normalizeSceneTypeScores(
  obj: Record<string, unknown>,
  sceneType: SceneType,
): { legacy: Record<string, number>; typed: Record<string, number> } {
  const raw =
    (obj.scores as Record<string, unknown>) ??
    (obj.subscores as Record<string, unknown>) ??
    (obj.sub_scores as Record<string, unknown>) ??
    {};
  const get = (keys: string[]) => {
    for (const k of keys) {
      const v = Number(raw[k]);
      if (Number.isFinite(v)) return Math.min(10, Math.max(0, v));
    }
    return 0;
  };

  // 씬 타입별 원본 점수 추출
  const typed: Record<string, number> = {};
  if (sceneType === "character") {
    typed.characterDescription = get(["characterDescription", "character_description", "character"]);
    typed.cameraMovement = get(["cameraMovement", "camera_movement", "camera"]);
    typed.temporalStructure = get(["temporalStructure", "temporal_structure", "actionSequence", "action_sequence", "temporal"]);
    typed.lightingMood = get(["lightingMood", "lighting_mood", "lighting"]);
    typed.videoCompatibility = get(["videoCompatibility", "video_compatibility", "videoCompatibility", "veo_compatibility", "compatibility"]);
  } else if (sceneType === "environment") {
    typed.spatialComposition = get(["spatialComposition", "spatial_composition"]);
    typed.cameraMovement = get(["cameraMovement", "camera_movement", "camera"]);
    typed.temporalStructure = get(["temporalStructure", "temporal_structure"]);
    typed.atmosphericDetail = get(["atmosphericDetail", "atmospheric_detail"]);
    typed.videoCompatibility = get(["videoCompatibility", "video_compatibility", "videoCompatibility", "veo_compatibility", "compatibility"]);
  } else if (sceneType === "object-detail") {
    typed.subjectClarity = get(["subjectClarity", "subject_clarity"]);
    typed.cameraTechnique = get(["cameraTechnique", "camera_technique"]);
    typed.temporalStructure = get(["temporalStructure", "temporal_structure"]);
    typed.lightingTexture = get(["lightingTexture", "lighting_texture"]);
    typed.videoCompatibility = get(["videoCompatibility", "video_compatibility", "videoCompatibility", "veo_compatibility", "compatibility"]);
  } else if (sceneType === "map-graphic") {
    typed.terrainDetail = get(["terrainDetail", "terrain_detail"]);
    typed.visualClarity = get(["visualClarity", "visual_clarity"]);
    typed.cameraMotion = get(["cameraMotion", "camera_motion"]);
    typed.lightingAtmosphere = get(["lightingAtmosphere", "lighting_atmosphere"]);
    typed.videoCompatibility = get(["videoCompatibility", "video_compatibility", "videoCompatibility", "veo_compatibility", "compatibility"]);
  } else {
    typed.visualConcept = get(["visualConcept", "visual_concept"]);
    typed.cameraMotion = get(["cameraMotion", "camera_motion"]);
    typed.temporalProgression = get(["temporalProgression", "temporal_progression"]);
    typed.moodAtmosphere = get(["moodAtmosphere", "mood_atmosphere"]);
    typed.videoCompatibility = get(["videoCompatibility", "video_compatibility", "videoCompatibility", "veo_compatibility", "compatibility"]);
  }

  // 레거시 호환 점수 매핑 (기존 UI와 호환)
  const typedValues = Object.values(typed);
  const legacy = {
    characterDescription: sceneType === "character" ? (typed.characterDescription ?? 0) : (typedValues[0] ?? 0),
    cameraMovement: typed.cameraMovement ?? typed.cameraTechnique ?? typed.cameraMotion ?? 0,
    actionSequence: typed.temporalStructure ?? typed.temporalProgression ?? (typedValues[2] ?? 0),
    lightingMood: typed.lightingMood ?? typed.atmosphericDetail ?? typed.lightingTexture ?? typed.lightingAtmosphere ?? typed.moodAtmosphere ?? 0,
    videoCompatibility: typed.videoCompatibility ?? 0,
  };

  return { legacy, typed };
}

function normalizeStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.length > 0) return [v];
  return [];
}

// ── 메인 핸들러 ───────────────────────────────────────────────────────────────

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json() as Record<string, string | number>;
    const { videoPrompt, extendPrompt, imagePrompt, sceneDescription, cutNumber, durationSeconds } = body;
    const shotCategory = body.shotCategory as string | undefined;
    const characterRole = body.characterRole as string | undefined;

    if (!videoPrompt) {
      return Response.json({ error: "videoPrompt is required" }, { status: 400 });
    }

    const duration = safeDuration(Number(durationSeconds));
    const wordCount = String(videoPrompt).split(/\s+/).length;

    // 씬 타입 감지
    const sceneType = detectSceneType(String(videoPrompt), shotCategory, characterRole);
    console.log(`[verify-prompt] CUT ${cutNumber} — 감지된 씬 타입: ${sceneType} (shotCategory: ${shotCategory || "none"}, characterRole: ${characterRole || "none"})`);

    // 씬 타입별 평가 기준 생성
    const sceneTypeCriteria = buildSceneTypePrompt(sceneType, duration, wordCount);

    const systemPrompt = `You are an AI video generation prompt QA expert. Review the following prompt for issues that cause the video model to deviate from user intent.

## Language Instructions
issues와 suggestions 배열의 내용은 반드시 한국어로 작성하라. improvedVideoPrompt와 improvedExtendPrompt는 영어로 작성하라.

## Prompt to Review
- Scene: CUT ${cutNumber || 1}
- Duration: ${duration} seconds
- Word count: ~${wordCount} words
- Video Prompt: ${String(videoPrompt)}
${extendPrompt ? `- Extend Prompt: ${String(extendPrompt)}` : ""}
${imagePrompt ? `- Image Prompt: ${String(imagePrompt)}` : ""}
${sceneDescription ? `- Scene Description: ${String(sceneDescription)}` : ""}

${sceneTypeCriteria}`;

    const { response: res } = await fetchWithModelFallback(context.env, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: "application/json" },
      }),
    });

    const defaultScores = { characterDescription: 5, cameraMovement: 5, actionSequence: 5, lightingMood: 5, videoCompatibility: 5 };

    if (!res.ok) {
      const errText = await res.text();
      console.error("[verify-prompt] Gemini API 오류:", res.status, errText.slice(0, 300));
      return geminiErrorResponse(res, errText, "verify-prompt");
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };

    const blockReason = data?.promptFeedback?.blockReason;
    const finishReason = data?.candidates?.[0]?.finishReason;
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    if (blockReason) {
      console.warn("[verify-prompt] 응답 차단됨:", blockReason);
      return Response.json({
        scoringFailure: true,
        overallScore: 50,
        detectedSceneType: sceneType,
        issues: [`채점 응답 차단됨 (${blockReason}) — 생성은 계속 진행 가능`],
        scores: defaultScores,
        suggestions: [],
      });
    }

    if (!rawText) {
      console.warn("[verify-prompt] 빈 응답. finishReason:", finishReason);
      return Response.json({
        scoringFailure: true,
        overallScore: 50,
        detectedSceneType: sceneType,
        issues: [`채점 응답 없음 (finishReason: ${finishReason ?? "unknown"}) — 생성은 계속 진행 가능`],
        scores: defaultScores,
        suggestions: [],
      });
    }

    console.log("[verify-prompt] Gemini 응답 원문 (첫 600자):", rawText.slice(0, 600));
    const parsed = tryParseJson(rawText);

    if (!parsed) {
      console.error("[verify-prompt] 파싱 완전 실패.", "\n  finishReason:", finishReason, "\n  rawText:", rawText.slice(0, 400));
      return Response.json({
        scoringFailure: true,
        overallScore: 50,
        detectedSceneType: sceneType,
        issues: ["채점 응답 파싱 실패 — 생성은 계속 진행 가능 (이 점수는 무시됩니다)"],
        scores: defaultScores,
        suggestions: [],
        _rawResponsePreview: rawText.slice(0, 200),
      });
    }

    // ── 파싱 성공 — 필드 정규화
    const overallScore = normalizeScore(parsed);
    const { legacy: scores, typed: sceneTypeScores } = normalizeSceneTypeScores(parsed, sceneType);
    const issues = normalizeStringArray(parsed, "issues");
    const suggestions = normalizeStringArray(parsed, "suggestions");

    const improvedVideoPrompt =
      typeof parsed.improvedVideoPrompt === "string" && parsed.improvedVideoPrompt.trim().length > 20
        ? parsed.improvedVideoPrompt.trim()
        : typeof parsed.improved_video_prompt === "string" && (parsed.improved_video_prompt as string).trim().length > 20
          ? (parsed.improved_video_prompt as string).trim()
          : undefined;

    const improvedExtendPrompt =
      typeof parsed.improvedExtendPrompt === "string" && parsed.improvedExtendPrompt.trim().length > 20
        ? parsed.improvedExtendPrompt.trim()
        : typeof parsed.improved_extend_prompt === "string" && (parsed.improved_extend_prompt as string).trim().length > 20
          ? (parsed.improved_extend_prompt as string).trim()
          : undefined;

    if (overallScore < 0) {
      console.warn("[verify-prompt] overallScore 정규화 실패. parsed:", JSON.stringify(parsed).slice(0, 200));
      return Response.json({
        scoringFailure: true,
        overallScore: 50,
        detectedSceneType: sceneType,
        scores,
        sceneTypeScores,
        issues: issues.length > 0 ? issues : ["채점 점수 파싱 불가 — 생성은 계속 진행 가능"],
        suggestions,
        improvedVideoPrompt,
        improvedExtendPrompt,
      });
    }

    console.log(`[verify-prompt] CUT ${cutNumber} [${sceneType}] 점수: ${overallScore}/100`, issues.length > 0 ? `문제: ${issues.slice(0, 2).join(" | ")}` : "");

    return Response.json({
      overallScore,
      detectedSceneType: sceneType,
      scores,
      sceneTypeScores,
      issues,
      suggestions,
      ...(improvedVideoPrompt && { improvedVideoPrompt }),
      ...(improvedExtendPrompt && { improvedExtendPrompt }),
    });
  } catch (error) {
    console.error("[verify-prompt] 처리 중 오류:", error);
    return Response.json({
      scoringFailure: true,
      overallScore: 50,
      issues: ["채점 처리 중 오류 발생 — 생성은 계속 진행 가능"],
      scores: { characterDescription: 5, cameraMovement: 5, actionSequence: 5, lightingMood: 5, videoCompatibility: 5 },
      suggestions: [],
    });
  }
};
