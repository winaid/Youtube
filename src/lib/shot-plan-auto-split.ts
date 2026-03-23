/**
 * shot-plan-auto-split.ts — Fragmented edit auto-split orchestrator
 *
 * Connects:
 *   1. Fragmented edit detection (korean-subject-defaults.ts)
 *   2. Shot planning (multi-shot-planner.ts)
 *   3. Shot splitting (shot-splitting.ts)
 *   4. Validation (enforce multi-shot output)
 *
 * 핵심 규칙:
 *   - 컷 분절 요청 감지 시 반드시 shots[] 배열 기반 multi-shot output
 *   - shots.length >= 3 (최소), 4~6 선호
 *   - 각 shot에 shotId / startSec / endSec / camera / subject / action / environment / moodLighting
 *   - shot 간 framing / angle / motion / action 변화 필수
 *   - single-shot output 또는 temporalBeats만 나열 금지
 *
 * grep: planAutoSplitShots, validateAutoSplitResult, AutoSplitResult,
 *       FRAGMENTED_EDIT_PATTERNS, detectFragmentedIntent
 */

import {
  detectFragmentedEditRequest,
  buildFragmentedShotBlock,
  type FragmentedEditContext,
} from "@/lib/korean-subject-defaults";
import {
  splitSingleShotSequence,
  rebalanceShotTimings,
  computeShotSimilarity,
  type ShotDescriptor,
  type SplitResult,
  type ShotBeatHint,
  MAX_SPLIT_SHOTS,
} from "@/lib/shot-splitting";
import {
  planShotRoles,
  ROLE_PROGRESSION_DIRECTIVE,
  type PlannerSceneType,
} from "@/lib/multi-shot-planner";
import type { ShotRole } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface AutoSplitInput {
  /** 원본 시나리오 텍스트 */
  storyText: string;
  /** 씬 설명 (단일 컷) */
  sceneDescription: string;
  /** subject (주인공/피사체) */
  subjectPrimary: string;
  /** action (동작) */
  action: string;
  /** environment (배경) */
  environment: string;
  /** 조명/무드 */
  moodLighting: string;
  /** 컷 duration (초) */
  durationSec: number;
  /** 기존 카메라 설정 */
  camera: { framing: string; angle: string; motion: string };
  /** 씬 타입 */
  sceneType?: string;
  /** beat 힌트 */
  beatHint?: ShotBeatHint;
  /** 스타일 접미사 */
  styleSuffix?: string;
}

export interface AutoSplitResult {
  /** 분할된 shot 배열 — 최소 3개 */
  shots: ShotDescriptor[];
  /** 분할 로그 */
  splitLog: string[];
  /** 분절 편집 컨텍스트 */
  fragmentedContext: FragmentedEditContext;
  /** system prompt에 주입할 분절 편집 블록 */
  fragmentedPromptBlock: string;
  /** 검증 결과 */
  validation: AutoSplitValidation;
}

export interface AutoSplitValidation {
  passed: boolean;
  issues: AutoSplitIssue[];
}

export interface AutoSplitIssue {
  code: AutoSplitErrorCode;
  severity: "error" | "warning";
  message: string;
}

export type AutoSplitErrorCode =
  | "missing_required_shots_for_fragmented_edit"
  | "fragmented_edit_but_single_shot"
  | "fragmented_edit_without_shots_array"
  | "insufficient_shot_variation"
  | "shots_below_minimum_count";

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

/** 분절 편집 시 최소 shot 수 (hard floor) */
const FRAGMENTED_MIN_SHOTS = 3;

/** 분절 편집 시 선호 shot 수 */
const FRAGMENTED_PREFERRED_SHOTS = 4;

/** shot 간 최소 시각적 차이 임계값 (유사도 이 이하여야 통과) */
const MAX_ADJACENT_SIMILARITY = 0.6;

// ═══════════════════════════════════════════════════════════════════
// Camera variation pools — shot 간 다양성 보장
// ═══════════════════════════════════════════════════════════════════

const FRAMING_POOL = ["WS", "MS", "MCU", "CU", "ECU", "LS"] as const;
const ANGLE_POOL = ["eye-level", "low-angle", "high-angle", "overhead", "dutch-angle"] as const;
const MOTION_POOL = ["slow pan", "push-in", "pull-back", "tracking", "static", "tilt-up", "dolly", "handheld"] as const;

/**
 * 인접 shot과 충돌하지 않도록 다양한 카메라 설정 선택.
 */
function pickDiverseCamera(
  index: number,
  totalShots: number,
  prevCamera?: { framing: string; angle: string; motion: string },
): { framing: string; angle: string; motion: string } {
  // Framing progression: wide → medium → close → extreme close → medium → wide
  const framingSequences: Record<number, string[]> = {
    3: ["WS", "MS", "CU"],
    4: ["WS", "MS", "CU", "MCU"],
    5: ["WS", "MS", "CU", "ECU", "WS"],
    6: ["WS", "MS", "MCU", "CU", "ECU", "WS"],
  };
  const seq = framingSequences[totalShots] ?? framingSequences[4]!;
  let framing = seq[index % seq.length];

  // Angle variation
  const angleSeq = ["eye-level", "low-angle", "eye-level", "high-angle", "dutch-angle", "overhead"];
  let angle = angleSeq[index % angleSeq.length];

  // Motion variation — no two adjacent shots same motion
  const motionSeq = ["slow pan", "static", "push-in", "tracking", "pull-back", "handheld"];
  let motion = motionSeq[index % motionSeq.length];

  // Anti-collision: if same as previous, shift
  if (prevCamera) {
    if (framing === prevCamera.framing) {
      const alt = FRAMING_POOL.filter(f => f !== framing);
      framing = alt[index % alt.length];
    }
    if (motion === prevCamera.motion) {
      const alt = MOTION_POOL.filter(m => m !== motion);
      motion = alt[index % alt.length];
    }
  }

  return { framing, angle, motion };
}

// ═══════════════════════════════════════════════════════════════════
// 1. Fragmented Intent Detection (extends korean-subject-defaults)
// ═══════════════════════════════════════════════════════════════════

/**
 * storyText에서 분절 편집 의도 감지.
 * korean-subject-defaults.ts의 detectFragmentedEditRequest를 확장.
 *
 * grep: detectFragmentedIntent
 */
export function detectFragmentedIntent(storyText: string): FragmentedEditContext {
  return detectFragmentedEditRequest(storyText);
}

// ═══════════════════════════════════════════════════════════════════
// 2. Auto-Split Shot Planning
// ═══════════════════════════════════════════════════════════════════

/**
 * 분절 편집 요청에 대해 자동 shot plan 생성.
 *
 * 1. storyText에서 분절 편집 의도 감지
 * 2. 감지되면 최소 3개, 선호 4~6개 shot 자동 생성
 * 3. shot 간 framing/angle/motion/action 차이 보장
 * 4. 검증 수행
 *
 * grep: planAutoSplitShots
 */
export function planAutoSplitShots(input: AutoSplitInput): AutoSplitResult {
  const fragmentedContext = detectFragmentedIntent(input.storyText);
  const fragmentedPromptBlock = buildFragmentedShotBlock(fragmentedContext);

  // 분절 편집이 아닌 경우 — 기존 splitting 로직에 위임
  if (!fragmentedContext.isFragmented) {
    const splitResult = splitSingleShotSequence({
      sceneType: input.sceneType || "default",
      subjectPrimary: input.subjectPrimary,
      action: input.action,
      environment: input.environment,
      moodLighting: input.moodLighting,
      durationSec: input.durationSec,
      camera: input.camera,
      beatHint: input.beatHint,
      styleSuffix: input.styleSuffix,
    });

    return {
      shots: splitResult.shots,
      splitLog: splitResult.splitLog,
      fragmentedContext,
      fragmentedPromptBlock: "",
      validation: validateAutoSplitResult(splitResult.shots, fragmentedContext),
    };
  }

  // ── 분절 편집 강제 모드 ──
  const targetShotCount = Math.max(
    fragmentedContext.minShotCount,
    FRAGMENTED_PREFERRED_SHOTS,
  );
  const shotCount = Math.min(targetShotCount, MAX_SPLIT_SHOTS);

  // Scene type 기반 role 시퀀스
  const sceneType = (input.sceneType || "default") as PlannerSceneType;
  const roles = planShotRoles(shotCount, sceneType);

  // Duration 분배
  const timings = rebalanceShotTimings(input.durationSec, shotCount);

  // ── Shot 생성 — 각 shot이 독립된 시각 단위 ──
  const shots: ShotDescriptor[] = [];
  const splitLog: string[] = [];
  let prevCamera: { framing: string; angle: string; motion: string } | undefined;

  // Action을 분절 단위로 분해 시도
  const actionSegments = splitActionIntoSegments(input.action, input.sceneDescription, shotCount);

  for (let i = 0; i < shotCount; i++) {
    const role = roles[i] ?? "develop";
    const timing = timings[i];
    const camera = pickDiverseCamera(i, shotCount, prevCamera);
    const directive = ROLE_PROGRESSION_DIRECTIVE[role];

    // 각 shot별 독립된 action
    const shotAction = actionSegments[i] ?? buildRoleDerivedAction(role, input, i, shotCount);

    // Subject variation — insert shot은 object/detail focus
    const subject = role === "insert"
      ? deriveInsertSubject(input)
      : input.subjectPrimary;

    shots.push({
      shotId: `shot_${i + 1}`,
      startSec: timing.startSec,
      endSec: timing.endSec,
      camera,
      subject,
      action: shotAction,
      environment: input.environment,
      moodLighting: input.moodLighting,
      focus: `[${role}] ${directive?.visualDirective?.slice(0, 80) ?? shotAction}`,
      ...(input.styleSuffix ? { styleSuffix: input.styleSuffix } : {}),
    });

    prevCamera = camera;
  }

  splitLog.push(
    `[auto-split] Fragmented edit detected (triggers: ${fragmentedContext.triggerTerms.join(", ")}). ` +
    `Generated ${shotCount} shots with forced camera variation.`,
  );
  splitLog.push(`[auto-split] Edit style: ${fragmentedContext.editStyle}`);
  splitLog.push(`[auto-split] Roles: ${roles.join(" → ")}`);

  // ── 검증 ──
  const validation = validateAutoSplitResult(shots, fragmentedContext);

  return {
    shots,
    splitLog,
    fragmentedContext,
    fragmentedPromptBlock,
    validation,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Action Segmentation
// ═══════════════════════════════════════════════════════════════════

/**
 * action 텍스트를 shot 수만큼 의미 단위로 분해.
 * 분해가 불가능하면 빈 배열 반환 (role 기반 fallback 사용).
 */
function splitActionIntoSegments(
  action: string,
  sceneDescription: string,
  targetCount: number,
): string[] {
  const fullText = `${sceneDescription} ${action}`.trim();

  // Arrow 분할 시도
  const arrowParts = fullText.split(/\s*(?:→|➡|->)+\s*/).filter(s => s.trim().length > 5);
  if (arrowParts.length >= targetCount) return arrowParts.slice(0, targetCount);

  // 문장 분할 시도
  const sentences = fullText.split(/[.!?。]\s*/).filter(s => s.trim().length > 10);
  if (sentences.length >= targetCount) return sentences.slice(0, targetCount);

  // Temporal 분할 시도
  const temporalParts = fullText.split(
    /\b(?:then|followed\s+by|finally|next|after\s+that|그리고|그때|이후|마침내)\b/i,
  ).filter(s => s.trim().length > 5);
  if (temporalParts.length >= targetCount) return temporalParts.slice(0, targetCount);

  // 분해 불가 → 빈 배열 (role 기반 fallback)
  return [];
}

/**
 * Role 기반으로 독립 action 생성 (action 분해 실패 시 fallback).
 */
function buildRoleDerivedAction(
  role: ShotRole,
  input: AutoSplitInput,
  index: number,
  total: number,
): string {
  const subject = input.subjectPrimary;
  const env = input.environment.slice(0, 40);

  switch (role) {
    case "establish":
      return `Wide establishing view of ${env}, setting spatial context for ${subject}`;
    case "transition":
      return `Camera shifts perspective, reframing ${subject} from new angle within ${env}`;
    case "develop":
      return `${subject} in action — new visual detail revealed, narrative advancing within ${env}`;
    case "insert":
      return `Extreme close-up detail: key object or texture element near ${subject}`;
    case "peak":
      return `Climactic moment — ${subject} at maximum emotional or dramatic intensity`;
    case "resolve":
      return `Resolution — ${subject} in final state, visual closure within ${env}`;
    default:
      return `Shot ${index + 1}/${total}: ${subject} within ${env}`;
  }
}

/**
 * Insert shot용 subject 파생.
 */
function deriveInsertSubject(input: AutoSplitInput): string {
  // 환경에서 detail 키워드 추출
  const envWords = input.environment.split(/\s+/).filter(w => w.length > 3);
  if (envWords.length > 0) {
    return `detail of ${envWords.slice(0, 3).join(" ")}`;
  }
  return `close detail near ${input.subjectPrimary}`;
}

// ═══════════════════════════════════════════════════════════════════
// 4. Validation
// ═══════════════════════════════════════════════════════════════════

/**
 * Auto-split 결과 검증.
 *
 * 5가지 실패 코드:
 *   - missing_required_shots_for_fragmented_edit
 *   - fragmented_edit_but_single_shot
 *   - fragmented_edit_without_shots_array
 *   - insufficient_shot_variation
 *   - shots_below_minimum_count
 *
 * grep: validateAutoSplitResult
 */
export function validateAutoSplitResult(
  shots: ShotDescriptor[],
  fragmentedContext: FragmentedEditContext,
): AutoSplitValidation {
  const issues: AutoSplitIssue[] = [];

  if (!fragmentedContext.isFragmented) {
    return { passed: true, issues: [] };
  }

  // Rule 1: shots 배열이 없거나 비어있으면 실패
  if (!shots || shots.length === 0) {
    issues.push({
      code: "fragmented_edit_without_shots_array",
      severity: "error",
      message: "Fragmented edit requested but shots array is empty or missing.",
    });
    return { passed: false, issues };
  }

  // Rule 2: single-shot output이면 실패
  if (shots.length === 1) {
    issues.push({
      code: "fragmented_edit_but_single_shot",
      severity: "error",
      message: `Fragmented edit requested (${fragmentedContext.triggerTerms.join(", ")}) but only 1 shot generated. Multi-shot output is mandatory.`,
    });
  }

  // Rule 3: 최소 shot 수 미달
  if (shots.length < FRAGMENTED_MIN_SHOTS) {
    issues.push({
      code: "shots_below_minimum_count",
      severity: "error",
      message: `Fragmented edit requires minimum ${FRAGMENTED_MIN_SHOTS} shots, got ${shots.length}.`,
    });
  }

  // Rule 4: 분절 편집 요구 대비 부족
  if (shots.length < fragmentedContext.minShotCount) {
    issues.push({
      code: "missing_required_shots_for_fragmented_edit",
      severity: "error",
      message: `Fragmented edit style "${fragmentedContext.editStyle}" requires minimum ${fragmentedContext.minShotCount} shots, got ${shots.length}.`,
    });
  }

  // Rule 5: shot 간 시각적 다양성 부족
  if (shots.length >= 2) {
    let lowVariationCount = 0;
    for (let i = 0; i < shots.length - 1; i++) {
      const similarity = computeShotSimilarity(shots[i], shots[i + 1]);
      if (similarity > MAX_ADJACENT_SIMILARITY) {
        lowVariationCount++;
      }
    }
    // 절반 이상의 인접 쌍이 유사하면 실패
    if (lowVariationCount > Math.floor((shots.length - 1) / 2)) {
      issues.push({
        code: "insufficient_shot_variation",
        severity: "error",
        message: `${lowVariationCount}/${shots.length - 1} adjacent shot pairs have insufficient visual variation (similarity > ${MAX_ADJACENT_SIMILARITY * 100}%). Each shot must be a distinct visual unit.`,
      });
    }
  }

  const hasErrors = issues.some(i => i.severity === "error");
  return { passed: !hasErrors, issues };
}

// ═══════════════════════════════════════════════════════════════════
// 5. Prompt 500자 제한 압축기
// ═══════════════════════════════════════════════════════════════════

/** 최대 프롬프트 길이 (글자 수) — hard limit */
export const PROMPT_CHAR_LIMIT = 500;

/**
 * shot 배열을 500자 이내 프롬프트로 압축.
 * shot-by-shot 구조를 유지하면서 필수 정보를 보존.
 *
 * grep: compressAutoSplitPrompt
 */
export function compressAutoSplitPrompt(shots: ShotDescriptor[]): string {
  if (shots.length === 0) return "";

  // 각 shot을 compact format으로 압축
  const shotLines: string[] = [];
  for (const shot of shots) {
    const cam = `${shot.camera.framing}/${shot.camera.angle}/${shot.camera.motion}`;
    const time = `${shot.startSec}-${shot.endSec}s`;
    // 핵심 정보만: timing + camera + action
    const line = `[${time} ${cam}] ${shot.action}`;
    shotLines.push(line);
  }

  // 환경 + 조명 (첫 shot에서)
  const env = shots[0].environment.slice(0, 60);
  const mood = shots[0].moodLighting.slice(0, 40);
  const header = `${env}. ${mood}.`;

  // 조합
  let result = `${header}\n${shotLines.join("\n")}`;

  // 500자 초과 시 action 부분 자르기 (shot 구조 유지)
  if (result.length > PROMPT_CHAR_LIMIT) {
    const headerLen = header.length + 1; // +1 for newline
    const availablePerShot = Math.floor((PROMPT_CHAR_LIMIT - headerLen) / shots.length) - 2; // -2 for newline
    const truncatedLines = shots.map(shot => {
      const cam = `${shot.camera.framing}/${shot.camera.angle}/${shot.camera.motion}`;
      const time = `${shot.startSec}-${shot.endSec}s`;
      const prefix = `[${time} ${cam}] `;
      const maxAction = Math.max(10, availablePerShot - prefix.length);
      const action = shot.action.length > maxAction
        ? shot.action.slice(0, maxAction - 1) + "…"
        : shot.action;
      return `${prefix}${action}`;
    });
    result = `${header}\n${truncatedLines.join("\n")}`;
  }

  // 최종 hard clamp
  if (result.length > PROMPT_CHAR_LIMIT) {
    result = result.slice(0, PROMPT_CHAR_LIMIT - 1) + "…";
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// 6. Exports for UI integration
// ═══════════════════════════════════════════════════════════════════

/**
 * UI에서 "자동 나누기" 버튼 클릭 시 호출하는 진입점.
 * 시나리오를 분석하고 shot plan을 반환.
 */
export function autoSplitForUI(input: AutoSplitInput): AutoSplitResult {
  return planAutoSplitShots(input);
}

/**
 * 분절 편집 감지 여부만 빠르게 확인 (UI에서 버튼 표시 여부 결정용).
 */
export function isFragmentedEditRequested(storyText: string): boolean {
  return detectFragmentedIntent(storyText).isFragmented;
}
