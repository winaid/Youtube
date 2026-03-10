// ===== 입력 타입 =====
export type Region = "한국" | "일본" | "중국" | "유럽" | "미국" | "인도" | "중동" | "동남아" | "중남미" | "아프리카" | "오세아니아";
export type AnimationMode =
  | "2D 애니"
  | "실사"
  | "하이브리드"
  | "수채화 애니"
  | "로토스코핑"
  | "스톱모션"
  | "픽셀아트"
  | "잉크워시"
  | "클레이"
  | "빈티지 필름"
  | "네온 사이버펑크"
  | "미니어처";
export type Duration = 60 | 90 | 120 | 150 | 180 | "auto";
export type AspectRatio = "9:16" | "16:9";
export type VeoResolution = "720p" | "1080p" | "4k";
export type VeoClipDuration = 4 | 6 | 8;
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
  cutDuration?: number; // 장면당 초 (4 | 6 | 8, 기본 8)
  customDirector?: DirectorPersona; // 웹 검색으로 추가된 커스텀 감독
}

// ===== 캐릭터 시드 =====
export interface CharacterSeed {
  id: string;
  label: string;
  appearance: string;
  appearanceKo: string;
}

// ===== 출력 타입 =====
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
  animationMode: "2D 애니",
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
  scores: {
    characterDescription: number;
    cameraMovement: number;
    actionSequence: number;
    lightingMood: number;
    veoCompatibility: number;
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
