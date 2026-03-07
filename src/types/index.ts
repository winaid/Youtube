// ===== 입력 타입 =====
export type Region = "한국" | "일본" | "중국" | "유럽" | "미국" | "인도" | "중동" | "동남아" | "중남미" | "아프리카" | "오세아니아";
export type AnimationMode = "2D 애니" | "실사" | "하이브리드";
export type Duration = 60 | 90 | 120 | 150 | 180 | "auto";
export type AspectRatio = "1:1" | "9:16" | "16:9";
export type VeoResolution = "720p" | "1080p" | "4k";
export type VeoClipDuration = 4 | 6 | 8;
export type PersonGeneration = "allow_all" | "allow_adult" | "dont_allow";

export interface DirectorPersona {
  id: string;
  name: string;
  nameKo: string;
  region: Region;
  style: string;
  description: string;
  persona: string;
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

export interface StoryAIPersona {
  id: string;
  name: string;
  description: string;
  persona: string;
  samplePrompts: string[];
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
};

// ===== 영상 생성 상태 =====
export type VideoGenStatus = "idle" | "generating" | "polling" | "completed" | "failed";

export interface VideoVariant {
  videoUri: string;
  seed?: string;
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
}

export interface VideoGenerationState {
  clips: VideoClip[];
  isAutoMode: boolean;
  currentAutoIndex: number;
  config: VeoGenerationConfig;
}

// ===== 상태 타입 =====
export type GeneratorStatus = "idle" | "loading" | "success" | "error";
