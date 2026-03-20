/**
 * montage-export.ts — 멀티컷 몽타주 export 유틸
 *
 * 설계 원칙:
 *   - structuredSequence cutNumber 순서 = stitch 순서의 source of truth
 *   - Kling 1회 요청 = 1개 독립 컷 clip
 *   - stitch = 완료된 독립 clip들을 cutNumber 순서로 concat하는 후처리 단계
 *   - stitch 구현 상태를 동적 감지하여 UI에 정확히 반영
 *
 * 구현 경로:
 *   - server_ffmpeg: Cloudflare Workers 환경 제약으로 미구현
 *   - client_wasm: FFmpeg.wasm 기반 — @ffmpeg/ffmpeg 패키지 + COOP/COEP 헤더 필요
 *   - not_available: 위 둘 다 불가능한 경우 → 개별 clip 다운로드 fallback
 */

import type { VideoClip, Cut } from "@/types";
import type { StitchJob, StitchProgress } from "@/lib/client-stitch";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface MontageClip {
  cutNumber: number;
  videoUri: string;
  durationSec: number;
  status: "completed" | "missing";
}

export type StitchCapability = "not_available" | "client_wasm" | "server_ffmpeg";

export interface MontageExportState {
  /** 전체 clip 중 완료된 수 */
  completedCount: number;
  /** 전체 clip 수 */
  totalCount: number;
  /** 모든 clip이 완료되어 stitch 가능한 상태인지 */
  allClipsReady: boolean;
  /** cutNumber 순서대로 정렬된 clip 목록 */
  orderedClips: MontageClip[];
  /** 누락된 cutNumber 목록 */
  missingCutNumbers: number[];
  /** 총 예상 길이 (초) */
  totalDurationSec: number;
  /** stitch 구현 가용 상태 */
  stitchCapability: StitchCapability;
  /** stitch가 불가능한 이유 (사용자 안내용, capability=not_available일 때) */
  stitchUnavailableReason: string;
  /**
   * Audio mux support status — honest disclosure.
   *
   * Current state: false.
   * FFmpeg concat pipeline uses -c copy (video stream only).
   * Narration/SFX audio tracks are NOT included in exported montage.
   * Audio is functional in preview (timeline playback) but NOT in export.
   */
  audioMuxSupported: boolean;
  /** User-facing audio limitation message */
  audioLimitationNotice: string;
}

/** stitch 실행 가능 여부 판정 결과 */
export interface StitchReadiness {
  /** stitch 실행 가능한지 */
  canStitch: boolean;
  /** 불가 사유 (canStitch=false일 때) */
  reason: string;
  /** stitch 엔진 */
  capability: StitchCapability;
}

// ═══════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * cuts와 clips 상태를 기반으로 montage export 상태를 계산.
 * structuredSequence의 cutNumber 순서를 그대로 stitch 순서의 source of truth로 사용.
 *
 * stitchCapability는 동기적으로 "not_available" 기본값.
 * 런타임 감지는 detectStitchCapability()를 별도 호출.
 */
export function computeMontageExportState(
  cuts: Cut[],
  clips: VideoClip[],
): MontageExportState {
  const totalCount = cuts.length;

  // cutNumber 순서대로 정렬
  const sortedCuts = [...cuts].sort((a, b) => a.cutNumber - b.cutNumber);

  const orderedClips: MontageClip[] = sortedCuts.map((cut) => {
    const clip = clips.find((c) => c.cutNumber === cut.cutNumber);
    if (clip?.status === "completed" && clip.videoUri) {
      return {
        cutNumber: cut.cutNumber,
        videoUri: clip.videoUri,
        durationSec: cut.durationSec,
        status: "completed" as const,
      };
    }
    return {
      cutNumber: cut.cutNumber,
      videoUri: "",
      durationSec: cut.durationSec,
      status: "missing" as const,
    };
  });

  const completedCount = orderedClips.filter((c) => c.status === "completed").length;
  const missingCutNumbers = orderedClips
    .filter((c) => c.status === "missing")
    .map((c) => c.cutNumber);
  const allClipsReady = completedCount === totalCount && totalCount > 0;
  const totalDurationSec = orderedClips.reduce((s, c) => s + c.durationSec, 0);

  return {
    completedCount,
    totalCount,
    allClipsReady,
    orderedClips,
    missingCutNumbers,
    totalDurationSec,
    stitchCapability: "not_available",
    stitchUnavailableReason:
      "현재 버전에서는 서버/클라이언트 stitch(ffmpeg/WebCodecs)가 미구현입니다. " +
      "개별 clip을 다운로드한 후 외부 편집 도구로 합쳐주세요.",
    audioMuxSupported: false,
    audioLimitationNotice:
      "내보내기 영상에는 오디오가 포함되지 않습니다. " +
      "나레이션/효과음은 미리보기에서만 재생되며, 몽타주 합성 시 비디오 스트림만 결합됩니다. " +
      "오디오가 필요한 경우, 개별 오디오 파일을 다운로드하여 외부 편집 도구에서 합성하세요.",
  };
}

/**
 * 런타임에서 stitch 가용 능력을 비동기로 감지.
 * FFmpeg.wasm 패키지 설치 + SharedArrayBuffer + WASM 지원 여부를 확인.
 *
 * 결과를 MontageExportState에 반영하려면:
 *   const cap = await detectStitchCapability();
 *   state.stitchCapability = cap.capability;
 */
export async function detectStitchCapability(): Promise<{
  capability: StitchCapability;
  unavailableReason: string;
}> {
  // 서버 환경이면 바로 불가
  if (typeof window === "undefined") {
    return {
      capability: "not_available",
      unavailableReason: "서버 환경에서는 영상 합치기를 사용할 수 없습니다.",
    };
  }

  try {
    const { detectFFmpegAvailability, getFFmpegUnavailableMessage } =
      await import("@/lib/ffmpeg-wasm-loader");
    const result = await detectFFmpegAvailability();

    if (result.available) {
      return { capability: "client_wasm", unavailableReason: "" };
    }

    return {
      capability: "not_available",
      unavailableReason: getFFmpegUnavailableMessage(result.reason),
    };
  } catch {
    return {
      capability: "not_available",
      unavailableReason:
        "영상 합치기 환경 감지에 실패했습니다. 개별 clip을 다운로드한 후 외부 편집 도구로 합쳐주세요.",
    };
  }
}

/**
 * stitch 실행 가능 여부를 종합 판정.
 * capability + allClipsReady를 모두 확인.
 */
export function evaluateStitchReadiness(
  state: MontageExportState,
): StitchReadiness {
  if (state.stitchCapability === "not_available") {
    return {
      canStitch: false,
      reason: state.stitchUnavailableReason,
      capability: "not_available",
    };
  }

  if (!state.allClipsReady) {
    const missing = state.missingCutNumbers.map((n) => `#${n}`).join(", ");
    return {
      canStitch: false,
      reason: `미완료 장면이 있습니다: ${missing}. 모든 clip이 완료되어야 합칠 수 있습니다.`,
      capability: state.stitchCapability,
    };
  }

  return {
    canStitch: true,
    reason: "",
    capability: state.stitchCapability,
  };
}

/**
 * 완료된 clip URL들을 cutNumber 순서대로 반환.
 * stitch concat 순서의 source of truth.
 */
export function getOrderedClipUrls(
  cuts: Cut[],
  clips: VideoClip[],
): string[] {
  const state = computeMontageExportState(cuts, clips);
  return state.orderedClips
    .filter((c) => c.status === "completed")
    .map((c) => c.videoUri);
}

/**
 * 모든 완료된 clip을 순서대로 개별 다운로드.
 * stitch 불가능 상태에서의 fallback UX.
 */
export async function downloadAllClips(
  cuts: Cut[],
  clips: VideoClip[],
  projectTitle?: string,
): Promise<{ downloaded: number; failed: number }> {
  const state = computeMontageExportState(cuts, clips);
  const completedClips = state.orderedClips.filter((c) => c.status === "completed");

  let downloaded = 0;
  let failed = 0;

  for (const clip of completedClips) {
    try {
      const response = await fetch(clip.videoUri);
      if (!response.ok) {
        console.warn(`[montage-export] Failed to fetch clip ${clip.cutNumber}: ${response.status}`);
        failed++;
        continue;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const prefix = projectTitle
        ? projectTitle.replace(/[^a-zA-Z0-9가-힣\s]/g, "").slice(0, 30).trim()
        : "montage";
      a.href = url;
      a.download = `${prefix}_scene-${clip.cutNumber}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      downloaded++;
      // 브라우저 다운로드 큐 혼잡 방지
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      failed++;
    }
  }

  return { downloaded, failed };
}

// ═══════════════════════════════════════════════════════════════════
// Stitch Execution (client_wasm 경로)
// ═══════════════════════════════════════════════════════════════════

/**
 * client_wasm stitch 실행.
 * computeMontageExportState()의 orderedClips를 그대로 전달.
 * cutNumber 순서 = concat 순서.
 *
 * @returns StitchJob 최종 상태 (phase=done|error)
 */
export async function executeClientStitch(
  state: MontageExportState,
  projectTitle?: string,
  onProgress?: (progress: StitchProgress) => void,
): Promise<StitchJob> {
  const readiness = evaluateStitchReadiness(state);
  if (!readiness.canStitch) {
    // StitchJob을 에러 상태로 반환 (import 없이 인라인 생성)
    return {
      jobId: `stitch-error-${Date.now()}`,
      phase: "error",
      inputClipCount: state.completedCount,
      totalDurationSec: state.totalDurationSec,
      progress: { phase: "error", percent: 0, message: readiness.reason },
      outputUrl: null,
      outputSizeBytes: null,
      errorMessage: readiness.reason,
      startedAt: Date.now(),
      finishedAt: Date.now(),
    };
  }

  // dynamic import로 실제 stitch 파이프라인 로딩
  const { executeStitch } = await import("@/lib/client-stitch");
  return executeStitch(state.orderedClips, projectTitle, onProgress);
}
