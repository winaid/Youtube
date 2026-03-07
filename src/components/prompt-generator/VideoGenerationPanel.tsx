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
  const config = {
    idle: { bg: "#e5e5e5", color: "#666", label: "대기" },
    generating: { bg: "#787fff30", color: "#787fff", label: "요청 중..." },
    polling: { bg: "#f59e0b30", color: "#d97706", label: "생성 중..." },
    completed: { bg: "#22c55e20", color: "#16a34a", label: "완료" },
    failed: { bg: "#ef444420", color: "#dc2626", label: "실패" },
  }[status];

  return (
    <Badge className="text-[10px]" style={{ background: config.bg, color: config.color }}>
      {(status === "generating" || status === "polling") && (
        <span className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent mr-1" />
      )}
      {config.label}
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
}: VideoGenerationPanelProps) {
  const hasTextPattern = /text|title|caption|subtitle|letter|sign|hangeul|자막|글씨|텍스트|타이틀/i;

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#22c55e40" }}>
      <CardHeader className="pb-3" style={{ background: "linear-gradient(135deg, #22c55e15, #787fff10)" }}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base" style={{ color: "#16a34a" }}>
            Veo 3.1 영상 생성
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs" style={{ borderColor: "#22c55e" }}>
              {completedCount}/{totalCount} 완료
            </Badge>
          </div>
        </div>

        {/* 프로그레스 바 */}
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
        {/* 전체 생성 / 중단 버튼 */}
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
            <Button
              size="sm"
              variant="destructive"
              onClick={onStopAuto}
            >
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

        {/* 컷별 상태 */}
        <div className="space-y-2">
          {cuts.map((cut, i) => {
            const clip = clips.find((c) => c.cutNumber === cut.cutNumber);
            if (!clip) return null;

            const isQuality = hasTextPattern.test(
              cut.videoPrompt + " " + cut.imagePrompt + " " + cut.sceneDescription
            );
            const prevClip = clips.find(
              (c) => c.cutNumber === cut.cutNumber - 1
            );
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
                  {/* 컷 번호 */}
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

                  {/* 컷 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium">CUT {cut.cutNumber}</span>
                      <Badge className="text-[10px] text-white" style={{ background: isQuality ? "#e09900" : "#22c55e" }}>
                        {isQuality ? "Quality" : "Fast"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]" style={{
                        borderColor: cut.cutNumber === 1 ? "#787fff" : "#6b5ce7",
                        color: cut.cutNumber === 1 ? "#787fff" : "#6b5ce7",
                      }}>
                        {cut.cutNumber === 1 ? "Video" : "Extend"}
                      </Badge>
                      {charsInScene.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          [{charsInScene.join(", ")}]
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {cut.sceneDescription}
                    </p>
                  </div>

                  {/* 상태 & 액션 */}
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

                {/* 에러 메시지 */}
                {clip.status === "failed" && clip.error && (
                  <div className="px-3 pb-2">
                    <p className="text-[10px] text-red-500 bg-red-50 rounded p-1.5">
                      {clip.error}
                    </p>
                  </div>
                )}

                {/* Seed 표시 */}
                {clip.seed && (
                  <div className="px-3 pb-2">
                    <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#c4b800", color: "#7a7000" }}>
                      Seed: {clip.seed}
                    </Badge>
                  </div>
                )}

                {/* 완료된 영상 미리보기 */}
                {clip.status === "completed" && clip.videoUri && (
                  <div className="px-3 pb-3">
                    <video
                      src={clip.videoUri}
                      controls
                      className="w-full rounded-lg"
                      style={{ maxHeight: "200px" }}
                    />
                  </div>
                )}

                {/* Extend 연결선 */}
                {i < cuts.length - 1 && clip.status === "completed" && (
                  <div className="flex items-center gap-1 px-6 pb-1">
                    <div className="h-px flex-1" style={{ background: "#22c55e40" }} />
                    <span className="text-[9px] text-muted-foreground">
                      Scene Extension →
                    </span>
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
