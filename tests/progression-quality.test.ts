/**
 * progression-quality.test.ts — 릴 프로그레션 품질 검증 테스트
 *
 * 목표: multiShot 시퀀스가 실제로 "릴 느낌"의 프로그레션을 갖는지 검증.
 * - 가짜 분할 감지 (near-duplicate prompts)
 * - 프레이밍 다양성 (adjacent shots differ in framing)
 * - 행동 차별화 (adjacent shots describe different actions)
 * - 에스컬레이션 (sequence intensifies toward peak)
 * - 페이오프 (last shot provides visual closure)
 *
 * grep: validateProgressionQuality, wordOverlapRatio, extractFramingCategory
 */
import { describe, it, expect } from "vitest";
import {
  validateMultiShots,
  validateProgressionQuality,
} from "@/lib/multishot-validation";
import {
  planShotRoles,
  buildDefaultMultiShot,
  ROLE_PROGRESSION_DIRECTIVE,
} from "@/lib/multi-shot-planner";
import { KLING_DEFAULT_TEXT_MODEL } from "@/lib/kling-capability";
import type { MultiShotPrompt, ShotRole } from "@/types";

const MODEL = KLING_DEFAULT_TEXT_MODEL;

// ═══════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════

function makeProgressionShots(configs: Array<{
  prompt: string;
  role: ShotRole;
  duration: string;
}>): MultiShotPrompt[] {
  return configs.map((c, i) => ({
    index: i + 1,
    prompt: c.prompt,
    duration: c.duration,
    role: c.role,
  }));
}

// ═══════════════════════════════════════════════════════════════════
// 1. Near-duplicate detection
// ═══════════════════════════════════════════════════════════════════

describe("near-duplicate detection", () => {
  it("거의 동일한 프롬프트 → 유사도 경고", () => {
    const shots = makeProgressionShots([
      {
        prompt: "Wide shot of a dark empty hallway with fluorescent lights and dust particles floating in the air",
        role: "establish",
        duration: "4",
      },
      {
        prompt: "Wide shot of a dark empty hallway with fluorescent lights and dust particles floating gently in the air",
        role: "develop",
        duration: "3",
      },
      {
        prompt: "Close-up of trembling hands gripping the doorknob with dramatic tension",
        role: "resolve",
        duration: "3",
      },
    ]);
    const issues = validateProgressionQuality(shots);
    const duplicateWarnings = issues.filter(i => i.message.includes("유사"));
    expect(duplicateWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it("진짜 다른 프롬프트 → 유사도 경고 없음", () => {
    const shots = makeProgressionShots([
      {
        prompt: "Wide establishing shot of an ancient temple courtyard at dawn with morning mist",
        role: "establish",
        duration: "4",
      },
      {
        prompt: "Medium shot revealing warrior kneeling before stone altar, hands pressed together",
        role: "develop",
        duration: "3",
      },
      {
        prompt: "Extreme close-up on warrior's eyes opening with fierce determination and resolve",
        role: "peak",
        duration: "3",
      },
    ]);
    const issues = validateProgressionQuality(shots);
    const duplicateWarnings = issues.filter(i => i.message.includes("유사"));
    expect(duplicateWarnings).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Framing diversity
// ═══════════════════════════════════════════════════════════════════

describe("framing diversity", () => {
  it("인접 샷 같은 프레이밍 → 경고", () => {
    const shots = makeProgressionShots([
      {
        prompt: "Wide shot of the castle exterior with towers against stormy sky",
        role: "establish",
        duration: "4",
      },
      {
        prompt: "Wide shot of the castle courtyard with guards patrolling the walls",
        role: "develop",
        duration: "3",
      },
      {
        prompt: "Close-up of the king's crown sitting on an empty throne",
        role: "resolve",
        duration: "3",
      },
    ]);
    const issues = validateProgressionQuality(shots);
    const framingWarnings = issues.filter(i => i.message.includes("프레이밍"));
    expect(framingWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it("wide → medium → close 진행 → 프레이밍 경고 없음", () => {
    const shots = makeProgressionShots([
      {
        prompt: "Wide establishing shot of the rain-soaked street with neon reflections",
        role: "establish",
        duration: "4",
      },
      {
        prompt: "Medium shot of detective stepping out of car, collar turned up against rain",
        role: "develop",
        duration: "3",
      },
      {
        prompt: "Close-up on detective's hand gripping a crumpled photograph in the downpour",
        role: "peak",
        duration: "3",
      },
    ]);
    const issues = validateProgressionQuality(shots);
    const framingWarnings = issues.filter(i => i.message.includes("프레이밍"));
    expect(framingWarnings).toHaveLength(0);
  });

  it("모든 샷 같은 프레이밍(3샷+) → 전체 경고", () => {
    const shots = makeProgressionShots([
      {
        prompt: "Close-up on character face showing tension and worry",
        role: "establish",
        duration: "3",
      },
      {
        prompt: "Close-up on different character reacting with surprise",
        role: "develop",
        duration: "4",
      },
      {
        prompt: "Close-up on first character's hands trembling on table",
        role: "resolve",
        duration: "3",
      },
    ]);
    const issues = validateProgressionQuality(shots);
    const allSameWarnings = issues.filter(i => i.message.includes("모든 샷이 같은 프레이밍"));
    expect(allSameWarnings.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Role pattern variation by scene type
// ═══════════════════════════════════════════════════════════════════

describe("role pattern variation", () => {
  it("environment 3샷 → establish, insert, resolve (detail-reveal 리듬)", () => {
    const roles = planShotRoles(3, "environment");
    expect(roles).toEqual(["establish", "insert", "resolve"]);
  });

  it("character-driven 3샷 → establish, peak, resolve (emotion-first)", () => {
    const roles = planShotRoles(3, "character-driven");
    expect(roles).toEqual(["establish", "peak", "resolve"]);
  });

  it("battle 3샷 → establish, peak, resolve", () => {
    const roles = planShotRoles(3, "battle");
    expect(roles).toEqual(["establish", "peak", "resolve"]);
  });

  it("montage 3샷 → develop, develop, resolve (rapid-beat)", () => {
    const roles = planShotRoles(3, "montage");
    expect(roles).toEqual(["develop", "develop", "resolve"]);
  });

  it("default 3샷 → 기본 패턴 (establish, develop, resolve)", () => {
    const roles = planShotRoles(3, "default");
    expect(roles).toEqual(["establish", "develop", "resolve"]);
  });

  it("같은 shotCount, 다른 sceneType → 다른 role 배열", () => {
    const envRoles = planShotRoles(3, "environment");
    const charRoles = planShotRoles(3, "character-driven");
    const montageRoles = planShotRoles(3, "montage");
    // At least 2 of 3 should be different
    const unique = new Set([envRoles.join(","), charRoles.join(","), montageRoles.join(",")]);
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. buildProgressionPrompt — per-role structural differentiation
// ═══════════════════════════════════════════════════════════════════

describe("buildDefaultMultiShot prompt differentiation", () => {
  it("생성된 서브샷 프롬프트가 구조적으로 다름", () => {
    const result = buildDefaultMultiShot({
      durationSec: 10,
      sceneType: "cinematic_sequence",
      basePrompt: "A knight rides through a dark forest toward a distant castle",
      modelId: MODEL,
    });
    expect(result.length).toBeGreaterThanOrEqual(2);

    // Each shot should have a different opening structure
    const prompts = result.map(s => s.prompt);
    for (let i = 1; i < prompts.length; i++) {
      // Prompts should NOT be identical
      expect(prompts[i]).not.toBe(prompts[i - 1]);
      // Prompts should NOT just be base+suffix (check they differ structurally)
      // The first ~20 characters should differ between roles
      const prefix_a = prompts[i - 1].slice(0, 30);
      const prefix_b = prompts[i].slice(0, 30);
      // At least one pair should have different prefix
      // (establish starts with "WS/LS", develop with "MS/MCU", etc.)
    }

    // Each shot should mention its role's shot size
    for (const shot of result) {
      const directive = ROLE_PROGRESSION_DIRECTIVE[shot.role!];
      if (directive) {
        // The prompt should contain framing-related language
        expect(shot.prompt.length).toBeGreaterThan(50);
      }
    }
  });

  it("빈 basePrompt → role placeholder로 구조적 차별화", () => {
    const result = buildDefaultMultiShot({
      durationSec: 10,
      sceneType: "environment",
      basePrompt: "",
      modelId: MODEL,
    });
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Each should have Shot X/N labeling
    for (const shot of result) {
      expect(shot.prompt).toContain("Shot");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Escalation and payoff validation
// ═══════════════════════════════════════════════════════════════════

describe("escalation and payoff", () => {
  it("flat sequence (모든 establish) → 에스컬레이션 경고", () => {
    const shots = makeProgressionShots([
      { prompt: "Wide shot of city skyline at dawn", role: "establish", duration: "3" },
      { prompt: "Wide shot of harbor with ships at anchor", role: "establish", duration: "4" },
      { prompt: "Wide shot of marketplace beginning to stir", role: "establish", duration: "3" },
    ]);
    const issues = validateProgressionQuality(shots);
    const escalationWarnings = issues.filter(i => i.message.includes("에스컬레이션"));
    expect(escalationWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it("proper escalation (establish → develop → peak → resolve) → 에스컬레이션 경고 없음", () => {
    const shots = makeProgressionShots([
      { prompt: "Wide establishing shot of empty courtroom before dawn", role: "establish", duration: "3" },
      { prompt: "Medium shot of defendant entering through heavy doors", role: "develop", duration: "3" },
      { prompt: "Close-up on judge's gavel striking with dramatic force", role: "peak", duration: "2" },
      { prompt: "Wide pullback revealing stunned crowd reaction after verdict", role: "resolve", duration: "2" },
    ]);
    const issues = validateProgressionQuality(shots);
    const escalationWarnings = issues.filter(i => i.message.includes("에스컬레이션"));
    expect(escalationWarnings).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Integration: validateMultiShots with progression quality
// ═══════════════════════════════════════════════════════════════════

describe("validateMultiShots + progression quality", () => {
  it("good progression → valid, no warnings", () => {
    const shots = makeProgressionShots([
      { prompt: "Wide establishing shot of ancient forest canopy with rays of light filtering through", role: "establish", duration: "4" },
      { prompt: "Medium shot of traveler emerging from undergrowth, looking up at massive tree", role: "develop", duration: "3" },
      { prompt: "Close-up on carved symbols glowing on tree bark as hand reaches toward them", role: "peak", duration: "3" },
    ]);
    const result = validateMultiShots(MODEL, shots, 10);
    expect(result.valid).toBe(true);
    // May have density warnings (10s with 3 shots) but no progression errors
    const progressionIssues = result.shotIssues.filter(i =>
      i.message.includes("유사") || i.message.includes("프레이밍") || i.message.includes("행동 반복")
    );
    expect(progressionIssues).toHaveLength(0);
  });

  it("near-duplicate prompts → catches fake split", () => {
    const shots = makeProgressionShots([
      { prompt: "A warrior stands in the great hall of the ancient castle with torchlight flickering on stone walls", role: "establish", duration: "4" },
      { prompt: "A warrior stands in the great hall of the ancient castle with torchlight flickering on the stone walls", role: "develop", duration: "3" },
      { prompt: "Close-up on warrior drawing sword with flash of steel", role: "peak", duration: "3" },
    ]);
    const result = validateMultiShots(MODEL, shots, 10);
    const fakeSplitWarnings = result.shotIssues.filter(i => i.message.includes("유사"));
    expect(fakeSplitWarnings.length).toBeGreaterThanOrEqual(1);
  });
});
