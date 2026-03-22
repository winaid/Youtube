/**
 * audiobook-composer.ts — 오디오북 영상 합성 (FFmpeg.wasm)
 *
 * 파이프라인: 이미지 + 오디오(TTS) + 자막(SRT) + BGM → MP4 영상
 *
 * 설계:
 *   - 기존 ffmpeg-wasm-loader.ts 싱글톤 재사용
 *   - 각 씬: 1장 이미지 + 1개 나레이션 오디오 → 해당 오디오 길이만큼의 영상 클립
 *   - 전체 씬 클립을 concat → 최종 영상
 *   - BGM은 전체 길이에 맞춰 볼륨 낮춰서 믹싱
 *   - 자막은 SRT 파일로 하드 번인
 *
 * 제약:
 *   - 브라우저 FFmpeg.wasm — 매우 긴 영상(10분+)은 메모리 이슈 가능
 *   - 폰트 파일을 wasm 파일시스템에 써야 자막 렌더링 가능
 */

import type { FFmpegInstance } from "@/lib/ffmpeg-wasm-loader";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface AudiobookScene {
  /** 씬 인덱스 (1-based) */
  index: number;
  /** 나레이션 텍스트 */
  narration: string;
  /** 이미지 base64 (PNG/JPEG) */
  imageBase64: string;
  imageMimeType: string;
  /** TTS 오디오 base64 (WAV/MP3) */
  audioBase64: string;
  audioMimeType: string;
  /** 이 씬의 자막 SRT 텍스트 (선택) */
  srt?: string;
}

export interface AudiobookComposeOptions {
  /** 1920x1080 (기본) 또는 1080x1920 */
  resolution: "landscape" | "portrait";
  /** 씬 간 페이드 전환 시간 (초, 기본 0.5) */
  fadeDuration: number;
  /** BGM 파일 (선택) */
  bgm?: {
    data: Uint8Array;
    /** BGM 볼륨 (0.0 ~ 1.0, 기본 0.15) */
    volume: number;
  };
  /** 자막 폰트 파일 (선택 — 없으면 자막 비활성) */
  subtitleFont?: {
    data: Uint8Array;
    filename: string; // e.g. "KOTRA_SONGEULSSI.ttf"
  };
  /** 프로젝트 제목 (파일명용) */
  projectTitle?: string;
}

export type ComposePhase =
  | "idle"
  | "preparing"   // 파일 쓰기
  | "composing"   // FFmpeg 실행
  | "mixing"      // BGM 믹싱
  | "finalizing"  // 출력 생성
  | "done"
  | "error";

export interface ComposeProgress {
  phase: ComposePhase;
  percent: number;
  message: string;
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function base64ToUint8Array(base64: string): Uint8Array {
  const cleaned = base64.replace(/^data:[^;]+;base64,/, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getResolution(res: "landscape" | "portrait"): { w: number; h: number } {
  return res === "portrait" ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
}

function imageExtension(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  return "png";
}

function audioExtension(mimeType: string): string {
  if (mimeType.includes("mp3") || mimeType.includes("mpeg")) return "mp3";
  return "wav";
}

// ═══════════════════════════════════════════════════════════════════
// Per-Scene Clip Generation
// ═══════════════════════════════════════════════════════════════════

/**
 * 단일 씬을 MP4 클립으로 변환.
 * 이미지를 오디오 길이만큼 루프하여 영상화 + fade-in/out.
 */
async function composeSceneClip(
  ffmpeg: FFmpegInstance,
  scene: AudiobookScene,
  options: AudiobookComposeOptions,
): Promise<string> {
  const { w, h } = getResolution(options.resolution);
  const imgExt = imageExtension(scene.imageMimeType);
  const audExt = audioExtension(scene.audioMimeType);
  const imgFile = `scene_${scene.index}_img.${imgExt}`;
  const audFile = `scene_${scene.index}_aud.${audExt}`;
  const outFile = `scene_${scene.index}_clip.mp4`;

  // 파일 쓰기
  await ffmpeg.writeFile(imgFile, base64ToUint8Array(scene.imageBase64));
  await ffmpeg.writeFile(audFile, base64ToUint8Array(scene.audioBase64));

  const fade = options.fadeDuration;

  // FFmpeg: 이미지 + 오디오 → 영상 클립
  // -loop 1: 이미지를 반복
  // -shortest: 오디오가 끝나면 영상도 종료
  // fade in/out 효과 적용
  const filterParts = [
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x1a1a1a`,
    `format=yuv420p`,
  ];

  // fade-in at start
  if (fade > 0) {
    filterParts.push(`fade=t=in:st=0:d=${fade}`);
  }

  // fade-out은 오디오 길이를 모르므로 별도 패스 필요 — 여기선 in만 적용
  const videoFilter = filterParts.join(",");

  const exitCode = await ffmpeg.exec([
    "-loop", "1",
    "-i", imgFile,
    "-i", audFile,
    "-vf", videoFilter,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "stillimage",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "44100",
    "-ac", "2",
    "-shortest",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-movflags", "+faststart",
    outFile,
  ]);

  // 임시 파일 정리
  await ffmpeg.deleteFile(imgFile).catch(() => {});
  await ffmpeg.deleteFile(audFile).catch(() => {});

  if (exitCode !== 0) {
    throw new Error(`Scene ${scene.index} composition failed (exit: ${exitCode})`);
  }

  return outFile;
}

// ═══════════════════════════════════════════════════════════════════
// Concat + BGM Mix
// ═══════════════════════════════════════════════════════════════════

/**
 * 씬 클립들을 하나로 concat한 뒤 BGM 믹싱.
 */
async function concatAndMix(
  ffmpeg: FFmpegInstance,
  clipFiles: string[],
  options: AudiobookComposeOptions,
): Promise<Uint8Array> {
  const concatFile = "concat_list.txt";
  const concatOutput = "concat_output.mp4";
  const finalOutput = "final_output.mp4";

  // concat 목록 생성
  const concatList = clipFiles.map((f) => `file '${f}'`).join("\n");
  await ffmpeg.writeFile(concatFile, new TextEncoder().encode(concatList));

  // concat 실행 (재인코딩으로 안전하게 — 각 씬의 길이가 다를 수 있으므로)
  const concatExit = await ffmpeg.exec([
    "-f", "concat",
    "-safe", "0",
    "-i", concatFile,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    concatOutput,
  ]);

  // 씬 클립 정리
  for (const f of clipFiles) {
    await ffmpeg.deleteFile(f).catch(() => {});
  }
  await ffmpeg.deleteFile(concatFile).catch(() => {});

  if (concatExit !== 0) {
    throw new Error(`Concat failed (exit: ${concatExit})`);
  }

  // BGM 믹싱
  if (options.bgm) {
    const bgmFile = "bgm_input.mp3";
    await ffmpeg.writeFile(bgmFile, options.bgm.data);

    const vol = options.bgm.volume;
    // amix: 나레이션(원본 볼륨) + BGM(vol %)
    const mixExit = await ffmpeg.exec([
      "-i", concatOutput,
      "-i", bgmFile,
      "-filter_complex",
      `[1:a]volume=${vol},aloop=loop=-1:size=2e+09[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[out]`,
      "-map", "0:v",
      "-map", "[out]",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      "-movflags", "+faststart",
      finalOutput,
    ]);

    await ffmpeg.deleteFile(bgmFile).catch(() => {});
    await ffmpeg.deleteFile(concatOutput).catch(() => {});

    if (mixExit !== 0) {
      throw new Error(`BGM mixing failed (exit: ${mixExit})`);
    }
  } else {
    // BGM 없으면 concat 결과를 그대로 사용
    // rename 대신 copy
    const data = await ffmpeg.readFile(concatOutput);
    await ffmpeg.writeFile(finalOutput, data);
    await ffmpeg.deleteFile(concatOutput).catch(() => {});
  }

  const output = await ffmpeg.readFile(finalOutput);
  await ffmpeg.deleteFile(finalOutput).catch(() => {});

  if (output.length === 0) {
    throw new Error("Final output is empty");
  }

  return output;
}

// ═══════════════════════════════════════════════════════════════════
// Main Compose Pipeline
// ═══════════════════════════════════════════════════════════════════

/**
 * 오디오북 영상 전체 합성 파이프라인.
 *
 * @param scenes — 씬 배열 (index 순서대로)
 * @param options — 해상도, 페이드, BGM 등
 * @param onProgress — 진행 콜백
 * @returns MP4 Uint8Array
 */
export async function composeAudiobookVideo(
  scenes: AudiobookScene[],
  options: AudiobookComposeOptions,
  onProgress?: (progress: ComposeProgress) => void,
): Promise<{ data: Uint8Array; sizeBytes: number; sceneDurations: number[] }> {
  if (scenes.length === 0) {
    throw new Error("씬이 없습니다.");
  }

  onProgress?.({ phase: "preparing", percent: 5, message: "FFmpeg.wasm 로딩 중..." });

  const { loadFFmpeg } = await import("@/lib/ffmpeg-wasm-loader");
  const ffmpeg = await loadFFmpeg();

  // 씬별 클립 생성
  const clipFiles: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    onProgress?.({
      phase: "composing",
      percent: 10 + Math.round((i / scenes.length) * 60),
      message: `씬 ${i + 1}/${scenes.length} 합성 중...`,
    });

    const clipFile = await composeSceneClip(ffmpeg, scenes[i], options);
    clipFiles.push(clipFile);
  }

  // concat + BGM 믹싱
  onProgress?.({
    phase: options.bgm ? "mixing" : "finalizing",
    percent: 75,
    message: options.bgm ? "BGM 믹싱 중..." : "최종 영상 생성 중...",
  });

  const outputData = await concatAndMix(ffmpeg, clipFiles, options);

  onProgress?.({
    phase: "done",
    percent: 100,
    message: `완료 (${(outputData.length / 1024 / 1024).toFixed(1)}MB)`,
  });

  return {
    data: outputData,
    sizeBytes: outputData.length,
    sceneDurations: [], // FFmpeg에서 개별 씬 길이를 추적하기 어려움
  };
}

/**
 * 합성된 영상을 다운로드.
 */
export function downloadAudiobookVideo(
  data: Uint8Array,
  projectTitle?: string,
): { blobUrl: string; sizeBytes: number } {
  const blob = new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" });
  const blobUrl = URL.createObjectURL(blob);

  const prefix = projectTitle
    ? projectTitle.replace(/[^a-zA-Z0-9가-힣\s]/g, "").slice(0, 30).trim()
    : "audiobook";
  const filename = `${prefix}_audiobook.mp4`;

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  return { blobUrl, sizeBytes: blob.size };
}
