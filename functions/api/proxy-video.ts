interface ProxyEnv {
  VIDEO_BUCKET?: R2Bucket;
  VIDEO_BUCKET_DOMAIN?: string;
}

/**
 * SSRF 방지: 허용된 도메인/스킴만 프록시합니다.
 * - gs:// URIs (GCS로 변환됨)
 * - storage.googleapis.com (GCS)
 * - cdn.klingai.com / cdn.kling.com (Kling 영상 CDN)
 * - VIDEO_BUCKET_DOMAIN (R2 커스텀 도메인, 설정된 경우)
 */
function isAllowedUri(uri: string, videoBucketDomain?: string): boolean {
  if (uri.startsWith("gs://")) return true;

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  const allowedHosts = [
    "storage.googleapis.com",
    "cdn.klingai.com",
    "cdn.kling.com",
  ];

  if (videoBucketDomain) {
    allowedHosts.push(videoBucketDomain.toLowerCase());
  }

  return allowedHosts.includes(host);
}

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

export const onRequestGet: PagesFunction<ProxyEnv> = async (context) => {
  try {
    const url = new URL(context.request.url);

    // ── R2 key 기반 서빙 (upload-video.ts에서 R2에 저장한 영상) ──
    const r2key = url.searchParams.get("r2key");
    if (r2key) {
      if (!context.env.VIDEO_BUCKET) {
        return new Response("VIDEO_BUCKET R2 binding not configured", { status: 501 });
      }

      const obj = await context.env.VIDEO_BUCKET.get(r2key);
      if (!obj) {
        console.warn(`[proxy-video] R2 object not found: ${r2key}`);
        return new Response("Video not found in R2", { status: 404 });
      }

      return new Response(obj.body, {
        headers: {
          "Content-Type": obj.httpMetadata?.contentType || "video/mp4",
          "Content-Length": String(obj.size),
          "Cache-Control": "public, max-age=3600",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // ── GCS URI 기반 프록시 (기존 로직) ──
    const videoUri = url.searchParams.get("uri");

    if (!videoUri) {
      return new Response("uri or r2key parameter is required", { status: 400 });
    }

    // SSRF 방지: 허용된 도메인만 프록시
    if (!isAllowedUri(videoUri, context.env.VIDEO_BUCKET_DOMAIN)) {
      console.warn(`[proxy-video] Blocked disallowed URI: ${videoUri.slice(0, 120)}`);
      return new Response("Forbidden: URI not in allowlist", { status: 403 });
    }

    // gs:// → GCS JSON API URL 변환 (Cloudflare Workers는 gs:// 미지원)
    const fetchUri = gcsUriToHttps(videoUri);
    if (fetchUri !== videoUri) {
      console.log(`[proxy-video] gs:// 변환: ${videoUri.slice(0, 60)}… → GCS API URL`);
    }

    // GCS/Kling CDN은 인증 불필요 — fetchWithAuth 사용 금지 (API 키 유출 방지)
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25_000);
    let res: Response;
    try {
      res = await fetch(fetchUri, { method: "GET", signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }

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
