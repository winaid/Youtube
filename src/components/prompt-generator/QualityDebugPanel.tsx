"use client";

/**
 * QualityDebugPanel — 내부 품질 검증용 메타 정보 패널
 *
 * 단순 숫자 나열이 아니라, 오너가 빠르게 '좋다/이상하다'를 판단하는 도구.
 * Owner-Only V0.9: 외부 사용자용이 아닌 내부 디버그 뷰.
 */

import { useState } from "react";
import type { PromptOutput } from "@/types";
import type { DraftGenerationMeta } from "@/lib/draft-store";

interface Props {
  output: PromptOutput | null;
  meta?: DraftGenerationMeta | null;
  sampleHint?: { verifyPoint: string; suspectOnFail: string } | null;
}

export default function QualityDebugPanel({ output, meta, sampleHint }: Props) {
  const [open, setOpen] = useState(false);

  if (!output) return null;

  const totalDuration = meta?.totalDurationSec ?? output.cuts.reduce((s, c) => s + c.durationSec, 0);
  const cutCount = output.totalCuts;
  const avgSecPerCut = cutCount > 0 ? +(totalDuration / cutCount).toFixed(1) : 0;
  const shotCount = output.cuts.reduce((s, c) => s + (c.multiShot?.length || 1), 0);
  const hasSequencePlan = !!output.sequencePlan;
  const valErrors = output.sequenceValidation?.summary?.errors ?? meta?.sequenceValidationErrors ?? 0;
  const valWarnings = output.sequenceValidation?.summary?.warnings ?? meta?.sequenceValidationWarnings ?? 0;

  // Duration band classification
  const durationBand = totalDuration <= 10 ? "≤10s 초단편"
    : totalDuration <= 12 ? "10-12s 숏폼"
    : totalDuration <= 15 ? "13-15s 숏폼"
    : totalDuration <= 30 ? "16-30s 미디엄"
    : totalDuration <= 60 ? "31-60s 표준"
    : `${totalDuration}s 장편`;

  const isShortform = totalDuration <= 15;
  const is13to15 = totalDuration >= 13 && totalDuration <= 15;

  // Per-cut durations
  const cutDurations = output.cuts.map(c => c.durationSec);
  const cutShotCounts = output.cuts.map(c => c.multiShot?.length || 1);

  // Minimum expected cuts for this duration
  const expectedMinCuts = is13to15 ? 4
    : (totalDuration >= 10 && totalDuration < 13) ? 3
    : totalDuration < 10 ? 1
    : Math.max(3, Math.ceil(totalDuration / 15));

  // Generate rationale messages
  const rationale: string[] = meta?.rationale ? [...meta.rationale] : [];

  if (is13to15 && cutCount >= 4) {
    rationale.push("15초 숏폼 리듬을 위해 최소 4컷을 유지했습니다.");
  }
  if (meta?.directorPaceDownWeight) {
    rationale.push("감독 페이스보다 장면 전개 리듬을 우선해 컷 길이를 압축했습니다.");
  }
  if (output.usedFallback) {
    rationale.push(`Fallback 경로 사용: ${output.fallbackReason ?? "원인 미상"}`);
  }
  if (meta?.genericSplitFallback) {
    rationale.push("샷 구성이 빈약해 fallback split으로 보정했습니다.");
  }
  if (meta?.outlineOnly) {
    rationale.push("Outline-only path로 생성됨 — 디테일이 제한적일 수 있습니다.");
  }
  if (cutCount < expectedMinCuts) {
    rationale.push(`컷 수(${cutCount})가 정책 최소(${expectedMinCuts})보다 적습니다.`);
  }
  if (output.degraded) {
    rationale.push(`자동 조정됨: ${output.degradedReason ?? "사유 미상"}`);
  }
  if (meta?.fastPathUsed) {
    rationale.push("Fast path 사용: step2/3 건너뜀 — outline 기반 프롬프트만 사용됨.");
  }

  // Status summary
  const hasIssues = output.usedFallback || output.degraded || valErrors > 0 || cutCount < expectedMinCuts;
  const statusColor = hasIssues ? "text-amber-400" : "text-green-400";
  const statusText = hasIssues ? "점검 필요" : "정상";

  return (
    <div className="border border-zinc-700 rounded-lg overflow-hidden text-xs font-mono">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between bg-zinc-800/80 hover:bg-zinc-700/80 transition-colors text-zinc-300"
      >
        <span className="flex items-center gap-2">
          <span className="text-[10px]">{open ? "▼" : "▶"}</span>
          <span className="font-semibold tracking-wide">QUALITY DEBUG</span>
          <span className={`text-[10px] font-semibold ${statusColor}`}>{statusText}</span>
          {meta?.fastPathUsed && (
            <span className="px-1.5 py-0.5 rounded bg-cyan-900/60 text-cyan-300 text-[10px]">FAST PATH</span>
          )}
          {output.usedFallback && (
            <span className="px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300 text-[10px]">FALLBACK</span>
          )}
          {output.degraded && (
            <span className="px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 text-[10px]">DEGRADED</span>
          )}
          {valErrors > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 text-[10px]">ERR:{valErrors}</span>
          )}
        </span>
        <span className="text-zinc-500">{cutCount}cuts / {shotCount}shots / {totalDuration}s</span>
      </button>

      {open && (
        <div className="px-3 py-2 bg-zinc-900/90 space-y-3 text-zinc-400">

          {/* ── Rationale (가장 중요 — 맨 위) ── */}
          {rationale.length > 0 && (
            <div className="bg-zinc-800/60 rounded px-2.5 py-2 space-y-1">
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest">판단 근거</div>
              {rationale.map((r, i) => (
                <div key={i} className="text-zinc-300 text-[11px] leading-relaxed">
                  → {r}
                </div>
              ))}
            </div>
          )}

          {/* ── Sample verification hint ── */}
          {sampleHint && (
            <div className="bg-violet-900/20 border border-violet-700/30 rounded px-2.5 py-2 space-y-1">
              <div className="text-[10px] text-violet-400 uppercase tracking-widest">검증 포인트</div>
              <div className="text-zinc-300 text-[11px] leading-relaxed">
                확인: {sampleHint.verifyPoint}
              </div>
              <div className="text-zinc-500 text-[10px]">
                실패 시 의심: {sampleHint.suspectOnFail}
              </div>
            </div>
          )}

          {/* ── 1. Duration / Rhythm ── */}
          <Section title="1. Duration / Rhythm">
            <Row label="totalDuration" value={`${totalDuration}s`} />
            <Row label="duration band" value={durationBand} highlight={isShortform} />
            <Row label="minimum cuts (정책)" value={String(expectedMinCuts)} />
            <Row label="targetCuts" value={String(meta?.targetCuts ?? cutCount)} />
            <Row label="actualCuts" value={String(cutCount)} highlight={cutCount < expectedMinCuts} />
            <Row label="reconciledSecPerCut" value={`${meta?.reconciledSecPerCut ?? avgSecPerCut}s`} />
            <Row label="avgSecPerCut (실측)" value={`${avgSecPerCut}s`} />
            <Row
              label="shortform rhythm 적용"
              value={meta?.shortformRhythm ? `YES — ${meta.shortformRhythm.band}` : isShortform ? "해당 (메타 없음)" : "비해당"}
              highlight={!!meta?.shortformRhythm?.is13to15Special}
            />
            <Row
              label="13~15s special handling"
              value={is13to15 ? (meta?.shortformRhythm?.is13to15Special ? "YES (4컷 보장)" : "해당 (메타 미확인)") : "비해당"}
              highlight={is13to15}
            />
            <Row label="cut durations" value={cutDurations.join(", ") + "s"} />
          </Section>

          {/* ── 2. Narrative / Structure ── */}
          <Section title="2. Narrative / Structure">
            <Row label="narrativeFunction" value={meta?.narrativeFunction ?? "—"} />
            {meta?.temporalBeats && meta.temporalBeats.length > 0 && (
              <Row label="temporalBeats" value={meta.temporalBeats.join(" → ")} />
            )}
            <Row label="cuts" value={String(cutCount)} />
            <Row label="cut별 shots" value={cutShotCounts.join(", ")} />
            <Row label="total shots" value={String(shotCount)} />
            <Row label="shotCategories" value={[...new Set(output.cuts.map(c => c.shotCategory).filter(Boolean))].join(", ") || "—"} />
            <Row label="multishot cuts" value={String(output.cuts.filter(c => (c.multiShot?.length ?? 0) > 1).length)} />
          </Section>

          {/* ── 3. Director / Style ── */}
          <Section title="3. Director / Style">
            <Row label="director requested" value={meta?.directorRequested ?? "—"} />
            <Row label="director pace requested" value={meta?.directorPaceResult ? `→ ${meta.directorPaceResult}` : "—"} />
            <Row
              label="paceDownWeight"
              value={meta?.directorPaceDownWeight ? "ACTIVE (감독 pace 하향)" : "off"}
              highlight={!!meta?.directorPaceDownWeight}
            />
            {meta?.directorWeakenReason && (
              <Row label="style 약화 사유" value={meta.directorWeakenReason} highlight />
            )}
            <Row label="densityPolicy" value={meta?.densityPolicy ?? "default"} />
          </Section>

          {/* ── 4. Reliability / Fallback ── */}
          <Section title="4. Reliability / Fallback">
            <Row label="usedFallback" value={output.usedFallback ? "YES" : "no"} highlight={output.usedFallback} />
            {output.usedFallback && (
              <>
                <Row label="fallbackReason" value={output.fallbackReason ?? "—"} />
                <Row label="fallbackCause" value={output.fallbackCause ?? "—"} />
              </>
            )}
            <Row label="degraded" value={output.degraded ? "YES" : "no"} highlight={output.degraded} />
            {output.degraded && (
              <Row label="degradedReason" value={output.degradedReason ?? "—"} />
            )}
            <Row label="providerError" value={meta?.providerError ?? "없음"} highlight={!!meta?.providerError} />
            <Row label="outlineOnly" value={meta?.outlineOnly ? "YES" : "no"} highlight={meta?.outlineOnly} />
            <Row label="genericSplitFallback" value={meta?.genericSplitFallback ? "YES" : "no"} highlight={meta?.genericSplitFallback} />
          </Section>

          {/* ── 5. Fast Path / Latency ── */}
          <Section title="5. Fast Path / Latency">
            <Row label="fastPathUsed" value={meta?.fastPathUsed ? "YES (step2/3 skip)" : "no"} highlight={meta?.fastPathUsed} />
            <Row label="outlineOnly" value={meta?.outlineOnly ? "YES" : "no"} highlight={meta?.outlineOnly} />
            {meta?.totalLatencyMs != null && (
              <>
                <Row label="totalLatencyMs" value={`${meta.totalLatencyMs}ms (${(meta.totalLatencyMs / 1000).toFixed(1)}s)`} />
                {meta.step1LatencyMs != null && (
                  <Row label="step1LatencyMs" value={`${meta.step1LatencyMs}ms`} />
                )}
                {meta.step23LatencyMs != null && (
                  <Row label="step23LatencyMs" value={`${meta.step23LatencyMs}ms`} highlight={meta.fastPathUsed && meta.step23LatencyMs < 100} />
                )}
              </>
            )}
            <Row label="totalShotCount" value={String(meta?.totalShotCount ?? shotCount)} />
          </Section>

          {/* ── 6. Sequence Plan ── */}
          <Section title="6. Sequence Plan">
            <Row label="hasSequencePlan" value={hasSequencePlan ? "YES" : "NO"} />
            <Row label="validationErrors" value={String(valErrors)} highlight={valErrors > 0} />
            <Row label="validationWarnings" value={String(valWarnings)} highlight={valWarnings > 0} />
          </Section>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5 font-semibold">{title}</div>
      <div className="space-y-0.5 pl-2 border-l border-zinc-700">{children}</div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-zinc-500 min-w-[180px] shrink-0">{label}</span>
      <span className={highlight ? "text-amber-400 font-semibold" : "text-zinc-300"}>{value}</span>
    </div>
  );
}
