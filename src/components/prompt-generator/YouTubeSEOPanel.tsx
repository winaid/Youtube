"use client";

import React, { useState, useCallback } from "react";
import type { PromptOutput, YouTubeSEO, ViewerPrediction } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface YouTubeSEOPanelProps {
  result: PromptOutput | null;
  region?: string;
  animationMode?: string;
}

export default function YouTubeSEOPanel({
  result,
  region,
  animationMode,
}: YouTubeSEOPanelProps) {
  const [seo, setSeo] = useState<YouTubeSEO | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string>("");
  const [thumbnailUrl, setThumbnailUrl] = useState<string>("");
  const [prediction, setPrediction] = useState<ViewerPrediction | null>(null);
  const [loadingSeo, setLoadingSeo] = useState(false);
  const [loadingThumb, setLoadingThumb] = useState(false);
  const [loadingPredict, setLoadingPredict] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string>("");

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(label);
      setTimeout(() => setCopyFeedback(""), 1500);
    } catch {
      // fallback: do nothing
    }
  }, []);

  const handleGenerateSEO = async () => {
    if (!result) return;
    setLoadingSeo(true);
    try {
      const res = await fetch("/api/generate-seo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectTitle: result.projectTitle,
          conceptSummary: result.conceptSummary,
          cuts: result.cuts,
          region,
          animationMode,
        }),
      });
      const data = await res.json();
      setSeo(data);
      if (data.titles?.length) setSelectedTitle(data.titles[0]);
    } catch (err) {
      console.error("SEO generation failed:", err);
    } finally {
      setLoadingSeo(false);
    }
  };

  const handleGenerateThumbnail = async () => {
    if (!result) return;
    setLoadingThumb(true);
    try {
      const res = await fetch("/api/generate-thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectTitle: result.projectTitle,
          conceptSummary: result.conceptSummary,
          thumbnailPrompt: seo?.thumbnailPrompt,
          animationMode,
        }),
      });
      const data = await res.json();
      if (data.imageUrl) setThumbnailUrl(data.imageUrl);
    } catch (err) {
      console.error("Thumbnail generation failed:", err);
    } finally {
      setLoadingThumb(false);
    }
  };

  const handlePredictEngagement = async () => {
    if (!result) return;
    setLoadingPredict(true);
    try {
      const res = await fetch("/api/predict-engagement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectTitle: result.projectTitle,
          conceptSummary: result.conceptSummary,
          cuts: result.cuts,
          seo,
          region,
          animationMode,
        }),
      });
      const data = await res.json();
      setPrediction(data);
    } catch (err) {
      console.error("Engagement prediction failed:", err);
    } finally {
      setLoadingPredict(false);
    }
  };

  if (!result) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground text-center">
            프롬프트를 먼저 생성해주세요.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* SEO Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">YouTube SEO</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleGenerateSEO}
            disabled={loadingSeo}
            className="w-full"
          >
            {loadingSeo ? "생성 중..." : "SEO 자동 생성"}
          </Button>

          {seo && (
            <div className="space-y-4">
              {/* Titles */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">제목 후보</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => copyToClipboard(selectedTitle, "title")}
                  >
                    {copyFeedback === "title" ? "복사됨!" : "복사"}
                  </Button>
                </div>
                <div className="space-y-1">
                  {seo.titles.map((title, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedTitle(title)}
                      className={`w-full text-left text-sm px-3 py-2 rounded-md border transition-colors ${
                        selectedTitle === title
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      {title}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">설명</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() =>
                      copyToClipboard(seo.description, "description")
                    }
                  >
                    {copyFeedback === "description" ? "복사됨!" : "복사"}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/30 rounded-md p-3">
                  {seo.description}
                </p>
              </div>

              {/* Tags */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">태그</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() =>
                      copyToClipboard(seo.tags.join(", "), "tags")
                    }
                  >
                    {copyFeedback === "tags" ? "복사됨!" : "복사"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {seo.tags.map((tag, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Hashtags */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">해시태그</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() =>
                      copyToClipboard(seo.hashtags.join(" "), "hashtags")
                    }
                  >
                    {copyFeedback === "hashtags" ? "복사됨!" : "복사"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {seo.hashtags.map((tag, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Predicted CTR */}
              {seo.predictedCTR > 0 && (
                <div className="text-sm text-muted-foreground">
                  예상 CTR:{" "}
                  <span className="text-primary font-medium">
                    {(seo.predictedCTR * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Thumbnail Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">썸네일</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={handleGenerateThumbnail}
            disabled={loadingThumb}
            variant="outline"
            className="w-full"
          >
            {loadingThumb ? "생성 중..." : "썸네일 생성"}
          </Button>
          {thumbnailUrl && (
            <div className="rounded-lg overflow-hidden border">
              <img
                src={thumbnailUrl}
                alt="Generated thumbnail"
                className="w-full h-auto"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Engagement Prediction Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">시청자 반응 예측</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={handlePredictEngagement}
            disabled={loadingPredict}
            variant="outline"
            className="w-full"
          >
            {loadingPredict ? "분석 중..." : "시청자 반응 예측"}
          </Button>

          {prediction && (
            <div className="space-y-4">
              {/* Key metrics */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/30 rounded-md p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">
                    예상 조회수
                  </div>
                  <div className="text-lg font-bold text-primary">
                    {prediction.estimatedViews}
                  </div>
                </div>
                <div className="bg-muted/30 rounded-md p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">
                    참여율
                  </div>
                  <div className="text-lg font-bold text-primary">
                    {(prediction.engagementRate * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Retention Curve */}
              {prediction.retentionCurve.length > 0 && (
                <div>
                  <span className="text-sm font-medium block mb-2">
                    시청 유지율 곡선
                  </span>
                  <div className="flex items-end gap-[2px] h-16 bg-muted/20 rounded-md p-2">
                    {prediction.retentionCurve.map((val, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-sm"
                        style={{
                          height: `${val}%`,
                          background:
                            val >= 70
                              ? "#48bb78"
                              : val >= 40
                                ? "#ecc94b"
                                : "#e53e3e",
                          minWidth: 3,
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>시작</span>
                    <span>중간</span>
                    <span>끝</span>
                  </div>
                </div>
              )}

              {/* Strengths */}
              {prediction.strengths.length > 0 && (
                <div>
                  <span className="text-sm font-medium block mb-1">강점</span>
                  <ul className="space-y-1">
                    {prediction.strengths.map((s, i) => (
                      <li
                        key={i}
                        className="text-xs text-green-400 flex items-start gap-1"
                      >
                        <span className="mt-0.5 shrink-0">+</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Weaknesses */}
              {prediction.weaknesses.length > 0 && (
                <div>
                  <span className="text-sm font-medium block mb-1">약점</span>
                  <ul className="space-y-1">
                    {prediction.weaknesses.map((w, i) => (
                      <li
                        key={i}
                        className="text-xs text-red-400 flex items-start gap-1"
                      >
                        <span className="mt-0.5 shrink-0">-</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Improvements */}
              {prediction.improvements.length > 0 && (
                <div>
                  <span className="text-sm font-medium block mb-1">
                    개선 제안
                  </span>
                  <ul className="space-y-1">
                    {prediction.improvements.map((imp, i) => (
                      <li
                        key={i}
                        className="text-xs text-blue-400 flex items-start gap-1"
                      >
                        <span className="mt-0.5 shrink-0">*</span>
                        <span>{imp}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
