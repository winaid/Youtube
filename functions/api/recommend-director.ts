import { GeminiEnv, fetchWithAuth, buildGeminiUrl, GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH, geminiErrorResponse, parseFirstJsonObject } from "./_gemini-keys";

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

  // ── Direct genre keywords (Korean + English) ──
  const genreMap: [RegExp, string][] = [
    [/(?:로맨스|사랑|연인|연애|설레|키스)/, "로맨스"],
    [/(?:호러|공포|귀신|유령|좀비|저주|괴물|으스스|소름|horror)/, "호러"],
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
    // what-if 자체가 장르 힌트를 주지만, 단독으로 장르 확정은 금지
    if (genres.length === 0) {
      reasons.push("speculative format detected but no genre-confirming context found");
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
    [/(?:공포|무서|섬뜩|으스스|소름|creepy)/, "공포"],
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
export function buildEnhancedWebSearchQuery(
  genres: string[],
  moods: string[],
  keywords: string[],
  pre: PreExtractedSignals,
): { query: string; queryReasons: string[] } {
  const queryReasons: string[] = [];

  // 기본 소재 수집
  const genreParts = genres.slice(0, 3);
  const moodParts = moods.slice(0, 2);
  const keyParts = keywords.slice(0, 2);

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
      queryReasons.push(`visual hints补充 query: ${extraVisual.join(", ")}`);
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
      queryReasons.push(`format hints补充 query: ${extraFormat.join(", ")}`);
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
  queryReasons.push(`query built from ${allParts.length} signal parts`);

  return { query, queryReasons };
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
  localResultCount: number;
  externalResultCount: number;
  finalResultCount: number;
  emptyReason?: string;
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

    console.log(`[recommend-director] STEP 1: 로컬 매칭 시작 (model=flash, pool=${directorPoolSize})`);

    let res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, GEMINI_MODEL_FLASH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(localRequestBody),
    });

    if (!res.ok) {
      const errText1 = await res.text();
      console.warn(`[recommend-director] FLASH 실패(${res.status}), PRO fallback. detail: ${errText1.slice(0, 300)}`);
      res = await fetchWithAuth(context.env, buildGeminiUrl(context.env, GEMINI_MODEL_PRO), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localRequestBody),
      });
    }

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
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

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
    // STEP 2: 웹 검색 기반 외부 감독 추천
    // ═══════════════════════════════════════════════════════════
    // 로컬 결과가 약하거나 (0~1명, fitScore < 60) 비었을 때 실행
    // Google AI의 googleSearchRetrieval tool을 사용해서 실제 검색

    let webSuggestions: Array<Record<string, unknown>> = [];
    // 항상 웹 검색 실행 — 로컬 결과와 무관하게 외부 후보 확장
    {
      attemptedWebSearch = true;

      // 검색 쿼리 구성 — 사전 추출 신호로 보강
      const enhanced = buildEnhancedWebSearchQuery(extractedGenres, extractedMoods, extractedKeywords, preSignals);
      webSearchQuery = enhanced.query;
      if (enhanced.queryReasons.length > 0) {
        signalDetails.push(`web query: ${enhanced.queryReasons.join("; ")}`)
      }

      console.log(`[recommend-director] STEP 2: 웹 검색 시도 — query="${webSearchQuery}"`);

      try {
        // Gemini with googleSearchRetrieval tool — 실제 웹 검색
        const webSearchBody = {
          contents: [{ role: "user", parts: [{ text: `Based on web search results, recommend 2-3 real film/animation directors whose visual style best matches this scenario:

Scenario keywords: ${extractedGenres.slice(0, 3).join(" ")} ${extractedMoods.slice(0, 2).join(" ")} ${extractedKeywords.slice(0, 2).join(" ")}
Scenario excerpt: ${storyText.slice(0, 400)}

For each director, provide:
- name (English)
- nameKo (Korean)
- region: one of 한국|일본|중국|유럽|미국|인도|중동|동남아|중남미|아프리카|오세아니아
- style: comma-separated Korean style keywords (max 5)
- description: 2-3 sentences in Korean about their visual directing style
- reason: 2 sentences in Korean why this director fits the scenario
- fitScore: 0-100
- signatureTechniques: { cameraWork, colorPalette, lighting, editingStyle, moodKeywords } all in English
- notableWorks: array of 3 representative works

Return as JSON: { "directors": [...] }
Only recommend real, existing directors. No fictional directors.` }] }],
          tools: [{ googleSearchRetrieval: {} }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 3072,
          },
        };

        webSearchProvider = "gemini-google-search-retrieval";

        const webRes = await fetchWithAuth(
          context.env,
          buildGeminiUrl(context.env, GEMINI_MODEL_PRO),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(webSearchBody),
          },
        );

        if (webRes.ok) {
          const webData = await webRes.json() as {
            candidates?: {
              content?: { parts?: { text?: string }[] };
              groundingMetadata?: {
                searchEntryPoint?: { renderedContent?: string };
                groundingChunks?: Array<{ web?: { uri: string; title: string } }>;
              };
            }[];
          };

          const webText = webData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

          // grounding metadata 확인 — 실제 검색이 이루어졌는지 증거
          const grounding = webData?.candidates?.[0]?.groundingMetadata;
          const groundingChunks = grounding?.groundingChunks ?? [];
          if (groundingChunks.length > 0) {
            console.log(`[recommend-director] 웹 검색 grounding 확인: ${groundingChunks.length}개 소스`);
            webSearchProvider = `gemini-google-search-retrieval (${groundingChunks.length} sources)`;
          }

          let webParsed: Record<string, unknown>;
          try {
            webParsed = JSON.parse(webText) as Record<string, unknown>;
          } catch {
            webParsed = (parseFirstJsonObject(webText) as Record<string, unknown>) ?? {};
          }

          const rawWebDirs = Array.isArray(webParsed.directors) ? webParsed.directors as Array<Record<string, unknown>> : [];
          webSearchResultCount = rawWebDirs.length;

          // 로컬 목록과 중복 제거 + slug id 생성
          const localNames = new Set((localDirectors || []).map(d => d.name.toLowerCase()));
          for (const d of rawWebDirs) {
            const name = String(d.name || "").toLowerCase();
            if (localNames.has(name)) {
              webSearchRejectedCount++;
              webSearchRejectionReasons.push(`"${d.name}" already in local pool`);
              continue;
            }
            if (!d.name || !d.nameKo) {
              webSearchRejectedCount++;
              webSearchRejectionReasons.push(`missing name/nameKo`);
              continue;
            }

            // Generate slug id
            const region = String(d.region || "미국");
            const regionSlug: Record<string, string> = {
              "한국": "kr", "일본": "jp", "중국": "cn", "유럽": "eu",
              "미국": "us", "인도": "in", "중동": "me", "동남아": "sea",
              "중남미": "la", "아프리카": "af", "오세아니아": "oc",
            };
            const rSlug = regionSlug[region] ?? "xx";
            const nameSlug = String(d.name).split(" ").pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "unknown";
            const webId = `web-${rSlug}-${nameSlug}`;

            // Clamp fitScore + ensure reason
            if (typeof d.fitScore === "number") d.fitScore = Math.max(0, Math.min(100, Math.round(d.fitScore)));
            if (!d.reason || typeof d.reason !== "string") d.reason = "(이유 미제공)";

            // grounding source 정보 포함
            const sources = groundingChunks
              .filter(c => c.web)
              .map(c => ({ title: c.web!.title, url: c.web!.uri }));

            webSuggestions.push({
              ...d,
              id: webId,
              _source: "web_search",
              grounded: sources.length > 0,
              sources: sources.length > 0 ? sources : undefined,
            });
            webSearchAcceptedCount++;
          }

          if (webSuggestions.length > 0) {
            stageStatus.webSearch = "attempted_success";
            stageReasons.webSearch = `검색 결과 ${webSearchResultCount}개 중 ${webSearchAcceptedCount}개 채택`;
          } else {
            stageStatus.webSearch = "attempted_empty";
            stageReasons.webSearch = webSearchResultCount > 0
              ? `검색 결과 ${webSearchResultCount}개 모두 로컬 중복 또는 불완전`
              : "검색 결과 없음";
          }
        } else {
          const webErr = await webRes.text();
          console.warn(`[recommend-director] 웹 검색 실패(${webRes.status}): ${webErr.slice(0, 300)}`);
          stageStatus.webSearch = "failed";
          stageReasons.webSearch = `API 실패 (${webRes.status})`;
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn(`[recommend-director] 웹 검색 예외: ${errMsg}`);
        stageStatus.webSearch = "failed";
        stageReasons.webSearch = `예외: ${errMsg.slice(0, 100)}`;
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Final Assembly
    // ═══════════════════════════════════════════════════════════

    const finalLocalCount = localMatches.length;
    const finalWebCount = webSuggestions.length;
    const finalCount = finalLocalCount + finalWebCount;

    let emptyReason: string | undefined;
    if (finalCount === 0) {
      if (stageStatus.extractSignals === "weak") {
        emptyReason = "genre_mood_not_detected";
      } else if (directorPoolSize === 0) {
        emptyReason = "empty_director_pool";
      } else if (stageStatus.localMatch === "invalid_ids") {
        emptyReason = "all_local_ids_hallucinated";
      } else if (stageStatus.webSearch === "attempted_empty") {
        emptyReason = "web_search_returned_empty";
      } else if (stageStatus.webSearch === "failed") {
        emptyReason = "web_search_failed_and_no_local";
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
      localResultCount: finalLocalCount,
      externalResultCount: finalWebCount,
      finalResultCount: finalCount,
      emptyReason,
      modelUsed,
      preExtracted: preSignals,
      signalMergeReasons: mergeResult.mergeReasons,
    };

    // ── Log pipeline ──
    console.log("[recommend-director] pipeline:", JSON.stringify({
      stages: stageStatus,
      local: finalLocalCount,
      web: finalWebCount,
      total: finalCount,
      emptyReason,
      webSearched: attemptedWebSearch,
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
