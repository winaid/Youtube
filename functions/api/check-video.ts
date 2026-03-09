import { GeminiEnv, fetchWithAuth, buildVeoFetchUrl } from "./_gemini-keys";

type Env = GeminiEnv;

// === 비디오 결과 타입 ===

interface VideoResultUri {
  kind: "uri";
  uri: string;
  seed?: string;
}

interface VideoResultBase64 {
  kind: "base64";
  data: string;
  mimeType: string;
  seed?: string;
}

interface VideoResultFileObject {
  kind: "file-object";
  uri?: string;
  mimeType?: string;
  state?: string;
  seed?: string;
}

type VideoResult = VideoResultUri | VideoResultBase64 | VideoResultFileObject;

// === 타입 가드 ===

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

// === 비디오 결과 추출 함수 ===

function extractVideoResults(raw: Record<string, unknown>): VideoResult[] {
  const results: VideoResult[] = [];
  const resp = isRecord(raw.response) ? raw.response : undefined;

  // 1) response.generateVideoResponse.generatedSamples[].video.uri
  const gvr = resp && isRecord(resp.generateVideoResponse) ? resp.generateVideoResponse : undefined;
  extractFromSamples(gvr?.generatedSamples, results);

  // 2) response.generatedSamples[].video.uri
  if (results.length === 0 && resp) {
    extractFromSamples(resp.generatedSamples, results);
  }

  // 3) data.generatedSamples[].video.uri (최상위)
  if (results.length === 0) {
    extractFromSamples(raw.generatedSamples, results);
  }

  // 4) response.generatedVideos[].video (file object 형태)
  if (results.length === 0 && resp) {
    extractFromGeneratedVideos(resp.generatedVideos, results);
  }

  // 5) data.generatedVideos[].video (최상위)
  if (results.length === 0) {
    extractFromGeneratedVideos(raw.generatedVideos, results);
  }

  // 6) response.predictions[].bytesBase64Encoded (base64 형태)
  if (results.length === 0 && resp) {
    extractFromPredictions(resp.predictions, results);
  }

  // 7) data.predictions[].bytesBase64Encoded (최상위)
  if (results.length === 0) {
    extractFromPredictions(raw.predictions, results);
  }

  // 8) Deep search — 위 모든 경로에 없으면 JSON 전체에서 URI/base64 탐색
  if (results.length === 0) {
    deepSearchVideoData(raw, results);
  }

  return results;
}

function extractFromSamples(samples: unknown, results: VideoResult[]): void {
  if (!isArray(samples)) return;
  for (const sample of samples) {
    if (!isRecord(sample)) continue;
    const video = isRecord(sample.video) ? sample.video : undefined;
    const seed = sample.seed !== undefined ? String(sample.seed) : undefined;

    // video.uri
    if (video && isString(video.uri) && video.uri.length > 0) {
      results.push({ kind: "uri", uri: video.uri, seed });
      continue;
    }

    // video가 file object인 경우 (uri, mimeType, state 등)
    if (video && (isString(video.uri) || isString(video.name) || isString(video.mimeType))) {
      results.push({
        kind: "file-object",
        uri: isString(video.uri) ? video.uri : isString(video.name) ? video.name : undefined,
        mimeType: isString(video.mimeType) ? video.mimeType : undefined,
        state: isString(video.state) ? video.state : undefined,
        seed,
      });
      continue;
    }

    // sample 자체에 uri가 있는 경우
    if (isString(sample.uri) && sample.uri.length > 0) {
      results.push({ kind: "uri", uri: sample.uri, seed });
      continue;
    }

    // sample에 bytesBase64Encoded가 있는 경우
    if (isString(sample.bytesBase64Encoded) && sample.bytesBase64Encoded.length > 100) {
      results.push({
        kind: "base64",
        data: sample.bytesBase64Encoded,
        mimeType: isString(sample.mimeType) ? sample.mimeType : "video/mp4",
        seed,
      });
    }
  }
}

function extractFromGeneratedVideos(videos: unknown, results: VideoResult[]): void {
  if (!isArray(videos)) return;
  for (const item of videos) {
    if (!isRecord(item)) continue;
    const seed = item.seed !== undefined ? String(item.seed) : undefined;
    const video = isRecord(item.video) ? item.video : undefined;

    if (video) {
      if (isString(video.uri) && video.uri.length > 0) {
        results.push({ kind: "uri", uri: video.uri, seed });
      } else {
        results.push({
          kind: "file-object",
          uri: isString(video.uri) ? video.uri : isString(video.name) ? video.name : undefined,
          mimeType: isString(video.mimeType) ? video.mimeType : undefined,
          state: isString(video.state) ? video.state : undefined,
          seed,
        });
      }
    } else if (isString(item.uri) && item.uri.length > 0) {
      results.push({ kind: "uri", uri: item.uri, seed });
    }
  }
}

function extractFromPredictions(predictions: unknown, results: VideoResult[]): void {
  if (!isArray(predictions)) return;
  for (const pred of predictions) {
    if (!isRecord(pred)) continue;
    const seed = pred.seed !== undefined ? String(pred.seed) : undefined;

    // bytesBase64Encoded
    if (isString(pred.bytesBase64Encoded) && pred.bytesBase64Encoded.length > 100) {
      results.push({
        kind: "base64",
        data: pred.bytesBase64Encoded,
        mimeType: isString(pred.mimeType) ? pred.mimeType : "video/mp4",
        seed,
      });
      continue;
    }

    // prediction에 video 객체
    const video = isRecord(pred.video) ? pred.video : undefined;
    if (video && isString(video.uri) && video.uri.length > 0) {
      results.push({ kind: "uri", uri: video.uri, seed });
      continue;
    }

    // prediction 자체에 uri
    if (isString(pred.uri) && pred.uri.length > 0) {
      results.push({ kind: "uri", uri: pred.uri, seed });
    }
  }
}

// === 안전한 JSON 직렬화 (순환 참조/스택 오버플로 방지) ===

function safeStringify(val: unknown, maxLen = 4000): string {
  try {
    const s = JSON.stringify(val);
    return s.length > maxLen ? s.slice(0, maxLen) + "…(truncated)" : s;
  } catch (e) {
    return `[safeStringify failed: ${e instanceof Error ? e.message : String(e)}]`;
  }
}

/**
 * 로깅 전용 sanitizer — 큰 문자열(base64 영상 등)을 길이 표시로 대체.
 * safeStringify(rawData) 호출 시 수십 MB 문자열을 JSON.stringify하면
 * V8 rope-string flattening 과정에서 스택 오버플로가 발생할 수 있으므로
 * 반드시 이 함수를 거쳐야 함.
 */
function sanitizeForLog(obj: unknown, depth = 0): unknown {
  if (depth > 6) return "[maxDepth]";
  if (typeof obj === "string") {
    return obj.length > 120 ? `[string len=${obj.length}]` : obj;
  }
  if (isArray(obj)) {
    return (obj as unknown[]).slice(0, 8).map((item) => sanitizeForLog(item, depth + 1));
  }
  if (isRecord(obj)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = sanitizeForLog(v, depth + 1);
    }
    return out;
  }
  return obj;
}

function deepSearchVideoData(raw: Record<string, unknown>, results: VideoResult[]): void {
  let jsonStr: string;
  try {
    jsonStr = JSON.stringify(raw);
  } catch (e) {
    console.error("[check-video] deepSearch: JSON.stringify(raw) threw:", e instanceof Error ? e.message : String(e));
    return;
  }

  // 1차: gs:// URI는 무조건 영상 (GCS = Veo 기본 출력 위치)
  const gsUriRegex = /"uri"\s*:\s*"(gs:\/\/[^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = gsUriRegex.exec(jsonStr)) !== null) {
    results.push({ kind: "uri", uri: match[1] });
  }

  // 2차: https:// 중 영상 관련 경로 (.mp4, /video/, /output/, /sample_)
  if (results.length === 0) {
    const httpsVideoRegex = /"uri"\s*:\s*"(https?:\/\/[^"]+(?:\.mp4|\/video\/|\/output\/|\/sample_)[^"]*)"/g;
    while ((match = httpsVideoRegex.exec(jsonStr)) !== null) {
      results.push({ kind: "uri", uri: match[1] });
    }
  }

  // URI를 못 찾았으면 더 넓은 패턴
  if (results.length === 0) {
    const broadUriRegex = /"uri"\s*:\s*"((?:gs|https?):\/\/[^"]+)"/g;
    while ((match = broadUriRegex.exec(jsonStr)) !== null) {
      // OAuth 토큰 교환 URL만 제외 (영상 다운로드 URL은 aiplatform 도메인도 유효할 수 있음)
      if (!/oauth2\.googleapis\.com\/token|accounts\.google\.com/.test(match[1])) {
        results.push({ kind: "uri", uri: match[1] });
      }
    }
  }

  // base64 데이터 탐색
  if (results.length === 0) {
    const b64Regex = /"bytesBase64Encoded"\s*:\s*"([A-Za-z0-9+/=]{200,})"/;
    const b64Match = jsonStr.match(b64Regex);
    if (b64Match) {
      results.push({ kind: "base64", data: b64Match[1], mimeType: "video/mp4" });
    }
  }

  if (results.length > 0) {
    console.log("Deep search found results:", results.map(r => r.kind));
  }
}

// === RAI 필터 감지 ===

interface RaiInfo {
  filtered: boolean;
  count?: number;
  reasons?: string[];
}

function detectRaiFiltering(raw: Record<string, unknown>): RaiInfo {
  const resp = isRecord(raw.response) ? raw.response : undefined;
  const targets = [resp, raw];

  for (const obj of targets) {
    if (!obj) continue;
    const count = obj.raiMediaFilteredCount as number | undefined;
    const reasons = isArray(obj.raiMediaFilteredReasons) ? obj.raiMediaFilteredReasons as string[] : undefined;

    if (count && count > 0) {
      return { filtered: true, count, reasons };
    }
  }

  // generateVideoResponse 내부에도 있을 수 있음
  const gvr = resp && isRecord(resp.generateVideoResponse) ? resp.generateVideoResponse : undefined;
  if (gvr) {
    const count = gvr.raiMediaFilteredCount as number | undefined;
    const reasons = isArray(gvr.raiMediaFilteredReasons) ? gvr.raiMediaFilteredReasons as string[] : undefined;
    if (count && count > 0) {
      return { filtered: true, count, reasons };
    }
  }

  return { filtered: false };
}

// === 응답 구조 로깅 ===

function logResponseStructure(raw: Record<string, unknown>): {
  dataKeys: string[];
  responseKeys: string[];
  gvrKeys: string[];
  deepKeys: Record<string, string[]>;
} {
  const dataKeys = Object.keys(raw);
  const resp = isRecord(raw.response) ? raw.response : undefined;
  const responseKeys = resp ? Object.keys(resp) : [];
  const gvr = resp && isRecord(resp.generateVideoResponse) ? resp.generateVideoResponse : undefined;
  const gvrKeys = gvr ? Object.keys(gvr) : [];

  // 2단계 깊이까지 키 수집
  const deepKeys: Record<string, string[]> = {};
  if (resp) {
    const respEntries = Object.keys(resp);
    for (const k of respEntries) {
      const v = resp[k];
      if (isRecord(v)) deepKeys[`response.${k}`] = Object.keys(v);
      if (isArray(v) && v.length > 0 && isRecord(v[0])) deepKeys[`response.${k}[0]`] = Object.keys(v[0] as Record<string, unknown>);
    }
  }

  return { dataKeys, responseKeys, gvrKeys, deepKeys };
}

// === operationName에서 모델명 추출 (로그용) ===

function extractModel(operationName: string): string | null {
  const m = operationName.match(/models\/([^/]+)\/operations\//);
  return m ? m[1] : null;
}

// === 메인 핸들러 ===

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    // ── 1. Request body 파싱 (실패 시 400 반환)
    let bodyText = "";
    let operationName = "";
    try {
      bodyText = await context.request.text();
      const parsed = JSON.parse(bodyText) as { operationName?: string };
      operationName = parsed.operationName || "";
    } catch (parseErr) {
      console.error("[check-video] JSON parse failed. body:", bodyText.slice(0, 500), "err:", parseErr);
      return Response.json({ error: "Invalid JSON body", details: String(parseErr) }, { status: 400 });
    }

    console.log(`[check-video] operationName=${operationName}`);

    if (!operationName) {
      return Response.json({ error: "operationName is required" }, { status: 400 });
    }

    const model = extractModel(operationName);
    // buildVeoFetchUrl: operationName에서 리전 추출, global → us-central1 대체
    // generate-video.ts 가 us-central1 buildVeoUrl 로 생성했으므로 리전 일치
    const url = buildVeoFetchUrl(context.env, operationName);
    console.log(`[check-video] model=${model ?? "unknown"} url=${url}`);

    // Cloudflare Pages 타임아웃(100s) 전에 자체 타임아웃 설정
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    let res: Response;
    try {
      res = await fetchWithAuth(context.env, url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationName }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === "AbortError") {
        // 자체 25s 타임아웃 — 아직 처리 중
        return Response.json({ status: "RUNNING" });
      }
      // fetch() 네트워크 레벨 오류 (DNS 실패, 연결 거부 등) — transient 에러로 취급
      // re-throw 하면 외부 catch → 500 반환 → 클라이언트 폴링 중단 위험
      // RUNNING 반환으로 클라이언트가 재시도하도록 유도
      console.warn("[check-video] fetchWithAuth 네트워크 오류 — RUNNING으로 처리:", err instanceof Error ? err.message : String(err));
      return Response.json({ status: "RUNNING" });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[check-video] fetchPredictOperation failed status=${res.status} url=${url} body=${errText.slice(0, 800)}`);
      // 4xx는 클라이언트 문제, 5xx는 서버 문제로 구분
      const clientStatus = res.status >= 400 && res.status < 500 ? res.status : 502;
      return Response.json(
        { error: `API error: ${res.status}`, details: errText.slice(0, 500) },
        { status: clientStatus }
      );
    }

    let data: Record<string, unknown>;
    const rawText = await res.text();
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch (jsonErr) {
      console.error("[check-video] Response JSON parse failed:", jsonErr, "raw:", rawText.slice(0, 500));
      return Response.json({ error: "Invalid JSON from Vertex AI", details: String(jsonErr) }, { status: 502 });
    }

    if (data.error) {
      const err = data.error as { message?: string; code?: number };
      return Response.json({
        status: "FAILED",
        error: err.message || "Unknown error",
      });
    }

    if (!data.done) {
      return Response.json({ status: "RUNNING" });
    }

    // 응답 구조 로그 (디버깅용)
    // ⚠️ safeStringify(data) 직접 호출 금지 — base64 영상이 수 MB이면 V8 rope-string
    //    flattening 도중 스택 오버플로(RangeError) 발생. sanitizeForLog 필수.
    const structure = logResponseStructure(data);
    console.log("[check-video] Veo poll response structure:", safeStringify(structure));
    console.log("[check-video] Veo poll response (sanitized):", safeStringify(sanitizeForLog(data)));

    // RAI 필터 체크
    const rai = detectRaiFiltering(data);
    if (rai.filtered) {
      const reasonStr = rai.reasons?.join(", ") || "안전 정책 위반";
      console.error("Veo RAI filtered:", rai.count, "reasons:", reasonStr);
      return Response.json({
        status: "FAILED",
        error: `Veo 안전 필터에 의해 영상이 차단되었습니다 (${reasonStr}). 프롬프트에서 폭력/성적/위험한 내용을 제거해주세요.`,
        raiFiltered: true,
        raiReasons: rai.reasons,
      });
    }

    // 비디오 결과 추출
    const videoResults = extractVideoResults(data);

    if (videoResults.length === 0) {
      console.error("[check-video] No video result found. structure:", safeStringify(structure), "raw:", safeStringify(data, 2000));
      return Response.json({
        status: "FAILED",
        error: `영상 결과를 찾을 수 없습니다. response 구조: ${safeStringify(structure.deepKeys)}`,
        structure,
        rawKeys: Object.keys(data),
      });
    }

    // 결과를 클라이언트용 variants로 변환
    const toProxyUrl = (uri: string) =>
      `/api/proxy-video?uri=${encodeURIComponent(uri)}`;

    const variants: { videoUri: string; rawVideoUri: string; seed?: string; resultKind: string }[] = [];

    for (const result of videoResults) {
      switch (result.kind) {
        case "uri": {
          variants.push({
            videoUri: toProxyUrl(result.uri),
            rawVideoUri: result.uri,
            seed: result.seed,
            resultKind: "uri",
          });
          break;
        }
        case "file-object": {
          // file-object에 URI가 있으면 사용
          if (result.uri && result.uri.length > 0) {
            variants.push({
              videoUri: toProxyUrl(result.uri),
              rawVideoUri: result.uri,
              seed: result.seed,
              resultKind: "file-object",
            });
          }
          break;
        }
        case "base64": {
          // base64 → data URI로 변환 (클라이언트에서 직접 재생 가능)
          const dataUri = `data:${result.mimeType};base64,${result.data}`;
          variants.push({
            videoUri: dataUri,
            // rawVideoUri는 Scene Extension용 gs:// / https:// URI에만 사용.
            // data URI를 그대로 저장하면:
            //   1) 수 MB 문자열이 클라이언트 state에 2벌 (videoUri + rawVideoUri) 저장됨
            //   2) 다음 컷 generateCut 시 body에 포함되어 수십 MB 요청 발생
            //   3) generate-video.ts에서 invalid URI 판정 → Scene Extension 건너뜀 (어차피 불가)
            // → 빈 문자열로 설정하여 Scene Extension 시도 자체를 차단
            rawVideoUri: "",
            seed: result.seed,
            resultKind: "base64",
          });
          break;
        }
      }
    }

    if (variants.length === 0) {
      console.error("[check-video] Video results found but no playable variants. kinds:", videoResults.map(r => r.kind));
      return Response.json({
        status: "FAILED",
        error: "비디오 결과는 있으나 재생 가능한 형태가 아닙니다",
        resultKinds: videoResults.map(r => r.kind),
        structure,
        rawKeys: Object.keys(data),
      });
    }

    console.log("Video result:", variants.length, "variants,", "kinds:", variants.map(v => v.resultKind));

    return Response.json({
      status: "COMPLETED",
      videoUri: variants[0].videoUri,
      rawVideoUri: variants[0].rawVideoUri,
      seed: variants[0].seed,
      variants,
      sampleCount: variants.length,
    });
  } catch (error) {
    const errType = error instanceof Error ? error.constructor.name : typeof error;
    const errMsg = error instanceof Error ? error.message : String(error);
    // stack overflow 시 error.stack 자체가 비어 있을 수 있음 — 안전하게 처리
    let errStack = "";
    try { errStack = (error instanceof Error && error.stack) ? error.stack.slice(0, 1500) : ""; } catch { /* ignore */ }
    console.error(`[check-video] UNHANDLED ${errType}: ${errMsg}\nstack: ${errStack}`);
    return Response.json(
      { error: `Failed to check video: ${errMsg}`, errorType: errType },
      { status: 500 }
    );
  }
};
