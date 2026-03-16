/**
 * normalize.ts — Data normalization utilities for defensive UI rendering.
 *
 * These functions ensure that data flowing from external sources (LLM responses,
 * partial JSON repair, localStorage recovery) produces a canonical safe shape
 * before reaching UI components.
 *
 * Usage:
 *   - Import at data boundary points (convertToCuts, LLM response handlers)
 *   - NOT scattered across UI components as ad-hoc patches
 */

import type { Cut, MultiShotPrompt, ShotRole } from "@/types";
import type {
  ScriptAnalysisResult,
  AnalyzedSequence,
  AnalyzedCut,
  RetentionStrategy,
  VisualStrategy,
  ScriptAnalysisIssue,
} from "@/types/script-analysis";

/** Coerce any value to a string, defaulting to '' if absent */
export function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Coerce any value to an array, defaulting to [] if absent */
export function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

/** Coerce any value to a number, defaulting to fallback if absent/NaN */
export function safeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

// ═══════════════════════════════════════════════════════════════════
// MultiShotPrompt normalization
// ═══════════════════════════════════════════════════════════════════

const VALID_ROLES: ShotRole[] = ["establish", "develop", "peak", "resolve", "insert", "transition"];

export function normalizeMultiShotPrompt(shot: Partial<MultiShotPrompt> & { index?: number }, fallbackIndex: number): MultiShotPrompt {
  return {
    index: safeNumber(shot.index, fallbackIndex),
    prompt: safeString(shot.prompt),
    duration: safeString(shot.duration) || "3",
    role: (VALID_ROLES.includes(shot.role as ShotRole) ? shot.role : "develop") as ShotRole,
  };
}

export function normalizeMultiShotArray(shots: unknown): MultiShotPrompt[] {
  if (!Array.isArray(shots)) return [];
  return shots.map((s, i) => normalizeMultiShotPrompt(s ?? {}, i + 1));
}

// ═══════════════════════════════════════════════════════════════════
// Cut normalization
// ═══════════════════════════════════════════════════════════════════

export function normalizeCut(raw: Partial<Cut>, fallbackCutNumber: number): Cut {
  return {
    cutNumber: safeNumber(raw.cutNumber, fallbackCutNumber),
    durationSec: safeNumber(raw.durationSec, 8),
    sceneDescription: safeString(raw.sceneDescription),
    cameraDirection: safeString(raw.cameraDirection),
    moodLighting: safeString(raw.moodLighting),
    imagePrompt: safeString(raw.imagePrompt),
    endImagePrompt: safeString(raw.endImagePrompt),
    videoPrompt: safeString(raw.videoPrompt),
    extendPrompt: safeString(raw.extendPrompt),
    transitionHint: safeString(raw.transitionHint),
    characterConsistency: safeString(raw.characterConsistency),
    charactersInScene: safeArray<string>(raw.charactersInScene),
    shotCategory: raw.shotCategory,
    characterRole: raw.characterRole,
    structureType: raw.structureType,
    durationClass: raw.durationClass,
    groupId: raw.groupId,
    intentionalOneTake: raw.intentionalOneTake,
    multiShot: raw.multiShot ? normalizeMultiShotArray(raw.multiShot) : undefined,
    videoPromptJson: raw.videoPromptJson,
    extendPromptJson: raw.extendPromptJson,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ScriptAnalysisResult normalization
// ═══════════════════════════════════════════════════════════════════

function normalizeRetentionStrategy(raw: Partial<RetentionStrategy> | undefined): RetentionStrategy {
  return {
    curiosityPoint: safeString(raw?.curiosityPoint),
    informationGain: safeString(raw?.informationGain),
    escalation: safeString(raw?.escalation),
    payoff: safeString(raw?.payoff),
  };
}

function normalizeVisualStrategy(raw: Partial<VisualStrategy> | undefined): VisualStrategy {
  const validDrivers = ["spectacle", "emotion", "reaction", "concept-reveal", "contrast", "atmosphere"] as const;
  const validLandings = ["payoff", "reaction", "unresolved-curiosity"] as const;
  return {
    primaryDriver: validDrivers.includes(raw?.primaryDriver as typeof validDrivers[number])
      ? raw!.primaryDriver! : "concept-reveal",
    finalFrameLanding: validLandings.includes(raw?.finalFrameLanding as typeof validLandings[number])
      ? raw!.finalFrameLanding! : "unresolved-curiosity",
    toneHint: safeString(raw?.toneHint),
  };
}

function normalizeAnalyzedCut(raw: Partial<AnalyzedCut> | undefined): AnalyzedCut {
  return {
    role: (VALID_ROLES.includes(raw?.role as ShotRole) ? raw!.role : "develop") as ShotRole,
    visualFocus: safeString(raw?.visualFocus) as AnalyzedCut["visualFocus"] || "action",
    changeFromPrevious: safeString(raw?.changeFromPrevious),
    narrativeFunction: safeString(raw?.narrativeFunction),
    suggestedPromptIntent: safeString(raw?.suggestedPromptIntent),
    retentionReason: safeString(raw?.retentionReason),
  };
}

export function normalizeAnalyzedSequence(raw: Partial<AnalyzedSequence>, fallbackId: number): AnalyzedSequence {
  const cuts = safeArray<Partial<AnalyzedCut>>(raw.cuts).map(c => normalizeAnalyzedCut(c));

  return {
    id: safeNumber(raw.id, fallbackId),
    title: safeString(raw.title) || `시퀀스 ${fallbackId}`,
    purpose: safeString(raw.purpose),
    beatType: safeString(raw.beatType) as AnalyzedSequence["beatType"] || "development",
    sourceText: safeString(raw.sourceText),
    sourceSpan: raw.sourceSpan,
    recommendedDurationSec: safeNumber(raw.recommendedDurationSec, 8),
    recommendedCutCount: safeNumber(raw.recommendedCutCount, cuts.length || 2),
    rationale: safeString(raw.rationale),
    endingMode: safeString(raw.endingMode) as AnalyzedSequence["endingMode"] || "close",
    cliffhangerText: raw.cliffhangerText ? safeString(raw.cliffhangerText) : undefined,
    retentionStrategy: normalizeRetentionStrategy(raw.retentionStrategy),
    visualStrategy: normalizeVisualStrategy(raw.visualStrategy),
    cuts,
  };
}

function normalizeIssue(raw: Partial<ScriptAnalysisIssue>): ScriptAnalysisIssue {
  return {
    code: safeString(raw.code) as ScriptAnalysisIssue["code"] || "short_script",
    severity: (raw.severity === "info" || raw.severity === "warning" || raw.severity === "error")
      ? raw.severity : "info",
    message: safeString(raw.message),
    suggestion: raw.suggestion ? safeString(raw.suggestion) : undefined,
  };
}

/**
 * Normalize a ScriptAnalysisResult from LLM or partial data into a safe canonical shape.
 * Every string field defaults to '', every array to [], every nested object to safe defaults.
 */
export function normalizeAnalysisResult(raw: Partial<ScriptAnalysisResult> | undefined): ScriptAnalysisResult {
  if (!raw) {
    return {
      sourceSummary: "",
      mainHook: "",
      thesis: "",
      totalSuggestedRuntime: 0,
      suggestedSequenceCount: 0,
      structuralNotes: [],
      weaknesses: [],
      issues: [],
      confidence: "low",
      sequences: [],
    };
  }

  const sequences = safeArray<Partial<AnalyzedSequence>>(raw.sequences)
    .map((seq, i) => normalizeAnalyzedSequence(seq ?? {}, i + 1));

  const hasSummary = !!(safeString(raw.sourceSummary) || safeString(raw.thesis) || safeString(raw.mainHook));
  const hasSequences = sequences.length > 0;
  const hasUsableCuts = sequences.some(s => (s.cuts?.length ?? 0) > 0);

  // If summary exists but no sequences, flag as incomplete
  const issues = safeArray<Partial<ScriptAnalysisIssue>>(raw.issues).map(i => normalizeIssue(i ?? {}));
  if (hasSummary && !hasSequences) {
    issues.push({
      code: "INCOMPLETE_ANALYSIS",
      severity: "error",
      message: "분석 요약은 생성되었으나 시퀀스 구조가 누락되었습니다. 다시 시도하세요.",
    });
  } else if (hasSequences && !hasUsableCuts) {
    issues.push({
      code: "EMPTY_CUTS",
      severity: "warning",
      message: "시퀀스 구조는 있으나 개별 컷 정보가 비어 있습니다.",
    });
  }

  return {
    sourceSummary: safeString(raw.sourceSummary),
    mainHook: safeString(raw.mainHook),
    thesis: safeString(raw.thesis),
    totalSuggestedRuntime: safeNumber(raw.totalSuggestedRuntime, 0),
    suggestedSequenceCount: safeNumber(raw.suggestedSequenceCount, sequences.length),
    structuralNotes: safeArray<string>(raw.structuralNotes).map(safeString),
    weaknesses: safeArray<string>(raw.weaknesses).map(safeString),
    issues,
    confidence: (raw.confidence === "low" || raw.confidence === "medium" || raw.confidence === "high")
      ? raw.confidence : "low",
    sequences,
  };
}
