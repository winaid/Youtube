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
import { FRAMING_OPTIONS, ANGLE_OPTIONS } from "@/lib/shot-editing";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface ShotInspectorProps {
  shot: EditableShot;
  onUpdateField: (path: string, value: string) => void;
  onSetDuration: (newDuration: number) => void;
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
  onUpdateField,
  onSetDuration,
  onClose,
}: ShotInspectorProps) {
  const duration = shot.endSec - shot.startSec;

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
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onClose}>
          닫기
        </Button>
      </CardHeader>

      <CardContent className="space-y-3 pt-3">
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
      </CardContent>
    </Card>
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
