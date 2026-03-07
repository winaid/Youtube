export interface WeatherPreset {
  weather: string;
  nameKo: string;
  promptSuffix: string;
}

export interface TimePreset {
  time: string;
  nameKo: string;
  promptSuffix: string;
}

export const weatherPresets: WeatherPreset[] = [
  {
    weather: "clear",
    nameKo: "맑음",
    promptSuffix:
      "clear blue sky, bright sunlight casting sharp shadows, excellent visibility, vivid colors under direct sunlight",
  },
  {
    weather: "rain",
    nameKo: "비",
    promptSuffix:
      "heavy rain falling, wet reflective surfaces, rain streaks visible, puddles on ground, grey overcast sky, glistening droplets, moist atmosphere",
  },
  {
    weather: "snow",
    nameKo: "눈",
    promptSuffix:
      "gentle snowfall, white snow covering surfaces, soft diffused light, snowflakes drifting in air, frosted textures, cold breath visible, winter atmosphere",
  },
  {
    weather: "fog",
    nameKo: "안개",
    promptSuffix:
      "dense atmospheric fog, limited visibility, soft diffused lighting, silhouettes fading into mist, ethereal hazy atmosphere, muted colors",
  },
  {
    weather: "storm",
    nameKo: "폭풍",
    promptSuffix:
      "dramatic storm clouds, lightning flashes illuminating the sky, heavy downpour, strong wind bending trees, dark ominous atmosphere, turbulent weather",
  },
  {
    weather: "cloudy",
    nameKo: "흐림",
    promptSuffix:
      "overcast grey sky, soft even lighting with no harsh shadows, diffused cloud cover, muted tonal palette, flat ambient light",
  },
  {
    weather: "wind",
    nameKo: "바람",
    promptSuffix:
      "strong gusting wind, hair and clothes blowing dynamically, leaves and debris swirling in air, dust particles visible, rustling environment",
  },
];

export const timePresets: TimePreset[] = [
  {
    time: "dawn",
    nameKo: "새벽",
    promptSuffix:
      "pre-dawn twilight, deep blue to pale violet sky gradient, first hints of light on the horizon, serene stillness, faint stars fading",
  },
  {
    time: "morning",
    nameKo: "아침",
    promptSuffix:
      "early morning light, warm soft sunbeams, gentle long shadows, fresh dewy atmosphere, crisp clear air, pastel sky tones",
  },
  {
    time: "noon",
    nameKo: "정오",
    promptSuffix:
      "harsh midday sun directly overhead, minimal shadows, bright high-contrast lighting, vivid saturated colors, clear sky",
  },
  {
    time: "afternoon",
    nameKo: "오후",
    promptSuffix:
      "warm afternoon sunlight, moderately angled shadows, rich natural colors, comfortable ambient lighting, partly cloudy sky",
  },
  {
    time: "golden-hour",
    nameKo: "골든아워",
    promptSuffix:
      "golden hour warm orange sunlight, long dramatic shadows, rim lighting on subjects, lens flare, everything bathed in warm amber glow, cinematic magic hour",
  },
  {
    time: "dusk",
    nameKo: "황혼",
    promptSuffix:
      "twilight dusk sky with pink orange and purple gradients, silhouettes against colorful horizon, fading daylight, streetlights beginning to glow",
  },
  {
    time: "night",
    nameKo: "밤",
    promptSuffix:
      "nighttime darkness, artificial lighting from streetlamps and neon signs, moonlight casting cool blue tones, deep shadows, urban glow on horizon",
  },
  {
    time: "midnight",
    nameKo: "심야",
    promptSuffix:
      "deep midnight darkness, minimal ambient light, stars visible in sky, heavy shadows, isolated pools of light, quiet eerie stillness, cool blue-black tones",
  },
];
