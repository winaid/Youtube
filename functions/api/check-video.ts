/**
 * check-video.ts — VEO 전용 상태 폴링
 *
 * VEO(Google) operation 폴링만 유지.
 */
import { veoCheckStatus, type VeoEnv } from "./_veo-api";

type Env = VeoEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const tCheckStart = Date.now();
  try {
    // ── 1. Request body 파싱
    let bodyText = "";
    let operationName = "";
    let isExtend = false;
    let cutNumber: number | null = null;
    try {
      bodyText = await context.request.text();
      const parsed = JSON.parse(bodyText) as {
        operationName?: string;
        isExtend?: boolean;
        cutNumber?: number;
      };
      operationName = parsed.operationName || "";
      isExtend  = parsed.isExtend  ?? false;
      cutNumber = typeof parsed.cutNumber === "number" ? parsed.cutNumber : null;
    } catch (parseErr) {
      console.error("[check-video] JSON parse failed. body:", bodyText.slice(0, 500), "err:", parseErr);
      return Response.json({ error: "Invalid JSON body", details: String(parseErr) }, { status: 400 });
    }

    console.log("[check-video] ENTRY", {
      engine: "veo",
      cutNumber,
      operationName: operationName ? operationName.slice(0, 80) : "(empty)",
      isExtend,
    });

    // ── VEO 체크 ────────────────────────────────────────────────
    if (!operationName) {
      return Response.json({ error: "operationName is required for VEO engine" }, { status: 400 });
    }

    let result;
    try {
      result = await veoCheckStatus(context.env, operationName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[check-video] VEO check error:", msg);
      return Response.json({ status: "FAILED", error: `VEO API 오류: ${msg}` }, { status: 502 });
    }

    console.log("[check-video] VEO result", {
      operationName: result.operationName,
      done: result.done,
      status: result.status,
      videoUri: result.videoUri ? result.videoUri.slice(0, 80) : null,
      error: result.error,
    });

    // done=false → RUNNING
    if (!result.done) {
      return Response.json({ status: "RUNNING" });
    }

    // done=true, failed
    if (result.status === "failed") {
      return Response.json({ status: "FAILED", error: result.error ?? "VEO generation failed" }, { status: 422 });
    }

    // done=true, completed
    if (result.status === "completed") {
      if (!result.videoUri) {
        console.warn("[check-video] VEO completed but videoUri missing — treating as running");
        return Response.json({ status: "RUNNING" });
      }

      const checkTotalMs = Date.now() - tCheckStart;
      console.log("[check-video] ⏱ timing", { checkTotalMs, cutNumber });

      return Response.json({
        status: "COMPLETED",
        videoUri: result.videoUri,
        rawVideoUri: result.videoUri,
        canonicalVideoUri: result.videoUri.startsWith("https://") ? result.videoUri : null,
        seed: undefined,
        variants: [{ videoUri: result.videoUri, rawVideoUri: result.videoUri }],
        sampleCount: 1,
        engine: "veo",
        // VEO는 Google URI를 반환하므로 R2 업로드 필요
        needsUpload: true,
      });
    }

    // done=true but status is pending/processing (unexpected) — treat as running
    return Response.json({ status: "RUNNING" });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[check-video] UNHANDLED: ${errMsg}`);
    return Response.json({
      status: "FAILED",
      error: `check-video 내부 오류: ${errMsg}`,
    }, { status: 500 });
  }
};
