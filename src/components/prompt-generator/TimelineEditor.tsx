"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { VideoClip, AudioMeta } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function formatTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.round((seconds % 1) * 30);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

// ── 크로스페이드 설정 ──────────────────────────────────────────────────────────
const DISSOLVE_MS   = 300;  // 크로스페이드 길이 (ms). 0으로 설정하면 hard cut
const DISSOLVE_SECS = DISSOLVE_MS / 1000;
// 클립 길이가 이것보다 짧으면 크로스페이드 스킵 (짧은 클립 보호)
const MIN_CLIP_FOR_DISSOLVE_SECS = DISSOLVE_SECS * 2.5;

// ── Trim 자동 보정 ─────────────────────────────────────────────────────────────
// Veo 클립은 첫/끝 프레임에 정지/흔들림이 있는 경우가 많아 자동으로 살짝 잘라냄
const HEAD_TRIM_SECS = 0.10; // 클립 시작 0.1s 자동 제거
const TAIL_TRIM_SECS = 0.15; // 클립 끝 0.15s 자동 제거

interface TimelineEditorProps {
  clips: VideoClip[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  onTrimChange: (cutNumber: number, trimStart: number, trimEnd: number) => void;
  audioMeta?: AudioMeta | null;
  narrationStatus?: "idle" | "generating" | "completed" | "failed";
}

function TrimSlider({
  clip,
  onTrimChange,
}: {
  clip: VideoClip;
  onTrimChange: (trimStart: number, trimEnd: number) => void;
}) {
  const duration = clip.durationSec;
  const trimStart = clip.trimStart ?? Math.min(HEAD_TRIM_SECS, duration * 0.05);
  const trimEnd   = clip.trimEnd   ?? Math.max(duration - TAIL_TRIM_SECS, trimStart + 0.5);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{trimStart.toFixed(1)}s</span>
        <span>구간: {(trimEnd - trimStart).toFixed(1)}s</span>
        <span>{trimEnd.toFixed(1)}s</span>
      </div>
      <div className="relative h-6 rounded" style={{ background: "#e5e5e5" }}>
        <div
          className="absolute h-full rounded"
          style={{
            left: `${(trimStart / duration) * 100}%`,
            width: `${((trimEnd - trimStart) / duration) * 100}%`,
            background: "linear-gradient(90deg, #787fff60, #22c55e60)",
          }}
        />
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
  audioMeta,
  narrationStatus,
}: TimelineEditorProps) {
  const completedClips = clips.filter((c) => c.status === "completed" && c.videoUri);

  // ── 재생 상태 ──────────────────────────────────────────────────────────────
  const [playingIndex, setPlayingIndex]   = useState(-1);
  const [isPlaying, setIsPlaying]         = useState(false);
  const [dragIndex, setDragIndex]         = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [editingClip, setEditingClip]     = useState<number | null>(null);
  const [downloading, setDownloading]     = useState(false);
  // 크로스페이드 중 UI 표시용 — 다음 컷 번호 미리 반영
  const [displayCutNumber, setDisplayCutNumber] = useState<number | null>(null);

  // ── 듀얼 비디오 refs ────────────────────────────────────────────────────────
  // vidA, vidB를 번갈아 사용: 한 쪽이 재생되는 동안 다른 쪽을 preload
  const vidA = useRef<HTMLVideoElement>(null);
  const vidB = useRef<HTMLVideoElement>(null);
  // ── 나레이션 오디오 ref ──────────────────────────────────────────────────────
  const narrationAudioRef = useRef<HTMLAudioElement>(null);

  // Refs (이벤트 핸들러에서 stale closure 방지)
  const activeSlotRef      = useRef<"a" | "b">("a");
  const isCrossfadingRef   = useRef(false);
  const animFrameRef       = useRef<number | null>(null);
  // 각 슬롯에 어떤 clip.cutNumber가 로드됐는지 추적
  const slotLoadedCutRef   = useRef<{ a: number; b: number }>({ a: -1, b: -1 });
  // playingIndex의 최신 값을 이벤트 핸들러에서 읽기 위한 ref
  const playingIndexRef    = useRef(-1);
  const completedClipsRef  = useRef(completedClips);

  // Refs를 항상 최신으로 유지
  playingIndexRef.current   = playingIndex;
  completedClipsRef.current = completedClips;

  // 현재 active/inactive 비디오 엘리먼트 반환
  const getActiveVid   = useCallback(() => activeSlotRef.current === "a" ? vidA.current : vidB.current, []);
  const getInactiveVid = useCallback(() => activeSlotRef.current === "a" ? vidB.current : vidA.current, []);

  const totalDuration = completedClips.reduce((sum, c) => {
    const s = c.trimStart ?? Math.min(HEAD_TRIM_SECS, c.durationSec * 0.05);
    const e = c.trimEnd   ?? Math.max(c.durationSec - TAIL_TRIM_SECS, s + 0.5);
    return sum + (e - s);
  }, 0);

  // ── 정지 ───────────────────────────────────────────────────────────────────
  const stopPlaying = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    isCrossfadingRef.current = false;
    vidA.current?.pause();
    vidB.current?.pause();
    narrationAudioRef.current?.pause();
    // opacity 초기화
    if (vidA.current) vidA.current.style.opacity = "1";
    if (vidB.current) vidB.current.style.opacity = "0";
    activeSlotRef.current = "a";
    slotLoadedCutRef.current = { a: -1, b: -1 };
    setIsPlaying(false);
    setPlayingIndex(-1);
    setDisplayCutNumber(null);
  }, []);

  // ── 크로스페이드 실행 ────────────────────────────────────────────────────────
  const startCrossfade = useCallback((nextIndex: number) => {
    if (isCrossfadingRef.current) return;
    const clips = completedClipsRef.current;
    const nextClip = clips[nextIndex];
    if (!nextClip?.videoUri) return;

    const outgoing = getActiveVid();
    const incoming = getInactiveVid();
    if (!outgoing || !incoming) return;

    // 다음 클립이 inactive 슬롯에 preload 됐는지 확인
    const inactiveSlot = activeSlotRef.current === "a" ? "b" : "a";
    if (slotLoadedCutRef.current[inactiveSlot] !== nextClip.cutNumber) {
      // preload 안 됐으면 즉시 로드 (약간 딜레이 발생할 수 있음)
      incoming.src = nextClip.videoUri;
      incoming.currentTime = nextClip.trimStart ?? 0;
      slotLoadedCutRef.current[inactiveSlot] = nextClip.cutNumber;
    }

    isCrossfadingRef.current = true;
    setDisplayCutNumber(nextClip.cutNumber);

    incoming.play().catch(() => {});

    const startTime = performance.now();

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startTime) / DISSOLVE_MS);
      outgoing.style.opacity = String(1 - progress);
      incoming.style.opacity = String(progress);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        // 크로스페이드 완료
        outgoing.pause();
        outgoing.style.opacity = "0";
        incoming.style.opacity = "1";
        isCrossfadingRef.current = false;
        animFrameRef.current = null;

        // 슬롯 교체
        activeSlotRef.current = activeSlotRef.current === "a" ? "b" : "a";

        // React 상태 업데이트 → useEffect가 timeupdate 핸들러를 새로 붙임
        setPlayingIndex(nextIndex);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
  }, [getActiveVid, getInactiveVid]);

  // ── 재생 시작 ───────────────────────────────────────────────────────────────
  const playAll = useCallback(() => {
    if (completedClips.length === 0) return;
    // 초기화
    if (vidA.current) vidA.current.style.opacity = "1";
    if (vidB.current) vidB.current.style.opacity = "0";
    activeSlotRef.current = "a";
    slotLoadedCutRef.current = { a: -1, b: -1 };
    isCrossfadingRef.current = false;
    setPlayingIndex(0);
    setIsPlaying(true);
    setDisplayCutNumber(completedClips[0].cutNumber);
  }, [completedClips]);

  // ── 메인 재생 effect ────────────────────────────────────────────────────────
  // playingIndex 또는 isPlaying이 바뀔 때 실행
  useEffect(() => {
    if (playingIndex < 0 || !isPlaying) return;

    const clips = completedClipsRef.current;
    const clip  = clips[playingIndex];
    if (!clip?.videoUri) return;

    const activeVid = getActiveVid();
    if (!activeVid) return;

    const activeSlot  = activeSlotRef.current;
    const trimStart   = clip.trimStart ?? 0;
    const trimEnd     = clip.trimEnd ?? clip.durationSec;
    const clipDuration = trimEnd - trimStart;

    // 이미 이 클립이 로드된 슬롯이면 src/currentTime 재설정 스킵 (크로스페이드 이후)
    if (slotLoadedCutRef.current[activeSlot] !== clip.cutNumber) {
      activeVid.src = clip.videoUri;
      activeVid.currentTime = trimStart;
      slotLoadedCutRef.current[activeSlot] = clip.cutNumber;
      activeVid.play().catch(() => {});
    } else {
      // 크로스페이드로 진입한 경우 — 이미 재생 중, 단지 timeupdate만 붙이면 됨
    }

    setDisplayCutNumber(clip.cutNumber);

    // ── 나레이션 오디오 sync ──────────────────────────────────────────────────
    const audioEl = narrationAudioRef.current;
    if (audioEl && clip.narrationAudioUri) {
      if (audioEl.src !== clip.narrationAudioUri) {
        audioEl.src = clip.narrationAudioUri;
      }
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {});
    } else if (audioEl) {
      audioEl.pause();
    }

    // 다음 클립 preload
    const nextClip = clips[playingIndex + 1];
    const inactiveVid  = getInactiveVid();
    const inactiveSlot = activeSlot === "a" ? "b" : "a";
    if (nextClip?.videoUri && inactiveVid && slotLoadedCutRef.current[inactiveSlot] !== nextClip.cutNumber) {
      inactiveVid.src = nextClip.videoUri;
      inactiveVid.currentTime = nextClip.trimStart ?? 0;
      inactiveVid.pause();
      slotLoadedCutRef.current[inactiveSlot] = nextClip.cutNumber;
      console.log(`[Timeline] Preloading CUT${nextClip.cutNumber} into slot ${inactiveSlot}`);
    }

    const canDissolve = !!nextClip && clipDuration >= MIN_CLIP_FOR_DISSOLVE_SECS;

    const handleTimeUpdate = () => {
      const current = activeVid.currentTime;
      const remaining = trimEnd - current;

      // 크로스페이드 트리거: 다음 클립이 있고 종료 DISSOLVE_SECS 전
      if (canDissolve && remaining <= DISSOLVE_SECS && !isCrossfadingRef.current) {
        startCrossfade(playingIndex + 1);
        return;
      }

      // 클립 종료 (크로스페이드 없거나 마지막 클립)
      if (current >= trimEnd && !isCrossfadingRef.current) {
        activeVid.pause();
        if (!nextClip) {
          // 마지막 클립
          setIsPlaying(false);
          setPlayingIndex(-1);
          setDisplayCutNumber(null);
        } else if (!canDissolve) {
          // 짧은 클립 — hard cut
          setPlayingIndex(playingIndex + 1);
        }
        // canDissolve인데 여기까지 왔으면 crossfade가 아직 안 끝난 것 → 대기
      }
    };

    activeVid.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      activeVid.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [playingIndex, isPlaying, getActiveVid, getInactiveVid, startCrossfade]);

  // ── 드래그앤드롭 ────────────────────────────────────────────────────────────
  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragOver  = (e: React.DragEvent, index: number) => { e.preventDefault(); setDragOverIndex(index); };
  const handleDrop = (toIndex: number) => {
    if (dragIndex !== null && dragIndex !== toIndex) {
      const fromClip = completedClips[dragIndex];
      const toClip   = completedClips[toIndex];
      const fromGlobal = clips.findIndex((c) => c.cutNumber === fromClip.cutNumber);
      const toGlobal   = clips.findIndex((c) => c.cutNumber === toClip.cutNumber);
      if (fromGlobal >= 0 && toGlobal >= 0) onReorder(fromGlobal, toGlobal);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };
  const handleDragEnd = () => { setDragIndex(null); setDragOverIndex(null); };

  // ── 다운로드 ────────────────────────────────────────────────────────────────
  const handleDownloadAll = async () => {
    setDownloading(true);
    for (let i = 0; i < completedClips.length; i++) {
      const clip = completedClips[i];
      if (!clip.videoUri) continue;
      // Download video
      const a = document.createElement("a");
      a.href = clip.videoUri;
      a.download = `cut-${String(clip.cutNumber).padStart(2, "0")}.mp4`;
      a.target = "_blank";
      a.click();
      // Download narration audio if available
      if (clip.narrationAudioUri) {
        await new Promise((r) => setTimeout(r, 300));
        const audioA = document.createElement("a");
        audioA.href = clip.narrationAudioUri;
        audioA.download = `cut-${String(clip.cutNumber).padStart(2, "0")}-narration.mp3`;
        audioA.target = "_blank";
        audioA.click();
      }
      if (i < completedClips.length - 1) await new Promise((r) => setTimeout(r, 500));
    }
    setDownloading(false);
  };

  const handleExportEdl = () => {
    let edl = "TITLE: Veo Project\nFCM: NON-DROP FRAME\n\n";
    let timecodeSec = 0;
    completedClips.forEach((clip, i) => {
      const start = clip.trimStart ?? 0;
      const end   = clip.trimEnd ?? clip.durationSec;
      const dur   = end - start;
      edl += `${String(i + 1).padStart(3, "0")}  cut-${String(clip.cutNumber).padStart(2, "0")}  V  C  ${formatTimecode(start)} ${formatTimecode(end)} ${formatTimecode(timecodeSec)} ${formatTimecode(timecodeSec + dur)}\n`;
      edl += `* FROM CLIP NAME: cut-${String(clip.cutNumber).padStart(2, "0")}.mp4\n\n`;
      timecodeSec += dur;
    });
    const blob = new Blob([edl], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
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
            {/* Audio meta badges */}
            {narrationStatus === "generating" && (
              <Badge className="text-[10px] text-white" style={{ background: "#f59e0b" }}>
                나레이션 생성 중...
              </Badge>
            )}
            {audioMeta?.audioIncluded && (
              <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#22c55e", color: "#16a34a" }}>
                오디오 {audioMeta.deliveryMode === "separate" ? "(별도 파일)" : audioMeta.deliveryMode}
              </Badge>
            )}
            {audioMeta?.audioCoverage && (
              <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#3b82f6", color: "#3b82f6" }}>
                커버리지 {Math.round(audioMeta.audioCoverage.coverage * 100)}%
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {/* 영상 플레이어 — 듀얼 비디오로 크로스페이드 */}
        <div
          className="relative rounded-lg overflow-hidden bg-black"
          style={{ aspectRatio: "1/1", maxHeight: "400px" }}
        >
          {/* 두 video 엘리먼트: 항상 DOM에 존재, opacity로 가시성 제어 */}
          <video
            ref={vidA}
            className="absolute inset-0 w-full h-full object-contain"
            style={{ opacity: 1, background: "black" }}
            playsInline
            muted={false}
          />
          <video
            ref={vidB}
            className="absolute inset-0 w-full h-full object-contain"
            style={{ opacity: 0, background: "black" }}
            playsInline
            muted={false}
          />

          {/* 나레이션 오디오 (hidden) */}
          <audio ref={narrationAudioRef} style={{ display: "none" }} />

          {/* 재생 전 안내 */}
          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-white/60 text-sm">재생 버튼을 눌러 미리보기</p>
            </div>
          )}

          {/* 현재 재생 정보 */}
          {isPlaying && displayCutNumber !== null && (
            <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none">
              <Badge className="text-[10px] text-white" style={{ background: "#787fff" }}>
                CUT {displayCutNumber}
              </Badge>
              <Badge className="text-[10px]" style={{ background: "rgba(0,0,0,0.6)", color: "white" }}>
                {playingIndex + 1}/{completedClips.length}
              </Badge>
            </div>
          )}

          {/* 크로스페이드 표시 */}
          {isPlaying && DISSOLVE_MS > 0 && (
            <div className="absolute bottom-2 right-2 pointer-events-none">
              <Badge className="text-[9px]" style={{ background: "rgba(0,0,0,0.45)", color: "white" }}>
                dissolve {DISSOLVE_MS}ms
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

        {/* Audio delivery notice */}
        {audioMeta?.deliveryMode === "separate" && audioMeta.audioIncluded && (
          <div className="px-3 py-1.5 rounded text-[11px]" style={{ background: "#3b82f608", border: "1px solid #3b82f620", color: "#3b82f6" }}>
            오디오는 별도 파일로 제공됩니다. 다운로드 시 MP4 + MP3가 함께 내려갑니다.
            {audioMeta.warnings?.length > 0 && (
              <span className="block mt-0.5 text-[10px]" style={{ color: "#f59e0b" }}>
                {audioMeta.warnings.length}개 경고
              </span>
            )}
          </div>
        )}

        {/* 타임라인 트랙 */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            드래그하여 순서 변경 | 클릭하여 트림 편집
          </p>
          <div className="flex gap-1 overflow-x-auto pb-2">
            {completedClips.map((clip, i) => {
              const start       = clip.trimStart ?? 0;
              const end         = clip.trimEnd ?? clip.durationSec;
              const clipDuration = end - start;
              const isActive    = isPlaying && displayCutNumber === clip.cutNumber;

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
                    width:    `${Math.max(60, (clipDuration / totalDuration) * 100)}%`,
                    minWidth: "60px",
                    maxWidth: "200px",
                    background: dragOverIndex === i ? "#787fff20" : isActive ? "#787fff10" : "#f5f5f5",
                    border: editingClip === clip.cutNumber
                      ? "2px solid #787fff"
                      : isActive
                      ? "2px solid #787fff80"
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
                  {clip.narrationAudioUri && (() => {
                    const track = audioMeta?.audioTracks?.find(t => t.cutNumber === clip.cutNumber);
                    const syncColor = track?.syncStatus === "trimmed" ? "#f59e0b"
                      : track?.syncStatus === "padded" ? "#3b82f6" : "#16a34a";
                    return (
                      <p className="text-[8px] truncate mt-0.5" style={{ color: syncColor }}>
                        audio{track?.syncStatus && track.syncStatus !== "exact" ? ` (${track.syncStatus})` : ""}
                      </p>
                    );
                  })()}
                  {clip.narrationStatus === "failed" && (
                    <p className="text-[8px] truncate mt-0.5" style={{ color: "#ef4444" }}>
                      audio failed
                    </p>
                  )}
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
