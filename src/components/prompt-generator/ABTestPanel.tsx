"use client";

import { useState } from "react";
import { Cut, CharacterSeed } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ABVariant {
  id: string;
  label: string;
  directorName: string;
  cuts: Cut[];
  characterSeeds: CharacterSeed[];
  thumbnailBase64?: string;
  predictedCTR?: number;
}

interface ABTestPanelProps {
  currentCuts: Cut[];
  currentCharacterSeeds: CharacterSeed[];
  currentDirectorName: string;
  storyText: string;
  onGenerateVariant: (directorId: string) => Promise<{ cuts: Cut[]; characterSeeds: CharacterSeed[] } | null>;
  onSelectWinner: (cuts: Cut[], characterSeeds: CharacterSeed[]) => void;
}

export default function ABTestPanel({
  currentCuts,
  currentCharacterSeeds,
  currentDirectorName,
  storyText,
  onGenerateVariant,
  onSelectWinner,
}: ABTestPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [variants, setVariants] = useState<ABVariant[]>([]);
  const [generating, setGenerating] = useState(false);
  const [selectedDirector, setSelectedDirector] = useState("");

  const alternateDirectors = [
    { id: "wong-kar-wai", name: "왕가위" },
    { id: "bong-joon-ho", name: "봉준호" },
    { id: "park-chan-wook", name: "박찬욱" },
    { id: "wes-anderson", name: "웨스 앤더슨" },
    { id: "david-fincher", name: "데이비드 핀처" },
    { id: "christopher-nolan", name: "크리스토퍼 놀란" },
    { id: "hayao-miyazaki", name: "미야자키 하야오" },
    { id: "quentin-tarantino", name: "쿠엔틴 타란티노" },
  ];

  const handleGenerate = async () => {
    if (!selectedDirector) return;
    setGenerating(true);
    try {
      const result = await onGenerateVariant(selectedDirector);
      if (result) {
        const director = alternateDirectors.find((d) => d.id === selectedDirector);
        const variant: ABVariant = {
          id: `variant-${Date.now()}`,
          label: `B: ${director?.name || selectedDirector}`,
          directorName: director?.name || selectedDirector,
          cuts: result.cuts,
          characterSeeds: result.characterSeeds,
        };
        setVariants((prev) => [...prev, variant]);

        // 예측 CTR 요청
        try {
          const ctrRes = await fetch("/api/predict-engagement", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectTitle: "A/B Test",
              conceptSummary: storyText.slice(0, 200),
              scenes: result.cuts.map((c) => ({ sceneDescription: c.sceneDescription })),
              totalDuration: result.cuts.length * 8,
            }),
          });
          if (ctrRes.ok) {
            const pred = await ctrRes.json();
            setVariants((prev) => prev.map((v) =>
              v.id === variant.id ? { ...v, predictedCTR: pred.engagementRate } : v
            ));
          }
        } catch { /* optional */ }
      }
    } catch {
      alert("대안 생성 실패");
    }
    setGenerating(false);
  };

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#f97316 40" }}>
      <CardHeader
        className="pb-2 cursor-pointer"
        style={{ background: "linear-gradient(135deg, #f9731615, #ef444415)" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm" style={{ color: "#f97316" }}>
            A/B 테스트
          </CardTitle>
          <div className="flex items-center gap-2">
            {variants.length > 0 && (
              <Badge className="text-[10px] text-white" style={{ background: "#f97316" }}>
                {variants.length + 1}개 버전
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3 pt-3">
          <p className="text-[10px] text-muted-foreground">
            같은 스토리를 다른 감독 스타일로 생성하여 비교합니다. AI가 클릭률을 예측합니다.
          </p>

          {/* 대안 감독 선택 */}
          <div className="flex gap-2">
            <select
              value={selectedDirector}
              onChange={(e) => setSelectedDirector(e.target.value)}
              className="flex-1 h-8 rounded-md border text-xs px-2"
            >
              <option value="">대안 감독 선택...</option>
              {alternateDirectors.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <Button
              size="sm"
              className="text-xs text-white"
              style={{ background: "#f97316" }}
              onClick={handleGenerate}
              disabled={!selectedDirector || generating}
            >
              {generating ? "생성 중..." : "대안 생성"}
            </Button>
          </div>

          {/* 비교 */}
          <div className="space-y-2">
            {/* 현재 버전 (A) */}
            <div className="p-2.5 rounded-lg" style={{ background: "#787fff08", border: "2px solid #787fff30" }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Badge className="text-[10px] text-white" style={{ background: "#787fff" }}>A</Badge>
                  <span className="text-xs font-medium">{currentDirectorName}</span>
                </div>
                <span className="text-[10px] text-muted-foreground">{currentCuts.length}장면</span>
              </div>
              <div className="flex gap-1 overflow-x-auto py-1">
                {currentCuts.slice(0, 6).map((cut) => (
                  <div key={cut.cutNumber} className="shrink-0 w-16 p-1 rounded text-[8px]" style={{ background: "#fff" }}>
                    <span style={{ color: "#787fff" }}>CUT{cut.cutNumber}</span>
                    <p className="truncate text-muted-foreground">{cut.sceneDescription}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* 변형들 (B, C, ...) */}
            {variants.map((variant) => (
              <div key={variant.id} className="p-2.5 rounded-lg" style={{ background: "#f9731608", border: "1px solid #f9731630" }}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Badge className="text-[10px] text-white" style={{ background: "#f97316" }}>{variant.label.split(":")[0]}</Badge>
                    <span className="text-xs font-medium">{variant.directorName}</span>
                    {variant.predictedCTR !== undefined && (
                      <Badge variant="outline" className="text-[9px]" style={{ borderColor: "#22c55e", color: "#22c55e" }}>
                        예상 참여율: {(variant.predictedCTR * 100).toFixed(1)}%
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[10px] h-5"
                    style={{ borderColor: "#f97316", color: "#f97316" }}
                    onClick={() => onSelectWinner(variant.cuts, variant.characterSeeds)}
                  >
                    이 버전 선택
                  </Button>
                </div>
                <div className="flex gap-1 overflow-x-auto py-1">
                  {variant.cuts.slice(0, 6).map((cut) => (
                    <div key={cut.cutNumber} className="shrink-0 w-16 p-1 rounded text-[8px]" style={{ background: "#fff" }}>
                      <span style={{ color: "#f97316" }}>CUT{cut.cutNumber}</span>
                      <p className="truncate text-muted-foreground">{cut.sceneDescription}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
