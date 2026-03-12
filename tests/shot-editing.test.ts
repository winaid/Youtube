/**
 * shot-editing.ts 유닛 테스트
 *
 * 테스트 범주:
 * 1. extractEditable / applyEditsToDocument (변환 왕복)
 * 2. splitShot (분할)
 * 3. mergeShotWithPrevious / mergeShotWithNext (병합)
 * 4. moveShotUp / moveShotDown (순서 변경)
 * 5. rebalanceShotTimings / setShotDuration (duration 재분배)
 * 6. validateSequenceDensity (밀도 경고)
 * 7. updateShotField / updateSequenceAnchors (필드 갱신)
 *
 * 실행: npx vitest run tests/shot-editing.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  extractEditable,
  applyEditsToDocument,
  splitShot,
  mergeShotWithPrevious,
  mergeShotWithNext,
  moveShotUp,
  moveShotDown,
  rebalanceShotTimings,
  setShotDuration,
  updateShotField,
  updateSequenceAnchors,
  validateSequenceDensity,
  FRAMING_OPTIONS,
  ANGLE_OPTIONS,
  type EditableSequence,
  type EditableShot,
} from "@/lib/shot-editing";
import type { StructuredSequenceDocument } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════

function makeDoc(overrides: Partial<StructuredSequenceDocument> = {}): StructuredSequenceDocument {
  return {
    sequenceId: "seq-1",
    shotId: "shot-1",
    cutNumber: 1,
    sceneType: "character-driven",
    durationSec: 10,
    styleProfile: { mode: "live_action" },
    continuity: { lighting: "warm", mustPersist: [] },
    physicsRules: {
      hasWind: true,
      hasAtmosphere: true,
      hasAudibleEnvironment: true,
      gravity: "earth",
      bannedExpressions: [],
      environmentType: "earth_outdoor",
    },
    placeIdentityAnchors: ["city park"],
    situationEvidence: ["empty bench"],
    naturalMotion: ["leaves falling"],
    cameraPlan: { baseFraming: "MS", angle: "eye-level", motion: "static" },
    temporalBeats: [
      { startSec: 0, endSec: 5, focus: "establishing" },
      { startSec: 5, endSec: 10, focus: "action" },
    ],
    densityScore: {
      total: 80,
      breakdown: {
        hasPlaceAnchors: true,
        hasEvidence: true,
        hasTemporalBeats: true,
        hasCameraPlan: true,
        hasPhysicsRules: true,
        hasNaturalMotion: true,
        hasExplicitLight: true,
        hasContinuity: true,
      },
      missing: [],
    },
    shots: [
      {
        shotId: "shot-A",
        startSec: 0,
        endSec: 4,
        camera: { framing: "MS", angle: "eye-level", motion: "static" },
        subject: "woman",
        action: "sits on bench",
        environment: "city park",
        moodLighting: "warm afternoon sun",
        focus: "establishing",
      },
      {
        shotId: "shot-B",
        startSec: 4,
        endSec: 7,
        camera: { framing: "CU", angle: "low-angle", motion: "push-in" },
        subject: "woman",
        action: "looks at phone",
        environment: "city park",
        moodLighting: "warm afternoon sun",
        focus: "action",
      },
      {
        shotId: "shot-C",
        startSec: 7,
        endSec: 10,
        camera: { framing: "WS", angle: "high-angle", motion: "pull-out" },
        subject: "woman",
        action: "stands up",
        environment: "city park",
        moodLighting: "warm afternoon sun",
        focus: "transition",
      },
    ],
    shotPlan: {
      shotId: "shot-1",
      timing: { startSec: 0, endSec: 10 },
      camera: { framing: "MS", angle: "eye-level", motion: "static" },
      subject: { primary: "woman", action: "sitting" },
      environment: "city park",
      moodLighting: "warm",
      focus: "establishing",
    } as StructuredSequenceDocument["shotPlan"],
    ...overrides,
  } as StructuredSequenceDocument;
}

function makeSeq(shots?: EditableShot[], overrides?: Partial<EditableSequence>): EditableSequence {
  return {
    sequenceId: "seq-1",
    cutNumber: 1,
    sceneType: "character-driven",
    durationSec: 10,
    shots: shots ?? [
      { shotId: "s1", startSec: 0, endSec: 4, camera: { framing: "MS", angle: "eye-level", motion: "static" }, subject: "A", action: "walks", environment: "park", moodLighting: "warm", focus: "main" },
      { shotId: "s2", startSec: 4, endSec: 7, camera: { framing: "CU", angle: "low-angle", motion: "push-in" }, subject: "A", action: "stops", environment: "park", moodLighting: "warm", focus: "detail" },
      { shotId: "s3", startSec: 7, endSec: 10, camera: { framing: "WS", angle: "high-angle", motion: "pull-out" }, subject: "A", action: "sits", environment: "park", moodLighting: "warm", focus: "wide" },
    ],
    placeIdentityAnchors: ["park"],
    situationEvidence: ["bench"],
    naturalMotion: ["wind"],
    temporalBeats: [],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. extractEditable / applyEditsToDocument
// ═══════════════════════════════════════════════════════════════════

describe("extractEditable & applyEditsToDocument", () => {
  it("extracts shots from document", () => {
    const doc = makeDoc();
    const editable = extractEditable(doc);
    expect(editable.shots.length).toBe(3);
    expect(editable.sequenceId).toBe("seq-1");
    expect(editable.durationSec).toBe(10);
    expect(editable.sceneType).toBe("character-driven");
  });

  it("creates single shot from shotPlan when shots[] is empty", () => {
    const doc = makeDoc({ shots: [] });
    const editable = extractEditable(doc);
    expect(editable.shots.length).toBe(1);
    expect(editable.shots[0].endSec).toBe(10);
    expect(editable.shots[0].subject).toBe("woman");
  });

  it("roundtrip: extract → apply preserves shot data", () => {
    const doc = makeDoc();
    const editable = extractEditable(doc);
    const applied = applyEditsToDocument(doc, editable);
    expect(applied.shots.length).toBe(3);
    expect(applied.shots[0].shotId).toBe("shot-A");
    expect(applied.durationSec).toBe(10);
  });

  it("apply updates temporalBeats from shots", () => {
    const doc = makeDoc();
    const editable = extractEditable(doc);
    const applied = applyEditsToDocument(doc, editable);
    expect(applied.temporalBeats.length).toBe(3);
    expect(applied.temporalBeats[0].startSec).toBe(0);
    expect(applied.temporalBeats[0].endSec).toBe(4);
  });

  it("copies placeIdentityAnchors and situationEvidence", () => {
    const doc = makeDoc();
    const editable = extractEditable(doc);
    expect(editable.placeIdentityAnchors).toEqual(["city park"]);
    expect(editable.situationEvidence).toEqual(["empty bench"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. splitShot
// ═══════════════════════════════════════════════════════════════════

describe("splitShot", () => {
  it("splits a shot into two at midpoint", () => {
    const seq = makeSeq();
    const result = splitShot(seq, "s1");
    expect(result.shots.length).toBe(4);
    expect(result.shots[0].shotId).toBe("s1");
    expect(result.shots[0].endSec).toBe(2);
    expect(result.shots[1].startSec).toBe(2);
    expect(result.shots[1].endSec).toBe(4);
  });

  it("preserves original shot camera data in both halves", () => {
    const seq = makeSeq();
    const result = splitShot(seq, "s1");
    expect(result.shots[0].camera.framing).toBe("MS");
    expect(result.shots[1].camera.framing).toBe("MS");
  });

  it("does not split if shot is too short", () => {
    const shots: EditableShot[] = [{
      shotId: "tiny", startSec: 0, endSec: 1,
      camera: { framing: "MS", angle: "eye-level", motion: "static" },
      subject: "X", action: "Y", environment: "Z", moodLighting: "M", focus: "F",
    }];
    const seq = makeSeq(shots, { durationSec: 1 });
    const result = splitShot(seq, "tiny");
    expect(result.shots.length).toBe(1); // unchanged
  });

  it("returns same sequence if shotId not found", () => {
    const seq = makeSeq();
    const result = splitShot(seq, "nonexistent");
    expect(result.shots.length).toBe(3);
  });

  it("updates temporalBeats after split", () => {
    const seq = makeSeq();
    const result = splitShot(seq, "s1");
    expect(result.temporalBeats.length).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. mergeShotWithPrevious / mergeShotWithNext
// ═══════════════════════════════════════════════════════════════════

describe("mergeShotWithPrevious", () => {
  it("merges with previous shot", () => {
    const seq = makeSeq();
    const result = mergeShotWithPrevious(seq, "s2");
    expect(result.shots.length).toBe(2);
    expect(result.shots[0].shotId).toBe("s1");
    expect(result.shots[0].endSec).toBe(7);
  });

  it("combines action with arrow separator", () => {
    const seq = makeSeq();
    const result = mergeShotWithPrevious(seq, "s2");
    expect(result.shots[0].action).toContain("→");
    expect(result.shots[0].action).toContain("walks");
    expect(result.shots[0].action).toContain("stops");
  });

  it("does not duplicate subject if same", () => {
    const seq = makeSeq();
    const result = mergeShotWithPrevious(seq, "s2");
    expect(result.shots[0].subject).toBe("A"); // same, not duplicated
  });

  it("returns unchanged if first shot", () => {
    const seq = makeSeq();
    const result = mergeShotWithPrevious(seq, "s1");
    expect(result.shots.length).toBe(3);
  });
});

describe("mergeShotWithNext", () => {
  it("merges with next shot (delegates to mergeShotWithPrevious)", () => {
    const seq = makeSeq();
    const result = mergeShotWithNext(seq, "s2");
    expect(result.shots.length).toBe(2);
    // s2 merged with s3, so s2's shotId kept (as "prev" in that merge)
    expect(result.shots[1].shotId).toBe("s2");
    expect(result.shots[1].endSec).toBe(10);
  });

  it("returns unchanged if last shot", () => {
    const seq = makeSeq();
    const result = mergeShotWithNext(seq, "s3");
    expect(result.shots.length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. moveShotUp / moveShotDown
// ═══════════════════════════════════════════════════════════════════

describe("moveShotUp", () => {
  it("swaps shot with previous", () => {
    const seq = makeSeq();
    const result = moveShotUp(seq, "s2");
    expect(result.shots[0].shotId).toBe("s2");
    expect(result.shots[1].shotId).toBe("s1");
  });

  it("rebalances timings after move", () => {
    const seq = makeSeq();
    const result = moveShotUp(seq, "s2");
    expect(result.shots[0].startSec).toBe(0);
    expect(result.shots[0].endSec).toBeGreaterThan(0);
    // last shot ends at total duration
    expect(result.shots[result.shots.length - 1].endSec).toBe(10);
  });

  it("returns unchanged if first shot", () => {
    const seq = makeSeq();
    const result = moveShotUp(seq, "s1");
    expect(result.shots[0].shotId).toBe("s1");
  });
});

describe("moveShotDown", () => {
  it("swaps shot with next", () => {
    const seq = makeSeq();
    const result = moveShotDown(seq, "s2");
    expect(result.shots[1].shotId).toBe("s3");
    expect(result.shots[2].shotId).toBe("s2");
  });

  it("returns unchanged if last shot", () => {
    const seq = makeSeq();
    const result = moveShotDown(seq, "s3");
    expect(result.shots[2].shotId).toBe("s3");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. rebalanceShotTimings / setShotDuration
// ═══════════════════════════════════════════════════════════════════

describe("rebalanceShotTimings", () => {
  it("preserves total duration", () => {
    const seq = makeSeq();
    const result = rebalanceShotTimings(seq);
    expect(result.shots[result.shots.length - 1].endSec).toBe(10);
  });

  it("no gaps or overlaps between shots", () => {
    const seq = makeSeq();
    const result = rebalanceShotTimings(seq);
    for (let i = 1; i < result.shots.length; i++) {
      expect(result.shots[i].startSec).toBeCloseTo(result.shots[i - 1].endSec, 1);
    }
  });

  it("starts from 0", () => {
    const seq = makeSeq();
    const result = rebalanceShotTimings(seq);
    expect(result.shots[0].startSec).toBe(0);
  });

  it("handles empty shots", () => {
    const seq = makeSeq([], { durationSec: 10 });
    const result = rebalanceShotTimings(seq);
    expect(result.shots.length).toBe(0);
  });

  it("updates temporalBeats", () => {
    const seq = makeSeq();
    const result = rebalanceShotTimings(seq);
    expect(result.temporalBeats.length).toBe(3);
  });
});

describe("setShotDuration", () => {
  it("changes shot duration and rebalances", () => {
    const seq = makeSeq();
    const result = setShotDuration(seq, "s1", 6);
    // All shots should still end at total duration
    expect(result.shots[result.shots.length - 1].endSec).toBe(10);
  });

  it("clamps to minimum 1s", () => {
    const seq = makeSeq();
    const result = setShotDuration(seq, "s1", 0.5);
    const s1 = result.shots.find((s) => s.shotId === "s1");
    expect(s1).toBeDefined();
    // Duration should be at least 1s after rebalance
    expect((s1!.endSec - s1!.startSec)).toBeGreaterThanOrEqual(1);
  });

  it("returns unchanged if shotId not found", () => {
    const seq = makeSeq();
    const result = setShotDuration(seq, "nonexistent", 5);
    expect(result.shots).toEqual(seq.shots);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. validateSequenceDensity
// ═══════════════════════════════════════════════════════════════════

describe("validateSequenceDensity", () => {
  it("warns for character-driven with 1 shot", () => {
    const seq = makeSeq(
      [{ shotId: "s1", startSec: 0, endSec: 10, camera: { framing: "MS", angle: "eye-level", motion: "static" }, subject: "A", action: "walks", environment: "park", moodLighting: "warm", focus: "main" }],
      { sceneType: "character-driven" },
    );
    const result = validateSequenceDensity(seq);
    expect(result.hasWarning).toBe(true);
    expect(result.recommendedMin).toBe(2);
  });

  it("no warning for character-driven with 2+ shots", () => {
    const seq = makeSeq(undefined, { sceneType: "character-driven" });
    const result = validateSequenceDensity(seq);
    expect(result.hasWarning).toBe(false);
  });

  it("warns for battle with < 3 shots", () => {
    const seq = makeSeq(undefined, { sceneType: "battle" });
    const result = validateSequenceDensity(seq);
    expect(result.hasWarning).toBe(false); // 3 shots >= 3 min
  });

  it("warns for battle with 2 shots", () => {
    const seq = makeSeq(
      [
        { shotId: "s1", startSec: 0, endSec: 5, camera: { framing: "MS", angle: "eye-level", motion: "static" }, subject: "A", action: "fights", environment: "arena", moodLighting: "dark", focus: "action" },
        { shotId: "s2", startSec: 5, endSec: 10, camera: { framing: "WS", angle: "high-angle", motion: "tracking" }, subject: "B", action: "defends", environment: "arena", moodLighting: "dark", focus: "reaction" },
      ],
      { sceneType: "battle" },
    );
    const result = validateSequenceDensity(seq);
    expect(result.hasWarning).toBe(true);
    expect(result.recommendedMin).toBe(3);
  });

  it("no warning for unknown sceneType", () => {
    const seq = makeSeq(undefined, { sceneType: "abstract" });
    const result = validateSequenceDensity(seq);
    expect(result.hasWarning).toBe(false);
    expect(result.recommendedMin).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. updateShotField / updateSequenceAnchors
// ═══════════════════════════════════════════════════════════════════

describe("updateShotField", () => {
  it("updates camera.framing", () => {
    const seq = makeSeq();
    const result = updateShotField(seq, "s1", "camera.framing", "CU");
    expect(result.shots[0].camera.framing).toBe("CU");
  });

  it("updates camera.angle", () => {
    const seq = makeSeq();
    const result = updateShotField(seq, "s1", "camera.angle", "dutch");
    expect(result.shots[0].camera.angle).toBe("dutch");
  });

  it("updates camera.motion", () => {
    const seq = makeSeq();
    const result = updateShotField(seq, "s1", "camera.motion", "tracking");
    expect(result.shots[0].camera.motion).toBe("tracking");
  });

  it("updates subject", () => {
    const seq = makeSeq();
    const result = updateShotField(seq, "s1", "subject", "new subject");
    expect(result.shots[0].subject).toBe("new subject");
  });

  it("updates action", () => {
    const seq = makeSeq();
    const result = updateShotField(seq, "s2", "action", "runs");
    expect(result.shots[1].action).toBe("runs");
  });

  it("updates environment", () => {
    const seq = makeSeq();
    const result = updateShotField(seq, "s1", "environment", "forest");
    expect(result.shots[0].environment).toBe("forest");
  });

  it("updates moodLighting", () => {
    const seq = makeSeq();
    const result = updateShotField(seq, "s1", "moodLighting", "cold blue");
    expect(result.shots[0].moodLighting).toBe("cold blue");
  });

  it("updates focus", () => {
    const seq = makeSeq();
    const result = updateShotField(seq, "s1", "focus", "emotion");
    expect(result.shots[0].focus).toBe("emotion");
  });

  it("returns unchanged for unknown shotId", () => {
    const seq = makeSeq();
    const result = updateShotField(seq, "nope", "subject", "X");
    expect(result.shots).toEqual(seq.shots);
  });

  it("does not mutate other shots", () => {
    const seq = makeSeq();
    const result = updateShotField(seq, "s1", "subject", "B");
    expect(result.shots[1].subject).toBe("A"); // unchanged
    expect(result.shots[2].subject).toBe("A"); // unchanged
  });
});

describe("updateSequenceAnchors", () => {
  it("updates placeIdentityAnchors", () => {
    const seq = makeSeq();
    const result = updateSequenceAnchors(seq, "placeIdentityAnchors", ["forest", "river"]);
    expect(result.placeIdentityAnchors).toEqual(["forest", "river"]);
  });

  it("updates situationEvidence", () => {
    const seq = makeSeq();
    const result = updateSequenceAnchors(seq, "situationEvidence", ["rain", "crowd"]);
    expect(result.situationEvidence).toEqual(["rain", "crowd"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Option lists (exports)
// ═══════════════════════════════════════════════════════════════════

describe("Option lists", () => {
  it("FRAMING_OPTIONS contains standard framing values", () => {
    expect(FRAMING_OPTIONS).toContain("MS");
    expect(FRAMING_OPTIONS).toContain("CU");
    expect(FRAMING_OPTIONS).toContain("WS");
    expect(FRAMING_OPTIONS.length).toBeGreaterThanOrEqual(7);
  });

  it("ANGLE_OPTIONS contains standard angle values", () => {
    expect(ANGLE_OPTIONS).toContain("eye-level");
    expect(ANGLE_OPTIONS).toContain("low-angle");
    expect(ANGLE_OPTIONS).toContain("high-angle");
    expect(ANGLE_OPTIONS.length).toBeGreaterThanOrEqual(5);
  });
});
