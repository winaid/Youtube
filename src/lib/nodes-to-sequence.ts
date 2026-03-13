/**
 * nodes-to-sequence.ts — CanvasState → PromptOutput export
 *
 * 선택된 노드에서 TextInput → GenerateVideo → Viewer 체인을 역추적/순추적하여
 * Cut 객체로 변환 후 PromptOutput을 생성한다.
 *
 * Export 모드:
 * - 전체 대체: exportAllChainsToPromptOutput — 기존 result 완전 교체
 * - 선택 export: exportFromSelectedNode — 단일 체인만 export
 * - 병합 export: mergeSelectedChainsToOutput — 선택 chain만 기존 result에 부분 반영
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

/** 병합 결과 — 어떤 cut이 교체되었는지 추적 */
export interface MergeResult {
  success: true;
  output: PromptOutput;
  /** 교체된 cutNumber 목록 */
  mergedCutNumbers: number[];
  /** 대응 cut을 찾지 못한 chain nodeId 목록 */
  unmatchedChainNodeIds: string[];
  meta: ExportMeta;
}

/** merge 에러 코드 */
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
  /** 구조화된 에러 코드 — UI 분기용 */
  code: MergeErrorCode;
  /** 같은 cutNumber를 가리키는 chain이 2개 이상일 때 충돌 정보 */
  conflictedCutNumbers?: number[];
  /** 충돌에 관여한 chain nodeId 목록 */
  conflictedChainNodeIds?: string[];
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

/** chain의 provenance에서 원본 cutNumber를 추출한다 */
function getProvenanceCutNumber(chain: ExportChain): number | null {
  const prov = chain.videoNode.provenance as {
    importMeta?: { cutNumber?: number };
  } | undefined;
  return prov?.importMeta?.cutNumber ?? null;
}

// ═══════════════════════════════════════════════════════════════════
// Merge export — 선택 chain만 기존 result에 부분 반영
// ═══════════════════════════════════════════════════════════════════

/**
 * 선택된 chain(들)을 기존 PromptOutput의 대응 cut에 병합한다.
 *
 * 대응 cut 결정 전략:
 * 1. provenance.importMeta.cutNumber가 있으면 그 cutNumber로 매칭
 * 2. provenance가 없으면 → unmatchedChainNodeIds에 포함
 *
 * 기존 순서, 다른 cut, output-level metadata는 모두 유지.
 */
export function mergeSelectedChainsToOutput(
  chains: ExportChain[],
  baseOutput: PromptOutput,
): MergeResult | MergeError {
  if (chains.length === 0) {
    return { success: false, code: "EMPTY_CHAINS", reason: "병합할 체인이 없습니다" };
  }

  if (!baseOutput.cuts || baseOutput.cuts.length === 0) {
    return { success: false, code: "EMPTY_BASE", reason: "기존 결과에 cut이 없어 병합할 수 없습니다" };
  }

  // ── duplicate target cutNumber 충돌 감지 ──
  // 같은 cutNumber를 가리키는 chain이 2개 이상이면 어떤 값을 쓸지 모호하므로 거부
  const targetMap = new Map<number, string[]>(); // cutNumber → nodeId[]
  for (const chain of chains) {
    const cn = getProvenanceCutNumber(chain);
    if (cn != null) {
      const arr = targetMap.get(cn) || [];
      arr.push(chain.videoNode.id);
      targetMap.set(cn, arr);
    }
  }
  const conflictedCutNumbers: number[] = [];
  const conflictedChainNodeIds: string[] = [];
  for (const [cn, nodeIds] of targetMap) {
    if (nodeIds.length > 1) {
      conflictedCutNumbers.push(cn);
      conflictedChainNodeIds.push(...nodeIds);
    }
  }
  if (conflictedCutNumbers.length > 0) {
    return {
      success: false,
      code: "DUPLICATE_TARGET_CUT",
      reason: `Cut ${conflictedCutNumbers.join(", ")}번에 ${conflictedChainNodeIds.length}개 체인이 동시에 대응합니다. 같은 cut을 가리키는 중복 체인을 제거하세요.`,
      conflictedCutNumbers,
      conflictedChainNodeIds,
    };
  }

  // cutNumber로 기존 cut을 인덱싱
  const baseCutMap = new Map<number, number>(); // cutNumber → array index
  baseOutput.cuts.forEach((cut, idx) => {
    baseCutMap.set(cut.cutNumber, idx);
  });

  const mergedCuts = [...baseOutput.cuts];
  const mergedCutNumbers: number[] = [];
  const unmatchedChainNodeIds: string[] = [];

  for (const chain of chains) {
    const targetCutNumber = getProvenanceCutNumber(chain);

    if (targetCutNumber == null || !baseCutMap.has(targetCutNumber)) {
      unmatchedChainNodeIds.push(chain.videoNode.id);
      continue;
    }

    const idx = baseCutMap.get(targetCutNumber)!;
    const newCut = chainToCut(chain, targetCutNumber);
    mergedCuts[idx] = newCut;
    mergedCutNumbers.push(targetCutNumber);
  }

  // 전부 unmatched이면 실패
  if (mergedCutNumbers.length === 0) {
    // provenance 자체가 없는 chain만 있는지, 아니면 cutNumber가 baseOutput에 없는지 구분
    const hasAnyProvenance = chains.some(c => getProvenanceCutNumber(c) != null);
    return {
      success: false,
      code: hasAnyProvenance ? "NO_MATCHED_CHAINS" : "NO_MATCHED_CHAINS",
      reason: hasAnyProvenance
        ? `선택된 ${chains.length}개 체인의 cutNumber가 기존 결과에 존재하지 않아 병합할 수 없습니다.`
        : `캔버스에서 새로 만든 체인은 기존 cut 대응 정보(provenance)가 없어 병합할 수 없습니다. 기존 프롬프트를 캔버스로 가져온 후 편집하세요.`,
    };
  }

  const output: PromptOutput = {
    ...baseOutput,
    cuts: mergedCuts,
    totalCuts: mergedCuts.length,
  };

  return {
    success: true,
    output,
    mergedCutNumbers,
    unmatchedChainNodeIds,
    meta: {
      source: "node-canvas-export",
      exportedAt: Date.now(),
      originatingNodeId: chains[0].videoNode.id,
      importedFromSequence: chains[0].meta.importedFromSequence,
    },
  };
}

/**
 * 선택된 노드의 chain을 기존 result에 병합한다 (단일 chain merge).
 */
export function mergeSelectedNodeToOutput(
  state: CanvasState,
  nodeId: string,
  baseOutput: PromptOutput,
): MergeResult | MergeError {
  const chain = findChainFromNode(state, nodeId);
  if (!chain) {
    return {
      success: false,
      code: "NO_CHAIN_FOUND",
      reason: "선택된 노드에서 GenerateVideo 체인을 찾을 수 없습니다.",
    };
  }
  return mergeSelectedChainsToOutput([chain], baseOutput);
}

/**
 * 전체 캔버스 chain을 기존 result에 병합한다 (전체 merge).
 */
export function mergeAllChainsToOutput(
  state: CanvasState,
  baseOutput: PromptOutput,
): MergeResult | MergeError {
  const chains = findAllChains(state);
  if (chains.length === 0) {
    return { success: false, code: "NO_VIDEO_NODES", reason: "캔버스에 GenerateVideo 노드가 없습니다" };
  }
  return mergeSelectedChainsToOutput(chains, baseOutput);
}
