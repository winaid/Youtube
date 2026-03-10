import { StoryAIPersona, PromptCard } from "@/types";

// ─── 카드형 프롬프트 풀 ───────────────────────────────────────────────────────
//
// 선정 기준:
//  1. 실존 인물 또는 실존 의료기관만 (지어낸 사례 금지)
//  2. 의사/의원/의료인만
//  3. "어떻게 자신을 알리고 환자를 모았는가"가 핵심
//  4. 전 세계 다양한 지역/문화권의 사례 포함 (지역 편중 금지)
//  5. 구체적 홍보 수단이 있는 사례만

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
    title: "아난디바이 조시가 미국 의대 입학 전 편지 한 통으로 미국 후원자를 모은 방법",
    hook: "인도 여성이 미국에 오기도 전에 신문에 실려서 팬이 생긴 이야기 (1880년대)",
    marketingTactic: "편지→미국 신문 게재→대중 후원자 모집",
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
    title: "제임스 매큔 스미스가 뉴욕 약국을 흑인 커뮤니티 허브로 만든 전략",
    hook: "흑인이라 백인 전용 병원에 못 가는 환자들 유일한 선택지가 된 방법 (1837년)",
    marketingTactic: "약국을 사회 허브화 + 폐지론자 네트워크 통한 환자 유입",
  },
  {
    title: "메리 퍼트넘 자코비가 논문 한 편으로 성차별 의학계를 뚫은 방법",
    hook: "여성은 생리 중 공부 못 한다는 편견을 데이터로 때려 부수고 의학계 상 받은 이야기 (1876년)",
    marketingTactic: "학술 논문 출판으로 의학계 내 신뢰 및 전문성 입지 구축",
  },
  {
    title: "샌프란시스코 차이나타운 한약사들이 동향 결사체 네트워크로 환자를 모은 방법",
    hook: "영어도 안 통하고 면허도 없는데 골드러시 시절 캘리포니아에서 수천 명 환자 모은 전략 (1850s)",
    marketingTactic: "동향 결사체(Six Companies) + 한자 간판으로 민족 커뮤니티 공략",
  },
  {
    title: "다니엘 헤일 윌리엄스가 '모든 인종 환자 환영'을 차별화 메시지로 쓴 병원 브랜딩",
    hook: "1891년 시카고에서 흑인 의사가 '인종 무관'을 대놓고 병원 광고로 내건 이야기",
    marketingTactic: "인종 통합 정책을 차별화 메시지로 활용한 Provident Hospital 브랜딩",
  },
  {
    title: "소피아 젝스-블레이크가 언론의 탄압 보도를 홍보로 역이용한 전략",
    hook: "에든버러 의대가 여학생 쫓아냈더니 신문이 난리나서 오히려 더 유명해진 사건 (1870년대)",
    marketingTactic: "부당 차별 언론 노출 → 대중 공감 획득 → 지지 네트워크 형성",
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
  {
    title: "알라지가 임상 관찰 기록으로 천연두와 홍역을 최초 구분한 방법",
    hook: "천연두랑 홍역이 다른 병인 걸 세계 최초로 증명한 의사가 중동에 있었음 (9세기)",
    marketingTactic: "임상 기록 출판 → 진단 정확도로 환자 신뢰 획득",
  },
  // ── 동남아 ──
  {
    title: "호세 리잘이 안과 의사이자 독립운동가로 필리핀 전체 영웅이 된 방법",
    hook: "안과 의사가 소설 한 편 써서 필리핀 독립운동 영웅이 됨. 의사 마케팅의 극단적 사례 (1890s)",
    marketingTactic: "의사 전문성 + 문학/정치 활동 → 국민적 신뢰 브랜드 구축",
  },
  // ── 아프리카 ──
  {
    title: "크리스티안 바나드가 세계 최초 심장 이식 수술로 남아공을 의학 강국으로 만든 방법",
    hook: "세계 최초 심장 이식 수술이 미국도 유럽도 아닌 남아공에서 나옴. 그리고 의사가 스타가 됨 (1967년)",
    marketingTactic: "세계 최초 수술 성공 → 즉시 글로벌 언론 노출 → 의료 관광 유발",
  },
  {
    title: "임호텝이 건축가이자 의사로 이집트에서 신으로 추앙받은 방법",
    hook: "피라미드 설계한 사람이 의사이기도 했고, 죽은 후에 의학의 신이 됨. 4600년 전 이야기 (고대 이집트)",
    marketingTactic: "건축+의학 크로스오버 전문성 → 사후 신격화 수준의 브랜딩",
  },
  // ── 라틴아메리카 ──
  {
    title: "카를로스 핀레이가 황열병 모기 매개 이론을 20년 주장해서 결국 맞은 이야기",
    hook: "모기가 황열병 옮긴다고 20년 동안 혼자 주장한 쿠바 의사. 다 무시했는데 결국 맞음 (1881년)",
    marketingTactic: "끈질긴 학술 발표 → 사후 재평가로 쿠바 국가 영웅 등극",
  },
];

// ── pool 2: 쇼츠 시나리오 — 장면이 살아나는 역사 마케팅 사례 ─────────────────

const shortsScenarioCards: PromptCard[] = [
  {
    title: "'페인리스 파커'가 거리에 치과 의자 놓고 브라스 밴드 틀어 환자 모은 장면",
    hook: "치과 공포증 있는 사람들 앞에서 길거리 퍼포먼스로 발치 시연한 미국 치과 의사 (1890s)",
    marketingTactic: "거리 시연 + 브라스 밴드 공연 + 측면 광고 배너",
  },
  {
    title: "엘리자베스 블랙웰이 최초 여성 의사로서 여성 자선가 네트워크를 돈줄로 만든 방법",
    hook: "병원 열고 싶은데 아무도 투자 안 해줌. 그래서 돈 있는 여성들을 '공동 창업자'로 만든 전략",
    marketingTactic: "여성 자선가 네트워크를 기부자·환자·홍보대사로 동시 활용",
  },
  {
    title: "아난디바이 조시가 미국 도착 전에 이미 신문 스타가 된 과정",
    hook: "인도에서 보낸 편지 한 통이 미국 신문에 실려서 도착 전에 팬레터가 쌓인 이야기 (1886년)",
    marketingTactic: "사전 편지 캠페인 → 미국 언론 보도 → 입국 전 유명인 효과",
  },
  {
    title: "갈레노스가 원숭이 해부 공개 시연으로 로마 최고 의사 자리를 꿰찬 방법",
    hook: "요즘 의사들 유튜브에 수술 영상 올리는 거랑 똑같은 짓을 2000년 전에 콜로세움 옆에서 한 사람",
    marketingTactic: "공개 해부 시연으로 경쟁 의사들 앞에서 실력 증명",
  },
  {
    title: "수전 라 플레시 피코트가 교회 네트워크로 오마하족 보건 교육을 퍼뜨린 방법",
    hook: "원주민 마을 의사가 된 방법: 진료실 대신 교회에서 건강 강연부터 시작했음",
    marketingTactic: "교회·부족 회의 강연으로 신뢰 구축 → 진료 유입",
  },
  {
    title: "피에르 포샤르가 치과 비밀 전부 책으로 공개해서 역으로 전설이 된 이야기",
    hook: "노하우 다 공개하면 손해 아닌가? 근데 이 사람은 그래서 '치과의 아버지'가 됨 (1728년)",
    marketingTactic: "전문 지식 완전 공개 출판 → 독점 권위자 포지셔닝",
  },
  {
    title: "레베카 리 크럼플러이 '흑인 여성을 위한 의학 교과서' 출판으로 환자를 모은 전략",
    hook: "교과서 쓴 여자 의사한테 진료 받고 싶다는 환자들이 몰려든 이야기 (1883년)",
    marketingTactic: "의학 교과서 출판으로 권위 구축 + 커뮤니티 신뢰 확보",
  },
  {
    title: "엘리자베스 개럿 앤더슨의 St Mary's 진료소가 '런던 최초 여성 전용'으로 입소문 탄 방법",
    hook: "여성 환자가 여성 의사한테만 간다는 소문이 퍼지면서 대기 리스트가 생긴 이야기 (1866년)",
    marketingTactic: "입소문 + 여성 단체 지지 선언으로 '안전한 병원' 이미지 형성",
  },
  {
    title: "메이지 시대 일본 최초 여의사 오긴 荻野吟子가 개업 허가 받기까지 싸운 10년",
    hook: "의사 시험 합격했는데 여자라고 면허 안 줌. 그래서 10년을 법 바꿔서 결국 합격한 이야기 (1885년)",
    marketingTactic: "법 개정 투쟁 자체가 언론 화제 → 개업 후 즉시 대기 환자 발생",
  },
  {
    title: "다니엘 헤일 윌리엄스의 Provident Hospital이 '흑인 의사 인턴십'으로 차별화한 이야기",
    hook: "흑인 의사 훈련 불가능한 시대에 병원 차려서 흑인 의료진 배출하는 걸 홍보로 만든 전략",
    marketingTactic: "의료 교육 기회 제공 = 커뮤니티 신뢰 기반 브랜딩 (1891년)",
  },
  {
    title: "소피아 젝스-블레이크가 에든버러 '스코틀랜드 7인 사건'을 전국 뉴스로 만든 방법",
    hook: "의대생들이 여학생 입장 막으려고 양 떼를 강의실에 몰아넣은 사건이 영국 전체 신문에 실린 이야기",
    marketingTactic: "Surgeon's Hall 폭동 언론 보도 → 여성 의학 운동 전국 확산 (1870년)",
  },
  {
    title: "제임스 매큔 스미스가 신문 칼럼으로 '흑인도 지적이다'를 증명한 마케팅",
    hook: "의사이면서 폐지론 신문에 칼럼 써서 흑인 지식인으로 유명해지자 환자가 몰린 방법 (1840s)",
    marketingTactic: "신문 기고 + 공개 강연으로 지적 권위 구축 → 의료 신뢰로 전환",
  },
  // ── 한국 ──
  {
    title: "지석영이 조선에 종두법을 보급하며 전국 신뢰를 얻은 장면",
    hook: "천연두로 죽어가는 조선에서 일본 가서 백신 기술 배워와서 직접 접종 시작한 의사 (1879년)",
    marketingTactic: "해외 기술 도입 + 직접 시연 접종 → 전국 신뢰 구축",
  },
  // ── 일본 ──
  {
    title: "스기타 겐파쿠가 『해체신서』 번역으로 일본 서양의학의 문을 연 방법",
    hook: "네덜란드어 의학서를 일본어로 번역했더니 일본 의학이 완전히 바뀐 이야기 (1774년)",
    marketingTactic: "서양 의학서 최초 번역 출판 → 일본 의학 개혁자 포지셔닝",
  },
  // ── 중국 ──
  {
    title: "편작이 왕을 진맥 한 번에 병명 알아맞혀서 전국 명의가 된 방법",
    hook: "진맥 기술이 너무 신기해서 소문만으로 전국에서 환자가 몰려온 중국 전설적 의사 (춘추전국시대)",
    marketingTactic: "놀라운 진단 정확도의 입소문 → 왕실 환자 유치 → 전국 명성",
  },
  // ── 인도 ──
  {
    title: "차라카가 임상 관찰 중심 의학을 체계화해서 아유르베다의 아버지가 된 방법",
    hook: "2000년 전 인도에서 이미 환자 문진·관찰·처방 체계를 만든 의사가 있었음",
    marketingTactic: "의학 체계 문서화(차라카 삼히타) → 수천 년 권위 구축",
  },
  // ── 중동 ──
  {
    title: "이븐 알나피스가 혈액 순환 원리를 유럽보다 300년 앞서 발견한 방법",
    hook: "혈액이 심장→폐→심장으로 도는 걸 발견한 건 하비가 아니라 13세기 시리아 의사임",
    marketingTactic: "갈레노스 정설에 반박하는 독자 이론 출판 → 학문적 차별화",
  },
  // ── 아프리카 ──
  {
    title: "팀북투 의학 문서가 사하라 이남 아프리카에도 체계적 의학이 있었음을 증명한 이야기",
    hook: "아프리카에 의학이 없었다고? 팀북투에서 발견된 14세기 의학 문서가 그 편견을 깸",
    marketingTactic: "문서 기록 체계화 → 학문 도시 브랜딩으로 의료인 유입",
  },
  // ── 라틴아메리카 ──
  {
    title: "마테오 부에노가 아르헨티나에서 무료 천연두 접종으로 국민 의사가 된 방법",
    hook: "18세기 아르헨티나에서 천연두 백신을 무료로 놓아주며 '국민 의사'로 불린 이야기",
    marketingTactic: "무료 접종 캠페인 → 대중 영웅 이미지 구축",
  },
];

// ── pool 3: 신뢰 구축 — 투명성·공개·강연으로 환자를 모은 의사들 ──────────────

const trustBuilderCards: PromptCard[] = [
  {
    title: "피에르 포샤르가 치과 비밀 전부 공개한 이유",
    hook: "노하우 다 공개하면 손해 아닌가? 근데 이 사람은 그래서 전설이 됨 (1728년)",
    marketingTactic: "전문 지식 완전 공개 출판 → 독점 권위자 포지셔닝",
  },
  {
    title: "메리 퍼트넘 자코비가 익명 논문으로 성차별 편견을 데이터로 뒤집은 전략",
    hook: "여성이라 논문 심사도 불리하니까 이름 숨기고 냈더니 1등 한 이야기 (하버드 Boylston Prize 1876년)",
    marketingTactic: "익명 출판으로 성별 편견 제거 + 수상 후 신원 공개로 최대 효과",
  },
  {
    title: "갈레노스가 공개 수술로 로마 최고 의사 된 이야기",
    hook: "라이브로 시술하는 의사 봤지? 2000년 전에도 했음. 그것도 황제 앞에서",
    marketingTactic: "공개 해부·수술 시연으로 경쟁 의사 대비 실력 입증",
  },
  {
    title: "엘리자베스 블랙웰이 무료 여성 건강 강연으로 환자층을 만든 방법",
    hook: "병원 개업 전에 무료 강연부터 열어서 '이 의사 믿을 수 있다'는 소문을 먼저 퍼뜨린 전략",
    marketingTactic: "무료 공개 강연으로 신뢰 구축 후 병원 개원 (New York 1850s)",
  },
  {
    title: "수전 라 플레시 피코트가 무료 왕진으로 오마하족 신뢰를 얻은 방법",
    hook: "돈 없어도 찾아가서 봐주는 의사가 결국 마을 전체를 얻은 이야기",
    marketingTactic: "무료 왕진 + 부족 회의 참여로 커뮤니티 내 절대적 신뢰 구축",
  },
  {
    title: "다니엘 헤일 윌리엄스가 심장 수술 성공을 신문에 공개해 병원 신뢰를 올린 방법",
    hook: "1893년 세계 최초 성공적 심장 수술 후 그걸 바로 언론에 공개한 의사의 PR 전략",
    marketingTactic: "의료 혁신 성과를 즉시 언론 공개 → Provident Hospital 공신력 상승",
  },
  {
    title: "이그나즈 제멜바이스가 손 씻기 데이터로 산부인과 사망률을 줄인 방법",
    hook: "손 씻는 거 하나로 의료계를 뒤집었는데 당시에는 무시당하고 정신병원에서 죽은 의사 이야기 (1840s)",
    marketingTactic: "통계 데이터 공개 → 제도 변화 시도 (당시 마케팅 실패, 사후 재평가)",
  },
  {
    title: "아난디바이 조시가 미국 의대 졸업 연설에서 '인도 여성 의학' 선언으로 국제 화제가 된 방법",
    hook: "졸업식 연설 한 번으로 인도·미국 양쪽 신문 1면에 오른 의사 이야기 (1886년)",
    marketingTactic: "졸업 연설 + 국제 언론 보도로 귀국 전 명성 선확보",
  },
  {
    title: "레베카 리 크럼플러의 의학 교과서가 흑인 여성 환자에게 미친 신뢰 효과",
    hook: "책 쓴 의사라는 사실 하나로 당시 흑인 커뮤니티에서 '믿을 수 있는 의사' 1순위가 된 방법",
    marketingTactic: "『A Book of Medical Discourses』 출판으로 권위 구축 (1883년)",
  },
  {
    title: "메이지 시대 오긴 荻野吟子이 법정 투쟁을 공개해서 환자 지지를 얻은 방법",
    hook: "의사 면허 소송을 비밀로 안 하고 언론에 다 공개했더니 오히려 응원 환자가 몰린 이야기",
    marketingTactic: "법정 투쟁 공개 + 언론 지지 → 개업 전 대기 환자 확보 (1885년)",
  },
  {
    title: "소피아 젝스-블레이크가 에든버러 거부 이후 직접 의대를 세운 전략",
    hook: "기존 의대가 안 받아주면 내가 만들면 됨 — 런던여성의대 설립으로 역전한 이야기 (1874년)",
    marketingTactic: "제도 우회 + 독립 의대 설립으로 신뢰 기반 커뮤니티 형성",
  },
  {
    title: "엘리자베스 개럿 앤더슨의 약사 자격증 우회 전략으로 의료 시장에 진입한 방법",
    hook: "의사 면허가 막히자 약사 자격증으로 먼저 시장에 들어간 다음 의사가 된 이야기 (1865년)",
    marketingTactic: "규제 우회 진입 후 자격 취득으로 정식 전환 — 기존 환자층 유지",
  },
  // ── 한국 ──
  {
    title: "허준이 궁중에서 쫓겨난 뒤 유배지에서 동의보감을 완성한 역전 드라마",
    hook: "왕이 죽자 책임 뒤집어쓰고 유배 감. 근데 유배지에서 역대급 의학서를 완성함 (1610년)",
    marketingTactic: "역경 속 대작 완성 → 복권 + 국가 공인 의학 권위",
  },
  // ── 일본 ──
  {
    title: "하나오카 세이슈가 20년 연구 끝에 아내와 어머니를 실험 대상으로 마취약을 완성한 이야기",
    hook: "전신마취약 만들겠다고 아내가 실험 자원. 부작용으로 실명함. 근데 성공해서 전설이 됨 (1804년)",
    marketingTactic: "가족의 희생 스토리 + 수술 성공 → 전국 제자 유입",
  },
  // ── 중국 ──
  {
    title: "손사막이 약왕으로 불리며 무료 진료로 당나라 최고 의사가 된 방법",
    hook: "황제가 불러도 안 가고 산에서 가난한 사람 무료로 치료한 의사. 결과? '약왕' 칭호 (당나라)",
    marketingTactic: "무료 진료 + 권력 거부 → 민간 신뢰 극대화",
  },
  // ── 인도 ──
  {
    title: "이드리스가 우나니 의학으로 무굴 제국 황실 의사가 된 전략",
    hook: "그리스-아랍-인도 의학을 융합한 우나니 의학이 무굴 황실의 공식 의료가 된 방법",
    marketingTactic: "다문화 의학 융합 → 황실 공인 의료 시스템 포지셔닝",
  },
  // ── 중동 ──
  {
    title: "알자흐라위가 200개 수술 도구를 발명하고 교과서에 그림까지 그려 넣은 방법",
    hook: "수술 도구 200개를 직접 발명하고 일러스트까지 그려서 교과서 만든 의사. 10세기 코르도바에서 (스페인)",
    marketingTactic: "수술 도구 발명 + 일러스트 교과서 출판 → '외과의 아버지' 브랜딩",
  },
  // ── 아프리카 ──
  {
    title: "우간다 부뇨로 왕국의 전통 외과의가 19세기에 이미 제왕절개를 성공한 이야기",
    hook: "유럽 의사가 와서 보고 깜짝 놀람. 아프리카 전통 외과의가 바나나 술로 마취하고 제왕절개 성공 (1879년)",
    marketingTactic: "현지 기술력 시연 → 서양 의사의 기록으로 국제 검증",
  },
  // ── 라틴아메리카 ──
  {
    title: "잉카 제국의 두개골 천공술이 고대 세계 최고 생존율을 기록한 방법",
    hook: "잉카 의사들의 두개골 수술 생존율이 80% 넘었음. 같은 시대 유럽은 40%도 안 됨",
    marketingTactic: "압도적 기술력 + 전통 지식 체계 → 제국 공인 의료 권위",
  },
];

// ─── 지역 다양성 유틸 ────────────────────────────────────────────────────────

/** 카드 제목/훅에서 지역을 추정 (완벽할 필요 없음 — 편향 방지가 목적) */
function detectRegion(card: PromptCard): string {
  const text = `${card.title} ${card.hook ?? ""}`;
  if (/허준|지석영|조선|백광현|한국/.test(text)) return "한국";
  if (/하나오카|오긴|스기타|메이지|일본|荻野/.test(text)) return "일본";
  if (/화타|이시진|편작|손사막|본초강목|당나라|후한|춘추|중국/.test(text)) return "중국";
  if (/수슈루타|아난디바이|조시|차라카|아유르베다|우나니|무굴|인도/.test(text)) return "인도";
  if (/이븐 시나|아비센나|알라지|알자흐라위|코르도바|중동/.test(text)) return "중동";
  if (/호세 리잘|필리핀|동남아/.test(text)) return "동남아";
  if (/크리스티안 바나드|임호텝|팀북투|우간다|부뇨로|이집트|아프리카/.test(text)) return "아프리카";
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
  "trust-builder":     trustBuilderCards,
};

// legacy string prompts (backwards compat)
const promptPools: Record<string, string[]> = {
  "history-marketing": historyMarketingCards.map((c) => c.title),
  "shorts-scenario":   shortsScenarioCards.map((c) => c.title),
  "trust-builder":     trustBuilderCards.map((c) => c.title),
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
    description: "실제 역사 속 의사/의원들의 마케팅/홍보/브랜딩 사례를 짧은 쇼츠 내레이션 스크립트로 만드는 전문가. 여성·이민자·소수자 의사 사례 우선.",
    persona:
      "나는 '역사 속 의료 마케팅 발굴단'이야. 실제 역사 속 의사들이 어떻게 환자를 모으고, 편견을 뚫고, 신뢰를 쌓았는지 진짜 이야기를 발굴해. 출력은 반드시 쇼츠용 내레이션 스크립트 형식 — 짧은 줄 단위, 훅으로 시작, 역사 반전 삽입, 교훈 마무리. 희곡/시나리오/대화극 형식 절대 금지. 인물명: 대사 형식 절대 금지. [장면 설명] 형식 절대 금지. 말투는 MZ세대 '~임' 체, 현대 공감 훅 → 역사 팩트 → 교훈으로 마무리. ㅋㅋ 붙이는 거 필수.",
    samplePrompts: pickRandom(promptPools["history-marketing"], 4),
    sampleCards:   pickRandomCards(historyMarketingCards, 4),
  },
  {
    id: "shorts-scenario",
    name: "쇼츠 내레이션 작가",
    description: "역사 속 의사/의원의 마케팅 사례를 30~60초 쇼츠 내레이션 스크립트로 최적화하는 전문가. 리듬감 있는 짧은 줄 중심.",
    persona:
      "나는 '쇼츠 내레이션 장인'이야. 역사 속 결정적 순간을 짧고 리듬감 있는 내레이션 대본으로 만드는 게 내 특기야. 첫 3줄에 스크롤 멈추게 하는 훅, 중간에 '헐 진짜?' 하게 만드는 역사 반전, 마지막에 '우리 병원도 이렇게 하면 되겠다' 하는 교훈까지. 출력 형식은 반드시 짧은 줄바꿈 내레이션 — 희곡/시나리오/대화극 형식 절대 금지. 인물명: 대사 형식 절대 금지. [장면 설명] 형식 절대 금지. 각 줄이 영상 컷 하나에 대응하는 구조.",
    samplePrompts: pickRandom(promptPools["shorts-scenario"], 4),
    sampleCards:   pickRandomCards(shortsScenarioCards, 4),
  },
  {
    id: "trust-builder",
    name: "신뢰도 콘텐츠 기획자",
    description: "투명성·공개·강연·출판·데이터로 환자 신뢰를 쌓은 역사 사례를 쇼츠 내레이션 스크립트로 변환하는 전문가.",
    persona:
      "나는 '신뢰도 떡상 기획자'야. 역사적 투명성 전략을 현대 병의원에 적용하는 내레이션 스크립트를 써. 출력은 반드시 쇼츠용 짧은 줄 내레이션 형식 — 희곡/시나리오/대화극 형식 절대 금지. 인물명: 대사 형식 절대 금지. [장면 설명] 형식 절대 금지. 공감 훅으로 시작, 역사 팩트로 신뢰 구축, 현대 적용 교훈으로 마무리.",
    samplePrompts: pickRandom(promptPools["trust-builder"], 4),
    sampleCards:   pickRandomCards(trustBuilderCards, 4),
  },
];
