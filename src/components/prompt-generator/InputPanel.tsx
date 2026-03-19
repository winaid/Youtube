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
import {
  getStyleUiState, getStyleBadgeText, getStyleBadgeColor,
  isStyleSelectable, getStyleCapability,
  getRecommendedStyleIds, sortStylesByTier, getTierDescriptionKo,
  type StyleUiState,
} from "@/lib/style-capability-matrix";
import { DURATION_FALLBACK, DURATION_MIN, DURATION_MAX, safeDuration } from "@/lib/duration-reconciliation";
import { appendRecommendLog, classifyRecommendError, type RecommendLogEntry } from "@/lib/draft-store";
import { estimateProjectDuration, estimateAutoEditPlan } from "@/lib/story-duration-estimator";
import {
  analyzeScriptPhaseA,
  enrichSequenceDetail,
  detectContentType,
  buildAnalysisPrompt,
} from "@/lib/script-analyzer";
import { normalizeAnalysisResult } from "@/lib/normalize";
import type { AnalysisPhase } from "@/types/script-analysis";
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

interface GroundingQualityInfo {
  score: number;
  label: "strong" | "moderate" | "weak" | "none";
  sourceCount: number;
  details: string;
}

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
  grounded?: boolean;
  sources?: Array<{ title?: string; url?: string }>;
  groundingQuality?: GroundingQualityInfo;
}

interface InputPanelProps {
  onGenerate: (input: PromptInput) => void;
  isLoading: boolean;
  prefillScenario?: string;
  onPrefillConsumed?: () => void;
  /** 드래프트/샘플에서 전체 입력 상태를 복원할 때 사용 */
  prefillInput?: PromptInput | null;
  onPrefillInputConsumed?: () => void;
  /** 부모가 소유하는 시퀀스당 초 (0=자동, 3-15=명시) */
  secondsPerScene: number;
  /** 시퀀스당 초 변경 콜백 */
  onSecondsPerSceneChange: (v: number) => void;
  /** 결과가 이미 생성되었는지 여부 — 사전 계획 요약 표시 제어 */
  hasResult?: boolean;
}

const regions: Region[] = ["한국", "일본", "중국", "유럽", "미국", "인도", "중동", "동남아", "중남미", "아프리카", "오세아니아"];

// ─── 카탈로그 기반 스타일 시스템 ───────────────────────────────────

const FAMILY_TABS: { key: StyleFamily | "recommended"; label: string; hint: string }[] = [
  { key: "recommended",   label: "추천",       hint: "가장 안정적인 스타일" },
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

const shortformDurations: { value: Duration; label: string; band: string }[] = [
  { value: 10, label: "10초", band: "base" },
  { value: 12, label: "12초", band: "base" },
  { value: 13, label: "13초", band: "critical" },
  { value: 15, label: "15초", band: "critical" },
  { value: 30, label: "30초", band: "medium" },
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

export default function InputPanel({ onGenerate, isLoading, prefillScenario, onPrefillConsumed, prefillInput, onPrefillInputConsumed, secondsPerScene, onSecondsPerSceneChange, hasResult }: InputPanelProps) {
  const [storyText, setStoryText] = useState("");
  const [directorPersona, setDirectorPersona] = useState("");
  const [region, setRegion] = useState<Region>("한국");
  const [animationMode, setAnimationMode] = useState<AnimationMode>("tv-anime");
  const [styleFamily, setStyleFamily] = useState<StyleFamily | "recommended">("recommended");
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

  // ── 사전 분석 캐시: 입력 시 미리 계산하여 submit 시 즉시 사용 ──
  const analysisHintCacheRef = useRef<{ text: string; depth: string; hint: string | undefined } | null>(null);

  // 감독 추천 캐시: 동일 스토리 텍스트에 대해 API 재호출 방지
  // NOTE: 추천 캐시는 owner-only V0.9/V1 단계에서 비활성화.
  // 추천 버튼은 "조회"가 아니라 "분석"이므로 매 클릭마다 실시간 재분석 수행.
  // 향후 공개 단계에서 재도입 검토 가능.
  // const recommendCacheRef = useRef<{ storyKey: string; result: unknown } | null>(null);

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
  const [recommendError, setRecommendError] = useState<string | null>(null);

  // ── 이어 만들기 (continuity mode) ──
  const [continuityMode, setContinuityMode] = useState(false);

  // ── 분석 깊이 옵션 (바로 생성에 통합) ──
  type AnalysisDepth = "none" | "basic" | "deep";
  const [analysisDepth, setAnalysisDepth] = useState<AnalysisDepth>("basic");
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>("idle");
  const analysisAbortRef = useRef(false);
  const isLongForm = storyText.replace(/\s/g, "").length >= 300;

  // handleAnalyzeThenGenerate 제거됨 — 분석 깊이가 handleSubmit에 통합됨

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

  // 드래프트/샘플 전체 입력 복원
  useEffect(() => {
    if (prefillInput) {
      setStoryText(prefillInput.storyText || "");
      setDirectorPersona(prefillInput.directorPersona || "");
      setRegion(prefillInput.region || "한국");
      setAnimationMode(prefillInput.animationMode || "tv-anime");
      setDuration(prefillInput.duration || "auto");
      setAspectRatio(prefillInput.aspectRatio || "16:9");
      if (prefillInput.cutCount && prefillInput.cutCount > 0) {
        setCutCount(prefillInput.cutCount);
      } else {
        setCutCount("auto");
      }
      if (prefillInput.cutDuration && prefillInput.cutDuration > 0) {
        setCutDuration(prefillInput.cutDuration);
      }
      onPrefillInputConsumed?.();
    }
  }, [prefillInput, onPrefillInputConsumed, setCutDuration]);

  const allDirectors = useMemo(() => [...directors, ...customDirectors], [customDirectors]);
  const filteredDirectors = useMemo(() => allDirectors.filter((d) => d.region === region), [allDirectors, region]);

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

  // 웹 검색 — localResults를 ref로 참조하여 useCallback 안정화
  const localResultsRef = useRef(localResults);
  localResultsRef.current = localResults;

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
      if (data.warnings) {
        console.info("[search-director] warnings:", data.warnings);
      }
      if (data.directors && Array.isArray(data.directors)) {
        const localIds = new Set(localResultsRef.current.map((r) => r.director.id));
        const filtered = data.directors
          .filter((d: WebDirectorResult) => !localIds.has(d.id))
          .map((d: WebDirectorResult) => ({
            ...d,
            grounded: d.grounded ?? false,
            sources: d.sources ?? [],
          }));
        setWebResults(filtered);
        console.info(`[search-director] mode=${data.mode}, results=${filtered.length}, grounded=${filtered.filter((d: WebDirectorResult) => d.grounded).length}`);
      }
    } catch (err) {
      console.error("search-director fetch error:", err);
      setWebResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []); // 안정적 참조 — localResults 변경 시 재생성 불필요

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
    // persona 기본값: 스타일+설명 기반 fallback (Gemini 생성 전까지 사용)
    const fallbackPersona = webDir.description
      ? `${webDir.name} 스타일의 연출. ${webDir.description}`
      : `${webDir.name} (${webDir.style}) 스타일의 시네마틱 연출가`;
    const newDirector: DirectorPersona = {
      id: webDir.id,
      name: webDir.name,
      nameKo: webDir.nameKo,
      region: webDir.region,
      style: webDir.style,
      description: webDir.description,
      persona: fallbackPersona,
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

    // 비동기로 Gemini persona 생성 요청
    fetch("/api/generate-persona", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: webDir.name,
        style: webDir.style,
        description: webDir.description,
        signatureTechniques: webDir.signatureTechniques,
        notableWorks: webDir.notableWorks,
      }),
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.persona) {
          setCustomDirectors((prev) => {
            const updated = prev.map((d) =>
              d.id === webDir.id ? { ...d, persona: data.persona } : d,
            );
            persistCustomDirectors(updated);
            return updated;
          });
        }
      })
      .catch(() => { /* fallback persona 유지 */ });
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

  // ── 사전 분석 캐시 갱신: 입력 변경 시 백그라운드에서 Phase A/B를 미리 계산 ──
  useEffect(() => {
    if (analysisDepth === "none" || storyText.trim().length < 20) {
      analysisHintCacheRef.current = null;
      return;
    }
    const timer = setTimeout(() => {
      try {
        const detectedType = detectContentType(storyText);
        const phaseA = analyzeScriptPhaseA(storyText, { contentTypeHint: detectedType });
        let result = phaseA.result;
        // Phase B: 시퀀스 상세화
        for (let i = 0; i < result.sequences.length; i++) {
          if (result.sequences[i].cuts.length > 0) continue;
          try {
            const enriched = enrichSequenceDetail(
              result.sequences[i], phaseA.sequenceGroups, i, result.sequences.length,
            );
            result = { ...result, sequences: result.sequences.map((s, j) => j === i ? enriched : s) };
          } catch { /* continue */ }
        }
        const hint = result.sequences.length > 0
          ? result.sequences.map((seq, i) =>
              `시퀀스${i + 1}: [${seq.beatType}] ${seq.title} (${seq.recommendedDurationSec}초) — ${seq.sourceText?.slice(0, 80) ?? ""}`
            ).join("\n")
          : undefined;
        analysisHintCacheRef.current = { text: storyText, depth: analysisDepth, hint };
      } catch {
        analysisHintCacheRef.current = null;
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [storyText, analysisDepth]);

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

  // 감독 추천 함수 — owner-only V0.9: 매 클릭마다 실시간 재분석 (no-cache)
  const recommendDirector = useCallback(async () => {
    if (!storyText.trim() || storyText.length < 30 || isRecommending) return;
    setIsRecommending(true);
    setShowRecommendation(true);
    setRecommendError(null);

    const startTime = Date.now();
    const storySnippet = storyText.trim().slice(0, 80);
    const directorPoolSize = allDirectors.length;

    console.log("[recommend-director] recommendation requested", {
      storyLength: storyText.length,
      directorPoolSize,
      cachePolicy: "no-cache (owner-only V0.9)",
    });

    try {
      const localDirectorList = allDirectors.map((d) => ({
        id: d.id,
        name: d.name,
        nameKo: d.nameKo,
        region: d.region,
        style: d.style,
      }));

      console.log("[recommend-director] API invoked — cache bypassed");

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
      setRecommendError(null);

      // 로그: 성공 또는 빈 결과
      const localCount = data.localMatches?.length ?? 0;
      const webCount = data.webSuggestions?.length ?? 0;
      const outcome: RecommendLogEntry["outcome"] = (localCount + webCount > 0) ? "success" : "empty";

      // Pipeline stage summary (5초 안에 병목 파악 가능하게)
      const debug = data._debug;
      if (debug?.stageStatus) {
        console.info("[recommend-director] stage summary", {
          extractSignals: debug.stageStatus.extractSignals,
          localMatch: debug.stageStatus.localMatch,
          webSearch: debug.stageStatus.webSearch,
          finalAssembly: debug.stageStatus.finalAssembly,
          emptyReason: debug.emptyReason ?? null,
          query: debug.webSearchQuery ?? null,
          localCount: debug.localResultCount,
          externalCount: debug.externalResultCount,
          finalCount: debug.finalResultCount,
        });
        // 실패/빈 결과 시 상세 로그
        if (localCount + webCount === 0 && debug.stageReasons) {
          console.warn("[recommend-director] empty result details", {
            stageReasons: debug.stageReasons,
            invalidIdsRemoved: debug.invalidIdsRemoved,
            rejectedLocalIds: debug.rejectedLocalIds,
            localRejectionReasons: debug.localRejectionReasons,
            webSearchResultCount: debug.webSearchResultCount,
            webSearchRejectionReasons: debug.webSearchRejectionReasons,
          });
        }
      } else if (debug) {
        console.log("[recommend-director] pipeline debug:", debug);
      }
      console.log("[recommend-director] result:", {
        outcome,
        resultCount: localCount + webCount,
        localMatches: localCount,
        webSuggestions: webCount,
        latencyMs: Date.now() - startTime,
        emptyReason: debug?.emptyReason ?? null,
        webSearched: debug?.attemptedWebSearch ?? false,
      });

      appendRecommendLog({
        timestamp: Date.now(), storySnippet, storyLength: storyText.length,
        outcome, localMatchCount: localCount, webSuggestionCount: webCount,
        localMatchIds: (data.localMatches ?? []).map((m: { id: string }) => m.id),
        webSuggestionIds: (data.webSuggestions ?? []).map((s: { id: string }) => s.id),
        latencyMs: Date.now() - startTime, modelUsed: data._meta?.modelUsed,
        activeRegion: region, directorPoolSize,
      });
    } catch (err) {
      console.error("[recommend-director] 실패:", err);
      const errorMessage = err instanceof Error ? err.message : "추천 중 오류가 발생했습니다";
      setDirectorRecommendation(null);
      setRecommendError(errorMessage);

      console.log("[recommend-director] result: error", {
        errorMessage,
        latencyMs: Date.now() - startTime,
      });

      // 로그: 에러
      appendRecommendLog({
        timestamp: Date.now(), storySnippet, storyLength: storyText.length,
        outcome: "error", errorMessage, errorCategory: classifyRecommendError(errorMessage),
        localMatchCount: 0, webSuggestionCount: 0,
        localMatchIds: [], webSuggestionIds: [],
        latencyMs: Date.now() - startTime, activeRegion: region, directorPoolSize,
      });
    } finally {
      setIsRecommending(false);
    }
  }, [storyText, allDirectors, isRecommending, region]);

  const handleSubmit = async () => {
    if (!storyText.trim() || !directorPersona) return;
    const selectedDir = allDirectors.find((d) => d.id === directorPersona);
    const blendDir = blendDirector ? allDirectors.find((d) => d.id === blendDirector) : undefined;

    // 블렌딩 정보를 storyText에 메타로 추가 (API 호환 유지)
    let finalStory = storyText;
    if (blendDir && selectedDir) {
      finalStory = `[감독 스타일 블렌딩: ${selectedDir.nameKo} ${blendRatio}% + ${blendDir.nameKo} ${100 - blendRatio}%]\n\n${storyText}`;
    }

    // ── 분석 깊이에 따라 사전 분석 사용 ──
    // basic 모드: 백그라운드 캐시에서 즉시 사용 (submit 차단 없음)
    // deep 모드: Phase C (AI API)만 여기서 실행
    let scriptAnalysisHint: string | undefined;
    if (analysisDepth !== "none" && storyText.trim().length >= 20) {
      // 캐시 히트: 입력 시 미리 계산된 Phase A/B 결과 사용
      const cache = analysisHintCacheRef.current;
      if (cache && cache.text === storyText && cache.depth === analysisDepth) {
        scriptAnalysisHint = cache.hint;
      } else {
        // 캐시 미스: 동기 계산 (첫 submit이거나 입력 직후 바로 클릭한 경우)
        try {
          const detectedType = detectContentType(storyText);
          const phaseA = analyzeScriptPhaseA(storyText, { contentTypeHint: detectedType });
          let result = phaseA.result;
          for (let i = 0; i < result.sequences.length; i++) {
            if (result.sequences[i].cuts.length > 0) continue;
            try {
              const enriched = enrichSequenceDetail(
                result.sequences[i], phaseA.sequenceGroups, i, result.sequences.length,
              );
              result = { ...result, sequences: result.sequences.map((s, j) => j === i ? enriched : s) };
            } catch { /* continue */ }
          }
          if (result.sequences.length > 0) {
            scriptAnalysisHint = result.sequences.map((seq, i) =>
              `시퀀스${i + 1}: [${seq.beatType}] ${seq.title} (${seq.recommendedDurationSec}초) — ${seq.sourceText?.slice(0, 80) ?? ""}`
            ).join("\n");
          }
        } catch { /* proceed without hints */ }
      }

      // Phase C: AI 심층 분석 (deep 모드만 — 이 부분만 네트워크 대기)
      if (analysisDepth === "deep") {
        try {
          analysisAbortRef.current = false;
          setAnalysisPhase("enriching");
          const detectedType = detectContentType(storyText);
          const prompt = buildAnalysisPrompt(storyText, detectedType);
          const res = await fetch("/api/analyze-script", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scriptText: storyText, analysisPrompt: prompt, contentTypeHint: detectedType }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.analysis && !data.incomplete) {
              const llmResult = normalizeAnalysisResult(data.analysis);
              if (llmResult.sequences.length > 0) {
                scriptAnalysisHint = llmResult.sequences.map((seq, i) =>
                  `시퀀스${i + 1}: [${seq.beatType}] ${seq.title} (${seq.recommendedDurationSec}초) — ${seq.sourceText?.slice(0, 80) ?? ""}`
                ).join("\n");
              }
            }
          }
          setAnalysisPhase("idle");
        } catch (e) {
          console.warn("[handleSubmit] Phase C failed:", (e as Error).message);
          setAnalysisPhase("idle");
        }
      }
    }

    // ── preferredCutCountRange 계산 ──
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
      analysisDepth,
    });

    let resolvedRange: CutCountRange | undefined;
    if (editingDensity === "custom") {
      resolvedRange = customCutRange;
    } else if (editingDensity !== "auto") {
      resolvedRange = densityPresetToRange(editingDensity, effectiveTotalSec);
    } else {
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
      scriptAnalysisHint,
      continuityMode: continuityMode || undefined,
    };

    // ── 진단 로그: 최종 payload 요약 ──
    console.info("[InputPanel:handleSubmit] 최종 payload", {
      duration: finalPayload.duration,
      cutCount: finalPayload.cutCount,
      cutDuration: finalPayload.cutDuration,
      preferredCutCountRange: finalPayload.preferredCutCountRange,
      effectiveTotalSec,
      storyTextLength: storyText.length,
      hasAnalysisHint: !!scriptAnalysisHint,
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
          새 영상 만들기
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        {/* 시나리오 / 썰 입력 */}
        <div className="space-y-2">
          <Label htmlFor="story" className="text-xs font-semibold" style={{ color: "#5a5ecc" }}>
            STEP 1. 스토리 입력
          </Label>
          <Textarea
            id="story"
            placeholder="영상으로 만들고 싶은 이야기를 자유롭게 입력하세요"
            value={storyText}
            onChange={(e) => setStoryText(e.target.value)}
            rows={5}
            className="resize-none focus-visible:ring-[#787fff]"
          />
          {/* 예시 입력 바로 시작 */}
          {!storyText.trim() && (
            <div className="space-y-1.5">
              <p className="text-[10px]" style={{ color: "#94a3b8" }}>예시로 바로 시작해 보세요:</p>
              <div className="flex flex-col gap-1">
                {[
                  { label: "역사 다큐", text: "임진왜란 당시 이순신 장군이 명량해협에서 13척의 배로 133척의 왜군 함대를 상대한 전투. 조선 수군의 전략과 이순신의 리더십을 중심으로 긴장감 있는 전투 장면을 재현한다." },
                  { label: "감성 브이로그", text: "비 오는 도쿄의 골목길을 걷는 여행자. 낡은 이자카야에 들어가 따뜻한 라멘 한 그릇을 먹으며 창밖의 네온사인을 바라본다. 혼자만의 시간이 주는 위로를 담는다." },
                ].map((ex) => (
                  <button
                    key={ex.label}
                    onClick={() => setStoryText(ex.text)}
                    className="text-left px-2.5 py-2 rounded-lg text-[11px] transition-all hover:shadow-sm"
                    style={{ background: "#787fff08", border: "1px solid #787fff20", color: "#5a5ecc" }}
                  >
                    <span className="font-semibold">{ex.label}</span>
                    <span className="text-muted-foreground ml-1.5">{ex.text.slice(0, 35)}...</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {storyText.trim() && storyText.trim().length < 30 && (
            <p className="text-[10px] leading-relaxed" style={{ color: "#f59e0b" }}>
              조금만 더 작성해주세요 — AI 감독 추천이 곧 활성화됩니다 ({storyText.trim().length}/30자)
            </p>
          )}
          {storyText.trim().length >= 30 && !directorPersona && (
            <p className="text-[10px] leading-relaxed" style={{ color: "#22c55e" }}>
              좋은 스토리네요! 어울리는 감독을 추천받아보세요.
            </p>
          )}
          {storyText.trim().length >= 30 && directorPersona && (
            <p className="text-[10px] leading-relaxed" style={{ color: "#9ca3af" }}>
              준비 완료! <span style={{ color: "#787fff", fontWeight: 600 }}>장면 설계 시작</span>을 누르면 AI가 컷을 구성합니다.
            </p>
          )}
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
                  시나리오에 맞는 감독을 찾고 있습니다...
                </>
              ) : (
                <>{showRecommendation && (directorRecommendation || recommendError) ? "✨ 감독 다시 추천받기" : "✨ 이 시나리오에 어울리는 감독 AI 추천"}</>
              )}
            </button>

            {/* 추천 에러 상태 */}
            {showRecommendation && !isRecommending && recommendError && (
              <div className="rounded-xl border p-3 space-y-2" style={{ background: "#fef2f2", borderColor: "#fca5a530" }}>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs" style={{ color: "#dc2626" }}>추천 실패</span>
                </div>
                <p className="text-[10px] leading-relaxed" style={{ color: "#991b1b" }}>
                  {recommendError}
                </p>
                <p className="text-[9px]" style={{ color: "#b91c1c" }}>
                  네트워크 연결 또는 API 키를 확인하세요. 버튼을 다시 눌러 재시도할 수 있습니다.
                </p>
                <button
                  onClick={() => { setShowRecommendation(false); setRecommendError(null); }}
                  className="w-full text-[10px] py-1 rounded text-center transition-colors hover:bg-red-50"
                  style={{ color: "#999" }}
                >
                  닫기
                </button>
              </div>
            )}

            {/* 추천 결과 */}
            {showRecommendation && !isRecommending && directorRecommendation && !recommendError && (
              <div className="rounded-xl border p-3 space-y-3" style={{ background: "#fafbff", borderColor: "#787fff30" }}>
                {/* 결과 건수 + 파이프라인 미니 라인 */}
                {(() => {
                  const localCount = directorRecommendation.localMatches.length;
                  const webCount = directorRecommendation.webSuggestions.length;
                  const totalCount = localCount + webCount;
                  const debug = (directorRecommendation as Record<string, unknown>)._debug as Record<string, unknown> | undefined;
                  const genres = (debug?.extractedGenres as string[]) ?? [];
                  const moods = (debug?.extractedMoods as string[]) ?? [];
                  const invalidRemoved = (debug?.invalidIdsRemoved as number) ?? 0;
                  return totalCount > 0 ? (
                    <>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold" style={{ color: "#787fff" }}>
                        {totalCount}명 추천됨
                      </span>
                      {localCount > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#787fff10", color: "#787fff" }}>보유 {localCount}</span>}
                      {webCount > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#22c55e10", color: "#22c55e" }}>웹 검색 {webCount}</span>}
                      {invalidRemoved > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#ef444410", color: "#ef4444" }}>ID필터 -{invalidRemoved}</span>}
                    </div>
                    {(genres.length > 0 || moods.length > 0) && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {genres.map((g, i) => (
                          <span key={`g-${i}`} className="text-[8px] px-1 py-0.5 rounded" style={{ background: "#787fff08", color: "#787fff90" }}>{g}</span>
                        ))}
                        {moods.map((m, i) => (
                          <span key={`m-${i}`} className="text-[8px] px-1 py-0.5 rounded" style={{ background: "#22c55e08", color: "#22c55e90" }}>{m}</span>
                        ))}
                      </div>
                    )}
                    </>
                  ) : null;
                })()}

                {/* 품질 경고 */}
                {(() => {
                  const allScores = [
                    ...directorRecommendation.localMatches.map(m => m.fitScore),
                    ...directorRecommendation.webSuggestions.map(s => s.fitScore),
                  ];
                  const maxScore = allScores.length > 0 ? Math.max(...allScores) : 0;
                  const hasGenericReason = [...directorRecommendation.localMatches, ...directorRecommendation.webSuggestions]
                    .some(m => !m.reason || m.reason === "(이유 미제공)" || m.reason.length < 10);
                  return (maxScore > 0 && maxScore < 60) || hasGenericReason ? (
                    <div className="text-[9px] px-2 py-1 rounded" style={{ background: "#fef3c710", color: "#b45309", border: "1px solid #fbbf2420" }}>
                      {maxScore < 60 && "적합도 점수가 전반적으로 낮습니다. 시나리오를 더 구체적으로 작성하면 매칭 정확도가 올라갑니다."}
                      {hasGenericReason && " 일부 추천 사유가 구체적이지 않습니다."}
                    </div>
                  ) : null;
                })()}

                {/* 분석 요약 */}
                {directorRecommendation.analysis && (
                  <p className="text-[10px] leading-relaxed" style={{ color: "#5a5ecc" }}>
                    {directorRecommendation.analysis}
                  </p>
                )}

                {/* 빈 결과 상태 — 파이프라인 병목 표시 */}
                {directorRecommendation.localMatches.length === 0 && directorRecommendation.webSuggestions.length === 0 && (() => {
                  const debug = (directorRecommendation as Record<string, unknown>)._debug as Record<string, unknown> | undefined;
                  const emptyReason = debug?.emptyReason as string | undefined;
                  const extractedGenres = debug?.extractedGenres as string[] | undefined;
                  const extractedMoods = debug?.extractedMoods as string[] | undefined;
                  const invalidIdsRemoved = debug?.invalidIdsRemoved as number | undefined;

                  const EMPTY_REASON_LABELS: Record<string, { label: string; hint: string }> = {
                    genre_mood_not_detected: {
                      label: "장르나 분위기 신호를 감지하지 못했어요",
                      hint: "분위기나 참고 감독을 조금 더 구체적으로 적어보세요.",
                    },
                    empty_director_pool: {
                      label: "보유 감독 목록이 비어 있어요",
                      hint: "먼저 감독을 추가하거나 다른 지역 탭을 확인해보세요.",
                    },
                    no_local_candidates_considered: {
                      label: "보유 감독 중 적합한 후보를 검토하지 못했어요",
                      hint: "시나리오를 더 구체적으로 작성하면 매칭 정확도가 올라갑니다.",
                    },
                    gemini_returned_empty: {
                      label: "AI가 적합한 감독을 찾지 못했어요",
                      hint: "다른 장르나 배경으로 시도해보세요.",
                    },
                    all_local_ids_hallucinated: {
                      label: "추천 후보는 있었지만 유효하지 않은 데이터라 제외됐어요",
                      hint: "다시 시도해 주세요. 보통 재시도하면 해결됩니다.",
                    },
                    post_validation_eliminated_all: {
                      label: "AI 응답이 검증을 통과하지 못했어요",
                      hint: "다시 시도해 주세요.",
                    },
                    web_search_returned_empty: {
                      label: "웹 검색까지 시도했지만 조건에 맞는 감독을 찾지 못했어요",
                      hint: "시나리오의 장르나 스타일 키워드를 더 구체적으로 적어보세요.",
                    },
                    web_search_failed_and_no_local: {
                      label: "로컬 매칭과 웹 검색 모두 실패했어요",
                      hint: "인터넷 연결을 확인하고 다시 시도해 주세요.",
                    },
                    no_candidates_found: {
                      label: "적합한 감독 후보를 찾지 못했어요",
                      hint: "시나리오를 수정하거나 다시 시도해 주세요.",
                    },
                  };

                  const reasonInfo = emptyReason ? EMPTY_REASON_LABELS[emptyReason] : null;

                  return (
                    <div className="text-center py-3 space-y-2">
                      <p className="text-[11px] font-medium" style={{ color: "#9ca3af" }}>추천 결과 없음</p>

                      {/* 구체적 병목 표시 */}
                      {reasonInfo ? (
                        <div className="rounded px-2 py-1.5 text-left" style={{ background: "#fff7ed", border: "1px solid #fed7aa40" }}>
                          <p className="text-[10px] font-medium" style={{ color: "#c2410c" }}>{reasonInfo.label}</p>
                          <p className="text-[9px] mt-0.5" style={{ color: "#9a3412" }}>{reasonInfo.hint}</p>
                        </div>
                      ) : (
                        <p className="text-[10px]" style={{ color: "#b0b0b0" }}>
                          시나리오를 더 구체적으로 작성하거나, 다른 장르/무드를 시도해보세요.
                        </p>
                      )}

                      {/* 파이프라인 단계별 상태 */}
                      {debug && (
                        <div className="text-[9px] text-left space-y-1 rounded px-2 py-1.5" style={{ background: "#f8fafc", border: "1px solid #e2e8f020" }}>
                          <p className="font-medium" style={{ color: "#94a3b8" }}>파이프라인 추적</p>

                          {/* Stage status 4종 */}
                          {!!(debug as Record<string, unknown>).stageStatus && ((): React.ReactNode => {
                            const ss = (debug as Record<string, unknown>).stageStatus as Record<string, string>;
                            const sr = ((debug as Record<string, unknown>).stageReasons ?? {}) as Record<string, string>;
                            const statusIcon = (s: string) => s === "ok" || s === "attempted_success" ? "✅" : s === "failed" ? "❌" : s.includes("empty") || s === "weak" ? "⚠️" : "⬜";
                            return (
                              <div className="space-y-0.5" style={{ color: "#64748b" }}>
                                <div>{statusIcon(ss.extractSignals)} 신호 추출: {sr.extractSignals || ss.extractSignals}</div>
                                <div>{statusIcon(ss.localMatch)} 로컬 매칭: {sr.localMatch || ss.localMatch}</div>
                                <div>{statusIcon(ss.webSearch)} 웹 검색: {sr.webSearch || ss.webSearch}</div>
                                <div>{statusIcon(ss.finalAssembly)} 최종 조립: {sr.finalAssembly || ss.finalAssembly}</div>
                              </div>
                            );
                          })()}

                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1" style={{ color: "#a0aec0" }}>
                            <span>시나리오 길이</span><span>{storyText.length}자</span>
                            <span>감독 풀</span><span>{allDirectors.length}명</span>
                            {extractedGenres && extractedGenres.length > 0 && (
                              <><span>추출 장르</span><span>{extractedGenres.join(", ")}</span></>
                            )}
                            {extractedMoods && extractedMoods.length > 0 && (
                              <><span>추출 무드</span><span>{extractedMoods.join(", ")}</span></>
                            )}
                            {extractedGenres?.length === 0 && extractedMoods?.length === 0 && (
                              <><span className="col-span-2" style={{ color: "#f59e0b" }}>장르/무드 추출 실패</span></>
                            )}
                            {/* 웹 검색 정보 */}
                            {!!(debug as Record<string, unknown>).attemptedWebSearch && (
                              <>
                                <span>웹 검색</span><span>시도됨</span>
                                {!!(debug as Record<string, unknown>).webSearchQuery && (
                                  <><span>검색 쿼리</span><span className="truncate">{String((debug as Record<string, unknown>).webSearchQuery).slice(0, 40)}</span></>
                                )}
                                <span>검색 결과</span><span>{String((debug as Record<string, unknown>).webSearchResultCount ?? 0)}개</span>
                              </>
                            )}
                            {typeof invalidIdsRemoved === "number" && invalidIdsRemoved > 0 && (
                              <><span style={{ color: "#ef4444" }}>ID 불일치 제거</span><span style={{ color: "#ef4444" }}>{invalidIdsRemoved}명</span></>
                            )}
                            <span>최종 결과</span><span>0명</span>
                          </div>
                        </div>
                      )}

                      {/* debug 없을 때 기본 진단 */}
                      {!debug && (
                        <div className="text-[9px] space-y-0.5" style={{ color: "#c0c0c0" }}>
                          <p>확인 포인트:</p>
                          <p>- 시나리오 길이: {storyText.length}자 (100자 이상 권장)</p>
                          <p>- 감독 풀: {allDirectors.length}명</p>
                          <p>- 장르/배경/감정 키워드가 포함되어 있나요?</p>
                        </div>
                      )}
                    </div>
                  );
                })()}

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
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold" style={{ color: "#22c55e" }}>
                        {directorRecommendation.webSuggestions.some((s: Record<string, unknown>) => s.grounded)
                          ? "웹 검색 기반 추천 감독"
                          : "모델 지식 기반 추천 감독"}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#22c55e10", color: "#22c55e" }}>
                        {directorRecommendation.webSuggestions.length}명
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {directorRecommendation.webSuggestions.map((sug) => {
                        const alreadyAdded = customDirectors.some((d) => d.id === sug.id);
                        const isSelected = directorPersona === sug.id;
                        const gq = (sug as Record<string, unknown>).groundingQuality as GroundingQualityInfo | undefined;
                        const groundingLabel = gq?.label === "strong" ? "높은 신뢰도"
                          : gq?.label === "moderate" ? "보통 신뢰도"
                          : gq?.label === "weak" ? "낮은 신뢰도"
                          : null;
                        const groundingColor = gq?.label === "strong" ? "#16a34a"
                          : gq?.label === "moderate" ? "#ca8a04"
                          : gq?.label === "weak" ? "#dc2626"
                          : "#999";

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
                              <div className="flex items-center gap-1">
                                {/* grounding 품질 라벨 — source 있을 때만 표시 */}
                                {groundingLabel && (
                                  <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: `${groundingColor}10`, color: groundingColor }}>
                                    {groundingLabel}
                                  </span>
                                )}
                                <span
                                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                  style={{ background: sug.fitScore >= 85 ? "#22c55e15" : "#fff78715", color: sug.fitScore >= 85 ? "#16a34a" : "#7a7000" }}
                                >
                                  {sug.fitScore}%
                                </span>
                              </div>
                            </div>
                            <p className="text-[10px]" style={{ color: "#888" }}>{sug.style}</p>
                            <p className="text-[10px] leading-relaxed mt-0.5" style={{ color: "#666" }}>{sug.reason}</p>
                            {/* source 기반 여부 — grounded일 때만 표시 */}
                            {(sug as Record<string, unknown>).grounded && gq && gq.sourceCount > 0 && (
                              <p className="text-[8px] mt-0.5" style={{ color: "#16a34a90" }}>
                                웹 소스 {gq.sourceCount}개 참조 (신뢰도 {gq.score}/100)
                              </p>
                            )}
                            {/* grounded가 아닐 때 정직하게 표시 */}
                            {!(sug as Record<string, unknown>).grounded && (
                              <p className="text-[8px] mt-0.5" style={{ color: "#9ca3af" }}>
                                모델 지식 기반 추천
                              </p>
                            )}
                            {!alreadyAdded && (
                              <p className="text-[9px] mt-1" style={{ color: "#22c55e" }}>+ 클릭하면 자동으로 저장됩니다</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 웹 추천이 0명일 때 — 디버그 정보 표시 */}
                {directorRecommendation.webSuggestions.length === 0 && directorRecommendation.localMatches.length > 0 && (() => {
                  const debug = (directorRecommendation as Record<string, unknown>)._debug as Record<string, unknown> | undefined;
                  if (!debug) return null;
                  return (
                    <div className="text-[9px] px-2 py-1.5 rounded" style={{ background: "#f8fafc", border: "1px solid #e2e8f010", color: "#94a3b8" }}>
                      <p className="font-medium">웹 확장 결과 0명</p>
                      <div className="mt-0.5 space-y-0.5">
                        {debug.attemptedWebSearch ? (
                          <>
                            <p>웹 검색: 시도됨</p>
                            {debug.webSearchQuery && <p>쿼리: {String(debug.webSearchQuery).slice(0, 50)}</p>}
                            <p>원시 결과: {String(debug.webSearchResultCount ?? 0)}명</p>
                            <p>중복 제거: {String(debug.webSearchRejectedCount ?? 0)}명</p>
                            {Array.isArray(debug.webSearchRejectionReasons) && debug.webSearchRejectionReasons.length > 0 && (
                              <p>사유: {(debug.webSearchRejectionReasons as string[]).slice(0, 3).join(", ")}</p>
                            )}
                          </>
                        ) : (
                          <p>웹 검색: 미시도</p>
                        )}
                      </div>
                    </div>
                  );
                })()}

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
          <Label className="text-xs font-semibold" style={{ color: "#5a5ecc" }}>STEP 2. 감독 페르소나 선택</Label>
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
                    {webResults.some(d => d.grounded) ? "웹 검색 기반 결과" : "모델 지식 기반 제안"}
                    <span className="ml-1 text-[9px]" style={{ color: "#999" }}>({webResults.length}명)</span>
                  </div>
                )}
                {webResults.map((webDir) => {
                  const gq = webDir.groundingQuality;
                  return (
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
                        {webDir.grounded ? (
                          <Badge
                            className="text-[10px]"
                            style={{ background: "#22c55e20", color: "#22c55e" }}
                          >
                            웹 근거 {gq ? `(${gq.score})` : ""}
                          </Badge>
                        ) : (
                          <Badge
                            className="text-[10px]"
                            style={{ background: "#787fff20", color: "#787fff" }}
                          >
                            모델 제안
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {webDir.matchedBy} | {webDir.style?.slice(0, 40)}...
                    </p>
                  </button>
                  );
                })}
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
                      ? { background: tab.key === "recommended" ? "#16a34a" : (cat?.color ?? "#787fff"), color: "white", fontWeight: 600 }
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
            {/* ── 추천 스타일 탭 ── */}
            {styleFamily === "recommended" && (() => {
              const recIds = getRecommendedStyleIds();
              const allStyles = STYLE_CATALOG.flatMap(c => c.styles.map(s => ({ style: s, cat: c })));
              const recStyles = recIds
                .map(id => allStyles.find(x => x.style.id === id))
                .filter((x): x is NonNullable<typeof x> => !!x);
              return (
                <div className="space-y-1.5">
                  <p className="text-[10px] px-1" style={{ color: "#787fff" }}>
                    V1에서 가장 안정적인 스타일입니다. 어떤 장면에서도 일관된 품질을 기대할 수 있습니다.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {recStyles.map(({ style: s, cat }) => {
                      const isSelected = animationMode === s.id;
                      return (
                        <button
                          key={s.id}
                          className="text-left p-2.5 rounded-lg transition-all hover:shadow-sm relative"
                          style={
                            isSelected
                              ? { background: cat.color, color: "white", boxShadow: `0 2px 8px ${cat.color}30` }
                              : { background: "white", color: "#333", border: "1px solid #e2e8f0" }
                          }
                          onClick={() => setAnimationMode(s.id)}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: isSelected ? "white" : cat.color }} />
                            <p className="text-[11px] font-semibold leading-tight">{s.nameKo}</p>
                          </div>
                          <p className="text-[9px] leading-snug" style={{ opacity: isSelected ? 0.85 : 0.5 }}>
                            {s.descKo}
                          </p>
                          <div className="flex flex-wrap gap-0.5 mt-1">
                            <span
                              className="inline-block text-[8px] px-1 py-0 rounded leading-tight"
                              style={isSelected ? { background: "rgba(255,255,255,0.25)", color: "white" } : { background: cat.color + "10", color: cat.color }}
                            >{s.badge}</span>
                            <span
                              className="inline-block text-[8px] px-1 py-0 rounded leading-tight font-medium"
                              style={isSelected ? { background: "rgba(255,255,255,0.3)", color: "white" } : { background: "#DCFCE7", color: "#166534" }}
                            >추천</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── 카테고리별 스타일 그리드 ── */}
            {styleFamily !== "recommended" && STYLE_CATALOG
              .filter((cat) => styleFamily === "all" || cat.id === styleFamily)
              .map((cat) => {
                const sortedStyles = sortStylesByTier(cat.styles.map(s => s.id));
                const styles = sortedStyles.map(id => cat.styles.find(s => s.id === id)!);
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

                    {/* 스타일 그리드 (펼침 시) — capability matrix 기반 UI 분기, tier 순 정렬 */}
                    {isExpanded && (
                      <div className="grid grid-cols-2 gap-1 p-1.5 pt-0" style={{ background: "#fafafa" }}>
                        {styles.map((s) => {
                          const isSelected = animationMode === s.id;
                          const uiState = getStyleUiState(s.id);
                          const badgeText = getStyleBadgeText(s.id);
                          const badgeColor = getStyleBadgeColor(s.id);
                          const selectable = isStyleSelectable(s.id);
                          const cap = getStyleCapability(s.id);
                          const isComingSoon = uiState === "coming-soon";
                          const isLowTier = uiState === "labs" || isComingSoon;
                          const isBeta = uiState === "beta";
                          const recIds = getRecommendedStyleIds();
                          const isRec = recIds.includes(s.id);
                          return (
                            <button
                              key={s.id}
                              className="text-left p-2 rounded-lg transition-all hover:shadow-sm relative"
                              style={{
                                ...(isSelected
                                  ? { background: cat.color, color: "white", boxShadow: `0 2px 8px ${cat.color}30` }
                                  : {
                                      background: isLowTier ? "#f9f9f9" : "white",
                                      color: "#333",
                                      border: `1px solid ${isLowTier ? "#e0e0e0" : "#e8e8e8"}`,
                                    }),
                                ...(isComingSoon ? { opacity: 0.5, cursor: "not-allowed" } : {}),
                                ...(isBeta && !isSelected ? { opacity: 0.85 } : {}),
                              }}
                              onClick={() => { if (selectable) setAnimationMode(s.id); }}
                              disabled={!selectable}
                              title={cap.warningKo ?? undefined}
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
                                {isRec && !badgeText && (
                                  <span
                                    className="inline-block text-[8px] px-1 py-0 rounded leading-tight font-medium"
                                    style={
                                      isSelected
                                        ? { background: "rgba(255,255,255,0.3)", color: "white" }
                                        : { background: "#DCFCE7", color: "#166534" }
                                    }
                                  >
                                    추천
                                  </span>
                                )}
                                {badgeText && badgeColor && (
                                  <span
                                    className="inline-block text-[8px] px-1 py-0 rounded leading-tight font-bold"
                                    style={
                                      isSelected
                                        ? { background: "rgba(255,255,255,0.3)", color: "white" }
                                        : { background: badgeColor.bg, color: badgeColor.text }
                                    }
                                  >
                                    {badgeText}
                                  </span>
                                )}
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

          {/* 선택된 스타일 capability 경고 + tier 안내 */}
          {(() => {
            const cap = getStyleCapability(animationMode);
            const tierDesc = getTierDescriptionKo(animationMode);
            const displayText = cap.warningKo || tierDesc;
            if (!displayText) return null;
            const uiState = getStyleUiState(animationMode);
            const badgeText = getStyleBadgeText(animationMode);
            const badgeColor = getStyleBadgeColor(animationMode);
            const warningBg = uiState === "labs" ? "#EDE9FE" : uiState === "beta" ? "#FEF3C7" : uiState === "gated" ? "#DBEAFE" : "#FFF7ED";
            const warningBorder = uiState === "labs" ? "#C4B5FD" : uiState === "beta" ? "#FCD34D" : uiState === "gated" ? "#93C5FD" : "#FDBA74";
            const warningTextColor = uiState === "labs" ? "#5B21B6" : uiState === "beta" ? "#92400E" : uiState === "gated" ? "#1E40AF" : "#9A3412";
            return (
              <div className="flex items-start gap-1.5 p-2 rounded-lg text-[10px]" style={{ background: warningBg, border: `1px solid ${warningBorder}`, color: warningTextColor }}>
                {badgeText && badgeColor && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded font-bold shrink-0" style={{ background: badgeColor.bg, color: badgeColor.text }}>
                    {badgeText}
                  </span>
                )}
                <span>{cap.warningKo ?? tierDesc}</span>
              </div>
            );
          })()}

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

        {/* 세부 설정 (접기 가능) */}
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium py-1.5 px-2 rounded-lg transition-colors hover:bg-gray-50 list-none flex items-center gap-1.5" style={{ color: "#94a3b8" }}>
            <span className="transition-transform group-open:rotate-90" style={{ fontSize: "10px" }}>&#9654;</span>
            세부 설정 (영상 길이 / 컷 수 / 분석 깊이)
          </summary>
        <div className="rounded-xl p-4 space-y-4 mt-2" style={{ background: "#f8f9fc", border: "1px solid #e8e9f0" }}>
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
            {/* 숏폼 검증 프리셋 */}
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-[10px] font-medium shrink-0" style={{ color: "#94a3b8" }}>숏폼</span>
              {shortformDurations.map((d) => (
                <button
                  key={String(d.value)}
                  className="h-6 px-2 rounded text-[10px] font-medium transition-all"
                  style={
                    duration === d.value
                      ? { background: d.band === "critical" ? "#ef4444" : "#787fff", color: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }
                      : { background: "white", color: "#94a3b8", border: "1px solid #e2e8f0" }
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
            const totalMin = Math.floor(plan.totalSec / 60);
            const totalRemSec = plan.totalSec % 60;
            const timeLabel = totalMin > 0
              ? `${totalMin}분 ${totalRemSec > 0 ? totalRemSec + "초" : ""}`
              : `${plan.totalSec}초`;
            return (
              <div className="px-3 py-2 rounded-lg text-[10px] space-y-0.5" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                <p className="font-semibold" style={{ color: "#15803d" }}>
                  예상 구성: {plan.cutCount}장면 × {plan.cutDuration}초 = 약 {timeLabel}
                </p>
                <p style={{ color: "#166534" }}>
                  스토리에 맞춰 장면 수와 길이를 자동으로 구성합니다
                </p>
              </div>
            );
          }

          return null;
        })()}

        {/* 분석 깊이 선택 */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium" style={{ color: "#666" }}>분석 깊이</span>
          {([
            { key: "none" as const, label: "없음", hint: "감독 스타일만" },
            { key: "basic" as const, label: "기본", hint: "구조 분석" },
            { key: "deep" as const, label: "심층", hint: "+AI 분석" },
          ]).map(({ key, label, hint }) => (
            <button
              key={key}
              onClick={() => setAnalysisDepth(key)}
              className="px-2.5 py-1 rounded-full text-[10px] font-medium transition-all"
              style={analysisDepth === key
                ? { background: key === "deep" ? "#e09500" : "#787fff", color: "white" }
                : { background: "#f5f5f5", color: "#888" }
              }
              title={hint}
            >
              {label}
            </button>
          ))}
        </div>

        </details>

        {/* 이어 만들기 토글 */}
        <div className="flex items-center gap-2 px-1">
          <button
            onClick={() => setContinuityMode(!continuityMode)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all"
            style={continuityMode
              ? { background: "#059669", color: "white" }
              : { background: "#f5f5f5", color: "#888" }
            }
            title="여러 클립을 하나의 연속된 영상처럼 만듭니다. 인물/색감/동작/감정선이 클립 사이에서 끊기지 않고 이어집니다."
          >
            {continuityMode ? "이어 만들기 ON" : "이어 만들기"}
          </button>
          {continuityMode && (
            <span className="text-[10px]" style={{ color: "#059669" }}>
              인물/색감/동작이 클립 간 자연스럽게 이어집니다
            </span>
          )}
        </div>

        {/* 생성 버튼 */}
        {(() => {
          const isAnalyzingScript = analysisPhase !== "idle" && analysisPhase !== "complete";
          const isReady = !!(storyText.trim() && directorPersona && !isLoading && !isAnalyzingScript);
          const buttonLabel = isAnalyzingScript
            ? analysisPhase === "structural" ? "장면 구조 분석 중..."
            : analysisPhase === "detailing" ? "컷 상세화 중..."
            : analysisPhase === "enriching" ? "AI 심층 분석 중..."
            : "분석 중..."
            : "장면 설계 시작";

          return (
            <div className="space-y-1.5">
              <Button
                onClick={handleSubmit}
                disabled={!isReady}
                className="w-full text-white font-semibold text-base"
                size="lg"
                style={{
                  background: isReady
                    ? "linear-gradient(135deg, #787fff, #6366f1)"
                    : "#d1d5db",
                  boxShadow: isReady ? "0 4px 20px #787fff50" : "none",
                  height: "48px",
                }}
              >
                {(isLoading || isAnalyzingScript) ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {isAnalyzingScript ? buttonLabel : "장면 설계 중..."}
                  </span>
                ) : buttonLabel}
              </Button>
              {!isReady && !isLoading && !isAnalyzingScript && (
                <p className="text-[10px] text-center" style={{ color: "#94a3b8" }}>
                  {!storyText.trim() ? "어떤 영상을 만들고 싶으세요?" : "감독을 선택하면 바로 시작됩니다"}
                </p>
              )}
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
