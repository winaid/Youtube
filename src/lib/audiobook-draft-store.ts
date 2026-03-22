/**
 * audiobook-draft-store.ts — 오디오북 프로젝트 드래프트 저장/복원
 *
 * 기존 draft-store.ts(영상 스튜디오)와 별도 IndexedDB 스토어.
 * 씬 데이터, 설정, 생성된 이미지/오디오 base64를 저장.
 */

import type { AudiobookSceneInput, AudiobookVoice } from "@/hooks/useAudiobookPipeline";

// ─── Schema ───

export interface AudiobookDraft {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 씬 데이터 */
  scenes: AudiobookSceneInput[];
  /** 설정 */
  config: {
    voice: AudiobookVoice;
    speed: "slow" | "natural" | "fast";
    imageStyle: string;
    resolution: "landscape" | "portrait";
    fadeDuration: number;
    kenBurns: boolean;
    bgmVolume: number;
  };
  /** 생성된 이미지 base64 (씬 인덱스별) — 용량 큼, 선택 저장 */
  generatedImages?: { index: number; base64: string; mimeType: string }[];
  /** 씬 수 (리스트 표시용) */
  sceneCount: number;
}

// ─── IndexedDB ───

const DB_NAME = "audiobook-studio-v1";
const DB_VERSION = 1;
const STORE_NAME = "audiobook-drafts";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

// ─── CRUD ───

export function genAudiobookDraftId(): string {
  return `ab-draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function listAudiobookDrafts(): Promise<AudiobookDraft[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const idx = txStore(db, "readonly").index("updatedAt");
      const req = idx.openCursor(null, "prev");
      const results: AudiobookDraft[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          results.push(cursor.value as AudiobookDraft);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
}

export async function saveAudiobookDraft(draft: AudiobookDraft): Promise<boolean> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = txStore(db, "readwrite").put(draft);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch { return false; }
}

export async function deleteAudiobookDraft(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = txStore(db, "readwrite").delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch { /* ignore */ }
}

export function buildAudiobookDraft(
  scenes: AudiobookSceneInput[],
  config: AudiobookDraft["config"],
  title: string,
  existingId?: string,
): AudiobookDraft {
  const now = Date.now();
  return {
    id: existingId || genAudiobookDraftId(),
    title: title || "오디오북 드래프트",
    createdAt: now,
    updatedAt: now,
    scenes,
    config,
    sceneCount: scenes.length,
  };
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "방금 전";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(timestamp).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}
