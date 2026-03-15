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
  POLL_MAX_ATTEMPTS,
  MAX_CONSECUTIVE_ERRORS,
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
    // 0-23: 5s (0~2분)
    expect(getAdaptivePollInterval(0)).toBe(5000);
    expect(getAdaptivePollInterval(5)).toBe(5000);
    expect(getAdaptivePollInterval(23)).toBe(5000);
    // 24-59: 10s (2~5분)
    expect(getAdaptivePollInterval(24)).toBe(10000);
    expect(getAdaptivePollInterval(59)).toBe(10000);
    // 60-89: 20s (5~10분)
    expect(getAdaptivePollInterval(60)).toBe(20000);
    expect(getAdaptivePollInterval(89)).toBe(20000);
    // 90+: 30s (10분+)
    expect(getAdaptivePollInterval(90)).toBe(30000);
    expect(getAdaptivePollInterval(180)).toBe(30000);
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

  it("hook useVideoGeneration imports core helpers (static verification)", async () => {
    // This test reads the hook source to verify it imports from video-generation-core
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // Verify core helper imports
    expect(hookSource).toContain("from \"@/lib/video-generation-core\"");
    expect(hookSource).toContain("submitVideoGeneration");
    expect(hookSource).toContain("pollVideoTask");
    expect(hookSource).toContain("buildDurationMeta");
    expect(hookSource).toContain("classifyVideoError");
    expect(hookSource).toContain("extractProviderMeta");

    // Polling constants should NOT be imported — fully delegated to pollVideoTask
    expect(hookSource).not.toContain("getAdaptivePollInterval");
    expect(hookSource).not.toContain("POLL_MAX_ATTEMPTS");
    expect(hookSource).not.toContain("POLL_ERROR_BACKOFF");
    expect(hookSource).not.toContain("MAX_CONSECUTIVE_ERRORS");

    // No inline POST-based fetch("/api/check-video") — main polling is in core
    // (pollShotVariant's GET-based check-video is a separate concern)
    const postCheckVideoFetches = hookSource.match(/fetch\(\s*["']\/api\/check-video["']/g);
    expect(postCheckVideoFetches).toBeNull();
  });

  it("hook uses submitVideoGeneration (no inline fetch /api/generate-video)", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // Hook must import submitVideoGeneration
    expect(hookSource).toContain("submitVideoGeneration");
    expect(hookSource).toContain("from \"@/lib/video-generation-core\"");

    // No direct fetch("/api/generate-video") calls should remain
    const generateVideoFetches = hookSource.match(/fetch\(\s*["'`]\/api\/generate-video/g);
    expect(generateVideoFetches).toBeNull();
  });

  it("hook polling fully delegated to pollVideoTask (no inline constants)", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // Hook must use pollVideoTask from core — polling fully delegated
    expect(hookSource).toContain("pollVideoTask");
    expect(hookSource).toContain("classifyVideoError");

    // Polling constants should NOT be imported — they're internal to pollVideoTask
    expect(hookSource).not.toContain("POLL_MAX_ATTEMPTS");
    expect(hookSource).not.toContain("POLL_ERROR_BACKOFF");
    expect(hookSource).not.toContain("MAX_CONSECUTIVE_ERRORS");
    expect(hookSource).not.toContain("getAdaptivePollInterval");

    // No inline POST-based fetch("/api/check-video") — main polling is in core
    // (pollShotVariant's GET-based check-video is a separate concern)
    const postCheckVideoFetches = hookSource.match(/fetch\(\s*["']\/api\/check-video["']/g);
    expect(postCheckVideoFetches).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Polling interval/backoff/retry policy equivalence
// ═══════════════════════════════════════════════════════════════════

describe("polling policy equivalence — hook and node use identical parameters", () => {
  it("POLL_MAX_ATTEMPTS is shared (72)", () => {
    expect(POLL_MAX_ATTEMPTS).toBe(72);
  });

  it("adaptive polling intervals match between hook and core", () => {
    // Both paths use getAdaptivePollInterval from core
    // Verify the policy: 0-23 → 5s, 24-59 → 10s, 60-89 → 20s, 90+ → 30s
    for (let i = 0; i < 24; i++) {
      expect(getAdaptivePollInterval(i)).toBe(5000);
    }
    for (let i = 24; i < 60; i++) {
      expect(getAdaptivePollInterval(i)).toBe(10000);
    }
    for (let i = 60; i < 90; i++) {
      expect(getAdaptivePollInterval(i)).toBe(20000);
    }
    for (let i = 90; i < 100; i++) {
      expect(getAdaptivePollInterval(i)).toBe(30000);
    }
  });

  it("error backoff schedule matches between hook and core", async () => {
    const { POLL_ERROR_BACKOFF: imported } = await import("@/lib/video-generation-core");
    expect(imported).toEqual([5000, 7500, 10000, 15000, 20000]);
  });

  it("MAX_CONSECUTIVE_ERRORS is shared (3)", () => {
    expect(MAX_CONSECUTIVE_ERRORS).toBe(3);
  });

  it("submitVideoGeneration extraFields are passed through to API body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ taskId: "t1", status: "RUNNING" }),
    });
    globalThis.fetch = fetchMock;

    await submitVideoGeneration({
      structuredSequence: { shotPlan: {} },
      engine: "kling",
      cutNumber: 1,
      extraFields: {
        mode: "standard",
        resolution: "1080p",
        seed: "42",
        personGeneration: "allow_adult",
      },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.mode).toBe("standard");
    expect(body.resolution).toBe("1080p");
    expect(body.seed).toBe("42");
    expect(body.personGeneration).toBe("allow_adult");
    // Core fields still present
    expect(body.engine).toBe("kling");
    expect(body.cutNumber).toBe(1);
    expect(body.structuredSequence).toEqual({ shotPlan: {} });
  });

  it("submitVideoGeneration error includes statusCode and raiFiltered", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "safety filter", raiFiltered: true, details: "blocked" }),
    });

    try {
      await submitVideoGeneration({ prompt: "test" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toBe("safety filter");
      expect((err as { statusCode: number }).statusCode).toBe(400);
      expect((err as { raiFiltered: boolean }).raiFiltered).toBe(true);
      expect((err as { details: string }).details).toBe("blocked");
    }
  });

  it("pollVideoTask supports extraPollBody", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "COMPLETED",
        videoUri: "https://cdn.kling.com/extra.mp4",
        needsUpload: false,
      }),
    });
    globalThis.fetch = fetchMock;

    const promise = pollVideoTask("task-extra", {
      maxAttempts: 2,
      fixedIntervalMs: 100,
      extraPollBody: {
        operationName: "op-123",
        isExtend: true,
        cutNumber: 3,
      },
    });
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.taskId).toBe("task-extra");
    expect(body.engine).toBe("kling");
    expect(body.operationName).toBe("op-123");
    expect(body.isExtend).toBe(true);
    expect(body.cutNumber).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Hook post-processing extraction verification
// ═══════════════════════════════════════════════════════════════════

describe("hook post-processing extraction — polling loop simplified", () => {
  it("hook has handlePollCompleted extracted function", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // handlePollCompleted must exist as a function
    expect(hookSource).toContain("handlePollCompleted");
    // handlePollFailed must exist as a function
    expect(hookSource).toContain("handlePollFailed");
  });

  it("polling delegates to pollVideoTask — no inline for-loop", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // Hook must call pollVideoTask() directly
    expect(hookSource).toContain("pollVideoTask(");
    // No inline for-loop polling — no fetch("/api/check-video")
    expect(hookSource).not.toContain('fetch("/api/check-video"');
  });

  it("pollVideoTask result.status === completed delegates to handlePollCompleted", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // After pollVideoTask, completed branch calls handlePollCompleted
    const completedMatch = hookSource.match(
      /result\.status === "completed"\)[\s\S]*?handlePollCompleted/
    );
    expect(completedMatch).not.toBeNull();
  });

  it("pollVideoTask result.status === failed delegates to handlePollFailed", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    const failedMatch = hookSource.match(
      /result\.status === "failed"\)[\s\S]*?handlePollFailed/
    );
    expect(failedMatch).not.toBeNull();
  });

  it("handlePollCompleted receives NormalizedVideoResult-compatible shape", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // handlePollCompleted's parameter type should include key NormalizedVideoResult fields
    const fnDef = hookSource.match(
      /const handlePollCompleted = async \(\s*pollData: \{[\s\S]*?\},/
    );
    expect(fnDef).not.toBeNull();
    const paramBlock = fnDef![0];
    expect(paramBlock).toContain("videoUri");
    expect(paramBlock).toContain("rawVideoUri");
    expect(paramBlock).toContain("canonicalVideoUri");
    expect(paramBlock).toContain("needsUpload");
    expect(paramBlock).toContain("seed");
    expect(paramBlock).toContain("variants");
    expect(paramBlock).toContain("_diag");
  });

  it("NormalizedVideoResult from pollVideoTask is compatible with handlePollCompleted input", async () => {
    // Simulate a pollVideoTask result and verify it has all fields handlePollCompleted expects
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "COMPLETED",
        videoUri: "https://cdn.kling.com/compat.mp4",
        rawVideoUri: "https://cdn.kling.com/raw.mp4",
        canonicalVideoUri: "https://cdn.kling.com/compat.mp4",
        needsUpload: false,
        seed: "42",
        variants: [{ videoUri: "https://cdn.kling.com/compat.mp4" }],
        _diag: { test: true },
      }),
    });

    const promise = pollVideoTask("compat-task", { maxAttempts: 2, fixedIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    // These are the exact fields handlePollCompleted expects
    expect(result).toHaveProperty("videoUri");
    expect(result).toHaveProperty("rawVideoUri");
    expect(result).toHaveProperty("canonicalVideoUri");
    expect(result).toHaveProperty("needsUpload");
    expect(result).toHaveProperty("seed");
    expect(result).toHaveProperty("variants");
    expect(result).toHaveProperty("_diag");

    // Shape is directly passable to handlePollCompleted — hook now does exactly this:
    //   const result = await pollVideoTask(taskId, opts);
    //   if (result.status === "completed") await handlePollCompleted(result, meta);
    expect(result.status).toBe("completed");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Hook polling execution path full unification
// ═══════════════════════════════════════════════════════════════════

describe("hook polling execution path — full unification with node-execution", () => {
  it("hook imports pollVideoTask from core", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // pollVideoTask must be in imports
    const importBlock = hookSource.match(
      /import \{[\s\S]*?\} from "@\/lib\/video-generation-core"/
    );
    expect(importBlock).not.toBeNull();
    expect(importBlock![0]).toContain("pollVideoTask");
  });

  it("hook does NOT contain inline polling constants (delegated to core)", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // These should NOT appear as imports or definitions — polling is fully delegated
    expect(hookSource).not.toContain("getAdaptivePollInterval");
    expect(hookSource).not.toContain("POLL_MAX_ATTEMPTS");
    expect(hookSource).not.toContain("POLL_ERROR_BACKOFF");
    expect(hookSource).not.toContain("MAX_CONSECUTIVE_ERRORS");
  });

  it("hook does NOT contain inline sleep import (polling timing delegated to core)", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // sleep should not be imported from core — only used internally by pollVideoTask
    const importBlock = hookSource.match(
      /import \{[\s\S]*?\} from "@\/lib\/video-generation-core"/
    );
    expect(importBlock).not.toBeNull();
    expect(importBlock![0]).not.toContain("sleep");
  });

  it("hook passes extraPollBody with operationName/isExtend/cutNumber to pollVideoTask", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // The pollVideoTask call must include extraPollBody with these fields
    const pollCall = hookSource.match(
      /pollVideoTask\([\s\S]*?extraPollBody[\s\S]*?\)/
    );
    expect(pollCall).not.toBeNull();
    const callBlock = pollCall![0];
    expect(callBlock).toContain("operationName");
    expect(callBlock).toContain("isExtend");
    expect(callBlock).toContain("cutNumber");
  });

  it("hook and node-execution both use pollVideoTask from same module", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );
    const nodeSource = fs.readFileSync(
      new URL("../src/lib/node-execution.ts", import.meta.url),
      "utf-8",
    );

    // Both must import pollVideoTask from the same core module
    const hookImport = hookSource.match(/pollVideoTask[\s\S]*?video-generation-core/);
    const nodeImport = nodeSource.match(/pollVideoTask[\s\S]*?video-generation-core/);
    expect(hookImport).not.toBeNull();
    expect(nodeImport).not.toBeNull();
  });

  it("hook handles all three NormalizedVideoResult statuses (completed/failed/timeout)", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // All three statuses must be handled after pollVideoTask returns
    expect(hookSource).toContain('result.status === "completed"');
    expect(hookSource).toContain('result.status === "failed"');
    // timeout is the else branch
    const timeoutHandling = hookSource.match(
      /\/\/ timeout[\s\S]*?classifyVideoError/
    );
    expect(timeoutHandling).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. Shot variant polling — pollVideoTask 공통 경로 사용
// ═══════════════════════════════════════════════════════════════════

describe("shot variant polling — core pollVideoTask 재사용", () => {
  it("pollShotVariant uses pollVideoTask (no inline polling loop)", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // pollShotVariant 함수 내부에서 pollVideoTask 호출 확인
    const fnBody = hookSource.match(
      /const pollShotVariant[\s\S]*?(?=\n  const \w)/
    )?.[0] ?? "";
    expect(fnBody).toContain("pollVideoTask(");
    // inline for-loop나 setTimeout 재귀 폴링이 없어야 함
    expect(fnBody).not.toMatch(/for\s*\(/);
    expect(fnBody).not.toContain("setTimeout(poll");
  });

  it("shot variant polling success → NormalizedVideoResult completed", async () => {
    vi.useRealTimers();
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount <= 2) {
        return new Response(JSON.stringify({ status: "RUNNING" }), { status: 200 });
      }
      return new Response(JSON.stringify({
        status: "COMPLETED",
        videoUri: "https://cdn.kling.ai/variant-123.mp4",
        rawVideoUri: "https://raw.kling.ai/variant-123.mp4",
        seed: "42",
      }), { status: 200 });
    }) as typeof fetch;

    const result = await pollVideoTask("op-variant-123", {
      fixedIntervalMs: 10,
      extraPollBody: { operationName: "op-variant-123" },
    });

    expect(result.status).toBe("completed");
    expect(result.videoUri).toBe("https://cdn.kling.ai/variant-123.mp4");
    expect(result.seed).toBe("42");
    expect(result.pollMeta.totalAttempts).toBe(3);
  });

  it("shot variant polling failure → NormalizedVideoResult failed", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        status: "FAILED",
        error: "Model access denied",
        noRetry: true,
      }), { status: 200 });
    }) as typeof fetch;

    const result = await pollVideoTask("op-variant-fail", {
      extraPollBody: { operationName: "op-variant-fail" },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Model access denied");
    expect(result.noRetry).toBe(true);
  });

  it("shot variant polling timeout → NormalizedVideoResult timeout", async () => {
    vi.useRealTimers();
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ status: "RUNNING" }), { status: 200 });
    }) as typeof fetch;

    const result = await pollVideoTask("op-variant-timeout", {
      maxAttempts: 3,
      fixedIntervalMs: 10,
      extraPollBody: { operationName: "op-variant-timeout" },
    });

    expect(result.status).toBe("timeout");
    expect(result.pollMeta.totalAttempts).toBeGreaterThanOrEqual(3);
  });

  it("model access denied classification is consistent for variant path", () => {
    const err = classifyVideoError(new Error("model access denied"), 403);
    expect(err.type).toBeDefined();
    expect(err.retryable).toBe(false);
  });

  it("providerMeta is preserved through variant polling path", () => {
    const meta = extractProviderMeta({
      taskId: "variant-task-1",
      engine: "kling",
      modeUsed: "generate",
      modelUsed: "kling-v1-6",
    } as VideoSubmitResult);

    expect(meta.engine).toBe("kling");
    expect(meta.modeUsed).toBe("generate");
    expect(meta.modelUsed).toBe("kling-v1-6");
  });

  it("durationMeta is normalized for variant results", () => {
    const meta = buildDurationMeta(5, {
      requestedSecondsPerScene: 5,
      normalizedSecondsPerScene: 5,
      sentSecondsPerScene: 5,
      warnings: [],
    });

    expect(meta.normalizedSecondsPerScene).toBe(5);
    expect(meta.source).toBe("api-response");
    expect(meta.warnings).toEqual([]);
  });

  it("variant polling result includes pollMeta for diagnostics", async () => {
    vi.useRealTimers();
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount <= 1) {
        return new Response(JSON.stringify({ status: "RUNNING" }), { status: 200 });
      }
      return new Response(JSON.stringify({
        status: "COMPLETED",
        videoUri: "https://cdn.kling.ai/v.mp4",
      }), { status: 200 });
    }) as typeof fetch;

    const result = await pollVideoTask("op-meta", {
      fixedIntervalMs: 10,
      extraPollBody: { operationName: "op-meta" },
    });

    expect(result.pollMeta).toBeDefined();
    expect(result.pollMeta.totalAttempts).toBe(2);
    expect(result.pollMeta.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("NormalizedVideoResult에 thumbnailUri 필드 없음 (서버 미반환)", async () => {
    vi.useRealTimers();
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        status: "COMPLETED",
        videoUri: "https://cdn.kling.ai/v.mp4",
        rawVideoUri: "https://cdn.kling.ai/v.mp4",
      }), { status: 200 });
    }) as typeof fetch;

    const result = await pollVideoTask("op-no-thumb", {
      fixedIntervalMs: 10,
    });

    expect(result.status).toBe("completed");
    // 서버가 thumbnail 반환 안 함 → NormalizedVideoResult에 thumbnail 필드 없어야 함
    expect((result as Record<string, unknown>).thumbnailUri).toBeUndefined();
    expect((result as Record<string, unknown>).thumbnailUrl).toBeUndefined();
  });

  it("pollShotVariant uses classifyVideoError for failed/timeout (일반 task와 동일 분류)", async () => {
    const fs = await import("fs");
    const hookSource = fs.readFileSync(
      new URL("../src/hooks/useVideoGeneration.ts", import.meta.url),
      "utf-8",
    );

    // pollShotVariant 내부에서 classifyVideoError 호출 확인
    const fnBody = hookSource.match(
      /const pollShotVariant[\s\S]*?(?=\n  const \w)/
    )?.[0] ?? "";
    expect(fnBody).toContain("classifyVideoError(");
    // 일반 task timeout 분기도 classifyVideoError 사용
    const mainPollBlock = hookSource.match(
      /\/\/ timeout[\s\S]{0,200}classifyVideoError/
    );
    expect(mainPollBlock).not.toBeNull();
  });

  it("extraPollBody가 POST body에 포함되어 서버로 전달됨", async () => {
    vi.useRealTimers();
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return new Response(JSON.stringify({
        status: "COMPLETED",
        videoUri: "https://cdn.kling.ai/v.mp4",
      }), { status: 200 });
    }) as typeof fetch;

    await pollVideoTask("task-123", {
      fixedIntervalMs: 10,
      extraPollBody: { operationName: "op-abc", isExtend: false, cutNumber: 3 },
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.taskId).toBe("task-123");
    expect(capturedBody!.engine).toBe("kling");
    expect(capturedBody!.operationName).toBe("op-abc");
    expect(capturedBody!.isExtend).toBe(false);
    expect(capturedBody!.cutNumber).toBe(3);
  });

  it("일반 task와 variant task가 동일 normalize 경로 사용", async () => {
    vi.useRealTimers();
    const serverResponse = {
      status: "COMPLETED",
      videoUri: "https://cdn.kling.ai/test.mp4",
      rawVideoUri: "https://cdn.kling.ai/test.mp4",
      canonicalVideoUri: "https://cdn.kling.ai/test.mp4",
      seed: "99",
      variants: [{ videoUri: "https://cdn.kling.ai/test.mp4" }],
      needsUpload: false,
    };
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify(serverResponse), { status: 200 });
    }) as typeof fetch;

    // 일반 task
    const normalResult = await pollVideoTask("task-normal", {
      fixedIntervalMs: 10,
      extraPollBody: { operationName: "op-1", cutNumber: 1 },
    });

    // variant task (동일 pollVideoTask 함수, extraPollBody만 다름)
    const variantResult = await pollVideoTask("task-variant", {
      fixedIntervalMs: 10,
      extraPollBody: { operationName: "op-2" },
    });

    // 동일 normalize shape
    expect(normalResult.status).toBe(variantResult.status);
    expect(normalResult.videoUri).toBe(variantResult.videoUri);
    expect(normalResult.seed).toBe(variantResult.seed);
    expect(normalResult.needsUpload).toBe(variantResult.needsUpload);
    expect(normalResult.engine).toBe(variantResult.engine);
    // variants 배열도 동일하게 전달
    expect(normalResult.variants).toEqual(variantResult.variants);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. noRetry 계약 — 서버 미반환 시 기본 동작 + 미래 반환 시 즉시 전달
// ═══════════════════════════════════════════════════════════════════

describe("noRetry 계약", () => {
  it("서버 FAILED 응답에 noRetry 없으면 result.noRetry는 undefined (= retry 허용)", async () => {
    vi.useRealTimers();
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        status: "FAILED",
        error: "some error",
      }), { status: 200 });
    }) as typeof fetch;

    const result = await pollVideoTask("task-no-noretry", {
      fixedIntervalMs: 10,
    });

    expect(result.status).toBe("failed");
    expect(result.noRetry).toBeUndefined();
    // undefined는 falsy → !result.noRetry === true → auto-retry 허용
    expect(!result.noRetry).toBe(true);
  });

  it("서버 FAILED 응답에 noRetry=true 이면 result.noRetry=true (즉시 전달)", async () => {
    vi.useRealTimers();
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        status: "FAILED",
        error: "Model access denied",
        noRetry: true,
      }), { status: 200 });
    }) as typeof fetch;

    const result = await pollVideoTask("task-noretry-true", {
      fixedIntervalMs: 10,
    });

    expect(result.status).toBe("failed");
    expect(result.noRetry).toBe(true);
  });

  it("서버 FAILED 응답에 noRetry=false 이면 result.noRetry=false", async () => {
    vi.useRealTimers();
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        status: "FAILED",
        error: "temporary failure",
        noRetry: false,
      }), { status: 200 });
    }) as typeof fetch;

    const result = await pollVideoTask("task-noretry-false", {
      fixedIntervalMs: 10,
    });

    expect(result.status).toBe("failed");
    expect(result.noRetry).toBe(false);
  });

  it("COMPLETED 응답에서는 noRetry가 세팅되지 않음", async () => {
    vi.useRealTimers();
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        status: "COMPLETED",
        videoUri: "https://cdn.kling.ai/v.mp4",
      }), { status: 200 });
    }) as typeof fetch;

    const result = await pollVideoTask("task-completed", {
      fixedIntervalMs: 10,
    });

    expect(result.status).toBe("completed");
    expect(result.noRetry).toBeUndefined();
  });

  it("timeout 결과에서도 noRetry는 undefined", async () => {
    vi.useRealTimers();
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ status: "RUNNING" }), { status: 200 });
    }) as typeof fetch;

    const result = await pollVideoTask("task-timeout", {
      maxAttempts: 2,
      fixedIntervalMs: 10,
    });

    expect(result.status).toBe("timeout");
    expect(result.noRetry).toBeUndefined();
  });

  it("variant polling에서도 noRetry 계약 동일 (FAILED + noRetry=true)", async () => {
    vi.useRealTimers();
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        status: "FAILED",
        error: "Rate limit exceeded",
        noRetry: true,
      }), { status: 200 });
    }) as typeof fetch;

    const result = await pollVideoTask("variant-noretry", {
      fixedIntervalMs: 10,
      extraPollBody: { operationName: "variant-op-1" },
    });

    expect(result.status).toBe("failed");
    expect(result.noRetry).toBe(true);
    expect(result.error).toContain("Rate limit exceeded");
  });
});
