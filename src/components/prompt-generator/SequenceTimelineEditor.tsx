"use client";

import { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ShotTimeline from "./ShotTimeline";
import ShotInspector from "./ShotInspector";
import type { StructuredSequenceDocument } from "@/types";
import {
  extractEditable,
  applyEditsToDocument,
  splitShot,
  mergeShotWithPrevious,
  mergeShotWithNext,
  moveShotUp,
  moveShotDown,
  setShotDuration,
  updateShotField,
  validateSequenceDensity,
  type EditableSequence,
} from "@/lib/shot-editing";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface SequenceTimelineEditorProps {
  /** 원본 structuredSequence (읽기 전용 source of truth) */
  structuredSequence: StructuredSequenceDocument;
  /** 편집 결과를 상위에 전달 (apply 시 호출) */
  onApply: (updated: StructuredSequenceDocument) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function SequenceTimelineEditor({
  structuredSequence,
  onApply,
}: SequenceTimelineEditorProps) {
  // ── State: original vs editable ──────────────────────────────
  const [editable, setEditable] = useState<EditableSequence>(() =>
    extractEditable(structuredSequence),
  );
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // ── Derived ──────────────────────────────────────────────────
  const densityWarning = useMemo(() => validateSequenceDensity(editable), [editable]);

  const selectedShot = useMemo(
    () => editable.shots.find((s) => s.shotId === selectedShotId) ?? null,
    [editable.shots, selectedShotId],
  );

  // ── Mutation helpers (all immutable via shot-editing.ts) ─────
  const apply = useCallback((next: EditableSequence) => {
    setEditable(next);
    setIsDirty(true);
  }, []);

  const handleSplit = useCallback(
    (shotId: string) => apply(splitShot(editable, shotId)),
    [editable, apply],
  );

  const handleMergeWithPrev = useCallback(
    (shotId: string) => {
      apply(mergeShotWithPrevious(editable, shotId));
      setSelectedShotId(null);
    },
    [editable, apply],
  );

  const handleMergeWithNext = useCallback(
    (shotId: string) => {
      apply(mergeShotWithNext(editable, shotId));
      setSelectedShotId(null);
    },
    [editable, apply],
  );

  const handleMoveUp = useCallback(
    (shotId: string) => apply(moveShotUp(editable, shotId)),
    [editable, apply],
  );

  const handleMoveDown = useCallback(
    (shotId: string) => apply(moveShotDown(editable, shotId)),
    [editable, apply],
  );

  const handleUpdateField = useCallback(
    (path: string, value: string) => {
      if (!selectedShotId) return;
      apply(updateShotField(editable, selectedShotId, path, value));
    },
    [editable, selectedShotId, apply],
  );

  const handleSetDuration = useCallback(
    (newDuration: number) => {
      if (!selectedShotId) return;
      apply(setShotDuration(editable, selectedShotId, newDuration));
    },
    [editable, selectedShotId, apply],
  );

  // ── Apply / Reset ───────────────────────────────────────────
  const handleApplyToDocument = useCallback(() => {
    const updated = applyEditsToDocument(structuredSequence, editable);
    onApply(updated);
    setIsDirty(false);
  }, [structuredSequence, editable, onApply]);

  const handleReset = useCallback(() => {
    setEditable(extractEditable(structuredSequence));
    setSelectedShotId(null);
    setIsDirty(false);
  }, [structuredSequence]);

  // ═══════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="space-y-3">
      {/* Header */}
      <Card className="overflow-hidden border-2" style={{ borderColor: "#787fff30" }}>
        <CardHeader
          className="pb-2"
          style={{ background: "linear-gradient(135deg, #787fff10, transparent)" }}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm" style={{ color: "#787fff" }}>
              시퀀스 타임라인 편집기
            </CardTitle>
            <div className="flex gap-1.5">
              {isDirty && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleReset}
                  >
                    초기화
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs text-white"
                    style={{ background: "#787fff" }}
                    onClick={handleApplyToDocument}
                  >
                    적용
                  </Button>
                </>
              )}
            </div>
          </div>
          {isDirty && (
            <p className="text-[10px] mt-1" style={{ color: "#f59e0b" }}>
              편집 중 — &quot;적용&quot;을 누르면 structuredSequence에 반영됩니다.
            </p>
          )}
        </CardHeader>

        <CardContent className="pt-3">
          <ShotTimeline
            sequence={editable}
            selectedShotId={selectedShotId}
            densityWarning={densityWarning}
            onSelectShot={setSelectedShotId}
            onSplitShot={handleSplit}
            onMergeWithPrev={handleMergeWithPrev}
            onMergeWithNext={handleMergeWithNext}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
          />
        </CardContent>
      </Card>

      {/* Inspector (shown when a shot is selected) */}
      {selectedShot && (
        <ShotInspector
          shot={selectedShot}
          onUpdateField={handleUpdateField}
          onSetDuration={handleSetDuration}
          onClose={() => setSelectedShotId(null)}
        />
      )}
    </div>
  );
}
