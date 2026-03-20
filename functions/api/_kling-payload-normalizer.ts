/**
 * _kling-payload-normalizer.ts — Server-side mirror of src/lib/kling-payload-normalizer.ts
 *
 * IMPORTANT: This file MUST be kept in sync with src/lib/kling-payload-normalizer.ts.
 * Both files implement the SAME pure normalization logic.
 * The duplication exists because Cloudflare Pages Functions cannot import from src/lib.
 *
 * This is the ONE authoritative builder for Kling payloads on the server side.
 * The client-side mirror is used for UI preview and Korean summaries.
 *
 * DO NOT add server-only logic here — keep it pure.
 * Server-specific logic (secrets, fetch, env) stays in generate-video.ts.
 */

// ═══════════════════════════════════════════════════════════════════
// Types (mirrored from src/lib/kling-payload-normalizer.ts)
// ═══════════════════════════════════════════════════════════════════

export interface NormalizedMultiPromptEntry {
  index: number;
  prompt: string;
  duration: string;
}

export interface NormalizedKlingPayload {
  prompt: string;
  negative_prompt: string;
  model: string;
  duration: number;
  aspect_ratio: "16:9" | "9:16" | "1:1";
  sound: "on" | "off";
  model_params?: {
    multi_shot: true;
    shot_type: "customize";
    multi_prompt: NormalizedMultiPromptEntry[];
    element_list?: Array<{ element_id: string }>;
  };
  element_list_standalone?: Array<{ element_id: string }>;
  _meta: {
    hasImage: boolean;
    hasImageTail: boolean;
    shotCount: number;
    cleanupLog: string[];
  };
}

export interface KlingPayloadNormalizerInput {
  prompt: string;
  negativePrompt: string;
  model: string;
  durationSec: number;
  aspectRatio?: string;
  sound?: "on" | "off";
  multiShot?: Array<{ index: number; prompt: string; duration: string; role?: string }>;
  elementList?: Array<{ element_id: string }>;
  hasImage?: boolean;
  hasImageTail?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Pure Cleanup Utilities (mirrored)
// ═══════════════════════════════════════════════════════════════════

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

export function stripInternalTags(text: string): string {
  let cleaned = text;
  for (const pattern of INTERNAL_TAG_PATTERNS) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, "");
  }
  cleaned = cleaned.replace(/\[(?:VISUAL|CHARACTER|CONTINUATION|ENDING|NARRATIVE|LOCK)[^\]]*\]\s*/gi, "");
  return cleaned.replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();
}

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

const INDOOR_SIGNALS = /\b(room|office|clinic|hospital|kitchen|hall|basement|attic|corridor|workshop|studio|laboratory|church|palace|prison|tower|library|interior|indoor|inside|ceiling|wall|cabinet|shelf|tray)\b/i;
const OUTDOOR_SIGNALS = /\b(hilltop|mountain|valley|canyon|cliff|desert|beach|ocean|forest|field|sky|horizon|landscape|rooftop|garden|plaza|street|highway|meadow|tundra|glacier|volcano|jungle|swamp)\b/i;
const OUTDOOR_LIGHT_RE = /\b(golden\s+hour|late\s+afternoon\s+sun|blue\s+hour|overcast\s+sky|sunset|sunrise|moonlight|starlight|clear\s+sky\s+light|dappled\s+sunlight|morning\s+mist|fog[\s-]?bank|open[\s-]?air\s+light)\b/gi;
const EPIC_NARRATIVE_RE = /\b(warrior|giant|battle|hero|villain|army|sword\s+fight|David\s+and\s+Goliath|epic\s+clash|siege|conquest|rampage|titan|colossus|rampart|cavalry|infantry|crusade)\b/gi;

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

const STYLE_MEDIUM_RE = /\b(claymation|stop[\s-]?motion|clay\s+figure|fingerprint\s+texture|handcrafted|paper[\s-]?collage|felt[\s-]?craft|wooden[\s-]?puppet|handmade[\s-]?miniature|watercolor|oil\s+paint(?:ing)?|pencil\s+sketch|charcoal|ink\s+wash|anime|cel[\s-]?shad(?:ed|ing)|pixel\s+art|voxel|low[\s-]?poly|retro\s+(?:8|16)[\s-]?bit)\b/gi;

export function extractStyleAnchor(prompt: string): string {
  STYLE_MEDIUM_RE.lastIndex = 0;
  const matches = prompt.match(STYLE_MEDIUM_RE);
  if (!matches || matches.length === 0) return "";
  const unique = [...new Set(matches.map(m => m.toLowerCase().trim()))];
  return unique.slice(0, 3).join(", ");
}

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

export function clampKlingDuration(sec: number): number {
  return Math.min(15, Math.max(3, Math.round(sec)));
}

export function normalizeAspectRatio(ratio?: string): "16:9" | "9:16" | "1:1" {
  return ratio === "9:16" ? "9:16" : ratio === "1:1" ? "1:1" : "16:9";
}

export function cleanShotPrompt(prompt: string, sceneContext?: string): { cleaned: string; log: string[] } {
  const log: string[] = [];
  let cleaned = stripInternalTags(prompt);
  const contextForDetection = sceneContext ? `${sceneContext}. ${cleaned}` : cleaned;
  const normResult = normalizeSceneContradictions(contextForDetection);
  if (sceneContext) {
    const contextLen = sceneContext.length + 2;
    const fullNormalized = normResult.text;
    cleaned = fullNormalized.slice(contextLen).trim();
    cleaned = cleaned.replace(/^[.,\s]+/, "").trim();
  } else {
    cleaned = normResult.text;
  }
  log.push(...normResult.log);
  cleaned = deduplicatePromptClauses(cleaned);
  return { cleaned, log };
}

// ═══════════════════════════════════════════════════════════════════
// Main Normalizer (mirrored)
// ═══════════════════════════════════════════════════════════════════

export function buildNormalizedKlingPayload(input: KlingPayloadNormalizerInput): NormalizedKlingPayload {
  const cleanupLog: string[] = [];
  const duration = clampKlingDuration(input.durationSec);
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);

  let prompt = stripInternalTags(input.prompt);
  const topNorm = normalizeSceneContradictions(prompt);
  prompt = topNorm.text;
  cleanupLog.push(...topNorm.log);
  prompt = deduplicatePromptClauses(prompt);

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

    normalizedMultiPrompt = normalizedMultiPrompt.map((s, i) => ({
      ...s,
      index: i + 1,
    }));

    normalizedMultiPrompt = normalizedMultiPrompt.map(s => ({
      ...s,
      duration: String(s.duration),
    }));

    // Inject style anchor into each per-shot prompt.
    const styleAnchor = extractStyleAnchor(prompt);
    if (styleAnchor) {
      normalizedMultiPrompt = normalizedMultiPrompt.map(s => {
        const shotLower = s.prompt.toLowerCase();
        const alreadyHasStyle = styleAnchor.split(", ").some(token => shotLower.includes(token));
        if (alreadyHasStyle) return s;
        return {
          ...s,
          prompt: `${styleAnchor}. ${s.prompt}`,
        };
      });
      cleanupLog.push(`[style-anchor] Injected "${styleAnchor}" into ${normalizedMultiPrompt.length} per-shot prompts`);
    }

    const globalOnly = extractGlobalAnchors(prompt);
    if (globalOnly.length > 20) {
      prompt = deduplicatePromptClauses(globalOnly);
    } else {
      const sentences = prompt.split(/\.\s+/).filter(s => s.trim().length > 5);
      if (sentences.length > 0) {
        prompt = sentences.slice(0, 2).join(". ").trim();
      }
    }
  }

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

  if (normalizedMultiPrompt.length > 0) {
    payload.model_params = {
      multi_shot: true,
      shot_type: "customize",
      multi_prompt: normalizedMultiPrompt,
    };
    if (input.elementList && input.elementList.length > 0) {
      payload.model_params.element_list = input.elementList.map(el => ({
        element_id: el.element_id,
      }));
    }
  } else if (input.elementList && input.elementList.length > 0) {
    payload.element_list_standalone = input.elementList.map(el => ({
      element_id: el.element_id,
    }));
  }

  return payload;
}

export function getMultiPromptFromPayload(
  payload: NormalizedKlingPayload,
): NormalizedMultiPromptEntry[] {
  return payload.model_params?.multi_prompt ?? [];
}
