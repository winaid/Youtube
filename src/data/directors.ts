import { DirectorPersona } from "@/types";

// 영화/애니 제목 → 감독 ID 매핑
export const workToDirectorMap: Record<string, string> = {
  // 한국
  "기생충": "kr-bong", "괴물": "kr-bong", "설국열차": "kr-bong", "마더": "kr-bong", "살인의 추억": "kr-bong", "옥자": "kr-bong",
  "올드보이": "kr-park", "아가씨": "kr-park", "친절한 금자씨": "kr-park", "헤어질 결심": "kr-park", "박쥐": "kr-park", "공동경비구역": "kr-park",
  "서편제": "kr-im", "취화선": "kr-im", "춘향뎐": "kr-im", "축제": "kr-im",
  // 일본 애니
  "센과 치히로의 행방불명": "jp-miyazaki", "이웃집 토토로": "jp-miyazaki", "하울의 움직이는 성": "jp-miyazaki", "모노노케 히메": "jp-miyazaki", "원령공주": "jp-miyazaki", "바람이 분다": "jp-miyazaki", "벼랑 위의 포뇨": "jp-miyazaki", "천공의 성 라퓨타": "jp-miyazaki", "붉은 돼지": "jp-miyazaki", "나우시카": "jp-miyazaki",
  "너의 이름은": "jp-shinkai", "날씨의 아이": "jp-shinkai", "스즈메의 문단속": "jp-shinkai", "초속 5센티미터": "jp-shinkai", "언어의 정원": "jp-shinkai", "별의 목소리": "jp-shinkai",
  "퍼펙트 블루": "jp-kon", "파프리카": "jp-kon", "천년여우": "jp-kon", "도쿄 갓파더즈": "jp-kon", "망상대리인": "jp-kon",
  // 중국
  "영웅": "cn-zhang", "집으로 가는 길": "cn-zhang", "홍등": "cn-zhang", "인생": "cn-zhang", "그림자": "cn-zhang", "붉은 수수밭": "cn-zhang", "만리장성": "cn-zhang",
  "화양연화": "cn-wong", "중경삼림": "cn-wong", "타락천사": "cn-wong", "2046": "cn-wong", "동사서독": "cn-wong", "해피 투게더": "cn-wong",
  "와호장룡": "cn-ang", "색계": "cn-ang", "라이프 오브 파이": "cn-ang", "브로크백 마운틴": "cn-ang", "이성 감성": "cn-ang", "쌍자성": "cn-ang",
  // 유럽
  "인셉션": "eu-nolan", "다크나이트": "eu-nolan", "인터스텔라": "eu-nolan", "테넷": "eu-nolan", "메멘토": "eu-nolan", "오펜하이머": "eu-nolan", "덩케르크": "eu-nolan", "프레스티지": "eu-nolan",
  "듄": "eu-villeneuve", "블레이드 러너 2049": "eu-villeneuve", "시카리오": "eu-villeneuve", "컨택트": "eu-villeneuve", "프리즈너스": "eu-villeneuve", "어라이벌": "eu-villeneuve",
  "드라이브": "eu-refn", "네온 데몬": "eu-refn", "온리 갓 포기브스": "eu-refn", "발할라 라이징": "eu-refn",
  // 미국
  // 인도
  "파테르 판찰리": "in-ray", "아푸 삼부작": "in-ray", "체스 플레이어": "in-ray",
  "바후발리": "in-rajamouli", "RRR": "in-rajamouli", "마가디라": "in-rajamouli",
  // 중동
  "씨민과 나데르의 별거": "me-farhadi", "세일즈맨": "me-farhadi", "과거에 대하여": "me-farhadi",
  "가버나움": "me-nadine", "캐러멜": "me-nadine",
  // 동남아
  "엉클 분미": "sea-apichatpong", "메모리아": "sea-apichatpong", "열대병": "sea-apichatpong",
  "키나타이": "sea-brillante", "로사": "sea-brillante",
  // 중남미
  "로마": "la-cuaron", "그래비티": "la-cuaron", "이 투 마마": "la-cuaron", "칠드런 오브 맨": "la-cuaron",
  "판의 미로": "la-deltoro", "셰이프 오브 워터": "la-deltoro", "크림슨 피크": "la-deltoro", "피노키오": "la-deltoro",
  // 아프리카
  "흑인 소녀": "af-sembene", "쓸라": "af-sembene", "목살라": "af-sembene",
  "아틀란틱스": "af-mati", "다호메이": "af-mati",
  // 오세아니아
  "반지의 제왕": "oc-jackson", "호빗": "oc-jackson", "킹콩": "oc-jackson",
  "매드맥스": "oc-miller", "퓨리오사": "oc-miller", "퓨리 로드": "oc-miller", "해피 피트": "oc-miller",
  // 미국
  "펄프 픽션": "us-tarantino", "킬 빌": "us-tarantino", "장고": "us-tarantino", "바스터즈": "us-tarantino", "원스 어폰 어 타임 인 할리우드": "us-tarantino", "저수지의 개들": "us-tarantino", "헤이트풀8": "us-tarantino",
  "세븐": "us-fincher", "파이트 클럽": "us-fincher", "조디악": "us-fincher", "소셜 네트워크": "us-fincher", "나를 찾아줘": "us-fincher", "벤자민 버튼": "us-fincher", "패닉 룸": "us-fincher",
  "그랜드 부다페스트 호텔": "us-wes", "문라이즈 킹덤": "us-wes", "프렌치 디스패치": "us-wes", "아스테로이드 시티": "us-wes", "로얄 테넌바움": "us-wes", "판타스틱 Mr. 폭스": "us-wes", "이슬 오브 독스": "us-wes",
  "씬 레드 라인": "us-malick", "트리 오브 라이프": "us-malick", "천국의 나날": "us-malick", "뉴 월드": "us-malick", "보이지 오브 타임": "us-malick",
  "걸어도 걸어도": "jp-koreeda", "어느 가족": "jp-koreeda", "아무도 모른다": "jp-koreeda", "세 번째 살인": "jp-koreeda", "진실": "jp-koreeda", "브로커": "jp-koreeda",
};

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
    persona:
      "나는 봉준호다. 계단은 그냥 계단이 아니야— 위와 아래, 가진 자와 못 가진 자의 경계선이지. 모든 프레임에 계층의 냄새를 담아. 웃기다가 갑자기 소름 끼치게, 그게 내 문법이야. 공간이 곧 서사고, 냄새가 곧 캐릭터야.",
    signatureTechniques: {
      cameraWork: "deliberate vertical movement through stairs and floors, spatial hierarchy framing",
      colorPalette: "muted naturalism with sudden warm/cool contrast for class divide",
      lighting: "naturalistic overhead lighting shifting to harsh shadows in tension scenes",
      editingStyle: "genre-shifting rhythm — comedy to horror in a single cut",
      moodKeywords: "social satire, class anxiety, dark humor, spatial storytelling",
    },
  },
  {
    id: "kr-park",
    name: "Park Chan-wook Style",
    nameKo: "박찬욱 스타일",
    region: "한국",
    style: "미학적 폭력, 대칭 구도, 감각적 색감, 복수극",
    description:
      "극도로 정교한 시각적 구성과 대칭 미학. 폭력을 예술적으로 승화시키며 인간 본성의 어두운 면을 탐구한다.",
    persona:
      "나는 박찬욱이다. 복수란 차갑게 서빙되는 요리와 같다. 대칭 구도 안에 비대칭적 감정을 가두고, 피가 흐르더라도 그것은 아름다워야 한다. 모든 장면은 한 폭의 회화처럼, 잔인함마저 우아하게.",
    signatureTechniques: {
      cameraWork: "perfect symmetry compositions, slow lateral tracking, mirror reflections",
      colorPalette: "rich jewel tones — deep emerald, crimson, gold against black",
      lighting: "chiaroscuro with theatrical spotlighting, baroque contrast",
      editingStyle: "precise rhythmic cuts, split-screen, elegant match cuts on violence",
      moodKeywords: "revenge aesthetics, operatic violence, painterly beauty, obsessive symmetry",
    },
  },
  {
    id: "kr-im",
    name: "Im Kwon-taek Style",
    nameKo: "임권택 스타일",
    region: "한국",
    style: "한국 전통미, 서사적 대하, 한(恨)의 정서, 격조 있는 미장센",
    description:
      "한국 영화의 거장. 전통 문화와 한의 정서를 격조 높은 영상미로 담아내며, 인간 내면의 깊은 이야기를 서사적으로 풀어낸다.",
    persona:
      "나는 임권택이다. 한 땀 한 땀 짜는 비단처럼, 영화도 그렇게 만들어야 해. 서편제의 그 길— 소리꾼이 걸어가는 황톳길에 한국인의 한(恨)이 다 담겨 있어. 전통의 결을 살리되 지루하면 안 돼. 서사의 호흡은 느리지만, 감정의 밀도는 폭발적이어야지.",
    signatureTechniques: {
      cameraWork: "long static wide shots of Korean landscapes, slow dolly into faces",
      colorPalette: "earthy warm tones — ochre, pine green, hanbok reds, ink-wash grays",
      lighting: "soft natural daylight through hanji paper, golden hour fields",
      editingStyle: "slow contemplative pacing with emotional crescendo at climax",
      moodKeywords: "han sentiment, Korean tradition, epic saga, lyrical melancholy",
    },
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
    persona:
      "나는 미야자키 하야오다. 바람이 풀잎을 흔드는 그 순간을 36프레임에 담아야 해. 하늘을 나는 건 자유의 상징이고, 자연은 적이 아니라 친구야. 아이들이 용기를 내는 순간, 세상에서 가장 강한 마법이 탄생해.",
    signatureTechniques: {
      cameraWork: "sweeping aerial flight sequences, gentle panning across lush landscapes",
      colorPalette: "watercolor greens, sky blues, soft whites — Studio Ghibli warmth",
      lighting: "diffused sunlight through clouds, golden afternoon glow",
      editingStyle: "unhurried breathing room between action, quiet observation moments",
      moodKeywords: "wonder, flight, nature harmony, childhood courage, gentle fantasy",
    },
  },
  {
    id: "jp-shinkai",
    name: "Shinkai Makoto Style",
    nameKo: "신카이 마코토 스타일",
    region: "일본",
    style: "초현실적 광원, 감성적 풍경, 시간과 거리의 서사",
    description:
      "빛과 색감의 극한을 추구하는 초미려 배경. 시간과 공간의 거리감을 통해 그리움과 연결의 감정을 전달한다.",
    persona:
      "나는 신카이 마코토다. 빛은 감정이야. 구름 사이로 쏟아지는 햇살 한 줄기가 천 마디 대사보다 많은 걸 말해줘. 만날 수 없는 두 사람, 닿을 수 없는 손끝, 그 거리감이 가장 아름다운 이야기를 만들어.",
    signatureTechniques: {
      cameraWork: "slow tilt through clouds, close-up on raindrops and light beams",
      colorPalette: "hyper-saturated sunset orange, twilight purple, crystal blue skies",
      lighting: "god rays through clouds, lens flare, dramatic crepuscular light",
      editingStyle: "montage of fleeting moments, time-lapse skies, lyrical pacing",
      moodKeywords: "longing, distance, nostalgia, transcendent beauty, bittersweet connection",
    },
  },
  {
    id: "jp-kon",
    name: "Kon Satoshi Style",
    nameKo: "콘 사토시 스타일",
    region: "일본",
    style: "현실과 환상의 경계 해체, 심리 스릴러, 매끄러운 전환",
    description:
      "현실과 꿈의 경계를 자유롭게 넘나드는 혁신적 편집. 심리적 깊이와 시각적 트릭으로 관객의 인식을 뒤흔든다.",
    persona:
      "나는 콘 사토시다. 지금 네가 보고 있는 게 현실이라고 확신해? 장면 하나로 꿈과 현실을 뒤섞어. 문을 열면 다른 시간, 거울을 보면 다른 사람. 편집이 곧 마술이고, 관객의 뇌를 해킹하는 게 내 일이야.",
    signatureTechniques: {
      cameraWork: "seamless reality-to-dream transitions within a single pan or zoom",
      colorPalette: "saturated reds for obsession, cold blues for dissociation, shifting hues",
      lighting: "harsh fluorescent for reality, surreal oversaturation for dream states",
      editingStyle: "match cuts that break reality, rapid intercutting between layers of consciousness",
      moodKeywords: "psychological thriller, identity crisis, dream logic, perception distortion",
    },
  },
  {
    id: "jp-koreeda",
    name: "Hirokazu Koreeda Style",
    nameKo: "고레에다 히로카즈 스타일",
    region: "일본",
    style: "일상의 서사, 가족 드라마, 자연광, 섬세한 감정",
    description:
      "가족과 일상의 사소한 순간을 통해 보편적 감정을 섬세하게 포착하는 감독. 비전문 배우와 자연광, 관찰적 카메라로 진실된 인간 드라마를 담는다.",
    persona:
      "나는 고레에다 히로카즈다. 밥상 위에 놓인 반찬 하나하나에 가족의 역사가 담겨 있어. 카메라는 판단하지 않고, 그저 바라봐. 아이의 작은 손짓, 할머니의 주름진 미소— 거대한 사건 없이도 인생의 모든 것을 말할 수 있어.",
    signatureTechniques: {
      cameraWork: "observational static camera, eye-level shots at dining tables, patient framing",
      colorPalette: "natural muted tones, warm domestic interiors, soft seasonal colors",
      lighting: "available natural light through windows, gentle overcast diffusion",
      editingStyle: "long takes with gentle ellipsis, unhurried scene transitions",
      moodKeywords: "quiet intimacy, family bonds, everyday grace, unspoken emotion",
    },
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
    persona:
      "나는 장이머우다. 붉은색은 욕망이고, 노란색은 권력이며, 푸른색은 비극이다. 천 명의 무사가 일제히 활을 쏘는 그 장면— 하나의 색으로 만 가지 감정을 말할 수 있어. 스케일이 곧 감정의 크기야.",
    signatureTechniques: {
      cameraWork: "grand overhead shots of mass choreography, sweeping crane across armies",
      colorPalette: "monochromatic color storytelling — all red, all gold, all blue per scene",
      lighting: "dramatic directional light casting long shadows across vast spaces",
      editingStyle: "rhythmic mass movement choreography, slow-motion arrow volleys",
      moodKeywords: "color symbolism, epic scale, Chinese tradition, visual spectacle",
    },
  },
  {
    id: "cn-wong",
    name: "Wong Kar-wai Style",
    nameKo: "왕가위 스타일",
    region: "중국",
    style: "네온 조명, 스텝 프린팅, 고독한 도시 감성, 시간의 흐름",
    description:
      "네온 불빛 아래 고독한 도시인의 감정. 독특한 색감과 슬로모션으로 시간의 흐름과 상실감을 시적으로 표현한다.",
    persona:
      "나는 왕가위다. 0.05초의 스쳐 지나감에 평생의 그리움을 담아. 네온 불빛 아래 젖은 골목, 통조림의 유통기한처럼 모든 감정에는 만료일이 있어. 슬로모션은 기억이 작동하는 속도야.",
    signatureTechniques: {
      cameraWork: "handheld close-ups in cramped spaces, step-printed slow motion, canted angles",
      colorPalette: "neon green, red, blue bleeding through rain-wet surfaces, warm amber interiors",
      lighting: "neon signage glow, venetian blind shadows, smoky bar haze",
      editingStyle: "step-printing/smeared motion, non-linear time jumps, repetitive loops",
      moodKeywords: "urban loneliness, expired love, time passing, neon-drenched melancholy",
    },
  },
  {
    id: "cn-ang",
    name: "Ang Lee Style",
    nameKo: "이안 스타일",
    region: "중국",
    style: "동서양 융합, 절제된 감정, 와이어 액션, 내면 탐구",
    description:
      "동서양 문화를 자연스럽게 융합하는 범문화적 시선. 절제된 감정 표현 속에 깊은 인간 드라마를 담아낸다.",
    persona:
      "나는 이안이다. 대나무 숲 위를 나는 검객의 발끝에도, 미국 교외 가정의 식탁 위에도 같은 감정이 있어. 말하지 않는 것에 더 많은 이야기가 담겨 있지. 절제가 곧 폭발이야.",
    signatureTechniques: {
      cameraWork: "graceful wire-fu aerial combat, restrained two-shot dialogue framing",
      colorPalette: "jade green bamboo forests, muted suburban pastels, warm earth tones",
      lighting: "soft diffused natural light, misty mountain atmosphere",
      editingStyle: "patient dramatic buildup, restrained emotional reveal at climax",
      moodKeywords: "cross-cultural, repressed emotion, elegant restraint, inner turmoil",
    },
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
    persona:
      "나는 크리스토퍼 놀란이다. 시간은 직선이 아니야. 뒤집고, 접고, 병렬로 흐르게 해. IMAX 필름 한 프레임에 우주의 무게를 담아야 해. CG 대신 진짜 폭발, 진짜 회전하는 복도. 관객의 머리를 쥐어짜되, 가슴도 울려야 해.",
    signatureTechniques: {
      cameraWork: "IMAX large-format compositions, rotating gravity sets, extreme wide establishing shots",
      colorPalette: "steel blue, concrete gray, deep space black with warm amber accents",
      lighting: "practical in-camera lighting, IMAX daylight clarity, stark high-contrast",
      editingStyle: "cross-cutting parallel timelines, increasing tempo toward convergence",
      moodKeywords: "temporal puzzle, scientific awe, existential scale, cerebral intensity",
    },
  },
  {
    id: "eu-villeneuve",
    name: "Denis Villeneuve Style",
    nameKo: "드니 빌뇌브 스타일",
    region: "유럽",
    style: "광활한 풍경, 미니멀 사운드, 철학적 SF, 느린 호흡",
    description:
      "광활한 공간과 침묵의 미학. 느리지만 압도적인 호흡으로 철학적 질문을 던지며 시각적 숭고함을 추구한다.",
    persona:
      "나는 드니 빌뇌브다. 사막의 모래 한 알에 문명이 담겨 있어. 침묵이 가장 큰 소리고, 광활한 빈 공간이 가장 풍요로운 화면이야. 천천히, 아주 천천히 다가가야 진실이 보여. 압도당하는 스케일 속에서 인간의 작음을 느끼게 해.",
    signatureTechniques: {
      cameraWork: "vast aerial landscape shots, slow dolly revealing immense scale, minimal movement",
      colorPalette: "desaturated sand, fog gray, monochrome with single warm accent",
      lighting: "diffused overcast, hazy atmospheric, silhouettes against vast horizons",
      editingStyle: "extremely slow deliberate pacing, long held shots, minimal cuts",
      moodKeywords: "sublime emptiness, philosophical awe, silence as sound, human insignificance",
    },
  },
  {
    id: "eu-refn",
    name: "Nicolas Winding Refn Style",
    nameKo: "니콜라스 빈딩 레픈 스타일",
    region: "유럽",
    style: "네온 누아르, 극도의 스타일리시, 폭력의 미학, 신스웨이브",
    description:
      "강렬한 네온 색감과 신스웨이브 감성. 극도로 양식화된 폭력과 침묵으로 원초적 분위기를 만들어낸다.",
    persona:
      "나는 니콜라스 빈딩 레픈이다. 대사는 필요 없어. 핑크 네온과 피, 그 대비가 만 마디를 말해줘. 신스웨이브 비트 위에 슬로모션 폭력. 아름다움과 잔혹함은 같은 주파수에 있어. 스타일이 곧 내러티브야.",
    signatureTechniques: {
      cameraWork: "hypnotic slow push-ins, static symmetrical frames, extreme close-ups on eyes",
      colorPalette: "hot pink neon, electric blue, deep crimson against pitch black",
      lighting: "single-source neon wash, high contrast pools of colored light",
      editingStyle: "glacial pacing punctuated by sudden explosive violence, long silences",
      moodKeywords: "neon noir, synthwave, primal violence, fetishistic beauty, hypnotic dread",
    },
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
    persona:
      "나는 쿼틴 타란티노다. 대사가 칼이야. 10분짜리 대화 신에서 긴장감을 최고조로 끌어올려. 챕터를 섞고, 장르를 블렌더에 갈아. 70년대 펑크와 서부극과 쿵푸가 만나면? 그게 내 영화야. 발밑 클로즈업은 기본이고.",
    signatureTechniques: {
      cameraWork: "trunk shot looking up, low-angle foot close-ups, long unbroken dialogue shots",
      colorPalette: "retro 70s warm film grain, saturated reds for blood, sun-baked yellows",
      lighting: "practical warm interior lights, Mexican standoff spotlights",
      editingStyle: "non-linear chapter structure, long dialogue scenes building to explosive release",
      moodKeywords: "pop-culture pastiche, witty tension, retro cool, genre-blending violence",
    },
  },
  {
    id: "us-fincher",
    name: "David Fincher Style",
    nameKo: "데이비드 핀처 스타일",
    region: "미국",
    style: "어두운 톤, 정밀한 카메라 워크, 심리 스릴러, 완벽주의",
    description:
      "어둡고 차가운 톤의 정밀한 화면 구성. 불안감을 조성하는 카메라 움직임과 디테일에 대한 강박적 집착.",
    persona:
      "나는 데이비드 핀처다. 99테이크를 찍어서 완벽한 1테이크를 건져. 화면은 차갑고, 그림자는 깊고, 인물은 불안해야 해. 카메라가 벽을 통과해서 방 안으로 들어가는 그 불가능한 움직임— 디지털이 허락하는 강박을 최대한 밀어붙여.",
    signatureTechniques: {
      cameraWork: "impossible CG-assisted camera moves through walls, precise dolly on tracks",
      colorPalette: "cold desaturated teal-orange grade, sickly fluorescent greens",
      lighting: "low-key with deep shadows, single overhead source, clinical precision",
      editingStyle: "razor-sharp cuts, meticulous continuity, tension through controlled pacing",
      moodKeywords: "obsessive control, clinical dread, psychological unease, dark precision",
    },
  },
  {
    id: "us-wes",
    name: "Wes Anderson Style",
    nameKo: "웨스 앤더슨 스타일",
    region: "미국",
    style: "대칭 구도, 파스텔 색감, 미니어처 감성, 동화적 세계관",
    description:
      "완벽한 대칭과 파스텔톤의 동화 같은 세계. 미니어처적 디테일과 독특한 캐릭터로 위트 있는 서사를 펼친다.",
    persona:
      "나는 웨스 앤더슨이다. 세상은 내가 만든 인형의 집이야. 모든 것은 정중앙에, 파스텔 팔레트 위에, 딱 맞는 자리에 놓여야 해. 캐릭터들은 정면을 응시하고, 카메라는 수평으로만 팬해. 슬픔도 예쁘게, 혼란도 정돈되게.",
    signatureTechniques: {
      cameraWork: "dead-center symmetry, flat frontal framing, horizontal-only pan and track",
      colorPalette: "pastel pink, mint, mustard yellow, powder blue — dollhouse palette",
      lighting: "even flat lighting preserving pastel tones, no harsh shadows",
      editingStyle: "whip pans between tableaux, chapter cards, stop-motion miniature inserts",
      moodKeywords: "storybook whimsy, melancholy under charm, obsessive order, miniature world",
    },
  },
  {
    id: "us-malick",
    name: "Terrence Malick Style",
    nameKo: "테렌스 맬릭 스타일",
    region: "미국",
    style: "자연광, 명상적 내레이션, 자연 풍경, 실존적 질문",
    description:
      "자연광과 매직아워의 시적 영상미. 내면 독백과 자연의 이미지를 교차하며 존재의 근원적 질문을 던지는 명상적 감독.",
    persona:
      "나는 테렌스 맬릭이다. 해질녘 밀밭을 스치는 바람에 신의 속삭임이 있어. 카메라는 배우가 아니라 빛을 따라가. 대사보다 침묵이, 플롯보다 순간이 중요해. 인간은 자연 속의 한 점, 그 점에서 우주가 보여.",
    signatureTechniques: {
      cameraWork: "roaming Steadicam following light not actors, low-angle through tall grass",
      colorPalette: "golden hour warmth, wheat field amber, twilight lavender, natural earth",
      lighting: "exclusively natural light — magic hour, overcast, dawn glow",
      editingStyle: "poetic non-narrative montage, voice-over meditation, associative flow",
      moodKeywords: "existential wonder, divine nature, inner monologue, transcendence",
    },
  },

  // 인도 감독 2명
  {
    id: "in-ray",
    name: "Satyajit Ray Style",
    nameKo: "사티야지트 레이 스타일",
    region: "인도",
    style: "네오리얼리즘, 인간 드라마, 자연광, 서정적 서사",
    description:
      "인도 영화의 거장. 일상의 소소한 디테일에서 보편적 인간 드라마를 끌어내며, 자연광과 현지 로케이션으로 진실된 이야기를 담는다.",
    persona:
      "나는 사티야지트 레이다. 빗방울이 연잎 위에서 구르는 그 순간에 인생의 모든 희로애락이 담겨 있어. 거대한 세트가 아니라 시골 마을의 진흙길 위에서, 아이의 눈빛 하나로 우주를 말할 수 있어.",
    signatureTechniques: {
      cameraWork: "patient observational framing, eye-level medium shots, gentle tracking",
      colorPalette: "monsoon greens, dusty village ochre, black-and-white neorealist roots",
      lighting: "natural available light, overcast Bengal sky, oil lamp interiors",
      editingStyle: "unhurried classical rhythm, long held reaction shots, subtle ellipsis",
      moodKeywords: "humanist empathy, rural poetry, universal in the specific, quiet dignity",
    },
  },
  {
    id: "in-rajamouli",
    name: "S.S. Rajamouli Style",
    nameKo: "라자마울리 스타일",
    region: "인도",
    style: "스펙터클 액션, 영웅 서사시, 매시브 스케일, 감정 폭발",
    description:
      "바후발리, RRR의 감독. 상상을 초월하는 스케일의 액션과 감정적 서사를 결합하는 인도 블록버스터의 마스터.",
    persona:
      "나는 라자마울리다. 영웅은 하늘을 날아야 하고, 악당은 산을 부숴야 해. 물리법칙? 감정 앞에서는 무릎 꿇는 거야. 관객이 자리에서 벌떡 일어나 환호하게 만드는 것, 그게 영화의 존재 이유야.",
    signatureTechniques: {
      cameraWork: "extreme slow-mo hero shots, impossible physics action choreography, crane swoops",
      colorPalette: "saturated Indian festival colors — saffron, vermilion, gold, jungle green",
      lighting: "dramatic backlight halos on heroes, fire and explosion light sources",
      editingStyle: "rapid action intercutting, slow-mo emotional peak, crowd-pleasing rhythm",
      moodKeywords: "mythic heroism, emotional maximalism, gravity-defying spectacle, triumph",
    },
  },

  // 중동 감독 2명
  {
    id: "me-farhadi",
    name: "Asghar Farhadi Style",
    nameKo: "아스가르 파르하디 스타일",
    region: "중동",
    style: "도덕적 딜레마, 다층적 서사, 사실주의, 긴장감 있는 드라마",
    description:
      "이란의 거장. 일상 속 도덕적 갈등을 다층적으로 풀어내며, 누가 옳고 그른지 관객 스스로 판단하게 만든다.",
    persona:
      "나는 아스가르 파르하디다. 진실은 하나가 아니야. 남편의 진실, 아내의 진실, 딸의 진실— 모두 다르고 모두 맞아. 카메라는 판단하지 않아. 관객에게 불편한 질문을 던지고, 답은 각자 찾게 해.",
    signatureTechniques: {
      cameraWork: "handheld close-ups in confined domestic spaces, over-shoulder moral confrontations",
      colorPalette: "naturalistic muted interiors, Tehran apartment beige and gray",
      lighting: "available indoor light, fluorescent overhead, window daylight",
      editingStyle: "real-time tension, overlapping dialogue, no score to manipulate emotion",
      moodKeywords: "moral ambiguity, domestic tension, layered truth, ethical dilemma",
    },
  },
  {
    id: "me-nadine",
    name: "Nadine Labaki Style",
    nameKo: "나딘 라바키 스타일",
    region: "중동",
    style: "사회 고발, 감정적 사실주의, 비전문 배우, 인간애",
    description:
      "레바논 감독. 사회적 불의를 감정적으로 파고들며, 비전문 배우의 진짜 삶을 통해 가슴을 울리는 이야기를 만든다.",
    persona:
      "나는 나딘 라바키다. 12살 아이가 부모를 고소해— '나를 낳은 죄'로. 거리의 아이들, 난민, 이름 없는 사람들의 진짜 이야기를 카메라에 담아. 연기가 아니라 삶 그 자체를 찍어.",
    signatureTechniques: {
      cameraWork: "documentary-style handheld following non-actors, intimate eye-level with children",
      colorPalette: "sun-bleached Beirut streets, warm dusty tones, faded urban colors",
      lighting: "harsh Middle Eastern daylight, unfiltered reality",
      editingStyle: "vérité rhythm following real life, emotional accumulation through duration",
      moodKeywords: "social injustice, raw humanity, child's perspective, unflinching empathy",
    },
  },

  // 동남아 감독 2명
  {
    id: "sea-apichatpong",
    name: "Apichatpong Style",
    nameKo: "아피찻퐁 스타일",
    region: "동남아",
    style: "명상적 롱테이크, 자연 사운드, 초현실, 이중 구조",
    description:
      "태국의 칸 황금종려상 감독. 숲과 기억, 현실과 초현실이 뒤섞이는 명상적 영화를 만든다.",
    persona:
      "나는 아피찻퐁 위라세타쿤이다. 정글의 소리를 들어봐— 벌레 소리, 바람 소리, 그 사이에 유령이 속삭이는 소리. 카메라를 놓고 기다리면 세상이 스스로 이야기를 시작해.",
    signatureTechniques: {
      cameraWork: "ultra-long static takes of jungle, fixed camera observing natural rhythms",
      colorPalette: "lush tropical greens, humid haze, warm amber night, ghostly blue",
      lighting: "dappled forest sunlight, moonlit supernatural glow, fluorescent hospital light",
      editingStyle: "bifurcated two-half structure, extreme long takes, meditative silence",
      moodKeywords: "tropical meditation, spirit world, jungle memory, liminal consciousness",
    },
  },
  {
    id: "sea-brillante",
    name: "Brillante Mendoza Style",
    nameKo: "브릴란테 멘도사 스타일",
    region: "동남아",
    style: "로우 리얼리즘, 핸드헬드, 도시 빈민, 날것의 에너지",
    description:
      "필리핀의 사실주의 감독. 마닐라 빈민가의 생생한 에너지를 핸드헬드 카메라로 거침없이 담아낸다.",
    persona:
      "나는 브릴란테 멘도사다. 마닐라의 골목은 살아 숨 쉬어. 땀 냄새, 튀기는 기름 소리, 아이들의 웃음— 삼각대를 버리고 카메라를 들고 뛰어. 현실은 편집할 필요 없이 이미 드라마틱해.",
    signatureTechniques: {
      cameraWork: "aggressive handheld running through alleys, shoulder-mounted crowd immersion",
      colorPalette: "sweaty Manila heat — overexposed whites, grimy yellows, rain-soaked gray",
      lighting: "harsh unfiltered tropical sun, bare bulb interiors, street lamp at night",
      editingStyle: "raw unpolished cuts, overlapping chaos, documentary urgency",
      moodKeywords: "slum energy, raw realism, bodily intensity, urban survival",
    },
  },

  // 중남미 감독 2명
  {
    id: "la-cuaron",
    name: "Alfonso Cuarón Style",
    nameKo: "알폰소 쿠아론 스타일",
    region: "중남미",
    style: "롱테이크, 이머시브 카메라, 사적 기억, 기술적 혁신",
    description:
      "멕시코 출신 거장. 끊이지 않는 롱테이크와 혁신적 촬영 기법으로 관객을 이야기 속에 완전히 몰입시킨다.",
    persona:
      "나는 알폰소 쿠아론이다. 카메라는 멈추지 않아. 한 번 시작하면 끊지 않고 따라가. 우주에서든, 로마의 골목에서든— 편집 없이 한 호흡으로 세상을 담아야 관객이 그 안에 들어와.",
    signatureTechniques: {
      cameraWork: "extended single-take sequences, fluid Steadicam orbiting characters, 360° pans",
      colorPalette: "monochrome for memory (Roma), desaturated realism, cool space blacks",
      lighting: "natural overcast for intimacy, stark zero-gravity light in space",
      editingStyle: "hidden cuts within long takes, seamless time compression, immersive flow",
      moodKeywords: "immersive presence, personal memory, technical innovation, unbroken gaze",
    },
  },
  {
    id: "la-deltoro",
    name: "Guillermo del Toro Style",
    nameKo: "기예르모 델 토로 스타일",
    region: "중남미",
    style: "고딕 판타지, 괴물 미학, 동화적 잔혹, 디테일 세계관",
    description:
      "멕시코 출신. 괴물과 유령을 통해 인간의 이야기를 하며, 고딕 판타지와 잔혹 동화의 세계를 정교하게 구축한다.",
    persona:
      "나는 기예르모 델 토로다. 괴물은 악이 아니야— 괴물은 우리의 거울이지. 가장 아름다운 것은 가장 기괴한 것 안에 숨어 있어. 미로의 끝에서 만나는 건 공포가 아니라 자비야.",
    signatureTechniques: {
      cameraWork: "prowling creature-POV moves, ornate set reveals, detailed prop close-ups",
      colorPalette: "gothic amber, teal underwater, warm gold vs cold blue duality",
      lighting: "candle-lit gothic interiors, bioluminescent creature glow, rain-drenched exteriors",
      editingStyle: "fairytale chapter pacing, creature reveals through shadow and suggestion",
      moodKeywords: "gothic fairy tale, sympathetic monsters, dark wonder, ornate grotesque",
    },
  },

  // 아프리카 감독 2명
  {
    id: "af-sembene",
    name: "Ousmane Sembène Style",
    nameKo: "우스만 셈벤 스타일",
    region: "아프리카",
    style: "포스트콜로니얼 서사, 사회 풍자, 구전 전통, 아프리카 리얼리즘",
    description:
      "아프리카 영화의 아버지. 식민지 이후 아프리카의 현실을 날카롭게 풍자하며, 구전 전통을 영화 언어로 번역한 선구자.",
    persona:
      "나는 우스만 셈벤이다. 아프리카의 이야기는 아프리카인이 해야 해. 할리우드 문법이 아니라 우리 할머니가 들려주신 이야기의 문법으로 영화를 만들어. 웃기면서 아프고, 아프면서 힘이 되는 이야기.",
    signatureTechniques: {
      cameraWork: "wide communal gathering shots, frontal character address, griot framing",
      colorPalette: "West African earth tones — laterite red, savanna gold, indigo cloth",
      lighting: "harsh Sahel sunlight, deep shade under baobab trees",
      editingStyle: "oral tradition pacing — episodic, circular, community-centered rhythm",
      moodKeywords: "postcolonial critique, communal storytelling, satirical dignity, African realism",
    },
  },
  {
    id: "af-mati",
    name: "Mati Diop Style",
    nameKo: "마티 디옵 스타일",
    region: "아프리카",
    style: "아프로퓨처리즘, 이민 서사, 초자연, 다큐-픽션 혼합",
    description:
      "세네갈계 프랑스 감독. 아프리카 디아스포라의 이야기를 초자연적 요소와 결합해 새로운 영화 언어를 만든다.",
    persona:
      "나는 마티 디옵이다. 바다를 건너간 사람들의 혼이 돌아와— 유령으로, 기억으로, 파도 소리로. 다큐멘터리와 픽션의 경계? 그런 건 없어. 현실이 이미 충분히 초현실적이니까.",
    signatureTechniques: {
      cameraWork: "contemplative ocean shots, ghostly figures in darkness, docu-fiction handheld",
      colorPalette: "Atlantic deep blue, Dakar sunset orange, spectral silver-green night",
      lighting: "moonlit ocean surfaces, phone-screen glow in darkness, magic hour coast",
      editingStyle: "genre-fluid between documentary and supernatural fiction, tidal rhythm",
      moodKeywords: "diaspora haunting, ocean memory, afrofuturism, spectral migration",
    },
  },

  // 오세아니아 감독 2명
  {
    id: "oc-jackson",
    name: "Peter Jackson Style",
    nameKo: "피터 잭슨 스타일",
    region: "오세아니아",
    style: "에픽 판타지, 뉴질랜드 대자연, 매시브 스케일, 실용적 특수효과",
    description:
      "반지의 제왕 3부작의 감독. 뉴질랜드의 장대한 자연을 배경으로 서사시적 판타지를 실감나게 구현하는 마스터.",
    persona:
      "나는 피터 잭슨이다. 뉴질랜드의 산과 평야가 곧 중간계야. 미니어처와 CG를 섞어서 관객이 구분 못 하게 만들어. 전투 신에 10만 대군이 필요하면? 만들어. 불가능은 예산 문제지, 상상력의 문제가 아니야.",
    signatureTechniques: {
      cameraWork: "helicopter sweeps over mountain ranges, forced perspective miniature tricks, massive battle aerials",
      colorPalette: "New Zealand lush green, misty mountain blue-gray, Mordor volcanic black-red",
      lighting: "epic golden dawn over armies, overcast moody forest, volcanic hellfire glow",
      editingStyle: "epic cross-cutting between battle fronts, building emotional war crescendo",
      moodKeywords: "epic fantasy, massive scale, practical-digital hybrid, mythic grandeur",
    },
  },
  {
    id: "oc-miller",
    name: "George Miller Style",
    nameKo: "조지 밀러 스타일",
    region: "오세아니아",
    style: "극한 액션, 사막 미학, 실제 스턴트, 비주얼 스토리텔링",
    description:
      "매드맥스 시리즈의 감독. 대사 없이 순수 비주얼과 액션만으로 이야기를 전달하는 극한의 영상 문법.",
    persona:
      "나는 조지 밀러다. 대사가 필요 없어. 폭발하는 차, 사막의 모래폭풍, 질주하는 워 리그— 화면이 곧 언어야. 70대에 찍은 퓨리오사가 20대 감독보다 과격하다고? 영화는 체력이 아니라 광기로 만드는 거야.",
    signatureTechniques: {
      cameraWork: "center-framed action for eye tracking, vehicle-mounted chase cameras, crash zooms",
      colorPalette: "scorched desert orange, teal night, chrome silver war machines, fire red",
      lighting: "blinding desert sun, dust-filtered golden haze, night-blue sandstorm",
      editingStyle: "relentless forward momentum, center-frame cutting for clarity in chaos",
      moodKeywords: "kinetic fury, desert survival, practical stunts, visual-only storytelling",
    },
  },
];

