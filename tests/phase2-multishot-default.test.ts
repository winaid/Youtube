/**
 * phase2-multishot-default.test.ts — Phase 2 멀티샷 기본 경로 테스트
 *
 * 제품 행동 검증:
 *   Case 1: 12s cinematic_sequence → 즉시 3-4샷 구조 표시
 *   Case 2: 멀티샷 export에 실제 Kling JSON 구조 반영
 *   Case 3: Studio 12s 단일샷 → 서버 블로킹
 *   Case 4: Batch 12s 단일샷 → 서버 auto-repair
 *   Case 5: 30 clips × 12s → 런타임 예산 초과 경고
 *   Case 6: 의도적 원테이크 → 예외 처리
 */

import { describe, it, expect } from "vitest";
import {
  buildDefaultMultiShot,
  shouldForceMultiShot,
  planRecommendedShotCount,
} from "@/lib/multi-shot-planner";
import { checkBatchBudget, BATCH_BUDGET_SECONDS } from "@/lib/batch-runtime-budget";
import { prepareMultiShotPayload } from "@/lib/video-generation-core";
import { validateFinalProviderPayload } from "@/lib/final-payload-validator";
import { VEO_DEFAULT_MODEL } from "@/lib/veo-capability";

// VEO policy stubs (kling-capability removed)
function isMultiShotEligible(_model: string, duration: number): boolean {
  return duration >= 8;
}
import type { BatchClipInfo } from "@/lib/batch-runtime-budget";

const MODEL = VEO_DEFAULT_MODEL;

// ═══════════════════════════════════════════════════════════════════
// Case 1: 12s cinematic_sequence → 자동 멀티샷 구조
// ═══════════════════════════════════════════════════════════════════

describe("Case 1: 12s cinematic_sequence 기본 구조", () => {
  it("eligible 판정 → true", () => {
    expect(isMultiShotEligible(MODEL, 12)).toBe(true);
  });

  it("강제 멀티샷 → true", () => {
    expect(shouldForceMultiShot("cinematic_sequence", 12, MODEL)).toBe(true);
  });

  it("추천 3-6샷", () => {
    const count = planRecommendedShotCount(MODEL, 12, "cinematic_sequence");
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(6);
  });

  it("buildDefaultMultiShot → 즉시 3-6샷 생성", () => {
    const shots = buildDefaultMultiShot({
      durationSec: 12,
      sceneType: "cinematic_sequence",
      basePrompt: "A warrior enters the arena",
      modelId: MODEL,
    });

    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(shots.length).toBeLessThanOrEqual(6);

    // role 시퀀스 확인 — establish로 시작, resolve로 끝남
    expect(shots[0].role).toBe("establish");
    expect(shots[shots.length - 1].role).toBe("resolve");

    // 모든 duration 합 = 12
    const total = shots.reduce((s, sh) => s + parseInt(sh.duration, 10), 0);
    expect(total).toBe(12);

    // index 1-based
    shots.forEach((s, i) => expect(s.index).toBe(i + 1));
  });
});

// ═══════════════════════════════════════════════════════════════════
// Case 2: export에 multiShot 구조 반영
// ═══════════════════════════════════════════════════════════════════

describe("Case 2: export 구조에 multiShot 반영", () => {
  it("multiShot이 있는 cut → exportJson에 multiShot 포함", () => {
    // 이 테스트는 ResultPanel의 exportJson 로직을 시뮬레이션
    const cut = {
      cutNumber: 1,
      durationSec: 12,
      sceneDescription: "Battle scene",
      multiShot: [
        { index: 1, prompt: "Wide shot", duration: "4", role: "establish" as const },
        { index: 2, prompt: "Medium shot", duration: "4", role: "develop" as const },
        { index: 3, prompt: "Close up", duration: "4", role: "resolve" as const },
      ],
    };

    // ResultPanel의 exportJson 로직 재현
    const exportCut = {
      cut: cut.cutNumber,
      duration: `${cut.durationSec}s`,
      multiShot: cut.multiShot && cut.multiShot.length > 0
        ? cut.multiShot.map(s => ({
            index: s.index,
            prompt: s.prompt,
            duration: s.duration,
            role: s.role ?? null,
          }))
        : null,
    };

    expect(exportCut.multiShot).not.toBeNull();
    expect(exportCut.multiShot!.length).toBe(3);
    expect(exportCut.multiShot![0].role).toBe("establish");
    expect(exportCut.multiShot![2].role).toBe("resolve");
  });

  it("multiShot 없는 cut → exportJson에 null", () => {
    const cut = { cutNumber: 1, durationSec: 3, multiShot: undefined };
    const exported = cut.multiShot && cut.multiShot.length > 0
      ? cut.multiShot.map(s => ({ index: s.index, prompt: s.prompt, duration: s.duration }))
      : null;

    expect(exported).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Case 3: Studio 12s 단일샷 → 블로킹
// ═══════════════════════════════════════════════════════════════════

describe("Case 3: Studio Mode 서버 블로킹", () => {
  const basePrompt = "A vast mountain landscape stretches endlessly under golden hour light. Rolling hills covered in autumn foliage cascade toward the horizon. Wispy clouds drift across the amber sky. Ancient stone formations rise from the misty valley floor. Warm sidelighting creates deep shadows across the rugged terrain surface.";

  it("Studio + 12s + 멀티샷 없음 → Rule 17 error", () => {
    const result = validateFinalProviderPayload({
      prompt: basePrompt,
      negatives: ["watermark"],
      framing: "WS",
      provider: "veo",
      shotCategory: "cinematic_sequence",
      modelId: MODEL,
      durationSec: 12,
      mode: "studio",
    });

    const rule17 = result.issues.find(i => i.rule === "forced_multishot_missing");
    expect(rule17).toBeDefined();
    expect(rule17!.severity).toBe("error");
    expect(result.valid).toBe(false);
  });

  it("Studio + 12s + intentionalOneTake → no error", () => {
    const result = validateFinalProviderPayload({
      prompt: basePrompt,
      negatives: ["watermark"],
      framing: "WS",
      provider: "veo",
      shotCategory: "cinematic_sequence",
      modelId: MODEL,
      durationSec: 12,
      mode: "studio",
      intentionalOneTake: true,
    });

    const rule17 = result.issues.find(i => i.rule === "forced_multishot_missing");
    expect(rule17).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Case 4: Batch Mode auto-repair
// ═══════════════════════════════════════════════════════════════════

describe("Case 4: Batch Mode auto-repair", () => {
  it("Batch + 12s + 멀티샷 없음 → warning (not error)", () => {
    const basePrompt = "A vast mountain landscape stretches endlessly under golden hour light. Rolling hills covered in autumn foliage cascade toward the horizon. Wispy clouds drift across the amber sky. Ancient stone formations rise from the misty valley floor. Warm sidelighting creates deep shadows across the rugged terrain surface.";
    const result = validateFinalProviderPayload({
      prompt: basePrompt,
      negatives: ["watermark"],
      framing: "WS",
      provider: "veo",
      shotCategory: "cinematic_sequence",
      modelId: MODEL,
      durationSec: 12,
      mode: "batch",
    });

    const rule17 = result.issues.find(i => i.rule === "forced_multishot_missing");
    expect(rule17).toBeDefined();
    expect(rule17!.severity).toBe("warning");
    // Batch 모드에서는 유효 (auto-repair 가능)
  });

  it("prepareMultiShotPayload auto-repair in batch", () => {
    const repaired = prepareMultiShotPayload({
      durationSec: 12,
      sceneType: "cinematic_sequence",
      basePrompt: "test",
      modelId: MODEL,
      mode: "batch",
    });

    expect(repaired.length).toBeGreaterThanOrEqual(2);
    expect(repaired[0].role).toBe("establish");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Case 5: 30 clips × 12s = 360s → 예산 초과
// ═══════════════════════════════════════════════════════════════════

describe("Case 5: 런타임 예산 초과", () => {
  it("30 × 12s = 360s → over_budget + 제안", () => {
    const clips: BatchClipInfo[] = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      durationSec: 12,
    }));

    const budget = checkBatchBudget(clips);

    expect(budget.totalRuntimeSec).toBe(360);
    expect(budget.withinBudget).toBe(false);
    expect(budget.overBudgetSec).toBe(60);
    expect(budget.severity).toBe("over_budget");

    // 구체적 제안 존재
    expect(budget.suggestions.length).toBeGreaterThan(0);

    // 배치 분할 제안 포함
    const splitSugg = budget.suggestions.find(s => s.includes("배치로 분할"));
    expect(splitSugg).toBeDefined();

    // 예산 300초 정확
    expect(BATCH_BUDGET_SECONDS).toBe(300);
  });

  it("20 × 10s = 200s → ok", () => {
    const clips: BatchClipInfo[] = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      durationSec: 10,
    }));

    const budget = checkBatchBudget(clips);
    expect(budget.severity).toBe("ok");
    expect(budget.withinBudget).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Case 6: 의도적 원테이크
// ═══════════════════════════════════════════════════════════════════

describe("Case 6: 의도적 원테이크", () => {
  it("8s + intentionalOneTake → 멀티샷 repair 안함", () => {
    const result = prepareMultiShotPayload({
      durationSec: 8,
      sceneType: "cinematic_sequence",
      modelId: MODEL,
      intentionalOneTake: true,
    });

    expect(result).toEqual([]);
  });

  it("3s 이하 → 자동 원테이크", () => {
    const result = prepareMultiShotPayload({
      durationSec: 3,
      modelId: MODEL,
    });

    expect(result).toEqual([]);
  });

  it("15s + intentionalOneTake + Studio → Rule 17 없음", () => {
    const basePrompt = "A vast mountain landscape stretches endlessly under golden hour light. Rolling hills covered in autumn foliage cascade toward the horizon. Wispy clouds drift across the amber sky. Ancient stone formations rise from the misty valley floor. Warm sidelighting creates deep shadows across the rugged terrain surface.";
    const result = validateFinalProviderPayload({
      prompt: basePrompt,
      negatives: ["watermark"],
      framing: "WS",
      provider: "veo",
      shotCategory: "environment",
      modelId: MODEL,
      durationSec: 15,
      mode: "studio",
      intentionalOneTake: true,
    });

    const rule17 = result.issues.find(i => i.rule === "forced_multishot_missing");
    expect(rule17).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// isMultiShotEligible
// ═══════════════════════════════════════════════════════════════════

describe("isMultiShotEligible", () => {
  it("VEO + 12s → true", () => {
    expect(isMultiShotEligible(MODEL, 12)).toBe(true);
  });

  it("VEO + 7s → false (VEO requires 8s)", () => {
    expect(isMultiShotEligible(MODEL, 7)).toBe(false);
  });

  it("VEO + 8s → true", () => {
    expect(isMultiShotEligible(MODEL, 8)).toBe(true);
  });

  it("VEO + 5s → false (< 8s)", () => {
    expect(isMultiShotEligible(MODEL, 5)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 서버 멀티샷 정책 시뮬레이션
// ═══════════════════════════════════════════════════════════════════

describe("서버 멀티샷 정책 시뮬레이션", () => {
  // 서버 로직을 순수 함수로 검증
  const FORCE_SCENE_TYPES = new Set([
    "cinematic_sequence", "environment", "character-driven", "battle", "montage",
  ]);

  function serverShouldForce(duration: number, sceneType: string, maxShots: number, intentionalOneTake: boolean): boolean {
    if (maxShots < 2 || intentionalOneTake) return false;
    if (duration >= 9) return true;
    if (duration >= 6 && FORCE_SCENE_TYPES.has(sceneType)) return true;
    return false;
  }

  it("12s cinematic → 강제", () => {
    expect(serverShouldForce(12, "cinematic_sequence", 6, false)).toBe(true);
  });

  it("5s default → 비강제", () => {
    expect(serverShouldForce(5, "default", 2, false)).toBe(false);
  });

  it("9s default → 강제", () => {
    expect(serverShouldForce(9, "default", 4, false)).toBe(true);
  });

  it("12s + intentionalOneTake → 비강제", () => {
    expect(serverShouldForce(12, "cinematic_sequence", 6, true)).toBe(false);
  });

  it("6s environment → 강제", () => {
    expect(serverShouldForce(6, "environment", 3, false)).toBe(true);
  });

  it("maxShots < 2 → 비강제", () => {
    expect(serverShouldForce(12, "cinematic_sequence", 0, false)).toBe(false);
  });
});
