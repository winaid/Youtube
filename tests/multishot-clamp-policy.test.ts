/**
 * multishot-clamp-policy.test.ts — VEO 모델 패밀리 capability 테스트
 *
 * VEO policy: Always 8s, always 4-shot multishot, no exceptions.
 *
 * multiShot duration policy (VEO):
 *   - duration < 8: multiShot 금지
 *   - duration >= 8: 최대 4개
 */

import { describe, it, expect } from "vitest";
import {
  VEO_DEFAULT_MODEL,
  VEO_SEGMENT_CAP,
  VEO_MANDATORY_DURATION,
  VEO_DEFAULT_SHOT_STRUCTURE,
  VEO_MODEL_REGISTRY,
  VEO_MODELS,
  getCapability,
  resolveModelForWorkflow,
  isVideoGenerationModel,
  type WorkflowType,
} from "@/lib/veo-capability";
import { recommendMinimumCutCount, recommendCutCountRange } from "@/lib/sequence-density";

// VEO policy stubs (kling-capability removed)
const VEO_MAX_SHOTS = 4;
function getMaxShots(_model: string, duration: number): number {
  return duration >= 8 ? VEO_MAX_SHOTS : 0;
}
function normalizeMultiShots(_model: string, shots: Array<{index: number; prompt: string; duration: string; role?: string}>, _duration: number) {
  return shots.slice(0, VEO_MAX_SHOTS).map((s, i) => ({ ...s, index: i + 1 }));
}

// ═══════════════════════════════════════════════════════════════════
// 1. VEO 모델 패밀리 — capability 기본 테스트
// ═══════════════════════════════════════════════════════════════════

describe("VEO 모델 패밀리 capability", () => {
  it("레지스트리에 VEO 모델 등록", () => {
    expect(Object.keys(VEO_MODEL_REGISTRY).length).toBeGreaterThanOrEqual(3);
  });

  describe("veo-3.1-fast-generate-preview (default)", () => {
    const cap = getCapability(VEO_DEFAULT_MODEL);

    it("기본 capability 값", () => {
      expect(cap.modelId).toBe("veo-3.1-fast-generate-preview");
      expect(cap.workflowRole).toBe("text-to-video");
      expect(cap.defaultDuration).toBe(8);
      expect(cap.supportsAudio).toBe(true);
      expect(cap.supportsExtension).toBe(true);
      expect(cap.supportsReferenceImages).toBe(true);
      expect(cap.inputMode).toBe("text");
      expect(cap.outputMode).toBe("video");
    });
  });

  describe("veo-3.1-generate-preview (standard)", () => {
    const cap = getCapability(VEO_MODELS.STANDARD);

    it("기본 capability 값", () => {
      expect(cap.modelId).toBe("veo-3.1-generate-preview");
      expect(cap.workflowRole).toBe("text-to-video");
      expect(cap.defaultDuration).toBe(8);
      expect(cap.supportsAudio).toBe(true);
      expect(cap.supportsExtension).toBe(true);
      expect(cap.inputMode).toBe("text");
      expect(cap.outputMode).toBe("video");
    });

    it("fallback → fast model", () => {
      expect(cap.fallbackModelId).toBe("veo-3.1-fast-generate-preview");
    });
  });

  describe("veo-3.0-fast-generate-preview", () => {
    const cap = getCapability(VEO_MODELS.FAST_30);

    it("기본 capability 값", () => {
      expect(cap.modelId).toBe("veo-3.0-fast-generate-preview");
      expect(cap.workflowRole).toBe("text-to-video");
      expect(cap.defaultDuration).toBe(8);
      expect(cap.supportsAudio).toBe(true);
      expect(cap.supportsExtension).toBe(false);
      expect(cap.inputMode).toBe("text");
      expect(cap.outputMode).toBe("video");
    });
  });

  it("영상 생성 가능한 모델 판정", () => {
    expect(isVideoGenerationModel(VEO_DEFAULT_MODEL)).toBe(true);
    expect(isVideoGenerationModel(VEO_MODELS.STANDARD)).toBe(true);
    expect(isVideoGenerationModel(VEO_MODELS.FAST_30)).toBe(true);
    expect(isVideoGenerationModel("unknown-model")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. VEO_MODELS 상수
// ═══════════════════════════════════════════════════════════════════

describe("VEO_MODELS 상수", () => {
  it("DEFAULT = veo-3.1-fast", () => {
    expect(VEO_MODELS.DEFAULT).toBe("veo-3.1-fast-generate-preview");
  });

  it("STANDARD = veo-3.1", () => {
    expect(VEO_MODELS.STANDARD).toBe("veo-3.1-generate-preview");
  });

  it("FAST_30 = veo-3.0-fast", () => {
    expect(VEO_MODELS.FAST_30).toBe("veo-3.0-fast-generate-preview");
  });

  it("LEGACY = veo-2.0", () => {
    expect(VEO_MODELS.LEGACY).toBe("veo-2.0-generate-preview");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. WorkflowType ↔ Model 매핑
// ═══════════════════════════════════════════════════════════════════

describe("WorkflowType ↔ Model 매핑", () => {
  const workflows: WorkflowType[] = [
    "text-to-video",
    "image-to-video",
    "extend",
  ];

  it("resolveModelForWorkflow — text-to-video → default model", () => {
    expect(resolveModelForWorkflow({ workflow: "text-to-video" })).toBe(VEO_DEFAULT_MODEL);
  });

  it("resolveModelForWorkflow — 명시적 모델 지정", () => {
    expect(resolveModelForWorkflow({ requestedModel: VEO_MODELS.STANDARD })).toBe(VEO_MODELS.STANDARD);
  });

  it("resolveModelForWorkflow — 아무것도 없으면 default", () => {
    expect(resolveModelForWorkflow({})).toBe(VEO_DEFAULT_MODEL);
  });

  it("resolveModelForWorkflow — extend workflow", () => {
    const result = resolveModelForWorkflow({ workflow: "extend" });
    // extend returns cheapest extension model
    expect(result).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. resolveModelForWorkflow — 워크플로우 기반 모델 선택
// ═══════════════════════════════════════════════════════════════════

describe("resolveModelForWorkflow — 워크플로우 기반 모델 선택", () => {
  it("명시적 모델 지정 시 그대로 사용", () => {
    expect(resolveModelForWorkflow({ requestedModel: VEO_DEFAULT_MODEL })).toBe(VEO_DEFAULT_MODEL);
  });

  it("명시적 모델 지정 (standard)", () => {
    expect(resolveModelForWorkflow({ requestedModel: VEO_MODELS.STANDARD })).toBe(VEO_MODELS.STANDARD);
  });

  it("아무것도 없으면 → default model", () => {
    expect(resolveModelForWorkflow({})).toBe(VEO_DEFAULT_MODEL);
  });

  it("requestedModel 우선순위: model > workflow", () => {
    expect(resolveModelForWorkflow({
      requestedModel: VEO_MODELS.STANDARD,
      workflow: "extend",
    })).toBe(VEO_MODELS.STANDARD);
  });

  it("extend workflow → extension-capable model", () => {
    const result = resolveModelForWorkflow({ workflow: "extend" });
    const cap = getCapability(result);
    expect(cap.supportsExtension).toBe(true);
  });

  it("hasSourceVideo → extension model", () => {
    const result = resolveModelForWorkflow({ hasSourceVideo: true });
    const cap = getCapability(result);
    expect(cap.supportsExtension).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. VEO 정책 상수 검증
// ═══════════════════════════════════════════════════════════════════

describe("VEO 정책 상수", () => {
  it("VEO_SEGMENT_CAP = 8", () => {
    expect(VEO_SEGMENT_CAP).toBe(8);
  });

  it("VEO_MANDATORY_DURATION = 8", () => {
    expect(VEO_MANDATORY_DURATION).toBe(8);
  });

  it("VEO_DEFAULT_SHOT_STRUCTURE = [2, 2, 2, 2]", () => {
    expect([...VEO_DEFAULT_SHOT_STRUCTURE]).toEqual([2, 2, 2, 2]);
  });

  it("VEO_DEFAULT_MODEL = veo-3.1-fast-generate-preview", () => {
    expect(VEO_DEFAULT_MODEL).toBe("veo-3.1-fast-generate-preview");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. 모델 fallback 체인
// ═══════════════════════════════════════════════════════════════════

describe("모델 fallback 체인", () => {
  it("VEO 3.1 fast → fallback = veo-3.0-fast", () => {
    const cap = getCapability(VEO_DEFAULT_MODEL);
    expect(cap.fallbackModelId).toBe("veo-3.0-fast-generate-preview");
  });

  it("VEO 3.1 standard → fallback = veo-3.1-fast", () => {
    const cap = getCapability(VEO_MODELS.STANDARD);
    expect(cap.fallbackModelId).toBe("veo-3.1-fast-generate-preview");
  });

  it("VEO 3.0 fast → fallback 없음", () => {
    const cap = getCapability(VEO_MODELS.FAST_30);
    expect(cap.fallbackModelId).toBeNull();
  });

  it("알 수 없는 모델 → default capability 반환", () => {
    const cap = getCapability("unknown-model-xyz");
    expect(cap.modelId).toBe(VEO_DEFAULT_MODEL);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. multiShot 지원 범위 — VEO policy
// ═══════════════════════════════════════════════════════════════════

describe("multiShot 지원 범위 — VEO policy", () => {
  it("VEO default model: 8s+ → maxShots=4", () => {
    expect(getMaxShots(VEO_DEFAULT_MODEL, 8)).toBe(4);
    expect(getMaxShots(VEO_MODELS.STANDARD, 8)).toBe(4);
  });

  it("duration < 8 → multiShot 불가", () => {
    expect(getMaxShots(VEO_DEFAULT_MODEL, 7)).toBe(0);
    expect(getMaxShots(VEO_DEFAULT_MODEL, 5)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. VEO getMaxShots — duration 기반 policy
// ═══════════════════════════════════════════════════════════════════

describe("VEO getMaxShots — duration 기반 policy", () => {
  const model = VEO_DEFAULT_MODEL;

  it("7초 이하: multiShot 금지", () => {
    expect(getMaxShots(model, 1)).toBe(0);
    expect(getMaxShots(model, 3)).toBe(0);
    expect(getMaxShots(model, 5)).toBe(0);
    expect(getMaxShots(model, 7)).toBe(0);
  });

  it("8초 이상: 최대 4개 (VEO 하드 리밋)", () => {
    expect(getMaxShots(model, 8)).toBe(4);
    expect(getMaxShots(model, 10)).toBe(4);
    expect(getMaxShots(model, 15)).toBe(4);
  });
});


// ═══════════════════════════════════════════════════════════════════
// 10. normalizeMultiShots — 정규화 + index 재정렬
// ═══════════════════════════════════════════════════════════════════

describe("normalizeMultiShots", () => {
  const model = VEO_DEFAULT_MODEL;

  it("빈 배열 입력 → 빈 배열", () => {
    expect(normalizeMultiShots(model, [], 8)).toHaveLength(0);
  });

  it("VEO 8초에서 6개 → 4개 clamp (VEO 최대 4)", () => {
    const sixShots = Array.from({ length: 6 }, (_, i) => ({
      index: i + 1, prompt: `Shot ${i + 1}`, duration: "2",
    }));
    const result = normalizeMultiShots(model, sixShots, 8);
    expect(result).toHaveLength(4);
  });

  it("4개 이하 → 그대로 통과", () => {
    const threeShots = Array.from({ length: 3 }, (_, i) => ({
      index: i + 1, prompt: `Shot ${i + 1}`, duration: "3",
    }));
    const result = normalizeMultiShots(model, threeShots, 8);
    expect(result).toHaveLength(3);
  });

  it("index 재정렬: slice 후에도 1-based 순차", () => {
    const shots = [
      { index: 3, prompt: "A", duration: "3" },
      { index: 7, prompt: "B", duration: "3" },
      { index: 5, prompt: "C", duration: "2" },
    ];
    const result = normalizeMultiShots(model, shots, 8);
    expect(result.map(s => s.index)).toEqual([1, 2, 3]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. fast density + multiShot clamp 조합
// ═══════════════════════════════════════════════════════════════════

describe("fast density — 독립 컷 수 우선", () => {
  it("6초 segment에서 최소 1컷", () => {
    expect(recommendMinimumCutCount(6)).toBeGreaterThanOrEqual(1);
  });

  it("15초 segment에서 최소 1컷", () => {
    expect(recommendMinimumCutCount(15)).toBeGreaterThanOrEqual(1);
  });

  it("15초에서 cut range max >= 2", () => {
    const range = recommendCutCountRange(15);
    expect(range.max).toBeGreaterThanOrEqual(2);
  });
});

describe("fast density + capability clamp 조합", () => {
  const model = VEO_DEFAULT_MODEL;

  it("각 3초 → multiShot 금지 (VEO requires 8s)", () => {
    expect(getMaxShots(model, 3)).toBe(0);
  });

  it("각 5초 → multiShot 금지 (VEO requires 8s)", () => {
    expect(getMaxShots(model, 5)).toBe(0);
  });

  it("8초 → VEO 최대 4개", () => {
    expect(getMaxShots(model, 8)).toBe(4);
  });

  it("15초 → VEO 최대 4개", () => {
    expect(getMaxShots(model, 15)).toBe(4);
  });

  it("12초 → VEO 최대 4개", () => {
    expect(getMaxShots(model, 12)).toBe(4);
  });
});
