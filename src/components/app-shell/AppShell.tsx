"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { PromptInput, PromptOutput, GeneratorStatus } from "@/types";
import { generatePrompt } from "@/lib/mock-generator";
import { saveProjectRecord } from "@/lib/analytics";
import { savePromptHistory } from "@/lib/prompt-history";
import { recommendMode, type ModeRecommendation } from "@/lib/mode-recommendation";
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
  { key: "plan",     label: "Plan",     sublabel: "스크립트 → 세그먼트", icon: "📐" },
  { key: "build",    label: "Build",    sublabel: "검증 & 페이로드",     icon: "🔧" },
  { key: "generate", label: "Generate", sublabel: "생성 & 추적",        icon: "▶" },
  { key: "library",  label: "Library",  sublabel: "프로젝트 기록",       icon: "📁" },
  { key: "extras",   label: "Extras",   sublabel: "부가 도구",          icon: "⚙" },
];

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function AppShell() {
  const [activeTab, setActiveTab] = useState<AppTab>("plan");
  const [mode, setMode] = useState<AppMode>("studio");
  const [modeManuallySet, setModeManuallySet] = useState(false);
  const [showModeOverride, setShowModeOverride] = useState(false);
  const [result, setResult] = useState<PromptOutput | null>(null);
  const [status, setStatus] = useState<GeneratorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<PromptInput | null>(null);
  const [secondsPerScene, setSecondsPerScene] = useState<number>(0);
  const [batchEntries, setBatchEntries] = useState<ClipBudgetEntry[]>([]);
  const [targetRuntime, setTargetRuntime] = useState<number>(60);
  const [scriptText, setScriptText] = useState("");
  const [initialScript, setInitialScript] = useState<string | null>(null);
  const planScrollRef = useRef<number>(0);

  const modeRec = useMemo<ModeRecommendation>(() => {
    const charCount = scriptText.replace(/\s+/g, "").length;
    const estSegments = Math.max(1, Math.ceil(targetRuntime / 8));
    return recommendMode({
      scriptLength: charCount,
      targetRuntimeSec: targetRuntime,
      estimatedSegmentCount: estSegments,
      hasContinuationChaining: estSegments > 1,
    });
  }, [scriptText, targetRuntime]);

  useEffect(() => {
    if (!modeManuallySet) {
      setMode(modeRec.mode);
    }
  }, [modeRec.mode, modeManuallySet]);

  const handleModeSwitch = useCallback((newMode: AppMode) => {
    setMode(newMode);
    setModeManuallySet(true);
    setShowModeOverride(false);
  }, []);

  const projectBudgetEntries = useMemo<ClipBudgetEntry[]>(() => {
    if (!result) return batchEntries;
    const projectEntry: ClipBudgetEntry = {
      clipId: "current-project",
      label: result.projectTitle || "현재 프로젝트",
      shotCount: result.totalCuts,
      totalDurationSec: result.cuts.reduce((s, c) => s + c.durationSec, 0),
      priority: "high",
    };
    return [projectEntry, ...batchEntries.filter(e => e.clipId !== "current-project")];
  }, [result, batchEntries]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "프로젝트 생성에 실패했습니다.");
      setStatus("error");
    }
  }, []);

  const handleRestoreHistory = useCallback((input: PromptInput, output: PromptOutput) => {
    setLastInput(input);
    setResult(output);
    setStatus("success");
    setError(null);
    setActiveTab("plan");
  }, []);

  const handleAdvanceToBuild = useCallback(() => setActiveTab("build"), []);
  const handleAdvanceToGenerate = useCallback(() => setActiveTab("generate"), []);

  const handleUseAsScenario = useCallback((text: string) => {
    setInitialScript(text);
    setScriptText(text);
    setActiveTab("plan");
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  const handleInitialScriptConsumed = useCallback(() => {
    setInitialScript(null);
  }, []);

  const modeLabel = mode === "batch" ? "Batch" : "Studio";
  const modeDescription = mode === "batch"
    ? "대량 세그먼트 순차 생성"
    : "세그먼트별 정밀 편집";

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
                Script → Segments → Video Assembly
              </span>
            </div>

            {/* ── Mode: Recommendation-first, toggle-secondary ── */}
            <div className="flex items-center gap-2 relative">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: "#f8f9fa" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: mode === "batch" ? "#787fff" : "#22c55e" }} />
                <span className="text-[11px] font-medium" style={{ color: "#333" }}>{modeLabel}</span>
                <span className="text-[9px]" style={{ color: "#999" }}>{modeDescription}</span>
              </div>
              <button
                onClick={() => setShowModeOverride(!showModeOverride)}
                className="text-[10px] underline"
                style={{ color: "#999" }}
              >
                변경
              </button>

              {/* Override dropdown */}
              {showModeOverride && (
                <div
                  className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border bg-white shadow-lg p-3 space-y-2"
                >
                  <p className="text-[10px] font-medium" style={{ color: "#666" }}>
                    {modeManuallySet ? "수동 선택됨" : `추천: ${modeRec.mode === "batch" ? "Batch" : "Studio"}`}
                  </p>
                  {!modeManuallySet && (
                    <p className="text-[9px]" style={{ color: "#999" }}>{modeRec.reason}</p>
                  )}
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleModeSwitch("studio")}
                      className="flex-1 py-1.5 rounded text-xs font-medium border transition-colors"
                      style={mode === "studio"
                        ? { background: "#22c55e15", borderColor: "#22c55e", color: "#16a34a" }
                        : { borderColor: "#e5e7eb", color: "#888" }
                      }
                    >
                      Studio
                    </button>
                    <button
                      onClick={() => handleModeSwitch("batch")}
                      className="flex-1 py-1.5 rounded text-xs font-medium border transition-colors"
                      style={mode === "batch"
                        ? { background: "#787fff15", borderColor: "#787fff", color: "#787fff" }
                        : { borderColor: "#e5e7eb", color: "#888" }
                      }
                    >
                      Batch
                    </button>
                  </div>
                  {modeManuallySet && (
                    <button
                      onClick={() => { setModeManuallySet(false); setShowModeOverride(false); }}
                      className="text-[9px] underline w-full text-center"
                      style={{ color: "#999" }}
                    >
                      자동 추천으로 되돌리기
                    </button>
                  )}
                </div>
              )}
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

      {/* ── Runtime Budget Bar ── */}
      {projectBudgetEntries.length > 0 && (
        <RuntimeBudgetBar entries={projectBudgetEntries} onUpdateEntries={setBatchEntries} />
      )}

      {/* ── Click-away for mode override dropdown ── */}
      {showModeOverride && (
        <div className="fixed inset-0 z-40" onClick={() => setShowModeOverride(false)} />
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
              onScriptChange={setScriptText}
              onTargetRuntimeChange={setTargetRuntime}
              initialScript={initialScript}
              onInitialScriptConsumed={handleInitialScriptConsumed}
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
            <LibraryTab onRestoreHistory={handleRestoreHistory} />
          )}
          {activeTab === "extras" && (
            <ExtrasTab
              result={result}
              onUpdateResult={setResult}
              onUseAsScenario={handleUseAsScenario}
            />
          )}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t py-3 text-center">
        <p className="text-xs" style={{ color: "#999" }}>
          CineForge — Long Script → 3-15s Segments → Kling O3 Video Assembly · Up to 5 min
        </p>
      </footer>
    </div>
  );
}
