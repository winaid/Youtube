/**
 * script-analysis.ts — 대본 분석 결과 스키마
 *
 * 장문의 한국어 나레이션/대본을 릴 시퀀스 프로덕션 구조로 변환할 때의
 * 분석 결과 타입 정의.
 *
 * 계층 구조:
 *   ScriptAnalysisResult
 *     └── AnalyzedSequence[]          (8초 VEO 생성 단위)
 *           └── AnalyzedCut[]         (시퀀스 내 컷 프로그레션)
 *
 * 기존 3-layer 모델과의 관계:
 *   Layer 1: totalSuggestedRuntime → 전체 요청 런타임
 *   Layer 2: sequences[] → 시퀀스 분할 (8초 VEO 생성 단위)
 *   Layer 3: cuts[] → 시퀀스 내 멀티샷 프로그레션
 *
 * 참고: 내부 플래닝/리듬 분석에서는 3~15초 범위를 참조할 수 있으나,
 *       실제 생성 요청은 항상 8초 고정.
 */

import type { ShotRole } from "./index";

// ═══════════════════════════════════════════════════════════════════
// Top-Level Analysis Result
// ═══════════════════════════════════════════════════════════════════

export interface ScriptAnalysisResult {
  /** 원본 대본 요약 (1-2문장, 핵심 주제) */
  sourceSummary: string;
  /** 가장 강력한 훅 — 시청 중단을 막는 첫 문장/논점 */
  mainHook: string;
  /** 대본의 핵심 논제/주장 */
  thesis: string;
  /** 추천 총 런타임 (초) */
  totalSuggestedRuntime: number;
  /** 추천 시퀀스 수 */
  suggestedSequenceCount: number;
  /** 구조 분석 노트 — 잘 된 점 */
  structuralNotes: string[];
  /** 구조 약점 — 개선 필요한 점 */
  weaknesses: string[];
  /** 구조적 이슈 (코드+심각도 기반) */
  issues: ScriptAnalysisIssue[];
  /** 분석 신뢰도 */
  confidence: AnalysisConfidence;
  /** 시퀀스 계획 */
  sequences: AnalyzedSequence[];
  /** 컨텐츠 모드 (short-form vs youtube) */
  contentMode?: ContentMode;
}

/** 분석 신뢰도 */
export type AnalysisConfidence = "low" | "medium" | "high";

/** 구조적 이슈 */
export interface ScriptAnalysisIssue {
  /** 이슈 코드 */
  code: ScriptIssueCode;
  /** 심각도 */
  severity: "info" | "warning" | "error";
  /** 설명 */
  message: string;
  /** 개선 제안 */
  suggestion?: string;
}

export type ScriptIssueCode =
  | "weak_hook"
  | "too_dense"
  | "too_repetitive"
  | "too_abstract"
  | "sequence_overload"
  | "weak_payoff"
  | "unclear_boundary"
  | "single_beat_type"
  | "short_script"
  | "INCOMPLETE_ANALYSIS"
  | "EMPTY_CUTS";

// ═══════════════════════════════════════════════════════════════════
// Sequence-Level Analysis
// ═══════════════════════════════════════════════════════════════════

/** 시퀀스 역할 (릴 시리즈에서의 기능) */
export type SequenceBeatType =
  | "hook"          // 도발적 thesis — 스크롤 멈춤
  | "setup"         // 배경 설정 — 컨텍스트 제공
  | "mechanism"     // 핵심 메커니즘 설명 — 어떻게 작동하는가
  | "development"   // 논거 확장 — 지식 심화
  | "reveal"        // 충격적 정보 공개 — "wait, what?"
  | "consequence"   // 결과/영향 — 인과 관계
  | "escalation"    // 텐션 상승 — 점점 심각해짐
  | "paradox"       // 역설적 결론 — 기대 전복
  | "payoff"        // 최종 보상 — 감정적/논리적 클로징
  | "transition";   // 시점/주제 전환

/** 시퀀스 종료 방식 */
export type SequenceEndingMode =
  | "close"         // 이 시퀀스 안에서 논점 완결
  | "cliffhanger"   // 다음 시퀀스가 궁금하게 끝남
  | "loop-open"     // 연결 고리만 열어두고 종료
  | "payoff"        // 시각적/감정적 보상으로 종료
  | "paradox"       // 역설적 뒤집기로 종료
  | "transition";   // 다음 주제로 자연 전환

export interface AnalyzedSequence {
  /** 시퀀스 ID (1-indexed) */
  id: number;
  /** 시퀀스 제목 (짧고 구체적) */
  title: string;
  /** 한 줄 목적 설명 */
  purpose: string;
  /** 릴 시리즈에서의 비트 타입 */
  beatType: SequenceBeatType;
  /** 이 시퀀스에 해당하는 원본 대본 텍스트 */
  sourceText: string;
  /** 원본 대본 내 위치 (char offset) */
  sourceSpan?: { startChar: number; endChar: number };
  /** 추천 duration (초). 내부 플래닝용 (실제 생성은 8초 고정). short-form: 8-15, youtube: 15-60 */
  recommendedDurationSec: number;
  /** 추천 내부 컷 수 (short-form: 2-6, youtube: 2-12) */
  recommendedCutCount: number;
  /** 이 시퀀스가 존재하는 이유 */
  rationale: string;
  /** 종료 방식 */
  endingMode: SequenceEndingMode;
  /** 클리프행어 종료 시 예고 텍스트 */
  cliffhangerText?: string;

  // ── Retention Logic ──
  /** 리텐션 전략 */
  retentionStrategy: RetentionStrategy;

  // ── Visual Strategy ──
  /** 시각적 전략 힌트 */
  visualStrategy: VisualStrategy;

  // ── Internal Cuts ──
  /** 컷 프로그레션 계획 */
  cuts: AnalyzedCut[];
}

// ═══════════════════════════════════════════════════════════════════
// Retention & Visual Strategy
// ═══════════════════════════════════════════════════════════════════

export interface RetentionStrategy {
  /** 이 시퀀스에서 호기심이 생성되는 지점 */
  curiosityPoint: string;
  /** 새로운 정보가 증가하는 지점 */
  informationGain: string;
  /** 텐션이 상승하는 지점 */
  escalation: string;
  /** 보상/해소가 발생하는 지점 */
  payoff: string;
}

export interface VisualStrategy {
  /** 주요 시각적 드라이버 */
  primaryDriver: "spectacle" | "emotion" | "reaction" | "concept-reveal" | "contrast" | "atmosphere";
  /** 최종 프레임 착지 방식 */
  finalFrameLanding: "payoff" | "reaction" | "unresolved-curiosity";
  /** 추천 전체 톤 */
  toneHint: string;
}

// ═══════════════════════════════════════════════════════════════════
// Cut-Level Analysis
// ═══════════════════════════════════════════════════════════════════

/** 컷의 시각적 포커스 타입 */
export type CutVisualFocus =
  | "environment"       // 환경/공간
  | "action"            // 행동/동작
  | "face"              // 얼굴/표정
  | "emotion"           // 감정 클로즈업
  | "aftermath"         // 결과/여파
  | "object-detail"     // 디테일/오브젝트
  | "contrast"          // 대비/전후비교
  | "spectacle"         // 스펙터클/대규모
  | "concept"           // 개념/추상
  | "concept-reveal"    // 개념 공개
  | "reaction";         // 반응

export interface AnalyzedCut {
  /** 컷 역할 (기존 ShotRole과 호환) */
  role: ShotRole;
  /** 시각적 포커스 */
  visualFocus: CutVisualFocus;
  /** 이전 컷 대비 변화 */
  changeFromPrevious: string;
  /** 서사적 기능 */
  narrativeFunction: string;
  /** 프롬프트 의도 힌트 (영상 생성 시 참고) */
  suggestedPromptIntent: string;
  /** 왜 시청자가 계속 볼까 */
  retentionReason: string;
}

// ═══════════════════════════════════════════════════════════════════
// API Types
// ═══════════════════════════════════════════════════════════════════

export interface ScriptAnalysisInput {
  /** 원본 대본 텍스트 (한국어) */
  sourceText: string;
  /** 목표 총 런타임 (초, optional — 없으면 자동 추정) */
  targetTotalRuntimeSec?: number;
  /** 선호 시퀀스 수 (optional) */
  preferredSequenceCount?: number;
  /** 시퀀스당 최소 duration (기본: 8) */
  targetSequenceDurationMinSec?: number;
  /** 시퀀스당 최대 duration (기본: 15) */
  targetSequenceDurationMaxSec?: number;
  /** 시퀀스당 최대 컷 수 (기본: 6) */
  maxCutsPerSequence?: number;
  /** 컨텐츠 타입 힌트 */
  contentTypeHint?: ScriptContentType;
}

export type ScriptContentType =
  | "history"            // 역사 해설
  | "economics"          // 경제 해설
  | "what-if"            // 가정법/반사실
  | "social-commentary"  // 사회 비평
  | "educational"        // 교육
  | "auto";              // 자동 감지

/**
 * Content mode determines planning strategy.
 *
 * short-form: 8-30초 총 런타임, 시퀀스/컷 단위 계획, 리텐션 압축 (생성 단위는 8초 고정)
 * youtube:    60-180초, 섹션 단위 계획, 논리적 전개, 나레이션 기반 타이밍
 */
export type ContentMode = "short-form" | "youtube";

export interface ContentModeConfig {
  mode: ContentMode;
  /** 섹션/시퀀스 당 최소 duration (초) */
  sectionMinSec: number;
  /** 섹션/시퀀스 당 최대 duration (초) */
  sectionMaxSec: number;
  /** 섹션/시퀀스 당 목표 duration (초) */
  sectionTargetSec: number;
  /** 전체 목표 duration 범위 */
  totalMinSec: number;
  totalMaxSec: number;
  /** 섹션 경계 결정 기준 — beat transition threshold */
  boundaryTransitionThreshold: number;
  /** 섹션당 최소 beat 수 (split 방지) */
  minBeatsPerSection: number;
}

export interface ScriptAnalysisResponse {
  success: boolean;
  analysis?: ScriptAnalysisResult;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Progressive Analysis Phases
// ═══════════════════════════════════════════════════════════════════

/** Analysis phase for progressive rendering */
export type AnalysisPhase =
  | "idle"
  | "structural"     // Phase A: beats, boundaries, skeleton sequences
  | "detailing"      // Phase B: per-sequence cut progression + strategies
  | "enriching"      // Phase C: LLM enhancement (optional)
  | "complete";

/** Per-sequence detail status */
export type SequenceDetailStatus = "skeleton" | "detailed";

/** Phase A result — structural skeleton with reusable intermediates */
export interface PhaseAResult {
  /** Structural analysis with skeleton sequences (no cuts, stub strategies) */
  result: ScriptAnalysisResult;
  /** Parsed beats (reusable in Phase B) */
  beats: import("@/lib/script-analyzer").ScriptBeat[];
  /** Sequence beat groups (reusable in Phase B) */
  sequenceGroups: import("@/lib/script-analyzer").ScriptBeat[][];
  /** Cache key for this script text */
  cacheKey: string;
}
