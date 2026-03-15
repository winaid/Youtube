/**
 * video-job-store.ts — 영상 생성 작업 영속성 관리 (localStorage)
 *
 * 핵심 목적:
 *   1. 생성 요청 즉시 job record 저장 → 페이지 새로고침 후 복구 가능
 *   2. polling 상태를 실시간 추적 → 장시간 생성에도 작업 유실 방지
 *   3. provider 무관 설계 → Kling 외 다른 생성 모델에도 재사용 가능
 *
 * 상태 머신:
 *   queued → submitted → processing → completed
 *                                    → failed
 *                                    → timeout_recoverable
 *
 * - queued: 요청 생성됨, API 호출 전
 * - submitted: API 호출 성공, taskId 수신
 * - processing: polling 진행 중 (최소 1회 RUNNING 응답 확인)
 * - completed: 영상 생성 완료
 * - failed: 복구 불가능한 실패
 * - timeout_recoverable: 클라이언트 타임아웃이지만 서버에서 계속 처리 가능
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type JobStatus =
  | "queued"
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "timeout_recoverable";

export type JobErrorType =
  | "network"
  | "provider_timeout"
  | "provider_rejected"
  | "malformed_payload"
  | "unknown";

export interface VideoJobRecord {
  /** 클라이언트 생성 UUID */
  jobId: string;
  /** 생성 엔진 (kling 등) — 멀티 프로바이더 확장용 */
  engine: string;
  /** 생성 요청의 taskId (API 응답 후 채워짐) */
  taskId: string | null;
  /** 컷 번호 */
  cutNumber: number;
  /** 작업 상태 */
  status: JobStatus;
  /** 사용자에게 표시할 상태 메시지 */
  statusMessage: string;
  /** 재시도용 원본 요청 페이로드 (최소 정보만 저장) */
  requestSummary: JobRequestSummary;
  /** 생성 시각 */
  createdAt: number;
  /** 마지막 polling 시각 */
  lastPolledAt: number;
  /** polling 시도 횟수 */
  pollAttempts: number;
  /** Kling 원본 상태값 */
  lastProviderStatus: string | null;
  /** 완료 시 영상 URL */
  resultUrl: string | null;
  /** 완료 시 raw URI */
  rawResultUrl: string | null;
  /** 완료 시 seed */
  seed: string | null;
  /** 에러 메시지 */
  error: string | null;
  /** 에러 유형 */
  errorType: JobErrorType | null;
  /** 재시도 횟수 */
  retryCount: number;
  /** operation name (API 호환용) */
  operationName: string | null;
  /** 프로젝트 제목 (UI 표시용) */
  projectTitle: string | null;
}

/** 재시도에 필요한 최소 요청 정보 — 전체 payload가 아닌 요약 */
export interface JobRequestSummary {
  prompt?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  videoMode?: "generate" | "extend";
  /** 프롬프트 미리보기 (UI용, 80자 이하) */
  promptPreview: string;
  /** 멀티샷 메타데이터 — 복구/재시도 시 멀티샷 계획 보존 */
  multiShotCount?: number;
  /** 멀티샷 role 시퀀스 요약 (복구 시 re-plan 참조용) */
  multiShotRoles?: string[];
  /** 생성 모드 */
  generationMode?: "studio" | "batch";
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const STORAGE_KEY = "video-jobs";
const MAX_JOBS = 100;

/** 완료/실패 작업 자동 정리 기한 (7일) */
const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════
// User-Facing Status Messages
// ═══════════════════════════════════════════════════════════════════

/** 상태별 사용자 표시 메시지 — 기술 용어 대신 자연어 */
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "대기 중...",
  submitted: "요청을 보냈어요",
  processing: "영상을 만들고 있어요",
  completed: "완료!",
  failed: "생성에 실패했어요",
  timeout_recoverable: "시간이 오래 걸리고 있어요",
};

/** 상태별 보조 설명 */
export const JOB_STATUS_DESCRIPTIONS: Record<JobStatus, string> = {
  queued: "잠시 후 시작됩니다",
  submitted: "생성 서버가 요청을 받았어요",
  processing: "보통 1~3분 걸려요",
  completed: "영상이 준비되었어요",
  failed: "다시 시도해 주세요",
  timeout_recoverable: "서버에서 계속 처리 중이에요. 확인 버튼을 눌러주세요.",
};

// ═══════════════════════════════════════════════════════════════════
// Core CRUD
// ═══════════════════════════════════════════════════════════════════

function generateJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 모든 job 레코드를 읽는다 */
export function getAllJobs(): VideoJobRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

/** 특정 job을 jobId로 조회 */
export function getJob(jobId: string): VideoJobRecord | null {
  return getAllJobs().find(j => j.jobId === jobId) ?? null;
}

/** 특정 job을 taskId로 조회 */
export function getJobByTaskId(taskId: string): VideoJobRecord | null {
  return getAllJobs().find(j => j.taskId === taskId) ?? null;
}

/** 새 job record를 생성한다 (queued 상태) */
export function createJob(params: {
  engine?: string;
  cutNumber: number;
  requestSummary: JobRequestSummary;
  projectTitle?: string;
}): VideoJobRecord {
  const job: VideoJobRecord = {
    jobId: generateJobId(),
    engine: params.engine || "kling",
    taskId: null,
    cutNumber: params.cutNumber,
    status: "queued",
    statusMessage: JOB_STATUS_LABELS.queued,
    requestSummary: params.requestSummary,
    createdAt: Date.now(),
    lastPolledAt: 0,
    pollAttempts: 0,
    lastProviderStatus: null,
    resultUrl: null,
    rawResultUrl: null,
    seed: null,
    error: null,
    errorType: null,
    retryCount: 0,
    operationName: null,
    projectTitle: params.projectTitle || null,
  };

  saveJob(job);
  return job;
}

/** job record를 업데이트한다 */
export function updateJob(jobId: string, updates: Partial<VideoJobRecord>): VideoJobRecord | null {
  const jobs = getAllJobs();
  const idx = jobs.findIndex(j => j.jobId === jobId);
  if (idx === -1) return null;

  const updated = { ...jobs[idx], ...updates };

  // statusMessage 자동 갱신 (명시적 override가 없을 때)
  if (updates.status && !updates.statusMessage) {
    updated.statusMessage = JOB_STATUS_LABELS[updates.status];
  }

  jobs[idx] = updated;
  persistJobs(jobs);
  notifyChange();
  return updated;
}

/** job 상태를 submitted로 전환 (taskId 수신 직후) */
export function markSubmitted(jobId: string, taskId: string, operationName?: string): VideoJobRecord | null {
  return updateJob(jobId, {
    status: "submitted",
    taskId,
    operationName: operationName || null,
    lastPolledAt: Date.now(),
  });
}

/** job 상태를 processing으로 전환 (첫 RUNNING 응답 확인) */
export function markProcessing(jobId: string, providerStatus?: string): VideoJobRecord | null {
  return updateJob(jobId, {
    status: "processing",
    lastPolledAt: Date.now(),
    lastProviderStatus: providerStatus || "processing",
  });
}

/** polling 진행 상황만 업데이트 (상태 변경 없이) */
export function updatePollProgress(jobId: string, attempt: number, providerStatus?: string): void {
  const jobs = getAllJobs();
  const idx = jobs.findIndex(j => j.jobId === jobId);
  if (idx === -1) return;

  jobs[idx] = {
    ...jobs[idx],
    lastPolledAt: Date.now(),
    pollAttempts: attempt,
    lastProviderStatus: providerStatus || jobs[idx].lastProviderStatus,
  };
  persistJobs(jobs);
  // 잦은 progress 업데이트는 이벤트 미발생 (성능)
}

/** job 완료 */
export function markCompleted(jobId: string, result: {
  resultUrl: string;
  rawResultUrl?: string;
  seed?: string;
}): VideoJobRecord | null {
  return updateJob(jobId, {
    status: "completed",
    resultUrl: result.resultUrl,
    rawResultUrl: result.rawResultUrl || null,
    seed: result.seed || null,
    lastPolledAt: Date.now(),
  });
}

/** job 실패 */
export function markFailed(jobId: string, error: string, errorType?: JobErrorType): VideoJobRecord | null {
  return updateJob(jobId, {
    status: "failed",
    error,
    errorType: errorType || "unknown",
    lastPolledAt: Date.now(),
  });
}

/** job을 timeout_recoverable로 전환 */
export function markTimeoutRecoverable(jobId: string): VideoJobRecord | null {
  return updateJob(jobId, {
    status: "timeout_recoverable",
    statusMessage: "시간이 오래 걸리고 있어요. 서버에서 계속 처리 중이에요.",
    lastPolledAt: Date.now(),
  });
}

/** job 삭제 */
export function deleteJob(jobId: string): void {
  const jobs = getAllJobs().filter(j => j.jobId !== jobId);
  persistJobs(jobs);
  notifyChange();
}

// ═══════════════════════════════════════════════════════════════════
// Recovery — 페이지 새로고침 후 미완료 작업 탐색
// ═══════════════════════════════════════════════════════════════════

/** 복구 가능한 미완료 작업을 반환한다 */
export function getRecoverableJobs(): VideoJobRecord[] {
  return getAllJobs().filter(j =>
    j.taskId != null &&
    (j.status === "submitted" || j.status === "processing" || j.status === "timeout_recoverable"),
  );
}

/** queued 상태에서 오래 방치된 작업 (taskId 없이 1시간 이상) → 자동 정리 */
export function getStaleQueuedJobs(): VideoJobRecord[] {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  return getAllJobs().filter(j =>
    j.status === "queued" && j.taskId == null && j.createdAt < oneHourAgo,
  );
}

/** 오래된 완료/실패 작업 정리 */
export function cleanupOldJobs(): number {
  const cutoff = Date.now() - CLEANUP_AGE_MS;
  const jobs = getAllJobs();
  const before = jobs.length;
  const filtered = jobs.filter(j => {
    // 미완료 작업은 보존
    if (j.status === "submitted" || j.status === "processing" || j.status === "timeout_recoverable") {
      return true;
    }
    // queued (taskId 없음)는 1시간 이상이면 정리
    if (j.status === "queued" && j.taskId == null && j.createdAt < Date.now() - 60 * 60 * 1000) {
      return false;
    }
    // 완료/실패는 7일 이상이면 정리
    return j.createdAt >= cutoff;
  });

  if (filtered.length < before) {
    persistJobs(filtered);
  }
  return before - filtered.length;
}

// ═══════════════════════════════════════════════════════════════════
// Internal
// ═══════════════════════════════════════════════════════════════════

function saveJob(job: VideoJobRecord): void {
  const jobs = getAllJobs();
  jobs.unshift(job);
  if (jobs.length > MAX_JOBS) {
    // 가장 오래된 완료/실패 작업부터 제거
    const toRemove = jobs.length - MAX_JOBS;
    let removed = 0;
    for (let i = jobs.length - 1; i >= 0 && removed < toRemove; i--) {
      if (jobs[i].status === "completed" || jobs[i].status === "failed") {
        jobs.splice(i, 1);
        removed++;
      }
    }
  }
  persistJobs(jobs);
  notifyChange();
}

function persistJobs(jobs: VideoJobRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // 용량 초과 시 오래된 완료 작업 절반 삭제 후 재시도
    const reduced = jobs.filter(j =>
      j.status !== "completed" && j.status !== "failed",
    ).concat(
      jobs.filter(j => j.status === "completed" || j.status === "failed").slice(0, 20),
    );
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reduced));
    } catch { /* give up */ }
  }
}

function notifyChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("video-jobs-updated"));
  }
}
