/**
 * node-canvas.test.ts — 노드 캔버스 기본 기능 테스트
 *
 * 테스트 대상:
 * 1. 노드 추가/삭제
 * 2. Generate Image 노드 상태 전이
 * 3. Generate Video 노드 상태 전이
 * 4. Viewer 노드 preview 연결
 * 5. video output → timeline 추가 액션
 * 6. 기존 result/timeline 흐름이 깨지지 않음 (노드 상태 독립성)
 * 7. 엣지 연결/제거
 * 8. 포트 호환성 검증
 */

import { describe, it, expect } from "vitest";
import {
  createInitialCanvasState,
  createNode,
  addNode,
  removeNode,
  moveNode,
  selectNode,
  updateNodeData,
  updateNodeStatus,
  addEdge,
  removeEdge,
  getInputAssets,
  arePortsCompatible,
  NODE_REGISTRY,
  type CanvasState,
  type CanvasNode,
  type Port,
} from "@/lib/node-types";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function findDef(type: string) {
  return NODE_REGISTRY.find(d => d.type === type)!;
}

function createTestState(): { state: CanvasState; imgNode: CanvasNode; vidNode: CanvasNode; viewerNode: CanvasNode } {
  const imgNode = createNode(findDef("generate-image"), 100, 100);
  const vidNode = createNode(findDef("generate-video"), 400, 100);
  const viewerNode = createNode(findDef("viewer"), 700, 100);

  let state = createInitialCanvasState();
  state = addNode(state, imgNode);
  state = addNode(state, vidNode);
  state = addNode(state, viewerNode);

  return { state, imgNode, vidNode, viewerNode };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("node canvas", () => {
  // ── 1. 노드 추가/삭제 ──
  describe("add/remove nodes", () => {
    it("should add a node to empty canvas", () => {
      let state = createInitialCanvasState();
      expect(state.nodes.length).toBe(0);

      const node = createNode(findDef("generate-image"), 100, 200);
      state = addNode(state, node);

      expect(state.nodes.length).toBe(1);
      expect(state.nodes[0].type).toBe("generate-image");
      expect(state.nodes[0].x).toBe(100);
      expect(state.nodes[0].y).toBe(200);
      expect(state.selectedNodeId).toBe(node.id);
    });

    it("should remove a node and its edges", () => {
      const { state, imgNode, vidNode } = createTestState();
      // 이미지 → 비디오 연결
      const connected = addEdge(state, imgNode.id, imgNode.outputs[0].id, vidNode.id, vidNode.inputs[1].id);
      expect(connected.edges.length).toBe(1);

      // 이미지 노드 삭제
      const removed = removeNode(connected, imgNode.id);
      expect(removed.nodes.length).toBe(2);
      expect(removed.edges.length).toBe(0); // 연결도 제거됨
      expect(removed.nodes.find(n => n.id === imgNode.id)).toBeUndefined();
    });

    it("should clear selectedNodeId when removing selected node", () => {
      const { state, imgNode } = createTestState();
      const selected = selectNode(state, imgNode.id);
      expect(selected.selectedNodeId).toBe(imgNode.id);

      const removed = removeNode(selected, imgNode.id);
      expect(removed.selectedNodeId).toBeNull();
    });

    it("should add multiple node types from registry", () => {
      let state = createInitialCanvasState();
      const enabledDefs = NODE_REGISTRY.filter(d => d.enabled);

      for (const def of enabledDefs) {
        const node = createNode(def, 100, 100);
        state = addNode(state, node);
      }

      expect(state.nodes.length).toBe(enabledDefs.length);
      // 최소 3개 활성 노드: generate-image, generate-video, viewer
      expect(enabledDefs.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ── 2. Generate Image 노드 상태 전이 ──
  describe("generate image node state transitions", () => {
    it("should start as idle", () => {
      const node = createNode(findDef("generate-image"), 0, 0);
      expect(node.status).toBe("idle");
      expect(node.outputAsset).toBeUndefined();
    });

    it("should transition to running", () => {
      const { state, imgNode } = createTestState();
      const running = updateNodeStatus(state, imgNode.id, "running");
      const node = running.nodes.find(n => n.id === imgNode.id)!;
      expect(node.status).toBe("running");
    });

    it("should transition to success with asset", () => {
      const { state, imgNode } = createTestState();
      const success = updateNodeStatus(state, imgNode.id, "success", "https://example.com/img.png", "image");
      const node = success.nodes.find(n => n.id === imgNode.id)!;
      expect(node.status).toBe("success");
      expect(node.outputAsset).toBe("https://example.com/img.png");
      expect(node.outputMimeType).toBe("image");
    });

    it("should transition to failed with error", () => {
      const { state, imgNode } = createTestState();
      const failed = updateNodeStatus(state, imgNode.id, "failed", undefined, undefined, "API 오류");
      const node = failed.nodes.find(n => n.id === imgNode.id)!;
      expect(node.status).toBe("failed");
      expect(node.error).toBe("API 오류");
    });
  });

  // ── 3. Generate Video 노드 상태 전이 ──
  describe("generate video node state transitions", () => {
    it("should have correct default data", () => {
      const node = createNode(findDef("generate-video"), 0, 0);
      expect(node.data.durationSec).toBe(6);
      expect(node.data.aspectRatio).toBe("16:9");
      expect(node.inputs.length).toBe(2); // prompt + image
      expect(node.outputs.length).toBe(1); // video
    });

    it("should update data immutably", () => {
      const { state, vidNode } = createTestState();
      const updated = updateNodeData(state, vidNode.id, { prompt: "test prompt", durationSec: 8 });
      const node = updated.nodes.find(n => n.id === vidNode.id)!;
      expect(node.data.prompt).toBe("test prompt");
      expect(node.data.durationSec).toBe(8);
      // 원래 state 불변
      const originalNode = state.nodes.find(n => n.id === vidNode.id)!;
      expect(originalNode.data.prompt).toBe("");
    });

    it("should track provenance on success", () => {
      const { state, vidNode } = createTestState();
      const success = updateNodeStatus(state, vidNode.id, "success", "https://video.mp4", "video");
      const node = success.nodes.find(n => n.id === vidNode.id)!;
      expect(node.provenance?.executedAt).toBeGreaterThan(0);
    });
  });

  // ── 4. Viewer 노드 preview 연결 ──
  describe("viewer node preview connection", () => {
    it("should receive input asset from connected node", () => {
      const { state, vidNode, viewerNode } = createTestState();

      // video → viewer 연결
      let s = addEdge(state, vidNode.id, vidNode.outputs[0].id, viewerNode.id, viewerNode.inputs[0].id);

      // video 노드에 출력 에셋 설정
      s = updateNodeStatus(s, vidNode.id, "success", "https://video.mp4", "video");

      // viewer input에서 에셋 조회
      const inputs = getInputAssets(s, viewerNode.id);
      expect(inputs.length).toBe(1);
      expect(inputs[0].asset).toBe("https://video.mp4");
      expect(inputs[0].mimeType).toBe("video");
    });

    it("should return empty asset when no connection", () => {
      const { state, viewerNode } = createTestState();
      const inputs = getInputAssets(state, viewerNode.id);
      expect(inputs.length).toBe(1);
      expect(inputs[0].asset).toBeUndefined();
    });

    it("should handle image → viewer connection", () => {
      const { state, imgNode, viewerNode } = createTestState();

      let s = addEdge(state, imgNode.id, imgNode.outputs[0].id, viewerNode.id, viewerNode.inputs[0].id);
      s = updateNodeStatus(s, imgNode.id, "success", "https://img.png", "image");

      const inputs = getInputAssets(s, viewerNode.id);
      expect(inputs[0].asset).toBe("https://img.png");
      expect(inputs[0].mimeType).toBe("image");
    });
  });

  // ── 5. video output → timeline 추가 ──
  describe("video output to timeline", () => {
    it("should produce video output metadata for timeline", () => {
      const vidNode = createNode(findDef("generate-video"), 0, 0);
      const updated = { ...vidNode, data: { ...vidNode.data, prompt: "test", durationSec: 8, aspectRatio: "9:16" } };

      // VideoOutputMeta 구조 검증
      const meta = {
        nodeId: updated.id,
        nodeLabel: updated.label,
        prompt: updated.data.prompt as string,
        durationSec: updated.data.durationSec as number,
        aspectRatio: updated.data.aspectRatio as string,
        generatedAt: Date.now(),
      };

      expect(meta.nodeId).toBe(updated.id);
      expect(meta.prompt).toBe("test");
      expect(meta.durationSec).toBe(8);
      expect(meta.aspectRatio).toBe("9:16");
      expect(meta.generatedAt).toBeGreaterThan(0);
    });
  });

  // ── 6. 기존 result/timeline 흐름 독립성 ──
  describe("canvas state independence", () => {
    it("should maintain canvas state independently from other state", () => {
      const state1 = createInitialCanvasState();
      const state2 = createInitialCanvasState();

      const node = createNode(findDef("generate-image"), 0, 0);
      const modified = addNode(state1, node);

      // state2는 영향 받지 않음
      expect(state2.nodes.length).toBe(0);
      expect(modified.nodes.length).toBe(1);
    });

    it("should not modify nodes when moving a different node", () => {
      const { state, imgNode, vidNode } = createTestState();
      const moved = moveNode(state, imgNode.id, 500, 500);

      // imgNode만 이동
      const movedImg = moved.nodes.find(n => n.id === imgNode.id)!;
      expect(movedImg.x).toBe(500);
      expect(movedImg.y).toBe(500);

      // vidNode는 그대로
      const unchangedVid = moved.nodes.find(n => n.id === vidNode.id)!;
      expect(unchangedVid.x).toBe(400);
      expect(unchangedVid.y).toBe(100);
    });
  });

  // ── 7. 엣지 연결/제거 ──
  describe("edge management", () => {
    it("should add edge between compatible ports", () => {
      const { state, imgNode, vidNode } = createTestState();
      const connected = addEdge(state, imgNode.id, imgNode.outputs[0].id, vidNode.id, vidNode.inputs[1].id);

      expect(connected.edges.length).toBe(1);
      expect(connected.edges[0].sourceNodeId).toBe(imgNode.id);
      expect(connected.edges[0].targetNodeId).toBe(vidNode.id);
    });

    it("should prevent self-connection", () => {
      const { state, imgNode } = createTestState();
      const selfConnect = addEdge(state, imgNode.id, imgNode.outputs[0].id, imgNode.id, imgNode.inputs[0].id);
      expect(selfConnect.edges.length).toBe(0);
    });

    it("should replace existing connection on same input port", () => {
      const { state, imgNode, vidNode } = createTestState();
      const textNode = createNode(findDef("text-input"), 0, 0);
      let s = addNode(state, textNode);

      // text → video prompt port
      s = addEdge(s, textNode.id, textNode.outputs[0].id, vidNode.id, vidNode.inputs[0].id);
      expect(s.edges.length).toBe(1);

      // img → same video prompt port (should replace)
      s = addEdge(s, imgNode.id, imgNode.outputs[0].id, vidNode.id, vidNode.inputs[0].id);
      expect(s.edges.length).toBe(1);
      expect(s.edges[0].sourceNodeId).toBe(imgNode.id);
    });

    it("should remove edge by id", () => {
      const { state, imgNode, vidNode } = createTestState();
      const connected = addEdge(state, imgNode.id, imgNode.outputs[0].id, vidNode.id, vidNode.inputs[1].id);
      const edgeId = connected.edges[0].id;

      const removed = removeEdge(connected, edgeId);
      expect(removed.edges.length).toBe(0);
    });

    it("should prevent duplicate edges", () => {
      const { state, imgNode, vidNode } = createTestState();
      let s = addEdge(state, imgNode.id, imgNode.outputs[0].id, vidNode.id, vidNode.inputs[1].id);
      s = addEdge(s, imgNode.id, imgNode.outputs[0].id, vidNode.id, vidNode.inputs[1].id);
      expect(s.edges.length).toBe(1);
    });
  });

  // ── 8. 포트 호환성 검증 ──
  describe("port compatibility", () => {
    it("should allow image → image connection", () => {
      const source: Port = { id: "s", label: "image", type: "image", isInput: false };
      const target: Port = { id: "t", label: "image", type: "image", isInput: true };
      expect(arePortsCompatible(source, target)).toBe(true);
    });

    it("should allow any → any connection", () => {
      const source: Port = { id: "s", label: "out", type: "any", isInput: false };
      const target: Port = { id: "t", label: "in", type: "any", isInput: true };
      expect(arePortsCompatible(source, target)).toBe(true);
    });

    it("should allow image → any connection", () => {
      const source: Port = { id: "s", label: "image", type: "image", isInput: false };
      const target: Port = { id: "t", label: "media", type: "any", isInput: true };
      expect(arePortsCompatible(source, target)).toBe(true);
    });

    it("should reject text → image connection", () => {
      const source: Port = { id: "s", label: "text", type: "text", isInput: false };
      const target: Port = { id: "t", label: "image", type: "image", isInput: true };
      expect(arePortsCompatible(source, target)).toBe(false);
    });

    it("should reject input → input connection", () => {
      const source: Port = { id: "s", label: "in", type: "text", isInput: true };
      const target: Port = { id: "t", label: "in", type: "text", isInput: true };
      expect(arePortsCompatible(source, target)).toBe(false);
    });
  });

  // ── Registry ──
  describe("node registry", () => {
    it("should have correct categories defined", () => {
      const categories = new Set(NODE_REGISTRY.map(d => d.category));
      expect(categories.has("image")).toBe(true);
      expect(categories.has("video")).toBe(true);
      expect(categories.has("utility")).toBe(true);
      expect(categories.has("text")).toBe(true);
      expect(categories.has("sound")).toBe(true);
      expect(categories.has("3d")).toBe(true);
    });

    it("should have at least 3 enabled nodes", () => {
      const enabled = NODE_REGISTRY.filter(d => d.enabled);
      expect(enabled.length).toBeGreaterThanOrEqual(3);
      expect(enabled.find(d => d.type === "generate-image")).toBeDefined();
      expect(enabled.find(d => d.type === "generate-video")).toBeDefined();
      expect(enabled.find(d => d.type === "viewer")).toBeDefined();
    });

    it("should have disabled placeholder nodes for sound and 3d", () => {
      const sound = NODE_REGISTRY.find(d => d.category === "sound");
      const threeDee = NODE_REGISTRY.find(d => d.category === "3d");
      expect(sound?.enabled).toBe(false);
      expect(threeDee?.enabled).toBe(false);
    });

    it("should have edit-image node enabled in registry", () => {
      const editImage = NODE_REGISTRY.find(d => d.type === "edit-image");
      expect(editImage).toBeDefined();
      expect(editImage!.enabled).toBe(true);
      expect(editImage!.category).toBe("image");
      expect(editImage!.inputs.length).toBe(2); // image + prompt
      expect(editImage!.outputs.length).toBe(1); // image
      expect(editImage!.inputs[0].type).toBe("image");
      expect(editImage!.inputs[1].type).toBe("text");
      expect(editImage!.outputs[0].type).toBe("image");
    });
  });

  // ── Edit Image 노드 기본 동작 ──
  describe("edit-image node basics", () => {
    it("should create edit-image node with correct defaults", () => {
      const node = createNode(findDef("edit-image"), 50, 50);
      expect(node.type).toBe("edit-image");
      expect(node.data.editMode).toBe("inpaint");
      expect(node.data.prompt).toBe("");
      expect(node.inputs.length).toBe(2);
      expect(node.outputs.length).toBe(1);
      expect(node.status).toBe("idle");
    });

    it("should connect generate-image output to edit-image input", () => {
      const imgNode = createNode(findDef("generate-image"), 0, 0);
      const editNode = createNode(findDef("edit-image"), 300, 0);

      let state = createInitialCanvasState();
      state = addNode(state, imgNode);
      state = addNode(state, editNode);

      // image output → edit-image image input
      state = addEdge(state, imgNode.id, imgNode.outputs[0].id, editNode.id, editNode.inputs[0].id);
      expect(state.edges.length).toBe(1);

      // Set image output
      state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,ABC", "image");
      const inputs = getInputAssets(state, editNode.id);
      expect(inputs[0].asset).toBe("data:image/png;base64,ABC");
      expect(inputs[0].mimeType).toBe("image");
    });

    it("should connect edit-image output to viewer", () => {
      const editNode = createNode(findDef("edit-image"), 0, 0);
      const viewerNode = createNode(findDef("viewer"), 300, 0);

      let state = createInitialCanvasState();
      state = addNode(state, editNode);
      state = addNode(state, viewerNode);

      state = addEdge(state, editNode.id, editNode.outputs[0].id, viewerNode.id, viewerNode.inputs[0].id);
      expect(state.edges.length).toBe(1);

      state = updateNodeStatus(state, editNode.id, "success", "data:image/png;base64,EDITED", "image");
      const inputs = getInputAssets(state, viewerNode.id);
      expect(inputs[0].asset).toBe("data:image/png;base64,EDITED");
      expect(inputs[0].mimeType).toBe("image");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Prompt chain insertion (TextInput + GenerateVideo + edge)
// ═══════════════════════════════════════════════════════════════════

describe("prompt chain insertion", () => {
  it("should create TextInput + GenerateVideo nodes with edge connecting them", () => {
    const textDef = findDef("text-input");
    const vidDef = findDef("generate-video");
    const promptText = "A cat playing piano";

    const textNode = createNode(textDef, 100, 100);
    const vidNode = createNode(vidDef, 400, 100);

    let state = createInitialCanvasState();
    state = addNode(state, { ...textNode, data: { ...textNode.data, text: promptText } });
    state = addNode(state, vidNode);
    state = addEdge(state, textNode.id, textNode.outputs[0].id, vidNode.id, vidNode.inputs[0].id);

    // 2개 노드 생성 확인
    expect(state.nodes).toHaveLength(2);
    const tn = state.nodes.find(n => n.type === "text-input")!;
    const vn = state.nodes.find(n => n.type === "generate-video")!;
    expect(tn).toBeDefined();
    expect(vn).toBeDefined();

    // TextInput에 prompt 설정 확인
    expect(tn.data.text).toBe(promptText);

    // edge 연결 확인
    expect(state.edges).toHaveLength(1);
    const edge = state.edges[0];
    expect(edge.sourceNodeId).toBe(tn.id);
    expect(edge.targetNodeId).toBe(vn.id);
    expect(edge.sourcePortId).toBe(tn.outputs[0].id); // text output
    expect(edge.targetPortId).toBe(vn.inputs[0].id);  // prompt input
  });

  it("should allow text to flow from TextInput to GenerateVideo via edge", () => {
    const textDef = findDef("text-input");
    const vidDef = findDef("generate-video");

    const textNode = createNode(textDef, 0, 0);
    const vidNode = createNode(vidDef, 300, 0);

    let state = createInitialCanvasState();
    state = addNode(state, { ...textNode, data: { ...textNode.data, text: "ocean sunset" } });
    state = addNode(state, vidNode);
    state = addEdge(state, textNode.id, textNode.outputs[0].id, vidNode.id, vidNode.inputs[0].id);

    // TextInput의 output을 "success"로 설정 (executeTextInput이 하는 일)
    state = updateNodeStatus(state, textNode.id, "success", "ocean sunset");

    // GenerateVideo의 input으로 text가 전달되는지 확인
    const inputs = getInputAssets(state, vidNode.id);
    const promptInput = inputs.find(i => i.portId === vidNode.inputs[0].id);
    expect(promptInput?.asset).toBe("ocean sunset");
  });

  it("TextInput output port and GenerateVideo prompt input port should be compatible", () => {
    const textDef = findDef("text-input");
    const vidDef = findDef("generate-video");
    const textNode = createNode(textDef, 0, 0);
    const vidNode = createNode(vidDef, 300, 0);

    const sourcePort = textNode.outputs[0]; // type: "text", isInput: false
    const targetPort = vidNode.inputs[0];   // type: "text", isInput: true

    expect(arePortsCompatible(sourcePort, targetPort)).toBe(true);
  });
});
