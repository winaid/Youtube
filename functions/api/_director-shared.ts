/**
 * _director-shared.ts — search-director / recommend-director 공통 유틸리티
 *
 * 목적:
 * - slug ID 생성
 * - grounding source 추출 및 정규화
 * - grounding 품질 점수(groundingQuality) 계산
 * - 이름 기반 중복 판정
 * - 추천 사유 품질 검증
 * - warning 정리 헬퍼
 *
 * 캐시 관련:
 * - 이 모듈에는 어떤 형태의 캐시도 없다.
 * - 결과 재사용, KV 저장, TTL 설계, 입력 정규화 캐시 키 생성 전부 없다.
 * - 매 호출마다 입력을 새로 처리한다.
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface GroundingSource {
  title: string;
  url: string;
}

/**
 * Grounding 품질 점수 — 단순 boolean이 아닌 정량 평가.
 *
 * 평가 기준 (모두 0-1 범위, 가중합산):
 * 1. sourceCount  — grounding source 개수 (0개=0, 1개=0.3, 2개=0.6, 3+개=1.0)
 * 2. diversity    — 고유 도메인 비율 (전부 같은 도메인이면 낮음)
 * 3. relevance    — source 제목/URL에 감독명·장르·작품명 등이 포함되는 비율
 * 4. localWebOverlap — 로컬 데이터와 웹 데이터가 상호 보강되면 가산
 *
 * 최종 점수: 0-100 정수 (0=근거 없음, 100=매우 신뢰)
 */
export interface GroundingQuality {
  score: number;           // 0-100
  sourceCount: number;
  uniqueDomains: number;
  relevantSources: number; // 관련성 높은 소스 수
  label: GroundingLabel;   // UI 표시용
  details: string;         // 점수 산출 근거 (디버그용)
}

export type GroundingLabel =
  | "strong"       // 70+: 다수 소스, 높은 관련성
  | "moderate"     // 40-69: 소수 소스 또는 중간 관련성
  | "weak"         // 1-39: 소스 있지만 관련성 낮음
  | "none";        // 0: 소스 없음

// ═══════════════════════════════════════════════════════════════════
// Slug ID 생성
// ═══════════════════════════════════════════════════════════════════

const REGION_SLUG: Record<string, string> = {
  "한국": "kr", "일본": "jp", "중국": "cn", "유럽": "eu",
  "미국": "us", "인도": "in", "중동": "me", "동남아": "sea",
  "중남미": "la", "아프리카": "af", "오세아니아": "oc",
};

/**
 * 웹 검색 결과용 slug ID 생성.
 * 형식: web-{regionSlug}-{lastNameSlug}
 */
export function generateSlugId(name: string, region: string): string {
  const rSlug = REGION_SLUG[region] ?? "xx";
  const nameSlug = name.split(" ").pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "unknown";
  return `web-${rSlug}-${nameSlug}`;
}

// ═══════════════════════════════════════════════════════════════════
// Grounding Source 추출 및 정규화
// ═══════════════════════════════════════════════════════════════════

interface RawGroundingChunk {
  web?: { uri: string; title: string };
}

/**
 * Gemini groundingMetadata에서 소스를 추출하고 정규화한다.
 * - 빈 title/url 제거
 * - 중복 URL 제거
 */
export function extractGroundingSources(
  groundingChunks: RawGroundingChunk[] | undefined | null,
): GroundingSource[] {
  if (!groundingChunks || groundingChunks.length === 0) return [];

  const seen = new Set<string>();
  const sources: GroundingSource[] = [];

  for (const chunk of groundingChunks) {
    if (!chunk.web) continue;
    const url = chunk.web.uri?.trim();
    const title = chunk.web.title?.trim();
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    sources.push({ title: title || url, url });
  }

  return sources;
}

// ═══════════════════════════════════════════════════════════════════
// Grounding 품질 점수 계산
// ═══════════════════════════════════════════════════════════════════

/**
 * 도메인 추출 (간이).
 * "https://en.wikipedia.org/wiki/..." → "wikipedia.org"
 */
function extractDomain(url: string): string {
  try {
    const host = new URL(url).hostname;
    // 2차 도메인까지만 (en.wikipedia.org → wikipedia.org)
    const parts = host.split(".");
    if (parts.length >= 2) {
      return parts.slice(-2).join(".");
    }
    return host;
  } catch {
    return url;
  }
}

/**
 * Grounding 품질 점수를 계산한다.
 *
 * @param sources - 정규화된 grounding source 배열
 * @param relevanceKeywords - 관련성 판단 키워드 (감독명, 장르, 작품명 등)
 * @param hasLocalOverlap - 로컬 데이터와 웹 데이터가 보강 관계인지
 */
export function computeGroundingQuality(
  sources: GroundingSource[],
  relevanceKeywords: string[] = [],
  hasLocalOverlap: boolean = false,
): GroundingQuality {
  if (sources.length === 0) {
    return {
      score: 0,
      sourceCount: 0,
      uniqueDomains: 0,
      relevantSources: 0,
      label: "none",
      details: "grounding source 없음",
    };
  }

  const detailParts: string[] = [];

  // 1. sourceCount (0-30점)
  const countScore = sources.length === 1 ? 10 : sources.length === 2 ? 20 : Math.min(30, sources.length * 8);
  detailParts.push(`sources=${sources.length}→${countScore}pts`);

  // 2. diversity — 고유 도메인 비율 (0-25점)
  const domains = new Set(sources.map(s => extractDomain(s.url)));
  const uniqueDomains = domains.size;
  const diversityRatio = sources.length > 0 ? uniqueDomains / sources.length : 0;
  const diversityScore = Math.round(diversityRatio * 25);
  detailParts.push(`domains=${uniqueDomains}/${sources.length}→${diversityScore}pts`);

  // 3. relevance — source 제목에 관련 키워드가 포함되는 비율 (0-35점)
  let relevantSources = 0;
  if (relevanceKeywords.length > 0) {
    const lowerKeywords = relevanceKeywords
      .filter(k => k && k.length >= 2)
      .map(k => k.toLowerCase());

    for (const src of sources) {
      const text = `${src.title} ${src.url}`.toLowerCase();
      if (lowerKeywords.some(kw => text.includes(kw))) {
        relevantSources++;
      }
    }
    const relevanceRatio = sources.length > 0 ? relevantSources / sources.length : 0;
    const relevanceScore = Math.round(relevanceRatio * 35);
    detailParts.push(`relevant=${relevantSources}/${sources.length}→${relevanceScore}pts`);
  } else {
    // 키워드 없으면 기본 15점 (소스 존재 자체에 가치)
    detailParts.push("no keywords→15pts baseline");
  }
  const relevanceScore = relevanceKeywords.length > 0
    ? Math.round((sources.length > 0 ? relevantSources / sources.length : 0) * 35)
    : 15;

  // 4. localWebOverlap 보너스 (0-10점)
  const overlapBonus = hasLocalOverlap ? 10 : 0;
  if (hasLocalOverlap) detailParts.push("local-web overlap→+10pts");

  // 합산
  const rawScore = countScore + diversityScore + relevanceScore + overlapBonus;
  const score = Math.min(100, Math.max(0, rawScore));

  // 라벨 결정
  let label: GroundingLabel;
  if (score >= 70) label = "strong";
  else if (score >= 40) label = "moderate";
  else if (score > 0) label = "weak";
  else label = "none";

  return {
    score,
    sourceCount: sources.length,
    uniqueDomains,
    relevantSources,
    label,
    details: detailParts.join(", "),
  };
}

// ═══════════════════════════════════════════════════════════════════
// 이름 기반 중복 판정
// ═══════════════════════════════════════════════════════════════════

/**
 * 이름 정규화: 공백/하이픈 제거 + lowercase.
 * "Bong Joon-ho" → "bongjoonho"
 */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_.]/g, "");
}

/**
 * 두 감독 이름이 동일 인물인지 판정.
 * - 정규화된 이름 완전 일치
 * - 또는 한쪽이 다른 쪽의 부분 문자열 (성만 겹치는 경우 방지: 3자 이상)
 */
export function isSameDirector(nameA: string, nameB: string): boolean {
  const a = normalizeName(nameA);
  const b = normalizeName(nameB);
  if (a === b) return true;
  // 부분 일치: 짧은 쪽이 3자 이상이고 긴 쪽에 포함
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 3 && longer.includes(shorter)) return true;
  return false;
}

/**
 * 로컬 감독 이름 Set 생성 (중복 판정용).
 */
export function buildLocalNameSet(
  localDirectors: Array<{ name: string; nameKo?: string }>,
): Set<string> {
  const names = new Set<string>();
  for (const d of localDirectors) {
    names.add(normalizeName(d.name));
    if (d.nameKo) names.add(normalizeName(d.nameKo));
  }
  return names;
}

/**
 * 웹 감독이 로컬 풀과 중복인지 검사.
 */
export function isLocalDuplicate(
  webName: string,
  webNameKo: string | undefined,
  localNameSet: Set<string>,
): boolean {
  if (localNameSet.has(normalizeName(webName))) return true;
  if (webNameKo && localNameSet.has(normalizeName(webNameKo))) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// 추천 사유 품질 검증
// ═══════════════════════════════════════════════════════════════════

/**
 * 추천 사유가 너무 추상적/짧은지 검사.
 * true면 "구체성 부족" 경고 대상.
 */
export function isGenericReason(reason: string | undefined | null): boolean {
  if (!reason) return true;
  if (reason === "(이유 미제공)") return true;
  if (reason.length < 10) return true;
  // 너무 일반적인 표현만 있는지
  const genericPatterns = [
    /^잘 어울립니다\.?$/,
    /^적합합니다\.?$/,
    /^추천합니다\.?$/,
  ];
  return genericPatterns.some(p => p.test(reason.trim()));
}

// ═══════════════════════════════════════════════════════════════════
// Fallback 상태 표현
// ═══════════════════════════════════════════════════════════════════

export type SearchMode = "web" | "model" | "hybrid";

/**
 * 검색 모드를 한국어 라벨로 변환.
 */
export function searchModeLabel(mode: SearchMode, grounded: boolean): string {
  if (mode === "web" && grounded) return "웹 검색 기반";
  if (mode === "hybrid") return "하이브리드 (웹+모델)";
  return "모델 지식 기반";
}

// ═══════════════════════════════════════════════════════════════════
// fitScore 정규화
// ═══════════════════════════════════════════════════════════════════

/**
 * fitScore를 0-100 범위로 clamp + round.
 */
export function clampFitScore(score: unknown): number {
  if (typeof score !== "number" || isNaN(score)) return 50; // default
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * reason이 없거나 부실하면 기본값으로 채운다.
 */
export function ensureReason(reason: unknown, fallback: string = "(이유 미제공)"): string {
  if (typeof reason === "string" && reason.trim().length > 0) return reason;
  return fallback;
}
