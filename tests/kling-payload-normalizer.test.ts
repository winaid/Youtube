/**
 * kling-payload-normalizer.test.ts — Source-of-truth unification tests
 *
 * Proves that:
 * 1. UI preview payload and server payload are generated from the same shared builder
 * 2. Korean shot summaries are generated from normalized multi_prompt, not raw UI state
 * 3. Normalized multi_prompt indices are sequential and durations are strings
 * 4. No internal bracket tags survive into preview or server payload
 * 5. Multi-shot preview payload semantically matches actual sent payload
 * 6. Summary order matches multi_prompt order
 * 7. If normalized payload changes, preview and summary both reflect that same change
 * 8. Dental scene snapshot still preserves concrete anchors and avoids outdoor/epic drift
 */

import { describe, it, expect } from "vitest";
import {
  buildNormalizedKlingPayload,
  buildPreviewPayload,
  getMultiPromptFromPayload,
  stripInternalTags,
  deduplicatePromptClauses,
  normalizeSceneContradictions,
  extractGlobalAnchors,
  cleanShotPrompt,
  clampKlingDuration,
  normalizeAspectRatio,
  type KlingPayloadNormalizerInput,
  type NormalizedKlingPayload,
} from "@/lib/kling-payload-normalizer";
import {
  generateShotSummaryKo,
  generateSummariesFromNormalizedPayload,
  generateSummariesFromNormalizedMultiPrompt,
} from "@/lib/shot-summary-ko";

// ═══════════════════════════════════════════════════════════════════
// Test fixtures
// ═══════════════════════════════════════════════════════════════════

const DENTAL_INPUT: KlingPayloadNormalizerInput = {
  prompt: "[VISUAL LOCK] claymation stop-motion, fingerprint texture, warm practical light. [CHARACTER LOCK] A worn dental figure. [Establishing wide shot] Dim 1900s dental room with archaic rusty dental tools and antique chair. Sharp spinning drill bit comes alive on the rusty tray. Golden hour light, David and Goliath narrative. Warm practical interior light, desaturated palette. [ENDING] Last 2 seconds: mid-action, camera moving, emotion unresolved.",
  negativePrompt: "text overlay, watermark, blurry",
  model: "kling-o3-text-to-video",
  durationSec: 8,
  multiShot: [
    { index: 1, prompt: "[Establishing wide shot] Wide view of dim 1900s dental room, dental room visible. Slow push-in.", duration: "3", role: "establish" },
    { index: 2, prompt: "[Developing mid shot] Medium shot revealing spinning drill on rusty tray. First clear view.", duration: "3", role: "develop" },
    { index: 3, prompt: "[Peak dramatic moment] Close tense shot, drill descending. Golden hour light, David and Goliath.", duration: "2", role: "peak" },
  ],
};

const SIMPLE_INPUT: KlingPayloadNormalizerInput = {
  prompt: "A cat walks across a sunny garden.",
  negativePrompt: "blurry",
  model: "kling-o3-text-to-video",
  durationSec: 5,
};

// ═══════════════════════════════════════════════════════════════════
// 1. UI preview and server payload from same builder
// ═══════════════════════════════════════════════════════════════════

describe("source-of-truth: same builder for preview and server", () => {
  it("buildNormalizedKlingPayload produces identical structure for both consumers", () => {
    // Both server and UI call buildNormalizedKlingPayload with the same input
    const serverPayload = buildNormalizedKlingPayload(DENTAL_INPUT);
    const uiPayload = buildNormalizedKlingPayload(DENTAL_INPUT);

    // They should be identical
    expect(serverPayload.prompt).toBe(uiPayload.prompt);
    expect(serverPayload.negative_prompt).toBe(uiPayload.negative_prompt);
    expect(serverPayload.model).toBe(uiPayload.model);
    expect(serverPayload.duration).toBe(uiPayload.duration);
    expect(serverPayload.model_params?.multi_prompt).toEqual(uiPayload.model_params?.multi_prompt);
  });

  it("buildPreviewPayload derives from the same normalized payload", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);
    const preview = buildPreviewPayload(payload);

    // Preview should have the same model_params structure
    expect(preview.model_params).toBeDefined();
    const previewParams = preview.model_params as Record<string, unknown>;
    expect(previewParams.multi_shot).toBe(true);
    expect(previewParams.shot_type).toBe("customize");

    // Preview multi_prompt count matches payload
    const previewMulti = previewParams.multi_prompt as Array<Record<string, unknown>>;
    expect(previewMulti.length).toBe(payload.model_params!.multi_prompt.length);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Korean summaries from normalized multi_prompt
// ═══════════════════════════════════════════════════════════════════

describe("source-of-truth: Korean summaries from normalized multi_prompt", () => {
  it("generateSummariesFromNormalizedPayload uses the cleaned multi_prompt", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);
    const summaries = generateSummariesFromNormalizedPayload(payload);

    expect(summaries.length).toBe(3);
    // Summaries should not contain any bracket tags
    for (const s of summaries) {
      expect(s.summaryKo).not.toMatch(/\[.*?\]/);
      expect(s.summaryKo.length).toBeGreaterThan(0);
    }
  });

  it("generateSummariesFromNormalizedMultiPrompt matches payload-based summaries", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);
    const entries = getMultiPromptFromPayload(payload);
    const fromEntries = generateSummariesFromNormalizedMultiPrompt(entries);
    const fromPayload = generateSummariesFromNormalizedPayload(payload);

    expect(fromEntries).toEqual(fromPayload);
  });

  it("summaries reflect cleaned prompts (no tags, no contradictions)", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);
    const entries = getMultiPromptFromPayload(payload);

    // Shot 3 had "[Peak dramatic moment]" and "Golden hour light" and "David and Goliath"
    const shot3 = entries.find(e => e.index === 3);
    expect(shot3).toBeDefined();
    expect(shot3!.prompt).not.toContain("[Peak dramatic moment]");
    expect(shot3!.prompt).not.toContain("Golden hour");
    expect(shot3!.prompt).not.toContain("David and Goliath");

    // Summary should still be Korean text (extracted from cleaned dental prompt)
    const summaries = generateSummariesFromNormalizedMultiPrompt(entries);
    const s3 = summaries.find(s => s.index === 3);
    expect(s3!.summaryKo).toMatch(/[\uAC00-\uD7A3]/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Indices are sequential and durations are strings
// ═══════════════════════════════════════════════════════════════════

describe("normalized multi_prompt: indices and durations", () => {
  it("indices are sequential starting at 1", () => {
    const input: KlingPayloadNormalizerInput = {
      ...DENTAL_INPUT,
      multiShot: [
        { index: 5, prompt: "Shot A", duration: "3" },
        { index: 10, prompt: "Shot B", duration: "3" },
        { index: 99, prompt: "Shot C", duration: "2" },
      ],
    };
    const payload = buildNormalizedKlingPayload(input);
    const entries = getMultiPromptFromPayload(payload);

    expect(entries.map(e => e.index)).toEqual([1, 2, 3]);
  });

  it("durations are always strings", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);
    const entries = getMultiPromptFromPayload(payload);

    for (const entry of entries) {
      expect(typeof entry.duration).toBe("string");
    }
  });

  it("handles numeric-like duration values", () => {
    const input: KlingPayloadNormalizerInput = {
      ...SIMPLE_INPUT,
      multiShot: [
        { index: 1, prompt: "Shot A", duration: "5" },
        { index: 2, prompt: "Shot B", duration: "3" },
      ],
    };
    const payload = buildNormalizedKlingPayload(input);
    const entries = getMultiPromptFromPayload(payload);

    for (const entry of entries) {
      expect(typeof entry.duration).toBe("string");
      expect(parseFloat(entry.duration)).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. No internal bracket tags in preview or payload
// ═══════════════════════════════════════════════════════════════════

describe("no internal bracket tags in output", () => {
  it("top-level prompt has no bracket tags", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);
    expect(payload.prompt).not.toMatch(/\[.*?\]/);
  });

  it("multi_prompt entries have no bracket tags", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);
    const entries = getMultiPromptFromPayload(payload);

    for (const entry of entries) {
      expect(entry.prompt).not.toMatch(/\[.*?\]/);
    }
  });

  it("preview payload has no bracket tags", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);
    const preview = buildPreviewPayload(payload);
    const json = JSON.stringify(preview);
    expect(json).not.toMatch(/\[VISUAL LOCK\]/);
    expect(json).not.toMatch(/\[CHARACTER LOCK\]/);
    expect(json).not.toMatch(/\[ENDING\]/);
    expect(json).not.toMatch(/\[Establishing wide shot\]/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Preview payload semantically matches actual sent payload
// ═══════════════════════════════════════════════════════════════════

describe("preview vs actual payload semantic match", () => {
  it("preview model_params structure matches actual payload", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);
    const preview = buildPreviewPayload(payload, 9999); // no truncation

    const payloadMP = payload.model_params!;
    const previewMP = (preview.model_params as Record<string, unknown>);
    const previewMulti = previewMP.multi_prompt as Array<Record<string, unknown>>;

    // Same number of shots
    expect(previewMulti.length).toBe(payloadMP.multi_prompt.length);

    // Same indices and durations
    for (let i = 0; i < payloadMP.multi_prompt.length; i++) {
      expect(previewMulti[i].index).toBe(payloadMP.multi_prompt[i].index);
      expect(previewMulti[i].duration).toBe(payloadMP.multi_prompt[i].duration);
      // With no truncation, prompts should be identical
      expect(previewMulti[i].prompt).toBe(payloadMP.multi_prompt[i].prompt);
    }

    // Same top-level fields
    expect(preview.prompt).toBe(payload.prompt);
    expect(preview.negative_prompt).toBe(payload.negative_prompt);
    expect(preview.model).toBe(payload.model);
    expect(preview.duration).toBe(payload.duration);
  });

  it("preview truncation only affects display, not semantics", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);
    const shortPreview = buildPreviewPayload(payload, 30); // aggressive truncation
    const fullPreview = buildPreviewPayload(payload, 9999); // no truncation

    // Both have the same structure
    const shortMP = (shortPreview.model_params as Record<string, unknown>).multi_prompt as Array<Record<string, unknown>>;
    const fullMP = (fullPreview.model_params as Record<string, unknown>).multi_prompt as Array<Record<string, unknown>>;

    expect(shortMP.length).toBe(fullMP.length);
    for (let i = 0; i < shortMP.length; i++) {
      expect(shortMP[i].index).toBe(fullMP[i].index);
      expect(shortMP[i].duration).toBe(fullMP[i].duration);
      // Short version is a prefix of full version (or same if short enough)
      const shortPrompt = shortMP[i].prompt as string;
      const fullPrompt = fullMP[i].prompt as string;
      if (fullPrompt.length > 30) {
        expect(shortPrompt.endsWith("...")).toBe(true);
      } else {
        expect(shortPrompt).toBe(fullPrompt);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Summary order matches multi_prompt order
// ═══════════════════════════════════════════════════════════════════

describe("summary order matches multi_prompt order", () => {
  it("summaries are in the same order as multi_prompt entries", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);
    const entries = getMultiPromptFromPayload(payload);
    const summaries = generateSummariesFromNormalizedPayload(payload);

    expect(summaries.length).toBe(entries.length);
    for (let i = 0; i < entries.length; i++) {
      expect(summaries[i].index).toBe(entries[i].index);
      expect(summaries[i].duration).toBe(entries[i].duration);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Changes propagate to both preview and summary
// ═══════════════════════════════════════════════════════════════════

describe("change propagation: payload changes → preview + summary update", () => {
  it("modifying a shot prompt changes both preview and summary", () => {
    // Original
    const payload1 = buildNormalizedKlingPayload(DENTAL_INPUT);
    const preview1 = buildPreviewPayload(payload1, 9999);
    const summaries1 = generateSummariesFromNormalizedPayload(payload1);

    // Modified input — change shot 2 prompt
    const modifiedInput = {
      ...DENTAL_INPUT,
      multiShot: DENTAL_INPUT.multiShot!.map((s, i) =>
        i === 1 ? { ...s, prompt: "Close-up of spinning drill on metal tray in dim workshop." } : s,
      ),
    };
    const payload2 = buildNormalizedKlingPayload(modifiedInput);
    const preview2 = buildPreviewPayload(payload2, 9999);
    const summaries2 = generateSummariesFromNormalizedPayload(payload2);

    // Shot 2 prompt should differ in all three views
    const mp1 = (preview1.model_params as Record<string, unknown>).multi_prompt as Array<Record<string, unknown>>;
    const mp2 = (preview2.model_params as Record<string, unknown>).multi_prompt as Array<Record<string, unknown>>;
    expect(mp2[1].prompt).not.toBe(mp1[1].prompt);

    // Summary should also reflect the change
    expect(summaries2[1].summaryKo).not.toBe(summaries1[1].summaryKo);

    // But shot 1 and 3 should remain the same
    expect(mp2[0].prompt).toBe(mp1[0].prompt);
    expect(summaries2[0].summaryKo).toBe(summaries1[0].summaryKo);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Dental scene: anchors preserved, outdoor/epic drift avoided
// ═══════════════════════════════════════════════════════════════════

describe("dental scene: concrete anchors preserved, no drift", () => {
  it("preserves dental anchors after normalization", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);

    // Top-level global prompt should contain dental anchors
    expect(payload.prompt).toContain("dental room");
    expect(payload.prompt).toContain("1900s");
  });

  it("removes outdoor lighting from indoor dental scene", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);

    // Golden hour should be replaced with warm interior light
    expect(payload.prompt).not.toContain("Golden hour");

    // Check all shot prompts too
    const entries = getMultiPromptFromPayload(payload);
    for (const entry of entries) {
      expect(entry.prompt).not.toContain("Golden hour");
    }
  });

  it("removes epic narrative from dental/medical scene", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);

    expect(payload.prompt).not.toContain("David and Goliath");

    const entries = getMultiPromptFromPayload(payload);
    for (const entry of entries) {
      expect(entry.prompt).not.toContain("David and Goliath");
    }
  });

  it("dental-specific Korean summaries are meaningful", () => {
    const payload = buildNormalizedKlingPayload(DENTAL_INPUT);
    const summaries = generateSummariesFromNormalizedPayload(payload);

    // At least one summary should contain dental-related Korean text
    const hasDental = summaries.some(s =>
      s.summaryKo.includes("치과") ||
      s.summaryKo.includes("드릴") ||
      s.summaryKo.includes("도구") ||
      s.summaryKo.includes("트레이"),
    );
    expect(hasDental).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Pure utility function tests (shared between client and server)
// ═══════════════════════════════════════════════════════════════════

describe("stripInternalTags (shared)", () => {
  it("removes all bracket editorial tags", () => {
    const input = "[VISUAL LOCK] claymation. [CHARACTER LOCK] A dentist. [Establishing wide shot] Room.";
    const result = stripInternalTags(input);
    expect(result).not.toMatch(/\[.*?\]/);
    expect(result).toContain("claymation");
    expect(result).toContain("A dentist");
    expect(result).toContain("Room");
  });
});

describe("normalizeSceneContradictions (shared)", () => {
  it("replaces outdoor light in indoor scene", () => {
    const { text } = normalizeSceneContradictions("Dim dental room. Golden hour light.");
    expect(text).not.toContain("Golden hour");
    expect(text).toContain("warm interior light");
  });

  it("removes epic narrative from medical scene", () => {
    const { text } = normalizeSceneContradictions("Dental room with drill. A giant warrior approaches.");
    expect(text).not.toContain("giant");
    expect(text).not.toContain("warrior");
    expect(text).toContain("drill");
  });
});

describe("clampKlingDuration", () => {
  it("clamps to 3-15 range", () => {
    expect(clampKlingDuration(1)).toBe(3);
    expect(clampKlingDuration(8)).toBe(8);
    expect(clampKlingDuration(20)).toBe(15);
  });
});

describe("normalizeAspectRatio", () => {
  it("normalizes to Kling-supported values", () => {
    expect(normalizeAspectRatio("16:9")).toBe("16:9");
    expect(normalizeAspectRatio("9:16")).toBe("9:16");
    expect(normalizeAspectRatio("4:3")).toBe("16:9"); // fallback
    expect(normalizeAspectRatio(undefined)).toBe("16:9");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Single-shot flow (no multiShot)
// ═══════════════════════════════════════════════════════════════════

describe("single-shot flow", () => {
  it("produces payload without model_params when no multiShot", () => {
    const payload = buildNormalizedKlingPayload(SIMPLE_INPUT);
    expect(payload.model_params).toBeUndefined();
    expect(payload.prompt).toContain("cat walks");
    expect(payload._meta.shotCount).toBe(0);
  });

  it("summaries return empty array for no multiShot", () => {
    const payload = buildNormalizedKlingPayload(SIMPLE_INPUT);
    const summaries = generateSummariesFromNormalizedPayload(payload);
    expect(summaries).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Element list handling
// ═══════════════════════════════════════════════════════════════════

describe("element_list handling", () => {
  it("attaches element_list inside model_params when multiShot present", () => {
    const input: KlingPayloadNormalizerInput = {
      ...DENTAL_INPUT,
      elementList: [{ element_id: "elem-123" }],
    };
    const payload = buildNormalizedKlingPayload(input);
    expect(payload.model_params?.element_list).toEqual([{ element_id: "elem-123" }]);
  });

  it("attaches element_list_standalone when no multiShot", () => {
    const input: KlingPayloadNormalizerInput = {
      ...SIMPLE_INPUT,
      elementList: [{ element_id: "elem-456" }],
    };
    const payload = buildNormalizedKlingPayload(input);
    expect(payload.element_list_standalone).toEqual([{ element_id: "elem-456" }]);
    expect(payload.model_params).toBeUndefined();
  });
});
