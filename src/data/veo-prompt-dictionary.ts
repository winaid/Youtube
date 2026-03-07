// Veo Prompt Optimization Dictionary
// Korean camera/style terms → Veo-optimized English phrases
// Used by refine-prompt and generate-cuts for higher quality Veo output

export interface VeoTermMapping {
  ko: string;
  en: string;
  category: "camera" | "lighting" | "mood" | "transition" | "composition" | "motion";
}

export const veoTermDictionary: VeoTermMapping[] = [
  // === Camera Work ===
  { ko: "클로즈업", en: "extreme close-up shot", category: "camera" },
  { ko: "대사 클로즈업", en: "tight close-up on face, dialogue framing", category: "camera" },
  { ko: "풀샷", en: "full body shot", category: "camera" },
  { ko: "미디엄 샷", en: "medium shot from waist up", category: "camera" },
  { ko: "버스트 샷", en: "bust shot, chest-level framing", category: "camera" },
  { ko: "와이드 샷", en: "wide establishing shot", category: "camera" },
  { ko: "익스트림 와이드", en: "extreme wide shot, vast landscape", category: "camera" },
  { ko: "로우 앵글", en: "low angle shot looking upward, heroic perspective", category: "camera" },
  { ko: "하이 앵글", en: "high angle shot looking down, bird's eye view", category: "camera" },
  { ko: "더치 앵글", en: "Dutch angle, tilted camera 30 degrees, disorienting", category: "camera" },
  { ko: "오버더숄더", en: "over-the-shoulder shot", category: "camera" },
  { ko: "POV", en: "first-person point-of-view shot, subjective camera", category: "camera" },
  { ko: "투 샷", en: "two-shot framing both characters", category: "camera" },
  { ko: "마스터 샷", en: "master shot establishing the full scene geography", category: "camera" },

  // === Camera Motion ===
  { ko: "팬", en: "smooth horizontal pan", category: "motion" },
  { ko: "틸트", en: "vertical tilt movement", category: "motion" },
  { ko: "틸트 업", en: "slow tilt up revealing the scene", category: "motion" },
  { ko: "틸트 다운", en: "tilt down from sky to ground level", category: "motion" },
  { ko: "달리 인", en: "slow dolly in toward the subject", category: "motion" },
  { ko: "달리 아웃", en: "dolly out pulling away from the subject", category: "motion" },
  { ko: "달리 줌", en: "dolly zoom, Hitchcock vertigo effect, background warps", category: "motion" },
  { ko: "트래킹 샷", en: "lateral tracking shot following the subject", category: "motion" },
  { ko: "스테디캠", en: "smooth steadicam following movement", category: "motion" },
  { ko: "핸드헬드", en: "handheld camera, slight organic shake, documentary feel", category: "motion" },
  { ko: "크레인 샷", en: "crane shot sweeping upward", category: "motion" },
  { ko: "지브 샷", en: "jib shot, arc movement over the scene", category: "motion" },
  { ko: "드론 샷", en: "aerial drone shot, smooth fly-over", category: "motion" },
  { ko: "궤도 샷", en: "orbiting 360-degree shot around the subject", category: "motion" },
  { ko: "휘팬", en: "whip pan with motion blur to new subject", category: "motion" },
  { ko: "랙 포커스", en: "rack focus shifting from foreground to background", category: "motion" },
  { ko: "풀 포커스", en: "deep focus, everything sharp from foreground to background", category: "motion" },
  { ko: "줌 인", en: "smooth zoom in tightening on the subject", category: "motion" },
  { ko: "줌 아웃", en: "zoom out revealing the wider environment", category: "motion" },
  { ko: "롱테이크", en: "long continuous take without cuts, single unbroken shot", category: "motion" },
  { ko: "원테이크", en: "one-take continuous shot, no editing", category: "motion" },
  { ko: "슬로우 푸시 인", en: "very slow push in, building tension", category: "motion" },
  { ko: "풀백", en: "camera pulls back revealing context", category: "motion" },

  // === Lighting ===
  { ko: "키 라이트", en: "strong key light illuminating the subject", category: "lighting" },
  { ko: "림 라이트", en: "rim lighting creating a glowing outline, backlit silhouette edge", category: "lighting" },
  { ko: "실루엣", en: "silhouette against bright background", category: "lighting" },
  { ko: "역광", en: "strong backlight, lens flare, subject in partial shadow", category: "lighting" },
  { ko: "자연광", en: "natural daylight, soft ambient lighting", category: "lighting" },
  { ko: "골든아워", en: "golden hour warm sunlight, long shadows, orange glow", category: "lighting" },
  { ko: "블루아워", en: "blue hour twilight, cool blue ambient light", category: "lighting" },
  { ko: "네온 라이트", en: "neon lighting, colorful reflections on wet surfaces", category: "lighting" },
  { ko: "키아로스쿠로", en: "chiaroscuro lighting, dramatic contrast between light and shadow", category: "lighting" },
  { ko: "소프트 라이트", en: "soft diffused lighting, gentle shadows", category: "lighting" },
  { ko: "하드 라이트", en: "hard directional light, sharp defined shadows", category: "lighting" },
  { ko: "탑 라이트", en: "overhead top-down lighting, dramatic eye shadows", category: "lighting" },
  { ko: "언더 라이트", en: "under-lighting from below, eerie horror effect", category: "lighting" },
  { ko: "촛불 조명", en: "warm candlelight, flickering orange glow, intimate atmosphere", category: "lighting" },
  { ko: "형광등", en: "harsh fluorescent lighting, clinical cold white", category: "lighting" },
  { ko: "볼류메트릭 라이트", en: "volumetric light rays, god rays through dust particles", category: "lighting" },

  // === Mood / Atmosphere ===
  { ko: "긴장감", en: "tense atmosphere, suspenseful, uneasy silence", category: "mood" },
  { ko: "몽환적", en: "dreamlike, ethereal, soft focus haze", category: "mood" },
  { ko: "우울한", en: "melancholic, somber, desaturated cool tones", category: "mood" },
  { ko: "따뜻한", en: "warm, cozy, golden tones, intimate feeling", category: "mood" },
  { ko: "서늘한", en: "cold, clinical, blue-grey color palette", category: "mood" },
  { ko: "공포", en: "horror atmosphere, deep shadows, unsettling", category: "mood" },
  { ko: "서사적", en: "epic, grand scale, sweeping orchestral feeling", category: "mood" },
  { ko: "고요한", en: "serene, peaceful stillness, ambient calm", category: "mood" },
  { ko: "카오스", en: "chaotic, frantic energy, shaky unstable framing", category: "mood" },
  { ko: "노스탤지어", en: "nostalgic, warm vintage tones, memory-like quality", category: "mood" },

  // === Transitions ===
  { ko: "디졸브", en: "slow dissolve transition blending scenes", category: "transition" },
  { ko: "컷 투", en: "hard cut to next scene", category: "transition" },
  { ko: "매치 컷", en: "match cut connecting similar shapes or movements", category: "transition" },
  { ko: "점프 컷", en: "jump cut, jarring time skip", category: "transition" },
  { ko: "와이프", en: "wipe transition sweeping across frame", category: "transition" },
  { ko: "페이드 인", en: "fade in from black", category: "transition" },
  { ko: "페이드 아웃", en: "fade out to black", category: "transition" },
  { ko: "스매시 컷", en: "smash cut, abrupt jarring transition for shock", category: "transition" },

  // === Composition ===
  { ko: "삼분할", en: "rule of thirds composition", category: "composition" },
  { ko: "대칭 구도", en: "symmetrical framing, centered composition", category: "composition" },
  { ko: "프레임 인 프레임", en: "frame within a frame, nested framing through doorway or window", category: "composition" },
  { ko: "리딩 라인", en: "leading lines drawing eye toward subject", category: "composition" },
  { ko: "네거티브 스페이스", en: "negative space, subject small in vast empty frame", category: "composition" },
  { ko: "전경 프레이밍", en: "foreground framing, objects in front creating depth", category: "composition" },
  { ko: "심도", en: "shallow depth of field, bokeh background blur", category: "composition" },
  { ko: "딥 포커스", en: "deep focus, everything sharp front to back", category: "composition" },
];

// Quick lookup map for Korean → English
export const koToEnMap = new Map<string, string>(
  veoTermDictionary.map((t) => [t.ko, t.en])
);

// Replace Korean terms in a prompt with Veo-optimized English
export function optimizePromptTerms(prompt: string): string {
  let result = prompt;
  for (const term of veoTermDictionary) {
    if (result.includes(term.ko)) {
      result = result.replaceAll(term.ko, term.en);
    }
  }
  return result;
}

// Get all terms by category
export function getTermsByCategory(category: VeoTermMapping["category"]): VeoTermMapping[] {
  return veoTermDictionary.filter((t) => t.category === category);
}
