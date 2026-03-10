"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  PromptInput, Region, AnimationMode, Duration, AspectRatio, DirectorPersona, SignatureTechniques,
  GenerationPersona, DEFAULT_GENERATION_PERSONA, GENERATION_PERSONA_PRESETS,
} from "@/types";
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

// StyleFamily 분류:
//   live_action  — 실사 기반 (카메라, 필름, 빛)
//   animation_2d — 2D 그림 기반 (셀, 수채, 수묵, 픽셀)
//   stop_motion  — 수공예 오브젝트 (클레이, 인형, 미니어처)
//   hybrid       — 실제 움직임 + 스타일 레이어 (로토스코핑, 반실사 혼합)
type StyleFamilyFilter = Exclude<import("../../types").StyleFamily, "all">;

interface AnimationStyleDef {
  mode: AnimationMode;
  label: string;
  desc: string;
  directors: string[];
  family: StyleFamilyFilter;
  badge: string;  // 결과 성향 한줄 요약
  realism: "높음" | "중간" | "낮음";
}

const animationStyles: AnimationStyleDef[] = [
  {
    mode: "실사", label: "실사", desc: "포토리얼, 시네마틱 필름 그레인",
    directors: ["봉준호", "크리스토퍼 놀란", "데이비드 핀처"],
    family: "live_action", badge: "실사 강함", realism: "높음",
  },
  {
    mode: "빈티지 필름", label: "빈티지 필름", desc: "70년대 필름 그레인, 바랜 색감",
    directors: ["쿼틴 타란티노", "왕가위", "알폰소 쿠아론"],
    family: "live_action", badge: "아날로그 필름", realism: "높음",
  },
  {
    mode: "네온 사이버펑크", label: "네온 사이버펑크", desc: "네온, 비 젖은 거리, 홀로그램",
    directors: ["니콜라스 빈딩 레픈", "드니 빌뇌브", "콘 사토시"],
    family: "live_action", badge: "네온 강조", realism: "높음",
  },
  {
    mode: "2D 애니", label: "2D 애니", desc: "셀 애니메이션, 외곽선 기반 작화",
    directors: ["미야자키 하야오", "신카이 마코토", "콘 사토시"],
    family: "animation_2d", badge: "평면 채색", realism: "낮음",
  },
  {
    mode: "수채화 애니", label: "수채화", desc: "번지는 수채 물감 질감, 파스텔 톤",
    directors: ["미야자키 하야오", "임권택"],
    family: "animation_2d", badge: "수채 질감", realism: "낮음",
  },
  {
    mode: "픽셀아트", label: "픽셀아트", desc: "16비트 레트로 게임 감성",
    directors: ["쿼틴 타란티노", "콘 사토시"],
    family: "animation_2d", badge: "레트로 픽셀", realism: "낮음",
  },
  {
    mode: "잉크워시", label: "동양화", desc: "수묵화 붓터치, 먹과 한지 질감",
    directors: ["장이머우", "임권택", "아피찻퐁"],
    family: "animation_2d", badge: "수묵 절제", realism: "낮음",
  },
  {
    mode: "스톱모션", label: "스톱모션", desc: "수공예 소재, 프레임별 촬영",
    directors: ["웨스 앤더슨", "기예르모 델 토로"],
    family: "stop_motion", badge: "수공예 질감", realism: "중간",
  },
  {
    mode: "클레이", label: "클레이", desc: "점토 캐릭터, 손자국 질감",
    directors: ["웨스 앤더슨", "피터 잭슨"],
    family: "stop_motion", badge: "점토 질감", realism: "중간",
  },
  {
    mode: "미니어처", label: "미니어처", desc: "틸트시프트, 소형 디오라마 시점",
    directors: ["웨스 앤더슨", "피터 잭슨"],
    family: "stop_motion", badge: "미니어처 시점", realism: "중간",
  },
  {
    mode: "로토스코핑", label: "로토스코핑", desc: "실제 움직임 기반 2D — 일반 2D 아님",
    directors: ["콘 사토시", "왕가위"],
    family: "hybrid", badge: "실제 움직임+2D", realism: "중간",
  },
  {
    mode: "하이브리드", label: "하이브리드", desc: "실사 배경+스타일 캐릭터 혼합",
    directors: ["이안", "기예르모 델 토로"],
    family: "hybrid", badge: "스타일 유연", realism: "중간",
  },
];

const FAMILY_TABS: { key: import("../../types").StyleFamily; label: string; hint: string }[] = [
  { key: "all",          label: "전체",    hint: "모든 스타일" },
  { key: "live_action",  label: "실사",    hint: "카메라 기반" },
  { key: "animation_2d", label: "2D",      hint: "그림 기반" },
  { key: "stop_motion",  label: "스톱모션", hint: "수공예" },
  { key: "hybrid",       label: "혼합",    hint: "실사+스타일" },
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
];

const CUSTOM_DIRECTORS_KEY = "veo-custom-directors";

function loadCustomDirectors(): DirectorPersona[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_DIRECTORS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistCustomDirectors(dirs: DirectorPersona[]) {
  try {
    localStorage.setItem(CUSTOM_DIRECTORS_KEY, JSON.stringify(dirs));
  } catch { /* storage full */ }
}

export default function InputPanel({ onGenerate, isLoading, prefillScenario, onPrefillConsumed }: InputPanelProps) {
  const [storyText, setStoryText] = useState("");
  const [directorPersona, setDirectorPersona] = useState("");
  const [region, setRegion] = useState<Region>("한국");
  const [animationMode, setAnimationMode] = useState<AnimationMode>("2D 애니");
  const [styleFamily, setStyleFamily] = useState<import("../../types").StyleFamily>("all");
  const [generationPersona, setGenerationPersona] = useState<GenerationPersona>(DEFAULT_GENERATION_PERSONA);
  const [duration, setDuration] = useState<Duration>("auto");
  const [directorSearch, setDirectorSearch] = useState("");
  const [webResults, setWebResults] = useState<WebDirectorResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [customDirectors, setCustomDirectors] = useState<DirectorPersona[]>(loadCustomDirectors);
  const [cutCount, setCutCount] = useState<number | "auto">("auto");
  const [cutDuration, setCutDuration] = useState<number>(8);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [aiCutRecommendation, setAiCutRecommendation] = useState<{
    recommendedCuts: number;
    reason: string;
    scenes: string[];
  } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [blendDirector, setBlendDirector] = useState("");
  const [blendRatio, setBlendRatio] = useState(70); // 메인 감독 비율

  // 감독 추천 상태
  const [directorRecommendation, setDirectorRecommendation] = useState<{
    analysis: string;
    localMatches: { id: string; fitScore: number; reason: string }[];
    webSuggestions: {
      id: string; name: string; nameKo: string; region: Region; style: string;
      description: string; reason: string; fitScore: number;
      signatureTechniques?: SignatureTechniques; notableWorks?: string[];
    }[];
  } | null>(null);
  const [isRecommending, setIsRecommending] = useState(false);
  const [showRecommendation, setShowRecommendation] = useState(false);

  // 시나리오 프리필
  useEffect(() => {
    if (prefillScenario) {
      setStoryText(prefillScenario);
      onPrefillConsumed?.();
      // 시나리오 채팅에서 넘어온 경우 자동으로 감독 추천 표시
      setShowRecommendation(true);
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
      // region은 스토리 배경 설정 — 감독 국가로 덮어쓰지 않음
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
      const updated = [...prev, newDirector];
      persistCustomDirectors(updated);
      return updated;
    });
    // region은 스토리 배경 설정 — 감독 국가로 덮어쓰지 않음
    setDirectorPersona(webDir.id);
    setDirectorSearch("");
    setWebResults([]);
  };

  const handleDeleteCustomDirector = (directorId: string) => {
    setCustomDirectors((prev) => {
      const updated = prev.filter((d) => d.id !== directorId);
      persistCustomDirectors(updated);
      return updated;
    });
    if (directorPersona === directorId) {
      setDirectorPersona("");
    }
  };

  // AI 컷 수 분석
  const analyzeStory = useCallback(async () => {
    if (!storyText.trim() || storyText.length < 20) return;
    console.log("[analyze-cuts] 분석 시작, 텍스트 길이:", storyText.length);
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/analyze-cuts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyText }),
      });
      console.log("[analyze-cuts] 응답:", res.status, res.statusText);
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("[analyze-cuts] 실패:", res.status, errText);
        setAiCutRecommendation(null);
        return;
      }
      const data = await res.json();
      console.log("[analyze-cuts] 결과:", data);
      if (data.error) {
        console.error("[analyze-cuts] API 에러:", data.error, data.detail);
        setAiCutRecommendation(null);
        return;
      }
      setAiCutRecommendation({
        recommendedCuts: data.recommendedCuts ?? 8,
        reason: data.reason ?? "",
        scenes: data.scenes ?? [],
      });
    } catch (err) {
      console.error("[analyze-cuts] fetch 실패:", err);
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

  // 감독 추천 함수
  const recommendDirector = useCallback(async () => {
    if (!storyText.trim() || storyText.length < 30 || isRecommending) return;
    setIsRecommending(true);
    setShowRecommendation(true);
    try {
      const localDirectorList = allDirectors.map((d) => ({
        id: d.id,
        name: d.name,
        nameKo: d.nameKo,
        region: d.region,
        style: d.style,
      }));
      const res = await fetch("/api/recommend-director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyText, localDirectors: localDirectorList }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      setDirectorRecommendation(data);
    } catch (err) {
      console.error("[recommend-director] 실패:", err);
      setDirectorRecommendation(null);
    } finally {
      setIsRecommending(false);
    }
  }, [storyText, allDirectors, isRecommending]);

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
      cutDuration,
      customDirector: selectedDir && customDirectors.some((d) => d.id === selectedDir.id)
        ? selectedDir
        : undefined,
      generationPersona,
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

        {/* AI 감독 추천 버튼 */}
        {storyText.trim().length >= 30 && (
          <div className="space-y-2">
            <button
              onClick={recommendDirector}
              disabled={isRecommending}
              className="w-full py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              style={{
                background: isRecommending
                  ? "#787fff20"
                  : "linear-gradient(135deg, #787fff20, #fff78720)",
                border: "1px solid #787fff40",
                color: "#5a5ecc",
              }}
            >
              {isRecommending ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "#787fff", borderTopColor: "transparent" }} />
                  AI가 시나리오를 분석해 감독을 찾는 중...
                </>
              ) : (
                <>✨ 이 시나리오에 어울리는 감독 AI 추천</>
              )}
            </button>

            {/* 추천 결과 */}
            {showRecommendation && directorRecommendation && (
              <div className="rounded-xl border p-3 space-y-3" style={{ background: "#fafbff", borderColor: "#787fff30" }}>
                {/* 분석 요약 */}
                {directorRecommendation.analysis && (
                  <p className="text-[10px] leading-relaxed" style={{ color: "#5a5ecc" }}>
                    {directorRecommendation.analysis}
                  </p>
                )}

                {/* 로컬 감독 매칭 */}
                {directorRecommendation.localMatches.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold" style={{ color: "#787fff" }}>
                      보유 감독 중 추천
                    </span>
                    <div className="space-y-1.5">
                      {directorRecommendation.localMatches.map((match) => {
                        const dir = allDirectors.find((d) => d.id === match.id);
                        if (!dir) return null;
                        const isSelected = directorPersona === match.id;
                        return (
                          <button
                            key={match.id}
                            onClick={() => setDirectorPersona(match.id)}
                            className="w-full text-left p-2.5 rounded-lg transition-all hover:shadow-sm"
                            style={{
                              background: isSelected ? "#787fff15" : "white",
                              border: `1px solid ${isSelected ? "#787fff" : "#787fff20"}`,
                            }}
                          >
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-xs font-semibold" style={{ color: "#333" }}>
                                {dir.nameKo}
                                {isSelected && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#787fff", color: "white" }}>선택됨</span>}
                              </span>
                              <span
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ background: match.fitScore >= 85 ? "#22c55e15" : "#fff78715", color: match.fitScore >= 85 ? "#16a34a" : "#7a7000" }}
                              >
                                {match.fitScore}%
                              </span>
                            </div>
                            <p className="text-[10px] leading-relaxed" style={{ color: "#666" }}>{match.reason}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 웹 추천 감독 */}
                {directorRecommendation.webSuggestions.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold" style={{ color: "#22c55e" }}>
                      웹 검색 추천 감독 (새로 추가)
                    </span>
                    <div className="space-y-1.5">
                      {directorRecommendation.webSuggestions.map((sug) => {
                        const alreadyAdded = customDirectors.some((d) => d.id === sug.id);
                        const isSelected = directorPersona === sug.id;
                        return (
                          <button
                            key={sug.id}
                            onClick={() => {
                              if (!alreadyAdded) {
                                const newDir = {
                                  id: sug.id,
                                  name: sug.name,
                                  nameKo: sug.nameKo,
                                  region: sug.region,
                                  style: sug.style,
                                  description: sug.description,
                                  persona: "",
                                  signatureTechniques: sug.signatureTechniques,
                                  notableWorks: sug.notableWorks,
                                };
                                setCustomDirectors((prev) => {
                                  if (prev.some((d) => d.id === newDir.id)) return prev;
                                  const updated = [...prev, newDir];
                                  persistCustomDirectors(updated);
                                  return updated;
                                });
                              }
                              setDirectorPersona(sug.id);
                            }}
                            className="w-full text-left p-2.5 rounded-lg transition-all hover:shadow-sm"
                            style={{
                              background: isSelected ? "#22c55e15" : "white",
                              border: `1px solid ${isSelected ? "#22c55e" : "#22c55e30"}`,
                            }}
                          >
                            <div className="flex items-center justify-between mb-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold" style={{ color: "#333" }}>{sug.nameKo}</span>
                                <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "#787fff10", color: "#787fff" }}>{sug.region}</span>
                                {isSelected && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#22c55e", color: "white" }}>선택됨</span>}
                              </div>
                              <span
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ background: sug.fitScore >= 85 ? "#22c55e15" : "#fff78715", color: sug.fitScore >= 85 ? "#16a34a" : "#7a7000" }}
                              >
                                {sug.fitScore}%
                              </span>
                            </div>
                            <p className="text-[10px]" style={{ color: "#888" }}>{sug.style}</p>
                            <p className="text-[10px] leading-relaxed mt-0.5" style={{ color: "#666" }}>{sug.reason}</p>
                            {!alreadyAdded && (
                              <p className="text-[9px] mt-1" style={{ color: "#22c55e" }}>+ 클릭하면 자동으로 저장됩니다</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setShowRecommendation(false)}
                  className="w-full text-[10px] py-1 rounded text-center transition-colors hover:bg-gray-100"
                  style={{ color: "#999" }}
                >
                  접기 ▲
                </button>
              </div>
            )}
          </div>
        )}

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

        {/* 저장된 커스텀 감독 */}
        {customDirectors.length > 0 && (
          <div className="space-y-1.5 p-2.5 rounded-lg" style={{ background: "#787fff08", border: "1px solid #787fff15" }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold" style={{ color: "#787fff" }}>
                저장된 감독 ({customDirectors.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {customDirectors.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] transition-all"
                  style={{
                    background: directorPersona === d.id ? "#787fff" : "white",
                    color: directorPersona === d.id ? "white" : "#5a5ecc",
                    border: `1px solid ${directorPersona === d.id ? "#787fff" : "#787fff30"}`,
                    cursor: "pointer",
                  }}
                >
                  <button
                    className="hover:opacity-80"
                    onClick={() => {
                      // region은 스토리 배경 설정 — 감독 국가로 덮어쓰지 않음
                      setDirectorPersona(d.id);
                    }}
                  >
                    {d.nameKo}
                  </button>
                  <button
                    className="ml-0.5 hover:text-red-400 transition-colors"
                    style={{ opacity: 0.6 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCustomDirector(d.id);
                    }}
                    title="삭제"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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

          {/* 계열 필터 탭 */}
          <div className="flex gap-1 flex-wrap">
            {FAMILY_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStyleFamily(tab.key)}
                className="text-[10px] px-2 py-0.5 rounded-full transition-all"
                style={
                  styleFamily === tab.key
                    ? { background: "#787fff", color: "white", fontWeight: 600 }
                    : { background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0" }
                }
                title={tab.hint}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 스타일 카드 그리드 */}
          <div className="grid grid-cols-3 gap-1.5">
            {animationStyles
              .filter((s) => styleFamily === "all" || s.family === styleFamily)
              .map((style) => {
                const isSelected = animationMode === style.mode;
                return (
                  <button
                    key={style.mode}
                    className="text-left p-2 rounded-lg transition-all hover:shadow-sm relative"
                    style={
                      isSelected
                        ? { background: "#787fff", color: "white", boxShadow: "0 2px 8px #787fff30" }
                        : { background: "white", color: "#333", border: "1px solid #e2e8f0" }
                    }
                    onClick={() => setAnimationMode(style.mode)}
                  >
                    <p className="text-[11px] font-semibold leading-tight">{style.label}</p>
                    <p className="text-[9px] mt-0.5 leading-snug" style={{ opacity: isSelected ? 0.85 : 0.5 }}>
                      {style.desc}
                    </p>
                    {/* 결과 성향 뱃지 */}
                    <span
                      className="inline-block text-[8px] px-1 py-0 rounded mt-1 leading-tight"
                      style={
                        isSelected
                          ? { background: "rgba(255,255,255,0.25)", color: "white" }
                          : { background: "#f0f0ff", color: "#787fff" }
                      }
                    >
                      {style.badge}
                    </span>
                  </button>
                );
              })}
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
                          // region은 스토리 배경 설정 — 감독 국가로 덮어쓰지 않음
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
            <div className="grid grid-cols-4 gap-1.5">
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
              {([{ value: "auto" as const, label: "자동" }, ...([4, 6, 8, 10, 12, 15] as const).map(n => ({ value: n, label: String(n) }))]).map((item) => (
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
                max={15}
                placeholder="직접 입력 (4~15)"
                value={typeof cutCount === "number" && ![4, 6, 8, 10, 12, 15].includes(cutCount) ? cutCount : ""}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (v >= 4 && v <= 15) setCutCount(v);
                  else if (e.target.value === "") setCutCount("auto");
                }}
                className="flex h-8 w-full rounded-lg border bg-white px-3 py-1 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#787fff]"
                style={{ borderColor: "#e2e8f0" }}
              />
            </div>
          </div>

          <div className="border-t" style={{ borderColor: "#e8e9f0" }} />

          {/* 장면당 초 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold" style={{ color: "#5a5ecc" }}>장면당 초</Label>
            <div className="grid grid-cols-5 gap-1.5">
              {([4, 6, 8, 10, 15] as const).map((sec) => {
                const isKlingOnly = sec >= 10;
                return (
                  <button
                    key={sec}
                    className="h-8 rounded-lg text-xs font-medium transition-all relative"
                    style={
                      cutDuration === sec
                        ? { background: "#787fff", color: "white", boxShadow: "0 2px 8px #787fff30" }
                        : isKlingOnly
                          ? { background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa" }
                          : { background: "white", color: "#64748b", border: "1px solid #e2e8f0" }
                    }
                    onClick={() => setCutDuration(sec)}
                    title={isKlingOnly ? "Kling 전용 (Veo 미지원)" : undefined}
                  >
                    {sec}초
                    {isKlingOnly && (
                      <span
                        className="absolute -top-1 -right-1 text-[7px] px-0.5 rounded leading-tight"
                        style={{ background: "#f97316", color: "white" }}
                      >
                        K
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {cutDuration >= 10 && (
              <p className="text-[9px]" style={{ color: "#f97316" }}>
                ⚠ {cutDuration}초는 Kling 전용 — 영상 생성 시 Kling 엔진이 자동 선택됩니다
              </p>
            )}
          </div>

          <div className="border-t" style={{ borderColor: "#e8e9f0" }} />

          {/* 생성 페르소나 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold" style={{ color: "#5a5ecc" }}>생성 규칙 (페르소나)</Label>

            {/* 프리셋 탭 */}
            <div className="flex gap-1 flex-wrap">
              {GENERATION_PERSONA_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setGenerationPersona(preset.preset)}
                  className="text-[10px] px-2 py-0.5 rounded-full transition-all"
                  style={
                    generationPersona.id === preset.id
                      ? { background: "#787fff", color: "white", fontWeight: 600 }
                      : { background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0" }
                  }
                  title={preset.desc}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            {/* 개별 토글 */}
            <div className="grid grid-cols-2 gap-1">
              {([
                { key: "noSubtitles",        label: "자막 금지" },
                { key: "noNarration",        label: "나레이션 금지" },
                { key: "noLecturerChar",     label: "강사 캐릭터 금지" },
                { key: "subjectFirst",       label: "인물 우선 구도" },
                { key: "noBackgroundClutter",label: "배경 장식 억제" },
                { key: "emotionAsAction",    label: "감정→행동 변환" },
                { key: "noRepeatComposition",label: "반복 구도 금지" },
              ] as { key: keyof GenerationPersona; label: string }[]).map(({ key, label }) => {
                if (key === "id" || key === "name") return null;
                const val = generationPersona[key] as boolean;
                return (
                  <button
                    key={key}
                    onClick={() => setGenerationPersona(prev => ({ ...prev, id: "custom", name: "커스텀", [key]: !val }))}
                    className="text-left text-[9px] px-1.5 py-1 rounded transition-all flex items-center gap-1"
                    style={
                      val
                        ? { background: "#ede9fe", color: "#7c3aed", border: "1px solid #c4b5fd" }
                        : { background: "#f8fafc", color: "#94a3b8", border: "1px solid #e2e8f0" }
                    }
                  >
                    <span>{val ? "✓" : "○"}</span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t" style={{ borderColor: "#e8e9f0" }} />

          {/* 화면 비율 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold" style={{ color: "#5a5ecc" }}>화면 비율</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { value: "16:9" as AspectRatio, label: "가로 (유튜브)", ratio: "aspect-[16/9]" },
                { value: "9:16" as AspectRatio, label: "세로 (쇼츠)", ratio: "aspect-[9/16]" },
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
