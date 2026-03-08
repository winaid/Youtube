"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface VideoHistoryEntry {
  id: string;
  timestamp: number;
  storyTitle: string;
  cuts: {
    cutNumber: number;
    sceneDescription: string;
    videoUri: string;
    seed?: string;
    durationSec: number;
  }[];
}

const STORAGE_KEY = "veo-video-history";

function loadHistory(): VideoHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: VideoHistoryEntry[]) {
  try {
    // 최대 20개 보관
    const trimmed = entries.slice(0, 20);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // storage full — remove oldest
    try {
      const trimmed = entries.slice(0, 10);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch { /* give up */ }
  }
}

export function addToHistory(entry: Omit<VideoHistoryEntry, "id" | "timestamp">) {
  const history = loadHistory();
  const newEntry: VideoHistoryEntry = {
    ...entry,
    id: `vh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
  };
  saveHistory([newEntry, ...history]);
}

interface VideoHistoryPanelProps {
  onLoadHistory?: (entry: VideoHistoryEntry) => void;
}

export default function VideoHistoryPanel({ onLoadHistory }: VideoHistoryPanelProps) {
  const [history, setHistory] = useState<VideoHistoryEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  if (history.length === 0) {
    return null;
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = d.getHours().toString().padStart(2, "0");
    const mins = d.getMinutes().toString().padStart(2, "0");
    return `${month}/${day} ${hours}:${mins}`;
  };

  const handleDelete = (id: string) => {
    const updated = history.filter((h) => h.id !== id);
    saveHistory(updated);
    setHistory(updated);
  };

  const handleClearAll = () => {
    if (confirm("전체 히스토리를 삭제하시겠습니까?")) {
      saveHistory([]);
      setHistory([]);
    }
  };

  return (
    <Card className="overflow-hidden border" style={{ borderColor: "#787fff30" }}>
      <CardHeader className="pb-2" style={{ background: "linear-gradient(135deg, #787fff10, transparent)" }}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm" style={{ color: "#787fff" }}>
            영상 히스토리
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#787fff40" }}>
              {history.length}개
            </Badge>
            <button
              onClick={handleClearAll}
              className="text-[10px] px-1.5 py-0.5 rounded text-red-400 hover:bg-red-50/10 transition-colors"
            >
              전체 삭제
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2 max-h-[400px] overflow-y-auto">
        {history.map((entry) => (
          <div
            key={entry.id}
            className="rounded-lg border transition-all"
            style={{ borderColor: expanded === entry.id ? "#787fff40" : "#e5e5e520" }}
          >
            <button
              className="w-full text-left p-2.5 flex items-center gap-2"
              onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{entry.storyTitle || "제목 없음"}</p>
                <p className="text-[10px] text-muted-foreground">
                  {formatDate(entry.timestamp)} · {entry.cuts.length}컷
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {expanded === entry.id ? "▲" : "▼"}
              </span>
            </button>

            {expanded === entry.id && (
              <div className="px-2.5 pb-2.5 space-y-2">
                {entry.cuts.map((cut) => (
                  <div key={cut.cutNumber} className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Badge className="text-[9px] text-white" style={{ background: "#787fff" }}>
                        CUT {cut.cutNumber}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground truncate">
                        {cut.sceneDescription}
                      </span>
                    </div>
                    <video
                      src={cut.videoUri}
                      controls
                      className="w-full rounded-md"
                      style={{ maxHeight: "150px" }}
                    />
                  </div>
                ))}

                <div className="flex gap-1.5 pt-1">
                  {onLoadHistory && (
                    <Button
                      size="sm"
                      className="h-6 text-[10px] text-white"
                      style={{ background: "#787fff" }}
                      onClick={() => onLoadHistory(entry)}
                    >
                      이 영상 불러오기
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px]"
                    style={{ borderColor: "#ef444430", color: "#dc2626" }}
                    onClick={() => handleDelete(entry.id)}
                  >
                    삭제
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
