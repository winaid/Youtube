"use client";

import { useState, useCallback } from "react";
import { PromptInput, PromptOutput, GeneratorStatus } from "@/types";
import { generatePrompt } from "@/lib/mock-generator";
import InputPanel from "./InputPanel";
import ResultPanel from "./ResultPanel";
import StoryChat from "./StoryChat";

export default function PromptGenerator() {
  const [result, setResult] = useState<PromptOutput | null>(null);
  const [status, setStatus] = useState<GeneratorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"prompt" | "story">("prompt");
  const [prefillScenario, setPrefillScenario] = useState<string>("");

  const handleGenerate = async (input: PromptInput) => {
    setStatus("loading");
    setError(null);

    try {
      const output = await generatePrompt(input);
      setResult(output);
      setStatus("success");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "프롬프트 생성에 실패했습니다."
      );
      setStatus("error");
    }
  };

  // 시나리오 → 장면 프롬프트 탭으로 이동 + 시나리오 텍스트 프리필
  const handleUseAsScenario = useCallback((scenarioText: string) => {
    setPrefillScenario(scenarioText);
    setActiveTab("prompt");
  }, []);

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6 space-y-4">
      {/* 탭 전환 */}
      <div className="flex gap-2">
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
      </div>

      {activeTab === "prompt" ? (
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          <div className="lg:sticky lg:top-6 lg:self-start">
            <InputPanel
              onGenerate={handleGenerate}
              isLoading={status === "loading"}
              prefillScenario={prefillScenario}
              onPrefillConsumed={() => setPrefillScenario("")}
            />
          </div>
          <div className="min-w-0">
            <ResultPanel result={result} status={status} error={error} onUpdateResult={setResult} />
          </div>
        </div>
      ) : (
        <StoryChat onUseAsScenario={handleUseAsScenario} />
      )}
    </div>
  );
}
