import { GeminiEnv, fetchWithAuth, buildVeoFetchUrl } from "./_gemini-keys";
import { klingCheckStatus, type KlingEnv } from "./_kling-api";

type Env = GeminiEnv & KlingEnv;

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

  // 9) base64만 있고 URI가 없는 경우 → GCS/HTTPS URI를 별도로 deep search
  // extractFromSamples가 base64를 먼저 찾으면 deepSearchVideoData가 스킵되는 문제 보완
  const hasUri = results.some(r => r.kind === "uri" || (r.kind === "file-object" && r.uri));
  const hasBase64Only = results.length > 0 && !hasUri;
  if (hasBase64Only) {
    console.log("[check-video] base64 결과만 있음 → GCS/HTTPS URI 추가 탐색 시작");
    const uriResults: VideoResult[] = [];
    deepSearchVideoData(raw, uriResults);
    // deep search에서 URI만 추출 (base64 중복 방지)
    const uriOnly = uriResults.filter(r => r.kind === "uri" || (r.kind === "file-object" && r.uri));
    if (uriOnly.length > 0) {
      console.log("[check-video] ✓ deep search로 GCS/HTTPS URI 발견:", uriOnly.map(r => {
        const uri = r.kind === "uri" ? r.uri : (r as VideoResultFileObject).uri;
        return uri ? uri.slice(0, 80) : "(empty)";
      }));
      // URI 결과를 앞에 배치 (rawVideoUri가 URI를 사용하도록)
      results.unshift(...uriOnly);
    } else {
      console.warn("[check-video] ✗ deep search에서도 GCS/HTTPS URI 없음 — Scene Extension 불가");
    }
  }

  return results;
}

function extractFromSamples(samples: unknown, results: VideoResult[]): void {
  if (!isArray(samples)) return;
  for (const sample of samples) {
    if (!isRecord(sample)) continue;
    const video = isRecord(sample.video) ? sample.video : undefined;
    const seed = sample.seed !== undefined ? String(sample.seed) : undefined;

    // video.uri (혹은 gcsUri, storageUri, videoUri, downloadUri, outputUri — Veo 버전별 필드명 차이 대응)
    if (video) {
      const videoUri = isString(video.uri) ? video.uri
        : isString(video.gcsUri) ? video.gcsUri
        : isString(video.storageUri) ? video.storageUri
        : isString(video.videoUri) ? video.videoUri
        : isString(video.downloadUri) ? video.downloadUri
        : isString(video.outputUri) ? video.outputUri
        : isString(video.httpsUrl) ? video.httpsUrl
        : "";
      if (videoUri.length > 0) {
        results.push({ kind: "uri", uri: videoUri, seed });
        continue;
      }
      // URI 필드가 비어있으면 video 객체의 모든 string 필드에서 gs:// 또는 https:// 탐색
      for (const [key, val] of Object.entries(video)) {
        if (key === "bytesBase64Encoded" || key === "mimeType" || key === "state") continue;
        if (isString(val) && (val.startsWith("gs://") || val.startsWith("https://")) && val.length > 10) {
          console.log(`[check-video] video 객체의 예상 외 필드에서 URI 발견: video.${key}`);
          results.push({ kind: "uri", uri: val, seed });
          break;
        }
      }
      if (results.length > 0) continue;
    }

    // video가 file object인 경우 (uri, mimeType, state 등)
    if (video && (isString(video.uri) || isString(video.gcsUri) || isString(video.name) || isString(video.mimeType))) {
      const fileUri = isString(video.uri) ? video.uri
        : isString(video.gcsUri) ? video.gcsUri
        : isString(video.storageUri) ? video.storageUri
        : isString(video.name) ? video.name
        : undefined;
      results.push({
        kind: "file-object",
        uri: fileUri,
        mimeType: isString(video.mimeType) ? video.mimeType : undefined,
        state: isString(video.state) ? video.state : undefined,
        seed,
      });
      continue;
    }

    // sample 자체에 uri/gcsUri가 있는 경우
    const sampleUri = isString(sample.uri) ? sample.uri
      : isString(sample.gcsUri) ? sample.gcsUri
      : isString(sample.storageUri) ? sample.storageUri
      : "";
    if (sampleUri.length > 0) {
      results.push({ kind: "uri", uri: sampleUri, seed });
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
      // video.uri / gcsUri / storageUri / videoUri 대응
      const videoUri = isString(video.uri) ? video.uri
        : isString(video.gcsUri) ? video.gcsUri
        : isString(video.storageUri) ? video.storageUri
        : isString(video.videoUri) ? video.videoUri
        : "";
      if (videoUri.length > 0) {
        results.push({ kind: "uri", uri: videoUri, seed });
      } else {
        results.push({
          kind: "file-object",
          uri: isString(video.name) ? video.name : undefined,
          mimeType: isString(video.mimeType) ? video.mimeType : undefined,
          state: isString(video.state) ? video.state : undefined,
          seed,
        });
      }
    } else {
      // item 자체에 uri/gcsUri가 있는 경우
      const itemUri = isString(item.uri) ? item.uri
        : isString(item.gcsUri) ? item.gcsUri
        : isString(item.storageUri) ? item.storageUri
        : "";
      if (itemUri.length > 0) {
        results.push({ kind: "uri", uri: itemUri, seed });
      }
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

/**
 * JSON.stringify 없이 객체를 재귀 탐색하여 bytesBase64Encoded 필드를 찾음.
 * 깊이 제한으로 스택 오버플로 방지.
 */
function findBase64InObject(obj: unknown, results: VideoResult[], depth: number): void {
  if (depth > 8 || results.length > 0) return;
  if (isRecord(obj)) {
    const b64 = obj.bytesBase64Encoded;
    if (isString(b64) && b64.length > 200) {
      results.push({
        kind: "base64",
        data: b64,
        mimeType: isString(obj.mimeType) ? obj.mimeType : "video/mp4",
      });
      return;
    }
    for (const v of Object.values(obj)) {
      findBase64InObject(v, results, depth + 1);
      if (results.length > 0) return;
    }
  }
  if (isArray(obj)) {
    for (const item of obj as unknown[]) {
      findBase64InObject(item, results, depth + 1);
      if (results.length > 0) return;
    }
  }
}

/**
 * base64 영상 데이터를 플레이스홀더로 치환하여 안전하게 직렬화.
 * JSON.stringify(raw) 직접 호출 시 수 MB base64 문자열로 인해
 * V8 rope-string flattening 스택 오버플로(RangeError) 발생 가능.
 * URI 검색에는 영향 없음 (base64 데이터는 URI가 아니므로).
 */
function stripBase64ForSearch(obj: unknown, depth = 0): unknown {
  if (depth > 10) return "[maxDepth]";
  if (typeof obj === "string") {
    // base64 데이터(200자 이상)는 제거, URI 등 짧은 문자열은 유지
    return obj.length > 200 ? `[stripped len=${obj.length}]` : obj;
  }
  if (isArray(obj)) {
    return (obj as unknown[]).map((item) => stripBase64ForSearch(item, depth + 1));
  }
  if (isRecord(obj)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = stripBase64ForSearch(v, depth + 1);
    }
    return out;
  }
  return obj;
}

function deepSearchVideoData(raw: Record<string, unknown>, results: VideoResult[]): void {
  // base64 데이터를 제거한 안전한 객체에서 URI 검색
  let jsonStr: string;
  try {
    const stripped = stripBase64ForSearch(raw);
    jsonStr = JSON.stringify(stripped);
  } catch (e) {
    console.error("[check-video] deepSearch: JSON.stringify threw:", e instanceof Error ? e.message : String(e));
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

  // base64 데이터 탐색 — jsonStr에서는 stripped되어 있으므로
  // 원본 객체에서 직접 탐색 (JSON.stringify 없이)
  if (results.length === 0) {
    findBase64InObject(raw, results, 0);
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
  const tCheckStart = Date.now();
  try {
    // ── 1. Request body 파싱 (실패 시 400 반환)
    let bodyText = "";
    let operationName = "";
    let engine: "veo" | "kling" = "veo";
    let taskId = "";
    let isExtend = false;
    let cutNumber: number | null = null;
    try {
      bodyText = await context.request.text();
      const parsed = JSON.parse(bodyText) as {
        operationName?: string;
        engine?: "veo" | "kling";
        taskId?: string;
        isExtend?: boolean;
        cutNumber?: number;
      };
      operationName = parsed.operationName || "";
      engine    = parsed.engine    ?? "veo";
      taskId    = parsed.taskId    || operationName; // Kling: taskId 우선, fallback operationName
      isExtend  = parsed.isExtend  ?? false;
      cutNumber = typeof parsed.cutNumber === "number" ? parsed.cutNumber : null;
    } catch (parseErr) {
      console.error("[check-video] JSON parse failed. body:", bodyText.slice(0, 500), "err:", parseErr);
      return Response.json({ error: "Invalid JSON body", details: String(parseErr) }, { status: 400 });
    }

    // ── 진입 로그 ──────────────────────────────────────────────────────────────
    console.log("[check-video] ENTRY", {
      engine,
      cutNumber,
      operationName: operationName ? operationName.slice(0, 100) : "(empty)",
      taskId: taskId ? taskId.slice(0, 80) : "(empty)",
      isExtend,
    });

    // ── Kling 체크 분기 ────────────────────────────────────────────────────
    if (engine === "kling") {
      if (!taskId) {
        return Response.json({ error: "taskId is required for Kling engine" }, { status: 400 });
      }
      console.log(`[check-video] Kling check`, { taskId, isExtend, cutNumber });

      let result;
      try {
        result = await klingCheckStatus(context.env, taskId, isExtend);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[check-video] Kling check error:", msg);
        // transient error — keep polling
        return Response.json({ status: "RUNNING" });
      }

      // raw 결과 로그
      console.log("[check-video] Kling raw result", {
        rawStatus: result.status,
        progress: result.progress,
        videoUrl: result.videoUrl ? result.videoUrl.slice(0, 80) : null,
        videoId: result.videoId,
        error: result.error,
        parsedStatus:
          result.status === "pending" || result.status === "processing"
            ? "processing"
            : result.status === "completed"
            ? "completed"
            : "failed",
      });

      // EvoLink statuses: pending / processing / completed / failed → 공통 포맷으로 정규화
      if (result.status === "pending" || result.status === "processing") {
        return Response.json({ status: "RUNNING", progress: result.progress });
      }

      if (result.status === "failed") {
        return Response.json({ status: "FAILED", error: result.error ?? "Kling generation failed" });
      }

      // completed
      if (!result.videoUrl) {
        // completed 지만 URL이 없으면 아직 처리 중으로 간주하고 계속 폴링
        console.warn("[check-video] Kling completed but videoUrl missing — treating as processing");
        return Response.json({ status: "RUNNING" });
      }

      return Response.json({
        status: "COMPLETED",
        videoUri: result.videoUrl,
        rawVideoUri: result.videoId ?? taskId, // use videoId as source for next extend
        seed: undefined,
        variants: [{ videoUri: result.videoUrl, rawVideoUri: result.videoId ?? taskId }],
        sampleCount: 1,
        engine: "kling",
      });
    }

    // ── Veo 체크 (기존 로직) ───────────────────────────────────────────────
    console.log(`[check-video] Veo operationName=${operationName ? operationName.slice(0, 80) : "(empty)"}`);

    if (!operationName) {
      return Response.json({ error: "operationName is required" }, { status: 400 });
    }

    const model = extractModel(operationName);
    // buildVeoFetchUrl: operationName에서 리전 추출, global → us-central1 대체
    // generate-video.ts 가 us-central1 buildVeoUrl 로 생성했으므로 리전 일치
    let url: string;
    try {
      url = buildVeoFetchUrl(context.env, operationName);
    } catch (urlErr) {
      const msg = urlErr instanceof Error ? urlErr.message : String(urlErr);
      console.error("[check-video] buildVeoFetchUrl threw:", msg);
      return Response.json({ status: "FAILED", error: `URL 빌드 실패: ${msg}` });
    }
    console.log(`[check-video] Veo model=${model ?? "unknown"} url=${url}`);

    // Cloudflare Pages 타임아웃(100s) 전에 자체 타임아웃 설정
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    let res: Response;
    const tFetchStart = Date.now();
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
      console.error(`[check-video] Veo fetchPredictOperation 실패`, {
        rawStatus: res.status,
        url,
        body: errText.slice(0, 600),
      });
      // 5xx Vertex AI 서버 오류 → transient, 계속 폴링
      if (res.status >= 500) {
        return Response.json({ status: "RUNNING" });
      }
      // 4xx → 즉시 실패 (잘못된 operationName 등)
      return Response.json({
        status: "FAILED",
        error: `Veo API error (${res.status}): ${errText.slice(0, 300)}`,
      });
    }

    let data: Record<string, unknown>;
    const rawText = await res.text();
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch (jsonErr) {
      console.error("[check-video] Veo 응답 JSON 파싱 실패:", jsonErr, "raw:", rawText.slice(0, 500));
      // JSON 파싱 실패도 transient 처리 (Vertex AI 드물게 비정상 응답)
      return Response.json({ status: "RUNNING" });
    }

    if (data.error) {
      const err = data.error as { message?: string; code?: number };
      console.error("[check-video] Veo 응답에 error 필드 존재:", safeStringify(err));
      return Response.json({
        status: "FAILED",
        error: err.message || "Unknown Veo error",
      });
    }

    // raw 응답 구조 로그
    console.log("[check-video] Veo raw response", {
      rawStatus: data.done ? "done" : "running",
      hasDone: "done" in data,
      doneValue: data.done,
      hasError: "error" in data,
      topLevelKeys: Object.keys(data).slice(0, 10),
    });

    if (!data.done) {
      const checkMs = Date.now() - tCheckStart;
      console.log("[check-video] ⏱ RUNNING", { checkMs, cutNumber });
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
      console.error("[check-video] No video result found. structure:", safeStringify(structure), "raw:", safeStringify(sanitizeForLog(data)));
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

    // URI 정규화: gs:// 또는 https:// 만 Scene Extension에 유효
    const normalizeVideoUri = (uri: string): string => {
      if (!uri) return "";
      // gs:// → 그대로 (Veo Scene Extension 가능)
      if (uri.startsWith("gs://")) return uri;
      // https:// → 그대로 (Veo Scene Extension 가능)
      if (uri.startsWith("https://")) return uri;
      // http:// → https:// 로 업그레이드
      if (uri.startsWith("http://")) return uri.replace("http://", "https://");
      // data: URI나 기타 → Scene Extension 불가
      return "";
    };

    const variants: { videoUri: string; rawVideoUri: string; seed?: string; resultKind: string }[] = [];

    for (const result of videoResults) {
      switch (result.kind) {
        case "uri": {
          const normalizedUri = normalizeVideoUri(result.uri);
          variants.push({
            videoUri: toProxyUrl(result.uri),
            rawVideoUri: normalizedUri,
            seed: result.seed,
            resultKind: "uri",
          });
          break;
        }
        case "file-object": {
          // file-object에 URI가 있으면 사용
          if (result.uri && result.uri.length > 0) {
            const normalizedUri = normalizeVideoUri(result.uri);
            variants.push({
              videoUri: toProxyUrl(result.uri),
              rawVideoUri: normalizedUri,
              seed: result.seed,
              resultKind: "file-object",
            });
          }
          break;
        }
        case "base64": {
          // base64 → data URI로 변환 (클라이언트에서 직접 재생 가능)
          const dataUri = `data:${result.mimeType};base64,${result.data}`;
          // rawVideoUri: 같은 응답에서 발견된 GCS/HTTPS URI가 있으면 연결
          // (extractVideoResults 에서 URI 결과가 앞에 추가되었을 수 있음)
          const pairedUri = videoResults.find(
            r => r.kind === "uri" && r.uri && (r.uri.startsWith("gs://") || r.uri.startsWith("https://"))
          );
          const rawUri = pairedUri && pairedUri.kind === "uri" ? normalizeVideoUri(pairedUri.uri) : "";
          if (rawUri) {
            console.log(`[check-video] base64 variant에 GCS URI 연결: ${rawUri.slice(0, 80)}`);
          }
          variants.push({
            videoUri: dataUri,
            rawVideoUri: rawUri,
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

    // ── Scene Extension 가능 여부 진단 ──────────────────────────────
    const hasGcsUri = variants.some(v => v.rawVideoUri && (v.rawVideoUri.startsWith("gs://") || v.rawVideoUri.startsWith("https://")));
    if (!hasGcsUri) {
      console.warn("[check-video] ⚠️ Scene Extension 불가: 모든 variant가 GCS/HTTPS URI 없음", {
        variantCount: variants.length,
        kinds: variants.map(v => v.resultKind),
        rawVideoUris: variants.map(v => v.rawVideoUri ? `${v.rawVideoUri.slice(0, 40)}…` : "(empty)"),
        hint: "Veo가 base64로 응답함 → 다음 컷은 Scene Extension 없이 독립 생성됨. us-central1 리전 확인 필요.",
        responseKeys: Object.keys(data).slice(0, 15),
      });
    }

    // 완료 로그: parsed result URL + Scene Extension 진단
    const checkTotalMs = Date.now() - tCheckStart;
    const fetchMs = Date.now() - tFetchStart;
    const primaryRawUri = variants[0]?.rawVideoUri || "";
    const primaryUriType = primaryRawUri.startsWith("gs://") ? "GCS"
      : primaryRawUri.startsWith("https://") ? "HTTPS"
      : primaryRawUri === "" ? "EMPTY"
      : "OTHER";
    const sceneExtensionReady = primaryUriType === "GCS" || primaryUriType === "HTTPS";

    console.log("[check-video] Veo COMPLETED", {
      cutNumber,
      variantCount: variants.length,
      kinds: variants.map(v => v.resultKind),
      primaryRawUri: primaryRawUri ? primaryRawUri.slice(0, 80) : "(empty)",
      primaryUriType,
      sceneExtensionReady: sceneExtensionReady ? "✓ 다음 컷 SCENE_EXTENSION 가능" : "✗ 다음 컷 SCENE_EXTENSION 불가",
      allRawUris: variants.map(v => v.rawVideoUri ? `${v.rawVideoUri.slice(0, 60)}` : "(empty)"),
    });
    if (!sceneExtensionReady) {
      console.warn("[check-video] ⚠️ rawVideoUri 없음 — 원인 진단:", {
        cutNumber,
        extractedResultKinds: videoResults.map(r => r.kind),
        responseStructure: structure,
        hint: "Veo가 GCS URI 대신 base64로 응답함. 가능한 원인: (1) API Key 인증 사용 (Service Account 아님), (2) global 엔드포인트 사용, (3) Veo API 응답 구조 변경",
      });
    }
    console.log("[check-video] ⏱ timing", { checkTotalMs, fetchMs, cutNumber });

    return Response.json({
      status: "COMPLETED",
      videoUri: variants[0].videoUri,
      rawVideoUri: variants[0].rawVideoUri,
      seed: variants[0].seed,
      variants,
      sampleCount: variants.length,
      // 진단용: Scene Extension 가능 여부
      _diag: {
        sceneExtensionReady,
        primaryUriType,
        extractedKinds: videoResults.map(r => r.kind),
      },
    });
  } catch (error) {
    const errType = error instanceof Error ? error.constructor.name : typeof error;
    const errMsg = error instanceof Error ? error.message : String(error);
    let errStack = "";
    try { errStack = (error instanceof Error && error.stack) ? error.stack.slice(0, 1500) : ""; } catch { /* ignore */ }

    // 스택 오버플로 감지: 재시도해도 반복되므로 noRetry 플래그로 프론트에 전달
    const isStackOverflow = errMsg.includes("call stack") || errMsg.includes("stack size") || errType === "RangeError";

    console.error(`[check-video] UNHANDLED ${errType}: ${errMsg}${isStackOverflow ? " [STACK_OVERFLOW — noRetry]" : ""}\nstack: ${errStack}`);

    return Response.json({
      status: "FAILED",
      error: isStackOverflow
        ? `check-video 내부 로직 오류 (스택 오버플로). 자동 재시도를 건너뜁니다.`
        : `check-video 내부 오류: ${errMsg}`,
      errorType: errType,
      noRetry: isStackOverflow, // 프론트에서 auto-retry 차단용
    });
  }
};
