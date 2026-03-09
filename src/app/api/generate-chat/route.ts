import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/vertex-auth";

export async function POST(req: NextRequest) {
  try {
    const { messages, persona, samplePrompts } = await req.json();

    const systemContext = `당신은 ${persona?.name ?? "AI 시나리오 작가"}입니다.
${persona?.persona ?? "창의적인 이야기를 만들어주는 AI 어시스턴트입니다."}

사용자가 영상으로 만들 시나리오 아이디어를 발전시키도록 도와주세요.
대화가 충분히 발전되면 "이 이야기를 영상으로 만들어드릴까요?"라고 제안하세요.`;

    const conversation = (messages ?? [])
      .map((m: { role: string; content: string }) => `${m.role === "user" ? "사용자" : "AI"}: ${m.content}`)
      .join("\n");

    const lastMessage = messages?.[messages.length - 1]?.content ?? "";

    const prompt = `${systemContext}

이전 대화:
${conversation}

사용자 최신 메시지: ${lastMessage}

자연스럽고 창의적으로 응답하세요. 영상 시나리오로 발전시킬 수 있는 방향으로 유도하세요.
응답은 2-4문장으로 간결하게.`;

    const response = await callGemini(prompt, { temperature: 0.8, maxTokens: 512 });
    return NextResponse.json({ response: response.trim() });
  } catch (err) {
    console.error("[generate-chat]", err);
    return NextResponse.json({ error: "채팅 응답 실패" }, { status: 500 });
  }
}
