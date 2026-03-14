/**
 * create-kling-element.ts — Kling Custom Element 생성 엔드포인트
 *
 * 목적: 캐릭터 얼굴 이미지/영상으로 reusable subject element를 생성.
 *       영상 생성(generate-video)과 완전 분리된 캐릭터 asset 생성 경로.
 *
 * 입력: characterId, element_name, element_description, frontal_image, video_url, reference_type
 * 출력: taskId (비동기 — check-kling-element로 상태 확인)
 *
 * Kling API payload 구조 (문서 스펙):
 *   model: "kling-custom-element"
 *   model_params:
 *     element_name, element_description, reference_type,
 *     element_image_list: { frontal_image }   (image_refer)
 *     element_video_list: { video_url }       (video_refer)
 */

import { klingCreateElement, type KlingEnv } from "./_kling-api";

type Env = KlingEnv;

interface CreateElementRequest {
  characterId: string;
  element_name: string;
  element_description?: string;
  frontal_image?: string;     // base64 (얼굴 crop) — image_refer 시 필수
  video_url?: string;         // base64 또는 public URL — video_refer 시 필수
  reference_type: "image_refer" | "video_refer";
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const req = await context.request.json() as CreateElementRequest;

    if (!req.characterId || !req.element_name || !req.reference_type) {
      return Response.json(
        { error: "characterId, element_name, reference_type are required" },
        { status: 400 },
      );
    }

    if (req.reference_type === "image_refer" && (!req.frontal_image || req.frontal_image.length < 100)) {
      return Response.json(
        { error: "image_refer requires a valid base64 image (min 100 chars) in frontal_image" },
        { status: 400 },
      );
    }

    if (req.reference_type === "video_refer" && (!req.video_url || req.video_url.length < 100)) {
      return Response.json(
        { error: "video_refer requires a valid video source in video_url" },
        { status: 400 },
      );
    }

    const result = await klingCreateElement(context.env, {
      element_name: req.element_name,
      element_description: req.element_description,
      frontal_image: req.frontal_image,
      video_url: req.video_url,
      reference_type: req.reference_type,
    });

    return Response.json({
      taskId: result.taskId,
      characterId: req.characterId,
      status: "pending",
    });
  } catch (error) {
    console.error("[create-kling-element] error:", error);
    return Response.json(
      { error: `Failed to create element: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
};
