import { GeminiEnv, fetchWithAuth } from "./_gemini-keys";

type Env = GeminiEnv;

const GEMINI_API_URL =
  "https://aiplatform.googleapis.com/v1beta/publishers/google/models/gemini-3-pro-preview:generateContent";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { scenes, durationPerScene } = await context.request.json() as {
      scenes: { cutNumber: number; sceneDescription: string; durationSec: number }[];
      durationPerScene?: number;
    };

    if (!scenes?.length) {
      return Response.json({ error: "scenes required" }, { status: 400 });
    }

    const secPerScene = durationPerScene || 8;

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

    const res = await fetchWithAuth(context.env, GEMINI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("SRT generation API error:", res.status, errText);
      return Response.json({ error: `API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "[]";
    const subtitles = JSON.parse(text);

    // SRT 포맷 생성
    const srtContent = (subtitles as { index: number; startTime: string; endTime: string; text: string }[])
      .map((sub, i) =>
        `${i + 1}\n${sub.startTime} --> ${sub.endTime}\n${sub.text}\n`
      )
      .join("\n");

    return Response.json({ subtitles, srt: srtContent });
  } catch (error) {
    console.error("SRT generation error:", error);
    return Response.json({ error: "Failed to generate subtitles" }, { status: 500 });
  }
};
