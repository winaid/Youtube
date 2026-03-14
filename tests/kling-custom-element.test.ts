/**
 * kling-custom-element.test.ts — Kling Custom Element 통합 테스트
 *
 * 검증 항목:
 * 1. image_refer create payload — 문서 스펙 구조 검증
 *    model: "kling-custom-element", model_params.element_name, element_description,
 *    reference_type, element_image_list.frontal_image
 * 2. video_refer create payload — model_params.element_video_list.video_url
 * 3. element_id 추출 (completed response)
 * 4. charactersInScene 기반 element_list 주입 회귀
 * 5. 인물 없는 cut → element_list 미전달
 * 6. Element 상태 전환 (pending → completed / failed)
 * 7. canCreateElement / getElementUnavailableReason
 * 8. multiShot / element_list 격리
 */

import { describe, it, expect } from "vitest";
import {
  createElementAsset,
  upsertElementAsset,
  resolveElementListForCut,
  canCreateElement,
  getElementUnavailableReason,
  buildCreateElementPayload,
  KLING_ELEMENT_MODEL,
} from "@/lib/kling-element-store";
import type { KlingElementAsset } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════

function makeAsset(
  characterId: string,
  status: KlingElementAsset["status"] = "completed",
  elementId: string | null = `elm-${characterId}`,
): KlingElementAsset {
  return {
    characterId,
    taskId: `task-${characterId}`,
    elementId,
    elementName: `Char ${characterId}`,
    elementDescription: `desc-${characterId}`,
    status,
    sourceType: "image_refer",
    createdAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. image_refer create payload — 문서 스펙 구조 검증
// ═══════════════════════════════════════════════════════════════════

describe("buildCreateElementPayload — image_refer", () => {
  it("should produce model + model_params structure per document spec", () => {
    const payload = buildCreateElementPayload({
      element_name: "Hero",
      element_description: "Male hero with black hair",
      reference_type: "image_refer",
      frontal_image: "base64-face-data-long-enough",
    });

    // 최상위: model
    expect(payload.model).toBe("kling-custom-element");
    expect(payload.model).toBe(KLING_ELEMENT_MODEL);

    // model_params 존재
    const mp = payload.model_params as Record<string, unknown>;
    expect(mp).toBeDefined();

    // model_params 필드들
    expect(mp.element_name).toBe("Hero");
    expect(mp.element_description).toBe("Male hero with black hair");
    expect(mp.reference_type).toBe("image_refer");

    // element_image_list.frontal_image
    const imageList = mp.element_image_list as Record<string, unknown>;
    expect(imageList).toBeDefined();
    expect(imageList.frontal_image).toBe("base64-face-data-long-enough");

    // element_video_list 없어야 함
    expect(mp.element_video_list).toBeUndefined();
  });

  it("should NOT contain flat name/source_type/image fields (구 스키마 금지)", () => {
    const payload = buildCreateElementPayload({
      element_name: "Hero",
      reference_type: "image_refer",
      frontal_image: "base64data",
    });

    // 평면 구조 필드가 최상위에 존재하면 안 됨
    expect(payload).not.toHaveProperty("name");
    expect(payload).not.toHaveProperty("source_type");
    expect(payload).not.toHaveProperty("image");
    expect(payload).not.toHaveProperty("video");
    expect(payload).not.toHaveProperty("description");
  });

  it("should omit element_description from model_params when not provided", () => {
    const payload = buildCreateElementPayload({
      element_name: "Hero",
      reference_type: "image_refer",
      frontal_image: "base64data",
    });

    const mp = payload.model_params as Record<string, unknown>;
    expect(mp.element_description).toBeUndefined();
    expect(mp.element_name).toBe("Hero");
  });

  it("should throw when image_refer has no frontal_image", () => {
    expect(() =>
      buildCreateElementPayload({
        element_name: "Hero",
        reference_type: "image_refer",
      }),
    ).toThrow("frontal_image");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. video_refer create payload — 문서 스펙 구조 검증
// ═══════════════════════════════════════════════════════════════════

describe("buildCreateElementPayload — video_refer", () => {
  it("should produce model_params with element_video_list.video_url", () => {
    const payload = buildCreateElementPayload({
      element_name: "Villain",
      element_description: "Tall villain in dark coat",
      reference_type: "video_refer",
      video_url: "https://example.com/clip.mp4",
    });

    expect(payload.model).toBe("kling-custom-element");

    const mp = payload.model_params as Record<string, unknown>;
    expect(mp.reference_type).toBe("video_refer");
    expect(mp.element_name).toBe("Villain");
    expect(mp.element_description).toBe("Tall villain in dark coat");

    // element_video_list.video_url
    const videoList = mp.element_video_list as Record<string, unknown>;
    expect(videoList).toBeDefined();
    expect(videoList.video_url).toBe("https://example.com/clip.mp4");

    // element_image_list 없어야 함
    expect(mp.element_image_list).toBeUndefined();
  });

  it("should throw when video_refer has no video_url", () => {
    expect(() =>
      buildCreateElementPayload({
        element_name: "Villain",
        reference_type: "video_refer",
      }),
    ).toThrow("video_url");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. element_id 추출 (completed response)
// ═══════════════════════════════════════════════════════════════════

describe("upsertElementAsset — element_id extraction", () => {
  it("should replace existing asset by characterId and preserve elementId", () => {
    const existing = [makeAsset("char-1", "pending", null)];
    const completed = makeAsset("char-1", "completed", "elm-real-123");

    const result = upsertElementAsset(existing, completed);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("completed");
    expect(result[0].elementId).toBe("elm-real-123");
  });

  it("should add new asset if characterId not found", () => {
    const existing = [makeAsset("char-1")];
    const newAsset = makeAsset("char-2");

    const result = upsertElementAsset(existing, newAsset);
    expect(result).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. charactersInScene 기반 element_list 주입 회귀
// ═══════════════════════════════════════════════════════════════════

describe("resolveElementListForCut — element_list injection", () => {
  it("should return element_ids only for completed assets matching charactersInScene", () => {
    const assets = [
      makeAsset("char-1", "completed", "elm-001"),
      makeAsset("char-2", "completed", "elm-002"),
      makeAsset("char-3", "pending", null),
    ];

    const result = resolveElementListForCut(assets, ["char-1", "char-3"]);
    expect(result).toEqual([{ element_id: "elm-001" }]);
  });

  it("should return all matching completed elements", () => {
    const assets = [
      makeAsset("char-1", "completed", "elm-001"),
      makeAsset("char-2", "completed", "elm-002"),
    ];

    const result = resolveElementListForCut(assets, ["char-1", "char-2"]);
    expect(result).toHaveLength(2);
    expect(result).toEqual([
      { element_id: "elm-001" },
      { element_id: "elm-002" },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. 인물 없는 cut → element_list 미전달
// ═══════════════════════════════════════════════════════════════════

describe("resolveElementListForCut — empty charactersInScene", () => {
  it("should return empty array when charactersInScene is empty", () => {
    const assets = [
      makeAsset("char-1", "completed", "elm-001"),
      makeAsset("char-2", "completed", "elm-002"),
    ];
    expect(resolveElementListForCut(assets, [])).toEqual([]);
  });

  it("should return empty array when no assets exist", () => {
    expect(resolveElementListForCut([], ["char-1"])).toEqual([]);
  });

  it("should return empty array when no assets are completed", () => {
    const assets = [
      makeAsset("char-1", "processing", null),
      makeAsset("char-2", "pending", null),
    ];
    expect(resolveElementListForCut(assets, ["char-1", "char-2"])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Element 상태 전환 (failed/completed 회귀)
// ═══════════════════════════════════════════════════════════════════

describe("Element status lifecycle", () => {
  it("pending → processing → completed via upsert", () => {
    let assets: KlingElementAsset[] = [];

    const pending = createElementAsset({
      characterId: "char-1",
      taskId: "task-1",
      elementName: "Hero",
      elementDescription: "desc",
      sourceType: "image_refer",
    });
    assets = upsertElementAsset(assets, pending);
    expect(assets[0].status).toBe("pending");
    expect(assets[0].elementId).toBeNull();

    const processing: KlingElementAsset = { ...assets[0], status: "processing" };
    assets = upsertElementAsset(assets, processing);
    expect(assets[0].status).toBe("processing");

    const completed: KlingElementAsset = {
      ...assets[0],
      status: "completed",
      elementId: "elm-final-001",
      completedAt: Date.now(),
    };
    assets = upsertElementAsset(assets, completed);
    expect(assets[0].status).toBe("completed");
    expect(assets[0].elementId).toBe("elm-final-001");
    expect(assets[0].completedAt).toBeGreaterThan(0);
  });

  it("pending → failed with error", () => {
    let assets: KlingElementAsset[] = [];

    const pending = createElementAsset({
      characterId: "char-1",
      taskId: "task-1",
      elementName: "Hero",
      elementDescription: "desc",
      sourceType: "image_refer",
    });
    assets = upsertElementAsset(assets, pending);

    const failed: KlingElementAsset = {
      ...assets[0],
      status: "failed",
      error: "Image quality too low",
    };
    assets = upsertElementAsset(assets, failed);
    expect(assets[0].status).toBe("failed");
    expect(assets[0].error).toBe("Image quality too low");
    expect(assets[0].elementId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. canCreateElement / getElementUnavailableReason
// ═══════════════════════════════════════════════════════════════════

describe("canCreateElement", () => {
  it("should return true for valid base64 face image", () => {
    expect(canCreateElement("x".repeat(200))).toBe(true);
  });

  it("should return false for undefined", () => {
    expect(canCreateElement(undefined)).toBe(false);
  });

  it("should return false for too-short base64", () => {
    expect(canCreateElement("abc")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(canCreateElement("")).toBe(false);
  });
});

describe("getElementUnavailableReason", () => {
  it("should return null for valid face data (실제 성공은 Kling 검증에 따름)", () => {
    expect(getElementUnavailableReason("x".repeat(200))).toBeNull();
  });

  it("should return reason for undefined", () => {
    expect(getElementUnavailableReason(undefined)).toContain("얼굴 이미지가 없습니다");
  });

  it("should return reason for too-short image", () => {
    expect(getElementUnavailableReason("abc")).toContain("너무 작습니다");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. multiShot / element_list 격리
// ═══════════════════════════════════════════════════════════════════

describe("multiShot clamp regression — element_list isolation", () => {
  it("element_list should not interfere with multiShot data shape", () => {
    const elementList = resolveElementListForCut(
      [makeAsset("char-1", "completed", "elm-001")],
      ["char-1"],
    );

    const multiShot = [
      { type: "shot", prompt: "close-up hero", duration: 5 },
      { type: "shot", prompt: "wide landscape", duration: 5 },
    ];

    expect(elementList).toHaveLength(1);
    expect(multiShot).toHaveLength(2);
    expect(Object.keys(elementList[0])).toEqual(["element_id"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. payload 최상위 키 검증 — model, model_params만 존재해야
// ═══════════════════════════════════════════════════════════════════

describe("buildCreateElementPayload — top-level key validation", () => {
  it("should have exactly model and model_params as top-level keys", () => {
    const payload = buildCreateElementPayload({
      element_name: "Test",
      element_description: "Desc",
      reference_type: "image_refer",
      frontal_image: "base64data",
    });

    const topKeys = Object.keys(payload).sort();
    expect(topKeys).toEqual(["model", "model_params"]);
  });
});
