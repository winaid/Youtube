"use client";

import { useState, useMemo, useCallback } from "react";
import {
  PromptInput, PromptOutput, Cut,
  SHOT_ROLE_META, SHOT_ROLES,
  type VideoWorkflowType,
} from "@/types";
import {
  resolveModelForWorkflow,
  getCapability,
  KLING_MODEL_REGISTRY,
  type WorkflowType,
} from "@/lib/kling-capability";
import { validateMultiShots } from "@/lib/multishot-validation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppMode } from "./AppShell";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface BuildTabProps {
  mode: AppMode;
  result: PromptOutput | null;
  lastInput: PromptInput | null;
  secondsPerScene: number;
  onSecondsPerSceneChange: (v: number) => void;
  onUpdateResult: (result: PromptOutput) => void;
  onAdvanceToGenerate: () => void;
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function BuildTab({
  mode,
  result,
  lastInput: _lastInput,
  secondsPerScene: _secondsPerScene,
  onSecondsPerSceneChange: _onSecondsPerSceneChange,
  onUpdateResult: _onUpdateResult,
  onAdvanceToGenerate,
}: BuildTabProps) {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowType>("text-to-video");
  const [showPayload, setShowPayload] = useState(false);

  const selectedModel = useMemo(
    () => resolveModelForWorkflow({ workflow: selectedWorkflow }),
    [selectedWorkflow],
  );

  const capability = useMemo(
    () => selectedModel ? getCapability(selectedModel) : null,
    [selectedModel],
  );

  const validationResults = useMemo(() => {
    if (!result || !selectedModel) return [];
    return result.cuts.map(cut => ({
      cutNumber: cut.cutNumber,
      validation: validateMultiShots(selectedModel, cut.multiShot ?? [], cut.durationSec),
      cut,
    }));
  }, [result, selectedModel]);

  const totalErrors = validationResults.reduce((sum, r) => {
    const errs = r.validation.shotIssues.filter(i => i.severity === "error").length
      + r.validation.aggregateIssues.filter(i => i.severity === "error").length;
    return sum + errs;
  }, 0);
  const totalWarnings = validationResults.reduce((sum, r) => {
    const warns = r.validation.shotIssues.filter(i => i.severity === "warning").length
      + r.validation.aggregateIssues.filter(i => i.severity === "warning").length;
    return sum + warns;
  }, 0);
  const allValid = totalErrors === 0;

  const payloadPreview = useMemo(() => {
    if (!result || !showPayload) return null;
    return {
      model: selectedModel,
      workflow: selectedWorkflow,
      totalCuts: result.totalCuts,
      cuts: result.cuts.map(cut => ({
        cutNumber: cut.cutNumber,
        durationSec: cut.durationSec,
        shotCount: cut.multiShot?.length ?? 1,
        shots: cut.multiShot?.map(s => ({
          role: s.role,
          duration: s.duration,
          promptLength: s.prompt.length,
        })) ?? [],
      })),
    };
  }, [result, showPayload, selectedModel, selectedWorkflow]);

  if (!result) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-2">
          <p className="text-sm" style={{ color: "#999" }}>시퀀스가 없습니다</p>
          <p className="text-xs" style={{ color: "#ccc" }}>Plan 탭에서 먼저 시퀀스를 생성하세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Model & Workflow Selection ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#3b82f6" }}>1</span>
            Kling 워크플로우 선택
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>워크플로우</Label>
              <Select value={selectedWorkflow} onValueChange={v => setSelectedWorkflow(v as WorkflowType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text-to-video">Text → Video (메인)</SelectItem>
                  <SelectItem value="image-to-video">Image → Video</SelectItem>
                  <SelectItem value="reference-to-video">Reference → Video</SelectItem>
                  <SelectItem value="video-edit">Video Edit</SelectItem>
                  <SelectItem value="custom-element">Custom Element</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {capability && (
              <div className="space-y-2">
                <Label>선택된 모델</Label>
                <div className="p-3 rounded-lg border" style={{ background: "#f8f9fa" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{capability.displayName}</span>
                    <Badge variant="outline" className="text-[10px]">{capability.modelId}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2 text-[10px]" style={{ color: "#888" }}>
                    <span>Max shots: {capability.maxShots}</span>
                    <span>Duration: {capability.minDuration}–{capability.maxDuration}s</span>
                    {capability.supportsMultiShot && <Badge variant="outline" className="text-[10px]">Multi-shot</Badge>}
                    {capability.supportsSound && <Badge variant="outline" className="text-[10px]">Sound</Badge>}
                    {capability.supportsElements && <Badge variant="outline" className="text-[10px]">Elements</Badge>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Validation Results ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: allValid ? "#22c55e" : "#ef4444" }}>2</span>
            시퀀스 검증
            <div className="ml-auto flex gap-2">
              {totalErrors > 0 && (
                <Badge className="text-[10px]" style={{ background: "#fef2f2", color: "#dc2626" }}>
                  {totalErrors} 에러
                </Badge>
              )}
              {totalWarnings > 0 && (
                <Badge className="text-[10px]" style={{ background: "#fefce8", color: "#ca8a04" }}>
                  {totalWarnings} 경고
                </Badge>
              )}
              {allValid && (
                <Badge className="text-[10px]" style={{ background: "#f0fdf4", color: "#16a34a" }}>
                  통과
                </Badge>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mode === "studio" ? (
            <div className="space-y-2">
              {validationResults.map(({ cutNumber, validation, cut }) => {
                const allIssues = [
                  ...validation.shotIssues.map(i => ({ severity: i.severity, message: i.message })),
                  ...validation.aggregateIssues.map(i => ({ severity: i.severity, message: i.message })),
                ];
                const errors = allIssues.filter(i => i.severity === "error");
                const warnings = allIssues.filter(i => i.severity === "warning");
                return (
                  <div key={cutNumber} className="flex items-start gap-3 p-2 rounded border">
                    <span className="text-xs font-bold min-w-[40px]">컷 {cutNumber}</span>
                    <div className="flex-1 space-y-1">
                      {errors.length === 0 && warnings.length === 0 && (
                        <span className="text-[10px]" style={{ color: "#22c55e" }}>검증 통과</span>
                      )}
                      {errors.map((err, i) => (
                        <div key={i} className="text-[10px] flex items-start gap-1" style={{ color: "#dc2626" }}>
                          <span>✕</span><span>{err.message}</span>
                        </div>
                      ))}
                      {warnings.map((warn, i) => (
                        <div key={i} className="text-[10px] flex items-start gap-1" style={{ color: "#ca8a04" }}>
                          <span>⚠</span><span>{warn.message}</span>
                        </div>
                      ))}
                    </div>
                    <span className="text-[10px]" style={{ color: "#ccc" }}>
                      {cut.multiShot?.length ?? 0} shots · {cut.durationSec}s
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-4">
              {allValid ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium" style={{ color: "#22c55e" }}>배치 검증 통과</p>
                  <p className="text-xs" style={{ color: "#999" }}>{result.totalCuts}개 컷 · 에러 없음</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm font-medium" style={{ color: "#dc2626" }}>검증 실패: {totalErrors}개 에러</p>
                  <p className="text-xs" style={{ color: "#999" }}>Studio 모드에서 상세 검토하세요.</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Payload Preview ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#8b5cf6" }}>3</span>
            페이로드 미리보기
            <Button
              variant="outline"
              size="sm"
              className="ml-auto text-xs"
              onClick={() => setShowPayload(!showPayload)}
            >
              {showPayload ? "숨기기" : "미리보기"}
            </Button>
          </CardTitle>
        </CardHeader>
        {showPayload && payloadPreview && (
          <CardContent>
            <pre className="text-[11px] p-3 rounded-lg overflow-x-auto" style={{ background: "#1a1a2e", color: "#e5e5e5", maxHeight: "300px" }}>
              {JSON.stringify(payloadPreview, null, 2)}
            </pre>
          </CardContent>
        )}
      </Card>

      {/* Advance to Generate */}
      <div className="flex justify-end">
        <Button
          onClick={onAdvanceToGenerate}
          disabled={!allValid}
          className="px-6"
          style={{ background: allValid ? "#22c55e" : "#ccc" }}
        >
          {allValid ? "Generate 단계로 →" : "에러를 먼저 수정하세요"}
        </Button>
      </div>
    </div>
  );
}
