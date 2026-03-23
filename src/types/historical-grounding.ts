// ===== Historical Grounding — 아시아 역사/전통 시나리오의 지역·시대 구체화 =====

/**
 * HistoricalGroundingResult — 시나리오에서 감지된 역사적 맥락의 해석 결과.
 * generic "Asian historical" 대신 정확한 지역/시대/복식/건축/소품으로 구체화.
 */
export interface HistoricalGroundingResult {
  /** 역사적 맥락이 감지되었는지 */
  detected: boolean;

  /** 감지된 지역 (예: "Korea", "Japan", "China", "Vietnam") */
  region: string | null;

  /** 감지된 시대/왕조 (예: "Joseon Dynasty", "Edo Period") */
  period: string | null;

  /** 추정 연대 범위 (예: "1392–1897") */
  eraApprox: string | null;

  /** 해석 신뢰도 0–100 */
  confidence: number;

  /** 감지 근거가 된 원문 단어들 */
  sourceTerms: string[];

  /** 각 sourceTerms의 해석된 의미 */
  resolvedMeaning: Record<string, string>;

  /** VEO 프롬프트에 주입할 시각적 앵커 (복식, 건축, 소품, 생활 디테일) */
  visualAnchors: HistoricalVisualAnchor[];

  /** 이 시대/지역에서 반드시 피해야 할 요소 (시대착오, 다른 문화권 혼합) */
  avoid: string[];

  /** 참고 증거 (역사적 근거, 이미지 검색 통합 포인트) */
  referenceEvidence: ReferenceEvidence[];

  /** 경고 목록 */
  warnings: HistoricalWarning[];
}

/** 시각적 앵커 — 프롬프트에 직접 주입 가능한 구체적 디테일 */
export interface HistoricalVisualAnchor {
  /** 카테고리: costume(복식), architecture(건축), props(소품), lifestyle(생활), landscape(풍경) */
  category: "costume" | "architecture" | "props" | "lifestyle" | "landscape";
  /** 구체적 묘사 (영문, VEO 프롬프트 삽입용) */
  description: string;
  /** 한국어 설명 (UI 표시용) */
  descriptionKo: string;
}

/** 참고 증거 */
export interface ReferenceEvidence {
  /** 증거 유형 */
  type: "text_source" | "image_search_hint" | "known_artifact";
  /** 증거 내용 */
  content: string;
}

// ===== Historical Warnings =====

export type HistoricalWarningCode =
  | "missing_historical_resolution"    // 역사적 맥락은 감지되었으나 구체적 지역/시대를 확정하지 못함
  | "mixed_asian_period_cues"          // 서로 다른 아시아 지역/시대의 단서가 혼합됨
  | "anachronistic_object_risk"        // 해당 시대에 존재하지 않는 물건/기술 포함 위험
  | "missing_visual_evidence"          // 시각적 앵커를 도출할 근거가 부족함
  | "missing_cultural_anchors";        // 문화적 맥락을 특정할 고유 단서가 부족함

export interface HistoricalWarning {
  code: HistoricalWarningCode;
  message: string;
  /** 경고 심각도 */
  severity: "info" | "warning" | "error";
  /** 제안 조치 */
  suggestion?: string;
}

// ===== Historical Term Detection =====

/** 감지된 역사적 단서 */
export interface DetectedHistoricalTerm {
  /** 원문 단어/구 */
  term: string;
  /** 매칭 유형 */
  matchType: "exact" | "fuzzy" | "contextual";
  /** 추정 지역 */
  region: string | null;
  /** 추정 시대 */
  period: string | null;
  /** 매칭 신뢰도 0–100 */
  confidence: number;
}

// ===== Historical Knowledge Base Entry =====

/** 역사 지식 베이스 항목 — term detector와 resolver가 참조 */
export interface HistoricalKnowledgeEntry {
  /** 감지 키워드 (한국어 + 영문) */
  terms: string[];
  /** 지역 */
  region: string;
  /** 시대/왕조 */
  period: string;
  /** 추정 연대 */
  eraApprox: string;
  /** 시각적 앵커 */
  visualAnchors: HistoricalVisualAnchor[];
  /** 피해야 할 요소 */
  avoid: string[];
  /** 참고 증거 */
  evidence: ReferenceEvidence[];
}

/** 기본 빈 grounding result */
export function emptyGroundingResult(): HistoricalGroundingResult {
  return {
    detected: false,
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
}
