import { describe, it, expect } from "vitest";
import { recommendMode } from "@/lib/mode-recommendation";

describe("mode-recommendation", () => {
  it("recommends studio for short concept, low runtime", () => {
    const r = recommendMode({
      scriptLength: 40,
      targetRuntimeSec: 30,
      estimatedSegmentCount: 3,
      hasContinuationChaining: false,
    });
    expect(r.mode).toBe("studio");
  });

  it("recommends batch for long script, high runtime", () => {
    const r = recommendMode({
      scriptLength: 500,
      targetRuntimeSec: 180,
      estimatedSegmentCount: 12,
      hasContinuationChaining: true,
    });
    expect(r.mode).toBe("batch");
  });

  it("recommends batch when >= 90s target with continuation", () => {
    const r = recommendMode({
      scriptLength: 200,
      targetRuntimeSec: 120,
      estimatedSegmentCount: 10,
      hasContinuationChaining: true,
    });
    expect(r.mode).toBe("batch");
  });

  it("recommends studio for medium script, low segment count", () => {
    const r = recommendMode({
      scriptLength: 150,
      targetRuntimeSec: 45,
      estimatedSegmentCount: 4,
      hasContinuationChaining: false,
    });
    expect(r.mode).toBe("studio");
  });

  it("provides a reason string", () => {
    const r = recommendMode({
      scriptLength: 500,
      targetRuntimeSec: 180,
      estimatedSegmentCount: 12,
      hasContinuationChaining: true,
    });
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it("returns high confidence when multiple signals agree", () => {
    const r = recommendMode({
      scriptLength: 600,
      targetRuntimeSec: 300,
      estimatedSegmentCount: 20,
      hasContinuationChaining: true,
    });
    expect(r.confidence).toBe("high");
  });
});
