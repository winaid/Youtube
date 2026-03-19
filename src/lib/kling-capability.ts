/**
 * kling-capability.ts — Kling O3 모델 패밀리 capability 정의 (중앙 정책)
 *
 * 핵심 목적:
 *   1. 5개 O3 모델의 capability를 한 곳에서 관리
 *   2. WorkflowType 기반 모델 선택 — text/image/reference/edit/element
 *   3. 서버(_kling-capability.ts)와 클라이언트가 동일 정책 공유
 *   4. duration 기반 "실질적 최대 샷 수" 계산
 *   5. 모델 fallback 체인 지원
 *
 * 모델 패밀리:
 *   - kling-o3-text-to-video        (텍스트 → 영상, 메인 생성 경로)
 *   - kling-o3-image-to-video       (이미지 → 영상, 스토리보드/Scene Extension)
 *   - kling-o3-reference-to-video   (레퍼런스 기반 생성, 일관성 워크플로우)
 *   - kling-custom-element          (캐릭터/주체 일관성 에셋 생성)
 *
 * grep: KlingModelCapability, WorkflowType, getCapability, getMaxShots,
 *       resolveModelForWorkflow, KLING_MODEL_REGISTRY
 */

// ═══════════════════════════════════════════════════════════════════
// Workflow Types
// ═══════════════════════════════════════════════════════════════════

/**
 * WorkflowType — 제품의 핵심 생성 경로 분류.
 * 각 워크플로우는 하나의 기본 모델에 매핑된다.
 *
 * - text-to-video:      스토리 → 컷 분할 → 프롬프트 생성 → 영상 (메인 경로)
 * - image-to-video:     스토리보드/참조 이미지 → 영상 (Scene Extension, firstFrame 기반)
 * - reference-to-video: 레퍼런스 이미지/영상 기반 일관성 생성 (스타일/캐릭터 일관성)
 * - custom-element:     캐릭터/주체 에셋 등록 (Kling Custom Element API)
 */
export type WorkflowType =
  | "text-to-video"
  | "image-to-video"
  | "reference-to-video"
  | "custom-element";

/** 입력 모드 — 모델이 요구하는 primary input 타입 */
export type InputMode = "text" | "image" | "reference" | "video" | "image_refer" | "video_refer";

/** 출력 모드 — 모델이 생성하는 output 타입 */
export type OutputMode = "video" | "element_asset";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface KlingModelCapability {
  /** 모델 식별자 (API에 전달되는 값) */
  modelId: string;
  /** 사람이 읽을 수 있는 모델명 */
  displayName: string;
  /** 이 모델의 워크플로우 역할 */
  workflowRole: WorkflowType;
  /** multi-shot 최대 샷 수 (모델 하드 리밋) */
  maxShots: number;
  /** 개별 샷 최소 duration (초) */
  minShotDuration: number;
  /** 영상 최대 duration (초) */
  maxDuration: number;
  /** 영상 최소 duration (초) */
  minDuration: number;
  /** multi-shot 지원 여부 */
  supportsMultiShot: boolean;
  /** sound 파라미터 지원 여부 */
  supportsSound: boolean;
  /** custom element (element_list) 지원 여부 */
  supportsElements: boolean;
  /** reference input (레퍼런스 이미지/영상) 지원 여부 */
  supportsReferenceInput: boolean;
  /** video edit (기존 영상 수정) 지원 여부 */
  supportsVideoEdit: boolean;
  /** primary input 모드 */
  inputMode: InputMode;
  /** output 모드 */
  outputMode: OutputMode;
  /** fallback 모델 ID (이 모델 접근 불가 시 대체) */
  fallbackModelId: string | null;

  // ── 하위 호환 필드 (기존 코드 호환) ──
  /** @deprecated supportsReferenceInput || inputMode === "image" 사용. */
  supportsImageToVideo: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Model Registry — O3 모델 패밀리
// ═══════════════════════════════════════════════════════════════════

/**
 * 모델 capability 레지스트리.
 *
 * O3 모델 패밀리:
 *   text-to-video      — 텍스트 프롬프트 → 영상
 *   image-to-video     — 이미지 + 프롬프트 → 영상
 *   reference-to-video — 레퍼런스 기반 일관성 생성
 *   custom-element     — 캐릭터/주체 에셋 생성
 */
export const KLING_MODEL_REGISTRY: Record<string, KlingModelCapability> = {
  // ── O3 모델 패밀리 ──────────────────────────────────────────────

  "kling-o3-text-to-video": {
    modelId: "kling-o3-text-to-video",
    displayName: "Kling O3 (Text)",
    workflowRole: "text-to-video",
    maxShots: 6,
    minShotDuration: 2,
    maxDuration: 15,
    minDuration: 3,
    supportsMultiShot: true,
    supportsSound: true,
    supportsElements: true,
    supportsReferenceInput: false,
    supportsVideoEdit: false,
    inputMode: "text",
    outputMode: "video",
    fallbackModelId: null,
    supportsImageToVideo: false,
  },

  "kling-o3-image-to-video": {
    modelId: "kling-o3-image-to-video",
    displayName: "Kling O3 (Image)",
    workflowRole: "image-to-video",
    maxShots: 6,
    minShotDuration: 2,
    maxDuration: 15,
    minDuration: 3,
    supportsMultiShot: true,
    supportsSound: true,
    supportsElements: true,
    supportsReferenceInput: false,
    supportsVideoEdit: false,
    inputMode: "image",
    outputMode: "video",
    fallbackModelId: null,
    supportsImageToVideo: true,
  },

  "kling-o3-reference-to-video": {
    modelId: "kling-o3-reference-to-video",
    displayName: "Kling O3 (Reference)",
    workflowRole: "reference-to-video",
    maxShots: 6,
    minShotDuration: 2,
    maxDuration: 15,
    minDuration: 3,
    supportsMultiShot: true,
    supportsSound: true,
    supportsElements: true,
    supportsReferenceInput: true,
    supportsVideoEdit: false,
    inputMode: "reference",
    outputMode: "video",
    fallbackModelId: "kling-o3-image-to-video",
    supportsImageToVideo: false,
  },

  "kling-custom-element": {
    modelId: "kling-custom-element",
    displayName: "Kling Custom Element",
    workflowRole: "custom-element",
    maxShots: 0,
    minShotDuration: 0,
    maxDuration: 0,
    minDuration: 0,
    supportsMultiShot: false,
    supportsSound: false,
    supportsElements: false,
    supportsReferenceInput: false,
    supportsVideoEdit: false,
    inputMode: "image_refer",
    outputMode: "element_asset",
    fallbackModelId: null,
    supportsImageToVideo: false,
  },

};

// ═══════════════════════════════════════════════════════════════════
// Default Model Constants
// ═══════════════════════════════════════════════════════════════════

/** 기본 text-to-video 모델 (O3) */
export const KLING_DEFAULT_TEXT_MODEL = "kling-o3-text-to-video";

/** 기본 image-to-video 모델 (O3) */
export const KLING_DEFAULT_IMAGE_MODEL = "kling-o3-image-to-video";

/** 기본 reference-to-video 모델 (O3) */
export const KLING_DEFAULT_REFERENCE_MODEL = "kling-o3-reference-to-video";

/** 기본 custom-element 모델 */
export const KLING_ELEMENT_MODEL = "kling-custom-element";

/** 기본 모델 (O3 text-to-video) */
export const KLING_DEFAULT_MODEL = KLING_DEFAULT_TEXT_MODEL;

/**
 * KLING_MODELS — 모든 O3 모델 상수 (워크플로우별 매핑).
 */
export const KLING_MODELS = {
  TEXT_TO_VIDEO: KLING_DEFAULT_TEXT_MODEL,
  IMAGE_TO_VIDEO: KLING_DEFAULT_IMAGE_MODEL,
  REFERENCE_TO_VIDEO: KLING_DEFAULT_REFERENCE_MODEL,
  CUSTOM_ELEMENT: KLING_ELEMENT_MODEL,
} as const;

export type KlingModelId = (typeof KLING_MODELS)[keyof typeof KLING_MODELS];

// ═══════════════════════════════════════════════════════════════════
// Workflow ↔ Model Mapping
// ═══════════════════════════════════════════════════════════════════

/**
 * WorkflowType → 기본 모델 ID 매핑.
 * 각 워크플로우의 메인 경로에서 사용할 모델을 정의한다.
 */
export const WORKFLOW_MODEL_MAP: Record<WorkflowType, string> = {
  "text-to-video":      KLING_MODELS.TEXT_TO_VIDEO,
  "image-to-video":     KLING_MODELS.IMAGE_TO_VIDEO,
  "reference-to-video": KLING_MODELS.REFERENCE_TO_VIDEO,
  "custom-element":     KLING_MODELS.CUSTOM_ELEMENT,
};

/**
 * 워크플로우 타입으로 기본 모델을 선택한다.
 */
export function getModelForWorkflow(workflow: WorkflowType): string {
  return WORKFLOW_MODEL_MAP[workflow];
}

/**
 * 모델 ID로 해당 워크플로우 타입을 역조회한다.
 */
export function getWorkflowForModel(modelId: string): WorkflowType {
  const cap = KLING_MODEL_REGISTRY[modelId];
  return cap?.workflowRole ?? "text-to-video";
}

// ═══════════════════════════════════════════════════════════════════
// Capability Lookup
// ═══════════════════════════════════════════════════════════════════

/** O3 text-to-video capability — 알 수 없는 모델의 기본값 */
const DEFAULT_CAPABILITY = KLING_MODEL_REGISTRY[KLING_DEFAULT_TEXT_MODEL]!;

/**
 * 모델 ID로 capability를 조회한다.
 * 등록되지 않은 모델이면 O3 text-to-video 기본값을 반환한다.
 */
export function getCapability(modelId: string): KlingModelCapability {
  return KLING_MODEL_REGISTRY[modelId] ?? DEFAULT_CAPABILITY;
}

/**
 * 모델 capability + duration에 따른 "실질적 최대 샷 수"를 계산한다.
 *
 * 단순히 모델의 maxShots를 반환하는 게 아니라,
 * duration이 짧으면 자연스럽게 덜 추천한다.
 *
 * 정책:
 *   - duration ≤ 3초: 0 (multiShot 비활성)
 *   - duration > 3초: maxShots (모델 하드 리밋, 보통 6)
 *
 * duration > 3초이면 모델이 지원하는 최대 샷 수(6)까지 허용.
 * 각 샷의 최소 길이는 clampShotDuration에서 보정.
 */
export function getMaxShots(modelId: string, durationSec: number): number {
  const cap = getCapability(modelId);

  if (!cap.supportsMultiShot) return 0;
  if (durationSec <= 3) return 0;
  return cap.maxShots; // 항상 6
}

/**
 * duration 기반 최소 멀티샷 수.
 * multi-shot-planner.ts의 SHOT_COUNT_RANGES와 동기화.
 *
 *   ≤3s: 0 (multiShot 비활성)
 *   4~8s: 3
 *   9~15s: 4
 */
export function getMinShots(modelId: string, durationSec: number): number {
  const cap = getCapability(modelId);
  if (!cap.supportsMultiShot) return 0;
  if (durationSec <= 3) return 0;
  if (durationSec <= 8) return 3;
  return 4; // 9~15s
}

/**
 * 개별 샷의 duration을 검증하고, 최소값 미만이면 보정한다.
 *
 * @returns 보정된 duration (초, 정수)
 */
export function clampShotDuration(modelId: string, shotDurationSec: number): number {
  const cap = getCapability(modelId);
  return Math.max(cap.minShotDuration, Math.round(shotDurationSec));
}

/**
 * multi-shot 배열을 검증하고 정규화한다.
 *
 * 1. maxShots 초과 시 slice
 * 2. 개별 duration 보정 (minShotDuration 이상)
 * 3. index 재정렬 (1-based 순차)
 * 4. duration 합이 totalDuration과 맞도록 마지막 샷 조정
 *
 * @returns 정규화된 MultiShot 배열 (빈 배열 = multiShot 비활성)
 */
export function normalizeMultiShots(
  modelId: string,
  shots: Array<{ index: number; prompt: string; duration: string }>,
  totalDurationSec: number,
): Array<{ index: number; prompt: string; duration: string }> {
  const maxShots = getMaxShots(modelId, totalDurationSec);
  if (maxShots <= 0 || shots.length === 0) return [];

  const cap = getCapability(modelId);

  // 1. maxShots 초과 slice
  const clamped = shots.slice(0, maxShots);

  // 2. 개별 duration 보정 + index 재정렬
  const normalized = clamped.map((s, i) => ({
    index: i + 1,
    prompt: s.prompt,
    duration: String(Math.max(cap.minShotDuration, parseFloat(s.duration) || cap.minShotDuration)),
  }));

  // 3. duration 합 조정 — 마지막 샷으로 remainder 흡수
  const currentTotal = normalized.reduce((sum, s) => sum + (parseFloat(s.duration) || 0), 0);
  if (currentTotal !== totalDurationSec && normalized.length > 0) {
    const diff = totalDurationSec - currentTotal;
    const lastDur = (parseFloat(normalized[normalized.length - 1].duration) || 0) + diff;
    if (lastDur >= cap.minShotDuration) {
      normalized[normalized.length - 1].duration = String(lastDur);
    }
    // lastDur < minShotDuration인 경우는 총 duration이 너무 짧은 것 — 그대로 둠
  }

  return normalized;
}

// ═══════════════════════════════════════════════════════════════════
// Model Resolution & Fallback
// ═══════════════════════════════════════════════════════════════════

/**
 * 워크플로우 타입 + 컨텍스트에 기반하여 최적 모델을 선택한다.
 *
 * 우선순위:
 *   1. 명시적 모델 지정 → 그대로 사용
 *   2. 명시적 워크플로우 지정 → WORKFLOW_MODEL_MAP 조회
 *   3. 컨텍스트 기반 자동 판단:
 *      - referenceImages 있음 → reference-to-video
 *      - image 있음 → image-to-video
 *      - 그 외 → text-to-video
 */
export function resolveModelForWorkflow(opts: {
  requestedModel?: string;
  workflow?: WorkflowType;
  hasImage?: boolean;
  hasReferenceImages?: boolean;
  hasSourceVideo?: boolean;
}): string {
  // 1. 명시적 모델 지정
  if (opts.requestedModel) return opts.requestedModel;

  // 2. 명시적 워크플로우 지정
  if (opts.workflow) return getModelForWorkflow(opts.workflow);

  // 3. 컨텍스트 기반 자동 판단
  if (opts.hasReferenceImages) return KLING_MODELS.REFERENCE_TO_VIDEO;
  if (opts.hasImage) return KLING_MODELS.IMAGE_TO_VIDEO;
  return KLING_MODELS.TEXT_TO_VIDEO;
}

/**
 * 기존 resolveModel과 하위 호환 — hasImage 기반 text/image 선택.
 * 새 코드에서는 resolveModelForWorkflow를 사용할 것.
 */
export function resolveModel(requestedModel: string | undefined, hasImage: boolean): string {
  return resolveModelForWorkflow({ requestedModel, hasImage });
}

/**
 * 모델 접근 불가 시 fallback 체인을 따라 대체 모델을 찾는다.
 *
 * @returns [resolvedModelId, wasFallback]
 */
export function resolveModelWithFallback(modelId: string): [string, boolean] {
  const cap = KLING_MODEL_REGISTRY[modelId];
  if (!cap) return [KLING_DEFAULT_TEXT_MODEL, true];
  if (cap.fallbackModelId && KLING_MODEL_REGISTRY[cap.fallbackModelId]) {
    return [cap.fallbackModelId, true];
  }
  return [modelId, false];
}

/**
 * 모델이 O3 계열인지 판정한다.
 */
export function isO3Model(modelId: string): boolean {
  return modelId.includes("-o3-");
}

/**
 * 모델이 v3 (레거시) 계열인지 판정한다.
 * 현재 v3 모델은 사용하지 않으므로 항상 false를 반환한다.
 */
export function isV3Model(_modelId: string): boolean {
  return false;
}

/**
 * 모델이 영상 생성 가능한 모델인지 판정한다.
 * (custom-element는 에셋 생성 전용이므로 false)
 */
export function isVideoGenerationModel(modelId: string): boolean {
  const cap = getCapability(modelId);
  return cap.outputMode === "video";
}

/**
 * 모델이 멀티샷을 지원하는지 + 특정 duration에서 멀티샷이 활성화되는지 판정.
 * getMaxShots > 1 이면 true.
 */
export function isMultiShotEligible(modelId: string, durationSec: number): boolean {
  return getMaxShots(modelId, durationSec) >= 2;
}

/**
 * 특정 워크플로우를 지원하는 모든 모델 ID를 반환한다.
 */
export function getModelsForWorkflow(workflow: WorkflowType): string[] {
  return Object.values(KLING_MODEL_REGISTRY)
    .filter(cap => cap.workflowRole === workflow)
    .map(cap => cap.modelId);
}
