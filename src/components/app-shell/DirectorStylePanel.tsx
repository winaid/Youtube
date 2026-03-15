"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type { DirectorPersona, SignatureTechniques, Region } from "@/types";
import { directors, workToDirectorMap } from "@/data/directors";
import { extractEditorialPersona, buildCompactEditorialSummary } from "@/lib/editorial-persona";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

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

interface DirectorRecommendation {
  analysis: string;
  localMatches: { directorId: string; fitScore: number; reason: string }[];
  webSuggestions: WebDirectorResult[];
}

interface DirectorStylePanelProps {
  storyText: string;
  selectedDirectorId: string;
  onDirectorChange: (directorId: string, customDirector?: DirectorPersona) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

const CUSTOM_DIRECTORS_KEY = "kling-custom-directors";

function loadCustomDirectors(): DirectorPersona[] {
  try {
    const raw = localStorage.getItem(CUSTOM_DIRECTORS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomDirectors(list: DirectorPersona[]) {
  localStorage.setItem(CUSTOM_DIRECTORS_KEY, JSON.stringify(list));
}

function findDirector(id: string): DirectorPersona | undefined {
  return directors.find(d => d.id === id) || loadCustomDirectors().find(d => d.id === id);
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function DirectorStylePanel({
  storyText,
  selectedDirectorId,
  onDirectorChange,
}: DirectorStylePanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [webResults, setWebResults] = useState<WebDirectorResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recommendation, setRecommendation] = useState<DirectorRecommendation | null>(null);
  const [isRecommending, setIsRecommending] = useState(false);
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [customDirectors, setCustomDirectors] = useState<DirectorPersona[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    setCustomDirectors(loadCustomDirectors());
  }, []);

  const selectedDirector = useMemo(() => findDirector(selectedDirectorId), [selectedDirectorId]);

  const editorialPersona = useMemo(() => {
    if (!selectedDirector) return null;
    return extractEditorialPersona(
      selectedDirector.persona,
      selectedDirector.style,
      selectedDirector.signatureTechniques?.editingStyle,
    );
  }, [selectedDirector]);

  const editorialSummary = useMemo(() => {
    if (!editorialPersona) return null;
    return buildCompactEditorialSummary(editorialPersona);
  }, [editorialPersona]);

  // ── Local search ──
  const localSearchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();

    const workMatch = Object.entries(workToDirectorMap)
      .filter(([work]) => work.toLowerCase().includes(q))
      .map(([work, dirId]) => ({ dirId, matchedBy: `작품: ${work}` }));

    const nameMatch = directors
      .filter(d =>
        d.name.toLowerCase().includes(q) ||
        d.nameKo.includes(q) ||
        d.style.toLowerCase().includes(q)
      )
      .map(d => ({ dirId: d.id, matchedBy: `이름/스타일` }));

    const merged = new Map<string, string>();
    for (const { dirId, matchedBy } of [...workMatch, ...nameMatch]) {
      if (!merged.has(dirId)) merged.set(dirId, matchedBy);
    }
    return Array.from(merged.entries())
      .map(([dirId, matchedBy]) => ({ director: directors.find(d => d.id === dirId)!, matchedBy }))
      .filter(r => r.director)
      .slice(0, 6);
  }, [searchQuery]);

  // ── Web search ──
  const handleWebSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch("/api/search-director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery }),
      });
      if (res.ok) {
        const data = await res.json();
        setWebResults(data.directors ?? []);
      }
    } catch { /* ignore */ }
    setIsSearching(false);
  }, [searchQuery]);

  // ── AI recommendation ──
  const handleRecommend = useCallback(async () => {
    if (!storyText.trim()) return;
    setIsRecommending(true);
    setShowRecommendation(true);
    try {
      const localDirectors = directors.map(d => ({
        id: d.id, name: d.name, nameKo: d.nameKo, style: d.style,
      }));
      const res = await fetch("/api/recommend-director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyText, localDirectors }),
      });
      if (res.ok) {
        const data = await res.json();
        setRecommendation(data);
      }
    } catch { /* ignore */ }
    setIsRecommending(false);
  }, [storyText]);

  const handleSelectWebDirector = useCallback((wd: WebDirectorResult) => {
    const custom: DirectorPersona = {
      id: wd.id,
      name: wd.name,
      nameKo: wd.nameKo,
      region: wd.region,
      style: wd.style,
      description: wd.description,
      persona: wd.description,
      signatureTechniques: wd.signatureTechniques,
      notableWorks: wd.notableWorks,
    };
    const updated = [...customDirectors.filter(d => d.id !== custom.id), custom];
    setCustomDirectors(updated);
    saveCustomDirectors(updated);
    onDirectorChange(custom.id, custom);
    setShowSearch(false);
    setSearchQuery("");
    setWebResults([]);
  }, [customDirectors, onDirectorChange]);

  const allDirectors = useMemo(() => [...directors, ...customDirectors], [customDirectors]);

  const regionGroups = useMemo(() => {
    const groups: Record<string, DirectorPersona[]> = {};
    for (const d of allDirectors) {
      (groups[d.region] ??= []).push(d);
    }
    return groups;
  }, [allDirectors]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#f59e0b" }}>2</span>
          스타일 디렉션
        </CardTitle>
        <p className="text-[11px] mt-1" style={{ color: "#888" }}>
          감독/페르소나 스타일이 세그먼트의 시네마틱 리듬, 샷 디자인, 시각 언어를 결정합니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Director Select ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs">감독 / 페르소나</Label>
            <Select value={selectedDirectorId} onValueChange={id => onDirectorChange(id)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="감독 선택..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="neutral">기본 (중립)</SelectItem>
                {Object.entries(regionGroups).map(([region, dirs]) => (
                  dirs.map(d => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="flex items-center gap-1.5">
                        <span className="text-[10px]" style={{ color: "#999" }}>{region}</span>
                        <span>{d.nameKo}</span>
                        <span className="text-[10px]" style={{ color: "#bbb" }}>{d.style.slice(0, 20)}</span>
                      </span>
                    </SelectItem>
                  ))
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quick actions */}
          <div className="flex flex-col gap-1.5 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={handleRecommend}
              disabled={!storyText.trim() || isRecommending}
            >
              {isRecommending ? "분석 중..." : "스크립트 기반 감독 추천"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => setShowSearch(!showSearch)}
            >
              {showSearch ? "검색 닫기" : "감독 검색 (이름/작품/스타일)"}
            </Button>
          </div>
        </div>

        {/* ── Director Search ── */}
        {showSearch && (
          <div className="p-3 rounded-lg border space-y-2" style={{ background: "#fafafa" }}>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleWebSearch()}
                placeholder="감독 이름, 영화 제목, 스타일 키워드..."
                className="flex-1 h-8 px-2 text-xs border rounded"
              />
              <Button size="sm" variant="outline" className="text-xs h-8" onClick={handleWebSearch} disabled={isSearching}>
                {isSearching ? "검색 중..." : "웹 검색"}
              </Button>
            </div>

            {/* Local results */}
            {localSearchResults.length > 0 && (
              <div className="space-y-1">
                {localSearchResults.map(({ director, matchedBy }) => (
                  <button
                    key={director.id}
                    onClick={() => { onDirectorChange(director.id); setShowSearch(false); setSearchQuery(""); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-gray-100 transition-colors"
                  >
                    <span className="font-medium">{director.nameKo}</span>
                    <span style={{ color: "#999" }}>{director.style.slice(0, 30)}</span>
                    <span className="ml-auto text-[10px]" style={{ color: "#bbb" }}>{matchedBy}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Web results */}
            {webResults.length > 0 && (
              <div className="space-y-1 border-t pt-2">
                <p className="text-[10px] font-medium" style={{ color: "#999" }}>웹 검색 결과</p>
                {webResults.map(wd => (
                  <button
                    key={wd.id}
                    onClick={() => handleSelectWebDirector(wd)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-gray-100 transition-colors"
                  >
                    <span className="font-medium">{wd.nameKo || wd.name}</span>
                    <span style={{ color: "#999" }}>{wd.style.slice(0, 30)}</span>
                    <Badge variant="outline" className="text-[9px] ml-auto">+추가</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── AI Recommendation ── */}
        {showRecommendation && recommendation && (
          <div className="p-3 rounded-lg border space-y-2" style={{ background: "#f8f9ff", borderColor: "#787fff30" }}>
            <p className="text-xs font-medium" style={{ color: "#555" }}>AI 분석 결과</p>
            <p className="text-[11px]" style={{ color: "#666" }}>{recommendation.analysis}</p>

            {recommendation.localMatches.length > 0 && (
              <div className="space-y-1">
                {recommendation.localMatches.map(match => {
                  const dir = findDirector(match.directorId);
                  if (!dir) return null;
                  return (
                    <button
                      key={match.directorId}
                      onClick={() => onDirectorChange(match.directorId)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white transition-colors"
                    >
                      <span className="font-bold" style={{ color: "#787fff" }}>{match.fitScore}점</span>
                      <span className="font-medium">{dir.nameKo}</span>
                      <span className="text-[10px] flex-1" style={{ color: "#999" }}>{match.reason}</span>
                      {selectedDirectorId === match.directorId && (
                        <Badge className="text-[9px]" style={{ background: "#787fff20", color: "#787fff" }}>선택됨</Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {recommendation.webSuggestions.length > 0 && (
              <div className="space-y-1 border-t pt-2">
                <p className="text-[10px]" style={{ color: "#999" }}>추가 추천 (웹)</p>
                {recommendation.webSuggestions.map(wd => (
                  <button
                    key={wd.id}
                    onClick={() => handleSelectWebDirector(wd)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white transition-colors"
                  >
                    <span className="font-medium">{wd.nameKo || wd.name}</span>
                    <span style={{ color: "#999" }}>{wd.style.slice(0, 30)}</span>
                    <Badge variant="outline" className="text-[9px] ml-auto">+추가 & 선택</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Selected Director Preview ── */}
        {selectedDirector && selectedDirectorId !== "neutral" && (
          <div className="p-3 rounded-lg border" style={{ background: "#fafafa" }}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-xs font-bold">{selectedDirector.nameKo}</p>
                <p className="text-[10px]" style={{ color: "#999" }}>{selectedDirector.style}</p>
              </div>
              <Badge variant="outline" className="text-[9px]">{selectedDirector.region}</Badge>
            </div>

            {selectedDirector.signatureTechniques && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] mb-2" style={{ color: "#666" }}>
                {selectedDirector.signatureTechniques.cameraWork && (
                  <div><span style={{ color: "#999" }}>카메라:</span> {selectedDirector.signatureTechniques.cameraWork}</div>
                )}
                {selectedDirector.signatureTechniques.colorPalette && (
                  <div><span style={{ color: "#999" }}>색감:</span> {selectedDirector.signatureTechniques.colorPalette}</div>
                )}
                {selectedDirector.signatureTechniques.lighting && (
                  <div><span style={{ color: "#999" }}>조명:</span> {selectedDirector.signatureTechniques.lighting}</div>
                )}
                {selectedDirector.signatureTechniques.editingStyle && (
                  <div><span style={{ color: "#999" }}>편집:</span> {selectedDirector.signatureTechniques.editingStyle}</div>
                )}
              </div>
            )}

            {/* Editorial Persona Summary */}
            {editorialSummary && (
              <div className="pt-2 border-t">
                <p className="text-[10px] font-medium mb-1" style={{ color: "#787fff" }}>편집 스타일 영향</p>
                <p className="text-[10px]" style={{ color: "#666" }}>{editorialSummary}</p>
                {editorialPersona && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <Badge variant="outline" className="text-[9px]">컷 페이스: {editorialPersona.preferredCutPace[0]}-{editorialPersona.preferredCutPace[1]}s</Badge>
                    <Badge variant="outline" className="text-[9px]">커버리지: {editorialPersona.preferredCoverage}</Badge>
                    <Badge variant="outline" className="text-[9px]">모션: {editorialPersona.motionBias}</Badge>
                    <Badge variant="outline" className="text-[9px]">전환: {editorialPersona.transitionBias}</Badge>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
