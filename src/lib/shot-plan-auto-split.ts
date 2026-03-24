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
 *   - 최종 프롬프트 500자 hard limit
 *   - 프롬프트만 읽어도 시나리오 원문 없이 장면 의미 이해 가능해야 함
 *
 * grep: planAutoSplitShots, validateAutoSplitResult, AutoSplitResult,
 *       FRAGMENTED_EDIT_PATTERNS, detectFragmentedIntent,
 *       validatePromptClarity, compressAutoSplitPrompt
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
  type ShotBeatHint,
  MAX_SPLIT_SHOTS,
} from "@/lib/shot-splitting";
import {
  planShotRoles,
  ROLE_PROGRESSION_DIRECTIVE,
  ROLE_KO,
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
  /** 500자 이내 압축 프롬프트 */
  compressedPrompt: string;
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
  | "shots_below_minimum_count"
  | "prompt_exceeds_500_chars"
  | "compressed_prompt_missing_required_content"
  | "scene_not_narratively_clear"
  | "unclear_context_without_script";

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

/** 분절 편집 시 최소 shot 수 (hard floor) */
const FRAGMENTED_MIN_SHOTS = 3;

/** 분절 편집 시 선호 shot 수 */
const FRAGMENTED_PREFERRED_SHOTS = 4;

/** shot 간 최소 시각적 차이 임계값 (유사도 이 이하여야 통과) */
const MAX_ADJACENT_SIMILARITY = 0.6;

/** 최대 프롬프트 길이 (글자 수) — hard limit */
export const PROMPT_CHAR_LIMIT = 500;

// ═══════════════════════════════════════════════════════════════════
// Camera variation pools — shot 간 다양성 보장
// ═══════════════════════════════════════════════════════════════════

const FRAMING_POOL = ["WS", "MS", "MCU", "CU", "ECU", "LS"] as const;
const _ANGLE_POOL = ["eye-level", "low-angle", "high-angle", "overhead", "dutch-angle"] as const;
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
  const angle = angleSeq[index % angleSeq.length];

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
 * 4. 500자 이내 고밀도 프롬프트 압축
 * 5. 서사 명료성 검증
 * 6. 검증 수행
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

    const compressedPrompt = compressAutoSplitPrompt(splitResult.shots, input);
    return {
      shots: splitResult.shots,
      compressedPrompt,
      splitLog: splitResult.splitLog,
      fragmentedContext,
      fragmentedPromptBlock: "",
      validation: validateAutoSplitResult(splitResult.shots, fragmentedContext, compressedPrompt),
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

  // ── 프롬프트 압축 ──
  const compressedPrompt = compressAutoSplitPrompt(shots, input);

  // ── 검증 ──
  const validation = validateAutoSplitResult(shots, fragmentedContext, compressedPrompt);

  return {
    shots,
    compressedPrompt,
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
 * 8가지 실패 코드:
 *   - missing_required_shots_for_fragmented_edit
 *   - fragmented_edit_but_single_shot
 *   - fragmented_edit_without_shots_array
 *   - insufficient_shot_variation
 *   - shots_below_minimum_count
 *   - prompt_exceeds_500_chars
 *   - compressed_prompt_missing_required_content
 *   - scene_not_narratively_clear / unclear_context_without_script
 *
 * grep: validateAutoSplitResult
 */
export function validateAutoSplitResult(
  shots: ShotDescriptor[],
  fragmentedContext: FragmentedEditContext,
  compressedPrompt?: string,
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

  // Rule 6: 프롬프트 500자 초과
  if (compressedPrompt && compressedPrompt.length > PROMPT_CHAR_LIMIT) {
    issues.push({
      code: "prompt_exceeds_500_chars",
      severity: "error",
      message: `Compressed prompt is ${compressedPrompt.length} chars, exceeds ${PROMPT_CHAR_LIMIT} char hard limit.`,
    });
  }

  // Rule 7: 압축 프롬프트에 핵심 정보 누락
  if (compressedPrompt) {
    const missingContent = validatePromptContent(compressedPrompt, shots);
    if (missingContent.length > 0) {
      issues.push({
        code: "compressed_prompt_missing_required_content",
        severity: "warning",
        message: `Compressed prompt missing: ${missingContent.join(", ")}`,
      });
    }
  }

  // Rule 8: 서사 명료성 — 프롬프트만 읽고 장면 이해 가능한지
  if (compressedPrompt) {
    const clarityIssues = validateNarrativeClarity(compressedPrompt, shots);
    issues.push(...clarityIssues);
  }

  const hasErrors = issues.some(i => i.severity === "error");
  return { passed: !hasErrors, issues };
}

/**
 * 압축 프롬프트에 핵심 정보가 포함되어 있는지 검증.
 * 누락된 항목 리스트 반환.
 */
export function validatePromptContent(prompt: string, shots: ShotDescriptor[]): string[] {
  const missing: string[] = [];
  const lower = prompt.toLowerCase();

  // 환경 정보 (shots[0]의 environment에서 핵심 단어 추출)
  if (shots[0]?.environment) {
    const envKeyWords = shots[0].environment.split(/[\s,]+/).filter(w => w.length > 4);
    const envFound = envKeyWords.some(w => lower.includes(w.toLowerCase()));
    if (!envFound && envKeyWords.length > 0) {
      missing.push("environment context");
    }
  }

  // 주체(subject) 정보 — subject가 string 또는 { primary } 일 수 있으므로 안전 추출
  if (shots[0]?.subject) {
    const subjectStr = typeof shots[0].subject === "string" ? shots[0].subject : (shots[0].subject as { primary: string }).primary ?? "";
    const subjectWords = subjectStr.split(/\s+/).filter(w => w.length > 3);
    const subjectFound = subjectWords.some(w => lower.includes(w.toLowerCase()));
    if (!subjectFound && subjectWords.length > 0) {
      missing.push("subject identity");
    }
  }

  // 카메라 정보 (최소 1개 shot의 framing이 언급되어야 함)
  const hasCamera = shots.some(s =>
    lower.includes(s.camera.framing.toLowerCase()) ||
    lower.includes(s.camera.motion.toLowerCase()),
  );
  if (!hasCamera) {
    missing.push("camera direction");
  }

  // 조명/분위기
  if (shots[0]?.moodLighting) {
    const moodWords = shots[0].moodLighting.split(/[\s,]+/).filter(w => w.length > 3);
    const moodFound = moodWords.some(w => lower.includes(w.toLowerCase()));
    if (!moodFound && moodWords.length > 0) {
      missing.push("mood/lighting");
    }
  }

  return missing;
}

/**
 * 서사 명료성 검증.
 *
 * 프롬프트만 읽었을 때 시나리오 원문 없이도:
 * - 누가(who), 어디서(where), 무엇을(what), 왜(why) 파악 가능
 * - 추상적 미장센/분위기만 나열하지 않음
 * - 시각적 사건과 맥락이 읽힘
 *
 * grep: validateNarrativeClarity
 */
export function validateNarrativeClarity(
  prompt: string,
  shots: ShotDescriptor[],
): AutoSplitIssue[] {
  const issues: AutoSplitIssue[] = [];
  const lower = prompt.toLowerCase();
  const words = lower.split(/\s+/);

  // 검사 1: 동작 동사 존재 — 실제 시각적 사건이 기술되어야 함
  const ACTION_VERBS = /\b(walk|run|sit|stand|hold|grab|reach|drop|open|close|pour|cook|cut|chop|scroll|type|turn|pick|place|lift|push|pull|reveal|emerge|glow|shine|rise|fall|sizzle|toss|tremble|stare|collapse|enter|exit|drive|fly|swim|dance|fight|eat|drink|throw|catch|wipe|paint|build|break|melt|freeze|burn|fade|appear|disappear|stretch|squeeze|snap)\b/i;
  const hasActionVerbs = ACTION_VERBS.test(prompt);

  // 검사 2: 구체적 명사 존재 — 추상적 묘사만이 아닌 실체가 있어야 함
  const CONCRETE_NOUNS = /\b(hand|face|eye|phone|screen|light|shadow|door|window|table|chair|car|street|building|kitchen|studio|product|bottle|knife|cup|plate|camera|person|woman|man|child|crowd|city|room|sky|water|fire|tree|mountain|mirror|book|flower|rain|snow|smoke|steam)\b/i;
  const hasConcreteNouns = CONCRETE_NOUNS.test(prompt);

  // 검사 3: 분위기-전용 프롬프트 감지 (미장센만 나열)
  const ABSTRACT_ONLY = /\b(ethereal|transcendent|metaphysical|existential|ineffable|liminal|sublime|ephemeral|melancholic|juxtaposition|dichotomy)\b/gi;
  const abstractMatches = prompt.match(ABSTRACT_ONLY);
  const abstractRatio = (abstractMatches?.length ?? 0) / Math.max(1, words.length);

  // 서사 명료성은 fragmented edit 모드에서 품질 게이트(error)로 작동
  // 비-fragmented 모드에서는 경고(warning)
  const narrativeSeverity: "error" | "warning" = shots.length >= 3 ? "error" : "warning";

  if (!hasActionVerbs && !hasConcreteNouns) {
    issues.push({
      code: "scene_not_narratively_clear",
      severity: narrativeSeverity,
      message: "Prompt lacks concrete actions or visible subjects — scene meaning unclear without script context.",
    });
  }

  if (abstractRatio > 0.15) {
    issues.push({
      code: "unclear_context_without_script",
      severity: narrativeSeverity,
      message: "Prompt is predominantly abstract descriptions — add concrete visual events and context.",
    });
  }

  // 검사 4: shot이 3개 이상인데 모든 shot action이 동일하면 서사 없음
  if (shots.length >= 3) {
    const uniqueActions = new Set(shots.map(s => s.action.slice(0, 30).toLowerCase()));
    if (uniqueActions.size === 1) {
      issues.push({
        code: "scene_not_narratively_clear",
        severity: "error",
        message: "All shots have identical actions — no narrative progression visible.",
      });
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════
// 5. Prompt 500자 제한 압축기
// ═══════════════════════════════════════════════════════════════════

/**
 * shot 배열을 500자 이내 프롬프트로 압축.
 * shot-by-shot 구조를 유지하면서 필수 정보를 보존.
 *
 * 장면 명료성 규칙:
 * - 시나리오 원문을 보지 않은 사람도 장면의 의미를 이해할 수 있게 작성
 * - 누가, 어디서, 무엇을, 왜 하고 있는지 드러나야 함
 * - 분위기, 감정, 미장센만 추상적으로 나열하지 않음
 *
 * grep: compressAutoSplitPrompt
 */
export function compressAutoSplitPrompt(
  shots: ShotDescriptor[],
  context?: Pick<AutoSplitInput, "subjectPrimary" | "environment" | "moodLighting">,
): string {
  if (shots.length === 0) return "";

  // 환경 + 주체 + 조명을 context header로 (context 우선, 없으면 shots[0])
  const rawSubj = shots[0].subject;
  const subj = context?.subjectPrimary || (typeof rawSubj === "string" ? rawSubj : (rawSubj as { primary: string }).primary ?? "subject");
  const env = (context?.environment || shots[0].environment).slice(0, 50);
  const mood = (context?.moodLighting || shots[0].moodLighting).slice(0, 35);
  const header = `${subj}, ${env}. ${mood}.`;

  // 각 shot을 compact format으로 압축
  const shotLines: string[] = [];
  for (const shot of shots) {
    const cam = `${shot.camera.framing}/${shot.camera.motion}`;
    const time = `${shot.startSec}-${shot.endSec}s`;
    const line = `[${time} ${cam}] ${shot.action}`;
    shotLines.push(line);
  }

  // 조합
  let result = `${header}\n${shotLines.join("\n")}`;

  // 500자 초과 시 action 부분 자르기 (shot 구조 유지)
  if (result.length > PROMPT_CHAR_LIMIT) {
    const headerLen = header.length + 1; // +1 for newline
    const availablePerShot = Math.floor((PROMPT_CHAR_LIMIT - headerLen) / shots.length) - 2;
    const truncatedLines = shots.map(shot => {
      const cam = `${shot.camera.framing}/${shot.camera.motion}`;
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
// 6. ShotDescriptor → MultiShotPrompt conversion
// ═══════════════════════════════════════════════════════════════════

/**
 * ShotDescriptor 배열을 MultiShotPrompt 배열로 변환.
 * 각 shot의 camera/action/environment 메타데이터를 rich prompt으로 조합.
 *
 * grep: shotsToMultiShotPrompts
 */
export function shotsToMultiShotPrompts(
  shots: ShotDescriptor[],
  roles?: ShotRole[],
): Array<{ index: number; prompt: string; promptKo: string; duration: string; role: ShotRole }> {
  return shots.map((shot, i) => {
    const framingLabel = shot.camera.framing === "WS" ? "Wide shot" :
      shot.camera.framing === "CU" ? "Close-up" :
      shot.camera.framing === "ECU" ? "Extreme close-up" :
      shot.camera.framing === "MCU" ? "Medium close-up" :
      shot.camera.framing === "LS" ? "Long shot" :
      `${shot.camera.framing} shot`;

    const parts = [
      framingLabel,
      shot.camera.motion !== "static" ? shot.camera.motion : null,
      shot.action,
      shot.environment,
      shot.moodLighting,
    ].filter(Boolean);

    let prompt = parts.join(". ").trim();
    if (prompt.length > 400) {
      const lastDot = prompt.lastIndexOf(".", 400);
      prompt = lastDot > 300 ? prompt.slice(0, lastDot + 1) : prompt.slice(0, 400);
    }
    const duration = String(Math.max(1, Math.round(shot.endSec - shot.startSec)));
    const role = roles?.[i] ?? inferRoleFromPosition(i, shots.length);
    const promptKo = ROLE_KO[role] ?? `서브샷 ${i + 1}`;

    return { index: i + 1, prompt, promptKo, duration, role };
  });
}

function inferRoleFromPosition(index: number, total: number): ShotRole {
  if (index === 0) return "establish";
  if (index === total - 1) return "resolve";
  if (index === Math.floor(total / 2)) return "peak";
  return "develop";
}

// ═══════════════════════════════════════════════════════════════════
// 7. Exports for UI integration
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
