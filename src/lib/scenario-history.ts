import { ChatMessage } from "@/types";

export interface ScenarioEntry {
  id: string;
  title: string;
  personaId: string;
  personaName: string;
  messages: ChatMessage[];
  finalScenario: string; // 마지막 AI 응답 (시나리오 텍스트)
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "scenario-history";
const MAX_ENTRIES = 50;

function generateId(): string {
  return `sc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function getScenarioHistory(): ScenarioEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ScenarioEntry[];
  } catch {
    return [];
  }
}

export function saveScenario(entry: Omit<ScenarioEntry, "id" | "createdAt" | "updatedAt">): ScenarioEntry {
  const history = getScenarioHistory();
  const now = Date.now();
  const newEntry: ScenarioEntry = {
    ...entry,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  history.unshift(newEntry);
  if (history.length > MAX_ENTRIES) history.length = MAX_ENTRIES;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  return newEntry;
}

export function deleteScenario(id: string): void {
  const history = getScenarioHistory().filter((e) => e.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function extractScenarioTitle(messages: ChatMessage[]): string {
  // 첫 번째 유저 메시지에서 제목 추출
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!firstUserMsg) return "제목 없음";
  const text = firstUserMsg.content.trim();
  return text.length > 40 ? text.slice(0, 40) + "..." : text;
}

export function extractFinalScenario(messages: ChatMessage[]): string {
  // 마지막 AI 응답을 시나리오 텍스트로 사용 (출처 정보 제거)
  const assistantMsgs = messages.filter((m) => m.role === "assistant");
  if (assistantMsgs.length === 0) return "";
  let text = assistantMsgs[assistantMsgs.length - 1].content;
  // --- 구분선 이하 모두 제거 (출처 섹션)
  text = text.replace(/\n{1,}[-—]{2,}[\s\S]*$/, "");
  // "출처:" 키워드 이하 모두 제거
  text = text.replace(/\n*[-—]*\s*(?:출처|참고|참조|Source|Reference)[:\s][\s\S]*$/i, "");
  // 단독 URL 라인 제거
  text = text.replace(/\n*\[?\d+\]?\s*https?:\/\/\S+/g, "");
  return text.trim();
}
