import { GeminiEnv, fetchWithAuth, fetchWithModelFallback, buildGeminiUrl, streamingGenerate, GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH, GEMINI_MODEL_SEARCH, geminiErrorResponse, parseFirstJsonObject } from "./_gemini-keys";
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

  // ── History content 보강: 역사 콘텐츠는 장르/무드 키워드 없이도 시각 스타일이 뚜렷 ──
  if (contentType === "history" && genres.length <= 1 && moods.length === 0) {
    // 시대별 시각적 무드 추론
    if (/(?:조선|고려|삼국|백제|신라|고구려|왕조|궁궐|사극)/.test(text)) {
      if (!moods.includes("비장한")) { moods.push("비장한"); reasons.push("inferred epic mood from Korean dynasty history"); }
      if (!genres.includes("드라마")) { genres.push("드라마"); reasons.push("inferred drama from Korean dynasty history"); }
      keywords.push("period drama", "dynasty");
      reasons.push("history content enrichment: Korean dynasty keywords → period drama signals");
    }
    if (/(?:로마|제국|중세|르네상스|십자군|봉건|영주|기사|성.*공성)/.test(text)) {
      if (!moods.includes("비장한")) { moods.push("비장한"); reasons.push("inferred epic mood from Western/medieval history"); }
      keywords.push("period drama", "epic");
      reasons.push("history content enrichment: Western medieval keywords → epic period signals");
    }
    if (/(?:세계대전|냉전|독립\s*운동|혁명|식민|해방|점령|레지스탕스|저항)/.test(text)) {
      if (!genres.includes("전쟁")) { genres.push("전쟁"); reasons.push("inferred war genre from modern conflict history"); }
      if (!moods.includes("비장한")) { moods.push("비장한"); reasons.push("inferred epic mood from modern conflict history"); }
      keywords.push("war", "resistance");
      reasons.push("history content enrichment: modern conflict keywords → war/resistance signals");
    }
    if (/(?:문명|고대|유적|발굴|유물|신화|전설)/.test(text)) {
      if (!moods.includes("신비로운")) { moods.push("신비로운"); reasons.push("inferred mysterious mood from ancient civilization history"); }
      keywords.push("ancient civilization", "mythology");
      reasons.push("history content enrichment: ancient civilization keywords → mysterious signals");
    }
    // 역사 콘텐츠인데 아직도 무드가 없으면 기본값
    if (moods.length === 0) {
      moods.push("비장한");
      reasons.push("history content with no explicit mood → default epic");
    }
    // 역사 콘텐츠는 visual hint 보강
    if (!visualHints.includes("slow-motion")) {
      visualHints.push("slow-motion");
      reasons.push("history content enrichment: added slow-motion visual hint");
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
  scenarioRegions: string[];
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
  const _rdStartMs = Date.now();
  console.info("[recommend-director] Request received");
  try {
    const { storyText, localDirectors } = await context.request.json() as {
      storyText: string;
      localDirectors: LocalDirectorInfo[];
    };
    console.info(`[recommend-director] Parsed request: storyTextLen=${storyText?.length ?? 0}, localDirectors=${localDirectors?.length ?? 0}`);

    if (!storyText || typeof storyText !== "string") {
      console.info("[recommend-director] Validation failed: storyText is missing or not a string");
      return Response.json({ error: "storyText is required" }, { status: 400 });
    }

    const directorPoolSize = (localDirectors || []).length;

    // ── Debug state ──
    const stageStatus: StageStatus = {
      extractSignals: "ok",
      localMatch: "skipped",
      webSearch: "not_attempted",
      finalAssembly: "failed",
    };
    const stageReasons: StageReasons = { extractSignals: "direct_text_analysis", localMatch: "skipped" };

    const extractedGenres: string[] = [];
    const extractedMoods: string[] = [];
    const extractedKeywords: string[] = [];
    const scenarioRegions: string[] = [];
    const consideredLocalIds: string[] = [];
    const rejectedLocalIds: string[] = [];
    const localRejectionReasons: string[] = [];
    const invalidIdsRemoved: string[] = [];
    const preSignals = preExtractSignals(storyText); // 최소한의 사전 추출 (contentType 등)

    // Raw response snippets for debug
    const localMatchRawSnippet = "";
    let webSearchRawSnippet = "";

    // Web search state
    let attemptedWebSearch = false;
    let webSearchProvider: string | null = null;
    let webSearchQuery: string | null = null;
    let webSearchResultCount = 0;
    let webSearchAcceptedCount = 0;
    let webSearchRejectedCount = 0;
    let webSearchRejectionReasons: string[] = [];
    // Step 1 (로컬 매칭) 생략 — 글 자체 분석으로 바로 웹 검색
    const localMatches: Array<Record<string, unknown>> = [];
    const modelUsed = "flash";
    const signalDetails: string[] = [];
    const mergeResult = { mergeReasons: [] as string[] };

    // ═══════════════════════════════════════════════════════════
    // 웹 검색 기반 감독 추천 — 글 자체를 Gemini에 넘겨 바로 추천
    // ═══════════════════════════════════════════════════════════

    let webSuggestions: Array<Record<string, unknown>> = [];
    let webSearchAttemptCount = 0;
    let webSearchRawBeforeDedup = 0;
    let webSearchDedupRemoved = 0;
    let webSearchRetryReason: string | null = null;
    let webSearchEmptyReasons: WebSearchEmptyReason[] = [];
    const webSearchQueryCorrected = false;
    const webSearchQueryCorrectionReason: string | undefined = undefined;
    let webSearchPartialRecoveryCount = 0;
    const retryStagesLog: RetryStageLog[] = [];
    let finalProvider = "";
    let finalGrounded = false;
    let fallbackUsed = false;
    let groundingAttempted = false;
    let groundingFailed = false;
    let pipelineTimeoutOccurred = false;

    {
      attemptedWebSearch = true;
      webSearchQuery = "direct_text_analysis"; // 쿼리 없이 글 자체 분석

      const localNameSet = buildLocalNameSet(localDirectors || []);

      console.log(`[recommend-director] 웹 검색 시작 — 글 자체 분석, localNames=${localNameSet.size}`);

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
        return `You are a film/animation director discovery engine with deep knowledge of world cinema.
Read the story text below carefully, analyze its themes, visual atmosphere, narrative style, and genre, then recommend directors whose visual style matches.

Your mission: find directors who are NOT in the user's existing collection but whose visual style matches the scenario.

${exclusionBlock}${retryNote}
## SCENARIO CONTEXT
Story text (analyze this directly):
${excerpt}

## REQUIREMENTS
1. Recommend exactly 4 real, existing directors. No fictional directors.
2. All 4 must be OUTSIDE the exclusion list above.
3. If the scenario is set in a specific country/region (e.g., Joseon-era Korea → 한국, Edo Japan → 일본), prioritize directors from that same region FIRST — at least 2 of the 4 should be from the scenario's region if possible. Fill remaining slots with directors from other regions.
4. If the scenario has no specific country setting, include at least 2 directors from DIFFERENT regions.
5. Avoid only listing the most famous directors — include at least 1 lesser-known but stylistically relevant director.
6. Each director must have a specific, concrete reason tied to the scenario (not generic praise).

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
       * MAX_TOKENS로 잘린 JSON에서 완성된 director 객체들만 추출.
       * 예: '{"directors":[{...완성},{...완성},{...미완성' → 완성된 2개 반환
       */
      const recoverTruncatedDirectors = (text: string): Array<Record<string, unknown>> => {
        // "directors" 배열 시작점 찾기
        const arrStart = text.indexOf("[");
        if (arrStart < 0) return [];

        const recovered: Array<Record<string, unknown>> = [];
        let depth = 0;
        let objStart = -1;

        for (let i = arrStart; i < text.length; i++) {
          const ch = text[i];
          if (ch === "{") {
            if (depth === 0) objStart = i;
            depth++;
          } else if (ch === "}") {
            depth--;
            if (depth === 0 && objStart >= 0) {
              const objStr = text.slice(objStart, i + 1);
              try {
                const obj = JSON.parse(objStr) as Record<string, unknown>;
                if (obj.name || obj.nameKo) {
                  recovered.push(obj);
                }
              } catch { /* 불완전 객체 무시 */ }
              objStart = -1;
            }
          }
        }
        return recovered;
      };

      /**
       * signatureTechniques 필드 검증/보정.
       * 웹 감독의 기법 데이터는 Gemini 자체 생성이므로 할루시네이션 방지가 필요:
       * - 빈/누락 필드를 안전한 기본값으로 채움
       * - 너무 짧거나 의미없는 값 필터링
       * - 한국어 혼입 방지 (영문 전용 필드)
       */
      const sanitizeSignatureTechniques = (
        tech: Record<string, string> | undefined,
        directorName: string,
      ): Record<string, string> | undefined => {
        if (!tech || typeof tech !== "object") return undefined;

        const REQUIRED_KEYS = ["cameraWork", "colorPalette", "lighting", "editingStyle", "moodKeywords"] as const;
        const sanitized: Record<string, string> = {};
        let hasAnyValid = false;

        for (const key of REQUIRED_KEYS) {
          const val = tech[key];
          if (typeof val === "string" && val.trim().length >= 3) {
            // 한국어 전용 값 거부 (영문 필드인데 한글만 있는 경우)
            const koreanOnlyRatio = (val.match(/[가-힣]/g)?.length ?? 0) / val.length;
            if (koreanOnlyRatio > 0.7) {
              // 한글 비율 70% 이상이면 의미없는 값으로 간주
              sanitized[key] = "";
              continue;
            }
            sanitized[key] = val.trim();
            hasAnyValid = true;
          } else {
            sanitized[key] = "";
          }
        }

        if (!hasAnyValid) {
          console.warn(`[recommend-director] signatureTechniques 전체 비어있음 for "${directorName}" — 제거`);
          return undefined;
        }

        return sanitized;
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
            // ── MAX_TOKENS 절단 복구: 잘린 JSON에서 완성된 객체들만 추출 ──
            const truncatedRecovery = recoverTruncatedDirectors(cleanText);
            if (truncatedRecovery.length > 0) {
              webParsed = { directors: truncatedRecovery };
              console.log(`[recommend-director] processWebResponse: truncated JSON에서 ${truncatedRecovery.length}명 복구`);
            } else {
              webParsed = {};
              parseFailed = true;
            }
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
        // ── 이름/설명에서 지역 추론 (자연어 파싱 폴백용) ──
        const inferRegionFromName = (name: string, nameKo: string, desc: string): string => {
          const combined = `${name} ${nameKo} ${desc}`.toLowerCase();
          // 한글 이름이 있으면 한국 감독일 가능성 높음
          if (/[가-힣]{2,}/.test(nameKo) && nameKo !== name) return "한국";
          // 일본식 이름 패턴
          if (/\b(?:hayao|makoto|satoshi|akira|hirokazu|takeshi|kenji|isao|mamoru|hideaki|hiroshi|takahata|oshii|kitano)\b/i.test(name)) return "일본";
          if (/\b(?:miyazaki|kurosawa|ozu|shinkai|kon|koreeda|hosoda|anno|otomo|takahata|kitano)\b/i.test(name)) return "일본";
          // 중국/홍콩/대만식 이름 패턴
          if (/\b(?:zhang|wong|ang|chen|tsai|hou|jia|feng|lou|wang)\b/i.test(name) && /\b(?:yimou|kar-wai|lee|kaige|ming-liang|hsiao-hsien|zhangke|xiaogang|ye|xiaoshuai)\b/i.test(name)) return "중국";
          // 한국 성씨 + 영문 이름
          if (/\b(?:bong|park|kim|lee|im|hong|yeon|shin|choi|jang|ryu|kwak)\b/i.test(name) && /joon|chan|wook|sang|min|dae|hyun|ki|ho|jun|woo/i.test(name)) return "한국";
          // 인도 이름 패턴
          if (/\b(?:ray|rajamouli|bhansali|kashyap|ghosh|nair|ratnam|gowariker|hirani|mehra)\b/i.test(name)) return "인도";
          // 유럽 패턴 (불어/독어/이탈리아/스칸디나비아 성씨)
          if (/\b(?:godard|truffaut|bergman|tarkovsky|fellini|von trier|haneke|almodovar|refn|villeneuve|nolan|kubrick|lynch|coppola|herzog)\b/i.test(name)) return "유럽";
          // 중남미
          if (/\b(?:cuaron|del toro|inarritu|guerra|babenco|salles)\b/i.test(name)) return "중남미";
          // 설명에서 국가 힌트
          if (/(?:korean|한국|korea)/i.test(combined)) return "한국";
          if (/(?:japanese|일본|japan)/i.test(combined)) return "일본";
          if (/(?:chinese|중국|china|hong kong|taiwan)/i.test(combined)) return "중국";
          if (/(?:indian|인도|india|bollywood)/i.test(combined)) return "인도";
          if (/(?:french|german|italian|scandinavian|british|유럽|europe)/i.test(combined)) return "유럽";
          return "미국"; // 최종 기본값
        };

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
              // 이름/설명에서 지역 힌트 추론 (하드코딩 "미국" 방지)
              const inferredRegion = inferRegionFromName(name, nameKo, desc);
              naturalDirs.push({ name, nameKo: nameKo || name, description: desc, region: inferredRegion, style: "", fitScore: 65, reason: desc.slice(0, 100) });
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

          // ── signatureTechniques 검증/보정: 할루시네이션 방지 ──
          const rawTech = d.signatureTechniques as Record<string, string> | undefined;
          const sanitizedTech = sanitizeSignatureTechniques(rawTech, String(d.name));
          if (sanitizedTech !== rawTech) {
            d.signatureTechniques = sanitizedTech;
          }

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
            maxOutputTokens: 4096,
            ...(opts.forceMimeType ? { responseMimeType: "application/json" as const } : {}),
          },
          ...(opts.useGrounding ? { tools: [{ google_search: {} }] } : {}),
        };

        let res: Response;
        try {
          // grounding 호출 타임아웃 — 후속 stage 여유를 위해 30초로 제한
          const timeoutMs = 45_000; // 단일 호출 — Cloudflare 60초 제한 내 여유 있게 45초
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

      // ── 단일 호출: 모델 지식으로 글 분석 → 감독 추천 (grounding 없음, JSON 강제) ──
      let stageAccepted: Array<Record<string, unknown>> = [];
      let allEmptyReasons: WebSearchEmptyReason[] = [];

      console.info(`[recommend-director] 감독 추천 시작 — 글 자체 분석 (streamingGenerate)`);

      // streamingGenerate 사용 — 청크 단위 응답으로 Cloudflare 타임아웃 회피
      const streamStart = Date.now();
      const streamBody: Record<string, unknown> = {
        contents: [{ role: "user", parts: [{ text: buildWebPrompt() }] }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 8192,
          responseMimeType: "application/json" as const,
        },
      };
      const streamResult = await streamingGenerate(context.env, GEMINI_MODEL_FLASH, streamBody, { timeoutMs: 50_000 });
      const streamDuration = Date.now() - streamStart;
      const streamText = streamResult.text?.trim() ?? "{}";

      // streamingGenerate 결과를 processWebResponse 형식으로 변환
      let result: {
        accepted: Array<Record<string, unknown>>; rejected: number; reasons: string[];
        rawCount: number; emptyReasons: WebSearchEmptyReason[]; partialRecoveryCount: number;
        grounded: boolean; httpStatus: number | null; timeoutOccurred: boolean;
        rawSnippet: string; durationMs: number;
      };

      if (streamResult.timedOut) {
        // 완전 타임아웃 — 부분 텍스트로 복구 시도
        console.warn(`[recommend-director] streamingGenerate 타임아웃: ${streamResult.error?.slice(0, 200)}`);
        const partialDirectors = streamText.length > 10 ? recoverTruncatedDirectors(streamText) : [];
        if (partialDirectors.length > 0) {
          console.log(`[recommend-director] 타임아웃이지만 부분 복구 성공: ${partialDirectors.length}명`);
          const validated = processWebResponse(JSON.stringify({ directors: partialDirectors }), [], "direct_analysis_timeout_recovery");
          result = {
            ...validated,
            partialRecoveryCount: partialDirectors.length,
            grounded: false,
            httpStatus: streamResult.status ?? null, timeoutOccurred: true,
            rawSnippet: streamText.slice(0, 200), durationMs: streamDuration,
          };
        } else {
          result = {
            accepted: [], rejected: 0, reasons: [], rawCount: 0,
            emptyReasons: ["provider_timeout"],
            partialRecoveryCount: 0, grounded: false,
            httpStatus: streamResult.status ?? null, timeoutOccurred: true,
            rawSnippet: streamResult.error?.slice(0, 100) ?? "", durationMs: streamDuration,
          };
        }
      } else if (streamResult.error && streamResult.truncated && streamText.length > 10) {
        // MAX_TOKENS 절단 — 부분 텍스트에서 완성된 감독 객체 복구
        console.warn(`[recommend-director] streamingGenerate MAX_TOKENS 절단 (${streamText.length}자) — 부분 복구 시도`);
        const partialDirectors = recoverTruncatedDirectors(streamText);
        if (partialDirectors.length > 0) {
          console.log(`[recommend-director] MAX_TOKENS 부분 복구 성공: ${partialDirectors.length}명`);
          const validated = processWebResponse(JSON.stringify({ directors: partialDirectors }), [], "direct_analysis_truncated_recovery");
          result = {
            ...validated,
            partialRecoveryCount: partialDirectors.length,
            grounded: false,
            httpStatus: 200, timeoutOccurred: false,
            rawSnippet: streamText.slice(0, 200), durationMs: streamDuration,
          };
        } else {
          console.warn(`[recommend-director] MAX_TOKENS 부분 복구 실패 — 완성된 객체 없음`);
          result = {
            accepted: [], rejected: 0, reasons: [], rawCount: 0,
            emptyReasons: ["provider_failed"],
            partialRecoveryCount: 0, grounded: false,
            httpStatus: 200, timeoutOccurred: false,
            rawSnippet: `MAX_TOKENS(${streamText.length}자): ${streamText.slice(0, 100)}`, durationMs: streamDuration,
          };
        }
      } else if (streamResult.error) {
        // 기타 에러 (non-truncated)
        console.warn(`[recommend-director] streamingGenerate 실패: ${streamResult.error?.slice(0, 200)}`);
        result = {
          accepted: [], rejected: 0, reasons: [], rawCount: 0,
          emptyReasons: ["provider_failed"],
          partialRecoveryCount: 0, grounded: false,
          httpStatus: streamResult.status ?? null, timeoutOccurred: false,
          rawSnippet: streamResult.error?.slice(0, 100) ?? "", durationMs: streamDuration,
        };
      } else {
        const parsed = processWebResponse(streamText, [], "direct_analysis");
        result = {
          ...parsed,
          grounded: false,
          httpStatus: 200, timeoutOccurred: false,
          rawSnippet: streamText.slice(0, 200), durationMs: streamDuration,
        };
        console.log(`[recommend-director] streamingGenerate 성공: ${parsed.accepted.length}명, elapsed=${streamDuration}ms`);
      }
      webSearchAttemptCount = 1;
      finalProvider = `${GEMINI_MODEL_FLASH} (direct_analysis)`;
      retryStagesLog.push({
        stage: 1, name: "direct_analysis", model: GEMINI_MODEL_FLASH,
        grounded: false, normalizedQuery: webSearchQuery || "",
        timeoutOccurred: result.timeoutOccurred, httpStatus: result.httpStatus,
        rawResultCount: result.rawCount, acceptedCount: result.accepted.length,
        rejectedCount: result.rejected, emptyReasons: result.emptyReasons,
        triggerReason: "direct_text_analysis",
        partialRecoveryCount: result.partialRecoveryCount, durationMs: result.durationMs,
      });
      if (result.timeoutOccurred) pipelineTimeoutOccurred = true;
      webSearchRawBeforeDedup += result.rawCount;
      webSearchPartialRecoveryCount += result.partialRecoveryCount;
      if (result.rawSnippet) webSearchRawSnippet = result.rawSnippet;
      webSearchRejectionReasons.push(...result.reasons.map(r => `[direct_analysis] ${r}`));
      allEmptyReasons.push(...result.emptyReasons);

      if (result.accepted.length > 0) {
        // direct_analysis 모드: 모델 지식 기반이지만 정상 추천 결과이므로 grounded로 마킹
        stageAccepted = result.accepted.map(d => ({ ...d, grounded: true }));
        finalGrounded = true;
        console.log(`[recommend-director] 감독 추천 성공: ${result.accepted.length}명 채택`);
      } else {
        console.log(`[recommend-director] 감독 추천 실패: ${result.emptyReasons.join(",")}`);
      }

      // ── 시나리오 지역 기반 정렬: 같은 region 감독 우선 ──
      if (scenarioRegions.length > 0 && stageAccepted.length > 1) {
        const regionSet = new Set(scenarioRegions.map(r => r.toLowerCase()));
        stageAccepted.sort((a, b) => {
          const aMatch = regionSet.has(String(a.region || "").toLowerCase()) ? 1 : 0;
          const bMatch = regionSet.has(String(b.region || "").toLowerCase()) ? 1 : 0;
          if (aMatch !== bMatch) return bMatch - aMatch; // 같은 region 우선
          return (Number(b.fitScore) || 0) - (Number(a.fitScore) || 0); // 동일 region 내에서 fitScore 내림차순
        });
        console.log(`[recommend-director] region-based sort applied: scenarioRegions=${scenarioRegions.join(",")}, order=${stageAccepted.map(d => `${d.nameKo}(${d.region})`).join(" → ")}`);
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
        const _recoveredAtStage = retryStagesLog.find(s => s.acceptedCount > 0)?.stage ?? null;
        const recoveryNote = _recoveredAtStage && _recoveredAtStage > 1 ? ` (stage ${_recoveredAtStage}에서 복구)` : "";
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
    console.info(`[recommend-director] STEP 3: assembling final response, elapsed=${Date.now() - _rdStartMs}ms`);

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
      scenarioRegions,
      consideredLocalCount: 0,
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

    console.info(`[recommend-director] Final response: localMatches=${finalLocalCount}, webSuggestions=${finalWebCount}, total=${finalCount}, elapsed=${Date.now() - _rdStartMs}ms`);
    return Response.json({
      analysis: "",
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
    console.info(`[recommend-director] Unhandled error caught: ${errMsg}, elapsed=${Date.now() - _rdStartMs}ms`);
    console.error("[recommend-director] 예외:", errMsg);
    return Response.json({
      error: `[recommend-director] ${errMsg}`,
      code: "INTERNAL_ERROR",
      help: "서버 로그와 브라우저 콘솔을 확인하세요.",
      detail: errMsg.slice(0, 500),
    }, { status: 500 });
  }
};
