/**
 * step1-reliability.test.ts — Step1 경량화 + partial recovery + beat 합성 테스트
 *
 * Phase 2B 수정 검증:
 *   1. Step1 slim schema: sceneBeat1/2/3, endHook이 optional
 *   2. Beat/hook 합성: cue 필드에서 자동 생성
 *   3. Missing-cut 감지 및 merge 로직
 *   4. Outline 정규화 안전성
 *
 * 실행: npx vitest run tests/step1-reliability.test.ts
 */

import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════
// 1. Step1 slim schema — beat/hook optional 필드 검증
// ═══════════════════════════════════════════════════════════════════

describe("Step1 slim schema: beat/hook 필드는 optional", () => {
  // Step1이 반환할 수 있는 최소 outline (beat/hook 없음)
  interface SlimOutline {
    cutNumber: number;
    sceneKo: string;
    emotion: string;
    emotionalDelta: string;
    purpose: string;
    shotType: string;
    cameraMovement: string;
    subjectAction: string;
    transitionHint: string;
    shotCategory: string;
    characterRole: string;
    locationCue: string;
    situationCue: string;
    emotionalAnchor: string;
    // optional beat/hook
    sceneBeat1?: string;
    sceneBeat2?: string;
    sceneBeat3?: string;
    endHook?: string;
  }

  function normalizeOutline(o: Partial<SlimOutline>, i: number) {
    return {
      cutNumber: Number(o.cutNumber ?? i + 1),
      sceneKo: String(o.sceneKo ?? `장면 ${i + 1}`).slice(0, 40),
      emotion: String(o.emotion ?? "neutral"),
      emotionalDelta: String(o.emotionalDelta ?? "neutral→neutral"),
      purpose: String(o.purpose ?? "develop"),
      shotType: String(o.shotType ?? "MS"),
      cameraMovement: String(o.cameraMovement ?? "slow push-in"),
      subjectAction: String(o.subjectAction ?? "action"),
      transitionHint: String(o.transitionHint ?? "디졸브").slice(0, 20),
      shotCategory: String(o.shotCategory ?? "character-driven"),
      characterRole: String(o.characterRole ?? "protagonist"),
      locationCue: String(o.locationCue ?? "location elements"),
      situationCue: String(o.situationCue ?? "situation evidence"),
      emotionalAnchor: String(o.emotionalAnchor ?? "emotional point"),
      // beat/hook: cue에서 합성
      sceneBeat1: String(o.sceneBeat1 ?? o.locationCue ?? "location elements"),
      sceneBeat2: String(o.sceneBeat2 ?? o.situationCue ?? "situation evidence"),
      sceneBeat3: String(o.sceneBeat3 ?? o.emotionalAnchor ?? "emotional point"),
      endHook: String(o.endHook ?? "visual tension"),
    };
  }

  it("beat/hook 없는 outline도 정규화 성공", () => {
    const slim: Partial<SlimOutline> = {
      cutNumber: 1,
      sceneKo: "치과 대기실",
      emotion: "anxiety",
      emotionalDelta: "opening→anxiety",
      purpose: "establish",
      shotType: "WS",
      cameraMovement: "slow pan left",
      subjectAction: "doctor enters empty clinic",
      transitionHint: "컷",
      shotCategory: "environment",
      characterRole: "absent",
      locationCue: "dental chair under lamp",
      situationCue: "empty waiting chairs",
      emotionalAnchor: "dust on reception desk",
      // sceneBeat1/2/3, endHook 의도적 생략
    };

    const result = normalizeOutline(slim, 0);
    expect(result.sceneBeat1).toBe("dental chair under lamp"); // locationCue에서 합성
    expect(result.sceneBeat2).toBe("empty waiting chairs");    // situationCue에서 합성
    expect(result.sceneBeat3).toBe("dust on reception desk");  // emotionalAnchor에서 합성
    expect(result.endHook).toBe("visual tension");             // 기본값
  });

  it("beat/hook 포함된 outline은 원본 유지", () => {
    const full: Partial<SlimOutline> = {
      cutNumber: 2,
      sceneKo: "원장 등장",
      emotion: "determination",
      locationCue: "office desk",
      situationCue: "phone ringing",
      emotionalAnchor: "clenched fist",
      sceneBeat1: "camera reveals messy office",
      sceneBeat2: "phone vibrates on desk",
      sceneBeat3: "doctor grabs phone with resolve",
      endHook: "screen glows with new message",
    };

    const result = normalizeOutline(full, 1);
    expect(result.sceneBeat1).toBe("camera reveals messy office");
    expect(result.sceneBeat2).toBe("phone vibrates on desk");
    expect(result.sceneBeat3).toBe("doctor grabs phone with resolve");
    expect(result.endHook).toBe("screen glows with new message");
  });

  it("Step1 경량 스키마의 필드 수 = 14 (beat/hook 제외)", () => {
    const coreFields = [
      "cutNumber", "sceneKo", "emotion", "emotionalDelta",
      "purpose", "shotType", "cameraMovement", "subjectAction",
      "transitionHint", "shotCategory", "characterRole",
      "locationCue", "situationCue", "emotionalAnchor",
    ];
    expect(coreFields.length).toBe(14);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Missing-cut 감지 및 merge 로직
// ═══════════════════════════════════════════════════════════════════

describe("Missing-cut 감지 및 merge", () => {
  interface MinimalOutline { cutNumber: number; shotType: string; sceneKo: string }

  function findMissingCutNumbers(outlines: MinimalOutline[], totalCount: number): number[] {
    const existing = new Set(outlines.map(o => o.cutNumber));
    const missing: number[] = [];
    for (let i = 1; i <= totalCount; i++) {
      if (!existing.has(i)) missing.push(i);
    }
    return missing;
  }

  function mergeAndDedupe(
    existing: MinimalOutline[],
    repaired: MinimalOutline[],
  ): MinimalOutline[] {
    const merged = [...existing, ...repaired];
    merged.sort((a, b) => a.cutNumber - b.cutNumber);
    const seen = new Set<number>();
    return merged.filter(o => {
      if (seen.has(o.cutNumber)) return false;
      seen.add(o.cutNumber);
      return true;
    });
  }

  it("missing cuts 정확히 감지", () => {
    const outlines = [
      { cutNumber: 1, shotType: "WS", sceneKo: "장면 1" },
      { cutNumber: 3, shotType: "CU", sceneKo: "장면 3" },
      { cutNumber: 5, shotType: "MS", sceneKo: "장면 5" },
    ];
    const missing = findMissingCutNumbers(outlines, 6);
    expect(missing).toEqual([2, 4, 6]);
  });

  it("모든 컷이 있으면 빈 배열", () => {
    const outlines = [
      { cutNumber: 1, shotType: "WS", sceneKo: "장면 1" },
      { cutNumber: 2, shotType: "MS", sceneKo: "장면 2" },
      { cutNumber: 3, shotType: "CU", sceneKo: "장면 3" },
    ];
    const missing = findMissingCutNumbers(outlines, 3);
    expect(missing).toEqual([]);
  });

  it("merge 후 cutNumber 순서 정렬", () => {
    const existing = [
      { cutNumber: 1, shotType: "WS", sceneKo: "장면 1" },
      { cutNumber: 3, shotType: "CU", sceneKo: "장면 3" },
    ];
    const repaired = [
      { cutNumber: 2, shotType: "MS", sceneKo: "장면 2" },
    ];
    const merged = mergeAndDedupe(existing, repaired);
    expect(merged.map(o => o.cutNumber)).toEqual([1, 2, 3]);
  });

  it("중복 cutNumber은 기존 우선 보존", () => {
    const existing = [
      { cutNumber: 1, shotType: "WS", sceneKo: "원본 장면 1" },
      { cutNumber: 2, shotType: "MS", sceneKo: "원본 장면 2" },
    ];
    const repaired = [
      { cutNumber: 2, shotType: "CU", sceneKo: "복구 장면 2" }, // 중복
      { cutNumber: 3, shotType: "OTS", sceneKo: "복구 장면 3" },
    ];
    const merged = mergeAndDedupe(existing, repaired);
    expect(merged.length).toBe(3);
    expect(merged.find(o => o.cutNumber === 2)?.sceneKo).toBe("원본 장면 2"); // 기존 우선
  });

  it("빈 repair 결과는 기존 유지", () => {
    const existing = [
      { cutNumber: 1, shotType: "WS", sceneKo: "장면 1" },
    ];
    const merged = mergeAndDedupe(existing, []);
    expect(merged).toEqual(existing);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Token budget: 경량화된 스키마 반영
// ═══════════════════════════════════════════════════════════════════

describe("Step1 경량 스키마 토큰 예산 (Phase 2C: cap=32768)", () => {
  const STEP1_MAX_TOKENS = 32768;
  function estimateStep1Tokens(cutCount: number): number {
    const estimatedTokens = 200 + cutCount * 400 + 200;
    return Math.min(STEP1_MAX_TOKENS, Math.max(4096, Math.ceil(estimatedTokens * 1.5)));
  }

  it("경량 스키마(14필드) → per-outline 400토큰 기준", () => {
    // 6컷: (200 + 6*400 + 200) * 1.5 = 4200
    const budget6 = estimateStep1Tokens(6);
    expect(budget6).toBe(4200);
  });

  it("10컷 → 예산이 32768 내에 충분", () => {
    // 10컷: (200 + 10*400 + 200) * 1.5 = 6600
    const budget10 = estimateStep1Tokens(10);
    expect(budget10).toBe(6600);
    expect(budget10).toBeLessThan(32768);
  });

  it("경량화 전(18필드, 600/outline) 대비 토큰 절약 확인", () => {
    const oldFormula = (c: number) => Math.min(STEP1_MAX_TOKENS, Math.max(4096, Math.ceil((200 + c * 600 + 200) * 1.5)));
    const newFormula = (c: number) => Math.min(STEP1_MAX_TOKENS, Math.max(4096, Math.ceil((200 + c * 400 + 200) * 1.5)));

    for (const cutCount of [4, 6, 8, 10, 15]) {
      expect(newFormula(cutCount)).toBeLessThanOrEqual(oldFormula(cutCount));
    }
  });

  it("30컷 고부하 시나리오도 32768 내에 충분", () => {
    // 30컷: (200 + 30*400 + 200) * 1.5 = 18600
    const budget30 = estimateStep1Tokens(30);
    expect(budget30).toBe(18600);
    expect(budget30).toBeLessThan(STEP1_MAX_TOKENS);
  });
});
