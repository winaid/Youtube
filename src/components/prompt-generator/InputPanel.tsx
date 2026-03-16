"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  PromptInput, Region, AnimationMode, Duration, AspectRatio, DirectorPersona, SignatureTechniques,
  GenerationPersona, DEFAULT_GENERATION_PERSONA, StyleFamily,
  EditingDensityPreset, CutCountRange,
  type PromptOutput,
} from "@/types";
import { recommendCutCountRange, densityPresetToRange } from "@/lib/sequence-density";
import { directors, workToDirectorMap } from "@/data/directors";
import { STYLE_CATALOG, getStyleById } from "@/data/style-catalog";
import { DURATION_FALLBACK, DURATION_MIN, DURATION_MAX, safeDuration } from "@/lib/duration-reconciliation";
import { estimateProjectDuration, estimateAutoEditPlan } from "@/lib/story-duration-estimator";
import {
  analyzeScriptPhaseA,
  enrichSequenceDetail,
  convertToCuts,
  detectContentType,
  buildAnalysisPrompt,
} from "@/lib/script-analyzer";
import { normalizeAnalysisResult } from "@/lib/normalize";
import type { ScriptAnalysisResult, AnalysisPhase, PhaseAResult, ScriptContentType } from "@/types/script-analysis";
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
  /** 부모가 소유하는 시퀀스당 초 (0=자동, 3-15=명시) */
  secondsPerScene: number;
  /** 시퀀스당 초 변경 콜백 */
  onSecondsPerSceneChange: (v: number) => void;
  /** 결과가 이미 생성되었는지 여부 — 사전 계획 요약 표시 제어 */
  hasResult?: boolean;
  /** 분석 후 생성 결과를 워크플로우에 적용 */
  onAnalyzeApply?: (output: PromptOutput) => void;
}

const regions: Region[] = ["한국", "일본", "중국", "유럽", "미국", "인도", "중동", "동남아", "중남미", "아프리카", "오세아니아"];

// ─── 카탈로그 기반 스타일 시스템 ───────────────────────────────────

const FAMILY_TABS: { key: StyleFamily; label: string; hint: string }[] = [
  { key: "all",           label: "전체",       hint: "모든 스타일" },
  { key: "live_action",   label: "실사",       hint: "카메라 기반" },
  { key: "animation_2d",  label: "2D 애니",    hint: "셀/수채/잉크" },
  { key: "animation_3d",  label: "3D 애니",    hint: "CGI/픽사" },
  { key: "painting",      label: "회화",       hint: "유화/수묵" },
  { key: "stop_motion",   label: "스톱모션",    hint: "공예/인형" },
  { key: "retro_game",    label: "레트로",      hint: "픽셀/게임" },
  { key: "experimental",  label: "실험",       hint: "혼합/초현실" },
];

// 감독 스타일 분석 → 영상 스타일 추천 (새 카탈로그 id 기반)
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

  // 실사 계열
  let s = 0;
  if (check(/photorealistic|real|live.?action|cinematic|film grain|realism/)) s += 3;
  if (check(/사실|실사|리얼|사회|누아르|범죄|스릴러|드라마|긴장|묵직/)) s += 2;
  if (check(/tracking|handheld|steadicam|dolly|crane|deep focus|long take/)) s += 1;
  if (s > 0) scores.push({ mode: "cinematic-realism", reason: "시네마틱 실사 촬영에 최적", score: s });

  s = 0;
  if (check(/documentary|handheld|observ|vérité|candid/)) s += 3;
  if (check(/다큐|관찰|핸드헬드/)) s += 2;
  if (s > 0) scores.push({ mode: "docu-handheld", reason: "다큐멘터리 핸드헬드", score: s });

  s = 0;
  if (check(/commercial|brand|product|advertising|premium/)) s += 3;
  if (check(/광고|브랜드|프리미엄/)) s += 2;
  if (s > 0) scores.push({ mode: "commercial-ad", reason: "광고 영상 퀄리티", score: s });

  // 2D 계열
  s = 0;
  if (check(/anime|2d|cel.?shad|animation|animated/)) s += 3;
  if (check(/애니|셀|만화|일본|지브리|작화/)) s += 2;
  if (check(/vibrant|colorful|hand.?drawn/)) s += 1;
  if (s > 0) scores.push({ mode: "tv-anime", reason: "셀 애니메이션 스타일", score: s });

  s = 0;
  if (check(/watercolor|pastel|soft|gentle|ghibli/)) s += 3;
  if (check(/수채|파스텔|몽환|서정|자연|따뜻/)) s += 2;
  if (s > 0) scores.push({ mode: "painted-2d", reason: "회화 애니메이션 감성", score: s });

  s = 0;
  if (check(/webtoon|manhwa|korean.*comic/)) s += 3;
  if (check(/웹툰|만화|한국.*만화/)) s += 2;
  if (s > 0) scores.push({ mode: "webtoon-motion", reason: "웹툰 모션 스타일", score: s });

  // 빈티지
  s = 0;
  if (check(/vintage|70s|retro|grain|faded|analog|film stock|old school/)) s += 3;
  if (check(/빈티지|레트로|필름|바랜|클래식|노스탤지|올드/)) s += 2;
  if (s > 0) scores.push({ mode: "vintage-film", reason: "빈티지 필름 그레인 감성", score: s });

  // 네온/사이버펑크
  s = 0;
  if (check(/neon|cyberpunk|futuristic|noir|blade runner|electric/)) s += 3;
  if (check(/네온|사이버|미래|도시|야경|형광|어둠/)) s += 2;
  if (s > 0) scores.push({ mode: "neon-noir", reason: "네온 누아르 도시 감성", score: s });

  // 동양화/수묵
  s = 0;
  if (check(/ink wash|sumi.?e|brush|calligraph|minimalist|zen|oriental/)) s += 3;
  if (check(/수묵|동양|먹|한지|붓|절제|여백|무사|사무라이/)) s += 2;
  if (s > 0) scores.push({ mode: "ink-wash", reason: "수묵 여백과 절제미", score: s });

  // 3D 계열
  s = 0;
  if (check(/pixar|disney|3d.*anim|cg.*anim/)) s += 3;
  if (check(/픽사|디즈니|3D|CG/)) s += 2;
  if (s > 0) scores.push({ mode: "pixar-style", reason: "픽사풍 3D 애니메이션", score: s });

  s = 0;
  if (check(/hybrid|blend|semi.?real|stylized|cgi|vfx/)) s += 3;
  if (check(/혼합|반실사|하이브리드|판타지|대서사/)) s += 2;
  if (s > 0) scores.push({ mode: "semi-real-3d", reason: "반실사 3D 하이브리드", score: s });

  s = 0;
  if (check(/game.*cinematic|unreal|ue5|aaa/i)) s += 3;
  if (check(/게임|시네마틱|언리얼/)) s += 2;
  if (s > 0) scores.push({ mode: "game-cinematic-3d", reason: "게임 시네마틱 퀄리티", score: s });

  // 유화/회화
  s = 0;
  if (check(/oil.*paint|impasto|post.?impressionis/)) s += 3;
  if (check(/유화|인상파|고흐/)) s += 2;
  if (s > 0) scores.push({ mode: "van-gogh-painted", reason: "고흐풍 유화 터치", score: s });

  // 로토스코핑/실험
  s = 0;
  if (check(/rotoscop|dreamlike|surreal|psychedelic|hallucin/)) s += 3;
  if (check(/몽환|초현실|환각|꿈|편집증/)) s += 2;
  if (s > 0) scores.push({ mode: "rotoscoping", reason: "초현실 몽환적 연출", score: s });

  // 스톱모션 계열
  s = 0;
  if (check(/stop.?motion|puppet|handcraft/)) s += 3;
  if (check(/스톱|인형|수작업/)) s += 2;
  if (s > 0) scores.push({ mode: "miniature-diorama", reason: "수작업 스톱모션 감성", score: s });

  s = 0;
  if (check(/clay|plasticine|sculpt|wallace/)) s += 3;
  if (check(/점토|클레이|수제/)) s += 2;
  if (s > 0) scores.push({ mode: "claymation", reason: "점토 캐릭터 질감", score: s });

  // 레트로/게임
  s = 0;
  if (check(/pixel|retro.*game|8.?bit|16.?bit|arcade/)) s += 3;
  if (check(/픽셀|레트로|게임|도트/)) s += 2;
  if (s > 0) scores.push({ mode: "pixel-art", reason: "레트로 게임 픽셀 스타일", score: s });

  // 미니어처
  s = 0;
  if (check(/tilt.?shift|diorama|dollhouse|miniature|symmetr/)) s += 3;
  if (check(/대칭|미니어처|인형의 집|정교/)) s += 2;
  if (s > 0) scores.push({ mode: "miniature-3d", reason: "미니어처 디오라마", score: s });

  // 고딕/호러
  s = 0;
  if (check(/gothic|horror|dark|macabre|grotesque/)) s += 3;
  if (check(/고딕|호러|공포|어둠|그로테스크/)) s += 2;
  if (s > 0) scores.push({ mode: "gothic-horror", reason: "고딕 호러 분위기", score: s });

  // SF
  s = 0;
  if (check(/sci.?fi|futur|space|dystop/)) s += 3;
  if (check(/SF|미래|우주|디스토피아/)) s += 2;
  if (s > 0) scores.push({ mode: "sf-futuristic", reason: "SF 미래도시", score: s });

  scores.sort((a, b) => b.score - a.score);

  // 매칭 없으면 지역 기반 기본 추천
  if (scores.length === 0) {
    const r = director.region;
    if (r === "일본") {
      scores.push({ mode: "tv-anime", reason: "일본 감독 기본 추천", score: 1 });
      scores.push({ mode: "painted-2d", reason: "일본 서정 감성", score: 1 });
      scores.push({ mode: "cinematic-realism", reason: "시네마틱 실사", score: 1 });
    } else {
      scores.push({ mode: "cinematic-realism", reason: "시네마틱 실사 기본", score: 1 });
      scores.push({ mode: "vintage-film", reason: "클래식 필름 감성", score: 1 });
      scores.push({ mode: "semi-real-3d", reason: "반실사 하이브리드", score: 1 });
    }
  }

  return scores.slice(0, 3);
}

const durations: { value: Duration; label: string }[] = [
  { value: "auto", label: "자동" },
  { value: 60, label: "1분" },
  { value: 120, label: "2분" },
  { value: 180, label: "3분" },
  { value: 300, label: "5분" },
];

const CUSTOM_DIRECTORS_KEY = "kling-custom-directors";

function loadCustomDirectors(): DirectorPersona[] {
  if (typeof window === "undefined") return [];
  try {
    // Migration: read old key, write to new key, delete old
    let raw = localStorage.getItem(CUSTOM_DIRECTORS_KEY);
    if (!raw) {
      const oldRaw = localStorage.getItem("veo-custom-directors");
      if (oldRaw) {
        raw = oldRaw;
        localStorage.setItem(CUSTOM_DIRECTORS_KEY, raw);
        localStorage.removeItem("veo-custom-directors");
      }
    }
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

export default function InputPanel({ onGenerate, isLoading, prefillScenario, onPrefillConsumed, secondsPerScene, onSecondsPerSceneChange, hasResult, onAnalyzeApply }: InputPanelProps) {
  const [storyText, setStoryText] = useState("");
  const [directorPersona, setDirectorPersona] = useState("");
  const [region, setRegion] = useState<Region>("한국");
  const [animationMode, setAnimationMode] = useState<AnimationMode>("tv-anime");
  const [styleFamily, setStyleFamily] = useState<StyleFamily>("all");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const generationPersona: GenerationPersona = DEFAULT_GENERATION_PERSONA;
  const [duration, setDuration] = useState<Duration>("auto");
  const [directorSearch, setDirectorSearch] = useState("");
  const [webResults, setWebResults] = useState<WebDirectorResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [customDirectors, setCustomDirectors] = useState<DirectorPersona[]>(loadCustomDirectors);
  const [cutCount, setCutCount] = useState<number | "auto">("auto");
  // cutDuration은 부모(PromptGenerator)가 소유. 여기서는 prop alias만 사용.
  const cutDuration = secondsPerScene;
  const setCutDuration = onSecondsPerSceneChange;
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [editingDensity, setEditingDensity] = useState<EditingDensityPreset>("auto");
  const [customCutRange, setCustomCutRange] = useState<CutCountRange>({ min: 3, max: 5 });
  const [aiCutRecommendation, setAiCutRecommendation] = useState<{
    recommendedCuts: number;
    recommendedDuration: number;
    totalSeconds: number;
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

  // ── 분석 후 생성 (inline script analysis) ──
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>("idle");
  const analysisAbortRef = useRef(false);
  const isLongForm = storyText.replace(/\s/g, "").length >= 300;

  const handleAnalyzeThenGenerate = useCallback(async () => {
    if (!storyText.trim()) return;
    analysisAbortRef.current = false;
    setAnalysisPhase("structural");

    try {
      const detectedType = detectContentType(storyText);
      const phaseA = analyzeScriptPhaseA(storyText, { contentTypeHint: detectedType });

      setAnalysisPhase("detailing");
      let result = phaseA.result;

      // Phase B: progressive sequence detail enrichment
      for (let i = 0; i < result.sequences.length; i++) {
        if (analysisAbortRef.current) break;
        if (result.sequences[i].cuts.length > 0) continue;
        try {
          const enriched = enrichSequenceDetail(
            result.sequences[i],
            phaseA.sequenceGroups,
            i,
            result.sequences.length,
          );
          result = {
            ...result,
            sequences: result.sequences.map((s, j) => j === i ? enriched : s),
          };
        } catch { /* continue */ }
      }

      // Phase C: optional LLM enrichment
      setAnalysisPhase("enriching");
      try {
        const prompt = buildAnalysisPrompt(storyText, detectedType);
        const res = await fetch("/api/analyze-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scriptText: storyText,
            analysisPrompt: prompt,
            contentTypeHint: detectedType,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.analysis) {
            result = normalizeAnalysisResult(data.analysis);
          }
        } else {
          // Log structured error from backend for debugging
          try {
            const errData = await res.json();
            console.warn(`[analyze-script] ${res.status} at stage:${errData.stage ?? "unknown"} — ${errData.error}`, errData.detail ?? "");
          } catch {
            console.warn(`[analyze-script] ${res.status} (no structured error)`);
          }
          // Continue with heuristic result — LLM enrichment is optional
        }
      } catch (fetchErr) {
        console.warn("[analyze-script] Network error, continuing with heuristic:", (fetchErr as Error).message);
      }

      if (analysisAbortRef.current) { setAnalysisPhase("idle"); return; }

      // Convert to PromptOutput and apply
      const cuts = convertToCuts(result);
      const output: PromptOutput = {
        projectTitle: result.thesis || "대본 분석 프로젝트",
        conceptSummary: result.sourceSummary,
        globalStylePrompt: "대본 분석 기반 시퀀스",
        directorPersonaPrompt: "",
        totalCuts: cuts.length,
        characterSeeds: [],
        continuityRules: [],
        cuts,
      };

      setAnalysisPhase("complete");
      if (onAnalyzeApply) {
        onAnalyzeApply(output);
      }
    } catch (err) {
      console.error("[analyze-then-generate]", err);
      setAnalysisPhase("idle");
    }
  }, [storyText, onAnalyzeApply]);

  const analysisAbortRefForCleanup = analysisAbortRef;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { return () => { analysisAbortRefForCleanup.current = true; }; }, []);

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

  // AI 시퀀스 분석 — 영상 길이 지정 시에만 실행 (자동=건너뜀)
  const analyzeStory = useCallback(async (targetDurationSec: number) => {
    if (!storyText.trim() || storyText.length < 20) return;
    console.log("[analyze-cuts] 분석 시작, 텍스트 길이:", storyText.length, "목표 길이:", targetDurationSec);
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/analyze-cuts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyText, targetDuration: targetDurationSec }),
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
      const rawCuts = data.recommendedCuts ?? DURATION_FALLBACK;
      const rawDur  = data.recommendedDuration ?? DURATION_FALLBACK;
      const safeCuts = Math.min(10, Math.max(4, rawCuts));
      const safeDur  = safeDuration(rawDur);
      setAiCutRecommendation({
        recommendedCuts:     safeCuts,
        recommendedDuration: safeDur,
        totalSeconds:        data.totalSeconds ?? safeCuts * safeDur,
        reason:  data.reason ?? "",
        scenes:  data.scenes ?? [],
      });
    } catch (err) {
      console.error("[analyze-cuts] fetch 실패:", err);
      setAiCutRecommendation(null);
    } finally {
      setIsAnalyzing(false);
    }
  }, [storyText]);

  // 영상 길이가 지정된 경우에만 AI 분석 — 자동이면 추천 없음
  useEffect(() => {
    if (duration === "auto") {
      setAiCutRecommendation(null);
      return;
    }
    const targetSec = typeof duration === "number" ? duration : null;
    if (!targetSec || storyText.trim().length < 20) return;
    const timer = setTimeout(() => analyzeStory(targetSec), 1000);
    return () => clearTimeout(timer);
  }, [storyText, duration, analyzeStory]);

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
      if (!res.ok) {
        const errBody = await res.json().catch(() => res.text().then((t: string) => ({ raw: t })));
        console.error("[recommend-director] 서버 에러:", {
          status: res.status,
          ...(typeof errBody === "object" && errBody !== null ? errBody : { raw: String(errBody) }),
        });
        const msg = typeof errBody === "object" && errBody !== null && "error" in errBody
          ? `${(errBody as Record<string, unknown>).code ?? res.status}: ${(errBody as Record<string, unknown>).error}`
          : `API error: ${res.status}`;
        throw new Error(msg);
      }
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

    // ── preferredCutCountRange 계산 ──
    // duration="auto"일 때도 editingDensity가 반드시 payload에 실려야 한다.
    // effectiveTotalSec: 명시 duration > 0이면 그대로, auto이면 스토리 길이 기반 project total 추정.
    // 주의: 이 값은 project total duration이다. current segment cap(15초)과 혼동하지 말 것.
    const totalSec = typeof duration === "number" ? duration : 0;
    const storyEstimate = estimateProjectDuration(storyText);
    const effectiveTotalSec = totalSec > 0
      ? totalSec
      : storyEstimate.estimatedTotalSec;

    // ── 진단 로그: submit 경로 duration 값 추적 ──
    const payloadCutCount = cutCount === "auto"
      ? (aiCutRecommendation?.recommendedCuts ?? undefined)
      : cutCount;
    const payloadCutDuration = cutDuration === 0
      ? (aiCutRecommendation?.recommendedDuration ?? undefined)
      : cutDuration;
    console.info("[InputPanel:handleSubmit] duration 진단", {
      durationState: duration,
      totalSec,
      effectiveTotalSec,
      storyEstimate: {
        estimatedTotalSec: storyEstimate.estimatedTotalSec,
        basis: storyEstimate.basis,
        metrics: storyEstimate.metrics,
      },
      cutDurationSlider: cutDuration,
      cutCountState: cutCount,
      aiCutRecommendation,
      payloadDuration: duration,
      payloadCutDuration,
      payloadCutCount,
      payloadPreferredRange: null as CutCountRange | null, // set below
    });

    let resolvedRange: CutCountRange | undefined;
    if (editingDensity === "custom") {
      resolvedRange = customCutRange;
    } else if (editingDensity !== "auto") {
      resolvedRange = densityPresetToRange(editingDensity, effectiveTotalSec);
    } else {
      // auto 밀도: effectiveTotalSec 기준으로 항상 range 추천
      resolvedRange = recommendCutCountRange(effectiveTotalSec);
    }

    const finalPayload = {
      storyText: finalStory,
      directorPersona,
      region,
      animationMode,
      duration,
      aspectRatio,
      cutCount: cutCount === "auto"
        ? (aiCutRecommendation?.recommendedCuts ?? undefined)
        : cutCount,
      cutDuration: cutDuration === 0
        ? (aiCutRecommendation?.recommendedDuration ?? undefined)
        : cutDuration,
      preferredCutCountRange: resolvedRange,
      customDirector: selectedDir && customDirectors.some((d) => d.id === selectedDir.id)
        ? selectedDir
        : undefined,
      generationPersona,
    };

    // ── 진단 로그: 최종 payload 요약 ──
    console.info("[InputPanel:handleSubmit] 최종 payload", {
      duration: finalPayload.duration,
      cutCount: finalPayload.cutCount,
      cutDuration: finalPayload.cutDuration,
      preferredCutCountRange: finalPayload.preferredCutCountRange,
      effectiveTotalSec,
      storyTextLength: storyText.length,
      warning: duration === "auto" && !finalPayload.cutCount && !finalPayload.cutDuration
        ? "⚠ auto 모드에서 cutCount·cutDuration 모두 undefined — mock-generator fallback 경로 진입"
        : undefined,
    });

    onGenerate(finalPayload);
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
        {/* 시나리오 / 썰 입력 */}
        <div className="space-y-2">
          <Label htmlFor="story">시나리오 / 썰</Label>
          <Textarea
            id="story"
            placeholder="영상으로 만들고 싶은 이야기, 대본, 썰, 설명글을 입력하세요"
            value={storyText}
            onChange={(e) => setStoryText(e.target.value)}
            rows={5}
            className="resize-none focus-visible:ring-[#787fff]"
          />
          <p className="text-[10px] leading-relaxed" style={{ color: "#9ca3af" }}>
            짧은 입력은 바로 시퀀스로 만들고, 긴 대본은 핵심 훅과 컷 구조를 분석해 설계합니다.
          </p>
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
                        {getStyleById(rec.mode)?.nameKo || rec.mode}
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

        {/* 영상 스타일 — 계층형 카탈로그 */}
        <div className="space-y-2">
          <Label>영상 스타일</Label>

          {/* 카테고리 필터 탭 */}
          <div className="flex gap-1 flex-wrap">
            {FAMILY_TABS.map((tab) => {
              const cat = STYLE_CATALOG.find(c => c.id === tab.key);
              return (
                <button
                  key={tab.key}
                  onClick={() => setStyleFamily(tab.key)}
                  className="text-[10px] px-2 py-0.5 rounded-full transition-all"
                  style={
                    styleFamily === tab.key
                      ? { background: cat?.color ?? "#787fff", color: "white", fontWeight: 600 }
                      : { background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0" }
                  }
                  title={tab.hint}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* 카테고리 아코디언 + 스타일 그리드 */}
          <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
            {STYLE_CATALOG
              .filter((cat) => styleFamily === "all" || cat.id === styleFamily)
              .map((cat) => {
                const isExpanded = styleFamily !== "all" || expandedCategory === cat.id;
                const hasSelected = cat.styles.some(s => s.id === animationMode);
                const selectedStyle = cat.styles.find(s => s.id === animationMode);

                return (
                  <div key={cat.id} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${hasSelected ? cat.color + "40" : "#e2e8f0"}` }}>
                    {/* 카테고리 헤더 */}
                    <button
                      className="w-full flex items-center justify-between px-3 py-2 text-left transition-all hover:bg-gray-50"
                      style={{ background: hasSelected ? cat.color + "08" : "white" }}
                      onClick={() => {
                        if (styleFamily === "all") {
                          setExpandedCategory(expandedCategory === cat.id ? null : cat.id);
                        }
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: cat.color }}
                        />
                        <span className="text-xs font-semibold" style={{ color: "#333" }}>
                          {cat.nameKo}
                        </span>
                        <span className="text-[9px]" style={{ color: "#999" }}>
                          {cat.styles.length}개
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {hasSelected && selectedStyle && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: cat.color, color: "white" }}>
                            {selectedStyle.nameKo}
                          </span>
                        )}
                        {styleFamily === "all" && (
                          <span className="text-[10px]" style={{ color: "#bbb" }}>
                            {isExpanded ? "▲" : "▼"}
                          </span>
                        )}
                      </div>
                    </button>

                    {/* 스타일 그리드 (펼침 시) */}
                    {isExpanded && (
                      <div className="grid grid-cols-2 gap-1 p-1.5 pt-0" style={{ background: "#fafafa" }}>
                        {cat.styles.map((s) => {
                          const isSelected = animationMode === s.id;
                          return (
                            <button
                              key={s.id}
                              className="text-left p-2 rounded-lg transition-all hover:shadow-sm"
                              style={
                                isSelected
                                  ? { background: cat.color, color: "white", boxShadow: `0 2px 8px ${cat.color}30` }
                                  : { background: "white", color: "#333", border: "1px solid #e8e8e8" }
                              }
                              onClick={() => setAnimationMode(s.id)}
                            >
                              <p className="text-[11px] font-semibold leading-tight">{s.nameKo}</p>
                              <p className="text-[9px] mt-0.5 leading-snug" style={{ opacity: isSelected ? 0.85 : 0.5 }}>
                                {s.descKo}
                              </p>
                              <div className="flex flex-wrap gap-0.5 mt-1">
                                <span
                                  className="inline-block text-[8px] px-1 py-0 rounded leading-tight"
                                  style={
                                    isSelected
                                      ? { background: "rgba(255,255,255,0.25)", color: "white" }
                                      : { background: cat.color + "10", color: cat.color }
                                  }
                                >
                                  {s.badge}
                                </span>
                                <span
                                  className="inline-block text-[8px] px-1 py-0 rounded leading-tight"
                                  style={
                                    isSelected
                                      ? { background: "rgba(255,255,255,0.15)", color: "white" }
                                      : { background: "#f5f5f5", color: "#999" }
                                  }
                                >
                                  리얼리즘 {s.realism}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {/* 선택된 스타일 추천 감독 */}
          {(() => {
            const selected = getStyleById(animationMode);
            if (!selected || selected.directors.length === 0) return null;
            const cat = STYLE_CATALOG.find(c => c.id === selected.categoryId);
            return (
              <div className="flex items-start gap-1.5 p-2 rounded-lg" style={{ background: (cat?.color ?? "#787fff") + "08", border: `1px solid ${(cat?.color ?? "#787fff")}15` }}>
                <span className="text-[10px] shrink-0 mt-0.5" style={{ color: cat?.color ?? "#787fff" }}>추천 감독:</span>
                <div className="flex flex-wrap gap-1">
                  {selected.directors.map((d) => (
                    <Badge
                      key={d}
                      variant="outline"
                      className="text-[9px] py-0 cursor-pointer hover:opacity-70"
                      style={{ borderColor: (cat?.color ?? "#787fff") + "40", color: cat?.color ?? "#5a5ecc" }}
                      onClick={() => {
                        const found = allDirectors.find((dir) => dir.nameKo.includes(d));
                        if (found) {
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

        {/* 영상 길이 + 시퀀스 수 + 화면 비율 */}
        <div className="rounded-xl p-4 space-y-4" style={{ background: "#f8f9fc", border: "1px solid #e8e9f0" }}>
          {/* 영상 길이 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold" style={{ color: "#5a5ecc" }}>영상 길이</Label>
            <div className="grid grid-cols-5 gap-1.5">
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

          {/* 시퀀스 수 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold" style={{ color: "#5a5ecc" }}>시퀀스 수</Label>
            </div>

            {/* AI 추천 — 영상 길이 지정 시에만 표시 */}
            {duration === "auto" && storyText.trim().length >= 20 && (
              <p className="text-[10px] px-2 py-1.5 rounded-lg" style={{ background: "#f1f5f9", color: "#94a3b8" }}>
                영상 길이를 선택하면 AI가 시퀀스 수와 초를 자동 추천합니다
              </p>
            )}
            {isAnalyzing && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg" style={{ background: "#787fff08", border: "1px solid #787fff20" }}>
                <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" style={{ color: "#787fff" }} />
                <span className="text-[10px]" style={{ color: "#787fff" }}>영상 길이 기준으로 분석 중...</span>
              </div>
            )}
            {aiCutRecommendation && !isAnalyzing && (
              <button
                className="w-full text-left p-2.5 rounded-lg transition-all hover:shadow-sm"
                style={{ background: "#22c55e0a", border: "1px solid #22c55e25" }}
                onClick={() => {
                  setCutCount(aiCutRecommendation.recommendedCuts);
                  setCutDuration(aiCutRecommendation.recommendedDuration);
                }}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white" style={{ background: "#22c55e" }}>
                    AI 추천
                  </span>
                  <span className="text-xs font-bold" style={{ color: "#16a34a" }}>
                    {aiCutRecommendation.recommendedCuts}시퀀스
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: "#dcfce7", color: "#15803d" }}>
                    × {aiCutRecommendation.recommendedDuration}초
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#e0f2fe", color: "#0369a1" }}>
                    = {aiCutRecommendation.totalSeconds}초
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
              {([{ value: "auto" as const, label: "자동" }, ...([6, 10, 15, 20] as const).map(n => ({ value: n, label: String(n) }))]).map((item) => (
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
                max={30}
                placeholder="직접 입력 (4~30)"
                value={typeof cutCount === "number" && ![6, 10, 15, 20].includes(cutCount) ? cutCount : ""}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (v >= 4 && v <= 30) setCutCount(v);
                  else if (e.target.value === "") setCutCount("auto");
                }}
                className="flex h-8 w-full rounded-lg border bg-white px-3 py-1 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#787fff]"
                style={{ borderColor: "#e2e8f0" }}
              />
            </div>
          </div>

          <div className="border-t" style={{ borderColor: "#e8e9f0" }} />

          {/* 시퀀스당 초 (슬라이더) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold" style={{ color: "#5a5ecc" }}>시퀀스당 초</Label>
              <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: cutDuration === 0 ? "#f0f0ff" : "#787fff15", color: cutDuration === 0 ? "#787fff" : "#5a5ecc" }}>
                {cutDuration === 0 ? "자동" : `${cutDuration}초`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={15}
              step={1}
              value={cutDuration}
              onChange={(e) => setCutDuration(Number(e.target.value))}
              className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
              style={{ accentColor: "#787fff" }}
            />
            <div className="flex justify-between text-[9px] text-muted-foreground px-0.5">
              <span>자동</span>
              <span>15초</span>
            </div>
            {/* 프리셋 빠른 버튼 */}
            <div className="flex gap-1">
              {([0, 4, 6, 8, 10, 15] as const).map((sec) => {
                const isKlingOnly = sec >= 10;
                const isSelected = cutDuration === sec;
                return (
                  <button
                    key={sec}
                    className="flex-1 h-6 rounded text-[10px] font-medium transition-all relative"
                    style={
                      isSelected
                        ? { background: "#787fff", color: "white" }
                        : isKlingOnly
                          ? { background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa" }
                          : { background: "white", color: "#94a3b8", border: "1px solid #e2e8f0" }
                    }
                    onClick={() => setCutDuration(sec)}
                  >
                    {sec === 0 ? "자동" : `${sec}`}
                    {isKlingOnly && !isSelected && (
                      <span
                        className="absolute -top-0.5 -right-0.5 text-[6px] px-0.5 rounded leading-tight"
                        style={{ background: "#f97316", color: "white" }}
                      >
                        K
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-[9px] text-muted-foreground">
              {cutDuration === 0
                ? "총 길이와 시퀀스 수를 기준으로 자동 계산"
                : cutDuration >= 1 && cutDuration < DURATION_MIN
                  ? `⚠ 입력: ${cutDuration}초 → 적용: ${DURATION_MIN}초 (최소 허용 길이로 보정)`
                  : cutDuration > DURATION_MAX
                    ? `⚠ 입력: ${cutDuration}초 → 적용: ${DURATION_MAX}초 (최대 허용 길이로 보정)`
                    : cutDuration >= 10
                      ? `⚠ ${cutDuration}초는 Kling 전용 — 각 시퀀스를 ${cutDuration}초 기준으로 생성`
                      : `각 시퀀스를 ${cutDuration}초 기준으로 생성`}
            </p>
            {/* reconciliation 미리보기 */}
            {cutDuration > 0 && cutCount !== "auto" && typeof cutCount === "number" && (
              <p className="text-[9px]" style={{ color: "#b45309" }}>
                {(() => {
                  const applied = Math.min(DURATION_MAX, Math.max(DURATION_MIN, cutDuration));
                  const expectedTotal = applied * cutCount;
                  const durationNum = typeof duration === "number" ? duration : 0;
                  if (durationNum > 0 && Math.abs(expectedTotal - durationNum) > 1) {
                    return `⚠ ${applied}초 × ${cutCount}시퀀스 = ${expectedTotal}초 (목표 ${durationNum}초와 차이 ${Math.abs(expectedTotal - durationNum)}초)`;
                  }
                  return `${applied}초 × ${cutCount}시퀀스 = ${expectedTotal}초`;
                })()}
              </p>
            )}
          </div>

          <div className="border-t" style={{ borderColor: "#e8e9f0" }} />

          {/* 편집 밀도 (컷 수 범위) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold" style={{ color: "#5a5ecc" }}>편집 밀도</Label>
              <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: "#f0f0ff", color: "#787fff" }}>
                {editingDensity === "auto" ? "자동" : editingDensity === "sparse" ? "느린 편집" : editingDensity === "normal" ? "기본" : editingDensity === "dense" ? "빠른 편집" : `${customCutRange.min}~${customCutRange.max}컷`}
              </span>
            </div>
            <div className="flex gap-1">
              {([
                { key: "auto" as EditingDensityPreset, label: "자동" },
                { key: "sparse" as EditingDensityPreset, label: "느린" },
                { key: "normal" as EditingDensityPreset, label: "기본" },
                { key: "dense" as EditingDensityPreset, label: "빠른" },
                { key: "custom" as EditingDensityPreset, label: "직접" },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  className="flex-1 h-6 rounded text-[10px] font-medium transition-all"
                  style={editingDensity === key
                    ? { background: "#787fff", color: "white" }
                    : { background: "white", color: "#94a3b8", border: "1px solid #e2e8f0" }
                  }
                  onClick={() => setEditingDensity(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {editingDensity === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={customCutRange.min}
                  onChange={(e) => setCustomCutRange(prev => ({ ...prev, min: Math.max(1, Math.min(Number(e.target.value), prev.max)) }))}
                  className="h-7 w-14 rounded-md border bg-white px-2 text-xs text-center"
                  style={{ borderColor: "#e2e8f0" }}
                />
                <span className="text-[10px] text-muted-foreground">~</span>
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={customCutRange.max}
                  onChange={(e) => setCustomCutRange(prev => ({ ...prev, max: Math.max(prev.min, Math.min(Number(e.target.value), 15)) }))}
                  className="h-7 w-14 rounded-md border bg-white px-2 text-xs text-center"
                  style={{ borderColor: "#e2e8f0" }}
                />
                <span className="text-[10px] text-muted-foreground">컷</span>
              </div>
            )}
            <p className="text-[9px] text-muted-foreground">
              {editingDensity === "auto"
                ? "영상 길이에 따라 최적 컷 수를 자동 결정"
                : editingDensity === "custom"
                  ? `${customCutRange.min}~${customCutRange.max}컷 범위 내에서 감독 스타일에 맞게 결정`
                  : (() => {
                      const totalSec = typeof duration === "number" ? duration : 15;
                      const range = densityPresetToRange(editingDensity, totalSec);
                      return `${range.min}~${range.max}컷 계획 범위 (${totalSec}초 기준, 생성 시 정확한 값 결정)`;
                    })()}
            </p>
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

        {/* ── payload 상태 요약: auto vs 수동 조합 경고 ── */}
        {(() => {
          const isAutoLen = duration === "auto";
          const isAutoCut = cutCount === "auto";
          const isAutoDur = cutDuration === 0;
          const allAuto = isAutoLen && isAutoCut && isAutoDur;
          const hasManualOverride = isAutoLen && (!isAutoCut || !isAutoDur);

          if (hasManualOverride && storyText.trim().length >= 20) {
            const manualParts: string[] = [];
            if (!isAutoCut && typeof cutCount === "number") manualParts.push(`시퀀스 수: ${cutCount}`);
            if (!isAutoDur) manualParts.push(`시퀀스당 초: ${cutDuration}초`);
            const totalSec = typeof cutCount === "number" && cutDuration > 0
              ? cutCount * Math.min(DURATION_MAX, Math.max(DURATION_MIN, cutDuration))
              : null;
            return (
              <div className="px-3 py-2 rounded-lg text-[10px] space-y-0.5" style={{ background: "#fef3c7", border: "1px solid #fde68a" }}>
                <p className="font-semibold" style={{ color: "#92400e" }}>
                  영상 길이: 자동 / {manualParts.join(", ")}: 수동
                </p>
                {totalSec !== null && (
                  <p style={{ color: "#b45309" }}>
                    실제 생성: {totalSec}초 (auto 추정과 무관하게 수동값 우선 적용)
                  </p>
                )}
              </div>
            );
          }

          if (allAuto && storyText.trim().length >= 20) {
            // 결과가 이미 생성된 경우, 사전 계획 요약은 숨김.
            // 최종 결과(ResultPanel)의 실제 값이 source of truth.
            if (hasResult) return null;

            const plan = estimateAutoEditPlan(storyText);
            return (
              <div className="px-3 py-2 rounded-lg text-[10px] space-y-0.5" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                <p className="font-semibold" style={{ color: "#15803d" }}>
                  생성 계획: 약 {plan.cutCount}시퀀스 × {plan.cutDuration}초 ≈ {plan.totalSec}초
                </p>
                <p style={{ color: "#166534" }}>
                  스토리 기반 추정 · 밀도 보정으로 최종 컷 수가 변경될 수 있음
                </p>
              </div>
            );
          }

          return null;
        })()}

        {/* 생성 버튼 — 항상 두 액션 모두 표시, 입력 길이에 따라 강조만 변경 */}
        {(() => {
          const isAnalyzingScript = analysisPhase !== "idle" && analysisPhase !== "complete";
          const analysisLabel = isAnalyzingScript
            ? analysisPhase === "structural" ? "구조 분석 중..."
            : analysisPhase === "detailing" ? "시퀀스 상세 생성 중..."
            : analysisPhase === "enriching" ? "AI 심층 분석 중..."
            : "분석 중..."
            : "분석 후 생성";

          // isLongForm: >=300 non-whitespace chars → recommend "분석 후 생성"
          // otherwise → recommend "바로 생성"
          const directIsPrimary = !isLongForm;

          return (
            <div className="flex gap-2">
              <Button
                onClick={handleSubmit}
                disabled={!storyText.trim() || !directorPersona || isLoading || isAnalyzingScript}
                className={directIsPrimary ? "flex-1 text-white font-semibold" : "text-sm font-medium flex-shrink-0"}
                size="lg"
                variant={directIsPrimary ? "default" : "outline"}
                style={directIsPrimary
                  ? { background: "linear-gradient(135deg, #787fff, #9b8fff)", boxShadow: "0 4px 14px #787fff40" }
                  : { borderColor: "#787fff60", color: "#787fff" }
                }
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className={`${directIsPrimary ? "h-4 w-4" : "h-3.5 w-3.5"} animate-spin rounded-full border-2 border-current border-t-transparent`} />
                    {directIsPrimary ? "프롬프트 생성 중..." : "생성 중..."}
                  </span>
                ) : "바로 생성"}
              </Button>
              <Button
                onClick={handleAnalyzeThenGenerate}
                disabled={!storyText.trim() || isLoading || isAnalyzingScript}
                className={directIsPrimary ? "text-sm font-medium flex-shrink-0" : "flex-1 text-white font-semibold"}
                size="lg"
                variant={directIsPrimary ? "outline" : "default"}
                style={directIsPrimary
                  ? { borderColor: "#e0950060", color: "#b87700" }
                  : { background: "linear-gradient(135deg, #e09500, #ea580c)", boxShadow: "0 4px 14px #e0950040" }
                }
              >
                {isAnalyzingScript ? (
                  <span className="flex items-center gap-2">
                    <span className={`${directIsPrimary ? "h-3.5 w-3.5" : "h-4 w-4"} animate-spin rounded-full border-2 border-current border-t-transparent`} />
                    {analysisLabel}
                  </span>
                ) : analysisLabel}
              </Button>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
