"use client";

import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NODE_REGISTRY, type NodeCategory, type NodeDefinition, type CanvasNode } from "@/lib/node-types";
import { getVideoHistory, type VideoRecord } from "@/lib/video-history";
import { getPromptHistory, type PromptHistoryEntry } from "@/lib/prompt-history";
import {
  collectCanvasAssets,
  collectVideoAssets,
  collectPromptItems,
  type PaletteTab,
  type AssetItem,
  type PromptItem,
} from "@/lib/palette-helpers";

export type { PaletteTab, AssetItem, PromptItem };
export { collectCanvasAssets, collectVideoAssets, collectPromptItems };

export interface NodePaletteProps {
  onAddNode: (def: NodeDefinition) => void;
  onClose: () => void;
  /** 현재 캔버스 노드 (Assets 탭에서 outputAsset 수집용) */
  canvasNodes?: CanvasNode[];
  /** asset을 Viewer 노드로 캔버스에 삽입 */
  onInsertAsset?: (asset: string, mimeType: "image" | "video") => void;
  /** prompt 텍스트를 TextInput 노드로 캔버스에 삽입 */
  onInsertPrompt?: (text: string) => void;
  /** prompt 텍스트로 TextInput + GenerateVideo 체인을 캔버스에 삽입 */
  onInsertPromptChain?: (text: string) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const TABS: { key: PaletteTab; label: string }[] = [
  { key: "addNode", label: "Add Node" },
  { key: "assets", label: "Assets" },
  { key: "history", label: "History" },
];

const CATEGORIES: { key: NodeCategory; label: string; color: string }[] = [
  { key: "all", label: "All", color: "#787fff" },
  { key: "text", label: "Text", color: "#6b7280" },
  { key: "image", label: "Image", color: "#8b5cf6" },
  { key: "video", label: "Video", color: "#22c55e" },
  { key: "sound", label: "Sound", color: "#f59e0b" },
  { key: "3d", label: "3D", color: "#ec4899" },
  { key: "utility", label: "Utility", color: "#3b82f6" },
];

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function NodePalette({ onAddNode, onClose, canvasNodes, onInsertAsset, onInsertPrompt, onInsertPromptChain }: NodePaletteProps) {
  const [activeTab, setActiveTab] = useState<PaletteTab>("addNode");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<NodeCategory>("all");
  const [videoRecords, setVideoRecords] = useState<VideoRecord[]>([]);
  const [promptEntries, setPromptEntries] = useState<PromptHistoryEntry[]>([]);

  // Video history 로드 (History/Assets 탭용)
  useEffect(() => {
    setVideoRecords(getVideoHistory());

    const handler = () => setVideoRecords(getVideoHistory());
    window.addEventListener("video-history-updated", handler);
    return () => window.removeEventListener("video-history-updated", handler);
  }, []);

  // Prompt history 로드 (History 탭용)
  useEffect(() => {
    setPromptEntries(getPromptHistory());
  }, []);

  // ── Add Node 탭 필터 ──
  const filtered = useMemo(() => {
    return NODE_REGISTRY.filter(def => {
      if (activeCategory !== "all" && def.category !== activeCategory) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return def.label.toLowerCase().includes(q) || def.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [search, activeCategory]);

  // ── Assets 탭 데이터 ──
  const assets = useMemo(() => {
    const canvasAssets = collectCanvasAssets(canvasNodes || []);
    const videoAssets = collectVideoAssets(videoRecords);
    return [...canvasAssets, ...videoAssets];
  }, [canvasNodes, videoRecords]);

  // ── History 탭 데이터 ──
  const historyItems = useMemo(() => {
    return videoRecords.filter(r => r.status === "completed").slice(0, 30);
  }, [videoRecords]);

  const promptItems = useMemo(() => {
    return collectPromptItems(promptEntries);
  }, [promptEntries]);

  return (
    <div className="absolute left-3 top-3 z-50 w-72 rounded-xl shadow-lg border"
      style={{ background: "white" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-sm font-semibold" style={{ color: "#333" }}>
          {activeTab === "addNode" ? "Add Node" : activeTab === "assets" ? "Assets" : "History"}
        </span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-xs" onClick={onClose}>
          ✕
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 px-3 pb-2">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            data-testid={`palette-tab-${tab.key}`}
            className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all"
            style={
              activeTab === tab.key
                ? { background: "#787fff", color: "white" }
                : { background: "#f3f4f6", color: "#6b7280" }
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════ Add Node Tab ══════ */}
      {activeTab === "addNode" && (
        <>
          {/* Search */}
          <div className="px-3 pb-2">
            <input
              type="text"
              placeholder="Search nodes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-8 px-2.5 text-xs border rounded-md focus:outline-none focus:ring-1"
              style={{ borderColor: "#e5e5e5" }}
              autoFocus
            />
          </div>

          {/* Categories */}
          <div className="flex gap-1 px-3 pb-2 flex-wrap">
            {CATEGORIES.map(cat => (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-all"
                style={
                  activeCategory === cat.key
                    ? { background: cat.color, color: "white" }
                    : { background: `${cat.color}15`, color: cat.color }
                }
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Node List */}
          <div className="max-h-64 overflow-y-auto px-2 pb-2 space-y-1">
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                일치하는 노드가 없습니다
              </p>
            )}
            {filtered.map(def => {
              const catDef = CATEGORIES.find(c => c.key === def.category);
              return (
                <button
                  key={def.type}
                  onClick={() => def.enabled && onAddNode(def)}
                  disabled={!def.enabled}
                  className="w-full flex items-start gap-2 px-2.5 py-2 rounded-lg text-left transition-all hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div
                    className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                    style={{ background: catDef?.color || "#999" }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{def.label}</span>
                      {!def.enabled && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0" style={{ borderColor: "#d1d5db", color: "#9ca3af" }}>
                          coming soon
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                      {def.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ══════ Assets Tab ══════ */}
      {activeTab === "assets" && (
        <div className="max-h-72 overflow-y-auto px-2 pb-2 space-y-1">
          {assets.length === 0 ? (
            <div className="text-center py-6" data-testid="assets-empty">
              <p className="text-xs text-muted-foreground">사용 가능한 에셋이 없습니다</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                이미지/비디오를 생성하면 여기에 표시됩니다
              </p>
            </div>
          ) : (
            assets.map(asset => (
              <button
                key={asset.id}
                onClick={() => onInsertAsset?.(asset.url, asset.mimeType)}
                disabled={!onInsertAsset}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="asset-item"
              >
                {/* Thumbnail */}
                <div className="w-10 h-10 rounded bg-gray-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
                  {asset.mimeType === "image" ? (
                    <img src={asset.url} alt={asset.label} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-gray-400">VID</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{asset.label}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Badge
                      variant="outline"
                      className="text-[8px] px-1 py-0"
                      style={{
                        borderColor: asset.mimeType === "image" ? "#8b5cf6" : "#22c55e",
                        color: asset.mimeType === "image" ? "#8b5cf6" : "#22c55e",
                      }}
                    >
                      {asset.mimeType}
                    </Badge>
                    <span className="text-[8px] text-muted-foreground">
                      {asset.source === "canvas" ? "캔버스" : "히스토리"}
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* ══════ History Tab ══════ */}
      {activeTab === "history" && (
        <div className="max-h-72 overflow-y-auto px-2 pb-2 space-y-1">
          {/* ── Prompt History ── */}
          {promptItems.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-muted-foreground px-1 pt-1 pb-0.5">
                Prompts
              </p>
              {promptItems.map(item => (
                <div
                  key={item.id}
                  className="w-full flex items-start gap-2 px-2.5 py-2 rounded-lg text-left transition-all hover:bg-gray-50"
                  data-testid="prompt-history-item"
                >
                  <div
                    className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                    style={{ background: "#6b7280" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium leading-tight" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {item.preview}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className="text-[8px] px-1 py-0" style={{ borderColor: "#6b7280", color: "#6b7280" }}>
                        text
                      </Badge>
                      {item.directorPersona && (
                        <span className="text-[9px] text-muted-foreground truncate">
                          {item.directorPersona}
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-0.5">
                      {new Date(item.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                    {/* Quick Actions */}
                    <div className="flex gap-1 mt-1">
                      <button
                        onClick={() => onInsertPrompt?.(item.fullText)}
                        disabled={!onInsertPrompt}
                        className="px-2 py-0.5 rounded text-[9px] font-medium transition-all hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: "#f3f4f6", color: "#374151" }}
                        data-testid="prompt-insert-text"
                      >
                        텍스트 삽입
                      </button>
                      <button
                        onClick={() => onInsertPromptChain?.(item.fullText)}
                        disabled={!onInsertPromptChain}
                        className="px-2 py-0.5 rounded text-[9px] font-medium transition-all hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: "#22c55e20", color: "#16a34a" }}
                        data-testid="prompt-insert-chain"
                      >
                        영상 체인
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ── Video History ── */}
          {historyItems.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-muted-foreground px-1 pt-1 pb-0.5">
                Videos
              </p>
              {historyItems.map(record => {
                const hasPlayableUri = !!record.proxyUri;
                return (
                  <button
                    key={record.id}
                    onClick={() => hasPlayableUri && onInsertAsset?.(record.proxyUri, "video")}
                    disabled={!hasPlayableUri || !onInsertAsset}
                    className="w-full flex items-start gap-2 px-2.5 py-2 rounded-lg text-left transition-all hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    data-testid="history-item"
                  >
                    <div
                      className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                      style={{ background: "#22c55e" }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">
                        {record.prompt ? record.prompt.slice(0, 50) : `Cut #${record.cutNumber}`}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">
                          {record.engine} · {record.durationSec}s
                        </span>
                        {!hasPlayableUri && (
                          <Badge variant="outline" className="text-[8px] px-1 py-0" style={{ borderColor: "#d1d5db", color: "#9ca3af" }}>
                            재생 불가
                          </Badge>
                        )}
                      </div>
                      <p className="text-[9px] text-muted-foreground mt-0.5">
                        {new Date(record.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {/* ── 둘 다 없으면 빈 상태 ── */}
          {promptItems.length === 0 && historyItems.length === 0 && (
            <div className="text-center py-6" data-testid="history-empty">
              <p className="text-xs text-muted-foreground">생성 히스토리가 없습니다</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                프롬프트/비디오를 생성하면 여기에 표시됩니다
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
