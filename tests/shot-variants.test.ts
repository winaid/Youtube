/**
 * shot-variants.ts 유닛 테스트
 *
 * 테스트 범주:
 * 1. regenerate_shot_payload_test — shot-level payload 생성
 * 2. attach_variant_test — variant 추가
 * 3. set_active_variant_test — variant 채택
 * 4. shot_status_test — shot-level 상태 관리
 * 5. no_full_sequence_regenerate_test — 전체 sequence 재생성 방지
 * 6. comparison_panel_state_test — variant 비교 구조
 * 7. payloadToStructuredSequence — shot payload → StructuredSequenceDocument 변환
 *
 * 실행: npx vitest run tests/shot-variants.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  createInitialVariantState,
  buildShotRegeneratePayload,
  generateVariantId,
  setShotStatus,
  attachShotVariant,
  setActiveShotVariant,
  updateShotVariant,
  getShotVariants,
  getActiveShotVariantId,
  getShotStatus,
  compareShotVariants,
  payloadToStructuredSequence,
  type ShotVariantState,
} from "@/lib/shot-variants";
import type { EditableSequence, EditableShot } from "@/lib/shot-editing";
import type { StructuredSequenceDocument, ShotVariant } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════

function makeShot(id: string, startSec: number, endSec: number): EditableShot {
  return {
    shotId: id,
    startSec,
    endSec,
    camera: { framing: "MS", angle: "eye-level", motion: "static" },
    subject: `subject-${id}`,
    action: `action-${id}`,
    environment: "park",
    moodLighting: "warm afternoon",
    focus: "main",
  };
}

function makeSeq(shots?: EditableShot[]): EditableSequence {
  return {
    sequenceId: "seq-1",
    cutNumber: 1,
    sceneType: "character-driven",
    durationSec: 10,
    shots: shots ?? [makeShot("s1", 0, 4), makeShot("s2", 4, 7), makeShot("s3", 7, 10)],
    placeIdentityAnchors: ["park"],
    situationEvidence: ["bench"],
    naturalMotion: ["wind"],
    temporalBeats: [],
  };
}

function makeDoc(): StructuredSequenceDocument {
  return {
    sequenceId: "seq-1",
    shotId: "shot-1",
    cutNumber: 1,
    sceneType: "character-driven",
    durationSec: 10,
    styleProfile: { mode: "live_action" },
    continuity: { lighting: "warm", mustPersist: ["character appearance"] },
    physicsRules: {
      hasWind: true, hasAtmosphere: true, hasAudibleEnvironment: true,
      gravity: "earth", bannedExpressions: [], environmentType: "earth_outdoor",
    },
    placeIdentityAnchors: ["park"],
    situationEvidence: ["bench"],
    naturalMotion: ["wind"],
    cameraPlan: { baseFraming: "MS", angle: "eye-level", motion: "static" },
    temporalBeats: [
      { startSec: 0, endSec: 4, focus: "establishing" },
      { startSec: 4, endSec: 10, focus: "action" },
    ],
    densityScore: {
      total: 80,
      breakdown: {
        hasPlaceAnchors: true, hasEvidence: true, hasTemporalBeats: true,
        hasCameraPlan: true, hasPhysicsRules: true, hasNaturalMotion: true,
        hasExplicitLight: true, hasContinuity: true,
      },
      missing: [],
    },
    shots: [
      { shotId: "s1", startSec: 0, endSec: 4, camera: { framing: "MS", angle: "eye-level", motion: "static" }, subject: "subject-s1", action: "action-s1", environment: "park", moodLighting: "warm afternoon", focus: "establishing" },
      { shotId: "s2", startSec: 4, endSec: 7, camera: { framing: "CU", angle: "low-angle", motion: "push-in" }, subject: "subject-s2", action: "action-s2", environment: "park", moodLighting: "warm afternoon", focus: "action" },
      { shotId: "s3", startSec: 7, endSec: 10, camera: { framing: "WS", angle: "high-angle", motion: "pull-out" }, subject: "subject-s3", action: "action-s3", environment: "park", moodLighting: "warm afternoon", focus: "transition" },
    ],
    shotPlan: {
      shotId: "shot-1",
      timing: { startSec: 0, endSec: 10 },
      camera: { framing: "MS", angle: "eye-level", motion: "static" },
      subject: { primary: "woman", action: "walking" },
      environment: "park",
      moodLighting: "warm",
      focus: "establishing",
    } as StructuredSequenceDocument["shotPlan"],
  } as StructuredSequenceDocument;
}

function makeVariant(shotId: string, overrides?: Partial<ShotVariant>): ShotVariant {
  return {
    variantId: `var-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    shotId,
    status: "success",
    createdAt: Date.now(),
    videoUrl: "https://example.com/video.mp4",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. regenerate_shot_payload_test
// ═══════════════════════════════════════════════════════════════════

describe("buildShotRegeneratePayload", () => {
  it("builds payload for existing shot", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s2");

    expect(payload).not.toBeNull();
    expect(payload!.shot.shotId).toBe("s2");
    expect(payload!.shot.subject).toBe("subject-s2");
  });

  it("includes sequence context", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s2")!;

    expect(payload.sequenceContext.sceneType).toBe("character-driven");
    expect(payload.sequenceContext.durationSec).toBe(3); // 7 - 4
    expect(payload.sequenceContext.sequenceId).toBe("seq-1");
    expect(payload.sequenceContext.styleProfile).toBeDefined();
    expect(payload.sequenceContext.continuity).toBeDefined();
    expect(payload.sequenceContext.physicsRules).toBeDefined();
  });

  it("includes previous shot context", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s2")!;

    expect(payload.previousShot).not.toBeUndefined();
    expect(payload.previousShot!.shotId).toBe("s1");
    expect(payload.previousShot!.endSec).toBe(4);
  });

  it("includes next shot context", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s2")!;

    expect(payload.nextShot).not.toBeUndefined();
    expect(payload.nextShot!.shotId).toBe("s3");
    expect(payload.nextShot!.startSec).toBe(7);
  });

  it("no previous shot for first shot", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s1")!;

    expect(payload.previousShot).toBeUndefined();
    expect(payload.nextShot).not.toBeUndefined();
  });

  it("no next shot for last shot", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s3")!;

    expect(payload.previousShot).not.toBeUndefined();
    expect(payload.nextShot).toBeUndefined();
  });

  it("returns null for nonexistent shot", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "nonexistent");

    expect(payload).toBeNull();
  });

  it("payload contains only target shot, not full sequence", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s2")!;

    // Only the target shot data, not all 3 shots
    expect(payload.shot.shotId).toBe("s2");
    // No full shots array in payload
    expect((payload as unknown as Record<string, unknown>)["shots"]).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. attach_variant_test
// ═══════════════════════════════════════════════════════════════════

describe("attachShotVariant", () => {
  it("attaches variant to shot", () => {
    let state = createInitialVariantState();
    const variant = makeVariant("s1");
    state = attachShotVariant(state, "s1", variant);

    const variants = getShotVariants(state, "s1");
    expect(variants.length).toBe(1);
    expect(variants[0].shotId).toBe("s1");
  });

  it("appends to existing variants", () => {
    let state = createInitialVariantState();
    const v1 = makeVariant("s1", { variantId: "v1" });
    const v2 = makeVariant("s1", { variantId: "v2" });
    state = attachShotVariant(state, "s1", v1);
    state = attachShotVariant(state, "s1", v2);

    const variants = getShotVariants(state, "s1");
    expect(variants.length).toBe(2);
    expect(variants[0].variantId).toBe("v1");
    expect(variants[1].variantId).toBe("v2");
  });

  it("does not affect other shots", () => {
    let state = createInitialVariantState();
    state = attachShotVariant(state, "s1", makeVariant("s1"));

    expect(getShotVariants(state, "s2").length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. set_active_variant_test
// ═══════════════════════════════════════════════════════════════════

describe("setActiveShotVariant", () => {
  it("sets active variant", () => {
    let state = createInitialVariantState();
    const v1 = makeVariant("s1", { variantId: "v1" });
    state = attachShotVariant(state, "s1", v1);
    state = setActiveShotVariant(state, "s1", "v1");

    expect(getActiveShotVariantId(state, "s1")).toBe("v1");
  });

  it("changes active variant on accept", () => {
    let state = createInitialVariantState();
    const v1 = makeVariant("s1", { variantId: "v1" });
    const v2 = makeVariant("s1", { variantId: "v2" });
    state = attachShotVariant(state, "s1", v1);
    state = attachShotVariant(state, "s1", v2);
    state = setActiveShotVariant(state, "s1", "v1");

    expect(getActiveShotVariantId(state, "s1")).toBe("v1");

    // Accept v2
    state = setActiveShotVariant(state, "s1", "v2");
    expect(getActiveShotVariantId(state, "s1")).toBe("v2");
  });

  it("ignores nonexistent variant", () => {
    let state = createInitialVariantState();
    const v1 = makeVariant("s1", { variantId: "v1" });
    state = attachShotVariant(state, "s1", v1);
    state = setActiveShotVariant(state, "s1", "v1");

    state = setActiveShotVariant(state, "s1", "nonexistent");
    expect(getActiveShotVariantId(state, "s1")).toBe("v1"); // unchanged
  });

  it("returns null for shot with no active variant", () => {
    const state = createInitialVariantState();
    expect(getActiveShotVariantId(state, "s1")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. shot_status_test
// ═══════════════════════════════════════════════════════════════════

describe("shot status management", () => {
  it("default status is idle", () => {
    const state = createInitialVariantState();
    expect(getShotStatus(state, "s1")).toBe("idle");
  });

  it("sets generating status", () => {
    let state = createInitialVariantState();
    state = setShotStatus(state, "s1", "generating");
    expect(getShotStatus(state, "s1")).toBe("generating");
  });

  it("sets success status", () => {
    let state = createInitialVariantState();
    state = setShotStatus(state, "s1", "success");
    expect(getShotStatus(state, "s1")).toBe("success");
  });

  it("sets failed status", () => {
    let state = createInitialVariantState();
    state = setShotStatus(state, "s1", "failed");
    expect(getShotStatus(state, "s1")).toBe("failed");
  });

  it("only affects target shot", () => {
    let state = createInitialVariantState();
    state = setShotStatus(state, "s1", "generating");
    expect(getShotStatus(state, "s1")).toBe("generating");
    expect(getShotStatus(state, "s2")).toBe("idle");
    expect(getShotStatus(state, "s3")).toBe("idle");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. no_full_sequence_regenerate_test
// ═══════════════════════════════════════════════════════════════════

describe("no full sequence regenerate", () => {
  it("payload contains only 1 shot, not full sequence", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s2")!;

    // Only the target shot
    expect(payload.shot.shotId).toBe("s2");

    // sequenceContext does NOT contain full shots array
    const ctx = payload.sequenceContext as Record<string, unknown>;
    expect(ctx["shots"]).toBeUndefined();
  });

  it("payloadToStructuredSequence produces single-shot document", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s2")!;
    const shotDoc = payloadToStructuredSequence(payload, doc);

    // Only 1 shot in the document
    expect(shotDoc.shots.length).toBe(1);
    expect(shotDoc.shots[0].shotId).toBe("s2");
    expect(shotDoc.durationSec).toBe(3); // 7 - 4
  });

  it("regenerating one shot does not change others", () => {
    let state = createInitialVariantState();
    state = setShotStatus(state, "s2", "generating");

    // s1 and s3 remain idle
    expect(getShotStatus(state, "s1")).toBe("idle");
    expect(getShotStatus(state, "s3")).toBe("idle");
    expect(getShotStatus(state, "s2")).toBe("generating");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. comparison_panel_state_test
// ═══════════════════════════════════════════════════════════════════

describe("compareShotVariants", () => {
  it("compares two variants", () => {
    let state = createInitialVariantState();
    const v1 = makeVariant("s1", { variantId: "v1", videoUrl: "url1" });
    const v2 = makeVariant("s1", { variantId: "v2", videoUrl: "url2" });
    state = attachShotVariant(state, "s1", v1);
    state = attachShotVariant(state, "s1", v2);
    state = setActiveShotVariant(state, "s1", "v1");

    const comparison = compareShotVariants(state, "s1", "v1", "v2");
    expect(comparison).not.toBeNull();
    expect(comparison!.shotId).toBe("s1");
    expect(comparison!.variantA.variantId).toBe("v1");
    expect(comparison!.variantB.variantId).toBe("v2");
    expect(comparison!.aIsActive).toBe(true);
  });

  it("returns null if variant not found", () => {
    let state = createInitialVariantState();
    state = attachShotVariant(state, "s1", makeVariant("s1", { variantId: "v1" }));

    const comparison = compareShotVariants(state, "s1", "v1", "nonexistent");
    expect(comparison).toBeNull();
  });

  it("aIsActive reflects current active", () => {
    let state = createInitialVariantState();
    const v1 = makeVariant("s1", { variantId: "v1" });
    const v2 = makeVariant("s1", { variantId: "v2" });
    state = attachShotVariant(state, "s1", v1);
    state = attachShotVariant(state, "s1", v2);
    state = setActiveShotVariant(state, "s1", "v2");

    const comparison = compareShotVariants(state, "s1", "v1", "v2");
    expect(comparison!.aIsActive).toBe(false); // v2 is active, not v1
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. payloadToStructuredSequence
// ═══════════════════════════════════════════════════════════════════

describe("payloadToStructuredSequence", () => {
  it("creates single-shot document with correct duration", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s2")!;
    const shotDoc = payloadToStructuredSequence(payload, doc);

    expect(shotDoc.durationSec).toBe(3);
    expect(shotDoc.shots.length).toBe(1);
    expect(shotDoc.shots[0].startSec).toBe(0);
    expect(shotDoc.shots[0].endSec).toBe(3);
  });

  it("preserves original doc fields (styleProfile, physicsRules)", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s1")!;
    const shotDoc = payloadToStructuredSequence(payload, doc);

    expect(shotDoc.styleProfile.mode).toBe("live_action");
    expect(shotDoc.physicsRules.hasWind).toBe(true);
    expect(shotDoc.placeIdentityAnchors).toContain("park");
  });

  it("updates shotPlan from target shot", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s2")!;
    const shotDoc = payloadToStructuredSequence(payload, doc);

    expect(shotDoc.shotPlan.shotId).toBe("s2");
    expect(shotDoc.shotPlan.camera.framing).toBe("MS");
    expect(shotDoc.shotPlan.action).toBe("action-s2");
  });

  it("updates temporalBeats to single beat", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s2")!;
    const shotDoc = payloadToStructuredSequence(payload, doc);

    expect(shotDoc.temporalBeats.length).toBe(1);
    expect(shotDoc.temporalBeats[0].startSec).toBe(0);
    expect(shotDoc.temporalBeats[0].endSec).toBe(3);
  });

  it("adds continuity context from previous shot", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s2")!;
    const shotDoc = payloadToStructuredSequence(payload, doc);

    // Should include neighbor context in continuity
    expect(shotDoc.continuity.mustPersist.some(
      (s: string) => s.includes("continues from")
    )).toBe(true);
  });

  it("no continuity neighbor for first shot", () => {
    const seq = makeSeq();
    const doc = makeDoc();
    const payload = buildShotRegeneratePayload(seq, doc, "s1")!;
    const shotDoc = payloadToStructuredSequence(payload, doc);

    expect(shotDoc.continuity.mustPersist.every(
      (s: string) => !s.includes("continues from")
    )).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. updateShotVariant
// ═══════════════════════════════════════════════════════════════════

describe("updateShotVariant", () => {
  it("updates variant fields", () => {
    let state = createInitialVariantState();
    const v = makeVariant("s1", { variantId: "v1", status: "generating" });
    state = attachShotVariant(state, "s1", v);
    state = updateShotVariant(state, "s1", "v1", {
      status: "success",
      videoUrl: "https://new-url.com/video.mp4",
    });

    const variants = getShotVariants(state, "s1");
    expect(variants[0].status).toBe("success");
    expect(variants[0].videoUrl).toBe("https://new-url.com/video.mp4");
  });

  it("does not affect other variants", () => {
    let state = createInitialVariantState();
    const v1 = makeVariant("s1", { variantId: "v1", videoUrl: "url1" });
    const v2 = makeVariant("s1", { variantId: "v2", videoUrl: "url2" });
    state = attachShotVariant(state, "s1", v1);
    state = attachShotVariant(state, "s1", v2);
    state = updateShotVariant(state, "s1", "v1", { videoUrl: "updated" });

    const variants = getShotVariants(state, "s1");
    expect(variants[0].videoUrl).toBe("updated");
    expect(variants[1].videoUrl).toBe("url2"); // unchanged
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. generateVariantId
// ═══════════════════════════════════════════════════════════════════

describe("generateVariantId", () => {
  it("generates unique IDs", () => {
    const id1 = generateVariantId();
    const id2 = generateVariantId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^var_/);
    expect(id2).toMatch(/^var_/);
  });
});
