import { StoryAIPersona, PromptCard } from "@/types";

// ─── 카드형 프롬프트 풀 ───────────────────────────────────────────────────────
//
// 선정 기준 (병의원 마케팅 사례만):
//  1. 실존 인물 또는 실존 의료기관만 (지어낸 사례 금지)
//  2. 의사/의원/의료인만
//  3. "환자를 모으거나 병원을 알리기 위한 실제 마케팅/홍보/브랜딩 전략"이 핵심
//  4. 전 세계 다양한 지역/문화권의 사례 포함 (지역 편중 금지)
//  5. 구체적 홍보 수단이 있는 사례만
//  ※ 제외: 의대 입학, 면허 투쟁, 의학 업적 자체, 개인 성공 서사, 독립운동 등
//     → 마케팅/환자유치 전략이 없으면 아무리 유명한 사례라도 제외

// ── pool 1: 역사 마케팅 — 전 세계 의사들의 환자 유치 전략 ─────────────────────

const historyMarketingCards: PromptCard[] = [
  {
    title: "엘리자베스 블랙웰이 '여성 전용 병원'으로 뉴욕 환자를 모은 전략",
    hook: "19세기에도 '남자 의사한테 몸 보이기 싫어'는 있었음. 그래서 이 의사는 그걸 사업 모델로 만들었음",
    marketingTactic: "여성 전용 병원 포지셔닝",
  },
  {
    title: "'페인리스 파커'가 법적으로 이름을 바꿔 광고 규제를 뚫은 방법",
    hook: "광고에 '무통'을 못 쓰게 법으로 막자 아예 본명을 '페인리스'로 바꾼 치과 의사 실화 (1910s)",
    marketingTactic: "법적 개명으로 광고 제한 우회",
  },
  {
    title: "수전 라 플레시 피코트가 오마하족 언어로 원주민 환자를 모은 전략",
    hook: "백인 의사를 거부하는 원주민 마을에서 '나는 너희 중 하나야'를 마케팅으로 쓴 의사",
    marketingTactic: "민족 정체성·모국어로 불신 커뮤니티 신뢰 획득",
  },
  {
    title: "레베카 리 크럼플러가 남북전쟁 직후 해방 노예 대상 의료로 입지를 굳힌 이야기",
    hook: "백인 병원이 안 받아주는 환자를 찾아간 의사가 미국 역사에 남은 방법 (1865년)",
    marketingTactic: "소외 커뮤니티 전용 진료 + 의학서 출판(1883)으로 권위 구축",
  },
  {
    title: "엘리자베스 개럿 앤더슨이 런던에 여성 전용 진료소를 열어 차별을 역이용한 방법",
    hook: "여성이라 남성 환자를 못 본다는 규정을 뒤집어서 오히려 '여성 전용'을 차별화로 만든 의사",
    marketingTactic: "성별 제약을 '여성 환자 전용' 브랜딩으로 전환 (1866년)",
  },
  {
    title: "다니엘 헤일 윌리엄스가 '모든 인종 환자 환영'을 차별화 메시지로 쓴 병원 브랜딩",
    hook: "1891년 시카고에서 흑인 의사가 '인종 무관'을 대놓고 병원 광고로 내건 이야기",
    marketingTactic: "인종 통합 정책을 차별화 메시지로 활용한 Provident Hospital 브랜딩",
  },
  {
    title: "빅토리아 시대 치과 신문 광고 '무통 발치'가 환자를 끌어모은 방법",
    hook: "지금 치과 광고에 '무통 치료' 쓰는 거 150년 전에도 신문에 버젓이 있었음 (1880s)",
    marketingTactic: "신문 광고에 'Painless Extraction' 공포 해소 메시지 강조",
  },
  // ── 한국 ──
  {
    title: "허준이 『동의보감』 한 권으로 조선 최고 의관이 된 브랜딩 전략",
    hook: "천민 출신이 왕의 주치의가 된 방법? 책 한 권 썼음. 근데 그게 유네스코 세계기록유산이 됨 (1613년)",
    marketingTactic: "의학서 출판 → 국가 공인 권위자 포지셔닝",
  },
  {
    title: "백광현이 서양 의학 도입해서 조선 궁중에서 입지를 굳힌 전략",
    hook: "조선 시대에 천연두 예방접종을 처음 시도한 의사가 궁중 의관으로 올라간 방법 (1879년)",
    marketingTactic: "서양 신기술 선점 → 궁중 독점 포지셔닝",
  },
  // ── 일본 ──
  {
    title: "하나오카 세이슈가 세계 최초 전신마취 수술로 전국 환자를 끌어모은 방법",
    hook: "유럽보다 40년 앞서 전신마취를 성공시킨 의사가 일본에 있었음. 제자가 전국에서 몰려옴 (1804년)",
    marketingTactic: "세계 최초 전신마취 성공 → 제자 네트워크로 전국 명성 확산",
  },
  // ── 중국 ──
  {
    title: "화타가 공개 수술 시연으로 후한 최고 의사로 이름 날린 방법",
    hook: "마취약 '마비산' 만들어서 배 가르는 수술을 공개로 한 의사. 1800년 전 이야기임 (후한)",
    marketingTactic: "공개 수술 시연 + 마취 기술 독점으로 전국 명의 브랜딩",
  },
  {
    title: "이시진이 『본초강목』 27년 집필로 중국 의학계 최고 권위가 된 방법",
    hook: "27년 동안 산 넘고 들 다니며 약초 다 조사한 의사. 결과물이 아시아 의학 바이블이 됨 (1596년)",
    marketingTactic: "30년 현장 연구 + 백과사전 출판 → 불멸의 의학 권위 구축",
  },
  // ── 인도 ──
  {
    title: "수슈루타가 코 성형 수술을 2600년 전에 이미 하고 있었던 이야기",
    hook: "성형외과가 현대 의학인 줄 알지? 인도에서 2600년 전에 이미 코 재건술 하고 있었음",
    marketingTactic: "독보적 기술력 시연 → '성형외과의 아버지' 브랜딩",
  },
  // ── 중동 ──
  {
    title: "이븐 시나(아비센나)의 『의학정전』이 유럽 의학 교과서가 된 방법",
    hook: "중동 의사가 쓴 책이 600년 동안 유럽 의대 교과서로 쓰였음. 번역만 30개 언어 (11세기)",
    marketingTactic: "백과사전형 의학서 출판 → 국경 넘는 글로벌 권위 구축",
  },
  // ── 아프리카 ──
  {
    title: "크리스티안 바나드가 세계 최초 심장 이식 수술로 남아공을 의학 강국으로 만든 방법",
    hook: "세계 최초 심장 이식 수술이 미국도 유럽도 아닌 남아공에서 나옴. 그리고 의사가 스타가 됨 (1967년)",
    marketingTactic: "세계 최초 수술 성공 → 즉시 글로벌 언론 노출 → 의료 관광 유발",
  },
  // ── 라틴아메리카 ──
];

// ── pool 2: 만약에 역사 — 팩트 기반 대체역사 / 가정형 역사 쇼츠 ─────────────────
//
// 선정 기준:
//  1. 실제 역사적 사실(갈림길)에서 출발하는 가정 시나리오
//  2. 전 세계 다양한 지역/시대를 포함
//  3. 논리적 인과관계가 느껴지는 "만약에" 주제
//  4. 음모론·혐오·정치 선동 금지
//  5. 흥미롭되 학술적 근거가 있는 가정만

const shortsScenarioCards: PromptCard[] = [
  // ── 유럽 ──
  {
    title: "만약 로마 제국이 멸망하지 않았다면?",
    hook: "476년 서로마가 무너지지 않고 계속 유지됐다면 지금 유럽 지도는 어떻게 생겼을까?",
    marketingTactic: "로마 지속 → 암흑기 소멸 → 산업혁명 500년 당김 가능성",
  },
  {
    title: "만약 나폴레옹이 워털루에서 이겼다면?",
    hook: "1815년 6월 18일. 비가 안 왔으면? 그루시가 제때 왔으면? 유럽 지도가 완전히 달라졌을 수도",
    marketingTactic: "나폴레옹 승리 → 유럽 통합 제국 유지 → 독일·이탈리아 통일 지연",
  },
  {
    title: "만약 흑사병이 유럽을 덮치지 않았다면?",
    hook: "14세기 유럽 인구 1/3이 죽은 흑사병. 이게 없었으면 르네상스도 없었을 수 있음",
    marketingTactic: "흑사병 부재 → 농노 해방 지연 → 르네상스·종교개혁 타임라인 변동",
  },
  // ── 아시아 ──
  {
    title: "만약 몽골 제국이 유럽을 더 오래 지배했다면?",
    hook: "1241년 오고타이 칸이 안 죽었으면 몽골군은 프랑스까지 갔을 수도 있음. 진짜로",
    marketingTactic: "몽골 유럽 지배 → 실크로드 초고속 확장 → 동서양 기술 융합 가속",
  },
  {
    title: "만약 중국이 공산당 체제가 아니었다면?",
    hook: "1949년 국공내전에서 장제스가 이겼다면? 중국은 지금 어떤 나라가 됐을까",
    marketingTactic: "국민당 승리 → 대만식 경제 모델 확대 → 미중 관계 근본적 변화",
  },
  {
    title: "만약 정화의 대항해가 계속됐다면?",
    hook: "1433년 명나라가 해금 정책을 안 폈다면? 콜럼버스보다 먼저 아메리카에 도착했을 수도",
    marketingTactic: "정화 항해 지속 → 중국 해양 제국 → 대항해시대 판도 뒤집힘",
  },
  // ── 한국 ──
  {
    title: "만약 조선이 해양 강국이 되었다면?",
    hook: "거북선 만든 나라가 왜 바다를 포기했을까? 만약 포기 안 했으면 동아시아 판이 바뀜",
    marketingTactic: "조선 해양 진출 → 일본 견제 → 동아시아 해상 무역 질서 재편",
  },
  {
    title: "만약 고구려가 당나라에 멸망하지 않았다면?",
    hook: "668년 고구려가 버텼다면? 한반도 통일은 신라가 아닌 고구려가 했을 수도",
    marketingTactic: "고구려 존속 → 만주 한민족 영토 유지 → 동북아 세력 균형 변동",
  },
  // ── 중동 ──
  {
    title: "만약 오스만 제국이 1차 세계대전에 참전하지 않았다면?",
    hook: "중립을 지켰다면 중동 국경선은 영국·프랑스가 아니라 오스만이 그렸을 것",
    marketingTactic: "오스만 비참전 → 사이크스-피코 협정 무산 → 현대 중동 분쟁 구조 자체가 다름",
  },
  // ── 아메리카 ──
  {
    title: "만약 아메리카 원주민에게 전염병 면역이 있었다면?",
    hook: "유럽 탐험가의 진짜 무기는 총이 아니라 천연두였음. 그게 없었다면?",
    marketingTactic: "원주민 면역 → 식민지 저항 성공 → 아메리카 대륙 독립 문명 유지",
  },
  {
    title: "만약 미국 남북전쟁에서 남부가 이겼다면?",
    hook: "1863년 게티즈버그에서 리 장군이 이겼다면? 미국은 두 나라로 나뉘었을 수도",
    marketingTactic: "남부 독립 → 북미 분단 → 20세기 초강대국 시나리오 소멸",
  },
  // ── 근현대 ──
  {
    title: "만약 소련이 먼저 달에 갔다면?",
    hook: "1969년 7월 20일. 달에 꽂힌 게 성조기가 아니라 낫과 망치였다면 냉전은 어떻게 끝났을까",
    marketingTactic: "소련 달 착륙 → 미국 우주 경쟁 패배 → 냉전 판도 역전 가능성",
  },
  {
    title: "만약 인터넷이 발명되지 않았다면?",
    hook: "1989년 팀 버너스리가 웹을 안 만들었다면? 지금 이 영상도 없었음",
    marketingTactic: "인터넷 부재 → 디지털 혁명 지연 → 오프라인 중심 경제 지속",
  },
  // ── 일본 ──
  {
    title: "만약 일본이 메이지 유신에 실패했다면?",
    hook: "1868년 사무라이 체제가 유지됐다면? 동아시아 근현대사가 완전히 달라졌을 것",
    marketingTactic: "메이지 유신 실패 → 일본 식민지화 가능성 → 조선·중국 근대사 변동",
  },
  // ── 아프리카 ──
  {
    title: "만약 아프리카 분할(베를린 회의)이 없었다면?",
    hook: "1884년 유럽 열강이 아프리카를 자로 쪼개지 않았다면 지금 아프리카 지도는?",
    marketingTactic: "유럽 미분할 → 아프리카 자생 국가 발전 → 부족 갈등 구조 자체가 다름",
  },
];

// ── pool 4: VS 쇼츠 — 과학·역사·전략 근거 기반 VS 매치업 설계 ──────────────
//
// 선정 기준:
//  1. 과학·역사·전략·생물학적 근거가 있는 비교만
//  2. 단순 "누가 이김?" 아닌 조건·변수·반전 포인트 포함
//  3. 동물·역사·군사·문명·기술 등 다양한 매치업 타입
//  4. 전 세계 다양한 지역/시대 포함
//  5. 빈 추측·밈 배틀·혐오 금지

const vsShortsCards: PromptCard[] = [
  // ── 동물 ──
  {
    title: "고릴라 vs 북극곰",
    hook: "악력 600kg 고릴라 vs 한 방에 물개 목 부러뜨리는 북극곰. 체급 차이가 2배인데 승부가 갈림",
    marketingTactic: "근력 밀도 vs 체급·지방 방어, 환경 변수가 결정적",
  },
  {
    title: "티라노사우루스 vs 아프리카 코끼리",
    hook: "6톤 코끼리가 현존 최강 육상동물인데 12톤 육식공룡을 만나면?",
    marketingTactic: "교합력 5만 N vs 돌진 충격량, 기동성·지구력 비교",
  },
  {
    title: "킹코브라 vs 코모도드래곤",
    hook: "신경독 vs 패혈 독. 먼저 물면 이기는 게 아님. '어디를' 무느냐가 핵심",
    marketingTactic: "독 메커니즘 차이 + 방어 스케일 + 선제 거리",
  },
  {
    title: "범고래 vs 백상아리",
    hook: "상어가 바다 최강인 줄 알지? 범고래는 상어 간만 골라 뜯어먹음. 실제 관측 기록 있음",
    marketingTactic: "지능·협동 사냥 vs 단독 포식, 실제 Farallon 사례",
  },
  // ── 군사·역사 ──
  {
    title: "로마 군단 vs 몽골 기병",
    hook: "중보병 최강 vs 기마궁수 최강. 평원이면 몽골, 근데 지형이 바뀌면?",
    marketingTactic: "기동력 vs 진형 방어, 보급선·지형 변수",
  },
  {
    title: "스파르타 300 vs 일본 사무라이 300",
    hook: "300명 대 300명 보병전. 방패벽 팔랑크스 vs 이도류 개인전투. 누가 무너지나?",
    marketingTactic: "집단 전술 vs 개인 무술, 장비 중량·기동성 트레이드오프",
  },
  {
    title: "중세 성채 vs 현대 특수부대 12명",
    hook: "500명 수비대의 성 vs 현대 장비를 가진 12명. 기술 격차가 몇 년이면 성벽이 의미 없어지나?",
    marketingTactic: "기술 격차·야간 장비·폭발물 vs 수적 우위·방어 지형",
  },
  // ── 문명·기술 ──
  {
    title: "청나라 시기 영국 vs 현대 중국",
    hook: "아편전쟁 때 영국이 청나라를 박살냈는데 지금 중국을 만나면?",
    marketingTactic: "산업혁명 초기 vs 핵보유 GDP 2위, 기술 세대 차이 분석",
  },
  {
    title: "나폴레옹 대육군 vs 1차 세계대전 프랑스군",
    hook: "같은 프랑스군인데 100년 차이. 기관총 하나가 기병 돌격을 어떻게 바꾸는지",
    marketingTactic: "기동전 vs 참호전, 화력 밀도·교리 진화",
  },
  {
    title: "이순신 거북선 함대 vs 넬슨 트라팔가 함대",
    hook: "거북선 13척 vs 전열함 27척. 300년 기술 격차인데 해협 지형이면 얘기가 달라짐",
    marketingTactic: "화포 사거리·장갑 vs 조류·협수로 전술",
  },
  // ── 혼합 가상 ──
  {
    title: "인간 100명 vs 침팬지 1마리",
    hook: "침팬지 한 마리 악력이 성인 남성 5배. 100명이면 이기겠지? 조건을 바꿔보면",
    marketingTactic: "집단 협동 vs 순간 폭발력, 공간 조건 변수",
  },
  {
    title: "F-22 랩터 1대 vs 2차대전 전투기 100대",
    hook: "미사일 6발 쏘면 6대 격추. 나머지 94대가 달려들면? 탄약이 핵심 변수",
    marketingTactic: "BVR 사거리·스텔스 vs 수적 포화, 연료·탄약 한계",
  },
];

// ─── 지역 다양성 유틸 ────────────────────────────────────────────────────────

/** 카드 제목/훅에서 지역을 추정 (완벽할 필요 없음 — 편향 방지가 목적) */
function detectRegion(card: PromptCard): string {
  const text = `${card.title} ${card.hook ?? ""}`.normalize("NFC");
  if (/허준|지석영|조선|백광현|한국/.test(text)) return "한국";
  if (/하나오카|오긴|스기타|메이지|일본|荻野/.test(text)) return "일본";
  if (/화타|이시진|편작|손사막|본초강목|당나라|후한|춘추|중국/.test(text)) return "중국";
  if (/수슈루타|아난디바이|조시|차라카|아유르베다|우나니|무굴|인도/.test(text)) return "인도";
  if (/이븐 시나|아비센나|알라지|알자흐라위|코르도바|중동/.test(text)) return "중동";
  if (/크리스티안 바나드|아프리카|남아공/.test(text)) return "아프리카";
  if (/카를로스 핀레이|쿠바|잉카|마테오|아르헨티나|라틴/.test(text)) return "라틴아메리카";
  if (/갈레노스|로마|피에르|제멜바이스|유럽/.test(text)) return "유럽";
  if (/뉴욕|시카고|미국|영국|런던|에든버러/.test(text)) return "서구";
  return "기타";
}

/**
 * 지역 다양성을 보장하는 카드 샘플링
 * - 4개 뽑을 때: 최소 3개 이상 서로 다른 지역
 * - 같은 지역이 2개 이상 연속되지 않게
 * - 서구권만 반복 추천하지 않게 비서구 카드 우선 섞기
 */
function pickDiverseCards(arr: PromptCard[], count: number): PromptCard[] {
  if (arr.length <= count) return [...arr].sort(() => Math.random() - 0.5);

  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  const result: PromptCard[] = [];
  const usedRegions = new Set<string>();

  // 1차: 서로 다른 지역에서 하나씩
  for (const card of shuffled) {
    if (result.length >= count) break;
    const region = detectRegion(card);
    if (!usedRegions.has(region)) {
      result.push(card);
      usedRegions.add(region);
    }
  }

  // 2차: 부족하면 나머지에서 채우기 (같은 지역 최대 2개)
  if (result.length < count) {
    const regionCount: Record<string, number> = {};
    result.forEach(c => {
      const r = detectRegion(c);
      regionCount[r] = (regionCount[r] ?? 0) + 1;
    });
    for (const card of shuffled) {
      if (result.length >= count) break;
      if (result.includes(card)) continue;
      const region = detectRegion(card);
      if ((regionCount[region] ?? 0) < 2) {
        result.push(card);
        regionCount[region] = (regionCount[region] ?? 0) + 1;
      }
    }
  }

  // 3차: 그래도 부족하면 아무거나
  if (result.length < count) {
    for (const card of shuffled) {
      if (result.length >= count) break;
      if (!result.includes(card)) result.push(card);
    }
  }

  return result.sort(() => Math.random() - 0.5);
}

function pickRandomCards(arr: PromptCard[], count: number): PromptCard[] {
  return pickDiverseCards(arr, count);
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

const cardPools: Record<string, PromptCard[]> = {
  "history-marketing": historyMarketingCards,
  "shorts-scenario":   shortsScenarioCards,
  "vs-shorts":         vsShortsCards,
};

// legacy string prompts (backwards compat)
const promptPools: Record<string, string[]> = {
  "history-marketing": historyMarketingCards.map((c) => c.title),
  "shorts-scenario":   shortsScenarioCards.map((c) => c.title),
  "vs-shorts":         vsShortsCards.map((c) => c.title),
};

export function shufflePrompts(personas: StoryAIPersona[]): StoryAIPersona[] {
  return personas.map((p) => {
    const cards = pickRandomCards(cardPools[p.id] ?? p.sampleCards, 4);
    return {
      ...p,
      sampleCards: cards,
      samplePrompts: cards.map((c) => c.title),
    };
  });
}

export const storyPersonas: StoryAIPersona[] = [
  {
    id: "history-marketing",
    name: "역사 마케팅 마스터",
    description: "실제 역사 속 병의원/의사들이 환자를 모으고 병원을 알리기 위해 사용한 마케팅/홍보/브랜딩 사례만 다루는 전문가.",
    persona:
      "나는 '역사 속 병의원 마케팅 발굴단'이야. 실제 역사 속 의사/병원이 어떤 광고·홍보·입소문·공개 시연·무료 진료·출판 전략으로 환자를 모았는지 구체적 마케팅 사례만 발굴해. 출력은 반드시 쇼츠용 내레이션 스크립트 형식 — 짧은 줄 단위, 훅으로 시작, 역사 반전 삽입, 교훈 마무리. 희곡/시나리오/대화극 형식 절대 금지. 인물명: 대사 형식 절대 금지. [장면 설명] 형식 절대 금지. 말투는 MZ세대 '~임' 체, 현대 공감 훅 → 역사 팩트 → 교훈으로 마무리. ㅋㅋ 붙이는 거 필수.",
    samplePrompts: pickRandom(promptPools["history-marketing"], 4),
    sampleCards:   pickRandomCards(historyMarketingCards, 4),
  },
  {
    id: "shorts-scenario",
    name: "만약에 역사",
    description: "실제 역사적 사실을 바탕으로, 역사의 갈림길을 상상한 흥미로운 대체역사 콘텐츠를 생성합니다.",
    persona:
      "나는 '팩트 기반 대체역사 콘텐츠 작가'야. 실제 역사적 사실을 출발점으로 삼아, '만약 그 갈림길에서 역사가 달라졌다면?' 이라는 가정을 논리적으로 전개해. 핵심은 실제 역사 배경을 짧게 짚고 → 갈림길(분기점)을 제시한 뒤 → 가능한 변화의 흐름을 흥미롭게 펼치는 것. 팩트와 상상을 구분해서 써야 해. '실제로는 ~했다. 근데 만약 ~했다면?' 구조. 단정하지 말고 가능성으로 표현해. 음모론·혐오·정치 선동 금지. 출력은 쇼츠용 짧은 줄 내레이션 형식 — 희곡/시나리오/대화극 형식 절대 금지. 인물명: 대사 형식 절대 금지. [장면 설명] 형식 절대 금지.",
    samplePrompts: pickRandom(promptPools["shorts-scenario"], 4),
    sampleCards:   pickRandomCards(shortsScenarioCards, 4),
  },
  {
    id: "vs-shorts",
    name: "VS 쇼츠 설계기",
    description: "과학·역사·전략 근거를 바탕으로 VS형 쇼츠 시퀀스를 설계합니다",
    persona: `나는 'VS 쇼츠 설계기'야. VS형 주제를 받으면 과학·역사·전략·생물학적 근거를 바탕으로 쇼츠/릴스용 시퀀스를 설계해.

핵심 원칙:
1. 근거 기반. 크기/무게/속도/내구력/무기체계/방어체계/환경/지형/기술격차/보급/훈련/전술/생물학적 한계/시대 차이를 실제 수치와 사실로 비교해.
2. 야생 추측을 팩트처럼 쓰지 마. 가정에 크게 의존하면 명시해.
3. "큰 놈이 이김"으로 단순화하지 마. 환경·지구력·기동성·협동·기술·사거리·전략·지속력이 더 중요한 경우가 많음.
4. 결과는 조건부일 수 있음. "평지면 X, 한랭지면 Y", "단판이면 X, 장기전이면 Y", "전술적으로 X, 전략적으로 Y".
5. 가짜 드라마 금지. "이것이 모든 것을 바꿨다" "아무도 예상 못했다" 같은 빈 과장 금지. 반전이 실제로 정당화될 때만.

쇼츠 구조 규칙:
- 리텐션 퍼스트. 비트 구조: 훅 → 매치업 프레임 → 핵심 변수/메커니즘 → 리빌 → 판정/조건부 판정
- 기본 길이: 8~15초, 컷 2~4개. 5컷 이상은 진짜 필요할 때만.
- 과도 분절 금지. 명사 수로 쪼개지 말고 아이디어·논점·반전이 바뀔 때만 컷을 나눠.
- 첫 컷은 매크로 클리어: 누구 vs 누구인지, 어떤 충돌인지, 왜 흥미로운지 즉시 파악 가능해야 함.

매치업 처리:
- 먼저 시나리오를 정규화. "청나라 영국 vs 현대 중국"은 모호함 → "청나라 시기의 영국? 영국 vs 청나라? 당시 영국 vs 현재 중국?" 중 콘텐츠적으로 가장 흥미롭고 논리적으로 유효한 비교로 해석.
- "누가 이김"을 유효한 경연 프레임으로 변환: 일대일? 해전? 산업전? 영토 방어? 상징적 맞대결?

출력 형식 — 반드시 아래 JSON 구조로:
{
  "topic": "",
  "matchupType": "animal|history|military|civilization|technology|mixed_hypothetical",
  "coreQuestion": "",
  "comparisonFrame": "",
  "keyVariables": [],
  "likelyVerdict": "",
  "verdictType": "clear|conditional|context-dependent",
  "shortHook": "",
  "sequencePlan": [
    {
      "sequenceId": "seq_1",
      "role": "hook|framing|mechanism|reveal|payoff",
      "summary": "",
      "durationSec": 8,
      "cuts": [
        {
          "cutId": "cut_1",
          "role": "",
          "beatType": "",
          "visualObjective": "",
          "narrationObjective": "",
          "reason": ""
        }
      ]
    }
  ]
}

톤: 날카롭고, 명확하고, 압축적이고, 신나지만 유치하지 않게. 분석적이되 학술적이지 않게. 근거가 있으면 자신감 있게, 불확실하면 솔직하게.`,
    samplePrompts: pickRandom(promptPools["vs-shorts"], 4),
    sampleCards:   pickRandomCards(vsShortsCards, 4),
  },
];
