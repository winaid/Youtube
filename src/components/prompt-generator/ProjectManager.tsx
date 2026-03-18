"use client";

/**
 * ProjectManager — 프로젝트 드래프트 관리 UI
 *
 * Internal Owner-Only V0.9:
 * - 저장 상태 명확 표시 (saved/saving/error/unsaved)
 * - 마지막 저장 시각
 * - unsaved changes 표시
 * - 최근 드래프트 목록 (수정순)
 * - JSON export/import
 * - 샘플 프로젝트 로더
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { PromptInput, PromptOutput } from "@/types";
import {
  listDrafts,
  saveDraft,
  deleteDraft,
  buildDraft,
  exportDraftJSON,
  importDraftJSON,
  isDraftStale,
  formatRelativeTime,
  type DraftProject,
  type DraftGenerationMeta,
  type SaveStatus,
} from "@/lib/draft-store";
import { SAMPLE_PROJECTS } from "@/data/sample-projects";

// ─── Props ───

interface Props {
  /** Current workspace state */
  currentInput: PromptInput | null;
  currentOutput: PromptOutput | null;
  currentMeta?: DraftGenerationMeta | null;
  /** Active draft ID (null = unsaved new project) */
  activeDraftId: string | null;
  /** External save status from parent (for Cmd+S feedback) */
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  hasUnsavedChanges: boolean;
  /** Callbacks */
  onLoad: (input: PromptInput, output: PromptOutput | null, draftId: string, meta?: DraftGenerationMeta) => void;
  onNew: () => void;
  onSave: () => void;
}

export default function ProjectManager({
  currentInput,
  currentOutput,
  currentMeta,
  activeDraftId,
  saveStatus,
  lastSavedAt,
  hasUnsavedChanges,
  onLoad,
  onNew,
  onSave,
}: Props) {
  const [drafts, setDrafts] = useState<DraftProject[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load draft list
  const refreshDrafts = useCallback(async () => {
    const list = await listDrafts();
    setDrafts(list);
  }, []);

  useEffect(() => {
    refreshDrafts();
  }, [refreshDrafts]);

  // Flash effect on save success
  useEffect(() => {
    if (saveStatus === "saved") {
      setSaveFlash(true);
      const t = setTimeout(() => setSaveFlash(false), 1500);
      return () => clearTimeout(t);
    }
  }, [saveStatus, lastSavedAt]);

  // Refresh drafts when save succeeds
  useEffect(() => {
    if (saveStatus === "saved") refreshDrafts();
  }, [saveStatus, refreshDrafts]);

  // Close panel on outside click
  useEffect(() => {
    if (!showPanel) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPanel]);

  // ── Load draft ──
  const handleLoad = useCallback(async (draft: DraftProject) => {
    onLoad(draft.input, draft.output, draft.id, draft.generationMeta);
    setShowPanel(false);
  }, [onLoad]);

  // ── Delete ──
  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteDraft(id);
    await refreshDrafts();
  }, [refreshDrafts]);

  // ── Export JSON ──
  const handleExport = useCallback(async (draft: DraftProject, e: React.MouseEvent) => {
    e.stopPropagation();
    const json = exportDraftJSON(draft);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.title.replace(/[^a-zA-Z0-9가-힣]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── Import JSON ──
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const draft = importDraftJSON(text);
      if (!draft) {
        alert("유효하지 않은 드래프트 파일입니다.");
        return;
      }
      await saveDraft(draft);
      onLoad(draft.input, draft.output, draft.id, draft.generationMeta);
      await refreshDrafts();
    } catch {
      alert("파일을 읽을 수 없습니다.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onLoad, refreshDrafts]);

  // ── Load sample ──
  const handleLoadSample = useCallback((sample: typeof SAMPLE_PROJECTS[0]) => {
    onLoad(sample.input, null, "", undefined);
    setShowSamples(false);
    setShowPanel(false);
  }, [onLoad]);

  // ── New project ──
  const handleNew = useCallback(() => {
    onNew();
    setShowPanel(false);
  }, [onNew]);

  const activeTitle = activeDraftId
    ? drafts.find(d => d.id === activeDraftId)?.title ?? "Untitled"
    : currentOutput?.projectTitle ?? "새 프로젝트";

  // Save button styling
  const saveButtonStyle = () => {
    if (saveStatus === "saving") return "bg-blue-900/60 text-blue-300 opacity-70";
    if (saveStatus === "error") return "bg-red-900/60 text-red-300";
    if (saveFlash) return "bg-green-900/60 text-green-300";
    if (hasUnsavedChanges) return "bg-amber-900/60 hover:bg-amber-800/60 text-amber-300";
    return "bg-blue-900/60 hover:bg-blue-800/60 text-blue-300";
  };

  const saveButtonLabel = () => {
    if (saveStatus === "saving") return "저장 중...";
    if (saveStatus === "error") return "저장 실패";
    if (saveFlash) return "저장됨 ✓";
    if (!activeDraftId) return "새로 저장";
    if (hasUnsavedChanges) return "저장 *";
    return "저장";
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 text-xs">
        {/* Project name button */}
        <button
          onClick={() => setShowPanel(!showPanel)}
          className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors flex items-center gap-1.5"
        >
          <span className="text-[10px]">📁</span>
          <span className="max-w-[160px] truncate">{activeTitle}</span>
          {hasUnsavedChanges && <span className="text-amber-400 text-[10px]">●</span>}
          <span className="text-zinc-500 text-[10px]">{showPanel ? "▲" : "▼"}</span>
        </button>

        {/* Save button */}
        <button
          onClick={onSave}
          disabled={!currentInput || saveStatus === "saving"}
          className={`px-3 py-1.5 rounded disabled:opacity-40 transition-all ${saveButtonStyle()}`}
        >
          {saveButtonLabel()}
        </button>

        {/* Last saved indicator */}
        {lastSavedAt && (
          <span className="text-zinc-500 text-[10px]" title={new Date(lastSavedAt).toLocaleString("ko-KR")}>
            {formatRelativeTime(lastSavedAt)}
          </span>
        )}

        <button
          onClick={handleNew}
          className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
        >
          + 새 프로젝트
        </button>
      </div>

      {/* ── Panel Dropdown ── */}
      {showPanel && (
        <div className="absolute top-10 left-0 z-50 w-[420px] max-h-[500px] overflow-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl">
          {/* Tabs: Drafts / Samples */}
          <div className="flex border-b border-zinc-700">
            <button
              onClick={() => setShowSamples(false)}
              className={`flex-1 px-3 py-2 text-xs transition-colors ${!showSamples ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-800/50"}`}
            >
              최근 드래프트 ({drafts.length})
            </button>
            <button
              onClick={() => setShowSamples(true)}
              className={`flex-1 px-3 py-2 text-xs transition-colors ${showSamples ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-800/50"}`}
            >
              검증 샘플 ({SAMPLE_PROJECTS.length})
            </button>
          </div>

          {!showSamples ? (
            <div className="p-2 space-y-1">
              {drafts.length === 0 ? (
                <div className="text-center text-zinc-500 text-xs py-6">
                  저장된 드래프트가 없습니다
                </div>
              ) : (
                drafts.map((d) => (
                  <div
                    key={d.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors text-xs ${
                      d.id === activeDraftId ? "bg-blue-900/30 border border-blue-700/50" : "hover:bg-zinc-800"
                    }`}
                    onClick={() => handleLoad(d)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-zinc-200 truncate font-medium">{d.title}</span>
                        {d.id === activeDraftId && <span className="text-blue-400 text-[10px]">현재</span>}
                        {isDraftStale(d) && <span className="text-zinc-600 text-[10px]">오래됨</span>}
                      </div>
                      <div className="text-zinc-500 text-[10px]">
                        {d.cutCount ?? 0}컷 · {formatRelativeTime(d.updatedAt)}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={(e) => handleExport(d, e)}
                        className="px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-400 text-[10px]"
                        title="JSON 내보내기"
                      >
                        ↓
                      </button>
                      <button
                        onClick={(e) => handleDelete(d.id, e)}
                        className="px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-red-900/60 text-zinc-400 hover:text-red-300 text-[10px]"
                        title="삭제"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}

              {/* Import button */}
              <div className="pt-1 border-t border-zinc-800">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs text-center transition-colors"
                >
                  JSON 파일 가져오기
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleImport}
                />
              </div>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {SAMPLE_PROJECTS.map((sample) => (
                <div
                  key={sample.id}
                  className="px-2 py-2 rounded hover:bg-zinc-800 cursor-pointer transition-colors"
                  onClick={() => handleLoadSample(sample)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-200 text-xs font-medium">{sample.title}</span>
                    {"verifyPoint" in sample && (
                      <span className="px-1 py-0.5 rounded bg-violet-900/40 text-violet-300 text-[9px]">검증</span>
                    )}
                  </div>
                  <div className="text-zinc-500 text-[10px] mt-0.5">{sample.description}</div>
                  {"verifyPoint" in sample && (
                    <div className="text-zinc-600 text-[10px] mt-0.5">
                      확인: {(sample as {verifyPoint: string}).verifyPoint}
                    </div>
                  )}
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {sample.tags.map(tag => (
                      <span key={tag} className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 text-[10px]">{tag}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
