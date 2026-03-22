/**
 * korean-subject-defaults.ts
 *
 * Two features:
 *  1. Modern characters default to "contemporary Korean" unless otherwise specified
 *  2. Fragmented shot editing detection and multi-shot enforcement
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubjectContext {
  isModernSetting: boolean;
  hasExplicitNationality: boolean;
  explicitNationality: string | null;
  detectedGender: "male" | "female" | "unspecified" | null;
  genderSource: string | null;
  suggestedSubjectLabel: string;
  koreanLocationAnchors: string[];
}

export interface FragmentedEditContext {
  isFragmented: boolean;
  triggerTerms: string[];
  minShotCount: number;
  editStyle: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  cutNumber?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HISTORICAL_TERMS = [
  "조선", "고려", "삼국시대", "백제", "신라", "고구려",
  "사극", "한복", "갓", "상투", "왕궁", "궁궐",
  "임금", "왕비", "세자", "내시", "기생", "양반",
  "joseon", "goryeo", "sageuk", "hanbok", "dynasty",
  "three kingdoms", "baekje", "silla", "goguryeo",
];

const MODERN_CUES = [
  "현대인", "직장인", "학생", "지하철", "오피스텔", "편의점",
  "카페", "아파트", "핸드폰", "스마트폰", "컴퓨터", "노트북",
  "사무실", "회사", "학교", "대학", "대학교", "버스",
  "택시", "배달", "치킨", "라면", "소주", "맥주",
  "카카오톡", "인스타", "유튜브", "넷플릭스", "웹툰",
  "고시원", "원룸", "자취", "출퇴근", "야근", "퇴근",
  "subway", "smartphone", "office", "apartment", "cafe",
  "convenience store", "laptop", "commute", "delivery",
  "officetel", "university", "college",
];

const FEMALE_TERMS = [
  "여자", "여성", "엄마", "여학생", "언니", "누나", "할머니",
  "아줌마", "소녀", "딸", "며느리", "시어머니", "이모",
  "여직원", "여사장", "아내", "부인", "그녀",
];

const MALE_TERMS = [
  "남자", "남성", "아버지", "남학생", "형", "오빠", "할아버지",
  "아저씨", "소년", "아들", "사위", "시아버지", "삼촌",
  "남직원", "사장님", "남편", "그",
];

const NATIONALITY_TERMS: { term: string; nationality: string }[] = [
  { term: "미국인", nationality: "American" },
  { term: "일본인", nationality: "Japanese" },
  { term: "중국인", nationality: "Chinese" },
  { term: "프랑스인", nationality: "French" },
  { term: "독일인", nationality: "German" },
  { term: "영국인", nationality: "British" },
  { term: "러시아인", nationality: "Russian" },
  { term: "인도인", nationality: "Indian" },
  { term: "태국인", nationality: "Thai" },
  { term: "베트남인", nationality: "Vietnamese" },
  { term: "스페인인", nationality: "Spanish" },
  { term: "이탈리아인", nationality: "Italian" },
  { term: "호주인", nationality: "Australian" },
  { term: "캐나다인", nationality: "Canadian" },
  { term: "브라질인", nationality: "Brazilian" },
  { term: "american", nationality: "American" },
  { term: "japanese", nationality: "Japanese" },
  { term: "chinese", nationality: "Chinese" },
  { term: "french", nationality: "French" },
  { term: "german", nationality: "German" },
  { term: "british", nationality: "British" },
  { term: "russian", nationality: "Russian" },
  { term: "indian", nationality: "Indian" },
];

export const KOREAN_LOCATION_ANCHORS: string[] = [
  "Seoul officetel",
  "Korean apartment hallway",
  "subway platform in Seoul",
  "convenience store in Korea",
  "Korean office break room",
  "Korean university campus",
  "Korean cafe (카페)",
  "Korean barbecue restaurant",
  "Korean apartment kitchen",
  "Gangnam street",
  "Hongdae alley",
  "Korean rooftop (옥탑방)",
  "Korean pojangmacha (포장마차)",
  "Seoul bus stop",
  "Korean PC bang (PC방)",
  "Korean jjimjilbang (찜질방)",
  "Korean convenience store parking lot at night",
  "Myeongdong shopping street",
  "Korean university library",
  "Korean apartment veranda",
  "Seoul Han River park",
  "Korean goshiwon (고시원) room",
  "Korean subway car interior",
  "Korean chicken and beer restaurant (치맥집)",
  "Itaewon side street",
  "Korean noraebang (노래방)",
  "Korean traditional market (재래시장)",
  "Bukchon Hanok Village alley",
  "Korean office cubicle",
  "Seoul Namsan Tower overlook",
];

export const KOREAN_SUBJECT_VARIANTS = {
  youngFemale: [
    "young Korean woman in her 20s",
    "Korean female college student",
    "young Korean professional woman",
    "Korean woman in casual streetwear",
    "Korean female intern at a company",
  ],
  youngMale: [
    "young Korean man in his 20s",
    "Korean male college student",
    "young Korean professional man",
    "Korean man in casual streetwear",
    "Korean male intern at a company",
  ],
  middleAgeFemale: [
    "middle-aged Korean woman",
    "Korean mother in her 40s",
    "Korean businesswoman",
    "Korean woman in her 30s",
    "Korean female team leader",
  ],
  middleAgeMale: [
    "middle-aged Korean man",
    "Korean father in his 40s",
    "Korean businessman",
    "Korean man in his 30s",
    "Korean male team leader",
  ],
  elderFemale: [
    "elderly Korean woman",
    "Korean grandmother",
    "Korean woman in her 60s",
  ],
  elderMale: [
    "elderly Korean man",
    "Korean grandfather",
    "Korean man in his 60s",
  ],
  neutral: [
    "Korean office worker",
    "Korean student",
    "Korean commuter",
    "Korean teenager",
    "Korean freelancer",
    "Korean part-timer (알바생)",
  ],
} as const;

// ---------------------------------------------------------------------------
// Fragmented edit trigger terms
// ---------------------------------------------------------------------------

const FRAGMENTED_TRIGGER_KO = [
  "컷 분절", "쪼개진 컷", "빠른 편집", "삽입 컷",
  "몽타주", "편집 리듬", "하드 컷", "점프 컷",
];

const FRAGMENTED_TRIGGER_EN = [
  "fragmented", "hard cuts", "insert shot", "montage",
  "editorial rhythm", "jump cut", "rapid editing", "quick cuts",
];

// ---------------------------------------------------------------------------
// Part 1: Korean Subject Defaults
// ---------------------------------------------------------------------------

function lowerIncludes(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

export function detectSubjectContext(storyText: string): SubjectContext {
  const text = storyText;
  const textLower = text.toLowerCase();

  // ---- Historical check ----
  const hasHistorical = HISTORICAL_TERMS.some((t) => lowerIncludes(text, t));
  const hasModernCue = MODERN_CUES.some((t) => lowerIncludes(text, t));

  // Modern if: no historical terms present, OR explicit modern cues present
  // If neither historical nor modern cues → assume modern (default)
  const isModernSetting = !hasHistorical || hasModernCue;

  // ---- Nationality override ----
  let hasExplicitNationality = false;
  let explicitNationality: string | null = null;
  for (const { term, nationality } of NATIONALITY_TERMS) {
    if (lowerIncludes(text, term)) {
      hasExplicitNationality = true;
      explicitNationality = nationality;
      break;
    }
  }

  // ---- Gender detection ----
  let detectedGender: "male" | "female" | "unspecified" | null = null;
  let genderSource: string | null = null;

  for (const term of FEMALE_TERMS) {
    if (text.includes(term)) {
      detectedGender = "female";
      genderSource = term;
      break;
    }
  }

  if (!detectedGender) {
    for (const term of MALE_TERMS) {
      if (text.includes(term)) {
        detectedGender = "male";
        genderSource = term;
        break;
      }
    }
  }

  if (!detectedGender) {
    detectedGender = "unspecified";
  }

  // ---- Suggested subject label ----
  const suggestedSubjectLabel = buildSuggestedLabel(
    isModernSetting,
    hasExplicitNationality,
    explicitNationality,
    detectedGender,
    textLower,
  );

  // ---- Location anchors ----
  const koreanLocationAnchors = pickLocationAnchors(textLower);

  return {
    isModernSetting,
    hasExplicitNationality,
    explicitNationality,
    detectedGender,
    genderSource,
    suggestedSubjectLabel,
    koreanLocationAnchors,
  };
}

function buildSuggestedLabel(
  isModern: boolean,
  hasNationality: boolean,
  nationality: string | null,
  gender: "male" | "female" | "unspecified" | null,
  textLower: string,
): string {
  // If explicit nationality, use that nationality
  if (hasNationality && nationality) {
    const base = nationality;
    if (gender === "female") return `young ${base} woman`;
    if (gender === "male") return `young ${base} man`;
    return `${base} person`;
  }

  // Historical → generic
  if (!isModern) {
    if (gender === "female") return "Korean woman in traditional attire";
    if (gender === "male") return "Korean man in traditional attire";
    return "Korean person in traditional attire";
  }

  // Detect age/role hints
  const isStudent =
    textLower.includes("학생") ||
    textLower.includes("대학") ||
    textLower.includes("student") ||
    textLower.includes("college");
  const isWorker =
    textLower.includes("직장인") ||
    textLower.includes("사무실") ||
    textLower.includes("회사") ||
    textLower.includes("office");
  const isElder =
    textLower.includes("할머니") ||
    textLower.includes("할아버지") ||
    textLower.includes("elderly") ||
    textLower.includes("grandfather") ||
    textLower.includes("grandmother");

  if (isElder) {
    if (gender === "female") return "elderly Korean woman";
    if (gender === "male") return "elderly Korean man";
    return "elderly Korean person";
  }

  if (isStudent) {
    if (gender === "female") return "Korean female college student";
    if (gender === "male") return "Korean male college student";
    return "Korean student";
  }

  if (isWorker) {
    if (gender === "female") return "young Korean professional woman";
    if (gender === "male") return "young Korean professional man";
    return "Korean office worker";
  }

  // Default modern Korean
  if (gender === "female") return "young Korean woman";
  if (gender === "male") return "young Korean man";
  return "Korean person";
}

function pickLocationAnchors(textLower: string): string[] {
  const anchors: string[] = [];

  const mapping: { keywords: string[]; anchor: string }[] = [
    { keywords: ["오피스텔", "officetel"], anchor: "Seoul officetel" },
    { keywords: ["아파트", "apartment"], anchor: "Korean apartment hallway" },
    { keywords: ["지하철", "subway"], anchor: "subway platform in Seoul" },
    { keywords: ["편의점", "convenience"], anchor: "convenience store in Korea" },
    { keywords: ["사무실", "office"], anchor: "Korean office break room" },
    { keywords: ["대학", "university", "campus"], anchor: "Korean university campus" },
    { keywords: ["카페", "cafe"], anchor: "Korean cafe (카페)" },
    { keywords: ["고기", "삼겹살", "barbecue", "bbq"], anchor: "Korean barbecue restaurant" },
    { keywords: ["부엌", "kitchen", "주방"], anchor: "Korean apartment kitchen" },
    { keywords: ["강남", "gangnam"], anchor: "Gangnam street" },
    { keywords: ["홍대", "hongdae"], anchor: "Hongdae alley" },
    { keywords: ["옥탑", "rooftop"], anchor: "Korean rooftop (옥탑방)" },
    { keywords: ["포장마차", "pojangmacha"], anchor: "Korean pojangmacha (포장마차)" },
    { keywords: ["버스", "bus"], anchor: "Seoul bus stop" },
    { keywords: ["pc방", "pc bang", "피시방"], anchor: "Korean PC bang (PC방)" },
    { keywords: ["찜질방", "jjimjilbang", "sauna"], anchor: "Korean jjimjilbang (찜질방)" },
    { keywords: ["치킨", "치맥", "chicken"], anchor: "Korean chicken and beer restaurant (치맥집)" },
    { keywords: ["이태원", "itaewon"], anchor: "Itaewon side street" },
    { keywords: ["노래방", "noraebang", "karaoke"], anchor: "Korean noraebang (노래방)" },
    { keywords: ["시장", "market", "재래시장"], anchor: "Korean traditional market (재래시장)" },
    { keywords: ["한강", "han river"], anchor: "Seoul Han River park" },
    { keywords: ["고시원", "goshiwon"], anchor: "Korean goshiwon (고시원) room" },
  ];

  for (const { keywords, anchor } of mapping) {
    if (keywords.some((kw) => textLower.includes(kw))) {
      anchors.push(anchor);
    }
  }

  // If no specific anchors detected but modern Korean context, provide defaults
  if (anchors.length === 0) {
    anchors.push("Seoul officetel", "Korean apartment hallway", "subway platform in Seoul");
  }

  return anchors;
}

// ---------------------------------------------------------------------------
// Part 1 continued: prompt block builder
// ---------------------------------------------------------------------------

export function buildKoreanSubjectBlock(context: SubjectContext): string {
  if (!context.isModernSetting || context.hasExplicitNationality) {
    return "";
  }

  const lines: string[] = [
    "## 현대 인물 기본값: 현대 한국인",
    "- 명시적 국적 지정이 없는 현대 인물은 contemporary Korean으로 설정",
    "- 성별 고정 금지: 장면 맥락에 맞게 자연스럽게 선택 (남성 편향 방지)",
  ];

  if (context.detectedGender === "female") {
    lines.push(`- 감지된 성별: 여성 (\"${context.genderSource}\") — 해당 인물을 여성으로 묘사`);
  } else if (context.detectedGender === "male") {
    lines.push(`- 감지된 성별: 남성 (\"${context.genderSource}\") — 해당 인물을 남성으로 묘사`);
  } else {
    lines.push("- 성별 미지정: 장면마다 다양한 성별 배치 권장");
  }

  const anchorSample = context.koreanLocationAnchors.slice(0, 4).join(", ");
  lines.push(
    `- 한국 생활 맥락 반영: ${anchorSample} 등`,
    "- 과장된 stereotype 금지, 현실적인 현대 한국 생활감",
    `- 추천 인물 라벨: "${context.suggestedSubjectLabel}"`,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Part 2: Fragmented Shot Detection
// ---------------------------------------------------------------------------

export function detectFragmentedEditRequest(
  storyText: string,
): FragmentedEditContext {
  const text = storyText;
  const textLower = text.toLowerCase();
  const matched: string[] = [];

  for (const term of FRAGMENTED_TRIGGER_KO) {
    if (text.includes(term)) {
      matched.push(term);
    }
  }

  for (const term of FRAGMENTED_TRIGGER_EN) {
    if (textLower.includes(term)) {
      matched.push(term);
    }
  }

  const isFragmented = matched.length > 0;

  // Determine min shot count based on intensity of fragmentation
  let minShotCount = 3;
  if (matched.length >= 3) {
    minShotCount = 6;
  } else if (matched.length >= 2) {
    minShotCount = 5;
  } else if (isFragmented) {
    // Check for stronger fragmentation signals
    const strongSignals = ["몽타주", "montage", "rapid editing", "빠른 편집", "quick cuts"];
    if (matched.some((m) => strongSignals.includes(m.toLowerCase()))) {
      minShotCount = 5;
    } else {
      minShotCount = 3;
    }
  }

  // Build edit style description
  let editStyle = "";
  if (isFragmented) {
    const styleParts: string[] = ["fragmented"];
    if (matched.some((m) => ["하드 컷", "hard cuts"].includes(m.toLowerCase()))) {
      styleParts.push("hard cuts");
    }
    if (matched.some((m) => ["점프 컷", "jump cut"].includes(m.toLowerCase()))) {
      styleParts.push("jump cuts");
    }
    if (
      matched.some((m) =>
        ["몽타주", "montage"].includes(m.toLowerCase()),
      )
    ) {
      styleParts.push("montage rhythm");
    }
    if (
      matched.some((m) =>
        ["빠른 편집", "rapid editing", "quick cuts"].includes(m.toLowerCase()),
      )
    ) {
      styleParts.push("rapid pacing");
    }
    styleParts.push("sharp editorial rhythm");
    editStyle = styleParts.join(", ");
  }

  return {
    isFragmented,
    triggerTerms: matched,
    minShotCount,
    editStyle,
  };
}

export function buildFragmentedShotBlock(
  context: FragmentedEditContext,
): string {
  if (!context.isFragmented) {
    return "";
  }

  const lines: string[] = [
    "## 편집 스타일: 분절 컷 (Fragmented Editing)",
    `- 최소 ${context.minShotCount}개 이상의 독립 shot 생성 필수`,
    `- 편집 리듬: ${context.editStyle}`,
    "- 각 shot의 framing을 다양하게 구성:",
    "  - WS (wide shot), MS (medium shot), CU (close-up), ECU (extreme close-up), insert shot 혼합",
    "  - 동일 framing 연속 2회 이상 금지",
    "- 각 shot의 카메라 앵글을 변화시킬 것:",
    "  - eye-level, low angle, high angle, overhead, dutch angle 등 혼합",
    "- 각 shot의 subject/피사체를 다양하게:",
    "  - 인물 전체 → 손 디테일 → 공간 전경 → 사물 인서트 → 인물 표정 등",
    '- "static with subtle micro-drift"를 모든 shot에 반복 사용 금지:',
    "  - 최소 절반 이상의 shot에 실제 카메라 움직임 적용 (dolly, pan, tilt, tracking 등)",
    "- 각 shot 간 시각적 대비가 뚜렷해야 함 (크기, 각도, 피사체 모두 변화)",
    "- shot_1 단독 + temporalBeats만으로 구성 금지 — 물리적으로 분리된 독립 shot 필수",
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Part 3: Validation
// ---------------------------------------------------------------------------

const KOREAN_ANCHOR_KEYWORDS = [
  "korean", "korea", "seoul", "busan", "incheon", "daegu",
  "gangnam", "hongdae", "itaewon", "myeongdong", "bukchon",
  "hanok", "officetel", "soju", "kimchi", "han river",
  "pojangmacha", "jjimjilbang", "noraebang", "goshiwon",
  "카페", "오피스텔", "아파트", "편의점", "지하철",
  "한국", "서울", "부산", "인천",
];

export function validateKoreanDefaults(
  cuts: Array<{ videoPrompt: string; shotCategory?: string }>,
  options?: {
    subjectContext?: SubjectContext;
    fragmentedContext?: FragmentedEditContext;
  },
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const subjectCtx = options?.subjectContext;
  const fragmentedCtx = options?.fragmentedContext;

  // Check 1: Modern scene without Korean cultural/location anchors
  if (subjectCtx?.isModernSetting && !subjectCtx.hasExplicitNationality) {
    for (let i = 0; i < cuts.length; i++) {
      const prompt = cuts[i].videoPrompt.toLowerCase();
      const hasKoreanAnchor = KOREAN_ANCHOR_KEYWORDS.some((kw) =>
        prompt.includes(kw),
      );
      if (!hasKoreanAnchor) {
        warnings.push({
          code: "missing_korean_anchor",
          message: `Cut ${i + 1}: modern Korean setting detected but video prompt contains no Korean cultural or location anchors. Consider adding Korean-specific context (e.g., Seoul officetel, Korean apartment, subway platform).`,
          cutNumber: i + 1,
        });
      }
    }
  }

  // Check 2: Male bias detection — all characters male when no gender specified
  if (
    subjectCtx &&
    subjectCtx.detectedGender === "unspecified" &&
    cuts.length >= 2
  ) {
    const maleIndicators = [
      "man", "male", "he ", "his ", "him ", "boy",
      "businessman", "father", "grandfather",
      "남자", "남성", "아버지", "할아버지",
    ];
    const femaleIndicators = [
      "woman", "female", "she ", "her ", "girl",
      "businesswoman", "mother", "grandmother",
      "여자", "여성", "엄마", "할머니",
    ];

    let maleCount = 0;
    let femaleCount = 0;

    for (const cut of cuts) {
      const prompt = cut.videoPrompt.toLowerCase();
      const hasMale = maleIndicators.some((ind) => prompt.includes(ind));
      const hasFemale = femaleIndicators.some((ind) => prompt.includes(ind));
      if (hasMale && !hasFemale) maleCount++;
      if (hasFemale && !hasMale) femaleCount++;
    }

    if (maleCount >= 2 && femaleCount === 0) {
      warnings.push({
        code: "male_bias_detected",
        message: `All ${maleCount} character references are male, but no gender was specified in the story. Consider varying character gender across shots to avoid male default bias.`,
      });
    }
  }

  // Check 3: Fragmented edit requested but only 1-2 shots
  if (fragmentedCtx?.isFragmented) {
    if (cuts.length < fragmentedCtx.minShotCount) {
      if (cuts.length <= 2) {
        warnings.push({
          code: "single_shot_fragmented",
          message: `Fragmented editing style was requested (${fragmentedCtx.triggerTerms.join(", ")}), but only ${cuts.length} shot(s) generated. Minimum ${fragmentedCtx.minShotCount} independent shots required for fragmented editing.`,
        });
      }
    }

    // Check 4: shot_1 alone with only temporalBeats
    if (cuts.length === 1) {
      const prompt = cuts[0].videoPrompt.toLowerCase();
      const hasTemporalBeats =
        prompt.includes("temporalbeat") ||
        prompt.includes("temporal beat") ||
        prompt.includes("temporal_beat");
      if (hasTemporalBeats) {
        warnings.push({
          code: "single_shot_fragmented",
          message:
            "Fragmented editing requested but only shot_1 exists with temporalBeats. Fragmented editing requires physically separate, independent shots — not internal temporal subdivisions of a single shot.",
          cutNumber: 1,
        });
      }
    }
  }

  return warnings;
}
