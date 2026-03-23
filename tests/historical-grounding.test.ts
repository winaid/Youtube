/**
 * Historical Grounding 테스트
 *
 * 테스트 케이스:
 * 1) 조선시대 주막에서 비를 피하는 선비
 * 2) 에도 시대 골목을 걷는 젊은 여성
 * 3) 개화기 경성의 전차 앞에 멈춰 선 사람들
 * 4) 청나라 말기의 상점 거리
 * 5) 전통 아시아 옷을 입은 사람 (모호 케이스)
 */
import { describe, it, expect } from "vitest";
import { detectHistoricalTerms, hasMultipleRegions, hasMixedPeriods } from "../src/lib/historical-term-detector";
import { resolveHistoricalGrounding, buildHistoricalPromptDirective, buildHistoricalNegativePrompt } from "../src/lib/historical-grounding-resolver";
import { validateHistoricalGrounding } from "../src/lib/historical-grounding-validator";
import { lookupByTerm } from "../src/lib/historical-knowledge-base";
import type { Cut } from "../src/types";

// ═══════════════════════════════════════════════════════════════════
// 1. Term Detector 테스트
// ═══════════════════════════════════════════════════════════════════

describe("Historical Term Detector", () => {
  it("조선시대 주막 시나리오에서 한국/조선 단서를 감지한다", () => {
    const text = "조선시대 주막에서 비를 피하는 선비";
    const terms = detectHistoricalTerms(text);
    expect(terms.length).toBeGreaterThanOrEqual(2);
    const regions = terms.map(t => t.region);
    expect(regions).toContain("Korea");
    // "조선" 또는 "조선시대" 매칭 확인
    const joseonTerm = terms.find(t => t.period === "Joseon Dynasty");
    expect(joseonTerm).toBeDefined();
    expect(joseonTerm!.confidence).toBeGreaterThanOrEqual(70);
  });

  it("에도 시대 시나리오에서 일본/에도 단서를 감지한다", () => {
    const text = "에도 시대 골목을 걷는 젊은 여성";
    const terms = detectHistoricalTerms(text);
    expect(terms.length).toBeGreaterThanOrEqual(1);
    const edoTerm = terms.find(t => t.region === "Japan");
    expect(edoTerm).toBeDefined();
    expect(edoTerm!.period).toBe("Edo Period");
  });

  it("개화기 경성 시나리오에서 한국/개화기 단서를 감지한다", () => {
    const text = "개화기 경성의 전차 앞에 멈춰 선 사람들";
    const terms = detectHistoricalTerms(text);
    expect(terms.length).toBeGreaterThanOrEqual(1);
    const gaehwaTerm = terms.find(t => t.region === "Korea" && t.period === "Korean Empire / Enlightenment Period");
    expect(gaehwaTerm).toBeDefined();
  });

  it("청나라 말기 시나리오에서 중국/청 단서를 감지한다", () => {
    const text = "청나라 말기의 상점 거리";
    const terms = detectHistoricalTerms(text);
    expect(terms.length).toBeGreaterThanOrEqual(1);
    const qingTerm = terms.find(t => t.region === "China");
    expect(qingTerm).toBeDefined();
    expect(qingTerm!.period).toBe("Qing Dynasty (Late)");
  });

  it("모호한 아시아 표현에서 Ambiguous-Asia를 감지한다", () => {
    const text = "전통 아시아 옷을 입은 사람";
    const terms = detectHistoricalTerms(text);
    expect(terms.length).toBeGreaterThanOrEqual(1);
    const ambiguous = terms.find(t => t.region === "Ambiguous-Asia");
    expect(ambiguous).toBeDefined();
    expect(ambiguous!.confidence).toBeLessThan(50);
  });

  it("역사적 단서가 없는 텍스트에서는 빈 배열을 반환한다", () => {
    const text = "현대 서울의 카페에서 커피를 마시는 사람";
    const terms = detectHistoricalTerms(text);
    expect(terms.length).toBe(0);
  });

  it("다중 지역 혼합을 감지한다", () => {
    const text = "조선시대 한복을 입고 기모노를 두른 사람";
    const terms = detectHistoricalTerms(text);
    expect(hasMultipleRegions(terms)).toBe(true);
  });

  it("빈 텍스트에서 빈 배열을 반환한다", () => {
    expect(detectHistoricalTerms("")).toEqual([]);
    expect(detectHistoricalTerms("   ")).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Grounding Resolver 테스트
// ═══════════════════════════════════════════════════════════════════

describe("Historical Grounding Resolver", () => {
  it("TC1: 조선시대 주막에서 비를 피하는 선비 → Korea/Joseon + 주막/선비 visualAnchors", () => {
    const result = resolveHistoricalGrounding("조선시대 주막에서 비를 피하는 선비");
    expect(result.detected).toBe(true);
    expect(result.region).toBe("Korea");
    expect(result.period).toBe("Joseon Dynasty");
    expect(result.eraApprox).toBe("1392–1897");
    expect(result.confidence).toBeGreaterThanOrEqual(70);
    expect(result.sourceTerms.length).toBeGreaterThanOrEqual(2);

    // visualAnchors에 복식/건축/소품 포함
    expect(result.visualAnchors.length).toBeGreaterThan(0);
    const categories = result.visualAnchors.map(va => va.category);
    expect(categories).toContain("costume");

    // avoid에 다른 문화권 요소 포함
    expect(result.avoid.length).toBeGreaterThan(0);

    // resolvedMeaning에 해석 포함
    expect(Object.keys(result.resolvedMeaning).length).toBeGreaterThan(0);
  });

  it("TC2: 에도 시대 골목을 걷는 젊은 여성 → Japan/Edo + 마치야/기모노 visualAnchors", () => {
    const result = resolveHistoricalGrounding("에도 시대 골목을 걷는 젊은 여성");
    expect(result.detected).toBe(true);
    expect(result.region).toBe("Japan");
    expect(result.period).toBe("Edo Period");
    expect(result.eraApprox).toBe("1603–1868");
    expect(result.confidence).toBeGreaterThanOrEqual(70);

    // 일본 에도 시대 시각적 앵커 확인
    const anchorDescs = result.visualAnchors.map(va => va.description.toLowerCase());
    const hasKimono = anchorDescs.some(d => d.includes("kimono"));
    const hasMachiya = anchorDescs.some(d => d.includes("machiya"));
    expect(hasKimono || hasMachiya).toBe(true);

    // 한국/중국 요소는 avoid에 포함
    const avoidLower = result.avoid.map(a => a.toLowerCase());
    expect(avoidLower.some(a => a.includes("hanbok") || a.includes("korean"))).toBe(true);
  });

  it("TC3: 개화기 경성의 전차 앞에 멈춰 선 사람들 → Korea/Korean Empire", () => {
    const result = resolveHistoricalGrounding("개화기 경성의 전차 앞에 멈춰 선 사람들");
    expect(result.detected).toBe(true);
    expect(result.region).toBe("Korea");
    expect(result.period).toBe("Korean Empire / Enlightenment Period");
    expect(result.eraApprox).toBe("1897–1910");

    // 개화기 특유의 시각적 앵커: 전차, 양옥/한옥 혼재
    const anchorDescs = result.visualAnchors.map(va => va.description.toLowerCase());
    const hasStreetcar = anchorDescs.some(d => d.includes("streetcar") || d.includes("jeoncha"));
    expect(hasStreetcar).toBe(true);
  });

  it("TC4: 청나라 말기의 상점 거리 → China/Qing Dynasty (Late)", () => {
    const result = resolveHistoricalGrounding("청나라 말기의 상점 거리");
    expect(result.detected).toBe(true);
    expect(result.region).toBe("China");
    expect(result.period).toBe("Qing Dynasty (Late)");
    expect(result.eraApprox).toBe("1850–1912");

    // 청나라 시각적 앵커 확인
    const anchorDescs = result.visualAnchors.map(va => va.description.toLowerCase());
    const hasQing = anchorDescs.some(d => d.includes("changshan") || d.includes("mandarin") || d.includes("siheyuan"));
    expect(hasQing).toBe(true);
  });

  it("TC5: 전통 아시아 옷을 입은 사람 → Ambiguous warning", () => {
    const result = resolveHistoricalGrounding("전통 아시아 옷을 입은 사람");
    expect(result.detected).toBe(true);
    expect(result.confidence).toBeLessThan(50);

    // 경고 포함 확인
    const warningCodes = result.warnings.map(w => w.code);
    expect(
      warningCodes.includes("missing_historical_resolution") ||
      warningCodes.includes("missing_cultural_anchors")
    ).toBe(true);

    // visualAnchors가 비어있거나 매우 적음
    expect(result.visualAnchors.length).toBeLessThanOrEqual(1);
  });

  it("다중 지역 혼합 시 mixed_asian_period_cues 경고 발생", () => {
    const result = resolveHistoricalGrounding("조선시대 한복을 입고 에도 시대 마치야 앞에 선 사람");
    expect(result.detected).toBe(true);
    const mixedWarning = result.warnings.find(w => w.code === "mixed_asian_period_cues");
    expect(mixedWarning).toBeDefined();
    expect(mixedWarning!.severity).toBe("error");
  });

  it("시대착오 요소 감지 — 조선시대에 스마트폰", () => {
    const result = resolveHistoricalGrounding("조선시대 주막에서 스마트폰을 보는 사람");
    expect(result.detected).toBe(true);
    const anachronism = result.warnings.find(w => w.code === "anachronistic_object_risk");
    expect(anachronism).toBeDefined();
  });

  it("역사적 단서 없는 텍스트 → detected: false", () => {
    const result = resolveHistoricalGrounding("현대 서울 강남의 카페에서 라떼를 마시는 직장인");
    expect(result.detected).toBe(false);
    expect(result.region).toBeNull();
    expect(result.visualAnchors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Prompt Directive Builder 테스트
// ═══════════════════════════════════════════════════════════════════

describe("Historical Prompt Directive Builder", () => {
  it("조선시대 grounding → directive에 REQUIRED VISUAL ANCHORS 포함", () => {
    const grounding = resolveHistoricalGrounding("조선시대 주막에서 비를 피하는 선비");
    const directive = buildHistoricalPromptDirective(grounding);
    expect(directive).toContain("HISTORICAL GROUNDING DIRECTIVE");
    expect(directive).toContain("Korea");
    expect(directive).toContain("Joseon Dynasty");
    expect(directive).toContain("REQUIRED VISUAL ANCHORS");
    expect(directive).toContain("STRICTLY AVOID");
    expect(directive).toContain("Do NOT use generic");
    expect(directive).toContain("Do NOT mix visual elements");
  });

  it("모호한 텍스트 → 빈 directive 반환", () => {
    const grounding = resolveHistoricalGrounding("현대 카페에서 커피 마시기");
    const directive = buildHistoricalPromptDirective(grounding);
    expect(directive).toBe("");
  });

  it("negative prompt에 avoid 요소 포함", () => {
    const grounding = resolveHistoricalGrounding("에도 시대 골목을 걷는 젊은 여성");
    const negative = buildHistoricalNegativePrompt(grounding);
    expect(negative.length).toBeGreaterThan(0);
    expect(negative.toLowerCase()).toContain("hanbok");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Validator 테스트
// ═══════════════════════════════════════════════════════════════════

describe("Historical Grounding Validator", () => {
  const baseCut: Cut = {
    cutNumber: 1,
    durationSec: 8,
    sceneDescription: "",
    cameraDirection: "eye-level",
    moodLighting: "warm afternoon",
    imagePrompt: "",
    endImagePrompt: "",
    videoPrompt: "",
    extendPrompt: "",
    transitionHint: "cut",
    characterConsistency: "",
    charactersInScene: [],
  };

  it("조선시대 시나리오 + 깨끗한 컷 → valid", () => {
    const cuts: Cut[] = [{
      ...baseCut,
      videoPrompt: "Wide shot of a thatched-roof jumak inn, a scholar in white dopo rests under eaves",
      sceneDescription: "주막에서 쉬는 선비",
    }];
    const result = validateHistoricalGrounding("조선시대 주막에서 비를 피하는 선비", cuts);
    expect(result.grounding.detected).toBe(true);
    expect(result.grounding.region).toBe("Korea");
    expect(result.valid).toBe(true);
  });

  it("조선시대 시나리오 + 기모노 포함 컷 → cross-cultural error", () => {
    const cuts: Cut[] = [{
      ...baseCut,
      videoPrompt: "A woman in traditional kimono walks through a Joseon marketplace",
      sceneDescription: "시장을 걷는 여성",
    }];
    const result = validateHistoricalGrounding("조선시대 시장 풍경", cuts);
    expect(result.valid).toBe(false);
    const crossCultural = result.cutWarnings
      .flatMap(cw => cw.warnings)
      .find(w => w.code === "mixed_asian_period_cues");
    expect(crossCultural).toBeDefined();
  });

  it("조선시대 시나리오 + smartphone 프롬프트 → anachronism warning", () => {
    const cuts: Cut[] = [{
      ...baseCut,
      videoPrompt: "Scholar holds a smartphone while sitting in traditional hanok",
    }];
    const result = validateHistoricalGrounding("조선시대 선비의 하루", cuts);
    const anachronism = result.cutWarnings
      .flatMap(cw => cw.warnings)
      .find(w => w.code === "anachronistic_object_risk");
    expect(anachronism).toBeDefined();
  });

  it("비역사 시나리오 → 검증 건너뛰기 (valid)", () => {
    const cuts: Cut[] = [{ ...baseCut, videoPrompt: "Modern office with glass walls" }];
    const result = validateHistoricalGrounding("현대 사무실 풍경", cuts);
    expect(result.grounding.detected).toBe(false);
    expect(result.valid).toBe(true);
    expect(result.cutWarnings).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Knowledge Base 테스트
// ═══════════════════════════════════════════════════════════════════

describe("Historical Knowledge Base", () => {
  it("'조선' → Korea/Joseon entry 반환", () => {
    const entries = lookupByTerm("조선");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].region).toBe("Korea");
    expect(entries[0].period).toBe("Joseon Dynasty");
  });

  it("'에도' → Japan/Edo entry 반환", () => {
    const entries = lookupByTerm("에도");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].region).toBe("Japan");
  });

  it("'청나라' → China/Qing entry 반환", () => {
    const entries = lookupByTerm("청나라");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].region).toBe("China");
  });

  it("없는 키워드 → 빈 배열", () => {
    const entries = lookupByTerm("xyznonexistent");
    expect(entries).toEqual([]);
  });

  it("knowledge base entries에 visualAnchors가 있다", () => {
    const joseon = lookupByTerm("조선");
    expect(joseon[0].visualAnchors.length).toBeGreaterThan(0);
    const categories = joseon[0].visualAnchors.map(va => va.category);
    expect(categories).toContain("costume");
    expect(categories).toContain("architecture");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Output Schema 검증
// ═══════════════════════════════════════════════════════════════════

describe("Historical Grounding Output Schema", () => {
  it("모든 필수 필드가 result에 포함된다", () => {
    const result = resolveHistoricalGrounding("조선시대 주막에서 비를 피하는 선비");
    // 필수 필드 존재 확인
    expect(result).toHaveProperty("detected");
    expect(result).toHaveProperty("region");
    expect(result).toHaveProperty("period");
    expect(result).toHaveProperty("eraApprox");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("sourceTerms");
    expect(result).toHaveProperty("resolvedMeaning");
    expect(result).toHaveProperty("visualAnchors");
    expect(result).toHaveProperty("avoid");
    expect(result).toHaveProperty("referenceEvidence");
    expect(result).toHaveProperty("warnings");

    // 타입 검증
    expect(typeof result.detected).toBe("boolean");
    expect(typeof result.confidence).toBe("number");
    expect(Array.isArray(result.sourceTerms)).toBe(true);
    expect(Array.isArray(result.visualAnchors)).toBe(true);
    expect(Array.isArray(result.avoid)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("visualAnchor에 필수 필드 포함", () => {
    const result = resolveHistoricalGrounding("에도 시대 골목을 걷는 젊은 여성");
    for (const va of result.visualAnchors) {
      expect(va).toHaveProperty("category");
      expect(va).toHaveProperty("description");
      expect(va).toHaveProperty("descriptionKo");
      expect(["costume", "architecture", "props", "lifestyle", "landscape"]).toContain(va.category);
    }
  });

  it("warning에 필수 필드 포함", () => {
    const result = resolveHistoricalGrounding("전통 아시아 옷을 입은 사람");
    for (const w of result.warnings) {
      expect(w).toHaveProperty("code");
      expect(w).toHaveProperty("message");
      expect(w).toHaveProperty("severity");
      expect(["info", "warning", "error"]).toContain(w.severity);
      const validCodes = [
        "missing_historical_resolution",
        "mixed_asian_period_cues",
        "anachronistic_object_risk",
        "missing_visual_evidence",
        "missing_cultural_anchors",
      ];
      expect(validCodes).toContain(w.code);
    }
  });
});
