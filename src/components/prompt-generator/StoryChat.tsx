"use client";

import { useState, useRef, useEffect } from "react";
import { ChatMessage } from "@/types";
import { storyPersonas } from "@/data/story-personas";
import { generateChatResponse } from "@/lib/mock-chat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

export default function StoryChat() {
  const [personaId, setPersonaId] = useState(storyPersonas[0].id);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedPersona = storyPersonas.find((p) => p.id === personaId)!;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsLoading(true);

    const response = await generateChatResponse(userMsg, personaId);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: response.reply,
        sources: response.sources,
        searchQueries: response.searchQueries,
      },
    ]);
    setIsLoading(false);
  };

  const handleSampleClick = (prompt: string) => {
    setInput(prompt);
  };

  const handlePersonaChange = (id: string) => {
    setPersonaId(id);
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Card className="border-2 overflow-hidden" style={{ borderColor: "#fff78760" }}>
      <CardHeader className="pb-3" style={{ background: "linear-gradient(135deg, #fff78720, #787fff10)" }}>
        <CardTitle className="text-lg" style={{ color: "#7a7000" }}>
          시나리오 AI 생성
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          실제 역사를 검색하여 병의원 마케팅 쇼츠 시나리오를 만들어줍니다
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        {/* 페르소나 선택 */}
        <div className="flex flex-wrap gap-1.5">
          {storyPersonas.map((p) => (
            <Badge
              key={p.id}
              className="cursor-pointer text-xs transition-all"
              style={
                personaId === p.id
                  ? { background: "#787fff", color: "white" }
                  : { background: "#787fff15", color: "#787fff", border: "1px solid #787fff40" }
              }
              onClick={() => handlePersonaChange(p.id)}
            >
              {p.name}
            </Badge>
          ))}
        </div>

        {/* 채팅 영역 */}
        <div className="rounded-lg border p-3 space-y-3 max-h-[500px] overflow-y-auto min-h-[120px]" style={{ borderColor: "#787fff20", background: "#fafafa" }}>
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              아래 예시를 클릭하거나 직접 질문해보세요!
              <br />
              <span style={{ color: "#22c55e" }}>Google Search로 실제 역사를 검색하여 시나리오에 반영합니다</span>
            </p>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className="max-w-[85%]">
                <div
                  className="rounded-xl px-3 py-2 text-xs whitespace-pre-line leading-relaxed"
                  style={
                    msg.role === "user"
                      ? { background: "#787fff", color: "white" }
                      : { background: "white", border: "1px solid #787fff20" }
                  }
                >
                  {msg.content}
                </div>

                {/* 검색 출처 표시 */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-1.5 px-1">
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-[9px] font-medium" style={{ color: "#22c55e" }}>
                        검색 출처
                      </span>
                      {msg.searchQueries && msg.searchQueries.length > 0 && (
                        <span className="text-[8px] text-muted-foreground">
                          ({msg.searchQueries.slice(0, 2).join(", ")})
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {msg.sources.slice(0, 5).map((source, si) => (
                        <a
                          key={si}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full transition-colors hover:opacity-80"
                          style={{ background: "#22c55e15", color: "#16a34a", border: "1px solid #22c55e30" }}
                        >
                          {source.title.slice(0, 30)}{source.title.length > 30 ? "..." : ""}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="rounded-xl px-3 py-2 text-xs flex items-center gap-2" style={{ background: "white", border: "1px solid #787fff20" }}>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "#787fff", borderTopColor: "transparent" }} />
                역사 검색 & 시나리오 작성 중...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 샘플 프롬프트 */}
        <div className="flex flex-wrap gap-1.5">
          {selectedPersona.samplePrompts.map((prompt) => (
            <Badge
              key={prompt}
              variant="outline"
              className="cursor-pointer text-xs transition-colors"
              style={{ borderColor: "#fff78780" }}
              onClick={() => handleSampleClick(prompt)}
            >
              {prompt}
            </Badge>
          ))}
        </div>

        {/* 입력 */}
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="병의원 마케팅 쇼츠 시나리오를 요청해보세요..."
            rows={2}
            className="resize-none flex-1 text-sm focus-visible:ring-[#fff787]"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="self-end text-white"
            style={{ background: "linear-gradient(135deg, #c4b800, #787fff)", boxShadow: "0 2px 8px #fff78740" }}
          >
            전송
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
