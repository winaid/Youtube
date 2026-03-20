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

export function getProjectRecords(): ProjectRecord[] {
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

export function updateProjectMetrics(id: string, metrics: Pick<ProjectRecord, "views" | "likes" | "comments" | "shares">): void {
  if (typeof window === "undefined") return;
  const records = getProjectRecords();
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return;
  Object.assign(records[idx], metrics, { updatedAt: Date.now() });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { /* quota exceeded */ }
}

export function deleteProjectRecord(id: string): void {
  if (typeof window === "undefined") return;
  const records = getProjectRecords().filter((r) => r.id !== id);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { /* quota exceeded */ }
}

export interface AnalyticsSummary {
  totalProjects: number;
  topDirectors: { name: string; count: number; avgViews: number }[];
  topRegions: { region: string; count: number }[];
  bestPerforming: ProjectRecord[];
}

export function getAnalyticsSummary(): AnalyticsSummary {
  const records = getProjectRecords();

  // Top directors
  const directorMap = new Map<string, { count: number; totalViews: number }>();
  for (const r of records) {
    const d = directorMap.get(r.directorName) || { count: 0, totalViews: 0 };
    d.count++;
    d.totalViews += r.views ?? 0;
    directorMap.set(r.directorName, d);
  }
  const topDirectors = [...directorMap.entries()]
    .map(([name, d]) => ({ name, count: d.count, avgViews: d.count > 0 ? Math.round(d.totalViews / d.count) : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Top regions
  const regionMap = new Map<string, number>();
  for (const r of records) {
    regionMap.set(r.region, (regionMap.get(r.region) || 0) + 1);
  }
  const topRegions = [...regionMap.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count);

  // Best performing
  const bestPerforming = [...records]
    .filter((r) => r.views !== undefined)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .slice(0, 5);

  return { totalProjects: records.length, topDirectors, topRegions, bestPerforming };
}
