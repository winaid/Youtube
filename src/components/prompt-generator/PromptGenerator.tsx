"use client";

import { useState, useCallback } from "react";
import { PromptInput, PromptOutput, GeneratorStatus } from "@/types";
import { DURATION_FALLBACK } from "@/lib/duration-reconciliation";
import { generatePrompt } from "@/lib/mock-generator";
import { saveProjectRecord } from "@/lib/analytics";
import { savePromptHistory } from "@/lib/prompt-history";
import InputPanel from "./InputPanel";
import ResultPanel from "./ResultPanel";
import StoryChat from "./StoryChat";
import PromptHistoryPanel from "./PromptHistoryPanel";
import VideoHistoryPanel from "./VideoHistoryPanel";
import MyVideosPanel from "./MyVideosPanel";
import NodeCanvas from "./NodeCanvas";
import type { VideoOutputMeta } from "@/lib/node-execution";

export default function PromptGenerator() {
  const [result, setResult] = useState<PromptOutput | null>(null);
  const [status, setStatus] = useState<GeneratorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"prompt" | "story" | "canvas" | "history" | "videos">("prompt");
  const [canvasOutputs, setCanvasOutputs] = useState<Array<{ videoUrl: string; meta: VideoOutputMeta }>>([]);
  const [prefillScenario, setPrefillScenario] = useState<string>("");
  const [lastInput, setLastInput] = useState<PromptInput | null>(null);
  const [secondsPerScene, setSecondsPerScene] = useState<number>(0); // 0 = 자동

  const handleGenerate = async (input: PromptInput) => {
    setStatus("loading");
    setError(null);
    setLastInput(input);

    try {
      const output = await generatePrompt(input);
      setResult(output);
      setStatus("success");

      // 프롬프트 히스토리 저장 (input + output 전체)
      savePromptHistory(input, output);

      // 프로젝트 기록 저장 (성과 대시보드용 메타데이터)
      saveProjectRecord({
        title: output.projectTitle,
        directorStyle: input.directorPersona,
        directorName: output.projectTitle.split("의 시선")[0] || input.directorPersona,
        region: input.region,
        animationMode: input.animationMode,
        cutCount: output.totalCuts,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "프롬프트 생성에 실패했습니다.");
      setStatus("error");
    }
  };

  const handleCanvasExport = useCallback((output: PromptOutput) => {
    setResult(output);
    setStatus("success");
    setError(null);
    setActiveTab("prompt");
  }, []);

  const handleCanvasMerge = useCallback((output: PromptOutput, _mergedCutNumbers: number[]) => {
    setResult(output);
    setStatus("success");
    setError(null);
    setActiveTab("prompt");
  }, []);

  const handleUseAsScenario = useCallback((scenarioText: string) => {
    setPrefillScenario(scenarioText);
    setActiveTab("prompt");
  }, []);

  // 히스토리에서 불러오기 → 분석 없이 바로 결과 복원
  const handleRestoreHistory = useCallback((input: PromptInput, output: PromptOutput) => {
    setLastInput(input);
    setResult(output);
    setStatus("success");
    setError(null);
    setActiveTab("prompt");
  }, []);

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6 space-y-4">
      {/* 탭 전환 */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveTab("prompt")}
          className="px-4 py-2 rounded-full text-sm font-medium transition-all"
          style={
            activeTab === "prompt"
              ? { background: "#787fff", color: "white", boxShadow: "0 2px 8px #787fff40" }
              : { background: "#787fff15", color: "#787fff" }
          }
        >
          장면 프롬프트 생성
        </button>
        <button
          onClick={() => setActiveTab("story")}
          className="px-4 py-2 rounded-full text-sm font-medium transition-all"
          style={
            activeTab === "story"
              ? { background: "linear-gradient(135deg, #c4b800, #787fff)", color: "white", boxShadow: "0 2px 8px #fff78740" }
              : { background: "#fff78725", color: "#7a7000" }
          }
        >
          시나리오 AI 생성
        </button>
        <button
          onClick={() => setActiveTab("canvas")}
          className="px-4 py-2 rounded-full text-sm font-medium transition-all"
          style={
            activeTab === "canvas"
              ? { background: "linear-gradient(135deg, #8b5cf6, #3b82f6)", color: "white", boxShadow: "0 2px 8px #8b5cf640" }
              : { background: "#8b5cf615", color: "#8b5cf6" }
          }
        >
          노드 캔버스
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className="px-4 py-2 rounded-full text-sm font-medium transition-all"
          style={
            activeTab === "history"
              ? { background: "#f97316", color: "white", boxShadow: "0 2px 8px #f9731640" }
              : { background: "#f9731615", color: "#ea580c" }
          }
        >
          프롬프트 히스토리
        </button>
        <button
          onClick={() => setActiveTab("videos")}
          className="px-4 py-2 rounded-full text-sm font-medium transition-all"
          style={
            activeTab === "videos"
              ? { background: "#22c55e", color: "white", boxShadow: "0 2px 8px #22c55e40" }
              : { background: "#22c55e15", color: "#16a34a" }
          }
        >
          생성한 영상 히스토리
        </button>
      </div>

      {activeTab === "prompt" ? (
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          <div className="lg:sticky lg:top-6 lg:self-start">
            <InputPanel
              onGenerate={handleGenerate}
              isLoading={status === "loading"}
              prefillScenario={prefillScenario}
              onPrefillConsumed={() => setPrefillScenario("")}
              secondsPerScene={secondsPerScene}
              onSecondsPerSceneChange={setSecondsPerScene}
            />
          </div>
          <div className="min-w-0">
            <ResultPanel result={result} status={status} error={error} onUpdateResult={setResult} storyText={lastInput?.storyText} directorName={lastInput?.directorPersona} region={lastInput?.region} animationMode={lastInput?.animationMode} secondsPerScene={secondsPerScene} onSecondsPerSceneChange={setSecondsPerScene} />
          </div>
        </div>
      ) : activeTab === "canvas" ? (
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-semibold" style={{ color: "#222" }}>노드 캔버스</h2>
            <p className="text-xs mt-0.5" style={{ color: "#999" }}>
              Generate Image → Generate Video → Viewer 노드를 연결하여 워크플로우를 구성하세요.
              {canvasOutputs.length > 0 && (
                <span className="ml-1" style={{ color: "#22c55e" }}>
                  · {canvasOutputs.length}개 비디오가 타임라인에 추가됨
                </span>
              )}
            </p>
          </div>
          <NodeCanvas
            onSendToTimeline={(videoUrl, meta) => {
              setCanvasOutputs(prev => [...prev, { videoUrl, meta }]);
            }}
            importableOutput={result}
            onExportToEditor={handleCanvasExport}
            onMergeToEditor={handleCanvasMerge}
          />
        </div>
      ) : activeTab === "story" ? (
        <StoryChat onUseAsScenario={handleUseAsScenario} />
      ) : activeTab === "history" ? (
        <div className="max-w-2xl mx-auto">
          <div className="mb-4">
            <h2 className="text-base font-semibold" style={{ color: "#222" }}>프롬프트 히스토리</h2>
            <p className="text-xs mt-0.5" style={{ color: "#999" }}>
              이전에 분석한 프롬프트를 불러와 바로 영상 생성에 사용하세요. 재분석 없이 즉시 복원됩니다.
            </p>
          </div>
          <PromptHistoryPanel onRestore={handleRestoreHistory} />
        </div>
      ) : (
        /* 내 영상 + 세션 히스토리 */
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <div className="mb-4">
              <h2 className="text-base font-semibold" style={{ color: "#222" }}>내 영상</h2>
              <p className="text-xs mt-0.5" style={{ color: "#999" }}>
                생성 완료된 영상이 자동으로 기록됩니다. 개별 컷 단위로 조회·재생할 수 있습니다.
              </p>
            </div>
            <MyVideosPanel />
          </div>
          <div>
            <div className="mb-4">
              <h2 className="text-base font-semibold" style={{ color: "#222" }}>세션 히스토리</h2>
              <p className="text-xs mt-0.5" style={{ color: "#999" }}>
                현재/이전 세션에서 생성한 영상을 묶어서 확인할 수 있습니다.
              </p>
            </div>
            <VideoHistoryPanel />
          </div>
        </div>
      )}
    </div>
  );
}
