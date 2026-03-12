/**
 * Gemini API Key 인증 유틸리티 (Google AI Studio).
 *
 * 인증: API Key 방식만 사용 (Vertex AI / SA 아님).
 * 우선순위: GEMINI_API_KEY → GOOGLE_CLOUD_API_KEY → GEMINI_API_KEY_2
 */

export interface GeminiEnv {
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY_2?: string;
  GOOGLE_CLOUD_API_KEY?: string; // TTS + legacy Gemini fallback
}

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
  if (env.GOOGLE_CLOUD_API_KEY) keys.push(env.GOOGLE_CLOUD_API_KEY);
  if (env.GEMINI_API_KEY_2) keys.push(env.GEMINI_API_KEY_2);
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
      new Response(JSON.stringify({ error: "No API keys configured" }), {
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
        console.error(`[Gemini] Model "${modelName}" is deprecated or not available. Update model name.`);
        return new Response(
          JSON.stringify({ error: `Model "${modelName}" is no longer available. This is NOT an API key issue — update the model name in code.`, detail: body.slice(0, 300) }),
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
      JSON.stringify({ error: "No auth configured. Set GEMINI_API_KEY." }),
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
    return { text: "", error: "No auth configured", status: 500 };
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
