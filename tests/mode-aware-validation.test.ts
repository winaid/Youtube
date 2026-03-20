/**
 * mode-aware-validation.test.ts — Studio/Batch 모드별 검증 테스트
 *
 * Studio Mode: 엄격한 blocking validation
 * Batch Mode: 느슨한 auto-repair friendly validation
 */

import { describe, it, expect } from "vitest";
import {
  validateStudioMode,
  validateBatchMode,
  validateByMode,
} from "@/lib/multishot-validation";
import { validateFinalProviderPayload } from "@/lib/final-payload-validator";
import { VEO_DEFAULT_MODEL } from "@/lib/veo-capability";
import type { MultiShotPrompt } from "@/types";

const MODEL = VEO_DEFAULT_MODEL;

// ═══════════════════════════════════════════════════════════════════
// Studio Mode Validation
// ═══════════════════════════════════════════════════════════════════

describe("validateStudioMode", () => {
  it("12s cinematic_sequence + 멀티샷 없음 → blocking error", () => {
    const result = validateStudioMode(MODEL, undefined, 12, "cinematic_sequence");
    expect(result.valid).toBe(false);

    const forcedError = result.aggregateIssues.find(i =>
      i.severity === "error" && i.message.includes("멀티샷 필수"),
    );
    expect(forcedError).toBeDefined();
  });

  it("12s + 의도적 원테이크 → blocking 없음", () => {
    const result = validateStudioMode(MODEL, undefined, 12, "cinematic_sequence", true);
    const forcedError = result.aggregateIssues.find(i =>
      i.message.includes("멀티샷 필수"),
    );
    expect(forcedError).toBeUndefined();
  });

  it("3샷 이상에서 peak/resolve 없으면 경고", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "Shot 1", duration: "4", role: "establish" },
      { index: 2, prompt: "Shot 2", duration: "4", role: "develop" },
      { index: 3, prompt: "Shot 3", duration: "4", role: "develop" },
    ];

    const result = validateStudioMode(MODEL, shots, 12);
    const roleWarning = result.aggregateIssues.find(i =>
      i.message.includes("peak/resolve 없음"),
    );
    expect(roleWarning).toBeDefined();
  });

  it("동일 프롬프트 경고", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "Same prompt", duration: "6", role: "establish" },
      { index: 2, prompt: "Same prompt", duration: "6", role: "resolve" },
    ];

    const result = validateStudioMode(MODEL, shots, 12);
    const duplicateWarning = result.aggregateIssues.find(i =>
      i.message.includes("동일"),
    );
    expect(duplicateWarning).toBeDefined();
  });

  it("정상 멀티샷 → valid", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "Opening wide shot", duration: "4", role: "establish" },
      { index: 2, prompt: "Close up detail", duration: "4", role: "peak" },
      { index: 3, prompt: "Reveal the landscape", duration: "4", role: "resolve" },
    ];

    const result = validateStudioMode(MODEL, shots, 12);
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Batch Mode Validation
// ═══════════════════════════════════════════════════════════════════

describe("validateBatchMode", () => {
  it("멀티샷 없어도 blocking 아님", () => {
    const result = validateBatchMode(MODEL, undefined, 12);
    expect(result.valid).toBe(true);
  });

  it("6초+ 멀티샷 없으면 warning (auto-repair 예고)", () => {
    const result = validateBatchMode(MODEL, undefined, 8);
    const autoWarning = result.aggregateIssues.find(i =>
      i.message.includes("자동 생성"),
    );
    expect(autoWarning).toBeDefined();
  });

  it("빈 프롬프트 → error가 아닌 warning으로 다운그레이드", () => {
    const shots: MultiShotPrompt[] = [
      { index: 1, prompt: "", duration: "6", role: "establish" },
      { index: 2, prompt: "Valid prompt", duration: "6", role: "resolve" },
    ];

    const result = validateBatchMode(MODEL, shots, 12);
    // 빈 프롬프트가 warning으로 내려감
    const emptyPromptIssue = result.shotIssues.find(i =>
      i.message.includes("비어있습니다"),
    );
    expect(emptyPromptIssue?.severity).toBe("warning");
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// validateByMode dispatch
// ═══════════════════════════════════════════════════════════════════

describe("validateByMode", () => {
  it("studio 모드 디스패치", () => {
    const result = validateByMode("studio", MODEL, undefined, 12, {
      sceneType: "cinematic_sequence",
    });
    expect(result.valid).toBe(false); // 멀티샷 누락 → blocking
  });

  it("batch 모드 디스패치", () => {
    const result = validateByMode("batch", MODEL, undefined, 12);
    expect(result.valid).toBe(true); // auto-repair 가능
  });
});

// ═══════════════════════════════════════════════════════════════════
// Final Payload Validator — Rule 17 (forced multishot)
// ═══════════════════════════════════════════════════════════════════

describe("final-payload-validator Rule 17", () => {
  const baseInput = {
    prompt: "A vast mountain landscape stretches endlessly under golden hour light. Rolling hills covered in autumn foliage cascade toward the horizon. Wispy clouds drift across the amber sky. Ancient stone formations rise from the misty valley floor. Warm sidelighting creates deep shadows across the rugged terrain surface.",
    negatives: ["watermark"],
    framing: "WS",
    provider: "veo" as const,
    shotCategory: "environment",
    modelId: MODEL,
  };

  it("Studio + 12s + 멀티샷 없음 → error", () => {
    const result = validateFinalProviderPayload({
      ...baseInput,
      durationSec: 12,
      mode: "studio",
    });

    const rule17 = result.issues.find(i => i.rule === "forced_multishot_missing");
    expect(rule17).toBeDefined();
    expect(rule17?.severity).toBe("error");
  });

  it("Batch + 12s + 멀티샷 없음 → warning (not error)", () => {
    const result = validateFinalProviderPayload({
      ...baseInput,
      durationSec: 12,
      mode: "batch",
    });

    const rule17 = result.issues.find(i => i.rule === "forced_multishot_missing");
    expect(rule17).toBeDefined();
    expect(rule17?.severity).toBe("warning");
  });

  it("intentionalOneTake → Rule 17 skip", () => {
    const result = validateFinalProviderPayload({
      ...baseInput,
      durationSec: 12,
      mode: "studio",
      intentionalOneTake: true,
    });

    const rule17 = result.issues.find(i => i.rule === "forced_multishot_missing");
    expect(rule17).toBeUndefined();
  });

  it("멀티샷 있으면 Rule 17 안 뜸", () => {
    const result = validateFinalProviderPayload({
      ...baseInput,
      durationSec: 12,
      mode: "studio",
      multiShots: [
        { index: 1, prompt: "Shot 1 prompt text", duration: "4" },
        { index: 2, prompt: "Shot 2 prompt text", duration: "4" },
        { index: 3, prompt: "Shot 3 prompt text", duration: "4" },
      ],
    });

    const rule17 = result.issues.find(i => i.rule === "forced_multishot_missing");
    expect(rule17).toBeUndefined();
  });

  it("3초 → 강제 아님 → Rule 17 없음", () => {
    const result = validateFinalProviderPayload({
      ...baseInput,
      durationSec: 3,
      mode: "studio",
    });

    const rule17 = result.issues.find(i => i.rule === "forced_multishot_missing");
    expect(rule17).toBeUndefined();
  });
});
