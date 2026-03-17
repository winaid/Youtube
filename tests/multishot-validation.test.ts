/**
 * multishot-validation.test.ts — MultiShotValidation 유틸 테스트
 *
 * 검증 대상:
 *   - validateMultiShots: 실시간 검증 (에러/경고 분류)
 *   - inferShotRole: position 기반 역할 자동 추론
 *   - addShot / removeShot / resizeShot: duration 재분배
 *   - distributeEvenly: 균등 분배
 */

import { describe, it, expect } from "vitest";
import {
  validateMultiShots,
  inferShotRole,
  addShot,
  removeShot,
  resizeShot,
  distributeEvenly,
  autoAssignRoles,
  PROMPT_MAX_LENGTH,
  PROMPT_WARN_LENGTH,
} from "@/lib/multishot-validation";
import { KLING_DEFAULT_TEXT_MODEL } from "@/lib/kling-capability";
import type { MultiShotPrompt } from "@/types";

const MODEL = KLING_DEFAULT_TEXT_MODEL; // kling-o3-text-to-video

// ═══════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════

/** Helper with distinct framing and roles for valid progression */
const SAMPLE_PROMPTS = [
  "Wide shot establishing the space and environment with atmospheric detail",
  "Medium shot revealing character action and new narrative information",
  "Close-up on emotional peak with dramatic intensity and tension",
  "Wide shot pulling back for visual payoff and resolution release",
  "Extreme close-up insert on critical detail for tension escalation",
  "Medium shot transitioning to new angle and perspective shift",
];
const SAMPLE_ROLES: Array<"establish" | "develop" | "peak" | "resolve" | "insert" | "transition"> =
  ["establish", "develop", "peak", "resolve", "insert", "transition"];

function makeShots(count: number, totalDuration: number): MultiShotPrompt[] {
  const dur = Math.floor(totalDuration / count);
  const remainder = totalDuration - dur * count;
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    prompt: SAMPLE_PROMPTS[i % SAMPLE_PROMPTS.length],
    duration: String(i === count - 1 ? dur + remainder : dur),
    role: SAMPLE_ROLES[i % SAMPLE_ROLES.length],
  }));
}

// ═══════════════════════════════════════════════════════════════════
// inferShotRole
// ═══════════════════════════════════════════════════════════════════

describe("inferShotRole", () => {
  it("단일 샷 → establish", () => {
    expect(inferShotRole(0, 1)).toBe("establish");
  });

  it("첫 번째 → establish, 마지막 → resolve", () => {
    expect(inferShotRole(0, 4)).toBe("establish");
    expect(inferShotRole(3, 4)).toBe("resolve");
  });

  it("중간점 → peak", () => {
    expect(inferShotRole(2, 5)).toBe("peak"); // floor(5/2)=2
    expect(inferShotRole(1, 3)).toBe("peak"); // floor(3/2)=1
  });

  it("그 외 → develop", () => {
    expect(inferShotRole(1, 5)).toBe("develop");
    expect(inferShotRole(3, 5)).toBe("develop");
  });
});

// ═══════════════════════════════════════════════════════════════════
// validateMultiShots
// ═══════════════════════════════════════════════════════════════════

describe("validateMultiShots", () => {
  it("정상 멀티샷 → valid", () => {
    const shots = makeShots(3, 10);
    const result = validateMultiShots(MODEL, shots, 10);
    expect(result.valid).toBe(true);
    expect(result.shotIssues).toHaveLength(0);
  });

  it("빈 prompt → error", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "", duration: "5" },
      { index: 2, prompt: "Valid", duration: "5" },
    ];
    const result = validateMultiShots(MODEL, shots, 10);
    expect(result.valid).toBe(false);
    expect(result.shotIssues.some(i => i.shotIndex === 1 && i.field === "prompt" && i.severity === "error")).toBe(true);
  });

  it("prompt > 512자 → error", () => {
    const longPrompt = "x".repeat(PROMPT_MAX_LENGTH + 1);
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: longPrompt, duration: "5" },
      { index: 2, prompt: "Valid", duration: "5" },
    ];
    const result = validateMultiShots(MODEL, shots, 10);
    expect(result.valid).toBe(false);
    expect(result.shotIssues.some(i => i.field === "prompt" && i.severity === "error")).toBe(true);
  });

  it("prompt > 450자 → warning (not error)", () => {
    const warnPrompt = "x".repeat(PROMPT_WARN_LENGTH + 1);
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: warnPrompt, duration: "5" },
      { index: 2, prompt: "Valid", duration: "5" },
    ];
    const result = validateMultiShots(MODEL, shots, 10);
    expect(result.valid).toBe(true); // warnings don't invalidate
    expect(result.shotIssues.some(i => i.severity === "warning")).toBe(true);
  });

  it("duration 합 불일치 → error", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "3" },
      { index: 2, prompt: "B", duration: "3" },
    ];
    const result = validateMultiShots(MODEL, shots, 10); // sum=6 ≠ 10
    expect(result.valid).toBe(false);
    expect(result.aggregateIssues.some(i => i.message.includes("시간 합계"))).toBe(true);
  });

  it("duration < minShotDuration → error", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "1" }, // min is 2 for O3
      { index: 2, prompt: "B", duration: "9" },
    ];
    const result = validateMultiShots(MODEL, shots, 10);
    expect(result.valid).toBe(false);
    expect(result.shotIssues.some(i => i.field === "duration" && i.severity === "error")).toBe(true);
  });

  it("모든 role 동일 → monotone warning", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "3", role: "develop" },
      { index: 2, prompt: "B", duration: "3", role: "develop" },
      { index: 3, prompt: "C", duration: "4", role: "develop" },
    ];
    const result = validateMultiShots(MODEL, shots, 10);
    expect(result.aggregateIssues.some(i => i.message.includes("같은 역할"))).toBe(true);
  });

  it("샷 수 초과 → error", () => {
    // 5초 duration → maxShots=2 for O3
    const shots = makeShots(3, 5);
    const result = validateMultiShots(MODEL, shots, 5);
    expect(result.valid).toBe(false);
    expect(result.aggregateIssues.some(i => i.message.includes("샷 수 초과"))).toBe(true);
  });

  it("빈 배열 → error", () => {
    const result = validateMultiShots(MODEL, [], 10);
    expect(result.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// addShot
// ═══════════════════════════════════════════════════════════════════

describe("addShot", () => {
  it("첫 샷 추가 → totalDuration 할당", () => {
    const result = addShot(MODEL, [], 10);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].duration).toBe("10");
    expect(result![0].role).toBe("establish");
  });

  it("마지막 샷에서 시간 분할", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "10" },
    ];
    const result = addShot(MODEL, shots, 10);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    // 총 duration 유지
    const total = result!.reduce((s, sh) => s + parseInt(sh.duration, 10), 0);
    expect(total).toBe(10);
  });

  it("maxShots 도달 시 null", () => {
    // 5초 → maxShots=2
    const shots = makeShots(2, 5);
    const result = addShot(MODEL, shots, 5);
    expect(result).toBeNull();
  });

  it("분할 불가 (모든 샷이 최소 길이) → null", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "2" },
      { index: 2, prompt: "B", duration: "2" },
      { index: 3, prompt: "C", duration: "2" },
      { index: 4, prompt: "D", duration: "2" }, // maxShots=4 for 8s, can't add more
    ];
    const result = addShot(MODEL, shots, 8);
    expect(result).toBeNull();
  });

  it("re-index 보장", () => {
    const shots = makeShots(2, 10);
    const result = addShot(MODEL, shots, 10);
    expect(result).not.toBeNull();
    result!.forEach((s, i) => expect(s.index).toBe(i + 1));
  });
});

// ═══════════════════════════════════════════════════════════════════
// removeShot
// ═══════════════════════════════════════════════════════════════════

describe("removeShot", () => {
  it("삭제 후 duration 마지막 샷에 흡수", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "4" },
      { index: 2, prompt: "B", duration: "3" },
      { index: 3, prompt: "C", duration: "3" },
    ];
    const result = removeShot(shots, 2); // remove shot 2 (3초)
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    // 총 duration 유지 (10초)
    const total = result!.reduce((s, sh) => s + parseInt(sh.duration, 10), 0);
    expect(total).toBe(10);
    // 마지막 샷에 흡수
    expect(parseInt(result![1].duration, 10)).toBe(6); // 3+3
  });

  it("1개만 남으면 삭제 불가", () => {
    const shots: MultiShotPrompt[] = [{ index: 1, prompt: "A", duration: "10" }];
    expect(removeShot(shots, 1)).toBeNull();
  });

  it("re-index 보장", () => {
    const shots = makeShots(3, 10);
    const result = removeShot(shots, 1);
    expect(result).not.toBeNull();
    result!.forEach((s, i) => expect(s.index).toBe(i + 1));
  });
});

// ═══════════════════════════════════════════════════════════════════
// resizeShot
// ═══════════════════════════════════════════════════════════════════

describe("resizeShot", () => {
  it("확대 → 다음 샷에서 보상", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "3" },
      { index: 2, prompt: "B", duration: "4" },
      { index: 3, prompt: "C", duration: "3" },
    ];
    const result = resizeShot(MODEL, shots, 1, 5); // +2초
    expect(result).not.toBeNull();
    const total = result!.reduce((s, sh) => s + parseInt(sh.duration, 10), 0);
    expect(total).toBe(10); // 총 duration 유지
    expect(parseInt(result![0].duration, 10)).toBe(5);
  });

  it("축소 → 다음 샷에 보상", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "5" },
      { index: 2, prompt: "B", duration: "3" },
      { index: 3, prompt: "C", duration: "2" },
    ];
    const result = resizeShot(MODEL, shots, 1, 3); // -2초
    expect(result).not.toBeNull();
    const total = result!.reduce((s, sh) => s + parseInt(sh.duration, 10), 0);
    expect(total).toBe(10);
    expect(parseInt(result![0].duration, 10)).toBe(3);
    expect(parseInt(result![1].duration, 10)).toBe(5); // 3+2
  });

  it("minDuration 미만 → null", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "5" },
      { index: 2, prompt: "B", duration: "5" },
    ];
    const result = resizeShot(MODEL, shots, 1, 1); // 1 < minDur(2)
    expect(result).toBeNull();
  });

  it("보상 불가능 → null", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "2" },
      { index: 2, prompt: "B", duration: "2" },
    ];
    // 1번 샷을 3으로 → 2번 샷은 최소 2인데 1이 됨 → 불가
    const result = resizeShot(MODEL, shots, 1, 3);
    expect(result).toBeNull();
  });

  it("변경 없음 (delta=0) → 복사 반환", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "5" },
      { index: 2, prompt: "B", duration: "5" },
    ];
    const result = resizeShot(MODEL, shots, 1, 5);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].duration).toBe("5");
  });
});

// ═══════════════════════════════════════════════════════════════════
// distributeEvenly
// ═══════════════════════════════════════════════════════════════════

describe("distributeEvenly", () => {
  it("균등 분배 + 나머지 마지막 할당", () => {
    const result = distributeEvenly(MODEL, 3, 10);
    expect(result).toHaveLength(3);
    const total = result.reduce((s, sh) => s + parseInt(sh.duration, 10), 0);
    expect(total).toBe(10);
  });

  it("각 샷 minDuration 이상", () => {
    const result = distributeEvenly(MODEL, 4, 10);
    result.forEach((s) => {
      expect(parseInt(s.duration, 10)).toBeGreaterThanOrEqual(2);
    });
  });

  it("기존 prompt/role 보존", () => {
    const existing: MultiShotPrompt[] = [
      { index: 1, prompt: "Keep this", duration: "5", role: "peak" },
    ];
    const result = distributeEvenly(MODEL, 2, 10, existing);
    expect(result[0].prompt).toBe("Keep this");
    expect(result[0].role).toBe("peak");
    expect(result[1].prompt).toBe("");
  });

  it("role 자동 추론", () => {
    const result = distributeEvenly(MODEL, 3, 10);
    expect(result[0].role).toBe("establish");
    expect(result[1].role).toBe("peak");
    expect(result[2].role).toBe("resolve");
  });
});

// ═══════════════════════════════════════════════════════════════════
// autoAssignRoles
// ═══════════════════════════════════════════════════════════════════

describe("autoAssignRoles", () => {
  it("모든 role을 position 기반으로 재할당", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "3", role: "insert" },
      { index: 2, prompt: "B", duration: "4", role: "insert" },
      { index: 3, prompt: "C", duration: "3", role: "insert" },
    ];
    const result = autoAssignRoles(shots);
    expect(result[0].role).toBe("establish");
    expect(result[1].role).toBe("peak");
    expect(result[2].role).toBe("resolve");
  });

  it("userSetRoles에 포함된 샷은 role 유지", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "A", duration: "3", role: "transition" },
      { index: 2, prompt: "B", duration: "4", role: "insert" },
      { index: 3, prompt: "C", duration: "3", role: "peak" },
    ];
    const userSet = new Set([1, 3]); // shot 1, 3은 사용자 설정
    const result = autoAssignRoles(shots, userSet);
    expect(result[0].role).toBe("transition"); // 유지
    expect(result[1].role).toBe("peak"); // 재할당 (중간점)
    expect(result[2].role).toBe("peak"); // 유지
  });
});

// ═══════════════════════════════════════════════════════════════════
// Shot Density (Runtime Heuristics)
// ═══════════════════════════════════════════════════════════════════

import { checkShotDensity, getRecommendedShotRange } from "@/lib/multishot-validation";

describe("getRecommendedShotRange", () => {
  it("3–5s → 1–2", () => {
    expect(getRecommendedShotRange(5)).toEqual({ min: 1, max: 2 });
  });
  it("6–8s → 2–3", () => {
    expect(getRecommendedShotRange(8)).toEqual({ min: 2, max: 3 });
  });
  it("9–12s → 3–4", () => {
    expect(getRecommendedShotRange(12)).toEqual({ min: 3, max: 4 });
  });
  it("13–15s → 4–6", () => {
    expect(getRecommendedShotRange(15)).toEqual({ min: 4, max: 6 });
  });
});

describe("checkShotDensity", () => {
  it("12s + 1 shot → warning", () => {
    const result = checkShotDensity(12, 1);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.message).toContain("3–4개 권장");
  });

  it("12s + 3 shots → OK", () => {
    expect(checkShotDensity(12, 3)).toBeNull();
  });

  it("5s + 1 shot → OK (짧은 영상)", () => {
    expect(checkShotDensity(5, 1)).toBeNull();
  });

  it("8s + 1 shot → warning", () => {
    const result = checkShotDensity(8, 1);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("2–3개 권장");
  });

  it("15s + 4 shots → OK", () => {
    expect(checkShotDensity(15, 4)).toBeNull();
  });

  it("15s + 2 shots → warning", () => {
    const result = checkShotDensity(15, 2);
    expect(result).not.toBeNull();
  });
});
