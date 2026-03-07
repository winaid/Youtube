// 시리즈 연속성 관리 — localStorage 기반
import { SeriesProject, SeriesEpisode, CharacterSeed } from "@/types";

const SERIES_STORAGE_KEY = "yt-series-projects";

export function loadSeriesProjects(): SeriesProject[] {
  try {
    const raw = localStorage.getItem(SERIES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSeriesProjects(projects: SeriesProject[]): void {
  localStorage.setItem(SERIES_STORAGE_KEY, JSON.stringify(projects));
}

export function createSeriesProject(title: string): SeriesProject {
  const project: SeriesProject = {
    id: `series-${Date.now().toString(36)}`,
    seriesTitle: title,
    episodes: [],
    sharedCharacters: [],
    worldRules: [],
  };
  const projects = loadSeriesProjects();
  projects.push(project);
  saveSeriesProjects(projects);
  return project;
}

export function addEpisodeToSeries(
  seriesId: string,
  episode: Omit<SeriesEpisode, "id" | "episodeNumber" | "createdAt">
): SeriesEpisode | null {
  const projects = loadSeriesProjects();
  const project = projects.find((p) => p.id === seriesId);
  if (!project) return null;

  const ep: SeriesEpisode = {
    ...episode,
    id: `ep-${Date.now().toString(36)}`,
    episodeNumber: project.episodes.length + 1,
    createdAt: Date.now(),
  };
  project.episodes.push(ep);

  // 새 캐릭터를 시리즈 공유 캐릭터에 머지
  for (const seed of episode.characterSeeds) {
    if (!project.sharedCharacters.find((s) => s.id === seed.id)) {
      project.sharedCharacters.push(seed);
    }
  }

  saveSeriesProjects(projects);
  return ep;
}

export function getSeriesCharacters(seriesId: string): CharacterSeed[] {
  const projects = loadSeriesProjects();
  const project = projects.find((p) => p.id === seriesId);
  return project?.sharedCharacters ?? [];
}

export function deleteSeriesProject(seriesId: string): void {
  const projects = loadSeriesProjects().filter((p) => p.id !== seriesId);
  saveSeriesProjects(projects);
}
