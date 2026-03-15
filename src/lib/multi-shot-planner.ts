/**
 * multi-shot-planner.ts — Kling 멀티샷 릴 프로그레션 엔진
 *
 * 핵심 원칙: 모든 샷은 존재 이유가 있어야 한다.
 *   - 각 샷은 이전 샷과 반드시 다른 visual element를 도입
 *   - role은 단순 라벨이 아닌 프로그레션 규칙 (escalation → payoff)
 *   - 같은 프레이밍/액션 반복 금지
 *   - 릴 시청 유지를 위한 시각적 진행 + 감정 에스컬레이션
 *
 * 역할:
 *   1. duration + sceneType + modelId 기반 추천 샷 수 계산
 *   2. retention 기반 role 시퀀스 자동 배정 (hook → develop → reveal → payoff)
 *   3. 프로그레션 규칙: 각 role별 visual change directive
 *   4. duration 분배 (retention 가중치 기반)
 *   5. 강제 멀티샷 정책 (긴 시네마틱 클립 = 단일샷 불가)
 *   6. 누락 멀티샷 자동 복구 (submission 직전 방어)
 *   7. 의도적 원테이크 예외 처리
 *
 * 이 모듈이 default planning engine.
 * 단일샷은 짧은 클립이거나 명시적 one-take 예외일 때만 허용.
 *
 * grep: planRecommendedShotCount, planShotRoles, buildDefaultMultiShot,
 *       shouldForceMultiShot, repairMissingMultiShot, RETENTION_ROLE_PATTERNS,
 *       ROLE_PROGRESSION_DIRECTIVE
 */

import type { MultiShotPrompt, ShotRole } from "@/types";
import { getMaxShots, getCapability } from "@/lib/kling-capability";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/** 생성 모드 — Studio(신중한 검토) vs Batch(빠른 대량 생성) */
export type GenerationMode = "studio" | "batch";

/** 씬 타입 — 멀티샷 계획에 영향을 주는 분류 */
export type PlannerSceneType =
  | "cinematic_sequence"
  | "environment"
  | "character-driven"
  | "battle"
  | "montage"
  | "person"
  | "crowd"
  | "map_visualization"
  | "default";

/** 멀티샷 계획 결과 */
export interface MultiShotPlan {
  /** 추천 샷 수 */
  shotCount: number;
  /** role 시퀀스 */
  roles: ShotRole[];
  /** 샷별 duration 배분 (초) */
  durations: number[];
  /** 강제 멀티샷 여부 */
  forced: boolean;
  /** 의도적 원테이크 허용 여부 */
  oneTakeAllowed: boolean;
  /** 계획 근거 */
  reasoning: string;
}

// ═══════════════════════════════════════════════════════════════════
// Constants — Retention Role Patterns
// ═══════════════════════════════════════════════════════════════════

/**
 * 릴 프로그레션 디렉티브 — 각 role이 반드시 변경해야 하는 visual element.
 *
 * 이것은 numeric rule이 아니라 progression rule:
 *   - 모든 샷은 이전 샷 대비 반드시 하나 이상 변경
 *   - shotSize, angle, subject, motion 중 최소 2개 변경 필수
 *   - 같은 프레이밍에서 같은 행동 반복 = 의미 없는 분할
 *
 * prompt 생성 시 이 directive를 suffix로 붙여 LLM이 진짜 다른 장면을 만들도록 강제.
 */
export const ROLE_PROGRESSION_DIRECTIVE: Record<ShotRole, {
  /** 이 role에서 반드시 변경해야 하는 요소 */
  mustChange: string;
  /** 권장 shot size */
  shotSize: string;
  /** 프로그레션에서의 기능 (한국어 설명) */
  function: string;
  /** prompt에 붙일 visual directive (영어) */
  visualDirective: string;
}> = {
  establish: {
    mustChange: "location identity, spatial context",
    shotSize: "WS / LS",
    function: "시선 포착 — 공간 정체성 즉시 전달",
    visualDirective: "WIDE establishing shot. Show the full environment/location. Set the spatial context that every following shot will build from.",
  },
  transition: {
    mustChange: "camera angle, subject distance",
    shotSize: "MS / MLS",
    function: "시점 전환 — 관찰자 위치 재설정",
    visualDirective: "SHIFT perspective. Move camera to a new angle or position. Bridge from the establishing context to the developing action.",
  },
  develop: {
    mustChange: "subject action, narrative information",
    shotSize: "MS / MCU",
    function: "정보 확장 — 새로운 시각적 증거 도입",
    visualDirective: "MEDIUM shot revealing new information. Show a specific action, gesture, or detail NOT visible in previous shots. Advance the narrative.",
  },
  insert: {
    mustChange: "scale (jump to extreme close-up), detail focus",
    shotSize: "CU / ECU",
    function: "텐션 상승 — 핵심 디테일 극대화",
    visualDirective: "EXTREME CLOSE-UP on a critical detail. Dramatic scale shift from previous shot. Intensify tension through visual focus.",
  },
  peak: {
    mustChange: "emotional intensity, dramatic framing",
    shotSize: "CU / ECU",
    function: "클라이맥스 — 감정/갈등 최고점",
    visualDirective: "CLIMAX moment. The most dramatic or emotionally intense framing. Maximum visual impact — this is the shot viewers remember.",
  },
  resolve: {
    mustChange: "energy level (release), compositional closure",
    shotSize: "WS / CU (contrast)",
    function: "마무리 — 시각적 보상과 해소",
    visualDirective: "PAYOFF shot. Release the built tension. Either pull back to wide for resolution, or hold on the final emotional beat. Provide visual closure.",
  },
};

/**
 * 샷 수별 retention 기반 role 시퀀스.
 *
 * 릴 프로그레션 원칙:
 *   hook    → establish (시선 포착) — 공간/상황 즉시 인식
 *   orient  → transition (시점 전환) — 관찰자 위치 재설정
 *   develop → develop (정보 확장) — 새 visual evidence 도입
 *   intensify → insert (텐션 상승) — 극적 스케일 변화
 *   reveal  → peak (클라이맥스) — 감정/갈등 최고점
 *   payoff  → resolve (보상/해소) — 시각적 closure
 *
 * 모든 인접 샷은 반드시 다른 shotSize + angle 조합을 써야 함.
 */
export const RETENTION_ROLE_PATTERNS: Record<number, ShotRole[]> = {
  1: ["establish"],
  2: ["establish", "resolve"],
  3: ["establish", "develop", "resolve"],
  4: ["establish", "develop", "peak", "resolve"],
  5: ["establish", "transition", "develop", "peak", "resolve"],
  6: ["establish", "transition", "develop", "insert", "peak", "resolve"],
};

// ═══════════════════════════════════════════════════════════════════
// Shot Count Heuristics
// ═══════════════════════════════════════════════════════════════════

/**
 * duration 기반 추천 샷 수 범위.
 *
 * 기존 RUNTIME_SHOT_HEURISTICS(multishot-validation.ts)보다 더 공격적.
 * 이 모듈이 default planning engine이므로 기존 heuristic은 validation용으로 유지.
 */
const SHOT_COUNT_RANGES: { maxSec: number; min: number; max: number }[] = [
  { maxSec: 3,  min: 1, max: 1 },
  { maxSec: 5,  min: 2, max: 2 },
  { maxSec: 8,  min: 2, max: 3 },
  { maxSec: 12, min: 3, max: 4 },
  { maxSec: 15, min: 4, max: 6 },
];

/** scene type별 shot count 보정 */
const SCENE_TYPE_BIAS: Partial<Record<PlannerSceneType, number>> = {
  battle: 1,           // 더 많은 샷
  montage: 1,          // 더 많은 샷
  cinematic_sequence: 0,
  environment: 0,
  "character-driven": 0,
  person: -1,          // 약간 적게 (인물 중심은 롱테이크 유효)
  default: 0,
};

/**
 * 강제 멀티샷 씬 타입 — 이 타입 + duration 6s+ 면 단일샷 불가.
 */
const FORCE_MULTI_SHOT_SCENE_TYPES: Set<PlannerSceneType> = new Set([
  "cinematic_sequence",
  "environment",
  "character-driven",
  "battle",
  "montage",
]);

/** 강제 멀티샷 duration 임계값 (초) */
const FORCE_MULTI_SHOT_DURATION_THRESHOLD = 6;

/** 어떤 씬이든 이 duration 이상이면 강제 멀티샷 */
const ABSOLUTE_FORCE_DURATION = 9;

// ═══════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * 추천 샷 수 계산.
 *
 * @param modelId - Kling 모델 ID
 * @param durationSec - 클립 전체 duration (초)
 * @param sceneType - 씬 분류
 * @returns 추천 샷 수 (모델 capability 범위 내)
 */
export function planRecommendedShotCount(
  modelId: string,
  durationSec: number,
  sceneType: PlannerSceneType = "default",
): number {
  const maxShots = getMaxShots(modelId, durationSec);
  if (maxShots <= 0) return 1; // multiShot 비활성 모델/duration

  // 기본 범위 결정
  let range = SHOT_COUNT_RANGES.find(r => durationSec <= r.maxSec);
  if (!range) range = SHOT_COUNT_RANGES[SHOT_COUNT_RANGES.length - 1];

  // scene type bias 적용
  const bias = SCENE_TYPE_BIAS[sceneType] ?? 0;
  const target = Math.round((range.min + range.max) / 2) + bias;

  // clamp to [1, maxShots]
  return Math.max(1, Math.min(maxShots, target));
}

/**
 * Scene type별 대안 role 패턴.
 *
 * 기본 RETENTION_ROLE_PATTERNS는 cinematic escalation 패턴이지만,
 * 모든 시퀀스가 같은 리듬을 갖지 않도록 scene type에 따라 변형을 제공.
 *
 * 예: environment는 reveal→expand→detail 리듬, comedy는 setup→setup→punchline.
 */
const SCENE_TYPE_ROLE_VARIANTS: Partial<Record<PlannerSceneType, Record<number, ShotRole[]>>> = {
  environment: {
    2: ["establish", "resolve"],
    3: ["establish", "insert", "resolve"],      // wide → detail → vista payoff
    4: ["establish", "develop", "insert", "resolve"],
    5: ["establish", "transition", "develop", "insert", "resolve"],
  },
  "character-driven": {
    3: ["establish", "peak", "resolve"],         // context → emotion → reaction
    4: ["establish", "develop", "peak", "resolve"],
    5: ["establish", "develop", "insert", "peak", "resolve"],
  },
  battle: {
    3: ["establish", "peak", "resolve"],         // scale → chaos → aftermath
    4: ["establish", "develop", "peak", "resolve"],
    5: ["establish", "develop", "peak", "insert", "resolve"],  // insert after peak = aftermath detail
  },
  montage: {
    3: ["develop", "develop", "resolve"],        // rapid beats → payoff
    4: ["develop", "insert", "develop", "resolve"],
    5: ["develop", "insert", "develop", "insert", "resolve"],
  },
};

/**
 * retention 기반 role 시퀀스 배정.
 *
 * @param shotCount - 샷 수
 * @param sceneType - optional scene type for role pattern variation
 * @returns ShotRole 배열
 */
export function planShotRoles(shotCount: number, sceneType?: PlannerSceneType): ShotRole[] {
  if (shotCount <= 0) return [];

  // Scene type별 변형이 있으면 사용
  if (sceneType && sceneType !== "default") {
    const variants = SCENE_TYPE_ROLE_VARIANTS[sceneType];
    if (variants && variants[shotCount]) {
      return [...variants[shotCount]];
    }
  }

  if (shotCount <= 6) return [...(RETENTION_ROLE_PATTERNS[shotCount] ?? RETENTION_ROLE_PATTERNS[1])];

  // 6샷 초과: 기본 패턴 + 중간에 develop/insert 반복
  const base = [...RETENTION_ROLE_PATTERNS[6]];
  const extra = shotCount - 6;
  // 중간(develop~insert 사이)에 추가
  for (let i = 0; i < extra; i++) {
    base.splice(3, 0, i % 2 === 0 ? "develop" : "insert");
  }
  return base;
}

/**
 * retention 가중치 기반 duration 분배.
 *
 * hook(establish)과 payoff(resolve)에 약간 더 할당.
 * peak에도 약간 더 할당.
 */
const ROLE_DURATION_WEIGHT: Record<ShotRole, number> = {
  establish: 1.2,   // hook — 약간 길게
  develop: 1.0,
  peak: 1.1,        // reveal — 약간 길게
  resolve: 1.1,     // payoff — 약간 길게
  insert: 0.8,      // intensify — 짧게
  transition: 0.8,  // orient — 짧게
};

/**
 * role 기반 duration 분배.
 *
 * @param roles - ShotRole 배열
 * @param totalDurationSec - 전체 duration
 * @param minShotDuration - 최소 샷 duration (모델 기준)
 * @returns 샷별 duration 배열 (정수, 합 = totalDurationSec)
 */
export function distributeDurations(
  roles: ShotRole[],
  totalDurationSec: number,
  minShotDuration: number,
): number[] {
  if (roles.length === 0) return [];
  if (roles.length === 1) return [totalDurationSec];

  // 가중치 합 계산
  const weights = roles.map(r => ROLE_DURATION_WEIGHT[r] ?? 1.0);
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  // 가중치 비례 분배 (floor)
  const raw = weights.map(w => Math.max(minShotDuration, Math.floor((w / totalWeight) * totalDurationSec)));

  // 나머지 흡수
  const currentSum = raw.reduce((s, d) => s + d, 0);
  let remainder = totalDurationSec - currentSum;

  // 가장 큰 가중치 샷부터 나머지 분배
  const indices = weights.map((_, i) => i).sort((a, b) => weights[b] - weights[a]);
  for (const idx of indices) {
    if (remainder <= 0) break;
    raw[idx] += 1;
    remainder -= 1;
  }

  return raw;
}

/**
 * 릴 프로그레션 기반 멀티샷 배열을 자동 생성.
 *
 * 핵심 원칙:
 *   - 각 샷의 prompt는 role별 visual directive를 포함
 *   - basePrompt를 그대로 복사하지 않고, 프로그레션 컨텍스트를 붙임
 *   - 모든 샷은 이전 샷과 반드시 다른 시각적 요소를 도입
 *
 * @returns 생성된 MultiShotPrompt[] (prompt에 progression directive 포함)
 */
export function buildDefaultMultiShot(opts: {
  durationSec: number;
  sceneType?: PlannerSceneType;
  basePrompt?: string;
  modelId: string;
}): MultiShotPrompt[] {
  const { durationSec, sceneType = "default", basePrompt = "", modelId } = opts;
  const cap = getCapability(modelId);

  const shotCount = planRecommendedShotCount(modelId, durationSec, sceneType);
  if (shotCount <= 1 && !shouldForceMultiShot(sceneType, durationSec, modelId)) {
    // 1샷 — 멀티샷 불필요
    return [];
  }

  const effectiveCount = Math.max(2, shotCount);
  const roles = planShotRoles(effectiveCount, sceneType);
  const durations = distributeDurations(roles, durationSec, cap.minShotDuration);

  return roles.map((role, i) => ({
    index: i + 1,
    prompt: buildProgressionPrompt(basePrompt, role, i, effectiveCount),
    duration: String(durations[i]),
    role,
  }));
}

/**
 * 프로그레션 기반 샷 프롬프트 생성.
 *
 * 핵심 변경: basePrompt를 그대로 복사하지 않고, role에 따라 구조적으로 다른 프롬프트를 생성.
 *   - establish: 공간/위치 중심 — 인물 디테일 최소화
 *   - develop: 행동/정보 중심 — 새로운 시각 정보 강조
 *   - peak: 감정/텐션 최고점 — 극적 프레이밍 강제
 *   - resolve: 해소/결과 — 변화된 상태 묘사
 *   - insert: 디테일 점프 — 스케일 급변
 *   - transition: 시점 전환 — 앵글/위치 변경
 *
 * 이렇게 하면 fallback/auto-repair 시에도 각 샷이 구조적으로 다른 프레임을 묘사한다.
 */
function buildProgressionPrompt(
  basePrompt: string,
  role: ShotRole,
  index: number,
  total: number,
): string {
  const directive = ROLE_PROGRESSION_DIRECTIVE[role];
  if (!directive) return basePrompt;

  // basePrompt가 비어있으면 directive만 반환 (placeholder)
  if (!basePrompt.trim()) {
    return `[Shot ${index + 1}/${total} — ${role}] ${directive.visualDirective}`;
  }

  const base = basePrompt.trim();

  // Role-specific prompt restructuring — each role produces a structurally different prompt
  switch (role) {
    case "establish":
      // Wide context — strip character close-up language, emphasize space
      return `${directive.shotSize} shot. ${base}. ${directive.visualDirective} Focus on spatial context and atmosphere, not character detail.`;

    case "transition":
      // Angle shift — emphasize camera repositioning
      return `${directive.shotSize} shot from a new angle. ${base}. ${directive.visualDirective} Camera position must differ visibly from previous shot.`;

    case "develop":
      // New information — emphasize action and detail not yet shown
      return `${directive.shotSize} shot. New visual information: ${base}. ${directive.visualDirective} Show something NOT visible in previous shots.`;

    case "insert":
      // Scale jump — extreme close-up on critical detail
      return `${directive.shotSize}. Dramatic scale shift — ${base}. ${directive.visualDirective} Jump to extreme detail that previous shots could not show.`;

    case "peak":
      // Climax — maximum emotional framing
      return `${directive.shotSize}. CLIMAX moment — ${base}. ${directive.visualDirective} This is the most intense frame in the sequence.`;

    case "resolve":
      // Payoff — release and closure
      return `${directive.shotSize}. Resolution: ${base}. ${directive.visualDirective} Show the outcome, the release, the visual reward.`;

    default:
      return `${base} [${directive.shotSize}] ${directive.visualDirective}`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Force Multi-Shot Policy
// ═══════════════════════════════════════════════════════════════════

/**
 * 강제 멀티샷 여부 판정.
 *
 * true면 단일샷으로 submit하면 안 됨.
 * Studio Mode에서는 blocking error, Batch Mode에서는 auto-repair.
 */
export function shouldForceMultiShot(
  sceneType: PlannerSceneType | string,
  durationSec: number,
  modelId: string,
): boolean {
  const cap = getCapability(modelId);
  if (!cap.supportsMultiShot) return false;

  const maxShots = getMaxShots(modelId, durationSec);
  if (maxShots <= 1) return false;

  // 절대 기준: 9초 이상이면 어떤 씬이든 강제
  if (durationSec >= ABSOLUTE_FORCE_DURATION) return true;

  // 씬 타입 기반: 특정 씬 타입 + 6초 이상
  if (durationSec >= FORCE_MULTI_SHOT_DURATION_THRESHOLD &&
      FORCE_MULTI_SHOT_SCENE_TYPES.has(sceneType as PlannerSceneType)) {
    return true;
  }

  return false;
}

/**
 * 의도적 원테이크 허용 여부 판정.
 *
 * @returns true면 단일샷으로 submit 가능 (사용자 명시 의도)
 */
export function isOneTakeAllowed(
  durationSec: number,
  intentionalOneTake: boolean,
): boolean {
  // 3초 이하: 항상 원테이크 허용
  if (durationSec <= 3) return true;

  // 사용자가 명시적으로 원테이크 설정
  if (intentionalOneTake) return true;

  return false;
}

// ═══════════════════════════════════════════════════════════════════
// Submission Repair
// ═══════════════════════════════════════════════════════════════════

/**
 * submission 직전 멀티샷 누락 자동 복구.
 *
 * multiShot이 없거나 비어있는데, 강제 멀티샷 정책에 해당하면
 * 자동으로 기본 멀티샷 계획을 생성한다.
 *
 * @returns 복구된 MultiShotPrompt[] (빈 배열 = 복구 불필요)
 */
export function repairMissingMultiShot(opts: {
  existingMultiShot?: MultiShotPrompt[];
  durationSec: number;
  sceneType?: PlannerSceneType | string;
  basePrompt?: string;
  modelId: string;
  intentionalOneTake?: boolean;
  mode?: GenerationMode;
}): MultiShotPrompt[] {
  const {
    existingMultiShot,
    durationSec,
    sceneType = "default",
    basePrompt = "",
    modelId,
    intentionalOneTake = false,
    mode = "batch",
  } = opts;

  // 이미 멀티샷이 있으면 복구 불필요
  if (existingMultiShot && existingMultiShot.length >= 2) {
    return existingMultiShot;
  }

  // 의도적 원테이크면 복구 안함
  if (isOneTakeAllowed(durationSec, intentionalOneTake)) {
    return existingMultiShot ?? [];
  }

  // 강제 멀티샷 정책 해당하면 자동 생성
  if (shouldForceMultiShot(sceneType as PlannerSceneType, durationSec, modelId)) {
    return buildDefaultMultiShot({
      durationSec,
      sceneType: sceneType as PlannerSceneType,
      basePrompt,
      modelId,
    });
  }

  // Studio 모드에서는 강제하지 않아도 추천 (하지만 repair하지는 않음)
  // Batch 모드에서는 auto-repair 적극적
  if (mode === "batch" && durationSec >= 5) {
    const cap = getCapability(modelId);
    if (cap.supportsMultiShot && getMaxShots(modelId, durationSec) >= 2) {
      return buildDefaultMultiShot({
        durationSec,
        sceneType: sceneType as PlannerSceneType,
        basePrompt,
        modelId,
      });
    }
  }

  return existingMultiShot ?? [];
}

// ═══════════════════════════════════════════════════════════════════
// Full Plan Builder
// ═══════════════════════════════════════════════════════════════════

/**
 * 전체 멀티샷 계획 생성.
 *
 * UI에서 cut 생성 시 호출하여 기본 계획을 즉시 표시.
 */
export function buildMultiShotPlan(opts: {
  modelId: string;
  durationSec: number;
  sceneType?: PlannerSceneType;
  intentionalOneTake?: boolean;
}): MultiShotPlan {
  const {
    modelId,
    durationSec,
    sceneType = "default",
    intentionalOneTake = false,
  } = opts;

  const forced = shouldForceMultiShot(sceneType, durationSec, modelId);
  const oneTakeAllowed = isOneTakeAllowed(durationSec, intentionalOneTake);

  if (oneTakeAllowed && !forced) {
    return {
      shotCount: 1,
      roles: ["establish"],
      durations: [durationSec],
      forced: false,
      oneTakeAllowed: true,
      reasoning: durationSec <= 3
        ? `${durationSec}초 이하 — 단일 샷 기본`
        : "의도적 원테이크",
    };
  }

  const shotCount = planRecommendedShotCount(modelId, durationSec, sceneType);
  const effectiveCount = forced ? Math.max(2, shotCount) : shotCount;
  const roles = planShotRoles(effectiveCount, sceneType);
  const cap = getCapability(modelId);
  const durations = distributeDurations(roles, durationSec, cap.minShotDuration);

  return {
    shotCount: effectiveCount,
    roles,
    durations,
    forced,
    oneTakeAllowed: !forced,
    reasoning: forced
      ? `${sceneType} + ${durationSec}초 — 멀티샷 강제 (리텐션 필수)`
      : `${sceneType} + ${durationSec}초 — ${effectiveCount}샷 추천`,
  };
}
