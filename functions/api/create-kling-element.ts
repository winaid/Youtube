/**
 * create-kling-element.ts — Kling Custom Element 생성 엔드포인트
 *
 * 목적: 캐릭터 얼굴 이미지/영상으로 reusable subject element를 생성.
 *       영상 생성(generate-video)과 완전 분리된 캐릭터 asset 생성 경로.
 *
 * 입력: characterId, name, description, image(base64), source_type
 * 출력: taskId (비동기 — check-kling-element로 상태 확인)
 */

import { klingCreateElement, type KlingEnv } from "./_kling-api";

type Env = KlingEnv;

interface CreateElementRequest {
  characterId: string;
  name: string;
  description?: string;
  image?: string;      // base64 (얼굴 crop)
  video?: string;      // base64 또는 public URL
  source_type: "image_refer" | "video_refer";
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const req = await context.request.json() as CreateElementRequest;

    if (!req.characterId || !req.name || !req.source_type) {
      return Response.json(
        { error: "characterId, name, source_type are required" },
        { status: 400 },
      );
    }

    if (req.source_type === "image_refer" && (!req.image || req.image.length < 100)) {
      return Response.json(
        { error: "image_refer requires a valid base64 image (min 100 chars)" },
        { status: 400 },
      );
    }

    if (req.source_type === "video_refer" && (!req.video || req.video.length < 100)) {
      return Response.json(
        { error: "video_refer requires a valid video source" },
        { status: 400 },
      );
    }

    const result = await klingCreateElement(context.env, {
      name: req.name,
      description: req.description,
      image: req.image,
      video: req.video,
      source_type: req.source_type,
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
