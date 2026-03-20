/**
 * palette-helpers.ts — NodePalette 탭용 헬퍼
 *
 * 캔버스 에셋, 비디오 히스토리, 프롬프트 히스토리를 수집하는 유틸.
 */

import type { CanvasNode } from "@/lib/node-types";
import type { VideoRecord } from "@/lib/video-history";
import type { PromptHistoryEntry } from "@/lib/prompt-history";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type PaletteTab = "addNode" | "assets" | "history";

export interface AssetItem {
  id: string;
  url: string;
  mimeType: string;
  source: "canvas" | "history";
  label: string;
}

export interface PromptChainMeta {
  aspectRatio?: string;
  durationSec?: number;
  animationMode?: string;
}

export interface PromptItem {
  id: string;
  fullText: string;
  preview: string;
  createdAt: number;
  directorPersona?: string;
  chainMeta?: PromptChainMeta;
}

// ═══════════════════════════════════════════════════════════════════
// Collectors
// ═══════════════════════════════════════════════════════════════════

const PREVIEW_MAX = 57;

export function collectCanvasAssets(nodes: CanvasNode[]): AssetItem[] {
  return nodes
    .filter(n => n.outputAsset && n.outputMimeType)
    .map(n => ({
      id: `canvas-${n.id}`,
      url: n.outputAsset!,
      mimeType: n.outputMimeType!,
      source: "canvas" as const,
      label: n.label,
    }));
}

export function collectVideoAssets(records: VideoRecord[]): AssetItem[] {
  return records
    .filter(r => r.status === "completed" && r.proxyUri)
    .map(r => ({
      id: `video-${r.id}`,
      url: r.proxyUri,
      mimeType: "video",
      source: "history" as const,
      label: r.prompt.length > 37 ? r.prompt.slice(0, 37) + "..." : r.prompt,
    }));
}

export function collectPromptItems(entries: PromptHistoryEntry[]): PromptItem[] {
  return entries
    .filter(e => {
      if (!e.input) return false;
      const text = (e.input as Record<string, unknown>).storyText as string | undefined;
      return text && text.trim().length > 0;
    })
    .map(e => {
      const input = e.input as Record<string, unknown>;
      const fullText = input.storyText as string;
      const directorPersona = (input.directorPersona as string) || undefined;
      const chainMeta = extractChainMeta(input as never);

      return {
        id: `prompt-${e.id}`,
        fullText,
        preview: fullText.length > PREVIEW_MAX ? fullText.slice(0, PREVIEW_MAX) + "..." : fullText,
        createdAt: e.createdAt,
        directorPersona: directorPersona || undefined,
        chainMeta,
      };
    });
}

// ═══════════════════════════════════════════════════════════════════
// Chain meta extraction
// ═══════════════════════════════════════════════════════════════════

export function extractChainMeta(
  input: { aspectRatio?: string; cutDuration?: number; animationMode?: string } | null,
): PromptChainMeta | undefined {
  if (!input) return undefined;

  const meta: PromptChainMeta = {};
  let hasField = false;

  if (input.aspectRatio) {
    meta.aspectRatio = input.aspectRatio;
    hasField = true;
  }
  if (input.cutDuration && input.cutDuration > 0) {
    meta.durationSec = input.cutDuration;
    hasField = true;
  }
  if (input.animationMode && input.animationMode.trim()) {
    meta.animationMode = input.animationMode;
    hasField = true;
  }

  return hasField ? meta : undefined;
}
