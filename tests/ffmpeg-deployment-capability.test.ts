/**
 * ffmpeg-deployment-capability.test.ts — FFmpeg.wasm 배포 환경 가용성 테스트
 *
 * 검증 범위:
 * 1. 가용 불가 사유 메시지에 fallback 안내 포함
 * 2. COOP/COEP _headers 파일 형식 검증
 * 3. 캐퍼빌리티 상태별 UI 메시지 정확성
 * 4. wrangler.toml에 pages_build_output_dir 포함
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { getFFmpegUnavailableMessage, type FFmpegUnavailableReason } from "../src/lib/ffmpeg-wasm-loader";

// ═══════════════════════════════════════════════════════════════════
// 1. 불가 사유 메시지에 fallback 안내 포함
// ═══════════════════════════════════════════════════════════════════

describe("FFmpeg 불가 메시지에 fallback 안내 포함", () => {
  const reasons: FFmpegUnavailableReason[] = [
    "not_browser",
    "no_sharedarraybuffer",
    "no_wasm_support",
    "package_not_installed",
    "load_failed",
  ];

  for (const reason of reasons) {
    it(`${reason} → 개별 clip 다운로드 안내 포함`, () => {
      const msg = getFFmpegUnavailableMessage(reason);
      expect(msg).toContain("개별 clip 다운로드");
      expect(msg.length).toBeGreaterThan(20);
    });
  }

  it("no_sharedarraybuffer → SharedArrayBuffer 언급 + 브라우저 안내", () => {
    const msg = getFFmpegUnavailableMessage("no_sharedarraybuffer");
    expect(msg).toContain("SharedArrayBuffer");
    expect(msg).toContain("Chrome");
  });

  it("no_wasm_support → 최신 브라우저 안내", () => {
    const msg = getFFmpegUnavailableMessage("no_wasm_support");
    expect(msg).toContain("최신");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Cloudflare Pages _headers 파일 형식 검증
// ═══════════════════════════════════════════════════════════════════

describe("public/_headers 파일 검증", () => {
  const headersPath = resolve(__dirname, "../public/_headers");

  it("_headers 파일이 존재", () => {
    expect(existsSync(headersPath)).toBe(true);
  });

  it("Cross-Origin-Opener-Policy: same-origin 포함", () => {
    const content = readFileSync(headersPath, "utf-8");
    expect(content).toContain("Cross-Origin-Opener-Policy: same-origin");
  });

  it("Cross-Origin-Embedder-Policy: credentialless 포함", () => {
    const content = readFileSync(headersPath, "utf-8");
    expect(content).toContain("Cross-Origin-Embedder-Policy: credentialless");
  });

  it("/* 패턴으로 모든 경로에 적용", () => {
    const content = readFileSync(headersPath, "utf-8");
    const firstLine = content.trim().split("\n")[0].trim();
    expect(firstLine).toBe("/*");
  });

  it("require-corp 사용하지 않음 (외부 리소스 차단 방지)", () => {
    const content = readFileSync(headersPath, "utf-8");
    expect(content).not.toContain("require-corp");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. wrangler.toml 배포 설정 검증
// ═══════════════════════════════════════════════════════════════════

describe("wrangler.toml 배포 설정", () => {
  const tomlPath = resolve(__dirname, "../wrangler.toml");

  it("wrangler.toml 파일이 존재", () => {
    expect(existsSync(tomlPath)).toBe(true);
  });

  it("pages_build_output_dir 설정 포함", () => {
    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("pages_build_output_dir");
  });

  it("pages_build_output_dir = out (next export 출력)", () => {
    const content = readFileSync(tomlPath, "utf-8");
    // 값 매칭: "out" 문자열
    expect(content).toMatch(/pages_build_output_dir\s*=\s*"out"/);
  });

  it("R2 바인딩 포함", () => {
    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("VIDEO_BUCKET");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. next.config.mjs export 모드 확인
// ═══════════════════════════════════════════════════════════════════

describe("next.config.mjs 정적 빌드 확인", () => {
  const configPath = resolve(__dirname, "../next.config.mjs");

  it("output: export 설정 (정적 빌드)", () => {
    const content = readFileSync(configPath, "utf-8");
    expect(content).toMatch(/output:\s*["']export["']/);
  });

  it("headers() 존재하지만 export 모드에서는 무시됨 (dev 전용)", () => {
    const content = readFileSync(configPath, "utf-8");
    // headers 설정이 있지만 comment에서 dev용임을 명시
    expect(content).toContain("headers()");
    // _headers 파일로 위임한다는 주석이 있어야 함
    expect(content).toContain("public/_headers");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Capability detection 상태 조합
// ═══════════════════════════════════════════════════════════════════

describe("캐퍼빌리티 감지 상태 조합", () => {
  it("모든 FFmpegUnavailableReason에 대해 메시지가 비어있지 않음", () => {
    const reasons: FFmpegUnavailableReason[] = [
      "not_browser",
      "no_sharedarraybuffer",
      "no_wasm_support",
      "package_not_installed",
      "load_failed",
    ];
    for (const reason of reasons) {
      const msg = getFFmpegUnavailableMessage(reason);
      expect(msg).toBeTruthy();
      expect(msg.length).toBeGreaterThan(10);
    }
  });
});
