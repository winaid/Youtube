/**
 * meta-label-sanitizer.test.ts
 *
 * Tests for:
 * 1. Malformed Korean detection (달에과 제일 등)
 * 2. Planning/meta label stripping from visual prompt fields
 * 3. Semantic field validation
 * 4. extractTopicKeywords particle cleanup
 */

import { describe, it, expect } from "vitest";
import {
  stripMetaLabels,
  detectMalformedKorean,
  validateSemanticFields,
  runSanitizePipeline,
} from "@/lib/prompt-sanitizer";

// ═══════════════════════════════════════════════════════════════════
// 1. Malformed Korean Detection
// ═══════════════════════════════════════════════════════════════════

describe("detectMalformedKorean", () => {
  it("detects 달에과 (에+과 double particle)", () => {
    const issues = detectMalformedKorean("달에과 제일 큰 행성");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("달에과");
  });

  it("detects 시장에와 (에+와 double particle)", () => {
    const issues = detectMalformedKorean("시장에와 가격의 관계");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("detects 역사의과 (의+과 double particle)", () => {
    const issues = detectMalformedKorean("역사의과 전통");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("passes clean Korean text", () => {
    const issues = detectMalformedKorean("달과 별의 이야기");
    expect(issues).toHaveLength(0);
  });

  it("passes proper sentences with 에서", () => {
    const issues = detectMalformedKorean("시장에서 물건을 사다");
    expect(issues).toHaveLength(0);
  });

  it("passes empty string", () => {
    const issues = detectMalformedKorean("");
    expect(issues).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Meta-Label Stripping
// ═══════════════════════════════════════════════════════════════════

describe("stripMetaLabels", () => {
  it("strips bracketed meta labels", () => {
    const result = stripMetaLabels("[달에과 제일 — 강렬한 도입] 시청자의 스크롤을 멈추는 강렬한 도입 — 질문, 도발, 또는 약속");
    expect(result.text).not.toContain("강렬한 도입");
    expect(result.text).not.toContain("질문, 도발, 또는 약속");
    expect(result.removed.length).toBeGreaterThan(0);
  });

  it("strips em-dash planning suffixes", () => {
    const result = stripMetaLabels("경제와 자본 — 강렬한 도입");
    expect(result.text).not.toContain("강렬한 도입");
    expect(result.text).toBe("경제와 자본");
  });

  it("strips role label slash notation", () => {
    const result = stripMetaLabels("도입 / 전개 / 삽입 / 절정 / 마무리");
    expect(result.removed.length).toBeGreaterThan(0);
    expect(result.wasDominated).toBe(true);
  });

  it("strips 핵심 메커니즘 meta phrase", () => {
    const result = stripMetaLabels("이 장면은 핵심 메커니즘을 보여준다");
    expect(result.text).not.toContain("핵심 메커니즘");
  });

  it("strips 논리적 클라이맥스 meta phrase", () => {
    const result = stripMetaLabels("논리적 클라이맥스에서 감정적 보상");
    expect(result.text).not.toContain("논리적 클라이맥스");
    expect(result.text).not.toContain("감정적 보상");
  });

  it("does not strip legitimate English prompt content", () => {
    const input = "Wide shot of a moonlit forest clearing. A soldier stands alone, rifle lowered. Warm amber backlight from campfire.";
    const result = stripMetaLabels(input);
    // Trailing punctuation cleanup is acceptable; core content must survive
    expect(result.text).toContain("Wide shot of a moonlit forest clearing");
    expect(result.text).toContain("A soldier stands alone");
    expect(result.text).toContain("Warm amber backlight from campfire");
    expect(result.removed).toHaveLength(0);
  });

  it("marks as dominated when prompt is only meta labels", () => {
    const result = stripMetaLabels("강렬한 도입 — 질문, 도발, 또는 약속");
    expect(result.wasDominated).toBe(true);
  });

  it("does not mark as dominated when concrete content remains", () => {
    const result = stripMetaLabels("Wide shot of a forest. 강렬한 도입");
    expect(result.wasDominated).toBe(false);
    expect(result.text).toContain("Wide shot of a forest");
  });

  it("handles empty string", () => {
    const result = stripMetaLabels("");
    expect(result.text).toBe("");
    expect(result.removed).toHaveLength(0);
    expect(result.wasDominated).toBe(false);
  });

  it("strips multiple bracketed labels in one string", () => {
    const result = stripMetaLabels("[도입 — 훅] 첫 장면 [전개 — 정보 확장] 두 번째 장면");
    expect(result.text).not.toContain("[도입");
    expect(result.text).not.toContain("[전개");
    expect(result.text).toContain("첫 장면");
    expect(result.text).toContain("두 번째 장면");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Semantic Field Validation
// ═══════════════════════════════════════════════════════════════════

describe("validateSemanticFields", () => {
  it("rejects subject that is a planning label", () => {
    const issues = validateSemanticFields({
      subject: "강렬한 도입 — 질문, 도발, 또는 약속",
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].field).toBe("subject");
  });

  it("accepts concrete subject description", () => {
    const issues = validateSemanticFields({
      subject: "A young woman in a red dress stands at the balcony",
    });
    expect(issues).toHaveLength(0);
  });

  it("rejects environment that is a hook label", () => {
    const issues = validateSemanticFields({
      environment: "[훅 — 강렬한 도입]",
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].field).toBe("environment");
  });

  it("accepts concrete environment description", () => {
    const issues = validateSemanticFields({
      environment: "A dimly lit underground bunker with concrete walls",
    });
    expect(issues).toHaveLength(0);
  });

  it("rejects moodLighting dominated by meta labels", () => {
    const issues = validateSemanticFields({
      moodLighting: "감정적 보상 시각적 보상",
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].field).toBe("moodLighting");
  });

  it("accepts real lighting description", () => {
    const issues = validateSemanticFields({
      moodLighting: "warm golden hour backlight, soft ambient fill from left",
    });
    expect(issues).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. extractTopicKeywords Korean particle cleanup
// ═══════════════════════════════════════════════════════════════════

describe("extractTopicKeywords (via generateSequenceTitle integration)", () => {
  // We can't directly import the private function, but we test via
  // the exported analyzeScript or by testing the sanitizer catches
  // the downstream output.

  it("malformed Korean from topic joining never reaches prompts", () => {
    // Simulate the old buggy output
    const badTitle = "달에과 제일 — 강렬한 도입";
    const malformed = detectMalformedKorean(badTitle);
    expect(malformed.length).toBeGreaterThan(0);

    // Verify the sanitizer strips it
    const stripped = stripMetaLabels(badTitle);
    expect(stripped.text).not.toContain("강렬한 도입");
  });

  it("correctly formed Korean passes detection", () => {
    const goodTitle = "경제와 자본의 배경";
    const malformed = detectMalformedKorean(goodTitle);
    expect(malformed).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Integration: runSanitizePipeline strips meta labels
// ═══════════════════════════════════════════════════════════════════

describe("runSanitizePipeline meta-label integration", () => {
  it("strips meta labels during pipeline execution", () => {
    const result = runSanitizePipeline({
      prompt: "[달에과 제일 — 강렬한 도입] Wide shot of a forest clearing. 강렬한 도입",
      negatives: ["blurry"],
      framing: "WS",
    });
    expect(result.prompt).not.toContain("강렬한 도입");
    expect(result.prompt).toContain("Wide shot of a forest clearing");
    expect(result.log.some((l: string) => l.includes("[meta-label]"))).toBe(true);
  });

  it("flags dominated prompts as error", () => {
    const result = runSanitizePipeline({
      prompt: "강렬한 도입 — 질문, 도발, 또는 약속",
      negatives: [],
      framing: "MS",
    });
    expect(result.issues.some((i: { rule: string; severity: string; message: string }) => i.rule === "meta_label_dominated_prompt")).toBe(true);
    expect(result.clean).toBe(false);
  });

  it("detects malformed Korean particles", () => {
    const result = runSanitizePipeline({
      prompt: "달에과 제일 큰 행성에서 촬영한다",
      negatives: [],
      framing: "WS",
    });
    expect(result.issues.some((i: { rule: string; severity: string; message: string }) => i.rule === "malformed_korean_particles")).toBe(true);
  });
});
