/**
 * node-canvas-viewport.test.ts — 캔버스 저장/복원 및 뷰포트 제어 테스트
 *
 * 테스트 대상:
 * 1. CanvasState 저장
 * 2. CanvasState 복원
 * 3. 손상된 저장 데이터 fallback
 * 4. 초기화 액션
 * 5. zoom in/out
 * 6. pan 이동
 * 7. fit/reset 동작
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createInitialCanvasState,
  createInitialViewport,
  createNode,
  addNode,
  addEdge,
  saveCanvasState,
  loadCanvasState,
  clearCanvasStorage,
  clampZoom,
  fitViewport,
  NODE_REGISTRY,
  ZOOM_MIN,
  ZOOM_MAX,
  type ViewportState,
} from "@/lib/node-types";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function findDef(type: string) {
  return NODE_REGISTRY.find(d => d.type === type)!;
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
// 1. CanvasState 저장
// ═══════════════════════════════════════════════════════════════════

describe("canvas state save", () => {
  it("should save canvas state and viewport to localStorage", () => {
    const imgNode = createNode(findDef("generate-image"), 100, 200);
    let state = createInitialCanvasState();
    state = addNode(state, imgNode);

    const viewport: ViewportState = { zoom: 1.5, panX: 50, panY: -30 };
    saveCanvasState(state, viewport);

    expect(store["node-canvas-state"]).toBeDefined();
    expect(store["node-canvas-viewport"]).toBeDefined();

    const savedCanvas = JSON.parse(store["node-canvas-state"]);
    expect(savedCanvas.nodes.length).toBe(1);
    expect(savedCanvas.nodes[0].x).toBe(100);
    expect(savedCanvas.nodes[0].y).toBe(200);
    expect(savedCanvas.edges.length).toBe(0);

    const savedViewport = JSON.parse(store["node-canvas-viewport"]);
    expect(savedViewport.zoom).toBe(1.5);
    expect(savedViewport.panX).toBe(50);
    expect(savedViewport.panY).toBe(-30);
  });

  it("should exclude pendingEdge from saved state", () => {
    let state = createInitialCanvasState();
    state = {
      ...state,
      pendingEdge: { sourceNodeId: "n1", sourcePortId: "p1", mouseX: 100, mouseY: 200 },
    };

    saveCanvasState(state, createInitialViewport());

    const saved = JSON.parse(store["node-canvas-state"]);
    expect(saved.pendingEdge).toBeUndefined();
  });

  it("should save edges along with nodes", () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const vidNode = createNode(findDef("generate-video"), 300, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, vidNode);
    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, vidNode.id, vidNode.inputs[1].id);

    saveCanvasState(state, createInitialViewport());

    const saved = JSON.parse(store["node-canvas-state"]);
    expect(saved.edges.length).toBe(1);
    expect(saved.edges[0].sourceNodeId).toBe(imgNode.id);
    expect(saved.edges[0].targetNodeId).toBe(vidNode.id);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. CanvasState 복원
// ═══════════════════════════════════════════════════════════════════

describe("canvas state restore", () => {
  it("should restore saved canvas state and viewport", () => {
    const imgNode = createNode(findDef("generate-image"), 150, 250);
    let state = createInitialCanvasState();
    state = addNode(state, imgNode);

    const viewport: ViewportState = { zoom: 2, panX: 100, panY: -50 };
    saveCanvasState(state, viewport);

    const loaded = loadCanvasState();
    expect(loaded.canvas.nodes.length).toBe(1);
    expect(loaded.canvas.nodes[0].x).toBe(150);
    expect(loaded.canvas.nodes[0].y).toBe(250);
    expect(loaded.canvas.nodes[0].type).toBe("generate-image");
    expect(loaded.viewport.zoom).toBe(2);
    expect(loaded.viewport.panX).toBe(100);
    expect(loaded.viewport.panY).toBe(-50);
  });

  it("should return initial state when no saved data", () => {
    const loaded = loadCanvasState();
    expect(loaded.canvas.nodes.length).toBe(0);
    expect(loaded.canvas.edges.length).toBe(0);
    expect(loaded.viewport.zoom).toBe(1);
    expect(loaded.viewport.panX).toBe(0);
    expect(loaded.viewport.panY).toBe(0);
  });

  it("should restore edges and selectedNodeId", () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const vidNode = createNode(findDef("generate-video"), 300, 0);
    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, vidNode);
    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, vidNode.id, vidNode.inputs[1].id);
    // selectedNodeId is vidNode (last added)
    expect(state.selectedNodeId).toBe(vidNode.id);

    saveCanvasState(state, createInitialViewport());

    const loaded = loadCanvasState();
    expect(loaded.canvas.edges.length).toBe(1);
    expect(loaded.canvas.selectedNodeId).toBe(vidNode.id);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. 손상된 저장 데이터 fallback
// ═══════════════════════════════════════════════════════════════════

describe("corrupted data fallback", () => {
  it("should fallback to initial state on invalid JSON", () => {
    store["node-canvas-state"] = "not valid json {{{";
    const loaded = loadCanvasState();
    expect(loaded.canvas.nodes.length).toBe(0);
    expect(loaded.canvas.edges.length).toBe(0);
    expect(loaded.viewport.zoom).toBe(1);
  });

  it("should fallback when nodes is not an array", () => {
    store["node-canvas-state"] = JSON.stringify({ nodes: "not array", edges: [] });
    const loaded = loadCanvasState();
    expect(loaded.canvas.nodes.length).toBe(0);
  });

  it("should fallback when edges is not an array", () => {
    store["node-canvas-state"] = JSON.stringify({ nodes: [], edges: null });
    const loaded = loadCanvasState();
    expect(loaded.canvas.edges.length).toBe(0);
  });

  it("should use default viewport when viewport data is corrupted", () => {
    const imgNode = createNode(findDef("generate-image"), 50, 50);
    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    saveCanvasState(state, createInitialViewport());

    // Corrupt the viewport
    store["node-canvas-viewport"] = "broken!!!";

    const loaded = loadCanvasState();
    expect(loaded.canvas.nodes.length).toBe(1); // canvas still loads
    expect(loaded.viewport.zoom).toBe(1); // default viewport
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. 초기화 액션
// ═══════════════════════════════════════════════════════════════════

describe("reset / clear canvas", () => {
  it("should clear localStorage on clearCanvasStorage", () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    saveCanvasState(state, { zoom: 2, panX: 100, panY: 200 });

    expect(store["node-canvas-state"]).toBeDefined();
    expect(store["node-canvas-viewport"]).toBeDefined();

    clearCanvasStorage();

    expect(store["node-canvas-state"]).toBeUndefined();
    expect(store["node-canvas-viewport"]).toBeUndefined();
  });

  it("should return empty state after clear and reload", () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    saveCanvasState(state, createInitialViewport());

    clearCanvasStorage();
    const loaded = loadCanvasState();
    expect(loaded.canvas.nodes.length).toBe(0);
    expect(loaded.viewport.zoom).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. zoom in/out
// ═══════════════════════════════════════════════════════════════════

describe("zoom in/out", () => {
  it("should clamp zoom to min/max", () => {
    expect(clampZoom(0.05)).toBe(ZOOM_MIN);
    expect(clampZoom(5)).toBe(ZOOM_MAX);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it("should clamp zoom at boundaries", () => {
    expect(clampZoom(ZOOM_MIN - 0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(ZOOM_MAX + 0.01)).toBe(ZOOM_MAX);
  });

  it("should allow zoom within valid range", () => {
    const values = [0.1, 0.5, 1, 1.5, 2, 2.5, 3];
    for (const v of values) {
      expect(clampZoom(v)).toBe(v);
    }
  });

  it("should persist zoom value via save/load", () => {
    saveCanvasState(createInitialCanvasState(), { zoom: 2.5, panX: 0, panY: 0 });
    const loaded = loadCanvasState();
    expect(loaded.viewport.zoom).toBe(2.5);
  });

  it("should clamp restored zoom to valid range", () => {
    store["node-canvas-state"] = JSON.stringify({ nodes: [], edges: [], selectedNodeId: null });
    store["node-canvas-viewport"] = JSON.stringify({ zoom: 999, panX: 0, panY: 0 });
    const loaded = loadCanvasState();
    expect(loaded.viewport.zoom).toBe(ZOOM_MAX);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. pan 이동
// ═══════════════════════════════════════════════════════════════════

describe("pan movement", () => {
  it("should create initial viewport at origin", () => {
    const vp = createInitialViewport();
    expect(vp.panX).toBe(0);
    expect(vp.panY).toBe(0);
    expect(vp.zoom).toBe(1);
  });

  it("should persist pan values via save/load", () => {
    saveCanvasState(createInitialCanvasState(), { zoom: 1, panX: -300, panY: 150 });
    const loaded = loadCanvasState();
    expect(loaded.viewport.panX).toBe(-300);
    expect(loaded.viewport.panY).toBe(150);
  });

  it("should allow negative pan values", () => {
    const viewport: ViewportState = { zoom: 1, panX: -500, panY: -200 };
    saveCanvasState(createInitialCanvasState(), viewport);
    const loaded = loadCanvasState();
    expect(loaded.viewport.panX).toBe(-500);
    expect(loaded.viewport.panY).toBe(-200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. fit/reset 동작
// ═══════════════════════════════════════════════════════════════════

describe("fit to screen / reset view", () => {
  it("should return default viewport for empty canvas", () => {
    const vp = fitViewport([], 800, 600);
    expect(vp.zoom).toBe(1);
    expect(vp.panX).toBe(0);
    expect(vp.panY).toBe(0);
  });

  it("should fit single node to container", () => {
    const node = createNode(findDef("generate-image"), 500, 500);
    const vp = fitViewport([node], 800, 600);

    // zoom should be positive and within bounds
    expect(vp.zoom).toBeGreaterThan(0);
    expect(vp.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    // pan should position the node visible
    expect(typeof vp.panX).toBe("number");
    expect(typeof vp.panY).toBe("number");
  });

  it("should fit multiple spread-out nodes", () => {
    const n1 = createNode(findDef("generate-image"), 0, 0);
    const n2 = createNode(findDef("generate-video"), 2000, 0);
    const n3 = createNode(findDef("viewer"), 1000, 1500);

    const vp = fitViewport([n1, n2, n3], 800, 600);

    // zoom should be small to fit spread-out nodes
    expect(vp.zoom).toBeLessThan(1);
    expect(vp.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
  });

  it("should fit closely clustered nodes with higher zoom", () => {
    const n1 = createNode(findDef("generate-image"), 100, 100);
    const n2 = createNode(findDef("viewer"), 150, 100);

    const vpClose = fitViewport([n1, n2], 800, 600);

    const n3 = createNode(findDef("generate-image"), 0, 0);
    const n4 = createNode(findDef("viewer"), 3000, 2000);

    const vpFar = fitViewport([n3, n4], 800, 600);

    expect(vpClose.zoom).toBeGreaterThan(vpFar.zoom);
  });

  it("reset view should return to identity", () => {
    const vp = createInitialViewport();
    expect(vp.zoom).toBe(1);
    expect(vp.panX).toBe(0);
    expect(vp.panY).toBe(0);
  });
});
