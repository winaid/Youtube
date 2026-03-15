"use client";

import { useMemo } from "react";
import { PromptInput, PromptOutput, SHOT_ROLE_META } from "@/types";
import { useVideoGeneration } from "@/hooks/useVideoGeneration";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AppMode } from "./AppShell";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface GenerateTabProps {
  mode: AppMode;
  result: PromptOutput | null;
  lastInput: PromptInput | null;
  secondsPerScene: number;
  onUpdateResult: (result: PromptOutput) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function GenerateTab({
  mode,
  result,
  lastInput: _lastInput,
  secondsPerScene: _secondsPerScene,
  onUpdateResult: _onUpdateResult,
}: GenerateTabProps) {
  const videoGen = useVideoGeneration({
    cuts: result?.cuts ?? [],
    storyboardImages: {},
    storyboardEndImages: {},
    faceRefs: [],
    elementAssets: [],
    onSeedDetected: () => {},
  });

  const { clips, isAutoMode } = videoGen;

  const completedClips = clips.filter(c => c.status === "completed");
  const failedClips = clips.filter(c => c.status === "failed");
  const generatingClips = clips.filter(c => c.status === "generating" || c.status === "polling");
  const idleClips = clips.filter(c => c.status === "idle");

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
      {/* ── Generation Controls ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            생성 컨트롤
            <div className="ml-auto flex gap-2">
              <Badge variant="outline" className="text-[10px]">
                {completedClips.length}/{clips.length} 완료
              </Badge>
              {failedClips.length > 0 && (
                <Badge className="text-[10px]" style={{ background: "#fef2f2", color: "#dc2626" }}>
                  {failedClips.length} 실패
                </Badge>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {mode === "batch" ? (
              <>
                <Button
                  onClick={() => videoGen.startAutoGeneration()}
                  disabled={isAutoMode || idleClips.length === 0}
                  style={{ background: "#787fff" }}
                >
                  전체 배치 생성 시작
                </Button>
                <Button
                  variant="outline"
                  onClick={() => videoGen.stopAutoGeneration()}
                  disabled={!isAutoMode}
                >
                  배치 중지
                </Button>
              </>
            ) : (
              <Button
                onClick={() => videoGen.startAutoGeneration()}
                disabled={isAutoMode || idleClips.length === 0}
                style={{ background: "#787fff" }}
              >
                순차 생성 시작
              </Button>
            )}
            {failedClips.length > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  failedClips.forEach(c => {
                    videoGen.generateCut(c.cutNumber);
                  });
                }}
              >
                실패한 {failedClips.length}개 재시도
              </Button>
            )}
            {videoGen.recoverableJobs.length > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  videoGen.recoverableJobs.forEach(job => {
                    videoGen.resumeJob(job);
                  });
                }}
              >
                {videoGen.recoverableJobs.length}개 작업 복구
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Progress Overview ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">진행 상황</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Progress Bar */}
          <div className="mb-4">
            <div className="h-3 rounded-full overflow-hidden flex" style={{ background: "#f1f1f4" }}>
              {clips.length > 0 && (
                <>
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${(completedClips.length / clips.length) * 100}%`,
                      background: "#22c55e",
                    }}
                  />
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${(generatingClips.length / clips.length) * 100}%`,
                      background: "#787fff",
                    }}
                  />
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${(failedClips.length / clips.length) * 100}%`,
                      background: "#ef4444",
                    }}
                  />
                </>
              )}
            </div>
            <div className="flex justify-between mt-1 text-[10px]" style={{ color: "#999" }}>
              <span>완료 {completedClips.length}</span>
              <span>진행 {generatingClips.length}</span>
              <span>대기 {idleClips.length}</span>
              <span>실패 {failedClips.length}</span>
            </div>
          </div>

          {/* Clip Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {clips.map(clip => {
              const cut = result.cuts.find(c => c.cutNumber === clip.cutNumber);
              const statusColor = {
                idle: "#999",
                generating: "#787fff",
                polling: "#787fff",
                completed: "#22c55e",
                failed: "#ef4444",
              }[clip.status];

              return (
                <div
                  key={clip.cutNumber}
                  className="border rounded-lg p-3 space-y-2"
                  style={{ borderColor: `${statusColor}40` }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">컷 {clip.cutNumber}</span>
                      <span className="text-[10px]" style={{ color: "#999" }}>{clip.durationSec}s</span>
                    </div>
                    <Badge
                      className="text-[10px]"
                      style={{ background: `${statusColor}15`, color: statusColor }}
                    >
                      {clip.status === "idle" ? "대기" :
                       clip.status === "generating" ? "생성 중" :
                       clip.status === "polling" ? "처리 중" :
                       clip.status === "completed" ? "완료" : "실패"}
                    </Badge>
                  </div>

                  {cut?.multiShot && cut.multiShot.length > 0 && (
                    <div className="flex gap-1">
                      {cut.multiShot.map((s, i) => (
                        <span
                          key={i}
                          className="text-[9px] px-1.5 py-0.5 rounded"
                          style={{
                            background: SHOT_ROLE_META[s.role || "develop"]?.bg ?? "#f5f5f5",
                            color: SHOT_ROLE_META[s.role || "develop"]?.color ?? "#666",
                          }}
                        >
                          {SHOT_ROLE_META[s.role || "develop"]?.label ?? "전개"}
                        </span>
                      ))}
                    </div>
                  )}

                  {clip.status === "completed" && clip.videoUri && (
                    <video
                      src={clip.videoUri}
                      className="w-full rounded aspect-video bg-black"
                      controls
                      muted
                      playsInline
                    />
                  )}

                  {clip.status === "failed" && (
                    <div className="space-y-1">
                      <p className="text-[10px]" style={{ color: "#dc2626" }}>
                        {clip.error || "생성 실패"}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs w-full"
                        onClick={() => videoGen.generateCut(clip.cutNumber)}
                      >
                        재시도
                      </Button>
                    </div>
                  )}

                  {clip.status === "idle" && mode === "studio" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs w-full"
                      onClick={() => videoGen.generateCut(clip.cutNumber)}
                    >
                      개별 생성
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
