"use client";

import { useState, useEffect } from "react";
import { PromptInput, PromptOutput } from "@/types";
import { getPromptHistory, deletePromptHistory, PromptHistoryEntry } from "@/lib/prompt-history";

interface Props {
  onRestore: (input: PromptInput, output: PromptOutput) => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  if (h < 24) return `${h}시간 전`;
  return `${d}일 전`;
}

export default function PromptHistoryPanel({ onRestore }: Props) {
  const [history, setHistory] = useState<PromptHistoryEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setHistory(getPromptHistory());
  }, []);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deletePromptHistory(id);
    setHistory((prev) => prev.filter((h) => h.id !== id));
  };

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-4xl mb-3">🎬</div>
        <p className="text-sm font-medium" style={{ color: "#666" }}>아직 생성한 프롬프트가 없습니다</p>
        <p className="text-xs mt-1" style={{ color: "#aaa" }}>시나리오를 분석하면 여기에 저장됩니다</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs" style={{ color: "#aaa" }}>최근 {history.length}개 · 클릭하면 프롬프트를 바로 복원합니다</p>

      {history.map((entry) => {
        const isOpen = expanded === entry.id;
        return (
          <div
            key={entry.id}
            className="rounded-xl border overflow-hidden transition-all"
            style={{ borderColor: isOpen ? "#787fff60" : "#e5e7eb", background: isOpen ? "#fafbff" : "white" }}
          >
            {/* 헤더 */}
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
              onClick={() => setExpanded(isOpen ? null : entry.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold truncate" style={{ color: "#222" }}>
                    {entry.output.projectTitle || "제목 없음"}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "#787fff15", color: "#787fff" }}>
                    {entry.output.totalCuts}장면
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "#f3f4f6", color: "#666" }}>
                    {entry.input.animationMode}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px]" style={{ color: "#aaa" }}>{timeAgo(entry.createdAt)}</span>
                  <span className="text-[10px]" style={{ color: "#bbb" }}>·</span>
                  <span className="text-[10px] truncate" style={{ color: "#999" }}>
                    {entry.output.conceptSummary?.slice(0, 50) || ""}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 ml-2 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore(entry.input, entry.output);
                  }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80"
                  style={{ background: "#787fff", color: "white" }}
                  title="이 프롬프트 불러오기"
                >
                  불러오기
                </button>
                <button
                  onClick={(e) => handleDelete(entry.id, e)}
                  className="px-2 py-1 rounded-lg text-[11px] transition-all hover:bg-red-50"
                  style={{ color: "#ccc" }}
                  title="삭제"
                >
                  ✕
                </button>
                <span style={{ color: "#ccc", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>

            {/* 장면 목록 펼치기 */}
            {isOpen && (
              <div className="border-t px-4 pb-4 pt-3 space-y-2" style={{ borderColor: "#787fff20" }}>
                <p className="text-[10px] font-semibold mb-2" style={{ color: "#787fff" }}>
                  장면 프롬프트 미리보기
                </p>
                {entry.output.cuts.map((cut) => (
                  <div
                    key={cut.cutNumber}
                    className="rounded-lg p-2.5"
                    style={{ background: "#f9fafb", border: "1px solid #f0f0f0" }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: "#787fff", color: "white" }}
                      >
                        CUT {cut.cutNumber}
                      </span>
                      <span className="text-[10px]" style={{ color: "#999" }}>{cut.durationSec}초</span>
                      <span className="text-[10px] truncate" style={{ color: "#666" }}>{cut.sceneDescription}</span>
                    </div>
                    <p className="text-[10px] leading-relaxed" style={{ color: "#444", fontFamily: "monospace" }}>
                      {cut.videoPrompt.slice(0, 120)}{cut.videoPrompt.length > 120 ? "..." : ""}
                    </p>
                  </div>
                ))}
                <button
                  onClick={() => onRestore(entry.input, entry.output)}
                  className="w-full mt-2 py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
                  style={{ background: "linear-gradient(135deg, #787fff, #5a5ecc)", color: "white" }}
                >
                  ✨ 이 프롬프트로 영상 바로 만들기
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
