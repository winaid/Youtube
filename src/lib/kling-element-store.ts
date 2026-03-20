/**
 * kling-element-store.ts — Kling Custom Element 클라이언트 관리
 *
 * 설계:
 *   - KlingElementAsset 목록을 관리 (CharacterFaceRef와 완전 분리)
 *   - characterId 기반 조회 — cut.charactersInScene에서 element_list 조립
 *   - create/poll lifecycle 관리
 *
 * 경로:
 *   CharacterFaceRef (얼굴 crop) → create-kling-element → poll → KlingElementAsset
 *   KlingElementAsset → element_list → generate-video → _kling-api
 */

import type { KlingElementAsset, KlingElementStatus, KlingElementSourceType } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Payload Builder (문서 스펙 기준 — 순수 함수, 테스트 가능)
// ═══════════════════════════════════════════════════════════════════

/** Kling Custom Element 모델명 — kling-capability.ts에서 중앙 관리 */
import { KLING_ELEMENT_MODEL } from "@/lib/kling-capability";
export { KLING_ELEMENT_MODEL };

/**
 * 문서 스펙 기준 create element payload 조립.
 *
 * 최상위 구조:
 *   model: "kling-custom-element"
 *   model_params:
 *     element_name
 *     element_description (optional)
 *     reference_type: "image_refer" | "video_refer"
 *     element_image_list: { frontal_image }   (image_refer 시)
 *     element_video_list: { video_url }       (video_refer 시)
 */
export function buildCreateElementPayload(req: {
  element_name: string;
  element_description?: string;
  reference_type: "image_refer" | "video_refer";
  frontal_image?: string;
  video_url?: string;
}): Record<string, unknown> {
  if (req.reference_type === "image_refer" && !req.frontal_image) {
    throw new Error("Kling createElement: image_refer requires frontal_image");
  }
  if (req.reference_type === "video_refer" && !req.video_url) {
    throw new Error("Kling createElement: video_refer requires video_url");
  }

  const modelParams: Record<string, unknown> = {
    element_name: req.element_name,
    reference_type: req.reference_type,
  };

  if (req.element_description) {
    modelParams.element_description = req.element_description;
  }

  if (req.reference_type === "image_refer") {
    modelParams.element_image_list = {
      frontal_image: req.frontal_image,
    };
  } else {
    modelParams.element_video_list = {
      video_url: req.video_url,
    };
  }

  return {
    model: KLING_ELEMENT_MODEL,
    model_params: modelParams,
  };
}

// ═══════════════════════════════════════════════════════════════════
// API Client
// ═══════════════════════════════════════════════════════════════════

/** create-kling-element 엔드포인트 호출 */
export async function createKlingElement(params: {
  characterId: string;
  elementName: string;
  elementDescription?: string;
  /** 정면 얼굴 이미지 base64 — image_refer 시 필수 */
  frontalImage?: string;
  /** 영상 URL/base64 — video_refer 시 필수 */
  videoUrl?: string;
  referenceType: KlingElementSourceType;
}): Promise<{ taskId: string }> {
  const res = await fetch("/api/create-kling-element", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      characterId: params.characterId,
      element_name: params.elementName,
      element_description: params.elementDescription,
      frontal_image: params.frontalImage,
      video_url: params.videoUrl,
      reference_type: params.referenceType,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return res.json() as Promise<{ taskId: string }>;
}

/** check-kling-element 엔드포인트 호출 */
export async function checkKlingElement(
  taskId: string,
): Promise<{ status: KlingElementStatus; elementId: string | null; error: string | null }> {
  const res = await fetch("/api/check-kling-element", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return res.json() as Promise<{ status: KlingElementStatus; elementId: string | null; error: string | null }>;
}

// ═══════════════════════════════════════════════════════════════════
// Element Asset Helpers
// ═══════════════════════════════════════════════════════════════════

/** 새 KlingElementAsset 생성 (status=pending, elementId=null) */
export function createElementAsset(params: {
  characterId: string;
  taskId: string;
  elementName: string;
  elementDescription: string;
  sourceType: KlingElementSourceType;
}): KlingElementAsset {
  return {
    characterId: params.characterId,
    taskId: params.taskId,
    elementId: null,
    elementName: params.elementName,
    elementDescription: params.elementDescription,
    status: "pending",
    sourceType: params.sourceType,
    createdAt: Date.now(),
  };
}

/** 기존 asset 목록에서 같은 characterId의 asset을 교체 또는 추가 */
export function upsertElementAsset(
  assets: KlingElementAsset[],
  newAsset: KlingElementAsset,
): KlingElementAsset[] {
  const filtered = assets.filter((a) => a.characterId !== newAsset.characterId);
  return [...filtered, newAsset];
}

/** characterId 기반으로 완료된 elementId들을 추출 (element_list 조립용) */
export function resolveElementListForCut(
  assets: KlingElementAsset[],
  charactersInScene: string[],
): Array<{ element_id: string }> {
  if (charactersInScene.length === 0) return [];

  return assets
    .filter(
      (a) =>
        a.status === "completed" &&
        a.elementId !== null &&
        charactersInScene.includes(a.characterId),
    )
    .map((a) => ({ element_id: a.elementId! }));
}

/**
 * element 생성 가능 여부 판단 — 얼굴 base64가 충분히 큰지 (클라이언트 사전 검증).
 * 주의: 이 검증은 최소 조건만 확인. 실제 성공 여부는 Kling API 서버 검증에 따름.
 */
export function canCreateElement(faceBase64: string | undefined): boolean {
  return !!faceBase64 && faceBase64.length > 100;
}

/** element 생성 불가 사유 반환 — UI 표시용 */
export function getElementUnavailableReason(
  faceBase64: string | undefined,
): string | null {
  if (!faceBase64) return "얼굴 이미지가 없습니다. 스토리보드에서 추출하거나 직접 업로드해주세요.";
  if (faceBase64.length <= 100) return "얼굴 이미지가 너무 작습니다. 더 선명한 이미지를 사용해주세요.";
  // 통과해도 실제 성공은 Kling 서버 검증에 따름
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Polling Helper
// ═══════════════════════════════════════════════════════════════════

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_COUNT = 120; // ~10분

/**
 * element task를 완료될 때까지 폴링.
 * 완료/실패 시 콜백으로 asset 업데이트.
 */
export async function pollElementUntilDone(
  taskId: string,
  onUpdate: (update: { status: KlingElementStatus; elementId: string | null; error: string | null }) => void,
): Promise<{ status: KlingElementStatus; elementId: string | null }> {
  let pollCount = 0;

  while (pollCount < MAX_POLL_COUNT) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS + Math.floor(Math.random() * 1000)));
    pollCount++;

    try {
      const result = await checkKlingElement(taskId);
      onUpdate(result);

      if (result.status === "completed" || result.status === "failed") {
        return { status: result.status, elementId: result.elementId };
      }
    } catch (err) {
      console.error("[kling-element-store] poll error:", err);
      // 네트워크 에러는 재시도
      if (pollCount >= MAX_POLL_COUNT) {
        return { status: "failed", elementId: null };
      }
    }
  }

  return { status: "failed", elementId: null };
}
