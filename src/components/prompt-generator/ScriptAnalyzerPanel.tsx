"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  analyzeScriptPhaseA,
  enrichSequenceDetail,
  enrichAllSequences,
  convertToCuts,
  estimateRuntime,
  detectContentType,
  buildAnalysisPrompt,
} from "@/lib/script-analyzer";
import { normalizeAnalysisResult } from "@/lib/normalize";
import type {
  ScriptAnalysisResult,
  AnalyzedSequence,
  AnalyzedCut,
  SequenceBeatType,
  ScriptContentType,
  AnalysisPhase,
  PhaseAResult,
} from "@/types/script-analysis";
import type { ScriptBeat } from "@/lib/script-analyzer";
import type { PromptOutput } from "@/types";

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

const PHASE_LABEL: Record<AnalysisPhase, string> = {
  idle: "",
  structural: "구조 분석 중...",
  detailing: "시퀀스 상세 생성 중...",
  enriching: "AI 심층 분석 중...",
  complete: "",
};

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function ScriptAnalyzerPanel({ onApply }: ScriptAnalyzerPanelProps) {
  const [scriptText, setScriptText] = useState("");
  const [contentType, setContentType] = useState<ScriptContentType>("auto");
  const [analysis, setAnalysis] = useState<ScriptAnalysisResult | null>(null);
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [detailedSeqs, setDetailedSeqs] = useState<Set<number>>(new Set());
  const [detailProgress, setDetailProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);
  const [useLLM, setUseLLM] = useState(true);

  // Refs for Phase B intermediates (avoids re-renders)
  const phaseARef = useRef<PhaseAResult | null>(null);
  const abortRef = useRef(false);

  // ── Pre-analysis estimates ──
  const preEstimate = useMemo(() => {
    if (!scriptText.trim()) return null;
    const charCount = scriptText.replace(/\s/g, "").length;
    const runtime = estimateRuntime(scriptText);
    const seqCount = Math.max(1, Math.round(runtime / 10));
    const detected = detectContentType(scriptText);
    return { charCount, runtime, seqCount, detected };
  }, [scriptText]);

  // ── Progressive Analysis ──
  const handleAnalyze = useCallback(async () => {
    if (!scriptText.trim()) return;

    abortRef.current = false;
    setError(null);
    setDetailedSeqs(new Set());

    // ── Phase A: Structural (instant) ──
    setPhase("structural");
    const effectiveType = contentType === "auto" ? detectContentType(scriptText) : contentType;

    let phaseA: PhaseAResult;
    try {
      phaseA = analyzeScriptPhaseA(scriptText, { contentTypeHint: effectiveType });
    } catch (err) {
      setError(err instanceof Error ? err.message : "구조 분석 실패");
      setPhase("idle");
      return;
    }

    phaseARef.current = phaseA;

    // If cache hit returned fully-enriched result, skip Phase B
    const isCacheHit = phaseA.result.sequences.length > 0 &&
      phaseA.result.sequences.every(s => s.cuts.length > 0);

    if (isCacheHit) {
      setAnalysis(phaseA.result);
      setDetailedSeqs(new Set(phaseA.result.sequences.map((_, i) => i)));
      setDetailProgress({ done: phaseA.result.sequences.length, total: phaseA.result.sequences.length });
      setExpandedSeq(0);
      // Skip to Phase C if LLM enabled
      if (useLLM) {
        setPhase("enriching");
        runLLMEnrichment(scriptText, effectiveType, phaseA.result);
      } else {
        setPhase("complete");
      }
      return;
    }

    // Show skeleton immediately
    setAnalysis(phaseA.result);
    setExpandedSeq(0);

    // ── Phase B: Per-sequence detail (progressive, via microtask cascade) ──
    setPhase("detailing");
    const totalSeqs = phaseA.result.sequences.length;
    setDetailProgress({ done: 0, total: totalSeqs });

    // Run Phase B in microtask cascade to allow UI paints between sequences
    let currentResult = phaseA.result;
    for (let i = 0; i < totalSeqs; i++) {
      if (abortRef.current) break;

      // Yield to browser paint
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (abortRef.current) break;

      const enriched = enrichSequenceDetail(
        currentResult.sequences[i],
        phaseA.sequenceGroups,
        i,
        totalSeqs,
      );

      currentResult = {
        ...currentResult,
        sequences: currentResult.sequences.map((s, idx) => idx === i ? enriched : s),
      };

      setAnalysis(currentResult);
      setDetailedSeqs(prev => new Set(prev).add(i));
      setDetailProgress({ done: i + 1, total: totalSeqs });
    }

    if (abortRef.current) return;

    // ── Phase C: LLM enrichment (optional, background) ──
    if (useLLM) {
      setPhase("enriching");
      runLLMEnrichment(scriptText, effectiveType, currentResult);
    } else {
      setPhase("complete");
    }
  }, [scriptText, contentType, useLLM]);

  // ── Phase C: LLM Enhancement (non-blocking) ──
  const [llmError, setLlmError] = useState<{
    userMessage: string;
    code: string;
    retryable: boolean;
  } | null>(null);
  const llmRetryParamsRef = useRef<{
    text: string;
    effectiveType: ScriptContentType;
    fallbackResult: ScriptAnalysisResult;
  } | null>(null);

  const runLLMEnrichment = useCallback(async (
    text: string,
    effectiveType: ScriptContentType,
    fallbackResult: ScriptAnalysisResult,
  ) => {
    setLlmError(null);
    llmRetryParamsRef.current = { text, effectiveType, fallbackResult };

    try {
      const prompt = buildAnalysisPrompt(text, effectiveType);

      // Client-side timeout: 58s — slightly under Cloudflare's 60s edge limit.
      // Server has its own adaptive retry (20s Pro → 20s Pro → 12s Flash = 56s max).
      // This AbortController catches the case where the network itself is slow.
      const controller = new AbortController();
      const clientTimeout = setTimeout(() => controller.abort(), 58_000);

      let res: Response;
      try {
        res = await fetch("/api/analyze-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scriptText: text,
            contentTypeHint: effectiveType,
            analysisPrompt: prompt,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(clientTimeout);
      }

      const data = await res.json() as {
        success: boolean;
        analysis?: ScriptAnalysisResult;
        userMessage?: string;
        code?: string;
        retryable?: boolean;
        incomplete?: boolean;
        incompleteReason?: string;
      };

      if (res.ok && data.success && data.analysis && !abortRef.current) {
        const normalized = normalizeAnalysisResult(data.analysis);

        // Guard: reject analysis with no usable sequence structure
        if (normalized.sequences.length === 0) {
          const summaryExists = !!(normalized.thesis || normalized.sourceSummary || normalized.mainHook);
          setLlmError({
            userMessage: summaryExists
              ? "분석 요약은 생성되었으나 시퀀스 구조가 누락되었습니다. 다시 시도하거나 기본 분석을 사용하세요."
              : "분석 결과가 비어 있습니다. 다시 시도해주세요.",
            code: data.incomplete ? "INCOMPLETE_ANALYSIS" : "EMPTY_ANALYSIS",
            retryable: true,
          });
          console.warn(`[ScriptAnalyzer] LLM returned ${summaryExists ? "summary only" : "empty result"} — sequences: 0, incomplete=${data.incomplete}`);
          // Don't overwrite existing heuristic analysis with incomplete LLM result
          return;
        }

        setAnalysis(normalized);
        setDetailedSeqs(new Set(normalized.sequences.map((_, i) => i)));
        setDetailProgress({ done: normalized.sequences.length, total: normalized.sequences.length });
      } else if (!res.ok) {
        // Surface provider error to user
        const errInfo = {
          userMessage: data.userMessage || "AI 심층 분석에 실패했습니다. 기본 분석 결과를 사용합니다.",
          code: data.code || "UNKNOWN_ERROR",
          retryable: data.retryable ?? true,
        };
        setLlmError(errInfo);
        console.warn(`[ScriptAnalyzer] LLM enrichment failed: code=${errInfo.code}, status=${res.status}, message=${errInfo.userMessage}`);
      }
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === "AbortError";
      setLlmError({
        userMessage: isTimeout
          ? "분석 서버 응답 시간이 초과되었습니다. 다시 시도하거나 기본 분석 결과를 사용하세요."
          : "네트워크 오류로 AI 분석에 실패했습니다. 기본 분석 결과를 사용합니다.",
        code: isTimeout ? "CLIENT_TIMEOUT" : "NETWORK_ERROR",
        retryable: true,
      });
      console.warn(`[ScriptAnalyzer] LLM enrichment failed (${isTimeout ? "client timeout" : "network error"}), keeping heuristic result`);
    } finally {
      if (!abortRef.current) setPhase("complete");
    }
  }, []);

  const handleRetryLLM = useCallback(() => {
    const params = llmRetryParamsRef.current;
    if (!params) return;
    setPhase("enriching");
    runLLMEnrichment(params.text, params.effectiveType, params.fallbackResult);
  }, [runLLMEnrichment]);

  const handleSkipLLM = useCallback(() => {
    setLlmError(null);
    setPhase("complete");
  }, []);

  // ── Derived state: is analysis usable? ──
  const analysisUsable = analysis !== null && analysis.sequences.length > 0;

  // ── Apply to workflow ──
  const handleApply = useCallback(() => {
    if (!analysis || !onApply || analysis.sequences.length === 0) return;

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

  const isAnalyzing = phase !== "idle" && phase !== "complete";

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
              disabled={!scriptText.trim() || isAnalyzing}
              className="text-sm"
              style={{
                background: isAnalyzing ? "#999" : "#e09500",
                color: "white",
                boxShadow: isAnalyzing ? "none" : "0 2px 8px #e0950040",
              }}
            >
              {isAnalyzing ? PHASE_LABEL[phase] : "분석하기"}
            </Button>
          </div>

          {/* Phase-specific progress indicator */}
          {phase === "detailing" && detailProgress.total > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px]" style={{ color: "#999" }}>
                <span>시퀀스 상세 생성 중...</span>
                <span>{detailProgress.done}/{detailProgress.total}</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "#e5e5e5" }}>
                <div
                  className="h-full rounded-full transition-all duration-200"
                  style={{
                    width: `${(detailProgress.done / detailProgress.total) * 100}%`,
                    background: "#e09500",
                  }}
                />
              </div>
            </div>
          )}

          {phase === "enriching" && (
            <div className="flex items-center gap-2 text-[10px]" style={{ color: "#8b5cf6" }}>
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "#8b5cf6" }} />
              AI 심층 분석 진행 중... (구조 분석 결과는 이미 표시됨)
            </div>
          )}

          {error && (
            <p className="text-xs p-2 rounded" style={{ color: "#dc2626", background: "#dc262610" }}>
              {error}
            </p>
          )}

          {llmError && phase === "complete" && (
            <div className="text-xs p-3 rounded space-y-2" style={{ color: "#d97706", background: "#d9770610", border: "1px solid #d9770620" }}>
              <p>{llmError.userMessage}</p>
              <div className="flex gap-2">
                {llmError.retryable && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[10px] h-6 px-2"
                    style={{ borderColor: "#d97706", color: "#d97706" }}
                    onClick={handleRetryLLM}
                  >
                    다시 시도
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[10px] h-6 px-2"
                  style={{ borderColor: "#6b7280", color: "#6b7280" }}
                  onClick={handleSkipLLM}
                >
                  바로 생성으로 진행
                </Button>
              </div>
            </div>
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
                  <Badge style={{
                    background: analysis.totalSuggestedRuntime > 0 ? "#e0950015" : "#dc262610",
                    color: analysis.totalSuggestedRuntime > 0 ? "#b87700" : "#dc2626",
                  }}>
                    {analysis.totalSuggestedRuntime > 0 ? `${analysis.totalSuggestedRuntime}초` : "시간 미산출"}
                  </Badge>
                  <Badge style={{
                    background: analysis.sequences.length > 0 ? "#22c55e15" : "#dc262610",
                    color: analysis.sequences.length > 0 ? "#16a34a" : "#dc2626",
                  }}>
                    {analysis.sequences.length > 0 ? `${analysis.suggestedSequenceCount}개 시퀀스` : "시퀀스 없음"}
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

          {/* ── Incomplete analysis warning ── */}
          {analysis.sequences.length === 0 && (analysis.thesis || analysis.sourceSummary) && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="p-3 rounded space-y-2" style={{ background: "#f59e0b10", border: "1px solid #f59e0b30" }}>
                  <p className="text-xs font-medium" style={{ color: "#b87700" }}>
                    분석 불완전: 시퀀스 구조 누락
                  </p>
                  <p className="text-[11px]" style={{ color: "#92700a" }}>
                    분석 요약은 생성되었으나, 영상 제작에 필요한 시퀀스/컷 구조가 생성되지 않았습니다.
                    AI 서버 응답이 잘리거나 불완전했을 수 있습니다.
                  </p>
                  <div className="flex gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-[10px] h-6 px-2"
                      style={{ borderColor: "#e09500", color: "#e09500" }}
                      onClick={handleRetryLLM}
                    >
                      AI 분석 재시도
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-[10px] h-6 px-2"
                      style={{ borderColor: "#6b7280", color: "#6b7280" }}
                      onClick={handleSkipLLM}
                    >
                      기본 분석으로 진행
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Sequence Timeline Overview */}
          {analysis.sequences.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm" style={{ color: "#333" }}>시퀀스 타임라인</CardTitle>
                {onApply && (
                  <Button
                    onClick={handleApply}
                    size="sm"
                    className="text-xs"
                    disabled={phase === "structural" || phase === "detailing" || !analysisUsable}
                    style={{
                      background: analysisUsable ? "#22c55e" : "#999",
                      color: "white",
                      boxShadow: "0 2px 6px #22c55e40",
                      opacity: (phase === "structural" || phase === "detailing") ? 0.5 : 1,
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
                  const isDetailed = detailedSeqs.has(seq.id - 1);
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
                        opacity: expandedSeq === seq.id - 1 ? 1 : isDetailed ? 0.7 : 0.4,
                      }}
                      title={`${seq.title} (${seq.recommendedDurationSec}초)${isDetailed ? "" : " — 상세 로딩 중"}`}
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
                    isDetailed={detailedSeqs.has(seqIdx)}
                    onToggle={() => setExpandedSeq(expandedSeq === seqIdx ? null : seqIdx)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
          )}
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
  isDetailed,
  onToggle,
}: {
  sequence: AnalyzedSequence;
  isExpanded: boolean;
  isDetailed: boolean;
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
        {!isDetailed && (
          <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#e09500" }} />
        )}
        <span className="text-xs" style={{ color: "#ccc" }}>{isExpanded ? "▲" : "▼"}</span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3" style={{ background: meta.bg }}>
          {!isDetailed ? (
            /* Skeleton loading state */
            <div className="py-4 space-y-2">
              <div className="flex items-center gap-2 text-[11px]" style={{ color: "#999" }}>
                <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: meta.color }} />
                상세 정보 생성 중...
              </div>
              {/* Source text (available from Phase A) */}
              <div className="p-2 rounded text-[10px]" style={{ background: "#ffffff80", color: "#666" }}>
                <p className="font-medium mb-1" style={{ color: "#999" }}>원본 대본 구간:</p>
                {seq.sourceText.length > 200
                  ? seq.sourceText.slice(0, 200) + "…"
                  : seq.sourceText}
              </div>
              {/* Skeleton bars for cuts */}
              <div className="space-y-1">
                {Array.from({ length: seq.recommendedCutCount }, (_, i) => (
                  <div key={i} className="h-8 rounded animate-pulse" style={{ background: "#e5e5e5" }} />
                ))}
              </div>
            </div>
          ) : (
            /* Full detailed content */
            <>
              {/* Purpose & Rationale */}
              <div className="pt-2">
                <p className="text-[11px]" style={{ color: "#555" }}>{seq.purpose}</p>
                <p className="text-[10px] mt-1" style={{ color: "#999" }}>
                  <span className="font-medium">이유:</span> {seq.rationale}
                </p>
                {seq.cliffhangerText && (
                  <p className="text-[10px] mt-1 italic" style={{ color: "#ef4444" }}>
                    예고: &ldquo;{seq.cliffhangerText}&rdquo;
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
                    <CutProgressionRow key={cutIdx} cut={cut} />
                  ))}
                </div>
              </div>
            </>
          )}
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

function CutProgressionRow({ cut }: { cut: AnalyzedCut }) {
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
