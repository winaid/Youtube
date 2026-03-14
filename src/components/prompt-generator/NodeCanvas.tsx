"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  type CanvasState,
  type CanvasNode,
  type CanvasEdge,
  type NodeDefinition,
  type ViewportState,
  createInitialCanvasState,
  createInitialViewport,
  createNode,
  addNode,
  removeNode,
  moveNode,
  selectNode,
  updateNodeData,
  addEdge,
  getInputAssets,
  NODE_REGISTRY,
  clampZoom,
  fitViewport,
  saveCanvasState,
  loadCanvasState,
  clearCanvasStorage,
  ZOOM_STEP,
} from "@/lib/node-types";
import { executeNode, type VideoOutputMeta } from "@/lib/node-execution";
import { promptOutputToCanvasState } from "@/lib/sequence-to-nodes";
import {
  exportFromSelectedNode,
  exportAllChainsToPromptOutput,
  canExportFromNode,
  mergeSelectedNodeToOutput,
  mergeAllChainsToOutput,
  findChainFromNode,
  findAllChains,
  getProvenanceCutNumber,
  type MergeResult,
  type MergeError,
  type MergeErrorCode,
} from "@/lib/nodes-to-sequence";
import type { PromptOutput } from "@/types";
import type { PreservedCutData } from "@/lib/node-types";
import StructureMetaBadges from "@/components/shared/StructureMetaBadges";
import NodePalette from "./NodePalette";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface NodeCanvasProps {
  /** 비디오 출력을 타임라인으로 보내는 콜백 */
  onSendToTimeline?: (videoUrl: string, meta: VideoOutputMeta) => void;
  /** 외부에서 import할 PromptOutput (설정 시 import 버튼 활성화) */
  importableOutput?: PromptOutput | null;
  /** 캔버스에서 편집기로 export할 때 호출 (전체 대체) */
  onExportToEditor?: (output: PromptOutput) => void;
  /** 캔버스에서 편집기로 부분 병합할 때 호출 */
  onMergeToEditor?: (output: PromptOutput, mergedCutNumbers: number[]) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const STATUS_COLORS: Record<string, string> = {
  idle: "#d1d5db",
  running: "#f59e0b",
  success: "#22c55e",
  failed: "#ef4444",
};

const CATEGORY_COLORS: Record<string, string> = {
  text: "#6b7280",
  image: "#8b5cf6",
  video: "#22c55e",
  sound: "#f59e0b",
  "3d": "#ec4899",
  utility: "#3b82f6",
};

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

/** 노드 하이라이트 타입 */
type NodeHighlight = "conflict" | "unmatched" | "no-provenance" | null;

const HIGHLIGHT_STYLES: Record<string, { border: string; shadow: string; badge: string; label: string }> = {
  conflict: { border: "#ef4444", shadow: "0 0 8px 2px rgba(239,68,68,0.35)", badge: "#ef4444", label: "충돌" },
  unmatched: { border: "#f59e0b", shadow: "0 0 8px 2px rgba(245,158,11,0.35)", badge: "#f59e0b", label: "미대응" },
  "no-provenance": { border: "#9ca3af", shadow: "none", badge: "#9ca3af", label: "병합 불가" },
};

/** 개별 노드 렌더링 */
function CanvasNodeBox({
  node,
  isSelected,
  highlight,
  onMouseDown,
  onPortMouseDown,
  onPortMouseUp,
}: {
  node: CanvasNode;
  isSelected: boolean;
  highlight?: NodeHighlight;
  onMouseDown: (e: React.MouseEvent) => void;
  onPortMouseDown: (portId: string) => void;
  onPortMouseUp: (portId: string) => void;
}) {
  const hlStyle = highlight ? HIGHLIGHT_STYLES[highlight] : null;
  const borderColor = hlStyle ? hlStyle.border : isSelected ? "#787fff" : STATUS_COLORS[node.status] || "#e5e5e5";
  const boxShadowExtra = hlStyle ? hlStyle.shadow : "none";
  const categoryColor = CATEGORY_COLORS[node.category] || "#787fff";

  return (
    <div
      className="absolute rounded-lg shadow-md select-none cursor-grab active:cursor-grabbing"
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        minHeight: node.height,
        border: `2px solid ${borderColor}`,
        boxShadow: boxShadowExtra !== "none" ? boxShadowExtra : undefined,
        background: "white",
        zIndex: isSelected ? 20 : 10,
      }}
      onMouseDown={onMouseDown}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-2.5 py-1.5 rounded-t-md"
        style={{ background: `${categoryColor}15` }}
      >
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: categoryColor }} />
          <span className="text-[11px] font-semibold" style={{ color: "#333" }}>{node.label}</span>
          {hlStyle && (
            <span
              className="text-[8px] font-bold px-1 py-0.5 rounded"
              style={{ background: hlStyle.badge, color: "white" }}
            >
              {hlStyle.label}
            </span>
          )}
          {node.type === "generate-video" && (() => {
            const p = node.data._preservedCut as PreservedCutData | undefined;
            if (!p?.structureType && !p?.durationClass) return null;
            return (
              <span className="text-[8px]" style={{ color: "#9ca3af" }}>
                {[p.structureType?.toUpperCase(), p.durationClass].filter(Boolean).join(" · ")}
              </span>
            );
          })()}
        </div>
        <div
          className="w-2.5 h-2.5 rounded-full"
          style={{ background: STATUS_COLORS[node.status] || "#d1d5db" }}
          title={node.status}
        />
      </div>

      {/* Ports */}
      <div className="px-2 py-1.5 space-y-1">
        {/* Input ports */}
        {node.inputs.map(port => (
          <div key={port.id} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-full border-2 cursor-crosshair flex-shrink-0"
              style={{ borderColor: "#787fff", background: "white", marginLeft: "-14px" }}
              onMouseUp={(e) => { e.stopPropagation(); onPortMouseUp(port.id); }}
            />
            <span className="text-[9px] text-muted-foreground">{port.label}</span>
          </div>
        ))}
        {/* Output ports */}
        {node.outputs.map(port => (
          <div key={port.id} className="flex items-center justify-end gap-1.5">
            <span className="text-[9px] text-muted-foreground">{port.label}</span>
            <div
              className="w-3 h-3 rounded-full border-2 cursor-crosshair flex-shrink-0"
              style={{ borderColor: "#22c55e", background: "white", marginRight: "-14px" }}
              onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown(port.id); }}
            />
          </div>
        ))}
      </div>

      {/* Status bar */}
      {node.status === "running" && (
        <div className="px-2 pb-1.5">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "#e5e5e5" }}>
            <div className="h-full rounded-full animate-pulse" style={{ background: "#f59e0b", width: "60%" }} />
          </div>
        </div>
      )}
      {node.status === "failed" && node.error && (
        <div className="px-2 pb-1.5">
          <p className="text-[9px] truncate" style={{ color: "#ef4444" }}>{node.error}</p>
        </div>
      )}

      {/* Preview thumbnail */}
      {node.outputAsset && node.outputMimeType === "image" && (
        <div className="px-2 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={node.outputAsset} alt="output" className="w-full h-16 object-cover rounded" />
        </div>
      )}
      {node.outputAsset && node.outputMimeType === "video" && (
        <div className="px-2 pb-2">
          <video src={node.outputAsset} className="w-full h-16 object-cover rounded" muted />
        </div>
      )}
    </div>
  );
}

/** SVG 연결선 */
function EdgeLines({
  edges,
  nodes,
  pendingEdge,
}: {
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  pendingEdge?: CanvasState["pendingEdge"];
}) {
  const getPortPosition = (nodeId: string, portId: string, isInput: boolean): { x: number; y: number } | null => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return null;

    if (isInput) {
      const portIndex = node.inputs.findIndex(p => p.id === portId);
      if (portIndex === -1) return null;
      return { x: node.x - 2, y: node.y + 36 + portIndex * 20 };
    } else {
      const portIndex = node.outputs.findIndex(p => p.id === portId);
      if (portIndex === -1) return null;
      return {
        x: node.x + node.width + 2,
        y: node.y + 36 + node.inputs.length * 20 + portIndex * 20,
      };
    }
  };

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 5 }}>
      {edges.map(edge => {
        const from = getPortPosition(edge.sourceNodeId, edge.sourcePortId, false);
        const to = getPortPosition(edge.targetNodeId, edge.targetPortId, true);
        if (!from || !to) return null;
        const midX = (from.x + to.x) / 2;
        return (
          <path
            key={edge.id}
            d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`}
            fill="none"
            stroke="#787fff"
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}
      {pendingEdge && (() => {
        const from = getPortPosition(pendingEdge.sourceNodeId, pendingEdge.sourcePortId, false);
        if (!from) return null;
        const midX = (from.x + pendingEdge.mouseX) / 2;
        return (
          <path
            d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${pendingEdge.mouseY}, ${pendingEdge.mouseX} ${pendingEdge.mouseY}`}
            fill="none"
            stroke="#787fff80"
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinecap="round"
          />
        );
      })()}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Viewer Panel (선택 노드 결과 미리보기)
// ═══════════════════════════════════════════════════════════════════

function ViewerPanel({
  node,
  state,
  onSendToTimeline,
}: {
  node: CanvasNode;
  state: CanvasState;
  onSendToTimeline?: (videoUrl: string, meta: VideoOutputMeta) => void;
}) {
  // viewer 노드이면 입력 에셋을 표시, 아니면 자체 출력 표시
  const displayAsset = node.type === "viewer"
    ? getInputAssets(state, node.id).find(i => i.asset)?.asset || node.outputAsset
    : node.outputAsset;
  const displayMime = node.type === "viewer"
    ? getInputAssets(state, node.id).find(i => i.asset)?.mimeType || node.outputMimeType
    : node.outputMimeType;

  return (
    <div className="absolute right-3 top-3 z-40 w-80 rounded-xl shadow-lg border"
      style={{ background: "white" }}>
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: "#333" }}>
            {node.label}
          </span>
          <Badge
            variant="outline"
            className="text-[9px]"
            style={{ borderColor: STATUS_COLORS[node.status], color: STATUS_COLORS[node.status] }}
          >
            {node.status}
          </Badge>
        </div>
      </div>

      {/* 구조 메타 (generate-video 노드, preserved metadata에서 읽기) */}
      {node.type === "generate-video" && (() => {
        const p = node.data._preservedCut as PreservedCutData | undefined;
        if (!p?.structureType && !p?.durationClass) return null;
        return (
          <div className="px-3 pb-1 flex items-center gap-1">
            <StructureMetaBadges
              structureType={p?.structureType as "cut" | "scene" | "sequence" | undefined}
              durationClass={p?.durationClass as "cut-like" | "scene-like" | "sequence-like" | undefined}
              compact
            />
          </div>
        );
      })()}

      {/* Preview */}
      <div className="px-3 pb-3">
        {displayAsset && displayMime === "image" && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={displayAsset} alt="preview" className="w-full rounded-lg border" />
        )}
        {displayAsset && displayMime === "video" && (
          <video src={displayAsset} controls className="w-full rounded-lg border" />
        )}
        {!displayAsset && (
          <div className="h-32 rounded-lg border-2 border-dashed flex items-center justify-center text-xs text-muted-foreground">
            {node.status === "running" ? "생성 중..." : "결과 없음 — 노드를 실행하세요"}
          </div>
        )}
      </div>

      {/* Actions */}
      {displayAsset && displayMime === "video" && onSendToTimeline && (
        <div className="px-3 pb-3">
          <Button
            size="sm"
            className="w-full h-7 text-xs text-white"
            style={{ background: "#787fff" }}
            onClick={() => onSendToTimeline(displayAsset, {
              nodeId: node.id,
              nodeLabel: node.label,
              prompt: (node.data.prompt as string) || "",
              durationSec: (node.data.durationSec as number) || 6,
              aspectRatio: (node.data.aspectRatio as string) || "16:9",
              generatedAt: Date.now(),
            })}
          >
            타임라인에 추가
          </Button>
        </div>
      )}

      {/* Node settings */}
      {node.type === "generate-image" && (
        <NodeSettings node={node} />
      )}
      {node.type === "edit-image" && (
        <NodeSettings node={node} />
      )}
      {node.type === "generate-video" && (
        <NodeSettings node={node} />
      )}
      {node.type === "text-input" && (
        <NodeSettings node={node} />
      )}

      {node.error && (
        <div className="px-3 pb-3">
          <p className="text-[10px] rounded p-1.5" style={{ color: "#ef4444", background: "#fef2f2" }}>
            {node.error}
          </p>
        </div>
      )}
    </div>
  );
}

/** 노드별 설정 패널 (ViewerPanel 하단에 표시) */
function NodeSettings({ node }: { node: CanvasNode }) {
  return (
    <div className="px-3 pb-3 space-y-1.5">
      <div className="text-[10px] font-medium text-muted-foreground">설정</div>
      {Object.entries(node.data).map(([key, value]) => (
        <div key={key} className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">{key}</span>
          <span className="truncate ml-2 max-w-[140px]" style={{ color: "#333" }}>
            {typeof value === "string" ? (value || "(비어 있음)") : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════

export default function NodeCanvas({ onSendToTimeline, importableOutput, onExportToEditor, onMergeToEditor }: NodeCanvasProps) {
  // ── 초기 상태: localStorage에서 복원 ──
  const [state, setState] = useState<CanvasState>(() => {
    if (typeof window === "undefined") return createInitialCanvasState();
    return loadCanvasState().canvas;
  });
  const [viewport, setViewport] = useState<ViewportState>(() => {
    if (typeof window === "undefined") return createInitialViewport();
    return loadCanvasState().viewport;
  });
  const [showPalette, setShowPalette] = useState(false);
  const [dragState, setDragState] = useState<{
    nodeId: string;
    startX: number;
    startY: number;
    nodeStartX: number;
    nodeStartY: number;
  } | null>(null);
  const [panDrag, setPanDrag] = useState<{
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedNode = useMemo(
    () => state.nodes.find(n => n.id === state.selectedNodeId) ?? null,
    [state.nodes, state.selectedNodeId],
  );

  // ── Auto-save (debounce 500ms) ──
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveCanvasState(state, viewport);
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [state, viewport]);

  // ── Node actions ──

  const handleAddNode = useCallback((def: NodeDefinition) => {
    // 뷰포트 중심에 노드 배치
    const rect = canvasRef.current?.getBoundingClientRect();
    const cx = rect ? (rect.width / 2 / viewport.zoom - viewport.panX) : 100 + Math.random() * 300;
    const cy = rect ? (rect.height / 2 / viewport.zoom - viewport.panY) : 100 + Math.random() * 200;
    const x = cx - def.defaultWidth / 2 + (Math.random() - 0.5) * 40;
    const y = cy - def.defaultHeight / 2 + (Math.random() - 0.5) * 40;
    const node = createNode(def, x, y);
    setState(prev => addNode(prev, node));
    setShowPalette(false);
  }, [viewport]);

  /** Assets/History 탭에서 asset을 Viewer 노드로 캔버스에 삽입 */
  const handleInsertAsset = useCallback((asset: string, mimeType: "image" | "video") => {
    const viewerDef = NODE_REGISTRY.find(d => d.type === "viewer");
    if (!viewerDef) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const cx = rect ? (rect.width / 2 / viewport.zoom - viewport.panX) : 200;
    const cy = rect ? (rect.height / 2 / viewport.zoom - viewport.panY) : 200;
    const x = cx - viewerDef.defaultWidth / 2 + (Math.random() - 0.5) * 40;
    const y = cy - viewerDef.defaultHeight / 2 + (Math.random() - 0.5) * 40;
    const node = createNode(viewerDef, x, y);
    setState(prev => addNode(prev, { ...node, outputAsset: asset, outputMimeType: mimeType, status: "success" }));
    setShowPalette(false);
  }, [viewport]);

  const handleDeleteSelected = useCallback(() => {
    if (!state.selectedNodeId) return;
    setState(prev => removeNode(prev, prev.selectedNodeId!));
  }, [state.selectedNodeId]);

  const handleExecuteSelected = useCallback(async () => {
    if (!state.selectedNodeId) return;
    const callbacks = {
      onStateChange: setState,
      onVideoOutputReady: onSendToTimeline
        ? (_nodeId: string, videoUrl: string, meta: VideoOutputMeta) => {
            onSendToTimeline(videoUrl, meta);
          }
        : undefined,
    };
    await executeNode(state.selectedNodeId, state, callbacks);
  }, [state, onSendToTimeline]);

  const handleUpdateSelectedData = useCallback((key: string, value: unknown) => {
    if (!state.selectedNodeId) return;
    setState(prev => updateNodeData(prev, prev.selectedNodeId!, { [key]: value }));
  }, [state.selectedNodeId]);

  // ── 새 캔버스 / 초기화 ──
  const handleResetCanvas = useCallback(() => {
    if (state.nodes.length > 0 && !window.confirm("캔버스를 초기화하시겠습니까? 모든 노드와 연결이 삭제됩니다.")) return;
    setState(createInitialCanvasState());
    setViewport(createInitialViewport());
    clearCanvasStorage();
  }, [state.nodes.length]);

  // ── Import structured sequence ──
  const handleImportSequence = useCallback(() => {
    if (!importableOutput) return;
    if (state.nodes.length > 0 && !window.confirm("현재 캔버스를 프롬프트 결과로 대체하시겠습니까?")) return;
    const imported = promptOutputToCanvasState(importableOutput);
    setState(imported);
    // fit-to-screen
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      setViewport(fitViewport(imported.nodes, rect.width, rect.height));
    } else {
      setViewport(createInitialViewport());
    }
    saveCanvasState(imported, viewport);
  }, [importableOutput, state.nodes.length, viewport]);

  // ── Node highlights (merge feedback) ──
  const [nodeHighlights, setNodeHighlights] = useState<Map<string, NodeHighlight>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyHighlights = useCallback((highlights: Map<string, NodeHighlight>, durationMs = 5000) => {
    setNodeHighlights(highlights);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setNodeHighlights(new Map()), durationMs);
  }, []);

  const clearHighlights = useCallback(() => {
    setNodeHighlights(new Map());
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  // ── Pre-merge provenance check ──
  const selectedChainMergeInfo = useMemo(() => {
    if (!state.selectedNodeId || !onMergeToEditor || !importableOutput) return null;
    const chain = findChainFromNode(state, state.selectedNodeId);
    if (!chain) return null;
    const cutNumber = getProvenanceCutNumber(chain);
    return { hasProvenance: cutNumber != null, cutNumber };
  }, [state, onMergeToEditor, importableOutput]);

  const allChainsMergeInfo = useMemo(() => {
    if (!onMergeToEditor || !importableOutput) return null;
    const chains = findAllChains(state);
    if (chains.length === 0) return null;
    const withProv = chains.filter(c => getProvenanceCutNumber(c) != null).length;
    const withoutProv = chains.length - withProv;
    return { total: chains.length, withProvenance: withProv, withoutProvenance: withoutProv };
  }, [state, onMergeToEditor, importableOutput]);

  // ── Export to editor ──
  const [exportMessage, setExportMessage] = useState<{ text: string; type: "success" | "error" | "warning" } | null>(null);

  const selectedCanExport = useMemo(() => {
    if (!state.selectedNodeId) return false;
    return canExportFromNode(state, state.selectedNodeId);
  }, [state]);

  const handleExportSelected = useCallback(() => {
    if (!onExportToEditor || !state.selectedNodeId) return;
    const result = exportFromSelectedNode(state, state.selectedNodeId);
    if (!result.success) {
      setExportMessage({ text: result.reason, type: "error" });
      setTimeout(() => setExportMessage(null), 3000);
      return;
    }
    onExportToEditor(result.output);
    setExportMessage({ text: `${result.output.totalCuts}컷을 편집기로 보냈습니다`, type: "success" });
    setTimeout(() => setExportMessage(null), 3000);
  }, [onExportToEditor, state]);

  const handleExportAll = useCallback(() => {
    if (!onExportToEditor) return;
    const result = exportAllChainsToPromptOutput(state);
    if (!result.success) {
      setExportMessage({ text: result.reason, type: "error" });
      setTimeout(() => setExportMessage(null), 3000);
      return;
    }
    onExportToEditor(result.output);
    setExportMessage({ text: `${result.output.totalCuts}컷 전체를 편집기로 보냈습니다`, type: "success" });
    setTimeout(() => setExportMessage(null), 3000);
  }, [onExportToEditor, state]);

  // ── Merge export (부분 병합) ──

  /** MergeErrorCode 기반 UI 메시지 분기 */
  const getMergeErrorDisplay = useCallback((err: MergeError): { text: string; timeout: number } => {
    const codeMap: Record<MergeErrorCode, { text: string; timeout: number }> = {
      EMPTY_CHAINS: { text: "병합할 체인이 없습니다.", timeout: 3000 },
      EMPTY_BASE: { text: "기존 결과가 비어 있어 병합할 수 없습니다. 전체 보내기를 사용하세요.", timeout: 4000 },
      DUPLICATE_TARGET_CUT: {
        text: `Cut ${err.conflictedCutNumbers?.join(", ")}번 충돌 — 같은 cut을 가리키는 중복 체인을 제거하세요.`,
        timeout: 5000,
      },
      NO_MATCHED_CHAINS: { text: err.reason, timeout: 4000 },
      NO_CHAIN_FOUND: { text: "선택된 노드에서 체인을 찾을 수 없습니다.", timeout: 3000 },
      NO_VIDEO_NODES: { text: "캔버스에 비디오 생성 노드가 없습니다.", timeout: 3000 },
    };
    return codeMap[err.code] || { text: err.reason, timeout: 3000 };
  }, []);

  /** merge 실패 메시지 + 노드 하이라이트 */
  const showMergeError = useCallback((err: MergeError) => {
    const display = getMergeErrorDisplay(err);
    setExportMessage({ text: display.text, type: "error" });
    setTimeout(() => setExportMessage(null), display.timeout);

    // conflict 노드 → 빨간 하이라이트
    if (err.code === "DUPLICATE_TARGET_CUT" && err.conflictedChainNodeIds) {
      const hl = new Map<string, NodeHighlight>();
      for (const id of err.conflictedChainNodeIds) hl.set(id, "conflict");
      applyHighlights(hl, display.timeout);
    }
    // provenance 없는 chain → 회색 하이라이트
    if (err.code === "NO_MATCHED_CHAINS") {
      const chains = findAllChains(state);
      const hl = new Map<string, NodeHighlight>();
      for (const c of chains) {
        if (getProvenanceCutNumber(c) == null) hl.set(c.videoNode.id, "no-provenance");
      }
      if (hl.size > 0) applyHighlights(hl, display.timeout);
    }
  }, [getMergeErrorDisplay, applyHighlights, state]);

  /** merge 성공 메시지 + unmatched 하이라이트 */
  const showMergeSuccess = useCallback((res: MergeResult) => {
    const merged = res.mergedCutNumbers;
    const unmatched = res.unmatchedChainNodeIds;
    let text: string;
    const type: "success" | "warning" = unmatched.length > 0 ? "warning" : "success";

    if (unmatched.length > 0) {
      text = `Cut ${merged.join(",")} 병합 완료 — ${unmatched.length}개 체인 제외 (대응 cut 없음)`;
    } else {
      text = `Cut ${merged.join(",")} 병합 완료 (${merged.length}개)`;
    }
    setExportMessage({ text, type });
    setTimeout(() => setExportMessage(null), 3000);

    // unmatched 노드 amber 하이라이트
    if (unmatched.length > 0) {
      const hl = new Map<string, NodeHighlight>();
      for (const id of unmatched) hl.set(id, "unmatched");
      applyHighlights(hl, 5000);
    } else {
      clearHighlights();
    }
  }, [applyHighlights, clearHighlights]);

  const handleMergeSelected = useCallback(() => {
    if (!onMergeToEditor || !importableOutput || !state.selectedNodeId) return;
    const result = mergeSelectedNodeToOutput(state, state.selectedNodeId, importableOutput);
    if (!result.success) { showMergeError(result); return; }
    onMergeToEditor(result.output, result.mergedCutNumbers);
    showMergeSuccess(result);
  }, [onMergeToEditor, importableOutput, state, showMergeError, showMergeSuccess]);

  const handleMergeAll = useCallback(() => {
    if (!onMergeToEditor || !importableOutput) return;
    const result = mergeAllChainsToOutput(state, importableOutput);
    if (!result.success) { showMergeError(result); return; }
    onMergeToEditor(result.output, result.mergedCutNumbers);
    showMergeSuccess(result);
  }, [onMergeToEditor, importableOutput, state, showMergeError, showMergeSuccess]);

  // ── Viewport controls ──
  const handleZoomIn = useCallback(() => {
    setViewport(v => ({ ...v, zoom: clampZoom(v.zoom + ZOOM_STEP) }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewport(v => ({ ...v, zoom: clampZoom(v.zoom - ZOOM_STEP) }));
  }, []);

  const handleResetView = useCallback(() => {
    setViewport(createInitialViewport());
  }, []);

  const handleFitToScreen = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setViewport(fitViewport(state.nodes, rect.width, rect.height));
  }, [state.nodes]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    // 마우스 위치 기준 줌
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setViewport(v => {
      const oldZoom = v.zoom;
      const newZoom = clampZoom(oldZoom - e.deltaY * 0.001);
      // 마우스 위치를 기준으로 줌
      const scale = newZoom / oldZoom;
      const panX = mouseX / newZoom - (mouseX / oldZoom - v.panX) ;
      const panY = mouseY / newZoom - (mouseY / oldZoom - v.panY);
      return { zoom: newZoom, panX: panX, panY: panY };
    });
  }, []);

  // ── Drag handlers ──

  const handleNodeMouseDown = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node) return;
    setState(prev => selectNode(prev, nodeId));
    setDragState({
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      nodeStartX: node.x,
      nodeStartY: node.y,
    });
  }, [state.nodes]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    // 빈 캔버스 클릭 시 pan 시작
    const target = e.target as HTMLElement;
    const isCanvas = target === canvasRef.current || target.dataset.canvasBackground === "true";
    if (isCanvas && e.button === 0) {
      setPanDrag({
        startX: e.clientX,
        startY: e.clientY,
        startPanX: viewport.panX,
        startPanY: viewport.panY,
      });
    }
  }, [viewport.panX, viewport.panY]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragState) {
      const dx = (e.clientX - dragState.startX) / viewport.zoom;
      const dy = (e.clientY - dragState.startY) / viewport.zoom;
      setState(prev => moveNode(prev, dragState.nodeId, dragState.nodeStartX + dx, dragState.nodeStartY + dy));
    }
    if (panDrag) {
      const dx = (e.clientX - panDrag.startX) / viewport.zoom;
      const dy = (e.clientY - panDrag.startY) / viewport.zoom;
      setViewport(v => ({ ...v, panX: panDrag.startPanX + dx, panY: panDrag.startPanY + dy }));
    }
    if (state.pendingEdge) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = (e.clientX - rect.left) / viewport.zoom - viewport.panX;
      const mouseY = (e.clientY - rect.top) / viewport.zoom - viewport.panY;
      setState(prev => ({
        ...prev,
        pendingEdge: prev.pendingEdge
          ? { ...prev.pendingEdge, mouseX, mouseY }
          : undefined,
      }));
    }
  }, [dragState, panDrag, state.pendingEdge, viewport]);

  const handleCanvasMouseUp = useCallback(() => {
    setDragState(null);
    setPanDrag(null);
    if (state.pendingEdge) {
      setState(prev => ({ ...prev, pendingEdge: undefined }));
    }
  }, [state.pendingEdge]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isCanvas = target === canvasRef.current || target.dataset.canvasBackground === "true" || target.tagName === "svg";
    if (isCanvas) {
      setState(prev => selectNode(prev, null));
    }
  }, []);

  // ── Port connection handlers ──

  const handlePortMouseDown = useCallback((nodeId: string, portId: string) => {
    setState(prev => ({
      ...prev,
      pendingEdge: { sourceNodeId: nodeId, sourcePortId: portId, mouseX: 0, mouseY: 0 },
    }));
  }, []);

  const handlePortMouseUp = useCallback((nodeId: string, portId: string) => {
    if (!state.pendingEdge) return;
    setState(prev => {
      const next = addEdge(prev, prev.pendingEdge!.sourceNodeId, prev.pendingEdge!.sourcePortId, nodeId, portId);
      return { ...next, pendingEdge: undefined };
    });
  }, [state.pendingEdge]);

  // ── Keyboard ──

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      if (state.selectedNodeId && document.activeElement === canvasRef.current) {
        handleDeleteSelected();
      }
    }
  }, [state.selectedNodeId, handleDeleteSelected]);

  // ═══════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="relative w-full" style={{ height: "calc(100vh - 200px)", minHeight: "500px" }}>
      {/* Toolbar */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full shadow-md border"
        style={{ background: "white" }}>
        <Button
          size="sm"
          className="h-7 text-xs text-white"
          style={{ background: "#787fff" }}
          onClick={() => setShowPalette(v => !v)}
        >
          + Add Node
        </Button>
        {state.selectedNodeId && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={handleExecuteSelected}
              disabled={selectedNode?.status === "running"}
            >
              {selectedNode?.status === "running" ? "실행 중..." : "실행"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              style={{ color: "#ef4444" }}
              onClick={handleDeleteSelected}
            >
              삭제
            </Button>
          </>
        )}
        <div className="h-4 w-px bg-gray-200" />
        <Button size="sm" variant="ghost" className="h-7 w-7 text-xs p-0" onClick={handleZoomOut} title="Zoom Out">-</Button>
        <span className="text-[10px] text-muted-foreground min-w-[36px] text-center">{Math.round(viewport.zoom * 100)}%</span>
        <Button size="sm" variant="ghost" className="h-7 w-7 text-xs p-0" onClick={handleZoomIn} title="Zoom In">+</Button>
        <Button size="sm" variant="ghost" className="h-7 text-[10px] px-1.5" onClick={handleFitToScreen} title="Fit to Screen">Fit</Button>
        <Button size="sm" variant="ghost" className="h-7 text-[10px] px-1.5" onClick={handleResetView} title="Reset View">1:1</Button>
        <div className="h-4 w-px bg-gray-200" />
        <Button size="sm" variant="ghost" className="h-7 text-[10px] px-1.5" onClick={handleResetCanvas} title="새 캔버스">초기화</Button>
        {importableOutput && importableOutput.cuts?.length > 0 && (
          <>
            <div className="h-4 w-px bg-gray-200" />
            <Button
              size="sm"
              className="h-7 text-[10px] px-2 text-white"
              style={{ background: "#8b5cf6" }}
              onClick={handleImportSequence}
              title="프롬프트 결과를 캔버스로 가져오기"
            >
              프롬프트 가져오기 ({importableOutput.cuts.length}컷)
            </Button>
          </>
        )}
        {onExportToEditor && state.nodes.some(n => n.type === "generate-video") && (
          <>
            <div className="h-4 w-px bg-gray-200" />
            {state.selectedNodeId && selectedCanExport && (
              <Button
                size="sm"
                className="h-7 text-[10px] px-2 text-white"
                style={{ background: "#22c55e" }}
                onClick={handleExportSelected}
                title="선택된 체인을 편집기로 보내기"
              >
                선택 항목 보내기
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] px-2"
              onClick={handleExportAll}
              title="전체 체인을 편집기로 보내기"
            >
              전체 보내기
            </Button>
          </>
        )}
        {onMergeToEditor && importableOutput && state.nodes.some(n => n.type === "generate-video") && (
          <>
            <div className="h-4 w-px bg-gray-200" />
            {state.selectedNodeId && selectedCanExport && (
              <>
                <Button
                  size="sm"
                  className="h-7 text-[10px] px-2 text-white"
                  style={{
                    background: selectedChainMergeInfo?.hasProvenance === false ? "#9ca3af" : "#f59e0b",
                  }}
                  onClick={handleMergeSelected}
                  title={
                    selectedChainMergeInfo?.hasProvenance === false
                      ? "이 체인은 가져온 cut이 아니어서 병합 불가"
                      : "선택된 체인만 기존 결과에 병합"
                  }
                >
                  선택 병합
                  {selectedChainMergeInfo?.hasProvenance === false && (
                    <span className="ml-1 text-[8px] opacity-80">⚠</span>
                  )}
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] px-2 border-amber-300 text-amber-700"
              onClick={handleMergeAll}
              title={
                allChainsMergeInfo && allChainsMergeInfo.withoutProvenance > 0
                  ? `${allChainsMergeInfo.withoutProvenance}개 체인은 병합 불가 (provenance 없음)`
                  : "편집된 체인만 기존 결과에 부분 병합"
              }
            >
              전체 병합
              {allChainsMergeInfo && allChainsMergeInfo.withoutProvenance > 0 && (
                <span className="ml-1 text-[8px] text-amber-500">
                  ({allChainsMergeInfo.withProvenance}/{allChainsMergeInfo.total})
                </span>
              )}
            </Button>
          </>
        )}
        <span className="text-[10px] text-muted-foreground ml-1">
          {state.nodes.length}개 노드 · {state.edges.length}개 연결
        </span>
      </div>

      {/* Export feedback message */}
      {exportMessage && (
        <div
          className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-md text-xs font-medium"
          style={{
            background: exportMessage.type === "success" ? "#22c55e" : exportMessage.type === "warning" ? "#f59e0b" : "#ef4444",
            color: "white",
          }}
        >
          {exportMessage.text}
        </div>
      )}

      {/* Canvas Area */}
      <div
        ref={canvasRef}
        className="w-full h-full overflow-hidden relative rounded-xl border-2"
        style={{
          borderColor: "#787fff30",
          cursor: panDrag ? "grabbing" : dragState ? "grabbing" : "default",
        }}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onClick={handleCanvasClick}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {/* Background grid (fixed, not transformed) */}
        <div
          data-canvas-background="true"
          className="absolute inset-0"
          style={{
            background: "radial-gradient(circle, #f8fafc 1px, transparent 1px)",
            backgroundSize: `${20 * viewport.zoom}px ${20 * viewport.zoom}px`,
            backgroundPosition: `${viewport.panX * viewport.zoom}px ${viewport.panY * viewport.zoom}px`,
          }}
        />

        {/* Transformed content layer */}
        <div
          style={{
            transform: `scale(${viewport.zoom}) translate(${viewport.panX}px, ${viewport.panY}px)`,
            transformOrigin: "0 0",
            position: "absolute",
            top: 0,
            left: 0,
            width: "10000px",
            height: "10000px",
          }}
        >
          {/* Edge lines */}
          <EdgeLines edges={state.edges} nodes={state.nodes} pendingEdge={state.pendingEdge} />

          {/* Nodes */}
          {state.nodes.map(node => (
            <CanvasNodeBox
              key={node.id}
              node={node}
              isSelected={node.id === state.selectedNodeId}
              highlight={nodeHighlights.get(node.id) ?? null}
              onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
              onPortMouseDown={(portId) => handlePortMouseDown(node.id, portId)}
              onPortMouseUp={(portId) => handlePortMouseUp(node.id, portId)}
            />
          ))}
        </div>

        {/* Empty state */}
        {state.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">노드 캔버스가 비어 있습니다</p>
              <Button
                size="sm"
                className="h-8 text-xs text-white"
                style={{ background: "#787fff" }}
                onClick={() => setShowPalette(true)}
              >
                + 첫 노드 추가하기
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Node Palette */}
      {showPalette && (
        <NodePalette
          onAddNode={handleAddNode}
          onClose={() => setShowPalette(false)}
          canvasNodes={state.nodes}
          onInsertAsset={handleInsertAsset}
        />
      )}

      {/* Viewer / Inspector Panel */}
      {selectedNode && (
        <ViewerPanel
          node={selectedNode}
          state={state}
          onSendToTimeline={onSendToTimeline}
        />
      )}

      {/* Selected node inline editor */}
      {selectedNode && selectedNode.type !== "viewer" && (
        <div className="absolute bottom-3 left-3 z-40 w-72 rounded-xl shadow-lg border p-3 space-y-2"
          style={{ background: "white" }}>
          <div className="text-[10px] font-medium text-muted-foreground">노드 편집: {selectedNode.label}</div>
          {selectedNode.type === "text-input" && (
            <textarea
              className="w-full h-20 text-xs border rounded-md p-2 resize-none focus:outline-none focus:ring-1"
              style={{ borderColor: "#e5e5e5" }}
              placeholder="텍스트를 입력하세요..."
              value={(selectedNode.data.text as string) || ""}
              onChange={e => handleUpdateSelectedData("text", e.target.value)}
            />
          )}
          {(selectedNode.type === "generate-image" || selectedNode.type === "generate-video") && (
            <>
              <textarea
                className="w-full h-16 text-xs border rounded-md p-2 resize-none focus:outline-none focus:ring-1"
                style={{ borderColor: "#e5e5e5" }}
                placeholder="프롬프트를 입력하세요..."
                value={(selectedNode.data.prompt as string) || ""}
                onChange={e => handleUpdateSelectedData("prompt", e.target.value)}
              />
              <div className="flex gap-2">
                <select
                  className="flex-1 h-7 text-[10px] border rounded-md px-1.5"
                  value={(selectedNode.data.aspectRatio as string) || "16:9"}
                  onChange={e => handleUpdateSelectedData("aspectRatio", e.target.value)}
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
                {selectedNode.type === "generate-video" && (
                  <select
                    className="flex-1 h-7 text-[10px] border rounded-md px-1.5"
                    value={String((selectedNode.data.durationSec as number) || 6)}
                    onChange={e => handleUpdateSelectedData("durationSec", parseInt(e.target.value))}
                  >
                    <option value="4">4초</option>
                    <option value="6">6초</option>
                    <option value="8">8초</option>
                  </select>
                )}
              </div>
            </>
          )}
          {selectedNode.type === "edit-image" && (
            <>
              <textarea
                className="w-full h-16 text-xs border rounded-md p-2 resize-none focus:outline-none focus:ring-1"
                style={{ borderColor: "#e5e5e5" }}
                placeholder="편집 프롬프트를 입력하세요..."
                value={(selectedNode.data.prompt as string) || ""}
                onChange={e => handleUpdateSelectedData("prompt", e.target.value)}
              />
              <select
                className="w-full h-7 text-[10px] border rounded-md px-1.5"
                value={(selectedNode.data.editMode as string) || "inpaint"}
                onChange={e => handleUpdateSelectedData("editMode", e.target.value)}
              >
                <option value="inpaint">인페인트</option>
                <option value="outpaint">아웃페인트</option>
              </select>
            </>
          )}
          <Button
            size="sm"
            className="w-full h-7 text-xs text-white"
            style={{ background: selectedNode.status === "running" ? "#f59e0b" : "#787fff" }}
            onClick={handleExecuteSelected}
            disabled={selectedNode.status === "running"}
          >
            {selectedNode.status === "running" ? "처리 중..." : "실행"}
          </Button>
        </div>
      )}
    </div>
  );
}
