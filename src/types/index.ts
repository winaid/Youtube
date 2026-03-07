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
export type AspectRatio = "1:1" | "9:16" | "16:9";
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
}

export interface StoryAIPersona {
  id: string;
  name: string;
  description: string;
  persona: string;
  samplePrompts: string[];
  sampleCards: PromptCard[];
}

// ===== Veo 3.1 영상 생성 설정 =====
export interface VeoGenerationConfig {
  mode: "fast" | "quality";
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
}

export const DEFAULT_VEO_CONFIG: VeoGenerationConfig = {
  mode: "fast",
  durationSeconds: 8,
  resolution: "720p",
  aspectRatio: "9:16",
  generateAudio: true,
  negativePrompt: "text overlay, watermark, logo, blurry, distorted face",
  personGeneration: "allow_all",
  sampleCount: 1,
  referenceImages: [],
  styleIntensity: 50,
  autoLinkFirstFrame: true,
  autoRetryOnFailure: true,
  maxRetryCount: 2,
  autoVerifyPrompts: true,
  autoEnglishRefine: true,
};

// ===== 영상 생성 상태 =====
export type VideoGenStatus = "idle" | "generating" | "polling" | "completed" | "failed";

export interface VideoVariant {
  videoUri: string;
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
}

export interface VideoClip {
  cutNumber: number;
  status: VideoGenStatus;
  operationName?: string;
  videoUri?: string;
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
}

export interface VideoGenerationState {
  clips: VideoClip[];
  isAutoMode: boolean;
  currentAutoIndex: number;
  config: VeoGenerationConfig;
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

// ===== 상태 타입 =====
export type GeneratorStatus = "idle" | "loading" | "success" | "error";
