"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** shot별 나레이션 복원 데이터 (localStorage 직렬화 가능) */
export interface HistoryCutNarration {
  narrationMode?: "auto" | "manual" | "mute";
  narrationText?: string;
  narrationAudioUri?: string;
  narrationSyncStatus?: string;
  narrationGeneratedAt?: number;
}

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
    /** 나레이션 복원 데이터 (v2+) */
    narration?: HistoryCutNarration;
  }[];
}

const STORAGE_KEY = "veo-video-history";
const SESSION_KEY = "veo-current-session-id";

function loadHistory(): VideoHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistHistory(entries: VideoHistoryEntry[]) {
  try {
    const trimmed = entries.slice(0, 20);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    try {
      const trimmed = entries.slice(0, 10);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch { /* give up */ }
  }
}

// 현재 세션 ID — 같은 세션의 영상은 덮어쓰기
let currentSessionId: string | null = null;
function getSessionId(): string {
  if (typeof window === "undefined") return "";
  if (!currentSessionId) {
    currentSessionId = sessionStorage.getItem(SESSION_KEY);
    if (!currentSessionId) {
      currentSessionId = `vh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      sessionStorage.setItem(SESSION_KEY, currentSessionId);
    }
  }
  return currentSessionId;
}

/**
 * 영상 저장 — 같은 세션이면 업데이트, 새 세션이면 추가
 * 컷이 1개라도 완료되면 호출됨
 */
export function saveToHistory(entry: Omit<VideoHistoryEntry, "id" | "timestamp">) {
  const sessionId = getSessionId();
  const history = loadHistory();
  const existingIdx = history.findIndex((h) => h.id === sessionId);

  const newEntry: VideoHistoryEntry = {
    ...entry,
    id: sessionId,
    timestamp: Date.now(),
  };

  if (existingIdx >= 0) {
    // 같은 세션 — 업데이트 (더 많은 컷이 완료됐으면 덮어쓰기)
    history[existingIdx] = newEntry;
    persistHistory(history);
  } else {
    // 새 세션 — 맨 앞에 추가
    persistHistory([newEntry, ...history]);
  }
  // 같은 탭 내 VideoHistoryPanel 즉시 갱신
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("veo-history-updated"));
  }
}

interface VideoHistoryPanelProps {
  onLoadHistory?: (entry: VideoHistoryEntry) => void;
}

export default function VideoHistoryPanel({ onLoadHistory }: VideoHistoryPanelProps) {
  const [history, setHistory] = useState<VideoHistoryEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setHistory(loadHistory());

    // 다른 탭에서 저장했을 때도 반영
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setHistory(loadHistory());
    };
    window.addEventListener("storage", onStorage);

    // 같은 탭에서 saveToHistory 호출 시 즉시 반영
    const onHistoryUpdated = () => setHistory(loadHistory());
    window.addEventListener("veo-history-updated", onHistoryUpdated);

    // 폴백 폴링 (1초 주기)
    const interval = setInterval(() => {
      setHistory(loadHistory());
    }, 1000);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("veo-history-updated", onHistoryUpdated);
      clearInterval(interval);
    };
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
    persistHistory(updated);
    setHistory(updated);
  };

  const handleClearAll = () => {
    if (confirm("전체 히스토리를 삭제하시겠습니까?")) {
      persistHistory([]);
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
        {history.map((entry) => {
          const isCurrentSession = entry.id === currentSessionId;
          return (
            <div
              key={entry.id}
              className="rounded-lg border transition-all"
              style={{
                borderColor: expanded === entry.id
                  ? "#787fff40"
                  : isCurrentSession
                  ? "#22c55e30"
                  : "#e5e5e520",
              }}
            >
              <button
                className="w-full text-left p-2.5 flex items-center gap-2"
                onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium truncate">{entry.storyTitle || "제목 없음"}</p>
                    {isCurrentSession && (
                      <Badge className="text-[8px] text-white" style={{ background: "#22c55e" }}>현재</Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {formatDate(entry.timestamp)} · {entry.cuts.length}장면
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
          );
        })}
      </CardContent>
    </Card>
  );
}
