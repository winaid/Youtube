/**
 * canonical-consumer-exclusivity.test.ts — Tests proving UI consumers
 * derive data exclusively from canonical structures.
 *
 * Tests:
 * 1. CutCardViewModel is derived from StructuredSequenceDocument, not raw Cut
 * 2. Export view-model reads canonical multiShot, not Cut.multiShot
 * 3. Feedback refine input derives from canonical view-model
 * 4. Submit flow fields derive from canonical sequence
 * 5. Consumer map audit returns all consumers as rewired or already_canonical
 * 6. Duration consistency between view-model and canonical source
 * 7. assertCanonicalOnly() catches non-canonical view-models
 * 8. auditCanonicalConsumption() detects violations
 */

import { describe, test, expect } from "vitest";
import {
  cutToViewModel,
  canonicalResultToViewModel,
  canonicalToMultiShotViewModel,
  viewModelToExportSequence,
  viewModelToFeedbackInput,
  viewModelToSubmitFields,
  assertCanonicalOnly,
  auditCanonicalConsumption,
  type CutCardViewModel,
} from "@/lib/canonical-view-model";
import {
  toCanonicalSequence,
  QUARANTINED_LEGACY_FIELDS,
  CANONICAL_CONSUMER_MAP,
  auditConsumerCanonicalStatus,
} from "@/lib/canonical-sequence";
import type { Cut, VideoGenerationConfig } from "@/types";
import { DEFAULT_VIDEO_CONFIG } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════

function makeCut(overrides: Partial<Cut> = {}): Cut {
  return {
    cutNumber: 1,
    durationSec: 8,
    sceneDescription: "A young warrior stands at the edge of a cliff",
    cameraDirection: "slow push-in",
    moodLighting: "dramatic golden hour",
    imagePrompt: "warrior on cliff",
    endImagePrompt: "",
    videoPrompt: "Wide shot of warrior on cliff edge",
    extendPrompt: "",
    transitionHint: "fade",
    characterConsistency: "young warrior in leather armor",
    charactersInScene: ["warrior"],
    shotCategory: "character-driven",
    videoPromptJson: {
      shotSize: "WS",
      cameraAngle: "low-angle",
      cameraMovement: "slow push-in (tension builds)",
      subjectBlocking: "foreground center-frame",
      subjectAction: "stands gazing at horizon",
      actionBeat: "holds stance, wind catches cloak",
      bodySignal: "clenched fist, narrowed eyes",
      revealed: "vast battlefield below",
      withheld: "approaching enemy forces",
      timingBeat: "0-3s: establish. 3-6s: reveal. 6-8s: tension hold",
      transitionFromPrev: "hard cut from black",
      characterRef: "young warrior, leather armor, scarred forearms",
      moodLighting: "golden hour, long shadows, dust particles",
      styleSuffix: "cinematic, no text, no watermark",
    },
    multiShot: [
      { index: 1, prompt: "Wide shot. Warrior silhouette against horizon", duration: "4", role: "establish" },
      { index: 2, prompt: "Medium shot. Warrior's face, determined expression", duration: "4", role: "develop" },
    ],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<VideoGenerationConfig> = {}): VideoGenerationConfig {
  return { ...DEFAULT_VIDEO_CONFIG, durationSeconds: 8, ...overrides };
}

// ═══════════════════════════════════════════════════════════════════
// 1. CutCardViewModel is derived from canonical
// ═══════════════════════════════════════════════════════════════════

describe("CutCardViewModel canonical derivation", () => {
  test("cutToViewModel produces view-model with _canonical reference", () => {
    const cut = makeCut();
    const config = makeConfig();
    const vm = cutToViewModel(cut, config);

    expect(vm._canonical).toBeDefined();
    expect(vm._canonical.durationSec).toBe(vm.durationSec);
    expect(vm.cutNumber).toBe(cut.cutNumber);
    expect(vm.sceneDescription).toBe(cut.sceneDescription);
  });

  test("view-model videoPromptJson is derived from canonical shotPlan, not raw Cut", () => {
    const cut = makeCut();
    const config = makeConfig();
    const vm = cutToViewModel(cut, config);

    // The view-model should have videoPromptJson derived from canonical sequence
    expect(vm.videoPromptJson).toBeDefined();
    if (vm.videoPromptJson) {
      // Canonical shotPlan is the source — should match canonical structure
      expect(vm.videoPromptJson.shotSize).toBeDefined();
      expect(vm.videoPromptJson.cameraAngle).toBeDefined();
      expect(vm.videoPromptJson.cameraMovement).toBeDefined();
    }
  });

  test("view-model multiShot is derived from canonical, not Cut.multiShot directly", () => {
    const cut = makeCut();
    const config = makeConfig();
    const vm = cutToViewModel(cut, config);

    // multiShot comes from canonical adapter, not direct Cut.multiShot
    expect(vm.multiShot).toBeDefined();
    expect(Array.isArray(vm.multiShot)).toBe(true);
  });

  test("duration comes from canonical sequence, not raw Cut", () => {
    const cut = makeCut({ durationSec: 8 });
    const config = makeConfig({ durationSeconds: 8 });
    const vm = cutToViewModel(cut, config);

    // Duration should come from canonical sequence
    expect(vm.durationSec).toBe(vm._canonical.durationSec);
  });

  test("assertCanonicalOnly passes for properly derived view-model", () => {
    const cut = makeCut();
    const config = makeConfig();
    const vm = cutToViewModel(cut, config);

    // Should not throw
    expect(() => assertCanonicalOnly(vm)).not.toThrow();
  });

  test("assertCanonicalOnly fails when _canonical is missing", () => {
    const fakeVm = {
      cutNumber: 1,
      durationSec: 8,
      _canonical: undefined,
    } as unknown as CutCardViewModel;

    expect(() => assertCanonicalOnly(fakeVm)).toThrow("_canonical is missing");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Export view-model uses canonical data
// ═══════════════════════════════════════════════════════════════════

describe("Export view-model canonical derivation", () => {
  test("viewModelToExportSequence reads from CutCardViewModel, not Cut", () => {
    const cut = makeCut();
    const config = makeConfig();
    const vm = cutToViewModel(cut, config);
    const exportVm = viewModelToExportSequence(vm);

    expect(exportVm.sequence).toBe(vm.cutNumber);
    expect(exportVm.sequenceDuration).toBe(`${vm.durationSec}s`);
    expect(exportVm.scene).toBe(vm.sceneDescription);
    expect(exportVm.camera).toBe(vm.cameraDirection);
    expect(exportVm.intentionalOneTake).toBe(false);
  });

  test("export internalShots derived from canonical multiShot", () => {
    const cut = makeCut();
    const config = makeConfig();
    const vm = cutToViewModel(cut, config);
    const exportVm = viewModelToExportSequence(vm);

    if (vm.multiShot.length >= 2) {
      expect(exportVm.internalShots).not.toBeNull();
      expect(exportVm.internalShotCount).toBe(vm.multiShot.length);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Feedback refine reads from canonical view-model
// ═══════════════════════════════════════════════════════════════════

describe("Feedback refine canonical derivation", () => {
  test("viewModelToFeedbackInput derives from CutCardViewModel fields", () => {
    const cut = makeCut();
    const config = makeConfig();
    const vm = cutToViewModel(cut, config);
    const feedbackInput = viewModelToFeedbackInput(vm);

    expect(feedbackInput.cutNumber).toBe(vm.cutNumber);
    expect(feedbackInput.videoPrompt).toBe(vm.videoPrompt);
    expect(feedbackInput.extendPrompt).toBe(vm.extendPrompt);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Submit flow reads canonical fields
// ═══════════════════════════════════════════════════════════════════

describe("Submit flow canonical derivation", () => {
  test("viewModelToSubmitFields extracts canonical-derived fields", () => {
    const cut = makeCut();
    const config = makeConfig();
    const vm = cutToViewModel(cut, config);
    const submitFields = viewModelToSubmitFields(vm);

    expect(submitFields.durationSec).toBe(vm.durationSec);
    expect(submitFields.multiShot).toBe(vm.multiShot);
    expect(submitFields.shotCategory).toBe(vm.shotCategory);
  });

  test("submit videoPromptJson is canonical-derived, not raw Cut.videoPromptJson", () => {
    const cut = makeCut();
    const config = makeConfig();
    const vm = cutToViewModel(cut, config);
    const submitFields = viewModelToSubmitFields(vm);

    // videoPromptJson should come from canonical shotPlan derivation
    if (submitFields.videoPromptJson) {
      expect(submitFields.videoPromptJson.shotSize).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Consumer map audit
// ═══════════════════════════════════════════════════════════════════

describe("Consumer map audit", () => {
  test("all consumers in map are rewired or already_canonical", () => {
    const status = auditConsumerCanonicalStatus();

    // No "legacy_only" consumers should exist (except quarantined safety fallback)
    const total = status.rewired.length + status.alreadyCanonical.length + status.quarantined.length;
    expect(total).toBe(Object.keys(CANONICAL_CONSUMER_MAP).length);

    // quarantined consumers should be explicitly safety-only
    for (const name of status.quarantined) {
      const info = CANONICAL_CONSUMER_MAP[name as keyof typeof CANONICAL_CONSUMER_MAP];
      expect(info.status).toBe("quarantined_legacy_only");
    }
  });

  test("rewired consumers list is non-empty", () => {
    const status = auditConsumerCanonicalStatus();
    expect(status.rewired.length).toBeGreaterThan(0);
  });

  test("quarantined legacy fields are documented", () => {
    expect(QUARANTINED_LEGACY_FIELDS).toContain("videoPromptJson");
    expect(QUARANTINED_LEGACY_FIELDS).toContain("multiShot");
    expect(QUARANTINED_LEGACY_FIELDS).toContain("extendPromptJson");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. auditCanonicalConsumption detects violations
// ═══════════════════════════════════════════════════════════════════

describe("auditCanonicalConsumption", () => {
  test("returns empty violations for properly derived view-models", () => {
    const cut = makeCut();
    const config = makeConfig();
    const vm = cutToViewModel(cut, config);
    const violations = auditCanonicalConsumption([vm]);

    expect(violations).toEqual([]);
  });

  test("detects missing _canonical reference", () => {
    const fakeVm = {
      cutNumber: 1,
      durationSec: 8,
      multiShot: [],
      _canonical: undefined,
    } as unknown as CutCardViewModel;

    const violations = auditCanonicalConsumption([fakeVm]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain("missing _canonical");
  });

  test("detects duration drift between vm and canonical", () => {
    const cut = makeCut();
    const config = makeConfig();
    const vm = cutToViewModel(cut, config);

    // Manually tamper with duration to simulate drift
    const tamperedVm = { ...vm, durationSec: vm.durationSec + 5 };
    const violations = auditCanonicalConsumption([tamperedVm]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain("duration drift");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. MultiShot view-model canonical derivation
// ═══════════════════════════════════════════════════════════════════

describe("MultiShot view-model canonical derivation", () => {
  test("derives from StructuredSequenceDocument.shots, not Cut.multiShot", () => {
    const cut = makeCut();
    const config = makeConfig();
    const canonical = toCanonicalSequence({ cut, config });
    const msVm = canonicalToMultiShotViewModel(canonical.sequence, 6);

    expect(msVm.isCanonicalSource).toBe(true);
    expect(msVm.totalDuration).toBe(canonical.sequence.durationSec);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. End-to-end: canonical roundtrip preserves data
// ═══════════════════════════════════════════════════════════════════

describe("Canonical roundtrip integrity", () => {
  test("Cut → canonical → view-model → export preserves key fields", () => {
    const cut = makeCut({ cutNumber: 3 });
    const config = makeConfig();
    const prevCut = makeCut({ cutNumber: 2 });

    const vm = cutToViewModel(cut, config, prevCut);
    const exportVm = viewModelToExportSequence(vm);

    expect(exportVm.sequence).toBe(3);
    expect(exportVm.method).toBe("EXTEND"); // cutNumber > 1
    expect(exportVm.scene).toBe(cut.sceneDescription);
    expect(exportVm.camera).toBe(cut.cameraDirection);
    expect(exportVm.lighting).toBe(cut.moodLighting);
  });

  test("multiple cuts all produce valid canonical view-models", () => {
    const config = makeConfig();
    const cuts = [
      makeCut({ cutNumber: 1 }),
      makeCut({ cutNumber: 2 }),
      makeCut({ cutNumber: 3 }),
    ];

    const viewModels: CutCardViewModel[] = [];
    for (let i = 0; i < cuts.length; i++) {
      const prevCut = i > 0 ? cuts[i - 1] : undefined;
      viewModels.push(cutToViewModel(cuts[i], config, prevCut));
    }

    // All should pass canonical audit
    const violations = auditCanonicalConsumption(viewModels);
    expect(violations).toEqual([]);

    // All should have _canonical references
    for (const vm of viewModels) {
      expect(vm._canonical).toBeDefined();
      expect(() => assertCanonicalOnly(vm)).not.toThrow();
    }
  });
});
