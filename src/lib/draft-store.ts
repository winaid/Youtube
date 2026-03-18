/**
 * draft-store.ts — IndexedDB 기반 프로젝트 드래프트 저장/복원
 *
 * Internal Owner-Only V0.9: 로그인 없이 로컬 디바이스에서
 * 프로젝트를 저장하고 다시 이어서 작업할 수 있는 최소 persistence.
 *
 * Schema version 필드로 향후 auth 기반 cloud sync migration 대비.
 */

import type { PromptInput, PromptOutput } from "@/types";

// ─── Schema ───

export const DRAFT_SCHEMA_VERSION = 1;

export interface DraftProject {
  /** Unique ID (draft-{timestamp}-{random}) */
  id: string;
  /** Schema version for future migration */
  schemaVersion: number;
  /** User-given title (default: projectTitle from PromptOutput) */
  title: string;
  /** Timestamps */
  createdAt: number;
  updatedAt: number;
  /** Input state snapshot */
  input: PromptInput;
  /** Generated output (nullable — draft can be saved before generation) */
  output: PromptOutput | null;
  /** Generation metadata for debug panel */
  generationMeta?: DraftGenerationMeta;
  /** Thumbnail: first cut's imagePrompt or sceneDescription (for list UI) */
  thumbnail?: string;
  /** Cut count at save time (for list UI without parsing full output) */
  cutCount?: number;
}

export interface DraftGenerationMeta {
  totalDurationSec?: number;
  targetCuts?: number;
  reconciledSecPerCut?: number;
  narrativeFunction?: string;
  temporalBeats?: string[];
  shotCount?: number;
  shortformRhythm?: {
    band: string;
    minCuts: number;
    is13to15Special: boolean;
  };
  usedFallback?: boolean;
  degraded?: boolean;
  degradedReason?: string;
  directorPaceDownWeight?: boolean;
  densityPolicy?: string;
  sequenceValidationErrors?: number;
  sequenceValidationWarnings?: number;
}

// ─── IndexedDB Wrapper ───

const DB_NAME = "creator-studio-v09";
const DB_VERSION = 1;
const STORE_NAME = "drafts";

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

// ─── CRUD Operations ───

export function genDraftId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** List all drafts, newest first */
export async function listDrafts(): Promise<DraftProject[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const store = txStore(db, "readonly");
      const idx = store.index("updatedAt");
      const req = idx.openCursor(null, "prev");
      const results: DraftProject[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          results.push(cursor.value as DraftProject);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Get single draft by ID */
export async function getDraft(id: string): Promise<DraftProject | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = txStore(db, "readonly").get(id);
      req.onsuccess = () => resolve((req.result as DraftProject) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Save (create or update) a draft */
export async function saveDraft(draft: DraftProject): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = txStore(db, "readwrite").put(draft);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // fallback: localStorage
    try {
      const key = `draft-fallback-${draft.id}`;
      localStorage.setItem(key, JSON.stringify(draft));
    } catch { /* ignore */ }
  }
}

/** Delete a draft */
export async function deleteDraft(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = txStore(db, "readwrite").delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch { /* ignore */ }
}

// ─── Convenience Helpers ───

/** Build a DraftProject from current workspace state */
export function buildDraft(opts: {
  id?: string;
  title?: string;
  input: PromptInput;
  output: PromptOutput | null;
  generationMeta?: DraftGenerationMeta;
}): DraftProject {
  const now = Date.now();
  const title =
    opts.title ||
    opts.output?.projectTitle ||
    opts.input.storyText.slice(0, 40) ||
    "Untitled Draft";
  return {
    id: opts.id || genDraftId(),
    schemaVersion: DRAFT_SCHEMA_VERSION,
    title,
    createdAt: now,
    updatedAt: now,
    input: opts.input,
    output: opts.output,
    generationMeta: opts.generationMeta,
    thumbnail: opts.output?.cuts?.[0]?.sceneDescription?.slice(0, 80),
    cutCount: opts.output?.totalCuts,
  };
}

/** Export draft as downloadable JSON */
export function exportDraftJSON(draft: DraftProject): string {
  return JSON.stringify(draft, null, 2);
}

/** Parse imported JSON into DraftProject (with validation) */
export function importDraftJSON(json: string): DraftProject | null {
  try {
    const parsed = JSON.parse(json);
    if (!parsed.id || !parsed.input || parsed.schemaVersion === undefined) {
      return null;
    }
    // Assign new ID + timestamps on import
    return {
      ...parsed,
      id: genDraftId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}
