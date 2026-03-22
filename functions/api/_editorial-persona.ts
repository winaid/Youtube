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

// ═══════════════════════════════════════════════════════════════════
// Editorial Persona → 실제 Cut Planning Rules 변환
// ═══════════════════════════════════════════════════════════════════

const MOTION_DIRECTIVES: Record<string, string> = {
  static: "locked-off static camera, no movement, stillness emphasizes composition",
  minimal: "near-static camera with creeping micro-movements only, no push-in or tracking",
  moderate: "motivated camera movement — one deliberate motion per cut (push-in OR pan OR track)",
  dynamic: "active camera — tracking, push-in, handheld energy, motivated by subject action",
  frenetic: "aggressive rapid camera — whip pans, quick dollies, handheld intensity, jump-cut rhythm",
};

const COMPOSITION_DIRECTIVES: Record<string, string> = {
  centered: "subject dead-center frame, symmetrical negative space, architectural framing",
  "rule-of-thirds": "subject at rule-of-thirds intersection, environmental breathing room",
  symmetrical: "bilateral symmetry, centered vanishing point, geometric precision",
  "dutch-angle": "tilted frame, off-kilter angles, visual unease and energy",
  mixed: "vary composition per cut — alternate centered/thirds/asymmetric",
};

const TRANSITION_DIRECTIVES: Record<string, string> = {
  "hard-cut": "clean hard cuts between shots, no dissolves, editorial precision",
  dissolve: "soft dissolves and fades, lyrical flow between cuts, contemplative rhythm",
  "match-cut": "match-cut on shape/motion/color between consecutive shots",
  "jump-cut": "jump-cut rhythm — abrupt temporal jumps within same subject, editorial energy",
  mixed: "vary transitions — alternate hard-cut / dissolve / match-cut based on beat",
};

const COVERAGE_DIRECTIVES: Record<string, string> = {
  "wide-dominant": "establish-first coverage: open with wide/environment shots, use close-ups sparingly as punctuation",
  "close-dominant": "detail-first coverage: prefer medium/close shots, use wide only for orientation beats",
  balanced: "balanced shot coverage: alternate wide establishing → medium observation → close detail",
  "extreme-contrast": "extreme-contrast coverage: jump directly between wide establishing and extreme close-up, skip medium shots",
};

const INSERT_DIRECTIVES: Record<string, string> = {
  none: "no insert/detail cuts — all cuts focus on primary subject or environment",
  low: "minimal inserts — at most 1 detail/object cut per 5 cuts",
  moderate: "moderate inserts — 1 detail/object cut per 3-4 cuts for visual punctuation",
  high: "high insert frequency — 1 detail/object/texture cut per 2-3 cuts, shadow/surface/prop emphasis",
};

export function buildEditorialPlanningRules(ep: EditorialPersona): string {
  const lines: string[] = [
    "### EDITORIAL PLANNING RULES (편집 의사결정 — 모든 컷에 적용)",
  ];
  lines.push(`- CUT PACE: prefer ${ep.preferredCutPace[0]}-${ep.preferredCutPace[1]}s per cut. ` +
    (ep.preferredCutPace[1] <= 4
      ? "Short rapid cuts — each cut = ONE visual idea, ONE action."
      : ep.preferredCutPace[0] >= 5
        ? "Measured deliberate cuts — allow visual development within each cut."
        : "Balanced cadence — neither rushed nor lingering."));
  lines.push(`- COVERAGE: ${COVERAGE_DIRECTIVES[ep.preferredCoverage] || COVERAGE_DIRECTIVES.balanced}`);
  lines.push(`- INSERTS: ${INSERT_DIRECTIVES[ep.insertBias] || INSERT_DIRECTIVES.moderate}`);
  lines.push(`- CAMERA MOTION: ${MOTION_DIRECTIVES[ep.motionBias] || MOTION_DIRECTIVES.moderate}`);
  lines.push(`- COMPOSITION: ${COMPOSITION_DIRECTIVES[ep.compositionBias] || COMPOSITION_DIRECTIVES.mixed}`);
  lines.push(`- TRANSITION RHYTHM: ${TRANSITION_DIRECTIVES[ep.transitionBias] || TRANSITION_DIRECTIVES["hard-cut"]}`);
  lines.push("- ⚠️ GUARD: editorial persona does NOT override cut complexity budget — max 1 subject, 1 action, 1 camera motion per cut.");
  return lines.join("\n");
}

/**
 * Editorial persona → 짧은 운영 규칙 요약 (compact/degraded/step2-3 재강조용).
 * extreme token pressure에서도 살아남는 1-2줄 요약.
 */
export function buildCompactEditorialSummary(ep: EditorialPersona): string {
  const paceTag = ep.preferredCutPace[1] <= 4
    ? "short punctuation cuts"
    : ep.preferredCutPace[0] >= 5
      ? "measured deliberate cuts"
      : "balanced cadence";
  const coverTag = ep.preferredCoverage === "wide-dominant" ? "establish-led"
    : ep.preferredCoverage === "close-dominant" ? "detail-led"
    : ep.preferredCoverage === "extreme-contrast" ? "extreme-contrast coverage"
    : "balanced coverage";
  const insertTag = ep.insertBias === "high" ? "high inserts"
    : ep.insertBias === "low" ? "minimal inserts"
    : ep.insertBias === "none" ? "no inserts"
    : "moderate inserts";
  const motionTag = ep.motionBias === "static" ? "static camera"
    : ep.motionBias === "minimal" ? "near-static camera"
    : ep.motionBias === "frenetic" ? "frenetic camera"
    : ep.motionBias === "dynamic" ? "active camera"
    : "motivated camera";
  const transTag = ep.transitionBias === "dissolve" ? "soft dissolves"
    : ep.transitionBias === "jump-cut" ? "jump-cut rhythm"
    : ep.transitionBias === "match-cut" ? "match-cut flow"
    : ep.transitionBias === "mixed" ? "varied transitions"
    : "hard cuts";

  return `[EDITORIAL: ${paceTag}, ${coverTag}, ${insertTag}, ${motionTag}, ${transTag}]`;
}

export function buildDurationAwareBeatTemplate(
  secPerCut: number,
  _ep?: EditorialPersona,
): { beatTemplate: string; extendBeatTemplate: string } {
  // 가드: 0 이하/NaN 방지
  if (!secPerCut || secPerCut <= 0 || !Number.isFinite(secPerCut)) {
    return {
      beatTemplate: "0s-3s:[single visual focus — fallback]",
      extendBeatTemplate: "0s-3s:[continue from previous — fallback]",
    };
  }
  if (secPerCut <= 3) {
    return {
      beatTemplate: `0s-${secPerCut}s:[single visual focus — one subject, one action, one framing]`,
      extendBeatTemplate: `0s-${secPerCut}s:[continue from prev — single new visual element]`,
    };
  }
  if (secPerCut <= 4) {
    return {
      beatTemplate: `0s-${Math.ceil(secPerCut / 2)}s:[start — establish visual anchor]. ${Math.ceil(secPerCut / 2)}s-${secPerCut}s:[resolve — complete the visual idea]`,
      extendBeatTemplate: `0s-${Math.ceil(secPerCut / 2)}s:[prev→transition]. ${Math.ceil(secPerCut / 2)}s-${secPerCut}s:[new scene settles]`,
    };
  }
  if (secPerCut <= 5) {
    const mid = Math.ceil(secPerCut * 0.4);
    return {
      beatTemplate: `0s-${mid}s:[start — visual anchor]. ${mid}s-${secPerCut}s:[develop — action unfolds]`,
      extendBeatTemplate: `0s-${mid}s:[prev→transition]. ${mid}s-${secPerCut}s:[new scene develops]`,
    };
  }
  const b1 = Math.ceil(secPerCut * 0.25);
  const b2 = Math.ceil(secPerCut * 0.6);
  return {
    beatTemplate: `0s-${b1}s:[start]. ${b1}s-${b2}s:[develop]. ${b2}s-${secPerCut}s:[climax]`,
    extendBeatTemplate: `0s-${b1}s:[prev→trans]. ${b1}s-${b2}s:[new scene]. ${b2}s-${secPerCut}s:[settle]`,
  };
}
