"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { PromptInput, Region, AnimationMode, Duration, AspectRatio, DirectorPersona, SignatureTechniques } from "@/types";
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
  signatureTechniques?: SignatureTechniques;
  notableWorks?: string[];
}

interface InputPanelProps {
  onGenerate: (input: PromptInput) => void;
  isLoading: boolean;
  prefillScenario?: string;
  onPrefillConsumed?: () => void;
}

const regions: Region[] = ["한국", "일본", "중국", "유럽", "미국", "인도", "중동", "동남아", "중남미", "아프리카", "오세아니아"];

const animationStyles: { mode: AnimationMode; label: string; desc: string; directors: string[] }[] = [
  { mode: "2D 애니", label: "2D 애니", desc: "셀 애니메이션, 선명한 외곽선", directors: ["미야자키 하야오", "신카이 마코토", "콘 사토시"] },
  { mode: "실사", label: "실사", desc: "포토리얼, 시네마틱 필름 그레인", directors: ["봉준호", "크리스토퍼 놀란", "데이비드 핀처"] },
  { mode: "하이브리드", label: "하이브리드", desc: "2D+3D 혼합, 반실사 스타일", directors: ["이안", "기예르모 델 토로"] },
  { mode: "수채화 애니", label: "수채화", desc: "번지는 수채 물감 질감, 파스텔 톤", directors: ["미야자키 하야오", "임권택"] },
  { mode: "로토스코핑", label: "로토스코핑", desc: "실사 위에 그림 덧씌움, A Scanner Darkly 풍", directors: ["콘 사토시", "왕가위"] },
  { mode: "스톱모션", label: "스톱모션", desc: "클레이/인형 프레임별 촬영", directors: ["웨스 앤더슨", "기예르모 델 토로"] },
  { mode: "픽셀아트", label: "픽셀아트", desc: "16비트 레트로 게임 감성", directors: ["쿼틴 타란티노", "콘 사토시"] },
  { mode: "잉크워시", label: "동양화", desc: "수묵화 붓터치, 먹과 한지 질감", directors: ["장이머우", "임권택", "아피찻퐁"] },
  { mode: "클레이", label: "클레이", desc: "점토 캐릭터, 수제 미니어처", directors: ["웨스 앤더슨", "피터 잭슨"] },
  { mode: "빈티지 필름", label: "빈티지 필름", desc: "70년대 필름 그레인, 바랜 색감", directors: ["쿼틴 타란티노", "왕가위", "알폰소 쿠아론"] },
  { mode: "네온 사이버펑크", label: "네온 사이버펑크", desc: "네온, 비 젖은 거리, 홀로그램", directors: ["니콜라스 빈딩 레픈", "드니 빌뇌브", "콘 사토시"] },
  { mode: "미니어처", label: "미니어처", desc: "틸트시프트, 인형의 집 스타일", directors: ["웨스 앤더슨", "피터 잭슨"] },
];
// 감독 스타일 분석 → 영상 스타일 추천
function recommendStylesForDirector(
  director: DirectorPersona | undefined,
): { mode: AnimationMode; reason: string; score: number }[] {
  if (!director) return [];

  const style = (director.style || "").toLowerCase();
  const desc = (director.description || "").toLowerCase();
  const tech = director.signatureTechniques;
  const all = [
    style, desc,
    tech?.cameraWork, tech?.colorPalette, tech?.lighting,
    tech?.editingStyle, tech?.moodKeywords,
  ].filter(Boolean).join(" ").toLowerCase();

  const scores: { mode: AnimationMode; reason: string; score: number }[] = [];
  const check = (pattern: RegExp) => pattern.test(all);

  // 실사
  let s = 0;
  if (check(/photorealistic|real|live.?action|cinematic|film grain|realism/)) s += 3;
  if (check(/사실|실사|리얼|사회|누아르|범죄|스릴러|드라마|긴장|묵직/)) s += 2;
  if (check(/tracking|handheld|steadicam|dolly|crane|deep focus|long take/)) s += 1;
  if (s > 0) scores.push({ mode: "실사", reason: "시네마틱 실사 촬영에 최적", score: s });

  // 2D 애니
  s = 0;
  if (check(/anime|2d|cel.?shad|animation|animated/)) s += 3;
  if (check(/애니|셀|만화|일본|지브리|작화/)) s += 2;
  if (check(/vibrant|colorful|hand.?drawn/)) s += 1;
  if (s > 0) scores.push({ mode: "2D 애니", reason: "셀 애니메이션 스타일", score: s });

  // 수채화 애니
  s = 0;
  if (check(/watercolor|pastel|soft|gentle|ghibli/)) s += 3;
  if (check(/수채|파스텔|몽환|서정|자연|따뜻/)) s += 2;
  if (check(/warm.*tone|soft.*light|natural.*beauty/)) s += 1;
  if (s > 0) scores.push({ mode: "수채화 애니", reason: "수채화 감성과 어울림", score: s });

  // 빈티지 필름
  s = 0;
  if (check(/vintage|70s|retro|grain|faded|analog|film stock|old school/)) s += 3;
  if (check(/빈티지|레트로|필름|바랜|클래식|노스탤지|올드/)) s += 2;
  if (check(/desaturated|sepia|amber|warm.*highlight/)) s += 1;
  if (s > 0) scores.push({ mode: "빈티지 필름", reason: "빈티지 필름 그레인 감성", score: s });

  // 네온 사이버펑크
  s = 0;
  if (check(/neon|cyberpunk|futuristic|noir|blade runner|electric/)) s += 3;
  if (check(/네온|사이버|미래|도시|야경|형광|어둠/)) s += 2;
  if (check(/blue.*pink|cold|rain|wet.*street/)) s += 1;
  if (s > 0) scores.push({ mode: "네온 사이버펑크", reason: "네온빛 미래 도시 감성", score: s });

  // 잉크워시 (동양화)
  s = 0;
  if (check(/ink wash|sumi.?e|brush|calligraph|minimalist|zen|oriental/)) s += 3;
  if (check(/수묵|동양|먹|한지|붓|절제|여백|무사|사무라이/)) s += 2;
  if (check(/monochrome|sparse|contrast/)) s += 1;
  if (s > 0) scores.push({ mode: "잉크워시", reason: "수묵화 여백과 절제미", score: s });

  // 하이브리드
  s = 0;
  if (check(/hybrid|blend|semi.?real|stylized|cgi|vfx/)) s += 3;
  if (check(/혼합|반실사|하이브리드|판타지|대서사/)) s += 2;
  if (s > 0) scores.push({ mode: "하이브리드", reason: "2D+3D 혼합 반실사", score: s });

  // 로토스코핑
  s = 0;
  if (check(/rotoscop|dreamlike|surreal|psychedelic|hallucin/)) s += 3;
  if (check(/몽환|초현실|환각|꿈|편집증/)) s += 2;
  if (s > 0) scores.push({ mode: "로토스코핑", reason: "초현실 몽환적 연출", score: s });

  // 스톱모션
  s = 0;
  if (check(/stop.?motion|puppet|handcraft/)) s += 3;
  if (check(/스톱|인형|수작업/)) s += 2;
  if (s > 0) scores.push({ mode: "스톱모션", reason: "수작업 스톱모션 감성", score: s });

  // 클레이
  s = 0;
  if (check(/clay|plasticine|sculpt|wallace/)) s += 3;
  if (check(/점토|클레이|수제/)) s += 2;
  if (s > 0) scores.push({ mode: "클레이", reason: "점토 캐릭터 질감", score: s });

  // 픽셀아트
  s = 0;
  if (check(/pixel|retro.*game|8.?bit|16.?bit|arcade/)) s += 3;
  if (check(/픽셀|레트로|게임|도트/)) s += 2;
  if (s > 0) scores.push({ mode: "픽셀아트", reason: "레트로 게임 픽셀 스타일", score: s });

  // 미니어처
  s = 0;
  if (check(/tilt.?shift|diorama|dollhouse|miniature|symmetr/)) s += 3;
  if (check(/대칭|미니어처|인형의 집|정교/)) s += 2;
  if (s > 0) scores.push({ mode: "미니어처", reason: "대칭 미니어처 디오라마", score: s });

  scores.sort((a, b) => b.score - a.score);

  // 매칭 없으면 지역 기반 기본 추천
  if (scores.length === 0) {
    const r = director.region;
    if (r === "일본") {
      scores.push({ mode: "2D 애니", reason: "일본 감독 기본 추천", score: 1 });
      scores.push({ mode: "수채화 애니", reason: "일본 서정 감성", score: 1 });
      scores.push({ mode: "실사", reason: "시네마틱 실사", score: 1 });
    } else {
      scores.push({ mode: "실사", reason: "시네마틱 실사 기본", score: 1 });
      scores.push({ mode: "빈티지 필름", reason: "클래식 필름 감성", score: 1 });
      scores.push({ mode: "하이브리드", reason: "반실사 하이브리드", score: 1 });
    }
  }

  return scores.slice(0, 3);
}

const durations: { value: Duration; label: string }[] = [
  { value: "auto", label: "자동" },
  { value: 60, label: "60초" },
  { value: 90, label: "90초" },
  { value: 120, label: "2분" },
  { value: 150, label: "2분 30초" },
  { value: 180, label: "3분" },
];

export default function InputPanel({ onGenerate, isLoading, prefillScenario, onPrefillConsumed }: InputPanelProps) {
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
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [aiCutRecommendation, setAiCutRecommendation] = useState<{
    recommendedCuts: number;
    reason: string;
    scenes: string[];
  } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [blendDirector, setBlendDirector] = useState("");
  const [blendRatio, setBlendRatio] = useState(70); // 메인 감독 비율

  // 시나리오 프리필
  useEffect(() => {
    if (prefillScenario) {
      setStoryText(prefillScenario);
      onPrefillConsumed?.();
    }
  }, [prefillScenario, onPrefillConsumed]);

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
    // 웹 결과를 커스텀 감독으로 추가 (signatureTechniques 포함)
    const newDirector: DirectorPersona = {
      id: webDir.id,
      name: webDir.name,
      nameKo: webDir.nameKo,
      region: webDir.region,
      style: webDir.style,
      description: webDir.description,
      persona: "", // Gemini가 생성 시 채움
      signatureTechniques: webDir.signatureTechniques,
      notableWorks: webDir.notableWorks,
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
    const blendDir = blendDirector ? allDirectors.find((d) => d.id === blendDirector) : undefined;

    // 블렌딩 정보를 storyText에 메타로 추가 (API 호환 유지)
    let finalStory = storyText;
    if (blendDir && selectedDir) {
      finalStory = `[감독 스타일 블렌딩: ${selectedDir.nameKo} ${blendRatio}% + ${blendDir.nameKo} ${100 - blendRatio}%]\n\n${storyText}`;
    }

    onGenerate({
      storyText: finalStory,
      directorPersona,
      region,
      animationMode,
      duration,
      aspectRatio,
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
              {filteredDirectors.map((d) => {
                const isCustom = customDirectors.some((cd) => cd.id === d.id);
                return (
                  <SelectItem key={d.id} value={d.id}>
                    {d.nameKo}{isCustom ? " (검색 추가)" : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* 감독 블렌딩 */}
        {directorPersona && (
          <div className="space-y-2 p-3 rounded-lg" style={{ background: "#f8f0ff", border: "1px solid #d8b4fe40" }}>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold" style={{ color: "#7c3aed" }}>
                스타일 블렌딩 (선택)
              </Label>
              {blendDirector && (
                <button
                  onClick={() => setBlendDirector("")}
                  className="text-[10px] text-muted-foreground hover:text-red-400"
                >
                  해제
                </button>
              )}
            </div>
            <Select value={blendDirector} onValueChange={setBlendDirector}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="두 번째 감독 스타일 선택..." />
              </SelectTrigger>
              <SelectContent>
                {allDirectors
                  .filter((d) => d.id !== directorPersona)
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.nameKo} ({d.region})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {blendDirector && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span style={{ color: "#5a5ecc" }}>
                    {allDirectors.find((d) => d.id === directorPersona)?.nameKo} {blendRatio}%
                  </span>
                  <span style={{ color: "#7c3aed" }}>
                    {allDirectors.find((d) => d.id === blendDirector)?.nameKo} {100 - blendRatio}%
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={10}
                  value={blendRatio}
                  onChange={(e) => setBlendRatio(Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none"
                  style={{ background: `linear-gradient(to right, #787fff ${blendRatio}%, #7c3aed ${blendRatio}%)` }}
                />
              </div>
            )}
          </div>
        )}

        {/* 감독 기반 영상 스타일 AI 추천 */}
        {directorPersona && (() => {
          const selectedDir = allDirectors.find((d) => d.id === directorPersona);
          const recommendations = recommendStylesForDirector(selectedDir);
          if (recommendations.length === 0) return null;
          return (
            <div className="space-y-2 p-3 rounded-lg" style={{ background: "linear-gradient(135deg, #22c55e08, #787fff08)", border: "1px solid #22c55e25" }}>
              <div className="flex items-center gap-2">
                <Label className="text-xs font-semibold" style={{ color: "#16a34a" }}>
                  {selectedDir?.nameKo} 추천 영상 스타일
                </Label>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full text-white" style={{ background: "#22c55e" }}>
                  AI 분석
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                감독의 시그니처 기법을 분석하여 가장 어울리는 스타일을 추천합니다. 어떤 스타일을 선택해도 감독 특유의 연출 색깔은 유지됩니다.
              </p>
              <div className="flex gap-1.5">
                {recommendations.map((rec, i) => (
                  <button
                    key={rec.mode}
                    onClick={() => setAnimationMode(rec.mode)}
                    className="flex-1 p-2 rounded-lg transition-all text-left"
                    style={
                      animationMode === rec.mode
                        ? { background: "#22c55e", color: "white", boxShadow: "0 2px 8px #22c55e30" }
                        : { background: "white", border: "1px solid #22c55e30" }
                    }
                  >
                    <div className="flex items-center gap-1">
                      {i === 0 && (
                        <span className="text-[8px] px-1 py-0.5 rounded text-white shrink-0" style={{ background: animationMode === rec.mode ? "#ffffff40" : "#22c55e" }}>
                          BEST
                        </span>
                      )}
                      <span className="text-[11px] font-semibold truncate">
                        {animationStyles.find((s) => s.mode === rec.mode)?.label || rec.mode}
                      </span>
                    </div>
                    <p className="text-[9px] mt-0.5 leading-snug" style={{ opacity: 0.7 }}>
                      {rec.reason}
                    </p>
                  </button>
                ))}
              </div>
              {selectedDir?.signatureTechniques && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedDir.signatureTechniques.cameraWork && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full" style={{ background: "#787fff10", color: "#5a5ecc" }}>
                      {selectedDir.signatureTechniques.cameraWork.split(",")[0].trim()}
                    </span>
                  )}
                  {selectedDir.signatureTechniques.colorPalette && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full" style={{ background: "#e0990010", color: "#b37700" }}>
                      {selectedDir.signatureTechniques.colorPalette.split(",")[0].trim()}
                    </span>
                  )}
                  {selectedDir.signatureTechniques.lighting && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full" style={{ background: "#22c55e10", color: "#16a34a" }}>
                      {selectedDir.signatureTechniques.lighting.split(",")[0].trim()}
                    </span>
                  )}
                  {selectedDir.signatureTechniques.moodKeywords && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full" style={{ background: "#ef444410", color: "#dc2626" }}>
                      {selectedDir.signatureTechniques.moodKeywords.split(",")[0].trim()}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* 애니메이션 모드 */}
        <div className="space-y-2">
          <Label>영상 스타일</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {animationStyles.map((style) => (
              <button
                key={style.mode}
                className="text-left p-2 rounded-lg transition-all hover:shadow-sm"
                style={
                  animationMode === style.mode
                    ? { background: "#787fff", color: "white", boxShadow: "0 2px 8px #787fff30" }
                    : { background: "white", color: "#333", border: "1px solid #e2e8f0" }
                }
                onClick={() => setAnimationMode(style.mode)}
              >
                <p className="text-[11px] font-semibold leading-tight">{style.label}</p>
                <p className="text-[9px] mt-0.5 leading-snug" style={{ opacity: animationMode === style.mode ? 0.85 : 0.5 }}>
                  {style.desc}
                </p>
              </button>
            ))}
          </div>
          {/* 감독 추천 */}
          {(() => {
            const selected = animationStyles.find((s) => s.mode === animationMode);
            if (!selected) return null;
            return (
              <div className="flex items-start gap-1.5 p-2 rounded-lg" style={{ background: "#f0f0ff", border: "1px solid #787fff15" }}>
                <span className="text-[10px] shrink-0 mt-0.5" style={{ color: "#787fff" }}>추천 감독:</span>
                <div className="flex flex-wrap gap-1">
                  {selected.directors.map((d) => (
                    <Badge
                      key={d}
                      variant="outline"
                      className="text-[9px] py-0 cursor-pointer hover:bg-[#787fff10]"
                      style={{ borderColor: "#787fff40", color: "#5a5ecc" }}
                      onClick={() => {
                        const found = allDirectors.find((dir) => dir.nameKo.includes(d));
                        if (found) {
                          setRegion(found.region);
                          setDirectorPersona(found.id);
                        }
                      }}
                    >
                      {d}
                    </Badge>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* 영상 길이 + 장면 수 + 화면 비율 */}
        <div className="rounded-xl p-4 space-y-4" style={{ background: "#f8f9fc", border: "1px solid #e8e9f0" }}>
          {/* 영상 길이 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold" style={{ color: "#5a5ecc" }}>영상 길이</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {durations.map((d) => (
                <button
                  key={String(d.value)}
                  className="h-8 rounded-lg text-xs font-medium transition-all"
                  style={
                    duration === d.value
                      ? { background: "#787fff", color: "white", boxShadow: "0 2px 8px #787fff30" }
                      : { background: "white", color: "#64748b", border: "1px solid #e2e8f0" }
                  }
                  onClick={() => setDuration(d.value)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t" style={{ borderColor: "#e8e9f0" }} />

          {/* 장면 수 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold" style={{ color: "#5a5ecc" }}>장면 수</Label>
              {isAnalyzing && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="h-2 w-2 animate-spin rounded-full border border-current border-t-transparent" />
                  AI 분석 중...
                </span>
              )}
            </div>

            {/* AI 추천 */}
            {aiCutRecommendation && (
              <button
                className="w-full text-left p-2.5 rounded-lg transition-all hover:shadow-sm"
                style={{ background: "#22c55e0a", border: "1px solid #22c55e25" }}
                onClick={() => setCutCount(aiCutRecommendation.recommendedCuts)}
              >
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white" style={{ background: "#22c55e" }}>
                    AI 추천
                  </span>
                  <span className="text-xs font-bold" style={{ color: "#16a34a" }}>
                    {aiCutRecommendation.recommendedCuts}장면
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">클릭하여 적용</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{aiCutRecommendation.reason}</p>
                {aiCutRecommendation.scenes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {aiCutRecommendation.scenes.slice(0, 4).map((scene, i) => (
                      <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#22c55e10", color: "#16a34a" }}>
                        {scene.slice(0, 18)}{scene.length > 18 ? "..." : ""}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            )}

            <div className="grid grid-cols-4 gap-1.5">
              {([{ value: "auto" as const, label: "자동" }, ...([4, 6, 8, 10, 12, 15, 20] as const).map(n => ({ value: n, label: String(n) }))]).map((item) => (
                <button
                  key={String(item.value)}
                  className="h-8 rounded-lg text-xs font-medium transition-all"
                  style={
                    cutCount === item.value
                      ? { background: "#787fff", color: "white", boxShadow: "0 2px 8px #787fff30" }
                      : { background: "white", color: "#64748b", border: "1px solid #e2e8f0" }
                  }
                  onClick={() => setCutCount(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <input
                type="number"
                min={4}
                max={25}
                placeholder="직접 입력 (4~25)"
                value={typeof cutCount === "number" && ![4, 6, 8, 10, 12, 15, 20].includes(cutCount) ? cutCount : ""}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (v >= 4 && v <= 25) setCutCount(v);
                  else if (e.target.value === "") setCutCount("auto");
                }}
                className="flex h-8 w-full rounded-lg border bg-white px-3 py-1 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#787fff]"
                style={{ borderColor: "#e2e8f0" }}
              />
            </div>
          </div>

          <div className="border-t" style={{ borderColor: "#e8e9f0" }} />

          {/* 화면 비율 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold" style={{ color: "#5a5ecc" }}>화면 비율</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { value: "9:16" as AspectRatio, label: "세로 (쇼츠)", ratio: "aspect-[9/16]" },
                { value: "16:9" as AspectRatio, label: "가로 (유튜브)", ratio: "aspect-[16/9]" },
              ]).map((ar) => (
                <button
                  key={ar.value}
                  className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg text-xs font-medium transition-all"
                  style={
                    aspectRatio === ar.value
                      ? { background: "#787fff", color: "white", boxShadow: "0 2px 8px #787fff30" }
                      : { background: "white", color: "#64748b", border: "1px solid #e2e8f0" }
                  }
                  onClick={() => setAspectRatio(ar.value)}
                >
                  <span
                    className="rounded-sm"
                    style={{
                      width: ar.value === "16:9" ? 28 : 12,
                      height: ar.value === "16:9" ? 16 : 22,
                      border: `1.5px solid ${aspectRatio === ar.value ? "white" : "#94a3b8"}`,
                    }}
                  />
                  <span className="text-[10px] leading-tight text-center">{ar.label}</span>
                </button>
              ))}
            </div>
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
