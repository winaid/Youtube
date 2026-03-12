"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ShotVariant, ShotRegenerateStatus } from "@/types";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface ShotVariantPanelProps {
  shotId: string;
  status: ShotRegenerateStatus;
  variants: ShotVariant[];
  activeVariantId: string | null;
  onAcceptVariant: (variantId: string) => void;
  onRegenerate: () => void;
}

// ═══════════════════════════════════════════════════════════════════
// Status Badge
// ═══════════════════════════════════════════════════════════════════

const STATUS_CONFIG: Record<ShotRegenerateStatus, { label: string; color: string; bg: string }> = {
  idle: { label: "대기", color: "#6b7280", bg: "#6b728015" },
  generating: { label: "생성 중...", color: "#f59e0b", bg: "#f59e0b15" },
  success: { label: "완료", color: "#22c55e", bg: "#22c55e15" },
  failed: { label: "실패", color: "#ef4444", bg: "#ef444415" },
};

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function ShotVariantPanel({
  shotId,
  status,
  variants,
  activeVariantId,
  onAcceptVariant,
  onRegenerate,
}: ShotVariantPanelProps) {
  const statusCfg = STATUS_CONFIG[status];

  // Sort: active first, then by createdAt desc
  const sorted = useMemo(() => {
    return [...variants].sort((a, b) => {
      if (a.variantId === activeVariantId) return -1;
      if (b.variantId === activeVariantId) return 1;
      return b.createdAt - a.createdAt;
    });
  }, [variants, activeVariantId]);

  if (variants.length === 0 && status === "idle") {
    return null; // nothing to show yet
  }

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#8b5cf640" }}>
      <CardHeader
        className="pb-2"
        style={{ background: "linear-gradient(135deg, #8b5cf610, transparent)" }}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm" style={{ color: "#8b5cf6" }}>
            샷 Variants
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              className="text-[10px]"
              style={{ background: statusCfg.bg, color: statusCfg.color }}
            >
              {statusCfg.label}
            </Badge>
            <Button
              size="sm"
              className="h-7 text-xs text-white"
              style={{ background: "#8b5cf6" }}
              onClick={onRegenerate}
              disabled={status === "generating"}
            >
              {status === "generating" ? "생성 중..." : "이 샷 다시 생성"}
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {shotId} &middot; {variants.length}개 variant
        </p>
      </CardHeader>

      <CardContent className="pt-3 space-y-2">
        {/* Generating spinner */}
        {status === "generating" && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "#f59e0b10", border: "1px solid #f59e0b30" }}>
            <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs" style={{ color: "#b37700" }}>
              이 샷만 다시 생성하고 있습니다...
            </span>
          </div>
        )}

        {/* Variant list — side-by-side when 2 variants */}
        {sorted.length > 0 && (
          <div className={sorted.length === 2 ? "grid grid-cols-2 gap-2" : "space-y-2"}>
            {sorted.map((variant, i) => {
              const isActive = variant.variantId === activeVariantId;
              const isGenerating = variant.status === "generating";

              return (
                <div
                  key={variant.variantId}
                  className="rounded-lg p-2.5 transition-colors"
                  style={{
                    background: isActive ? "#8b5cf610" : "#f5f5f5",
                    border: isActive ? "2px solid #8b5cf650" : "1px solid #e5e5e5",
                  }}
                >
                  {/* Thumbnail / Video preview */}
                  <div className="aspect-video rounded bg-muted mb-2 flex items-center justify-center overflow-hidden">
                    {isGenerating ? (
                      <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    ) : variant.videoUrl ? (
                      <video
                        src={variant.videoUrl}
                        className="w-full h-full object-cover"
                        muted
                        loop
                        playsInline
                        onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                        onMouseLeave={(e) => {
                          const v = e.target as HTMLVideoElement;
                          v.pause();
                          v.currentTime = 0;
                        }}
                      />
                    ) : variant.thumbnailUrl ? (
                      <img
                        src={variant.thumbnailUrl}
                        alt={`Variant ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        {variant.status === "failed" ? "실패" : "미리보기 없음"}
                      </span>
                    )}
                  </div>

                  {/* Variant info */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-medium">
                          {isActive ? "현재 활성" : `Variant ${i + 1}`}
                        </span>
                        {isActive && (
                          <Badge className="text-[8px] px-1" style={{ background: "#8b5cf620", color: "#8b5cf6" }}>
                            활성
                          </Badge>
                        )}
                        {variant.status === "failed" && (
                          <Badge className="text-[8px] px-1" style={{ background: "#ef444420", color: "#ef4444" }}>
                            실패
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(variant.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        {variant.qualityScore != null && (
                          <span className="ml-1">Q: {variant.qualityScore}</span>
                        )}
                        {variant.generationMeta && (
                          <span className="ml-1">{variant.generationMeta.mode} {variant.generationMeta.durationSec}s</span>
                        )}
                      </div>
                    </div>

                    {!isActive && variant.status === "success" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px]"
                        style={{ borderColor: "#8b5cf650", color: "#8b5cf6" }}
                        onClick={() => onAcceptVariant(variant.variantId)}
                      >
                        이 버전 채택
                      </Button>
                    )}
                  </div>

                  {/* Error */}
                  {variant.error && (
                    <p className="text-[10px] mt-1" style={{ color: "#ef4444" }}>
                      {variant.error}
                    </p>
                  )}

                  {/* Debug: prompt preview */}
                  {variant.sourcePromptPreview && (
                    <details className="mt-1">
                      <summary className="text-[9px] text-muted-foreground cursor-pointer">프롬프트 미리보기</summary>
                      <pre className="text-[9px] mt-1 p-1.5 rounded bg-muted overflow-auto max-h-20 whitespace-pre-wrap">
                        {variant.sourcePromptPreview}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
