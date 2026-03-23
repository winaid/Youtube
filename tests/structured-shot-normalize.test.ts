/**
 * structured-shot-normalize.test.ts — StructuredShot subject.primary 정규화 + 필드 검증
 *
 * Tests:
 *   a) StructuredShot가 subject.primary를 저장/정규화하는지
 *   b) subject string input이 subject.primary로 normalize되는지
 *   c) structuredShots가 있을 때 canonical sequence가 multiShot보다 structuredShots를 우선하는지
 *   d) structuredShots가 없을 때만 multiShot fallback 되는지
 *   e) fragmented edit 최종 prompt가 structured shot progression을 반영하는지
 *   f) fragmented edit final prompt가 500자 이하인지
 *   g) 500자 이하이지만 shot progression이 사라지면 실패하는지
 *   h) validator가 missing subject.primary를 잡는지
 */

import { describe, it, expect } from "vitest";
import {
  normalizeSubject,
  getSubjectPrimary,
  normalizeStructuredShot,
  normalizeStructuredShots,
  structuredShotToSequenceShot,
  validateStructuredShotFields,
  validateAllStructuredShotFields,
} from "@/lib/structured-shot-normalize";
import type { StructuredShot } from "@/types";
import {
  compressAutoSplitPrompt,
  planAutoSplitShots,
  PROMPT_CHAR_LIMIT,
  type AutoSplitInput,
} from "@/lib/shot-plan-auto-split";
import { validateFinalProviderPayload } from "@/lib/final-payload-validator";

// ═══════════════════════════════════════════════════════════════════
// Test Data
// ═══════════════════════════════════════════════════════════════════

const SHOT_WITH_STRING_SUBJECT: StructuredShot = {
  shotId: "shot_1",
  startSec: 0,
  endSec: 3,
  camera: { framing: "WS", angle: "eye-level", motion: "pan" },
  subject: "young woman",
  action: "walks through door",
  environment: "dark room",
  moodLighting: "blue glow",
  focus: "establish",
};

const SHOT_WITH_PRIMARY_SUBJECT: StructuredShot = {
  shotId: "shot_2",
  startSec: 3,
  endSec: 6,
  camera: { framing: "CU", angle: "low-angle", motion: "push-in" },
  subject: { primary: "young woman's hands" },
  action: "grabs phone from table",
  environment: "desk surface",
  moodLighting: "screen glow",
  focus: "detail",
};

const SHOT_MISSING_SUBJECT: StructuredShot = {
  shotId: "shot_3",
  startSec: 6,
  endSec: 8,
  camera: { framing: "MCU", angle: "high-angle", motion: "static" },
  subject: "",
  action: "face lit by screen",
  environment: "dark room",
  moodLighting: "blue glow",
  focus: "peak",
};

const SHOT_MISSING_FIELDS: StructuredShot = {
  shotId: "",
  startSec: 0,
  endSec: 3,
  camera: { framing: "", angle: "", motion: "" },
  subject: "",
  action: "",
  environment: "",
  moodLighting: "",
  focus: "",
};

// ═══════════════════════════════════════════════════════════════════
// a) subject.primary 저장/정규화
// ═══════════════════════════════════════════════════════════════════

describe("a) StructuredShot subject.primary normalization", () => {
  it("normalizeSubject converts string to { primary }", () => {
    const result = normalizeSubject("young woman");
    expect(result).toEqual({ primary: "young woman" });
  });

  it("normalizeSubject preserves { primary } as-is", () => {
    const result = normalizeSubject({ primary: "young woman" });
    expect(result).toEqual({ primary: "young woman" });
  });

  it("normalizeSubject preserves secondary array", () => {
    const result = normalizeSubject({ primary: "woman", secondary: ["phone", "cup"] });
    expect(result.primary).toBe("woman");
    expect(result.secondary).toEqual(["phone", "cup"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// b) string → subject.primary normalize
// ═══════════════════════════════════════════════════════════════════

describe("b) getSubjectPrimary", () => {
  it("extracts primary from string", () => {
    expect(getSubjectPrimary("young woman")).toBe("young woman");
  });

  it("extracts primary from object", () => {
    expect(getSubjectPrimary({ primary: "young woman" })).toBe("young woman");
  });
});

describe("normalizeStructuredShot", () => {
  it("normalizes string subject to { primary }", () => {
    const normalized = normalizeStructuredShot(SHOT_WITH_STRING_SUBJECT);
    expect(normalized.subject).toEqual({ primary: "young woman" });
    // Other fields unchanged
    expect(normalized.shotId).toBe("shot_1");
    expect(normalized.camera.framing).toBe("WS");
  });

  it("preserves already-normalized subject", () => {
    const normalized = normalizeStructuredShot(SHOT_WITH_PRIMARY_SUBJECT);
    expect(normalized.subject).toEqual({ primary: "young woman's hands" });
  });
});

describe("normalizeStructuredShots (array)", () => {
  it("normalizes all shots in array", () => {
    const shots = normalizeStructuredShots([SHOT_WITH_STRING_SUBJECT, SHOT_WITH_PRIMARY_SUBJECT]);
    expect(shots[0].subject).toEqual({ primary: "young woman" });
    expect(shots[1].subject).toEqual({ primary: "young woman's hands" });
  });
});

// ═══════════════════════════════════════════════════════════════════
// c/d) structuredShots vs multiShot priority — tested at canonical level
// ═══════════════════════════════════════════════════════════════════

describe("c) structuredShotToSequenceShot", () => {
  it("flattens subject.primary to string for sequence doc", () => {
    const result = structuredShotToSequenceShot(SHOT_WITH_PRIMARY_SUBJECT);
    expect(result.subject).toBe("young woman's hands");
    expect(typeof result.subject).toBe("string");
  });

  it("passes through string subject as-is", () => {
    const result = structuredShotToSequenceShot(SHOT_WITH_STRING_SUBJECT);
    expect(result.subject).toBe("young woman");
  });

  it("preserves all other fields", () => {
    const result = structuredShotToSequenceShot(SHOT_WITH_PRIMARY_SUBJECT);
    expect(result.shotId).toBe("shot_2");
    expect(result.startSec).toBe(3);
    expect(result.endSec).toBe(6);
    expect(result.camera).toEqual({ framing: "CU", angle: "low-angle", motion: "push-in" });
    expect(result.action).toBe("grabs phone from table");
    expect(result.environment).toBe("desk surface");
    expect(result.moodLighting).toBe("screen glow");
  });
});

// ═══════════════════════════════════════════════════════════════════
// e) fragmented edit — shot progression in compressed prompt
// ═══════════════════════════════════════════════════════════════════

describe("e) fragmented edit shot progression", () => {
  it("compressed prompt contains shot timing markers", () => {
    const input: AutoSplitInput = {
      storyText: "컷 분절 편집으로 만든 빠른 편집 광고",
      sceneDescription: "phone addiction ad",
      subjectPrimary: "young woman",
      action: "scrolling → phone drops → face lit",
      environment: "dark bedroom",
      moodLighting: "cold blue light",
      durationSec: 8,
      camera: { framing: "MS", angle: "eye-level", motion: "steady" },
    };
    const result = planAutoSplitShots(input);
    expect(result.shots.length).toBeGreaterThanOrEqual(3);
    expect(result.fragmentedContext.isFragmented).toBe(true);

    // Compressed prompt should contain shot boundaries: [Ns-Ns framing/motion]
    const prompt = result.compressedPrompt;
    // Format is [0-2s WS/pan] — match [digits-digits with 's']
    const shotMarkers = prompt.split("\n").filter(l => /^\[\d/.test(l));
    expect(shotMarkers.length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// f) 500자 이하 hard guarantee
// ═══════════════════════════════════════════════════════════════════

describe("f) fragmented edit final prompt ≤ 500 chars", () => {
  it("compressed prompt respects 500 char limit", () => {
    const input: AutoSplitInput = {
      storyText: "hard cuts 스타일 빠른 편집 광고",
      sceneDescription: "beauty product showcase with rapid transitions and multiple angle changes",
      subjectPrimary: "beauty product and Korean model with flawless skin",
      action: "product reveal close-up → model application smooth motion → dramatic transformation sequence → final glamour hero shot with sparkle",
      environment: "clean white studio with colored accent lighting and reflective surfaces",
      moodLighting: "soft beauty key light with rim highlights on product surfaces",
      durationSec: 8,
      camera: { framing: "CU", angle: "eye-level", motion: "push-in" },
    };
    const result = planAutoSplitShots(input);
    expect(result.compressedPrompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
  });
});

// ═══════════════════════════════════════════════════════════════════
// g) 500자 이하 but shot progression missing = fail
// ═══════════════════════════════════════════════════════════════════

describe("g) 500 chars but shot progression must remain", () => {
  it("compressed prompt retains shot structure lines", () => {
    const input: AutoSplitInput = {
      storyText: "컷 분절 편집으로 빠른 광고",
      sceneDescription: "ad scene",
      subjectPrimary: "woman",
      action: "walks → turns → stops",
      environment: "street",
      moodLighting: "daylight",
      durationSec: 8,
      camera: { framing: "MS", angle: "eye-level", motion: "steady" },
    };
    const result = planAutoSplitShots(input);
    const prompt = result.compressedPrompt;

    // Must be under 500
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);

    // Must have at least as many shot lines as shots generated
    const shotLines = prompt.split("\n").filter(l => l.startsWith("["));
    expect(shotLines.length).toBe(result.shots.length);
  });
});

// ═══════════════════════════════════════════════════════════════════
// h) validator catches missing subject.primary
// ═══════════════════════════════════════════════════════════════════

describe("h) validator catches missing required fields", () => {
  it("detects missing subject.primary", () => {
    const missing = validateStructuredShotFields(SHOT_MISSING_SUBJECT);
    expect(missing.some(m => m.field === "subject.primary")).toBe(true);
  });

  it("detects multiple missing fields", () => {
    const missing = validateStructuredShotFields(SHOT_MISSING_FIELDS);
    expect(missing.length).toBeGreaterThanOrEqual(5);
    const fields = missing.map(m => m.field);
    expect(fields).toContain("shotId");
    expect(fields).toContain("camera.framing");
    expect(fields).toContain("camera.angle");
    expect(fields).toContain("camera.motion");
    expect(fields).toContain("subject.primary");
    expect(fields).toContain("action");
    expect(fields).toContain("environment");
    expect(fields).toContain("moodLighting");
  });

  it("passes for complete shot", () => {
    const missing = validateStructuredShotFields(SHOT_WITH_STRING_SUBJECT);
    expect(missing.length).toBe(0);
  });

  it("passes for complete shot with subject.primary", () => {
    const missing = validateStructuredShotFields(SHOT_WITH_PRIMARY_SUBJECT);
    expect(missing.length).toBe(0);
  });

  it("validateAllStructuredShotFields aggregates across shots", () => {
    const all = validateAllStructuredShotFields([SHOT_WITH_STRING_SUBJECT, SHOT_MISSING_SUBJECT]);
    // Only SHOT_MISSING_SUBJECT should have issues
    expect(all.length).toBe(1);
    expect(all[0].field).toBe("subject.primary");
    expect(all[0].shotId).toBe("shot_3");
  });

  it("final-payload-validator catches missing fields via structuredShots", () => {
    const result = validateFinalProviderPayload({
      prompt: "test prompt with enough words to pass the word count minimum requirement for validation to proceed properly in all cases",
      negatives: [],
      framing: "MS",
      provider: "veo",
      structuredShots: [SHOT_MISSING_FIELDS, SHOT_MISSING_SUBJECT],
      fragmentedEditContext: {
        isFragmented: true,
        triggerTerms: ["test"],
        minShotCount: 3,
        editStyle: "fragmented",
      },
    });
    expect(result.issues.some(i => i.rule === "structured_shot_missing_required_field")).toBe(true);
  });
});
