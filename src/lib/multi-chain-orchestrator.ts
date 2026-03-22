/**
 * multi-chain-orchestrator.ts — 멀티 체인 오케스트레이터
 *
 * VEO 단일 extend 체인 상한: ~141초 (8s + 19 extends × 7s)
 * 141초 이상 영상은 여러 체인을 이어 붙여서 생성한다.
 *
 * 전략:
 *   1. 총 목표 시간을 체인으로 분할 (각 체인 ≤ 141초)
 *   2. 각 체인 내부: Cut 1 = generate/image-to-video, Cut 2+ = extend
 *   3. 체인 간 브릿지: 이전 체인 마지막 프레임 → 다음 체인 첫 컷 image-to-video
 *   4. 전체 완료 후 client-stitch로 결합
 *
 * 감독 Visual DNA는 모든 체인에 걸쳐 유지된다.
 */

import { VEO_SEGMENT_CAP, VEO_EXTENSION_DURATION } from "./veo-capability";

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

/** 단일 체인 최대 길이 (초) — VEO 3.1 기준 */
export const SINGLE_CHAIN_MAX_SEC = 141;

/** 체인당 최대 extend 횟수 */
export const MAX_EXTENDS_PER_CHAIN = 19;

/** 안전 마진: 실제로는 ~135초로 체인 컷 (연장 실패 대비) */
const CHAIN_SAFE_MARGIN_SEC = 6;
const EFFECTIVE_CHAIN_MAX = SINGLE_CHAIN_MAX_SEC - CHAIN_SAFE_MARGIN_SEC; // 135초

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ChainSegment {
  /** 체인 인덱스 (0-based) */
  chainIndex: number;
  /** 이 체인의 시작 시각 (전체 영상 기준, 초) */
  startTimeSec: number;
  /** 이 체인의 목표 길이 (초) */
  targetDurationSec: number;
  /** 이 체인 내 컷 수 (첫 컷 + extend 횟수) */
  cutCount: number;
  /** 첫 컷 생성 모드 */
  firstCutMode: "text-to-video" | "image-to-video";
  /** 이 체인의 전체 영상 내 컷 범위 (1-based, inclusive) */
  cutRange: { start: number; end: number };
}

export interface MultiChainPlan {
  /** 전체 목표 길이 (초) */
  totalTargetSec: number;
  /** 체인 수 */
  chainCount: number;
  /** 각 체인 세그먼트 */
  chains: ChainSegment[];
  /** 멀티 체인 필요 여부 (141초 이하면 false) */
  isMultiChain: boolean;
  /** 전체 컷 수 */
  totalCutCount: number;
  /** 예상 비용 (USD, VEO 3.1 Fast 기준) */
  estimatedCostUsd: number;
  /** 예상 생성 시간 (분) — 매우 대략적 */
  estimatedMinutes: number;
}

export type ChainStatus = "idle" | "generating" | "bridging" | "completed" | "failed";

export interface ChainProgress {
  chainIndex: number;
  status: ChainStatus;
  /** 이 체인에서 완료된 컷 수 */
  completedCuts: number;
  /** 이 체인의 총 컷 수 */
  totalCuts: number;
  /** 브릿지 프레임 캡처 완료? (마지막 체인 제외) */
  bridgeFrameCaptured: boolean;
  /** 에러 메시지 */
  error?: string;
}

export interface MultiChainProgress {
  plan: MultiChainPlan;
  chains: ChainProgress[];
  /** 현재 활성 체인 인덱스 */
  activeChainIndex: number;
  /** 전체 진행률 (0-100) */
  overallProgress: number;
  /** 전체 완료된 컷 수 */
  totalCompletedCuts: number;
  /** 전체 상태 */
  status: "idle" | "running" | "stitching" | "completed" | "failed";
}

// ═══════════════════════════════════════════════════════════════════
// Plan Builder
// ═══════════════════════════════════════════════════════════════════

/**
 * 총 목표 시간에 대한 멀티 체인 플랜을 생성한다.
 *
 * @param totalTargetSec 전체 목표 길이 (초)
 * @returns MultiChainPlan
 */
export function buildMultiChainPlan(totalTargetSec: number): MultiChainPlan {
  if (totalTargetSec <= 0) {
    return {
      totalTargetSec: 0,
      chainCount: 0,
      chains: [],
      isMultiChain: false,
      totalCutCount: 0,
      estimatedCostUsd: 0,
      estimatedMinutes: 0,
    };
  }

  // 단일 체인으로 충분한 경우
  if (totalTargetSec <= SINGLE_CHAIN_MAX_SEC) {
    const cutCount = computeCutsForDuration(totalTargetSec);
    return {
      totalTargetSec,
      chainCount: 1,
      chains: [{
        chainIndex: 0,
        startTimeSec: 0,
        targetDurationSec: totalTargetSec,
        cutCount,
        firstCutMode: "text-to-video",
        cutRange: { start: 1, end: cutCount },
      }],
      isMultiChain: false,
      totalCutCount: cutCount,
      estimatedCostUsd: totalTargetSec * 0.15,
      estimatedMinutes: Math.ceil(cutCount * 1.5),
    };
  }

  // 멀티 체인 분할
  const chains: ChainSegment[] = [];
  let remaining = totalTargetSec;
  let currentStart = 0;
  let globalCutOffset = 1;

  while (remaining > 0) {
    const chainDuration = Math.min(remaining, EFFECTIVE_CHAIN_MAX);
    const cutCount = computeCutsForDuration(chainDuration);
    const isFirstChain = chains.length === 0;

    chains.push({
      chainIndex: chains.length,
      startTimeSec: currentStart,
      targetDurationSec: chainDuration,
      cutCount,
      firstCutMode: isFirstChain ? "text-to-video" : "image-to-video",
      cutRange: { start: globalCutOffset, end: globalCutOffset + cutCount - 1 },
    });

    globalCutOffset += cutCount;
    currentStart += chainDuration;
    remaining -= chainDuration;
  }

  const totalCutCount = chains.reduce((sum, c) => sum + c.cutCount, 0);

  return {
    totalTargetSec,
    chainCount: chains.length,
    chains,
    isMultiChain: true,
    totalCutCount,
    estimatedCostUsd: Math.round(totalTargetSec * 0.15 * 100) / 100,
    estimatedMinutes: Math.ceil(totalCutCount * 1.5),
  };
}

/**
 * 주어진 duration에 필요한 컷(세그먼트) 수를 계산한다.
 * 첫 컷 = 8초, 이후 extend = 7초씩
 */
function computeCutsForDuration(durationSec: number): number {
  if (durationSec <= VEO_SEGMENT_CAP) return 1;
  // 첫 컷 8초 + (남은 시간 / 7초)
  const remaining = durationSec - VEO_SEGMENT_CAP;
  return 1 + Math.ceil(remaining / VEO_EXTENSION_DURATION);
}

// ═══════════════════════════════════════════════════════════════════
// Progress Tracker
// ═══════════════════════════════════════════════════════════════════

/**
 * 멀티 체인 진행 상태를 초기화한다.
 */
export function createMultiChainProgress(plan: MultiChainPlan): MultiChainProgress {
  return {
    plan,
    chains: plan.chains.map((c) => ({
      chainIndex: c.chainIndex,
      status: "idle" as ChainStatus,
      completedCuts: 0,
      totalCuts: c.cutCount,
      bridgeFrameCaptured: false,
    })),
    activeChainIndex: 0,
    overallProgress: 0,
    totalCompletedCuts: 0,
    status: "idle",
  };
}

/**
 * 컷 완료 시 진행 상태를 업데이트한다.
 */
export function updateChainProgress(
  progress: MultiChainProgress,
  chainIndex: number,
  completedCuts: number,
): MultiChainProgress {
  const newChains = progress.chains.map((c) =>
    c.chainIndex === chainIndex
      ? { ...c, completedCuts, status: "generating" as ChainStatus }
      : c
  );

  const totalCompleted = newChains.reduce((sum, c) => sum + c.completedCuts, 0);
  const totalCuts = progress.plan.totalCutCount;

  return {
    ...progress,
    chains: newChains,
    totalCompletedCuts: totalCompleted,
    overallProgress: totalCuts > 0 ? Math.round((totalCompleted / totalCuts) * 100) : 0,
  };
}

/**
 * 체인 완료를 기록한다.
 */
export function markChainCompleted(
  progress: MultiChainProgress,
  chainIndex: number,
): MultiChainProgress {
  const newChains = progress.chains.map((c) =>
    c.chainIndex === chainIndex
      ? { ...c, status: "completed" as ChainStatus, completedCuts: c.totalCuts }
      : c
  );

  const allDone = newChains.every((c) => c.status === "completed");
  const nextChainIndex = newChains.findIndex((c) => c.status === "idle");

  return {
    ...progress,
    chains: newChains,
    activeChainIndex: nextChainIndex >= 0 ? nextChainIndex : chainIndex,
    totalCompletedCuts: newChains.reduce((sum, c) => sum + c.completedCuts, 0),
    overallProgress: allDone ? 100 : progress.overallProgress,
    status: allDone ? "stitching" : "running",
  };
}

/**
 * 체인 실패를 기록한다.
 */
export function markChainFailed(
  progress: MultiChainProgress,
  chainIndex: number,
  error: string,
): MultiChainProgress {
  const newChains = progress.chains.map((c) =>
    c.chainIndex === chainIndex
      ? { ...c, status: "failed" as ChainStatus, error }
      : c
  );

  return {
    ...progress,
    chains: newChains,
    status: "failed",
  };
}

/**
 * 브릿지 프레임 캡처 완료를 기록한다.
 */
export function markBridgeFrameCaptured(
  progress: MultiChainProgress,
  chainIndex: number,
): MultiChainProgress {
  const newChains = progress.chains.map((c) =>
    c.chainIndex === chainIndex
      ? { ...c, bridgeFrameCaptured: true, status: "bridging" as ChainStatus }
      : c
  );

  return {
    ...progress,
    chains: newChains,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Chain-aware Cut Assignment
// ═══════════════════════════════════════════════════════════════════

/**
 * 글로벌 cutNumber가 어떤 체인에 속하는지 반환한다.
 */
export function getChainForCut(plan: MultiChainPlan, globalCutNumber: number): ChainSegment | null {
  return plan.chains.find(
    (c) => globalCutNumber >= c.cutRange.start && globalCutNumber <= c.cutRange.end
  ) ?? null;
}

/**
 * 글로벌 cutNumber가 해당 체인 내에서 몇 번째인지 반환한다. (1-based)
 */
export function getLocalCutNumber(plan: MultiChainPlan, globalCutNumber: number): number {
  const chain = getChainForCut(plan, globalCutNumber);
  if (!chain) return globalCutNumber;
  return globalCutNumber - chain.cutRange.start + 1;
}

/**
 * 해당 컷이 체인의 첫 번째 컷인지 판별한다.
 * 체인 첫 컷이면 generate 또는 image-to-video, 아니면 extend.
 */
export function isChainFirstCut(plan: MultiChainPlan, globalCutNumber: number): boolean {
  const chain = getChainForCut(plan, globalCutNumber);
  if (!chain) return globalCutNumber === 1;
  return globalCutNumber === chain.cutRange.start;
}

/**
 * 해당 컷이 체인의 마지막 컷인지 판별한다.
 * 체인 마지막 컷이면 브릿지 프레임 캡처가 필요하다.
 */
export function isChainLastCut(plan: MultiChainPlan, globalCutNumber: number): boolean {
  const chain = getChainForCut(plan, globalCutNumber);
  if (!chain) return false;
  return globalCutNumber === chain.cutRange.end;
}

/**
 * 해당 컷의 비디오 모드를 결정한다.
 * - 전체 첫 컷: text-to-video
 * - 체인 첫 컷 (체인 2+): image-to-video (이전 체인 마지막 프레임 사용)
 * - 그 외: extend
 */
export function resolveVideoModeForCut(
  plan: MultiChainPlan,
  globalCutNumber: number,
): "generate" | "extend" {
  if (globalCutNumber === 1) return "generate";
  if (isChainFirstCut(plan, globalCutNumber)) return "generate"; // image-to-video (generate mode)
  return "extend";
}

// ═══════════════════════════════════════════════════════════════════
// Summary Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * 멀티 체인 플랜의 사용자 설명 문자열을 생성한다.
 */
export function buildMultiChainSummary(plan: MultiChainPlan): string {
  if (!plan.isMultiChain) {
    return `단일 체인: ${plan.totalCutCount}컷, ~${plan.totalTargetSec}초`;
  }

  const chainDescs = plan.chains.map((c) => {
    const mode = c.chainIndex === 0 ? "시작" : "이어가기";
    return `체인${c.chainIndex + 1}(${mode}): ${c.cutCount}컷, ~${c.targetDurationSec}초`;
  });

  return [
    `멀티 체인 (${plan.chainCount}체인): 총 ${plan.totalCutCount}컷, ~${formatDuration(plan.totalTargetSec)}`,
    `예상 비용: $${plan.estimatedCostUsd.toFixed(2)} | 예상 시간: ~${plan.estimatedMinutes}분`,
    ...chainDescs,
  ].join("\n");
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}분 ${s}초` : `${m}분`;
}
