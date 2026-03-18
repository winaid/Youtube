/**
 * owner-checklist.ts — 오너 반복 검증 체크리스트
 *
 * 하루 동안 10~20개 시나리오를 돌리며 바로 체크할 수 있는 간결한 목록.
 * localStorage에 체크 상태를 저장해서 세션 간 유지.
 */

export interface CheckItem {
  id: string;
  label: string;
}

export interface CheckCategory {
  id: string;
  title: string;
  items: CheckItem[];
}

export const OWNER_CHECKLIST: CheckCategory[] = [
  {
    id: "first-impression",
    title: "첫 인상",
    items: [
      { id: "fi-1", label: "결과를 즉시 이해할 수 있는가" },
      { id: "fi-2", label: "첫 생성이 너무 느리거나 빈약하지 않은가" },
      { id: "fi-3", label: "projectTitle이 내용과 맞는가" },
    ],
  },
  {
    id: "rhythm",
    title: "리듬",
    items: [
      { id: "rh-1", label: "15초 장면이 충분히 전개감 있는가" },
      { id: "rh-2", label: "컷 수만 많고 실질 리듬은 죽어 있지 않은가" },
      { id: "rh-3", label: "컷 내부 shot progression이 살아 있는가" },
      { id: "rh-4", label: "컷 간 전환이 자연스러운가" },
    ],
  },
  {
    id: "director",
    title: "감독 스타일",
    items: [
      { id: "dr-1", label: "스타일이 리듬을 죽이지 않는가" },
      { id: "dr-2", label: "반대로 스타일이 너무 희석되지 않는가" },
      { id: "dr-3", label: "감독별 차이가 체감되는가" },
    ],
  },
  {
    id: "editing-ux",
    title: "편집 UX",
    items: [
      { id: "ux-1", label: "컷 수정이 쉬운가" },
      { id: "ux-2", label: "변형 생성이 실제로 유의미한가" },
      { id: "ux-3", label: "저장/재열기 흐름이 자연스러운가" },
      { id: "ux-4", label: "Cmd+S 반응이 즉각적인가" },
    ],
  },
  {
    id: "reliability",
    title: "신뢰성",
    items: [
      { id: "rl-1", label: "fallback이 버그처럼 느껴지지 않는가" },
      { id: "rl-2", label: "저장/복원이 안정적인가" },
      { id: "rl-3", label: "디버그 패널 값이 실제 결과와 일치하는가" },
      { id: "rl-4", label: "에러 발생 시 메시지가 명확한가" },
    ],
  },
];

const STORAGE_KEY = "owner-checklist-state";

export function loadCheckState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveCheckState(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

export function resetCheckState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}
