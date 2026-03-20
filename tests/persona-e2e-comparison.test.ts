/**
 * persona-e2e-comparison.test.ts — Editorial Persona End-to-End 비교 검증
 *
 * 목적: 같은 storyText + 다른 editorial persona → 실제 output 전 경로에서
 *       체감 가능한 차이가 발생하는지 end-to-end 검증.
 *
 * 검증 경로:
 *   1. duration 결정 (computeAutoDuration / computeServerAutoDuration)
 *   2. beat template (buildDurationAwareBeatTemplate)
 *   3. verbose planning rules (buildEditorialPlanningRules)
 *   4. compact editorial summary (buildCompactEditorialSummary)
 *   5. deterministic fallback camera movement (persona-based branching)
 *   6. payload preview (renderPromptFromJson)
 *   7. sanitizer guard 유지 (detectEditorialPersonaConflicts)
 *   8. compact/degraded 경로 persona 생존
 *
 * 비교 대상 persona: gothic-macabre / symmetrical-formalist / propulsive-action / lyrical-atmospheric
 */

import { describe, it, expect } from "vitest";
import {
  extractEditorialPersona,
  editorialPaceMidpoint,
  buildEditorialPlanningRules,
  buildCompactEditorialSummary,
  buildDurationAwareBeatTemplate,
} from "@/lib/editorial-persona";
import {
  computeAutoDuration,
} from "@/lib/duration-reconciliation";
import {
  EDITORIAL_PERSONA_PRESETS,
  DEFAULT_EDITORIAL_PERSONA,
} from "@/types";
import {
  renderPromptFromJson,
} from "@/lib/video-prompt-json";
import type { VideoPromptJson } from "@/lib/video-prompt-json";
import {
  detectEditorialPersonaConflicts,
  runSanitizePipeline,
} from "@/lib/prompt-sanitizer";
import { computeServerAutoDuration } from "../functions/api/_duration-constants";
import {
  buildEditorialPlanningRules as serverBuildRules,
  buildCompactEditorialSummary as serverBuildSummary,
  buildDurationAwareBeatTemplate as serverBuildBeat,
} from "../functions/api/_editorial-persona";

// ═══════════════════════════════════════════════════════════════════
// 대표 비교용 입력 스토리
// ═══════════════════════════════════════════════════════════════════

const STORY_TEXT = `
버려진 빅토리아 시대 치과 실험실. 먼지 쌓인 약장 유리 위로 달빛이 내려앉는다.
녹슨 치과 의자에 가죽 벨트가 늘어져 있고, 바닥에는 깨진 마취 병이 흩어져 있다.
벽면 선반에 빛바랜 해부학 도해가 걸려 있고, 구석에 증류기가 식어 있다.
문 밖에서 발자국 소리가 가까워진다. 누군가 이 실험실을 찾아온 것이다.
`.trim();

const COMPARISON_PERSONAS = [
  "gothic-macabre",
  "symmetrical-formalist",
  "propulsive-action",
  "lyrical-atmospheric",
] as const;

// ═══════════════════════════════════════════════════════════════════
// Helper: 전 경로 시뮬레이션
// ═══════════════════════════════════════════════════════════════════

interface PersonaSimResult {
  name: string;
  paceMid: number;
  autoDuration: number;
  autoBasis: string;
  beatTemplate: string;
  extendBeatTemplate: string;
  verboseRules: string;
  compactSummary: string;
  rendered: string;
  videoPromptJson: VideoPromptJson;
}

function simulateFullPipeline(presetName: string): PersonaSimResult {
  const ep = EDITORIAL_PERSONA_PRESETS[presetName] || DEFAULT_EDITORIAL_PERSONA;
  const paceMid = editorialPaceMidpoint(ep);

  // 1. duration 결정 (auto mode — cutDuration 미지정)
  const autoResult = computeAutoDuration({
    editorialPace: ep.preferredCutPace,
  });

  const secPerCut = autoResult.duration;

  // 2. beat template
  const { beatTemplate, extendBeatTemplate } = buildDurationAwareBeatTemplate(secPerCut, ep);

  // 3. verbose planning rules
  const verboseRules = buildEditorialPlanningRules(ep);

  // 4. compact summary
  const compactSummary = buildCompactEditorialSummary(ep);

  // 5. persona-driven camera movement (deterministic fallback 시뮬레이션)
  const cameraMap: Record<string, string> = {
    static: "locked-off static camera (stillness emphasizes composition)",
    minimal: "near-static camera with subtle creeping movement (restrained observation)",
    moderate: "subtle dolly forward (motivated by subject introduction)",
    dynamic: "active tracking following subject (subject-led energy)",
    frenetic: "handheld tracking with energy (frenetic subject pursuit)",
  };
  const cameraMovement = cameraMap[ep.motionBias] || cameraMap.moderate;

  // persona-driven shot size (coverage bias 시뮬레이션)
  const shotMap: Record<string, string> = {
    "wide-dominant": "WS",
    "close-dominant": "CU",
    "balanced": "MS",
    "extreme-contrast": "ECU",
  };
  const shotSize = shotMap[ep.preferredCoverage] || "MS";

  // persona-driven transition
  const transMap: Record<string, string> = {
    "hard-cut": "cut",
    dissolve: "soft dissolve",
    "match-cut": "match-cut on shape",
    "jump-cut": "jump-cut",
    mixed: "cut",
  };
  const transition = transMap[ep.transitionBias] || "cut";

  // 6. VideoPromptJson 구성
  const videoPromptJson: VideoPromptJson = {
    shotSize,
    cameraAngle: "eye-level",
    cameraMovement,
    subjectBlocking: ep.preferredCoverage === "close-dominant"
      ? "object fills frame foreground"
      : ep.preferredCoverage === "wide-dominant"
        ? "environment fills frame, figure distant"
        : "subject center-frame mid-ground",
    subjectAction: "dusty glass cabinet catches moonlight",
    actionBeat: "moonlight traces across dusty surfaces",
    bodySignal: "",
    revealed: "abandoned dental equipment under moonlight",
    withheld: "source of approaching footsteps",
    timingBeat: beatTemplate
      .replace(/\[start[^\]]*\]/, "moonlight falls across dusty cabinet glass")
      .replace(/\[develop[^\]]*\]/, "rusty dental chair with leather belt visible")
      .replace(/\[resolve[^\]]*\]/, "broken anesthesia bottles on floor")
      .replace(/\[climax[^\]]*\]/, "approaching footsteps echo")
      .replace(/\[single visual focus[^\]]*\]/, "moonlight illuminates dusty cabinet"),
    transitionFromPrev: transition,
    characterRef: "",
    moodLighting: "cold moonlight from upper right through broken window, deep shadows pool beneath equipment",
    styleSuffix: `cinematic realism, 16:9, no text, no watermark. ${compactSummary}`,
    locationCue: "Victorian dental laboratory",
    situationCue: "abandoned dusty equipment",
    emotionalAnchor: "approaching footsteps",
  };

  // 7. Kling 렌더링
  const rendered = renderPromptFromJson(videoPromptJson);

  return {
    name: presetName,
    paceMid,
    autoDuration: secPerCut,
    autoBasis: autoResult.basis,
    beatTemplate,
    extendBeatTemplate,
    verboseRules,
    compactSummary,
    rendered,
    videoPromptJson,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 전체 비교 결과 수집
// ═══════════════════════════════════════════════════════════════════

const results = COMPARISON_PERSONAS.map(p => simulateFullPipeline(p));

// ═══════════════════════════════════════════════════════════════════
// A. Duration 결정 차이
// ═══════════════════════════════════════════════════════════════════

describe("A. duration 결정 — persona별 차이", () => {
  it("1) propulsive-action이 가장 짧은 duration", () => {
    const action = results.find(r => r.name === "propulsive-action")!;
    const formalist = results.find(r => r.name === "symmetrical-formalist")!;
    expect(action.autoDuration).toBeLessThanOrEqual(formalist.autoDuration);
  });

  it("2) symmetrical-formalist과 lyrical-atmospheric은 같은 pace range → 같은 duration", () => {
    const formalist = results.find(r => r.name === "symmetrical-formalist")!;
    const lyrical = results.find(r => r.name === "lyrical-atmospheric")!;
    expect(formalist.autoDuration).toBe(lyrical.autoDuration);
  });

  it("3) auto duration basis는 editorialPace만 있을 때 scene_default", () => {
    for (const r of results) {
      expect(r.autoBasis).toBe("scene_default");
    }
  });

  it("4) paceMid가 persona별로 올바르게 계산", () => {
    expect(results.find(r => r.name === "propulsive-action")!.paceMid).toBe(3);  // (2+4)/2
    expect(results.find(r => r.name === "symmetrical-formalist")!.paceMid).toBe(5); // (4+6)/2
    expect(results.find(r => r.name === "gothic-macabre")!.paceMid).toBe(4); // (3+5)/2
    expect(results.find(r => r.name === "lyrical-atmospheric")!.paceMid).toBe(5); // (4+6)/2
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. Beat Template 차이
// ═══════════════════════════════════════════════════════════════════

describe("B. beat template — persona별 구조 차이", () => {
  it("5) propulsive-action(3s) → 1 beat 단일 구조", () => {
    const action = results.find(r => r.name === "propulsive-action")!;
    // 3s cut → 1 single visual focus beat
    expect(action.beatTemplate).toContain("single visual focus");
  });

  it("6) gothic-macabre(4s) → 2 beat 구조 (start + resolve)", () => {
    const gothic = results.find(r => r.name === "gothic-macabre")!;
    // 4s cut → start + resolve
    expect(gothic.beatTemplate).toContain("start");
    expect(gothic.beatTemplate).toContain("resolve");
  });

  it("7) formalist/lyrical(5s) → 2 beat 구조 (start + develop)", () => {
    const formalist = results.find(r => r.name === "symmetrical-formalist")!;
    expect(formalist.beatTemplate).toContain("start");
    expect(formalist.beatTemplate).toContain("develop");
  });

  it("8) 짧은 duration persona ≠ 긴 duration persona beat 구조", () => {
    const action = results.find(r => r.name === "propulsive-action")!;
    const formalist = results.find(r => r.name === "symmetrical-formalist")!;
    expect(action.beatTemplate).not.toBe(formalist.beatTemplate);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. Verbose Rules 차이 (step1/step2+3 프롬프트용)
// ═══════════════════════════════════════════════════════════════════

describe("C. verbose planning rules — persona별 내용 차이", () => {
  it("9) 4개 persona 모두 서로 다른 verbose rules", () => {
    const ruleSet = new Set(results.map(r => r.verboseRules));
    expect(ruleSet.size).toBe(4);
  });

  it("10) gothic → near-static + dissolve + extreme-contrast", () => {
    const gothic = results.find(r => r.name === "gothic-macabre")!;
    expect(gothic.verboseRules).toContain("near-static");
    expect(gothic.verboseRules).toContain("dissolve");
    expect(gothic.verboseRules).toContain("extreme-contrast");
  });

  it("11) propulsive-action → Short rapid + aggressive rapid camera + jump-cut", () => {
    const action = results.find(r => r.name === "propulsive-action")!;
    expect(action.verboseRules).toContain("Short rapid cuts");
    expect(action.verboseRules).toContain("aggressive rapid camera");
    expect(action.verboseRules).toContain("jump-cut");
  });

  it("12) 모든 verbose rules에 complexity budget guard 포함", () => {
    for (const r of results) {
      expect(r.verboseRules).toContain("GUARD");
      expect(r.verboseRules).toContain("max 1 subject, 1 action, 1 camera motion");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. Compact Summary 차이 (step2/3 재강조 + compact/degraded용)
// ═══════════════════════════════════════════════════════════════════

describe("D. compact editorial summary — persona별 차이", () => {
  it("13) 4개 persona 모두 서로 다른 compact summary", () => {
    const summarySet = new Set(results.map(r => r.compactSummary));
    expect(summarySet.size).toBe(4);
  });

  it("14) compact summary가 rendered prompt에 실제로 포함됨", () => {
    for (const r of results) {
      expect(r.rendered).toContain("[EDITORIAL:");
    }
  });

  it("15) compact summary 길이 ≤ 120자", () => {
    for (const r of results) {
      expect(r.compactSummary.length).toBeLessThanOrEqual(120);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. Kling Payload Preview 차이 (실제 provider에 가는 최종 프롬프트)
// ═══════════════════════════════════════════════════════════════════

describe("E. Kling payload preview — persona별 체감 차이", () => {
  it("16) 4개 persona 모두 서로 다른 rendered prompt", () => {
    const renderedSet = new Set(results.map(r => r.rendered));
    expect(renderedSet.size).toBe(4);
  });

  it("17) camera movement가 persona별로 다름", () => {
    const gothic = results.find(r => r.name === "gothic-macabre")!;
    const action = results.find(r => r.name === "propulsive-action")!;
    const formalist = results.find(r => r.name === "symmetrical-formalist")!;
    const lyrical = results.find(r => r.name === "lyrical-atmospheric")!;

    // 실제 내용 차이
    expect(gothic.rendered).toContain("creeping");
    expect(action.rendered).toContain("handheld");
    expect(formalist.rendered).toContain("static");
    expect(lyrical.rendered).toContain("creeping");
  });

  it("18) shot size가 coverage bias에 따라 다름", () => {
    const gothic = results.find(r => r.name === "gothic-macabre")!;
    const formalist = results.find(r => r.name === "symmetrical-formalist")!;
    const action = results.find(r => r.name === "propulsive-action")!;

    expect(gothic.videoPromptJson.shotSize).toBe("ECU");      // extreme-contrast
    expect(formalist.videoPromptJson.shotSize).toBe("WS");     // wide-dominant
    expect(action.videoPromptJson.shotSize).toBe("CU");        // close-dominant
  });

  it("19) transition이 persona별로 다름", () => {
    const gothic = results.find(r => r.name === "gothic-macabre")!;
    const action = results.find(r => r.name === "propulsive-action")!;
    const formalist = results.find(r => r.name === "symmetrical-formalist")!;

    expect(gothic.videoPromptJson.transitionFromPrev).toContain("dissolve");
    expect(action.videoPromptJson.transitionFromPrev).toContain("jump-cut");
    expect(formalist.videoPromptJson.transitionFromPrev).toBe("cut");
  });

  it("20) subject blocking이 coverage에 따라 다름", () => {
    const formalist = results.find(r => r.name === "symmetrical-formalist")!;
    const action = results.find(r => r.name === "propulsive-action")!;

    expect(formalist.videoPromptJson.subjectBlocking).toContain("environment");
    expect(action.videoPromptJson.subjectBlocking).toContain("object fills frame");
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. Sanitizer Guard 유지
// ═══════════════════════════════════════════════════════════════════

describe("F. sanitizer guard — persona 강화 후에도 작동", () => {
  it("21) overstuffed prompt + frenetic persona → complexity conflict 감지", () => {
    const overstuffed = "a man walks, runs, jumps, falls, turns, grabs. push-in, tracking, pan left, dolly, crane up.";
    const issues = detectEditorialPersonaConflicts(
      overstuffed,
      { motionBias: "frenetic", insertBias: "high", preferredCutPace: [2, 4] as [number, number] },
      3,
    );
    expect(issues.some(i => i.rule === "persona_conflicts_with_cut_complexity_budget")).toBe(true);
  });

  it("22) runSanitizePipeline에 persona 전달 시 persona 이슈도 감지", () => {
    const result = runSanitizePipeline({
      prompt: "insert detail, close-up texture, macro surface, shadow silhouette, another detail, object insert, tracking camera",
      negatives: [],
      framing: "CU",
      editorialPersona: { motionBias: "frenetic", insertBias: "high", preferredCutPace: [2, 4] as [number, number] },
      durationSec: 3,
    });
    const personaIssues = result.issues.filter(i => i.rule.startsWith("persona_"));
    expect(personaIssues.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// G. Server/Client Parity — 전체 경로
// ═══════════════════════════════════════════════════════════════════

describe("G. server/client parity — 전체 경로", () => {
  it("23) 4개 persona: server duration === client duration", () => {
    for (const preset of COMPARISON_PERSONAS) {
      const ep = EDITORIAL_PERSONA_PRESETS[preset];
      const client = computeAutoDuration({ editorialPace: ep.preferredCutPace });
      const server = computeServerAutoDuration(undefined, undefined, undefined, undefined, ep.preferredCutPace);
      expect(server.duration).toBe(client.duration);
    }
  });

  it("24) 4개 persona: server verbose rules === client verbose rules", () => {
    for (const preset of COMPARISON_PERSONAS) {
      const ep = EDITORIAL_PERSONA_PRESETS[preset];
      const client = buildEditorialPlanningRules(ep);
      const server = serverBuildRules(ep as any);
      expect(server).toBe(client);
    }
  });

  it("25) 4개 persona: server compact summary === client compact summary", () => {
    for (const preset of COMPARISON_PERSONAS) {
      const ep = EDITORIAL_PERSONA_PRESETS[preset];
      const client = buildCompactEditorialSummary(ep);
      const server = serverBuildSummary(ep as any);
      expect(server).toBe(client);
    }
  });

  it("26) 4개 persona: server beat template === client beat template", () => {
    for (const preset of COMPARISON_PERSONAS) {
      const ep = EDITORIAL_PERSONA_PRESETS[preset];
      const dur = computeAutoDuration({ editorialPace: ep.preferredCutPace }).duration;
      const client = buildDurationAwareBeatTemplate(dur, ep);
      const server = serverBuildBeat(dur, ep as any);
      expect(server.beatTemplate).toBe(client.beatTemplate);
      expect(server.extendBeatTemplate).toBe(client.extendBeatTemplate);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// H. Compact/Degraded 경로 persona 생존
// ═══════════════════════════════════════════════════════════════════

describe("H. compact/degraded 경로 persona 생존", () => {
  it("27) compact summary가 4개 persona 모두 다름 (degraded에서도 persona 차이)", () => {
    const summaries = COMPARISON_PERSONAS.map(p => buildCompactEditorialSummary(EDITORIAL_PERSONA_PRESETS[p]));
    const unique = new Set(summaries);
    expect(unique.size).toBe(4);
  });

  it("28) compact retry에서 editorial 축약 3개 축 이상 보존", () => {
    for (const preset of COMPARISON_PERSONAS) {
      const ep = EDITORIAL_PERSONA_PRESETS[preset];
      const rules = buildEditorialPlanningRules(ep);
      const compactEditorial = rules
        .split("\n").filter(l => l.startsWith("- ")).map(l => l.replace(/^-\s*/, "").split(":")[0]).slice(0, 3).join(", ");
      // 최소 3개 축이 남아야 함
      expect(compactEditorial.split(",").length).toBeGreaterThanOrEqual(3);
      expect(compactEditorial).toContain("CUT PACE");
    }
  });

  it("29) deterministic fallback에서 motionBias에 따른 camera 분기 시뮬레이션", () => {
    // static/minimal → locked-off 키워드
    const staticBias = EDITORIAL_PERSONA_PRESETS["symmetrical-formalist"].motionBias;
    expect(staticBias === "static" || staticBias === "minimal").toBe(true);

    // frenetic → handheld/tracking 키워드
    const freneticBias = EDITORIAL_PERSONA_PRESETS["propulsive-action"].motionBias;
    expect(freneticBias).toBe("frenetic");
  });
});

// ═══════════════════════════════════════════════════════════════════
// I. 비교 결과 출력 (테스트 자체가 비교표 역할)
// ═══════════════════════════════════════════════════════════════════

describe("I. 비교 결과 요약 — 체감 차이 확인", () => {
  it("30) 비교표 출력 및 차이 검증", () => {
    // 이 테스트는 비교 결과를 구조적으로 검증
    const table = results.map(r => ({
      persona: r.name,
      duration: r.autoDuration,
      paceMid: r.paceMid,
      shotSize: r.videoPromptJson.shotSize,
      cameraStyle: r.videoPromptJson.cameraMovement.split("(")[0].trim(),
      transition: r.videoPromptJson.transitionFromPrev,
      summaryLen: r.compactSummary.length,
      renderedLen: r.rendered.length,
      beatBeats: (r.beatTemplate.match(/\[/g) || []).length,
    }));

    // 최소 3개 이상의 차이 축이 있어야 함
    const durationSet = new Set(table.map(t => t.duration));
    const shotSet = new Set(table.map(t => t.shotSize));
    const cameraSet = new Set(table.map(t => t.cameraStyle));
    const transitionSet = new Set(table.map(t => t.transition));

    // duration은 2종 이상 (propulsive vs formalist/lyrical)
    expect(durationSet.size).toBeGreaterThanOrEqual(2);
    // shot size는 3종 이상
    expect(shotSet.size).toBeGreaterThanOrEqual(3);
    // camera style은 3종 이상
    expect(cameraSet.size).toBeGreaterThanOrEqual(3);
    // transition은 3종 이상
    expect(transitionSet.size).toBeGreaterThanOrEqual(3);

    // 콘솔에 비교표 출력
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║        EDITORIAL PERSONA E2E COMPARISON TABLE               ║");
    console.log("╠══════════════════════════════════════════════════════════════╣");
    for (const t of table) {
      console.log(`║ ${t.persona.padEnd(24)} | dur=${t.duration}s | shot=${t.shotSize.padEnd(3)} | cam=${t.cameraStyle.padEnd(25)} | trans=${t.transition.padEnd(12)} | beats=${t.beatBeats}`);
    }
    console.log("╚══════════════════════════════════════════════════════════════╝\n");
  });
});
