/**
 * analysis-orchestrator.ts — Deep Analysis standard-lite orchestrator
 *
 * 얇은 조립층. 불필요한 추상화 금지.
 * 부분 실패 허용. 전체 실패 시 safe defaults 반환.
 */

import type { DeepAnalysisOptions, DeepAnalysisResult } from "./types";
import { analyzeStoryIntent, SAFE_STORY_INTENT } from "./analyze-story-intent";
import { analyzeGenerationRisk, SAFE_GENERATION_RISK } from "./analyze-generation-risk";
import { analyzeVisualStrategy, SAFE_VISUAL_STRATEGY } from "./analyze-visual-strategy";
import { buildPromptBrief, SAFE_PROMPT_BRIEF } from "./build-prompt-brief";

// ═══════════════════════════════════════════════════════════════════
// Safe Defaults — 전체 실패 시
// ═══════════════════════════════════════════════════════════════════

export const SAFE_ANALYSIS_RESULT: DeepAnalysisResult = {
  storyIntent: SAFE_STORY_INTENT,
  generationRisk: SAFE_GENERATION_RISK,
  visualStrategy: SAFE_VISUAL_STRATEGY,
  promptBrief: SAFE_PROMPT_BRIEF,
  analysisMs: 0,
  warnings: ["deep analysis skipped — using safe defaults"],
};

// ═══════════════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════════════

/**
 * Deep Analysis standard-lite 실행.
 *
 * 동작:
 * 1. story intent 분석
 * 2. generation risk 분석
 * 3. visual strategy lite 분석
 * 4. prompt brief 조립
 *
 * 부분 실패 시 해당 단계만 safe default로 대체.
 * 전체 실패 시 SAFE_ANALYSIS_RESULT 반환.
 */
export function runDeepAnalysis(options: DeepAnalysisOptions): DeepAnalysisResult {
  const t0 = Date.now();
  const warnings: string[] = [];

  try {
    // 1. Story intent
    let storyIntent = SAFE_STORY_INTENT;
    try {
      storyIntent = analyzeStoryIntent(
        options.storyText,
        options.totalDurationSec,
        options.cutCount,
      );
    } catch (e) {
      warnings.push(`story-intent failed: ${e instanceof Error ? e.message : "unknown"}`);
    }

    // 2. Generation risk
    let generationRisk = SAFE_GENERATION_RISK;
    try {
      generationRisk = analyzeGenerationRisk(
        options.storyText,
        options.totalDurationSec,
        options.cutCount,
        options.characterCount ?? 1,
        options.continuityMode ?? false,
      );
    } catch (e) {
      warnings.push(`generation-risk failed: ${e instanceof Error ? e.message : "unknown"}`);
    }

    // 3. Visual strategy lite
    let visualStrategy = SAFE_VISUAL_STRATEGY;
    try {
      visualStrategy = analyzeVisualStrategy(
        options.storyText,
        options.totalDurationSec,
        options.cutCount,
        options.animationMode,
        options.directorStyle,
      );
    } catch (e) {
      warnings.push(`visual-strategy failed: ${e instanceof Error ? e.message : "unknown"}`);
    }

    // 4. Prompt brief 조립
    let promptBrief = SAFE_PROMPT_BRIEF;
    try {
      promptBrief = buildPromptBrief(
        storyIntent,
        generationRisk,
        visualStrategy,
        options.continuityMode ?? false,
      );
    } catch (e) {
      warnings.push(`prompt-brief failed: ${e instanceof Error ? e.message : "unknown"}`);
    }

    return {
      storyIntent,
      generationRisk,
      visualStrategy,
      promptBrief,
      analysisMs: Date.now() - t0,
      warnings,
    };
  } catch {
    return {
      ...SAFE_ANALYSIS_RESULT,
      analysisMs: Date.now() - t0,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Re-exports for convenience
// ═══════════════════════════════════════════════════════════════════

export { serializePromptBrief } from "./build-prompt-brief";
export type {
  DeepAnalysisOptions,
  DeepAnalysisResult,
  StoryIntentAnalysis,
  GenerationRiskAnalysis,
  VisualStrategyLite,
  PromptBrief,
} from "./types";
