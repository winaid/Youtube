/**
 * Historical Grounding Resolver — 감지된 역사적 단서를 종합하여
 * 최종 HistoricalGroundingResult를 생성.
 *
 * 핵심 원칙:
 * 1. generic "Asian historical"로 처리하지 말 것
 * 2. 불확실하면 ambiguity warning 표시
 * 3. mixed dynasty / vague oriental / pan-East-Asian 혼합 금지
 */
import type {
  HistoricalGroundingResult,
  HistoricalVisualAnchor,
  ReferenceEvidence,
} from "@/types/historical-grounding";
import { emptyGroundingResult } from "@/types/historical-grounding";
import { detectHistoricalTerms, hasMultipleRegions, hasMixedPeriods } from "./historical-term-detector";
import { lookupByTerm } from "./historical-knowledge-base";

/**
 * 시나리오 텍스트를 분석하여 역사적 맥락을 구체화.
 * @param text 원고/시나리오 텍스트
 * @returns HistoricalGroundingResult
 */
export function resolveHistoricalGrounding(text: string): HistoricalGroundingResult {
  if (!text || text.trim().length === 0) return emptyGroundingResult();

  const detectedTerms = detectHistoricalTerms(text);
  if (detectedTerms.length === 0) return emptyGroundingResult();

  const result: HistoricalGroundingResult = {
    detected: true,
    region: null,
    period: null,
    eraApprox: null,
    confidence: 0,
    sourceTerms: [],
    resolvedMeaning: {},
    visualAnchors: [],
    avoid: [],
    referenceEvidence: [],
    warnings: [],
  };

  // ── 1. sourceTerms & resolvedMeaning 수집 ──
  for (const dt of detectedTerms) {
    result.sourceTerms.push(dt.term);
    const entries = lookupByTerm(dt.term);
    if (entries.length > 0) {
      result.resolvedMeaning[dt.term] = `${entries[0].region} — ${entries[0].period} (${entries[0].eraApprox})`;
    } else if (dt.region && dt.period) {
      result.resolvedMeaning[dt.term] = `${dt.region} — ${dt.period}`;
    } else if (dt.region) {
      result.resolvedMeaning[dt.term] = `${dt.region} — period unresolved`;
    }
  }

  // ── 2. 지역/시대 결정 ──
  const concreteTerms = detectedTerms.filter(t => t.region && t.region !== "Ambiguous-Asia");
  const ambiguousTerms = detectedTerms.filter(t => t.region === "Ambiguous-Asia");

  if (concreteTerms.length === 0 && ambiguousTerms.length > 0) {
    // 모호한 표현만 있음 → 경고 + 낮은 신뢰도
    result.confidence = Math.max(...ambiguousTerms.map(t => t.confidence));
    result.warnings.push({
      code: "missing_historical_resolution",
      message: "역사적 맥락이 감지되었으나 구체적 지역/시대를 특정할 수 없습니다. '전통 아시아' 같은 모호한 표현 대신 구체적 국가와 시대를 명시해주세요.",
      severity: "warning",
      suggestion: "예: '조선시대 한양' 또는 '에도시대 교토'처럼 지역과 시대를 구체적으로 지정",
    });
    result.warnings.push({
      code: "missing_cultural_anchors",
      message: "복식, 건축, 소품 등 문화적 맥락을 특정할 고유 단서가 부족합니다.",
      severity: "warning",
    });
    return result;
  }

  // ── 3. 다중 지역 혼합 감지 ──
  if (hasMultipleRegions(concreteTerms)) {
    const regions = [...new Set(concreteTerms.map(t => t.region).filter(Boolean))];
    result.confidence = Math.min(40, Math.max(...concreteTerms.map(t => t.confidence)));
    result.warnings.push({
      code: "mixed_asian_period_cues",
      message: `서로 다른 아시아 지역의 단서가 혼합되어 있습니다: ${regions.join(", ")}. 하나의 장면에 여러 문화권의 요소를 섞으면 역사적 정확성이 떨어집니다.`,
      severity: "error",
      suggestion: "한 장면에는 하나의 지역/시대만 사용하세요.",
    });
    // 가장 높은 신뢰도의 지역을 primary로 설정
    const primary = concreteTerms[0]; // 이미 신뢰도 내림차순
    result.region = primary.region;
    result.period = primary.period;
    // visualAnchors는 primary만 사용
    populateFromKnowledge(result, primary.term);
    return result;
  }

  // ── 4. 같은 지역 내 다중 시대 혼합 감지 ──
  if (hasMixedPeriods(concreteTerms)) {
    const periods = [...new Set(concreteTerms.map(t => t.period).filter(Boolean))];
    result.warnings.push({
      code: "mixed_asian_period_cues",
      message: `같은 지역 내에서 서로 다른 시대의 단서가 혼합되어 있습니다: ${periods.join(", ")}. 시대착오 위험이 있습니다.`,
      severity: "warning",
      suggestion: "하나의 시대로 통일하거나, 시대 전환 장면임을 명시하세요.",
    });
  }

  // ── 5. Primary 지역/시대 설정 (가장 높은 신뢰도) ──
  const primary = concreteTerms[0];
  result.region = primary.region;
  result.period = primary.period;
  result.confidence = primary.confidence;

  // ── 6. Knowledge base에서 visualAnchors/avoid/evidence 수집 ──
  const usedEntries = new Set<string>();
  for (const dt of concreteTerms) {
    const entries = lookupByTerm(dt.term);
    for (const entry of entries) {
      if (entry.region !== result.region) continue;
      const entryKey = `${entry.region}|${entry.period}`;
      if (usedEntries.has(entryKey)) continue;
      usedEntries.add(entryKey);

      if (!result.eraApprox && entry.eraApprox && entry.eraApprox !== "Unknown") {
        result.eraApprox = entry.eraApprox;
      }
      if (!result.period && entry.period && entry.period !== "Unresolved") {
        result.period = entry.period;
      }
      mergeVisualAnchors(result.visualAnchors, entry.visualAnchors);
      mergeStringArray(result.avoid, entry.avoid);
      mergeEvidence(result.referenceEvidence, entry.evidence);
    }
  }

  // fallback: knowledge base에 없는 term이 primary인 경우
  if (result.visualAnchors.length === 0) {
    populateFromKnowledge(result, primary.term);
  }

  // ── 7. 시각적 증거 부족 경고 ──
  if (result.visualAnchors.length === 0) {
    result.warnings.push({
      code: "missing_visual_evidence",
      message: "이 시대/지역에 대한 구체적 시각 디테일(복식, 건축, 소품)을 도출할 근거가 부족합니다.",
      severity: "warning",
      suggestion: "복식, 건축, 소품 등 시각적 단서를 시나리오에 추가하면 더 정확한 영상을 생성할 수 있습니다.",
    });
  }

  // ── 8. 시대착오 위험 감지 ──
  checkAnachronisms(text, result);

  // ── 9. 신뢰도 보정 ──
  adjustConfidence(result);

  return result;
}

// ── 내부 헬퍼 ──

function populateFromKnowledge(result: HistoricalGroundingResult, term: string): void {
  const entries = lookupByTerm(term);
  for (const entry of entries) {
    if (entry.region === "Ambiguous-Asia") continue;
    if (!result.region) result.region = entry.region;
    if (!result.period) result.period = entry.period;
    if (!result.eraApprox) result.eraApprox = entry.eraApprox;
    mergeVisualAnchors(result.visualAnchors, entry.visualAnchors);
    mergeStringArray(result.avoid, entry.avoid);
    mergeEvidence(result.referenceEvidence, entry.evidence);
    break; // 첫 번째 entry만
  }
}

function mergeVisualAnchors(target: HistoricalVisualAnchor[], source: HistoricalVisualAnchor[]): void {
  for (const s of source) {
    const exists = target.some(t => t.description === s.description);
    if (!exists) target.push(s);
  }
}

function mergeStringArray(target: string[], source: string[]): void {
  for (const s of source) {
    if (!target.includes(s)) target.push(s);
  }
}

function mergeEvidence(target: ReferenceEvidence[], source: ReferenceEvidence[]): void {
  for (const s of source) {
    const exists = target.some(t => t.content === s.content);
    if (!exists) target.push(s);
  }
}

/** 시대착오적 요소 감지 */
const ANACHRONISM_PATTERNS: { pattern: RegExp; label: string; maxEra: number }[] = [
  { pattern: /스마트폰|smartphone|핸드폰|cellphone|휴대폰/i, label: "스마트폰/휴대폰", maxEra: 1990 },
  { pattern: /자동차|automobile|car\b/i, label: "자동차", maxEra: 1885 },
  { pattern: /전기|electric\s*light|전등|형광등/i, label: "전기 조명", maxEra: 1880 },
  { pattern: /네온|neon\s*sign/i, label: "네온 사인", maxEra: 1910 },
  { pattern: /컴퓨터|computer|노트북|laptop/i, label: "컴퓨터/노트북", maxEra: 1970 },
  { pattern: /TV|텔레비전|television/i, label: "텔레비전", maxEra: 1930 },
  { pattern: /플라스틱|plastic/i, label: "플라스틱 제품", maxEra: 1907 },
  { pattern: /콘크리트\s*(건물|도로|빌딩)|concrete\s*(building|road)/i, label: "콘크리트 건축물", maxEra: 1850 },
  { pattern: /LED/i, label: "LED 조명", maxEra: 1960 },
  { pattern: /아스팔트|asphalt\s*road/i, label: "아스팔트 도로", maxEra: 1870 },
];

function checkAnachronisms(text: string, result: HistoricalGroundingResult): void {
  if (!result.eraApprox) return;

  // eraApprox에서 끝 연도 추출 (예: "1392–1897" → 1897)
  const eraMatch = result.eraApprox.match(/(\d{3,4})\s*[–-]\s*(\d{3,4})/);
  if (!eraMatch) return;
  const eraEnd = parseInt(eraMatch[2], 10);

  for (const a of ANACHRONISM_PATTERNS) {
    if (a.pattern.test(text) && eraEnd < a.maxEra) {
      result.warnings.push({
        code: "anachronistic_object_risk",
        message: `'${a.label}'은(는) ${result.period} (${result.eraApprox})에 존재하지 않을 가능성이 높습니다.`,
        severity: "warning",
        suggestion: `이 시대에 적합한 대안을 사용하거나, 의도적인 시대 혼합이라면 명시해주세요.`,
      });
    }
  }
}

/** 신뢰도 보정 — 경고 수에 따라 하향 조정 */
function adjustConfidence(result: HistoricalGroundingResult): void {
  const errorCount = result.warnings.filter(w => w.severity === "error").length;
  const warningCount = result.warnings.filter(w => w.severity === "warning").length;

  if (errorCount > 0) {
    result.confidence = Math.min(result.confidence, 40);
  } else if (warningCount > 2) {
    result.confidence = Math.min(result.confidence, 60);
  }

  // visualAnchors가 풍부하면 신뢰도 보너스
  if (result.visualAnchors.length >= 3 && result.confidence < 95) {
    result.confidence = Math.min(95, result.confidence + 5);
  }
}

/**
 * HistoricalGroundingResult를 VEO 프롬프트 주입용 텍스트로 변환.
 * generate-cuts의 system prompt에 삽입.
 */
export function buildHistoricalPromptDirective(grounding: HistoricalGroundingResult): string {
  if (!grounding.detected || grounding.confidence < 30) return "";

  const lines: string[] = [];
  lines.push("=== HISTORICAL GROUNDING DIRECTIVE ===");

  if (grounding.region && grounding.period) {
    lines.push(`SETTING: ${grounding.region}, ${grounding.period} (${grounding.eraApprox || "era unknown"})`);
  }

  if (grounding.visualAnchors.length > 0) {
    lines.push("");
    lines.push("REQUIRED VISUAL ANCHORS (use these specific details instead of generic descriptions):");
    for (const va of grounding.visualAnchors) {
      lines.push(`  [${va.category.toUpperCase()}] ${va.description}`);
    }
  }

  if (grounding.avoid.length > 0) {
    lines.push("");
    lines.push("STRICTLY AVOID (these are anachronistic or culturally incorrect for this setting):");
    for (const a of grounding.avoid) {
      lines.push(`  - ${a}`);
    }
  }

  lines.push("");
  lines.push("RULES:");
  lines.push("- Do NOT use generic 'Asian historical' or 'oriental' descriptions.");
  lines.push("- Do NOT mix visual elements from different Asian cultures in the same scene.");
  lines.push("- Every costume, architecture, and prop must be specific to the identified region and period.");
  lines.push("- When in doubt, prefer historically documented specifics over decorative generalizations.");
  lines.push("=== END HISTORICAL GROUNDING ===");

  return lines.join("\n");
}

/**
 * HistoricalGroundingResult에서 VEO negative prompt에 추가할 요소 추출.
 */
export function buildHistoricalNegativePrompt(grounding: HistoricalGroundingResult): string {
  if (!grounding.detected || grounding.avoid.length === 0) return "";
  return grounding.avoid.join(", ");
}
