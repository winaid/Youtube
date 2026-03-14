/**
 * node-execution.test.ts — 노드 실행 엔진 테스트
 *
 * 테스트 대상:
 * 1. Generate Image → API 호출 & data URI 변환
 * 2. Generate Image → Viewer 연결 시 data URI 전달
 * 3. Generate Video → firstFrameBase64 전송
 * 4. Generate Video polling → POST /api/check-video
 * 5. Image → Video 파이프라인 (data URI → base64 스트리핑)
 * 6. Viewer 노드가 data URI 이미지를 표시
 * 7. 에러 케이스 (빈 프롬프트, API 실패 등)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeNode, type ExecutionCallbacks } from "@/lib/node-execution";
import {
  createInitialCanvasState,
  createNode,
  addNode,
  addEdge,
  updateNodeStatus,
  getInputAssets,
  NODE_REGISTRY,
  type CanvasState,
} from "@/lib/node-types";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function findDef(type: string) {
  return NODE_REGISTRY.find(d => d.type === type)!;
}

function makeCallbacks(): ExecutionCallbacks & { states: CanvasState[]; videoOutputs: { nodeId: string; videoUrl: string }[] } {
  let currentState = createInitialCanvasState();
  const states: CanvasState[] = [];
  const videoOutputs: { nodeId: string; videoUrl: string }[] = [];

  return {
    states,
    videoOutputs,
    onStateChange: (updater) => {
      currentState = updater(currentState);
      states.push(currentState);
    },
    onVideoOutputReady: (nodeId, videoUrl) => {
      videoOutputs.push({ nodeId, videoUrl });
    },
  };
}

function makeCallbacksWithState(initialState: CanvasState): ExecutionCallbacks & { getLatest: () => CanvasState; videoOutputs: { nodeId: string; videoUrl: string }[] } {
  let currentState = initialState;
  const videoOutputs: { nodeId: string; videoUrl: string }[] = [];

  return {
    videoOutputs,
    getLatest: () => currentState,
    onStateChange: (updater) => {
      currentState = updater(currentState);
    },
    onVideoOutputReady: (nodeId, videoUrl) => {
      videoOutputs.push({ nodeId, videoUrl });
    },
  };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════
// 1. Generate Image → API 호출 & data URI 변환
// ═══════════════════════════════════════════════════════════════════

describe("executeGenerateImage", () => {
  it("should convert API base64 response to data URI", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, { ...imgNode, data: { ...imgNode.data, prompt: "a cat" } });

    const callbacks = makeCallbacksWithState(state);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [{ base64: "iVBORw0KGgoAAAANS", mimeType: "image/png" }],
        source: "nano-banana-2",
      }),
    });

    await executeNode(imgNode.id, state, callbacks);

    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === imgNode.id)!;
    expect(node.status).toBe("success");
    expect(node.outputAsset).toBe("data:image/png;base64,iVBORw0KGgoAAAANS");
    expect(node.outputMimeType).toBe("image");

    // 올바른 API 경로 호출 확인
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("/api/generate-image");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.prompt).toBe("a cat");
    expect(body.aspectRatio).toBe("16:9");
  });

  it("should pass sceneDescription and animationMode to API", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, {
      ...imgNode,
      data: { ...imgNode.data, prompt: "sunset", sceneDescription: "ocean view", animationMode: "실사" },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ images: [{ base64: "abc", mimeType: "image/jpeg" }] }),
    });

    await executeNode(imgNode.id, state, makeCallbacksWithState(state));

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.sceneDescription).toBe("ocean view");
    expect(body.animationMode).toBe("실사");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Generate Image → Viewer 연결 시 data URI 전달
// ═══════════════════════════════════════════════════════════════════

describe("image to viewer data URI flow", () => {
  it("should pass data URI from generate-image to viewer via edge", () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const viewerNode = createNode(findDef("viewer"), 200, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, viewerNode);

    // image output → viewer input
    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, viewerNode.id, viewerNode.inputs[0].id);

    // simulate image generation success with data URI
    const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANS";
    state = updateNodeStatus(state, imgNode.id, "success", dataUri, "image");

    // viewer should receive data URI
    const inputs = getInputAssets(state, viewerNode.id);
    expect(inputs.length).toBe(1);
    expect(inputs[0].asset).toBe(dataUri);
    expect(inputs[0].mimeType).toBe("image");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Generate Video → firstFrameBase64 전송
// ═══════════════════════════════════════════════════════════════════

describe("executeGenerateVideo", () => {
  it("should send firstFrameBase64 with stripped data URI prefix", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const vidNode = createNode(findDef("generate-video"), 200, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, { ...vidNode, data: { ...vidNode.data, prompt: "animate this" } });

    // Connect image → video image input
    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, vidNode.id, vidNode.inputs[1].id);

    // Set image output as data URI
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,RAWBASE64DATA", "image");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        taskId: "kling-task-123",
        engine: "kling",
        status: "RUNNING",
      }),
    });

    // Mock polling too (will timeout but that's ok for this test)
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ taskId: "kling-task-123", engine: "kling", status: "RUNNING" }),
    });
    // Second call (polling) returns COMPLETED
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "COMPLETED", videoUri: "https://cdn.example.com/video.mp4" }),
    });

    const callbacks = makeCallbacksWithState(state);
    const executePromise = executeNode(vidNode.id, state, callbacks);

    // Advance timer to trigger first poll
    await vi.advanceTimersByTimeAsync(6000);
    await executePromise;

    // Check the generate-video call
    const generateCall = fetchMock.mock.calls[0];
    expect(generateCall[0]).toBe("/api/generate-video");
    const body = JSON.parse(generateCall[1].body);
    expect(body.firstFrameBase64).toBe("RAWBASE64DATA"); // data URI prefix stripped
    expect(body.engine).toBe("kling");
    expect(body.durationSeconds).toBe(6);
    expect(body.prompt).toBe("animate this");
    // Should NOT have imageUrl
    expect(body.imageUrl).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Generate Video polling → POST /api/check-video
// ═══════════════════════════════════════════════════════════════════

describe("video polling uses POST /api/check-video", () => {
  it("should poll with POST and { taskId, engine } body", async () => {
    const vidNode = createNode(findDef("generate-video"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, { ...vidNode, data: { ...vidNode.data, prompt: "ocean waves" } });

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    // First call: generate-video returns taskId
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ taskId: "task-abc", engine: "kling", status: "RUNNING" }),
    });
    // Second call: check-video returns RUNNING
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "RUNNING", progress: 50 }),
    });
    // Third call: check-video returns COMPLETED
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "COMPLETED", videoUri: "https://cdn.kling.com/video.mp4" }),
    });

    const callbacks = makeCallbacksWithState(state);
    const promise = executeNode(vidNode.id, state, callbacks);

    await vi.advanceTimersByTimeAsync(6000); // first poll
    await vi.advanceTimersByTimeAsync(6000); // second poll
    await promise;

    // Verify polling call uses POST to /api/check-video
    const pollCall = fetchMock.mock.calls[1];
    expect(pollCall[0]).toBe("/api/check-video");
    expect(pollCall[1].method).toBe("POST");
    const pollBody = JSON.parse(pollCall[1].body);
    expect(pollBody.taskId).toBe("task-abc");
    expect(pollBody.engine).toBe("kling");

    // Verify final state
    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === vidNode.id)!;
    expect(node.status).toBe("success");
    expect(node.outputAsset).toBe("https://cdn.kling.com/video.mp4");

    // Verify onVideoOutputReady was called
    expect(callbacks.videoOutputs.length).toBe(1);
    expect(callbacks.videoOutputs[0].videoUrl).toBe("https://cdn.kling.com/video.mp4");
  });

  it("should handle FAILED status from check-video", async () => {
    const vidNode = createNode(findDef("generate-video"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, { ...vidNode, data: { ...vidNode.data, prompt: "test" } });

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ taskId: "task-fail", status: "RUNNING" }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "FAILED", error: "Content policy violation" }),
    });

    const callbacks = makeCallbacksWithState(state);
    const promise = executeNode(vidNode.id, state, callbacks);

    await vi.advanceTimersByTimeAsync(6000);
    await promise;

    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === vidNode.id)!;
    expect(node.status).toBe("failed");
    expect(node.error).toBe("Content policy violation");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Image → Video 파이프라인 (data URI → base64 스트리핑)
// ═══════════════════════════════════════════════════════════════════

describe("image to video pipeline", () => {
  it("should strip various data URI prefixes correctly", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const vidNode = createNode(findDef("generate-video"), 200, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, { ...vidNode, data: { ...vidNode.data, prompt: "animate" } });
    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, vidNode.id, vidNode.inputs[1].id);

    // JPEG data URI
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/jpeg;base64,/9j/4AAQSkZ", "image");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ videoUrl: "https://instant-video.mp4" }),
    });
    globalThis.fetch = fetchMock;

    const callbacks = makeCallbacksWithState(state);
    await executeNode(vidNode.id, state, callbacks);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // data:image/jpeg;base64, prefix should be stripped
    expect(body.firstFrameBase64).toBe("/9j/4AAQSkZ");
    expect(body.firstFrameBase64).not.toContain("data:");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Viewer 노드가 data URI 이미지를 표시
// ═══════════════════════════════════════════════════════════════════

describe("viewer node with data URI", () => {
  it("should pass through data URI from connected image node", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const viewerNode = createNode(findDef("viewer"), 200, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, viewerNode);
    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, viewerNode.id, viewerNode.inputs[0].id);

    const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";
    state = updateNodeStatus(state, imgNode.id, "success", dataUri, "image");

    // Execute viewer — should passthrough the data URI
    const callbacks = makeCallbacksWithState(state);
    await executeNode(viewerNode.id, state, callbacks);

    const latest = callbacks.getLatest();
    const viewer = latest.nodes.find(n => n.id === viewerNode.id)!;
    expect(viewer.status).toBe("success");
    expect(viewer.outputAsset).toBe(dataUri);
    expect(viewer.outputMimeType).toBe("image");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. 에러 케이스
// ═══════════════════════════════════════════════════════════════════

describe("error cases", () => {
  it("should fail generate-image with empty prompt", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, imgNode); // prompt is "" by default

    const callbacks = makeCallbacksWithState(state);
    await executeNode(imgNode.id, state, callbacks);

    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === imgNode.id)!;
    expect(node.status).toBe("failed");
    expect(node.error).toContain("프롬프트");
  });

  it("should fail generate-image on HTTP error", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, { ...imgNode, data: { ...imgNode.data, prompt: "test" } });

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const callbacks = makeCallbacksWithState(state);
    await executeNode(imgNode.id, state, callbacks);

    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === imgNode.id)!;
    expect(node.status).toBe("failed");
    expect(node.error).toContain("500");
  });

  it("should fail generate-image when API returns error field", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, { ...imgNode, data: { ...imgNode.data, prompt: "test" } });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ images: [], error: "안전 필터에 의해 차단" }),
    });

    const callbacks = makeCallbacksWithState(state);
    await executeNode(imgNode.id, state, callbacks);

    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === imgNode.id)!;
    expect(node.status).toBe("failed");
    expect(node.error).toBe("안전 필터에 의해 차단");
  });

  it("should fail generate-video with no prompt and no image", async () => {
    const vidNode = createNode(findDef("generate-video"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, vidNode);

    const callbacks = makeCallbacksWithState(state);
    await executeNode(vidNode.id, state, callbacks);

    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === vidNode.id)!;
    expect(node.status).toBe("failed");
    expect(node.error).toContain("프롬프트");
  });

  it("should handle unsupported node type", async () => {
    let state = createInitialCanvasState();
    const fakeNode = {
      id: "fake-1",
      type: "unknown-type" as string,
      label: "Unknown",
      x: 0, y: 0,
      inputs: [], outputs: [],
      data: {},
      status: "idle" as const,
    };
    state = { ...state, nodes: [...state.nodes, fakeNode as never] };

    const callbacks = makeCallbacksWithState(state);
    await executeNode("fake-1", state, callbacks);

    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === "fake-1")!;
    expect(node.status).toBe("failed");
    expect(node.error).toContain("미지원");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Edit Image 노드 실행
// ═══════════════════════════════════════════════════════════════════

describe("executeEditImage", () => {
  it("should fail when no input image is connected", async () => {
    const editNode = createNode(findDef("edit-image"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, { ...editNode, data: { ...editNode.data, prompt: "remove background" } });

    const callbacks = makeCallbacksWithState(state);
    await executeNode(editNode.id, state, callbacks);

    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === editNode.id)!;
    expect(node.status).toBe("failed");
    expect(node.error).toContain("입력 이미지");
  });

  it("should fail when no prompt is provided", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const editNode = createNode(findDef("edit-image"), 300, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, editNode); // prompt is "" by default

    // Connect image → edit-image
    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, editNode.id, editNode.inputs[0].id);
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,ABC123", "image");

    const callbacks = makeCallbacksWithState(state);
    await executeNode(editNode.id, state, callbacks);

    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === editNode.id)!;
    expect(node.status).toBe("failed");
    expect(node.error).toContain("프롬프트");
  });

  it("should call /api/generate-image with referenceImage and editMode", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const editNode = createNode(findDef("edit-image"), 300, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, { ...editNode, data: { ...editNode.data, prompt: "add sunset sky", editMode: "inpaint" } });

    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, editNode.id, editNode.inputs[0].id);
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,RAWBASE64", "image");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [{ base64: "EDITEDBASE64", mimeType: "image/png" }],
      }),
    });

    const callbacks = makeCallbacksWithState(state);
    await executeNode(editNode.id, state, callbacks);

    // API 호출 검증
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("/api/generate-image");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.prompt).toBe("add sunset sky");
    expect(body.referenceImage).toBe("RAWBASE64");
    expect(body.editMode).toBe("inpaint");

    // 결과 검증
    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === editNode.id)!;
    expect(node.status).toBe("success");
    expect(node.outputAsset).toBe("data:image/png;base64,EDITEDBASE64");
    expect(node.outputMimeType).toBe("image");
  });

  it("should pass edited image output to downstream viewer", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const editNode = createNode(findDef("edit-image"), 300, 0);
    const viewerNode = createNode(findDef("viewer"), 600, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, { ...editNode, data: { ...editNode.data, prompt: "enhance colors" } });
    state = addNode(state, viewerNode);

    // image → edit-image → viewer
    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, editNode.id, editNode.inputs[0].id);
    state = addEdge(state, editNode.id, editNode.outputs[0].id, viewerNode.id, viewerNode.inputs[0].id);
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,ORIG", "image");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [{ base64: "EDITED", mimeType: "image/png" }],
      }),
    });

    const callbacks = makeCallbacksWithState(state);
    await executeNode(editNode.id, state, callbacks);

    // edit-image 실행 후 viewer가 결과를 받을 수 있는지 확인
    const latest = callbacks.getLatest();
    const inputs = getInputAssets(latest, viewerNode.id);
    expect(inputs[0].asset).toBe("data:image/png;base64,EDITED");
    expect(inputs[0].mimeType).toBe("image");
  });

  it("should handle API error gracefully", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const editNode = createNode(findDef("edit-image"), 300, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, { ...editNode, data: { ...editNode.data, prompt: "edit" } });

    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, editNode.id, editNode.inputs[0].id);
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,ABC", "image");

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const callbacks = makeCallbacksWithState(state);
    await executeNode(editNode.id, state, callbacks);

    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === editNode.id)!;
    expect(node.status).toBe("failed");
    expect(node.error).toContain("500");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Upscale Image 노드 실행
// ═══════════════════════════════════════════════════════════════════

describe("executeUpscaleImage", () => {
  it("upscale-image should be enabled in NODE_REGISTRY", () => {
    const def = findDef("upscale-image");
    expect(def).toBeDefined();
    expect(def.enabled).toBe(true);
    expect(def.category).toBe("image");
    expect(def.inputs).toHaveLength(1);
    expect(def.inputs[0].type).toBe("image");
    expect(def.outputs).toHaveLength(1);
    expect(def.outputs[0].type).toBe("image");
  });

  it("should fail when no input image is connected", async () => {
    const upNode = createNode(findDef("upscale-image"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, upNode);

    const callbacks = makeCallbacksWithState(state);
    await executeNode(upNode.id, state, callbacks);

    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === upNode.id)!;
    expect(node.status).toBe("failed");
    expect(node.error).toContain("입력 이미지");
  });

  it("should call /api/generate-image with referenceImage and editMode=upscale", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const upNode = createNode(findDef("upscale-image"), 300, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, upNode);

    // Connect image → upscale-image
    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, upNode.id, upNode.inputs[0].id);
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,RAWBASE64", "image");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [{ base64: "UPSCALEDBASE64", mimeType: "image/png" }],
      }),
    });

    const callbacks = makeCallbacksWithState(state);
    await executeNode(upNode.id, state, callbacks);

    // API 호출 검증
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("/api/generate-image");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.referenceImage).toBe("RAWBASE64");
    expect(body.editMode).toBe("upscale");
    expect(body.prompt).toContain("Upscale");

    // 결과 검증
    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === upNode.id)!;
    expect(node.status).toBe("success");
    expect(node.outputAsset).toBe("data:image/png;base64,UPSCALEDBASE64");
    expect(node.outputMimeType).toBe("image");
  });

  it("should pass upscaled output to downstream viewer", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const upNode = createNode(findDef("upscale-image"), 300, 0);
    const viewerNode = createNode(findDef("viewer"), 600, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, upNode);
    state = addNode(state, viewerNode);

    // image → upscale → viewer
    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, upNode.id, upNode.inputs[0].id);
    state = addEdge(state, upNode.id, upNode.outputs[0].id, viewerNode.id, viewerNode.inputs[0].id);
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,ORIG", "image");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [{ base64: "UPSCALED", mimeType: "image/png" }],
      }),
    });

    const callbacks = makeCallbacksWithState(state);
    await executeNode(upNode.id, state, callbacks);

    // upscale 실행 후 viewer가 결과를 받을 수 있는지 확인
    const latest = callbacks.getLatest();
    const inputs = getInputAssets(latest, viewerNode.id);
    expect(inputs[0].asset).toBe("data:image/png;base64,UPSCALED");
    expect(inputs[0].mimeType).toBe("image");
  });

  it("should handle API error gracefully", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const upNode = createNode(findDef("upscale-image"), 300, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, upNode);

    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, upNode.id, upNode.inputs[0].id);
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,ABC", "image");

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const callbacks = makeCallbacksWithState(state);
    await executeNode(upNode.id, state, callbacks);

    const latest = callbacks.getLatest();
    const node = latest.nodes.find(n => n.id === upNode.id)!;
    expect(node.status).toBe("failed");
    expect(node.error).toContain("500");
  });

  it("should include scale factor in upscale prompt", async () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const upNode = createNode(findDef("upscale-image"), 300, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, { ...upNode, data: { ...upNode.data, scale: 4 } });

    state = addEdge(state, imgNode.id, imgNode.outputs[0].id, upNode.id, upNode.inputs[0].id);
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,DATA", "image");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [{ base64: "UP4X", mimeType: "image/png" }],
      }),
    });

    const callbacks = makeCallbacksWithState(state);
    await executeNode(upNode.id, state, callbacks);

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.prompt).toContain("4x");
  });
});
