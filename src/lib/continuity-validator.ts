/**
 * continuity-validator.ts — 병합 전 연속성 검증
 *
 * 역할: 생성된 세그먼트들의 경계 연속성을 검증하고,
 * 문제가 있는 세그먼트의 재생성을 추천한다.
 *
 * 의존: continuity-policy.ts (임계치), types/continuity.ts (타입)
 */

import type {
  SegmentState,
  ContinuityValidationSeverity,
  ContinuityValidationResult,
  ContinuityValidationReport,
  ContinuitySegmentProgress,
} from "@/types/continuity";

import type { ContinuityPolicy } from "@/lib/continuity-policy";
import {
  DEFAULT_CONTINUITY_POLICY,
  getValidationThreshold,
} from "@/lib/continuity-policy";

// ═══════════════════════════════════════════════════════════════════
// 1. Keyword Similarity
// ═══════════════════════════════════════════════════════════════════

/** 두 문자열의 키워드 유사도 (0-1). 공통 단어 비율 기반. */
function keywordSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/[\s,;.]+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/[\s,;.]+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  return common / Math.max(wordsA.size, wordsB.size);
}

// ═══════════════════════════════════════════════════════════════════
// 2. Motion Direction Check
// ═══════════════════════════════════════════════════════════════════

const DIRECTION_TOKENS: Record<string, string[]> = {
  left: ["left", "←"],
  right: ["right", "→"],
  forward: ["forward", "approaching", "toward", "push-in"],
  backward: ["backward", "retreating", "away", "pull-back"],
  up: ["up", "rising", "crane up", "ascending"],
  down: ["down", "descending", "crane down", "lowering"],
};

function extractDirection(motionVector: string): string | null {
  const lower = motionVector.toLowerCase();
  for (const [dir, tokens] of Object.entries(DIRECTION_TOKENS)) {
    if (tokens.some(t => lower.includes(t))) return dir;
  }
  return null;
}

function isDirectionContinuous(endMotion: string, startMotion: string): boolean {
  if (!endMotion || !startMotion) return true; // 정보 없으면 통과
  const endDir = extractDirection(endMotion);
  const startDir = extractDirection(startMotion);
  if (!endDir || !startDir) return true;
  return endDir === startDir;
}

// ═══════════════════════════════════════════════════════════════════
// 3. Camera Jump Check
// ═══════════════════════════════════════════════════════════════════

const FRAMING_ORDER = ["ECU", "CU", "MCU", "MS", "MLS", "LS", "WS"];

function framingDistance(a: string, b: string): number {
  const idxA = FRAMING_ORDER.indexOf(a.toUpperCase());
  const idxB = FRAMING_ORDER.indexOf(b.toUpperCase());
  if (idxA < 0 || idxB < 0) return 0;
  return Math.abs(idxA - idxB);
}

function hasCameraJump(endCamera: string, startCamera: string): boolean {
  if (!endCamera || !startCamera) return false;

  // framing 추출 (첫 토큰)
  const endFraming = endCamera.split(/[\s,]+/)[0];
  const startFraming = startCamera.split(/[\s,]+/)[0];

  // 3단계 이상 점프는 경고
  return framingDistance(endFraming, startFraming) >= 3;
}

// ═══════════════════════════════════════════════════════════════════
// 4. Individual Rule Validators
// ═══════════════════════════════════════════════════════════════════

function validateCharacterConsistency(
  segA: SegmentState,
  segB: SegmentState,
  from: number,
  to: number,
): ContinuityValidationResult {
  // subjectPosition(위치/자세/외형) + emotionKeyword(감정)를 합쳐서
  // 캐릭터 정체성을 더 넓게 비교 (위치만 비교하면 외형 드리프트를 놓침)
  const descA = [segA.subjectPosition, segA.emotionKeyword].filter(Boolean).join(", ");
  const descB = [segB.subjectPosition, segB.emotionKeyword].filter(Boolean).join(", ");
  const similarity = keywordSimilarity(descA, descB);
  const threshold = getValidationThreshold("CONT-01")!;

  let severity: ContinuityValidationSeverity = "pass";
  if (similarity < threshold.errorThreshold) severity = "error";
  else if (similarity < threshold.warnThreshold) severity = "warning";

  return {
    ruleId: "CONT-01",
    severity,
    boundaryFrom: from,
    boundaryTo: to,
    message: severity === "pass"
      ? "인물 일관성 통과"
      : `인물 묘사 유사도 ${Math.round(similarity * 100)}% — ${severity === "error" ? "인물이 크게 달라 보일 수 있음" : "인물 묘사 차이 감지"}`,
    autoFixable: false,
    suggestion: severity !== "pass" ? "해당 세그먼트를 재생성하세요" : undefined,
  };
}

function validateColorConsistency(
  segA: SegmentState,
  segB: SegmentState,
  from: number,
  to: number,
): ContinuityValidationResult {
  const similarity = keywordSimilarity(segA.lightingState, segB.lightingState);
  const threshold = getValidationThreshold("CONT-02")!;

  let severity: ContinuityValidationSeverity = "pass";
  if (similarity < threshold.errorThreshold) severity = "error";
  else if (similarity < threshold.warnThreshold) severity = "warning";

  return {
    ruleId: "CONT-02",
    severity,
    boundaryFrom: from,
    boundaryTo: to,
    message: severity === "pass" ? "색감 일관성 통과" : `색감/조명 유사도 ${Math.round(similarity * 100)}%`,
    autoFixable: false,
  };
}

function validateLightingConsistency(
  segA: SegmentState,
  segB: SegmentState,
  from: number,
  to: number,
): ContinuityValidationResult {
  const similarity = keywordSimilarity(segA.lightingState, segB.lightingState);
  const threshold = getValidationThreshold("CONT-03")!;

  let severity: ContinuityValidationSeverity = "pass";
  if (similarity < threshold.errorThreshold) severity = "error";
  else if (similarity < threshold.warnThreshold) severity = "warning";

  return {
    ruleId: "CONT-03",
    severity,
    boundaryFrom: from,
    boundaryTo: to,
    message: severity === "pass" ? "조명 일관성 통과" : `조명 유사도 ${Math.round(similarity * 100)}%`,
    autoFixable: false,
  };
}

function validateMotionContinuity(
  segA: SegmentState,
  segB: SegmentState,
  from: number,
  to: number,
): ContinuityValidationResult {
  const isContinuous = isDirectionContinuous(segA.motionVector, segB.motionVector);

  return {
    ruleId: "CONT-04",
    severity: isContinuous ? "pass" : "warning",
    boundaryFrom: from,
    boundaryTo: to,
    message: isContinuous ? "동작 방향 연속" : "동작 방향 불연속 감지 — 이어붙이면 어색할 수 있음",
    autoFixable: true,
    suggestion: !isContinuous ? "다음 세그먼트의 시작 동작 방향을 이전과 맞춰 재생성" : undefined,
  };
}

function validateEmotionContinuity(
  segA: SegmentState,
  segB: SegmentState,
  from: number,
  to: number,
  policy: ContinuityPolicy,
): ContinuityValidationResult {
  const delta = Math.abs(segA.emotionIntensity - segB.emotionIntensity);
  const maxDelta = policy.segmentEnding.maxEmotionIntensityDelta;
  const threshold = getValidationThreshold("CONT-05")!;

  let severity: ContinuityValidationSeverity = "pass";
  if (delta > threshold.errorThreshold) severity = "error";
  else if (delta > threshold.warnThreshold) severity = "warning";

  return {
    ruleId: "CONT-05",
    severity,
    boundaryFrom: from,
    boundaryTo: to,
    message: severity === "pass"
      ? "감정 연속성 통과"
      : `감정 강도 변화 ${delta} (허용 ${maxDelta}) — ${severity === "error" ? "급격한 감정 전환" : "감정 변화 감지"}`,
    autoFixable: false,
  };
}

function validateCameraJump(
  segA: SegmentState,
  segB: SegmentState,
  from: number,
  to: number,
): ContinuityValidationResult {
  const hasJump = hasCameraJump(segA.cameraState, segB.cameraState);

  return {
    ruleId: "CONT-06",
    severity: hasJump ? "warning" : "pass",
    boundaryFrom: from,
    boundaryTo: to,
    message: hasJump ? "카메라 앵글 급변 감지 — 이어붙이면 점프컷 느낌 가능" : "카메라 연속성 통과",
    autoFixable: true,
    suggestion: hasJump ? "이전 세그먼트의 끝 카메라 상태와 유사하게 재생성" : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 5. Full Validation
// ═══════════════════════════════════════════════════════════════════

/**
 * 완료된 세그먼트들의 경계 연속성을 전체 검증한다.
 *
 * @param segmentProgresses — 완료된 세그먼트 생성 진행 목록 (confirmedEndState 필요)
 * @param policy — 검증 정책
 */
export function validateContinuity(
  segmentProgresses: ContinuitySegmentProgress[],
  policy: ContinuityPolicy = DEFAULT_CONTINUITY_POLICY,
): ContinuityValidationReport {
  const results: ContinuityValidationResult[] = [];

  // 완료된 세그먼트만 필터
  const completed = segmentProgresses.filter(
    s => s.status === "completed" && s.confirmedEndState,
  );

  // 인접 세그먼트 쌍 검증
  for (let i = 0; i < completed.length - 1; i++) {
    const segA = completed[i].confirmedEndState!;
    const segB = completed[i + 1].confirmedEndState!;
    const from = completed[i].segmentIndex;
    const to = completed[i + 1].segmentIndex;

    results.push(validateCharacterConsistency(segA, segB, from, to));
    results.push(validateColorConsistency(segA, segB, from, to));
    results.push(validateLightingConsistency(segA, segB, from, to));
    results.push(validateMotionContinuity(segA, segB, from, to));
    results.push(validateEmotionContinuity(segA, segB, from, to, policy));
    results.push(validateCameraJump(segA, segB, from, to));
  }

  const warningCount = results.filter(r => r.severity === "warning").length;
  const errorCount = results.filter(r => r.severity === "error").length;

  // 재생성 추천: error가 있는 경계의 후속 세그먼트
  const regenerateSet = new Set<number>();
  for (const r of results) {
    if (r.severity === "error") {
      regenerateSet.add(r.boundaryTo);
    }
  }

  return {
    pass: errorCount === 0,
    warningCount,
    errorCount,
    results,
    regenerateRecommended: [...regenerateSet].sort((a, b) => a - b),
  };
}
