/**
 * continuity.ts — Continuity-Preserving Generation 타입 정의
 *
 * 핵심 개념:
 *   여러 15초 클립을 하나의 연속된 영상처럼 생성하기 위한 타입 시스템.
 *   각 세그먼트가 독립 생성물이 아니라 하나의 긴 영상의 연속된 구간이 되도록
 *   글로벌 앵커, 세그먼트 상태, 전환 전략을 정의한다.
 *
 * 레이어 구조:
 *   continuity-policy.ts  → 규칙 정의 (what to enforce)
 *   continuity-planner.ts → 계획 수립 (how to plan)
 *   video-generation-core.ts → 순차 생성 (execute)
 *   useVideoGeneration.ts → UI 바인딩 (display)
 */

// ═══════════════════════════════════════════════════════════════════
// 1. Segment State — 각 세그먼트의 시작/종료 상태
// ═══════════════════════════════════════════════════════════════════

/** 세그먼트 경계의 구체적 상태 스냅샷 */
export interface SegmentState {
  /** 인물의 프레임 내 위치/자세 (예: "center-frame, facing right, mid-stride") */
  subjectPosition: string;
  /** 카메라 프레이밍/앵글/모션 (예: "MS, eye-level, slow dolly right") */
  cameraState: string;
  /** 감정 강도 0-100 */
  emotionIntensity: number;
  /** 감정 키워드 (예: "determined", "anxious") */
  emotionKeyword: string;
  /** 조명 상태 (예: "warm amber side-light from right") */
  lightingState: string;
  /** 동작 방향/속도 (예: "walking right, moderate pace") */
  motionVector: string;
  /** 배경 상태 (예: "urban street, sunset") */
  environmentState: string;
}

/** SegmentState의 빈 기본값 */
export const EMPTY_SEGMENT_STATE: SegmentState = {
  subjectPosition: "",
  cameraState: "",
  emotionIntensity: 0,
  emotionKeyword: "",
  lightingState: "",
  motionVector: "",
  environmentState: "",
};

// ═══════════════════════════════════════════════════════════════════
// 2. Global Continuity Anchors — 전체 시퀀스 관통 앵커
// ═══════════════════════════════════════════════════════════════════

/** 인물 앵커 — 전 세그먼트에서 동일 인물 유지 */
export interface CharacterAnchor {
  /** 인물 외형 전체 묘사 (예: "20대 한국 남성, 검은 단발, 검정 터틀넥") */
  primarySubjectDescription: string;
  /** 의상 고정 문자열 (예: "black turtleneck, dark jeans, white sneakers") */
  clothingLock: string;
  /** Kling element_id (있으면) */
  faceRef?: string;
  /** 체형 (예: "slim, 175cm") */
  bodyType: string;
  /** 구별 특징 (예: ["scar on left cheek", "silver ring on right hand"]) */
  distinctiveFeatures: string[];
}

/** 시각 앵커 — 색감/조명/스타일 통일 */
export interface VisualAnchor {
  /** 색감 팔레트 (예: "desaturated teal and warm amber") */
  colorPalette: string;
  /** 조명 셋업 (예: "golden hour side-lighting, soft shadows") */
  lightingSetup: string;
  /** style-catalog ID */
  styleId: string;
  /** 필름 그레인 (예: "subtle 35mm grain" | "clean digital") */
  filmGrain: string;
  /** 대비 프로파일 (예: "high contrast, deep blacks") */
  contrastProfile: string;
}

/** 서사 앵커 — 감정선/긴장감의 전체 아크 */
export interface NarrativeAnchor {
  /** 전체 아크 (예: "calm → tension → crisis → resolution") */
  overallArc: string;
  /** 총 세그먼트 수 */
  totalSegments: number;
  /** 세그먼트별 감정 궤적 */
  emotionalTrajectory: EmotionalBeat[];
}

/** 세그먼트별 감정 비트 */
export interface EmotionalBeat {
  segmentIndex: number;
  startEmotion: string;
  endEmotion: string;
  tensionLevel: number; // 0-100
}

/** 모션 앵커 — 동작 방향/속도 연속성 */
export interface MotionAnchor {
  /** 지배적 이동 방향 (예: "left-to-right", "approaching-camera") */
  dominantDirection: string;
  /** 페이스 변화 (예: "gradual acceleration", "steady", "deceleration") */
  paceProgression: string;
  /** 카메라 문법 (예: "handheld-subtle", "smooth-dolly", "static-tripod") */
  cameraGrammar: string;
}

/** 전환 전략 — 세그먼트 경계 처리 규칙 */
export interface TransitionStrategy {
  /** 전환 방식 */
  strategy: "motion_carry" | "gaze_bridge" | "camera_continuation" | "match_action";
  /** 경계 겹침 설계 시간 (초). 프롬프트 수준에서 마지막 N초를 미완결 상태로 유지 */
  overlapSeconds: number;
  /** 경계 규칙 요약 */
  boundaryRule: string;
}

/** 전체 시퀀스를 관통하는 연속성 앵커 */
export interface GlobalContinuityAnchors {
  character: CharacterAnchor;
  visual: VisualAnchor;
  narrative: NarrativeAnchor;
  motion: MotionAnchor;
  transition: TransitionStrategy;
}

// ═══════════════════════════════════════════════════════════════════
// 3. Segment Plan — 세그먼트별 계획
// ═══════════════════════════════════════════════════════════════════

/** 세그먼트의 서사 역할 */
export type SegmentRole = "opening" | "building" | "climax" | "falling" | "closing";

/** carry-forward 정의 — 이전 세그먼트에서 넘겨받을 정보 */
export interface CarryForward {
  /** true면 이전 endState = 이 세그먼트 startState */
  fromPrevEndState: boolean;
  /** 고정할 필드 목록 (예: ["subjectPosition", "cameraState", "lightingState"]) */
  lockFields: (keyof SegmentState)[];
}

/** 세그먼트 끝 샷 제한 규칙 */
export interface SegmentEndingRule {
  /** 마지막 샷의 허용 role (마지막 세그먼트 제외 시 resolve 금지) */
  lastShotAllowedRoles: ("establish" | "develop" | "peak" | "insert" | "transition")[];
  /** 마지막 2초 행동 규칙 */
  lastSecondsRule: string;
}

/** 개별 세그먼트 계획 */
export interface ContinuitySegmentPlan {
  segmentIndex: number;
  role: SegmentRole;
  durationSec: number;
  startState: SegmentState;
  endState: SegmentState;
  carryForward: CarryForward;
  endingRule: SegmentEndingRule;
  /** 이 세그먼트가 시퀀스의 마지막인지 */
  isLastSegment: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// 4. Continuity Sequence Plan — 전체 계획
// ═══════════════════════════════════════════════════════════════════

/** continuity mode 전체 계획 */
export interface ContinuitySequencePlan {
  /** 계획 고유 ID */
  planId: string;
  /** 전체 영상 길이 (초) */
  totalDurationSec: number;
  /** 세그먼트당 길이 (초) */
  segmentDurationSec: number;
  /** 세그먼트 수 */
  segmentCount: number;
  /** 글로벌 앵커 */
  globalAnchors: GlobalContinuityAnchors;
  /** 세그먼트별 계획 */
  segments: ContinuitySegmentPlan[];
}

// ═══════════════════════════════════════════════════════════════════
// 5. Continuity Validation — 병합 전 검증
// ═══════════════════════════════════════════════════════════════════

/** 검증 규칙 ID */
export type ContinuityValidationRuleId =
  | "CONT-01" // 인물 일관성
  | "CONT-02" // 색감 일관성
  | "CONT-03" // 조명 일관성
  | "CONT-04" // 동작 방향 연속성
  | "CONT-05" // 감정 연속성
  | "CONT-06" // 카메라 점프 감지
  | "CONT-07"; // 완결 감지 (resolve role)

/** 검증 결과 severity */
export type ContinuityValidationSeverity = "pass" | "warning" | "error";

/** 개별 검증 결과 */
export interface ContinuityValidationResult {
  ruleId: ContinuityValidationRuleId;
  severity: ContinuityValidationSeverity;
  /** 경계 위치 (seg[from] → seg[to]) */
  boundaryFrom: number;
  boundaryTo: number;
  message: string;
  /** 자동 수정 가능 여부 */
  autoFixable: boolean;
  /** 수정 제안 */
  suggestion?: string;
}

/** 전체 검증 보고서 */
export interface ContinuityValidationReport {
  /** 전체 통과 여부 */
  pass: boolean;
  /** 경고 수 */
  warningCount: number;
  /** 에러 수 */
  errorCount: number;
  /** 개별 결과 */
  results: ContinuityValidationResult[];
  /** 재생성 추천 세그먼트 인덱스 */
  regenerateRecommended: number[];
}

// ═══════════════════════════════════════════════════════════════════
// 6. Continuity Generation Meta — 순차 생성 진행 상태
// ═══════════════════════════════════════════════════════════════════

/** 세그먼트 생성 상태 */
export type ContinuitySegmentStatus =
  | "pending"      // 대기 (이전 세그먼트 완료 후 시작)
  | "generating"   // 생성 중
  | "polling"      // polling 중
  | "completed"    // 완료 — endState 확정
  | "failed"       // 실패
  | "regenerating"; // 재생성 중

/** 개별 세그먼트 생성 진행 */
export interface ContinuitySegmentProgress {
  segmentIndex: number;
  status: ContinuitySegmentStatus;
  /** 생성 완료 시 확정된 endState (다음 세그먼트 입력으로 사용) */
  confirmedEndState?: SegmentState;
  /** taskId (polling용) */
  taskId?: string;
  /** 에러 메시지 */
  error?: string;
  /** 생성된 videoUri */
  videoUri?: string;
}

/** 전체 순차 생성 진행 상태 */
export interface ContinuityGenerationProgress {
  planId: string;
  totalSegments: number;
  currentSegmentIndex: number;
  segments: ContinuitySegmentProgress[];
  /** 전체 진행률 (0-100) */
  overallPercent: number;
  /** 검증 완료 여부 */
  validated: boolean;
  /** 검증 보고서 (validated=true일 때) */
  validationReport?: ContinuityValidationReport;
}
