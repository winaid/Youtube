"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getVideoHistory,
  deleteVideoRecord,
  clearVideoHistory,
  VideoRecord,
} from "@/lib/video-history";

function formatDate(ts: number): string {
  const d = new Date(ts);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours().toString().padStart(2, "0");
  const mins = d.getMinutes().toString().padStart(2, "0");
  return `${month}/${day} ${hours}:${mins}`;
}

function formatDuration(sec: number): string {
  return sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
}

export default function MyVideosPanel() {
  const [records, setRecords] = useState<VideoRecord[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    setRecords(getVideoHistory());
  }, []);

  useEffect(() => {
    reload();
    // localStorage 변경 감지 (다른 탭)
    const onStorage = (e: StorageEvent) => {
      if (e.key === "video-history") reload();
    };
    window.addEventListener("storage", onStorage);

    // 같은 탭에서 saveVideoRecord 호출 시 즉시 반영
    const onHistoryUpdated = () => reload();
    window.addEventListener("video-history-updated", onHistoryUpdated);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("video-history-updated", onHistoryUpdated);
    };
  }, [reload]);

  const handleDelete = (id: string) => {
    deleteVideoRecord(id);
    setRecords((prev: VideoRecord[]) => prev.filter((r: VideoRecord) => r.id !== id));
  };

  const handleClearAll = () => {
    if (confirm("전체 영상 기록을 삭제하시겠습니까?")) {
      clearVideoHistory();
      setRecords([]);
    }
  };

  if (records.length === 0) {
    return (
      <Card className="border" style={{ borderColor: "#787fff20" }}>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">아직 생성된 영상이 없습니다.</p>
          <p className="text-xs text-muted-foreground mt-1">영상을 생성하면 여기에 자동으로 기록됩니다.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border" style={{ borderColor: "#787fff30" }}>
      <CardHeader className="pb-2" style={{ background: "linear-gradient(135deg, #787fff10, transparent)" }}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm" style={{ color: "#787fff" }}>
            내 영상
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#787fff40" }}>
              {records.length}개
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
      <CardContent className="space-y-3 pt-2 max-h-[600px] overflow-y-auto">
        {records.map((rec) => (
          <div
            key={rec.id}
            className="rounded-lg border p-3 space-y-2 transition-all hover:border-[#787fff30]"
            style={{ borderColor: "#e5e5e520" }}
          >
            {/* Header row */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                className="text-[9px] text-white"
                style={{ background: rec.engine === "veo" ? "#787fff" : "#f97316" }}
              >
                {rec.engine.toUpperCase()}
              </Badge>
              <Badge variant="outline" className="text-[9px]" style={{ borderColor: "#787fff30" }}>
                CUT {rec.cutNumber}
              </Badge>
              <Badge
                variant="outline"
                className="text-[9px]"
                style={{ borderColor: rec.mode === "extend" ? "#22c55e40" : "#787fff30" }}
              >
                {rec.mode === "extend" ? "연장" : "생성"}
              </Badge>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {formatDate(rec.createdAt)} · {formatDuration(rec.durationSec)}
              </span>
            </div>

            {/* Prompt preview */}
            <p className="text-[11px] text-muted-foreground line-clamp-2">
              {rec.prompt || "(프롬프트 없음)"}
            </p>

            {/* Video player */}
            {rec.proxyUri && (
              <div>
                {playingId === rec.id ? (
                  <video
                    src={rec.proxyUri}
                    controls
                    autoPlay
                    className="w-full rounded-md"
                    style={{ maxHeight: "200px" }}
                    onEnded={() => setPlayingId(null)}
                  />
                ) : (
                  <button
                    onClick={() => setPlayingId(rec.id)}
                    className="w-full h-24 rounded-md flex items-center justify-center text-sm transition-colors"
                    style={{ background: "#787fff10", color: "#787fff" }}
                  >
                    ▶ 재생
                  </button>
                )}
              </div>
            )}

            {/* Metadata + actions */}
            <div className="flex items-center gap-2">
              {rec.seed && (
                <span className="text-[9px] text-muted-foreground">seed: {rec.seed}</span>
              )}
              {rec.sourceCutId && (
                <span className="text-[9px] text-muted-foreground">← CUT {rec.sourceCutId}</span>
              )}
              <div className="ml-auto">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-5 text-[9px] px-2"
                  style={{ borderColor: "#ef444430", color: "#dc2626" }}
                  onClick={() => handleDelete(rec.id)}
                >
                  삭제
                </Button>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
