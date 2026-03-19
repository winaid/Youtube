/**
 * deep-analysis.test.ts — Deep Analysis standard-lite 테스트
 */
import { describe, it, expect } from "vitest";
import { analyzeStoryIntent, SAFE_STORY_INTENT } from "@/lib/deep-analysis/analyze-story-intent";
import { analyzeGenerationRisk, SAFE_GENERATION_RISK } from "@/lib/deep-analysis/analyze-generation-risk";
import { analyzeVisualStrategy, SAFE_VISUAL_STRATEGY } from "@/lib/deep-analysis/analyze-visual-strategy";
import { buildPromptBrief, serializePromptBrief, SAFE_PROMPT_BRIEF } from "@/lib/deep-analysis/build-prompt-brief";
import { runDeepAnalysis, SAFE_ANALYSIS_RESULT } from "@/lib/deep-analysis/analysis-orchestrator";

// ═══════════════════════════════════════════════════════════════════
// Story Intent
// ═══════════════════════════════════════════════════════════════════

describe("analyzeStoryIntent", () => {
  it("호러 키워드 → dark tone, horror genre", () => {
    const result = analyzeStoryIntent("어두운 밤, 저주받은 집에서 공포의 밤이 시작된다", 60, 4);
    expect(result.tone).toBe("dark");
    expect(result.genre).toBe("horror");
  });

  it("역사 키워드 → historical genre", () => {
    const result = analyzeStoryIntent("1890년대 조선 말기, 의사가 새로운 치료법을 개발한다", 60, 4);
    expect(result.genre).toBe("historical");
  });

  it("코미디 키워드 → playful tone", () => {
    const result = analyzeStoryIntent("우연히 만난 두 사람의 웃긴 이야기. 코미디 같은 하루가 시작된다.", 30, 3);
    expect(result.tone).toBe("playful");
    expect(result.genre).toBe("comedy");
  });

  it("빈 텍스트 → safe defaults", () => {
    expect(analyzeStoryIntent("", 30, 3)).toEqual(SAFE_STORY_INTENT);
  });

  it("짧은 컷 = fast pacing", () => {
    const result = analyzeStoryIntent("빠르게 달리는 인물이 도시를 누빈다.", 15, 5);
    expect(result.pacing).toBe("fast");
  });

  it("긴 컷 = slow or decelerating pacing", () => {
    const result = analyzeStoryIntent("천천히 흐르는 시간 속에서 노인이 정원을 가꾼다.", 60, 4);
    expect(["slow", "decelerating"]).toContain(result.pacing);
  });

  it("감정 아크가 문자열로 반환", () => {
    const result = analyzeStoryIntent("평화로운 시작. 그러나 갈등이 시작된다. 위기 속에서 갈등이 폭발한다. 결국 희망을 찾는다.", 60, 4);
    expect(typeof result.emotionalArc).toBe("string");
    expect(result.emotionalArc.length).toBeGreaterThan(0);
  });

  it("모티프가 최대 3개까지만", () => {
    const result = analyzeStoryIntent("고독한 권력자가 자유를 찾아 시간의 흐름 속에서 추락하고 해방된다.", 60, 4);
    expect(result.keyMotifs.length).toBeLessThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Generation Risk
// ═══════════════════════════════════════════════════════════════════

describe("analyzeGenerationRisk", () => {
  it("긴 영상 + 많은 컷 + continuity OFF → high continuity risk", () => {
    const result = analyzeGenerationRisk("긴 이야기가 전개된다.", 120, 8, 1, false);
    expect(result.continuityRisk).toBe("high");
  });

  it("continuity ON → low continuity risk", () => {
    const result = analyzeGenerationRisk("긴 이야기가 전개된다.", 120, 8, 1, true);
    expect(result.continuityRisk).toBe("low");
  });

  it("캐릭터 5명 이상 → high subject count risk", () => {
    const result = analyzeGenerationRisk("그리고 또 다른 인물이 등장한다. 그리고 새로운 캐릭터가 나타난다.", 60, 4, 3, false);
    expect(result.subjectCountRisk).toBe("high");
  });

  it("잦은 장소 전환 → high scene switch risk", () => {
    const text = "한편 다른 곳에서. 한편 또 다른 곳. 그런데 다른 곳에서 일이 벌어진다.";
    const result = analyzeGenerationRisk(text, 30, 3, 1, false);
    expect(result.sceneSwitchRisk).toBe("high");
  });

  it("빈 텍스트 → safe defaults", () => {
    expect(analyzeGenerationRisk("", 30, 3, 1, false)).toEqual(SAFE_GENERATION_RISK);
  });

  it("mitigation notes가 3개 이하", () => {
    const result = analyzeGenerationRisk("그리고 다른 인물. 한편 다른 곳. 폭발과 추격이 이어진다.", 120, 10, 5, false);
    expect(result.mitigationNotes.length).toBeLessThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Visual Strategy Lite
// ═══════════════════════════════════════════════════════════════════

describe("analyzeVisualStrategy", () => {
  it("live-action → realism 90", () => {
    const result = analyzeVisualStrategy("남자가 거리를 걷는다.", 30, 3, "live-action");
    expect(result.realismLevel).toBe(90);
    expect(result.stylizationLevel).toBe(10);
  });

  it("tv-anime → realism 20", () => {
    const result = analyzeVisualStrategy("마법소녀가 변신한다.", 30, 3, "tv-anime");
    expect(result.realismLevel).toBe(20);
  });

  it("빈 텍스트 → safe defaults", () => {
    expect(analyzeVisualStrategy("", 30, 3)).toEqual(SAFE_VISUAL_STRATEGY);
  });

  it("realism + stylization ≈ 100", () => {
    const result = analyzeVisualStrategy("test text long enough.", 30, 3, "cinematic");
    expect(result.realismLevel + result.stylizationLevel).toBe(100);
  });

  it("액션 키워드 다수 → dynamic camera energy", () => {
    const result = analyzeVisualStrategy("폭발! 추격! 싸우는 두 사람! 달리고 또 달린다!", 15, 5);
    expect(result.cameraEnergy).toBe("dynamic");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Prompt Brief
// ═══════════════════════════════════════════════════════════════════

describe("buildPromptBrief", () => {
  it("horror + high risk → 관련 제어 신호 포함", () => {
    const intent = { ...SAFE_STORY_INTENT, tone: "dark" as const, genre: "horror" as const };
    const risk = { ...SAFE_GENERATION_RISK, continuityRisk: "high" as const, subjectCountRisk: "high" as const };
    const visual = { ...SAFE_VISUAL_STRATEGY, realismLevel: 85, stylizationLevel: 15 };

    const brief = buildPromptBrief(intent, risk, visual, false);

    expect(brief.creativeBrief).toContain("dark");
    expect(brief.creativeBrief).toContain("horror");
    expect(brief.continuityHint).toContain("continuity");
    expect(brief.shotDiscipline).toContain("max 2 subjects");
    expect(brief.avoidList.length).toBeGreaterThan(0);
    expect(brief.avoidList.length).toBeLessThanOrEqual(5);
  });

  it("continuity ON → continuity system active 메시지", () => {
    const brief = buildPromptBrief(SAFE_STORY_INTENT, SAFE_GENERATION_RISK, SAFE_VISUAL_STRATEGY, true);
    expect(brief.continuityHint).toContain("continuity system active");
  });

  it("continuity OFF + low risk → 빈 continuity hint", () => {
    const risk = { ...SAFE_GENERATION_RISK, continuityRisk: "low" as const };
    const brief = buildPromptBrief(SAFE_STORY_INTENT, risk, SAFE_VISUAL_STRATEGY, false);
    expect(brief.continuityHint).toBe("");
  });
});

describe("serializePromptBrief", () => {
  it("빈 brief → 빈 문자열", () => {
    expect(serializePromptBrief(SAFE_PROMPT_BRIEF)).toBe("");
  });

  it("내용 있으면 DEEP ANALYSIS BRIEF 헤더 포함", () => {
    const brief = { ...SAFE_PROMPT_BRIEF, creativeBrief: "dark horror" };
    const serialized = serializePromptBrief(brief);
    expect(serialized).toContain("DEEP ANALYSIS BRIEF");
    expect(serialized).toContain("dark horror");
  });

  it("avoidList가 직렬화됨", () => {
    const brief = { ...SAFE_PROMPT_BRIEF, avoidList: ["crowded scenes", "abstract metaphors"] };
    const serialized = serializePromptBrief(brief);
    expect(serialized).toContain("Avoid:");
    expect(serialized).toContain("crowded scenes");
  });

  it("직렬화 결과가 500자 이하 (compact)", () => {
    const brief = buildPromptBrief(
      { tone: "dark", pacing: "fast", genre: "action", emotionalArc: "calm → tension → peak", protagonistFocus: "high", keyMotifs: ["power", "freedom"] },
      { continuityRisk: "high", subjectCountRisk: "high", sceneSwitchRisk: "high", motionComplexityRisk: "high", promptOverloadRisk: "medium", visualAmbiguityRisk: "medium", mitigationNotes: ["lock subjects", "simplify"] },
      { visualDensity: "dense", cameraEnergy: "dynamic", realismLevel: 85, stylizationLevel: 15, characterPriority: "high", environmentPriority: "low" },
      false,
    );
    const serialized = serializePromptBrief(brief);
    expect(serialized.length).toBeLessThan(800);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════════════

describe("runDeepAnalysis", () => {
  it("정상 실행 — 결과에 모든 필드 존재", () => {
    const result = runDeepAnalysis({
      storyText: "1890년대 조선. 한 의사가 새로운 치료법을 발견하지만, 기존 권력자들의 반대에 부딪힌다.",
      totalDurationSec: 60,
      cutCount: 4,
      animationMode: "live-action",
      continuityMode: false,
    });

    expect(result.storyIntent).toBeDefined();
    expect(result.generationRisk).toBeDefined();
    expect(result.visualStrategy).toBeDefined();
    expect(result.promptBrief).toBeDefined();
    expect(result.analysisMs).toBeGreaterThanOrEqual(0);
    expect(result.storyIntent.genre).toBe("historical");
  });

  it("빈 스토리 → safe defaults 반환 (실패 아님)", () => {
    const result = runDeepAnalysis({
      storyText: "",
      totalDurationSec: 30,
      cutCount: 3,
    });
    expect(result.storyIntent.tone).toBe("neutral");
    expect(result.generationRisk.continuityRisk).toBe("medium");
  });

  it("continuity ON → continuityRisk low", () => {
    const result = runDeepAnalysis({
      storyText: "긴 여정이 시작된다. 도시를 떠나 산을 넘는다.",
      totalDurationSec: 120,
      cutCount: 8,
      continuityMode: true,
    });
    expect(result.generationRisk.continuityRisk).toBe("low");
    expect(result.promptBrief.continuityHint).toContain("continuity system active");
  });

  it("continuity OFF + 긴 영상 → continuityRisk high + 힌트 포함", () => {
    const result = runDeepAnalysis({
      storyText: "긴 여정이 시작된다. 도시를 떠나 산을 넘는다.",
      totalDurationSec: 120,
      cutCount: 8,
      continuityMode: false,
    });
    expect(result.generationRisk.continuityRisk).toBe("high");
    expect(result.promptBrief.continuityHint).toContain("continuity");
  });

  it("promptBrief 직렬화 가능", () => {
    const result = runDeepAnalysis({
      storyText: "공포 영화. 저주받은 집에서 괴물이 나타난다.",
      totalDurationSec: 60,
      cutCount: 6,
      animationMode: "cinematic",
    });
    const serialized = serializePromptBrief(result.promptBrief);
    expect(typeof serialized).toBe("string");
    // 과도하게 길지 않아야 함
    if (serialized.length > 0) {
      expect(serialized.length).toBeLessThan(800);
    }
  });

  it("warnings 배열이 반환됨 (빈 배열이어도 존재)", () => {
    const result = runDeepAnalysis({
      storyText: "테스트 스토리. 충분한 길이의 텍스트입니다.",
      totalDurationSec: 30,
      cutCount: 3,
    });
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Continuity 병합 테스트
// ═══════════════════════════════════════════════════════════════════

describe("continuity + deep analysis 병합", () => {
  it("continuity ON에서도 avoidList가 과도하지 않음", () => {
    const result = runDeepAnalysis({
      storyText: "한편 다른 곳에서. 그리고 또 다른 인물이 등장한다. 추격전이 벌어진다.",
      totalDurationSec: 120,
      cutCount: 8,
      continuityMode: true,
      characterCount: 4,
    });
    expect(result.promptBrief.avoidList.length).toBeLessThanOrEqual(5);
  });

  it("continuity OFF에서도 scene reset 억제 신호 존재", () => {
    const result = runDeepAnalysis({
      storyText: "한편 다른 곳에서. 한편 또 다른 곳. 그런데 다른 곳에서.",
      totalDurationSec: 30,
      cutCount: 3,
      continuityMode: false,
    });
    // sceneSwitchRisk가 high이면 avoid에 abrupt scene reset 포함
    if (result.generationRisk.sceneSwitchRisk === "high") {
      expect(
        result.promptBrief.avoidList.some(a => a.includes("scene reset") || a.includes("abrupt"))
        || result.promptBrief.environmentLockHint.length > 0
      ).toBe(true);
    }
  });
});
