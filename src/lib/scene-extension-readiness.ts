/**
 * scene-extension-readiness.ts — Scene Extension 준비 상태 판단 + 재평가
 *
 * 핵심 문제: auto-mode에서 cut2 생성이 cut1 업로드 완료 전에 시작됨.
 * canonicalVideoUri가 아직 없는 상태에서 previousVideoUri를 읽으면 undefined.
 *
 * 해결: 업로드 완료 후 eligibility를 재평가하고, 다음 컷의 모드를 결정.
 *
 * grep: reevaluateSceneExtensionEligibilityAfterUpload,
 *       selectVideoModeForNextCut
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type VideoModeDecision = "SCENE_EXTENSION" | "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO";

export interface SceneExtensionEligibility {
  eligible: boolean;
  canonicalVideoUri?: string;
  reason: string;
  uploadStatus?: string;
}

export interface ModeDecisionResult {
  mode: VideoModeDecision;
  videoUri?: string;       // SCENE_EXTENSION일 때 사용할 URI
  imageBase64?: string;    // IMAGE_TO_VIDEO일 때 사용할 프레임
  reason: string;
  continuityScore: number; // 0-100: 연속성 점수
}

// ═══════════════════════════════════════════════════════════════════
// Eligibility Reevaluation (업로드 후 재평가)
// ═══════════════════════════════════════════════════════════════════

interface ClipLike {
  cutNumber: number;
  status: string;
  canonicalVideoUri?: string;
  rawVideoUri?: string;
  videoUri?: string;
  uploadStatus?: string;
  sceneExtensionEligible?: boolean;
}

/**
 * 업로드 완료 후 Scene Extension eligibility를 재평가.
 * 폴링 완료 직후 + 업로드 완료 직후 2번 호출하여
 * canonicalVideoUri가 뒤늦게 설정되는 타이밍 문제 해결.
 *
 * grep: reevaluateSceneExtensionEligibilityAfterUpload
 */
export function reevaluateSceneExtensionEligibilityAfterUpload(
  clip: ClipLike,
): SceneExtensionEligibility {
  if (clip.status !== "completed") {
    return {
      eligible: false,
      reason: `clip status is "${clip.status}", not "completed"`,
      uploadStatus: clip.uploadStatus,
    };
  }

  // canonicalVideoUri가 있으면 eligible
  if (clip.canonicalVideoUri) {
    const isValid = clip.canonicalVideoUri.startsWith("gs://") ||
                    clip.canonicalVideoUri.startsWith("https://");
    return {
      eligible: isValid,
      canonicalVideoUri: isValid ? clip.canonicalVideoUri : undefined,
      reason: isValid
        ? `canonical URI available: ${clip.canonicalVideoUri.slice(0, 60)}`
        : `canonical URI invalid scheme: ${clip.canonicalVideoUri.slice(0, 30)}`,
      uploadStatus: clip.uploadStatus,
    };
  }

  // rawVideoUri fallback (gs:// 또는 https:// 만)
  if (clip.rawVideoUri) {
    const isUsable = clip.rawVideoUri.startsWith("gs://") ||
                     clip.rawVideoUri.startsWith("https://");
    if (isUsable) {
      return {
        eligible: true,
        canonicalVideoUri: clip.rawVideoUri,
        reason: `rawVideoUri usable as canonical: ${clip.rawVideoUri.slice(0, 60)}`,
        uploadStatus: clip.uploadStatus,
      };
    }
  }

  // 업로드 아직 진행 중일 수 있음
  if (clip.uploadStatus === "pending") {
    return {
      eligible: false,
      reason: "upload still pending — will reevaluate after completion",
      uploadStatus: clip.uploadStatus,
    };
  }

  return {
    eligible: false,
    reason: "no usable canonical URI (upload failed or not available)",
    uploadStatus: clip.uploadStatus,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Mode Selection for Next Cut
// ═══════════════════════════════════════════════════════════════════

/**
 * 다음 컷의 생성 모드 결정.
 * previousClip의 상태와 URI 유무에 따라 3가지 모드 중 선택.
 *
 * grep: selectVideoModeForNextCut
 */
export function selectVideoModeForNextCut(
  cutNumber: number,
  previousClip: ClipLike | undefined,
  firstFrameBase64: string | undefined,
): ModeDecisionResult {
  // CUT 1은 항상 TEXT_TO_VIDEO 또는 IMAGE_TO_VIDEO
  if (cutNumber <= 1) {
    if (firstFrameBase64) {
      return {
        mode: "IMAGE_TO_VIDEO",
        imageBase64: firstFrameBase64,
        reason: "first cut with reference image",
        continuityScore: 50,
      };
    }
    return {
      mode: "TEXT_TO_VIDEO",
      reason: "first cut, no reference image",
      continuityScore: 0,
    };
  }

  if (!previousClip) {
    return {
      mode: firstFrameBase64 ? "IMAGE_TO_VIDEO" : "TEXT_TO_VIDEO",
      imageBase64: firstFrameBase64,
      reason: "no previous clip found",
      continuityScore: firstFrameBase64 ? 40 : 0,
    };
  }

  // 이전 컷 eligibility 재평가
  const eligibility = reevaluateSceneExtensionEligibilityAfterUpload(previousClip);

  if (eligibility.eligible && eligibility.canonicalVideoUri) {
    return {
      mode: "SCENE_EXTENSION",
      videoUri: eligibility.canonicalVideoUri,
      reason: eligibility.reason,
      continuityScore: 100,
    };
  }

  // Fallback: IMAGE_TO_VIDEO (lastFrame 또는 firstFrame)
  if (firstFrameBase64) {
    return {
      mode: "IMAGE_TO_VIDEO",
      imageBase64: firstFrameBase64,
      reason: `scene extension unavailable (${eligibility.reason}), using frame fallback`,
      continuityScore: 60,
    };
  }

  return {
    mode: "TEXT_TO_VIDEO",
    reason: `scene extension unavailable (${eligibility.reason}), no frame fallback`,
    continuityScore: 0,
  };
}

