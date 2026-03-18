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
  /** Owner session notes — lightweight test-session annotations */
  ownerNotes?: OwnerSessionNote;
}

// ─── Owner Session Notes ───

/** Failure taxonomy — standard failure types for quick classification */
export type FailureTag =
  | "too-slow"
  | "too-sparse"
  | "too-generic"
  | "style-too-weak"
  | "style-overrides-rhythm"
  | "fallback-degraded"
  | "save-reopen-confusion"
  | "ok";

export const FAILURE_TAG_LABELS: Record<FailureTag, string> = {
  "too-slow": "느림",
  "too-sparse": "빈약",
  "too-generic": "뻔함",
  "style-too-weak": "스타일약",
  "style-overrides-rhythm": "스타일>리듬",
  "fallback-degraded": "폴백열화",
  "save-reopen-confusion": "저장혼란",
  "ok": "OK",
};

export interface OwnerSessionNote {
  /** Scenario label (auto-filled from title or sample id) */
  scenario: string;
  /** Quick first impression after viewing result */
  firstImpression?: string;
  /** Rhythm verdict — free-form or tag */
  rhythmVerdict?: string;
  /** Style verdict — free-form or tag */
  styleVerdict?: string;
  /** Failure tag(s) for quick taxonomy */
  failureTags: FailureTag[];
  /** Whether fallback was used at generation time */
  fallbackUsed: boolean;
  /** Next fix guess — what should be changed */
  nextFixGuess?: string;
  /** Timestamp of the note */
  notedAt: number;
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
  /** Whether fast path was used (step2/3 skipped) */
  fastPathUsed?: boolean;
  /** Total latency in ms */
  totalLatencyMs?: number;
  /** Step1 latency in ms */
  step1LatencyMs?: number;
  /** Step23 latency in ms */
  step23LatencyMs?: number;
  /** Total shot count */
  totalShotCount?: number;
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

// ─── Session Log (localStorage) ───

const SESSION_LOG_KEY = "owner-session-log-v1";
const SESSION_LOG_MAX = 100;

export interface SessionLogEntry {
  draftId: string;
  scenario: string;
  failureTags: FailureTag[];
  firstImpression?: string;
  nextFixGuess?: string;
  fallbackUsed: boolean;
  timestamp: number;
  /** Engine context — captured at note time for cross-referencing */
  durationBand?: string;
  directorRequested?: string;
  degraded?: boolean;
  directorPaceDownWeighted?: boolean;
  outlineOnly?: boolean;
  totalDurationSec?: number;
  /** Fast path tracking */
  fastPathUsed?: boolean;
  totalLatencyMs?: number;
  totalShotCount?: number;
}

/** Load session log from localStorage */
export function loadSessionLog(): SessionLogEntry[] {
  try {
    const raw = localStorage.getItem(SESSION_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** Append entry to session log */
export function appendSessionLog(entry: SessionLogEntry): void {
  try {
    const log = loadSessionLog();
    log.unshift(entry);
    if (log.length > SESSION_LOG_MAX) log.length = SESSION_LOG_MAX;
    localStorage.setItem(SESSION_LOG_KEY, JSON.stringify(log));
  } catch { /* ignore */ }
}

/** Clear session log */
export function clearSessionLog(): void {
  try { localStorage.removeItem(SESSION_LOG_KEY); } catch { /* ignore */ }
}

/** Summary stats from session log */
export function sessionLogStats(log: SessionLogEntry[]): Record<FailureTag, number> {
  const counts: Record<string, number> = {};
  for (const tag of Object.keys(FAILURE_TAG_LABELS)) counts[tag] = 0;
  for (const entry of log) {
    for (const tag of entry.failureTags) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return counts as Record<FailureTag, number>;
}

// ─── Session Log Analysis ───

/** Failure interpretation guide — maps tag to suspect and action */
export const FAILURE_INTERPRETATIONS: Record<FailureTag, { suspect: string; action: string }> = {
  "too-slow": {
    suspect: "secPerCut이 너무 길거나, shortform band 정책이 적용 안 됨",
    action: "reconcileShortformPlan의 secPerCut 상한 확인, duration band 정책 점검",
  },
  "too-sparse": {
    suspect: "targetCuts가 낮거나, multiShot 밀도 부족",
    action: "resolveCutCount의 densityMinimum 확인, densifyCuts 로직 점검",
  },
  "too-generic": {
    suspect: "감독 persona가 프롬프트에 반영 안 되거나, 스토리 분석이 얕음",
    action: "step1Outlines의 directorPersona 주입 확인, editorialPlanningBlock 점검",
  },
  "style-too-weak": {
    suspect: "감독 signatureTechniques가 누락되거나, buildDirectorEngine에서 톤이 약함",
    action: "directors.ts의 signatureTechniques 보강, step2/3 directorEngine 가중치 점검",
  },
  "style-overrides-rhythm": {
    suspect: "감독 pace가 shortform 리듬보다 우선 적용됨 (down-weight 실패)",
    action: "secPerCut reconciliation 로직 확인, directorPaceDownWeighted가 true인지 점검",
  },
  "fallback-degraded": {
    suspect: "Provider 에러/timeout으로 deterministic fallback 또는 outline-only 경로 사용",
    action: "API 키 유효성, 모델 가용성, timeout 설정 확인",
  },
  "save-reopen-confusion": {
    suspect: "Draft 저장/복원 시 meta 또는 ownerNotes 누락",
    action: "buildDraft에서 generationMeta/ownerNotes 포함 확인, migrateDraft 호환성 점검",
  },
  "ok": {
    suspect: "문제 없음",
    action: "성공 패턴 유지",
  },
};

/** Cross-reference: failure tags grouped by duration band */
export function tagsByDurationBand(log: SessionLogEntry[]): Record<string, Record<FailureTag, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const entry of log) {
    const band = entry.durationBand || "unknown";
    if (!result[band]) {
      result[band] = {};
      for (const tag of Object.keys(FAILURE_TAG_LABELS)) result[band][tag] = 0;
    }
    for (const tag of entry.failureTags) {
      result[band][tag] = (result[band][tag] || 0) + 1;
    }
  }
  return result as Record<string, Record<FailureTag, number>>;
}

/** Cross-reference: failure tags grouped by director */
export function tagsByDirector(log: SessionLogEntry[]): Record<string, Record<FailureTag, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const entry of log) {
    const dir = entry.directorRequested || "unknown";
    if (!result[dir]) {
      result[dir] = {};
      for (const tag of Object.keys(FAILURE_TAG_LABELS)) result[dir][tag] = 0;
    }
    for (const tag of entry.failureTags) {
      result[dir][tag] = (result[dir][tag] || 0) + 1;
    }
  }
  return result as Record<string, Record<FailureTag, number>>;
}

/** Owner summary: top issues + patterns */
export interface OwnerSessionSummary {
  totalSessions: number;
  okCount: number;
  failCount: number;
  /** Most frequent failure tag (excluding 'ok') */
  topFailure: { tag: FailureTag; count: number } | null;
  /** Second most frequent failure tag */
  secondFailure: { tag: FailureTag; count: number } | null;
  /** Duration band with most failures */
  worstBand: { band: string; failCount: number } | null;
  /** Director with most style issues */
  worstDirectorStyle: { director: string; count: number } | null;
  /** Fallback rate */
  fallbackRate: number;
  /** Director down-weight rate */
  downWeightRate: number;
  /** Save/reopen confusion count */
  saveConfusionCount: number;
  /** Shortform critical band (13-15s) failure count */
  criticalBandFailCount: number;
  /** Recent nextFixGuess entries (latest 5) */
  recentFixGuesses: string[];
}

export function buildOwnerSummary(log: SessionLogEntry[]): OwnerSessionSummary {
  if (log.length === 0) {
    return {
      totalSessions: 0, okCount: 0, failCount: 0,
      topFailure: null, secondFailure: null, worstBand: null,
      worstDirectorStyle: null, fallbackRate: 0, downWeightRate: 0,
      saveConfusionCount: 0, criticalBandFailCount: 0, recentFixGuesses: [],
    };
  }

  const stats = sessionLogStats(log);
  const okCount = stats["ok"];
  const failCount = log.filter(e => !e.failureTags.includes("ok") && e.failureTags.length > 0).length;

  // Top failures (excluding ok)
  const failurePairs = (Object.entries(stats) as [FailureTag, number][])
    .filter(([tag]) => tag !== "ok")
    .sort(([, a], [, b]) => b - a);
  const topFailure = failurePairs[0]?.[1] > 0 ? { tag: failurePairs[0][0], count: failurePairs[0][1] } : null;
  const secondFailure = failurePairs[1]?.[1] > 0 ? { tag: failurePairs[1][0], count: failurePairs[1][1] } : null;

  // Worst duration band
  const bandStats = tagsByDurationBand(log);
  let worstBand: { band: string; failCount: number } | null = null;
  for (const [band, tagCounts] of Object.entries(bandStats)) {
    const bandFails = Object.entries(tagCounts)
      .filter(([t]) => t !== "ok")
      .reduce((s, [, c]) => s + c, 0);
    if (bandFails > 0 && (!worstBand || bandFails > worstBand.failCount)) {
      worstBand = { band, failCount: bandFails };
    }
  }

  // Director with most style issues
  const dirStats = tagsByDirector(log);
  let worstDirectorStyle: { director: string; count: number } | null = null;
  for (const [dir, tagCounts] of Object.entries(dirStats)) {
    const styleIssues = (tagCounts["style-too-weak"] || 0) + (tagCounts["style-overrides-rhythm"] || 0);
    if (styleIssues > 0 && (!worstDirectorStyle || styleIssues > worstDirectorStyle.count)) {
      worstDirectorStyle = { director: dir, count: styleIssues };
    }
  }

  // Rates
  const fallbackRate = log.filter(e => e.fallbackUsed).length / log.length;
  const downWeightRate = log.filter(e => e.directorPaceDownWeighted).length / log.length;

  // Save confusion count
  const saveConfusionCount = stats["save-reopen-confusion"];

  // Critical band (13-15s) failures
  const criticalEntries = log.filter(e => e.durationBand === "shortform-critical");
  const criticalBandFailCount = criticalEntries.filter(e =>
    e.failureTags.some(t => t !== "ok")
  ).length;

  // Recent fix guesses
  const recentFixGuesses = log
    .filter(e => e.nextFixGuess)
    .slice(0, 5)
    .map(e => e.nextFixGuess!);

  return {
    totalSessions: log.length,
    okCount,
    failCount,
    topFailure,
    secondFailure,
    worstBand,
    worstDirectorStyle,
    fallbackRate,
    downWeightRate,
    saveConfusionCount,
    criticalBandFailCount,
    recentFixGuesses,
  };
}

/** Generate prioritized action items from summary */
export function deriveActionItems(summary: OwnerSessionSummary): string[] {
  const items: string[] = [];

  if (summary.totalSessions === 0) return ["세션 데이터가 없습니다. 먼저 10-20개 시나리오를 돌려주세요."];

  if (summary.topFailure) {
    const interp = FAILURE_INTERPRETATIONS[summary.topFailure.tag];
    items.push(`[P0] "${FAILURE_TAG_LABELS[summary.topFailure.tag]}" ${summary.topFailure.count}회 — ${interp.action}`);
  }

  if (summary.secondFailure && summary.secondFailure.count >= 2) {
    const interp = FAILURE_INTERPRETATIONS[summary.secondFailure.tag];
    items.push(`[P1] "${FAILURE_TAG_LABELS[summary.secondFailure.tag]}" ${summary.secondFailure.count}회 — ${interp.action}`);
  }

  if (summary.criticalBandFailCount > 0) {
    items.push(`[P0] 13-15초 critical band에서 ${summary.criticalBandFailCount}회 실패 — shortform 리듬 정책 최우선 점검`);
  }

  if (summary.worstDirectorStyle && summary.worstDirectorStyle.count >= 2) {
    items.push(`[P1] ${summary.worstDirectorStyle.director} 감독에서 스타일 문제 ${summary.worstDirectorStyle.count}회 — persona/techniques 보강`);
  }

  if (summary.fallbackRate > 0.2) {
    items.push(`[P0] Fallback 비율 ${(summary.fallbackRate * 100).toFixed(0)}% — API 안정성/키 점검 시급`);
  }

  if (summary.downWeightRate > 0.5) {
    items.push(`[P1] 감독 pace down-weight 비율 ${(summary.downWeightRate * 100).toFixed(0)}% — 감독 pace 설정이 현실적인지 확인`);
  }

  if (summary.saveConfusionCount > 0) {
    items.push(`[P2] 저장/복원 혼란 ${summary.saveConfusionCount}회 — draft persistence 점검`);
  }

  if (summary.okCount > 0 && summary.failCount === 0) {
    items.push("모든 테스트 통과 — 다음 단계로 이동 가능");
  }

  if (items.length === 0) {
    items.push("뚜렷한 패턴 없음 — 더 많은 시나리오로 테스트 필요");
  }

  return items;
}

/** Format relative time for display */
// ─── Recommendation Log (localStorage) ───

const RECOMMEND_LOG_KEY = "owner-recommend-log-v1";
const RECOMMEND_LOG_MAX = 50;

export type RecommendOutcome = "success" | "empty" | "error" | "cache-hit";

export interface RecommendLogEntry {
  timestamp: number;
  /** First 80 chars of story text for context */
  storySnippet: string;
  storyLength: number;
  outcome: RecommendOutcome;
  /** Error message if outcome=error */
  errorMessage?: string;
  /** Error classification for pattern analysis */
  errorCategory?: "network" | "api-key" | "rate-limit" | "parse-error" | "timeout" | "unknown";
  localMatchCount: number;
  webSuggestionCount: number;
  /** IDs of recommended local directors */
  localMatchIds: string[];
  /** IDs of recommended web directors */
  webSuggestionIds: string[];
  /** Latency in ms */
  latencyMs: number;
  /** Model used (flash/pro/unknown) */
  modelUsed?: string;
  /** Active region filter at time of request */
  activeRegion?: string;
  /** Number of directors sent to API */
  directorPoolSize: number;
}

export function loadRecommendLog(): RecommendLogEntry[] {
  try {
    const raw = localStorage.getItem(RECOMMEND_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function appendRecommendLog(entry: RecommendLogEntry): void {
  try {
    const log = loadRecommendLog();
    log.unshift(entry);
    if (log.length > RECOMMEND_LOG_MAX) log.length = RECOMMEND_LOG_MAX;
    localStorage.setItem(RECOMMEND_LOG_KEY, JSON.stringify(log));
  } catch { /* ignore */ }
}

export function clearRecommendLog(): void {
  try { localStorage.removeItem(RECOMMEND_LOG_KEY); } catch { /* ignore */ }
}

/** Classify error message into category */
export function classifyRecommendError(msg: string): RecommendLogEntry["errorCategory"] {
  const lower = msg.toLowerCase();
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("failed to fetch")) return "network";
  if (lower.includes("api key") || lower.includes("api_key") || lower.includes("401") || lower.includes("403")) return "api-key";
  if (lower.includes("rate") || lower.includes("429") || lower.includes("quota")) return "rate-limit";
  if (lower.includes("json") || lower.includes("parse")) return "parse-error";
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("504")) return "timeout";
  return "unknown";
}

/** Summary of recommendation log for owner review */
export interface RecommendLogSummary {
  total: number;
  successCount: number;
  emptyCount: number;
  errorCount: number;
  cacheHitCount: number;
  /** Average latency for non-cache calls (ms) */
  avgLatencyMs: number;
  /** Error breakdown by category */
  errorCategories: Record<string, number>;
  /** Most frequently recommended director ids (top 5) */
  topDirectorIds: { id: string; count: number }[];
  /** Fraction of calls that returned 0 results (excluding errors & cache) */
  emptyRate: number;
  /** Average match count per successful call */
  avgMatchCount: number;
}

export function buildRecommendSummary(log: RecommendLogEntry[]): RecommendLogSummary {
  if (log.length === 0) {
    return {
      total: 0, successCount: 0, emptyCount: 0, errorCount: 0, cacheHitCount: 0,
      avgLatencyMs: 0, errorCategories: {}, topDirectorIds: [], emptyRate: 0, avgMatchCount: 0,
    };
  }

  const successCount = log.filter(e => e.outcome === "success").length;
  const emptyCount = log.filter(e => e.outcome === "empty").length;
  const errorCount = log.filter(e => e.outcome === "error").length;
  const cacheHitCount = log.filter(e => e.outcome === "cache-hit").length;

  // Latency for non-cache
  const nonCacheEntries = log.filter(e => e.outcome !== "cache-hit" && e.latencyMs > 0);
  const avgLatencyMs = nonCacheEntries.length > 0
    ? Math.round(nonCacheEntries.reduce((s, e) => s + e.latencyMs, 0) / nonCacheEntries.length)
    : 0;

  // Error categories
  const errorCategories: Record<string, number> = {};
  for (const e of log.filter(x => x.outcome === "error" && x.errorCategory)) {
    errorCategories[e.errorCategory!] = (errorCategories[e.errorCategory!] || 0) + 1;
  }

  // Top director ids
  const dirCounts: Record<string, number> = {};
  for (const e of log) {
    for (const id of [...e.localMatchIds, ...e.webSuggestionIds]) {
      dirCounts[id] = (dirCounts[id] || 0) + 1;
    }
  }
  const topDirectorIds = Object.entries(dirCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([id, count]) => ({ id, count }));

  // Empty rate (excluding errors and cache)
  const apiCalls = successCount + emptyCount;
  const emptyRate = apiCalls > 0 ? emptyCount / apiCalls : 0;

  // Avg match count per success
  const successEntries = log.filter(e => e.outcome === "success");
  const avgMatchCount = successEntries.length > 0
    ? +(successEntries.reduce((s, e) => s + e.localMatchCount + e.webSuggestionCount, 0) / successEntries.length).toFixed(1)
    : 0;

  return {
    total: log.length, successCount, emptyCount, errorCount, cacheHitCount,
    avgLatencyMs, errorCategories, topDirectorIds, emptyRate, avgMatchCount,
  };
}

/** Derive diagnostic actions from recommendation summary */
export function deriveRecommendActions(summary: RecommendLogSummary): string[] {
  const items: string[] = [];

  if (summary.total === 0) return ["추천 로그 없음 — 먼저 추천 버튼을 사용해보세요."];

  if (summary.errorCount > 0) {
    const cats = Object.entries(summary.errorCategories).sort(([, a], [, b]) => b - a);
    if (cats.length > 0) {
      const [topCat, topCount] = cats[0];
      const catActions: Record<string, string> = {
        "network": "네트워크 연결 상태 확인",
        "api-key": "Gemini API 키 유효성 확인 (환경변수)",
        "rate-limit": "API 호출 빈도 줄이거나 키 할당량 확인",
        "parse-error": "Gemini 응답 형식 오류 — prompt 또는 parseFirstJsonObject 점검",
        "timeout": "API timeout 설정 증가 또는 storyText 길이 제한 확인",
        "unknown": "서버 로그에서 구체적 에러 확인",
      };
      items.push(`[에러] ${topCat} ${topCount}회 — ${catActions[topCat] ?? "로그 확인"}`);
    }
  }

  if (summary.emptyRate > 0.3 && summary.successCount + summary.emptyCount >= 3) {
    items.push(`[빈결과] 빈 결과 비율 ${(summary.emptyRate * 100).toFixed(0)}% — 시나리오 길이/구체성 확인, prompt 강화 검토`);
  }

  if (summary.topDirectorIds.length > 0) {
    const top = summary.topDirectorIds[0];
    const totalSuccess = summary.successCount || 1;
    if (top.count / totalSuccess > 0.6 && totalSuccess >= 3) {
      items.push(`[편향] "${top.id}" ${top.count}/${totalSuccess}회 추천 — 추천 다양성 부족, prompt의 temperature 또는 지시 확인`);
    }
  }

  if (summary.avgLatencyMs > 8000) {
    items.push(`[지연] 평균 응답 ${(summary.avgLatencyMs / 1000).toFixed(1)}초 — Flash 모델 사용 확인, storyText 길이 제한 검토`);
  }

  if (summary.cacheHitCount > summary.total * 0.5 && summary.total >= 5) {
    items.push(`[캐시] 캐시 히트 ${summary.cacheHitCount}/${summary.total}회 — 다양한 시나리오로 테스트 필요`);
  }

  if (items.length === 0 && summary.successCount > 0) {
    items.push(`정상 — ${summary.successCount}회 성공, 평균 ${summary.avgMatchCount}명 추천, ${summary.avgLatencyMs}ms`);
  }

  return items;
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
