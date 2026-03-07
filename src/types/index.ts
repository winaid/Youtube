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
}

export interface PromptOutput {
  projectTitle: string;
  conceptSummary: string;
  totalCuts: number;
  globalStylePrompt: string;
  directorPersonaPrompt: string;
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

// ===== 상태 타입 =====
export type GeneratorStatus = "idle" | "loading" | "success" | "error";
