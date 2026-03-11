/**
 * Vertex AI 서비스 계정 OAuth2 인증 + API Key fallback 유틸리티.
 * 우선순위: GOOGLE_SERVICE_ACCOUNT_JSON (OAuth2) → GOOGLE_CLOUD_API_KEY (API Key)
 */

export interface GeminiEnv {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_CLOUD_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY_2?: string;
  GOOGLE_CLOUD_PROJECT_ID?: string; // API Key 모드에서 project ID 지정용
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
 * Gemini 텍스트/멀티모달 모델 전용 — Veo는 buildVeoUrl() 사용.
 */
export function buildVertexUrl(env: GeminiEnv, model: string, method = "generateContent"): string {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const sa = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return `https://aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/global/publishers/google/models/${model}:${method}`;
  }
  // API Key fallback은 Express 엔드포인트 사용
  return `https://aiplatform.googleapis.com/v1beta/publishers/google/models/${model}:${method}`;
}

/**
 * Veo 전용 Vertex AI URL 빌더 — us-central1 리전 엔드포인트 사용.
 *
 * 왜 별도 함수가 필요한가?
 *  - Veo predictLongRunning은 리전 엔드포인트(us-central1)에서만 GCS URI 반환.
 *    global 엔드포인트를 쓰면 base64 인라인으로 반환되어 Scene Extension 불가.
 *  - fetchPredictOperation 도 동일한 리전 엔드포인트여야 operationName 매칭.
 *    createVeoFetchUrl() 도 us-central1 고정.
 */
export function buildVeoUrl(env: GeminiEnv, model: string, method = "predictLongRunning"): string {
  const location = "us-central1";
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const sa = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return `https://${location}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${location}/publishers/google/models/${model}:${method}`;
  }
  // API Key fallback — project ID가 있으면 v1 + project 경로 사용 (GCS URI 반환 가능)
  // project ID 없으면 v1beta (GCS URI 미반환 → base64 인라인)
  const projectId = env.GOOGLE_CLOUD_PROJECT_ID;
  if (projectId) {
    return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:${method}`;
  }
  return `https://${location}-aiplatform.googleapis.com/v1beta/publishers/google/models/${model}:${method}`;
}

/**
 * Veo 전용 fetchPredictOperation URL 빌더.
 * operationName에서 리전을 추출하되, global이면 us-central1 로 대체.
 * buildVeoUrl()과 동일 리전이어야 operation 조회 성공.
 */
export function buildVeoFetchUrl(env: GeminiEnv, operationName: string): string {
  const locMatch = operationName.match(/locations\/([^/]+)\//);
  const rawLoc = locMatch ? locMatch[1] : "us-central1";
  const location = rawLoc === "global" ? "us-central1" : rawLoc;

  const modelMatch = operationName.match(/models\/([^/]+)\/operations\//);
  const model = modelMatch ? modelMatch[1] : "veo-3.0-generate-001";

  let projectId = "unknown";
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { project_id: string };
      projectId = sa.project_id;
    } catch { /* ignore */ }
  } else if (env.GOOGLE_CLOUD_PROJECT_ID) {
    projectId = env.GOOGLE_CLOUD_PROJECT_ID;
  }

  const host = `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`;
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
): Promise<{ text: string; error?: string; status?: number; truncated?: boolean }> {
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
      // fallback to API keys — keys[0] 고정이 아닌 전체 키 로테이션
      const keys = getApiKeys(env);
      if (keys.length === 0) {
        return { text: "", error: "No auth configured", status: 500 };
      }
      res = await fetchWithKeyFallback(keys, url, init);
    }
  } else {
    const keys = getApiKeys(env);
    if (keys.length === 0) {
      return { text: "", error: "No auth configured", status: 500 };
    }
    res = await fetchWithKeyFallback(keys, url, init);
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
        // MAX_TOKENS: 출력이 토큰 한도로 잘렸음 — 불완전한 JSON 반환 방지
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
    // partial 텍스트를 text에 포함하여 caller가 부분 복구 시도 가능하게 함
    return {
      text: partial,
      error: `MAX_TOKENS: 출력이 토큰 한도로 절단됨 (${partial.length}자). maxOutputTokens를 높이거나 요청을 분리하세요.`,
      status: 200,
      truncated: true,
    };
  }

  return { text: parts.join(""), truncated: false };
}
