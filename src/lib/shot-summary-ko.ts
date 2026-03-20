/**
 * shot-summary-ko.ts — Korean shot summary generator for multi-shot preview
 *
 * Generates short, readable Korean summaries from cleaned English shot prompts.
 * These are UI-only — the app still sends English prompts to Kling.
 *
 * IMPORTANT: Summaries should be generated from the NORMALIZED multi_prompt
 * (via NormalizedKlingPayload.model_params.multi_prompt), NOT from raw UI shot data.
 * This ensures the visible Korean summary matches what will actually be sent to Kling.
 *
 * Approach: deterministic keyword extraction + template mapping.
 * No LLM call, no external dependency, no latency.
 */

import type { MultiShotPrompt } from "@/types";
import type { NormalizedKlingPayload, NormalizedMultiPromptEntry } from "@/lib/kling-payload-normalizer";

// ── Keyword → Korean mapping tables ──

const FRAMING_KO: Record<string, string> = {
  "wide": "전경",
  "establishing": "전경",
  "medium": "중간",
  "close-up": "클로즈업",
  "close up": "클로즈업",
  "extreme close-up": "극접사",
  "tight": "밀착",
  "overhead": "부감",
};

const CAMERA_KO: Record<string, string> = {
  "push-in": "다가가며",
  "push in": "다가가며",
  "pull-back": "뒤로 빠지며",
  "pull back": "뒤로 빠지며",
  "drift": "흘러가며",
  "drifting": "흘러가며",
  "pan": "패닝하며",
  "tilt": "틸트하며",
  "orbit": "공전하며",
  "tracking": "따라가며",
};

const OBJECT_KO: Record<string, string> = {
  "dental room": "치과실",
  "dental office": "치과",
  "dental tools": "치과 도구",
  "dental tool": "치과 도구",
  "dental chair": "치과 의자",
  "dental drill": "치과 드릴",
  "drill bit": "드릴 비트",
  "drill": "드릴",
  "chair": "의자",
  "tray": "트레이",
  "tool tray": "도구 트레이",
  "tools": "도구들",
  "instrument": "기구",
  "instruments": "기구들",
  "scalpel": "메스",
  "needle": "바늘",
  "forceps": "겸자",
  "lamp": "램프",
  "mirror": "거울",
  "cabinet": "캐비넷",
  "bottle": "병",
  "jar": "유리병",
  "rusty": "녹슨",
  "antique": "골동품",
  "worn": "낡은",
  "metal": "금속",
  "spinning": "회전하는",
  "sharp": "날카로운",
};

const PLACE_KO: Record<string, string> = {
  "room": "방",
  "clinic": "병원",
  "hospital": "병원",
  "kitchen": "주방",
  "workshop": "작업실",
  "laboratory": "실험실",
  "studio": "스튜디오",
  "office": "사무실",
  "church": "교회",
  "palace": "궁전",
  "castle": "성",
  "forest": "숲",
  "street": "거리",
  "market": "시장",
  "temple": "사원",
  "ruins": "폐허",
  "cave": "동굴",
  "beach": "해변",
  "mountain": "산",
  "village": "마을",
  "city": "도시",
  "bridge": "다리",
  "tunnel": "터널",
  "library": "도서관",
  "prison": "감옥",
  "tower": "탑",
  "garden": "정원",
};

const MOOD_KO: Record<string, string> = {
  "dimly lit": "어둑한",
  "dim": "어둑한",
  "warm": "따뜻한",
  "cold": "차가운",
  "bright": "밝은",
  "harsh": "강렬한",
  "soft": "부드러운",
  "dramatic": "극적인",
  "tense": "긴장된",
  "eerie": "으스스한",
  "peaceful": "평화로운",
};

const ACTION_KO: Record<string, string> = {
  "revealing": "드러내는",
  "approaching": "다가가는",
  "spinning": "회전하는",
  "moving": "움직이는",
  "emerging": "나타나는",
  "emphasized": "강조되는",
  "visible": "보이는",
  "unresolved": "미해결된",
  "open": "열린",
  "increasing": "점점 빨라지는",
};

// ── Role-based Korean fallback templates ──

const ROLE_FALLBACK_KO: Record<string, string> = {
  establish: "장면 도입 — 전체 공간이 보임",
  transition: "시점 전환 — 새로운 각도",
  develop: "액션 전개 — 주체가 움직임",
  insert: "디테일 강조 — 오브젝트 클로즈업",
  peak: "절정 — 가장 강렬한 순간",
  resolve: "마무리 — 긴장 유지 또는 해소",
  opening: "도입",
  building: "전개",
  climax: "절정",
  falling: "하강",
};

/**
 * Generate a short Korean summary from a single cleaned English shot prompt.
 *
 * Strategy:
 * 1. Extract known objects/places/moods from the English prompt
 * 2. Map to Korean equivalents
 * 3. Combine with framing/camera cues
 * 4. Fall back to role-based template if extraction yields nothing
 */
export function generateShotSummaryKo(
  prompt: string,
  role?: string,
): string {
  if (!prompt || prompt.trim().length === 0) {
    return ROLE_FALLBACK_KO[role || "establish"] || "장면";
  }

  const lower = prompt.toLowerCase();
  const parts: string[] = [];

  // 1. Extract framing
  let framingKo = "";
  for (const [en, ko] of Object.entries(FRAMING_KO)) {
    if (lower.includes(en)) { framingKo = ko; break; }
  }

  // 2. Extract camera motion
  let cameraKo = "";
  for (const [en, ko] of Object.entries(CAMERA_KO)) {
    if (lower.includes(en)) { cameraKo = ko; break; }
  }

  // 3. Extract mood
  let moodKo = "";
  for (const [en, ko] of Object.entries(MOOD_KO)) {
    if (lower.includes(en)) { moodKo = ko; break; }
  }

  // 4. Extract objects (multi-word first for specificity)
  const objectsFound: string[] = [];
  const sortedObjects = Object.entries(OBJECT_KO).sort((a, b) => b[0].length - a[0].length);
  for (const [en, ko] of sortedObjects) {
    if (lower.includes(en) && !objectsFound.includes(ko)) {
      objectsFound.push(ko);
      if (objectsFound.length >= 2) break;
    }
  }

  // 5. Extract place
  let placeKo = "";
  for (const [en, ko] of Object.entries(PLACE_KO)) {
    if (lower.includes(en)) { placeKo = ko; break; }
  }

  // 6. Extract actions
  let actionKo = "";
  for (const [en, ko] of Object.entries(ACTION_KO)) {
    if (lower.includes(en)) { actionKo = ko; break; }
  }

  // Build summary
  if (moodKo) parts.push(moodKo);
  if (placeKo && framingKo === "전경") {
    parts.push(`${placeKo} ${framingKo}이 보임`);
  } else if (objectsFound.length > 0) {
    const objStr = objectsFound.join(", ");
    if (actionKo) {
      parts.push(`${objStr}이 ${actionKo}`);
    } else if (cameraKo) {
      parts.push(`${objStr}을 ${cameraKo} 훑어봄`);
    } else if (framingKo === "클로즈업" || framingKo === "극접사" || framingKo === "밀착") {
      parts.push(`${objStr} ${framingKo}`);
    } else {
      parts.push(`${objStr}이 보임`);
    }
  } else if (placeKo) {
    if (cameraKo) {
      parts.push(`${placeKo}을 ${cameraKo} 보여줌`);
    } else {
      parts.push(`${placeKo} 장면`);
    }
  } else if (framingKo) {
    parts.push(`${framingKo} 장면`);
  }

  // If we got something, join and return
  if (parts.length > 0) {
    return parts.join(" ");
  }

  // Fallback to role-based template
  return ROLE_FALLBACK_KO[role || "establish"] || "장면";
}

/**
 * Generate Korean summaries for an array of multi-shot prompts.
 * Returns the same-length array of summary strings.
 *
 * @deprecated Prefer generateSummariesFromNormalizedPayload() which derives
 * summaries from the authoritative NormalizedKlingPayload.model_params.multi_prompt.
 * This legacy function is kept for backward compatibility with call sites
 * that have not yet migrated to the normalized payload flow.
 */
export function generateMultiShotSummariesKo(
  shots: MultiShotPrompt[],
): Array<{ index: number; duration: string; summaryKo: string }> {
  return shots.map((shot) => ({
    index: shot.index,
    duration: shot.duration,
    summaryKo: generateShotSummaryKo(shot.prompt, shot.role),
  }));
}

/**
 * Generate Korean summaries from a NormalizedKlingPayload's multi_prompt.
 *
 * THIS is the authoritative path for Korean summaries.
 * It guarantees that summaries derive from the exact same normalized shot data
 * that will be sent to the Kling API.
 *
 * Usage:
 *   const payload = buildNormalizedKlingPayload(input);
 *   const summaries = generateSummariesFromNormalizedPayload(payload);
 */
export function generateSummariesFromNormalizedPayload(
  payload: NormalizedKlingPayload,
): Array<{ index: number; duration: string; summaryKo: string }> {
  const multiPrompt = payload.model_params?.multi_prompt ?? [];
  return multiPrompt.map((entry) => ({
    index: entry.index,
    duration: entry.duration,
    summaryKo: generateShotSummaryKo(entry.prompt),
  }));
}

/**
 * Generate Korean summaries from normalized multi_prompt entries directly.
 *
 * Use this when you have the multi_prompt array but not the full payload object.
 * The entries MUST come from NormalizedKlingPayload.model_params.multi_prompt
 * to ensure source-of-truth consistency.
 */
export function generateSummariesFromNormalizedMultiPrompt(
  entries: NormalizedMultiPromptEntry[],
): Array<{ index: number; duration: string; summaryKo: string }> {
  return entries.map((entry) => ({
    index: entry.index,
    duration: entry.duration,
    summaryKo: generateShotSummaryKo(entry.prompt),
  }));
}
