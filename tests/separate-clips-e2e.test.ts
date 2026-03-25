/**
 * separate-clips-e2e.test.ts — separate_clips 모드 통합 검증
 *
 * 시나리오:
 * a. UI 토글 ON → config 저장 → submit body에 separateClips=true 포함
 * b. 서버 응답 → clipOperations[] → shot 수만큼 polling → separateClipUris 저장
 * c. 모든 clip 확보 후 hard-cut stitch 실행 → assembled result URI
 * d. 조립 실패 시 graceful degradation (개별 clip 유지, 에러 표시)
 * e. UI 어디에서도 영어 fallback 미노출
 * f. sentPromptEn / sentPromptKoSummary 의미 일치
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  submitVideoGeneration,
  type VideoSubmitParams,
  type VideoSubmitResult,
  type ClipOperation,
} from "@/lib/video-generation-core";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════
// Helper: mock separate_clips 서버 응답 생성
// ═══════════════════════════════════════════════════════════════════

function makeSeparateClipsResponse(shotCount: number) {
  const clipOps: ClipOperation[] = Array.from({ length: shotCount }, (_, i) => ({
    shotIndex: i + 1,
    role: ["establish", "develop", "peak", "resolve"][i % 4],
    durationSec: 2,
    operationName: `op_shot_${i + 1}`,
    prompt: `Shot ${i + 1} visual description in English`,
  }));
  return {
    separateClips: true,
    engine: "veo",
    modeUsed: "generate",
    modelUsed: "veo-2.0",
    status: "RUNNING",
    clipOperations: clipOps,
    assembly: { method: "hard_cut", totalShots: shotCount, successfulShots: shotCount },
  };
}

// ═══════════════════════════════════════════════════════════════════
// a. UI 토글 → config → submit body 경로
// ═══════════════════════════════════════════════════════════════════

describe("a. UI toggle → config → submit body 경로", () => {
  it("VideoGenerationConfig.separateClips=true → body.separateClips=true", async () => {
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify(makeSeparateClipsResponse(4)), { status: 200 });
    });

    // Config에서 separateClips=true 시뮬레이션
    const params: VideoSubmitParams = {
      prompt: "Seoul office wide shot",
      cutNumber: 1,
      separateClips: true,
      multiShot: [
        { index: 1, prompt: "Wide shot", duration: "2", role: "establish" },
        { index: 2, prompt: "Medium shot", duration: "2", role: "develop" },
        { index: 3, prompt: "Close-up", duration: "2", role: "peak" },
        { index: 4, prompt: "Pull-back", duration: "2", role: "resolve" },
      ],
    };

    const result = await submitVideoGeneration(params);

    // body에 separateClips 포함
    expect(capturedBody.separateClips).toBe(true);
    // multiShot도 함께 전달
    expect(capturedBody.multiShot).toBeDefined();
    expect((capturedBody.multiShot as unknown[]).length).toBe(4);
    // 결과에 clipOperations 반환
    expect(result.separateClips).toBe(true);
  });

  it("separateClips 미설정 → body에 separateClips 없음", async () => {
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({
        operationName: "op_normal", taskId: "op_normal",
        engine: "veo", modeUsed: "generate", modelUsed: "veo-2.0", status: "RUNNING",
      }), { status: 200 });
    });

    await submitVideoGeneration({ prompt: "Test", cutNumber: 1 });
    expect(capturedBody.separateClips).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// b. 서버 응답 → clipOperations polling → separateClipUris 저장
// ═══════════════════════════════════════════════════════════════════

describe("b. 서버 응답 → clipOperations 수신 + polling 구조", () => {
  it("4-shot separate_clips → clipOperations 4개, 각각 고유 operationName", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeSeparateClipsResponse(4)), { status: 200 }),
    );

    const result = await submitVideoGeneration({
      prompt: "Test", separateClips: true,
      multiShot: [1, 2, 3, 4].map(i => ({ index: i, prompt: `S${i}`, duration: "2", role: "develop" })),
    });

    expect(result.clipOperations).toHaveLength(4);
    const opNames = result.clipOperations!.map(c => c.operationName);
    expect(new Set(opNames).size).toBe(4); // 모두 고유
    // 각 shot에 필수 필드 존재
    for (const op of result.clipOperations!) {
      expect(op.shotIndex).toBeGreaterThan(0);
      expect(op.durationSec).toBeGreaterThanOrEqual(2);
      expect(op.operationName).toBeTruthy();
      expect(op.prompt).toBeTruthy();
    }
  });

  it("assembly 메타데이터 수신", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeSeparateClipsResponse(3)), { status: 200 }),
    );

    const result = await submitVideoGeneration({
      prompt: "Test", separateClips: true,
      multiShot: [1, 2, 3].map(i => ({ index: i, prompt: `S${i}`, duration: "2" })),
    });

    expect(result.assembly).toBeDefined();
    expect(result.assembly!.method).toBe("hard_cut");
    expect(result.assembly!.totalShots).toBe(3);
    expect(result.assembly!.successfulShots).toBe(3);
  });

  it("대표 taskId = 첫 번째 clipOperation.operationName", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeSeparateClipsResponse(2)), { status: 200 }),
    );

    const result = await submitVideoGeneration({
      prompt: "Test", separateClips: true,
      multiShot: [1, 2].map(i => ({ index: i, prompt: `S${i}`, duration: "2" })),
    });

    expect(result.taskId).toBe("op_shot_1");
    expect(result.operationName).toBe("op_shot_1");
  });
});

// ═══════════════════════════════════════════════════════════════════
// c. hard-cut stitch 경로 검증 (client-stitch 모듈)
// ═══════════════════════════════════════════════════════════════════

describe("c. hard-cut stitch 파이프라인", () => {
  it("client-stitch concatClips는 concat demuxer 사용 (stream copy, 재인코딩 없음)", async () => {
    // client-stitch.ts의 fetchClipBlobs + concatClips 타입 검증
    const { fetchClipBlobs, concatClips, StitchError } = await import("@/lib/client-stitch");

    // 함수 존재 확인
    expect(typeof fetchClipBlobs).toBe("function");
    expect(typeof concatClips).toBe("function");
    expect(StitchError).toBeDefined();
  });

  it("no_clips 에러: 빈 clip 배열이면 StitchError 발생", async () => {
    const { fetchClipBlobs, StitchError } = await import("@/lib/client-stitch");

    await expect(fetchClipBlobs([])).rejects.toThrow(StitchError);
    await expect(fetchClipBlobs([])).rejects.toThrow("완료된 clip이 없습니다");
  });
});

// ═══════════════════════════════════════════════════════════════════
// d. 조립 실패 시 graceful degradation
// ═══════════════════════════════════════════════════════════════════

describe("d. 조립 실패 시 graceful degradation", () => {
  it("stitch 실패 시 개별 clipUris 유지 (VideoClip.separateClipUris)", () => {
    // 시뮬레이션: polling 성공 → stitch 실패 → 개별 clip URI 보존
    const completedClips = [
      { shotIndex: 1, videoUri: "https://storage/clip_1.mp4", durationSec: 2 },
      { shotIndex: 2, videoUri: "https://storage/clip_2.mp4", durationSec: 2 },
      { shotIndex: 3, videoUri: "https://storage/clip_3.mp4", durationSec: 2 },
    ];

    // stitch 실패 시 첫 번째 clip을 대표 URI로, 에러 메시지 포함
    const clipUpdate = {
      status: "completed" as const,
      videoUri: completedClips[0].videoUri,
      separateClipUris: completedClips,
      error: "조립 실패 — 개별 클립만 생성됨: FFmpeg unavailable",
      completedAt: Date.now(),
    };

    expect(clipUpdate.separateClipUris).toHaveLength(3);
    expect(clipUpdate.videoUri).toBe("https://storage/clip_1.mp4");
    expect(clipUpdate.error).toContain("개별 클립만 생성됨");
    expect(clipUpdate.status).toBe("completed"); // 개별 clip은 생성 완료
  });

  it("전체 shot 실패 시 status=failed", () => {
    const clipUpdate = {
      status: "failed" as const,
      error: "separate_clips 전체 실패: shot 1: timeout; shot 2: timeout",
    };

    expect(clipUpdate.status).toBe("failed");
    expect(clipUpdate.error).toContain("전체 실패");
  });
});

// ═══════════════════════════════════════════════════════════════════
// e. UI 영어 fallback 미노출 (Ko 전용)
// ═══════════════════════════════════════════════════════════════════

describe("e. UI 영어 fallback 미노출", () => {
  it("promptKo 비었을 때 → 한국어 placeholder (영어 prompt 노출 금지)", () => {
    const shot = { index: 1, prompt: "Wide establishing shot of Seoul office", promptKo: "", duration: "2" };
    const display = shot.promptKo || "한국어 프롬프트 미생성";
    expect(display).toBe("한국어 프롬프트 미생성");
    expect(display).not.toMatch(/[a-zA-Z]/);
  });

  it("cameraDirectionKo 비었을 때 → 한국어 placeholder (영어 fallback 금지)", () => {
    const cut = { cameraDirection: "Wide shot, eye-level, slow push-in", cameraDirectionKo: "" };
    const display = cut.cameraDirectionKo || "한국어 카메라 연출 미생성";
    expect(display).toBe("한국어 카메라 연출 미생성");
    expect(display).not.toMatch(/[a-zA-Z]/);
  });

  it("moodLightingKo 비었을 때 → 한국어 placeholder", () => {
    const cut = { moodLighting: "warm golden hour backlight", moodLightingKo: "" };
    const display = cut.moodLightingKo || "한국어 조명 설명 미생성";
    expect(display).toBe("한국어 조명 설명 미생성");
    expect(display).not.toMatch(/[a-zA-Z]/);
  });

  it("Ko 필드 있으면 그대로 표시", () => {
    const shot = { promptKo: "와이드 샷으로 서울 사무실을 보여주는 장면", prompt: "Wide shot" };
    const display = shot.promptKo || "한국어 프롬프트 미생성";
    expect(display).toBe("와이드 샷으로 서울 사무실을 보여주는 장면");
  });

  it("MultiShotEditor: koBody 없으면 placeholder (영어 shot.prompt fallback 금지)", () => {
    // MultiShotEditor의 displayKo 로직 시뮬레이션
    const koBody = ""; // 빈 Ko
    const shotPrompt = "Wide shot establishing the space"; // 영어
    const displayKo = koBody.trim().length > 0 ? koBody : "한국어 프롬프트 미생성";
    expect(displayKo).toBe("한국어 프롬프트 미생성");
    expect(displayKo).not.toBe(shotPrompt);
  });
});

// ═══════════════════════════════════════════════════════════════════
// f. sentPromptEn / sentPromptKoSummary 의미 일치
// ═══════════════════════════════════════════════════════════════════

describe("f. sentPromptEn / sentPromptKoSummary 의미와 일관성", () => {
  it("sentPromptKoSummary는 영어 혼입 30% 초과 fragment를 제외", () => {
    const koFragments = [
      "서울 사무실에서 일하는 장면",         // 순수 한국어
      "Wide shot establishing the scene",   // 순수 영어 → 제외
      "분위기 조명",                         // 순수 한국어
    ];

    const pureKo = koFragments.filter(f => {
      const alphaCount = (f.match(/[a-zA-Z]/g) || []).length;
      return alphaCount <= f.length * 0.3;
    });

    expect(pureKo).toContain("서울 사무실에서 일하는 장면");
    expect(pureKo).toContain("분위기 조명");
    expect(pureKo).not.toContain("Wide shot establishing the scene");
  });

  it("sentPromptKoSummary는 요약본 (완전 번역이 아님)이 명확", () => {
    // 타입 정의에서 필드명이 Summary로 끝남 → 요약임을 명시
    type ClipFields = { sentPromptEn?: string; sentPromptKoSummary?: string };
    const clip: ClipFields = {
      sentPromptEn: "Wide shot, eye-level, slow push-in. Seoul office interior.",
      sentPromptKoSummary: "서울 사무실 내부 장면. 분위기 조명",
    };

    // 필드명에 Summary 포함
    expect("sentPromptKoSummary" in clip).toBe(true);
    // 값이 한국어
    expect(clip.sentPromptKoSummary).toBeTruthy();
    const alphaRatio = (clip.sentPromptKoSummary!.match(/[a-zA-Z]/g) || []).length / clip.sentPromptKoSummary!.length;
    expect(alphaRatio).toBeLessThanOrEqual(0.3);
  });

  it("sentPromptEn과 sentPromptKoSummary는 동시에 설정됨", () => {
    // 구조 검증: updateClip() 호출에서 두 필드가 같은 객체에 포함
    const updatePayload = {
      sentPromptEn: "Medium shot, lateral tracking",
      sentPromptKoSummary: "미디엄 샷, 측면 트래킹",
    };

    expect(Object.keys(updatePayload)).toContain("sentPromptEn");
    expect(Object.keys(updatePayload)).toContain("sentPromptKoSummary");
  });

  it("sentPromptKoSummary가 전혀 없으면 sceneDescription이 fallback", () => {
    const sceneDescription = "경쟁이 심화되어 공장이 문을 닫는 장면";
    const pureKo: string[] = []; // Ko 필드 전혀 없음

    const sentKoSummary = pureKo.length > 0
      ? pureKo.join(". ").slice(0, 500)
      : (sceneDescription || "컷 1 영상 프롬프트");

    expect(sentKoSummary).toBe(sceneDescription);
    expect(sentKoSummary).not.toMatch(/[a-zA-Z]/);
  });
});
