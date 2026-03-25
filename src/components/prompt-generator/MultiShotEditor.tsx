"use client";

import { useState, useMemo, useCallback } from "react";
import type { MultiShotPrompt, ShotRole, Cut } from "@/types";
import { SHOT_ROLE_META, SHOT_ROLES } from "@/types";
import { ROLE_KO } from "@/lib/multi-shot-planner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
/** VEO 정책: 8초=4샷, 7초(extend)=3샷 */
const getMaxShots = (_modelId: string, duration: number) => duration <= 7 ? 3 : 4;
import {
  validateMultiShots,
  addShot,
  removeShot,
  resizeShot,
  inferShotRole,
  autoAssignRoles,
  PROMPT_MAX_LENGTH,
  getRecommendedShotRange,
  type MultiShotValidationResult,
} from "@/lib/multishot-validation";
import { ROLE_PROGRESSION_DIRECTIVE } from "@/lib/multi-shot-planner";
import { generateShotSummaryKo } from "@/lib/shot-summary-ko";

// ── Shot change indicator — shows what changed from previous shot ──
function describeShotChange(prev: MultiShotPrompt, current: MultiShotPrompt, prevRole: ShotRole, currentRole: ShotRole): string | null {
  const changes: string[] = [];
  if (prevRole !== currentRole) {
    const prevMeta = SHOT_ROLE_META[prevRole];
    const currentMeta = SHOT_ROLE_META[currentRole];
    if (prevMeta.shotSize !== currentMeta.shotSize) {
      changes.push(`${prevMeta.shotSize} → ${currentMeta.shotSize}`);
    }
  }
  // Detect framing terms in prompt text
  const WIDE_RE = /\b(wide|WS|LS|establishing|aerial)\b/i;
  const MED_RE = /\b(medium|MS|MCU|MLS|mid[\s-]?shot)\b/i;
  const CLOSE_RE = /\b(close[\s-]?up|CU|ECU|macro|detail)\b/i;
  const prevFrame = WIDE_RE.test(prev.prompt) ? "wide" : CLOSE_RE.test(prev.prompt) ? "close" : MED_RE.test(prev.prompt) ? "medium" : null;
  const curFrame = WIDE_RE.test(current.prompt) ? "wide" : CLOSE_RE.test(current.prompt) ? "close" : MED_RE.test(current.prompt) ? "medium" : null;
  if (prevFrame && curFrame && prevFrame !== curFrame) {
    changes.push(`${prevFrame} → ${curFrame}`);
  }
  if (changes.length === 0) return null;
  return changes.join(" · ");
}

// ═══════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════

interface MultiShotEditorProps {
  cut: Cut;
  modelId: string;
  onUpdate: (updated: Cut) => void;
  /** Canonical-derived multiShot (overrides cut.multiShot when provided) */
  effectiveMultiShot?: MultiShotPrompt[];
  /** Canonical-derived durationSec (overrides cut.durationSec when provided) */
  effectiveDurationSec?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function MultiShotEditor({ cut, modelId, onUpdate, effectiveMultiShot, effectiveDurationSec }: MultiShotEditorProps) {
  const shots = useMemo(() => effectiveMultiShot ?? cut.multiShot ?? [], [effectiveMultiShot, cut.multiShot]);
  const totalDuration = effectiveDurationSec ?? cut.durationSec;
  const maxShots = getMaxShots(modelId, totalDuration);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [addShotFeedback, setAddShotFeedback] = useState<string | null>(null);

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
    if (result) {
      // Find the new shot (the one with empty prompt)
      const newShot = result.find(s => !s.prompt || s.prompt.trim() === "");
      if (newShot) {
        const role = newShot.role ?? inferShotRole(newShot.index - 1, result.length);
        const directive = ROLE_PROGRESSION_DIRECTIVE[role];
        if (directive) {
          // Use shotSize + function as a concise hint, not the full verbose directive
          newShot.prompt = `${directive.shotSize} — ${directive.function}`;
        }
      }
      updateShots(result);
      setAddShotFeedback(`샷 ${result.length}개로 재구성됨`);
      setTimeout(() => setAddShotFeedback(null), 2000);
    } else {
      // Explain why add failed
      const rec = getRecommendedShotRange(totalDuration);
      if (shots.length >= maxShots) {
        setAddShotFeedback(`최대 ${maxShots}샷 — 더 추가할 수 없습니다`);
      } else {
        setAddShotFeedback(`모든 샷이 최소 길이라 분할 불가 (${rec.min}–${rec.max}샷 권장)`);
      }
      setTimeout(() => setAddShotFeedback(null), 3000);
    }
  }, [modelId, shots, totalDuration, maxShots, updateShots]);

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
      const currentDur = parseFloat(shot.duration) || 0;
      const newDur = currentDur + delta;
      const result = resizeShot(modelId, shots, shotIndex, newDur);
      if (result) updateShots(result);
    },
    [modelId, shots, updateShots],
  );

  const handleRoleChange = useCallback(
    (shotIndex: number, role: ShotRole) => {
      const updated = shots.map((s) => {
        if (s.index !== shotIndex) return s;
        const patch: Partial<MultiShotPrompt> = { role };
        if (s.promptKo !== undefined) {
          // Only overwrite if promptKo matches the old role's auto-generated label
          const oldRole = s.role ?? inferShotRole(s.index - 1, shots.length);
          const oldLabel = SHOT_ROLE_META[oldRole].label;
          const oldRoleKo = ROLE_KO[oldRole] ?? oldLabel;
          if (s.promptKo === oldLabel || s.promptKo === oldRoleKo || s.promptKo.startsWith(oldLabel)) {
            // promptKo를 ROLE_KO (상세 설명) 사용 — multishot-validation과 일관성 유지
            patch.promptKo = ROLE_KO[role] ?? SHOT_ROLE_META[role].label;
          }
          // else: user has customized promptKo, preserve it
        }
        return { ...s, ...patch };
      });
      updateShots(updated);
    },
    [shots, updateShots],
  );

  const handlePromptSave = useCallback(
    (shotIndex: number, prompt: string) => {
      const updated = shots.map((s) => {
        if (s.index !== shotIndex) return s;
        // 프롬프트 변경 시 promptKo 재생성 (한국어 요약을 영어와 동기화)
        const newPromptKo = generateShotSummaryKo(prompt, s.role ?? inferShotRole(s.index - 1, shots.length));
        return { ...s, prompt, promptKo: newPromptKo };
      });
      updateShots(updated);
      setEditingIndex(null);
    },
    [shots, updateShots],
  );

  // ── No multiShot support ──
  if (maxShots <= 0 && shots.length === 0) {
    return (
      <div className="text-[9px] py-1.5 px-2 rounded" style={{ color: "#9ca3af", background: "#f3f4f610" }}>
        이 모델/길이에서는 멀티샷을 지원하지 않습니다.
      </div>
    );
  }

  const canAdd = shots.length < maxShots;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium" style={{ color: "#e85d04" }}>
            이 장면의 멀티샷 ({shots.length}개 내부 샷)
          </span>
          <span className="text-[9px]" style={{ color: "#9ca3af" }}>
            한 장면 안에서 프레이밍 변화 · 에스컬레이션 · 페이오프
          </span>
        </div>
        <div className="flex gap-1">
          {shots.length >= 3 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-2"
              style={{ color: "#6b7280" }}
              onClick={() => updateShots(autoAssignRoles(shots))}
              title="position 기반 role 자동 재할당"
            >
              역할 재정렬
            </Button>
          )}
          {canAdd && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-2"
              style={{ color: "#e85d04" }}
              onClick={handleAddShot}
            >
              + 내부 샷 추가
            </Button>
          )}
        </div>
      </div>

      {/* Add Shot Feedback */}
      {addShotFeedback && (
        <div
          className="text-[10px] px-2 py-1 rounded-md text-center animate-pulse"
          style={{ background: "#e85d0415", color: "#e85d04", border: "1px solid #e85d0430" }}
        >
          {addShotFeedback}
        </div>
      )}

      {/* Shot Cards */}
      <div className="space-y-1.5">
        {shots.map((shot, arrayIdx) => {
          const role = shot.role ?? inferShotRole(arrayIdx, shots.length);
          const meta = SHOT_ROLE_META[role];
          // Compute change from previous shot
          const prevShot = arrayIdx > 0 ? shots[arrayIdx - 1] : null;
          const prevRole = prevShot ? (prevShot.role ?? inferShotRole(arrayIdx - 1, shots.length)) : null;
          const changeHint = prevShot && prevRole ? describeShotChange(prevShot, shot, prevRole, role) : null;
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
              {/* Top row: index, role dropdown, progression hint, duration controls, delete */}
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
                          {SHOT_ROLE_META[r].label} — {SHOT_ROLE_META[r].progression}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Change indicator from previous shot */}
                {changeHint && (
                  <span className="text-[8px] px-1 py-0.5 rounded" style={{ color: "#059669", background: "#05966910" }}>
                    {changeHint}
                  </span>
                )}

                {/* Progression hint */}
                <span className="text-[9px] hidden sm:inline" style={{ color: `${meta.color}99` }}>
                  {meta.shotSize} · {meta.progression}
                </span>

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
                  className="rounded px-1 py-0.5 transition-all min-h-[24px]"
                >
                  {/* 한국어 프롬프트 (메인) + 영어 원문 (접힌 상태) */}
                  {(() => {
                    const koSummary = shot.promptKo
                      || (shot.prompt ? generateShotSummaryKo(shot.prompt, shot.role ?? inferShotRole(shot.index - 1, shots.length)) : "");
                    const hasPrompt = shot.prompt && shot.prompt.trim().length > 0;
                    return hasPrompt ? (
                      <>
                        <div
                          className="text-[12px] font-sans text-gray-900 leading-relaxed cursor-pointer hover:ring-1 hover:ring-offset-1 rounded"
                          style={{ "--tw-ring-color": meta.color } as React.CSSProperties}
                          onClick={() => {
                            setEditingIndex(shot.index);
                            setEditDraft(shot.prompt);
                          }}
                        >
                          {koSummary || shot.prompt.slice(0, 80)}
                        </div>
                        <details className="mt-0.5">
                          <summary className="text-[8px] text-gray-400 cursor-pointer select-none">원문 (EN)</summary>
                          <div
                            className="mt-0.5 text-[9px] font-mono text-gray-400 leading-snug break-all cursor-pointer"
                            onClick={() => {
                              setEditingIndex(shot.index);
                              setEditDraft(shot.prompt);
                            }}
                          >
                            {shot.prompt}
                          </div>
                        </details>
                      </>
                    ) : (
                      <div
                        className="rounded px-1 py-0.5 cursor-pointer hover:ring-1 hover:ring-offset-1"
                        style={{ "--tw-ring-color": meta.color } as React.CSSProperties}
                        onClick={() => {
                          setEditingIndex(shot.index);
                          setEditDraft(shot.prompt);
                        }}
                      >
                        <span className="text-[11px] text-muted-foreground italic">프롬프트를 입력하세요...</span>
                      </div>
                    );
                  })()}
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
                text={`이 장면 내부 멀티샷 수: ${shots.length}/${maxShots}`}
              />
              <ValidationLine
                ok={validation.aggregateIssues.every(
                  (i) => !i.message.includes("시간 합계"),
                )}
                text={`멀티샷 duration 합: ${shots.reduce((s, sh) => s + (parseFloat(sh.duration) || 0), 0)}초 = 장면 전체 ${totalDuration}초`}
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
