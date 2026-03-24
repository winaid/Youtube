export interface ProjectRecord {
  id: string;
  title: string;
  directorStyle: string;
  directorName: string;
  region: string;
  animationMode: string;
  cutCount: number;
  createdAt: number;
  // 성과 트래킹 (사용자 수동 입력)
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  updatedAt?: number;
}

const STORAGE_KEY = "project-analytics";

function getProjectRecords(): ProjectRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveProjectRecord(record: Omit<ProjectRecord, "id" | "createdAt">): ProjectRecord {
  if (typeof window === "undefined") return { ...record, id: "", createdAt: 0 };
  const records = getProjectRecords();
  const newRecord: ProjectRecord = {
    ...record,
    id: `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  records.unshift(newRecord);
  if (records.length > 100) records.length = 100;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { /* quota exceeded */ }
  return newRecord;
}
