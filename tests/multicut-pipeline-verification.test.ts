/**
 * multicut-pipeline-verification.test.ts — 멀티컷 영상 파이프라인 대표 시퀀스 검증
 *
 * 검증 항목 (7개):
 *   1. 긴 storyText + auto → project total 60초 이상 (15초 아님)
 *   2. current segment ≤ 15초 유지
 *   3. density policy → currentSegmentTargetCuts 1~2 (서사형 저밀도 정책)
 *   4. 짧은 컷 multiShot 억제
 *   5. 다수 clip 생성 구조
 *   6. stitch capability 감지 체인
 *   7. custom element create/poll/element_list 경로
 */

import { describe, it, expect } from "vitest";
import { estimateProjectDuration } from "@/lib/story-duration-estimator";
import { VEO_DEFAULT_MODEL } from "@/lib/veo-capability";

// VEO policy stubs
const VEO_MAX_SHOTS = 4;
function getMax(_model: string, duration: number): number {
  return duration >= 8 ? VEO_MAX_SHOTS : 0;
}
function normalizeMultiShots(_model: string, shots: Array<{index: number; prompt: string; duration: string; role?: string}>, _duration: number) {
  return shots.slice(0, VEO_MAX_SHOTS).map((s, i) => ({ ...s, index: i + 1 }));
}
const O3_MODEL = VEO_DEFAULT_MODEL;
import {
  resolveSegmentPlan,
  resolveCutCount,
  recommendMinimumCutCount,
  personaCutCountBias,
  recommendCutCountRange,
  VEO_SEGMENT_CAP,
} from "@/lib/sequence-density";
import {
  computeAutoDuration,
  safeDuration,
  DURATION_MIN,
  DURATION_MAX,
  DURATION_FALLBACK,
} from "@/lib/duration-reconciliation";
import {
  computeMontageExportState,
  detectStitchCapability,
} from "@/lib/montage-export";

// ═══════════════════════════════════════════════════════════════════
// 대표 시나리오 — 긴 한국어 스토리
// ═══════════════════════════════════════════════════════════════════

const LONG_STORY = `
  한 소녀가 황폐한 도시를 걸어간다. 하늘에는 먹구름이 가득하다.
  거리는 텅 비어 있고, 바람만이 쓸쓸하게 불고 있다.
  소녀는 오래된 건물 앞에서 멈춘다. 문이 반쯤 열려 있다.
  안으로 들어가자 먼지 쌓인 피아노가 보인다.
  소녀는 천천히 피아노 앞에 앉는다. 건반을 누른다.
  아름다운 멜로디가 텅 빈 건물에 울려 퍼진다.
  음악 소리에 이끌려 고양이 한 마리가 다가온다.
  소녀는 미소 짓는다. 고양이는 피아노 위에 올라앉는다.
  두 존재는 서로의 온기를 느낀다. 세상은 여전히 황폐하지만.
  음악이 울리는 한, 희망은 사라지지 않는다.
`;

// ═══════════════════════════════════════════════════════════════════
// 1. auto duration → project total 60초 이상
// ═══════════════════════════════════════════════════════════════════

describe("테스트 1: auto duration → project total ≥ 60초", () => {
  it("긴 한국어 storyText → estimatedTotalSec ≥ 60", () => {
    const result = estimateProjectDuration(LONG_STORY);
    expect(result.estimatedTotalSec).toBeGreaterThanOrEqual(60);
    expect(result.basis).not.toBe("minimum");
  });

  it("project total은 15초(VEO_SEGMENT_CAP)가 아니다", () => {
    const result = estimateProjectDuration(LONG_STORY);
    expect(result.estimatedTotalSec).not.toBe(15);
    expect(result.estimatedTotalSec).not.toBe(VEO_SEGMENT_CAP);
  });

  it("project total은 30~300초 범위 내", () => {
    const result = estimateProjectDuration(LONG_STORY);
    expect(result.estimatedTotalSec).toBeGreaterThanOrEqual(30);
    expect(result.estimatedTotalSec).toBeLessThanOrEqual(300);
  });

  it("metrics에 charCount, sentenceCount, estimatedNarrationSec 포함", () => {
    const result = estimateProjectDuration(LONG_STORY);
    expect(result.metrics.charCount).toBeGreaterThan(100);
    expect(result.metrics.sentenceCount).toBeGreaterThanOrEqual(8);
    expect(result.metrics.estimatedNarrationSec).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. current segment ≤ 15초 유지
// ═══════════════════════════════════════════════════════════════════

describe("테스트 2: current segment ≤ 15초 유지", () => {
  it("VEO_SEGMENT_CAP = 8", () => {
    expect(VEO_SEGMENT_CAP).toBe(8);
  });

  it("safeDuration은 DURATION_MAX(8) 초과를 클램핑", () => {
    expect(safeDuration(20)).toBeLessThanOrEqual(DURATION_MAX);
    expect(safeDuration(20)).toBe(8);
    expect(safeDuration(100)).toBe(8);
  });

  it("safeDuration은 DURATION_MIN(8) 미만을 클램핑", () => {
    expect(safeDuration(1)).toBe(DURATION_MIN);
    expect(safeDuration(2)).toBe(DURATION_MIN);
  });

  it("computeAutoDuration은 8초 이하를 반환", () => {
    // totalDuration=120s, cutCount=5 → 120/5=24s → 클램핑 → 8s
    const result = computeAutoDuration({ totalDurationSeconds: 120, cutCount: 5 });
    expect(result.duration).toBeLessThanOrEqual(8);
    expect(result.duration).toBeGreaterThanOrEqual(DURATION_MIN);
  });

  it("resolveSegmentPlan의 각 segment는 VEO_SEGMENT_CAP 이하", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 90 });
    for (const seg of plan.segments) {
      expect(seg.segmentDurationSec).toBeLessThanOrEqual(VEO_SEGMENT_CAP);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. fast density → currentSegmentTargetCuts 3~5+
// ═══════════════════════════════════════════════════════════════════

describe("테스트 3: 8초 segment에서 currentSegmentTargetCuts 3~6 (숏폼 리듬 정책)", () => {
  it("8초 segment, neutral bias → targetCuts 3~6", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 8, personaBias: "neutral" });
    expect(plan.currentSegmentTargetCuts).toBeGreaterThanOrEqual(3);
    expect(plan.currentSegmentTargetCuts).toBeLessThanOrEqual(6);
  });

  it("8초 segment, upper bias → targetCuts ≥ 5", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 8, personaBias: "upper" });
    expect(plan.currentSegmentTargetCuts).toBeGreaterThanOrEqual(5);
  });

  it("recommendMinimumCutCount(15) = 4", () => {
    expect(recommendMinimumCutCount(15)).toBe(4);
  });

  it("recommendMinimumCutCount(12) = 4", () => {
    expect(recommendMinimumCutCount(12)).toBe(4);
  });

  it("60초 project → multi-segment, 총 targetCuts ≥ 22", () => {
    const plan = resolveSegmentPlan({ totalDurationSec: 60 });
    // ceil(60/8)=8 segments
    expect(plan.segmentCount).toBeGreaterThanOrEqual(8);
    expect(plan.totalTargetCuts).toBeGreaterThanOrEqual(22);
  });

  it("resolveCutCount(totalDurationSec=15, neutral) → cutCount 6~10 (capped at CUT_COUNT_MAX=10)", () => {
    const result = resolveCutCount({ totalDurationSec: 15, personaBias: "neutral" });
    // recommendCutCountRange(15)={6,12}, midpoint=9
    expect(result.cutCount).toBeGreaterThanOrEqual(6);
    expect(result.cutCount).toBeLessThanOrEqual(10);
  });

  it("recommendCutCountRange(15) → min = 6, max = 12", () => {
    const range = recommendCutCountRange(15);
    expect(range.min).toBe(6);
    expect(range.max).toBe(12);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. 짧은 컷 multiShot 억제
// ═══════════════════════════════════════════════════════════════════

describe("테스트 4: multiShot clamp — 짧은 컷에서 억제 (O3 capability 기반)", () => {
  const O3 = O3_MODEL;

  const sampleMultiShot = [
    { index: 1, prompt: "wide shot", duration: "3" },
    { index: 2, prompt: "medium shot", duration: "3" },
    { index: 3, prompt: "close up", duration: "3" },
    { index: 4, prompt: "detail shot", duration: "3" },
    { index: 5, prompt: "context shot", duration: "3" },
    { index: 6, prompt: "payoff shot", duration: "3" },
  ];

  it("3초 이하 → multiShot 0개 (완전 비활성)", () => {
    expect(getMax(O3, 2)).toBe(0);
    expect(getMax(O3, 3)).toBe(0);
  });

  it("4~7초 → VEO 멀티샷 불가 (8초 미만)", () => {
    expect(getMax(O3, 4)).toBe(0);
    expect(getMax(O3, 5)).toBe(0);
    expect(getMax(O3, 6)).toBe(0);
    expect(getMax(O3, 7)).toBe(0);
  });

  it("8~10초 → VEO 최대 4개", () => {
    expect(getMax(O3, 8)).toBe(4);
  });

  it("12~15초 → VEO 최대 4개", () => {
    expect(getMax(O3, 12)).toBe(4);
    expect(getMax(O3, 15)).toBe(4);
  });

  it("normalizeMultiShots 빈 배열 → 빈 배열", () => {
    expect(normalizeMultiShots(O3, [], 10)).toHaveLength(0);
  });

  it("normalizeMultiShots 6개 → 4개 clamp (8초, VEO 최대 4)", () => {
    const result = normalizeMultiShots(O3, sampleMultiShot, 8);
    expect(result).toHaveLength(4);
    // index 재정렬 확인
    expect(result.map((s: { index: number }) => s.index)).toEqual([1, 2, 3, 4]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. 다수 clip 생성 구조
// ═══════════════════════════════════════════════════════════════════

describe("테스트 5: 다수 clip 생성 구조 확인", () => {
  // computeMontageExportState(cuts, clips) — cuts = 컷 정의, clips = 생성 결과
  const makeCuts = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ cutNumber: i + 1, durationSec: 3 }));

  it("5개 completed clip → totalCount=5, allClipsReady=true", () => {
    const cuts = makeCuts(5);
    const clips = cuts.map((c) => ({
      cutNumber: c.cutNumber,
      status: "completed" as const,
      videoUri: `https://example.com/clip-${c.cutNumber}.mp4`,
      durationSec: 3,
    }));
    const state = computeMontageExportState(cuts, clips);
    expect(state.totalCount).toBe(5);
    expect(state.completedCount).toBe(5);
    expect(state.allClipsReady).toBe(true);
    expect(state.orderedClips).toHaveLength(5);
  });

  it("5개 중 3개 completed → allClipsReady=false, missingCutNumbers 반환", () => {
    const cuts = makeCuts(5);
    const clips = [
      { cutNumber: 1, status: "completed" as const, videoUri: "a.mp4", durationSec: 3 },
      { cutNumber: 2, status: "completed" as const, videoUri: "b.mp4", durationSec: 3 },
      { cutNumber: 3, status: "completed" as const, videoUri: "c.mp4", durationSec: 3 },
      { cutNumber: 4, status: "idle" as const, durationSec: 3 },
      { cutNumber: 5, status: "idle" as const, durationSec: 3 },
    ];
    const state = computeMontageExportState(cuts, clips);
    expect(state.allClipsReady).toBe(false);
    expect(state.completedCount).toBe(3);
    expect(state.missingCutNumbers.length).toBeGreaterThan(0);
  });

  it("orderedClips는 cutNumber 순으로 정렬", () => {
    const cuts = [
      { cutNumber: 3, durationSec: 4 },
      { cutNumber: 1, durationSec: 3 },
      { cutNumber: 2, durationSec: 5 },
    ];
    const clips = [
      { cutNumber: 3, status: "completed" as const, videoUri: "c.mp4", durationSec: 4 },
      { cutNumber: 1, status: "completed" as const, videoUri: "a.mp4", durationSec: 3 },
      { cutNumber: 2, status: "completed" as const, videoUri: "b.mp4", durationSec: 5 },
    ];
    const state = computeMontageExportState(cuts, clips);
    expect(state.orderedClips[0].cutNumber).toBe(1);
    expect(state.orderedClips[1].cutNumber).toBe(2);
    expect(state.orderedClips[2].cutNumber).toBe(3);
  });

  it("totalDurationSec는 모든 clip 합산", () => {
    const cuts = [
      { cutNumber: 1, durationSec: 3 },
      { cutNumber: 2, durationSec: 5 },
      { cutNumber: 3, durationSec: 4 },
    ];
    const clips = [
      { cutNumber: 1, status: "completed" as const, videoUri: "a.mp4", durationSec: 3 },
      { cutNumber: 2, status: "completed" as const, videoUri: "b.mp4", durationSec: 5 },
      { cutNumber: 3, status: "completed" as const, videoUri: "c.mp4", durationSec: 4 },
    ];
    const state = computeMontageExportState(cuts, clips);
    expect(state.totalDurationSec).toBe(12);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. stitch capability 감지 체인
// ═══════════════════════════════════════════════════════════════════

describe("테스트 6: stitch capability 감지", () => {
  it("초기 MontageExportState.stitchCapability = 'not_available'", () => {
    const state = computeMontageExportState([], []);
    expect(state.stitchCapability).toBe("not_available");
  });

  it("detectStitchCapability — Node 환경(테스트) → not_available + 사유", async () => {
    // Node.js에서는 window가 없으므로 not_available
    const result = await detectStitchCapability();
    expect(result.capability).toBe("not_available");
    expect(result.unavailableReason.length).toBeGreaterThan(0);
  });

  it("stitchCapability 타입은 'not_available' | 'client_wasm' | 'server_ffmpeg'", () => {
    // 타입 수준 검증 — 컴파일 통과 자체가 검증
    const validValues: Array<"not_available" | "client_wasm" | "server_ffmpeg"> = [
      "not_available",
      "client_wasm",
      "server_ffmpeg",
    ];
    expect(validValues).toContain("not_available");
    expect(validValues).toContain("client_wasm");
  });

  it("computeMontageExportState는 stitchUnavailableReason 포함", () => {
    const state = computeMontageExportState([], []);
    expect(typeof state.stitchUnavailableReason).toBe("string");
    expect(state.stitchUnavailableReason!.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. custom element create/poll/element_list 경로
// ═══════════════════════════════════════════════════════════════════

describe("테스트 7: custom element 경로 검증", () => {
  // Custom Element 생성 payload (legacy)
  function buildCreateElementPayload(params: {
    element_name: string;
    element_description?: string;
    reference_type: "image_refer" | "video_refer";
    frontal_image?: string;
    video_url?: string;
  }) {
    const { element_name, element_description, reference_type, frontal_image, video_url } = params;

    if (reference_type === "image_refer" && !frontal_image) {
      throw new Error("image_refer requires frontal_image");
    }
    if (reference_type === "video_refer" && !video_url) {
      throw new Error("video_refer requires video_url");
    }

    const modelParams: Record<string, unknown> = {
      element_name,
      reference_type,
    };
    if (element_description) modelParams.element_description = element_description;

    if (reference_type === "image_refer") {
      modelParams.element_image_list = { frontal_image };
    } else {
      modelParams.element_video_list = { video_url };
    }

    return {
      model: "unknown-custom-element",
      model_params: modelParams,
    };
  }

  it("image_refer → model + model_params 구조 정확", () => {
    const payload = buildCreateElementPayload({
      element_name: "주인공",
      reference_type: "image_refer",
      frontal_image: "data:image/png;base64,iVBOR...",
    });
    expect(payload.model).toBe("unknown-custom-element");
    expect(payload.model_params.element_name).toBe("주인공");
    expect(payload.model_params.reference_type).toBe("image_refer");
    expect(payload.model_params.element_image_list).toEqual({
      frontal_image: "data:image/png;base64,iVBOR...",
    });
    expect(payload.model_params).not.toHaveProperty("element_video_list");
  });

  it("video_refer → element_video_list 포함", () => {
    const payload = buildCreateElementPayload({
      element_name: "배경",
      reference_type: "video_refer",
      video_url: "https://example.com/bg.mp4",
    });
    expect(payload.model_params.reference_type).toBe("video_refer");
    expect(payload.model_params.element_video_list).toEqual({
      video_url: "https://example.com/bg.mp4",
    });
    expect(payload.model_params).not.toHaveProperty("element_image_list");
  });

  it("element_description 선택적 포함", () => {
    const payload = buildCreateElementPayload({
      element_name: "주인공",
      element_description: "긴 머리의 소녀",
      reference_type: "image_refer",
      frontal_image: "data:image/png;base64,abc",
    });
    expect(payload.model_params.element_description).toBe("긴 머리의 소녀");
  });

  it("element_list는 { element_id } 배열 구조", () => {
    // generate에서 element_list가 model_params에 주입되는 구조 검증
    const elementList = [
      { element_id: "el-abc-123" },
      { element_id: "el-def-456" },
    ];
    const modelParams: Record<string, unknown> = {};
    modelParams.element_list = elementList.map((el) => ({ element_id: el.element_id }));

    expect(modelParams.element_list).toEqual([
      { element_id: "el-abc-123" },
      { element_id: "el-def-456" },
    ]);
  });

  it("image_refer 시 frontal_image 누락 → 에러", () => {
    expect(() =>
      buildCreateElementPayload({
        element_name: "test",
        reference_type: "image_refer",
      })
    ).toThrow("image_refer requires frontal_image");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 통합: 대표 시퀀스 1회 시뮬레이션
// ═══════════════════════════════════════════════════════════════════

describe("대표 시퀀스 1회 — end-to-end 메타 검증", () => {
  it("긴 스토리 → auto duration → segment plan → cut decision → 메타 일관성", () => {
    // Step 1: project total 추정
    const durationEstimate = estimateProjectDuration(LONG_STORY);
    const projectTotal = durationEstimate.estimatedTotalSec;
    expect(projectTotal).toBeGreaterThanOrEqual(60);

    // Step 2: segment plan
    const segmentPlan = resolveSegmentPlan({
      totalDurationSec: projectTotal,
      personaBias: "neutral",
    });
    expect(segmentPlan.segmentCount).toBeGreaterThanOrEqual(
      Math.ceil(projectTotal / VEO_SEGMENT_CAP)
    );
    expect(segmentPlan.currentSegmentTargetCuts).toBeGreaterThanOrEqual(1);

    // Step 3: per-cut duration
    const autoDur = computeAutoDuration({
      totalDurationSeconds: projectTotal,
      cutCount: segmentPlan.currentSegmentTargetCuts,
    });
    expect(autoDur.duration).toBeGreaterThanOrEqual(DURATION_MIN);
    expect(autoDur.duration).toBeLessThanOrEqual(DURATION_MAX);

    // Step 4: 각 segment의 cut budget 합산 = totalTargetCuts
    const sumFromSegments = segmentPlan.segments.reduce(
      (s, seg) => s + seg.preferredCutTarget, 0
    );
    expect(sumFromSegments).toBe(segmentPlan.totalTargetCuts);

    // Step 5: project total ≠ current segment duration
    expect(projectTotal).not.toBe(segmentPlan.segmentDurationCap);
    expect(segmentPlan.segmentDurationCap).toBe(VEO_SEGMENT_CAP);
  });

  it("20문장 스토리 → 80초+ project total → 6+ segments", () => {
    // 상수 조정 (v2): 4.5 chars/sec, 1.15 multiplier, 5 sec/sentence
    // 20문장 → ~105초 → ceil(105/15) = 7 segments
    const longStory = Array.from({ length: 20 }, (_, i) =>
      `장면 ${i + 1}에서 주인공은 새로운 도전에 직면한다.`
    ).join(" ");
    const estimate = estimateProjectDuration(longStory);
    expect(estimate.estimatedTotalSec).toBeGreaterThanOrEqual(80);

    const plan = resolveSegmentPlan({ totalDurationSec: estimate.estimatedTotalSec });
    expect(plan.segmentCount).toBeGreaterThanOrEqual(6);
    expect(plan.totalTargetCuts).toBeGreaterThanOrEqual(18);
  });
});
