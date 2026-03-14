/**
 * editorial-persona.ts — 감독 페르소나에서 편집 운영 규칙 추출
 *
 * 감독 이름/스타일/SignatureTechniques에서 EditorialPersona를 매핑.
 * 매핑 실패 시 DEFAULT_EDITORIAL_PERSONA 반환.
 */

import {
  type EditorialPersona,
  DEFAULT_EDITORIAL_PERSONA,
  EDITORIAL_PERSONA_PRESETS,
} from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Keyword → preset mapping
// ═══════════════════════════════════════════════════════════════════

const KEYWORD_MAP: [RegExp, string][] = [
  [/gothic|macabre|burton|horror|dark\s*whims/i, "gothic-macabre"],
  [/symmetr|formalis|anderson|kubrick|centered/i, "symmetrical-formalist"],
  [/action|propulsive|michael\s*bay|mad\s*max|fast[-\s]?cut|frenetic/i, "propulsive-action"],
  [/lyrical|atmospheric|terrence|malick|tarkovsky|ethereal|meditat/i, "lyrical-atmospheric"],
];

/**
 * 감독 스타일 정보에서 EditorialPersona를 추출한다.
 *
 * @param directorPersona - 감독 설명 텍스트 (persona field)
 * @param directorStyle - 스타일 짧은 설명
 * @param editingStyle - SignatureTechniques.editingStyle
 * @returns EditorialPersona
 */
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

  // ── Heuristic fallback: editingStyle에서 pace 힌트 추출 ──
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

/**
 * EditorialPersona의 preferredCutPace 중앙값을 반환.
 * duration 기본값 결정에 사용.
 */
export function editorialPaceMidpoint(ep: EditorialPersona): number {
  return Math.round((ep.preferredCutPace[0] + ep.preferredCutPace[1]) / 2);
}
