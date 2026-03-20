/**
 * nodes-to-sequence.ts — CanvasState → PromptOutput export
 *
 * 캔버스 노드 체인을 구조화된 시퀀스(PromptOutput)로 변환한다.
 */

import type { Cut, PromptOutput } from "@/types";
import {
  type CanvasState,
  type CanvasNode,
  type PreservedCutData,
  type PreservedOutputMeta,
} from "@/lib/node-types";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ExportChain {
  textNode?: CanvasNode;
  videoNode: CanvasNode;
  viewerNode?: CanvasNode;
  meta: {
    source: "node-canvas-export";
    exportedAt: number;
    originatingNodeId: string;
    importedFromSequence: boolean;
  };
}

export type MergeErrorCode =
  | "EMPTY_CHAINS"
  | "EMPTY_BASE"
  | "DUPLICATE_TARGET_CUT"
  | "NO_MATCHED_CHAINS"
  | "NO_CHAIN_FOUND"
  | "NO_VIDEO_NODES";

export interface MergeError {
  success: false;
  reason: string;
  code: MergeErrorCode;
  conflictedCutNumbers?: number[];
  conflictedChainNodeIds?: string[];
}

interface MergeSuccess {
  success: true;
  output: PromptOutput;
  mergedCutNumbers: number[];
  unmatchedChainNodeIds: string[];
}

interface ExportSuccess {
  success: true;
  output: PromptOutput;
}

interface ExportError {
  success: false;
  reason: string;
}

type ExportResult = ExportSuccess | ExportError;
type MergeResult = MergeSuccess | MergeError;

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function getImportMeta(node: CanvasNode): { cutNumber?: number; source?: string } | undefined {
  return (node.provenance as { importMeta?: { cutNumber?: number; source?: string } })?.importMeta;
}

function isImported(node: CanvasNode): boolean {
  return getImportMeta(node)?.source === "structured-sequence-import";
}

function chainToCut(chain: ExportChain, cutNumber: number): Cut {
  const vidNode = chain.videoNode;
  const preserved = (vidNode.data._preservedCut as PreservedCutData) || {};
  const prompt = (vidNode.data.prompt as string) || "";
  const durationSec = (vidNode.data.durationSec as number) || 6;
  const sceneDescription = (vidNode.data.sceneDescription as string) || "";

  return {
    cutNumber,
    durationSec,
    sceneDescription,
    videoPrompt: prompt,
    cameraDirection: preserved.cameraDirection ?? "",
    moodLighting: preserved.moodLighting ?? "",
    imagePrompt: preserved.imagePrompt ?? "",
    endImagePrompt: preserved.endImagePrompt ?? "",
    extendPrompt: preserved.extendPrompt ?? "",
    transitionHint: preserved.transitionHint ?? "",
    characterConsistency: preserved.characterConsistency ?? "",
    charactersInScene: preserved.charactersInScene ?? [],
    multiShot: preserved.multiShot as Cut["multiShot"],
    shotCategory: preserved.shotCategory,
    characterRole: preserved.characterRole,
    structureType: preserved.structureType as Cut["structureType"],
    durationClass: preserved.durationClass as Cut["durationClass"],
    groupId: preserved.groupId,
  } as Cut;
}

function getOutputMeta(state: CanvasState): PreservedOutputMeta | undefined {
  for (const node of state.nodes) {
    if (node.type === "text-input" && node.data._preservedOutputMeta) {
      return node.data._preservedOutputMeta as PreservedOutputMeta;
    }
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════
// Chain finding
// ═══════════════════════════════════════════════════════════════════

function findVideoNodeForChain(state: CanvasState, startNodeId: string): CanvasNode | null {
  const node = state.nodes.find(n => n.id === startNodeId);
  if (!node) return null;

  if (node.type === "generate-video") return node;

  // Forward: text-input → generate-video
  if (node.type === "text-input") {
    const edge = state.edges.find(e => e.sourceNodeId === node.id);
    if (edge) {
      const target = state.nodes.find(n => n.id === edge.targetNodeId);
      if (target?.type === "generate-video") return target;
    }
  }

  // Backward: viewer ← generate-video
  if (node.type === "viewer") {
    const edge = state.edges.find(e => e.targetNodeId === node.id);
    if (edge) {
      const source = state.nodes.find(n => n.id === edge.sourceNodeId);
      if (source?.type === "generate-video") return source;
    }
  }

  return null;
}

export function findChainFromNode(state: CanvasState, nodeId: string): ExportChain | null {
  const vidNode = findVideoNodeForChain(state, nodeId);
  if (!vidNode) return null;

  // Find connected text-input (upstream)
  let textNode: CanvasNode | undefined;
  const textEdge = state.edges.find(
    e => e.targetNodeId === vidNode.id && state.nodes.find(n => n.id === e.sourceNodeId)?.type === "text-input",
  );
  if (textEdge) {
    textNode = state.nodes.find(n => n.id === textEdge.sourceNodeId);
  }

  // Find connected viewer (downstream)
  let viewerNode: CanvasNode | undefined;
  const viewerEdge = state.edges.find(
    e => e.sourceNodeId === vidNode.id && state.nodes.find(n => n.id === e.targetNodeId)?.type === "viewer",
  );
  if (viewerEdge) {
    viewerNode = state.nodes.find(n => n.id === viewerEdge.targetNodeId);
  }

  return {
    textNode,
    videoNode: vidNode,
    viewerNode,
    meta: {
      source: "node-canvas-export",
      exportedAt: Date.now(),
      originatingNodeId: vidNode.id,
      importedFromSequence: isImported(vidNode),
    },
  };
}

export function findAllChains(state: CanvasState): ExportChain[] {
  const videoNodes = state.nodes
    .filter(n => n.type === "generate-video")
    .sort((a, b) => a.y - b.y);

  const chains: ExportChain[] = [];
  for (const vn of videoNodes) {
    const chain = findChainFromNode(state, vn.id);
    if (chain) chains.push(chain);
  }
  return chains;
}

export function canExportFromNode(state: CanvasState, nodeId: string): boolean {
  const chain = findChainFromNode(state, nodeId);
  return chain !== null;
}

// ═══════════════════════════════════════════════════════════════════
// Export — single node
// ═══════════════════════════════════════════════════════════════════

export function exportFromSelectedNode(state: CanvasState, nodeId: string): ExportResult {
  const chain = findChainFromNode(state, nodeId);
  if (!chain) {
    return { success: false, reason: "선택한 노드에서 GenerateVideo 노드를 찾을 수 없습니다." };
  }

  const outputMeta = getOutputMeta(state);
  const cut = chainToCut(chain, 1);

  return {
    success: true,
    output: {
      projectTitle: outputMeta?.projectTitle ?? "Canvas Export",
      conceptSummary: outputMeta?.conceptSummary ?? "",
      totalCuts: 1,
      globalStylePrompt: outputMeta?.globalStylePrompt ?? "",
      directorPersonaPrompt: outputMeta?.directorPersonaPrompt ?? "",
      characterSeeds: (outputMeta?.characterSeeds as PromptOutput["characterSeeds"]) ?? [],
      continuityRules: outputMeta?.continuityRules ?? [],
      cuts: [cut],
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Export — single chain
// ═══════════════════════════════════════════════════════════════════

export function exportChainToPromptOutput(chain: ExportChain): ExportResult {
  const cut = chainToCut(chain, 1);
  return {
    success: true,
    output: {
      projectTitle: "Canvas Export",
      conceptSummary: "",
      totalCuts: 1,
      globalStylePrompt: "",
      directorPersonaPrompt: "",
      characterSeeds: [],
      continuityRules: [],
      cuts: [cut],
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Export — all chains
// ═══════════════════════════════════════════════════════════════════

export function exportAllChainsToPromptOutput(state: CanvasState): ExportResult {
  const chains = findAllChains(state);
  if (chains.length === 0) {
    return { success: false, reason: "캔버스에 GenerateVideo 노드가 없습니다." };
  }

  const outputMeta = getOutputMeta(state);
  const cuts = chains.map((chain, i) => chainToCut(chain, i + 1));

  return {
    success: true,
    output: {
      projectTitle: outputMeta?.projectTitle ?? "Canvas Export",
      conceptSummary: outputMeta?.conceptSummary ?? "",
      totalCuts: cuts.length,
      globalStylePrompt: outputMeta?.globalStylePrompt ?? "",
      directorPersonaPrompt: outputMeta?.directorPersonaPrompt ?? "",
      characterSeeds: (outputMeta?.characterSeeds as PromptOutput["characterSeeds"]) ?? [],
      continuityRules: outputMeta?.continuityRules ?? [],
      cuts,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Merge — partial update
// ═══════════════════════════════════════════════════════════════════

export function mergeSelectedChainsToOutput(
  chains: ExportChain[],
  baseOutput: PromptOutput,
): MergeResult {
  if (chains.length === 0) {
    return { success: false, reason: "병합할 chain이 없습니다.", code: "EMPTY_CHAINS" };
  }
  if (!baseOutput.cuts || baseOutput.cuts.length === 0) {
    return { success: false, reason: "기존 결과에 cut이 없습니다.", code: "EMPTY_BASE" };
  }

  // Map chains to target cutNumbers via provenance
  const matchedPairs: { chain: ExportChain; cutNumber: number }[] = [];
  const unmatchedChainNodeIds: string[] = [];

  for (const chain of chains) {
    const importMeta = getImportMeta(chain.videoNode);
    const cutNumber = importMeta?.cutNumber;
    if (cutNumber && baseOutput.cuts.some(c => c.cutNumber === cutNumber)) {
      matchedPairs.push({ chain, cutNumber });
    } else {
      unmatchedChainNodeIds.push(chain.videoNode.id);
    }
  }

  // Check for duplicate target cutNumbers
  const targetCutNumbers = matchedPairs.map(p => p.cutNumber);
  const duplicateCutNumbers = targetCutNumbers.filter((n, i) => targetCutNumbers.indexOf(n) !== i);
  const uniqueDups = [...new Set(duplicateCutNumbers)];

  if (uniqueDups.length > 0) {
    const conflictedNodeIds = matchedPairs
      .filter(p => uniqueDups.includes(p.cutNumber))
      .map(p => p.chain.videoNode.id);
    return {
      success: false,
      reason: `cutNumber ${uniqueDups.join(", ")}에 여러 chain이 동시에 대응합니다.`,
      code: "DUPLICATE_TARGET_CUT",
      conflictedCutNumbers: uniqueDups,
      conflictedChainNodeIds: conflictedNodeIds,
    };
  }

  if (matchedPairs.length === 0) {
    // All chains are unmatched
    const hasProvenance = chains.some(c => getImportMeta(c.videoNode)?.cutNumber !== undefined);
    if (hasProvenance) {
      const cutNumbers = chains
        .map(c => getImportMeta(c.videoNode)?.cutNumber)
        .filter(Boolean);
      return {
        success: false,
        reason: `병합할 수 없습니다: cutNumber ${cutNumbers.join(", ")}에 대응하는 cut이 base에 없습니다.`,
        code: "NO_MATCHED_CHAINS",
      };
    }
    return {
      success: false,
      reason: "병합할 수 없습니다: 캔버스에서 새로 만든 chain은 provenance가 없어 기존 cut에 매칭할 수 없습니다.",
      code: "NO_MATCHED_CHAINS",
    };
  }

  // Build output
  const newCuts = baseOutput.cuts.map(c => ({ ...c }));
  const mergedCutNumbers: number[] = [];

  for (const { chain, cutNumber } of matchedPairs) {
    const idx = newCuts.findIndex(c => c.cutNumber === cutNumber);
    if (idx < 0) continue;

    const exported = chainToCut(chain, cutNumber);
    newCuts[idx] = exported;
    mergedCutNumbers.push(cutNumber);
  }

  return {
    success: true,
    output: {
      ...baseOutput,
      cuts: newCuts,
      totalCuts: newCuts.length,
    },
    mergedCutNumbers,
    unmatchedChainNodeIds,
  };
}

export function mergeSelectedNodeToOutput(
  state: CanvasState,
  nodeId: string,
  baseOutput: PromptOutput,
): MergeResult {
  const chain = findChainFromNode(state, nodeId);
  if (!chain) {
    return { success: false, reason: "chain을 찾을 수 없습니다.", code: "NO_CHAIN_FOUND" };
  }
  return mergeSelectedChainsToOutput([chain], baseOutput);
}

export function mergeAllChainsToOutput(
  state: CanvasState,
  baseOutput: PromptOutput,
): MergeResult {
  const chains = findAllChains(state);
  if (chains.length === 0) {
    return { success: false, reason: "캔버스에 GenerateVideo 노드가 없습니다.", code: "NO_VIDEO_NODES" };
  }
  return mergeSelectedChainsToOutput(chains, baseOutput);
}
