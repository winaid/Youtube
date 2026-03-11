// ===== 입력 타입 =====
export type Region = "한국" | "일본" | "중국" | "유럽" | "미국" | "인도" | "중동" | "동남아" | "중남미" | "아프리카" | "오세아니아";
/** 영상 스타일 ID — style-catalog.ts의 StyleEntry.id 참조 (string으로 확장) */
export type AnimationMode = string;
export type StyleFamily = "all" | "live_action" | "animation_2d" | "animation_3d" | "painting" | "stop_motion" | "retro_game" | "experimental";
export type Duration = 60 | 90 | 120 | "auto";
export type AspectRatio = "9:16" | "16:9";
export type VeoResolution = "720p" | "1080p" | "4k";
// 4 | 6 | 8 → Veo + Kling 모두 가능
// 10 | 15   → Kling 전용 (Veo 미지원)
export type VeoClipDuration = 4 | 6 | 8 | 10 | 15;
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
  cutDuration?: number; // 장면당 초 (4|6|8 → Veo+Kling, 10|15 → Kling 전용)
  customDirector?: DirectorPersona; // 웹 검색으로 추가된 커스텀 감독
  // 페르소나 시스템
  generationPersona?: GenerationPersona;      // 영상 생성 규칙 세트
  characterPersonas?: CharacterPersonaInput[]; // 캐릭터별 행동/감정 규칙
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
}

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
export type VideoEngine = "veo" | "kling" | "auto";
export type VideoMode   = "generate" | "extend";

// ===== Veo 3.1 영상 생성 설정 =====
export interface VeoGenerationConfig {
  engine: VideoEngine;         // 사용할 엔진 (veo | kling | auto)
  videoMode: VideoMode;        // generate: 독립 생성 | extend: 이전 영상 이어서
  mode: "fast";
  durationSeconds: VeoClipDuration;
  resolution: VeoResolution;
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

export const DEFAULT_VEO_CONFIG: VeoGenerationConfig = {
  engine: "veo",
  videoMode: "extend",
  mode: "fast",
  durationSeconds: 6,
  resolution: "720p",
  aspectRatio: "16:9",
  generateAudio: true,
  animationMode: "tv-anime",
  // "live action, real footage"는 global negative에서 제외:
  // 로토스코핑은 실사 퍼포먼스 기반 움직임이 핵심 — 스타일별 STYLE_NEGATIVE_OVERRIDES에서 처리
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

// ===== 영상 생성 상태 =====
export type VideoGenStatus = "idle" | "generating" | "polling" | "completed" | "failed";

export interface VideoVariant {
  videoUri: string;
  rawVideoUri?: string;
  seed?: string;
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
    veoCompatibility: number;
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
  rawVideoUri?: string; // Veo 원본 URI (Scene Extension용)
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
  finalPrompt?: string; // 실제 API에 전송된 최종 merged prompt (디버그용)
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
  engineUsed?: "veo" | "kling";      // 실제 사용된 엔진
  modeUsed?: VideoMode;              // 실제 사용된 모드
  sourceVideo?: string;              // extend 모드의 소스 영상 URI / task_id
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
  config: VeoGenerationConfig;
  review?: VideoReview;
  /** 시퀀스 플랜 (generate-cuts에서 수신, 전체 shot 구조) */
  sequencePlan?: import("@/lib/sequence-plan").SequencePlan;
  /** 시퀀스 fidelity 평가 (전체 완료 후 계산) */
  sequenceFidelity?: import("@/lib/sequence-plan").SequenceFidelityResult;
}

// ===== 캐릭터 얼굴 레퍼런스 =====
export interface CharacterFaceRef {
  characterId: string; // CharacterSeed.id와 매칭
  faceBase64: string; // 크롭된 얼굴 이미지
  sourceCutNumber: number; // 어느 장면에서 추출했는지
  boundingBox?: { x: number; y: number; width: number; height: number };
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
