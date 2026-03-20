/**
 * kling-payload-normalizer.ts — Single authoritative Kling payload normalization layer
 *
 * This is the ONE shared module that produces the normalized Kling payload structure
 * used by:
 *   1. Server request path (generate-video.ts → _kling-api.ts)
 *   2. UI debug preview (VideoGenerationPanel.tsx)
 *   3. Korean shot summaries (shot-summary-ko.ts)
 *
 * RULES:
 *   - Pure functions only — no fetch, no secrets, no server-only APIs
 *   - Safe to import from both client and server
 *   - Deterministic: same input always produces same output
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/** A single normalized multi-shot entry, ready for Kling API. */
export interface NormalizedMultiPromptEntry {
  index: number;       // 1-based sequential
  prompt: string;      // cleaned, no internal tags
  duration: string;    // seconds as string (Kling API format)
}

/** The normalized intermediate Kling payload — single source of truth. */
export interface NormalizedKlingPayload {
  /** Top-level prompt (global context when multi_prompt present, full prompt otherwise) */
  prompt: string;
  /** Negative prompt (Kling uses separate field) */
  negative_prompt: string;
  /** Model ID */
  model: string;
  /** Duration in seconds */
  duration: number;
  /** Aspect ratio */
  aspect_ratio: "16:9" | "9:16" | "1:1";
  /** Sound on/off */
  sound: "on" | "off";
  /** model_params for multi-shot (only present when multi_prompt is non-empty) */
  model_params?: {
    multi_shot: true;
    shot_type: "customize";
    multi_prompt: NormalizedMultiPromptEntry[];
    element_list?: Array<{ element_id: string }>;
  };
  /** element_list when no multi_prompt but elements present */
  element_list_standalone?: Array<{ element_id: string }>;
  /** Preview-safe metadata */
  _meta: {
    hasImage: boolean;
    hasImageTail: boolean;
    shotCount: number;
    cleanupLog: string[];
  };
}

/** Input for the normalizer — assembled from app-level generation state. */
export interface KlingPayloadNormalizerInput {
  /** Base prompt text (may contain internal tags — will be cleaned) */
  prompt: string;
  /** Negative prompt terms */
  negativePrompt: string;
  /** Model ID */
  model: string;
  /** Duration in seconds (will be clamped to 3-15) */
  durationSec: number;
  /** Aspect ratio */
  aspectRatio?: string;
  /** Sound setting */
  sound?: "on" | "off";
  /** Multi-shot array (raw, may contain internal tags) */
  multiShot?: Array<{ index: number; prompt: string; duration: string; role?: string }>;
  /** Element list for character consistency */
  elementList?: Array<{ element_id: string }>;
  /** Whether an image is attached (for preview metadata) */
  hasImage?: boolean;
  /** Whether an image tail is attached */
  hasImageTail?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Pure Cleanup Utilities (shared between client and server)
// ═══════════════════════════════════════════════════════════════════

/**
 * Internal bracket tags that must NEVER reach the video provider.
 * These are editorial/planning scaffolding — not visual descriptions.
 */
const INTERNAL_TAG_PATTERNS = [
  /\[VISUAL LOCK\]\s*/gi,
  /\[CHARACTER LOCK\]\s*/gi,
  /\[CONTINUATION\][^.]*\./gi,
  /\[ENDING\][^.]*\./gi,
  /\[Establishing wide shot\]\s*/gi,
  /\[Developing mid shot\]\s*/gi,
  /\[Peak dramatic moment\]\s*/gi,
  /\[Resolving close-up\]\s*/gi,
  /\[Transition\]\s*/gi,
  /\[Insert detail\]\s*/gi,
  /\[Shot \d+\/\d+[^\]]*\]\s*/gi,
];

/** Strip all internal bracket meta tags from a prompt string. */
export function stripInternalTags(text: string): string {
  let cleaned = text;
  for (const pattern of INTERNAL_TAG_PATTERNS) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, "");
  }
  // Catch any remaining [ALLCAPS ...] editorial tags
  cleaned = cleaned.replace(/\[(?:VISUAL|CHARACTER|CONTINUATION|ENDING|NARRATIVE|LOCK)[^\]]*\]\s*/gi, "");
  return cleaned.replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();
}

/**
 * Deduplicate repeated clauses in a prompt.
 * Split by sentence boundaries, keep first occurrence of each normalized clause.
 */
export function deduplicatePromptClauses(text: string): string {
  const sentences = text.split(/\.\s+/).filter(s => s.trim().length > 3);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const s of sentences) {
    const norm = s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
    if (norm.length < 10) { unique.push(s.trim()); continue; }
    let isDupe = false;
    for (const prev of seen) {
      if (prev === norm) { isDupe = true; break; }
      if (prev.includes(norm) || norm.includes(prev)) { isDupe = true; break; }
    }
    if (!isDupe) {
      seen.add(norm);
      unique.push(s.trim());
    }
  }
  return unique.join(". ").replace(/\.\s*\./g, ".").trim();
}

// ── Scene Contradiction Normalization ──

const INDOOR_SIGNALS = /\b(room|office|clinic|hospital|kitchen|hall|basement|attic|corridor|workshop|studio|laboratory|church|palace|prison|tower|library|interior|indoor|inside|ceiling|wall|cabinet|shelf|tray)\b/i;
const OUTDOOR_SIGNALS = /\b(hilltop|mountain|valley|canyon|cliff|desert|beach|ocean|forest|field|sky|horizon|landscape|rooftop|garden|plaza|street|highway|meadow|tundra|glacier|volcano|jungle|swamp)\b/i;
const OUTDOOR_LIGHT_RE = /\b(golden\s+hour|late\s+afternoon\s+sun|blue\s+hour|overcast\s+sky|sunset|sunrise|moonlight|starlight|clear\s+sky\s+light|dappled\s+sunlight|morning\s+mist|fog[\s-]?bank|open[\s-]?air\s+light)\b/gi;
const EPIC_NARRATIVE_RE = /\b(warrior|giant|battle|hero|villain|army|sword\s+fight|David\s+and\s+Goliath|epic\s+clash|siege|conquest|rampage|titan|colossus|rampart|cavalry|infantry|crusade)\b/gi;

/**
 * Normalize contradictory lighting and narrative language based on scene type inference.
 */
export function normalizeSceneContradictions(text: string): { text: string; log: string[] } {
  const log: string[] = [];
  let result = text;

  const isIndoor = INDOOR_SIGNALS.test(text);
  const isOutdoor = OUTDOOR_SIGNALS.test(text);

  if (isIndoor && !isOutdoor) {
    OUTDOOR_LIGHT_RE.lastIndex = 0;
    const outdoorLightMatches = text.match(OUTDOOR_LIGHT_RE);
    if (outdoorLightMatches) {
      for (const match of outdoorLightMatches) {
        result = result.replace(match, "warm interior light");
        log.push(`[scene-norm] Replaced outdoor light "${match}" → "warm interior light" (indoor scene)`);
      }
    }
  }

  const isMedicalOrTool = /\b(dental|medical|clinic|surgical|operating|tool|instrument|drill|scalpel)\b/i.test(text);
  if (isMedicalOrTool) {
    EPIC_NARRATIVE_RE.lastIndex = 0;
    const epicMatches = text.match(EPIC_NARRATIVE_RE);
    if (epicMatches) {
      for (const match of epicMatches) {
        result = result.replace(new RegExp(`\\b${match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "");
        log.push(`[scene-norm] Removed contradictory narrative term "${match}" (medical/tool scene)`);
      }
    }
  }

  result = result.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").replace(/\.\s*\./g, ".").trim();
  return { text: result, log };
}

// ── Global Anchor Extraction ──

/**
 * Extract global anchors from a prompt — elements that define the persistent
 * visual identity of the entire clip (medium, era, location, material, light family).
 */
export function extractGlobalAnchors(prompt: string): string {
  const clauses = prompt.split(/\.\s+/).filter(s => s.trim().length > 3);
  const globalPatterns = [
    /\b(claymation|stop[\s-]?motion|fingerprint|handcrafted|clay\s+surface|visible\s+texture)/i,
    /\b(1[0-9]{3}s|19th\s+century|medieval|victorian|antique|archaic|ancient)/i,
    /\b(dental\s+room|dental\s+office|clinic|operating\s+room|laboratory|workshop)/i,
    /\b(dim(?:ly)?\s+lit|warm\s+(?:practical|tungsten|lamp)\s+light|low[\s-]?key\s+light|candlelit|gaslight|interior\s+light)/i,
    /\b(cinematic|photorealistic|live[\s-]?action|documentary|animation|watercolor|oil\s+paint)/i,
    /\b(desaturated|warm\s+palette|cool\s+palette|monochrome|sepia|muted\s+color)/i,
  ];
  const global: string[] = [];
  for (const clause of clauses) {
    if (globalPatterns.some(p => p.test(clause))) {
      global.push(clause.trim());
    }
  }
  return global.length > 0 ? global.join(". ") : "";
}

// ═══════════════════════════════════════════════════════════════════
// Duration Helpers
// ═══════════════════════════════════════════════════════════════════

/** Clamp duration to Kling O3 supported range: 3-15 seconds. */
export function clampKlingDuration(sec: number): number {
  return Math.min(15, Math.max(3, Math.round(sec)));
}

/** Normalize aspect ratio to Kling-supported values. */
export function normalizeAspectRatio(ratio?: string): "16:9" | "9:16" | "1:1" {
  return ratio === "9:16" ? "9:16" : ratio === "1:1" ? "1:1" : "16:9";
}

// ═══════════════════════════════════════════════════════════════════
// Shot Prompt Cleanup
// ═══════════════════════════════════════════════════════════════════

/**
 * Clean a single shot prompt: strip tags → normalize contradictions → deduplicate.
 *
 * @param sceneContext Optional parent prompt to inherit scene signals from.
 *   This allows per-shot contradiction normalization to use the global scene context
 *   (e.g., if the top-level prompt describes a dental room, shot-level "golden hour"
 *   will be correctly caught even if the shot itself doesn't mention "room").
 */
export function cleanShotPrompt(prompt: string, sceneContext?: string): { cleaned: string; log: string[] } {
  const log: string[] = [];
  let cleaned = stripInternalTags(prompt);
  // When scene context is provided, combine with shot text for scene-type detection
  // but only apply normalization to the shot text itself
  const contextForDetection = sceneContext ? `${sceneContext}. ${cleaned}` : cleaned;
  const normResult = normalizeSceneContradictions(contextForDetection);
  // Extract only the shot portion (after the context prefix)
  if (sceneContext) {
    const contextLen = sceneContext.length + 2; // ". " separator
    const fullNormalized = normResult.text;
    // The context portion was also normalized, extract just the shot part
    cleaned = fullNormalized.slice(contextLen).trim();
    // Clean up any leading separators
    cleaned = cleaned.replace(/^[.,\s]+/, "").trim();
  } else {
    cleaned = normResult.text;
  }
  log.push(...normResult.log);
  cleaned = deduplicatePromptClauses(cleaned);
  return { cleaned, log };
}

// ═══════════════════════════════════════════════════════════════════
// Main Normalizer
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the normalized Kling payload — THE single authoritative builder.
 *
 * This function is the source of truth for:
 *   - Server actual request body
 *   - UI debug preview
 *   - Korean shot summary source data
 *
 * Pure function: no side effects, no network, no secrets.
 */
export function buildNormalizedKlingPayload(input: KlingPayloadNormalizerInput): NormalizedKlingPayload {
  const cleanupLog: string[] = [];
  const duration = clampKlingDuration(input.durationSec);
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);

  // Step 1: Clean top-level prompt
  let prompt = stripInternalTags(input.prompt);
  const topNorm = normalizeSceneContradictions(prompt);
  prompt = topNorm.text;
  cleanupLog.push(...topNorm.log);
  prompt = deduplicatePromptClauses(prompt);

  // Step 2: Clean and normalize multi-shot entries
  // Pass the cleaned top-level prompt as scene context so per-shot normalization
  // inherits the global scene type (e.g., indoor dental room → outdoor light removed)
  let normalizedMultiPrompt: NormalizedMultiPromptEntry[] = [];
  if (input.multiShot && input.multiShot.length > 0) {
    for (const shot of input.multiShot) {
      const { cleaned, log } = cleanShotPrompt(shot.prompt, prompt);
      cleanupLog.push(...log);
      normalizedMultiPrompt.push({
        index: shot.index,
        prompt: cleaned,
        duration: shot.duration,
      });
    }

    // Re-index sequentially (1-based)
    normalizedMultiPrompt = normalizedMultiPrompt.map((s, i) => ({
      ...s,
      index: i + 1,
    }));

    // Ensure all durations are strings
    normalizedMultiPrompt = normalizedMultiPrompt.map(s => ({
      ...s,
      duration: String(s.duration),
    }));

    // When multiShot is present, top-level prompt should be global-only
    const globalOnly = extractGlobalAnchors(prompt);
    if (globalOnly.length > 20) {
      prompt = deduplicatePromptClauses(globalOnly);
    } else {
      // Fallback: use first 2 sentences as global context
      const sentences = prompt.split(/\.\s+/).filter(s => s.trim().length > 5);
      if (sentences.length > 0) {
        prompt = sentences.slice(0, 2).join(". ").trim();
      }
    }
  }

  // Step 3: Build the payload
  const payload: NormalizedKlingPayload = {
    prompt,
    negative_prompt: input.negativePrompt || "",
    model: input.model,
    duration,
    aspect_ratio: aspectRatio,
    sound: input.sound ?? "on",
    _meta: {
      hasImage: !!input.hasImage,
      hasImageTail: !!input.hasImageTail,
      shotCount: normalizedMultiPrompt.length,
      cleanupLog,
    },
  };

  // Step 4: Attach model_params if multi-shot
  if (normalizedMultiPrompt.length > 0) {
    payload.model_params = {
      multi_shot: true,
      shot_type: "customize",
      multi_prompt: normalizedMultiPrompt,
    };
    // Attach element_list inside model_params when multi-shot
    if (input.elementList && input.elementList.length > 0) {
      payload.model_params.element_list = input.elementList.map(el => ({
        element_id: el.element_id,
      }));
    }
  } else if (input.elementList && input.elementList.length > 0) {
    // Standalone element_list (no multi-shot)
    payload.element_list_standalone = input.elementList.map(el => ({
      element_id: el.element_id,
    }));
  }

  return payload;
}

// ═══════════════════════════════════════════════════════════════════
// Preview Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a display-safe version of the normalized payload.
 * Truncates long prompt text but preserves structural accuracy.
 */
export function buildPreviewPayload(payload: NormalizedKlingPayload, maxPromptLen = 120): Record<string, unknown> {
  const preview: Record<string, unknown> = {
    model: payload.model,
    prompt: truncateForPreview(payload.prompt, maxPromptLen),
    negative_prompt: payload.negative_prompt,
    duration: payload.duration,
    aspect_ratio: payload.aspect_ratio,
    sound: payload.sound,
  };

  if (payload.model_params) {
    preview.model_params = {
      multi_shot: true,
      shot_type: "customize",
      multi_prompt: payload.model_params.multi_prompt.map(s => ({
        index: s.index,
        prompt: truncateForPreview(s.prompt, maxPromptLen),
        duration: s.duration,
      })),
      ...(payload.model_params.element_list ? { element_list: payload.model_params.element_list } : {}),
    };
  }

  if (payload.element_list_standalone) {
    preview.element_list = payload.element_list_standalone;
  }

  return preview;
}

function truncateForPreview(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

/**
 * Extract the normalized multi_prompt entries from a payload.
 * This is the authoritative source for Korean shot summaries.
 */
export function getMultiPromptFromPayload(
  payload: NormalizedKlingPayload,
): NormalizedMultiPromptEntry[] {
  return payload.model_params?.multi_prompt ?? [];
}
