/**
 * _kling-capability.ts — 서버 사이드 Kling capability (functions/api용)
 *
 * src/lib/kling-capability.ts와 동일한 정책을 서버 사이드에서 제공.
 * Cloudflare Functions는 @/lib/ import 불가 → 별도 파일로 유지.
 *
 * WARNING: 정책 변경 시 src/lib/kling-capability.ts와 반드시 동기화할 것.
 *
 * O3 모델 패밀리 (5개):
 *   - kling-o3-text-to-video
 *   - kling-o3-image-to-video
 *   - kling-o3-reference-to-video
 *   - kling-o3-video-edit
 *   - kling-custom-element
 */

// ═══════════════════════════════════════════════════════════════════
// Workflow Types
// ═══════════════════════════════════════════════════════════════════

export type WorkflowType =
  | "text-to-video"
  | "image-to-video"
  | "reference-to-video"
  | "video-edit"
  | "custom-element";

export type InputMode = "text" | "image" | "reference" | "video" | "image_refer" | "video_refer";
export type OutputMode = "video" | "element_asset";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface KlingModelCapability {
  modelId: string;
  displayName: string;
  workflowRole: WorkflowType;
  maxShots: number;
  minShotDuration: number;
  maxDuration: number;
  minDuration: number;
  supportsMultiShot: boolean;
  supportsSound: boolean;
  supportsElements: boolean;
  supportsReferenceInput: boolean;
  supportsVideoEdit: boolean;
  inputMode: InputMode;
  outputMode: OutputMode;
  fallbackModelId: string | null;
  /** @deprecated */
  supportsImageToVideo: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Model Registry — O3 모델 패밀리 (5개) + v3 레거시 fallback
// ═══════════════════════════════════════════════════════════════════

export const KLING_MODEL_REGISTRY: Record<string, KlingModelCapability> = {
  // ── O3 모델 패밀리 ──
  "kling-o3-text-to-video": {
    modelId: "kling-o3-text-to-video",
    displayName: "Kling O3 (Text)",
    workflowRole: "text-to-video",
    maxShots: 6, minShotDuration: 2, maxDuration: 15, minDuration: 3,
    supportsMultiShot: true, supportsSound: true, supportsElements: true,
    supportsReferenceInput: false, supportsVideoEdit: false,
    inputMode: "text", outputMode: "video",
    fallbackModelId: "kling-v3-text-to-video",
    supportsImageToVideo: false,
  },
  "kling-o3-image-to-video": {
    modelId: "kling-o3-image-to-video",
    displayName: "Kling O3 (Image)",
    workflowRole: "image-to-video",
    maxShots: 6, minShotDuration: 2, maxDuration: 15, minDuration: 3,
    supportsMultiShot: true, supportsSound: true, supportsElements: true,
    supportsReferenceInput: false, supportsVideoEdit: false,
    inputMode: "image", outputMode: "video",
    fallbackModelId: "kling-v3-image-to-video",
    supportsImageToVideo: true,
  },
  "kling-o3-reference-to-video": {
    modelId: "kling-o3-reference-to-video",
    displayName: "Kling O3 (Reference)",
    workflowRole: "reference-to-video",
    maxShots: 6, minShotDuration: 2, maxDuration: 15, minDuration: 3,
    supportsMultiShot: true, supportsSound: true, supportsElements: true,
    supportsReferenceInput: true, supportsVideoEdit: false,
    inputMode: "reference", outputMode: "video",
    fallbackModelId: "kling-o3-image-to-video",
    supportsImageToVideo: false,
  },
  // NOTE: video-edit은 capability 등록만 완료. UI/서버 실행 경로 미연결 (scaffolded).
  "kling-o3-video-edit": {
    modelId: "kling-o3-video-edit",
    displayName: "Kling O3 (Edit)",
    workflowRole: "video-edit",
    maxShots: 0, minShotDuration: 0, maxDuration: 15, minDuration: 3,
    supportsMultiShot: false, supportsSound: true, supportsElements: false,
    supportsReferenceInput: false, supportsVideoEdit: true,
    inputMode: "video", outputMode: "video",
    fallbackModelId: null,
    supportsImageToVideo: false,
  },
  "kling-custom-element": {
    modelId: "kling-custom-element",
    displayName: "Kling Custom Element",
    workflowRole: "custom-element",
    maxShots: 0, minShotDuration: 0, maxDuration: 0, minDuration: 0,
    supportsMultiShot: false, supportsSound: false, supportsElements: false,
    supportsReferenceInput: false, supportsVideoEdit: false,
    inputMode: "image_refer", outputMode: "element_asset",
    fallbackModelId: null,
    supportsImageToVideo: false,
  },

  // ── v3 레거시 fallback ──
  "kling-v3-text-to-video": {
    modelId: "kling-v3-text-to-video",
    displayName: "Kling v3 (Text)",
    workflowRole: "text-to-video",
    maxShots: 3, minShotDuration: 3, maxDuration: 15, minDuration: 3,
    supportsMultiShot: true, supportsSound: true, supportsElements: true,
    supportsReferenceInput: false, supportsVideoEdit: false,
    inputMode: "text", outputMode: "video",
    fallbackModelId: null,
    supportsImageToVideo: false,
  },
  "kling-v3-image-to-video": {
    modelId: "kling-v3-image-to-video",
    displayName: "Kling v3 (Image)",
    workflowRole: "image-to-video",
    maxShots: 3, minShotDuration: 3, maxDuration: 15, minDuration: 3,
    supportsMultiShot: true, supportsSound: true, supportsElements: true,
    supportsReferenceInput: false, supportsVideoEdit: false,
    inputMode: "image", outputMode: "video",
    fallbackModelId: null,
    supportsImageToVideo: true,
  },
};

// ═══════════════════════════════════════════════════════════════════
// Default Model Constants
// ═══════════════════════════════════════════════════════════════════

export const KLING_DEFAULT_TEXT_MODEL = "kling-o3-text-to-video";
export const KLING_DEFAULT_IMAGE_MODEL = "kling-o3-image-to-video";
export const KLING_DEFAULT_REFERENCE_MODEL = "kling-o3-reference-to-video";
export const KLING_DEFAULT_EDIT_MODEL = "kling-o3-video-edit";
export const KLING_ELEMENT_MODEL = "kling-custom-element";
export const KLING_DEFAULT_MODEL = KLING_DEFAULT_TEXT_MODEL;

export const KLING_MODELS = {
  TEXT_TO_VIDEO: KLING_DEFAULT_TEXT_MODEL,
  IMAGE_TO_VIDEO: KLING_DEFAULT_IMAGE_MODEL,
  REFERENCE_TO_VIDEO: KLING_DEFAULT_REFERENCE_MODEL,
  VIDEO_EDIT: KLING_DEFAULT_EDIT_MODEL,
  CUSTOM_ELEMENT: KLING_ELEMENT_MODEL,
} as const;

export type KlingModelId = (typeof KLING_MODELS)[keyof typeof KLING_MODELS];

// ═══════════════════════════════════════════════════════════════════
// Workflow ↔ Model Mapping
// ═══════════════════════════════════════════════════════════════════

export const WORKFLOW_MODEL_MAP: Record<WorkflowType, string> = {
  "text-to-video":      KLING_MODELS.TEXT_TO_VIDEO,
  "image-to-video":     KLING_MODELS.IMAGE_TO_VIDEO,
  "reference-to-video": KLING_MODELS.REFERENCE_TO_VIDEO,
  "video-edit":         KLING_MODELS.VIDEO_EDIT,
  "custom-element":     KLING_MODELS.CUSTOM_ELEMENT,
};

export function getModelForWorkflow(workflow: WorkflowType): string {
  return WORKFLOW_MODEL_MAP[workflow];
}

export function getWorkflowForModel(modelId: string): WorkflowType {
  const cap = KLING_MODEL_REGISTRY[modelId];
  return cap?.workflowRole ?? "text-to-video";
}

// ═══════════════════════════════════════════════════════════════════
// Capability Lookup
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_CAPABILITY = KLING_MODEL_REGISTRY[KLING_DEFAULT_TEXT_MODEL]!;

export function getCapability(modelId: string): KlingModelCapability {
  return KLING_MODEL_REGISTRY[modelId] ?? DEFAULT_CAPABILITY;
}

export function getMaxShots(modelId: string, durationSec: number): number {
  const cap = getCapability(modelId);
  if (!cap.supportsMultiShot) return 0;
  if (durationSec <= 3) return 0;

  const modelLimit = cap.maxShots;
  let durationLimit: number;
  if (durationSec <= 5) durationLimit = 2;
  else if (durationSec <= 7) durationLimit = 3;
  else if (durationSec <= 10) durationLimit = 4;
  else durationLimit = modelLimit;

  const physicalLimit = Math.floor(durationSec / cap.minShotDuration);
  return Math.min(modelLimit, durationLimit, physicalLimit);
}

export function normalizeMultiShots(
  modelId: string,
  shots: Array<{ index: number; prompt: string; duration: string }>,
  totalDurationSec: number,
): Array<{ index: number; prompt: string; duration: string }> {
  const maxShots = getMaxShots(modelId, totalDurationSec);
  if (maxShots <= 0 || shots.length === 0) return [];

  const cap = getCapability(modelId);
  const clamped = shots.slice(0, maxShots);

  const normalized = clamped.map((s, i) => ({
    index: i + 1,
    prompt: s.prompt,
    duration: String(Math.max(cap.minShotDuration, parseInt(s.duration, 10) || cap.minShotDuration)),
  }));

  const currentTotal = normalized.reduce((sum, s) => sum + parseInt(s.duration, 10), 0);
  if (currentTotal !== totalDurationSec && normalized.length > 0) {
    const diff = totalDurationSec - currentTotal;
    const lastDur = parseInt(normalized[normalized.length - 1].duration, 10) + diff;
    if (lastDur >= cap.minShotDuration) {
      normalized[normalized.length - 1].duration = String(lastDur);
    }
  }

  return normalized;
}

// ═══════════════════════════════════════════════════════════════════
// Model Resolution & Fallback
// ═══════════════════════════════════════════════════════════════════

export function resolveModelForWorkflow(opts: {
  requestedModel?: string;
  workflow?: WorkflowType;
  hasImage?: boolean;
  hasReferenceImages?: boolean;
  hasSourceVideo?: boolean;
}): string {
  if (opts.requestedModel) return opts.requestedModel;
  if (opts.workflow) return getModelForWorkflow(opts.workflow);
  if (opts.hasSourceVideo) return KLING_MODELS.VIDEO_EDIT;
  if (opts.hasReferenceImages) return KLING_MODELS.REFERENCE_TO_VIDEO;
  if (opts.hasImage) return KLING_MODELS.IMAGE_TO_VIDEO;
  return KLING_MODELS.TEXT_TO_VIDEO;
}

export function resolveModel(requestedModel: string | undefined, hasImage: boolean): string {
  return resolveModelForWorkflow({ requestedModel, hasImage });
}

export function resolveModelWithFallback(modelId: string): [string, boolean] {
  const cap = KLING_MODEL_REGISTRY[modelId];
  if (!cap) return [KLING_DEFAULT_TEXT_MODEL, true];
  if (cap.fallbackModelId && KLING_MODEL_REGISTRY[cap.fallbackModelId]) {
    return [cap.fallbackModelId, true];
  }
  return [modelId, false];
}

export function isO3Model(modelId: string): boolean {
  return modelId.includes("-o3-");
}

export function isVideoGenerationModel(modelId: string): boolean {
  const cap = getCapability(modelId);
  return cap.outputMode === "video";
}
