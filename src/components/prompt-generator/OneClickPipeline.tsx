"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PipelineStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  error?: string;
}

interface OneClickPipelineProps {
  hasCuts: boolean;
  hasVideo: boolean;
  hasSrt: boolean;
  hasSeo: boolean;
  // Keep old props optional for backward compatibility
  hasStoryboard?: boolean;
  onRunStoryboard?: () => Promise<void>;
  onRunVideoGeneration: () => void;
  onRunSrt: () => Promise<void>;
  onRunSeo: () => Promise<void>;
  onRunThumbnail: () => Promise<void>;
}

export default function OneClickPipeline({
  hasCuts, hasVideo: _hasVideo, hasSrt, hasSeo,
  onRunVideoGeneration, onRunSrt, onRunSeo, onRunThumbnail,
}: OneClickPipelineProps) {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<PipelineStep[]>([
    { id: "video", label: "영상 자동 생성", status: "pending" },
    { id: "srt", label: "SRT 자막 생성", status: "pending" },
    { id: "seo", label: "유튜브 SEO 생성", status: "pending" },
    { id: "thumbnail", label: "썸네일 생성", status: "pending" },
  ]);

  const updateStep = (id: string, status: PipelineStep["status"], error?: string) => {
    setSteps((prev) => prev.map((s) => s.id === id ? { ...s, status, error } : s));
  };

  const runPipeline = async () => {
    setRunning(true);
    setSteps((prev) => prev.map((s) => ({ ...s, status: "pending", error: undefined })));

    // Step 1: Video (non-blocking — starts auto mode)
    updateStep("video", "running");
    try {
      onRunVideoGeneration();
      updateStep("video", "done");
    } catch {
      updateStep("video", "error", "자동 생성 시작 실패");
    }

    // Step 2-5: Run in parallel
    const parallelTasks = [
      { id: "srt", skip: hasSrt, fn: onRunSrt },
      { id: "seo", skip: hasSeo, fn: onRunSeo },
      { id: "thumbnail", skip: false, fn: onRunThumbnail },
    ];

    await Promise.allSettled(
      parallelTasks.map(async (task) => {
        if (task.skip) {
          updateStep(task.id, "done");
          return;
        }
        updateStep(task.id, "running");
        try {
          await task.fn();
          updateStep(task.id, "done");
        } catch (e) {
          updateStep(task.id, "error", e instanceof Error ? e.message : "실패");
        }
      })
    );

    setRunning(false);
  };

  const doneCount = steps.filter((s) => s.status === "done").length;
  const errorCount = steps.filter((s) => s.status === "error").length;

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#22c55e40" }}>
      <CardHeader className="pb-2" style={{ background: "linear-gradient(135deg, #22c55e15, #787fff10)" }}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm" style={{ color: "#16a34a" }}>
            원클릭 쇼츠 파이프라인
          </CardTitle>
          <div className="flex items-center gap-2">
            {running && (
              <Badge className="text-[10px] text-white animate-pulse" style={{ background: "#22c55e" }}>
                {doneCount}/{steps.length} 진행 중
              </Badge>
            )}
            {errorCount > 0 && (
              <Badge className="text-[10px] text-white" style={{ background: "#ef4444" }}>
                {errorCount} 실패
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        <p className="text-[10px] text-muted-foreground">
          영상 생성 → 자막 → SEO → 썸네일까지 한 번에 실행합니다.
        </p>

        {/* 파이프라인 스텝 시각화 */}
        <div className="flex gap-1 items-center">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center gap-1">
              <div className="flex flex-col items-center">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all"
                  style={{
                    background: step.status === "done" ? "#22c55e"
                      : step.status === "running" ? "#787fff"
                      : step.status === "error" ? "#ef4444"
                      : "#e5e5e5",
                    color: step.status === "pending" ? "#999" : "white",
                    animation: step.status === "running" ? "pulse 1.5s infinite" : "none",
                  }}
                >
                  {step.status === "done" ? "✓" : step.status === "error" ? "!" : i + 1}
                </div>
                <span className="text-[8px] text-center mt-0.5 w-12 leading-tight text-muted-foreground">
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className="w-4 h-0.5 mt-[-14px]"
                  style={{ background: step.status === "done" ? "#22c55e" : "#e5e5e5" }}
                />
              )}
            </div>
          ))}
        </div>

        {/* 에러 표시 */}
        {steps.filter((s) => s.error).map((s) => (
          <p key={s.id} className="text-[10px] text-red-500">
            {s.label}: {s.error}
          </p>
        ))}

        <Button
          className="w-full text-white font-medium"
          style={{ background: running ? "#999" : "#22c55e" }}
          disabled={!hasCuts || running}
          onClick={runPipeline}
        >
          {running ? "파이프라인 실행 중..." : "원클릭 실행"}
        </Button>
      </CardContent>
    </Card>
  );
}
