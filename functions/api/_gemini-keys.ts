/**
 * Gemini API Key 인증 유틸리티 (Google AI Studio).
 *
 * 인증: API Key 방식만 사용 (Vertex AI / SA 아님).
 * 우선순위: GEMINI_API_KEY → GEMINI_API_KEY_2
 * (GOOGLE_CLOUD_API_KEY는 TTS 전용 — Gemini 호출에 사용하지 않음)
 */

export interface GeminiEnv {
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY_2?: string;
  GOOGLE_CLOUD_API_KEY?: string; // TTS 전용 — Gemini 호출에 사용하지 않음
}

// === 모델 상수 (Google AI Studio) ===
// 모델 변경 시 여기만 수정하면 전체 엔드포인트에 반영됨.
// 최종 업데이트: 2026-03-12

/** 무거운 추론 (프롬프트 생성, 분석, 리뷰) — Gemini 3.1 Pro Preview */
export const GEMINI_MODEL_PRO   = "gemini-3.1-pro-preview";
/** 경량 추론 (검증, 분류, 추출) — Gemini 3 Flash */
export const GEMINI_MODEL_FLASH = "gemini-3-flash-preview";
/** 이미지 생성 (primary) — Nano Banana 2 */
export const GEMINI_MODEL_IMAGE       = "gemini-3.1-flash-image-preview";
/** 이미지 생성 (fallback) */
export const GEMINI_MODEL_IMAGE_FB    = "imagen-3.0-generate-002";

// === Gemini API URL 빌더 ===

/**
 * Google AI Studio Gemini 모델 URL 생성.
 */
export function buildGeminiUrl(env: GeminiEnv, model: string, method = "generateContent"): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`;
}

// === API Key 관리 ===

export function getApiKeys(env: GeminiEnv): string[] {
  const keys: string[] = [];
  if (env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY);
  if (env.GEMINI_API_KEY_2) keys.push(env.GEMINI_API_KEY_2);
  // GOOGLE_CLOUD_API_KEY는 TTS 전용 — Gemini 호출 fallback에 사용하지 않음
  return keys;
}

/** 모델 deprecated/삭제 에러인지 판별 — key fallback 불필요 */
function isDeprecatedModelError(status: number, body?: string): boolean {
  if (!body) return false;
  return (status === 404 || status === 400) &&
    /no longer available|is not found|not supported|deprecated|does not exist/i.test(body);
}

function isRetryableError(status: number, body?: string): boolean {
  // 모델 자체가 없으면 다른 key로 시도해도 무의미
  if (isDeprecatedModelError(status, body)) return false;
  if (status === 401) return true;
  if (status === 429) return true;
  if (status === 403 && body && /quota|rate|RESOURCE_EXHAUSTED|exhausted/i.test(body)) return true;
  if ((status === 500 || status === 502) && body && /RESOURCE_EXHAUSTED|quota|overloaded|exhausted/i.test(body)) return true;
  if (status === 503) return true;
  return false;
}

function fetchWithKeyFallback(
  keys: string[],
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (keys.length === 0) {
    return Promise.resolve(
      new Response(JSON.stringify({
        error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다.",
        code: "MISSING_API_KEY",
        help: "Cloudflare Pages 환경변수에 GEMINI_API_KEY를 설정하세요.",
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  const tryKey = async (i: number): Promise<Response> => {
    const keyUrl = `${url}${url.includes("?") ? "&" : "?"}key=${keys[i]}`;
    const res = await fetch(keyUrl, init);

    if (i === keys.length - 1) return res;

    if (!res.ok) {
      const body = await res.text();
      // 모델 deprecated → key 문제 아님, 즉시 에러 반환
      if (isDeprecatedModelError(res.status, body)) {
        const modelMatch = url.match(/models\/([^:?/]+)/);
        const modelName = modelMatch?.[1] ?? "unknown";
        console.error(`[Gemini] Model "${modelName}" is deprecated or not available. Update _gemini-keys.ts model constants.`);
        return new Response(
          JSON.stringify({
            error: `모델 "${modelName}"이(가) deprecated되었거나 존재하지 않습니다.`,
            code: "MODEL_NOT_FOUND",
            help: "이것은 API key 문제가 아닙니다. _gemini-keys.ts의 모델 상수를 최신 모델명으로 업데이트하세요.",
            currentModels: { pro: GEMINI_MODEL_PRO, flash: GEMINI_MODEL_FLASH, image: GEMINI_MODEL_IMAGE },
            detail: body.slice(0, 300),
          }),
          { status: res.status, headers: { "Content-Type": "application/json" } },
        );
      }
      if (isRetryableError(res.status, body)) {
        console.warn(`API key ${i + 1} failed (${res.status}), trying key ${i + 2}...`);
        return tryKey(i + 1);
      }
      return new Response(body, { status: res.status, headers: res.headers });
    }
    return res;
  };

  return tryKey(0);
}

// === 메인 인증 함수 ===

/**
 * Gemini API 호출 (API Key 인증, key fallback 지원).
 */
export async function fetchWithAuth(
  env: GeminiEnv,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const keys = getApiKeys(env);
  if (keys.length === 0) {
    return new Response(
      JSON.stringify({
        error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다.",
        code: "MISSING_API_KEY",
        help: "Cloudflare 대시보드 > Pages > Settings > Environment variables에서 GEMINI_API_KEY를 설정하세요. Google AI Studio(aistudio.google.com)에서 키를 발급받을 수 있습니다.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  return fetchWithKeyFallback(keys, url, init);
}

// === 스트리밍 수집 함수 ===

/**
 * streamGenerateContent로 호출하고 모든 청크를 수집하여 텍스트를 반환.
 */
export async function streamingGenerate(
  env: GeminiEnv,
  model: string,
  requestBody: Record<string, unknown>,
): Promise<{ text: string; error?: string; status?: number; truncated?: boolean }> {
  const url = buildGeminiUrl(env, model, "streamGenerateContent") + "?alt=sse";

  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  };

  const keys = getApiKeys(env);
  if (keys.length === 0) {
    return { text: "", error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Cloudflare Pages 환경변수를 확인하세요.", status: 500 };
  }
  const res = await fetchWithKeyFallback(keys, url, init);

  if (!res.ok) {
    const errText = await res.text();
    return { text: "", error: errText, status: res.status };
  }

  // SSE 스트림에서 텍스트 청크 수집
  const reader = res.body?.getReader();
  if (!reader) {
    return { text: "", error: "No response body", status: 500 };
  }

  const decoder = new TextDecoder();
  const parts: string[] = [];
  let buffer = "";
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const chunk = JSON.parse(jsonStr) as {
          candidates?: {
            content?: { parts?: { text?: string }[] };
            finishReason?: string;
          }[];
        };
        const cand = chunk?.candidates?.[0];
        const text = cand?.content?.parts?.[0]?.text;
        if (text) parts.push(text);
        if (cand?.finishReason === "MAX_TOKENS") {
          truncated = true;
          const charCount = parts.reduce((s, p) => s + p.length, 0);
          console.warn(
            `[streamingGenerate] finishReason=MAX_TOKENS — 출력 절단됨. 누적 ${charCount}자. 모델: ${model}`,
          );
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  if (truncated) {
    const partial = parts.join("");
    return {
      text: partial,
      error: `MAX_TOKENS: 출력이 토큰 한도로 절단됨 (${partial.length}자). maxOutputTokens를 높이거나 요청을 분리하세요.`,
      status: 200,
      truncated: true,
    };
  }

  return { text: parts.join(""), truncated: false };
}

// === 에러 전파 헬퍼 ===

/**
 * Gemini API 에러 응답을 파싱하여 구체적인 에러 정보를 포함한 Response를 생성.
 * 모든 엔드포인트에서 `if (!res.ok)` 분기에서 사용.
 */
export function geminiErrorResponse(
  res: { status: number },
  errText: string,
  context: string,
): Response {
  // 구조화된 에러인지 확인 (fetchWithAuth가 반환한 것)
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(errText); } catch { /* raw text */ }

  const code = (parsed?.code as string) || classifyGeminiError(res.status, errText);
  const help = (parsed?.help as string) || getErrorHelp(code);
  const detail = (parsed?.detail as string) || errText.slice(0, 500);

  const errorMsg = (parsed?.error as string) || `Gemini API 오류 (${res.status})`;

  return Response.json({
    error: `[${context}] ${errorMsg}`,
    code,
    help,
    detail,
    status: res.status,
  }, { status: res.status >= 400 && res.status < 600 ? res.status : 500 });
}

function classifyGeminiError(status: number, body: string): string {
  if (status === 401) return "INVALID_API_KEY";
  if (status === 403 && /quota|RESOURCE_EXHAUSTED/i.test(body)) return "QUOTA_EXCEEDED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404 && /not found|deprecated|does not exist/i.test(body)) return "MODEL_NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status === 500 || status === 502 || status === 503) return "SERVER_ERROR";
  return "UNKNOWN_ERROR";
}

function getErrorHelp(code: string): string {
  switch (code) {
    case "MISSING_API_KEY":
      return "Cloudflare Pages 환경변수에서 GEMINI_API_KEY를 설정하세요. Google AI Studio(aistudio.google.com)에서 발급.";
    case "INVALID_API_KEY":
      return "GEMINI_API_KEY가 잘못되었습니다. Google AI Studio에서 키를 재발급하고 Cloudflare 환경변수를 업데이트하세요.";
    case "MODEL_NOT_FOUND":
      return "모델이 deprecated되었거나 존재하지 않습니다. _gemini-keys.ts의 모델 상수를 확인하세요.";
    case "QUOTA_EXCEEDED":
    case "RATE_LIMITED":
      return "API 할당량 또는 요청 속도 제한 초과. 잠시 후 재시도하거나 GEMINI_API_KEY_2를 추가 설정하세요.";
    case "PERMISSION_DENIED":
      return "API 키에 해당 모델 접근 권한이 없습니다. Google AI Studio에서 권한을 확인하세요.";
    case "SERVER_ERROR":
      return "Gemini 서버 일시 오류. 잠시 후 다시 시도하세요.";
    default:
      return "예상치 못한 오류입니다. 브라우저 콘솔과 Cloudflare 로그를 확인하세요.";
  }
}
