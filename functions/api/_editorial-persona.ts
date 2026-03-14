/**
 * _editorial-persona.ts — 감독 페르소나에서 편집 운영 규칙 추출 (서버 함수용)
 *
 * 클라이언트는 @/lib/editorial-persona.ts 사용.
 * 서버 함수(Cloudflare Pages Functions)는 이 파일에서 import.
 *
 * 로직은 src/lib/editorial-persona.ts와 동일.
 */

// ═══════════════════════════════════════════════════════════════════
// EditorialPersona type (inline — server can't import from @/types)
// ═══════════════════════════════════════════════════════════════════

export interface EditorialPersona {
  preferredCutPace: [number, number];
  preferredCoverage: "wide-dominant" | "close-dominant" | "balanced" | "extreme-contrast";
  insertBias: "none" | "low" | "moderate" | "high";
  motionBias: "static" | "minimal" | "moderate" | "dynamic" | "frenetic";
  compositionBias: "centered" | "rule-of-thirds" | "symmetrical" | "dutch-angle" | "mixed";
  transitionBias: "hard-cut" | "dissolve" | "match-cut" | "jump-cut" | "mixed";
}

const DEFAULT_EDITORIAL_PERSONA: EditorialPersona = {
  preferredCutPace: [3, 5],
  preferredCoverage: "balanced",
  insertBias: "moderate",
  motionBias: "moderate",
  compositionBias: "mixed",
  transitionBias: "hard-cut",
};

const EDITORIAL_PERSONA_PRESETS: Record<string, EditorialPersona> = {
  "gothic-macabre": {
    preferredCutPace: [3, 5],
    preferredCoverage: "extreme-contrast",
    insertBias: "high",
    motionBias: "minimal",
    compositionBias: "symmetrical",
    transitionBias: "dissolve",
  },
  "symmetrical-formalist": {
    preferredCutPace: [4, 6],
    preferredCoverage: "wide-dominant",
    insertBias: "low",
    motionBias: "static",
    compositionBias: "symmetrical",
    transitionBias: "hard-cut",
  },
  "propulsive-action": {
    preferredCutPace: [2, 4],
    preferredCoverage: "close-dominant",
    insertBias: "high",
    motionBias: "frenetic",
    compositionBias: "dutch-angle",
    transitionBias: "jump-cut",
  },
  "lyrical-atmospheric": {
    preferredCutPace: [4, 6],
    preferredCoverage: "wide-dominant",
    insertBias: "moderate",
    motionBias: "minimal",
    compositionBias: "rule-of-thirds",
    transitionBias: "dissolve",
  },
};

// ═══════════════════════════════════════════════════════════════════
// Keyword → preset mapping
// ═══════════════════════════════════════════════════════════════════

const KEYWORD_MAP: [RegExp, string][] = [
  [/gothic|macabre|burton|horror|dark\s*whims/i, "gothic-macabre"],
  [/symmetr|formalis|anderson|kubrick|centered/i, "symmetrical-formalist"],
  [/action|propulsive|michael\s*bay|mad\s*max|fast[-\s]?cut|frenetic/i, "propulsive-action"],
  [/lyrical|atmospheric|terrence|malick|tarkovsky|ethereal|meditat/i, "lyrical-atmospheric"],
];

export function extractEditorialPersona(
  directorPersona?: string,
  directorStyle?: string,
  editingStyle?: string,
): EditorialPersona {
  const combined = [directorPersona, directorStyle, editingStyle]
    .filter(Boolean)
    .join(" ");

  if (!combined) return { ...DEFAULT_EDITORIAL_PERSONA };

  for (const [pattern, presetKey] of KEYWORD_MAP) {
    if (pattern.test(combined)) {
      const preset = EDITORIAL_PERSONA_PRESETS[presetKey];
      if (preset) return { ...preset };
    }
  }

  const result = { ...DEFAULT_EDITORIAL_PERSONA };

  if (/rapid|fast|quick|short/i.test(combined)) {
    result.preferredCutPace = [2, 4];
    result.motionBias = "dynamic";
  } else if (/slow|long|contemplat|lingering/i.test(combined)) {
    result.preferredCutPace = [5, 7];
    result.motionBias = "minimal";
  }

  if (/insert|detail|close-up|macro/i.test(combined)) {
    result.insertBias = "high";
  }

  if (/wide|panoram|landscape|establishing/i.test(combined)) {
    result.preferredCoverage = "wide-dominant";
  }

  return result;
}

export function editorialPaceMidpoint(ep: EditorialPersona): number {
  return Math.round((ep.preferredCutPace[0] + ep.preferredCutPace[1]) / 2);
}
