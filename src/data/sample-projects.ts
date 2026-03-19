/**
 * sample-projects.ts — 내부 검증용 샘플 프로젝트
 *
 * Owner-Only V0.9: 다양한 시나리오를 빠르게 로드하여
 * 핵심 엔진 품질을 반복 검증할 수 있는 프리셋.
 *
 * 목표: "이 제품이 잘 나오네"가 아니라
 * "이 샘플로 어떤 문제가 드러나는지 빨리 점검할 수 있다"
 */

import type { PromptInput } from "@/types";

export interface SampleProject {
  id: string;
  title: string;
  description: string;
  /** 검증 목적 태그 */
  tags: string[];
  input: PromptInput;
  /** 권장 duration (입력값과 다를 수 있음 — 검증 의도 설명용) */
  recommendedDuration?: number;
  /** 권장 감독 */
  recommendedDirector?: string;
  /** 이 샘플로 확인할 핵심 포인트 */
  verifyPoint: string;
  /** 실패 시 의심할 문제 */
  suspectOnFail: string;
}

export const SAMPLE_PROJECTS: SampleProject[] = [
  // ─── 1. 10초 숏폼 ───
  {
    id: "sample-shortform-10s",
    title: "10초 숏폼 — 커피 한 잔",
    description: "10-15s shortform-critical 밴드 검증: min 4컷 정책. 극단적으로 짧은 콘텐츠에서 리듬이 살아있는지.",
    tags: ["shortform", "rhythm", "10s", "minimal"],
    input: {
      storyText:
        "에스프레소 머신에서 커피가 내려진다. 갈색 크레마가 천천히 퍼진다. " +
        "손이 잔을 들어올린다. 입술이 닿는 순간, 눈을 감는다.",
      directorPersona: "wong-kar-wai",
      region: "한국",
      animationMode: "live-action-cinematic",
      duration: 60,
      aspectRatio: "9:16",
    },
    recommendedDuration: 10,
    recommendedDirector: "wong-kar-wai",
    verifyPoint: "10-15s shortform-critical 밴드에서 min 4컷 보장, 각 컷이 2-3초로 리듬감 유지",
    suspectOnFail: "recommendMinimumCutCount 10-15s 분기 또는 densifyCuts 2s 하한",
  },

  // ─── 2. 12초 숏폼 ───
  {
    id: "sample-shortform-12s",
    title: "12초 숏폼 — 빗방울 포착",
    description: "10-15s shortform-critical 밴드. 12s도 10-15s 통합 밴드로 min 4컷 정책.",
    tags: ["shortform", "rhythm", "12s", "boundary"],
    input: {
      storyText:
        "유리창에 빗방울이 맺힌다. 빗방울이 흘러내리며 바깥 풍경이 일렁인다. " +
        "창 너머 신호등이 빨간불에서 초록불로 바뀐다. 빗속에서 우산 없이 걷는 사람의 뒷모습.",
      directorPersona: "wong-kar-wai",
      region: "한국",
      animationMode: "live-action-cinematic",
      duration: 60,
      aspectRatio: "9:16",
    },
    recommendedDuration: 12,
    recommendedDirector: "wong-kar-wai",
    verifyPoint: "12s도 10-15s shortform-critical 밴드 — min 4컷",
    suspectOnFail: "recommendMinimumCutCount 10-15s 통합 분기",
  },

  // ─── 3. 13초 숏폼 ───
  {
    id: "sample-shortform-13s",
    title: "13초 숏폼 — 지하철 순간",
    description: "13-15s special handling 진입점. 정확히 4컷 최소 보장 검증.",
    tags: ["shortform", "rhythm", "13s", "boundary", "special"],
    input: {
      storyText:
        "지하철 문이 닫힌다. 안에서 여자가 밖을 바라본다. " +
        "플랫폼에 남자가 서 있다. 열차가 출발하며 남자의 얼굴이 흐려진다. " +
        "여자가 고개를 숙인다. 이어폰에서 음악이 흘러나온다.",
      directorPersona: "wong-kar-wai",
      region: "한국",
      animationMode: "live-action-cinematic",
      duration: 60,
      aspectRatio: "9:16",
    },
    recommendedDuration: 13,
    recommendedDirector: "wong-kar-wai",
    verifyPoint: "13s부터 is13to15Special=true, min 4컷 강제. 12s와 명확히 다른 결과",
    suspectOnFail: "13-15s 밴드 경계값 (>= 13 조건), RANGE_PRESETS maxSec:15 설정",
  },

  // ─── 4. 15초 숏폼 (기존 강화) ───
  {
    id: "sample-shortform-15s",
    title: "15초 숏폼 — 골목길 고양이",
    description: "숏폼 리듬 정책(13-15초 = min 4컷) 검증. 빠른 비트와 감정 전환.",
    tags: ["shortform", "rhythm", "15s", "animal", "core"],
    input: {
      storyText:
        "비 오는 밤, 서울 종로 골목. 젖은 검은 고양이가 처마 밑에서 웅크리고 있다. " +
        "빗방울이 고양이 앞 웅덩이에 떨어진다. 고양이가 고개를 들어 하늘을 본다. " +
        "멀리서 가게 불빛이 비친다. 고양이가 천천히 불빛을 향해 걸어간다.",
      directorPersona: "wong-kar-wai",
      region: "한국",
      animationMode: "live-action-cinematic",
      duration: 60,
      aspectRatio: "9:16",
    },
    recommendedDuration: 15,
    recommendedDirector: "wong-kar-wai",
    verifyPoint: "15s 상한에서 4컷 이상, 각 컷 3-4초, shot progression이 살아있는지",
    suspectOnFail: "densifyCuts 분할 정책, secPerCut reconciliation",
  },

  // ─── 5. 감정형 독백 ───
  {
    id: "sample-emotional-monologue",
    title: "감정형 독백 — 편지를 읽는 여자",
    description: "내면 독백 + 감정 중심. character-driven 장면에서 shot 다양성 검증.",
    tags: ["emotion", "monologue", "character-driven", "slow"],
    input: {
      storyText:
        "빈 방. 여자가 오래된 편지를 펼친다. " +
        "편지의 글씨가 흐릿해져 있다. 손끝이 글자를 따라간다. " +
        "여자의 눈에 눈물이 고인다. 편지를 가슴에 안는다. " +
        "창밖으로 저녁놀이 방 안을 물들인다.",
      directorPersona: "hirokazu-koreeda",
      region: "한국",
      animationMode: "live-action-cinematic",
      duration: 60,
      aspectRatio: "16:9",
    },
    recommendedDuration: 30,
    recommendedDirector: "hirokazu-koreeda",
    verifyPoint: "느린 감독 스타일이 컷 수를 과도하게 줄이지 않는지, character shot 다양성",
    suspectOnFail: "directorPaceDownWeight 과적용, character-driven shotCategory 편중",
  },

  // ─── 6. 설명형 내레이션 ───
  {
    id: "sample-narration-explainer",
    title: "설명형 내레이션 — 한옥의 구조",
    description: "정보 전달형 콘텐츠. object-detail과 environment 샷 밸런스 검증.",
    tags: ["narration", "explainer", "object-detail", "environment"],
    input: {
      storyText:
        "한옥의 기와지붕. 기와 하나하나가 물결처럼 이어진다. " +
        "처마 끝에 풍경이 달려 있다. 대청마루에 햇살이 비친다. " +
        "온돌방의 구들장 아래로 따뜻한 공기가 흐른다. " +
        "마당에 장독대가 줄지어 있다. 각 독의 뚜껑 위에 이슬이 맺혔다.",
      directorPersona: "terrence-malick",
      region: "한국",
      animationMode: "live-action-cinematic",
      duration: 60,
      aspectRatio: "16:9",
    },
    recommendedDuration: 45,
    recommendedDirector: "terrence-malick",
    verifyPoint: "설명형에서 environment/object-detail이 적절히 섞이는지, 단조롭지 않은지",
    suspectOnFail: "shotCategory 분류 편중, narrativeFunction 미인식",
  },

  // ─── 7. 액션형 장면 ───
  {
    id: "sample-action-chase",
    title: "액션형 — 골목 추격전",
    description: "빠른 액션. 빈 컷 없이 긴장감 유지, 짧은 컷들의 리듬 검증.",
    tags: ["action", "fast-pace", "chase", "tension"],
    input: {
      storyText:
        "좁은 골목. 남자가 전력질주한다. 뒤에서 발소리가 따라온다. " +
        "담벼락을 넘고, 시장 통로를 가로지른다. 과일 좌판이 쓰러진다. " +
        "막다른 골목. 남자가 돌아선다. 추격자의 얼굴이 보인다. " +
        "두 사람이 대치한다. 숨소리만 들린다.",
      directorPersona: "park-chan-wook",
      region: "한국",
      animationMode: "live-action-cinematic",
      duration: 60,
      aspectRatio: "16:9",
    },
    recommendedDuration: 30,
    recommendedDirector: "park-chan-wook",
    verifyPoint: "액션에서 컷당 2-3초 빠른 리듬 유지, 각 컷이 서로 다른 구도를 가지는지",
    suspectOnFail: "densifyCuts 분할 부족, cameraDirection 반복",
  },

  // ─── 8. 느린 감독 vs 빠른 장면 충돌 ───
  {
    id: "sample-director-conflict",
    title: "감독 충돌 — 고레에다 + 액션 장면",
    description: "느린 감독(고레에다)에 빠른 액션 장면. 스타일 vs 리듬 갈등 검증.",
    tags: ["director-conflict", "pace-tension", "koreeda", "action"],
    input: {
      storyText:
        "아이들이 공원에서 뛰어놀다가 갑자기 폭우가 쏟아진다. " +
        "아이들이 비명을 지르며 달린다. 미끄러져 넘어지는 아이. " +
        "다른 아이가 손을 내밀어 일으켜 세운다. " +
        "처마 밑에 모여 비를 바라보며 웃는다. 빗물에 젖은 운동화.",
      directorPersona: "hirokazu-koreeda",
      region: "한국",
      animationMode: "live-action-cinematic",
      duration: 60,
      aspectRatio: "16:9",
    },
    recommendedDuration: 30,
    recommendedDirector: "hirokazu-koreeda",
    verifyPoint: "느린 감독이 액션 부분의 리듬을 죽이지 않는지, 반대로 스타일이 너무 희석되지 않는지",
    suspectOnFail: "directorPaceDownWeight 로직, 감독 bias vs rhythm policy 우선순위",
  },

  // ─── 9. Fallback 유발 가능성 — 복잡한 장면 ───
  {
    id: "sample-complex-fallback",
    title: "복잡 장면 — 전쟁터 원테이크",
    description: "극도로 복잡한 설정. Fallback/degraded path 유발 가능성 검증.",
    tags: ["complex", "fallback-risk", "longform", "stress-test"],
    input: {
      storyText:
        "1950년. 포화 속 들판. 수십 명의 병사가 참호를 뛰어넘는다. " +
        "폭발이 연속으로 일어난다. 흙과 연기가 하늘을 뒤덮는다. " +
        "한 병사가 부상당한 동료를 등에 업고 달린다. " +
        "탱크가 언덕 위로 올라온다. 포탄이 날아온다. " +
        "병사가 웅덩이에 몸을 던진다. 물이 튀고 피가 번진다. " +
        "하늘에서 전투기가 지나간다. 기관총 소리가 울린다. " +
        "연기가 걷히고 들판이 고요해진다. 바람에 풀이 흔들린다. " +
        "멀리서 새가 운다.",
      directorPersona: "denis-villeneuve",
      region: "한국",
      animationMode: "live-action-cinematic",
      duration: 120,
      aspectRatio: "16:9",
    },
    recommendedDuration: 120,
    recommendedDirector: "denis-villeneuve",
    verifyPoint: "복잡한 장면에서 fallback/degraded 발생 시 결과가 '버그'처럼 느껴지지 않는지",
    suspectOnFail: "MAX_TOKENS fallback, generic split, outline-only path, segment budget 초과",
  },

  // ─── 10. 60초 표준 (기존 유지) ───
  {
    id: "sample-standard-60s",
    title: "60초 표준 — 요리사의 하루",
    description: "4-segment 멀티컷 검증. 시간축 정합성, persona bias 테스트.",
    tags: ["standard", "60s", "multi-segment", "character", "core"],
    input: {
      storyText:
        "새벽 4시, 수산시장. 젊은 요리사가 신선한 생선을 고른다. " +
        "오전 9시, 작은 식당 주방. 칼질 소리가 리드미컬하게 울린다. " +
        "정오, 점심 러시. 주문이 쏟아지고 요리사의 손이 바빠진다. " +
        "오후 3시, 한산한 식당. 요리사가 혼자 앉아 자신이 만든 요리를 먹는다. " +
        "창밖으로 노을이 진다. 내일을 위해 메뉴를 구상하는 요리사의 눈빛.",
      directorPersona: "hirokazu-koreeda",
      region: "한국",
      animationMode: "live-action-cinematic",
      duration: 60,
      aspectRatio: "16:9",
    },
    recommendedDuration: 60,
    recommendedDirector: "hirokazu-koreeda",
    verifyPoint: "4-segment 분할 정합성, 각 segment 내 컷 밀도, temporalBeats 순서 보존",
    suspectOnFail: "segment-cut-budget, segment-meta-propagation, 시간축 정합",
  },

  // ─── 11. 120초 장편 (기존 유지) ───
  {
    id: "sample-longform-120s",
    title: "120초 장편 — 우주 탐사선",
    description: "8-segment 배치 생성 검증. density split, 시퀀스 플랜 정합성.",
    tags: ["longform", "120s", "batch", "scifi", "core"],
    input: {
      storyText:
        "2187년, 인류 최후의 탐사선 '아리랑 7호'가 목성 궤도에 진입한다. " +
        "선장 김서연은 창밖의 대적점을 바라본다. 통신이 두절된 지 72시간. " +
        "엔지니어 박준혁이 신호를 잡았다며 달려온다 — 하지만 신호의 출처는 탐사선 내부다. " +
        "보안 카메라를 돌려보니 화물칸에서 알 수 없는 빛이 깜빡인다. " +
        "김서연이 화물칸으로 향한다. 문을 열자 거대한 결정체가 공중에 떠 있다. " +
        "결정체가 서연의 어린 시절 목소리를 재생한다. 서연이 손을 뻗는다. " +
        "결정체가 산산이 부서지며 탐사선 전체가 빛에 휩싸인다. " +
        "빛이 걷히고, 서연은 지구의 해변에 서 있다. 파도 소리가 들린다.",
      directorPersona: "denis-villeneuve",
      region: "한국",
      animationMode: "live-action-cinematic",
      duration: 120,
      aspectRatio: "16:9",
    },
    recommendedDuration: 120,
    recommendedDirector: "denis-villeneuve",
    verifyPoint: "8-segment 배치에서 시퀀스 플랜 정합, density split 균등 분배, 장편 리듬",
    suspectOnFail: "segment-orchestration-planning, batch budget, fast-density split",
  },
];
