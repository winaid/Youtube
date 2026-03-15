/**
 * script-segmenter.ts — 장문 스크립트 자동 세그먼트 분할
 *
 * 핵심 목적:
 *   1. 장문 나레이션/스크립트를 Kling 생성 제약(3-15초)에 맞는 세그먼트로 분할
 *   2. 세그먼트 간 연속성(continuation) 체이닝 지원
 *   3. 총 프로젝트 런타임 최대 300초(5분)까지 스케일
 *   4. 세그먼트별 런타임 예산 배분
 *
 * 분할 기준:
 *   - 문단 경계 (빈 줄)
 *   - 문장 경계 (마침표/느낌표/물음표)
 *   - 씬 전환 힌트 (장면, INT., EXT., — 등)
 *   - 타겟 런타임 기반 균등 배분
 */

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

export const SEGMENT_MIN_DURATION = 3;
export const SEGMENT_MAX_DURATION = 15;
export const SEGMENT_DEFAULT_DURATION = 8;
export const PROJECT_MAX_RUNTIME = 300;

const SCENE_BREAK_PATTERNS = [
  /^(INT\.|EXT\.|내부|외부|장면|SCENE|CUT TO|FADE|—{2,}|#{1,3}\s)/im,
  /\n\n+/,
];

const READING_SPEED_CPS = 4.5;

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ScriptSegment {
  segmentIndex: number;
  text: string;
  estimatedDurationSec: number;
  assignedDurationSec: number;
  isFirstSegment: boolean;
  isLastSegment: boolean;
  continuationFromPrev: boolean;
  narrativeLabel: string;
}

export interface SegmentationPlan {
  totalSegments: number;
  totalEstimatedDurationSec: number;
  totalAssignedDurationSec: number;
  targetRuntimeSec: number;
  segments: ScriptSegment[];
  warnings: string[];
}

export interface SegmentationConfig {
  targetRuntimeSec: number;
  preferredSegmentDurationSec?: number;
  maxSegments?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Text Analysis
// ═══════════════════════════════════════════════════════════════════

function estimateReadingDuration(text: string): number {
  const charCount = text.replace(/\s+/g, "").length;
  return Math.max(SEGMENT_MIN_DURATION, charCount / READING_SPEED_CPS);
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function hasSceneBreak(text: string): boolean {
  return SCENE_BREAK_PATTERNS.some(p => p.test(text));
}

function inferNarrativeLabel(text: string, index: number, total: number): string {
  if (index === 0) return "도입";
  if (index === total - 1) return "마무리";

  const lower = text.toLowerCase();
  if (/갑자기|그런데|하지만|그때|돌연|반전/.test(lower)) return "전환점";
  if (/결국|마침내|드디어|끝내/.test(lower)) return "클라이맥스";
  if (/한편|그리고|이어서|다음/.test(lower)) return "전개";

  const relativePosition = index / (total - 1);
  if (relativePosition < 0.3) return "전개";
  if (relativePosition < 0.7) return "발전";
  return "절정";
}

// ═══════════════════════════════════════════════════════════════════
// Segmentation
// ═══════════════════════════════════════════════════════════════════

function splitTextIntoRawSegments(text: string): string[] {
  const paragraphs = splitIntoParagraphs(text);

  if (paragraphs.length >= 2) return paragraphs;

  const sentences = splitIntoSentences(text);
  if (sentences.length >= 2) return sentences;

  return [text];
}

function mergeSmallSegments(
  rawSegments: string[],
  preferredDuration: number,
): string[] {
  const result: string[] = [];
  let buffer = "";

  for (const seg of rawSegments) {
    const combined = buffer ? `${buffer} ${seg}` : seg;
    const combinedDuration = estimateReadingDuration(combined);

    if (combinedDuration <= preferredDuration * 1.3) {
      buffer = combined;
    } else {
      if (buffer) result.push(buffer);
      buffer = seg;
    }
  }
  if (buffer) result.push(buffer);

  return result;
}

function splitLargeSegments(
  segments: string[],
  maxDuration: number,
): string[] {
  const result: string[] = [];

  for (const seg of segments) {
    const duration = estimateReadingDuration(seg);
    if (duration <= maxDuration) {
      result.push(seg);
      continue;
    }

    const sentences = splitIntoSentences(seg);
    let buffer = "";
    for (const sentence of sentences) {
      const combined = buffer ? `${buffer} ${sentence}` : sentence;
      if (estimateReadingDuration(combined) > maxDuration && buffer) {
        result.push(buffer);
        buffer = sentence;
      } else {
        buffer = combined;
      }
    }
    if (buffer) result.push(buffer);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// Main Entry Point
// ═══════════════════════════════════════════════════════════════════

export function segmentScript(
  scriptText: string,
  config: SegmentationConfig,
): SegmentationPlan {
  const { targetRuntimeSec, preferredSegmentDurationSec, maxSegments } = config;
  const preferredDuration = preferredSegmentDurationSec ?? SEGMENT_DEFAULT_DURATION;
  const warnings: string[] = [];

  const clampedTarget = Math.min(targetRuntimeSec, PROJECT_MAX_RUNTIME);
  if (targetRuntimeSec > PROJECT_MAX_RUNTIME) {
    warnings.push(`타겟 런타임이 ${PROJECT_MAX_RUNTIME}초로 제한되었습니다.`);
  }

  let rawSegments = splitTextIntoRawSegments(scriptText);
  rawSegments = mergeSmallSegments(rawSegments, preferredDuration);
  rawSegments = splitLargeSegments(rawSegments, SEGMENT_MAX_DURATION);

  if (maxSegments && rawSegments.length > maxSegments) {
    while (rawSegments.length > maxSegments && rawSegments.length >= 2) {
      let smallestIdx = 0;
      let smallestDuration = Infinity;
      for (let i = 0; i < rawSegments.length - 1; i++) {
        const d = estimateReadingDuration(rawSegments[i]);
        if (d < smallestDuration) {
          smallestDuration = d;
          smallestIdx = i;
        }
      }
      rawSegments[smallestIdx] = `${rawSegments[smallestIdx]} ${rawSegments[smallestIdx + 1]}`;
      rawSegments.splice(smallestIdx + 1, 1);
    }
    warnings.push(`세그먼트 수가 ${maxSegments}개로 병합되었습니다.`);
  }

  const totalEstimatedDuration = rawSegments.reduce(
    (sum, seg) => sum + estimateReadingDuration(seg),
    0,
  );

  const durationScale = totalEstimatedDuration > 0
    ? clampedTarget / totalEstimatedDuration
    : 1;

  const segments: ScriptSegment[] = rawSegments.map((text, i) => {
    const estimated = estimateReadingDuration(text);
    const scaled = Math.round(estimated * durationScale);
    const assigned = Math.max(SEGMENT_MIN_DURATION, Math.min(SEGMENT_MAX_DURATION, scaled));

    return {
      segmentIndex: i + 1,
      text,
      estimatedDurationSec: Math.round(estimated),
      assignedDurationSec: assigned,
      isFirstSegment: i === 0,
      isLastSegment: i === rawSegments.length - 1,
      continuationFromPrev: i > 0,
      narrativeLabel: inferNarrativeLabel(text, i, rawSegments.length),
    };
  });

  const totalAssigned = segments.reduce((s, seg) => s + seg.assignedDurationSec, 0);

  if (totalAssigned > clampedTarget * 1.1) {
    warnings.push(`세그먼트 합계(${totalAssigned}s)가 타겟(${clampedTarget}s)을 초과합니다. 세그먼트 길이를 조정하세요.`);
  }

  return {
    totalSegments: segments.length,
    totalEstimatedDurationSec: Math.round(totalEstimatedDuration),
    totalAssignedDurationSec: totalAssigned,
    targetRuntimeSec: clampedTarget,
    segments,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}초`;
  return `${m}분 ${s}초`;
}

export function isLongScript(text: string): boolean {
  const charCount = text.replace(/\s+/g, "").length;
  return charCount > 80 || splitIntoParagraphs(text).length >= 3;
}
