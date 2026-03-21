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
// 최종 업데이트: 2026-03-21
// 모델 선택 기준:
//   PRO   = 고품질 추론 (분석, 생성)
//   FLASH = 저비용 빠른 폴백 (JSON 파싱 재시도 등)
//   SEARCH = google_search grounding 지원 + 빠른 응답 필수
// 주의: 3.1-flash-lite는 google_search grounding 미지원, 3.1-pro는 검색 시 25s 타임아웃 초과

/** 메인 추론 (분석, 이야기 생성) — Gemini 3.1 Pro Preview */
export const GEMINI_MODEL_PRO   = "gemini-3.1-pro-preview";
/** 폴백 모델 — Gemini 3.1 Pro Preview */
export const GEMINI_MODEL_FLASH = "gemini-3.1-pro-preview";
/** 웹 검색 grounding 전용 — Gemini 3.1 Pro Preview */
export const GEMINI_MODEL_SEARCH = "gemini-3.1-pro-preview";
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
  // Cloudflare timeout — retry with next key
  if (status === 524) return true;
  return false;
}

// Re-export for testing
export { isRetryableError };

/** Default timeout for non-streaming Gemini API calls (ms). */
export const FETCH_TIMEOUT_MS = 30_000; // 30s — generous but prevents 138s hangs

function fetchWithKeyFallback(
  keys: string[],
  url: string,
  init: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
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

    // AbortController for timeout — prevents indefinite hangs
    // If caller already provided a signal (e.g. streamingGenerate), respect it instead
    const callerHasSignal = !!init.signal;
    const controller = callerHasSignal ? null : new AbortController();
    const timer = callerHasSignal ? null : setTimeout(() => controller!.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(keyUrl, controller ? { ...init, signal: controller.signal } : init);
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") {
        console.warn(`[Gemini] API key ${i + 1} timed out after ${timeoutMs}ms`);
        // Try next key if available
        if (i < keys.length - 1) return tryKey(i + 1);
        return new Response(
          JSON.stringify({ error: `Gemini API timeout (${timeoutMs}ms)`, code: "TIMEOUT" }),
          { status: 504, headers: { "Content-Type": "application/json" } },
        );
      }
      throw err;
    }
    if (timer) clearTimeout(timer);

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
  options?: { timeoutMs?: number },
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
  return fetchWithKeyFallback(keys, url, init, options?.timeoutMs ?? FETCH_TIMEOUT_MS);
}

// === 스트리밍 수집 함수 ===

/**
 * streamGenerateContent로 호출하고 모든 청크를 수집하여 텍스트를 반환.
 */
/** Default timeout for streamingGenerate (ms). Prevents Cloudflare 524. */
export const STREAMING_TIMEOUT_MS = 55_000; // 55s — under Cloudflare's 60s edge timeout

export async function streamingGenerate(
  env: GeminiEnv,
  model: string,
  requestBody: Record<string, unknown>,
  options?: { timeoutMs?: number },
): Promise<{ text: string; error?: string; status?: number; truncated?: boolean; timedOut?: boolean }> {
  const url = buildGeminiUrl(env, model, "streamGenerateContent") + "?alt=sse";
  const timeoutMs = options?.timeoutMs ?? STREAMING_TIMEOUT_MS;

  // AbortController for timeout — prevents Cloudflare 524
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  };

  const keys = getApiKeys(env);
  if (keys.length === 0) {
    clearTimeout(timer);
    return { text: "", error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Cloudflare Pages 환경변수를 확인하세요.", status: 500 };
  }

  let res: Response;
  try {
    res = await fetchWithKeyFallback(keys, url, init);
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      console.warn(`[streamingGenerate] AbortController timeout after ${timeoutMs}ms. model=${model}`);
      return { text: "", error: `TIMEOUT: streamingGenerate timed out after ${timeoutMs}ms`, status: 524, timedOut: true };
    }
    throw err;
  }

  if (!res.ok) {
    clearTimeout(timer);
    const errText = await res.text();
    return { text: "", error: errText, status: res.status };
  }

  // SSE 스트림에서 텍스트 청크 수집
  const reader = res.body?.getReader();
  if (!reader) {
    clearTimeout(timer);
    return { text: "", error: "No response body", status: 500 };
  }

  const decoder = new TextDecoder();
  const parts: string[] = [];
  let buffer = "";
  let truncated = false;
  let timedOut = false;

  try {
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
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      timedOut = true;
      console.warn(`[streamingGenerate] Stream read aborted after ${timeoutMs}ms. Collected ${parts.length} chunks so far. model=${model}`);
    } else {
      clearTimeout(timer);
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }

  if (timedOut) {
    const partial = parts.join("");
    return {
      text: partial,
      error: `TIMEOUT: streamingGenerate timed out after ${timeoutMs}ms (collected ${partial.length} chars)`,
      status: 524,
      truncated: partial.length > 0,
      timedOut: true,
    };
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

// === Gemini 응답 JSON 파싱 유틸리티 ===

/**
 * Sanitize raw LLM text before JSON parsing:
 * - Strip trailing commas before } or ]
 * - Remove control characters (except \n, \r, \t inside strings — handled by JSON.parse)
 * - Normalize unicode quotes to ASCII
 */
export function sanitizeJsonText(text: string): string {
  let s = text;
  // Remove zero-width and non-printable control chars (keep \n \r \t)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Normalize unicode quotes
  s = s.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
  // Strip trailing commas before ] or } (common LLM mistake)
  s = s.replace(/,\s*([}\]])/g, "$1");
  return s;
}

/**
 * Extract the first balanced JSON object `{...}` from text that may contain
 * markdown fences, trailing commentary, or other non-JSON content.
 * Handles nested braces, strings with escaped quotes, and brace-like chars
 * inside string values.
 */
export function parseFirstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * Attempt to repair truncated JSON by closing unclosed strings, arrays, and objects.
 * Works on LLM output that was cut off mid-stream (MAX_TOKENS or timeout).
 *
 * Strategy:
 * 1. Find the outermost `{` to start from
 * 2. Track depth of {}, [], and string state
 * 3. Truncate at the last cleanly closed value boundary
 * 4. Close remaining open brackets/braces
 */
export function repairTruncatedJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let json = text.slice(start);

  // If we end inside an unclosed string, truncate back to the last opening quote
  // and strip the dangling key-value. Do this iteratively (not recursively).
  for (let attempt = 0; attempt < 3; attempt++) {
    let inStr = false;
    let esc = false;
    const stack: string[] = [];
    let lastCleanPos = -1;
    let endedInString = false;

    for (let i = 0; i < json.length; i++) {
      const ch = json[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\" && inStr) { esc = true; continue; }
      if (ch === '"') {
        if (inStr) {
          inStr = false;
          lastCleanPos = i;
        } else {
          inStr = true;
        }
        continue;
      }
      if (inStr) continue;

      if (ch === "{") { stack.push("}"); continue; }
      if (ch === "[") { stack.push("]"); continue; }
      if (ch === "}" || ch === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === ch) {
          stack.pop();
          lastCleanPos = i;
          if (stack.length === 0) {
            try { return JSON.parse(json.slice(0, i + 1)); } catch { break; }
          }
        }
        continue;
      }
      if (ch === "," || ch === ":") { lastCleanPos = i; }
    }

    endedInString = inStr;

    if (stack.length === 0 && !endedInString) return null;

    if (endedInString) {
      // Find the quote that opened this unclosed string and cut before it
      const lastQuoteOpen = json.lastIndexOf('"');
      if (lastQuoteOpen > 0) {
        json = json.slice(0, lastQuoteOpen);
        continue; // retry with shortened text
      }
      return null;
    }

    // Not inside a string — try to repair by closing open brackets
    let repaired = json;
    repaired = repaired.replace(/,\s*"[^"]*$/, "");  // trailing partial "key
    repaired = repaired.replace(/,\s*$/, "");          // trailing comma
    repaired = repaired.replace(/:\s*$/, ": null");    // trailing colon with no value

    // Recompute stack after trimming
    const stack2: string[] = [];
    let inStr2 = false, esc2 = false;
    for (let i = 0; i < repaired.length; i++) {
      const c = repaired[i];
      if (esc2) { esc2 = false; continue; }
      if (c === "\\" && inStr2) { esc2 = true; continue; }
      if (c === '"') { inStr2 = !inStr2; continue; }
      if (inStr2) continue;
      if (c === "{") stack2.push("}");
      else if (c === "[") stack2.push("]");
      else if ((c === "}" || c === "]") && stack2.length) stack2.pop();
    }

    const closers = stack2.reverse().join("");
    repaired = sanitizeJsonText(repaired) + closers;

    try {
      return JSON.parse(repaired);
    } catch {
      // Aggressive fallback: trim to the last cleanly closed bracket/brace
      if (lastCleanPos > 0) {
        json = json.slice(0, lastCleanPos + 1);
        continue;
      }
      return null;
    }
  }

  return null;
}

/**
 * Extract the first balanced JSON array `[...]` from text.
 * Same logic as parseFirstJsonObject but for arrays.
 */
export function parseFirstJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const result = JSON.parse(text.slice(start, i + 1));
          return Array.isArray(result) ? result : null;
        } catch { return null; }
      }
    }
  }
  return null;
}

function classifyGeminiError(status: number, body: string): string {
  if (status === 401) return "INVALID_API_KEY";
  if (status === 403 && /quota|RESOURCE_EXHAUSTED/i.test(body)) return "QUOTA_EXCEEDED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404 && /not found|deprecated|does not exist/i.test(body)) return "MODEL_NOT_FOUND";
  if (status === 429) return "PROVIDER_RATE_LIMIT";
  if (status === 503 || (status === 500 && /UNAVAILABLE|overloaded|high demand/i.test(body))) return "PROVIDER_UNAVAILABLE";
  if (status === 524 || /TIMEOUT/i.test(body)) return "PROVIDER_TIMEOUT";
  if (/MAX_TOKENS|truncat/i.test(body)) return "MAX_TOKENS_TRUNCATED";
  if (status === 500 || status === 502) return "PROVIDER_INVALID_RESPONSE";
  return "UNKNOWN_ERROR";
}

// Re-export for use in analyze-script.ts
export { classifyGeminiError };

function getErrorHelp(code: string): string {
  switch (code) {
    case "MISSING_API_KEY":
      return "Cloudflare Pages 환경변수에서 GEMINI_API_KEY를 설정하세요. Google AI Studio(aistudio.google.com)에서 발급.";
    case "INVALID_API_KEY":
      return "GEMINI_API_KEY가 잘못되었습니다. Google AI Studio에서 키를 재발급하고 Cloudflare 환경변수를 업데이트하세요.";
    case "MODEL_NOT_FOUND":
      return "모델이 deprecated되었거나 존재하지 않습니다. _gemini-keys.ts의 모델 상수를 확인하세요.";
    case "QUOTA_EXCEEDED":
      return "API 할당량 초과. 잠시 후 재시도하거나 GEMINI_API_KEY_2를 추가 설정하세요.";
    case "PROVIDER_RATE_LIMIT":
      return "요청 속도 제한 초과. 잠시 후 자동 재시도됩니다. 지속되면 GEMINI_API_KEY_2를 추가하세요.";
    case "PROVIDER_UNAVAILABLE":
      return "분석 서버가 현재 혼잡합니다. 잠시 후 자동 재시도됩니다.";
    case "PROVIDER_TIMEOUT":
      return "분석 서버 응답 시간 초과. 대본을 줄이거나 잠시 후 다시 시도하세요.";
    case "PROVIDER_INVALID_RESPONSE":
      return "분석 서버에서 비정상 응답을 받았습니다. 잠시 후 다시 시도하세요.";
    case "PERMISSION_DENIED":
      return "API 키에 해당 모델 접근 권한이 없습니다. Google AI Studio에서 권한을 확인하세요.";
    case "MAX_TOKENS_TRUNCATED":
      return "Gemini 응답이 토큰 한도로 잘렸습니다. 컷 수를 줄이거나 스토리를 축소하세요. 이것은 API 키 문제가 아닙니다.";
    default:
      return "예상치 못한 오류입니다. 브라우저 콘솔과 Cloudflare 로그를 확인하세요.";
  }
}

// Re-export for use in analyze-script.ts
export { getErrorHelp };

// === Provider error classification ===

/** Whether an error code represents a transient provider issue worth retrying */
export function isTransientProviderError(code: string): boolean {
  return code === "PROVIDER_UNAVAILABLE" || code === "PROVIDER_RATE_LIMIT" || code === "PROVIDER_TIMEOUT";
}

/** Parse provider error body into structured diagnostics */
export function parseProviderError(status: number, rawBody: string): {
  code: string;
  providerStatus: number;
  providerCode: number | null;
  providerMessage: string;
  retryable: boolean;
  userMessage: string;
  help: string;
} {
  const code = classifyGeminiError(status, rawBody);
  const retryable = isTransientProviderError(code);
  const help = getErrorHelp(code);

  // Try to extract structured error from provider JSON
  let providerCode: number | null = null;
  let providerMessage = rawBody.slice(0, 500);
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed?.error) {
      providerCode = parsed.error.code ?? null;
      providerMessage = parsed.error.message ?? providerMessage;
    } else if (parsed?.message) {
      providerMessage = parsed.message;
    }
  } catch {
    // raw text — use as-is
  }

  // User-safe Korean message
  const userMessageMap: Record<string, string> = {
    PROVIDER_UNAVAILABLE: "분석 서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요.",
    PROVIDER_RATE_LIMIT: "요청이 너무 빈번합니다. 잠시 후 다시 시도해주세요.",
    PROVIDER_TIMEOUT: "분석 서버 응답 시간이 초과되었습니다. 대본을 줄이거나 다시 시도해주세요.",
    PROVIDER_INVALID_RESPONSE: "분석 서버에서 비정상 응답을 받았습니다. 다시 시도해주세요.",
    INVALID_API_KEY: "API 키 설정에 문제가 있습니다. 관리자에게 문의하세요.",
    QUOTA_EXCEEDED: "API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.",
    MODEL_NOT_FOUND: "분석 모델을 찾을 수 없습니다. 관리자에게 문의하세요.",
  };
  const userMessage = userMessageMap[code] ?? "분석 중 오류가 발생했습니다. 다시 시도해주세요.";

  return { code, providerStatus: status, providerCode, providerMessage, retryable, userMessage, help };
}

// ═══════════════════════════════════════════════════════════════════
// Model Fallback Helpers — Pro 우선, Flash-Lite 폴백 공통 정책
// ═══════════════════════════════════════════════════════════════════

/**
 * 모델 폴백 메타데이터.
 * 모든 Gemini 호출 경로에서 어떤 모델이 최종 결과를 만들었는지 기록.
 */
export interface ModelFallbackMeta {
  primaryModel: string;
  fallbackModel: string;
  finalModel: string;
  fallbackUsed: boolean;
}

/**
 * 주어진 HTTP status/body가 모델 폴백을 유발하는 transient 에러인지 판별.
 *
 * 400 bad request (invalid tool field, malformed schema 등)는 false — 요청 자체가 틀린 것이므로
 * 모델을 바꿔도 같은 에러가 남. 이런 경우 폴백이 아닌 요청 구조 수정이 필요.
 */
export function shouldFallbackToAltModel(status: number, body: string): boolean {
  if (isDeprecatedModelError(status, body)) return false; // 모델 자체가 없으면 폴백도 무의미
  if (status === 400) return false; // bad request — 요청 구조 문제, 폴백 무의미
  if (status === 504 && body.includes('"TIMEOUT"')) return true; // timeout
  if (status === 429) return true; // rate limit
  if (status === 503) return true; // overloaded
  if (status === 524) return true; // cloudflare timeout
  if (status >= 500 && /overloaded|RESOURCE_EXHAUSTED|quota|exhausted/i.test(body)) return true;
  return false;
}

/**
 * Gemini API를 Pro 우선 → Flash-Lite 폴백으로 호출.
 * 모든 text/analysis 엔드포인트에서 사용.
 *
 * Image generation (GEMINI_MODEL_IMAGE/IMAGE_FB)은 별도 경로이므로 이 함수를 사용하지 않는다.
 */
export async function fetchWithModelFallback(
  env: GeminiEnv,
  init: RequestInit,
  options?: {
    timeoutMs?: number;
    primaryModel?: string;
    fallbackModel?: string;
    method?: string;
  },
): Promise<{ response: Response; meta: ModelFallbackMeta }> {
  const primary = options?.primaryModel ?? GEMINI_MODEL_PRO;
  const fallback = options?.fallbackModel ?? GEMINI_MODEL_FLASH;
  const method = options?.method ?? "generateContent";
  const timeoutMs = options?.timeoutMs;

  const meta: ModelFallbackMeta = { primaryModel: primary, fallbackModel: fallback, finalModel: primary, fallbackUsed: false };

  // 1차: primary model
  const primaryUrl = buildGeminiUrl(env, primary, method);
  const primaryRes = await fetchWithAuth(env, primaryUrl, init, timeoutMs ? { timeoutMs } : undefined);

  if (primaryRes.ok) {
    return { response: primaryRes, meta };
  }

  // 실패 — 폴백 판단
  let errBody = "";
  try { errBody = await primaryRes.text(); } catch { /* ignore */ }

  if (!shouldFallbackToAltModel(primaryRes.status, errBody)) {
    // non-transient → 폴백 안 함, primary 에러 그대로 반환
    const errorRes = new Response(errBody, { status: primaryRes.status, headers: primaryRes.headers });
    return { response: errorRes, meta };
  }

  // 2차: fallback model
  console.warn(`[Gemini] ${primary} failed (${primaryRes.status}) → fallback to ${fallback}`);
  meta.finalModel = fallback;
  meta.fallbackUsed = true;

  const fallbackUrl = buildGeminiUrl(env, fallback, method);
  const fallbackRes = await fetchWithAuth(env, fallbackUrl, init, timeoutMs ? { timeoutMs } : undefined);
  return { response: fallbackRes, meta };
}

/**
 * streamingGenerate를 Pro 우선 → Flash-Lite 폴백으로 호출.
 * analyze-script, generate-cuts 등 스트리밍 엔드포인트에서 사용.
 */
export async function streamingGenerateWithFallback(
  env: GeminiEnv,
  requestBody: Record<string, unknown>,
  options?: {
    timeoutMs?: number;
    primaryModel?: string;
    fallbackModel?: string;
  },
): Promise<{ text: string; error?: string; status?: number; truncated?: boolean; timedOut?: boolean; finalModel: string; fallbackUsed: boolean }> {
  const primary = options?.primaryModel ?? GEMINI_MODEL_PRO;
  const fallback = options?.fallbackModel ?? GEMINI_MODEL_FLASH;

  // 1차: primary model
  const primaryResult = await streamingGenerate(env, primary, requestBody, { timeoutMs: options?.timeoutMs });

  // 사용 가능한 text가 있으면 성공
  if (!primaryResult.error || (primaryResult.text && primaryResult.text.length > 10)) {
    return { ...primaryResult, finalModel: primary, fallbackUsed: false };
  }

  // transient 에러 판단
  const isTransient = primaryResult.timedOut ||
    (primaryResult.status && [429, 503, 524].includes(primaryResult.status)) ||
    (primaryResult.status && primaryResult.status >= 500);

  if (!isTransient) {
    return { ...primaryResult, finalModel: primary, fallbackUsed: false };
  }

  // 2차: fallback model
  console.warn(`[Gemini] streaming ${primary} failed → fallback to ${fallback}`);
  const fallbackResult = await streamingGenerate(env, fallback, requestBody, { timeoutMs: options?.timeoutMs });
  return { ...fallbackResult, finalModel: fallback, fallbackUsed: true };
}
