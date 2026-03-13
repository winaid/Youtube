/**
 * sequence-to-nodes.ts — StructuredSequenceDocument/PromptOutput → CanvasState 변환
 *
 * sequence-level import: PromptOutput의 cuts 배열을 노드 그래프로 변환.
 * 각 cut에 대해 TextInput → GenerateVideo → Viewer 체인 생성.
 */

import type { PromptOutput, Cut } from "@/types";
import {
  type CanvasState,
  type CanvasNode,
  type PreservedCutData,
  type PreservedOutputMeta,
  createInitialCanvasState,
  createNode,
  addNode,
  addEdge,
  NODE_REGISTRY,
} from "./node-types";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ImportMeta {
  source: "structured-sequence-import";
  importedAt: number;
  sequenceId?: string;
  projectTitle?: string;
  cutNumber?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Layout constants
// ═══════════════════════════════════════════════════════════════════

const COL_TEXT = 0;
const COL_VIDEO = 320;
const COL_VIEWER = 660;
const ROW_HEIGHT = 260;
const ROW_START = 60;

// ═══════════════════════════════════════════════════════════════════
// Metadata preservation helpers
// ═══════════════════════════════════════════════════════════════════

/** Cut에서 캔버스에서 편집할 수 없는 필드를 추출하여 보존용 객체로 반환 */
function extractPreservedCutData(cut: Cut): PreservedCutData {
  return {
    cameraDirection: cut.cameraDirection || "",
    moodLighting: cut.moodLighting || "",
    imagePrompt: cut.imagePrompt || "",
    endImagePrompt: cut.endImagePrompt || "",
    extendPrompt: cut.extendPrompt || "",
    transitionHint: cut.transitionHint || "",
    characterConsistency: cut.characterConsistency || "",
    charactersInScene: cut.charactersInScene || [],
    ...(cut.multiShot ? { multiShot: cut.multiShot } : {}),
    ...(cut.shotCategory ? { shotCategory: cut.shotCategory } : {}),
    ...(cut.characterRole ? { characterRole: cut.characterRole } : {}),
    ...(cut.videoPromptJson ? { videoPromptJson: cut.videoPromptJson } : {}),
    ...(cut.extendPromptJson ? { extendPromptJson: cut.extendPromptJson } : {}),
    // 구조 보조 메타 보존
    ...(cut.structureType ? { structureType: cut.structureType } : {}),
    ...(cut.durationClass ? { durationClass: cut.durationClass } : {}),
    ...(cut.groupId ? { groupId: cut.groupId } : {}),
  };
}

/** PromptOutput에서 output-level 메타를 추출하여 보존용 객체로 반환 */
function extractPreservedOutputMeta(output: PromptOutput): PreservedOutputMeta {
  return {
    characterSeeds: output.characterSeeds || [],
    continuityRules: output.continuityRules || [],
    globalStylePrompt: output.globalStylePrompt || "",
    directorPersonaPrompt: output.directorPersonaPrompt || "",
    conceptSummary: output.conceptSummary || "",
  };
}

// ═══════════════════════════════════════════════════════════════════
// Core conversion
// ═══════════════════════════════════════════════════════════════════

function findDef(type: string) {
  return NODE_REGISTRY.find(d => d.type === type)!;
}

function buildImportProvenance(meta: ImportMeta, cutNumber?: number): CanvasNode["provenance"] & { importMeta: ImportMeta } {
  return {
    createdAt: meta.importedAt,
    importMeta: {
      ...meta,
      cutNumber,
    },
  };
}

/**
 * PromptOutput → CanvasState
 *
 * 각 cut에 대해:
 *   TextInput(videoPrompt) → GenerateVideo → Viewer
 *
 * 좌→우 배치, cut별 수직 행.
 */
export function promptOutputToCanvasState(output: PromptOutput): CanvasState {
  const now = Date.now();
  const meta: ImportMeta = {
    source: "structured-sequence-import",
    importedAt: now,
    projectTitle: output.projectTitle,
  };

  let state = createInitialCanvasState();

  const cuts = output.cuts || [];
  if (cuts.length === 0) return state;

  // Output-level 메타 보존 (첫 번째 TextInput에 저장)
  const outputMeta = extractPreservedOutputMeta(output);

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const rowY = ROW_START + i * ROW_HEIGHT;

    // 1. Text Input 노드 (videoPrompt)
    const textDef = findDef("text-input");
    const textNode = createNode(textDef, COL_TEXT, rowY);
    const promptText = cut.videoPrompt || cut.sceneDescription || "";
    const textNodeWithData: CanvasNode = {
      ...textNode,
      label: `Cut ${cut.cutNumber} Prompt`,
      data: {
        ...textNode.data,
        text: promptText,
        // 첫 번째 cut의 TextInput에만 output-level 메타 저장
        ...(i === 0 ? { _preservedOutputMeta: outputMeta } : {}),
      },
      provenance: buildImportProvenance(meta, cut.cutNumber),
    };
    state = addNode(state, textNodeWithData);

    // 2. Generate Video 노드 — 원본 Cut 메타데이터 보존
    const vidDef = findDef("generate-video");
    const vidNode = createNode(vidDef, COL_VIDEO, rowY);
    const vidNodeWithData: CanvasNode = {
      ...vidNode,
      label: `Cut ${cut.cutNumber} Video`,
      data: {
        ...vidNode.data,
        prompt: promptText,
        durationSec: cut.durationSec || 6,
        aspectRatio: "16:9",
        sceneDescription: cut.sceneDescription || "",
        _preservedCut: extractPreservedCutData(cut),
      },
      provenance: buildImportProvenance(meta, cut.cutNumber),
    };
    state = addNode(state, vidNodeWithData);

    // 3. Viewer 노드
    const viewerDef = findDef("viewer");
    const viewerNode = createNode(viewerDef, COL_VIEWER, rowY);
    const viewerWithProv: CanvasNode = {
      ...viewerNode,
      label: `Cut ${cut.cutNumber} Preview`,
      provenance: buildImportProvenance(meta, cut.cutNumber),
    };
    state = addNode(state, viewerWithProv);

    // 4. 엣지: TextInput.text → GenerateVideo.prompt
    state = addEdge(
      state,
      textNodeWithData.id,
      textNodeWithData.outputs[0].id,
      vidNodeWithData.id,
      vidNodeWithData.inputs[0].id,
    );

    // 5. 엣지: GenerateVideo.video → Viewer.media
    state = addEdge(
      state,
      vidNodeWithData.id,
      vidNodeWithData.outputs[0].id,
      viewerWithProv.id,
      viewerWithProv.inputs[0].id,
    );
  }

  // 마지막 노드 선택 해제
  state = { ...state, selectedNodeId: null };

  return state;
}

/**
 * 단일 Cut → 노드 체인 (TextInput → GenerateVideo → Viewer)
 * import 시 기존 캔버스에 추가할 때 사용 가능.
 */
export function cutToNodes(cut: Cut, rowIndex: number, meta?: Partial<ImportMeta>): {
  textNode: CanvasNode;
  vidNode: CanvasNode;
  viewerNode: CanvasNode;
} {
  const now = Date.now();
  const importMeta: ImportMeta = {
    source: "structured-sequence-import",
    importedAt: now,
    ...meta,
    cutNumber: cut.cutNumber,
  };

  const rowY = ROW_START + rowIndex * ROW_HEIGHT;
  const promptText = cut.videoPrompt || cut.sceneDescription || "";

  const textNode: CanvasNode = {
    ...createNode(findDef("text-input"), COL_TEXT, rowY),
    label: `Cut ${cut.cutNumber} Prompt`,
    data: { text: promptText },
    provenance: buildImportProvenance(importMeta, cut.cutNumber),
  };

  const vidNode: CanvasNode = {
    ...createNode(findDef("generate-video"), COL_VIDEO, rowY),
    label: `Cut ${cut.cutNumber} Video`,
    data: {
      prompt: promptText,
      durationSec: cut.durationSec || 6,
      aspectRatio: "16:9",
      sceneDescription: cut.sceneDescription || "",
      _preservedCut: extractPreservedCutData(cut),
    },
    provenance: buildImportProvenance(importMeta, cut.cutNumber),
  };

  const viewerNode: CanvasNode = {
    ...createNode(findDef("viewer"), COL_VIEWER, rowY),
    label: `Cut ${cut.cutNumber} Preview`,
    provenance: buildImportProvenance(importMeta, cut.cutNumber),
  };

  return { textNode, vidNode, viewerNode };
}
