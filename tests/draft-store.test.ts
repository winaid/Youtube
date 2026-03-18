/**
 * draft-store.test.ts — DraftProject schema & utility 검증
 *
 * IndexedDB는 Node 환경에서 사용 불가하므로
 * 순수 함수(buildDraft, exportDraftJSON, importDraftJSON)만 테스트.
 */

import { describe, it, expect } from "vitest";
import {
  buildDraft,
  exportDraftJSON,
  importDraftJSON,
  genDraftId,
  DRAFT_SCHEMA_VERSION,
  type DraftProject,
  type DraftGenerationMeta,
} from "@/lib/draft-store";
import type { PromptInput, PromptOutput } from "@/types";

// ─── Test Fixtures ───

const SAMPLE_INPUT: PromptInput = {
  storyText: "비 오는 밤, 고양이가 걷는다.",
  directorPersona: "wong-kar-wai",
  region: "한국",
  animationMode: "live-action-cinematic",
  duration: 60,
  aspectRatio: "9:16",
};

const SAMPLE_OUTPUT: PromptOutput = {
  projectTitle: "테스트 프로젝트",
  conceptSummary: "요약",
  totalCuts: 4,
  globalStylePrompt: "style",
  directorPersonaPrompt: "persona",
  characterSeeds: [],
  continuityRules: [],
  cuts: [
    {
      cutNumber: 1,
      durationSec: 5,
      sceneDescription: "비 오는 골목 장면 설명",
      cameraDirection: "slow push",
      moodLighting: "dark moody",
      imagePrompt: "img",
      endImagePrompt: "end",
      videoPrompt: "vid",
      extendPrompt: "ext",
      transitionHint: "cut",
      characterConsistency: "char",
      charactersInScene: [],
    },
    {
      cutNumber: 2,
      durationSec: 5,
      sceneDescription: "고양이 클로즈업",
      cameraDirection: "close-up",
      moodLighting: "warm",
      imagePrompt: "img2",
      endImagePrompt: "end2",
      videoPrompt: "vid2",
      extendPrompt: "ext2",
      transitionHint: "dissolve",
      characterConsistency: "char2",
      charactersInScene: [],
    },
    {
      cutNumber: 3,
      durationSec: 3,
      sceneDescription: "빗방울",
      cameraDirection: "macro",
      moodLighting: "neutral",
      imagePrompt: "img3",
      endImagePrompt: "end3",
      videoPrompt: "vid3",
      extendPrompt: "ext3",
      transitionHint: "cut",
      characterConsistency: "char3",
      charactersInScene: [],
    },
    {
      cutNumber: 4,
      durationSec: 2,
      sceneDescription: "걸어가는 뒷모습",
      cameraDirection: "wide",
      moodLighting: "golden",
      imagePrompt: "img4",
      endImagePrompt: "end4",
      videoPrompt: "vid4",
      extendPrompt: "ext4",
      transitionHint: "fade",
      characterConsistency: "char4",
      charactersInScene: [],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════
// genDraftId
// ═══════════════════════════════════════════════════════════════════

describe("genDraftId", () => {
  it("draft- 접두사", () => {
    expect(genDraftId()).toMatch(/^draft-/);
  });

  it("고유 ID 생성", () => {
    const ids = new Set(Array.from({ length: 100 }, () => genDraftId()));
    expect(ids.size).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildDraft
// ═══════════════════════════════════════════════════════════════════

describe("buildDraft", () => {
  it("input만으로 draft 생성 (output 없음)", () => {
    const draft = buildDraft({ input: SAMPLE_INPUT, output: null });
    expect(draft.id).toMatch(/^draft-/);
    expect(draft.schemaVersion).toBe(DRAFT_SCHEMA_VERSION);
    expect(draft.input).toBe(SAMPLE_INPUT);
    expect(draft.output).toBeNull();
    expect(draft.title).toBe("비 오는 밤, 고양이가 걷는다.");
    expect(draft.cutCount).toBeUndefined();
  });

  it("input + output으로 draft 생성", () => {
    const draft = buildDraft({ input: SAMPLE_INPUT, output: SAMPLE_OUTPUT });
    expect(draft.title).toBe("테스트 프로젝트"); // from projectTitle
    expect(draft.cutCount).toBe(4);
    expect(draft.thumbnail).toBe("비 오는 골목 장면 설명");
  });

  it("커스텀 ID 지정", () => {
    const draft = buildDraft({ id: "my-id", input: SAMPLE_INPUT, output: null });
    expect(draft.id).toBe("my-id");
  });

  it("커스텀 title 지정", () => {
    const draft = buildDraft({ title: "커스텀 제목", input: SAMPLE_INPUT, output: SAMPLE_OUTPUT });
    expect(draft.title).toBe("커스텀 제목");
  });

  it("generationMeta 포함", () => {
    const meta: DraftGenerationMeta = {
      totalDurationSec: 15,
      targetCuts: 4,
      shortformRhythm: { band: "13-15s", minCuts: 4, is13to15Special: true },
    };
    const draft = buildDraft({ input: SAMPLE_INPUT, output: SAMPLE_OUTPUT, generationMeta: meta });
    expect(draft.generationMeta?.shortformRhythm?.is13to15Special).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// exportDraftJSON + importDraftJSON roundtrip
// ═══════════════════════════════════════════════════════════════════

describe("export/import JSON roundtrip", () => {
  it("export → import 왕복 시 데이터 보존", () => {
    const original = buildDraft({ input: SAMPLE_INPUT, output: SAMPLE_OUTPUT });
    const json = exportDraftJSON(original);
    const imported = importDraftJSON(json);

    expect(imported).not.toBeNull();
    expect(imported!.input.storyText).toBe(SAMPLE_INPUT.storyText);
    expect(imported!.output?.totalCuts).toBe(4);
    expect(imported!.schemaVersion).toBe(DRAFT_SCHEMA_VERSION);
  });

  it("import 시 새 ID 부여 (중복 방지)", () => {
    const original = buildDraft({ input: SAMPLE_INPUT, output: null });
    const json = exportDraftJSON(original);
    const imported = importDraftJSON(json);

    expect(imported).not.toBeNull();
    expect(imported!.id).not.toBe(original.id);
    expect(imported!.id).toMatch(/^draft-/);
  });

  it("잘못된 JSON → null", () => {
    expect(importDraftJSON("not json")).toBeNull();
    expect(importDraftJSON("{}")).toBeNull(); // missing required fields
    expect(importDraftJSON('{"id": "x"}')).toBeNull(); // missing input
  });
});

// ═══════════════════════════════════════════════════════════════════
// Schema version future-proofing
// ═══════════════════════════════════════════════════════════════════

describe("schema version", () => {
  it("현재 schema version = 1", () => {
    expect(DRAFT_SCHEMA_VERSION).toBe(1);
  });

  it("buildDraft는 항상 현재 version 포함", () => {
    const draft = buildDraft({ input: SAMPLE_INPUT, output: null });
    expect(draft.schemaVersion).toBe(DRAFT_SCHEMA_VERSION);
  });
});
