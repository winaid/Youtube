"use client";

import { useState } from "react";
import { PromptOutput, GeneratorStatus } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import CutCard from "./CutCard";

interface ResultPanelProps {
  result: PromptOutput | null;
  status: GeneratorStatus;
  error: string | null;
}

export default function ResultPanel({
  result,
  status,
  error,
}: ResultPanelProps) {
  const [jsonCopied, setJsonCopied] = useState(false);

  // 아이들 상태
  if (status === "idle") {
    return (
      <Card className="h-full flex items-center justify-center border-2 border-dashed" style={{ borderColor: "#787fff30" }}>
        <CardContent className="text-center py-16">
          <div className="text-5xl mb-4" style={{ filter: "drop-shadow(0 4px 8px #787fff40)" }}>🎬</div>
          <p className="text-muted-foreground text-sm">
            시나리오를 입력하고 감독 스타일을 선택한 후
            <br />
            <span style={{ color: "#787fff", fontWeight: 600 }}>&quot;프롬프트 생성하기&quot;</span> 버튼을 눌러주세요.
          </p>
        </CardContent>
      </Card>
    );
  }

  // 로딩 상태
  if (status === "loading") {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent mx-auto mb-4" style={{ borderColor: "#787fff", borderTopColor: "transparent" }} />
          <p className="text-sm font-medium" style={{ color: "#787fff" }}>
            감독의 시선으로 컷 리스트를 구성하고 있습니다...
          </p>
        </CardContent>
      </Card>
    );
  }

  // 에러 상태
  if (status === "error") {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center py-16">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-destructive text-sm font-medium">
            프롬프트 생성 중 오류가 발생했습니다.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {error ?? "알 수 없는 오류"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!result) return null;

  const handleCopyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setJsonCopied(true);
    setTimeout(() => setJsonCopied(false), 1500);
  };

  return (
    <div className="space-y-4">
      {/* 프로젝트 요약 */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3" style={{ background: "linear-gradient(135deg, #787fff15, #fff78725)" }}>
          <CardTitle className="text-lg" style={{ color: "#5a5ecc" }}>{result.projectTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm text-muted-foreground">
            {result.conceptSummary}
          </p>

          <div className="flex items-center gap-2">
            <Badge style={{ background: "#787fff", color: "white" }}>총 {result.totalCuts}컷</Badge>
          </div>

          <Separator style={{ background: "linear-gradient(to right, #787fff40, #fff78740)" }} />

          <div className="space-y-1">
            <p className="text-xs font-medium" style={{ color: "#787fff" }}>
              Global Style Prompt
            </p>
            <p className="text-xs p-2 rounded-md font-mono break-all" style={{ background: "#787fff10" }}>
              {result.globalStylePrompt}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium" style={{ color: "#c4b800" }}>
              연속성 규칙
            </p>
            <ul className="text-xs space-y-0.5 list-disc list-inside text-muted-foreground">
              {result.continuityRules.map((rule, i) => (
                <li key={i}>{rule}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* 컷 리스트 */}
      <div className="space-y-3">
        {result.cuts.map((cut) => (
          <CutCard key={cut.cutNumber} cut={cut} />
        ))}
      </div>

      {/* JSON 복사 */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyJson}
              style={{ borderColor: "#787fff60", color: "#787fff" }}
            >
              {jsonCopied ? "복사됨!" : "전체 JSON 프롬프트 복사"}
            </Button>
            <span className="text-xs text-muted-foreground">
              상세 프롬프트를 JSON으로 복사하여 활용하세요
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
