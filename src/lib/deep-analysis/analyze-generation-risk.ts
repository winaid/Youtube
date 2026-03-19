/**
 * analyze-generation-risk.ts — 생성 리스크 분석
 *
 * 생성 모델이 흔들릴 가능성이 높은 지점을 사전 감지.
 * 과대평가 금지, 경고 신호는 분명하게.
 */

import type { GenerationRiskAnalysis, RiskLevel } from "./types";

// ═══════════════════════════════════════════════════════════════════
// Safe Defaults
// ═══════════════════════════════════════════════════════════════════

export const SAFE_GENERATION_RISK: GenerationRiskAnalysis = {
  continuityRisk: "medium",
  subjectCountRisk: "low",
  sceneSwitchRisk: "medium",
  motionComplexityRisk: "low",
  promptOverloadRisk: "low",
  visualAmbiguityRisk: "low",
  mitigationNotes: [],
};

// ═══════════════════════════════════════════════════════════════════
// Analysis
// ═══════════════════════════════════════════════════════════════════

export function analyzeGenerationRisk(
  storyText: string,
  totalDurationSec: number,
  cutCount: number,
  characterCount: number,
  continuityMode: boolean,
): GenerationRiskAnalysis {
  try {
    if (!storyText || storyText.trim().length < 10) return SAFE_GENERATION_RISK;

    const text = storyText.trim();
    const mitigationNotes: string[] = [];

    // 1. Continuity risk
    const continuityRisk = assessContinuityRisk(totalDurationSec, cutCount, continuityMode);
    if (continuityRisk === "high") {
      mitigationNotes.push("lock subject appearance and lighting across all cuts");
    }

    // 2. Subject count risk
    const subjectCountRisk = assessSubjectCountRisk(text, characterCount);
    if (subjectCountRisk === "high") {
      mitigationNotes.push("limit to max 2 subjects per cut to prevent confusion");
    }

    // 3. Scene switch risk
    const sceneSwitchRisk = assessSceneSwitchRisk(text, cutCount);
    if (sceneSwitchRisk === "high") {
      mitigationNotes.push("group related scenes and avoid abrupt location resets");
    }

    // 4. Motion complexity risk
    const motionComplexityRisk = assessMotionComplexityRisk(text);

    // 5. Prompt overload risk
    const promptOverloadRisk = assessPromptOverloadRisk(text, cutCount);

    // 6. Visual ambiguity risk
    const visualAmbiguityRisk = assessVisualAmbiguityRisk(text);

    return {
      continuityRisk,
      subjectCountRisk,
      sceneSwitchRisk,
      motionComplexityRisk,
      promptOverloadRisk,
      visualAmbiguityRisk,
      mitigationNotes: mitigationNotes.slice(0, 3),
    };
  } catch {
    return SAFE_GENERATION_RISK;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Risk Assessors
// ═══════════════════════════════════════════════════════════════════

function assessContinuityRisk(
  totalDurationSec: number,
  cutCount: number,
  continuityMode: boolean,
): RiskLevel {
  // continuity mode ON이면 시스템이 처리 → 위험 낮아짐
  if (continuityMode) return "low";
  // 긴 영상 + 많은 컷 = 독립 생성 시 불일치 위험
  if (totalDurationSec > 60 && cutCount > 6) return "high";
  if (totalDurationSec > 30 && cutCount > 4) return "medium";
  return "low";
}

function assessSubjectCountRisk(text: string, characterCount: number): RiskLevel {
  // 텍스트에서 추가 인물 감지
  const personSignals = /그리고\s*(또\s*다른|다른|새로운)|meanwhile|another character|새 인물|등장인물/gi;
  const extraPersons = (text.match(personSignals) || []).length;
  const total = characterCount + extraPersons;

  if (total > 4) return "high";
  if (total > 2) return "medium";
  return "low";
}

function assessSceneSwitchRisk(text: string, cutCount: number): RiskLevel {
  // 장소 전환 신호
  const locationSwitches = /한편|그런데|다른\s*곳|meanwhile|elsewhere|장소\s*변경|이동|떠나/gi;
  const switches = (text.match(locationSwitches) || []).length;
  const switchDensity = cutCount > 0 ? switches / cutCount : 0;

  if (switchDensity > 0.6) return "high";
  if (switchDensity > 0.3 || switches > 3) return "medium";
  return "low";
}

function assessMotionComplexityRisk(text: string): RiskLevel {
  const complexMotion = /폭발|추격|전투|날아|떨어지|회전|격투|explosion|chase|battle|flying|falling|spinning|fight/gi;
  const matches = (text.match(complexMotion) || []).length;

  if (matches > 4) return "high";
  if (matches > 2) return "medium";
  return "low";
}

function assessPromptOverloadRisk(text: string, cutCount: number): RiskLevel {
  // 텍스트가 길면 컷당 정보량이 과다
  const charsPerCut = cutCount > 0 ? text.length / cutCount : text.length;

  if (charsPerCut > 300) return "high";
  if (charsPerCut > 150) return "medium";
  return "low";
}

function assessVisualAmbiguityRisk(text: string): RiskLevel {
  // 추상적/모호한 표현 감지
  const abstractSignals = /개념|느낌|분위기|추상|비유|상징|concept|feeling|atmosphere|abstract|metaphor|symbolic/gi;
  const matches = (text.match(abstractSignals) || []).length;

  if (matches > 4) return "high";
  if (matches > 2) return "medium";
  return "low";
}
