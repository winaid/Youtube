/**
 * node-execution.ts — 노드 실행 엔진
 *
 * 캔버스 노드를 실행하는 함수. 각 노드 타입에 맞는 API 호출을 수행한다.
 */

import {
  type CanvasState,
  type CanvasNode,
  updateNodeStatus,
  getInputAssets,
} from "@/lib/node-types";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ExecutionCallbacks {
  onStateChange: (updater: (state: CanvasState) => CanvasState) => void;
  onVideoOutputReady?: (nodeId: string, videoUrl: string) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function stripDataUri(dataUri: string): string {
  return dataUri.replace(/^data:[^;]+;base64,/, "");
}

// ═══════════════════════════════════════════════════════════════════
// Execute node
// ═══════════════════════════════════════════════════════════════════

export async function executeNode(
  nodeId: string,
  state: CanvasState,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;

  // Set running
  callbacks.onStateChange(s => updateNodeStatus(s, nodeId, "running"));

  try {
    switch (node.type) {
      case "generate-image":
        await executeGenerateImage(node, state, callbacks);
        break;
      case "generate-video":
        await executeGenerateVideo(node, state, callbacks);
        break;
      case "viewer":
        await executeViewer(node, state, callbacks);
        break;
      case "edit-image":
        await executeEditImage(node, state, callbacks);
        break;
      case "upscale-image":
        await executeUpscaleImage(node, state, callbacks);
        break;
      case "text-input":
        await executeTextInput(node, state, callbacks);
        break;
      default:
        callbacks.onStateChange(s => updateNodeStatus(s, nodeId, "failed", undefined, undefined, "미지원 노드 타입입니다."));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.onStateChange(s => updateNodeStatus(s, nodeId, "failed", undefined, undefined, msg));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Node executors
// ═══════════════════════════════════════════════════════════════════

async function executeGenerateImage(
  node: CanvasNode,
  state: CanvasState,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const prompt = (node.data.prompt as string) || "";
  if (!prompt.trim()) {
    callbacks.onStateChange(s => updateNodeStatus(s, node.id, "failed", undefined, undefined, "프롬프트를 입력해주세요."));
    return;
  }

  const body: Record<string, unknown> = {
    prompt,
    aspectRatio: node.data.aspectRatio ?? "16:9",
  };
  if (node.data.sceneDescription) body.sceneDescription = node.data.sceneDescription;
  if (node.data.animationMode) body.animationMode = node.data.animationMode;

  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "failed", undefined, undefined, `API 오류: ${res.status}`),
    );
    return;
  }

  const data = await res.json();
  if (data.error) {
    callbacks.onStateChange(s => updateNodeStatus(s, node.id, "failed", undefined, undefined, data.error));
    return;
  }

  if (!data.images || data.images.length === 0) {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "failed", undefined, undefined, "이미지를 생성하지 못했습니다."),
    );
    return;
  }

  const img = data.images[0];
  const dataUri = `data:${img.mimeType || "image/png"};base64,${img.base64}`;
  callbacks.onStateChange(s => updateNodeStatus(s, node.id, "success", dataUri, "image"));
}

async function executeGenerateVideo(
  node: CanvasNode,
  state: CanvasState,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const prompt = (node.data.prompt as string) || "";
  const inputs = getInputAssets(state, node.id);
  const imageInput = inputs.find(i => i.mimeType === "image");

  if (!prompt.trim() && !imageInput?.asset) {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "failed", undefined, undefined, "프롬프트 또는 이미지를 제공해주세요."),
    );
    return;
  }

  const body: Record<string, unknown> = {
    prompt,
    engine: "veo",
    durationSeconds: 8, // VEO 정책: 8초 고정 (node.data.durationSec 무시)
    aspectRatio: node.data.aspectRatio ?? "16:9",
  };

  if (imageInput?.asset) {
    body.firstFrameBase64 = stripDataUri(imageInput.asset);
  }

  const res = await fetch("/api/generate-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "failed", undefined, undefined, `API 오류: ${res.status}`),
    );
    return;
  }

  const data = await res.json();

  // Instant result (no polling needed)
  if (data.videoUrl) {
    callbacks.onStateChange(s => updateNodeStatus(s, node.id, "success", data.videoUrl, "video"));
    callbacks.onVideoOutputReady?.(node.id, data.videoUrl);
    return;
  }

  // Polling result
  const operationId = data.operationName || data.taskId;
  if (operationId) {
    const engine = data.engine || "veo";
    await pollVideoStatus(node.id, operationId, engine, callbacks);
  }
}

async function pollVideoStatus(
  nodeId: string,
  operationName: string,
  engine: string,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const POLL_INTERVAL = 5000;
  const MAX_POLLS = 60;

  let consecutiveErrors = 0;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

    let res: Response;
    try {
      res = await fetch("/api/check-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationName, engine }),
      });
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= 5) {
        callbacks.onStateChange(s =>
          updateNodeStatus(s, nodeId, "failed", undefined, undefined, "네트워크 오류로 상태 확인 실패"),
        );
        return;
      }
      continue;
    }

    if (!res.ok) {
      consecutiveErrors++;
      if (consecutiveErrors >= 5) {
        callbacks.onStateChange(s =>
          updateNodeStatus(s, nodeId, "failed", undefined, undefined, `상태 확인 실패 (HTTP ${res.status})`),
        );
        return;
      }
      continue;
    }
    consecutiveErrors = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
      data = await res.json();
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= 5) {
        callbacks.onStateChange(s =>
          updateNodeStatus(s, nodeId, "failed", undefined, undefined, "응답 파싱 실패"),
        );
        return;
      }
      continue;
    }

    if (data.status === "COMPLETED" && data.videoUri) {
      callbacks.onStateChange(s => updateNodeStatus(s, nodeId, "success", data.videoUri, "video"));
      callbacks.onVideoOutputReady?.(nodeId, data.videoUri);
      return;
    }

    if (data.status === "FAILED") {
      callbacks.onStateChange(s =>
        updateNodeStatus(s, nodeId, "failed", undefined, undefined, data.error || "영상 생성 실패"),
      );
      return;
    }
  }

  callbacks.onStateChange(s =>
    updateNodeStatus(s, nodeId, "failed", undefined, undefined, "영상 생성 시간 초과"),
  );
}

async function executeViewer(
  node: CanvasNode,
  state: CanvasState,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const inputs = getInputAssets(state, node.id);
  const input = inputs[0];

  if (input?.asset) {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "success", input.asset, input.mimeType),
    );
  } else {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "failed", undefined, undefined, "입력이 연결되지 않았습니다."),
    );
  }
}

async function executeEditImage(
  node: CanvasNode,
  state: CanvasState,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const inputs = getInputAssets(state, node.id);
  const imageInput = inputs.find(i => i.mimeType === "image");

  if (!imageInput?.asset) {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "failed", undefined, undefined, "입력 이미지가 연결되지 않았습니다."),
    );
    return;
  }

  const prompt = (node.data.prompt as string) || "";
  if (!prompt.trim()) {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "failed", undefined, undefined, "프롬프트를 입력해주세요."),
    );
    return;
  }

  const body: Record<string, unknown> = {
    prompt,
    referenceImage: stripDataUri(imageInput.asset),
    editMode: node.data.editMode ?? "inpaint",
  };

  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "failed", undefined, undefined, `API 오류: ${res.status}`),
    );
    return;
  }

  const data = await res.json();
  if (data.error) {
    callbacks.onStateChange(s => updateNodeStatus(s, node.id, "failed", undefined, undefined, data.error));
    return;
  }

  if (!data.images || data.images.length === 0) {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "failed", undefined, undefined, "이미지 편집 실패"),
    );
    return;
  }

  const img = data.images[0];
  const dataUri = `data:${img.mimeType || "image/png"};base64,${img.base64}`;
  callbacks.onStateChange(s => updateNodeStatus(s, node.id, "success", dataUri, "image"));
}

async function executeUpscaleImage(
  node: CanvasNode,
  state: CanvasState,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const inputs = getInputAssets(state, node.id);
  const imageInput = inputs.find(i => i.mimeType === "image");

  if (!imageInput?.asset) {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "failed", undefined, undefined, "입력 이미지가 연결되지 않았습니다."),
    );
    return;
  }

  const scale = (node.data.scale as number) || 2;
  const prompt = `Upscale this image to ${scale}x resolution with enhanced detail`;

  const body: Record<string, unknown> = {
    prompt,
    referenceImage: stripDataUri(imageInput.asset),
    editMode: "upscale",
  };

  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "failed", undefined, undefined, `API 오류: ${res.status}`),
    );
    return;
  }

  const data = await res.json();
  if (!data.images || data.images.length === 0) {
    callbacks.onStateChange(s =>
      updateNodeStatus(s, node.id, "failed", undefined, undefined, "업스케일 실패"),
    );
    return;
  }

  const img = data.images[0];
  const dataUri = `data:${img.mimeType || "image/png"};base64,${img.base64}`;
  callbacks.onStateChange(s => updateNodeStatus(s, node.id, "success", dataUri, "image"));
}

async function executeTextInput(
  node: CanvasNode,
  _state: CanvasState,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const text = (node.data.text as string) || "";
  callbacks.onStateChange(s => updateNodeStatus(s, node.id, "success", text));
}
