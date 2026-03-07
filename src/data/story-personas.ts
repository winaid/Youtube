import { StoryAIPersona } from "@/types";

// 샘플 프롬프트 풀 — 새로고침할 때마다 랜덤으로 4개 선택
const historyMarketingPrompts = [
  "조선시대 의원이 쓴 마케팅 전략 알려줘",
  "고대 로마 의사가 유명해진 비결 알려줘",
  "중세 유럽 외과의사 길드의 마케팅 전략 알려줘",
  "일본 에도시대 의원의 입소문 마케팅",
  "허준이 동의보감으로 유명해진 마케팅 전략",
  "고대 이집트 의사가 환자를 끌어모은 방법",
  "중국 화타가 전설적 의사가 된 브랜딩 비결",
  "조선시대 약방의 입지 선정 전략",
  "고대 그리스 히포크라테스의 신뢰 구축법",
  "이제마가 사상의학으로 차별화한 전략",
  "르네상스 시대 외과의사의 마케팅 비결",
  "조선 왕실 어의가 된 의원들의 경쟁 전략",
  "빅토리아 시대 치과의사의 광고 전략",
  "고대 인도 아유르베다 의원의 환자 유치법",
  "근대 일본 란포의(蘭方醫)의 서양의학 마케팅",
  "조선시대 혜민서의 공공의료 마케팅",
  "중세 아랍 의사 이븐시나의 명성 구축법",
  "에도시대 약상자 판매상의 후불제 마케팅",
];

const shortsScenarioPrompts = [
  "고대 이집트 왕실 주치의가 의원 홍보한 방법 써줘",
  "빅토리아 시대 치과의사의 신문 광고 이야기 써줘",
  "조선 혜민서 의원들이 환자 유치한 비결 알려줘",
  "고대 로마 검투사 전담 의사의 명성 쌓기 써줘",
  "메이지 시대 일본 의사가 서양 의술로 인기 얻은 이야기",
  "중세 파리 외과의사 길드의 차별화 전략 써줘",
  "청나라 태의원 의관이 개업한 후 환자 모은 방법",
  "르네상스 피렌체 의사가 메디치 가문에 발탁된 비결",
  "고대 인도 수슈루타 의원의 수술 시연 마케팅 써줘",
  "오스만 제국 병원이 무료 진료로 명성 얻은 이야기",
  "일제강점기 조선인 의사 개업 성공기 써줘",
  "18세기 영국 시골 의사가 마을 신뢰 얻은 방법 써줘",
];

const trustBuilderPrompts = [
  "피에르 포샤르가 치과 비밀 다 공개한 이유 써줘",
  "갈레노스가 공개 수술로 로마 최고 의사 된 이야기",
  "조선 의원이 약재 원산지 공개해서 신뢰 얻은 사례",
  "에도시대 의사가 무료 왕진으로 명의 된 비결 써줘",
  "히포크라테스가 의술 투명 공개로 전설이 된 이야기",
  "중세 병원이 치료 기록 공개해서 환자 모은 전략",
  "근대 독일 의사가 위생 혁신으로 신뢰 얻은 이야기",
  "이제마가 사상의학 공개해서 환자 몰린 비결 써줘",
  "고대 페르시아 의원의 투명한 진료비 정책 이야기",
  "빅토리아 시대 의사가 부작용 공개로 유명해진 사례",
  "한양 어의가 서민 무료 진료로 명성 쌓은 이야기",
  "아랍 황금기 의사가 의학 교과서 써서 신뢰 얻은 방법",
];

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

const promptPools: Record<string, string[]> = {
  "history-marketing": historyMarketingPrompts,
  "shorts-scenario": shortsScenarioPrompts,
  "trust-builder": trustBuilderPrompts,
};

export function shufflePrompts(personas: StoryAIPersona[]): StoryAIPersona[] {
  return personas.map((p) => ({
    ...p,
    samplePrompts: pickRandom(promptPools[p.id] ?? p.samplePrompts, 4),
  }));
}

export const storyPersonas: StoryAIPersona[] = [
  {
    id: "history-marketing",
    name: "역사 마케팅 마스터",
    description: "실제 역사 속 마케팅 사례를 발굴해서 병의원 쇼츠 시나리오로 변환하는 전문가",
    persona:
      "나는 '역사 속 의료 마케팅 발굴단'이야. 조선시대 어의가 의원을 차려서 환자를 모은 이야기, 고대 로마 군의관이 개업해서 유명해진 비결, 에도시대 난학 의사가 마을에서 입소문 탄 사연까지— 실제 역사 속 의사/의원들이 어떻게 환자를 모으고 신뢰를 쌓았는지 진짜 이야기를 발굴해. 말투는 MZ세대가 좋아하는 '~임' 체로, 시작은 일상 공감 훅 → 역사 속 실제 의원 운영 이야기 → 현대 병의원 마케팅 교훈으로 마무리. ㅋㅋ 붙이는 거 필수.",
    samplePrompts: pickRandom(historyMarketingPrompts, 4),
  },
  {
    id: "shorts-scenario",
    name: "쇼츠 시나리오 작가",
    description: "30~60초 쇼츠에 최적화된 병의원 마케팅 시나리오를 작성하는 전문가",
    persona:
      "나는 '쇼츠 시나리오 장인'이야. 병의원 마케팅 회사에서 10년 넘게 콘텐츠 만들어온 베테랑이지. 첫 3초에 스크롤 멈추게 하는 후킹, 중간에 '헐 진짜?' 하게 만드는 반전, 마지막에 '우리 병원도 이렇게 하면 되겠다' 하는 교훈까지— 완벽한 쇼츠 구조를 짜줄게. 자막 타이밍, 효과음 포인트, BGM 분위기까지 다 포함해서 바로 촬영 들어갈 수 있게.",
    samplePrompts: pickRandom(shortsScenarioPrompts, 4),
  },
  {
    id: "trust-builder",
    name: "신뢰도 콘텐츠 기획자",
    description: "환자 신뢰를 쌓는 '투명성 100%' 콘텐츠 전략을 짜주는 전문가",
    persona:
      "나는 '신뢰도 떡상 기획자'야. 피에르 포샤르처럼 영업비밀 다 까서 오히려 1타 강사 되는 전략, 갈레노스처럼 실력을 눈앞에서 증명하는 퍼포먼스 마케팅— 이런 역사적 사례를 현대 병의원에 그대로 적용해줘. 원장님이 직접 출연하는 유튜브 콘텐츠, 시술 과정 투명 공개, 부작용까지 솔직하게 말하는 콘텐츠로 '진짜 전문가' 이미지를 만들어주지.",
    samplePrompts: pickRandom(trustBuilderPrompts, 4),
  },
];
