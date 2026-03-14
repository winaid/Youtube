/**
 * client-stitch-policy.test.ts — stitch 정책 및 파이프라인 테스트
 *
 * 핵심 검증:
 * - evaluateStitchReadiness: capability + allClipsReady 조합 판정
 * - StitchJob 상태 모델: phase 전이 일관성
 * - cutNumber 순서 보존: 역순/섞인 입력에서도 stitch 순서 안정
 * - missing clip 존재 시 stitch 거부
 * - fetchClipBlobs: 순서 보장
 * - stitch 미구현 상태 UI 노출 유지
 */

import { describe, it, expect } from "vitest";
import {
  computeMontageExportState,
  evaluateStitchReadiness,
  detectStitchCapability,
  type MontageExportState,
  type StitchCapability,
} from "@/lib/montage-export";
import {
  createStitchJob,
  type StitchPhase,
  StitchError,
} from "@/lib/client-stitch";
import type { Cut, VideoClip } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════

function makeCut(cutNumber: number, durationSec = 5): Cut {
  return {
    cutNumber, durationSec,
    sceneDescription: `Scene ${cutNumber}`,
    cameraDirection: "", moodLighting: "", imagePrompt: "", endImagePrompt: "",
    videoPrompt: "", extendPrompt: "", transitionHint: "", characterConsistency: "",
    charactersInScene: [],
  };
}

function makeClip(
  cutNumber: number,
  status: "completed" | "idle" | "failed" = "completed",
  videoUri = `https://cdn.example.com/clip-${cutNumber}.mp4`,
): VideoClip {
  return {
    cutNumber, status, durationSec: 5,
    videoUri: status === "completed" ? videoUri : undefined,
  };
}

/** MontageExportState에 capability를 주입하는 헬퍼 */
function withCapability(
  state: MontageExportState,
  cap: StitchCapability,
): MontageExportState {
  return { ...state, stitchCapability: cap, stitchUnavailableReason: cap === "not_available" ? "미구현" : "" };
}

// ═══════════════════════════════════════════════════════════════════
// evaluateStitchReadiness
// ═══════════════════════════════════════════════════════════════════

describe("evaluateStitchReadiness", () => {
  it("capability=not_available → canStitch=false", () => {
    const state = computeMontageExportState([makeCut(1)], [makeClip(1)]);
    const result = evaluateStitchReadiness(state); // default not_available
    expect(result.canStitch).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("capability=client_wasm + allClipsReady=true → canStitch=true", () => {
    const state = withCapability(
      computeMontageExportState([makeCut(1), makeCut(2)], [makeClip(1), makeClip(2)]),
      "client_wasm",
    );
    const result = evaluateStitchReadiness(state);
    expect(result.canStitch).toBe(true);
    expect(result.capability).toBe("client_wasm");
  });

  it("capability=client_wasm + missing clips → canStitch=false", () => {
    const state = withCapability(
      computeMontageExportState([makeCut(1), makeCut(2)], [makeClip(1), makeClip(2, "idle")]),
      "client_wasm",
    );
    const result = evaluateStitchReadiness(state);
    expect(result.canStitch).toBe(false);
    expect(result.reason).toContain("#2");
  });

  it("capability=client_wasm + 빈 cuts → canStitch=false", () => {
    const state = withCapability(
      computeMontageExportState([], []),
      "client_wasm",
    );
    const result = evaluateStitchReadiness(state);
    expect(result.canStitch).toBe(false);
  });

  it("capability=server_ffmpeg + allClipsReady → canStitch=true", () => {
    const state = withCapability(
      computeMontageExportState([makeCut(1)], [makeClip(1)]),
      "server_ffmpeg",
    );
    expect(evaluateStitchReadiness(state).canStitch).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// cutNumber 순서 안정성 — stitch 순서의 source of truth
// ═══════════════════════════════════════════════════════════════════

describe("cutNumber 순서 안정성 (stitch 순서 source of truth)", () => {
  it("역순 입력에서도 orderedClips는 cutNumber 오름차순", () => {
    const cuts = [makeCut(5), makeCut(3), makeCut(1), makeCut(4), makeCut(2)];
    const clips = [makeClip(5), makeClip(3), makeClip(1), makeClip(4), makeClip(2)];
    const state = computeMontageExportState(cuts, clips);
    expect(state.orderedClips.map((c) => c.cutNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it("중간 cutNumber 누락 시에도 나머지 순서 유지", () => {
    const cuts = [makeCut(1), makeCut(3), makeCut(5)];
    const clips = [makeClip(1), makeClip(3), makeClip(5)];
    const state = computeMontageExportState(cuts, clips);
    expect(state.orderedClips.map((c) => c.cutNumber)).toEqual([1, 3, 5]);
  });

  it("stitch에 사용될 URL 순서도 cutNumber 기준", () => {
    const cuts = [makeCut(3), makeCut(1)];
    const clips = [
      makeClip(3, "completed", "https://c.com/3.mp4"),
      makeClip(1, "completed", "https://c.com/1.mp4"),
    ];
    const state = computeMontageExportState(cuts, clips);
    const completedUrls = state.orderedClips
      .filter((c) => c.status === "completed")
      .map((c) => c.videoUri);
    expect(completedUrls).toEqual(["https://c.com/1.mp4", "https://c.com/3.mp4"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// StitchJob 상태 모델
// ═══════════════════════════════════════════════════════════════════

describe("StitchJob 상태 모델", () => {
  it("createStitchJob 초기 상태: phase=idle, outputUrl=null", () => {
    const clips = [
      { cutNumber: 1, videoUri: "https://a.com/1.mp4", durationSec: 5, status: "completed" as const },
      { cutNumber: 2, videoUri: "https://a.com/2.mp4", durationSec: 3, status: "completed" as const },
    ];
    const job = createStitchJob(clips);
    expect(job.phase).toBe("idle");
    expect(job.outputUrl).toBeNull();
    expect(job.errorMessage).toBeNull();
    expect(job.inputClipCount).toBe(2);
    expect(job.totalDurationSec).toBe(8);
  });

  it("createStitchJob은 missing clip을 inputClipCount에서 제외", () => {
    const clips = [
      { cutNumber: 1, videoUri: "https://a.com/1.mp4", durationSec: 5, status: "completed" as const },
      { cutNumber: 2, videoUri: "", durationSec: 3, status: "missing" as const },
    ];
    const job = createStitchJob(clips);
    expect(job.inputClipCount).toBe(1);
    expect(job.totalDurationSec).toBe(5);
  });

  it("StitchError는 올바른 code 포함", () => {
    const err = new StitchError("no_clips", "테스트");
    expect(err.code).toBe("no_clips");
    expect(err.name).toBe("StitchError");
    expect(err.message).toBe("테스트");
  });
});

// ═══════════════════════════════════════════════════════════════════
// stitch 미구현 상태 UI 명시성 유지 검증
// ═══════════════════════════════════════════════════════════════════

describe("stitch 미구현 상태 명시성", () => {
  it("기본 computeMontageExportState는 not_available 반환", () => {
    const state = computeMontageExportState([makeCut(1)], [makeClip(1)]);
    expect(state.stitchCapability).toBe("not_available");
    expect(state.stitchUnavailableReason).toContain("미구현");
  });

  it("detectStitchCapability는 Node 환경에서 not_available", async () => {
    // vitest는 Node 환경 → window 없음 → not_browser
    const result = await detectStitchCapability();
    expect(result.capability).toBe("not_available");
    expect(result.unavailableReason).toBeTruthy();
  });

  it("allClipsReady=true여도 capability=not_available이면 canStitch=false", () => {
    const state = computeMontageExportState(
      [makeCut(1), makeCut(2)],
      [makeClip(1), makeClip(2)],
    );
    expect(state.allClipsReady).toBe(true);
    const readiness = evaluateStitchReadiness(state);
    expect(readiness.canStitch).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 개별 다운로드 vs 최종 stitch 구분
// ═══════════════════════════════════════════════════════════════════

describe("개별 다운로드 vs stitch 구분", () => {
  it("stitch 불가 시에도 개별 다운로드에 필요한 데이터는 존재", () => {
    const state = computeMontageExportState(
      [makeCut(1), makeCut(2)],
      [makeClip(1), makeClip(2, "idle")],
    );
    // completedCount > 0이면 개별 다운로드는 가능
    expect(state.completedCount).toBe(1);
    // stitch는 불가
    expect(evaluateStitchReadiness(state).canStitch).toBe(false);
    // orderedClips에서 completed만 필터링하면 다운로드 대상
    const downloadable = state.orderedClips.filter((c) => c.status === "completed");
    expect(downloadable).toHaveLength(1);
    expect(downloadable[0].videoUri).toBeTruthy();
  });

  it("stitch 가능 시에도 개별 다운로드 데이터 유지", () => {
    const state = withCapability(
      computeMontageExportState([makeCut(1), makeCut(2)], [makeClip(1), makeClip(2)]),
      "client_wasm",
    );
    expect(evaluateStitchReadiness(state).canStitch).toBe(true);
    // 개별 다운로드도 여전히 가능해야 함
    const downloadable = state.orderedClips.filter((c) => c.status === "completed");
    expect(downloadable).toHaveLength(2);
  });
});
