/**
 * node-execution.ts — 노드 실행 엔진
 *
 * 역할:
 *  - 노드 타입별 실행 로직
 *  - Generate Image: /api/generate-image 호출
 *  - Generate Video: /api/generate-video 호출 (기존 Kling 파이프라인 연동)
 *  - Viewer: 입력 에셋 패스스루
 *  - Text Input: data.text를 output으로 전달
 */

import type { CanvasState, CanvasNode } from "./node-types";
import { updateNodeStatus, getInputAssets } from "./node-types";

// ═══════════════════════════════════════════════════════════════════
// Execution Context
// ═══════════════════════════════════════════════════════════════════

export interface ExecutionCallbacks {
  onStateChange: (updater: (prev: CanvasState) => CanvasState) => void;
  /** Generate Video 완료 시 타임라인에 추가할 수 있는 콜백 */
  onVideoOutputReady?: (nodeId: string, videoUrl: string, metadata: VideoOutputMeta) => void;
}

export interface VideoOutputMeta {
  nodeId: string;
  nodeLabel: string;
  prompt: string;
  durationSec: number;
  aspectRatio: string;
  sourceImageUrl?: string;
  generatedAt: number;
}

// ═══════════════════════════════════════════════════════════════════
// Node Executors
// ═══════════════════════════════════════════════════════════════════

async function executeGenerateImage(
  node: CanvasNode,
  state: CanvasState,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const prompt = (node.data.prompt as string) || "";
  // 연결된 text input이 있으면 사용
  const inputs = getInputAssets(state, node.id);
  const textInput = inputs.find(i => i.asset);
  const finalPrompt = prompt || textInput?.asset || "";

  if (!finalPrompt.trim()) {
    callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "failed", undefined, undefined, "프롬프트를 입력하세요"));
    return;
  }

  callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "running"));

  try {
    const res = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: finalPrompt,
        aspectRatio: node.data.aspectRatio || "16:9",
        sceneDescription: node.data.sceneDescription || undefined,
        animationMode: node.data.animationMode || undefined,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { images?: { base64: string; mimeType: string }[]; error?: string };

    if (data.images && data.images.length > 0) {
      const img = data.images[0];
      const dataUri = `data:${img.mimeType};base64,${img.base64}`;
      callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "success", dataUri, "image"));
    } else {
      callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "failed", undefined, undefined, data.error || "이미지 생성 결과 없음"));
    }
  } catch (err) {
    callbacks.onStateChange(prev => updateNodeStatus(
      prev, node.id, "failed", undefined, undefined,
      err instanceof Error ? err.message : "이미지 생성 실패",
    ));
  }
}

async function executeGenerateVideo(
  node: CanvasNode,
  state: CanvasState,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const prompt = (node.data.prompt as string) || (node.data.sceneDescription as string) || "";
  const inputs = getInputAssets(state, node.id);
  const imageInput = inputs.find(i => i.mimeType === "image");
  const textInput = inputs.find(i => !i.mimeType && i.asset);
  const finalPrompt = prompt || textInput?.asset || "";

  if (!finalPrompt.trim() && !imageInput?.asset) {
    callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "failed", undefined, undefined, "프롬프트 또는 입력 이미지가 필요합니다"));
    return;
  }

  callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "running"));

  // 이미지 입력이 data URI면 base64만 추출
  let firstFrameBase64: string | undefined;
  if (imageInput?.asset) {
    firstFrameBase64 = imageInput.asset.replace(/^data:[^;]+;base64,/, "");
  }

  try {
    const res = await fetch("/api/generate-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: finalPrompt,
        firstFrameBase64,
        durationSeconds: node.data.durationSec || 6,
        aspectRatio: node.data.aspectRatio || "16:9",
        engine: "kling",
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json() as { taskId?: string; operationName?: string; videoUrl?: string; videoUri?: string; status?: string };

    const videoResult = data.videoUrl || data.videoUri;
    const taskId = data.taskId || data.operationName;

    if (videoResult) {
      // 즉시 완료 (캐시 히트 등)
      callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "success", videoResult, "video"));
      callbacks.onVideoOutputReady?.(node.id, videoResult, {
        nodeId: node.id,
        nodeLabel: node.label,
        prompt: finalPrompt,
        durationSec: (node.data.durationSec as number) || 6,
        aspectRatio: (node.data.aspectRatio as string) || "16:9",
        sourceImageUrl: imageInput?.asset,
        generatedAt: Date.now(),
      });
    } else if (taskId) {
      // 폴링 필요
      await pollVideoGeneration(node.id, taskId, node, finalPrompt, imageInput?.asset, callbacks);
    } else {
      callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "failed", undefined, undefined, "비디오 생성 응답 없음"));
    }
  } catch (err) {
    callbacks.onStateChange(prev => updateNodeStatus(
      prev, node.id, "failed", undefined, undefined,
      err instanceof Error ? err.message : "비디오 생성 실패",
    ));
  }
}

async function pollVideoGeneration(
  nodeId: string,
  taskId: string,
  node: CanvasNode,
  prompt: string,
  sourceImageUrl: string | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const MAX_ATTEMPTS = 60;
  const INTERVAL = 5000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, INTERVAL));

    try {
      const res = await fetch("/api/check-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, engine: "kling" }),
      });
      if (!res.ok) continue;

      const data = await res.json() as { status?: string; videoUri?: string; error?: string; progress?: number };

      if (data.status === "COMPLETED" && data.videoUri) {
        callbacks.onStateChange(prev => updateNodeStatus(prev, nodeId, "success", data.videoUri, "video"));
        callbacks.onVideoOutputReady?.(nodeId, data.videoUri, {
          nodeId,
          nodeLabel: node.label,
          prompt,
          durationSec: (node.data.durationSec as number) || 6,
          aspectRatio: (node.data.aspectRatio as string) || "16:9",
          sourceImageUrl,
          generatedAt: Date.now(),
        });
        return;
      }

      if (data.status === "FAILED") {
        callbacks.onStateChange(prev => updateNodeStatus(prev, nodeId, "failed", undefined, undefined, data.error || "비디오 생성 실패"));
        return;
      }
      // RUNNING — continue polling
    } catch {
      // 폴링 실패는 무시하고 재시도
    }
  }

  callbacks.onStateChange(prev => updateNodeStatus(prev, nodeId, "failed", undefined, undefined, "생성 시간 초과"));
}

function executeViewer(
  node: CanvasNode,
  state: CanvasState,
  callbacks: ExecutionCallbacks,
): void {
  const inputs = getInputAssets(state, node.id);
  const media = inputs.find(i => i.asset);
  if (media?.asset) {
    callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "success", media.asset, media.mimeType));
  } else {
    callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "idle"));
  }
}

function executeTextInput(
  node: CanvasNode,
  _state: CanvasState,
  callbacks: ExecutionCallbacks,
): void {
  const text = (node.data.text as string) || "";
  if (text.trim()) {
    // text를 outputAsset으로 저장 (다른 노드에서 참조)
    callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "success", text, undefined));
  } else {
    callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "idle"));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main Executor
// ═══════════════════════════════════════════════════════════════════

export async function executeNode(
  nodeId: string,
  state: CanvasState,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;

  switch (node.type) {
    case "generate-image":
      await executeGenerateImage(node, state, callbacks);
      break;
    case "generate-video":
      await executeGenerateVideo(node, state, callbacks);
      break;
    case "viewer":
      executeViewer(node, state, callbacks);
      break;
    case "text-input":
      executeTextInput(node, state, callbacks);
      break;
    default:
      callbacks.onStateChange(prev => updateNodeStatus(
        prev, nodeId, "failed", undefined, undefined, `미지원 노드 타입: ${node.type}`,
      ));
  }
}
