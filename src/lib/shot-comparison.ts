/**
 * shot-comparison.ts — 3-way shot diff engine
 *
 * original (assembleFromJSON 직후) vs autoFixed (QA autofix 후) vs finalSent (API 전송 직전)
 *
 * 설계 원칙:
 *   - 필드 단위 비교 (flat path: "cameraPlan.motion", "physicsRules.gravity" 등)
 *   - null / undefined / "" 정규화
 *   - 배열은 trim + sort 후 비교
 *   - changed-only 필터 지원
 *   - lunar/space/underwater physics 변경이 diff에 드러남
 */

import type {
  StructuredSequenceDocument,
  FieldDiff,
  ShotComparison,
} from "@/types";

// ── 정규화 ──────────────────────────────────────────────────────────────────

/** null, undefined, "" → null 통일. 문자열 trim. */
function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (Array.isArray(v)) {
    const cleaned = v
      .map(normalize)
      .filter((x) => x !== null);
    if (cleaned.length === 0) return null;
    // 문자열 배열이면 sort (순서 무관 비교)
    if (cleaned.every((x) => typeof x === "string")) {
      return (cleaned as string[]).slice().sort();
    }
    return cleaned;
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let hasKey = false;
    for (const k of Object.keys(obj)) {
      const nv = normalize(obj[k]);
      if (nv !== null) {
        out[k] = nv;
        hasKey = true;
      }
    }
    return hasKey ? out : null;
  }
  return v;
}

/** 깊은 동등 비교 (정규화된 값 기준) */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as Record<string, unknown>).sort();
    const kb = Object.keys(b as Record<string, unknown>).sort();
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k, i) =>
        k === kb[i] &&
        deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    );
  }
  return false;
}

// ── 비교 대상 필드 경로 정의 ────────────────────────────────────────────────

const COMPARE_PATHS: string[] = [
  // 기본 메타
  "sceneType",
  "durationSec",
  // 스타일
  "styleProfile.mode",
  "styleProfile.mediumLock",
  "styleProfile.colorAnchor",
  // 연속성
  "continuity.lighting",
  "continuity.sky",
  "continuity.surface",
  "continuity.scale",
  "continuity.characterRef",
  "continuity.mustPersist",
  // 물리 법칙 (lunar/space/underwater diff 핵심)
  "physicsRules.gravity",
  "physicsRules.hasWind",
  "physicsRules.hasAtmosphere",
  "physicsRules.environmentType",
  "physicsRules.flagMotionSource",
  "physicsRules.skyConstraint",
  "physicsRules.lightConstraint",
  "physicsRules.bannedExpressions",
  // WHERE / WHAT / HOW
  "placeIdentityAnchors",
  "situationEvidence",
  "naturalMotion",
  // 카메라
  "cameraPlan.baseFraming",
  "cameraPlan.angle",
  "cameraPlan.motion",
  "cameraPlan.motionMotivation",
  // 시간 비트
  "temporalBeats",
  // 밀도
  "densityScore.total",
  "densityScore.missing",
  // shotPlan 핵심
  "shotPlan.camera.framing",
  "shotPlan.camera.angle",
  "shotPlan.camera.motion",
  "shotPlan.action",
  "shotPlan.moodLighting",
  "shotPlan.locationCue",
  "shotPlan.situationCue",
  "shotPlan.emotionalAnchor",
  "shotPlan.subject.primary",
  "shotPlan.subject.characterRef",
  "shotPlan.subject.blocking",
  "shotPlan.timingBeat",
  "shotPlan.transitionFromPrev",
  "shotPlan.visualMedium",
  "shotPlan.negativeDirectives",
  // negatives
  "negatives.universal",
  "negatives.style",
  "negatives.sceneSpecific",
  "negatives.failureMode",
  "negatives.user",
  // validation
  "validation.valid",
  "validation.errors",
  "validation.warnings",
  // 자동 수정
  "sanitizeFixes",
  "conflictResolutions",
  // shots 배열 길이 (구조 변경 감지)
  "shots.length",
];

/** 점(.) 경로로 객체에서 값 추출 */
function getByPath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ── 메인 비교 함수 ──────────────────────────────────────────────────────────

export interface CompareShotOptions {
  /** true면 변경된 필드만 반환 */
  changedOnly?: boolean;
}

/**
 * 3-way diff: original vs autoFixed vs finalSent
 * 어느 하나라도 없으면 있는 것만으로 비교 (null 취급).
 */
export function compareShot(
  original: StructuredSequenceDocument | undefined,
  autoFixed: StructuredSequenceDocument | undefined,
  finalSent: StructuredSequenceDocument | undefined,
  opts?: CompareShotOptions,
): ShotComparison {
  const diffs: FieldDiff[] = [];

  for (const path of COMPARE_PATHS) {
    const rawO = getByPath(original, path);
    const rawA = getByPath(autoFixed, path);
    const rawF = getByPath(finalSent, path);

    const nO = normalize(rawO);
    const nA = normalize(rawA);
    const nF = normalize(rawF);

    const oToA = !deepEqual(nO, nA);
    const aToF = !deepEqual(nA, nF);

    const changedAt: FieldDiff["changedAt"] =
      oToA && aToF ? "both" : oToA ? "autofix" : aToF ? "server" : "none";

    if (opts?.changedOnly && changedAt === "none") continue;

    diffs.push({
      field: path,
      original: nO,
      autoFixed: nA,
      finalSent: nF,
      changedAt,
    });
  }

  const changedCount = diffs.filter((d) => d.changedAt !== "none").length;

  return {
    cutNumber: original?.cutNumber ?? autoFixed?.cutNumber ?? finalSent?.cutNumber ?? 0,
    shotId: original?.shotId ?? autoFixed?.shotId ?? finalSent?.shotId ?? "",
    diffs,
    changedCount,
    totalFields: COMPARE_PATHS.length,
  };
}

/** 사람이 읽기 좋은 필드명 변환 */
export function humanFieldName(path: string): string {
  const MAP: Record<string, string> = {
    sceneType: "장면 유형",
    durationSec: "길이(초)",
    "styleProfile.mode": "스타일 모드",
    "styleProfile.mediumLock": "미디엄 잠금",
    "styleProfile.colorAnchor": "색상 앵커",
    "continuity.lighting": "조명 연속성",
    "continuity.sky": "하늘",
    "continuity.surface": "표면",
    "continuity.characterRef": "캐릭터 레퍼런스",
    "continuity.mustPersist": "유지 필수 요소",
    "physicsRules.gravity": "중력",
    "physicsRules.hasWind": "바람 유무",
    "physicsRules.hasAtmosphere": "대기 유무",
    "physicsRules.environmentType": "환경 유형",
    "physicsRules.bannedExpressions": "금지 표현",
    placeIdentityAnchors: "장소 앵커 (WHERE)",
    situationEvidence: "상황 증거 (WHAT)",
    naturalMotion: "자연 모션 (HOW)",
    "cameraPlan.baseFraming": "프레이밍",
    "cameraPlan.angle": "카메라 앵글",
    "cameraPlan.motion": "카메라 모션",
    "densityScore.total": "밀도 점수",
    "densityScore.missing": "누락 항목",
    "shotPlan.camera.framing": "샷 프레이밍",
    "shotPlan.camera.angle": "샷 앵글",
    "shotPlan.camera.motion": "샷 모션",
    "shotPlan.action": "액션",
    "shotPlan.moodLighting": "무드/조명",
    "shotPlan.locationCue": "위치 큐",
    "shotPlan.situationCue": "상황 큐",
    "shotPlan.emotionalAnchor": "감정 앵커",
    "shotPlan.subject.primary": "주요 피사체",
    "shotPlan.subject.characterRef": "캐릭터 외형",
    "shotPlan.subject.blocking": "블로킹",
    "shotPlan.timingBeat": "타이밍 비트",
    "shotPlan.negativeDirectives": "네거티브 지시",
    "negatives.universal": "네거티브 (공통)",
    "negatives.style": "네거티브 (스타일)",
    "negatives.sceneSpecific": "네거티브 (장면)",
    "negatives.failureMode": "네거티브 (실패방지)",
    "negatives.user": "네거티브 (사용자)",
    "validation.valid": "검증 통과",
    "validation.errors": "검증 에러 수",
    sanitizeFixes: "자동 수정 내역",
    conflictResolutions: "충돌 해결 내역",
    "shots.length": "멀티샷 수",
  };
  return MAP[path] || path;
}

/** 값을 UI 표시용 문자열로 변환 */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.length > 120 ? v.slice(0, 117) + "..." : v;
  if (Array.isArray(v)) {
    if (v.length === 0) return "-";
    return v.map((x) => formatValue(x)).join(", ");
  }
  return JSON.stringify(v).slice(0, 120);
}

// ── Export helpers for testing ──

export { normalize, deepEqual, getByPath, COMPARE_PATHS };
