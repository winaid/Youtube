/**
 * sketch-to-shot-plan.ts — 스케치 구도 분석 결과 → shotPlan 매핑
 *
 * analyze-sketch API의 SketchAnalysisResult를 받아
 * CutCard에서 사용하는 카메라/피사체 설정으로 변환.
 *
 * 매핑 규칙:
 *   framing → cameraDirection (WS/MS/CU/ECU...)
 *   angle → camera angle
 *   motionHint → camera motion
 *   subjectPosition → subject blocking direction
 *   subjectPose → action hint
 *   backgroundElements → environment enrichment
 */

// ═══════════════════════════════════════════════════════════════════
// Types (서버 응답 미러)
// ═══════════════════════════════════════════════════════════════════

export interface SketchAnalysisResult {
  framing: string;
  angle: string;
  motionHint: string;
  subjectPosition: {
    horizontal: "left-third" | "center" | "right-third";
    vertical: "top-third" | "center" | "bottom-third";
  };
  subjectPose: string;
  subjectCount: number;
  backgroundElements: string[];
  depthLayers: {
    foreground?: string;
    midground?: string;
    background?: string;
  };
  compositionSummary: string;
  confidence: number;
}

export interface ShotPlanFromSketch {
  /** 카메라 방향 문자열 — CutCard의 cameraDirection에 매핑 */
  cameraDirection: string;
  /** 구조화된 카메라 설정 */
  camera: {
    framing: string;
    angle: string;
    motion: string;
  };
  /** 피사체 blocking 설명 */
  subjectBlocking: string;
  /** 환경 힌트 (스케치에서 추출된 배경 요소) */
  environmentHint: string;
  /** 동작 힌트 (포즈 기반) */
  actionHint: string;
  /** 구도 요약 */
  compositionNote: string;
  /** 분석 신뢰도 */
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════════
// Mapping
// ═══════════════════════════════════════════════════════════════════

const FRAMING_LABELS: Record<string, string> = {
  WS: "Wide shot",
  LS: "Long shot",
  MLS: "Medium long shot",
  MS: "Medium shot",
  MCU: "Medium close-up",
  CU: "Close-up",
  ECU: "Extreme close-up",
};

const POSITION_LABELS: Record<string, string> = {
  "left-third": "left third of frame",
  "center": "center frame",
  "right-third": "right third of frame",
  "top-third": "upper frame",
  "bottom-third": "lower frame",
};

const POSE_TO_ACTION: Record<string, string> = {
  "standing": "standing in position",
  "sitting": "seated",
  "walking": "walking",
  "running": "running",
  "action": "in dynamic action",
  "close-detail": "detail/insert focus",
  "no-figure": "no human figure — environment or object focus",
};

/**
 * 스케치 분석 결과를 shotPlan 매핑으로 변환.
 */
export function sketchToShotPlan(analysis: SketchAnalysisResult): ShotPlanFromSketch {
  const framingLabel = FRAMING_LABELS[analysis.framing] || analysis.framing;
  const motionLabel = analysis.motionHint === "static" ? "" : `, ${analysis.motionHint}`;

  // Camera direction string
  const cameraDirection = `${framingLabel}, ${analysis.angle}${motionLabel}`;

  // Subject blocking
  const hPos = POSITION_LABELS[analysis.subjectPosition.horizontal] || "center frame";
  const vPos = POSITION_LABELS[analysis.subjectPosition.vertical] || "";
  const countNote = analysis.subjectCount > 1 ? `${analysis.subjectCount} subjects` : "";
  const blocking = [
    `Subject positioned at ${hPos}`,
    vPos && vPos !== "center frame" ? vPos : "",
    countNote,
  ].filter(Boolean).join(", ");

  // Environment hint from background elements
  const envParts: string[] = [];
  if (analysis.backgroundElements.length > 0) {
    envParts.push(analysis.backgroundElements.join(", "));
  }
  if (analysis.depthLayers.background) {
    envParts.push(`background: ${analysis.depthLayers.background}`);
  }
  if (analysis.depthLayers.foreground) {
    envParts.push(`foreground: ${analysis.depthLayers.foreground}`);
  }

  // Action hint from pose
  const actionHint = POSE_TO_ACTION[analysis.subjectPose] || analysis.subjectPose;

  return {
    cameraDirection,
    camera: {
      framing: analysis.framing,
      angle: analysis.angle,
      motion: analysis.motionHint,
    },
    subjectBlocking: blocking,
    environmentHint: envParts.join("; ") || "",
    actionHint,
    compositionNote: analysis.compositionSummary,
    confidence: analysis.confidence,
  };
}

/**
 * shotPlan 매핑 결과를 사용자에게 보여줄 요약 텍스트 생성.
 */
export function formatShotPlanSummary(plan: ShotPlanFromSketch): string {
  const lines: string[] = [];
  lines.push(`📷 ${plan.cameraDirection}`);
  if (plan.subjectBlocking) lines.push(`👤 ${plan.subjectBlocking}`);
  if (plan.actionHint) lines.push(`🎬 ${plan.actionHint}`);
  if (plan.environmentHint) lines.push(`🏞️ ${plan.environmentHint}`);
  if (plan.compositionNote) lines.push(`📐 ${plan.compositionNote}`);
  lines.push(`신뢰도: ${Math.round(plan.confidence * 100)}%`);
  return lines.join("\n");
}

/**
 * 스케치 분석 API 호출.
 */
export async function analyzeSketch(sketchBase64: string): Promise<{
  ok: boolean;
  analysis?: SketchAnalysisResult;
  error?: string;
}> {
  try {
    const res = await fetch("/api/analyze-sketch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sketchBase64 }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      return { ok: false, error: (err.error as string) || `HTTP ${res.status}` };
    }

    const data = await res.json() as { ok: boolean; analysis: SketchAnalysisResult };
    return { ok: true, analysis: data.analysis };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
