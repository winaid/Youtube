"use client";

import { useState, useEffect, useCallback } from "react";
import { useMemo } from "react";
import { Cut, CharacterSeed, VideoClip, SHOT_ROLE_META, type MultiShotPrompt } from "@/types";
import { inferShotRole } from "@/lib/multishot-validation";
import { generateSummariesFromNormalizedMultiPrompt } from "@/lib/shot-summary-ko";

import { runPreflightValidation, getCutDisplayTitle, getCutSubInfo, type PreflightResult } from "@/lib/preflight-validation";
import { getVideoFilterStyle } from "@/lib/style-postprocess";
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
  /** Canonical multiShot per cut (cutNumber → multiShot[]) — source of truth */
  canonicalMultiShots?: Map<number, MultiShotPrompt[]>;
  /** Canonical durationSec per cut (cutNumber → durationSec) */
  canonicalDurations?: Map<number, number>;
  /** 선택된 영상 스타일 ID */
  styleId?: string;
  /** 사용 중인 VEO 모델 ID */
  modelId?: string;
  /** stitch 완료 시 부모에 알림 — 업로드 준비 상태 반영용 */
  onStitchComplete?: (result: { outputUrl: string; sizeBytes: number } | null) => void;
}

function ElapsedTime({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return null;
  const elapsed = Math.floor((now - startedAt) / 1000);
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
  recoverableJobs: _recoverableJobs,
  onResumeJob: _onResumeJob,
  canonicalMultiShots,
  canonicalDurations,
  styleId,
  modelId: propModelId,
  onStitchComplete,
}: VideoGenerationPanelProps) {
  // ── Preflight validation ──
  const preflight: PreflightResult | null = useMemo(() => {
    if (!propModelId || !styleId || cuts.length === 0) return null;
    return runPreflightValidation({
      cuts,
      canonicalMultiShots: canonicalMultiShots ?? new Map(),
      canonicalDurations: canonicalDurations ?? new Map(),
      styleId,
      modelId: propModelId,
    });
  }, [cuts, canonicalMultiShots, canonicalDurations, styleId, propModelId]);

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadResult, setDownloadResult] = useState<{ downloaded: number; failed: number } | null>(null);
  const [stitchCapability, setStitchCapability] = useState<StitchCapability>("not_available");
  const [stitchUnavailableReason, setStitchUnavailableReason] = useState("");
  const [stitchProgress, setStitchProgress] = useState<StitchProgress | null>(null);
  const [stitchResult, setStitchResult] = useState<StitchJob | null>(null);
  const [isStitching, setIsStitching] = useState(false);

  const montageState = computeMontageExportState(cuts, clips);
  // 동적으로 감지된 capability를 덮어쓰기
  const enrichedState = useMemo(() => ({
    ...montageState,
    stitchCapability,
    stitchUnavailableReason: stitchUnavailableReason || montageState.stitchUnavailableReason,
  }), [montageState, stitchCapability, stitchUnavailableReason]);
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
      // 부모에 stitch 결과 전달 — 업로드 준비 상태 반영
      if (job.phase === "done" && job.outputUrl) {
        onStitchComplete?.({ outputUrl: job.outputUrl, sizeBytes: job.outputSizeBytes ?? 0 });
      } else {
        onStitchComplete?.(null);
      }
    } finally {
      setIsStitching(false);
    }
  }, [stitchReadiness.canStitch, isStitching, enrichedState, projectTitle, onStitchComplete]);

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#22c55e40" }}>
      <CardHeader className="pb-3" style={{ background: "linear-gradient(135deg, #22c55e15, #787fff10)" }}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base" style={{ color: "#16a34a" }}>
            영상 생성
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
        {/* Preflight Validation Summary */}
        {preflight && preflight.issues.length > 0 && (
          <div className="rounded-lg p-3 space-y-1.5" style={{
            background: preflight.blockingCount > 0 ? "#FEF2F2" : preflight.warningCount > 0 ? "#FFFBEB" : "#F0FDF4",
            border: `1px solid ${preflight.blockingCount > 0 ? "#FECACA" : preflight.warningCount > 0 ? "#FDE68A" : "#BBF7D0"}`,
          }}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold" style={{
                color: preflight.blockingCount > 0 ? "#991B1B" : preflight.warningCount > 0 ? "#92400E" : "#166534",
              }}>
                {preflight.blockingCount > 0
                  ? `⛔ 생성할 수 없습니다 — ${preflight.blockingCount}건의 문제를 해결해 주세요`
                  : preflight.warningCount > 0
                    ? `참고 사항 ${preflight.warningCount}건`
                    : "준비 완료"}
              </span>
            </div>
            {preflight.issues.map((issue, i) => (
              <p key={i} className="text-[10px] leading-relaxed" style={{
                color: issue.severity === "blocking" ? "#DC2626" : issue.severity === "warning" ? "#D97706" : "#6B7280",
              }}>
                {issue.severity === "blocking" ? "⛔ " : issue.severity === "warning" ? "⚠️ " : "ℹ️ "}
                {issue.messageKo}
              </p>
            ))}
          </div>
        )}

        {/* 예상 품질 점수 — 로컬 휴리스틱 기반 빠른 피드백 */}
        {cuts.length > 0 && (() => {
          // 빠른 품질 점수 계산 (API 호출 없음)
          let score = 50; // 기본 점수
          const tips: string[] = [];

          // 컷 수 적절성
          const _totalDur = cuts.reduce((s, c) => s + (canonicalDurations?.get(c.cutNumber) ?? c.durationSec), 0);
          if (cuts.length >= 3 && cuts.length <= 8) score += 10;
          else if (cuts.length < 3) { score -= 10; tips.push("컷 수가 적습니다 — 최소 3컷 이상 권장"); }

          // 장면 설명 품질
          const avgDescLen = cuts.reduce((s, c) => s + (c.sceneDescription?.length || 0), 0) / cuts.length;
          if (avgDescLen > 30) score += 10;
          else tips.push("장면 설명이 짧습니다 — 구체적으로 작성하면 품질이 올라갑니다");

          // videoPrompt 존재
          const hasPrompt = cuts.every(c => c.videoPrompt && c.videoPrompt.length > 20);
          if (hasPrompt) score += 10;

          // 멀티샷 여부
          const hasMultiShot = cuts.every(c => {
            const ms = canonicalMultiShots?.get(c.cutNumber) ?? c.multiShot ?? [];
            return ms.length >= 2;
          });
          if (hasMultiShot) score += 10;
          else tips.push("멀티샷이 설정되지 않은 컷이 있습니다");

          // 캐릭터 일관성
          const hasCharRef = cuts.some(c => c.characterConsistency && c.characterConsistency.length > 10);
          if (hasCharRef) score += 5;

          // 첫 컷 훅 강도 (짧고 강렬한 첫 장면)
          const firstCut = cuts[0];
          if (firstCut?.sceneDescription && /[!?]|훅|hook|반전|충격|의문/i.test(firstCut.sceneDescription)) score += 5;

          score = Math.min(100, Math.max(0, score));
          const color = score >= 70 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";
          const label = score >= 70 ? "좋음" : score >= 50 ? "보통" : "개선 필요";

          return (
            <div className="rounded-lg p-2.5 flex items-center gap-3" style={{ background: `${color}08`, border: `1px solid ${color}30` }}>
              <div className="text-center" style={{ minWidth: 48 }}>
                <div className="text-lg font-bold" style={{ color }}>{score}</div>
                <div className="text-[9px]" style={{ color }}>{label}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-medium text-zinc-600">예상 품질</div>
                {tips.length > 0 ? (
                  <div className="text-[9px] text-zinc-500 mt-0.5">
                    {tips.slice(0, 2).map((t, i) => <div key={i}>💡 {t}</div>)}
                  </div>
                ) : (
                  <div className="text-[9px] mt-0.5" style={{ color }}>모든 항목이 잘 설정되어 있습니다</div>
                )}
              </div>
            </div>
          );
        })()}

        {/* 전체 생성 / 중단 */}
        <div className="space-y-2">
          {!isAutoMode ? (
            completedCount === totalCount && totalCount > 0 ? (
              <div className="rounded-lg p-3 text-center" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                <p className="text-sm font-semibold" style={{ color: "#16a34a" }}>
                  {totalCount}개 영상 모두 완성!
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: "#22c55e" }}>
                  아래에서 각 영상을 확인하고 내보낼 수 있습니다.
                </p>
              </div>
            ) : (
              <Button
                onClick={onStartAuto}
                className="w-full text-white font-semibold text-sm"
                disabled={completedCount === totalCount || (preflight != null && !preflight.canGenerate)}
                style={{
                  background: (preflight != null && !preflight.canGenerate) ? "#d1d5db" : "linear-gradient(135deg, #22c55e, #16a34a)",
                  boxShadow: (preflight == null || preflight.canGenerate) ? "0 4px 16px #22c55e40" : "none",
                  height: "44px",
                }}
              >
                전체 자동 생성 ({totalCount}컷)
              </Button>
            )
          ) : (
            <div className="flex items-center gap-3">
              <Button variant="destructive" onClick={onStopAuto} className="flex-shrink-0">
                중단
              </Button>
              <div className="flex items-center gap-1.5 text-sm" style={{ color: "#16a34a" }}>
                <span className="h-2.5 w-2.5 rounded-full animate-pulse bg-green-500" />
                <span className="font-medium">영상을 만들고 있습니다 {completedCount}/{totalCount}</span>
              </div>
            </div>
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
                      <span className="text-sm font-medium truncate max-w-[180px]" title={getCutDisplayTitle(cut, canonicalMultiShots, 60)}>
                        {getCutDisplayTitle(cut, canonicalMultiShots)}
                      </span>

                      {/* 엔진 배지 — 완료 후 실제 사용 엔진 표시, 완료 전엔 회색 */}
                      {clip.engineUsed ? (
                        <Badge
                          className="text-[10px] text-white"
                          style={{ background: clip.engineUsed === "veo" ? "#4285f4" : "#787fff" }}
                        >
                          {clip.engineUsed === "veo" ? "VEO" : clip.engineUsed || "VEO"}
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] text-white" style={{ background: "#aaa" }}>
                          {clip.status === "idle" ? "대기 중" : "생성 중"}
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
                      {getCutSubInfo(cut, canonicalMultiShots, canonicalDurations)}
                    </p>
                    {/* 멀티샷 서브샷 목록 + 한국어 요약 — normalized payload 기반 */}
                    {(() => {
                      const effectiveShots = canonicalMultiShots?.get(cut.cutNumber) ?? cut.multiShot ?? [];
                      if (effectiveShots.length === 0) return null;
                      // Build normalized entries for summary display
                      const effectiveDuration = canonicalDurations?.get(cut.cutNumber) ?? cut.durationSec ?? 8;
                      const normalizedEntries = effectiveShots.map((s, idx) => ({
                        index: s.index ?? idx + 1,
                        prompt: s.prompt || "",
                        duration: String(parseFloat(s.duration) || Math.round(effectiveDuration / effectiveShots.length)),
                      }));
                      const summaries = generateSummariesFromNormalizedMultiPrompt(normalizedEntries);
                      return (
                      <div className="mt-1.5 space-y-0.5">
                        {normalizedEntries.map((s, idx) => {
                          // Use original shot role for badge coloring (role is display-only metadata)
                          const origShot = effectiveShots[idx];
                          const role = origShot?.role ?? inferShotRole(s.index - 1, normalizedEntries.length);
                          const meta = SHOT_ROLE_META[role];
                          const summary = summaries[idx]?.summaryKo || "";
                          return (
                            <div key={s.index} className="flex items-center gap-1.5">
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 flex-shrink-0" style={{ background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}25` }}>
                                <span className="font-semibold">{s.index}샷</span>
                                <span>({s.duration}초)</span>
                              </span>
                              <span className="text-[10px] text-muted-foreground truncate">{summary}</span>
                            </div>
                          );
                        })}
                      </div>
                      );
                    })()}
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
                      {/* Priority C+D: 연속성 품질 배지 */}
                      {clip.continuityQuality && (
                        <Badge
                          className="text-[10px] text-white"
                          style={{
                            background: clip.continuityQuality.score >= 100
                              ? "#22c55e"
                              : clip.continuityQuality.score >= 60
                              ? "#e09900"
                              : "#ef4444",
                          }}
                        >
                          연속성 {clip.continuityQuality.score === 100 ? "완전" : clip.continuityQuality.score >= 60 ? "부분" : "손실"}
                        </Badge>
                      )}
                      {clip.continuityQuality?.degradation === "sourceVideo_missing" && (
                        <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#ef4444", color: "#dc2626" }}>
                          소스영상 없음
                        </Badge>
                      )}
                      {clip.continuityQuality?.degradation === "autoLink_off" && (
                        <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#d97706", color: "#b45309" }}>
                          프레임 연결 OFF
                        </Badge>
                      )}
                      {/* 스토리보드 기반 image-to-video 표시 */}
                      {clip.continuityQuality?.frameSource?.startsWith("storyboard") && (
                        <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#8b5cf6", color: "#7c3aed" }}>
                          스토리보드 기반
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
                              <span className="text-[9px] w-[60px] sm:w-[85px] shrink-0">{labelMap[key] || key}</span>
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
                              <span className="text-[9px] w-[60px] sm:w-[85px] shrink-0">{label}</span>
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

                {/* ── 전송된 프롬프트 요약 (한국어) ── */}
                {clip.sentPromptKoSummary && (
                  <div className="px-3 pb-2">
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                      <span className="text-[10px] font-semibold block mb-0.5" style={{ color: "#059669" }}>전송된 프롬프트 요약</span>
                      <span className="text-[12px] text-gray-800 leading-relaxed">{clip.sentPromptKoSummary}</span>
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
                        {/* 1급: Structured Sequence JSON — 전체 컷 기준 */}
                        {clip.structuredSequence && (
                          <details className="ml-1" open>
                            <summary className="text-[9px] cursor-pointer font-medium" style={{ color: "#16a34a" }}>
                              전체 컷 구조 (source of truth) — {clip.structuredSequence.durationSec}초
                              {clip.structuredSequence.shots && Array.isArray(clip.structuredSequence.shots) && clip.structuredSequence.shots.length > 1
                                ? ` / ${clip.structuredSequence.shots.length}샷`
                                : " / 1샷"
                              }
                            </summary>
                            <pre className="bg-green-50 rounded p-2 text-[9px] font-mono whitespace-pre-wrap break-all leading-relaxed mt-1" style={{ color: "#333", maxHeight: 200, overflowY: "auto" }}>
                              {JSON.stringify({
                                durationSec: clip.structuredSequence.durationSec,
                                shotId: clip.structuredSequence.shotId,
                                shotPlan: {
                                  camera: clip.structuredSequence.shotPlan?.camera,
                                  subject: clip.structuredSequence.shotPlan?.subject,
                                  action: clip.structuredSequence.shotPlan?.action,
                                  environment: clip.structuredSequence.shotPlan?.environment,
                                  moodLighting: clip.structuredSequence.shotPlan?.moodLighting,
                                },
                                temporalBeats: clip.structuredSequence.temporalBeats,
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
                        {/* 4급: VEO multi_prompt JSON preview */}
                        {(() => {
                          const dbgShots = canonicalMultiShots?.get(cut.cutNumber) ?? cut.multiShot ?? [];
                          if (dbgShots.length === 0) return null;
                          const dbgDuration = canonicalDurations?.get(cut.cutNumber) ?? cut.durationSec ?? 8;
                          const previewObj = {
                            prompt: cut.videoPrompt || cut.sceneDescription || "",
                            durationSec: dbgDuration,
                            shots: dbgShots.map(s => ({
                              index: s.index,
                              duration: s.duration,
                              prompt: (s.prompt || "").slice(0, 120) + ((s.prompt || "").length > 120 ? "..." : ""),
                              role: s.role,
                            })),
                          };
                          return (
                            <details className="ml-1">
                              <summary className="text-[9px] cursor-pointer text-muted-foreground">
                                VEO JSON 미리보기
                              </summary>
                              <pre className="bg-gray-50 rounded p-2 text-[8px] font-mono whitespace-pre-wrap break-all leading-relaxed mt-1" style={{ color: "#555", maxHeight: 200, overflowY: "auto" }}>
                                {JSON.stringify(previewObj, null, 2)}
                              </pre>
                            </details>
                          );
                        })()}
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
                      style={{ maxHeight: "200px", ...getVideoFilterStyle(styleId || "") }}
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
                          변형 생성
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
                            style={{ height: "80px", objectFit: "cover", ...getVideoFilterStyle(styleId || "") }}
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
              /* stitch 불가 — 명시 안내 + 개별 다운로드 유도 */
              <div
                className="rounded-md p-2.5 text-[11px] space-y-1"
                style={{ background: "#fef3c7", border: "1px solid #fcd34d", color: "#92400e" }}
              >
                <p><span className="font-medium">자동 합치기 미지원</span> — {enrichedState.stitchUnavailableReason}</p>
                <p style={{ color: "#78716c" }}>아래 &ldquo;개별 clip 다운로드&rdquo; 버튼으로 영상을 받은 후 CapCut/Premiere 등에서 합치세요.</p>
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
                      : `최종 몽타주 MP4 생성 — 영상만 (${montageState.completedCount}개 clip)`}
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
                    <p className="mt-1 text-[10px]" style={{ color: "#6b7280" }}>
                      영상 전용 MP4 — 나레이션/BGM/SFX는 별도 에셋으로 편집 소프트웨어에서 합성하세요.
                    </p>
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
