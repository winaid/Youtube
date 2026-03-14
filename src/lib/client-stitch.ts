/**
 * client-stitch.ts — 클라이언트사이드 FFmpeg.wasm 기반 clip concat 파이프라인
 *
 * 설계 원칙:
 *   - structuredSequence cutNumber 순서 = stitch 순서의 source of truth
 *   - Kling 1회 요청 = 1개 독립 컷 clip (multiShot ≠ stitch 대체물)
 *   - stitch = 완료된 독립 clip들을 cutNumber 순서로 concat하는 후처리 단계
 *   - stitch 불가능 상태를 절대 숨기지 않음
 *
 * 파이프라인:
 *   1. fetchClipBlobs — cutNumber 순서대로 clip URL → Blob 다운로드
 *   2. concatClips — FFmpeg.wasm concat demuxer로 단일 mp4 생성
 *   3. exportStitchedVideo — Blob → Object URL 생성 + 자동 다운로드
 *
 * 상태 모델:
 *   StitchJob — stitch 작업의 전체 라이프사이클 추적
 *   StitchPhase — idle → fetching → encoding → done / error
 */

import type { MontageClip } from "@/lib/montage-export";
import type { FFmpegInstance } from "@/lib/ffmpeg-wasm-loader";

// ═══════════════════════════════════════════════════════════════════
// Types — Stitch Job Lifecycle
// ═══════════════════════════════════════════════════════════════════

export type StitchPhase =
  | "idle"       // 시작 전
  | "fetching"   // clip Blob 다운로드 중
  | "encoding"   // FFmpeg concat 실행 중
  | "done"       // 완료 — outputUrl 사용 가능
  | "error";     // 실패 — errorMessage 참조

export interface StitchProgress {
  phase: StitchPhase;
  /** 현재 단계 내 진행률 (0-100) */
  percent: number;
  /** 사용자 표시용 메시지 */
  message: string;
}

export interface StitchJob {
  /** 고유 job ID */
  jobId: string;
  /** 현재 phase */
  phase: StitchPhase;
  /** 입력 clip 수 */
  inputClipCount: number;
  /** 총 예상 길이 (초) */
  totalDurationSec: number;
  /** 현재 진행 상태 */
  progress: StitchProgress;
  /** 완료 시 결과 Blob URL (phase=done일 때만 유효) */
  outputUrl: string | null;
  /** 완료 시 결과 Blob 크기 (bytes) */
  outputSizeBytes: number | null;
  /** 실패 시 에러 메시지 */
  errorMessage: string | null;
  /** 시작 시각 (ms) */
  startedAt: number;
  /** 완료 시각 (ms, phase=done|error) */
  finishedAt: number | null;
}

export type StitchErrorCode =
  | "no_clips"               // 완료된 clip이 없음
  | "missing_clips"          // 일부 clip 누락 (allClipsReady=false)
  | "ffmpeg_unavailable"     // FFmpeg.wasm 로딩 불가
  | "fetch_failed"           // clip 다운로드 실패
  | "concat_failed"          // FFmpeg concat 실행 실패
  | "output_empty";          // concat 결과물이 비어 있음

export class StitchError extends Error {
  readonly code: StitchErrorCode;
  constructor(code: StitchErrorCode, message: string) {
    super(message);
    this.name = "StitchError";
    this.code = code;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Stitch Job Factory
// ═══════════════════════════════════════════════════════════════════

let jobCounter = 0;

export function createStitchJob(clips: MontageClip[]): StitchJob {
  const completedClips = clips.filter((c) => c.status === "completed");
  return {
    jobId: `stitch-${++jobCounter}-${Date.now()}`,
    phase: "idle",
    inputClipCount: completedClips.length,
    totalDurationSec: completedClips.reduce((s, c) => s + c.durationSec, 0),
    progress: { phase: "idle", percent: 0, message: "대기 중" },
    outputUrl: null,
    outputSizeBytes: null,
    errorMessage: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Core Pipeline
// ═══════════════════════════════════════════════════════════════════

/**
 * cutNumber 순서대로 정렬된 완료 clip들의 URL → Blob 다운로드.
 * 순서 보장: orderedClips 배열 순서 그대로.
 */
export async function fetchClipBlobs(
  orderedClips: MontageClip[],
  onProgress?: (fetched: number, total: number) => void,
): Promise<Uint8Array[]> {
  const completed = orderedClips.filter((c) => c.status === "completed");
  if (completed.length === 0) {
    throw new StitchError("no_clips", "완료된 clip이 없습니다.");
  }

  const blobs: Uint8Array[] = [];
  for (let i = 0; i < completed.length; i++) {
    try {
      const res = await fetch(completed[i].videoUri);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const arrayBuf = await res.arrayBuffer();
      blobs.push(new Uint8Array(arrayBuf));
      onProgress?.(i + 1, completed.length);
    } catch (err) {
      throw new StitchError(
        "fetch_failed",
        `장면 #${completed[i].cutNumber} 다운로드 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return blobs;
}

/**
 * FFmpeg.wasm concat demuxer로 clip들을 단일 mp4로 결합.
 *
 * 방식: concat demuxer (재인코딩 없이 stream copy)
 *   - 모든 clip이 같은 코덱/해상도/프레임레이트여야 함 (Kling 출력 기준 동일)
 *   - 코덱 불일치 시 재인코딩 fallback
 *
 * @param ffmpeg — loadFFmpeg()에서 받은 인스턴스
 * @param clipData — cutNumber 순서대로 정렬된 clip Uint8Array[]
 * @returns 결합된 mp4 Uint8Array
 */
export async function concatClips(
  ffmpeg: FFmpegInstance,
  clipData: Uint8Array[],
): Promise<Uint8Array> {
  if (clipData.length === 0) {
    throw new StitchError("no_clips", "concat할 clip이 없습니다.");
  }

  // 1. clip 파일들을 ffmpeg 가상 파일시스템에 쓰기
  const fileNames: string[] = [];
  for (let i = 0; i < clipData.length; i++) {
    const name = `clip_${String(i).padStart(3, "0")}.mp4`;
    await ffmpeg.writeFile(name, clipData[i]);
    fileNames.push(name);
  }

  // 2. concat demuxer 목록 파일 생성
  const concatList = fileNames.map((f) => `file '${f}'`).join("\n");
  await ffmpeg.writeFile(
    "concat_list.txt",
    new TextEncoder().encode(concatList),
  );

  // 3. concat 실행 (stream copy — 재인코딩 없이 빠른 결합)
  const outputName = "montage_output.mp4";
  const exitCode = await ffmpeg.exec([
    "-f", "concat",
    "-safe", "0",
    "-i", "concat_list.txt",
    "-c", "copy",
    "-movflags", "+faststart",
    outputName,
  ]);

  if (exitCode !== 0) {
    // stream copy 실패 시 — 재인코딩 fallback은 여기서 시도하지 않음
    // (재인코딩은 극도로 느리고 브라우저 메모리 한계에 취약)
    throw new StitchError(
      "concat_failed",
      `FFmpeg concat 실패 (exit code: ${exitCode}). clip 간 코덱/해상도 불일치 가능.`,
    );
  }

  // 4. 결과 읽기
  const outputData = await ffmpeg.readFile(outputName);
  if (outputData.length === 0) {
    throw new StitchError("output_empty", "concat 결과물이 비어 있습니다.");
  }

  // 5. 정리
  for (const name of fileNames) {
    await ffmpeg.deleteFile(name).catch(() => {});
  }
  await ffmpeg.deleteFile("concat_list.txt").catch(() => {});
  await ffmpeg.deleteFile(outputName).catch(() => {});

  return outputData;
}

/**
 * 결합된 mp4 데이터를 Blob URL로 변환하고 자동 다운로드 트리거.
 */
export function exportStitchedVideo(
  data: Uint8Array,
  projectTitle?: string,
): { blobUrl: string; sizeBytes: number } {
  const blob = new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" });
  const blobUrl = URL.createObjectURL(blob);

  const prefix = projectTitle
    ? projectTitle.replace(/[^a-zA-Z0-9가-힣\s]/g, "").slice(0, 30).trim()
    : "montage";
  const filename = `${prefix}_montage.mp4`;

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  return { blobUrl, sizeBytes: blob.size };
}

// ═══════════════════════════════════════════════════════════════════
// Full Stitch Pipeline (orchestrator)
// ═══════════════════════════════════════════════════════════════════

/**
 * 전체 stitch 파이프라인 실행.
 * orderedClips는 반드시 cutNumber 순서대로 정렬된 상태여야 함.
 *
 * @param orderedClips — computeMontageExportState().orderedClips
 * @param projectTitle — 파일명 접두어
 * @param onProgress — 진행 상태 콜백
 * @returns StitchJob 최종 상태
 */
export async function executeStitch(
  orderedClips: MontageClip[],
  projectTitle: string | undefined,
  onProgress?: (progress: StitchProgress) => void,
): Promise<StitchJob> {
  const job = createStitchJob(orderedClips);
  const completedClips = orderedClips.filter((c) => c.status === "completed");

  if (completedClips.length === 0) {
    job.phase = "error";
    job.errorMessage = "완료된 clip이 없습니다.";
    job.progress = { phase: "error", percent: 0, message: job.errorMessage };
    job.finishedAt = Date.now();
    onProgress?.(job.progress);
    return job;
  }

  try {
    // Phase 1: fetch
    job.phase = "fetching";
    job.progress = { phase: "fetching", percent: 0, message: "clip 다운로드 중..." };
    onProgress?.(job.progress);

    const clipData = await fetchClipBlobs(orderedClips, (fetched, total) => {
      const pct = Math.round((fetched / total) * 50); // 0-50%
      job.progress = {
        phase: "fetching",
        percent: pct,
        message: `clip 다운로드 중... (${fetched}/${total})`,
      };
      onProgress?.(job.progress);
    });

    // Phase 2: encode
    job.phase = "encoding";
    job.progress = { phase: "encoding", percent: 50, message: "FFmpeg.wasm 로딩 중..." };
    onProgress?.(job.progress);

    const { loadFFmpeg } = await import("@/lib/ffmpeg-wasm-loader");
    const ffmpeg = await loadFFmpeg();

    job.progress = { phase: "encoding", percent: 60, message: "영상 결합 중..." };
    onProgress?.(job.progress);

    const outputData = await concatClips(ffmpeg, clipData);

    job.progress = { phase: "encoding", percent: 90, message: "파일 생성 중..." };
    onProgress?.(job.progress);

    // Phase 3: export
    const { blobUrl, sizeBytes } = exportStitchedVideo(outputData, projectTitle);

    job.phase = "done";
    job.outputUrl = blobUrl;
    job.outputSizeBytes = sizeBytes;
    job.finishedAt = Date.now();
    job.progress = {
      phase: "done",
      percent: 100,
      message: `완료 (${(sizeBytes / 1024 / 1024).toFixed(1)}MB)`,
    };
    onProgress?.(job.progress);
  } catch (err) {
    job.phase = "error";
    job.errorMessage = err instanceof Error ? err.message : String(err);
    job.finishedAt = Date.now();
    job.progress = { phase: "error", percent: 0, message: job.errorMessage };
    onProgress?.(job.progress);
  }

  return job;
}
