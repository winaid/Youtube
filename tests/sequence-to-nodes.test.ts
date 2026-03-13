/**
 * sequence-to-nodes.test.ts — StructuredSequence → CanvasState 변환 테스트
 *
 * 테스트 대상:
 * 1. structuredSequence → CanvasState 변환
 * 2. 최소 노드 수/엣지 수 확인
 * 3. provenance 메타 포함
 * 4. import 후 Viewer 연결 확인
 * 5. 기존 빈 캔버스/저장된 캔버스와 충돌 없이 동작
 * 6. import 후 fit/reset이 깨지지 않음
 */

import { describe, it, expect, beforeEach } from "vitest";
import { promptOutputToCanvasState, cutToNodes } from "@/lib/sequence-to-nodes";
import {
  createInitialCanvasState,
  getInputAssets,
  updateNodeStatus,
  fitViewport,
  createInitialViewport,
  saveCanvasState,
  loadCanvasState,
  addNode,
  createNode,
  NODE_REGISTRY,
} from "@/lib/node-types";
import type { PromptOutput, Cut } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

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
    charactersInScene: ["character-1"],
    ...overrides,
  } as Cut;
}

function makePromptOutput(cuts: Cut[]): PromptOutput {
  return {
    projectTitle: "Test Project",
    conceptSummary: "Test concept",
    totalCuts: cuts.length,
    globalStylePrompt: "cinematic",
    directorPersonaPrompt: "dramatic",
    characterSeeds: [],
    continuityRules: [],
    cuts,
  };
}

// Mock localStorage
const store: Record<string, string> = {};
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    },
    writable: true,
    configurable: true,
  });
});

// ═══════════════════════════════════════════════════════════════════
// 1. structuredSequence → CanvasState 변환
// ═══════════════════════════════════════════════════════════════════

describe("promptOutput to CanvasState conversion", () => {
  it("should convert a single cut to 3 nodes and 2 edges", () => {
    const output = makePromptOutput([makeCut(1)]);
    const state = promptOutputToCanvasState(output);

    // 1 cut = TextInput + GenerateVideo + Viewer = 3 nodes
    expect(state.nodes.length).toBe(3);
    // TextInput→Video, Video→Viewer = 2 edges
    expect(state.edges.length).toBe(2);
  });

  it("should convert multiple cuts proportionally", () => {
    const output = makePromptOutput([makeCut(1), makeCut(2), makeCut(3)]);
    const state = promptOutputToCanvasState(output);

    // 3 cuts × 3 nodes = 9
    expect(state.nodes.length).toBe(9);
    // 3 cuts × 2 edges = 6
    expect(state.edges.length).toBe(6);
  });

  it("should handle empty cuts array", () => {
    const output = makePromptOutput([]);
    const state = promptOutputToCanvasState(output);

    expect(state.nodes.length).toBe(0);
    expect(state.edges.length).toBe(0);
  });

  it("should populate video node with cut data", () => {
    const cut = makeCut(3, { durationSec: 10, videoPrompt: "epic sunrise over mountains" });
    const output = makePromptOutput([cut]);
    const state = promptOutputToCanvasState(output);

    const vidNode = state.nodes.find(n => n.type === "generate-video");
    expect(vidNode).toBeDefined();
    expect(vidNode!.data.prompt).toBe("epic sunrise over mountains");
    expect(vidNode!.data.durationSec).toBe(10);
    expect(vidNode!.data.sceneDescription).toBe("Scene 3 description");
  });

  it("should populate text input with videoPrompt", () => {
    const cut = makeCut(1, { videoPrompt: "a beautiful lake" });
    const output = makePromptOutput([cut]);
    const state = promptOutputToCanvasState(output);

    const textNode = state.nodes.find(n => n.type === "text-input");
    expect(textNode).toBeDefined();
    expect(textNode!.data.text).toBe("a beautiful lake");
  });

  it("should fallback to sceneDescription when videoPrompt is empty", () => {
    const cut = makeCut(1, { videoPrompt: "", sceneDescription: "fallback scene" });
    const output = makePromptOutput([cut]);
    const state = promptOutputToCanvasState(output);

    const textNode = state.nodes.find(n => n.type === "text-input");
    expect(textNode!.data.text).toBe("fallback scene");
  });

  it("should have no selectedNodeId after import", () => {
    const output = makePromptOutput([makeCut(1)]);
    const state = promptOutputToCanvasState(output);
    expect(state.selectedNodeId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. 최소 노드 수/엣지 수 확인
// ═══════════════════════════════════════════════════════════════════

describe("minimum node and edge counts", () => {
  it("should always have 3 nodes per cut", () => {
    for (let n = 1; n <= 5; n++) {
      const cuts = Array.from({ length: n }, (_, i) => makeCut(i + 1));
      const state = promptOutputToCanvasState(makePromptOutput(cuts));
      expect(state.nodes.length).toBe(n * 3);
      expect(state.edges.length).toBe(n * 2);
    }
  });

  it("should have correct node type distribution per cut", () => {
    const output = makePromptOutput([makeCut(1), makeCut(2)]);
    const state = promptOutputToCanvasState(output);

    const textNodes = state.nodes.filter(n => n.type === "text-input");
    const vidNodes = state.nodes.filter(n => n.type === "generate-video");
    const viewerNodes = state.nodes.filter(n => n.type === "viewer");

    expect(textNodes.length).toBe(2);
    expect(vidNodes.length).toBe(2);
    expect(viewerNodes.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. provenance 메타 포함
// ═══════════════════════════════════════════════════════════════════

describe("provenance metadata", () => {
  it("should have structured-sequence-import source on all nodes", () => {
    const output = makePromptOutput([makeCut(1)]);
    const state = promptOutputToCanvasState(output);

    for (const node of state.nodes) {
      const prov = node.provenance as { importMeta?: { source: string } };
      expect(prov).toBeDefined();
      expect(prov.importMeta).toBeDefined();
      expect(prov.importMeta!.source).toBe("structured-sequence-import");
    }
  });

  it("should include importedAt timestamp", () => {
    const before = Date.now();
    const output = makePromptOutput([makeCut(1)]);
    const state = promptOutputToCanvasState(output);
    const after = Date.now();

    for (const node of state.nodes) {
      const prov = node.provenance as { importMeta?: { importedAt: number } };
      expect(prov.importMeta!.importedAt).toBeGreaterThanOrEqual(before);
      expect(prov.importMeta!.importedAt).toBeLessThanOrEqual(after);
    }
  });

  it("should include cutNumber in provenance", () => {
    const output = makePromptOutput([makeCut(5)]);
    const state = promptOutputToCanvasState(output);

    for (const node of state.nodes) {
      const prov = node.provenance as { importMeta?: { cutNumber: number } };
      expect(prov.importMeta!.cutNumber).toBe(5);
    }
  });

  it("should include projectTitle in provenance", () => {
    const output = makePromptOutput([makeCut(1)]);
    output.projectTitle = "My Test Film";
    const state = promptOutputToCanvasState(output);

    const prov = state.nodes[0].provenance as { importMeta?: { projectTitle: string } };
    expect(prov.importMeta!.projectTitle).toBe("My Test Film");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. import 후 Viewer 연결 확인
// ═══════════════════════════════════════════════════════════════════

describe("viewer connection after import", () => {
  it("should connect video output to viewer input", () => {
    const output = makePromptOutput([makeCut(1)]);
    const state = promptOutputToCanvasState(output);

    const viewerNode = state.nodes.find(n => n.type === "viewer")!;
    const inputs = getInputAssets(state, viewerNode.id);

    // Viewer should have 1 input connected
    expect(inputs.length).toBe(1);
    // Connected but no output yet (not executed)
    expect(inputs[0].asset).toBeUndefined();
  });

  it("should show video output in viewer after execution", () => {
    const output = makePromptOutput([makeCut(1)]);
    let state = promptOutputToCanvasState(output);

    const vidNode = state.nodes.find(n => n.type === "generate-video")!;
    const viewerNode = state.nodes.find(n => n.type === "viewer")!;

    // Simulate video generation success
    state = updateNodeStatus(state, vidNode.id, "success", "https://example.com/video.mp4", "video");

    const inputs = getInputAssets(state, viewerNode.id);
    expect(inputs[0].asset).toBe("https://example.com/video.mp4");
    expect(inputs[0].mimeType).toBe("video");
  });

  it("should connect text output to video prompt input", () => {
    const output = makePromptOutput([makeCut(1)]);
    const state = promptOutputToCanvasState(output);

    const vidNode = state.nodes.find(n => n.type === "generate-video")!;
    const textNode = state.nodes.find(n => n.type === "text-input")!;

    // Video node should have text connected to prompt input
    const vidInputs = getInputAssets(state, vidNode.id);
    expect(vidInputs.length).toBe(2); // prompt + image

    // Text node output should be reachable
    const promptEdge = state.edges.find(e =>
      e.sourceNodeId === textNode.id && e.targetNodeId === vidNode.id
    );
    expect(promptEdge).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. 기존 빈 캔버스/저장된 캔버스와 충돌 없이 동작
// ═══════════════════════════════════════════════════════════════════

describe("no conflict with existing canvas", () => {
  it("should produce independent state from existing canvas", () => {
    // Existing canvas with a node
    const existingDef = NODE_REGISTRY.find(d => d.type === "generate-image")!;
    const existingNode = createNode(existingDef, 100, 100);
    let existing = createInitialCanvasState();
    existing = addNode(existing, existingNode);

    // Import creates completely new state
    const output = makePromptOutput([makeCut(1)]);
    const imported = promptOutputToCanvasState(output);

    // Existing state unchanged
    expect(existing.nodes.length).toBe(1);
    expect(existing.nodes[0].type).toBe("generate-image");

    // Imported state is separate
    expect(imported.nodes.length).toBe(3);
    expect(imported.nodes.every(n => n.id !== existingNode.id)).toBe(true);
  });

  it("should save imported state to localStorage without corruption", () => {
    const output = makePromptOutput([makeCut(1), makeCut(2)]);
    const imported = promptOutputToCanvasState(output);

    saveCanvasState(imported, createInitialViewport());

    const loaded = loadCanvasState();
    expect(loaded.canvas.nodes.length).toBe(6);
    expect(loaded.canvas.edges.length).toBe(4);
  });

  it("should work with cutToNodes for individual node creation", () => {
    const { textNode, vidNode, viewerNode } = cutToNodes(makeCut(1), 0);

    expect(textNode.type).toBe("text-input");
    expect(vidNode.type).toBe("generate-video");
    expect(viewerNode.type).toBe("viewer");

    const prov = textNode.provenance as { importMeta?: { source: string } };
    expect(prov.importMeta!.source).toBe("structured-sequence-import");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. import 후 fit/reset이 깨지지 않음
// ═══════════════════════════════════════════════════════════════════

describe("fit/reset after import", () => {
  it("should produce valid fitViewport for imported nodes", () => {
    const output = makePromptOutput([makeCut(1), makeCut(2), makeCut(3)]);
    const state = promptOutputToCanvasState(output);

    const vp = fitViewport(state.nodes, 800, 600);

    expect(vp.zoom).toBeGreaterThan(0);
    expect(vp.zoom).toBeLessThanOrEqual(3);
    expect(typeof vp.panX).toBe("number");
    expect(typeof vp.panY).toBe("number");
    expect(Number.isFinite(vp.panX)).toBe(true);
    expect(Number.isFinite(vp.panY)).toBe(true);
  });

  it("should fit all imported nodes within viewport", () => {
    const cuts = Array.from({ length: 10 }, (_, i) => makeCut(i + 1));
    const output = makePromptOutput(cuts);
    const state = promptOutputToCanvasState(output);

    // 10 cuts = 30 nodes spread vertically
    const vp = fitViewport(state.nodes, 1200, 800);

    // Zoom should be < 1 for many spread-out nodes
    expect(vp.zoom).toBeLessThan(1);
    expect(vp.zoom).toBeGreaterThan(0);
  });

  it("should auto-layout nodes left-to-right", () => {
    const output = makePromptOutput([makeCut(1)]);
    const state = promptOutputToCanvasState(output);

    const textNode = state.nodes.find(n => n.type === "text-input")!;
    const vidNode = state.nodes.find(n => n.type === "generate-video")!;
    const viewerNode = state.nodes.find(n => n.type === "viewer")!;

    // Left to right order
    expect(textNode.x).toBeLessThan(vidNode.x);
    expect(vidNode.x).toBeLessThan(viewerNode.x);
  });

  it("should layout cuts in vertical rows", () => {
    const output = makePromptOutput([makeCut(1), makeCut(2)]);
    const state = promptOutputToCanvasState(output);

    const textNodes = state.nodes.filter(n => n.type === "text-input");
    expect(textNodes[0].y).toBeLessThan(textNodes[1].y);
  });

  it("should not produce NaN or Infinity in node positions", () => {
    const output = makePromptOutput([makeCut(1), makeCut(2), makeCut(3)]);
    const state = promptOutputToCanvasState(output);

    for (const node of state.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });
});
