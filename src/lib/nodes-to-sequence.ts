/**
 * nodes-to-sequence.ts — CanvasState → PromptOutput export
 *
 * 선택된 노드에서 TextInput → GenerateVideo → Viewer 체인을 역추적/순추적하여
 * Cut 객체로 변환 후 PromptOutput을 생성한다.
 *
 * 1차 scope: 단일 체인 또는 전체 GenerateVideo 노드 기준 export.
 */

import type { PromptOutput, Cut } from "@/types";
import type { CanvasState, CanvasNode, CanvasEdge, PreservedCutData, PreservedOutputMeta } from "./node-types";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ExportMeta {
  source: "node-canvas-export";
  exportedAt: number;
  originatingNodeId: string;
  importedFromSequence: boolean;
}

export interface ExportChain {
  textNode?: CanvasNode;
  videoNode: CanvasNode;
  viewerNode?: CanvasNode;
  meta: ExportMeta;
}

export interface ExportResult {
  success: true;
  output: PromptOutput;
  chains: ExportChain[];
  meta: ExportMeta;
}

export interface ExportError {
  success: false;
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════
// Chain discovery
// ═══════════════════════════════════════════════════════════════════

/** 특정 노드의 upstream source 노드를 찾는다 (edge를 역추적) */
function findUpstream(state: CanvasState, nodeId: string, portId: string): CanvasNode | undefined {
  const edge = state.edges.find(e => e.targetNodeId === nodeId && e.targetPortId === portId);
  if (!edge) return undefined;
  return state.nodes.find(n => n.id === edge.sourceNodeId);
}

/** 특정 노드의 downstream target 노드를 찾는다 (edge를 순추적) */
function findDownstream(state: CanvasState, nodeId: string, portId: string): CanvasNode | undefined {
  const edge = state.edges.find(e => e.sourceNodeId === nodeId && e.sourcePortId === portId);
  if (!edge) return undefined;
  return state.nodes.find(n => n.id === edge.targetNodeId);
}

/**
 * 선택된 노드에서 GenerateVideo 체인을 찾는다.
 * - 선택된 노드가 generate-video면 그 노드 기준
 * - 선택된 노드가 text-input이면 downstream generate-video를 찾음
 * - 선택된 노드가 viewer이면 upstream generate-video를 찾음
 */
export function findChainFromNode(state: CanvasState, nodeId: string): ExportChain | null {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return null;

  let videoNode: CanvasNode | undefined;

  if (node.type === "generate-video") {
    videoNode = node;
  } else if (node.type === "text-input") {
    // downstream: text output → video prompt input
    if (node.outputs.length > 0) {
      const downstream = findDownstream(state, node.id, node.outputs[0].id);
      if (downstream?.type === "generate-video") videoNode = downstream;
    }
  } else if (node.type === "viewer") {
    // upstream: viewer media input ← video output
    if (node.inputs.length > 0) {
      const upstream = findUpstream(state, node.id, node.inputs[0].id);
      if (upstream?.type === "generate-video") videoNode = upstream;
    }
  }

  if (!videoNode) return null;

  // 역추적: video prompt input ← text output
  let textNode: CanvasNode | undefined;
  if (videoNode.inputs.length > 0) {
    const upstream = findUpstream(state, videoNode.id, videoNode.inputs[0].id);
    if (upstream?.type === "text-input") textNode = upstream;
  }

  // 순추적: video output → viewer media input
  let viewerNode: CanvasNode | undefined;
  if (videoNode.outputs.length > 0) {
    const downstream = findDownstream(state, videoNode.id, videoNode.outputs[0].id);
    if (downstream?.type === "viewer") viewerNode = downstream;
  }

  const provenance = videoNode.provenance as { importMeta?: { source: string } } | undefined;
  const importedFromSequence = provenance?.importMeta?.source === "structured-sequence-import";

  return {
    textNode,
    videoNode,
    viewerNode,
    meta: {
      source: "node-canvas-export",
      exportedAt: Date.now(),
      originatingNodeId: videoNode.id,
      importedFromSequence,
    },
  };
}

/**
 * 캔버스에서 모든 GenerateVideo 체인을 찾는다.
 */
export function findAllChains(state: CanvasState): ExportChain[] {
  const videoNodes = state.nodes.filter(n => n.type === "generate-video");
  const chains: ExportChain[] = [];

  for (const vn of videoNodes) {
    const chain = findChainFromNode(state, vn.id);
    if (chain) chains.push(chain);
  }

  // y좌표 기준 정렬 (위에서 아래로)
  chains.sort((a, b) => a.videoNode.y - b.videoNode.y);
  return chains;
}

/**
 * 선택된 노드가 export 가능한지 확인한다.
 */
export function canExportFromNode(state: CanvasState, nodeId: string): boolean {
  return findChainFromNode(state, nodeId) !== null;
}

// ═══════════════════════════════════════════════════════════════════
// Chain → Cut/PromptOutput 변환
// ═══════════════════════════════════════════════════════════════════

function chainToCut(chain: ExportChain, cutNumber: number): Cut {
  const data = chain.videoNode.data;
  const prompt = (data.prompt as string) || (chain.textNode?.data?.text as string) || "";
  const sceneDescription = (data.sceneDescription as string) || "";

  // 보존된 원본 Cut 메타데이터 복원 (있으면 사용, 없으면 빈 값)
  const preserved = (data._preservedCut as PreservedCutData) || null;

  const cut: Cut = {
    cutNumber,
    // 편집 가능 필드: 캔버스에서 수정된 값 우선
    durationSec: (data.durationSec as number) || 6,
    sceneDescription: sceneDescription || prompt,
    videoPrompt: prompt,
    // 보존 필드: 원본 값 복원, 없으면 빈 값 fallback
    cameraDirection: preserved?.cameraDirection ?? "",
    moodLighting: preserved?.moodLighting ?? "",
    imagePrompt: preserved?.imagePrompt ?? "",
    endImagePrompt: preserved?.endImagePrompt ?? "",
    extendPrompt: preserved?.extendPrompt ?? "",
    transitionHint: preserved?.transitionHint ?? "",
    characterConsistency: preserved?.characterConsistency ?? "",
    charactersInScene: preserved?.charactersInScene ?? [],
  };

  // Optional fields — 보존된 값이 있을 때만 포함
  if (preserved?.multiShot) cut.multiShot = preserved.multiShot as Cut["multiShot"];
  if (preserved?.shotCategory) cut.shotCategory = preserved.shotCategory;
  if (preserved?.characterRole) cut.characterRole = preserved.characterRole;
  if (preserved?.videoPromptJson) cut.videoPromptJson = preserved.videoPromptJson as Cut["videoPromptJson"];
  if (preserved?.extendPromptJson) cut.extendPromptJson = preserved.extendPromptJson as Cut["extendPromptJson"];

  return cut;
}

/** 체인에서 보존된 output-level 메타데이터를 찾는다 (TextInput._preservedOutputMeta) */
function findPreservedOutputMeta(chain: ExportChain): PreservedOutputMeta | null {
  const meta = chain.textNode?.data?._preservedOutputMeta as PreservedOutputMeta | undefined;
  return meta || null;
}

/** 여러 체인에서 보존된 output-level 메타를 찾는다 (첫 번째 것 사용) */
function findPreservedOutputMetaFromChains(chains: ExportChain[]): PreservedOutputMeta | null {
  for (const chain of chains) {
    const meta = findPreservedOutputMeta(chain);
    if (meta) return meta;
  }
  return null;
}

/**
 * 단일 체인을 PromptOutput으로 export.
 */
export function exportChainToPromptOutput(chain: ExportChain): ExportResult {
  const cut = chainToCut(chain, 1);
  const projectTitle = getProjectTitle(chain);
  const preservedMeta = findPreservedOutputMeta(chain);

  return {
    success: true,
    output: {
      projectTitle,
      conceptSummary: preservedMeta?.conceptSummary || `Node canvas export — ${chain.videoNode.label}`,
      totalCuts: 1,
      globalStylePrompt: preservedMeta?.globalStylePrompt ?? "",
      directorPersonaPrompt: preservedMeta?.directorPersonaPrompt ?? "",
      characterSeeds: (preservedMeta?.characterSeeds ?? []) as PromptOutput["characterSeeds"],
      continuityRules: preservedMeta?.continuityRules ?? [],
      cuts: [cut],
    },
    chains: [chain],
    meta: chain.meta,
  };
}

/**
 * 전체 캔버스의 모든 GenerateVideo 체인을 PromptOutput으로 export.
 */
export function exportAllChainsToPromptOutput(state: CanvasState): ExportResult | ExportError {
  const chains = findAllChains(state);
  if (chains.length === 0) {
    return { success: false, reason: "캔버스에 GenerateVideo 노드가 없습니다" };
  }

  const cuts = chains.map((chain, i) => chainToCut(chain, i + 1));
  const projectTitle = getProjectTitle(chains[0]);
  const preservedMeta = findPreservedOutputMetaFromChains(chains);

  return {
    success: true,
    output: {
      projectTitle,
      conceptSummary: preservedMeta?.conceptSummary || `Node canvas export — ${chains.length} cuts`,
      totalCuts: cuts.length,
      globalStylePrompt: preservedMeta?.globalStylePrompt ?? "",
      directorPersonaPrompt: preservedMeta?.directorPersonaPrompt ?? "",
      characterSeeds: (preservedMeta?.characterSeeds ?? []) as PromptOutput["characterSeeds"],
      continuityRules: preservedMeta?.continuityRules ?? [],
      cuts,
    },
    chains,
    meta: chains[0].meta,
  };
}

/**
 * 선택된 노드 기준 export. 노드가 체인에 속하면 해당 체인만,
 * 아니면 에러 반환.
 */
export function exportFromSelectedNode(state: CanvasState, nodeId: string): ExportResult | ExportError {
  const chain = findChainFromNode(state, nodeId);
  if (!chain) {
    return {
      success: false,
      reason: "선택된 노드에서 GenerateVideo 체인을 찾을 수 없습니다. GenerateVideo, TextInput, 또는 Viewer 노드를 선택하세요.",
    };
  }

  return exportChainToPromptOutput(chain);
}

function getProjectTitle(chain: ExportChain): string {
  const prov = chain.videoNode.provenance as { importMeta?: { projectTitle?: string } } | undefined;
  return prov?.importMeta?.projectTitle || "Canvas Export";
}
