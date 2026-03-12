import { GeminiEnv, fetchWithAuth, buildVertexUrl } from "./_gemini-keys";

type Env = GeminiEnv;

/** 목표 초 수 → 유효한 (장면 수 × 장면당 초) 조합 목록 반환 */
function validCombinations(targetSec: number): string {
  const validDurs = [4, 6, 8, 10, 15];
  const combos: string[] = [];
  for (const dur of validDurs) {
    const cuts = Math.round(targetSec / dur);
    if (cuts >= 4 && cuts <= 10) {
      const actual = cuts * dur;
      if (Math.abs(actual - targetSec) <= targetSec * 0.20) {
        combos.push(`${cuts}장면×${dur}초=${actual}초`);
      }
    }
  }
  return combos.length > 0 ? combos.join(" | ") : "4~10장면 범위에서 가장 근접한 조합 선택";
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { storyText, targetDuration } = await context.request.json() as { storyText: string; targetDuration?: number };

    if (!storyText?.trim()) {
      return Response.json({ error: "storyText is required" }, { status: 400 });
    }

    const durationConstraint = targetDuration
      ? `\n총 영상 길이 목표: ${targetDuration}초\n반드시 recommendedCuts × recommendedDuration ≈ ${targetDuration}초를 만족해야 함 (±20% 허용)\n가능한 조합: ${validCombinations(targetDuration)}\n위 조합 중 이 시나리오에 가장 적합한 것을 하나 선택하라.`
      : "";

    const prompt = `다음 시나리오를 분석하여 YouTube 영상으로 만들 때 적절한 장면 수와 장면당 길이를 추천해주세요.
(장면 = 하나의 영상 클립. 장면 안에서 카메라 무빙/앵글 변화 가능)
${durationConstraint}

시나리오:
"""
${storyText.slice(0, 2000)}
"""

규칙:
- 최소 4장면, 최대 10장면 (10을 절대 초과하지 말 것)
- 내용 전환이 많으면 장면 수 증가 (단, 10 이하)
- 감정 변화가 크면 장면 수 증가 (단, 10 이하)
- 단순 나레이션은 4~6장면으로 충분
${targetDuration ? "- 총 영상 길이 목표가 주어진 경우: 위 \"가능한 조합\" 중 하나를 반드시 선택할 것" : ""}

장면당 초(recommendedDuration) 선택 기준:
- 4초: 짧고 임팩트 있는 액션 컷, 빠른 템포
- 6초: 표준 드라마 컷, 감정 전환 포함
- 8초: 긴 호흡의 감정 씬, 대사가 있는 장면
- 10초: 여유 있는 드라마 씬 (Kling 전용)
- 15초: 긴 씬, 복잡한 행동 (Kling 전용)

JSON으로만 응답 (recommendedCuts는 반드시 4~10 사이):
{
  "recommendedCuts": 숫자(4~10),
  "recommendedDuration": 숫자(4 또는 6 또는 8 또는 10 또는 15),
  "totalSeconds": 숫자(recommendedCuts × recommendedDuration),
  "reason": "추천 이유 (한국어, 1줄 — 장면 수와 초, ${targetDuration ? "총 길이 근거" : "내용 근거"} 포함)",
  "scenes": ["장면1 요약", "장면2 요약", ...]
}`;

    const res = await fetchWithAuth(
      context.env,
      buildVertexUrl(context.env, "gemini-3.1-flash-lite-preview"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini error:", res.status, errText);
      return Response.json({
        error: `AI 분석 실패: ${res.status}`,
        detail: errText.slice(0, 500),
        authMode: context.env.GEMINI_API_KEY ? "api-key" : context.env.GOOGLE_CLOUD_API_KEY ? "cloud-api-key" : "none",
      }, { status: 500 });
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!text) {
      console.error("Gemini returned empty text. Full response:", JSON.stringify(data).slice(0, 500));
      return Response.json({
        error: "AI가 빈 응답을 반환",
        detail: JSON.stringify(data).slice(0, 300),
        recommendedCuts: 8,
        recommendedDuration: 8,
        reason: "분석 실패 - 기본값 8장면 × 8초",
        scenes: [],
      }, { status: 500 });
    }

    let parsed: { recommendedCuts?: number; recommendedDuration?: number; reason?: string; scenes?: string[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error("JSON parse failed. Raw text:", text.slice(0, 500));
      return Response.json({
        error: "AI 응답 파싱 실패",
        detail: text.slice(0, 300),
        recommendedCuts: 8,
        recommendedDuration: 8,
        reason: "분석 실패 - 기본값 8장면 × 8초",
        scenes: [],
      }, { status: 500 });
    }

    const rawCuts = parsed.recommendedCuts ?? 8;
    const rawDur  = parsed.recommendedDuration ?? 8;
    const safeCuts = Math.min(10, Math.max(4, rawCuts));
    const safeDur  = [4, 6, 8, 10, 15].includes(rawDur) ? rawDur : 8;
    return Response.json({
      recommendedCuts:     safeCuts,
      recommendedDuration: safeDur,
      totalSeconds:        safeCuts * safeDur,
      reason:  parsed.reason ?? "",
      scenes:  parsed.scenes ?? [],
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Analyze cuts error:", errMsg);
    return Response.json(
      {
        error: "분석 실패",
        detail: errMsg,
        recommendedCuts: 8,
        recommendedDuration: 8,
        reason: "분석 실패 - 기본값 8장면 × 8초",
        scenes: [],
      },
      { status: 500 }
    );
  }
};
