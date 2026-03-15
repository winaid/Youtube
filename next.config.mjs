/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",

  // COOP/COEP — SharedArrayBuffer 활성화 (FFmpeg.wasm stitch에 필수)
  // dev 모드에서 적용. 프로덕션(Cloudflare Pages)은 public/_headers에서 설정.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
