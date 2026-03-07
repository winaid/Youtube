"use client";

import React from "react";
import type { Cut, EmotionPoint } from "@/types";

interface EmotionCurveEditorProps {
  cuts: Cut[];
  emotionPoints: EmotionPoint[];
  onChange: (points: EmotionPoint[]) => void;
}

const EMOTION_OPTIONS: {
  value: EmotionPoint["emotion"];
  label: string;
  color: string;
}[] = [
  { value: "tension", label: "긴장", color: "#e53e3e" },
  { value: "release", label: "해소", color: "#9f7aea" },
  { value: "joy", label: "기쁨", color: "#ecc94b" },
  { value: "sadness", label: "슬픔", color: "#4299e1" },
  { value: "anger", label: "분노", color: "#c53030" },
  { value: "surprise", label: "놀람", color: "#ed8936" },
  { value: "calm", label: "평온", color: "#48bb78" },
  { value: "excitement", label: "흥분", color: "#f6ad55" },
];

function getEmotionColor(emotion: EmotionPoint["emotion"]): string {
  return EMOTION_OPTIONS.find((e) => e.value === emotion)?.color ?? "#787fff";
}

export default function EmotionCurveEditor({
  cuts,
  emotionPoints,
  onChange,
}: EmotionCurveEditorProps) {
  const getPoint = (cutNumber: number): EmotionPoint => {
    return (
      emotionPoints.find((p) => p.cutNumber === cutNumber) ?? {
        cutNumber,
        intensity: 50,
        emotion: "calm",
      }
    );
  };

  const updatePoint = (
    cutNumber: number,
    updates: Partial<Pick<EmotionPoint, "intensity" | "emotion">>
  ) => {
    const existing = emotionPoints.find((p) => p.cutNumber === cutNumber);
    const updated: EmotionPoint = existing
      ? { ...existing, ...updates }
      : { cutNumber, intensity: 50, emotion: "calm", ...updates };

    const newPoints = existing
      ? emotionPoints.map((p) => (p.cutNumber === cutNumber ? updated : p))
      : [...emotionPoints, updated];

    onChange(newPoints);
  };

  return (
    <div
      style={{
        background: "#1a1a2e",
        border: "1px solid #2a2a4a",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h3
        style={{
          color: "#787fff",
          fontSize: 14,
          fontWeight: 700,
          marginBottom: 12,
          margin: 0,
          paddingBottom: 12,
        }}
      >
        감정 곡선 에디터
      </h3>

      <div
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          paddingBottom: 4,
        }}
      >
      <div
        style={{
          display: "flex",
          gap: 4,
          alignItems: "flex-end",
          minHeight: 160,
          minWidth: cuts.length > 12 ? cuts.length * 44 : undefined,
        }}
      >
        {cuts.map((cut) => {
          const point = getPoint(cut.cutNumber);
          const color = getEmotionColor(point.emotion);

          return (
            <div
              key={cut.cutNumber}
              style={{
                flex: cuts.length <= 12 ? 1 : undefined,
                width: cuts.length > 12 ? 40 : undefined,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                minWidth: 36,
              }}
            >
              {/* Intensity label */}
              <span style={{ color: "#aaa", fontSize: 10 }}>
                {point.intensity}
              </span>

              {/* Bar container */}
              <div
                style={{
                  width: "100%",
                  height: 100,
                  background: "#12121f",
                  borderRadius: 6,
                  position: "relative",
                  display: "flex",
                  alignItems: "flex-end",
                  overflow: "hidden",
                  cursor: "pointer",
                }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const intensity = Math.round(
                    Math.max(0, Math.min(100, (1 - y / rect.height) * 100))
                  );
                  updatePoint(cut.cutNumber, { intensity });
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: `${point.intensity}%`,
                    background: `linear-gradient(180deg, ${color}, ${color}88)`,
                    borderRadius: "4px 4px 0 0",
                    transition: "height 0.2s ease",
                  }}
                />
              </div>

              {/* Emotion dropdown */}
              <select
                value={point.emotion}
                onChange={(e) =>
                  updatePoint(cut.cutNumber, {
                    emotion: e.target.value as EmotionPoint["emotion"],
                  })
                }
                style={{
                  width: "100%",
                  fontSize: 10,
                  padding: "2px 1px",
                  background: "#12121f",
                  color: color,
                  border: `1px solid ${color}66`,
                  borderRadius: 4,
                  outline: "none",
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                {EMOTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {/* Cut number */}
              <span style={{ color: "#666", fontSize: 10 }}>
                #{cut.cutNumber}
              </span>
            </div>
          );
        })}
      </div>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 12,
          paddingTop: 8,
          borderTop: "1px solid #2a2a4a",
        }}
      >
        {EMOTION_OPTIONS.map((opt) => (
          <div
            key={opt.value}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: opt.color,
              }}
            />
            <span style={{ color: "#888", fontSize: 10 }}>{opt.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
