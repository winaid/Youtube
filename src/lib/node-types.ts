/**
 * node-types.ts — 노드 캔버스 타입 & 헬퍼
 *
 * 캔버스에서 사용하는 노드/엣지/포트 타입 정의와 상태 관리 함수.
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface Port {
  id: string;
  label: string;
  type: "text" | "image" | "video" | "any";
  isInput: boolean;
}

export interface Provenance {
  createdAt?: number;
  executedAt?: number;
  importMeta?: {
    source: string;
    importedAt: number;
    cutNumber?: number;
    projectTitle?: string;
  };
}

export interface CanvasNode {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  inputs: Port[];
  outputs: Port[];
  data: Record<string, unknown>;
  status: "idle" | "running" | "success" | "failed";
  outputAsset?: string;
  outputMimeType?: string;
  error?: string;
  provenance?: Provenance;
}

export interface CanvasEdge {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

export interface PendingEdge {
  sourceNodeId: string;
  sourcePortId: string;
  mouseX: number;
  mouseY: number;
}

export interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  pendingEdge?: PendingEdge;
}

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

/**
 * ShotPlanEntry — shot-by-shot plan의 개별 항목.
 * auto-split / fragmented edit 결과로 생성되며,
 * 각 shot의 독립된 시각 단위를 정의한다.
 */
export interface ShotPlanEntry {
  shotId: string;
  startSec: number;
  endSec: number;
  camera: {
    framing: string;
    angle: string;
    motion: string;
  };
  subject: { primary: string };
  action: string;
  environment: string;
  moodLighting: string;
  role?: string;
}

/** Preserved cut data for roundtrip (non-editable fields stored on generate-video node) */
export interface PreservedCutData {
  cameraDirection?: string;
  moodLighting?: string;
  imagePrompt?: string;
  endImagePrompt?: string;
  extendPrompt?: string;
  transitionHint?: string;
  characterConsistency?: string;
  charactersInScene?: string[];
  multiShot?: unknown[];
  /** Structured shot plan from auto-split (preserves full camera/action metadata) */
  shotPlan?: ShotPlanEntry[];
  shotCategory?: string;
  characterRole?: string;
  structureType?: string;
  durationClass?: string;
  groupId?: string;
  [key: string]: unknown;
}

/** Preserved output-level metadata (stored on first text-input node) */
export interface PreservedOutputMeta {
  globalStylePrompt?: string;
  directorPersonaPrompt?: string;
  characterSeeds?: unknown[];
  continuityRules?: string[];
  projectTitle?: string;
  conceptSummary?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Node Definition (registry)
// ═══════════════════════════════════════════════════════════════════

export interface NodeDefinition {
  type: string;
  label: string;
  category: "image" | "video" | "utility" | "text" | "sound" | "3d";
  enabled: boolean;
  inputs: { id: string; label: string; type: Port["type"]; isInput: true }[];
  outputs: { id: string; label: string; type: Port["type"]; isInput: false }[];
  defaultData: Record<string, unknown>;
}

export const NODE_REGISTRY: NodeDefinition[] = [
  {
    type: "text-input",
    label: "Text Input",
    category: "text",
    enabled: true,
    inputs: [],
    outputs: [{ id: "text-out", label: "text", type: "text", isInput: false }],
    defaultData: { text: "" },
  },
  {
    type: "generate-image",
    label: "Generate Image",
    category: "image",
    enabled: true,
    inputs: [
      { id: "prompt-in", label: "prompt", type: "text", isInput: true },
    ],
    outputs: [{ id: "image-out", label: "image", type: "image", isInput: false }],
    defaultData: { prompt: "", aspectRatio: "16:9", sceneDescription: "", animationMode: "" },
  },
  {
    type: "generate-video",
    label: "Generate Video",
    category: "video",
    enabled: true,
    inputs: [
      { id: "prompt-in", label: "prompt", type: "text", isInput: true },
      { id: "image-in", label: "image", type: "image", isInput: true },
    ],
    outputs: [{ id: "video-out", label: "video", type: "video", isInput: false }],
    defaultData: { prompt: "", durationSec: 6, aspectRatio: "16:9", sceneDescription: "" },
  },
  {
    type: "viewer",
    label: "Viewer",
    category: "utility",
    enabled: true,
    inputs: [{ id: "media-in", label: "media", type: "any", isInput: true }],
    outputs: [],
    defaultData: {},
  },
  {
    type: "edit-image",
    label: "Edit Image",
    category: "image",
    enabled: true,
    inputs: [
      { id: "image-in", label: "image", type: "image", isInput: true },
      { id: "prompt-in", label: "prompt", type: "text", isInput: true },
    ],
    outputs: [{ id: "image-out", label: "image", type: "image", isInput: false }],
    defaultData: { prompt: "", editMode: "inpaint" },
  },
  {
    type: "upscale-image",
    label: "Upscale Image",
    category: "image",
    enabled: true,
    inputs: [
      { id: "image-in", label: "image", type: "image", isInput: true },
    ],
    outputs: [{ id: "image-out", label: "image", type: "image", isInput: false }],
    defaultData: { scale: 2 },
  },
  // Disabled placeholders
  {
    type: "generate-sound",
    label: "Generate Sound",
    category: "sound",
    enabled: false,
    inputs: [{ id: "prompt-in", label: "prompt", type: "text", isInput: true }],
    outputs: [{ id: "audio-out", label: "audio", type: "any", isInput: false }],
    defaultData: {},
  },
  {
    type: "generate-3d",
    label: "Generate 3D",
    category: "3d",
    enabled: false,
    inputs: [{ id: "prompt-in", label: "prompt", type: "text", isInput: true }],
    outputs: [{ id: "model-out", label: "model", type: "any", isInput: false }],
    defaultData: {},
  },
];

// ═══════════════════════════════════════════════════════════════════
// Zoom constants
// ═══════════════════════════════════════════════════════════════════

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 3;

// ═══════════════════════════════════════════════════════════════════
// State management functions
// ═══════════════════════════════════════════════════════════════════

let _counter = 0;
function uid(): string {
  return `node-${Date.now()}-${++_counter}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createInitialCanvasState(): CanvasState {
  return { nodes: [], edges: [], selectedNodeId: null };
}

export function createInitialViewport(): ViewportState {
  return { zoom: 1, panX: 0, panY: 0 };
}

export function createNode(def: NodeDefinition, x: number, y: number): CanvasNode {
  const id = uid();
  return {
    id,
    type: def.type,
    label: def.label,
    x,
    y,
    inputs: def.inputs.map(p => ({ ...p, id: `${id}-${p.id}` })),
    outputs: def.outputs.map(p => ({ ...p, id: `${id}-${p.id}` })),
    data: { ...def.defaultData },
    status: "idle",
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
    nodes: state.nodes.map(n => (n.id === nodeId ? { ...n, x, y } : n)),
  };
}

export function selectNode(state: CanvasState, nodeId: string | null): CanvasState {
  return { ...state, selectedNodeId: nodeId };
}

export function updateNodeData(state: CanvasState, nodeId: string, data: Record<string, unknown>): CanvasState {
  return {
    ...state,
    nodes: state.nodes.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n,
    ),
  };
}

export function updateNodeStatus(
  state: CanvasState,
  nodeId: string,
  status: CanvasNode["status"],
  outputAsset?: string,
  outputMimeType?: string,
  error?: string,
): CanvasState {
  return {
    ...state,
    nodes: state.nodes.map(n => {
      if (n.id !== nodeId) return n;
      const updated: CanvasNode = { ...n, status, outputAsset, outputMimeType, error };
      if (status === "success") {
        updated.provenance = { ...n.provenance, executedAt: Date.now() };
      }
      return updated;
    }),
  };
}

export function addEdge(
  state: CanvasState,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): CanvasState {
  // Prevent self-connection
  if (sourceNodeId === targetNodeId) return state;

  // Prevent duplicate
  const dup = state.edges.find(
    e =>
      e.sourceNodeId === sourceNodeId &&
      e.sourcePortId === sourcePortId &&
      e.targetNodeId === targetNodeId &&
      e.targetPortId === targetPortId,
  );
  if (dup) return state;

  // Replace existing connection on the same target port
  const filtered = state.edges.filter(e => !(e.targetNodeId === targetNodeId && e.targetPortId === targetPortId));

  const edge: CanvasEdge = {
    id: uid(),
    sourceNodeId,
    sourcePortId,
    targetNodeId,
    targetPortId,
  };
  return { ...state, edges: [...filtered, edge] };
}

export function removeEdge(state: CanvasState, edgeId: string): CanvasState {
  return { ...state, edges: state.edges.filter(e => e.id !== edgeId) };
}

export function getInputAssets(
  state: CanvasState,
  nodeId: string,
): { portId: string; asset: string | undefined; mimeType: string | undefined }[] {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return [];

  return node.inputs.map(port => {
    const edge = state.edges.find(e => e.targetNodeId === nodeId && e.targetPortId === port.id);
    if (!edge) return { portId: port.id, asset: undefined, mimeType: undefined };
    const source = state.nodes.find(n => n.id === edge.sourceNodeId);
    return {
      portId: port.id,
      asset: source?.outputAsset,
      mimeType: source?.outputMimeType,
    };
  });
}

export function arePortsCompatible(source: Port, target: Port): boolean {
  // Must be output → input
  if (source.isInput || !target.isInput) return false;
  // "any" is compatible with everything
  if (source.type === "any" || target.type === "any") return true;
  return source.type === target.type;
}

// ═══════════════════════════════════════════════════════════════════
// Viewport helpers
// ═══════════════════════════════════════════════════════════════════

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 120;
const FIT_PADDING = 50;

export function fitViewport(
  nodes: CanvasNode[],
  containerWidth: number,
  containerHeight: number,
): ViewportState {
  if (nodes.length === 0) return createInitialViewport();

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + NODE_WIDTH > maxX) maxX = n.x + NODE_WIDTH;
    if (n.y + NODE_HEIGHT > maxY) maxY = n.y + NODE_HEIGHT;
  }

  const contentW = maxX - minX + FIT_PADDING * 2;
  const contentH = maxY - minY + FIT_PADDING * 2;

  const zoom = clampZoom(Math.min(containerWidth / contentW, containerHeight / contentH));

  const panX = (containerWidth - contentW * zoom) / 2 - minX * zoom + FIT_PADDING * zoom;
  const panY = (containerHeight - contentH * zoom) / 2 - minY * zoom + FIT_PADDING * zoom;

  return { zoom, panX, panY };
}

// ═══════════════════════════════════════════════════════════════════
// Persistence (localStorage)
// ═══════════════════════════════════════════════════════════════════

const CANVAS_KEY = "node-canvas-state";
const VIEWPORT_KEY = "node-canvas-viewport";

export function saveCanvasState(state: CanvasState, viewport: ViewportState): void {
  const { pendingEdge: _, ...saveable } = state;
  try {
    localStorage.setItem(CANVAS_KEY, JSON.stringify(saveable));
    localStorage.setItem(VIEWPORT_KEY, JSON.stringify(viewport));
  } catch {
    /* ignore */
  }
}

export function loadCanvasState(): { canvas: CanvasState; viewport: ViewportState } {
  const defaults = { canvas: createInitialCanvasState(), viewport: createInitialViewport() };

  try {
    const rawCanvas = localStorage.getItem(CANVAS_KEY);
    if (!rawCanvas) return defaults;

    const parsed = JSON.parse(rawCanvas);
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return defaults;
    }

    const canvas: CanvasState = {
      nodes: parsed.nodes,
      edges: parsed.edges,
      selectedNodeId: parsed.selectedNodeId ?? null,
    };

    let viewport = createInitialViewport();
    try {
      const rawVp = localStorage.getItem(VIEWPORT_KEY);
      if (rawVp) {
        const vp = JSON.parse(rawVp);
        viewport = {
          zoom: clampZoom(vp.zoom ?? 1),
          panX: vp.panX ?? 0,
          panY: vp.panY ?? 0,
        };
      }
    } catch {
      /* use default viewport */
    }

    return { canvas, viewport };
  } catch {
    return defaults;
  }
}

export function clearCanvasStorage(): void {
  try {
    localStorage.removeItem(CANVAS_KEY);
    localStorage.removeItem(VIEWPORT_KEY);
  } catch {
    /* ignore */
  }
}
