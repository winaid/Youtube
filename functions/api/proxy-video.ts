import { GeminiEnv, fetchWithAuth } from "./_gemini-keys";

type Env = GeminiEnv;

/**
 * gs://bucket/path/to/object → GCS JSON API 다운로드 URL로 변환.
 * Cloudflare Workers의 fetch()는 gs:// 프로토콜을 지원하지 않으므로 필수 변환.
 * Service Account에 storage.objects.get 권한이 있어야 인증 성공.
 */
function gcsUriToHttps(uri: string): string {
  if (!uri.startsWith("gs://")) return uri;
  const withoutScheme = uri.slice(5); // "gs://" 제거
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) return uri;
  const bucket = withoutScheme.slice(0, slashIdx);
  const object = withoutScheme.slice(slashIdx + 1);
  return `https://storage.googleapis.com/download/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const videoUri = url.searchParams.get("uri");

    if (!videoUri) {
      return new Response("uri parameter is required", { status: 400 });
    }

    // gs:// → GCS JSON API URL 변환 (Cloudflare Workers는 gs:// 미지원)
    const fetchUri = gcsUriToHttps(videoUri);
    if (fetchUri !== videoUri) {
      console.log(`[proxy-video] gs:// 변환: ${videoUri.slice(0, 60)}… → GCS API URL`);
    }

    const res = await fetchWithAuth(context.env, fetchUri, {
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
