export interface MotionLevel {
  level: number;
  nameKo: string;
  cameraKeywords: string;
  description: string;
}

export const motionLevels: MotionLevel[] = [
  {
    level: 0,
    nameKo: "고요",
    cameraKeywords:
      "locked-off static tripod shot, no camera movement, perfectly still frame, fixed position",
    description:
      "완전히 고정된 삼각대 촬영. 카메라 움직임 없음. 명상, ASMR, 정물 촬영에 적합.",
  },
  {
    level: 25,
    nameKo: "차분",
    cameraKeywords:
      "subtle slow drift, gentle floating camera, smooth micro-movements, barely perceptible dolly, soft breathing motion",
    description:
      "미세하고 부드러운 카메라 드리프트. 느린 움직임으로 생동감 부여. 감성 브이로그, 인터뷰에 적합.",
  },
  {
    level: 50,
    nameKo: "기본",
    cameraKeywords:
      "standard dolly movement, smooth pan, gentle tilt, steady tracking shot, controlled orbit",
    description:
      "표준적인 달리/팬 카메라 움직임. 대부분의 영상에 적합한 기본 움직임 수준.",
  },
  {
    level: 75,
    nameKo: "역동",
    cameraKeywords:
      "dynamic tracking shot, energetic handheld movement, whip pan, fast dolly zoom, aggressive push-in, sweeping crane motion",
    description:
      "역동적인 트래킹과 핸드헬드 촬영. 액션, 스포츠, 뮤직비디오에 적합.",
  },
  {
    level: 100,
    nameKo: "극한",
    cameraKeywords:
      "extreme shaky cam, rapid chaotic movements, violent camera shake, dizzying spin, frenetic whip pans, unstable handheld, jarring sudden zooms",
    description:
      "극단적인 카메라 흔들림과 빠른 움직임. 공포, 전투 장면, 익스트림 스포츠에 적합.",
  },
];
