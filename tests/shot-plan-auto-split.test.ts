/**
 * shot-plan-auto-split.test.ts — Fragmented edit auto-split tests
 *
 * Tests:
 *   1. 컷 분절된 광고 중독 장면 → 반드시 3개 이상 shot
 *   2. hard cuts 스타일 뷰티 광고 → 반드시 shot-by-shot output
 *   3. montage 요청 장면 → temporalBeats만이 아니라 shots 배열 필수
 *   4. insert shot 다수 포함 요청 → insert shot이 실제 별도 shot으로 분리
 *   5. Validator: 5가지 실패 코드 검증
 *   6. Prompt 500자 제한 검증
 *   7. UI integration: isFragmentedEditRequested 검증
 */

import { describe, it, expect } from "vitest";
import {
  planAutoSplitShots,
  validateAutoSplitResult,
  compressAutoSplitPrompt,
  detectFragmentedIntent,
  isFragmentedEditRequested,
  PROMPT_CHAR_LIMIT,
  type AutoSplitInput,
} from "@/lib/shot-plan-auto-split";
import type { ShotDescriptor } from "@/lib/shot-splitting";
import { detectFragmentedEditRequest, validateKoreanDefaults } from "@/lib/korean-subject-defaults";

// ═══════════════════════════════════════════════════════════════════
// Test Data
// ═══════════════════════════════════════════════════════════════════

const BASE_INPUT: AutoSplitInput = {
  storyText: "스마트폰 중독에 대한 컷 분절 편집 스타일의 광고",
  sceneDescription: "young woman scrolling phone compulsively in dark room",
  subjectPrimary: "young Korean woman",
  action: "scrolling phone → phone drops → face lit by screen glow → hands trembling",
  environment: "dark bedroom, blue phone glow, empty coffee cups",
  moodLighting: "cold blue screen light, deep shadows",
  durationSec: 8,
  camera: { framing: "MS", angle: "eye-level", motion: "steady" },
  sceneType: "character-driven",
};

const BEAUTY_AD_INPUT: AutoSplitInput = {
  storyText: "hard cuts 스타일 뷰티 광고, 빠른 편집",
  sceneDescription: "beauty product showcase with rapid visual transitions",
  subjectPrimary: "beauty product and model",
  action: "product reveal → application → transformation → final glamour shot",
  environment: "clean white studio with colored accent lighting",
  moodLighting: "soft beauty lighting, highlights on product",
  durationSec: 8,
  camera: { framing: "CU", angle: "eye-level", motion: "push-in" },
  sceneType: "default",
};

const MONTAGE_INPUT: AutoSplitInput = {
  storyText: "몽타주 편집으로 시간 경과를 보여줘",
  sceneDescription: "time passage montage of city life over one day",
  subjectPrimary: "Seoul city",
  action: "dawn skyline → morning commute → busy lunch crowd → sunset → neon night",
  environment: "Seoul streets and skyline across day and night",
  moodLighting: "changing from golden dawn to cool night neon",
  durationSec: 8,
  camera: { framing: "WS", angle: "high-angle", motion: "slow pan" },
  sceneType: "environment",
};

const INSERT_SHOT_INPUT: AutoSplitInput = {
  storyText: "insert shot 다수 포함하여 요리 과정을 보여줘",
  sceneDescription: "cooking process with multiple insert shots of ingredients and actions",
  subjectPrimary: "Korean chef",
  action: "knife chopping → oil sizzling → ingredients tossed → steam rising → plating",
  environment: "Korean restaurant kitchen",
  moodLighting: "warm kitchen lighting with steam",
  durationSec: 8,
  camera: { framing: "MS", angle: "eye-level", motion: "steady" },
  sceneType: "character-driven",
};

const NON_FRAGMENTED_INPUT: AutoSplitInput = {
  storyText: "평화로운 일몰 장면",
  sceneDescription: "peaceful sunset over the ocean",
  subjectPrimary: "sunset horizon",
  action: "sun slowly sinking below the horizon",
  environment: "ocean beach at golden hour",
  moodLighting: "warm golden light",
  durationSec: 8,
  camera: { framing: "WS", angle: "eye-level", motion: "slow pan" },
  sceneType: "environment",
};

// ═══════════════════════════════════════════════════════════════════
// 1. Fragmented ad scene → must produce 3+ shots
// ═══════════════════════════════════════════════════════════════════

describe("Test 1: 컷 분절 광고 장면 → 3개 이상 shot", () => {
  it("produces at least 3 shots for fragmented edit request", () => {
    const result = planAutoSplitShots(BASE_INPUT);
    expect(result.shots.length).toBeGreaterThanOrEqual(3);
    expect(result.fragmentedContext.isFragmented).toBe(true);
    expect(result.validation.passed).toBe(true);
  });

  it("each shot has required fields", () => {
    const result = planAutoSplitShots(BASE_INPUT);
    for (const shot of result.shots) {
      expect(shot.shotId).toBeTruthy();
      expect(shot.startSec).toBeGreaterThanOrEqual(0);
      expect(shot.endSec).toBeGreaterThan(shot.startSec);
      expect(shot.camera.framing).toBeTruthy();
      expect(shot.camera.angle).toBeTruthy();
      expect(shot.camera.motion).toBeTruthy();
      expect(shot.subject).toBeTruthy();
      expect(shot.action).toBeTruthy();
      expect(shot.environment).toBeTruthy();
      expect(shot.moodLighting).toBeTruthy();
    }
  });

  it("shots have distinct visual properties", () => {
    const result = planAutoSplitShots(BASE_INPUT);
    // No two adjacent shots should have identical framing
    for (let i = 0; i < result.shots.length - 1; i++) {
      const a = result.shots[i];
      const b = result.shots[i + 1];
      const allSame = a.camera.framing === b.camera.framing
        && a.camera.angle === b.camera.angle
        && a.camera.motion === b.camera.motion;
      expect(allSame).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Hard cuts beauty ad → shot-by-shot output
// ═══════════════════════════════════════════════════════════════════

describe("Test 2: hard cuts 뷰티 광고 → shot-by-shot output", () => {
  it("detects hard cuts + 빠른 편집 triggers", () => {
    const ctx = detectFragmentedIntent(BEAUTY_AD_INPUT.storyText);
    expect(ctx.isFragmented).toBe(true);
    expect(ctx.triggerTerms).toEqual(expect.arrayContaining(["hard cuts"]));
  });

  it("produces multi-shot output, not single shot", () => {
    const result = planAutoSplitShots(BEAUTY_AD_INPUT);
    expect(result.shots.length).toBeGreaterThanOrEqual(3);
    // Must NOT be a single shot
    expect(result.shots.length).not.toBe(1);
  });

  it("validation passes for multi-shot output", () => {
    const result = planAutoSplitShots(BEAUTY_AD_INPUT);
    expect(result.validation.passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Montage request → shots array mandatory
// ═══════════════════════════════════════════════════════════════════

describe("Test 3: montage 요청 → shots 배열 필수", () => {
  it("detects montage trigger", () => {
    const ctx = detectFragmentedIntent(MONTAGE_INPUT.storyText);
    expect(ctx.isFragmented).toBe(true);
    expect(ctx.triggerTerms).toEqual(expect.arrayContaining(["몽타주"]));
  });

  it("produces shots array (not just temporalBeats)", () => {
    const result = planAutoSplitShots(MONTAGE_INPUT);
    expect(result.shots.length).toBeGreaterThanOrEqual(3);
    // Each shot should be a distinct visual unit
    const shotIds = result.shots.map(s => s.shotId);
    const uniqueIds = new Set(shotIds);
    expect(uniqueIds.size).toBe(shotIds.length);
  });

  it("montage stronger trigger → 5 shot minimum", () => {
    const ctx = detectFragmentedIntent(MONTAGE_INPUT.storyText);
    expect(ctx.minShotCount).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Insert shot request → insert shots as separate shots
// ═══════════════════════════════════════════════════════════════════

describe("Test 4: insert shot 요청 → insert shot이 별도 shot으로 분리", () => {
  it("detects insert shot trigger", () => {
    const ctx = detectFragmentedIntent(INSERT_SHOT_INPUT.storyText);
    expect(ctx.isFragmented).toBe(true);
    expect(ctx.triggerTerms).toEqual(expect.arrayContaining(["insert shot"]));
  });

  it("produces multiple distinct shots", () => {
    const result = planAutoSplitShots(INSERT_SHOT_INPUT);
    expect(result.shots.length).toBeGreaterThanOrEqual(3);
  });

  it("shots cover full duration", () => {
    const result = planAutoSplitShots(INSERT_SHOT_INPUT);
    const firstStart = result.shots[0].startSec;
    const lastEnd = result.shots[result.shots.length - 1].endSec;
    expect(firstStart).toBe(0);
    expect(lastEnd).toBe(INSERT_SHOT_INPUT.durationSec);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Validator: 5 failure codes
// ═══════════════════════════════════════════════════════════════════

describe("Validator failure codes", () => {
  const fragmentedCtx = {
    isFragmented: true,
    triggerTerms: ["컷 분절"],
    minShotCount: 3,
    editStyle: "fragmented, sharp editorial rhythm",
  };

  it("fragmented_edit_without_shots_array — empty shots", () => {
    const result = validateAutoSplitResult([], fragmentedCtx);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.code === "fragmented_edit_without_shots_array")).toBe(true);
  });

  it("fragmented_edit_but_single_shot — only 1 shot", () => {
    const singleShot: ShotDescriptor[] = [{
      shotId: "shot_1",
      startSec: 0,
      endSec: 8,
      camera: { framing: "MS", angle: "eye-level", motion: "steady" },
      subject: "person",
      action: "walking",
      environment: "street",
      moodLighting: "daylight",
      focus: "person walking",
    }];
    const result = validateAutoSplitResult(singleShot, fragmentedCtx);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.code === "fragmented_edit_but_single_shot")).toBe(true);
  });

  it("shots_below_minimum_count — only 2 shots", () => {
    const twoShots: ShotDescriptor[] = [
      { shotId: "shot_1", startSec: 0, endSec: 4, camera: { framing: "WS", angle: "eye-level", motion: "pan" }, subject: "person", action: "walking", environment: "street", moodLighting: "day", focus: "wide" },
      { shotId: "shot_2", startSec: 4, endSec: 8, camera: { framing: "CU", angle: "low-angle", motion: "push-in" }, subject: "hands", action: "reaching", environment: "street", moodLighting: "day", focus: "detail" },
    ];
    const result = validateAutoSplitResult(twoShots, fragmentedCtx);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.code === "shots_below_minimum_count")).toBe(true);
  });

  it("missing_required_shots_for_fragmented_edit — below minShotCount", () => {
    const highMinCtx = { ...fragmentedCtx, minShotCount: 5 };
    const threeShots: ShotDescriptor[] = [
      { shotId: "shot_1", startSec: 0, endSec: 3, camera: { framing: "WS", angle: "high-angle", motion: "pan" }, subject: "city", action: "overview", environment: "cityscape", moodLighting: "golden", focus: "wide" },
      { shotId: "shot_2", startSec: 3, endSec: 5, camera: { framing: "MS", angle: "eye-level", motion: "tracking" }, subject: "person", action: "walking", environment: "street", moodLighting: "warm", focus: "medium" },
      { shotId: "shot_3", startSec: 5, endSec: 8, camera: { framing: "CU", angle: "low-angle", motion: "push-in" }, subject: "face", action: "expression", environment: "indoor", moodLighting: "cool", focus: "close" },
    ];
    const result = validateAutoSplitResult(threeShots, highMinCtx);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.code === "missing_required_shots_for_fragmented_edit")).toBe(true);
  });

  it("insufficient_shot_variation — identical adjacent shots", () => {
    // Create shots with identical visual properties
    const identicalShots: ShotDescriptor[] = [
      { shotId: "shot_1", startSec: 0, endSec: 3, camera: { framing: "MS", angle: "eye-level", motion: "steady" }, subject: "person walking", action: "person walking slowly", environment: "street", moodLighting: "day", focus: "medium" },
      { shotId: "shot_2", startSec: 3, endSec: 5, camera: { framing: "MS", angle: "eye-level", motion: "steady" }, subject: "person walking", action: "person walking slowly", environment: "street", moodLighting: "day", focus: "medium" },
      { shotId: "shot_3", startSec: 5, endSec: 8, camera: { framing: "MS", angle: "eye-level", motion: "steady" }, subject: "person walking", action: "person walking slowly", environment: "street", moodLighting: "day", focus: "medium" },
    ];
    const result = validateAutoSplitResult(identicalShots, fragmentedCtx);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.code === "insufficient_shot_variation")).toBe(true);
  });

  it("passes for non-fragmented context", () => {
    const nonFragmented = { isFragmented: false, triggerTerms: [], minShotCount: 1, editStyle: "" };
    const result = validateAutoSplitResult([], nonFragmented);
    expect(result.passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Prompt 500자 제한
// ═══════════════════════════════════════════════════════════════════

describe("Prompt 500 character limit", () => {
  it("compresses prompt within 500 chars", () => {
    const result = planAutoSplitShots(BASE_INPUT);
    const prompt = compressAutoSplitPrompt(result.shots);
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
  });

  it("maintains shot structure in compressed prompt", () => {
    const result = planAutoSplitShots(BASE_INPUT);
    const prompt = compressAutoSplitPrompt(result.shots);
    // Each shot should appear as a line with timing bracket
    const shotLines = prompt.split("\n").filter(l => l.startsWith("["));
    expect(shotLines.length).toBe(result.shots.length);
  });

  it("handles many long shots within limit", () => {
    const longInput: AutoSplitInput = {
      ...BASE_INPUT,
      action: "a".repeat(200) + " → " + "b".repeat(200) + " → " + "c".repeat(200),
      environment: "e".repeat(100),
      moodLighting: "m".repeat(100),
    };
    const result = planAutoSplitShots(longInput);
    const prompt = compressAutoSplitPrompt(result.shots);
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. UI integration: isFragmentedEditRequested
// ═══════════════════════════════════════════════════════════════════

describe("isFragmentedEditRequested", () => {
  it("returns true for fragmented edit keywords", () => {
    expect(isFragmentedEditRequested("컷 분절 편집")).toBe(true);
    expect(isFragmentedEditRequested("Use hard cuts style")).toBe(true);
    expect(isFragmentedEditRequested("montage of city life")).toBe(true);
    expect(isFragmentedEditRequested("빠른 편집 리듬")).toBe(true);
    expect(isFragmentedEditRequested("insert shot 활용")).toBe(true);
  });

  it("returns false for non-fragmented text", () => {
    expect(isFragmentedEditRequested("평화로운 일몰")).toBe(false);
    expect(isFragmentedEditRequested("A quiet morning scene")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Non-fragmented input should NOT force multi-shot
// ═══════════════════════════════════════════════════════════════════

describe("Non-fragmented input", () => {
  it("does not force fragmented multi-shot for normal scenes", () => {
    const result = planAutoSplitShots(NON_FRAGMENTED_INPUT);
    expect(result.fragmentedContext.isFragmented).toBe(false);
    // Should still produce shots (from regular splitting), just not forced fragmented
    expect(result.fragmentedPromptBlock).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. korean-subject-defaults.ts validation integration
// ═══════════════════════════════════════════════════════════════════

describe("validateKoreanDefaults with fragmented context", () => {
  it("warns when fragmented requested but only 1 cut generated", () => {
    const fCtx = detectFragmentedEditRequest("컷 분절 편집으로 만들어줘");
    const warnings = validateKoreanDefaults(
      [{ videoPrompt: "Korean person walking", shotCategory: "character-driven" }],
      { fragmentedContext: fCtx },
    );
    expect(warnings.some(w => w.code === "single_shot_fragmented")).toBe(true);
  });
});
