"use client";

/**
 * SessionNotePanel — 오너 테스트 세션 기록 패널
 *
 * 생성 결과마다 짧은 메모와 실패 유형 태그를 남긴다.
 * 하루 10~20개 시나리오를 돌릴 때 빠른 분류/기록용.
 */

import { useState, useCallback, useEffect } from "react";
import {
  type FailureTag,
  type OwnerSessionNote,
  type SessionLogEntry,
  FAILURE_TAG_LABELS,
  appendSessionLog,
  loadSessionLog,
  clearSessionLog,
  sessionLogStats,
} from "@/lib/draft-store";

interface Props {
  draftId: string | null;
  scenario: string;
  fallbackUsed: boolean;
  /** Current saved note (from draft) */
  savedNote?: OwnerSessionNote | null;
  /** Callback when note changes — parent should persist to draft */
  onNoteChange: (note: OwnerSessionNote) => void;
}

const ALL_TAGS: FailureTag[] = [
  "ok",
  "too-slow",
  "too-sparse",
  "too-generic",
  "style-too-weak",
  "style-overrides-rhythm",
  "fallback-degraded",
  "save-reopen-confusion",
];

const TAG_COLORS: Record<FailureTag, string> = {
  "ok": "bg-green-900/40 text-green-300 border-green-700/40",
  "too-slow": "bg-amber-900/40 text-amber-300 border-amber-700/40",
  "too-sparse": "bg-orange-900/40 text-orange-300 border-orange-700/40",
  "too-generic": "bg-yellow-900/40 text-yellow-300 border-yellow-700/40",
  "style-too-weak": "bg-pink-900/40 text-pink-300 border-pink-700/40",
  "style-overrides-rhythm": "bg-red-900/40 text-red-300 border-red-700/40",
  "fallback-degraded": "bg-purple-900/40 text-purple-300 border-purple-700/40",
  "save-reopen-confusion": "bg-slate-700/40 text-slate-300 border-slate-600/40",
};

export default function SessionNotePanel({ draftId, scenario, fallbackUsed, savedNote, onNoteChange }: Props) {
  const [open, setOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);

  // Local form state
  const [tags, setTags] = useState<FailureTag[]>(savedNote?.failureTags ?? []);
  const [firstImpression, setFirstImpression] = useState(savedNote?.firstImpression ?? "");
  const [rhythmVerdict, setRhythmVerdict] = useState(savedNote?.rhythmVerdict ?? "");
  const [styleVerdict, setStyleVerdict] = useState(savedNote?.styleVerdict ?? "");
  const [nextFixGuess, setNextFixGuess] = useState(savedNote?.nextFixGuess ?? "");

  // Session log for summary view
  const [logEntries, setLogEntries] = useState<SessionLogEntry[]>([]);

  // Sync from saved note when it changes
  useEffect(() => {
    if (savedNote) {
      setTags(savedNote.failureTags);
      setFirstImpression(savedNote.firstImpression ?? "");
      setRhythmVerdict(savedNote.rhythmVerdict ?? "");
      setStyleVerdict(savedNote.styleVerdict ?? "");
      setNextFixGuess(savedNote.nextFixGuess ?? "");
    } else {
      setTags([]);
      setFirstImpression("");
      setRhythmVerdict("");
      setStyleVerdict("");
      setNextFixGuess("");
    }
  }, [savedNote]);

  useEffect(() => {
    if (showLog) setLogEntries(loadSessionLog());
  }, [showLog]);

  const toggleTag = useCallback((tag: FailureTag) => {
    setTags(prev => {
      // "ok" is exclusive with failure tags
      if (tag === "ok") return prev.includes("ok") ? [] : ["ok"];
      const without = prev.filter(t => t !== "ok" && t !== tag);
      return prev.includes(tag) ? without : [...without, tag];
    });
  }, []);

  const handleSave = useCallback(() => {
    const note: OwnerSessionNote = {
      scenario,
      firstImpression: firstImpression || undefined,
      rhythmVerdict: rhythmVerdict || undefined,
      styleVerdict: styleVerdict || undefined,
      failureTags: tags,
      fallbackUsed,
      nextFixGuess: nextFixGuess || undefined,
      notedAt: Date.now(),
    };
    onNoteChange(note);

    // Also append to session log
    if (draftId) {
      appendSessionLog({
        draftId,
        scenario,
        failureTags: tags,
        firstImpression: firstImpression || undefined,
        nextFixGuess: nextFixGuess || undefined,
        fallbackUsed,
        timestamp: Date.now(),
      });
      if (showLog) setLogEntries(loadSessionLog());
    }
  }, [scenario, firstImpression, rhythmVerdict, styleVerdict, tags, fallbackUsed, nextFixGuess, onNoteChange, draftId, showLog]);

  const handleClearLog = useCallback(() => {
    clearSessionLog();
    setLogEntries([]);
  }, []);

  const stats = sessionLogStats(logEntries);
  const totalLogged = logEntries.length;

  return (
    <div className="border border-zinc-700 rounded-lg overflow-hidden text-xs font-mono">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between bg-zinc-800/80 hover:bg-zinc-700/80 transition-colors text-zinc-300"
      >
        <span className="flex items-center gap-2">
          <span className="text-[10px]">{open ? "▼" : "▶"}</span>
          <span className="font-semibold tracking-wide">SESSION NOTES</span>
          {tags.length > 0 && (
            <span className="flex gap-1">
              {tags.map(t => (
                <span key={t} className={`px-1 py-0.5 rounded text-[9px] border ${TAG_COLORS[t]}`}>
                  {FAILURE_TAG_LABELS[t]}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="text-zinc-500 text-[10px]">
          {savedNote ? `${new Date(savedNote.notedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : "미기록"}
        </span>
      </button>

      {open && (
        <div className="px-3 py-2 bg-zinc-900/90 space-y-3 text-zinc-400">
          {/* ── Failure Tags ── */}
          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">실패 유형</div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_TAGS.map(tag => {
                const active = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`px-2 py-1 rounded text-[10px] font-medium border transition-all ${
                      active
                        ? TAG_COLORS[tag]
                        : "bg-zinc-800 text-zinc-500 border-zinc-700 hover:border-zinc-500"
                    }`}
                  >
                    {FAILURE_TAG_LABELS[tag]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Quick Notes ── */}
          <div className="grid grid-cols-2 gap-2">
            <NoteField
              label="첫인상"
              value={firstImpression}
              onChange={setFirstImpression}
              placeholder="좋다/이상하다/..."
            />
            <NoteField
              label="다음 수정 추측"
              value={nextFixGuess}
              onChange={setNextFixGuess}
              placeholder="어디를 고쳐야..."
            />
            <NoteField
              label="리듬 판정"
              value={rhythmVerdict}
              onChange={setRhythmVerdict}
              placeholder="빠르다/느리다/적절"
            />
            <NoteField
              label="스타일 판정"
              value={styleVerdict}
              onChange={setStyleVerdict}
              placeholder="약하다/강하다/적절"
            />
          </div>

          {/* ── Save Button ── */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition-colors"
            >
              메모 저장
            </button>
            <button
              onClick={() => setShowLog(!showLog)}
              className="px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-[10px] transition-colors"
            >
              {showLog ? "로그 닫기" : `세션 로그 (${totalLogged})`}
            </button>
          </div>

          {/* ── Session Log Summary ── */}
          {showLog && (
            <div className="bg-zinc-800/60 rounded px-2.5 py-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-zinc-500 uppercase tracking-widest">세션 로그 요약</div>
                <button
                  onClick={handleClearLog}
                  className="px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-500 text-[9px] transition-colors"
                >
                  초기화
                </button>
              </div>

              {/* Tag distribution */}
              <div className="flex flex-wrap gap-1.5">
                {(Object.entries(stats) as [FailureTag, number][])
                  .filter(([, count]) => count > 0)
                  .sort(([, a], [, b]) => b - a)
                  .map(([tag, count]) => (
                    <span key={tag} className={`px-1.5 py-0.5 rounded text-[9px] border ${TAG_COLORS[tag]}`}>
                      {FAILURE_TAG_LABELS[tag]} ×{count}
                    </span>
                  ))}
                {totalLogged === 0 && (
                  <span className="text-zinc-600 text-[10px]">기록 없음</span>
                )}
              </div>

              {/* Recent entries */}
              {logEntries.slice(0, 8).map((entry, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <span className="text-zinc-600 w-12 shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="truncate flex-1">{entry.scenario}</span>
                  <span className="flex gap-0.5">
                    {entry.failureTags.map(t => (
                      <span key={t} className={`px-1 py-0 rounded text-[8px] ${TAG_COLORS[t]}`}>
                        {FAILURE_TAG_LABELS[t]}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NoteField({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="text-[9px] text-zinc-600 uppercase tracking-wider">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-0.5 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[11px] placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
      />
    </div>
  );
}
