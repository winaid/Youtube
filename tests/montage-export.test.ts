/**
 * montage-export.test.ts — montage export 유틸 테스트
 *
 * 핵심 검증:
 * - computeMontageExportState: cutNumber 순서 정렬, completed/missing 분류
 * - getOrderedClipUrls: 완료된 clip URL만 cutNumber 순서로 반환
 * - stitch 미구현 상태 명시 확인
 */

import { describe, it, expect } from "vitest";
import {
  computeMontageExportState,
  getOrderedClipUrls,
  evaluateStitchReadiness,
  detectStitchCapability,
} from "@/lib/montage-export";
import type { Cut, VideoClip } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Helper: 테스트용 Cut / VideoClip 생성
// ═══════════════════════════════════════════════════════════════════

function makeCut(cutNumber: number, durationSec = 5): Cut {
  return {
    cutNumber,
    durationSec,
    sceneDescription: `Scene ${cutNumber}`,
    cameraDirection: "",
    moodLighting: "",
    imagePrompt: "",
    endImagePrompt: "",
    videoPrompt: "",
    extendPrompt: "",
    transitionHint: "",
    characterConsistency: "",
    charactersInScene: [],
  };
}

function makeClip(
  cutNumber: number,
  status: "completed" | "idle" | "failed" = "completed",
  videoUri = `https://cdn.example.com/clip-${cutNumber}.mp4`,
): VideoClip {
  return {
    cutNumber,
    status,
    durationSec: 5,
    videoUri: status === "completed" ? videoUri : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// computeMontageExportState
// ═══════════════════════════════════════════════════════════════════

describe("computeMontageExportState", () => {
  it("모든 clip 완료 시 allClipsReady = true", () => {
    const cuts = [makeCut(1), makeCut(2), makeCut(3)];
    const clips = [makeClip(1), makeClip(2), makeClip(3)];
    const state = computeMontageExportState(cuts, clips);

    expect(state.allClipsReady).toBe(true);
    expect(state.completedCount).toBe(3);
    expect(state.totalCount).toBe(3);
    expect(state.missingCutNumbers).toEqual([]);
  });

  it("일부 clip 미완료 시 allClipsReady = false + missingCutNumbers 포함", () => {
    const cuts = [makeCut(1), makeCut(2), makeCut(3)];
    const clips = [makeClip(1), makeClip(2, "idle"), makeClip(3, "failed")];
    const state = computeMontageExportState(cuts, clips);

    expect(state.allClipsReady).toBe(false);
    expect(state.completedCount).toBe(1);
    expect(state.missingCutNumbers).toEqual([2, 3]);
  });

  it("cutNumber 순서대로 orderedClips 정렬 (역순 입력)", () => {
    const cuts = [makeCut(3), makeCut(1), makeCut(2)];
    const clips = [makeClip(3), makeClip(1), makeClip(2)];
    const state = computeMontageExportState(cuts, clips);

    expect(state.orderedClips.map((c) => c.cutNumber)).toEqual([1, 2, 3]);
  });

  it("빈 cuts → 빈 상태 + allClipsReady = false", () => {
    const state = computeMontageExportState([], []);

    expect(state.totalCount).toBe(0);
    expect(state.completedCount).toBe(0);
    expect(state.allClipsReady).toBe(false);
    expect(state.orderedClips).toEqual([]);
  });

  it("totalDurationSec 정확히 계산", () => {
    const cuts = [makeCut(1, 3), makeCut(2, 5), makeCut(3, 8)];
    const clips = [makeClip(1), makeClip(2), makeClip(3)];
    const state = computeMontageExportState(cuts, clips);

    expect(state.totalDurationSec).toBe(16);
  });

  it("stitchCapability = not_available 고정", () => {
    const cuts = [makeCut(1)];
    const clips = [makeClip(1)];
    const state = computeMontageExportState(cuts, clips);

    expect(state.stitchCapability).toBe("not_available");
    expect(state.stitchUnavailableReason).toBeTruthy();
  });

  it("clip 없는 cut은 missing으로 분류 + videoUri 빈 문자열", () => {
    const cuts = [makeCut(1), makeCut(2)];
    const clips = [makeClip(1)]; // cut 2 대응 clip 없음
    const state = computeMontageExportState(cuts, clips);

    expect(state.orderedClips[1].status).toBe("missing");
    expect(state.orderedClips[1].videoUri).toBe("");
    expect(state.missingCutNumbers).toEqual([2]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// getOrderedClipUrls
// ═══════════════════════════════════════════════════════════════════

describe("getOrderedClipUrls", () => {
  it("완료된 clip URL만 cutNumber 순서로 반환", () => {
    const cuts = [makeCut(3), makeCut(1), makeCut(2)];
    const clips = [
      makeClip(1, "completed", "https://a.com/1.mp4"),
      makeClip(2, "idle"),
      makeClip(3, "completed", "https://a.com/3.mp4"),
    ];
    const urls = getOrderedClipUrls(cuts, clips);

    expect(urls).toEqual(["https://a.com/1.mp4", "https://a.com/3.mp4"]);
  });

  it("모두 미완료 → 빈 배열", () => {
    const cuts = [makeCut(1), makeCut(2)];
    const clips = [makeClip(1, "idle"), makeClip(2, "failed")];
    const urls = getOrderedClipUrls(cuts, clips);

    expect(urls).toEqual([]);
  });

  it("빈 입력 → 빈 배열", () => {
    expect(getOrderedClipUrls([], [])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// stitch 부재 명시 검증
// ═══════════════════════════════════════════════════════════════════

describe("stitch 부재 명시", () => {
  it("stitchUnavailableReason이 사용자 안내 문구 포함", () => {
    const state = computeMontageExportState([makeCut(1)], [makeClip(1)]);

    expect(state.stitchUnavailableReason).toContain("미구현");
    expect(state.stitchUnavailableReason).toContain("외부 편집 도구");
  });

  it("allClipsReady=true여도 stitchCapability는 not_available", () => {
    const cuts = [makeCut(1), makeCut(2)];
    const clips = [makeClip(1), makeClip(2)];
    const state = computeMontageExportState(cuts, clips);

    expect(state.allClipsReady).toBe(true);
    expect(state.stitchCapability).toBe("not_available");
  });
});

// ═══════════════════════════════════════════════════════════════════
// evaluateStitchReadiness
// ═══════════════════════════════════════════════════════════════════

describe("evaluateStitchReadiness", () => {
  it("not_available → canStitch=false", () => {
    const state = computeMontageExportState([makeCut(1)], [makeClip(1)]);
    expect(evaluateStitchReadiness(state).canStitch).toBe(false);
  });

  it("client_wasm + allReady → canStitch=true", () => {
    const state = {
      ...computeMontageExportState([makeCut(1)], [makeClip(1)]),
      stitchCapability: "client_wasm" as const,
      stitchUnavailableReason: "",
    };
    expect(evaluateStitchReadiness(state).canStitch).toBe(true);
  });

  it("client_wasm + missing → canStitch=false, reason에 누락 번호 포함", () => {
    const state = {
      ...computeMontageExportState([makeCut(1), makeCut(2)], [makeClip(1)]),
      stitchCapability: "client_wasm" as const,
      stitchUnavailableReason: "",
    };
    const result = evaluateStitchReadiness(state);
    expect(result.canStitch).toBe(false);
    expect(result.reason).toContain("#2");
  });
});

// ═══════════════════════════════════════════════════════════════════
// detectStitchCapability (Node 환경)
// ═══════════════════════════════════════════════════════════════════

describe("detectStitchCapability", () => {
  it("Node 환경에서 not_available 반환", async () => {
    const result = await detectStitchCapability();
    expect(result.capability).toBe("not_available");
    expect(result.unavailableReason).toBeTruthy();
  });
});
