"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  type CanvasState,
  type CanvasNode,
  type CanvasEdge,
  type NodeDefinition,
  createInitialCanvasState,
  createNode,
  addNode,
  removeNode,
  moveNode,
  selectNode,
  updateNodeData,
  addEdge,
  getInputAssets,
  NODE_REGISTRY,
} from "@/lib/node-types";
import { executeNode, type VideoOutputMeta } from "@/lib/node-execution";
import NodePalette from "./NodePalette";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface NodeCanvasProps {
  /** 비디오 출력을 타임라인으로 보내는 콜백 */
  onSendToTimeline?: (videoUrl: string, meta: VideoOutputMeta) => void;
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

/** 개별 노드 렌더링 */
function CanvasNodeBox({
  node,
  isSelected,
  onMouseDown,
  onPortMouseDown,
  onPortMouseUp,
}: {
  node: CanvasNode;
  isSelected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onPortMouseDown: (portId: string) => void;
  onPortMouseUp: (portId: string) => void;
}) {
  const borderColor = isSelected ? "#787fff" : STATUS_COLORS[node.status] || "#e5e5e5";
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

export default function NodeCanvas({ onSendToTimeline }: NodeCanvasProps) {
  const [state, setState] = useState<CanvasState>(createInitialCanvasState);
  const [showPalette, setShowPalette] = useState(false);
  const [dragState, setDragState] = useState<{
    nodeId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const selectedNode = useMemo(
    () => state.nodes.find(n => n.id === state.selectedNodeId) ?? null,
    [state.nodes, state.selectedNodeId],
  );

  // ── Node actions ──

  const handleAddNode = useCallback((def: NodeDefinition) => {
    const x = 100 + Math.random() * 300;
    const y = 100 + Math.random() * 200;
    const node = createNode(def, x, y);
    setState(prev => addNode(prev, node));
    setShowPalette(false);
  }, []);

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

  // ── Drag handlers ──

  const handleNodeMouseDown = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node) return;
    setState(prev => selectNode(prev, nodeId));
    setDragState({
      nodeId,
      offsetX: e.clientX - node.x,
      offsetY: e.clientY - node.y,
    });
  }, [state.nodes]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragState) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - dragState.offsetX;
      const y = e.clientY - dragState.offsetY;
      setState(prev => moveNode(prev, dragState.nodeId, Math.max(0, x), Math.max(0, y)));
    }
    if (state.pendingEdge) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setState(prev => ({
        ...prev,
        pendingEdge: prev.pendingEdge
          ? { ...prev.pendingEdge, mouseX: e.clientX - rect.left, mouseY: e.clientY - rect.top }
          : undefined,
      }));
    }
  }, [dragState, state.pendingEdge]);

  const handleCanvasMouseUp = useCallback(() => {
    setDragState(null);
    if (state.pendingEdge) {
      setState(prev => ({ ...prev, pendingEdge: undefined }));
    }
  }, [state.pendingEdge]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (e.target === canvasRef.current || (e.target as HTMLElement).tagName === "svg") {
      setState(prev => selectNode(prev, null));
    }
  }, []);

  // ── Port connection handlers ──

  const handlePortMouseDown = useCallback((nodeId: string, portId: string) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
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
        <span className="text-[10px] text-muted-foreground ml-1">
          {state.nodes.length}개 노드 · {state.edges.length}개 연결
        </span>
      </div>

      {/* Canvas Area */}
      <div
        ref={canvasRef}
        className="w-full h-full overflow-auto relative rounded-xl border-2"
        style={{
          background: "radial-gradient(circle, #f8fafc 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          borderColor: "#787fff30",
          cursor: dragState ? "grabbing" : "default",
        }}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onClick={handleCanvasClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {/* Edge lines */}
        <EdgeLines edges={state.edges} nodes={state.nodes} pendingEdge={state.pendingEdge} />

        {/* Nodes */}
        {state.nodes.map(node => (
          <CanvasNodeBox
            key={node.id}
            node={node}
            isSelected={node.id === state.selectedNodeId}
            onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
            onPortMouseDown={(portId) => handlePortMouseDown(node.id, portId)}
            onPortMouseUp={(portId) => handlePortMouseUp(node.id, portId)}
          />
        ))}

        {/* Empty state */}
        {state.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
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
