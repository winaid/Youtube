import { StoryAIPersona, PromptCard } from "@/types";

// 카드형 프롬프트 풀 — 제목 + 일상 공감 훅
const historyMarketingCards: PromptCard[] = [
  { title: "조선시대 어의가 개인 의원 차려서 환자 모은 비결", hook: "동네 병원 가면 항상 사람 없는 곳 있잖아... 조선시대에도 똑같았음" },
  { title: "고대 로마 군의관이 개업해서 유명해진 방법", hook: "군대 의무실에서 짬 찬 의사가 전역 후 대박 친 이야기" },
  { title: "중세 유럽 외과의사 길드의 차별화 전략", hook: "요즘 성형외과들 왜 다 강남에 몰려있는지 중세부터 이유가 있었음" },
  { title: "일본 에도시대 의원의 입소문 마케팅", hook: "성형외과나 피부과 갈 때 다들 후기부터 찾아봄 비포 애프터" },
  { title: "허준이 동의보감으로 유명해진 브랜딩 전략", hook: "책 한 권 쓴 의사가 400년 넘게 유명한 이유" },
  { title: "고대 이집트 왕실 주치의가 환자 끌어모은 방법", hook: "피라미드 시대에도 '이 의사 좋다' 입소문이 있었음" },
  { title: "중국 화타가 전설적 의사가 된 브랜딩 비결", hook: "병원 가면 1분 첫 진료에 약만 덜렁 받고 나올 때 많음" },
  { title: "조선시대 약방의 입지 선정과 상권 분석", hook: "지금 약국이 병원 옆에 있는 이유가 조선시대부터 시작됨" },
  { title: "고대 그리스 히포크라테스의 환자 신뢰 구축법", hook: "진료 전에 '부작용 있을 수 있습니다' 말하는 의사가 더 믿음 가는 이유" },
  { title: "이제마가 사상의학으로 차별화에 성공한 전략", hook: "체질별 맞춤 진료가 요즘 유행인데 이미 200년 전에 있었음" },
  { title: "르네상스 시대 외과의사의 입소문 마케팅", hook: "메디치 가문 전담 의사가 되면 인생 역전인 시대" },
  { title: "빅토리아 시대 치과의사의 신문 광고 전략", hook: "네이버 플레이스 리뷰 대신 신문에 광고 넣던 시절" },
  { title: "에도시대 약상자 판매상의 후불제 마케팅", hook: "먹은 만큼만 나중에 계산 — 300년 전 구독 모델의 원조" },
  { title: "고대 인도 아유르베다 의원의 환자 유치법", hook: "요가 필라테스 유행하는 이유가 여기서부터 시작됨" },
  { title: "조선 왕실 어의들의 생존 경쟁 전략", hook: "왕 치료 실패하면 목 날아가는 직업에서 살아남은 방법" },
  { title: "중세 아랍 병원이 무료 진료로 명성 얻은 이야기", hook: "무료 진료 이벤트 하는 병원 봤지? 1000년 전에도 똑같았음" },
];

const shortsScenarioCards: PromptCard[] = [
  { title: "고대 이집트 왕실 주치의의 홍보 전략", hook: "파라오한테 선택받은 의사가 하는 짓이 요즘 인플루언서랑 똑같음" },
  { title: "빅토리아 시대 치과의사의 공포 마케팅", hook: "충치 방치하면 이렇게 됩니다 — 150년 전에도 쓰던 수법" },
  { title: "조선 혜민서 의원들의 환자 유치 비결", hook: "조선시대 무료 병원이 있었는데 거기서도 마케팅을 했음" },
  { title: "고대 로마 검투사 전담 의사의 명성 쌓기", hook: "UFC 의사 같은 포지션이 로마시대에도 있었고 그게 엄청 유명했음" },
  { title: "메이지 시대 일본 의사의 서양 의술 마케팅", hook: "새로운 시술 도입했을 때 환자한테 어떻게 설명해야 하는지" },
  { title: "중세 파리 외과의사 길드의 영역 다툼", hook: "피부과 성형외과 경계 싸움이 중세부터 있었던 이야기" },
  { title: "청나라 태의원 의관의 개업 성공기", hook: "대학병원 교수 나와서 개원하는 거 300년 전 버전" },
  { title: "르네상스 피렌체 의사가 메디치 가문에 발탁된 비결", hook: "VIP 환자 한 명이 인생을 바꾼 실화" },
  { title: "고대 인도 수슈루타의 수술 시연 마케팅", hook: "요즘 의사들 유튜브에 시술 영상 올리는 거랑 똑같은 짓" },
  { title: "오스만 제국 병원의 무료 진료 브랜딩", hook: "무료 상담 이벤트로 대박 친 병원의 원조가 600년 전에 있었음" },
  { title: "일제강점기 조선인 의사 개업 성공 스토리", hook: "경쟁자는 일본인 의사뿐인 상황에서 환자 모은 방법" },
  { title: "18세기 영국 시골 의사가 마을 신뢰 얻은 방법", hook: "왕진 가방 하나로 동네 전체를 장악한 의사 이야기" },
];

const trustBuilderCards: PromptCard[] = [
  { title: "피에르 포샤르가 치과 비밀 전부 공개한 이유", hook: "노하우 다 공개하면 손해 아닌가? 근데 이 사람은 그래서 전설이 됨" },
  { title: "갈레노스가 공개 수술로 로마 최고 의사 된 이야기", hook: "라이브 방송으로 시술하는 의사 봤지? 2000년 전에도 했음" },
  { title: "조선 의원이 약재 원산지 공개해서 신뢰 얻은 사례", hook: "이 약 어디서 온 건지 알려주는 의사가 왜 더 잘됐을까" },
  { title: "에도시대 의사가 무료 왕진으로 명의 된 비결", hook: "첫 진료 무료 — 300년 전 일본 의사가 쓴 미끼 전략" },
  { title: "히포크라테스가 의술 투명 공개로 전설이 된 이야기", hook: "부작용까지 솔직하게 말하는 의사가 오히려 환자 더 모음" },
  { title: "중세 병원이 치료 기록 공개해서 환자 모은 전략", hook: "수술 성공률 공개하는 병원이 왜 더 잘되는지 역사가 증명함" },
  { title: "근대 독일 의사의 위생 혁신 신뢰 구축법", hook: "손 씻는 거 하나로 의료계를 뒤집은 사람 이야기" },
  { title: "이제마가 사상의학 공개해서 환자 몰린 비결", hook: "맞춤 치료 컨셉을 200년 전에 만든 천재의 마케팅" },
  { title: "고대 페르시아 의원의 투명한 진료비 정책", hook: "진료비 미리 알려주는 병원이 왜 리뷰가 좋은지의 원조" },
  { title: "빅토리아 시대 의사가 부작용 공개로 유명해진 사례", hook: "약 부작용 솔직하게 말했더니 환자가 오히려 더 온 실화" },
  { title: "한양 어의가 서민 무료 진료로 명성 쌓은 이야기", hook: "VIP 전담 의사가 서민 진료 시작하자 입소문 터진 사연" },
  { title: "아랍 황금기 의사가 의학 교과서로 신뢰 얻은 방법", hook: "블로그 글 하나로 전문가 이미지 만드는 거의 원조 버전" },
];

function pickRandomCards(arr: PromptCard[], count: number): PromptCard[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

const cardPools: Record<string, PromptCard[]> = {
  "history-marketing": historyMarketingCards,
  "shorts-scenario": shortsScenarioCards,
  "trust-builder": trustBuilderCards,
};

// legacy string prompts (derived from cards for backwards compat)
const promptPools: Record<string, string[]> = {
  "history-marketing": historyMarketingCards.map((c) => c.title),
  "shorts-scenario": shortsScenarioCards.map((c) => c.title),
  "trust-builder": trustBuilderCards.map((c) => c.title),
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
    description: "실제 역사 속 마케팅 사례를 발굴해서 병의원 쇼츠 시나리오로 변환하는 전문가",
    persona:
      "나는 '역사 속 의료 마케팅 발굴단'이야. 조선시대 어의가 의원을 차려서 환자를 모은 이야기, 고대 로마 군의관이 개업해서 유명해진 비결, 에도시대 난학 의사가 마을에서 입소문 탄 사연까지— 실제 역사 속 의사/의원들이 어떻게 환자를 모으고 신뢰를 쌓았는지 진짜 이야기를 발굴해. 말투는 MZ세대가 좋아하는 '~임' 체로, 시작은 일상 공감 훅 → 역사 속 실제 의원 운영 이야기 → 현대 병의원 마케팅 교훈으로 마무리. ㅋㅋ 붙이는 거 필수.",
    samplePrompts: pickRandom(promptPools["history-marketing"], 4),
    sampleCards: pickRandomCards(historyMarketingCards, 4),
  },
  {
    id: "shorts-scenario",
    name: "쇼츠 시나리오 작가",
    description: "30~60초 쇼츠에 최적화된 병의원 마케팅 시나리오를 작성하는 전문가",
    persona:
      "나는 '쇼츠 시나리오 장인'이야. 병의원 마케팅 회사에서 10년 넘게 콘텐츠 만들어온 베테랑이지. 첫 3초에 스크롤 멈추게 하는 후킹, 중간에 '헐 진짜?' 하게 만드는 반전, 마지막에 '우리 병원도 이렇게 하면 되겠다' 하는 교훈까지— 완벽한 쇼츠 구조를 짜줄게. 자막 타이밍, 효과음 포인트, BGM 분위기까지 다 포함해서 바로 촬영 들어갈 수 있게.",
    samplePrompts: pickRandom(promptPools["shorts-scenario"], 4),
    sampleCards: pickRandomCards(shortsScenarioCards, 4),
  },
  {
    id: "trust-builder",
    name: "신뢰도 콘텐츠 기획자",
    description: "환자 신뢰를 쌓는 '투명성 100%' 콘텐츠 전략을 짜주는 전문가",
    persona:
      "나는 '신뢰도 떡상 기획자'야. 피에르 포샤르처럼 영업비밀 다 까서 오히려 1타 강사 되는 전략, 갈레노스처럼 실력을 눈앞에서 증명하는 퍼포먼스 마케팅— 이런 역사적 사례를 현대 병의원에 그대로 적용해줘. 원장님이 직접 출연하는 유튜브 콘텐츠, 시술 과정 투명 공개, 부작용까지 솔직하게 말하는 콘텐츠로 '진짜 전문가' 이미지를 만들어주지.",
    samplePrompts: pickRandom(promptPools["trust-builder"], 4),
    sampleCards: pickRandomCards(trustBuilderCards, 4),
  },
];
