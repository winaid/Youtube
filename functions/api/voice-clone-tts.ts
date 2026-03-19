import { GeminiEnv, fetchWithModelFallback, geminiErrorResponse, parseFirstJsonObject } from "./_gemini-keys";

type Env = GeminiEnv;

// Gemini 기반 캐릭터별 보이스 스크립트 생성 + 립싱크 타이밍
export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { characters, sceneDescription, cutNumber, dialogues } =
      await context.request.json() as {
        characters: { id: string; label: string; voiceStyle?: string }[];
        sceneDescription: string;
        cutNumber: number;
        dialogues?: { characterId: string; text: string }[];
      };

    if (!characters?.length) {
      return Response.json({ error: "characters required" }, { status: 400 });
    }

    const prompt = `You are an AI voice director. Generate character voice scripts with lip-sync timing markers.

## Scene: CUT ${cutNumber}
${sceneDescription}

## Characters:
${characters.map((c) => `- ${c.label} (${c.id}): Voice style: ${c.voiceStyle || "자연스러운 한국어"}`).join("\n")}

${dialogues ? `## Existing Dialogues:\n${dialogues.map((d) => `${d.characterId}: "${d.text}"`).join("\n")}` : "## Task: Generate appropriate dialogues for this scene based on the description."}

## Output JSON only (no markdown):
{
  "dialogues": [
    {
      "characterId": "char-1",
      "text": "대사 텍스트",
      "emotion": "happy|sad|angry|calm|excited|scared",
      "timing": { "startSec": 0.0, "endSec": 2.5 },
      "voiceDirection": "부드럽게, 낮은 톤으로",
      "lipSyncPhonemes": "ㅎ-ㅏ-ㄴ-ㅏ ㅂ-ㅏ-ㄱ"
    }
  ],
  "silentMoments": [
    { "startSec": 2.5, "endSec": 3.0, "action": "표정 변화" }
  ],
  "backgroundAudio": "ambient city noise, distant traffic"
}`;

    const { response: res } = await fetchWithModelFallback(context.env, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 4096 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Voice clone TTS error:", res.status, errText);
      return geminiErrorResponse(res, errText, "voice-clone-tts");
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = parseFirstJsonObject(text) ?? { error: "Failed to parse" };
    }

    return Response.json(parsed);
  } catch (error) {
    console.error("Voice clone TTS error:", error);
    return Response.json({ error: "Failed to generate voice script" }, { status: 500 });
  }
};
