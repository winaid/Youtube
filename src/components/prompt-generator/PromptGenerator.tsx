"use client";

import { useState, useCallback, useEffect } from "react";
import { PromptInput, PromptOutput, GeneratorStatus } from "@/types";
import { generatePrompt } from "@/lib/mock-generator";
import {
  getAnalyticsSummary,
  getProjectRecords,
  saveProjectRecord,
  updateProjectMetrics,
  deleteProjectRecord,
  ProjectRecord,
  AnalyticsSummary,
} from "@/lib/analytics";
import InputPanel from "./InputPanel";
import ResultPanel from "./ResultPanel";
import StoryChat from "./StoryChat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function PromptGenerator() {
  const [result, setResult] = useState<PromptOutput | null>(null);
  const [status, setStatus] = useState<GeneratorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"prompt" | "story" | "dashboard">("prompt");
  const [prefillScenario, setPrefillScenario] = useState<string>("");

  // A/B 테스트
  const [abResult, setAbResult] = useState<PromptOutput | null>(null);
  const [abStatus, setAbStatus] = useState<GeneratorStatus>("idle");
  const [abMode, setAbMode] = useState(false);

  // 대시보드
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [records, setRecords] = useState<ProjectRecord[]>([]);
  const [editingMetrics, setEditingMetrics] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === "dashboard") {
      setSummary(getAnalyticsSummary());
      setRecords(getProjectRecords());
    }
  }, [activeTab]);

  const handleGenerate = async (input: PromptInput) => {
    setStatus("loading");
    setError(null);

    try {
      const output = await generatePrompt(input);
      setResult(output);
      setStatus("success");

      // 프로젝트 기록 저장
      saveProjectRecord({
        title: output.projectTitle,
        directorStyle: input.directorPersona,
        directorName: output.projectTitle.split("의 시선")[0] || input.directorPersona,
        region: input.region,
        animationMode: input.animationMode,
        cutCount: output.totalCuts,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "프롬프트 생성에 실패했습니다.");
      setStatus("error");
    }
  };

  // A/B 생성 (두 번째 결과)
  const handleGenerateAB = async (input: PromptInput) => {
    setAbStatus("loading");
    try {
      const output = await generatePrompt(input);
      setAbResult(output);
      setAbStatus("success");
    } catch {
      setAbStatus("error");
    }
  };

  const handleUseAsScenario = useCallback((scenarioText: string) => {
    setPrefillScenario(scenarioText);
    setActiveTab("prompt");
  }, []);

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6 space-y-4">
      {/* 탭 전환 */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveTab("prompt")}
          className="px-4 py-2 rounded-full text-sm font-medium transition-all"
          style={
            activeTab === "prompt"
              ? { background: "#787fff", color: "white", boxShadow: "0 2px 8px #787fff40" }
              : { background: "#787fff15", color: "#787fff" }
          }
        >
          장면 프롬프트 생성
        </button>
        <button
          onClick={() => setActiveTab("story")}
          className="px-4 py-2 rounded-full text-sm font-medium transition-all"
          style={
            activeTab === "story"
              ? { background: "linear-gradient(135deg, #c4b800, #787fff)", color: "white", boxShadow: "0 2px 8px #fff78740" }
              : { background: "#fff78725", color: "#7a7000" }
          }
        >
          시나리오 AI 생성
        </button>
        <button
          onClick={() => setActiveTab("dashboard")}
          className="px-4 py-2 rounded-full text-sm font-medium transition-all"
          style={
            activeTab === "dashboard"
              ? { background: "#22c55e", color: "white", boxShadow: "0 2px 8px #22c55e40" }
              : { background: "#22c55e15", color: "#16a34a" }
          }
        >
          성과 대시보드
        </button>
      </div>

      {activeTab === "prompt" ? (
        <>
          {/* A/B 토글 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAbMode(!abMode)}
              className="text-[11px] px-3 py-1 rounded-full transition-all"
              style={
                abMode
                  ? { background: "#7c3aed", color: "white" }
                  : { background: "#7c3aed15", color: "#7c3aed", border: "1px solid #7c3aed30" }
              }
            >
              A/B 비교 모드 {abMode ? "ON" : "OFF"}
            </button>
            {abMode && (
              <span className="text-[10px] text-muted-foreground">
                동일 시나리오를 다른 감독 스타일로 동시 생성하여 비교합니다
              </span>
            )}
          </div>

          <div className={abMode ? "grid grid-cols-1 xl:grid-cols-2 gap-6" : ""}>
            {/* 메인 결과 */}
            <div className={abMode ? "" : "grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6"}>
              {!abMode && (
                <div className="lg:sticky lg:top-6 lg:self-start">
                  <InputPanel
                    onGenerate={handleGenerate}
                    isLoading={status === "loading"}
                    prefillScenario={prefillScenario}
                    onPrefillConsumed={() => setPrefillScenario("")}
                  />
                </div>
              )}
              {abMode && (
                <div>
                  <Badge className="mb-2 text-xs" style={{ background: "#787fff" }}>A 버전</Badge>
                  <InputPanel
                    onGenerate={handleGenerate}
                    isLoading={status === "loading"}
                    prefillScenario={prefillScenario}
                    onPrefillConsumed={() => setPrefillScenario("")}
                  />
                </div>
              )}
              <div className="min-w-0">
                {!abMode && (
                  <ResultPanel result={result} status={status} error={error} onUpdateResult={setResult} />
                )}
                {abMode && result && (
                  <ResultPanel result={result} status={status} error={error} onUpdateResult={setResult} />
                )}
              </div>
            </div>

            {/* A/B 두 번째 결과 */}
            {abMode && (
              <div>
                <Badge className="mb-2 text-xs" style={{ background: "#7c3aed" }}>B 버전</Badge>
                <InputPanel
                  onGenerate={handleGenerateAB}
                  isLoading={abStatus === "loading"}
                  prefillScenario={prefillScenario}
                  onPrefillConsumed={() => {}}
                />
                {abResult && (
                  <div className="mt-4">
                    <ResultPanel result={abResult} status={abStatus} error={null} onUpdateResult={setAbResult} />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      ) : activeTab === "story" ? (
        <StoryChat onUseAsScenario={handleUseAsScenario} />
      ) : (
        /* 성과 대시보드 */
        <div className="space-y-4">
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold" style={{ color: "#787fff" }}>{summary.totalProjects}</p>
                  <p className="text-xs text-muted-foreground">총 프로젝트</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold" style={{ color: "#22c55e" }}>
                    {summary.bestPerforming[0]?.views?.toLocaleString() || "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">최고 조회수</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-lg font-bold" style={{ color: "#e09900" }}>
                    {summary.topDirectors[0]?.name || "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">가장 많이 사용한 감독</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-lg font-bold" style={{ color: "#7c3aed" }}>
                    {summary.topRegions[0]?.region || "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">인기 지역</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* 감독별 통계 */}
          {summary && summary.topDirectors.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm" style={{ color: "#787fff" }}>감독 스타일 통계</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {summary.topDirectors.map((d) => (
                    <div key={d.name} className="flex items-center justify-between p-2 rounded-lg" style={{ background: "#787fff08" }}>
                      <span className="text-xs font-medium">{d.name}</span>
                      <div className="flex gap-2">
                        <Badge variant="outline" className="text-[10px]">{d.count}회</Badge>
                        {d.avgViews > 0 && (
                          <Badge className="text-[10px]" style={{ background: "#22c55e15", color: "#16a34a" }}>
                            평균 {d.avgViews.toLocaleString()}뷰
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 프로젝트 목록 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: "#22c55e" }}>프로젝트 기록</CardTitle>
              <p className="text-[10px] text-muted-foreground">조회수/좋아요를 입력하면 성과를 트래킹할 수 있습니다</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {records.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">아직 프로젝트가 없습니다</p>
              ) : (
                records.slice(0, 20).map((r) => (
                  <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg group hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{r.title}</p>
                      <div className="flex gap-1 mt-0.5">
                        <Badge variant="outline" className="text-[9px]">{r.region}</Badge>
                        <Badge variant="outline" className="text-[9px]">{r.cutCount}장면</Badge>
                        <span className="text-[9px] text-muted-foreground">
                          {new Date(r.createdAt).toLocaleDateString("ko-KR")}
                        </span>
                      </div>
                    </div>
                    {editingMetrics === r.id ? (
                      <form
                        className="flex gap-1 items-center"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          updateProjectMetrics(r.id, {
                            views: Number(fd.get("views")) || 0,
                            likes: Number(fd.get("likes")) || 0,
                          });
                          setEditingMetrics(null);
                          setRecords(getProjectRecords());
                          setSummary(getAnalyticsSummary());
                        }}
                      >
                        <input name="views" type="number" placeholder="조회수" defaultValue={r.views || ""} className="w-16 h-6 text-[10px] border rounded px-1" />
                        <input name="likes" type="number" placeholder="좋아요" defaultValue={r.likes || ""} className="w-14 h-6 text-[10px] border rounded px-1" />
                        <Button type="submit" size="sm" className="h-6 text-[10px]" style={{ background: "#22c55e", color: "white" }}>저장</Button>
                      </form>
                    ) : (
                      <div className="flex gap-1 items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        {r.views !== undefined && (
                          <Badge className="text-[9px]" style={{ background: "#22c55e15", color: "#16a34a" }}>
                            {r.views.toLocaleString()}뷰
                          </Badge>
                        )}
                        <button
                          onClick={() => setEditingMetrics(r.id)}
                          className="text-[9px] px-1.5 py-0.5 rounded"
                          style={{ background: "#787fff10", color: "#787fff" }}
                        >
                          성과 입력
                        </button>
                        <button
                          onClick={() => {
                            deleteProjectRecord(r.id);
                            setRecords(getProjectRecords());
                            setSummary(getAnalyticsSummary());
                          }}
                          className="text-[9px] px-1.5 py-0.5 rounded text-red-400 hover:bg-red-50"
                        >
                          삭제
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
