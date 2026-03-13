"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NODE_REGISTRY, type NodeCategory, type NodeDefinition } from "@/lib/node-types";

interface NodePaletteProps {
  onAddNode: (def: NodeDefinition) => void;
  onClose: () => void;
}

const CATEGORIES: { key: NodeCategory; label: string; color: string }[] = [
  { key: "all", label: "All", color: "#787fff" },
  { key: "text", label: "Text", color: "#6b7280" },
  { key: "image", label: "Image", color: "#8b5cf6" },
  { key: "video", label: "Video", color: "#22c55e" },
  { key: "sound", label: "Sound", color: "#f59e0b" },
  { key: "3d", label: "3D", color: "#ec4899" },
  { key: "utility", label: "Utility", color: "#3b82f6" },
];

export default function NodePalette({ onAddNode, onClose }: NodePaletteProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<NodeCategory>("all");

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

  return (
    <div className="absolute left-3 top-3 z-50 w-72 rounded-xl shadow-lg border"
      style={{ background: "white" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-sm font-semibold" style={{ color: "#333" }}>Add Node</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-xs" onClick={onClose}>
          ✕
        </Button>
      </div>

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
    </div>
  );
}
