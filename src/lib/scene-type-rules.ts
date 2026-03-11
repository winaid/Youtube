/**
 * scene-type-rules.ts — 씬 타입별 어휘 허용/금지 규칙
 *
 * 모든 generation path에서 공통으로 적용.
 * 특정 장면 전용이 아닌 시스템 전역 규칙.
 */

// ═══════════════════════════════════════════════════════════════════
// 1. Scene Type 정의
// ═══════════════════════════════════════════════════════════════════

export type SceneType =
  | "environment"
  | "crowd"
  | "person"
  | "battle"
  | "map_visualization"
  | "product"
  | "portrait"
  | "character-driven"
  | "object-detail"
  | "transition-atmosphere";

// ═══════════════════════════════════════════════════════════════════
// 2. 씬 타입별 금지 어휘 (ban list)
// ═══════════════════════════════════════════════════════════════════

export interface SceneTypeRule {
  /** 금지 어휘 정규식 목록 — 매치되면 제거 또는 대체 */
  banned: RegExp[];
  /** 금지 어휘 대체 맵 — 단순 제거 대신 안전한 대체어 사용 */
  replacements: Array<{ pattern: RegExp; replacement: string }>;
  /** 허용 카메라 프레이밍 (이 외에는 downgrade) */
  allowedFramings?: string[];
  /** 허용 카메라 모션 패턴 */
  allowedMotionPattern?: RegExp;
  /** 필수 포함 어휘 패턴 (없으면 추가) */
  requiredElements?: Array<{ check: RegExp; fallback: string }>;
}

const SCENE_RULES: Record<string, SceneTypeRule> = {
  environment: {
    banned: [
      /\bsoldiers?\b/gi,
      /\bclose[\s-]?up\s+face\b/gi,
      /\bmedium\s+portrait\b/gi,
      /\bcharacter[\s-]?focused\b/gi,
      /\bcharacter[\s-]?driven\b/gi,
      /\bface\s+detail\b/gi,
      /\bfacial\s+expression\b/gi,
      /\bperson\s+center[\s-]?frame\b/gi,
      /\bOTS\b/g,
      /\bover[\s-]?the[\s-]?shoulder\b/gi,
    ],
    replacements: [
      { pattern: /\bsoldiers?\s+march(?:ing)?\b/gi, replacement: "distant figures moving across terrain" },
      { pattern: /\bsoldiers?\s+stand(?:ing)?\b/gi, replacement: "distant silhouettes on the horizon" },
      { pattern: /\bsoldiers?\b/gi, replacement: "distant figures" },
      { pattern: /\bclose[\s-]?up\s+face\b/gi, replacement: "environmental detail" },
      { pattern: /\bmedium\s+portrait\b/gi, replacement: "wide environmental composition" },
      { pattern: /\bcharacter[\s-]?focused\b/gi, replacement: "environment-focused" },
    ],
    allowedFramings: ["WS", "LS", "MLS"],
    allowedMotionPattern: /\b(slow|gentle|smooth|gradual|floating|subtle|drone|flyover|aerial|sweep|orbit|crane|drift|pull[\s-]?back|push[\s-]?in|pan|tilt)\b/i,
    requiredElements: [
      { check: /\b(sky|cloud|sun|moon|star|dawn|dusk|twilight|overcast|clear\s+sky)\b/i, fallback: "overcast sky with diffused light" },
      { check: /\b(light|sunlight|moonlight|golden\s+hour|blue\s+hour|shadow|illuminat|backlit|sidelit)\b/i, fallback: "soft natural light from above" },
      { check: /\b(haze|fog|mist|dust|smoke|particle|vapor|steam|atmosphere|atmospheric)\b/i, fallback: "subtle atmospheric haze" },
      { check: /\b(ground|floor|terrain|soil|rock|grass|sand|concrete|stone|asphalt|cobble|gravel|pave)\b/i, fallback: "textured ground surface" },
      { check: /\b(scale|vast|expansive|stretching|towering|immense|panoramic|sprawling|depth)\b/i, fallback: "sense of vast scale" },
    ],
  },

  crowd: {
    banned: [
      /\bindividual\s+face\s+detail\b/gi,
      /\bsingle\s+person\s+portrait\b/gi,
      /\bclose[\s-]?up\s+(?:on\s+)?(?:one|single|individual)\b/gi,
      /\bECU\b/g,
    ],
    replacements: [
      { pattern: /\bindividual\s+face\b/gi, replacement: "mass of faces" },
      { pattern: /\bsingle\s+person\b/gi, replacement: "crowd movement" },
    ],
    allowedFramings: ["WS", "LS", "MLS", "MS"],
    requiredElements: [
      { check: /\b(mass|crowd|group|swarm|throng|multitude|gathering|assembly)\b/i, fallback: "crowd in collective motion" },
    ],
  },

  map_visualization: {
    banned: [
      /\blandscape\s+photograph\b/gi,
      /\breal\s+terrain\b/gi,
      /\bphotograph(?:ic|y)?\s+of\b/gi,
      /\blive[\s-]?action\s+landscape\b/gi,
      /\breal[\s-]?world\s+footage\b/gi,
      /\bdrone\s+footage\b/gi,
      /\bcharacter\b/gi,
      /\bperson\b/gi,
      /\bface\b/gi,
    ],
    replacements: [
      { pattern: /\breal\s+terrain\b/gi, replacement: "map terrain surface" },
      { pattern: /\blandscape\s+photograph\b/gi, replacement: "map visualization" },
      { pattern: /\bdrone\s+footage\b/gi, replacement: "aerial map view" },
    ],
    allowedFramings: ["WS", "LS"],
    requiredElements: [],
  },

  product: {
    banned: [
      /\bcharacter\s+action\b/gi,
      /\bbattle\b/gi,
      /\bfight(?:ing)?\b/gi,
    ],
    replacements: [],
    allowedFramings: ["CU", "MCU", "ECU", "MS"],
    requiredElements: [
      { check: /\b(texture|material|surface|finish|sheen|matte|gloss)\b/i, fallback: "product surface texture detail" },
    ],
  },

  portrait: {
    banned: [
      /\bwide\s+establishing\b/gi,
      /\baerial\s+flyover\b/gi,
      /\bdrone\s+shot\b/gi,
    ],
    replacements: [],
    allowedFramings: ["CU", "MCU", "MS", "ECU"],
    requiredElements: [],
  },

  battle: {
    banned: [
      /\bpeaceful\b/gi,
      /\bserene\b/gi,
      /\btranquil\b/gi,
    ],
    replacements: [],
    requiredElements: [],
  },

  person: {
    banned: [],
    replacements: [],
    requiredElements: [],
  },

  "character-driven": {
    banned: [],
    replacements: [],
    requiredElements: [],
  },

  "object-detail": {
    banned: [
      /\bwide\s+establishing\b/gi,
      /\baerial\b/gi,
    ],
    replacements: [],
    allowedFramings: ["CU", "MCU", "ECU", "MS"],
    requiredElements: [
      { check: /\b(texture|material|surface|grain|finish|detail)\b/i, fallback: "detailed surface texture" },
    ],
  },

  "transition-atmosphere": {
    banned: [],
    replacements: [],
    requiredElements: [],
  },
};

// ═══════════════════════════════════════════════════════════════════
// 3. 씬 타입 매핑 (shotCategory → SceneType)
// ═══════════════════════════════════════════════════════════════════

const SHOT_CATEGORY_MAP: Record<string, SceneType> = {
  "environment": "environment",
  "crowd": "crowd",
  "person": "person",
  "character-driven": "character-driven",
  "battle": "battle",
  "map-graphic": "map_visualization",
  "map_visualization": "map_visualization",
  "product": "product",
  "portrait": "portrait",
  "object-detail": "object-detail",
  "transition-atmosphere": "transition-atmosphere",
};

export function resolveSceneType(shotCategory?: string): SceneType | null {
  if (!shotCategory) return null;
  return SHOT_CATEGORY_MAP[shotCategory] ?? null;
}

export function getSceneTypeRule(sceneType: SceneType): SceneTypeRule {
  return SCENE_RULES[sceneType] ?? SCENE_RULES["person"];
}

// ═══════════════════════════════════════════════════════════════════
// 4. 어휘 필터링 함수
// ═══════════════════════════════════════════════════════════════════

export interface VocabularyFilterResult {
  text: string;
  removals: string[];
  replacements: string[];
  framingChange?: { from: string; to: string };
}

/**
 * 씬 타입별 어휘 필터링 적용.
 * 금지 어휘를 제거/대체하고, 프레이밍을 제한.
 */
export function applySceneTypeVocabularyRules(
  text: string,
  sceneType: SceneType,
  framing?: string,
): VocabularyFilterResult {
  const rule = getSceneTypeRule(sceneType);
  const removals: string[] = [];
  const replacementLog: string[] = [];
  let result = text;

  // 1. 대체 어휘 적용 (단순 제거보다 우선)
  for (const { pattern, replacement } of rule.replacements) {
    const matches = result.match(pattern);
    if (matches) {
      result = result.replace(pattern, replacement);
      replacementLog.push(`"${matches[0]}" → "${replacement}"`);
    }
  }

  // 2. 남은 금지 어휘 제거
  for (const banned of rule.banned) {
    const matches = result.match(banned);
    if (matches) {
      result = result.replace(banned, "");
      for (const m of matches) removals.push(m);
    }
  }

  // 3. 프레이밍 제한
  let framingChange: { from: string; to: string } | undefined;
  if (framing && rule.allowedFramings) {
    const upper = framing.toUpperCase();
    if (!rule.allowedFramings.includes(upper)) {
      const defaultFraming = rule.allowedFramings[0];
      framingChange = { from: upper, to: defaultFraming };
    }
  }

  // 정리
  result = result
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { text: result, removals, replacements: replacementLog, framingChange };
}

/**
 * 씬 타입별 필수 요소 확인 및 보충.
 * 부족한 descriptive coverage를 감지하고 보충 텍스트를 반환.
 */
export function ensureDescriptiveCoverage(
  text: string,
  sceneType: SceneType,
): { additions: string[]; coverage: number; total: number } {
  const rule = getSceneTypeRule(sceneType);
  if (!rule.requiredElements || rule.requiredElements.length === 0) {
    return { additions: [], coverage: 0, total: 0 };
  }

  const additions: string[] = [];
  let covered = 0;

  for (const { check, fallback } of rule.requiredElements) {
    if (check.test(text)) {
      covered++;
    } else {
      additions.push(fallback);
    }
  }

  return {
    additions,
    coverage: covered,
    total: rule.requiredElements.length,
  };
}
