/**
 * node-execution.ts — 노드 실행 엔진
 *
 * 역할:
 *  - 노드 타입별 실행 로직
 *  - Generate Image: /api/generate-image 호출
 *  - Generate Video: video-generation-core를 통해 기존 Kling 파이프라인과 동일한 경로로 실행
 *  - Viewer: 입력 에셋 패스스루
 *  - Text Input: data.text를 output으로 전달
 */

import type { CanvasState, CanvasNode } from "./node-types";
import { updateNodeStatus, updateNodeData, getInputAssets } from "./node-types";
import {
  submitVideoGeneration,
  pollVideoTask,
  buildDurationMeta,
  extractProviderMeta,
  classifyVideoError,
  type VideoSubmitResult,
  type NormalizedVideoResult,
  type ProviderMeta,
  type VideoErrorClassification,
} from "./video-generation-core";
import type { DurationMeta } from "@/types";

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
  /** 기존 useVideoGeneration과 동일한 metadata shape */
  durationMeta?: DurationMeta;
  providerMeta?: ProviderMeta;
  errorClassification?: VideoErrorClassification;
  /** 정규화된 결과 전체 (선택적 소비) */
  normalizedResult?: NormalizedVideoResult;
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

  const requestedDuration = (node.data.durationSec as number) || 6;
  const requestedAspect = (node.data.aspectRatio as string) || "16:9";

  try {
    // ── Submit: 공통 core를 통해 기존 파이프라인과 동일한 API shape 사용 ──
    const submitResult: VideoSubmitResult = await submitVideoGeneration({
      prompt: finalPrompt,
      firstFrameBase64,
      durationSeconds: requestedDuration,
      aspectRatio: requestedAspect,
      engine: "kling",
    });

    // provider/model 메타 추출 — 기존 useVideoGeneration과 동일
    const providerMeta = extractProviderMeta(submitResult);

    // durationMeta 구축 — 기존 useVideoGeneration과 동일한 shape
    const durationMeta = buildDurationMeta(requestedDuration, submitResult.durationMeta);

    // 메타를 노드 data에 저장 (export 시 참조 가능)
    callbacks.onStateChange(prev => updateNodeData(prev, node.id, {
      _taskId: submitResult.taskId,
      _providerMeta: providerMeta,
      _durationMeta: durationMeta,
    }));

    // 즉시 완료 (캐시 히트 등)
    const immediateVideo = submitResult.videoUrl || submitResult.videoUri;
    if (immediateVideo) {
      callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "success", immediateVideo, "video"));
      callbacks.onVideoOutputReady?.(node.id, immediateVideo, {
        nodeId: node.id,
        nodeLabel: node.label,
        prompt: finalPrompt,
        durationSec: requestedDuration,
        aspectRatio: requestedAspect,
        sourceImageUrl: imageInput?.asset,
        generatedAt: Date.now(),
        durationMeta,
        providerMeta,
      });
      return;
    }

    if (!submitResult.taskId) {
      callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "failed", undefined, undefined, "비디오 생성 응답 없음"));
      return;
    }

    // ── Polling: 공통 core의 adaptive polling 사용 ──
    const pollResult = await pollVideoTask(submitResult.taskId, {
      onProgress: (attempt, max, progress) => {
        // 진행 중 상태는 node data에 progress 저장
        callbacks.onStateChange(prev => updateNodeData(prev, node.id, {
          _pollProgress: progress,
          _pollAttempt: attempt,
        }));
      },
    });

    if (pollResult.status === "completed" && pollResult.videoUri) {
      // 결과 메타를 노드에 저장
      callbacks.onStateChange(prev => updateNodeData(prev, node.id, {
        _canonicalVideoUri: pollResult.canonicalVideoUri,
        _rawVideoUri: pollResult.rawVideoUri,
        _seed: pollResult.seed,
        _pollMeta: pollResult.pollMeta,
        _diag: pollResult._diag,
      }));

      callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "success", pollResult.videoUri, "video"));
      callbacks.onVideoOutputReady?.(node.id, pollResult.videoUri, {
        nodeId: node.id,
        nodeLabel: node.label,
        prompt: finalPrompt,
        durationSec: requestedDuration,
        aspectRatio: requestedAspect,
        sourceImageUrl: imageInput?.asset,
        generatedAt: Date.now(),
        durationMeta,
        providerMeta,
        normalizedResult: pollResult,
      });
    } else {
      // 실패 또는 타임아웃
      const errorClass = classifyVideoError(
        pollResult.error || "비디오 생성 실패",
        undefined,
      );

      callbacks.onStateChange(prev => updateNodeData(prev, node.id, {
        _errorClassification: errorClass,
        _pollMeta: pollResult.pollMeta,
      }));

      callbacks.onStateChange(prev => updateNodeStatus(
        prev, node.id, "failed", undefined, undefined,
        pollResult.error || "비디오 생성 실패",
      ));
    }
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    const errorClass = classifyVideoError(err, statusCode);

    callbacks.onStateChange(prev => updateNodeData(prev, node.id, {
      _errorClassification: errorClass,
    }));

    callbacks.onStateChange(prev => updateNodeStatus(
      prev, node.id, "failed", undefined, undefined,
      errorClass.message,
    ));
  }
}

async function executeEditImage(
  node: CanvasNode,
  state: CanvasState,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  // ── 입력 이미지 필수 검증 ──
  const inputs = getInputAssets(state, node.id);
  const imageInput = inputs.find(i => i.mimeType === "image");

  if (!imageInput?.asset) {
    callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "failed", undefined, undefined, "편집할 입력 이미지를 연결하세요"));
    return;
  }

  // ── 프롬프트: data.prompt 또는 연결된 text input ──
  const prompt = (node.data.prompt as string) || "";
  const textInput = inputs.find(i => !i.mimeType && i.asset);
  const finalPrompt = prompt || textInput?.asset || "";

  if (!finalPrompt.trim()) {
    callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "failed", undefined, undefined, "편집 프롬프트를 입력하세요"));
    return;
  }

  callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "running"));

  // 입력 이미지 base64 추출
  const referenceImageBase64 = imageInput.asset.replace(/^data:[^;]+;base64,/, "");

  try {
    // 기존 /api/generate-image 엔드포인트 재사용 + referenceImage, editMode 추가
    const res = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: finalPrompt,
        referenceImage: referenceImageBase64,
        editMode: node.data.editMode || "inpaint",
        aspectRatio: node.data.aspectRatio || "16:9",
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { images?: { base64: string; mimeType: string }[]; error?: string };

    if (data.images && data.images.length > 0) {
      const img = data.images[0];
      const dataUri = `data:${img.mimeType};base64,${img.base64}`;
      callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "success", dataUri, "image"));
    } else {
      callbacks.onStateChange(prev => updateNodeStatus(prev, node.id, "failed", undefined, undefined, data.error || "이미지 편집 결과 없음"));
    }
  } catch (err) {
    callbacks.onStateChange(prev => updateNodeStatus(
      prev, node.id, "failed", undefined, undefined,
      err instanceof Error ? err.message : "이미지 편집 실패",
    ));
  }
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
    case "edit-image":
      await executeEditImage(node, state, callbacks);
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
