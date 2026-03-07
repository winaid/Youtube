import { DirectorPersona } from "@/types";

export const directors: DirectorPersona[] = [
  // 한국 감독 3명
  {
    id: "kr-bong",
    name: "Bong Joon-ho Style",
    nameKo: "봉준호 스타일",
    region: "한국",
    style: "사회 풍자적 블랙코미디, 계층 대비, 상징적 공간 연출",
    description:
      "계층 갈등과 사회 풍자를 날카롭게 담아내며, 유머와 공포를 절묘하게 교차시키는 연출. 공간을 통해 서사를 전달한다.",
  },
  {
    id: "kr-park",
    name: "Park Chan-wook Style",
    nameKo: "박찬욱 스타일",
    region: "한국",
    style: "미학적 폭력, 대칭 구도, 감각적 색감, 복수극",
    description:
      "극도로 정교한 시각적 구성과 대칭 미학. 폭력을 예술적으로 승화시키며 인간 본성의 어두운 면을 탐구한다.",
  },
  {
    id: "kr-na",
    name: "Na Hong-jin Style",
    nameKo: "나홍진 스타일",
    region: "한국",
    style: "극한의 긴장감, 거친 핸드헬드, 오컬트 공포",
    description:
      "숨 막히는 서스펜스와 원초적 공포. 거친 카메라 워크로 관객을 현장에 던져 넣는 몰입형 연출.",
  },

  // 일본 감독 3명
  {
    id: "jp-miyazaki",
    name: "Miyazaki Hayao Style",
    nameKo: "미야자키 하야오 스타일",
    region: "일본",
    style: "자연 친화적 판타지, 비행 장면, 세밀한 배경, 성장 서사",
    description:
      "자연과 인간의 공존을 따뜻하게 그려내는 판타지. 바람, 구름, 물의 움직임을 섬세하게 표현하며 성장과 모험을 담는다.",
  },
  {
    id: "jp-shinkai",
    name: "Shinkai Makoto Style",
    nameKo: "신카이 마코토 스타일",
    region: "일본",
    style: "초현실적 광원, 감성적 풍경, 시간과 거리의 서사",
    description:
      "빛과 색감의 극한을 추구하는 초미려 배경. 시간과 공간의 거리감을 통해 그리움과 연결의 감정을 전달한다.",
  },
  {
    id: "jp-kon",
    name: "Kon Satoshi Style",
    nameKo: "콘 사토시 스타일",
    region: "일본",
    style: "현실과 환상의 경계 해체, 심리 스릴러, 매끄러운 전환",
    description:
      "현실과 꿈의 경계를 자유롭게 넘나드는 혁신적 편집. 심리적 깊이와 시각적 트릭으로 관객의 인식을 뒤흔든다.",
  },

  // 중국 감독 3명
  {
    id: "cn-zhang",
    name: "Zhang Yimou Style",
    nameKo: "장이머우 스타일",
    region: "중국",
    style: "색채의 마법, 대규모 군무, 서사적 스케일, 전통미",
    description:
      "강렬한 색채 대비와 대규모 군무 장면. 중국 전통 미학을 현대적으로 재해석하며 시각적 스펙터클을 창조한다.",
  },
  {
    id: "cn-wong",
    name: "Wong Kar-wai Style",
    nameKo: "왕가위 스타일",
    region: "중국",
    style: "네온 조명, 스텝 프린팅, 고독한 도시 감성, 시간의 흐름",
    description:
      "네온 불빛 아래 고독한 도시인의 감정. 독특한 색감과 슬로모션으로 시간의 흐름과 상실감을 시적으로 표현한다.",
  },
  {
    id: "cn-ang",
    name: "Ang Lee Style",
    nameKo: "이안 스타일",
    region: "중국",
    style: "동서양 융합, 절제된 감정, 와이어 액션, 내면 탐구",
    description:
      "동서양 문화를 자연스럽게 융합하는 범문화적 시선. 절제된 감정 표현 속에 깊은 인간 드라마를 담아낸다.",
  },

  // 유럽 감독 3명
  {
    id: "eu-nolan",
    name: "Christopher Nolan Style",
    nameKo: "크리스토퍼 놀란 스타일",
    region: "유럽",
    style: "비선형 서사, IMAX 스케일, 시간 조작, 실제 촬영 중시",
    description:
      "시간의 흐름을 해체하고 재구성하는 비선형 서사. 거대한 스케일의 실제 촬영과 지적 퍼즐이 결합된 몰입형 경험.",
  },
  {
    id: "eu-villeneuve",
    name: "Denis Villeneuve Style",
    nameKo: "드니 빌뇌브 스타일",
    region: "유럽",
    style: "광활한 풍경, 미니멀 사운드, 철학적 SF, 느린 호흡",
    description:
      "광활한 공간과 침묵의 미학. 느리지만 압도적인 호흡으로 철학적 질문을 던지며 시각적 숭고함을 추구한다.",
  },
  {
    id: "eu-refn",
    name: "Nicolas Winding Refn Style",
    nameKo: "니콜라스 빈딩 레픈 스타일",
    region: "유럽",
    style: "네온 누아르, 극도의 스타일리시, 폭력의 미학, 신스웨이브",
    description:
      "강렬한 네온 색감과 신스웨이브 감성. 극도로 양식화된 폭력과 침묵으로 원초적 분위기를 만들어낸다.",
  },

  // 미국 감독 3명
  {
    id: "us-tarantino",
    name: "Quentin Tarantino Style",
    nameKo: "쿼틴 타란티노 스타일",
    region: "미국",
    style: "비선형 서사, 위트 있는 대사, 레트로 감성, 과감한 폭력",
    description:
      "팝컬처 레퍼런스와 날카로운 대사의 향연. 비선형 구성과 장르 뒤섞기로 독보적인 에너지를 만들어낸다.",
  },
  {
    id: "us-fincher",
    name: "David Fincher Style",
    nameKo: "데이비드 핀처 스타일",
    region: "미국",
    style: "어두운 톤, 정밀한 카메라 워크, 심리 스릴러, 완벽주의",
    description:
      "어둡고 차가운 톤의 정밀한 화면 구성. 불안감을 조성하는 카메라 움직임과 디테일에 대한 강박적 집착.",
  },
  {
    id: "us-wes",
    name: "Wes Anderson Style",
    nameKo: "웨스 앤더슨 스타일",
    region: "미국",
    style: "대칭 구도, 파스텔 색감, 미니어처 감성, 동화적 세계관",
    description:
      "완벽한 대칭과 파스텔톤의 동화 같은 세계. 미니어처적 디테일과 독특한 캐릭터로 위트 있는 서사를 펼친다.",
  },
];

export const sampleScenarios: { label: string; text: string }[] = [
  {
    label: "도시 고양이의 모험",
    text: "서울 골목길에서 살아가는 길고양이 한 마리가 비 오는 밤, 따뜻한 빛이 새어나오는 카페를 발견한다. 유리창 너머로 바라보는 고양이와 카페 안의 외로운 바리스타. 둘의 시선이 마주치는 순간, 작은 기적이 시작된다.",
  },
  {
    label: "시간여행 라면집",
    text: "골목 끝 낡은 라면집. 주인장이 끓이는 라면을 먹으면 과거의 한 순간으로 돌아갈 수 있다. 한 청년이 돌아가신 할머니와의 마지막 식사를 위해 가게를 찾아온다. 라면이 완성되는 시간, 김이 피어오르며 과거로의 문이 열린다.",
  },
  {
    label: "우주 배달부",
    text: "2150년, 행성 간 배달 서비스를 운영하는 1인 우주 배달부. 오늘의 배달 목적지는 폐허가 된 지구. 의뢰인이 보낸 소포 안에는 100년 전 지구의 흙 한 줌과 편지 한 장이 들어있다. 지구에 도착한 배달부는 소포를 열고 편지를 읽는다.",
  },
];
