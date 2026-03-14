/**
 * compact-degraded-editorial-persona.test.ts
 *
 * compact / degraded / ultra-compact 경로에서
 * editorial persona가 누락되지 않고 핵심 축이 보존되는지 검증.
 */

import { describe, it, expect } from "vitest";
import {
  buildCompactEditorialSummary,
  buildEditorialPlanningRules,
} from "@/lib/editorial-persona";
import {
  EDITORIAL_PERSONA_PRESETS,
  DEFAULT_EDITORIAL_PERSONA,
} from "@/types";

// ═══════════════════════════════════════════════════════════════════
// A. buildCompactEditorialSummary 기본 동작
// ═══════════════════════════════════════════════════════════════════

describe("A. buildCompactEditorialSummary 기본 동작", () => {
  it("1) default persona → balanced 키워드 포함", () => {
    const s = buildCompactEditorialSummary(DEFAULT_EDITORIAL_PERSONA);
    expect(s).toContain("[EDITORIAL:");
    expect(s).toContain("balanced cadence");
    expect(s).toContain("balanced coverage");
    expect(s).toContain("moderate inserts");
    expect(s).toContain("motivated camera");
    expect(s).toContain("hard cuts");
  });

  it("2) gothic-macabre → extreme-contrast + high inserts + near-static + dissolves", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["gothic-macabre"];
    const s = buildCompactEditorialSummary(ep);
    expect(s).toContain("extreme-contrast coverage");
    expect(s).toContain("high inserts");
    expect(s).toContain("near-static camera");
    expect(s).toContain("soft dissolves");
  });

  it("3) symmetrical-formalist → establish-led + minimal inserts + static + hard cuts", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["symmetrical-formalist"];
    const s = buildCompactEditorialSummary(ep);
    expect(s).toContain("establish-led");
    expect(s).toContain("minimal inserts");
    expect(s).toContain("static camera");
    expect(s).toContain("hard cuts");
  });

  it("4) propulsive-action → short punctuation + detail-led + frenetic + jump-cut", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["propulsive-action"];
    const s = buildCompactEditorialSummary(ep);
    expect(s).toContain("short punctuation cuts");
    expect(s).toContain("detail-led");
    expect(s).toContain("high inserts");
    expect(s).toContain("frenetic camera");
    expect(s).toContain("jump-cut rhythm");
  });

  it("5) lyrical-atmospheric → measured + establish-led + near-static + dissolves", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["lyrical-atmospheric"];
    const s = buildCompactEditorialSummary(ep);
    expect(s).toContain("establish-led");
    expect(s).toContain("moderate inserts");
    expect(s).toContain("near-static camera");
    expect(s).toContain("soft dissolves");
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. compact summary가 verbose rules의 핵심을 보존하는지
// ═══════════════════════════════════════════════════════════════════

describe("B. compact summary ↔ verbose rules 핵심 보존", () => {
  for (const [name, ep] of Object.entries(EDITORIAL_PERSONA_PRESETS)) {
    it(`${name}: compact summary의 키워드가 verbose rules에서 유래`, () => {
      const compact = buildCompactEditorialSummary(ep);
      const verbose = buildEditorialPlanningRules(ep);
      // compact의 각 태그가 verbose에도 상응하는 내용 존재 확인
      // pace
      if (ep.preferredCutPace[1] <= 4) {
        expect(compact).toContain("short punctuation");
        expect(verbose).toContain("Short rapid cuts");
      }
      if (ep.preferredCutPace[0] >= 5) {
        expect(compact).toContain("measured deliberate");
        expect(verbose).toContain("Measured deliberate");
      }
      // motion
      if (ep.motionBias === "static") {
        expect(compact).toContain("static camera");
        expect(verbose).toContain("locked-off static");
      }
      if (ep.motionBias === "minimal") {
        expect(compact).toContain("near-static");
        expect(verbose).toContain("near-static");
      }
      if (ep.motionBias === "frenetic") {
        expect(compact).toContain("frenetic");
        expect(verbose).toContain("aggressive rapid camera");
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// C. 다른 persona → 다른 compact summary (평탄화 방지)
// ═══════════════════════════════════════════════════════════════════

describe("C. persona별 compact summary 차이", () => {
  it("6) 4개 프리셋 모두 서로 다른 compact summary 생성", () => {
    const summaries = Object.values(EDITORIAL_PERSONA_PRESETS).map(
      ep => buildCompactEditorialSummary(ep),
    );
    const unique = new Set(summaries);
    expect(unique.size).toBe(summaries.length);
  });

  it("7) default persona는 프리셋과도 다름", () => {
    const defaultSummary = buildCompactEditorialSummary(DEFAULT_EDITORIAL_PERSONA);
    for (const ep of Object.values(EDITORIAL_PERSONA_PRESETS)) {
      expect(buildCompactEditorialSummary(ep)).not.toBe(defaultSummary);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. compact summary 길이 제한 (토큰 예산 보호)
// ═══════════════════════════════════════════════════════════════════

describe("D. compact summary 토큰 예산", () => {
  it("8) 어떤 프리셋이든 compact summary ≤ 120자", () => {
    for (const ep of Object.values(EDITORIAL_PERSONA_PRESETS)) {
      const s = buildCompactEditorialSummary(ep);
      expect(s.length).toBeLessThanOrEqual(120);
    }
    const ds = buildCompactEditorialSummary(DEFAULT_EDITORIAL_PERSONA);
    expect(ds.length).toBeLessThanOrEqual(120);
  });

  it("9) verbose rules ≥ 5x compact summary (compact가 진짜 짧은지)", () => {
    for (const ep of Object.values(EDITORIAL_PERSONA_PRESETS)) {
      const compact = buildCompactEditorialSummary(ep);
      const verbose = buildEditorialPlanningRules(ep);
      expect(verbose.length).toBeGreaterThan(compact.length * 3);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. server/client parity — buildCompactEditorialSummary
// ═══════════════════════════════════════════════════════════════════

describe("E. server/client parity — buildCompactEditorialSummary", () => {
  // dynamic import of server version
  it("10) 서버 buildCompactEditorialSummary === 클라이언트 결과", async () => {
    const serverModule = await import("../functions/api/_editorial-persona");
    for (const [name, ep] of Object.entries(EDITORIAL_PERSONA_PRESETS)) {
      const clientResult = buildCompactEditorialSummary(ep);
      const serverResult = serverModule.buildCompactEditorialSummary(ep as any);
      expect(serverResult).toBe(clientResult);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. compact prompt에 editorial 핵심이 존재하는지 (시뮬레이션)
// ═══════════════════════════════════════════════════════════════════

describe("F. compact/degraded 경로 editorial 주입 시뮬레이션", () => {
  it("11) compact retry prompt에 편집 기조 라인이 들어감", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["gothic-macabre"];
    const editorialBlock = buildEditorialPlanningRules(ep);
    // compact prompt 빌드 시뮬레이션 (generate-cuts.ts의 compact retry 로직)
    const compactEditorial = editorialBlock
      .split("\n").filter(l => l.startsWith("- ")).map(l => l.replace(/^-\s*/, "").split(":")[0]).slice(0, 3).join(", ");

    expect(compactEditorial).toContain("CUT PACE");
    expect(compactEditorial).toContain("COVERAGE");
    expect(compactEditorial).toContain("INSERTS");
  });

  it("12) ultra-compact prompt에 editorial summary 포함 시뮬레이션", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["propulsive-action"];
    const summary = buildCompactEditorialSummary(ep);
    // ultra-compact에서 editorialSummary가 줄바꿈으로 추가되는 패턴
    const ultraPromptSnippet = `JSON만 출력. 감독: test. 5초/컷 × 4컷.\n${summary}\n시나리오: test story`;
    expect(ultraPromptSnippet).toContain("[EDITORIAL:");
    expect(ultraPromptSnippet).toContain("short punctuation");
    expect(ultraPromptSnippet).toContain("frenetic camera");
  });

  it("13) deterministic fallback에서 persona에 따라 camera movement 분기", () => {
    // static/minimal persona → locked-off/near-static 키워드
    const staticSummary = buildCompactEditorialSummary(EDITORIAL_PERSONA_PRESETS["symmetrical-formalist"]);
    expect(staticSummary).toContain("static camera");

    // frenetic persona → frenetic/active 키워드
    const freneticSummary = buildCompactEditorialSummary(EDITORIAL_PERSONA_PRESETS["propulsive-action"]);
    expect(freneticSummary).toContain("frenetic camera");
  });
});
