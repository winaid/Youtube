/**
 * palette-helpers.ts — NodePalette 탭 데이터 수집 헬퍼
 *
 * 역할:
 *  - 캔버스 노드 outputAsset → AssetItem 변환
 *  - VideoRecord → AssetItem 변환
 *  - 순수 함수만 포함 (React/JSX 의존 없음)
 */

import type { CanvasNode } from "./node-types";
import type { VideoRecord } from "./video-history";
import type { PromptHistoryEntry } from "./prompt-history";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type PaletteTab = "addNode" | "assets" | "history";

export interface AssetItem {
  id: string;
  label: string;
  url: string;
  mimeType: "image" | "video";
  source: "canvas" | "history";
}

export interface PromptItem {
  id: string;
  /** preview용 짧은 텍스트 (최대 60자) */
  preview: string;
  /** TextInput에 삽입할 전체 텍스트 */
  fullText: string;
  createdAt: number;
  directorPersona?: string;
  /** 체인 생성 시 GenerateVideo에 반영할 메타 */
  chainMeta?: PromptChainMeta;
}

/** 체인 생성용 최소 메타 — GenerateVideo defaultData 위에 덮어쓸 값들 */
export interface PromptChainMeta {
  aspectRatio?: "9:16" | "16:9";
  durationSec?: number;
  animationMode?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/** 캔버스 노드에서 outputAsset이 있는 항목을 AssetItem으로 변환 */
export function collectCanvasAssets(nodes: CanvasNode[]): AssetItem[] {
  return nodes
    .filter(n => n.outputAsset && n.outputMimeType)
    .map(n => ({
      id: `canvas-${n.id}`,
      label: n.label,
      url: n.outputAsset!,
      mimeType: n.outputMimeType!,
      source: "canvas" as const,
    }));
}

/** PromptHistoryEntry.input에서 GenerateVideo용 체인 메타를 안전하게 추출 */
export function extractChainMeta(input: PromptHistoryEntry["input"]): PromptChainMeta | undefined {
  if (!input) return undefined;
  const meta: PromptChainMeta = {};

  // aspectRatio: "9:16" | "16:9" 만 허용
  if (input.aspectRatio === "9:16" || input.aspectRatio === "16:9") {
    meta.aspectRatio = input.aspectRatio;
  }

  // cutDuration: 장면당 초 (4|6|8|10|15) → durationSec
  if (typeof input.cutDuration === "number" && input.cutDuration > 0) {
    meta.durationSec = input.cutDuration;
  }

  // animationMode: 비어있지 않은 문자열
  if (typeof input.animationMode === "string" && input.animationMode.trim()) {
    meta.animationMode = input.animationMode;
  }

  // 실제 값이 하나도 없으면 undefined 반환
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** PromptHistoryEntry에서 유효한 storyText를 가진 항목을 PromptItem으로 변환 */
export function collectPromptItems(entries: PromptHistoryEntry[]): PromptItem[] {
  return entries
    .filter(e => e.input?.storyText?.trim())
    .map(e => ({
      id: `prompt-${e.id}`,
      preview: e.input.storyText.length > 60
        ? e.input.storyText.slice(0, 57) + "..."
        : e.input.storyText,
      fullText: e.input.storyText,
      createdAt: e.createdAt,
      directorPersona: e.input.directorPersona || undefined,
      chainMeta: extractChainMeta(e.input),
    }));
}

/** VideoRecord에서 재생 가능한 항목을 AssetItem으로 변환 */
export function collectVideoAssets(records: VideoRecord[]): AssetItem[] {
  return records
    .filter(r => r.status === "completed" && r.proxyUri)
    .map(r => ({
      id: `video-${r.id}`,
      label: r.prompt ? r.prompt.slice(0, 40) : `Video #${r.cutNumber}`,
      url: r.proxyUri,
      mimeType: "video" as const,
      source: "history" as const,
    }));
}
