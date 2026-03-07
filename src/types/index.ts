// ===== 입력 타입 =====
export type Region = "한국" | "일본" | "중국" | "유럽" | "미국";
export type AnimationMode = "2D 애니" | "실사" | "하이브리드";
export type Duration = 60 | 90 | 120 | 150 | 180 | "auto";
export type AspectRatio = "1:1" | "9:16" | "16:9";

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
  cutCount?: number; // 사용자 지정 컷 수 (없으면 자동 계산)
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
}

export interface StoryAIPersona {
  id: string;
  name: string;
  description: string;
  persona: string;
  samplePrompts: string[];
}

// ===== 영상 생성 상태 =====
export type VideoGenStatus = "idle" | "generating" | "polling" | "completed" | "failed";

export interface VideoClip {
  cutNumber: number;
  status: VideoGenStatus;
  operationName?: string;
  videoUri?: string;
  seed?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  trimStart?: number; // 트림 시작 (초)
  trimEnd?: number;   // 트림 끝 (초)
  durationSec: number;
}

export interface VideoGenerationState {
  clips: VideoClip[];
  isAutoMode: boolean;
  currentAutoIndex: number;
}

// ===== 상태 타입 =====
export type GeneratorStatus = "idle" | "loading" | "success" | "error";
