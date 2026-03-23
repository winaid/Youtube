/**
 * Historical Knowledge Base — 아시아 역사 시대별 시각적 디테일 DB.
 * term detector가 키워드를 매칭하고, resolver가 visualAnchors/avoid를 프롬프트에 주입.
 */
import type { HistoricalKnowledgeEntry } from "@/types/historical-grounding";

export const HISTORICAL_KNOWLEDGE_BASE: HistoricalKnowledgeEntry[] = [
  // ========== 한국 (Korea) ==========
  {
    terms: ["조선", "조선시대", "joseon", "chosŏn", "joseon dynasty"],
    region: "Korea",
    period: "Joseon Dynasty",
    eraApprox: "1392–1897",
    visualAnchors: [
      { category: "costume", description: "hanbok with wide-brimmed gat (horsehair hat), dopo (outer robe), white cotton jeogori and dark blue or black chima for commoners; silk durumagi for yangban", descriptionKo: "갓과 도포를 쓴 양반, 흰 저고리에 검은 치마의 평민 한복" },
      { category: "architecture", description: "giwa (curved clay roof tiles), dancheong (red-green-blue painted eaves), wooden hanok with ondol heated stone floors, low wooden doors with hanji paper", descriptionKo: "기와지붕, 단청, 한지 문살이 있는 한옥" },
      { category: "props", description: "inkstone and brush set (munbangsau), bamboo smoking pipe (dambaetdae), ceramic onggi pots, paper lanterns with calligraphy, wooden jige (A-frame carrier)", descriptionKo: "문방사우, 담뱃대, 옹기, 한지 등불, 지게" },
      { category: "lifestyle", description: "seated on floor cushions (bangseok), communal rice meals with banchan in brass bowls, scholarly calligraphy practice", descriptionKo: "방석에 앉아 놋그릇에 밥과 반찬, 서예 수련" },
      { category: "landscape", description: "pine-covered Korean mountains, terraced rice paddies, narrow unpaved village alleys, thatched-roof (chogajip) farmhouses", descriptionKo: "소나무 산, 계단식 논, 비포장 골목, 초가집" },
    ],
    avoid: [
      "Chinese qipao or mandarin collar", "Japanese tatami or shoji screen", "neon signage", "modern glass buildings",
      "concrete roads", "electric lighting", "plastic objects", "wristwatch",
    ],
    evidence: [
      { type: "text_source", content: "National Museum of Korea — Joseon Dynasty collection reference" },
      { type: "known_artifact", content: "Sungnyemun (Namdaemun) gate architecture as period reference" },
    ],
  },
  {
    terms: ["주막", "jumak", "tavern joseon", "조선 주막"],
    region: "Korea",
    period: "Joseon Dynasty",
    eraApprox: "1392–1897",
    visualAnchors: [
      { category: "architecture", description: "small thatched-roof inn (jumak) with wooden signboard, open-front serving area, low wooden bench seating, clay floor", descriptionKo: "초가지붕 주막, 나무 간판, 낮은 평상, 흙바닥" },
      { category: "props", description: "ceramic makgeolli bowl (사발), wooden tray with pajeon (scallion pancake), straw-woven rain cape (도롱이), straw sandals (짚신)", descriptionKo: "막걸리 사발, 파전 쟁반, 도롱이, 짚신" },
      { category: "lifestyle", description: "travelers resting under eaves, sharing rice wine and simple dishes, tying horses to wooden post outside", descriptionKo: "처마 밑에서 쉬는 여행자, 막걸리와 안주 나눔, 문 밖에 말 매기" },
    ],
    avoid: [
      "Japanese izakaya aesthetic", "Chinese baijiu bottles", "glass cups", "modern chairs or tables",
    ],
    evidence: [
      { type: "text_source", content: "풍속화 (genre paintings) by Kim Hong-do and Shin Yun-bok depict jumak scenes" },
    ],
  },
  {
    terms: ["선비", "seonbi", "scholar joseon", "유생", "유학자"],
    region: "Korea",
    period: "Joseon Dynasty",
    eraApprox: "1392–1897",
    visualAnchors: [
      { category: "costume", description: "white or pale blue dopo (scholar's overcoat), black horsehair gat hat, jade or amber decorative pendant (norigae), white cotton socks (beoseon)", descriptionKo: "흰 도포, 검은 갓, 노리개, 흰 버선" },
      { category: "props", description: "folding fan (buchae), bound classical texts, ink brush and inkstone, bamboo walking staff", descriptionKo: "부채, 고전 서적, 붓과 벼루, 대나무 지팡이" },
      { category: "lifestyle", description: "contemplative posture, reading under pine tree, walking mountain trail with hands clasped behind back", descriptionKo: "사색하는 자세, 소나무 아래 독서, 손을 뒤로 모으고 산길 걷기" },
    ],
    avoid: [
      "Japanese samurai armor or katana", "Chinese mandarin hat (guanmao)", "modern eyeglasses",
    ],
    evidence: [
      { type: "known_artifact", content: "Portraits of Joseon scholars at National Museum of Korea" },
    ],
  },
  {
    terms: ["개화기", "gaehwagi", "korean enlightenment", "경성", "gyeongseong", "대한제국", "구한말"],
    region: "Korea",
    period: "Korean Empire / Enlightenment Period",
    eraApprox: "1897–1910",
    visualAnchors: [
      { category: "costume", description: "mix of traditional hanbok and early Western suits, women in reformed jeogori with longer chima, men in bowler hats or durumagi with leather shoes", descriptionKo: "한복과 양복 혼재, 개량 저고리, 중절모, 구두" },
      { category: "architecture", description: "early brick Western-style buildings alongside hanok, wooden electric poles, iron-rail streetcar tracks, Seodaemun-style stone gate", descriptionKo: "벽돌 양옥과 한옥 공존, 나무 전봇대, 전차 선로" },
      { category: "props", description: "early streetcar (jeoncha), kerosene street lamps, printed newspaper broadsheets, pocket watch on chain", descriptionKo: "전차, 석유 가로등, 신문, 회중시계" },
      { category: "landscape", description: "wide unpaved Jongno avenue with mixed foot and streetcar traffic, Namsan hill in background", descriptionKo: "종로 비포장 대로, 전차와 보행자 혼재, 남산 배경" },
    ],
    avoid: [
      "modern automobiles", "skyscrapers", "digital signage", "Japanese colonial period military uniforms (post-1910)",
    ],
    evidence: [
      { type: "text_source", content: "Seoul Museum of History — late 19th century Gyeongseong photographs" },
      { type: "image_search_hint", content: "1900s Seoul streetcar Jongno historical photo" },
    ],
  },

  // ========== 일본 (Japan) ==========
  {
    terms: ["에도", "에도시대", "edo", "edo period", "도쿠가와", "tokugawa"],
    region: "Japan",
    period: "Edo Period",
    eraApprox: "1603–1868",
    visualAnchors: [
      { category: "costume", description: "layered kimono with obi sash, wooden geta sandals, hair in shimada or nihongami style for women; hakama and haori for samurai", descriptionKo: "겹겹이 입은 기모노와 오비, 게타, 시마다 머리; 사무라이 하카마와 하오리" },
      { category: "architecture", description: "machiya (wooden townhouse) with noren curtains, shoji sliding paper screens, engawa (wooden veranda), kawara clay tile roofs", descriptionKo: "마치야(목조 상가), 노렌, 쇼지 미닫이, 엔가와, 기와 지붕" },
      { category: "props", description: "paper umbrella (wagasa), wooden bucket, ceramic sake flask (tokkuri), folding fan (sensu), calligraphy brush set (fude)", descriptionKo: "와가사(종이 우산), 나무 물통, 도쿠리(도자기 술병), 센스(접부채), 붓" },
      { category: "lifestyle", description: "walking narrow alleyways between machiya, merchant stalls with hanging noren, stepping stones across shallow stream", descriptionKo: "마치야 사이 좁은 골목 걷기, 노렌 걸린 상점, 징검다리" },
      { category: "landscape", description: "castle town layout with moat, cherry blossom along canal, wooden bridge over river, distant Mt. Fuji", descriptionKo: "해자가 있는 성하마을, 벚꽃 늘어선 운하, 나무 다리, 먼 후지산" },
    ],
    avoid: [
      "Korean hanbok or gat", "Chinese qipao", "modern concrete buildings", "electric lights", "automobiles",
      "Western-style suits (pre-Meiji)", "plastic packaging",
    ],
    evidence: [
      { type: "text_source", content: "Ukiyo-e woodblock prints by Hiroshige and Hokusai as visual reference" },
      { type: "known_artifact", content: "Edo-Tokyo Museum — period lifestyle recreation" },
    ],
  },

  // ========== 중국 (China) ==========
  {
    terms: ["청나라", "청조", "청나라 말기", "qing", "qing dynasty", "만청", "late qing"],
    region: "China",
    period: "Qing Dynasty (Late)",
    eraApprox: "1850–1912",
    visualAnchors: [
      { category: "costume", description: "changshan (long gown) with mandarin collar and toggle buttons, women in qipao prototype (wide-cut changpao), queue hairstyle for men (shaved front, long braid)", descriptionKo: "만다린 칼라 장삼, 여성 창파오, 남성 변발" },
      { category: "architecture", description: "siheyuan (courtyard house) with red lacquered pillars, upturned eaves with glazed roof tiles, stone lion guardians at gates, ornate moon gates", descriptionKo: "사합원, 붉은 칠기둥, 유리기와 처마, 석사자, 월문" },
      { category: "props", description: "opium pipe (later period), abacus (suanpan), porcelain tea set, hanging red silk lanterns, wooden rickshaw", descriptionKo: "주판, 도자기 차 세트, 붉은 비단 등, 인력거" },
      { category: "lifestyle", description: "tea house gatherings, street vendors with pole-carried baskets, calligraphy with large brush on stone, market haggling", descriptionKo: "다방 모임, 짐대 진 행상, 석판 위 서예, 시장 흥정" },
      { category: "landscape", description: "bustling commercial street with hanging shop signs, stone-paved alley, canal-side town with arched stone bridges", descriptionKo: "간판 걸린 상업거리, 석조 골목, 아치 돌다리가 있는 수향 마을" },
    ],
    avoid: [
      "Korean hanbok", "Japanese kimono", "modern PRC communist-era architecture", "LED signage",
      "contemporary Chinese fashion", "simplified Chinese political slogans",
    ],
    evidence: [
      { type: "text_source", content: "Late Qing photographs from Beijing and Shanghai archives" },
      { type: "image_search_hint", content: "late Qing dynasty street scene Shanghai 1900" },
    ],
  },

  // ========== 모호한/범아시아 (Vague / Pan-Asian) ==========
  {
    terms: ["전통 아시아", "traditional asian", "oriental", "동양 전통", "ancient asian", "old asian", "아시아 전통"],
    region: "Ambiguous-Asia",
    period: "Unresolved",
    eraApprox: "Unknown",
    visualAnchors: [],
    avoid: [
      "generic bamboo + pagoda + lantern combination without specific regional grounding",
      "mixing kimono with hanbok or qipao in same scene",
      "pan-Asian fantasy aesthetic that blends distinct cultures",
    ],
    evidence: [],
  },
];

/**
 * 키워드 → HistoricalKnowledgeEntry 빠른 조회용 역색인.
 * 초기화 시 한 번만 빌드.
 */
const _termIndex = new Map<string, HistoricalKnowledgeEntry[]>();

function ensureIndex() {
  if (_termIndex.size > 0) return;
  for (const entry of HISTORICAL_KNOWLEDGE_BASE) {
    for (const t of entry.terms) {
      const key = t.toLowerCase();
      const existing = _termIndex.get(key) || [];
      existing.push(entry);
      _termIndex.set(key, existing);
    }
  }
}

/** 단일 텀에 대해 매칭되는 knowledge entry 반환 */
export function lookupByTerm(term: string): HistoricalKnowledgeEntry[] {
  ensureIndex();
  return _termIndex.get(term.toLowerCase()) || [];
}

/** 전체 인덱스 반환 (테스트용) */
export function getTermIndex(): Map<string, HistoricalKnowledgeEntry[]> {
  ensureIndex();
  return _termIndex;
}
