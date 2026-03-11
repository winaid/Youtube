"use client";

import { Cut, CharacterSeed, VideoClip } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface VideoGenerationPanelProps {
  cuts: Cut[];
  characterSeeds: CharacterSeed[];
  clips: VideoClip[];
  isAutoMode: boolean;
  progress: number;
  completedCount: number;
  totalCount: number;
  onGenerateCut: (cutNumber: number) => void;
  onStartAuto: () => void;
  onStopAuto: () => void;
  onResetClip: (cutNumber: number) => void;
  onAddCut?: (cutNumber: number) => void;
  onSelectVariant: (cutNumber: number, variantIndex: number) => void;
}

function ElapsedTime({ startedAt }: { startedAt?: number }) {
  if (!startedAt) return null;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return (
    <span className="text-[10px] text-muted-foreground">
      {min > 0 ? `${min}분 ` : ""}{sec}초
    </span>
  );
}

function StatusBadge({ status }: { status: VideoClip["status"] }) {
  const cfg = {
    idle: { bg: "#e5e5e5", color: "#666", label: "대기" },
    generating: { bg: "#787fff30", color: "#787fff", label: "요청 중..." },
    polling: { bg: "#f59e0b30", color: "#d97706", label: "생성 중..." },
    completed: { bg: "#22c55e20", color: "#16a34a", label: "완료" },
    failed: { bg: "#ef444420", color: "#dc2626", label: "실패" },
  }[status];

  return (
    <Badge className="text-[10px]" style={{ background: cfg.bg, color: cfg.color }}>
      {(status === "generating" || status === "polling") && (
        <span className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent mr-1" />
      )}
      {cfg.label}
    </Badge>
  );
}

export default function VideoGenerationPanel({
  cuts,
  characterSeeds,
  clips,
  isAutoMode,
  progress,
  completedCount,
  totalCount,
  onGenerateCut,
  onStartAuto,
  onStopAuto,
  onResetClip,
  onAddCut,
  onSelectVariant,
}: VideoGenerationPanelProps) {

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#22c55e40" }}>
      <CardHeader className="pb-3" style={{ background: "linear-gradient(135deg, #22c55e15, #787fff10)" }}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base" style={{ color: "#16a34a" }}>
            Veo 3.1 영상 생성
          </CardTitle>
          <Badge variant="outline" className="text-xs" style={{ borderColor: "#22c55e" }}>
            {completedCount}/{totalCount} 완료
          </Badge>
        </div>

        {totalCount > 0 && (
          <div className="mt-2">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "#e5e5e5" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, #22c55e, #787fff)",
                }}
              />
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3 pt-4">
        {/* 전체 생성 / 중단 */}
        <div className="flex gap-2">
          {!isAutoMode ? (
            <Button
              size="sm"
              onClick={onStartAuto}
              className="text-white"
              disabled={completedCount === totalCount}
              style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
            >
              전체 자동 생성
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={onStopAuto}>
              자동 생성 중단
            </Button>
          )}
          {isAutoMode && (
            <span className="flex items-center text-xs text-muted-foreground gap-1">
              <span className="h-2 w-2 rounded-full animate-pulse bg-green-500" />
              자동 생성 진행 중...
            </span>
          )}
        </div>

        {/* 장면별 상태 */}
        <div className="space-y-2">
          {cuts.map((cut, i) => {
            const clip = clips.find((c) => c.cutNumber === cut.cutNumber);
            if (!clip) return null;

            const prevClip = clips.find((c) => c.cutNumber === cut.cutNumber - 1);
            const canGenerate =
              clip.status === "idle" &&
              (cut.cutNumber === 1 || prevClip?.status === "completed");

            const charsInScene = characterSeeds
              .filter((s) => cut.charactersInScene?.includes(s.id))
              .map((s) => s.label);

            return (
              <div
                key={cut.cutNumber}
                className="rounded-lg overflow-hidden"
                style={{
                  border: clip.status === "completed"
                    ? "1px solid #22c55e40"
                    : clip.status === "failed"
                    ? "1px solid #ef444440"
                    : "1px solid #e5e5e5",
                }}
              >
                <div className="flex items-center gap-2 p-3">
                  <div
                    className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{
                      background: clip.status === "completed"
                        ? "#22c55e"
                        : clip.status === "failed"
                        ? "#ef4444"
                        : "#ccc",
                    }}
                  >
                    {clip.status === "completed" ? "✓" : cut.cutNumber}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium">장면 {cut.cutNumber}</span>

                      {/* 엔진 배지 — 완료 후 실제 사용 엔진 표시, 완료 전엔 회색 */}
                      {clip.engineUsed ? (
                        <Badge
                          className="text-[10px] text-white"
                          style={{ background: clip.engineUsed === "kling" ? "#e85d04" : "#787fff" }}
                        >
                          {clip.engineUsed === "kling" ? "Kling" : "Veo"}
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] text-white" style={{ background: "#aaa" }}>
                          {clip.status === "idle" ? "엔진 대기" : "생성 중"}
                        </Badge>
                      )}

                      {/* 모드 배지 — 완료 후 실제 모드 표시 */}
                      <Badge variant="outline" className="text-[10px]" style={{
                        borderColor: (clip.modeUsed ?? (cut.cutNumber === 1 ? "generate" : "extend")) === "generate" ? "#787fff" : "#6b5ce7",
                        color:       (clip.modeUsed ?? (cut.cutNumber === 1 ? "generate" : "extend")) === "generate" ? "#787fff" : "#6b5ce7",
                      }}>
                        {clip.modeUsed
                          ? (clip.modeUsed === "generate" ? "Generate" : "Extend")
                          : (cut.cutNumber === 1 ? "Generate" : "Extend")}
                      </Badge>
                      {charsInScene.map((ch) => (
                        <span key={ch} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#787fff15", color: "#5a5ecc" }}>
                          {ch}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {cut.sceneDescription}
                    </p>
                    {/* 멀티샷 서브샷 목록 */}
                    {cut.multiShot && cut.multiShot.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {cut.multiShot.map((s) => (
                          <span key={s.index} className="text-[9px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: "#e85d0415", color: "#e85d04", border: "1px solid #e85d0425" }}>
                            <span className="font-semibold">샷{s.index}</span>
                            <span>{s.duration}s</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <ElapsedTime startedAt={clip.startedAt} />
                    <StatusBadge status={clip.status} />

                    {clip.status === "idle" && (
                      <Button
                        size="sm"
                        className="h-7 text-xs text-white"
                        disabled={!canGenerate}
                        onClick={() => onGenerateCut(cut.cutNumber)}
                        style={{ background: canGenerate ? "#787fff" : "#ccc" }}
                      >
                        생성
                      </Button>
                    )}

                    {clip.status === "failed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => onResetClip(cut.cutNumber)}
                      >
                        재시도
                      </Button>
                    )}
                  </div>
                </div>

                {/* 에러 */}
                {clip.status === "failed" && clip.error && (
                  <div className="px-3 pb-2">
                    <p className="text-[10px] text-red-500 bg-red-50 rounded p-1.5">
                      {clip.error}
                    </p>
                  </div>
                )}

                {/* Quality Score & Retry Info */}
                {(clip.verification || (clip.retryCount && clip.retryCount > 0)) && (
                  <div className="px-3 pb-2 space-y-1.5">
                    <div className="flex gap-1.5 flex-wrap">
                      {clip.verification && (
                        <Badge
                          className="text-[10px] text-white"
                          style={{
                            background: clip.verification.overallScore >= 80
                              ? "#22c55e"
                              : clip.verification.overallScore >= 60
                              ? "#e09900"
                              : "#ef4444",
                          }}
                        >
                          품질 {clip.verification.overallScore}/100
                        </Badge>
                      )}
                      {/* 씬 타입 배지 */}
                      {clip.verification?.detectedSceneType && (
                        <Badge variant="outline" className="text-[10px]" style={{
                          borderColor: ({
                            character: "#787fff",
                            environment: "#16a34a",
                            "object-detail": "#d97706",
                            "map-graphic": "#0891b2",
                            "transition-abstract": "#9333ea",
                          } as Record<string, string>)[clip.verification.detectedSceneType] || "#888",
                          color: ({
                            character: "#787fff",
                            environment: "#16a34a",
                            "object-detail": "#d97706",
                            "map-graphic": "#0891b2",
                            "transition-abstract": "#9333ea",
                          } as Record<string, string>)[clip.verification.detectedSceneType] || "#888",
                        }}>
                          {({
                            character: "캐릭터",
                            environment: "환경",
                            "object-detail": "오브젝트",
                            "map-graphic": "지도/그래픽",
                            "transition-abstract": "전환/추상",
                          } as Record<string, string>)[clip.verification.detectedSceneType] || clip.verification.detectedSceneType}
                        </Badge>
                      )}
                      {clip.retryCount && clip.retryCount > 0 && (
                        <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#ef4444", color: "#dc2626" }}>
                          재시도 {clip.retryCount}회
                        </Badge>
                      )}
                    </div>

                    {/* 씬 타입별 세부 점수 */}
                    {clip.verification?.sceneTypeScores && (
                      <div className="bg-gray-50 rounded p-2 space-y-1">
                        {Object.entries(clip.verification.sceneTypeScores).map(([key, val]) => {
                          const pct = val * 10;
                          const labelMap: Record<string, string> = {
                            characterDescription: "캐릭터 묘사",
                            cameraMovement: "카메라 움직임",
                            temporalStructure: "시간 구조",
                            lightingMood: "조명/무드",
                            veoCompatibility: "Veo 호환성",
                            spatialComposition: "공간 구성",
                            atmosphericDetail: "대기/분위기",
                            subjectClarity: "피사체 명확성",
                            cameraTechnique: "카메라 기법",
                            lightingTexture: "조명/텍스처",
                            terrainDetail: "지형 디테일",
                            visualClarity: "시각 명확성",
                            cameraMotion: "카메라 모션",
                            lightingAtmosphere: "조명/대기",
                            visualConcept: "시각 컨셉",
                            temporalProgression: "시간 전개",
                            moodAtmosphere: "무드/분위기",
                          };
                          return (
                            <div key={key} className="flex items-center gap-1.5">
                              <span className="text-[9px] w-[85px] shrink-0">{labelMap[key] || key}</span>
                              <div className="flex-1 h-[6px] bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${pct}%`,
                                    background: pct >= 80 ? "#22c55e" : pct >= 60 ? "#e09900" : "#ef4444",
                                  }}
                                />
                              </div>
                              <span className="text-[9px] w-[28px] text-right font-mono">{val}/10</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* rawScores fallback (씬 타입 점수가 없을 때) */}
                    {!clip.verification?.sceneTypeScores && clip.verification?.rawScores && (
                      <div className="bg-gray-50 rounded p-2 space-y-1">
                        {([
                          { key: "promptMatch" as const, label: "프롬프트 일치" },
                          { key: "styleConsistency" as const, label: "스타일 일관성" },
                          { key: "composition" as const, label: "구도/카메라" },
                          { key: "motionCoherence" as const, label: "모션 자연스러움" },
                          { key: "visualQuality" as const, label: "시각 품질" },
                          { key: "faceQuality" as const, label: "얼굴 품질" },
                        ] as const).map(({ key, label }) => {
                          const val = clip.verification!.rawScores![key];
                          const pct = val * 10;
                          return (
                            <div key={key} className="flex items-center gap-1.5">
                              <span className="text-[9px] w-[85px] shrink-0">{label}</span>
                              <div className="flex-1 h-[6px] bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${pct}%`,
                                    background: pct >= 80 ? "#22c55e" : pct >= 60 ? "#e09900" : "#ef4444",
                                  }}
                                />
                              </div>
                              <span className="text-[9px] w-[28px] text-right font-mono">{val}/10</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 감점 요인 & 개선 제안 */}
                    {clip.verification && (clip.verification.issues.length > 0 || clip.verification.suggestions.length > 0) && (
                      <div className="space-y-0.5">
                        {clip.verification.issues.map((issue, i) => (
                          <p key={`issue-${i}`} className="text-[9px] text-red-600">⚠ {issue}</p>
                        ))}
                        {clip.verification.suggestions.map((sug, i) => (
                          <p key={`sug-${i}`} className="text-[9px] text-blue-600">💡 {sug}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 품질 체크리스트 (사전 검증) */}
                {clip.qualityChecklist && (
                  <div className="px-3 pb-2">
                    <div className="bg-gray-50 rounded p-2 space-y-0.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-medium" style={{ color: "#555" }}>
                          프롬프트 품질 체크
                          {(clip.qualityChecklist as { sceneTypeLabel?: string }).sceneTypeLabel && (
                            <span className="ml-1 text-[9px] font-normal" style={{ color: "#888" }}>
                              ({(clip.qualityChecklist as { sceneTypeLabel?: string }).sceneTypeLabel})
                            </span>
                          )}
                        </span>
                        <span
                          className="text-[10px] font-mono font-bold"
                          style={{
                            color: clip.qualityChecklist.passCount === clip.qualityChecklist.totalCount
                              ? "#16a34a"
                              : clip.qualityChecklist.passCount >= clip.qualityChecklist.totalCount - 1
                              ? "#d97706"
                              : "#dc2626",
                          }}
                        >
                          {clip.qualityChecklist.passCount}/{clip.qualityChecklist.totalCount}
                        </span>
                      </div>
                      {clip.qualityChecklist.items.map((item) => (
                        <div key={item.id} className="flex items-start gap-1">
                          <span className="text-[10px] flex-shrink-0 mt-px">
                            {item.passed ? "✅" : "❌"}
                          </span>
                          <div className="min-w-0">
                            <span
                              className="text-[9px]"
                              style={{ color: item.passed ? "#16a34a" : "#dc2626" }}
                            >
                              {item.label}
                            </span>
                            {!item.passed && item.detail && (
                              <p className="text-[8px] text-muted-foreground mt-0.5">
                                {item.detail}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Final Merged Prompt (실제 API 전송 프롬프트) */}
                {clip.finalPrompt && (
                  <div className="px-3 pb-2">
                    <details className="group">
                      <summary className="text-[10px] font-medium cursor-pointer select-none" style={{ color: "#555" }}>
                        최종 프롬프트 (API 전송용) <span className="text-[9px] font-normal text-muted-foreground">({clip.finalPrompt.split(/\s+/).length}w)</span>
                      </summary>
                      <pre className="mt-1 bg-gray-50 rounded p-2 text-[9px] font-mono whitespace-pre-wrap break-all leading-relaxed" style={{ color: "#333", maxHeight: 200, overflowY: "auto" }}>
                        {clip.finalPrompt}
                      </pre>
                    </details>
                  </div>
                )}

                {/* Seed */}
                {clip.seed && (
                  <div className="px-3 pb-2">
                    <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#c4b800", color: "#7a7000" }}>
                      Seed: {clip.seed}
                    </Badge>
                  </div>
                )}

                {/* 완료된 영상 미리보기 + 다운로드 */}
                {clip.status === "completed" && clip.videoUri && (
                  <div className="px-3 pb-3 space-y-1.5">
                    <video
                      src={clip.videoUri}
                      controls
                      className="w-full rounded-lg"
                      style={{ maxHeight: "200px" }}
                    />
                    <div className="flex gap-1.5">
                      <a
                        href={clip.videoUri}
                        download={`scene-${cut.cutNumber}.mp4`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] px-2.5 py-1 rounded-md inline-flex items-center gap-1"
                        style={{ background: "#22c55e15", color: "#16a34a", border: "1px solid #22c55e30" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        MP4 다운로드
                      </a>
                      {onAddCut && (
                        <button
                          onClick={() => onAddCut(cut.cutNumber)}
                          className="text-[10px] px-2.5 py-1 rounded-md"
                          style={{ background: "#787fff15", color: "#5a5ecc", border: "1px solid #787fff30" }}
                        >
                          컷 추가 생성
                        </button>
                      )}
                      <button
                        onClick={() => onResetClip(cut.cutNumber)}
                        className="text-[10px] px-2.5 py-1 rounded-md"
                        style={{ background: "#ef444410", color: "#dc2626", border: "1px solid #ef444420" }}
                      >
                        초기화
                      </button>
                    </div>
                  </div>
                )}

                {/* 컷 선택 (여러 take) */}
                {clip.status === "completed" && clip.variants && clip.variants.length > 1 && (
                  <div className="px-3 pb-3 space-y-1.5">
                    <p className="text-[10px] font-medium" style={{ color: "#787fff" }}>
                      {clip.variants.length}개 컷 — 베스트 컷을 선택하세요
                    </p>
                    <div className="flex gap-2 overflow-x-auto">
                      {clip.variants.map((variant, vi) => (
                        <div
                          key={vi}
                          className="flex-shrink-0 cursor-pointer rounded-lg overflow-hidden transition-all"
                          style={{
                            width: "100px",
                            border: clip.selectedVariant === vi
                              ? "2px solid #787fff"
                              : "2px solid transparent",
                          }}
                          onClick={() => onSelectVariant(cut.cutNumber, vi)}
                        >
                          <video
                            src={variant.videoUri}
                            className="w-full"
                            style={{ height: "80px", objectFit: "cover" }}
                            muted
                            onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                            onMouseLeave={(e) => {
                              const v = e.target as HTMLVideoElement;
                              v.pause();
                              v.currentTime = 0;
                            }}
                          />
                          <div className="p-1 text-center">
                            <span className="text-[9px]" style={{ color: clip.selectedVariant === vi ? "#787fff" : "#999" }}>
                              컷 {vi + 1}
                            </span>
                            {variant.seed && (
                              <p className="text-[8px] text-muted-foreground">S: {variant.seed}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Extend 연결선 */}
                {i < cuts.length - 1 && clip.status === "completed" && (
                  <div className="flex items-center gap-1 px-6 pb-1">
                    <div className="h-px flex-1" style={{ background: "#22c55e40" }} />
                    <span className="text-[9px] text-muted-foreground">Scene Extension →</span>
                    <div className="h-px flex-1" style={{ background: "#22c55e40" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
