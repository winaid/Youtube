/**
 * check-video.ts — 2-API 아키텍처: Kling 전용 상태 폴링
 *
 * Veo/Vertex 폴링 경로: 제거됨
 * Kling 폴링만 유지.
 */
import { klingCheckStatus, type KlingEnv } from "./_kling-api";

type Env = KlingEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const tCheckStart = Date.now();
  try {
    // ── 1. Request body 파싱
    let bodyText = "";
    let engine: "veo" | "kling" = "kling";
    let taskId = "";
    let isExtend = false;
    let cutNumber: number | null = null;
    let operationName = "";
    try {
      bodyText = await context.request.text();
      const parsed = JSON.parse(bodyText) as {
        operationName?: string;
        engine?: "veo" | "kling";
        taskId?: string;
        isExtend?: boolean;
        cutNumber?: number;
      };
      operationName = parsed.operationName || "";
      engine    = parsed.engine    ?? "kling";
      taskId    = parsed.taskId    || operationName;
      isExtend  = parsed.isExtend  ?? false;
      cutNumber = typeof parsed.cutNumber === "number" ? parsed.cutNumber : null;
    } catch (parseErr) {
      console.error("[check-video] JSON parse failed. body:", bodyText.slice(0, 500), "err:", parseErr);
      return Response.json({ error: "Invalid JSON body", details: String(parseErr) }, { status: 400 });
    }

    // ── Veo 요청이 오면 에러 반환 (Veo 경로 제거됨) ──────────────
    if (engine === "veo") {
      console.warn("[check-video] ⚠️ engine=veo 요청 → Veo 폴링 경로 제거됨");
      // 기존 Veo operationName으로 왔을 경우, taskId로 Kling 폴링 시도
      if (!taskId || taskId === operationName) {
        return Response.json({
          status: "FAILED",
          error: "Veo engine has been removed. Only Kling is supported. Please regenerate with Kling.",
        });
      }
      // taskId가 있으면 Kling으로 폴링 시도
      engine = "kling";
    }

    console.log("[check-video] ENTRY", {
      engine: "kling",
      cutNumber,
      taskId: taskId ? taskId.slice(0, 80) : "(empty)",
      isExtend,
    });

    // ── Kling 체크 ────────────────────────────────────────────────
    if (!taskId) {
      return Response.json({ error: "taskId is required for Kling engine" }, { status: 400 });
    }

    let result;
    try {
      result = await klingCheckStatus(context.env, taskId, isExtend);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[check-video] Kling check error:", msg);
      return Response.json({ status: "RUNNING" });
    }

    console.log("[check-video] Kling result", {
      rawStatus: result.status,
      progress: result.progress,
      videoUrl: result.videoUrl ? result.videoUrl.slice(0, 80) : null,
      videoId: result.videoId,
      error: result.error,
    });

    if (result.status === "pending" || result.status === "processing") {
      return Response.json({ status: "RUNNING", progress: result.progress });
    }

    if (result.status === "failed") {
      return Response.json({ status: "FAILED", error: result.error ?? "Kling generation failed" });
    }

    // completed
    if (!result.videoUrl) {
      console.warn("[check-video] Kling completed but videoUrl missing — treating as processing");
      return Response.json({ status: "RUNNING" });
    }

    const checkTotalMs = Date.now() - tCheckStart;
    console.log("[check-video] ⏱ timing", { checkTotalMs, cutNumber });

    return Response.json({
      status: "COMPLETED",
      videoUri: result.videoUrl,
      rawVideoUri: result.videoUrl,
      canonicalVideoUri: result.videoUrl.startsWith("https://") ? result.videoUrl : null,
      seed: undefined,
      variants: [{ videoUri: result.videoUrl, rawVideoUri: result.videoUrl }],
      sampleCount: 1,
      engine: "kling",
      // Kling 영상은 HTTPS URL로 반환되므로 업로드 불필요
      needsUpload: false,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[check-video] UNHANDLED: ${errMsg}`);
    return Response.json({
      status: "FAILED",
      error: `check-video 내부 오류: ${errMsg}`,
    });
  }
};
