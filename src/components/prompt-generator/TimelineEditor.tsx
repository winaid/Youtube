"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { VideoClip } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function formatTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.round((seconds % 1) * 30); // 30fps
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

interface TimelineEditorProps {
  clips: VideoClip[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  onTrimChange: (cutNumber: number, trimStart: number, trimEnd: number) => void;
}

function TrimSlider({
  clip,
  onTrimChange,
}: {
  clip: VideoClip;
  onTrimChange: (trimStart: number, trimEnd: number) => void;
}) {
  const duration = clip.durationSec;
  const trimStart = clip.trimStart ?? 0;
  const trimEnd = clip.trimEnd ?? duration;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{trimStart.toFixed(1)}s</span>
        <span>구간: {(trimEnd - trimStart).toFixed(1)}s</span>
        <span>{trimEnd.toFixed(1)}s</span>
      </div>
      {/* 트림 범위 바 */}
      <div className="relative h-6 rounded" style={{ background: "#e5e5e5" }}>
        {/* 선택 영역 */}
        <div
          className="absolute h-full rounded"
          style={{
            left: `${(trimStart / duration) * 100}%`,
            width: `${((trimEnd - trimStart) / duration) * 100}%`,
            background: "linear-gradient(90deg, #787fff60, #22c55e60)",
          }}
        />
        {/* 시작 핸들 */}
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={trimStart}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (v < trimEnd - 0.5) onTrimChange(v, trimEnd);
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
          style={{ zIndex: 2 }}
        />
        {/* 끝 핸들 */}
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={trimEnd}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (v > trimStart + 0.5) onTrimChange(trimStart, v);
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
          style={{ zIndex: 3 }}
        />
      </div>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-5 text-[10px] px-1.5"
          onClick={() => onTrimChange(0, duration)}
        >
          초기화
        </Button>
      </div>
    </div>
  );
}

export default function TimelineEditor({
  clips,
  onReorder,
  onTrimChange,
}: TimelineEditorProps) {
  const completedClips = clips.filter((c) => c.status === "completed" && c.videoUri);
  const [playingIndex, setPlayingIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [editingClip, setEditingClip] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const totalDuration = completedClips.reduce((sum, c) => {
    const start = c.trimStart ?? 0;
    const end = c.trimEnd ?? c.durationSec;
    return sum + (end - start);
  }, 0);

  // 연속 재생
  const playAll = useCallback(() => {
    if (completedClips.length === 0) return;
    setPlayingIndex(0);
    setIsPlaying(true);
  }, [completedClips]);

  const stopPlaying = useCallback(() => {
    setIsPlaying(false);
    setPlayingIndex(-1);
    if (videoRef.current) {
      videoRef.current.pause();
    }
  }, []);

  // 현재 영상이 끝나면 다음으로
  const handleVideoEnded = useCallback(() => {
    const nextIndex = playingIndex + 1;
    if (nextIndex < completedClips.length) {
      setPlayingIndex(nextIndex);
    } else {
      setIsPlaying(false);
      setPlayingIndex(-1);
    }
  }, [playingIndex, completedClips.length]);

  // playingIndex가 바뀌면 영상 소스 변경 + 트림 적용
  useEffect(() => {
    if (playingIndex < 0 || !isPlaying || !videoRef.current) return;
    const clip = completedClips[playingIndex];
    if (!clip?.videoUri) return;

    const video = videoRef.current;
    video.src = clip.videoUri;
    video.currentTime = clip.trimStart ?? 0;

    const handleTimeUpdate = () => {
      const trimEnd = clip.trimEnd ?? clip.durationSec;
      if (video.currentTime >= trimEnd) {
        video.pause();
        handleVideoEnded();
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.play().catch(() => {});

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [playingIndex, isPlaying, completedClips, handleVideoEnded]);

  // 드래그앤드롭
  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (toIndex: number) => {
    if (dragIndex !== null && dragIndex !== toIndex) {
      // completedClips의 인덱스를 전체 clips 인덱스로 변환
      const fromClip = completedClips[dragIndex];
      const toClip = completedClips[toIndex];
      const fromGlobal = clips.findIndex((c) => c.cutNumber === fromClip.cutNumber);
      const toGlobal = clips.findIndex((c) => c.cutNumber === toClip.cutNumber);
      if (fromGlobal >= 0 && toGlobal >= 0) {
        onReorder(fromGlobal, toGlobal);
      }
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // 전체 영상 순차 다운로드
  const [downloading, setDownloading] = useState(false);
  const handleDownloadAll = async () => {
    setDownloading(true);
    for (let i = 0; i < completedClips.length; i++) {
      const clip = completedClips[i];
      if (!clip.videoUri) continue;
      const a = document.createElement("a");
      a.href = clip.videoUri;
      a.download = `cut-${String(clip.cutNumber).padStart(2, "0")}.mp4`;
      a.target = "_blank";
      a.click();
      // 브라우저 다운로드 간격
      if (i < completedClips.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    setDownloading(false);
  };

  // 프로젝트 메타데이터 내보내기 (편집 소프트웨어 연동용)
  const handleExportEdl = () => {
    let edl = "TITLE: Veo Project\nFCM: NON-DROP FRAME\n\n";
    let timecodeSec = 0;
    completedClips.forEach((clip, i) => {
      const start = clip.trimStart ?? 0;
      const end = clip.trimEnd ?? clip.durationSec;
      const duration = end - start;
      const srcIn = formatTimecode(start);
      const srcOut = formatTimecode(end);
      const recIn = formatTimecode(timecodeSec);
      const recOut = formatTimecode(timecodeSec + duration);
      edl += `${String(i + 1).padStart(3, "0")}  cut-${String(clip.cutNumber).padStart(2, "0")}  V  C  ${srcIn} ${srcOut} ${recIn} ${recOut}\n`;
      edl += `* FROM CLIP NAME: cut-${String(clip.cutNumber).padStart(2, "0")}.mp4\n\n`;
      timecodeSec += duration;
    });
    const blob = new Blob([edl], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `veo-project-${Date.now()}.edl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (completedClips.length === 0) {
    return (
      <Card className="overflow-hidden border-2 border-dashed" style={{ borderColor: "#787fff30" }}>
        <CardContent className="text-center py-8">
          <p className="text-sm text-muted-foreground">
            영상이 생성되면 여기서 타임라인 편집을 할 수 있습니다.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#787fff40" }}>
      <CardHeader className="pb-3" style={{ background: "linear-gradient(135deg, #787fff15, #c4b80010)" }}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base" style={{ color: "#5a5ecc" }}>
            타임라인 편집
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" style={{ borderColor: "#787fff" }}>
              {completedClips.length}개 클립 | {totalDuration.toFixed(1)}초
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {/* 영상 플레이어 */}
        <div className="relative rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "1/1", maxHeight: "400px" }}>
          {isPlaying && playingIndex >= 0 ? (
            <video
              ref={videoRef}
              className="w-full h-full object-contain"
              onEnded={handleVideoEnded}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <p className="text-white/60 text-sm">재생 버튼을 눌러 미리보기</p>
            </div>
          )}

          {/* 현재 재생 정보 */}
          {isPlaying && playingIndex >= 0 && (
            <div className="absolute top-2 left-2 flex items-center gap-1.5">
              <Badge className="text-[10px] text-white" style={{ background: "#787fff" }}>
                CUT {completedClips[playingIndex]?.cutNumber}
              </Badge>
              <Badge className="text-[10px]" style={{ background: "rgba(0,0,0,0.6)", color: "white" }}>
                {playingIndex + 1}/{completedClips.length}
              </Badge>
            </div>
          )}
        </div>

        {/* 재생 컨트롤 */}
        <div className="flex items-center gap-2">
          {!isPlaying ? (
            <Button
              size="sm"
              onClick={playAll}
              className="text-white"
              style={{ background: "#787fff" }}
            >
              연속 재생
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={stopPlaying}>
              정지
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadAll}
            disabled={downloading}
            style={{ borderColor: "#22c55e60", color: "#16a34a" }}
          >
            {downloading ? "다운로드 중..." : "전체 MP4 다운로드"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportEdl}
            style={{ borderColor: "#c4b80060", color: "#7a7000" }}
          >
            EDL 내보내기
          </Button>
        </div>

        {/* 타임라인 트랙 */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            드래그하여 순서 변경 | 클릭하여 트림 편집
          </p>
          <div className="flex gap-1 overflow-x-auto pb-2">
            {completedClips.map((clip, i) => {
              const start = clip.trimStart ?? 0;
              const end = clip.trimEnd ?? clip.durationSec;
              const clipDuration = end - start;

              return (
                <div
                  key={clip.cutNumber}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={handleDragEnd}
                  onClick={() => setEditingClip(editingClip === clip.cutNumber ? null : clip.cutNumber)}
                  className="flex-shrink-0 rounded-md cursor-grab active:cursor-grabbing transition-all select-none"
                  style={{
                    width: `${Math.max(60, (clipDuration / totalDuration) * 100)}%`,
                    minWidth: "60px",
                    maxWidth: "200px",
                    background: dragOverIndex === i ? "#787fff20" : "#f5f5f5",
                    border: editingClip === clip.cutNumber
                      ? "2px solid #787fff"
                      : dragIndex === i
                      ? "2px dashed #787fff"
                      : "1px solid #e5e5e5",
                    opacity: dragIndex === i ? 0.5 : 1,
                    padding: "6px 8px",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold" style={{ color: "#787fff" }}>
                      C{clip.cutNumber}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {clipDuration.toFixed(1)}s
                    </span>
                  </div>
                  {clip.seed && (
                    <p className="text-[8px] text-muted-foreground truncate mt-0.5">
                      Seed: {clip.seed}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 트림 편집 */}
        {editingClip !== null && (
          <div className="p-3 rounded-lg" style={{ background: "#787fff08", border: "1px solid #787fff20" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium" style={{ color: "#787fff" }}>
                CUT {editingClip} 트림 편집
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] px-2"
                  onClick={() => {
                    const clip = completedClips.find((c) => c.cutNumber === editingClip);
                    if (clip?.videoUri) {
                      const a = document.createElement("a");
                      a.href = clip.videoUri;
                      a.download = `cut-${clip.cutNumber}.mp4`;
                      a.target = "_blank";
                      a.click();
                    }
                  }}
                >
                  다운로드
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] px-2"
                  onClick={() => setEditingClip(null)}
                >
                  닫기
                </Button>
              </div>
            </div>
            {(() => {
              const clip = completedClips.find((c) => c.cutNumber === editingClip);
              if (!clip) return null;
              return (
                <>
                  {clip.videoUri && (
                    <video
                      src={clip.videoUri}
                      controls
                      className="w-full rounded-lg mb-2"
                      style={{ maxHeight: "200px" }}
                    />
                  )}
                  <TrimSlider
                    clip={clip}
                    onTrimChange={(start, end) => onTrimChange(clip.cutNumber, start, end)}
                  />
                </>
              );
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
