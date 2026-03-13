"use client";

import { useState, useMemo } from "react";
import type { ShotSnapshots, CutProvenance, FieldDiff, ShotNarrationState } from "@/types";
import { compareShot, humanFieldName, formatValue } from "@/lib/shot-comparison";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ShotComparisonPanelProps {
  snapshots: ShotSnapshots;
  /** narration dirty-state */
  narrationState?: ShotNarrationState;
}

// ── Provenance 상단 표시 ────────────────────────────────────────────────────

function ProvenanceBanner({ p }: { p?: CutProvenance }) {
  if (!p) return null;
  return (
    <div className="rounded-md border px-3 py-2 text-xs space-y-1"
      style={{ background: p.quality === "degraded" ? "#fef3c7" : "#f0fdf4" }}>
      <div className="flex flex-wrap gap-2 items-center">
        {p.source && (
          <Badge variant="outline" className="text-[10px]">
            source: {p.source}
          </Badge>
        )}
        {p.quality && (
          <Badge
            variant="outline"
            className="text-[10px]"
            style={{ borderColor: p.quality === "degraded" ? "#f59e0b" : "#22c55e" }}
          >
            {p.quality}
          </Badge>
        )}
        {p.modelUsed && (
          <Badge variant="outline" className="text-[10px]">
            model: {p.modelUsed}
          </Badge>
        )}
        {p.modeUsed && (
          <Badge variant="outline" className="text-[10px]">
            mode: {p.modeUsed}
          </Badge>
        )}
        {p.qaScore !== undefined && (
          <Badge variant="outline" className="text-[10px]">
            QA: {p.qaScore}/100
          </Badge>
        )}
        {p.autoFixCount !== undefined && p.autoFixCount > 0 && (
          <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#3b82f6" }}>
            autofix: {p.autoFixCount}
          </Badge>
        )}
        {p.narrationMode && (
          <Badge variant="outline" className="text-[10px]" style={{
            borderColor: p.narrationMode === "mute" ? "#888" : p.narrationMode === "manual" ? "#8b5cf6" : "#22c55e",
          }}>
            narration: {p.narrationMode}
          </Badge>
        )}
        {p.narrationSyncStatus && (
          <Badge variant="outline" className="text-[10px]" style={{
            borderColor: p.narrationSyncStatus === "trimmed" ? "#f59e0b"
              : p.narrationSyncStatus === "padded" ? "#3b82f6" : "#22c55e",
          }}>
            sync: {p.narrationSyncStatus}
          </Badge>
        )}
        {p.narrationAudioAvailable !== undefined && (
          <Badge variant="outline" className="text-[10px]" style={{
            borderColor: p.narrationAudioAvailable ? "#22c55e" : "#ef4444",
          }}>
            audio: {p.narrationAudioAvailable ? "있음" : "없음"}
          </Badge>
        )}
      </div>
      {p.reason && <div className="text-muted-foreground">reason: {p.reason}</div>}
      {p.warnings && p.warnings.length > 0 && (
        <div className="text-amber-600">warnings: {p.warnings.join("; ")}</div>
      )}
    </div>
  );
}

// ── 필드 diff 행 ────────────────────────────────────────────────────────────

function DiffRow({ diff }: { diff: FieldDiff }) {
  const bgColor =
    diff.changedAt === "both" ? "#fef2f2"
    : diff.changedAt === "autofix" ? "#eff6ff"
    : diff.changedAt === "server" ? "#fefce8"
    : "transparent";

  const changeLabel =
    diff.changedAt === "both" ? "both"
    : diff.changedAt === "autofix" ? "autofix"
    : diff.changedAt === "server" ? "server"
    : null;

  return (
    <tr style={{ background: bgColor }}>
      <td className="px-2 py-1 text-xs font-medium whitespace-nowrap border-r align-top">
        {humanFieldName(diff.field)}
        {changeLabel && (
          <Badge
            variant="outline"
            className="ml-1 text-[9px] px-1"
            style={{
              borderColor:
                diff.changedAt === "both" ? "#ef4444"
                : diff.changedAt === "autofix" ? "#3b82f6"
                : "#eab308",
            }}
          >
            {changeLabel}
          </Badge>
        )}
      </td>
      <td className="px-2 py-1 text-xs border-r align-top max-w-[200px] break-words">
        {formatValue(diff.original)}
      </td>
      <td className="px-2 py-1 text-xs border-r align-top max-w-[200px] break-words">
        {formatValue(diff.autoFixed)}
      </td>
      <td className="px-2 py-1 text-xs align-top max-w-[200px] break-words">
        {formatValue(diff.finalSent)}
      </td>
    </tr>
  );
}

// ── 메인 패널 ───────────────────────────────────────────────────────────────

export default function ShotComparisonPanel({ snapshots, narrationState }: ShotComparisonPanelProps) {
  const [changedOnly, setChangedOnly] = useState(true);

  const comparison = useMemo(
    () => compareShot(snapshots.original, snapshots.autoFixed, snapshots.finalSent, { changedOnly }),
    [snapshots, changedOnly],
  );

  const hasAnySnapshot = snapshots.original || snapshots.autoFixed || snapshots.finalSent;
  if (!hasAnySnapshot) {
    return (
      <div className="text-xs text-muted-foreground py-2">
        아직 스냅샷이 없습니다. 영상 생성을 실행하면 3-way 비교가 가능합니다.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Provenance */}
      <ProvenanceBanner p={snapshots.provenance} />

      {/* Narration comparison */}
      {narrationState && (
        <div className="rounded-md border px-3 py-2 text-xs space-y-1.5"
          style={{ background: narrationState.narrationDirty ? "#fef3c7" : "#f0fdf4" }}>
          <div className="font-medium text-[10px] text-muted-foreground">나레이션 상태</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] text-muted-foreground mb-0.5">현재 텍스트</div>
              <div className="text-[10px] break-words" style={{ color: narrationState.narrationDirty ? "#b45309" : "#166534" }}>
                {narrationState.currentText || "(비어 있음)"}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-muted-foreground mb-0.5">생성된 오디오 기준 텍스트</div>
              <div className="text-[10px] break-words" style={{ color: "#6b7280" }}>
                {narrationState.lastGeneratedText || "(미생성)"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <Badge variant="outline" className="text-[9px]" style={{
              borderColor: narrationState.narrationDirty ? "#f59e0b" : "#22c55e",
              color: narrationState.narrationDirty ? "#b45309" : "#16a34a",
            }}>
              {narrationState.narrationDirty ? "dirty — 재생성 필요" : "동기화됨"}
            </Badge>
            <Badge variant="outline" className="text-[9px]">
              source: {narrationState.mode}
            </Badge>
            <Badge variant="outline" className="text-[9px]" style={{
              borderColor: narrationState.lastGeneratedAudioUrl ? "#22c55e" : "#ef4444",
            }}>
              audio: {narrationState.lastGeneratedAudioUrl ? "있음" : "없음"}
            </Badge>
            {narrationState.lastGeneratedSyncStatus && (
              <Badge variant="outline" className="text-[9px]">
                sync: {narrationState.lastGeneratedSyncStatus}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {comparison.changedCount}/{comparison.totalFields} 필드 변경됨
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={() => setChangedOnly((v) => !v)}
        >
          {changedOnly ? "전체 필드 보기" : "변경만 보기"}
        </Button>
      </div>

      {/* Diff table */}
      {comparison.diffs.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">
          변경된 필드가 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-md">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b" style={{ background: "#f8fafc" }}>
                <th className="px-2 py-1 text-[10px] font-semibold border-r w-[140px]">필드</th>
                <th className="px-2 py-1 text-[10px] font-semibold border-r">Original</th>
                <th className="px-2 py-1 text-[10px] font-semibold border-r">AutoFixed</th>
                <th className="px-2 py-1 text-[10px] font-semibold">Final Sent</th>
              </tr>
            </thead>
            <tbody>
              {comparison.diffs.map((diff) => (
                <DiffRow key={diff.field} diff={diff} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
