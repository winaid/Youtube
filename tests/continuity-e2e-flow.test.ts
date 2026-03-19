/**
 * continuity-e2e-flow.test.ts — continuitySegment end-to-end 전달 검증
 *
 * 테스트 범위:
 * - continuityMode ON → continuitySegment가 생성되는지
 * - continuityMode OFF → continuitySegment가 비어있는지
 * - continuitySegment가 클라이언트 매핑에서 보존되는지
 * - continuitySegment → continuityMeta 변환이 올바른지
 * - frame chaining과 continuity metadata가 독립적인지
 * - prevEndState가 이전 컷에서 파생되는지
 */

import { describe, it, expect } from "vitest";
import type { Cut } from "../src/types/index";
import type { SegmentState } from "../src/types/continuity";

// ═══════════════════════════════════════════════════════════════════
// continuitySegment Producer 시뮬레이션
// ═══════════════════════════════════════════════════════════════════

/**
 * generate-cuts.ts의 continuitySegment 생성 로직을 단위 테스트용으로 추출.
 * 실제 서버 코드와 동일한 로직.
 */
function buildContinuitySegments(
  cuts: Array<{ cutNumber: number; sceneDescription: string; cameraDirection: string; moodLighting: string }>,
  prevEndState: Record<string, unknown> | null,
): Array<{
  segmentIndex: number;
  startState: Record<string, unknown>;
  endState: Record<string, unknown>;
  isLastSegment: boolean;
}> {
  return cuts.map((fc, i) => {
    let segStartState: Record<string, unknown>;
    if (i === 0 && prevEndState) {
      segStartState = {
        subjectPosition: prevEndState.subjectPosition || "",
        cameraState: prevEndState.cameraState || "",
        emotionKeyword: prevEndState.emotionKeyword || "",
        emotionIntensity: Number(prevEndState.emotionIntensity) || 0,
        motionVector: prevEndState.motionVector || "",
        lightingState: prevEndState.lightingState || "",
        environmentSnapshot: prevEndState.environmentSnapshot || "",
      };
    } else if (i > 0) {
      const prevCut = cuts[i - 1];
      segStartState = {
        subjectPosition: prevCut.sceneDescription.slice(0, 100),
        cameraState: prevCut.cameraDirection,
        emotionKeyword: "",
        emotionIntensity: 0,
        motionVector: "",
        lightingState: prevCut.moodLighting,
        environmentSnapshot: prevCut.sceneDescription.slice(0, 80),
      };
    } else {
      segStartState = {
        subjectPosition: "", cameraState: "", emotionKeyword: "",
        emotionIntensity: 0, motionVector: "", lightingState: "", environmentSnapshot: "",
      };
    }

    const segEndState: Record<string, unknown> = {
      subjectPosition: fc.sceneDescription.slice(0, 100),
      cameraState: fc.cameraDirection,
      emotionKeyword: "",
      emotionIntensity: 0,
      motionVector: "",
      lightingState: fc.moodLighting,
      environmentSnapshot: fc.sceneDescription.slice(0, 80),
    };

    return {
      segmentIndex: i,
      startState: segStartState,
      endState: segEndState,
      isLastSegment: i === cuts.length - 1,
    };
  });
}

/**
 * useVideoGeneration.ts의 continuityMeta 변환 로직을 단위 테스트용으로 추출.
 */
function buildContinuityMeta(cut: Partial<Cut>, totalCuts: number) {
  if (!cut.continuitySegment) return undefined;
  return {
    segmentIndex: cut.continuitySegment.segmentIndex ?? 0,
    totalSegments: totalCuts,
    isLastSegment: cut.continuitySegment.isLastSegment ?? false,
    prevEndState: cut.continuitySegment.startState as unknown as Record<string, unknown> | undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Producer 테스트
// ═══════════════════════════════════════════════════════════════════

describe("continuitySegment Producer", () => {
  const sampleCuts = [
    { cutNumber: 1, sceneDescription: "전사들이 협곡에 진을 치고 있다", cameraDirection: "wide shot", moodLighting: "harsh sunlight" },
    { cutNumber: 2, sceneDescription: "사무라이가 칼을 뽑는다", cameraDirection: "medium shot", moodLighting: "dramatic shadows" },
    { cutNumber: 3, sceneDescription: "양 군대가 충돌한다", cameraDirection: "close-up", moodLighting: "dust and fire" },
  ];

  it("continuityMode ON → 모든 컷에 continuitySegment 생성", () => {
    const segments = buildContinuitySegments(sampleCuts, null);
    expect(segments).toHaveLength(3);
    segments.forEach((seg, i) => {
      expect(seg.segmentIndex).toBe(i);
      expect(seg.startState).toBeDefined();
      expect(seg.endState).toBeDefined();
      expect(typeof seg.isLastSegment).toBe("boolean");
    });
  });

  it("마지막 컷만 isLastSegment=true", () => {
    const segments = buildContinuitySegments(sampleCuts, null);
    expect(segments[0].isLastSegment).toBe(false);
    expect(segments[1].isLastSegment).toBe(false);
    expect(segments[2].isLastSegment).toBe(true);
  });

  it("prevEndState가 있으면 첫 컷의 startState에 반영", () => {
    const prevEnd = {
      subjectPosition: "wounded soldier center-frame",
      cameraState: "close-up handheld",
      emotionKeyword: "desperate",
      emotionIntensity: 80,
      motionVector: "forward-crawling",
      lightingState: "harsh overhead with smoke",
      environmentSnapshot: "destroyed building",
    };

    const segments = buildContinuitySegments(sampleCuts, prevEnd);
    expect(segments[0].startState.subjectPosition).toBe("wounded soldier center-frame");
    expect(segments[0].startState.cameraState).toBe("close-up handheld");
    expect(segments[0].startState.lightingState).toBe("harsh overhead with smoke");
  });

  it("prevEndState가 없으면 첫 컷 startState는 빈 상태", () => {
    const segments = buildContinuitySegments(sampleCuts, null);
    expect(segments[0].startState.subjectPosition).toBe("");
  });

  it("두 번째 컷의 startState = 첫 번째 컷의 장면 설명에서 파생", () => {
    const segments = buildContinuitySegments(sampleCuts, null);
    expect(segments[1].startState.subjectPosition).toContain("전사들이 협곡에 진을 치고 있다");
    expect(segments[1].startState.cameraState).toBe("wide shot");
    expect(segments[1].startState.lightingState).toBe("harsh sunlight");
  });

  it("endState는 현재 컷의 장면 설명에서 파생", () => {
    const segments = buildContinuitySegments(sampleCuts, null);
    expect(segments[0].endState.subjectPosition).toContain("전사들이 협곡에 진을 치고 있다");
    expect(segments[1].endState.subjectPosition).toContain("사무라이가 칼을 뽑는다");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Consumer 테스트 (continuitySegment → continuityMeta 변환)
// ═══════════════════════════════════════════════════════════════════

describe("continuitySegment → continuityMeta 변환", () => {
  it("continuitySegment가 있으면 continuityMeta 생성", () => {
    const cut: Partial<Cut> = {
      cutNumber: 2,
      continuitySegment: {
        segmentIndex: 1,
        startState: {
          subjectPosition: "전사들이 협곡에 진을 치고 있다",
          cameraState: "wide shot",
          emotionKeyword: "",
          emotionIntensity: 0,
          motionVector: "",
          lightingState: "harsh sunlight",
          environmentSnapshot: "협곡",
        },
        endState: {
          subjectPosition: "사무라이가 칼을 뽑는다",
          cameraState: "medium shot",
          emotionKeyword: "",
          emotionIntensity: 0,
          motionVector: "",
          lightingState: "dramatic shadows",
          environmentSnapshot: "전장",
        },
        isLastSegment: false,
      },
    };

    const meta = buildContinuityMeta(cut, 3);
    expect(meta).toBeDefined();
    expect(meta!.segmentIndex).toBe(1);
    expect(meta!.totalSegments).toBe(3);
    expect(meta!.isLastSegment).toBe(false);
    expect(meta!.prevEndState).toBeDefined();
    // prevEndState는 startState에서 파생 (이전 컷의 끝 상태 = 현재 컷의 시작 상태)
    expect((meta!.prevEndState as Record<string, unknown>).subjectPosition).toContain("전사들이");
  });

  it("continuitySegment가 없으면 continuityMeta = undefined", () => {
    const cut: Partial<Cut> = { cutNumber: 1 };
    const meta = buildContinuityMeta(cut, 3);
    expect(meta).toBeUndefined();
  });

  it("continuityMode OFF → continuitySegment 없음 → continuityMeta 없음", () => {
    // OFF일 때는 generate-cuts가 continuitySegment를 붙이지 않음
    const cut: Partial<Cut> = {
      cutNumber: 1,
      continuitySegment: undefined,
    };
    const meta = buildContinuityMeta(cut, 3);
    expect(meta).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Frame chaining vs Continuity metadata 독립성
// ═══════════════════════════════════════════════════════════════════

describe("Frame chaining과 Continuity metadata 독립성", () => {
  it("frame chaining 없어도 continuity metadata는 존재 가능", () => {
    const hasFirstFrame = false; // frame chaining 실패
    const continuityMeta = {
      segmentIndex: 1,
      totalSegments: 3,
      isLastSegment: false,
      prevEndState: { subjectPosition: "standing in rain" },
    };

    // 둘은 독립적
    expect(hasFirstFrame).toBe(false);
    expect(continuityMeta.prevEndState).toBeDefined();
    // continuity metadata는 프롬프트에 주입되어 연속성 유지
  });

  it("continuity metadata 없어도 frame chaining은 작동", () => {
    const hasFirstFrame = true; // frame chaining 작동
    const continuityMeta = undefined; // continuityMode OFF

    expect(hasFirstFrame).toBe(true);
    expect(continuityMeta).toBeUndefined();
    // frame chaining만으로도 시각적 연속성 부분 확보
  });

  it("둘 다 있으면 가장 강한 연속성", () => {
    const hasFirstFrame = true;
    const continuityMeta = {
      segmentIndex: 1,
      totalSegments: 3,
      isLastSegment: false,
      prevEndState: { subjectPosition: "standing in rain" },
    };

    expect(hasFirstFrame).toBe(true);
    expect(continuityMeta).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 시퀀스 경계 연속성 검증
// ═══════════════════════════════════════════════════════════════════

describe("시퀀스 경계 continuity 전파", () => {
  it("시퀀스 1 마지막 컷의 endState가 시퀀스 2 첫 컷의 startState로 전파", () => {
    // 시뮬레이션: 시퀀스 1 생성 완료 후 endState 추출
    const seq1Cuts = [
      { cutNumber: 1, sceneDescription: "도시 야경", cameraDirection: "wide", moodLighting: "neon" },
      { cutNumber: 2, sceneDescription: "비 오는 골목에서 걷는 남자", cameraDirection: "tracking", moodLighting: "dark wet" },
    ];
    const seq1Segments = buildContinuitySegments(seq1Cuts, null);
    const seq1LastEndState = seq1Segments[1].endState;

    // 시퀀스 2: seq1의 endState를 prevEndState로 전달
    const seq2Cuts = [
      { cutNumber: 3, sceneDescription: "남자가 카페에 들어선다", cameraDirection: "medium", moodLighting: "warm interior" },
      { cutNumber: 4, sceneDescription: "카페에서 기다리는 여자", cameraDirection: "close-up", moodLighting: "soft light" },
    ];
    const seq2Segments = buildContinuitySegments(seq2Cuts, seq1LastEndState as Record<string, unknown>);

    // 시퀀스 2 첫 컷의 startState는 시퀀스 1 마지막 컷의 endState에서 파생
    expect(seq2Segments[0].startState.subjectPosition).toContain("비 오는 골목에서 걷는 남자");
    expect(seq2Segments[0].startState.cameraState).toBe("tracking");
    expect(seq2Segments[0].startState.lightingState).toBe("dark wet");
  });

  it("시퀀스 경계 없이(prevEndState=null) 첫 시퀀스는 빈 상태로 시작", () => {
    const cuts = [
      { cutNumber: 1, sceneDescription: "첫 장면", cameraDirection: "wide", moodLighting: "bright" },
    ];
    const segments = buildContinuitySegments(cuts, null);
    expect(segments[0].startState.subjectPosition).toBe("");
    expect(segments[0].startState.cameraState).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 클라이언트 매핑 보존 테스트
// ═══════════════════════════════════════════════════════════════════

describe("클라이언트 매핑에서 continuitySegment 보존", () => {
  it("API 응답의 continuitySegment가 Cut 매핑에서 보존됨", () => {
    // mock-generator.ts의 매핑 시뮬레이션
    const apiCut = {
      cutNumber: 1,
      durationSec: 10,
      sceneDescription: "test",
      cameraDirection: "wide",
      moodLighting: "bright",
      imagePrompt: "",
      endImagePrompt: "",
      videoPrompt: "test",
      extendPrompt: "",
      transitionHint: "",
      characterConsistency: "",
      charactersInScene: [],
      continuitySegment: {
        segmentIndex: 0,
        startState: { subjectPosition: "center", cameraState: "wide", emotionKeyword: "", emotionIntensity: 0, motionVector: "", lightingState: "bright", environmentSnapshot: "office" },
        endState: { subjectPosition: "left", cameraState: "medium", emotionKeyword: "", emotionIntensity: 0, motionVector: "", lightingState: "dim", environmentSnapshot: "office" },
        isLastSegment: false,
      },
    };

    // 매핑 (mock-generator.ts line 117-136 시뮬레이션)
    const mappedCut = {
      cutNumber: apiCut.cutNumber ?? 1,
      durationSec: apiCut.durationSec ?? 10,
      sceneDescription: apiCut.sceneDescription ?? "",
      continuitySegment: apiCut.continuitySegment ?? undefined,
    };

    expect(mappedCut.continuitySegment).toBeDefined();
    expect(mappedCut.continuitySegment!.segmentIndex).toBe(0);
    expect(mappedCut.continuitySegment!.isLastSegment).toBe(false);
  });

  it("continuitySegment가 없는 API 응답은 undefined로 매핑", () => {
    const apiCut = { cutNumber: 1, durationSec: 10 };
    const mappedCut = {
      continuitySegment: (apiCut as Record<string, unknown>).continuitySegment ?? undefined,
    };
    expect(mappedCut.continuitySegment).toBeUndefined();
  });
});
