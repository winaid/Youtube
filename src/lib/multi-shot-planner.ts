/**
 * multi-shot-planner.ts — VEO 멀티샷 릴 프로그레션 엔진
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

/** role → 한국어 기본 promptKo (auto-init / repair 시 사용) */
export const ROLE_KO: Record<ShotRole, string> = {
  establish: "전경 — 공간과 위치 확인",
  transition: "전환 — 새로운 시점",
  develop: "전개 — 인물의 구체적 행동",
  insert: "인서트 — 핵심 디테일 클로즈업",
  peak: "절정 — 감정 최고조 순간",
  resolve: "마무리 — 시각적 해소",
};
// VEO capability constants defined locally (VEO_MAX_SHOTS, veoMinShots, VEO_MIN_SHOT_DURATION)

/** VEO 멀티샷 정책: 8초=4샷, 7초=3샷 */
const VEO_MAX_SHOTS = 4;
const VEO_MIN_SHOT_DURATION = 2;
/** duration 기반 최소 샷 수 — 7초 이하=3, 8초 이상=4 */
const veoMinShots = (durationSec: number) => durationSec <= 7 ? 3 : 4;

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
  { maxSec: 3,  min: 1, max: 1 },  // 3초 이하: 멀티샷 불필요 (단일샷)
  { maxSec: 7,  min: 3, max: 3 },  // 7초: 3샷
  { maxSec: 8,  min: 4, max: 4 },  // 8초 (VEO 상한): 반드시 4샷
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
 * @param modelId - VEO 모델 ID
 * @param durationSec - 클립 전체 duration (초)
 * @param sceneType - 씬 분류
 * @returns 추천 샷 수 (모델 capability 범위 내)
 */
export function planRecommendedShotCount(
  modelId: string,
  durationSec: number,
  sceneType: PlannerSceneType = "default",
): number {
  const maxShots = VEO_MAX_SHOTS;
  if (maxShots <= 0) return 1; // multiShot 비활성 모델/duration

  // 기본 범위 결정
  let range = SHOT_COUNT_RANGES.find(r => durationSec <= r.maxSec);
  if (!range) range = SHOT_COUNT_RANGES[SHOT_COUNT_RANGES.length - 1];

  // scene type bias 적용
  const bias = SCENE_TYPE_BIAS[sceneType] ?? 0;
  const target = Math.round((range.min + range.max) / 2) + bias;

  // Enforce <3s = 1 shot rule regardless of bias
  if (durationSec < 3) return 1;

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
  cinematic_sequence: {
    3: ["establish", "peak", "resolve"],         // space → intensity → aftermath
    4: ["establish", "develop", "peak", "resolve"],
    5: ["establish", "develop", "insert", "peak", "resolve"],
  },
  environment: {
    2: ["establish", "resolve"],
    3: ["establish", "insert", "resolve"],       // wide → detail → vista payoff
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
    5: ["establish", "develop", "peak", "insert", "resolve"],
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
/**
 * continuity mode 옵션 — 마지막 샷 resolve 금지 등
 */
export interface PlanShotRolesOptions {
  /** continuity mode에서 마지막 세그먼트가 아닌 경우 true */
  banResolveAsLastShot?: boolean;
}

export function planShotRoles(
  shotCount: number,
  sceneType?: PlannerSceneType,
  options?: PlanShotRolesOptions,
): ShotRole[] {
  if (shotCount <= 0) return [];

  let roles: ShotRole[];

  // Scene type별 변형이 있으면 사용
  if (sceneType && sceneType !== "default") {
    const variants = SCENE_TYPE_ROLE_VARIANTS[sceneType];
    if (variants && variants[shotCount]) {
      roles = [...variants[shotCount]];
    } else if (shotCount <= 6) {
      roles = [...(RETENTION_ROLE_PATTERNS[shotCount] ?? RETENTION_ROLE_PATTERNS[1])];
    } else {
      roles = buildExtendedRoles(shotCount);
    }
  } else if (shotCount <= 6) {
    roles = [...(RETENTION_ROLE_PATTERNS[shotCount] ?? RETENTION_ROLE_PATTERNS[1])];
  } else {
    roles = buildExtendedRoles(shotCount);
  }

  // ── Continuity mode: 마지막 샷 resolve 금지 ──
  // 마지막 세그먼트가 아닌 경우, resolve로 끝나면 premature resolution → 이어붙이기 어색
  // resolve → develop 또는 peak으로 교체하여 전방 모멘텀 유지
  if (options?.banResolveAsLastShot && roles.length > 0) {
    const lastIdx = roles.length - 1;
    if (roles[lastIdx] === "resolve") {
      // peak이 이미 있으면 develop, 없으면 peak으로 교체
      const hasPeak = roles.includes("peak");
      roles[lastIdx] = hasPeak ? "develop" : "peak";
    }
  }

  return roles;
}

function buildExtendedRoles(shotCount: number): ShotRole[] {
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

  // Guard: if minimum durations exceed total, clamp minShotDuration
  if (roles.length * minShotDuration > totalDurationSec) {
    minShotDuration = Math.max(1, Math.floor(totalDurationSec / roles.length));
  }

  // 가중치 합 계산
  const weights = roles.map(r => ROLE_DURATION_WEIGHT[r] ?? 1.0);
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  // 가중치 비례 분배 (floor)
  const raw = weights.map(w => Math.max(minShotDuration, Math.floor((w / totalWeight) * totalDurationSec)));

  // 나머지 흡수
  let currentSum = raw.reduce((s, d) => s + d, 0);

  // clamp이 합을 초과시킨 경우 — 가장 긴 샷부터 줄임
  const indices = weights.map((_, i) => i).sort((a, b) => weights[b] - weights[a]);
  while (currentSum > totalDurationSec) {
    for (const idx of indices) {
      if (currentSum <= totalDurationSec) break;
      if (raw[idx] > minShotDuration) {
        raw[idx] -= 1;
        currentSum -= 1;
      }
    }
    // 모든 샷이 minShotDuration이면 더 이상 줄일 수 없으므로 탈출
    if (raw.every(d => d <= minShotDuration)) break;
  }

  // 합이 부족할 경우 — 가장 큰 가중치 샷부터 나머지 분배
  let remainder = totalDurationSec - currentSum;
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
  styleSuffix?: string;
}): MultiShotPrompt[] {
  const { durationSec, sceneType = "default", basePrompt = "", modelId, styleSuffix } = opts;

  const shotCount = planRecommendedShotCount(modelId, durationSec, sceneType);
  if (shotCount <= 1 && !shouldForceMultiShot(sceneType, durationSec, modelId)) {
    // 1샷 — 멀티샷 불필요
    return [];
  }

  const policyMin = veoMinShots(durationSec);
  const effectiveCount = Math.max(policyMin, shotCount);
  const roles = planShotRoles(effectiveCount, sceneType);
  const durations = distributeDurations(roles, durationSec, VEO_MIN_SHOT_DURATION);

  return roles.map((role, i) => {
    const baseShot = buildProgressionPrompt(basePrompt, role, i, effectiveCount, sceneType);
    let prompt = styleSuffix ? `${baseShot}. ${styleSuffix}` : baseShot;
    if (prompt.length > 400) {
      const lastDot = prompt.lastIndexOf(".", 400);
      if (lastDot > 300) {
        prompt = prompt.slice(0, lastDot + 1);
      } else {
        const lastSpace = prompt.lastIndexOf(" ", 400);
        prompt = (lastSpace > 0 ? prompt.slice(0, lastSpace) : prompt.slice(0, 400)) + "...";
      }
    }
    const promptKo = ROLE_KO[role] ?? `서브샷 ${i + 1}`;
    return { index: i + 1, prompt, promptKo, duration: String(durations[i]), role };
  });
}

/**
 * 프로그레션 기반 샷 프롬프트 생성 — 진짜 시각적 분해.
 *
 * 핵심 원칙: basePrompt를 반복하지 않는다.
 * 대신 basePrompt에서 role에 해당하는 시각 레이어만 추출하고,
 * 나머지는 해당 role의 시각 기능으로 대체한다.
 *
 * 시각 레이어 분해:
 *   - SPACE layer: 장소, 배경, 공간 정체성 (establish에 할당)
 *   - ACTION layer: 행동, 동작, 변화 (develop에 할당)
 *   - DETAIL layer: 디테일, 질감, 오브젝트 (insert에 할당)
 *   - EMOTION layer: 감정, 표정, 반응 (peak에 할당)
 *   - RESULT layer: 결과, 변화, 해소 (resolve에 할당)
 *
 * fallback/auto-repair 시에도 각 샷이 구조적으로 다른 프레임을 묘사.
 */
/**
 * 프로그레션 기반 샷 프롬프트 생성.
 *
 * 필수 3요소 규칙:
 *   - 등장인물 있음: [샷 사이즈] + [인물의 구체적 행동] + [장소]
 *   - 등장인물 없음: [샷 사이즈] + [카메라가 비추는 구체적 대상] + [장소]
 *
 * "따뜻한 사무실 전경이 보임" 같은 추상적 묘사 금지.
 * 반드시 카메라가 무엇을 어떻게 보여주는지 구체적으로 서술.
 */
function buildProgressionPrompt(
  basePrompt: string,
  role: ShotRole,
  index: number,
  total: number,
  sceneType: PlannerSceneType = "default",
): string {
  const directive = ROLE_PROGRESSION_DIRECTIVE[role];
  if (!directive) return basePrompt;

  if (!basePrompt.trim()) {
    return `[Shot ${index + 1}/${total} — ${role}] ${directive.visualDirective}`;
  }

  // Decompose basePrompt into visual layers (scene-type aware)
  const layers = decomposePromptLayers(basePrompt.trim(), sceneType);

  // 인물/주체 탐지
  const subjectWords = extractTerms(basePrompt, SUBJECT_RE);
  const actionWords = extractTerms(basePrompt, ACTION_RE);
  const spaceWords = extractTerms(basePrompt, SPACE_RE);
  const hasCharacter = subjectWords.length > 0;

  // 장소 문자열 생성 (없으면 layers.space에서 추출)
  const locationStr = spaceWords.length > 0
    ? spaceWords.slice(0, 2).join(" ")
    : layers.space.split(/[,.;]/).map(s => s.trim()).filter(s => s.length > 3)[0] ?? "the scene";

  // 주체+행동 문자열 생성
  const subjectStr = hasCharacter
    ? `${capitalize(subjectWords[0])} ${actionWords.length > 0 ? toGerund(actionWords[0]) : "standing still"}`
    : "";

  switch (role) {
    case "establish":
      if (hasCharacter) {
        return `${directive.shotSize} shot, ${locationStr}. ${subjectStr} is visible in the distance. Camera reveals the full environment before any action begins.`;
      }
      return `${directive.shotSize} shot, ${locationStr}. Camera slowly reveals ${layers.space.split(/[,.;]/)[0]?.trim() || "the environment"}. No movement yet — pure atmosphere.`;

    case "transition":
      if (hasCharacter) {
        return `${directive.shotSize} shot, ${locationStr}. Camera shifts angle to show ${subjectWords[0]} from a new perspective. ${layers.transition}.`;
      }
      return `${directive.shotSize} shot, ${locationStr}. Camera repositions to show ${layers.transition}. A different vantage point of the same space.`;

    case "develop":
      if (hasCharacter) {
        const actionDesc = actionWords.length > 0
          ? `${capitalize(subjectWords[0])} ${actionWords.map(a => toGerund(a)).slice(0, 2).join(" and ")}`
          : `${capitalize(subjectWords[0])} moving deliberately`;
        return `${directive.shotSize} shot, ${locationStr}. ${actionDesc}. First clear view of the subject in motion.`;
      }
      return `${directive.shotSize} shot, ${locationStr}. Camera focuses on ${layers.action}. New visual information revealed.`;

    case "insert":
      if (hasCharacter) {
        return `Extreme close-up, ${locationStr}. ${capitalize(subjectWords[0])}'s hands/face in tight detail — ${layers.detail}. Scale jump from wider framing.`;
      }
      return `Extreme close-up, ${locationStr}. Camera isolates ${layers.detail}. Detail invisible at any wider framing.`;

    case "peak":
      if (hasCharacter) {
        return `${directive.shotSize}, ${locationStr}. ${capitalize(subjectWords[0])} at the most intense moment — ${layers.emotion}. Maximum emotional impact.`;
      }
      return `${directive.shotSize}, ${locationStr}. ${layers.emotion}. The single most dramatic frame in the sequence.`;

    case "resolve":
      if (hasCharacter) {
        return `${directive.shotSize}, ${locationStr}. ${capitalize(subjectWords[0])} ${layers.result}. Tension releases — visual closure.`;
      }
      return `${directive.shotSize}, ${locationStr}. ${layers.result}. The scene settles — visual closure.`;

    default:
      return `${directive.shotSize} shot, ${locationStr}. ${basePrompt.trim()}`;
  }
}

// ─── Keyword extraction for prompt decomposition ───

const SPACE_RE = /\b(forest|castle|room|street|market|temple|ruins|ocean|city|village|hall|kitchen|office|hospital|courtyard|arena|sky|mountain|valley|bridge|corridor|alley|cave|beach|desert|field|garden|square|harbor|rooftop|workshop|studio|laboratory|church|palace|prison|tower|dock|basement|attic|library|station|airport|stadium|cemetery|farm|barn|warehouse|factory|mine|quarry|jungle|swamp|tundra|glacier|volcano|canyon|cliff|plateau|oasis|shore|bay|lagoon|reef|island|building|house|cabin|tent|bunker|shelter|wall|staircase|balcony|terrace|window|doorway|gate|arch|path|trail|road|highway|intersection|plaza|park|pier|wharf|port|docks?|tunnel|passage)\b/gi;
const ACTION_RE = /\b(rides?|walks?|runs?|fights?|tastes?|grabs?|turns?|opens?|pushes?|pulls?|enters?|exits?|climbs?|jumps?|swims?|throws?|catches?|breaks?|builds?|cuts?|draws?|fires?|hits?|kicks?|lands?|lifts?|drops?|picks?|places?|pours?|reads?|writes?|speaks?|shouts?|whispers?|sings?|dances?|flies?|drives?|sails?|crawls?|slides?|swings?|spins?|shifts?|reaches?|stretches?|holds?|carries?|leads?|follows?|chases?|escapes?|flees?|attacks?|defends?|guards?|strikes?|stabs?|slashes?|blocks?|dodges?|aims?|shoots?|loads?|charges?|retreats?|advances?|marches?|patrols?|scouts?|searching|examines?|inspects?)\b/gi;
const EMOTION_RE = /\b(horror|pride|fear|joy|anger|sadness|surprise|shock|despair|hope|love|hate|disgust|contempt|awe|wonder|grief|rage|panic|calm|peace|tension|anxiety|relief|excitement|frustration|satisfaction|confusion|determination|resignation|defiance|trembl\w*|shak\w*|sob\w*|laugh\w*|cry\w*|scream\w*|gasp\w*|frown\w*|smile\w*|grin\w*|sneer\w*|wince\w*|grimace\w*|sigh\w*|groan\w*)\b/gi;
const DETAIL_RE = /\b(vines?|lighting|lights?|lit|steam|smoke|dust|rain|snow|ice|fire|flame|spark|glow\w*|shadow\w*|reflection|ripple|droplet|splash|thread|chain|rope|key|ring|coin|blade|handle|wheel|gear|button|latch|hinge|surface|texture|pattern|grain|rust|crack|peel|chip|stain|mark|scar|canopy|moss|cobweb|frost|dew|mud|sand|gravel|pebble|stone|brick|metal|wood|glass|leather|fabric|cloth|silk|wool|iron|steel|copper|gold|silver|bronze|marble|crystal|amber|ivory|porcelain|ceramic|concrete)\b/gi;
const SUBJECT_RE = /\b(knight|chef|warrior|soldier|king|queen|prince|princess|doctor|nurse|patient|teacher|student|priest|monk|merchant|thief|guard|captain|general|emperor|peasant|farmer|hunter|blacksmith|carpenter|tailor|baker|butcher|fisherman|sailor|pirate|wizard|witch|dragon|wolf|horse|dog|cat|bird|eagle|hawk|raven|serpent|lion|tiger|bear|fox|deer|child|woman|man|boy|girl|elder|stranger|traveler|pilgrim|assassin|spy|detective|scientist|artist|musician|dancer|acrobat|gladiator|samurai|ninja|cowboy|sheriff)\b/gi;

/** Extract unique matches from text using a regex pattern */
function extractTerms(text: string, re: RegExp): string[] {
  const matches = text.match(re);
  return matches ? [...new Set(matches.map(m => m.toLowerCase()))] : [];
}

/** Capitalize first letter */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Strip inflection to base verb: "rides"→"ride", "tastes"→"taste", "pushes"→"push" */
function toBaseVerb(verb: string): string {
  if (verb.endsWith("ies")) return verb.slice(0, -3) + "y";
  if (verb.endsWith("shes") || verb.endsWith("ches") || verb.endsWith("xes") || verb.endsWith("zes") || verb.endsWith("sses"))
    return verb.slice(0, -2);
  if (verb.endsWith("s") && !verb.endsWith("ss")) return verb.slice(0, -1);
  return verb;
}

/** Convert verb to present participle: "ride"→"riding", "taste"→"tasting", "run"→"running" */
function toGerund(verb: string): string {
  const base = toBaseVerb(verb);
  if (base.endsWith("ie")) return base.slice(0, -2) + "ying";
  if (base.endsWith("e") && !base.endsWith("ee")) return base.slice(0, -1) + "ing";
  if (/[^aeiou][aeiou][bdgklmnprst]$/.test(base) && base.length <= 4) return base + base[base.length - 1] + "ing";
  return base + "ing";
}

/**
 * basePrompt를 시각 레이어로 분해.
 *
 * 2단계 전략:
 *   1. 콤마/세미콜론 기준 절 분리 시도
 *   2. 절이 1개뿐이면 키워드 추출 기반 분해
 *
 * 핵심 원칙:
 *   - 어떤 레이어도 원문을 그대로 반복하지 않는다.
 *   - 모든 레이어는 완전한 시각 묘사 문장이어야 한다 (키워드 나열 금지).
 *   - "keyword — category label" 패턴 금지 → 카메라가 보는 장면을 묘사.
 */
function decomposePromptLayers(prompt: string, sceneType: PlannerSceneType = "default"): {
  space: string;
  transition: string;
  action: string;
  detail: string;
  emotion: string;
  result: string;
} {
  const clauses = prompt
    .split(/[,.;—–]+/)
    .map(c => c.trim())
    .filter(c => c.length > 3);

  // Always extract keywords regardless of clause count
  const spaceWords = extractTerms(prompt, SPACE_RE);
  const actionWords = extractTerms(prompt, ACTION_RE);
  const emotionWords = extractTerms(prompt, EMOTION_RE);
  const detailWords = extractTerms(prompt, DETAIL_RE);
  const subjectWords = extractTerms(prompt, SUBJECT_RE);

  // ── Multi-clause decomposition ──
  if (clauses.length >= 3) {
    const spaceClauses: string[] = [];
    const actionClauses: string[] = [];
    const emotionClauses: string[] = [];
    const detailClauses: string[] = [];

    for (const clause of clauses) {
      // Reset global regex lastIndex to avoid statefulness bugs with .test()
      EMOTION_RE.lastIndex = 0;
      ACTION_RE.lastIndex = 0;
      SPACE_RE.lastIndex = 0;
      DETAIL_RE.lastIndex = 0;
      if (EMOTION_RE.test(clause)) emotionClauses.push(clause);
      else if (ACTION_RE.test(clause)) actionClauses.push(clause);
      else if (SPACE_RE.test(clause)) spaceClauses.push(clause);
      else if (DETAIL_RE.test(clause)) detailClauses.push(clause);
      else spaceClauses.push(clause);
    }

    // If all clauses landed in space (no real differentiation), fall back to keyword extraction
    const hasDifferentiation = actionClauses.length > 0 || emotionClauses.length > 0 || detailClauses.length > 0;
    if (hasDifferentiation) {
      return {
        space: spaceClauses.length > 0 ? spaceClauses.join(", ") : buildSpaceLayer(spaceWords, prompt),
        transition: buildTransitionLayer(spaceClauses, detailClauses, spaceWords, prompt),
        action: actionClauses.length > 0 ? actionClauses.join(", ") : buildActionLayer(subjectWords, actionWords, prompt),
        detail: detailClauses.length > 0 ? detailClauses.join(", ") : buildDetailLayer(detailWords, spaceWords, prompt),
        emotion: emotionClauses.length > 0 ? emotionClauses.join(", ") : buildEmotionLayer(emotionWords, actionWords, subjectWords),
        result: buildResultLayer(emotionWords, actionWords, subjectWords, prompt, sceneType),
      };
    }
    // else: fall through to keyword-based decomposition below
  }

  // ── Single/two-clause: keyword-based decomposition ──
  return {
    space: buildSpaceLayer(spaceWords, prompt),
    transition: buildTransitionLayer([], [], spaceWords, prompt),
    action: buildActionLayer(subjectWords, actionWords, prompt),
    detail: buildDetailLayer(detailWords, spaceWords, prompt),
    emotion: buildEmotionLayer(emotionWords, actionWords, subjectWords),
    result: buildResultLayer(emotionWords, actionWords, subjectWords, prompt, sceneType),
  };
}

function buildSpaceLayer(spaceWords: string[], prompt: string): string {
  if (spaceWords.length >= 3) {
    return `${capitalize(spaceWords[0])} and ${spaceWords[1]} and ${spaceWords[2]} spread across the frame, atmosphere and depth visible in every direction`;
  }
  if (spaceWords.length >= 2) {
    return `${capitalize(spaceWords[0])} stretching toward the ${spaceWords[1]}, the full environment visible from a distance`;
  }
  if (spaceWords.length === 1) {
    return `The ${spaceWords[0]} laid bare from edge to edge, its light, its air, its scale filling the frame`;
  }
  // No space keywords — use subject to imply environment
  const subjects = extractTerms(prompt, SUBJECT_RE);
  if (subjects.length > 0) {
    return `The ${subjects[0]}'s surroundings — the full space, light, and atmosphere visible before any action begins`;
  }
  return `The full environment of the scene — space, light, and atmosphere filling the frame from edge to edge`;
}

function buildTransitionLayer(spaceClauses: string[], detailClauses: string[], spaceWords: string[], prompt: string): string {
  if (detailClauses.length > 0) {
    return `${detailClauses[0]}, glimpsed from a new angle as the camera moves through the space`;
  }
  if (spaceClauses.length > 1) {
    return `${spaceClauses[1]}, discovered as the viewpoint shifts to reveal hidden depth`;
  }
  if (spaceWords.length >= 2) {
    return `The ${spaceWords[1]} from a second vantage point, new geometry and depth emerging from the shift in perspective`;
  }
  if (spaceWords.length === 1) {
    return `A new angle on the ${spaceWords[0]}, revealing what the first view couldn't show`;
  }
  return `The same space from a shifted vantage point, new depth and geometry emerging as the camera finds a second angle`;
}

function buildActionLayer(subjectWords: string[], actionWords: string[], prompt: string): string {
  const subject = subjectWords.length > 0 ? `The ${subjectWords[0]}` : "The figure";

  if (subjectWords.length > 0 && actionWords.length > 0) {
    return `${subject} ${toGerund(actionWords[0])}, captured in the act — movement and intent visible at medium distance`;
  }
  if (actionWords.length > 0) {
    return `A figure ${toGerund(actionWords[0])} with purpose, the first clear view of the action driving the scene`;
  }
  if (subjectWords.length > 0) {
    return `${subject} in deliberate motion, body language revealing intent as the action begins`;
  }
  return `The central action unfolding, subject and movement captured together for the first time`;
}

function buildDetailLayer(detailWords: string[], spaceWords: string[], prompt: string): string {
  if (detailWords.length >= 3) {
    return `${capitalize(detailWords[0])} and ${detailWords[1]} and ${detailWords[2]}, surface texture magnified until it fills the entire frame`;
  }
  if (detailWords.length >= 2) {
    return `${capitalize(detailWords[0])} and ${detailWords[1]} at intimate scale, grain and imperfection visible only at this magnification`;
  }
  if (detailWords.length === 1) {
    return `${capitalize(detailWords[0])} in extreme magnification, every surface imperfection and textural detail exposed`;
  }
  if (spaceWords.length > 0) {
    return `The surface of the ${spaceWords[0]} — cracks, wear, material grain, the fingerprint of time visible at intimate scale`;
  }
  return `A critical detail too small for any wider shot — texture, surface, or object that tells the story at extreme magnification`;
}

function buildEmotionLayer(emotionWords: string[], actionWords: string[], subjectWords: string[]): string {
  const subject = subjectWords.length > 0 ? `the ${subjectWords[0]}` : "the subject";

  if (emotionWords.length >= 2) {
    return `${capitalize(emotionWords[0])} cracking into ${emotionWords[1]} across ${subject}'s face — the exact instant the feeling transforms`;
  }
  if (emotionWords.length === 1) {
    return `Raw ${emotionWords[0]} written across ${subject}'s face — eyes, brow, and mouth all carrying the weight of this moment`;
  }
  if (actionWords.length > 0) {
    return `${capitalize(subject)}'s face mid-${toBaseVerb(actionWords[0])} — whatever this costs, it shows in the eyes, the jaw, the breath`;
  }
  return `${capitalize(subject)}'s face at the most unguarded moment — the feeling visible in every micro-expression`;
}

function buildResultLayer(emotionWords: string[], actionWords: string[], subjectWords: string[], prompt: string, sceneType: PlannerSceneType): string {
  const subject = subjectWords.length > 0 ? `the ${subjectWords[0]}` : "the scene";

  // Scene-type specific resolve patterns
  if (sceneType === "environment") {
    const space = extractTerms(prompt, SPACE_RE);
    if (space.length > 0) {
      return `The ${space[0]} after the moment passes — same place, different reality, silence filling where movement was`;
    }
    return `The landscape settling into new stillness — what was in motion has stopped, and the change lingers visibly`;
  }

  if (sceneType === "character-driven" && subjectWords.length > 0) {
    if (emotionWords.length > 0) {
      const finalEmotion = emotionWords[emotionWords.length - 1];
      return `${capitalize(subject)} in the wake of ${finalEmotion} — body still, breath slowing, the weight settling into the frame`;
    }
    return `${capitalize(subject)} after everything — standing changed, the body language of someone altered by what just happened`;
  }

  if (sceneType === "battle") {
    if (subjectWords.length > 0) {
      return `${capitalize(subject)} standing in the aftermath of the fight — dust settling, weapons lowered, the cost of the clash written on the body`;
    }
    return `The battlefield after the clash — dust and silence where chaos was, the outcome written in the debris`;
  }

  if (actionWords.length > 0) {
    const base = toBaseVerb(actionWords[0]);
    return `${capitalize(subject)} after the ${base} — the world and the body settling into a new stillness, the change visible`;
  }
  if (emotionWords.length > 0) {
    const finalEmotion = emotionWords[emotionWords.length - 1];
    return `The ${finalEmotion} fading from the face — what remains is quieter, heavier, and permanent`;
  }
  return `${capitalize(subject)} in the aftermath — what moved has stopped, what changed remains written across the frame`;
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
  // VEO: 멀티샷 항상 지원 (단일샷 금지 정책)
  const maxShots = VEO_MAX_SHOTS;
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
    // VEO: 멀티샷 항상 지원 (단일샷 금지 정책)
    if (VEO_MAX_SHOTS >= 2) {
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
  const policyMin = veoMinShots(durationSec);
  const effectiveCount = forced ? Math.max(policyMin, shotCount) : shotCount;
  const roles = planShotRoles(effectiveCount, sceneType);
  const durations = distributeDurations(roles, durationSec, VEO_MIN_SHOT_DURATION);

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
