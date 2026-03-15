"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  PromptInput, PromptOutput, GeneratorStatus, Region, AnimationMode,
  Duration, AspectRatio, Cut, ShotRole, DirectorPersona,
  SHOT_ROLE_META, SHOT_ROLES,
} from "@/types";
import DirectorStylePanel from "./DirectorStylePanel";
import { DURATION_MIN, DURATION_MAX } from "@/lib/duration-reconciliation";
import { getRecommendedShotRange } from "@/lib/multishot-validation";
import {
  segmentScript,
  isLongScript,
  formatDuration,
  SEGMENT_MIN_DURATION,
  SEGMENT_MAX_DURATION,
  PROJECT_MAX_RUNTIME,
  type SegmentationPlan,
  type ScriptSegment,
} from "@/lib/script-segmenter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClipBudgetEntry } from "@/lib/runtime-budget";
import type { AppMode } from "./AppShell";

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const TARGET_RUNTIME_PRESETS = [
  { value: 15, label: "15초", desc: "숏폼 클립" },
  { value: 30, label: "30초", desc: "인스타 릴스" },
  { value: 60, label: "1분", desc: "표준 숏폼" },
  { value: 120, label: "2분", desc: "미드폼" },
  { value: 180, label: "3분", desc: "유튜브 쇼츠" },
  { value: 300, label: "5분", desc: "최대" },
];

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface PlanTabProps {
  mode: AppMode;
  result: PromptOutput | null;
  status: GeneratorStatus;
  error: string | null;
  lastInput: PromptInput | null;
  secondsPerScene: number;
  onSecondsPerSceneChange: (v: number) => void;
  onGenerate: (input: PromptInput) => void;
  onUpdateResult: (result: PromptOutput) => void;
  onAdvanceToBuild: () => void;
  batchEntries: ClipBudgetEntry[];
  onUpdateBatchEntries: (entries: ClipBudgetEntry[]) => void;
  onScriptChange?: (text: string) => void;
  onTargetRuntimeChange?: (sec: number) => void;
  initialScript?: string | null;
  onInitialScriptConsumed?: () => void;
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function PlanTab({
  mode,
  result,
  status,
  error,
  lastInput,
  secondsPerScene,
  onSecondsPerSceneChange,
  onGenerate,
  onUpdateResult,
  onAdvanceToBuild,
  batchEntries,
  onUpdateBatchEntries,
  onScriptChange,
  onTargetRuntimeChange,
  initialScript,
  onInitialScriptConsumed,
}: PlanTabProps) {
  const [storyText, setStoryText] = useState(lastInput?.storyText ?? "");
  const [targetRuntime, setTargetRuntime] = useState<number>(60);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(lastInput?.aspectRatio ?? "16:9");
  const [segmentPlan, setSegmentPlan] = useState<SegmentationPlan | null>(null);
  const [editedSegments, setEditedSegments] = useState<ScriptSegment[]>([]);
  const [directorId, setDirectorId] = useState<string>(lastInput?.directorPersona ?? "neutral");
  const [customDirector, setCustomDirector] = useState<DirectorPersona | undefined>(lastInput?.customDirector);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (lastInput?.storyText && storyText === "") {
      setStoryText(lastInput.storyText);
    }
  }, [lastInput, storyText]);

  useEffect(() => {
    if (initialScript && initialScript.trim()) {
      setStoryText(initialScript);
      onScriptChange?.(initialScript);
      setSegmentPlan(null);
      setEditedSegments([]);
      onInitialScriptConsumed?.();
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [initialScript, onInitialScriptConsumed, onScriptChange]);

  const scriptIsLong = useMemo(() => isLongScript(storyText), [storyText]);

  const handleDirectorChange = useCallback((id: string, custom?: DirectorPersona) => {
    setDirectorId(id);
    if (custom) setCustomDirector(custom);
  }, []);

  const autoSegmentPlan = useMemo(() => {
    if (!storyText.trim()) return null;
    return segmentScript(storyText, {
      targetRuntimeSec: targetRuntime,
    });
  }, [storyText, targetRuntime]);

  const handleAnalyzeScript = useCallback(() => {
    if (!autoSegmentPlan) return;
    setSegmentPlan(autoSegmentPlan);
    setEditedSegments([...autoSegmentPlan.segments]);
  }, [autoSegmentPlan]);

  const handleUpdateSegmentDuration = useCallback((index: number, duration: number) => {
    setEditedSegments(prev =>
      prev.map((s, i) => i === index
        ? { ...s, assignedDurationSec: Math.max(SEGMENT_MIN_DURATION, Math.min(SEGMENT_MAX_DURATION, duration)) }
        : s
      )
    );
  }, []);

  const handleUpdateSegmentText = useCallback((index: number, text: string) => {
    setEditedSegments(prev =>
      prev.map((s, i) => i === index ? { ...s, text } : s)
    );
  }, []);

  const handleGenerateAll = useCallback(() => {
    if (editedSegments.length === 0) {
      if (!storyText.trim()) return;
      const input: PromptInput = {
        storyText: storyText.trim(),
        directorPersona: directorId,
        region: "한국" as Region,
        animationMode: "cinematic-realism" as AnimationMode,
        duration: targetRuntime as Duration,
        aspectRatio,
        cutDuration: Math.min(targetRuntime, SEGMENT_MAX_DURATION),
        customDirector,
      };
      onGenerate(input);
      return;
    }

    const fullScript = editedSegments.map((seg, i) => {
      const marker = seg.continuationFromPrev ? `[CONTINUE FROM SEGMENT ${i}] ` : "";
      return `${marker}${seg.text}`;
    }).join("\n\n");

    const avgSegDuration = editedSegments.length > 0
      ? Math.round(editedSegments.reduce((s, seg) => s + seg.assignedDurationSec, 0) / editedSegments.length)
      : 8;

    const input: PromptInput = {
      storyText: fullScript,
      directorPersona: directorId,
      region: "한국" as Region,
      animationMode: "cinematic-realism" as AnimationMode,
      duration: targetRuntime as Duration,
      aspectRatio,
      cutDuration: avgSegDuration,
      cutCount: editedSegments.length,
      customDirector,
    };
    onGenerate(input);
  }, [editedSegments, storyText, targetRuntime, aspectRatio, directorId, customDirector, onGenerate]);

  const handleUpdateCut = useCallback((cutNumber: number, updates: Partial<Cut>) => {
    if (!result) return;
    const newCuts = result.cuts.map(c =>
      c.cutNumber === cutNumber ? { ...c, ...updates } : c
    );
    onUpdateResult({ ...result, cuts: newCuts });
  }, [result, onUpdateResult]);

  const handleUpdateShotRole = useCallback((cutNumber: number, shotIndex: number, role: ShotRole) => {
    if (!result) return;
    const newCuts = result.cuts.map(c => {
      if (c.cutNumber !== cutNumber || !c.multiShot) return c;
      const newMultiShot = c.multiShot.map((s, i) =>
        i === shotIndex ? { ...s, role } : s
      );
      return { ...c, multiShot: newMultiShot };
    });
    onUpdateResult({ ...result, cuts: newCuts });
  }, [result, onUpdateResult]);

  const handleUpdateShotPrompt = useCallback((cutNumber: number, shotIndex: number, prompt: string) => {
    if (!result) return;
    const newCuts = result.cuts.map(c => {
      if (c.cutNumber !== cutNumber || !c.multiShot) return c;
      const newMultiShot = c.multiShot.map((s, i) =>
        i === shotIndex ? { ...s, prompt } : s
      );
      return { ...c, multiShot: newMultiShot };
    });
    onUpdateResult({ ...result, cuts: newCuts });
  }, [result, onUpdateResult]);

  const handleUpdateShotDuration = useCallback((cutNumber: number, shotIndex: number, duration: string) => {
    if (!result) return;
    const newCuts = result.cuts.map(c => {
      if (c.cutNumber !== cutNumber || !c.multiShot) return c;
      const newMultiShot = c.multiShot.map((s, i) =>
        i === shotIndex ? { ...s, duration } : s
      );
      return { ...c, multiShot: newMultiShot };
    });
    onUpdateResult({ ...result, cuts: newCuts });
  }, [result, onUpdateResult]);

  const totalPlannedRuntime = useMemo(() => {
    if (!result) return 0;
    return result.cuts.reduce((sum, c) => sum + c.durationSec, 0);
  }, [result]);

  const segmentTotalRuntime = useMemo(() =>
    editedSegments.reduce((s, seg) => s + seg.assignedDurationSec, 0),
    [editedSegments],
  );

  return (
    <div className="space-y-6">
      {/* ── Step 1: Script Input ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#787fff" }}>1</span>
            스크립트 입력
            {scriptIsLong && (
              <Badge className="text-[10px] ml-2" style={{ background: "#787fff20", color: "#787fff" }}>
                장문 스크립트 감지
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="story">나레이션 / 스크립트 / 시나리오</Label>
            <Textarea
              ref={textareaRef}
              id="story"
              value={storyText}
              onChange={e => { setStoryText(e.target.value); onScriptChange?.(e.target.value); }}
              placeholder={`전체 나레이션, 스토리 초안, 또는 장문 스크립트를 입력하세요.

예시:
"서울의 새벽. 아직 어둠이 채 걷히지 않은 골목길에 한 남자가 걸어온다. 낡은 가방을 들고, 발걸음은 무겁다.

카페 문을 열자 따뜻한 불빛이 쏟아진다. 바리스타가 고개를 들어 눈인사를 건넨다. 남자는 창가에 앉아 커피를 기다린다.

빗방울이 유리창을 두드리기 시작한다. 남자는 커피잔을 감싸 쥐고, 빗소리에 귀를 기울인다. 과거의 기억이 스쳐 지나간다."

→ 시스템이 자동으로 세그먼트를 분할하고, 각 세그먼트를 3-15초 생성 단위로 변환합니다.`}
              rows={8}
              className="resize-none font-mono text-sm"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs" style={{ color: "#999" }}>
                긴 스크립트를 입력하면 자동으로 세그먼트로 분할됩니다. 각 세그먼트는 3-15초 Kling 생성 단위입니다.
              </p>
              {storyText.trim() && (
                <span className="text-[10px]" style={{ color: "#aaa" }}>
                  {storyText.replace(/\s+/g, "").length}자
                </span>
              )}
            </div>
          </div>

        </CardContent>
      </Card>

      {/* ── Step 2: Director / Style Direction ── */}
      <DirectorStylePanel
        storyText={storyText}
        selectedDirectorId={directorId}
        onDirectorChange={handleDirectorChange}
      />

      {/* ── Step 3: Runtime & Segmentation ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#22c55e" }}>3</span>
            런타임 & 세그먼트 설계
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Target Runtime */}
            <div className="space-y-2 md:col-span-2">
              <Label>프로젝트 타겟 런타임</Label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={5}
                  max={PROJECT_MAX_RUNTIME}
                  step={5}
                  value={targetRuntime}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setTargetRuntime(v);
                    onSecondsPerSceneChange(Math.min(v, SEGMENT_MAX_DURATION));
                    onTargetRuntimeChange?.(v);
                  }}
                  className="flex-1"
                />
                <span className="text-sm font-bold w-16 text-right">{formatDuration(targetRuntime)}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {TARGET_RUNTIME_PRESETS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => {
                      setTargetRuntime(p.value);
                      onSecondsPerSceneChange(Math.min(p.value, SEGMENT_MAX_DURATION));
                      onTargetRuntimeChange?.(p.value);
                    }}
                    className="text-[10px] px-2 py-1 rounded border transition-colors"
                    style={targetRuntime === p.value
                      ? { background: "#787fff", color: "white", borderColor: "#787fff" }
                      : { borderColor: "#ddd", color: "#888" }
                    }
                  >
                    {p.label} <span style={{ opacity: 0.7 }}>{p.desc}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px]" style={{ color: "#bbb" }}>
                각 세그먼트는 3-15초 생성 단위로 분할됩니다. 세그먼트들은 extend/continuation으로 연결됩니다.
              </p>
            </div>

            {/* Aspect Ratio */}
            <div className="space-y-2">
              <Label>화면비</Label>
              <Select value={aspectRatio} onValueChange={v => setAspectRatio(v as AspectRatio)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 가로</SelectItem>
                  <SelectItem value="9:16">9:16 세로</SelectItem>
                </SelectContent>
              </Select>
              {mode === "studio" && (
                <div className="mt-2">
                  <Label className="text-[10px]">워크플로우</Label>
                  <Select defaultValue="text-to-video">
                    <SelectTrigger className="h-8 mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text-to-video">Text → Video</SelectItem>
                      <SelectItem value="image-to-video">Image → Video</SelectItem>
                      <SelectItem value="reference-to-video">Reference → Video</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          {/* Auto-segmentation preview — always shown when script exists */}
          {autoSegmentPlan && storyText.trim() && !result && (
            <div className="p-3 rounded-lg border" style={{ background: "#f8f9ff", borderColor: "#787fff30" }}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-xs font-medium" style={{ color: "#555" }}>
                    세그먼트 분할 미리보기
                  </p>
                  <p className="text-[10px]" style={{ color: "#999" }}>
                    {autoSegmentPlan.totalSegments}개 세그먼트 · 예상 {formatDuration(autoSegmentPlan.totalEstimatedDurationSec)} · 타겟 {formatDuration(targetRuntime)}
                  </p>
                </div>
                {!segmentPlan && (
                  <Button size="sm" variant="outline" onClick={handleAnalyzeScript} className="text-xs">
                    세그먼트 편집
                  </Button>
                )}
              </div>
              <div className="flex gap-0.5 h-4 rounded overflow-hidden">
                {(segmentPlan ? editedSegments : autoSegmentPlan.segments).map((seg, i) => (
                  <div
                    key={i}
                    className="h-full flex items-center justify-center text-[8px] font-bold text-white"
                    style={{
                      flex: seg.assignedDurationSec,
                      background: seg.isFirstSegment ? "#3b82f6" : seg.isLastSegment ? "#a855f7" : "#787fff",
                      minWidth: "16px",
                    }}
                    title={`세그먼트 ${seg.segmentIndex}: ${seg.assignedDurationSec}s — ${seg.narrativeLabel}`}
                  >
                    {seg.segmentIndex}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Primary CTA — always visible, generates project structure */}
          {!result && (
            <Button
              onClick={handleGenerateAll}
              disabled={!storyText.trim() || status === "loading"}
              className="w-full h-11 text-sm"
              style={{ background: "#787fff" }}
            >
              {status === "loading"
                ? "프로젝트 구조 생성 중..."
                : autoSegmentPlan && autoSegmentPlan.totalSegments > 1
                  ? `${autoSegmentPlan.totalSegments}개 세그먼트 프로젝트 생성`
                  : "프로젝트 구조 생성"
              }
            </Button>
          )}

          {error && (
            <div className="text-sm p-3 rounded-lg" style={{ background: "#fef2f2", color: "#dc2626" }}>
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Step 4: Segmentation Plan (optional editing) ── */}
      {segmentPlan && editedSegments.length > 0 && !result && status !== "loading" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#f59e0b" }}>4</span>
              세그먼트 플랜
              <Badge variant="outline" className="ml-auto text-xs">
                {editedSegments.length}개 세그먼트 · {formatDuration(segmentTotalRuntime)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Segment Runtime Budget */}
            <div className="p-3 rounded-lg border" style={{ background: "#fafafa" }}>
              <div className="flex items-center justify-between text-xs mb-2">
                <span style={{ color: "#666" }}>세그먼트 런타임 합계</span>
                <span className="font-bold" style={{
                  color: segmentTotalRuntime > targetRuntime * 1.1 ? "#dc2626" : "#22c55e"
                }}>
                  {formatDuration(segmentTotalRuntime)} / {formatDuration(targetRuntime)}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "#e5e7eb" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (segmentTotalRuntime / targetRuntime) * 100)}%`,
                    background: segmentTotalRuntime > targetRuntime * 1.1
                      ? "#ef4444"
                      : segmentTotalRuntime > targetRuntime * 0.85
                        ? "#eab308"
                        : "#22c55e",
                  }}
                />
              </div>
            </div>

            {/* Warnings */}
            {segmentPlan.warnings.length > 0 && (
              <div className="space-y-1">
                {segmentPlan.warnings.map((w, i) => (
                  <p key={i} className="text-[10px] px-2 py-1 rounded" style={{ background: "#fefce8", color: "#ca8a04" }}>
                    ⚠ {w}
                  </p>
                ))}
              </div>
            )}

            {/* Segment Editor */}
            <div className="space-y-2">
              {editedSegments.map((seg, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-2" style={{
                  borderLeftWidth: "3px",
                  borderLeftColor: seg.isFirstSegment ? "#3b82f6" : seg.isLastSegment ? "#a855f7" : "#787fff",
                }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold">세그먼트 {seg.segmentIndex}</span>
                      <Badge variant="outline" className="text-[10px]">{seg.narrativeLabel}</Badge>
                      {seg.continuationFromPrev && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "#dbeafe", color: "#2563eb" }}>
                          ← 연결
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-[10px]">{seg.assignedDurationSec}s</Label>
                      <input
                        type="range"
                        min={SEGMENT_MIN_DURATION}
                        max={SEGMENT_MAX_DURATION}
                        value={seg.assignedDurationSec}
                        onChange={e => handleUpdateSegmentDuration(i, Number(e.target.value))}
                        className="w-20"
                      />
                    </div>
                  </div>
                  {mode === "studio" ? (
                    <Textarea
                      value={seg.text}
                      onChange={e => handleUpdateSegmentText(i, e.target.value)}
                      rows={2}
                      className="text-xs resize-none"
                    />
                  ) : (
                    <p className="text-xs" style={{ color: "#555" }}>
                      {seg.text.slice(0, 150)}{seg.text.length > 150 ? "…" : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <Button
              onClick={handleGenerateAll}
              className="w-full"
              style={{ background: "#787fff" }}
            >
              {`${editedSegments.length}개 세그먼트 → 프로젝트 생성`}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: Sequence Design ── */}
      {result && status === "success" && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#8b5cf6" }}>
                  {segmentPlan ? "5" : "4"}
                </span>
                프로젝트 시퀀스
                <Badge variant="outline" className="ml-auto text-xs">
                  {result.totalCuts}개 세그먼트 · {formatDuration(totalPlannedRuntime)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Sequence Summary Bar */}
              <div className="flex items-center gap-0.5 mb-4 h-8 rounded-lg overflow-hidden" style={{ background: "#f5f5f5" }}>
                {result.cuts.map((cut, i) => {
                  const shots = cut.multiShot ?? [];
                  const widthPercent = totalPlannedRuntime > 0 ? (cut.durationSec / totalPlannedRuntime) * 100 : 0;
                  const isExtend = i > 0;
                  return (
                    <div
                      key={cut.cutNumber}
                      className="h-full flex items-center justify-center text-[10px] font-bold text-white relative"
                      style={{
                        width: `${widthPercent}%`,
                        minWidth: "20px",
                        background: shots[0]?.role ? SHOT_ROLE_META[shots[0].role]?.color ?? "#787fff" : "#787fff",
                        borderLeft: isExtend ? "2px solid rgba(255,255,255,0.5)" : undefined,
                      }}
                      title={`세그먼트 ${cut.cutNumber}: ${cut.durationSec}s · ${shots.length} shots${isExtend ? " (extend)" : ""}`}
                    >
                      {cut.cutNumber}
                    </div>
                  );
                })}
              </div>

              {/* Shot Role Legend */}
              <div className="flex flex-wrap gap-2 mb-3">
                {SHOT_ROLES.map(role => (
                  <span key={role} className="text-[10px] flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SHOT_ROLE_META[role].color }} />
                    {SHOT_ROLE_META[role].label}
                  </span>
                ))}
                <span className="text-[10px] flex items-center gap-1 ml-2">
                  <span className="w-2.5 h-0.5 rounded" style={{ background: "#2563eb" }} />
                  extend 연결
                </span>
              </div>

              {/* Project Stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
                <div className="p-2 rounded-lg border text-center">
                  <p className="text-[10px]" style={{ color: "#999" }}>총 런타임</p>
                  <p className="text-base font-bold" style={{ color: "#1a1a2e" }}>{formatDuration(totalPlannedRuntime)}</p>
                </div>
                <div className="p-2 rounded-lg border text-center">
                  <p className="text-[10px]" style={{ color: "#999" }}>세그먼트</p>
                  <p className="text-base font-bold" style={{ color: "#1a1a2e" }}>{result.totalCuts}</p>
                </div>
                <div className="p-2 rounded-lg border text-center">
                  <p className="text-[10px]" style={{ color: "#999" }}>평균 세그먼트</p>
                  <p className="text-base font-bold" style={{ color: "#1a1a2e" }}>
                    {result.totalCuts > 0 ? (totalPlannedRuntime / result.totalCuts).toFixed(1) : 0}s
                  </p>
                </div>
                <div className="p-2 rounded-lg border text-center">
                  <p className="text-[10px]" style={{ color: "#999" }}>생성 단위</p>
                  <p className="text-base font-bold" style={{ color: "#787fff" }}>3-15s</p>
                </div>
                <div className="p-2 rounded-lg border text-center">
                  <p className="text-[10px]" style={{ color: "#999" }}>연결 방식</p>
                  <p className="text-base font-bold" style={{ color: "#2563eb" }}>Extend</p>
                </div>
              </div>

              <Separator className="my-4" />

              {/* Per-Cut Shot Editor */}
              <div className="space-y-3">
                {result.cuts.map((cut, i) => (
                  <CutShotEditor
                    key={cut.cutNumber}
                    cut={cut}
                    mode={mode}
                    segmentIndex={i + 1}
                    isExtend={i > 0}
                    onUpdateCut={handleUpdateCut}
                    onUpdateShotRole={handleUpdateShotRole}
                    onUpdateShotPrompt={handleUpdateShotPrompt}
                    onUpdateShotDuration={handleUpdateShotDuration}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Batch: Add to Queue */}
          {mode === "batch" && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">배치 큐에 추가</p>
                    <p className="text-xs" style={{ color: "#999" }}>
                      현재 프로젝트를 배치 큐에 추가하고 새 프로젝트를 계속 계획하세요.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!result) return;
                      const entry: ClipBudgetEntry = {
                        clipId: `clip-${Date.now()}`,
                        label: result.projectTitle || `프로젝트 ${batchEntries.length + 1}`,
                        shotCount: result.totalCuts,
                        totalDurationSec: result.cuts.reduce((s, c) => s + c.durationSec, 0),
                        priority: "normal",
                      };
                      onUpdateBatchEntries([...batchEntries, entry]);
                    }}
                  >
                    큐에 추가 ({batchEntries.length}개 대기 중)
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button onClick={onAdvanceToBuild} className="px-6" style={{ background: "#22c55e" }}>
              Build 단계로 →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CutShotEditor
// ═══════════════════════════════════════════════════════════════════

interface CutShotEditorProps {
  cut: Cut;
  mode: AppMode;
  segmentIndex: number;
  isExtend: boolean;
  onUpdateCut: (cutNumber: number, updates: Partial<Cut>) => void;
  onUpdateShotRole: (cutNumber: number, shotIndex: number, role: ShotRole) => void;
  onUpdateShotPrompt: (cutNumber: number, shotIndex: number, prompt: string) => void;
  onUpdateShotDuration: (cutNumber: number, shotIndex: number, duration: string) => void;
}

function CutShotEditor({
  cut,
  mode,
  segmentIndex,
  isExtend,
  onUpdateCut,
  onUpdateShotRole,
  onUpdateShotPrompt,
  onUpdateShotDuration,
}: CutShotEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const shots = cut.multiShot ?? [];

  const roleDistribution = useMemo(() => {
    const dist: Record<string, number> = {};
    shots.forEach(s => {
      const r = s.role || "develop";
      dist[r] = (dist[r] || 0) + 1;
    });
    return dist;
  }, [shots]);

  const recommendedShots = useMemo(() => getRecommendedShotRange(cut.durationSec), [cut.durationSec]);

  return (
    <div className="border rounded-lg overflow-hidden" style={{
      borderLeftWidth: "3px",
      borderLeftColor: isExtend ? "#2563eb" : "#787fff",
    }}>
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color: "#333" }}>Seg {segmentIndex}</span>
          {isExtend && (
            <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "#dbeafe", color: "#2563eb" }}>
              extend
            </span>
          )}
          <span className="text-[10px]" style={{ color: "#999" }}>{cut.durationSec}s</span>
          <div className="flex gap-0.5">
            {shots.map((s, i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: SHOT_ROLE_META[s.role || "develop"]?.color ?? "#787fff" }}
              />
            ))}
          </div>
          <span className="text-[10px]" style={{ color: "#bbb" }}>
            {shots.length > 0 ? `${shots.length} shots` : "single"} · 추천 {recommendedShots.min}-{recommendedShots.max}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {Object.entries(roleDistribution).map(([role, count]) => (
            <Badge key={role} variant="outline" className="text-[9px] px-1 py-0">
              {SHOT_ROLE_META[role as ShotRole]?.label ?? role}×{count}
            </Badge>
          ))}
          <span className="text-xs" style={{ color: "#ccc" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3" style={{ background: "#fafafa" }}>
          <div className="flex items-center gap-3">
            <Label className="text-xs">세그먼트 길이</Label>
            <input
              type="range"
              min={SEGMENT_MIN_DURATION}
              max={SEGMENT_MAX_DURATION}
              value={cut.durationSec}
              onChange={e => onUpdateCut(cut.cutNumber, { durationSec: Number(e.target.value) })}
              className="w-32"
            />
            <span className="text-xs font-bold w-8">{cut.durationSec}s</span>
            <p className="text-[10px] ml-auto" style={{ color: "#bbb" }}>
              {cut.sceneDescription?.slice(0, 60)}
            </p>
          </div>

          {shots.length > 0 ? (
            <div className="space-y-2">
              {shots.map((shot, i) => (
                <div key={i} className="flex gap-2 items-start p-2 rounded border bg-white">
                  <div className="flex flex-col items-center gap-1 min-w-[55px]">
                    <span className="text-[9px] font-bold" style={{ color: "#666" }}>Shot {i + 1}</span>
                    <Select
                      value={shot.role || "develop"}
                      onValueChange={(v) => onUpdateShotRole(cut.cutNumber, i, v as ShotRole)}
                    >
                      <SelectTrigger className="h-5 text-[9px] w-14 px-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SHOT_ROLES.map(role => (
                          <SelectItem key={role} value={role} className="text-xs">
                            <span className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: SHOT_ROLE_META[role].color }} />
                              {SHOT_ROLE_META[role].label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1">
                    {mode === "studio" ? (
                      <Textarea
                        value={shot.prompt}
                        onChange={e => onUpdateShotPrompt(cut.cutNumber, i, e.target.value)}
                        rows={2}
                        className="text-xs resize-none"
                        maxLength={512}
                      />
                    ) : (
                      <p className="text-xs p-1.5 rounded" style={{ background: "#f5f5f5", color: "#555" }}>
                        {shot.prompt.slice(0, 120)}{shot.prompt.length > 120 ? "…" : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-0.5 min-w-[40px]">
                    <input
                      type="number"
                      min={1}
                      max={15}
                      value={Number(shot.duration) || 3}
                      onChange={e => onUpdateShotDuration(cut.cutNumber, i, e.target.value)}
                      className="w-10 h-5 text-[10px] text-center border rounded"
                    />
                    <span className="text-[9px]" style={{ color: "#ccc" }}>sec</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-center py-3" style={{ color: "#999" }}>
              단일 프롬프트로 생성됩니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
