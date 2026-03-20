/**
 * _veo-capability.ts — 서버 사이드 VEO capability (functions/api용)
 *
 * src/lib/veo-capability.ts와 동일한 정책을 서버 사이드에서 제공.
 * Cloudflare Functions는 @/lib/ import 불가 → 별도 파일로 유지.
 *
 * WARNING: 정책 변경 시 src/lib/veo-capability.ts와 반드시 동기화할 것.
 *
 * VEO 모델 패밀리:
 *   - veo-3.1-fast-generate-preview   (기본값: 가장 저렴, 연장 가능)
 *   - veo-3.1-generate-preview        (고품질 4K)
 *   - veo-3.0-fast-generate-preview   (저렴 대안, 연장 불가)
 *   - veo-2.0-generate-preview        (레거시)
 */

// ═══════════════════════════════════════════════════════════════════
// Workflow Types
// ═══════════════════════════════════════════════════════════════════

export type WorkflowType =
  | "text-to-video"
  | "image-to-video"
  | "extend";

export type InputMode = "text" | "image" | "video";
export type OutputMode = "video";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface VeoModelCapability {
  modelId: string;
  displayName: string;
  workflowRole: WorkflowType;
  /** 지원 듀레이션 (초) */
  supportedDurations: number[];
  /** 기본 듀레이션 (초) */
  defaultDuration: number;
  /** 지원 해상도 */
  supportedResolutions: string[];
  /** 기본 해상도 */
  defaultResolution: string;
  /** 네이티브 오디오 생성 지원 */
  supportsAudio: boolean;
  /** 영상 연장(extension) 지원 */
  supportsExtension: boolean;
  /** 연장 시 추가되는 초 */
  extensionDurationSec: number;
  /** 최대 연장 횟수 */
  maxExtensions: number;
  /** 연장 입력 최대 길이 (초) */
  maxExtensionInputSec: number;
  /** 레퍼런스 이미지 지원 */
  supportsReferenceImages: boolean;
  /** 최대 레퍼런스 이미지 수 */
  maxReferenceImages: number;
  /** 초당 가격 (USD, 720p 기준) */
  pricePerSecond720p: number;
  /** fallback 모델 ID */
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
// Default Model Constants
// ═══════════════════════════════════════════════════════════════════

/** 기본 모델 — 가장 저렴 + 연장 가능 */
export const VEO_DEFAULT_MODEL = "veo-3.1-fast-generate-preview";

export const VEO_MODELS = {
  DEFAULT: VEO_DEFAULT_MODEL,
  STANDARD: "veo-3.1-generate-preview",
  FAST_30: "veo-3.0-fast-generate-preview",
  LEGACY: "veo-2.0-generate-preview",
} as const;

export type VeoModelId = string;

/** VEO 세그먼트 캡 — 단일 생성 최대 초 */
export const VEO_SEGMENT_CAP = 8;

/** VEO 연장(extension) 시 추가 초 */
export const VEO_EXTENSION_DURATION = 7;

// ═══════════════════════════════════════════════════════════════════
// Capability Lookup
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_CAPABILITY = VEO_MODEL_REGISTRY[VEO_DEFAULT_MODEL]!;

export function getCapability(modelId: string): VeoModelCapability {
  return VEO_MODEL_REGISTRY[modelId] ?? DEFAULT_CAPABILITY;
}

/**
 * 입력 듀레이션을 모델이 지원하는 값으로 클램핑.
 * VEO는 이산값(4, 6, 8)만 지원.
 */
export function clampToSupportedDuration(modelId: string, sec: number): number {
  const cap = getCapability(modelId);
  const supported = cap.supportedDurations;
  // 가장 가까운 지원 값으로 반올림
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

/**
 * 모델이 연장(extension)을 지원하는지 판정.
 */
export function supportsExtension(modelId: string): boolean {
  return getCapability(modelId).supportsExtension;
}

/**
 * 연장 가능한 모델 중 가장 저렴한 모델을 반환.
 */
export function getCheapestExtensionModel(): string {
  const extensionModels = Object.values(VEO_MODEL_REGISTRY)
    .filter(m => m.supportsExtension)
    .sort((a, b) => a.pricePerSecond720p - b.pricePerSecond720p);
  return extensionModels[0]?.modelId ?? VEO_DEFAULT_MODEL;
}

/**
 * 워크플로우 컨텍스트에 따라 최적 모델을 선택.
 */
export function resolveModelForWorkflow(opts: {
  requestedModel?: string;
  workflow?: WorkflowType;
  hasImage?: boolean;
  hasSourceVideo?: boolean;
}): string {
  if (opts.requestedModel && VEO_MODEL_REGISTRY[opts.requestedModel]) return opts.requestedModel;
  // 연장은 반드시 extension 지원 모델
  if (opts.workflow === "extend" || opts.hasSourceVideo) return getCheapestExtensionModel();
  return VEO_DEFAULT_MODEL;
}

/**
 * 비디오 생성용 모델인지 판정.
 */
export function isVideoGenerationModel(modelId: string): boolean {
  return !!VEO_MODEL_REGISTRY[modelId];
}
