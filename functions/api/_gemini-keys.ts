/**
 * Vertex AI 서비스 계정 OAuth2 인증 + API Key fallback 유틸리티.
 * 우선순위: GOOGLE_SERVICE_ACCOUNT_JSON (OAuth2) → GOOGLE_CLOUD_API_KEY (API Key)
 */

export interface GeminiEnv {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_CLOUD_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY_2?: string;
}

// === OAuth2 서비스 계정 인증 ===

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64url(data: ArrayBuffer | Uint8Array | string): string {
  let str: string;
  if (typeof data === "string") {
    str = data;
  } else {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    // spread(...bytes) → 콜 스택 초과 가능, 루프로 대체
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    str = s;
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** 캐시된 액세스 토큰 (Workers isolate 내에서 재사용) */
let cachedToken: { token: string; expiry: number } | null = null;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

let cachedSa: ServiceAccount | null = null;

function parseServiceAccount(json: string): ServiceAccount {
  if (cachedSa) return cachedSa;
  cachedSa = JSON.parse(json) as ServiceAccount;
  return cachedSa;
}

async function getAccessToken(serviceAccountJson: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && now < cachedToken.expiry - 60) {
    return cachedToken.token;
  }

  const sa = parseServiceAccount(serviceAccountJson);

  const header = JSON.stringify({ alg: "RS256", typ: "JWT" });
  const payload = JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });

  const signingInput = `${base64url(header)}.${base64url(payload)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  const jwt = `${signingInput}.${base64url(signature)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${errText}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string; expires_in?: number };
  cachedToken = { token: tokenData.access_token, expiry: now + (tokenData.expires_in || 3600) };
  return tokenData.access_token;
}

// === 모델 URL 빌더 ===

/**
 * 모델 이름으로 Vertex AI 전체 URL을 생성.
 * 서비스 계정 JSON에서 project_id를 추출하고 location=global 사용.
 */
export function buildVertexUrl(env: GeminiEnv, model: string, method = "generateContent"): string {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const sa = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return `https://aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/global/publishers/google/models/${model}:${method}`;
  }
  // API Key fallback은 Express 엔드포인트 사용
  return `https://aiplatform.googleapis.com/v1beta/publishers/google/models/${model}:${method}`;
}

// === API Key fallback ===

export function getApiKeys(env: GeminiEnv): string[] {
  const keys: string[] = [];
  if (env.GOOGLE_CLOUD_API_KEY) keys.push(env.GOOGLE_CLOUD_API_KEY);
  if (env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY);
  if (env.GEMINI_API_KEY_2) keys.push(env.GEMINI_API_KEY_2);
  return keys;
}

function isRetryableError(status: number, body?: string): boolean {
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
 * Vertex AI 엔드포인트 호출.
 * 서비스 계정: projects/{id}/locations/global/... + Bearer token
 * API Key fallback: Express URL + ?key=
 */
export async function fetchWithAuth(
  env: GeminiEnv,
  url: string,
  init: RequestInit,
): Promise<Response> {
  // 1) 서비스 계정 OAuth2
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const token = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(url, { ...init, headers });
    } catch (err) {
      console.error("Service account auth failed:", err instanceof Error ? err.message : err);
      // fallback to API keys
    }
  }

  // 2) API Key fallback
  const keys = getApiKeys(env);
  if (keys.length === 0) {
    return new Response(
      JSON.stringify({ error: "No auth configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLOUD_API_KEY." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  return fetchWithKeyFallback(keys, url, init);
}

// === 스트리밍 수집 함수 ===

/**
 * streamGenerateContent로 호출하고 모든 청크를 수집하여 텍스트를 반환.
 * 긴 프롬프트/출력에 사용하면 Cloudflare 타임아웃을 피할 수 있음.
 */
export async function streamingGenerate(
  env: GeminiEnv,
  model: string,
  requestBody: Record<string, unknown>,
): Promise<{ text: string; error?: string; status?: number }> {
  const url = buildVertexUrl(env, model, "streamGenerateContent") + "?alt=sse";

  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  };

  let res: Response;

  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const token = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      res = await fetch(url, { ...init, headers });
    } catch (err) {
      // fallback to API keys
      const keys = getApiKeys(env);
      if (keys.length === 0) {
        return { text: "", error: "No auth configured", status: 500 };
      }
      res = await fetch(`${url}&key=${keys[0]}`, init);
    }
  } else {
    const keys = getApiKeys(env);
    if (keys.length === 0) {
      return { text: "", error: "No auth configured", status: 500 };
    }
    res = await fetch(`${url}&key=${keys[0]}`, init);
  }

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
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) parts.push(text);
      } catch {
        // skip malformed chunks
      }
    }
  }

  return { text: parts.join("") };
}
