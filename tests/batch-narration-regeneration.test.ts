/**
 * batch-narration-regeneration.test.ts — 배치 나레이션 재생성 로직 테스트
 *
 * 테스트 대상:
 * 1. dirty shot만 대상으로 배치 실행
 * 2. 성공한 shot은 dirty=false
 * 3. 실패한 shot은 dirty=true 유지
 * 4. 일부 실패 시 전체 중단하지 않음
 * 5. progress state 계산
 * 6. dirtyShotCount=0이면 배치 대상 없음
 * 7. 단일 shot 재생성과 batch 상태 충돌 없음
 */

import { describe, it, expect } from "vitest";
import type {
  ShotNarrationState,
  BatchNarrationRegenerationState,
  NarrationMode,
} from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Helper: dirty-state + batch 로직 (useVideoGeneration에서 추출한 순수 로직)
// ═══════════════════════════════════════════════════════════════════

function createDefaultShotNarrationState(): ShotNarrationState {
  return {
    mode: "auto",
    currentText: "",
    lastGeneratedText: "",
    narrationDirty: false,
    lastGeneratedAudioUrl: "",
    lastGeneratedSyncStatus: "",
    lastGeneratedAt: 0,
    lastGeneratedMode: "auto",
  };
}

function applyTextChange(state: ShotNarrationState, newText: string): ShotNarrationState {
  const updated = { ...state, currentText: newText };
  updated.narrationDirty = newText !== updated.lastGeneratedText || updated.mode !== updated.lastGeneratedMode;
  return updated;
}

function applyModeChange(state: ShotNarrationState, newMode: NarrationMode): ShotNarrationState {
  const updated = { ...state, mode: newMode };
  updated.narrationDirty = updated.mode !== updated.lastGeneratedMode || updated.currentText !== updated.lastGeneratedText;
  return updated;
}

function applyGenerationSuccess(
  state: ShotNarrationState,
  audioUrl: string,
  syncStatus: "exact" | "trimmed" | "padded",
): ShotNarrationState {
  return {
    ...state,
    lastGeneratedText: state.currentText,
    lastGeneratedMode: state.mode,
    lastGeneratedAudioUrl: audioUrl,
    lastGeneratedSyncStatus: syncStatus,
    lastGeneratedAt: Date.now(),
    narrationDirty: false,
  };
}

function createInitialBatchState(): BatchNarrationRegenerationState {
  return {
    isRunning: false,
    total: 0,
    completed: 0,
    failed: 0,
    activeCutNumber: null,
    failedCutNumbers: [],
    warnings: [],
  };
}

/** dirty shot 목록 추출 (mute 제외) */
function extractDirtyCutNumbers(states: Map<number, ShotNarrationState>): number[] {
  const result: number[] = [];
  states.forEach((s, cutNumber) => {
    if (s.narrationDirty && s.mode !== "mute") result.push(cutNumber);
  });
  return result;
}

/** 배치 실행 시뮬레이션 (순차 처리) */
function simulateBatchRegeneration(
  states: Map<number, ShotNarrationState>,
  failingCutNumbers: Set<number> = new Set(),
): {
  updatedStates: Map<number, ShotNarrationState>;
  batchState: BatchNarrationRegenerationState;
  progressSnapshots: BatchNarrationRegenerationState[];
} {
  const dirtyCutNumbers = extractDirtyCutNumbers(states);
  const updatedStates = new Map(states);
  const progressSnapshots: BatchNarrationRegenerationState[] = [];

  if (dirtyCutNumbers.length === 0) {
    const emptyBatch = createInitialBatchState();
    return { updatedStates, batchState: emptyBatch, progressSnapshots: [] };
  }

  let completed = 0;
  let failed = 0;
  const failedCutNumbers: number[] = [];
  const warnings: string[] = [];

  // 시작 상태
  const startState: BatchNarrationRegenerationState = {
    isRunning: true,
    total: dirtyCutNumbers.length,
    completed: 0,
    failed: 0,
    activeCutNumber: null,
    failedCutNumbers: [],
    warnings: [],
  };
  progressSnapshots.push({ ...startState });

  for (const cutNumber of dirtyCutNumbers) {
    // 각 shot 처리 시작
    progressSnapshots.push({
      isRunning: true,
      total: dirtyCutNumbers.length,
      completed: completed + failed,
      failed,
      activeCutNumber: cutNumber,
      failedCutNumbers: [...failedCutNumbers],
      warnings: [...warnings],
    });

    if (failingCutNumbers.has(cutNumber)) {
      // 실패
      failed++;
      failedCutNumbers.push(cutNumber);
      warnings.push(`C${cutNumber}: 생성 실패`);
      // dirty 상태 유지 (변경 없음)
    } else {
      // 성공
      const existing = updatedStates.get(cutNumber);
      if (existing) {
        updatedStates.set(cutNumber, applyGenerationSuccess(
          existing,
          `https://r2.example.com/batch-audio-${cutNumber}.mp3`,
          "exact",
        ));
      }
      completed++;
    }

    // 각 shot 처리 후 상태
    progressSnapshots.push({
      isRunning: true,
      total: dirtyCutNumbers.length,
      completed: completed + failed,
      failed,
      activeCutNumber: cutNumber,
      failedCutNumbers: [...failedCutNumbers],
      warnings: [...warnings],
    });
  }

  // 최종 상태
  const finalState: BatchNarrationRegenerationState = {
    isRunning: false,
    total: dirtyCutNumbers.length,
    completed,
    failed,
    activeCutNumber: null,
    failedCutNumbers,
    warnings,
  };

  return { updatedStates, batchState: finalState, progressSnapshots };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("batch narration regeneration", () => {
  // ── 1. dirty shot만 대상으로 배치 실행 ──
  it("should only target dirty shots for batch regeneration", () => {
    const states = new Map<number, ShotNarrationState>();

    // shot 1: clean
    states.set(1, createDefaultShotNarrationState());

    // shot 2: dirty (text changed)
    let s2 = createDefaultShotNarrationState();
    s2 = applyTextChange(s2, "변경된 텍스트");
    states.set(2, s2);

    // shot 3: dirty (mode changed)
    let s3 = createDefaultShotNarrationState();
    s3 = applyModeChange(s3, "manual");
    states.set(3, s3);

    // shot 4: dirty but mute (should be excluded)
    let s4 = createDefaultShotNarrationState();
    s4 = applyTextChange(s4, "무음 텍스트");
    s4 = applyModeChange(s4, "mute");
    states.set(4, s4);

    const dirtyCuts = extractDirtyCutNumbers(states);
    expect(dirtyCuts).toEqual([2, 3]); // mute shot excluded
    expect(dirtyCuts).not.toContain(1); // clean shot excluded
    expect(dirtyCuts).not.toContain(4); // mute shot excluded
  });

  // ── 2. 성공한 shot은 dirty=false ──
  it("should clear dirty for successfully regenerated shots", () => {
    const states = new Map<number, ShotNarrationState>();

    let s1 = createDefaultShotNarrationState();
    s1 = applyTextChange(s1, "나레이션 1");
    states.set(1, s1);

    let s2 = createDefaultShotNarrationState();
    s2 = applyTextChange(s2, "나레이션 2");
    states.set(2, s2);

    const { updatedStates, batchState } = simulateBatchRegeneration(states);

    expect(updatedStates.get(1)!.narrationDirty).toBe(false);
    expect(updatedStates.get(1)!.lastGeneratedText).toBe("나레이션 1");
    expect(updatedStates.get(1)!.lastGeneratedAudioUrl).toContain("batch-audio-1");

    expect(updatedStates.get(2)!.narrationDirty).toBe(false);
    expect(updatedStates.get(2)!.lastGeneratedText).toBe("나레이션 2");

    expect(batchState.completed).toBe(2);
    expect(batchState.failed).toBe(0);
    expect(batchState.isRunning).toBe(false);
  });

  // ── 3. 실패한 shot은 dirty=true 유지 ──
  it("should keep dirty=true for failed shots", () => {
    const states = new Map<number, ShotNarrationState>();

    let s1 = createDefaultShotNarrationState();
    s1 = applyTextChange(s1, "텍스트 1");
    states.set(1, s1);

    let s2 = createDefaultShotNarrationState();
    s2 = applyTextChange(s2, "텍스트 2");
    states.set(2, s2);

    // shot 2 fails
    const { updatedStates, batchState } = simulateBatchRegeneration(states, new Set([2]));

    expect(updatedStates.get(1)!.narrationDirty).toBe(false);
    expect(updatedStates.get(2)!.narrationDirty).toBe(true);
    expect(updatedStates.get(2)!.lastGeneratedAudioUrl).toBe("");

    expect(batchState.failed).toBe(1);
    expect(batchState.failedCutNumbers).toEqual([2]);
    expect(batchState.warnings.length).toBe(1);
  });

  // ── 4. 일부 실패 시 전체 중단하지 않음 ──
  it("should continue processing after individual shot failure", () => {
    const states = new Map<number, ShotNarrationState>();

    for (let i = 1; i <= 5; i++) {
      let s = createDefaultShotNarrationState();
      s = applyTextChange(s, `텍스트 ${i}`);
      states.set(i, s);
    }

    // shots 2 and 4 fail
    const { updatedStates, batchState } = simulateBatchRegeneration(states, new Set([2, 4]));

    // 성공한 shot
    expect(updatedStates.get(1)!.narrationDirty).toBe(false);
    expect(updatedStates.get(3)!.narrationDirty).toBe(false);
    expect(updatedStates.get(5)!.narrationDirty).toBe(false);

    // 실패한 shot
    expect(updatedStates.get(2)!.narrationDirty).toBe(true);
    expect(updatedStates.get(4)!.narrationDirty).toBe(true);

    // 전체 배치 완료 (중단 없음)
    expect(batchState.isRunning).toBe(false);
    expect(batchState.total).toBe(5);
    expect(batchState.completed).toBe(3);
    expect(batchState.failed).toBe(2);
    expect(batchState.failedCutNumbers).toEqual([2, 4]);
  });

  // ── 5. progress state 계산 ──
  it("should track progress correctly during batch", () => {
    const states = new Map<number, ShotNarrationState>();

    for (let i = 1; i <= 3; i++) {
      let s = createDefaultShotNarrationState();
      s = applyTextChange(s, `텍스트 ${i}`);
      states.set(i, s);
    }

    const { progressSnapshots, batchState } = simulateBatchRegeneration(states);

    // 시작: 0/3 처리
    expect(progressSnapshots[0].isRunning).toBe(true);
    expect(progressSnapshots[0].total).toBe(3);
    expect(progressSnapshots[0].completed).toBe(0);

    // 각 shot 처리 시 activeCutNumber 설정됨
    const activeSnapshots = progressSnapshots.filter(s => s.activeCutNumber !== null);
    expect(activeSnapshots.length).toBeGreaterThan(0);

    // 각 shot 처리 후 completed 증가
    const completionSnapshots = progressSnapshots.filter(s => s.completed > 0);
    expect(completionSnapshots.length).toBeGreaterThan(0);

    // 최종: 3/3 처리 완료
    expect(batchState.total).toBe(3);
    expect(batchState.completed).toBe(3);
    expect(batchState.failed).toBe(0);
    expect(batchState.isRunning).toBe(false);
    expect(batchState.activeCutNumber).toBeNull();
  });

  // ── 6. dirtyShotCount=0이면 배치 대상 없음 ──
  it("should not run batch when no dirty shots exist", () => {
    const states = new Map<number, ShotNarrationState>();

    // 모든 shot이 clean
    states.set(1, createDefaultShotNarrationState());
    states.set(2, createDefaultShotNarrationState());
    states.set(3, createDefaultShotNarrationState());

    const dirtyCuts = extractDirtyCutNumbers(states);
    expect(dirtyCuts.length).toBe(0);

    const { batchState, progressSnapshots } = simulateBatchRegeneration(states);
    expect(batchState.total).toBe(0);
    expect(batchState.isRunning).toBe(false);
    expect(progressSnapshots.length).toBe(0);
  });

  // ── 7. 단일 shot 재생성과 batch 상태 충돌 없음 ──
  it("should maintain independent state for single and batch regeneration", () => {
    const states = new Map<number, ShotNarrationState>();

    // shot 1: dirty
    let s1 = createDefaultShotNarrationState();
    s1 = applyTextChange(s1, "텍스트 1");
    states.set(1, s1);

    // shot 2: dirty
    let s2 = createDefaultShotNarrationState();
    s2 = applyTextChange(s2, "텍스트 2");
    states.set(2, s2);

    // shot 3: clean
    states.set(3, createDefaultShotNarrationState());

    // 단일 shot 1 재생성 (batch 전)
    const singleUpdated = new Map(states);
    singleUpdated.set(1, applyGenerationSuccess(singleUpdated.get(1)!, "https://single.mp3", "exact"));

    expect(singleUpdated.get(1)!.narrationDirty).toBe(false);
    expect(singleUpdated.get(2)!.narrationDirty).toBe(true);

    // batch 재생성 (남은 dirty shots만)
    const { updatedStates, batchState } = simulateBatchRegeneration(singleUpdated);

    // shot 1: 이미 단일 재생성으로 clean → 배치 대상 아님, 기존 오디오 유지
    expect(updatedStates.get(1)!.narrationDirty).toBe(false);
    expect(updatedStates.get(1)!.lastGeneratedAudioUrl).toBe("https://single.mp3");

    // shot 2: 배치로 재생성됨
    expect(updatedStates.get(2)!.narrationDirty).toBe(false);
    expect(updatedStates.get(2)!.lastGeneratedAudioUrl).toContain("batch-audio-2");

    // shot 3: clean 유지
    expect(updatedStates.get(3)!.narrationDirty).toBe(false);

    // 배치는 dirty shot 1개만 처리
    expect(batchState.total).toBe(1);
    expect(batchState.completed).toBe(1);
    expect(batchState.failed).toBe(0);
  });

  // ── Edge cases ──
  it("should handle mute-mode shots being excluded from batch", () => {
    const states = new Map<number, ShotNarrationState>();

    // shot 1: dirty auto mode
    let s1 = createDefaultShotNarrationState();
    s1 = applyTextChange(s1, "텍스트");
    states.set(1, s1);

    // shot 2: dirty but mute
    let s2 = createDefaultShotNarrationState();
    s2 = applyTextChange(s2, "무음 텍스트");
    s2 = { ...s2, mode: "mute" };
    states.set(2, s2);

    const dirtyCuts = extractDirtyCutNumbers(states);
    expect(dirtyCuts).toEqual([1]);

    const { batchState } = simulateBatchRegeneration(states);
    expect(batchState.total).toBe(1);
    expect(batchState.completed).toBe(1);
  });

  it("should correctly compute final summary with mixed results", () => {
    const states = new Map<number, ShotNarrationState>();

    for (let i = 1; i <= 4; i++) {
      let s = createDefaultShotNarrationState();
      s = applyTextChange(s, `텍스트 ${i}`);
      states.set(i, s);
    }

    // shots 1, 3 fail
    const { batchState } = simulateBatchRegeneration(states, new Set([1, 3]));

    expect(batchState.total).toBe(4);
    expect(batchState.completed).toBe(2); // successful only
    expect(batchState.failed).toBe(2);
    expect(batchState.failedCutNumbers).toEqual([1, 3]);
    expect(batchState.warnings.length).toBe(2);
    expect(batchState.isRunning).toBe(false);
    expect(batchState.activeCutNumber).toBeNull();
  });
});
