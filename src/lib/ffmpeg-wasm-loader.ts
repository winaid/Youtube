/**
 * ffmpeg-wasm-loader.ts — FFmpeg.wasm lazy loader
 *
 * 설계:
 *   - FFmpeg.wasm은 ~30MB WASM 바이너리 → 필요할 때만 로딩
 *   - SharedArrayBuffer 사용 가능 여부(COOP/COEP 헤더) 사전 감지
 *   - 싱글톤 인스턴스 — 한 번 로드하면 재사용
 *   - 로딩 실패 시 명확한 에러 분류 반환
 *
 * 의존성:
 *   - @ffmpeg/ffmpeg (dynamic import)
 *   - @ffmpeg/util  (dynamic import)
 *
 * 현재 상태:
 *   - @ffmpeg/ffmpeg 패키지가 설치되지 않은 상태에서도 타입 안전하게 동작
 *   - detectFFmpegAvailability()로 설치/환경 가용 여부를 사전 확인
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type FFmpegAvailability =
  | { available: true }
  | { available: false; reason: FFmpegUnavailableReason };

export type FFmpegUnavailableReason =
  | "not_browser"           // SSR / Node.js 환경
  | "no_sharedarraybuffer"  // COOP/COEP 헤더 없음 → SharedArrayBuffer 비활성
  | "no_wasm_support"       // 브라우저가 WebAssembly 미지원
  | "package_not_installed" // @ffmpeg/ffmpeg 미설치
  | "load_failed";          // 로딩 중 런타임 에러

export interface FFmpegInstance {
  exec: (args: string[]) => Promise<number>;
  writeFile: (name: string, data: Uint8Array) => Promise<void>;
  readFile: (name: string) => Promise<Uint8Array>;
  deleteFile: (name: string) => Promise<void>;
  terminate: () => void;
}

// ═══════════════════════════════════════════════════════════════════
// Environment Detection
// ═══════════════════════════════════════════════════════════════════

/** 브라우저 환경인지 확인 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** SharedArrayBuffer 사용 가능 여부 (COOP/COEP 헤더 필요) */
function hasSharedArrayBuffer(): boolean {
  try {
    return typeof SharedArrayBuffer !== "undefined";
  } catch {
    return false;
  }
}

/** WebAssembly 지원 여부 */
function hasWasmSupport(): boolean {
  try {
    return typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function";
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Availability Check (패키지 설치 불필요)
// ═══════════════════════════════════════════════════════════════════

/**
 * FFmpeg.wasm 사용 가능 여부를 사전 감지.
 * 패키지 설치 여부는 dynamic import try-catch로 확인.
 * 이 함수는 실제 WASM 로딩을 하지 않으며 환경 조건만 검사.
 */
export async function detectFFmpegAvailability(): Promise<FFmpegAvailability> {
  if (!isBrowser()) {
    return { available: false, reason: "not_browser" };
  }
  if (!hasWasmSupport()) {
    return { available: false, reason: "no_wasm_support" };
  }
  if (!hasSharedArrayBuffer()) {
    return { available: false, reason: "no_sharedarraybuffer" };
  }

  // 패키지 설치 여부 — dynamic import로 확인
  try {
    // @ts-expect-error — @ffmpeg/ffmpeg는 optional dependency, 설치 전에는 타입 없음
    await import("@ffmpeg/ffmpeg");
    return { available: true };
  } catch {
    return { available: false, reason: "package_not_installed" };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Singleton Loader
// ═══════════════════════════════════════════════════════════════════

let cachedInstance: FFmpegInstance | null = null;
let loadingPromise: Promise<FFmpegInstance> | null = null;

/**
 * FFmpeg.wasm 싱글톤 인스턴스를 반환.
 * 첫 호출 시 WASM 로딩 (30MB+), 이후 캐시된 인스턴스 재사용.
 *
 * @throws Error — 로딩 실패 시 (사유 포함)
 */
export async function loadFFmpeg(): Promise<FFmpegInstance> {
  if (cachedInstance) return cachedInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    // 환경 조건 확인
    const availability = await detectFFmpegAvailability();
    if (!availability.available) {
      throw new Error(`FFmpeg.wasm unavailable: ${availability.reason}`);
    }

    try {
      // @ts-expect-error — @ffmpeg/ffmpeg는 optional dependency
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      // @ts-expect-error — @ffmpeg/util는 optional dependency
      const { toBlobURL } = await import("@ffmpeg/util");

      const ffmpeg = new FFmpeg();

      // CDN에서 WASM core 로딩 (unpkg)
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });

      const instance: FFmpegInstance = {
        exec: (args) => ffmpeg.exec(args),
        writeFile: (name, data) => ffmpeg.writeFile(name, data),
        readFile: async (name) => {
          const result = await ffmpeg.readFile(name);
          if (result instanceof Uint8Array) return result;
          // string 응답인 경우 (비정상이지만 방어)
          return new TextEncoder().encode(result as string);
        },
        deleteFile: (name) => ffmpeg.deleteFile(name),
        terminate: () => ffmpeg.terminate(),
      };

      cachedInstance = instance;
      return instance;
    } catch (err) {
      loadingPromise = null; // 재시도 허용
      throw new Error(
        `FFmpeg.wasm load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  })();

  return loadingPromise;
}

/**
 * FFmpeg.wasm 인스턴스 해제.
 * 메모리 정리 시 호출.
 */
export function terminateFFmpeg(): void {
  if (cachedInstance) {
    cachedInstance.terminate();
    cachedInstance = null;
    loadingPromise = null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Unavailable Reason → 사용자 안내 메시지 매핑
// ═══════════════════════════════════════════════════════════════════

export function getFFmpegUnavailableMessage(reason: FFmpegUnavailableReason): string {
  switch (reason) {
    case "not_browser":
      return "브라우저 환경에서만 영상 합치기가 가능합니다.";
    case "no_sharedarraybuffer":
      return "이 사이트의 보안 헤더(COOP/COEP) 설정이 필요합니다. 서버 관리자에게 문의하세요.";
    case "no_wasm_support":
      return "현재 브라우저가 WebAssembly를 지원하지 않습니다. 최신 브라우저를 사용해주세요.";
    case "package_not_installed":
      return "영상 합치기 기능이 아직 설치되지 않았습니다. (FFmpeg.wasm 패키지 필요)";
    case "load_failed":
      return "영상 합치기 엔진 로딩에 실패했습니다. 페이지를 새로고침 후 다시 시도해주세요.";
  }
}
