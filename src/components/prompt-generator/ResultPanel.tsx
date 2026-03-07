"use client";

import { useState } from "react";
import { PromptOutput, Cut, GeneratorStatus } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import CutCard from "./CutCard";

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
  const [videoStep, setVideoStep] = useState<"idle" | "preview" | "generating">("idle");

  // 아이들 상태
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

  // 로딩 상태
  if (status === "loading") {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent mx-auto mb-4" style={{ borderColor: "#787fff", borderTopColor: "transparent" }} />
          <p className="text-sm font-medium" style={{ color: "#787fff" }}>
            Gemini AI가 시나리오를 분석하고 컷을 생성하고 있습니다...
          </p>
        </CardContent>
      </Card>
    );
  }

  // 에러 상태
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

  // Veo 3.1 Quality vs Fast 분류
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
    continuityRules: result.continuityRules,
    totalDuration: `${result.cuts.length * 8}초 (${Math.round((result.cuts.length * 8) / 60)}분)`,
    cuts: result.cuts.map((cut) => ({
      cut: cut.cutNumber,
      duration: `${cut.durationSec}s`,
      veoMode: hasTextPattern.test(cut.videoPrompt + " " + cut.imagePrompt + " " + cut.sceneDescription)
        ? "quality"
        : "fast",
      scene: cut.sceneDescription,
      camera: cut.cameraDirection,
      lighting: cut.moodLighting,
      imagePrompt: cut.imagePrompt,
      videoPrompt: cut.videoPrompt,
      extendPrompt: cut.extendPrompt,
      transition: cut.transitionHint,
      characterConsistency: cut.characterConsistency,
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
            <Badge style={{ background: "#22c55e", color: "white" }}>
              Fast: {fastCuts.length}컷
            </Badge>
            <Badge style={{ background: "#e09900", color: "white" }}>
              Quality: {qualityCuts.length}컷
            </Badge>
            <Badge variant="outline" style={{ borderColor: "#787fff60" }}>
              총 {result.cuts.length * 8}초 ({Math.round((result.cuts.length * 8) / 60)}분)
            </Badge>
          </div>

          <Separator style={{ background: "linear-gradient(to right, #787fff40, #fff78740)" }} />

          <div className="space-y-1">
            <p className="text-xs font-medium" style={{ color: "#787fff" }}>
              Global Style Prompt
            </p>
            <p className="text-xs p-2 rounded-md font-mono break-all" style={{ background: "#787fff10" }}>
              {result.globalStylePrompt}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium" style={{ color: "#c4b800" }}>
              연속성 규칙
            </p>
            <ul className="text-xs space-y-0.5 list-disc list-inside text-muted-foreground">
              {result.continuityRules.map((rule, i) => (
                <li key={i}>{rule}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* 컷 리스트 (수정 가능) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium" style={{ color: "#787fff" }}>
            컷 리스트 (클릭하여 프롬프트 수정 가능)
          </h3>
        </div>
        {result.cuts.map((cut) => (
          <CutCard key={cut.cutNumber} cut={cut} onUpdate={handleCutUpdate} />
        ))}
      </div>

      {/* 워크플로우: JSON 변환 → 영상 만들기 */}
      <Card className="overflow-hidden border-2" style={{ borderColor: "#787fff40" }}>
        <CardHeader className="pb-3" style={{ background: "linear-gradient(135deg, #787fff20, #22c55e10)" }}>
          <CardTitle className="text-base" style={{ color: "#5a5ecc" }}>
            영상 제작 워크플로우
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            프롬프트 수정 완료 후 JSON으로 변환하고, Veo로 영상을 생성합니다
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {/* Step 1: JSON 변환 */}
          <div className="flex items-start gap-3">
            <div
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: "#787fff" }}
            >
              1
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium">프롬프트 수정 & JSON 변환</p>
              <p className="text-xs text-muted-foreground">
                위 컷들의 프롬프트를 수정한 후 JSON으로 내보내세요
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={handleCopyJson}
                  style={{ background: "#787fff", color: "white" }}
                >
                  {jsonCopied ? "복사됨!" : "JSON 복사"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadJson}
                  style={{ borderColor: "#787fff60", color: "#787fff" }}
                >
                  JSON 다운로드
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowJson(!showJson)}
                  style={{ borderColor: "#787fff60", color: "#787fff" }}
                >
                  {showJson ? "JSON 닫기" : "JSON 미리보기"}
                </Button>
              </div>
              {showJson && (
                <pre className="text-xs p-3 rounded-lg overflow-auto max-h-96 font-mono" style={{ background: "#1e1e2e", color: "#cdd6f4" }}>
                  {JSON.stringify(veoJson, null, 2)}
                </pre>
              )}
            </div>
          </div>

          <Separator style={{ background: "#787fff20" }} />

          {/* Step 2: 영상 만들기 */}
          <div className="flex items-start gap-3">
            <div
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: videoStep === "idle" ? "#aaa" : "#22c55e" }}
            >
              2
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium">Veo 영상 생성</p>
              <p className="text-xs text-muted-foreground">
                각 컷의 프롬프트를 Veo에 넣어 8초 클립을 생성합니다.
                글씨 포함 컷은 <span style={{ color: "#e09900", fontWeight: 600 }}>Quality</span> 모드,
                나머지는 <span style={{ color: "#22c55e", fontWeight: 600 }}>Fast</span> 모드를 사용합니다.
              </p>

              {videoStep === "idle" && (
                <Button
                  size="sm"
                  onClick={() => setVideoStep("preview")}
                  className="text-white"
                  style={{ background: "linear-gradient(135deg, #c4b800, #787fff)" }}
                >
                  영상 만들기 시작
                </Button>
              )}

              {videoStep === "preview" && (
                <div className="space-y-3 p-3 rounded-lg" style={{ background: "#787fff08", border: "1px solid #787fff20" }}>
                  <p className="text-xs font-medium" style={{ color: "#787fff" }}>
                    생성 계획
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {result.cuts.map((cut) => {
                      const isQuality = hasTextPattern.test(
                        cut.videoPrompt + " " + cut.imagePrompt + " " + cut.sceneDescription
                      );
                      return (
                        <div
                          key={cut.cutNumber}
                          className="flex items-center gap-2 p-2 rounded text-xs"
                          style={{ background: "white", border: "1px solid #eee" }}
                        >
                          <Badge
                            className="text-xs text-white flex-shrink-0"
                            style={{ background: isQuality ? "#e09900" : "#22c55e" }}
                          >
                            {isQuality ? "Quality" : "Fast"}
                          </Badge>
                          <span>CUT {cut.cutNumber}: {cut.sceneDescription.slice(0, 40)}...</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="p-2 rounded text-xs" style={{ background: "#fff78720" }}>
                    <p className="font-medium" style={{ color: "#7a7000" }}>Extend 전략 (2-3분 이야기 만들기)</p>
                    <ol className="list-decimal list-inside mt-1 space-y-0.5 text-muted-foreground">
                      <li>CUT 1의 Video Prompt로 첫 8초 클립 생성</li>
                      <li>CUT 2부터는 이전 클립 + Extend Prompt로 연장</li>
                      <li>각 클립의 마지막 프레임을 다음 클립의 참조 이미지로 사용</li>
                      <li>총 {result.cuts.length}개 클립 = {result.cuts.length * 8}초 ({Math.round((result.cuts.length * 8) / 60)}분) 완성</li>
                    </ol>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => setVideoStep("generating")}
                      className="text-white"
                      style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
                    >
                      확인 — Veo로 생성 시작
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setVideoStep("idle")}
                    >
                      취소
                    </Button>
                  </div>
                </div>
              )}

              {videoStep === "generating" && (
                <div className="space-y-3 p-3 rounded-lg" style={{ background: "#22c55e08", border: "1px solid #22c55e30" }}>
                  <div className="space-y-2">
                    {result.cuts.map((cut) => {
                      const isQuality = hasTextPattern.test(
                        cut.videoPrompt + " " + cut.imagePrompt + " " + cut.sceneDescription
                      );
                      return (
                        <div
                          key={cut.cutNumber}
                          className="flex items-center gap-3 p-2 rounded text-xs"
                          style={{ background: "white", border: "1px solid #eee" }}
                        >
                          <Badge
                            className="text-xs text-white flex-shrink-0"
                            style={{ background: isQuality ? "#e09900" : "#22c55e" }}
                          >
                            {isQuality ? "3.1 Quality" : "3.1 Fast"}
                          </Badge>
                          <span className="flex-1">CUT {cut.cutNumber}</span>
                          <span className="text-muted-foreground">
                            {cut.cutNumber === 1 ? "Video Prompt 사용" : "Extend Prompt 사용"}
                          </span>
                          <Badge variant="outline" className="text-xs" style={{ borderColor: "#c4b800" }}>
                            대기중
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Veo API 연동 준비 완료. 위 JSON을 복사하여 Veo에서 순서대로 생성하세요.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setVideoStep("idle")}
                  >
                    닫기
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
