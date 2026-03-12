/**
 * shot-variants.ts — 샷 단위 variant 관리 + regenerate payload 조립 (순수 함수)
 *
 * 역할:
 *  - shot variant CRUD (attach / activate / remove)
 *  - shot-level regenerate payload 조립
 *  - variant 비교 헬퍼
 *  - shot status 관리
 *
 * 2차 확장: shot-level regenerate / replace 흐름의 데이터 레이어
 * 3차 연결: variant별 prompt/meta 비교 → 비교 뷰에서 활용
 */

import type {
  StructuredSequenceDocument,
  ShotVariant,
  ShotRegenerateStatus,
} from "@/types";
import type { EditableShot, EditableSequence } from "@/lib/shot-editing";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/** shot별 상태 + variant를 추적하는 맵 */
export interface ShotVariantState {
  /** shotId → regenerate 상태 */
  statuses: Record<string, ShotRegenerateStatus>;
  /** shotId → variants 배열 */
  variants: Record<string, ShotVariant[]>;
  /** shotId → 현재 활성 variantId */
  activeVariantIds: Record<string, string>;
}

/** regenerate payload — API에 전송할 shot-level 데이터 */
export interface ShotRegeneratePayload {
  /** 재생성 대상 shot */
  shot: EditableShot;
  /** 공통 컨텍스트 (sceneType, styleProfile 등) */
  sequenceContext: {
    sequenceId: string;
    cutNumber: number;
    sceneType: string;
    durationSec: number;
    styleProfile: StructuredSequenceDocument["styleProfile"];
    continuity: StructuredSequenceDocument["continuity"];
    physicsRules: StructuredSequenceDocument["physicsRules"];
    placeIdentityAnchors: string[];
  };
  /** 이전 shot 요약 (continuity용) */
  previousShot?: {
    shotId: string;
    subject: string;
    action: string;
    camera: EditableShot["camera"];
    endSec: number;
  };
  /** 다음 shot 요약 (transition context) */
  nextShot?: {
    shotId: string;
    subject: string;
    action: string;
    camera: EditableShot["camera"];
    startSec: number;
  };
}

/** variant 비교 결과 */
export interface VariantComparison {
  shotId: string;
  variantA: ShotVariant;
  variantB: ShotVariant;
  aIsActive: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Initial State
// ═══════════════════════════════════════════════════════════════════

export function createInitialVariantState(): ShotVariantState {
  return { statuses: {}, variants: {}, activeVariantIds: {} };
}

// ═══════════════════════════════════════════════════════════════════
// Regenerate Payload Builder
// ═══════════════════════════════════════════════════════════════════

/**
 * 특정 shot만 재생성하기 위한 payload 조립.
 * 전체 sequence가 아닌 해당 shot + 최소 context만 포함.
 */
export function buildShotRegeneratePayload(
  sequence: EditableSequence,
  doc: StructuredSequenceDocument,
  shotId: string,
): ShotRegeneratePayload | null {
  const idx = sequence.shots.findIndex(s => s.shotId === shotId);
  if (idx === -1) return null;

  const shot = sequence.shots[idx];
  const prevShot = idx > 0 ? sequence.shots[idx - 1] : undefined;
  const nextShot = idx < sequence.shots.length - 1 ? sequence.shots[idx + 1] : undefined;

  return {
    shot: { ...shot },
    sequenceContext: {
      sequenceId: sequence.sequenceId,
      cutNumber: sequence.cutNumber,
      sceneType: sequence.sceneType,
      durationSec: shot.endSec - shot.startSec,
      styleProfile: doc.styleProfile,
      continuity: doc.continuity,
      physicsRules: doc.physicsRules,
      placeIdentityAnchors: sequence.placeIdentityAnchors,
    },
    previousShot: prevShot ? {
      shotId: prevShot.shotId,
      subject: prevShot.subject,
      action: prevShot.action,
      camera: { ...prevShot.camera },
      endSec: prevShot.endSec,
    } : undefined,
    nextShot: nextShot ? {
      shotId: nextShot.shotId,
      subject: nextShot.subject,
      action: nextShot.action,
      camera: { ...nextShot.camera },
      startSec: nextShot.startSec,
    } : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Variant CRUD
// ═══════════════════════════════════════════════════════════════════

let variantCounter = 0;

export function generateVariantId(): string {
  variantCounter++;
  return `var_${Date.now().toString(36)}_${variantCounter}`;
}

/**
 * shot의 regenerate 상태를 변경.
 */
export function setShotStatus(
  state: ShotVariantState,
  shotId: string,
  status: ShotRegenerateStatus,
): ShotVariantState {
  return {
    ...state,
    statuses: { ...state.statuses, [shotId]: status },
  };
}

/**
 * 새 variant를 해당 shot에 추가.
 */
export function attachShotVariant(
  state: ShotVariantState,
  shotId: string,
  variant: ShotVariant,
): ShotVariantState {
  const existing = state.variants[shotId] ?? [];
  return {
    ...state,
    variants: {
      ...state.variants,
      [shotId]: [...existing, variant],
    },
  };
}

/**
 * 특정 variant를 활성으로 설정 (채택).
 */
export function setActiveShotVariant(
  state: ShotVariantState,
  shotId: string,
  variantId: string,
): ShotVariantState {
  const variants = state.variants[shotId] ?? [];
  if (!variants.find(v => v.variantId === variantId)) return state;

  return {
    ...state,
    activeVariantIds: { ...state.activeVariantIds, [shotId]: variantId },
  };
}

/**
 * variant 상태 갱신 (status, videoUrl 등).
 */
export function updateShotVariant(
  state: ShotVariantState,
  shotId: string,
  variantId: string,
  updates: Partial<ShotVariant>,
): ShotVariantState {
  const variants = state.variants[shotId] ?? [];
  return {
    ...state,
    variants: {
      ...state.variants,
      [shotId]: variants.map(v =>
        v.variantId === variantId ? { ...v, ...updates } : v,
      ),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Getters
// ═══════════════════════════════════════════════════════════════════

/**
 * 특정 shot의 variants 목록 반환.
 */
export function getShotVariants(
  state: ShotVariantState,
  shotId: string,
): ShotVariant[] {
  return state.variants[shotId] ?? [];
}

/**
 * 특정 shot의 활성 variantId 반환.
 */
export function getActiveShotVariantId(
  state: ShotVariantState,
  shotId: string,
): string | null {
  return state.activeVariantIds[shotId] ?? null;
}

/**
 * 특정 shot의 regenerate 상태 반환.
 */
export function getShotStatus(
  state: ShotVariantState,
  shotId: string,
): ShotRegenerateStatus {
  return state.statuses[shotId] ?? "idle";
}

// ═══════════════════════════════════════════════════════════════════
// Comparison
// ═══════════════════════════════════════════════════════════════════

/**
 * 두 variant를 비교 구조로 반환.
 */
export function compareShotVariants(
  state: ShotVariantState,
  shotId: string,
  variantIdA: string,
  variantIdB: string,
): VariantComparison | null {
  const variants = state.variants[shotId] ?? [];
  const a = variants.find(v => v.variantId === variantIdA);
  const b = variants.find(v => v.variantId === variantIdB);
  if (!a || !b) return null;

  const activeId = state.activeVariantIds[shotId];
  return {
    shotId,
    variantA: a,
    variantB: b,
    aIsActive: activeId === variantIdA,
  };
}

// ═══════════════════════════════════════════════════════════════════
// StructuredSequence → Variant payload 변환
// ═══════════════════════════════════════════════════════════════════

/**
 * ShotRegeneratePayload를 StructuredSequenceDocument 형식으로 변환.
 * 기존 generate-video API가 structuredSequence를 기대하므로,
 * 단일 shot을 포함하는 minimal document를 생성.
 */
export function payloadToStructuredSequence(
  payload: ShotRegeneratePayload,
  originalDoc: StructuredSequenceDocument,
): StructuredSequenceDocument {
  const shot = payload.shot;
  const ctx = payload.sequenceContext;

  // 원본 doc를 deep copy하고 shots[]를 대상 shot 1개로 교체
  const doc = JSON.parse(JSON.stringify(originalDoc)) as StructuredSequenceDocument;

  // durationSec를 해당 shot의 duration으로 맞춤
  doc.durationSec = ctx.durationSec;

  // shots[]를 단일 shot으로 교체
  doc.shots = [{
    shotId: shot.shotId,
    startSec: 0,
    endSec: ctx.durationSec,
    camera: { ...shot.camera },
    subject: shot.subject,
    action: shot.action,
    environment: shot.environment,
    moodLighting: shot.moodLighting,
    focus: shot.focus,
  }];

  // shotPlan도 해당 shot 정보로 덮어쓰기
  if (doc.shotPlan) {
    doc.shotPlan.shotId = shot.shotId;
    doc.shotPlan.startSec = 0;
    doc.shotPlan.endSec = ctx.durationSec;
    doc.shotPlan.camera = { ...shot.camera } as typeof doc.shotPlan.camera;
    if (doc.shotPlan.subject && typeof doc.shotPlan.subject === "object") {
      doc.shotPlan.subject.primary = shot.subject;
    }
    doc.shotPlan.action = shot.action;
    doc.shotPlan.environment = shot.environment;
    doc.shotPlan.moodLighting = shot.moodLighting;
  }

  // temporalBeats도 맞춤
  doc.temporalBeats = [{
    startSec: 0,
    endSec: ctx.durationSec,
    focus: shot.focus,
  }];

  // continuity context에 neighbor 정보 추가
  if (payload.previousShot && doc.continuity) {
    doc.continuity.mustPersist = [
      ...(doc.continuity.mustPersist || []),
      `continues from: ${payload.previousShot.subject} ${payload.previousShot.action}`,
    ];
  }

  return doc;
}
