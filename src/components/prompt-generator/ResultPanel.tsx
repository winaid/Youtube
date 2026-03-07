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

      {/* 캐릭터 시드 패널 */}
      {result.characterSeeds.length > 0 && (
        <Card className="overflow-hidden border-2" style={{ borderColor: "#e0990040" }}>
          <CardHeader className="pb-2" style={{ background: "linear-gradient(135deg, #e0990015, #fff78715)" }}>
            <CardTitle className="text-sm" style={{ color: "#b37700" }}>
              캐릭터 시드 (전 컷 고정)
            </CardTitle>
            <p className="text-[10px] text-muted-foreground">
              모든 컷의 프롬프트에 아래 캐릭터 외형 묘사가 동일하게 삽입됩니다. 외형이 바뀌면 안 됩니다.
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
              <p className="text-xs font-medium" style={{ color: "#5a5ecc" }}>감독 페르소나 (모든 프롬프트에 반영됨)</p>
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

      {/* 영상 제작 워크플로우 */}
      <Card className="overflow-hidden border-2" style={{ borderColor: "#787fff40" }}>
        <CardHeader className="pb-3" style={{ background: "linear-gradient(135deg, #787fff20, #22c55e10)" }}>
          <CardTitle className="text-base" style={{ color: "#5a5ecc" }}>
            영상 제작 워크플로우
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {/* Step 1: JSON */}
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#787fff" }}>
              1
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium">프롬프트 확인 & JSON 변환</p>
              <p className="text-xs text-muted-foreground">
                캐릭터 시드, 감독 스타일, Extend 전략이 포함된 JSON을 내보냅니다
              </p>
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
            </div>
          </div>

          <Separator style={{ background: "#787fff20" }} />

          {/* Step 2: Extend 전략 */}
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: videoStep === "idle" ? "#aaa" : "#22c55e" }}>
              2
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium">Veo 영상 생성 (Extend 전략)</p>
              <p className="text-xs text-muted-foreground">
                CUT 1: Video Prompt로 첫 8초 생성 → CUT 2~: 이전 클립 + Extend Prompt로 연장
              </p>

              {videoStep === "idle" && (
                <Button
                  size="sm"
                  onClick={() => setVideoStep("preview")}
                  className="text-white"
                  style={{ background: "linear-gradient(135deg, #c4b800, #787fff)" }}
                >
                  영상 제작 계획 보기
                </Button>
              )}

              {videoStep === "preview" && (
                <div className="space-y-3 p-3 rounded-lg" style={{ background: "#787fff08", border: "1px solid #787fff20" }}>
                  {/* Extend 파이프라인 시각화 */}
                  <div className="space-y-1.5">
                    {result.cuts.map((cut, i) => {
                      const isQuality = hasTextPattern.test(
                        cut.videoPrompt + " " + cut.imagePrompt + " " + cut.sceneDescription
                      );
                      const charsInScene = result.characterSeeds
                        .filter((s) => cut.charactersInScene?.includes(s.id))
                        .map((s) => s.label);

                      return (
                        <div key={cut.cutNumber}>
                          <div className="flex items-center gap-2 p-2 rounded text-xs" style={{ background: "white", border: "1px solid #eee" }}>
                            <Badge className="text-[10px] text-white flex-shrink-0" style={{ background: isQuality ? "#e09900" : "#22c55e" }}>
                              {isQuality ? "Quality" : "Fast"}
                            </Badge>
                            <span className="font-medium flex-shrink-0">CUT {cut.cutNumber}</span>
                            <Badge variant="outline" className="text-[10px] flex-shrink-0" style={{
                              borderColor: cut.cutNumber === 1 ? "#787fff" : "#6b5ce7",
                              color: cut.cutNumber === 1 ? "#787fff" : "#6b5ce7",
                            }}>
                              {cut.cutNumber === 1 ? "Video Prompt" : "Extend"}
                            </Badge>
                            {charsInScene.length > 0 && (
                              <span className="text-[10px] text-muted-foreground truncate">
                                [{charsInScene.join(", ")}]
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground truncate ml-auto">
                              {cut.sceneDescription.slice(0, 30)}...
                            </span>
                          </div>
                          {i < result.cuts.length - 1 && (
                            <div className="flex items-center gap-1 py-0.5 pl-6">
                              <div className="w-px h-3" style={{ background: "#787fff40" }} />
                              <span className="text-[9px] text-muted-foreground">{cut.transitionHint}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="p-2 rounded text-xs" style={{ background: "#fff78720" }}>
                    <p className="font-medium" style={{ color: "#7a7000" }}>캐릭터 일관성 보장 방법</p>
                    <ol className="list-decimal list-inside mt-1 space-y-0.5 text-muted-foreground">
                      <li>캐릭터 시드 {result.characterSeeds.length}명의 외형이 모든 프롬프트에 동일하게 삽입됨</li>
                      <li>Extend 시 이전 클립의 마지막 프레임을 참조 이미지로 사용</li>
                      <li>캐릭터 묘사를 &quot;same as before&quot; 대신 전체 외형을 매번 반복</li>
                      <li>의상, 헤어, 체형, 피부톤이 컷 간에 절대 변하지 않음</li>
                    </ol>
                  </div>

                  <div className="p-2 rounded text-xs" style={{ background: "#787fff10" }}>
                    <p className="font-medium" style={{ color: "#5a5ecc" }}>Veo 생성 순서</p>
                    <ol className="list-decimal list-inside mt-1 space-y-0.5 text-muted-foreground">
                      <li>CUT 1의 <strong>Video Prompt</strong>로 첫 8초 클립 생성</li>
                      <li>CUT 1 클립의 <strong>마지막 프레임 캡처</strong> → 참조 이미지로 사용</li>
                      <li>CUT 2의 <strong>Extend Prompt</strong> + 참조 이미지로 다음 8초 연장</li>
                      <li>반복: 총 {result.cuts.length}개 클립 = <strong>{result.cuts.length * 8}초 ({Math.round((result.cuts.length * 8) / 60)}분)</strong></li>
                    </ol>
                  </div>

                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setVideoStep("generating")} className="text-white" style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}>
                      확인 - 생성 시작
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setVideoStep("idle")}>
                      닫기
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
                        <div key={cut.cutNumber} className="flex items-center gap-3 p-2 rounded text-xs" style={{ background: "white", border: "1px solid #eee" }}>
                          <Badge className="text-[10px] text-white flex-shrink-0" style={{ background: isQuality ? "#e09900" : "#22c55e" }}>
                            {isQuality ? "3.1 Quality" : "3.1 Fast"}
                          </Badge>
                          <span className="flex-1 font-medium">CUT {cut.cutNumber}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {cut.cutNumber === 1 ? "Video Prompt 사용" : "이전 클립 + Extend Prompt"}
                          </span>
                          <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#c4b800" }}>
                            대기중
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    위 JSON을 Veo에서 순서대로 생성하세요. CUT 1은 Video Prompt, CUT 2~부터는 이전 클립 마지막 프레임 + Extend Prompt를 사용합니다.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setVideoStep("idle")}>
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
