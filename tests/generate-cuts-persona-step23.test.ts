/**
 * generate-cuts-persona-step23.test.ts
 *
 * step2/step3 프롬프트에서 editorial persona가 유지되는지 검증.
 * - directorEngine 안에 editorial planning rules가 포함되는지
 * - step2/3 재강조용 compact summary가 생성되는지
 * - persona가 다르면 directorEngine 출력도 달라지는지
 */

import { describe, it, expect } from "vitest";
import {
  buildEditorialPlanningRules,
  buildCompactEditorialSummary,
  extractEditorialPersona,
} from "@/lib/editorial-persona";
import {
  EDITORIAL_PERSONA_PRESETS,
  DEFAULT_EDITORIAL_PERSONA,
} from "@/types";
// 서버 버전 테스트
import {
  buildEditorialPlanningRules as serverBuildRules,
  buildCompactEditorialSummary as serverBuildSummary,
} from "../functions/api/_editorial-persona";

// ═══════════════════════════════════════════════════════════════════
// A. step2/3 propagation — editorial rules가 directorEngine에 포함
// ═══════════════════════════════════════════════════════════════════

describe("A. step2/3 propagation — editorial rules in directorEngine", () => {
  it("1) buildEditorialPlanningRules 출력이 step2/3에 주입 가능한 텍스트", () => {
    const ep = EDITORIAL_PERSONA_PRESETS["gothic-macabre"];
    const rules = buildEditorialPlanningRules(ep);
    // 핵심 6축이 모두 포함
    expect(rules).toContain("CUT PACE");
    expect(rules).toContain("COVERAGE");
    expect(rules).toContain("INSERTS");
    expect(rules).toContain("CAMERA MOTION");
    expect(rules).toContain("COMPOSITION");
    expect(rules).toContain("TRANSITION RHYTHM");
    // complexity budget guard
    expect(rules).toContain("GUARD");
    expect(rules).toContain("max 1 subject");
  });

  it("2) step2/3 lightweight editorial summary가 실제로 생성됨", () => {
    for (const [name, ep] of Object.entries(EDITORIAL_PERSONA_PRESETS)) {
      const summary = buildCompactEditorialSummary(ep);
      expect(summary).toBeTruthy();
      expect(summary.startsWith("[EDITORIAL:")).toBe(true);
      expect(summary.endsWith("]")).toBe(true);
    }
  });

  it("3) step2/3 summary에 persona의 핵심 축이 남아있음", () => {
    // gothic-macabre: 핵심 = near-static + extreme-contrast + dissolves
    const gothic = buildCompactEditorialSummary(EDITORIAL_PERSONA_PRESETS["gothic-macabre"]);
    expect(gothic).toContain("near-static");
    expect(gothic).toContain("extreme-contrast");
    expect(gothic).toContain("dissolves");

    // propulsive-action: 핵심 = short + frenetic + jump-cut
    const action = buildCompactEditorialSummary(EDITORIAL_PERSONA_PRESETS["propulsive-action"]);
    expect(action).toContain("short punctuation");
    expect(action).toContain("frenetic");
    expect(action).toContain("jump-cut");
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. persona별 step2/3 출력 차이 (평탄화 방지)
// ═══════════════════════════════════════════════════════════════════

describe("B. persona별 step2/3 출력 차이", () => {
  it("4) 다른 persona → 다른 verbose rules", () => {
    const gothicRules = buildEditorialPlanningRules(EDITORIAL_PERSONA_PRESETS["gothic-macabre"]);
    const actionRules = buildEditorialPlanningRules(EDITORIAL_PERSONA_PRESETS["propulsive-action"]);
    const lyricalRules = buildEditorialPlanningRules(EDITORIAL_PERSONA_PRESETS["lyrical-atmospheric"]);
    const formalistRules = buildEditorialPlanningRules(EDITORIAL_PERSONA_PRESETS["symmetrical-formalist"]);

    // 모두 다른 내용
    const set = new Set([gothicRules, actionRules, lyricalRules, formalistRules]);
    expect(set.size).toBe(4);
  });

  it("5) 다른 persona → 다른 compact summary", () => {
    const summaries = Object.values(EDITORIAL_PERSONA_PRESETS).map(
      ep => buildCompactEditorialSummary(ep),
    );
    const unique = new Set(summaries);
    expect(unique.size).toBe(4);
  });

  it("6) gothic-macabre verbose ≠ propulsive-action verbose (cut emphasis 차이)", () => {
    const gothic = buildEditorialPlanningRules(EDITORIAL_PERSONA_PRESETS["gothic-macabre"]);
    const action = buildEditorialPlanningRules(EDITORIAL_PERSONA_PRESETS["propulsive-action"]);
    // gothic: near-static camera, dissolve transitions
    expect(gothic).toContain("near-static");
    expect(gothic).toContain("dissolve");
    // action: aggressive rapid camera, jump-cut
    expect(action).toContain("aggressive rapid camera");
    expect(action).toContain("jump-cut");
    // 반대 속성이 없어야 함
    expect(gothic).not.toContain("aggressive rapid camera");
    expect(action).not.toContain("near-static");
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. step2/3 persona 완전 누락 방지
// ═══════════════════════════════════════════════════════════════════

describe("C. step2/3 persona 완전 누락 방지", () => {
  it("7) default persona도 비어있지 않은 rules/summary 생성", () => {
    const rules = buildEditorialPlanningRules(DEFAULT_EDITORIAL_PERSONA);
    expect(rules.length).toBeGreaterThan(100);
    expect(rules).toContain("CUT PACE");

    const summary = buildCompactEditorialSummary(DEFAULT_EDITORIAL_PERSONA);
    expect(summary.length).toBeGreaterThan(20);
  });

  it("8) extractEditorialPersona 결과로 즉시 rules/summary 생성 가능", () => {
    // 빈 입력 → default persona → rules 생성
    const ep = extractEditorialPersona();
    const rules = buildEditorialPlanningRules(ep);
    expect(rules).toContain("EDITORIAL PLANNING RULES");

    const summary = buildCompactEditorialSummary(ep);
    expect(summary).toContain("[EDITORIAL:");
  });

  it("9) heuristic fallback persona도 rules/summary 생성 가능", () => {
    const ep = extractEditorialPersona("rapid fast editing style", undefined, undefined);
    expect(ep.preferredCutPace).toEqual([2, 4]);
    const rules = buildEditorialPlanningRules(ep);
    expect(rules).toContain("Short rapid cuts");

    const summary = buildCompactEditorialSummary(ep);
    expect(summary).toContain("short punctuation");
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. server/client parity — step2/3 함수
// ═══════════════════════════════════════════════════════════════════

describe("D. server/client parity — buildCompactEditorialSummary", () => {
  const presetEntries = Object.entries(EDITORIAL_PERSONA_PRESETS);

  for (const [name, ep] of presetEntries) {
    it(`10-${name}) server buildCompactEditorialSummary === client`, () => {
      const client = buildCompactEditorialSummary(ep);
      const server = serverBuildSummary(ep as any);
      expect(server).toBe(client);
    });
  }

  for (const [name, ep] of presetEntries) {
    it(`11-${name}) server buildEditorialPlanningRules === client (재확인)`, () => {
      const client = buildEditorialPlanningRules(ep);
      const server = serverBuildRules(ep as any);
      expect(server).toBe(client);
    });
  }
});
