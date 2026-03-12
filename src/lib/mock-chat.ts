import { storyPersonas } from "@/data/story-personas";

export interface ChatResponseData {
  reply: string;
  sources?: { title: string; url: string }[];
  searchQueries?: string[];
}

export async function generateChatResponse(
  userMessage: string,
  personaId: string
): Promise<ChatResponseData> {
  const persona = storyPersonas.find((p) => p.id === personaId);
  if (!persona) return { reply: "페르소나를 찾을 수 없습니다." };

  try {
    const res = await fetch("/api/generate-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userMessage,
        personaId: persona.id,
        personaName: persona.name,
        personaDescription: persona.description,
        personaPrompt: persona.persona,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({} as Record<string, unknown>));
      console.error("Chat API error:", err);
      const code = (err as Record<string, unknown>).code as string | undefined;
      const help = (err as Record<string, unknown>).help as string | undefined;
      const errorMsg = (err as Record<string, unknown>).error as string | undefined;
      if (code === "MISSING_API_KEY") {
        return { reply: `⚠️ GEMINI_API_KEY가 설정되지 않았습니다.\n\n${help || "Cloudflare Pages 환경변수에서 설정하세요."}` };
      }
      if (code === "MODEL_NOT_FOUND") {
        return { reply: `⚠️ Gemini 모델이 변경되었습니다.\n\n${help || "_gemini-keys.ts 모델 상수를 업데이트하세요."}` };
      }
      if (code === "INVALID_API_KEY") {
        return { reply: `⚠️ API 키가 유효하지 않습니다.\n\n${help || "Google AI Studio에서 키를 재발급하세요."}` };
      }
      if (code === "QUOTA_EXCEEDED" || code === "RATE_LIMITED") {
        return { reply: `⚠️ API 할당량 초과.\n\n${help || "잠시 후 다시 시도하세요."}` };
      }
      return { reply: `API 오류 (${res.status}): ${errorMsg || "알 수 없는 오류"}\n\n${help || "잠시 후 다시 시도해주세요."}` };
    }

    const data = await res.json();
    return {
      reply: data.reply || "응답을 생성하지 못했습니다.",
      sources: data.sources,
      searchQueries: data.searchQueries,
    };
  } catch (error) {
    console.error("Chat fetch error:", error);
    return { reply: "네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요." };
  }
}
