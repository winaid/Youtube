import { JWT } from "google-auth-library";

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 60_000) {
    return cachedToken.token;
  }

  const client = new JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const res = await client.getAccessToken();
  if (!res.token) throw new Error("Failed to get access token");

  cachedToken = { token: res.token, expiresAt: now + 3600_000 };
  return res.token;
}

export const PROJECT_ID = process.env.GOOGLE_PROJECT_ID ?? "";
export const LOCATION = "us-central1";

export function geminiEndpoint(model = "gemini-1.5-flash") {
  return `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${model}:generateContent`;
}

export async function callGemini(
  prompt: string,
  options: { model?: string; temperature?: number; maxTokens?: number; json?: boolean } = {}
): Promise<string> {
  const { model = "gemini-1.5-flash", temperature = 0.7, maxTokens = 8192, json = false } = options;
  const token = await getAccessToken();

  const res = await fetch(geminiEndpoint(model), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        ...(json ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
