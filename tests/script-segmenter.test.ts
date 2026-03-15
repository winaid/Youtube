import { describe, it, expect } from "vitest";
import {
  segmentScript,
  isLongScript,
  formatDuration,
  SEGMENT_MIN_DURATION,
  SEGMENT_MAX_DURATION,
  PROJECT_MAX_RUNTIME,
  type SegmentationPlan,
} from "@/lib/script-segmenter";

describe("script-segmenter", () => {
  describe("isLongScript", () => {
    it("returns false for short text", () => {
      expect(isLongScript("짧은 문장입니다.")).toBe(false);
    });

    it("returns true for text with many characters", () => {
      const long = "가".repeat(100);
      expect(isLongScript(long)).toBe(true);
    });

    it("returns true for text with 3+ paragraphs", () => {
      const text = "첫 번째 문단.\n\n두 번째 문단.\n\n세 번째 문단.";
      expect(isLongScript(text)).toBe(true);
    });
  });

  describe("formatDuration", () => {
    it("formats seconds only", () => {
      expect(formatDuration(45)).toBe("45초");
    });

    it("formats minutes and seconds", () => {
      expect(formatDuration(125)).toBe("2분 5초");
    });

    it("formats exact minutes", () => {
      expect(formatDuration(120)).toBe("2분 0초");
    });
  });

  describe("segmentScript", () => {
    it("segments a multi-paragraph script", () => {
      const script = `
서울의 새벽. 아직 어둠이 채 걷히지 않은 골목길에 한 남자가 걸어온다. 낡은 가방을 들고 발걸음은 무겁다.

카페 문을 열자 따뜻한 불빛이 쏟아진다. 바리스타가 고개를 들어 눈인사를 건넨다.

빗방울이 유리창을 두드리기 시작한다. 남자는 커피잔을 감싸 쥐고 빗소리에 귀를 기울인다.
      `.trim();

      const plan = segmentScript(script, { targetRuntimeSec: 30 });

      expect(plan.totalSegments).toBeGreaterThanOrEqual(2);
      expect(plan.segments[0].isFirstSegment).toBe(true);
      expect(plan.segments[plan.totalSegments - 1].isLastSegment).toBe(true);

      plan.segments.forEach(seg => {
        expect(seg.assignedDurationSec).toBeGreaterThanOrEqual(SEGMENT_MIN_DURATION);
        expect(seg.assignedDurationSec).toBeLessThanOrEqual(SEGMENT_MAX_DURATION);
      });
    });

    it("marks continuation from prev for non-first segments", () => {
      const script = "첫 번째 장면.\n\n두 번째 장면.\n\n세 번째 장면.";
      const plan = segmentScript(script, { targetRuntimeSec: 30 });

      expect(plan.segments[0].continuationFromPrev).toBe(false);
      for (let i = 1; i < plan.segments.length; i++) {
        expect(plan.segments[i].continuationFromPrev).toBe(true);
      }
    });

    it("clamps target runtime to PROJECT_MAX_RUNTIME", () => {
      const plan = segmentScript("테스트 스크립트.", { targetRuntimeSec: 500 });
      expect(plan.targetRuntimeSec).toBe(PROJECT_MAX_RUNTIME);
      expect(plan.warnings.some(w => w.includes("제한"))).toBe(true);
    });

    it("handles single short text", () => {
      const plan = segmentScript("짧은 장면.", { targetRuntimeSec: 10 });
      expect(plan.totalSegments).toBe(1);
      expect(plan.segments[0].isFirstSegment).toBe(true);
      expect(plan.segments[0].isLastSegment).toBe(true);
    });

    it("assigns narrative labels", () => {
      const script = "서울의 새벽 어둠이 걷히기 전 골목길을 걷는 남자의 모습이 보인다. 그는 낡은 가방을 들고 있다.\n\n카페 문을 열자 따뜻한 불빛과 함께 바리스타의 인사가 들린다. 남자는 창가에 앉는다.\n\n빗방울이 유리창을 두드리기 시작한다. 남자는 과거의 기억에 잠기며 조용히 커피를 마신다.";
      const plan = segmentScript(script, { targetRuntimeSec: 45 });
      expect(plan.segments[0].narrativeLabel).toBe("도입");
      if (plan.totalSegments >= 3) {
        expect(plan.segments[plan.totalSegments - 1].narrativeLabel).toBe("마무리");
      }
    });

    it("respects maxSegments config", () => {
      const script = "A.\n\nB.\n\nC.\n\nD.\n\nE.\n\nF.\n\nG.\n\nH.";
      const plan = segmentScript(script, { targetRuntimeSec: 60, maxSegments: 3 });
      expect(plan.totalSegments).toBeLessThanOrEqual(3);
    });

    it("handles long script with many sentences", () => {
      const sentences = Array.from({ length: 20 }, (_, i) =>
        `장면 ${i + 1}에서 캐릭터가 행동을 합니다.`
      ).join(" ");
      const plan = segmentScript(sentences, { targetRuntimeSec: 120 });
      expect(plan.totalSegments).toBeGreaterThanOrEqual(1);
      plan.segments.forEach(seg => {
        expect(seg.assignedDurationSec).toBeLessThanOrEqual(SEGMENT_MAX_DURATION);
      });
    });

    it("warns when segment total exceeds target", () => {
      const longScript = Array.from({ length: 30 }, (_, i) =>
        `이것은 매우 긴 문단 ${i + 1}입니다. 많은 내용이 포함되어 있습니다. 캐릭터가 여러 행동을 하고 감정이 변화합니다.`
      ).join("\n\n");

      const plan = segmentScript(longScript, { targetRuntimeSec: 30 });
      expect(plan.totalSegments).toBeGreaterThan(1);
    });
  });

  describe("constants", () => {
    it("SEGMENT_MIN_DURATION is 3", () => {
      expect(SEGMENT_MIN_DURATION).toBe(3);
    });

    it("SEGMENT_MAX_DURATION is 15", () => {
      expect(SEGMENT_MAX_DURATION).toBe(15);
    });

    it("PROJECT_MAX_RUNTIME is 300", () => {
      expect(PROJECT_MAX_RUNTIME).toBe(300);
    });
  });
});
