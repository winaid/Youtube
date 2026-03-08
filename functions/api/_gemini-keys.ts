/**
 * Vertex AI 서비스 계정 OAuth2 인증 + API Key fallback 유틸리티.
 * 우선순위: GOOGLE_SERVICE_ACCOUNT_JSON (OAuth2) → GEMINI_API_KEY (API Key)
 */

export interface GeminiEnv {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
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
    str = String.fromCharCode(...bytes);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** 캐시된 액세스 토큰 (Workers isolate 내에서 재사용) */
let cachedToken: { token: string; expiry: number } | null = null;

async function getAccessToken(serviceAccountJson: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && now < cachedToken.expiry - 60) {
    return cachedToken.token;
  }

  const sa = JSON.parse(serviceAccountJson) as {
    client_email: string;
    private_key: string;
  };

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

// === API Key fallback ===

export function getApiKeys(env: GeminiEnv): string[] {
  const keys: string[] = [];
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
    const keyUrl = `${url}?key=${keys[i]}`;
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
 * Vertex AI 서비스 계정 OAuth2 우선, API Key fallback.
 * URL에 ?key={KEY} 없이 전달 — 인증은 내부에서 처리.
 */
/**
 * Express(global) URL → Vertex AI 리전 URL 변환.
 * 처리 패턴:
 * 1) .../v1beta/publishers/google/... → 리전 URL + project/location 삽입
 * 2) .../v1beta/projects/{p}/locations/{l}/... → 리전 엔드포인트로 변환
 * 3) .../v1beta/{operationName} (projects/로 시작) → 리전 엔드포인트로 변환
 */
function toVertexRegionalUrl(url: string, projectId: string, location = "us-central1"): string {
  const globalHost = "https://aiplatform.googleapis.com";
  if (!url.startsWith(globalHost)) return url;

  const path = url.slice(globalHost.length); // e.g. "/v1beta/publishers/google/models/..."
  const regionalHost = `https://${location}-aiplatform.googleapis.com`;

  // 패턴 1: /v1beta/publishers/google/... → 프로젝트/리전 삽입
  const expressPrefix = "/v1beta/publishers/google/";
  if (path.startsWith(expressPrefix)) {
    const suffix = path.slice(expressPrefix.length);
    return `${regionalHost}/v1beta1/projects/${projectId}/locations/${location}/publishers/google/${suffix}`;
  }

  // 패턴 2,3: /v1beta/projects/... → 이미 프로젝트 경로 포함, 호스트만 리전으로 변경
  if (path.startsWith("/v1beta/projects/")) {
    // 리전을 URL 경로에서 추출
    const locMatch = path.match(/\/locations\/([^/]+)\//);
    const urlLocation = locMatch ? locMatch[1] : location;
    const host = `https://${urlLocation}-aiplatform.googleapis.com`;
    return `${host}${path.replace("/v1beta/", "/v1beta1/")}`;
  }

  // 기타: 그대로 반환
  return url;
}

export async function fetchWithAuth(
  env: GeminiEnv,
  url: string,
  init: RequestInit,
): Promise<Response> {
  // 1) 서비스 계정 OAuth2
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { project_id: string };
      const vertexUrl = toVertexRegionalUrl(url, sa.project_id);
      const token = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(vertexUrl, { ...init, headers });
    } catch (err) {
      console.error("Service account auth failed:", err);
      // fallback to API keys
    }
  }

  // 2) API Key fallback
  const keys = getApiKeys(env);
  if (keys.length === 0) {
    return new Response(
      JSON.stringify({ error: "No auth configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or GEMINI_API_KEY." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  return fetchWithKeyFallback(keys, url, init);
}
