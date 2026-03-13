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

// ═══════════════════════════════════════════════════════════════════
// 11. classifyCuts 기존 값 보존 정책
// ═══════════════════════════════════════════════════════════════════

describe("11. classifyCuts 기존 값 보존 정책", () => {
  it("기존 structureType/durationClass가 없으면 자동 부여한다", () => {
    const cuts = [
      { durationSec: 3, cutNumber: 1 },
      { durationSec: 6, cutNumber: 2 },
      { durationSec: 10, cutNumber: 3 },
    ];
    const result = classifyCuts(cuts);

    expect(result[0].structureType).toBe("cut");
    expect(result[0].durationClass).toBe("cut-like");
    expect(result[1].durationClass).toBe("scene-like");
    expect(result[2].durationClass).toBe("sequence-like");
  });

  it("기존 structureType이 있으면 덮어쓰지 않는다", () => {
    const cuts = [
      { durationSec: 3, cutNumber: 1, structureType: "scene" as const },
    ];
    const result = classifyCuts(cuts);
    expect(result[0].structureType).toBe("scene"); // "cut"으로 덮어쓰지 않음
  });

  it("기존 durationClass가 있으면 덮어쓰지 않는다", () => {
    const cuts = [
      { durationSec: 3, cutNumber: 1, durationClass: "sequence-like" as const },
    ];
    const result = classifyCuts(cuts);
    expect(result[0].durationClass).toBe("sequence-like"); // 3초지만 기존 값 유지
  });

  it("structureType만 있고 durationClass 없으면 durationClass만 자동 부여", () => {
    const cuts = [
      { durationSec: 6, cutNumber: 1, structureType: "scene" as const },
    ];
    const result = classifyCuts(cuts);
    expect(result[0].structureType).toBe("scene");
    expect(result[0].durationClass).toBe("scene-like"); // 자동 부여
  });

  it("durationClass만 있고 structureType 없으면 structureType만 자동 부여", () => {
    const cuts = [
      { durationSec: 6, cutNumber: 1, durationClass: "scene-like" as const },
    ];
    const result = classifyCuts(cuts);
    expect(result[0].structureType).toBe("cut"); // 자동 부여
    expect(result[0].durationClass).toBe("scene-like"); // 유지
  });

  it("groupId는 건드리지 않는다 — undefined 유지", () => {
    const cuts = [{ durationSec: 6, cutNumber: 1 }];
    const result = classifyCuts(cuts);
    expect((result[0] as Record<string, unknown>).groupId).toBeUndefined();
  });

  it("groupId는 건드리지 않는다 — 기존 값 유지", () => {
    const cuts = [{ durationSec: 6, cutNumber: 1, groupId: "g1" }];
    const result = classifyCuts(cuts);
    expect((result[0] as Record<string, unknown>).groupId).toBe("g1");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. generate-cuts 후처리 시뮬레이션 — 실제 경로와 동일한 패턴
// ═══════════════════════════════════════════════════════════════════

describe("12. generate-cuts 후처리 시뮬레이션", () => {
  it("API 응답 형태의 raw cut에 classifyCuts 적용 시 올바른 분류 부여", () => {
    // API 응답 시뮬레이션 (structureType/durationClass 없음)
    const apiCuts: Cut[] = [
      makeCut(1, 3),
      makeCut(2, 5),
      makeCut(3, 8),
      makeCut(4, 12),
    ];
    const classified = classifyCuts(apiCuts);

    expect(classified[0].structureType).toBe("cut");
    expect(classified[0].durationClass).toBe("cut-like");

    expect(classified[1].structureType).toBe("cut");
    expect(classified[1].durationClass).toBe("scene-like");

    expect(classified[2].structureType).toBe("cut");
    expect(classified[2].durationClass).toBe("sequence-like");

    expect(classified[3].structureType).toBe("cut");
    expect(classified[3].durationClass).toBe("sequence-like");
  });

  it("fallback cut (기본 8초)에도 올바른 분류 부여", () => {
    const fallbackCuts: Cut[] = [makeCut(1, 8), makeCut(2, 8), makeCut(3, 8)];
    const classified = classifyCuts(fallbackCuts);

    for (const cut of classified) {
      expect(cut.structureType).toBe("cut");
      expect(cut.durationClass).toBe("sequence-like"); // 8초 → sequence-like
    }
  });

  it("이미 분류된 cut에 재적용해도 값이 변하지 않는다 (멱등성)", () => {
    const cuts: Cut[] = [
      makeCut(1, 5, { structureType: "scene", durationClass: "scene-like" }),
    ];
    const first = classifyCuts(cuts);
    const second = classifyCuts(first);

    expect(second[0].structureType).toBe("scene");
    expect(second[0].durationClass).toBe("scene-like");
  });

  it("분류 후에도 기존 Cut 필드가 모두 보존된다", () => {
    const cuts: Cut[] = [
      makeCut(1, 6, {
        shotCategory: "character-driven",
        characterRole: "protagonist",
        cameraDirection: "zoom in",
        moodLighting: "warm sunset",
      }),
    ];
    const classified = classifyCuts(cuts);
    const c = classified[0];

    expect(c.cutNumber).toBe(1);
    expect(c.durationSec).toBe(6);
    expect(c.videoPrompt).toBe("Prompt 1");
    expect(c.shotCategory).toBe("character-driven");
    expect(c.characterRole).toBe("protagonist");
    expect(c.cameraDirection).toBe("zoom in");
    expect(c.moodLighting).toBe("warm sunset");
    expect(c.structureType).toBe("cut");
    expect(c.durationClass).toBe("scene-like");
  });

  it("classifyCuts 후 roundtrip (import→export) 시 메타 유지", () => {
    const cuts: Cut[] = [makeCut(1, 3), makeCut(2, 8)];
    const classified = classifyCuts(cuts);
    const output = makeOutput(classified);

    const state = promptOutputToCanvasState(output);
    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.output.cuts[0].structureType).toBe("cut");
    expect(result.output.cuts[0].durationClass).toBe("cut-like");
    expect(result.output.cuts[1].structureType).toBe("cut");
    expect(result.output.cuts[1].durationClass).toBe("sequence-like");
  });

  it("classifyCuts 후 merge export 시 분류 메타 유지", () => {
    const baseCuts: Cut[] = classifyCuts([makeCut(1, 3), makeCut(2, 5), makeCut(3, 10)]);
    const baseOutput = makeOutput(baseCuts);

    // cut 2 편집 시뮬레이션
    const editCuts: Cut[] = classifyCuts([makeCut(2, 7)]);
    const editOutput = makeOutput(editCuts);
    const editState = promptOutputToCanvasState(editOutput);
    const chains = findAllChains(editState);

    const result = mergeSelectedChainsToOutput(chains, baseOutput);
    expect(result.success).toBe(true);
    if (!result.success) return;

    // 병합된 cut 2
    expect(result.output.cuts[1].structureType).toBe("cut");
    expect(result.output.cuts[1].durationClass).toBe("scene-like");

    // 건드리지 않은 cut 1, 3
    expect(result.output.cuts[0].structureType).toBe("cut");
    expect(result.output.cuts[0].durationClass).toBe("cut-like");
    expect(result.output.cuts[2].structureType).toBe("cut");
    expect(result.output.cuts[2].durationClass).toBe("sequence-like");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. UI 표시용 구조 메타 존재 검증
// ═══════════════════════════════════════════════════════════════════

describe("13. UI 표시용 구조 메타 존재 검증", () => {
  it("classifyCuts 적용 후 모든 cut에 structureType/durationClass가 존재한다", () => {
    const cuts: Cut[] = [makeCut(1, 3), makeCut(2, 6), makeCut(3, 10)];
    const classified = classifyCuts(cuts);

    for (const cut of classified) {
      expect(cut.structureType).toBeDefined();
      expect(cut.durationClass).toBeDefined();
      // UI에서 .toUpperCase() 호출 가능
      expect(cut.structureType.toUpperCase()).toBeTruthy();
      expect(cut.durationClass).toBeTruthy();
    }
  });

  it("값이 없는 cut에서는 structureType/durationClass가 undefined — UI에서 조건부 숨김 가능", () => {
    const rawCut = makeCut(1, 5);
    expect(rawCut.structureType).toBeUndefined();
    expect(rawCut.durationClass).toBeUndefined();
  });

  it("roundtrip 후에도 UI 표시용 값이 유지된다", () => {
    const classified = classifyCuts([makeCut(1, 3), makeCut(2, 8)]);
    const output = makeOutput(classified);
    const state = promptOutputToCanvasState(output);
    const result = exportAllChainsToPromptOutput(state);
    expect(result.success).toBe(true);
    if (!result.success) return;

    for (const cut of result.output.cuts) {
      expect(cut.structureType).toBeDefined();
      expect(cut.durationClass).toBeDefined();
    }
  });

  it("merge 후에도 수정된 cut의 UI 표시용 값이 유지된다", () => {
    const base = makeOutput(classifyCuts([makeCut(1, 3), makeCut(2, 6)]));
    const edit = makeOutput(classifyCuts([makeCut(1, 10)]));
    const editState = promptOutputToCanvasState(edit);
    const chains = findAllChains(editState);

    const result = mergeSelectedChainsToOutput(chains, base);
    expect(result.success).toBe(true);
    if (!result.success) return;

    // 병합된 cut 1: 10초 → sequence-like
    expect(result.output.cuts[0].structureType).toBe("cut");
    expect(result.output.cuts[0].durationClass).toBe("sequence-like");
    // 미수정 cut 2
    expect(result.output.cuts[1].structureType).toBe("cut");
    expect(result.output.cuts[1].durationClass).toBe("scene-like");
  });

  it("cut 편집(필드 업데이트) 시 구조 메타는 spread로 보존된다", () => {
    const classified = classifyCuts([makeCut(1, 6)]);
    const cut = classified[0];

    // CutCard의 handleFieldSave 패턴 시뮬레이션
    const updated = { ...cut, videoPrompt: "새로운 프롬프트" };
    expect(updated.structureType).toBe("cut");
    expect(updated.durationClass).toBe("scene-like");
    expect(updated.videoPrompt).toBe("새로운 프롬프트");
  });

  it("cut 삭제/재정렬 후 남은 cut의 구조 메타가 유지된다", () => {
    const classified = classifyCuts([makeCut(1, 3), makeCut(2, 6), makeCut(3, 10)]);

    // cut 2 삭제 시뮬레이션
    const afterDelete = classified.filter(c => c.cutNumber !== 2);
    expect(afterDelete[0].structureType).toBe("cut");
    expect(afterDelete[0].durationClass).toBe("cut-like");
    expect(afterDelete[1].structureType).toBe("cut");
    expect(afterDelete[1].durationClass).toBe("sequence-like");

    // 재정렬 시뮬레이션 (reverse)
    const reordered = [...classified].reverse();
    expect(reordered[0].durationClass).toBe("sequence-like");
    expect(reordered[1].durationClass).toBe("scene-like");
    expect(reordered[2].durationClass).toBe("cut-like");
  });
});
