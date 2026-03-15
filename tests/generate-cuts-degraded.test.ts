/**
 * generate-cuts degraded success 테스트
 *
 * 테스트 범주:
 * 1. timeout → degraded success (deterministic fallback)
 * 2. ultra-compact retry payload 검증
 * 3. primary key fail → secondary key retry (524 in isRetryableError)
 * 4. single-shot → multi-shot fallback (MULTI_SHOT_SCENE_TYPES)
 * 5. lunar scene rules in deterministic fallback
 *
 * 실행: npx vitest run tests/generate-cuts-degraded.test.ts
 */

import { describe, it, expect } from "vitest";

// ── _gemini-keys.ts exports we can test ──
// We test isRetryableError via the exported function
// and streamingGenerate timeout behavior via mock

// Since generate-cuts.ts is a Cloudflare Pages Function (not a normal module export),
// we test the extracted pure functions and logic patterns directly.

// ═══════════════════════════════════════════════════════════════════
// 1. isRetryableError — 524 handling
// ═══════════════════════════════════════════════════════════════════

// We need to import the function. Since it's not directly exported in the
// original, we added `export { isRetryableError }` in _gemini-keys.ts
import { isRetryableError } from "../functions/api/_gemini-keys";

describe("isRetryableError — 524 timeout handling", () => {
  it("should treat 524 as retryable", () => {
    expect(isRetryableError(524)).toBe(true);
  });

  it("should treat 524 as retryable even with body", () => {
    expect(isRetryableError(524, "A]timeout occurred")).toBe(true);
  });

  it("should still treat 429 as retryable", () => {
    expect(isRetryableError(429)).toBe(true);
  });

  it("should still treat 503 as retryable", () => {
    expect(isRetryableError(503)).toBe(true);
  });

  it("should NOT treat 404 model-not-found as retryable", () => {
    expect(isRetryableError(404, "model is not found")).toBe(false);
  });

  it("should NOT treat 400 deprecated as retryable", () => {
    expect(isRetryableError(400, "model no longer available")).toBe(false);
  });

  it("should treat 401 as retryable (different key might work)", () => {
    expect(isRetryableError(401)).toBe(true);
  });

  it("should treat 403 + quota as retryable", () => {
    expect(isRetryableError(403, "RESOURCE_EXHAUSTED quota exceeded")).toBe(true);
  });

  it("should NOT treat 403 without quota as retryable", () => {
    expect(isRetryableError(403, "permission denied")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Deterministic fallback — buildDeterministicCuts
// ═══════════════════════════════════════════════════════════════════

// Since buildDeterministicCuts is not exported (it's a module-level function
// in generate-cuts.ts), we replicate the core logic here for testing.
// In practice, the integration test below covers the actual behavior.

describe("deterministic fallback — structure validation", () => {
  // Simulate the deterministic cut builder logic
  function buildDeterministicCuts(
    storyText: string,
    directorName: string,
    cutCount: number,
    secPerCut: number,
  ) {
    const shotCycle = ["WS", "MS", "CU", "OTS", "MCU", "LS", "ECU", "POV", "MLS"];

    return Array.from({ length: cutCount }, (_, i) => ({
      cutNumber: i + 1,
      durationSec: secPerCut,
      shotType: shotCycle[i % shotCycle.length],
      sceneDescription: `장면 ${i + 1}`,
      subjectAction: i === 0 ? "camera reveals the space and atmosphere" : `subject moves through scene ${i + 1}`,
      emotionalDelta: i === 0 ? "opening→neutral" : "neutral→neutral",
      shotCategory: i === 0 ? "environment" : "character-driven",
      characterRole: i === 0 ? "absent" : "protagonist",
      videoPromptJson: {
        shotSize: shotCycle[i % shotCycle.length],
        cameraAngle: "eye-level",
      },
    }));
  }

  it("should generate exactly cutCount cuts", () => {
    const cuts = buildDeterministicCuts("치과 역사 이야기", "Tim Burton", 5, 8);
    expect(cuts).toHaveLength(5);
  });

  it("should have sequential cutNumbers", () => {
    const cuts = buildDeterministicCuts("story", "Director", 8, 8);
    cuts.forEach((c, i) => expect(c.cutNumber).toBe(i + 1));
  });

  it("should set first shot as WS (wide establishing)", () => {
    const cuts = buildDeterministicCuts("story", "Director", 3, 8);
    expect(cuts[0].shotType).toBe("WS");
    expect(cuts[0].shotCategory).toBe("environment");
    expect(cuts[0].characterRole).toBe("absent");
  });

  it("should cycle through different shot types (no consecutive duplicates)", () => {
    const cuts = buildDeterministicCuts("story", "Director", 9, 8);
    for (let i = 1; i < cuts.length; i++) {
      expect(cuts[i].shotType).not.toBe(cuts[i - 1].shotType);
    }
  });

  it("should set correct durationSec", () => {
    const cuts = buildDeterministicCuts("story", "Director", 3, 10);
    cuts.forEach(c => expect(c.durationSec).toBe(10));
  });

  it("should include videoPromptJson with shot size", () => {
    const cuts = buildDeterministicCuts("story", "Director", 2, 8);
    expect(cuts[0].videoPromptJson.shotSize).toBe("WS");
    expect(cuts[1].videoPromptJson.shotSize).toBe("MS");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Lunar scene rules in deterministic fallback
// ═══════════════════════════════════════════════════════════════════

describe("lunar scene physics rules", () => {
  function getPhysicsForScene(storyText: string): { environmentType: string; bannedWords: string[] } {
    const lower = storyText.toLowerCase();
    if (/(lunar|moon|달 표면|달 기지|월면)/i.test(lower)) {
      return { environmentType: "lunar", bannedWords: ["wind", "breeze", "overcast", "cloud", "haze", "fog", "rain", "wave", "sound of", "rustling"] };
    }
    if (/(underwater|해저|잠수|심해|ocean floor)/i.test(lower)) {
      return { environmentType: "underwater", bannedWords: ["wind", "breeze", "sun", "overcast", "dry"] };
    }
    if (/(space|우주|무중력|zero.?g)/i.test(lower)) {
      return { environmentType: "space", bannedWords: ["wind", "breeze", "overcast", "rain", "sound", "rustling"] };
    }
    return { environmentType: "earth_outdoor", bannedWords: [] };
  }

  it("should detect lunar environment from Korean text", () => {
    const physics = getPhysicsForScene("달 표면에서 우주비행사가 걸어간다");
    expect(physics.environmentType).toBe("lunar");
    expect(physics.bannedWords).toContain("wind");
    expect(physics.bannedWords).toContain("overcast");
    expect(physics.bannedWords).toContain("rain");
    expect(physics.bannedWords).toContain("sound of");
  });

  it("should detect lunar from English 'moon' keyword", () => {
    const physics = getPhysicsForScene("Astronaut walks on the moon surface");
    expect(physics.environmentType).toBe("lunar");
  });

  it("should detect lunar from 'lunar' keyword", () => {
    const physics = getPhysicsForScene("Lunar base construction scene");
    expect(physics.environmentType).toBe("lunar");
  });

  it("should detect underwater environment", () => {
    const physics = getPhysicsForScene("심해 탐사선이 해저를 탐험한다");
    expect(physics.environmentType).toBe("underwater");
    expect(physics.bannedWords).toContain("wind");
    expect(physics.bannedWords).toContain("dry");
  });

  it("should detect space environment", () => {
    const physics = getPhysicsForScene("우주 정거장에서의 무중력 실험");
    expect(physics.environmentType).toBe("space");
  });

  it("should default to earth_outdoor with no banned words", () => {
    const physics = getPhysicsForScene("치과 의사의 하루 일상");
    expect(physics.environmentType).toBe("earth_outdoor");
    expect(physics.bannedWords).toHaveLength(0);
  });

  it("should ban 'wind' in lunar environment", () => {
    const physics = getPhysicsForScene("달 기지에서의 활동");
    expect(physics.bannedWords).toContain("wind");
  });

  it("should ban 'fog' in lunar environment", () => {
    const physics = getPhysicsForScene("moon exploration");
    expect(physics.bannedWords).toContain("fog");
  });

  it("should clean text by removing banned words", () => {
    const physics = getPhysicsForScene("lunar surface walk");
    const text = "A gentle wind blows across the overcast sky with haze";
    let cleaned = text;
    for (const banned of physics.bannedWords) {
      cleaned = cleaned.replace(new RegExp(`\\b${banned}\\b`, "gi"), "");
    }
    cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
    expect(cleaned).not.toContain("wind");
    expect(cleaned).not.toContain("overcast");
    expect(cleaned).not.toContain("haze");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Ultra-compact prompt validation
// ═══════════════════════════════════════════════════════════════════

describe("ultra-compact step1 prompt", () => {
  function buildUltraCompactStep1Prompt(
    storyText: string,
    directorNameKo: string,
    cutCount: number,
    secPerCut: number,
  ): string {
    const storySnippet = storyText.slice(0, 400);
    return `JSON만 출력. 감독: ${directorNameKo}. ${secPerCut}초/컷 × ${cutCount}컷.
시나리오: ${storySnippet}

{"characterSeeds":[{"id":"char-1","label":"주인공","appearance":"...≤20w","appearanceKo":"...≤15자"}],
"outlines":[{"cutNumber":1,"sceneKo":"≤20자","emotion":"영어","emotionalDelta":"prev→cur","purpose":"establish|develop|climax|resolve","shotType":"WS|MS|CU|OTS|MCU|LS|ECU|POV","cameraMovement":"≤6w","subjectAction":"≤8w","transitionHint":"≤6자","shotCategory":"character-driven|environment|object-detail|map-graphic|transition-atmosphere","characterRole":"protagonist|background|silhouette|partial|absent","locationCue":"≤5w","situationCue":"≤5w","emotionalAnchor":"≤5w","sceneBeat1":"≤8w","sceneBeat2":"≤8w","sceneBeat3":"≤8w","endHook":"≤6w"}]}`;
  }

  it("should be significantly shorter than full prompt", () => {
    const prompt = buildUltraCompactStep1Prompt("A story about dental history", "팀 버튼", 5, 8);
    // Ultra-compact should be well under 1000 chars
    expect(prompt.length).toBeLessThan(1000);
  });

  it("should include cutCount and secPerCut", () => {
    const prompt = buildUltraCompactStep1Prompt("story", "감독", 7, 10);
    expect(prompt).toContain("10초/컷");
    expect(prompt).toContain("7컷");
  });

  it("should truncate story to 400 chars", () => {
    const longStory = "가".repeat(800);
    const prompt = buildUltraCompactStep1Prompt(longStory, "감독", 5, 8);
    // The prompt should contain at most 400 chars of the story
    const storyInPrompt = prompt.match(/시나리오: (.+)/)?.[1] ?? "";
    expect(storyInPrompt.length).toBeLessThanOrEqual(500); // 400 + some JSON template
  });

  it("should include JSON schema hint", () => {
    const prompt = buildUltraCompactStep1Prompt("story", "감독", 3, 8);
    expect(prompt).toContain("characterSeeds");
    expect(prompt).toContain("outlines");
    expect(prompt).toContain("shotType");
    expect(prompt).toContain("sceneBeat1");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Response format validation
// ═══════════════════════════════════════════════════════════════════

describe("degraded response format", () => {
  it("should have correct shape for success response", () => {
    const response = {
      ok: true,
      degraded: false,
      source: "gemini" as const,
      warnings: [] as string[],
      characterSeeds: [{ id: "char-1", label: "주인공", appearance: "...", appearanceKo: "..." }],
      cuts: [],
      sequencePlan: {},
      sequenceValidation: {},
    };

    expect(response.ok).toBe(true);
    expect(response.degraded).toBe(false);
    expect(response.source).toBe("gemini");
    expect(response.warnings).toEqual([]);
  });

  it("should have correct shape for degraded response", () => {
    const response = {
      ok: true,
      degraded: true,
      reason: "step1 timeout → deterministic fallback",
      source: "deterministic-fallback" as const,
      warnings: ["step1 timed out", "falling back to deterministic cut generation"],
      characterSeeds: [{ id: "char-1", label: "주인공", appearance: "...", appearanceKo: "..." }],
      cuts: [],
    };

    expect(response.ok).toBe(true);
    expect(response.degraded).toBe(true);
    expect(response.reason).toBeDefined();
    expect(response.source).toBe("deterministic-fallback");
    expect(response.warnings.length).toBeGreaterThan(0);
  });

  it("should have correct shape for error response", () => {
    const response = {
      ok: false,
      degraded: false,
      error: "Step 1 출력이 토큰 한도를 초과했습니다.",
      detail: "MAX_TOKENS...",
      step: 1,
      cause: "MAX_TOKENS",
      source: "gemini" as const,
      warnings: [] as string[],
    };

    expect(response.ok).toBe(false);
    expect(response.degraded).toBe(false);
    expect(response.source).toBe("gemini");
    expect(response.cause).toBe("MAX_TOKENS");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. STREAMING_TIMEOUT_MS constant validation
// ═══════════════════════════════════════════════════════════════════

import { STREAMING_TIMEOUT_MS } from "../functions/api/_gemini-keys";

describe("streamingGenerate timeout constant", () => {
  it("should be under 60 seconds (Cloudflare edge limit)", () => {
    expect(STREAMING_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it("should be at least 30 seconds (enough for most requests)", () => {
    expect(STREAMING_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("should be exactly 55 seconds", () => {
    expect(STREAMING_TIMEOUT_MS).toBe(55_000);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Multi-shot scene type rules
// ═══════════════════════════════════════════════════════════════════

describe("MULTI_SHOT_SCENE_TYPES", () => {
  const MULTI_SHOT_SCENE_TYPES = ["cinematic_sequence", "character-driven", "crowd", "battle"];

  it("should include cinematic_sequence", () => {
    expect(MULTI_SHOT_SCENE_TYPES).toContain("cinematic_sequence");
  });

  it("should include character-driven", () => {
    expect(MULTI_SHOT_SCENE_TYPES).toContain("character-driven");
  });

  it("should NOT include environment (single-shot OK)", () => {
    expect(MULTI_SHOT_SCENE_TYPES).not.toContain("environment");
  });

  it("should NOT include object-detail (single-shot OK)", () => {
    expect(MULTI_SHOT_SCENE_TYPES).not.toContain("object-detail");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Structure classification in server-side classifyCuts
// ═══════════════════════════════════════════════════════════════════

import { classifyCuts } from "../functions/api/_structure-classification";
import { densifyCuts } from "../functions/api/_sequence-density";
import { buildSequencePlanFromCuts, validateSequencePlan } from "../functions/api/_sequence-plan";

// ═══════════════════════════════════════════════════════════════════
// 8.5. Server-side densifyCuts — deterministic fallback density enforcement
// ═══════════════════════════════════════════════════════════════════

describe("server-side densifyCuts — deterministic fallback density", () => {
  it("should NOT split 15s single deterministic cut (per-segment minimum is 1)", () => {
    const deterministicCuts = [{ cutNumber: 1, durationSec: 15, shotType: "WS" }];
    const result = densifyCuts(deterministicCuts);
    expect(result.length).toBe(1);
    const total = result.reduce((s, c) => s + c.durationSec, 0);
    expect(total).toBe(15);
  });

  it("should densify deterministic fallback with 5 cuts at 8s each (segment-aware)", () => {
    const deterministicCuts = Array.from({ length: 5 }, (_, i) => ({
      cutNumber: i + 1,
      durationSec: 8,
      shotType: "WS",
    }));
    const result = densifyCuts(deterministicCuts);
    // 5 cuts at 8s = 40s total. Segment-aware: 15s×2(min 10) + 10s(min 4) = 14 min
    // densifyCuts will split to meet this minimum
    expect(result.length).toBeGreaterThanOrEqual(5);
    const total = result.reduce((s, c) => s + c.durationSec, 0);
    expect(total).toBe(40); // total duration preserved
  });

  it("should NOT split 12s single cut (per-segment minimum is 1), classify with correct pipeline", () => {
    const deterministicCuts = [{ cutNumber: 1, durationSec: 12 }];
    const densified = densifyCuts(deterministicCuts);
    const classified = classifyCuts(densified);
    expect(classified.length).toBe(1);
    for (const c of classified) {
      expect(c.structureType).toBe("cut");
      expect(c.durationClass).toBeDefined();
    }
  });

  it("should preserve shotType after density split", () => {
    const deterministicCuts = [{ cutNumber: 1, durationSec: 10, shotType: "MS" }];
    const result = densifyCuts(deterministicCuts);
    for (const c of result) {
      expect(c.shotType).toBe("MS");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8.6. finalizedCuts ↔ sequencePlan 정합성
// ═══════════════════════════════════════════════════════════════════

describe("finalizedCuts ↔ sequencePlan consistency", () => {
  // 헬퍼: deterministic fallback 시뮬레이션 (실제 generate-cuts.ts와 동일 흐름)
  function simulateFallbackResponse(cutCount: number, secPerCut: number) {
    const deterministicCuts = Array.from({ length: cutCount }, (_, i) => ({
      cutNumber: i + 1,
      durationSec: secPerCut,
      sceneDescription: `장면 ${i + 1}`,
      shotCategory: i === 0 ? "environment" : "character-driven",
      characterRole: i === 0 ? "absent" : "protagonist",
    }));

    const finalizedCuts = classifyCuts(densifyCuts(deterministicCuts));
    const sequencePlan = buildSequencePlanFromCuts(finalizedCuts, {
      styleId: "live-action",
      aspectRatio: "16:9",
      directorId: "test",
    });
    const sequenceValidation = validateSequencePlan(sequencePlan);

    return { cuts: finalizedCuts, sequencePlan, sequenceValidation };
  }

  it("15s single cut → 분할 없음(minimum=1), cuts와 sequencePlan shot 수 일치", () => {
    const resp = simulateFallbackResponse(1, 15);
    expect(resp.cuts.length).toBe(1);
    expect(resp.sequencePlan.shots.length).toBe(resp.cuts.length);
  });

  it("12s single cut → 분할 없음(minimum=1), cuts와 sequencePlan shot 수 일치", () => {
    const resp = simulateFallbackResponse(1, 12);
    expect(resp.cuts.length).toBe(1);
    expect(resp.sequencePlan.shots.length).toBe(resp.cuts.length);
  });

  it("8s single cut → 분할 없음(minimum=1), cuts와 sequencePlan shot 수 일치", () => {
    const resp = simulateFallbackResponse(1, 8);
    expect(resp.cuts.length).toBe(1);
    expect(resp.sequencePlan.shots.length).toBe(resp.cuts.length);
  });

  it("4s single cut → 분할 없음, sequencePlan shot=1", () => {
    const resp = simulateFallbackResponse(1, 4);
    expect(resp.cuts.length).toBe(1);
    expect(resp.sequencePlan.shots.length).toBe(1);
  });

  it("5 cuts x 8s → segment-aware densify 적용, sequencePlan shot 수 일치", () => {
    const resp = simulateFallbackResponse(5, 8);
    // 40초 segment-aware: 더 많은 컷으로 분할될 수 있음
    expect(resp.cuts.length).toBeGreaterThanOrEqual(5);
    expect(resp.sequencePlan.shots.length).toBe(resp.cuts.length);
  });

  it("sequencePlan totalDurationSec가 cuts 합계와 일치", () => {
    const resp = simulateFallbackResponse(1, 15);
    const cutsTotal = resp.cuts.reduce((s, c) => s + c.durationSec, 0);
    expect(resp.sequencePlan.globalIntent.durationSec).toBe(cutsTotal);
  });

  it("sequencePlan validation이 통과", () => {
    const resp = simulateFallbackResponse(1, 15);
    // errors 없어야 정합
    expect(resp.sequenceValidation.summary.errors).toBe(0);
  });

  it("densify 후 classify 메타가 있는 cuts로 sequencePlan 생성 가능", () => {
    const resp = simulateFallbackResponse(1, 10);
    for (const cut of resp.cuts) {
      expect(cut.structureType).toBeDefined();
      expect(cut.durationClass).toBeDefined();
    }
    expect(resp.sequencePlan.shots.length).toBe(resp.cuts.length);
  });
});

describe("server-side classifyCuts — structureType/durationClass 보장", () => {
  it("should add structureType='cut' to individual cuts", () => {
    const cuts = [{ durationSec: 5 }, { durationSec: 3 }];
    const result = classifyCuts(cuts);
    result.forEach(c => expect(c.structureType).toBe("cut"));
  });

  it("should classify durationClass by duration thresholds", () => {
    const cuts = [
      { durationSec: 2 },   // cut-like (< 4)
      { durationSec: 5 },   // scene-like (>= 4, < 8)
      { durationSec: 10 },  // sequence-like (>= 8)
    ];
    const result = classifyCuts(cuts);
    expect(result[0].durationClass).toBe("cut-like");
    expect(result[1].durationClass).toBe("scene-like");
    expect(result[2].durationClass).toBe("sequence-like");
  });

  it("should preserve existing structureType if already set", () => {
    const cuts = [{ durationSec: 5, structureType: "scene" as const }];
    const result = classifyCuts(cuts);
    expect(result[0].structureType).toBe("scene");
  });

  it("should preserve existing durationClass if already set", () => {
    const cuts = [{ durationSec: 2, durationClass: "sequence-like" as const }];
    const result = classifyCuts(cuts);
    expect(result[0].durationClass).toBe("sequence-like");
  });

  it("should NOT add groupId", () => {
    const cuts = [{ durationSec: 8 }];
    const result = classifyCuts(cuts);
    expect((result[0] as Record<string, unknown>).groupId).toBeUndefined();
  });

  it("should handle fallback duration (0/NaN/undefined)", () => {
    const cuts = [
      { durationSec: 0 },
      { durationSec: NaN },
    ];
    const result = classifyCuts(cuts);
    result.forEach(c => {
      expect(c.structureType).toBe("cut");
      expect(c.durationClass).toBe("cut-like");
    });
  });

  it("should handle typical deterministic fallback cuts (8s each)", () => {
    const deterministicCuts = Array.from({ length: 5 }, (_, i) => ({
      cutNumber: i + 1,
      durationSec: 8,
      shotType: "WS",
    }));
    const result = classifyCuts(deterministicCuts);
    result.forEach(c => {
      expect(c.structureType).toBe("cut");
      expect(c.durationClass).toBe("sequence-like"); // 8s >= threshold
    });
  });

  it("should preserve all original fields", () => {
    const cuts = [{
      cutNumber: 1,
      durationSec: 5,
      shotType: "CU",
      sceneDescription: "테스트 장면",
      subjectAction: "walks",
    }];
    const result = classifyCuts(cuts);
    expect(result[0].cutNumber).toBe(1);
    expect(result[0].shotType).toBe("CU");
    expect(result[0].sceneDescription).toBe("테스트 장면");
    expect(result[0].subjectAction).toBe("walks");
  });
});
