/**
 * kling-custom-element.test.ts — Kling Custom Element 통합 테스트
 *
 * 검증 항목:
 * 1. buildCreateElementPayload — image_refer 문서 스펙 구조
 * 2. buildCreateElementPayload — video_refer 문서 스펙 구조
 * 3. klingCreateElement fetch body 실제 검증 (fetch spy)
 * 4. 구 스키마(name/source_type/image/video) 잔존 금지
 * 5. element_list 주입 경로 회귀
 * 6. 인물 없는 cut → element_list 미전달
 * 7. Element 상태 전환 (pending → completed / failed)
 * 8. canCreateElement / getElementUnavailableReason
 * 9. multiShot / element_list 격리
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("buildCreateElementPayload — image_refer (문서 스펙)", () => {
  it("최상위 model = 'kling-custom-element', model_params 구조 정확", () => {
    const payload = buildCreateElementPayload({
      element_name: "Hero",
      element_description: "Male hero with black hair",
      reference_type: "image_refer",
      frontal_image: "base64-face-data-long-enough",
    });

    // 최상위 키는 model, model_params만
    expect(Object.keys(payload).sort()).toEqual(["model", "model_params"]);
    expect(payload.model).toBe("kling-custom-element");
    expect(payload.model).toBe(KLING_ELEMENT_MODEL);

    const mp = payload.model_params as Record<string, unknown>;
    expect(mp.element_name).toBe("Hero");
    expect(mp.element_description).toBe("Male hero with black hair");
    expect(mp.reference_type).toBe("image_refer");

    // element_image_list.frontal_image
    const imageList = mp.element_image_list as Record<string, unknown>;
    expect(imageList).toBeDefined();
    expect(imageList.frontal_image).toBe("base64-face-data-long-enough");

    // video 관련 필드 없어야
    expect(mp.element_video_list).toBeUndefined();
  });

  it("element_description 생략 시 model_params에서 누락", () => {
    const payload = buildCreateElementPayload({
      element_name: "Hero",
      reference_type: "image_refer",
      frontal_image: "base64data",
    });
    const mp = payload.model_params as Record<string, unknown>;
    expect(mp.element_description).toBeUndefined();
    expect(mp.element_name).toBe("Hero");
  });

  it("image_refer에 frontal_image 없으면 throw", () => {
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

describe("buildCreateElementPayload — video_refer (문서 스펙)", () => {
  it("model_params.element_video_list.video_url 포함", () => {
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

    const videoList = mp.element_video_list as Record<string, unknown>;
    expect(videoList).toBeDefined();
    expect(videoList.video_url).toBe("https://example.com/clip.mp4");

    expect(mp.element_image_list).toBeUndefined();
  });

  it("video_refer에 video_url 없으면 throw", () => {
    expect(() =>
      buildCreateElementPayload({
        element_name: "Villain",
        reference_type: "video_refer",
      }),
    ).toThrow("video_url");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. klingCreateElement — 실제 fetch body 검증 (fetch spy)
// ═══════════════════════════════════════════════════════════════════

describe("klingCreateElement — fetch body 스키마 검증", () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedBody: unknown;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedBody = undefined;

    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ id: "task-mock-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("image_refer: fetch body가 문서 스펙 구조를 정확히 따르는지 (실제 HTTP 호출)", async () => {
    // klingCreateElement를 직접 import하여 실제 fetch body 확인
    const { klingCreateElement } = await import("../../functions/api/_kling-api");

    await klingCreateElement(
      { KLING_API_KEY: "test-key", KLING_API_BASE_URL: "https://mock.api" },
      {
        element_name: "Hero",
        element_description: "Black hair male",
        reference_type: "image_refer",
        frontal_image: "base64facedata",
      },
    );

    const body = capturedBody as Record<string, unknown>;

    // 최상위 키
    expect(Object.keys(body).sort()).toEqual(["model", "model_params"]);
    expect(body.model).toBe("kling-custom-element");

    // model_params
    const mp = body.model_params as Record<string, unknown>;
    expect(mp.element_name).toBe("Hero");
    expect(mp.element_description).toBe("Black hair male");
    expect(mp.reference_type).toBe("image_refer");

    // element_image_list.frontal_image
    const imageList = mp.element_image_list as Record<string, unknown>;
    expect(imageList.frontal_image).toBe("base64facedata");

    // 구 스키마 필드 부재
    expect(body).not.toHaveProperty("name");
    expect(body).not.toHaveProperty("source_type");
    expect(body).not.toHaveProperty("image");
    expect(body).not.toHaveProperty("video");
    expect(body).not.toHaveProperty("description");
  });

  it("video_refer: fetch body가 element_video_list.video_url 포함", async () => {
    const { klingCreateElement } = await import("../../functions/api/_kling-api");

    await klingCreateElement(
      { KLING_API_KEY: "test-key", KLING_API_BASE_URL: "https://mock.api" },
      {
        element_name: "Sidekick",
        reference_type: "video_refer",
        video_url: "https://cdn.example.com/ref.mp4",
      },
    );

    const body = capturedBody as Record<string, unknown>;
    expect(body.model).toBe("kling-custom-element");

    const mp = body.model_params as Record<string, unknown>;
    expect(mp.reference_type).toBe("video_refer");
    const videoList = mp.element_video_list as Record<string, unknown>;
    expect(videoList.video_url).toBe("https://cdn.example.com/ref.mp4");
    expect(mp.element_image_list).toBeUndefined();
  });

  it("fetch URL이 /v1/elements 엔드포인트를 가리키는지", async () => {
    const { klingCreateElement } = await import("../../functions/api/_kling-api");

    await klingCreateElement(
      { KLING_API_KEY: "test-key", KLING_API_BASE_URL: "https://mock.api" },
      {
        element_name: "Hero",
        reference_type: "image_refer",
        frontal_image: "base64data",
      },
    );

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe("https://mock.api/v1/elements");
  });

  it("Authorization header에 Bearer 토큰 포함", async () => {
    const { klingCreateElement } = await import("../../functions/api/_kling-api");

    await klingCreateElement(
      { KLING_API_KEY: "my-secret-key", KLING_API_BASE_URL: "https://mock.api" },
      {
        element_name: "Hero",
        reference_type: "image_refer",
        frontal_image: "base64data",
      },
    );

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer my-secret-key");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. 구 스키마 잔존 금지
// ═══════════════════════════════════════════════════════════════════

describe("구 스키마 필드 잔존 금지", () => {
  it("buildCreateElementPayload 결과에 name/source_type/image/video/description 없음", () => {
    const payload = buildCreateElementPayload({
      element_name: "Test",
      reference_type: "image_refer",
      frontal_image: "base64data",
    });
    expect(payload).not.toHaveProperty("name");
    expect(payload).not.toHaveProperty("source_type");
    expect(payload).not.toHaveProperty("image");
    expect(payload).not.toHaveProperty("video");
    expect(payload).not.toHaveProperty("description");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. element_list 주입 경로 회귀
// ═══════════════════════════════════════════════════════════════════

describe("resolveElementListForCut — element_list injection", () => {
  it("completed asset만 charactersInScene 매칭하여 반환", () => {
    const assets = [
      makeAsset("char-1", "completed", "elm-001"),
      makeAsset("char-2", "completed", "elm-002"),
      makeAsset("char-3", "pending", null),
    ];
    const result = resolveElementListForCut(assets, ["char-1", "char-3"]);
    expect(result).toEqual([{ element_id: "elm-001" }]);
  });

  it("여러 캐릭터 모두 completed이면 전부 반환", () => {
    const assets = [
      makeAsset("char-1", "completed", "elm-001"),
      makeAsset("char-2", "completed", "elm-002"),
    ];
    const result = resolveElementListForCut(assets, ["char-1", "char-2"]);
    expect(result).toEqual([
      { element_id: "elm-001" },
      { element_id: "elm-002" },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. 인물 없는 cut → element_list 미전달
// ═══════════════════════════════════════════════════════════════════

describe("resolveElementListForCut — 인물 없는 cut", () => {
  it("charactersInScene 빈 배열 → 빈 배열", () => {
    const assets = [makeAsset("char-1", "completed", "elm-001")];
    expect(resolveElementListForCut(assets, [])).toEqual([]);
  });

  it("assets 빈 배열 → 빈 배열", () => {
    expect(resolveElementListForCut([], ["char-1"])).toEqual([]);
  });

  it("completed 없으면 → 빈 배열", () => {
    const assets = [
      makeAsset("char-1", "processing", null),
      makeAsset("char-2", "pending", null),
    ];
    expect(resolveElementListForCut(assets, ["char-1", "char-2"])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Element 상태 전환
// ═══════════════════════════════════════════════════════════════════

describe("Element status lifecycle", () => {
  it("pending → processing → completed", () => {
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

    assets = upsertElementAsset(assets, { ...assets[0], status: "processing" });
    expect(assets[0].status).toBe("processing");

    assets = upsertElementAsset(assets, {
      ...assets[0],
      status: "completed",
      elementId: "elm-final-001",
      completedAt: Date.now(),
    });
    expect(assets[0].status).toBe("completed");
    expect(assets[0].elementId).toBe("elm-final-001");
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

    assets = upsertElementAsset(assets, {
      ...assets[0],
      status: "failed",
      error: "Image quality too low",
    });
    expect(assets[0].status).toBe("failed");
    expect(assets[0].error).toBe("Image quality too low");
    expect(assets[0].elementId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. canCreateElement / getElementUnavailableReason
// ═══════════════════════════════════════════════════════════════════

describe("canCreateElement", () => {
  it("valid base64 → true", () => expect(canCreateElement("x".repeat(200))).toBe(true));
  it("undefined → false", () => expect(canCreateElement(undefined)).toBe(false));
  it("short → false", () => expect(canCreateElement("abc")).toBe(false));
  it("empty → false", () => expect(canCreateElement("")).toBe(false));
});

describe("getElementUnavailableReason", () => {
  it("valid → null", () => expect(getElementUnavailableReason("x".repeat(200))).toBeNull());
  it("undefined → 이유 반환", () => expect(getElementUnavailableReason(undefined)).toContain("얼굴 이미지가 없습니다"));
  it("short → 이유 반환", () => expect(getElementUnavailableReason("abc")).toContain("너무 작습니다"));
});

// ═══════════════════════════════════════════════════════════════════
// 9. multiShot / element_list 격리
// ═══════════════════════════════════════════════════════════════════

describe("multiShot / element_list 격리", () => {
  it("element_list 항목에는 element_id만 존재", () => {
    const elementList = resolveElementListForCut(
      [makeAsset("char-1", "completed", "elm-001")],
      ["char-1"],
    );
    expect(elementList).toHaveLength(1);
    expect(Object.keys(elementList[0])).toEqual(["element_id"]);
  });
});
