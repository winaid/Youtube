"use client";

import { useState, useEffect, useCallback } from "react";
import { Cut, CharacterSeed, VideoClip, SHOT_ROLE_META } from "@/types";
import { inferShotRole } from "@/lib/multishot-validation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  computeMontageExportState,
  downloadAllClips,
  detectStitchCapability,
  evaluateStitchReadiness,
  executeClientStitch,
  type StitchCapability,
} from "@/lib/montage-export";
import type { StitchProgress, StitchJob } from "@/lib/client-stitch";
import type { VideoJobRecord } from "@/lib/video-job-store";
import { JOB_STATUS_LABELS, JOB_STATUS_DESCRIPTIONS } from "@/lib/video-job-store";

interface VideoGenerationPanelProps {
  cuts: Cut[];
  characterSeeds: CharacterSeed[];
  clips: VideoClip[];
  isAutoMode: boolean;
  progress: number;
  completedCount: number;
  totalCount: number;
  projectTitle?: string;
  onGenerateCut: (cutNumber: number) => void;
  onStartAuto: () => void;
  onStopAuto: () => void;
  onResetClip: (cutNumber: number) => void;
  onAddCut?: (cutNumber: number) => void;
  onSelectVariant: (cutNumber: number, variantIndex: number) => void;
  /** 복구 가능한 미완료 작업 목록 */
  recoverableJobs?: VideoJobRecord[];
  /** 미완료 작업 polling 재개 */
  onResumeJob?: (job: VideoJobRecord) => void;
}

function ElapsedTime({ startedAt }: { startedAt?: number }) {
  if (!startedAt) return null;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return (
    <span className="text-[10px] text-muted-foreground">
      {min > 0 ? `${min}분 ` : ""}{sec}초
    </span>
  );
}

function StatusBadge({ status }: { status: VideoClip["status"] }) {
  const cfg = {
    idle: { bg: "#e5e5e5", color: "#666", label: "대기" },
    generating: { bg: "#787fff30", color: "#787fff", label: "요청 중..." },
    polling: { bg: "#f59e0b30", color: "#d97706", label: "생성 중..." },
    completed: { bg: "#22c55e20", color: "#16a34a", label: "완료" },
    failed: { bg: "#ef444420", color: "#dc2626", label: "실패" },
  }[status];

  return (
    <Badge className="text-[10px]" style={{ background: cfg.bg, color: cfg.color }}>
      {(status === "generating" || status === "polling") && (
        <span className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent mr-1" />
      )}
      {cfg.label}
    </Badge>
  );
}

export default function VideoGenerationPanel({
  cuts,
  characterSeeds,
  clips,
  isAutoMode,
  progress,
  completedCount,
  totalCount,
  projectTitle,
  onGenerateCut,
  onStartAuto,
  onStopAuto,
  onResetClip,
  onAddCut,
  onSelectVariant,
  recoverableJobs,
  onResumeJob,
}: VideoGenerationPanelProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadResult, setDownloadResult] = useState<{ downloaded: number; failed: number } | null>(null);
  const [stitchCapability, setStitchCapability] = useState<StitchCapability>("not_available");
  const [stitchUnavailableReason, setStitchUnavailableReason] = useState("");
  const [stitchProgress, setStitchProgress] = useState<StitchProgress | null>(null);
  const [stitchResult, setStitchResult] = useState<StitchJob | null>(null);
  const [isStitching, setIsStitching] = useState(false);

  const montageState = computeMontageExportState(cuts, clips);
  // 동적으로 감지된 capability를 덮어쓰기
  const enrichedState = {
    ...montageState,
    stitchCapability,
    stitchUnavailableReason: stitchUnavailableReason || montageState.stitchUnavailableReason,
  };
  const stitchReadiness = evaluateStitchReadiness(enrichedState);

  // FFmpeg.wasm 가용 여부 감지 (마운트 시 1회)
  useEffect(() => {
    detectStitchCapability().then(({ capability, unavailableReason }) => {
      setStitchCapability(capability);
      setStitchUnavailableReason(unavailableReason);
    });
  }, []);

  const handleDownloadAll = async () => {
    setIsDownloading(true);
    setDownloadResult(null);
    try {
      const result = await downloadAllClips(cuts, clips, projectTitle);
      setDownloadResult(result);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleStitch = useCallback(async () => {
    if (!stitchReadiness.canStitch || isStitching) return;
    setIsStitching(true);
    setStitchResult(null);
    setStitchProgress({ phase: "idle", percent: 0, message: "준비 중..." });
    try {
      const job = await executeClientStitch(
        enrichedState,
        projectTitle,
        (progress) => setStitchProgress(progress),
      );
      setStitchResult(job);
    } finally {
      setIsStitching(false);
    }
  }, [stitchReadiness.canStitch, isStitching, enrichedState, projectTitle]);

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#22c55e40" }}>
      <CardHeader className="pb-3" style={{ background: "linear-gradient(135deg, #22c55e15, #787fff10)" }}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base" style={{ color: "#16a34a" }}>
            Kling 영상 생성
          </CardTitle>
          <Badge variant="outline" className="text-xs" style={{ borderColor: "#22c55e" }}>
            {completedCount}/{totalCount} 완료
          </Badge>
        </div>

        {totalCount > 0 && (
          <div className="mt-2">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "#e5e5e5" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, #22c55e, #787fff)",
                }}
              />
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3 pt-4">
        {/* ── 미완료 작업 복구 배너 ── */}
        {recoverableJobs && recoverableJobs.length > 0 && (
          <div
            className="rounded-lg p-3 space-y-2"
            style={{ background: "#fef3c7", border: "1px solid #fcd34d" }}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium" style={{ color: "#92400e" }}>
                이전에 진행 중이던 작업이 있어요
              </span>
              <Badge className="text-[10px] text-white" style={{ background: "#d97706" }}>
                {recoverableJobs.length}건
              </Badge>
            </div>
            <div className="space-y-1.5">
              {recoverableJobs.map((job) => {
                const elapsed = Math.floor((Date.now() - job.createdAt) / 1000);
                const min = Math.floor(elapsed / 60);
                return (
                  <div
                    key={job.jobId}
                    className="flex items-center justify-between gap-2 rounded-md p-2"
                    style={{ background: "#fffbeb", border: "1px solid #fde68a" }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium" style={{ color: "#78350f" }}>
                          장면 {job.cutNumber}
                        </span>
                        <Badge
                          className="text-[9px]"
                          style={{
                            background: job.status === "timeout_recoverable" ? "#ef444420" : "#f59e0b20",
                            color: job.status === "timeout_recoverable" ? "#dc2626" : "#d97706",
                          }}
                        >
                          {JOB_STATUS_LABELS[job.status]}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {min > 0 ? `${min}분 전 시작` : "방금 전 시작"}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {job.requestSummary.promptPreview}
                      </p>
                      {/* 멀티샷 / 모드 메타데이터 */}
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {job.requestSummary.generationMode && (
                          <Badge className="text-[8px] px-1 py-0" style={{
                            background: job.requestSummary.generationMode === "studio" ? "#7c3aed20" : "#05966920",
                            color: job.requestSummary.generationMode === "studio" ? "#7c3aed" : "#059669",
                          }}>
                            {job.requestSummary.generationMode === "studio" ? "Studio" : "Batch"}
                          </Badge>
                        )}
                        {(job.requestSummary.multiShotCount ?? 0) > 0 && (
                          <Badge className="text-[8px] px-1 py-0" style={{ background: "#e85d0415", color: "#e85d04" }}>
                            {job.requestSummary.multiShotCount}샷
                          </Badge>
                        )}
                        {job.requestSummary.multiShotRoles && job.requestSummary.multiShotRoles.length > 0 && (
                          <span className="text-[8px] text-muted-foreground">
                            {job.requestSummary.multiShotRoles.join(" → ")}
                          </span>
                        )}
                        {job.requestSummary.intentionalOneTake && (
                          <Badge className="text-[8px] px-1 py-0" style={{ background: "#6b728020", color: "#6b7280" }}>
                            원테이크
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px]" style={{ color: "#92400e" }}>
                        {JOB_STATUS_DESCRIPTIONS[job.status]}
                      </p>
                    </div>
                    {onResumeJob && (
                      <Button
                        size="sm"
                        className="h-7 text-xs text-white flex-shrink-0"
                        style={{ background: "#d97706" }}
                        onClick={() => onResumeJob(job)}
                      >
                        다시 확인
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 전체 생성 / 중단 */}
        <div className="flex gap-2">
          {!isAutoMode ? (
            <Button
              size="sm"
              onClick={onStartAuto}
              className="text-white"
              disabled={completedCount === totalCount}
              style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
            >
              전체 자동 생성
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={onStopAuto}>
              자동 생성 중단
            </Button>
          )}
          {isAutoMode && (
            <span className="flex items-center text-xs text-muted-foreground gap-1">
              <span className="h-2 w-2 rounded-full animate-pulse bg-green-500" />
              자동 생성 진행 중...
            </span>
          )}
        </div>

        {/* 장면별 상태 */}
        <div className="space-y-2">
          {cuts.map((cut, i) => {
            const clip = clips.find((c) => c.cutNumber === cut.cutNumber);
            if (!clip) return null;

            const prevClip = clips.find((c) => c.cutNumber === cut.cutNumber - 1);
            const canGenerate =
              clip.status === "idle" &&
              (cut.cutNumber === 1 || prevClip?.status === "completed");

            const charsInScene = characterSeeds
              .filter((s) => cut.charactersInScene?.includes(s.id))
              .map((s) => s.label);

            return (
              <div
                key={cut.cutNumber}
                className="rounded-lg overflow-hidden"
                style={{
                  border: clip.status === "completed"
                    ? "1px solid #22c55e40"
                    : clip.status === "failed"
                    ? "1px solid #ef444440"
                    : "1px solid #e5e5e5",
                }}
              >
                <div className="flex items-center gap-2 p-3">
                  <div
                    className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{
                      background: clip.status === "completed"
                        ? "#22c55e"
                        : clip.status === "failed"
                        ? "#ef4444"
                        : "#ccc",
                    }}
                  >
                    {clip.status === "completed" ? "✓" : cut.cutNumber}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium">장면 {cut.cutNumber}</span>

                      {/* 엔진 배지 — 완료 후 실제 사용 엔진 표시, 완료 전엔 회색 */}
                      {clip.engineUsed ? (
                        <Badge
                          className="text-[10px] text-white"
                          style={{ background: clip.engineUsed === "kling" ? "#e85d04" : "#787fff" }}
                        >
                          {clip.engineUsed === "kling" ? "Kling" : clip.engineUsed || "Kling"}
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] text-white" style={{ background: "#aaa" }}>
                          {clip.status === "idle" ? "엔진 대기" : "생성 중"}
                        </Badge>
                      )}

                      {/* 모드 배지 — 완료 후 실제 모드 표시 */}
                      <Badge variant="outline" className="text-[10px]" style={{
                        borderColor: (clip.modeUsed ?? (cut.cutNumber === 1 ? "generate" : "extend")) === "generate" ? "#787fff" : "#6b5ce7",
                        color:       (clip.modeUsed ?? (cut.cutNumber === 1 ? "generate" : "extend")) === "generate" ? "#787fff" : "#6b5ce7",
                      }}>
                        {clip.modeUsed
                          ? (clip.modeUsed === "generate" ? "Generate" : "Extend")
                          : (cut.cutNumber === 1 ? "Generate" : "Extend")}
                      </Badge>
                      {charsInScene.map((ch) => (
                        <span key={ch} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#787fff15", color: "#5a5ecc" }}>
                          {ch}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {cut.sceneDescription}
                    </p>
                    {/* 멀티샷 서브샷 목록 */}
                    {cut.multiShot && cut.multiShot.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {cut.multiShot.map((s) => {
                          const role = s.role ?? inferShotRole(s.index - 1, cut.multiShot!.length);
                          const meta = SHOT_ROLE_META[role];
                          return (
                            <span key={s.index} className="text-[9px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}25` }}>
                              <span className="font-semibold">샷{s.index}</span>
                              <span>{meta.label}</span>
                              <span>{s.duration}s</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <ElapsedTime startedAt={clip.startedAt} />
                    <StatusBadge status={clip.status} />

                    {clip.status === "idle" && (
                      <Button
                        size="sm"
                        className="h-7 text-xs text-white"
                        disabled={!canGenerate}
                        onClick={() => onGenerateCut(cut.cutNumber)}
                        style={{ background: canGenerate ? "#787fff" : "#ccc" }}
                      >
                        생성
                      </Button>
                    )}

                    {clip.status === "failed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => onResetClip(cut.cutNumber)}
                      >
                        재시도
                      </Button>
                    )}
                  </div>
                </div>

                {/* 에러 */}
                {clip.status === "failed" && clip.error && (
                  <div className="px-3 pb-2">
                    <p className="text-[10px] text-red-500 bg-red-50 rounded p-1.5">
                      {clip.error}
                    </p>
                  </div>
                )}

                {/* Quality Score & Retry Info */}
                {(clip.verification || (clip.retryCount && clip.retryCount > 0)) && (
                  <div className="px-3 pb-2 space-y-1.5">
                    <div className="flex gap-1.5 flex-wrap">
                      {clip.verification && (
                        <Badge
                          className="text-[10px] text-white"
                          style={{
                            background: clip.verification.overallScore >= 80
                              ? "#22c55e"
                              : clip.verification.overallScore >= 60
                              ? "#e09900"
                              : "#ef4444",
                          }}
                        >
                          품질 {clip.verification.overallScore}/100
                        </Badge>
                      )}
                      {/* 씬 타입 배지 */}
                      {clip.verification?.detectedSceneType && (
                        <Badge variant="outline" className="text-[10px]" style={{
                          borderColor: ({
                            character: "#787fff",
                            environment: "#16a34a",
                            "object-detail": "#d97706",
                            "map-graphic": "#0891b2",
                            "transition-abstract": "#9333ea",
                          } as Record<string, string>)[clip.verification.detectedSceneType] || "#888",
                          color: ({
                            character: "#787fff",
                            environment: "#16a34a",
                            "object-detail": "#d97706",
                            "map-graphic": "#0891b2",
                            "transition-abstract": "#9333ea",
                          } as Record<string, string>)[clip.verification.detectedSceneType] || "#888",
                        }}>
                          {({
                            character: "캐릭터",
                            environment: "환경",
                            "object-detail": "오브젝트",
                            "map-graphic": "지도/그래픽",
                            "transition-abstract": "전환/추상",
                          } as Record<string, string>)[clip.verification.detectedSceneType] || clip.verification.detectedSceneType}
                        </Badge>
                      )}
                      {clip.retryCount && clip.retryCount > 0 && (
                        <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#ef4444", color: "#dc2626" }}>
                          재시도 {clip.retryCount}회
                        </Badge>
                      )}
                    </div>

                    {/* 씬 타입별 세부 점수 */}
                    {clip.verification?.sceneTypeScores && (
                      <div className="bg-gray-50 rounded p-2 space-y-1">
                        {Object.entries(clip.verification.sceneTypeScores).map(([key, val]) => {
                          const pct = val * 10;
                          const labelMap: Record<string, string> = {
                            characterDescription: "캐릭터 묘사",
                            cameraMovement: "카메라 움직임",
                            temporalStructure: "시간 구조",
                            lightingMood: "조명/무드",
                            videoCompatibility: "영상 호환성",
                            spatialComposition: "공간 구성",
                            atmosphericDetail: "대기/분위기",
                            subjectClarity: "피사체 명확성",
                            cameraTechnique: "카메라 기법",
                            lightingTexture: "조명/텍스처",
                            terrainDetail: "지형 디테일",
                            visualClarity: "시각 명확성",
                            cameraMotion: "카메라 모션",
                            lightingAtmosphere: "조명/대기",
                            visualConcept: "시각 컨셉",
                            temporalProgression: "시간 전개",
                            moodAtmosphere: "무드/분위기",
                          };
                          return (
                            <div key={key} className="flex items-center gap-1.5">
                              <span className="text-[9px] w-[85px] shrink-0">{labelMap[key] || key}</span>
                              <div className="flex-1 h-[6px] bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${pct}%`,
                                    background: pct >= 80 ? "#22c55e" : pct >= 60 ? "#e09900" : "#ef4444",
                                  }}
                                />
                              </div>
                              <span className="text-[9px] w-[28px] text-right font-mono">{val}/10</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* rawScores fallback (씬 타입 점수가 없을 때) */}
                    {!clip.verification?.sceneTypeScores && clip.verification?.rawScores && (
                      <div className="bg-gray-50 rounded p-2 space-y-1">
                        {([
                          { key: "promptMatch" as const, label: "프롬프트 일치" },
                          { key: "styleConsistency" as const, label: "스타일 일관성" },
                          { key: "composition" as const, label: "구도/카메라" },
                          { key: "motionCoherence" as const, label: "모션 자연스러움" },
                          { key: "visualQuality" as const, label: "시각 품질" },
                          { key: "faceQuality" as const, label: "얼굴 품질" },
                        ] as const).map(({ key, label }) => {
                          const val = clip.verification!.rawScores![key];
                          const pct = val * 10;
                          return (
                            <div key={key} className="flex items-center gap-1.5">
                              <span className="text-[9px] w-[85px] shrink-0">{label}</span>
                              <div className="flex-1 h-[6px] bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${pct}%`,
                                    background: pct >= 80 ? "#22c55e" : pct >= 60 ? "#e09900" : "#ef4444",
                                  }}
                                />
                              </div>
                              <span className="text-[9px] w-[28px] text-right font-mono">{val}/10</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 감점 요인 & 개선 제안 */}
                    {clip.verification && (clip.verification.issues.length > 0 || clip.verification.suggestions.length > 0) && (
                      <div className="space-y-0.5">
                        {clip.verification.issues.map((issue, i) => (
                          <p key={`issue-${i}`} className="text-[9px] text-red-600">⚠ {issue}</p>
                        ))}
                        {clip.verification.suggestions.map((sug, i) => (
                          <p key={`sug-${i}`} className="text-[9px] text-blue-600">💡 {sug}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 품질 체크리스트 (사전 검증) */}
                {clip.qualityChecklist && (
                  <div className="px-3 pb-2">
                    <div className="bg-gray-50 rounded p-2 space-y-0.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-medium" style={{ color: "#555" }}>
                          프롬프트 품질 체크
                          {(clip.qualityChecklist as { sceneTypeLabel?: string }).sceneTypeLabel && (
                            <span className="ml-1 text-[9px] font-normal" style={{ color: "#888" }}>
                              ({(clip.qualityChecklist as { sceneTypeLabel?: string }).sceneTypeLabel})
                            </span>
                          )}
                        </span>
                        <span
                          className="text-[10px] font-mono font-bold"
                          style={{
                            color: clip.qualityChecklist.passCount === clip.qualityChecklist.totalCount
                              ? "#16a34a"
                              : clip.qualityChecklist.passCount >= clip.qualityChecklist.totalCount - 1
                              ? "#d97706"
                              : "#dc2626",
                          }}
                        >
                          {clip.qualityChecklist.passCount}/{clip.qualityChecklist.totalCount}
                        </span>
                      </div>
                      {clip.qualityChecklist.items.map((item) => (
                        <div key={item.id} className="flex items-start gap-1">
                          <span className="text-[10px] flex-shrink-0 mt-px">
                            {item.passed ? "✅" : "❌"}
                          </span>
                          <div className="min-w-0">
                            <span
                              className="text-[9px]"
                              style={{ color: item.passed ? "#16a34a" : "#dc2626" }}
                            >
                              {item.label}
                            </span>
                            {!item.passed && item.detail && (
                              <p className="text-[8px] text-muted-foreground mt-0.5">
                                {item.detail}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Structured Sequence (source of truth) + Provider Payload Preview */}
                {(clip.structuredSequence || clip.finalPrompt || clip.fallbackRenderedPrompt) && (
                  <div className="px-3 pb-2">
                    <details className="group">
                      <summary className="text-[10px] font-medium cursor-pointer select-none" style={{ color: "#555" }}>
                        시퀀스 디버그
                        {clip.structuredSequence && <Badge className="ml-1 text-[8px]" style={{ background: "#16a34a20", color: "#16a34a" }}>JSON-first</Badge>}
                        {clip.assembledDebug?.isMapScene && (
                          <Badge className="ml-1 text-[8px]" style={{ background: "#0891b220", color: "#0891b2" }}>MAP</Badge>
                        )}
                      </summary>
                      <div className="mt-1 space-y-1">
                        {/* 1급: Structured Sequence JSON */}
                        {clip.structuredSequence && (
                          <details className="ml-1" open>
                            <summary className="text-[9px] cursor-pointer font-medium" style={{ color: "#16a34a" }}>구조화된 시퀀스 (source of truth)</summary>
                            <pre className="bg-green-50 rounded p-2 text-[9px] font-mono whitespace-pre-wrap break-all leading-relaxed mt-1" style={{ color: "#333", maxHeight: 200, overflowY: "auto" }}>
                              {JSON.stringify({
                                shotId: clip.structuredSequence.shotId,
                                shotPlan: {
                                  camera: clip.structuredSequence.shotPlan?.camera,
                                  subject: clip.structuredSequence.shotPlan?.subject,
                                  action: clip.structuredSequence.shotPlan?.action,
                                  environment: clip.structuredSequence.shotPlan?.environment,
                                  moodLighting: clip.structuredSequence.shotPlan?.moodLighting,
                                },
                                validation: clip.structuredSequence.validation,
                              }, null, 2)}
                            </pre>
                          </details>
                        )}
                        {/* 2급: Provider Payload Preview (string fallback) */}
                        {(clip.fallbackRenderedPrompt || clip.finalPrompt) && (
                          <details className="ml-1">
                            <summary className="text-[9px] cursor-pointer text-muted-foreground">
                              렌더링된 프롬프트 (디버그용 — 실제 API는 structuredSequence + multiShot[] 전송)
                              <span className="text-[8px] ml-1">({(clip.fallbackRenderedPrompt || clip.finalPrompt || "").split(/\s+/).length}w)</span>
                            </summary>
                            <pre className="bg-gray-50 rounded p-2 text-[9px] font-mono whitespace-pre-wrap break-all leading-relaxed mt-1" style={{ color: "#666", maxHeight: 160, overflowY: "auto" }}>
                              {clip.fallbackRenderedPrompt || clip.finalPrompt}
                            </pre>
                          </details>
                        )}
                        {/* 3급: 블록별 분해 */}
                        {clip.assembledDebug && (
                          <details className="ml-1">
                            <summary className="text-[9px] cursor-pointer text-muted-foreground">블록별 분해</summary>
                            <div className="mt-1 space-y-0.5 text-[8px] font-mono" style={{ color: "#666" }}>
                              <div><span className="font-bold text-blue-600">[STYLE]</span> {clip.assembledDebug.styleBlock.slice(0, 200) || "(없음)"}</div>
                              <div><span className="font-bold text-green-600">[CONSISTENCY]</span> {clip.assembledDebug.consistencyBlock.slice(0, 200) || "(없음)"}</div>
                              <div><span className="font-bold text-orange-600">[CAMERA]</span> {clip.assembledDebug.cameraBlock.slice(0, 150) || "(없음)"}</div>
                              <div><span className="font-bold text-purple-600">[SCENE]</span> {clip.assembledDebug.sceneBlock.slice(0, 200) || "(없음)"}</div>
                              <div><span className="font-bold text-pink-600">[REINFORCEMENT]</span> {clip.assembledDebug.reinforcementBlock || "(없음)"}</div>
                              <div><span className="font-bold text-red-600">[NEGATIVE]</span> {clip.assembledDebug.negativeBlock || "(없음)"}</div>
                            </div>
                          </details>
                        )}
                      </div>
                    </details>
                  </div>
                )}

                {/* Seed */}
                {clip.seed && (
                  <div className="px-3 pb-2">
                    <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#c4b800", color: "#7a7000" }}>
                      Seed: {clip.seed}
                    </Badge>
                  </div>
                )}

                {/* 완료된 영상 미리보기 + 다운로드 */}
                {clip.status === "completed" && clip.videoUri && (
                  <div className="px-3 pb-3 space-y-1.5">
                    <video
                      src={clip.videoUri}
                      controls
                      className="w-full rounded-lg"
                      style={{ maxHeight: "200px" }}
                    />
                    <div className="flex gap-1.5">
                      <a
                        href={clip.videoUri}
                        download={`scene-${cut.cutNumber}.mp4`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] px-2.5 py-1 rounded-md inline-flex items-center gap-1"
                        style={{ background: "#22c55e15", color: "#16a34a", border: "1px solid #22c55e30" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        MP4 다운로드
                      </a>
                      {onAddCut && (
                        <button
                          onClick={() => onAddCut(cut.cutNumber)}
                          className="text-[10px] px-2.5 py-1 rounded-md"
                          style={{ background: "#787fff15", color: "#5a5ecc", border: "1px solid #787fff30" }}
                        >
                          컷 추가 생성
                        </button>
                      )}
                      <button
                        onClick={() => onResetClip(cut.cutNumber)}
                        className="text-[10px] px-2.5 py-1 rounded-md"
                        style={{ background: "#ef444410", color: "#dc2626", border: "1px solid #ef444420" }}
                      >
                        초기화
                      </button>
                    </div>
                  </div>
                )}

                {/* 컷 선택 (여러 take) */}
                {clip.status === "completed" && clip.variants && clip.variants.length > 1 && (
                  <div className="px-3 pb-3 space-y-1.5">
                    <p className="text-[10px] font-medium" style={{ color: "#787fff" }}>
                      {clip.variants.length}개 컷 — 베스트 컷을 선택하세요
                    </p>
                    <div className="flex gap-2 overflow-x-auto">
                      {clip.variants.map((variant, vi) => (
                        <div
                          key={vi}
                          className="flex-shrink-0 cursor-pointer rounded-lg overflow-hidden transition-all"
                          style={{
                            width: "100px",
                            border: clip.selectedVariant === vi
                              ? "2px solid #787fff"
                              : "2px solid transparent",
                          }}
                          onClick={() => onSelectVariant(cut.cutNumber, vi)}
                        >
                          <video
                            src={variant.videoUri}
                            className="w-full"
                            style={{ height: "80px", objectFit: "cover" }}
                            muted
                            onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                            onMouseLeave={(e) => {
                              const v = e.target as HTMLVideoElement;
                              v.pause();
                              v.currentTime = 0;
                            }}
                          />
                          <div className="p-1 text-center">
                            <span className="text-[9px]" style={{ color: clip.selectedVariant === vi ? "#787fff" : "#999" }}>
                              컷 {vi + 1}
                            </span>
                            {variant.seed && (
                              <p className="text-[8px] text-muted-foreground">S: {variant.seed}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Extend 연결선 */}
                {i < cuts.length - 1 && clip.status === "completed" && (
                  <div className="flex items-center gap-1 px-6 pb-1">
                    <div className="h-px flex-1" style={{ background: "#22c55e40" }} />
                    <span className="text-[9px] text-muted-foreground">Scene Extension →</span>
                    <div className="h-px flex-1" style={{ background: "#22c55e40" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── 몽타주 Export 섹션 ── */}
        {totalCount > 0 && (
          <div
            className="rounded-lg p-4 space-y-3"
            style={{ background: "#f8f9fa", border: "1px solid #e5e5e5" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: "#333" }}>
                몽타주 내보내기
              </span>
              <div className="flex items-center gap-1.5">
                {/* stitch 엔진 상태 배지 */}
                <Badge
                  variant="outline"
                  className="text-[9px]"
                  style={{
                    borderColor: stitchCapability === "client_wasm" ? "#22c55e" : "#aaa",
                    color: stitchCapability === "client_wasm" ? "#16a34a" : "#888",
                  }}
                >
                  {stitchCapability === "client_wasm"
                    ? "FFmpeg.wasm 사용 가능"
                    : stitchCapability === "server_ffmpeg"
                    ? "서버 FFmpeg"
                    : "합치기 불가"}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  style={{
                    borderColor: montageState.allClipsReady ? "#22c55e" : "#d97706",
                    color: montageState.allClipsReady ? "#16a34a" : "#d97706",
                  }}
                >
                  {montageState.completedCount}/{montageState.totalCount} clip 완료
                </Badge>
              </div>
            </div>

            {/* 진행 바 */}
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#e5e5e5" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${montageState.totalCount > 0 ? (montageState.completedCount / montageState.totalCount) * 100 : 0}%`,
                  background: montageState.allClipsReady ? "#22c55e" : "#d97706",
                }}
              />
            </div>

            {/* 누락 컷 경고 */}
            {montageState.missingCutNumbers.length > 0 && (
              <p className="text-[11px]" style={{ color: "#d97706" }}>
                미완료 장면: {montageState.missingCutNumbers.map((n) => `#${n}`).join(", ")}
              </p>
            )}

            {/* 총 예상 길이 */}
            {montageState.totalDurationSec > 0 && (
              <p className="text-[11px] text-muted-foreground">
                총 예상 길이: {montageState.totalDurationSec}초
                {montageState.totalDurationSec >= 60 && (
                  <> ({Math.floor(montageState.totalDurationSec / 60)}분 {montageState.totalDurationSec % 60}초)</>
                )}
              </p>
            )}

            {/* ── 최종 편집본 영역 ── */}
            {stitchCapability === "not_available" ? (
              /* stitch 불가 — 명시 안내 */
              <div
                className="rounded-md p-2.5 text-[11px]"
                style={{ background: "#fef3c7", border: "1px solid #fcd34d", color: "#92400e" }}
              >
                <span className="font-medium">최종 편집본 없음</span> —{" "}
                {enrichedState.stitchUnavailableReason}
              </div>
            ) : (
              /* stitch 가능 (client_wasm) — stitch 버튼 + 상태 */
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="text-white text-xs"
                    disabled={!stitchReadiness.canStitch || isStitching}
                    onClick={handleStitch}
                    style={{
                      background: stitchReadiness.canStitch && !isStitching
                        ? "linear-gradient(135deg, #22c55e, #16a34a)"
                        : "#ccc",
                    }}
                  >
                    {isStitching
                      ? "합치는 중..."
                      : `최종 몽타주 MP4 생성 (${montageState.completedCount}개 clip)`}
                  </Button>
                  {/* stitch 불가 사유 (clip 미완료 등) */}
                  {!stitchReadiness.canStitch && stitchReadiness.reason && (
                    <span className="text-[10px]" style={{ color: "#d97706" }}>
                      {stitchReadiness.reason}
                    </span>
                  )}
                </div>

                {/* stitch 진행 상태 */}
                {stitchProgress && isStitching && (
                  <div className="space-y-1">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#e5e5e5" }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${stitchProgress.percent}%`,
                          background: "linear-gradient(90deg, #22c55e, #16a34a)",
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {stitchProgress.message}
                    </p>
                  </div>
                )}

                {/* stitch 결과 */}
                {stitchResult && stitchResult.phase === "done" && (
                  <div
                    className="rounded-md p-2.5 text-[11px]"
                    style={{ background: "#dcfce7", border: "1px solid #86efac", color: "#166534" }}
                  >
                    <span className="font-medium">최종 몽타주 생성 완료</span> — {stitchResult.progress.message}
                    {stitchResult.outputUrl && (
                      <a
                        href={stitchResult.outputUrl}
                        download={`${projectTitle || "montage"}_montage.mp4`}
                        className="ml-2 underline"
                        style={{ color: "#15803d" }}
                      >
                        다시 다운로드
                      </a>
                    )}
                  </div>
                )}
                {stitchResult && stitchResult.phase === "error" && (
                  <div
                    className="rounded-md p-2.5 text-[11px]"
                    style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b" }}
                  >
                    <span className="font-medium">합치기 실패</span> — {stitchResult.errorMessage}
                  </div>
                )}
              </div>
            )}

            {/* 개별 clip 다운로드 (항상 노출 — stitch 가능 여부와 무관) */}
            <div className="flex items-center gap-2 pt-1" style={{ borderTop: "1px solid #e5e5e5" }}>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                disabled={montageState.completedCount === 0 || isDownloading}
                onClick={handleDownloadAll}
              >
                {isDownloading ? "다운로드 중..." : `개별 clip 다운로드 (${montageState.completedCount}개)`}
              </Button>
              {downloadResult && (
                <span className="text-[11px] text-muted-foreground">
                  {downloadResult.downloaded}개 완료
                  {downloadResult.failed > 0 && <>, {downloadResult.failed}개 실패</>}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
