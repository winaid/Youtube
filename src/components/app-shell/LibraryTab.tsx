"use client";

import { useState } from "react";
import { PromptInput, PromptOutput } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PromptHistoryPanel from "@/components/prompt-generator/PromptHistoryPanel";
import MyVideosPanel from "@/components/prompt-generator/MyVideosPanel";
import VideoHistoryPanel from "@/components/prompt-generator/VideoHistoryPanel";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface LibraryTabProps {
  onRestoreHistory: (input: PromptInput, output: PromptOutput) => void;
}

type LibrarySection = "videos" | "sequences" | "sessions";

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function LibraryTab({
  onRestoreHistory,
}: LibraryTabProps) {
  const [section, setSection] = useState<LibrarySection>("videos");

  return (
    <div className="space-y-4">
      {/* Section Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: "#f1f1f4" }}>
        {[
          { key: "videos" as LibrarySection, label: "생성 영상" },
          { key: "sequences" as LibrarySection, label: "시퀀스 히스토리" },
          { key: "sessions" as LibrarySection, label: "세션 기록" },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setSection(tab.key)}
            className="flex-1 px-3 py-2 rounded-md text-xs font-medium transition-all"
            style={section === tab.key
              ? { background: "white", color: "#1a1a2e", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
              : { color: "#888" }
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {section === "videos" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">생성 영상</CardTitle>
            <p className="text-xs" style={{ color: "#999" }}>
              생성 완료된 영상이 자동으로 기록됩니다. 개별 컷 단위로 조회·재생할 수 있습니다.
            </p>
          </CardHeader>
          <CardContent>
            <MyVideosPanel />
          </CardContent>
        </Card>
      )}

      {section === "sequences" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">시퀀스 히스토리</CardTitle>
            <p className="text-xs" style={{ color: "#999" }}>
              이전에 설계한 시퀀스를 불러와 바로 사용할 수 있습니다. 재분석 없이 즉시 복원됩니다.
            </p>
          </CardHeader>
          <CardContent>
            <PromptHistoryPanel onRestore={onRestoreHistory} />
          </CardContent>
        </Card>
      )}

      {section === "sessions" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">세션 기록</CardTitle>
            <p className="text-xs" style={{ color: "#999" }}>
              현재/이전 세션에서 생성한 영상을 묶어서 확인할 수 있습니다.
            </p>
          </CardHeader>
          <CardContent>
            <VideoHistoryPanel />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
