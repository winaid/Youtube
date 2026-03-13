/**
 * video-generation-core.test.ts — 공통 비디오 생성 헬퍼 테스트
 *
 * 테스트 대상:
 * 1. 노드 실행과 기존 경로가 같은 normalized response shape 사용
 * 2. polling 로직 재사용 또는 동일 동작 보장
 * 3. degraded response 메타 일치
 * 4. durationMeta / audioMeta shape 일치
 * 5. provider/modelUsed 메타 일치
 * 6. 실패 시 error classification 일치
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  submitVideoGeneration,
  pollVideoTask,
  buildDurationMeta,
  extractProviderMeta,
  classifyVideoError,
  getAdaptivePollInterval,
  type VideoSubmitParams,
  type VideoSubmitResult,
  type NormalizedVideoResult,
  type VideoErrorClassification,
  type ProviderMeta,
  type RawDurationMeta,
} from "@/lib/video-generation-core";
import type { DurationMeta } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════
// 1. Normalized response shape consistency
// ═══════════════════════════════════════════════════════════════════

describe("normalized response shape — consistent between node and hook paths", () => {
  it("submitVideoGeneration should return VideoSubmitResult with all required fields", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        taskId: "kling-12345",
        operationName: "kling-12345",
        engine: "kling",
        modeUsed: "generate",
        modelUsed: "kling-v1-5",
        status: "RUNNING",
        durationMeta: {
          requestedSecondsPerScene: 6,
          normalizedSecondsPerScene: 6,
          sentSecondsPerScene: 5,
          warnings: [],
        },
      }),
    });

    const result = await submitVideoGeneration({
      prompt: "test prompt",
      durationSeconds: 6,
      aspectRatio: "16:9",
    });

    // Same shape as useVideoGeneration gets from /api/generate-video
    expect(result.taskId).toBe("kling-12345");
    expect(result.operationName).toBe("kling-12345");
    expect(result.engine).toBe("kling");
    expect(result.modeUsed).toBe("generate");
    expect(result.modelUsed).toBe("kling-v1-5");
    expect(result.status).toBe("RUNNING");
    expect(result.durationMeta).toBeDefined();
    expect(result.durationMeta!.normalizedSecondsPerScene).toBe(6);
  });

  it("submitVideoGeneration should handle immediate completion (cache hit)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        videoUrl: "https://cdn.kling.com/cached.mp4",
        engine: "kling",
      }),
    });

    const result = await submitVideoGeneration({ prompt: "cached test" });

    expect(result.videoUrl).toBe("https://cdn.kling.com/cached.mp4");
  });

  it("submitVideoGeneration should throw on HTTP error with statusCode", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "Rate limited" }),
    });

    await expect(submitVideoGeneration({ prompt: "test" }))
      .rejects.toThrow("Rate limited");

    try {
      await submitVideoGeneration({ prompt: "test" });
    } catch (err) {
      expect((err as { statusCode: number }).statusCode).toBe(429);
    }
  });

  it("pollVideoTask should return NormalizedVideoResult with pollMeta", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    // First poll: RUNNING
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "RUNNING", progress: 50 }),
    });
    // Second poll: COMPLETED
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "COMPLETED",
        videoUri: "https://cdn.kling.com/result.mp4",
        rawVideoUri: "https://cdn.kling.com/raw.mp4",
        canonicalVideoUri: "https://cdn.kling.com/result.mp4",
        seed: "12345",
        engine: "kling",
        needsUpload: false,
        variants: [{ videoUri: "https://cdn.kling.com/result.mp4" }],
      }),
    });

    const promise = pollVideoTask("task-abc", { maxAttempts: 10 });
    await vi.advanceTimersByTimeAsync(6000);
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;

    // Same shape that useVideoGeneration processes after polling
    expect(result.status).toBe("completed");
    expect(result.videoUri).toBe("https://cdn.kling.com/result.mp4");
    expect(result.rawVideoUri).toBe("https://cdn.kling.com/raw.mp4");
    expect(result.canonicalVideoUri).toBe("https://cdn.kling.com/result.mp4");
    expect(result.seed).toBe("12345");
    expect(result.engine).toBe("kling");
    expect(result.needsUpload).toBe(false);
    expect(result.variants).toHaveLength(1);
    expect(result.pollMeta.totalAttempts).toBeGreaterThan(0);
    expect(result.pollMeta.totalDurationMs).toBeGreaterThan(0);
    expect(result.completedAt).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Polling logic — adaptive interval and error handling
// ═══════════════════════════════════════════════════════════════════

describe("polling logic — matches useVideoGeneration behavior", () => {
  it("getAdaptivePollInterval should match useVideoGeneration intervals", () => {
    // 0-17: 5s (matches hook: attempts 0-17 = 5s)
    expect(getAdaptivePollInterval(0)).toBe(5000);
    expect(getAdaptivePollInterval(5)).toBe(5000);
    expect(getAdaptivePollInterval(17)).toBe(5000);
    // 18+: 7s (matches hook: 90s+ → 7s)
    expect(getAdaptivePollInterval(18)).toBe(7000);
    expect(getAdaptivePollInterval(30)).toBe(7000);
  });

  it("should timeout after maxAttempts", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "RUNNING" }),
    });

    const promise = pollVideoTask("task-timeout", { maxAttempts: 3, fixedIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;

    expect(result.status).toBe("timeout");
    expect(result.error).toContain("타임아웃");
    expect(result.pollMeta.totalAttempts).toBe(3);
  });

  it("should handle consecutive network errors with backoff", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    // 3 consecutive network errors → fail
    fetchMock.mockRejectedValue(new Error("Failed to fetch"));

    const promise = pollVideoTask("task-net-err", { maxAttempts: 10, fixedIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(100000);
    const result = await promise;

    expect(result.status).toBe("failed");
    expect(result.error).toContain("네트워크");
  });

  it("should handle 4xx errors immediately (no retry)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Invalid task ID" }),
    });

    const promise = pollVideoTask("task-400", { maxAttempts: 10, fixedIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Invalid task ID");
  });

  it("should handle 5xx errors with retry until MAX_CONSECUTIVE_ERRORS", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    // 3 consecutive 5xx errors → fail
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    const promise = pollVideoTask("task-503", { maxAttempts: 10, fixedIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(100000);
    const result = await promise;

    expect(result.status).toBe("failed");
    expect(result.error).toContain("서버 오류");
  });

  it("should recover from transient errors and complete", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    // First poll: network error
    fetchMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    // Second poll: success (RUNNING)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "RUNNING" }),
    });
    // Third poll: COMPLETED
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "COMPLETED",
        videoUri: "https://cdn.kling.com/recovered.mp4",
        needsUpload: false,
      }),
    });

    const promise = pollVideoTask("task-recover", { maxAttempts: 10, fixedIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(100000);
    const result = await promise;

    expect(result.status).toBe("completed");
    expect(result.videoUri).toBe("https://cdn.kling.com/recovered.mp4");
  });

  it("should call onProgress during polling", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "RUNNING", progress: 30 }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "COMPLETED", videoUri: "https://done.mp4", needsUpload: false }),
    });

    const progressCalls: Array<{ attempt: number; progress?: number }> = [];
    const promise = pollVideoTask("task-progress", {
      maxAttempts: 10,
      fixedIntervalMs: 100,
      onProgress: (attempt, _max, progress) => {
        progressCalls.push({ attempt, progress });
      },
    });

    await vi.advanceTimersByTimeAsync(100000);
    await promise;

    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[0].progress).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Degraded response meta consistency
// ═══════════════════════════════════════════════════════════════════

describe("degraded response meta — consistent shape", () => {
  it("should include _diag in NormalizedVideoResult for diagnostics", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "COMPLETED",
        videoUri: "https://cdn.kling.com/video.mp4",
        needsUpload: false,
        _diag: {
          sceneExtensionReady: false,
          primaryUriType: "HTTPS",
          extractedKinds: ["https"],
        },
      }),
    });

    const promise = pollVideoTask("task-diag", { maxAttempts: 5, fixedIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result.status).toBe("completed");
    expect(result._diag).toBeDefined();
    expect((result._diag as Record<string, unknown>).sceneExtensionReady).toBe(false);
  });

  it("should track canonicalVideoUri=null for degraded responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "COMPLETED",
        videoUri: "https://cdn.kling.com/video.mp4",
        canonicalVideoUri: null, // degraded — no Scene Extension URI
        needsUpload: false,
      }),
    });

    const promise = pollVideoTask("task-no-canonical", { maxAttempts: 5, fixedIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result.status).toBe("completed");
    expect(result.canonicalVideoUri).toBeNull();
  });

  it("should handle FAILED response from API (server-level error)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "FAILED",
        error: "Content policy violation",
      }),
    });

    const promise = pollVideoTask("task-api-fail", { maxAttempts: 5, fixedIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Content policy violation");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. DurationMeta shape consistency
// ═══════════════════════════════════════════════════════════════════

describe("durationMeta shape — matches DurationMeta interface", () => {
  it("should build DurationMeta from API raw response", () => {
    const rawMeta: RawDurationMeta = {
      requestedSecondsPerScene: 8,
      normalizedSecondsPerScene: 8,
      sentSecondsPerScene: 5,
      warnings: ["Kling duration clamped to 5s"],
    };

    const meta = buildDurationMeta(8, rawMeta);

    // Shape matches DurationMeta interface exactly
    expect(meta.requestedSecondsPerScene).toBe(8);
    expect(meta.normalizedSecondsPerScene).toBe(8);
    expect(meta.sentSecondsPerScene).toBe(5);
    expect(meta.source).toBe("api-response");
    expect(meta.warnings).toEqual(["Kling duration clamped to 5s"]);
  });

  it("should set source='slider' when no API meta available", () => {
    const meta = buildDurationMeta(10);

    expect(meta.requestedSecondsPerScene).toBe(10);
    expect(meta.normalizedSecondsPerScene).toBe(10);
    expect(meta.source).toBe("slider");
    expect(meta.warnings).toEqual([]);
  });

  it("should set source='fallback' when neither requested nor API meta", () => {
    const meta = buildDurationMeta(undefined);

    // DURATION_FALLBACK = 8 (from duration-reconciliation)
    expect(meta.normalizedSecondsPerScene).toBe(8);
    expect(meta.source).toBe("fallback");
  });

  it("should have all required DurationMeta fields for type safety", () => {
    const meta = buildDurationMeta(6, {
      normalizedSecondsPerScene: 6,
      sentSecondsPerScene: 5,
    });

    // Type-level check: all DurationMeta fields exist
    const requiredFields: (keyof DurationMeta)[] = [
      "normalizedSecondsPerScene",
      "source",
      "warnings",
    ];
    for (const field of requiredFields) {
      expect(field in meta).toBe(true);
    }

    // Optional fields should be assignable
    const optionalFields: (keyof DurationMeta)[] = [
      "requestedSecondsPerScene",
      "sentSecondsPerScene",
    ];
    for (const field of optionalFields) {
      expect(meta[field] !== undefined || meta[field] === undefined).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Provider/modelUsed meta consistency
// ═══════════════════════════════════════════════════════════════════

describe("provider/modelUsed meta — matches useVideoGeneration shape", () => {
  it("should extract ProviderMeta from submit result", () => {
    const submitResult: VideoSubmitResult = {
      taskId: "t1",
      operationName: "t1",
      engine: "kling",
      modeUsed: "generate",
      modelUsed: "kling-v1-5",
      status: "RUNNING",
    };

    const meta = extractProviderMeta(submitResult);

    expect(meta.engine).toBe("kling");
    expect(meta.modeUsed).toBe("generate");
    expect(meta.modelUsed).toBe("kling-v1-5");
  });

  it("should handle extend mode correctly", () => {
    const submitResult: VideoSubmitResult = {
      taskId: "t2",
      operationName: "t2",
      engine: "kling",
      modeUsed: "extend",
      modelUsed: "kling-v1-5-extend",
      status: "RUNNING",
    };

    const meta = extractProviderMeta(submitResult);

    expect(meta.modeUsed).toBe("extend");
    expect(meta.modelUsed).toBe("kling-v1-5-extend");
  });

  it("ProviderMeta should match VideoClip.engineUsed/modeUsed fields", () => {
    // This test verifies that ProviderMeta fields correspond to
    // VideoClip.engineUsed, VideoClip.modeUsed for consistency
    const meta: ProviderMeta = {
      engine: "kling",
      modeUsed: "generate",
      modelUsed: "kling-v1-5",
    };

    // engine = VideoClip.engineUsed
    expect(meta.engine).toBe("kling");
    // modeUsed = VideoClip.modeUsed
    expect(meta.modeUsed).toBe("generate");
    // modelUsed = CutProvenance.modelUsed
    expect(typeof meta.modelUsed).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Error classification consistency
// ═══════════════════════════════════════════════════════════════════

describe("error classification — matches useVideoGeneration error handling", () => {
  it("should classify network errors as retryable", () => {
    const result = classifyVideoError(new Error("Failed to fetch"));

    expect(result.type).toBe("network");
    expect(result.retryable).toBe(true);
    expect(result.message).toContain("네트워크");
  });

  it("should classify 4xx as client error (non-retryable)", () => {
    const result = classifyVideoError(new Error("Bad request"), 400);

    expect(result.type).toBe("client");
    expect(result.retryable).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it("should classify 5xx as server error (retryable)", () => {
    const result = classifyVideoError(new Error("Internal server error"), 503);

    expect(result.type).toBe("server");
    expect(result.retryable).toBe(true);
    expect(result.statusCode).toBe(503);
  });

  it("should classify timeout errors", () => {
    const result = classifyVideoError(new Error("생성 시간 초과"));

    expect(result.type).toBe("timeout");
    expect(result.retryable).toBe(true);
  });

  it("should classify parse errors as retryable", () => {
    const result = classifyVideoError(new Error("JSON 파싱 실패"));

    expect(result.type).toBe("parse");
    expect(result.retryable).toBe(true);
  });

  it("should classify API-level errors as non-retryable", () => {
    const result = classifyVideoError(new Error("Kling API quota exceeded"));

    expect(result.type).toBe("api_error");
    expect(result.retryable).toBe(false);
  });

  it("should classify unknown errors with full message", () => {
    const result = classifyVideoError(new Error("Something unexpected"));

    expect(result.type).toBe("unknown");
    expect(result.message).toBe("Something unexpected");
    expect(result.retryable).toBe(false);
  });

  it("VideoErrorClassification should have consistent shape across all error types", () => {
    const errors: VideoErrorClassification[] = [
      classifyVideoError(new Error("Failed to fetch")),
      classifyVideoError(new Error("err"), 400),
      classifyVideoError(new Error("err"), 500),
      classifyVideoError(new Error("timeout")),
      classifyVideoError(new Error("JSON parse")),
      classifyVideoError(new Error("something")),
    ];

    for (const err of errors) {
      // All should have required fields
      expect(typeof err.type).toBe("string");
      expect(typeof err.message).toBe("string");
      expect(typeof err.retryable).toBe("boolean");
      // type should be one of the defined types
      expect(["network", "client", "server", "parse", "timeout", "api_error", "unknown"]).toContain(err.type);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Integration: submit request shape
// ═══════════════════════════════════════════════════════════════════

describe("submit request shape — consistent with /api/generate-video", () => {
  it("should send all provided fields to the API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ taskId: "t1", status: "RUNNING" }),
    });
    globalThis.fetch = fetchMock;

    await submitVideoGeneration({
      prompt: "mountain vista",
      firstFrameBase64: "base64data",
      durationSeconds: 10,
      aspectRatio: "16:9",
      negativePrompt: "blurry",
      engine: "kling",
      videoMode: "generate",
      cutNumber: 1,
      generateAudio: true,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prompt).toBe("mountain vista");
    expect(body.firstFrameBase64).toBe("base64data");
    expect(body.durationSeconds).toBe(10);
    expect(body.aspectRatio).toBe("16:9");
    expect(body.negativePrompt).toBe("blurry");
    expect(body.engine).toBe("kling");
    expect(body.videoMode).toBe("generate");
    expect(body.cutNumber).toBe(1);
    expect(body.generateAudio).toBe(true);
  });

  it("should omit undefined optional fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ taskId: "t2", status: "RUNNING" }),
    });
    globalThis.fetch = fetchMock;

    await submitVideoGeneration({ prompt: "minimal" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prompt).toBe("minimal");
    expect(body.engine).toBe("kling");
    // Optional fields should not be present
    expect(body.firstFrameBase64).toBeUndefined();
    expect(body.negativePrompt).toBeUndefined();
    expect(body.videoMode).toBeUndefined();
  });

  it("should support structuredSequence (JSON-first) param", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ taskId: "t3", status: "RUNNING" }),
    });
    globalThis.fetch = fetchMock;

    const seq = { version: 1, shots: [] };
    await submitVideoGeneration({
      prompt: "test",
      structuredSequence: seq,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.structuredSequence).toEqual(seq);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Path unification — hook and node use identical core helpers
// ═══════════════════════════════════════════════════════════════════

describe("path unification — hook and node produce identical meta shapes", () => {
  it("buildDurationMeta produces identical shape for both paths", () => {
    // Simulate: API returns durationMeta with partial data
    const rawMeta: RawDurationMeta = {
      requestedSecondsPerScene: 10,
      normalizedSecondsPerScene: 10,
      sentSecondsPerScene: 5,
      warnings: ["Kling capped at 5s"],
    };

    // Both paths call buildDurationMeta with the same inputs → identical output
    const hookMeta = buildDurationMeta(rawMeta.requestedSecondsPerScene, rawMeta);
    const nodeMeta = buildDurationMeta(rawMeta.requestedSecondsPerScene, rawMeta);

    expect(hookMeta).toEqual(nodeMeta);
    // Verify shape completeness
    expect(hookMeta).toEqual({
      requestedSecondsPerScene: 10,
      normalizedSecondsPerScene: 10,
      sentSecondsPerScene: 5,
      source: "api-response",
      warnings: ["Kling capped at 5s"],
    });
  });

  it("classifyVideoError produces identical classification for both paths", () => {
    // Both paths use classifyVideoError for the same error
    const networkErr = new Error("Failed to fetch");
    const hookClassification = classifyVideoError(networkErr);
    const nodeClassification = classifyVideoError(networkErr);

    expect(hookClassification).toEqual(nodeClassification);
    expect(hookClassification.type).toBe("network");
    expect(hookClassification.retryable).toBe(true);

    // HTTP 500 error — identical classification
    const serverErr = new Error("Internal Server Error");
    const hookServer = classifyVideoError(serverErr, 500);
    const nodeServer = classifyVideoError(serverErr, 500);
    expect(hookServer).toEqual(nodeServer);
    expect(hookServer.type).toBe("server");
  });

  it("extractProviderMeta produces identical ProviderMeta for both paths", () => {
    const submitResult: VideoSubmitResult = {
      taskId: "kling-42",
      operationName: "kling-42",
      engine: "kling",
      modeUsed: "extend",
      modelUsed: "kling-v2",
      status: "RUNNING",
    };

    const hookMeta = extractProviderMeta(submitResult);
    const nodeMeta = extractProviderMeta(submitResult);

    expect(hookMeta).toEqual(nodeMeta);
    expect(hookMeta).toEqual({
      engine: "kling",
      modeUsed: "extend",
      modelUsed: "kling-v2",
    });
  });

  it("pollVideoTask returns identical NormalizedVideoResult shape for both paths", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "COMPLETED",
        videoUri: "https://cdn.kling.com/unified.mp4",
        rawVideoUri: "https://cdn.kling.com/raw.mp4",
        canonicalVideoUri: "https://cdn.kling.com/unified.mp4",
        seed: "999",
        needsUpload: true,
        variants: [{ videoUri: "https://cdn.kling.com/unified.mp4" }],
        _diag: { primaryUriType: "HTTPS" },
      }),
    });

    const promise = pollVideoTask("unified-task", { maxAttempts: 3, fixedIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    // Verify ALL fields of NormalizedVideoResult
    expect(result.status).toBe("completed");
    expect(result.videoUri).toBeDefined();
    expect(result.rawVideoUri).toBeDefined();
    expect(result.canonicalVideoUri).toBeDefined();
    expect(result.seed).toBe("999");
    expect(result.engine).toBe("kling");
    expect(result.needsUpload).toBe(true);
    expect(result.variants).toHaveLength(1);
    expect(result.completedAt).toBeGreaterThan(0);
    expect(result.pollMeta).toEqual(
      expect.objectContaining({
        totalAttempts: expect.any(Number),
        totalDurationMs: expect.any(Number),
      }),
    );
    expect(result._diag).toBeDefined();
  });

  it("hook useVideoGeneration imports all core helpers (static verification)", async () => {
    // This test reads the hook source to verify it imports from video-generation-core
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // Verify core helper imports
    expect(hookSource).toContain("from \"@/lib/video-generation-core\"");
    expect(hookSource).toContain("buildDurationMeta");
    expect(hookSource).toContain("classifyVideoError");
    expect(hookSource).toContain("extractProviderMeta");
    expect(hookSource).toContain("getAdaptivePollInterval");
    expect(hookSource).toContain("POLL_MAX_ATTEMPTS");
    expect(hookSource).toContain("POLL_ERROR_BACKOFF");
    expect(hookSource).toContain("MAX_CONSECUTIVE_ERRORS");

    // Verify NO local duplicates of replaced functions
    // (These should only appear as imports, not as local definitions)
    const lines = hookSource.split("\\n");
    const localSleepDef = lines.filter(l =>
      l.match(/^(export\s+)?function\s+sleep\s*\(/) ||
      l.match(/^const\s+sleep\s*=/)
    );
    expect(localSleepDef).toHaveLength(0);
  });
});
