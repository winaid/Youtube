/**
 * nodes-to-sequence.test.ts — CanvasState → PromptOutput export 테스트
 *
 * 테스트 대상:
 * 1. 선택한 GenerateVideo 노드 export
 * 2. chain 역추적 성공
 * 3. export 결과에 provenance 메타 포함
 * 4. export 가능한 노드/불가능한 노드 구분
 * 5. PromptGenerator로 결과 전달 (PromptOutput 구조)
 * 6. 기존 편집기 흐름과 충돌하지 않음
 */

import { describe, it, expect } from "vitest";
import {
  findChainFromNode,
  findAllChains,
  canExportFromNode,
  exportFromSelectedNode,
  exportChainToPromptOutput,
  exportAllChainsToPromptOutput,
  mergeSelectedChainsToOutput,
  mergeSelectedNodeToOutput,
  mergeAllChainsToOutput,
  type ExportChain,
  type MergeError,
} from "@/lib/nodes-to-sequence";
import { promptOutputToCanvasState } from "@/lib/sequence-to-nodes";
import {
  createInitialCanvasState,
  createNode,
  addNode,
  addEdge,
  updateNodeStatus,
  NODE_REGISTRY,
  type CanvasState,
} from "@/lib/node-types";
import type { Cut, PromptOutput } from "@/types";

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
    sceneDescription: `Scene ${cutNumber}`,
    cameraDirection: "wide",
    moodLighting: "warm",
    imagePrompt: `img ${cutNumber}`,
    endImagePrompt: `end ${cutNumber}`,
    videoPrompt: `Video prompt ${cutNumber}`,
    extendPrompt: "",
    transitionHint: "dissolve",
    characterConsistency: "",
    charactersInScene: [],
    ...overrides,
  } as Cut;
}

/** 수동으로 TextInput → GenerateVideo → Viewer 체인 생성 */
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

  // TextInput.text → Video.prompt
  state = addEdge(state, textNode.id, textNode.outputs[0].id, vidNode.id, vidNode.inputs[0].id);
  // Video.video → Viewer.media
  state = addEdge(state, vidNode.id, vidNode.outputs[0].id, viewerNode.id, viewerNode.inputs[0].id);

  return state;
}

// ═══════════════════════════════════════════════════════════════════
// 1. 선택한 GenerateVideo 노드 export
// ═══════════════════════════════════════════════════════════════════

describe("export selected GenerateVideo node", () => {
  it("should export a single chain from generate-video node", () => {
    const state = buildManualChain("ocean waves");
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;

    const result = exportFromSelectedNode(state, vidNode.id);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts.length).toBe(1);
    expect(result.output.cuts[0].videoPrompt).toBe("ocean waves");
    expect(result.output.totalCuts).toBe(1);
  });

  it("should extract durationSec from video node data", () => {
    const state = buildManualChain("sunset", 10);
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;

    const result = exportFromSelectedNode(state, vidNode.id);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].durationSec).toBe(10);
  });

  it("should extract sceneDescription from video node data", () => {
    const state = buildManualChain("test");
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;

    const result = exportFromSelectedNode(state, vidNode.id);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].sceneDescription).toBe("test scene");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. chain 역추적 성공
// ═══════════════════════════════════════════════════════════════════

describe("chain backtracking", () => {
  it("should find chain from text-input node (downstream)", () => {
    const state = buildManualChain("from text");
    const textNode = state.nodes.find(n => n.type === "text-input")!;

    const chain = findChainFromNode(state, textNode.id);
    expect(chain).not.toBeNull();
    expect(chain!.textNode?.id).toBe(textNode.id);
    expect(chain!.videoNode.type).toBe("generate-video");
    expect(chain!.viewerNode?.type).toBe("viewer");
  });

  it("should find chain from viewer node (upstream)", () => {
    const state = buildManualChain("from viewer");
    const viewerNode = state.nodes.find(n => n.type === "viewer")!;

    const chain = findChainFromNode(state, viewerNode.id);
    expect(chain).not.toBeNull();
    expect(chain!.viewerNode?.id).toBe(viewerNode.id);
    expect(chain!.videoNode.type).toBe("generate-video");
  });

  it("should find chain from generate-video node directly", () => {
    const state = buildManualChain("direct");
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;

    const chain = findChainFromNode(state, vidNode.id);
    expect(chain).not.toBeNull();
    expect(chain!.videoNode.id).toBe(vidNode.id);
    expect(chain!.textNode).toBeDefined();
    expect(chain!.viewerNode).toBeDefined();
  });

  it("should handle video node without text input", () => {
    const vidNode = createNode(findDef("generate-video"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, { ...vidNode, data: { ...vidNode.data, prompt: "standalone" } });

    const chain = findChainFromNode(state, vidNode.id);
    expect(chain).not.toBeNull();
    expect(chain!.textNode).toBeUndefined();
    expect(chain!.viewerNode).toBeUndefined();
  });

  it("should handle video node without viewer", () => {
    const textNode = createNode(findDef("text-input"), 0, 0);
    const vidNode = createNode(findDef("generate-video"), 300, 0);

    let state = createInitialCanvasState();
    state = addNode(state, { ...textNode, data: { text: "no viewer" } });
    state = addNode(state, { ...vidNode, data: { ...vidNode.data, prompt: "no viewer" } });
    state = addEdge(state, textNode.id, textNode.outputs[0].id, vidNode.id, vidNode.inputs[0].id);

    const chain = findChainFromNode(state, vidNode.id);
    expect(chain).not.toBeNull();
    expect(chain!.textNode).toBeDefined();
    expect(chain!.viewerNode).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. export 결과에 provenance 메타 포함
// ═══════════════════════════════════════════════════════════════════

describe("export provenance metadata", () => {
  it("should include source=node-canvas-export in meta", () => {
    const state = buildManualChain("provenance test");
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;

    const chain = findChainFromNode(state, vidNode.id)!;
    expect(chain.meta.source).toBe("node-canvas-export");
  });

  it("should include exportedAt timestamp", () => {
    const before = Date.now();
    const state = buildManualChain("time test");
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;

    const chain = findChainFromNode(state, vidNode.id)!;
    const after = Date.now();

    expect(chain.meta.exportedAt).toBeGreaterThanOrEqual(before);
    expect(chain.meta.exportedAt).toBeLessThanOrEqual(after);
  });

  it("should include originatingNodeId", () => {
    const state = buildManualChain("id test");
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;

    const chain = findChainFromNode(state, vidNode.id)!;
    expect(chain.meta.originatingNodeId).toBe(vidNode.id);
  });

  it("should detect importedFromSequence when provenance exists", () => {
    const output: PromptOutput = {
      projectTitle: "Test",
      conceptSummary: "",
      totalCuts: 1,
      globalStylePrompt: "",
      directorPersonaPrompt: "",
      characterSeeds: [],
      continuityRules: [],
      cuts: [makeCut(1)],
    };
    const imported = promptOutputToCanvasState(output);
    const vidNode = imported.nodes.find(n => n.type === "generate-video")!;

    const chain = findChainFromNode(imported, vidNode.id)!;
    expect(chain.meta.importedFromSequence).toBe(true);
  });

  it("should set importedFromSequence=false for manually created nodes", () => {
    const state = buildManualChain("manual");
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;

    const chain = findChainFromNode(state, vidNode.id)!;
    expect(chain.meta.importedFromSequence).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. export 가능한 노드/불가능한 노드 구분
// ═══════════════════════════════════════════════════════════════════

describe("exportable node detection", () => {
  it("should allow export from generate-video node", () => {
    const state = buildManualChain("exportable");
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;
    expect(canExportFromNode(state, vidNode.id)).toBe(true);
  });

  it("should allow export from text-input connected to video", () => {
    const state = buildManualChain("text export");
    const textNode = state.nodes.find(n => n.type === "text-input")!;
    expect(canExportFromNode(state, textNode.id)).toBe(true);
  });

  it("should allow export from viewer connected to video", () => {
    const state = buildManualChain("viewer export");
    const viewerNode = state.nodes.find(n => n.type === "viewer")!;
    expect(canExportFromNode(state, viewerNode.id)).toBe(true);
  });

  it("should deny export from disconnected text-input", () => {
    const textNode = createNode(findDef("text-input"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, textNode);
    expect(canExportFromNode(state, textNode.id)).toBe(false);
  });

  it("should deny export from disconnected viewer", () => {
    const viewerNode = createNode(findDef("viewer"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, viewerNode);
    expect(canExportFromNode(state, viewerNode.id)).toBe(false);
  });

  it("should deny export from generate-image node", () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    expect(canExportFromNode(state, imgNode.id)).toBe(false);
  });

  it("should return error for non-exportable node", () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, imgNode);

    const result = exportFromSelectedNode(state, imgNode.id);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain("GenerateVideo");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. PromptGenerator로 결과 전달 (PromptOutput 구조)
// ═══════════════════════════════════════════════════════════════════

describe("PromptOutput structure for editor", () => {
  it("should produce valid PromptOutput with required fields", () => {
    const state = buildManualChain("valid output");
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;

    const result = exportFromSelectedNode(state, vidNode.id);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const output = result.output;
    expect(output.projectTitle).toBeDefined();
    expect(output.conceptSummary).toBeDefined();
    expect(output.totalCuts).toBe(1);
    expect(output.globalStylePrompt).toBeDefined();
    expect(output.directorPersonaPrompt).toBeDefined();
    expect(output.characterSeeds).toEqual([]);
    expect(output.continuityRules).toEqual([]);
    expect(Array.isArray(output.cuts)).toBe(true);
  });

  it("should produce valid Cut objects", () => {
    const state = buildManualChain("valid cut");
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;

    const result = exportFromSelectedNode(state, vidNode.id);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const cut = result.output.cuts[0];
    expect(cut.cutNumber).toBe(1);
    expect(typeof cut.videoPrompt).toBe("string");
    expect(typeof cut.sceneDescription).toBe("string");
    expect(typeof cut.durationSec).toBe("number");
    expect(typeof cut.cameraDirection).toBe("string");
  });

  it("should export all chains as multi-cut PromptOutput", () => {
    const output: PromptOutput = {
      projectTitle: "Multi-cut",
      conceptSummary: "",
      totalCuts: 3,
      globalStylePrompt: "",
      directorPersonaPrompt: "",
      characterSeeds: [],
      continuityRules: [],
      cuts: [makeCut(1), makeCut(2), makeCut(3)],
    };
    const imported = promptOutputToCanvasState(output);

    const result = exportAllChainsToPromptOutput(imported);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts.length).toBe(3);
    expect(result.output.totalCuts).toBe(3);
    // Cuts should be numbered sequentially
    expect(result.output.cuts[0].cutNumber).toBe(1);
    expect(result.output.cuts[1].cutNumber).toBe(2);
    expect(result.output.cuts[2].cutNumber).toBe(3);
  });

  it("should return error when no video nodes exist", () => {
    const state = createInitialCanvasState();
    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain("GenerateVideo");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. 기존 편집기 흐름과 충돌하지 않음
// ═══════════════════════════════════════════════════════════════════

describe("no conflict with existing editor flow", () => {
  it("should roundtrip import→export preserving videoPrompt", () => {
    const originalOutput: PromptOutput = {
      projectTitle: "Roundtrip Test",
      conceptSummary: "",
      totalCuts: 1,
      globalStylePrompt: "",
      directorPersonaPrompt: "",
      characterSeeds: [],
      continuityRules: [],
      cuts: [makeCut(1, { videoPrompt: "roundtrip prompt" })],
    };

    // Import
    const canvasState = promptOutputToCanvasState(originalOutput);
    expect(canvasState.nodes.length).toBe(3);

    // Export
    const result = exportAllChainsToPromptOutput(canvasState);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].videoPrompt).toBe("roundtrip prompt");
  });

  it("should roundtrip import→export preserving durationSec", () => {
    const originalOutput: PromptOutput = {
      projectTitle: "Duration Test",
      conceptSummary: "",
      totalCuts: 1,
      globalStylePrompt: "",
      directorPersonaPrompt: "",
      characterSeeds: [],
      continuityRules: [],
      cuts: [makeCut(1, { durationSec: 10 })],
    };

    const canvasState = promptOutputToCanvasState(originalOutput);
    const result = exportAllChainsToPromptOutput(canvasState);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].durationSec).toBe(10);
  });

  it("should maintain cut order after import→export", () => {
    const originalOutput: PromptOutput = {
      projectTitle: "Order Test",
      conceptSummary: "",
      totalCuts: 3,
      globalStylePrompt: "",
      directorPersonaPrompt: "",
      characterSeeds: [],
      continuityRules: [],
      cuts: [
        makeCut(1, { videoPrompt: "first" }),
        makeCut(2, { videoPrompt: "second" }),
        makeCut(3, { videoPrompt: "third" }),
      ],
    };

    const canvasState = promptOutputToCanvasState(originalOutput);
    const result = exportAllChainsToPromptOutput(canvasState);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].videoPrompt).toBe("first");
    expect(result.output.cuts[1].videoPrompt).toBe("second");
    expect(result.output.cuts[2].videoPrompt).toBe("third");
  });

  it("should not modify the original canvas state during export", () => {
    const state = buildManualChain("immutable test");
    const nodeCount = state.nodes.length;
    const edgeCount = state.edges.length;

    exportAllChainsToPromptOutput(state);

    expect(state.nodes.length).toBe(nodeCount);
    expect(state.edges.length).toBe(edgeCount);
  });

  it("should preserve projectTitle from imported sequence", () => {
    const originalOutput: PromptOutput = {
      projectTitle: "My Film Project",
      conceptSummary: "",
      totalCuts: 1,
      globalStylePrompt: "",
      directorPersonaPrompt: "",
      characterSeeds: [],
      continuityRules: [],
      cuts: [makeCut(1)],
    };

    const canvasState = promptOutputToCanvasState(originalOutput);
    const result = exportAllChainsToPromptOutput(canvasState);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.projectTitle).toBe("My Film Project");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Merge export — 선택 chain만 기존 result에 부분 반영
// ═══════════════════════════════════════════════════════════════════

describe("merge export — partial update of existing result", () => {
  function makeBaseOutput(cutCount: number): PromptOutput {
    return {
      projectTitle: "Test Film",
      conceptSummary: "A test film",
      totalCuts: cutCount,
      globalStylePrompt: "cinematic",
      directorPersonaPrompt: "director",
      characterSeeds: [],
      continuityRules: ["rule1"],
      cuts: Array.from({ length: cutCount }, (_, i) => makeCut(i + 1, {
        videoPrompt: `Original prompt ${i + 1}`,
        sceneDescription: `Original scene ${i + 1}`,
        cameraDirection: "original-cam",
        moodLighting: "original-mood",
      })),
    };
  }

  it("should merge selected chain into matching cut by provenance cutNumber", () => {
    // Import 3-cut output to canvas, modify cut 2, then merge
    const baseOutput = makeBaseOutput(3);
    const canvasState = promptOutputToCanvasState(baseOutput);

    // Find chain for cut 2 (y-sorted, index 1)
    const chains = findAllChains(canvasState);
    expect(chains.length).toBe(3);

    // Verify provenance cutNumber is set
    const chain2 = chains[1];
    const prov = chain2.videoNode.provenance as { importMeta?: { cutNumber?: number } };
    expect(prov?.importMeta?.cutNumber).toBe(2);

    // Merge only chain 2 — should only replace cut 2
    const result = mergeSelectedChainsToOutput([chain2], baseOutput);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.mergedCutNumbers).toEqual([2]);
    expect(result.unmatchedChainNodeIds).toHaveLength(0);

    // Cut 1 and 3 should be unchanged
    expect(result.output.cuts[0].videoPrompt).toBe("Original prompt 1");
    expect(result.output.cuts[0].cameraDirection).toBe("original-cam");
    expect(result.output.cuts[2].videoPrompt).toBe("Original prompt 3");

    // Cut 2 should be updated from canvas chain
    expect(result.output.cuts[1].cutNumber).toBe(2);
  });

  it("should preserve metadata of non-merged cuts", () => {
    const baseOutput = makeBaseOutput(3);
    const canvasState = promptOutputToCanvasState(baseOutput);
    const chains = findAllChains(canvasState);

    const result = mergeSelectedChainsToOutput([chains[0]], baseOutput);
    expect(result.success).toBe(true);
    if (!result.success) return;

    // Output-level metadata preserved
    expect(result.output.projectTitle).toBe("Test Film");
    expect(result.output.globalStylePrompt).toBe("cinematic");
    expect(result.output.directorPersonaPrompt).toBe("director");
    expect(result.output.continuityRules).toEqual(["rule1"]);
    expect(result.output.totalCuts).toBe(3);

    // Non-merged cuts untouched
    expect(result.output.cuts[1].videoPrompt).toBe("Original prompt 2");
    expect(result.output.cuts[2].videoPrompt).toBe("Original prompt 3");
  });

  it("should fail when chain has no provenance cutNumber", () => {
    const baseOutput = makeBaseOutput(2);
    // Build manual chain without provenance
    const state = buildManualChain("new scene");
    const chains = findAllChains(state);

    const result = mergeSelectedChainsToOutput(chains, baseOutput);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("찾지 못했습니다");
  });

  it("should report unmatched chains while still merging matched ones", () => {
    const baseOutput = makeBaseOutput(3);
    const canvasState = promptOutputToCanvasState(baseOutput);
    const importedChains = findAllChains(canvasState);

    // Build one manual chain without provenance
    const manualState = buildManualChain("unmatched");
    const manualChains = findAllChains(manualState);

    // Mix: one matched (imported cut 1) + one unmatched (manual)
    const mixed = [importedChains[0], manualChains[0]];
    const result = mergeSelectedChainsToOutput(mixed, baseOutput);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.mergedCutNumbers).toEqual([1]);
    expect(result.unmatchedChainNodeIds).toHaveLength(1);
    expect(result.unmatchedChainNodeIds[0]).toBe(manualChains[0].videoNode.id);
  });

  it("should fail when no chains provided", () => {
    const result = mergeSelectedChainsToOutput([], makeBaseOutput(1));
    expect(result.success).toBe(false);
  });

  it("should fail when base output has no cuts", () => {
    const emptyOutput: PromptOutput = {
      projectTitle: "Empty",
      conceptSummary: "",
      totalCuts: 0,
      globalStylePrompt: "",
      directorPersonaPrompt: "",
      characterSeeds: [],
      continuityRules: [],
      cuts: [],
    };
    const state = buildManualChain("test");
    const chains = findAllChains(state);
    const result = mergeSelectedChainsToOutput(chains, emptyOutput);
    expect(result.success).toBe(false);
  });

  it("mergeSelectedNodeToOutput merges chain from selected node", () => {
    const baseOutput = makeBaseOutput(3);
    const canvasState = promptOutputToCanvasState(baseOutput);
    const vidNode = canvasState.nodes.find(n => n.type === "generate-video")!;

    const result = mergeSelectedNodeToOutput(canvasState, vidNode.id, baseOutput);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.mergedCutNumbers.length).toBe(1);
  });

  it("mergeAllChainsToOutput merges all chains", () => {
    const baseOutput = makeBaseOutput(3);
    const canvasState = promptOutputToCanvasState(baseOutput);

    const result = mergeAllChainsToOutput(canvasState, baseOutput);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.mergedCutNumbers).toEqual([1, 2, 3]);
    expect(result.unmatchedChainNodeIds).toHaveLength(0);
  });

  it("full replace export still works unchanged", () => {
    const baseOutput = makeBaseOutput(3);
    const canvasState = promptOutputToCanvasState(baseOutput);

    const result = exportAllChainsToPromptOutput(canvasState);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.output.cuts.length).toBe(3);
    expect(result.output.totalCuts).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Duplicate target cutNumber 충돌 방어
// ═══════════════════════════════════════════════════════════════════

describe("merge — duplicate target cutNumber conflict detection", () => {
  function makeBaseOutput(cutCount: number): PromptOutput {
    return {
      projectTitle: "Conflict Test",
      conceptSummary: "conflict test",
      totalCuts: cutCount,
      globalStylePrompt: "cinematic",
      directorPersonaPrompt: "director",
      characterSeeds: [],
      continuityRules: [],
      cuts: Array.from({ length: cutCount }, (_, i) => makeCut(i + 1)),
    };
  }

  it("should reject merge when 2 chains target the same cutNumber", () => {
    const baseOutput = makeBaseOutput(3);
    const canvasState = promptOutputToCanvasState(baseOutput);
    const chains = findAllChains(canvasState);

    // chains[0]과 chains[1]이 각각 cutNumber 1, 2를 가리킨다.
    // chains[0]의 provenance를 수동으로 cutNumber=2로 변경해서 충돌 유발
    const duplicateChain: ExportChain = {
      ...chains[0],
      videoNode: {
        ...chains[0].videoNode,
        provenance: {
          createdAt: Date.now(),
          importMeta: {
            source: "structured-sequence-import",
            importedAt: Date.now(),
            cutNumber: 2, // chains[1]과 동일
          },
        },
      },
    };

    const result = mergeSelectedChainsToOutput([duplicateChain, chains[1]], baseOutput);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.reason).toContain("동시에 대응");
    expect(result.reason).toContain("2");
    expect((result as MergeError).conflictedCutNumbers).toEqual([2]);
    expect((result as MergeError).conflictedChainNodeIds).toHaveLength(2);
  });

  it("should reject merge when 3 chains target the same cutNumber", () => {
    const baseOutput = makeBaseOutput(3);
    const canvasState = promptOutputToCanvasState(baseOutput);
    const chains = findAllChains(canvasState);

    // 3개 모두 cutNumber=1로 설정
    const makeConflicting = (chain: ExportChain): ExportChain => ({
      ...chain,
      videoNode: {
        ...chain.videoNode,
        provenance: {
          createdAt: Date.now(),
          importMeta: { source: "structured-sequence-import", importedAt: Date.now(), cutNumber: 1 },
        },
      },
    });

    const result = mergeSelectedChainsToOutput(
      [makeConflicting(chains[0]), makeConflicting(chains[1]), makeConflicting(chains[2])],
      baseOutput,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect((result as MergeError).conflictedCutNumbers).toEqual([1]);
    expect((result as MergeError).conflictedChainNodeIds).toHaveLength(3);
  });

  it("should not conflict when different chains target different cutNumbers", () => {
    const baseOutput = makeBaseOutput(3);
    const canvasState = promptOutputToCanvasState(baseOutput);
    const chains = findAllChains(canvasState);

    // chains[0]=cut1, chains[2]=cut3 → 충돌 없음
    const result = mergeSelectedChainsToOutput([chains[0], chains[2]], baseOutput);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.mergedCutNumbers).toEqual([1, 3]);
  });

  it("conflict error includes structured fields for UI display", () => {
    const baseOutput = makeBaseOutput(2);
    const canvasState = promptOutputToCanvasState(baseOutput);
    const chains = findAllChains(canvasState);

    const dup: ExportChain = {
      ...chains[0],
      videoNode: {
        ...chains[0].videoNode,
        provenance: {
          createdAt: Date.now(),
          importMeta: { source: "structured-sequence-import", importedAt: Date.now(), cutNumber: 1 },
        },
      },
    };

    const result = mergeSelectedChainsToOutput([chains[0], dup], baseOutput);
    expect(result.success).toBe(false);
    if (result.success) return;

    // 구조화된 충돌 정보 존재
    const mergeErr = result as MergeError;
    expect(mergeErr.conflictedCutNumbers).toBeDefined();
    expect(mergeErr.conflictedChainNodeIds).toBeDefined();
    expect(Array.isArray(mergeErr.conflictedCutNumbers)).toBe(true);
    expect(Array.isArray(mergeErr.conflictedChainNodeIds)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Provenance 기반 매칭 독립 테스트
// ═══════════════════════════════════════════════════════════════════

describe("merge — provenance.importMeta.cutNumber matching", () => {
  function makeBaseOutput(cutCount: number): PromptOutput {
    return {
      projectTitle: "Provenance Match",
      conceptSummary: "",
      totalCuts: cutCount,
      globalStylePrompt: "",
      directorPersonaPrompt: "",
      characterSeeds: [],
      continuityRules: [],
      cuts: Array.from({ length: cutCount }, (_, i) => makeCut(i + 1, {
        videoPrompt: `Original ${i + 1}`,
      })),
    };
  }

  it("chain with provenance cutNumber=3 merges into cut 3, not cut 1", () => {
    const baseOutput = makeBaseOutput(5);
    const canvasState = promptOutputToCanvasState(baseOutput);
    const chains = findAllChains(canvasState);

    // chain[2]는 provenance cutNumber=3
    const prov = chains[2].videoNode.provenance as { importMeta?: { cutNumber?: number } };
    expect(prov?.importMeta?.cutNumber).toBe(3);

    const result = mergeSelectedChainsToOutput([chains[2]], baseOutput);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.mergedCutNumbers).toEqual([3]);
    // Cut 1, 2, 4, 5 원본 유지
    expect(result.output.cuts[0].videoPrompt).toBe("Original 1");
    expect(result.output.cuts[1].videoPrompt).toBe("Original 2");
    expect(result.output.cuts[3].videoPrompt).toBe("Original 4");
    expect(result.output.cuts[4].videoPrompt).toBe("Original 5");
    // Cut 3만 변경됨
    expect(result.output.cuts[2].cutNumber).toBe(3);
  });

  it("provenance cutNumber가 baseOutput에 없는 경우 unmatched 처리", () => {
    const baseOutput = makeBaseOutput(2); // cutNumber 1, 2만 존재
    const canvasState = promptOutputToCanvasState(makeBaseOutput(5));
    const chains = findAllChains(canvasState);

    // chain[4]는 provenance cutNumber=5 → baseOutput에 없음
    const result = mergeSelectedChainsToOutput([chains[4]], baseOutput);
    expect(result.success).toBe(false);
  });

  it("provenance 없는 수동 chain은 매칭 실패, merge 거부", () => {
    const baseOutput = makeBaseOutput(3);
    const manualState = buildManualChain("manual");
    const manualChains = findAllChains(manualState);

    // 수동 chain은 provenance가 없으므로 cutNumber 매칭 불가
    const prov = manualChains[0].videoNode.provenance as { importMeta?: { cutNumber?: number } };
    expect(prov?.importMeta?.cutNumber).toBeUndefined();

    const result = mergeSelectedChainsToOutput(manualChains, baseOutput);
    expect(result.success).toBe(false);
  });

  it("provenance cutNumber 기반으로 비순차적 merge 가능 (cut 5, 2)", () => {
    const baseOutput = makeBaseOutput(5);
    const canvasState = promptOutputToCanvasState(baseOutput);
    const chains = findAllChains(canvasState);

    // cut 5와 cut 2만 선택
    const result = mergeSelectedChainsToOutput([chains[4], chains[1]], baseOutput);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.mergedCutNumbers).toEqual([5, 2]);
    // 나머지 cuts 원본 유지
    expect(result.output.cuts[0].videoPrompt).toBe("Original 1");
    expect(result.output.cuts[2].videoPrompt).toBe("Original 3");
    expect(result.output.cuts[3].videoPrompt).toBe("Original 4");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. 상위 메타 및 cut 순서 불변 검증
// ═══════════════════════════════════════════════════════════════════

describe("merge — output-level metadata and cut order invariance", () => {
  function makeRichOutput(): PromptOutput {
    return {
      projectTitle: "Invariance Test Film",
      conceptSummary: "Testing invariance",
      totalCuts: 4,
      globalStylePrompt: "noir aesthetic",
      directorPersonaPrompt: "Kubrick-style",
      characterSeeds: [
        { id: "c1", label: "Hero", appearance: "tall", appearanceKo: "키 큰" },
      ] as PromptOutput["characterSeeds"],
      continuityRules: ["180-degree rule", "color consistency"],
      cuts: [
        makeCut(1, { videoPrompt: "wide establishing" }),
        makeCut(2, { videoPrompt: "medium tracking" }),
        makeCut(3, { videoPrompt: "close-up dialogue" }),
        makeCut(4, { videoPrompt: "aerial finale" }),
      ],
    };
  }

  it("merge does not change projectTitle", () => {
    const base = makeRichOutput();
    const canvas = promptOutputToCanvasState(base);
    const chains = findAllChains(canvas);

    const result = mergeSelectedChainsToOutput([chains[1]], base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.output.projectTitle).toBe("Invariance Test Film");
  });

  it("merge does not change globalStylePrompt", () => {
    const base = makeRichOutput();
    const canvas = promptOutputToCanvasState(base);
    const chains = findAllChains(canvas);

    const result = mergeSelectedChainsToOutput([chains[0]], base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.output.globalStylePrompt).toBe("noir aesthetic");
  });

  it("merge does not change directorPersonaPrompt", () => {
    const base = makeRichOutput();
    const canvas = promptOutputToCanvasState(base);
    const chains = findAllChains(canvas);

    const result = mergeSelectedChainsToOutput([chains[2]], base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.output.directorPersonaPrompt).toBe("Kubrick-style");
  });

  it("merge does not change continuityRules", () => {
    const base = makeRichOutput();
    const canvas = promptOutputToCanvasState(base);
    const chains = findAllChains(canvas);

    const result = mergeSelectedChainsToOutput([chains[3]], base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.output.continuityRules).toEqual(["180-degree rule", "color consistency"]);
  });

  it("merge does not change characterSeeds", () => {
    const base = makeRichOutput();
    const canvas = promptOutputToCanvasState(base);
    const chains = findAllChains(canvas);

    const result = mergeSelectedChainsToOutput([chains[0]], base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.output.characterSeeds).toHaveLength(1);
    expect((result.output.characterSeeds[0] as { id: string }).id).toBe("c1");
  });

  it("merge preserves totalCuts count", () => {
    const base = makeRichOutput();
    const canvas = promptOutputToCanvasState(base);
    const chains = findAllChains(canvas);

    const result = mergeSelectedChainsToOutput([chains[1]], base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.output.totalCuts).toBe(4);
    expect(result.output.cuts.length).toBe(4);
  });

  it("merge preserves cut order (cutNumbers remain sequential)", () => {
    const base = makeRichOutput();
    const canvas = promptOutputToCanvasState(base);
    const chains = findAllChains(canvas);

    // cut 2와 4만 merge
    const result = mergeSelectedChainsToOutput([chains[1], chains[3]], base);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts.map(c => c.cutNumber)).toEqual([1, 2, 3, 4]);
    // 비병합 cut은 원본 유지
    expect(result.output.cuts[0].videoPrompt).toBe("wide establishing");
    expect(result.output.cuts[2].videoPrompt).toBe("close-up dialogue");
  });

  it("merge does not mutate baseOutput", () => {
    const base = makeRichOutput();
    const originalCuts = base.cuts.map(c => ({ ...c }));
    const canvas = promptOutputToCanvasState(base);
    const chains = findAllChains(canvas);

    mergeSelectedChainsToOutput([chains[0]], base);

    // base는 변경되지 않아야 함
    expect(base.cuts.length).toBe(originalCuts.length);
    base.cuts.forEach((c, i) => {
      expect(c.cutNumber).toBe(originalCuts[i].cutNumber);
      expect(c.videoPrompt).toBe(originalCuts[i].videoPrompt);
    });
  });
});
