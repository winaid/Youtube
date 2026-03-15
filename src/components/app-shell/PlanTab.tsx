"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  PromptInput, PromptOutput, GeneratorStatus, Region, AnimationMode,
  Duration, AspectRatio, Cut, MultiShotPrompt, ShotRole,
  SHOT_ROLE_META, SHOT_ROLES,
} from "@/types";
import { DURATION_FALLBACK, DURATION_MIN, DURATION_MAX, safeDuration } from "@/lib/duration-reconciliation";
import { getRecommendedShotRange, RUNTIME_SHOT_HEURISTICS } from "@/lib/multishot-validation";
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
}: PlanTabProps) {
  // ── Input State ──
  const [storyText, setStoryText] = useState(lastInput?.storyText ?? "");
  const [targetDuration, setTargetDuration] = useState<number>(secondsPerScene || 10);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(lastInput?.aspectRatio ?? "16:9");

  useEffect(() => {
    if (lastInput?.storyText && storyText === "") {
      setStoryText(lastInput.storyText);
    }
  }, [lastInput, storyText]);

  const recommendedShots = useMemo(() => getRecommendedShotRange(targetDuration), [targetDuration]);

  const handleSubmit = useCallback(() => {
    if (!storyText.trim()) return;
    const input: PromptInput = {
      storyText: storyText.trim(),
      directorPersona: "neutral",
      region: "한국" as Region,
      animationMode: "cinematic-realism" as AnimationMode,
      duration: targetDuration as Duration,
      aspectRatio,
      cutDuration: targetDuration,
    };
    onGenerate(input);
  }, [storyText, targetDuration, aspectRatio, onGenerate]);

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

  return (
    <div className="space-y-6">
      {/* ── Step 1: Idea Input ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#787fff" }}>1</span>
            아이디어 입력
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="story">영상 아이디어</Label>
            <Textarea
              id="story"
              value={storyText}
              onChange={e => setStoryText(e.target.value)}
              placeholder="어떤 숏폼 영상을 만들고 싶은지 설명하세요. 예: '카페에서 커피를 마시다 창밖 비를 바라보는 여자. 갑자기 비가 그치고 무지개가 뜬다.'"
              rows={4}
              className="resize-none"
            />
            <p className="text-xs" style={{ color: "#999" }}>
              3~15초 숏폼 영상에 적합한 아이디어를 입력하세요. 장면 전환과 감정 변화가 있으면 좋습니다.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>타겟 런타임</Label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={DURATION_MIN}
                  max={DURATION_MAX}
                  value={targetDuration}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setTargetDuration(v);
                    onSecondsPerSceneChange(v);
                  }}
                  className="flex-1"
                />
                <span className="text-sm font-bold w-10 text-right">{targetDuration}s</span>
              </div>
              <p className="text-[10px]" style={{ color: "#aaa" }}>
                추천 샷 수: {recommendedShots.min}–{recommendedShots.max}개
              </p>
            </div>

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
            </div>

            {mode === "studio" && (
              <div className="space-y-2">
                <Label>워크플로우</Label>
                <Select defaultValue="text-to-video">
                  <SelectTrigger className="h-9">
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

          <Button
            onClick={handleSubmit}
            disabled={!storyText.trim() || status === "loading"}
            className="w-full"
            style={{ background: "#787fff" }}
          >
            {status === "loading" ? "시퀀스 생성 중..." : "시퀀스 생성"}
          </Button>

          {error && (
            <div className="text-sm p-3 rounded-lg" style={{ background: "#fef2f2", color: "#dc2626" }}>
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Step 2: Sequence Design ── */}
      {result && status === "success" && (
        <>
          {/* Sequence Overview */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#22c55e" }}>2</span>
                시퀀스 디자인
                <Badge variant="outline" className="ml-auto text-xs">
                  {result.totalCuts}컷 · {totalPlannedRuntime}s
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Sequence Summary Bar */}
              <div className="flex items-center gap-1 mb-4 h-8 rounded-lg overflow-hidden" style={{ background: "#f5f5f5" }}>
                {result.cuts.map((cut) => {
                  const shots = cut.multiShot ?? [];
                  const widthPercent = totalPlannedRuntime > 0 ? (cut.durationSec / totalPlannedRuntime) * 100 : 0;
                  return (
                    <div
                      key={cut.cutNumber}
                      className="h-full flex items-center justify-center text-[10px] font-bold text-white relative group"
                      style={{
                        width: `${widthPercent}%`,
                        minWidth: "24px",
                        background: shots[0]?.role ? SHOT_ROLE_META[shots[0].role]?.color ?? "#787fff" : "#787fff",
                      }}
                      title={`컷 ${cut.cutNumber}: ${cut.durationSec}s · ${shots.length} shots`}
                    >
                      {cut.cutNumber}
                    </div>
                  );
                })}
              </div>

              {/* Shot Role Legend */}
              <div className="flex flex-wrap gap-2 mb-4">
                {SHOT_ROLES.map(role => (
                  <span key={role} className="text-[10px] flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SHOT_ROLE_META[role].color }} />
                    {SHOT_ROLE_META[role].label}
                  </span>
                ))}
              </div>

              {/* Retention Analysis */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="p-2 rounded-lg border text-center">
                  <p className="text-[10px]" style={{ color: "#999" }}>총 런타임</p>
                  <p className="text-lg font-bold" style={{ color: "#1a1a2e" }}>{totalPlannedRuntime}s</p>
                </div>
                <div className="p-2 rounded-lg border text-center">
                  <p className="text-[10px]" style={{ color: "#999" }}>총 컷</p>
                  <p className="text-lg font-bold" style={{ color: "#1a1a2e" }}>{result.totalCuts}</p>
                </div>
                <div className="p-2 rounded-lg border text-center">
                  <p className="text-[10px]" style={{ color: "#999" }}>평균 컷 길이</p>
                  <p className="text-lg font-bold" style={{ color: "#1a1a2e" }}>
                    {result.totalCuts > 0 ? (totalPlannedRuntime / result.totalCuts).toFixed(1) : 0}s
                  </p>
                </div>
                <div className="p-2 rounded-lg border text-center">
                  <p className="text-[10px]" style={{ color: "#999" }}>샷 역할 다양성</p>
                  <p className="text-lg font-bold" style={{ color: "#1a1a2e" }}>
                    {new Set(result.cuts.flatMap(c => (c.multiShot ?? []).map(s => s.role || "develop"))).size}/{SHOT_ROLES.length}
                  </p>
                </div>
              </div>

              <Separator className="my-4" />

              {/* Per-Cut Shot Editor */}
              <div className="space-y-4">
                {result.cuts.map((cut) => (
                  <CutShotEditor
                    key={cut.cutNumber}
                    cut={cut}
                    mode={mode}
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
                      현재 시퀀스를 배치 큐에 추가하고 새 클립을 계속 계획하세요.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!result) return;
                        const entry: ClipBudgetEntry = {
                          clipId: `clip-${Date.now()}`,
                          label: result.projectTitle || `클립 ${batchEntries.length + 1}`,
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
                </div>
              </CardContent>
            </Card>
          )}

          {/* Advance to Build */}
          <div className="flex justify-end">
            <Button
              onClick={onAdvanceToBuild}
              className="px-6"
              style={{ background: "#22c55e" }}
            >
              Build 단계로 →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CutShotEditor — Per-cut inline editor
// ═══════════════════════════════════════════════════════════════════

interface CutShotEditorProps {
  cut: Cut;
  mode: AppMode;
  onUpdateCut: (cutNumber: number, updates: Partial<Cut>) => void;
  onUpdateShotRole: (cutNumber: number, shotIndex: number, role: ShotRole) => void;
  onUpdateShotPrompt: (cutNumber: number, shotIndex: number, prompt: string) => void;
  onUpdateShotDuration: (cutNumber: number, shotIndex: number, duration: string) => void;
}

function CutShotEditor({
  cut,
  mode,
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

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold" style={{ color: "#333" }}>컷 {cut.cutNumber}</span>
          <span className="text-xs" style={{ color: "#999" }}>{cut.durationSec}s</span>
          <div className="flex gap-1">
            {shots.map((s, i) => (
              <span
                key={i}
                className="w-2 h-2 rounded-full"
                style={{ background: SHOT_ROLE_META[s.role || "develop"]?.color ?? "#787fff" }}
                title={SHOT_ROLE_META[s.role || "develop"]?.label}
              />
            ))}
          </div>
          {shots.length > 0 && (
            <span className="text-[10px]" style={{ color: "#aaa" }}>{shots.length} shots</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {Object.entries(roleDistribution).map(([role, count]) => (
            <Badge key={role} variant="outline" className="text-[10px] px-1.5 py-0">
              {SHOT_ROLE_META[role as ShotRole]?.label ?? role} ×{count}
            </Badge>
          ))}
          <span className="text-xs" style={{ color: "#ccc" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Expanded Editor */}
      {expanded && (
        <div className="border-t px-4 py-3 space-y-3" style={{ background: "#fafafa" }}>
          {/* Cut-level controls */}
          <div className="flex items-center gap-3">
            <Label className="text-xs">컷 길이</Label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={DURATION_MIN}
                max={DURATION_MAX}
                value={cut.durationSec}
                onChange={e => onUpdateCut(cut.cutNumber, { durationSec: Number(e.target.value) })}
                className="w-32"
              />
              <span className="text-xs font-bold w-8">{cut.durationSec}s</span>
            </div>
            <p className="text-[10px] ml-auto" style={{ color: "#bbb" }}>
              {cut.sceneDescription?.slice(0, 60)}
            </p>
          </div>

          {/* Per-shot editor */}
          {shots.length > 0 ? (
            <div className="space-y-2">
              {shots.map((shot, i) => (
                <div key={i} className="flex gap-3 items-start p-2 rounded border bg-white">
                  {/* Shot number + role */}
                  <div className="flex flex-col items-center gap-1 min-w-[60px]">
                    <span className="text-[10px] font-bold" style={{ color: "#666" }}>Shot {i + 1}</span>
                    <Select
                      value={shot.role || "develop"}
                      onValueChange={(v) => onUpdateShotRole(cut.cutNumber, i, v as ShotRole)}
                    >
                      <SelectTrigger className="h-6 text-[10px] w-16 px-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SHOT_ROLES.map(role => (
                          <SelectItem key={role} value={role} className="text-xs">
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full" style={{ background: SHOT_ROLE_META[role].color }} />
                              {SHOT_ROLE_META[role].label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Prompt */}
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
                      <p className="text-xs p-2 rounded" style={{ background: "#f5f5f5", color: "#555" }}>
                        {shot.prompt.slice(0, 120)}{shot.prompt.length > 120 ? "…" : ""}
                      </p>
                    )}
                  </div>

                  {/* Duration */}
                  <div className="flex flex-col items-center gap-1 min-w-[50px]">
                    <span className="text-[10px]" style={{ color: "#999" }}>Duration</span>
                    <input
                      type="number"
                      min={1}
                      max={15}
                      value={Number(shot.duration) || 3}
                      onChange={e => onUpdateShotDuration(cut.cutNumber, i, e.target.value)}
                      className="w-12 h-6 text-xs text-center border rounded"
                    />
                    <span className="text-[10px]" style={{ color: "#ccc" }}>sec</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-center py-4" style={{ color: "#999" }}>
              이 컷에 멀티샷이 없습니다. 단일 프롬프트로 생성됩니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
