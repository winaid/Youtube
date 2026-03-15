"use client";

import {
  calculateBudgetSummary,
  suggestBudgetActions,
  getBudgetStatus,
  getBudgetStatusColor,
  DEFAULT_BUDGET_LIMIT_SEC,
  type ClipBudgetEntry,
  type BudgetAction,
} from "@/lib/runtime-budget";
import { useState } from "react";

interface RuntimeBudgetBarProps {
  entries: ClipBudgetEntry[];
  onUpdateEntries: (entries: ClipBudgetEntry[]) => void;
  budgetLimitSec?: number;
}

export default function RuntimeBudgetBar({
  entries,
  onUpdateEntries: _onUpdateEntries,
  budgetLimitSec = DEFAULT_BUDGET_LIMIT_SEC,
}: RuntimeBudgetBarProps) {
  const [showActions, setShowActions] = useState(false);

  const summary = calculateBudgetSummary(entries, budgetLimitSec);
  const status = getBudgetStatus(summary);
  const colors = getBudgetStatusColor(status);
  const actions = suggestBudgetActions(entries, summary);

  const progressWidth = Math.min(summary.utilizationPercent, 100);

  return (
    <div
      className="border-b px-4 md:px-6 py-2"
      style={{ background: colors.bg, borderColor: colors.border }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Stats */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span style={{ color: "#666" }}>프로젝트 예산</span>
              <span className="font-bold" style={{ color: colors.text }}>
                {Math.round(summary.totalPlannedSec)}s / {budgetLimitSec}s
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ color: "#666" }}>세그먼트</span>
              <span className="font-medium">{summary.totalClips}개</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ color: "#666" }}>평균</span>
              <span className="font-medium">{summary.averageSecPerClip}s/seg</span>
            </div>
          </div>

          {/* Center: Progress Bar */}
          <div className="flex-1 max-w-xs">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "#e5e7eb" }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progressWidth}%`,
                  background: status === "over"
                    ? "linear-gradient(90deg, #ef4444, #dc2626)"
                    : status === "warning"
                      ? "linear-gradient(90deg, #eab308, #ca8a04)"
                      : "linear-gradient(90deg, #22c55e, #16a34a)",
                }}
              />
            </div>
          </div>

          {/* Right: Status + Actions */}
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-bold px-2 py-0.5 rounded"
              style={{ color: colors.text, background: `${colors.text}15` }}
            >
              {summary.utilizationPercent}%
            </span>
            {summary.overBudget && (
              <button
                onClick={() => setShowActions(!showActions)}
                className="text-xs font-medium px-2 py-1 rounded border transition-colors"
                style={{ color: "#dc2626", borderColor: "#fecaca", background: "white" }}
              >
                +{Math.round(summary.overBudgetSec)}s 초과 — 조치 보기
              </button>
            )}
          </div>
        </div>

        {/* Actions Panel */}
        {showActions && actions.length > 0 && (
          <div className="mt-2 pt-2 border-t" style={{ borderColor: colors.border }}>
            <div className="grid gap-1.5">
              {actions.map((action: BudgetAction, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs p-2 rounded"
                  style={{ background: "white" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: "#333" }}>{action.label}</span>
                    <span style={{ color: "#888" }}>{action.description}</span>
                  </div>
                  <span className="font-bold" style={{ color: "#16a34a" }}>
                    -{action.savingsSec}s
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
