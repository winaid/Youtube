/**
 * narration-dirty-state.test.ts — narration 편집/생성 정합성 추적 테스트
 *
 * 테스트 대상:
 * 1. narrationText 수정 시 narrationDirty=true
 * 2. mode 변경(auto/manual/mute) 시 dirty=true
 * 3. regenerateShotNarration 성공 시 dirty=false
 * 4. currentText != lastGeneratedText 이면 stale
 * 5. sequence dirtyShotCount 계산
 * 6. history restore 시 narrationText/mode 복원
 * 7. separate delivery에서도 stale 상태 표시
 */

import { describe, it, expect } from "vitest";
import type {
  ShotNarrationState,
  SequenceNarrationState,
  NarrationMode,
} from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Helper: dirty-state 계산 로직 (useVideoGeneration에서 추출한 순수 로직)
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

function computeSequenceState(states: Map<number, ShotNarrationState>): SequenceNarrationState {
  let dirtyShotCount = 0;
  states.forEach((s) => { if (s.narrationDirty) dirtyShotCount++; });
  return {
    dirtyShotCount,
    allShotsInSync: dirtyShotCount === 0 && states.size > 0,
    lastGeneratedSnapshotId: "",
  };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("narration dirty-state tracking", () => {
  // ── 1. narrationText 수정 시 narrationDirty=true ──
  it("should mark dirty when narrationText changes", () => {
    const state = createDefaultShotNarrationState();
    const updated = applyTextChange(state, "새로운 나레이션");
    expect(updated.narrationDirty).toBe(true);
    expect(updated.currentText).toBe("새로운 나레이션");
  });

  // ── 2. mode 변경(auto/manual/mute) 시 dirty=true ──
  it("should mark dirty when mode changes from auto to manual", () => {
    const state = createDefaultShotNarrationState();
    const updated = applyModeChange(state, "manual");
    expect(updated.narrationDirty).toBe(true);
    expect(updated.mode).toBe("manual");
  });

  it("should mark dirty when mode changes from auto to mute", () => {
    const state = createDefaultShotNarrationState();
    const updated = applyModeChange(state, "mute");
    expect(updated.narrationDirty).toBe(true);
  });

  it("should not mark dirty when mode stays the same", () => {
    const state = createDefaultShotNarrationState();
    const updated = applyModeChange(state, "auto");
    expect(updated.narrationDirty).toBe(false);
  });

  // ── 3. regenerateShotNarration 성공 시 dirty=false ──
  it("should clear dirty after successful generation", () => {
    let state = createDefaultShotNarrationState();
    state = applyTextChange(state, "나레이션 텍스트");
    expect(state.narrationDirty).toBe(true);

    state = applyGenerationSuccess(state, "https://r2.example.com/audio.mp3", "exact");
    expect(state.narrationDirty).toBe(false);
    expect(state.lastGeneratedText).toBe("나레이션 텍스트");
    expect(state.lastGeneratedAudioUrl).toBe("https://r2.example.com/audio.mp3");
    expect(state.lastGeneratedSyncStatus).toBe("exact");
    expect(state.lastGeneratedAt).toBeGreaterThan(0);
  });

  // ── 4. currentText != lastGeneratedText 이면 stale ──
  it("should detect stale when currentText differs from lastGeneratedText", () => {
    let state = createDefaultShotNarrationState();
    state = applyTextChange(state, "원래 텍스트");
    state = applyGenerationSuccess(state, "https://audio.mp3", "exact");
    expect(state.narrationDirty).toBe(false);

    // 텍스트 변경 → stale
    state = applyTextChange(state, "수정된 텍스트");
    expect(state.narrationDirty).toBe(true);
    expect(state.currentText).not.toBe(state.lastGeneratedText);
  });

  it("should not be stale when currentText equals lastGeneratedText", () => {
    let state = createDefaultShotNarrationState();
    state = applyTextChange(state, "동일 텍스트");
    state = applyGenerationSuccess(state, "https://audio.mp3", "exact");
    // 같은 텍스트로 다시 설정
    state = applyTextChange(state, "동일 텍스트");
    expect(state.narrationDirty).toBe(false);
  });

  // ── 5. sequence dirtyShotCount 계산 ──
  it("should compute sequence dirtyShotCount correctly", () => {
    const states = new Map<number, ShotNarrationState>();

    // shot 1: clean
    const s1 = createDefaultShotNarrationState();
    states.set(1, s1);

    // shot 2: dirty
    let s2 = createDefaultShotNarrationState();
    s2 = applyTextChange(s2, "변경됨");
    states.set(2, s2);

    // shot 3: dirty
    let s3 = createDefaultShotNarrationState();
    s3 = applyModeChange(s3, "manual");
    states.set(3, s3);

    const seqState = computeSequenceState(states);
    expect(seqState.dirtyShotCount).toBe(2);
    expect(seqState.allShotsInSync).toBe(false);
  });

  it("should report allShotsInSync when no shots are dirty", () => {
    const states = new Map<number, ShotNarrationState>();
    states.set(1, createDefaultShotNarrationState());
    states.set(2, createDefaultShotNarrationState());

    const seqState = computeSequenceState(states);
    expect(seqState.dirtyShotCount).toBe(0);
    expect(seqState.allShotsInSync).toBe(true);
  });

  it("should report not in sync when map is empty", () => {
    const states = new Map<number, ShotNarrationState>();
    const seqState = computeSequenceState(states);
    expect(seqState.allShotsInSync).toBe(false);
  });

  // ── 6. history restore 시 narrationText/mode 복원 ──
  it("should restore narration state from history data", () => {
    // history에 저장된 데이터 시뮬레이션
    const historyNarration = {
      narrationMode: "manual" as const,
      narrationText: "히스토리에서 복원된 텍스트",
      narrationAudioUri: "https://audio.mp3",
      narrationSyncStatus: "exact",
      narrationGeneratedAt: Date.now() - 10000,
    };

    // initShotNarrationState 로직 재현
    const restored: ShotNarrationState = {
      mode: historyNarration.narrationMode,
      currentText: historyNarration.narrationText,
      lastGeneratedText: historyNarration.narrationAudioUri ? historyNarration.narrationText : "",
      narrationDirty: false,
      lastGeneratedAudioUrl: historyNarration.narrationAudioUri,
      lastGeneratedSyncStatus: (historyNarration.narrationSyncStatus || "") as "exact" | "trimmed" | "padded" | "",
      lastGeneratedAt: historyNarration.narrationGeneratedAt || 0,
      lastGeneratedMode: historyNarration.narrationMode,
    };

    expect(restored.mode).toBe("manual");
    expect(restored.currentText).toBe("히스토리에서 복원된 텍스트");
    expect(restored.lastGeneratedText).toBe("히스토리에서 복원된 텍스트");
    expect(restored.narrationDirty).toBe(false);
    expect(restored.lastGeneratedAudioUrl).toBe("https://audio.mp3");
  });

  it("should mark as dirty when history has no audio URL", () => {
    const historyNarration = {
      narrationMode: "manual" as const,
      narrationText: "텍스트만 있고 오디오 없음",
      narrationAudioUri: undefined,
      narrationSyncStatus: undefined,
      narrationGeneratedAt: undefined,
    };

    const restored: ShotNarrationState = {
      mode: historyNarration.narrationMode,
      currentText: historyNarration.narrationText || "",
      lastGeneratedText: historyNarration.narrationAudioUri ? (historyNarration.narrationText || "") : "",
      narrationDirty: false, // initial, will be dirty if text differs from lastGenerated
      lastGeneratedAudioUrl: historyNarration.narrationAudioUri || "",
      lastGeneratedSyncStatus: "",
      lastGeneratedAt: 0,
      lastGeneratedMode: historyNarration.narrationMode,
    };

    // currentText != lastGeneratedText → 실제로는 dirty
    restored.narrationDirty = restored.currentText !== restored.lastGeneratedText;
    expect(restored.narrationDirty).toBe(true);
  });

  // ── 7. separate delivery에서도 stale 상태 표시 ──
  it("should track dirty state independently of delivery mode", () => {
    // separate delivery에서도 dirty-state 추적은 동일하게 동작
    let state = createDefaultShotNarrationState();
    state = applyTextChange(state, "원래 텍스트");
    state = applyGenerationSuccess(state, "https://separate-audio.mp3", "padded");
    expect(state.narrationDirty).toBe(false);
    expect(state.lastGeneratedSyncStatus).toBe("padded");

    // 텍스트 변경 → stale
    state = applyTextChange(state, "변경된 텍스트");
    expect(state.narrationDirty).toBe(true);

    // 시퀀스 수준에서도 반영
    const states = new Map<number, ShotNarrationState>();
    states.set(1, state);
    states.set(2, createDefaultShotNarrationState());
    const seqState = computeSequenceState(states);
    expect(seqState.dirtyShotCount).toBe(1);
    expect(seqState.allShotsInSync).toBe(false);
  });

  // ── Edge cases ──
  it("should handle mode change after generation and text change", () => {
    let state = createDefaultShotNarrationState();
    state = applyTextChange(state, "test");
    state = applyGenerationSuccess(state, "https://audio.mp3", "exact");
    expect(state.narrationDirty).toBe(false);

    // mode만 변경
    state = applyModeChange(state, "mute");
    expect(state.narrationDirty).toBe(true);

    // 원래 mode로 복원
    state = applyModeChange(state, "auto");
    expect(state.narrationDirty).toBe(false); // mode + text 모두 일치
  });

  it("should handle multiple text changes and verify only final state", () => {
    let state = createDefaultShotNarrationState();
    state = applyTextChange(state, "v1");
    state = applyGenerationSuccess(state, "https://audio.mp3", "exact");

    state = applyTextChange(state, "v2");
    expect(state.narrationDirty).toBe(true);

    state = applyTextChange(state, "v3");
    expect(state.narrationDirty).toBe(true);

    // 원래 텍스트로 복원
    state = applyTextChange(state, "v1");
    expect(state.narrationDirty).toBe(false);
  });
});
