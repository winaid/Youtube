"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { PromptOutput, Cut, GeneratorStatus, CharacterFaceRef, KlingElementAsset, DEFAULT_VIDEO_CONFIG, type YouTubeSEO } from "@/types";
import { resolveModelForWorkflow } from "@/lib/kling-capability";
import { DURATION_FALLBACK, buildDurationSummary } from "@/lib/duration-reconciliation";
import { checkBatchBudget, BATCH_BUDGET_SECONDS } from "@/lib/batch-runtime-budget";
import type { BatchClipInfo } from "@/lib/batch-runtime-budget";
import { classifyCuts } from "@/lib/structure-classification";
import { densifyCuts } from "@/lib/sequence-density";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import CutCard from "./CutCard";
import VideoGenerationPanel from "./VideoGenerationPanel";
import VideoSettingsPanel from "./VideoSettingsPanel";
import TimelineEditor from "./TimelineEditor";
import SequenceTimelineEditor from "./SequenceTimelineEditor";
import CharacterFaceManager from "./CharacterFaceManager";
import OneClickPipeline from "./OneClickPipeline";
import VideoHistoryPanel, { saveToHistory } from "./VideoHistoryPanel";
import VideoReviewPanel from "./VideoReviewPanel";
import { useVideoGeneration } from "@/hooks/useVideoGeneration";
import { cutToViewModel, viewModelToExportSequence, type CutCardViewModel } from "@/lib/canonical-view-model";

interface ResultPanelProps {
  result: PromptOutput | null;
  status: GeneratorStatus;
  error: string | null;
  onUpdateResult?: (updated: PromptOutput) => void;
  storyText?: string;
  directorName?: string;
  region?: string;
  animationMode?: string;
  /** 부모가 소유하는 시퀀스당 초 */
  secondsPerScene?: number;
  /** VideoSettingsPanel에서 duration 변경 시 부모에 통지 */
  onSecondsPerSceneChange?: (v: number) => void;
}

// ─── 단계별 생성 진행 표시 ───
const GENERATION_PHASES = [
  { label: "스토리 구조 해석 중", minMs: 0 },
  { label: "컷 아웃라인 생성 중", minMs: 2000 },
  { label: "컷 리듬 정리 중", minMs: 6000 },
  { label: "샷 디테일 보강 중", minMs: 12000 },
  { label: "최종 검증 중", minMs: 20000 },
];

function GenerationProgressCard() {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // 현재 단계 결정 (경과 시간 기반)
  let currentPhase = GENERATION_PHASES[0];
  for (const phase of GENERATION_PHASES) {
    if (elapsedMs >= phase.minMs) currentPhase = phase;
  }

  const elapsedSec = Math.floor(elapsedMs / 1000);

  return (
    <Card className="h-full flex items-center justify-center">
      <CardContent className="text-center py-16 space-y-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent mx-auto" style={{ borderColor: "#787fff", borderTopColor: "transparent" }} />
        <div className="space-y-1.5">
          <p className="text-sm font-medium" style={{ color: "#787fff" }}>
            {currentPhase.label}
          </p>
          <p className="text-xs text-muted-foreground">
            {elapsedSec}초 경과
          </p>
          {/* 단계 인디케이터 */}
          <div className="flex items-center justify-center gap-1 pt-1">
            {GENERATION_PHASES.map((phase, i) => (
              <div
                key={i}
                className="h-1 rounded-full transition-all duration-500"
                style={{
                  width: elapsedMs >= phase.minMs ? 20 : 8,
                  background: elapsedMs >= phase.minMs ? "#787fff" : "#e5e7eb",
                }}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ResultPanel({
  result,
  status,
  error,
  onUpdateResult,
  storyText,
  directorName: _directorName,
  region,
  animationMode,
  secondsPerScene,
  onSecondsPerSceneChange,
}: ResultPanelProps) {
  const [jsonCopied, setJsonCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [activeSection, setActiveSection] = useState<"prompts" | "generate" | "sequence" | "timeline">("prompts");
  const [ttsVoice] = useState("ko-KR-Wavenet-A");
  const [ttsRate] = useState(1.0);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragItemRef = useRef<number | null>(null);
  // 스토리보드 이미지 (시작 프레임)
  const [storyboardImages, setStoryboardImages] = useState<Record<number, string>>({});
  const [storyboardCandidates, setStoryboardCandidates] = useState<Record<number, string[]>>({});
  const [storyboardLoading, setStoryboardLoading] = useState<Record<number, boolean>>({});
  // 스토리보드 끝 프레임
  const [storyboardEndImages, setStoryboardEndImages] = useState<Record<number, string>>({});
  const [storyboardEndLoading, setStoryboardEndLoading] = useState<Record<number, boolean>>({});
  // 장면별 TTS
  const [sceneTtsUrls, setSceneTtsUrls] = useState<Record<number, string>>({});
  const [sceneTtsLoading, setSceneTtsLoading] = useState<Record<number, boolean>>({});
  // SRT
  const [srtContent, setSrtContent] = useState<string | null>(null);
  const [srtLoading, setSrtLoading] = useState(false);
  const [srtError, setSrtError] = useState<string | null>(null);
  // SEO
  const [seoResult, setSeoResult] = useState<YouTubeSEO | null>(null);
  const [seoLoading, setSeoLoading] = useState(false);
  const [seoError, setSeoError] = useState<string | null>(null);
  // Thumbnail
  const [thumbnailImages, setThumbnailImages] = useState<{ base64: string; mimeType: string }[]>([]);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
  // Final export (stitch)
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [finalVideoSizeBytes, setFinalVideoSizeBytes] = useState<number>(0);
  // 캐릭터 얼굴 레퍼런스
  const [faceRefs, setFaceRefs] = useState<CharacterFaceRef[]>([]);
  // Kling Custom Element assets
  const [elementAssets, setElementAssets] = useState<KlingElementAsset[]>([]);
  // 인라인 감독 변경 재생성
  const [altDirector, setAltDirector] = useState("");
  const [altGenerating, setAltGenerating] = useState(false);

  const videoGen = useVideoGeneration({
    cuts: result?.cuts ?? [],
    storyboardImages,
    storyboardEndImages,
    faceRefs,
    elementAssets,
    onSeedDetected: (cutNumber, seed) => {
      console.log(`CUT ${cutNumber} seed: ${seed}`);
    },
  });

  // animationMode를 videoGen config에 동기화
  // videoGen은 매 렌더마다 새 객체 → deps에서 제외하여 무한 루프 방지
  useEffect(() => {
    if (animationMode && videoGen.config.animationMode !== animationMode) {
      videoGen.updateConfig({ animationMode });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationMode]);

  // 프롬프트 생성 시 cutDuration → videoGen config에만 동기화
  // 주의: 부모(InputPanel) 슬라이더는 역동기화하지 않는다.
  // 이유: auto(0) 상태에서 결과의 durationSec을 슬라이더에 쓰면
  //       다음 생성에서 auto가 아닌 명시값으로 submit되어
  //       "사용자는 auto인데 실제는 수동" 불일치가 발생한다.
  useEffect(() => {
    if (!result || result.cuts.length === 0) return;
    const dur = result.cuts[0].durationSec;
    if (dur && dur > 0 && videoGen.config.durationSeconds !== dur) {
      const clampedDur = Math.min(15, Math.max(3, dur));
      const engine = clampedDur >= 10 ? "kling" : videoGen.config.engine;
      videoGen.updateConfig({ durationSeconds: clampedDur, engine });
      // ⚠ 부모 슬라이더 역동기화 제거 — auto 상태 보존
      // onSecondsPerSceneChange?.(clampedDur);  // REMOVED: breaks auto mode
    }
  // result가 새로 생성될 때만 실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);


  // 영상 완료될 때마다 히스토리에 점진적 저장 (컷 1개라도 완료되면 저장)
  const lastSavedCountRef = useRef(0);
  useEffect(() => {
    if (!result || videoGen.completedCount === 0) return;
    // 새로 완료된 컷이 있을 때만 저장
    if (videoGen.completedCount <= lastSavedCountRef.current) return;
    lastSavedCountRef.current = videoGen.completedCount;

    const completedCuts = result.cuts
      .map((cut) => {
        const clip = videoGen.clips.find((c) => c.cutNumber === cut.cutNumber);
        if (!clip?.videoUri || clip.status !== "completed") return null;
        const narrationState = videoGen.shotNarrationStates.get(cut.cutNumber);
        const seq = clip.structuredSequence;
        return {
          cutNumber: cut.cutNumber,
          sceneDescription: cut.sceneDescription,
          videoUri: clip.videoUri,
          seed: clip.seed,
          durationSec: cut.durationSec,
          narration: {
            narrationMode: seq?.narrationMode || narrationState?.mode,
            narrationText: seq?.narrationText || narrationState?.currentText,
            narrationAudioUri: clip.narrationAudioUri,
            narrationSyncStatus: narrationState?.lastGeneratedSyncStatus,
            narrationGeneratedAt: narrationState?.lastGeneratedAt,
          },
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    if (completedCuts.length > 0) {
      saveToHistory({
        storyTitle: result.cuts[0]?.sceneDescription?.slice(0, 50) || "영상",
        cuts: completedCuts,
      });
    }
  }, [result, videoGen.completedCount, videoGen.clips, videoGen.shotNarrationStates]);

  // ── Canonical View-Model derivation (must be before callbacks that use it) ──
  // All UI reads should go through these view-models, not raw Cut fields.
  const canonicalViewModels = useMemo<Map<number, CutCardViewModel>>(() => {
    if (!result) return new Map();
    const config = videoGen.config ?? DEFAULT_VIDEO_CONFIG;
    const map = new Map<number, CutCardViewModel>();
    for (let i = 0; i < result.cuts.length; i++) {
      const cut = result.cuts[i];
      const prevCut = i > 0 ? result.cuts[i - 1] : undefined;
      try {
        map.set(cut.cutNumber, cutToViewModel(cut, config, prevCut));
      } catch {
        // Graceful degradation: if canonical conversion fails, skip
      }
    }
    return map;
  }, [result, videoGen.config]);

  // Enhancement 2: Feedback-based prompt refinement — canonical-derived inputs
  const handleFeedbackRefine = useCallback(async (cutNumber: number, feedback: string) => {
    if (!result || !onUpdateResult) return;
    const cut = result.cuts.find((c) => c.cutNumber === cutNumber);
    if (!cut) return;
    // Use canonical view-model for prompt data when available
    const vm = canonicalViewModels.get(cutNumber);
    const videoPrompt = vm?.videoPrompt ?? cut.videoPrompt;
    const extendPrompt = vm?.extendPrompt ?? cut.extendPrompt;
    try {
      const res = await fetch("/api/refine-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoPrompt,
          extendPrompt,
          feedback,
          cutNumber,
          mode: "feedback",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.refinedVideoPrompt) {
          const updated = { ...cut, videoPrompt: data.refinedVideoPrompt };
          if (data.refinedExtendPrompt) updated.extendPrompt = data.refinedExtendPrompt;
          const newCuts = result.cuts.map((c) => c.cutNumber === cutNumber ? updated : c);
          onUpdateResult({ ...result, cuts: newCuts });
        }
      }
    } catch (err) { console.error("[refine-prompt feedback]", err); }
  }, [result, onUpdateResult, canonicalViewModels]);

  // Enhancement 3: English native correction (manual trigger) — canonical-derived inputs
  const handleEnglishRefine = useCallback(async (cutNumber: number) => {
    if (!result || !onUpdateResult) return;
    const cut = result.cuts.find((c) => c.cutNumber === cutNumber);
    if (!cut) return;
    // Use canonical view-model for prompt data when available
    const vm = canonicalViewModels.get(cutNumber);
    const videoPrompt = vm?.videoPrompt ?? cut.videoPrompt;
    const extendPrompt = vm?.extendPrompt ?? cut.extendPrompt;
    try {
      const res = await fetch("/api/refine-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoPrompt,
          extendPrompt,
          cutNumber,
          mode: "english-native",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.refinedVideoPrompt) {
          const updated = { ...cut, videoPrompt: data.refinedVideoPrompt };
          if (data.refinedExtendPrompt) updated.extendPrompt = data.refinedExtendPrompt;
          const newCuts = result.cuts.map((c) => c.cutNumber === cutNumber ? updated : c);
          onUpdateResult({ ...result, cuts: newCuts });
        }
      }
    } catch (err) { console.error("[refine-prompt english]", err); }
  }, [result, onUpdateResult, canonicalViewModels]);

  // Drag & Drop 장면 재배치 — hooks must be before early returns
  const handleDragStart = useCallback((cutIndex: number) => {
    dragItemRef.current = cutIndex;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, cutIndex: number) => {
    e.preventDefault();
    setDragOverIndex(cutIndex);
  }, []);

  const handleDrop = useCallback((targetIndex: number) => {
    const fromIndex = dragItemRef.current;
    if (fromIndex === null || fromIndex === targetIndex || !onUpdateResult || !result) return;
    const newCuts = [...result.cuts];
    const [moved] = newCuts.splice(fromIndex, 1);
    newCuts.splice(targetIndex, 0, moved);
    const renumbered = newCuts.map((c, i) => ({ ...c, cutNumber: i + 1 }));
    onUpdateResult({ ...result, cuts: renumbered, totalCuts: renumbered.length });
    dragItemRef.current = null;
    setDragOverIndex(null);
  }, [result, onUpdateResult]);

  const handleDragEnd = useCallback(() => {
    dragItemRef.current = null;
    setDragOverIndex(null);
  }, []);

  // ── SEO 생성 콜백 ──
  const handleRunSeo = useCallback(async () => {
    if (!result) return;
    setSeoLoading(true);
    setSeoError(null);
    try {
      const res = await fetch("/api/generate-seo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectTitle: result.projectTitle || storyText?.slice(0, 50) || "Untitled",
          conceptSummary: result.conceptSummary || storyText || "",
          scenes: result.cuts.map((c) => ({ sceneDescription: c.sceneDescription })),
          region: region || "Global",
          animationMode: animationMode || "",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.titles) {
          setSeoResult(data as YouTubeSEO);
        } else {
          setSeoError("SEO 데이터가 비어있습니다");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setSeoError(errData.error || `SEO 생성 실패 (${res.status})`);
      }
    } catch (err) {
      console.error("[generate-seo]", err);
      setSeoError("네트워크 오류 — SEO 생성 실패");
    }
    setSeoLoading(false);
  }, [result, storyText, region, animationMode]);

  // ── 썸네일 생성 콜백 ──
  const handleRunThumbnail = useCallback(async () => {
    if (!result) return;
    setThumbnailLoading(true);
    setThumbnailError(null);
    try {
      const prompt = seoResult?.thumbnailPrompt
        || `YouTube thumbnail for: ${result.projectTitle || storyText?.slice(0, 80) || "AI video"}. Cinematic, high contrast, eye-catching.`;
      const res = await fetch("/api/generate-thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectTitle: result.projectTitle || "",
          conceptSummary: result.conceptSummary || storyText || "",
          thumbnailPrompt: prompt,
          aspectRatio: "16:9",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.images && data.images.length > 0) {
          setThumbnailImages(data.images);
        } else {
          setThumbnailError("썸네일 이미지가 생성되지 않았습니다");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setThumbnailError(errData.error || `썸네일 생성 실패 (${res.status})`);
      }
    } catch (err) {
      console.error("[generate-thumbnail]", err);
      setThumbnailError("네트워크 오류 — 썸네일 생성 실패");
    }
    setThumbnailLoading(false);
  }, [result, seoResult, storyText]);

  // ── SRT 생성 콜백 (OneClickPipeline용) ──
  const handleRunSrt = useCallback(async () => {
    if (!result) return;
    setSrtLoading(true);
    setSrtError(null);
    try {
      const res = await fetch("/api/generate-srt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: result.cuts.map((c) => ({
            cutNumber: c.cutNumber,
            sceneDescription: c.sceneDescription,
            durationSec: c.durationSec,
          })),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.srt) {
          setSrtContent(data.srt);
        } else {
          throw new Error("SRT 데이터가 비어있습니다");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `SRT 생성 실패 (${res.status})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "SRT 생성 실패";
      setSrtError(msg);
      throw err; // re-throw for OneClickPipeline to catch
    } finally {
      setSrtLoading(false);
    }
  }, [result]);

  if (status === "idle") {
    return (
      <Card className="h-full flex items-center justify-center border-2 border-dashed" style={{ borderColor: "#787fff30" }}>
        <CardContent className="text-center py-12 max-w-sm mx-auto">
          <div className="text-5xl mb-5" style={{ filter: "drop-shadow(0 4px 8px #787fff40)" }}>🎬</div>
          <h3 className="text-base font-bold mb-4" style={{ color: "#5a5ecc" }}>
            AI 영상 제작 3단계
          </h3>
          <div className="space-y-3 text-left">
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#787fff" }}>1</span>
              <div>
                <p className="text-sm font-semibold" style={{ color: "#334155" }}>스토리 입력</p>
                <p className="text-[11px] text-muted-foreground">영상으로 만들 이야기를 자유롭게 입력</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#787fff" }}>2</span>
              <div>
                <p className="text-sm font-semibold" style={{ color: "#334155" }}>감독 선택 & 장면 설계</p>
                <p className="text-[11px] text-muted-foreground">감독 페르소나가 컷과 멀티샷을 자동 구조화</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#22c55e" }}>3</span>
              <div>
                <p className="text-sm font-semibold" style={{ color: "#334155" }}>수정 & 영상 생성</p>
                <p className="text-[11px] text-muted-foreground">컷별 프롬프트를 편집하고 바로 영상 생성</p>
              </div>
            </div>
          </div>
          <p className="text-[11px] mt-5" style={{ color: "#94a3b8" }}>
            왼쪽 패널에서 <span style={{ color: "#787fff", fontWeight: 600 }}>스토리 입력</span>부터 시작하세요.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === "loading") {
    return <GenerationProgressCard />;
  }

  if (status === "error") {
    const isTokenError = error?.includes("토큰") || error?.includes("MAX_TOKENS");
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center py-16 space-y-3">
          <div className="h-10 w-10 rounded-full flex items-center justify-center mx-auto" style={{ background: "#fee2e2" }}>
            <span className="text-lg">!</span>
          </div>
          <p className="text-sm font-medium" style={{ color: "#dc2626" }}>
            {isTokenError ? "스토리가 너무 길어 처리할 수 없었습니다" : "장면 설계 중 문제가 발생했습니다"}
          </p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            {isTokenError
              ? "컷 수를 줄이거나 스토리를 축약한 뒤 다시 시도해 주세요."
              : "잠시 후 다시 시도해 주세요."}
          </p>
          {error && (
            <details className="text-[10px] text-muted-foreground mt-2">
              <summary className="cursor-pointer">상세 정보</summary>
              <p className="mt-1 text-left max-w-xs mx-auto break-all">{error}</p>
            </details>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!result) return null;

  const handleCutUpdate = (updated: Cut) => {
    if (!onUpdateResult) return;
    const newCuts = result.cuts.map((c) =>
      c.cutNumber === updated.cutNumber ? updated : c
    );
    onUpdateResult({ ...result, cuts: newCuts });
  };

  const genMode = videoGen.config.generationMode ?? "batch";
  const fastCuts = result.cuts;

  // 런타임 예산 계산 — canonical view-model preferred
  const batchClips: BatchClipInfo[] = result.cuts.map(c => {
    const vm = canonicalViewModels.get(c.cutNumber);
    return {
      id: c.cutNumber,
      durationSec: vm?.durationSec ?? c.durationSec ?? DURATION_FALLBACK,
      shotCount: vm?.multiShot?.length ?? c.multiShot?.length,
    };
  });
  const budgetResult = checkBatchBudget(batchClips);

  const exportJson = {
    project: result.projectTitle,
    generationMode: genMode,
    globalStyle: result.globalStylePrompt,
    directorPersona: result.directorPersonaPrompt,
    characterSeeds: result.characterSeeds,
    continuityRules: result.continuityRules,
    // Layer 1: 총 런타임 — canonical duration preferred
    totalRuntime: (() => {
      const t = result.cuts.reduce((s, c) => {
        const vm = canonicalViewModels.get(c.cutNumber);
        return s + (vm?.durationSec ?? c.durationSec ?? DURATION_FALLBACK);
      }, 0);
      return `${t}초 (${Math.floor(t / 60)}분${t % 60 > 0 ? ` ${t % 60}초` : ""})`;
    })(),
    sequenceCount: result.cuts.length,
    runtimeBudget: {
      totalSec: budgetResult.totalRuntimeSec,
      budgetSec: BATCH_BUDGET_SECONDS,
      withinBudget: budgetResult.withinBudget,
      usage: `${Math.round(budgetResult.usageRatio * 100)}%`,
    },
    // Layer 2: 시퀀스 — canonical view-model as source of truth
    sequences: result.cuts.map((cut) => {
      const vm = canonicalViewModels.get(cut.cutNumber);
      const clipSeq = videoGen.clips.find(c => c.cutNumber === cut.cutNumber)?.structuredSequence;
      if (vm) {
        return viewModelToExportSequence(vm, clipSeq);
      }
      // Fallback for cases where canonical conversion failed
      return {
        sequence: cut.cutNumber,
        sequenceDuration: `${cut.durationSec}s`,
        method: cut.cutNumber === 1 ? "VIDEO_PROMPT" : "EXTEND",
        scene: cut.sceneDescription,
        camera: cut.cameraDirection,
        lighting: cut.moodLighting,
        videoPrompt: cut.videoPrompt,
        extendPrompt: cut.extendPrompt,
        charactersInScene: cut.charactersInScene,
        intentionalOneTake: cut.intentionalOneTake ?? false,
        internalShots: null,
        internalShotCount: cut.multiShot?.length ?? 0,
      };
    }),
  };

  const handleCopyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(exportJson, null, 2));
    setJsonCopied(true);
    setTimeout(() => setJsonCopied(false), 1500);
  };

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(exportJson, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kling-project-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const headers = ["장면", "초", "장면설명", "카메라", "조명", "VideoPrompt", "ExtendPrompt", "캐릭터"];
    const rows = result.cuts.map((c) => [
      c.cutNumber,
      c.durationSec,
      `"${c.sceneDescription.replace(/"/g, '""')}"`,
      `"${c.cameraDirection.replace(/"/g, '""')}"`,
      `"${c.moodLighting.replace(/"/g, '""')}"`,
      `"${c.videoPrompt.replace(/"/g, '""')}"`,
      `"${c.extendPrompt.replace(/"/g, '""')}"`,
      `"${c.charactersInScene.join(", ")}"`,
    ]);
    const csv = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kling-project-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintPdf = () => {
    const printContent = `
      <html><head><title>${result.projectTitle}</title>
      <style>
        body { font-family: sans-serif; padding: 20px; font-size: 12px; }
        h1 { font-size: 18px; color: #5a5ecc; }
        h2 { font-size: 14px; color: #787fff; margin-top: 16px; }
        .cut { border: 1px solid #ddd; padding: 12px; margin: 8px 0; border-radius: 8px; page-break-inside: avoid; }
        .cut-num { font-weight: bold; color: #787fff; }
        .label { font-weight: 600; color: #666; }
        .mono { font-family: monospace; font-size: 10px; background: #f5f5f5; padding: 4px 8px; border-radius: 4px; word-break: break-all; }
        .chars { margin-top: 12px; padding: 8px; background: #fff8e1; border-radius: 6px; }
      </style></head><body>
      <h1>${result.projectTitle}</h1>
      <p>${result.conceptSummary}</p>
      <h2>캐릭터 시드</h2>
      ${result.characterSeeds.map((s) => `<div class="chars"><b>${s.label}</b> (${s.id})<br/><span class="mono">${s.appearance}</span></div>`).join("")}
      <h2>감독 페르소나</h2>
      <p style="font-style:italic">${result.directorPersonaPrompt}</p>
      <h2>장면 리스트 (${result.cuts.length}장면)</h2>
      ${result.cuts.map((c) => `
        <div class="cut">
          <div class="cut-num">장면 ${c.cutNumber} (${c.durationSec}초)</div>
          <p>${c.sceneDescription}</p>
          <p><span class="label">카메라:</span> ${c.cameraDirection}</p>
          <p><span class="label">조명:</span> ${c.moodLighting}</p>
          <p><span class="label">Video Prompt:</span></p><div class="mono">${c.videoPrompt}</div>
          ${c.extendPrompt ? `<p><span class="label">Extend Prompt:</span></p><div class="mono">${c.extendPrompt}</div>` : ""}
        </div>
      `).join("")}
      </body></html>
    `;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(printContent);
      w.document.close();
      w.print();
    }
  };

  const handleShareLink = async () => {
    try {
      const shareData = JSON.stringify(result);
      const compressed = btoa(encodeURIComponent(shareData));
      const shareUrl = `${window.location.origin}${window.location.pathname}#share=${compressed}`;
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // 데이터가 너무 클 경우 localStorage + 짧은 키 사용
      const shareKey = `share-${Date.now().toString(36)}`;
      localStorage.setItem(shareKey, JSON.stringify(result));
      const shareUrl = `${window.location.origin}${window.location.pathname}#shareKey=${shareKey}`;
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4">
      {/* 프로젝트 요약 */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3" style={{ background: "linear-gradient(135deg, #787fff15, #fff78725)" }}>
          <CardTitle className="text-lg" style={{ color: "#5a5ecc" }}>{result.projectTitle}</CardTitle>
          {videoGen.completedCount === 0 && (
            <p className="text-[11px] mt-1" style={{ color: "#94a3b8" }}>
              컷을 확인한 뒤 <span style={{ color: "#22c55e", fontWeight: 600 }}>영상 생성</span> 탭에서 바로 영상을 만들 수 있습니다.
            </p>
          )}
          {videoGen.completedCount > 0 && videoGen.completedCount < videoGen.totalCount && (
            <p className="text-[11px] mt-1" style={{ color: "#22c55e" }}>
              영상 생성 중 — {videoGen.completedCount}/{videoGen.totalCount} 컷 완료
            </p>
          )}
          {videoGen.completedCount > 0 && videoGen.completedCount === videoGen.totalCount && (
            <p className="text-[11px] mt-1" style={{ color: "#16a34a" }}>
              모든 영상이 완성되었습니다! 아래에서 결과를 확인해보세요.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {result.degraded && !result.usedFallback && (() => {
            const isProviderDegraded = result.degradedReason?.includes("서버") || result.degradedReason?.includes("요청 한도");
            return (
              <div className="p-3 rounded-lg text-sm" style={{
                background: isProviderDegraded ? "#f59e0b10" : "#3b82f610",
                border: `1px solid ${isProviderDegraded ? "#f59e0b30" : "#3b82f630"}`,
                color: isProviderDegraded ? "#92400e" : "#1d4ed8",
              }}>
                <strong>{isProviderDegraded
                  ? "세부 장면 보강 중 일부가 지연되어 기본 구조로 표시합니다"
                  : "스토리에 맞게 구성을 조정했습니다"}</strong>
                <p className="text-xs mt-1 opacity-80">
                  {result.degradedReason || "최적의 영상 품질을 위해 장면 구성을 자동으로 최적화했습니다."}
                </p>
              </div>
            );
          })()}
          {result.usedFallback && (
            <div className="p-3 rounded-lg text-sm" style={{
              background: "#f59e0b15",
              border: "1px solid #f59e0b40",
              color: "#b45309",
            }}>
              <strong>기본 구성으로 시작합니다</strong>
              <p className="text-xs mt-1 opacity-80">
                AI 분석이 일시적으로 제한되어 기본 구성이 적용되었습니다.
                컷별 프롬프트를 직접 수정하거나, 다시 생성해보세요.
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {result.conceptSummary}
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            {(() => {
              const summary = buildDurationSummary({ cuts: result.cuts, requestedSecondsPerScene: secondsPerScene });
              const t = summary.actualTotalDurationSeconds;
              const avgSec = result.cuts.length > 0
                ? Math.round(t / result.cuts.length * 10) / 10
                : 0;
              return (
                <>
                  <Badge style={{ background: "#787fff", color: "white" }}>최종 {result.cuts.length}컷</Badge>
                  <Badge variant="outline" style={{ borderColor: "#787fff60" }}>
                    {result.cuts.length <= 6
                      ? result.cuts.map(c => c.durationSec ?? 0).join("+") + "초"
                      : summary.hasRhythmContrast && summary.durationRange
                        ? `${summary.durationRange.min}~${summary.durationRange.max}초/컷 (평균 ${avgSec}초)`
                        : `${avgSec}초/컷`}
                  </Badge>
                  <Badge variant="outline" style={{ borderColor: "#787fff60" }}>
                    {`총 ${t}초 (${Math.floor(t / 60)}분 ${t % 60}초)`}
                  </Badge>
                  {summary.detail && (
                    <Badge variant="outline" style={{ borderColor: "#f59e0b80", fontSize: "10px" }}>
                      {summary.detail}
                    </Badge>
                  )}
                </>
              );
            })()}
            {/* 생성 모드 / 런타임 예산 — 데모에서는 숨김 */}
            <Badge variant="outline" style={{ borderColor: "#e09900" }}>
              캐릭터 {result.characterSeeds.length}명 시드 고정
            </Badge>
            {faceRefs.length > 0 && (
              <Badge style={{ background: "#d63031", color: "white" }}>
                얼굴 {faceRefs.length}명 REF 고정
              </Badge>
            )}
          </div>

          {/* 런타임 예산 초과 경고 — 데모에서는 숨김 */}

          {/* 인라인 감독 변경 재생성 — 데모에서는 숨김 */}
        </CardContent>
      </Card>

      {/* 섹션 탭 */}
      <div className="flex gap-2 sticky top-0 z-10 bg-background py-2">
        {([
          { key: "prompts", label: "컷 편집", color: "#787fff" },
          { key: "generate", label: "영상 생성", color: "#22c55e" },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSection(tab.key)}
            className="px-4 py-2 rounded-full text-sm font-medium transition-all"
            style={
              activeSection === tab.key
                ? { background: tab.color, color: "white", boxShadow: `0 2px 8px ${tab.color}40` }
                : { background: `${tab.color}15`, color: tab.color }
            }
          >
            {tab.label}
            {tab.key === "generate" && videoGen.completedCount > 0 && (
              <span className="ml-1.5 text-[10px]">
                {videoGen.completedCount}/{videoGen.totalCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 프롬프트 섹션 */}
      {activeSection === "prompts" && (
        <>
          {/* 캐릭터 시드 패널 */}
          {result.characterSeeds.length > 0 && (
            <Card className="overflow-hidden border-2" style={{ borderColor: "#e0990040" }}>
              <CardHeader className="pb-2" style={{ background: "linear-gradient(135deg, #e0990015, #fff78715)" }}>
                <CardTitle className="text-sm" style={{ color: "#b37700" }}>
                  캐릭터 시드 (전 장면 고정)
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">
                  모든 장면의 프롬프트에 아래 캐릭터 외형 묘사가 동일하게 삽입됩니다.
                </p>
              </CardHeader>
              <CardContent className="space-y-2 pt-3">
                {result.characterSeeds.map((seed) => (
                  <div key={seed.id} className="p-2.5 rounded-lg" style={{ background: "#fff78710", border: "1px solid #e0990020" }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge className="text-[10px] text-white" style={{ background: "#e09900" }}>
                        {seed.id}
                      </Badge>
                      <span className="text-xs font-medium">{seed.label}</span>
                      <span className="text-[10px] text-muted-foreground">| {seed.appearanceKo}</span>
                    </div>
                    <p className="text-[10px] font-mono p-1.5 rounded break-all leading-relaxed" style={{ background: "white", border: "1px dashed #e0990030" }}>
                      {seed.appearance}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 캐릭터 얼굴 고정 시스템 */}
          {result.characterSeeds.length > 0 && (
            <CharacterFaceManager
              characterSeeds={result.characterSeeds}
              storyboardImages={storyboardImages}
              faceRefs={faceRefs}
              onFaceRefsChange={setFaceRefs}
              elementAssets={elementAssets}
              onElementAssetsChange={setElementAssets}
            />
          )}

          {/* 감독 페르소나 & 글로벌 스타일 */}
          <Card>
            <CardContent className="space-y-3 pt-4">
              {result.directorPersonaPrompt && (
                <div className="space-y-1">
                  <p className="text-xs font-medium" style={{ color: "#5a5ecc" }}>감독 페르소나</p>
                  <p className="text-xs p-2 rounded-md leading-relaxed italic whitespace-pre-wrap break-words" style={{ background: "#787fff08", border: "1px solid #787fff15", overflowWrap: "anywhere" }}>
                    {result.directorPersonaPrompt}
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs font-medium" style={{ color: "#787fff" }}>Global Style Prompt</p>
                <p className="text-xs p-2 rounded-md font-mono break-all" style={{ background: "#787fff10" }}>
                  {result.globalStylePrompt}
                </p>
              </div>

              <Separator style={{ background: "linear-gradient(to right, #787fff40, #fff78740)" }} />

              <div className="space-y-1">
                <p className="text-xs font-medium" style={{ color: "#c4b800" }}>연속성 규칙</p>
                <ul className="text-xs space-y-0.5 list-disc list-inside text-muted-foreground">
                  {result.continuityRules.map((rule, i) => (
                    <li key={i}>{rule}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* 컷 리스트 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium" style={{ color: "#787fff" }}>
                장면 리스트 (드래그로 순서 변경, 클릭하여 프롬프트 수정)
              </h3>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[10px] h-7"
                  style={{ borderColor: "#7c3aed40", color: "#7c3aed" }}
                  disabled={srtLoading}
                  onClick={async () => {
                    setSrtLoading(true);
                    setSrtError(null);
                    try {
                      const res = await fetch("/api/generate-srt", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          scenes: result.cuts.map((c) => ({
                            cutNumber: c.cutNumber,
                            sceneDescription: c.sceneDescription,
                            durationSec: c.durationSec,
                          })),
                        }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        if (data.srt) {
                          setSrtContent(data.srt);
                          const blob = new Blob([data.srt], { type: "text/plain;charset=utf-8" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `subtitles-${Date.now()}.srt`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } else {
                          setSrtError("SRT 데이터가 비어있습니다");
                        }
                      } else {
                        const errData = await res.json().catch(() => ({}));
                        setSrtError(errData.error || `SRT 생성 실패 (${res.status})`);
                      }
                    } catch (err) {
                      console.error("[generate-srt]", err);
                      setSrtError("네트워크 오류 — SRT 생성 실패");
                    }
                    setSrtLoading(false);
                  }}
                >
                  {srtLoading ? "자막 생성 중..." : "SRT 자막 생성"}
                </Button>
              </div>
            </div>

            {srtError && (
              <div className="p-2 rounded-lg text-[10px]" style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a530" }}>
                SRT 오류: {srtError}
              </div>
            )}
            {srtContent && (
              <div className="p-2 rounded-lg text-[10px] font-mono max-h-32 overflow-auto" style={{ background: "#1e1e2e", color: "#cdd6f4" }}>
                <div className="flex justify-between items-center mb-1">
                  <Badge className="text-[8px] text-white" style={{ background: "#22c55e" }}>SRT 생성 완료</Badge>
                  <button
                    className="text-[9px] underline"
                    style={{ color: "#787fff" }}
                    onClick={() => {
                      const blob = new Blob([srtContent], { type: "text/plain;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `subtitles-${Date.now()}.srt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    다시 다운로드
                  </button>
                </div>
                <pre>{srtContent}</pre>
              </div>
            )}

            {result.cuts.map((cut, index) => (
              <div
                key={cut.cutNumber}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
                className="transition-all"
                style={{
                  borderTop: dragOverIndex === index ? "3px solid #787fff" : "3px solid transparent",
                  opacity: dragItemRef.current === index ? 0.5 : 1,
                  cursor: "grab",
                }}
              >
                <CutCard
                  cut={cut}
                  canonicalViewModel={canonicalViewModels.get(cut.cutNumber)}
                  characterSeeds={result.characterSeeds}
                  onUpdate={handleCutUpdate}
                  userVideoMode={videoGen.config.mode}
                  modelId={resolveModelForWorkflow({
                    workflow: videoGen.config.workflowType,
                    hasImage: !!storyboardImages[cut.cutNumber],
                    hasReferenceImages: (videoGen.config.referenceImages?.length ?? 0) > 0,
                  })}
                  shotSnapshots={videoGen.shotSnapshots.get(cut.cutNumber)}
                  narrationState={videoGen.shotNarrationStates.get(cut.cutNumber)}
                  storyboardImage={storyboardImages[cut.cutNumber]}
                  storyboardCandidates={storyboardCandidates[cut.cutNumber]}
                  storyboardLoading={storyboardLoading[cut.cutNumber]}
                  onGenerateImage={async () => {
                    setStoryboardLoading((prev) => ({ ...prev, [cut.cutNumber]: true }));
                    try {
                      const res = await fetch("/api/generate-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt: cut.imagePrompt, aspectRatio: "9:16", sceneDescription: cut.sceneDescription, animationMode }),
                      });
                      const data = await res.json();
                      if (res.ok && data.images?.[0]?.base64) {
                        const newImage = data.images[0].base64;
                        setStoryboardImages((prev) => ({ ...prev, [cut.cutNumber]: newImage }));
                        setStoryboardCandidates((prev) => {
                          const existing = prev[cut.cutNumber] ?? [];
                          return { ...prev, [cut.cutNumber]: [...existing, newImage] };
                        });
                      } else {
                        console.error(`CUT ${cut.cutNumber} 이미지 생성 실패:`, data.error || `HTTP ${res.status}`);
                        alert(`CUT ${cut.cutNumber} 이미지 생성 실패: ${data.error || "알 수 없는 오류"}`);
                      }
                    } catch (err) {
                      console.error("이미지 생성 에러:", err);
                      alert(`이미지 생성 요청 실패: ${err instanceof Error ? err.message : "네트워크 오류"}`);
                    }
                    setStoryboardLoading((prev) => ({ ...prev, [cut.cutNumber]: false }));
                  }}
                  onSelectCandidate={(base64) => {
                    setStoryboardImages((prev) => ({ ...prev, [cut.cutNumber]: base64 }));
                  }}
                  storyboardEndImage={storyboardEndImages[cut.cutNumber]}
                  storyboardEndLoading={storyboardEndLoading[cut.cutNumber]}
                  onGenerateEndImage={async () => {
                    setStoryboardEndLoading((prev) => ({ ...prev, [cut.cutNumber]: true }));
                    try {
                      const endPrompt = cut.endImagePrompt || cut.imagePrompt;
                      const res = await fetch("/api/generate-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt: endPrompt, aspectRatio: "9:16", sceneDescription: `END of: ${cut.sceneDescription}`, animationMode }),
                      });
                      const data = await res.json();
                      if (res.ok && data.images?.[0]?.base64) {
                        const endImg = data.images[0].base64;
                        setStoryboardEndImages((prev) => ({ ...prev, [cut.cutNumber]: endImg }));
                        // Auto-link: this cut's end = next cut's start
                        const nextCutNumber = cut.cutNumber + 1;
                        const nextCutExists = result.cuts.some((c) => c.cutNumber === nextCutNumber);
                        if (nextCutExists && !storyboardImages[nextCutNumber]) {
                          setStoryboardImages((prev) => ({ ...prev, [nextCutNumber]: endImg }));
                          setStoryboardCandidates((prev) => ({
                            ...prev,
                            [nextCutNumber]: [...(prev[nextCutNumber] ?? []), endImg],
                          }));
                        }
                      } else {
                        alert(`CUT ${cut.cutNumber} 끝 프레임 생성 실패: ${data.error || "알 수 없는 오류"}`);
                      }
                    } catch (err) {
                      alert(`끝 프레임 생성 실패: ${err instanceof Error ? err.message : "네트워크 오류"}`);
                    }
                    setStoryboardEndLoading((prev) => ({ ...prev, [cut.cutNumber]: false }));
                  }}
                  sceneTtsUrl={sceneTtsUrls[cut.cutNumber]}
                  sceneTtsLoading={sceneTtsLoading[cut.cutNumber]}
                  onGenerateSceneTts={async () => {
                    setSceneTtsLoading((prev) => ({ ...prev, [cut.cutNumber]: true }));
                    try {
                      const res = await fetch("/api/tts", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          text: cut.sceneDescription,
                          voiceName: ttsVoice,
                          speakingRate: ttsRate,
                        }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        if (data.audioBase64) {
                          const blob = new Blob(
                            [Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0))],
                            { type: "audio/mp3" }
                          );
                          setSceneTtsUrls((prev) => ({ ...prev, [cut.cutNumber]: URL.createObjectURL(blob) }));
                        }
                      }
                    } catch (err) { console.error("[tts scene]", err); }
                    setSceneTtsLoading((prev) => ({ ...prev, [cut.cutNumber]: false }));
                  }}
                  onFeedbackRefine={handleFeedbackRefine}
                  onEnglishRefine={handleEnglishRefine}
                />
              </div>
            ))}
          </div>

          {/* JSON 내보내기 — 데모에서는 접기 */}
          <details>
            <summary className="cursor-pointer text-[11px] py-1 px-2 rounded-lg" style={{ color: "#94a3b8" }}>
              내보내기 & 공유
            </summary>
          <Card className="overflow-hidden mt-2">
            <CardContent className="space-y-3 pt-4">
              <p className="text-xs font-medium" style={{ color: "#787fff" }}>내보내기 & 공유</p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={handleCopyJson} style={{ background: "#787fff", color: "white" }}>
                  {jsonCopied ? "복사됨!" : "JSON 복사"}
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownloadJson} style={{ borderColor: "#787fff60", color: "#787fff" }}>
                  JSON 다운로드
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownloadCsv} style={{ borderColor: "#22c55e60", color: "#16a34a" }}>
                  CSV 다운로드
                </Button>
                <Button size="sm" variant="outline" onClick={handlePrintPdf} style={{ borderColor: "#e0990060", color: "#b37700" }}>
                  PDF 인쇄
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowJson(!showJson)} style={{ borderColor: "#787fff60", color: "#787fff" }}>
                  {showJson ? "닫기" : "미리보기"}
                </Button>
                <Button size="sm" onClick={handleShareLink} style={{ background: "#7c3aed", color: "white" }}>
                  {shareCopied ? "링크 복사됨!" : "공유 링크 복사"}
                </Button>
              </div>
              {showJson && (
                <pre className="text-xs p-3 rounded-lg overflow-auto max-h-96 font-mono" style={{ background: "#1e1e2e", color: "#cdd6f4" }}>
                  {JSON.stringify(exportJson, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
          </details>
        </>
      )}

      {/* 영상 생성 섹션 */}
      {activeSection === "generate" && (
        <>
          <VideoSettingsPanel
            config={videoGen.config}
            onConfigChange={(cfg) => {
              videoGen.updateConfig(cfg);
              // duration이 변경되면 부모에도 통지 → InputPanel과 동기화
              if (cfg.durationSeconds !== undefined && onSecondsPerSceneChange) {
                onSecondsPerSceneChange(cfg.durationSeconds);
              }
            }}
            storyboardImages={storyboardImages}
          />
          <VideoGenerationPanel
            cuts={result.cuts}
            characterSeeds={result.characterSeeds}
            clips={videoGen.clips}
            isAutoMode={videoGen.isAutoMode}
            progress={videoGen.progress}
            completedCount={videoGen.completedCount}
            totalCount={videoGen.totalCount}
            projectTitle={result.projectTitle}
            onGenerateCut={(n) => videoGen.generateCut(n)}
            onStartAuto={videoGen.startAutoGeneration}
            onStopAuto={videoGen.stopAutoGeneration}
            onResetClip={videoGen.resetClip}
            onAddCut={videoGen.addCutVariant}
            onSelectVariant={videoGen.selectVariant}
            recoverableJobs={videoGen.recoverableJobs}
            onResumeJob={videoGen.resumeJob}
            canonicalMultiShots={(() => {
              const map = new Map<number, import("@/types").MultiShotPrompt[]>();
              for (const [num, vm] of canonicalViewModels) {
                if (vm.multiShot.length > 0) map.set(num, vm.multiShot);
              }
              return map;
            })()}
            canonicalDurations={(() => {
              const map = new Map<number, number>();
              for (const [num, vm] of canonicalViewModels) {
                map.set(num, vm.durationSec);
              }
              return map;
            })()}
            styleId={animationMode}
            modelId={resolveModelForWorkflow({
              workflow: videoGen.config.workflowType,
              hasImage: false,
              hasReferenceImages: (videoGen.config.referenceImages?.length ?? 0) > 0,
            })}
            onStitchComplete={(result) => {
              if (result) {
                setFinalVideoUrl(result.outputUrl);
                setFinalVideoSizeBytes(result.sizeBytes);
              } else {
                setFinalVideoUrl(null);
                setFinalVideoSizeBytes(0);
              }
            }}
          />

          {/* AI 리뷰 패널 */}
          {videoGen.review && (
            <VideoReviewPanel
              review={videoGen.review}
              onRegenerateCut={videoGen.regenerateFromFeedback}
              onRegenerateAll={videoGen.regenerateAllFromFeedback}
              onDismiss={videoGen.dismissReview}
              onReReview={videoGen.reviewAllClips}
            />
          )}

          {/* ── 원클릭 파이프라인 ── */}
          <OneClickPipeline
            hasCuts={result.cuts.length > 0}
            hasVideo={videoGen.completedCount > 0}
            hasSrt={!!srtContent}
            hasBgm={false}
            hasSeo={!!seoResult}
            onRunVideoGeneration={() => videoGen.startAutoGeneration()}
            onRunSrt={handleRunSrt}
            onRunBgm={async () => { /* BGM — 추후 구현 */ }}
            onRunSeo={handleRunSeo}
            onRunThumbnail={handleRunThumbnail}
          />

          {/* ── 유튜브 업로드 준비 상태 ── */}
          <Card className="overflow-hidden border" style={{ borderColor: "#787fff30" }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: "#334155" }}>
                업로드 준비 상태
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "컷 영상", done: videoGen.completedCount === videoGen.totalCount && videoGen.totalCount > 0, detail: `${videoGen.completedCount}/${videoGen.totalCount}` },
                  { label: "최종 영상", done: !!finalVideoUrl, detail: finalVideoUrl ? `${(finalVideoSizeBytes / 1024 / 1024).toFixed(1)}MB` : undefined },
                  { label: "자막 (SRT)", done: !!srtContent, detail: srtError || undefined },
                  { label: "SEO", done: !!seoResult, detail: seoError || undefined },
                  { label: "썸네일", done: thumbnailImages.length > 0, detail: thumbnailError || undefined },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-1.5 text-[11px]">
                    <span style={{ color: item.done ? "#22c55e" : item.detail && !item.done ? "#ef4444" : "#999" }}>
                      {item.done ? "✓" : item.detail && !item.done ? "✗" : "○"}
                    </span>
                    <span style={{ color: item.done ? "#334155" : "#999" }}>{item.label}</span>
                    {item.done && item.detail && (
                      <span className="text-[9px]" style={{ color: "#22c55e" }}>{item.detail}</span>
                    )}
                    {!item.done && item.detail && (
                      <span className="text-[9px] text-red-400 truncate max-w-[120px]">{item.detail}</span>
                    )}
                  </div>
                ))}
              </div>
              {finalVideoUrl && (
                <div className="flex items-center gap-2 py-1">
                  <a
                    href={finalVideoUrl}
                    download={`${result?.projectTitle || "montage"}_final.mp4`}
                    className="text-[11px] underline"
                    style={{ color: "#787fff" }}
                  >
                    최종 영상 다시 다운로드
                  </a>
                </div>
              )}
              {videoGen.completedCount === videoGen.totalCount && videoGen.totalCount > 0 && finalVideoUrl && srtContent && seoResult && thumbnailImages.length > 0 ? (
                <div className="text-[11px] text-center py-1 rounded" style={{ background: "#22c55e15", color: "#16a34a" }}>
                  모든 에셋 준비 완료 — 유튜브 업로드 가능
                </div>
              ) : videoGen.completedCount === videoGen.totalCount && videoGen.totalCount > 0 && !finalVideoUrl ? (
                <div className="text-[11px] text-center py-1 rounded" style={{ background: "#fef3c720", color: "#b45309" }}>
                  컷 영상 완료 — 생성 탭에서 &ldquo;최종 몽타주 MP4 생성&rdquo; 실행 필요
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* ── SEO 결과 표시 ── */}
          {seoError && (
            <div className="p-2 rounded-lg text-[10px]" style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a530" }}>
              SEO 오류: {seoError}
            </div>
          )}
          {seoResult && (
            <Card className="overflow-hidden border" style={{ borderColor: "#22c55e30" }}>
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs" style={{ color: "#16a34a" }}>유튜브 SEO</CardTitle>
                  <Badge className="text-[8px] text-white" style={{ background: "#22c55e" }}>생성 완료</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-[11px]">
                <div>
                  <span className="font-medium text-muted-foreground">제목 후보:</span>
                  <ul className="mt-1 space-y-0.5">
                    {seoResult.titles.map((t, i) => (
                      <li key={i} className="cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded text-[11px]"
                        onClick={() => { navigator.clipboard.writeText(t); }}
                        title="클릭하여 복사"
                      >
                        {i + 1}. {t}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">설명:</span>
                  <p className="text-[10px] mt-0.5 whitespace-pre-wrap bg-gray-50 rounded p-1.5 max-h-24 overflow-auto">{seoResult.description}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">태그:</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {seoResult.tags.slice(0, 15).map((tag, i) => (
                      <Badge key={i} variant="outline" className="text-[9px]">{tag}</Badge>
                    ))}
                  </div>
                </div>
                {seoResult.hashtags.length > 0 && (
                  <div>
                    <span className="font-medium text-muted-foreground">해시태그:</span>
                    <span className="text-[10px] ml-1">{seoResult.hashtags.join(" ")}</span>
                  </div>
                )}
                <button
                  className="text-[9px] underline"
                  style={{ color: "#787fff" }}
                  onClick={() => {
                    const text = `제목: ${seoResult.titles[0]}\n\n설명:\n${seoResult.description}\n\n태그: ${seoResult.tags.join(", ")}\n\n해시태그: ${seoResult.hashtags.join(" ")}`;
                    navigator.clipboard.writeText(text);
                  }}
                >
                  전체 복사
                </button>
              </CardContent>
            </Card>
          )}

          {/* ── 썸네일 결과 표시 ── */}
          {thumbnailError && (
            <div className="p-2 rounded-lg text-[10px]" style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a530" }}>
              썸네일 오류: {thumbnailError}
            </div>
          )}
          {thumbnailImages.length > 0 && (
            <Card className="overflow-hidden border" style={{ borderColor: "#22c55e30" }}>
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs" style={{ color: "#16a34a" }}>썸네일</CardTitle>
                  <Badge className="text-[8px] text-white" style={{ background: "#22c55e" }}>생성 완료</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {thumbnailImages.map((img, i) => (
                    <div key={i} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:${img.mimeType};base64,${img.base64}`}
                        alt={`썸네일 ${i + 1}`}
                        className="w-full rounded border cursor-pointer"
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = `data:${img.mimeType};base64,${img.base64}`;
                          a.download = `thumbnail-${i + 1}.png`;
                          a.click();
                        }}
                        title="클릭하여 다운로드"
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

        </>
      )}

      {/* 시퀀스 편집 섹션 */}
      {activeSection === "sequence" && (
        <div className="space-y-4">
          {/* 시퀀스 배치 재생성 버튼 */}
          {videoGen.sequenceNarrationState.dirtyShotCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md text-xs" style={{ background: "#fef3c7", border: "1px solid #f59e0b30" }}>
              <span style={{ color: "#b45309" }}>
                {videoGen.sequenceNarrationState.dirtyShotCount}개 샷의 나레이션이 수정되었습니다.
              </span>
              <Button
                size="sm"
                className="h-6 text-[10px] text-white ml-auto"
                style={{ background: "#f59e0b" }}
                disabled={videoGen.batchNarrationState.isRunning}
                onClick={videoGen.regenerateAllDirtyNarrations}
              >
                {videoGen.batchNarrationState.isRunning
                  ? `처리 중... (${videoGen.batchNarrationState.completed + videoGen.batchNarrationState.failed}/${videoGen.batchNarrationState.total})`
                  : "모두 다시 생성"
                }
              </Button>
            </div>
          )}
          {/* 배치 완료 요약 */}
          {!videoGen.batchNarrationState.isRunning && videoGen.batchNarrationState.total > 0 && videoGen.sequenceNarrationState.dirtyShotCount === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md text-xs" style={{ background: "#f0fdf4", border: "1px solid #22c55e30" }}>
              <span style={{ color: "#16a34a" }}>배치 재생성 완료</span>
              {videoGen.batchNarrationState.failed > 0 && (
                <span style={{ color: "#ef4444" }}>
                  (실패: C{videoGen.batchNarrationState.failedCutNumbers.join(", C")})
                </span>
              )}
            </div>
          )}
          {videoGen.clips.filter((c) => c.structuredSequence).length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground rounded-lg border-2 border-dashed">
              structuredSequence가 있는 클립이 없습니다.<br />
              &quot;영상 생성&quot; 탭에서 먼저 프롬프트를 생성하세요.
            </div>
          ) : (
            videoGen.clips
              .filter((c) => c.structuredSequence)
              .map((clip) => (
                <SequenceTimelineEditor
                  key={clip.cutNumber}
                  structuredSequence={clip.structuredSequence!}
                  onApply={(updated) => {
                    videoGen.updateClipStructuredSequence(clip.cutNumber, updated);
                  }}
                  onRegenerateShot={(shotId, currentDoc) => {
                    videoGen.regenerateShot(clip.cutNumber, shotId, currentDoc);
                  }}
                  variantState={videoGen.shotVariantState}
                  onAcceptVariant={(shotId, variantId) => {
                    videoGen.acceptShotVariant(shotId, variantId);
                  }}
                  shotNarrationState={videoGen.shotNarrationStates.get(clip.cutNumber)}
                  onMarkNarrationDirty={videoGen.markNarrationDirty}
                  onRegenerateShotNarration={videoGen.regenerateShotNarration}
                  batchActiveCutNumber={videoGen.batchNarrationState.isRunning ? videoGen.batchNarrationState.activeCutNumber : undefined}
                />
              ))
          )}
        </div>
      )}

      {/* 타임라인 섹션 */}
      {activeSection === "timeline" && (
        <TimelineEditor
          clips={videoGen.clips}
          onReorder={videoGen.reorderClips}
          onTrimChange={videoGen.setTrim}
          audioMeta={videoGen.audioMeta}
          narrationStatus={videoGen.narrationStatus}
          shotNarrationStates={videoGen.shotNarrationStates}
          sequenceNarrationState={videoGen.sequenceNarrationState}
          batchNarrationState={videoGen.batchNarrationState}
          onRegenerateAllDirtyNarrations={videoGen.regenerateAllDirtyNarrations}
        />
      )}

    </div>
  );
}
