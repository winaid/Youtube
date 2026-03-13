/**
 * structure-classification.test.ts — cut/scene/sequence 구조 보조 메타 분류 테스트
 *
 * 테스트 대상:
 * 1. classifyDurationClass — duration 기반 분류
 * 2. classifyStructureType — cutCount 기반 분류
 * 3. classifyUnit — 통합 분류
 * 4. classifyCuts — Cut 배열 일괄 분류
 * 5. classifyGroup — 그룹 분류
 * 6. 분류 독립성 — structureType과 durationClass가 분리됨
 * 7. 임계값 경계 — 정확히 경계에서의 동작
 * 8. Canvas roundtrip 보존 — import → export 시 구조 메타 유지
 * 9. Merge export 후 보존 — merge 시 구조 메타 유지
 * 10. 기존 duration/merge 회귀 없음
 */

import { describe, it, expect } from "vitest";
import {
  classifyDurationClass,
  classifyStructureType,
  classifyUnit,
  classifyCuts,
  classifyGroup,
  DURATION_THRESHOLD,
  CUT_COUNT_THRESHOLD,
} from "@/lib/structure-classification";
import { promptOutputToCanvasState } from "@/lib/sequence-to-nodes";
import {
  exportAllChainsToPromptOutput,
  mergeSelectedChainsToOutput,
  findAllChains,
} from "@/lib/nodes-to-sequence";
import type { PromptOutput, Cut } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// helpers
// ═══════════════════════════════════════════════════════════════════

function makeCut(n: number, durationSec = 6, extras: Partial<Cut> = {}): Cut {
  return {
    cutNumber: n,
    durationSec,
    sceneDescription: `Scene ${n}`,
    videoPrompt: `Prompt ${n}`,
    cameraDirection: "pan left",
    moodLighting: "warm",
    imagePrompt: "",
    endImagePrompt: "",
    extendPrompt: "",
    transitionHint: "",
    characterConsistency: "",
    charactersInScene: [],
    ...extras,
  };
}

function makeOutput(cuts: Cut[]): PromptOutput {
  return {
    projectTitle: "Test",
    conceptSummary: "Test summary",
    totalCuts: cuts.length,
    globalStylePrompt: "cinematic",
    directorPersonaPrompt: "action director",
    characterSeeds: [],
    continuityRules: ["rule1"],
    cuts,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. classifyDurationClass
// ═══════════════════════════════════════════════════════════════════

describe("1. classifyDurationClass — duration 기반 분류", () => {
  it("3초는 cut-like", () => {
    expect(classifyDurationClass(3)).toBe("cut-like");
  });

  it("4초는 scene-like", () => {
    expect(classifyDurationClass(4)).toBe("scene-like");
  });

  it("5초는 scene-like", () => {
    expect(classifyDurationClass(5)).toBe("scene-like");
  });

  it("7초는 scene-like", () => {
    expect(classifyDurationClass(7)).toBe("scene-like");
  });

  it("8초는 sequence-like", () => {
    expect(classifyDurationClass(8)).toBe("sequence-like");
  });

  it("15초는 sequence-like", () => {
    expect(classifyDurationClass(15)).toBe("sequence-like");
  });

  it("0초는 cut-like (안전 fallback)", () => {
    expect(classifyDurationClass(0)).toBe("cut-like");
  });

  it("undefined는 cut-like (안전 fallback)", () => {
    expect(classifyDurationClass(undefined)).toBe("cut-like");
  });

  it("null은 cut-like (안전 fallback)", () => {
    expect(classifyDurationClass(null)).toBe("cut-like");
  });

  it("NaN은 cut-like (안전 fallback)", () => {
    expect(classifyDurationClass(NaN)).toBe("cut-like");
  });

  it("음수는 cut-like (안전 fallback)", () => {
    expect(classifyDurationClass(-5)).toBe("cut-like");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. classifyStructureType — cutCount 기반 분류
// ═══════════════════════════════════════════════════════════════════

describe("2. classifyStructureType — cutCount 기반 분류", () => {
  it("1컷은 cut", () => {
    expect(classifyStructureType(1)).toBe("cut");
  });

  it("2컷은 scene", () => {
    expect(classifyStructureType(2)).toBe("scene");
  });

  it("3컷은 sequence", () => {
    expect(classifyStructureType(3)).toBe("sequence");
  });

  it("5컷은 sequence", () => {
    expect(classifyStructureType(5)).toBe("sequence");
  });

  it("0컷은 cut (안전 fallback)", () => {
    expect(classifyStructureType(0)).toBe("cut");
  });

  it("undefined는 cut (안전 fallback)", () => {
    expect(classifyStructureType(undefined)).toBe("cut");
  });

  it("null은 cut (안전 fallback)", () => {
    expect(classifyStructureType(null)).toBe("cut");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. classifyUnit — 통합 분류
// ═══════════════════════════════════════════════════════════════════

describe("3. classifyUnit — 통합 분류", () => {
  it("1컷 3초: cut + cut-like", () => {
    const r = classifyUnit({ durationSec: 3, cutCount: 1 });
    expect(r.structureType).toBe("cut");
    expect(r.durationClass).toBe("cut-like");
  });

  it("2컷 5초: scene + scene-like", () => {
    const r = classifyUnit({ durationSec: 5, cutCount: 2 });
    expect(r.structureType).toBe("scene");
    expect(r.durationClass).toBe("scene-like");
  });

  it("3컷 10초: sequence + sequence-like", () => {
    const r = classifyUnit({ durationSec: 10, cutCount: 3 });
    expect(r.structureType).toBe("sequence");
    expect(r.durationClass).toBe("sequence-like");
  });

  it("두 축이 엇갈릴 수 있다: 1컷 10초 → cut + sequence-like", () => {
    const r = classifyUnit({ durationSec: 10, cutCount: 1 });
    expect(r.structureType).toBe("cut");
    expect(r.durationClass).toBe("sequence-like");
  });

  it("두 축이 엇갈릴 수 있다: 5컷 3초 → sequence + cut-like", () => {
    const r = classifyUnit({ durationSec: 3, cutCount: 5 });
    expect(r.structureType).toBe("sequence");
    expect(r.durationClass).toBe("cut-like");
  });

  it("입력 없으면 cut + cut-like", () => {
    const r = classifyUnit({});
    expect(r.structureType).toBe("cut");
    expect(r.durationClass).toBe("cut-like");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. classifyCuts — Cut 배열 일괄 분류
// ═══════════════════════════════════════════════════════════════════

describe("4. classifyCuts — Cut 배열 일괄 분류", () => {
  it("각 cut에 structureType=cut과 durationClass를 부여한다", () => {
    const cuts = [
      { durationSec: 3, cutNumber: 1 },
      { durationSec: 6, cutNumber: 2 },
      { durationSec: 10, cutNumber: 3 },
    ];
    const result = classifyCuts(cuts);

    expect(result[0].structureType).toBe("cut");
    expect(result[0].durationClass).toBe("cut-like");

    expect(result[1].structureType).toBe("cut");
    expect(result[1].durationClass).toBe("scene-like");

    expect(result[2].structureType).toBe("cut");
    expect(result[2].durationClass).toBe("sequence-like");
  });

  it("원본 필드가 보존된다", () => {
    const cuts = [{ durationSec: 5, cutNumber: 42 }];
    const result = classifyCuts(cuts);
    expect(result[0].cutNumber).toBe(42);
    expect(result[0].durationSec).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. classifyGroup — 그룹 분류
// ═══════════════════════════════════════════════════════════════════

describe("5. classifyGroup — 그룹 분류", () => {
  it("3개 cut 총 15초: sequence + sequence-like", () => {
    const cuts = [{ durationSec: 5 }, { durationSec: 5 }, { durationSec: 5 }];
    const r = classifyGroup(cuts);
    expect(r.structureType).toBe("sequence");
    expect(r.durationClass).toBe("sequence-like");
    expect(r.totalDurationSec).toBe(15);
    expect(r.cutCount).toBe(3);
  });

  it("2개 cut 총 6초: scene + scene-like", () => {
    const cuts = [{ durationSec: 3 }, { durationSec: 3 }];
    const r = classifyGroup(cuts);
    expect(r.structureType).toBe("scene");
    expect(r.durationClass).toBe("scene-like");
    expect(r.totalDurationSec).toBe(6);
  });

  it("1개 cut 3초: cut + cut-like", () => {
    const cuts = [{ durationSec: 3 }];
    const r = classifyGroup(cuts);
    expect(r.structureType).toBe("cut");
    expect(r.durationClass).toBe("cut-like");
  });

  it("빈 배열: cut + cut-like", () => {
    const r = classifyGroup([]);
    expect(r.structureType).toBe("cut");
    expect(r.durationClass).toBe("cut-like");
    expect(r.totalDurationSec).toBe(0);
    expect(r.cutCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. 분류 독립성 — structureType과 durationClass 분리
// ═══════════════════════════════════════════════════════════════════

describe("6. 분류 독립성", () => {
  it("structureType은 duration에 영향받지 않는다", () => {
    expect(classifyStructureType(1)).toBe("cut");
    expect(classifyStructureType(2)).toBe("scene");
    expect(classifyStructureType(3)).toBe("sequence");
    // duration 값과 무관
  });

  it("durationClass는 cutCount에 영향받지 않는다", () => {
    expect(classifyDurationClass(3)).toBe("cut-like");
    expect(classifyDurationClass(5)).toBe("scene-like");
    expect(classifyDurationClass(10)).toBe("sequence-like");
    // cutCount 값과 무관
  });

  it("DURATION_THRESHOLD와 CUT_COUNT_THRESHOLD 상수가 존재한다", () => {
    expect(DURATION_THRESHOLD.sequenceLike).toBe(8);
    expect(DURATION_THRESHOLD.sceneLike).toBe(4);
    expect(CUT_COUNT_THRESHOLD.sequence).toBe(3);
    expect(CUT_COUNT_THRESHOLD.scene).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. 임계값 경계
// ═══════════════════════════════════════════════════════════════════

describe("7. 임계값 경계", () => {
  it("3.99초는 cut-like", () => {
    expect(classifyDurationClass(3.99)).toBe("cut-like");
  });

  it("4.0초는 scene-like", () => {
    expect(classifyDurationClass(4.0)).toBe("scene-like");
  });

  it("7.99초는 scene-like", () => {
    expect(classifyDurationClass(7.99)).toBe("scene-like");
  });

  it("8.0초는 sequence-like", () => {
    expect(classifyDurationClass(8.0)).toBe("sequence-like");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Canvas roundtrip 보존
// ═══════════════════════════════════════════════════════════════════

describe("8. Canvas roundtrip 보존", () => {
  it("structureType/durationClass가 import→export 시 보존된다", () => {
    const output = makeOutput([
      makeCut(1, 3, { structureType: "cut", durationClass: "cut-like" }),
      makeCut(2, 6, { structureType: "scene", durationClass: "scene-like", groupId: "g1" }),
      makeCut(3, 10, { structureType: "sequence", durationClass: "sequence-like", groupId: "g1" }),
    ]);

    const state = promptOutputToCanvasState(output);
    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const cuts = result.output.cuts;
    expect(cuts[0].structureType).toBe("cut");
    expect(cuts[0].durationClass).toBe("cut-like");
    expect(cuts[0].groupId).toBeUndefined(); // groupId 없었으므로

    expect(cuts[1].structureType).toBe("scene");
    expect(cuts[1].durationClass).toBe("scene-like");
    expect(cuts[1].groupId).toBe("g1");

    expect(cuts[2].structureType).toBe("sequence");
    expect(cuts[2].durationClass).toBe("sequence-like");
    expect(cuts[2].groupId).toBe("g1");
  });

  it("구조 메타 없는 cut은 export 시에도 undefined", () => {
    const output = makeOutput([makeCut(1, 5)]);
    const state = promptOutputToCanvasState(output);
    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].structureType).toBeUndefined();
    expect(result.output.cuts[0].durationClass).toBeUndefined();
    expect(result.output.cuts[0].groupId).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Merge export 후 보존
// ═══════════════════════════════════════════════════════════════════

describe("9. Merge export 후 구조 메타 보존", () => {
  it("merge 대상 chain의 structureType/durationClass가 병합 후 유지된다", () => {
    const baseOutput = makeOutput([
      makeCut(1, 3),
      makeCut(2, 6, { structureType: "scene", durationClass: "scene-like" }),
      makeCut(3, 10),
    ]);

    // cut 2를 캔버스에서 편집한 상황 시뮬레이션
    const editOutput = makeOutput([
      makeCut(2, 7, { structureType: "scene", durationClass: "scene-like" }),
    ]);
    const editState = promptOutputToCanvasState(editOutput);
    const chains = findAllChains(editState);

    const result = mergeSelectedChainsToOutput(chains, baseOutput);
    expect(result.success).toBe(true);
    if (!result.success) return;

    // cut 2가 병합되고, structureType/durationClass 보존
    expect(result.output.cuts[1].structureType).toBe("scene");
    expect(result.output.cuts[1].durationClass).toBe("scene-like");

    // 다른 cut은 그대로
    expect(result.output.cuts[0].structureType).toBeUndefined();
    expect(result.output.cuts[2].structureType).toBeUndefined();
  });

  it("merge 시 기존 cut의 structureType은 보존된다 (미수정 cut)", () => {
    const baseOutput = makeOutput([
      makeCut(1, 3, { structureType: "cut", durationClass: "cut-like" }),
      makeCut(2, 6),
    ]);

    const editOutput = makeOutput([makeCut(2, 8)]);
    const editState = promptOutputToCanvasState(editOutput);
    const chains = findAllChains(editState);

    const result = mergeSelectedChainsToOutput(chains, baseOutput);
    expect(result.success).toBe(true);
    if (!result.success) return;

    // cut 1은 건드리지 않았으므로 원본 그대로
    expect(result.output.cuts[0].structureType).toBe("cut");
    expect(result.output.cuts[0].durationClass).toBe("cut-like");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. 기존 duration/merge 회귀 없음
// ═══════════════════════════════════════════════════════════════════

describe("10. 기존 duration/merge 회귀 없음", () => {
  it("durationSec는 구조 메타와 독립적으로 보존된다", () => {
    const output = makeOutput([
      makeCut(1, 4, { structureType: "cut", durationClass: "scene-like" }),
    ]);
    const state = promptOutputToCanvasState(output);
    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].durationSec).toBe(4);
    expect(result.output.cuts[0].durationClass).toBe("scene-like");
  });

  it("videoPrompt/cameraDirection 등 기존 필드가 구조 메타 추가 후에도 정상 보존된다", () => {
    const output = makeOutput([
      makeCut(1, 6, {
        structureType: "scene",
        durationClass: "scene-like",
        cameraDirection: "zoom in",
        moodLighting: "dark blue",
      }),
    ]);
    const state = promptOutputToCanvasState(output);
    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const cut = result.output.cuts[0];
    expect(cut.videoPrompt).toBe("Prompt 1");
    expect(cut.cameraDirection).toBe("zoom in");
    expect(cut.moodLighting).toBe("dark blue");
    expect(cut.structureType).toBe("scene");
  });

  it("merge export에서 mergedCutNumbers/unmatchedChainNodeIds 정상 동작", () => {
    const baseOutput = makeOutput([
      makeCut(1, 3, { structureType: "cut" }),
      makeCut(2, 6, { structureType: "scene" }),
    ]);
    const editOutput = makeOutput([makeCut(1, 4, { structureType: "cut" })]);
    const editState = promptOutputToCanvasState(editOutput);
    const chains = findAllChains(editState);

    const result = mergeSelectedChainsToOutput(chains, baseOutput);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.mergedCutNumbers).toEqual([1]);
    expect(result.unmatchedChainNodeIds).toHaveLength(0);
    expect(result.output.cuts.length).toBe(2);
  });
});
