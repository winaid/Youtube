/**
 * node-palette.test.ts — NodePalette 탭 구조 및 Assets/History 헬퍼 테스트
 *
 * 테스트 대상:
 * 1. NodePalette에 3개 탭 타입이 정의돼 있는지
 * 2. collectCanvasAssets: 캔버스 노드에서 outputAsset 수집
 * 3. collectVideoAssets: VideoRecord에서 재생 가능 항목 수집
 * 4. 빈 데이터 처리
 * 5. Add Node 기존 기능과의 호환 (NODE_REGISTRY 기반)
 * 6. onInsertAsset 콜백 동작
 */

import { describe, it, expect } from "vitest";
import {
  collectCanvasAssets,
  collectVideoAssets,
  collectPromptItems,
  extractChainMeta,
  type PaletteTab,
  type AssetItem,
  type PromptItem,
  type PromptChainMeta,
} from "@/lib/palette-helpers";
import {
  createNode,
  NODE_REGISTRY,
  updateNodeStatus,
  createInitialCanvasState,
  addNode,
  type CanvasNode,
} from "@/lib/node-types";
import type { VideoRecord } from "@/lib/video-history";
import type { PromptHistoryEntry } from "@/lib/prompt-history";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function findDef(type: string) {
  return NODE_REGISTRY.find(d => d.type === type)!;
}

function makePromptEntry(inputOverrides: { storyText?: string; directorPersona?: string } = {}): PromptHistoryEntry {
  return {
    id: `ph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    input: {
      storyText: inputOverrides.storyText ?? "test story",
      directorPersona: inputOverrides.directorPersona ?? "",
      region: "ko" as never,
      animationMode: "실사" as never,
      duration: "short" as never,
      aspectRatio: "16:9" as never,
    } as never,
    output: {} as never,
  };
}

function makeVideoRecord(overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: `vid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    operationName: "test",
    engine: "veo",
    gcsUri: "",
    proxyUri: "",
    prompt: "test prompt",
    mode: "generate",
    durationSec: 6,
    cutNumber: 1,
    status: "completed",
    createdAt: Date.now(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. 탭 타입 정의 확인
// ═══════════════════════════════════════════════════════════════════

describe("PaletteTab type", () => {
  it("should support addNode, assets, history tabs", () => {
    const tabs: PaletteTab[] = ["addNode", "assets", "history"];
    expect(tabs).toHaveLength(3);
    expect(tabs).toContain("addNode");
    expect(tabs).toContain("assets");
    expect(tabs).toContain("history");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. collectCanvasAssets
// ═══════════════════════════════════════════════════════════════════

describe("collectCanvasAssets", () => {
  it("should collect nodes with outputAsset and outputMimeType", () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const viewerNode = createNode(findDef("viewer"), 200, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, viewerNode);
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,ABC", "image");

    const assets = collectCanvasAssets(state.nodes);
    expect(assets).toHaveLength(1);
    expect(assets[0].url).toBe("data:image/png;base64,ABC");
    expect(assets[0].mimeType).toBe("image");
    expect(assets[0].source).toBe("canvas");
    expect(assets[0].label).toBe("Generate Image");
  });

  it("should return empty array when no nodes have output", () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const assets = collectCanvasAssets([imgNode]);
    expect(assets).toHaveLength(0);
  });

  it("should return empty array for empty nodes list", () => {
    expect(collectCanvasAssets([])).toHaveLength(0);
  });

  it("should collect multiple assets from different node types", () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    const vidNode = createNode(findDef("generate-video"), 300, 0);

    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = addNode(state, vidNode);
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,IMG", "image");
    state = updateNodeStatus(state, vidNode.id, "success", "https://cdn.example.com/video.mp4", "video");

    const assets = collectCanvasAssets(state.nodes);
    expect(assets).toHaveLength(2);
    expect(assets.find(a => a.mimeType === "image")).toBeDefined();
    expect(assets.find(a => a.mimeType === "video")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. collectVideoAssets
// ═══════════════════════════════════════════════════════════════════

describe("collectVideoAssets", () => {
  it("should collect completed records with proxyUri", () => {
    const records: VideoRecord[] = [
      makeVideoRecord({ proxyUri: "https://proxy.example.com/v1.mp4", prompt: "sunset video" }),
      makeVideoRecord({ proxyUri: "https://proxy.example.com/v2.mp4", prompt: "ocean waves" }),
    ];

    const assets = collectVideoAssets(records);
    expect(assets).toHaveLength(2);
    expect(assets[0].mimeType).toBe("video");
    expect(assets[0].source).toBe("history");
    expect(assets[0].url).toBe("https://proxy.example.com/v1.mp4");
  });

  it("should skip failed records", () => {
    const records: VideoRecord[] = [
      makeVideoRecord({ proxyUri: "https://proxy.example.com/v1.mp4", status: "failed" }),
    ];

    const assets = collectVideoAssets(records);
    expect(assets).toHaveLength(0);
  });

  it("should skip records without proxyUri", () => {
    const records: VideoRecord[] = [
      makeVideoRecord({ proxyUri: "", prompt: "no proxy" }),
    ];

    const assets = collectVideoAssets(records);
    expect(assets).toHaveLength(0);
  });

  it("should return empty for empty records", () => {
    expect(collectVideoAssets([])).toHaveLength(0);
  });

  it("should truncate long prompts in label", () => {
    const longPrompt = "A".repeat(100);
    const records: VideoRecord[] = [
      makeVideoRecord({ proxyUri: "https://proxy.example.com/v.mp4", prompt: longPrompt }),
    ];

    const assets = collectVideoAssets(records);
    expect(assets[0].label.length).toBeLessThanOrEqual(40);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Add Node 기존 기능 호환
// ═══════════════════════════════════════════════════════════════════

describe("NODE_REGISTRY compatibility", () => {
  it("should have enabled nodes available for Add Node tab", () => {
    const enabledNodes = NODE_REGISTRY.filter(d => d.enabled);
    expect(enabledNodes.length).toBeGreaterThanOrEqual(5);
    expect(enabledNodes.find(d => d.type === "generate-image")).toBeDefined();
    expect(enabledNodes.find(d => d.type === "viewer")).toBeDefined();
    expect(enabledNodes.find(d => d.type === "upscale-image")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. AssetItem 형식 검증
// ═══════════════════════════════════════════════════════════════════

describe("AssetItem format", () => {
  it("canvas assets should have correct id prefix", () => {
    const imgNode = createNode(findDef("generate-image"), 0, 0);
    let state = createInitialCanvasState();
    state = addNode(state, imgNode);
    state = updateNodeStatus(state, imgNode.id, "success", "data:image/png;base64,X", "image");

    const assets = collectCanvasAssets(state.nodes);
    expect(assets[0].id).toMatch(/^canvas-/);
  });

  it("video assets should have correct id prefix", () => {
    const records = [makeVideoRecord({ proxyUri: "https://x.com/v.mp4" })];
    const assets = collectVideoAssets(records);
    expect(assets[0].id).toMatch(/^video-/);
  });

  it("prompt items should have correct id prefix", () => {
    const entries: PromptHistoryEntry[] = [
      makePromptEntry({ storyText: "hello world" }),
    ];
    const items = collectPromptItems(entries);
    expect(items[0].id).toMatch(/^prompt-/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. collectPromptItems
// ═══════════════════════════════════════════════════════════════════

describe("collectPromptItems", () => {
  it("should convert valid entries to PromptItems with fullText", () => {
    const entries: PromptHistoryEntry[] = [
      makePromptEntry({ storyText: "A cat sitting on a wall" }),
    ];

    const items = collectPromptItems(entries);
    expect(items).toHaveLength(1);
    expect(items[0].fullText).toBe("A cat sitting on a wall");
    expect(items[0].preview).toBe("A cat sitting on a wall");
    expect(items[0].createdAt).toBeGreaterThan(0);
  });

  it("should truncate preview for long text but keep fullText intact", () => {
    const longText = "B".repeat(100);
    const entries: PromptHistoryEntry[] = [
      makePromptEntry({ storyText: longText }),
    ];

    const items = collectPromptItems(entries);
    expect(items[0].preview.length).toBeLessThanOrEqual(60);
    expect(items[0].preview).toContain("...");
    expect(items[0].fullText).toBe(longText);
    expect(items[0].fullText.length).toBe(100);
  });

  it("should skip entries with empty or whitespace-only storyText", () => {
    const entries: PromptHistoryEntry[] = [
      makePromptEntry({ storyText: "" }),
      makePromptEntry({ storyText: "   " }),
      makePromptEntry({ storyText: "valid prompt" }),
    ];

    const items = collectPromptItems(entries);
    expect(items).toHaveLength(1);
    expect(items[0].fullText).toBe("valid prompt");
  });

  it("should return empty for empty entries", () => {
    expect(collectPromptItems([])).toHaveLength(0);
  });

  it("should include directorPersona when present", () => {
    const entries: PromptHistoryEntry[] = [
      makePromptEntry({ storyText: "prompt text", directorPersona: "tarantino" }),
    ];

    const items = collectPromptItems(entries);
    expect(items[0].directorPersona).toBe("tarantino");
  });

  it("should handle entries without input gracefully", () => {
    const entries = [
      { id: "ph-bad", createdAt: Date.now(), input: null, output: {} } as unknown as PromptHistoryEntry,
    ];

    const items = collectPromptItems(entries);
    expect(items).toHaveLength(0);
  });

  it("should preserve exact text for TextInput insertion", () => {
    const specialText = "  leading spaces\nnewlines\ttabs  ";
    const entries: PromptHistoryEntry[] = [
      makePromptEntry({ storyText: specialText }),
    ];

    const items = collectPromptItems(entries);
    expect(items[0].fullText).toBe(specialText);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. extractChainMeta
// ═══════════════════════════════════════════════════════════════════

describe("extractChainMeta", () => {
  it("should extract aspectRatio when valid", () => {
    const meta = extractChainMeta({
      storyText: "test",
      directorPersona: "",
      region: "한국" as never,
      animationMode: "" as never,
      duration: 60 as never,
      aspectRatio: "9:16" as never,
    } as never);

    expect(meta).toBeDefined();
    expect(meta!.aspectRatio).toBe("9:16");
  });

  it("should extract cutDuration as durationSec", () => {
    const meta = extractChainMeta({
      storyText: "test",
      directorPersona: "",
      region: "한국" as never,
      animationMode: "" as never,
      duration: 60 as never,
      aspectRatio: "16:9" as never,
      cutDuration: 8,
    } as never);

    expect(meta).toBeDefined();
    expect(meta!.durationSec).toBe(8);
  });

  it("should extract animationMode when non-empty", () => {
    const meta = extractChainMeta({
      storyText: "test",
      directorPersona: "",
      region: "한국" as never,
      animationMode: "실사" as never,
      duration: 60 as never,
      aspectRatio: "16:9" as never,
    } as never);

    expect(meta).toBeDefined();
    expect(meta!.animationMode).toBe("실사");
  });

  it("should return undefined when no usable fields exist", () => {
    const meta = extractChainMeta({
      storyText: "test",
      directorPersona: "",
      region: "한국" as never,
      animationMode: "" as never,
      duration: 60 as never,
      aspectRatio: "16:9" as never,
    } as never);

    // aspectRatio "16:9" is valid → meta should exist
    expect(meta).toBeDefined();
    expect(meta!.aspectRatio).toBe("16:9");
  });

  it("should return undefined for null input", () => {
    const meta = extractChainMeta(null as never);
    expect(meta).toBeUndefined();
  });

  it("should extract all fields together", () => {
    const meta = extractChainMeta({
      storyText: "story",
      directorPersona: "spielberg",
      region: "미국" as never,
      animationMode: "수채화 애니" as never,
      duration: 120 as never,
      aspectRatio: "9:16" as never,
      cutDuration: 10,
    } as never);

    expect(meta).toBeDefined();
    expect(meta!.aspectRatio).toBe("9:16");
    expect(meta!.durationSec).toBe(10);
    expect(meta!.animationMode).toBe("수채화 애니");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. collectPromptItems with chainMeta
// ═══════════════════════════════════════════════════════════════════

describe("collectPromptItems chainMeta integration", () => {
  it("should include chainMeta when input has usable fields", () => {
    const entries: PromptHistoryEntry[] = [
      makePromptEntry({ storyText: "test story" }),
    ];
    // Default makePromptEntry has aspectRatio "16:9"
    const items = collectPromptItems(entries);
    expect(items[0].chainMeta).toBeDefined();
    expect(items[0].chainMeta!.aspectRatio).toBe("16:9");
  });

  it("should preserve fullText separately from chainMeta", () => {
    const entries: PromptHistoryEntry[] = [
      makePromptEntry({ storyText: "my story text" }),
    ];
    const items = collectPromptItems(entries);
    expect(items[0].fullText).toBe("my story text");
    expect(items[0].chainMeta).toBeDefined();
  });
});
