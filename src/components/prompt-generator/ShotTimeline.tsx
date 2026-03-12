"use client";

import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EditableShot, EditableSequence, SequenceDensityWarning } from "@/lib/shot-editing";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface ShotTimelineProps {
  sequence: EditableSequence;
  selectedShotId: string | null;
  densityWarning: SequenceDensityWarning;
  onSelectShot: (shotId: string) => void;
  onSplitShot: (shotId: string) => void;
  onMergeWithPrev: (shotId: string) => void;
  onMergeWithNext: (shotId: string) => void;
  onMoveUp: (shotId: string) => void;
  onMoveDown: (shotId: string) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Color palette for shots (cycles)
// ═══════════════════════════════════════════════════════════════════

const SHOT_COLORS = [
  "#787fff", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

function getShotColor(index: number): string {
  return SHOT_COLORS[index % SHOT_COLORS.length];
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function ShotTimeline({
  sequence,
  selectedShotId,
  densityWarning,
  onSelectShot,
  onSplitShot,
  onMergeWithPrev,
  onMergeWithNext,
  onMoveUp,
  onMoveDown,
}: ShotTimelineProps) {
  const totalDuration = sequence.durationSec;
  const shots = sequence.shots;

  const getWidthPercent = useCallback(
    (shot: EditableShot) => {
      if (totalDuration <= 0) return 100 / Math.max(1, shots.length);
      const duration = shot.endSec - shot.startSec;
      return Math.max(3, (duration / totalDuration) * 100); // min 3% for visibility
    },
    [totalDuration, shots.length],
  );

  if (shots.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground rounded-lg border-2 border-dashed">
        샷이 없습니다. structuredSequence에 shots[]가 비어 있습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Density warning */}
      {densityWarning.hasWarning && (
        <div
          className="px-3 py-2 rounded-lg text-xs font-medium"
          style={{ background: "#f59e0b18", color: "#b37700", border: "1px solid #f59e0b30" }}
        >
          {densityWarning.message}
        </div>
      )}

      {/* Header info */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          시퀀스 #{sequence.cutNumber} &middot; {sequence.sceneType} &middot; {totalDuration}s
        </span>
        <span>{shots.length}샷</span>
      </div>

      {/* Timeline strip — proportional widths */}
      <div className="flex gap-0.5 h-14 rounded-lg overflow-hidden border">
        {shots.map((shot, i) => {
          const isSelected = shot.shotId === selectedShotId;
          const color = getShotColor(i);
          const duration = (shot.endSec - shot.startSec).toFixed(1);

          return (
            <button
              key={shot.shotId}
              onClick={() => onSelectShot(shot.shotId)}
              className="relative flex flex-col items-center justify-center text-white text-[10px] font-medium transition-all hover:brightness-110 focus:outline-none"
              style={{
                width: `${getWidthPercent(shot)}%`,
                background: color,
                opacity: isSelected ? 1 : 0.75,
                outline: isSelected ? `2px solid ${color}` : "none",
                outlineOffset: isSelected ? "1px" : "0",
              }}
              title={`${shot.shotId}: ${shot.camera.framing} ${shot.camera.angle} — ${shot.subject}`}
            >
              <span className="truncate px-0.5 max-w-full">{shot.camera.framing}</span>
              <span className="opacity-70">{duration}s</span>
            </button>
          );
        })}
      </div>

      {/* Time ruler */}
      <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
        <span>0s</span>
        {totalDuration > 4 && <span>{(totalDuration / 2).toFixed(1)}s</span>}
        <span>{totalDuration}s</span>
      </div>

      {/* Selected shot controls */}
      {selectedShotId && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onSplitShot(selectedShotId)}
          >
            분할
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onMergeWithPrev(selectedShotId)}
            disabled={shots[0]?.shotId === selectedShotId}
          >
            이전과 병합
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onMergeWithNext(selectedShotId)}
            disabled={shots[shots.length - 1]?.shotId === selectedShotId}
          >
            다음과 병합
          </Button>
          <div className="w-px h-7 bg-border" />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onMoveUp(selectedShotId)}
            disabled={shots[0]?.shotId === selectedShotId}
          >
            &uarr;
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onMoveDown(selectedShotId)}
            disabled={shots[shots.length - 1]?.shotId === selectedShotId}
          >
            &darr;
          </Button>
        </div>
      )}

      {/* Shot list (compact) */}
      <div className="space-y-1">
        {shots.map((shot, i) => {
          const isSelected = shot.shotId === selectedShotId;
          const color = getShotColor(i);

          return (
            <button
              key={shot.shotId}
              onClick={() => onSelectShot(shot.shotId)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors"
              style={{
                background: isSelected ? `${color}15` : "transparent",
                border: isSelected ? `1px solid ${color}40` : "1px solid transparent",
              }}
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: color }}
              />
              <span className="font-medium w-14 shrink-0" style={{ color }}>
                {shot.camera.framing}/{shot.camera.angle.slice(0, 3)}
              </span>
              <span className="truncate text-muted-foreground">
                {shot.subject} — {shot.action}
              </span>
              <Badge variant="outline" className="ml-auto text-[10px] shrink-0">
                {shot.startSec}s–{shot.endSec}s
              </Badge>
            </button>
          );
        })}
      </div>
    </div>
  );
}
