// ===== 입력 타입 =====
export type Region = "한국" | "일본" | "중국" | "유럽" | "미국" | "인도" | "중동" | "동남아" | "중남미" | "아프리카" | "오세아니아";
/** 영상 스타일 ID — style-catalog.ts의 StyleEntry.id 참조 (string으로 확장) */
export type AnimationMode = string;
export type StyleFamily = "all" | "live_action" | "animation_2d" | "animation_3d" | "painting" | "stop_motion" | "retro_game" | "experimental";
export type Duration = 60 | 90 | 120 | 180 | 240 | 300 | "auto";
export type AspectRatio = "9:16" | "16:9";
/** 영상 해상도 (Kling 기준) */
export type VideoResolution = "720p" | "1080p" | "4k";
// 0 = 자동 (UI 전용, API에는 null/undefined로 변환)
// 1~15 = 명시값 (초 단위)
// 3~15초 — Kling API 지원 범위
export type ClipDuration = number;
export type PersonGeneration = "allow_all" | "allow_adult" | "dont_allow";

export interface SignatureTechniques {
  cameraWork?: string;
  colorPalette?: string;
  lighting?: string;
  editingStyle?: string;
  moodKeywords?: string;
}

export interface DirectorPersona {
  id: string;
  name: string;
  nameKo: string;
  region: Region;
  style: string;
  description: string;
  persona: string;
  signatureTechniques?: SignatureTechniques;
  notableWorks?: string[];
}

export interface PromptInput {
  storyText: string;
  directorPersona: string; // director id
  region: Region;
  animationMode: AnimationMode;
  duration: Duration;
  aspectRatio: AspectRatio;
  cutCount?: number; // 사용자 지정 장면 수 (없으면 자동 계산)
  cutDuration?: number; // 장면당 초 (3~15초 — Kling API 지원 범위)
  /** 선호 컷 수 범위 — exact cutCount보다 낮은 우선순위. density minimum이 hard floor. */
  preferredCutCountRange?: CutCountRange;
  customDirector?: DirectorPersona; // 웹 검색으로 추가된 커스텀 감독
  // 페르소나 시스템
  generationPersona?: GenerationPersona;      // 영상 생성 규칙 세트
  characterPersonas?: CharacterPersonaInput[]; // 캐릭터별 행동/감정 규칙
}

// ===== 컷 수 범위 =====

/** 사용자가 지정하는 편집 밀도 범위 (예: { min: 3, max: 5 }) */
export interface CutCountRange {
  min: number;
  max: number;
}

/** 편집 밀도 프리셋 ID */
export type EditingDensityPreset = "auto" | "sparse" | "normal" | "dense" | "custom";

/** 컷 수 결정 근거 메타데이터 — 서버 응답에 포함 */
export interface CutCountDecisionBasis {
  /** 최종 결정된 컷 수 */
  finalCutCount: number;
  /** 결정 근거 */
  source: "exact_cutCount" | "preferred_range" | "density_policy" | "persona_bias" | "fallback";
  /** 사용자가 제공한 원본 값 */
  requestedExact?: number;
  requestedRange?: CutCountRange;
  /** density minimum (hard floor) */
  densityMinimum: number;
  /** persona bias 방향 (범위 내에서의 선호) */
  personaBias?: "lower" | "upper" | "neutral";
  /** 경고/설명 */
  notes: string[];
}

// ===== 페르소나 시스템 =====

/**
 * 캐릭터 페르소나 — 각 캐릭터의 행동/감정/말투 규칙
 * characterSeeds.id와 매핑해 subjectAction 설계 기준으로 사용
 */
export interface CharacterPersonaInput {
  characterId: string;     // char-1 | char-2 | char-3
  personality: string;     // 성격 (예: "냉소적이지만 야망 있는 쇼맨")
  behaviorHabits: string;  // 행동 습관 (예: "말하기 전에 군중을 둘러봄")
  emotionStyle: string;    // 감정 표현 방식 (예: "불안을 퍼포먼스로 전환")
  speechStyle: string;     // 말투 (예: "짧고 선언적, 끝에 수사 의문문")
  gestureTraits: string;   // 몸짓 특징 (예: "팔을 넓게 벌림, 군중과 직접 눈 맞춤")
}

/**
 * 생성 페르소나 — 영상 생성 전체에 적용되는 금지/필수 규칙 세트
 * 단순 스타일 키워드보다 강하게 작동 — 모든 컷 프롬프트에 직접 주입
 */
export interface GenerationPersona {
  id: string;
  name: string;
  // ── 금지 규칙
  noSubtitles: boolean;        // 자막/캡션/화면 텍스트 금지
  noNarration: boolean;        // 나레이션/보이스오버 금지
  noLecturerChar: boolean;     // 강사/발표자/해설자 캐릭터 자동 생성 금지
  // ── 구도 규칙
  subjectFirst: boolean;       // 인물이 화면 주체, 배경은 지지 역할
  noBackgroundClutter: boolean; // 배경 장식/배너/문양 과다 금지
  // ── 연기/감정 규칙
  emotionAsAction: boolean;    // 감정은 반드시 구체적 신체 행동으로만 표현
  // ── 일관성 규칙
  noRepeatComposition: boolean; // 같은 구도/표정/감정 연속 반복 금지
}

/** 기본 GenerationPersona 프리셋 */
export const GENERATION_PERSONA_PRESETS: { id: string; name: string; desc: string; preset: GenerationPersona }[] = [
  {
    id: "dramatic_film",
    name: "극영화 모드",
    desc: "자막·나레이션·강사 금지, 감정은 행동으로",
    preset: {
      id: "dramatic_film", name: "극영화 모드",
      noSubtitles: true, noNarration: true, noLecturerChar: true,
      subjectFirst: true, noBackgroundClutter: true,
      emotionAsAction: true, noRepeatComposition: true,
    },
  },
  {
    id: "mz_shorts",
    name: "MZ 쇼츠 모드",
    desc: "자막·나레이션 허용, 강사 금지, 주인공 우선",
    preset: {
      id: "mz_shorts", name: "MZ 쇼츠 모드",
      noSubtitles: false, noNarration: false, noLecturerChar: true,
      subjectFirst: true, noBackgroundClutter: true,
      emotionAsAction: true, noRepeatComposition: true,
    },
  },
  {
    id: "free_mode",
    name: "자유 모드",
    desc: "모든 제약 해제",
    preset: {
      id: "free_mode", name: "자유 모드",
      noSubtitles: false, noNarration: false, noLecturerChar: false,
      subjectFirst: false, noBackgroundClutter: false,
      emotionAsAction: false, noRepeatComposition: false,
    },
  },
];

export const DEFAULT_GENERATION_PERSONA: GenerationPersona = GENERATION_PERSONA_PRESETS[0].preset;

// ===== Editorial Persona — 감독별 편집 운영 규칙 =====

/**
 * EditorialPersona — 감독별 편집 의사결정 규칙.
 * SignatureTechniques(시각 스타일)와 분리된 편집 운영 계층.
 * 컷 수, 컷 길이, 삽입 빈도, 모션 성향 등 편집 결정에 직접 영향.
 */
export interface EditorialPersona {
  /** 선호 컷 페이스: 컷당 초 범위 [min, max] */
  preferredCutPace: [number, number];
  /** 선호 커버리지: wide 중심인지 close-up 중심인지 */
  preferredCoverage: "wide-dominant" | "close-dominant" | "balanced" | "extreme-contrast";
  /** insert(디테일/오브젝트) 컷 삽입 빈도 */
  insertBias: "none" | "low" | "moderate" | "high";
  /** 카메라 모션 성향 */
  motionBias: "static" | "minimal" | "moderate" | "dynamic" | "frenetic";
  /** 구도 성향 */
  compositionBias: "centered" | "rule-of-thirds" | "symmetrical" | "dutch-angle" | "mixed";
  /** 전환 성향 */
  transitionBias: "hard-cut" | "dissolve" | "match-cut" | "jump-cut" | "mixed";
}

/** 기본(중립) editorial persona */
export const DEFAULT_EDITORIAL_PERSONA: EditorialPersona = {
  preferredCutPace: [3, 5],
  preferredCoverage: "balanced",
  insertBias: "moderate",
  motionBias: "moderate",
  compositionBias: "mixed",
  transitionBias: "hard-cut",
};

/** 편집 persona 프리셋 — 감독 스타일 키워드에서 매핑 */
export const EDITORIAL_PERSONA_PRESETS: Record<string, EditorialPersona> = {
  "gothic-macabre": {
    preferredCutPace: [3, 5],
    preferredCoverage: "extreme-contrast",
    insertBias: "high",
    motionBias: "minimal",
    compositionBias: "symmetrical",
    transitionBias: "dissolve",
  },
  "symmetrical-formalist": {
    preferredCutPace: [4, 6],
    preferredCoverage: "wide-dominant",
    insertBias: "low",
    motionBias: "static",
    compositionBias: "symmetrical",
    transitionBias: "hard-cut",
  },
  "propulsive-action": {
    preferredCutPace: [2, 4],
    preferredCoverage: "close-dominant",
    insertBias: "high",
    motionBias: "frenetic",
    compositionBias: "dutch-angle",
    transitionBias: "jump-cut",
  },
  "lyrical-atmospheric": {
    preferredCutPace: [4, 6],
    preferredCoverage: "wide-dominant",
    insertBias: "moderate",
    motionBias: "minimal",
    compositionBias: "rule-of-thirds",
    transitionBias: "dissolve",
  },
};

// ===== 캐릭터 시드 =====
export interface CharacterSeed {
  id: string;
  label: string;
  appearance: string;
  appearanceKo: string;
}

// ===== 출력 타입 =====
export interface MultiShotPrompt {
  index: number;
  prompt: string;
  duration: string; // 초 단위 문자열 (예: "5")
}

// ===== JSON 기반 영상 프롬프트 구조 =====
/** 구조화된 영상 프롬프트 — 내부 source-of-truth */
export interface VideoPromptJson {
  shotSize: string;           // ECU | CU | MCU | MS | MLS | LS | WS | OTS | POV
  cameraAngle: string;        // eye-level | low-angle | high-angle | dutch | overhead | POV
  cameraMovement: string;     // e.g. "slow push-in (tension builds)"
  subjectBlocking: string;    // e.g. "foreground center-frame"
  subjectAction: string;      // 구체적 신체 동작 ≤15w
  actionBeat: string;         // 망설임/중단/follow-through 포함
  bodySignal: string;         // hand/gaze/posture/breath (감정 라벨 금지)
  revealed: string;           // 이 프레임에서 새로 공개되는 시각 정보
  withheld: string;           // 프레임 밖에 보류되는 정보
  timingBeat: string;         // e.g. "0s-2s: start. 2s-5s: develop. 5s-8s: climax"
  transitionFromPrev: string; // 이전 장면과의 전환 대비
  characterRef: string;       // 캐릭터 외형 (절대 수정 금지)
  moodLighting: string;       // 조명/무드
  styleSuffix: string;        // 스타일 + no text/watermark
  // ── 즉시 인식 가능성 (Instant Readability) 3-pillar ──
  locationCue?: string;       // 장소 정체성 시각 단서 (예: "dental chair and overhead lamp")
  situationCue?: string;      // 상황 증거 시각 단서 (예: "empty waiting room, no patients")
  emotionalAnchor?: string;   // 감정/갈등 앵커 (예: "doctor slumps alone at desk")
}

/** Scene Extension용 프롬프트 JSON */
export interface ExtendPromptJson {
  prevSceneEnd: {
    shotType: string;
    subjectAction: string;
    bodySignal: string;
  };
  transition: string;
  newShot: {
    shotSize: string;
    cameraAngle: string;
    cameraMovement: string;
  };
  characterRef: string;
  newAction: string;
  behavioralShift: string;
  newlyRevealed: string;
  stillWithheld: string;
  timingBeat: string;
  styleSuffix: string;
}

/** 씬 타입 분류 (품질 평가 기준 선택에 사용) */
export type SceneType = "character" | "environment" | "object-detail" | "map-graphic" | "transition-abstract";

/** 구조 단위 분류 — cut/scene/sequence 중 어디에 해당하는지 (구조 힌트) */
export type StructureType = "cut" | "scene" | "sequence";

/** 길이 기반 분류 — duration으로 판단한 단위 성격 (soft rule) */
export type DurationClass = "cut-like" | "scene-like" | "sequence-like";

export interface Cut {
  cutNumber: number;
  durationSec: number;
  sceneDescription: string;
  cameraDirection: string;
  moodLighting: string;
  imagePrompt: string;
  endImagePrompt: string;
  videoPrompt: string;
  extendPrompt: string;
  transitionHint: string;
  characterConsistency: string;
  charactersInScene: string[];
  multiShot?: MultiShotPrompt[]; // Kling o3 멀티샷: 1장면 안 여러 카메라 구도 (durationSec >= 10 시 생성)
  // 씬 타입 분류
  shotCategory?: string;    // character-driven | environment | object-detail | map-graphic | transition-atmosphere
  characterRole?: string;   // protagonist | background | silhouette | partial | absent
  // JSON 기반 프롬프트 — string 필드와 공존 (점진적 마이그레이션)
  videoPromptJson?: VideoPromptJson;
  extendPromptJson?: ExtendPromptJson;
  // 구조 보조 메타 — cut/scene/sequence 분류
  /** 구조 단위 힌트 (cutCount 기반 등). 없으면 기본 "cut" */
  structureType?: StructureType;
  /** duration 기반 길이 분류 (soft rule). 없으면 미분류 */
  durationClass?: DurationClass;
  /** scene/sequence 그룹 ID — 같은 그룹에 속하는 cut끼리 공유 */
  groupId?: string;
}

/** Fallback 원인 분류 — 사용자에게 정확한 안내를 위해 */
export type FallbackCause =
  | "MAX_TOKENS"        // Gemini 응답이 토큰 한도로 잘림 (API 키 문제 아님)
  | "MISSING_API_KEY"   // 환경변수 미설정
  | "INVALID_API_KEY"   // 잘못된 API 키
  | "MODEL_NOT_FOUND"   // 모델 deprecated
  | "QUOTA_EXCEEDED"    // 할당량 초과
  | "RATE_LIMITED"      // 요청 속도 제한
  | "PARSE_ERROR"       // 응답 파싱 실패 (truncation 아닌)
  | "NETWORK_ERROR"     // 네트워크 오류
  | "UNKNOWN";          // 기타

export interface PromptOutput {
  projectTitle: string;
  conceptSummary: string;
  totalCuts: number;
  globalStylePrompt: string;
  directorPersonaPrompt: string;
  characterSeeds: CharacterSeed[];
  continuityRules: string[];
  cuts: Cut[];
  usedFallback?: boolean;
  fallbackReason?: string;
  /** 구조화된 실패 원인 분류 */
  fallbackCause?: FallbackCause;
  /** 시퀀스 플랜 — generate-cuts에서 구축, shot plan 구조 */
  sequencePlan?: import("@/lib/sequence-plan").SequencePlan;
  /** 시퀀스 검증 결과 */
  sequenceValidation?: import("@/lib/sequence-plan").SequenceValidationResult;
}

// ===== 채팅 타입 =====
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { title: string; url: string }[];
  searchQueries?: string[];
}

export interface PromptCard {
  title: string;
  hook: string;
  marketingTactic?: string; // 핵심 홍보 수단 한 줄 (예: "여성 전용 병원 포지셔닝")
  region?: string; // 지역/문화권 (예: "한국 (조선)", "중동 (이슬람 황금기)")
}

export interface StoryAIPersona {
  id: string;
  name: string;
  description: string;
  persona: string;
  samplePrompts: string[];
  sampleCards: PromptCard[];
}

// ===== 영상 생성 엔진 & 모드 =====
/** Video generation engine. Kling = primary generation engine. */
export type VideoEngine = "kling" | "auto";
export type VideoMode   = "generate" | "extend";

// ===== JSON-first 구조화된 시퀀스 문서 =====

/** 시퀀스 밀도 메타데이터 — valid=true 조건의 근거 */
export interface SequenceDensityScore {
  /** 전체 밀도 점수 (0-100) */
  total: number;
  /** 개별 밀도 항목 */
  breakdown: {
    hasPlaceAnchors: boolean;
    hasEvidence: boolean;
    hasTemporalBeats: boolean;
    hasCameraPlan: boolean;
    hasPhysicsRules: boolean;
    hasNaturalMotion: boolean;
    hasExplicitLight: boolean;
    hasContinuity: boolean;
  };
  /** 부족한 항목 */
  missing: string[];
}

/** 물리 법칙 규칙 — 장면별 시뮬레이션 제약 */
export interface PhysicsRules {
  /** 바람 존재 여부 */
  hasWind: boolean;
  /** 대기 존재 여부 */
  hasAtmosphere: boolean;
  /** 음향 환경 존재 여부 (no atmosphere → no audible environment) */
  hasAudibleEnvironment: boolean;
  /** 중력 유형 */
  gravity: "earth" | "low" | "zero" | "unknown";
  /** 깃발/천 모션 원인 (wind → pole vibration 등) */
  flagMotionSource?: string;
  /** 하늘 색상 제약 (lunar → pitch-black) */
  skyConstraint?: string;
  /** 광원 제약 (lunar → unfiltered direct sunlight) */
  lightConstraint?: string;
  /** 금지 표현 목록 (wind, haze 등) */
  bannedExpressions: string[];
  /** 물리 환경 식별자 */
  environmentType: "earth_outdoor" | "earth_indoor" | "lunar" | "space" | "underwater" | "unknown";
}

/** 스타일 프로필 */
export interface StyleProfile {
  mode: string;
  mediumLock?: string;
  colorAnchor?: string;
}

/** 연속성 추적 (이전/이후 컷과의 일관성) */
export interface SequenceDenseContinuity {
  lighting: string;
  sky?: string;
  surface?: string;
  scale?: string;
  characterRef?: string;
  mustPersist: string[];
}

/** 카메라 계획 */
export interface CameraPlan {
  baseFraming: string;
  angle: string;
  motion: string;
  motionMotivation?: string;
}

/** 시간 비트 */
export interface TemporalBeat {
  startSec: number;
  endSec: number;
  focus: string;
}

/**
 * StructuredSequenceDocument — JSON-first source of truth.
 * 전체 파이프라인에서 이 문서가 1순위로 전달되며,
 * string prompt는 string-only provider 전송 시에만 직렬화된다.
 *
 * v2: shot summary → dense sequence. minimum density 규칙 강제.
 *
 * 우선순위: structuredSequence > videoPromptJson > prompt
 */
export interface StructuredSequenceDocument {
  /** 시퀀스 고유 ID (sequenceId ≠ shotId) */
  sequenceId: string;
  /** 단일 shot에 대한 구조화 데이터 */
  shotId: string;
  cutNumber: number;

  // ── Dense Sequence Fields (v2) ─────────────────────────
  /** 장면 유형 (environment / character-driven / map-graphic 등) */
  sceneType: string;
  /** 총 생성 시간 (초) */
  durationSec: number;
  /** 스타일 프로필 */
  styleProfile: StyleProfile;
  /** 연속성 추적 */
  continuity: SequenceDenseContinuity;
  /** 물리 법칙 (lunar → no wind/no atmosphere) */
  physicsRules: PhysicsRules;
  /** 장소 정체성 앵커 (WHERE) — minimum 1 required for valid=true */
  placeIdentityAnchors: string[];
  /** 상황 증거 (WHAT) — minimum 1 required for valid=true */
  situationEvidence: string[];
  /** 자연 환경 모션 */
  naturalMotion: string[];
  /** 카메라 계획 */
  cameraPlan: CameraPlan;
  /** 시간 비트 — minimum 2 required for valid=true */
  temporalBeats: TemporalBeat[];
  /** 서술 밀도 점수 (검증용) */
  densityScore: SequenceDensityScore;
  /** Multi-shot 분할 결과 — sequence라면 2개 이상 */
  shots: Array<{
    shotId: string;
    startSec: number;
    endSec: number;
    camera: { framing: string; angle: string; motion: string };
    subject: string;
    action: string;
    environment: string;
    moodLighting: string;
    focus: string;
    narrationText?: string;
    narrationMode?: NarrationMode;
    // 구조 보조 메타 — cut/scene/sequence 분류
    structureType?: StructureType;
    durationClass?: DurationClass;
    groupId?: string;
  }>;

  // ── Legacy / Existing Fields ───────────────────────────
  /** SequencePlan의 ShotPlan과 1:1 매핑 */
  shotPlan: import("@/lib/sequence-plan").ShotPlan;
  /** 원본 VideoPromptJson (있으면) */
  videoPromptJson?: VideoPromptJson;
  /** negatives 수집 결과 */
  negatives?: {
    universal: string[];
    sceneSpecific: string[];
    failureMode: string[];
    user: string[];
  };
  /** 검증 결과 */
  validation?: {
    valid: boolean;
    errors: number;
    warnings: number;
    issues: Array<{ rule: string; severity: string; message: string }>;
  };
  /** 자동 수정 내역 */
  sanitizeFixes?: string[];
  /** 충돌 해결 내역 */
  conflictResolutions?: string[];

  // ── Audio / Narration (v3) ────────────────────────────
  /** shot별 나레이션 텍스트 (TTS 소스) — generate-cuts에서 sceneDescription 기반 생성 */
  narrationText?: string;
  /** 나레이션 모드: auto=sceneDescription fallback, manual=직접입력, mute=무음 */
  narrationMode?: NarrationMode;
}

// ===== Asset 상태 분리 =====
/**
 * AssetStatus — 영상 자산의 생명 주기 상태.
 * 생성 상태(VideoGenStatus)와 분리하여 자산 가용성을 독립 추적.
 *
 * GENERATED: 영상 생성 완료 (raw URI만 있음)
 * ASSET_STORED_INTERNAL: R2/GCS에 업로드 완료 (내부 접근 가능)
 * ASSET_STORED_PUBLIC: 공개 프록시 URI 발급 완료 (재생 가능)
 * SCENE_EXTENSION_READY: canonicalVideoUri 확보 → Scene Extension 가능
 * VISIBLE_IN_LIBRARY: MyVideosPanel에 노출 가능 상태
 */
export type AssetStatus =
  | "GENERATED"
  | "ASSET_STORED_INTERNAL"
  | "ASSET_STORED_PUBLIC"
  | "SCENE_EXTENSION_READY"
  | "VISIBLE_IN_LIBRARY";

// ===== Kling 영상 생성 설정 =====
export interface VideoGenerationConfig {
  engine: VideoEngine; // 사용할 엔진 (kling | auto)
  videoMode: VideoMode;        // generate: 독립 생성 | extend: 이전 영상 이어서
  mode: "fast";
  durationSeconds: ClipDuration;
  resolution: VideoResolution;
  aspectRatio: AspectRatio;
  generateAudio: boolean;
  negativePrompt: string;
  personGeneration: PersonGeneration;
  seed?: number;
  sampleCount: number; // 1~4 변형 생성
  // First/Last Frame
  firstFrameBase64?: string;
  lastFrameBase64?: string;
  // Reference Images (최대 3장)
  referenceImages: string[]; // base64 배열
  // Enhancement: Prompt intensity control (0-100)
  styleIntensity: number;
  // Enhancement: Auto-link storyboard as firstFrame
  autoLinkFirstFrame: boolean;
  // Enhancement: Auto-retry failed scenes
  autoRetryOnFailure: boolean;
  maxRetryCount: number;
  // Enhancement: Auto verify & refine prompts
  autoVerifyPrompts: boolean;
  autoEnglishRefine: boolean;
  // Animation mode: 영상 스타일
  animationMode?: string;
  // Cinematography: 선택된 촬영 용어들
  cinematography: CinematographySelection;
}

// ===== 시네마토그래피 용어 =====
export interface CinematographySelection {
  lighting: string[];     // 조명 기법
  composition: string[];  // 구도/프레이밍
  lens: string[];         // 렌즈 선택
  cameraMove: string[];   // 카메라 무빙
  countryStyle: string[]; // 국가별 연출 스타일
  colorGrade: string[];   // 색보정/톤
}

export const EMPTY_CINEMATOGRAPHY: CinematographySelection = {
  lighting: [],
  composition: [],
  lens: [],
  cameraMove: [],
  countryStyle: [],
  colorGrade: [],
};

export const DEFAULT_VIDEO_CONFIG: VideoGenerationConfig = {
  engine: "kling",            // ← Kling = primary generation engine
  videoMode: "extend",
  mode: "fast",
  durationSeconds: 6,
  resolution: "720p",
  aspectRatio: "16:9",
  generateAudio: true,
  animationMode: "tv-anime",
  negativePrompt: "text overlay, watermark, logo, blurry, distorted face, photorealistic",
  personGeneration: "allow_all",
  sampleCount: 1,
  referenceImages: [],
  styleIntensity: 50,
  autoLinkFirstFrame: true,
  autoRetryOnFailure: true,
  maxRetryCount: 2,
  autoVerifyPrompts: true,
  autoEnglishRefine: true,
  cinematography: { lighting: [], composition: [], lens: [], cameraMove: [], countryStyle: [], colorGrade: [] },
};

// ── Backward-compat aliases (deprecated) ──────────────────────────────────────
// 외부 소비자·플러그인 호환용. 내부 코드는 새 이름만 사용할 것.
// TODO: 다음 메이저 버전에서 아래 4개 alias 전부 삭제 예정.
/** @deprecated VideoResolution 사용. 다음 메이저 버전에서 삭제 예정. */
export type VeoResolution = VideoResolution;
/** @deprecated ClipDuration 사용. 다음 메이저 버전에서 삭제 예정. */
export type VeoClipDuration = ClipDuration;
/** @deprecated VideoGenerationConfig 사용. 다음 메이저 버전에서 삭제 예정. */
export type VeoGenerationConfig = VideoGenerationConfig;
/** @deprecated DEFAULT_VIDEO_CONFIG 사용. 다음 메이저 버전에서 삭제 예정. */
export const DEFAULT_VEO_CONFIG = DEFAULT_VIDEO_CONFIG;

// ===== Duration 추적 메타 =====
export interface DurationMeta {
  /** UI에서 사용자가 요청한 값 (slider 값, 0=auto) */
  requestedSecondsPerScene?: number;
  /** safeDuration 등으로 정규화된 값 (3-15) */
  normalizedSecondsPerScene: number;
  /** Kling API에 실제 전송된 값 (toKlingDuration 후) */
  sentSecondsPerScene?: number;
  /** 어디서 결정됐는지 */
  source: "slider" | "auto" | "api-response" | "fallback";
  /** 보정/클램핑 경고 */
  warnings: string[];
}

// ===== Audio / Narration =====

/** shot별 나레이션 모드 */
export type NarrationMode = "auto" | "manual" | "mute";

/** shot 단위 나레이션 dirty-state 추적 */
export interface ShotNarrationState {
  /** 현재 나레이션 모드 */
  mode: NarrationMode;
  /** 현재 편집 중인 나레이션 텍스트 */
  currentText: string;
  /** 마지막으로 오디오 생성에 사용된 텍스트 */
  lastGeneratedText: string;
  /** 현재 편집 상태와 생성된 오디오가 불일치하는지 */
  narrationDirty: boolean;
  /** 마지막 생성된 오디오 URL */
  lastGeneratedAudioUrl: string;
  /** 마지막 생성 시 sync 상태 */
  lastGeneratedSyncStatus: "exact" | "trimmed" | "padded" | "";
  /** 마지막 생성 시점 (ms timestamp) */
  lastGeneratedAt: number;
  /** 마지막 생성 시 사용된 모드 */
  lastGeneratedMode: NarrationMode;
}

/** 시퀀스 단위 나레이션 dirty-state 요약 */
export interface SequenceNarrationState {
  /** dirty 상태인 shot 수 */
  dirtyShotCount: number;
  /** 모든 shot이 오디오와 동기화되어 있는지 */
  allShotsInSync: boolean;
  /** 마지막 전체 생성 시 스냅샷 ID */
  lastGeneratedSnapshotId: string;
}

/** 배치 나레이션 재생성 진행 상태 */
export interface BatchNarrationRegenerationState {
  /** 배치 실행 중 여부 */
  isRunning: boolean;
  /** 대상 총 shot 수 */
  total: number;
  /** 완료된 shot 수 */
  completed: number;
  /** 실패한 shot 수 */
  failed: number;
  /** 현재 처리 중인 cutNumber */
  activeCutNumber: number | null;
  /** 실패한 shot의 cutNumber 목록 */
  failedCutNumbers: number[];
  /** 경고 메시지 */
  warnings: string[];
}

/** shot별 오디오 생성 상태 */
export type ShotAudioStatus = "idle" | "generating" | "completed" | "failed" | "muted";

/** 오디오 커버리지 메타 (전체 시퀀스 기준) */
export interface AudioCoverageMeta {
  /** 총 shot 수 */
  totalShots: number;
  /** 오디오 생성 성공 수 */
  successfulShots: number;
  /** 오디오 생성 실패 수 */
  failedShots: number;
  /** mute 처리된 수 */
  mutedShots: number;
  /** 커버리지 비율 (0-1) */
  coverage: number;
}

export interface NarrationTrack {
  /** 컷 번호 */
  cutNumber: number;
  /** R2 저장 URI (mp3) */
  audioUri: string;
  /** TTS에 사용된 원문 */
  text: string;
  /** 오디오 길이 (초) */
  durationSec: number;
  /** shot duration과의 sync 상태 */
  syncStatus: "exact" | "trimmed" | "padded";
  /** 생성 타임스탬프 */
  generatedAt: number;
}

export interface AudioMeta {
  /** 오디오가 최종 결과물에 포함되었는지 */
  audioIncluded: boolean;
  /** 생성된 오디오 트랙 목록 */
  audioTracks: NarrationTrack[];
  /** 나레이션 사용 여부 */
  narrationUsed: boolean;
  /** mux 방식: "muxed" = video+audio 합성, "separate" = 별도 에셋, "none" = 실패 */
  deliveryMode: "muxed" | "separate" | "none";
  /** 오디오 커버리지 메타 */
  audioCoverage?: AudioCoverageMeta;
  /** duration 산정 방식 */
  durationSource: "estimated" | "decoded";
  /** 오디오 생성 경고 */
  warnings: string[];
}

// ===== 영상 생성 상태 =====
export type VideoGenStatus = "idle" | "generating" | "polling" | "completed" | "failed";

export interface VideoVariant {
  videoUri: string;
  rawVideoUri?: string;
  seed?: string;
}

// ===== 샷 단위 Variant (시퀀스 타임라인 편집기용) =====

export type ShotRegenerateStatus = "idle" | "generating" | "success" | "failed";

export interface ShotVariant {
  variantId: string;
  shotId: string;
  status: ShotRegenerateStatus;
  createdAt: number;
  /** 생성된 영상 URL */
  videoUrl?: string;
  /** Kling task ID (폴링용) */
  operationName?: string;
  /** 품질 점수 (QA 결과) */
  qualityScore?: number;
  /** 생성에 사용된 prompt preview (디버그 전용) */
  sourcePromptPreview?: string;
  /** 에러 메시지 (실패 시) */
  error?: string;
  /** 생성 메타 정보 */
  generationMeta?: {
    engine: string;
    mode: string;
    durationSec: number;
    /** 이전/다음 shot context 포함 여부 */
    hasNeighborContext: boolean;
  };
}

export interface PromptVerification {
  overallScore: number;
  /** 감지된 씬 타입 */
  detectedSceneType?: SceneType;
  scores: {
    characterDescription: number;
    cameraMovement: number;
    actionSequence: number;
    lightingMood: number;
    videoCompatibility: number;
  };
  /** 씬 타입별 세부 점수 (0-10 각) — character 씬과 map 씬의 기준이 다름 */
  sceneTypeScores?: Record<string, number>;
  /** Gemini 원본 6축 점수 (0-10 각) */
  rawScores?: {
    promptMatch: number;       // 프롬프트 일치도
    visualQuality: number;     // 시각 품질
    faceQuality: number;       // 얼굴 품질
    motionCoherence: number;   // 모션 자연스러움
    styleConsistency: number;  // 스타일 일관성
    composition: number;       // 구도
  };
  issues: string[];
  suggestions: string[];
  improvedVideoPrompt?: string;
  improvedExtendPrompt?: string;
  scoringFailure?: boolean; // AI 응답 파싱 실패 — overallScore를 생성 차단 판단에 사용하지 말 것
}

export interface VideoClip {
  cutNumber: number;
  status: VideoGenStatus;
  operationName?: string;
  videoUri?: string;
  rawVideoUri?: string; // 원본 URI (Scene Extension용)
  canonicalVideoUri?: string; // 업로드 후 안정적 URI (gs:// 또는 https://) — Scene Extension 최우선
  lastFrameBase64?: string; // 완료 직후 캡처한 마지막 프레임 (다음 컷 continuity용)
  seed?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  trimStart?: number;
  trimEnd?: number;
  durationSec: number;
  variants?: VideoVariant[]; // sampleCount > 1일 때 여러 변형
  selectedVariant?: number; // 선택된 변형 인덱스
  retryCount?: number; // Enhancement: auto-retry tracking
  verification?: PromptVerification; // Enhancement: prompt quality score
  qualityChecklist?: { items: Array<{ id: string; label: string; passed: boolean; detail?: string }>; passCount: number; totalCount: number };
  /**
   * @deprecated DEBUG ONLY — source of truth는 structuredSequence.
   * 이 필드는 UI 디버그 미리보기 용도로만 존재.
   * ⛔ 생성 요청 body에 포함 금지.
   * ⛔ storage/history의 주 기록 필드로 사용 금지.
   * ⛔ source-of-truth 판단에 사용 금지.
   * provider가 string-only일 때 서버에서 마지막 순간에 직렬화한 결과의 preview일 뿐.
   */
  fallbackRenderedPrompt?: string;
  /**
   * @deprecated DEBUG ONLY — 이전 이름 호환용.
   * fallbackRenderedPrompt와 동일한 값. 생성/저장/전송 경로에서 절대 사용하지 말 것.
   */
  finalPrompt?: string;
  assembledDebug?: { // 프롬프트 조립 블록별 분해 (디버그용)
    styleBlock: string;
    consistencyBlock: string;
    cameraBlock: string;
    sceneBlock: string;
    reinforcementBlock: string;
    negativeBlock: string;
    isMapScene: boolean;
  };
  // 멀티 프로바이더
  engineUsed?: "kling";      // 실제 사용된 엔진 (kling = primary)
  modeUsed?: VideoMode;              // 실제 사용된 모드
  sourceVideo?: string;              // extend 모드의 소스 영상 URI / task_id
  // ── 업로드 상태 추적 ──
  uploadStatus?: "none" | "pending" | "success" | "failed" | "skipped";
  uploadStorage?: "r2" | "gcs" | "none";
  uploadError?: string;
  sceneExtensionEligible?: boolean;  // canonicalVideoUri가 있어서 다음 컷 Scene Extension 가능 여부
  // ── JSON-first asset 추적 ──
  assetStatus?: AssetStatus;         // 자산 생명 주기 상태 (생성 상태와 분리)
  /** JSON-first source of truth — 모든 생성/저장/디버그의 1급 데이터 */
  structuredSequence?: StructuredSequenceDocument;
  // ── Audio ──
  /** 나레이션 오디오 URI (R2) */
  narrationAudioUri?: string;
  /** 나레이션 오디오 생성 상태 */
  narrationStatus?: "idle" | "generating" | "completed" | "failed";
  /** 오디오 메타 */
  audioMeta?: AudioMeta;
}

// ===== AI 피드백 리뷰 =====
export interface CutFeedback {
  cutNumber: number;
  score: number; // 0-100
  issues: string[]; // 구체적 문제점
  suggestion: string; // 개선 제안
  needsRegeneration: boolean; // 재생성 필요 여부
  improvedPrompt?: string; // 개선된 프롬프트
}

export interface VideoReview {
  overallScore: number; // 0-100
  overallComment: string; // 전체 평가 한마디
  cutFeedbacks: CutFeedback[];
  status: "idle" | "reviewing" | "done" | "regenerating" | "complete";
  regeneratedCuts: number[]; // 재생성 완료된 컷 번호
}

export interface VideoGenerationState {
  clips: VideoClip[];
  isAutoMode: boolean;
  currentAutoIndex: number;
  config: VideoGenerationConfig;
  review?: VideoReview;
  /** 시퀀스 플랜 (generate-cuts에서 수신, 전체 shot 구조) */
  sequencePlan?: import("@/lib/sequence-plan").SequencePlan;
  /** 시퀀스 fidelity 평가 (전체 완료 후 계산) */
  sequenceFidelity?: import("@/lib/sequence-plan").SequenceFidelityResult;
}

// ===== Shot 3-way Comparison (original / autoFixed / finalSent) =====

/** 단일 필드 diff 결과 */
export interface FieldDiff {
  field: string;
  original: unknown;
  autoFixed: unknown;
  finalSent: unknown;
  /** 변경 단계: "autofix" | "server" | "both" | "none" */
  changedAt: "autofix" | "server" | "both" | "none";
}

/** 한 컷의 3-way comparison 결과 */
export interface ShotComparison {
  cutNumber: number;
  shotId: string;
  diffs: FieldDiff[];
  /** 변경된 필드만 필터링한 수 */
  changedCount: number;
  totalFields: number;
}

/** 생성 요청의 provenance (출처/추적) 메타 */
export interface CutProvenance {
  cutNumber: number;
  /** generate-cuts 응답 source: "gemini" | "deterministic_fallback" */
  source?: string;
  /** generate-cuts 응답 품질: "ok" | "degraded" */
  quality?: "ok" | "degraded";
  reason?: string;
  warnings?: string[];
  /** 실제 사용된 Kling 모델 */
  modelUsed?: string;
  /** generate-video 응답 modeUsed */
  modeUsed?: string;
  /** preflight QA score */
  qaScore?: number;
  /** autofix 적용 수 */
  autoFixCount?: number;
  /** sanitize fix 로그 */
  sanitizeFixes?: string[];
  /** conflict resolution 로그 */
  conflictResolutions?: string[];
  /** narration mode used for this shot */
  narrationMode?: NarrationMode;
  /** narration text source: "manual" | "sceneDescription" | "narrationText" */
  narrationSource?: string;
  /** narration sync status */
  narrationSyncStatus?: "exact" | "trimmed" | "padded";
  /** narration audio available */
  narrationAudioAvailable?: boolean;
}

/** 3-way snapshot 세트 (per cut) */
export interface ShotSnapshots {
  cutNumber: number;
  /** assembleFromJSON 직후, QA autofix 이전 */
  original?: StructuredSequenceDocument;
  /** applyQualityFixes 이후 */
  autoFixed?: StructuredSequenceDocument;
  /** API 전송 body에 포함된 최종 */
  finalSent?: StructuredSequenceDocument;
  provenance?: CutProvenance;
}

// ===== 캐릭터 얼굴 레퍼런스 =====
export interface CharacterFaceRef {
  characterId: string; // CharacterSeed.id와 매칭
  faceBase64: string; // 크롭된 얼굴 이미지
  sourceCutNumber: number; // 어느 장면에서 추출했는지
  boundingBox?: { x: number; y: number; width: number; height: number };
}

// ===== Kling Custom Element (캐릭터 일관성) =====
/**
 * KlingElementAsset — Kling Custom Element API로 생성된 reusable subject asset.
 *
 * CharacterFaceRef(얼굴 crop 이미지)와 완전 분리된 타입.
 * CharacterFaceRef = 소스 이미지 데이터
 * KlingElementAsset = Kling 서버에 등록된 reusable element (element_id 보유)
 *
 * 라이프사이클: pending → processing → completed → (사용 가능) | failed
 */
export type KlingElementStatus = "pending" | "processing" | "completed" | "failed";

export type KlingElementSourceType = "image_refer" | "video_refer";

export interface KlingElementAsset {
  /** CharacterSeed.id와 매칭 */
  characterId: string;
  /** Kling create element task ID */
  taskId: string;
  /** 완료 후 할당되는 element ID — video generation 시 element_list에 전달 */
  elementId: string | null;
  /** element 이름 (캐릭터 label 기반) */
  elementName: string;
  /** element 설명 (캐릭터 appearance 기반) */
  elementDescription: string;
  /** 생성 상태 */
  status: KlingElementStatus;
  /** 소스 타입 */
  sourceType: KlingElementSourceType;
  /** 에러 메시지 (실패 시) */
  error?: string;
  /** 생성 시작 시각 (ms) */
  createdAt: number;
  /** 완료 시각 (ms) */
  completedAt?: number;
}

// ===== 효과음 (SFX) =====
export interface SfxMatch {
  id: string;
  category: string; // "impact", "whoosh", "comedy", etc.
  label: string; // "빰! 등장 효과음"
  labelEn: string;
  audioUrl: string;
  duration: number; // seconds
  trending: boolean;
}

export interface SceneSfx {
  cutNumber: number;
  sfxMatches: SfxMatch[];
  timing?: string; // "장면 시작 시", "중간에", etc.
  reason: string; // AI가 왜 이 효과음을 매칭했는지
}

// ===== 고도화 타입 =====

// 캐릭터 일관성 검증
export interface CharacterConsistencyResult {
  characterId: string;
  consistencyScore: number; // 0-100
  issues: string[];
  cutComparisons: { cutA: number; cutB: number; similarity: number; differences: string[] }[];
}

// 색보정 일관성
export interface ColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  shadow: string;
  highlight: string;
  mood: string;
}

// 감정 곡선
export interface EmotionPoint {
  cutNumber: number;
  intensity: number; // 0-100
  emotion: "tension" | "release" | "joy" | "sadness" | "anger" | "surprise" | "calm" | "excitement";
}

// 날씨/시간대
export interface EnvironmentSetting {
  weather: "clear" | "rain" | "snow" | "fog" | "storm" | "cloudy" | "wind";
  timeOfDay: "dawn" | "morning" | "noon" | "afternoon" | "golden-hour" | "dusk" | "night" | "midnight";
  customDescription?: string;
}

// 유튜브 SEO
export interface YouTubeSEO {
  titles: string[];
  description: string;
  tags: string[];
  hashtags: string[];
  thumbnailPrompt: string;
  predictedCTR: number;
}

// 시청자 반응 예측
export interface ViewerPrediction {
  estimatedViews: string;
  engagementRate: number;
  retentionCurve: number[];
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
}

// 자막 스타일
export interface SubtitleStyle {
  id: string;
  nameKo: string;
  font: string;
  color: string;
  bgColor: string;
  animation: string;
  bestFor: string;
}

// 시리즈 연속성
export interface SeriesEpisode {
  id: string;
  title: string;
  episodeNumber: number;
  characterSeeds: CharacterSeed[];
  worldSetting: string;
  colorPalette?: ColorPalette;
  environmentSetting?: EnvironmentSetting;
  createdAt: number;
}

export interface SeriesProject {
  id: string;
  seriesTitle: string;
  episodes: SeriesEpisode[];
  sharedCharacters: CharacterSeed[];
  worldRules: string[];
}

// A/B 테스트
export interface ABTestVariant {
  id: string;
  label: string;
  directorId: string;
  directorName: string;
  cuts: Cut[];
  characterSeeds: CharacterSeed[];
  thumbnailBase64?: string;
  predictedCTR?: number;
}

// 모션 강도
export type MotionIntensity = 0 | 25 | 50 | 75 | 100;

// ===== 상태 타입 =====
export type GeneratorStatus = "idle" | "loading" | "success" | "error";

// ===== 시퀀스 플랜 (re-export) =====
export type {
  SequencePlan,
  SequenceGlobalIntent,
  SequenceContinuity,
  ShotPlan,
  ShotCamera,
  ShotSubject,
  SequenceValidationResult,
  SequenceValidationIssue,
  SequenceFidelityResult,
  FailureDiagnosis,
  SerializedSequence,
} from "@/lib/sequence-plan";

// ===== sequence-assembler re-export =====
export type {
  SingleShotDocument,
  ProviderCapability,
  AssembleFromJSONResult,
} from "@/lib/sequence-assembler";
