"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { PromptInput, Region, AnimationMode, Duration, DirectorPersona } from "@/types";
import { directors, workToDirectorMap } from "@/data/directors";
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

interface WebDirectorResult {
  id: string;
  name: string;
  nameKo: string;
  region: Region;
  style: string;
  description: string;
  matchedBy: string;
}

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
  { value: 150, label: "2분 30초" },
  { value: 180, label: "3분" },
];

export default function InputPanel({ onGenerate, isLoading }: InputPanelProps) {
  const [storyText, setStoryText] = useState("");
  const [directorPersona, setDirectorPersona] = useState("");
  const [region, setRegion] = useState<Region>("한국");
  const [animationMode, setAnimationMode] = useState<AnimationMode>("2D 애니");
  const [duration, setDuration] = useState<Duration>("auto");
  const [directorSearch, setDirectorSearch] = useState("");
  const [webResults, setWebResults] = useState<WebDirectorResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [customDirectors, setCustomDirectors] = useState<DirectorPersona[]>([]);
  const [cutCount, setCutCount] = useState<number | "auto">("auto");
  const [aiCutRecommendation, setAiCutRecommendation] = useState<{
    recommendedCuts: number;
    reason: string;
    scenes: string[];
  } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const allDirectors = useMemo(() => [...directors, ...customDirectors], [customDirectors]);
  const filteredDirectors = allDirectors.filter((d) => d.region === region);

  // 로컬 검색
  const localResults = useMemo(() => {
    const query = directorSearch.trim();
    if (!query) return [];

    const results: { director: DirectorPersona; matchedBy: string }[] = [];
    const addedIds = new Set<string>();

    for (const [workTitle, dirId] of Object.entries(workToDirectorMap)) {
      if (workTitle.includes(query)) {
        const director = allDirectors.find((d) => d.id === dirId);
        if (director && !addedIds.has(director.id)) {
          addedIds.add(director.id);
          results.push({ director, matchedBy: `작품: ${workTitle}` });
        }
      }
    }

    for (const d of allDirectors) {
      if (addedIds.has(d.id)) continue;
      if (
        d.nameKo.includes(query) ||
        d.name.toLowerCase().includes(query.toLowerCase())
      ) {
        addedIds.add(d.id);
        results.push({ director: d, matchedBy: "이름 일치" });
      }
    }

    for (const d of allDirectors) {
      if (addedIds.has(d.id)) continue;
      if (d.style.includes(query) || d.description.includes(query)) {
        addedIds.add(d.id);
        results.push({ director: d, matchedBy: "스타일 일치" });
      }
    }

    return results;
  }, [directorSearch, allDirectors]);

  // 웹 검색 (항상 실행)
  const searchWeb = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch("/api/search-director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        console.error("search-director API error:", res.status, await res.text());
        setWebResults([]);
        return;
      }
      const data = await res.json();
      if (data.directors && Array.isArray(data.directors)) {
        // 로컬에 이미 있는 감독은 제외
        const localIds = new Set(localResults.map((r) => r.director.id));
        setWebResults(data.directors.filter((d: WebDirectorResult) => !localIds.has(d.id)));
      }
    } catch (err) {
      console.error("search-director fetch error:", err);
      setWebResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [localResults]);

  // 디바운스된 웹 검색
  useEffect(() => {
    const query = directorSearch.trim();
    if (!query) {
      setWebResults([]);
      return;
    }

    const timer = setTimeout(() => {
      searchWeb(query);
    }, 600);

    return () => clearTimeout(timer);
  }, [directorSearch, searchWeb]);

  const searchResults = localResults;

  const handleSearchSelect = (directorId: string) => {
    const director = allDirectors.find((d) => d.id === directorId);
    if (director) {
      setRegion(director.region);
      setDirectorPersona(director.id);
      setDirectorSearch("");
      setWebResults([]);
    }
  };

  const handleWebSelect = (webDir: WebDirectorResult) => {
    // 웹 결과를 커스텀 감독으로 추가 (페르소나는 나중에 Gemini가 생성)
    const newDirector: DirectorPersona = {
      id: webDir.id,
      name: webDir.name,
      nameKo: webDir.nameKo,
      region: webDir.region,
      style: webDir.style,
      description: webDir.description,
      persona: "", // Gemini가 생성 시 채움
    };
    setCustomDirectors((prev) => {
      if (prev.some((d) => d.id === newDirector.id)) return prev;
      return [...prev, newDirector];
    });
    setRegion(webDir.region);
    setDirectorPersona(webDir.id);
    setDirectorSearch("");
    setWebResults([]);
  };

  // AI 컷 수 분석
  const analyzeStory = useCallback(async () => {
    if (!storyText.trim() || storyText.length < 20) return;
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/analyze-cuts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyText }),
      });
      const data = await res.json();
      setAiCutRecommendation(data);
    } catch {
      setAiCutRecommendation(null);
    } finally {
      setIsAnalyzing(false);
    }
  }, [storyText]);

  // 시나리오 변경 시 디바운스 분석
  useEffect(() => {
    if (storyText.trim().length < 20) {
      setAiCutRecommendation(null);
      return;
    }
    const timer = setTimeout(analyzeStory, 1500);
    return () => clearTimeout(timer);
  }, [storyText, analyzeStory]);

  const handleSubmit = () => {
    if (!storyText.trim() || !directorPersona) return;
    const selectedDir = allDirectors.find((d) => d.id === directorPersona);
    onGenerate({
      storyText,
      directorPersona,
      region,
      animationMode,
      duration,
      aspectRatio: "1:1",
      cutCount: cutCount === "auto" ? undefined : cutCount,
      customDirector: selectedDir && customDirectors.some((d) => d.id === selectedDir.id)
        ? selectedDir
        : undefined,
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
        </div>

        {/* 감독 검색 */}
        <div className="space-y-2">
          <Label>감독 검색</Label>
          <div className="relative">
            <input
              type="text"
              value={directorSearch}
              onChange={(e) => setDirectorSearch(e.target.value)}
              placeholder="감독 이름 또는 영화/애니 제목으로 검색..."
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#787fff]"
            />
            {directorSearch.trim() && (searchResults.length > 0 || webResults.length > 0 || isSearching) && (
              <div className="absolute z-50 w-full mt-1 rounded-md border bg-white shadow-lg max-h-60 overflow-y-auto">
                {searchResults.map(({ director, matchedBy }) => (
                  <button
                    key={director.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b last:border-b-0 transition-colors"
                    onClick={() => handleSearchSelect(director.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{director.nameKo}</span>
                      <Badge
                        variant="outline"
                        className="text-[10px] ml-2"
                        style={{ borderColor: "#787fff60", color: "#787fff" }}
                      >
                        {director.region}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {matchedBy} | {director.style.slice(0, 40)}...
                    </p>
                  </button>
                ))}
                {webResults.length > 0 && (
                  <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground bg-gray-50 border-b" style={{ color: "#787fff" }}>
                    웹 검색 결과 (Gemini)
                  </div>
                )}
                {webResults.map((webDir) => (
                  <button
                    key={webDir.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-b-0 transition-colors"
                    onClick={() => handleWebSelect(webDir)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{webDir.nameKo}</span>
                      <div className="flex items-center gap-1">
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          style={{ borderColor: "#787fff60", color: "#787fff" }}
                        >
                          {webDir.region}
                        </Badge>
                        <Badge
                          className="text-[10px]"
                          style={{ background: "#787fff20", color: "#787fff" }}
                        >
                          웹
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {webDir.matchedBy} | {webDir.style?.slice(0, 40)}...
                    </p>
                  </button>
                ))}
                {isSearching && (
                  <div className="px-3 py-3 text-xs text-center text-muted-foreground flex items-center justify-center gap-2">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "#787fff", borderTopColor: "transparent" }} />
                    웹에서 감독 검색 중...
                  </div>
                )}
              </div>
            )}
            {directorSearch.trim() && searchResults.length === 0 && webResults.length === 0 && !isSearching && (
              <div className="absolute z-50 w-full mt-1 rounded-md border bg-white shadow-lg p-3">
                <p className="text-xs text-muted-foreground text-center">
                  검색 결과가 없습니다. 다른 감독이나 작품명을 검색해보세요.
                </p>
              </div>
            )}
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
          <Label>감독 스타일</Label>
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

        {/* 컷 수 조절 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>컷 수</Label>
            {isAnalyzing && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="h-2 w-2 animate-spin rounded-full border border-current border-t-transparent" />
                AI 분석 중...
              </span>
            )}
          </div>

          {/* AI 추천 */}
          {aiCutRecommendation && (
            <div className="p-2.5 rounded-lg space-y-1.5" style={{ background: "#22c55e08", border: "1px solid #22c55e30" }}>
              <div className="flex items-center gap-2">
                <Badge className="text-[10px] text-white" style={{ background: "#22c55e" }}>
                  AI 추천: {aiCutRecommendation.recommendedCuts}컷
                </Badge>
                <button
                  className="text-[10px] font-medium underline"
                  style={{ color: "#22c55e" }}
                  onClick={() => setCutCount(aiCutRecommendation.recommendedCuts)}
                >
                  적용
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">{aiCutRecommendation.reason}</p>
              {aiCutRecommendation.scenes.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {aiCutRecommendation.scenes.slice(0, 5).map((scene, i) => (
                    <Badge key={i} variant="outline" className="text-[9px]" style={{ borderColor: "#22c55e40" }}>
                      {scene.slice(0, 20)}{scene.length > 20 ? "..." : ""}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant={cutCount === "auto" ? "default" : "outline"}
              size="sm"
              className="min-w-[50px]"
              style={cutCount === "auto" ? { background: "#787fff", color: "white" } : {}}
              onClick={() => setCutCount("auto")}
            >
              자동
            </Button>
            {[4, 6, 8, 10, 12, 15, 20].map((n) => (
              <Button
                key={n}
                variant={cutCount === n ? "default" : "outline"}
                size="sm"
                className="min-w-[40px]"
                style={cutCount === n ? { background: "#787fff", color: "white" } : {}}
                onClick={() => setCutCount(n)}
              >
                {n}
              </Button>
            ))}
          </div>
          <input
            type="number"
            min={4}
            max={25}
            placeholder="직접 입력 (4~25)"
            value={typeof cutCount === "number" ? cutCount : ""}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              if (v >= 4 && v <= 25) setCutCount(v);
              else if (e.target.value === "") setCutCount("auto");
            }}
            className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#787fff]"
          />
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
