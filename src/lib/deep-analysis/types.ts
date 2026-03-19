/**
 * deep-analysis/types.ts — Deep Analysis standard-lite 타입
 *
 * 원칙: 프롬프트 주입용 compact form. 값 공간 좁게. 장문 금지.
 */

// ═══════════════════════════════════════════════════════════════════
// 1. Story Intent
// ═══════════════════════════════════════════════════════════════════

export type Tone = "serious" | "playful" | "dark" | "warm" | "neutral" | "satirical";
export type Pacing = "slow" | "moderate" | "fast" | "accelerating" | "decelerating";
export type Genre = "drama" | "horror" | "comedy" | "documentary" | "action" | "romance" | "thriller" | "historical" | "fantasy" | "general";

export interface StoryIntentAnalysis {
  tone: Tone;
  pacing: Pacing;
  genre: Genre;
  /** 전체 감정 아크 (예: "calm → tension → release") */
  emotionalArc: string;
  /** 주인공 중심도: high면 인물 클로즈업 위주, low면 환경/상황 위주 */
  protagonistFocus: "high" | "medium" | "low";
  /** 핵심 시각 모티프 (최대 3개, 짧은 영어 구) */
  keyMotifs: string[];
}

// ═══════════════════════════════════════════════════════════════════
// 2. Generation Risk
// ═══════════════════════════════════════════════════════════════════

export type RiskLevel = "low" | "medium" | "high";

export interface GenerationRiskAnalysis {
  /** 컷 간 연속성 깨질 위험 */
  continuityRisk: RiskLevel;
  /** 인물이 너무 많아 혼란 위험 */
  subjectCountRisk: RiskLevel;
  /** 장면 전환이 너무 잦아 점프컷 위험 */
  sceneSwitchRisk: RiskLevel;
  /** 복잡한 동작 지시로 생성 실패 위험 */
  motionComplexityRisk: RiskLevel;
  /** 프롬프트가 너무 길거나 모호해질 위험 */
  promptOverloadRisk: RiskLevel;
  /** 시각적으로 모호한 장면이 많을 위험 */
  visualAmbiguityRisk: RiskLevel;
  /** 완화 힌트 (최대 3줄) */
  mitigationNotes: string[];
}

// ═══════════════════════════════════════════════════════════════════
// 3. Visual Strategy Lite
// ═══════════════════════════════════════════════════════════════════

export type DensityLevel = "sparse" | "moderate" | "dense";
export type EnergyLevel = "calm" | "moderate" | "dynamic";

export interface VisualStrategyLite {
  /** 화면 정보 밀도 */
  visualDensity: DensityLevel;
  /** 카메라 에너지 */
  cameraEnergy: EnergyLevel;
  /** 사실주의 수준 0-100 */
  realismLevel: number;
  /** 양식화 수준 0-100 (realism + stylization ≈ 100) */
  stylizationLevel: number;
  /** 인물 우선도 */
  characterPriority: "high" | "medium" | "low";
  /** 배경/환경 우선도 */
  environmentPriority: "high" | "medium" | "low";
}

// ═══════════════════════════════════════════════════════════════════
// 4. Prompt Brief — generate-cuts 주입용
// ═══════════════════════════════════════════════════════════════════

export interface PromptBrief {
  /** 핵심 창작 방향 1줄 (예: "dark historical drama, protagonist-driven, slow escalation") */
  creativeBrief: string;
  /** 연속성 유지 힌트 (예: "maintain consistent lighting and subject appearance across cuts") */
  continuityHint: string;
  /** 샷 절제 규칙 (예: "max 2 subjects per cut, avoid crowded compositions") */
  shotDiscipline: string;
  /** 인물 고정 힌트 (예: "lock primary subject appearance throughout") */
  subjectLockHint: string;
  /** 배경 고정 힌트 (예: "keep environment consistent within scene groups") */
  environmentLockHint: string;
  /** 금지 목록 (짧은 구, 최대 5개) */
  avoidList: string[];
}

// ═══════════════════════════════════════════════════════════════════
// 5. Orchestrator Result
// ═══════════════════════════════════════════════════════════════════

export interface DeepAnalysisOptions {
  /** 스토리 텍스트 */
  storyText: string;
  /** 총 영상 길이 (초) */
  totalDurationSec: number;
  /** 컷 수 */
  cutCount: number;
  /** 애니메이션 모드/스타일 ID */
  animationMode?: string;
  /** 감독 스타일 키워드 */
  directorStyle?: string;
  /** continuity mode 활성 여부 */
  continuityMode?: boolean;
  /** 캐릭터 수 (characterSeeds 기준) */
  characterCount?: number;
}

export interface DeepAnalysisResult {
  storyIntent: StoryIntentAnalysis;
  generationRisk: GenerationRiskAnalysis;
  visualStrategy: VisualStrategyLite;
  promptBrief: PromptBrief;
  /** 분석 소요 시간 (ms) */
  analysisMs: number;
  /** 부분 실패 경고 */
  warnings: string[];
}
