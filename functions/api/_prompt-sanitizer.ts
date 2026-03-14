/**
 * _prompt-sanitizer.ts — 서버사이드 전역 프롬프트 sanitizer
 *
 * src/lib/prompt-sanitizer.ts + scene-type-rules.ts + final-payload-validator.ts의
 * 서버용 통합 복제. generate-video.ts에서 import하여 사용.
 *
 * 파이프라인 순서:
 * 1. scene-type vocabulary filtering
 * 2. positive/negative conflict resolution
 * 3. camera conflict resolution
 * 4. temporal flow rewrite
 * 5. environment detail coverage
 * 6. final payload validation + auto-fix
 */

// ═══════════════════════════════════════════════════════════════════
// Scene Type Rules
// ═══════════════════════════════════════════════════════════════════

type SceneType =
  | "environment" | "crowd" | "person" | "battle"
  | "map_visualization" | "product" | "portrait"
  | "character-driven" | "cinematic_sequence" | "object-detail" | "transition-atmosphere";

interface SceneTypeRule {
  banned: RegExp[];
  replacements: Array<{ pattern: RegExp; replacement: string }>;
  allowedFramings?: string[];
  requiredElements?: Array<{ check: RegExp; fallback: string }>;
  positiveKeywords?: string[];
}

const SCENE_RULES: Record<string, SceneTypeRule> = {
  environment: {
    banned: [
      /\bsoldiers?\b/gi,
      /\bclose[\s-]?up\s+face\b/gi,
      /\bmedium\s+portrait\b/gi,
      /\bcharacter[\s-]?focused\b/gi,
      /\bcharacter[\s-]?driven\b/gi,
      /\bface\s+detail\b/gi,
      /\bfacial\s+expression\b/gi,
      /\bOTS\b/g,
      /\bover[\s-]?the[\s-]?shoulder\b/gi,
    ],
    replacements: [
      { pattern: /\bsoldiers?\s+march(?:ing)?\b/gi, replacement: "distant figures moving across terrain" },
      { pattern: /\bsoldiers?\s+stand(?:ing)?\b/gi, replacement: "distant silhouettes on the horizon" },
      { pattern: /\bsoldiers?\b/gi, replacement: "distant figures" },
      { pattern: /\bclose[\s-]?up\s+face\b/gi, replacement: "environmental detail" },
      { pattern: /\bmedium\s+portrait\b/gi, replacement: "wide environmental composition" },
      { pattern: /\bcharacter[\s-]?focused\b/gi, replacement: "environment-focused" },
    ],
    allowedFramings: ["WS", "LS", "MLS"],
    requiredElements: [
      { check: /\b(sky|cloud|sun|moon|star|dawn|dusk|twilight|overcast|clear\s+sky)\b/i, fallback: "overcast sky with diffused light" },
      { check: /\b(light|sunlight|moonlight|golden\s+hour|blue\s+hour|shadow|illuminat|backlit|sidelit)\b/i, fallback: "soft natural light from above" },
      { check: /\b(haze|fog|mist|dust|smoke|particle|vapor|steam|atmosphere|atmospheric)\b/i, fallback: "subtle atmospheric haze" },
      { check: /\b(ground|floor|terrain|soil|rock|grass|sand|concrete|stone|asphalt|cobble|gravel)\b/i, fallback: "textured ground surface" },
      { check: /\b(scale|vast|expansive|stretching|towering|immense|panoramic|sprawling|depth)\b/i, fallback: "sense of vast scale" },
    ],
    positiveKeywords: ["photorealistic", "cinematic", "subject-focused composition", "natural diegetic sound", "ambient audio"],
  },
  crowd: {
    banned: [/\bindividual\s+face\s+detail\b/gi, /\bsingle\s+person\s+portrait\b/gi, /\bECU\b/g],
    replacements: [
      { pattern: /\bindividual\s+face\b/gi, replacement: "mass of faces" },
      { pattern: /\bsingle\s+person\b/gi, replacement: "crowd movement" },
    ],
    allowedFramings: ["WS", "LS", "MLS", "MS"],
    positiveKeywords: ["photorealistic", "cinematic", "natural diegetic sound"],
  },
  map_visualization: {
    banned: [
      /\blandscape\s+photograph\b/gi, /\breal\s+terrain\b/gi,
      /\bdrone\s+footage\b/gi, /\bcharacter\b/gi, /\bperson\b/gi, /\bface\b/gi,
      /\bgeneric\s+noise\b/gi, /\babstract\s+(?:pattern|shape|form|visual)\b/gi,
    ],
    replacements: [
      { pattern: /\breal\s+terrain\b/gi, replacement: "map terrain surface" },
      { pattern: /\bdrone\s+footage\b/gi, replacement: "aerial map view" },
      { pattern: /\babstract\s+visual\b/gi, replacement: "minimalist data visualization" },
    ],
    allowedFramings: ["WS", "LS"],
    requiredElements: [
      { check: /\b(terrain|elevation|contour|topograph|ridge|plateau|valley|mountain|coast|river|relief)\b/i, fallback: "3D topographic relief map with contour lines" },
      { check: /\b(light|shadow|illuminat|glow|ambient)\b/i, fallback: "soft directional lighting on map surface" },
      { check: /\b(haze|atmosphere|fog|mist|depth|ambient)\b/i, fallback: "subtle atmospheric depth" },
    ],
    positiveKeywords: ["cinematic", "3D topographic relief map", "minimalist digital data visualization"],
  },
  product: { banned: [], replacements: [], allowedFramings: ["CU", "MCU", "ECU", "MS"] },
  portrait: {
    banned: [/\bwide\s+establishing\b/gi, /\baerial\s+flyover\b/gi, /\bdrone\s+shot\b/gi],
    replacements: [],
    allowedFramings: ["CU", "MCU", "MS", "ECU"],
    requiredElements: [
      { check: /\b(expression|gaze|stare|frown|smile|stern|weary|determined|eyes|lips)\b/i, fallback: "" },
      { check: /\b(light|backlit|sidelit|rim[\s-]?light|shadow|silhouett|illuminat)\b/i, fallback: "" },
    ],
  },
  battle: {
    banned: [/\bpeaceful\b/gi, /\bserene\b/gi, /\btranquil\b/gi],
    replacements: [],
    requiredElements: [
      { check: /\b(smoke|dust|fire|flame|debris|explosion|spark)\b/i, fallback: "smoke and dust filling the air" },
    ],
  },
  person: {
    banned: [],
    replacements: [],
    requiredElements: [
      { check: /\b(young|old|elderly|middle[\s-]?aged|teen|child|adult|aged|youthful|mature)\b/i, fallback: "adult figure" },
      { check: /\b(wearing|dressed|cloth|garment|robe|suit|armor|uniform|tunic|cloak|gown|outfit|coat)\b/i, fallback: "" },
      { check: /\b(standing|sitting|kneeling|crouching|leaning|expression|gaze|stare|frown|smile|stern)\b/i, fallback: "" },
      { check: /\b(light|backlit|sidelit|rim[\s-]?light|shadow|silhouett|illuminat|golden)\b/i, fallback: "" },
    ],
    positiveKeywords: ["photorealistic", "cinematic", "subject-focused composition", "natural diegetic sound"],
  },
  "character-driven": {
    banned: [],
    replacements: [],
    requiredElements: [
      { check: /\b(young|old|elderly|middle[\s-]?aged|teen|child|adult|aged|youthful|mature)\b/i, fallback: "adult figure" },
      { check: /\b(hair|bald|shaved|turban|hood|hat|crown|helmet|head[\s-]?cover|braids?)\b/i, fallback: "" },
      { check: /\b(wearing|dressed|cloth|garment|robe|suit|armor|uniform|tunic|cloak|gown|outfit)\b/i, fallback: "" },
      { check: /\b(standing|sitting|kneeling|crouching|leaning|expression|gaze|stare|frown|smile|stern|posture)\b/i, fallback: "" },
      { check: /\b(light|backlit|sidelit|rim[\s-]?light|shadow|silhouett|illuminat|golden)\b/i, fallback: "" },
    ],
    positiveKeywords: ["photorealistic", "cinematic", "subject-focused composition", "natural diegetic sound"],
  },
  "cinematic_sequence": { banned: [], replacements: [] },
  "object-detail": { banned: [/\bwide\s+establishing\b/gi, /\baerial\b/gi], replacements: [], allowedFramings: ["CU", "MCU", "ECU", "MS"] },
  "transition-atmosphere": { banned: [], replacements: [] },
};

const SHOT_CATEGORY_MAP: Record<string, SceneType> = {
  "environment": "environment", "crowd": "crowd", "person": "person",
  "character-driven": "character-driven", "battle": "battle",
  "cinematic_sequence": "cinematic_sequence", "cinematic-sequence": "cinematic_sequence",
  "map-graphic": "map_visualization", "map_visualization": "map_visualization",
  "product": "product", "portrait": "portrait",
  "object-detail": "object-detail", "transition-atmosphere": "transition-atmosphere",
};

function resolveSceneType(shotCategory?: string): SceneType | null {
  if (!shotCategory) return null;
  return SHOT_CATEGORY_MAP[shotCategory] ?? null;
}

// ═══════════════════════════════════════════════════════════════════
// Critical conflict words
// ═══════════════════════════════════════════════════════════════════

const CRITICAL_CONFLICT_WORDS = [
  "watermark", "caption", "subtitle", "logo",
  "photorealistic", "cinematic", "text overlay",
  "blurry", "low quality",
];

// ═══════════════════════════════════════════════════════════════════
// Framing categories
// ═══════════════════════════════════════════════════════════════════

const FRAMING_CATEGORIES = {
  wide: /\b(wide[\s-]?shot|wide[\s-]?angle|establishing\s+shot|WS|LS|aerial|panoram|drone\s+shot)\b/i,
  medium: /\b(medium\s+shot|medium[\s-]?close|MS|MCU|MLS|mid[\s-]?shot)\b/i,
  close: /\b(close[\s-]?up|extreme\s+close|ECU|CU|macro|detail\s+shot)\b/i,
};

// ═══════════════════════════════════════════════════════════════════
// Main Pipeline
// ═══════════════════════════════════════════════════════════════════

/** 물리 환경 제약 — sanitizer에서 사용하는 최소 subset */
export interface PhysicsRulesContext {
  hasWind: boolean;
  hasAtmosphere: boolean;
  gravity: string;
  environmentType: string;
  bannedExpressions?: string[];
}

export interface SanitizeIssue {
  rule: string;
  severity: "error" | "warning";
  message: string;
  autoFixed?: boolean;
}

export interface ServerSanitizeInput {
  prompt: string;
  negatives: string[];
  framing: string;
  shotCategory?: string;
  styleSuffix?: string;
  provider: "veo" | "kling";
  physicsRules?: PhysicsRulesContext;
  sceneType?: string;
}

export interface ServerSanitizeResult {
  prompt: string;
  negatives: string[];
  framing: string;
  log: string[];
  issues: SanitizeIssue[];
  valid: boolean;
}

export function serverSanitizeAndValidate(input: ServerSanitizeInput): ServerSanitizeResult {
  const log: string[] = [];
  const issues: SanitizeIssue[] = [];
  let { prompt, negatives, framing } = input;
  const sceneType = resolveSceneType(input.sceneType) || resolveSceneType(input.shotCategory);

  // ── Step 1: Scene-type vocabulary filtering ────────────────────
  if (sceneType) {
    const rule = SCENE_RULES[sceneType] ?? SCENE_RULES["person"];

    // Replacements first
    for (const { pattern, replacement } of rule.replacements) {
      const matches = prompt.match(pattern);
      if (matches) {
        prompt = prompt.replace(pattern, replacement);
        log.push(`[vocab] "${matches[0]}" → "${replacement}"`);
      }
    }

    // Then banned terms
    for (const banned of rule.banned) {
      const matches = prompt.match(banned);
      if (matches) {
        prompt = prompt.replace(banned, "");
        log.push(`[vocab] Removed: ${matches.join(", ")}`);
      }
    }

    // Framing constraint
    if (rule.allowedFramings && !rule.allowedFramings.includes(framing.toUpperCase())) {
      const old = framing;
      framing = rule.allowedFramings[0];
      log.push(`[vocab] Framing ${old} → ${framing}`);
    }
  }

  // ── Step 2: Positive/Negative conflict resolution ──────────────
  const fullPositive = input.styleSuffix ? `${prompt} ${input.styleSuffix}` : prompt;

  for (const word of CRITICAL_CONFLICT_WORDS) {
    const wordLower = word.toLowerCase();
    const isInNeg = negatives.some(n => n.toLowerCase().includes(wordLower));
    if (!isInNeg) continue;

    if (fullPositive.toLowerCase().includes(wordLower)) {
      const noCheck = new RegExp(`\\b(?:no|avoid|without)\\s+${escapeRegex(word)}`, "i");
      if (!noCheck.test(fullPositive)) {
        const removePattern = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
        prompt = prompt.replace(removePattern, "").replace(/\s{2,}/g, " ").trim();
        log.push(`[pos-neg] Removed "${word}" from positive (conflict)`);
      }
    }
  }

  // Deduplicate negatives
  const negSeen = new Set<string>();
  negatives = negatives.filter(n => {
    const key = n.toLowerCase().trim();
    if (negSeen.has(key)) return false;
    negSeen.add(key);
    return true;
  });

  // ── Step 3: Camera conflict resolution ─────────────────────────
  const framingUpper = framing.toUpperCase();
  let declaredCategory: "wide" | "medium" | "close" = "medium";
  if (["WS", "LS", "MLS"].includes(framingUpper)) declaredCategory = "wide";
  else if (["CU", "ECU", "MCU"].includes(framingUpper)) declaredCategory = "close";
  if (sceneType === "environment") declaredCategory = "wide";

  for (const [cat, pattern] of Object.entries(FRAMING_CATEGORIES)) {
    if (cat === declaredCategory) continue;
    const matches = prompt.match(pattern);
    if (matches) {
      prompt = prompt.replace(pattern, "");
      log.push(`[camera] Removed ${cat} framing "${matches[0]}" (conflicts with ${declaredCategory})`);
    }
  }

  // ── Step 4: Temporal flow rewrite ──────────────────────────────
  if (sceneType === "environment" || sceneType === "crowd") {
    const cutPhrases = /\b(cut\s+to|dissolve\s+to|fade\s+to|wipe\s+to|jump\s+cut|smash\s+cut)\b/gi;
    const before = prompt;
    prompt = prompt.replace(cutPhrases, "then");
    if (prompt !== before) {
      log.push("[temporal] Replaced cut-based transitions with continuous flow");
    }

    // Detect framing switches in time segments
    const segRegex = /(\d+)s?\s*[-–]\s*(\d+)s?\s*:?\s*[^.]*/g;
    const segments: string[] = [];
    let segMatch: RegExpExecArray | null;
    while ((segMatch = segRegex.exec(prompt)) !== null) {
      segments.push(segMatch[0]);
    }
    if (segments.length >= 2) {
      const hasFramingSwitch = segments.some(s =>
        FRAMING_CATEGORIES.wide.test(s) || FRAMING_CATEGORIES.medium.test(s) || FRAMING_CATEGORIES.close.test(s)
      );
      if (hasFramingSwitch) {
        for (const seg of segments) {
          let cleaned = seg
            .replace(FRAMING_CATEGORIES.wide, "")
            .replace(FRAMING_CATEGORIES.medium, "")
            .replace(FRAMING_CATEGORIES.close, "")
            .replace(/,\s*,/g, ",").trim();
          if (cleaned !== seg) {
            prompt = prompt.replace(seg, cleaned);
          }
        }
        log.push(`[temporal] Removed framing switches from ${segments.length} time segments`);
      }
    }
  }

  // ── Step 5: Descriptive coverage by scene type ──────────────────
  if (sceneType === "environment") {
    const envElements = SCENE_RULES.environment.requiredElements || [];
    const additions: string[] = [];
    for (const { check, fallback } of envElements) {
      if (!check.test(prompt)) additions.push(fallback);
    }
    if (additions.length > 0) {
      prompt = prompt.trim() + ". " + additions.join(", ");
      log.push(`[env-detail] Added ${additions.length} missing: ${additions.join(", ")}`);
    }
  }

  // Character scene coverage
  if (sceneType === "character-driven" || sceneType === "person") {
    const charChecks = (SCENE_RULES[sceneType]?.requiredElements || []);
    const missing: string[] = [];
    for (const { check, fallback } of charChecks) {
      if (!check.test(prompt) && fallback) missing.push(fallback);
    }
    if (missing.length > 0) {
      prompt = prompt.trim() + ". " + missing.join(", ");
      log.push(`[char-detail] Added ${missing.length} missing: ${missing.join(", ")}`);
    }
  }

  // Crowd scene coverage
  if (sceneType === "crowd") {
    const crowdChecks = (SCENE_RULES.crowd?.requiredElements || []);
    const missing: string[] = [];
    for (const { check, fallback } of crowdChecks) {
      if (!check.test(prompt) && fallback) missing.push(fallback);
    }
    if (missing.length > 0) {
      prompt = prompt.trim() + ". " + missing.join(", ");
      log.push(`[crowd-detail] Added ${missing.length} missing: ${missing.join(", ")}`);
    }
  }

  // ── Step 5b: Map visualization coverage ──────────────────────
  if (sceneType === "map_visualization") {
    const mapElements = SCENE_RULES.map_visualization.requiredElements || [];
    const mapAdditions: string[] = [];
    for (const { check, fallback } of mapElements) {
      if (!check.test(prompt) && fallback) mapAdditions.push(fallback);
    }
    if (mapAdditions.length > 0) {
      prompt = prompt.trim() + ". " + mapAdditions.join(", ");
      log.push(`[map-detail] Added ${mapAdditions.length} missing: ${mapAdditions.join(", ")}`);
    }
  }

  // ── Step 5c: Positive keyword enforcement ───────────────────
  if (sceneType) {
    const rule = SCENE_RULES[sceneType];
    if (rule?.positiveKeywords) {
      const fullText = (input.styleSuffix ? `${prompt} ${input.styleSuffix}` : prompt).toLowerCase();
      const missingPositives = rule.positiveKeywords.filter(kw =>
        !fullText.includes(kw.toLowerCase()) && !negatives.some(n => n.toLowerCase() === kw.toLowerCase())
      );
      if (missingPositives.length > 0) {
        prompt = prompt.trim() + ". " + missingPositives.join(", ");
        log.push(`[positive] Added ${missingPositives.length} positive keywords: ${missingPositives.join(", ")}`);
      }
    }
  }

  // ── Step 5d: Physics-aware sanitization ──────────────────────
  if (input.physicsRules) {
    const pr = input.physicsRules;

    // No-wind: flutter/wave/blow 충돌 auto-fix
    if (!pr.hasWind) {
      const windFixes: Array<{ pattern: RegExp; fix: string }> = [
        { pattern: /\bflutter(?:ing|s)?\s+in\s+(?:the\s+)?wind\b/gi, fix: "hanging motionless" },
        { pattern: /\bblow(?:ing|s|n)?\s+in\s+(?:the\s+)?(?:wind|breeze)\b/gi, fix: "hanging still" },
        { pattern: /\bwave(?:s|ing)?\s+in\s+(?:the\s+)?(?:wind|breeze)\b/gi, fix: "rigid and still" },
        { pattern: /\bwind[\s-]?blown\b/gi, fix: "motionless" },
        { pattern: /\bbreeze[\s-]?(?:blown|swept|ruffled)\b/gi, fix: "still" },
        { pattern: /\brippl(?:ing|es?)\s+(?:in\s+)?(?:the\s+)?(?:wind|breeze|air)\b/gi, fix: "motionless" },
      ];
      for (const { pattern, fix } of windFixes) {
        if (pattern.test(prompt)) {
          prompt = prompt.replace(pattern, fix);
          issues.push({ rule: "physics_flag_wind_conflict", severity: "error", message: `Wind-dependent motion in no-wind env: replaced with "${fix}"`, autoFixed: true });
          log.push(`[physics] Wind motion → "${fix}"`);
        }
      }
    }

    // No-atmosphere: atmospheric effects 충돌
    if (!pr.hasAtmosphere) {
      const atmoFixes: Array<{ pattern: RegExp; fix: string }> = [
        { pattern: /\batmospheric\s+(?:haze|fog|mist|flutter)\b/gi, fix: "stark vacuum clarity" },
        { pattern: /\b(?:haze|fog|mist)\s+(?:drifts?|fills?|settles?|rolls?)\b/gi, fix: "clear void" },
        { pattern: /\bair\s+(?:shimmers?|ripples?|distort)\b/gi, fix: "vacuum stillness" },
      ];
      for (const { pattern, fix } of atmoFixes) {
        if (pattern.test(prompt)) {
          prompt = prompt.replace(pattern, fix);
          issues.push({ rule: "physics_motion_environment_conflict", severity: "error", message: `Atmospheric effect in vacuum: replaced with "${fix}"`, autoFixed: true });
          log.push(`[physics] Atmospheric effect → "${fix}"`);
        }
      }
    }

    // Low/zero gravity: rapid falling
    if (pr.gravity === "low" || pr.gravity === "zero") {
      const gravFixes: Array<{ pattern: RegExp; fix: string }> = [
        { pattern: /\b(?:falls?|falling)\s+(?:quickly|rapidly|fast|heavily)\b/gi, fix: pr.gravity === "zero" ? "drifts slowly" : "settles gradually" },
        { pattern: /\bcrash(?:es|ing)?\s+(?:to|into)\s+(?:the\s+)?(?:ground|floor|surface)\b/gi, fix: "drifts toward the surface" },
      ];
      for (const { pattern, fix } of gravFixes) {
        if (pattern.test(prompt)) {
          prompt = prompt.replace(pattern, fix);
          issues.push({ rule: "physics_motion_environment_conflict", severity: "warning", message: `Rapid motion in ${pr.gravity}-gravity: → "${fix}"`, autoFixed: true });
          log.push(`[physics] Gravity conflict → "${fix}"`);
        }
      }
    }

    // bannedExpressions
    if (pr.bannedExpressions) {
      for (const banned of pr.bannedExpressions) {
        const banRe = new RegExp(`\\b${escapeRegex(banned)}\\b`, "gi");
        if (banRe.test(prompt)) {
          prompt = prompt.replace(banRe, "");
          issues.push({ rule: "physics_motion_environment_conflict", severity: "error", message: `Banned "${banned}" removed (${pr.environmentType})`, autoFixed: true });
          log.push(`[physics] Removed banned: "${banned}"`);
        }
      }
    }
  }

  // ── Step 5e: Structural issue detection ──────────────────────
  // Discrete shot type sequence in single generation
  const discreteShotTypes = [/\bwide\b/i, /\bmedium\b/i, /\bclose[\s-]?up\b/i, /\bWS\b/, /\bMS\b/, /\bCU\b/, /\bLS\b/, /\bECU\b/];
  const matchedFramings = discreteShotTypes.filter(p => p.test(prompt));
  if (matchedFramings.length >= 3) {
    issues.push({ rule: "discrete_shot_sequence_in_single_generation", severity: "warning", message: `${matchedFramings.length} shot types in single prompt` });
  }

  // Missing continuous camera bridge
  if (/\bcut\s+to\b/i.test(prompt) && !/\bcontinuous\b/i.test(prompt) && !/\bwithout\s+(?:a\s+)?cut/i.test(prompt)) {
    issues.push({ rule: "missing_continuous_camera_bridge", severity: "warning", message: "Explicit 'cut to' in prompt" });
  }

  // Environment-specific
  if (sceneType === "environment") {
    const locPatterns = /\b(desk|chair|stove|clinic|office|restaurant|street|car|bed|lobby|warehouse|factory|bench|fountain|monument|statue|bridge|tower|dock|pier|lighthouse|temple|ruins|crater|flag|pole|landing\s+site)\b/i;
    if (!locPatterns.test(prompt)) {
      issues.push({ rule: "missing_location_identity_anchor", severity: "warning", message: "Environment scene lacks location-identity objects" });
    }
    const motPatterns = /\b(sway|drift|ripple|flutter|rustle|shimmer|flow|wave|settle|spin|dust|particle|cloud\s+move|light\s+shift)\b/i;
    if (!motPatterns.test(prompt)) {
      issues.push({ rule: "missing_natural_motion_for_environment", severity: "warning", message: "Environment scene has no natural motion cues" });
    }
  }

  // Insufficient temporal beats
  const beatMatches = prompt.match(/\d+s[-–]\d+s/g) || [];
  if (beatMatches.length === 0 && !/\bfirst\b.*\bthen\b/i.test(prompt) && prompt.split(/\s+/).length > 40) {
    issues.push({ rule: "insufficient_temporal_beats", severity: "warning", message: "Long prompt with no temporal structure" });
  }

  // Abstract symbolism over specific visuals
  const abstractMatches = prompt.match(/\b(symboliz(?:ing|es?)|represent(?:ing|s)|evok(?:ing|es?)|metaphor(?:ically)?|allegory|embod(?:ying|ies?))\b/gi) || [];
  if (abstractMatches.length >= 2) {
    issues.push({ rule: "abstract_symbolism_over_specific_visuals", severity: "warning", message: `${abstractMatches.length} abstract/symbolic phrases detected` });
  }

  // ── Step 6: Final validation ───────────────────────────────────
  let valid = true;

  // Check remaining pos/neg conflicts
  for (const word of CRITICAL_CONFLICT_WORDS) {
    const isInNeg = negatives.some(n => n.toLowerCase().includes(word.toLowerCase()));
    if (!isInNeg) continue;
    const noCheck = new RegExp(`\\b(?:no|avoid|without)\\s+${escapeRegex(word)}`, "i");
    if (prompt.toLowerCase().includes(word.toLowerCase()) && !noCheck.test(prompt)) {
      valid = false;
      log.push(`[FAIL] "${word}" still in both positive and negatives`);
    }
  }

  // Env banned vocab
  if (sceneType === "environment") {
    for (const pattern of (SCENE_RULES.environment.banned || [])) {
      if (pattern.test(prompt)) {
        valid = false;
        const match = prompt.match(pattern);
        log.push(`[FAIL] Env banned term still present: "${match?.[0]}"`);
      }
    }
    if (["CU", "ECU", "MCU"].includes(framing.toUpperCase())) {
      valid = false;
      log.push(`[FAIL] Env framing still close: "${framing}"`);
    }
  }

  // Physics errors count toward validity
  if (issues.some(i => i.severity === "error" && !i.autoFixed)) {
    valid = false;
  }

  // Cleanup
  prompt = prompt
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { prompt, negatives, framing, log, issues, valid };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
