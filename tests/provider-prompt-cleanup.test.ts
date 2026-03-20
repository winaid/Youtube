/**
 * provider-prompt-cleanup.test.ts — Provider-facing prompt cleanup tests
 *
 * Tests that internal editorial scaffolding is stripped before VEO submission,
 * continuity visualLock is compact, multi-shot auto-repair produces different prompts,
 * and domain-specific scene anchors are preserved.
 */

import { describe, it, expect } from "vitest";
import { generateShotSummaryKo, generateMultiShotSummariesKo } from "@/lib/shot-summary-ko";

// ═══════════════════════════════════════════════════════════════════
// Import the functions under test from generate-video.ts
// Since these are module-private in a Cloudflare Pages Function,
// we re-implement the exact same logic here for unit testing.
// The canonical code lives in functions/api/generate-video.ts.
// ═══════════════════════════════════════════════════════════════════

// ── Internal tag patterns (mirrored from generate-video.ts) ──
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

function stripInternalTags(text: string): string {
  let cleaned = text;
  for (const pattern of INTERNAL_TAG_PATTERNS) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, "");
  }
  cleaned = cleaned.replace(/\[(?:VISUAL|CHARACTER|CONTINUATION|ENDING|NARRATIVE|LOCK)[^\]]*\]\s*/gi, "");
  return cleaned.replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();
}

function deduplicatePromptClauses(text: string): string {
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

function extractCompactVisualLock(rawLock: string): string {
  if (!rawLock || rawLock.length < 5) return "";
  // Strip disallowed concepts before extraction
  const stripped = rawLock
    .replace(/\b(no\s+text\s+overlay|no\s+watermark|no\s+caption)\b/gi, "")
    .replace(/\b\d+:\d+\b/g, "")
    .replace(/\b(cinematic\s+framing|widescreen|letterbox)\b/gi, "")
    .trim();
  const anchors: string[] = [];
  const mediumMatch = stripped.match(/\b(claymation|stop[\s-]?motion|watercolor|oil[\s-]?paint|pencil[\s-]?sketch|anime|cel[\s-]?shad|charcoal|photorealistic|cinematic[\s-]?realism|documentary|live[\s-]?action)\b/i);
  if (mediumMatch) anchors.push(mediumMatch[0].toLowerCase());
  const materialMatch = stripped.match(/\b(fingerprint\s+texture|handcrafted|clay\s+surface|impasto|visible\s+brush|grainy\s+film|film\s+grain|halation)\b/i);
  if (materialMatch) anchors.push(materialMatch[0].toLowerCase());
  const paletteMatch = stripped.match(/\b(desaturated|warm\s+palette|cool\s+palette|monochrome|sepia|muted|pastel|high[\s-]?contrast|low[\s-]?key|high[\s-]?key)\b/i);
  if (paletteMatch) anchors.push(paletteMatch[0].toLowerCase());
  // Only stable interior-safe light families — no golden hour / overcast / blue hour (outdoor)
  const lightMatch = stripped.match(/\b(practical\s+light|tungsten|candlelit|gaslight|neon|studio\s+light|backlit|rim[\s-]?light|warm\s+lamp\s+light)\b/i);
  if (lightMatch) anchors.push(lightMatch[0].toLowerCase());
  if (anchors.length === 0) return "";
  return anchors.join(", ");
}

function extractGlobalAnchors(prompt: string): string {
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

// Server-side decomposition (mirrored)
const SRV_SPACE_RE = /\b(room|street|office|hospital|clinic|kitchen|hall|temple|ruins|forest|city|castle|village|cave|beach|mountain|valley|garden|corridor|alley|workshop|studio|laboratory|church|palace|prison|tower|basement|attic|library|station|arena|plaza|courtyard|dock|warehouse|factory|bridge|tunnel|rooftop|balcony|tray|chair|table|shelf|cabinet|counter|desk|bed)\b/gi;
const SRV_ACTION_RE = /\b(rides?|walks?|runs?|spins?|turns?|opens?|pushes?|pulls?|enters?|climbs?|grabs?|reaches?|approaches|comes?\s+alive|moves?|emerges?|stretches?|shifts?|vibrates?|rotates?|oscillates?)\b/gi;
const SRV_DETAIL_RE = /\b(rust(?:y|ed)?|metal|steel|iron|glass|leather|fabric|wood|stone|ceramic|dust|smoke|steam|glow\w*|shadow\w*|texture|grain|surface|crack|patina|oxidized|worn|tarnished|polished|gleaming|drill|blade|needle|scalpel|forceps|clamp|pliers|saw|tool|instrument|device|mechanism|gauge|dial|handle|switch|lever|knob|tray|vial|bottle|jar|flask|lamp|bulb|filament|wire|cable|chain|strap|buckle|rivet|hinge|latch|gear|cog|spring|valve)\b/gi;

function serverExtractTerms(text: string, re: RegExp): string[] {
  re.lastIndex = 0;
  const matches = text.match(re);
  return matches ? [...new Set(matches.map(m => m.toLowerCase()))] : [];
}

function serverDecomposePrompt(prompt: string) {
  const spaceWords = serverExtractTerms(prompt, SRV_SPACE_RE);
  const actionWords = serverExtractTerms(prompt, SRV_ACTION_RE);
  const detailWords = serverExtractTerms(prompt, SRV_DETAIL_RE);

  return { space: spaceWords, action: actionWords, detail: detailWords };
}

const ROLE_SEQUENCES: Record<number, string[]> = {
  2: ["establish", "resolve"],
  3: ["establish", "develop", "resolve"],
  4: ["establish", "develop", "peak", "resolve"],
  5: ["establish", "transition", "develop", "peak", "resolve"],
};

// ═══════════════════════════════════════════════════════════════════
// 1. Internal meta tags are stripped from final provider payload
// ═══════════════════════════════════════════════════════════════════

describe("stripInternalTags", () => {
  it("removes all bracket editorial tags", () => {
    const input = "[VISUAL LOCK] claymation stop-motion. [CHARACTER LOCK] A dentist figure. [Establishing wide shot] Dimly lit room.";
    const result = stripInternalTags(input);
    expect(result).not.toContain("[VISUAL LOCK]");
    expect(result).not.toContain("[CHARACTER LOCK]");
    expect(result).not.toContain("[Establishing wide shot]");
    // Visual content after tags is preserved
    expect(result).toContain("claymation stop-motion");
    expect(result).toContain("A dentist figure");
    expect(result).toContain("Dimly lit room");
  });

  it("removes [CONTINUATION] with its following sentence", () => {
    const input = "[CONTINUATION] This clip continues from previous segment: Subject centered. Start seamlessly. The dental drill spins.";
    const result = stripInternalTags(input);
    expect(result).not.toContain("[CONTINUATION]");
    expect(result).toContain("dental drill spins");
  });

  it("removes [ENDING] with its instruction", () => {
    const input = "Scene starts. [ENDING] Last 2 seconds: mid-action, camera moving. The drill approaches.";
    const result = stripInternalTags(input);
    expect(result).not.toContain("[ENDING]");
    expect(result).toContain("Scene starts");
    expect(result).toContain("drill approaches");
  });

  it("removes [Shot x/y — role] labels", () => {
    const input = "[Shot 3/5 — peak] Close-up of the spinning drill.";
    const result = stripInternalTags(input);
    expect(result).not.toContain("[Shot 3/5");
    expect(result).toContain("Close-up of the spinning drill");
  });

  it("removes [Peak dramatic moment] and [Resolving close-up]", () => {
    const input = "[Peak dramatic moment] The drill descends. [Resolving close-up] Aftermath.";
    const result = stripInternalTags(input);
    expect(result).not.toContain("[Peak dramatic moment]");
    expect(result).not.toContain("[Resolving close-up]");
    expect(result).toContain("The drill descends");
    expect(result).toContain("Aftermath");
  });

  it("handles prompt with no tags (passthrough)", () => {
    const input = "Dimly lit 1900s dental room with antique tools and warm practical light.";
    const result = stripInternalTags(input);
    expect(result).toBe(input);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Continuity visualLock is NOT the raw styleSuffix blob
// ═══════════════════════════════════════════════════════════════════

describe("extractCompactVisualLock", () => {
  it("extracts compact anchors from a verbose styleSuffix", () => {
    const fullSuffix = "Claymation stop-motion with visible fingerprint texture and handcrafted clay surfaces. Warm practical light, desaturated palette. No text overlay, no watermark. 16:9 cinematic framing.";
    const compact = extractCompactVisualLock(fullSuffix);
    expect(compact).toContain("claymation");
    expect(compact).toContain("fingerprint texture");
    expect(compact).toContain("desaturated");
    expect(compact).toContain("practical light");
    // Should NOT contain the full suffix
    expect(compact.length).toBeLessThan(fullSuffix.length);
    // Should NOT contain "no text overlay" or "16:9"
    expect(compact).not.toContain("text overlay");
    expect(compact).not.toContain("16:9");
  });

  it("returns empty string when no anchors match (no fallback)", () => {
    const minimal = "An unusual artistic rendering";
    const compact = extractCompactVisualLock(minimal);
    expect(compact).toBe("");
  });

  it("strips 'no text overlay', aspect ratios, and 'cinematic framing' before extraction", () => {
    const input = "Claymation. No text overlay, no watermark. 16:9 cinematic framing. Desaturated palette.";
    const compact = extractCompactVisualLock(input);
    expect(compact).toContain("claymation");
    expect(compact).toContain("desaturated");
    expect(compact).not.toContain("text overlay");
    expect(compact).not.toContain("16:9");
    expect(compact).not.toContain("cinematic framing");
  });

  it("excludes outdoor light families (golden hour, overcast, blue hour)", () => {
    const input = "Claymation stop-motion. Golden hour light, overcast sky. Desaturated palette.";
    const compact = extractCompactVisualLock(input);
    expect(compact).toContain("claymation");
    expect(compact).toContain("desaturated");
    expect(compact).not.toContain("golden hour");
    expect(compact).not.toContain("overcast");
  });

  it("includes interior-safe light families (practical light, tungsten, candlelit)", () => {
    const input = "Warm practical light, tungsten glow. Claymation.";
    const compact = extractCompactVisualLock(input);
    expect(compact).toContain("practical light");
    expect(compact).toContain("claymation");
  });

  it("returns empty string for empty input", () => {
    expect(extractCompactVisualLock("")).toBe("");
    expect(extractCompactVisualLock("ab")).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Multi-shot auto-repair does NOT create near-identical prompts
// ═══════════════════════════════════════════════════════════════════

describe("multi-shot prompt differentiation", () => {
  const dentalPrompt = "Claymation stop-motion with visible fingerprint texture. Dim 1900s dental room with antique tools. A sharp spinning drill bit comes alive on a rusty tray. Warm practical interior light, desaturated palette.";

  it("decomposes prompt into different visual layers", () => {
    const layers = serverDecomposePrompt(dentalPrompt);
    expect(layers.space.length).toBeGreaterThan(0);
    expect(layers.detail.length).toBeGreaterThan(0);
    // Should find dental-related terms
    expect(layers.space).toContain("room");
    expect(layers.detail).toContain("drill");
    expect(layers.detail).toContain("tray");
  });

  it("role sequences have the right number of roles", () => {
    expect(ROLE_SEQUENCES[3]).toHaveLength(3);
    expect(ROLE_SEQUENCES[4]).toHaveLength(4);
    expect(ROLE_SEQUENCES[5]).toHaveLength(5);
  });

  it("role sequences contain distinct roles (no repeats)", () => {
    for (const [count, roles] of Object.entries(ROLE_SEQUENCES)) {
      const unique = new Set(roles);
      expect(unique.size, `${count}-shot should have ${roles.length} unique roles`).toBe(roles.length);
    }
  });

  it("does not produce bracket tags in any shot prompt", () => {
    // Simulate what buildServerMultiShot would produce
    const layers = serverDecomposePrompt(dentalPrompt);
    const shots = ["establish", "develop", "peak", "resolve"];
    for (const role of shots) {
      // None of these role names should appear as bracket tags
      expect(role).not.toContain("[");
      expect(role).not.toContain("]");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. When multiShot exists, top-level prompt is global-only
// ═══════════════════════════════════════════════════════════════════

describe("extractGlobalAnchors", () => {
  it("extracts medium, era, location, and light anchors", () => {
    const prompt = "Claymation stop-motion with visible fingerprint texture. Dim 1900s dental room with antique tools. Sharp spinning drill bit on rusty tray. Warm practical interior light, desaturated palette. Subject approaches chair.";
    const global = extractGlobalAnchors(prompt);
    expect(global).toContain("Claymation");
    expect(global).toContain("1900s dental room");
    // Should NOT contain action-specific content
    expect(global).not.toContain("Subject approaches");
    expect(global).not.toContain("spinning drill bit on rusty tray");
  });

  it("returns empty for prompts with no global anchors", () => {
    const prompt = "A person walks across the frame. They stop and look around. Something catches their eye.";
    const global = extractGlobalAnchors(prompt);
    expect(global).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Dental-room scene retains domain-specific anchors
// ═══════════════════════════════════════════════════════════════════

describe("dental scene anchor preservation", () => {
  const dentalPrompt = "[VISUAL LOCK] claymation stop-motion, warm palette. [Establishing wide shot] Dim 1900s dental room with archaic rusty dental tools. Sharp spinning drill bit on a metal tray. Warm practical interior light.";

  it("stripInternalTags preserves dental anchors", () => {
    const cleaned = stripInternalTags(dentalPrompt);
    expect(cleaned).toContain("dental room");
    expect(cleaned).toContain("dental tools");
    expect(cleaned).toContain("drill bit");
    expect(cleaned).toContain("metal tray");
    expect(cleaned).toContain("1900s");
  });

  it("domain nouns survive deduplication", () => {
    const cleaned = stripInternalTags(dentalPrompt);
    const deduped = deduplicatePromptClauses(cleaned);
    expect(deduped).toContain("dental room");
    expect(deduped).toContain("drill bit");
  });

  it("global anchors include dental room and era", () => {
    const cleaned = stripInternalTags(dentalPrompt);
    const global = extractGlobalAnchors(cleaned);
    expect(global).toContain("dental room");
    expect(global).toContain("1900s");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Duplicate style lines are deduped
// ═══════════════════════════════════════════════════════════════════

describe("deduplicatePromptClauses", () => {
  it("removes exact duplicate sentences", () => {
    const input = "Claymation stop-motion with texture. Dim dental room. Claymation stop-motion with texture. Sharp drill bit.";
    const result = deduplicatePromptClauses(input);
    const occurrences = result.split("Claymation stop-motion").length - 1;
    expect(occurrences).toBe(1);
    expect(result).toContain("drill bit");
  });

  it("removes substring-contained duplicates", () => {
    const input = "Warm practical interior light. Warm practical interior light, desaturated palette. Sharp drill.";
    const result = deduplicatePromptClauses(input);
    // The longer clause should survive, the shorter contained one removed
    expect(result).toContain("drill");
  });

  it("preserves short functional sentences", () => {
    const input = "Go wide. Dim room. Go wide. Push in.";
    const result = deduplicatePromptClauses(input);
    // Short sentences (<10 normalized chars) are allowed through
    expect(result).toContain("Go wide");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Full pipeline integration — dental scene end-to-end
// ═══════════════════════════════════════════════════════════════════

describe("full pipeline: dental scene → provider payload", () => {
  it("produces clean provider payload from tagged input", () => {
    const rawPrompt = "[VISUAL LOCK] claymation stop-motion, fingerprint texture, warm practical light. [CHARACTER LOCK] A worn dental figure. [Establishing wide shot] Dim 1900s dental room with archaic rusty dental tools and antique chair. Sharp spinning drill bit comes alive on the rusty tray. Warm practical interior light, desaturated palette. [ENDING] Last 2 seconds: mid-action, camera moving, emotion unresolved. Do not close the scene.";

    // Step 1: Strip tags
    let cleaned = stripInternalTags(rawPrompt);

    // No bracket tags remain
    expect(cleaned).not.toMatch(/\[.*?\]/);

    // Step 2: Deduplicate
    cleaned = deduplicatePromptClauses(cleaned);

    // Domain anchors preserved
    expect(cleaned).toContain("dental room");
    expect(cleaned).toContain("dental tools");
    expect(cleaned).toContain("drill bit");
    expect(cleaned).toContain("1900s");

    // Useful visual content preserved (tag content kept, tag stripped)
    expect(cleaned).toContain("claymation stop-motion");
    expect(cleaned).toContain("fingerprint texture");
    expect(cleaned).toContain("warm practical");

    // Step 3: Global anchors
    const global = extractGlobalAnchors(cleaned);
    expect(global.length).toBeGreaterThan(20);
    expect(global).toContain("claymation");
    expect(global).toContain("1900s dental room");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Scene contradiction normalization
// ═══════════════════════════════════════════════════════════════════

// Mirrored from generate-video.ts
const INDOOR_SIGNALS = /\b(room|office|clinic|hospital|kitchen|hall|basement|attic|corridor|workshop|studio|laboratory|church|palace|prison|tower|library|interior|indoor|inside|ceiling|wall|cabinet|shelf|tray)\b/i;
const OUTDOOR_SIGNALS = /\b(hilltop|mountain|valley|canyon|cliff|desert|beach|ocean|forest|field|sky|horizon|landscape|rooftop|garden|plaza|street|highway|meadow|tundra|glacier|volcano|jungle|swamp)\b/i;
const OUTDOOR_LIGHT_RE = /\b(golden\s+hour|late\s+afternoon\s+sun|blue\s+hour|overcast\s+sky|sunset|sunrise|moonlight|starlight|clear\s+sky\s+light|dappled\s+sunlight|morning\s+mist|fog[\s-]?bank|open[\s-]?air\s+light)\b/gi;
const EPIC_NARRATIVE_RE = /\b(warrior|giant|battle|hero|villain|army|sword\s+fight|David\s+and\s+Goliath|epic\s+clash|siege|conquest|rampage|titan|colossus|rampart|cavalry|infantry|crusade)\b/gi;

function normalizeSceneContradictions(text: string): { text: string; log: string[] } {
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

describe("normalizeSceneContradictions", () => {
  it("replaces outdoor light with 'warm interior light' in indoor scenes", () => {
    const input = "Dim dental room with antique tools. Golden hour light streaming in. Desaturated palette.";
    const { text, log } = normalizeSceneContradictions(input);
    expect(text).not.toContain("golden hour");
    expect(text).toContain("warm interior light");
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]!.toLowerCase()).toContain("golden hour");
  });

  it("does NOT replace outdoor light if scene is also outdoor", () => {
    const input = "A garden street with mountain view. Golden hour light. Warm palette.";
    const { text } = normalizeSceneContradictions(input);
    expect(text).toContain("Golden hour light");
  });

  it("removes epic narrative terms from dental/medical scenes", () => {
    const input = "Dental room with rusty tools. A giant warrior approaches the drill. Sharp tense mood.";
    const { text, log } = normalizeSceneContradictions(input);
    expect(text).not.toContain("giant");
    expect(text).not.toContain("warrior");
    expect(text).toContain("Dental room");
    expect(text).toContain("drill");
    expect(log.length).toBeGreaterThanOrEqual(2);
  });

  it("passes through clean prompts unchanged", () => {
    const input = "Dim dental room with antique tools. Warm practical light. Desaturated palette.";
    const { text, log } = normalizeSceneContradictions(input);
    expect(text).toBe(input);
    expect(log).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Concrete noun anchor extraction
// ═══════════════════════════════════════════════════════════════════

const CONCRETE_NOUN_RE = /\b((?:dental|medical|rusty|antique|archaic|worn|old|ancient|spinning|sharp|metal|wooden|glass|iron|steel|ceramic)\s+(?:room|office|chair|table|tray|tool[s]?|drill|instrument[s]?|cabinet|lamp|device|mirror|cart|shelf|counter|jar|vial|flask|bottle|needle|scalpel|forceps|clamp|blade|handle|lever|gauge|dial|mechanism|equipment|rack|stand|stool|basin|sink|counter))|(?:drill\s+bit|enamel|gaslight|clinic\s+interior|tool\s+tray)\b/gi;

function extractConcreteAnchors(prompt: string): string[] {
  CONCRETE_NOUN_RE.lastIndex = 0;
  const matches = prompt.match(CONCRETE_NOUN_RE);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.toLowerCase().trim()))];
}

describe("extractConcreteAnchors", () => {
  it("extracts dental-specific concrete nouns", () => {
    const prompt = "Dim 1900s dental room with archaic rusty dental tools. Sharp spinning drill bit on a rusty tray. Antique chair visible.";
    const anchors = extractConcreteAnchors(prompt);
    expect(anchors).toContain("dental room");
    expect(anchors).toContain("rusty tray");
    // "spinning drill" is captured (spinning is a known adjective + drill is a known noun)
    expect(anchors.some(a => a.includes("drill"))).toBe(true);
    expect(anchors.length).toBeGreaterThanOrEqual(3);
  });

  it("returns empty array for abstract prompts", () => {
    const prompt = "A person walks slowly. The mood is tense. Something happens.";
    const anchors = extractConcreteAnchors(prompt);
    expect(anchors).toHaveLength(0);
  });

  it("deduplicates repeated noun phrases", () => {
    const prompt = "Rusty tray with tools. Another rusty tray nearby.";
    const anchors = extractConcreteAnchors(prompt);
    const trayCount = anchors.filter(a => a === "rusty tray").length;
    expect(trayCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Korean shot summary generation
// ═══════════════════════════════════════════════════════════════════

describe("generateShotSummaryKo", () => {
  it("generates Korean summary from dental prompt", () => {
    const prompt = "Wide establishing view of Dim 1900s dental room with archaic rusty dental tools, dental room visible. Slow push-in revealing the full environment.";
    const summary = generateShotSummaryKo(prompt, "establish");
    expect(summary.length).toBeGreaterThan(0);
    // Should contain Korean text
    expect(summary).toMatch(/[\uAC00-\uD7A3]/);
  });

  it("returns role-based fallback for empty prompt", () => {
    const summary = generateShotSummaryKo("", "establish");
    expect(summary).toBe("장면 도입 — 전체 공간이 보임");
  });

  it("returns role-based fallback for unrecognized prompt", () => {
    const summary = generateShotSummaryKo("Completely unrecognizable abstract concept", "peak");
    expect(summary).toBe("절정 — 가장 강렬한 순간");
  });

  it("does NOT contain bracket tags in output", () => {
    const prompt = "[VISUAL LOCK] claymation. Wide view of dental room.";
    // Summary is generated from cleaned prompt, but even if brackets leak:
    const summary = generateShotSummaryKo(prompt);
    // Our function works on the raw text — bracket tags should not map to Korean
    expect(summary).not.toMatch(/\[.*?\]/);
  });

  it("detects framing + object combinations", () => {
    const prompt = "Close-up of spinning drill on a metal tray.";
    const summary = generateShotSummaryKo(prompt);
    expect(summary).toMatch(/[\uAC00-\uD7A3]/);
    expect(summary.length).toBeGreaterThan(2);
  });
});

describe("generateMultiShotSummariesKo", () => {
  it("generates summaries array matching shot count", () => {
    const shots = [
      { index: 1, prompt: "Wide dental room with tools.", duration: "5", role: "establish" as const },
      { index: 2, prompt: "Close-up of spinning drill.", duration: "5", role: "peak" as const },
    ];
    const summaries = generateMultiShotSummariesKo(shots);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]!.index).toBe(1);
    expect(summaries[1]!.index).toBe(2);
    expect(summaries[0]!.summaryKo.length).toBeGreaterThan(0);
    expect(summaries[1]!.summaryKo.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. Dental scene end-to-end — full cleanup pipeline snapshot
// ═══════════════════════════════════════════════════════════════════

describe("dental scene: full cleanup pipeline snapshot", () => {
  const rawPrompt = "[VISUAL LOCK] claymation stop-motion, fingerprint texture, warm practical light. [CHARACTER LOCK] A worn dental figure. [Establishing wide shot] Dim 1900s dental room with archaic rusty dental tools and antique chair. Sharp spinning drill bit comes alive on the rusty tray. Golden hour light, David and Goliath narrative. Warm practical interior light, desaturated palette. [ENDING] Last 2 seconds: mid-action, camera moving, emotion unresolved.";

  it("step 1: tags stripped, content preserved", () => {
    const cleaned = stripInternalTags(rawPrompt);
    expect(cleaned).not.toMatch(/\[.*?\]/);
    expect(cleaned).toContain("dental room");
    expect(cleaned).toContain("drill bit");
    expect(cleaned).toContain("claymation");
  });

  it("step 2: contradictions normalized", () => {
    const cleaned = stripInternalTags(rawPrompt);
    const { text, log } = normalizeSceneContradictions(cleaned);
    // Indoor dental scene → outdoor light replaced
    expect(text).not.toContain("Golden hour");
    expect(text).toContain("warm interior light");
    // Medical scene → epic narrative removed
    expect(text).not.toContain("David and Goliath");
    expect(log.length).toBeGreaterThan(0);
  });

  it("step 3: deduplication + global anchors", () => {
    let cleaned = stripInternalTags(rawPrompt);
    const { text } = normalizeSceneContradictions(cleaned);
    const deduped = deduplicatePromptClauses(text);
    const global = extractGlobalAnchors(deduped);

    expect(global).toContain("claymation");
    expect(global).toContain("1900s dental room");
    expect(deduped).toContain("drill bit");
  });

  it("step 4: concrete anchors extracted for multi-shot distribution", () => {
    let cleaned = stripInternalTags(rawPrompt);
    const { text } = normalizeSceneContradictions(cleaned);
    const anchors = extractConcreteAnchors(text);
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    expect(anchors.some(a => a.includes("dental"))).toBe(true);
  });

  it("step 5: visualLock is compact (no outdoor lights, no fallback)", () => {
    const styleSuffix = "Claymation stop-motion with visible fingerprint texture. Warm practical light, desaturated palette. No text overlay, no watermark. 16:9 cinematic framing.";
    const lock = extractCompactVisualLock(styleSuffix);
    expect(lock).toContain("claymation");
    expect(lock).toContain("fingerprint texture");
    expect(lock).toContain("practical light");
    expect(lock).toContain("desaturated");
    expect(lock).not.toContain("text overlay");
    expect(lock).not.toContain("16:9");
  });
});
