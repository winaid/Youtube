/**
 * sample-projects.test.ts — 샘플 프로젝트 데이터 무결성 + 검증 메타 검증
 */

import { describe, it, expect } from "vitest";
import { SAMPLE_PROJECTS } from "@/data/sample-projects";

describe("sample-projects data integrity", () => {
  it("최소 9개 검증 샘플 프로젝트 존재", () => {
    expect(SAMPLE_PROJECTS.length).toBeGreaterThanOrEqual(9);
  });

  it("모든 샘플에 필수 필드 존재", () => {
    for (const sample of SAMPLE_PROJECTS) {
      expect(sample.id).toBeTruthy();
      expect(sample.title).toBeTruthy();
      expect(sample.description).toBeTruthy();
      expect(sample.tags.length).toBeGreaterThan(0);
      expect(sample.input.storyText).toBeTruthy();
      expect(sample.input.directorPersona).toBeTruthy();
      expect(sample.input.region).toBeTruthy();
      expect(sample.input.animationMode).toBeTruthy();
    }
  });

  it("고유 ID", () => {
    const ids = SAMPLE_PROJECTS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("다양한 duration 커버 (60s, 120s 시나리오)", () => {
    const durations = SAMPLE_PROJECTS.map(s => s.input.duration);
    expect(durations).toContain(60);
    expect(durations).toContain(120);
  });

  it("숏폼/표준/장편 태그 각각 존재", () => {
    const allTags = SAMPLE_PROJECTS.flatMap(s => s.tags);
    expect(allTags).toContain("shortform");
    expect(allTags).toContain("standard");
    expect(allTags).toContain("longform");
  });
});

describe("sample-projects verification metadata", () => {
  it("모든 샘플에 verifyPoint 존재", () => {
    for (const sample of SAMPLE_PROJECTS) {
      expect(sample.verifyPoint).toBeTruthy();
      expect(sample.verifyPoint.length).toBeGreaterThan(10);
    }
  });

  it("모든 샘플에 suspectOnFail 존재", () => {
    for (const sample of SAMPLE_PROJECTS) {
      expect(sample.suspectOnFail).toBeTruthy();
      expect(sample.suspectOnFail.length).toBeGreaterThan(5);
    }
  });

  it("숏폼 duration 밴드별 샘플 존재 (10s, 12s, 13s, 15s)", () => {
    const tags = SAMPLE_PROJECTS.flatMap(s => s.tags);
    expect(tags).toContain("10s");
    expect(tags).toContain("12s");
    expect(tags).toContain("13s");
    expect(tags).toContain("15s");
  });

  it("감독 충돌 검증 샘플 존재", () => {
    const tags = SAMPLE_PROJECTS.flatMap(s => s.tags);
    expect(tags).toContain("director-conflict");
  });

  it("fallback 위험 검증 샘플 존재", () => {
    const tags = SAMPLE_PROJECTS.flatMap(s => s.tags);
    expect(tags).toContain("fallback-risk");
  });

  it("액션형 샘플 존재", () => {
    const tags = SAMPLE_PROJECTS.flatMap(s => s.tags);
    expect(tags).toContain("action");
  });

  it("감정형/독백 샘플 존재", () => {
    const tags = SAMPLE_PROJECTS.flatMap(s => s.tags);
    expect(tags.some(t => t === "emotion" || t === "monologue")).toBe(true);
  });
});
