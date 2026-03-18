"use client";

/**
 * SessionNotePanel — 오너 테스트 세션 기록 패널
 *
 * 생성 결과마다 짧은 메모와 실패 유형 태그를 남긴다.
 * 하루 10~20개 시나리오를 돌릴 때 빠른 분류/기록용.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  type FailureTag,
  type OwnerSessionNote,
  type SessionLogEntry,
  FAILURE_TAG_LABELS,
  FAILURE_INTERPRETATIONS,
  appendSessionLog,
  loadSessionLog,
  clearSessionLog,
  sessionLogStats,
  buildOwnerSummary,
  deriveActionItems,
  tagsByDurationBand,
  loadRecommendLog,
  clearRecommendLog,
  buildRecommendSummary,
  deriveRecommendActions,
  type RecommendLogEntry,
} from "@/lib/draft-store";
import type { DraftGenerationMeta } from "@/lib/draft-store";

interface Props {
  draftId: string | null;
  scenario: string;
  fallbackUsed: boolean;
  /** Current saved note (from draft) */
  savedNote?: OwnerSessionNote | null;
  /** Engine meta context — for enriched log entries */
  generationMeta?: DraftGenerationMeta | null;
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

export default function SessionNotePanel({ draftId, scenario, fallbackUsed, savedNote, generationMeta, onNoteChange }: Props) {
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

    // Also append to session log with engine context
    if (draftId) {
      appendSessionLog({
        draftId,
        scenario,
        failureTags: tags,
        firstImpression: firstImpression || undefined,
        nextFixGuess: nextFixGuess || undefined,
        fallbackUsed,
        timestamp: Date.now(),
        durationBand: generationMeta?.shortformRhythm?.band,
        directorRequested: generationMeta?.directorRequested,
        degraded: generationMeta?.degraded,
        directorPaceDownWeighted: generationMeta?.directorPaceDownWeight,
        outlineOnly: generationMeta?.outlineOnly,
        totalDurationSec: generationMeta?.totalDurationSec,
        fastPathUsed: generationMeta?.fastPathUsed,
        totalLatencyMs: generationMeta?.totalLatencyMs,
        totalShotCount: generationMeta?.totalShotCount,
      });
      if (showLog) setLogEntries(loadSessionLog());
    }
  }, [scenario, firstImpression, rhythmVerdict, styleVerdict, tags, fallbackUsed, nextFixGuess, onNoteChange, draftId, showLog, generationMeta]);

  const handleClearLog = useCallback(() => {
    clearSessionLog();
    setLogEntries([]);
  }, []);

  const stats = sessionLogStats(logEntries);
  const totalLogged = logEntries.length;
  const summary = useMemo(() => buildOwnerSummary(logEntries), [logEntries]);
  const actionItems = useMemo(() => deriveActionItems(summary), [summary]);
  const bandBreakdown = useMemo(() => tagsByDurationBand(logEntries), [logEntries]);

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

          {/* ── Session Log + Owner Summary ── */}
          {showLog && (
            <div className="space-y-2">
              {/* ── Action Items (가장 중요 — 맨 위) ── */}
              {actionItems.length > 0 && (
                <div className="bg-indigo-900/20 border border-indigo-700/30 rounded px-2.5 py-2 space-y-1">
                  <div className="text-[10px] text-indigo-400 uppercase tracking-widest">다음 수정 우선순위</div>
                  {actionItems.map((item, i) => (
                    <div key={i} className={`text-[11px] leading-relaxed ${
                      item.startsWith("[P0]") ? "text-red-300" : item.startsWith("[P1]") ? "text-amber-300" : "text-zinc-300"
                    }`}>
                      {item}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Summary Stats ── */}
              <div className="bg-zinc-800/60 rounded px-2.5 py-2 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-widest">세션 요약</div>
                  <button
                    onClick={handleClearLog}
                    className="px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-500 text-[9px] transition-colors"
                  >
                    초기화
                  </button>
                </div>

                {totalLogged === 0 ? (
                  <span className="text-zinc-600 text-[10px]">기록 없음 — 먼저 시나리오를 돌리고 메모를 저장하세요</span>
                ) : (
                  <>
                    {/* Overview bar */}
                    <div className="flex items-center gap-3 text-[10px] flex-wrap">
                      <span className="text-zinc-400">{summary.totalSessions}회 테스트</span>
                      <span className="text-green-400">{summary.okCount} OK</span>
                      <span className={summary.failCount > 0 ? "text-red-400" : "text-zinc-600"}>{summary.failCount} 실패</span>
                      {summary.fallbackRate > 0 && (
                        <span className="text-purple-400">fallback {(summary.fallbackRate * 100).toFixed(0)}%</span>
                      )}
                      {summary.downWeightRate > 0 && (
                        <span className="text-amber-400">pace↓ {(summary.downWeightRate * 100).toFixed(0)}%</span>
                      )}
                    </div>
                    {/* Fast path comparison */}
                    <FastPathSummary entries={logEntries} />

                    {/* Tag distribution */}
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.entries(stats) as [FailureTag, number][])
                        .filter(([, count]) => count > 0)
                        .sort(([, a], [, b]) => b - a)
                        .map(([tag, count]) => {
                          const isTop = summary.topFailure?.tag === tag;
                          return (
                            <span key={tag} className={`px-1.5 py-0.5 rounded text-[9px] border ${TAG_COLORS[tag]} ${isTop ? "ring-1 ring-white/20" : ""}`}>
                              {FAILURE_TAG_LABELS[tag]} ×{count}
                              {isTop && " ★"}
                            </span>
                          );
                        })}
                    </div>

                    {/* Duration band breakdown */}
                    {Object.keys(bandBreakdown).length > 1 && (
                      <div className="space-y-1">
                        <div className="text-[9px] text-zinc-600 uppercase tracking-wider">밴드별 실패</div>
                        {Object.entries(bandBreakdown).map(([band, tagCounts]) => {
                          const fails = Object.entries(tagCounts).filter(([t, c]) => t !== "ok" && c > 0);
                          if (fails.length === 0) return null;
                          const isCritical = band === "shortform-critical";
                          return (
                            <div key={band} className="flex items-center gap-2 text-[10px]">
                              <span className={`w-28 shrink-0 ${isCritical ? "text-red-400 font-medium" : "text-zinc-500"}`}>
                                {band}
                              </span>
                              <span className="flex gap-1 flex-wrap">
                                {fails.map(([tag, count]) => (
                                  <span key={tag} className={`px-1 py-0 rounded text-[8px] ${TAG_COLORS[tag as FailureTag]}`}>
                                    {FAILURE_TAG_LABELS[tag as FailureTag]} ×{count}
                                  </span>
                                ))}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Recent fix guesses */}
                    {summary.recentFixGuesses.length > 0 && (
                      <div className="space-y-0.5">
                        <div className="text-[9px] text-zinc-600 uppercase tracking-wider">최근 수정 추측</div>
                        {summary.recentFixGuesses.map((guess, i) => (
                          <div key={i} className="text-[10px] text-zinc-400 pl-2">→ {guess}</div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Recent Log Entries ── */}
              {logEntries.length > 0 && (
                <div className="bg-zinc-800/40 rounded px-2.5 py-2 space-y-1">
                  <div className="text-[9px] text-zinc-600 uppercase tracking-wider">최근 기록</div>
                  {logEntries.slice(0, 10).map((entry, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] text-zinc-500">
                      <span className="text-zinc-600 w-10 shrink-0">
                        {new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="truncate flex-1">{entry.scenario}</span>
                      {entry.fastPathUsed && (
                        <span className="text-[8px] px-1 rounded bg-cyan-900/30 text-cyan-400">FP</span>
                      )}
                      {entry.totalLatencyMs != null && (
                        <span className="text-[8px] text-zinc-600 shrink-0">{(entry.totalLatencyMs / 1000).toFixed(1)}s</span>
                      )}
                      {entry.totalShotCount != null && (
                        <span className="text-[8px] text-zinc-600 shrink-0">{entry.totalShotCount}sh</span>
                      )}
                      {entry.durationBand && (
                        <span className={`text-[8px] px-1 rounded ${entry.durationBand === "shortform-critical" ? "bg-red-900/30 text-red-400" : "bg-zinc-700/50 text-zinc-500"}`}>
                          {entry.durationBand}
                        </span>
                      )}
                      <span className="flex gap-0.5 shrink-0">
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

              {/* ── Interpretation Guide (접이식) ── */}
              {/* ── Recommendation Diagnostics ── */}
              <RecommendDiagnostics />

              <InterpretationGuide activeTags={Object.entries(stats).filter(([, c]) => c > 0).map(([t]) => t as FailureTag)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecommendDiagnostics() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<RecommendLogEntry[]>([]);

  useEffect(() => {
    if (open) setEntries(loadRecommendLog());
  }, [open]);

  const summary = useMemo(() => buildRecommendSummary(entries), [entries]);
  const actions = useMemo(() => deriveRecommendActions(summary), [summary]);

  return (
    <div className="bg-zinc-800/30 rounded overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-2.5 py-1.5 flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-400 transition-colors"
      >
        <span>{open ? "▼" : "▶"}</span>
        <span className="uppercase tracking-wider">추천 진단</span>
        <span className="text-zinc-600">— 감독 추천 API 안정성/품질</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2 space-y-2">
          {summary.total === 0 ? (
            <span className="text-zinc-600 text-[10px]">추천 기록 없음</span>
          ) : (
            <>
              {/* Overview */}
              <div className="flex items-center gap-3 text-[10px] flex-wrap">
                <span className="text-zinc-400">{summary.total}회 호출</span>
                <span className="text-green-400">{summary.successCount} 성공</span>
                {summary.emptyCount > 0 && <span className="text-amber-400">{summary.emptyCount} 빈결과</span>}
                {summary.errorCount > 0 && <span className="text-red-400">{summary.errorCount} 에러</span>}
                {summary.cacheHitCount > 0 && <span className="text-blue-400">{summary.cacheHitCount} 캐시</span>}
                <span className="text-zinc-500">{summary.avgLatencyMs}ms 평균</span>
              </div>

              {/* Action items */}
              {actions.length > 0 && (
                <div className="space-y-0.5">
                  {actions.map((item, i) => (
                    <div key={i} className={`text-[10px] leading-relaxed ${
                      item.startsWith("[에러]") ? "text-red-300"
                        : item.startsWith("[빈결과]") ? "text-amber-300"
                        : item.startsWith("[편향]") ? "text-pink-300"
                        : item.startsWith("[지연]") ? "text-orange-300"
                        : "text-zinc-300"
                    }`}>
                      {item}
                    </div>
                  ))}
                </div>
              )}

              {/* Top recommended directors */}
              {summary.topDirectorIds.length > 0 && (
                <div className="space-y-0.5">
                  <div className="text-[9px] text-zinc-600 uppercase tracking-wider">자주 추천된 감독</div>
                  <div className="flex flex-wrap gap-1">
                    {summary.topDirectorIds.map(({ id, count }) => (
                      <span key={id} className="px-1.5 py-0.5 rounded text-[9px] bg-zinc-700/50 text-zinc-400">
                        {id} ×{count}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Error category breakdown */}
              {Object.keys(summary.errorCategories).length > 0 && (
                <div className="space-y-0.5">
                  <div className="text-[9px] text-zinc-600 uppercase tracking-wider">에러 유형</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(summary.errorCategories).map(([cat, count]) => (
                      <span key={cat} className="px-1.5 py-0.5 rounded text-[9px] bg-red-900/30 text-red-400">
                        {cat} ×{count}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent entries */}
              <div className="space-y-0.5">
                <div className="text-[9px] text-zinc-600 uppercase tracking-wider">최근 호출</div>
                {entries.slice(0, 5).map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] text-zinc-500">
                    <span className="text-zinc-600 w-10 shrink-0">
                      {new Date(e.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className={`w-10 shrink-0 ${
                      e.outcome === "success" ? "text-green-400" : e.outcome === "error" ? "text-red-400" : e.outcome === "empty" ? "text-amber-400" : "text-blue-400"
                    }`}>
                      {e.outcome}
                    </span>
                    <span className="truncate flex-1">{e.storySnippet}</span>
                    <span className="text-zinc-600 shrink-0">{e.latencyMs}ms</span>
                    <span className="text-zinc-600 shrink-0">{e.localMatchCount}+{e.webSuggestionCount}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => { clearRecommendLog(); setEntries([]); }}
                className="px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-500 text-[9px] transition-colors"
              >
                추천 로그 초기화
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FastPathSummary({ entries }: { entries: SessionLogEntry[] }) {
  const fpEntries = entries.filter(e => e.fastPathUsed);
  const nonFpEntries = entries.filter(e => !e.fastPathUsed && e.totalLatencyMs != null);
  if (fpEntries.length === 0 && nonFpEntries.length === 0) return null;

  const avgLatency = (list: SessionLogEntry[]) => {
    const withLatency = list.filter(e => e.totalLatencyMs != null);
    return withLatency.length > 0 ? Math.round(withLatency.reduce((s, e) => s + (e.totalLatencyMs ?? 0), 0) / withLatency.length) : null;
  };
  const avgShots = (list: SessionLogEntry[]) => {
    const withShots = list.filter(e => e.totalShotCount != null);
    return withShots.length > 0 ? (withShots.reduce((s, e) => s + (e.totalShotCount ?? 0), 0) / withShots.length).toFixed(1) : null;
  };
  const failRate = (list: SessionLogEntry[]) => {
    if (list.length === 0) return null;
    const fails = list.filter(e => e.failureTags.some(t => t !== "ok"));
    return Math.round((fails.length / list.length) * 100);
  };

  // Quality concern tags for fast path
  const fpQualityFails = fpEntries.filter(e =>
    e.failureTags.some(t => t === "too-generic" || t === "style-too-weak" || t === "too-sparse")
  ).length;

  const fpLatency = avgLatency(fpEntries);
  const nonFpLatency = avgLatency(nonFpEntries);

  return (
    <div className="bg-zinc-800/40 rounded px-2.5 py-1.5 space-y-1">
      <div className="text-[9px] text-zinc-600 uppercase tracking-wider">fast path vs normal 비교</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
        <span className="text-zinc-500">구분</span>
        <span className="text-zinc-500 flex gap-4"><span className="w-16">Fast Path</span><span>Normal</span></span>
        <span className="text-zinc-500">건수</span>
        <span className="text-zinc-400 flex gap-4"><span className="w-16">{fpEntries.length}</span><span>{nonFpEntries.length}</span></span>
        <span className="text-zinc-500">평균 latency</span>
        <span className="text-zinc-400 flex gap-4">
          <span className="w-16">{fpLatency != null ? `${(fpLatency / 1000).toFixed(1)}s` : "-"}</span>
          <span>{nonFpLatency != null ? `${(nonFpLatency / 1000).toFixed(1)}s` : "-"}</span>
        </span>
        <span className="text-zinc-500">평균 shots</span>
        <span className="text-zinc-400 flex gap-4">
          <span className="w-16">{avgShots(fpEntries) ?? "-"}</span>
          <span>{avgShots(nonFpEntries) ?? "-"}</span>
        </span>
        <span className="text-zinc-500">실패율</span>
        <span className="text-zinc-400 flex gap-4">
          <span className="w-16">{failRate(fpEntries) != null ? `${failRate(fpEntries)}%` : "-"}</span>
          <span>{failRate(nonFpEntries) != null ? `${failRate(nonFpEntries)}%` : "-"}</span>
        </span>
      </div>
      {fpQualityFails > 0 && (
        <div className="text-[10px] text-amber-400">
          fast path 품질 문제 {fpQualityFails}건 (generic/style-weak/sparse)
        </div>
      )}
    </div>
  );
}

function InterpretationGuide({ activeTags }: { activeTags: FailureTag[] }) {
  const [guideOpen, setGuideOpen] = useState(false);
  const relevantTags = activeTags.filter(t => t !== "ok");

  if (relevantTags.length === 0) return null;

  return (
    <div className="bg-zinc-800/30 rounded overflow-hidden">
      <button
        onClick={() => setGuideOpen(!guideOpen)}
        className="w-full px-2.5 py-1.5 flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-400 transition-colors"
      >
        <span>{guideOpen ? "▼" : "▶"}</span>
        <span className="uppercase tracking-wider">해석 가이드</span>
        <span className="text-zinc-600">— 발생한 실패 유형의 원인과 대응</span>
      </button>
      {guideOpen && (
        <div className="px-2.5 pb-2 space-y-2">
          {relevantTags.map(tag => {
            const interp = FAILURE_INTERPRETATIONS[tag];
            return (
              <div key={tag} className="space-y-0.5">
                <div className={`text-[10px] font-medium ${TAG_COLORS[tag].split(" ")[1]}`}>
                  {FAILURE_TAG_LABELS[tag]}
                </div>
                <div className="text-[10px] text-zinc-500 pl-2">
                  의심: {interp.suspect}
                </div>
                <div className="text-[10px] text-zinc-400 pl-2">
                  대응: {interp.action}
                </div>
              </div>
            );
          })}
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
