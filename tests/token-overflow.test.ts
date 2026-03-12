/**
 * Token overflow 방어 테스트
 *
 * 테스트 시나리오:
 * 1. compact QA 변환이 올바른지
 * 2. compact QA → 원본 복원이 정확한지
 * 3. step1 토큰 예산 계산이 합리적인지
 * 4. fallback 원인 분류가 정확한지
 * 5. safeParseObj가 잘린 JSON을 최대한 복구하는지
 *
 * 실행: npx vitest run tests/token-overflow.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  preflightQualityCheck,
  toCompactQA,
  fromCompactQA,
} from "@/lib/gemini-quality-check";
import type { StructuredSequenceDocument } from "@/types";

// ── 1. Compact QA 변환 테스트 ─────────────────────────────────────

describe("Compact QA conversion", () => {
  // 최소 유효 StructuredSequenceDocument 생성
  function makeMinimalSeq(overrides: Partial<StructuredSequenceDocument> = {}): StructuredSequenceDocument {
    return {
      sequenceId: "seq-1",
      shotId: "shot-1",
      cutNumber: 1,
      sceneType: "character-driven",
      durationSec: 8,
      styleProfile: { mode: "live_action" },
      continuity: { lighting: "warm", mustPersist: [] },
      physicsRules: {
        hasWind: true,
        hasAtmosphere: true,
        hasAudibleEnvironment: true,
        gravity: "earth",
        bannedExpressions: [],
        environmentType: "earth_outdoor",
      },
      placeIdentityAnchors: ["dental clinic"],
      situationEvidence: ["empty waiting room"],
      naturalMotion: ["dust floating"],
      cameraPlan: { baseFraming: "MS", angle: "eye-level", motion: "push-in" },
      temporalBeats: [
        { startSec: 0, endSec: 3, focus: "location" },
        { startSec: 3, endSec: 8, focus: "emotion" },
      ],
      densityScore: {
        total: 80,
        breakdown: {
          hasPlaceAnchors: true,
          hasEvidence: true,
          hasTemporalBeats: true,
          hasCameraPlan: true,
          hasPhysicsRules: true,
          hasNaturalMotion: true,
          hasExplicitLight: true,
          hasContinuity: true,
        },
        missing: [],
      },
      shots: [],
      shotPlan: {
        shotId: "shot-1",
        timing: { startSec: 0, endSec: 8 },
        camera: { framing: "MS", angle: "eye-level", motion: "push-in" },
        subject: { primary: "doctor", action: "slumps at desk" },
        environment: "dental clinic",
        moodLighting: "cold fluorescent from above",
        focus: "emotional state",
      } as StructuredSequenceDocument["shotPlan"],
      ...overrides,
    } as StructuredSequenceDocument;
  }

  it("toCompactQA produces minimal output", () => {
    const seq = makeMinimalSeq();
    const result = preflightQualityCheck(seq);
    const compact = toCompactQA(result);

    expect(compact).toHaveProperty("valid");
    expect(compact).toHaveProperty("score");
    expect(compact).toHaveProperty("issues");
    expect(compact).toHaveProperty("autoFixes");
    expect(typeof compact.valid).toBe("boolean");
    expect(typeof compact.score).toBe("number");
    expect(Array.isArray(compact.issues)).toBe(true);
    expect(Array.isArray(compact.autoFixes)).toBe(true);
  });

  it("compact issues use abbreviated severity", () => {
    const seq = makeMinimalSeq({ sceneType: "unknown" });
    const result = preflightQualityCheck(seq);
    const compact = toCompactQA(result);

    for (const issue of compact.issues) {
      expect(["e", "w"]).toContain(issue.sev);
      expect(issue.msg.length).toBeLessThanOrEqual(50);
    }
  });

  it("roundtrip: toCompactQA → fromCompactQA preserves semantics", () => {
    const seq = makeMinimalSeq({ sceneType: "unknown" });
    const original = preflightQualityCheck(seq);
    const compact = toCompactQA(original);
    const restored = fromCompactQA(compact);

    expect(restored.valid).toBe(original.valid);
    expect(restored.score).toBe(original.score);
    expect(restored.issues.length).toBe(original.issues.length);
    expect(restored.autoFixCount).toBe(original.autoFixCount);
  });
});

// ── 2. Token budget 계산 테스트 ──────────────────────────────────

describe("Token budget estimation", () => {
  function estimateStep1Tokens(cutCount: number): number {
    const estimatedTokens = 200 + cutCount * 400 + 200;
    return Math.min(8192, Math.max(4096, Math.ceil(estimatedTokens * 1.5)));
  }

  it("4 cuts → at least 4096 tokens", () => {
    expect(estimateStep1Tokens(4)).toBeGreaterThanOrEqual(4096);
  });

  it("8 cuts → higher than 4 cuts", () => {
    expect(estimateStep1Tokens(8)).toBeGreaterThan(estimateStep1Tokens(4));
  });

  it("10 cuts → capped at 8192", () => {
    expect(estimateStep1Tokens(10)).toBeLessThanOrEqual(8192);
  });

  it("15 cuts → capped at 8192", () => {
    expect(estimateStep1Tokens(15)).toBeLessThanOrEqual(8192);
  });
});

// ── 3. Fallback 원인 분류 테스트 ─────────────────────────────────

describe("Fallback cause classification", () => {
  function classifyFallback(errStr: string): string {
    if (errStr.includes("토큰 한도") || errStr.includes("MAX_TOKENS") || errStr.includes("truncat")) {
      return "MAX_TOKENS";
    } else if (errStr.includes("MISSING_API_KEY")) {
      return "MISSING_API_KEY";
    } else if (errStr.includes("INVALID_API_KEY")) {
      return "INVALID_API_KEY";
    } else if (errStr.includes("MODEL_NOT_FOUND") || errStr.includes("deprecated")) {
      return "MODEL_NOT_FOUND";
    } else if (errStr.includes("429") || errStr.includes("quota") || errStr.includes("QUOTA")) {
      return "QUOTA_EXCEEDED";
    } else if (errStr.includes("fetch") || errStr.includes("network") || errStr.includes("ECONNREFUSED")) {
      return "NETWORK_ERROR";
    }
    return "UNKNOWN";
  }

  it("MAX_TOKENS error classified correctly", () => {
    expect(classifyFallback("토큰 한도 초과 (step 1): output was truncated")).toBe("MAX_TOKENS");
    expect(classifyFallback("Error: MAX_TOKENS reached")).toBe("MAX_TOKENS");
    expect(classifyFallback("step1 truncated & parse failed")).toBe("MAX_TOKENS");
  });

  it("API key errors classified correctly", () => {
    expect(classifyFallback("MISSING_API_KEY: set GEMINI_API_KEY")).toBe("MISSING_API_KEY");
    expect(classifyFallback("INVALID_API_KEY: key expired")).toBe("INVALID_API_KEY");
  });

  it("Model errors classified correctly", () => {
    expect(classifyFallback("MODEL_NOT_FOUND: gemini-2.0 deprecated")).toBe("MODEL_NOT_FOUND");
    expect(classifyFallback("model deprecated and no longer available")).toBe("MODEL_NOT_FOUND");
  });

  it("Quota/rate limit errors classified correctly", () => {
    expect(classifyFallback("Error 429: rate limited")).toBe("QUOTA_EXCEEDED");
    expect(classifyFallback("QUOTA_EXCEEDED: daily limit")).toBe("QUOTA_EXCEEDED");
  });

  it("Network errors classified correctly", () => {
    expect(classifyFallback("TypeError: fetch failed")).toBe("NETWORK_ERROR");
    expect(classifyFallback("ECONNREFUSED: connection refused")).toBe("NETWORK_ERROR");
  });

  it("Unknown errors classified as UNKNOWN", () => {
    expect(classifyFallback("Something went wrong")).toBe("UNKNOWN");
  });
});

// ── 4. JSON 부분 복구 테스트 ────────────────────────────────────

describe("Truncated JSON recovery", () => {
  function safeParseObj(text: string): Record<string, unknown> | null {
    const t = text.trim();
    try { return JSON.parse(t) as Record<string, unknown>; } catch { /* */ }
    try {
      const m = t.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]) as Record<string, unknown>;
    } catch { /* */ }
    return null;
  }

  it("parses complete JSON", () => {
    const json = '{"characterSeeds":[],"outlines":[{"cutNumber":1}]}';
    const result = safeParseObj(json);
    expect(result).not.toBeNull();
    expect(result?.outlines).toBeDefined();
  });

  it("extracts JSON from markdown wrapper", () => {
    const wrapped = '```json\n{"characterSeeds":[],"outlines":[]}\n```';
    const result = safeParseObj(wrapped);
    expect(result).not.toBeNull();
  });

  it("returns null for badly truncated JSON", () => {
    const truncated = '{"characterSeeds":[],"outlines":[{"cutNumber":1,"sceneKo":"장면';
    const result = safeParseObj(truncated);
    expect(result).toBeNull();
  });

  it("recovers JSON with trailing garbage", () => {
    const withGarbage = '{"characterSeeds":[],"outlines":[]} some extra text';
    const result = safeParseObj(withGarbage);
    expect(result).not.toBeNull();
  });
});
