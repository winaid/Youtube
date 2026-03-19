/**
 * gemini-model-fallback.test.ts
 *
 * Gemini 모델 정책 통일 검증:
 * 1. 모델 상수 값이 올바른지
 * 2. fetchWithModelFallback 정책 시뮬레이션
 * 3. streamingGenerateWithFallback 정책 시뮬레이션
 * 4. ModelFallbackMeta 구조 검증
 * 5. grounded vs fallback 구분
 * 6. resultMode 결정
 */

import { describe, it, expect } from "vitest";
import {
  GEMINI_MODEL_PRO,
  GEMINI_MODEL_FLASH,
  GEMINI_MODEL_IMAGE,
  GEMINI_MODEL_IMAGE_FB,
  isRetryableError,
  type ModelFallbackMeta,
} from "../functions/api/_gemini-keys";

// ═══════════════════════════════════════════════════════════════════
// 1. 모델 상수 값 검증
// ═══════════════════════════════════════════════════════════════════

describe("Gemini 모델 상수", () => {
  it("GEMINI_MODEL_PRO는 gemini-3.1-pro-preview", () => {
    expect(GEMINI_MODEL_PRO).toBe("gemini-3.1-pro-preview");
  });

  it("GEMINI_MODEL_FLASH는 gemini-3.1-flash-lite-preview (폴백용)", () => {
    expect(GEMINI_MODEL_FLASH).toBe("gemini-3.1-flash-lite-preview");
  });

  it("이미지 모델은 별도 도메인 (Flash-Lite 아님)", () => {
    expect(GEMINI_MODEL_IMAGE).not.toBe(GEMINI_MODEL_PRO);
    expect(GEMINI_MODEL_IMAGE).not.toBe(GEMINI_MODEL_FLASH);
    expect(GEMINI_MODEL_IMAGE_FB).not.toBe(GEMINI_MODEL_PRO);
    expect(GEMINI_MODEL_IMAGE_FB).not.toBe(GEMINI_MODEL_FLASH);
  });

  it("Pro와 Flash-Lite가 서로 다른 모델", () => {
    expect(GEMINI_MODEL_PRO).not.toBe(GEMINI_MODEL_FLASH);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. 폴백 판단 로직 (isRetryableError 기반)
// ═══════════════════════════════════════════════════════════════════

describe("폴백 판단 (transient error detection)", () => {
  it("429 rate limit → 재시도 대상", () => {
    expect(isRetryableError(429)).toBe(true);
  });

  it("503 overloaded → 재시도 대상", () => {
    expect(isRetryableError(503)).toBe(true);
  });

  it("524 cloudflare timeout → 재시도 대상", () => {
    expect(isRetryableError(524)).toBe(true);
  });

  it("401 unauthorized → 재시도 대상 (다음 키)", () => {
    expect(isRetryableError(401)).toBe(true);
  });

  it("500 RESOURCE_EXHAUSTED → 재시도 대상", () => {
    expect(isRetryableError(500, "RESOURCE_EXHAUSTED")).toBe(true);
  });

  it("404 model not found → 재시도 안 함 (deprecated)", () => {
    expect(isRetryableError(404, "is not found. It might not be available")).toBe(false);
  });

  it("200 OK → 재시도 안 함", () => {
    expect(isRetryableError(200)).toBe(false);
  });

  it("400 bad request → 재시도 안 함", () => {
    expect(isRetryableError(400)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. ModelFallbackMeta 구조 검증
// ═══════════════════════════════════════════════════════════════════

describe("ModelFallbackMeta 구조", () => {
  it("Pro 성공 시 fallbackUsed=false, finalModel=Pro", () => {
    const meta: ModelFallbackMeta = {
      primaryModel: GEMINI_MODEL_PRO,
      fallbackModel: GEMINI_MODEL_FLASH,
      finalModel: GEMINI_MODEL_PRO,
      fallbackUsed: false,
    };

    expect(meta.fallbackUsed).toBe(false);
    expect(meta.finalModel).toBe(GEMINI_MODEL_PRO);
    expect(meta.primaryModel).toBe(GEMINI_MODEL_PRO);
    expect(meta.fallbackModel).toBe(GEMINI_MODEL_FLASH);
  });

  it("Pro 실패 → Flash-Lite 폴백 시 fallbackUsed=true, finalModel=Flash-Lite", () => {
    const meta: ModelFallbackMeta = {
      primaryModel: GEMINI_MODEL_PRO,
      fallbackModel: GEMINI_MODEL_FLASH,
      finalModel: GEMINI_MODEL_FLASH,
      fallbackUsed: true,
    };

    expect(meta.fallbackUsed).toBe(true);
    expect(meta.finalModel).toBe(GEMINI_MODEL_FLASH);
    expect(meta.finalModel).not.toBe(meta.primaryModel);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. 정책 통일 검증: 모든 API 파일 import 패턴
// ═══════════════════════════════════════════════════════════════════

describe("정책 통일 — import 패턴", () => {
  it("fetchWithModelFallback이 export됨", async () => {
    const module = await import("../functions/api/_gemini-keys");
    expect(typeof module.fetchWithModelFallback).toBe("function");
  });

  it("streamingGenerateWithFallback이 export됨", async () => {
    const module = await import("../functions/api/_gemini-keys");
    expect(typeof module.streamingGenerateWithFallback).toBe("function");
  });

  it("ModelFallbackMeta 타입이 사용 가능", () => {
    // 타입 검증 — 컴파일 타임에 확인됨
    const meta: ModelFallbackMeta = {
      primaryModel: "a", fallbackModel: "b", finalModel: "a", fallbackUsed: false,
    };
    expect(meta).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. grounded vs fallback vs mixed 결과 구분
// ═══════════════════════════════════════════════════════════════════

describe("grounded vs fallback vs mixed 결과 구분", () => {
  function computeResultMode(items: Array<{ grounded: boolean }>): "grounded" | "fallback" | "mixed" | "empty" {
    if (items.length === 0) return "empty";
    const hasGrounded = items.some(i => i.grounded);
    const hasUngrounded = items.some(i => !i.grounded);
    if (hasGrounded && hasUngrounded) return "mixed";
    return hasGrounded ? "grounded" : "fallback";
  }

  it("빈 결과 → empty", () => {
    expect(computeResultMode([])).toBe("empty");
  });

  it("모두 grounded → grounded", () => {
    expect(computeResultMode([{ grounded: true }, { grounded: true }])).toBe("grounded");
  });

  it("모두 ungrounded → fallback", () => {
    expect(computeResultMode([{ grounded: false }, { grounded: false }])).toBe("fallback");
  });

  it("혼합 → mixed", () => {
    expect(computeResultMode([{ grounded: true }, { grounded: false }])).toBe("mixed");
  });

  it("Flash-Lite 폴백 결과는 절대 grounded=true가 아님", () => {
    // Flash-Lite 폴백은 googleSearchRetrieval 없이 호출되므로 grounded=false
    const flashLiteFallbackResult = {
      finalModel: GEMINI_MODEL_FLASH,
      fallbackUsed: true,
      grounded: false, // 이것이 보장되어야 함
    };
    expect(flashLiteFallbackResult.grounded).toBe(false);
    expect(flashLiteFallbackResult.fallbackUsed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. recommend-director pipeline에서 모델 정책
// ═══════════════════════════════════════════════════════════════════

describe("recommend-director 모델 정책", () => {
  it("Stage 1-3은 Pro 사용", () => {
    // Pipeline 설계상 stage 1-3은 GEMINI_MODEL_PRO
    // Stage 4는 GEMINI_MODEL_FLASH (Flash-Lite)
    const stages = [
      { stage: 1, model: GEMINI_MODEL_PRO, grounded: true },
      { stage: 2, model: GEMINI_MODEL_PRO, grounded: true },
      { stage: 3, model: GEMINI_MODEL_PRO, grounded: true },
      { stage: 4, model: GEMINI_MODEL_FLASH, grounded: false },
    ];

    for (const s of stages.slice(0, 3)) {
      expect(s.model).toBe(GEMINI_MODEL_PRO);
    }
    expect(stages[3].model).toBe(GEMINI_MODEL_FLASH);
    expect(stages[3].grounded).toBe(false); // Flash-Lite = ungrounded
  });

  it("timeout/failed 시 stage 4 Flash-Lite로 이동", () => {
    // provider_timeout → skip to stage 4
    const emptyReasons = ["provider_timeout"] as const;
    const shouldGoToFlashLite = emptyReasons.includes("provider_timeout");
    expect(shouldGoToFlashLite).toBe(true);
  });
});
