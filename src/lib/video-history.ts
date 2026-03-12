/**
 * video-history.ts — 영상 생성 히스토리 (localStorage 기반)
 *
 * 영상 생성 이력 관리 (localStorage 기반).
 * 향후 D1/Supabase로 마이그레이션 가능.
 */

/** Asset 생명 주기 상태 (VideoClip.assetStatus와 동기) */
export type VideoAssetStatus =
  | "GENERATED"
  | "ASSET_STORED_INTERNAL"
  | "ASSET_STORED_PUBLIC"
  | "SCENE_EXTENSION_READY"
  | "VISIBLE_IN_LIBRARY";

export interface VideoRecord {
  id: string;
  operationName: string;
  engine: "veo" | "kling";
  gcsUri: string;            // rawVideoUri (gs:// 또는 https://)
  proxyUri: string;          // 재생 가능한 프록시 URI
  canonicalVideoUri?: string; // 안정적 URI (Scene Extension용)
  /** @deprecated legacy 호환용. source of truth는 structuredSequence. */
  prompt: string;
  mode: "generate" | "extend";
  durationSec: number;
  cutNumber: number;
  sourceCutId?: number;      // extend 시 이전 컷 번호
  projectTitle?: string;
  directorName?: string;
  animationMode?: string;
  seed?: string;
  status: "completed" | "failed";
  /** 자산 생명 주기 상태 — 생성 상태(status)와 분리 추적 */
  assetStatus?: VideoAssetStatus;
  /**
   * JSON-first source of truth — 생성 시점의 구조화된 시퀀스 문서.
   * 저장 우선순위: structuredSequence > prompt (legacy fallback)
   */
  structuredSequence?: Record<string, unknown>;
  createdAt: number;
}

const STORAGE_KEY = "video-history";
const MAX_RECORDS = 200;

export function getVideoHistory(): VideoRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveVideoRecord(record: Omit<VideoRecord, "id" | "createdAt">): VideoRecord {
  const records = getVideoHistory();
  const newRecord: VideoRecord = {
    ...record,
    id: `vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };

  records.unshift(newRecord); // 최신순

  // 최대 개수 제한
  if (records.length > MAX_RECORDS) {
    records.splice(MAX_RECORDS);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // localStorage 용량 초과 시 오래된 기록 삭제 후 재시도
    records.splice(Math.floor(MAX_RECORDS / 2));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch { /* give up */ }
  }

  // 같은 탭 내 MyVideosPanel 즉시 갱신
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("video-history-updated"));
  }

  return newRecord;
}

export function deleteVideoRecord(id: string): void {
  const records = getVideoHistory().filter((r) => r.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch { /* ignore */ }
}

export function clearVideoHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

/**
 * VideoRecord의 asset status를 결정.
 * gcsUri, proxyUri, canonicalVideoUri 유무에 따라 자산 상태 계산.
 */
export function computeAssetStatus(record: VideoRecord): VideoAssetStatus {
  if (record.status === "failed") return "GENERATED"; // 실패 시 최초 상태 고정

  // VISIBLE_IN_LIBRARY: proxyUri 있고 canonicalVideoUri도 있을 때 라이브러리 표시 가능
  if (record.canonicalVideoUri && record.proxyUri) {
    return "VISIBLE_IN_LIBRARY";
  }
  if (record.canonicalVideoUri) {
    return "SCENE_EXTENSION_READY";
  }
  if (record.proxyUri) {
    return "ASSET_STORED_PUBLIC";
  }
  if (record.gcsUri) {
    return "ASSET_STORED_INTERNAL";
  }
  return "GENERATED";
}

/**
 * Scene Extension 가능 여부 — canonicalVideoUri(gs:// 또는 https://)가 있어야 함.
 * SCENE_EXTENSION_READY 또는 VISIBLE_IN_LIBRARY 상태에서만 true.
 */
export function canExtendScene(record: VideoRecord): boolean {
  if (record.status === "failed") return false;
  return !!record.canonicalVideoUri &&
    (record.canonicalVideoUri.startsWith("gs://") || record.canonicalVideoUri.startsWith("https://"));
}

/**
 * 라이브러리 표시 가능 여부 — 재생 가능한 proxyUri + 안정적 canonicalVideoUri 모두 필요.
 */
export function visibleInLibrary(record: VideoRecord): boolean {
  if (record.status === "failed") return false;
  return !!record.proxyUri && !!record.canonicalVideoUri;
}

/**
 * Scene Extension readiness 판단.
 * - proxyUri만 있고 canonicalVideoUri 없음 → VISIBLE_IN_LIBRARY true, SCENE_EXTENSION_READY false
 * - canonicalVideoUri (gs:// 또는 https://) 있음 → SCENE_EXTENSION_READY true
 *
 * grep: sceneExtensionReady
 */
export function sceneExtensionReady(record: VideoRecord): {
  ready: boolean;
  reason: string;
  hasProxy: boolean;
  hasCanonical: boolean;
} {
  if (record.status === "failed") {
    return { ready: false, reason: "generation failed", hasProxy: false, hasCanonical: false };
  }

  const hasProxy = !!record.proxyUri;
  const hasCanonical = !!record.canonicalVideoUri &&
    (record.canonicalVideoUri.startsWith("gs://") || record.canonicalVideoUri.startsWith("https://"));

  if (hasCanonical) {
    return { ready: true, reason: "canonical URI available", hasProxy, hasCanonical };
  }
  if (hasProxy) {
    return { ready: false, reason: "proxyUri only — no canonical URI for Scene Extension", hasProxy, hasCanonical: false };
  }
  if (record.gcsUri) {
    return { ready: false, reason: "internal GCS URI only — not publicly accessible", hasProxy: false, hasCanonical: false };
  }
  return { ready: false, reason: "no video URI available", hasProxy: false, hasCanonical: false };
}

/**
 * 기존 레코드의 asset status를 업데이트.
 * 업로드 완료/Scene Extension 가능 등 상태 변경 시 호출.
 */
export function updateVideoRecordAssetStatus(
  id: string,
  assetStatus: VideoAssetStatus,
  canonicalVideoUri?: string,
): void {
  const records = getVideoHistory();
  const record = records.find((r) => r.id === id);
  if (!record) return;

  record.assetStatus = assetStatus;
  if (canonicalVideoUri) record.canonicalVideoUri = canonicalVideoUri;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch { /* ignore */ }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("video-history-updated"));
  }
}
