"use client";

import { useState } from "react";
import { Cut, CharacterSeed } from "@/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cameraPresets, categoryLabels, type CameraPreset } from "@/data/camera-presets";
import { motionLevels } from "@/data/motion-intensity-presets";

interface CutCardProps {
  cut: Cut;
  characterSeeds?: CharacterSeed[];
  onUpdate?: (updated: Cut) => void;
  storyboardImage?: string;
  storyboardCandidates?: string[];
  storyboardLoading?: boolean;
  onGenerateImage?: () => void;
  onSelectCandidate?: (base64: string) => void;
  storyboardEndImage?: string;
  storyboardEndLoading?: boolean;
  onGenerateEndImage?: () => void;
  sceneTtsUrl?: string;
  sceneTtsLoading?: boolean;
  onGenerateSceneTts?: () => void;
  onFeedbackRefine?: (cutNumber: number, feedback: string) => Promise<void>;
  onEnglishRefine?: (cutNumber: number) => Promise<void>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 text-xs"
      onClick={handleCopy}
    >
      {copied ? "복사됨!" : `${label} 복사`}
    </Button>
  );
}

function EditableField({
  label,
  value,
  color,
  bgColor,
  onSave,
}: {
  label: string;
  value: string;
  color: string;
  bgColor: string;
  onSave: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color }}>{label}</span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => { onSave(draft); setEditing(false); }}
              style={{ color: "#22c55e" }}
            >
              저장
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => { setDraft(value); setEditing(false); }}
            >
              취소
            </Button>
          </div>
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="text-xs font-mono"
          style={{ background: bgColor }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color }}>{label}</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setEditing(true)}
          >
            수정
          </Button>
          <CopyButton text={value} label={label.split(" ")[0]} />
        </div>
      </div>
      <p
        className="text-xs p-2 rounded-md font-mono leading-relaxed break-all cursor-pointer hover:ring-1 hover:ring-offset-1 transition-all"
        style={{ background: bgColor, "--tw-ring-color": color } as React.CSSProperties}
        onClick={() => setEditing(true)}
      >
        {value}
      </p>
    </div>
  );
}

export default function CutCard({
  cut, characterSeeds, onUpdate,
  storyboardImage, storyboardCandidates, storyboardLoading, onGenerateImage, onSelectCandidate,
  storyboardEndImage, storyboardEndLoading, onGenerateEndImage,
  sceneTtsUrl, sceneTtsLoading, onGenerateSceneTts,
  onFeedbackRefine, onEnglishRefine,
}: CutCardProps) {
  const isEven = cut.cutNumber % 2 === 0;
  const [feedbackText, setFeedbackText] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [refining, setRefining] = useState(false);
  const [englishRefining, setEnglishRefining] = useState(false);
  const [showPresets, setShowPresets] = useState(false);

  const handleFieldSave = (field: keyof Cut, value: string) => {
    if (onUpdate) {
      onUpdate({ ...cut, [field]: value });
    }
  };

  const hasText = /\b(text overlay|title card|caption|subtitle|on-screen text|hangeul text|자막|글씨|텍스트|타이틀)\b/i.test(
    cut.videoPrompt
  );

  // 이 장면에 등장하는 캐릭터들
  const charsInScene = characterSeeds?.filter(
    (s) => cut.charactersInScene?.includes(s.id)
  ) ?? [];

  return (
    <Card
      className="border-l-4 overflow-hidden"
      style={{ borderLeftColor: isEven ? "#fff787" : "#787fff" }}
    >
      <CardHeader className="pb-2 pt-4 px-4" style={{ background: isEven ? "#fff78708" : "#787fff08" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge
              className="text-xs text-white"
              style={{ background: isEven ? "#c4b800" : "#787fff" }}
            >
              CUT {cut.cutNumber}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {cut.durationSec}초
            </span>
            <Badge
              variant="outline"
              className="text-xs"
              style={{
                borderColor: hasText ? "#e09900" : "#22c55e",
                color: hasText ? "#e09900" : "#22c55e",
              }}
            >
              {hasText ? "Veo 3.1 Quality" : "Veo 3.1 Fast"}
            </Badge>
            {cut.cutNumber === 1 ? (
              <Badge className="text-xs" style={{ background: "#787fff30", color: "#5a5ecc" }}>
                Video Prompt
              </Badge>
            ) : (
              <Badge className="text-xs" style={{ background: "#6b5ce720", color: "#6b5ce7" }}>
                Extend
              </Badge>
            )}
          </div>
          <Badge variant="outline" className="text-xs" style={{ borderColor: isEven ? "#fff787" : "#787fff80" }}>
            {cut.transitionHint}
          </Badge>
        </div>

        {/* 등장 캐릭터 */}
        {charsInScene.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="text-[10px] text-muted-foreground">등장:</span>
            {charsInScene.map((ch) => (
              <Badge
                key={ch.id}
                variant="outline"
                className="text-[10px] py-0"
                style={{ borderColor: "#e09900", color: "#e09900" }}
                title={ch.appearance}
              >
                {ch.label}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {/* 장면 설명 */}
        <p className="text-sm">{cut.sceneDescription}</p>

        {/* 장면별 TTS */}
        {onGenerateSceneTts && (
          <div className="flex items-center gap-2">
            {sceneTtsUrl ? (
              <audio controls src={sceneTtsUrl} className="h-7 flex-1" style={{ maxWidth: 200 }} />
            ) : (
              <button
                onClick={onGenerateSceneTts}
                disabled={sceneTtsLoading}
                className="text-[10px] px-2 py-1 rounded-md transition-colors"
                style={{ background: "#7c3aed10", color: "#7c3aed", border: "1px solid #7c3aed20" }}
              >
                {sceneTtsLoading ? "생성 중..." : "나레이션 생성"}
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="font-medium" style={{ color: "#787fff" }}>카메라: </span>
            {cut.cameraDirection}
          </div>
          <div>
            <span className="font-medium" style={{ color: "#c4b800" }}>조명: </span>
            {cut.moodLighting}
          </div>
        </div>

        {/* Camera Preset Selector */}
        <div>
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="text-[10px] px-2 py-1 rounded-md transition-colors"
            style={{ background: "#787fff10", color: "#787fff", border: "1px solid #787fff20" }}
          >
            {showPresets ? "프리셋 닫기" : "카메라 프리셋 적용"}
          </button>
          {showPresets && (
            <div className="mt-2 p-2 rounded-lg space-y-2" style={{ background: "#787fff05", border: "1px solid #787fff15" }}>
              {Object.entries(
                cameraPresets.reduce<Record<string, CameraPreset[]>>((acc, p) => {
                  if (!acc[p.category]) acc[p.category] = [];
                  acc[p.category].push(p);
                  return acc;
                }, {})
              ).map(([cat, presets]) => (
                <div key={cat}>
                  <p className="text-[10px] font-medium mb-1" style={{ color: "#787fff" }}>
                    {categoryLabels[cat] || cat}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {presets.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => {
                          if (onUpdate) {
                            onUpdate({
                              ...cut,
                              cameraDirection: preset.cameraDirection,
                              videoPrompt: cut.videoPrompt.replace(
                                /Camera[^.]*\./i,
                                preset.cameraDirection + "."
                              ),
                            });
                          }
                          setShowPresets(false);
                        }}
                        className="text-[10px] px-2 py-1 rounded-md transition-all hover:scale-105"
                        style={{
                          background: "#fff",
                          border: "1px solid #787fff30",
                          color: "#333",
                        }}
                        title={`${preset.description}\n적합: ${preset.bestFor}\n\n${preset.cameraDirection}`}
                      >
                        {preset.nameKo}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 모션 강도 컨트롤 */}
        {onUpdate && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium" style={{ color: "#787fff" }}>모션:</span>
            <div className="flex gap-0.5">
              {motionLevels.map((ml) => (
                <button
                  key={ml.level}
                  onClick={() => {
                    const currentKeywords = motionLevels.find((m) =>
                      cut.cameraDirection.toLowerCase().includes(m.cameraKeywords.split(",")[0].trim().toLowerCase())
                    );
                    let newDirection = cut.cameraDirection;
                    if (currentKeywords) {
                      newDirection = newDirection.replace(
                        new RegExp(currentKeywords.cameraKeywords.split(",")[0].trim(), "i"),
                        ml.cameraKeywords.split(",")[0].trim()
                      );
                    }
                    onUpdate({ ...cut, cameraDirection: newDirection });
                  }}
                  className="text-[9px] px-1.5 py-0.5 rounded transition-all"
                  style={{
                    background: cut.cameraDirection.toLowerCase().includes(ml.cameraKeywords.split(",")[0].trim().toLowerCase().slice(0, 10))
                      ? "#787fff" : "#f5f5f5",
                    color: cut.cameraDirection.toLowerCase().includes(ml.cameraKeywords.split(",")[0].trim().toLowerCase().slice(0, 10))
                      ? "white" : "#666",
                  }}
                  title={ml.description}
                >
                  {ml.nameKo}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Enhancement 2: Feedback loop + Enhancement 3: English refine */}
        <div className="flex gap-1.5 flex-wrap">
          {onFeedbackRefine && (
            <button
              onClick={() => setShowFeedback(!showFeedback)}
              className="text-[10px] px-2 py-1 rounded-md transition-colors"
              style={{ background: "#787fff10", color: "#787fff", border: "1px solid #787fff20" }}
            >
              {showFeedback ? "피드백 닫기" : "장면 피드백"}
            </button>
          )}
          {onEnglishRefine && (
            <button
              onClick={async () => {
                setEnglishRefining(true);
                await onEnglishRefine(cut.cutNumber);
                setEnglishRefining(false);
              }}
              disabled={englishRefining}
              className="text-[10px] px-2 py-1 rounded-md transition-colors"
              style={{ background: "#7c3aed10", color: "#7c3aed", border: "1px solid #7c3aed20" }}
            >
              {englishRefining ? "교정 중..." : "영어 네이티브 교정"}
            </button>
          )}
        </div>

        {/* Enhancement 2: Feedback input */}
        {showFeedback && onFeedbackRefine && (
          <div className="space-y-1.5 p-2 rounded-lg" style={{ background: "#787fff08", border: "1px solid #787fff15" }}>
            <Textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              rows={2}
              className="text-xs"
              placeholder="이 장면의 어떤 부분을 수정하고 싶으세요? (예: 카메라 앵글을 더 낮게, 표정을 더 밝게)"
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-6 text-[10px] text-white"
                style={{ background: "#787fff" }}
                disabled={!feedbackText.trim() || refining}
                onClick={async () => {
                  setRefining(true);
                  await onFeedbackRefine(cut.cutNumber, feedbackText);
                  setRefining(false);
                  setFeedbackText("");
                  setShowFeedback(false);
                }}
              >
                {refining ? "개선 중..." : "프롬프트 개선"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={() => { setShowFeedback(false); setFeedbackText(""); }}
              >
                취소
              </Button>
            </div>
          </div>
        )}

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="prompts" className="border-none">
            <AccordionTrigger className="text-xs py-1 hover:no-underline" style={{ color: "#787fff" }}>
              프롬프트 보기 / 수정하기
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              <EditableField
                label="시작 프레임 Image Prompt"
                value={cut.imagePrompt}
                color="#787fff"
                bgColor="#787fff10"
                onSave={(v) => handleFieldSave("imagePrompt", v)}
              />
              <EditableField
                label="끝 프레임 End Image Prompt"
                value={cut.endImagePrompt || ""}
                color="#22c55e"
                bgColor="#22c55e10"
                onSave={(v) => handleFieldSave("endImagePrompt", v)}
              />
              <EditableField
                label="Veo Video Prompt (8초)"
                value={cut.videoPrompt}
                color="#c4b800"
                bgColor="#fff78720"
                onSave={(v) => handleFieldSave("videoPrompt", v)}
              />
              {cut.cutNumber > 1 && (
                <EditableField
                  label="Veo Extend Prompt (이전 클립 연장)"
                  value={cut.extendPrompt}
                  color="#6b5ce7"
                  bgColor="#6b5ce710"
                  onSave={(v) => handleFieldSave("extendPrompt", v)}
                />
              )}
              <div className="space-y-1">
                <span className="text-xs font-medium" style={{ color: "#e09900" }}>
                  캐릭터 일관성 지침
                </span>
                <p className="text-xs p-2 rounded-md leading-relaxed" style={{ background: "#fff78710", border: "1px dashed #fff78760" }}>
                  {cut.characterConsistency}
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
