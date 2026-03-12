/**
 * shot-comparison.test.ts — 3-way diff engine 테스트
 *
 * vitest describe/it 형식 사용
 */
import { describe, it, expect } from "vitest";
import {
  compareShot,
  normalize,
  deepEqual,
  getByPath,
  humanFieldName,
  formatValue,
  COMPARE_PATHS,
} from "../src/lib/shot-comparison";
import type { StructuredSequenceDocument } from "../src/types";

// ── 테스트용 최소 StructuredSequenceDocument 팩토리 ──────────────────────────

function makeDoc(overrides: Record<string, unknown> = {}): StructuredSequenceDocument {
  const base: Record<string, unknown> = {
    sequenceId: "seq-1",
    shotId: "shot-1",
    cutNumber: 1,
    sceneType: "character-driven",
    durationSec: 8,
    styleProfile: { mode: "cinematic-realism", mediumLock: null, colorAnchor: "warm" },
    continuity: { lighting: "soft daylight", sky: "overcast", surface: null, scale: null, characterRef: "남자, 30대, 정장", mustPersist: ["정장"] },
    physicsRules: { gravity: "earth", hasWind: true, hasAtmosphere: true, environmentType: "urban", flagMotionSource: null, skyConstraint: null, lightConstraint: null, bannedExpressions: [] },
    placeIdentityAnchors: ["서울 강남역 사거리"],
    situationEvidence: ["빗속에 우산 없이 서 있는 남자"],
    naturalMotion: ["빗방울", "차량 불빛 반사"],
    cameraPlan: { baseFraming: "MS", angle: "eye-level", motion: "slow push-in", motionMotivation: "tension" },
    temporalBeats: [
      { startSec: 0, endSec: 3, focus: "location" },
      { startSec: 3, endSec: 6, focus: "situation" },
      { startSec: 6, endSec: 8, focus: "emotion" },
    ],
    densityScore: { total: 85, breakdown: { place: true, situation: true }, missing: [] },
    shots: [{ shotId: "shot-1-a", startSec: 0, endSec: 8, camera: { framing: "MS", angle: "eye-level", motion: "slow push-in" }, subject: "남자", action: "서 있다", environment: "서울 강남", moodLighting: "soft daylight", focus: "emotion" }],
    shotPlan: {
      camera: { framing: "MS", angle: "eye-level", motion: "slow push-in" },
      action: "남자가 빗속에 서 있다",
      moodLighting: "soft daylight through rain",
      locationCue: "서울 강남역 사거리",
      situationCue: "우산 없이 비를 맞는 남자",
      emotionalAnchor: "고독",
      subject: { primary: "남자, 30대", characterRef: "정장 차림, 검은 머리", blocking: "center-frame" },
      timingBeat: "0s-3s: location, 3s-6s: situation, 6s-8s: emotion",
      transitionFromPrev: null,
      visualMedium: null,
      negativeDirectives: ["watermark", "text overlay"],
    },
    negatives: { universal: ["watermark"], sceneSpecific: ["text overlay"], failureMode: [], user: [] },
    validation: { valid: true, errors: 0, warnings: 0, issues: [] },
    sanitizeFixes: [],
    conflictResolutions: [],
  };

  // deep merge overrides
  const doc = JSON.parse(JSON.stringify(base));
  for (const [key, val] of Object.entries(overrides)) {
    const parts = key.split(".");
    let cur = doc;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in cur)) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }
  return doc as unknown as StructuredSequenceDocument;
}

// ── normalize ────────────────────────────────────────────────────────────────

describe("normalize", () => {
  it("null/undefined/empty → null", () => {
    expect(normalize(null)).toBe(null);
    expect(normalize(undefined)).toBe(null);
    expect(normalize("")).toBe(null);
    expect(normalize("  ")).toBe(null);
  });

  it("trims strings", () => {
    expect(normalize("  hello ")).toBe("hello");
  });

  it("sorts string arrays", () => {
    expect(normalize(["b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("removes null items from arrays", () => {
    expect(normalize(["a", "", null, "b"])).toEqual(["a", "b"]);
  });

  it("empty array → null", () => {
    expect(normalize([])).toBe(null);
  });

  it("normalizes nested objects", () => {
    const result = normalize({ a: "  hi ", b: "", c: null });
    expect(result).toEqual({ a: "hi" });
  });
});

// ── deepEqual ────────────────────────────────────────────────────────────────

describe("deepEqual", () => {
  it("primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it("arrays", () => {
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([], [])).toBe(true);
  });

  it("objects", () => {
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

// ── getByPath ────────────────────────────────────────────────────────────────

describe("getByPath", () => {
  it("extracts nested values", () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getByPath(obj, "a.b.c")).toBe(42);
  });

  it("returns undefined for missing paths", () => {
    expect(getByPath({ a: 1 }, "b.c")).toBeUndefined();
    expect(getByPath(null, "a")).toBeUndefined();
  });
});

// ── compareShot: 변경 없음 ──────────────────────────────────────────────────

describe("compareShot — no changes", () => {
  it("identical docs → changedCount=0", () => {
    const doc = makeDoc();
    const result = compareShot(doc, doc, doc);
    expect(result.changedCount).toBe(0);
    expect(result.totalFields).toBe(COMPARE_PATHS.length);
  });

  it("changedOnly=true → empty diffs", () => {
    const doc = makeDoc();
    const result = compareShot(doc, doc, doc, { changedOnly: true });
    expect(result.diffs.length).toBe(0);
  });
});

// ── compareShot: autofix 변경 ────────────────────────────────────────────────

describe("compareShot — autofix changes", () => {
  it("camera framing change detected at autofix stage", () => {
    const original = makeDoc();
    const autoFixed = makeDoc({ "cameraPlan.baseFraming": "WS" });
    const result = compareShot(original, autoFixed, autoFixed, { changedOnly: true });

    const framingDiff = result.diffs.find((d) => d.field === "cameraPlan.baseFraming");
    expect(framingDiff).toBeDefined();
    expect(framingDiff!.changedAt).toBe("autofix");
    expect(framingDiff!.original).toBe("MS");
    expect(framingDiff!.autoFixed).toBe("WS");
    expect(result.changedCount).toBeGreaterThan(0);
  });

  it("placeIdentityAnchors addition detected", () => {
    const original = makeDoc({ placeIdentityAnchors: [] });
    const autoFixed = makeDoc({ placeIdentityAnchors: ["서울역 광장"] });
    const result = compareShot(original, autoFixed, autoFixed, { changedOnly: true });

    const anchorDiff = result.diffs.find((d) => d.field === "placeIdentityAnchors");
    expect(anchorDiff).toBeDefined();
    expect(anchorDiff!.changedAt).toBe("autofix");
    expect(anchorDiff!.original).toBe(null);
  });
});

// ── compareShot: server 변경 ─────────────────────────────────────────────────

describe("compareShot — server changes", () => {
  it("negatives.sceneSpecific added at server stage", () => {
    const original = makeDoc();
    const autoFixed = makeDoc(); // same as original
    const finalSent = makeDoc({ "negatives.sceneSpecific": ["text overlay", "logo"] });
    const result = compareShot(original, autoFixed, finalSent, { changedOnly: true });

    const negDiff = result.diffs.find((d) => d.field === "negatives.sceneSpecific");
    expect(negDiff).toBeDefined();
    expect(negDiff!.changedAt).toBe("server");
  });
});

// ── compareShot: both 변경 ───────────────────────────────────────────────────

describe("compareShot — both stages changed", () => {
  it("field changed at autofix, then changed again at server → both", () => {
    const original = makeDoc({ "shotPlan.action": "걷는다" });
    const autoFixed = makeDoc({ "shotPlan.action": "빗속을 걷는다" });
    const finalSent = makeDoc({ "shotPlan.action": "폭우 속을 걷는다" });
    const result = compareShot(original, autoFixed, finalSent, { changedOnly: true });

    const actionDiff = result.diffs.find((d) => d.field === "shotPlan.action");
    expect(actionDiff).toBeDefined();
    expect(actionDiff!.changedAt).toBe("both");
  });
});

// ── lunar/space physics 변경이 diff에 드러남 ─────────────────────────────────

describe("compareShot — physics rule changes (lunar/space)", () => {
  it("earth → lunar gravity detected", () => {
    const original = makeDoc();
    const autoFixed = makeDoc({
      "physicsRules.gravity": "lunar",
      "physicsRules.hasWind": false,
      "physicsRules.hasAtmosphere": false,
      "physicsRules.environmentType": "lunar",
      "physicsRules.bannedExpressions": ["wind", "breeze", "haze", "fog"],
    });
    const result = compareShot(original, autoFixed, autoFixed, { changedOnly: true });

    const gravityDiff = result.diffs.find((d) => d.field === "physicsRules.gravity");
    expect(gravityDiff).toBeDefined();
    expect(gravityDiff!.original).toBe("earth");
    expect(gravityDiff!.autoFixed).toBe("lunar");

    const windDiff = result.diffs.find((d) => d.field === "physicsRules.hasWind");
    expect(windDiff).toBeDefined();
    expect(windDiff!.original).toBe(true);
    expect(windDiff!.autoFixed).toBe(false);

    const bannedDiff = result.diffs.find((d) => d.field === "physicsRules.bannedExpressions");
    expect(bannedDiff).toBeDefined();
    expect(bannedDiff!.changedAt).toBe("autofix");

    expect(result.changedCount).toBeGreaterThanOrEqual(4);
  });

  it("underwater environment changes detected", () => {
    const original = makeDoc();
    const autoFixed = makeDoc({
      "physicsRules.gravity": "underwater",
      "physicsRules.hasWind": false,
      "physicsRules.environmentType": "underwater",
      "physicsRules.bannedExpressions": ["wind", "breeze", "dust"],
    });
    const result = compareShot(original, autoFixed, autoFixed, { changedOnly: true });

    const envDiff = result.diffs.find((d) => d.field === "physicsRules.environmentType");
    expect(envDiff).toBeDefined();
    expect(envDiff!.original).toBe("urban");
    expect(envDiff!.autoFixed).toBe("underwater");
  });
});

// ── null/undefined 정규화 ────────────────────────────────────────────────────

describe("compareShot — null normalization", () => {
  it("null vs undefined vs '' → all treated as equal (no diff)", () => {
    const original = makeDoc({ "shotPlan.transitionFromPrev": null });
    const autoFixed = makeDoc({ "shotPlan.transitionFromPrev": undefined });
    const finalSent = makeDoc({ "shotPlan.transitionFromPrev": "" });
    const result = compareShot(original, autoFixed, finalSent, { changedOnly: true });

    const transDiff = result.diffs.find((d) => d.field === "shotPlan.transitionFromPrev");
    expect(transDiff).toBeUndefined(); // no diff since all normalize to null
  });
});

// ── 배열 순서 무관 비교 ──────────────────────────────────────────────────────

describe("compareShot — array order insensitive", () => {
  it("same items different order → no diff", () => {
    const original = makeDoc({ "negatives.universal": ["watermark", "logo"] });
    const autoFixed = makeDoc({ "negatives.universal": ["logo", "watermark"] });
    const result = compareShot(original, autoFixed, autoFixed, { changedOnly: true });

    const negDiff = result.diffs.find((d) => d.field === "negatives.universal");
    expect(negDiff).toBeUndefined();
  });
});

// ── helper 함수 ──────────────────────────────────────────────────────────────

describe("humanFieldName", () => {
  it("returns Korean label for known paths", () => {
    expect(humanFieldName("physicsRules.gravity")).toBe("중력");
    expect(humanFieldName("cameraPlan.baseFraming")).toBe("프레이밍");
  });

  it("returns raw path for unknown paths", () => {
    expect(humanFieldName("some.unknown.path")).toBe("some.unknown.path");
  });
});

describe("formatValue", () => {
  it("null → -", () => {
    expect(formatValue(null)).toBe("-");
  });

  it("boolean", () => {
    expect(formatValue(true)).toBe("Yes");
    expect(formatValue(false)).toBe("No");
  });

  it("truncates long strings", () => {
    const long = "a".repeat(200);
    expect(formatValue(long).length).toBeLessThanOrEqual(120);
    expect(formatValue(long).endsWith("...")).toBe(true);
  });

  it("arrays", () => {
    expect(formatValue(["a", "b"])).toBe("a, b");
  });
});

// ── 부분 스냅샷 (undefined 처리) ─────────────────────────────────────────────

describe("compareShot — partial snapshots", () => {
  it("only original exists → autoFixed/finalSent columns are null", () => {
    const original = makeDoc();
    const result = compareShot(original, undefined, undefined, { changedOnly: true });
    // All non-null fields in original show as changed (original→null)
    expect(result.changedCount).toBeGreaterThan(0);
    expect(result.diffs.every((d) => d.autoFixed === null && d.finalSent === null)).toBe(true);
  });
});
