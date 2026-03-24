/**
 * continuity-policy.ts — Continuity-Preserving Generation 정책 레이어
 *
 * 역할: "무엇을 강제하고 무엇을 허용할지" 선언적 규칙 정의
 * planner는 이 policy를 입력받아 실제 계획을 수립한다.
 * policy 변경 시 planner 코드 수정 없이 규칙만 바꿀 수 있다.
 *
 * 의존: types/continuity.ts만 참조. 다른 lib 모듈 의존 금지.
 */

import type {
  SegmentState,
  SegmentRole,
  ContinuityValidationRuleId,
  ContinuityValidationSeverity,
} from "@/types/continuity";

// ═══════════════════════════════════════════════════════════════════
// 1. Segment Duration Policy — 세그먼트 분할 규칙
// ═══════════════════════════════════════════════════════════════════

/** 단일 세그먼트의 duration 제약 */
export interface SegmentDurationPolicy {
  /** 최소 세그먼트 길이 (초) — VEO API 최소 생성 단위 */
  minSegmentSec: number;
  /** 최대 세그먼트 길이 (초) — VEO API 최대 생성 단위 */
  maxSegmentSec: number;
  /** 기본 세그먼트 길이 (초) — 분할 시 기본값 */
  defaultSegmentSec: number;
  /** 최소 전체 영상 길이 (초) — 이 이하면 continuity mode 불필요 */
  minTotalForContinuity: number;
}

export const SEGMENT_DURATION_POLICY: SegmentDurationPolicy = {
  minSegmentSec: 5,
  maxSegmentSec: 8,
  defaultSegmentSec: 8,
  minTotalForContinuity: 20,
};

// ═══════════════════════════════════════════════════════════════════
// 2. Anchor Lock Policy — 앵커 고정 강도
// ═══════════════════════════════════════════════════════════════════

/** 앵커 유형별 고정 강도 */
export type AnchorLockStrength = "hard" | "soft" | "none";

/** 앵커 고정 정책 — 세그먼트 간 어떤 앵커를 얼마나 강하게 고정하는지 */
export interface AnchorLockPolicy {
  /** 인물 외형 (의상, 체형, 특징) — 변경 금지 */
  characterAppearance: AnchorLockStrength;
  /** 색감 팔레트 — 변경 금지 */
  colorPalette: AnchorLockStrength;
  /** 조명 셋업 — 장면 전환 시 점진적 변화 허용 */
  lightingSetup: AnchorLockStrength;
  /** 필름 그레인 / 스타일 — 변경 금지 */
  filmStyle: AnchorLockStrength;
  /** 카메라 문법 (핸드헬드 vs 돌리 등) — 시퀀스 내 통일 */
  cameraGrammar: AnchorLockStrength;
  /** 동작 방향 — 경계에서 연속 */
  motionDirection: AnchorLockStrength;
  /** 감정 강도 — 경계에서 점진적 변화만 허용 */
  emotionIntensity: AnchorLockStrength;
}

export const DEFAULT_ANCHOR_LOCK_POLICY: AnchorLockPolicy = {
  characterAppearance: "hard",
  colorPalette: "hard",
  lightingSetup: "soft",
  filmStyle: "hard",
  cameraGrammar: "soft",
  motionDirection: "soft",
  emotionIntensity: "soft",
};

// ═══════════════════════════════════════════════════════════════════
// 3. Segment Ending Policy — 세그먼트 경계 처리 규칙
// ═══════════════════════════════════════════════════════════════════

/** 세그먼트 끝 처리 규칙 */
export interface SegmentEndingPolicy {
  /** 마지막 N초를 미완결 상태로 유지 */
  openEndSeconds: number;
  /** 마지막 세그먼트 제외 시 금지할 샷 role */
  bannedLastShotRoles: string[];
  /** 마지막 샷의 행동 규칙 (프롬프트 주입용) */
  lastShotPromptRule: string;
  /** 경계에서 허용할 카메라 앵글 변화 최대치 */
  maxCameraAngleJump: "none" | "mild" | "any";
  /** 경계에서 허용할 감정 강도 변화 최대치 (0-100) */
  maxEmotionIntensityDelta: number;
}

export const DEFAULT_SEGMENT_ENDING_POLICY: SegmentEndingPolicy = {
  openEndSeconds: 2,
  bannedLastShotRoles: ["resolve"],
  lastShotPromptRule:
    "LAST 2 SECONDS: character mid-action, camera still moving, emotion unresolved — DO NOT close the scene, DO NOT resolve the action, maintain forward momentum",
  maxCameraAngleJump: "mild",
  maxEmotionIntensityDelta: 30,
};

// ═══════════════════════════════════════════════════════════════════
// 4. Carry-Forward Policy — 세그먼트 간 전달 규칙
// ═══════════════════════════════════════════════════════════════════

/** carry-forward 시 항상 고정하는 SegmentState 필드 */
export const CARRY_FORWARD_LOCK_FIELDS: (keyof SegmentState)[] = [
  "subjectPosition",
  "cameraState",
  "lightingState",
  "motionVector",
];

/** carry-forward 시 점진적 변화를 허용하는 필드 */
export const CARRY_FORWARD_SOFT_FIELDS: (keyof SegmentState)[] = [
  "emotionIntensity",
  "emotionKeyword",
  "environmentState",
];

// ═══════════════════════════════════════════════════════════════════
// 5. Segment Role Assignment Policy — 세그먼트 역할 배정
// ═══════════════════════════════════════════════════════════════════

/**
 * 세그먼트 수에 따른 역할 배정 규칙.
 * 전체 서사 아크에서 각 세그먼트가 맡을 역할을 결정한다.
 */
export function assignSegmentRoles(segmentCount: number): SegmentRole[] {
  if (segmentCount <= 1) return ["opening"];
  if (segmentCount === 2) return ["opening", "closing"];
  if (segmentCount === 3) return ["opening", "climax", "closing"];
  if (segmentCount === 4) return ["opening", "building", "climax", "closing"];

  // 5개 이상: opening + building... + climax + falling... + closing
  // climax 위치: 전체의 60~70% 지점
  const climaxPosition = Math.floor(segmentCount * 0.6);
  const roles: SegmentRole[] = [];

  for (let i = 0; i < segmentCount; i++) {
    if (i === 0) roles.push("opening");
    else if (i === segmentCount - 1) roles.push("closing");
    else if (i === climaxPosition) roles.push("climax");
    else if (i < climaxPosition) roles.push("building");
    else roles.push("falling");
  }

  return roles;
}

// ═══════════════════════════════════════════════════════════════════
// 6. Tension Curve Policy — 긴장감 곡선
// ═══════════════════════════════════════════════════════════════════

/** 세그먼트 역할별 기본 긴장감 범위 */
export const TENSION_BY_ROLE: Record<SegmentRole, { min: number; max: number }> = {
  opening: { min: 10, max: 30 },
  building: { min: 30, max: 60 },
  climax: { min: 70, max: 95 },
  falling: { min: 40, max: 60 },
  closing: { min: 15, max: 40 },
};

// ═══════════════════════════════════════════════════════════════════
// 7. Transition Strategy Policy — 전환 전략 선택
// ═══════════════════════════════════════════════════════════════════

export type TransitionStrategyType = "motion_carry" | "gaze_bridge" | "camera_continuation" | "match_action";

/** 세그먼트 역할 전환에 따른 기본 전환 전략 */
export function selectTransitionStrategy(
  fromRole: SegmentRole,
  toRole: SegmentRole,
): TransitionStrategyType {
  // climax로의 진입: 동작 연속 (긴장감 유지)
  if (toRole === "climax") return "motion_carry";
  // climax에서 빠져나올 때: 카메라 연속 (급격한 전환 방지)
  if (fromRole === "climax") return "camera_continuation";
  // opening → building: 시선 연결
  if (fromRole === "opening" && toRole === "building") return "gaze_bridge";
  // falling → closing: 매치 액션 (여운)
  if (fromRole === "falling" && toRole === "closing") return "match_action";
  // 기본: 카메라 연속
  return "camera_continuation";
}

// ═══════════════════════════════════════════════════════════════════
// 8. Validation Policy — 검증 규칙 임계치
// ═══════════════════════════════════════════════════════════════════

/** 검증 규칙별 임계치 및 severity 결정 */
export interface ValidationThreshold {
  ruleId: ContinuityValidationRuleId;
  /** 경고 임계치 */
  warnThreshold: number;
  /** 에러 임계치 */
  errorThreshold: number;
  /** 자동 수정 가능 여부 */
  autoFixable: boolean;
  /** 설명 */
  description: string;
}

export const VALIDATION_THRESHOLDS: ValidationThreshold[] = [
  {
    ruleId: "CONT-01",
    warnThreshold: 0.7,
    errorThreshold: 0.5,
    autoFixable: false,
    description: "인물 일관성 — character description 키워드 일치율",
  },
  {
    ruleId: "CONT-02",
    warnThreshold: 0.8,
    errorThreshold: 0.6,
    autoFixable: false,
    description: "색감 일관성 — colorPalette 키워드 일치",
  },
  {
    ruleId: "CONT-03",
    warnThreshold: 0.7,
    errorThreshold: 0.5,
    autoFixable: false,
    description: "조명 일관성 — lightingSetup 키워드 일치",
  },
  {
    ruleId: "CONT-04",
    warnThreshold: 0,
    errorThreshold: 0,
    autoFixable: true,
    description: "동작 방향 연속성 — motionVector 방향 일치",
  },
  {
    ruleId: "CONT-05",
    warnThreshold: 30,
    errorThreshold: 50,
    autoFixable: false,
    description: "감정 연속성 — emotionIntensity 변화량",
  },
  {
    ruleId: "CONT-06",
    warnThreshold: 0,
    errorThreshold: 0,
    autoFixable: true,
    description: "카메라 점프 감지 — 급격한 framing/angle 변화",
  },
  {
    ruleId: "CONT-07",
    warnThreshold: 0,
    errorThreshold: 0,
    autoFixable: true,
    description: "완결 감지 — 마지막 세그먼트 제외 resolve role 사용",
  },
];

/** ruleId로 임계치 조회 */
export function getValidationThreshold(ruleId: ContinuityValidationRuleId): ValidationThreshold | undefined {
  return VALIDATION_THRESHOLDS.find(t => t.ruleId === ruleId);
}

// ═══════════════════════════════════════════════════════════════════
// 9. Prompt Injection Policy — 프롬프트 주입 규칙
// ═══════════════════════════════════════════════════════════════════

/** continuity mode에서 각 세그먼트 프롬프트에 주입할 블록 규칙 */
export interface PromptInjectionPolicy {
  /** globalAnchors의 character 정보를 프롬프트 상단에 주입 */
  injectCharacterLock: boolean;
  /** globalAnchors의 visual 정보를 프롬프트 상단에 주입 */
  injectVisualLock: boolean;
  /** 이전 세그먼트 endState를 "CONTINUATION FROM" 블록으로 주입 */
  injectPrevEndState: boolean;
  /** 세그먼트 ending rule을 프롬프트 하단에 주입 */
  injectEndingRule: boolean;
  /** 전체 아크 내 현재 위치를 "NARRATIVE POSITION" 블록으로 주입 */
  injectNarrativePosition: boolean;
}

export const DEFAULT_PROMPT_INJECTION_POLICY: PromptInjectionPolicy = {
  injectCharacterLock: true,
  injectVisualLock: true,
  injectPrevEndState: true,
  injectEndingRule: true,
  injectNarrativePosition: true,
};

// ═══════════════════════════════════════════════════════════════════
// 10. Aggregate Policy — 전체 정책 번들
// ═══════════════════════════════════════════════════════════════════

/** continuity mode 전체 정책 */
export interface ContinuityPolicy {
  segmentDuration: SegmentDurationPolicy;
  anchorLock: AnchorLockPolicy;
  segmentEnding: SegmentEndingPolicy;
  carryForwardLockFields: (keyof SegmentState)[];
  carryForwardSoftFields: (keyof SegmentState)[];
  promptInjection: PromptInjectionPolicy;
  validationThresholds: ValidationThreshold[];
}

/** 기본 정책 번들 */
export const DEFAULT_CONTINUITY_POLICY: ContinuityPolicy = {
  segmentDuration: SEGMENT_DURATION_POLICY,
  anchorLock: DEFAULT_ANCHOR_LOCK_POLICY,
  segmentEnding: DEFAULT_SEGMENT_ENDING_POLICY,
  carryForwardLockFields: CARRY_FORWARD_LOCK_FIELDS,
  carryForwardSoftFields: CARRY_FORWARD_SOFT_FIELDS,
  promptInjection: DEFAULT_PROMPT_INJECTION_POLICY,
  validationThresholds: VALIDATION_THRESHOLDS,
};

/**
 * 총 영상 길이로 continuity mode 적용 여부 판단.
 * minTotalForContinuity 미만이면 continuity mode 불필요.
 */
export function isContinuityModeEligible(
  totalDurationSec: number,
  policy: ContinuityPolicy = DEFAULT_CONTINUITY_POLICY,
): boolean {
  return totalDurationSec >= policy.segmentDuration.minTotalForContinuity;
}

/**
 * 총 영상 길이 → 세그먼트 수 결정.
 * policy의 min/max/default 기준으로 분할.
 */
export function computeSegmentCount(
  totalDurationSec: number,
  policy: ContinuityPolicy = DEFAULT_CONTINUITY_POLICY,
): number {
  const { minSegmentSec, maxSegmentSec, defaultSegmentSec } = policy.segmentDuration;

  if (totalDurationSec <= maxSegmentSec) return 1;

  // 기본 세그먼트 길이로 분할
  const idealCount = Math.ceil(totalDurationSec / defaultSegmentSec);

  // 각 세그먼트가 최소 길이 이상인지 확인
  const perSegment = totalDurationSec / idealCount;
  if (perSegment < minSegmentSec) {
    return Math.max(1, Math.floor(totalDurationSec / minSegmentSec));
  }

  return idealCount;
}
