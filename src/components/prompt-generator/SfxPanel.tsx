"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Cut, SceneSfx, SfxMatch } from "@/types";
import { TRENDING_SFX, SFX_CATEGORIES } from "@/data/trending-sfx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface SfxPanelProps {
  cuts: Cut[];
  sceneSfxList: SceneSfx[];
  onSceneSfxChange: (list: SceneSfx[]) => void;
}

function SfxPlayer({ sfx }: { sfx: SfxMatch }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => setError(true));
      setPlaying(true);
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleEnded = () => setPlaying(false);
    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={toggle}
        disabled={error}
        className="w-6 h-6 rounded-full flex items-center justify-center transition-all text-[10px]"
        style={{
          background: playing ? "#ff6b6b" : "#787fff15",
          color: playing ? "white" : "#787fff",
          border: `1px solid ${playing ? "#ff6b6b" : "#787fff30"}`,
        }}
        title={error ? "재생 불가" : sfx.label}
      >
        {error ? "!" : playing ? "||" : "\u25B6"}
      </button>
      <audio ref={audioRef} src={sfx.audioUrl} preload="none" />
    </div>
  );
}

function SfxBrowser({
  onSelect,
  excludeIds,
}: {
  onSelect: (sfx: SfxMatch) => void;
  excludeIds: string[];
}) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = Object.entries(SFX_CATEGORIES);
  const filtered = activeCategory
    ? TRENDING_SFX.filter(
        (s) => s.category === activeCategory && !excludeIds.includes(s.id)
      )
    : TRENDING_SFX.filter(
        (s) => s.trending && !excludeIds.includes(s.id)
      );

  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap">
        <button
          onClick={() => setActiveCategory(null)}
          className="text-[9px] px-2 py-0.5 rounded-full transition-all"
          style={
            !activeCategory
              ? { background: "#787fff", color: "white" }
              : { background: "#787fff10", color: "#787fff" }
          }
        >
          인기
        </button>
        {categories.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveCategory(key)}
            className="text-[9px] px-2 py-0.5 rounded-full transition-all"
            style={
              activeCategory === key
                ? { background: "#787fff", color: "white" }
                : { background: "#787fff10", color: "#787fff" }
            }
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1 max-h-40 overflow-auto">
        {filtered.map((sfx) => (
          <button
            key={sfx.id}
            onClick={() => onSelect(sfx)}
            className="flex items-center gap-1.5 p-1.5 rounded-md text-left hover:bg-gray-50 transition-colors"
            style={{ border: "1px solid #eee" }}
          >
            <SfxPlayer sfx={sfx} />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium truncate">{sfx.label}</p>
              <p className="text-[9px] text-muted-foreground">
                {sfx.duration}s
                {sfx.trending && (
                  <span style={{ color: "#ff6b6b" }}> HOT</span>
                )}
              </p>
            </div>
            <span
              className="text-[9px] px-1 py-0.5 rounded"
              style={{ background: "#22c55e15", color: "#16a34a" }}
            >
              +
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SfxPanel({
  cuts,
  sceneSfxList,
  onSceneSfxChange,
}: SfxPanelProps) {
  const [matching, setMatching] = useState(false);
  const [expandedCut, setExpandedCut] = useState<number | null>(null);
  const [browsingCut, setBrowsingCut] = useState<number | null>(null);

  // AI 자동 매칭
  const autoMatchAll = useCallback(async () => {
    setMatching(true);
    try {
      const res = await fetch("/api/match-sfx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: cuts.map((c) => ({
            cutNumber: c.cutNumber,
            sceneDescription: c.sceneDescription,
            moodLighting: c.moodLighting,
            cameraDirection: c.cameraDirection,
          })),
        }),
      });

      if (!res.ok) throw new Error("API error");

      const data = await res.json();
      const matches = data.matches || [];

      const newList: SceneSfx[] = matches.map(
        (m: {
          cutNumber: number;
          specificSfx: string[];
          timing: string;
          reason: string;
        }) => {
          const sfxMatches = (m.specificSfx || [])
            .map((id: string) => TRENDING_SFX.find((s) => s.id === id))
            .filter(Boolean) as SfxMatch[];

          return {
            cutNumber: m.cutNumber,
            sfxMatches,
            timing: m.timing || "",
            reason: m.reason || "",
          };
        }
      );

      onSceneSfxChange(newList);
    } catch (error) {
      console.error("SFX matching failed:", error);
    }
    setMatching(false);
  }, [cuts, onSceneSfxChange]);

  // 수동 효과음 추가
  const addSfxToScene = useCallback(
    (cutNumber: number, sfx: SfxMatch) => {
      const updated = [...sceneSfxList];
      const existing = updated.find((s) => s.cutNumber === cutNumber);
      if (existing) {
        if (!existing.sfxMatches.some((m) => m.id === sfx.id)) {
          existing.sfxMatches.push(sfx);
        }
      } else {
        updated.push({
          cutNumber,
          sfxMatches: [sfx],
          reason: "수동 추가",
        });
      }
      onSceneSfxChange(updated);
    },
    [sceneSfxList, onSceneSfxChange]
  );

  // 효과음 제거
  const removeSfxFromScene = useCallback(
    (cutNumber: number, sfxId: string) => {
      const updated = sceneSfxList.map((s) => {
        if (s.cutNumber !== cutNumber) return s;
        return {
          ...s,
          sfxMatches: s.sfxMatches.filter((m) => m.id !== sfxId),
        };
      });
      onSceneSfxChange(updated.filter((s) => s.sfxMatches.length > 0));
    },
    [sceneSfxList, onSceneSfxChange]
  );

  const totalSfxCount = sceneSfxList.reduce(
    (acc, s) => acc + s.sfxMatches.length,
    0
  );

  return (
    <Card
      className="overflow-hidden border-2"
      style={{ borderColor: "#e6443640" }}
    >
      <CardHeader
        className="pb-2"
        style={{
          background: "linear-gradient(135deg, #e6443615, #ff922b15)",
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm" style={{ color: "#e64436" }}>
              효과음 자동 매칭
            </CardTitle>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              장면을 AI가 분석하여 유행하는 효과음을 자동으로 매칭합니다
            </p>
          </div>
          <div className="flex items-center gap-2">
            {totalSfxCount > 0 && (
              <Badge
                className="text-[10px] text-white"
                style={{ background: "#e64436" }}
              >
                {totalSfxCount}개 매칭됨
              </Badge>
            )}
            <Button
              size="sm"
              onClick={autoMatchAll}
              disabled={matching}
              className="text-[11px] text-white"
              style={{ background: "#e64436" }}
            >
              {matching ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  분석 중...
                </span>
              ) : sceneSfxList.length > 0 ? (
                "다시 매칭"
              ) : (
                "AI 자동 매칭"
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 pt-3">
        {sceneSfxList.length === 0 && !matching && (
          <p className="text-[11px] text-muted-foreground text-center py-3">
            &quot;AI 자동 매칭&quot; 버튼을 누르면 각 장면에 어울리는 효과음을
            자동으로 찾아줍니다.
            <br />
            또는 아래에서 직접 효과음을 골라서 장면에 추가할 수 있습니다.
          </p>
        )}

        {/* 장면별 매칭 결과 */}
        {cuts.map((cut) => {
          const sceneSfx = sceneSfxList.find(
            (s) => s.cutNumber === cut.cutNumber
          );
          const isExpanded = expandedCut === cut.cutNumber;
          const isBrowsing = browsingCut === cut.cutNumber;

          return (
            <div
              key={cut.cutNumber}
              className="rounded-lg overflow-hidden"
              style={{
                border: sceneSfx
                  ? "1px solid #e6443620"
                  : "1px dashed #ddd",
                background: sceneSfx ? "#e6443605" : "transparent",
              }}
            >
              {/* 장면 헤더 */}
              <div
                className="flex items-center gap-2 p-2 cursor-pointer"
                onClick={() =>
                  setExpandedCut(isExpanded ? null : cut.cutNumber)
                }
              >
                <Badge
                  className="text-[9px] text-white shrink-0 py-0"
                  style={{
                    background:
                      cut.cutNumber % 2 === 0 ? "#c4b800" : "#787fff",
                  }}
                >
                  CUT {cut.cutNumber}
                </Badge>
                <span className="text-[10px] text-muted-foreground flex-1 truncate">
                  {cut.sceneDescription.slice(0, 50)}...
                </span>

                {/* 매칭된 효과음 미니 뷰 */}
                {sceneSfx && sceneSfx.sfxMatches.length > 0 && (
                  <div className="flex gap-1 shrink-0">
                    {sceneSfx.sfxMatches.map((sfx) => (
                      <Badge
                        key={sfx.id}
                        className="text-[8px] py-0"
                        style={{
                          background: "#e6443615",
                          color: "#e64436",
                        }}
                      >
                        {sfx.label}
                      </Badge>
                    ))}
                  </div>
                )}

                {!sceneSfx && (
                  <span className="text-[9px] text-muted-foreground">
                    효과음 없음
                  </span>
                )}

                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform shrink-0 ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>

              {/* 확장 영역 */}
              {isExpanded && (
                <div className="px-2 pb-2 space-y-2">
                  {/* AI 매칭 이유 */}
                  {sceneSfx?.reason && (
                    <p
                      className="text-[10px] italic px-2 py-1 rounded"
                      style={{
                        background: "#fff8e1",
                        color: "#b37700",
                      }}
                    >
                      AI: {sceneSfx.reason}
                    </p>
                  )}

                  {sceneSfx?.timing && (
                    <p className="text-[10px] text-muted-foreground">
                      타이밍: {sceneSfx.timing}
                    </p>
                  )}

                  {/* 매칭된 효과음 리스트 */}
                  {sceneSfx &&
                    sceneSfx.sfxMatches.map((sfx) => (
                      <div
                        key={sfx.id}
                        className="flex items-center gap-2 p-1.5 rounded-md"
                        style={{
                          background: "#e6443608",
                          border: "1px solid #e6443615",
                        }}
                      >
                        <SfxPlayer sfx={sfx} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-medium">
                            {sfx.label}
                          </p>
                          <p className="text-[9px] text-muted-foreground">
                            {SFX_CATEGORIES[sfx.category]} | {sfx.duration}s
                            {sfx.trending && (
                              <span style={{ color: "#ff6b6b" }}>
                                {" "}
                                TRENDING
                              </span>
                            )}
                          </p>
                        </div>
                        <a
                          href={sfx.audioUrl}
                          download={`${sfx.id}.mp3`}
                          className="text-[9px] px-1.5 py-0.5 rounded"
                          style={{
                            background: "#22c55e15",
                            color: "#16a34a",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          DL
                        </a>
                        <button
                          onClick={() =>
                            removeSfxFromScene(cut.cutNumber, sfx.id)
                          }
                          className="text-[9px] px-1.5 py-0.5 rounded text-red-400 hover:bg-red-50"
                        >
                          제거
                        </button>
                      </div>
                    ))}

                  {/* 수동 추가 토글 */}
                  <button
                    onClick={() =>
                      setBrowsingCut(
                        isBrowsing ? null : cut.cutNumber
                      )
                    }
                    className="text-[10px] px-2 py-1 rounded-md w-full text-left"
                    style={{
                      background: "#787fff08",
                      color: "#787fff",
                      border: "1px dashed #787fff30",
                    }}
                  >
                    {isBrowsing
                      ? "효과음 라이브러리 닫기"
                      : "+ 효과음 직접 추가"}
                  </button>

                  {isBrowsing && (
                    <SfxBrowser
                      onSelect={(sfx) =>
                        addSfxToScene(cut.cutNumber, sfx)
                      }
                      excludeIds={
                        sceneSfx?.sfxMatches.map((m) => m.id) || []
                      }
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
