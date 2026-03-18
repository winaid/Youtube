"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { PromptInput, PromptOutput, GeneratorStatus } from "@/types";
import { generatePrompt } from "@/lib/mock-generator";
import { saveProjectRecord } from "@/lib/analytics";
import { savePromptHistory } from "@/lib/prompt-history";
import { saveDraft, buildDraft, type DraftGenerationMeta, type SaveStatus } from "@/lib/draft-store";
import InputPanel from "./InputPanel";
import ResultPanel from "./ResultPanel";
import StoryChat from "./StoryChat";
import ProjectManager from "./ProjectManager";
import QualityDebugPanel from "./QualityDebugPanel";
import OwnerChecklist from "./OwnerChecklist";

export default function PromptGenerator() {
  const [result, setResult] = useState<PromptOutput | null>(null);
  const [status, setStatus] = useState<GeneratorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"prompt" | "story">("prompt");
  const [prefillScenario, setPrefillScenario] = useState<string>("");
  const [lastInput, setLastInput] = useState<PromptInput | null>(null);
  const [secondsPerScene, setSecondsPerScene] = useState<number>(0);

  // ── Draft state ──
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [generationMeta, setGenerationMeta] = useState<DraftGenerationMeta | null>(null);
  const [prefillInput, setPrefillInput] = useState<PromptInput | null>(null);

  // ── Save status tracking ──
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Track changes after last save
  const lastSavedSnapshotRef = useRef<string>("");

  // Update unsaved indicator when input/result changes
  useEffect(() => {
    if (!lastInput) {
      setHasUnsavedChanges(false);
      return;
    }
    const snapshot = JSON.stringify({ input: lastInput, totalCuts: result?.totalCuts });
    if (lastSavedSnapshotRef.current && snapshot !== lastSavedSnapshotRef.current) {
      setHasUnsavedChanges(true);
    }
  }, [lastInput, result]);

  // ── Centralized save function ──
  const performSave = useCallback(async () => {
    if (!lastInput) return;
    setSaveStatus("saving");
    try {
      const draft = buildDraft({
        id: activeDraftId || undefined,
        input: lastInput,
        output: result,
        generationMeta: generationMeta || undefined,
      });
      if (activeDraftId) draft.id = activeDraftId;
      draft.updatedAt = Date.now();

      const success = await saveDraft(draft);
      if (success) {
        if (!activeDraftId) setActiveDraftId(draft.id);
        setLastSavedAt(Date.now());
        setSaveStatus("saved");
        setHasUnsavedChanges(false);
        lastSavedSnapshotRef.current = JSON.stringify({ input: lastInput, totalCuts: result?.totalCuts });
        // Reset to idle after flash
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [lastInput, result, activeDraftId, generationMeta]);

  // ── Generation ──
  const handleGenerate = async (input: PromptInput) => {
    setStatus("loading");
    setError(null);
    setLastInput(input);

    try {
      const output = await generatePrompt(input);
      setResult(output);
      setStatus("success");

      // Build generation meta for debug panel
      const totalDur = output.cuts.reduce((s, c) => s + c.durationSec, 0);
      const meta: DraftGenerationMeta = {
        totalDurationSec: totalDur,
        targetCuts: output.totalCuts,
        reconciledSecPerCut: output.totalCuts > 0 ? +(totalDur / output.totalCuts).toFixed(1) : 0,
        shotCount: output.cuts.reduce((s, c) => s + (c.multiShot?.length || 1), 0),
        usedFallback: output.usedFallback,
        degraded: output.degraded,
        degradedReason: output.degradedReason,
        sequenceValidationErrors: output.sequenceValidation?.summary?.errors,
        sequenceValidationWarnings: output.sequenceValidation?.summary?.warnings,
        directorRequested: input.directorPersona,
      };
      setGenerationMeta(meta);

      // 프롬프트 히스토리 저장
      savePromptHistory(input, output);

      // 프로젝트 기록 저장
      saveProjectRecord({
        title: output.projectTitle,
        directorStyle: input.directorPersona,
        directorName: output.projectTitle.split("의 시선")[0] || input.directorPersona,
        region: input.region,
        animationMode: input.animationMode,
        cutCount: output.totalCuts,
      });

      // Auto-save draft after generation
      const draft = buildDraft({
        id: activeDraftId || undefined,
        input,
        output,
        generationMeta: meta,
      });
      if (activeDraftId) {
        draft.id = activeDraftId;
      }
      draft.updatedAt = Date.now();
      const saved = await saveDraft(draft);
      if (saved) {
        if (!activeDraftId) setActiveDraftId(draft.id);
        setLastSavedAt(Date.now());
        setHasUnsavedChanges(false);
        lastSavedSnapshotRef.current = JSON.stringify({ input, totalCuts: output.totalCuts });
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "프롬프트 생성에 실패했습니다.");
      setStatus("error");
    }
  };

  // ── Story chat → scenario ──
  const handleUseAsScenario = useCallback((scenarioText: string) => {
    setPrefillScenario(scenarioText);
    setActiveTab("prompt");
  }, []);

  // ── Draft load ──
  const handleDraftLoad = useCallback((input: PromptInput, output: PromptOutput | null, draftId: string, meta?: DraftGenerationMeta) => {
    setPrefillInput(input);
    setLastInput(input);
    if (output) {
      setResult(output);
      setStatus("success");
    } else {
      setResult(null);
      setStatus("idle");
    }
    setGenerationMeta(meta || null);
    setActiveDraftId(draftId || null);
    setError(null);
    setActiveTab("prompt");
    setHasUnsavedChanges(false);
    setSaveStatus("idle");
    if (draftId) {
      setLastSavedAt(Date.now());
      lastSavedSnapshotRef.current = JSON.stringify({ input, totalCuts: output?.totalCuts });
    } else {
      setLastSavedAt(null);
      lastSavedSnapshotRef.current = "";
    }
  }, []);

  // ── New project ──
  const handleNewProject = useCallback(() => {
    setResult(null);
    setLastInput(null);
    setStatus("idle");
    setError(null);
    setActiveDraftId(null);
    setGenerationMeta(null);
    setPrefillInput(null);
    setPrefillScenario("");
    setSecondsPerScene(0);
    setHasUnsavedChanges(false);
    setSaveStatus("idle");
    setLastSavedAt(null);
    lastSavedSnapshotRef.current = "";
  }, []);

  // ── Keyboard shortcut: Cmd+S ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        performSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [performSave]);

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6 space-y-4">
      {/* ── Header: Project Manager + Tabs ── */}
      <div className="flex items-center gap-4 flex-wrap">
        <ProjectManager
          currentInput={lastInput}
          currentOutput={result}
          currentMeta={generationMeta}
          activeDraftId={activeDraftId}
          saveStatus={saveStatus}
          lastSavedAt={lastSavedAt}
          hasUnsavedChanges={hasUnsavedChanges}
          onLoad={handleDraftLoad}
          onNew={handleNewProject}
          onSave={performSave}
        />

        <div className="flex gap-2 ml-auto">
          <button
            onClick={() => setActiveTab("prompt")}
            className="px-4 py-2 rounded-full text-sm font-medium transition-all"
            style={
              activeTab === "prompt"
                ? { background: "#787fff", color: "white", boxShadow: "0 2px 8px #787fff40" }
                : { background: "#787fff15", color: "#787fff" }
            }
          >
            장면 설계 & 영상 생성
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
      </div>

      {activeTab === "prompt" ? (
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          <div className="lg:sticky lg:top-6 lg:self-start space-y-3">
            <InputPanel
              onGenerate={handleGenerate}
              isLoading={status === "loading"}
              prefillScenario={prefillScenario}
              onPrefillConsumed={() => setPrefillScenario("")}
              prefillInput={prefillInput}
              onPrefillInputConsumed={() => setPrefillInput(null)}
              secondsPerScene={secondsPerScene}
              onSecondsPerSceneChange={setSecondsPerScene}
              hasResult={result !== null}
            />
          </div>
          <div className="min-w-0 space-y-3">
            <ResultPanel
              result={result}
              status={status}
              error={error}
              onUpdateResult={setResult}
              storyText={lastInput?.storyText}
              directorName={lastInput?.directorPersona}
              region={lastInput?.region}
              animationMode={lastInput?.animationMode}
              secondsPerScene={secondsPerScene}
              onSecondsPerSceneChange={setSecondsPerScene}
            />
            {/* Quality Debug Panel — 결과 아래에 표시 */}
            <QualityDebugPanel output={result} meta={generationMeta} />
            {/* Owner Verification Checklist */}
            <OwnerChecklist />
          </div>
        </div>
      ) : activeTab === "story" ? (
        <StoryChat onUseAsScenario={handleUseAsScenario} />
      ) : null}
    </div>
  );
}
