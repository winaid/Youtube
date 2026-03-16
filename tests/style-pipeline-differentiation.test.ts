/**
 * style-pipeline-differentiation.test.ts — Tests proving style presets
 * produce materially different outputs across the pipeline.
 *
 * Tests:
 * 1. Different style presets produce different positive prompts
 * 2. Different style presets produce different negative constraints
 * 3. Style negatives appear in SingleShotDocument.negatives.style
 * 4. Non-realistic styles include anti-photorealism negatives
 * 5. Camera motion flavor varies by style
 * 6. Same base topic produces different serialized outputs per style
 * 7. Style catalog negatives flow through to buildNegativePrompt
 */

import { describe, test, expect } from "vitest";
import { buildShotDocument } from "@/lib/sequence-assembler";
import { buildNegativePrompt } from "@/lib/prompt-architecture";
import { getStyleById, getAllStyles } from "@/data/style-catalog";
import { STYLE_PRESETS } from "@/lib/style-system";
import type { Cut, VideoGenerationConfig } from "@/types";
import { DEFAULT_VIDEO_CONFIG } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Fixtures — same base content, different styles
// ═══════════════════════════════════════════════════════════════════

function makeCut(overrides: Partial<Cut> = {}): Cut {
  return {
    cutNumber: 1,
    durationSec: 8,
    sceneDescription: "A warrior stands on a cliff edge at sunset",
    cameraDirection: "slow push-in",
    moodLighting: "golden hour",
    imagePrompt: "warrior on cliff",
    endImagePrompt: "",
    videoPrompt: "Wide shot of a lone warrior on a cliff edge",
    extendPrompt: "",
    transitionHint: "fade",
    characterConsistency: "young warrior in leather armor",
    charactersInScene: ["warrior"],
    shotCategory: "character-driven",
    videoPromptJson: {
      shotSize: "WS",
      cameraAngle: "low-angle",
      cameraMovement: "slow push-in",
      subjectBlocking: "center-frame",
      subjectAction: "warrior standing gazing at horizon",
      actionBeat: "",
      bodySignal: "",
      revealed: "",
      withheld: "",
      timingBeat: "",
      transitionFromPrev: "",
      characterRef: "young warrior, leather armor",
      moodLighting: "golden hour, dramatic shadows",
      styleSuffix: "",
    },
    ...overrides,
  };
}

function makeConfig(animationMode: string): VideoGenerationConfig {
  return { ...DEFAULT_VIDEO_CONFIG, durationSeconds: 8, animationMode };
}

// ═══════════════════════════════════════════════════════════════════
// 1. Style presets produce different positive prompts
// ═══════════════════════════════════════════════════════════════════

describe("Style positive prompt differentiation", () => {
  const styleIds = ["cinematic-realism", "tv-anime", "pixar-style", "ink-wash", "pixel-art"];

  test("each style has a unique positivePrompt", () => {
    const prompts = new Set<string>();
    for (const id of styleIds) {
      const entry = getStyleById(id);
      expect(entry).toBeDefined();
      expect(entry!.positivePrompt.length).toBeGreaterThan(20);
      prompts.add(entry!.positivePrompt);
    }
    // All should be unique
    expect(prompts.size).toBe(styleIds.length);
  });

  test("style presets have different globalStyleBlock", () => {
    const blocks = new Set<string>();
    for (const id of styleIds) {
      const preset = STYLE_PRESETS[id];
      if (preset) {
        blocks.add(preset.globalStyleBlock);
      }
    }
    expect(blocks.size).toBeGreaterThanOrEqual(styleIds.length - 1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Style negatives are different per preset
// ═══════════════════════════════════════════════════════════════════

describe("Style negative constraint differentiation", () => {
  test("cinematic-realism has anime in negatives", () => {
    const entry = getStyleById("cinematic-realism");
    expect(entry).toBeDefined();
    expect(entry!.negativePrompt.toLowerCase()).toContain("anime");
  });

  test("tv-anime has realistic/3d in negatives", () => {
    const entry = getStyleById("tv-anime");
    expect(entry).toBeDefined();
    const neg = entry!.negativePrompt.toLowerCase();
    expect(neg).toMatch(/realistic|3d rendering|real photography/);
  });

  test("pixel-art has realistic in negatives", () => {
    const entry = getStyleById("pixel-art");
    expect(entry).toBeDefined();
    const neg = entry!.negativePrompt.toLowerCase();
    expect(neg).toMatch(/realistic|smooth|3d/);
  });

  test("different styles produce different negative sets", () => {
    const ids = ["cinematic-realism", "tv-anime", "ink-wash", "claymation"];
    const negSets = ids.map(id => {
      const entry = getStyleById(id);
      return entry?.negativePrompt ?? "";
    });

    // Each pair should be different
    for (let i = 0; i < negSets.length; i++) {
      for (let j = i + 1; j < negSets.length; j++) {
        expect(negSets[i]).not.toBe(negSets[j]);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Style negatives flow into SingleShotDocument
// ═══════════════════════════════════════════════════════════════════

describe("Style negatives in SingleShotDocument", () => {
  test("buildShotDocument includes style negatives for tv-anime", () => {
    const cut = makeCut();
    const config = makeConfig("tv-anime");
    const doc = buildShotDocument({ cut, config });

    expect(doc.negatives.style).toBeDefined();
    expect(doc.negatives.style.length).toBeGreaterThan(0);
    // Should contain anti-live-action terms
    const joined = doc.negatives.style.join(", ").toLowerCase();
    expect(joined).toMatch(/photorealistic|live.action|realistic/);
  });

  test("buildShotDocument includes style negatives for cinematic-realism", () => {
    const cut = makeCut();
    const config = makeConfig("cinematic-realism");
    const doc = buildShotDocument({ cut, config });

    expect(doc.negatives.style).toBeDefined();
    expect(doc.negatives.style.length).toBeGreaterThan(0);
    // Should contain anti-anime/cartoon terms
    const joined = doc.negatives.style.join(", ").toLowerCase();
    expect(joined).toMatch(/cartoon|anime|illustration/);
  });

  test("style negatives are different between styles for same content", () => {
    const cut = makeCut();
    const animeDoc = buildShotDocument({ cut, config: makeConfig("tv-anime") });
    const realisticDoc = buildShotDocument({ cut, config: makeConfig("cinematic-realism") });

    const animeNegs = animeDoc.negatives.style.sort().join("|");
    const realisticNegs = realisticDoc.negatives.style.sort().join("|");

    expect(animeNegs).not.toBe(realisticNegs);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Non-realistic presets include anti-photo negatives
// ═══════════════════════════════════════════════════════════════════

describe("Non-realistic style anti-photorealism", () => {
  test("anime preset is non-realistic", () => {
    const preset = STYLE_PRESETS["tv-anime"];
    expect(preset).toBeDefined();
    expect(preset.isNonRealistic).toBe(true);
  });

  test("cinematic-realism is realistic", () => {
    const preset = STYLE_PRESETS["cinematic-realism"];
    expect(preset).toBeDefined();
    expect(preset.isNonRealistic).toBe(false);
  });

  test("pixel-art is non-realistic", () => {
    const preset = STYLE_PRESETS["pixel-art"];
    expect(preset).toBeDefined();
    expect(preset.isNonRealistic).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Style positive appears in serialized output
// ═══════════════════════════════════════════════════════════════════

describe("Style positive in SingleShotDocument", () => {
  test("global.style reflects the selected style positivePrompt", () => {
    const cut = makeCut();
    const animeDoc = buildShotDocument({ cut, config: makeConfig("tv-anime") });
    const realisticDoc = buildShotDocument({ cut, config: makeConfig("cinematic-realism") });

    // global.style should contain the style's positive prompt
    expect(animeDoc.global.style).not.toBe(realisticDoc.global.style);
    expect(animeDoc.global.style.length).toBeGreaterThan(20);
    expect(realisticDoc.global.style.length).toBeGreaterThan(20);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. buildNegativePrompt includes style negatives
// ═══════════════════════════════════════════════════════════════════

describe("buildNegativePrompt with style injection", () => {
  test("includes style-specific negatives for tv-anime", () => {
    const result = buildNegativePrompt({
      scenePrompt: "warrior on cliff",
      animationMode: "tv-anime",
      styleIntensity: 100,
      durationSec: 8,
    });

    expect(result).toContain("Avoid:");
    expect(result.toLowerCase()).toMatch(/photorealistic|live.action|realistic/);
  });

  test("includes style-specific negatives for cinematic-realism", () => {
    const result = buildNegativePrompt({
      scenePrompt: "warrior on cliff",
      animationMode: "cinematic-realism",
      styleIntensity: 100,
      durationSec: 8,
    });

    expect(result).toContain("Avoid:");
    expect(result.toLowerCase()).toMatch(/cartoon|anime|illustration/);
  });

  test("different styles produce different negative strings", () => {
    const base = { scenePrompt: "warrior on cliff", styleIntensity: 100, durationSec: 8 };
    const animeNeg = buildNegativePrompt({ ...base, animationMode: "tv-anime" });
    const realisticNeg = buildNegativePrompt({ ...base, animationMode: "cinematic-realism" });
    const pixelNeg = buildNegativePrompt({ ...base, animationMode: "pixel-art" });

    expect(animeNeg).not.toBe(realisticNeg);
    expect(realisticNeg).not.toBe(pixelNeg);
    expect(animeNeg).not.toBe(pixelNeg);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. All catalog styles have non-empty negativePrompt
// ═══════════════════════════════════════════════════════════════════

describe("Style catalog completeness", () => {
  test("all styles have negativePrompt defined", () => {
    const allStyles = getAllStyles();
    expect(allStyles.length).toBeGreaterThan(10);

    for (const style of allStyles) {
      expect(style.negativePrompt, `${style.id} missing negativePrompt`).toBeDefined();
      expect(style.negativePrompt.length, `${style.id} has empty negativePrompt`).toBeGreaterThan(5);
    }
  });

  test("all styles have positivePrompt defined", () => {
    const allStyles = getAllStyles();
    for (const style of allStyles) {
      expect(style.positivePrompt, `${style.id} missing positivePrompt`).toBeDefined();
      expect(style.positivePrompt.length, `${style.id} has empty positivePrompt`).toBeGreaterThan(20);
    }
  });
});
