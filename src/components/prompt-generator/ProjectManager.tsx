"use client";

/**
 * ProjectManager — 프로젝트 드래프트 관리 UI
 *
 * Internal Owner-Only V0.9:
 * - 최근 드래프트 목록
 * - 새 프로젝트 시작
 * - 드래프트 저장/불러오기
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
  type DraftProject,
  type DraftGenerationMeta,
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
  /** Callbacks */
  onLoad: (input: PromptInput, output: PromptOutput | null, draftId: string, meta?: DraftGenerationMeta) => void;
  onNew: () => void;
  onSaved: (draftId: string) => void;
}

export default function ProjectManager({
  currentInput,
  currentOutput,
  currentMeta,
  activeDraftId,
  onLoad,
  onNew,
  onSaved,
}: Props) {
  const [drafts, setDrafts] = useState<DraftProject[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load draft list
  const refreshDrafts = useCallback(async () => {
    const list = await listDrafts();
    setDrafts(list);
  }, []);

  useEffect(() => {
    refreshDrafts();
  }, [refreshDrafts]);

  // ── Save ──
  const handleSave = useCallback(async () => {
    if (!currentInput) return;
    setSaving(true);
    try {
      const draft = buildDraft({
        id: activeDraftId || undefined,
        input: currentInput,
        output: currentOutput,
        generationMeta: currentMeta || undefined,
      });
      if (activeDraftId) {
        draft.id = activeDraftId;
        // Preserve original createdAt
        const existing = drafts.find(d => d.id === activeDraftId);
        if (existing) draft.createdAt = existing.createdAt;
      }
      draft.updatedAt = Date.now();
      await saveDraft(draft);
      onSaved(draft.id);
      await refreshDrafts();
    } finally {
      setSaving(false);
    }
  }, [currentInput, currentOutput, currentMeta, activeDraftId, drafts, onSaved, refreshDrafts]);

  // ── Load draft ──
  const handleLoad = useCallback(async (draft: DraftProject) => {
    onLoad(draft.input, draft.output, draft.id, draft.generationMeta);
    setShowPanel(false);
  }, [onLoad]);

  // ── Delete ──
  const handleDelete = useCallback(async (id: string) => {
    await deleteDraft(id);
    await refreshDrafts();
  }, [refreshDrafts]);

  // ── Export JSON ──
  const handleExport = useCallback(async (draft: DraftProject) => {
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
    // reset file input
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

  return (
    <div className="relative">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={() => setShowPanel(!showPanel)}
          className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors flex items-center gap-1.5"
        >
          <span className="text-[10px]">📁</span>
          <span className="max-w-[160px] truncate">{activeTitle}</span>
          <span className="text-zinc-500 text-[10px]">{showPanel ? "▲" : "▼"}</span>
        </button>

        <button
          onClick={handleSave}
          disabled={!currentInput || saving}
          className="px-3 py-1.5 rounded bg-blue-900/60 hover:bg-blue-800/60 text-blue-300 disabled:opacity-40 transition-colors"
        >
          {saving ? "저장 중..." : activeDraftId ? "저장" : "새로 저장"}
        </button>

        <button
          onClick={handleNew}
          className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
        >
          + 새 프로젝트
        </button>
      </div>

      {/* ── Panel Dropdown ── */}
      {showPanel && (
        <div className="absolute top-10 left-0 z-50 w-[400px] max-h-[500px] overflow-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl">
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
              샘플 프로젝트
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
                      <div className="text-zinc-200 truncate font-medium">{d.title}</div>
                      <div className="text-zinc-500 text-[10px]">
                        {d.cutCount ?? 0}컷 · {new Date(d.updatedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        {d.thumbnail && <span className="ml-1">· {d.thumbnail.slice(0, 30)}…</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleExport(d); }}
                        className="px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-400 text-[10px]"
                        title="JSON 내보내기"
                      >
                        ↓
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(d.id); }}
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
                  <div className="text-zinc-200 text-xs font-medium">{sample.title}</div>
                  <div className="text-zinc-500 text-[10px] mt-0.5">{sample.description}</div>
                  <div className="flex gap-1 mt-1">
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
