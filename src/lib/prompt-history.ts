import { PromptInput, PromptOutput } from "@/types";

export interface PromptHistoryEntry {
  id: string;
  createdAt: number;
  input: PromptInput;
  output: PromptOutput;
}

const STORAGE_KEY = "prompt-generation-history";
const MAX_ENTRIES = 30;

function genId(): string {
  return `ph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function getPromptHistory(): PromptHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PromptHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function savePromptHistory(input: PromptInput, output: PromptOutput): PromptHistoryEntry {
  const history = getPromptHistory();
  const entry: PromptHistoryEntry = {
    id: genId(),
    createdAt: Date.now(),
    input,
    output,
  };
  history.unshift(entry);
  if (history.length > MAX_ENTRIES) history.length = MAX_ENTRIES;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // localStorage 용량 초과 시 절반 삭제 후 재시도
    history.splice(MAX_ENTRIES / 2);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch { /* ignore */ }
  }
  return entry;
}

export function deletePromptHistory(id: string): void {
  const history = getPromptHistory().filter((e) => e.id !== id);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch { /* ignore */ }
}
