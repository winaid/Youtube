"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { PromptOutput, Cut, GeneratorStatus, CharacterFaceRef } from "@/types";
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

interface ResultPanelProps {
  result: PromptOutput | null;
  status: GeneratorStatus;
  error: string | null;
  onUpdateResult?: (updated: PromptOutput) => void;
  storyText?: string;
  directorName?: string;
  region?: string;
  animationMode?: string;
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
  // 캐릭터 얼굴 레퍼런스
  const [faceRefs, setFaceRefs] = useState<CharacterFaceRef[]>([]);
  // 인라인 감독 변경 재생성
  const [altDirector, setAltDirector] = useState("");
  const [altGenerating, setAltGenerating] = useState(false);

  const videoGen = useVideoGeneration({
    cuts: result?.cuts ?? [],
    storyboardImages,
    storyboardEndImages,
    faceRefs,
    onSeedDetected: (cutNumber, seed) => {
      console.log(`CUT ${cutNumber} seed: ${seed}`);
    },
  });

  // animationMode를 videoGen config에 동기화
  useEffect(() => {
    if (animationMode && videoGen.config.animationMode !== animationMode) {
      videoGen.updateConfig({ animationMode });
    }
  }, [animationMode, videoGen]);

  // 프롬프트 생성 시 cutDuration → videoGen config에 자동 동기화
  useEffect(() => {
    if (!result || result.cuts.length === 0) return;
    const dur = result.cuts[0].durationSec as import("@/types").VeoClipDuration;
    if (dur && videoGen.config.durationSeconds !== dur) {
      const engine = dur >= 10 ? "kling" : videoGen.config.engine;
      videoGen.updateConfig({ durationSeconds: dur, engine });
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
        return {
          cutNumber: cut.cutNumber,
          sceneDescription: cut.sceneDescription,
          videoUri: clip.videoUri,
          seed: clip.seed,
          durationSec: cut.durationSec,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    if (completedCuts.length > 0) {
      saveToHistory({
        storyTitle: result.cuts[0]?.sceneDescription?.slice(0, 50) || "영상",
        cuts: completedCuts,
      });
    }
  }, [result, videoGen.completedCount, videoGen.clips]);

  // Enhancement 2: Feedback-based prompt refinement
  const handleFeedbackRefine = useCallback(async (cutNumber: number, feedback: string) => {
    if (!result || !onUpdateResult) return;
    const cut = result.cuts.find((c) => c.cutNumber === cutNumber);
    if (!cut) return;
    try {
      const res = await fetch("/api/refine-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoPrompt: cut.videoPrompt,
          extendPrompt: cut.extendPrompt,
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
  }, [result, onUpdateResult]);

  // Enhancement 3: English native correction (manual trigger)
  const handleEnglishRefine = useCallback(async (cutNumber: number) => {
    if (!result || !onUpdateResult) return;
    const cut = result.cuts.find((c) => c.cutNumber === cutNumber);
    if (!cut) return;
    try {
      const res = await fetch("/api/refine-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoPrompt: cut.videoPrompt,
          extendPrompt: cut.extendPrompt,
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
  }, [result, onUpdateResult]);

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

  if (status === "idle") {
    return (
      <Card className="h-full flex items-center justify-center border-2 border-dashed" style={{ borderColor: "#787fff30" }}>
        <CardContent className="text-center py-16">
          <div className="text-5xl mb-4" style={{ filter: "drop-shadow(0 4px 8px #787fff40)" }}>🎬</div>
          <p className="text-muted-foreground text-sm">
            시나리오를 입력하고 감독 스타일을 선택한 후
            <br />
            <span style={{ color: "#787fff", fontWeight: 600 }}>&quot;프롬프트 생성하기&quot;</span> 버튼을 눌러주세요.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === "loading") {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center py-16 space-y-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent mx-auto" style={{ borderColor: "#787fff", borderTopColor: "transparent" }} />
          <p className="text-sm font-medium" style={{ color: "#787fff" }}>
            Gemini AI가 시나리오를 분석하고 있습니다...
          </p>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>1. 캐릭터 외형 정의 (성별, 헤어, 의상, 체형...)</p>
            <p>2. 감독 스타일 적용 & 장면 분할</p>
            <p>3. Extend 프롬프트 생성 (캐릭터 일관성 보장)</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center py-16">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-destructive text-sm font-medium">
            프롬프트 생성 중 오류가 발생했습니다.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {error ?? "알 수 없는 오류"}
          </p>
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

  const getEffectiveMode = (_cut?: unknown) => "fast" as const;
  const fastCuts = result.cuts;

  const veoJson = {
    project: result.projectTitle,
    globalStyle: result.globalStylePrompt,
    directorPersona: result.directorPersonaPrompt,
    characterSeeds: result.characterSeeds,
    continuityRules: result.continuityRules,
    totalDuration: (() => { const t = result.cuts.reduce((s, c) => s + (c.durationSec ?? 8), 0); return `${t}초 (${Math.floor(t / 60)}분${t % 60 > 0 ? ` ${t % 60}초` : ""})`; })(),
    extendStrategy: {
      description: "장면 1은 Video Prompt로 최초 생성. 장면 2부터는 이전 클립의 마지막 프레임을 참조 이미지로 사용하여 Extend Prompt로 연장.",
      steps: result.cuts.map((cut) => ({
        cut: cut.cutNumber,
        method: cut.cutNumber === 1 ? "VIDEO_PROMPT" : "EXTEND_FROM_PREVIOUS",
        prompt: cut.cutNumber === 1 ? cut.videoPrompt : cut.extendPrompt,
        veoMode: getEffectiveMode(cut),
        charactersInScene: cut.charactersInScene,
      })),
    },
    cuts: result.cuts.map((cut) => ({
      cut: cut.cutNumber,
      duration: `${cut.durationSec}s`,
      method: cut.cutNumber === 1 ? "VIDEO_PROMPT" : "EXTEND",
      veoMode: "fast",
      scene: cut.sceneDescription,
      camera: cut.cameraDirection,
      lighting: cut.moodLighting,
      imagePrompt: cut.imagePrompt,
      videoPrompt: cut.videoPrompt,
      extendPrompt: cut.extendPrompt,
      transition: cut.transitionHint,
      characterConsistency: cut.characterConsistency,
      charactersInScene: cut.charactersInScene,
    })),
  };

  const handleCopyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(veoJson, null, 2));
    setJsonCopied(true);
    setTimeout(() => setJsonCopied(false), 1500);
  };

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(veoJson, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `veo-project-${Date.now()}.json`;
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
    a.download = `veo-project-${Date.now()}.csv`;
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
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {result.usedFallback && (
            <div className="p-3 rounded-lg text-sm" style={{
              background: result.fallbackReason?.includes("토큰 한도") || result.fallbackReason?.includes("MAX_TOKENS") || result.fallbackReason?.includes("truncat")
                ? "#f59e0b20" : "#ff634720",
              border: result.fallbackReason?.includes("토큰 한도") || result.fallbackReason?.includes("MAX_TOKENS") || result.fallbackReason?.includes("truncat")
                ? "1px solid #f59e0b60" : "1px solid #ff634760",
              color: result.fallbackReason?.includes("토큰 한도") || result.fallbackReason?.includes("MAX_TOKENS") || result.fallbackReason?.includes("truncat")
                ? "#d97706" : "#ff6347",
            }}>
              <strong>
                {result.fallbackReason?.includes("토큰 한도") || result.fallbackReason?.includes("MAX_TOKENS") || result.fallbackReason?.includes("truncat")
                  ? "Gemini 응답 토큰 한도 초과 — 임시 프롬프트 사용 중"
                  : "API 연결 실패 — 임시 프롬프트 사용 중"}
              </strong>
              <p className="text-xs mt-1 opacity-80">
                {result.fallbackReason?.includes("토큰 한도") || result.fallbackReason?.includes("MAX_TOKENS") || result.fallbackReason?.includes("truncat")
                  ? "Gemini 응답이 토큰 한도로 잘려 JSON 파싱이 실패했습니다. compact retry 후에도 실패하여 기본 템플릿이 사용되었습니다."
                  : "Gemini API 호출이 실패하여 기본 템플릿으로 장면이 생성되었습니다."}
                {" "}프롬프트가 모두 동일하게 보일 수 있습니다.
                {result.fallbackReason && <span className="block mt-0.5">사유: {result.fallbackReason}</span>}
              </p>
              <p className="text-xs mt-1 opacity-80">
                {result.fallbackReason?.includes("토큰 한도") || result.fallbackReason?.includes("MAX_TOKENS") || result.fallbackReason?.includes("truncat")
                  ? "해결: 컷 수를 줄이거나 (8개 이하 권장) 스토리 텍스트를 축소하세요. 이것은 API 키 문제가 아닙니다."
                  : result.fallbackReason?.includes("MODEL_NOT_FOUND") || result.fallbackReason?.includes("deprecated")
                  ? "원인: 모델명이 변경되었습니다. _gemini-keys.ts의 모델 상수를 최신 버전으로 업데이트하세요."
                  : result.fallbackReason?.includes("MISSING_API_KEY") || result.fallbackReason?.includes("No auth")
                  ? "원인: GEMINI_API_KEY가 설정되지 않았습니다. Cloudflare Pages 환경변수에서 설정하세요."
                  : result.fallbackReason?.includes("429") || result.fallbackReason?.includes("quota")
                  ? "원인: API 할당량 초과입니다. 잠시 후 다시 시도하거나 GEMINI_API_KEY_2를 추가 설정하세요."
                  : "확인사항: ① GEMINI_API_KEY 환경변수 설정 여부 ② API 할당량 ③ 모델명이 최신인지 확인"}
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {result.conceptSummary}
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge style={{ background: "#787fff", color: "white" }}>총 {result.totalCuts}장면</Badge>
            <Badge style={{ background: "#22c55e", color: "white" }}>Fast: {fastCuts.length}장면</Badge>
            <Badge variant="outline" style={{ borderColor: "#787fff60" }}>
              {(() => { const t = result.cuts.reduce((s, c) => s + (c.durationSec ?? 8), 0); return `총 ${t}초 (${Math.floor(t / 60)}분 ${t % 60}초)`; })()}
            </Badge>
            <Badge variant="outline" style={{ borderColor: "#e09900" }}>
              캐릭터 {result.characterSeeds.length}명 시드 고정
            </Badge>
            {faceRefs.length > 0 && (
              <Badge style={{ background: "#d63031", color: "white" }}>
                얼굴 {faceRefs.length}명 REF 고정
              </Badge>
            )}
          </div>

          {/* 인라인 감독 변경 재생성 */}
          {onUpdateResult && (
            <div className="flex items-center gap-2 pt-1">
              <select
                value={altDirector}
                onChange={(e) => setAltDirector(e.target.value)}
                className="h-7 rounded-md border text-[11px] px-2 max-w-[160px]"
              >
                <option value="">다른 감독으로 재생성...</option>
                {[
                  { id: "wong-kar-wai", name: "왕가위" },
                  { id: "bong-joon-ho", name: "봉준호" },
                  { id: "park-chan-wook", name: "박찬욱" },
                  { id: "wes-anderson", name: "웨스 앤더슨" },
                  { id: "david-fincher", name: "데이비드 핀처" },
                  { id: "christopher-nolan", name: "크리스토퍼 놀란" },
                  { id: "hayao-miyazaki", name: "미야자키 하야오" },
                  { id: "quentin-tarantino", name: "쿠엔틴 타란티노" },
                  { id: "denis-villeneuve", name: "드니 빌뇌브" },
                  { id: "greta-gerwig", name: "그레타 거윅" },
                ].map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              {altDirector && (
                <Button
                  size="sm"
                  className="h-7 text-[11px] text-white"
                  style={{ background: "#7c3aed" }}
                  disabled={altGenerating}
                  onClick={async () => {
                    setAltGenerating(true);
                    try {
                      const res = await fetch("/api/generate-cuts", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          storyText: storyText || result.conceptSummary,
                          directorName: altDirector,
                          directorNameKo: altDirector,
                          animationMode: animationMode || "2D 애니",
                          aspectRatio: "9:16",
                          region: region || "한국",
                          cutCount: result.cuts.length,
                        }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        if (data.cuts) {
                          onUpdateResult({
                            ...result,
                            cuts: data.cuts,
                            characterSeeds: data.characterSeeds || result.characterSeeds,
                            totalCuts: data.cuts.length,
                          });
                          setAltDirector("");
                        }
                      }
                    } catch (err) { console.error("[generate-cuts alt]", err); }
                    setAltGenerating(false);
                  }}
                >
                  {altGenerating ? "재생성 중..." : "이 감독으로 전환"}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 섹션 탭 */}
      <div className="flex gap-2 sticky top-0 z-10 bg-background py-2">
        {([
          { key: "prompts", label: "프롬프트", color: "#787fff" },
          { key: "generate", label: "영상 생성", color: "#22c55e" },
          { key: "sequence", label: "시퀀스", color: "#8b5cf6" },
          { key: "timeline", label: "타임라인", color: "#c4b800" },
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
            />
          )}

          {/* 감독 페르소나 & 글로벌 스타일 */}
          <Card className="overflow-hidden">
            <CardContent className="space-y-3 pt-4">
              {result.directorPersonaPrompt && (
                <div className="space-y-1">
                  <p className="text-xs font-medium" style={{ color: "#5a5ecc" }}>감독 페르소나</p>
                  <p className="text-xs p-2 rounded-md leading-relaxed italic" style={{ background: "#787fff08", border: "1px solid #787fff15" }}>
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
                        }
                      }
                    } catch (err) { console.error("[generate-srt]", err); }
                    setSrtLoading(false);
                  }}
                >
                  {srtLoading ? "자막 생성 중..." : "SRT 자막 생성"}
                </Button>
              </div>
            </div>

            {srtContent && (
              <div className="p-2 rounded-lg text-[10px] font-mono max-h-32 overflow-auto" style={{ background: "#1e1e2e", color: "#cdd6f4" }}>
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
                  characterSeeds={result.characterSeeds}
                  onUpdate={handleCutUpdate}
                  userVeoMode={videoGen.config.mode}
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

          {/* JSON 내보내기 */}
          <Card className="overflow-hidden">
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
                  {JSON.stringify(veoJson, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* 영상 생성 섹션 */}
      {activeSection === "generate" && (
        <>
          <VideoSettingsPanel
            config={videoGen.config}
            onConfigChange={videoGen.updateConfig}
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
            onGenerateCut={(n) => videoGen.generateCut(n)}
            onStartAuto={videoGen.startAutoGeneration}
            onStopAuto={videoGen.stopAutoGeneration}
            onResetClip={videoGen.resetClip}
            onAddCut={videoGen.addCutVariant}
            onSelectVariant={videoGen.selectVariant}
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

          {/* 영상 히스토리 */}
          <VideoHistoryPanel />

          {/* 원클릭 파이프라인 */}
          <OneClickPipeline
            hasCuts={result.cuts.length > 0}
            hasStoryboard={Object.keys(storyboardImages).length >= result.cuts.length}
            hasVideo={videoGen.completedCount >= result.cuts.length}
            hasSrt={!!srtContent}
            hasBgm={false}
            hasSeo={false}
            onRunStoryboard={async () => {
              const tasks = result.cuts
                .filter((cut) => !storyboardImages[cut.cutNumber])
                .map((cut) => {
                  setStoryboardLoading((prev) => ({ ...prev, [cut.cutNumber]: true }));
                  return fetch("/api/generate-image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: cut.imagePrompt, aspectRatio: "9:16", sceneDescription: cut.sceneDescription, animationMode }),
                  })
                    .then((res) => res.json().then((data) => ({ ok: res.ok, data, cutNumber: cut.cutNumber })))
                    .then(({ ok, data, cutNumber }) => {
                      if (ok && data.images?.[0]?.base64) {
                        const newImage = data.images[0].base64;
                        setStoryboardImages((prev) => ({ ...prev, [cutNumber]: newImage }));
                        setStoryboardCandidates((prev) => ({
                          ...prev,
                          [cutNumber]: [...(prev[cutNumber] ?? []), newImage],
                        }));
                      }
                    })
                    .catch(() => { /* continue */ })
                    .finally(() => setStoryboardLoading((prev) => ({ ...prev, [cut.cutNumber]: false })));
                });
              await Promise.all(tasks);
            }}
            onRunVideoGeneration={() => videoGen.startAutoGeneration()}
            onRunSrt={async () => {
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
                if (data.srt) setSrtContent(data.srt);
              }
            }}
            onRunBgm={async () => { /* BGM removed */ }}
            onRunSeo={async () => {}}
            onRunThumbnail={async () => {}}
          />

        </>
      )}

      {/* 시퀀스 편집 섹션 */}
      {activeSection === "sequence" && (
        <div className="space-y-4">
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
        />
      )}

    </div>
  );
}
