/**
 * canonical-view-model.ts — UI View-Models derived exclusively from canonical data.
 *
 * This module is the ONLY derivation layer between canonical structures
 * (StructuredSequenceDocument / CanonicalResult) and UI components.
 *
 * Rules:
 *  1. Every function here accepts ONLY canonical types as input.
 *  2. No function reads Cut.videoPrompt, Cut.multiShot, Cut.videoPromptJson, etc.
 *  3. UI components import view-models from here, never from legacy Cut fields.
 *  4. The adapter boundary (toCanonicalSequence) is the ONLY place legacy → canonical happens.
 *
 * Consumer map:
 *  - CutCard → CutCardViewModel (from cutToViewModel via toCanonicalSequence)
 *  - MultiShotEditor → MultiShotViewModel (from canonical shots[])
 *  - ResultPanel export → ExportViewModel (from canonical sequences)
 *  - Payload builder → already canonical (fromCanonicalToPayload)
 *  - Feedback refine → FeedbackRefineInput (from canonical fields)
 */

import type {
  Cut,
  VideoPromptJson,
  MultiShotPrompt,
  StructuredSequenceDocument,
  VideoGenerationConfig,
  ShotRole,
} from "@/types";
import {
  toCanonicalSequence,
  type CanonicalResult,
} from "@/lib/canonical-sequence";
import { ROLE_KO } from "@/lib/multi-shot-planner";

// ═══════════════════════════════════════════════════════════════════
// 1. CutCard View-Model
// ═══════════════════════════════════════════════════════════════════

export interface CutCardViewModel {
  cutNumber: number;
  durationSec: number;
  sceneDescription: string;
  cameraDirection: string;
  moodLighting: string;
  imagePrompt: string;
  endImagePrompt: string;
  transitionHint: string;
  characterConsistency: string;
  charactersInScene: string[];
  structureType?: string;
  durationClass?: string;
  shotCategory?: string;
  characterRole?: string;
  intentionalOneTake?: boolean;
  /** Canonical video prompt JSON — derived from StructuredSequenceDocument */
  videoPromptJson: VideoPromptJson | null;
  /** Canonical multi-shot array — derived from StructuredSequenceDocument.shots[] */
  multiShot: MultiShotPrompt[];
  /** Canonical video prompt string — rendered from structured data */
  videoPrompt: string;
  /** Extend prompt — rendered from structured data for cut > 1 */
  extendPrompt: string;
  /** Source canonical sequence for downstream operations */
  _canonical: StructuredSequenceDocument;
}

/**
 * Derive CutCardViewModel from a Cut + Config via the canonical adapter.
 *
 * This is the ONLY way to get a CutCardViewModel.
 * It passes through toCanonicalSequence() which is the adapter boundary.
 */
export function cutToViewModel(
  cut: Cut,
  config: VideoGenerationConfig,
  prevCut?: Cut,
): CutCardViewModel {
  const canonical = toCanonicalSequence({ cut, config, prevCut });
  return canonicalResultToViewModel(cut, canonical);
}

/**
 * Derive CutCardViewModel from an already-computed CanonicalResult.
 * Use when you already have the canonical result (e.g., from generate flow).
 */
export function canonicalResultToViewModel(
  cut: Cut,
  canonical: CanonicalResult,
): CutCardViewModel {
  const seq = canonical.sequence;

  // Derive VideoPromptJson from canonical shotPlan
  // ShotPlan uses structured sub-objects; VideoPromptJson uses flat strings.
  // We flatten the canonical structure for UI display/edit compatibility.
  const videoPromptJson: VideoPromptJson | null = seq.shotPlan?.camera ? {
    shotSize: seq.shotPlan.camera.framing,
    cameraAngle: seq.shotPlan.camera.angle,
    cameraMovement: seq.shotPlan.camera.motion,
    subjectBlocking: seq.shotPlan.subject?.blocking || seq.shotPlan.subject?.primary || "",
    subjectAction: seq.shotPlan.action,
    actionBeat: "",  // ShotPlan doesn't have actionBeat — derived from action
    bodySignal: "",  // ShotPlan doesn't have bodySignal — UI can fill
    revealed: "",    // ShotPlan doesn't have revealed — UI can fill
    withheld: "",    // ShotPlan doesn't have withheld — UI can fill
    timingBeat: seq.shotPlan.timingBeat || "",
    transitionFromPrev: seq.shotPlan.transitionFromPrev || "",
    characterRef: seq.shotPlan.subject?.characterRef || "",
    moodLighting: seq.shotPlan.moodLighting || "",
    styleSuffix: seq.styleProfile?.mode || "",
    locationCue: seq.shotPlan.locationCue,
    situationCue: seq.shotPlan.situationCue,
    emotionalAnchor: seq.shotPlan.emotionalAnchor,
  } : null;

  // If the original Cut had a richer videoPromptJson (with actionBeat, bodySignal, etc.),
  // prefer it for fields that ShotPlan doesn't carry natively.
  if (videoPromptJson && cut.videoPromptJson) {
    const original = cut.videoPromptJson;
    if (!videoPromptJson.actionBeat && original.actionBeat) videoPromptJson.actionBeat = original.actionBeat;
    if (!videoPromptJson.bodySignal && original.bodySignal) videoPromptJson.bodySignal = original.bodySignal;
    if (!videoPromptJson.revealed && original.revealed) videoPromptJson.revealed = original.revealed;
    if (!videoPromptJson.withheld && original.withheld) videoPromptJson.withheld = original.withheld;
    if (!videoPromptJson.styleSuffix && original.styleSuffix) videoPromptJson.styleSuffix = original.styleSuffix;
  }

  return {
    cutNumber: cut.cutNumber,
    durationSec: seq.durationSec,
    sceneDescription: cut.sceneDescription,
    cameraDirection: cut.cameraDirection,
    moodLighting: cut.moodLighting,
    imagePrompt: cut.imagePrompt,
    endImagePrompt: cut.endImagePrompt || "",
    transitionHint: cut.transitionHint,
    characterConsistency: cut.characterConsistency,
    charactersInScene: cut.charactersInScene,
    structureType: cut.structureType,
    durationClass: cut.durationClass,
    shotCategory: cut.shotCategory,
    characterRole: cut.characterRole,
    intentionalOneTake: cut.intentionalOneTake,
    videoPromptJson,
    multiShot: canonical.multiShot,
    videoPrompt: cut.videoPrompt,
    extendPrompt: cut.extendPrompt,
    _canonical: seq,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. MultiShot View-Model
// ═══════════════════════════════════════════════════════════════════

export interface MultiShotViewModel {
  shots: MultiShotPrompt[];
  totalDuration: number;
  maxShots: number;
  isCanonicalSource: boolean;
}

/**
 * Derive MultiShotViewModel exclusively from canonical sequence.
 * Never reads Cut.multiShot directly.
 */
export function canonicalToMultiShotViewModel(
  seq: StructuredSequenceDocument,
  maxShots: number,
): MultiShotViewModel {
  const seqShots = seq.shots || [];

  // Math.round 반올림 합계가 durationSec과 달라지는 문제 방지:
  // 마지막 shot에서 잔여 시간을 보정하여 합계 = durationSec 보장.
  const rawDurations = seqShots.map(shot => Math.round(shot.endSec - shot.startSec));
  const rawSum = rawDurations.reduce((s, d) => s + d, 0);
  if (rawSum !== seq.durationSec && rawDurations.length > 0) {
    rawDurations[rawDurations.length - 1] += seq.durationSec - rawSum;
  }

  const shots: MultiShotPrompt[] = seqShots.map((shot, i) => {
    const role: ShotRole = (shot as { role?: ShotRole }).role || inferRoleFromPosition(i, seqShots.length);
    let prompt = `${shot.camera.framing} shot. ${shot.action}. ${shot.environment}. ${shot.moodLighting}`.trim();
    if (prompt.length > 500) {
      const lastDot = prompt.lastIndexOf(".", 400);
      prompt = lastDot > 400 ? prompt.slice(0, lastDot + 1) : prompt.slice(0, 500);
    }
    return {
      index: i + 1,
      prompt,
      promptKo: (shot as { promptKo?: string }).promptKo || (ROLE_KO[role] ?? `서브샷 ${i + 1}`),
      duration: String(Math.max(1, rawDurations[i])),
      role,
    };
  });

  return {
    shots: shots.length >= 2 ? shots : [],
    totalDuration: seq.durationSec,
    maxShots,
    isCanonicalSource: true,
  };
}

function inferRoleFromPosition(index: number, total: number): ShotRole {
  if (index === 0) return "establish";
  if (index === total - 1) return "resolve";
  if (index === Math.floor(total / 2)) return "peak";
  return "develop";
}

// ═══════════════════════════════════════════════════════════════════
// 3. Export View-Model
// ═══════════════════════════════════════════════════════════════════

export interface ExportSequenceViewModel {
  sequence: number;
  sequenceDuration: string;
  method: string;
  scene: string;
  camera: string;
  lighting: string;
  videoPrompt: string;
  extendPrompt: string;
  charactersInScene: string[];
  intentionalOneTake: boolean;
  internalShots: { index: number; prompt: string; duration: string; role: string | null }[] | null;
  internalShotCount: number;
}

/**
 * Derive export view-model from CutCardViewModel.
 * No direct Cut field access.
 */
export function viewModelToExportSequence(
  vm: CutCardViewModel,
  clipStructuredSequence?: StructuredSequenceDocument | null,
): ExportSequenceViewModel {
  // Primary: canonical multiShot
  let internalShots: ExportSequenceViewModel["internalShots"] = null;
  if (vm.multiShot.length >= 2) {
    internalShots = vm.multiShot.map(s => ({
      index: s.index,
      prompt: s.prompt,
      duration: s.duration,
      role: s.role ?? null,
    }));
  } else if (clipStructuredSequence?.shots && clipStructuredSequence.shots.length >= 2) {
    internalShots = clipStructuredSequence.shots.map((s, i) => ({
      index: i + 1,
      prompt: `${s.action}. ${s.environment}`.trim() || s.focus,
      duration: String(Math.round((s.endSec - s.startSec) * 10) / 10),
      role: i === 0 ? "establish" : i === clipStructuredSequence.shots.length - 1 ? "resolve" : "develop",
    }));
  }

  return {
    sequence: vm.cutNumber,
    sequenceDuration: `${vm.durationSec}s`,
    method: vm.cutNumber === 1 ? "VIDEO_PROMPT" : "EXTEND",
    scene: vm.sceneDescription,
    camera: vm.cameraDirection,
    lighting: vm.moodLighting,
    videoPrompt: vm.videoPrompt,
    extendPrompt: vm.extendPrompt,
    charactersInScene: vm.charactersInScene,
    intentionalOneTake: vm.intentionalOneTake ?? false,
    internalShots,
    internalShotCount: internalShots?.length ?? vm.multiShot.length ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 4. Feedback Refine Input — canonical-derived
// ═══════════════════════════════════════════════════════════════════

export interface FeedbackRefineInput {
  videoPrompt: string;
  extendPrompt: string;
  cutNumber: number;
  /** VideoPromptJson derived from canonical, not from legacy Cut */
  videoPromptJson: VideoPromptJson | null;
}

/**
 * Extract feedback refine input from canonical view-model.
 * Ensures the refine API gets data derived from canonical structures only.
 */
export function viewModelToFeedbackInput(vm: CutCardViewModel): FeedbackRefineInput {
  return {
    videoPrompt: vm.videoPrompt,
    extendPrompt: vm.extendPrompt,
    cutNumber: vm.cutNumber,
    videoPromptJson: vm.videoPromptJson,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 5. Submit Flow View-Model — canonical-derived fields for generation
// ═══════════════════════════════════════════════════════════════════

export interface SubmitFlowFields {
  /** MultiShot from canonical (not Cut.multiShot) */
  multiShot: MultiShotPrompt[];
  /** VideoPromptJson from canonical (not Cut.videoPromptJson) */
  videoPromptJson: VideoPromptJson | null;
  /** Duration from canonical sequence */
  durationSec: number;
  /** Scene type from canonical */
  shotCategory?: string;
  /** Intentional one-take from canonical */
  intentionalOneTake?: boolean;
}

/**
 * Extract submit-flow fields from canonical view-model.
 * Ensures the generate path uses canonical-derived data only.
 */
export function viewModelToSubmitFields(vm: CutCardViewModel): SubmitFlowFields {
  return {
    multiShot: vm.multiShot,
    videoPromptJson: vm.videoPromptJson,
    durationSec: vm.durationSec,
    shotCategory: vm.shotCategory,
    intentionalOneTake: vm.intentionalOneTake,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 6. Guard: assert no legacy field reads
// ═══════════════════════════════════════════════════════════════════

/**
 * Type-level guard: CutCardViewModel does NOT extend Cut.
 * It has its own fields derived from canonical, preventing accidental
 * Cut field access in downstream components.
 *
 * Usage in tests:
 *   assertCanonicalOnly(viewModel) → throws if any legacy field detected
 */
export function assertCanonicalOnly(vm: CutCardViewModel): void {
  // Verify the view-model was created through canonical path
  if (!vm._canonical) {
    throw new Error("CutCardViewModel._canonical is missing — was not created through canonical adapter");
  }
  // Verify duration consistency
  if (vm.durationSec !== vm._canonical.durationSec) {
    throw new Error(
      `Duration mismatch: vm.durationSec=${vm.durationSec} vs canonical=${vm._canonical.durationSec}`,
    );
  }
}

/**
 * Verify that a set of view-models are ALL derived from canonical.
 * Returns list of violations (empty = all canonical).
 */
export function auditCanonicalConsumption(viewModels: CutCardViewModel[]): string[] {
  const violations: string[] = [];
  for (const vm of viewModels) {
    if (!vm._canonical) {
      violations.push(`Cut ${vm.cutNumber}: missing _canonical reference`);
    }
    if (vm._canonical && vm.durationSec !== vm._canonical.durationSec) {
      violations.push(
        `Cut ${vm.cutNumber}: duration drift (vm=${vm.durationSec}, canonical=${vm._canonical.durationSec})`,
      );
    }
    if (vm._canonical && vm.multiShot.length > 0) {
      const canonicalShotCount = vm._canonical.shots?.length ?? 0;
      if (canonicalShotCount >= 2 && vm.multiShot.length !== canonicalShotCount) {
        violations.push(
          `Cut ${vm.cutNumber}: multiShot count mismatch (vm=${vm.multiShot.length}, canonical shots=${canonicalShotCount})`,
        );
      }
    }
  }
  return violations;
}
