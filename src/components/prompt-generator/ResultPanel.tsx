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
  const [showJson, setShowJson] = useState(false);
  const [jsonCopied, setJsonCopied] = useState(false);

  // 아이들 상태
  if (status === "idle") {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center py-16">
          <div className="text-4xl mb-4">🎬</div>
          <p className="text-muted-foreground text-sm">
            시나리오를 입력하고 감독 스타일을 선택한 후
            <br />
            &quot;프롬프트 생성하기&quot; 버튼을 눌러주세요.
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
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">
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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{result.projectTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {result.conceptSummary}
          </p>

          <div className="flex items-center gap-2">
            <Badge variant="secondary">총 {result.totalCuts}컷</Badge>
          </div>

          <Separator />

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Global Style Prompt
            </p>
            <p className="text-xs bg-muted p-2 rounded-md font-mono break-all">
              {result.globalStylePrompt}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
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

      {/* JSON 보기 토글 */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowJson(!showJson)}
            >
              {showJson ? "JSON 숨기기" : "전체 결과 JSON 보기"}
            </Button>
            {showJson && (
              <Button variant="ghost" size="sm" onClick={handleCopyJson}>
                {jsonCopied ? "복사됨!" : "JSON 복사"}
              </Button>
            )}
          </div>
          {showJson && (
            <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-96 overflow-y-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
