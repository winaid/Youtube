/**
 * analyze-sketch.ts — Gemini Vision으로 사용자 스케치에서 구도 정보 추출
 *
 * 입력: base64 PNG 스케치
 * 출력: 구도 분석 결과 (framing, angle, subject 배치, 카메라 방향 등)
 *
 * Gemini Vision에 스케치를 보내서:
 *   - 카메라 프레이밍 (WS/MS/CU/ECU)
 *   - 카메라 앵글 (eye-level/low-angle/high-angle/overhead)
 *   - 카메라 모션 힌트 (pan direction, push-in 등)
 *   - 피사체 위치 (rule-of-thirds 기준)
 *   - 피사체 포즈 (standing/sitting/action)
 *   - 배경 요소
 *   - 깊이감 (foreground/midground/background)
 * 를 JSON으로 추출
 */

import {
  type GeminiEnv,
  buildGeminiUrl,
  fetchWithAuth,
  parseFirstJsonObject,
  GEMINI_MODEL_PRO,
  GEMINI_MODEL_FLASH,
} from "./_gemini-keys";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface SketchAnalysisResult {
  /** 카메라 프레이밍 — WS | MS | MCU | CU | ECU */
  framing: string;
  /** 카메라 앵글 — eye-level | low-angle | high-angle | overhead | dutch-angle */
  angle: string;
  /** 카메라 모션 힌트 — static | pan-left | pan-right | push-in | pull-back | tilt-up | tilt-down | tracking */
  motionHint: string;
  /** 피사체 위치 — rule of thirds 기준 */
  subjectPosition: {
    horizontal: "left-third" | "center" | "right-third";
    vertical: "top-third" | "center" | "bottom-third";
  };
  /** 피사체 포즈/상태 */
  subjectPose: string;
  /** 피사체 수 */
  subjectCount: number;
  /** 배경 요소 설명 */
  backgroundElements: string[];
  /** 깊이 레이어 */
  depthLayers: {
    foreground?: string;
    midground?: string;
    background?: string;
  };
  /** 전체 구도 요약 (한 줄) */
  compositionSummary: string;
  /** 신뢰도 (0~1) — 스케치가 너무 단순하면 낮음 */
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════════
// Prompt
// ═══════════════════════════════════════════════════════════════════

const ANALYSIS_SYSTEM_PROMPT = `You are a cinematography composition analyzer.
You receive rough hand-drawn storyboard sketches (stick figures, simple shapes, arrows).
Your job is to interpret the INTENDED camera composition from the sketch.

Rules:
- Stick figures = people. Their position in the frame determines subject placement.
- Triangles/arrows = camera direction hints.
- Boxes/rectangles = objects or buildings.
- The sketch uses a standard film frame (rule of thirds applies).
- If the horizon line is visible, use it to determine camera angle.
- If figures are small relative to the frame = Wide Shot. If they fill most of the frame = Close-Up.
- Estimate the intended camera framing, angle, and motion from visual cues.

Respond ONLY with a JSON object (no markdown, no explanation):
{
  "framing": "WS" | "MS" | "MCU" | "CU" | "ECU",
  "angle": "eye-level" | "low-angle" | "high-angle" | "overhead" | "dutch-angle",
  "motionHint": "static" | "pan-left" | "pan-right" | "push-in" | "pull-back" | "tilt-up" | "tilt-down" | "tracking",
  "subjectPosition": {
    "horizontal": "left-third" | "center" | "right-third",
    "vertical": "top-third" | "center" | "bottom-third"
  },
  "subjectPose": "standing" | "sitting" | "walking" | "running" | "action" | "close-detail" | "no-figure",
  "subjectCount": 1,
  "backgroundElements": ["building", "tree"],
  "depthLayers": {
    "foreground": "description or null",
    "midground": "description or null",
    "background": "description or null"
  },
  "compositionSummary": "One-line summary of the intended shot composition",
  "confidence": 0.8
}`;

// ═══════════════════════════════════════════════════════════════════
// Handler
// ═══════════════════════════════════════════════════════════════════

type Env = GeminiEnv;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { sketchBase64 } = await context.request.json() as { sketchBase64: string };

    if (!sketchBase64 || sketchBase64.length < 100) {
      return Response.json({ error: "sketchBase64 is required" }, { status: 400 });
    }

    // Strip data URI prefix if present
    const cleanBase64 = sketchBase64.replace(/^data:image\/[^;]+;base64,/, "");

    // ── Gemini Vision 호출 ──
    const requestBody = {
      contents: [
        {
          parts: [
            { text: "Analyze this hand-drawn storyboard sketch and extract the intended camera composition. Respond with JSON only." },
            {
              inlineData: {
                mimeType: "image/png",
                data: cleanBase64,
              },
            },
          ],
        },
      ],
      systemInstruction: {
        parts: [{ text: ANALYSIS_SYSTEM_PROMPT }],
      },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    };

    // Try Pro model first (better vision), fallback to Flash
    let responseText = "";
    let modelUsed = GEMINI_MODEL_PRO;

    for (const model of [GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH]) {
      try {
        const url = buildGeminiUrl(context.env, model);
        const res = await fetchWithAuth(context.env, url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.warn(`[analyze-sketch] ${model} failed: ${res.status}`, errText.slice(0, 200));
          continue;
        }

        const data = await res.json() as Record<string, unknown>;
        const candidates = data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
        responseText = candidates?.[0]?.content?.parts?.[0]?.text || "";
        modelUsed = model;

        if (responseText) break;
      } catch (err) {
        console.warn(`[analyze-sketch] ${model} error:`, err instanceof Error ? err.message : err);
        continue;
      }
    }

    if (!responseText) {
      return Response.json({ error: "Failed to analyze sketch — no response from Gemini" }, { status: 502 });
    }

    // ── Parse JSON response ──
    const parsed = parseFirstJsonObject(responseText);
    if (!parsed) {
      console.error("[analyze-sketch] Failed to parse response:", responseText.slice(0, 500));
      return Response.json({ error: "Failed to parse analysis result", rawResponse: responseText.slice(0, 300) }, { status: 422 });
    }

    // ── Validate & normalize ──
    const result: SketchAnalysisResult = {
      framing: normalizeFraming(parsed.framing as string),
      angle: normalizeAngle(parsed.angle as string),
      motionHint: normalizeMotion(parsed.motionHint as string),
      subjectPosition: {
        horizontal: normalizeHorizontal((parsed.subjectPosition as Record<string, string>)?.horizontal),
        vertical: normalizeVertical((parsed.subjectPosition as Record<string, string>)?.vertical),
      },
      subjectPose: String(parsed.subjectPose || "standing"),
      subjectCount: Number(parsed.subjectCount) || 1,
      backgroundElements: Array.isArray(parsed.backgroundElements) ? parsed.backgroundElements.map(String) : [],
      depthLayers: {
        foreground: (parsed.depthLayers as Record<string, string>)?.foreground || undefined,
        midground: (parsed.depthLayers as Record<string, string>)?.midground || undefined,
        background: (parsed.depthLayers as Record<string, string>)?.background || undefined,
      },
      compositionSummary: String(parsed.compositionSummary || ""),
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
    };

    console.log("[analyze-sketch] Success:", {
      model: modelUsed,
      framing: result.framing,
      angle: result.angle,
      confidence: result.confidence,
    });

    return Response.json({ ok: true, analysis: result, model: modelUsed });
  } catch (error) {
    console.error("[analyze-sketch] Error:", error);
    return Response.json(
      { error: `Analysis failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
};

// ═══════════════════════════════════════════════════════════════════
// Normalization helpers
// ═══════════════════════════════════════════════════════════════════

const VALID_FRAMINGS = ["WS", "LS", "MLS", "MS", "MCU", "CU", "ECU"];
function normalizeFraming(val: string): string {
  const upper = (val || "MS").toUpperCase().trim();
  return VALID_FRAMINGS.includes(upper) ? upper : "MS";
}

const VALID_ANGLES = ["eye-level", "low-angle", "high-angle", "overhead", "dutch-angle"];
function normalizeAngle(val: string): string {
  const lower = (val || "eye-level").toLowerCase().trim();
  return VALID_ANGLES.includes(lower) ? lower : "eye-level";
}

const VALID_MOTIONS = ["static", "pan-left", "pan-right", "push-in", "pull-back", "tilt-up", "tilt-down", "tracking"];
function normalizeMotion(val: string): string {
  const lower = (val || "static").toLowerCase().trim();
  return VALID_MOTIONS.includes(lower) ? lower : "static";
}

function normalizeHorizontal(val: string): "left-third" | "center" | "right-third" {
  const lower = (val || "center").toLowerCase().trim();
  if (lower.includes("left")) return "left-third";
  if (lower.includes("right")) return "right-third";
  return "center";
}

function normalizeVertical(val: string): "top-third" | "center" | "bottom-third" {
  const lower = (val || "center").toLowerCase().trim();
  if (lower.includes("top")) return "top-third";
  if (lower.includes("bottom")) return "bottom-third";
  return "center";
}
