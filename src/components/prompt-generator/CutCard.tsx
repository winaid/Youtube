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

interface CutCardProps {
  cut: Cut;
  characterSeeds?: CharacterSeed[];
  onUpdate?: (updated: Cut) => void;
  storyboardImage?: string;
  storyboardLoading?: boolean;
  onGenerateImage?: () => void;
  sceneTtsUrl?: string;
  sceneTtsLoading?: boolean;
  onGenerateSceneTts?: () => void;
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
  storyboardImage, storyboardLoading, onGenerateImage,
  sceneTtsUrl, sceneTtsLoading, onGenerateSceneTts,
}: CutCardProps) {
  const isEven = cut.cutNumber % 2 === 0;

  const handleFieldSave = (field: keyof Cut, value: string) => {
    if (onUpdate) {
      onUpdate({ ...cut, [field]: value });
    }
  };

  const hasText = /text|title|caption|subtitle|letter|sign|hangeul|자막|글씨|텍스트|타이틀/i.test(
    cut.videoPrompt + " " + cut.imagePrompt + " " + cut.sceneDescription
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
        {/* 스토리보드 이미지 + 장면 설명 */}
        <div className="flex gap-3">
          <div className="flex-1">
            <p className="text-sm">{cut.sceneDescription}</p>
          </div>
          {storyboardImage ? (
            <div className="shrink-0 w-24 h-24 rounded-lg overflow-hidden border" style={{ borderColor: isEven ? "#fff78740" : "#787fff40" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/png;base64,${storyboardImage}`} alt={`장면 ${cut.cutNumber}`} className="w-full h-full object-cover" />
            </div>
          ) : onGenerateImage ? (
            <button
              onClick={onGenerateImage}
              disabled={storyboardLoading}
              className="shrink-0 w-24 h-24 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors hover:bg-gray-50"
              style={{ borderColor: "#787fff30" }}
            >
              {storyboardLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "#787fff", borderTopColor: "transparent" }} />
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#787fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                    <circle cx="9" cy="9" r="2"/>
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                  </svg>
                  <span className="text-[9px]" style={{ color: "#787fff" }}>이미지</span>
                </>
              )}
            </button>
          ) : null}
        </div>

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

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="prompts" className="border-none">
            <AccordionTrigger className="text-xs py-1 hover:no-underline" style={{ color: "#787fff" }}>
              프롬프트 보기 / 수정하기
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              <EditableField
                label="Image Prompt (Veo 참조)"
                value={cut.imagePrompt}
                color="#787fff"
                bgColor="#787fff10"
                onSave={(v) => handleFieldSave("imagePrompt", v)}
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
