"use client";

import { useState } from "react";
import { PromptInput, Region, AnimationMode, Duration } from "@/types";
import { directors, sampleScenarios } from "@/data/directors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface InputPanelProps {
  onGenerate: (input: PromptInput) => void;
  isLoading: boolean;
}

const regions: Region[] = ["한국", "일본", "중국", "유럽", "미국"];
const animationModes: AnimationMode[] = ["2D 애니", "실사", "하이브리드"];
const durations: { value: Duration; label: string }[] = [
  { value: "auto", label: "자동" },
  { value: 60, label: "60초" },
  { value: 90, label: "90초" },
  { value: 120, label: "2분" },
  { value: 150, label: "2분30" },
  { value: 180, label: "3분" },
];

export default function InputPanel({ onGenerate, isLoading }: InputPanelProps) {
  const [storyText, setStoryText] = useState("");
  const [directorPersona, setDirectorPersona] = useState("");
  const [region, setRegion] = useState<Region>("한국");
  const [animationMode, setAnimationMode] = useState<AnimationMode>("2D 애니");
  const [duration, setDuration] = useState<Duration>("auto");

  const filteredDirectors = directors.filter((d) => d.region === region);
  const selectedDirector = directors.find((d) => d.id === directorPersona);

  const handleSubmit = () => {
    if (!storyText.trim() || !directorPersona) return;
    onGenerate({
      storyText,
      directorPersona,
      region,
      animationMode,
      duration,
      aspectRatio: "1:1",
    });
  };

  const handleRegionChange = (value: Region) => {
    setRegion(value);
    setDirectorPersona("");
  };

  return (
    <Card className="h-full border-2" style={{ borderColor: "#787fff40" }}>
      <CardHeader style={{ background: "linear-gradient(135deg, #787fff15, #fff78715)" }}>
        <CardTitle className="text-lg" style={{ color: "#5a5ecc" }}>
          영상 프롬프트 설정
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        {/* 시나리오 입력 */}
        <div className="space-y-2">
          <Label htmlFor="story">시나리오 / 썰</Label>
          <Textarea
            id="story"
            placeholder="영상으로 만들고 싶은 이야기를 입력하세요..."
            value={storyText}
            onChange={(e) => setStoryText(e.target.value)}
            rows={5}
            className="resize-none focus-visible:ring-[#787fff]"
          />
          <div className="flex flex-wrap gap-1.5">
            {sampleScenarios.map((s) => (
              <Badge
                key={s.label}
                variant="outline"
                className="cursor-pointer transition-colors"
                style={{ borderColor: "#787fff60" }}
                onClick={() => setStoryText(s.text)}
              >
                {s.label}
              </Badge>
            ))}
          </div>
        </div>

        {/* 지역 선택 */}
        <div className="space-y-2">
          <Label>지역</Label>
          <Select value={region} onValueChange={handleRegionChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {regions.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 감독 페르소나 */}
        <div className="space-y-2">
          <Label>감독 페르소나</Label>
          <Select value={directorPersona} onValueChange={setDirectorPersona}>
            <SelectTrigger>
              <SelectValue placeholder="감독 스타일을 선택하세요" />
            </SelectTrigger>
            <SelectContent>
              {filteredDirectors.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nameKo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedDirector && (
            <div className="rounded-lg p-3 mt-2 space-y-2" style={{ background: "linear-gradient(135deg, #787fff10, #fff78720)", border: "1px solid #787fff30" }}>
              <p className="text-xs text-muted-foreground">
                {selectedDirector.description}
              </p>
              <p className="text-xs italic leading-relaxed" style={{ color: "#5a5ecc" }}>
                &ldquo;{selectedDirector.persona}&rdquo;
              </p>
            </div>
          )}
        </div>

        {/* 애니메이션 모드 */}
        <div className="space-y-2">
          <Label>애니메이션 모드</Label>
          <Select
            value={animationMode}
            onValueChange={(v) => setAnimationMode(v as AnimationMode)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {animationModes.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 영상 길이 */}
        <div className="space-y-2">
          <Label>영상 길이</Label>
          <div className="flex flex-wrap gap-2">
            {durations.map((d) => (
              <Button
                key={String(d.value)}
                variant={duration === d.value ? "default" : "outline"}
                size="sm"
                className="flex-1 min-w-[60px]"
                style={duration === d.value ? { background: "#787fff", color: "white" } : {}}
                onClick={() => setDuration(d.value)}
              >
                {d.label}
              </Button>
            ))}
          </div>
        </div>

        {/* 화면 비율 (고정) */}
        <div className="space-y-2">
          <Label>화면 비율</Label>
          <div className="flex items-center gap-2">
            <Badge style={{ background: "#fff787", color: "#7a7000" }}>1:1</Badge>
            <span className="text-xs text-muted-foreground">
              (정사각형 고정)
            </span>
          </div>
        </div>

        {/* 생성 버튼 */}
        <Button
          onClick={handleSubmit}
          disabled={!storyText.trim() || !directorPersona || isLoading}
          className="w-full text-white font-semibold"
          size="lg"
          style={{ background: "linear-gradient(135deg, #787fff, #9b8fff)", boxShadow: "0 4px 14px #787fff40" }}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              프롬프트 생성 중...
            </span>
          ) : (
            "프롬프트 생성하기"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
