/**
 * physics-rules.ts — Scene-specific physics constraints
 *
 * 환경에 맞는 물리 법칙을 감지하고 금지 표현을 생성.
 * lunar scene은 wind/atmosphere/haze 금지, black sky 강제 등.
 *
 * grep: detectPhysicsRules, enforcePhysicsNegatives, PHYSICS_ENVIRONMENTS
 */

import type { PhysicsRules } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// 1. Environment Detection Patterns
// ═══════════════════════════════════════════════════════════════════

const LUNAR_PATTERN = /\b(lunar|moon\s*surface|moonscape|regolith|mare\s+tranquillitatis|apollo|sea\s+of\s+tranquility|moon\s+landing|moon\s+base|cratere?d?\s+lunar)\b/i;
const SPACE_PATTERN = /\b(space\s*station|orbit|zero[\s-]?g|weightless|interstellar|nebula|asteroid|space\s*walk|EVA|cosmos|spacecraft)\b/i;
const UNDERWATER_PATTERN = /\b(underwater|submerged|deep\s*sea|ocean\s*floor|submarine|coral\s*reef|aquatic|diving|seafloor|abyss)\b/i;
const INDOOR_PATTERN = /\b(indoor|interior|room|office|studio|laboratory|warehouse|building\s*interior|hallway|corridor)\b/i;

// ═══════════════════════════════════════════════════════════════════
// 2. Physics Rules Detection
// ═══════════════════════════════════════════════════════════════════

/**
 * 환경 텍스트에서 물리 법칙을 감지.
 *
 * grep: detectPhysicsRules
 */
export function detectPhysicsRules(
  environment: string,
  subjectPrimary: string,
  moodLighting: string,
): PhysicsRules {
  const fullText = `${environment} ${subjectPrimary} ${moodLighting}`;

  // ── Lunar ──
  if (LUNAR_PATTERN.test(fullText)) {
    return {
      hasWind: false,
      hasAtmosphere: false,
      hasAudibleEnvironment: false,
      gravity: "low",
      flagMotionSource: "pole vibration or rigid support, not wind",
      skyConstraint: "pitch-black sky with visible stars",
      lightConstraint: "unfiltered direct sunlight, harsh shadows with no diffusion",
      bannedExpressions: [
        "wind", "breeze", "gust", "blowing", "waving in wind", "fluttering",
        "atmospheric haze", "haze", "mist", "fog", "cloud", "overcast",
        "sky gradient", "blue sky", "sunset sky", "sunrise sky",
        "air current", "dust cloud", "sand storm",
        "rain", "snow", "weather",
        "sound", "echo",  // no atmosphere = no sound propagation
      ],
      environmentType: "lunar",
    };
  }

  // ── Space (zero-g) ──
  if (SPACE_PATTERN.test(fullText)) {
    return {
      hasWind: false,
      hasAtmosphere: false,
      hasAudibleEnvironment: false,
      gravity: "zero",
      skyConstraint: "black void with stars or planetary body",
      lightConstraint: "single harsh directional light source (sun) or ambient starlight",
      bannedExpressions: [
        "wind", "breeze", "gust", "blowing",
        "haze", "mist", "fog", "cloud", "rain", "snow",
        "gravity", "falling", "dropping", // unless intentionally zero-g
        "sound", "echo",
      ],
      environmentType: "space",
    };
  }

  // ── Underwater ──
  if (UNDERWATER_PATTERN.test(fullText)) {
    return {
      hasWind: false,
      hasAtmosphere: false,
      hasAudibleEnvironment: true,  // underwater has sound propagation
      gravity: "earth",
      skyConstraint: "water surface above with light filtering through",
      lightConstraint: "caustic light patterns from above, decreasing with depth",
      bannedExpressions: [
        "wind", "breeze", "dry", "dust",
        "clear sky", "sun directly",
        "fire", "flame", "smoke",
      ],
      environmentType: "underwater",
    };
  }

  // ── Indoor ──
  if (INDOOR_PATTERN.test(fullText)) {
    return {
      hasWind: false,
      hasAtmosphere: true,
      hasAudibleEnvironment: true,
      gravity: "earth",
      bannedExpressions: [
        "strong wind", "gust",
        "rain", "snow", "weather",
      ],
      environmentType: "earth_indoor",
    };
  }

  // ── Default: Earth Outdoor ──
  return {
    hasWind: true,
    hasAtmosphere: true,
    hasAudibleEnvironment: true,
    gravity: "earth",
    bannedExpressions: [],
    environmentType: "earth_outdoor",
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Physics-Based Negative Enforcement
// ═══════════════════════════════════════════════════════════════════

/**
 * physics rules에 따른 부정 키워드 생성.
 * 이 키워드들은 negatives.sceneSpecific에 추가되어야 한다.
 *
 * grep: enforcePhysicsNegatives
 */
export function enforcePhysicsNegatives(rules: PhysicsRules): string[] {
  const negatives: string[] = [];

  if (!rules.hasWind) {
    negatives.push("wind", "breeze", "waving in wind", "blowing");
  }
  if (!rules.hasAtmosphere) {
    negatives.push("atmospheric haze", "haze", "mist", "fog", "clouds");
  }
  if (rules.environmentType === "lunar") {
    negatives.push(
      "blue sky", "overcast sky", "sunset", "sunrise",
      "air movement", "dust cloud",
      "fluttering flag",  // flag must be rigid or pole-vibration only
    );
  }
  if (rules.environmentType === "space") {
    negatives.push("gravity", "falling debris");
  }
  if (rules.environmentType === "underwater") {
    negatives.push("fire", "flame", "smoke", "dust");
  }

  return [...new Set(negatives)];
}

// ═══════════════════════════════════════════════════════════════════
// 4. Physics Consistency Check
// ═══════════════════════════════════════════════════════════════════

export interface PhysicsViolation {
  field: string;
  expression: string;
  rule: string;
  message: string;
}

/**
 * 텍스트 필드에서 물리 법칙 위반을 검출.
 *
 * grep: checkPhysicsConsistency
 */
export function checkPhysicsConsistency(
  rules: PhysicsRules,
  fields: Record<string, string>,
): PhysicsViolation[] {
  const violations: PhysicsViolation[] = [];

  for (const [fieldName, text] of Object.entries(fields)) {
    if (!text) continue;
    const textLc = text.toLowerCase();

    for (const banned of rules.bannedExpressions) {
      const bannedLc = banned.toLowerCase();
      // Word boundary check
      const re = new RegExp(`\\b${bannedLc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(textLc)) {
        violations.push({
          field: fieldName,
          expression: banned,
          rule: `physics_${rules.environmentType}`,
          message: `"${banned}" violates ${rules.environmentType} physics (${fieldName})`,
        });
      }
    }

    // Lunar-specific: flag + wind conflation
    if (rules.environmentType === "lunar") {
      if (/\bflag\b/i.test(textLc) && /\b(waving|fluttering|blowing|rippling)\b/i.test(textLc)) {
        if (!/\b(pole|rigid|support|vibrat|mechani)\b/i.test(textLc)) {
          violations.push({
            field: fieldName,
            expression: "flag waving/fluttering",
            rule: "physics_lunar_flag",
            message: `Flag motion in lunar environment must specify non-wind source (pole vibration, rigid support) — "${text.slice(0, 60)}"`,
          });
        }
      }
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════════
// 5. Physics-Based Text Rewrite
// ═══════════════════════════════════════════════════════════════════

/**
 * 물리 법칙에 맞게 텍스트를 자동 교정.
 * 예: lunar scene에서 "flag waving gently" → "flag held rigid by pole support, subtle pole vibration"
 *
 * grep: rewriteForPhysics
 */
export function rewriteForPhysics(
  text: string,
  rules: PhysicsRules,
): { text: string; rewrites: string[] } {
  if (rules.bannedExpressions.length === 0) return { text, rewrites: [] };

  let result = text;
  const rewrites: string[] = [];

  if (rules.environmentType === "lunar" || rules.environmentType === "space") {
    // "Flag waving gently" / "flag waving in the vacuum" → rigid pole
    const flagWaveRe = /\bflag\s+(waving|fluttering|blowing|rippling)\s*(gently|softly|slowly|in\s+the\s+vacuum|in\s+the\s+wind)?/gi;
    if (flagWaveRe.test(result)) {
      result = result.replace(flagWaveRe, "flag held rigid by support bar, subtle fabric tremor from pole vibration");
      rewrites.push("[physics] Rewrote flag motion → pole vibration (no atmosphere)");
    }

    // Generic "waving/fluttering" → mechanical
    const genericWaveRe = /\b(waving|fluttering)\s+(gently|softly|slowly|in\s+the\s+(wind|vacuum|breeze))/gi;
    if (genericWaveRe.test(result)) {
      result = result.replace(genericWaveRe, "held rigid with subtle mechanical vibration");
      rewrites.push("[physics] Rewrote wind-based motion → mechanical vibration");
    }

    // "wind" standalone → remove
    const windRe = /,?\s*\b(gentle\s+)?wind\b/gi;
    if (windRe.test(result)) {
      result = result.replace(windRe, "").replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
      rewrites.push("[physics] Removed wind reference (no atmosphere)");
    }

    // "haze" / "mist" / "fog" → remove
    const hazeRe = /,?\s*\b(atmospheric\s+)?(haze|mist|fog)\b/gi;
    if (hazeRe.test(result)) {
      result = result.replace(hazeRe, "").replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
      rewrites.push("[physics] Removed atmospheric haze (no atmosphere)");
    }

    // "overcast" → "even illumination from direct overhead sunlight"
    if (/\bovercast\b/i.test(result)) {
      result = result.replace(/\bovercast\b/gi, "even illumination from direct overhead sunlight");
      rewrites.push("[physics] Rewrote overcast → direct sunlight (no atmosphere)");
    }

    // "cloudy" → remove
    if (/\bcloudy?\b/i.test(result)) {
      result = result.replace(/,?\s*\bcloudy?\b/gi, "").replace(/\s{2,}/g, " ").trim();
      rewrites.push("[physics] Removed cloud reference (no atmosphere)");
    }

    // "diffused glow" / "soft diffused daylight" → "unfiltered harsh light"
    const diffusedRe = /\b(soft\s+)?diffused\s+(glow|daylight|light|illumination)/gi;
    if (diffusedRe.test(result)) {
      result = result.replace(diffusedRe, "unfiltered harsh direct light");
      rewrites.push("[physics] Rewrote diffused light → unfiltered direct (no atmospheric scattering)");
    }

    // "atmospheric glow" → remove
    if (/\batmospheric\s+glow\b/i.test(result)) {
      result = result.replace(/\batmospheric\s+glow\b/gi, "stark reflected surface light");
      rewrites.push("[physics] Rewrote atmospheric glow → surface reflection (no atmosphere)");
    }

    // "blue-grey cast" in lunar → "stark grey surface with black sky"
    if (rules.environmentType === "lunar" && /\bblue[\s-]?grey\s+cast\b/i.test(result)) {
      result = result.replace(/\bblue[\s-]?grey\s+cast\b/gi, "neutral grey surface tones under harsh unfiltered sunlight");
      rewrites.push("[physics] Rewrote blue-grey cast → neutral grey surface (lunar)");
    }
  }

  // ── Audio/sound descriptors (no-atmosphere environments) ──
  if (!rules.hasAtmosphere) {
    // "Diegetic ambient sound" / "diegetic sound" / "ambient sound" / "ambient audio"
    const audioDescriptorRe = /\b(natural\s+)?(diegetic\s+)?(ambient\s+)?(sound|audio)\b/gi;
    if (audioDescriptorRe.test(result)) {
      result = result.replace(audioDescriptorRe, "").replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
      rewrites.push("[physics] Removed audio/sound descriptors (no atmosphere)");
    }

    // "Diegetic ambient sound" as full phrase (catch remaining)
    if (/\bdiegetic\b/i.test(result)) {
      result = result.replace(/\bdiegetic\b/gi, "").replace(/\s{2,}/g, " ").trim();
      rewrites.push("[physics] Removed diegetic reference (no atmosphere)");
    }
  }

  if (rules.environmentType === "underwater") {
    // "fire" → bioluminescence
    const fireRe = /\bfire\b/gi;
    if (fireRe.test(result) && !/\b(bioluminescen|chemiluminescen)\b/i.test(result)) {
      result = result.replace(fireRe, "bioluminescent glow");
      rewrites.push("[physics] Rewrote fire → bioluminescence (underwater)");
    }
  }

  return { text: result, rewrites };
}

// ═══════════════════════════════════════════════════════════════════
// 6. Full-Layer Physics Sanitizer
// ═══════════════════════════════════════════════════════════════════

/**
 * SingleShotDocument의 ALL text fields에 물리 법칙 적용.
 * source-of-truth + reinforcement + audio + continuity + global style 전체 커버.
 *
 * grep: sanitizeAllFieldsForPhysics
 */
export function sanitizeAllFieldsForPhysics(
  doc: {
    subject: { primary: string; action: string; bodySignal?: string; blocking?: string };
    scene: { environment: string; moodLighting: string };
    reinforcement: { styleSuffix: string; mediumLock?: string };
    audio: { hint: string };
    continuity: { ambient?: string; lightingDirection?: string };
    global: { style: string };
  },
  rules: PhysicsRules,
): { rewrites: string[] } {
  const rewrites: string[] = [];

  const fields: Array<{ key: string; get: () => string; set: (v: string) => void }> = [
    { key: "subject.primary", get: () => doc.subject.primary, set: (v) => { doc.subject.primary = v; } },
    { key: "subject.action", get: () => doc.subject.action, set: (v) => { doc.subject.action = v; } },
    { key: "scene.environment", get: () => doc.scene.environment, set: (v) => { doc.scene.environment = v; } },
    { key: "scene.moodLighting", get: () => doc.scene.moodLighting, set: (v) => { doc.scene.moodLighting = v; } },
    { key: "reinforcement.styleSuffix", get: () => doc.reinforcement.styleSuffix, set: (v) => { doc.reinforcement.styleSuffix = v; } },
    { key: "audio.hint", get: () => doc.audio.hint, set: (v) => { doc.audio.hint = v; } },
    { key: "global.style", get: () => doc.global.style, set: (v) => { doc.global.style = v; } },
  ];

  // Optional fields
  if (doc.subject.bodySignal) {
    fields.push({ key: "subject.bodySignal", get: () => doc.subject.bodySignal!, set: (v) => { doc.subject.bodySignal = v; } });
  }
  if (doc.continuity.ambient) {
    fields.push({ key: "continuity.ambient", get: () => doc.continuity.ambient!, set: (v) => { doc.continuity.ambient = v; } });
  }
  if (doc.continuity.lightingDirection) {
    fields.push({ key: "continuity.lightingDirection", get: () => doc.continuity.lightingDirection!, set: (v) => { doc.continuity.lightingDirection = v; } });
  }
  if (doc.reinforcement.mediumLock) {
    fields.push({ key: "reinforcement.mediumLock", get: () => doc.reinforcement.mediumLock!, set: (v) => { doc.reinforcement.mediumLock = v; } });
  }

  for (const field of fields) {
    const text = field.get();
    if (!text) continue;
    const { text: rewritten, rewrites: fieldRewrites } = rewriteForPhysics(text, rules);
    if (fieldRewrites.length > 0) {
      field.set(rewritten);
      rewrites.push(...fieldRewrites.map(r => `${r} (${field.key})`));
    }
  }

  // ── Lunar/Space: force audio to vacuum silence ──
  if (!rules.hasAtmosphere) {
    doc.audio.hint = "Vacuum silence — no audible environment";
    rewrites.push("[physics] Forced audio → vacuum silence (no atmosphere) (audio.hint)");
    if (doc.continuity.ambient) {
      doc.continuity.ambient = "vacuum silence";
      rewrites.push("[physics] Forced continuity.ambient → vacuum silence");
    }
  }

  return { rewrites };
}

// ═══════════════════════════════════════════════════════════════════
// 7. Lunar-Specific Lighting Sanitizer
// ═══════════════════════════════════════════════════════════════════

/**
 * Lunar scene에서 moodLighting을 물리적으로 정확하게 교정.
 * "cold daylight entering from upper right, weak diffused glow, blue-grey cast"
 * → "harsh unfiltered sunlight from upper right, pitch-black sky, stark grey regolith surface"
 *
 * grep: sanitizeLunarLighting
 */
export function sanitizeLunarLighting(moodLighting: string): { text: string; rewrites: string[] } {
  let result = moodLighting;
  const rewrites: string[] = [];

  // "cold daylight" → "harsh unfiltered sunlight"
  if (/\bcold\s+daylight\b/i.test(result)) {
    result = result.replace(/\bcold\s+daylight\b/gi, "harsh unfiltered sunlight");
    rewrites.push("[lunar-light] cold daylight → harsh unfiltered sunlight");
  }

  // "weak diffused glow" → "stark high-contrast illumination"
  if (/\bweak\s+diffused\s+glow\b/i.test(result)) {
    result = result.replace(/\bweak\s+diffused\s+glow\b/gi, "stark high-contrast illumination with razor-sharp shadows");
    rewrites.push("[lunar-light] weak diffused glow → stark high-contrast illumination");
  }

  // "blue-grey cast" → "neutral grey tones under direct sunlight"
  if (/\bblue[\s-]?grey\s+cast\b/i.test(result)) {
    result = result.replace(/\bblue[\s-]?grey\s+cast\b/gi, "neutral grey surface tones, pitch-black sky");
    rewrites.push("[lunar-light] blue-grey cast → neutral grey surface, black sky");
  }

  // "entering from" → "from" (sunlight doesn't "enter" on the moon)
  if (/\bentering\s+from\b/i.test(result)) {
    result = result.replace(/\bentering\s+from\b/gi, "from");
    rewrites.push("[lunar-light] entering from → from (direct exposure, no medium)");
  }

  // Ensure "pitch-black sky" is present
  if (!/\b(pitch[\s-]?black|black)\s+sky\b/i.test(result) && !/\bsky\b/i.test(result)) {
    result = `${result}, pitch-black sky`;
    rewrites.push("[lunar-light] Added pitch-black sky");
  }

  return { text: result, rewrites };
}

// ═══════════════════════════════════════════════════════════════════
// 8. Lunar Camera Rewrite
// ═══════════════════════════════════════════════════════════════════

/**
 * Lunar environment scene camera를 물리적으로 적절하게 교정.
 * "Static wide shot"에 progression action이 있으면 slow pan/track으로.
 *
 * grep: sanitizeLunarCamera
 */
export function sanitizeLunarCamera(
  motion: string,
  action: string,
): { motion: string; rewrites: string[] } {
  const rewrites: string[] = [];
  let result = motion;

  // "Static wide shot" + progression → slow cinematic pan
  const hasProgression = /→|->|then\s|followed\s+by|finally\b/i.test(action);
  if (/\bstatic\b/i.test(result) && hasProgression) {
    result = "slow lateral pan revealing the scene";
    rewrites.push("[lunar-camera] Static + progression → slow lateral pan");
  }

  // Generic "Static" alone → "slow contemplative pan across the terrain"
  if (/^\s*static\s*$/i.test(result.trim())) {
    result = "very slow contemplative pan across the lunar terrain";
    rewrites.push("[lunar-camera] Static → slow contemplative pan (lunar environment)");
  }

  return { motion: result, rewrites };
}
