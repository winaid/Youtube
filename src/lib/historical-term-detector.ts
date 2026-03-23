/**
 * Historical Term Detector — 시나리오 텍스트에서 아시아 역사/전통 단서를 감지.
 * 정확한 키워드 매칭 + 맥락 추론으로 DetectedHistoricalTerm[] 반환.
 */
import type { DetectedHistoricalTerm } from "@/types/historical-grounding";
import { HISTORICAL_KNOWLEDGE_BASE } from "./historical-knowledge-base";

// ── 감지 패턴 정의 ──

interface DetectionPattern {
  /** 매칭할 정규식 (case-insensitive) */
  pattern: RegExp;
  /** 추정 지역 */
  region: string | null;
  /** 추정 시대 */
  period: string | null;
  /** 기본 신뢰도 */
  confidence: number;
  /** 매칭 유형 */
  matchType: "exact" | "fuzzy" | "contextual";
}

/** Knowledge base에서 자동 생성되는 exact 패턴 */
function buildExactPatterns(): DetectionPattern[] {
  const patterns: DetectionPattern[] = [];
  for (const entry of HISTORICAL_KNOWLEDGE_BASE) {
    for (const term of entry.terms) {
      patterns.push({
        pattern: new RegExp(`(?:^|\\s|[,;.!?'"()\\[\\]])${escapeRegex(term)}(?:$|\\s|[,;.!?'"()\\[\\]])`, "i"),
        region: entry.region,
        period: entry.period,
        confidence: entry.region === "Ambiguous-Asia" ? 30 : 90,
        matchType: "exact",
      });
    }
  }
  return patterns;
}

/** 맥락 기반 fuzzy 패턴 — knowledge base 외 추가 단서 */
const CONTEXTUAL_PATTERNS: DetectionPattern[] = [
  // 한국
  { pattern: /한복/i, region: "Korea", period: null, confidence: 70, matchType: "fuzzy" },
  { pattern: /기와집/i, region: "Korea", period: null, confidence: 60, matchType: "fuzzy" },
  { pattern: /한옥/i, region: "Korea", period: null, confidence: 65, matchType: "fuzzy" },
  { pattern: /갓을?\s*(쓴|쓰고|쓰는)/i, region: "Korea", period: "Joseon Dynasty", confidence: 85, matchType: "contextual" },
  { pattern: /도포/i, region: "Korea", period: "Joseon Dynasty", confidence: 80, matchType: "contextual" },
  { pattern: /양반/i, region: "Korea", period: "Joseon Dynasty", confidence: 75, matchType: "contextual" },
  { pattern: /상투/i, region: "Korea", period: "Joseon Dynasty", confidence: 70, matchType: "contextual" },
  { pattern: /전차\s*(앞|뒤|옆|위|거리)/i, region: "Korea", period: "Korean Empire / Enlightenment Period", confidence: 60, matchType: "contextual" },

  // 일본
  { pattern: /기모노/i, region: "Japan", period: null, confidence: 70, matchType: "fuzzy" },
  { pattern: /kimono/i, region: "Japan", period: null, confidence: 70, matchType: "fuzzy" },
  { pattern: /사무라이/i, region: "Japan", period: null, confidence: 65, matchType: "fuzzy" },
  { pattern: /samurai/i, region: "Japan", period: null, confidence: 65, matchType: "fuzzy" },
  { pattern: /게이샤/i, region: "Japan", period: "Edo Period", confidence: 70, matchType: "fuzzy" },
  { pattern: /geisha/i, region: "Japan", period: "Edo Period", confidence: 70, matchType: "fuzzy" },
  { pattern: /쇼지/i, region: "Japan", period: null, confidence: 60, matchType: "fuzzy" },
  { pattern: /마치야/i, region: "Japan", period: "Edo Period", confidence: 75, matchType: "contextual" },

  // 중국
  { pattern: /치파오/i, region: "China", period: null, confidence: 65, matchType: "fuzzy" },
  { pattern: /qipao/i, region: "China", period: null, confidence: 65, matchType: "fuzzy" },
  { pattern: /사합원/i, region: "China", period: null, confidence: 70, matchType: "contextual" },
  { pattern: /siheyuan/i, region: "China", period: null, confidence: 70, matchType: "contextual" },
  { pattern: /변발/i, region: "China", period: "Qing Dynasty (Late)", confidence: 80, matchType: "contextual" },
  { pattern: /인력거/i, region: null, period: null, confidence: 40, matchType: "fuzzy" },

  // 범아시아 모호 표현
  { pattern: /동양\s*(전통|고대|옛)/i, region: "Ambiguous-Asia", period: "Unresolved", confidence: 25, matchType: "contextual" },
  { pattern: /전통\s*(아시아|동양)/i, region: "Ambiguous-Asia", period: "Unresolved", confidence: 25, matchType: "contextual" },
  { pattern: /asian\s*traditional/i, region: "Ambiguous-Asia", period: "Unresolved", confidence: 25, matchType: "contextual" },
  { pattern: /oriental\s*(style|clothing|robe|dress)/i, region: "Ambiguous-Asia", period: "Unresolved", confidence: 20, matchType: "contextual" },
  { pattern: /고대\s*아시아/i, region: "Ambiguous-Asia", period: "Unresolved", confidence: 25, matchType: "contextual" },
];

let _exactPatterns: DetectionPattern[] | null = null;

function getExactPatterns(): DetectionPattern[] {
  if (!_exactPatterns) _exactPatterns = buildExactPatterns();
  return _exactPatterns;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 시나리오 텍스트에서 역사적 단서를 감지.
 * @param text 원고/시나리오 텍스트
 * @returns 감지된 역사적 단서 배열 (신뢰도 내림차순)
 */
export function detectHistoricalTerms(text: string): DetectedHistoricalTerm[] {
  if (!text || text.trim().length === 0) return [];

  const results: DetectedHistoricalTerm[] = [];
  const seen = new Set<string>(); // 중복 방지

  // 1. Exact patterns from knowledge base
  for (const p of getExactPatterns()) {
    const match = text.match(p.pattern);
    if (match) {
      const matchedText = match[0].trim();
      const key = `${matchedText}|${p.region}|${p.period}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        term: matchedText,
        matchType: p.matchType,
        region: p.region,
        period: p.period,
        confidence: p.confidence,
      });
    }
  }

  // 2. Contextual / fuzzy patterns
  for (const p of CONTEXTUAL_PATTERNS) {
    const match = text.match(p.pattern);
    if (match) {
      const matchedText = match[0].trim();
      const key = `${matchedText}|${p.region}|${p.period}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        term: matchedText,
        matchType: p.matchType,
        region: p.region,
        period: p.period,
        confidence: p.confidence,
      });
    }
  }

  // 신뢰도 내림차순 정렬
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

/**
 * 감지 결과에서 다중 지역이 혼합되었는지 확인.
 * "Ambiguous-Asia"는 제외하고 실제 지역만 비교.
 */
export function hasMultipleRegions(terms: DetectedHistoricalTerm[]): boolean {
  const regions = new Set(
    terms
      .filter(t => t.region && t.region !== "Ambiguous-Asia")
      .map(t => t.region)
  );
  return regions.size > 1;
}

/**
 * 감지 결과에서 같은 지역 내 다중 시대가 혼합되었는지 확인.
 */
export function hasMixedPeriods(terms: DetectedHistoricalTerm[]): boolean {
  const regionPeriods = new Map<string, Set<string>>();
  for (const t of terms) {
    if (!t.region || !t.period || t.region === "Ambiguous-Asia") continue;
    const periods = regionPeriods.get(t.region) || new Set();
    periods.add(t.period);
    regionPeriods.set(t.region, periods);
  }
  for (const periods of regionPeriods.values()) {
    if (periods.size > 1) return true;
  }
  return false;
}
