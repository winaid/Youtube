import { storyPersonas } from "@/data/story-personas";

export async function generateChatResponse(
  userMessage: string,
  personaId: string
): Promise<string> {
  const persona = storyPersonas.find((p) => p.id === personaId);
  if (!persona) return "페르소나를 찾을 수 없습니다.";

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
      const err = await res.json().catch(() => ({}));
      console.error("Chat API error:", err);
      return `API 오류가 발생했습니다 (${res.status}). 잠시 후 다시 시도해주세요.`;
    }

    const data = await res.json();
    return data.reply || "응답을 생성하지 못했습니다.";
  } catch (error) {
    console.error("Chat fetch error:", error);
    return "네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.";
  }
}
