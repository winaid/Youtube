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
