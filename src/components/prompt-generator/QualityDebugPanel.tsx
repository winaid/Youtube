"use client";

/**
 * QualityDebugPanel — 내부 품질 검증용 메타 정보 패널
 *
 * 핵심 엔진 검증에 필요한 모든 메타데이터를 한눈에 표시.
 * Owner-Only V0.9: 외부 사용자용이 아닌 내부 디버그 뷰.
 */

import { useState } from "react";
import type { PromptOutput } from "@/types";
import type { DraftGenerationMeta } from "@/lib/draft-store";

interface Props {
  output: PromptOutput | null;
  meta?: DraftGenerationMeta | null;
}

export default function QualityDebugPanel({ output, meta }: Props) {
  const [open, setOpen] = useState(false);

  if (!output) return null;

  const totalDuration = meta?.totalDurationSec ?? output.cuts.reduce((s, c) => s + c.durationSec, 0);
  const cutCount = output.totalCuts;
  const avgSecPerCut = cutCount > 0 ? +(totalDuration / cutCount).toFixed(1) : 0;
  const shotCount = output.cuts.reduce((s, c) => s + (c.multiShot?.length || 1), 0);
  const hasSequencePlan = !!output.sequencePlan;
  const valErrors = output.sequenceValidation?.summary?.errors ?? meta?.sequenceValidationErrors ?? 0;
  const valWarnings = output.sequenceValidation?.summary?.warnings ?? meta?.sequenceValidationWarnings ?? 0;

  return (
    <div className="border border-zinc-700 rounded-lg overflow-hidden text-xs font-mono">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between bg-zinc-800/80 hover:bg-zinc-700/80 transition-colors text-zinc-300"
      >
        <span className="flex items-center gap-2">
          <span className="text-[10px]">{open ? "▼" : "▶"}</span>
          <span className="font-semibold tracking-wide">QUALITY DEBUG</span>
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
        <div className="px-3 py-2 bg-zinc-900/90 space-y-2 text-zinc-400">
          {/* ── 시간축 ── */}
          <Section title="시간축">
            <Row label="totalDuration" value={`${totalDuration}s`} />
            <Row label="targetCuts" value={String(meta?.targetCuts ?? cutCount)} />
            <Row label="reconciledSecPerCut" value={`${meta?.reconciledSecPerCut ?? avgSecPerCut}s`} />
            <Row label="avgSecPerCut (실측)" value={`${avgSecPerCut}s`} />
          </Section>

          {/* ── 숏폼 리듬 ── */}
          {meta?.shortformRhythm && (
            <Section title="숏폼 리듬 정책">
              <Row label="band" value={meta.shortformRhythm.band} />
              <Row label="minCuts" value={String(meta.shortformRhythm.minCuts)} />
              <Row
                label="is13to15Special"
                value={meta.shortformRhythm.is13to15Special ? "YES" : "no"}
                highlight={meta.shortformRhythm.is13to15Special}
              />
            </Section>
          )}

          {/* ── 서사 ── */}
          <Section title="서사 구조">
            <Row label="narrativeFunction" value={meta?.narrativeFunction ?? "—"} />
            {meta?.temporalBeats && meta.temporalBeats.length > 0 && (
              <Row label="temporalBeats" value={meta.temporalBeats.join(" → ")} />
            )}
          </Section>

          {/* ── 감독 스타일 ── */}
          <Section title="감독 스타일">
            <Row
              label="paceDownWeight"
              value={meta?.directorPaceDownWeight ? "ACTIVE (감독 pace 하향)" : "off"}
              highlight={!!meta?.directorPaceDownWeight}
            />
            <Row label="densityPolicy" value={meta?.densityPolicy ?? "default"} />
          </Section>

          {/* ── 컷/샷 통계 ── */}
          <Section title="컷/샷 통계">
            <Row label="cuts" value={String(cutCount)} />
            <Row label="shots (total)" value={String(shotCount)} />
            <Row label="multishot cuts" value={String(output.cuts.filter(c => (c.multiShot?.length ?? 0) > 1).length)} />
            <Row label="shotCategories" value={[...new Set(output.cuts.map(c => c.shotCategory).filter(Boolean))].join(", ") || "—"} />
          </Section>

          {/* ── 시퀀스 플랜 ── */}
          <Section title="시퀀스 플랜">
            <Row label="hasSequencePlan" value={hasSequencePlan ? "YES" : "NO"} />
            <Row label="validationErrors" value={String(valErrors)} highlight={valErrors > 0} />
            <Row label="validationWarnings" value={String(valWarnings)} highlight={valWarnings > 0} />
          </Section>

          {/* ── Fallback/Degraded ── */}
          {(output.usedFallback || output.degraded) && (
            <Section title="Fallback / Degraded">
              {output.usedFallback && (
                <>
                  <Row label="usedFallback" value="YES" highlight />
                  <Row label="fallbackReason" value={output.fallbackReason ?? "—"} />
                  <Row label="fallbackCause" value={output.fallbackCause ?? "—"} />
                </>
              )}
              {output.degraded && (
                <>
                  <Row label="degraded" value="YES" highlight />
                  <Row label="degradedReason" value={output.degradedReason ?? "—"} />
                </>
              )}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">{title}</div>
      <div className="space-y-0.5 pl-2 border-l border-zinc-700">{children}</div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-zinc-500 min-w-[160px]">{label}</span>
      <span className={highlight ? "text-amber-400 font-semibold" : "text-zinc-300"}>{value}</span>
    </div>
  );
}
