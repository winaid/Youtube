import { GeminiEnv, fetchWithAuth } from "./_gemini-keys";

type Env = GeminiEnv;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const videoUri = url.searchParams.get("uri");

    if (!videoUri) {
      return new Response("uri parameter is required", { status: 400 });
    }

    const res = await fetchWithAuth(context.env, videoUri, {
      method: "GET",
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Video proxy error:", res.status, errText.slice(0, 300));
      return new Response(`Video fetch failed: ${res.status}`, { status: res.status });
    }

    // 영상 바이너리를 그대로 패스스루
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "video/mp4",
        "Content-Length": res.headers.get("Content-Length") || "",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Video proxy error:", error);
    return new Response("Proxy error", { status: 500 });
  }
};
