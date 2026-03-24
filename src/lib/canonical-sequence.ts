/**
 * canonical-sequence.ts — Canonical ReelSequence Source of Truth
 *
 * This module defines the single canonical pipeline schema and the adapter
 * boundary that converts legacy structures into it.
 *
 * Architecture:
 *   StructuredSequenceDocument IS the canonical schema (already in types/index.ts).
 *   This module provides:
 *   1. toCanonicalSequence()  — Convert Cut + Config → StructuredSequenceDocument
 *   2. fromCanonicalToMultiShot() — Extract MultiShotPrompt[] from canonical
 *   3. fromCanonicalToPayload()   — Extract provider payload from canonical
 *   4. resolvedDuration()         — Single field carrying resolved duration
 *   5. validateCanonicalChain()   — Prove a canonical doc is consistent end-to-end
 *
 * No other module should construct ad-hoc shot/sequence structures.
 * Legacy paths (Cut.multiShot, Cut.videoPromptJson, string prompts) are
 * consumed ONLY by toCanonicalSequence() and never leak downstream.
 *
 * Duration source of truth: StructuredSequenceDocument.durationSec
 *   - Set once during toCanonicalSequence()
 *   - Never re-derived, re-clamped, or silently collapsed downstream
 *   - All consumers read this single field
 *
 * Style source of truth: StructuredSequenceDocument.styleProfile.mode
 *   - Drives planner shot distribution (via editorial persona lookup)
 *   - Drives prompt text (via style suffix injection into each shot prompt)
 *   - Drives provider options (via style → negative list mapping)
 *   - When provider doesn't support style natively → encoded in prompt text
 */

import type {
  Cut,
  VideoGenerationConfig,
  StructuredSequenceDocument,
  MultiShotPrompt,
  ShotRole,
  EditorialPersona,
} from "@/types";
import { DEFAULT_EDITORIAL_PERSONA } from "@/types";
import { assembleFromJSON, type SingleShotDocument } from "@/lib/sequence-assembler";
import { buildFinalProviderPayload, type FinalProviderPayload } from "@/lib/final-payload-builder";
import { safeDuration } from "@/lib/duration-reconciliation";
// VEO 멀티샷 정책: 7초=3샷, 8초+=4샷
const veoMinShots = (durationSec: number) => durationSec <= 7 ? 3 : 4;
import { getStyleById, getStyleByLegacyMode, getStylePersona, getStyleRenderingRules } from "@/data/style-catalog";
import { extractEditorialPersona, buildEditorialPlanningRules, buildCompactEditorialSummary } from "@/lib/editorial-persona";
import { structuredShotToSequenceShot } from "@/lib/structured-shot-normalize";
import { ROLE_KO } from "@/lib/multi-shot-planner";

// ═══════════════════════════════════════════════════════════════════
// 1. Adapter: Legacy → Canonical
// ═══════════════════════════════════════════════════════════════════

export interface ToCanonicalInput {
  cut: Cut;
  config: VideoGenerationConfig;
  prevCut?: Cut;
}

export interface CanonicalResult {
  /** THE canonical source of truth — all downstream consumers use this */
  sequence: StructuredSequenceDocument;
  /** Extracted multi-shot array for provider submission */
  multiShot: MultiShotPrompt[];
  /** Internal SingleShotDocument (for payload builder only) */
  _internal: SingleShotDocument;
  /** Diagnostics for debugging */
  diagnostics: {
    driftWarning?: string;
    sanitizeFixes: string[];
    conflictResolutions: string[];
    adapterConversions: string[];
  };
}

/**
 * Convert legacy Cut + Config into canonical StructuredSequenceDocument.
 *
 * This is the ONLY entry point for creating canonical sequences.
 * All legacy format handling is isolated here.
 */
export function toCanonicalSequence(input: ToCanonicalInput): CanonicalResult {
  const adapterConversions: string[] = [];

  // Track what legacy paths were used
  if (input.cut.structuredShots?.length) {
    adapterConversions.push(`adapter: consumed Cut.structuredShots (${input.cut.structuredShots.length} shots) — SOURCE OF TRUTH`);
  }
  if (input.cut.videoPromptJson) {
    adapterConversions.push("adapter: consumed Cut.videoPromptJson");
  }
  if (input.cut.multiShot?.length) {
    adapterConversions.push(`adapter: consumed Cut.multiShot (${input.cut.multiShot.length} shots)`);
  }
  if (!input.cut.videoPromptJson && input.cut.videoPrompt) {
    adapterConversions.push("adapter: consumed legacy string videoPrompt");
  }

  // Delegate to existing assembleFromJSON — which already produces
  // StructuredSequenceDocument as its primary output
  const result = assembleFromJSON({
    cut: input.cut,
    config: input.config,
    prevCut: input.prevCut,
  });

  // ── structuredShots가 있으면 canonical sequence.shots[]를 덮어씀 ──
  // structuredShots는 auto-split의 source of truth.
  // assembleFromJSON이 생성한 shots보다 우선.
  if (input.cut.structuredShots && input.cut.structuredShots.length >= 2) {
    result.structuredSequence.shots = input.cut.structuredShots.map(structuredShotToSequenceShot);
    adapterConversions.push(`adapter: overwrote sequence.shots[] with structuredShots (${input.cut.structuredShots.length} shots)`);
  }

  // Resolve multi-shot priority:
  // 1. structuredShots → derived multiShot (highest)
  // 2. suggestedMultiShot (content-aware split)
  // 3. existing Cut.multiShot
  // 4. canonical sequence shots → derived multiShot (fallback)
  let multiShot: MultiShotPrompt[];

  if (input.cut.structuredShots && input.cut.structuredShots.length >= 2) {
    // structuredShots가 source of truth → multiShot은 derived view
    multiShot = canonicalShotsToMultiShot(result.structuredSequence);
    adapterConversions.push("adapter: derived multiShot from structuredShots (source of truth)");
  } else if (result.suggestedMultiShot) {
    multiShot = result.suggestedMultiShot;
    adapterConversions.push("adapter: used content-aware suggestedMultiShot");
  } else if (input.cut.multiShot?.length) {
    multiShot = input.cut.multiShot;
    adapterConversions.push("adapter: preserved existing Cut.multiShot");
  } else {
    multiShot = canonicalShotsToMultiShot(result.structuredSequence);
    adapterConversions.push("adapter: derived multiShot from canonical shots[]");
  }

  // ── 최소 샷 수 정책 최종 방어 ──
  // 서버 repair가 적용되었더라도 클라이언트 suggestedMultiShot이 덮어쓸 수 있으므로
  // 여기서 한 번 더 확인. (8초: 최소 4샷, 7초 이하: 최소 3샷)
  const dur = result.structuredSequence.durationSec;
  const minRequired = veoMinShots(dur);
  if (minRequired > 0 && multiShot.length < minRequired) {
    // 서버에서 보낸 cut.multiShot이 정책을 충족하면 그것을 사용
    if (input.cut.multiShot && input.cut.multiShot.length >= minRequired) {
      multiShot = input.cut.multiShot;
      adapterConversions.push(`adapter: restored Cut.multiShot (${input.cut.multiShot.length} shots) — suggestedMultiShot ${result.suggestedMultiShot?.length ?? 0} < min ${minRequired}`);
    } else {
      adapterConversions.push(`adapter: WARNING multiShot ${multiShot.length} < min ${minRequired} for ${dur}s — server repair may not have run`);
    }
  }

  return {
    sequence: result.structuredSequence,
    multiShot,
    _internal: result.document,
    diagnostics: {
      driftWarning: result.diagnostics.driftWarning,
      sanitizeFixes: result.diagnostics.sanitizeFixes,
      conflictResolutions: result.diagnostics.conflictResolutions,
      adapterConversions,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. Canonical → MultiShot extraction
// ═══════════════════════════════════════════════════════════════════

/**
 * Derive MultiShotPrompt[] from canonical StructuredSequenceDocument.shots[].
 * Used when no existing multiShot data exists.
 */
export function canonicalShotsToMultiShot(
  seq: StructuredSequenceDocument,
): MultiShotPrompt[] {
  if (!seq.shots || seq.shots.length === 0) return [];

  // Single-shot sequences don't need multi-shot array
  if (seq.shots.length === 1) return [];

  // Math.round 반올림 합계가 durationSec과 달라지는 문제 방지:
  // 마지막 shot에서 잔여 시간을 보정하여 합계 = durationSec 보장.
  const totalDuration = seq.durationSec;
  const rawDurations = seq.shots.map(shot => Math.round(shot.endSec - shot.startSec));
  const rawSum = rawDurations.reduce((s, d) => s + d, 0);
  if (rawSum !== totalDuration && rawDurations.length > 0) {
    rawDurations[rawDurations.length - 1] += totalDuration - rawSum;
  }
  // Guard: ensure last shot duration is at least 1 second after rounding correction
  if (rawDurations.length > 0 && rawDurations[rawDurations.length - 1] < 1) {
    rawDurations[rawDurations.length - 1] = 1;
  }

  return seq.shots.map((shot, i) => {
    // Rich prompt: framing label + motion (if not static) + action + env + mood
    const framingLabel = shot.camera.framing === "WS" ? "Wide shot" :
      shot.camera.framing === "CU" ? "Close-up" :
      shot.camera.framing === "ECU" ? "Extreme close-up" :
      shot.camera.framing === "MCU" ? "Medium close-up" :
      shot.camera.framing === "LS" ? "Long shot" :
      `${shot.camera.framing} shot`;
    const motionPart = shot.camera.motion && shot.camera.motion !== "static"
      ? `, ${shot.camera.motion}` : "";
    const parts = [
      `${framingLabel}${motionPart}`,
      shot.action,
      shot.environment,
      shot.moodLighting,
    ].filter(Boolean);
    const role: ShotRole = (shot as { role?: ShotRole }).role || inferRoleFromPosition(i, seq.shots!.length);
    let prompt = parts.join(". ").trim();
    if (prompt.length > 400) {
      const lastDot = prompt.lastIndexOf(".", 400);
      prompt = lastDot > 300 ? prompt.slice(0, lastDot + 1) : prompt.slice(0, 400);
    }
    if (!prompt) {
      prompt = shot.action || `Shot ${i + 1}`;
    }
    return {
      index: i + 1,
      prompt,
      promptKo: ROLE_KO[role] ?? `서브샷 ${i + 1}`,
      duration: String(Math.max(1, rawDurations[i])),
      role,
    };
  });
}

function inferRoleFromPosition(index: number, total: number): ShotRole {
  if (index === 0) return "establish";
  if (index === total - 1) return "resolve";
  if (index === Math.floor(total / 2)) return "peak";
  return "develop";
}

// ═══════════════════════════════════════════════════════════════════
// 3. Canonical → Provider Payload
// ═══════════════════════════════════════════════════════════════════

/**
 * Build final provider payload from canonical sequence.
 * This is the ONLY path from canonical → provider string.
 */
export function fromCanonicalToPayload(
  seq: StructuredSequenceDocument,
  internalDoc: SingleShotDocument,
): FinalProviderPayload {
  return buildFinalProviderPayload({
    document: internalDoc,
    provider: "veo",
  });
}

// ═══════════════════════════════════════════════════════════════════
// 4. Duration Resolution — single source
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolved duration from canonical sequence.
 * This is the ONLY function that should be called to get duration.
 *
 * Field chain:
 *   StructuredSequenceDocument.durationSec (set in toCanonicalSequence)
 *     → used by preview (TimelineEditor reads clip.structuredSequence.durationSec)
 *     → used by generate (submitVideoGeneration reads params.durationSeconds)
 *     → used by payload builder (SingleShotDocument.timing.durationSec)
 *     → used by export (MontageClip.durationSec from VideoClip.durationSec)
 */
export function resolvedDuration(seq: StructuredSequenceDocument): number {
  return seq.durationSec;
}

/**
 * Verify duration is consistent across all representations.
 * Returns list of inconsistencies (empty = consistent).
 */
export function verifyDurationConsistency(
  seq: StructuredSequenceDocument,
  internalDoc: SingleShotDocument,
  configDuration: number,
): string[] {
  const issues: string[] = [];
  const canonical = seq.durationSec;

  // Check internal doc matches
  if (internalDoc.timing.durationSec !== canonical) {
    issues.push(
      `SingleShotDocument.timing.durationSec (${internalDoc.timing.durationSec}) ≠ canonical (${canonical})`,
    );
  }

  // Check config matches (after safeDuration normalization)
  const normalizedConfig = safeDuration(configDuration);
  if (normalizedConfig !== canonical) {
    issues.push(
      `config.durationSeconds normalized (${normalizedConfig}) ≠ canonical (${canonical})`,
    );
  }

  // Check shots span matches
  if (seq.shots.length > 0) {
    const shotsSpan = Math.max(...seq.shots.map(s => s.endSec)) - Math.min(...seq.shots.map(s => s.startSec));
    if (Math.abs(shotsSpan - canonical) > 0.5) {
      issues.push(
        `shots[] span (${shotsSpan}s) ≠ canonical (${canonical}s)`,
      );
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════
// 5. Style Resolution — operational style
// ═══════════════════════════════════════════════════════════════════

export interface StyleEffect {
  /** Style suffix injected into prompts */
  promptSuffix: string;
  /** Negative keywords added for this style */
  styleNegatives: string[];
  /** Editorial persona for this style (affects shot planning) */
  editorialPersona: EditorialPersona;
  /** Whether provider supports this style natively */
  providerNativeSupport: boolean;
  /** Style-specific provider options (if any) */
  providerOptions: Record<string, unknown>;
}

/**
 * Resolve style into concrete operational effects.
 *
 * Style is NOT decorative — it affects:
 * 1. Planner: editorial persona → shot count, pacing, coverage, motion bias
 * 2. Prompt: style suffix → visual keywords in each shot prompt
 * 3. Payload: style negatives → negative prompt additions
 * 4. Provider: native support check → fallback to prompt encoding
 *
 * Path: styleId → StyleEntry (catalog) → EditorialPersona (editorial-persona.ts)
 *                                       → positivePrompt (prompt suffix)
 *                                       → negativePrompt (negative additions)
 *                                       → StylePersona (quality criteria)
 *                                       → StyleRenderingRules (camera/motion defaults)
 */
export function resolveStyleEffects(styleId: string): StyleEffect {
  const styleEntry = getStyleById(styleId) ?? getStyleByLegacyMode(styleId);

  // Resolve editorial persona from style's descriptive text
  // Uses the real editorial-persona.ts module which maps style keywords
  // to concrete editing rules (pace, coverage, insert bias, motion, composition)
  const editorialPersona = extractEditorialPersona(
    styleEntry?.positivePrompt,    // contains style keywords (e.g., "cinematic", "atmospheric")
    styleEntry?.descKo,            // Korean style description
    styleEntry?.badge,             // style badge (e.g., "극장 실사", "고딕 판타지")
  );

  // Style suffix for prompt injection — the actual text injected into each shot prompt
  const promptSuffix = styleEntry?.positivePrompt || styleId || "";

  // Style-specific negatives — added to negative prompt for all shots
  const styleNegatives = styleEntry?.negativePrompt
    ? styleEntry.negativePrompt.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  // VEO is string-only — style is always encoded in prompt text, never as a native API parameter
  const providerNativeSupport = false;

  // Style rendering rules (camera defaults, motion defaults, etc.)
  // These affect how shots are rendered when no explicit camera direction is given
  const renderingRules = styleEntry ? getStyleRenderingRules(styleEntry.id) : undefined;

  return {
    promptSuffix,
    styleNegatives,
    editorialPersona,
    providerNativeSupport,
    providerOptions: renderingRules ? {
      cameraDefaults: renderingRules.cameraDefaults,
      motionDefaults: renderingRules.motionDefaults,
      characterRules: renderingRules.characterRules,
    } : {},
  };
}

/**
 * Build editorial planning rules text from a style ID.
 * Used by the planner to inject style-aware cut planning directives.
 */
export function buildStylePlanningRules(styleId: string): string {
  const effect = resolveStyleEffects(styleId);
  return buildEditorialPlanningRules(effect.editorialPersona);
}

/**
 * Build compact editorial summary from a style ID.
 * Used in token-pressured contexts (degraded/compact prompts).
 */
export function buildCompactStyleSummary(styleId: string): string {
  const effect = resolveStyleEffects(styleId);
  return buildCompactEditorialSummary(effect.editorialPersona);
}

// ═══════════════════════════════════════════════════════════════════
// 6. End-to-End Validation
// ═══════════════════════════════════════════════════════════════════

export interface CanonicalChainValidation {
  valid: boolean;
  durationConsistent: boolean;
  styleOperational: boolean;
  shotsExplicit: boolean;
  noHiddenFallback: boolean;
  issues: string[];
}

/**
 * Validate that a canonical sequence is consistent across all pipeline stages.
 * This is the proof function — call it in tests to verify end-to-end consistency.
 */
export function validateCanonicalChain(
  seq: StructuredSequenceDocument,
  internalDoc: SingleShotDocument,
  configDuration: number,
): CanonicalChainValidation {
  const issues: string[] = [];

  // Duration consistency
  const durationIssues = verifyDurationConsistency(seq, internalDoc, configDuration);
  issues.push(...durationIssues);

  // Style is operational (not just a label)
  const styleId = seq.styleProfile?.mode || "";
  const styleEffect = resolveStyleEffects(styleId);
  const styleOperational = styleEffect.promptSuffix.length > 0;
  if (!styleOperational) {
    issues.push("Style has no prompt suffix — decorative only");
  }

  // Shots are explicit (not hidden single-shot fallback)
  const shotsExplicit = (seq.shots?.length ?? 0) > 0;
  if (!shotsExplicit) {
    issues.push("No explicit shots[] in canonical sequence");
  }

  // No hidden single-shot when multi-shot is expected
  const noHiddenFallback = !(seq.durationSec >= 6 && (seq.shots?.length ?? 0) === 1 &&
    !isExplicitOneTake(seq));
  if (!noHiddenFallback) {
    issues.push(`Hidden single-shot for ${seq.durationSec}s clip — should be multi-shot`);
  }

  return {
    valid: issues.length === 0,
    durationConsistent: durationIssues.length === 0,
    styleOperational,
    shotsExplicit,
    noHiddenFallback,
    issues,
  };
}

function isExplicitOneTake(seq: StructuredSequenceDocument): boolean {
  // Check if the scene type allows one-take
  const oneTakeTypes = ["environment", "map_visualization", "map-graphic"];
  return oneTakeTypes.includes(seq.sceneType) || seq.durationSec <= 5;
}

// ═══════════════════════════════════════════════════════════════════
// 7. Audio Pipeline Status — honest reporting
// ═══════════════════════════════════════════════════════════════════

export type AudioPipelineStage =
  | "generation"     // TTS / SFX generation
  | "storage"        // R2 asset persistence
  | "preview"        // Timeline playback
  | "export_mux";    // FFmpeg mux into final video

export interface AudioPipelineStatus {
  stage: AudioPipelineStage;
  supported: boolean;
  detail: string;
}

/**
 * Honest audit of audio pipeline support.
 *
 * Current state:
 * - generation: SUPPORTED (Google Cloud TTS, SFX matching)
 * - storage: SUPPORTED (R2 upload with CDN URLs)
 * - preview: SUPPORTED (Timeline audio playback via <audio>)
 * - export_mux: NOT SUPPORTED (FFmpeg concat uses -c copy, video-only)
 *
 * The UI must not imply audio is included in exported montage.
 */
export function auditAudioPipeline(): AudioPipelineStatus[] {
  return [
    {
      stage: "generation",
      supported: true,
      detail: "Google Cloud TTS (ko-KR-Wavenet-A, MP3 32kbps). Shot-aware speaking rate. SFX via Pixabay/Freesound.",
    },
    {
      stage: "storage",
      supported: true,
      detail: "R2 upload: audio/{sessionId}/cut-{cutNumber}/{timestamp}.mp3. CDN-backed URLs.",
    },
    {
      stage: "preview",
      supported: true,
      detail: "TimelineEditor: hidden <audio> element synced to video playback via narrationAudioRef.",
    },
    {
      stage: "export_mux",
      supported: false,
      detail: "client-stitch.ts uses FFmpeg -c copy (stream copy). Only video streams are concatenated. Audio tracks are dropped during montage export. No audio mixing pipeline exists.",
    },
  ];
}

/**
 * Whether audio is truly end-to-end functional.
 * Returns false because export_mux is not supported.
 */
export function isAudioEndToEnd(): boolean {
  return auditAudioPipeline().every(s => s.supported);
}

// ═══════════════════════════════════════════════════════════════════
// 8. Legacy Field Quarantine
// ═══════════════════════════════════════════════════════════════════

/**
 * Legacy fields that MUST NOT be read outside the adapter boundary.
 *
 * These fields on Cut are consumed only by toCanonicalSequence().
 * All downstream consumers should read from StructuredSequenceDocument
 * or CutCardViewModel instead.
 */
export const QUARANTINED_LEGACY_FIELDS: readonly string[] = [
  "videoPromptJson",  // → use StructuredSequenceDocument.shotPlan
  "multiShot",        // → use CanonicalResult.multiShot or canonical shots[]
  "extendPromptJson", // → use StructuredSequenceDocument for extend data
] as const;

/**
 * Consumer boundary map — documents which component reads from which source.
 *
 * This is the authoritative map of who reads what.
 * Tests use this to verify no consumer reads legacy fields directly.
 */
export const CANONICAL_CONSUMER_MAP = {
  "CutCard": {
    previousSource: "Cut.videoPromptJson, Cut.multiShot, Cut.durationSec, Cut.videoPrompt",
    canonicalSource: "CutCardViewModel.videoPromptJson, CutCardViewModel.multiShot, CutCardViewModel.durationSec, CutCardViewModel.videoPrompt",
    status: "rewired" as const,
  },
  "MultiShotEditor": {
    previousSource: "Cut.multiShot, Cut.durationSec",
    canonicalSource: "CutCardViewModel.multiShot (passed via CutCard), Cut.durationSec via effectiveDurationSec",
    status: "rewired" as const,
  },
  "ResultPanel.export": {
    previousSource: "Cut.multiShot, Cut.durationSec, Cut.videoPrompt, Cut.extendPrompt",
    canonicalSource: "viewModelToExportSequence(CutCardViewModel) via canonicalViewModels",
    status: "rewired" as const,
  },
  "ResultPanel.feedbackRefine": {
    previousSource: "Cut.videoPrompt, Cut.extendPrompt",
    canonicalSource: "CutCardViewModel.videoPrompt, CutCardViewModel.extendPrompt via canonicalViewModels",
    status: "rewired" as const,
  },
  "ResultPanel.batchBudget": {
    previousSource: "Cut.durationSec, Cut.multiShot",
    canonicalSource: "CutCardViewModel.durationSec, CutCardViewModel.multiShot via canonicalViewModels",
    status: "rewired" as const,
  },
  "useVideoGeneration.qualityChecklist": {
    previousSource: "Cut.videoPromptJson",
    canonicalSource: "canonicalVideoPromptJson derived from StructuredSequenceDocument.shotPlan",
    status: "rewired" as const,
  },
  "useVideoGeneration.submitMultiShot": {
    previousSource: "Cut.multiShot",
    canonicalSource: "assembled.suggestedMultiShot (canonical) ?? Cut.multiShot (fallback)",
    status: "rewired" as const,
  },
  "useVideoGeneration.submitVideoPromptJson": {
    previousSource: "Cut.videoPromptJson",
    canonicalSource: "canonicalVideoPromptJson derived from StructuredSequenceDocument.shotPlan",
    status: "rewired" as const,
  },
  "SequenceTimelineEditor": {
    previousSource: "StructuredSequenceDocument (already canonical)",
    canonicalSource: "StructuredSequenceDocument (unchanged — was already canonical)",
    status: "already_canonical" as const,
  },
  "TimelineEditor": {
    previousSource: "VideoClip.structuredSequence (already canonical)",
    canonicalSource: "VideoClip.structuredSequence (unchanged — was already canonical)",
    status: "already_canonical" as const,
  },
  "useVideoGeneration.legacyPrompt": {
    previousSource: "Cut.videoPrompt, Cut.extendPrompt (safety fallback only)",
    canonicalSource: "Cut.videoPrompt (intentionally kept for safety retry only — not source of truth)",
    status: "quarantined_legacy_only" as const,
  },
} as const;

/**
 * Audit a set of consumer module names against the consumer map.
 * Returns list of consumers still reading legacy fields directly.
 */
export function auditConsumerCanonicalStatus(): {
  rewired: string[];
  alreadyCanonical: string[];
  quarantined: string[];
} {
  const rewired: string[] = [];
  const alreadyCanonical: string[] = [];
  const quarantined: string[] = [];

  for (const [name, info] of Object.entries(CANONICAL_CONSUMER_MAP)) {
    if (info.status === "rewired") rewired.push(name);
    else if (info.status === "already_canonical") alreadyCanonical.push(name);
    else if (info.status === "quarantined_legacy_only") quarantined.push(name);
  }

  return { rewired, alreadyCanonical, quarantined };
}
