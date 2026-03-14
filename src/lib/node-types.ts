/**
 * node-types.ts — 노드 캔버스 타입 시스템
 *
 * 역할:
 *  - 노드/엣지/포트 타입 정의
 *  - 카테고리별 노드 정의 (registry)
 *  - 순수 상태 조작 함수
 */

// ═══════════════════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════════════════

export type NodeCategory = "all" | "text" | "image" | "video" | "sound" | "3d" | "utility";

export type NodeExecutionStatus = "idle" | "running" | "success" | "failed";

export type PortType = "text" | "image" | "video" | "any";

export interface Port {
  id: string;
  label: string;
  type: PortType;
  /** input port면 true, output이면 false */
  isInput: boolean;
}

export interface CanvasNode {
  id: string;
  type: string;
  label: string;
  category: NodeCategory;
  x: number;
  y: number;
  width: number;
  height: number;
  inputs: Port[];
  outputs: Port[];
  /** 노드별 설정값 */
  data: Record<string, unknown>;
  /** 실행 상태 */
  status: NodeExecutionStatus;
  /** 실행 결과 에셋 (이미지 URL, 비디오 URL 등) */
  outputAsset?: string;
  /** 실행 결과 MIME 타입 */
  outputMimeType?: "image" | "video";
  /** 에러 메시지 */
  error?: string;
  /** provenance: 어떤 노드에서 어떤 설정으로 생성됐는지 */
  provenance?: {
    createdAt: number;
    executedAt?: number;
    sourceNodeIds?: string[];
  };
}

export interface CanvasEdge {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

export interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  /** 현재 드래그 중인 연결선 */
  pendingEdge?: {
    sourceNodeId: string;
    sourcePortId: string;
    mouseX: number;
    mouseY: number;
  };
}

// ═══════════════════════════════════════════════════════════════════
// Node Registry — 카테고리별 노드 정의
// ═══════════════════════════════════════════════════════════════════

export interface NodeDefinition {
  type: string;
  label: string;
  category: NodeCategory;
  description: string;
  enabled: boolean;
  inputs: Omit<Port, "id">[];
  outputs: Omit<Port, "id">[];
  defaultData: Record<string, unknown>;
  defaultWidth: number;
  defaultHeight: number;
}

export const NODE_REGISTRY: NodeDefinition[] = [
  // ── Image ──
  {
    type: "generate-image",
    label: "Generate Image",
    category: "image",
    description: "텍스트 프롬프트로 이미지를 생성합니다",
    enabled: true,
    inputs: [
      { label: "prompt", type: "text", isInput: true },
    ],
    outputs: [
      { label: "image", type: "image", isInput: false },
    ],
    defaultData: { prompt: "", aspectRatio: "16:9", model: "default" },
    defaultWidth: 240,
    defaultHeight: 180,
  },
  {
    type: "edit-image",
    label: "Edit Image",
    category: "image",
    description: "이미지를 편집합니다 (인페인트/아웃페인트)",
    enabled: true,
    inputs: [
      { label: "image", type: "image", isInput: true },
      { label: "prompt", type: "text", isInput: true },
    ],
    outputs: [
      { label: "image", type: "image", isInput: false },
    ],
    defaultData: { editMode: "inpaint", prompt: "" },
    defaultWidth: 240,
    defaultHeight: 180,
  },
  {
    type: "upscale-image",
    label: "Upscale Image",
    category: "image",
    description: "이미지 해상도를 업스케일합니다",
    enabled: true,
    inputs: [
      { label: "image", type: "image", isInput: true },
    ],
    outputs: [
      { label: "image", type: "image", isInput: false },
    ],
    defaultData: { scale: 2 },
    defaultWidth: 220,
    defaultHeight: 150,
  },
  // ── Video ──
  {
    type: "generate-video",
    label: "Generate Video",
    category: "video",
    description: "텍스트/이미지에서 Kling 기반 영상을 생성합니다",
    enabled: true,
    inputs: [
      { label: "prompt", type: "text", isInput: true },
      { label: "image", type: "image", isInput: true },
    ],
    outputs: [
      { label: "video", type: "video", isInput: false },
    ],
    defaultData: {
      prompt: "",
      durationSec: 6,
      aspectRatio: "16:9",
      sceneDescription: "",
    },
    defaultWidth: 260,
    defaultHeight: 200,
  },
  // ── Utility ──
  {
    type: "viewer",
    label: "Viewer",
    category: "utility",
    description: "연결된 이미지/비디오를 미리봅니다",
    enabled: true,
    inputs: [
      { label: "media", type: "any", isInput: true },
    ],
    outputs: [],
    defaultData: {},
    defaultWidth: 280,
    defaultHeight: 220,
  },
  {
    type: "text-input",
    label: "Text Input",
    category: "text",
    description: "텍스트를 입력하여 다른 노드에 전달합니다",
    enabled: true,
    inputs: [],
    outputs: [
      { label: "text", type: "text", isInput: false },
    ],
    defaultData: { text: "" },
    defaultWidth: 240,
    defaultHeight: 150,
  },
  // ── Sound (placeholder) ──
  {
    type: "generate-sound",
    label: "Generate Sound",
    category: "sound",
    description: "사운드/음악을 생성합니다",
    enabled: false,
    inputs: [
      { label: "prompt", type: "text", isInput: true },
    ],
    outputs: [
      { label: "audio", type: "any", isInput: false },
    ],
    defaultData: { prompt: "" },
    defaultWidth: 220,
    defaultHeight: 150,
  },
  // ── 3D (placeholder) ──
  {
    type: "generate-3d",
    label: "Generate 3D",
    category: "3d",
    description: "3D 모델을 생성합니다",
    enabled: false,
    inputs: [
      { label: "image", type: "image", isInput: true },
    ],
    outputs: [
      { label: "model", type: "any", isInput: false },
    ],
    defaultData: {},
    defaultWidth: 220,
    defaultHeight: 150,
  },
];

// ═══════════════════════════════════════════════════════════════════
// Metadata Preservation Types (for import/export roundtrip)
// ═══════════════════════════════════════════════════════════════════

/**
 * Import 시 GenerateVideo 노드 data에 저장되는 원본 Cut 메타데이터.
 * 캔버스 UI에서 편집할 수 없는 필드를 보존하여 export 시 복원한다.
 */
export interface PreservedCutData {
  cameraDirection: string;
  moodLighting: string;
  imagePrompt: string;
  endImagePrompt: string;
  extendPrompt: string;
  transitionHint: string;
  characterConsistency: string;
  charactersInScene: string[];
  multiShot?: unknown[];
  shotCategory?: string;
  characterRole?: string;
  videoPromptJson?: unknown;
  extendPromptJson?: unknown;
  // 구조 보조 메타 — roundtrip 보존
  structureType?: string;   // "cut" | "scene" | "sequence"
  durationClass?: string;   // "cut-like" | "scene-like" | "sequence-like"
  groupId?: string;
}

/**
 * Import 시 TextInput 노드 data에 저장되는 PromptOutput-level 메타데이터.
 * characterSeeds, continuityRules 등 output-level 정보를 보존한다.
 */
export interface PreservedOutputMeta {
  characterSeeds: unknown[];
  continuityRules: string[];
  globalStylePrompt: string;
  directorPersonaPrompt: string;
  conceptSummary: string;
}

// ═══════════════════════════════════════════════════════════════════
// Pure State Functions
// ═══════════════════════════════════════════════════════════════════

let _nodeCounter = 0;

export function generateNodeId(): string {
  return `node_${Date.now()}_${++_nodeCounter}`;
}

export function generateEdgeId(): string {
  return `edge_${Date.now()}_${++_nodeCounter}`;
}

export function createNode(
  def: NodeDefinition,
  x: number,
  y: number,
): CanvasNode {
  const nodeId = generateNodeId();
  return {
    id: nodeId,
    type: def.type,
    label: def.label,
    category: def.category,
    x,
    y,
    width: def.defaultWidth,
    height: def.defaultHeight,
    inputs: def.inputs.map((p, i) => ({ ...p, id: `${nodeId}_in_${i}` })),
    outputs: def.outputs.map((p, i) => ({ ...p, id: `${nodeId}_out_${i}` })),
    data: { ...def.defaultData },
    status: "idle",
    provenance: { createdAt: Date.now() },
  };
}

export function createInitialCanvasState(): CanvasState {
  return {
    nodes: [],
    edges: [],
    selectedNodeId: null,
  };
}

export function addNode(state: CanvasState, node: CanvasNode): CanvasState {
  return { ...state, nodes: [...state.nodes, node], selectedNodeId: node.id };
}

export function removeNode(state: CanvasState, nodeId: string): CanvasState {
  return {
    ...state,
    nodes: state.nodes.filter(n => n.id !== nodeId),
    edges: state.edges.filter(e => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId),
    selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
  };
}

export function moveNode(state: CanvasState, nodeId: string, x: number, y: number): CanvasState {
  return {
    ...state,
    nodes: state.nodes.map(n => n.id === nodeId ? { ...n, x, y } : n),
  };
}

export function selectNode(state: CanvasState, nodeId: string | null): CanvasState {
  return { ...state, selectedNodeId: nodeId };
}

export function updateNodeData(state: CanvasState, nodeId: string, data: Record<string, unknown>): CanvasState {
  return {
    ...state,
    nodes: state.nodes.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n),
  };
}

export function updateNodeStatus(state: CanvasState, nodeId: string, status: NodeExecutionStatus, outputAsset?: string, outputMimeType?: "image" | "video", error?: string): CanvasState {
  return {
    ...state,
    nodes: state.nodes.map(n => n.id === nodeId ? {
      ...n,
      status,
      outputAsset: outputAsset ?? n.outputAsset,
      outputMimeType: outputMimeType ?? n.outputMimeType,
      error: error ?? (status === "failed" ? n.error : undefined),
      provenance: { ...n.provenance!, executedAt: status === "success" ? Date.now() : n.provenance?.executedAt },
    } : n),
  };
}

/** 포트 타입 호환 검증 */
export function arePortsCompatible(sourcePort: Port, targetPort: Port): boolean {
  if (sourcePort.isInput || !targetPort.isInput) return false;
  if (targetPort.type === "any" || sourcePort.type === "any") return true;
  return sourcePort.type === targetPort.type;
}

export function addEdge(state: CanvasState, sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string): CanvasState {
  // 자기 자신 연결 방지
  if (sourceNodeId === targetNodeId) return state;
  // 중복 연결 방지
  if (state.edges.some(e => e.sourcePortId === sourcePortId && e.targetPortId === targetPortId)) return state;
  // 같은 input port에 두 개 이상 연결 방지
  if (state.edges.some(e => e.targetPortId === targetPortId)) {
    // 기존 연결 제거 후 새 연결
    const filtered = state.edges.filter(e => e.targetPortId !== targetPortId);
    return {
      ...state,
      edges: [...filtered, { id: generateEdgeId(), sourceNodeId, sourcePortId, targetNodeId, targetPortId }],
    };
  }
  return {
    ...state,
    edges: [...state.edges, { id: generateEdgeId(), sourceNodeId, sourcePortId, targetNodeId, targetPortId }],
  };
}

export function removeEdge(state: CanvasState, edgeId: string): CanvasState {
  return { ...state, edges: state.edges.filter(e => e.id !== edgeId) };
}

// ═══════════════════════════════════════════════════════════════════
// Viewport State
// ═══════════════════════════════════════════════════════════════════

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

export function createInitialViewport(): ViewportState {
  return { zoom: 1, panX: 0, panY: 0 };
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.1;

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** 모든 노드를 포함하는 bounding box 계산 후 fit 뷰포트 반환 */
export function fitViewport(nodes: CanvasNode[], containerWidth: number, containerHeight: number): ViewportState {
  if (nodes.length === 0) return createInitialViewport();

  const PADDING = 60;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }

  const contentW = maxX - minX + PADDING * 2;
  const contentH = maxY - minY + PADDING * 2;
  const zoom = clampZoom(Math.min(containerWidth / contentW, containerHeight / contentH));
  const panX = -(minX - PADDING) + (containerWidth / zoom - contentW) / 2;
  const panY = -(minY - PADDING) + (containerHeight / zoom - contentH) / 2;

  return { zoom, panX, panY };
}

// ═══════════════════════════════════════════════════════════════════
// Persistence (localStorage)
// ═══════════════════════════════════════════════════════════════════

const STORAGE_KEY_CANVAS = "node-canvas-state";
const STORAGE_KEY_VIEWPORT = "node-canvas-viewport";

/** CanvasState를 localStorage에 저장 (pendingEdge 제외) */
export function saveCanvasState(state: CanvasState, viewport: ViewportState): void {
  try {
    const { pendingEdge: _pe, ...rest } = state;
    localStorage.setItem(STORAGE_KEY_CANVAS, JSON.stringify(rest));
    localStorage.setItem(STORAGE_KEY_VIEWPORT, JSON.stringify(viewport));
  } catch {
    // quota 초과 등 무시
  }
}

/** localStorage에서 CanvasState 복원. 실패 시 초기 상태 */
export function loadCanvasState(): { canvas: CanvasState; viewport: ViewportState } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CANVAS);
    if (!raw) return { canvas: createInitialCanvasState(), viewport: createInitialViewport() };

    const parsed = JSON.parse(raw);
    // 최소 검증: nodes와 edges가 배열인지
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      throw new Error("Invalid canvas data");
    }

    const canvas: CanvasState = {
      nodes: parsed.nodes,
      edges: parsed.edges,
      selectedNodeId: parsed.selectedNodeId ?? null,
    };

    let viewport = createInitialViewport();
    try {
      const vpRaw = localStorage.getItem(STORAGE_KEY_VIEWPORT);
      if (vpRaw) {
        const vp = JSON.parse(vpRaw);
        if (typeof vp.zoom === "number" && typeof vp.panX === "number" && typeof vp.panY === "number") {
          viewport = { zoom: clampZoom(vp.zoom), panX: vp.panX, panY: vp.panY };
        }
      }
    } catch {
      // viewport 파싱 실패 무시
    }

    return { canvas, viewport };
  } catch {
    return { canvas: createInitialCanvasState(), viewport: createInitialViewport() };
  }
}

/** localStorage에서 캔버스 데이터 삭제 */
export function clearCanvasStorage(): void {
  localStorage.removeItem(STORAGE_KEY_CANVAS);
  localStorage.removeItem(STORAGE_KEY_VIEWPORT);
}

/** 특정 노드의 input에 연결된 source 노드들의 output asset 조회 */
export function getInputAssets(state: CanvasState, nodeId: string): { portId: string; asset?: string; mimeType?: "image" | "video" }[] {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return [];
  return node.inputs.map(input => {
    const edge = state.edges.find(e => e.targetPortId === input.id);
    if (!edge) return { portId: input.id };
    const sourceNode = state.nodes.find(n => n.id === edge.sourceNodeId);
    return {
      portId: input.id,
      asset: sourceNode?.outputAsset,
      mimeType: sourceNode?.outputMimeType,
    };
  });
}
