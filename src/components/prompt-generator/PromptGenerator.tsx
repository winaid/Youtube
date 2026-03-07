"use client";

import { useState } from "react";
import { PromptInput, PromptOutput, GeneratorStatus } from "@/types";
import { generatePrompt } from "@/lib/mock-generator";
import InputPanel from "./InputPanel";
import ResultPanel from "./ResultPanel";

export default function PromptGenerator() {
  const [result, setResult] = useState<PromptOutput | null>(null);
  const [status, setStatus] = useState<GeneratorStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (input: PromptInput) => {
    setStatus("loading");
    setError(null);

    try {
      /**
       * TODO: 실제 API 연결 포인트
       * generatePrompt를 실제 API 호출로 교체하세요.
       * 예: const res = await fetch("/api/generate", { method: "POST", body: JSON.stringify(input) });
       */
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 w-full max-w-7xl mx-auto p-4 md:p-6">
      <div className="lg:sticky lg:top-6 lg:self-start">
        <InputPanel
          onGenerate={handleGenerate}
          isLoading={status === "loading"}
        />
      </div>
      <div className="min-w-0">
        <ResultPanel result={result} status={status} error={error} />
      </div>
    </div>
  );
}
