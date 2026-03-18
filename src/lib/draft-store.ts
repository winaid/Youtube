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
  /** Director requested by user */
  directorRequested?: string;
  /** Director pace after reconciliation */
  directorPaceResult?: string;
  /** Reason director style was weakened */
  directorWeakenReason?: string;
  /** Whether outline-only path was used */
  outlineOnly?: boolean;
  /** Whether generic split fallback was used */
  genericSplitFallback?: boolean;
  /** Provider error message if any */
  providerError?: string;
  /** Rationale messages for quick judgment */
  rationale?: string[];
}

// ─── Save Status ───

export type SaveStatus = "idle" | "saving" | "saved" | "error";

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

// ─── Schema Migration ───

/** Migrate a draft to the current schema version */
export function migrateDraft(draft: DraftProject): DraftProject {
  // v0 → v1: no changes needed, just stamp version
  if (!draft.schemaVersion || draft.schemaVersion < 1) {
    draft.schemaVersion = 1;
  }
  // Future migrations go here:
  // if (draft.schemaVersion < 2) { ... draft.schemaVersion = 2; }
  return draft;
}

/** Validate a draft has minimum required structure */
export function validateDraft(draft: unknown): draft is DraftProject {
  if (!draft || typeof draft !== "object") return false;
  const d = draft as Record<string, unknown>;
  if (typeof d.id !== "string" || !d.id) return false;
  if (!d.input || typeof d.input !== "object") return false;
  const input = d.input as Record<string, unknown>;
  if (typeof input.storyText !== "string") return false;
  return true;
}

// ─── CRUD Operations ───

export function genDraftId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** List all drafts, newest first. Filters out corrupted entries. */
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
          const val = cursor.value;
          if (validateDraft(val)) {
            results.push(migrateDraft(val as DraftProject));
          }
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
      req.onsuccess = () => {
        const val = req.result;
        if (val && validateDraft(val)) {
          resolve(migrateDraft(val as DraftProject));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Save (create or update) a draft. Returns success boolean. */
export async function saveDraft(draft: DraftProject): Promise<boolean> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = txStore(db, "readwrite").put(draft);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch {
    // fallback: localStorage
    try {
      const key = `draft-fallback-${draft.id}`;
      localStorage.setItem(key, JSON.stringify(draft));
      return true;
    } catch {
      return false;
    }
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

/** Check if a draft is stale (older than given days) */
export function isDraftStale(draft: DraftProject, staleDays: number = 30): boolean {
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  return Date.now() - draft.updatedAt > staleMs;
}

/** Format relative time for display */
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
