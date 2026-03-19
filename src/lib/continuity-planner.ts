/**
 * continuity-planner.ts — Continuity-Preserving Generation 계획 수립
 *
 * 역할: policy를 입력받아 ContinuitySequencePlan을 생성
 * - 전체 시퀀스 아크 설계
 * - 세그먼트 분할 + startState/endState 계산
 * - globalAnchors 추출
 *
 * 의존: continuity-policy.ts, types/continuity.ts
 * video-generation-core.ts가 이 계획을 실행한다.
 */

import type {
  SegmentState,
  GlobalContinuityAnchors,
  CharacterAnchor,
  VisualAnchor,
  NarrativeAnchor,
  MotionAnchor,
  TransitionStrategy,
  EmotionalBeat,
  ContinuitySegmentPlan,
  ContinuitySequencePlan,
  CarryForward,
  SegmentEndingRule,
} from "@/types/continuity";
import { EMPTY_SEGMENT_STATE } from "@/types/continuity";

import type { ContinuityPolicy } from "@/lib/continuity-policy";
import {
  DEFAULT_CONTINUITY_POLICY,
  computeSegmentCount,
  assignSegmentRoles,
  selectTransitionStrategy,
  TENSION_BY_ROLE,
} from "@/lib/continuity-policy";

// ═══════════════════════════════════════════════════════════════════
// 1. Planner Input — 계획 수립에 필요한 입력
// ═══════════════════════════════════════════════════════════════════

/** 계획 수립 입력 */
export interface ContinuityPlannerInput {
  /** 전체 영상 길이 (초) */
  totalDurationSec: number;
  /** 스토리 원문 */
  storyText: string;
  /** 감독 스타일 ID */
  directorId?: string;
  /** 인물 묘사 (있으면) — characterSeeds에서 추출 */
  primaryCharacterDescription?: string;
  /** 인물 의상 (있으면) */
  primaryCharacterClothing?: string;
  /** 인물 체형 (있으면) */
  primaryCharacterBodyType?: string;
  /** 인물 구별 특징 */
  primaryCharacterFeatures?: string[];
  /** Kling element_id (있으면) */
  faceRef?: string;
  /** 스타일 ID (style-catalog) */
  styleId?: string;
  /** 애니메이션 모드 */
  animationMode?: string;
  /** 정책 오버라이드 (없으면 기본 정책) */
  policy?: ContinuityPolicy;
}

// ═══════════════════════════════════════════════════════════════════
// 2. Plan Builder
// ═══════════════════════════════════════════════════════════════════

/** 고유 ID 생성 */
function generatePlanId(): string {
  return `cplan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * ContinuitySequencePlan을 생성한다.
 *
 * 단계:
 * 1. 세그먼트 수 결정 (policy 기반)
 * 2. 세그먼트 역할 배정
 * 3. 각 세그먼트의 duration 분배
 * 4. 감정 궤적 설계
 * 5. globalAnchors 구축
 * 6. 세그먼트별 startState/endState + carryForward + endingRule 설정
 */
export function buildContinuityPlan(input: ContinuityPlannerInput): ContinuitySequencePlan {
  const policy = input.policy ?? DEFAULT_CONTINUITY_POLICY;

  // 1. 세그먼트 수 결정
  const segmentCount = computeSegmentCount(input.totalDurationSec, policy);

  // 2. 세그먼트 역할 배정
  const roles = assignSegmentRoles(segmentCount);

  // 3. duration 분배
  const durations = distributeDurations(input.totalDurationSec, segmentCount, roles, policy);

  // 4. 감정 궤적 설계
  const emotionalTrajectory = buildEmotionalTrajectory(roles);

  // 5. globalAnchors 구축
  const globalAnchors = buildGlobalAnchors(input, roles, emotionalTrajectory);

  // 6. 세그먼트별 계획
  const segments = buildSegmentPlans(
    roles,
    durations,
    emotionalTrajectory,
    policy,
    segmentCount,
  );

  return {
    planId: generatePlanId(),
    totalDurationSec: input.totalDurationSec,
    segmentDurationSec: durations[0], // 대표값 (실제는 세그먼트마다 다를 수 있음)
    segmentCount,
    globalAnchors,
    segments,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Duration Distribution
// ═══════════════════════════════════════════════════════════════════

import type { SegmentRole } from "@/types/continuity";

/**
 * 세그먼트별 duration 분배.
 * - 기본: 균등 분배
 * - climax 세그먼트는 약간 길게 (긴장감 유지)
 * - opening/closing은 약간 짧게
 * - policy의 min/max 제약 준수
 */
function distributeDurations(
  totalSec: number,
  segmentCount: number,
  roles: SegmentRole[],
  policy: ContinuityPolicy,
): number[] {
  if (segmentCount <= 1) return [totalSec];

  const { minSegmentSec, maxSegmentSec } = policy.segmentDuration;
  const baseDuration = totalSec / segmentCount;

  // 역할별 가중치
  const weights: Record<SegmentRole, number> = {
    opening: 0.9,
    building: 1.0,
    climax: 1.2,
    falling: 0.95,
    closing: 0.85,
  };

  // 가중 분배
  const rawDurations = roles.map(r => baseDuration * weights[r]);
  const rawSum = rawDurations.reduce((a, b) => a + b, 0);
  const scaled = rawDurations.map(d => (d / rawSum) * totalSec);

  // clamp + 정수화
  const clamped = scaled.map(d =>
    Math.max(minSegmentSec, Math.min(maxSegmentSec, Math.round(d))),
  );

  // 총합 보정 — 차이를 가장 긴 세그먼트에서 조정
  const diff = totalSec - clamped.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    const longestIdx = clamped.indexOf(Math.max(...clamped));
    clamped[longestIdx] = Math.max(
      minSegmentSec,
      Math.min(maxSegmentSec, clamped[longestIdx] + diff),
    );
  }

  return clamped;
}

// ═══════════════════════════════════════════════════════════════════
// 4. Emotional Trajectory
// ═══════════════════════════════════════════════════════════════════

/**
 * 감정 궤적 설계.
 * 각 세그먼트의 시작/종료 감정과 긴장감 수준을 결정한다.
 */
function buildEmotionalTrajectory(roles: SegmentRole[]): EmotionalBeat[] {
  const emotionsByRole: Record<SegmentRole, { start: string; end: string }> = {
    opening: { start: "neutral", end: "curious" },
    building: { start: "curious", end: "tense" },
    climax: { start: "tense", end: "intense" },
    falling: { start: "intense", end: "reflective" },
    closing: { start: "reflective", end: "resolved" },
  };

  return roles.map((role, i) => {
    const { min, max } = TENSION_BY_ROLE[role];
    const emotions = emotionsByRole[role];

    // 이전 세그먼트의 endEmotion과 연결
    const prevEnd = i > 0 ? emotionsByRole[roles[i - 1]].end : "neutral";

    return {
      segmentIndex: i,
      startEmotion: i === 0 ? emotions.start : prevEnd,
      endEmotion: emotions.end,
      tensionLevel: Math.round((min + max) / 2),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// 5. Global Anchors Builder
// ═══════════════════════════════════════════════════════════════════

function buildGlobalAnchors(
  input: ContinuityPlannerInput,
  roles: SegmentRole[],
  emotionalTrajectory: EmotionalBeat[],
): GlobalContinuityAnchors {
  const character: CharacterAnchor = {
    primarySubjectDescription: input.primaryCharacterDescription || "",
    clothingLock: input.primaryCharacterClothing || "",
    faceRef: input.faceRef,
    bodyType: input.primaryCharacterBodyType || "",
    distinctiveFeatures: input.primaryCharacterFeatures || [],
  };

  const visual: VisualAnchor = {
    colorPalette: "",    // generate-cuts Step1에서 채워짐
    lightingSetup: "",   // generate-cuts Step1에서 채워짐
    styleId: input.styleId || input.animationMode || "",
    filmGrain: "",       // generate-cuts Step1에서 채워짐
    contrastProfile: "", // generate-cuts Step1에서 채워짐
  };

  const overallArc = roles
    .map(r => r.charAt(0).toUpperCase() + r.slice(1))
    .join(" → ");

  const narrative: NarrativeAnchor = {
    overallArc,
    totalSegments: roles.length,
    emotionalTrajectory,
  };

  const motion: MotionAnchor = {
    dominantDirection: "",   // generate-cuts Step1에서 채워짐
    paceProgression: buildPaceProgression(roles),
    cameraGrammar: "",       // generate-cuts Step1에서 채워짐
  };

  // 기본 전환 전략 — 첫 세그먼트 경계 기준
  const defaultTransition: TransitionStrategy = {
    strategy: roles.length >= 2
      ? selectTransitionStrategy(roles[0], roles[1])
      : "camera_continuation",
    overlapSeconds: 2,
    boundaryRule: "마지막 2초는 동작 중간 상태로 유지, 완결하지 않음",
  };

  return { character, visual, narrative, motion, transition: defaultTransition };
}

function buildPaceProgression(roles: SegmentRole[]): string {
  if (roles.length <= 2) return "steady";
  const hasClimax = roles.includes("climax");
  if (hasClimax) return "gradual acceleration → peak → deceleration";
  return "steady";
}

// ═══════════════════════════════════════════════════════════════════
// 6. Segment Plans Builder
// ═══════════════════════════════════════════════════════════════════

function buildSegmentPlans(
  roles: SegmentRole[],
  durations: number[],
  emotionalTrajectory: EmotionalBeat[],
  policy: ContinuityPolicy,
  segmentCount: number,
): ContinuitySegmentPlan[] {
  return roles.map((role, i) => {
    const isLast = i === segmentCount - 1;
    const beat = emotionalTrajectory[i];

    const startState: SegmentState = i === 0
      ? { ...EMPTY_SEGMENT_STATE, emotionKeyword: beat.startEmotion, emotionIntensity: 10 }
      : { ...EMPTY_SEGMENT_STATE }; // 실행 시 이전 세그먼트 endState로 채워짐

    const endState: SegmentState = {
      ...EMPTY_SEGMENT_STATE,
      emotionKeyword: beat.endEmotion,
      emotionIntensity: beat.tensionLevel,
    };

    const carryForward: CarryForward = {
      fromPrevEndState: i > 0,
      lockFields: [...policy.carryForwardLockFields],
    };

    const endingRule: SegmentEndingRule = isLast
      ? {
          lastShotAllowedRoles: ["establish", "develop", "peak", "insert", "transition"],
          lastSecondsRule: "자연스러운 마무리 허용",
        }
      : {
          lastShotAllowedRoles: ["establish", "develop", "peak", "insert", "transition"],
          lastSecondsRule: policy.segmentEnding.lastShotPromptRule,
        };

    return {
      segmentIndex: i,
      role,
      durationSec: durations[i],
      startState,
      endState,
      carryForward,
      endingRule,
      isLastSegment: isLast,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// 7. Runtime State Update — 순차 생성 중 상태 갱신
// ═══════════════════════════════════════════════════════════════════

/**
 * 세그먼트 생성 완료 후, 확정된 endState를 다음 세그먼트의 startState로 전파.
 * video-generation-core.ts에서 사용.
 *
 * 불변 업데이트: 새 plan 객체를 반환.
 */
export function propagateEndState(
  plan: ContinuitySequencePlan,
  completedSegmentIndex: number,
  confirmedEndState: SegmentState,
): ContinuitySequencePlan {
  const newSegments = plan.segments.map((seg, i) => {
    if (i === completedSegmentIndex) {
      return { ...seg, endState: confirmedEndState };
    }
    if (i === completedSegmentIndex + 1) {
      return {
        ...seg,
        startState: {
          ...confirmedEndState,
          // soft fields는 이 세그먼트의 계획된 값으로 유지 (점진적 변화)
          emotionKeyword: seg.endState.emotionKeyword
            ? seg.startState.emotionKeyword || confirmedEndState.emotionKeyword
            : confirmedEndState.emotionKeyword,
        },
      };
    }
    return seg;
  });

  return { ...plan, segments: newSegments };
}

// ═══════════════════════════════════════════════════════════════════
// 8. Prompt Block Builders — generate-cuts 주입용
// ═══════════════════════════════════════════════════════════════════

/**
 * globalAnchors의 character 정보 → 프롬프트 블록
 */
export function buildCharacterLockBlock(anchors: GlobalContinuityAnchors): string {
  const c = anchors.character;
  if (!c.primarySubjectDescription) return "";

  const lines = [
    "## CHARACTER LOCK (동일 인물 — 모든 세그먼트에서 절대 변경 금지)",
    `Subject: ${c.primarySubjectDescription}`,
  ];
  if (c.clothingLock) lines.push(`Clothing: ${c.clothingLock}`);
  if (c.bodyType) lines.push(`Body type: ${c.bodyType}`);
  if (c.distinctiveFeatures.length > 0) {
    lines.push(`Distinctive features: ${c.distinctiveFeatures.join(", ")}`);
  }
  lines.push("RULE: This character's appearance MUST NOT change across segments.");
  return lines.join("\n");
}

/**
 * globalAnchors의 visual 정보 → 프롬프트 블록
 */
export function buildVisualLockBlock(anchors: GlobalContinuityAnchors): string {
  const v = anchors.visual;
  const lines = ["## VISUAL CONTINUITY LOCK (모든 세그먼트에서 동일 시각 스타일 유지)"];
  if (v.colorPalette) lines.push(`Color palette: ${v.colorPalette}`);
  if (v.lightingSetup) lines.push(`Lighting: ${v.lightingSetup}`);
  if (v.filmGrain) lines.push(`Film texture: ${v.filmGrain}`);
  if (v.contrastProfile) lines.push(`Contrast: ${v.contrastProfile}`);
  lines.push("RULE: Visual style MUST NOT shift between segments.");

  if (lines.length <= 2) return ""; // 정보 없으면 생략
  return lines.join("\n");
}

/**
 * 이전 세그먼트 endState → "CONTINUATION FROM" 블록
 */
export function buildContinuationFromBlock(prevEndState: SegmentState): string {
  if (!prevEndState.subjectPosition && !prevEndState.cameraState) return "";

  const lines = [
    "## CONTINUATION FROM PREVIOUS SEGMENT (이전 구간의 마지막 상태에서 이어받아 시작)",
    "Previous segment ended with:",
  ];
  if (prevEndState.subjectPosition) lines.push(`- Subject: ${prevEndState.subjectPosition}`);
  if (prevEndState.cameraState) lines.push(`- Camera: ${prevEndState.cameraState}`);
  if (prevEndState.emotionKeyword) {
    lines.push(`- Emotion: ${prevEndState.emotionKeyword} (intensity: ${prevEndState.emotionIntensity}/100)`);
  }
  if (prevEndState.motionVector) lines.push(`- Motion: ${prevEndState.motionVector}`);
  if (prevEndState.lightingState) lines.push(`- Lighting: ${prevEndState.lightingState}`);
  if (prevEndState.environmentState) lines.push(`- Environment: ${prevEndState.environmentState}`);
  lines.push("");
  lines.push("THIS segment MUST START from exactly this state.");
  lines.push("First 2 seconds: seamless continuation — DO NOT re-establish, DO NOT reset camera, DO NOT change lighting.");
  return lines.join("\n");
}

/**
 * 세그먼트 ending rule → 프롬프트 블록
 */
export function buildEndingRuleBlock(endingRule: SegmentEndingRule, isLastSegment: boolean): string {
  if (isLastSegment) return ""; // 마지막 세그먼트는 자연스럽게 마무리 허용

  return [
    "## SEGMENT ENDING RULE (이 세그먼트는 영상의 중간 구간이다)",
    endingRule.lastSecondsRule,
    "BANNED: emotional resolution, narrative closure, character turning away, fade-to-black feeling",
    "REQUIRED: forward momentum — viewer must feel the story continues immediately after this clip ends",
  ].join("\n");
}

/**
 * 서사 위치 → 프롬프트 블록
 */
export function buildNarrativePositionBlock(
  segmentIndex: number,
  totalSegments: number,
  role: SegmentRole,
  tensionLevel: number,
): string {
  return [
    `## NARRATIVE POSITION: Segment ${segmentIndex + 1}/${totalSegments} — Role: ${role.toUpperCase()}`,
    `Tension level: ${tensionLevel}/100`,
    `This is ${role === "opening" ? "the beginning" : role === "closing" ? "the ending" : `the ${role} phase`} of a continuous ${totalSegments}-segment video.`,
  ].join("\n");
}
