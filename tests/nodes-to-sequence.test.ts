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
