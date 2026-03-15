"use client";

import { useState, useMemo, useCallback } from "react";
import type { MultiShotPrompt, ShotRole, Cut } from "@/types";
import { SHOT_ROLE_META, SHOT_ROLES } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMaxShots } from "@/lib/kling-capability";
import {
  validateMultiShots,
  addShot,
  removeShot,
  resizeShot,
  inferShotRole,
  PROMPT_MAX_LENGTH,
  type MultiShotValidationResult,
} from "@/lib/multishot-validation";

// ═══════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════

interface MultiShotEditorProps {
  cut: Cut;
  modelId: string;
  onUpdate: (updated: Cut) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function MultiShotEditor({ cut, modelId, onUpdate }: MultiShotEditorProps) {
  const shots = cut.multiShot ?? [];
  const totalDuration = cut.durationSec;
  const maxShots = getMaxShots(modelId, totalDuration);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // ── Validation ──
  const validation: MultiShotValidationResult = useMemo(
    () => validateMultiShots(modelId, shots, totalDuration),
    [modelId, shots, totalDuration],
  );

  // ── Handlers ──
  const updateShots = useCallback(
    (newShots: MultiShotPrompt[]) => {
      onUpdate({ ...cut, multiShot: newShots });
    },
    [cut, onUpdate],
  );

  const handleAddShot = useCallback(() => {
    const result = addShot(modelId, shots, totalDuration);
    if (result) updateShots(result);
  }, [modelId, shots, totalDuration, updateShots]);

  const handleRemoveShot = useCallback(
    (shotIndex: number) => {
      const result = removeShot(shots, shotIndex);
      if (result) updateShots(result);
    },
    [shots, updateShots],
  );

  const handleDurationChange = useCallback(
    (shotIndex: number, delta: number) => {
      const shot = shots.find((s) => s.index === shotIndex);
      if (!shot) return;
      const currentDur = parseInt(shot.duration, 10) || 0;
      const newDur = currentDur + delta;
      const result = resizeShot(modelId, shots, shotIndex, newDur);
      if (result) updateShots(result);
    },
    [modelId, shots, updateShots],
  );

  const handleRoleChange = useCallback(
    (shotIndex: number, role: ShotRole) => {
      const updated = shots.map((s) =>
        s.index === shotIndex ? { ...s, role } : s,
      );
      updateShots(updated);
    },
    [shots, updateShots],
  );

  const handlePromptSave = useCallback(
    (shotIndex: number, prompt: string) => {
      const updated = shots.map((s) =>
        s.index === shotIndex ? { ...s, prompt } : s,
      );
      updateShots(updated);
      setEditingIndex(null);
    },
    [shots, updateShots],
  );

  // ── No multiShot support ──
  if (maxShots <= 0 && shots.length === 0) return null;

  const canAdd = shots.length < maxShots;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium" style={{ color: "#e85d04" }}>
          멀티샷 ({shots.length}/{maxShots})
        </span>
        {canAdd && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2"
            style={{ color: "#e85d04" }}
            onClick={handleAddShot}
          >
            + 샷 추가
          </Button>
        )}
      </div>

      {/* Shot Cards */}
      <div className="space-y-1.5">
        {shots.map((shot) => {
          const role = shot.role ?? inferShotRole(shot.index - 1, shots.length);
          const meta = SHOT_ROLE_META[role];
          const shotErrors = validation.shotIssues.filter(
            (i) => i.shotIndex === shot.index && i.severity === "error",
          );
          const shotWarnings = validation.shotIssues.filter(
            (i) => i.shotIndex === shot.index && i.severity === "warning",
          );
          const isEditing = editingIndex === shot.index;

          return (
            <div
              key={shot.index}
              className="rounded-lg p-2 space-y-1.5 group relative"
              style={{
                background: meta.bg,
                border: `1px solid ${meta.color}25`,
              }}
            >
              {/* Top row: index, role dropdown, duration controls, delete */}
              <div className="flex items-center gap-2">
                <span
                  className="text-[11px] font-bold w-5 text-center"
                  style={{ color: meta.color }}
                >
                  {shot.index}
                </span>

                {/* Role Dropdown */}
                <Select
                  value={role}
                  onValueChange={(v) => handleRoleChange(shot.index, v as ShotRole)}
                >
                  <SelectTrigger
                    className="h-6 text-[10px] w-[80px] px-2 py-0"
                    style={{ borderColor: `${meta.color}40`, color: meta.color }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOT_ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="text-[11px]">
                        <span style={{ color: SHOT_ROLE_META[r].color }}>
                          {SHOT_ROLE_META[r].label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Duration Controls */}
                <div className="flex items-center gap-0.5 ml-auto">
                  <button
                    onClick={() => handleDurationChange(shot.index, -1)}
                    className="w-5 h-5 rounded text-[10px] flex items-center justify-center transition-colors hover:bg-black/5"
                    style={{ color: meta.color }}
                  >
                    -
                  </button>
                  <span className="text-[11px] font-mono w-6 text-center">
                    {shot.duration}s
                  </span>
                  <button
                    onClick={() => handleDurationChange(shot.index, 1)}
                    className="w-5 h-5 rounded text-[10px] flex items-center justify-center transition-colors hover:bg-black/5"
                    style={{ color: meta.color }}
                  >
                    +
                  </button>
                </div>

                {/* Delete (hover) */}
                {shots.length > 1 && (
                  <button
                    onClick={() => handleRemoveShot(shot.index)}
                    className="w-5 h-5 rounded text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                    style={{ color: "#ef4444" }}
                    title="샷 삭제"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Prompt */}
              {isEditing ? (
                <div className="space-y-1">
                  <Textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={2}
                    className="text-[11px] font-mono"
                    maxLength={PROMPT_MAX_LENGTH}
                    autoFocus
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-muted-foreground">
                      {editDraft.length}/{PROMPT_MAX_LENGTH}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 text-[9px] px-1.5"
                        style={{ color: "#22c55e" }}
                        onClick={() => handlePromptSave(shot.index, editDraft)}
                      >
                        저장
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 text-[9px] px-1.5"
                        onClick={() => setEditingIndex(null)}
                      >
                        취소
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className="text-[11px] font-mono leading-relaxed text-gray-700 break-all cursor-pointer hover:ring-1 hover:ring-offset-1 rounded px-1 py-0.5 transition-all min-h-[24px]"
                  style={{ "--tw-ring-color": meta.color } as React.CSSProperties}
                  onClick={() => {
                    setEditingIndex(shot.index);
                    setEditDraft(shot.prompt);
                  }}
                >
                  {shot.prompt || (
                    <span className="text-muted-foreground italic">프롬프트를 입력하세요...</span>
                  )}
                </div>
              )}

              {/* Per-shot char count (non-editing) */}
              {!isEditing && shot.prompt && (
                <div className="flex justify-end">
                  <span className="text-[9px] text-muted-foreground">
                    {shot.prompt.length}/{PROMPT_MAX_LENGTH}
                  </span>
                </div>
              )}

              {/* Per-shot errors/warnings */}
              {shotErrors.map((e, i) => (
                <p key={`e-${i}`} className="text-[9px]" style={{ color: "#ef4444" }}>
                  {e.message}
                </p>
              ))}
              {shotWarnings.map((w, i) => (
                <p key={`w-${i}`} className="text-[9px]" style={{ color: "#f59e0b" }}>
                  {w.message}
                </p>
              ))}
            </div>
          );
        })}
      </div>

      {/* Aggregate Validation */}
      {(validation.aggregateIssues.length > 0 || shots.length > 0) && (
        <div
          className="rounded-lg p-2 space-y-0.5"
          style={{ background: "#f8f8f8", border: "1px solid #e5e5e5" }}
        >
          <p className="text-[9px] font-medium text-muted-foreground mb-1">Validation</p>

          {/* Status lines */}
          {shots.length > 0 && (
            <>
              <ValidationLine
                ok={shots.length <= maxShots}
                text={`shot 수: ${shots.length}/${maxShots}`}
              />
              <ValidationLine
                ok={validation.aggregateIssues.every(
                  (i) => !i.message.includes("시간 합계"),
                )}
                text={`duration 합: ${shots.reduce((s, sh) => s + (parseInt(sh.duration, 10) || 0), 0)}초 = ${totalDuration}초`}
              />
              <ValidationLine
                ok={!validation.shotIssues.some(
                  (i) => i.field === "prompt" && i.severity === "error",
                )}
                text={`모든 prompt ${PROMPT_MAX_LENGTH}자 이내`}
              />
            </>
          )}

          {/* Aggregate issues */}
          {validation.aggregateIssues.map((issue, i) => (
            <p
              key={i}
              className="text-[9px]"
              style={{
                color: issue.severity === "error" ? "#ef4444" : "#f59e0b",
              }}
            >
              {issue.severity === "error" ? "❌" : "⚠️"} {issue.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Validation status line ──
function ValidationLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className="text-[9px]" style={{ color: ok ? "#22c55e" : "#ef4444" }}>
      {ok ? "✅" : "❌"} {text}
    </p>
  );
}
