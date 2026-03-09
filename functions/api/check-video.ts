import { GeminiEnv, fetchWithAuth } from "./_gemini-keys";

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

function deepSearchVideoData(raw: Record<string, unknown>, results: VideoResult[]): void {
  const jsonStr = JSON.stringify(raw);

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

// === operationName에서 모델명 / 리전 추출 ===

function extractModel(operationName: string): string | null {
  const m = operationName.match(/models\/([^/]+)\/operations\//);
  return m ? m[1] : null;
}

function extractLocation(operationName: string): string {
  const m = operationName.match(/locations\/([^/]+)\//);
  const loc = m ? m[1] : "us-central1";
  // fetchPredictOperation은 리전 엔드포인트만 지원 — global 불가
  return loc === "global" ? "us-central1" : loc;
}

function buildFetchPredictUrl(env: GeminiEnv, model: string, location: string): string {
  let projectId = "unknown";
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { project_id: string };
      projectId = sa.project_id;
    } catch { /* ignore */ }
  }
  // Veo fetchPredictOperation은 반드시 리전 엔드포인트 사용
  // e.g. https://us-central1-aiplatform.googleapis.com/v1/projects/.../models/...:fetchPredictOperation
  const host = location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`;
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
    if (!model) {
      console.error("[check-video] Cannot extract model from operationName:", operationName);
      return Response.json({ error: "Could not extract model from operationName", operationName }, { status: 400 });
    }

    const location = extractLocation(operationName);
    const url = buildFetchPredictUrl(context.env, model, location);
    console.log(`[check-video] model=${model} location=${location} url=${url}`);

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
      if (err instanceof DOMException && err.name === "AbortError") {
        return Response.json({ status: "RUNNING" });
      }
      throw err;
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
    const structure = logResponseStructure(data);
    console.log("Veo poll response structure:", JSON.stringify(structure));
    console.log("Veo poll response raw:", JSON.stringify(data).slice(0, 3000));

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
      console.error("No video result found.", JSON.stringify(structure), "raw:", JSON.stringify(data).slice(0, 2000));
      return Response.json({
        status: "FAILED",
        error: `영상 결과를 찾을 수 없습니다. response 구조: ${JSON.stringify(structure.deepKeys)}`,
        structure,
        raw: data,
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
            rawVideoUri: dataUri,
            seed: result.seed,
            resultKind: "base64",
          });
          break;
        }
      }
    }

    if (variants.length === 0) {
      console.error("Video results found but no playable variants.", JSON.stringify(videoResults.map(r => ({ kind: r.kind }))));
      return Response.json({
        status: "FAILED",
        error: "비디오 결과는 있으나 재생 가능한 형태가 아닙니다",
        resultKinds: videoResults.map(r => r.kind),
        structure,
        raw: data,
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
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : "";
    console.error("[check-video] Unhandled error:", errMsg, "\nstack:", errStack);
    return Response.json(
      { error: `Failed to check video: ${errMsg}` },
      { status: 500 }
    );
  }
};
