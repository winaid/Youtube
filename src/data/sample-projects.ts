/**
 * sample-projects.ts — 내부 검증용 샘플 프로젝트
 *
 * Owner-Only V0.9: 다양한 시나리오를 빠르게 로드하여
 * 핵심 엔진 품질을 반복 검증할 수 있는 프리셋.
 */

import type { PromptInput } from "@/types";

export interface SampleProject {
  id: string;
  title: string;
  description: string;
  /** 검증 목적 태그 */
  tags: string[];
  input: PromptInput;
}

export const SAMPLE_PROJECTS: SampleProject[] = [
  {
    id: "sample-shortform-15s",
    title: "15초 숏폼 — 골목길 고양이",
    description: "숏폼 리듬 정책(13-15초 = min 4컷) 검증. 빠른 비트와 감정 전환.",
    tags: ["shortform", "rhythm", "15s", "animal"],
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
  },
  {
    id: "sample-standard-60s",
    title: "60초 표준 — 요리사의 하루",
    description: "4-segment 멀티컷 검증. 시간축 정합성, persona bias 테스트.",
    tags: ["standard", "60s", "multi-segment", "character"],
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
  },
  {
    id: "sample-longform-120s",
    title: "120초 장편 — 우주 탐사선",
    description: "8-segment 배치 생성 검증. density split, 시퀀스 플랜 정합성.",
    tags: ["longform", "120s", "batch", "scifi"],
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
  },
  {
    id: "sample-director-comparison",
    title: "같은 이야기, 다른 감독 — 시장 풍경",
    description: "감독 스타일 적용 품질 검증. action vs formalist 차이 확인.",
    tags: ["director-style", "comparison", "persona"],
    input: {
      storyText:
        "동남아 야시장. 형형색색 조명 아래 상인들이 음식을 굽고, " +
        "관광객이 좁은 통로를 지나며 구경한다. " +
        "한 소녀가 아이스크림을 들고 인파 사이를 빠져나간다. " +
        "소녀가 골목 끝 벤치에 앉아 아이스크림을 먹으며 웃는다.",
      directorPersona: "park-chan-wook",
      region: "동남아",
      animationMode: "live-action-cinematic",
      duration: 60,
      aspectRatio: "9:16",
    },
  },
];
