/**
 * recommend-director-golden.ts — 감독 추천 품질 검증용 대표 입력 세트
 *
 * 목적: recommend-director 파이프라인의 추천 품질을 반복 가능하게 평가
 * - 12개 대표 케이스로 장르/무드/영상 성격을 고르게 커버
 * - 각 케이스에 expectedProfile로 기대 동작을 명시
 * - 실제 API 호출 없이도 파이프라인 구조를 검증 가능
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface RecommendGoldenCase {
  /** 고유 식별자 */
  id: string;
  /** 케이스 제목 */
  title: string;
  /** 시나리오 텍스트 — API의 storyText에 전달 */
  story: string;
  /** 콘텐츠 모드 (e.g. "cinematic", "tv-anime") */
  contentMode: string;
  /** 콘텐츠 유형 (e.g. "short-film", "music-video") */
  contentType: string;
  /** 기대 프로파일 — 추천 품질 평가 기준 */
  expectedProfile: RecommendExpectedProfile;
}

export interface RecommendExpectedProfile {
  /** 로컬 감독 풀에서 후보가 나와야 하는가 */
  shouldFindLocalCandidates: boolean;
  /** 웹 검색 fallback이 트리거되어야 하는가 */
  shouldTriggerWebSearch: boolean;
  /** 최종적으로 1명 이상 결과가 나와야 하는가 */
  shouldLikelyReturnResults: boolean;
  /** 기대되는 장르 키워드 */
  expectedGenres: string[];
  /** 기대되는 무드 키워드 */
  expectedMoods: string[];
  /** 예상되는 실패 위험 */
  expectedFailureRisks: string[];
  /** 보충 메모 */
  notes: string;
}

// ═══════════════════════════════════════════════════════════════════
// Golden Cases (12개)
// ═══════════════════════════════════════════════════════════════════

export const RECOMMEND_GOLDEN_CASES: RecommendGoldenCase[] = [
  // ─── 1. 감성 로맨스 ───
  {
    id: "rec-romance",
    title: "빗속에서 다시 만난 두 사람",
    story: "5년 전 헤어진 연인이 비 오는 서울 골목에서 우연히 마주친다. 남자가 우산을 건네고, 여자는 망설이다 받는다. 둘은 말없이 나란히 걷기 시작한다. 카페 유리창에 비친 두 사람의 얼굴, 떨어지는 빗방울, 따뜻한 가로등 불빛. 과거 추억이 교차하며 손끝이 스친다. 아무 말 없이 서로를 안는다.",
    contentMode: "cinematic",
    contentType: "short-film",
    expectedProfile: {
      shouldFindLocalCandidates: true,
      shouldTriggerWebSearch: false,
      shouldLikelyReturnResults: true,
      expectedGenres: ["로맨스", "드라마"],
      expectedMoods: ["따뜻한", "서정적", "감성"],
      expectedFailureRisks: [],
      notes: "한국 감성 로맨스. 로컬 풀에 한국/일본 감독이 있으면 높은 매칭률 기대.",
    },
  },

  // ─── 2. 호러 추격 ───
  {
    id: "rec-horror-chase",
    title: "폐공장의 마지막 야근",
    story: "자정, 폐쇄 예정인 공장에서 마지막 야근을 하던 경비원. 3층에서 발소리가 들린다. CCTV에는 아무것도 안 잡힌다. 손전등 하나 들고 올라간다. 복도 끝에서 그림자가 움직인다. 쫓기 시작한다. 비상구는 잠겨 있다. 뒤에서 숨소리가 느껴진다. 기계 돌아가는 소리 사이로 비명이 울린다.",
    contentMode: "cinematic",
    contentType: "short-film",
    expectedProfile: {
      shouldFindLocalCandidates: true,
      shouldTriggerWebSearch: false,
      shouldLikelyReturnResults: true,
      expectedGenres: ["호러", "스릴러"],
      expectedMoods: ["공포", "긴장", "어두운"],
      expectedFailureRisks: [],
      notes: "전형적 호러 추격. 어두운 조명 + 긴장감 키워드가 풍부해서 장르 추출 실패 확률 낮음.",
    },
  },

  // ─── 3. 코미디 일상 ───
  {
    id: "rec-comedy-daily",
    title: "고양이와 재택근무",
    story: "재택근무 첫날. 화상회의 시작하는데 고양이가 키보드 위에 드러눕는다. 발표 자료 위로 걸어다니며 화면을 가린다. 급히 치우려다 커피를 쏟는다. 부장님이 '뒤에 뭐야?' 고양이가 카메라를 응시한다. 회의가 고양이 자랑 대회로 변한다. 결국 아무 일도 안 했는데 팀 분위기는 좋아졌다.",
    contentMode: "tv-anime",
    contentType: "sns-clip",
    expectedProfile: {
      shouldFindLocalCandidates: true,
      shouldTriggerWebSearch: false,
      shouldLikelyReturnResults: true,
      expectedGenres: ["코미디", "일상"],
      expectedMoods: ["유머", "가벼운", "귀여운"],
      expectedFailureRisks: [],
      notes: "코미디 일상물. 일본 감독 매칭 유리. 장르 키워드가 명확.",
    },
  },

  // ─── 4. SF what-if ───
  {
    id: "rec-sf-whatif",
    title: "시간이 거꾸로 흐르는 도시",
    story: "어느 날 도시의 시간이 역행하기 시작한다. 떨어진 커피잔이 공중에서 멈추고 테이블로 돌아간다. 사람들은 뒤로 걷는다. 한 과학자만 정상 시간에 살고 있다. 거꾸로 가는 세계 속에서 원인을 찾아야 한다. 모든 단서가 역순으로 나타난다. 결국 원인은 자신이 만든 실험이었다는 걸 깨닫는다.",
    contentMode: "cinematic",
    contentType: "short-film",
    expectedProfile: {
      shouldFindLocalCandidates: true,
      shouldTriggerWebSearch: false,
      shouldLikelyReturnResults: true,
      expectedGenres: ["SF", "미스터리"],
      expectedMoods: ["몰입", "긴장", "지적"],
      expectedFailureRisks: [],
      notes: "크리스토퍼 놀란 스타일 SF. 로컬에 놀란급 감독 있으면 높은 fitScore 기대.",
    },
  },

  // ─── 5. 액션 도주 ───
  {
    id: "rec-action-escape",
    title: "항구의 추격전",
    story: "컨테이너 야적장. 남자가 전력으로 달린다. 뒤에서 차량 두 대가 쫓아온다. 컨테이너 사이로 빠진다. 크레인 위로 올라간다. 밧줄 하나를 잡고 다른 컨테이너로 날아간다. 폭발이 일어난다. 바다로 뛰어든다. 수면 아래로 잠수한다. 반대편 부두에서 올라온다. 숨을 몰아쉬며 뒤를 본다.",
    contentMode: "live-action",
    contentType: "short-film",
    expectedProfile: {
      shouldFindLocalCandidates: true,
      shouldTriggerWebSearch: false,
      shouldLikelyReturnResults: true,
      expectedGenres: ["액션"],
      expectedMoods: ["역동적", "긴장"],
      expectedFailureRisks: [],
      notes: "표준 액션 추격. 동작 키워드 풍부. 매칭 실패 가능성 낮음.",
    },
  },

  // ─── 6. 초현실/몽환 ───
  {
    id: "rec-surreal-dream",
    title: "물속의 도서관",
    story: "소녀가 눈을 뜨면 물속이다. 하지만 숨을 쉴 수 있다. 거대한 도서관이 바닥에 있다. 책장에서 책을 꺼내면 그림이 살아 움직인다. 물고기가 페이지 사이를 헤엄친다. 천장에는 달이 비친다. 한 권의 책을 열자 세계가 뒤집히고 소녀는 하늘에서 떨어진다. 바닥에 닿는 순간 현실로 돌아온다.",
    contentMode: "surreal-composite",
    contentType: "art-film",
    expectedProfile: {
      shouldFindLocalCandidates: false,
      shouldTriggerWebSearch: true,
      shouldLikelyReturnResults: true,
      expectedGenres: ["판타지", "초현실"],
      expectedMoods: ["몽환적", "신비", "아름다운"],
      expectedFailureRisks: ["genre_mood_not_detected"],
      notes: "초현실 아트필름. 로컬 풀에 이런 스타일 감독이 없을 가능성 높아 웹 검색 fallback 기대.",
    },
  },

  // ─── 7. 다큐/현실감 중심 ───
  {
    id: "rec-docu-reality",
    title: "시장 골목의 하루",
    story: "새벽 4시, 수산시장 경매가 시작된다. 상인들의 목소리가 울려퍼진다. 트럭에서 생선 상자가 내려온다. 할머니가 좌판을 펼친다. 손님과 값을 흥정한다. 점심 무렵 한산해진다. 상인들끼리 국밥을 나눠 먹는다. 해질 녘 시장 문을 닫으며 하루가 마무리된다. 그 일상이 30년째 반복된다.",
    contentMode: "live-action",
    contentType: "documentary",
    expectedProfile: {
      shouldFindLocalCandidates: true,
      shouldTriggerWebSearch: false,
      shouldLikelyReturnResults: true,
      expectedGenres: ["다큐멘터리"],
      expectedMoods: ["사실적", "따뜻한", "소박한"],
      expectedFailureRisks: [],
      notes: "한국 다큐 스타일. 잔잔하지만 장르 키워드는 명확. 로컬 매칭 기대.",
    },
  },

  // ─── 8. 강한 비주얼 스타일 중심 ───
  {
    id: "rec-visual-style",
    title: "네온과 연기 속의 독백",
    story: "핑크빛 네온이 젖은 아스팔트에 반사된다. 연기가 프레임 절반을 가린다. 남자가 홀로 서 있다. 카메라가 천천히 회전한다. 배경의 한자 간판이 번진다. 모든 것이 슬로모션이다. 남자가 입을 연다. 말소리는 들리지 않는다. 대신 신스웨이브 음악이 깔린다. 다시 어둠 속으로 걸어 들어간다.",
    contentMode: "cinematic",
    contentType: "music-video",
    expectedProfile: {
      shouldFindLocalCandidates: false,
      shouldTriggerWebSearch: true,
      shouldLikelyReturnResults: true,
      expectedGenres: ["느와르", "네오느와르"],
      expectedMoods: ["스타일리시", "퇴폐적", "몽환적"],
      expectedFailureRisks: [],
      notes: "왕가위/니콜라스 윈딩 레픈 스타일. 로컬에 없을 가능성 높아 웹 검색 기대.",
    },
  },

  // ─── 9. 단일 주인공 중심 ───
  {
    id: "rec-solo-protagonist",
    title: "해녀의 마지막 물질",
    story: "제주 바다. 70대 해녀가 잠수복을 입는다. 오늘이 마지막 물질이다. 숨을 깊이 들이쉬고 바다에 뛰어든다. 수면 아래로 내려간다. 해초 사이를 헤집는다. 전복 하나를 딴다. 수면 위로 올라와 숨비소리를 낸다. 해안에 앉아 바다를 바라본다. 한평생을 함께한 바다에 작별 인사를 한다.",
    contentMode: "live-action",
    contentType: "documentary",
    expectedProfile: {
      shouldFindLocalCandidates: true,
      shouldTriggerWebSearch: false,
      shouldLikelyReturnResults: true,
      expectedGenres: ["드라마", "다큐멘터리"],
      expectedMoods: ["잔잔한", "감동적", "서정적"],
      expectedFailureRisks: [],
      notes: "단일 주인공 서사. 한국적 소재. 로컬 감독 매칭 적합.",
    },
  },

  // ─── 10. 다인물/군상극 ───
  {
    id: "rec-ensemble",
    title: "졸업 전날 밤 옥상",
    story: "고3 마지막 날, 다섯 친구가 학교 옥상에 모인다. 한 명은 유학 간다. 한 명은 군대 간다. 한 명은 취업한다. 한 명은 아직 모른다. 한 명은 말하지 않는다. 치킨을 시켜먹고, 맥주를 나눠 마시고, 서로 놀리고, 갑자기 울고, 다시 웃는다. 새벽이 밝아온다. 아무도 먼저 일어나지 않는다.",
    contentMode: "cinematic",
    contentType: "short-film",
    expectedProfile: {
      shouldFindLocalCandidates: true,
      shouldTriggerWebSearch: false,
      shouldLikelyReturnResults: true,
      expectedGenres: ["드라마", "청춘"],
      expectedMoods: ["쓸쓸한", "따뜻한", "노스탤지어"],
      expectedFailureRisks: [],
      notes: "한국 청춘 군상극. 봉준호/이창동 스타일. 로컬 매칭 유리.",
    },
  },

  // ─── 11. 장르/무드 신호가 약한 애매한 입력 ───
  {
    id: "rec-ambiguous",
    title: "그냥 하루",
    story: "아침에 일어난다. 밥을 먹는다. 밖에 나간다. 걷는다. 뭔가를 본다. 돌아온다. 저녁을 먹는다. 잔다. 특별한 일은 없다. 그게 전부다.",
    contentMode: "live-action",
    contentType: "short-film",
    expectedProfile: {
      shouldFindLocalCandidates: false,
      shouldTriggerWebSearch: true,
      shouldLikelyReturnResults: false,
      expectedGenres: [],
      expectedMoods: [],
      expectedFailureRisks: ["genre_mood_not_detected", "no_candidates_found"],
      notes: "의도적으로 장르/무드 신호가 거의 없는 입력. 빈 결과 + 설명 가능한 emptyReason이 나와야 함.",
    },
  },

  // ─── 12. 웹 검색 fallback이 유리한 niche 입력 ───
  {
    id: "rec-niche-wuxia",
    title: "검과 먹구름",
    story: "중원의 산악 지대. 검객이 절벽 끝에 서 있다. 먹구름이 몰려온다. 바람에 도포가 펄럭인다. 상대 검객이 아래에서 올라온다. 두 사람이 마주 선다. 검이 부딪힌다. 내공에 의한 기파가 주변 바위를 갈라뜨린다. 빗속에서 검무가 이어진다. 마지막 일합에 한 사람이 쓰러진다. 승자는 검을 거두고 떠난다.",
    contentMode: "cinematic",
    contentType: "short-film",
    expectedProfile: {
      shouldFindLocalCandidates: false,
      shouldTriggerWebSearch: true,
      shouldLikelyReturnResults: true,
      expectedGenres: ["무협", "액션"],
      expectedMoods: ["비장한", "장엄한"],
      expectedFailureRisks: ["gemini_returned_empty"],
      notes: "무협 장르는 로컬 풀에 전문 감독이 없을 가능성 높음. 장예모/쉬커 등 웹 검색으로 찾아야 유리.",
    },
  },
];
