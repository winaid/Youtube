/**
 * story-duration-estimator.test.ts — 스토리 텍스트 기반 project total duration 추정 테스트
 *
 * 검증 항목:
 *   1. 긴 storyText → project total 60초 이상
 *   2. 짧은 storyText → 30초 (최소) 수준
 *   3. 중간 길이 → 합리적 범위
 *   4. 빈 텍스트 → 최소값
 *   5. 한국어/영어 혼합 대응
 *   6. 반환값이 30~300초 범위 내
 */

import { describe, it, expect } from "vitest";
import { estimateProjectDuration } from "@/lib/story-duration-estimator";

// ═══════════════════════════════════════════════════════════════════
// 1. 긴 스토리 → project total 60초 이상
// ═══════════════════════════════════════════════════════════════════

describe("긴 storyText → project total 60초 이상", () => {
  it("10문장 이상의 한국어 스토리 → 최소 60초", () => {
    const longStory = `
      한 소녀가 황폐한 도시를 걸어간다. 하늘에는 먹구름이 가득하다.
      거리는 텅 비어 있고, 바람만이 쓸쓸하게 불고 있다.
      소녀는 오래된 건물 앞에서 멈춘다. 문이 반쯤 열려 있다.
      안으로 들어가자 먼지 쌓인 피아노가 보인다.
      소녀는 천천히 피아노 앞에 앉는다. 건반을 누른다.
      아름다운 멜로디가 텅 빈 건물에 울려 퍼진다.
      음악 소리에 이끌려 고양이 한 마리가 다가온다.
      소녀는 미소 짓는다. 고양이는 피아노 위에 올라앉는다.
      두 존재는 서로의 온기를 느낀다. 세상은 여전히 황폐하지만.
      음악이 울리는 한, 희망은 사라지지 않는다.
    `;
    const result = estimateProjectDuration(longStory);
    expect(result.estimatedTotalSec).toBeGreaterThanOrEqual(60);
  });

  it("20문장 한국어 스토리 → 최소 120초", () => {
    const sentences = Array.from({ length: 20 }, (_, i) =>
      `장면 ${i + 1}에서 주인공은 새로운 도전에 직면한다.`
    ).join(" ");
    const result = estimateProjectDuration(sentences);
    expect(result.estimatedTotalSec).toBeGreaterThanOrEqual(120);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. 짧은 스토리 → 30초 (최소) 수준
// ═══════════════════════════════════════════════════════════════════

describe("짧은 storyText → 최소 30초", () => {
  it("한 문장 → 30초 (최소)", () => {
    const result = estimateProjectDuration("소녀가 걸어간다.");
    expect(result.estimatedTotalSec).toBe(30);
  });

  it("빈 텍스트 → 30초 (최소)", () => {
    const result = estimateProjectDuration("");
    expect(result.estimatedTotalSec).toBe(30);
    expect(result.basis).toBe("minimum");
  });

  it("매우 짧은 텍스트 → 30초 (최소)", () => {
    const result = estimateProjectDuration("안녕");
    expect(result.estimatedTotalSec).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. 중간 길이 → 합리적 범위
// ═══════════════════════════════════════════════════════════════════

describe("중간 길이 storyText → 합리적 범위", () => {
  it("5문장 → 30~80초 범위", () => {
    const mid = `
      새벽이 밝아온다. 도시가 깨어나기 시작한다.
      카페 주인이 문을 연다. 첫 번째 손님이 들어온다.
      따뜻한 커피 한 잔이 하루를 시작한다.
    `;
    const result = estimateProjectDuration(mid);
    expect(result.estimatedTotalSec).toBeGreaterThanOrEqual(30);
    expect(result.estimatedTotalSec).toBeLessThanOrEqual(80);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. 한국어/영어 혼합
// ═══════════════════════════════════════════════════════════════════

describe("한국어/영어 혼합", () => {
  it("영어 스토리도 합리적으로 추정", () => {
    const english = `
      A young woman walks through the abandoned city. The sky is overcast with dark clouds.
      The streets are empty. Only the wind blows mournfully through the alleys.
      She stops in front of an old building. The door is half open.
      Inside, a dust-covered piano stands alone. She slowly sits down and presses a key.
      A beautiful melody fills the empty space. A cat appears, drawn by the music.
      She smiles. The cat jumps onto the piano. They share warmth in a desolate world.
    `;
    const result = estimateProjectDuration(english);
    expect(result.estimatedTotalSec).toBeGreaterThanOrEqual(40);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. 범위 클램프
// ═══════════════════════════════════════════════════════════════════

describe("범위 클램프", () => {
  it("결과가 항상 30~300초 범위 내", () => {
    const veryLong = Array.from({ length: 100 }, (_, i) =>
      `문장 ${i + 1}: 이것은 매우 긴 스토리의 일부이며 다양한 장면과 캐릭터가 등장하는 복잡한 서사입니다.`
    ).join(" ");
    const result = estimateProjectDuration(veryLong);
    expect(result.estimatedTotalSec).toBeLessThanOrEqual(300);
    expect(result.estimatedTotalSec).toBeGreaterThanOrEqual(30);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. metrics 검증
// ═══════════════════════════════════════════════════════════════════

describe("metrics 검증", () => {
  it("charCount, sentenceCount, estimatedNarrationSec 반환", () => {
    const result = estimateProjectDuration("소녀가 걸어간다. 하늘이 맑다.");
    expect(result.metrics.charCount).toBeGreaterThan(0);
    expect(result.metrics.sentenceCount).toBeGreaterThanOrEqual(2);
    expect(result.metrics.estimatedNarrationSec).toBeGreaterThanOrEqual(0);
  });

  it("basis가 유효한 값", () => {
    const result = estimateProjectDuration("소녀가 걸어간다. 하늘이 맑다. 바람이 분다.");
    expect(["sentence_count", "char_length", "minimum"]).toContain(result.basis);
  });
});
