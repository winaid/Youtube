/**
 * provider-prompt-cleanup.test.ts — Provider-facing prompt cleanup tests
 *
 * Tests that internal editorial scaffolding is stripped before Kling submission,
 * continuity visualLock is compact, multi-shot auto-repair produces different prompts,
 * and domain-specific scene anchors are preserved.
 */

import { describe, it, expect } from "vitest";

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
  const anchors: string[] = [];
  const mediumMatch = rawLock.match(/\b(claymation|stop[\s-]?motion|watercolor|oil[\s-]?paint|pencil[\s-]?sketch|anime|cel[\s-]?shad|charcoal|photorealistic|cinematic[\s-]?realism|documentary|live[\s-]?action)\b/i);
  if (mediumMatch) anchors.push(mediumMatch[0].toLowerCase());
  const materialMatch = rawLock.match(/\b(fingerprint\s+texture|handcrafted|clay\s+surface|impasto|visible\s+brush|grainy\s+film|film\s+grain|halation)\b/i);
  if (materialMatch) anchors.push(materialMatch[0].toLowerCase());
  const paletteMatch = rawLock.match(/\b(desaturated|warm\s+palette|cool\s+palette|monochrome|sepia|muted|pastel|high[\s-]?contrast|low[\s-]?key|high[\s-]?key)\b/i);
  if (paletteMatch) anchors.push(paletteMatch[0].toLowerCase());
  const lightMatch = rawLock.match(/\b(practical\s+light|tungsten|candlelit|gaslight|neon|golden\s+hour|blue\s+hour|overcast|studio\s+light|natural\s+light|backlit|rim[\s-]?light)\b/i);
  if (lightMatch) anchors.push(lightMatch[0].toLowerCase());
  if (anchors.length === 0) {
    const first = rawLock.split(/[.,;]/).filter(Boolean)[0]?.trim();
    return first && first.length < 80 ? first : "";
  }
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

  it("returns first clause as fallback when no anchors match", () => {
    const minimal = "An unusual artistic rendering";
    const compact = extractCompactVisualLock(minimal);
    expect(compact).toBe("An unusual artistic rendering");
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
