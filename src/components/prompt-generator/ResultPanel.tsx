"use client";

import { useState } from "react";
import { PromptOutput, Cut, GeneratorStatus } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import CutCard from "./CutCard";
import VideoGenerationPanel from "./VideoGenerationPanel";
import TimelineEditor from "./TimelineEditor";
import { useVideoGeneration } from "@/hooks/useVideoGeneration";

interface ResultPanelProps {
  result: PromptOutput | null;
  status: GeneratorStatus;
  error: string | null;
  onUpdateResult?: (updated: PromptOutput) => void;
}

export default function ResultPanel({
  result,
  status,
  error,
  onUpdateResult,
}: ResultPanelProps) {
  const [jsonCopied, setJsonCopied] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [activeSection, setActiveSection] = useState<"prompts" | "generate" | "timeline">("prompts");

  const videoGen = useVideoGeneration({
    cuts: result?.cuts ?? [],
    onSeedDetected: (cutNumber, seed) => {
      console.log(`CUT ${cutNumber} seed: ${seed}`);
    },
  });

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
            <p>2. 감독 스타일 적용 & 컷 분할</p>
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

  return (
    <div className="space-y-4">
      {/* 프로젝트 요약 */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3" style={{ background: "linear-gradient(135deg, #787fff15, #fff78725)" }}>
          <CardTitle className="text-lg" style={{ color: "#5a5ecc" }}>{result.projectTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm text-muted-foreground">
            {result.conceptSummary}
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge style={{ background: "#787fff", color: "white" }}>총 {result.totalCuts}컷</Badge>
            <Badge style={{ background: "#22c55e", color: "white" }}>Fast: {fastCuts.length}컷</Badge>
            <Badge style={{ background: "#e09900", color: "white" }}>Quality: {qualityCuts.length}컷</Badge>
            <Badge variant="outline" style={{ borderColor: "#787fff60" }}>
              총 {result.cuts.length * 8}초 ({Math.round((result.cuts.length * 8) / 60)}분)
            </Badge>
            <Badge variant="outline" style={{ borderColor: "#e09900" }}>
              캐릭터 {result.characterSeeds.length}명 시드 고정
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* 섹션 탭 */}
      <div className="flex gap-2 sticky top-0 z-10 bg-background py-2">
        {([
          { key: "prompts", label: "프롬프트", color: "#787fff" },
          { key: "generate", label: "영상 생성", color: "#22c55e" },
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
                  캐릭터 시드 (전 컷 고정)
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">
                  모든 컷의 프롬프트에 아래 캐릭터 외형 묘사가 동일하게 삽입됩니다.
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
                컷 리스트 (클릭하여 프롬프트 수정 가능)
              </h3>
            </div>
            {result.cuts.map((cut) => (
              <CutCard
                key={cut.cutNumber}
                cut={cut}
                characterSeeds={result.characterSeeds}
                onUpdate={handleCutUpdate}
              />
            ))}
          </div>

          {/* JSON 내보내기 */}
          <Card className="overflow-hidden">
            <CardContent className="space-y-3 pt-4">
              <p className="text-xs font-medium" style={{ color: "#787fff" }}>JSON 내보내기</p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={handleCopyJson} style={{ background: "#787fff", color: "white" }}>
                  {jsonCopied ? "복사됨!" : "JSON 복사"}
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownloadJson} style={{ borderColor: "#787fff60", color: "#787fff" }}>
                  JSON 다운로드
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowJson(!showJson)} style={{ borderColor: "#787fff60", color: "#787fff" }}>
                  {showJson ? "닫기" : "미리보기"}
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
        />
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
