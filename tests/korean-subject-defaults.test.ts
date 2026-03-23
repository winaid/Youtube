/**
 * Korean Subject Defaults 테스트
 *
 * 테스트 케이스:
 * 1) 피곤한 현대인
 * 2) 서울 오피스텔에 혼자 있는 20대 한국 여성
 * 3) 현대 한국 직장인이 지하철에서 멍하니 서 있는 장면
 */
import { describe, it, expect } from "vitest";
import {
  detectSubjectContext,
  buildKoreanSubjectBlock,
  validateKoreanDefaults,
  KOREAN_LOCATION_ANCHORS,
  KOREAN_SUBJECT_VARIANTS,
} from "../src/lib/korean-subject-defaults";

// ═══════════════════════════════════════════════════════════════════
// 1. Subject Context Detection
// ═══════════════════════════════════════════════════════════════════

describe("Subject Context Detection", () => {
  it("TC1: 피곤한 현대인 → modern Korean, gender unspecified", () => {
    const ctx = detectSubjectContext("피곤한 현대인");
    expect(ctx.isModernSetting).toBe(true);
    expect(ctx.hasExplicitNationality).toBe(false);
    expect(ctx.detectedGender).toBe("unspecified");
    expect(ctx.suggestedSubjectLabel).toContain("Korean");
    expect(ctx.koreanLocationAnchors.length).toBeGreaterThan(0);
  });

  it("TC2: 서울 오피스텔에 혼자 있는 20대 한국 여성 → modern Korean, female", () => {
    const ctx = detectSubjectContext("서울 오피스텔에 혼자 있는 20대 한국 여성");
    expect(ctx.isModernSetting).toBe(true);
    expect(ctx.hasExplicitNationality).toBe(false);
    expect(ctx.detectedGender).toBe("female");
    expect(ctx.genderSource).toBe("여성");
    expect(ctx.suggestedSubjectLabel).toContain("Korean");
    expect(ctx.suggestedSubjectLabel).toContain("woman");
    // 오피스텔 location anchor 포함
    const hasOfficetel = ctx.koreanLocationAnchors.some(a => a.toLowerCase().includes("officetel"));
    expect(hasOfficetel).toBe(true);
  });

  it("TC3: 현대 한국 직장인이 지하철에서 멍하니 서 있는 장면 → modern Korean worker, unspecified gender", () => {
    const ctx = detectSubjectContext("현대 한국 직장인이 지하철에서 멍하니 서 있는 장면");
    expect(ctx.isModernSetting).toBe(true);
    expect(ctx.hasExplicitNationality).toBe(false);
    expect(ctx.detectedGender).toBe("unspecified");
    // 직장인 → office worker label
    expect(ctx.suggestedSubjectLabel).toContain("Korean");
    expect(ctx.suggestedSubjectLabel.toLowerCase()).toContain("office");
    // 지하철 anchor
    const hasSubway = ctx.koreanLocationAnchors.some(a => a.toLowerCase().includes("subway"));
    expect(hasSubway).toBe(true);
  });

  it("역사 배경은 isModernSetting=false", () => {
    const ctx = detectSubjectContext("조선시대 양반이 걸어가는 장면");
    expect(ctx.isModernSetting).toBe(false);
  });

  it("명시적 외국 국적이면 hasExplicitNationality=true", () => {
    const ctx = detectSubjectContext("일본인 관광객이 카페에 앉아 있다");
    expect(ctx.hasExplicitNationality).toBe(true);
    expect(ctx.explicitNationality).toBe("Japanese");
  });

  it("빈 텍스트 → modern by default, unspecified gender", () => {
    const ctx = detectSubjectContext("");
    expect(ctx.isModernSetting).toBe(true);
    expect(ctx.detectedGender).toBe("unspecified");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Gender Detection (남성 편향 방지)
// ═══════════════════════════════════════════════════════════════════

describe("Gender Detection", () => {
  it("여성 키워드(여자, 여성, 엄마, 그녀 등) → female", () => {
    expect(detectSubjectContext("카페에 앉은 여자").detectedGender).toBe("female");
    expect(detectSubjectContext("할머니가 시장에서 장을 보고 있다").detectedGender).toBe("female");
    expect(detectSubjectContext("여학생이 도서관에서 공부한다").detectedGender).toBe("female");
  });

  it("남성 키워드(남자, 남성, 아버지 등) → male", () => {
    expect(detectSubjectContext("남자가 걸어간다").detectedGender).toBe("male");
    expect(detectSubjectContext("할아버지가 공원에 앉아 있다").detectedGender).toBe("male");
  });

  it("성별 키워드 없음 → unspecified (남성 고정 안 함)", () => {
    expect(detectSubjectContext("피곤한 현대인").detectedGender).toBe("unspecified");
    expect(detectSubjectContext("사무실에서 야근하는 사람").detectedGender).toBe("unspecified");
    expect(detectSubjectContext("편의점에서 라면 먹는 누군가").detectedGender).toBe("unspecified");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Korean Subject Block Builder
// ═══════════════════════════════════════════════════════════════════

describe("Korean Subject Block Builder", () => {
  it("현대 한국인 → block에 필수 요소 포함", () => {
    const ctx = detectSubjectContext("피곤한 현대인");
    const block = buildKoreanSubjectBlock(ctx);
    expect(block).toContain("현대 인물 기본값");
    expect(block).toContain("contemporary Korean");
    expect(block).toContain("성별 고정 금지");
    expect(block).toContain("stereotype 금지");
    expect(block).toContain("추천 인물 라벨");
  });

  it("여성 감지 시 → block에 여성 명시", () => {
    const ctx = detectSubjectContext("서울 오피스텔에 혼자 있는 20대 한국 여성");
    const block = buildKoreanSubjectBlock(ctx);
    expect(block).toContain("여성");
    expect(block).not.toContain("성별 미지정");
  });

  it("성별 미지정 시 → 다양한 성별 배치 권장", () => {
    const ctx = detectSubjectContext("피곤한 현대인");
    const block = buildKoreanSubjectBlock(ctx);
    expect(block).toContain("성별 미지정");
    expect(block).toContain("다양한 성별 배치");
  });

  it("역사 배경 → 빈 블록 반환", () => {
    const ctx = detectSubjectContext("조선시대 선비가 산에 올라갔다");
    const block = buildKoreanSubjectBlock(ctx);
    expect(block).toBe("");
  });

  it("외국 국적 명시 → 빈 블록 반환", () => {
    const ctx = detectSubjectContext("미국인 여행자가 명동을 걸어간다");
    const block = buildKoreanSubjectBlock(ctx);
    expect(block).toBe("");
  });

  it("한국 생활 맥락(location anchors)이 block에 포함", () => {
    const ctx = detectSubjectContext("현대 한국 직장인이 지하철에서 멍하니 서 있는 장면");
    const block = buildKoreanSubjectBlock(ctx);
    // subway or 지하철 anchor가 block에 반영
    expect(block.toLowerCase()).toMatch(/subway|지하철|seoul/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Location Anchor Detection
// ═══════════════════════════════════════════════════════════════════

describe("Korean Location Anchors", () => {
  it("오피스텔 → Seoul officetel anchor", () => {
    const ctx = detectSubjectContext("오피스텔에서 혼자 있는 사람");
    expect(ctx.koreanLocationAnchors).toContain("Seoul officetel");
  });

  it("지하철 → subway platform anchor", () => {
    const ctx = detectSubjectContext("지하철을 기다리는 사람");
    expect(ctx.koreanLocationAnchors).toContain("subway platform in Seoul");
  });

  it("특정 장소 언급 없으면 기본 anchor 제공", () => {
    const ctx = detectSubjectContext("피곤한 현대인");
    expect(ctx.koreanLocationAnchors.length).toBeGreaterThanOrEqual(1);
  });

  it("KOREAN_LOCATION_ANCHORS 상수에 다양한 장소 포함", () => {
    expect(KOREAN_LOCATION_ANCHORS.length).toBeGreaterThanOrEqual(10);
    const joined = KOREAN_LOCATION_ANCHORS.join(" ").toLowerCase();
    expect(joined).toContain("officetel");
    expect(joined).toContain("subway");
    expect(joined).toContain("cafe");
    expect(joined).toContain("convenience");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Subject Variants
// ═══════════════════════════════════════════════════════════════════

describe("Korean Subject Variants", () => {
  it("남녀 모두에 대한 variants가 있다", () => {
    expect(KOREAN_SUBJECT_VARIANTS.youngFemale.length).toBeGreaterThan(0);
    expect(KOREAN_SUBJECT_VARIANTS.youngMale.length).toBeGreaterThan(0);
    expect(KOREAN_SUBJECT_VARIANTS.middleAgeFemale.length).toBeGreaterThan(0);
    expect(KOREAN_SUBJECT_VARIANTS.middleAgeMale.length).toBeGreaterThan(0);
    expect(KOREAN_SUBJECT_VARIANTS.elderFemale.length).toBeGreaterThan(0);
    expect(KOREAN_SUBJECT_VARIANTS.elderMale.length).toBeGreaterThan(0);
  });

  it("gender-neutral variant도 있다", () => {
    expect(KOREAN_SUBJECT_VARIANTS.neutral.length).toBeGreaterThan(0);
    // neutral에 'man'/'woman' 포함 안 됨
    for (const v of KOREAN_SUBJECT_VARIANTS.neutral) {
      expect(v.toLowerCase()).not.toContain(" man");
      expect(v.toLowerCase()).not.toContain(" woman");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Validator
// ═══════════════════════════════════════════════════════════════════

describe("Korean Defaults Validator", () => {
  const baseCut = (videoPrompt: string) => ({
    videoPrompt,
    shotCategory: "character-driven",
  });

  it("현대 한국 장면에 Korean anchor 없으면 warning", () => {
    const subjectCtx = detectSubjectContext("피곤한 현대인");
    const cuts = [
      baseCut("A tired person sits alone in a dimly lit room, staring at a wall"),
    ];
    const warnings = validateKoreanDefaults(cuts, { subjectContext: subjectCtx });
    const missingAnchor = warnings.find(w => w.code === "missing_korean_anchor");
    expect(missingAnchor).toBeDefined();
  });

  it("현대 한국 장면에 Korean anchor 있으면 no warning", () => {
    const subjectCtx = detectSubjectContext("피곤한 현대인");
    const cuts = [
      baseCut("A tired Korean office worker sits in Seoul officetel, staring at laptop"),
    ];
    const warnings = validateKoreanDefaults(cuts, { subjectContext: subjectCtx });
    const missingAnchor = warnings.find(w => w.code === "missing_korean_anchor");
    expect(missingAnchor).toBeUndefined();
  });

  it("성별 미지정인데 모든 컷이 남성이면 male_bias_detected warning", () => {
    const subjectCtx = detectSubjectContext("피곤한 현대인");
    const cuts = [
      baseCut("A young man walks down the street tired"),
      baseCut("The man sits in his office late at night"),
      baseCut("He stares at his phone in the subway"),
    ];
    const warnings = validateKoreanDefaults(cuts, { subjectContext: subjectCtx });
    const maleBias = warnings.find(w => w.code === "male_bias_detected");
    expect(maleBias).toBeDefined();
  });

  it("성별이 명시되어 있으면 male_bias 검사 안 함", () => {
    const subjectCtx = detectSubjectContext("남자가 야근하는 장면");
    const cuts = [
      baseCut("A man works late at the Korean office"),
      baseCut("He walks to Seoul subway station"),
    ];
    const warnings = validateKoreanDefaults(cuts, { subjectContext: subjectCtx });
    const maleBias = warnings.find(w => w.code === "male_bias_detected");
    // gender is "male" (detected from 남자), so no bias check
    expect(maleBias).toBeUndefined();
  });

  it("외국 국적 명시된 경우 korean anchor warning 안 발생", () => {
    const subjectCtx = detectSubjectContext("미국인 관광객이 거리를 걷는다");
    const cuts = [
      baseCut("An American tourist walks down the street"),
    ];
    const warnings = validateKoreanDefaults(cuts, { subjectContext: subjectCtx });
    const missingAnchor = warnings.find(w => w.code === "missing_korean_anchor");
    expect(missingAnchor).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Output Schema 검증
// ═══════════════════════════════════════════════════════════════════

describe("Subject Context Output Schema", () => {
  it("TC1: 피곤한 현대인 — 모든 필수 필드 존재", () => {
    const ctx = detectSubjectContext("피곤한 현대인");
    expect(ctx).toHaveProperty("isModernSetting");
    expect(ctx).toHaveProperty("hasExplicitNationality");
    expect(ctx).toHaveProperty("explicitNationality");
    expect(ctx).toHaveProperty("detectedGender");
    expect(ctx).toHaveProperty("genderSource");
    expect(ctx).toHaveProperty("suggestedSubjectLabel");
    expect(ctx).toHaveProperty("koreanLocationAnchors");

    expect(typeof ctx.isModernSetting).toBe("boolean");
    expect(typeof ctx.hasExplicitNationality).toBe("boolean");
    expect(typeof ctx.suggestedSubjectLabel).toBe("string");
    expect(Array.isArray(ctx.koreanLocationAnchors)).toBe(true);
  });

  it("TC2: 서울 오피스텔 여성 — 성별과 장소 정확", () => {
    const ctx = detectSubjectContext("서울 오피스텔에 혼자 있는 20대 한국 여성");
    expect(ctx.isModernSetting).toBe(true);
    expect(ctx.detectedGender).toBe("female");
    expect(ctx.suggestedSubjectLabel.toLowerCase()).toContain("woman");
    expect(ctx.koreanLocationAnchors.some(a => a.includes("officetel"))).toBe(true);
  });

  it("TC3: 직장인 지하철 — 직업과 장소 앵커 정확", () => {
    const ctx = detectSubjectContext("현대 한국 직장인이 지하철에서 멍하니 서 있는 장면");
    expect(ctx.isModernSetting).toBe(true);
    expect(ctx.detectedGender).toBe("unspecified");
    expect(ctx.suggestedSubjectLabel.toLowerCase()).toMatch(/office|worker/);
    expect(ctx.koreanLocationAnchors.some(a => a.toLowerCase().includes("subway"))).toBe(true);
  });
});
