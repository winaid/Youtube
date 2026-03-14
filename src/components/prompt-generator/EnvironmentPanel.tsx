"use client";

import { useState } from "react";
import { EnvironmentSetting, Cut } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const weatherOptions: { value: EnvironmentSetting["weather"]; label: string; icon: string; promptSuffix: string }[] = [
  { value: "clear", label: "맑음", icon: "☀️", promptSuffix: "clear sky, bright sunlight, sharp shadows, vivid colors" },
  { value: "rain", label: "비", icon: "🌧️", promptSuffix: "heavy rain falling, wet reflective surfaces, rain streaks visible, puddles on ground, grey overcast sky, water droplets" },
  { value: "snow", label: "눈", icon: "❄️", promptSuffix: "falling snow, white snow covering ground, cold breath vapor, muted colors, soft diffused winter light" },
  { value: "fog", label: "안개", icon: "🌫️", promptSuffix: "thick fog, limited visibility, soft diffused light, mysterious atmosphere, silhouettes fading into mist" },
  { value: "storm", label: "폭풍", icon: "⛈️", promptSuffix: "dramatic storm, dark threatening clouds, lightning flashes, strong wind, rain and debris flying" },
  { value: "cloudy", label: "흐림", icon: "☁️", promptSuffix: "overcast sky, soft diffused light, no harsh shadows, grey clouds, muted color palette" },
  { value: "wind", label: "바람", icon: "💨", promptSuffix: "strong wind blowing, hair and clothes flowing, leaves and particles in air, dynamic movement" },
];

const timeOptions: { value: EnvironmentSetting["timeOfDay"]; label: string; icon: string; promptSuffix: string }[] = [
  { value: "dawn", label: "새벽", icon: "🌅", promptSuffix: "dawn light, pink and orange sky, first rays of sun on horizon, quiet stillness, long blue shadows" },
  { value: "morning", label: "오전", icon: "🌤️", promptSuffix: "bright morning light, crisp clean atmosphere, warm but not harsh sunlight, dewy freshness" },
  { value: "noon", label: "정오", icon: "☀️", promptSuffix: "harsh overhead noon sun, short shadows directly below, bright saturated colors, intense light" },
  { value: "afternoon", label: "오후", icon: "🌥️", promptSuffix: "warm afternoon light, slightly angled sun, comfortable atmosphere, rich warm tones" },
  { value: "golden-hour", label: "골든아워", icon: "🌇", promptSuffix: "golden hour warm sunlight, long dramatic shadows, orange and amber tones, cinematic glow, lens flare" },
  { value: "dusk", label: "황혼", icon: "🌆", promptSuffix: "dusk twilight, purple and deep blue sky, city lights beginning to glow, fading daylight" },
  { value: "night", label: "밤", icon: "🌙", promptSuffix: "nighttime, dark environment, artificial lights, neon signs, streetlamps creating pools of light, deep shadows" },
  { value: "midnight", label: "심야", icon: "🌑", promptSuffix: "deep midnight, near total darkness, minimal light sources, moonlight casting cold blue shadows, eerie silence" },
];

interface EnvironmentPanelProps {
  cuts: Cut[];
  onApplyEnvironment: (promptSuffix: string) => void;
}

export default function EnvironmentPanel({ cuts, onApplyEnvironment }: EnvironmentPanelProps) {
  const [weather, setWeather] = useState<EnvironmentSetting["weather"]>("clear");
  const [timeOfDay, setTimeOfDay] = useState<EnvironmentSetting["timeOfDay"]>("afternoon");
  const [expanded, setExpanded] = useState(false);

  const selectedWeather = weatherOptions.find((w) => w.value === weather)!;
  const selectedTime = timeOptions.find((t) => t.value === timeOfDay)!;

  const handleApply = () => {
    const suffix = `${selectedWeather.promptSuffix}, ${selectedTime.promptSuffix}`;
    onApplyEnvironment(suffix);
  };

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#0ea5e940" }}>
      <CardHeader
        className="pb-2 cursor-pointer"
        style={{ background: "linear-gradient(135deg, #0ea5e915, #787fff10)" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm" style={{ color: "#0ea5e9" }}>
            날씨/시간대 일관성
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#0ea5e9" }}>
              {selectedWeather.icon} {selectedWeather.label} | {selectedTime.icon} {selectedTime.label}
            </Badge>
            <span className="text-xs text-muted-foreground">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3 pt-3">
          <p className="text-[10px] text-muted-foreground">
            설정한 날씨와 시간대가 모든 장면의 프롬프트에 자동 적용됩니다.
          </p>

          {/* 날씨 선택 */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium" style={{ color: "#0ea5e9" }}>날씨</p>
            <div className="flex flex-wrap gap-1.5">
              {weatherOptions.map((w) => (
                <button
                  key={w.value}
                  onClick={() => setWeather(w.value)}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg transition-all"
                  style={{
                    background: weather === w.value ? "#0ea5e9" : "#f5f5f5",
                    color: weather === w.value ? "white" : "#333",
                    border: `1px solid ${weather === w.value ? "#0ea5e9" : "#e5e5e5"}`,
                  }}
                >
                  {w.icon} {w.label}
                </button>
              ))}
            </div>
          </div>

          {/* 시간대 선택 */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium" style={{ color: "#0ea5e9" }}>시간대</p>
            <div className="flex flex-wrap gap-1.5">
              {timeOptions.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTimeOfDay(t.value)}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg transition-all"
                  style={{
                    background: timeOfDay === t.value ? "#0ea5e9" : "#f5f5f5",
                    color: timeOfDay === t.value ? "white" : "#333",
                    border: `1px solid ${timeOfDay === t.value ? "#0ea5e9" : "#e5e5e5"}`,
                  }}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* 프리뷰 */}
          <div className="p-2 rounded-lg text-[10px] font-mono" style={{ background: "#0ea5e908", border: "1px solid #0ea5e915" }}>
            <span className="text-muted-foreground">영상 프롬프트에 추가될 내용:</span>
            <br />
            {selectedWeather.promptSuffix}, {selectedTime.promptSuffix}
          </div>

          <Button
            size="sm"
            className="w-full text-white text-xs"
            style={{ background: "#0ea5e9" }}
            onClick={handleApply}
          >
            전체 {cuts.length}개 장면에 적용
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
