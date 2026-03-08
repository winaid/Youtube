/**
 * Gemini API Key fallback 유틸리티.
 * GEMINI_API_KEY가 rate limit(429) 또는 quota 초과 시 GEMINI_API_KEY_2로 재시도.
 */

export interface GeminiEnv {
  GEMINI_API_KEY: string;
  GEMINI_API_KEY_2?: string;
}

/** 사용 가능한 API 키 목록 반환 (빈 값 제외) */
export function getApiKeys(env: GeminiEnv): string[] {
  const keys: string[] = [];
  if (env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY);
  if (env.GEMINI_API_KEY_2) keys.push(env.GEMINI_API_KEY_2);
  return keys;
}

/** Rate limit / quota / resource exhausted 에러인지 판별 */
function isRetryableError(status: number, body?: string): boolean {
  if (status === 401) return true;
  if (status === 429) return true;
  if (status === 403 && body && /quota|rate|RESOURCE_EXHAUSTED|exhausted/i.test(body)) return true;
  if ((status === 500 || status === 502) && body && /RESOURCE_EXHAUSTED|quota|overloaded|exhausted/i.test(body)) return true;
  if (status === 503) return true;
  return false;
}

/**
 * Gemini API fetch with automatic key fallback.
 * urlTemplate: API key 자리를 `{KEY}` 로 표기.
 * 예: "https://aiplatform.googleapis.com/v1beta/publishers/google/models/gemini-3.1-pro-preview:generateContent?key={KEY}"
 */
export async function fetchWithKeyFallback(
  keys: string[],
  urlTemplate: string,
  init: RequestInit,
): Promise<Response> {
  if (keys.length === 0) {
    return new Response(JSON.stringify({ error: "No API keys configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  for (let i = 0; i < keys.length; i++) {
    const url = urlTemplate.replace("{KEY}", keys[i]);
    const res = await fetch(url, init);

    // 마지막 키면 결과 그대로 반환
    if (i === keys.length - 1) return res;

    // rate limit이면 다음 키로
    if (!res.ok) {
      const body = await res.text();
      if (isRetryableError(res.status, body)) {
        console.warn(`API key ${i + 1} failed (${res.status}), trying key ${i + 2}...`);
        continue;
      }
      // rate limit이 아닌 에러면 그대로 반환
      return new Response(body, {
        status: res.status,
        headers: res.headers,
      });
    }

    return res;
  }

  // unreachable, but TypeScript needs it
  return new Response(JSON.stringify({ error: "All API keys exhausted" }), { status: 429 });
}
