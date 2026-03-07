"use client";

import { useState } from "react";
import { Cut } from "@/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface CutCardProps {
  cut: Cut;
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

export default function CutCard({ cut }: CutCardProps) {
  return (
    <Card className="border-l-4 border-l-primary/60">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="text-xs">
              CUT {cut.cutNumber}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {cut.durationSec}초
            </span>
          </div>
          <Badge variant="outline" className="text-xs">
            {cut.transitionHint}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <p className="text-sm">{cut.sceneDescription}</p>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="font-medium text-muted-foreground">카메라: </span>
            {cut.cameraDirection}
          </div>
          <div>
            <span className="font-medium text-muted-foreground">조명: </span>
            {cut.moodLighting}
          </div>
        </div>

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="prompts" className="border-none">
            <AccordionTrigger className="text-xs py-1 hover:no-underline">
              프롬프트 보기
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Image Prompt
                  </span>
                  <CopyButton text={cut.imagePrompt} label="Image" />
                </div>
                <p className="text-xs bg-muted p-2 rounded-md font-mono leading-relaxed break-all">
                  {cut.imagePrompt}
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Video Prompt
                  </span>
                  <CopyButton text={cut.videoPrompt} label="Video" />
                </div>
                <p className="text-xs bg-muted p-2 rounded-md font-mono leading-relaxed break-all">
                  {cut.videoPrompt}
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
