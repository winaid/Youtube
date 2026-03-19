/**
 * analyze-frame.ts — 비디오 마지막 프레임 분석 API
 *
 * Gemini Vision을 사용하여 프레임 이미지에서 구조화된 장면 상태(SegmentState)를 추출.
 * continuity mode에서 실제 생성 결과 기반 endState를 파생하는 핵심 경로.
 *
 * fallback: 분석 실패 시 빈 상태 반환 (계획 기반 continuity로 내려감)
 */

import { GeminiEnv, fetchWithModelFallback, parseFirstJsonObject } from "./_gemini-keys";

type Env = GeminiEnv;

interface AnalyzeFrameRequest {
  /** base64 이미지 (JPEG/PNG) */
  frameBase64: string;
  /** 컨텍스트: 어떤 장면인지 (프롬프트 분석 정확도 향상용) */
  sceneContext?: string;
}

interface SegmentStateResult {
  subjectPosition: string;
  cameraState: string;
  emotionKeyword: string;
  emotionIntensity: number;
  motionVector: string;
  lightingState: string;
  environmentSnapshot: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { frameBase64, sceneContext } = await context.request.json() as AnalyzeFrameRequest;

    if (!frameBase64 || typeof frameBase64 !== "string") {
      return Response.json({ error: "frameBase64 is required", success: false }, { status: 400 });
    }

    // base64 데이터 정리 (data:image/... prefix 제거)
    const cleanBase64 = frameBase64.replace(/^data:image\/[^;]+;base64,/, "");
    if (cleanBase64.length < 100) {
      return Response.json({ error: "frameBase64 too short", success: false }, { status: 400 });
    }

    const prompt = `Analyze this video frame and extract the scene state as structured JSON.
${sceneContext ? `Scene context: ${sceneContext}` : ""}

Return ONLY valid JSON with these fields:
{
  "subjectPosition": "description of main subject's position and pose in frame (e.g. 'center-frame, facing camera, arms crossed')",
  "cameraState": "camera framing and angle (e.g. 'medium close-up, slight low angle')",
  "emotionKeyword": "dominant emotion/mood (e.g. 'tense', 'calm', 'melancholic')",
  "emotionIntensity": 0-100,
  "motionVector": "implied motion direction (e.g. 'static', 'moving left-to-right', 'approaching camera')",
  "lightingState": "lighting description (e.g. 'warm golden hour, rim light from right')",
  "environmentSnapshot": "brief environment/background description (e.g. 'urban alley at night, neon signs')"
}`;

    const body = {
      contents: [{
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: cleanBase64,
            },
          },
          { text: prompt },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
        responseMimeType: "application/json" as const,
      },
    };

    const { response: res, meta: modelMeta } = await fetchWithModelFallback(
      context.env,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[analyze-frame] Gemini 실패(${res.status}, model=${modelMeta.finalModel}): ${errText.slice(0, 200)}`);
      return Response.json({
        success: false,
        error: `Gemini API error: ${res.status}`,
        state: null,
        _meta: { ...modelMeta },
      });
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = (parseFirstJsonObject(text) as Record<string, unknown>) ?? {};
    }

    const state: SegmentStateResult = {
      subjectPosition: String(parsed.subjectPosition || ""),
      cameraState: String(parsed.cameraState || ""),
      emotionKeyword: String(parsed.emotionKeyword || ""),
      emotionIntensity: Math.max(0, Math.min(100, Number(parsed.emotionIntensity) || 0)),
      motionVector: String(parsed.motionVector || ""),
      lightingState: String(parsed.lightingState || ""),
      environmentSnapshot: String(parsed.environmentSnapshot || ""),
    };

    console.log(`[analyze-frame] 분석 완료:`, {
      subjectPosition: state.subjectPosition.slice(0, 50),
      cameraState: state.cameraState.slice(0, 50),
      emotionKeyword: state.emotionKeyword,
    });

    return Response.json({ success: true, state, _meta: { ...modelMeta } });
  } catch (error) {
    console.error("[analyze-frame] 예외:", error instanceof Error ? error.message : String(error));
    return Response.json({
      success: false,
      error: `analyze-frame error: ${error instanceof Error ? error.message : String(error)}`,
      state: null,
    });
  }
};
