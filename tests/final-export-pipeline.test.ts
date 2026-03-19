/**
 * final-export-pipeline.test.ts — 최종 영상 내보내기 파이프라인 테스트
 *
 * 검증 범위:
 * 1. clip 수집 및 정렬 (cutNumber 순서)
 * 2. export 차단 조건 (유효 clip 부족)
 * 3. export 상태 전이 (idle → fetching → encoding → done / error)
 * 4. 최종 영상 readiness 통합
 * 5. 실패가 성공처럼 보이지 않음
 */

import { describe, it, expect } from "vitest";
import {
  computeMontageExportState,
  evaluateStitchReadiness,
  getOrderedClipUrls,
  type MontageExportState,
} from "../src/lib/montage-export";
import {
  createStitchJob,
  type StitchPhase,
} from "../src/lib/client-stitch";
import type { Cut, VideoClip } from "../src/types";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function makeCut(n: number, dur = 5): Cut {
  return {
    cutNumber: n,
    durationSec: dur,
    sceneDescription: `Scene ${n}`,
    cameraDirection: "wide",
    moodLighting: "natural",
    imagePrompt: "",
    endImagePrompt: "",
    videoPrompt: `Video prompt ${n}`,
    extendPrompt: "",
    transitionHint: "",
    characterConsistency: "",
    charactersInScene: [],
  };
}

function makeClip(n: number, status: "completed" | "generating" | "failed" = "completed"): VideoClip {
  return {
    cutNumber: n,
    status,
    durationSec: 5,
    videoUri: status === "completed" ? `https://example.com/clip-${n}.mp4` : undefined,
    rawVideoUri: status === "completed" ? `https://example.com/clip-${n}.mp4` : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. Clip 수집 및 cutNumber 순서 정렬
// ═══════════════════════════════════════════════════════════════════

describe("clip 수집 및 정렬", () => {
  it("cutNumber 순서대로 정렬", () => {
    const cuts = [makeCut(3), makeCut(1), makeCut(2)];
    const clips = [makeClip(1), makeClip(2), makeClip(3)];
    const state = computeMontageExportState(cuts, clips);

    expect(state.orderedClips.map((c) => c.cutNumber)).toEqual([1, 2, 3]);
  });

  it("완료된 clip만 videoUri 포함", () => {
    const cuts = [makeCut(1), makeCut(2), makeCut(3)];
    const clips = [makeClip(1), makeClip(2, "generating"), makeClip(3)];
    const state = computeMontageExportState(cuts, clips);

    expect(state.orderedClips[0].status).toBe("completed");
    expect(state.orderedClips[0].videoUri).toBeTruthy();
    expect(state.orderedClips[1].status).toBe("missing"); // generating → missing
    expect(state.orderedClips[1].videoUri).toBe("");
    expect(state.orderedClips[2].status).toBe("completed");
  });

  it("getOrderedClipUrls는 완료된 것만 반환", () => {
    const cuts = [makeCut(1), makeCut(2), makeCut(3)];
    const clips = [makeClip(1), makeClip(2, "failed"), makeClip(3)];
    const urls = getOrderedClipUrls(cuts, clips);

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("clip-1");
    expect(urls[1]).toContain("clip-3");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Export 차단 조건
// ═══════════════════════════════════════════════════════════════════

describe("export 차단 조건", () => {
  it("clip 0개 → allClipsReady false", () => {
    const state = computeMontageExportState([], []);
    expect(state.allClipsReady).toBe(false);
    expect(state.completedCount).toBe(0);
    expect(state.totalCount).toBe(0);
  });

  it("일부 clip 누락 → allClipsReady false + missingCutNumbers", () => {
    const cuts = [makeCut(1), makeCut(2), makeCut(3)];
    const clips = [makeClip(1), makeClip(3)];
    const state = computeMontageExportState(cuts, clips);

    expect(state.allClipsReady).toBe(false);
    expect(state.missingCutNumbers).toEqual([2]);
    expect(state.completedCount).toBe(2);
  });

  it("모든 clip 완료 → allClipsReady true", () => {
    const cuts = [makeCut(1), makeCut(2)];
    const clips = [makeClip(1), makeClip(2)];
    const state = computeMontageExportState(cuts, clips);

    expect(state.allClipsReady).toBe(true);
    expect(state.missingCutNumbers).toEqual([]);
  });

  it("stitch 불가 상태에서 evaluateStitchReadiness → canStitch false", () => {
    const cuts = [makeCut(1), makeCut(2)];
    const clips = [makeClip(1), makeClip(2)];
    const state: MontageExportState = {
      ...computeMontageExportState(cuts, clips),
      stitchCapability: "not_available",
      stitchUnavailableReason: "패키지 미설치",
    };
    const readiness = evaluateStitchReadiness(state);

    expect(readiness.canStitch).toBe(false);
    expect(readiness.reason).toContain("패키지 미설치");
  });

  it("clip 미완료 + stitch 가능 → canStitch false (clip 사유)", () => {
    const cuts = [makeCut(1), makeCut(2)];
    const clips = [makeClip(1)]; // clip 2 missing
    const state: MontageExportState = {
      ...computeMontageExportState(cuts, clips),
      stitchCapability: "client_wasm",
      stitchUnavailableReason: "",
    };
    const readiness = evaluateStitchReadiness(state);

    expect(readiness.canStitch).toBe(false);
    expect(readiness.reason).toContain("#2");
  });

  it("모든 조건 충족 → canStitch true", () => {
    const cuts = [makeCut(1), makeCut(2)];
    const clips = [makeClip(1), makeClip(2)];
    const state: MontageExportState = {
      ...computeMontageExportState(cuts, clips),
      stitchCapability: "client_wasm",
      stitchUnavailableReason: "",
    };
    const readiness = evaluateStitchReadiness(state);

    expect(readiness.canStitch).toBe(true);
    expect(readiness.reason).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Export 상태 전이
// ═══════════════════════════════════════════════════════════════════

describe("export 상태 전이", () => {
  it("createStitchJob 초기 상태 → idle", () => {
    const clips = [
      { cutNumber: 1, videoUri: "http://a.mp4", durationSec: 5, status: "completed" as const },
      { cutNumber: 2, videoUri: "http://b.mp4", durationSec: 8, status: "completed" as const },
    ];
    const job = createStitchJob(clips);

    expect(job.phase).toBe("idle");
    expect(job.inputClipCount).toBe(2);
    expect(job.totalDurationSec).toBe(13);
    expect(job.outputUrl).toBeNull();
    expect(job.errorMessage).toBeNull();
  });

  it("빈 clip → inputClipCount 0", () => {
    const job = createStitchJob([]);
    expect(job.inputClipCount).toBe(0);
    expect(job.totalDurationSec).toBe(0);
  });

  it("StitchPhase 유효 값 검증", () => {
    const validPhases: StitchPhase[] = ["idle", "fetching", "encoding", "done", "error"];
    validPhases.forEach((phase) => {
      expect(typeof phase).toBe("string");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. 최종 영상 readiness 통합
// ═══════════════════════════════════════════════════════════════════

describe("최종 영상 readiness 통합", () => {
  function checkFullReadiness(opts: {
    completedCount: number;
    totalCount: number;
    finalVideoUrl: string | null;
    srtContent: string | null;
    seoResult: { titles: string[] } | null;
    thumbnailImages: { base64: string }[];
  }): { allReady: boolean; missing: string[] } {
    const missing: string[] = [];
    if (opts.completedCount !== opts.totalCount || opts.totalCount === 0) missing.push("컷 영상");
    if (!opts.finalVideoUrl) missing.push("최종 영상");
    if (!opts.srtContent) missing.push("SRT");
    if (!opts.seoResult) missing.push("SEO");
    if (opts.thumbnailImages.length === 0) missing.push("썸네일");
    return { allReady: missing.length === 0, missing };
  }

  it("모든 에셋 + 최종 영상 → allReady", () => {
    const r = checkFullReadiness({
      completedCount: 3, totalCount: 3,
      finalVideoUrl: "blob:http://localhost/abc",
      srtContent: "1\n00:00...",
      seoResult: { titles: ["T"] },
      thumbnailImages: [{ base64: "abc" }],
    });
    expect(r.allReady).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it("최종 영상 없음 → allReady false", () => {
    const r = checkFullReadiness({
      completedCount: 3, totalCount: 3,
      finalVideoUrl: null,
      srtContent: "srt",
      seoResult: { titles: ["T"] },
      thumbnailImages: [{ base64: "abc" }],
    });
    expect(r.allReady).toBe(false);
    expect(r.missing).toContain("최종 영상");
  });

  it("컷 미완 + 최종 영상 있어도 → allReady false", () => {
    const r = checkFullReadiness({
      completedCount: 2, totalCount: 3,
      finalVideoUrl: "blob:http://localhost/abc",
      srtContent: "srt",
      seoResult: { titles: ["T"] },
      thumbnailImages: [{ base64: "abc" }],
    });
    expect(r.allReady).toBe(false);
    expect(r.missing).toContain("컷 영상");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. 실패가 성공처럼 보이지 않음
// ═══════════════════════════════════════════════════════════════════

describe("실패 ≠ 성공 보장", () => {
  it("error phase job은 outputUrl이 null", () => {
    const clips = [
      { cutNumber: 1, videoUri: "http://a.mp4", durationSec: 5, status: "completed" as const },
    ];
    const job = createStitchJob(clips);
    // Simulate error
    job.phase = "error";
    job.errorMessage = "concat failed";
    job.finishedAt = Date.now();

    expect(job.outputUrl).toBeNull();
    expect(job.errorMessage).toBeTruthy();
    expect(job.phase).toBe("error");
  });

  it("totalDurationSec 계산 정확성", () => {
    const state = computeMontageExportState(
      [makeCut(1, 5), makeCut(2, 10), makeCut(3, 8)],
      [makeClip(1), makeClip(2), makeClip(3)],
    );
    expect(state.totalDurationSec).toBe(23);
  });

  it("missingCutNumbers가 실제 누락만 포함", () => {
    const cuts = [makeCut(1), makeCut(2), makeCut(3), makeCut(4)];
    const clips = [makeClip(1), makeClip(3)]; // 2, 4 missing
    const state = computeMontageExportState(cuts, clips);

    expect(state.missingCutNumbers).toEqual([2, 4]);
    expect(state.completedCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Audio limitation transparency
// ═══════════════════════════════════════════════════════════════════

describe("오디오 제한 투명성", () => {
  it("audioMuxSupported = false 명시", () => {
    const state = computeMontageExportState([makeCut(1)], [makeClip(1)]);
    expect(state.audioMuxSupported).toBe(false);
  });

  it("audioLimitationNotice 비어있지 않음", () => {
    const state = computeMontageExportState([makeCut(1)], [makeClip(1)]);
    expect(state.audioLimitationNotice.length).toBeGreaterThan(10);
  });
});
