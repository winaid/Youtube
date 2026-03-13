/**
 * metadata-preservation.test.ts — Import/Export Roundtrip 메타데이터 보존 테스트
 *
 * 테스트 대상:
 * 1. Import 시 원본 Cut 메타 보존
 * 2. Export 시 수정된 videoPrompt/durationSec 사용
 * 3. cameraDirection 복원
 * 4. moodLighting 복원
 * 5. characterSeeds 복원
 * 6. continuityRules 복원
 * 7. shots (multiShot) 복원
 * 8. 보존 메타 없을 때 fallback
 * 9. 전체 roundtrip 보존 확장 테스트
 */

import { describe, it, expect } from "vitest";
import { promptOutputToCanvasState, cutToNodes } from "@/lib/sequence-to-nodes";
import {
  exportAllChainsToPromptOutput,
  exportFromSelectedNode,
  findAllChains,
  mergeSelectedChainsToOutput,
  mergeAllChainsToOutput,
} from "@/lib/nodes-to-sequence";
import {
  createInitialCanvasState,
  createNode,
  addNode,
  addEdge,
  updateNodeData,
  NODE_REGISTRY,
  type CanvasState,
  type PreservedCutData,
  type PreservedOutputMeta,
} from "@/lib/node-types";
import type { Cut, PromptOutput, CharacterSeed } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function findDef(type: string) {
  return NODE_REGISTRY.find(d => d.type === type)!;
}

function makeCut(cutNumber: number, overrides?: Partial<Cut>): Cut {
  return {
    cutNumber,
    durationSec: 6,
    sceneDescription: `Scene ${cutNumber} description`,
    cameraDirection: "wide establishing shot",
    moodLighting: "warm golden hour",
    imagePrompt: `Image for cut ${cutNumber}`,
    endImagePrompt: `End image for cut ${cutNumber}`,
    videoPrompt: `Video prompt for cut ${cutNumber}`,
    extendPrompt: `Extend prompt for cut ${cutNumber}`,
    transitionHint: "dissolve",
    characterConsistency: "consistent",
    charactersInScene: ["character-1", "character-2"],
    ...overrides,
  } as Cut;
}

function makePromptOutput(cuts: Cut[], overrides?: Partial<PromptOutput>): PromptOutput {
  return {
    projectTitle: "Test Project",
    conceptSummary: "Test concept summary",
    totalCuts: cuts.length,
    globalStylePrompt: "cinematic wide-angle",
    directorPersonaPrompt: "dramatic auteur",
    characterSeeds: [
      { id: "char-1", label: "Hero", appearance: "tall, dark hair", appearanceKo: "키 크고 검은 머리" },
      { id: "char-2", label: "Villain", appearance: "scarred face", appearanceKo: "흉터 있는 얼굴" },
    ] as CharacterSeed[],
    continuityRules: ["rule-1: maintain lighting", "rule-2: consistent wardrobe"],
    cuts,
    ...overrides,
  };
}

/** 수동으로 TextInput → GenerateVideo → Viewer 체인 생성 (보존 메타 없음) */
function buildManualChain(prompt: string, durationSec = 6): CanvasState {
  const textNode = createNode(findDef("text-input"), 0, 0);
  const vidNode = createNode(findDef("generate-video"), 300, 0);
  const viewerNode = createNode(findDef("viewer"), 600, 0);

  let state = createInitialCanvasState();
  state = addNode(state, { ...textNode, data: { ...textNode.data, text: prompt } });
  state = addNode(state, {
    ...vidNode,
    data: { ...vidNode.data, prompt, durationSec, sceneDescription: "test scene" },
  });
  state = addNode(state, viewerNode);

  state = addEdge(state, textNode.id, textNode.outputs[0].id, vidNode.id, vidNode.inputs[0].id);
  state = addEdge(state, vidNode.id, vidNode.outputs[0].id, viewerNode.id, viewerNode.inputs[0].id);

  return state;
}

// ═══════════════════════════════════════════════════════════════════
// 1. Import preserves original cut meta
// ═══════════════════════════════════════════════════════════════════

describe("import preserves original cut meta", () => {
  it("should store _preservedCut on GenerateVideo node data", () => {
    const cut = makeCut(1, {
      cameraDirection: "tracking shot from left",
      moodLighting: "neon blue glow",
      imagePrompt: "custom image prompt",
    });
    const output = makePromptOutput([cut]);
    const state = promptOutputToCanvasState(output);

    const vidNode = state.nodes.find(n => n.type === "generate-video")!;
    const preserved = vidNode.data._preservedCut as PreservedCutData;

    expect(preserved).toBeDefined();
    expect(preserved.cameraDirection).toBe("tracking shot from left");
    expect(preserved.moodLighting).toBe("neon blue glow");
    expect(preserved.imagePrompt).toBe("custom image prompt");
  });

  it("should store _preservedOutputMeta on first TextInput node", () => {
    const output = makePromptOutput([makeCut(1), makeCut(2)]);
    const state = promptOutputToCanvasState(output);

    const textNodes = state.nodes.filter(n => n.type === "text-input");
    const firstMeta = textNodes[0].data._preservedOutputMeta as PreservedOutputMeta;
    const secondMeta = textNodes[1].data._preservedOutputMeta;

    expect(firstMeta).toBeDefined();
    expect(firstMeta.globalStylePrompt).toBe("cinematic wide-angle");
    expect(firstMeta.characterSeeds).toHaveLength(2);
    expect(firstMeta.continuityRules).toHaveLength(2);
    // 두 번째 TextInput에는 저장하지 않음
    expect(secondMeta).toBeUndefined();
  });

  it("should preserve all non-editable fields via cutToNodes", () => {
    const cut = makeCut(1, {
      shotCategory: "establishing",
      characterRole: "protagonist",
    });
    const { vidNode } = cutToNodes(cut, 0);

    const preserved = vidNode.data._preservedCut as PreservedCutData;
    expect(preserved.shotCategory).toBe("establishing");
    expect(preserved.characterRole).toBe("protagonist");
    expect(preserved.transitionHint).toBe("dissolve");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Export uses modified videoPrompt/durationSec values
// ═══════════════════════════════════════════════════════════════════

describe("export uses modified editable fields", () => {
  it("should use canvas-edited videoPrompt over original", () => {
    const output = makePromptOutput([makeCut(1, { videoPrompt: "original prompt" })]);
    let state = promptOutputToCanvasState(output);

    // 캔버스에서 prompt 수정
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;
    state = updateNodeData(state, vidNode.id, { prompt: "edited on canvas" });

    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].videoPrompt).toBe("edited on canvas");
  });

  it("should use canvas-edited durationSec over original", () => {
    const output = makePromptOutput([makeCut(1, { durationSec: 6 })]);
    let state = promptOutputToCanvasState(output);

    const vidNode = state.nodes.find(n => n.type === "generate-video")!;
    state = updateNodeData(state, vidNode.id, { durationSec: 12 });

    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].durationSec).toBe(12);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. cameraDirection restoration
// ═══════════════════════════════════════════════════════════════════

describe("cameraDirection restoration", () => {
  it("should restore cameraDirection from preserved metadata on export", () => {
    const output = makePromptOutput([
      makeCut(1, { cameraDirection: "crane shot ascending" }),
    ]);
    const state = promptOutputToCanvasState(output);

    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].cameraDirection).toBe("crane shot ascending");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. moodLighting restoration
// ═══════════════════════════════════════════════════════════════════

describe("moodLighting restoration", () => {
  it("should restore moodLighting from preserved metadata on export", () => {
    const output = makePromptOutput([
      makeCut(1, { moodLighting: "harsh fluorescent overhead" }),
    ]);
    const state = promptOutputToCanvasState(output);

    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].moodLighting).toBe("harsh fluorescent overhead");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. characterSeeds restoration
// ═══════════════════════════════════════════════════════════════════

describe("characterSeeds restoration", () => {
  it("should restore characterSeeds from preserved output meta on export", () => {
    const seeds: CharacterSeed[] = [
      { id: "seed-1", label: "Alpha", appearance: "blue eyes", appearanceKo: "파란 눈" },
      { id: "seed-2", label: "Beta", appearance: "short hair", appearanceKo: "짧은 머리" },
    ];
    const output = makePromptOutput([makeCut(1)], { characterSeeds: seeds });
    const state = promptOutputToCanvasState(output);

    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.characterSeeds).toHaveLength(2);
    expect((result.output.characterSeeds[0] as CharacterSeed).id).toBe("seed-1");
    expect((result.output.characterSeeds[1] as CharacterSeed).label).toBe("Beta");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. continuityRules restoration
// ═══════════════════════════════════════════════════════════════════

describe("continuityRules restoration", () => {
  it("should restore continuityRules from preserved output meta on export", () => {
    const rules = ["maintain eye-line", "consistent color grading", "match shadows"];
    const output = makePromptOutput([makeCut(1)], { continuityRules: rules });
    const state = promptOutputToCanvasState(output);

    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.continuityRules).toEqual(rules);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. shots (multiShot) restoration
// ═══════════════════════════════════════════════════════════════════

describe("shots (multiShot) restoration", () => {
  it("should restore multiShot from preserved cut metadata on export", () => {
    const multiShot = [
      { index: 0, prompt: "wide establishing shot" },
      { index: 1, prompt: "close-up on face" },
    ];
    const cut = makeCut(1, { multiShot: multiShot as Cut["multiShot"] });
    const output = makePromptOutput([cut]);
    const state = promptOutputToCanvasState(output);

    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].multiShot).toBeDefined();
    expect(result.output.cuts[0].multiShot).toHaveLength(2);
    expect(result.output.cuts[0].multiShot![0].prompt).toBe("wide establishing shot");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Fallback when no preserved meta exists
// ═══════════════════════════════════════════════════════════════════

describe("fallback when no preserved meta exists", () => {
  it("should use empty defaults for non-editable fields on manual chain", () => {
    const state = buildManualChain("manual prompt");

    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const cut = result.output.cuts[0];
    expect(cut.cameraDirection).toBe("");
    expect(cut.moodLighting).toBe("");
    expect(cut.imagePrompt).toBe("");
    expect(cut.endImagePrompt).toBe("");
    expect(cut.extendPrompt).toBe("");
    expect(cut.transitionHint).toBe("");
    expect(cut.characterConsistency).toBe("");
    expect(cut.charactersInScene).toEqual([]);
    expect(cut.multiShot).toBeUndefined();
  });

  it("should use empty defaults for output-level meta on manual chain", () => {
    const state = buildManualChain("manual prompt");

    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.characterSeeds).toEqual([]);
    expect(result.output.continuityRules).toEqual([]);
    expect(result.output.globalStylePrompt).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Extended roundtrip preservation test
// ═══════════════════════════════════════════════════════════════════

describe("extended roundtrip preservation", () => {
  it("should preserve ALL metadata fields through import→export roundtrip", () => {
    const originalCuts = [
      makeCut(1, {
        videoPrompt: "panoramic mountain vista",
        durationSec: 8,
        sceneDescription: "mountains at dawn",
        cameraDirection: "slow pan left to right",
        moodLighting: "soft amber dawn light",
        imagePrompt: "alpine landscape reference",
        endImagePrompt: "sunrise peak moment",
        extendPrompt: "continue the sweeping motion",
        transitionHint: "cross-dissolve",
        characterConsistency: "consistent wardrobe",
        charactersInScene: ["hero", "guide"],
        shotCategory: "establishing",
        characterRole: "protagonist",
      }),
      makeCut(2, {
        videoPrompt: "close-up dialogue scene",
        durationSec: 10,
        sceneDescription: "two characters talking",
        cameraDirection: "over-the-shoulder shot",
        moodLighting: "soft interior lighting",
        imagePrompt: "dialogue setup reference",
        endImagePrompt: "reaction shot end",
        extendPrompt: "extend dialogue beat",
        transitionHint: "cut",
        characterConsistency: "matching eye-lines",
        charactersInScene: ["hero", "villain"],
      }),
    ];

    const originalOutput = makePromptOutput(originalCuts, {
      globalStylePrompt: "film noir aesthetic",
      directorPersonaPrompt: "Kubrick-inspired precision",
      characterSeeds: [
        { id: "s1", label: "Hero", appearance: "rugged", appearanceKo: "거친" },
      ] as CharacterSeed[],
      continuityRules: ["maintain 180-degree rule", "consistent color temp"],
    });

    // Import
    const canvasState = promptOutputToCanvasState(originalOutput);

    // Simulate editing on canvas: modify editable fields only
    const vidNode1 = canvasState.nodes.filter(n => n.type === "generate-video")[0];
    let editedState = updateNodeData(canvasState, vidNode1.id, {
      prompt: "EDITED: panoramic mountain vista with fog",
      durationSec: 12,
    });

    // Export
    const result = exportAllChainsToPromptOutput(editedState);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const exported = result.output;

    // === Output-level preservation ===
    expect(exported.globalStylePrompt).toBe("film noir aesthetic");
    expect(exported.directorPersonaPrompt).toBe("Kubrick-inspired precision");
    expect(exported.characterSeeds).toHaveLength(1);
    expect((exported.characterSeeds[0] as CharacterSeed).label).toBe("Hero");
    expect(exported.continuityRules).toEqual(["maintain 180-degree rule", "consistent color temp"]);

    // === Cut 1: edited fields changed, preserved fields intact ===
    const cut1 = exported.cuts[0];
    expect(cut1.videoPrompt).toBe("EDITED: panoramic mountain vista with fog");
    expect(cut1.durationSec).toBe(12);
    expect(cut1.cameraDirection).toBe("slow pan left to right");
    expect(cut1.moodLighting).toBe("soft amber dawn light");
    expect(cut1.imagePrompt).toBe("alpine landscape reference");
    expect(cut1.endImagePrompt).toBe("sunrise peak moment");
    expect(cut1.extendPrompt).toBe("continue the sweeping motion");
    expect(cut1.transitionHint).toBe("cross-dissolve");
    expect(cut1.characterConsistency).toBe("consistent wardrobe");
    expect(cut1.charactersInScene).toEqual(["hero", "guide"]);
    expect(cut1.shotCategory).toBe("establishing");
    expect(cut1.characterRole).toBe("protagonist");

    // === Cut 2: untouched, all fields preserved ===
    const cut2 = exported.cuts[1];
    expect(cut2.videoPrompt).toBe("close-up dialogue scene");
    expect(cut2.durationSec).toBe(10);
    expect(cut2.cameraDirection).toBe("over-the-shoulder shot");
    expect(cut2.moodLighting).toBe("soft interior lighting");
    expect(cut2.imagePrompt).toBe("dialogue setup reference");
    expect(cut2.endImagePrompt).toBe("reaction shot end");
    expect(cut2.extendPrompt).toBe("extend dialogue beat");
    expect(cut2.transitionHint).toBe("cut");
    expect(cut2.characterConsistency).toBe("matching eye-lines");
    expect(cut2.charactersInScene).toEqual(["hero", "villain"]);
  });

  it("should preserve metadata through multiple roundtrips", () => {
    const original = makePromptOutput([
      makeCut(1, { cameraDirection: "dutch angle", moodLighting: "neon pink" }),
    ]);

    // Roundtrip 1
    const state1 = promptOutputToCanvasState(original);
    const result1 = exportAllChainsToPromptOutput(state1);
    expect(result1.success).toBe(true);
    if (!result1.success) return;

    // Roundtrip 2
    const state2 = promptOutputToCanvasState(result1.output);
    const result2 = exportAllChainsToPromptOutput(state2);
    expect(result2.success).toBe(true);
    if (!result2.success) return;

    // Should still have the original values after 2 roundtrips
    expect(result2.output.cuts[0].cameraDirection).toBe("dutch angle");
    expect(result2.output.cuts[0].moodLighting).toBe("neon pink");
    expect(result2.output.globalStylePrompt).toBe("cinematic wide-angle");
    expect(result2.output.continuityRules).toEqual(["rule-1: maintain lighting", "rule-2: consistent wardrobe"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Merge export 후 metadata preservation 검증
// ═══════════════════════════════════════════════════════════════════

describe("merge export preserves _preservedCut and output-level metadata", () => {
  it("merged cut의 _preservedCut 보존 필드가 유지된다 (cameraDirection, moodLighting)", () => {
    const original = makePromptOutput([
      makeCut(1, {
        cameraDirection: "tracking shot",
        moodLighting: "neon glow",
        imagePrompt: "ref-image-1",
        endImagePrompt: "end-ref-1",
        extendPrompt: "extend-1",
        transitionHint: "fade",
        characterConsistency: "uniform",
        charactersInScene: ["hero", "sidekick"],
      }),
      makeCut(2, {
        cameraDirection: "static wide",
        moodLighting: "natural daylight",
      }),
      makeCut(3, {
        cameraDirection: "handheld",
        moodLighting: "candlelight",
      }),
    ]);

    const canvasState = promptOutputToCanvasState(original);
    const chains = findAllChains(canvasState);

    // cut 1만 merge
    const result = mergeSelectedChainsToOutput([chains[0]], original);
    expect(result.success).toBe(true);
    if (!result.success) return;

    // merged cut 1: _preservedCut에서 복원된 보존 필드
    const cut1 = result.output.cuts[0];
    expect(cut1.cameraDirection).toBe("tracking shot");
    expect(cut1.moodLighting).toBe("neon glow");
    expect(cut1.imagePrompt).toBe("ref-image-1");
    expect(cut1.endImagePrompt).toBe("end-ref-1");
    expect(cut1.extendPrompt).toBe("extend-1");
    expect(cut1.transitionHint).toBe("fade");
    expect(cut1.characterConsistency).toBe("uniform");
    expect(cut1.charactersInScene).toEqual(["hero", "sidekick"]);

    // 비병합 cut 2, 3은 원본 그대로
    expect(result.output.cuts[1].cameraDirection).toBe("static wide");
    expect(result.output.cuts[1].moodLighting).toBe("natural daylight");
    expect(result.output.cuts[2].cameraDirection).toBe("handheld");
    expect(result.output.cuts[2].moodLighting).toBe("candlelight");
  });

  it("merge 후 output-level characterSeeds/continuityRules가 baseOutput에서 유지된다", () => {
    const original = makePromptOutput([makeCut(1), makeCut(2)], {
      characterSeeds: [
        { id: "s1", label: "Alpha", appearance: "tall", appearanceKo: "키 큰" },
        { id: "s2", label: "Beta", appearance: "short", appearanceKo: "작은" },
      ] as PromptOutput["characterSeeds"],
      continuityRules: ["eye-line", "color grade", "wardrobe"],
      globalStylePrompt: "cyberpunk",
      directorPersonaPrompt: "Villeneuve-inspired",
    });

    const canvasState = promptOutputToCanvasState(original);
    const chains = findAllChains(canvasState);

    const result = mergeSelectedChainsToOutput([chains[0]], original);
    expect(result.success).toBe(true);
    if (!result.success) return;

    // baseOutput의 output-level 메타 유지 (merge가 덮어쓰지 않음)
    expect(result.output.characterSeeds).toHaveLength(2);
    expect((result.output.characterSeeds[0] as { id: string }).id).toBe("s1");
    expect(result.output.continuityRules).toEqual(["eye-line", "color grade", "wardrobe"]);
    expect(result.output.globalStylePrompt).toBe("cyberpunk");
    expect(result.output.directorPersonaPrompt).toBe("Villeneuve-inspired");
  });

  it("mergeAllChainsToOutput도 _preservedCut 보존 필드를 유지한다", () => {
    const original = makePromptOutput([
      makeCut(1, { cameraDirection: "crane up", shotCategory: "establishing" }),
      makeCut(2, { cameraDirection: "dolly in", characterRole: "antagonist" }),
    ]);

    const canvasState = promptOutputToCanvasState(original);
    const result = mergeAllChainsToOutput(canvasState, original);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].cameraDirection).toBe("crane up");
    expect(result.output.cuts[0].shotCategory).toBe("establishing");
    expect(result.output.cuts[1].cameraDirection).toBe("dolly in");
    expect(result.output.cuts[1].characterRole).toBe("antagonist");
  });

  it("canvas에서 prompt 수정 후 merge해도 보존 필드는 살아있다", () => {
    const original = makePromptOutput([
      makeCut(1, {
        videoPrompt: "original prompt",
        cameraDirection: "overhead crane",
        moodLighting: "blue moonlight",
      }),
      makeCut(2),
    ]);

    let canvasState = promptOutputToCanvasState(original);
    // 캔버스에서 cut 1의 prompt만 수정
    const vidNode = canvasState.nodes.filter(n => n.type === "generate-video")[0];
    canvasState = updateNodeData(canvasState, vidNode.id, { prompt: "EDITED prompt" });

    const chains = findAllChains(canvasState);
    const result = mergeSelectedChainsToOutput([chains[0]], original);
    expect(result.success).toBe(true);
    if (!result.success) return;

    // prompt는 수정된 값
    expect(result.output.cuts[0].videoPrompt).toBe("EDITED prompt");
    // 보존 필드는 원본 유지
    expect(result.output.cuts[0].cameraDirection).toBe("overhead crane");
    expect(result.output.cuts[0].moodLighting).toBe("blue moonlight");
    // cut 2는 원본 그대로
    expect(result.output.cuts[1].videoPrompt).toBe("Video prompt for cut 2");
  });
});
