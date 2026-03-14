/**
 * check-kling-element.ts — Kling Custom Element 상태 조회 엔드포인트
 *
 * 목적: create-kling-element로 시작한 element 생성 task의 상태를 폴링.
 *       완료 시 element_id를 반환 — 이후 video generation 시 element_list에 사용.
 *
 * 입력: taskId
 * 출력: status, elementId (완료 시)
 *
 * 주의: 상태 조회 endpoint(GET /v1/elements/{taskId})는 문서에서
 *       완전 확정 근거가 부족한 추정 경로. 실환경 검증 필수.
 */

import { klingCheckElement, type KlingEnv } from "./_kling-api";

type Env = KlingEnv;

interface CheckElementRequest {
  taskId: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const req = await context.request.json() as CheckElementRequest;

    if (!req.taskId) {
      return Response.json(
        { error: "taskId is required" },
        { status: 400 },
      );
    }

    const result = await klingCheckElement(context.env, req.taskId);

    return Response.json({
      taskId: result.taskId,
      status: result.status,
      elementId: result.elementId ?? null,
      error: result.error ?? null,
    });
  } catch (error) {
    console.error("[check-kling-element] error:", error);
    return Response.json(
      { error: `Failed to check element: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
};
