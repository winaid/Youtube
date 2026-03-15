"use client";

import { useState } from "react";
import { PromptOutput } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import dynamic from "next/dynamic";

const StoryChat = dynamic(() => import("@/components/prompt-generator/StoryChat"), { ssr: false });
const NodeCanvas = dynamic(() => import("@/components/prompt-generator/NodeCanvas"), { ssr: false });

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface ExtrasTabProps {
  result: PromptOutput | null;
  onUpdateResult: (result: PromptOutput) => void;
  onUseAsScenario: (text: string) => void;
}

type ExtrasSection = "story" | "canvas" | "about";

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function ExtrasTab({
  result,
  onUpdateResult: _onUpdateResult,
  onUseAsScenario,
}: ExtrasTabProps) {
  const [section, setSection] = useState<ExtrasSection>("story");

  return (
    <div className="space-y-4">
      {/* Section Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: "#f1f1f4" }}>
        {[
          { key: "story" as ExtrasSection, label: "시나리오 AI" },
          { key: "canvas" as ExtrasSection, label: "노드 캔버스" },
          { key: "about" as ExtrasSection, label: "도구 정보" },
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
      {section === "story" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">시나리오 AI</CardTitle>
            <p className="text-xs" style={{ color: "#999" }}>
              AI와 대화하며 영상 시나리오를 구상하세요. 완성된 시나리오는 Plan 탭에서 바로 사용할 수 있습니다.
            </p>
          </CardHeader>
          <CardContent>
            <StoryChat onUseAsScenario={onUseAsScenario} />
          </CardContent>
        </Card>
      )}

      {section === "canvas" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">노드 캔버스</CardTitle>
            <p className="text-xs" style={{ color: "#999" }}>
              Generate Image → Generate Video → Viewer 노드를 연결하여 워크플로우를 구성하세요.
            </p>
          </CardHeader>
          <CardContent>
            <NodeCanvas
              onSendToTimeline={() => {}}
              importableOutput={result}
              onExportToEditor={() => {}}
              onMergeToEditor={() => {}}
            />
          </CardContent>
        </Card>
      )}

      {section === "about" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">CineForge 정보</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-medium mb-1">Kling O3 Shortform Cinematic Production System</h3>
                <p className="text-xs" style={{ color: "#666" }}>
                  3~15초 리텐션 최적화 멀티샷 영상을 설계하고 생성하는 프로덕션 워크플로우 시스템입니다.
                </p>
              </div>

              <div>
                <h4 className="text-xs font-medium mb-1">지원 워크플로우</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {[
                    { name: "Text → Video", desc: "텍스트 프롬프트에서 영상 생성" },
                    { name: "Image → Video", desc: "스토리보드/참조 이미지에서 영상 생성" },
                    { name: "Reference → Video", desc: "레퍼런스 기반 일관성 생성" },
                    { name: "Video Edit", desc: "기존 영상 수정 및 리터칭" },
                    { name: "Custom Element", desc: "캐릭터/주체 일관성 에셋 등록" },
                  ].map(w => (
                    <div key={w.name} className="p-2 rounded border text-xs">
                      <span className="font-medium">{w.name}</span>
                      <p style={{ color: "#999" }}>{w.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-medium mb-1">핵심 개념</h4>
                <ul className="text-xs space-y-1" style={{ color: "#666" }}>
                  <li>• <strong>시퀀스</strong> — 의미 있는 멀티샷 영상 계획</li>
                  <li>• <strong>샷 역할</strong> — 도입/전개/절정/마무리/삽입/전환</li>
                  <li>• <strong>런타임 예산</strong> — 배치 전체 생성 시간 관리</li>
                  <li>• <strong>Studio 모드</strong> — 정밀 검토와 정제</li>
                  <li>• <strong>Batch 모드</strong> — 빠른 대량 생성</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
