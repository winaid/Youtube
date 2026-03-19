/**
 * three-layer-model.test.ts — 3-Layer 런타임 모델 검증
 *
 * Layer 1: 총 요청 런타임 (e.g. 48s) — 배치/컨테이너 예산
 * Layer 2: 시퀀스 (8–15s) — Kling 1회 생성 단위
 * Layer 3: 시퀀스 내 멀티샷 (최대 6) — multi-shot-planner가 관리
 */

import { describe, it, expect } from "vitest";
import {
  recommendMinimumCutCount,
  recommendCutCountRange,
  densifyCuts,
  KLING_SEGMENT_CAP,
  SEQUENCE_MIN_DURATION,
} from "@/lib/sequence-density";
import { buildDefaultMultiShot, shouldForceMultiShot } from "@/lib/multi-shot-planner";
import { getMaxShots } from "@/lib/kling-capability";

const MODEL = "kling-o3-text-to-video";

// ═══════════════════════════════════════════════════════════════════
// Layer 1 → Layer 2: 총 런타임 → 시퀀스 분할
// ═══════════════════════════════════════════════════════════════════

describe("Layer 1→2: 총 런타임 → 시퀀스 수", () => {
  it("SEQUENCE_MIN_DURATION = 8", () => {
    expect(SEQUENCE_MIN_DURATION).toBe(8);
  });

  it("KLING_SEGMENT_CAP = 15", () => {
    expect(KLING_SEGMENT_CAP).toBe(15);
  });

  it("15초 이하 → 숏폼 리듬 정책 반영", () => {
    expect(recommendMinimumCutCount(8)).toBe(3);   // 6-9초: min 3
    expect(recommendMinimumCutCount(10)).toBe(4);  // 10-15초: min 4
    expect(recommendMinimumCutCount(12)).toBe(4);  // 10-15초: min 4
    expect(recommendMinimumCutCount(15)).toBe(4);  // 10-15초: min 4
  });

  it("48초 → 4 시퀀스 (ceil(48/15))", () => {
    expect(recommendMinimumCutCount(48)).toBe(4);
  });

  it("120초 → 8 시퀀스 (ceil(120/15))", () => {
    expect(recommendMinimumCutCount(120)).toBe(8);
  });

  it("60초 → 4 시퀀스", () => {
    expect(recommendMinimumCutCount(60)).toBe(4);
  });

  it("30초 → 최소 4 (segment-aware: max(4, ceil(30/15)))", () => {
    expect(recommendMinimumCutCount(30)).toBe(4);
  });

  it("300초 → 20 시퀀스 (5분 = 배치 예산 한도)", () => {
    expect(recommendMinimumCutCount(300)).toBe(20);
  });
});

describe("Layer 1→2: recommendCutCountRange", () => {
  it("15초 → {4, 6} 시퀀스 내부 밀도 범위 (숏폼 리듬)", () => {
    const range = recommendCutCountRange(15);
    expect(range.min).toBe(4);
    expect(range.max).toBe(6);
  });

  it("48초 → 3 full segments × {4,6} + 1 remainder (3s, {1,2})", () => {
    const range = recommendCutCountRange(48);
    // 3 full segments (15s each, range {4,6}) + 1 remainder (3s, range {1,2})
    expect(range.min).toBe(3 * 4 + 1); // 13
    expect(range.max).toBe(3 * 6 + 2); // 20
  });

  it("120초 → 8 segments × {4,6}", () => {
    const range = recommendCutCountRange(120);
    expect(range.min).toBe(8 * 4); // 32
    expect(range.max).toBe(8 * 6); // 48
  });
});

// ═══════════════════════════════════════════════════════════════════
// densifyCuts: 시퀀스를 SEQUENCE_MIN_DURATION 미만으로 분할하지 않음
// ═══════════════════════════════════════════════════════════════════

describe("densifyCuts: 숏폼 리듬 분할", () => {
  it("단일 15초 시퀀스 → 4컷 분할 (숏폼 리듬: min=4)", () => {
    const cuts = [{ durationSec: 15 }];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(4);
    const total = result.reduce((s, c) => s + c.durationSec, 0);
    expect(total).toBe(15);
  });

  it("단일 12초 시퀀스 → 4컷 분할 (숏폼 리듬: 10-15초 min=4)", () => {
    const cuts = [{ durationSec: 12 }];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(4);
  });

  it("단일 8초 시퀀스 → 3컷 분할 (short band: 6-9s min=3)", () => {
    const cuts = [{ durationSec: 8 }];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(3);
  });

  it("단일 16초 시퀀스 → 4컷 분할 (max(4, ceil(16/15))=4)", () => {
    const cuts = [{ durationSec: 16 }];
    const result = densifyCuts(cuts, 16);
    expect(result.length).toBe(4);
    const total = result.reduce((s, c) => s + c.durationSec, 0);
    expect(total).toBe(16);
  });

  it("단일 20초 시퀀스 → 4컷 분할 (max(4, ceil(20/15))=4)", () => {
    const cuts = [{ durationSec: 20 }];
    const result = densifyCuts(cuts, 20);
    expect(result.length).toBe(4);
  });

  it("3 × 15s = 45s → 분할 필요 (3 < max(4, ceil(45/15))=4)", () => {
    const cuts = [
      { durationSec: 15 },
      { durationSec: 15 },
      { durationSec: 15 },
    ];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(4);
  });

  it("2 × 15s = 30s, 필요 최소=4 → 2컷 추가 분할", () => {
    const cuts = [{ durationSec: 15 }, { durationSec: 15 }];
    const result = densifyCuts(cuts);
    expect(result.length).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Layer 2 → Layer 3: 시퀀스 내 멀티샷
// ═══════════════════════════════════════════════════════════════════

describe("Layer 2→3: 시퀀스 내부 멀티샷", () => {
  it("12초 cinematic_sequence → 강제 멀티샷", () => {
    expect(shouldForceMultiShot("cinematic_sequence", 12, MODEL)).toBe(true);
  });

  it("12초 시퀀스 → 내부 3-6 멀티샷", () => {
    const shots = buildDefaultMultiShot({
      durationSec: 12,
      sceneType: "cinematic_sequence",
      basePrompt: "test",
      modelId: MODEL,
    });
    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(shots.length).toBeLessThanOrEqual(6);
  });

  it("15초 environment → 내부 4-6 멀티샷", () => {
    const shots = buildDefaultMultiShot({
      durationSec: 15,
      sceneType: "environment",
      basePrompt: "test",
      modelId: MODEL,
    });
    expect(shots.length).toBeGreaterThanOrEqual(4);
    expect(shots.length).toBeLessThanOrEqual(6);
  });

  it("8초 시퀀스 → maxShots ≥ 2", () => {
    expect(getMaxShots(MODEL, 8)).toBeGreaterThanOrEqual(2);
  });

  it("멀티샷 duration 합 = 시퀀스 duration", () => {
    const shots = buildDefaultMultiShot({
      durationSec: 12,
      sceneType: "cinematic_sequence",
      basePrompt: "test",
      modelId: MODEL,
    });
    const total = shots.reduce((s, sh) => s + parseInt(sh.duration, 10), 0);
    expect(total).toBe(12);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Edge Case: 48초 시나리오
// ═══════════════════════════════════════════════════════════════════

describe("48초 시나리오: 3-Layer 전체 흐름", () => {
  it("48초 → 4 시퀀스 (12s × 4)", () => {
    // 48초 총 런타임 → ceil(48/15) = 4 시퀀스
    expect(recommendMinimumCutCount(48)).toBe(4);
  });

  it("4 × 12s 시퀀스 → densifyCuts 분할 불필요", () => {
    const cuts = [
      { durationSec: 12 },
      { durationSec: 12 },
      { durationSec: 12 },
      { durationSec: 12 },
    ];
    const result = densifyCuts(cuts, 48);
    expect(result.length).toBe(4); // 이미 충분
  });

  it("각 12s 시퀀스 → 내부 3-6 멀티샷", () => {
    for (let i = 0; i < 4; i++) {
      const shots = buildDefaultMultiShot({
        durationSec: 12,
        sceneType: "cinematic_sequence",
        basePrompt: `Sequence ${i + 1}`,
        modelId: MODEL,
      });
      expect(shots.length).toBeGreaterThanOrEqual(3);
      expect(shots.length).toBeLessThanOrEqual(6);
    }
  });

  it("48초 전체: 4시퀀스 × ~3.5샷 = ~14 내부 멀티샷 (마이크로컷이 아님)", () => {
    const totalShots = Array.from({ length: 4 }, (_, i) =>
      buildDefaultMultiShot({
        durationSec: 12,
        sceneType: "cinematic_sequence",
        basePrompt: `Seq ${i}`,
        modelId: MODEL,
      }).length,
    ).reduce((s, n) => s + n, 0);

    expect(totalShots).toBeGreaterThanOrEqual(12); // 4 × 3
    expect(totalShots).toBeLessThanOrEqual(24); // 4 × 6
  });
});
