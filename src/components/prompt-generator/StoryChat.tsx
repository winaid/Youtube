"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage, PromptCard } from "@/types";
import { storyPersonas, shufflePrompts } from "@/data/story-personas";
import { generateChatResponse } from "@/lib/mock-chat";
import {
  ScenarioEntry,
  getScenarioHistory,
  saveScenario,
  deleteScenario,
  extractScenarioTitle,
  extractFinalScenario,
} from "@/lib/scenario-history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

interface StoryChatProps {
  onUseAsScenario?: (scenarioText: string) => void;
}

export default function StoryChat({ onUseAsScenario }: StoryChatProps) {
  const [personas, setPersonas] = useState(() => shufflePrompts(storyPersonas));
  const [personaId, setPersonaId] = useState(storyPersonas[0].id);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ScenarioEntry[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedPersona = personas.find((p) => p.id === personaId)!;

  // Persona-aware UI copy (product-like, not chatbot-like)
  const uiCopy = personaId === "vs-shorts"
    ? {
        headerTitle: "VS 쇼츠 설계기",
        headerDesc: "과학·역사·전략 근거를 바탕으로 VS형 쇼츠 시퀀스를 설계합니다",
        placeholder: "예: 고릴라 vs 북극곰, 로마 군단 vs 몽골 기병, 청나라 시기 영국 vs 현대 중국",
        helperText: "단순 승부 예측이 아니라 비교 조건, 핵심 변수, 반전 포인트를 포함해 쇼츠 구조로 설계합니다",
        emptyChat: "VS 주제를 입력하거나 아래 예시를 선택하세요",
        headerColor: "#6d28d9",
        borderColor: "#8b5cf660",
        bgGradient: "linear-gradient(135deg, #8b5cf620, #3b82f610)",
      }
    : {
        headerTitle: "시나리오 AI 생성",
        headerDesc: "역사 마케팅 사례 발굴 또는 팩트 기반 대체역사 쇼츠를 생성합니다",
        placeholder: "역사 마케팅 또는 '만약에 역사' 주제를 요청해보세요...",
        helperText: "",
        emptyChat: "아래 예시를 클릭하거나 직접 질문해보세요!",
        headerColor: "#7a7000",
        borderColor: "#fff78760",
        bgGradient: "linear-gradient(135deg, #fff78720, #787fff10)",
      };

  // 히스토리 로드
  useEffect(() => {
    setHistory(getScenarioHistory());
  }, []);

  // API로 샘플 프롬프트 동적 생성
  const fetchSuggestedPrompts = useCallback(async (targetPersonaId?: string) => {
    const pid = targetPersonaId ?? personaId;
    const persona = storyPersonas.find((p) => p.id === pid);
    if (!persona) return;

    setIsRefreshing(true);
    try {
      const res = await fetch("/api/suggest-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaId: persona.id,
          personaName: persona.name,
          personaDescription: persona.description,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // 새 카드 형식 우선, fallback으로 기존 string 형식
        if (data.cards && data.cards.length > 0) {
          setPersonas((prev) =>
            prev.map((p) =>
              p.id === pid
                ? { ...p, sampleCards: data.cards, samplePrompts: data.cards.map((c: PromptCard) => c.title) }
                : p
            )
          );
          return;
        }
        if (data.prompts && data.prompts.length > 0) {
          setPersonas((prev) =>
            prev.map((p) =>
              p.id === pid
                ? { ...p, samplePrompts: data.prompts, sampleCards: data.prompts.map((t: string) => ({ title: t, hook: "" })) }
                : p
            )
          );
          return;
        }
      }
    } catch {
      // API 실패 시 로컬 풀에서 셔플
    }
    setPersonas(shufflePrompts(storyPersonas));
    setIsRefreshing(false);
  }, [personaId]);

  useEffect(() => {
    if (isRefreshing) {
      setIsRefreshing(false);
    }
  }, [personas]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefreshPrompts = () => {
    fetchSuggestedPrompts();
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 대화 저장
  const saveCurrentChat = useCallback((msgs: ChatMessage[]) => {
    if (msgs.filter((m) => m.role === "assistant").length === 0) return;
    const persona = storyPersonas.find((p) => p.id === personaId);
    const entry = saveScenario({
      title: extractScenarioTitle(msgs),
      personaId,
      personaName: persona?.name || personaId,
      messages: msgs,
      finalScenario: extractFinalScenario(msgs),
    });
    setCurrentSessionId(entry.id);
    setHistory(getScenarioHistory());
  }, [personaId]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput("");
    const newMsgs: ChatMessage[] = [...messages, { role: "user", content: userMsg }];
    setMessages(newMsgs);
    setIsLoading(true);

    const response = await generateChatResponse(userMsg, personaId);
    const finalMsgs: ChatMessage[] = [
      ...newMsgs,
      {
        role: "assistant",
        content: response.reply,
        sources: response.sources,
        searchQueries: response.searchQueries,
      },
    ];
    setMessages(finalMsgs);
    setIsLoading(false);

    // 자동 저장 (첫 AI 응답 후)
    if (!currentSessionId) {
      saveCurrentChat(finalMsgs);
    }
  };

  const handleSampleClick = (prompt: string) => {
    setInput(prompt);
  };

  const handlePersonaChange = (id: string) => {
    setPersonaId(id);
    setMessages([]);
    setCurrentSessionId(null);
    fetchSuggestedPrompts(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    // 현재 대화 최종 저장
    if (messages.length > 0 && messages.some((m) => m.role === "assistant")) {
      saveCurrentChat(messages);
    }
    setMessages([]);
    setCurrentSessionId(null);
  };

  const handleLoadHistory = (entry: ScenarioEntry) => {
    setMessages(entry.messages);
    setPersonaId(entry.personaId);
    setCurrentSessionId(entry.id);
    setShowHistory(false);
  };

  const handleDeleteHistory = (id: string) => {
    deleteScenario(id);
    setHistory(getScenarioHistory());
    if (currentSessionId === id) {
      setMessages([]);
      setCurrentSessionId(null);
    }
  };

  const handleUseAsScenario = () => {
    const scenario = extractFinalScenario(messages);
    if (scenario && onUseAsScenario) {
      onUseAsScenario(scenario);
    }
  };

  const hasAssistantResponse = messages.some((m) => m.role === "assistant");

  return (
    <Card className="border-2 overflow-hidden" style={{ borderColor: uiCopy.borderColor }}>
      <CardHeader className="pb-3" style={{ background: uiCopy.bgGradient }}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg" style={{ color: uiCopy.headerColor }}>
              {uiCopy.headerTitle}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {uiCopy.headerDesc}
            </p>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={handleNewChat}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors"
              style={{ background: "#787fff15", color: "#787fff", border: "1px solid #787fff30" }}
            >
              새 대화
            </button>
            <button
              onClick={() => { setShowHistory(!showHistory); }}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors"
              style={
                showHistory
                  ? { background: "#fff787", color: "#7a7000" }
                  : { background: "#fff78720", color: "#7a7000", border: "1px solid #fff78740" }
              }
            >
              히스토리 ({history.length})
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        {/* 히스토리 패널 */}
        {showHistory && (
          <div className="rounded-lg border p-2 space-y-1 max-h-[300px] overflow-y-auto" style={{ borderColor: "#fff78740", background: "#fffef5" }}>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">저장된 시나리오가 없습니다</p>
            ) : (
              history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 p-2 rounded-lg transition-colors hover:bg-white group"
                  style={currentSessionId === entry.id ? { background: "#fff78720", border: "1px solid #fff78740" } : {}}
                >
                  <button
                    className="flex-1 text-left min-w-0"
                    onClick={() => handleLoadHistory(entry)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{entry.title}</span>
                      <Badge className="text-[9px] shrink-0" style={{ background: "#787fff15", color: "#787fff" }}>
                        {entry.personaName}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                      {entry.finalScenario.slice(0, 80)}...
                    </p>
                    <span className="text-[9px] text-muted-foreground">
                      {new Date(entry.updatedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </button>
                  <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onUseAsScenario && (
                      <button
                        onClick={() => onUseAsScenario(entry.finalScenario)}
                        className="px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors"
                        style={{ background: "#22c55e15", color: "#16a34a", border: "1px solid #22c55e30" }}
                        title="장면 생성에 사용"
                      >
                        장면
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteHistory(entry.id)}
                      className="px-1.5 py-0.5 rounded text-[9px] text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="삭제"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 페르소나 선택 */}
        <div className="flex flex-wrap gap-1.5">
          {personas.map((p) => (
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
              {uiCopy.emptyChat}
              {uiCopy.helperText && (
                <>
                  <br />
                  <span className="text-[10px]" style={{ color: "#999" }}>{uiCopy.helperText}</span>
                </>
              )}
              {personaId !== "vs-shorts" && (
                <>
                  <br />
                  <span style={{ color: "#22c55e" }}>Google Search로 실제 역사를 검색하여 시나리오에 반영합니다</span>
                </>
              )}
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
                  {msg.role === "assistant"
                    ? msg.content
                        // --- 구분선 이하 모두 제거 (출처 섹션)
                        .replace(/\n{1,}[-—]{2,}[\s\S]*$/, "")
                        // "출처:" 키워드 이하 모두 제거 (--- 없이 바로 쓴 경우)
                        .replace(/\n*[-—]*\s*(?:출처|참고|참조|Source|Reference)[:\s][\s\S]*$/i, "")
                        // 단독 URL 라인 제거
                        .replace(/\n*\[?\d+\]?\s*https?:\/\/\S+/g, "")
                        .trim()
                    : msg.content}
                </div>

                {/* 검색 출처 표시 */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-1.5 px-1" style={{ userSelect: "none" }}>
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

        {/* 장면 생성 버튼 */}
        {hasAssistantResponse && onUseAsScenario && (
          <button
            onClick={handleUseAsScenario}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:shadow-md"
            style={{
              background: "linear-gradient(135deg, #22c55e, #16a34a)",
              color: "white",
              boxShadow: "0 2px 10px #22c55e30",
            }}
          >
            이 시나리오로 장면 생성하기 →
          </button>
        )}

        {/* 샘플 프롬프트 카드 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">주제를 골라보세요</span>
            <button
              onClick={handleRefreshPrompts}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] transition-colors hover:bg-[#fff78730] disabled:opacity-40"
              style={{ color: "#787fff" }}
              title="AI로 새로운 예시 생성"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={isRefreshing ? "animate-spin" : ""}
              >
                <path d="M21.5 2v6h-6" />
                <path d="M2.5 22v-6h6" />
                <path d="M2 11.5a10 10 0 0 1 18.8-4.3" />
                <path d="M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>
              새 주제
            </button>
          </div>

          {isRefreshing ? (
            <div className="flex items-center gap-2 py-3 justify-center text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "#787fff", borderTopColor: "transparent" }} />
              새로운 주제 생성 중...
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {selectedPersona.sampleCards.map((card) => (
                <button
                  key={card.title}
                  className="text-left p-3 rounded-xl transition-all hover:shadow-md hover:scale-[1.01] active:scale-[0.99] group"
                  style={{
                    background: "white",
                    border: "1px solid #fff78760",
                  }}
                  onClick={() => handleSampleClick(card.title)}
                >
                  <p className="text-xs font-semibold leading-snug group-hover:text-[#787fff] transition-colors" style={{ color: "#333" }}>
                    {card.title}
                  </p>
                  {card.hook && (
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                      {card.hook}
                    </p>
                  )}
                  {card.marketingTactic && (
                    <span
                      className="inline-block mt-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium"
                      style={{ background: "#787fff18", color: "#5a5ad4" }}
                    >
                      {card.marketingTactic}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 입력 */}
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={uiCopy.placeholder}
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
