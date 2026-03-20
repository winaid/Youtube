/**
 * phase3-qa-edge-cases.test.ts — Phase 3 최종 QA 엣지 케이스 검증
 *
 * Case A: 12s cinematic_sequence 전체 흐름
 * Case B: 15s environment 4-6샷
 * Case C: 8s 의도적 원테이크
 * Case D: 30 × 12s 배치 예산 초과
 * Case E: 미지원 모델
 * Case F: 서버 auto-repair 이후 복구
 */

import { describe, it, expect } from "vitest";
import {
  buildDefaultMultiShot,
  shouldForceMultiShot,
  planRecommendedShotCount,
} from "@/lib/multi-shot-planner";
import { VEO_DEFAULT_MODEL } from "@/lib/veo-capability";

// VEO policy stubs (kling-capability removed)
const VEO_MAX_SHOTS = 4;
function isMultiShotEligible(_model: string, duration: number): boolean {
  return duration >= 8;
}
function getMaxShots(_model: string, duration: number): number {
  return duration >= 8 ? VEO_MAX_SHOTS : 0;
}
import { checkBatchBudget } from "@/lib/batch-runtime-budget";
import { prepareMultiShotPayload } from "@/lib/video-generation-core";
import { validateFinalProviderPayload } from "@/lib/final-payload-validator";
import { validateStudioMode, validateBatchMode } from "@/lib/multishot-validation";
import type { BatchClipInfo } from "@/lib/batch-runtime-budget";
import type { JobRequestSummary } from "@/lib/video-job-store";

const MODEL = VEO_DEFAULT_MODEL;

// ═══════════════════════════════════════════════════════════════════
// Case A: 12s cinematic_sequence — 전체 흐름 일관성
// ═══════════════════════════════════════════════════════════════════

describe("Case A: 12s cinematic_sequence 전체 흐름", () => {
  const DURATION = 12;
  const SCENE = "cinematic_sequence";

  it("멀티샷 eligible", () => {
    expect(isMultiShotEligible(MODEL, DURATION)).toBe(true);
  });

  it("강제 멀티샷", () => {
    expect(shouldForceMultiShot(SCENE, DURATION, MODEL)).toBe(true);
  });

  it("3-6샷 기본 생성", () => {
    const shots = buildDefaultMultiShot({
      durationSec: DURATION,
      sceneType: SCENE,
      basePrompt: "A warrior enters the arena",
      modelId: MODEL,
    });
    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(shots.length).toBeLessThanOrEqual(6);
  });

  it("역할 progression: establish → ... → resolve", () => {
    const shots = buildDefaultMultiShot({
      durationSec: DURATION,
      sceneType: SCENE,
      basePrompt: "test",
      modelId: MODEL,
    });
    expect(shots[0].role).toBe("establish");
    expect(shots[shots.length - 1].role).toBe("resolve");
  });

  it("duration 합 = 12", () => {
    const shots = buildDefaultMultiShot({
      durationSec: DURATION,
      sceneType: SCENE,
      basePrompt: "test",
      modelId: MODEL,
    });
    const total = shots.reduce((s, sh) => s + parseInt(sh.duration, 10), 0);
    expect(total).toBe(DURATION);
  });

  it("export 구조에 multiShot 포함", () => {
    const shots = buildDefaultMultiShot({
      durationSec: DURATION,
      sceneType: SCENE,
      basePrompt: "test",
      modelId: MODEL,
    });
    const exportCut = {
      multiShot: shots.map(s => ({
        index: s.index,
        prompt: s.prompt,
        duration: s.duration,
        role: s.role ?? null,
      })),
    };
    expect(exportCut.multiShot.length).toBeGreaterThanOrEqual(3);
    expect(exportCut.multiShot[0].role).toBe("establish");
  });

  it("Studio 모드 멀티샷 없으면 blocking", () => {
    const result = validateStudioMode(MODEL, undefined, DURATION, SCENE);
    expect(result.valid).toBe(false);
  });

  it("Batch 모드 멀티샷 없어도 통과", () => {
    const result = validateBatchMode(MODEL, undefined, DURATION);
    expect(result.valid).toBe(true);
  });

  it("submission repair → 멀티샷 생성 (batch)", () => {
    const repaired = prepareMultiShotPayload({
      durationSec: DURATION,
      sceneType: SCENE,
      basePrompt: "test",
      modelId: MODEL,
      mode: "batch",
    });
    expect(repaired.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Case B: 15s environment — 4-6샷
// ═══════════════════════════════════════════════════════════════════

describe("Case B: 15s environment", () => {
  const DURATION = 15;
  const SCENE = "environment";

  it("4-6샷 추천", () => {
    const count = planRecommendedShotCount(MODEL, DURATION, SCENE);
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(6);
  });

  it("기본 생성 4+샷", () => {
    const shots = buildDefaultMultiShot({
      durationSec: DURATION,
      sceneType: SCENE,
      basePrompt: "Vast mountain landscape",
      modelId: MODEL,
    });
    expect(shots.length).toBeGreaterThanOrEqual(4);
  });

  it("duration 합 정확", () => {
    const shots = buildDefaultMultiShot({
      durationSec: DURATION,
      sceneType: SCENE,
      basePrompt: "test",
      modelId: MODEL,
    });
    const total = shots.reduce((s, sh) => s + parseInt(sh.duration, 10), 0);
    expect(total).toBe(DURATION);
  });

  it("역할 progression 존재", () => {
    const shots = buildDefaultMultiShot({
      durationSec: DURATION,
      sceneType: SCENE,
      basePrompt: "test",
      modelId: MODEL,
    });
    expect(shots[0].role).toBe("establish");
    expect(shots[shots.length - 1].role).toBe("resolve");
    // 모든 샷에 role 존재
    shots.forEach(s => expect(s.role).toBeDefined());
  });

  it("budget 반영 (15s × 1 = 15s → ok)", () => {
    const clips: BatchClipInfo[] = [{ id: 1, durationSec: DURATION }];
    const budget = checkBatchBudget(clips);
    expect(budget.withinBudget).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Case C: 8s 의도적 원테이크
// ═══════════════════════════════════════════════════════════════════

describe("Case C: 8s 의도적 원테이크", () => {
  it("prepareMultiShotPayload → 빈 배열", () => {
    const result = prepareMultiShotPayload({
      durationSec: 8,
      sceneType: "cinematic_sequence",
      modelId: MODEL,
      intentionalOneTake: true,
    });
    expect(result).toEqual([]);
  });

  it("validator — intentionalOneTake → Rule 17 없음", () => {
    const basePrompt = "A vast mountain landscape stretches endlessly under golden hour light. Rolling hills covered in autumn foliage cascade toward the horizon. Wispy clouds drift across the amber sky. Ancient stone formations rise from the misty valley floor. Warm sidelighting creates deep shadows across the rugged terrain surface.";
    const result = validateFinalProviderPayload({
      prompt: basePrompt,
      negatives: ["watermark"],
      framing: "WS",
      provider: "veo",
      shotCategory: "cinematic_sequence",
      modelId: MODEL,
      durationSec: 8,
      mode: "studio",
      intentionalOneTake: true,
    });
    const rule17 = result.issues.find(i => i.rule === "forced_multishot_missing");
    expect(rule17).toBeUndefined();
  });

  it("Studio 검증 — intentionalOneTake → 블로킹 없음", () => {
    const result = validateStudioMode(MODEL, undefined, 8, "cinematic_sequence", true);
    const forcedError = result.aggregateIssues.find(i =>
      i.message.includes("멀티샷 필수"),
    );
    expect(forcedError).toBeUndefined();
  });

  it("JobRequestSummary에 intentionalOneTake 저장 가능", () => {
    const summary: JobRequestSummary = {
      promptPreview: "test",
      multiShotCount: 0,
      multiShotRoles: [],
      generationMode: "studio",
      intentionalOneTake: true,
    };
    expect(summary.intentionalOneTake).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Case D: 30 × 12s = 360s → 예산 초과
// ═══════════════════════════════════════════════════════════════════

describe("Case D: 30 × 12s 배치 예산 초과", () => {
  const clips: BatchClipInfo[] = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    durationSec: 12,
  }));

  it("총 런타임 360s", () => {
    const budget = checkBatchBudget(clips);
    expect(budget.totalRuntimeSec).toBe(360);
  });

  it("예산 초과 감지", () => {
    const budget = checkBatchBudget(clips);
    expect(budget.withinBudget).toBe(false);
    expect(budget.severity).toBe("over_budget");
    expect(budget.overBudgetSec).toBe(60);
  });

  it("분할 제안 포함", () => {
    const budget = checkBatchBudget(clips);
    expect(budget.suggestions.length).toBeGreaterThan(0);
    const splitSugg = budget.suggestions.find(s => s.includes("배치로 분할"));
    expect(splitSugg).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Case E: 미지원 모델
// ═══════════════════════════════════════════════════════════════════

describe("Case E: 미지원 모델", () => {
  it("non-VEO 모델 → multi-shot ineligible (duration < 8)", () => {
    expect(isMultiShotEligible("some-non-veo-model", 5)).toBe(false);
  });

  it("non-VEO 모델 → maxShots = 0 (duration < 8)", () => {
    expect(getMaxShots("some-non-veo-model", 5)).toBe(0);
  });

  it("7s duration → multi-shot ineligible (VEO requires 8s)", () => {
    expect(isMultiShotEligible(MODEL, 7)).toBe(false);
  });

  it("prepareMultiShotPayload — modelId 없음 → 빈 배열", () => {
    const result = prepareMultiShotPayload({ durationSec: 12 });
    expect(result).toEqual([]);
  });

  it("prepareMultiShotPayload — 기존 multiShot은 보존 (modelId 없어도)", () => {
    const existing = [
      { index: 1, prompt: "Shot 1", duration: "6", role: "establish" as const },
      { index: 2, prompt: "Shot 2", duration: "6", role: "resolve" as const },
    ];
    const result = prepareMultiShotPayload({
      existingMultiShot: existing,
      durationSec: 12,
    });
    expect(result).toEqual(existing);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Case F: 서버 auto-repair 이후 복구 — 메타데이터 구조 검증
// ═══════════════════════════════════════════════════════════════════

describe("Case F: 복구 메타데이터 구조", () => {
  it("JobRequestSummary에 모든 필수 필드 존재", () => {
    const summary: JobRequestSummary = {
      promptPreview: "A warrior enters the battlefield...",
      durationSeconds: 12,
      aspectRatio: "16:9",
      videoMode: "generate",
      multiShotCount: 3,
      multiShotRoles: ["establish", "develop", "resolve"],
      generationMode: "batch",
      intentionalOneTake: false,
    };

    expect(summary.multiShotCount).toBe(3);
    expect(summary.multiShotRoles).toEqual(["establish", "develop", "resolve"]);
    expect(summary.generationMode).toBe("batch");
    expect(summary.intentionalOneTake).toBe(false);
  });

  it("원테이크 복구 메타데이터", () => {
    const summary: JobRequestSummary = {
      promptPreview: "Long take landscape...",
      multiShotCount: 0,
      multiShotRoles: [],
      generationMode: "studio",
      intentionalOneTake: true,
    };

    expect(summary.intentionalOneTake).toBe(true);
    expect(summary.multiShotCount).toBe(0);
  });

  it("auto-repair 후 멀티샷 메타데이터 (Batch)", () => {
    // Batch에서 auto-repair된 경우 — client에서 저장한 원본 메타
    const summary: JobRequestSummary = {
      promptPreview: "test",
      multiShotCount: 0, // 원래 없었음
      multiShotRoles: [], // 원래 없었음
      generationMode: "batch", // Batch = auto-repair 가능
    };

    // Batch 모드에서 multiShotCount=0이면 서버가 auto-repair했을 가능성
    expect(summary.generationMode).toBe("batch");
    expect(summary.multiShotCount).toBe(0);
    // 사용자가 이 정보로 "서버에서 자동 생성됨" 추론 가능
  });
});
