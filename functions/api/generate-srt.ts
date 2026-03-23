import { GeminiEnv, fetchWithModelFallback, geminiErrorResponse, parseFirstJsonArray } from "./_gemini-keys";
import { safeDuration } from "./_duration-constants";

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const startMs = Date.now();
  console.info("[generate-srt] Request received");
  try {
    const { scenes, durationPerScene } = await context.request.json() as {
      scenes: { cutNumber: number; sceneDescription: string; durationSec: number }[];
      durationPerScene?: number;
    };
    console.info(`[generate-srt] Parsed request: scenes=${scenes?.length ?? 0}, durationPerScene=${durationPerScene ?? "(default)"}`);

    if (!scenes?.length) {
      console.info("[generate-srt] Validation failed: scenes array is empty");
      return Response.json({ error: "scenes required" }, { status: 400 });
    }

    const secPerScene = safeDuration(durationPerScene);

    const prompt = `너는 유튜브 쇼츠 자막 전문가야.
아래 장면 설명들을 각 장면 ${secPerScene}초 안에 맞는 자막으로 변환해줘.

장면 목록:
${scenes.map((s) => `장면 ${s.cutNumber} (${s.durationSec}초): ${s.sceneDescription}`).join("\n")}

규칙:
- 각 장면을 2~4개 자막으로 분할
- 한 자막은 1~2줄, 최대 20자/줄
- 시간은 각 장면의 시작 시간부터 계산 (장면1: 0초~, 장면2: ${secPerScene}초~, ...)
- 자막은 나레이션 톤으로 (MZ세대 ~임/~음 체)
- 읽기 속도: 한 자막당 1.5~3초

JSON 배열로 응답:
[
  {"index": 1, "startTime": "00:00:00,000", "endTime": "00:00:02,500", "text": "자막 텍스트"},
  ...
]`;

    console.info(`[generate-srt] Calling Gemini API for SRT generation, elapsed=${Date.now() - startMs}ms`);
    const apiCallStart = Date.now();
    const { response: res } = await fetchWithModelFallback(context.env, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      }),
    });

    console.info(`[generate-srt] Gemini API responded: status=${res.status}, elapsed=${Date.now() - apiCallStart}ms`);

    if (!res.ok) {
      const errText = await res.text();
      console.info(`[generate-srt] Gemini API error: status=${res.status}, body=${errText.slice(0, 200)}, elapsed=${Date.now() - startMs}ms`);
      console.error("SRT generation API error:", res.status, errText);
      return geminiErrorResponse(res, errText, "generate-srt");
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "[]";
    console.info(`[generate-srt] Parsing response: textLen=${text.length}`);
    let subtitles;
    try {
      subtitles = JSON.parse(text);
      console.info(`[generate-srt] JSON.parse succeeded, subtitles count=${Array.isArray(subtitles) ? subtitles.length : "N/A"}`);
    } catch {
      console.info("[generate-srt] JSON.parse failed, trying parseFirstJsonArray fallback");
      subtitles = parseFirstJsonArray(text) ?? [];
      console.info(`[generate-srt] Fallback parse result: subtitles count=${Array.isArray(subtitles) ? subtitles.length : "N/A"}`);
    }

    // SRT 포맷 생성 — 필드 누락 시 해당 항목 스킵
    const validSubs = (Array.isArray(subtitles) ? subtitles : []).filter(
      (sub: Record<string, unknown>) =>
        typeof sub?.startTime === "string" && typeof sub?.endTime === "string" && typeof sub?.text === "string",
    ) as { index: number; startTime: string; endTime: string; text: string }[];
    const srtContent = validSubs
      .map((sub, i) =>
        `${i + 1}\n${sub.startTime} --> ${sub.endTime}\n${sub.text}\n`
      )
      .join("\n");

    console.info(`[generate-srt] Final response: validSubs=${validSubs.length}, srtLen=${srtContent.length}, elapsed=${Date.now() - startMs}ms`);
    return Response.json({ subtitles, srt: srtContent });
  } catch (error) {
    console.info(`[generate-srt] Unhandled error caught: ${error instanceof Error ? error.message : String(error)}, elapsed=${Date.now() - startMs}ms`);
    console.error("SRT generation error:", error);
    return Response.json({ error: "Failed to generate subtitles" }, { status: 500 });
  }
};
