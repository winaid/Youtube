/**
 * analyze-visual-strategy.ts — 시각 전략 lite
 *
 * 최소 수준의 시각 방향성만 도출.
 * shot density, camera energy, realism/stylization 정도만 가볍게.
 * 영화이론식 과설계 금지.
 */

import type { VisualStrategyLite, DensityLevel, EnergyLevel } from "./types";

// ═══════════════════════════════════════════════════════════════════
// Safe Defaults
// ═══════════════════════════════════════════════════════════════════

export const SAFE_VISUAL_STRATEGY: VisualStrategyLite = {
  visualDensity: "moderate",
  cameraEnergy: "moderate",
  realismLevel: 60,
  stylizationLevel: 40,
  characterPriority: "medium",
  environmentPriority: "medium",
};

// ═══════════════════════════════════════════════════════════════════
// Style Mode → Realism/Stylization 매핑
// ═══════════════════════════════════════════════════════════════════

const REALISM_MAP: Record<string, number> = {
  // live-action 계열
  "live-action": 90, "cinematic": 85, "photorealistic": 95,
  "docu-illustrated": 70, "live-paint-overlay": 50,
  // animation 계열
  "tv-anime": 20, "anime-movie": 25, "ghibli": 30,
  "disney-3d": 35, "pixar": 35,
  "cel-shaded": 15, "2d-classic": 15,
  // stop-motion
  "stop-motion": 40, "claymation": 35,
  // experimental
  "rotoscoping": 55, "mixed-media-collage": 30,
  "2d-3d-hybrid": 45, "surreal-composite": 25,
  // retro
  "pixel-art": 10, "vhs-retro": 50,
};

// ═══════════════════════════════════════════════════════════════════
// Analysis
// ═══════════════════════════════════════════════════════════════════

export function analyzeVisualStrategy(
  storyText: string,
  totalDurationSec: number,
  cutCount: number,
  animationMode?: string,
  directorStyle?: string,
): VisualStrategyLite {
  try {
    if (!storyText || storyText.trim().length < 10) return SAFE_VISUAL_STRATEGY;

    const text = storyText.trim();

    // Realism / Stylization
    const realism = inferRealismLevel(animationMode, directorStyle);
    const stylization = 100 - realism;

    // Visual density — 텍스트 정보량 + cutCount 기반
    const visualDensity = inferVisualDensity(text, cutCount);

    // Camera energy — pacing + action 키워드 기반
    const cameraEnergy = inferCameraEnergy(text, totalDurationSec, cutCount);

    // Character vs Environment priority
    const { characterPriority, environmentPriority } = inferPriorities(text);

    return {
      visualDensity,
      cameraEnergy,
      realismLevel: realism,
      stylizationLevel: stylization,
      characterPriority,
      environmentPriority,
    };
  } catch {
    return SAFE_VISUAL_STRATEGY;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function inferRealismLevel(animationMode?: string, directorStyle?: string): number {
  if (animationMode) {
    const key = animationMode.toLowerCase();
    // 정확 매치
    if (REALISM_MAP[key] !== undefined) return REALISM_MAP[key];
    // 부분 매치
    for (const [k, v] of Object.entries(REALISM_MAP)) {
      if (key.includes(k) || k.includes(key)) return v;
    }
  }

  // director style 키워드 기반 보정
  if (directorStyle) {
    const ds = directorStyle.toLowerCase();
    if (/realistic|photorealistic|cinematic|live.action/i.test(ds)) return 85;
    if (/anime|cartoon|animated|stylized/i.test(ds)) return 25;
  }

  return 60; // 기본: 약간 사실주의 쪽
}

function inferVisualDensity(text: string, cutCount: number): DensityLevel {
  const sentences = text.split(/[.!?。\n]+/).filter(s => s.trim().length > 3);
  const sentencesPerCut = cutCount > 0 ? sentences.length / cutCount : sentences.length;

  if (sentencesPerCut > 4) return "dense";
  if (sentencesPerCut > 2) return "moderate";
  return "sparse";
}

function inferCameraEnergy(text: string, totalDurationSec: number, cutCount: number): EnergyLevel {
  const actionWords = /달리|뛰|폭발|추격|싸우|날아|빠르|격렬|run|chase|explode|fight|fast|rapid|intense/gi;
  const calmWords = /천천히|고요|평화|정적|바라보|서있|slowly|quietly|peaceful|static|gazing|standing/gi;

  const actionCount = (text.match(actionWords) || []).length;
  const calmCount = (text.match(calmWords) || []).length;

  // 컷당 시간이 짧으면 dynamic
  const secPerCut = cutCount > 0 ? totalDurationSec / cutCount : totalDurationSec;

  if (actionCount > calmCount * 2 || secPerCut < 5) return "dynamic";
  if (calmCount > actionCount * 2 || secPerCut > 10) return "calm";
  return "moderate";
}

function inferPriorities(text: string): {
  characterPriority: "high" | "medium" | "low";
  environmentPriority: "high" | "medium" | "low";
} {
  const charSignals = /인물|캐릭터|주인공|그[녀는가]|얼굴|표정|character|protagonist|face|expression/gi;
  const envSignals = /풍경|도시|자연|건물|하늘|바다|산|landscape|city|nature|building|sky|ocean|mountain/gi;

  const charCount = (text.match(charSignals) || []).length;
  const envCount = (text.match(envSignals) || []).length;

  const charPriority: "high" | "medium" | "low" =
    charCount > envCount * 2 ? "high" : charCount > envCount ? "medium" : "low";
  const envPriority: "high" | "medium" | "low" =
    envCount > charCount * 2 ? "high" : envCount > charCount ? "medium" : "low";

  // 둘 다 low면 medium으로 보정
  if (charPriority === "low" && envPriority === "low") {
    return { characterPriority: "medium", environmentPriority: "medium" };
  }

  return { characterPriority: charPriority, environmentPriority: envPriority };
}
