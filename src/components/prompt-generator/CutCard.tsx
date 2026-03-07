"use client";

import { useState } from "react";
import { Cut } from "@/types";
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
  onUpdate?: (updated: Cut) => void;
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

export default function CutCard({ cut, onUpdate }: CutCardProps) {
  const isEven = cut.cutNumber % 2 === 0;

  const handleFieldSave = (field: keyof Cut, value: string) => {
    if (onUpdate) {
      onUpdate({ ...cut, [field]: value });
    }
  };

  // 글씨 포함 여부 감지 (text, title, caption, subtitle, letter, sign, hangeul, 자막 등)
  const hasText = /text|title|caption|subtitle|letter|sign|hangeul|자막|글씨|텍스트|타이틀/i.test(
    cut.videoPrompt + " " + cut.imagePrompt + " " + cut.sceneDescription
  );

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
          </div>
          <Badge variant="outline" className="text-xs" style={{ borderColor: isEven ? "#fff787" : "#787fff80" }}>
            {cut.transitionHint}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <p className="text-sm">{cut.sceneDescription}</p>

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
              <EditableField
                label="Veo Extend Prompt"
                value={cut.extendPrompt}
                color="#6b5ce7"
                bgColor="#6b5ce710"
                onSave={(v) => handleFieldSave("extendPrompt", v)}
              />
              <div className="space-y-1">
                <span className="text-xs font-medium" style={{ color: "#e09900" }}>
                  캐릭터 일관성
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
