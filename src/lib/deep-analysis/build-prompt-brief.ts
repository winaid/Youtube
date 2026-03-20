/**
 * build-prompt-brief.ts — 분석 결과 → generate-cuts 주입용 compact brief
 *
 * 원칙:
 * - 짧고 명확한 제어 신호
 * - 중복 제거
 * - 충돌 시 보수적 정리
 * - continuity 힌트와 risk 완화를 통합
 */

import type {
  StoryIntentAnalysis,
  GenerationRiskAnalysis,
  VisualStrategyLite,
  PromptBrief,
} from "./types";

// ═══════════════════════════════════════════════════════════════════
// Safe Defaults
// ═══════════════════════════════════════════════════════════════════

export const SAFE_PROMPT_BRIEF: PromptBrief = {
  creativeBrief: "",
  continuityHint: "",
  shotDiscipline: "",
  subjectLockHint: "",
  environmentLockHint: "",
  avoidList: [],
};

// ═══════════════════════════════════════════════════════════════════
// Brief Builder
// ═══════════════════════════════════════════════════════════════════

export function buildPromptBrief(
  intent: StoryIntentAnalysis,
  risk: GenerationRiskAnalysis,
  visual: VisualStrategyLite,
  continuityMode: boolean,
): PromptBrief {
  try {
    // 1. Creative brief — 1줄 방향
    const creativeBrief = buildCreativeBrief(intent, visual);

    // 2. Continuity hint — risk 기반 강화
    const continuityHint = buildContinuityHint(risk, continuityMode);

    // 3. Shot discipline — subject/scene risk 기반
    const shotDiscipline = buildShotDiscipline(risk, visual);

    // 4. Subject lock hint
    const subjectLockHint = buildSubjectLockHint(risk, visual);

    // 5. Environment lock hint
    const environmentLockHint = buildEnvironmentLockHint(risk);

    // 6. Avoid list — risk에서 도출, max 5
    const avoidList = buildAvoidList(risk, intent, visual);

    return {
      creativeBrief,
      continuityHint,
      shotDiscipline,
      subjectLockHint,
      environmentLockHint,
      avoidList,
    };
  } catch {
    return SAFE_PROMPT_BRIEF;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Sub-builders
// ═══════════════════════════════════════════════════════════════════

function buildCreativeBrief(intent: StoryIntentAnalysis, visual: VisualStrategyLite): string {
  const parts: string[] = [];

  if (intent.tone !== "neutral") parts.push(intent.tone);
  if (intent.genre !== "general") parts.push(intent.genre);

  // pacing → camera 방향
  if (intent.pacing === "fast" || intent.pacing === "accelerating") {
    parts.push("quick-paced");
  } else if (intent.pacing === "slow" || intent.pacing === "decelerating") {
    parts.push("contemplative pacing");
  }

  // protagonist focus
  if (intent.protagonistFocus === "high") parts.push("protagonist-driven");
  else if (intent.protagonistFocus === "low") parts.push("environment-driven");

  // realism 방향
  if (visual.realismLevel >= 75) parts.push("realistic");
  else if (visual.stylizationLevel >= 75) parts.push("highly stylized");

  return parts.join(", ");
}

function buildContinuityHint(risk: GenerationRiskAnalysis, continuityMode: boolean): string {
  if (continuityMode) {
    // continuity mode ON → 시스템이 이미 처리하지만 보조 신호
    return "continuity system active — reinforce consistent subject and lighting";
  }

  // continuity mode OFF → risk에 따라 힌트
  if (risk.continuityRisk === "high") {
    return "high continuity risk — maintain consistent subject appearance, lighting, and color palette across all cuts";
  }
  if (risk.continuityRisk === "medium") {
    return "maintain visual consistency between adjacent cuts";
  }
  return "";
}

function buildShotDiscipline(risk: GenerationRiskAnalysis, visual: VisualStrategyLite): string {
  const parts: string[] = [];

  if (risk.subjectCountRisk === "high") {
    parts.push("max 2 subjects per cut");
  }
  if (risk.sceneSwitchRisk === "high") {
    parts.push("avoid abrupt location resets between cuts");
  }
  if (visual.visualDensity === "dense") {
    parts.push("simplify compositions — one clear focal point per cut");
  }

  return parts.join("; ");
}

function buildSubjectLockHint(risk: GenerationRiskAnalysis, visual: VisualStrategyLite): string {
  if (visual.characterPriority === "high" || risk.continuityRisk !== "low") {
    return "lock primary subject appearance throughout all cuts";
  }
  return "";
}

function buildEnvironmentLockHint(risk: GenerationRiskAnalysis): string {
  if (risk.sceneSwitchRisk === "high") {
    return "keep environment consistent within scene groups — avoid unnecessary location changes";
  }
  if (risk.sceneSwitchRisk === "medium") {
    return "maintain environment continuity between adjacent cuts";
  }
  return "";
}

function buildAvoidList(
  risk: GenerationRiskAnalysis,
  intent: StoryIntentAnalysis,
  visual: VisualStrategyLite,
): string[] {
  const avoids: string[] = [];

  if (risk.subjectCountRisk !== "low") {
    avoids.push("crowded compositions with more than 3 subjects");
  }
  if (risk.motionComplexityRisk === "high") {
    avoids.push("simultaneous complex motions in single cut");
  }
  if (risk.visualAmbiguityRisk !== "low") {
    avoids.push("abstract metaphorical visuals without concrete anchors");
  }
  if (risk.promptOverloadRisk === "high") {
    avoids.push("overloaded prompts — keep each cut focused on one action");
  }
  if (risk.sceneSwitchRisk === "high") {
    avoids.push("abrupt scene resets without transition cues");
  }

  // realism/stylization 중간 지대 (40-60) → 스타일 모호함 방지
  if (visual.realismLevel >= 40 && visual.realismLevel <= 60) {
    avoids.push("ambiguous realism-stylization mix — commit to either photorealistic or stylized");
  }

  return avoids.slice(0, 5);
}

// ═══════════════════════════════════════════════════════════════════
// Serializer — generate-cuts 프롬프트 주입용
// ═══════════════════════════════════════════════════════════════════

/**
 * PromptBrief → generate-cuts step1 프롬프트에 주입할 텍스트 블록.
 * 빈 필드는 생략. 최대 ~300자 목표.
 */
export function serializePromptBrief(brief: PromptBrief): string {
  if (!brief.creativeBrief && !brief.continuityHint && !brief.shotDiscipline
    && !brief.subjectLockHint && !brief.environmentLockHint
    && brief.avoidList.length === 0) {
    return "";
  }

  const lines: string[] = ["## DEEP ANALYSIS BRIEF (이 분석 결과를 컷 설계에 반영하라)"];

  if (brief.creativeBrief) {
    lines.push(`Direction: ${brief.creativeBrief}`);
  }
  if (brief.continuityHint) {
    lines.push(`Continuity: ${brief.continuityHint}`);
  }
  if (brief.shotDiscipline) {
    lines.push(`Discipline: ${brief.shotDiscipline}`);
  }
  if (brief.subjectLockHint) {
    lines.push(`Subject: ${brief.subjectLockHint}`);
  }
  if (brief.environmentLockHint) {
    lines.push(`Environment: ${brief.environmentLockHint}`);
  }
  if (brief.avoidList.length > 0) {
    lines.push(`Avoid: ${brief.avoidList.join("; ")}`);
  }

  return lines.join("\n");
}
