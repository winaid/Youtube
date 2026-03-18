/**
 * session-notes.test.ts — 오너 세션 기록 구조 검증
 *
 * - FailureTag taxonomy 완전성
 * - OwnerSessionNote 구조 유효성
 * - SessionLog localStorage CRUD
 * - sessionLogStats 집계 정확성
 * - Duration type shortform 값 지원
 */

import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  type FailureTag,
  type OwnerSessionNote,
  type SessionLogEntry,
  FAILURE_TAG_LABELS,
  loadSessionLog,
  appendSessionLog,
  clearSessionLog,
  sessionLogStats,
} from "@/lib/draft-store";
import type { Duration } from "@/types";

// ─── localStorage polyfill for Node.js test environment ───
beforeAll(() => {
  if (typeof globalThis.localStorage === "undefined") {
    const store: Record<string, string> = {};
    (globalThis as unknown as Record<string, unknown>).localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    };
  }
});

// ═══════════════════════════════════════════════════════════════════
// Failure Tag Taxonomy
// ═══════════════════════════════════════════════════════════════════

describe("FailureTag taxonomy", () => {
  const EXPECTED_TAGS: FailureTag[] = [
    "too-slow",
    "too-sparse",
    "too-generic",
    "style-too-weak",
    "style-overrides-rhythm",
    "fallback-degraded",
    "save-reopen-confusion",
    "ok",
  ];

  it("모든 실패 유형이 FAILURE_TAG_LABELS에 있어야 함", () => {
    for (const tag of EXPECTED_TAGS) {
      expect(FAILURE_TAG_LABELS[tag]).toBeDefined();
      expect(typeof FAILURE_TAG_LABELS[tag]).toBe("string");
      expect(FAILURE_TAG_LABELS[tag].length).toBeGreaterThan(0);
    }
  });

  it("8개 태그가 정의됨 (ok 포함)", () => {
    expect(Object.keys(FAILURE_TAG_LABELS)).toHaveLength(8);
  });

  it("ok 태그가 포함됨 (성공 분류용)", () => {
    expect(FAILURE_TAG_LABELS["ok"]).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// OwnerSessionNote Structure
// ═══════════════════════════════════════════════════════════════════

describe("OwnerSessionNote structure", () => {
  it("최소 필수 필드로 유효한 note 생성 가능", () => {
    const note: OwnerSessionNote = {
      scenario: "10초 숏폼 — 커피 한 잔",
      failureTags: ["too-slow"],
      fallbackUsed: false,
      notedAt: Date.now(),
    };
    expect(note.scenario).toBeTruthy();
    expect(note.failureTags).toHaveLength(1);
  });

  it("모든 선택 필드를 포함한 note 생성 가능", () => {
    const note: OwnerSessionNote = {
      scenario: "15초 숏폼 — 지하철 순간",
      firstImpression: "리듬 좋음",
      rhythmVerdict: "적절",
      styleVerdict: "약간 약함",
      failureTags: ["style-too-weak"],
      fallbackUsed: false,
      nextFixGuess: "director persona 강화 필요",
      notedAt: Date.now(),
    };
    expect(note.firstImpression).toBe("리듬 좋음");
    expect(note.nextFixGuess).toBeTruthy();
  });

  it("ok와 실패 태그는 별개 분류", () => {
    const successNote: OwnerSessionNote = {
      scenario: "test",
      failureTags: ["ok"],
      fallbackUsed: false,
      notedAt: Date.now(),
    };
    const failNote: OwnerSessionNote = {
      scenario: "test",
      failureTags: ["too-slow", "too-sparse"],
      fallbackUsed: true,
      notedAt: Date.now(),
    };
    expect(successNote.failureTags).toEqual(["ok"]);
    expect(failNote.failureTags).not.toContain("ok");
  });
});

// ═══════════════════════════════════════════════════════════════════
// SessionLog localStorage CRUD
// ═══════════════════════════════════════════════════════════════════

describe("SessionLog localStorage operations", () => {
  beforeEach(() => {
    clearSessionLog();
  });

  it("빈 로그에서 loadSessionLog는 빈 배열 반환", () => {
    expect(loadSessionLog()).toEqual([]);
  });

  it("appendSessionLog가 항목을 추가함", () => {
    const entry: SessionLogEntry = {
      draftId: "draft-123",
      scenario: "test scenario",
      failureTags: ["too-generic"],
      fallbackUsed: false,
      timestamp: Date.now(),
    };
    appendSessionLog(entry);
    const log = loadSessionLog();
    expect(log).toHaveLength(1);
    expect(log[0].scenario).toBe("test scenario");
    expect(log[0].failureTags).toEqual(["too-generic"]);
  });

  it("최신 항목이 맨 앞에 위치", () => {
    appendSessionLog({
      draftId: "d1", scenario: "first", failureTags: ["ok"],
      fallbackUsed: false, timestamp: 1000,
    });
    appendSessionLog({
      draftId: "d2", scenario: "second", failureTags: ["too-slow"],
      fallbackUsed: false, timestamp: 2000,
    });
    const log = loadSessionLog();
    expect(log[0].scenario).toBe("second");
    expect(log[1].scenario).toBe("first");
  });

  it("clearSessionLog가 모든 항목을 삭제", () => {
    appendSessionLog({
      draftId: "d1", scenario: "test", failureTags: ["ok"],
      fallbackUsed: false, timestamp: Date.now(),
    });
    expect(loadSessionLog()).toHaveLength(1);
    clearSessionLog();
    expect(loadSessionLog()).toEqual([]);
  });

  it("100개 제한 초과 시 오래된 항목 제거", () => {
    for (let i = 0; i < 110; i++) {
      appendSessionLog({
        draftId: `d-${i}`, scenario: `scenario-${i}`,
        failureTags: ["ok"], fallbackUsed: false, timestamp: i,
      });
    }
    const log = loadSessionLog();
    expect(log.length).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// sessionLogStats 집계
// ═══════════════════════════════════════════════════════════════════

describe("sessionLogStats aggregation", () => {
  it("빈 로그에서 모든 카운트가 0", () => {
    const stats = sessionLogStats([]);
    for (const count of Object.values(stats)) {
      expect(count).toBe(0);
    }
  });

  it("태그별 카운트가 정확", () => {
    const entries: SessionLogEntry[] = [
      { draftId: "d1", scenario: "s1", failureTags: ["too-slow", "too-sparse"], fallbackUsed: false, timestamp: 1 },
      { draftId: "d2", scenario: "s2", failureTags: ["too-slow"], fallbackUsed: false, timestamp: 2 },
      { draftId: "d3", scenario: "s3", failureTags: ["ok"], fallbackUsed: false, timestamp: 3 },
    ];
    const stats = sessionLogStats(entries);
    expect(stats["too-slow"]).toBe(2);
    expect(stats["too-sparse"]).toBe(1);
    expect(stats["ok"]).toBe(1);
    expect(stats["too-generic"]).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Duration type shortform 지원 검증
// ═══════════════════════════════════════════════════════════════════

describe("Duration type shortform support", () => {
  it("10, 12, 13, 15, 30초가 유효한 Duration 값", () => {
    const shortformValues: Duration[] = [10, 12, 13, 15, 30];
    for (const v of shortformValues) {
      expect(typeof v).toBe("number");
    }
  });

  it("auto와 기존 값도 여전히 유효", () => {
    const standardValues: Duration[] = ["auto", 60, 90, 120, 180, 240, 300];
    expect(standardValues).toHaveLength(7);
  });
});
