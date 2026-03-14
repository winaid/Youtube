/**
 * montage-export.ts — 멀티컷 몽타주 export 유틸
 *
 * 현재 상태:
 *   - 서버사이드 ffmpeg stitch는 미구현 (Cloudflare Workers 환경 제약)
 *   - 클라이언트사이드 WebCodecs/FFmpeg.wasm stitch도 미구현
 *   - 이 모듈은 clip URL 수집 + 순서 검증 + 개별 다운로드 + stitch 준비 상태 판단을 담당
 *
 * 설계 원칙:
 *   - structuredSequence cutNumber 순서 = stitch 순서의 source of truth
 *   - Kling 1회 요청 = 1개 독립 컷 clip
 *   - stitch 구현이 없는 상태를 숨기지 않고 명시적으로 노출
 */

import type { VideoClip, Cut } from "@/types";

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
  /** stitch가 불가능한 이유 (사용자 안내용) */
  stitchUnavailableReason: string;
}

// ═══════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * cuts와 clips 상태를 기반으로 montage export 상태를 계산.
 * structuredSequence의 cutNumber 순서를 그대로 stitch 순서의 source of truth로 사용.
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
  };
}

/**
 * 완료된 clip URL들을 cutNumber 순서대로 반환.
 * stitch 구현 시 이 순서로 concat하면 됨.
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
 * stitch 미구현 상태에서의 최선의 UX.
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
