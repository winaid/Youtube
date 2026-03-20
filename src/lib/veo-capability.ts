/**
 * veo-capability.ts — VEO 모델 패밀리 capability 정의 (클라이언트 중앙 정책)
 *
 * functions/api/_veo-capability.ts와 동일한 정책을 클라이언트에서 제공.
 * WARNING: 정책 변경 시 _veo-capability.ts와 반드시 동기화할 것.
 *
 * 핵심 정책:
 *   - 모든 생성은 반드시 8초 멀티샷
 *   - 단일샷 금지
 *   - 기본 4샷 구조: 2초+2초+2초+2초
 *   - 연장(extension)은 VEO 3.1 전용
 */

// ═══════════════════════════════════════════════════════════════════
// Types (서버와 동기화)
// ═══════════════════════════════════════════════════════════════════

export type WorkflowType = "text-to-video" | "image-to-video" | "extend";
export type InputMode = "text" | "image" | "video";
export type OutputMode = "video";

export interface VeoModelCapability {
  modelId: string;
  displayName: string;
  workflowRole: WorkflowType;
  supportedDurations: number[];
  defaultDuration: number;
  supportedResolutions: string[];
  defaultResolution: string;
  supportsAudio: boolean;
  supportsExtension: boolean;
  extensionDurationSec: number;
  maxExtensions: number;
  maxExtensionInputSec: number;
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  pricePerSecond720p: number;
  fallbackModelId: string | null;
  inputMode: InputMode;
  outputMode: OutputMode;
}

// ═══════════════════════════════════════════════════════════════════
// Model Registry
// ═══════════════════════════════════════════════════════════════════

export const VEO_MODEL_REGISTRY: Record<string, VeoModelCapability> = {
  "veo-3.1-fast-generate-preview": {
    modelId: "veo-3.1-fast-generate-preview",
    displayName: "VEO 3.1 Fast",
    workflowRole: "text-to-video",
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    supportedResolutions: ["720p", "1080p", "4k"],
    defaultResolution: "720p",
    supportsAudio: true,
    supportsExtension: true,
    extensionDurationSec: 7,
    maxExtensions: 20,
    maxExtensionInputSec: 141,
    supportsReferenceImages: true,
    maxReferenceImages: 3,
    pricePerSecond720p: 0.15,
    fallbackModelId: "veo-3.0-fast-generate-preview",
    inputMode: "text",
    outputMode: "video",
  },
  "veo-3.1-generate-preview": {
    modelId: "veo-3.1-generate-preview",
    displayName: "VEO 3.1 Standard",
    workflowRole: "text-to-video",
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    supportedResolutions: ["720p", "1080p", "4k"],
    defaultResolution: "720p",
    supportsAudio: true,
    supportsExtension: true,
    extensionDurationSec: 7,
    maxExtensions: 20,
    maxExtensionInputSec: 141,
    supportsReferenceImages: true,
    maxReferenceImages: 3,
    pricePerSecond720p: 0.40,
    fallbackModelId: "veo-3.1-fast-generate-preview",
    inputMode: "text",
    outputMode: "video",
  },
  "veo-3.0-fast-generate-preview": {
    modelId: "veo-3.0-fast-generate-preview",
    displayName: "VEO 3.0 Fast",
    workflowRole: "text-to-video",
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    supportedResolutions: ["720p", "1080p"],
    defaultResolution: "720p",
    supportsAudio: true,
    supportsExtension: false,
    extensionDurationSec: 0,
    maxExtensions: 0,
    maxExtensionInputSec: 0,
    supportsReferenceImages: false,
    maxReferenceImages: 0,
    pricePerSecond720p: 0.15,
    fallbackModelId: null,
    inputMode: "text",
    outputMode: "video",
  },
  "veo-2.0-generate-preview": {
    modelId: "veo-2.0-generate-preview",
    displayName: "VEO 2.0",
    workflowRole: "text-to-video",
    supportedDurations: [5, 6, 7, 8],
    defaultDuration: 8,
    supportedResolutions: ["720p"],
    defaultResolution: "720p",
    supportsAudio: false,
    supportsExtension: false,
    extensionDurationSec: 0,
    maxExtensions: 0,
    maxExtensionInputSec: 0,
    supportsReferenceImages: false,
    maxReferenceImages: 0,
    pricePerSecond720p: 0.35,
    fallbackModelId: null,
    inputMode: "text",
    outputMode: "video",
  },
};

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

export const VEO_DEFAULT_MODEL = "veo-3.1-fast-generate-preview";

export const VEO_MODELS = {
  DEFAULT: VEO_DEFAULT_MODEL,
  STANDARD: "veo-3.1-generate-preview",
  FAST_30: "veo-3.0-fast-generate-preview",
  LEGACY: "veo-2.0-generate-preview",
} as const;

export type VeoModelId = string;

/** 세그먼트 캡: 단일 생성 최대 초 */
export const VEO_SEGMENT_CAP = 8;

/** 연장 시 추가되는 초 */
export const VEO_EXTENSION_DURATION = 7;

/** 필수 생성 길이 (정책: 8초 고정) */
export const VEO_MANDATORY_DURATION = 8;

/** 기본 멀티샷 구조: 4샷 (2+2+2+2) */
export const VEO_DEFAULT_SHOT_STRUCTURE = [2, 2, 2, 2] as const;

// ═══════════════════════════════════════════════════════════════════
// Capability Lookup
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_CAPABILITY = VEO_MODEL_REGISTRY[VEO_DEFAULT_MODEL]!;

export function getCapability(modelId: string): VeoModelCapability {
  return VEO_MODEL_REGISTRY[modelId] ?? DEFAULT_CAPABILITY;
}

export function clampToSupportedDuration(modelId: string, sec: number): number {
  const cap = getCapability(modelId);
  const supported = cap.supportedDurations;
  let closest = supported[0];
  let minDiff = Math.abs(sec - closest);
  for (const d of supported) {
    const diff = Math.abs(sec - d);
    if (diff < minDiff) {
      closest = d;
      minDiff = diff;
    }
  }
  return closest;
}

export function supportsExtension(modelId: string): boolean {
  return getCapability(modelId).supportsExtension;
}

export function getCheapestExtensionModel(): string {
  const extensionModels = Object.values(VEO_MODEL_REGISTRY)
    .filter(m => m.supportsExtension)
    .sort((a, b) => a.pricePerSecond720p - b.pricePerSecond720p);
  return extensionModels[0]?.modelId ?? VEO_DEFAULT_MODEL;
}

export function resolveModelForWorkflow(opts: {
  requestedModel?: string;
  workflow?: WorkflowType;
  hasImage?: boolean;
  hasSourceVideo?: boolean;
}): string {
  if (opts.requestedModel && VEO_MODEL_REGISTRY[opts.requestedModel]) return opts.requestedModel;
  if (opts.workflow === "extend" || opts.hasSourceVideo) return getCheapestExtensionModel();
  return VEO_DEFAULT_MODEL;
}

export function isVideoGenerationModel(modelId: string): boolean {
  return !!VEO_MODEL_REGISTRY[modelId];
}

/**
 * 누적 연장 길이 계산.
 * cut 1 = 8초, cut 2 = 8+7=15초, cut 3 = 15+7=22초 ...
 */
export function calculateCumulativeDuration(cutIndex: number): number {
  if (cutIndex <= 0) return VEO_MANDATORY_DURATION;
  return VEO_MANDATORY_DURATION + cutIndex * VEO_EXTENSION_DURATION;
}
