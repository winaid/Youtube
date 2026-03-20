/**
 * sequence-to-nodes.ts — PromptOutput → CanvasState 변환
 *
 * 구조화된 시퀀스(PromptOutput)를 노드 캔버스 상태로 변환한다.
 */

import type { PromptOutput, Cut } from "@/types";
import {
  createInitialCanvasState,
  createNode,
  addNode,
  addEdge,
  NODE_REGISTRY,
  type CanvasState,
  type CanvasNode,
  type PreservedCutData,
  type PreservedOutputMeta,
} from "@/lib/node-types";

// ═══════════════════════════════════════════════════════════════════
// Layout constants
// ═══════════════════════════════════════════════════════════════════

const COL_TEXT = 0;
const COL_VIDEO = 300;
const COL_VIEWER = 600;
const ROW_GAP = 200;

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function findDef(type: string) {
  return NODE_REGISTRY.find(d => d.type === type)!;
}

function makeProvenance(cut: Cut, output: PromptOutput) {
  return {
    createdAt: Date.now(),
    importMeta: {
      source: "structured-sequence-import" as const,
      importedAt: Date.now(),
      cutNumber: cut.cutNumber,
      projectTitle: output.projectTitle,
    },
  };
}

/** Build preserved cut data (non-editable fields) */
function buildPreservedCut(cut: Cut): PreservedCutData {
  const preserved: PreservedCutData = {};
  if (cut.cameraDirection !== undefined) preserved.cameraDirection = cut.cameraDirection;
  if (cut.moodLighting !== undefined) preserved.moodLighting = cut.moodLighting;
  if (cut.imagePrompt !== undefined) preserved.imagePrompt = cut.imagePrompt;
  if (cut.endImagePrompt !== undefined) preserved.endImagePrompt = cut.endImagePrompt;
  if (cut.extendPrompt !== undefined) preserved.extendPrompt = cut.extendPrompt;
  if (cut.transitionHint !== undefined) preserved.transitionHint = cut.transitionHint;
  if (cut.characterConsistency !== undefined) preserved.characterConsistency = cut.characterConsistency;
  if (cut.charactersInScene !== undefined) preserved.charactersInScene = cut.charactersInScene;
  if (cut.multiShot !== undefined) preserved.multiShot = cut.multiShot;
  if (cut.shotCategory !== undefined) preserved.shotCategory = cut.shotCategory;
  if (cut.characterRole !== undefined) preserved.characterRole = cut.characterRole;
  if (cut.structureType !== undefined) preserved.structureType = cut.structureType;
  if (cut.durationClass !== undefined) preserved.durationClass = cut.durationClass;
  if (cut.groupId !== undefined) preserved.groupId = cut.groupId;
  return preserved;
}

/** Build preserved output-level metadata */
function buildPreservedOutputMeta(output: PromptOutput): PreservedOutputMeta {
  return {
    globalStylePrompt: output.globalStylePrompt,
    directorPersonaPrompt: output.directorPersonaPrompt,
    characterSeeds: output.characterSeeds,
    continuityRules: output.continuityRules,
    projectTitle: output.projectTitle,
    conceptSummary: output.conceptSummary,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert a single Cut into { textNode, vidNode, viewerNode } with provenance.
 * Does NOT add them to a state — call addNode separately.
 */
export function cutToNodes(
  cut: Cut,
  rowIndex: number,
  output?: PromptOutput,
): { textNode: CanvasNode; vidNode: CanvasNode; viewerNode: CanvasNode } {
  const y = rowIndex * ROW_GAP;
  const prov = makeProvenance(cut, output ?? {
    projectTitle: "",
    conceptSummary: "",
    totalCuts: 1,
    globalStylePrompt: "",
    directorPersonaPrompt: "",
    characterSeeds: [],
    continuityRules: [],
    cuts: [cut],
  });

  const textNode = createNode(findDef("text-input"), COL_TEXT, y);
  textNode.data.text = cut.videoPrompt || cut.sceneDescription || "";
  textNode.provenance = prov;

  const vidNode = createNode(findDef("generate-video"), COL_VIDEO, y);
  vidNode.data.prompt = cut.videoPrompt || cut.sceneDescription || "";
  vidNode.data.durationSec = cut.durationSec;
  vidNode.data.sceneDescription = cut.sceneDescription || "";
  vidNode.data._preservedCut = buildPreservedCut(cut);
  vidNode.provenance = prov;

  const viewerNode = createNode(findDef("viewer"), COL_VIEWER, y);
  viewerNode.provenance = prov;

  return { textNode, vidNode, viewerNode };
}

/**
 * Convert a full PromptOutput to a CanvasState with all nodes, edges, and metadata.
 */
export function promptOutputToCanvasState(output: PromptOutput): CanvasState {
  let state = createInitialCanvasState();
  if (!output.cuts || output.cuts.length === 0) return state;

  const outputMeta = buildPreservedOutputMeta(output);

  for (let i = 0; i < output.cuts.length; i++) {
    const cut = output.cuts[i];
    const { textNode, vidNode, viewerNode } = cutToNodes(cut, i, output);

    // Attach output-level meta to first text node only
    if (i === 0) {
      textNode.data._preservedOutputMeta = outputMeta;
    }

    state = addNode(state, textNode);
    state = addNode(state, vidNode);
    state = addNode(state, viewerNode);

    // TextInput.text → Video.prompt
    state = addEdge(state, textNode.id, textNode.outputs[0].id, vidNode.id, vidNode.inputs[0].id);
    // Video.video → Viewer.media
    state = addEdge(state, vidNode.id, vidNode.outputs[0].id, viewerNode.id, viewerNode.inputs[0].id);
  }

  // Clear selection after import
  state = { ...state, selectedNodeId: null };

  return state;
}
