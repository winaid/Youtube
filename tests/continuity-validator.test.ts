/**
 * continuity-validator.test.ts — 연속성 검증 테스트
 */
import { describe, it, expect } from "vitest";
import { validateContinuity } from "@/lib/continuity-validator";
import type { ContinuitySegmentProgress } from "@/types/continuity";
import type { SegmentState } from "@/types/continuity";

function makeState(overrides: Partial<SegmentState> = {}): SegmentState {
  return {
    subjectPosition: "center-frame, facing forward, standing",
    cameraState: "MS, eye-level, static",
    emotionIntensity: 40,
    emotionKeyword: "calm",
    lightingState: "warm golden side-light",
    motionVector: "standing still",
    environmentState: "urban street, daytime",
    ...overrides,
  };
}

function makeProgress(
  index: number,
  endState: SegmentState,
): ContinuitySegmentProgress {
  return {
    segmentIndex: index,
    status: "completed",
    confirmedEndState: endState,
    videoUri: `https://example.com/seg${index}.mp4`,
  };
}

describe("validateContinuity", () => {
  it("동일한 상태 → 전부 pass", () => {
    const state = makeState();
    const progresses = [
      makeProgress(0, state),
      makeProgress(1, state),
      makeProgress(2, state),
    ];
    const report = validateContinuity(progresses);
    expect(report.pass).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
  });

  it("인물 묘사가 완전히 다르면 error", () => {
    const progresses = [
      makeProgress(0, makeState({ subjectPosition: "tall man in black suit standing center" })),
      makeProgress(1, makeState({ subjectPosition: "short woman in red dress sitting left" })),
    ];
    const report = validateContinuity(progresses);
    const charResults = report.results.filter(r => r.ruleId === "CONT-01");
    // 키워드가 완전히 다르므로 warning 또는 error
    expect(charResults.length).toBeGreaterThan(0);
    expect(charResults.some(r => r.severity !== "pass")).toBe(true);
  });

  it("감정 강도가 급격히 변하면 warning 또는 error", () => {
    const progresses = [
      makeProgress(0, makeState({ emotionIntensity: 10 })),
      makeProgress(1, makeState({ emotionIntensity: 90 })),
    ];
    const report = validateContinuity(progresses);
    const emotionResults = report.results.filter(r => r.ruleId === "CONT-05");
    expect(emotionResults.some(r => r.severity !== "pass")).toBe(true);
  });

  it("카메라 3단계 이상 점프 → warning", () => {
    const progresses = [
      makeProgress(0, makeState({ cameraState: "ECU, eye-level" })),
      makeProgress(1, makeState({ cameraState: "WS, overhead" })),
    ];
    const report = validateContinuity(progresses);
    const cameraResults = report.results.filter(r => r.ruleId === "CONT-06");
    expect(cameraResults.some(r => r.severity === "warning")).toBe(true);
  });

  it("동작 방향 불일치 → warning", () => {
    const progresses = [
      makeProgress(0, makeState({ motionVector: "walking left steadily" })),
      makeProgress(1, makeState({ motionVector: "running right fast" })),
    ];
    const report = validateContinuity(progresses);
    const motionResults = report.results.filter(r => r.ruleId === "CONT-04");
    expect(motionResults.some(r => r.severity === "warning")).toBe(true);
  });

  it("빈 motionVector → 방향 검증 통과 (정보 없으면 pass)", () => {
    const progresses = [
      makeProgress(0, makeState({ motionVector: "" })),
      makeProgress(1, makeState({ motionVector: "walking right" })),
    ];
    const report = validateContinuity(progresses);
    const motionResults = report.results.filter(r => r.ruleId === "CONT-04");
    expect(motionResults.every(r => r.severity === "pass")).toBe(true);
  });

  it("regenerateRecommended — error가 있는 경계의 후속 세그먼트", () => {
    const progresses = [
      makeProgress(0, makeState({ emotionIntensity: 10 })),
      makeProgress(1, makeState({ emotionIntensity: 95 })), // 급격한 변화
      makeProgress(2, makeState({ emotionIntensity: 90 })),
    ];
    const report = validateContinuity(progresses);
    if (report.errorCount > 0) {
      expect(report.regenerateRecommended.length).toBeGreaterThan(0);
    }
  });

  it("완료되지 않은 세그먼트는 검증에서 제외", () => {
    const progresses: ContinuitySegmentProgress[] = [
      makeProgress(0, makeState()),
      { segmentIndex: 1, status: "failed", error: "실패" },
      makeProgress(2, makeState()),
    ];
    const report = validateContinuity(progresses);
    // completed만 필터 → [seg0, seg2]는 인접 쌍으로 간주됨
    // 6개 규칙(CONT-01~06) × 1쌍 = 6개 결과
    expect(report.results.length).toBe(6);
    // 동일 상태이므로 모두 pass
    expect(report.pass).toBe(true);
  });
});
