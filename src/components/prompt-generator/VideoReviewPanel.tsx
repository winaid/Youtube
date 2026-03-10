"use client";

import { VideoReview } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface VideoReviewPanelProps {
  review: VideoReview;
  onRegenerateCut: (cutNumber: number, improvedPrompt?: string) => void;
  onRegenerateAll: () => void;
  onDismiss: () => void;
  onReReview: () => void;
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const color =
    score >= 80 ? "#22c55e" : score >= 60 ? "#e09900" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] w-16 text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "#e5e5e5" }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <span className="text-[11px] font-medium w-8 text-right" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

export default function VideoReviewPanel({
  review,
  onRegenerateCut,
  onRegenerateAll,
  onDismiss,
  onReReview,
}: VideoReviewPanelProps) {
  if (review.status === "idle") return null;

  const needsRegen = review.cutFeedbacks.filter((f) => f.needsRegeneration);
  const overallColor =
    review.overallScore >= 80
      ? "#22c55e"
      : review.overallScore >= 60
      ? "#e09900"
      : "#ef4444";

  return (
    <Card
      className="overflow-hidden border-2"
      style={{
        borderColor:
          review.status === "reviewing"
            ? "#787fff40"
            : review.status === "complete"
            ? "#22c55e60"
            : `${overallColor}40`,
      }}
    >
      <CardHeader
        className="pb-3"
        style={{
          background:
            review.status === "reviewing"
              ? "linear-gradient(135deg, #787fff15, #22c55e10)"
              : review.status === "complete"
              ? "linear-gradient(135deg, #22c55e20, #787fff10)"
              : `linear-gradient(135deg, ${overallColor}15, #787fff10)`,
        }}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {review.status === "reviewing" && (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" style={{ color: "#787fff" }} />
                <span style={{ color: "#787fff" }}>AI 리뷰 진행 중...</span>
              </>
            )}
            {review.status === "regenerating" && (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" style={{ color: "#e09900" }} />
                <span style={{ color: "#e09900" }}>피드백 기반 재생성 중...</span>
              </>
            )}
            {review.status === "done" && (
              <span style={{ color: overallColor }}>AI 리뷰 결과</span>
            )}
            {review.status === "complete" && (
              <span style={{ color: "#22c55e" }}>재생성 완료!</span>
            )}
          </CardTitle>

          {(review.status === "done" || review.status === "complete") && (
            <div className="flex items-center gap-2">
              <Badge
                className="text-sm font-bold"
                style={{ background: `${overallColor}20`, color: overallColor }}
              >
                {review.overallScore}점
              </Badge>
              <button
                onClick={onDismiss}
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
              >
                ×
              </button>
            </div>
          )}
        </div>

        {review.status === "reviewing" && (
          <p className="text-xs text-muted-foreground mt-1">
            각 장면의 프레임을 캡처하여 AI가 분석 중입니다...
          </p>
        )}
      </CardHeader>

      {(review.status === "done" || review.status === "complete") && (
        <CardContent className="space-y-4 pt-4">
          {/* 전체 평가 */}
          <div className="space-y-2">
            <ScoreBar score={review.overallScore} label="전체 점수" />
            <p className="text-sm" style={{ color: overallColor }}>
              {review.overallComment}
            </p>
          </div>

          {/* 장면별 피드백 */}
          {review.cutFeedbacks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">장면별 상세 피드백</p>
              {review.cutFeedbacks.map((fb) => {
                const fbColor =
                  fb.score >= 80 ? "#22c55e" : fb.score >= 60 ? "#e09900" : "#ef4444";
                const wasRegenerated = review.regeneratedCuts.includes(fb.cutNumber);

                return (
                  <div
                    key={fb.cutNumber}
                    className="rounded-lg p-3 space-y-2"
                    style={{
                      border: `1px solid ${fbColor}30`,
                      background: `${fbColor}05`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">장면 {fb.cutNumber}</span>
                        <Badge
                          className="text-[10px]"
                          style={{ background: `${fbColor}20`, color: fbColor }}
                        >
                          {fb.score}점
                        </Badge>
                        {fb.needsRegeneration && !wasRegenerated && (
                          <Badge
                            className="text-[10px] text-white"
                            style={{ background: "#ef4444" }}
                          >
                            재생성 권장
                          </Badge>
                        )}
                        {wasRegenerated && (
                          <Badge
                            className="text-[10px] text-white"
                            style={{ background: "#22c55e" }}
                          >
                            재생성 완료
                          </Badge>
                        )}
                      </div>

                      {fb.needsRegeneration && !wasRegenerated && review.status !== "regenerating" && (
                        <Button
                          size="sm"
                          className="h-6 text-[10px] text-white"
                          style={{ background: "#787fff" }}
                          onClick={() => onRegenerateCut(fb.cutNumber, fb.improvedPrompt)}
                        >
                          이 장면 재생성
                        </Button>
                      )}
                    </div>

                    {/* 문제점 */}
                    {fb.issues.length > 0 && (
                      <div className="space-y-0.5">
                        {fb.issues.map((issue, i) => (
                          <p key={i} className="text-[11px] text-muted-foreground flex items-start gap-1">
                            <span style={{ color: "#ef4444" }}>•</span>
                            {issue}
                          </p>
                        ))}
                      </div>
                    )}

                    {/* 제안 */}
                    {fb.suggestion && (
                      <p className="text-[11px]" style={{ color: "#787fff" }}>
                        → {fb.suggestion}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 액션 버튼 */}
          <div className="flex gap-2 pt-1">
            {needsRegen.length > 0 && review.status === "done" && (
              <Button
                size="sm"
                className="text-white text-xs"
                style={{ background: "linear-gradient(135deg, #ef4444, #e09900)" }}
                onClick={onRegenerateAll}
              >
                문제 장면 전체 재생성 ({needsRegen.length}개)
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={onReReview}
            >
              다시 리뷰
            </Button>
            {review.status === "complete" && (
              <Badge
                className="text-xs px-3 py-1 text-white animate-pulse"
                style={{ background: "#22c55e" }}
              >
                모든 작업 완료!
              </Badge>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
