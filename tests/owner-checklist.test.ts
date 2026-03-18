/**
 * owner-checklist.test.ts — 오너 검증 체크리스트 데이터 구조 검증
 */

import { describe, it, expect } from "vitest";
import { OWNER_CHECKLIST } from "@/data/owner-checklist";

describe("owner-checklist data integrity", () => {
  it("최소 5개 카테고리 존재", () => {
    expect(OWNER_CHECKLIST.length).toBeGreaterThanOrEqual(5);
  });

  it("필수 카테고리 존재 (첫 인상, 리듬, 감독, UX, 신뢰성)", () => {
    const ids = OWNER_CHECKLIST.map(c => c.id);
    expect(ids).toContain("first-impression");
    expect(ids).toContain("rhythm");
    expect(ids).toContain("director");
    expect(ids).toContain("editing-ux");
    expect(ids).toContain("reliability");
  });

  it("모든 카테고리에 최소 2개 항목 존재", () => {
    for (const cat of OWNER_CHECKLIST) {
      expect(cat.items.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("모든 항목에 고유 ID", () => {
    const allIds = OWNER_CHECKLIST.flatMap(c => c.items.map(i => i.id));
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("모든 항목에 label 존재", () => {
    for (const cat of OWNER_CHECKLIST) {
      for (const item of cat.items) {
        expect(item.label).toBeTruthy();
        expect(item.label.length).toBeGreaterThan(3);
      }
    }
  });

  it("전체 항목 수가 적절한 범위 (10~25개)", () => {
    const totalItems = OWNER_CHECKLIST.reduce((s, c) => s + c.items.length, 0);
    expect(totalItems).toBeGreaterThanOrEqual(10);
    expect(totalItems).toBeLessThanOrEqual(25);
  });
});
