"use client";

import { useState, useRef, useCallback } from "react";
import { PromptOutput, Cut, GeneratorStatus, CharacterFaceRef, SceneSfx } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import CutCard from "./CutCard";
import VideoGenerationPanel from "./VideoGenerationPanel";
import VideoSettingsPanel from "./VideoSettingsPanel";
import TimelineEditor from "./TimelineEditor";
import CharacterFaceManager from "./CharacterFaceManager";
import SfxPanel from "./SfxPanel";
import SeriesManager from "./SeriesManager";
import OneClickPipeline from "./OneClickPipeline";
import EnvironmentPanel from "./EnvironmentPanel";
import EmotionCurveEditor from "./EmotionCurveEditor";
import YouTubeSEOPanel from "./YouTubeSEOPanel";
import { useVideoGeneration } from "@/hooks/useVideoGeneration";
import { EmotionPoint } from "@/types";

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
  directorName,
  region,
  animationMode,
}: ResultPanelProps) {
  const [jsonCopied, setJsonCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [activeSection, setActiveSection] = useState<"prompts" | "generate" | "timeline" | "audio">("prompts");
  const [emotionPoints, setEmotionPoints] = useState<EmotionPoint[]>([]);
  interface BgmMainResult { mood: string; genre: string; tempo: string; searchKeywords: string[]; suggestions: string[]; source: string; }
  interface BgmSceneResult { forScenes: string; mood: string; searchKeywords: string[]; suggestion: string; }
  interface BgmData { mainBgm?: BgmMainResult; sceneBgm?: BgmSceneResult[]; }
  const [bgmResult, setBgmResult] = useState<BgmData | null>(null);
  const [bgmLoading, setBgmLoading] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [ttsVoice, setTtsVoice] = useState("ko-KR-Wavenet-A");
  const [ttsRate, setTtsRate] = useState(1.0);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragItemRef = useRef<number | null>(null);
  // 스토리보드 이미지
  const [storyboardImages, setStoryboardImages] = useState<Record<number, string>>({});
  const [storyboardCandidates, setStoryboardCandidates] = useState<Record<number, string[]>>({});
  const [storyboardLoading, setStoryboardLoading] = useState<Record<number, boolean>>({});
  // 장면별 TTS
  const [sceneTtsUrls, setSceneTtsUrls] = useState<Record<number, string>>({});
  const [sceneTtsLoading, setSceneTtsLoading] = useState<Record<number, boolean>>({});
  // SRT
  const [srtContent, setSrtContent] = useState<string | null>(null);
  const [srtLoading, setSrtLoading] = useState(false);
  // 캐릭터 얼굴 레퍼런스
  const [faceRefs, setFaceRefs] = useState<CharacterFaceRef[]>([]);
  // 효과음 매칭
  const [sceneSfxList, setSceneSfxList] = useState<SceneSfx[]>([]);
  // 인라인 감독 변경 재생성
  const [altDirector, setAltDirector] = useState("");
  const [altGenerating, setAltGenerating] = useState(false);

  const videoGen = useVideoGeneration({
    cuts: result?.cuts ?? [],
    storyboardImages,
    faceRefs,
    onSeedDetected: (cutNumber, seed) => {
      console.log(`CUT ${cutNumber} seed: ${seed}`);
    },
  });

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
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
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

  const hasTextPattern = /text|title|caption|subtitle|letter|sign|hangeul|자막|글씨|텍스트|타이틀/i;
  const qualityCuts = result.cuts.filter((c) =>
    hasTextPattern.test(c.videoPrompt + " " + c.imagePrompt + " " + c.sceneDescription)
  );
  const fastCuts = result.cuts.filter(
    (c) => !hasTextPattern.test(c.videoPrompt + " " + c.imagePrompt + " " + c.sceneDescription)
  );

  const veoJson = {
    project: result.projectTitle,
    globalStyle: result.globalStylePrompt,
    directorPersona: result.directorPersonaPrompt,
    characterSeeds: result.characterSeeds,
    continuityRules: result.continuityRules,
    totalDuration: `${result.cuts.length * 8}초 (${Math.round((result.cuts.length * 8) / 60)}분)`,
    extendStrategy: {
      description: "CUT 1은 Video Prompt로 최초 생성. CUT 2부터는 이전 클립의 마지막 프레임을 참조 이미지로 사용하여 Extend Prompt로 연장.",
      steps: result.cuts.map((cut) => ({
        cut: cut.cutNumber,
        method: cut.cutNumber === 1 ? "VIDEO_PROMPT" : "EXTEND_FROM_PREVIOUS",
        prompt: cut.cutNumber === 1 ? cut.videoPrompt : cut.extendPrompt,
        veoMode: hasTextPattern.test(cut.videoPrompt + " " + cut.imagePrompt + " " + cut.sceneDescription)
          ? "quality" : "fast",
        charactersInScene: cut.charactersInScene,
      })),
    },
    cuts: result.cuts.map((cut) => ({
      cut: cut.cutNumber,
      duration: `${cut.durationSec}s`,
      method: cut.cutNumber === 1 ? "VIDEO_PROMPT" : "EXTEND",
      veoMode: hasTextPattern.test(cut.videoPrompt + " " + cut.imagePrompt + " " + cut.sceneDescription)
        ? "quality" : "fast",
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
            <div className="p-3 rounded-lg text-sm" style={{ background: "#ff634720", border: "1px solid #ff634760", color: "#ff6347" }}>
              <strong>API 연결 실패 — 임시 프롬프트 사용 중</strong>
              <p className="text-xs mt-1 opacity-80">
                Gemini API 호출이 실패하여 기본 템플릿으로 장면이 생성되었습니다.
                프롬프트가 모두 동일하게 보일 수 있습니다.
                {result.fallbackReason && <span className="block mt-0.5">사유: {result.fallbackReason}</span>}
              </p>
              <p className="text-xs mt-1 opacity-80">
                해결: GEMINI_API_KEY가 올바르게 설정되어 있는지, API 할당량이 남아있는지 확인하세요.
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {result.conceptSummary}
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge style={{ background: "#787fff", color: "white" }}>총 {result.totalCuts}장면</Badge>
            <Badge style={{ background: "#22c55e", color: "white" }}>Fast: {fastCuts.length}장면</Badge>
            <Badge style={{ background: "#e09900", color: "white" }}>Quality: {qualityCuts.length}장면</Badge>
            <Badge variant="outline" style={{ borderColor: "#787fff60" }}>
              총 {result.cuts.length * 8}초 ({Math.round((result.cuts.length * 8) / 60)}분)
            </Badge>
            <Badge variant="outline" style={{ borderColor: "#e09900" }}>
              캐릭터 {result.characterSeeds.length}명 시드 고정
            </Badge>
            {faceRefs.length > 0 && (
              <Badge style={{ background: "#d63031", color: "white" }}>
                얼굴 {faceRefs.length}명 REF 고정
              </Badge>
            )}
            {sceneSfxList.length > 0 && (
              <Badge style={{ background: "#e64436", color: "white" }}>
                SFX {sceneSfxList.reduce((a, s) => a + s.sfxMatches.length, 0)}개
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
                    } catch { /* ignore */ }
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
          { key: "timeline", label: "타임라인", color: "#c4b800" },
          { key: "audio", label: "BGM/TTS/SFX", color: "#e09900" },
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
                  style={{ borderColor: "#787fff40", color: "#787fff" }}
                  onClick={async () => {
                    let failCount = 0;
                    for (const cut of result.cuts) {
                      if (storyboardImages[cut.cutNumber]) continue;
                      setStoryboardLoading((prev) => ({ ...prev, [cut.cutNumber]: true }));
                      try {
                        const res = await fetch("/api/generate-image", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ prompt: cut.imagePrompt, aspectRatio: "9:16", sceneDescription: cut.sceneDescription }),
                        });
                        const data = await res.json();
                        if (res.ok && data.images?.[0]?.base64) {
                          const newImage = data.images[0].base64;
                          setStoryboardImages((prev) => ({ ...prev, [cut.cutNumber]: newImage }));
                          setStoryboardCandidates((prev) => ({
                            ...prev,
                            [cut.cutNumber]: [...(prev[cut.cutNumber] ?? []), newImage],
                          }));
                        } else {
                          console.error(`CUT ${cut.cutNumber} 실패:`, data.error);
                          failCount++;
                        }
                      } catch (err) {
                        console.error(`CUT ${cut.cutNumber} 에러:`, err);
                        failCount++;
                      }
                      setStoryboardLoading((prev) => ({ ...prev, [cut.cutNumber]: false }));
                    }
                    if (failCount > 0) {
                      alert(`${failCount}개 장면 이미지 생성 실패. 콘솔에서 상세 에러를 확인하세요.`);
                    }
                  }}
                >
                  전체 스토리보드 생성
                </Button>
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
                    } catch { /* ignore */ }
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
                  storyboardImage={storyboardImages[cut.cutNumber]}
                  storyboardCandidates={storyboardCandidates[cut.cutNumber]}
                  storyboardLoading={storyboardLoading[cut.cutNumber]}
                  onGenerateImage={async () => {
                    setStoryboardLoading((prev) => ({ ...prev, [cut.cutNumber]: true }));
                    try {
                      const res = await fetch("/api/generate-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt: cut.imagePrompt, aspectRatio: "9:16", sceneDescription: cut.sceneDescription }),
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
                    } catch { /* ignore */ }
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
            onSelectVariant={videoGen.selectVariant}
          />

          {/* 원클릭 파이프라인 */}
          <OneClickPipeline
            hasCuts={result.cuts.length > 0}
            hasStoryboard={Object.keys(storyboardImages).length >= result.cuts.length}
            hasVideo={videoGen.completedCount >= result.cuts.length}
            hasSrt={!!srtContent}
            hasBgm={!!bgmResult}
            hasSeo={false}
            onRunStoryboard={async () => {
              for (const cut of result.cuts) {
                if (storyboardImages[cut.cutNumber]) continue;
                setStoryboardLoading((prev) => ({ ...prev, [cut.cutNumber]: true }));
                try {
                  const res = await fetch("/api/generate-image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: cut.imagePrompt, aspectRatio: "9:16", sceneDescription: cut.sceneDescription }),
                  });
                  const data = await res.json();
                  if (res.ok && data.images?.[0]?.base64) {
                    const newImage = data.images[0].base64;
                    setStoryboardImages((prev) => ({ ...prev, [cut.cutNumber]: newImage }));
                    setStoryboardCandidates((prev) => ({
                      ...prev,
                      [cut.cutNumber]: [...(prev[cut.cutNumber] ?? []), newImage],
                    }));
                  }
                } catch { /* continue */ }
                setStoryboardLoading((prev) => ({ ...prev, [cut.cutNumber]: false }));
              }
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
            onRunBgm={async () => {
              const res = await fetch("/api/recommend-bgm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  scenes: result.cuts.map((c) => ({
                    sceneDescription: c.sceneDescription,
                    moodLighting: c.moodLighting,
                  })),
                }),
              });
              if (res.ok) setBgmResult(await res.json());
            }}
            onRunSeo={async () => { /* handled by YouTubeSEOPanel */ }}
            onRunThumbnail={async () => { /* handled by YouTubeSEOPanel */ }}
          />

          {/* 유튜브 SEO + 썸네일 + 시청자 예측 */}
          <YouTubeSEOPanel
            result={result}
            region={region}
            animationMode={animationMode}
          />

          {/* 감정 곡선 에디터 */}
          <EmotionCurveEditor
            cuts={result.cuts}
            emotionPoints={emotionPoints}
            onChange={setEmotionPoints}
          />

          {/* 날씨/시간대 일관성 */}
          <EnvironmentPanel
            cuts={result.cuts}
            onApplyEnvironment={(suffix) => {
              if (!onUpdateResult) return;
              const newCuts = result.cuts.map((cut) => ({
                ...cut,
                videoPrompt: cut.videoPrompt.includes(suffix.split(",")[0])
                  ? cut.videoPrompt
                  : `${cut.videoPrompt}. ${suffix}`,
                moodLighting: `${cut.moodLighting}, ${suffix.split(",").slice(0, 2).join(",")}`,
              }));
              onUpdateResult({ ...result, cuts: newCuts });
            }}
          />

          {/* 시리즈 연속성 관리 */}
          <SeriesManager
            characterSeeds={result.characterSeeds}
            projectTitle={result.projectTitle}
            onLoadCharacters={(chars) => {
              if (onUpdateResult) {
                const merged = [...result.characterSeeds];
                for (const ch of chars) {
                  if (!merged.find((m) => m.id === ch.id)) merged.push(ch);
                }
                onUpdateResult({ ...result, characterSeeds: merged });
              }
            }}
          />
        </>
      )}

      {/* 타임라인 섹션 */}
      {activeSection === "timeline" && (
        <TimelineEditor
          clips={videoGen.clips}
          onReorder={videoGen.reorderClips}
          onTrimChange={videoGen.setTrim}
        />
      )}

      {/* BGM / TTS / SFX 섹션 */}
      {activeSection === "audio" && (
        <div className="space-y-4">
          {/* 효과음 자동 매칭 */}
          <SfxPanel
            cuts={result.cuts}
            sceneSfxList={sceneSfxList}
            onSceneSfxChange={setSceneSfxList}
          />

          {/* BGM 추천 */}
          <Card className="overflow-hidden border-2" style={{ borderColor: "#e0990040" }}>
            <CardHeader className="pb-2" style={{ background: "linear-gradient(135deg, #e0990015, #fff78715)" }}>
              <CardTitle className="text-sm" style={{ color: "#b37700" }}>BGM 추천</CardTitle>
              <p className="text-[10px] text-muted-foreground">
                장면 분위기를 분석하여 로열티 프리 BGM을 추천합니다
              </p>
            </CardHeader>
            <CardContent className="space-y-3 pt-3">
              <Button
                size="sm"
                onClick={async () => {
                  setBgmLoading(true);
                  try {
                    const res = await fetch("/api/recommend-bgm", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        scenes: result.cuts.map((c) => ({
                          sceneDescription: c.sceneDescription,
                          moodLighting: c.moodLighting,
                        })),
                      }),
                    });
                    if (res.ok) setBgmResult(await res.json());
                  } catch { /* ignore */ }
                  setBgmLoading(false);
                }}
                disabled={bgmLoading}
                style={{ background: "#e09900", color: "white" }}
              >
                {bgmLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    분석 중...
                  </span>
                ) : bgmResult ? "다시 추천받기" : "BGM 추천받기"}
              </Button>

              {bgmResult && (
                <div className="space-y-3">
                  {bgmResult.mainBgm && (
                    <div className="p-3 rounded-lg" style={{ background: "#fff8e1", border: "1px solid #e0990020" }}>
                      <p className="text-xs font-semibold mb-1" style={{ color: "#b37700" }}>메인 BGM</p>
                      <div className="text-[11px] space-y-1">
                        <p>분위기: {bgmResult.mainBgm.mood}</p>
                        <p>장르: {bgmResult.mainBgm.genre} | 템포: {bgmResult.mainBgm.tempo}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {bgmResult.mainBgm.searchKeywords?.map((kw, i) => (
                            <Badge key={i} variant="outline" className="text-[9px]" style={{ borderColor: "#e0990040" }}>{kw}</Badge>
                          ))}
                        </div>
                        <p className="text-muted-foreground mt-1">추천: {bgmResult.mainBgm.suggestions?.join(", ")}</p>
                        <p className="text-[9px] text-muted-foreground">소스: {bgmResult.mainBgm.source}</p>
                      </div>
                    </div>
                  )}
                  {bgmResult.sceneBgm && bgmResult.sceneBgm.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold" style={{ color: "#b37700" }}>장면별 BGM</p>
                      {bgmResult.sceneBgm.map((sb, i) => (
                        <div key={i} className="p-2 rounded-lg text-[11px]" style={{ background: "#fefce8", border: "1px solid #e0990015" }}>
                          <span className="font-medium">{sb.forScenes}</span> — {sb.mood}
                          <br />
                          <span className="text-muted-foreground">추천: {sb.suggestion}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 나레이션 TTS */}
          <Card className="overflow-hidden border-2" style={{ borderColor: "#7c3aed40" }}>
            <CardHeader className="pb-2" style={{ background: "linear-gradient(135deg, #7c3aed15, #787fff10)" }}>
              <CardTitle className="text-sm" style={{ color: "#7c3aed" }}>나레이션 TTS</CardTitle>
              <p className="text-[10px] text-muted-foreground">
                시나리오 텍스트를 Google Cloud TTS로 음성 변환합니다
              </p>
            </CardHeader>
            <CardContent className="space-y-3 pt-3">
              <div className="flex gap-3 items-end">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">음성</label>
                  <select
                    value={ttsVoice}
                    onChange={(e) => setTtsVoice(e.target.value)}
                    className="block h-8 rounded-md border text-xs px-2"
                  >
                    <option value="ko-KR-Wavenet-A">여성 (Wavenet A)</option>
                    <option value="ko-KR-Wavenet-B">여성 (Wavenet B)</option>
                    <option value="ko-KR-Wavenet-C">남성 (Wavenet C)</option>
                    <option value="ko-KR-Wavenet-D">남성 (Wavenet D)</option>
                    <option value="ko-KR-Neural2-A">여성 (Neural2 A)</option>
                    <option value="ko-KR-Neural2-B">여성 (Neural2 B)</option>
                    <option value="ko-KR-Neural2-C">남성 (Neural2 C)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">속도 ({ttsRate}x)</label>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    value={ttsRate}
                    onChange={(e) => setTtsRate(parseFloat(e.target.value))}
                    className="w-24 h-1.5"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={async () => {
                    setTtsLoading(true);
                    try {
                      const narration = result.cuts.map((c) => c.sceneDescription).join("\n\n");
                      const res = await fetch("/api/tts", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          text: narration,
                          voiceName: ttsVoice,
                          speakingRate: ttsRate,
                        }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        if (data.audioBase64) {
                          const audioBlob = new Blob(
                            [Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0))],
                            { type: "audio/mp3" }
                          );
                          setTtsAudioUrl(URL.createObjectURL(audioBlob));
                        }
                      }
                    } catch { /* ignore */ }
                    setTtsLoading(false);
                  }}
                  disabled={ttsLoading}
                  style={{ background: "#7c3aed", color: "white" }}
                >
                  {ttsLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      생성 중...
                    </span>
                  ) : "음성 생성"}
                </Button>
              </div>

              {ttsAudioUrl && (
                <div className="space-y-2">
                  <audio controls src={ttsAudioUrl} className="w-full h-10" />
                  <a
                    href={ttsAudioUrl}
                    download={`narration-${Date.now()}.mp3`}
                    className="inline-block text-xs px-3 py-1 rounded-lg font-medium"
                    style={{ background: "#7c3aed15", color: "#7c3aed", border: "1px solid #7c3aed30" }}
                  >
                    MP3 다운로드
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 고도화 도구 → 영상 생성 탭에 통합됨 */}
    </div>
  );
}
