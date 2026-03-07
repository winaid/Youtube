import { StoryAIPersona } from "@/types";

// 샘플 프롬프트 풀 — 새로고침할 때마다 랜덤으로 4개 선택
const historyMarketingPrompts = [
  "조선시대 의원이 쓴 마케팅 전략 알려줘",
  "고대 로마 의사가 유명해진 비결 알려줘",
  "중세 유럽 약사의 브랜딩 전략 찾아줘",
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
  "치과 마케팅 쇼츠 시나리오 써줘",
  "성형외과 비포애프터 쇼츠 기획해줘",
  "한의원 후각 마케팅 쇼츠 만들어줘",
  "피부과 투명성 마케팅 시나리오 써줘",
  "안과 라식 수술 후기 쇼츠 시나리오",
  "정형외과 재활 성공기 쇼츠 써줘",
  "소아과 부모 공감 마케팅 시나리오",
  "산부인과 임산부 꿀팁 쇼츠 기획",
  "비뇨기과 남성건강 쇼츠 시나리오",
  "내과 건강검진 필요성 쇼츠 만들어줘",
  "이비인후과 코골이 치료 쇼츠 써줘",
  "통증의학과 만성통증 공감 시나리오",
];

const trustBuilderPrompts = [
  "원장님 유튜브 콘텐츠 기획해줘",
  "시술 과정 투명 공개 시나리오 만들어줘",
  "환자 후기 영상 기획 도와줘",
  "병원 브랜딩 쇼츠 시리즈 기획해줘",
  "부작용 솔직 공개로 신뢰 쌓는 시나리오",
  "원장님 일상 브이로그 쇼츠 기획",
  "의료진 소개 콘텐츠 시나리오 써줘",
  "병원 시설 투어 쇼츠 만들어줘",
  "환자 Q&A 시리즈 기획해줘",
  "수술실 비하인드 공개 시나리오",
  "의사가 직접 알려주는 건강 상식 기획",
  "병원 선택 기준 알려주는 쇼츠 시나리오",
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
      "나는 '역사 속 마케팅 발굴단'이야. 조선시대 의원부터 고대 로마 의사, 중세 유럽 약사까지— 수천 년 역사 속에서 지금 병의원 마케팅에 바로 써먹을 수 있는 천재적인 전략들을 찾아내지. 말투는 MZ세대가 좋아하는 '~임' 체로, 흥미진진하게 풀어. 시작은 항상 공감 가는 일상 경험으로 훅을 걸고, 역사 이야기로 반전을 주고, 마지막에 현대 병의원 마케팅 교훈으로 마무리해. ㅋㅋ 붙이는 거 필수.",
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
