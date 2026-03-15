"use client";

import { useState, useCallback } from "react";
import { PromptInput, PromptOutput, GeneratorStatus } from "@/types";
import { generatePrompt } from "@/lib/mock-generator";
import { saveProjectRecord } from "@/lib/analytics";
import { savePromptHistory } from "@/lib/prompt-history";
import PlanTab from "./PlanTab";
import BuildTab from "./BuildTab";
import GenerateTab from "./GenerateTab";
import LibraryTab from "./LibraryTab";
import ExtrasTab from "./ExtrasTab";
import RuntimeBudgetBar from "./RuntimeBudgetBar";
import type { ClipBudgetEntry } from "@/lib/runtime-budget";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type AppTab = "plan" | "build" | "generate" | "library" | "extras";
export type AppMode = "studio" | "batch";

const TAB_CONFIG: { key: AppTab; label: string; sublabel: string; icon: string }[] = [
  { key: "plan",     label: "Plan",     sublabel: "시퀀스 설계",  icon: "📐" },
  { key: "build",    label: "Build",    sublabel: "검증 & 미리보기", icon: "🔧" },
  { key: "generate", label: "Generate", sublabel: "생성 & 추적",  icon: "▶" },
  { key: "library",  label: "Library",  sublabel: "히스토리",     icon: "📁" },
  { key: "extras",   label: "Extras",   sublabel: "부가 도구",    icon: "⚙" },
];

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function AppShell() {
  const [activeTab, setActiveTab] = useState<AppTab>("plan");
  const [mode, setMode] = useState<AppMode>("studio");
  const [result, setResult] = useState<PromptOutput | null>(null);
  const [status, setStatus] = useState<GeneratorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<PromptInput | null>(null);
  const [secondsPerScene, setSecondsPerScene] = useState<number>(0);
  const [batchEntries, setBatchEntries] = useState<ClipBudgetEntry[]>([]);

  const handleGenerate = useCallback(async (input: PromptInput) => {
    setStatus("loading");
    setError(null);
    setLastInput(input);

    try {
      const output = await generatePrompt(input);
      setResult(output);
      setStatus("success");

      savePromptHistory(input, output);
      saveProjectRecord({
        title: output.projectTitle,
        directorStyle: input.directorPersona,
        directorName: output.projectTitle.split("의 시선")[0] || input.directorPersona,
        region: input.region,
        animationMode: input.animationMode,
        cutCount: output.totalCuts,
      });

      if (mode === "batch" && output.cuts.length > 0) {
        const entry: ClipBudgetEntry = {
          clipId: `clip-${Date.now()}`,
          label: output.projectTitle || "새 클립",
          shotCount: output.totalCuts,
          totalDurationSec: output.cuts.reduce((s, c) => s + c.durationSec, 0),
          priority: "normal",
        };
        setBatchEntries(prev => [...prev, entry]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "시퀀스 생성에 실패했습니다.");
      setStatus("error");
    }
  }, [mode]);

  const handleRestoreHistory = useCallback((input: PromptInput, output: PromptOutput) => {
    setLastInput(input);
    setResult(output);
    setStatus("success");
    setError(null);
    setActiveTab("plan");
  }, []);

  const handleAdvanceToBuild = useCallback(() => {
    setActiveTab("build");
  }, []);

  const handleAdvanceToGenerate = useCallback(() => {
    setActiveTab("generate");
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ── */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold tracking-tight" style={{ color: "#1a1a2e" }}>
                CineForge
              </h1>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#787fff20", color: "#787fff" }}>
                Kling O3
              </span>
              <span className="text-[10px] hidden md:inline" style={{ color: "#aaa" }}>
                Shortform Cinematic Production
              </span>
            </div>

            {/* ── Mode Toggle ── */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: "#f1f1f4" }}>
              <button
                onClick={() => setMode("studio")}
                className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                style={mode === "studio"
                  ? { background: "white", color: "#1a1a2e", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                  : { color: "#888" }
                }
              >
                Studio
              </button>
              <button
                onClick={() => setMode("batch")}
                className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                style={mode === "batch"
                  ? { background: "white", color: "#1a1a2e", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                  : { color: "#888" }
                }
              >
                Batch
              </button>
            </div>
          </div>

          {/* ── Tab Navigation ── */}
          <div className="flex gap-0.5 -mb-px">
            {TAB_CONFIG.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="px-4 py-2.5 text-sm font-medium transition-all border-b-2 flex items-center gap-1.5"
                style={activeTab === tab.key
                  ? { borderColor: "#787fff", color: "#1a1a2e" }
                  : { borderColor: "transparent", color: "#999" }
                }
              >
                <span className="text-xs">{tab.icon}</span>
                <span>{tab.label}</span>
                <span className="text-[10px] hidden sm:inline" style={{ color: activeTab === tab.key ? "#787fff" : "#bbb" }}>
                  {tab.sublabel}
                </span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Runtime Budget Bar (Batch Mode) ── */}
      {mode === "batch" && (
        <RuntimeBudgetBar entries={batchEntries} onUpdateEntries={setBatchEntries} />
      )}

      {/* ── Main Content ── */}
      <main className="flex-1">
        <div className="max-w-7xl mx-auto p-4 md:p-6">
          {activeTab === "plan" && (
            <PlanTab
              mode={mode}
              result={result}
              status={status}
              error={error}
              lastInput={lastInput}
              secondsPerScene={secondsPerScene}
              onSecondsPerSceneChange={setSecondsPerScene}
              onGenerate={handleGenerate}
              onUpdateResult={setResult}
              onAdvanceToBuild={handleAdvanceToBuild}
              batchEntries={batchEntries}
              onUpdateBatchEntries={setBatchEntries}
            />
          )}
          {activeTab === "build" && (
            <BuildTab
              mode={mode}
              result={result}
              lastInput={lastInput}
              secondsPerScene={secondsPerScene}
              onSecondsPerSceneChange={setSecondsPerScene}
              onUpdateResult={setResult}
              onAdvanceToGenerate={handleAdvanceToGenerate}
            />
          )}
          {activeTab === "generate" && (
            <GenerateTab
              mode={mode}
              result={result}
              lastInput={lastInput}
              secondsPerScene={secondsPerScene}
              onUpdateResult={setResult}
            />
          )}
          {activeTab === "library" && (
            <LibraryTab
              onRestoreHistory={handleRestoreHistory}
            />
          )}
          {activeTab === "extras" && (
            <ExtrasTab
              result={result}
              onUpdateResult={setResult}
              onUseAsScenario={(text) => {
                setLastInput(prev => prev ? { ...prev, storyText: text } : null);
                setActiveTab("plan");
              }}
            />
          )}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t py-3 text-center">
        <p className="text-xs" style={{ color: "#999" }}>
          CineForge — Kling O3 Shortform Cinematic Production System
        </p>
      </footer>
    </div>
  );
}
