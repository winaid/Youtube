interface Env {
  GEMINI_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const videoUri = url.searchParams.get("uri");

    if (!videoUri) {
      return new Response("uri parameter is required", { status: 400 });
    }

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response("GEMINI_API_KEY not configured", { status: 500 });
    }

    // videoUri에 이미 key가 있으면 그대로, 없으면 추가
    const fetchUrl = videoUri.includes("key=")
      ? videoUri
      : `${videoUri}${videoUri.includes("?") ? "&" : "?"}key=${apiKey}`;

    const res = await fetch(fetchUrl);

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
