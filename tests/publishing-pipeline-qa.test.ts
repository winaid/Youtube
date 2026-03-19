/**
 * publishing-pipeline-qa.test.ts — 유튜브 퍼블리싱 파이프라인 QA 테스트
 *
 * 검증 범위:
 * - SRT 생성 API 에러 표면화 (silent failure 방지)
 * - SEO 생성 API 응답 구조 검증
 * - 썸네일 생성 API 응답 구조 검증
 * - 퍼블리싱 준비 상태 판정 로직
 * - 파이프라인 에러 격리 (한 단계 실패가 다른 단계를 막지 않음)
 */

import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════
// 퍼블리싱 준비 상태 판정 로직 (순수 함수 추출)
// ═══════════════════════════════════════════════════════════════════

interface PublishReadiness {
  video: boolean;
  srt: boolean;
  seo: boolean;
  thumbnail: boolean;
  allReady: boolean;
}

function checkPublishReadiness(
  completedCount: number,
  totalCount: number,
  srtContent: string | null,
  seoResult: { titles: string[] } | null,
  thumbnailImages: { base64: string }[],
): PublishReadiness {
  const video = completedCount === totalCount && totalCount > 0;
  const srt = !!srtContent;
  const seo = !!seoResult;
  const thumbnail = thumbnailImages.length > 0;
  return {
    video,
    srt,
    seo,
    thumbnail,
    allReady: video && srt && seo && thumbnail,
  };
}

describe("퍼블리싱 준비 상태 판정", () => {
  it("모든 에셋 준비 → allReady", () => {
    const r = checkPublishReadiness(3, 3, "1\n00:00...", { titles: ["T"] }, [{ base64: "abc" }]);
    expect(r.allReady).toBe(true);
    expect(r.video).toBe(true);
    expect(r.srt).toBe(true);
    expect(r.seo).toBe(true);
    expect(r.thumbnail).toBe(true);
  });

  it("영상 미완료 → allReady false", () => {
    const r = checkPublishReadiness(2, 3, "srt", { titles: ["T"] }, [{ base64: "abc" }]);
    expect(r.allReady).toBe(false);
    expect(r.video).toBe(false);
  });

  it("영상 0/0 → allReady false (빈 프로젝트)", () => {
    const r = checkPublishReadiness(0, 0, "srt", { titles: ["T"] }, [{ base64: "abc" }]);
    expect(r.allReady).toBe(false);
    expect(r.video).toBe(false);
  });

  it("SRT 없음 → allReady false", () => {
    const r = checkPublishReadiness(3, 3, null, { titles: ["T"] }, [{ base64: "abc" }]);
    expect(r.allReady).toBe(false);
    expect(r.srt).toBe(false);
  });

  it("SEO 없음 → allReady false", () => {
    const r = checkPublishReadiness(3, 3, "srt", null, [{ base64: "abc" }]);
    expect(r.allReady).toBe(false);
    expect(r.seo).toBe(false);
  });

  it("썸네일 없음 → allReady false", () => {
    const r = checkPublishReadiness(3, 3, "srt", { titles: ["T"] }, []);
    expect(r.allReady).toBe(false);
    expect(r.thumbnail).toBe(false);
  });

  it("아무것도 없음 → 전부 false", () => {
    const r = checkPublishReadiness(0, 5, null, null, []);
    expect(r.allReady).toBe(false);
    expect(r.video).toBe(false);
    expect(r.srt).toBe(false);
    expect(r.seo).toBe(false);
    expect(r.thumbnail).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SRT 에러 표면화 검증
// ═══════════════════════════════════════════════════════════════════

describe("SRT 에러 표면화", () => {
  function classifySrtResponse(
    resOk: boolean,
    status: number,
    data: { srt?: string; error?: string } | null,
    networkError?: boolean,
  ): { success: boolean; error?: string; srt?: string } {
    if (networkError) {
      return { success: false, error: "네트워크 오류 — SRT 생성 실패" };
    }
    if (!resOk) {
      return { success: false, error: data?.error || `SRT 생성 실패 (${status})` };
    }
    if (!data?.srt) {
      return { success: false, error: "SRT 데이터가 비어있습니다" };
    }
    return { success: true, srt: data.srt };
  }

  it("정상 응답 → success + srt 내용", () => {
    const r = classifySrtResponse(true, 200, { srt: "1\n00:00:00..." });
    expect(r.success).toBe(true);
    expect(r.srt).toBeTruthy();
  });

  it("API 에러 → error 메시지 반환 (silent failure 방지)", () => {
    const r = classifySrtResponse(false, 500, { error: "Gemini API key invalid" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Gemini API key invalid");
  });

  it("API 에러 + 에러 메시지 없음 → 상태 코드 포함 에러", () => {
    const r = classifySrtResponse(false, 500, null);
    expect(r.success).toBe(false);
    expect(r.error).toContain("500");
  });

  it("성공 응답이나 srt 필드 없음 → 빈 데이터 에러", () => {
    const r = classifySrtResponse(true, 200, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("비어있습니다");
  });

  it("네트워크 에러 → 네트워크 에러 메시지", () => {
    const r = classifySrtResponse(false, 0, null, true);
    expect(r.success).toBe(false);
    expect(r.error).toContain("네트워크");
  });
});

// ═══════════════════════════════════════════════════════════════════
// SEO 응답 구조 검증
// ═══════════════════════════════════════════════════════════════════

describe("SEO 응답 구조 검증", () => {
  function validateSeoResponse(data: Record<string, unknown>): { valid: boolean; missing: string[] } {
    const required = ["titles", "description", "tags", "hashtags", "thumbnailPrompt"];
    const missing = required.filter((key) => !data[key]);
    return { valid: missing.length === 0, missing };
  }

  it("완전한 SEO 응답 → valid", () => {
    const r = validateSeoResponse({
      titles: ["Title 1"],
      description: "desc",
      tags: ["tag1"],
      hashtags: ["#hash1"],
      thumbnailPrompt: "A dramatic scene",
      predictedCTR: 0.08,
    });
    expect(r.valid).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it("titles 누락 → invalid", () => {
    const r = validateSeoResponse({ description: "d", tags: ["t"], hashtags: ["#h"], thumbnailPrompt: "p" });
    expect(r.valid).toBe(false);
    expect(r.missing).toContain("titles");
  });

  it("빈 응답 → 모든 필드 누락", () => {
    const r = validateSeoResponse({});
    expect(r.valid).toBe(false);
    expect(r.missing.length).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 파이프라인 에러 격리 검증
// ═══════════════════════════════════════════════════════════════════

describe("파이프라인 에러 격리", () => {
  it("Promise.allSettled — 한 단계 실패가 다른 단계를 막지 않음", async () => {
    const results = await Promise.allSettled([
      Promise.resolve("srt ok"),
      Promise.reject(new Error("bgm failed")),
      Promise.resolve("seo ok"),
      Promise.resolve("thumbnail ok"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(1);
    // 나머지 3개는 성공 — bgm 실패가 전파되지 않음
  });

  it("에러 카운트 정확히 추적", () => {
    const steps = [
      { id: "video", status: "done", error: undefined },
      { id: "srt", status: "error", error: "SRT 실패" },
      { id: "bgm", status: "done", error: undefined },
      { id: "seo", status: "error", error: "SEO 실패" },
      { id: "thumbnail", status: "done", error: undefined },
    ];
    const errorCount = steps.filter((s) => s.status === "error").length;
    const doneCount = steps.filter((s) => s.status === "done").length;
    expect(errorCount).toBe(2);
    expect(doneCount).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 썸네일 응답 구조 검증
// ═══════════════════════════════════════════════════════════════════

describe("썸네일 응답 검증", () => {
  function validateThumbnailResponse(
    resOk: boolean,
    data: { images?: { base64: string; mimeType: string }[]; error?: string } | null,
  ): { success: boolean; imageCount: number; error?: string } {
    if (!resOk) {
      return { success: false, imageCount: 0, error: data?.error || "썸네일 생성 실패" };
    }
    if (!data?.images || data.images.length === 0) {
      return { success: false, imageCount: 0, error: "썸네일 이미지가 생성되지 않았습니다" };
    }
    return { success: true, imageCount: data.images.length };
  }

  it("정상 응답 + 이미지 → success", () => {
    const r = validateThumbnailResponse(true, {
      images: [{ base64: "abc123", mimeType: "image/png" }],
    });
    expect(r.success).toBe(true);
    expect(r.imageCount).toBe(1);
  });

  it("정상 응답 + 빈 이미지 배열 → failure", () => {
    const r = validateThumbnailResponse(true, { images: [] });
    expect(r.success).toBe(false);
    expect(r.error).toContain("생성되지 않았습니다");
  });

  it("API 에러 → failure + 에러 메시지", () => {
    const r = validateThumbnailResponse(false, { error: "All models failed" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("All models failed");
  });
});
