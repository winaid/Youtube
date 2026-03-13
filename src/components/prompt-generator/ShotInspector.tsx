"use client";

import { useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EditableShot } from "@/lib/shot-editing";
import type { ShotRegenerateStatus, NarrationMode } from "@/types";
import { FRAMING_OPTIONS, ANGLE_OPTIONS } from "@/lib/shot-editing";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface ShotInspectorProps {
  shot: EditableShot;
  shotStatus: ShotRegenerateStatus;
  variantCount: number;
  onUpdateField: (path: string, value: string) => void;
  onSetDuration: (newDuration: number) => void;
  onRegenerate: (shotId: string) => void;
  onClose: () => void;
}

// ═══════════════════════════════════════════════════════════════════
// Camera Motion Options
// ═══════════════════════════════════════════════════════════════════

const MOTION_OPTIONS = [
  "static", "push-in", "pull-out", "pan-left", "pan-right",
  "tilt-up", "tilt-down", "tracking", "crane-up", "crane-down",
  "dolly", "handheld", "steadicam", "orbit",
] as const;

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function ShotInspector({
  shot,
  shotStatus,
  variantCount,
  onUpdateField,
  onSetDuration,
  onRegenerate,
  onClose,
}: ShotInspectorProps) {
  const duration = shot.endSec - shot.startSec;
  const isGenerating = shotStatus === "generating";

  const handleDurationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val >= 1) onSetDuration(val);
    },
    [onSetDuration],
  );

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#787fff40" }}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between" style={{ background: "linear-gradient(135deg, #787fff10, #787fff05)" }}>
        <div>
          <CardTitle className="text-sm" style={{ color: "#787fff" }}>
            샷 Inspector
          </CardTitle>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {shot.shotId}
            {variantCount > 0 && (
              <span className="ml-1" style={{ color: "#8b5cf6" }}>
                ({variantCount}개 variant)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Regenerate button */}
          <Button
            size="sm"
            className="h-6 text-[10px] text-white"
            style={{ background: isGenerating ? "#f59e0b" : "#8b5cf6" }}
            onClick={() => onRegenerate(shot.shotId)}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                생성 중
              </span>
            ) : (
              "이 샷 다시 생성"
            )}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onClose}>
            닫기
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-3">
        {/* Status indicator */}
        {shotStatus === "generating" && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs" style={{ background: "#f59e0b10", border: "1px solid #f59e0b30", color: "#b37700" }}>
            <div className="w-2.5 h-2.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            이 샷만 다시 생성하고 있습니다. 나머지 샷은 영향 없습니다.
          </div>
        )}
        {shotStatus === "failed" && (
          <div className="px-2.5 py-1.5 rounded-md text-xs" style={{ background: "#ef444410", border: "1px solid #ef444430", color: "#ef4444" }}>
            샷 재생성 실패. 다시 시도하세요.
          </div>
        )}

        {/* Timing */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {shot.startSec}s – {shot.endSec}s
          </Badge>
          <div className="flex items-center gap-1 ml-auto">
            <label className="text-[10px] text-muted-foreground">길이:</label>
            <input
              type="number"
              min={1}
              step={0.5}
              value={duration}
              onChange={handleDurationChange}
              className="w-16 h-6 text-xs text-center border rounded px-1 bg-background"
            />
            <span className="text-[10px] text-muted-foreground">s</span>
          </div>
        </div>

        {/* Camera section */}
        <fieldset className="space-y-2 border rounded-md p-2">
          <legend className="text-[10px] font-medium text-muted-foreground px-1">카메라</legend>

          <div className="grid grid-cols-3 gap-2">
            {/* Framing */}
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">프레이밍</label>
              <Select value={shot.camera.framing} onValueChange={(v) => onUpdateField("camera.framing", v)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FRAMING_OPTIONS.map((f) => (
                    <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Angle */}
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">앵글</label>
              <Select value={shot.camera.angle} onValueChange={(v) => onUpdateField("camera.angle", v)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANGLE_OPTIONS.map((a) => (
                    <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Motion */}
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">모션</label>
              <Select value={shot.camera.motion} onValueChange={(v) => onUpdateField("camera.motion", v)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOTION_OPTIONS.map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </fieldset>

        {/* Content fields */}
        <div className="space-y-2">
          <InlineTextField
            label="피사체"
            value={shot.subject}
            onChange={(v) => onUpdateField("subject", v)}
          />
          <InlineTextField
            label="행동"
            value={shot.action}
            onChange={(v) => onUpdateField("action", v)}
          />
          <InlineTextField
            label="환경"
            value={shot.environment}
            onChange={(v) => onUpdateField("environment", v)}
          />
          <InlineTextField
            label="조명/무드"
            value={shot.moodLighting}
            onChange={(v) => onUpdateField("moodLighting", v)}
          />
          <InlineTextField
            label="포커스"
            value={shot.focus}
            onChange={(v) => onUpdateField("focus", v)}
          />
        </div>

        {/* Narration section */}
        <fieldset className="space-y-2 border rounded-md p-2">
          <legend className="text-[10px] font-medium text-muted-foreground px-1">나레이션</legend>

          {/* Mode selector */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted-foreground w-14 shrink-0">모드</label>
            <Select
              value={shot.narrationMode || "auto"}
              onValueChange={(v) => onUpdateField("narrationMode", v)}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="text-xs">auto (자동)</SelectItem>
                <SelectItem value="manual" className="text-xs">manual (직접 입력)</SelectItem>
                <SelectItem value="mute" className="text-xs">mute (음소거)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mute indicator */}
          {shot.narrationMode === "mute" && (
            <div className="px-2 py-1 rounded text-[10px]" style={{ background: "#78787810", color: "#888" }}>
              이 샷은 나레이션 없이 재생됩니다.
            </div>
          )}

          {/* Narration text */}
          {shot.narrationMode !== "mute" && (
            <div className="space-y-1">
              <textarea
                value={shot.narrationText || ""}
                onChange={(e) => onUpdateField("narrationText", e.target.value)}
                placeholder={shot.narrationMode === "manual" ? "나레이션 텍스트를 직접 입력하세요" : "비어 있으면 sceneDescription이 사용됩니다"}
                className="w-full text-xs border rounded px-2 py-1.5 bg-background resize-none"
                rows={3}
              />
              {/* Auto mode fallback indicator */}
              {(!shot.narrationMode || shot.narrationMode === "auto") && !shot.narrationText && (
                <p className="text-[9px] text-muted-foreground" style={{ color: "#f59e0b" }}>
                  sceneDescription fallback 사용 예정
                </p>
              )}
            </div>
          )}

          {/* Duration & sync estimate */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[9px]">
              샷 길이: {duration.toFixed(1)}s
            </Badge>
            {shot.narrationMode !== "mute" && shot.narrationText && (
              <NarrationSyncEstimate text={shot.narrationText} durationSec={duration} />
            )}
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Narration sync estimate badge
// ═══════════════════════════════════════════════════════════════════

function NarrationSyncEstimate({ text, durationSec }: { text: string; durationSec: number }) {
  // 한국어 ~4글자/초 기준 예상
  const estimatedSec = text.length / 4;
  const tolerance = 0.5;

  let label: string;
  let color: string;
  if (estimatedSec > durationSec + tolerance) {
    label = `예상 ${estimatedSec.toFixed(1)}s — trimmed 가능`;
    color = "#f59e0b";
  } else if (estimatedSec < durationSec - tolerance) {
    label = `예상 ${estimatedSec.toFixed(1)}s — padded`;
    color = "#3b82f6";
  } else {
    label = `예상 ${estimatedSec.toFixed(1)}s — OK`;
    color = "#22c55e";
  }

  return (
    <Badge variant="outline" className="text-[9px]" style={{ borderColor: color, color }}>
      {label}
    </Badge>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Inline text field (mini)
// ═══════════════════════════════════════════════════════════════════

function InlineTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <label className="text-[10px] text-muted-foreground w-14 shrink-0 pt-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 h-7 text-xs border rounded px-2 bg-background"
      />
    </div>
  );
}
