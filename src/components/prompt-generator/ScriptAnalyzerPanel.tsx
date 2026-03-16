"use client";

import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  analyzeScript,
  convertToCuts,
  estimateRuntime,
  detectContentType,
  buildAnalysisPrompt,
} from "@/lib/script-analyzer";
import type {
  ScriptAnalysisResult,
  AnalyzedSequence,
  AnalyzedCut,
  SequenceBeatType,
  ScriptContentType,
} from "@/types/script-analysis";
import type { PromptOutput, Cut } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Types & Constants
// ═══════════════════════════════════════════════════════════════════

interface ScriptAnalyzerPanelProps {
  /** 분석 결과를 기존 워크플로우에 적용 */
  onApply?: (output: PromptOutput) => void;
}

const BEAT_TYPE_META: Record<SequenceBeatType, { label: string; color: string; bg: string; icon: string }> = {
  hook:        { label: "훅",     color: "#ef4444", bg: "#ef444415", icon: "⚡" },
  setup:       { label: "배경",   color: "#64748b", bg: "#64748b15", icon: "🏗️" },
  mechanism:   { label: "원리",   color: "#0891b2", bg: "#0891b215", icon: "⚙️" },
  development: { label: "전개",   color: "#3b82f6", bg: "#3b82f615", icon: "📖" },
  reveal:      { label: "공개",   color: "#f59e0b", bg: "#f59e0b15", icon: "💡" },
  consequence: { label: "결과",   color: "#8b5cf6", bg: "#8b5cf615", icon: "🔗" },
  escalation:  { label: "상승",   color: "#ea580c", bg: "#ea580c15", icon: "📈" },
  paradox:     { label: "역설",   color: "#ec4899", bg: "#ec489915", icon: "🔄" },
  payoff:      { label: "보상",   color: "#22c55e", bg: "#22c55e15", icon: "✨" },
  transition:  { label: "전환",   color: "#6b7280", bg: "#6b728015", icon: "↗️" },
};

const ENDING_MODE_LABEL: Record<string, string> = {
  close: "완결",
  cliffhanger: "클리프행어",
  "loop-open": "연결 고리",
  payoff: "보상 착지",
  paradox: "역설 종결",
  transition: "자연 전환",
};

const SEVERITY_STYLE: Record<string, { color: string; bg: string; icon: string }> = {
  error:   { color: "#dc2626", bg: "#dc262610", icon: "✗" },
  warning: { color: "#d97706", bg: "#d9770610", icon: "!" },
  info:    { color: "#2563eb", bg: "#2563eb10", icon: "i" },
};

const CONFIDENCE_STYLE: Record<string, { color: string; label: string }> = {
  low:    { color: "#dc2626", label: "낮음" },
  medium: { color: "#d97706", label: "보통" },
  high:   { color: "#16a34a", label: "높음" },
};

const CONTENT_TYPE_OPTIONS: { value: ScriptContentType; label: string }[] = [
  { value: "auto", label: "자동 감지" },
  { value: "history", label: "역사 해설" },
  { value: "economics", label: "경제 해설" },
  { value: "what-if", label: "가정법/반사실" },
  { value: "social-commentary", label: "사회 비평" },
  { value: "educational", label: "교육" },
];

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function ScriptAnalyzerPanel({ onApply }: ScriptAnalyzerPanelProps) {
  const [scriptText, setScriptText] = useState("");
  const [contentType, setContentType] = useState<ScriptContentType>("auto");
  const [analysis, setAnalysis] = useState<ScriptAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);
  const [useLLM, setUseLLM] = useState(true);

  // ── Pre-analysis estimates ──
  const preEstimate = useMemo(() => {
    if (!scriptText.trim()) return null;
    const charCount = scriptText.replace(/\s/g, "").length;
    const runtime = estimateRuntime(scriptText);
    const seqCount = Math.max(1, Math.round(runtime / 10));
    const detected = detectContentType(scriptText);
    return { charCount, runtime, seqCount, detected };
  }, [scriptText]);

  // ── Analyze ──
  const handleAnalyze = useCallback(async () => {
    if (!scriptText.trim()) return;

    setAnalyzing(true);
    setError(null);

    try {
      // Client-side heuristic (immediate)
      const effectiveType = contentType === "auto" ? detectContentType(scriptText) : contentType;
      const heuristicResult = analyzeScript(scriptText, { contentTypeHint: effectiveType });

      // Try LLM enhancement if enabled
      if (useLLM) {
        try {
          const prompt = buildAnalysisPrompt(scriptText, effectiveType);
          const res = await fetch("/api/analyze-script", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scriptText,
              contentTypeHint: effectiveType,
              analysisPrompt: prompt,
            }),
          });

          if (res.ok) {
            const data = await res.json() as { success: boolean; analysis?: ScriptAnalysisResult };
            if (data.success && data.analysis) {
              setAnalysis(data.analysis);
              setExpandedSeq(0);
              setAnalyzing(false);
              return;
            }
          }
          // LLM failed — fall through to heuristic
          console.warn("[ScriptAnalyzer] LLM failed, using heuristic");
        } catch {
          console.warn("[ScriptAnalyzer] LLM request failed, using heuristic");
        }
      }

      // Use heuristic result
      setAnalysis(heuristicResult);
      setExpandedSeq(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석 중 오류 발생");
    } finally {
      setAnalyzing(false);
    }
  }, [scriptText, contentType, useLLM]);

  // ── Apply to workflow ──
  const handleApply = useCallback(() => {
    if (!analysis || !onApply) return;

    const cuts = convertToCuts(analysis);
    const output: PromptOutput = {
      projectTitle: analysis.thesis || "대본 분석 프로젝트",
      conceptSummary: analysis.sourceSummary,
      globalStylePrompt: "대본 분석 기반 시퀀스",
      directorPersonaPrompt: "",
      totalCuts: cuts.length,
      characterSeeds: [],
      continuityRules: [],
      cuts,
    };

    onApply(output);
  }, [analysis, onApply]);

  // ═══════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="space-y-4">
      {/* ── Input Section ── */}
      <Card>
        <CardHeader
          className="pb-3"
          style={{ background: "linear-gradient(135deg, #e0950015, #e0950008)" }}
        >
          <CardTitle className="text-base" style={{ color: "#b87700" }}>
            대본 분석기
          </CardTitle>
          <p className="text-xs mt-1" style={{ color: "#999" }}>
            장문의 한국어 나레이션/대본을 붙여넣으면 릴 시리즈 프로덕션 구조로 자동 변환합니다.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <Textarea
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            placeholder={`여기에 대본을 붙여넣으세요...\n\n예시:\n만약 흑사병이 없었다면, 오늘날 우리가 아는 자유와 임금 노동은 존재하지 않았을 수도 있다.\n14세기 유럽 인구의 1/3이 사라졌을 때, 남은 노동자들의 가치는 폭등했다...\n\n(역사 해설, 경제 해설, 가정법/반사실, 교육 컨텐츠 등)`}
            className="min-h-[200px] text-sm"
            style={{ fontFamily: "inherit" }}
          />

          {/* Pre-estimate badges */}
          {preEstimate && (
            <div className="flex gap-2 flex-wrap items-center">
              <Badge variant="outline" style={{ color: "#666", borderColor: "#ddd" }}>
                {preEstimate.charCount}자
              </Badge>
              <Badge variant="outline" style={{ color: "#666", borderColor: "#ddd" }}>
                ~{preEstimate.runtime}초 예상
              </Badge>
              <Badge variant="outline" style={{ color: "#666", borderColor: "#ddd" }}>
                ~{preEstimate.seqCount}개 시퀀스
              </Badge>
              <Badge variant="outline" style={{ color: "#b87700", borderColor: "#e0950040" }}>
                {CONTENT_TYPE_OPTIONS.find(o => o.value === preEstimate.detected)?.label || preEstimate.detected}
              </Badge>
            </div>
          )}

          {/* Controls row */}
          <div className="flex gap-2 items-center flex-wrap">
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value as ScriptContentType)}
              className="text-xs px-2 py-1.5 border rounded"
              style={{ borderColor: "#ddd", color: "#666" }}
            >
              {CONTENT_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <label className="flex items-center gap-1.5 text-xs" style={{ color: "#666" }}>
              <input
                type="checkbox"
                checked={useLLM}
                onChange={(e) => setUseLLM(e.target.checked)}
                className="rounded"
              />
              AI 심층 분석
            </label>

            <div className="flex-1" />

            <Button
              onClick={handleAnalyze}
              disabled={!scriptText.trim() || analyzing}
              className="text-sm"
              style={{
                background: analyzing ? "#999" : "#e09500",
                color: "white",
                boxShadow: analyzing ? "none" : "0 2px 8px #e0950040",
              }}
            >
              {analyzing ? "분석 중..." : "분석하기"}
            </Button>
          </div>

          {error && (
            <p className="text-xs p-2 rounded" style={{ color: "#dc2626", background: "#dc262610" }}>
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Analysis Result ── */}
      {analysis && (
        <>
          {/* Macro Analysis */}
          <Card>
            <CardHeader
              className="pb-3"
              style={{ background: "linear-gradient(135deg, #e0950010, #22c55e08)" }}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm" style={{ color: "#b87700" }}>
                  매크로 분석
                </CardTitle>
                <div className="flex gap-2">
                  <Badge style={{ background: "#e0950015", color: "#b87700" }}>
                    {analysis.totalSuggestedRuntime}초
                  </Badge>
                  <Badge style={{ background: "#22c55e15", color: "#16a34a" }}>
                    {analysis.suggestedSequenceCount}개 시퀀스
                  </Badge>
                  {analysis.confidence && (
                    <Badge style={{
                      background: CONFIDENCE_STYLE[analysis.confidence]?.color + "15",
                      color: CONFIDENCE_STYLE[analysis.confidence]?.color,
                    }}>
                      신뢰도: {CONFIDENCE_STYLE[analysis.confidence]?.label}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-3">
              {/* Thesis */}
              <div>
                <p className="text-[10px] font-medium mb-1" style={{ color: "#999" }}>핵심 논제</p>
                <p className="text-xs" style={{ color: "#333" }}>{analysis.thesis}</p>
              </div>

              {/* Hook */}
              <div>
                <p className="text-[10px] font-medium mb-1" style={{ color: "#999" }}>메인 훅</p>
                <p className="text-xs" style={{ color: "#ef4444" }}>{analysis.mainHook}</p>
              </div>

              {/* Structural notes & weaknesses */}
              {analysis.structuralNotes.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium mb-1" style={{ color: "#22c55e" }}>구조 분석</p>
                  {analysis.structuralNotes.map((note, i) => (
                    <p key={i} className="text-[11px] ml-2" style={{ color: "#666" }}>+ {note}</p>
                  ))}
                </div>
              )}
              {analysis.weaknesses.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium mb-1" style={{ color: "#f59e0b" }}>개선 필요</p>
                  {analysis.weaknesses.map((w, i) => (
                    <p key={i} className="text-[11px] ml-2" style={{ color: "#b87700" }}>! {w}</p>
                  ))}
                </div>
              )}
              {analysis.issues && analysis.issues.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium mb-1" style={{ color: "#666" }}>구조적 이슈</p>
                  {analysis.issues.map((issue, i) => {
                    const style = SEVERITY_STYLE[issue.severity] || SEVERITY_STYLE.info;
                    return (
                      <div key={i} className="ml-2 mb-1 p-1.5 rounded text-[11px]" style={{ background: style.bg }}>
                        <span className="font-medium" style={{ color: style.color }}>
                          {style.icon} [{issue.code}]
                        </span>{" "}
                        <span style={{ color: "#555" }}>{issue.message}</span>
                        {issue.suggestion && (
                          <p className="text-[10px] mt-0.5 ml-3" style={{ color: "#888" }}>{issue.suggestion}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sequence Timeline Overview */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm" style={{ color: "#333" }}>시퀀스 타임라인</CardTitle>
                {onApply && (
                  <Button
                    onClick={handleApply}
                    size="sm"
                    className="text-xs"
                    style={{
                      background: "#22c55e",
                      color: "white",
                      boxShadow: "0 2px 6px #22c55e40",
                    }}
                  >
                    프롬프트 워크플로우에 적용
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              {/* Visual timeline bar */}
              <div className="flex gap-0.5 mb-4 rounded overflow-hidden" style={{ height: 28 }}>
                {analysis.sequences.map((seq) => {
                  const meta = BEAT_TYPE_META[seq.beatType];
                  const widthPercent = (seq.recommendedDurationSec / analysis.totalSuggestedRuntime) * 100;
                  return (
                    <button
                      key={seq.id}
                      onClick={() => setExpandedSeq(expandedSeq === seq.id - 1 ? null : seq.id - 1)}
                      className="flex items-center justify-center text-[9px] font-medium transition-all hover:opacity-80"
                      style={{
                        width: `${widthPercent}%`,
                        minWidth: 32,
                        background: meta.color,
                        color: "white",
                        opacity: expandedSeq === seq.id - 1 ? 1 : 0.7,
                      }}
                      title={`${seq.title} (${seq.recommendedDurationSec}초)`}
                    >
                      {seq.id}
                    </button>
                  );
                })}
              </div>

              {/* Sequence cards */}
              <div className="space-y-2">
                {analysis.sequences.map((seq, seqIdx) => (
                  <SequenceCard
                    key={seq.id}
                    sequence={seq}
                    isExpanded={expandedSeq === seqIdx}
                    onToggle={() => setExpandedSeq(expandedSeq === seqIdx ? null : seqIdx)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Sequence Card Component
// ═══════════════════════════════════════════════════════════════════

function SequenceCard({
  sequence: seq,
  isExpanded,
  onToggle,
}: {
  sequence: AnalyzedSequence;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const meta = BEAT_TYPE_META[seq.beatType];

  return (
    <div
      className="border rounded-lg overflow-hidden transition-all"
      style={{ borderColor: isExpanded ? meta.color + "40" : "#e5e5e5" }}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-xs font-bold" style={{ color: meta.color, minWidth: 20 }}>
          {seq.id}
        </span>
        <Badge
          className="text-[9px] px-1.5"
          style={{ background: meta.bg, color: meta.color, border: "none" }}
        >
          {meta.icon} {meta.label}
        </Badge>
        <span className="text-xs font-medium flex-1" style={{ color: "#333" }}>
          {seq.title}
        </span>
        <span className="text-[10px]" style={{ color: "#999" }}>
          {seq.recommendedDurationSec}초 · {seq.recommendedCutCount}컷
        </span>
        <Badge
          className="text-[8px] px-1"
          variant="outline"
          style={{
            borderColor: seq.endingMode === "cliffhanger" ? "#ef4444" : "#22c55e",
            color: seq.endingMode === "cliffhanger" ? "#ef4444" : "#22c55e",
          }}
        >
          {ENDING_MODE_LABEL[seq.endingMode] || seq.endingMode}
        </Badge>
        <span className="text-xs" style={{ color: "#ccc" }}>{isExpanded ? "▲" : "▼"}</span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3" style={{ background: meta.bg }}>
          {/* Purpose & Rationale */}
          <div className="pt-2">
            <p className="text-[11px]" style={{ color: "#555" }}>{seq.purpose}</p>
            <p className="text-[10px] mt-1" style={{ color: "#999" }}>
              <span className="font-medium">이유:</span> {seq.rationale}
            </p>
            {seq.cliffhangerText && (
              <p className="text-[10px] mt-1 italic" style={{ color: "#ef4444" }}>
                예고: "{seq.cliffhangerText}"
              </p>
            )}
          </div>

          {/* Source text */}
          <div className="p-2 rounded text-[10px]" style={{ background: "#ffffff80", color: "#666" }}>
            <p className="font-medium mb-1" style={{ color: "#999" }}>원본 대본 구간:</p>
            {seq.sourceText.length > 200
              ? seq.sourceText.slice(0, 200) + "…"
              : seq.sourceText}
          </div>

          {/* Retention strategy */}
          <div className="grid grid-cols-2 gap-2">
            <RetentionItem label="호기심" value={seq.retentionStrategy.curiosityPoint} color="#f59e0b" />
            <RetentionItem label="정보 증가" value={seq.retentionStrategy.informationGain} color="#3b82f6" />
            <RetentionItem label="에스컬레이션" value={seq.retentionStrategy.escalation} color="#ea580c" />
            <RetentionItem label="보상" value={seq.retentionStrategy.payoff} color="#22c55e" />
          </div>

          {/* Visual strategy */}
          <div className="flex gap-2 flex-wrap">
            <Badge variant="outline" className="text-[9px]" style={{ color: "#8b5cf6", borderColor: "#8b5cf640" }}>
              드라이버: {seq.visualStrategy.primaryDriver}
            </Badge>
            <Badge variant="outline" className="text-[9px]" style={{ color: "#8b5cf6", borderColor: "#8b5cf640" }}>
              착지: {seq.visualStrategy.finalFrameLanding}
            </Badge>
            <Badge variant="outline" className="text-[9px]" style={{ color: "#8b5cf6", borderColor: "#8b5cf640" }}>
              톤: {seq.visualStrategy.toneHint}
            </Badge>
          </div>

          {/* Cut progression */}
          <div>
            <p className="text-[10px] font-medium mb-2" style={{ color: "#555" }}>컷 프로그레션</p>
            <div className="space-y-1.5">
              {seq.cuts.map((cut, cutIdx) => (
                <CutProgressionRow key={cutIdx} cut={cut} index={cutIdx} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

function RetentionItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="p-1.5 rounded" style={{ background: color + "08" }}>
      <p className="text-[9px] font-medium" style={{ color }}>{label}</p>
      <p className="text-[10px] mt-0.5" style={{ color: "#666" }}>{value}</p>
    </div>
  );
}

const ROLE_COLOR: Record<string, string> = {
  establish: "#3b82f6",
  develop: "#22c55e",
  peak: "#ef4444",
  resolve: "#a855f7",
  insert: "#f59e0b",
  transition: "#6b7280",
};

function CutProgressionRow({ cut, index }: { cut: AnalyzedCut; index: number }) {
  const roleColor = ROLE_COLOR[cut.role] || "#666";

  return (
    <div
      className="flex gap-2 items-start p-2 rounded"
      style={{ background: "#ffffff60" }}
    >
      <div className="flex flex-col items-center gap-0.5" style={{ minWidth: 40 }}>
        <span
          className="text-[9px] font-bold px-1.5 py-0.5 rounded"
          style={{ background: roleColor + "15", color: roleColor }}
        >
          {cut.role}
        </span>
        <span className="text-[8px]" style={{ color: "#999" }}>{cut.visualFocus}</span>
      </div>
      <div className="flex-1 space-y-0.5">
        <p className="text-[10px]" style={{ color: "#444" }}>
          <span className="font-medium" style={{ color: roleColor }}>변화:</span>{" "}
          {cut.changeFromPrevious}
        </p>
        <p className="text-[10px]" style={{ color: "#666" }}>
          <span className="font-medium">기능:</span> {cut.narrativeFunction}
        </p>
        <p className="text-[10px]" style={{ color: "#888" }}>
          <span className="font-medium">프롬프트:</span> {cut.suggestedPromptIntent}
        </p>
        <p className="text-[9px]" style={{ color: "#aaa" }}>
          시청 유지: {cut.retentionReason}
        </p>
      </div>
    </div>
  );
}
