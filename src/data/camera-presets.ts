// Camera Motion Preset Library for Veo 3.1
// 20 cinematic camera presets users can apply to any CutCard

export interface CameraPreset {
  id: string;
  nameKo: string;
  nameEn: string;
  category: "basic" | "dynamic" | "cinematic" | "creative" | "emotional";
  cameraDirection: string; // English for Veo
  description: string; // Korean UI description
  bestFor: string; // Korean - when to use
}

export const cameraPresets: CameraPreset[] = [
  // === Basic ===
  {
    id: "static-wide",
    nameKo: "고정 와이드",
    nameEn: "Static Wide",
    category: "basic",
    cameraDirection: "Wide establishing shot, static camera, full scene visible, deep focus capturing all elements",
    description: "전체 장면을 보여주는 고정 와이드 샷",
    bestFor: "장면 도입, 공간 소개",
  },
  {
    id: "simple-dolly-in",
    nameKo: "달리 인",
    nameEn: "Dolly In",
    category: "basic",
    cameraDirection: "Camera starts medium-wide then slowly dollies in toward the subject, ending on a close-up, smooth continuous movement",
    description: "멀리서 천천히 다가가는 달리 인",
    bestFor: "감정 고조, 집중, 긴장감",
  },
  {
    id: "simple-pan",
    nameKo: "수평 팬",
    nameEn: "Horizontal Pan",
    category: "basic",
    cameraDirection: "Smooth horizontal pan from left to right, revealing the scene gradually, steady tripod movement",
    description: "좌에서 우로 수평 패닝",
    bestFor: "풍경, 공간 탐색, 여러 인물 소개",
  },
  {
    id: "tilt-reveal",
    nameKo: "틸트 리빌",
    nameEn: "Tilt Reveal",
    category: "basic",
    cameraDirection: "Camera tilts up slowly from ground level, revealing the subject from feet to face, dramatic vertical reveal",
    description: "아래에서 위로 인물/건물 공개",
    bestFor: "인물 등장, 건물/거대 오브젝트 공개",
  },

  // === Dynamic ===
  {
    id: "tracking-follow",
    nameKo: "트래킹 따라가기",
    nameEn: "Tracking Follow",
    category: "dynamic",
    cameraDirection: "Lateral tracking shot following the subject walking, steadicam smooth movement, maintaining consistent framing",
    description: "인물을 따라가는 측면 트래킹",
    bestFor: "이동 장면, 대화하며 걷기",
  },
  {
    id: "push-pull",
    nameKo: "푸시-풀",
    nameEn: "Push-Pull",
    category: "dynamic",
    cameraDirection: "Camera pushes in quickly toward the subject then pulls back, creating a breathing rhythm, dolly zoom-like tension",
    description: "빠르게 접근했다 물러나는 긴장감",
    bestFor: "충격, 깨달음, 반전 순간",
  },
  {
    id: "whip-pan-transition",
    nameKo: "휘팬 전환",
    nameEn: "Whip Pan",
    category: "dynamic",
    cameraDirection: "Camera whip pans with motion blur from subject A to subject B, fast rotational movement creating energetic transition",
    description: "빠른 휘팬으로 시선 전환",
    bestFor: "긴박한 상황, 액션, 코미디 타이밍",
  },
  {
    id: "handheld-chase",
    nameKo: "핸드헬드 추적",
    nameEn: "Handheld Chase",
    category: "dynamic",
    cameraDirection: "Handheld camera urgently following the subject, slight shake and organic movement, documentary-style intensity",
    description: "급박한 핸드헬드 추적 촬영",
    bestFor: "추격, 긴급 상황, 다큐멘터리",
  },

  // === Cinematic ===
  {
    id: "crane-up-reveal",
    nameKo: "크레인 상승",
    nameEn: "Crane Rise",
    category: "cinematic",
    cameraDirection: "Camera on crane rises from close-up level upward and backward, revealing the full environment in an epic ascending shot",
    description: "크레인으로 상승하며 전체 공개",
    bestFor: "에필로그, 서사적 마무리, 공간 공개",
  },
  {
    id: "orbit-360",
    nameKo: "360도 궤도",
    nameEn: "Orbit 360",
    category: "cinematic",
    cameraDirection: "Camera orbits 360 degrees around the subject at eye level, smooth circular tracking, dramatic reveal of surroundings",
    description: "인물 주변을 360도 회전",
    bestFor: "히어로 순간, 결의, 중요 결정",
  },
  {
    id: "vertigo-dolly-zoom",
    nameKo: "버티고 효과",
    nameEn: "Vertigo Effect",
    category: "cinematic",
    cameraDirection: "Dolly zoom effect: camera dollies backward while zooming in, background warps and compresses, Hitchcock vertigo sensation",
    description: "달리 줌 — 배경이 왜곡되는 버티고",
    bestFor: "공포, 불안, 현실 왜곡",
  },
  {
    id: "one-take-master",
    nameKo: "원테이크 마스터",
    nameEn: "One-Take Master",
    category: "cinematic",
    cameraDirection: "Continuous one-take steadicam shot: starts wide establishing, smoothly tracks to medium, then pushes to close-up, all in one unbroken movement",
    description: "끊김 없는 원테이크 연속 촬영",
    bestFor: "몰입감, 롱테이크 감독 스타일",
  },
  {
    id: "low-angle-hero",
    nameKo: "로우 앵글 히어로",
    nameEn: "Low Angle Hero",
    category: "cinematic",
    cameraDirection: "Low angle shot looking up at the subject, camera slightly tilted upward, heroic and powerful framing, sky visible behind",
    description: "아래에서 올려다보는 영웅적 앵글",
    bestFor: "영웅적 순간, 위엄, 권력",
  },

  // === Creative ===
  {
    id: "bird-eye-top-down",
    nameKo: "탑다운 버드아이",
    nameEn: "Top Down",
    category: "creative",
    cameraDirection: "Directly overhead bird's-eye view looking straight down, flat geometric composition, Wes Anderson style top-down",
    description: "위에서 내려다보는 기하학적 구도",
    bestFor: "음식, 테이블 장면, 스타일리시한 연출",
  },
  {
    id: "dutch-angle-tension",
    nameKo: "더치 앵글",
    nameEn: "Dutch Angle",
    category: "creative",
    cameraDirection: "Dutch angle tilted 25 degrees, creating visual unease, combined with slow dolly forward, tension-building oblique framing",
    description: "기울어진 앵글로 불안감 조성",
    bestFor: "스릴러, 불안, 혼란, 악당 등장",
  },
  {
    id: "mirror-reflection",
    nameKo: "거울 반사 구도",
    nameEn: "Mirror Reflection",
    category: "creative",
    cameraDirection: "Camera captures subject through mirror or reflective surface, frame-within-frame composition, rack focus between reflection and reality",
    description: "거울/반사면을 통한 이중 구도",
    bestFor: "자아 성찰, 이중성, 내면 갈등",
  },
  {
    id: "silhouette-backlit",
    nameKo: "실루엣 역광",
    nameEn: "Silhouette Backlit",
    category: "creative",
    cameraDirection: "Subject silhouetted against bright backlight, rim lighting creating glowing edges, dramatic contrast, lens flare",
    description: "역광 실루엣으로 드라마틱한 연출",
    bestFor: "이별, 결단, 드라마틱한 등장",
  },

  // === Emotional ===
  {
    id: "intimate-closeup",
    nameKo: "친밀한 클로즈업",
    nameEn: "Intimate Close-up",
    category: "emotional",
    cameraDirection: "Extreme close-up on eyes and face, shallow depth of field with creamy bokeh, subtle slow push in, capturing micro-expressions",
    description: "눈과 표정에 집중하는 극 클로즈업",
    bestFor: "감정 절정, 눈물, 사랑, 깨달음",
  },
  {
    id: "lonely-pullback",
    nameKo: "고독한 풀백",
    nameEn: "Lonely Pullback",
    category: "emotional",
    cameraDirection: "Camera slowly pulls back from close-up to extreme wide, subject becomes small and isolated in vast empty space, emphasizing loneliness",
    description: "점점 멀어지며 고독감 강조",
    bestFor: "고독, 상실, 이별 후",
  },
  {
    id: "warm-embrace",
    nameKo: "따뜻한 포옹 샷",
    nameEn: "Warm Embrace",
    category: "emotional",
    cameraDirection: "Slow orbit around two subjects embracing, warm golden backlight, soft lens, gentle floating camera movement, intimate and tender",
    description: "포옹 장면의 따뜻한 궤도 촬영",
    bestFor: "재회, 화해, 사랑 고백",
  },
];

// Group presets by category
export function getPresetsByCategory(): Record<string, CameraPreset[]> {
  const grouped: Record<string, CameraPreset[]> = {};
  for (const preset of cameraPresets) {
    if (!grouped[preset.category]) grouped[preset.category] = [];
    grouped[preset.category].push(preset);
  }
  return grouped;
}

export const categoryLabels: Record<string, string> = {
  basic: "기본",
  dynamic: "다이나믹",
  cinematic: "시네마틱",
  creative: "크리에이티브",
  emotional: "감성",
};
