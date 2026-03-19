/**
 * golden-evaluation-set.ts — Deep Analysis / Continuity 품질 검증용 대표 입력 세트
 *
 * 목적: generate-cuts 품질을 Deep Analysis ON/OFF, Continuity ON/OFF 조합으로 비교 검증
 * 이 파일은 테스트 fixture이며, 실제 API 호출 없이 분석 로직의 입출력을 검증한다.
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface GoldenCase {
  id: string;
  title: string;
  /** 스토리 텍스트 — generate-cuts의 storyText에 전달 */
  story: string;
  /** 총 영상 길이 (초) */
  totalDurationSec: number;
  /** 컷 수 */
  cutCount: number;
  /** 애니메이션 모드 */
  animationMode: string;
  /** continuity mode 추천 여부 */
  continuityMode: boolean;
  /** 기대 프로파일 — 검증 기준 */
  expectedProfile: GoldenExpectedProfile;
}

export interface GoldenExpectedProfile {
  /** Deep Analysis가 이 케이스의 품질을 개선하는지 */
  shouldBenefitFromDeepAnalysis: boolean;
  /** Continuity가 이 케이스에 필요한지 */
  shouldBenefitFromContinuity: boolean;

  // ── Deep Analysis 기대 출력 ──
  expectedTone: string;
  expectedGenre: string;
  expectedPacing: string;

  // ── Risk hotspots ──
  /** 이 입력에서 발생하기 쉬운 리스크 */
  riskHotspots: string[];

  // ── 원하는 품질 ──
  /** 이 케이스에서 좋은 결과의 기준 */
  desiredQualities: string[];

  // ── 실패 모드 ──
  /** Deep Analysis 없이 발생하기 쉬운 문제 */
  likelyFailureModes: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Quality Check Types
// ═══════════════════════════════════════════════════════════════════

export type QualityCheckResult = "pass" | "warn" | "fail";

export interface QualityCheckItem {
  id: string;
  category: "consistency" | "risk_mitigation" | "brief_quality" | "continuity" | "prompt_control";
  label: string;
  result: QualityCheckResult;
  detail?: string;
}

export interface GoldenEvaluationResult {
  caseId: string;
  mode: "baseline" | "deep_analysis" | "continuity" | "both";
  checks: QualityCheckItem[];
  passCount: number;
  warnCount: number;
  failCount: number;
  score: number; // 0-100
}

// ═══════════════════════════════════════════════════════════════════
// Golden Cases (12개)
// ═══════════════════════════════════════════════════════════════════

export const GOLDEN_CASES: GoldenCase[] = [
  // ─── 1. 감성 로맨스 ───
  {
    id: "romance-rain",
    title: "빗속의 재회",
    story: "5년 만에 우연히 만난 두 사람. 비가 내리는 카페 앞에서 서로를 알아본다. 남자가 우산을 건네고, 여자는 망설이다 받는다. 둘은 말없이 걷기 시작한다. 과거의 기억이 스쳐지나간다. 빗물에 젖은 거리, 따뜻한 가로등 불빛 아래에서 두 사람의 손이 닿는다.",
    totalDurationSec: 60,
    cutCount: 5,
    animationMode: "live-action",
    continuityMode: true,
    expectedProfile: {
      shouldBenefitFromDeepAnalysis: true,
      shouldBenefitFromContinuity: true,
      expectedTone: "warm",
      expectedGenre: "romance",
      expectedPacing: "slow",
      riskHotspots: ["promptOverloadRisk"],
      desiredQualities: ["consistent lighting across rain scenes", "emotional progression visible", "subject continuity between cuts"],
      likelyFailureModes: ["each cut looks like different couple", "lighting jumps between warm and cold", "rain intensity inconsistent"],
    },
  },

  // ─── 2. 호러 추격 ───
  {
    id: "horror-chase",
    title: "폐병원 추격",
    story: "공포 영화 같은 밤. 어두운 폐병원 복도. 비상등만 깜빡인다. 발소리가 점점 가까워진다. 여자가 숨을 죽이며 문 뒤에 숨는다. 그림자가 지나간다. 안도의 한숨. 하지만 뒤에서 손이 어깨를 잡는다. 비명. 달리기 시작한다. 깨진 유리창으로 밖이 보인다. 출구를 향해 전력 질주한다.",
    totalDurationSec: 45,
    cutCount: 6,
    animationMode: "cinematic",
    continuityMode: true,
    expectedProfile: {
      shouldBenefitFromDeepAnalysis: true,
      shouldBenefitFromContinuity: true,
      expectedTone: "dark",
      expectedGenre: "horror",
      expectedPacing: "fast",
      riskHotspots: ["motionComplexityRisk"],
      desiredQualities: ["escalating tension", "consistent dark lighting", "chase momentum maintained"],
      likelyFailureModes: ["hospital environment changes between cuts", "lighting suddenly brightens", "character appearance shifts"],
    },
  },

  // ─── 3. 코미디 일상 ───
  {
    id: "comedy-daily",
    title: "출근길 재난",
    story: "코미디 같은 아침. 알람 안 울린 아침. 남자가 허둥지둥 일어난다. 양말 짝짝이, 넥타이 뒤집어 맨 채로 뛰어나간다. 엘리베이터 문이 코앞에서 닫힌다. 계단을 뛰어내려간다. 커피를 사려다 지갑이 없다. 결국 편의점 봉지 든 채로 회사에 도착한다. 상사가 '오늘 재택인데?'라고 웃긴다.",
    totalDurationSec: 30,
    cutCount: 4,
    animationMode: "tv-anime",
    continuityMode: false,
    expectedProfile: {
      shouldBenefitFromDeepAnalysis: true,
      shouldBenefitFromContinuity: false,
      expectedTone: "playful",
      expectedGenre: "comedy",
      expectedPacing: "fast",
      riskHotspots: ["sceneSwitchRisk", "subjectCountRisk"],
      desiredQualities: ["fast comedic pacing", "clear visual gags", "exaggerated expressions"],
      likelyFailureModes: ["scene transitions too abrupt", "character design inconsistent across locations", "comedic timing lost"],
    },
  },

  // ─── 4. SF what-if ───
  {
    id: "sf-whatif",
    title: "만약 달에 도시가 있다면",
    story: "판타지 같은 미래. 2150년, 달 표면에 건설된 돔 도시. 거대한 유리 돔 안에 고층 빌딩과 공원이 있다. 마법처럼 중력이 약해 사람들이 가볍게 뛰어다닌다. 지구가 하늘에 떠 있다. 한 소녀가 돔 밖을 바라보며 지구를 그리워한다. 우주복을 입고 밖으로 나간다. 달 표면의 거친 풍경 위로 지구가 떠오른다.",
    totalDurationSec: 60,
    cutCount: 5,
    animationMode: "disney-3d",
    continuityMode: true,
    expectedProfile: {
      shouldBenefitFromDeepAnalysis: true,
      shouldBenefitFromContinuity: true,
      expectedTone: "warm",
      expectedGenre: "fantasy",
      expectedPacing: "moderate",
      riskHotspots: ["visualAmbiguityRisk"],
      desiredQualities: ["consistent lunar environment", "low gravity physics", "earth visible in sky throughout"],
      likelyFailureModes: ["dome city looks different each cut", "gravity inconsistent", "earth position jumps around"],
    },
  },

  // ─── 5. 액션 도주 ───
  {
    id: "action-escape",
    title: "공장 탈출",
    story: "경보음이 울린다. 남자가 컨베이어 벨트 사이를 뛰어넘는다. 추격자들이 뒤따른다. 철문을 닫고 용접기로 봉쇄한다. 폭발이 일어난다. 지붕으로 올라간다. 헬리콥터가 기다리고 있다. 마지막 순간 다리가 무너진다. 로프를 잡고 매달린다. 끌어올려진다.",
    totalDurationSec: 45,
    cutCount: 6,
    animationMode: "live-action",
    continuityMode: true,
    expectedProfile: {
      shouldBenefitFromDeepAnalysis: true,
      shouldBenefitFromContinuity: true,
      expectedTone: "serious",
      expectedGenre: "action",
      expectedPacing: "fast",
      riskHotspots: ["motionComplexityRisk", "sceneSwitchRisk"],
      desiredQualities: ["continuous forward momentum", "consistent industrial environment", "escalating danger"],
      likelyFailureModes: ["factory looks different between floors", "explosion scale inconsistent", "character outfit changes"],
    },
  },

  // ─── 6. 초현실/몽환 ───
  {
    id: "surreal-dream",
    title: "꿈속의 미로",
    story: "거대한 시계가 녹아내린다. 계단이 위아래로 동시에 이어진다. 소녀가 떠다니며 문을 연다. 문 뒤에는 바다가 있다. 물고기가 하늘을 날고, 새가 물속을 헤엄친다. 모든 것이 거꾸로다. 소녀가 웃는다. 세계가 천천히 원래대로 돌아온다.",
    totalDurationSec: 45,
    cutCount: 5,
    animationMode: "surreal-composite",
    continuityMode: false,
    expectedProfile: {
      shouldBenefitFromDeepAnalysis: true,
      shouldBenefitFromContinuity: false,
      expectedTone: "playful",
      expectedGenre: "fantasy",
      expectedPacing: "moderate",
      riskHotspots: ["visualAmbiguityRisk", "motionComplexityRisk"],
      desiredQualities: ["dreamlike visual coherence", "consistent character design despite surreal environment", "clear visual logic within dream rules"],
      likelyFailureModes: ["random abstract imagery without narrative connection", "character disappears between cuts", "visual style too inconsistent"],
    },
  },

  // ─── 7. 단일 주인공 중심 ───
  {
    id: "solo-protagonist",
    title: "마라톤 러너",
    story: "진지한 드라마. 새벽 4시. 남자가 달린다. 홀로 도시의 빈 도로를 달린다. 숨이 차오른다. 지난 실패의 비극적 기억이 떠오른다. 그래도 멈추지 않는다. 해가 뜬다. 골인 지점이 보인다. 마지막 스퍼트. 결승선을 넘는다. 무릎을 꿇고 울음을 터뜨린다.",
    totalDurationSec: 60,
    cutCount: 5,
    animationMode: "live-action",
    continuityMode: true,
    expectedProfile: {
      shouldBenefitFromDeepAnalysis: true,
      shouldBenefitFromContinuity: true,
      expectedTone: "serious",
      expectedGenre: "drama",
      expectedPacing: "accelerating",
      riskHotspots: ["promptOverloadRisk"],
      desiredQualities: ["single subject locked throughout", "dawn lighting progression", "emotional arc visible in body language"],
      likelyFailureModes: ["runner appearance changes", "time of day jumps randomly", "emotion resets between cuts"],
    },
  },

  // ─── 8. 다인물 혼재 ───
  {
    id: "multi-character",
    title: "결혼식 소동",
    story: "따뜻한 결혼식. 신랑이 긴장한다. 신부가 드레스를 입는다. 하객들이 몰려온다. 어머니가 감동의 눈물을 흘린다. 아버지가 팔짱을 낀다. 사회자가 마이크를 잡는다. 꽃다발을 던진다. 친구들이 환호한다. 밴드가 연주한다. 모두가 춤을 춘다. 그리고 신랑 친구가 케이크에 머리를 박는다.",
    totalDurationSec: 45,
    cutCount: 6,
    animationMode: "tv-anime",
    continuityMode: false,
    expectedProfile: {
      shouldBenefitFromDeepAnalysis: true,
      shouldBenefitFromContinuity: false,
      expectedTone: "warm",
      expectedGenre: "drama",
      expectedPacing: "fast",
      riskHotspots: ["subjectCountRisk", "promptOverloadRisk"],
      desiredQualities: ["manageable subject count per cut", "consistent venue", "comedic climax timing"],
      likelyFailureModes: ["too many people in one frame", "venue looks different each cut", "character designs inconsistent"],
    },
  },

  // ─── 9. continuity 특히 중요 ───
  {
    id: "continuity-critical",
    title: "은행 강도의 하루",
    story: "긴장감 넘치는 범죄 극. 남자가 양복을 입고 은행에 들어간다. 창구에 앉는다. 서류를 꺼낸다. 서류 밑에 권총이 있다. 천천히 일어선다. '다 엎드려.' 경비원이 달려온다. 남자가 볼모를 잡는다. 경찰이 도착한다. 긴장 속 협상이 시작된다. 남자의 손이 떨린다. 볼모를 놓는다. 무릎을 꿇는다.",
    totalDurationSec: 90,
    cutCount: 8,
    animationMode: "cinematic",
    continuityMode: true,
    expectedProfile: {
      shouldBenefitFromDeepAnalysis: true,
      shouldBenefitFromContinuity: true,
      expectedTone: "serious",
      expectedGenre: "thriller",
      expectedPacing: "accelerating",
      riskHotspots: ["subjectCountRisk", "sceneSwitchRisk"],
      desiredQualities: ["single consistent location", "subject appearance locked", "tension escalation across 8 cuts", "no premature resolution"],
      likelyFailureModes: ["bank interior changes", "robber outfit shifts", "hostage disappears", "tension resets mid-sequence"],
    },
  },

  // ─── 10. continuity 불필요 단발형 ───
  {
    id: "standalone-idea",
    title: "오늘의 운세",
    story: "코미디 같은 하루. 아침에 운세를 본다. '오늘은 최악의 날.' 출근하면 승진 발표. 점심엔 로또 당첨. 퇴근길에 연예인을 만난다. 집에 돌아오니 서프라이즈 파티. 웃기게도 운세 앱을 삭제한다.",
    totalDurationSec: 15,
    cutCount: 4,
    animationMode: "tv-anime",
    continuityMode: false,
    expectedProfile: {
      shouldBenefitFromDeepAnalysis: true,
      shouldBenefitFromContinuity: false,
      expectedTone: "playful",
      expectedGenre: "comedy",
      expectedPacing: "fast",
      riskHotspots: ["sceneSwitchRisk"],
      desiredQualities: ["quick scene transitions work as comedy device", "clear visual punchlines", "ironic contrast with fortune"],
      likelyFailureModes: ["scenes feel disconnected rather than comedically contrasted", "too many locations crammed in"],
    },
  },

  // ─── 11. 장면 전환 과도 ───
  {
    id: "excessive-transitions",
    title: "세계 일주 24시간",
    story: "다큐멘터리 같은 세계 일주. 도쿄의 네온. 파리의 에펠탑. 뉴욕 타임스퀘어. 두바이 사막. 아이슬란드 오로라. 아프리카 사바나. 시드니 오페라하우스. 리우 해변. 이집트 피라미드. 런던 빅벤. 마지막으로 서울 남산타워에서 일출을 본다.",
    totalDurationSec: 60,
    cutCount: 6,
    animationMode: "live-action",
    continuityMode: false,
    expectedProfile: {
      shouldBenefitFromDeepAnalysis: true,
      shouldBenefitFromContinuity: false,
      expectedTone: "warm",
      expectedGenre: "documentary",
      expectedPacing: "fast",
      riskHotspots: ["sceneSwitchRisk", "promptOverloadRisk", "visualAmbiguityRisk"],
      desiredQualities: ["each location visually distinct but tonally unified", "consistent color grading across locations", "traveler subject consistent"],
      likelyFailureModes: ["jarring style jumps between countries", "each cut feels like different video", "no visual throughline"],
    },
  },

  // ─── 12. subject overload ───
  {
    id: "subject-overload",
    title: "전장의 아침",
    story: "액션 전투. 장군이 명령한다. 기병대가 돌격한다. 보병이 방패를 든다. 궁수가 화살을 쏜다. 공성탑이 다가온다. 성벽 위 병사들이 돌을 던진다. 성문이 부서진다. 기사들이 돌진한다. 왕이 검을 뽑는다. 양측 군대가 충돌한다. 깃발이 쓰러진다.",
    totalDurationSec: 60,
    cutCount: 6,
    animationMode: "cinematic",
    continuityMode: true,
    expectedProfile: {
      shouldBenefitFromDeepAnalysis: true,
      shouldBenefitFromContinuity: true,
      expectedTone: "serious",
      expectedGenre: "action",
      expectedPacing: "fast",
      riskHotspots: ["subjectCountRisk", "motionComplexityRisk", "promptOverloadRisk"],
      desiredQualities: ["focused subject per cut despite battle scale", "consistent medieval aesthetic", "escalating battle intensity"],
      likelyFailureModes: ["too many subjects per frame", "army appearance inconsistent", "battle scale impossible to render", "generic battle imagery"],
    },
  },
];
