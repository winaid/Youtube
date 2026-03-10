/**
 * video-history.ts — 영상 생성 히스토리 (localStorage 기반)
 *
 * Vertex Veo는 storageUri로 GCS에 결과를 저장하지만,
 * 우리 앱에서 생성 이력을 관리하려면 자체 저장이 필요.
 * DB 없이 localStorage로 우선 구현, 향후 D1/Supabase로 마이그레이션 가능.
 */

export interface VideoRecord {
  id: string;
  operationName: string;
  engine: "veo" | "kling";
  gcsUri: string;            // rawVideoUri (gs:// 또는 https://)
  proxyUri: string;          // 재생 가능한 프록시 URI
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
