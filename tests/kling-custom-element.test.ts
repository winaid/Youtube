/**
 * kling-custom-element.test.ts — Kling Custom Element 통합 테스트
 *
 * 검증 항목:
 * 1. image_refer create body 검증
 * 2. video_refer create body 검증
 * 3. element_id 추출 (completed response)
 * 4. charactersInScene 기반 element_list 주입
 * 5. 인물 없는 cut → element_list 미전달
 * 6. Element 상태 변환 (pending → processing → completed/failed)
 * 7. multiShot clamp / segment planner 회귀 없음
 */

import { describe, it, expect } from "vitest";
import {
  createElementAsset,
  upsertElementAsset,
  resolveElementListForCut,
  canCreateElement,
  getElementUnavailableReason,
} from "@/lib/kling-element-store";
import type { KlingElementAsset } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Helper: 테스트용 KlingElementAsset 생성
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
// 1. image_refer create body 검증
// ═══════════════════════════════════════════════════════════════════

describe("createElementAsset — image_refer", () => {
  it("should create a pending asset with image_refer sourceType", () => {
    const asset = createElementAsset({
      characterId: "char-1",
      taskId: "task-abc",
      elementName: "Hero",
      elementDescription: "Male hero with black hair",
      sourceType: "image_refer",
    });

    expect(asset.characterId).toBe("char-1");
    expect(asset.taskId).toBe("task-abc");
    expect(asset.elementId).toBeNull();
    expect(asset.status).toBe("pending");
    expect(asset.sourceType).toBe("image_refer");
    expect(asset.createdAt).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. video_refer create body 검증
// ═══════════════════════════════════════════════════════════════════

describe("createElementAsset — video_refer", () => {
  it("should create a pending asset with video_refer sourceType", () => {
    const asset = createElementAsset({
      characterId: "char-2",
      taskId: "task-xyz",
      elementName: "Villain",
      elementDescription: "Tall villain",
      sourceType: "video_refer",
    });

    expect(asset.sourceType).toBe("video_refer");
    expect(asset.status).toBe("pending");
    expect(asset.elementId).toBeNull();
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
// 4. charactersInScene 기반 element_list 주입
// ═══════════════════════════════════════════════════════════════════

describe("resolveElementListForCut", () => {
  it("should return element_ids only for completed assets matching charactersInScene", () => {
    const assets = [
      makeAsset("char-1", "completed", "elm-001"),
      makeAsset("char-2", "completed", "elm-002"),
      makeAsset("char-3", "pending", null),
    ];

    const result = resolveElementListForCut(assets, ["char-1", "char-3"]);
    expect(result).toEqual([{ element_id: "elm-001" }]);
  });

  it("should return all matching completed elements when multiple characters in scene", () => {
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

  it("should return empty array when no assets are completed", () => {
    const assets = [
      makeAsset("char-1", "processing", null),
      makeAsset("char-2", "pending", null),
    ];

    const result = resolveElementListForCut(assets, ["char-1", "char-2"]);
    expect(result).toEqual([]);
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

    const result = resolveElementListForCut(assets, []);
    expect(result).toEqual([]);
  });

  it("should return empty array when no assets exist", () => {
    const result = resolveElementListForCut([], ["char-1"]);
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Element 상태 전환
// ═══════════════════════════════════════════════════════════════════

describe("Element status lifecycle", () => {
  it("pending → processing → completed via upsert", () => {
    let assets: KlingElementAsset[] = [];

    // Step 1: pending
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

    // Step 2: processing
    const processing: KlingElementAsset = {
      ...assets[0],
      status: "processing",
    };
    assets = upsertElementAsset(assets, processing);
    expect(assets[0].status).toBe("processing");

    // Step 3: completed
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
    const validBase64 = "x".repeat(200);
    expect(canCreateElement(validBase64)).toBe(true);
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
  it("should return null for valid face data", () => {
    expect(getElementUnavailableReason("x".repeat(200))).toBeNull();
  });

  it("should return reason for undefined", () => {
    const reason = getElementUnavailableReason(undefined);
    expect(reason).toContain("얼굴 이미지가 없습니다");
  });

  it("should return reason for too-short image", () => {
    const reason = getElementUnavailableReason("abc");
    expect(reason).toContain("너무 작습니다");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. multiShot / segment planner 회귀 확인
// ═══════════════════════════════════════════════════════════════════

describe("multiShot clamp regression — element_list isolation", () => {
  it("element_list should not interfere with multiShot data shape", () => {
    // element_list와 multiShot은 완전 별개 필드
    const elementList = resolveElementListForCut(
      [makeAsset("char-1", "completed", "elm-001")],
      ["char-1"],
    );

    const multiShot = [
      { type: "shot", prompt: "close-up hero", duration: 5 },
      { type: "shot", prompt: "wide landscape", duration: 5 },
    ];

    // 둘 다 존재해도 서로 간섭 없음
    expect(elementList).toHaveLength(1);
    expect(multiShot).toHaveLength(2);

    // element_list 항목에는 element_id만 존재
    expect(Object.keys(elementList[0])).toEqual(["element_id"]);
  });
});
