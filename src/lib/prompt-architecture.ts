/**
 * 범용 6계층 프롬프트 아키텍처 (Prompt Architecture v2)
 *
 * 모든 영상 프롬프트는 이 순서를 따름:
 *   A. SUBJECT ANCHOR — 핵심 피사체 고정 (첫 문장)
 *   B. SCENE STRUCTURE — 카메라가 보는 공간/표면/구도
 *   C. VISUAL DETAILS — 재질, 색, 조명, 렌즈 (subject/scene 확정 후)
 *   D. ACTION / TEMPORAL — 시간축 변화 (subject를 벗어나지 않음)
 *   E. CONTINUITY CONSTRAINTS — 이전 컷 객체/상태 유지
 *   F. NEGATIVE CONSTRAINTS — 실패 패턴 차단
 *
 * 스타일/무드 표현은 F 직전, subject/scene/action 완성 후에만 약하게 부가.
 */

// ─────────────────────────────────────────────────────────────────
// 1. 장르별 템플릿 (Genre Templates)
// ─────────────────────────────────────────────────────────────────

export interface GenreTemplate {
  id: string;
  subjectAnchorExample: string;
  sceneLockExample: string;
  commonNegatives: string[];
  commonDriftPatterns: string[];
  /** scene lock에 추가할 "not X" 제약 */
  notConstraints: string[];
}

export const GENRE_TEMPLATES: Record<string, GenreTemplate> = {
  "map-graphic": {
    id: "map-graphic",
    subjectAnchorExample: "A flat antique paper map laid on a table surface",
    sceneLockExample: "The camera looks down at a physical map surface, not a landscape, not a 3D render",
    commonNegatives: [
      "landscape", "tree", "forest", "mountain", "river", "watercolor scenery",
      "ink painting", "sumi-e", "nature scene", "birds", "cranes", "heron",
      "human figure", "battlefield", "readable text", "calligraphy",
      "boxes", "rectangular overlay", "UI panels", "floating panels",
      "poster", "infographic", "labels", "signboards",
      "3D render", "CGI", "glossy render", "game map", "strategy game UI",
      "miniature diorama", "plastic terrain model", "fantasy map",
      "real landscape", "satellite photo", "3D globe",
    ],
    commonDriftPatterns: [
      "map → landscape painting", "map → ruins/gothic architecture",
      "map → fantasy illustration", "map → sumi-e/ink wash scenery",
      "map → 3D rendered terrain", "map → game-map look",
      "map → miniature diorama", "map → CGI globe",
    ],
    notConstraints: [
      "not a landscape", "not a 3D render", "not a CGI scene",
      "not a game map", "not a miniature diorama",
    ],
  },
  "product-shot": {
    id: "product-shot",
    subjectAnchorExample: "A silver smartphone standing upright on a clean studio surface",
    sceneLockExample: "Product photography setup with clean background, not an abstract composition",
    commonNegatives: [
      "abstract sculpture", "floating objects", "extra props", "fantasy elements",
      "surreal composition", "artistic interpretation", "poster design",
      "multiple products", "cluttered background", "text overlay",
      "human hands holding product", "extreme close-up losing product shape",
    ],
    commonDriftPatterns: [
      "product → abstract art object", "product → floating surreal sculpture",
      "product → advertisement poster", "product → technical diagram",
    ],
    notConstraints: [
      "not an abstract sculpture", "not a poster", "not a diagram",
    ],
  },
  "character-driven": {
    id: "character-driven",
    subjectAnchorExample: "A middle-aged woman sitting alone in a modern office",
    sceneLockExample: "Interior room with realistic proportions, real furniture, natural lighting",
    commonNegatives: [
      "extra limbs", "extra fingers", "identity drift", "outfit change",
      "crowd insertion", "duplicate characters", "fantasy costume",
      "exaggerated proportions", "uncanny valley face", "blurry face",
      "text overlay", "watermark",
    ],
    commonDriftPatterns: [
      "person → different character", "person → crowd scene",
      "person → fantasy costume", "person → portrait painting style",
    ],
    notConstraints: [
      "not a different person", "not a crowd", "not a painting",
    ],
  },
  "environment": {
    id: "environment",
    subjectAnchorExample: "A narrow alleyway in a rainy East Asian city at night",
    sceneLockExample: "Real urban environment with concrete walls, wet pavement, neon reflections",
    commonNegatives: [
      "surreal architecture", "impossible layout", "fantasy lighting",
      "floating structures", "abstract geometry", "miniature model",
      "painting style", "illustrated look", "poster composition",
      "text overlay", "watermark",
    ],
    commonDriftPatterns: [
      "real space → fantasy set", "urban → cyberpunk exaggeration",
      "interior → impossible architecture", "exterior → painting/illustration",
    ],
    notConstraints: [
      "not a fantasy set", "not a painting", "not a miniature model",
    ],
  },
  "ui-demo": {
    id: "ui-demo",
    subjectAnchorExample: "A smartphone screen showing a messaging app interface",
    sceneLockExample: "Screen recording style, clean device frame, readable UI elements",
    commonNegatives: [
      "poster design", "infographic", "fake text blocks", "unreadable screen",
      "artistic interpretation", "abstract UI", "floating interface",
      "3D rendered device", "product advertisement", "text overlay outside screen",
    ],
    commonDriftPatterns: [
      "UI → poster/infographic", "UI → abstract motion graphic",
      "app screen → artistic reinterpretation", "device → floating in void",
    ],
    notConstraints: [
      "not a poster", "not an infographic", "not an abstract composition",
    ],
  },
  "abstract-motion": {
    id: "abstract-motion",
    subjectAnchorExample: "Flowing liquid particles forming a spiral pattern in dark space",
    sceneLockExample: "Abstract motion graphics on dark background, geometric or fluid forms",
    commonNegatives: [
      "realistic objects", "human figures", "recognizable places",
      "text overlay", "readable text", "poster layout",
      "photograph", "realistic scene",
    ],
    commonDriftPatterns: [
      "abstract → realistic scene", "particles → recognizable objects",
      "motion graphic → static poster", "geometric → architectural rendering",
    ],
    notConstraints: [
      "not a realistic scene", "not a photograph",
    ],
  },
  "document-flat": {
    id: "document-flat",
    subjectAnchorExample: "An old handwritten letter on yellowed paper",
    sceneLockExample: "Flat document surface seen from above, tabletop view",
    commonNegatives: [
      "landscape", "3D scene", "room interior", "human figure",
      "floating objects", "abstract art", "poster design",
      "readable text", "legible writing",
    ],
    commonDriftPatterns: [
      "document → landscape painting", "letter → fantasy scroll",
      "paper → 3D scene", "flat surface → depth scene",
    ],
    notConstraints: [
      "not a landscape", "not a 3D scene", "not a painting",
    ],
  },
};

/** shotCategory → GenreTemplate 매핑 */
export function getGenreTemplate(shotCategory?: string): GenreTemplate | undefined {
  if (!shotCategory) return undefined;
  // 직접 매핑
  if (GENRE_TEMPLATES[shotCategory]) return GENRE_TEMPLATES[shotCategory];
  // 레거시 매핑
  const aliasMap: Record<string, string> = {
    "object-detail": "product-shot",
    "transition-atmosphere": "abstract-motion",
  };
  const alias = aliasMap[shotCategory];
  return alias ? GENRE_TEMPLATES[alias] : undefined;
}

// ─────────────────────────────────────────────────────────────────
// 2. 실패 패턴 라이브러리 (Failure Mode Library)
// ─────────────────────────────────────────────────────────────────

export interface FailureMode {
  trigger: RegExp;
  negatives: string[];
  description: string;
}

/** 장면 내용에서 실패 패턴을 감지하고 자동으로 negative를 주입 */
export const FAILURE_MODES: FailureMode[] = [
  {
    trigger: /\b(map|cartograph|atlas|globe|parchment|territorial)\b/i,
    negatives: ["landscape", "nature scene", "watercolor scenery", "ink painting", "sumi-e", "birds", "cranes", "forest", "mountain"],
    description: "map → landscape/nature drift",
  },
  {
    trigger: /\b(3D\s+topograph\w*|3D\s+map|3D\s+terrain|3D\s+relief|topographic\s+3D|rendered\s+terrain)\b/i,
    negatives: ["3D render", "CGI", "glossy render", "game map", "strategy game UI", "miniature diorama", "plastic terrain model", "fantasy map", "3D globe"],
    description: "3D/CGI terrain drift — cinematic realism 오염",
  },
  {
    trigger: /\b(relief\s+map|terrain\s+map|physical\s+map|contour\s+map)\b/i,
    negatives: ["real landscape", "CGI render", "3D render", "game-map look", "miniature diorama", "satellite photo", "glossy surface", "plastic model"],
    description: "relief map → 3D/landscape drift",
  },
  {
    trigger: /\b(product|device|phone|smartphone|laptop|gadget|bottle|package|tablet|watch|earbuds?|headphones?)\b/i,
    negatives: ["abstract sculpture", "floating objects", "surreal composition", "artistic interpretation", "extra props"],
    description: "product → abstract/surreal drift",
  },
  {
    trigger: /\b(person|man|woman|character|portrait|face|figure)\b/i,
    negatives: ["extra limbs", "extra fingers", "duplicate characters", "crowd insertion", "identity drift", "fantasy costume"],
    description: "person → identity/body drift",
  },
  {
    trigger: /\b(room|interior|office|kitchen|bedroom|apartment|studio)\b/i,
    negatives: ["surreal architecture", "impossible layout", "fantasy lighting", "floating structures", "miniature model"],
    description: "interior → impossible architecture drift",
  },
  {
    trigger: /\b(street|city|urban|alley|road|highway|downtown)\b/i,
    negatives: ["fantasy city", "cyberpunk exaggeration", "floating buildings", "impossible perspective", "painting style"],
    description: "urban → fantasy/cyberpunk drift",
  },
  {
    trigger: /\b(document|letter|paper|scroll|book|page|manuscript)\b/i,
    negatives: ["landscape", "3D scene", "room interior", "human figure", "floating objects"],
    description: "document → scene drift",
  },
  {
    trigger: /\b(screen|app|interface|UI|dashboard|menu|notification)\b/i,
    negatives: ["poster design", "infographic", "artistic interpretation", "abstract UI", "floating interface"],
    description: "UI → poster/abstract drift",
  },
  {
    trigger: /\b(food|dish|meal|plate|cooking|ingredient|recipe)\b/i,
    negatives: ["artistic interpretation", "surreal plating", "abstract composition", "poster design", "human figure"],
    description: "food → artistic/surreal drift",
  },
];

/** 프롬프트 내용에서 매칭되는 실패 패턴의 negative를 수집 */
export function collectFailureModeNegatives(scenePrompt: string): string[] {
  const negatives: string[] = [];
  for (const mode of FAILURE_MODES) {
    if (mode.trigger.test(scenePrompt)) {
      negatives.push(...mode.negatives);
    }
  }
  // 중복 제거
  return [...new Set(negatives)];
}

// ─────────────────────────────────────────────────────────────────
// 3. 위험 단어 제어 (Dangerous Word Control)
// ─────────────────────────────────────────────────────────────────

/** 이 단어들은 subject/scene anchor 없이 단독으로 scene을 정의하면 안 됨 */
const DANGEROUS_WORDS = [
  "symbolic", "metaphorical", "dreamlike", "haunting", "ominous",
  "surreal", "apocalyptic", "mythic", "eerie", "abstract",
  "colonial power", "blood-red", "cinematic mood", "emotional atmosphere",
  "poetic", "ethereal", "otherworldly", "transcendent", "prophetic",
  "mystical", "hallucinatory", "phantasmagoric", "nightmarish",
  "uncanny", "spectral", "liminal", "cosmic horror",
];

const DANGEROUS_PATTERN = new RegExp(
  `\\b(${DANGEROUS_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi"
);

/**
 * subject anchor가 약한 상태에서 위험 단어가 scene을 지배하는지 검사.
 * 위험하면 위험 단어를 약화(문장 끝으로 이동)하거나 제거.
 */
export function controlDangerousWords(prompt: string, hasStrongSubject: boolean): {
  cleaned: string;
  removedWords: string[];
} {
  if (hasStrongSubject) {
    // subject가 강하면 위험 단어 허용 (보조적 역할)
    return { cleaned: prompt, removedWords: [] };
  }

  const removedWords: string[] = [];
  const cleaned = prompt.replace(DANGEROUS_PATTERN, (match) => {
    removedWords.push(match.toLowerCase());
    return ""; // subject가 약하면 위험 단어 제거
  })
    .replace(/,\s*,/g, ",")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { cleaned, removedWords };
}

/**
 * 프롬프트 첫 문장에 구체적인 subject 명사가 있는지 검사.
 * "강한 subject" = 첫 문장에 물리적 피사체가 명시됨.
 */
export function hasStrongSubjectAnchor(prompt: string): boolean {
  const firstSentence = prompt.split(/[.!?]/).filter(Boolean)[0] || "";
  // 구체적 피사체 패턴: 관사 + 명사 (A/An/The + 물리적 객체)
  const concreteSubjectPattern = /\b(a|an|the)\s+\w+\s+(map|person|man|woman|child|device|phone|screen|room|street|building|car|table|chair|desk|wall|door|window|letter|document|product|bottle|box|figure|portrait|landscape|surface|paper|object|animal|plant|food|dish|sign|board|frame|canvas|photo|camera|light|lamp|mirror|clock|book|cup|glass|plate|fabric|material|stone|metal|wood)/i;

  if (concreteSubjectPattern.test(firstSentence)) return true;

  // 구체적 장소/공간 패턴
  const placePattern = /\b(interior|exterior|inside|outdoor|indoor|tabletop|studio|office|kitchen|bedroom|living room|corridor|hallway|rooftop|balcony|garden|park|street|alley|highway|bridge|tunnel|subway|airport|station|hospital|school|church|temple|mosque|factory|warehouse|library|museum|theater|cinema|restaurant|cafe|bar|shop|store|market|mall)/i;
  if (placePattern.test(firstSentence)) return true;

  // 추상어만 있고 구체 명사가 없으면 약한 subject
  const abstractCount = (firstSentence.match(DANGEROUS_PATTERN) || []).length;
  const wordCount = firstSentence.split(/\s+/).length;
  // 추상어 비율이 25% 이상이면 약한 subject
  if (abstractCount > 0 && abstractCount / wordCount > 0.25) return false;

  // 기본: 첫 문장이 10단어 이상이고 명사가 있으면 괜찮다고 판단
  return wordCount >= 5;
}

// ─────────────────────────────────────────────────────────────────
// 4. 6계층 프롬프트 빌더 (6-Layer Prompt Builders)
// ─────────────────────────────────────────────────────────────────

export interface PromptLayerInput {
  /** 원본 씬 프롬프트 */
  scenePrompt: string;
  /** 장르/장면 유형 */
  shotCategory?: string;
  /** 샷 타입 (CU/MS/WS 등) */
  shotType?: string;
  /** 카메라 방향 */
  cameraDirection?: string;
  /** 영상 길이 (초) */
  durationSec: number;
  /** 스타일 모드 */
  animationMode?: string;
  /** 스타일 강도 (0-100) */
  styleIntensity: number;
  /** 사용자 negative prompt */
  userNegativePrompt?: string;
}

export interface ContinuityInput {
  /** 이전 컷의 핵심 subject 설명 */
  primarySubject?: string;
  /** 이전 컷의 subject 속성 */
  subjectAttributes?: string;
  /** 이전 컷의 환경 타입 */
  environmentType?: string;
  /** 이전 컷의 카메라 거리 */
  cameraDistance?: string;
  /** 이전 컷의 조명 방향 */
  lightingDirection?: string;
  /** 이전 컷의 색상 앵커 */
  colorAnchors?: string;
  /** 이전 컷의 표면/재질 */
  surfaceMaterial?: string;
  /** 이전 컷의 characterConsistency (레거시) */
  characterConsistency?: string;
  /** 이전 컷의 moodLighting (레거시) */
  moodLighting?: string;
}

/**
 * A. SUBJECT ANCHOR — 핵심 피사체를 첫 문장에 명확히 고정.
 *
 * 원본 프롬프트에서 핵심 subject를 추출하거나,
 * subject가 약하면 장르 템플릿 기반으로 보강.
 */
export function buildSubjectAnchor(input: PromptLayerInput): string {
  const prompt = input.scenePrompt;
  const firstSentence = prompt.split(/[.!?]/).filter(s => s.trim().length > 3)[0]?.trim() || "";

  // 이미 강한 subject가 있으면 그대로 사용
  if (hasStrongSubjectAnchor(prompt)) {
    return firstSentence;
  }

  // 장르 템플릿에서 subject anchor 힌트 가져오기
  const genre = getGenreTemplate(input.shotCategory);
  if (genre) {
    // 원본 프롬프트에서 핵심 명사를 추출하여 장르 템플릿의 anchor와 결합
    return `${firstSentence}. ${genre.subjectAnchorExample.split(" ").slice(0, 3).join(" ")} — ${firstSentence}`;
  }

  return firstSentence;
}

/**
 * B. SCENE STRUCTURE — 카메라가 보는 공간/표면/구도.
 *
 * "not X" 제약을 포함하여 모델이 scene을 오해하지 않도록 고정.
 */
export function buildSceneLock(input: PromptLayerInput): string {
  const parts: string[] = [];
  const genre = getGenreTemplate(input.shotCategory);

  // 샷 타입 → 자연어
  const shotMap: Record<string, string> = {
    ECU: "Extreme close-up", CU: "Close-up", MCU: "Medium close-up",
    MS: "Medium shot", MLS: "Medium long shot", LS: "Long shot",
    WS: "Wide shot", OTS: "Over-the-shoulder", POV: "Point-of-view",
  };
  const shotKey = (input.shotType || "MS").toUpperCase();
  const shotLabel = shotMap[shotKey] || "Medium shot";
  parts.push(`${shotLabel} framing`);

  // 장르 기반 scene lock
  if (genre) {
    parts.push(genre.sceneLockExample);
    // "not X" 제약 (첫 3개 — CGI/3D 방지 포함)
    for (const constraint of genre.notConstraints.slice(0, 3)) {
      parts.push(constraint);
    }
  }

  // cinematic realism + 지도/지형 씬: 매체 고정
  const isCinematicRealism = /cinematic\s*realism/i.test(input.scenePrompt + " " + (input.animationMode || ""));
  const isMapTerrain = /\b(map|terrain|topograph|relief|globe|continent|territorial)\b/i.test(input.scenePrompt);
  if (isCinematicRealism && isMapTerrain) {
    parts.push("The image remains a physical map surface, not a real landscape and not a CGI render");
  }

  return parts.join(". ");
}

/**
 * C. VISUAL DETAILS — 재질, 색, 조명, 렌즈 느낌.
 *
 * 원본 프롬프트에서 시각적 디테일을 추출.
 * subject/scene이 확정된 뒤에만 추가.
 */
export function buildVisualDetails(input: PromptLayerInput): string {
  const prompt = input.scenePrompt;
  // 첫 문장(subject) 이후의 시각적 디테일 추출
  const sentences = prompt.split(/[.!?]/).filter(s => s.trim().length > 3);
  if (sentences.length <= 1) return "";

  // subject 이후 문장들 중 시각적 키워드가 있는 것만 선별
  const visualKeywords = /\b(light|shadow|color|texture|grain|warm|cool|muted|vibrant|golden|silver|dark|bright|soft|harsh|ambient|neon|dim|glow|haze|fog|rain|dust|smoke|reflection|shiny|matte|glossy|rough|smooth|wet|dry|aged|worn|clean|crisp|blurry|sharp)\b/i;
  const visualParts = sentences.slice(1)
    .filter(s => visualKeywords.test(s))
    .map(s => s.trim());

  return visualParts.slice(0, 3).join(". ");
}

/**
 * D. ACTION / TEMPORAL — 시간축 변화.
 *
 * subject를 벗어나지 않는 변화만 허용.
 */
export function buildTemporalAction(input: PromptLayerInput): string {
  const prompt = input.scenePrompt;
  const dur = input.durationSec && input.durationSec > 0 ? input.durationSec : 8;

  // 이미 temporal beats가 있으면 그대로
  if (/\d+s[-–]\d+s/.test(prompt) || /\bfirst\b[\s\S]*\bthen\b[\s\S]*\bfinally\b/i.test(prompt)) {
    const match = prompt.match(/\d+s[-–][\s\S]*$/);
    return match ? match[0] : "";
  }

  // 액션 키워드 포함 문장 추출
  const actionKeywords = /\b(moves?|turns?|walks?|runs?|opens?|closes?|rises?|falls?|rotates?|zooms?|shifts?|spreads?|grows?|fades?|appears?|reveals?|pushes?|pulls?|slides?|lifts?|drops?|reaches?|grabs?|touches?|looks?|stares?|glances?|nods?|shakes?|tilts?|leans?|sits?|stands?|enters?|exits?|approaches?|retreats?)\b/i;
  const sentences = prompt.split(/[.!?]/).filter(s => s.trim().length > 3);
  const actionSentences = sentences.filter(s => actionKeywords.test(s));

  if (actionSentences.length === 0) {
    // 액션이 없으면 미묘한 변화 삽입
    const mid = Math.floor(dur * 0.4);
    return `0-${mid}s: establishing the scene. ${mid}-${dur}s: subtle shift in focus or light`;
  }

  // 시간축으로 분배
  const mid1 = Math.floor(dur * 0.25);
  const mid2 = Math.floor(dur * 0.6);
  if (actionSentences.length >= 3) {
    return `0-${mid1}s: ${actionSentences[0].trim()}. ${mid1}-${mid2}s: ${actionSentences[1].trim()}. ${mid2}-${dur}s: ${actionSentences[2].trim()}`;
  }
  if (actionSentences.length === 2) {
    return `0-${mid2}s: ${actionSentences[0].trim()}. ${mid2}-${dur}s: ${actionSentences[1].trim()}`;
  }
  return `0-${mid2}s: establishing. ${mid2}-${dur}s: ${actionSentences[0].trim()}`;
}

/**
 * E. CONTINUITY CONSTRAINTS — 이전 컷 객체/상태 유지.
 *
 * mood가 아니라 object/state 기준으로 유지.
 */
export function buildContinuityLock(continuity?: ContinuityInput): string {
  if (!continuity) return "";

  const parts: string[] = [];

  // 객체 기반 continuity (최우선)
  if (continuity.primarySubject) {
    parts.push(`Same subject: ${continuity.primarySubject}`);
  }
  if (continuity.subjectAttributes) {
    parts.push(`Same appearance: ${continuity.subjectAttributes}`);
  }
  if (continuity.surfaceMaterial) {
    parts.push(`Same surface: ${continuity.surfaceMaterial}`);
  }
  if (continuity.environmentType) {
    parts.push(`Same environment: ${continuity.environmentType}`);
  }

  // 카메라/조명 continuity (보조)
  if (continuity.lightingDirection) {
    parts.push(`Same lighting: ${continuity.lightingDirection}`);
  }
  if (continuity.colorAnchors) {
    parts.push(`Same colors: ${continuity.colorAnchors}`);
  }

  // 레거시 호환: characterConsistency가 있으면 사용
  if (parts.length === 0 && continuity.characterConsistency) {
    parts.push(continuity.characterConsistency);
  }

  if (parts.length === 0) return "";
  return `Continuity: ${parts.join(". ")}`;
}

/**
 * F. NEGATIVE CONSTRAINTS — 실패 패턴 차단.
 *
 * 범용 + scene-specific 두 층으로 운영.
 */
export function buildNegativePrompt(input: PromptLayerInput): string {
  const negatives = new Set<string>();

  // Layer 1: 범용 negative (모든 영상 공통)
  const universalNegatives = [
    "text overlay", "watermark", "subtitle", "logo",
    "blurry", "low quality", "distorted",
  ];
  universalNegatives.forEach(n => negatives.add(n));

  // Layer 2: 실패 패턴 기반 자동 negative
  const failureNegatives = collectFailureModeNegatives(input.scenePrompt);
  failureNegatives.forEach(n => negatives.add(n));

  // Layer 3: 장르 템플릿 기반 negative
  const genre = getGenreTemplate(input.shotCategory);
  if (genre) {
    genre.commonNegatives.forEach(n => negatives.add(n));
  }

  // Layer 4: 사용자 지정 negative
  if (input.userNegativePrompt) {
    input.userNegativePrompt.split(",").map(s => s.trim()).filter(Boolean)
      .forEach(n => negatives.add(n));
  }

  // 최대 30개 (map-graphic 등 anti-drift 필수 negative가 많은 장르 대응)
  const arr = [...negatives].slice(0, 30);
  return arr.length > 0 ? `Avoid: ${arr.join(", ")}` : "";
}

// ─────────────────────────────────────────────────────────────────
// 5. 드리프트 위험도 계산 + 자동 교정 (Drift Risk Assessment)
// ─────────────────────────────────────────────────────────────────

export interface DriftAssessment {
  riskLevel: "low" | "medium" | "high";
  riskScore: number;       // 0-100
  issues: string[];
  /** 자동 교정된 프롬프트 (high risk일 때) */
  correctedPrompt?: string;
}

/**
 * 드리프트 위험도를 계산하고, 위험하면 프롬프트를 자동 교정.
 */
export function assessAndCorrectDrift(
  prompt: string,
  input: PromptLayerInput,
): DriftAssessment {
  const issues: string[] = [];
  let riskScore = 0;

  const firstSentence = prompt.split(/[.!?]/).filter(s => s.trim().length > 3)[0] || "";

  // Check 1: 첫 문장에 구체적 subject 명사가 없는가?
  if (!hasStrongSubjectAnchor(prompt)) {
    issues.push("첫 문장에 구체적 subject 명사 없음");
    riskScore += 30;
  }

  // Check 2: 카메라가 무엇을 보는지 불명확한가?
  const hasSceneContext = /\b(looking at|camera sees|framing|shot of|view of|close-up of|wide shot of|interior|exterior|surface|tabletop)\b/i.test(prompt);
  if (!hasSceneContext) {
    issues.push("카메라가 무엇을 보는지 불명확");
    riskScore += 15;
  }

  // Check 3: 추상 형용사가 구체 명사보다 많은가?
  const abstractWords = (prompt.match(DANGEROUS_PATTERN) || []).length;
  const concreteNouns = (prompt.match(/\b(map|person|room|street|phone|screen|table|chair|wall|door|window|building|car|surface|paper|desk|lamp|mirror|food|dish|product|device|letter|document)\b/gi) || []).length;
  if (abstractWords > concreteNouns && abstractWords > 2) {
    issues.push(`추상어(${abstractWords})가 구체 명사(${concreteNouns})보다 많음`);
    riskScore += 25;
  }

  // Check 4: negative prompt가 비어있고 장르도 미지정 (장르가 있으면 자동 negative 주입됨)
  if (!input.userNegativePrompt?.trim() && !input.shotCategory) {
    issues.push("사용자 negative prompt 없고 shotCategory 미지정");
    riskScore += 15;
  }

  // Check 5: 장르 미지정 (negative와 별개로 장르 보호 부재)
  if (!input.shotCategory) {
    issues.push("shotCategory 미지정 — 장르별 보호 불가");
    riskScore += 5;
  }

  // Check 6: 프롬프트가 너무 짧음 (모호할 가능성)
  const wordCount = prompt.split(/\s+/).length;
  if (wordCount < 10) {
    issues.push(`프롬프트가 너무 짧음 (${wordCount}단어)`);
    riskScore += 15;
  }

  const riskLevel = riskScore >= 50 ? "high" : riskScore >= 25 ? "medium" : "low";

  // HIGH risk → 자동 교정
  let correctedPrompt: string | undefined;
  if (riskLevel === "high") {
    correctedPrompt = autoCorrectPrompt(prompt, input);
  }

  return { riskLevel, riskScore, issues, correctedPrompt };
}

// ─────────────────────────────────────────────────────────────────
// 5-b. Prompt Rewrite Rules — camera conflict / 3D-CGI drift 자동 교정
// ─────────────────────────────────────────────────────────────────

/** 카메라 충돌 패턴: wide + close-up 같은 모순이 한 문장에 섞인 경우 */
const CAMERA_CONFLICT_PATTERNS: Array<{ a: RegExp; b: RegExp; description: string }> = [
  { a: /\b(wide|wide\s+shot|aerial|bird.?s?\s+eye|overhead)\b/i, b: /\b(close.?up|medium\s+shot|MCU|CU|ECU)\b/i, description: "wide + close-up conflict" },
  { a: /\b(high.?angle|overhead|top.?down)\b/i, b: /\b(low.?angle|worm.?s?\s+eye|from\s+below)\b/i, description: "high-angle + low-angle conflict" },
];

/** 3D/CGI 표현이 cinematic realism 프롬프트에 섞인 패턴 */
const CGI_CONTAMINATION_PATTERNS = /\b(3D\s+topograph|3D\s+map|3D\s+terrain|3D\s+rendered?|CGI\s+(?:render|terrain|landscape)|game[\s-]?map|strategy\s+game|mini(?:ature)?\s+diorama|glossy\s+(?:3D|render)|plastic\s+(?:terrain|model|surface))\b/gi;

/** cinematic realism 대체 표현 */
const CGI_TO_CINEMATIC_MAP: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b3D\s+topograph(?:ic)?\s+map\b/gi, replacement: "physical relief map surface with terrain contours" },
  { pattern: /\b3D\s+terrain\b/gi, replacement: "physical terrain surface" },
  { pattern: /\b3D\s+map\b/gi, replacement: "physical map surface" },
  { pattern: /\b3D\s+rendered?\b/gi, replacement: "cinematic" },
  { pattern: /\bCGI\s+(?:render|terrain|landscape)\b/gi, replacement: "cinematic physical surface" },
  { pattern: /\bgame[\s-]?map\b/gi, replacement: "physical map" },
  { pattern: /\bstrategy\s+game\b/gi, replacement: "overhead view" },
  { pattern: /\bmini(?:ature)?\s+diorama\b/gi, replacement: "physical map surface" },
  { pattern: /\bglossy\s+(?:3D|render)\b/gi, replacement: "diffused natural surface" },
  { pattern: /\bplastic\s+(?:terrain|model|surface)\b/gi, replacement: "physical map surface" },
];

/**
 * 프롬프트에서 camera conflict와 3D/CGI contamination을 감지하고 교정.
 */
export function rewritePromptConflicts(prompt: string, opts?: {
  shotCategory?: string;
  isCinematicRealism?: boolean;
}): { rewritten: string; corrections: string[] } {
  let text = prompt;
  const corrections: string[] = [];

  // 1. Camera conflict 감지 — 한 문장에 상충하는 framing이 있으면 첫 번째만 유지
  for (const conflict of CAMERA_CONFLICT_PATTERNS) {
    if (conflict.a.test(text) && conflict.b.test(text)) {
      // 더 먼저 등장하는 쪽을 유지하고 뒤쪽을 제거
      const posA = text.search(conflict.a);
      const posB = text.search(conflict.b);
      if (posA < posB) {
        text = text.replace(conflict.b, "");
        corrections.push(`Camera conflict resolved: kept early "${text.match(conflict.a)?.[0]}", removed later conflicting framing`);
      } else {
        text = text.replace(conflict.a, "");
        corrections.push(`Camera conflict resolved: kept early "${text.match(conflict.b)?.[0]}", removed later conflicting framing`);
      }
    }
  }

  // 2. 3D/CGI contamination in cinematic realism
  const isCinematicRealism = opts?.isCinematicRealism
    ?? /cinematic\s*realism/i.test(prompt);
  if (isCinematicRealism) {
    for (const { pattern, replacement } of CGI_TO_CINEMATIC_MAP) {
      const match = text.match(pattern);
      if (match) {
        text = text.replace(pattern, replacement);
        corrections.push(`CGI drift corrected: "${match[0]}" → "${replacement}"`);
      }
    }
  }

  // 3. 정리
  text = text.replace(/,\s*,/g, ",").replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();

  return { rewritten: text, corrections };
}

/**
 * 위험도 높은 프롬프트를 자동 교정.
 * subject anchor 보강 + 위험 단어 제거 + scene lock 삽입.
 */
function autoCorrectPrompt(prompt: string, input: PromptLayerInput): string {
  let corrected = prompt;

  // 1. 위험 단어 제거
  const { cleaned } = controlDangerousWords(corrected, false);
  corrected = cleaned;

  // 2. 장르 기반 scene lock 삽입 (없으면)
  const genre = getGenreTemplate(input.shotCategory);
  if (genre && !/\b(not a |not an )\b/i.test(corrected)) {
    // "not X" 제약 추가
    corrected = `${corrected}. ${genre.notConstraints[0]}`;
  }

  // 3. 첫 문장이 약하면 장르 anchor 추가
  if (!hasStrongSubjectAnchor(corrected) && genre) {
    corrected = `${genre.subjectAnchorExample}. ${corrected}`;
  }

  return corrected;
}

// ─────────────────────────────────────────────────────────────────
// 6. 메인 조립 함수 (6-Layer Assembly)
// ─────────────────────────────────────────────────────────────────

export interface AssembledPromptV2 {
  finalPrompt: string;
  driftAssessment: DriftAssessment;
  layers: {
    subjectAnchor: string;
    sceneLock: string;
    visualDetails: string;
    temporalAction: string;
    continuityLock: string;
    negativePrompt: string;
    styleHint: string;
  };
  wordCount: number;
}

/**
 * 6계층 프롬프트 조립.
 *
 * 순서: SUBJECT → SCENE → VISUAL → ACTION → CONTINUITY → (style) → NEGATIVE
 */
export function assemblePromptV2(
  input: PromptLayerInput,
  continuity?: ContinuityInput,
  styleHint?: string,
): AssembledPromptV2 {
  // 0. 드리프트 위험도 평가 + 자동 교정
  const drift = assessAndCorrectDrift(input.scenePrompt, input);
  let effectivePrompt = drift.correctedPrompt || input.scenePrompt;

  // 0-b. Prompt rewrite — camera conflict / 3D-CGI drift 자동 교정
  const isCinematicRealism = /cinematic\s*realism/i.test(
    effectivePrompt + " " + (input.animationMode || ""),
  );
  const rewrite = rewritePromptConflicts(effectivePrompt, {
    shotCategory: input.shotCategory,
    isCinematicRealism,
  });
  if (rewrite.corrections.length > 0) {
    effectivePrompt = rewrite.rewritten;
    drift.issues.push(...rewrite.corrections);
  }

  const effectiveInput = { ...input, scenePrompt: effectivePrompt };

  // 1. 위험 단어 제어
  const strongSubject = hasStrongSubjectAnchor(effectivePrompt);
  const { cleaned: safePrompt } = controlDangerousWords(effectivePrompt, strongSubject);
  const safeInput = { ...effectiveInput, scenePrompt: safePrompt };

  // 2. 각 계층 빌드
  const subjectAnchor = buildSubjectAnchor(safeInput);
  const sceneLock = buildSceneLock(safeInput);
  const visualDetails = buildVisualDetails(safeInput);
  const temporalAction = buildTemporalAction(safeInput);
  const continuityLock = buildContinuityLock(continuity);
  const negativePrompt = buildNegativePrompt(safeInput);

  // 3. 스타일 힌트 (최소화 — subject/scene/action 이후에만)
  let compactStyle = "";
  if (styleHint && input.styleIntensity > 0) {
    // 스타일 힌트는 최대 1문장으로 압축
    const styleSentences = styleHint.split(". ").filter(Boolean);
    compactStyle = styleSentences[0] || "";
    // 15단어 이하로 제한
    const styleWords = compactStyle.split(/\s+/);
    if (styleWords.length > 15) {
      compactStyle = styleWords.slice(0, 15).join(" ");
    }
  }

  // 4. 조립 (순서 엄격 준수)
  const blocks: string[] = [];

  // A. Subject Anchor (첫 문장 — 최고 우선)
  blocks.push(subjectAnchor);

  // B. Scene Lock (두 번째 — 공간/표면/구도 고정)
  if (sceneLock) blocks.push(sceneLock);

  // C. Visual Details (세 번째 — 재질/색/조명)
  if (visualDetails) blocks.push(visualDetails);

  // D. Action / Temporal (네 번째 — 시간축 변화)
  if (temporalAction) blocks.push(temporalAction);

  // E. Continuity (다섯 번째 — 이전 컷 유지)
  if (continuityLock) blocks.push(continuityLock);

  // Style hint (최후에 약하게)
  if (compactStyle) blocks.push(compactStyle);

  let finalPrompt = blocks.join(". ");

  // 카메라 모션: cameraDirection이 있으면 간결하게 추가
  if (input.cameraDirection && input.cameraDirection.trim().length > 5) {
    finalPrompt += `. Camera: ${input.cameraDirection.trim()}`;
  }

  // 오디오 힌트
  if (!/\b(sound|audio|ambient|music|voice)\b/i.test(finalPrompt)) {
    finalPrompt += ". Diegetic ambient sound";
  }

  // No text overlay (안전)
  if (!/no text overlay/i.test(finalPrompt)) {
    finalPrompt += ". No text overlay, no watermark";
  }

  // 워드 캡: 250단어 (Kling은 긴 프롬프트를 잘 처리)
  const words = finalPrompt.split(/\s+/);
  if (words.length > 250) {
    finalPrompt = words.slice(0, 240).join(" ");
  }

  // F. Negative (맨 마지막)
  if (negativePrompt) {
    finalPrompt += `. ${negativePrompt}`;
  }

  return {
    finalPrompt,
    driftAssessment: drift,
    layers: {
      subjectAnchor,
      sceneLock,
      visualDetails,
      temporalAction,
      continuityLock,
      negativePrompt,
      styleHint: compactStyle,
    },
    wordCount: finalPrompt.split(/\s+/).length,
  };
}
