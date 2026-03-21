import { GeminiEnv, fetchWithAuth, fetchWithModelFallback, buildGeminiUrl, GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH, GEMINI_MODEL_SEARCH, geminiErrorResponse, parseFirstJsonObject } from "./_gemini-keys";
import {
  generateSlugId,
  extractGroundingSources,
  computeGroundingQuality,
  buildLocalNameSet,
  isLocalDuplicate,
  clampFitScore,
  ensureReason,
  isGenericReason,
  type GroundingQuality,
} from "./_director-shared";

type Env = GeminiEnv;

// ═══════════════════════════════════════════════════════════════════
// Rule-based Pre-extraction (Gemini fallback 보강용)
// ═══════════════════════════════════════════════════════════════════

export interface PreExtractedSignals {
  genres: string[];
  moods: string[];
  keywords: string[];
  formatHints: string[];
  visualHints: string[];
  pacingHints: string[];
  contentType: string | null;
  reasons: string[];  // debug: 왜 이 신호가 잡혔는지
}

/**
 * 규칙 기반 사전 신호 추출.
 * Gemini 추출이 weak/failed일 때 fallback으로 사용.
 * 보수적 추론 — 과도한 억측 금지.
 */
export function preExtractSignals(storyText: string): PreExtractedSignals {
  const text = storyText.toLowerCase();
  const genres: string[] = [];
  const moods: string[] = [];
  const keywords: string[] = [];
  const formatHints: string[] = [];
  const visualHints: string[] = [];
  const pacingHints: string[] = [];
  const reasons: string[] = [];

  // ── Content type / format detection ──
  let contentType: string | null = null;

  if (/(?:만약|않았다면|없었다면|했더라면|가정|what[\s-]*if|대안|다른\s*길|평행|상상해\s*보|가정해\s*보)/.test(text)) {
    contentType = "what-if";
    formatHints.push("speculative", "what-if");
    reasons.push("what-if/speculative format detected from keywords");
  }
  if (/(?:설명|알아보|정리해|이해하|분석해|해설|개념|원리|메커니즘)/.test(text)) {
    formatHints.push("explainer");
    if (!contentType) contentType = "explainer";
    reasons.push("explainer format detected");
  }
  if (/(?:시나리오|상황을\s*가정|만일|가상의|hypothetical|thought\s*experiment)/.test(text)) {
    formatHints.push("scenario");
    if (!contentType) contentType = "scenario";
    reasons.push("scenario/thought-experiment format detected");
  }
  if (/(?:다른\s*세계|평행\s*우주|대체\s*역사|alternate|parallel|다른\s*현실)/.test(text)) {
    formatHints.push("alternate-reality");
    if (!contentType) contentType = "alternate-reality";
    reasons.push("alternate reality format detected");
  }
  if (/(?:역사|시대|왕조|조선|고려|삼국|로마|제국|혁명|독립|전쟁사|세계대전|식민|근대|고대|중세|문명사|사료|역사적|연대기|연표)/.test(text)) {
    formatHints.push("history");
    if (!contentType) contentType = "history";
    reasons.push("history/period format detected");
    // 역사 콘텐츠는 장르 힌트를 직접 생성
    if (!genres.includes("드라마")) {
      genres.push("드라마");
      reasons.push("inferred drama from history format");
    }
  }

  // ── what-if + history 복합 시그널 보강 ──
  if (formatHints.includes("what-if") && formatHints.includes("history")) {
    // "만약 역사가 달랐다면" 류 — 시각적으로 강한 장르 신호
    if (!genres.includes("전쟁")) {
      if (/(?:전쟁|전투|침략|정복|군|병|싸움|세계대전|승리|패배|점령)/.test(text)) {
        genres.push("전쟁");
        reasons.push("inferred war genre from what-if + history + military keywords");
      }
    }
    if (!moods.includes("비장한")) {
      moods.push("비장한");
      reasons.push("inferred epic mood from what-if + history combo");
    }
    if (!moods.includes("철학적")) {
      moods.push("철학적");
      reasons.push("inferred philosophical mood from what-if + history combo");
    }
  }

  // ── Direct genre keywords (Korean + English) ──
  const genreMap: [RegExp, string][] = [
    [/(?:로맨스|사랑|연인|연애|설레|키스)/, "로맨스"],
    [/(?:호러|공포|귀신|유령|좀비|저주|괴물|으스스|horror)/, "호러"],
    [/(?:스릴러|추격|도주|쫓기|쫓아|범인|범죄|살인|미스터리|수사|탐정|사건)/, "스릴러"],
    [/(?:코미디|웃기|유머|개그|웃음|장난)/, "코미디"],
    [/(?:액션|폭발|전투|격투|싸움|추격전|총|무기)/, "액션"],
    [/(?:sf|sci[\s-]*fi|과학|우주|로봇|인공지능|ai|미래\s*사회|시간\s*여행|타임)/, "SF"],
    [/(?:판타지|마법|용|요정|마녀|주문|이세계|환상)/, "판타지"],
    [/(?:드라마|감동|눈물|이별|재회|성장|갈등)/, "드라마"],
    [/(?:다큐멘터리|다큐|르포|관찰\s*카메라|사실\s*기반|기록\s*영화|실화)/, "다큐멘터리"],
    [/(?:무협|검객|무림|내공|검|무공|도장|사부)/, "무협"],
    [/(?:느와르|범죄\s*도시|하드보일드|갱|마피아|조직)/, "느와르"],
    [/(?:청춘|학교|대학|고3|졸업|방학|캠퍼스)/, "청춘"],
    [/(?:전쟁|군인|병사|전장|참호|폭격|군대)/, "전쟁"],
    [/(?:멜로|melodrama|감정|순정|첫사랑)/, "멜로"],
    [/(?:애니메이션|anime|만화|2d|3d\s*애니)/, "애니메이션"],
    [/(?:뮤지컬|musical|노래|춤|댄스|무대)/, "뮤지컬"],
  ];

  for (const [pattern, genre] of genreMap) {
    if (pattern.test(text) && !genres.includes(genre)) {
      genres.push(genre);
      reasons.push(`explicit genre keyword: ${genre}`);
    }
  }

  // ── Indirect genre inference (weak signals from what-if + context) ──
  if (formatHints.includes("speculative") || formatHints.includes("what-if")) {
    if (/(?:기술|미래|사회\s*변화|인류|문명|진화|AI|로봇|우주|디지털)/.test(text)) {
      if (!genres.includes("SF")) {
        genres.push("SF");
        reasons.push("inferred SF from speculative format + tech/future keywords");
      }
    }
    if (/(?:감정|관계|사랑|상실|기억|외로|그리움|이별)/.test(text)) {
      if (!genres.includes("드라마")) {
        genres.push("드라마");
        reasons.push("inferred drama from speculative format + emotional keywords");
      }
    }
    if (/(?:기괴|비현실|꿈|악몽|환각|왜곡|변형|초현실)/.test(text)) {
      if (!genres.includes("판타지")) {
        genres.push("판타지");
        reasons.push("inferred fantasy from speculative format + surreal keywords");
      }
    }
    // what-if에서 장르가 하나도 안 잡혔으면 드라마를 기본값으로
    if (genres.length === 0) {
      genres.push("드라마");
      reasons.push("speculative format with no explicit genre → default drama");
    }
  }

  // ── Direct mood keywords ──
  const moodMap: [RegExp, string][] = [
    [/(?:따뜻하?게?|따스하?게?|온기|포근)/, "따뜻한"],
    [/(?:차갑?게?|냉랭|서늘|냉혹|싸늘)/, "차가운"],
    [/(?:불안하?게?|초조|긴장|조마조마)/, "불안한"],
    [/(?:쓸쓸하?게?|외로|고독|적막|쓸쓸)/, "쓸쓸한"],
    [/(?:몽환|꿈\s*같|꿈\s*속|dreamlike|dreamy|몽롱)/, "몽환적"],
    [/(?:초현실|surreal|비현실|현실.*흔들|현실.*무너)/, "초현실적"],
    [/(?:우울|멜랑콜리|melanchol|암울|음울|침울)/, "우울한"],
    [/(?:서정|서정적|lyrical|감성적|감성)/, "서정적"],
    [/(?:공포|섬뜩|으스스|creepy)/, "공포"],
    [/(?:긴장|tension|tense|팽팽|위기|위험|아슬)/, "긴장"],
    [/(?:유머|웃기|코믹|재미|유쾌|즐거)/, "유머"],
    [/(?:비장|장엄|epic|웅장|거대|압도)/, "비장한"],
    [/(?:잔잔|평화|고요|정적|calm|tranquil|peaceful)/, "잔잔한"],
    [/(?:역동|다이나믹|dynamic|빠른|속도감|질주)/, "역동적"],
    [/(?:신비|mysterious|미스터리|enigma|수수께끼)/, "신비로운"],
    [/(?:노스탤지|향수|그때|그\s*시절|옛날|추억)/, "노스탤지어"],
    [/(?:퇴폐|decadent|타락|쾌락|퇴락)/, "퇴폐적"],
    [/(?:철학|philosophical|존재|의미|삶.*죽음|본질)/, "철학적"],
  ];

  for (const [pattern, mood] of moodMap) {
    if (pattern.test(text) && !moods.includes(mood)) {
      moods.push(mood);
      reasons.push(`mood detected: ${mood}`);
    }
  }

  // ── Indirect mood inference ──
  if (/(?:기억.*사라|기억.*잃|기억이\s*없|잊혀|잊어|망각)/.test(text)) {
    if (!moods.includes("몽환적")) moods.push("몽환적");
    if (!moods.includes("우울한")) moods.push("우울한");
    reasons.push("inferred dreamlike/melancholic mood from memory-loss imagery");
  }
  if (/(?:현실.*흔들|세계.*무너|경계.*흐려|현실.*꿈|꿈.*현실)/.test(text)) {
    if (!moods.includes("초현실적")) moods.push("초현실적");
    reasons.push("inferred surreal mood from reality-distortion imagery");
  }
  if (/(?:시간.*멈|시간.*거꾸로|시간.*역행|시간.*느려|시간.*빨라)/.test(text)) {
    if (!moods.includes("신비로운")) moods.push("신비로운");
    reasons.push("inferred mysterious mood from time-manipulation imagery");
  }

  // ── Visual hints ──
  const visualMap: [RegExp, string][] = [
    [/(?:네온|neon)/, "neon"],
    [/(?:비\s|빗방울|빗속|비\s*오|비가\s*오|비가\s*내)/, "rain"],
    [/(?:도시.*밤|밤.*도시|야경|도심\s*밤|도시\s*불빛)/, "urban-night"],
    [/(?:골목|뒷골목|back\s*alley)/, "alley"],
    [/(?:아스팔트|포장\s*도로|젖은\s*길)/, "wet-asphalt"],
    [/(?:안개|fog|mist|자욱)/, "fog"],
    [/(?:연기|smoke|스모크)/, "smoke"],
    [/(?:달빛|moonlight|달이\s*비)/, "moonlight"],
    [/(?:석양|일몰|sunset|노을)/, "sunset"],
    [/(?:새벽|dawn|여명|동이\s*트)/, "dawn"],
    [/(?:눈\s|눈이\s*내|눈\s*위|설원|snow)/, "snow"],
    [/(?:바다|해변|파도|ocean|sea|해안)/, "ocean"],
    [/(?:숲\s|숲\s*속|산림|나무\s*사이|forest)/, "forest"],
    [/(?:폐허|폐건물|폐공장|버려진|abandoned|ruins)/, "ruins"],
    [/(?:대칭|symmetry|symmetric|좌우\s*대칭)/, "symmetry"],
    [/(?:슬로\s*모션|slow\s*motion|느린\s*동작)/, "slow-motion"],
    [/(?:흑백|black\s*and\s*white|모노크롬|monochrome)/, "black-and-white"],
    [/(?:실루엣|silhouette|그림자)/, "silhouette"],
    [/(?:거울|반사|reflection|유리.*비친|수면.*비)/, "reflection"],
    [/(?:한자\s*간판|간판.*번지|간판)/, "signage"],
  ];

  for (const [pattern, hint] of visualMap) {
    if (pattern.test(text) && !visualHints.includes(hint)) {
      visualHints.push(hint);
      reasons.push(`visual hint: ${hint}`);
    }
  }

  // ── Pacing hints ──
  if (/(?:느린\s*시선|천천히|느리게|느린|장회\s*숏|롱\s*테이크|long\s*take)/.test(text)) {
    pacingHints.push("slow");
    reasons.push("pacing hint: slow/contemplative");
  }
  if (/(?:빠르게|빠른|급히|전력|질주|속도|빠른\s*편집|quick\s*cut)/.test(text)) {
    pacingHints.push("fast");
    reasons.push("pacing hint: fast/dynamic");
  }
  if (/(?:교차|인터컷|intercut|플래시백|flashback|과거.*현재|현재.*과거)/.test(text)) {
    pacingHints.push("intercut");
    reasons.push("pacing hint: intercut/flashback editing");
  }

  // ── Visual-style combo inferences (weak) ──
  if (visualHints.includes("neon") && (visualHints.includes("urban-night") || visualHints.includes("rain") || visualHints.includes("wet-asphalt"))) {
    if (!genres.includes("느와르") && !genres.includes("SF")) {
      genres.push("느와르");
      reasons.push("inferred noir from neon + urban-night/rain visual combo");
    }
    if (!moods.includes("퇴폐적")) {
      moods.push("퇴폐적");
      reasons.push("inferred decadent mood from neon+rain visual combo");
    }
  }

  // ── Format-to-mood weak links ──
  if (formatHints.includes("speculative") && moods.length === 0) {
    moods.push("철학적");
    reasons.push("weak mood inference: speculative format with no explicit mood → philosophical");
  }
  if (formatHints.includes("alternate-reality")) {
    if (!moods.includes("신비로운")) {
      moods.push("신비로운");
      reasons.push("weak mood inference: alternate-reality → mysterious");
    }
  }

  return { genres, moods, keywords, formatHints, visualHints, pacingHints, contentType, reasons };
}

/**
 * 사전 추출된 신호를 Gemini 결과에 병합 (fallback only).
 * Gemini가 이미 잡은 신호는 유지하고, 비어 있는 필드만 보강.
 */
export function mergePreExtractedSignals(
  geminiGenres: string[],
  geminiMoods: string[],
  geminiKeywords: string[],
  pre: PreExtractedSignals
): {
  genres: string[];
  moods: string[];
  keywords: string[];
  mergeReasons: string[];
} {
  const mergeReasons: string[] = [];

  // Genres: Gemini 우선, 비었을 때만 보강
  let genres = geminiGenres;
  if (genres.length === 0 && pre.genres.length > 0) {
    genres = pre.genres;
    mergeReasons.push(`genres补充: Gemini empty → pre-extracted ${pre.genres.join(", ")}`);
  } else if (genres.length > 0 && pre.genres.length > 0) {
    // Gemini가 잡은 것 유지, 추가로 pre에서 새로운 것만 보충 (최대 2개)
    const newGenres = pre.genres.filter(g => !genres.includes(g)).slice(0, 2);
    if (newGenres.length > 0) {
      genres = [...genres, ...newGenres];
      mergeReasons.push(`genres augmented with pre-extracted: ${newGenres.join(", ")}`);
    }
  }

  // Moods: 같은 전략
  let moods = geminiMoods;
  if (moods.length === 0 && pre.moods.length > 0) {
    moods = pre.moods;
    mergeReasons.push(`moods補充: Gemini empty → pre-extracted ${pre.moods.join(", ")}`);
  } else if (moods.length > 0 && pre.moods.length > 0) {
    const newMoods = pre.moods.filter(m => !moods.includes(m)).slice(0, 2);
    if (newMoods.length > 0) {
      moods = [...moods, ...newMoods];
      mergeReasons.push(`moods augmented with pre-extracted: ${newMoods.join(", ")}`);
    }
  }

  // Keywords: visual + pacing hints를 키워드로 변환
  let keywords = geminiKeywords;
  if (keywords.length === 0) {
    const combined = [...pre.visualHints, ...pre.pacingHints, ...pre.formatHints].slice(0, 5);
    if (combined.length > 0) {
      keywords = combined;
      mergeReasons.push(`keywords補充: Gemini empty → pre-extracted hints ${combined.join(", ")}`);
    }
  }

  return { genres, moods, keywords, mergeReasons };
}

/**
 * 사전 추출 신호 기반으로 더 나은 웹 검색 쿼리 생성.
 * 기존 쿼리가 너무 빈약할 때 (genres+moods+keywords 모두 짧을 때) 보강.
 */
/**
 * 한글 장르/무드를 영문으로 변환하는 맵.
 * 웹 검색 쿼리는 반드시 영문으로 구성해야 Google Search Retrieval API가 400을 반환하지 않는다.
 */
const GENRE_KO_TO_EN: Record<string, string> = {
  "로맨스": "romance", "호러": "horror", "스릴러": "thriller", "코미디": "comedy",
  "액션": "action", "SF": "sci-fi", "판타지": "fantasy", "드라마": "drama",
  "다큐멘터리": "documentary", "무협": "martial arts", "느와르": "noir",
  "청춘": "coming-of-age", "전쟁": "war", "멜로": "melodrama",
  "애니메이션": "animation", "뮤지컬": "musical",
};
const MOOD_KO_TO_EN: Record<string, string> = {
  "따뜻한": "warm", "차가운": "cold", "불안한": "anxious", "쓸쓸한": "lonely",
  "몽환적": "dreamlike", "초현실적": "surreal", "우울한": "melancholic",
  "서정적": "lyrical", "공포": "fearful", "긴장": "tense", "유머": "humorous",
  "비장한": "epic", "잔잔한": "calm", "역동적": "dynamic", "신비로운": "mysterious",
  "노스탤지어": "nostalgic", "퇴폐적": "decadent", "철학적": "philosophical",
};

function toEnglish(term: string): string {
  return GENRE_KO_TO_EN[term] || MOOD_KO_TO_EN[term] || term;
}

export function buildEnhancedWebSearchQuery(
  genres: string[],
  moods: string[],
  keywords: string[],
  pre: PreExtractedSignals,
): { query: string; queryReasons: string[] } {
  const queryReasons: string[] = [];

  // 기본 소재 수집 — 반드시 영문 변환
  const genreParts = genres.slice(0, 3).map(toEnglish);
  const moodParts = moods.slice(0, 2).map(toEnglish);
  const keyParts = keywords.slice(0, 2).map(toEnglish);

  // 추가 보강: visual hints → 영문 스타일 키워드
  const visualStyleMap: Record<string, string> = {
    "neon": "neon-lit",
    "rain": "rain",
    "urban-night": "urban night",
    "fog": "foggy",
    "smoke": "smoky",
    "moonlight": "moonlit",
    "sunset": "golden hour",
    "dawn": "dawn",
    "snow": "snowy",
    "ocean": "oceanic",
    "ruins": "abandoned",
    "symmetry": "symmetrical composition",
    "slow-motion": "slow motion",
    "black-and-white": "black and white",
    "silhouette": "silhouette",
    "reflection": "reflections",
  };

  const extraVisual: string[] = [];
  if (genreParts.length + moodParts.length < 3) {
    for (const vh of pre.visualHints.slice(0, 3)) {
      if (visualStyleMap[vh]) extraVisual.push(visualStyleMap[vh]);
    }
    if (extraVisual.length > 0) {
      queryReasons.push(`visual hints → query: ${extraVisual.join(", ")}`);
    }
  }

  // format hints → 영문
  const formatMap: Record<string, string> = {
    "speculative": "speculative",
    "what-if": "what-if",
    "explainer": "explanatory",
    "scenario": "scenario-driven",
    "alternate-reality": "alternate reality",
  };
  const extraFormat: string[] = [];
  if (genreParts.length === 0 && pre.formatHints.length > 0) {
    for (const fh of pre.formatHints.slice(0, 2)) {
      if (formatMap[fh]) extraFormat.push(formatMap[fh]);
    }
    if (extraFormat.length > 0) {
      queryReasons.push(`format hints → query: ${extraFormat.join(", ")}`);
    }
  }

  // pacing hints
  const pacingMap: Record<string, string> = {
    "slow": "contemplative slow-paced",
    "fast": "fast-paced dynamic",
    "intercut": "intercut editing",
  };
  const extraPacing: string[] = [];
  if (moodParts.length === 0 && pre.pacingHints.length > 0) {
    for (const ph of pre.pacingHints.slice(0, 1)) {
      if (pacingMap[ph]) extraPacing.push(pacingMap[ph]);
    }
  }

  // 조립 (중복 제거)
  const allPartsRaw = [
    ...genreParts,
    ...moodParts,
    ...keyParts,
    ...extraVisual,
    ...extraFormat,
    ...extraPacing,
  ].filter(Boolean);
  const allParts = [...new Set(allPartsRaw)];

  // 완전히 빈 경우 최소 쿼리 보장
  if (allParts.length === 0) {
    queryReasons.push("all signals empty — using generic storytelling query");
    return {
      query: "best film directors for unique visual storytelling cinematography",
      queryReasons,
    };
  }

  const query = `best film directors for ${allParts.join(" ")} cinematography style`;
  queryReasons.push(`query built from ${allParts.length} signal parts (all English)`);

  return { query, queryReasons };
}

/**
 * weak_query 자동 보정: 시나리오 텍스트에서 핵심 명사를 추출하여 영문 쿼리로 변환.
 * buildEnhancedWebSearchQuery가 generic query를 생성했을 때 호출.
 */
export function correctWeakQuery(storyText: string): { query: string; reason: string } | null {
  const keyNounPatterns = [
    /(?:전사|전투|전쟁|군대|병사)/g, /(?:사무라이|무사|검객)/g,
    /(?:우주|행성|은하|외계)/g, /(?:AI|로봇|인공지능)/g,
    /(?:범죄|수사|추격|살인)/g, /(?:사랑|연인|이별)/g,
    /(?:마법|환상|판타지)/g, /(?:스파르타|로마|중세)/g,
    /(?:도시|골목|거리|빌딩)/g, /(?:바다|산|숲|자연)/g,
    /(?:학교|학생|선생|교실)/g, /(?:가족|부모|아이|형제)/g,
    /(?:요리|음식|셰프|레스토랑)/g, /(?:음악|밴드|콘서트|노래)/g,
    /(?:스포츠|경기|선수|올림픽)/g, /(?:기억|꿈|무의식)/g,
    /(?:시간|과거|미래|역사)/g, /(?:동물|야생|사파리)/g,
    /(?:왕조|조선|고려|삼국|제국|혁명|독립|식민|근대|고대)/g,
    /(?:문명|왕|황제|장군|영웅|정복)/g,
  ];
  const nounEnMap: Record<string, string> = {
    "전사": "warrior", "전투": "battle", "전쟁": "war", "군대": "military", "병사": "soldier",
    "사무라이": "samurai", "무사": "warrior", "검객": "swordsman",
    "우주": "space", "행성": "planet", "은하": "galaxy", "외계": "alien",
    "AI": "AI", "로봇": "robot", "인공지능": "AI",
    "범죄": "crime", "수사": "investigation", "추격": "chase", "살인": "murder",
    "사랑": "love", "연인": "romance", "이별": "breakup",
    "마법": "magic", "환상": "fantasy", "판타지": "fantasy",
    "스파르타": "Sparta", "로마": "Rome", "중세": "medieval",
    "도시": "urban", "골목": "alley", "거리": "street", "빌딩": "building",
    "바다": "ocean", "산": "mountain", "숲": "forest", "자연": "nature",
    "학교": "school", "학생": "student", "가족": "family", "부모": "parents",
    "요리": "cooking", "음식": "food", "셰프": "chef",
    "음악": "music", "밴드": "band", "콘서트": "concert",
    "스포츠": "sports", "경기": "competition", "선수": "athlete",
    "기억": "memory", "꿈": "dream", "무의식": "subconscious",
    "시간": "time", "과거": "past", "미래": "future", "역사": "history",
    "동물": "animal", "야생": "wild",
    "왕조": "dynasty", "조선": "Joseon", "고려": "Goryeo", "삼국": "Three Kingdoms",
    "제국": "empire", "혁명": "revolution", "독립": "independence", "식민": "colonial",
    "근대": "modern era", "고대": "ancient", "문명": "civilization",
    "왕": "king", "황제": "emperor", "장군": "general", "영웅": "hero", "정복": "conquest",
  };
  const foundNouns: string[] = [];
  for (const pattern of keyNounPatterns) {
    const matches = storyText.match(pattern);
    if (matches) {
      for (const m of matches) {
        const en = nounEnMap[m];
        if (en && !foundNouns.includes(en)) foundNouns.push(en);
      }
    }
  }
  if (foundNouns.length > 0) {
    const correctedParts = foundNouns.slice(0, 3).join(" ");
    return {
      query: `best film directors for ${correctedParts} visual storytelling cinematography`,
      reason: `weak_query 보정: generic → ${correctedParts}`,
    };
  }
  return null;
}

/**
 * Stage 2용 쿼리 단순화: 기존 쿼리에서 핵심 키워드만 남기고 "unique lesser-known" 추가.
 * Stage 1과 반드시 다른 쿼리를 생성한다.
 */
export function simplifyQueryForRetry(
  originalQuery: string,
  genres: string[],
  moods: string[],
): string {
  // 장르/무드에서 상위 2개만 사용
  const topGenres = genres.slice(0, 2).map(toEnglish).filter(Boolean);
  const topMoods = moods.slice(0, 1).map(toEnglish).filter(Boolean);
  const parts = [...topGenres, ...topMoods].filter(Boolean);
  if (parts.length === 0) {
    // 원래 쿼리에서 "best film directors for " 이후를 추출하고 축약
    const afterPrefix = originalQuery.replace(/^best film directors for\s*/i, "");
    const words = afterPrefix.split(/\s+/).slice(0, 3);
    return `unique lesser-known film directors ${words.join(" ")} visual style`;
  }
  return `unique lesser-known film directors ${parts.join(" ")} visual style`;
}

interface LocalDirectorInfo {
  id: string;
  name: string;
  nameKo: string;
  region: string;
  style: string;
}

// ═══════════════════════════════════════════════════════════════════
// Debug Types
// ═══════════════════════════════════════════════════════════════════

interface StageStatus {
  extractSignals: "ok" | "weak" | "failed";
  localMatch: "ok" | "empty" | "invalid_ids" | "filtered_out" | "failed";
  webSearch: "not_attempted" | "attempted_success" | "attempted_empty" | "failed";
  finalAssembly: "ok" | "empty" | "failed";
}

interface StageReasons {
  extractSignals?: string;
  localMatch?: string;
  webSearch?: string;
  finalAssembly?: string;
}

/**
 * 웹 검색 빈 결과 원인 분류 코드.
 * attempted_empty일 때 정확히 왜 0건인지 세분화.
 */
export type WebSearchEmptyReason =
  | "parse_failed"              // JSON 파싱 실패 — 모델이 자연어로 응답
  | "provider_failed"           // 웹 검색 API HTTP 에러 (non-timeout)
  | "provider_timeout"          // 웹 검색 API 타임아웃 (AbortError / 504)
  | "provider_empty"            // API 성공이지만 모델이 감독 목록 자체를 안 줌
  | "duplicate_filtered_all"    // 후보 전멸 — 로컬 풀과 전부 중복
  | "weak_query"                // 검색 쿼리가 약해 의미 있는 결과 못 얻음
  | "missing_required_fields"   // name/nameKo 누락으로 전원 탈락
  | "validation_rejected_all"   // 기타 유효성 검증으로 전원 탈락
  | "fallback_empty"            // 모든 재시도/폴백까지 0건
  | "pipeline_deadline_exceeded" // 집계 타임아웃 초과
  | "unknown";                  // 분류 불가

/**
 * 재시도 파이프라인 한 단계의 실행 기록.
 */
export interface RetryStageLog {
  stage: number;
  name: string;
  model: string;
  grounded: boolean;
  normalizedQuery: string;
  timeoutOccurred: boolean;
  httpStatus: number | null;
  rawResultCount: number;
  acceptedCount: number;
  rejectedCount: number;
  emptyReasons: WebSearchEmptyReason[];
  triggerReason: string;
  partialRecoveryCount: number;
  durationMs: number;
  groundingDiag?: Record<string, unknown>;
}

interface DirectorRecommendationDebug {
  stageStatus: StageStatus;
  stageReasons: StageReasons;
  extractedGenres: string[];
  extractedMoods: string[];
  extractedKeywords: string[];
  consideredLocalCount: number;
  consideredLocalIds: string[];
  validLocalCount: number;
  invalidIdsRemoved: string[];
  rejectedLocalIds: string[];
  localRejectionReasons: string[];
  attemptedWebSearch: boolean;
  webSearchProvider: string | null;
  webSearchQuery: string | null;
  webSearchResultCount: number;
  webSearchAcceptedCount: number;
  webSearchRejectedCount: number;
  webSearchRejectionReasons: string[];
  webSearchAttemptCount: number;
  webSearchRawBeforeDedup: number;
  webSearchDedupRemoved: number;
  webSearchRetryReason: string | null;
  webSearchRawSnippet?: string; // 웹 검색 raw 응답 첫 200자 (디버그용)
  localMatchRawSnippet?: string; // 로컬 매칭 raw 응답 첫 200자 (디버그용)
  localResultCount: number;
  externalResultCount: number;
  finalResultCount: number;
  emptyReason?: string;
  /** 웹 검색 0건 세부 원인 코드 목록 */
  webSearchEmptyReasons?: WebSearchEmptyReason[];
  /** 최종 원인 코드 목록 (파이프라인 전체 요약) */
  finalReasonCodes?: WebSearchEmptyReason[];
  /** 쿼리 보정 여부 및 보정 사유 */
  webSearchQueryCorrected?: boolean;
  webSearchQueryCorrectionReason?: string;
  /** 필드 누락으로 부분 복구된 후보 수 */
  webSearchPartialRecoveryCount?: number;
  /** 재시도 파이프라인 각 단계 기록 */
  retryStages?: RetryStageLog[];
  /** 최종 provider */
  finalProvider?: string;
  /** 최종 결과가 grounded인지 */
  finalGrounded?: boolean;
  /** 폴백 사용 여부 */
  fallbackUsed?: boolean;
  /** 타임아웃 발생 여부 */
  timeoutOccurred?: boolean;
  modelUsed: string;
  preExtracted?: PreExtractedSignals;
  signalMergeReasons?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { storyText, localDirectors } = await context.request.json() as {
      storyText: string;
      localDirectors: LocalDirectorInfo[];
    };

    if (!storyText || typeof storyText !== "string") {
      return Response.json({ error: "storyText is required" }, { status: 400 });
    }

    const validLocalIds = new Set((localDirectors || []).map(d => d.id));
    const directorPoolSize = validLocalIds.size;

    // ── Debug state ──
    const stageStatus: StageStatus = {
      extractSignals: "failed",
      localMatch: "failed",
      webSearch: "not_attempted",
      finalAssembly: "failed",
    };
    const stageReasons: StageReasons = {};

    let extractedGenres: string[] = [];
    let extractedMoods: string[] = [];
    let extractedKeywords: string[] = [];
    let consideredLocalIds: string[] = [];
    let rejectedLocalIds: string[] = [];
    let localRejectionReasons: string[] = [];
    let invalidIdsRemoved: string[] = [];

    // ── 규칙 기반 사전 추출 (Gemini fallback) ──
    const preSignals = preExtractSignals(storyText);

    // Raw response snippets for debug
    let localMatchRawSnippet = "";
    let webSearchRawSnippet = "";

    // Web search state
    let attemptedWebSearch = false;
    let webSearchProvider: string | null = null;
    let webSearchQuery: string | null = null;
    let webSearchResultCount = 0;
    let webSearchAcceptedCount = 0;
    let webSearchRejectedCount = 0;
    let webSearchRejectionReasons: string[] = [];

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Gemini 기반 로컬 매칭 (기존 로직)
    // ═══════════════════════════════════════════════════════════

    const localList = (localDirectors || [])
      .map((d) => `- id:"${d.id}" | ${d.nameKo} (${d.name}) | ${d.region} | ${d.style}`)
      .join("\n");

    // Gemini에 보조 힌트 전달 (사전 추출 결과)
    const preHintLines: string[] = [];
    if (preSignals.contentType) {
      preHintLines.push(`- 입력 형식: ${preSignals.contentType}`);
    }
    if (preSignals.formatHints.length > 0) {
      preHintLines.push(`- 형식 힌트: ${preSignals.formatHints.join(", ")}`);
    }
    if (preSignals.genres.length > 0) {
      preHintLines.push(`- 사전 감지 장르 후보: ${preSignals.genres.join(", ")} (참고용, 확정 아님)`);
    }
    if (preSignals.moods.length > 0) {
      preHintLines.push(`- 사전 감지 무드 후보: ${preSignals.moods.join(", ")} (참고용, 확정 아님)`);
    }
    if (preSignals.visualHints.length > 0) {
      preHintLines.push(`- 시각적 힌트: ${preSignals.visualHints.join(", ")}`);
    }
    const preHintBlock = preHintLines.length > 0
      ? `\n\n## 사전 분석 힌트 (참고용)\n${preHintLines.join("\n")}\n위 힌트는 규칙 기반 자동 감지 결과입니다. 동의할 경우 추출 결과에 반영하고, 동의하지 않으면 무시하세요.`
      : "";

    const localPrompt = `당신은 영화 연출 전문가이자 AI 영상 감독 매칭 시스템입니다.

## 분석할 시나리오
${storyText.slice(0, 1200)}${preHintBlock}

## 보유 감독 목록 — 총 ${directorPoolSize}명
${localList}

## 임무
위 시나리오를 분석하고, 보유 감독 목록에서 가장 잘 어울리는 감독 1~3명을 추천하세요.

### 분석 결과 기록 (반드시 포함)
- extractedGenres: 장르 키워드 배열 (직접 키워드가 없더라도 맥락에서 유추 가능한 장르 포함. 단, 근거 있는 유추만 허용)
- extractedMoods: 무드 키워드 배열 (감정선, 분위기, 톤 등. 간접적 단서도 포함)
- extractedKeywords: 핵심 시각 키워드 배열 (장소, 오브젝트, 시각적 특징, 시대 배경 등)

### 로컬 감독 매칭 규칙
- 반드시 목록에 있는 id만 사용 (새로 만들지 말 것)
- 각 감독에 fitScore(0-100)과 reason(한국어 2문장) 포함
- 목록에 어울리는 감독이 없어도 가장 가까운 1명을 fitScore 30 이상으로 포함
- 검토했지만 제외한 감독이 있으면 rejectedLocalIds와 rejectionReasons에 기록

## 출력 형식 (순수 JSON)
{
  "_pipeline": {
    "extractedGenres": [],
    "extractedMoods": [],
    "extractedKeywords": [],
    "consideredLocalCount": 0,
    "consideredLocalIds": [],
    "rejectedLocalIds": [],
    "rejectionReasons": []
  },
  "analysis": "시나리오 특성 요약 2~3줄 (한국어)",
  "localMatches": [
    { "id": "기존 감독 id", "fitScore": 0-100, "reason": "한국어 2문장" }
  ]
}`;

    const localRequestBody = {
      contents: [{ role: "user", parts: [{ text: localPrompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
        responseMimeType: "application/json" as const,
      },
    };

    console.log(`[recommend-director] STEP 1: 로컬 매칭 시작 (model=pro→flash-lite fallback, pool=${directorPoolSize})`);

    const { response: res } = await fetchWithModelFallback(context.env, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(localRequestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[recommend-director] 로컬 매칭 최종 실패: status=${res.status}`);
      stageStatus.localMatch = "failed";
      stageReasons.localMatch = `API 실패 (${res.status})`;
      return geminiErrorResponse(res, errText, "recommend-director");
    }

    const modelUsed = res.url?.includes("flash") ? "flash" : res.url?.includes("pro") ? "pro" : "unknown";

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

    // ── 디버그: STEP 1 raw 응답 기록 ──
    localMatchRawSnippet = rawText.slice(0, 200);
    console.log(`[recommend-director] STEP 1 raw (first 500): ${rawText.slice(0, 500)}`);

    // 마크다운 코드 블록 제거
    let text = rawText;
    const step1CodeBlock = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (step1CodeBlock) {
      text = step1CodeBlock[1].trim();
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = (parseFirstJsonObject(text) as Record<string, unknown>) ?? { localMatches: [] };
    }

    // ── Extract pipeline metadata ──
    const geminiPipeline = (parsed._pipeline ?? {}) as Record<string, unknown>;
    extractedGenres = Array.isArray(geminiPipeline.extractedGenres) ? geminiPipeline.extractedGenres as string[] : [];
    extractedMoods = Array.isArray(geminiPipeline.extractedMoods) ? geminiPipeline.extractedMoods as string[] : [];
    extractedKeywords = Array.isArray(geminiPipeline.extractedKeywords) ? geminiPipeline.extractedKeywords as string[] : [];
    consideredLocalIds = Array.isArray(geminiPipeline.consideredLocalIds) ? geminiPipeline.consideredLocalIds as string[] : [];
    rejectedLocalIds = Array.isArray(geminiPipeline.rejectedLocalIds) ? geminiPipeline.rejectedLocalIds as string[] : [];
    localRejectionReasons = Array.isArray(geminiPipeline.rejectionReasons) ? geminiPipeline.rejectionReasons as string[] : [];

    // ── Merge pre-extracted signals as fallback ──
    const mergeResult = mergePreExtractedSignals(extractedGenres, extractedMoods, extractedKeywords, preSignals);
    extractedGenres = mergeResult.genres;
    extractedMoods = mergeResult.moods;
    extractedKeywords = mergeResult.keywords;

    // Signal extraction status — 상세 debug
    const signalDetails: string[] = [];

    // Gemini 원본이 비었는지
    const geminiGenreCount = (geminiPipeline.extractedGenres as string[] | undefined)?.length ?? 0;
    const geminiMoodCount = (geminiPipeline.extractedMoods as string[] | undefined)?.length ?? 0;
    if (geminiGenreCount === 0) signalDetails.push("no explicit genre keywords from Gemini");
    if (geminiMoodCount === 0) signalDetails.push("no explicit mood keywords from Gemini");

    // 사전 추출 보강 여부
    if (mergeResult.mergeReasons.length > 0) {
      signalDetails.push(...mergeResult.mergeReasons);
    }

    // content type / format hints
    if (preSignals.contentType) {
      signalDetails.push(`content type detected: ${preSignals.contentType}`);
    }
    if (preSignals.formatHints.length > 0) {
      signalDetails.push(`format hints: ${preSignals.formatHints.join(", ")}`);
    }
    if (preSignals.visualHints.length > 0) {
      signalDetails.push(`visual hints detected: ${preSignals.visualHints.join(", ")}`);
    }
    if (preSignals.pacingHints.length > 0) {
      signalDetails.push(`pacing hints detected: ${preSignals.pacingHints.join(", ")}`);
    }

    // 최종 판정
    if (extractedGenres.length > 0 || extractedMoods.length > 0) {
      if (geminiGenreCount === 0 && geminiMoodCount === 0) {
        // Gemini가 못 잡았지만 pre-extraction으로 보강됨
        stageStatus.extractSignals = "weak";
        signalDetails.push("Gemini extraction empty — supplemented by rule-based pre-extraction");
      } else {
        stageStatus.extractSignals = "ok";
      }
      stageReasons.extractSignals = `genres=${extractedGenres.length}, moods=${extractedMoods.length}, keywords=${extractedKeywords.length}` +
        (signalDetails.length > 0 ? ` | ${signalDetails.join("; ")}` : "");
    } else {
      stageStatus.extractSignals = "weak";
      stageReasons.extractSignals = `장르/무드 신호를 추출하지 못함` +
        (signalDetails.length > 0 ? ` | ${signalDetails.join("; ")}` : "") +
        (preSignals.reasons.length > 0 ? ` | pre-extraction notes: ${preSignals.reasons.join("; ")}` : "");
    }

    // ── Validate local matches ──
    const rawLocalMatches = Array.isArray(parsed.localMatches) ? parsed.localMatches as Array<Record<string, unknown>> : [];
    invalidIdsRemoved = rawLocalMatches.filter(m => !validLocalIds.has(String(m.id))).map(m => String(m.id));
    let localMatches = rawLocalMatches.filter(m => validLocalIds.has(String(m.id)));

    // Clamp fitScore + ensure reason
    for (const m of localMatches) {
      if (typeof m.fitScore === "number") m.fitScore = Math.max(0, Math.min(100, Math.round(m.fitScore)));
      if (!m.reason || typeof m.reason !== "string") m.reason = "(이유 미제공)";
    }

    if (localMatches.length > 0) {
      stageStatus.localMatch = "ok";
      stageReasons.localMatch = `${localMatches.length}명 매칭 성공`;
    } else if (invalidIdsRemoved.length > 0) {
      stageStatus.localMatch = "invalid_ids";
      stageReasons.localMatch = `Gemini가 생성한 id ${invalidIdsRemoved.length}개가 목록에 없어 제거됨`;
    } else if (rawLocalMatches.length === 0) {
      stageStatus.localMatch = "empty";
      stageReasons.localMatch = "Gemini가 로컬 매치를 반환하지 않음";
    }

    if (invalidIdsRemoved.length > 0) {
      console.warn(`[recommend-director] 환각 id ${invalidIdsRemoved.length}개 제거: ${invalidIdsRemoved.join(", ")}`);
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: 웹 검색 기반 외부 감독 추천 — Stage-based retry pipeline
    // ═══════════════════════════════════════════════════════════

    let webSuggestions: Array<Record<string, unknown>> = [];
    let webSearchAttemptCount = 0;
    let webSearchRawBeforeDedup = 0;
    let webSearchDedupRemoved = 0;
    let webSearchRetryReason: string | null = null;
    let webSearchEmptyReasons: WebSearchEmptyReason[] = [];
    let webSearchQueryCorrected = false;
    let webSearchQueryCorrectionReason: string | undefined;
    let webSearchPartialRecoveryCount = 0;
    const retryStagesLog: RetryStageLog[] = [];
    let finalProvider = "";
    let finalGrounded = false;
    let fallbackUsed = false;
    let groundingAttempted = false; // grounding을 시도했는지
    let groundingFailed = false;    // grounding을 시도했지만 소스가 없었는지
    let pipelineTimeoutOccurred = false;

    // ── Stage-based retry pipeline — reason code가 다음 action을 결정 ──
    {
      attemptedWebSearch = true;

      // ── 검색 쿼리 구성 ──
      const enhanced = buildEnhancedWebSearchQuery(extractedGenres, extractedMoods, extractedKeywords, preSignals);
      webSearchQuery = enhanced.query;
      if (enhanced.queryReasons.length > 0) {
        signalDetails.push(`web query: ${enhanced.queryReasons.join("; ")}`);
      }

      // ── weak_query 자동 보정 ──
      const isWeakQuery = enhanced.queryReasons.some(r => r.includes("generic storytelling"));
      if (isWeakQuery && storyText.length > 30) {
        const corrected = correctWeakQuery(storyText);
        if (corrected) {
          webSearchQuery = corrected.query;
          webSearchQueryCorrected = true;
          webSearchQueryCorrectionReason = corrected.reason;
          signalDetails.push(corrected.reason);
        }
      }

      const localNameSet = buildLocalNameSet(localDirectors || []);

      console.log(`[recommend-director] STEP 2: 웹 검색 파이프라인 시작 — query="${webSearchQuery}", localNames=${localNameSet.size}`);

      // ── 로컬 감독 제외 목록 (재시도별 강도 다름) ──
      const localNameExclusionPairs = (localDirectors || [])
        .slice(0, 20)
        .map(d => `${d.name} (${d.nameKo})`)
        .join(", ");

      // ── 프롬프트 빌더 ──
      const buildWebPrompt = (opts: { retryNote?: string; strengthenExclusion?: boolean; queryOverride?: string } = {}) => {
        const { retryNote = "", strengthenExclusion = false, queryOverride } = opts;
        const exclusionBlock = strengthenExclusion
          ? `## STRICT EXCLUSION LIST — do NOT recommend ANY of these directors under ANY name, alias, romanization, or indirect reference:\n${localNameExclusionPairs}\n\nCRITICAL: This exclusion is absolute. Do not recommend:\n- The same person under different spelling (e.g., "Park Chan Wook" vs "Park Chan-wook")\n- Films directed by excluded directors as indirect references\n- Directors commonly confused with excluded directors\nIf you are unsure, do NOT include them.\n`
          : `## STRICT EXCLUSION LIST — do NOT recommend any of these directors under any name, alias, or reference:\n${localNameExclusionPairs}\n\nThis means:\n- Do NOT suggest any director whose English name, Korean name, or common alias matches anyone above\n- Do NOT suggest the same director under a different romanization or spelling\n- Do NOT reference their notable works as a way to indirectly suggest them\n- If you are unsure whether a director is in the exclusion list, do NOT include them\n`;
        const genresMoodsRaw = `${extractedGenres.slice(0, 3).map(g => toEnglish(g)).join(", ")} | ${extractedMoods.slice(0, 2).map(m => toEnglish(m)).join(", ")}`.replace(/^\s*\|\s*$/, "").trim();
        const kw = queryOverride || genresMoodsRaw || "";
        const excerpt = storyText.slice(0, 600);
        // 장르/무드 추출 실패 시 스토리 텍스트 자체를 분석 대상으로 사용
        const hasSignalKeywords = kw.length > 3;
        return `You are a film/animation director discovery engine.
IMPORTANT: You MUST use the google_search tool to search the web before answering. Do NOT rely on your internal knowledge alone.${hasSignalKeywords ? " Search for directors matching the scenario keywords to find accurate, up-to-date information." : " Read the story text below carefully, analyze its themes, visual atmosphere, and narrative style, then search for directors whose visual style matches."}

Your mission: find directors who are NOT in the user's existing collection but whose visual style matches the scenario.

${exclusionBlock}${retryNote}
## SCENARIO CONTEXT
${hasSignalKeywords ? `Keywords: ${kw}\n` : ""}Story text (analyze this directly for themes, mood, visual style, and genre):
${excerpt}

${hasSignalKeywords ? `Search the web for: "${kw} film directors visual style"` : `Based on the story text above, identify the core themes and visual atmosphere, then search the web for directors whose cinematographic style matches.`}

## REQUIREMENTS
1. Recommend exactly 4 real, existing directors. No fictional directors.
2. All 4 must be OUTSIDE the exclusion list above.
3. Include at least 2 directors from DIFFERENT regions (e.g., not all from the same country).
4. Avoid only listing the most famous directors — include at least 1 lesser-known but stylistically relevant director.
5. Each director must have a specific, concrete reason tied to the scenario (not generic praise).

## OUTPUT FORMAT (strict JSON)
Return ONLY valid JSON: { "directors": [...] }
Each director object must have:
- name: English name (real, existing director only)
- nameKo: Korean name
- region: one of 한국|일본|중국|유럽|미국|인도|중동|동남아|중남미|아프리카|오세아니아
- style: comma-separated Korean style keywords (max 5)
- description: 2-3 sentences in Korean about their visual directing style — be SPECIFIC about techniques
- reason: 2 sentences in Korean why this director fits THIS specific scenario (not generic)
- fitScore: 0-100
- signatureTechniques: { cameraWork, colorPalette, lighting, editingStyle, moodKeywords } all in English
- notableWorks: array of 3 representative works`;
      };

      /**
       * 웹 검색 결과를 파싱하고 중복 제거하는 내부 함수.
       * 재시도 시에도 동일 로직 사용.
       */
      const processWebResponse = (
        webText: string,
        sources: ReturnType<typeof extractGroundingSources>,
        label: string,
      ): { accepted: Array<Record<string, unknown>>; rejected: number; reasons: string[]; rawCount: number; emptyReasons: WebSearchEmptyReason[] } => {
        const emptyReasons: WebSearchEmptyReason[] = [];

        // ── 견고한 JSON 파싱: 코드 블록, 비정형 응답 처리 ──
        let cleanText = webText;
        // 마크다운 코드 블록 제거 (```json ... ``` 또는 ``` ... ```)
        const codeBlockMatch = cleanText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (codeBlockMatch) {
          cleanText = codeBlockMatch[1].trim();
        }

        let webParsed: Record<string, unknown>;
        let parseFailed = false;
        try {
          webParsed = JSON.parse(cleanText) as Record<string, unknown>;
        } catch {
          const fallbackParsed = parseFirstJsonObject(cleanText) as Record<string, unknown> | null;
          if (fallbackParsed) {
            webParsed = fallbackParsed;
          } else {
            webParsed = {};
            parseFailed = true;
          }
        }

        // directors 배열 탐색: 최상위 또는 중첩 구조 모두 처리
        let rawWebDirs: Array<Record<string, unknown>> = [];
        const arrayKeys = ["directors", "recommendations", "results", "suggestions", "data", "items"];
        for (const key of arrayKeys) {
          if (Array.isArray(webParsed[key])) {
            rawWebDirs = webParsed[key] as Array<Record<string, unknown>>;
            break;
          }
        }
        if (rawWebDirs.length === 0) {
          // 최상위가 배열인 경우
          const parsed = parseFirstJsonObject(cleanText);
          if (Array.isArray(parsed)) {
            rawWebDirs = parsed as Array<Record<string, unknown>>;
          }
        }
        // ── 자연어 목록 파싱 폴백: "1. Name - Description" 패턴 ──
        if (rawWebDirs.length === 0 && cleanText.length > 50) {
          const naturalListPattern = /(?:^|\n)\s*(?:\d+[\.\)]\s*|[-•]\s*)([A-Z][a-zA-Zà-ž\s\-.']+?)(?:\s*[\(（]([가-힣\s]+)[\)）])?\s*[-–:]\s*(.+)/gm;
          let match;
          const naturalDirs: Array<Record<string, unknown>> = [];
          while ((match = naturalListPattern.exec(cleanText)) !== null) {
            const name = match[1].trim();
            const nameKo = match[2]?.trim() || "";
            const desc = match[3]?.trim() || "";
            if (name.length >= 3 && name.length <= 50) {
              naturalDirs.push({ name, nameKo: nameKo || name, description: desc, region: "미국", style: "", fitScore: 65, reason: desc.slice(0, 100) });
            }
          }
          if (naturalDirs.length > 0) {
            rawWebDirs = naturalDirs;
            console.log(`[recommend-director] processWebResponse: 자연어 목록에서 ${naturalDirs.length}명 추출`);
          }
        }

        if (rawWebDirs.length === 0) {
          if (parseFailed) {
            emptyReasons.push("parse_failed");
          } else {
            emptyReasons.push("provider_empty");
          }
          console.log(`[recommend-director] processWebResponse: directors 배열 없음 — parsed keys: ${Object.keys(webParsed).join(", ")}, parseFailed=${parseFailed}`);
        }
        const accepted: Array<Record<string, unknown>> = [];
        let rejected = 0;
        let missingFieldCount = 0;
        let partialRecoveryCount = 0;
        const reasons: string[] = [];

        for (const d of rawWebDirs) {
          // ── 필드 완화: name 또는 nameKo 중 하나만 있어도 복구 시도 ──
          if (!d.name && !d.nameKo) {
            rejected++;
            missingFieldCount++;
            reasons.push(`missing both name and nameKo`);
            continue;
          }
          if (!d.name && d.nameKo) {
            d.name = d.nameKo; // nameKo를 name으로 사용
            partialRecoveryCount++;
            reasons.push(`recovered "${d.nameKo}" — name was missing, used nameKo`);
          }
          if (!d.nameKo && d.name) {
            d.nameKo = d.name; // name을 nameKo로 사용
            partialRecoveryCount++;
            reasons.push(`recovered "${d.name}" — nameKo was missing, used name`);
          }

          // 중복 판정 — 공통 유틸 사용
          if (isLocalDuplicate(String(d.name), String(d.nameKo), localNameSet)) {
            rejected++;
            reasons.push(`"${d.name}" already in local pool`);
            continue;
          }

          // 웹 결과 내부 중복 제거
          const normName = String(d.name).toLowerCase().replace(/[\s\-_.]/g, "");
          if (accepted.some(a => String(a.name).toLowerCase().replace(/[\s\-_.]/g, "") === normName)) {
            rejected++;
            reasons.push(`"${d.name}" duplicate within web results`);
            continue;
          }

          const region = String(d.region || "미국");
          const webId = generateSlugId(String(d.name), region);

          // grounding 품질 점수 계산
          const relevanceKeywords = [
            String(d.name), String(d.nameKo),
            ...(Array.isArray(d.notableWorks) ? d.notableWorks.map(String) : []),
          ];
          const groundingQuality = computeGroundingQuality(sources, relevanceKeywords, false);

          accepted.push({
            ...d,
            id: webId,
            fitScore: clampFitScore(d.fitScore),
            reason: ensureReason(d.reason),
            _source: label,
            grounded: sources.length > 0,
            sources: sources.length > 0 ? sources : undefined,
            groundingQuality,
          });
        }

        // ── 0건 원인 분류 ──
        if (accepted.length === 0 && rawWebDirs.length > 0) {
          if (rawWebDirs.length === rejected && reasons.every(r => r.includes("already in local pool"))) {
            emptyReasons.push("duplicate_filtered_all");
          } else if (missingFieldCount === rejected) {
            emptyReasons.push("missing_required_fields");
          } else if (rejected > 0) {
            emptyReasons.push("validation_rejected_all");
          }
        }

        return { accepted, rejected, reasons, rawCount: rawWebDirs.length, emptyReasons, partialRecoveryCount };
      };

      // ═══════════════════════════════════════════════════════════
      // Flat stage pipeline — reason code가 다음 stage를 결정
      // ═══════════════════════════════════════════════════════════

      /**
       * 하나의 Gemini API 호출을 실행하고 결과를 파싱하는 캡슐화 단위.
       */
      const callGeminiForDirectors = async (opts: {
        model: string;
        prompt: string;
        useGrounding: boolean;
        label: string;
        forceMimeType?: boolean;
      }): Promise<{
        accepted: Array<Record<string, unknown>>;
        rejected: number;
        reasons: string[];
        rawCount: number;
        emptyReasons: WebSearchEmptyReason[];
        partialRecoveryCount: number;
        grounded: boolean;
        httpStatus: number | null;
        timeoutOccurred: boolean;
        rawSnippet: string;
        durationMs: number;
      }> => {
        const start = Date.now();
        const body: Record<string, unknown> = {
          contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
          generationConfig: {
            temperature: opts.useGrounding ? 0.3 : 0.5,
            maxOutputTokens: 3072,
            ...(opts.forceMimeType ? { responseMimeType: "application/json" as const } : {}),
          },
          ...(opts.useGrounding ? { tools: [{ google_search: {} }] } : {}),
        };

        let res: Response;
        try {
          // grounding 호출은 웹 검색 추가 지연 감안 — Pro 모델은 응답이 느릴 수 있음
          const timeoutMs = opts.useGrounding ? 55_000 : undefined;
          res = await fetchWithAuth(
            context.env,
            buildGeminiUrl(context.env, opts.model),
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
            timeoutMs ? { timeoutMs } : undefined,
          );
        } catch (err) {
          const duration = Date.now() - start;
          const isTimeout = err instanceof DOMException && err.name === "AbortError";
          console.warn(`[recommend-director] callGemini 예외 (${opts.label}): ${isTimeout ? "TIMEOUT" : (err instanceof Error ? err.message : String(err))}`);
          return {
            accepted: [], rejected: 0, reasons: [], rawCount: 0,
            emptyReasons: [isTimeout ? "provider_timeout" : "provider_failed"],
            partialRecoveryCount: 0, grounded: false,
            httpStatus: null, timeoutOccurred: isTimeout,
            rawSnippet: "", durationMs: duration,
          };
        }

        const duration = Date.now() - start;
        const httpStatus = res.status;

        // timeout via 504 TIMEOUT code from fetchWithKeyFallback
        if (!res.ok) {
          let errBody = "";
          try { errBody = await res.text(); } catch { /* ignore */ }
          const isTimeout = httpStatus === 504 && errBody.includes('"TIMEOUT"');
          console.warn(`[recommend-director] callGemini HTTP ${httpStatus} (${opts.label}): ${errBody.slice(0, 200)}`);
          return {
            accepted: [], rejected: 0, reasons: [], rawCount: 0,
            emptyReasons: [isTimeout ? "provider_timeout" : "provider_failed"],
            partialRecoveryCount: 0, grounded: false,
            httpStatus, timeoutOccurred: isTimeout,
            rawSnippet: errBody.slice(0, 100), durationMs: duration,
          };
        }

        // 성공 — 파싱
        const data = await res.json() as {
          candidates?: {
            content?: { parts?: { text?: string }[] };
            groundingMetadata?: { groundingChunks?: Array<{ web?: { uri: string; title: string } }> };
          }[];
        };
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";
        const snippet = text.slice(0, 200);
        // grounding metadata 추출 — groundingChunks + groundingSupports 모두 탐색
        const candidate = data?.candidates?.[0];
        const grMeta = candidate?.groundingMetadata;
        // groundingMetadata 전체를 전달하여 groundingChunks가 없어도 groundingSupports에서 추출
        const sources = extractGroundingSources(grMeta as Parameters<typeof extractGroundingSources>[0]);
        // webSearchQueries가 존재하면 모델이 실제로 검색을 수행한 것 — 소스 URL이 없어도 grounded로 간주
        const webSearchQueries = Array.isArray((grMeta as Record<string, unknown>)?.webSearchQueries)
          ? (grMeta as Record<string, unknown>).webSearchQueries as string[]
          : [];
        const isGrounded = opts.useGrounding && (sources.length > 0 || webSearchQueries.length > 0);

        // grounding 디버그
        const candidateKeys = candidate ? Object.keys(candidate) : [];
        const groundingDiag = opts.useGrounding ? {
          // API 응답 최상위 구조
          responseTopKeys: Object.keys(data),
          candidateKeys,
          // candidate 전체 스냅샷 (text 제외, 300자)
          candidateSnapshot: candidate
            ? JSON.stringify(candidate, (k, v) => k === "parts" ? "[omitted]" : v).slice(0, 400)
            : "null",
          metaExists: !!grMeta,
          metaKeys: grMeta ? Object.keys(grMeta) : [],
          chunksCount: Array.isArray((grMeta as Record<string, unknown>)?.groundingChunks) ? ((grMeta as Record<string, unknown>).groundingChunks as unknown[]).length : 0,
          supportsCount: Array.isArray((grMeta as Record<string, unknown>)?.groundingSupports) ? ((grMeta as Record<string, unknown>).groundingSupports as unknown[]).length : 0,
          searchQueriesCount: webSearchQueries.length,
          searchQueries: webSearchQueries.slice(0, 3),
          extractedSources: sources.length,
          metaSnapshot: grMeta ? JSON.stringify(grMeta).slice(0, 300) : "null",
        } : undefined;

        if (opts.useGrounding) {
          console.log(`[recommend-director] grounding 진단 (${opts.label}):`, JSON.stringify(groundingDiag));
        }

        const result = processWebResponse(text, sources, opts.label);
        return {
          ...result,
          grounded: isGrounded,
          groundingDiag,
          httpStatus,
          timeoutOccurred: false,
          rawSnippet: snippet,
          durationMs: duration,
        };
      };

      // ── Stage execution ──
      const MAX_STAGES = 4;
      let currentStageQuery = webSearchQuery!;
      let stageAccepted: Array<Record<string, unknown>> = [];
      let allEmptyReasons: WebSearchEmptyReason[] = [];
      let recoveredAtStage: number | null = null;

      const pipelineStartMs = Date.now();
      const PIPELINE_DEADLINE_MS = 58_000; // Pro 모델 google_search grounding 응답 시간 감안

      for (let stageNum = 1; stageNum <= MAX_STAGES; stageNum++) {
        // ── 이미 후보 확보되면 종료 ──
        if (stageAccepted.length > 0) break;

        // ── 집계 타임아웃: 남은 시간 부족하면 빠르게 종료 ──
        const elapsedMs = Date.now() - pipelineStartMs;
        if (elapsedMs > PIPELINE_DEADLINE_MS) {
          console.warn(`[recommend-director] Pipeline deadline ${PIPELINE_DEADLINE_MS}ms exceeded at stage ${stageNum} (${elapsedMs}ms elapsed) — breaking`);
          allEmptyReasons.push("pipeline_deadline_exceeded");
          pipelineTimeoutOccurred = true;
          break;
        }

        let stageLabel: string;
        let model: string;
        let prompt: string;
        let useGrounding: boolean;
        let forceMimeType: boolean;
        let triggerReason: string;

        if (stageNum === 1) {
          // ── STAGE 1: Grounded 웹 검색 (Flash-Lite + google_search) ──
          stageLabel = "stage1_grounded_web";
          model = GEMINI_MODEL_SEARCH;
          prompt = buildWebPrompt();
          useGrounding = true;
          forceMimeType = false; // grounding과 responseMimeType 동시 사용 불가
          triggerReason = "initial";
        } else if (stageNum === 2) {
          // ── STAGE 2: grounding 실패 시 Flash-Lite JSON 폴백 (grounding 재시도 무의미) ──
          const prevReasons = allEmptyReasons;
          const shouldSkipToStage4 = prevReasons.includes("provider_timeout") || prevReasons.includes("provider_failed");
          if (shouldSkipToStage4) { continue; }

          const stage1Log = retryStagesLog.find(s => s.stage === 1);
          const stage1HadNoSources = stage1Log && !stage1Log.grounded;

          if (stage1HadNoSources) {
            // Stage 1에서 grounding 자체가 안 됐으면 → 바로 JSON 모델 지식 폴백 (grounding 재시도 무의미)
            const retryNote = "\n## IMPORTANT: Return ONLY valid JSON. No markdown, no explanation, no extra text. Just the JSON object.\n";
            stageLabel = "stage2_json_fallback";
            model = GEMINI_MODEL_FLASH;
            prompt = buildWebPrompt({ retryNote });
            useGrounding = false;
            forceMimeType = true;
            triggerReason = `stage1 grounding empty: ${prevReasons.join(",")}`;
          } else {
            // 파싱 실패 등 → JSON 강제로 재시도
            const retryNote = "\n## IMPORTANT: Return ONLY valid JSON. No markdown, no explanation, no extra text. Just the JSON object.\n";
            stageLabel = "stage2_flash_json";
            model = GEMINI_MODEL_FLASH;
            prompt = buildWebPrompt({ retryNote });
            useGrounding = false;
            forceMimeType = true;
            triggerReason = `stage1 failed: ${prevReasons.join(",")}`;
          }
        } else if (stageNum === 3) {
          // ── STAGE 3: Duplicate 복구 OR 쿼리 단순화 JSON 재시도 ──
          const prevReasons = allEmptyReasons;
          const hasDuplicate = prevReasons.includes("duplicate_filtered_all");
          const shouldSkipToStage4 = prevReasons.includes("provider_timeout") || prevReasons.includes("provider_failed");

          if (shouldSkipToStage4) { continue; }

          if (hasDuplicate) {
            // 중복 전멸 → 강한 제외 조건으로 재시도
            const dupRetryNote = `\n## DUPLICATE RECOVERY RETRY\nYour previous responses contained ONLY directors already in the user's collection.\nYou MUST find completely different, lesser-known directors this time.\nDo NOT recommend any director even remotely similar to: ${localNameExclusionPairs}\nFind directors from underrepresented regions or indie film scenes.\n`;

            stageLabel = "stage3_duplicate_recovery";
            model = GEMINI_MODEL_FLASH;
            prompt = buildWebPrompt({ retryNote: dupRetryNote, strengthenExclusion: true });
            useGrounding = false;
            forceMimeType = true;
            triggerReason = "duplicate_filtered_all";
          } else {
            // Stage 2도 실패 → 쿼리 단순화 후 JSON 재시도
            const simplifiedQuery = simplifyQueryForRetry(currentStageQuery, extractedGenres, extractedMoods);
            currentStageQuery = simplifiedQuery;
            stageLabel = "stage3_simplified_json";
            model = GEMINI_MODEL_FLASH;
            prompt = buildWebPrompt({ retryNote: "\n## Return ONLY valid JSON.\n", queryOverride: simplifiedQuery });
            useGrounding = false;
            forceMimeType = true;
            triggerReason = `stage2 failed: ${prevReasons.join(",")}`;
          }
        } else {
          // ── STAGE 4: 모델 지식 폴백 (grounded=false, JSON 강제) ──
          // Stage 4는 항상 Flash-Lite 폴백 — 검색 전체가 Flash-Lite 통일
          stageLabel = "stage4_model_fallback";
          model = GEMINI_MODEL_FLASH;

          const excludeNames = (localDirectors || []).slice(0, 15).map(d => d.name).join(", ");
          const genreStr = extractedGenres.slice(0, 3).map(g => toEnglish(g)).join(", ") || "drama";
          const moodStr = extractedMoods.slice(0, 2).map(m => toEnglish(m)).join(", ") || "emotional";

          prompt = `Recommend 4 real film directors for a ${genreStr} ${moodStr} scenario.\nDo NOT recommend: ${excludeNames}.\nReturn JSON: {"directors":[{"name":"English name","nameKo":"Korean name","region":"한국|일본|중국|유럽|미국|인도|중동|동남아|중남미|아프리카|오세아니아","style":"Korean style keywords","description":"Korean description","reason":"Korean reason","fitScore":75,"signatureTechniques":{"cameraWork":"","colorPalette":"","lighting":"","editingStyle":"","moodKeywords":""},"notableWorks":["work1","work2","work3"]}]}`;
          useGrounding = false;
          forceMimeType = true;
          triggerReason = `all prior stages failed: ${allEmptyReasons.join(",")}`;
          fallbackUsed = true;
        }

        webSearchAttemptCount = stageNum;
        console.log(`[recommend-director] STAGE ${stageNum} (${stageLabel}): model=${model}, grounding=${useGrounding}, query="${currentStageQuery.slice(0, 60)}..."`);

        const stageResult = await callGeminiForDirectors({
          model, prompt, useGrounding, label: stageLabel, forceMimeType,
        });

        // ── Stage 기록 ──
        const stageLog: RetryStageLog = {
          stage: stageNum,
          name: stageLabel,
          model,
          grounded: stageResult.grounded,
          normalizedQuery: currentStageQuery,
          timeoutOccurred: stageResult.timeoutOccurred,
          httpStatus: stageResult.httpStatus,
          rawResultCount: stageResult.rawCount,
          acceptedCount: stageResult.accepted.length,
          rejectedCount: stageResult.rejected,
          emptyReasons: stageResult.emptyReasons,
          triggerReason,
          partialRecoveryCount: stageResult.partialRecoveryCount,
          durationMs: stageResult.durationMs,
          groundingDiag: stageResult.groundingDiag,
        };
        retryStagesLog.push(stageLog);

        // ── grounding 추적 ──
        if (useGrounding) {
          groundingAttempted = true;
          if (!stageResult.grounded) groundingFailed = true;
          else groundingFailed = false; // 이후 stage에서 grounding 성공하면 복구
        }

        // ── 결과 수집 ──
        if (stageResult.timeoutOccurred) pipelineTimeoutOccurred = true;
        webSearchRawBeforeDedup += stageResult.rawCount;
        webSearchPartialRecoveryCount += stageResult.partialRecoveryCount;
        if (stageResult.rawSnippet && !webSearchRawSnippet) {
          webSearchRawSnippet = stageResult.rawSnippet;
        }
        webSearchRejectionReasons.push(...stageResult.reasons.map(r => `[${stageLabel}] ${r}`));
        allEmptyReasons.push(...stageResult.emptyReasons);

        if (stageResult.accepted.length > 0) {
          stageAccepted.push(...stageResult.accepted);
          recoveredAtStage = stageNum;
          finalProvider = `${model} (${stageLabel})`;
          finalGrounded = stageResult.grounded;
          console.log(`[recommend-director] STAGE ${stageNum} 성공: ${stageResult.accepted.length}명 채택 (grounded=${stageResult.grounded})`);
        } else {
          console.log(`[recommend-director] STAGE ${stageNum} 실패: emptyReasons=${stageResult.emptyReasons.join(",")}, rawCount=${stageResult.rawCount}`);
        }
      }

      // ── Stage 4도 실패했으면 Flash 긴급 폴백 (Stage 4가 Pro였을 때만) ──
      const emergencyElapsed = Date.now() - pipelineStartMs;
      if (stageAccepted.length === 0 && retryStagesLog.length >= 4 && emergencyElapsed < PIPELINE_DEADLINE_MS) {
        const lastStage = retryStagesLog[retryStagesLog.length - 1];
        if (lastStage.model !== GEMINI_MODEL_FLASH) {
          console.log(`[recommend-director] Stage 4 Pro 실패 → Flash 긴급 폴백`);
          const excludeNames = (localDirectors || []).slice(0, 15).map(d => d.name).join(", ");
          const genreStr = extractedGenres.slice(0, 3).map(g => toEnglish(g)).join(", ") || "drama";
          const moodStr = extractedMoods.slice(0, 2).map(m => toEnglish(m)).join(", ") || "emotional";
          const emergencyPrompt = `Recommend 4 real film directors for a ${genreStr} ${moodStr} scenario. Do NOT recommend: ${excludeNames}. Return JSON: {"directors":[{"name":"English name","nameKo":"Korean name","region":"미국","fitScore":75}]}`;

          const flashResult = await callGeminiForDirectors({
            model: GEMINI_MODEL_FLASH,
            prompt: emergencyPrompt,
            useGrounding: false,
            label: "stage4_flash_emergency",
            forceMimeType: true,
          });
          webSearchAttemptCount++;
          retryStagesLog.push({
            stage: 5,
            name: "stage4_flash_emergency",
            model: GEMINI_MODEL_FLASH,
            grounded: false,
            normalizedQuery: currentStageQuery,
            timeoutOccurred: flashResult.timeoutOccurred,
            httpStatus: flashResult.httpStatus,
            rawResultCount: flashResult.rawCount,
            acceptedCount: flashResult.accepted.length,
            rejectedCount: flashResult.rejected,
            emptyReasons: flashResult.emptyReasons,
            triggerReason: "stage4_pro_failed",
            partialRecoveryCount: flashResult.partialRecoveryCount,
            durationMs: flashResult.durationMs,
          });
          if (flashResult.accepted.length > 0) {
            stageAccepted.push(...flashResult.accepted);
            recoveredAtStage = 5;
            finalProvider = `${GEMINI_MODEL_FLASH} (flash_emergency)`;
            finalGrounded = false;
            fallbackUsed = true;
          }
          allEmptyReasons.push(...flashResult.emptyReasons);
        }
      }

      // ── 최종 결과 수집 ──
      webSuggestions = stageAccepted;
      webSearchResultCount = retryStagesLog.reduce((sum, s) => sum + s.rawResultCount, 0);
      webSearchAcceptedCount = stageAccepted.length;
      webSearchRejectedCount = retryStagesLog.reduce((sum, s) => sum + s.rejectedCount, 0);
      webSearchDedupRemoved = webSearchRejectedCount;
      webSearchEmptyReasons = allEmptyReasons;

      // ── finalReasonCodes 결정 ──
      if (stageAccepted.length === 0) {
        if (allEmptyReasons.length === 0) allEmptyReasons.push("fallback_empty");
        webSearchRetryReason = `${retryStagesLog.length} stages 실행, 전부 실패: ${[...new Set(allEmptyReasons)].join(", ")}`;
      }

      if (!finalProvider) {
        finalProvider = retryStagesLog.length > 0 ? retryStagesLog[retryStagesLog.length - 1].model : "none";
      }

      // ── resultMode 결정 ──
      const hasGroundedResults = stageAccepted.some(s => s.grounded === true);
      const hasUngroundedResults = stageAccepted.some(s => s.grounded !== true);
      const resultMode: "grounded" | "fallback" | "mixed" | "empty" =
        stageAccepted.length === 0 ? "empty"
        : (hasGroundedResults && hasUngroundedResults) ? "mixed"
        : hasGroundedResults ? "grounded"
        : "fallback";

      webSearchProvider = finalProvider;

      // ── stageStatus/stageReasons 설정 ──
      if (stageAccepted.length > 0) {
        stageStatus.webSearch = "attempted_success";
        const recoveryNote = recoveredAtStage && recoveredAtStage > 1 ? ` (stage ${recoveredAtStage}에서 복구)` : "";
        stageReasons.webSearch = `${webSearchAcceptedCount}명 채택, ${resultMode} 모드${recoveryNote} (시도 ${webSearchAttemptCount}회)`;
      } else {
        stageStatus.webSearch = allEmptyReasons.includes("provider_failed") || allEmptyReasons.includes("provider_timeout") ? "failed" : "attempted_empty";
        const reasonSummary = [...new Set(allEmptyReasons)].join(", ");
        stageReasons.webSearch = `전부 실패 [${reasonSummary}] (시도 ${webSearchAttemptCount}회)`;
      }

      console.log(`[recommend-director] pipeline 완료: accepted=${stageAccepted.length}, mode=${resultMode}, stages=${retryStagesLog.length}, reasons=${[...new Set(allEmptyReasons)].join(",")}`);
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Final Assembly
    // ═══════════════════════════════════════════════════════════

    const finalLocalCount = localMatches.length;
    const finalWebCount = webSuggestions.length;
    const finalCount = finalLocalCount + finalWebCount;

    let emptyReason: string | undefined;
    if (finalCount === 0) {
      // emptyReason 판정: 실제 장르/무드 존재 여부를 기반으로 정확히 분류
      const hasSignals = extractedGenres.length > 0 || extractedMoods.length > 0;
      if (!hasSignals && stageStatus.extractSignals === "weak") {
        emptyReason = "genre_mood_not_detected";
      } else if (directorPoolSize === 0) {
        emptyReason = "empty_director_pool";
      } else if (stageStatus.localMatch === "invalid_ids") {
        emptyReason = "all_local_ids_hallucinated";
      } else if (stageStatus.webSearch === "attempted_empty" && stageStatus.localMatch === "empty") {
        emptyReason = "web_search_returned_empty";
      } else if (stageStatus.webSearch === "failed" && stageStatus.localMatch !== "ok") {
        emptyReason = "web_search_failed_and_no_local";
      } else if (stageStatus.localMatch === "empty" && stageStatus.webSearch !== "attempted_success") {
        emptyReason = "no_candidates_found";
      } else {
        emptyReason = "no_candidates_found";
      }
      stageStatus.finalAssembly = "empty";
      stageReasons.finalAssembly = emptyReason;
    } else {
      stageStatus.finalAssembly = "ok";
      stageReasons.finalAssembly = `local=${finalLocalCount}, web=${finalWebCount}`;
    }

    // ── Build debug payload ──
    const debug: DirectorRecommendationDebug = {
      stageStatus,
      stageReasons,
      extractedGenres,
      extractedMoods,
      extractedKeywords,
      consideredLocalCount: typeof geminiPipeline.consideredLocalCount === "number"
        ? geminiPipeline.consideredLocalCount as number : consideredLocalIds.length,
      consideredLocalIds,
      validLocalCount: finalLocalCount,
      invalidIdsRemoved,
      rejectedLocalIds,
      localRejectionReasons,
      attemptedWebSearch,
      webSearchProvider,
      webSearchQuery,
      webSearchResultCount,
      webSearchAcceptedCount,
      webSearchRejectedCount,
      webSearchRejectionReasons,
      webSearchAttemptCount,
      webSearchRawBeforeDedup,
      webSearchDedupRemoved,
      webSearchRetryReason,
      webSearchRawSnippet: webSearchRawSnippet || undefined,
      localMatchRawSnippet: localMatchRawSnippet || undefined,
      localResultCount: finalLocalCount,
      externalResultCount: finalWebCount,
      finalResultCount: finalCount,
      emptyReason,
      webSearchEmptyReasons: webSearchEmptyReasons.length > 0 ? webSearchEmptyReasons : undefined,
      finalReasonCodes: webSuggestions.length === 0 && webSearchEmptyReasons.length > 0
        ? [...new Set(webSearchEmptyReasons)] : undefined,
      webSearchQueryCorrected: webSearchQueryCorrected || undefined,
      webSearchQueryCorrectionReason: webSearchQueryCorrectionReason || undefined,
      webSearchPartialRecoveryCount: webSearchPartialRecoveryCount > 0 ? webSearchPartialRecoveryCount : undefined,
      retryStages: retryStagesLog.length > 0 ? retryStagesLog : undefined,
      finalProvider: finalProvider || undefined,
      finalGrounded: attemptedWebSearch ? finalGrounded : undefined,
      fallbackUsed: fallbackUsed || undefined,
      timeoutOccurred: pipelineTimeoutOccurred || undefined,
      modelUsed,
      preExtracted: preSignals,
      signalMergeReasons: mergeResult.mergeReasons,
    };

    // ── Provenance 계산 ──
    const groundedExternalCount = webSuggestions.filter((s: Record<string, unknown>) => s.grounded === true).length;
    const fallbackExternalCount = webSuggestions.filter((s: Record<string, unknown>) => s.grounded !== true).length;
    const computedResultMode: "grounded" | "fallback" | "mixed" | "empty" =
      finalWebCount === 0 ? "empty"
      : groundedExternalCount > 0 && fallbackExternalCount > 0 ? "mixed"
      : groundedExternalCount > 0 ? "grounded"
      : "fallback";

    // ── Log: 성공/실패 무관하게 항상 provenance 포함 ──
    console.log("[recommend-director] result:", JSON.stringify({
      // pipeline status
      pipelineStatus: stageStatus.webSearch,
      stages: stageStatus,
      // provenance — 실제 결과 출처
      resultMode: computedResultMode,
      localMatchCount: finalLocalCount,
      externalCandidateCount: finalWebCount,
      groundedExternalCount,
      fallbackExternalCount,
      // model info
      finalModel: finalProvider,
      finalGrounded,
      fallbackUsed,
      retryCount: webSearchAttemptCount,
      recoveredAtStage: retryStagesLog.find(s => s.acceptedCount > 0)?.stage ?? null,
      // totals
      total: finalCount,
      emptyReason,
    }));

    if (finalCount === 0) {
      console.warn(`[recommend-director] 빈 결과 — emptyReason=${emptyReason}, stages=${JSON.stringify(stageStatus)}`);
    }

    return Response.json({
      analysis: (parsed.analysis as string) ?? "",
      localMatches,
      webSuggestions,
      _meta: {
        modelUsed,
        invalidIdsRemoved: invalidIdsRemoved.length,
        directorPoolSize,
        storyLengthUsed: Math.min(storyText.length, 1200),
        attemptedWebSearch,
        webSearchProvider,
        // provenance — 실제 결과 출처 기준
        resultMode: computedResultMode,
        localMatchCount: finalLocalCount,
        externalCandidateCount: finalWebCount,
        groundedExternalCount,
        fallbackExternalCount,
        // model & retry
        finalModel: finalProvider || undefined,
        retryCount: webSearchAttemptCount,
        recoveredAtStage: retryStagesLog.find(s => s.acceptedCount > 0)?.stage ?? null,
        fallbackUsed,
        finalGrounded,
        groundingAttempted: groundingAttempted || undefined,
        groundingFailed: groundingAttempted ? groundingFailed : undefined,
        timeoutOccurred: pipelineTimeoutOccurred || undefined,
      },
      _debug: debug,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[recommend-director] 예외:", errMsg);
    return Response.json({
      error: `[recommend-director] ${errMsg}`,
      code: "INTERNAL_ERROR",
      help: "서버 로그와 브라우저 콘솔을 확인하세요.",
      detail: errMsg.slice(0, 500),
    }, { status: 500 });
  }
};
