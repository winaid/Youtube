"use client";

import { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ShotTimeline from "./ShotTimeline";
import ShotInspector from "./ShotInspector";
import ShotVariantPanel from "./ShotVariantPanel";
import type { StructuredSequenceDocument, ShotRegenerateStatus } from "@/types";
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
import {
  createInitialVariantState,
  getShotVariants,
  getActiveShotVariantId,
  getShotStatus,
  type ShotVariantState,
} from "@/lib/shot-variants";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface SequenceTimelineEditorProps {
  /** 원본 structuredSequence (읽기 전용 source of truth) */
  structuredSequence: StructuredSequenceDocument;
  /** 편집 결과를 상위에 전달 (apply 시 호출) */
  onApply: (updated: StructuredSequenceDocument) => void;
  /** 샷 재생성 요청 (상위에서 API 호출) */
  onRegenerateShot?: (shotId: string, structuredSequence: StructuredSequenceDocument) => void;
  /** 외부에서 주입되는 variant 상태 (useVideoGeneration에서 관리) */
  variantState?: ShotVariantState;
  /** variant 채택 콜백 */
  onAcceptVariant?: (shotId: string, variantId: string) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function SequenceTimelineEditor({
  structuredSequence,
  onApply,
  onRegenerateShot,
  variantState: externalVariantState,
  onAcceptVariant,
}: SequenceTimelineEditorProps) {
  // ── State: original vs editable ──────────────────────────────
  const [editable, setEditable] = useState<EditableSequence>(() =>
    extractEditable(structuredSequence),
  );
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // variant state: prefer external (from useVideoGeneration), fallback to local
  const [localVariantState] = useState<ShotVariantState>(createInitialVariantState);
  const variantState = externalVariantState ?? localVariantState;

  // ── Derived ──────────────────────────────────────────────────
  const densityWarning = useMemo(() => validateSequenceDensity(editable), [editable]);

  const selectedShot = useMemo(
    () => editable.shots.find((s) => s.shotId === selectedShotId) ?? null,
    [editable.shots, selectedShotId],
  );

  // shot statuses map for timeline
  const shotStatuses = useMemo(() => {
    const map: Record<string, ShotRegenerateStatus> = {};
    for (const shot of editable.shots) {
      map[shot.shotId] = getShotStatus(variantState, shot.shotId);
    }
    return map;
  }, [editable.shots, variantState]);

  // shot variant counts for timeline
  const shotVariantCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const shot of editable.shots) {
      map[shot.shotId] = getShotVariants(variantState, shot.shotId).length;
    }
    return map;
  }, [editable.shots, variantState]);

  // selected shot's variants
  const selectedShotVariants = useMemo(
    () => selectedShotId ? getShotVariants(variantState, selectedShotId) : [],
    [variantState, selectedShotId],
  );

  const selectedShotActiveVariantId = useMemo(
    () => selectedShotId ? getActiveShotVariantId(variantState, selectedShotId) : null,
    [variantState, selectedShotId],
  );

  const selectedShotStatus = useMemo(
    () => selectedShotId ? getShotStatus(variantState, selectedShotId) : "idle" as const,
    [variantState, selectedShotId],
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

  // ── Regenerate ──────────────────────────────────────────────
  const handleRegenerate = useCallback(
    (shotId: string) => {
      if (!onRegenerateShot) return;
      // Apply current edits first, then pass to regeneration
      const currentDoc = applyEditsToDocument(structuredSequence, editable);
      onRegenerateShot(shotId, currentDoc);
    },
    [onRegenerateShot, structuredSequence, editable],
  );

  const handleAcceptVariant = useCallback(
    (variantId: string) => {
      if (!selectedShotId || !onAcceptVariant) return;
      onAcceptVariant(selectedShotId, variantId);
    },
    [selectedShotId, onAcceptVariant],
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
            shotStatuses={shotStatuses}
            shotVariantCounts={shotVariantCounts}
            onSelectShot={setSelectedShotId}
            onSplitShot={handleSplit}
            onMergeWithPrev={handleMergeWithPrev}
            onMergeWithNext={handleMergeWithNext}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onRegenerate={handleRegenerate}
          />
        </CardContent>
      </Card>

      {/* Inspector (shown when a shot is selected) */}
      {selectedShot && (
        <ShotInspector
          shot={selectedShot}
          shotStatus={selectedShotStatus}
          variantCount={selectedShotVariants.length}
          onUpdateField={handleUpdateField}
          onSetDuration={handleSetDuration}
          onRegenerate={handleRegenerate}
          onClose={() => setSelectedShotId(null)}
        />
      )}

      {/* Variant Panel (shown when selected shot has variants or is generating) */}
      {selectedShotId && (selectedShotVariants.length > 0 || selectedShotStatus !== "idle") && (
        <ShotVariantPanel
          shotId={selectedShotId}
          status={selectedShotStatus}
          variants={selectedShotVariants}
          activeVariantId={selectedShotActiveVariantId}
          onAcceptVariant={handleAcceptVariant}
          onRegenerate={() => handleRegenerate(selectedShotId)}
        />
      )}
    </div>
  );
}
