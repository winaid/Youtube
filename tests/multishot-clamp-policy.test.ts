/**
 * multishot-clamp-policy.test.ts — Kling O3 모델 패밀리 capability 테스트
 *
 * O3 모델 패밀리 (5개):
 *   - kling-o3-text-to-video        (텍스트 → 영상)
 *   - kling-o3-image-to-video       (이미지 → 영상)
 *   - kling-o3-reference-to-video   (레퍼런스 기반 일관성)
 *   - kling-custom-element          (캐릭터 에셋 생성)
 *
 * multiShot duration policy:
 *   - secPerCut <= 3: multiShot 금지
 *   - secPerCut <= 5: 최대 2개
 *   - secPerCut <= 7: 최대 3개
 *   - secPerCut <= 10: 최대 4개
 *   - secPerCut > 10: 최대 6개 (O3 하드 리밋)
 */

import { describe, it, expect } from "vitest";
import {
  getMaxShots,
  getCapability,
  normalizeMultiShots,
  KLING_DEFAULT_TEXT_MODEL,
  KLING_DEFAULT_IMAGE_MODEL,
  KLING_DEFAULT_REFERENCE_MODEL,
  KLING_ELEMENT_MODEL,
  KLING_MODELS,
  KLING_MODEL_REGISTRY,
  resolveModel,
  resolveModelForWorkflow,
  resolveModelWithFallback,
  isO3Model,
  isV3Model,
  isVideoGenerationModel,
  getModelForWorkflow,
  getWorkflowForModel,
  getModelsForWorkflow,
  WORKFLOW_MODEL_MAP,
  type WorkflowType,
} from "@/lib/kling-capability";
import { recommendMinimumCutCount, recommendCutCountRange } from "@/lib/sequence-density";

// ═══════════════════════════════════════════════════════════════════
// 1. O3 모델 패밀리 — 5개 모델 capability 기본 테스트
// ═══════════════════════════════════════════════════════════════════

describe("O3 모델 패밀리 capability", () => {
  it("레지스트리에 O3 모델 등록", () => {
    expect(Object.keys(KLING_MODEL_REGISTRY).length).toBeGreaterThanOrEqual(4);
  });

  describe("kling-o3-text-to-video", () => {
    const cap = getCapability(KLING_DEFAULT_TEXT_MODEL);

    it("기본 capability 값", () => {
      expect(cap.modelId).toBe("kling-o3-text-to-video");
      expect(cap.workflowRole).toBe("text-to-video");
      expect(cap.maxShots).toBe(6);
      expect(cap.minShotDuration).toBe(2);
      expect(cap.maxDuration).toBe(15);
      expect(cap.minDuration).toBe(3);
      expect(cap.supportsMultiShot).toBe(true);
      expect(cap.supportsSound).toBe(true);
      expect(cap.supportsElements).toBe(true);
      expect(cap.supportsReferenceInput).toBe(false);
      expect(cap.supportsVideoEdit).toBe(false);
      expect(cap.inputMode).toBe("text");
      expect(cap.outputMode).toBe("video");
    });

    it("O3 계열 판정", () => {
      expect(isO3Model(cap.modelId)).toBe(true);
      expect(isV3Model(cap.modelId)).toBe(false);
    });
  });

  describe("kling-o3-image-to-video", () => {
    const cap = getCapability(KLING_DEFAULT_IMAGE_MODEL);

    it("기본 capability 값", () => {
      expect(cap.modelId).toBe("kling-o3-image-to-video");
      expect(cap.workflowRole).toBe("image-to-video");
      expect(cap.maxShots).toBe(6);
      expect(cap.minShotDuration).toBe(2);
      expect(cap.supportsMultiShot).toBe(true);
      expect(cap.supportsElements).toBe(true);
      expect(cap.supportsImageToVideo).toBe(true);
      expect(cap.inputMode).toBe("image");
      expect(cap.outputMode).toBe("video");
    });
  });

  describe("kling-o3-reference-to-video", () => {
    const cap = getCapability(KLING_DEFAULT_REFERENCE_MODEL);

    it("기본 capability 값", () => {
      expect(cap.modelId).toBe("kling-o3-reference-to-video");
      expect(cap.workflowRole).toBe("reference-to-video");
      expect(cap.maxShots).toBe(6);
      expect(cap.minShotDuration).toBe(2);
      expect(cap.supportsMultiShot).toBe(true);
      expect(cap.supportsElements).toBe(true);
      expect(cap.supportsReferenceInput).toBe(true);
      expect(cap.supportsVideoEdit).toBe(false);
      expect(cap.inputMode).toBe("reference");
      expect(cap.outputMode).toBe("video");
    });

    it("fallback → image-to-video", () => {
      expect(cap.fallbackModelId).toBe("kling-o3-image-to-video");
    });
  });

  describe("kling-custom-element", () => {
    const cap = getCapability(KLING_ELEMENT_MODEL);

    it("기본 capability 값", () => {
      expect(cap.modelId).toBe("kling-custom-element");
      expect(cap.workflowRole).toBe("custom-element");
      expect(cap.maxShots).toBe(0);
      expect(cap.maxDuration).toBe(0);
      expect(cap.supportsMultiShot).toBe(false);
      expect(cap.supportsSound).toBe(false);
      expect(cap.supportsElements).toBe(false);
      expect(cap.inputMode).toBe("image_refer");
      expect(cap.outputMode).toBe("element_asset");
    });

    it("영상 생성 모델 아님", () => {
      expect(isVideoGenerationModel(KLING_ELEMENT_MODEL)).toBe(false);
    });
  });

  it("영상 생성 가능한 모델 판정", () => {
    expect(isVideoGenerationModel(KLING_DEFAULT_TEXT_MODEL)).toBe(true);
    expect(isVideoGenerationModel(KLING_DEFAULT_IMAGE_MODEL)).toBe(true);
    expect(isVideoGenerationModel(KLING_DEFAULT_REFERENCE_MODEL)).toBe(true);
    expect(isVideoGenerationModel(KLING_ELEMENT_MODEL)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. KLING_MODELS 상수 — 5개 모델 매핑
// ═══════════════════════════════════════════════════════════════════

describe("KLING_MODELS 상수", () => {
  it("TEXT_TO_VIDEO = O3", () => {
    expect(KLING_MODELS.TEXT_TO_VIDEO).toContain("-o3-");
  });

  it("IMAGE_TO_VIDEO = O3", () => {
    expect(KLING_MODELS.IMAGE_TO_VIDEO).toContain("-o3-");
  });

  it("REFERENCE_TO_VIDEO = O3", () => {
    expect(KLING_MODELS.REFERENCE_TO_VIDEO).toContain("-o3-");
  });

  it("CUSTOM_ELEMENT", () => {
    expect(KLING_MODELS.CUSTOM_ELEMENT).toBe("kling-custom-element");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. WorkflowType ↔ Model 매핑
// ═══════════════════════════════════════════════════════════════════

describe("WorkflowType ↔ Model 매핑", () => {
  const workflows: WorkflowType[] = [
    "text-to-video",
    "image-to-video",
    "reference-to-video",
    "custom-element",
  ];

  it("모든 워크플로우 타입에 대해 모델 매핑 존재", () => {
    for (const wf of workflows) {
      expect(WORKFLOW_MODEL_MAP[wf]).toBeDefined();
      expect(getModelForWorkflow(wf)).toBe(WORKFLOW_MODEL_MAP[wf]);
    }
  });

  it("getWorkflowForModel — 역조회", () => {
    expect(getWorkflowForModel("kling-o3-text-to-video")).toBe("text-to-video");
    expect(getWorkflowForModel("kling-o3-image-to-video")).toBe("image-to-video");
    expect(getWorkflowForModel("kling-o3-reference-to-video")).toBe("reference-to-video");
    expect(getWorkflowForModel("kling-custom-element")).toBe("custom-element");
  });

  it("getWorkflowForModel — 알 수 없는 모델은 text-to-video", () => {
    expect(getWorkflowForModel("unknown-model")).toBe("text-to-video");
  });

  it("getModelsForWorkflow — text-to-video에 O3 포함", () => {
    const models = getModelsForWorkflow("text-to-video");
    expect(models).toContain("kling-o3-text-to-video");
  });

  it("getModelsForWorkflow — custom-element는 1개만", () => {
    const models = getModelsForWorkflow("custom-element");
    expect(models).toEqual(["kling-custom-element"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. resolveModelForWorkflow — 워크플로우 기반 모델 선택
// ═══════════════════════════════════════════════════════════════════

describe("resolveModelForWorkflow — 워크플로우 기반 모델 선택", () => {
  it("명시적 모델 지정 시 그대로 사용", () => {
    expect(resolveModelForWorkflow({ requestedModel: "kling-o3-text-to-video" })).toBe("kling-o3-text-to-video");
  });

  it("명시적 워크플로우 지정 → WORKFLOW_MODEL_MAP 조회", () => {
    expect(resolveModelForWorkflow({ workflow: "reference-to-video" })).toBe(KLING_MODELS.REFERENCE_TO_VIDEO);
    expect(resolveModelForWorkflow({ workflow: "custom-element" })).toBe(KLING_MODELS.CUSTOM_ELEMENT);
  });

  it("referenceImages 있음 → reference-to-video", () => {
    expect(resolveModelForWorkflow({ hasReferenceImages: true })).toBe(KLING_MODELS.REFERENCE_TO_VIDEO);
  });

  it("image 있음 → image-to-video", () => {
    expect(resolveModelForWorkflow({ hasImage: true })).toBe(KLING_MODELS.IMAGE_TO_VIDEO);
  });

  it("아무것도 없으면 → text-to-video", () => {
    expect(resolveModelForWorkflow({})).toBe(KLING_MODELS.TEXT_TO_VIDEO);
  });

  it("requestedModel 우선순위: model > workflow > context", () => {
    expect(resolveModelForWorkflow({
      requestedModel: "kling-o3-text-to-video",
      workflow: "reference-to-video",
      hasReferenceImages: true,
    })).toBe("kling-o3-text-to-video");
  });

  it("workflow 우선순위: workflow > context", () => {
    expect(resolveModelForWorkflow({
      workflow: "reference-to-video",
      hasImage: true,
    })).toBe(KLING_MODELS.REFERENCE_TO_VIDEO);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. 기존 resolveModel 하위 호환
// ═══════════════════════════════════════════════════════════════════

describe("resolveModel (하위 호환)", () => {
  it("기본 모델은 O3 text-to-video", () => {
    expect(resolveModel(undefined, false)).toContain("-o3-text-to-video");
  });

  it("이미지 포함 시 O3 image-to-video", () => {
    expect(resolveModel(undefined, true)).toContain("-o3-image-to-video");
  });

  it("명시적 모델 지정 시 그대로 사용", () => {
    expect(resolveModel("kling-v3-text-to-video", false)).toBe("kling-v3-text-to-video");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. 모델 fallback 체인
// ═══════════════════════════════════════════════════════════════════

describe("모델 fallback 체인", () => {
  it("O3 text → fallback 없음 (자기 자신 반환)", () => {
    const [fallback, wasFallback] = resolveModelWithFallback("kling-o3-text-to-video");
    expect(fallback).toBe("kling-o3-text-to-video");
    expect(wasFallback).toBe(false);
  });

  it("O3 image → fallback 없음 (자기 자신 반환)", () => {
    const [fallback, wasFallback] = resolveModelWithFallback("kling-o3-image-to-video");
    expect(fallback).toBe("kling-o3-image-to-video");
    expect(wasFallback).toBe(false);
  });

  it("O3 reference → O3 image (같은 O3 패밀리 내 fallback)", () => {
    const [fallback, wasFallback] = resolveModelWithFallback("kling-o3-reference-to-video");
    expect(fallback).toBe("kling-o3-image-to-video");
    expect(wasFallback).toBe(true);
  });

  it("custom-element → fallback 없음", () => {
    const [fallback, wasFallback] = resolveModelWithFallback("kling-custom-element");
    expect(fallback).toBe("kling-custom-element");
    expect(wasFallback).toBe(false);
  });

  it("알 수 없는 모델 → O3 기본값", () => {
    const [fallback, wasFallback] = resolveModelWithFallback("kling-v99-unknown");
    expect(fallback).toContain("-o3-");
    expect(wasFallback).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. multiShot 지원 범위 — 모델별 차이
// ═══════════════════════════════════════════════════════════════════

describe("multiShot 지원 범위 — 모델별", () => {
  it("text/image/reference: multiShot 지원 (maxShots=6)", () => {
    expect(getCapability("kling-o3-text-to-video").supportsMultiShot).toBe(true);
    expect(getCapability("kling-o3-image-to-video").supportsMultiShot).toBe(true);
    expect(getCapability("kling-o3-reference-to-video").supportsMultiShot).toBe(true);
    expect(getMaxShots("kling-o3-text-to-video", 15)).toBe(6);
    expect(getMaxShots("kling-o3-image-to-video", 15)).toBe(6);
    expect(getMaxShots("kling-o3-reference-to-video", 15)).toBe(6);
  });

  it("custom-element: multiShot 미지원", () => {
    expect(getCapability("kling-custom-element").supportsMultiShot).toBe(false);
    expect(getMaxShots("kling-custom-element", 15)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. O3 getMaxShots — duration 기반 policy
// ═══════════════════════════════════════════════════════════════════

describe("O3 getMaxShots — duration 기반 policy", () => {
  const o3 = KLING_DEFAULT_TEXT_MODEL;

  it("3초 이하: multiShot 금지", () => {
    expect(getMaxShots(o3, 1)).toBe(0);
    expect(getMaxShots(o3, 2)).toBe(0);
    expect(getMaxShots(o3, 3)).toBe(0);
  });

  it("4초 이상: 모델 하드 리밋(6)까지 허용", () => {
    expect(getMaxShots(o3, 4)).toBe(6);
    expect(getMaxShots(o3, 5)).toBe(6);
    expect(getMaxShots(o3, 8)).toBe(6);
    expect(getMaxShots(o3, 10)).toBe(6);
    expect(getMaxShots(o3, 15)).toBe(6);
  });
});


// ═══════════════════════════════════════════════════════════════════
// 10. normalizeMultiShots — 정규화 + index 재정렬 + duration 보정
// ═══════════════════════════════════════════════════════════════════

describe("normalizeMultiShots", () => {
  const o3 = KLING_DEFAULT_TEXT_MODEL;

  it("빈 배열 입력 → 빈 배열", () => {
    expect(normalizeMultiShots(o3, [], 8)).toHaveLength(0);
  });

  it("3초 이하 → multiShot 비활성", () => {
    const shots = [{ index: 1, prompt: "A", duration: "3" }];
    expect(normalizeMultiShots(o3, shots, 3)).toHaveLength(0);
  });

  it("O3 8초에서 6개 → 6개 허용 (모델 리밋 내)", () => {
    const sixShots = Array.from({ length: 6 }, (_, i) => ({
      index: i + 1, prompt: `Shot ${i + 1}`, duration: "2",
    }));
    const result = normalizeMultiShots(o3, sixShots, 8);
    expect(result).toHaveLength(6);
  });

  it("index 재정렬: slice 후에도 1-based 순차", () => {
    const shots = [
      { index: 3, prompt: "A", duration: "3" },
      { index: 7, prompt: "B", duration: "3" },
      { index: 5, prompt: "C", duration: "2" },
    ];
    const result = normalizeMultiShots(o3, shots, 8);
    expect(result.map(s => s.index)).toEqual([1, 2, 3]);
  });

  it("duration 보정: minShotDuration 미만 → 보정", () => {
    const shots = [
      { index: 1, prompt: "A", duration: "1" },
      { index: 2, prompt: "B", duration: "4" },
    ];
    const result = normalizeMultiShots(o3, shots, 6);
    expect(parseInt(result[0].duration, 10)).toBeGreaterThanOrEqual(2);
  });

  it("duration 합 조정: 마지막 샷으로 remainder 흡수", () => {
    const shots = [
      { index: 1, prompt: "A", duration: "3" },
      { index: 2, prompt: "B", duration: "3" },
    ];
    const result = normalizeMultiShots(o3, shots, 8);
    const total = result.reduce((sum, s) => sum + parseInt(s.duration, 10), 0);
    expect(total).toBe(8);
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
  const o3 = KLING_DEFAULT_TEXT_MODEL;

  it("15초 segment, 5컷 = 각 3초 → multiShot 금지", () => {
    expect(getMaxShots(o3, 3)).toBe(0);
  });

  it("10초 segment, 2컷 = 각 5초 → O3 최대 6개", () => {
    expect(getMaxShots(o3, 5)).toBe(6);
  });

  it("15초 segment, 1컷 = 15초 → O3 최대 6개", () => {
    expect(getMaxShots(o3, 15)).toBe(6);
  });

  it("12초 segment, 1컷 = 12초 → O3 최대 6개", () => {
    expect(getMaxShots(o3, 12)).toBe(6);
  });
});
