/**
 * sample-projects.test.ts — 샘플 프로젝트 데이터 무결성 검증
 */

import { describe, it, expect } from "vitest";
import { SAMPLE_PROJECTS } from "@/data/sample-projects";

describe("sample-projects data integrity", () => {
  it("최소 3개 샘플 프로젝트 존재", () => {
    expect(SAMPLE_PROJECTS.length).toBeGreaterThanOrEqual(3);
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

  it("다양한 duration 커버 (15s, 60s, 120s 시나리오)", () => {
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
